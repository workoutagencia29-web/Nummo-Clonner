/**
 * Banco compartilhado: o servidor do Postgres roda destacado e só o ÚLTIMO
 * processo da lista de usuários desliga. Antes, quem ligava desligava ao sair e
 * derrubava os outros (testes derrubando o painel aberto e vice-versa).
 *
 * Usa um cluster próprio numa pasta temporária e numa porta livre — nunca o
 * banco do app (porta 5433).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveUsers, type PostgresConfig, startPostgres } from "../../scripts/lib/postgres";

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

async function accepting(cfg: PostgresConfig) {
  const client = new pg.Client({
    host: "127.0.0.1",
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: "postgres",
    connectionTimeoutMillis: 2000,
  });
  try {
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

let cfg: PostgresConfig;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "os-pg-share-"));
  cfg = { dataDir: dir, port: await freePort(), user: "teste", password: "senha-teste-123" };
});

afterAll(async () => {
  // Garante que nada fica ligado, mesmo se um teste falhar no meio.
  const last = await startPostgres(cfg, () => {}).catch(() => null);
  for (const f of ["a", "b"]) rmSync(path.join(dir, "postgres-users", `${f}.user`), { force: true });
  await last?.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("Postgres compartilhado", () => {
  it("só o último usuário desliga; quem ligou pode sair primeiro", async () => {
    const first = await startPostgres(cfg, () => {});
    expect(first.owned).toBe(true);
    expect(await accepting(cfg)).toBe(true);

    const second = await startPostgres(cfg, () => {});
    expect(second.owned).toBe(false);
    expect(liveUsers(cfg)).toBe(2);

    await first.stop();
    expect(await accepting(cfg)).toBe(true);

    await second.stop();
    expect(await accepting(cfg)).toBe(false);
    expect(liveUsers(cfg)).toBe(0);
  }, 90_000);

  it("usuário de um processo que morreu não segura o servidor ligado", async () => {
    const handle = await startPostgres(cfg, () => {});
    writeFileSync(path.join(dir, "postgres-users", "a.user"), JSON.stringify({ pid: 999_999_9 }));
    expect(liveUsers(cfg)).toBe(1);
    await handle.stop();
    expect(await accepting(cfg)).toBe(false);
  }, 90_000);

  it("importar o embedded-postgres não atropela o desligamento de quem usa o banco (Ctrl+C)", async () => {
    // O pacote registra o async-exit-hook (process.exit na hora do SIGINT); o
    // run.ts morria logo depois do "Desligando…", sem sair da lista nem desligar o banco.
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        `import("${path.resolve("scripts/lib/postgres.ts")}").then(async (m) => { await m.loadEmbeddedPostgres(); process.on("SIGINT", () => setTimeout(() => { console.log("desligou-com-calma"); process.exit(0); }, 300)); process.kill(process.pid, "SIGINT"); setTimeout(() => {}, 5000); });`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
    });
    const code = await new Promise<number | null>((r) => child.on("exit", (c) => r(c)));
    expect(out).toContain("desligou-com-calma");
    expect(code).toBe(0);
  }, 60_000);

  it("o servidor continua de pé quando o processo que o ligou sai sem avisar", async () => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        `import("${path.resolve("scripts/lib/postgres.ts")}").then(async (m) => { await m.startPostgres(${JSON.stringify(cfg)}, () => {}); process.exit(0); });`,
      ],
      { stdio: "ignore" },
    );
    await new Promise((r) => child.on("exit", r));
    // O processo que ligou já saiu (sem stop): o servidor segue no ar.
    expect(await accepting(cfg)).toBe(true);
    // Quem entra depois usa e, sendo o último, desliga ao sair.
    const later = await startPostgres(cfg, () => {});
    expect(later.owned).toBe(false);
    await later.stop();
    expect(await accepting(cfg)).toBe(false);
  }, 90_000);
});
