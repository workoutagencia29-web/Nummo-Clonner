/**
 * Script da página do produto no ZIP e na prévia do app: vai à parte
 * (assets/os-produto-<hash>.js no ZIP, /os-produto.js na prévia) e só nas
 * páginas com galeria, caixa de compra ou "Voltar para a loja" — a página da
 * loja (vitrine) e as outras páginas não carregam nada disso. Ofertas sem
 * página de produto nem ganham o arquivo.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createPreviewToken } from "@/lib/preview";
import { PRODUCT_SCRIPT_ATTR, PRODUCT_SCRIPT_PATH, PRODUCT_SCRIPT_TAG } from "@/lib/runtime-bundle";
import { buildExport } from "@/server/services/export/build";
import { parseExportOptions } from "@/server/services/export/plan";
import { createOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { resetDatabase } from "../setup/per-file";
import { readZip } from "./export-fixture";

const ROOT = path.resolve(import.meta.dirname, "../..");
let tmp = "";

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "os-produto-zip-"));
});
afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
  await resetDatabase();
});
beforeEach(async () => {
  await resetDatabase();
});

/** Oferta com a loja (vitrine) e, se pedido, a página de um produto. */
async function storeOffer(withProduct: boolean) {
  const offer = await createOffer({ name: "Minha loja" });
  const store = await createPage({ offerId: offer.id, name: "Loja", templateId: "loja" });
  const product = withProduct
    ? await createPage({ offerId: offer.id, name: "Fone de ouvido", templateId: "produto" })
    : null;
  return { offerId: offer.id, store, product };
}

async function zip(offerId: string) {
  const target = path.join(tmp, `${Date.now()}-oferta.zip`);
  await buildExport({ offerId, options: parseExportOptions({}), target });
  return readZip(target);
}

describe("ZIP", () => {
  it("assets/os-produto-<hash>.js só na página do produto; a loja não carrega", async () => {
    const o = await storeOffer(true);
    const entries = await zip(o.offerId);
    const files = [...entries.keys()];
    const script = files.find((e) => /^assets\/os-produto-[0-9a-f]{12}\.js$/.test(e));
    expect(script).toBeDefined();
    expect(entries.get(script as string)?.data.toString("utf8")).toContain("__osProduct");
    const pages = files
      .filter((f) => f.endsWith("index.html"))
      .map((f) => [f, entries.get(f)?.data.toString("utf8") ?? ""]);
    const product = pages.filter(([, html]) => html.includes('data-os-widget="product-buy"'));
    expect(product).toHaveLength(1);
    expect(product[0][1]).toContain(`<script src="../${script}" ${PRODUCT_SCRIPT_ATTR}></script>`);
    // Uma vez só, depois do script das páginas.
    expect(product[0][1].split(PRODUCT_SCRIPT_ATTR)).toHaveLength(2);
    expect(product[0][1].indexOf("data-os-runtime")).toBeLessThan(product[0][1].indexOf(PRODUCT_SCRIPT_ATTR));
    for (const [file, html] of pages) {
      if (html.includes('data-os-widget="product-buy"')) continue;
      expect(html, file).not.toContain(PRODUCT_SCRIPT_ATTR);
    }
  });

  it("oferta sem página de produto: nem o arquivo", async () => {
    const o = await storeOffer(false);
    const files = [...(await zip(o.offerId)).keys()];
    expect(files.some((e) => /os-produto-/.test(e))).toBe(false);
  });
});

// ─── Prévia ──────────────────────────────────────────────────────────────────

describe("prévia do app", () => {
  let port = 0;
  let child: ChildProcess | null = null;
  let output = "";

  const freePort = () =>
    new Promise<number>((resolve, reject) => {
      const srv = createServer();
      srv.once("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const p = (srv.address() as { port: number }).port;
        srv.close(() => resolve(p));
      });
    });

  const get = (token: string, pathname: string) =>
    new Promise<{ status: number; body: string; type: string }>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path: pathname, headers: { host: `${token}.localhost:${port}` } },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => {
            body += c;
          });
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, body, type: String(res.headers["content-type"] ?? "") }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });

  beforeAll(async () => {
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
  }, 60_000);

  afterAll(() => {
    child?.kill("SIGTERM");
  });

  it("a página do produto pede /os-produto.js (servido pela prévia); a loja não", async () => {
    const o = await storeOffer(true);
    const token = await createPreviewToken({ kind: "offer", offerId: o.offerId });
    const product = await get(token, `/p/${o.product?.id}`);
    expect(product.status).toBe(200);
    expect(product.body).toContain(PRODUCT_SCRIPT_TAG);
    const store = await get(token, `/p/${o.store.id}`);
    expect(store.status).toBe(200);
    expect(store.body).toContain('data-os-widget="products"');
    expect(store.body).not.toContain(PRODUCT_SCRIPT_ATTR);
    const js = await get(token, PRODUCT_SCRIPT_PATH);
    expect(js.status).toBe(200);
    expect(js.type).toMatch(/javascript/);
    expect(js.body).toContain("__osProduct");
    expect(await prisma.page.count({ where: { offerId: o.offerId } })).toBe(3);
  });
});
