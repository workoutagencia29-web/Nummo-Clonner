/**
 * Executa um comando com o PostgreSQL embutido ligado e desliga ao terminar.
 * Uso: npx tsx scripts/with-db.ts [--db offerstudio_test] -- <comando> [args…]
 * Ex.:  npm run db:migrate -- --name add_x
 */
import { spawn } from "node:child_process";
import { databaseUrl, ensureDatabase, startPostgres } from "./lib/postgres";
import { DB_NAME, ensureEnvFile, postgresConfig, ROOT, readEnvFile } from "./lib/project";

async function main() {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf("--");
  const opts = sep >= 0 ? argv.slice(0, sep) : [];
  const command = sep >= 0 ? argv.slice(sep + 1) : argv;
  if (!command.length) throw new Error("Informe o comando depois de --");
  const dbIdx = opts.indexOf("--db");
  const dbName = dbIdx >= 0 ? opts[dbIdx + 1] : DB_NAME;

  ensureEnvFile();
  const cfg = postgresConfig(readEnvFile());
  const pg = await startPostgres(cfg, () => {});
  let code = 1;
  try {
    await ensureDatabase(cfg, dbName);
    code = await new Promise<number>((resolve) => {
      const child = spawn(command[0], command.slice(1), {
        cwd: ROOT,
        stdio: "inherit",
        env: { ...process.env, DATABASE_URL: databaseUrl(cfg, dbName) },
      });
      child.on("exit", (c) => resolve(c ?? 1));
    });
  } finally {
    await pg.stop();
  }
  process.exit(code);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
