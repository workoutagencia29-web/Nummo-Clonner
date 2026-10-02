/**
 * Fila de exportações (tabela Export), executada pelo worker: pega a próxima
 * (FOR UPDATE SKIP LOCKED, como as clonagens), monta o ZIP com andamento e
 * etapa em português, grava o resultado e limpa ZIPs antigos (fica com os
 * EXPORTS_KEPT_PER_OFFER mais recentes de cada oferta).
 */
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { EXPORT_STEP, EXPORTS_KEPT_PER_OFFER } from "@/lib/export/options";
import { deleteObject, storagePath } from "@/lib/storage";
import { buildExport } from "./build";
import { EXPORTS_ROOT, exportFileKey } from "./keys";
import { parseExportOptions } from "./plan";

export { EXPORTS_ROOT, exportFileKey };

export const INTERRUPTED_MESSAGE =
  "O Offer Studio foi fechado enquanto o ZIP era gerado. Clique em “Baixar ZIP” de novo.";
export const GENERIC_FAILURE_MESSAGE = "Não foi possível gerar o ZIP. Tente de novo em alguns segundos.";

/** Mensagem clara para o que der errado na montagem. */
export function friendlyExportError(err: unknown): string {
  if (err instanceof UserError) return err.message;
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === "ENOSPC") return "Sem espaço no disco para gerar o ZIP. Libere espaço no computador e tente de novo.";
  if (code === "EACCES" || code === "EPERM") {
    return "O Offer Studio não tem permissão para gravar o ZIP na pasta de dados. Feche e abra o Offer Studio de novo.";
  }
  return GENERIC_FAILURE_MESSAGE;
}

/** Pega a próxima exportação da fila (atômico, seguro com mais de um worker). */
export async function claimNextExport(): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    update "Export" set status = 'RUNNING', "startedAt" = now(), progress = 1, step = ${EXPORT_STEP.reading}
    where id = (
      select id from "Export" where status = 'QUEUED' order by "createdAt" asc, id asc limit 1 for update skip locked
    )
    returning id`;
  return rows[0]?.id ?? null;
}

/** Exportações que estavam rodando quando o worker parou viram falha (ao iniciar o worker). */
export async function failInterruptedExports(): Promise<number> {
  const rows = await prisma.export.findMany({ where: { status: "RUNNING" }, select: { id: true, offerId: true } });
  if (!rows.length) return 0;
  const { count } = await prisma.export.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, status: "RUNNING" },
    data: { status: "FAILED", step: null, errorMessage: INTERRUPTED_MESSAGE, finishedAt: new Date() },
  });
  // ZIPs pela metade (arquivos .tmp ao lado do final).
  for (const row of rows) await removeTempFiles(row.offerId).catch(() => {});
  return count;
}

async function removeTempFiles(offerId: string) {
  const dir = storagePath(`${EXPORTS_ROOT}/${offerId}`);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) if (name.endsWith(".tmp")) await rm(path.join(dir, name), { force: true });
}

/** Grava andamento só enquanto a exportação estiver rodando (nunca derruba a montagem). */
async function saveProgress(id: string, progress: number, step: string) {
  try {
    await prisma.export.updateMany({
      where: { id, status: "RUNNING" },
      data: { progress: Math.max(1, Math.min(99, Math.round(progress))), step },
    });
  } catch (err) {
    console.error(`[export ${id}] andamento:`, err);
  }
}

/**
 * Executa uma exportação já pega da fila (RUNNING). Nunca lança: o resultado
 * (DONE ou FAILED com mensagem em português) fica na linha.
 */
export async function runExportJob(id: string): Promise<void> {
  const row = await prisma.export.findUnique({
    where: { id },
    select: { id: true, offerId: true, options: true, status: true, createdAt: true },
  });
  if (!row || row.status !== "RUNNING") return;
  const key = exportFileKey(row.offerId, row.id);
  try {
    const result = await buildExport({
      offerId: row.offerId,
      options: parseExportOptions(row.options),
      target: storagePath(key),
      requestedAt: row.createdAt,
      onProgress: (progress, step) => saveProgress(id, progress, step),
    });
    const { count } = await prisma.export.updateMany({
      where: { id, status: "RUNNING" },
      data: {
        status: "DONE",
        progress: 100,
        step: EXPORT_STEP.done,
        fileKey: key,
        bytes: Math.min(result.bytes, 2_147_483_647),
        warnings: result.warnings,
        errorMessage: null,
        finishedAt: new Date(),
      },
    });
    // Apagada (ou oferta excluída) durante a montagem: o arquivo não tem dono.
    if (!count) await deleteObject(key).catch(() => {});
  } catch (err) {
    const message = friendlyExportError(err);
    if (message === GENERIC_FAILURE_MESSAGE) console.error(`[export ${id}] falhou:`, err);
    await deleteObject(key).catch(() => {});
    await prisma.export
      .updateMany({
        where: { id, status: "RUNNING" },
        data: { status: "FAILED", step: null, errorMessage: message, finishedAt: new Date() },
      })
      .catch((e) => console.error(`[export ${id}] não foi possível gravar a falha:`, e));
  }
  await cleanupExports({ offerId: row.offerId }).catch((err) => console.error("[export] limpeza:", err));
}

export interface ExportCleanupReport {
  /** Linhas de exportação apagadas (antigas ou de ofertas na lixeira). */
  rows: number;
  /** Arquivos (ou pastas) apagados do disco. */
  files: number;
}

/**
 * Limpeza: fica com os EXPORTS_KEPT_PER_OFFER ZIPs mais recentes de cada oferta
 * (os na fila ou gerando nunca saem), apaga os ZIPs de ofertas na lixeira e as
 * pastas de ofertas excluídas de vez (depois de um dia paradas). Com `offerId`,
 * só aquela oferta (depois de cada ZIP).
 */
export async function cleanupExports({ offerId }: { offerId?: string } = {}): Promise<ExportCleanupReport> {
  const report: ExportCleanupReport = { rows: 0, files: 0 };
  const rows = await prisma.export.findMany({
    where: offerId ? { offerId } : {},
    orderBy: [{ offerId: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    select: { id: true, offerId: true, status: true, fileKey: true, offer: { select: { deletedAt: true } } },
  });
  const kept = new Map<string, number>();
  const doomed: { id: string; offerId: string; fileKey: string | null }[] = [];
  for (const r of rows) {
    if (r.status === "QUEUED" || r.status === "RUNNING") continue;
    const n = kept.get(r.offerId) ?? 0;
    if (r.offer.deletedAt || n >= EXPORTS_KEPT_PER_OFFER) doomed.push(r);
    else kept.set(r.offerId, n + 1);
  }
  if (doomed.length) {
    const { count } = await prisma.export.deleteMany({
      where: { id: { in: doomed.map((d) => d.id) }, status: { in: ["DONE", "FAILED"] } },
    });
    report.rows = count;
    for (const d of doomed) {
      await deleteObject(d.fileKey ?? exportFileKey(d.offerId, d.id)).catch(() => {});
      report.files++;
    }
  }

  // Arquivos sem linha (exportação apagada, oferta excluída de vez).
  const offerDirs = offerId ? [offerId] : await listDir(storagePath(EXPORTS_ROOT));
  for (const dirName of offerDirs) {
    let dir: string;
    try {
      dir = storagePath(`${EXPORTS_ROOT}/${dirName}`);
    } catch {
      continue;
    }
    const offer = await prisma.offer.findUnique({ where: { id: dirName }, select: { id: true } });
    if (!offer) {
      // Oferta excluída de vez: a pasta sai depois de um dia parada (uma pasta
      // nova pode ser de outro banco usando a mesma pasta de dados, como nos testes).
      if (await quietSince(dir, ORPHAN_DIR_AGE_MS)) {
        await rm(dir, { recursive: true, force: true });
        report.files++;
      }
      continue;
    }
    const live = new Set(
      (await prisma.export.findMany({ where: { offerId: dirName }, select: { id: true } })).map((r) => `${r.id}.zip`),
    );
    for (const name of await listDir(dir)) {
      const full = path.join(dir, name);
      if (name.endsWith(".zip") && !live.has(name)) {
        await rm(full, { force: true });
        report.files++;
      } else if (name.endsWith(".tmp")) {
        // Temporário esquecido (processo derrubado): só os antigos (não o de uma montagem em andamento).
        const info = await stat(full).catch(() => null);
        if (info && Date.now() - info.mtimeMs > 6 * 60 * 60 * 1000) {
          await rm(full, { force: true });
          report.files++;
        }
      }
    }
  }
  return report;
}

/** Pastas de ofertas que não existem mais: apagadas depois de 1 dia sem mudanças. */
const ORPHAN_DIR_AGE_MS = 24 * 60 * 60 * 1000;

/** A pasta e tudo dentro dela (um nível) estão sem mudanças há `ageMs`. */
async function quietSince(dir: string, ageMs: number): Promise<boolean> {
  const cutoff = Date.now() - ageMs;
  const self = await stat(dir).catch(() => null);
  if (!self || self.mtimeMs > cutoff) return false;
  for (const name of await listDir(dir)) {
    const info = await stat(path.join(dir, name)).catch(() => null);
    if (info && info.mtimeMs > cutoff) return false;
  }
  return true;
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}
