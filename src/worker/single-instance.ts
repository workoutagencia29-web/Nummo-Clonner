/**
 * Um worker por banco. A pausa durante uma restauração de backup, as tarefas
 * "rodando" que viram falha ao iniciar e a limpeza automática só funcionam se
 * houver um worker só usando estes dados. Uma segunda janela do Offer Studio
 * no mesmo banco (ex.: outra porta) espera aqui, sem tocar em nada, até a
 * primeira ser fechada.
 *
 * A tranca é do PostgreSQL (pg_try_advisory_lock) numa conexão só dela: se o
 * processo cair, o banco solta a tranca sozinho.
 */
import pg from "pg";
import { env } from "@/lib/env";

/** Chave da tranca do worker (constante do Offer Studio). */
export const WORKER_LOCK_KEY = 726_354_000;

export const ANOTHER_WORKER_MESSAGE =
  "Já existe outro Offer Studio aberto usando estes dados (outra janela do Terminal). Feche a outra janela: as tarefas (clonagens, ZIPs, backups) começam aqui assim que ela for fechada.";

export interface WorkerLock {
  release(): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Tenta pegar a tranca uma vez. Devolve a tranca ou null (outro worker está com
 * ela). `onLost`: a conexão da tranca caiu (a tranca foi solta).
 */
export async function tryWorkerLock(
  opts: { databaseUrl?: string; onLost?: (err: Error) => void } = {},
): Promise<WorkerLock | null> {
  const client = new pg.Client({
    connectionString: opts.databaseUrl ?? env.DATABASE_URL,
    application_name: "offer-studio-worker-lock",
    connectionTimeoutMillis: 15_000,
  });
  let released = false;
  client.on("error", (err) => {
    if (released) return;
    console.error("[worker] a conexão que garante um worker só caiu:", err.message);
    opts.onLost?.(err);
  });
  await client.connect();
  let ok = false;
  try {
    const res = await client.query<{ ok: boolean }>("select pg_try_advisory_lock($1::bigint) as ok", [WORKER_LOCK_KEY]);
    ok = res.rows[0]?.ok === true;
  } catch (err) {
    released = true;
    await client.end().catch(() => undefined);
    throw err;
  }
  if (!ok) {
    released = true;
    await client.end().catch(() => undefined);
    return null;
  }
  return {
    async release() {
      if (released) return;
      released = true;
      await client.query("select pg_advisory_unlock($1::bigint)", [WORKER_LOCK_KEY]).catch(() => undefined);
      await client.end().catch(() => undefined);
    },
  };
}

/**
 * Espera até ser o único worker deste banco (avisa uma vez, com `onWait`).
 * Devolve null se `stopping()` ficar verdadeiro antes.
 */
export async function acquireWorkerLock(
  opts: {
    databaseUrl?: string;
    retryMs?: number;
    onWait?: () => void;
    onLost?: (err: Error) => void;
    stopping?: () => boolean;
  } = {},
): Promise<WorkerLock | null> {
  let warned = false;
  for (;;) {
    if (opts.stopping?.()) return null;
    try {
      const lock = await tryWorkerLock({ databaseUrl: opts.databaseUrl, onLost: opts.onLost });
      if (lock) return lock;
      if (!warned) {
        warned = true;
        opts.onWait?.();
      }
    } catch (err) {
      console.error("[worker] não foi possível conferir se há outro worker:", err instanceof Error ? err.message : err);
    }
    await sleep(opts.retryMs ?? 5_000);
  }
}
