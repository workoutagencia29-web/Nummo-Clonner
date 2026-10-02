/**
 * ZIP de uma oferta feita só com os MODELOS de página de verdade
 * (src/editor/templates): um de cada, a página inicial com as versões A e B
 * (B vinda de outro modelo) e um pixel da Meta. Confere, sem depender de uma
 * oferta montada à mão, que:
 *
 * - nada aponta para o painel (/os-assets/, os-page:, localhost) nem falta
 *   arquivo;
 * - todo endereço relativo do HTML e dos CSS (src, href, srcset, poster,
 *   url()) existe dentro do ZIP;
 * - num Chromium de verdade, com a oferta numa SUBPASTA, cada página abre
 *   sem nenhum 404 e sem erro de JavaScript.
 */
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import * as cheerio from "cheerio";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { ExportView } from "@/lib/export/options";
import { storagePath } from "@/lib/storage";
import { getExportView, startExport } from "@/server/services/export";
import { claimNextExport, exportFileKey, runExportJob } from "@/server/services/export/jobs";
import { createOffer } from "@/server/services/offers";
import { listTemplates } from "@/server/services/page-templates";
import { createPage } from "@/server/services/pages";
import { createPixel } from "@/server/services/tracking";
import { createVariant } from "@/server/services/variants";
import { resetDatabase } from "../setup/per-file";
import { META_PIXEL, readZip, removeExportFiles, type ZipItem } from "./export-fixture";

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  txt: "text/plain; charset=utf-8",
};

/** Serve `root` em `prefix`, como uma hospedagem só de arquivos. */
async function serve(root: string, prefix: string) {
  const server: Server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    if (!pathname.startsWith(prefix)) {
      res.writeHead(404).end();
      return;
    }
    void (async () => {
      let file = path.join(root, pathname.slice(prefix.length));
      if (!file.startsWith(root)) return res.writeHead(404).end();
      if ((await stat(file).catch(() => null))?.isDirectory()) file = path.join(file, "index.html");
      if (!(await stat(file).catch(() => null))?.isFile() || file.endsWith(".php")) return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": MIME[file.split(".").pop() ?? ""] ?? "application/octet-stream" });
      createReadStream(file).pipe(res);
    })();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}${prefix}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Endereço que fica fora do ZIP (outro site, âncora, data:, mailto:…). */
const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|$)/i;

/** Endereço relativo → entrada do ZIP (pasta → index.html); null = fora do ZIP. */
function zipTarget(fromFile: string, ref: string): string | null {
  const clean = ref.trim();
  if (EXTERNAL_RE.test(clean)) return null;
  const url = new URL(clean, `http://zip/${fromFile}`);
  let target = decodeURIComponent(url.pathname).replace(/^\//, "");
  if (target === "" || target.endsWith("/")) target += "index.html";
  return target;
}

/** Endereços de arquivos citados num HTML (atributos, srcset, estilos). */
function htmlRefs(html: string): string[] {
  const $ = cheerio.load(html);
  const refs: string[] = [];
  $("[src], [href], [poster], [srcset], [data-src], [style]").each((_, el) => {
    const $el = $(el);
    for (const attr of ["src", "href", "poster", "data-src"]) {
      const value = $el.attr(attr);
      if (value !== undefined) refs.push(value);
    }
    const srcset = $el.attr("srcset");
    if (srcset) for (const part of srcset.split(",")) refs.push(part.trim().split(/\s+/)[0] ?? "");
    const style = $el.attr("style");
    if (style) refs.push(...cssRefs(style));
  });
  $("style").each((_, el) => {
    refs.push(...cssRefs($(el).text()));
  });
  // <link rel="preconnect"> etc. para outros sites já caem em EXTERNAL_RE.
  return refs;
}

function cssRefs(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) out.push(m[2]);
  for (const m of css.matchAll(/@import\s+(['"])([^'"]+)\1/gi)) out.push(m[2]);
  return out;
}

let offerId: string;
let view: ExportView;
let zip: Map<string, ZipItem>;
let dir: string;
let pageDirs: string[];

beforeAll(async () => {
  await removeExportFiles();
  await resetDatabase();
  const templates = listTemplates();
  expect(templates.length).toBeGreaterThan(3);
  ({ id: offerId } = await createOffer({ name: "Oferta dos Modelos", templateId: templates[0].id }));
  const home = await prisma.page.findFirstOrThrow({ where: { offerId, isHome: true }, select: { id: true } });
  await createVariant({ pageId: home.id, source: { kind: "template", templateId: templates[1].id } });
  for (const t of templates.slice(1)) await createPage({ offerId, name: t.pageName, templateId: t.id });
  await createPixel(offerId, { vendor: "META", pixelId: META_PIXEL, options: {} });

  const { exportId } = await startExport(offerId, { splitter: true, optimizeHtml: true });
  expect(await claimNextExport()).toBe(exportId);
  await runExportJob(exportId);
  view = (await getExportView(exportId)) as ExportView;
  const file = storagePath(exportFileKey(offerId, exportId));
  zip = await readZip(file);
  dir = await mkdtemp(path.join(os.tmpdir(), "os-export-modelos-"));
  const { unzipTo } = await import("./export-fixture");
  await unzipTo(file, dir);
  pageDirs = [...zip.keys()]
    .filter((name) => name.endsWith("index.html"))
    .map((name) => name.slice(0, -"index.html".length))
    .sort();
}, 120_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  await removeExportFiles();
  await resetDatabase();
});

describe("ZIP de uma oferta feita com os modelos", () => {
  it("sai pronto, com todas as páginas e sem arquivo faltando", () => {
    expect(view.status).toBe("DONE");
    expect(view.errorMessage).toBeNull();
    expect(view.warnings.join("\n")).not.toContain("não foram encontrados");
    expect(view.warnings.join("\n")).not.toContain("sem destino");
    const pages = listTemplates().length;
    // Todas as páginas + divisor e as duas versões da página inicial.
    expect(pageDirs.length).toBe(pages - 1 + 1 + 2);
    expect(pageDirs).toContain("");
    expect(pageDirs).toContain("oferta-a/");
    expect(pageDirs).toContain("oferta-b/");
  });

  it("nada aponta para o painel do Offer Studio", () => {
    for (const [name, item] of zip) {
      if (!/\.(?:html|css|js|txt)$/.test(name)) continue;
      const text = item.data.toString("utf8");
      expect(text, name).not.toContain("/os-assets/");
      // Os scripts do Offer Studio citam "os-page:" no código (para ignorar
      // links que sobraram); nas páginas e nos estilos, nenhum pode sobrar.
      if (!/^assets\/os-(?:runtime|tracking)-/.test(name)) expect(text, name).not.toContain("os-page:");
      expect(text, name).not.toMatch(/https?:\/\/(?:localhost|127\.0\.0\.1)[:/]/);
    }
  });

  it("todo endereço relativo (HTML e CSS) existe dentro do ZIP", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const [name, item] of zip) {
      const text = item.data.toString("utf8");
      const refs = name.endsWith(".html") ? htmlRefs(text) : name.endsWith(".css") ? cssRefs(text) : [];
      for (const ref of refs) {
        const target = zipTarget(name, ref);
        if (target === null) continue;
        checked++;
        if (!zip.has(target)) missing.push(`${name} → ${ref}`);
      }
    }
    expect(missing).toEqual([]);
    // Cada página (menos o divisor) cita pelo menos os dois scripts do Offer Studio.
    expect(checked).toBeGreaterThanOrEqual((pageDirs.length - 1) * 2);
  });
});

describe("no Chromium, com a oferta numa subpasta", () => {
  let browser: Browser;
  let site: Awaited<ReturnType<typeof serve>>;

  beforeAll(async () => {
    site = await serve(dir, "/clientes/modelos/");
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await site?.close();
  });

  it("cada página abre sem 404 e sem erro de JavaScript", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // Nada sai para a internet (pixels, fontes, checkouts de exemplo).
    await context.route(
      (url) => url.hostname !== "127.0.0.1",
      (route) => route.abort(),
    );
    const problems: string[] = [];
    for (const pageDir of pageDirs) {
      const page = await context.newPage();
      page.on("response", (r) => {
        if (r.url().startsWith("http://127.0.0.1") && r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
      });
      page.on("pageerror", (e) => problems.push(`${pageDir}: ${e.message}`));
      await page.goto(`${site.base}${pageDir}`, { waitUntil: "load" });
      if (pageDir === "") {
        // O divisor manda para uma das versões, mantendo a subpasta.
        await page.waitForURL(/\/clientes\/modelos\/oferta-[ab]\/$/);
        await page.waitForLoadState("load");
      } else {
        expect(page.url()).toBe(`${site.base}${pageDir}`);
      }
      expect(await page.locator("body").innerText(), pageDir).not.toBe("");
      // O script das páginas (os-runtime) rodou.
      expect(await page.evaluate(() => typeof (window as { __osTracking?: unknown }).__osTracking), pageDir).toBe(
        "object",
      );
      await page.close();
    }
    await context.close();
    expect(problems).toEqual([]);
  });
});
