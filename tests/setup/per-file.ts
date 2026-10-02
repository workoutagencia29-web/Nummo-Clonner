/**
 * Antes de cada arquivo de teste: limpa as tabelas do app (mantém a estrutura).
 */
import { afterAll, beforeAll } from "vitest";
import { prisma } from "@/lib/db";

export async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations'`;
  if (!tables.length) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`truncate table ${list} restart identity cascade`);
}

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});
