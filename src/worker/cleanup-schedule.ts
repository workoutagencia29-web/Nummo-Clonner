/**
 * Quando o worker roda a limpeza automática dos arquivos de clonagens antigas
 * (src/server/services/clone-cleanup.ts) e das sessões vencidas de "Testar
 * pixels" (src/server/services/pixel-test.ts): logo que o worker fica livre depois
 * de iniciar e, depois, a cada 6 horas — sempre entre uma clonagem e outra,
 * nunca durante uma. Se a limpeza falhar (banco fora do ar) ou precisar adiar
 * os arquivos baixados, tenta de novo mais cedo.
 */
import { type CleanupReport, cleanupCloneArtifacts, describeCleanup } from "@/server/services/clone-cleanup";
import { cleanupPixelTestSessions } from "@/server/services/pixel-test";

export const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Nova tentativa depois de uma falha ou de arquivos adiados. */
export const CLEANUP_RETRY_MS = 15 * 60 * 1000;

export interface CleanupScheduleOptions {
  intervalMs?: number;
  retryMs?: number;
  /** Relógio (testes). */
  now?: () => number;
  run?: () => Promise<CleanupReport>;
  log?: (line: string) => void;
  onError?: (err: unknown) => void;
}

/** Arquivos de clonagens antigas + sessões vencidas da tela "Testar pixels" (com os passos delas). */
async function defaultCleanup(): Promise<CleanupReport> {
  const report = await cleanupCloneArtifacts();
  try {
    const sessions = await cleanupPixelTestSessions();
    if (sessions) console.log(`[worker] limpeza: ${sessions} teste(s) de pixels vencido(s) apagado(s).`);
  } catch (err) {
    console.error("[worker] não foi possível apagar os testes de pixels vencidos:", err);
  }
  return report;
}

export function createCleanupSchedule(opts: CleanupScheduleOptions = {}) {
  const intervalMs = opts.intervalMs ?? CLEANUP_INTERVAL_MS;
  const retryMs = opts.retryMs ?? CLEANUP_RETRY_MS;
  const now = opts.now ?? Date.now;
  const run = opts.run ?? defaultCleanup;
  const log = opts.log ?? ((line: string) => console.log(`[worker] ${line}`));
  const onError =
    opts.onError ??
    ((err: unknown) => console.error("[worker] a limpeza automática falhou; nova tentativa depois:", err));

  /** Momento em que a próxima limpeza pode rodar (0: logo na primeira chance). */
  let nextAt = 0;
  let running = false;

  return {
    /**
     * Roda a limpeza se chegou a hora. Chamar só com o worker livre (sem
     * clonagem em andamento). Nunca lança erro; devolve true se rodou.
     */
    async runIfDue(): Promise<boolean> {
      const startedAt = now();
      if (running || startedAt < nextAt) return false;
      running = true;
      try {
        const report = await run();
        const line = describeCleanup(report);
        if (line) log(line);
        nextAt = startedAt + (report.assetsDeferred ? retryMs : intervalMs);
      } catch (err) {
        onError(err);
        nextAt = startedAt + retryMs;
      } finally {
        running = false;
      }
      return true;
    },
    /** Próxima execução prevista (diagnóstico e testes). */
    nextRunAt: () => nextAt,
  };
}
