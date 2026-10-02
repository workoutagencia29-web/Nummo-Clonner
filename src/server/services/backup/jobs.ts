/**
 * Filas do backup e da restauração (tabelas Backup e BackupRestore), executadas
 * pelo worker como os ZIPs: pega o próximo pedido com FOR UPDATE SKIP LOCKED,
 * grava andamento e etapa em pt-BR, e o que estava rodando quando o worker
 * parou vira "Falhou" com mensagem clara.
 *
 * Só o worker importa este arquivo (e ./archive, ./restore).
 */
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { UserError } from "@/lib/errors";
import {
  assertFolderResponding,
  BACKUP_STALL_MS,
  BACKUP_STEP,
  createBackupArchive,
  folderStalled,
  withinStall,
} from "./archive";
import { appVersion } from "./context";
import type { BackupKindValue } from "./format";
import { applyRetention, forgetManifest, removeStaleTemps } from "./listing";
import { prismaQueryable } from "./queue";
import { RESTORE_STEP, restoreBackup } from "./restore";
import { assertOutsideDataDirAsync, getBackupSettings, getInstallId, resolveBackupFolder } from "./settings";

export { requestBackup } from "./queue";

import { appliedMigrations } from "./tables";

export const BACKUP_INTERRUPTED_MESSAGE =
  "O Offer Studio foi fechado enquanto o backup era feito. Clique em “Fazer backup agora” para tentar de novo.";
export const RESTORE_INTERRUPTED_MESSAGE =
  "O Offer Studio foi fechado durante a restauração, antes de terminar. Nada foi alterado: seus dados continuam como estavam. Tente de novo.";
export const RESTORE_FAILED_MESSAGE =
  "Não foi possível restaurar o backup. Nada foi alterado: seus dados continuam como estavam.";

/** Quantas linhas do histórico de backups guardar. */
const HISTORY_KEPT = 100;
/** Temporários de backup esquecidos (processo derrubado) saem depois disso. */
const STALE_TEMP_MS = 6 * 60 * 60 * 1000;
/** Ao abrir o worker, a limpeza da pasta de backup não espera mais que isso (pasta de rede travada). */
const STARTUP_FOLDER_MS = 30_000;

/** Pega o próximo backup da fila (atômico). */
export async function claimNextBackup(): Promise<{ id: string; kind: BackupKindValue } | null> {
  const rows = await prisma.$queryRaw<{ id: string; kind: BackupKindValue }[]>`
    update "Backup" set status = 'RUNNING', "startedAt" = now(), progress = 1, step = ${BACKUP_STEP.database}
    where id = (
      select id from "Backup" where status = 'QUEUED' order by "createdAt" asc, id asc limit 1 for update skip locked
    )
    returning id, kind::text as kind`;
  return rows[0] ?? null;
}

/** Pega o próximo pedido de restauração (atômico). */
export async function claimNextRestore(): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    update "BackupRestore" set status = 'RUNNING', "startedAt" = now(), progress = 1, step = ${RESTORE_STEP.waiting}
    where id = (
      select id from "BackupRestore" where status = 'QUEUED' order by "createdAt" asc, id asc limit 1 for update skip locked
    )
    returning id`;
  return rows[0]?.id ?? null;
}

/**
 * Apaga as pastas temporárias de restaurações que não estão rodando
 * (<DATA_DIR>/tmp/restore-<id>: worker fechado no meio da conferência).
 * `olderThanMs` protege uma pasta recém-criada sem pedido (restauração direta).
 */
export async function removeRestoreLeftovers(
  opts: { tmpRoot?: string; olderThanMs?: number; now?: number } = {},
): Promise<number> {
  const tmpRoot = opts.tmpRoot ?? path.join(/*turbopackIgnore: true*/ env.dataDir, "tmp");
  let names: string[];
  try {
    names = (await readdir(tmpRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && e.name.startsWith("restore-"))
      .map((e) => e.name);
  } catch {
    return 0;
  }
  if (!names.length) return 0;
  const running = new Set(
    (await prisma.backupRestore.findMany({ where: { status: "RUNNING" }, select: { id: true } })).map((r) => r.id),
  );
  const now = opts.now ?? Date.now();
  let removed = 0;
  for (const name of names) {
    if (running.has(name.slice("restore-".length))) continue;
    const full = path.join(tmpRoot, name);
    if (opts.olderThanMs) {
      const info = await stat(full).catch(() => null);
      if (!info || now - info.mtimeMs < opts.olderThanMs) continue;
    }
    await rm(full, { recursive: true, force: true }).catch(() => undefined);
    removed++;
  }
  return removed;
}

/** Backups e restaurações que estavam rodando quando o worker parou viram falha (ao iniciar o worker). */
export async function failInterruptedBackups(): Promise<{ backups: number; restores: number }> {
  const backups = await prisma.backup.updateMany({
    where: { status: "RUNNING" },
    data: { status: "FAILED", step: null, errorMessage: BACKUP_INTERRUPTED_MESSAGE, finishedAt: new Date() },
  });
  const restores = await prisma.backupRestore.updateMany({
    where: { status: "RUNNING" },
    data: { status: "FAILED", step: null, errorMessage: RESTORE_INTERRUPTED_MESSAGE, finishedAt: new Date() },
  });
  // Cópias que uma restauração interrompida deixou na pasta temporária (podem ser gigabytes).
  await removeRestoreLeftovers().catch((err) => console.error("[backup] sobras de restauração:", err));
  try {
    const folder = resolveBackupFolder(await getBackupSettings()).path;
    // Um pedido anterior a essa pasta ainda não voltou: não prende mais um.
    if (!folderStalled(folder)) await withinStall(removeStaleTemps(folder, STALE_TEMP_MS), STARTUP_FOLDER_MS, folder);
  } catch {
    // pasta indisponível ou que não responde: fica para depois (o worker não espera)
  }
  return { backups: backups.count, restores: restores.count };
}

async function saveBackupProgress(id: string, progress: number, step: string) {
  try {
    await prisma.backup.updateMany({
      where: { id, status: "RUNNING" },
      data: { progress: Math.max(1, Math.min(99, Math.round(progress))), step },
    });
  } catch (err) {
    console.error(`[backup ${id}] andamento:`, err);
  }
}

async function saveRestoreProgress(id: string, progress: number, step: string) {
  try {
    await prisma.backupRestore.updateMany({
      where: { id, status: "RUNNING" },
      data: { progress: Math.max(1, Math.min(99, Math.round(progress))), step },
    });
  } catch (err) {
    console.error(`[restore ${id}] andamento:`, err);
  }
}

async function pruneHistory() {
  const old = await prisma.backup.findMany({
    where: { status: { in: ["DONE", "FAILED"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: HISTORY_KEPT,
    select: { id: true },
  });
  if (old.length) await prisma.backup.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
  const oldRestores = await prisma.backupRestore.findMany({
    where: { status: { in: ["DONE", "FAILED"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: 20,
    select: { id: true },
  });
  if (oldRestores.length)
    await prisma.backupRestore.deleteMany({ where: { id: { in: oldRestores.map((r) => r.id) } } });
}

export interface RunBackupOptions {
  /** Pasta (padrão: a das configurações). */
  folder?: string;
  storageRoot?: string;
  onProgress?: (progress: number, step: string) => void;
  /** Sem avançar por esse tempo (pasta ou disco que não responde), desiste. Padrão: BACKUP_STALL_MS. */
  stallMs?: number;
}

/**
 * Executa um backup já pego da fila (RUNNING). Devolve o caminho do arquivo ou
 * lança UserError — a linha fica DONE ou FAILED com a mensagem em pt-BR.
 */
export async function runBackupJob(id: string, opts: RunBackupOptions = {}): Promise<string> {
  const row = await prisma.backup.findUnique({ where: { id }, select: { kind: true, status: true } });
  if (!row || row.status !== "RUNNING") throw new UserError("Backup não encontrado.");
  try {
    const settings = await getBackupSettings();
    const resolved = resolveBackupFolder(settings);
    const folder = opts.folder ?? resolved.path;
    if (!opts.folder && resolved.unavailable) throw new UserError(resolved.unavailable);
    // Daqui em diante, tudo que toca a pasta tem limite de tempo (pasta de rede
    // ou disco externo que já não responde): o pedido falha com mensagem clara.
    const stallMs = opts.stallMs ?? BACKUP_STALL_MS;
    // Um pedido anterior a essa pasta ainda não voltou (disco ou rede travados):
    // falha na hora, sem tocar nela — cada tentativa prenderia mais uma das
    // poucas linhas de trabalho de disco do worker.
    assertFolderResponding(folder);
    // Pasta escolhida: confere de novo (pode ter virado um link para dentro da pasta de dados).
    if (!opts.folder && resolved.preset === "custom")
      await withinStall(assertOutsideDataDirAsync(folder), stallMs, folder);
    await withinStall(
      removeStaleTemps(folder, STALE_TEMP_MS).catch(() => 0),
      stallMs,
      folder,
    );
    const created = await createBackupArchive({
      folder,
      kind: row.kind,
      installId: await getInstallId(),
      storageRoot: opts.storageRoot,
      stallMs,
      onProgress: (progress, step) => {
        opts.onProgress?.(progress, step);
        return saveBackupProgress(id, progress, step);
      },
    });
    await prisma.backup.updateMany({
      where: { id, status: "RUNNING" },
      data: {
        status: "DONE",
        progress: 100,
        step: BACKUP_STEP.done,
        filePath: created.filePath,
        bytes: BigInt(created.bytes),
        offerCount: created.manifest.summary.offers,
        warnings: created.warnings,
        errorMessage: null,
        finishedAt: new Date(),
      },
    });
    forgetManifest(created.filePath);
    if (row.kind === "AUTO") {
      try {
        // Restauração na fila ou rodando: nada é apagado agora (o backup escolhido
        // pode ser justamente o mais antigo). A limpeza fica para o próximo automático.
        const pendingRestores = await prisma.backupRestore.findMany({
          where: { status: { in: ["QUEUED", "RUNNING"] } },
          select: { sourcePath: true },
        });
        if (pendingRestores.length) {
          console.log("[worker] limpeza dos automáticos antigos adiada: há uma restauração pedida.");
        } else {
          const history = await prisma.backup.findMany({
            where: { kind: "AUTO", status: "DONE", filePath: { not: null } },
            select: { filePath: true, bytes: true },
          });
          const migrations = await appliedMigrations(prismaQueryable);
          const deleted = await withinStall(
            applyRetention(folder, {
              installId: created.manifest.installId,
              keep: settings.keep,
              appVersion: appVersion(),
              migrations,
              protect: [created.filePath],
              knownAuto: history.map((h) => ({ filePath: h.filePath as string, bytes: h.bytes })),
            }),
            stallMs,
            folder,
          );
          if (deleted.length) console.log(`[worker] backups automáticos antigos apagados: ${deleted.length}.`);
        }
      } catch (err) {
        console.error("[backup] limpeza dos automáticos antigos:", err);
      }
    }
    await pruneHistory().catch(() => undefined);
    return created.filePath;
  } catch (err) {
    const message = err instanceof UserError ? err.message : "Não foi possível fazer o backup. Tente de novo.";
    if (!(err instanceof UserError)) console.error(`[backup ${id}] falhou:`, err);
    await prisma.backup
      .updateMany({
        where: { id, status: "RUNNING" },
        data: { status: "FAILED", step: null, errorMessage: message, finishedAt: new Date() },
      })
      .catch((e) => console.error(`[backup ${id}] não foi possível gravar a falha:`, e));
    throw err instanceof UserError ? err : new UserError(message);
  }
}

/** A instalação tem algo a proteger (conta ou ofertas)? Sem nada, a restauração dispensa o backup de segurança. */
export async function installHasData(): Promise<boolean> {
  const [users, offers] = await Promise.all([prisma.user.count(), prisma.offer.count()]);
  return users > 0 || offers > 0;
}

export interface RunRestoreOptions {
  storageRoot?: string;
  tmpRoot?: string;
  /** Espera as outras tarefas do worker terminarem (pausa já ligada). */
  waitIdle?: () => Promise<void>;
  /** Pasta do backup de segurança (padrão: a das configurações). */
  safetyFolder?: string;
}

/**
 * Executa uma restauração já pega da fila (RUNNING): espera as tarefas em
 * andamento, confere o arquivo, faz o backup de segurança e troca os dados.
 * Nunca lança: o resultado fica na linha (DONE é gravado na mesma transação).
 */
export async function runRestoreJob(id: string, opts: RunRestoreOptions = {}): Promise<boolean> {
  const row = await prisma.backupRestore.findUnique({
    where: { id },
    select: { sourcePath: true, status: true, manifestSha256: true },
  });
  if (!row || row.status !== "RUNNING") return false;
  const progress = (value: number, step: string) => saveRestoreProgress(id, value, step);
  try {
    if (opts.waitIdle) {
      await progress(1, RESTORE_STEP.waiting);
      await opts.waitIdle();
    }
    await restoreBackup({
      filePath: row.sourcePath,
      expectedManifestSha256: row.manifestSha256,
      restoreId: id,
      storageRoot: opts.storageRoot,
      tmpRoot: opts.tmpRoot,
      onProgress: progress,
      safetyBackup: async (onFraction) => {
        if (!(await installHasData())) return null;
        const safety = await prisma.backup.create({
          data: { kind: "SAFETY", status: "RUNNING", startedAt: new Date(), step: BACKUP_STEP.database, progress: 1 },
          select: { id: true },
        });
        try {
          return await runBackupJob(safety.id, {
            folder: opts.safetyFolder,
            storageRoot: opts.storageRoot,
            onProgress: (value) => onFraction(value / 100),
          });
        } catch (err) {
          const reason = err instanceof UserError ? err.message : "erro inesperado.";
          throw new UserError(
            `Não foi possível fazer o backup de segurança antes de restaurar: ${reason} Nada foi alterado.`,
          );
        }
      },
    });
    return true;
  } catch (err) {
    let message = err instanceof UserError ? err.message : RESTORE_FAILED_MESSAGE;
    if (!(err instanceof UserError)) console.error(`[restore ${id}] falhou:`, err);
    if (err instanceof UserError && !/Nada foi alterado/.test(message)) message = `${message} Nada foi alterado.`;
    await prisma.backupRestore
      .updateMany({
        where: { id, status: "RUNNING" },
        data: { status: "FAILED", step: null, errorMessage: message, finishedAt: new Date() },
      })
      .catch((e) => console.error(`[restore ${id}] não foi possível gravar a falha:`, e));
    return false;
  } finally {
    await pruneHistory().catch(() => undefined);
  }
}
