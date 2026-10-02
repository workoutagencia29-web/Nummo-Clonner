/**
 * Gerenciador de imagens no editor (src/editor/grapes/assets.ts) num Chromium
 * de verdade: GrapesJS + configureAssets empacotados com esbuild, rotas do
 * painel simuladas e toasts (sonner) anotados numa lista.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build, type Plugin } from "esbuild";
import { type Browser, chromium, type Page, type Request as PwRequest } from "playwright";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ACCEPTED_IMAGES,
  CLIENT_UPLOAD_LIMITS,
  checkFiles,
  formatBytes,
  parseAssetResponse,
} from "@/editor/grapes/assets";
import { IMAGE_UPLOAD_LIMITS } from "@/server/services/assets";

const ORIGIN = "http://editor.test";
const OFFER = "oferta123";

const SONNER_STUB = `
const calls = (window.__toasts = []);
const rec = (type) => (message, opts) => { calls.push({ type, message, description: opts && opts.description }); return (opts && opts.id) || calls.length; };
export const toast = Object.assign(rec("default"), { success: rec("success"), error: rec("error"), warning: rec("warning"), info: rec("info"), loading: rec("loading"), dismiss: () => {} });
`;

const ENTRY = `
import grapesjs from "grapesjs";
import pt from "grapesjs/locale/pt.mjs";
import { configureAssets } from "./src/editor/grapes/assets.ts";
function boot(offerId, html) {
  return new Promise((resolve) => {
    const editor = grapesjs.init({
      container: "#gjs",
      height: "100%",
      telemetry: false,
      storageManager: false,
      panels: { defaults: [] },
      components: html,
      i18n: { locale: "pt", detectLocale: false, messages: { pt } },
      assetManager: { upload: "/api/assets/upload", uploadName: "files", multiUpload: true, autoAdd: true },
    });
    const dispose = configureAssets(editor, offerId);
    Object.assign(window, { editor, dispose });
    editor.on("load", () => resolve(true));
  });
}
Object.assign(window, { boot });
`;

const LIBRARY = [
  {
    type: "image",
    src: `/os-assets/${"a".repeat(64)}.webp`,
    name: "capa-nova.webp",
    width: 1200,
    height: 600,
    bytes: 2048,
  },
  { type: "image", src: `/os-assets/${"b".repeat(64)}.png`, name: "selo.png", bytes: 3 * 1024 * 1024 + 1 },
];
const PAGE_HTML =
  '<section style="padding:120px 40px"><img id="pic" src="/old.png" srcset="/old.png 1x, /old-2x.png 2x" sizes="100vw" alt="Antiga" style="width:240px;height:160px"></section>';

interface ToastCall {
  type: string;
  message: string;
  description?: string;
}
interface UploadReply {
  status: number;
  body: unknown;
}

let browser: Browser;
let bundle: string;
let grapesCss: string;
let png: Buffer;

beforeAll(async () => {
  const stub: Plugin = {
    name: "sonner-stub",
    setup(b) {
      b.onResolve({ filter: /^sonner$/ }, () => ({ path: "sonner", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: SONNER_STUB, loader: "js" }));
    },
  };
  const out = await build({
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: "js", sourcefile: "entry.js" },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    write: false,
    logLevel: "silent",
    plugins: [stub],
  });
  bundle = out.outputFiles[0].text;
  grapesCss = await readFile(path.join(process.cwd(), "node_modules/grapesjs/dist/css/grapes.min.css"), "utf8");
  png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#3498db" } })
    .png()
    .toBuffer();
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

let page: Page;
let listCalls: number;
let uploads: PwRequest[];
let uploadReply: UploadReply;

beforeEach(async () => {
  listCalls = 0;
  uploads = [];
  uploadReply = { status: 200, body: { data: [] } };
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === "/") {
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html><head><meta charset="utf-8"><style>${grapesCss}</style>
<style>:root{--border:#d4d4d8;--input:#d4d4d8;--primary:#2563eb;--primary-foreground:#fff;--muted:#f4f4f5;--muted-foreground:#71717a;--foreground:#18181b;--background:#fff;--card:#fff;--radius:8px}</style>
<style>html,body{height:100%;margin:0}</style>
</head><body><div id="gjs" style="height:100%"></div><script src="/bundle.js"></script></body></html>`,
      });
    }
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === `/api/offers/${OFFER}/assets`) {
      listCalls++;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: LIBRARY }) });
    }
    if (url.pathname === "/api/assets/upload") {
      uploads.push(req);
      return route.fulfill({
        status: uploadReply.status,
        contentType: "application/json",
        body: JSON.stringify(uploadReply.body),
      });
    }
    if (/\.(png|webp|jpe?g|gif|svg)$/.test(url.pathname)) return route.fulfill({ contentType: "image/png", body: png });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(
    ([offer, html]) => (window as unknown as { boot: (o: string, h: string) => Promise<boolean> }).boot(offer, html),
    [OFFER, PAGE_HTML] as const,
  );
});

async function toasts(): Promise<ToastCall[]> {
  return page.evaluate(() => (window as unknown as { __toasts: ToastCall[] }).__toasts);
}

/** Abre o gerenciador como o usuário: duplo clique na imagem da página. */
async function openFromImage() {
  await page.frameLocator("iframe.gjs-frame").locator("#pic").dblclick();
  await page.locator(".gjs-mdl-dialog").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelectorAll(".os-am .gjs-am-asset").length >= 2);
}

async function assetNames() {
  return page.locator(".os-am .gjs-am-asset .gjs-am-name").allTextContents();
}

async function imageAttributes() {
  return page.evaluate((): Record<string, string | undefined> => {
    type Cmp = { getAttributes(): Record<string, string>; get(k: string): unknown };
    const ed = (window as unknown as { editor: { getWrapper(): { find(s: string): Cmp[] } } }).editor;
    const img = ed.getWrapper().find("#pic")[0];
    return { ...img.getAttributes(), src: String(img.get("src")) };
  });
}

describe("configureAssets no navegador", () => {
  it("ao abrir, carrega a biblioteca da oferta em grade, com textos em português", async () => {
    await openFromImage();
    expect(listCalls).toBe(1);
    expect(await assetNames()).toEqual(["capa-nova.webp", "selo.png"]);
    expect(await page.locator(".os-am .gjs-am-dimensions").allTextContents()).toEqual(["1200 × 600 · 2 KB", "3,1 MB"]);
    expect(await page.locator(".gjs-mdl-title").textContent()).toBe("Escolher imagem");
    expect(await page.locator("#gjs-am-title").textContent()).toBe("Arraste imagens para cá ou clique para escolher");
    expect(await page.locator(".os-am-hint").textContent()).toMatch(/^Clique numa imagem para usar/);
    expect(await page.locator("#gjs-am-uploadFile").getAttribute("accept")).toBe(ACCEPTED_IMAGES);
    expect(await page.locator(".os-am .gjs-am-close").count()).toBe(0);
    const columns = await page
      .locator(".os-am .gjs-am-assets")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(columns).toBeGreaterThan(1);

    // Reabrir busca de novo (imagens enviadas em outra aba aparecem).
    await page.locator(".gjs-mdl-btn-close").click();
    await openFromImage();
    expect(listCalls).toBe(2);
    expect(await assetNames()).toEqual(["capa-nova.webp", "selo.png"]);
  });

  it("clicar numa imagem troca a do elemento e tira o srcset antigo", async () => {
    await openFromImage();
    expect((await imageAttributes()).srcset).toContain("old-2x.png");
    await page.locator(".os-am .gjs-am-asset").nth(1).click();
    const attrs = await imageAttributes();
    expect(attrs.src).toBe(LIBRARY[1].src);
    expect(attrs.srcset).toBeUndefined();
    expect(attrs.sizes).toBeUndefined();
  });

  it("enviar uma imagem: manda o offerId, põe no topo e já aplica no elemento", async () => {
    const src = `/os-assets/${"c".repeat(64)}.webp`;
    uploadReply = {
      status: 200,
      body: { data: [{ type: "image", src, name: "nova.png", width: 8, height: 8, bytes: 900 }] },
    };
    await openFromImage();
    await page.locator("#gjs-am-uploadFile").setInputFiles({ name: "nova.png", mimeType: "image/png", buffer: png });
    await page.waitForFunction(() => document.querySelectorAll(".os-am .gjs-am-asset").length === 3);

    expect(uploads).toHaveLength(1);
    const body = uploads[0].postDataBuffer()?.toString("latin1") ?? "";
    expect(body).toMatch(new RegExp(`name="offerId"\\r\\n\\r\\n${OFFER}\\r\\n`));
    expect(body).toMatch(/name="files"; filename="nova\.png"/);
    expect(await assetNames()).toEqual(["nova.png", "capa-nova.webp", "selo.png"]);
    await page.waitForFunction(
      (s) =>
        document
          .querySelector<HTMLIFrameElement>("iframe.gjs-frame")
          ?.contentDocument?.querySelector("#pic")
          ?.getAttribute("src") === s,
      src,
    );
    expect((await imageAttributes()).srcset).toBeUndefined();
    expect(await toasts()).toEqual([
      { type: "loading", message: 'Enviando "nova.png"…' },
      { type: "success", message: "Imagem enviada." },
    ]);
  });

  it("erro do servidor vira toast em português e nada entra na lista", async () => {
    uploadReply = {
      status: 415,
      body: {
        error: '"falsa.png" não é uma imagem aceita. Envie JPG, PNG, WebP, GIF, AVIF ou SVG.',
        errors: [
          { name: "falsa.png", error: '"falsa.png" não é uma imagem aceita. Envie JPG, PNG, WebP, GIF, AVIF ou SVG.' },
        ],
      },
    };
    await openFromImage();
    await page
      .locator("#gjs-am-uploadFile")
      .setInputFiles({ name: "falsa.png", mimeType: "image/png", buffer: Buffer.from("x") });
    await page.waitForFunction(() =>
      (window as unknown as { __toasts: { type: string }[] }).__toasts.some((t) => t.type === "error"),
    );
    const calls = await toasts();
    expect(calls.at(-1)).toEqual({
      type: "error",
      message: '"falsa.png" não é uma imagem aceita. Envie JPG, PNG, WebP, GIF, AVIF ou SVG.',
    });
    expect(await assetNames()).toEqual(["capa-nova.webp", "selo.png"]);
    expect((await imageAttributes()).src).toBe("/old.png");
  });

  it("envio parcial avisa quais falharam", async () => {
    uploadReply = {
      status: 200,
      body: {
        data: [{ type: "image", src: `/os-assets/${"d".repeat(64)}.webp`, name: "boa.jpg" }],
        errors: [{ name: "ruim.jpg", error: 'Não foi possível ler "ruim.jpg". O arquivo pode estar corrompido.' }],
      },
    };
    await openFromImage();
    await page.locator("#gjs-am-uploadFile").setInputFiles([
      { name: "boa.jpg", mimeType: "image/jpeg", buffer: png },
      { name: "ruim.jpg", mimeType: "image/jpeg", buffer: png },
    ]);
    await page.waitForFunction(() => document.querySelectorAll(".os-am .gjs-am-asset").length === 3);
    await page.waitForFunction(() =>
      (window as unknown as { __toasts: { type: string }[] }).__toasts.some((t) => t.type === "warning"),
    );
    expect((await toasts()).at(-1)).toEqual({
      type: "warning",
      message: "1 de 2 imagens enviadas.",
      description: 'Não foi possível ler "ruim.jpg". O arquivo pode estar corrompido.',
    });
    // Com mais de uma imagem, nada é aplicado automaticamente.
    expect((await imageAttributes()).src).toBe("/old.png");
  });

  it("arquivo que não é imagem é recusado antes de enviar", async () => {
    await openFromImage();
    await page
      .locator("#gjs-am-uploadFile")
      .setInputFiles({ name: "notas.txt", mimeType: "text/plain", buffer: Buffer.from("oi") });
    await page.waitForFunction(() => (window as unknown as { __toasts: unknown[] }).__toasts.length > 0);
    expect(await toasts()).toEqual([
      { type: "error", message: '"notas.txt" não é uma imagem aceita. Envie JPG, PNG, WebP, GIF, AVIF ou SVG.' },
    ]);
    expect(uploads).toHaveLength(0);
  });

  it("link colado: o servidor baixa, a imagem entra no topo e é aplicada", async () => {
    const src = `/os-assets/${"f".repeat(64)}.webp`;
    uploadReply = { status: 200, body: { data: [{ type: "image", src, name: "foto nova.jpg", width: 8, height: 8 }] } };
    await openFromImage();
    expect(await page.locator(".gjs-am-add-asset button").textContent()).toBe("Usar link");
    await page.locator(".gjs-am-add-field input").fill("https://cdn.exemplo.com/img/foto%20nova.jpg");
    await page.locator(".gjs-am-add-asset button").click();
    await page.waitForFunction(() => document.querySelectorAll(".os-am .gjs-am-asset").length === 3);

    expect(uploads).toHaveLength(1);
    const body = uploads[0].postDataBuffer()?.toString("utf8") ?? "";
    expect(body).toMatch(new RegExp(`name="offerId"\\r\\n\\r\\n${OFFER}\\r\\n`));
    expect(body).toMatch(/name="url"\r\n\r\nhttps:\/\/cdn\.exemplo\.com\/img\/foto%20nova\.jpg\r\n/);
    expect((await assetNames())[0]).toBe("foto nova.jpg");
    expect((await imageAttributes()).src).toBe(src);
    expect(await toasts()).toEqual([
      { type: "loading", message: "Baixando a imagem do link…" },
      { type: "success", message: "Imagem adicionada à biblioteca." },
    ]);
  });

  it("link inválido ou que falha no servidor: toast e o link volta para o campo", async () => {
    await openFromImage();
    const field = page.locator(".gjs-am-add-field input");
    await field.fill("javascript:alert(1)");
    await page.locator(".gjs-am-add-asset button").click();
    expect((await toasts()).at(-1)).toEqual({
      type: "error",
      message: "Cole um link de imagem válido, começando com https://",
    });
    expect(await field.inputValue()).toBe("javascript:alert(1)");
    expect(uploads).toHaveLength(0);

    uploadReply = {
      status: 422,
      body: { error: "Não foi possível baixar a imagem desse link. O servidor respondeu com o código 404." },
    };
    await field.fill("https://site.com/nao-existe.png");
    await page.locator(".gjs-am-add-asset button").click();
    await page.waitForFunction(() =>
      (window as unknown as { __toasts: { message: string }[] }).__toasts.some((t) => t.message.includes("404")),
    );
    expect((await toasts()).at(-1)).toEqual({
      type: "error",
      message: "Não foi possível baixar a imagem desse link. O servidor respondeu com o código 404.",
    });
    expect(await field.inputValue()).toBe("https://site.com/nao-existe.png");
    expect(await page.locator(".os-am .gjs-am-asset").count()).toBe(2);
    expect((await imageAttributes()).src).toBe("/old.png");
  });

  it("arquivo do próprio painel entra direto, sem baixar", async () => {
    await openFromImage();
    await page.locator(".gjs-am-add-field input").fill(`/os-assets/${"9".repeat(64)}.png`);
    await page.locator(".gjs-am-add-asset button").click();
    await page.waitForFunction(() => document.querySelectorAll(".os-am .gjs-am-asset").length === 3);
    expect(uploads).toHaveLength(0);
    expect((await imageAttributes()).src).toBe(`/os-assets/${"9".repeat(64)}.png`);
  });

  it("imagem arrastada para a página é enviada; se falhar, o elemento vazio sai", async () => {
    const src = `/os-assets/${"e".repeat(64)}.webp`;
    uploadReply = { status: 200, body: { data: [{ type: "image", src, name: "solta.png" }] } };
    const dropped = async () =>
      page.evaluate(async () => {
        type Cmp = { get(k: string): unknown; getView(): unknown; set(v: object): void; parent(): unknown };
        type Ed = {
          addComponents(v: object): Cmp[];
          AssetManager: {
            FileUploader(): {
              uploadFile(ev: object, clb?: (r: { data: { src: string }[] }) => void, opts?: object): Promise<void>;
            };
          };
        };
        const ed = (window as unknown as { editor: Ed }).editor;
        const [cmp] = ed.addComponents({ type: "image" });
        const file = new File([new Uint8Array([137, 80, 78, 71])], "solta.png", { type: "image/png" });
        await ed.AssetManager.FileUploader().uploadFile(
          { dataTransfer: { files: [file] } },
          (res) => cmp.set({ src: res.data[0].src }),
          { componentView: cmp.getView(), file },
        );
        return { src: String(cmp.get("src") ?? ""), attached: Boolean(cmp.parent()) };
      });

    expect(await dropped()).toEqual({ src, attached: true });
    expect(uploads).toHaveLength(1);

    uploadReply = { status: 413, body: { error: '"solta.png" tem 20,0 MB. O limite é 15 MB por imagem.' } };
    expect(await dropped()).toMatchObject({ attached: false });
    expect((await toasts()).at(-1)).toEqual({
      type: "error",
      message: '"solta.png" tem 20,0 MB. O limite é 15 MB por imagem.',
    });
  });
});

describe("funções auxiliares do editor", () => {
  it("usa os mesmos limites do servidor", () => {
    expect(CLIENT_UPLOAD_LIMITS.maxFileBytes).toBe(IMAGE_UPLOAD_LIMITS.maxFileBytes);
    expect(CLIENT_UPLOAD_LIMITS.maxFiles).toBe(IMAGE_UPLOAD_LIMITS.maxFiles);
  });

  it("checkFiles avisa antes de enviar, mas deixa arquivos sem tipo para o servidor", () => {
    const result = checkFiles([
      { name: "ok.jpg", size: 10, type: "image/jpeg" },
      { name: "sem-tipo", size: 10, type: "" },
      { name: "IMG_1.HEIC", size: 10, type: "image/heic" },
      { name: "doc.pdf", size: 10, type: "application/pdf" },
      { name: "grande.png", size: 16 * 1024 * 1024, type: "image/png" },
      { name: "vazia.png", size: 0, type: "image/png" },
      { name: "logo.svg", size: 10, type: "image/svg+xml" },
    ]);
    expect(result.accepted).toEqual([0, 1, 6]);
    expect(result.problems).toEqual([
      '"IMG_1.HEIC" está no formato HEIC (fotos do iPhone). Exporte como JPG ou PNG e envie de novo.',
      '"doc.pdf" não é uma imagem aceita. Envie JPG, PNG, WebP, GIF, AVIF ou SVG.',
      '"grande.png" tem 16,0 MB. O limite é 15 MB por imagem.',
      '"vazia.png" está vazio.',
    ]);
  });

  it("formatBytes e parseAssetResponse", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(15 * 1024 * 1024 + 1)).toBe("15,1 MB");
    expect(parseAssetResponse(null)).toEqual({ data: [], errors: [] });
    expect(
      parseAssetResponse({
        data: [
          { src: "/os-assets/x.webp", name: "x", width: 1, height: 2, bytes: 3, extra: "<b>" },
          { name: "sem src" },
          "texto",
        ],
        errors: [{ name: "y", error: "falhou" }, { name: "z" }],
        error: "geral",
      }),
    ).toEqual({
      data: [{ type: "image", src: "/os-assets/x.webp", name: "x", width: 1, height: 2, bytes: 3 }],
      errors: [{ name: "y", error: "falhou" }],
      error: "geral",
    });
  });
});
