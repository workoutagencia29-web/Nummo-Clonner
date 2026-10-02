/**
 * scripts/run.ts — um worker ou uma prévia que caem (ex.: uma página clonada
 * derrubou o Chromium) são religados com espera crescente e uma linha de log em
 * português; só a queda do painel (ou do banco) desliga o Offer Studio.
 */
import { afterEach, describe, expect, it } from "vitest";
import { restartDelay, type Supervisor, supervise } from "../../scripts/run";

const running: Supervisor[] = [];
afterEach(() => {
  for (const s of running.splice(0)) s.stop("SIGKILL");
});

const FAST = { initialDelayMs: 50, maxDelayMs: 200, stableAfterMs: 60_000 };

async function waitFor(check: () => boolean, timeoutMs = 10_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("tempo esgotado");
    await new Promise((r) => setTimeout(r, 20));
  }
}

function start(opts: { restart: boolean; script: string }) {
  const logs: string[] = [];
  const fatal: string[] = [];
  let spawns = 0;
  const supervisor = supervise({
    name: "Worker",
    cmd: process.execPath,
    args: ["-e", opts.script],
    stdio: "ignore",
    restart: opts.restart,
    policy: FAST,
    log: (msg) => logs.push(msg),
    onFatal: (name) => fatal.push(name),
    isStopping: () => false,
    onSpawn: () => spawns++,
  });
  running.push(supervisor);
  return { supervisor, logs, fatal, spawns: () => spawns };
}

describe("supervisão dos processos (scripts/run.ts)", () => {
  it("espera crescente entre tentativas, com teto", () => {
    expect([0, 1, 2, 3, 4, 5, 10].map((n) => restartDelay(n))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it("worker que cai é religado, com aviso em português, sem desligar o app", async () => {
    const run = start({ restart: true, script: "process.exit(3)" });
    await waitFor(() => run.spawns() >= 3);
    expect(run.fatal).toEqual([]);
    expect(run.logs[0]).toBe(
      "Worker parou inesperadamente (código 3). Religando em 50 ms… O painel continua funcionando.",
    );
    // A espera dobra a cada queda seguida.
    expect(run.logs[1]).toContain("Religando em 100 ms");
    expect(run.supervisor.restarts()).toBeGreaterThanOrEqual(2);
  });

  it("stop() cancela o religamento", async () => {
    const run = start({ restart: true, script: "process.exit(1)" });
    await waitFor(() => run.logs.length >= 1);
    run.supervisor.stop();
    const spawns = run.spawns();
    await new Promise((r) => setTimeout(r, 300));
    expect(run.spawns()).toBe(spawns);
  });

  it("processo sem religamento (painel) desliga o restante", async () => {
    const run = start({ restart: false, script: "process.exit(1)" });
    await waitFor(() => run.fatal.length > 0);
    expect(run.fatal).toEqual(["Worker"]);
    expect(run.logs).toEqual(["Worker parou (código 1). Desligando o restante…"]);
    expect(run.spawns()).toBe(1);
  });

  it("processo que continua rodando não é mexido", async () => {
    const run = start({ restart: true, script: "setTimeout(() => {}, 10000)" });
    await new Promise((r) => setTimeout(r, 300));
    expect(run.spawns()).toBe(1);
    expect(run.supervisor.current()?.exitCode).toBeNull();
    expect(run.logs).toEqual([]);
  });
});
