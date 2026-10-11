/**
 * Favicon .ico de ponta a ponta: envio pela rota de imagens (como o campo do
 * favicon e o editor), "Usar link" com um .ico, SEO da oferta e da página
 * (o .ico vale no favicon e é recusado, com o motivo, na imagem de
 * compartilhamento), arquivo servido pelo painel e pela prévia (tipo certo e
 * nosniff), o Chromium mostrando os ícones montados à mão e o ZIP com
 * assets/<sha>.ico e o <link rel="icon"> certo — inclusive no divisor A/B.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createServer as createHttpServer, request, type Server } from "node:http";
import { type AddressInfo, createServer } from "node:net";
import path from "node:path";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { POST as uploadRoute } from "@/app/api/assets/upload/route";
import { GET as assetFileRoute } from "@/app/os-assets/[file]/route";
import { prisma } from "@/lib/db";
import type { ExportView } from "@/lib/export/options";
import { ICO_NOT_FOR_SHARING } from "@/lib/ico";
import { parseOfferSettings } from "@/lib/offer-settings";
import { createPreviewToken } from "@/lib/preview";
import { applySeo } from "@/lib/seo-render";
import { deleteObject, getObject, storagePath } from "@/lib/storage";
import {
  IMAGE_UPLOAD_LIMITS,
  importOfferImageFromUrl,
  type LibraryImage,
  listOfferImages,
} from "@/server/services/assets";
import { getExportView, startExport } from "@/server/services/export";
import { claimNextExport, exportFileKey, runExportJob } from "@/server/services/export/jobs";
import { saveOfferSettings, savePageSeo } from "@/server/services/offer-settings";
import { createOffer } from "@/server/services/offers";
import { createVariant } from "@/server/services/variants";
import { createFetcher } from "@/worker/clone/fetcher";
import { resetDatabase } from "../setup/per-file";
import { readZip, removeExportFiles } from "./export-fixture";
import { expectUserError } from "./helpers";
import { sampleIcons } from "./ico-fixtures";

const ROOT = path.resolve(import.meta.dirname, "../..");
const HOST = `localhost:${process.env.PORT || "3000"}`;
const written = new Set<string>();
let icons: Awaited<ReturnType<typeof sampleIcons>>;

beforeAll(async () => {
  icons = await sampleIcons();
});

beforeEach(async () => {
  await resetDatabase();
  getSession.mockReset();
  getSession.mockResolvedValue({ user: { id: "u1" }, session: { id: "s1" } });
});

afterAll(async () => {
  await removeExportFiles();
  for (const key of written) await deleteObject(key);
});

async function remember() {
  for (const r of await prisma.asset.findMany({ select: { key: true } })) written.add(r.key);
}

/** Envia arquivos pela rota de imagens (a mesma do campo do favicon e do editor). */
async function upload(offerId: string, files: { name: string; data: Uint8Array; type?: string }[]) {
  const form = new FormData();
  form.append("offerId", offerId);
  for (const f of files) {
    form.append("files", new File([new Uint8Array(f.data)], f.name, { type: f.type ?? "image/x-icon" }));
  }
  const res = await uploadRoute(
    new Request(`http://${HOST}/api/assets/upload`, { method: "POST", headers: { host: HOST }, body: form }),
  );
  await remember();
  return { status: res.status, body: (await res.json()) as { data?: LibraryImage[]; error?: string } };
}

const keyOf = (src: string) => {
  const file = src.replace("/os-assets/", "");
  return `a/${file.slice(0, 2)}/${file}`;
};

/** Página simples com o ícone também num <img> (para o Chromium mostrar). */
function pageHtml(imgs: string[] = []) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Oferta</title><link rel="icon" href="/favicon-velho.png"><link rel="apple-touch-icon" href="/velho.png"></head><body><h1>Oferta</h1>${imgs
    .map((src, i) => `<img id="ico${i}" src="${src}" alt="">`)
    .join("")}</body></html>`;
}

async function offerWithPage(html = pageHtml()) {
  const offer = await createOffer({ name: "Oferta ícone" });
  const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
  await prisma.pageDocument.updateMany({ where: { variant: { pageId: home.id } }, data: { html } });
  return { offerId: offer.id, homeId: home.id };
}

describe("envio e biblioteca", () => {
  it("rota de imagens: .ico com PNG, com BMP e com vários tamanhos entram como vieram (image/x-icon)", async () => {
    const { offerId } = await offerWithPage();
    const { status, body } = await upload(offerId, [
      { name: "favicon.ico", data: icons.png },
      { name: "icone-bmp.ico", data: icons.bmp, type: "image/vnd.microsoft.icon" },
      { name: "varios.ico", data: icons.multi, type: "" },
    ]);
    expect(status).toBe(200);
    expect(body.data).toEqual([
      expect.objectContaining({ type: "image", name: "favicon.ico", width: 32, height: 32, bytes: icons.png.length }),
      expect.objectContaining({ name: "icone-bmp.ico", width: 16, height: 16, bytes: icons.bmp.length }),
      expect.objectContaining({ name: "varios.ico", width: 256, height: 256, bytes: icons.multi.length }),
    ]);
    for (const [i, data] of [icons.png, icons.bmp, icons.multi].entries()) {
      const src = body.data?.[i].src ?? "";
      expect(src).toMatch(/^\/os-assets\/[0-9a-f]{64}\.ico$/);
      expect((await getObject(keyOf(src))).equals(data)).toBe(true);
    }
    const rows = await prisma.asset.findMany({ where: { offerId }, select: { kind: true, mime: true } });
    expect(rows).toEqual(Array(3).fill({ kind: "IMAGE", mime: "image/x-icon" }));
    // Aparecem na biblioteca do editor.
    expect((await listOfferImages(offerId)).map((i) => i.name).sort()).toEqual([
      "favicon.ico",
      "icone-bmp.ico",
      "varios.ico",
    ]);
  });

  it("rota de imagens: .ico estragado ou grande demais volta com a mensagem em português", async () => {
    const { offerId } = await offerWithPage();
    const broken = await upload(offerId, [{ name: "quebrado.ico", data: icons.png.subarray(0, 60) }]);
    expect(broken).toEqual({
      status: 422,
      body: expect.objectContaining({
        error:
          '"quebrado.ico" não é um ícone .ico válido: o arquivo pode estar corrompido. Exporte o ícone de novo ou envie um PNG.',
      }),
    });
    const big = Buffer.concat([icons.png, Buffer.alloc(IMAGE_UPLOAD_LIMITS.maxIconBytes)]);
    const tooBig = await upload(offerId, [{ name: "pesado.ico", data: big }]);
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error).toMatch(/^"pesado\.ico" tem 1,1 MB\. Um ícone \.ico pode ter no máximo 1 MB/);
    expect(await prisma.asset.count({ where: { offerId } })).toBe(0);
  });

  it('"Usar link" com um .ico (qualquer tipo informado pelo site) guarda o ícone', async () => {
    const { offerId } = await offerWithPage();
    const server: Server = createHttpServer((req, res) => {
      const types: Record<string, string> = {
        "/favicon.ico": "image/x-icon",
        "/icone": "application/octet-stream",
        "/estragado.ico": "image/vnd.microsoft.icon",
      };
      const type = types[req.url ?? ""];
      if (!type) return void res.writeHead(404).end();
      res.writeHead(200, { "content-type": type });
      res.end(
        req.url === "/estragado.ico" ? icons.multi.subarray(0, 200) : req.url === "/icone" ? icons.bmp : icons.png,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const fetcher = createFetcher({ allowPrivate: true, maxBytes: IMAGE_UPLOAD_LIMITS.maxFileBytes });
    try {
      const fav = await importOfferImageFromUrl(offerId, `${base}/favicon.ico`, { fetcher });
      expect(fav).toMatchObject({ name: "favicon.ico", width: 32, height: 32 });
      expect(fav.src).toMatch(/\.ico$/);
      const noExt = await importOfferImageFromUrl(offerId, `${base}/icone`, { fetcher });
      expect(noExt).toMatchObject({ name: "icone", width: 16, height: 16 });
      expect(noExt.src).toMatch(/\.ico$/);
      await expect(importOfferImageFromUrl(offerId, `${base}/estragado.ico`, { fetcher })).rejects.toMatchObject({
        status: 422,
        message: expect.stringMatching(/^"estragado\.ico" não é um ícone \.ico válido/),
      });
      await remember();
      const row = await prisma.asset.findFirstOrThrow({ where: { offerId, key: keyOf(fav.src) } });
      expect(row).toMatchObject({ mime: "image/x-icon", sourceUrl: `${base}/favicon.ico` });
    } finally {
      await fetcher.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("SEO: favicon aceita .ico; imagem de compartilhamento não", () => {
  it("oferta e página", async () => {
    const { offerId, homeId } = await offerWithPage();
    const { body } = await upload(offerId, [{ name: "favicon.ico", data: icons.png }]);
    const src = body.data?.[0].src ?? "";

    const saved = await saveOfferSettings(offerId, { seo: { faviconKey: src } });
    expect(saved.seo.faviconKey).toBe(keyOf(src));
    await expectUserError(
      saveOfferSettings(offerId, { seo: { ogImageKey: src } }),
      ICO_NOT_FOR_SHARING,
      "seo.ogImageKey",
    );
    expect(
      parseOfferSettings((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).settings).seo.ogImageKey,
    ).toBeNull();

    const page = await savePageSeo(homeId, { faviconKey: src });
    expect(page.faviconSrc).toBe(src);
    await expectUserError(savePageSeo(homeId, { ogImageKey: src }), ICO_NOT_FOR_SHARING, "ogImageKey");
    expect(ICO_NOT_FOR_SHARING).toMatch(/Facebook e o WhatsApp não mostram \.ico/);
  });

  it('<link rel="icon"> com o tipo do .ico e sem apple-touch-icon; PNG continua como antes', () => {
    const html = pageHtml();
    const ico = applySeo(html, { faviconHref: "/os-assets/abc.ico" });
    expect(ico).toContain('<link rel="icon" type="image/x-icon" href="/os-assets/abc.ico">');
    expect(ico).not.toContain("apple-touch-icon");
    expect(ico).not.toContain("favicon-velho.png");
    const png = applySeo(html, { faviconHref: "/os-assets/abc.png" });
    expect(png).toContain(
      '<link rel="icon" href="/os-assets/abc.png"><link rel="apple-touch-icon" href="/os-assets/abc.png">',
    );
  });
});

describe("painel: /os-assets/<sha>.ico", () => {
  it("tipo image/x-icon, nosniff e os bytes do arquivo", async () => {
    const { offerId } = await offerWithPage();
    const { body } = await upload(offerId, [{ name: "favicon.ico", data: icons.multi }]);
    const file = (body.data?.[0].src ?? "").replace("/os-assets/", "");
    const res = await assetFileRoute(new Request(`http://${HOST}/os-assets/${file}`), {
      params: Promise.resolve({ file }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/x-icon");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(icons.multi)).toBe(true);
  });
});

describe("prévia", () => {
  let port = 0;
  let child: ChildProcess | null = null;
  let output = "";
  let browser: Browser;

  function freePort() {
    return new Promise<number>((resolve, reject) => {
      const srv = createServer();
      srv.once("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const p = (srv.address() as { port: number }).port;
        srv.close(() => resolve(p));
      });
    });
  }

  function call(token: string, pathname: string) {
    return new Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path: pathname, headers: { host: `${token}.localhost:${port}` } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  beforeAll(async () => {
    // Nunca o banco real: o servidor recebe o banco de testes desta execução.
    expect(process.env.DATABASE_URL).toMatch(/\/offerstudio_test_\d+$/);
    port = await freePort();
    child = spawn(path.join(ROOT, "node_modules/.bin/tsx"), ["src/preview/server.ts"], {
      cwd: ROOT,
      env: { ...process.env, PREVIEW_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (c) => {
      output += String(c);
    });
    child.stderr?.on("data", (c) => {
      output += String(c);
    });
    const deadline = Date.now() + 30_000;
    while (!output.includes("servidor de prévia")) {
      if (Date.now() > deadline || child.exitCode !== null) throw new Error(`prévia não subiu:\n${output}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    await browser?.close();
  });

  it("favicon .ico no <head>, arquivo com o tipo certo e os três ícones mostrados pelo Chromium", async () => {
    const offer = await createOffer({ name: "Oferta prévia" });
    const { body } = await upload(offer.id, [
      { name: "favicon.ico", data: icons.png },
      { name: "bmp.ico", data: icons.bmp },
      { name: "varios.ico", data: icons.multi },
    ]);
    const srcs = (body.data ?? []).map((i) => i.src);
    const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
    await prisma.pageDocument.updateMany({ where: { variant: { pageId: home.id } }, data: { html: pageHtml(srcs) } });
    await saveOfferSettings(offer.id, { seo: { faviconKey: srcs[0] } });

    const token = await createPreviewToken({ kind: "offer", offerId: offer.id });
    const html = (await call(token, "/")).body.toString("utf8");
    expect(html).toContain(`<link rel="icon" type="image/x-icon" href="${srcs[0]}">`);
    expect(html).not.toContain("favicon-velho.png");
    expect(html).not.toContain("apple-touch-icon");

    const file = await call(token, srcs[2]);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/x-icon");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(file.body.equals(icons.multi)).toBe(true);

    // O Chromium decodifica os ícones montados à mão (PNG, BMP e vários tamanhos).
    const page = await browser.newPage();
    try {
      await page.goto(`http://${token}.localhost:${port}/`);
      const sizes = await page.evaluate(async () => {
        const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("img[id^=ico]"));
        await Promise.all(imgs.map((img) => img.decode().catch(() => undefined)));
        return imgs.map((img) => [img.naturalWidth, img.naturalHeight]);
      });
      expect(sizes.every(([w, h]) => w > 0 && h > 0)).toBe(true);
      expect(sizes).toHaveLength(3);
      expect(await page.locator('link[rel="icon"]').getAttribute("type")).toBe("image/x-icon");
    } finally {
      await page.close();
    }
  });
});

describe("ZIP", () => {
  it('assets/<sha>.ico com os mesmos bytes e o <link rel="icon"> certo nas versões e no divisor A/B', async () => {
    const { offerId, homeId } = await offerWithPage();
    const { body } = await upload(offerId, [{ name: "favicon.ico", data: icons.multi }]);
    const src = body.data?.[0].src ?? "";
    const file = src.replace("/os-assets/", "");
    await saveOfferSettings(offerId, { seo: { faviconKey: src } });
    await createVariant({ pageId: homeId });

    const { exportId } = await startExport(offerId, {});
    expect(await claimNextExport()).toBe(exportId);
    await runExportJob(exportId);
    const view = (await getExportView(exportId)) as ExportView;
    expect(view.errorMessage).toBeNull();
    const zip = await readZip(storagePath(exportFileKey(offerId, exportId)));

    expect(zip.get(`assets/${file}`)?.data.equals(icons.multi)).toBe(true);
    const variant = [...zip.keys()].find((k) => /^oferta-a\/index\.html$/.test(k));
    expect(variant).toBeTruthy();
    const versionHtml = zip.get(variant as string)?.data.toString("utf8") ?? "";
    expect(versionHtml).toContain(`<link rel="icon" type="image/x-icon" href="../assets/${file}">`);
    expect(versionHtml).not.toContain("apple-touch-icon");
    const divider = zip.get("index.html")?.data.toString("utf8") ?? "";
    expect(divider).toContain(`<link rel="icon" href="assets/${file}" type="image/x-icon">`);
  });
});
