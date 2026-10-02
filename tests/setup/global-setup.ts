/**
 * Antes de todos os testes unitários: liga o PostgreSQL embutido (ou reaproveita
 * o que já está rodando), cria o banco desta execução e aplica as migrations.
 * No fim, apaga o banco.
 */
import { databaseUrl, dropDatabase, recreateDatabase, startPostgres } from "../../scripts/lib/postgres";
import { migrateDeploy, postgresConfig, readEnvFile } from "../../scripts/lib/project";

export default async function setup() {
  const dbName = process.env.OS_TEST_DB_NAME;
  if (!dbName) throw new Error("OS_TEST_DB_NAME não definido (veja vitest.config.ts)");
  const cfg = postgresConfig(readEnvFile());
  const pg = await startPostgres(cfg, () => {});
  await recreateDatabase(cfg, dbName);
  await migrateDeploy(databaseUrl(cfg, dbName));
  return async () => {
    await dropDatabase(cfg, dbName).catch(() => {});
    await pg.stop();
  };
}
