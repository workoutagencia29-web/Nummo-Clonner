import { defineConfig, devices } from "@playwright/test";

/**
 * Testes de ponta a ponta: abrem o app de verdade (build de produção) num
 * navegador e clicam como um usuário. Banco próprio, recriado a cada execução.
 *
 * Ordem: "setup" cria a conta e salva a sessão → specs do painel usam a sessão →
 * "auth" (login, limite de tentativas) roda por último, porque bloqueia o login
 * por 1 minuto.
 */
const PORT = 3200;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "painel",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /auth\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "tests/.auth/user.json" },
    },
    {
      name: "auth",
      testMatch: /auth\.spec\.ts/,
      dependencies: ["painel"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npx tsx scripts/e2e-server.ts",
    url: `http://localhost:${PORT}/api/health`,
    timeout: 300_000,
    reuseExistingServer: false,
    // Desliga com SIGTERM (não SIGKILL): o e2e-server e o run.ts saem da lista de
    // usuários do Postgres compartilhado, e o último a sair desliga o banco.
    gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
    stdout: "pipe",
    stderr: "pipe",
  },
});
