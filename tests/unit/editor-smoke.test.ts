/**
 * Teste de fumaça do editor montado como no app (src/editor/editor-app.tsx):
 * GrapesJS carregado do node_modules (grapes.min.js + grapes.min.css) numa
 * página em branco do Chromium e a configuração do Offer Studio compilada com
 * esbuild (createEditor, tipos de componente, blocos, seções de estilo,
 * "Classes/Estado", contexto dos widgets, imagens, envio de vídeo e ajustes de
 * desfazer/refazer).
 *
 * Confere: todos os blocos registram e entram na página; getHtml/getCss
 * funcionam; scripts (os-script) e on* voltam iguais ao salvar e nunca rodam no
 * canvas; widgets aparecem no estado final sem executar; nada é baixado da
 * internet pelo canvas; e nenhum erro no console.
 */
import path from "node:path";
import * as cheerio from "cheerio";
import { build, type Plugin } from "esbuild";
import type { Editor } from "grapesjs";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OsBlock } from "@/editor/blocks";
import { finalizeFromEditor, prepareForEditor } from "@/lib/editor-html";
import { renderPageHtml } from "@/lib/page-render";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** HTML com os atributos em ordem alfabética. */
function sortedAttrs(html: string) {
  const $ = cheerio.load(html, null, false);
  $("*").each((_, el) => {
    if (!("attribs" in el)) return;
    el.attribs = Object.fromEntries(Object.entries(el.attribs).sort(([a], [b]) => a.localeCompare(b)));
  });
  return $.html();
}

const ORIGIN = "http://editor.test";
const OFFER_ID = "ofertasmoke0000000001";

const ENTRY = `
import { createEditor, DEVICES, SECTORS } from "@/editor/grapes/setup";
import { registerDynamicTraits } from "@/editor/grapes/components";
import { setWidgetContext } from "@/editor/widgets";
import { ALL_BLOCKS, BLOCK_CATEGORIES } from "@/editor/blocks";
import { configureAssets } from "@/editor/grapes/assets";
import { configureVideoUpload } from "@/editor/grapes/video-upload";
import { VIDEO_PICK_COMMAND } from "@/editor/widgets/video";
import { installEditorSync } from "@/lib/find-replace";

const ids = ["canvas", "blocks", "layers", "selectors", "styles", "traits"];

/** Mesma montagem do editor-app.tsx. */
function boot(opts) {
  return new Promise((resolve) => {
    const [canvas, blocks, layers, selectors, styles, traits] = ids.map((id) => {
      const el = document.getElementById(id);
      el.innerHTML = "";
      return el;
    });
    if (window.ed) {
      for (const dispose of window.disposers) dispose();
      window.ed.destroy();
    }
    const ed = createEditor({ canvas, blocks, layers, selectors, styles, traits }, opts.project ?? null);
    const data = () => ({ links: opts.links ?? [], pages: opts.pages ?? [] });
    registerDynamicTraits(ed, data);
    setWidgetContext(ed, data);
    window.disposers = [configureAssets(ed, opts.offerId), configureVideoUpload(ed, opts.offerId), installEditorSync(ed)];
    window.ed = ed;
    ed.on("load", () => {
      if (!opts.project && opts.html) {
        ed.setComponents(opts.html, { asDocument: true });
        ed.UndoManager.clear();
      }
      resolve(true);
    });
  });
}

window.OS = { boot, ALL_BLOCKS, BLOCK_CATEGORIES, SECTORS, DEVICES, VIDEO_PICK_COMMAND };
`;

/** O GrapesJS vem do grapes.min.js (window.grapesjs), não do bundle. */
const grapesGlobal: Plugin = {
  name: "grapesjs-global",
  setup(b) {
    b.onResolve({ filter: /^grapesjs$/ }, () => ({ path: "grapesjs", namespace: "global" }));
    b.onLoad({ filter: /.*/, namespace: "global" }, () => ({
      contents: "export default window.grapesjs;",
      loader: "js",
    }));
  },
};

/** Toasts (sonner) só anotados numa lista: o teste não tem React. */
const sonnerStub: Plugin = {
  name: "sonner-stub",
  setup(b) {
    b.onResolve({ filter: /^sonner$/ }, () => ({ path: "sonner", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: `
        const calls = (window.__toasts = []);
        const rec = (type) => (message, opts) => { calls.push({ type, message }); return (opts && opts.id) || calls.length; };
        export const toast = Object.assign(rec("default"), { success: rec("success"), error: rec("error"), warning: rec("warning"), info: rec("info"), loading: rec("loading"), dismiss: () => {} });
      `,
      loader: "js",
    }));
  },
};

interface SmokeWindow {
  ed: Editor;
  __toasts: { type: string; message: string }[];
  OS: {
    boot: (opts: {
      offerId: string;
      links?: { key: string; label: string; kind?: string }[];
      pages?: { id: string; name: string; slug?: string; type?: string }[];
      html?: string;
      project?: unknown;
    }) => Promise<boolean>;
    ALL_BLOCKS: OsBlock[];
    BLOCK_CATEGORIES: Record<string, string>;
    SECTORS: { id: string; name: string }[];
    DEVICES: readonly { id: string; name: string }[];
    VIDEO_PICK_COMMAND: string;
  };
}

const LINKS = [
  { key: "checkout", label: "Checkout principal", kind: "CHECKOUT" },
  { key: "whatsapp", label: "WhatsApp", kind: "WHATSAPP" },
];
const PAGES = [
  { id: "pagina0000000000000001", name: "Página de vendas", slug: "vendas", type: "SALES" },
  { id: "pagina0000000000000002", name: "Termos de uso", slug: "termos", type: "LEGAL" },
  { id: "pagina0000000000000003", name: "Política de privacidade", slug: "privacidade", type: "LEGAL" },
];

let browser: Browser;
let bundle: string;

beforeAll(async () => {
  const out = await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "ts", sourcefile: "smoke-entry.ts" },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    write: false,
    logLevel: "silent",
    tsconfig: path.join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    // O cheerio só é usado no servidor (carregado sob demanda).
    external: ["cheerio"],
    plugins: [grapesGlobal, sonnerStub],
  });
  bundle = out.outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

interface Session {
  page: Page;
  /** Erros de console e exceções da página (painel e canvas). */
  errors: string[];
  /** Pedidos para fora do endereço de teste (o canvas não pode baixar nada da internet). */
  external: string[];
}

async function open(opts: { html?: string; project?: unknown } = {}): Promise<Session> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors: string[] = [];
  const external: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url === `${ORIGIN}/`) {
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Editor</title></head>
<body style="margin:0;display:flex">
  <div id="blocks" style="width:260px"></div><div id="layers" style="width:200px"></div>
  <div id="canvas" style="flex:1;height:900px"></div>
  <div style="width:300px"><div id="selectors"></div><div id="styles"></div><div id="traits"></div></div>
</body></html>`,
      });
    }
    if (url.startsWith(`${ORIGIN}/api/offers/${OFFER_ID}/assets`)) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [] }) });
    }
    if (url.startsWith(ORIGIN) || url.startsWith("data:") || url.startsWith("blob:")) {
      return route.fulfill({ status: 204, body: "" });
    }
    external.push(url);
    return route.abort();
  });
  await page.goto(`${ORIGIN}/`);
  await page.addStyleTag({ path: path.join(ROOT, "node_modules/grapesjs/dist/css/grapes.min.css") });
  await page.addScriptTag({ path: path.join(ROOT, "node_modules/grapesjs/dist/grapes.min.js") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((o) => (window as unknown as SmokeWindow).OS.boot(o), {
    offerId: OFFER_ID,
    links: LINKS,
    pages: PAGES,
    ...opts,
  });
  return { page, errors, external };
}

/** Adiciona cada bloco no fim da página; devolve os blocos que falharam (com o erro). */
async function addAllBlocks(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as SmokeWindow;
    const failures: { id: string; error: string }[] = [];
    const added: { id: string; cid: string; inCanvas: boolean; type: string }[] = [];
    const canvasDoc = w.ed.Canvas.getDocument();
    for (const block of w.OS.ALL_BLOCKS) {
      try {
        const def = w.ed.Blocks.get(block.id)?.get("content");
        if (!def) throw new Error("bloco não registrado");
        const [component] = w.ed.getWrapper()?.append(def as never) ?? [];
        if (!component) throw new Error("nada foi adicionado");
        const el = component.getEl();
        added.push({
          id: block.id,
          cid: component.getId(),
          inCanvas: Boolean(el?.isConnected && el.ownerDocument === canvasDoc),
          type: String(component.get("type")),
        });
      } catch (err) {
        failures.push({ id: block.id, error: String(err) });
      }
    }
    return { failures, added };
  });
}

describe("editor montado como no app", () => {
  let s: Session;

  beforeAll(async () => {
    s = await open();
  }, 60_000);
  afterAll(() => s?.page.close());

  it("registra todos os blocos (em português, por categoria), tipos, seções e comandos", async () => {
    const info = await s.page.evaluate(() => {
      const w = window as unknown as SmokeWindow;
      const ed = w.ed;
      const types = ed.DomComponents.getTypes().map((t) => t.id);
      return {
        expected: w.OS.ALL_BLOCKS.map((b) => b.id),
        registered: ed.Blocks.getAll().map((b: { getId: () => string }) => b.getId()),
        rendered: document.querySelectorAll("#blocks .gjs-block").length,
        categories: [...document.querySelectorAll("#blocks .gjs-block-category .gjs-title")].map((e) =>
          (e.textContent ?? "").trim(),
        ),
        allCategories: Object.values(w.OS.BLOCK_CATEGORIES),
        types,
        sectors: ed.StyleManager.getSectors().map((sec: { getId: () => string }) => sec.getId()),
        expectedSectors: w.OS.SECTORS.map((sec) => sec.id),
        expectedSectorNames: w.OS.SECTORS.map((sec) => sec.name),
        sectorNames: [...document.querySelectorAll("#styles .gjs-sm-sector-title")].map((e) =>
          (e.textContent ?? "").trim(),
        ),
        devices: ed.Devices.getDevices().map((d) => d.getName()),
        videoCommand: ed.Commands.has(w.OS.VIDEO_PICK_COMMAND),
        locale: ed.I18n.getLocale(),
      };
    });
    expect(info.expected.length).toBeGreaterThanOrEqual(40);
    expect(new Set(info.expected).size).toBe(info.expected.length);
    expect(info.registered).toEqual(info.expected);
    expect(info.rendered).toBe(info.expected.length);
    expect([...info.categories].sort()).toEqual([...info.allCategories].sort());
    for (const type of [
      "os-script",
      "os-embed",
      "os-vturb",
      "os-video",
      "os-button",
      "os-countdown",
      "os-scarcity",
      "os-sales-notification",
      "os-exit-popup",
      "os-lead-form",
      "os-whatsapp",
      "os-video-embed",
      "os-vturb-player",
      "os-video-file",
    ]) {
      expect(info.types).toContain(type);
    }
    expect(info.sectors).toEqual(info.expectedSectors);
    expect(info.sectorNames).toEqual(info.expectedSectorNames);
    expect(info.devices).toEqual(["Computador", "Tablet", "Celular"]);
    expect(info.videoCommand).toBe(true);
    expect(info.locale).toBe("pt");
    expect(s.errors).toEqual([]);
  });

  it("adiciona cada bloco no canvas e exporta HTML/CSS", async () => {
    const { failures, added } = await addAllBlocks(s.page);
    expect(failures).toEqual([]);
    expect(added.filter((a) => !a.inCanvas).map((a) => a.id)).toEqual([]);

    const out = await s.page.evaluate(() => {
      const ed = (window as unknown as SmokeWindow).ed;
      return {
        html: ed.getHtml({ asDocument: true } as never),
        bodyHtml: ed.getHtml(),
        css: ed.getCss({ avoidProtected: true }) ?? "",
        project: JSON.stringify(ed.getProjectData()),
      };
    });
    expect(out.bodyHtml.length).toBeGreaterThan(10_000);
    expect(out.css).toContain("@media (max-width: 480px)");
    for (const widget of [
      "countdown",
      "scarcity",
      "sales-notification",
      "exit-popup",
      "lead-form",
      "whatsapp",
      "vturb",
    ]) {
      expect(out.bodyHtml).toContain(`data-os-widget="${widget}"`);
    }
    // Contexto dos widgets: o botão do checkout e o WhatsApp se ligam sozinhos aos links da oferta.
    expect(out.bodyHtml).toContain('data-os-link="checkout"');
    expect(out.bodyHtml).toContain('data-os-link="whatsapp"');
    // Rodapé com políticas: links para as páginas legais do funil.
    expect(out.bodyHtml).toContain(`href="os-page:${PAGES[1].id}"`);
    expect(out.bodyHtml).toContain(`href="os-page:${PAGES[2].id}"`);

    // Mesmo caminho do salvamento e da prévia: HTML final com o script das páginas.
    const doc = /<html/i.test(out.html)
      ? out.html
      : `<!doctype html><html><head></head><body>${out.html}</body></html>`;
    const final = renderPageHtml(finalizeFromEditor(doc, out.css), {
      links: [{ key: "checkout", url: "https://pay.exemplo.com/abc" }],
      pageHref: (id) => `/p/${id}`,
      runtimeTag: '<script src="/os-runtime.js" data-os-runtime></script>',
      customCode: { head: '<meta name="os-smoke" content="1">' },
    });
    expect(final).toContain('href="https://pay.exemplo.com/abc"');
    expect(final).toContain(`href="/p/${PAGES[1].id}"`);
    expect(final).toContain('<meta name="os-smoke" content="1">');
    expect(final).toContain("data-os-runtime");

    // Reabrir pelo projeto salvo devolve o mesmo HTML (tipos dos widgets registrados antes do projeto).
    const reopened = await open({ project: JSON.parse(out.project) });
    try {
      const again = await reopened.page.evaluate(() => (window as unknown as SmokeWindow).ed.getHtml());
      // O GrapesJS pode trocar id/class de lugar: compara com os atributos em ordem.
      expect(sortedAttrs(again)).toBe(sortedAttrs(out.bodyHtml));
      expect(reopened.errors).toEqual([]);
    } finally {
      await reopened.page.close();
    }
    expect(s.errors).toEqual([]);
  });

  it("widgets aparecem no estado final e não executam no canvas", async () => {
    const snapshot = () =>
      s.page.evaluate(() => {
        const ed = (window as unknown as SmokeWindow).ed;
        const doc = ed.Canvas.getDocument() as Document;
        const win = ed.Canvas.getWindow() as Window & { __osRuntime?: boolean; __osCloneCompat?: boolean };
        const q = (sel: string) => doc.querySelector<HTMLElement>(sel);
        const shown = (el: HTMLElement | null) => Boolean(el && win.getComputedStyle(el).display !== "none");
        const popup = q('[data-os-widget="exit-popup"]');
        const note = q('[data-os-widget="sales-notification"]');
        return {
          countdown: q('[data-os-widget="countdown"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
          popupShown: shown(popup),
          popupLabel: popup ? win.getComputedStyle(popup, "::before").content : "",
          noteShown: shown(note),
          noteLabel: note ? win.getComputedStyle(note, "::before").content : "",
          scripts: doc.querySelectorAll("script").length,
          iframes: doc.querySelectorAll("iframe").length,
          runtime: Boolean(win.__osRuntime || win.__osCloneCompat),
          formAction: q('form[data-os-widget="lead-form"]')?.getAttribute("action") ?? null,
        };
      });
    const before = await snapshot();
    await s.page.waitForTimeout(1500);
    const after = await snapshot();

    expect(before.countdown).toMatch(/\d/);
    // Nada roda no canvas: o contador não anda.
    expect(after.countdown).toBe(before.countdown);
    expect(after.popupShown).toBe(true);
    expect(after.popupLabel).toContain("Popup de saída (aparece ao sair)");
    expect(after.noteShown).toBe(true);
    expect(after.noteLabel).toContain("Notificação de compra");
    expect(after.scripts).toBe(0);
    // Vídeos (YouTube, Vimeo, Panda) aparecem como marcadores, sem iframe de verdade no canvas.
    expect(after.iframes).toBe(0);
    expect(after.runtime).toBe(false);
    expect(s.external).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it("Configurações e Classes/Estado aparecem para o elemento selecionado", async () => {
    const info = await s.page.evaluate(() => {
      const ed = (window as unknown as SmokeWindow).ed;
      const wrapper = ed.getWrapper();
      const labels = () =>
        [...document.querySelectorAll("#traits .gjs-trt-trait .gjs-label")].map((e) => (e.textContent ?? "").trim());
      const pick = (sel: string) => {
        const comp = wrapper?.find(sel)[0];
        if (!comp) throw new Error(`não achei ${sel}`);
        ed.select(comp);
        return labels();
      };
      return {
        countdown: pick('[data-os-widget="countdown"]'),
        whatsapp: pick('a[data-os-widget="whatsapp"]'),
        checkout: pick('a[data-os-link="checkout"]'),
        // Um painel só (o GrapesJS 0.23.6 desenha dois; createEditor remove a cópia).
        selectors: document.querySelectorAll("#selectors .gjs-clm-tags").length,
        states: [...document.querySelectorAll("#selectors select option")].map((o) => (o.textContent ?? "").trim()),
      };
    });
    expect(info.countdown.length).toBeGreaterThan(2);
    expect(info.checkout).toContain("Link da oferta");
    expect(info.checkout).toContain("Página do funil");
    // O WhatsApp sempre abre o WhatsApp: sem "Página do funil".
    expect(info.whatsapp).not.toContain("Página do funil");
    expect(info.selectors).toBe(1);
    expect(info.states).toContain("Ao passar o mouse");
    expect(s.errors).toEqual([]);
  });
});

describe("scripts e on* (os-script)", () => {
  const ORIGINAL = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Clone</title>
<script>window.__headRan = 1;</script></head><body>
<h1 id="titulo">Oferta</h1>
<button id="comprar" onclick="window.__clicked = 1">Comprar</button>
<script data-teste="sim">window.__bodyRan = 1; if (1 < 2 && 3 > 2) { document.title = "rodou"; }</script>
</body></html>`;

  it("voltam iguais ao salvar e nunca rodam no canvas", async () => {
    const prepared = prepareForEditor(ORIGINAL);
    const s = await open({ html: prepared.html });
    try {
      const canvas = await s.page.evaluate(() => {
        const ed = (window as unknown as SmokeWindow).ed;
        const win = ed.Canvas.getWindow() as Window & { __headRan?: number; __bodyRan?: number; __clicked?: number };
        const doc = ed.Canvas.getDocument() as Document;
        doc.getElementById("comprar")?.click();
        const osScripts = ed.getWrapper()?.find("os-script") ?? [];
        return {
          ran: Boolean(win.__headRan || win.__bodyRan || win.__clicked),
          title: doc.title,
          scripts: doc.querySelectorAll("script").length,
          osScripts: osScripts.length,
          osScriptVisible: osScripts.some((c) => {
            const el = c.getEl();
            return Boolean(el && win.getComputedStyle(el).display !== "none");
          }),
          layerable: osScripts.some((c) => c.get("layerable") !== false),
          html: ed.getHtml({ asDocument: true } as never),
          css: ed.getCss({ avoidProtected: true }) ?? "",
        };
      });
      expect(canvas.ran).toBe(false);
      expect(canvas.title).not.toBe("rodou");
      expect(canvas.scripts).toBe(0);
      expect(canvas.osScripts).toBeGreaterThanOrEqual(1);
      expect(canvas.osScriptVisible).toBe(false);
      expect(canvas.layerable).toBe(false);
      expect(canvas.html).not.toMatch(/<script/i);
      expect(canvas.html).toContain("data-os-on-click");

      const final = finalizeFromEditor(canvas.html, canvas.css);
      expect(final).toContain(
        '<script data-teste="sim">window.__bodyRan = 1; if (1 < 2 && 3 > 2) { document.title = "rodou"; }</script>',
      );
      expect(final).toContain('onclick="window.__clicked = 1"');
      expect(final).not.toContain("data-os-on-click");
      expect(final).not.toContain("os-script");
      expect(s.errors).toEqual([]);
      expect(s.external).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});
