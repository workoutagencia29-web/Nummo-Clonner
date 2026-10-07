import { PrismaPg } from "@prisma/adapter-pg";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

/**
 * Cliente Prisma único por processo. Em desenvolvimento o Next recarrega módulos,
 * então guardamos a instância em globalThis para não abrir conexões a cada edição.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, max: 10 });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Cliente do banco ou uma transação aberta: serviços que aceitam `db` podem
 * fazer parte de uma operação maior (ex.: o funil em 1 clique cria páginas e
 * links numa transação só).
 */
export type Db = Prisma.TransactionClient;

/** Roda `fn` numa transação: a de `db`, se já for uma, ou uma nova. */
export function atomically<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db === prisma ? prisma.$transaction(fn) : fn(db);
}
