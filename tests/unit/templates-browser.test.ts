/**
 * Modelos de página no navegador de verdade (Chromium):
 * - a página publicada (com o script do Offer Studio) abre no celular (375px),
 *   no tablet e no computador sem rolagem lateral, sem erros no console e sem
 *   nenhum pedido de rede (tudo embutido);
 * - abrir no editor GrapesJS (configuração real do Offer Studio) e salvar de
 *   volta não perde texto nem ganchos, e os widgets aparecem no canvas no estado
 *   final (popup como caixa com rótulo, notificação como cartão, dados a trocar
 *   destacados).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type { Element as DomElement } from "domhandler";
import { buildSync } from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAGE_TEMPLATES } from "@/editor/templates";
import { finalizeFromEditor } from "@/lib/editor-html";
import { renderPageHtml } from "@/lib/page-render";
import { runtimeScript } from "@/lib/runtime-bundle";
import { getObject, mimeFromKey } from "@/lib/storage";
import { htmlForEditor } from "@/server/services/documents";
import { templateHtml } from "@/server/services/page-templates";

const NOW = new Date("2026-09-29T15:00:00Z");
const ROOT = process.cwd();

let browser: Browser;
let editorBundle = "";
let grapesCss = "";

beforeAll(async () => {
  browser = await chromium.launch();
  // O editor de verdade (createEditor com os tipos e blocos do Offer Studio), para o navegador.
  const built = buildSync({
    stdin: {
      contents:
        'import { createEditor } from "@/editor/grapes/setup";\n(window as unknown as { __osCreateEditor: typeof createEditor }).__osCreateEditor = createEditor;',
      resolveDir: ROOT,
      loader: "ts",
      sourcefile: "editor-entry.ts",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    write: false,
    tsconfig: path.join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "empty" },
    logLevel: "silent",
  });
  editorBundle = built.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  grapesCss = readFileSync(path.join(ROOT, "node_modules/grapesjs/dist/css/grapes.min.css"), "utf8");
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

const cases = PAGE_TEMPLATES.map((t) => [t.id, templateHtml(t.id, t.pageName, NOW)] as [string, string]);

/** Página publicada: links do funil resolvidos e o script do Offer Studio embutido (como no ZIP). */
function published(html: string) {
  return renderPageHtml(html, {
    links: [],
    pageHref: (id) => `/p/${id}`,
    runtimeTag: `<script data-os-runtime>${runtimeScript()}</script>`,
  });
}

/** Abre o HTML num navegador sem rede: qualquer pedido que não seja a própria página é bloqueado e anotado. */
async function openOffline(html: string, width: number, height = 812) {
  const page = await browser.newPage({ viewport: { width, height } });
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`erro: ${e.message}`));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url === "http://pagina.test/") {
      return route.fulfill({ body: html, contentType: "text/html; charset=utf-8" });
    }
    problems.push(`rede: ${url}`);
    return route.abort();
  });
  await page.goto("http://pagina.test/", { waitUntil: "load" });
  return { page, problems };
}

async function layoutReport(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const outside: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (r.right > width + 1 || r.left < -1) {
        outside.push(
          `${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""} (${Math.round(r.left)}→${Math.round(r.right)})`,
        );
      }
    }
    const brokenImages = Array.from(document.images)
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map((img) => img.alt || img.src.slice(0, 40));
    return { width, scrollWidth: document.documentElement.scrollWidth, outside: outside.slice(0, 10), brokenImages };
  });
}

describe.each(cases)("modelo %s publicado", (id, html) => {
  it("abre no celular (375px) sem rolagem lateral, sem erros e sem acessar a rede", async () => {
    const { page, problems } = await openOffline(published(html), 375);
    try {
      const report = await layoutReport(page);
      expect(report.scrollWidth, id).toBeLessThanOrEqual(375);
      expect(report.outside, id).toEqual([]);
      expect(report.brokenImages, id).toEqual([]);

      const state = await page.evaluate(() => {
        // Visível para o visitante (o script pode usar hidden, display ou opacidade).
        const visible = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const cs = getComputedStyle(el);
          return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0;
        };
        return {
          popup: visible('[data-os-widget="exit-popup"]'),
          notification: visible('[data-os-widget="sales-notification"]'),
          digits: Array.from(document.querySelectorAll("[data-os-cd]")).map((n) => n.textContent ?? ""),
          h1: getComputedStyle(document.querySelector("h1") as HTMLElement).fontSize,
        };
      });
      // Popup e notificação ficam escondidos até o script abrir.
      if (state.popup !== null) expect(state.popup).toBe(false);
      if (state.notification !== null) expect(state.notification).toBe(false);
      for (const d of state.digits) expect(d).toMatch(/^\d{2}$/);
      expect(Number.parseFloat(state.h1)).toBeGreaterThanOrEqual(26);
      // Dá tempo para qualquer script terminar antes de conferir os erros.
      await page.waitForTimeout(150);
      expect(problems, id).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it.each([768, 1280])("sem rolagem lateral em %ipx", async (width) => {
    const { page, problems } = await openOffline(published(html), width, 900);
    try {
      const report = await layoutReport(page);
      expect(report.scrollWidth, `${id} @${width}`).toBeLessThanOrEqual(width);
      expect(report.outside, `${id} @${width}`).toEqual([]);
      expect(problems, id).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

// ─── Editor ──────────────────────────────────────────────────────────────────

interface EditorLike {
  on(event: string, cb: () => void): void;
  setComponents(html: string, opts: { asDocument: boolean }): void;
  getHtml(opts: { asDocument: boolean }): string;
  getCss(opts: { avoidProtected: boolean }): string | undefined;
  Canvas: { getDocument(): Document };
}

interface CanvasResult {
  html: string;
  css: string;
  popup: { display: string; label: string } | null;
  notification: { display: string; label: string } | null;
  placeholder: string | null;
  videoTag: string | null;
}

/** Abre o documento (já convertido por htmlForEditor) no GrapesJS e devolve o que o editor salvaria. */
async function roundTripInEditor(editorHtml: string) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.host !== "editor.test") return route.abort();
    if (url.pathname === "/") {
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html><head><style>${grapesCss}</style></head><body style="margin:0"><div style="width:1400px;height:900px"><div id="canvas"></div></div><div hidden><div id="blocks"></div><div id="layers"></div><div id="styles"></div><div id="traits"></div></div><script>${editorBundle}</script></body></html>`,
      });
    }
    if (url.pathname.startsWith("/os-assets/")) {
      const file = url.pathname.slice("/os-assets/".length);
      const key = `a/${file.slice(0, 2)}/${file}`;
      try {
        return route.fulfill({ body: await getObject(key), contentType: mimeFromKey(key) });
      } catch {
        return route.fulfill({ status: 404, body: "" });
      }
    }
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("http://editor.test/", { waitUntil: "load" });
  try {
    const result = await page.evaluate(async (docHtml): Promise<CanvasResult> => {
      const create = (
        window as unknown as { __osCreateEditor: (c: Record<string, HTMLElement>, p: null) => EditorLike }
      ).__osCreateEditor;
      const byId = (id: string) => document.getElementById(id) as HTMLElement;
      const ed = create(
        {
          canvas: byId("canvas"),
          blocks: byId("blocks"),
          layers: byId("layers"),
          styles: byId("styles"),
          traits: byId("traits"),
        },
        null,
      );
      await new Promise<void>((resolve) => ed.on("load", () => resolve()));
      ed.setComponents(docHtml, { asDocument: true });
      const doc = ed.Canvas.getDocument();
      // Espera a folha base (em camada) carregar dentro do canvas.
      for (let i = 0; i < 100; i++) {
        const probe = doc.querySelector(".os-container");
        if (probe && doc.defaultView?.getComputedStyle(probe).maxWidth !== "none") break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const view = doc.defaultView as Window;
      const widget = (sel: string) => {
        const el = doc.querySelector(sel);
        return el
          ? { display: view.getComputedStyle(el).display, label: view.getComputedStyle(el, "::before").content }
          : null;
      };
      const ph = doc.querySelector(".os-ph");
      const video = doc.querySelector(".os-video");
      return {
        html: ed.getHtml({ asDocument: true }),
        css: ed.getCss({ avoidProtected: true }) ?? "",
        popup: widget('[data-os-widget="exit-popup"]'),
        notification: widget('[data-os-widget="sales-notification"]'),
        placeholder: ph ? view.getComputedStyle(ph).backgroundColor : null,
        videoTag: video?.firstElementChild?.tagName ?? null,
      };
    }, editorHtml);
    return { result, errors };
  } finally {
    await page.close();
  }
}

/**
 * Texto do <body> sem espaços: o editor descarta os espaços entre blocos (só
 * formatação do HTML), mas nenhuma palavra pode sumir nem mudar.
 */
function bodyText(html: string) {
  return cheerio.load(html)("body").text().replace(/\s+/g, "");
}

function bodyHooks(html: string) {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $("body *").each((_, el) => {
    const e = el as DomElement;
    for (const [name, value] of Object.entries(e.attribs ?? {})) {
      if (name.startsWith("data-os-") || name === "hidden" || name === "href" || name === "name" || name === "type") {
        out.push(`${e.tagName}[${name}=${value}]`);
      }
    }
  });
  return out.sort();
}

function tagCounts(html: string) {
  const $ = cheerio.load(html);
  const counts: Record<string, number> = {};
  for (const tag of [
    "a",
    "img",
    "form",
    "input",
    "button",
    "details",
    "summary",
    "iframe",
    "h1",
    "h2",
    "h3",
    "li",
    "p",
    "section",
  ]) {
    counts[tag] = $(`body ${tag}`).length;
  }
  return counts;
}

describe.each(cases)("modelo %s no editor", (id, html) => {
  it("abre no GrapesJS e volta sem perder texto, ganchos nem elementos", async () => {
    const editorHtml = await htmlForEditor(html);
    const { result, errors } = await roundTripInEditor(editorHtml);
    expect(errors, id).toEqual([]);

    const saved = finalizeFromEditor(result.html, result.css);
    const $saved = cheerio.load(saved);
    expect(bodyText(saved)).toBe(bodyText(html));
    expect(bodyHooks(saved)).toEqual(bodyHooks(html));
    expect(tagCounts(saved)).toEqual(tagCounts(html));
    expect($saved("title").text()).toBe(cheerio.load(html)("title").text());
    expect($saved('meta[name="viewport"]')).toHaveLength(1);
    // Os estilos do modelo continuam na folha base: o editor não criou regras por id.
    expect(result.css).not.toMatch(/#[a-z][\w-]*\s*\{/i);
    expect($saved("[style]")).toHaveLength(0);

    // No canvas, os widgets aparecem no estado final e os dados a trocar ficam destacados.
    if (result.popup) {
      expect(result.popup.display).toBe("block");
      expect(result.popup.label).toBe('"Popup de saída (aparece ao sair)"');
    }
    if (result.notification) {
      expect(result.notification.display).toBe("block");
      expect(result.notification.label).toMatch(/Notificação de (prova social|compra) \(aparece no canto da tela\)/);
    }
    if (result.placeholder) expect(result.placeholder).toBe("rgb(254, 240, 138)");
    if (id === "vsl") expect(result.videoTag).not.toBe("IFRAME");
  }, 60_000);
});
