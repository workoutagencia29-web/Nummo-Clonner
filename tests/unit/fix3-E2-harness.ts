/**
 * Harness dos testes fix3-E2-*: o editor montado como no editor-app.tsx, num
 * Chromium de verdade, com o mesmo layout do painel (esquerda 288px, direita
 * 320px, CSS do GrapesJS + editor.css) e a mesma ordem de abertura:
 * createEditor → registerDynamicTraits/setWidgetContext → no "load",
 * setComponents(html, { asDocument: true }) na primeira abertura.
 *
 * Arquivos /os-assets/* vêm de `files` (CSS original das páginas).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build, type Plugin } from "esbuild";
import type { Editor } from "grapesjs";
import type { Browser, Page } from "playwright";
import type { OsBlock } from "@/editor/blocks";
import type { registerDynamicTraits } from "@/editor/grapes/components";
import type { createEditor, DEVICES } from "@/editor/grapes/setup";
import type { setWidgetContext } from "@/editor/widgets";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const ORIGIN = "http://editor.test";

export interface E2Window {
  ed: Editor;
  __toasts: { type: string; message: string }[];
  pageErrors: string[];
  OS: {
    createEditor: typeof createEditor;
    registerDynamicTraits: typeof registerDynamicTraits;
    setWidgetContext: typeof setWidgetContext;
    DEVICES: typeof DEVICES;
    ALL_BLOCKS: OsBlock[];
    boot(opts: BootOptions): Promise<void>;
  };
}

export interface BootOptions {
  html?: string;
  project?: unknown;
  links?: { key: string; label: string; url?: string; kind?: string }[];
  pages?: { id: string; name: string }[];
  device?: string;
}

const ENTRY = `
import { createEditor, DEVICES } from "@/editor/grapes/setup";
import { registerDynamicTraits } from "@/editor/grapes/components";
import { setWidgetContext } from "@/editor/widgets";
import { ALL_BLOCKS } from "@/editor/blocks";

function boot(opts) {
  return new Promise((resolve) => {
    const el = (id) => document.getElementById(id);
    const ed = createEditor(
      { canvas: el("canvas"), blocks: el("blocks"), layers: el("layers"), selectors: el("selectors"), styles: el("styles"), traits: el("traits") },
      opts.project ?? null,
    );
    window.ed = ed;
    const data = () => ({ links: opts.links ?? [], pages: opts.pages ?? [] });
    registerDynamicTraits(ed, data);
    setWidgetContext(ed, data);
    ed.on("load", () => {
      if (!opts.project && opts.html) {
        ed.setComponents(opts.html, { asDocument: true });
        ed.UndoManager.clear();
      }
      ed.setDevice(opts.device ?? "desktop");
      resolve();
    });
  });
}

window.OS = { createEditor, registerDynamicTraits, setWidgetContext, DEVICES, ALL_BLOCKS, boot };
`;

/** Toasts (sonner) só anotados numa lista: o teste não tem React. */
const sonnerStub: Plugin = {
  name: "sonner-stub",
  setup(b) {
    b.onResolve({ filter: /^sonner$/ }, () => ({ path: "sonner", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: `
        const calls = (window.__toasts = window.__toasts || []);
        const rec = (type) => (message, opts) => { calls.push({ type, message: String(message) }); return (opts && opts.id) || calls.length; };
        export const toast = Object.assign(rec("default"), { success: rec("success"), error: rec("error"), warning: rec("warning"), info: rec("info"), loading: rec("loading"), dismiss: () => {} });
      `,
      loader: "js",
    }));
  },
};

let shell: Promise<string> | null = null;

/** HTML do painel (layout do editor-app) com o editor compilado. */
function appShell(): Promise<string> {
  shell ??= (async () => {
    const out = await build({
      stdin: { contents: ENTRY, resolveDir: ROOT, loader: "ts", sourcefile: "fix3-e2-entry.ts" },
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2020",
      write: false,
      logLevel: "silent",
      tsconfig: path.join(ROOT, "tsconfig.json"),
      define: { "process.env.NODE_ENV": '"production"' },
      external: ["cheerio"],
      plugins: [sonnerStub],
    });
    const js = out.outputFiles[0].text;
    const grapesCss = await readFile(path.join(ROOT, "node_modules/grapesjs/dist/css/grapes.min.css"), "utf8");
    const editorCss = await readFile(path.join(ROOT, "src/editor/grapes/editor.css"), "utf8");
    const globals = await readFile(path.join(ROOT, "src/app/globals.css"), "utf8");
    const tokens = /:root \{\n {2}--radius[\s\S]*?\n\}/.exec(globals)?.[0] ?? "";
    return `<!doctype html><html lang="pt-BR" class="light"><head><meta charset="utf-8"><title>Editor</title>
<style>${tokens}</style><style>${grapesCss}</style><style>${editorCss}</style>
<style>html,body{margin:0;height:100%}</style></head>
<body class="os-editor">
<div style="display:flex;height:100vh">
  <aside class="os-panel" style="width:288px;flex-shrink:0;overflow:auto"><div id="blocks"></div><div id="layers"></div></aside>
  <main id="main" style="position:relative;flex:1;min-width:0"><div id="canvas" style="height:100%"></div></main>
  <aside class="os-panel" style="width:320px;flex-shrink:0;overflow:auto"><div id="selectors"></div><div id="styles"></div><div id="traits"></div></aside>
</div>
<script>window.pageErrors = []; window.addEventListener("error", (e) => window.pageErrors.push(String(e.message)));</script>
<script>${js}</script></body></html>`;
  })();
  return shell;
}

export interface AppSession {
  page: Page;
  /** Erros do console e exceções (painel e canvas). */
  errors: string[];
  /** Pedidos para fora do endereço de teste. */
  external: string[];
}

/** Abre o painel com o editor, como o editor-app. */
export async function openApp(
  browser: Browser,
  opts: BootOptions & { files?: Record<string, string>; viewport?: { width: number; height: number } } = {},
): Promise<AppSession> {
  const { files = {}, viewport = { width: 1280, height: 800 }, ...boot } = opts;
  const page = await browser.newPage({ viewport });
  const errors: string[] = [];
  const external: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  const html = await appShell();
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url === `${ORIGIN}/`) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    if (url.startsWith(ORIGIN)) {
      const file = files[new URL(url).pathname];
      if (file !== undefined) return route.fulfill({ contentType: "text/css; charset=utf-8", body: file });
      return route.fulfill({ status: 204, body: "" });
    }
    if (url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    external.push(url);
    return route.abort();
  });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate((o) => (window as unknown as E2Window).OS.boot(o), boot);
  // Canvas ajustado ao dispositivo (o GrapesJS anima a moldura por 350ms e só
  // depois volta a mostrar a barra do elemento selecionado).
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const ed = (window as unknown as E2Window).ed;
        // Espera a moldura ficar parada (sem "frame:updated") por 400ms.
        let timer = setTimeout(done, 400);
        function onUpdate() {
          clearTimeout(timer);
          timer = setTimeout(done, 400);
        }
        function done() {
          ed.off("frame:updated", onUpdate);
          resolve();
        }
        ed.on("frame:updated", onUpdate);
      }),
  );
  // Folhas de estilo do canvas (folha base e @import) carregadas.
  await page.waitForFunction(() => {
    const doc = (window as unknown as E2Window).ed.Canvas.getDocument();
    return Array.from(doc?.querySelectorAll("link[rel=stylesheet]") ?? []).every((l) =>
      Boolean((l as HTMLLinkElement).sheet),
    );
  });
  return { page, errors, external };
}

/** Folha base como o documents.ts gera (CSS original numa camada). */
export function baseSheet(hrefs: string[]) {
  return `@layer os-fix, os-original;\n${hrefs.map((h) => `@import url("${h}") layer(os-original);`).join("\n")}\n`;
}

/** HTML de página já preparada (como htmlForEditor devolve) com a folha base. */
export function pageWithBase(body: string, baseHref = "/os-assets/base.css") {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${baseHref}" data-os-base><title>Página</title></head><body>${body}</body></html>`;
}

export function toasts(page: Page) {
  return page.evaluate(() => (window as unknown as E2Window).__toasts ?? []);
}
