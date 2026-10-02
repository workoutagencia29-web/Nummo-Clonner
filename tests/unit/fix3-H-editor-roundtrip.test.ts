/**
 * Correções da Fase 3 (grupo H) no editor de verdade: o HTML guardado passa por
 * prepareForEditor (+ folha base, como htmlForEditor), entra no GrapesJS
 * (createEditor + setComponents asDocument, como na primeira abertura), sai por
 * getHtml/getCss e volta por finalizeFromEditor com o HTML anterior (como o
 * salvar). A página final é aberta num Chromium com o CSS servido do storage.
 */
import * as cheerio from "cheerio";
import { type Browser, chromium, type Page, type Route } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BASE_CSS_ATTR,
  baseStylesheetText,
  EDITS_STYLE_ATTR,
  FIX_STYLE_ATTR,
  finalizeFromEditor,
  linkBaseStylesheet,
  PRESERVE_JS_META,
  prepareForEditor,
} from "@/lib/editor-html";
import { computeLegacyRepair, legacySignals } from "@/lib/legacy-repair";
import { renderPageHtml } from "@/lib/page-render";
import { runtimeScript } from "@/lib/runtime-bundle";
import { getObject, mimeFromKey, putContentAddressed } from "@/lib/storage";
import { type EditorWindow, editorBundle } from "./blocks-harness";

const ASSET = "/os-assets/";

async function asset(body: string, ext: string) {
  const stored = await putContentAddressed(Buffer.from(body, "utf8"), ext);
  return `${ASSET}${stored.sha256}.${ext}`;
}

/** Igual a htmlForEditor (src/server/services/documents.ts), sem banco. */
async function forEditor(stored: string) {
  const prepared = prepareForEditor(stored);
  const files: { href: string; media?: string }[] = [];
  for (const style of prepared.styles) {
    if (style.kind === "link" && style.href) files.push({ href: style.href, media: style.media });
    else if (style.text) files.push({ href: await asset(style.text, "css"), media: style.media });
  }
  if (!files.length) return prepared.html;
  return linkBaseStylesheet(prepared.html, await asset(baseStylesheetText(files), "css"));
}

async function serveAsset(route: Route, pathname: string) {
  const file = pathname.slice(ASSET.length);
  const key = `a/${file.slice(0, 2)}/${file}`;
  try {
    return await route.fulfill({ body: await getObject(key), contentType: mimeFromKey(key) });
  } catch {
    return route.fulfill({ status: 404, body: "" });
  }
}

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
  await editorBundle();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

interface EditorSession {
  page: Page;
  errors: string[];
  /** Pedidos para fora do editor (nada deveria sair do canvas). */
  external: string[];
}

const SHELL = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<div id="canvas" style="height:900px"></div><div id="blocks"></div><div id="layers"></div>
<div id="styles"></div><div id="traits"></div></body></html>`;

/** Editor montado como no app, com /os-assets/ servido do storage (o canvas carrega a folha base). */
async function openEditor(project: unknown = null): Promise<EditorSession> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:") return route.continue();
    if (url.host === "editor.test" && url.pathname.startsWith(ASSET)) return serveAsset(route, url.pathname);
    if (url.href === "http://editor.test/") return route.fulfill({ contentType: "text/html", body: SHELL });
    external.push(url.href);
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto("http://editor.test/");
  await page.addScriptTag({ content: await editorBundle() });
  await page.evaluate(
    (data) =>
      new Promise<void>((resolve) => {
        const w = window as unknown as EditorWindow;
        const [canvas, blocks, layers, styles, traits] = ["canvas", "blocks", "layers", "styles", "traits"].map(
          (id) => document.getElementById(id) as HTMLElement,
        );
        const ed = w.OS.createEditor({ canvas, blocks, layers, styles, traits }, data);
        w.ed = ed;
        w.OS.setWidgetContext(ed, () => ({ links: [], pages: [] }));
        w.OS.registerDynamicTraits(ed, () => ({ links: [], pages: [] }));
        ed.on("load", () => resolve());
      }),
    project,
  );
  return { page, errors, external };
}

/** Primeira abertura (editor-app.tsx): importa o HTML como documento. */
async function importHtml(s: EditorSession, html: string) {
  await s.page.evaluate((doc) => {
    const ed = (window as unknown as EditorWindow).ed;
    ed.setComponents(doc, { asDocument: true } as never);
    ed.UndoManager.clear();
  }, html);
  await s.page.waitForTimeout(150);
}

/** O que o editor manda ao salvar. */
async function exportHtml(s: EditorSession) {
  return s.page.evaluate(() => {
    const ed = (window as unknown as EditorWindow).ed;
    return { html: ed.getHtml({ asDocument: true } as never), css: ed.getCss({ avoidProtected: true }) ?? "" };
  });
}

/** Abre a página final como o visitante (prévia): HTML + /os-assets/ do storage + script do Offer Studio. */
async function openFinal(html: string) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const external: string[] = [];
  const served = renderPageHtml(html, {
    links: [],
    pageHref: (id) => `/p/${id}`,
    runtimeTag: `<script data-os-runtime>${runtimeScript()}</script>`,
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:") return route.continue();
    if (url.host === "site.test" && url.pathname === "/oferta") {
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: served });
    }
    if (url.host === "site.test" && url.pathname.startsWith(ASSET)) return serveAsset(route, url.pathname);
    external.push(url.href);
    return route.abort();
  });
  await page.goto("http://site.test/oferta");
  await page.waitForTimeout(100);
  return { page, external };
}

/** Estilo calculado de um elemento. */
function computed(page: Page, selector: string, prop: string, index = 0) {
  return page.evaluate(
    ([sel, p, i]) => {
      const el = document.querySelectorAll(sel as string)[i as number];
      return el ? getComputedStyle(el).getPropertyValue(p as string) : null;
    },
    [selector, prop, index] as const,
  );
}

// ─── #0 e #3 ─────────────────────────────────────────────────────────────────

describe("#0/#3 — nada da página roda no painel nem vira script ao salvar", () => {
  const STORED = `<!doctype html><html><head><meta charset="utf-8"><title>Clone</title></head><body>
<div id="a" data-gjs-type="script" src="https://evil.example/x.js">window.top.__pwned = 1;</div>
<div id="b" data-gjs-script="window.top.__pwned = 2;">b</div>
<p id="c" data-gjs-attributes='{"onclick":"window.top.__pwned = 3"}' data-gjs-type="text">c</p>
<os-script data-os-attrs='{"src":"https://tracker.evil.example/t.js"}' hidden></os-script>
<button id="d" data-os-on-click="location.href='https://evil.example'">Comprar</button>
</body></html>`;

  it("sem código rodando no canvas, e o HTML salvo sai limpo", async () => {
    const s = await openEditor();
    try {
      await importHtml(s, await forEditor(STORED));
      await s.page.waitForTimeout(300);
      const canvas = await s.page.evaluate(() => {
        const ed = (window as unknown as EditorWindow).ed;
        const doc = ed.Canvas.getDocument() as Document;
        return {
          pwned: (window as unknown as { __pwned?: number }).__pwned ?? null,
          scripts: doc.querySelectorAll("script").length,
          scriptComponents: ed
            .getWrapper()
            ?.find("*")
            .filter((c) => c.is("script") || !!c.get("script")).length,
        };
      });
      expect(canvas).toEqual({ pwned: null, scripts: 0, scriptComponents: 0 });
      expect(s.external.filter((u) => u.includes("evil.example"))).toEqual([]);

      const out = await exportHtml(s);
      // (o src="…" que sobra na <div> é só um atributo sem efeito)
      expect(out.html).not.toMatch(/data-gjs-|onclick|tracker\.evil|os-script|<script/i);
      const final = finalizeFromEditor(out.html, out.css, STORED);
      const $ = cheerio.load(final);
      expect($("script")).toHaveLength(0);
      expect(final).not.toMatch(/onclick|tracker\.evil|location\.href|data-gjs-/i);
      expect($("#d").text()).toBe("Comprar");
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

// ─── #8 e #45 ────────────────────────────────────────────────────────────────

describe("#8 — o <head> não vai para o <body> (scripts antes de título/metas)", () => {
  const STORED = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="${PRESERVE_JS_META}" content="1">
<script>window.dataLayer = window.dataLayer || []; window.__headRan = 1;</script>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Minha Oferta</title><meta name="description" content="Oferta especial">
<meta property="og:image" content="/os-assets/og.png"><link rel="canonical" href="https://minha.oferta/">
<link rel="icon" href="/os-assets/f.ico"><script type="application/ld+json">{"@type":"Product"}</script>
<noscript><img height="1" width="1" src="/os-assets/px.gif"></noscript>
<style>h1{color:rgb(10, 20, 30)}</style>
</head><body><h1 id="t">Oferta</h1><script>window.__bodyRan = 1;</script></body></html>`;

  it("título, description, og:image, canonical, favicon e scripts continuam no <head>, na ordem", async () => {
    const s = await openEditor();
    try {
      await importHtml(s, await forEditor(STORED));
      const ran = await s.page.evaluate(() => {
        const win = (window as unknown as EditorWindow).ed.Canvas.getWindow() as Window & { __headRan?: number };
        return win.__headRan ?? null;
      });
      expect(ran).toBeNull();
      const out = await exportHtml(s);
      // Primeira abertura: o anterior é o HTML guardado. Depois, o finalizado.
      const first = finalizeFromEditor(out.html, out.css, STORED);
      const second = finalizeFromEditor(out.html, out.css, first);
      for (const final of [first, second]) {
        const $ = cheerio.load(final);
        const head = $("head")
          .children()
          .toArray()
          .map((el) =>
            el.tagName === "meta" ? `meta:${$(el).attr("name") ?? $(el).attr("property") ?? "charset"}` : el.tagName,
          );
        expect(head).toEqual([
          "meta:charset",
          `meta:${PRESERVE_JS_META}`,
          "script",
          "meta:viewport",
          "link",
          "title",
          "meta:description",
          "meta:og:image",
          "link",
          "link",
          "script",
          "noscript",
        ]);
        expect($("head > link").first().attr(BASE_CSS_ATTR)).toBeDefined();
        expect($('meta[name="viewport"]')).toHaveLength(1);
        expect($('meta[name="viewport"]').attr("content")).toContain("maximum-scale=1");
        expect(
          $("body")
            .children()
            .toArray()
            .map((el) => el.tagName),
        ).toEqual(["h1", "script"]);
        expect($("head > script").first().html()).toBe(
          "window.dataLayer = window.dataLayer || []; window.__headRan = 1;",
        );
      }
      expect(second).toBe(first);

      // A página final continua com o CSS original e o título.
      const site = await openFinal(first);
      try {
        expect(await site.page.title()).toBe("Minha Oferta");
        expect(await computed(site.page, "h1", "color")).toBe("rgb(10, 20, 30)");
        expect(await site.page.evaluate(() => (window as unknown as { __bodyRan?: number }).__bodyRan)).toBe(1);
      } finally {
        await site.page.close();
      }
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

// ─── #9 ──────────────────────────────────────────────────────────────────────

describe("#9 — ids repetidos continuam iguais (CSS, âncoras e scripts)", () => {
  it("dois botões id=comprar mantêm o estilo #comprar; um deles editado fica só com a edição", async () => {
    const STORED = `<!doctype html><html><head><meta charset="utf-8">
<style>#comprar{background-color:rgb(0, 128, 0)} #bloco{padding-top:7px}</style></head><body>
<a id="comprar" class="btn" href="#oferta">Comprar 1</a>
<section id="oferta"><a id="comprar" class="btn">Comprar 2</a></section>
<div id="bloco">a</div><div id="bloco">b</div>
</body></html>`;
    const s = await openEditor();
    try {
      await importHtml(s, await forEditor(STORED));
      const before = await exportHtml(s);
      expect(before.html).not.toContain("comprar-2");
      expect(before.html).not.toContain("bloco-2");
      // O usuário muda a cor só do segundo botão (painel Estilo).
      await s.page.evaluate(() => {
        const ed = (window as unknown as EditorWindow).ed;
        const second = ed.getWrapper()?.find('[data-os-dup-id="comprar"]')[0];
        if (!second) throw new Error("sem o segundo botão");
        second.addStyle({ color: "rgb(0, 0, 255)" });
      });
      const out = await exportHtml(s);
      const final = finalizeFromEditor(out.html, out.css, STORED);
      const $ = cheerio.load(final);
      expect($('[id="comprar"]')).toHaveLength(2);
      expect($('[id="bloco"]')).toHaveLength(2);
      expect(final).not.toMatch(/data-os-dup-id|comprar-2|bloco-2/);

      const site = await openFinal(final);
      try {
        for (const i of [0, 1]) {
          expect(await computed(site.page, "a.btn", "background-color", i)).toBe("rgb(0, 128, 0)");
          expect(await computed(site.page, "div", "padding-top", i)).toBe("7px");
        }
        expect(await computed(site.page, "a.btn", "color", 1)).toBe("rgb(0, 0, 255)");
        expect(await computed(site.page, "a.btn", "color", 0)).not.toBe("rgb(0, 0, 255)");
        // O que se viu no editor é o que foi para a página.
        expect(await allComputed(site.page, "a.btn", "color")).toEqual(await canvasComputed(s.page, "a.btn", "color"));
      } finally {
        await site.page.close();
      }
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });

  const DUPS = `<!doctype html><html><head><meta charset="utf-8">
<style>#comprar{background-color:rgb(0, 128, 0)} #bloco{padding-top:7px}</style></head><body>
<a href="#garantia">ir</a>
<a id="comprar" class="btn" href="#oferta">Comprar 1</a>
<section id="oferta"><a id="comprar" class="btn">Comprar 2</a></section>
<section id="bloco" class="b">a</section><section id="bloco" class="b">b</section>
</body></html>`;

  it("no canvas os repetidos também têm o estilo do id (#comprar, #bloco) enquanto se edita", async () => {
    const s = await openEditor();
    try {
      await importHtml(s, await forEditor(DUPS));
      expect(await canvasComputed(s.page, "a.btn", "background-color")).toEqual(["rgb(0, 128, 0)", "rgb(0, 128, 0)"]);
      expect(await canvasComputed(s.page, "section.b", "padding-top")).toEqual(["7px", "7px"]);
      // O repetido estilizado continua com o estilo do id e ganha o dele.
      await s.page.evaluate(() => {
        const ed = (window as unknown as EditorWindow).ed;
        ed.getWrapper()?.find('[data-os-dup-id="comprar"]')[0].addStyle({ color: "rgb(0, 0, 255)" });
      });
      await s.page.waitForTimeout(50);
      expect(await canvasComputed(s.page, "a.btn", "background-color")).toEqual(["rgb(0, 128, 0)", "rgb(0, 128, 0)"]);
      expect((await canvasComputed(s.page, "a.btn", "color"))[1]).toBe("rgb(0, 0, 255)");
      // Duplicar um repetido: a cópia também é "comprar" (verde), sem a cor do outro.
      await s.page.evaluate(() => {
        const ed = (window as unknown as EditorWindow).ed;
        const section = ed.getWrapper()?.find("#oferta")[0];
        const dup = ed.getWrapper()?.find('[data-os-dup-id="comprar"]')[0];
        if (!section || !dup) throw new Error("sem elementos");
        section.append(dup.clone());
      });
      await s.page.waitForTimeout(50);
      const bg = await canvasComputed(s.page, "a.btn", "background-color");
      expect(bg).toEqual(["rgb(0, 128, 0)", "rgb(0, 128, 0)", "rgb(0, 128, 0)"]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });

  it("editar o PRIMEIRO de um id repetido muda só ele — no canvas e na página final", async () => {
    const s = await openEditor();
    try {
      await importHtml(s, await forEditor(DUPS));
      await s.page.evaluate(() => {
        const ed = (window as unknown as EditorWindow).ed;
        const first = ed.getWrapper()?.find("#comprar")[0];
        if (!first) throw new Error("sem o primeiro botão");
        ed.select(first);
        first.addStyle({ color: "rgb(0, 0, 255)" });
        ed.getWrapper()?.find("#bloco")[0].addStyle({ "padding-top": "30px" });
      });
      await s.page.waitForTimeout(50);
      const canvas = {
        color: await canvasComputed(s.page, "a.btn", "color"),
        bg: await canvasComputed(s.page, "a.btn", "background-color"),
        pad: await canvasComputed(s.page, "section.b", "padding-top"),
      };
      expect(canvas.color[0]).toBe("rgb(0, 0, 255)");
      expect(canvas.color[1]).not.toBe("rgb(0, 0, 255)");
      expect(canvas.pad).toEqual(["30px", "7px"]);
      const out = await exportHtml(s);
      const final = finalizeFromEditor(out.html, out.css, DUPS);
      const $ = cheerio.load(final);
      expect($('[id="comprar"]')).toHaveLength(2);
      expect($(`style[${EDITS_STYLE_ATTR}]`).text()).toContain("#comprar:not([data-os-dup-id])");
      const site = await openFinal(final);
      try {
        expect({
          color: await allComputed(site.page, "a.btn", "color"),
          bg: await allComputed(site.page, "a.btn", "background-color"),
          pad: await allComputed(site.page, "section.b", "padding-top"),
        }).toEqual(canvas);
      } finally {
        await site.page.close();
      }
      // Salvar de novo (o anterior agora é o finalizado) dá o mesmo.
      expect(finalizeFromEditor(out.html, out.css, final)).toBe(final);
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });

  it("edição !important (vence o !important original) num id repetido: canvas e página final iguais", async () => {
    const STORED = `<!doctype html><html><head><meta charset="utf-8">
<style>#comprar{color:rgb(255, 0, 0) !important}</style></head><body>
<a id="comprar" class="btn">Comprar 1</a><a id="comprar" class="btn">Comprar 2</a><a id="comprar" class="btn">Comprar 3</a>
</body></html>`;
    const s = await openEditor();
    try {
      await importHtml(s, await forEditor(STORED));
      await s.page.evaluate(() => {
        const ed = (window as unknown as EditorWindow).ed;
        ed.Css.setRule("#comprar", { color: "rgb(0, 0, 255) !important" });
        ed.getWrapper()?.find('[data-os-dup-id="comprar"]')[1].addStyle({ color: "rgb(0, 128, 0) !important" });
      });
      await s.page.waitForTimeout(100);
      const canvas = await canvasComputed(s.page, "a.btn", "color");
      expect(canvas).toEqual(["rgb(0, 0, 255)", "rgb(255, 0, 0)", "rgb(0, 128, 0)"]);
      const out = await exportHtml(s);
      const final = finalizeFromEditor(out.html, out.css, STORED);
      const site = await openFinal(final);
      try {
        expect(await allComputed(site.page, "a.btn", "color")).toEqual(canvas);
      } finally {
        await site.page.close();
      }
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });

  it("id digitado em Configurações num repetido fica; um id que já existe é recusado e nada muda", async () => {
    const s = await openEditor();
    try {
      await importHtml(s, await forEditor(DUPS));
      await s.page.evaluate(() => {
        const ed = (window as unknown as EditorWindow).ed;
        const [dupBloco] = ed.getWrapper()?.find('[data-os-dup-id="bloco"]') ?? [];
        const [dupComprar] = ed.getWrapper()?.find('[data-os-dup-id="comprar"]') ?? [];
        if (!dupBloco || !dupComprar) throw new Error("sem repetidos");
        dupBloco.addAttributes({ id: "garantia" });
        // "bloco" já existe: o GrapesJS recusa (o repetido continua "comprar").
        dupComprar.addAttributes({ id: "bloco" });
      });
      await s.page.waitForTimeout(50);
      // No canvas: a seção com id novo perde o estilo de #bloco (como vai ficar na página).
      expect(await canvasComputed(s.page, "section.b", "padding-top")).toEqual(["7px", "0px"]);
      expect(await canvasComputed(s.page, "a.btn", "background-color")).toEqual(["rgb(0, 128, 0)", "rgb(0, 128, 0)"]);
      const out = await exportHtml(s);
      const final = finalizeFromEditor(out.html, out.css, DUPS);
      const $ = cheerio.load(final);
      expect($("#garantia")).toHaveLength(1);
      expect($("#garantia").text()).toBe("b");
      expect($('[id="bloco"]')).toHaveLength(1);
      expect($('[id="comprar"]')).toHaveLength(2);
      const site = await openFinal(final);
      try {
        expect(await allComputed(site.page, "section.b", "padding-top")).toEqual(["7px", "0px"]);
        expect(await allComputed(site.page, "a.btn", "background-color")).toEqual(["rgb(0, 128, 0)", "rgb(0, 128, 0)"]);
      } finally {
        await site.page.close();
      }
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

/** Estilo calculado de todos os elementos do seletor no canvas do editor. */
function canvasComputed(page: Page, selector: string, prop: string) {
  return page.evaluate(
    ([sel, p]) => {
      const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
      const win = doc.defaultView as Window;
      return Array.from(doc.querySelectorAll(sel)).map((el) => win.getComputedStyle(el).getPropertyValue(p));
    },
    [selector, prop] as const,
  );
}

/** Estilo calculado de todos os elementos do seletor numa página. */
function allComputed(page: Page, selector: string, prop: string) {
  return page.evaluate(
    ([sel, p]) => Array.from(document.querySelectorAll(sel)).map((el) => getComputedStyle(el).getPropertyValue(p)),
    [selector, prop] as const,
  );
}

// ─── #14 e #42 ───────────────────────────────────────────────────────────────

describe("#14/#42 — <noscript><style> não vira CSS de todo visitante", () => {
  it("WP Rocket: o vídeo (facade) e as imagens lazy continuam visíveis; os <noscript> voltam iguais", async () => {
    const STORED = `<!doctype html><html><head><meta charset="utf-8">
<noscript><style id="rocket-lazyload-nojs-css">.rll-youtube-player, [data-lazy-src]{display:none !important;}</style></noscript>
</head><body>
<div class="rll-youtube-player" style="width:320px;height:180px">vídeo</div>
<img id="img" data-lazy-src="/os-assets/a.png" src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" width="10" height="10">
<noscript><style>.lazyload{display:none!important}</style><img src="/os-assets/b.png"></noscript>
<img class="lazyload" src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" width="10" height="10">
</body></html>`;
    const s = await openEditor();
    try {
      await importHtml(s, await forEditor(STORED));
      const out = await exportHtml(s);
      expect(out.css).not.toMatch(/display\s*:\s*none/);
      const canvas = await s.page.evaluate(() => {
        const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
        const win = doc.defaultView as Window;
        return [".rll-youtube-player", "#img", ".lazyload"].map((sel) => {
          const el = doc.querySelector(sel);
          return el ? win.getComputedStyle(el).display : "sem elemento";
        });
      });
      expect(canvas).not.toContain("none");
      const final = finalizeFromEditor(out.html, out.css, STORED);
      expect(final).toContain(
        '<noscript><style id="rocket-lazyload-nojs-css">.rll-youtube-player, [data-lazy-src]{display:none !important;}</style></noscript>',
      );
      expect(final).toContain(
        '<noscript><style>.lazyload{display:none!important}</style><img src="/os-assets/b.png"></noscript>',
      );
      expect(cheerio.load(final)(`style[${EDITS_STYLE_ATTR}]`).text()).not.toMatch(/display\s*:\s*none/);
      const site = await openFinal(final);
      try {
        for (const sel of [".rll-youtube-player", "#img", ".lazyload"]) {
          expect(await computed(site.page, sel, "display"), sel).not.toBe("none");
        }
      } finally {
        await site.page.close();
      }
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

// ─── Páginas abertas antes das correções (#9 e #42) ──────────────────────────

describe("#9/#42 — páginas abertas antes das correções são reparadas ao abrir", () => {
  it("regras do <noscript> saem e ids '-2' voltam a ser repetidos: canvas e página final certos", async () => {
    const NOSCRIPT_CSS = ".rll-youtube-player, [data-lazy-src]{display:none !important;}";
    const STORED = `<!doctype html><html><head><meta charset="utf-8">
<noscript><style id="rocket-lazyload-nojs-css">${NOSCRIPT_CSS}</style></noscript>
<style>#comprar{background-color:rgb(0, 128, 0)}</style></head><body>
<div class="rll-youtube-player" style="width:320px;height:180px">vídeo</div>
<a id="comprar" class="btn">Comprar 1</a><section><a id="comprar" class="btn">Comprar 2</a></section>
</body></html>`;
    // Como o editor antigo recebia a página: <noscript> de verdade e ids repetidos.
    const legacyHtml = (await forEditor(STORED))
      .replace('data-os-dup-id="comprar"', 'id="comprar"')
      .replace("<body>", `<body><noscript><style>${NOSCRIPT_CSS}</style></noscript>`);
    const old = await openEditor();
    let project: unknown;
    let legacyStored: string;
    try {
      await importHtml(old, legacyHtml);
      const out = await exportHtml(old);
      // O estrago de antes: o repetido renomeado e o CSS do <noscript> no editor.
      expect(out.html).toContain('id="comprar-2"');
      expect(out.css).toMatch(/display:none/);
      legacyStored = finalizeFromEditor(out.html, out.css, STORED);
      project = await old.page.evaluate(() => {
        const { assets: _a, ...data } = (window as unknown as EditorWindow).ed.getProjectData();
        return data;
      });
    } finally {
      await old.page.close();
    }

    // O servidor compara com a "Versão original" (o HTML guardado antes da primeira abertura).
    const repair = computeLegacyRepair(STORED, legacySignals(project));
    expect(repair).toEqual({ noscriptCss: [NOSCRIPT_CSS], dupIds: { "comprar-2": "comprar" } });

    const s = await openEditor(project);
    try {
      const changed = await s.page.evaluate((r) => {
        const w = window as unknown as EditorWindow;
        return w.OS.applyLegacyRepair(w.ed, r);
      }, repair);
      expect(changed).toBe(true);
      await s.page.waitForTimeout(100);
      expect(await canvasComputed(s.page, ".rll-youtube-player", "display")).toEqual(["block"]);
      expect(await canvasComputed(s.page, "a.btn", "background-color")).toEqual(["rgb(0, 128, 0)", "rgb(0, 128, 0)"]);
      // De novo: nada mais a reparar.
      expect(
        await s.page.evaluate((r) => {
          const w = window as unknown as EditorWindow;
          return w.OS.applyLegacyRepair(w.ed, r);
        }, repair),
      ).toBe(false);
      const out = await exportHtml(s);
      expect(out.css).not.toMatch(/display:none/);
      const final = finalizeFromEditor(out.html, out.css, legacyStored);
      const $ = cheerio.load(final);
      expect($('[id="comprar"]')).toHaveLength(2);
      expect($('[id="comprar-2"]')).toHaveLength(0);
      const site = await openFinal(final);
      try {
        expect(await allComputed(site.page, ".rll-youtube-player", "display")).toEqual(["block"]);
        expect(await allComputed(site.page, "a.btn", "background-color")).toEqual(["rgb(0, 128, 0)", "rgb(0, 128, 0)"]);
      } finally {
        await site.page.close();
      }
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });

  it("regra do <noscript> que a pessoa editou depois fica (só sai o que veio igual)", async () => {
    const NOSCRIPT_CSS = ".lazyload{display:none!important}";
    const s = await openEditor();
    try {
      await importHtml(
        s,
        `<!doctype html><html><head></head><body><noscript><style>${NOSCRIPT_CSS}</style></noscript><img class="lazyload"></body></html>`,
      );
      const left = await s.page.evaluate((css) => {
        const w = window as unknown as EditorWindow;
        const ed = w.ed;
        ed.Css.setRule(".lazyload", { display: "block", color: "red" });
        const changed = w.OS.applyLegacyRepair(ed, { noscriptCss: [css], dupIds: {} });
        return { changed, css: ed.getCss({ avoidProtected: true }) };
      }, NOSCRIPT_CSS);
      expect(left.changed).toBe(false);
      expect(left.css).toContain(".lazyload{display:block;color:red;}");
    } finally {
      await s.page.close();
    }
  });
});

// ─── #53 ─────────────────────────────────────────────────────────────────────

describe("#53 — style com url(data:…;base64) não é cortado no ';'", () => {
  it("o fundo em base64 continua igual no canvas e na página final", async () => {
    const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
    const STORED = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="b64" style="width:20px;height:20px;background:url(${GIF}) repeat">a</div>
<div id="q" style='width:20px;height:20px;background-image:url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22/>")'>b</div>
</body></html>`;
    const s = await openEditor();
    try {
      await importHtml(s, await forEditor(STORED));
      const canvasBg = await s.page.evaluate(() => {
        const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
        const el = doc.getElementById("b64");
        return el ? (doc.defaultView as Window).getComputedStyle(el).backgroundImage : null;
      });
      expect(canvasBg).toBe(`url("${GIF}")`);
      const out = await exportHtml(s);
      const final = finalizeFromEditor(out.html, out.css, STORED);
      const site = await openFinal(final);
      try {
        expect(await computed(site.page, "#b64", "background-image")).toBe(`url("${GIF}")`);
        expect(await computed(site.page, "#b64", "background-repeat")).toBe("repeat");
        expect(await computed(site.page, "#q", "background-image")).toContain("data:image/svg+xml;utf8,");
      } finally {
        await site.page.close();
      }
    } finally {
      await s.page.close();
    }
  });
});

// ─── #46 ─────────────────────────────────────────────────────────────────────

describe("#46 — !important do CSS original não vence as edições", () => {
  it("edição com !important vence o !important original; style='… !important' da página continua valendo", async () => {
    const STORED = `<!doctype html><html><head><meta charset="utf-8">
<style>.title{color:rgb(255, 0, 0) !important} #s2{color:rgb(255, 165, 0) !important}</style></head><body>
<h1 id="t1" class="title">Título</h1><p id="s2" style="color:rgb(128, 0, 128) !important">Texto</p>
</body></html>`;
    // A página original (antes do editor): o inline !important vence.
    const original = await openFinal(STORED);
    try {
      expect(await computed(original.page, "#s2", "color")).toBe("rgb(128, 0, 128)");
    } finally {
      await original.page.close();
    }
    const s = await openEditor();
    try {
      await importHtml(s, await forEditor(STORED));
      await s.page.evaluate(() => {
        const ed = (window as unknown as EditorWindow).ed;
        ed.Css.setRule("#t1", { color: "rgb(0, 0, 255) !important" });
      });
      const out = await exportHtml(s);
      const final = finalizeFromEditor(out.html, out.css, STORED);
      const $ = cheerio.load(final);
      expect($(`style[${FIX_STYLE_ATTR}]`).next().is(`link[${BASE_CSS_ATTR}]`)).toBe(true);
      const site = await openFinal(final);
      try {
        expect(await computed(site.page, "#t1", "color")).toBe("rgb(0, 0, 255)");
        expect(await computed(site.page, "#s2", "color")).toBe("rgb(128, 0, 128)");
      } finally {
        await site.page.close();
      }
    } finally {
      await s.page.close();
    }
  });
});

// ─── #12 ─────────────────────────────────────────────────────────────────────

describe("#12 — javascript: e CSS assíncrono sobrevivem ao editor", () => {
  it("href/onclick com javascript: voltam; CSS media=print + onload vale no canvas e na página", async () => {
    const css = await asset(".async{color:rgb(1, 2, 3)}", "css");
    const STORED = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${css}" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="${css}"></noscript>
</head><body><p class="async">texto</p>
<a id="b1" href="javascript:void(0)" onclick="javascript:window.__clicked = 1">Abrir</a></body></html>`;
    const s = await openEditor();
    try {
      await importHtml(s, await forEditor(STORED));
      await s.page.waitForTimeout(200);
      const canvasColor = await s.page.evaluate(() => {
        const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
        const el = doc.querySelector(".async");
        return el ? (doc.defaultView as Window).getComputedStyle(el).color : null;
      });
      expect(canvasColor).toBe("rgb(1, 2, 3)");
      const out = await exportHtml(s);
      const final = finalizeFromEditor(out.html, out.css, STORED);
      const $ = cheerio.load(final);
      expect($("#b1").attr("href")).toBe("javascript:void(0)");
      expect($("#b1").attr("onclick")).toBe("javascript:window.__clicked = 1");
      expect($(`head > link[href="${css}"]`)).toHaveLength(0);
      const site = await openFinal(final);
      try {
        expect(await computed(site.page, ".async", "color")).toBe("rgb(1, 2, 3)");
        await site.page.click("#b1");
        expect(await site.page.evaluate(() => (window as unknown as { __clicked?: number }).__clicked)).toBe(1);
      } finally {
        await site.page.close();
      }
    } finally {
      await s.page.close();
    }
  });
});
