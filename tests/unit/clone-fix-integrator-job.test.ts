/**
 * Integração das correções da Fase 2 na execução da clonagem (job.ts):
 * - G3 ux#15: ZIP/HTML cujo conteúdo é o problema (ou que foi apagado) falha
 *   com o código IMPORT_INVALID — a tela esconde "Tentar de novo".
 * - G2 data#4/ux#2: página importada sem <title> recebe o nome do ZIP (fileName
 *   chega à montagem), nunca o host interno "importado.offerstudio".
 * - G2: as origens internas vêm de um lugar só (synthetic.ts).
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { putObject } from "@/lib/storage";
import * as job from "@/worker/clone/job";
import { IMPORT_INVALID_CODE, runCloneJob } from "@/worker/clone/job";
import * as synthetic from "@/worker/clone/synthetic";
import type { CloneResult } from "@/worker/clone/types";

const TMP = path.join(env.dataDir, `tmp-clone-int-${randomBytes(4).toString("hex")}`);
const TEXT = `<p>${"Texto da oferta com bastante conteúdo para não parecer vazia. ".repeat(8)}</p>`;

let pub: http.Server;
let pp = 0;

beforeAll(async () => {
  pub = http.createServer((req) => {
    // Conexão derrubada: erro de rede comum (pode dar certo numa nova tentativa).
    req.socket.destroy();
  });
  await new Promise<void>((r) => pub.listen(0, "127.0.0.1", r));
  pp = (pub.address() as AddressInfo).port;
  process.env.OS_CLONE_HOST_MAP = "pub.int.test=127.0.0.1";
  await mkdir(TMP, { recursive: true });
}, 60_000);

afterAll(async () => {
  await new Promise((r) => pub?.close(r));
  await rm(TMP, { recursive: true, force: true });
});

async function createJob(data: {
  source: "URL" | "ZIP" | "HTML";
  sourceUrl?: string;
  uploadKey?: string;
  fileName?: string;
}) {
  const { fileName, ...rest } = data;
  return prisma.cloneJob.create({
    data: { ...rest, options: { devices: ["desktop"], maxVideoMb: 20, ...(fileName ? { fileName } : {}) } },
  });
}

async function runAndGet(jobId: string) {
  await runCloneJob(jobId);
  return prisma.cloneJob.findUniqueOrThrow({ where: { id: jobId } });
}

async function zipFiles(files: Record<string, string>) {
  const dir = path.join(TMP, randomBytes(4).toString("hex"));
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), body);
  }
  const file = path.join(TMP, `${randomBytes(4).toString("hex")}.zip`);
  execFileSync("zip", ["-r", "-q", "-X", file, ...Object.keys(files)], { cwd: dir });
  const key = `uploads/int-${path.basename(file)}`;
  await putObject(key, await readFile(file));
  return key;
}

describe("G3 ux#15 — importação inválida não oferece 'Tentar de novo' (IMPORT_INVALID)", () => {
  it("ZIP sem nenhum .html: FAILED com IMPORT_INVALID e a mensagem do leitor de ZIP", async () => {
    const key = await zipFiles({ "estilo.css": "body{color:red}", "foto.txt": "x" });
    const done = await runAndGet((await createJob({ source: "ZIP", uploadKey: key })).id);
    expect(done.status).toBe("FAILED");
    expect(done.errorCode).toBe(IMPORT_INVALID_CODE);
    expect(done.errorMessage).toBe("Não encontrei nenhum arquivo .html no ZIP.");
  }, 60_000);

  it("arquivo que não é ZIP: IMPORT_INVALID", async () => {
    const key = `uploads/int-${randomBytes(4).toString("hex")}.zip`;
    await putObject(key, Buffer.from("isto não é um zip"));
    const done = await runAndGet((await createJob({ source: "ZIP", uploadKey: key })).id);
    expect(done.status).toBe("FAILED");
    expect(done.errorCode).toBe(IMPORT_INVALID_CODE);
    expect(done.errorMessage).toMatch(/não é um ZIP válido/);
  }, 60_000);

  it("ZIP já apagado (limpeza automática): IMPORT_INVALID e mensagem clara, não 'corrompido ou malicioso'", async () => {
    const done = await runAndGet(
      (await createJob({ source: "ZIP", uploadKey: `uploads/int-sumiu-${randomBytes(4).toString("hex")}.zip` })).id,
    );
    expect(done.status).toBe("FAILED");
    expect(done.errorCode).toBe(IMPORT_INVALID_CODE);
    expect(done.errorMessage).toMatch(/não está mais disponível/);
    expect(done.errorMessage).not.toMatch(/malicioso/);
  }, 60_000);

  it("HTML colado já apagado: IMPORT_INVALID, não o erro genérico", async () => {
    const done = await runAndGet(
      (await createJob({ source: "HTML", uploadKey: `uploads/int-sumiu-${randomBytes(4).toString("hex")}.html` })).id,
    );
    expect(done.status).toBe("FAILED");
    expect(done.errorCode).toBe(IMPORT_INVALID_CODE);
    expect(done.errorMessage).toMatch(/HTML colado não está mais disponível/);
  }, 60_000);

  it("erro de rede num link continua com o código ERROR (tentar de novo pode resolver)", async () => {
    const done = await runAndGet((await createJob({ source: "URL", sourceUrl: `http://pub.int.test:${pp}/` })).id);
    expect(done.status).toBe("FAILED");
    expect(done.errorCode).toBe("ERROR");
  }, 120_000);
});

describe("G2 data#4 / ux#2 — nome do ZIP chega à montagem", () => {
  it("página sem <title> importada de ZIP recebe o nome do arquivo, nunca o host interno", async () => {
    const key = await zipFiles({
      "index.html": `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>Oferta</h1>${TEXT}</body></html>`,
    });
    const done = await runAndGet(
      (await createJob({ source: "ZIP", uploadKey: key, fileName: "Oferta de Verão.zip" })).id,
    );
    expect(done.status, done.errorMessage ?? "").toBe("REVIEW");
    const result = done.result as unknown as CloneResult;
    expect(result.title).toBe("Oferta de Verão");
    expect(result.title).not.toMatch(/offerstudio/);
  }, 120_000);

  it("job.ts reexporta as origens internas de synthetic.ts (uma definição só)", () => {
    expect(job.IMPORT_ORIGIN).toBe(synthetic.IMPORT_ORIGIN);
    expect(job.PASTE_ORIGIN).toBe(synthetic.PASTE_ORIGIN);
  });
});
