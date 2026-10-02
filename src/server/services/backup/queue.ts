/**
 * Pedido de backup (fila na tabela Backup). Usado pelo painel ("Fazer backup
 * agora") e pelo agendamento do worker (automático).
 */
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import type { BackupKindValue } from "./format";
import type { Queryable } from "./tables";

export const QUEUED_STEP = "Na fila…";
export const RESTORE_IN_PROGRESS_MESSAGE = "Uma restauração de backup está em andamento. Espere terminar.";

/**
 * Pede um backup. Duplo clique devolve o mesmo pedido. Um manual pedido
 * enquanto o automático espera na fila toma o lugar dele (fica guardado até
 * você apagar); com o automático já rodando, o manual entra na fila depois.
 * Um automático nunca entra com outro backup pendente.
 */
export async function requestBackup(kind: Exclude<BackupKindValue, "SAFETY">): Promise<{ backupId: string }> {
  if (await prisma.backupRestore.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })) {
    throw new UserError(RESTORE_IN_PROGRESS_MESSAGE);
  }
  const pending = await prisma.backup.findMany({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, kind: true, status: true },
  });
  if (kind === "AUTO") {
    if (pending.length) return { backupId: pending[0].id };
  } else {
    const manual = pending.find((p) => p.kind === "MANUAL");
    if (manual) return { backupId: manual.id };
    const queuedAuto = pending.find((p) => p.kind === "AUTO" && p.status === "QUEUED");
    if (queuedAuto) {
      const { count } = await prisma.backup.updateMany({
        where: { id: queuedAuto.id, status: "QUEUED" },
        data: { kind: "MANUAL" },
      });
      if (count) return { backupId: queuedAuto.id };
    }
  }
  const row = await prisma.backup.create({ data: { kind, step: QUEUED_STEP }, select: { id: true } });
  return { backupId: row.id };
}

/** Consultas do Prisma no formato que as funções de estrutura do banco esperam. */
export const prismaQueryable: Queryable = {
  async query<R>(text: string, params: unknown[] = []) {
    return { rows: (await prisma.$queryRawUnsafe(text, ...params)) as R[] };
  },
};
