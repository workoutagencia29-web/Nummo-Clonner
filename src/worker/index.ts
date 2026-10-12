/**
 * Worker do Offer Studio: processo separado do painel que executa o trabalho
 * pesado. Três filas — as filas são as próprias tabelas do banco, lidas aqui
 * a cada segundo:
 * - clonagens (tabela CloneJob), até CLONE_SLOTS ao mesmo tempo, e, com a fila
 *   vazia, a limpeza automática dos arquivos de clonagens antigas (ao iniciar e
 *   a cada 6 horas);
 * - ZIPs do "Baixar ZIP" (tabela Export), um por vez, com a limpeza dos ZIPs antigos;
 * - backups (tabela Backup: "Fazer backup agora" e o automático diário) e
 *   restaurações (tabela BackupRestore), que pausam as outras duas filas.
 * Registra sinal de vida a cada 10 s, que o painel mostra em Configurações.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { backupLoop, failInterruptedBackups, isBackingUp } from "@/worker/backup";
import { createCleanupSchedule } from "@/worker/cleanup-schedule";
import { claimNextJob, deferJobFailure, failInterruptedJobs, runCloneJob, settlePendingJobs } from "@/worker/clone/job";
import { exportLoop, failInterruptedExports, isExporting } from "@/worker/export";
import { ANOTHER_WORKER_MESSAGE, acquireWorkerLock } from "@/worker/single-instance";
import { isPaused, workerState } from "@/worker/state";

const HEARTBEAT_MS = 10_000;
const POLL_MS = 1_000;
let stopping = false;
/** Quando o worker começou (o backup automático de recuperação espera um pouco depois disso). */
let startedAt = new Date();
/** Limpeza automática: só entre clonagens, nunca durante uma. */
const cleanup = createCleanupSchedule();

// Um erro solto de uma página (ou do Playwright) nunca pode derrubar o worker:
// quando ele cai, o Offer Studio inteiro é desligado junto.
process.on("unhandledRejection", (err) => {
  console.error("[worker] erro não tratado:", err);
});
process.on("uncaughtException", (err) => {
  console.error("[worker] exceção não tratada:", err);
});

async function heartbeat() {
  const info = {
    pid: process.pid,
    node: process.version,
    busy: workerState.cloning,
    exporting: isExporting(),
    backingUp: isBackingUp(),
    paused: isPaused(),
    startedAt: startedAt.toISOString(),
  };
  await prisma.serviceHeartbeat.upsert({
    where: { name: "worker" },
    create: { name: "worker", lastSeenAt: new Date(), info },
    update: { lastSeenAt: new Date(), info },
  });
}

/**
 * Clonagens ao mesmo tempo. Clonar o funil inteiro põe muitas páginas na fila
 * (quiz, roleta, loja, cada produto…); com uma de cada vez, uma loja de 20
 * produtos levaria meia hora. Cada vaga abre o próprio Chromium.
 */
const CLONE_SLOTS = Math.min(6, Math.max(1, Number(process.env.OS_CLONE_SLOTS) || 3));
let cloneBusy = 0;
/** Limpeza automática rodando: nenhuma vaga pega clonagem nova até ela acabar. */
let cleaning = false;

function setCloneBusy(delta: number) {
  cloneBusy += delta;
  workerState.cloning = cloneBusy > 0;
}

/** Uma vaga de clonagem: busca a próxima da fila e executa; repete até o processo parar. */
async function cloneSlot(slot: number) {
  while (!stopping) {
    // Restauração de backup em andamento (ou limpeza): nada de pegar clonagens.
    if (isPaused() || cleaning) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }
    let jobId: string | null = null;
    // Ocupado desde já: a restauração não pode começar entre olhar a pausa e pegar a clonagem.
    setCloneBusy(1);
    try {
      // Resultados que não puderam ser gravados (banco fora do ar por um instante).
      if (slot === 0) await settlePendingJobs();
      jobId = await claimNextJob();
      if (jobId) {
        console.log(`[worker] clonando ${jobId}`);
        await runCloneJob(jobId);
        continue;
      }
      // Fila vazia e nenhuma outra vaga trabalhando: hora de apagar arquivos de clonagens antigas.
      if (cloneBusy === 1 && !cleaning) {
        cleaning = true;
        try {
          await cleanup.runIfDue();
        } finally {
          cleaning = false;
        }
      }
    } catch (err) {
      console.error("[worker] erro na fila de clonagem:", err);
      // Clonagem já pega da fila não pode ficar "rodando" para sempre.
      if (jobId) deferJobFailure(jobId);
    } finally {
      setCloneBusy(-1);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function cloneLoop() {
  await Promise.all(Array.from({ length: CLONE_SLOTS }, (_, i) => cloneSlot(i)));
}

async function main() {
  // Um worker por banco: outra janela do Offer Studio nos mesmos dados espera
  // aqui (sem marcar as tarefas da outra como interrompidas nem pegar nada).
  const lock = await acquireWorkerLock({
    onWait: () => console.log(`[worker] ${ANOTHER_WORKER_MESSAGE}`),
    // Tranca perdida (banco reiniciado): sai e é religado, pegando a tranca de novo.
    onLost: () => process.exit(1),
    stopping: () => stopping,
  });
  if (!lock) return;
  await failInterruptedJobs();
  await failInterruptedExports();
  await failInterruptedBackups();
  startedAt = new Date();
  await heartbeat();
  const timer = setInterval(() => {
    heartbeat().catch((err) => console.error("[worker] falha ao registrar sinal de vida:", err));
  }, HEARTBEAT_MS);

  console.log("[worker] pronto e aguardando tarefas.");
  void cloneLoop();
  void exportLoop(() => stopping);
  void backupLoop(() => stopping, startedAt);

  const stop = async () => {
    stopping = true;
    clearInterval(timer);
    await lock.release();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error("[worker] não foi possível iniciar:", err);
  process.exit(1);
});
