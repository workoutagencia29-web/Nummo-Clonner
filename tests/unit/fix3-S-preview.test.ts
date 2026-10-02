/**
 * Fase 3 — #4 (grupo S): o servidor de prévia não mostra páginas de ofertas na
 * lixeira, nem pelo link de um documento nem pelos arquivos de "Preservar JS".
 *
 * Sobe o servidor de prévia de verdade (src/preview/server.ts) numa porta livre,
 * apontando para o banco de testes desta execução.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { request } from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createPreviewToken } from "@/lib/preview";
import { putContentAddressed } from "@/lib/storage";
import { createOffer, trashOffer } from "@/server/services/offers";
import { resetDatabase } from "../setup/per-file";

const ROOT = path.resolve(import.meta.dirname, "../..");
let port = 0;
let child: ChildProcess | null = null;
let output = "";

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

afterAll(() => {
  child?.kill("SIGTERM");
});

beforeEach(async () => {
  await resetDatabase();
});

async function preserveJsOffer() {
  const offer = await createOffer({ name: "Quiz" });
  const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { page: { offerId: offer.id } } } });
  const js = await putContentAddressed(Buffer.from("window.quiz = 1;\n"), "js");
  await prisma.pageDocument.update({
    where: { id: doc.id },
    data: {
      html: "<!DOCTYPE html><html><head><title>Quiz</title></head><body><h1>Pergunta 1</h1></body></html>",
      assetMap: { "/js/app.js": js.key },
    },
  });
  return { offerId: offer.id, docId: doc.id };
}

describe("prévia de ofertas na lixeira (#4)", () => {
  it("link de documento: mostra fora da lixeira, 404 depois de ir para a lixeira", async () => {
    const o = await preserveJsOffer();
    const token = await createPreviewToken({ kind: "document", documentId: o.docId });
    const before = await get(token, "/");
    expect(before.status).toBe(200);
    expect(before.body).toContain("Pergunta 1");
    expect((await get(token, "/js/app.js")).body).toContain("window.quiz");

    await trashOffer(o.offerId);
    // Token novo (o servidor guarda o alvo de cada token por 30 s).
    const after = await createPreviewToken({ kind: "document", documentId: o.docId });
    const page = await get(after, "/");
    expect(page.status).toBe(404);
    expect(page.body).not.toContain("Pergunta 1");
    expect(page.body).toContain("Esta página não existe mais nesta oferta.");
    expect((await get(after, "/js/app.js")).status).toBe(404);
  });

  it("link da oferta: arquivos de 'Preservar JS' não saem depois de ir para a lixeira", async () => {
    const o = await preserveJsOffer();
    const token = await createPreviewToken({ kind: "offer", offerId: o.offerId });
    expect((await get(token, "/js/app.js")).body).toContain("window.quiz");

    await trashOffer(o.offerId);
    const after = await createPreviewToken({ kind: "offer", offerId: o.offerId });
    expect((await get(after, "/")).status).toBe(404);
    const file = await get(after, "/js/app.js");
    expect(file.status).toBe(404);
    expect(file.body).not.toContain("window.quiz");
  });
});
