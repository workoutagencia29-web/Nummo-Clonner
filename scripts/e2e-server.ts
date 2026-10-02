/**
 * Servidor usado pelos testes E2E (Playwright): recria o banco
 * "offerstudio_e2e_auto" do zero, liga os sites de teste do clonador (porta
 * 4556, *.fixture.test) e sobe o app em modo produção na porta 3200.
 * Seus dados reais (banco "offerstudio") nunca são tocados.
 */
import { spawn } from "node:child_process";
import { startFixtureServer } from "../tests/fixtures/server";
import { recreateDatabase, startPostgres } from "./lib/postgres";
import { postgresConfig, ROOT, readEnvFile } from "./lib/project";

export const E2E_DB = "offerstudio_e2e_auto";
export const E2E_PORT = "3200";
export const FIXTURE_PORT = 4556;

async function main() {
  const cfg = postgresConfig(readEnvFile());
  const pg = await startPostgres(cfg, () => {});
  await recreateDatabase(cfg, E2E_DB);
  const fixtures = await startFixtureServer(FIXTURE_PORT);
  // O run.ts reaproveita o Postgres que já está no ar; quem desliga somos nós.
  const child = spawn("npx", ["tsx", "scripts/run.ts", "prod"], {
    cwd: ROOT,
    stdio: "inherit",
    // Arquivos dos testes ficam em data/e2e, separados dos seus.
    env: {
      ...process.env,
      OS_DB_NAME: E2E_DB,
      PORT: E2E_PORT,
      OS_OPEN_BROWSER: "0",
      DATA_DIR: "./data/e2e",
      // O clonador resolve *.fixture.test para os sites de teste locais.
      OS_CLONE_HOST_MAP: "*.fixture.test=127.0.0.1",
    },
  });
  const stop = async () => {
    child.kill("SIGTERM");
    await fixtures.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => {
    void pg.stop().finally(() => process.exit(code ?? 0));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
