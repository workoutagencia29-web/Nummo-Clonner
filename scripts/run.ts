/**
 * Liga o Offer Studio inteiro com um comando:
 *   npm run dev   → modo desenvolvimento (recarrega ao editar o código)
 *   npm start     → modo uso diário (compila se preciso, mais rápido)
 *
 * Sobe, nesta ordem: PostgreSQL embutido → migrations → painel (Next.js) → worker
 * (robô de tarefas) → servidor de prévia (porta do painel + 1).
 * Ctrl+C (ou fechar a janela do atalho) desliga tudo com segurança.
 *
 * Se o worker ou a prévia caírem, eles são religados sozinhos (com espera
 * crescente entre as tentativas); o painel continua no ar. Só a queda do painel
 * ou do banco de dados desliga o Offer Studio.
 *
 * Variáveis opcionais: PORT, OS_DB_NAME (nome do banco — os testes E2E usam
 * "offerstudio_e2e" para não mexer nos seus dados),
 * OS_OPEN_BROWSER=0 para não abrir o navegador.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, globSync, statSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databaseUrl, ensureDatabase, startPostgres } from "./lib/postgres";
import { DB_NAME, ensureEnvFile, migrateDeploy, postgresConfig, ROOT, readEnvFile, run } from "./lib/project";

const mode = process.argv[2] === "prod" ? "prod" : "dev";
const supervisors: Supervisor[] = [];
let shuttingDown = false;

function log(msg: string) {
  console.log(`\x1b[35m[offer-studio]\x1b[0m ${msg}`);
}

/** true se algum arquivo de código for mais novo que o último build. */
function buildIsStale(): boolean {
  const buildId = path.join(ROOT, ".next", "BUILD_ID");
  if (!existsSync(buildId)) return true;
  const builtAt = statSync(buildId).mtimeMs;
  const sources = globSync(["src/**/*", "prisma/schema.prisma", "package.json", "next.config.ts"], {
    cwd: ROOT,
  });
  return sources.some((f) => statSync(path.join(ROOT, f)).mtimeMs > builtAt);
}

// ─── Supervisão dos processos ────────────────────────────────────────────────

export interface RestartPolicy {
  /** Espera antes da 1ª nova tentativa (dobra a cada queda seguida). */
  initialDelayMs: number;
  /** Espera máxima entre tentativas. */
  maxDelayMs: number;
  /** Rodando por mais que isso, a queda seguinte volta a esperar o mínimo. */
  stableAfterMs: number;
}

export const DEFAULT_RESTART: RestartPolicy = { initialDelayMs: 1000, maxDelayMs: 30_000, stableAfterMs: 60_000 };

/** Espera antes da tentativa `attempt` (0 = primeira): 1 s, 2 s, 4 s… até o máximo. */
export function restartDelay(attempt: number, policy: RestartPolicy = DEFAULT_RESTART) {
  return Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** Math.max(0, attempt));
}

function describeExit(code: number | null, signal: NodeJS.Signals | null) {
  return code !== null ? `código ${code}` : `sinal ${signal ?? "desconhecido"}`;
}

export interface SuperviseOptions {
  name: string;
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  stdio?: "inherit" | "ignore" | "pipe";
  /**
   * true: se o processo cair, é religado sozinho com espera crescente.
   * false: a queda chama `onFatal` (o app inteiro desliga).
   */
  restart: boolean;
  policy?: RestartPolicy;
  log: (msg: string) => void;
  onFatal: (name: string) => void;
  /** Quando true, quedas são esperadas (desligando): nada de religar nem avisar. */
  isStopping: () => boolean;
  onSpawn?: (child: ChildProcess) => void;
  onExit?: (child: ChildProcess) => void;
}

export interface Supervisor {
  readonly name: string;
  /** Processo atual (troca a cada religamento). */
  current(): ChildProcess | null;
  /** Quantas vezes foi religado. */
  restarts(): number;
  /** Cancela um religamento agendado e encerra o processo atual. */
  stop(signal?: NodeJS.Signals): void;
}

/**
 * Sobe um processo filho e cuida dele. Worker e prévia são religados quando
 * caem (uma falha num site clonado não pode derrubar o painel); o painel não.
 */
export function supervise(opts: SuperviseOptions): Supervisor {
  const policy = opts.policy ?? DEFAULT_RESTART;
  let child: ChildProcess | null = null;
  let timer: NodeJS.Timeout | null = null;
  let attempt = 0;
  let restarts = 0;
  let stopped = false;

  const spawnOnce = () => {
    timer = null;
    if (stopped || opts.isStopping()) return;
    const startedAt = Date.now();
    const proc = spawn(opts.cmd, opts.args, {
      cwd: opts.cwd ?? ROOT,
      env: { ...process.env, ...opts.env },
      stdio: opts.stdio ?? "inherit",
    });
    child = proc;
    opts.onSpawn?.(proc);
    let handled = false;
    const onDown = (reason: string) => {
      if (handled) return;
      handled = true;
      opts.onExit?.(proc);
      if (child === proc) child = null;
      if (stopped || opts.isStopping()) return;
      if (!opts.restart) {
        opts.log(`${opts.name} parou (${reason}). Desligando o restante…`);
        opts.onFatal(opts.name);
        return;
      }
      if (Date.now() - startedAt >= policy.stableAfterMs) attempt = 0;
      const delay = restartDelay(attempt, policy);
      attempt++;
      const secs = delay < 1000 ? `${delay} ms` : `${Math.round(delay / 1000)} s`;
      opts.log(`${opts.name} parou inesperadamente (${reason}). Religando em ${secs}… O painel continua funcionando.`);
      timer = setTimeout(() => {
        restarts++;
        spawnOnce();
      }, delay);
    };
    proc.on("exit", (code, signal) => onDown(describeExit(code, signal)));
    // Falha ao iniciar (comando não encontrado etc.): pode não haver "exit".
    proc.on("error", (err) => onDown(err.message));
  };

  spawnOnce();
  return {
    name: opts.name,
    current: () => child,
    restarts: () => restarts,
    stop(signal = "SIGTERM") {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      child?.kill(signal);
    },
  };
}

function startChild(
  name: string,
  cmd: string,
  args: string[],
  env: Record<string, string>,
  { restart = false }: { restart?: boolean } = {},
) {
  const supervisor = supervise({
    name,
    cmd,
    args,
    env,
    restart,
    log,
    onFatal: () => void shutdown(1),
    isStopping: () => shuttingDown,
  });
  supervisors.push(supervisor);
  return supervisor;
}

/**
 * O banco roda fora dos processos acima (embutido, ou de outra janela). Se ele
 * parar de aceitar conexões por um tempo, nada mais funciona: desliga tudo com
 * uma mensagem clara em vez de deixar o painel dando erro.
 */
function watchPostgres(port: number, { everyMs = 5000, failuresToStop = 3 } = {}) {
  let failures = 0;
  const check = () =>
    new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port });
      const done = (ok: boolean) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(3000, () => done(false));
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });
  const timer = setInterval(() => {
    void check().then((ok) => {
      if (shuttingDown) return;
      failures = ok ? 0 : failures + 1;
      if (failures >= failuresToStop) {
        clearInterval(timer);
        log("O banco de dados parou de responder. Desligando o Offer Studio — abra de novo pelo atalho.");
        void shutdown(1);
      }
    });
  }, everyMs);
  timer.unref();
}

let pgStop: () => Promise<void> = async () => {};

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("Desligando…");
  // Encerra cada processo (e cancela religamentos agendados).
  for (const s of supervisors) s.stop("SIGTERM");
  await new Promise((r) => setTimeout(r, 1500));
  await pgStop().catch(() => {});
  process.exit(code);
}

/** Porta ocupada vira uma mensagem clara em vez de um erro do Next em inglês. */
function assertPortFree(port: number, what: string) {
  return new Promise<void>((resolve, reject) => {
    const server = net
      .createServer()
      .once("error", (err: NodeJS.ErrnoException) => {
        reject(
          err.code === "EADDRINUSE"
            ? new Error(
                `A porta ${port} (usada por ${what}) já está ocupada: o Offer Studio provavelmente já está aberto em outra janela do Terminal. Use essa janela (http://localhost:${port}) ou feche-a e abra o Offer Studio de novo. Se for outro programa usando a porta, feche esse programa.`,
              )
            : err,
        );
      })
      .once("listening", () => server.close(() => resolve()))
      .listen(port, "127.0.0.1");
  });
}

async function waitForHttp(url: string, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  ensureEnvFile(log);
  const fileEnv = readEnvFile();
  const env: Record<string, string | undefined> = { ...fileEnv, ...process.env };
  // O banco sempre fica na pasta de dados do .env; DATA_DIR vindo de fora (testes)
  // só muda onde o app guarda arquivos.
  const cfg = postgresConfig(fileEnv);
  const port = env.PORT || "3000";

  const pg = await startPostgres(cfg, log);
  pgStop = pg.stop;

  // OS_DB_NAME permite usar outro banco (testes E2E usam um banco separado).
  const dbName = process.env.OS_DB_NAME || DB_NAME;
  const dbUrl = databaseUrl(cfg, dbName);
  await ensureDatabase(cfg, dbName);
  // Cliente do banco desatualizado (schema mudou numa atualização) → gera de novo.
  const client = path.join(ROOT, "src/generated/prisma/client.ts");
  const schema = path.join(ROOT, "prisma/schema.prisma");
  if (!existsSync(client) || statSync(schema).mtimeMs > statSync(client).mtimeMs) {
    log("Gerando o cliente do banco…");
    await run("npx", ["prisma", "generate"], { quiet: true });
  }
  log("Conferindo migrations…");
  await migrateDeploy(dbUrl);

  // O servidor de prévia usa a porta seguinte à do painel (3000 → 3001).
  const previewPort = process.env.PREVIEW_PORT || String(Number(port) + 1);
  const appEnv: Record<string, string> = {
    DATABASE_URL: dbUrl,
    PORT: port,
    PREVIEW_PORT: previewPort,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL?.replace(/:\d+$/, `:${port}`) ?? `http://localhost:${port}`,
  };

  await assertPortFree(Number(port), "o painel");
  await assertPortFree(Number(previewPort), "a prévia");

  // Worker: mais linhas de trabalho para disco (o Node usa 4). Um pedido a uma
  // pasta de backup de rede ou disco externo que travou prende uma delas até o
  // disco responder; com folga, clonagens, ZIPs e restauração seguem andando.
  const workerEnv: Record<string, string> = {
    ...appEnv,
    UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || "16",
  };

  if (mode === "prod") {
    if (buildIsStale()) {
      log("Compilando o painel (só acontece depois de atualizações)…");
      await run("npx", ["next", "build"], { env: { ...appEnv, NODE_ENV: "production" } });
    }
    startChild("Painel", "npx", ["next", "start", "-H", "127.0.0.1", "-p", port], {
      ...appEnv,
      NODE_ENV: "production",
    });
    startChild(
      "Worker",
      "npx",
      ["tsx", "src/worker/index.ts"],
      { ...workerEnv, NODE_ENV: "production" },
      { restart: true },
    );
    startChild(
      "Prévia",
      "npx",
      ["tsx", "src/preview/server.ts"],
      { ...appEnv, NODE_ENV: "production" },
      { restart: true },
    );
  } else {
    startChild("Painel", "npx", ["next", "dev", "-H", "127.0.0.1", "-p", port], appEnv);
    startChild("Worker", "npx", ["tsx", "watch", "--clear-screen=false", "src/worker/index.ts"], workerEnv, {
      restart: true,
    });
    startChild("Prévia", "npx", ["tsx", "watch", "--clear-screen=false", "src/preview/server.ts"], appEnv, {
      restart: true,
    });
  }
  watchPostgres(cfg.port);

  const url = `http://localhost:${port}`;
  if (await waitForHttp(`${url}/api/health`)) {
    log(`✔ Offer Studio no ar: ${url}`);
    if (process.env.OS_OPEN_BROWSER !== "0" && mode === "prod") {
      const browser = preferredBrowser();
      if (!browser) {
        log(
          "Dica: a prévia das páginas não abre no Safari. Use o Chrome, o Edge, o Brave ou o Firefox no Offer Studio.",
        );
      }
      spawn("open", browser ? ["-a", browser, url] : [url], { stdio: "ignore", detached: true }).unref();
    }
  } else {
    log("O painel está demorando para responder. Veja as mensagens acima.");
  }
}

/**
 * Navegador para abrir o painel. O Safari não abre endereços *.localhost (a
 * prévia das páginas), então preferimos outro navegador instalado; sem nenhum,
 * fica o padrão do Mac.
 */
export function preferredBrowser(
  apps = ["Google Chrome", "Microsoft Edge", "Brave Browser", "Firefox", "Arc"],
  dirs = ["/Applications", path.join(os.homedir(), "Applications")],
): string | null {
  for (const app of apps) {
    if (dirs.some((dir) => existsSync(path.join(dir, `${app}.app`)))) return app;
  }
  return null;
}

// Só liga o app quando executado direto (os testes importam supervise()).
const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
  process.on("SIGHUP", () => void shutdown(0));

  main().catch(async (err) => {
    console.error("✖ Não foi possível iniciar:", err instanceof Error ? err.message : err);
    await shutdown(1);
  });
}
