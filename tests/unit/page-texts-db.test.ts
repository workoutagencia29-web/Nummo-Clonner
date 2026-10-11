/**
 * A moeda da oferta chega ao render na prévia (servidor de prévia de verdade,
 * numa porta livre) e no ZIP: oferta fora do real ganha o #os-textos com o
 * telefone de fora do Brasil e o NIF de Portugal (9 algarismos, oferta em
 * euro); oferta em real com a página em português sai sem ele.
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
import type { StoreCurrency } from "@/lib/store";
import { buildExport } from "@/server/services/export/build";
import { parseExportOptions } from "@/server/services/export/plan";
import { saveOfferSettings } from "@/server/services/offer-settings";
import { createOffer } from "@/server/services/offers";
import { resetDatabase } from "../setup/per-file";
import { readZip } from "./export-fixture";

const ROOT = path.resolve(import.meta.dirname, "../..");
const HTML =
  '<!DOCTYPE html><html lang="pt-BR"><head><title>Captura</title></head><body>' +
  '<form data-os-widget="lead-form"><input type="tel" name="phone" required><button type="submit">Enviar</button></form>' +
  '<p id="doc">inscrita no CNPJ sob o nº <span class="os-ph">{{CNPJ}}</span></p></body></html>';

let port = 0;
let child: ChildProcess | null = null;
let output = "";
let tmp = "";

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

function get(token: string, pathname: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path: pathname, headers: { host: `${token}.localhost:${port}` } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  // Nunca o banco real: o servidor recebe o banco de testes desta execução.
  expect(process.env.DATABASE_URL).toMatch(/\/offerstudio_test_\d+$/);
  tmp = await mkdtemp(path.join(os.tmpdir(), "os-textos-zip-"));
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
}, 40_000);

afterAll(async () => {
  child?.kill("SIGTERM");
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDatabase();
});

async function offerIn(currency: StoreCurrency) {
  const offer = await createOffer({ name: `Oferta ${currency}` });
  await saveOfferSettings(offer.id, { currency, company: { document: "123456789" } });
  const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { page: { offerId: offer.id } } } });
  await prisma.pageDocument.update({ where: { id: doc.id }, data: { html: HTML } });
  return { offerId: offer.id, docId: doc.id };
}

async function zipHome(offerId: string) {
  const target = path.join(tmp, `${offerId}.zip`);
  await buildExport({ offerId, options: parseExportOptions({}), target });
  const entries = await readZip(target);
  return entries.get("index.html")?.data.toString("utf8") ?? "";
}

function texts(html: string): Record<string, string> | null {
  const m = /<script type="application\/json" id="os-textos">([\s\S]*?)<\/script>/.exec(html);
  return m ? JSON.parse(m[1]) : null;
}

const WORLD_PT = { lfPhone: "Digite seu WhatsApp.", lfPhoneBad: "Digite um WhatsApp válido.", intl: "1" };

describe("moeda da oferta no render (prévia e ZIP)", () => {
  it("oferta em euro: telefone de fora do Brasil e o NIF de Portugal, na prévia e no ZIP", async () => {
    const o = await offerIn("EUR");
    const offer = await get(await createPreviewToken({ kind: "offer", offerId: o.offerId }), "/");
    const doc = await get(await createPreviewToken({ kind: "document", documentId: o.docId }), "/");
    const zip = await zipHome(o.offerId);
    for (const [where, html] of [
      ["prévia da oferta", offer.body],
      ["prévia do documento", doc.body],
      ["ZIP", zip],
    ] as const) {
      expect(texts(html), where).toEqual(WORLD_PT);
      expect(html, where).toContain("inscrita no NIF sob o nº");
    }
  }, 60_000);

  it("oferta em real com a página em português: sem #os-textos (como antes)", async () => {
    const o = await offerIn("BRL");
    const offer = await get(await createPreviewToken({ kind: "offer", offerId: o.offerId }), "/");
    const zip = await zipHome(o.offerId);
    for (const html of [offer.body, zip]) {
      expect(html).not.toContain('id="os-textos"');
      // 9 algarismos sem a moeda do euro: o rótulo fica como está.
      expect(html).toContain("inscrita no CNPJ sob o nº");
    }
  }, 60_000);

  it('oferta em real com página clonada em lang="en": só muda quando a pessoa escolhe o idioma', async () => {
    const o = await offerIn("BRL");
    await prisma.pageDocument.update({
      where: { id: o.docId },
      data: { html: HTML.replace('lang="pt-BR"', 'lang="en"') },
    });
    const preview = async () => (await get(await createPreviewToken({ kind: "offer", offerId: o.offerId }), "/")).body;
    // Sem "Idioma das páginas": em português, pedindo o DDD, como sempre (prévia e ZIP).
    for (const html of [await preview(), await zipHome(o.offerId)]) expect(html).not.toContain('id="os-textos"');
    // Com Inglês escolhido: os textos em inglês e o telefone de fora do Brasil.
    await saveOfferSettings(o.offerId, { language: "en" });
    for (const html of [await preview(), await zipHome(o.offerId)]) {
      expect(texts(html)).toMatchObject({ lfName: "Please enter your name.", intl: "1" });
    }
  }, 60_000);
});
