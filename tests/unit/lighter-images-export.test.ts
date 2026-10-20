/**
 * "Imagens mais leves" no ZIP de verdade: a "Página de vendas longa" (modelo)
 * com fotos de verdade (WebP do tamanho de cada espaço do modelo, como depois
 * de trocar as imagens no editor), gerada com e sem a opção.
 *
 * - com a opção, da 3ª imagem em diante: loading="lazy", decoding="async" e
 *   as dimensões reais; o resto do HTML é o mesmo, byte a byte;
 * - sem a opção, o HTML sai sem nenhum desses atributos;
 * - num Chromium, no computador e no celular, depois de rolar até o fim, cada
 *   imagem fica exatamente do mesmo tamanho e no mesmo lugar nas duas versões,
 *   e com a opção a abertura baixa menos imagens.
 */
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { type Browser, chromium } from "playwright";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { putContentAddressed } from "@/lib/storage";
import { buildExport } from "@/server/services/export/build";
import { createOffer } from "@/server/services/offers";
import { resetDatabase } from "../setup/per-file";
import { readZip, removeExportFiles, unzipTo } from "./export-fixture";

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript",
  css: "text/css",
  webp: "image/webp",
};

let browser: Browser;
let tmp = "";
let server: Server;
let base = "";
let htmlOn = "";
let htmlOff = "";
let imageCount = 0;

/** Imagem do modelo (SVG em data:) → WebP de verdade do mesmo tamanho, em /os-assets/. */
async function realPhoto(dataUri: string, index: number): Promise<string> {
  const svg = decodeURIComponent(dataUri.slice(dataUri.indexOf(",") + 1));
  const width = Number(/\swidth="(\d+)"/.exec(svg)?.[1] ?? 600);
  const height = Number(/\sheight="(\d+)"/.exec(svg)?.[1] ?? 400);
  const data = await sharp({
    create: { width, height, channels: 3, background: { r: (index * 37) % 255, g: 120, b: (index * 91) % 255 } },
  })
    .webp({ quality: 60 })
    .toBuffer();
  const { key } = await putContentAddressed(data, "webp");
  return `/os-assets/${key.split("/").pop()}`;
}

async function build(offerId: string, lighterImages: boolean, dir: string) {
  const target = path.join(tmp, `${lighterImages ? "com" : "sem"}.zip`);
  await buildExport({
    offerId,
    options: { splitter: true, serverEvents: false, optimizeHtml: true, lighterImages, target: "php" },
    target,
    requestedAt: new Date(2026, 9, 9, 3, 0),
  });
  const zip = await readZip(target);
  await unzipTo(target, path.join(tmp, dir));
  return (zip.get("index.html")?.data ?? Buffer.alloc(0)).toString("utf8");
}

beforeAll(async () => {
  await resetDatabase();
  tmp = await mkdtemp(path.join(os.tmpdir(), "os-imagens-leves-"));
  const offer = await createOffer({ name: "Vendas com fotos", templateId: "vendas-longa" });
  const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { page: { offerId: offer.id } } } });
  let html = doc.html ?? "";
  const uris = [...html.matchAll(/<img\b[^>]*\ssrc="(data:image\/svg\+xml,[^"]+)"/g)].map((m) => m[1]);
  imageCount = uris.length;
  for (const [i, uri] of uris.entries()) html = html.replace(uri, await realPhoto(uri, i));
  await prisma.pageDocument.update({ where: { id: doc.id }, data: { html } });

  htmlOn = await build(offer.id, true, "com");
  htmlOff = await build(offer.id, false, "sem");

  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    void (async () => {
      let file = path.join(tmp, pathname);
      if (!file.startsWith(tmp)) return res.writeHead(404).end();
      if ((await stat(file).catch(() => null))?.isDirectory()) file = path.join(file, "index.html");
      if (!(await stat(file).catch(() => null))?.isFile()) return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": MIME[file.split(".").pop() ?? ""] ?? "application/octet-stream" });
      createReadStream(file).pipe(res);
    })();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (tmp) await rm(tmp, { recursive: true, force: true });
  await removeExportFiles();
});

const imgTags = (html: string) => [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);

describe("ZIP da página de vendas longa com fotos", () => {
  it("com a opção: lazy e dimensões da 3ª imagem em diante; sem ela, nada", () => {
    expect(imageCount).toBeGreaterThanOrEqual(8);
    const on = imgTags(htmlOn);
    const lazy = on.filter((t) => t.includes('loading="lazy"'));
    // As fotos dos depoimentos têm altura no CSS do modelo (.os-person img): ficam como estão.
    expect(lazy.length).toBeGreaterThanOrEqual(4);
    expect(on.slice(0, 2).some((t) => t.includes("loading="))).toBe(false);
    expect(on[0]).toContain('fetchpriority="high"');
    for (const t of lazy) expect(t).toMatch(/ decoding="async" width="\d+" height="\d+"/);
    expect(on.filter((t) => t.includes("fetchpriority"))).toHaveLength(1);
    // O resto do HTML não muda.
    expect(htmlOn.replace(/ (?:fetchpriority|loading|decoding|width|height)="[^"]*"/g, "")).toBe(htmlOff);
    expect(htmlOff).not.toMatch(/<img\b[^>]*\s(?:loading|fetchpriority|decoding)=/);
  });

  for (const device of [
    { name: "computador", viewport: { width: 1280, height: 900 }, isMobile: false },
    { name: "celular", viewport: { width: 390, height: 844 }, isMobile: true },
  ]) {
    it(`no ${device.name}: as imagens ficam do mesmo tamanho e no mesmo lugar; a abertura baixa menos`, async () => {
      const measure = async (dir: string) => {
        const context = await browser.newContext({
          viewport: device.viewport,
          isMobile: device.isMobile,
          hasTouch: device.isMobile,
          reducedMotion: "reduce",
        });
        await context.route(
          (url) => url.hostname !== "127.0.0.1",
          (route) => route.abort(),
        );
        const page = await context.newPage();
        const images = new Set<string>();
        page.on("request", (r) => {
          if (r.resourceType() === "image") images.add(r.url());
        });
        await page.goto(`${base}${dir}/`, { waitUntil: "load" });
        await page.waitForTimeout(300);
        const atOpen = images.size;
        // Rola até o fim devagar (como uma pessoa) e espera todas as imagens.
        await page.evaluate(async () => {
          for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 30));
          }
          window.scrollTo(0, document.documentElement.scrollHeight);
          await Promise.all(
            [...document.images].map((img) =>
              img.complete ? null : new Promise((r) => img.addEventListener("load", r, { once: true })),
            ),
          );
          window.scrollTo(0, 0);
        });
        const boxes = await page.evaluate(() =>
          [...document.images].map((img) => {
            const r = img.getBoundingClientRect();
            const css = getComputedStyle(img);
            return {
              src: img.getAttribute("src"),
              box: [r.left, r.top + window.scrollY, r.width, r.height].map((n) => Math.round(n * 100) / 100),
              size: [css.width, css.height],
              loaded: img.complete && img.naturalWidth > 0,
            };
          }),
        );
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await context.close();
        return { boxes, atOpen, height };
      };
      const on = await measure("com");
      const off = await measure("sem");
      expect(on.boxes.length).toBe(imageCount);
      expect(on.boxes.every((b) => b.loaded)).toBe(true);
      expect(on.boxes).toEqual(off.boxes);
      expect(on.height).toBe(off.height);
      expect(on.atOpen).toBeLessThan(off.atOpen);
    }, 60_000);
  }
});
