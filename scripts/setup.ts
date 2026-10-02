/**
 * npm run setup — prepara tudo para rodar o Offer Studio no Mac.
 * Pode ser executado quantas vezes quiser: só faz o que ainda falta.
 *
 * 1. Cria o .env com segredos aleatórios (se não existir).
 * 2. Cria/inicia o PostgreSQL embutido e os bancos do app e dos testes.
 * 3. Aplica as migrations e gera o cliente Prisma.
 */
import { databaseUrl, ensureDatabase, startPostgres } from "./lib/postgres";
import { DB_NAME, DB_TEST_NAME, ensureEnvFile, migrateDeploy, postgresConfig, readEnvFile, run } from "./lib/project";

async function main() {
  console.log("▶ Preparando o Offer Studio…");
  ensureEnvFile();
  const env = readEnvFile();
  const cfg = postgresConfig(env);

  const pgHandle = await startPostgres(cfg);
  try {
    await ensureDatabase(cfg, DB_NAME);
    await ensureDatabase(cfg, DB_TEST_NAME);
    console.log("▶ Gerando o cliente do banco…");
    await run("npx", ["prisma", "generate"], { quiet: true });
    console.log("▶ Aplicando migrations…");
    await migrateDeploy(databaseUrl(cfg, DB_NAME));
    await migrateDeploy(databaseUrl(cfg, DB_TEST_NAME));
  } finally {
    await pgHandle.stop();
  }
  console.log("✔ Pronto. Use `npm run dev` (desenvolvimento) ou `npm start` (uso diário).");
}

main().catch((err) => {
  console.error("✖ Falha no setup:", err instanceof Error ? err.message : err);
  process.exit(1);
});
