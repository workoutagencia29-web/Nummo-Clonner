/**
 * Fila de tarefas (pg-boss) compartilhada entre o painel (que enfileira) e o
 * worker (que executa). As filas ficam no próprio PostgreSQL, no schema "pgboss".
 */
import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";

/** Nomes das filas. Cada fase acrescenta as suas (clonagem, exportação, backup). */
export const QUEUES: Record<string, string> = {};

const globalForBoss = globalThis as unknown as { boss?: Promise<PgBoss> };

/** Instância única por processo, iniciada sob demanda. */
export function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.boss) {
    globalForBoss.boss = (async () => {
      const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss", max: 4 });
      boss.on("error", (err) => console.error("[fila]", err));
      await boss.start();
      for (const name of Object.values(QUEUES)) await boss.createQueue(name).catch(() => {});
      return boss;
    })();
  }
  return globalForBoss.boss;
}
