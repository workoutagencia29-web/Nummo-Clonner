/**
 * Gerencia o PostgreSQL embutido (pacote npm `embedded-postgres`).
 *
 * O banco roda a partir dos binários oficiais do PostgreSQL 18 que vêm dentro de
 * node_modules, com os dados em <DATA_DIR>/postgres. Nada é instalado no sistema.
 *
 * - Se o cluster ainda não existe, é criado (initdb) com collation ICU pt-BR, para
 *   ordenar nomes com acento corretamente.
 * - Se já existe um Postgres respondendo na porta (o app, os testes ou o robô),
 *   ele é reaproveitado.
 * - O servidor roda destacado (pg_ctl) e é compartilhado: quem usa entra numa
 *   lista e, ao sair, só o ÚLTIMO desliga. Assim uma rodada de testes nunca
 *   derruba o app aberto (nem o contrário).
 */
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

export interface PostgresConfig {
  dataDir: string;
  port: number;
  user: string;
  password: string;
}

export interface PostgresHandle {
  /** true quando fomos nós que ligamos o servidor nesta chamada. */
  owned: boolean;
  /**
   * Sai da lista de quem usa o banco. O servidor só é desligado quando ninguém
   * mais da lista está usando (o último a sair apaga a luz).
   */
  stop: () => Promise<void>;
}

function adminClient(cfg: PostgresConfig, database = "postgres") {
  return new pg.Client({
    host: "127.0.0.1",
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database,
    connectionTimeoutMillis: 3000,
  });
}

async function isAcceptingConnections(cfg: PostgresConfig): Promise<boolean> {
  const client = adminClient(cfg);
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

/**
 * O pacote `embedded-postgres` registra, ao ser importado, o `async-exit-hook`:
 * ouvintes de SIGINT/SIGTERM/SIGHUP/exit que chamam `process.exit()` na hora.
 * Isso atropelava o desligamento de quem usa o banco (o run.ts morria logo
 * depois do "Desligando…", sem sair da lista de usuários nem desligar o banco).
 * Aqui o pacote só cria o cluster (initdb); quem liga e desliga é o pg_ctl. Por
 * isso ele é importado só quando preciso e os ouvintes que ele deixou saem.
 */
export async function loadEmbeddedPostgres() {
  const events = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK", "exit", "beforeExit", "message"] as const;
  const before = new Map(events.map((e) => [e, process.listeners(e as NodeJS.Signals)]));
  const mod = await import("embedded-postgres");
  for (const e of events) {
    const old = before.get(e) ?? [];
    for (const listener of process.listeners(e as NodeJS.Signals)) {
      if (!old.includes(listener)) process.removeListener(e, listener);
    }
  }
  return mod.default;
}

export async function startPostgres(
  cfg: PostgresConfig,
  log: (msg: string) => void = console.log,
): Promise<PostgresHandle> {
  const clusterDir = path.join(cfg.dataDir, "postgres");
  return withUsersLock(cfg, async () => {
    // Entra na lista ANTES de olhar a porta: quem estiver saindo agora vê que
    // ainda tem gente usando e não desliga o servidor.
    const ticket = registerUser(cfg);
    const handle = (owned: boolean): PostgresHandle => ({ owned, stop: () => releaseUser(cfg, ticket) });

    if (await isAcceptingConnections(cfg)) {
      log(`PostgreSQL já está rodando na porta ${cfg.port}.`);
      return handle(false);
    }

    removeStalePidFile(clusterDir, log);
    if (!existsSync(path.join(clusterDir, "PG_VERSION"))) {
      log("Criando o banco de dados pela primeira vez…");
      const serverLog: string[] = [];
      const EmbeddedPostgres = await loadEmbeddedPostgres();
      const instance = new EmbeddedPostgres({
        databaseDir: clusterDir,
        port: cfg.port,
        user: cfg.user,
        password: cfg.password,
        authMethod: "scram-sha-256",
        persistent: true,
        initdbFlags: ["--encoding=UTF8", "--locale=C", "--locale-provider=icu", "--icu-locale=pt-BR"],
        onLog: (message) => {
          for (const line of message.split("\n")) if (/FATAL|PANIC|HINT/.test(line)) serverLog.push(line.trim());
        },
      });
      try {
        await instance.initialise();
      } catch {
        releaseUserSync(ticket);
        throw new Error(explainStartFailure(serverLog, cfg.port));
      }
    }

    // O servidor roda destacado (pg_ctl): não morre junto com o processo que o
    // ligou — outros (painel, testes, robô) podem estar usando o mesmo banco.
    const logFile = path.join(cfg.dataDir, "postgres.log");
    try {
      await pgCtl([
        "start",
        "-D",
        clusterDir,
        "-w",
        "-t",
        "60",
        "-l",
        logFile,
        "-o",
        `-p ${cfg.port} -c listen_addresses=127.0.0.1`,
      ]);
    } catch {
      // Outro processo pode ter ligado o servidor ao mesmo tempo.
      if (await waitForConnections(cfg, 15_000)) {
        log(`PostgreSQL já está rodando na porta ${cfg.port}.`);
        return handle(false);
      }
      releaseUserSync(ticket);
      throw new Error(explainStartFailure(tailLines(logFile, 30), cfg.port));
    }
    writeFileSync(detachedMarker(cfg), String(Date.now()));
    log(`PostgreSQL iniciado na porta ${cfg.port}.`);
    return handle(true);
  });
}

// ─── Quem está usando o banco ────────────────────────────────────────────────
// Cada processo que liga (ou reaproveita) o banco ganha um arquivo em
// <DATA_DIR>/postgres-users. Ao sair, apaga o seu; o último a sair desliga o
// servidor — mas só se ele foi ligado por este código (marcador "detached").
// Processos que morreram sem avisar são descobertos pelo PID e ignorados.

function usersDir(cfg: PostgresConfig) {
  return path.join(cfg.dataDir, "postgres-users");
}

function detachedMarker(cfg: PostgresConfig) {
  return path.join(usersDir(cfg), ".detached");
}

function registerUser(cfg: PostgresConfig): string {
  const dir = usersDir(cfg);
  mkdirSync(dir, { recursive: true });
  const ticket = path.join(dir, `${process.pid}-${randomUUID().slice(0, 8)}.user`);
  writeFileSync(ticket, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  return ticket;
}

function releaseUserSync(ticket: string) {
  try {
    unlinkSync(ticket);
  } catch {
    // já saiu
  }
}

function isAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: o processo existe, só não é nosso.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Quantos usuários vivos há na lista (apaga os de processos que já morreram). */
export function liveUsers(cfg: PostgresConfig): number {
  const dir = usersDir(cfg);
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".user")) continue;
    const file = path.join(dir, name);
    let pid = 0;
    try {
      pid = Number((JSON.parse(readFileSync(file, "utf8")) as { pid?: number }).pid);
    } catch {
      pid = Number(name.split("-")[0]);
    }
    if (isAlive(pid)) count++;
    else {
      try {
        unlinkSync(file);
      } catch {
        // outro processo limpou antes
      }
    }
  }
  return count;
}

async function releaseUser(cfg: PostgresConfig, ticket: string) {
  await withUsersLock(cfg, async () => {
    releaseUserSync(ticket);
    if (liveUsers(cfg) > 0) return;
    // Ninguém mais usa: desliga, se foi este código que ligou (destacado).
    if (!existsSync(detachedMarker(cfg))) return;
    try {
      await pgCtl(["stop", "-D", path.join(cfg.dataDir, "postgres"), "-m", "fast", "-w", "-t", "60"]);
    } catch {
      // já estava desligado
    }
    try {
      unlinkSync(detachedMarker(cfg));
    } catch {
      // ok
    }
  });
}

/**
 * Trava simples entre processos (mkdir é atômico): ligar/desligar e entrar/sair
 * da lista acontecem um de cada vez. Trava esquecida por um processo que morreu
 * (mais de 2 minutos) é descartada.
 */
async function withUsersLock<T>(cfg: PostgresConfig, fn: () => Promise<T>): Promise<T> {
  mkdirSync(usersDir(cfg), { recursive: true });
  const lock = path.join(usersDir(cfg), ".lock");
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 120_000) rmSync(lock, { recursive: true, force: true });
      } catch {
        // sumiu entre as duas chamadas
      }
      if (Date.now() > deadline) throw new Error("O banco de dados está ocupado ligando ou desligando. Tente de novo.");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

async function pgCtlPath(): Promise<string> {
  const mod = (await import(`@embedded-postgres/${process.platform}-${process.arch}`)) as { pg_ctl: string };
  return mod.pg_ctl;
}

async function pgCtl(args: string[]) {
  const bin = await pgCtlPath();
  await new Promise<void>((resolve, reject) => {
    execFile(bin, args, { env: { ...process.env, LC_MESSAGES: "C" }, timeout: 90_000 }, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

async function waitForConnections(cfg: PostgresConfig, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await isAcceptingConnections(cfg)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function tailLines(file: string, n: number): string[] {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => /FATAL|PANIC|HINT/.test(l))
      .slice(-n);
  } catch {
    return [];
  }
}

/** Traduz as mensagens do Postgres para uma explicação em português. */
function explainStartFailure(lines: string[], port: number) {
  const text = lines.join(" ");
  if (/could not (create|bind).*(socket|address)|Address already in use/i.test(text)) {
    return `O banco de dados não iniciou: a porta ${port} está ocupada por outro programa. Feche outros Offer Studio abertos ou reinicie o Mac.`;
  }
  if (/lock file .* already exists/i.test(text)) {
    return "O banco de dados não iniciou: outro Offer Studio parece estar usando a pasta data/postgres. Feche as outras janelas do atalho.";
  }
  if (/permission denied/i.test(text)) {
    return "O banco de dados não iniciou: sem permissão para acessar a pasta data/postgres.";
  }
  return `O banco de dados não iniciou.${lines.length ? ` Detalhe: ${lines.slice(-3).join(" ")}` : ""}`;
}

/**
 * Depois de um desligamento brusco (falta de energia, travamento), o arquivo
 * postmaster.pid pode ficar para trás apontando para um processo que já não é o
 * Postgres. Só chamamos isto quando nada responde na porta, então é seguro apagar.
 */
function removeStalePidFile(clusterDir: string, log: (msg: string) => void) {
  const pidFile = path.join(clusterDir, "postmaster.pid");
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, "utf8").split("\n")[0]);
  let alive = false;
  if (pid > 0) {
    try {
      const comm = execFileSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" }).trim();
      alive = /postgres/i.test(comm);
    } catch {
      alive = false;
    }
  }
  if (!alive) {
    unlinkSync(pidFile);
    log("Removido um arquivo de trava antigo do banco (o Mac foi desligado com o app aberto?).");
  }
}

/** Cria o banco se ainda não existir. */
export async function ensureDatabase(cfg: PostgresConfig, name: string) {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Nome de banco inválido: ${name}`);
  const client = adminClient(cfg);
  await client.connect();
  try {
    const { rowCount } = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (!rowCount) await client.query(`create database "${name}"`);
  } finally {
    await client.end();
  }
}

/** Apaga e recria um banco (usado só pelos testes). */
export async function recreateDatabase(cfg: PostgresConfig, name: string) {
  if (!/^offerstudio_(test|e2e)[a-z0-9_]*$/.test(name)) {
    throw new Error(`Por segurança, só bancos de teste podem ser recriados: ${name}`);
  }
  const client = adminClient(cfg);
  await client.connect();
  try {
    await client.query(`drop database if exists "${name}" with (force)`);
    await client.query(`create database "${name}"`);
  } finally {
    await client.end();
  }
}

/** Apaga um banco de teste (usado ao fim dos testes). */
export async function dropDatabase(cfg: PostgresConfig, name: string) {
  if (!/^offerstudio_(test|e2e)[a-z0-9_]*$/.test(name)) {
    throw new Error(`Por segurança, só bancos de teste podem ser apagados: ${name}`);
  }
  const client = adminClient(cfg);
  await client.connect();
  try {
    await client.query(`drop database if exists "${name}" with (force)`);
  } finally {
    await client.end();
  }
}

export function databaseUrl(cfg: PostgresConfig, name: string) {
  return `postgresql://${encodeURIComponent(cfg.user)}:${encodeURIComponent(cfg.password)}@127.0.0.1:${cfg.port}/${name}`;
}
