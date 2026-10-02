/**
 * Localizar e substituir / links no editor de verdade (GrapesJS no Chromium):
 * trocas pela API do editor, um passo só de desfazer, canvas atualizado e o
 * mesmo resultado que a troca feita no servidor (JSON do projeto).
 */
import path from "node:path";
import { buildSync } from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMatcher, replaceInProject } from "@/lib/find-replace";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** Cenários que rodam dentro da página (o GrapesJS precisa de um navegador). */
const ENTRY = `
import grapesjs from "grapesjs";
import { registerComponentTypes } from "@/editor/grapes/components";
import * as fr from "@/lib/find-replace";

const T = fr.ALL_TARGETS;
const w = window;

function makeEditor(opts) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const ed = grapesjs.init({
    container,
    height: "700px",
    storageManager: false,
    telemetry: false,
    projectData: opts.project,
    plugins: [(e) => registerComponentTypes(e)],
    undoManager: { trackSelection: false },
    parser: { optionsHtml: { allowScripts: false } },
  });
  return new Promise((resolve) => ed.on("load", () => {
    if (opts.html) ed.setComponents(opts.html);
    if (opts.extra) ed.addComponents(opts.extra);
    ed.UndoManager.clear();
    fr.installEditorSync(ed);
    resolve(ed);
  }));
}
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const canvasText = (ed) => ed.Canvas.getDocument().body.textContent.replace(/\\s+/g, " ").trim();
const canvasHtml = (ed) => ed.Canvas.getDocument().body.innerHTML;
const summary = (m) => ({ element: m.element, where: m.where, value: m.value, match: m.value.slice(m.range.start, m.range.end), linkKey: m.linkKey, field: m.field.kind });

w.scenarios = {
  async replaceAll({ html, extra, query, replacement, accentInsensitive, preserveCase }) {
    const ed = await makeEditor({ html, extra });
    const matcher = fr.createMatcher(query, { accentInsensitive, preserveCase });
    const project = ed.getProjectData();
    const htmlBefore = ed.getHtml();
    const found = fr.findInEditor(ed, matcher, T).map(summary);
    const count = fr.replaceAllInEditor(ed, matcher, replacement, T);
    const htmlAfter = ed.getHtml();
    const canvasAfter = canvasText(ed);
    const canvasHtmlAfter = canvasHtml(ed);
    await tick();
    const stack = ed.UndoManager.getStack().length;
    ed.UndoManager.undo();
    await tick();
    const htmlUndo = ed.getHtml();
    const canvasUndo = canvasText(ed);
    const hasUndoAfter = ed.UndoManager.hasUndo();
    ed.UndoManager.redo();
    await tick();
    const htmlRedo = ed.getHtml();
    const canvasRedo = canvasText(ed);
    ed.destroy();
    return { project, htmlBefore, found, count, htmlAfter, canvasAfter, canvasHtmlAfter, stack, htmlUndo, canvasUndo, hasUndoAfter, htmlRedo, canvasRedo };
  },
  /** Serializa de novo pelo navegador (aspas/escapes de atributos iguais dos dois lados). */
  normalize(html) {
    const t = document.createElement("template");
    t.innerHTML = html;
    return t.innerHTML;
  },
  async htmlOfProject(project) {
    const ed = await makeEditor({ project });
    const out = ed.getHtml();
    ed.destroy();
    return out;
  },
  async replaceOne({ html, extra, query, replacement, index }) {
    const ed = await makeEditor({ html, extra });
    const matcher = fr.createMatcher(query, {});
    const matches = fr.findInEditor(ed, matcher, T);
    const target = matches[index];
    const count = fr.replaceMatchInEditor(target, matcher, replacement, T);
    // A mesma ocorrência de novo: a página mudou, então não troca nada.
    const stale = fr.replaceMatchInEditor(target, matcher, replacement, T);
    const after = fr.findInEditor(ed, matcher, T).length;
    const out = { total: matches.length, count, stale, after, html: ed.getHtml(), canvas: canvasText(ed) };
    ed.destroy();
    return out;
  },
  async links({ html, match, op }) {
    const ed = await makeEditor({ html });
    const groups = fr.collectLinkGroups(ed).map((g) => ({
      id: g.id, kind: g.kind, url: g.url, linkKey: g.linkKey, pageId: g.pageId,
      labels: g.items.map((i) => i.label), attrs: g.items.map((i) => i.destination && i.destination.attr),
    }));
    let changed = 0, after = "", undo = "";
    if (match) {
      changed = fr.applyLinkOpInEditor(ed, match, op);
      after = ed.getHtml();
      await tick();
      ed.UndoManager.undo();
      await tick();
      undo = ed.getHtml();
    }
    const before = ed.getHtml();
    ed.destroy();
    return { groups, changed, after, undo, before };
  },
};
`;

let browser: Browser;
let page: Page;

beforeAll(async () => {
  const bundle = buildSync({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "ts", sourcefile: "findreplace-entry.ts" },
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    tsconfig: path.join(ROOT, "tsconfig.json"),
    // As funções de HTML do servidor não rodam aqui.
    external: ["cheerio"],
    logLevel: "silent",
  });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setContent("<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  expect(errors).toEqual([]);
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

interface Found {
  element: string;
  where: string;
  value: string;
  match: string;
  linkKey: string | null;
  field: string;
}

interface ReplaceAllResult {
  project: unknown;
  htmlBefore: string;
  found: Found[];
  count: number;
  htmlAfter: string;
  canvasAfter: string;
  canvasHtmlAfter: string;
  stack: number;
  htmlUndo: string;
  canvasUndo: string;
  hasUndoAfter: boolean;
  htmlRedo: string;
  canvasRedo: string;
}

function run<T>(expression: string, arg: unknown): Promise<T> {
  return page.evaluate(`(${expression})(${JSON.stringify(arg)})`) as Promise<T>;
}

const PAGE_HTML = `
<header><a href="https://pay.hotmart.com/X?off=compre" title="Compre agora" data-os-link="checkout">Compre <b>já</b></a></header>
<img src="/os-assets/compre.png" alt="Compre hoje">
<p>Última chance: COMPRE &amp; economize</p>
<os-script data-os-attrs="{}" hidden>var compre = "Compre";</os-script>
<button data-os-href="https://pay.kiwify.com.br/compre" class="compre">Quero</button>
<form action="/compre"><input placeholder="Compre seu nome"><input type="submit" value="Compre"></form>
<div id="compre" data-compre="compre">Sem nada</div>`;
const BLOCK = { type: "text", tagName: "p", content: 'Compre <i title="compre">agora</i>' };

describe("replaceAllInEditor", () => {
  it("acha em textos e atributos, troca tudo e desfaz num passo só", async () => {
    const r = await run<ReplaceAllResult>("scenarios.replaceAll", {
      html: PAGE_HTML,
      extra: BLOCK,
      query: "compre",
      replacement: "Leve",
    });

    expect(r.found).toEqual([
      {
        element: "Link",
        where: "Endereço do link",
        value: "https://pay.hotmart.com/X?off=compre",
        match: "compre",
        linkKey: "checkout",
        field: "attr",
      },
      {
        element: "Link",
        where: "Dica ao passar o mouse",
        value: "Compre agora",
        match: "Compre",
        linkKey: "checkout",
        field: "attr",
      },
      { element: "Link", where: "Texto", value: "Compre ", match: "Compre", linkKey: "checkout", field: "text" },
      {
        element: "Imagem",
        where: "Arquivo da imagem",
        value: "/os-assets/compre.png",
        match: "compre",
        linkKey: null,
        field: "src",
      },
      {
        element: "Imagem",
        where: "Texto alternativo da imagem",
        value: "Compre hoje",
        match: "Compre",
        linkKey: null,
        field: "attr",
      },
      {
        element: "Parágrafo",
        where: "Texto",
        value: "Última chance: COMPRE & economize",
        match: "COMPRE",
        linkKey: null,
        field: "text",
      },
      {
        element: "Botão",
        where: "Endereço ao clicar",
        value: "https://pay.kiwify.com.br/compre",
        match: "compre",
        linkKey: null,
        field: "attr",
      },
      {
        element: "Formulário",
        where: "Envio do formulário",
        value: "/compre",
        match: "compre",
        linkKey: null,
        field: "attr",
      },
      {
        element: "Campo",
        where: "Texto de exemplo do campo",
        value: "Compre seu nome",
        match: "Compre",
        linkKey: null,
        field: "attr",
      },
      { element: "Botão", where: "Texto do botão", value: "Compre", match: "Compre", linkKey: null, field: "attr" },
      { element: "Parágrafo", where: "Texto", value: "Compre ", match: "Compre", linkKey: null, field: "content" },
      {
        element: "Parágrafo",
        where: "Dica ao passar o mouse",
        value: "compre",
        match: "compre",
        linkKey: null,
        field: "content",
      },
    ]);
    expect(r.count).toBe(12);

    // HTML exportado pelo editor: tudo trocado, mas nada de código, classes, ids ou data-*.
    expect(r.htmlAfter).toContain(
      'href="https://pay.hotmart.com/X?off=Leve" title="Leve agora" data-os-link="checkout"',
    );
    expect(r.htmlAfter).toContain(">Leve <b");
    expect(r.htmlAfter).toContain('src="/os-assets/Leve.png" alt="Leve hoje"');
    expect(r.htmlAfter).toContain("Última chance: Leve &amp; economize");
    expect(r.htmlAfter).toContain('data-os-href="https://pay.kiwify.com.br/Leve"');
    expect(r.htmlAfter).toContain('class="compre"');
    expect(r.htmlAfter).toContain('action="/Leve"');
    expect(r.htmlAfter).toContain('placeholder="Leve seu nome"');
    expect(r.htmlAfter).toContain('value="Leve"');
    expect(r.htmlAfter).toContain('id="compre" data-compre="compre"');
    expect(r.htmlAfter).toContain('var compre = "Compre";');
    expect(r.htmlAfter).toContain('Leve <i title="Leve">agora</i>');

    // O canvas mostra o texto novo (textnodes redesenhados).
    expect(r.canvasAfter).toContain("Leve já");
    expect(r.canvasAfter).toContain("Última chance: Leve & economize");
    expect(r.canvasAfter).toContain("Leve agora");
    expect(r.canvasHtmlAfter).toContain('src="/os-assets/Leve.png"');

    // Um "Desfazer" volta tudo (HTML e canvas); "Refazer" reaplica.
    expect(r.htmlUndo).toBe(r.htmlBefore);
    expect(r.hasUndoAfter).toBe(false);
    expect(r.canvasUndo).toContain("Compre já");
    expect(r.canvasUndo).toContain("Última chance: COMPRE & economize");
    expect(r.canvasUndo).toContain("Compre agora");
    expect(r.htmlRedo).toBe(r.htmlAfter);
    expect(r.canvasRedo).toContain("Leve já");
  });

  it("dá o mesmo resultado que a troca no servidor (JSON do projeto)", async () => {
    const r = await run<ReplaceAllResult>("scenarios.replaceAll", {
      html: PAGE_HTML,
      extra: BLOCK,
      query: "compre",
      replacement: 'Leve "já" & <agora>',
    });
    const matcher = createMatcher("compre");
    if (!matcher) throw new Error("busca vazia");
    const server = await replaceInProject(r.project, matcher, 'Leve "já" & <agora>');
    expect(server.count).toBe(r.count);
    const fromServer = await run<string>("scenarios.htmlOfProject", server.project);
    // O cheerio e o navegador escapam "<" em atributos de jeitos diferentes (mesmo DOM).
    expect(await run<string>("scenarios.normalize", fromServer)).toBe(
      await run<string>("scenarios.normalize", r.htmlAfter),
    );
    expect(fromServer).not.toBe(r.htmlBefore);
  });

  it("mantém as maiúsculas nos textos (e igual ao servidor), sem mexer em endereços", async () => {
    const r = await run<ReplaceAllResult>("scenarios.replaceAll", {
      html: PAGE_HTML,
      extra: BLOCK,
      query: "compre",
      replacement: "garanta",
      preserveCase: true,
    });
    expect(r.htmlAfter).toContain('href="https://pay.hotmart.com/X?off=garanta" title="Garanta agora"');
    expect(r.htmlAfter).toContain(">Garanta <b");
    expect(r.htmlAfter).toContain("Última chance: GARANTA &amp; economize");
    expect(r.htmlAfter).toContain('src="/os-assets/garanta.png" alt="Garanta hoje"');
    expect(r.htmlAfter).toContain('value="Garanta"');
    expect(r.htmlAfter).toContain('Garanta <i title="garanta">agora</i>');
    const matcher = createMatcher("compre", { preserveCase: true });
    if (!matcher) throw new Error("busca vazia");
    const server = await replaceInProject(r.project, matcher, "garanta");
    const fromServer = await run<string>("scenarios.htmlOfProject", server.project);
    expect(await run<string>("scenarios.normalize", fromServer)).toBe(
      await run<string>("scenarios.normalize", r.htmlAfter),
    );
  });

  it("ignora acentos quando pedido", async () => {
    const r = await run<ReplaceAllResult>("scenarios.replaceAll", {
      html: "<p>Promoção de AÇÃO</p><p>promocao</p>",
      query: "promocao",
      replacement: "Oferta",
      accentInsensitive: true,
    });
    expect(r.count).toBe(2);
    expect(r.htmlAfter).toContain("<p>Oferta de AÇÃO</p>");
    expect(r.htmlAfter).toMatch(/<p[^>]*>Oferta<\/p>/);
  });
});

describe("replaceMatchInEditor", () => {
  it("troca só a ocorrência escolhida e recusa uma ocorrência velha", async () => {
    const r = await run<{ total: number; count: number; stale: number; after: number; html: string; canvas: string }>(
      "scenarios.replaceOne",
      { html: "<p>Compre hoje. Compre agora.</p><p>Compre</p>", query: "compre", replacement: "Leve", index: 1 },
    );
    expect(r).toMatchObject({ total: 3, count: 1, stale: 0, after: 2 });
    expect(r.html).toContain(">Compre hoje. Leve agora.</p>");
    expect(r.canvas).toContain("Compre hoje. Leve agora.");
  });

  it("troca a n-ésima ocorrência dentro do conteúdo de um bloco", async () => {
    const r = await run<{ count: number; html: string }>("scenarios.replaceOne", {
      html: "",
      extra: BLOCK,
      query: "compre",
      replacement: "Leve",
      index: 1,
    });
    expect(r.count).toBe(1);
    expect(r.html).toContain('Compre <i title="Leve">agora</i>');
  });
});

interface LinksResult {
  groups: {
    id: string;
    kind: string;
    url: string;
    linkKey: string | null;
    pageId: string | null;
    labels: string[];
    attrs: (string | null)[];
  }[];
  changed: number;
  after: string;
  undo: string;
  before: string;
}

const LINKS_HTML = `
<a href="https://pay.hotmart.com/X?off=1">QUERO COMPRAR</a>
<a href="https://Pay.Hotmart.com/X?off=1"><img src="/a.png" alt="Selo de compra"></a>
<button data-os-href="//pay.hotmart.com/X?off=1">Comprar agora</button>
<a href="https://pay.hotmart.com/X?off=1" data-os-link="checkout">Já ligado</a>
<button data-os-link="checkout">Botão do bloco</button>
<a href="os-page:clx00000000000000000000001">Próxima página</a>
<a href="#oferta">Ver oferta</a>
<a href="#">Nada</a>
<a href="javascript:void(0)">Nada</a>
<form action="https://webhook.site/abc"><input type="submit" value="Enviar"></form>
<a href="https://wa.me/5511999999999">Fale conosco</a>`;

describe("links da página", () => {
  it("agrupa os destinos por endereço normalizado e por link da oferta", async () => {
    const r = await run<LinksResult>("scenarios.links", { html: LINKS_HTML });
    expect(r.groups).toEqual([
      {
        id: "url:https://pay.hotmart.com/X?off=1",
        kind: "url",
        url: "https://pay.hotmart.com/X?off=1",
        linkKey: null,
        pageId: null,
        labels: ["QUERO COMPRAR", "[Selo de compra]", "Comprar agora"],
        attrs: ["href", "href", "data-os-href"],
      },
      {
        id: "link:checkout",
        kind: "offer-link",
        url: "https://pay.hotmart.com/X?off=1",
        linkKey: "checkout",
        pageId: null,
        labels: ["Já ligado", "Botão do bloco"],
        attrs: ["href", null],
      },
      {
        id: "url:os-page:clx00000000000000000000001",
        kind: "funnel-page",
        url: "os-page:clx00000000000000000000001",
        linkKey: null,
        pageId: "clx00000000000000000000001",
        labels: ["Próxima página"],
        attrs: ["href"],
      },
      {
        id: "url:#oferta",
        kind: "anchor",
        url: "#oferta",
        linkKey: null,
        pageId: null,
        labels: ["Ver oferta"],
        attrs: ["href"],
      },
      {
        id: "url:https://webhook.site/abc",
        kind: "url",
        url: "https://webhook.site/abc",
        linkKey: null,
        pageId: null,
        labels: ["Enviar"],
        attrs: ["action"],
      },
      {
        id: "url:https://wa.me/5511999999999",
        kind: "url",
        url: "https://wa.me/5511999999999",
        linkKey: null,
        pageId: null,
        labels: ["Fale conosco"],
        attrs: ["href"],
      },
    ]);
  });

  it("liga o grupo inteiro ao link da oferta num passo só de desfazer", async () => {
    const r = await run<LinksResult>("scenarios.links", {
      html: LINKS_HTML,
      match: { kind: "url", url: "https://pay.hotmart.com/X?off=1" },
      op: { type: "bind", key: "checkout" },
    });
    expect(r.changed).toBe(3);
    expect(r.after.match(/data-os-link="checkout"/g)).toHaveLength(5);
    expect(r.undo.match(/data-os-link="checkout"/g)).toHaveLength(2);
  });

  it("troca o endereço de todos os elementos do grupo", async () => {
    const r = await run<LinksResult>("scenarios.links", {
      html: LINKS_HTML,
      match: { kind: "url", url: "//PAY.hotmart.com/X?off=1" },
      op: { type: "set-url", url: "https://pay.kiwify.com.br/novo" },
    });
    expect(r.changed).toBe(3);
    expect(r.after.match(/https:\/\/pay\.kiwify\.com\.br\/novo/g)).toHaveLength(3);
    // O que já estava ligado ao link da oferta não muda.
    expect(r.after).toContain('href="https://pay.hotmart.com/X?off=1" data-os-link="checkout"');
    expect(r.undo).not.toContain("kiwify");
  });

  it("desliga do link da oferta gravando o endereço atual", async () => {
    const r = await run<LinksResult>("scenarios.links", {
      html: LINKS_HTML,
      match: { kind: "link", key: "checkout" },
      op: { type: "unbind", url: "https://pay.hotmart.com/NOVO" },
    });
    expect(r.changed).toBe(2);
    expect(r.after).not.toContain("data-os-link");
    expect(r.after).toContain('<a href="https://pay.hotmart.com/NOVO"');
    expect(r.after).toMatch(
      /<button[^>]*data-os-href="https:\/\/pay\.hotmart\.com\/NOVO"[^>]*>Botão do bloco<\/button>/,
    );
  });
});
