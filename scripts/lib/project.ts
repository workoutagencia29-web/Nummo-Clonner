/**
 * Utilidades compartilhadas pelos scripts de linha de comando (setup, run, testes).
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import type { PostgresConfig } from "./postgres";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const ENV_FILE = path.join(ROOT, ".env");

export const DB_NAME = "offerstudio";
export const DB_TEST_NAME = "offerstudio_test";
export const DB_E2E_NAME = "offerstudio_e2e";

/** Cria o .env com segredos aleatórios na primeira execução. Nunca sobrescreve. */
export function ensureEnvFile(log: (m: string) => void = console.log) {
  if (existsSync(ENV_FILE)) return false;
  // Um .env novo tem uma senha nova: não abriria um banco que já existe.
  if (existsSync(path.join(ROOT, "data", "postgres", "PG_VERSION"))) {
    throw new Error(
      "O arquivo .env sumiu, mas já existe um banco em data/postgres. Restaure o .env original (ele guarda a senha do banco; no Finder, Cmd+Shift+. mostra arquivos ocultos). Um .env novo não abre seus dados.",
    );
  }
  const pgPassword = randomBytes(18).toString("base64url");
  const content = `# Gerado automaticamente por "npm run setup" em ${new Date().toISOString()}.
PORT=3000
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=${randomBytes(32).toString("base64url")}

PG_PORT=5433
PG_USER=offerstudio
PG_PASSWORD=${pgPassword}
DATABASE_URL=postgresql://offerstudio:${pgPassword}@127.0.0.1:5433/${DB_NAME}

APP_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}

DATA_DIR=./data
`;
  writeFileSync(ENV_FILE, content, { mode: 0o600 });
  log("Arquivo .env criado com segredos novos.");
  return true;
}

export function readEnvFile(): Record<string, string> {
  return parse(readFileSync(ENV_FILE));
}

export function resolveDataDir(env: Record<string, string | undefined>) {
  const dir = path.resolve(ROOT, env.DATA_DIR || "./data");
  for (const sub of ["", "postgres", "storage", "backups", "tmp"]) {
    mkdirSync(path.join(dir, sub), { recursive: true });
  }
  return dir;
}

export function postgresConfig(env: Record<string, string | undefined>): PostgresConfig {
  if (!env.PG_PASSWORD) throw new Error("PG_PASSWORD ausente no .env");
  return {
    dataDir: resolveDataDir(env),
    port: Number(env.PG_PORT || 5433),
    user: env.PG_USER || "offerstudio",
    password: env.PG_PASSWORD,
  };
}

/** Executa um comando e rejeita se ele terminar com erro. */
export function run(
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string | undefined>; quiet?: boolean } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: { ...process.env, ...opts.env },
      stdio: opts.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let output = "";
    child.stdout?.on("data", (d) => {
      output += d;
    });
    child.stderr?.on("data", (d) => {
      output += d;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} terminou com código ${code}\n${output}`));
    });
  });
}

/** Aplica as migrations pendentes no banco indicado (idempotente e rápido). */
export async function migrateDeploy(databaseUrl: string) {
  await run("npx", ["prisma", "migrate", "deploy"], {
    env: { DATABASE_URL: databaseUrl },
    quiet: true,
  });
}
