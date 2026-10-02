/**
 * data#16 / security#9 — limpeza automática dos arquivos de clonagens antigas
 * (uploads de ZIP/HTML, clones/<jobId>/, sobras de tmp e arquivos baixados sem
 * uso), sem nunca apagar o que uma oferta salva usa.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { CloneStatus as JobStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { packProject } from "@/lib/project-data";
import { deleteObject, putContentAddressed, putObject, storagePath } from "@/lib/storage";
import { getCloneStatus } from "@/server/services/clone";
import { cleanupCloneArtifacts, describeCleanup, EXPIRED_CODE, EXPIRED_MESSAGE } from "@/server/services/clone-cleanup";
import { resetDatabase } from "../setup/per-file";

const DAY = 24 * 60 * 60 * 1000;
const written = new Set<string>();

beforeEach(async () => {
  await resetDatabase();
  // Sobras de execuções anteriores na pasta de dados dos testes não entram na conta.
  await cleanupCloneArtifacts();
});

afterAll(async () => {
  for (const key of written) await deleteObject(key).catch(() => {});
});

const exists = (key: string) => existsSync(storagePath(key));

/** Arquivo "baixado" (endereçado por hash) com conteúdo único. */
async function asset(ext = "png") {
  const stored = await putContentAddressed(randomBytes(64), ext);
  written.add(stored.key);
  return stored;
}

async function upload(ext: "zip" | "html") {
  const key = `uploads/${randomUUID()}.${ext}`;
  await putObject(key, randomBytes(128));
  written.add(key);
  return key;
}

async function makeJob(opts: {
  status: JobStatus;
  daysAgo: number;
  parentJobId?: string;
  offerId?: string | null;
  uploadKey?: string | null;
  assets?: { key: string; sha256: string }[];
  thumbnailKey?: string;
}) {
  const job = await prisma.cloneJob.create({
    data: {
      source: opts.uploadKey ? "ZIP" : "URL",
      sourceUrl: opts.uploadKey ? null : "https://loja.exemplo.com/",
      uploadKey: opts.uploadKey ?? null,
      status: opts.status,
      parentJobId: opts.parentJobId ?? null,
      offerId: opts.offerId ?? null,
    },
  });
  const htmlKey = `clones/${job.id}/desktop-editable.html`;
  const shotKey = `clones/${job.id}/desktop.jpg`;
  await putObject(htmlKey, "<html><body>cópia</body></html>");
  await putObject(shotKey, randomBytes(256));
  written.add(htmlKey);
  written.add(shotKey);
  await prisma.cloneJob.update({
    where: { id: job.id },
    data: {
      result: {
        title: "Página",
        finalUrl: "https://loja.exemplo.com/",
        responsive: true,
        devices: {
          desktop: {
            screenshotKey: shotKey,
            outputs: { EDITABLE: { htmlKey }, PRESERVE_JS: { htmlKey, assetMap: {} } },
          },
        },
        assets: (opts.assets ?? []).map((a) => ({ ...a, kind: "IMAGE", mime: "image/png", bytes: 64, sourceUrl: "x" })),
        thumbnailKey: opts.thumbnailKey,
      },
    },
  });
  // updatedAt no passado = clonagem parada há N dias.
  await prisma.$executeRaw`update "CloneJob" set "updatedAt" = ${new Date(Date.now() - opts.daysAgo * DAY)} where id = ${job.id}`;
  return job;
}

async function ageFile(full: string, days: number) {
  const t = new Date(Date.now() - days * DAY);
  await utimes(full, t, t);
}

describe("cleanupCloneArtifacts", () => {
  it("apaga arquivos de clonagens antigas e nunca os que ofertas salvas usam", async () => {
    // Arquivos baixados e onde cada um é usado.
    const inDocHtml = await asset();
    const withAssetRow = await asset();
    const inVersion = await asset();
    const inRecentReview = await asset();
    const inProject = await asset("css");
    const inSettings = await asset();
    const offerThumb = await asset("webp");
    const unused = await asset();
    const unusedThumb = await asset("webp");

    const offer = await prisma.offer.create({
      data: { name: "Salva", thumbnailKey: offerThumb.key, settings: { faviconKey: inSettings.key } },
    });
    const pageRow = await prisma.page.create({ data: { offerId: offer.id, name: "P", slug: "p", isHome: true } });
    const variant = await prisma.pageVariant.create({ data: { pageId: pageRow.id, name: "A", isControl: true } });
    const doc = await prisma.pageDocument.create({
      data: {
        variantId: variant.id,
        html: `<img src="/os-assets/${inDocHtml.sha256}.png">`,
        project: packProject({ styles: `url(/os-assets/${inProject.sha256}.css)` }),
      },
    });
    await prisma.asset.create({
      data: {
        offerId: offer.id,
        sha256: withAssetRow.sha256,
        key: withAssetRow.key,
        kind: "IMAGE",
        mime: "image/png",
        bytes: 64,
      },
    });
    const versionKey = `versions/${doc.id}/${randomUUID()}.json.gz`;
    await putObject(
      versionKey,
      gzipSync(JSON.stringify({ html: `<img src="/os-assets/${inVersion.sha256}.png">`, project: null })),
    );
    written.add(versionKey);
    await prisma.pageVersion.create({
      data: { documentId: doc.id, kind: "MANUAL", storageKey: versionKey, bytes: 10 },
    });

    // Clonagem salva há 20 dias, com upload próprio.
    const savedUpload = await upload("zip");
    const saved = await makeJob({
      status: "SAVED",
      daysAgo: 20,
      offerId: offer.id,
      uploadKey: savedUpload,
      assets: [inDocHtml, withAssetRow, inProject, inSettings],
      thumbnailKey: offerThumb.key,
    });
    // Falha antiga cujo ZIP também é usado por uma nova tentativa recente.
    const sharedUpload = await upload("zip");
    const failed = await makeJob({
      status: "FAILED",
      daysAgo: 20,
      uploadKey: sharedUpload,
      assets: [unused, inVersion, inRecentReview],
      thumbnailKey: unusedThumb.key,
    });
    const retry = await makeJob({ status: "REVIEW", daysAgo: 2, uploadKey: sharedUpload, assets: [inRecentReview] });
    // Pronta para revisar há 40 dias (com página do funil), nunca salva.
    const oldReview = await makeJob({ status: "REVIEW", daysAgo: 40 });
    const oldChild = await makeJob({ status: "REVIEW", daysAgo: 40, parentJobId: oldReview.id });
    // Pronta para revisar há 20 dias: ainda dentro do prazo de revisão (30).
    const recentReview = await makeJob({ status: "REVIEW", daysAgo: 20 });
    // Principal antiga, mas a página do funil acabou de ser clonada: a família está em uso.
    const activeParent = await makeJob({ status: "REVIEW", daysAgo: 40 });
    const activeChild = await makeJob({ status: "REVIEW", daysAgo: 0, parentJobId: activeParent.id });

    const report = await cleanupCloneArtifacts();

    // Arquivos de ofertas salvas ficam, venha a referência de onde vier.
    for (const a of [inDocHtml, withAssetRow, inVersion, inRecentReview, inProject, inSettings, offerThumb]) {
      expect(exists(a.key), a.key).toBe(true);
    }
    // Sem uso nenhum: apagados.
    expect(exists(unused.key)).toBe(false);
    expect(exists(unusedThumb.key)).toBe(false);
    expect(report.assets).toBe(2);

    // Pastas das clonagens expiradas: apagadas; das outras: mantidas.
    for (const j of [saved, failed, oldReview, oldChild])
      expect(exists(`clones/${j.id}/desktop.jpg`), j.id).toBe(false);
    for (const j of [retry, recentReview, activeParent, activeChild]) {
      expect(exists(`clones/${j.id}/desktop-editable.html`), j.id).toBe(true);
    }
    // Upload só da salva: apagado. Upload compartilhado com a nova tentativa: mantido.
    expect(exists(savedUpload)).toBe(false);
    expect(exists(sharedUpload)).toBe(true);

    // Clonagem salva continua salva; revisão abandonada vira "expirada".
    const after = await prisma.cloneJob.findMany({
      select: { id: true, status: true, errorCode: true, errorMessage: true, offerId: true },
    });
    const byId = new Map(after.map((j) => [j.id, j]));
    expect(byId.get(saved.id)).toMatchObject({ status: "SAVED", offerId: offer.id });
    expect(byId.get(oldReview.id)).toMatchObject({
      status: "FAILED",
      errorCode: EXPIRED_CODE,
      errorMessage: EXPIRED_MESSAGE,
    });
    expect(byId.get(oldChild.id)).toMatchObject({ status: "FAILED", errorCode: EXPIRED_CODE });
    expect(byId.get(recentReview.id)).toMatchObject({ status: "REVIEW" });
    expect(byId.get(activeParent.id)).toMatchObject({ status: "REVIEW" });
    expect(report).toMatchObject({ jobs: 4, expired: 2, uploads: 1 });
    expect(describeCleanup(report)).toMatch(
      /^Limpeza automática: 4 clonagens antigas, 1 arquivo enviado, 2 arquivos baixados sem uso/,
    );

    // Rodar de novo não faz nada (as clonagens ficaram marcadas).
    const again = await cleanupCloneArtifacts();
    expect(again).toMatchObject({ jobs: 0, uploads: 0, assets: 0 });
    expect(describeCleanup(again)).toBeNull();
    // A tela da clonagem expirada ainda mostra o log (e não quebra).
    expect(await getCloneStatus(oldReview.id, 0, { tail: true })).not.toBeNull();
  });

  it("com uma clonagem rodando, os arquivos baixados ficam para a próxima rodada", async () => {
    const unused = await asset();
    const failed = await makeJob({ status: "FAILED", daysAgo: 30, assets: [unused] });
    const running = await makeJob({ status: "RUNNING", daysAgo: 0 });
    const first = await cleanupCloneArtifacts();
    expect(first.assetsDeferred).toBe(true);
    expect(exists(unused.key)).toBe(true);
    expect(exists(`clones/${failed.id}/desktop.jpg`)).toBe(false);
    expect(exists(`clones/${running.id}/desktop.jpg`)).toBe(true);

    await prisma.$executeRaw`update "CloneJob" set status = 'FAILED' where id = ${running.id}`;
    const second = await cleanupCloneArtifacts();
    expect(second.assetsDeferred).toBe(false);
    expect(exists(unused.key)).toBe(false);
  });

  it("apaga sobras: uploads sem clonagem, pastas temporárias e envios interrompidos (só as antigas)", async () => {
    const orphanOld = await upload("html");
    const orphanNew = await upload("html");
    await ageFile(storagePath(orphanOld), 3);

    const tmpClone = path.join(env.dataDir, "tmp", "clone");
    const running = await makeJob({ status: "RUNNING", daysAgo: 0 });
    const staleDir = path.join(tmpClone, `interrompida-${randomUUID()}`);
    const runningDir = path.join(tmpClone, running.id);
    const freshDir = path.join(tmpClone, `recente-${randomUUID()}`);
    for (const dir of [staleDir, runningDir, freshDir]) {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "video.mp4.part"), randomBytes(512));
    }
    await ageFile(staleDir, 3);
    await ageFile(runningDir, 3);
    const partOld = path.join(env.dataDir, "tmp", `${randomUUID()}.zip.part`);
    const partNew = path.join(env.dataDir, "tmp", `${randomUUID()}.zip.part`);
    await writeFile(partOld, randomBytes(64));
    await writeFile(partNew, randomBytes(64));
    await ageFile(partOld, 3);
    // Cópias de uma restauração de backup interrompida (a que ainda está pedida fica).
    const pendingRestore = await prisma.backupRestore.create({ data: { sourcePath: "/x.zip", status: "QUEUED" } });
    const restoreOld = path.join(env.dataDir, "tmp", `restore-${randomUUID()}`);
    const restorePending = path.join(env.dataDir, "tmp", `restore-${pendingRestore.id}`);
    for (const dir of [restoreOld, restorePending]) {
      await mkdir(path.join(dir, "a"), { recursive: true });
      await writeFile(path.join(dir, "a", "x.png"), randomBytes(64));
      await ageFile(dir, 3);
    }

    await cleanupCloneArtifacts();
    expect(existsSync(restoreOld)).toBe(false);
    expect(existsSync(restorePending)).toBe(true);
    await rm(restorePending, { recursive: true, force: true });
    await prisma.backupRestore.delete({ where: { id: pendingRestore.id } });
    expect(exists(orphanOld)).toBe(false);
    expect(exists(orphanNew)).toBe(true);
    expect(existsSync(staleDir)).toBe(false);
    expect(existsSync(runningDir)).toBe(true);
    expect(existsSync(freshDir)).toBe(true);
    expect(existsSync(partOld)).toBe(false);
    expect(existsSync(partNew)).toBe(true);
    for (const p of [runningDir, freshDir, partNew]) await rm(p, { recursive: true, force: true });
  });
});
