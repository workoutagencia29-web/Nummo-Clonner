/**
 * Fila do backup no worker (ao lado das clonagens e dos ZIPs, um por vez):
 *
 * - restauração pedida → pausa as outras filas, espera elas pararem e restaura
 *   (o pedido de restauração passa na frente dos backups);
 * - backup pedido ("Fazer backup agora" ou automático) → faz;
 * - a cada 30 s, confere se é hora do backup automático (src/server/services/backup/schedule.ts).
 */
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import {
  claimNextBackup,
  claimNextRestore,
  failInterruptedBackups,
  requestBackup,
  runBackupJob,
  runRestoreJob,
} from "@/server/services/backup/jobs";
import { type AutoBackupReason, autoBackupDue } from "@/server/services/backup/schedule";
import { getBackupSettings } from "@/server/services/backup/settings";
import { failInterruptedJobs } from "@/worker/clone/job";
import { failInterruptedExports } from "@/worker/export";
import { isIdle, workerState } from "@/worker/state";

export { failInterruptedBackups };

const POLL_MS = 1_000;
const SCHEDULE_EVERY_MS = 30_000;
/** Quanto a restauração espera uma clonagem/ZIP em andamento terminar. */
const IDLE_WAIT_MAX_MS = 15 * 60_000;

let backingUp = false;

/** Um backup (ou restauração) está rodando agora (sinal de vida do worker). */
export function isBackingUp() {
  return backingUp;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera as clonagens e ZIPs em andamento terminarem (a pausa já está ligada). */
export async function waitForIdle(maxMs = IDLE_WAIT_MAX_MS) {
  const deadline = Date.now() + maxMs;
  while (!isIdle()) {
    if (Date.now() > deadline) {
      throw new UserError(
        "Uma clonagem ou um ZIP em andamento não terminou a tempo. Espere terminar e tente restaurar de novo.",
      );
    }
    await sleep(500);
  }
}

const REASON_LABEL: Record<AutoBackupReason, string> = {
  slot: "horário do dia",
  overdue: "último automático com mais de 24 h",
  retry: "nova tentativa depois de uma falha",
};

/** Confere se é hora do backup automático e, se for, põe na fila. */
export async function checkAutoBackup(workerStartedAt: Date, now = new Date()): Promise<AutoBackupReason | null> {
  const settings = await getBackupSettings();
  if (!settings.auto) return null;
  const [pending, lastSuccess, lastAttempt] = await Promise.all([
    prisma.backup.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } }),
    prisma.backup.findFirst({
      where: { kind: "AUTO", status: "DONE" },
      orderBy: { finishedAt: { sort: "desc", nulls: "last" } },
      select: { finishedAt: true },
    }),
    prisma.backup.findFirst({
      where: { kind: "AUTO", status: { in: ["DONE", "FAILED"] } },
      orderBy: { finishedAt: { sort: "desc", nulls: "last" } },
      select: { finishedAt: true, status: true },
    }),
  ]);
  if (pending) return null;
  const reason = autoBackupDue({
    now,
    auto: settings.auto,
    hour: settings.hour,
    workerStartedAt,
    lastSuccessAt: lastSuccess?.finishedAt ?? null,
    lastAttemptAt: lastAttempt?.finishedAt ?? null,
    lastAttemptFailed: lastAttempt?.status === "FAILED",
  });
  if (!reason) return null;
  try {
    await requestBackup("AUTO");
  } catch (err) {
    // Restauração em andamento: fica para a próxima conferência.
    if (err instanceof UserError) return null;
    throw err;
  }
  console.log(`[worker] backup automático (${REASON_LABEL[reason]}).`);
  return reason;
}

/** Restaura (com as outras filas em pausa) e depois acerta o que ficou "rodando" no backup. */
async function restore(id: string) {
  workerState.paused = true;
  backingUp = true;
  try {
    console.log(`[worker] restaurando backup ${id}`);
    const ok = await runRestoreJob(id, { waitIdle: () => waitForIdle() });
    if (ok) {
      // Clonagens e ZIPs que estavam rodando quando o backup foi feito não vão terminar.
      await failInterruptedJobs().catch((err) => console.error("[worker] depois da restauração:", err));
      await failInterruptedExports().catch((err) => console.error("[worker] depois da restauração:", err));
      console.log("[worker] backup restaurado.");
    }
  } finally {
    backingUp = false;
    workerState.paused = false;
  }
}

export async function backupLoop(stopping: () => boolean, workerStartedAt: Date) {
  let nextScheduleAt = 0;
  while (!stopping()) {
    try {
      const restoreId = await claimNextRestore();
      if (restoreId) {
        await restore(restoreId);
        continue;
      }
      const job = await claimNextBackup();
      if (job) {
        backingUp = true;
        console.log(`[worker] fazendo backup ${job.id} (${job.kind})`);
        try {
          await runBackupJob(job.id);
        } catch (err) {
          console.error(`[worker] backup ${job.id} falhou:`, err instanceof Error ? err.message : err);
        } finally {
          backingUp = false;
        }
        continue;
      }
      if (Date.now() >= nextScheduleAt) {
        nextScheduleAt = Date.now() + SCHEDULE_EVERY_MS;
        await checkAutoBackup(workerStartedAt);
      }
    } catch (err) {
      console.error("[worker] erro na fila de backup:", err);
    }
    await sleep(POLL_MS);
  }
}
