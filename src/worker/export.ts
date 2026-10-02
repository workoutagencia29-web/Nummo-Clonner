/**
 * Fila do "Baixar ZIP" no worker: roda ao lado das clonagens (um ZIP por vez),
 * para um ZIP não esperar uma clonagem longa terminar. Com a fila vazia, limpa
 * os ZIPs antigos (ao iniciar e a cada 6 horas).
 */
import { prisma } from "@/lib/db";
import {
  claimNextExport,
  cleanupExports,
  failInterruptedExports,
  GENERIC_FAILURE_MESSAGE,
  runExportJob,
} from "@/server/services/export/jobs";
import { isPaused, workerState } from "@/worker/state";

export { failInterruptedExports };

const POLL_MS = 1_000;
const CLEANUP_EVERY_MS = 6 * 60 * 60 * 1000;
const CLEANUP_RETRY_MS = 15 * 60 * 1000;

let current: string | null = null;

/** Um ZIP está sendo gerado agora (sinal de vida do worker). */
export function isExporting() {
  return current !== null;
}

/** Marca como falha um ZIP que escapou do tratamento normal (ex.: banco fora do ar no meio). */
async function failLater(id: string) {
  for (const delay of [1_000, 5_000, 30_000]) {
    await new Promise((r) => setTimeout(r, delay));
    try {
      await prisma.export.updateMany({
        where: { id, status: "RUNNING" },
        data: { status: "FAILED", step: null, errorMessage: GENERIC_FAILURE_MESSAGE, finishedAt: new Date() },
      });
      return;
    } catch {
      // banco ainda fora: tenta de novo
    }
  }
}

export async function exportLoop(stopping: () => boolean) {
  let nextCleanup = 0;
  while (!stopping()) {
    // Restauração de backup em andamento: nada de pegar ZIPs nem limpar arquivos.
    if (isPaused()) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }
    // Ocupado desde já: a restauração não pode começar entre olhar a pausa e pegar o ZIP.
    workerState.exporting = true;
    try {
      current = await claimNextExport();
      if (current) {
        console.log(`[worker] gerando ZIP ${current}`);
        await runExportJob(current);
        current = null;
        workerState.exporting = false;
        continue;
      }
      if (Date.now() >= nextCleanup) {
        try {
          const report = await cleanupExports();
          if (report.rows || report.files) {
            console.log(`[worker] limpeza de ZIPs: ${report.rows} registro(s), ${report.files} arquivo(s) apagado(s).`);
          }
          nextCleanup = Date.now() + CLEANUP_EVERY_MS;
        } catch (err) {
          console.error("[worker] a limpeza dos ZIPs falhou; nova tentativa depois:", err);
          nextCleanup = Date.now() + CLEANUP_RETRY_MS;
        }
      }
    } catch (err) {
      console.error("[worker] erro na fila de ZIPs:", err);
      if (current) void failLater(current);
      current = null;
    }
    workerState.exporting = false;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
