import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { defineConfig } from "vitest/config";

/**
 * Testes unitários e de integração (serviços + banco).
 * Cada execução usa um banco próprio ("offerstudio_test_<pid>"), criado no início
 * e apagado no fim (ver tests/setup/global-setup.ts) — assim várias execuções
 * em paralelo não se atrapalham. Seus dados reais nunca são tocados.
 */
const fileEnv = parse(readFileSync(path.resolve(import.meta.dirname, ".env")));
const testDbName = `offerstudio_test_${process.pid}`;
process.env.OS_TEST_DB_NAME = testDbName;
const testDbUrl = `postgresql://${encodeURIComponent(fileEnv.PG_USER)}:${encodeURIComponent(fileEnv.PG_PASSWORD)}@127.0.0.1:${fileEnv.PG_PORT}/${testDbName}`;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/setup/empty-module.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/setup/global-setup.ts"],
    setupFiles: ["tests/setup/per-file.ts"],
    // Os testes de integração compartilham um banco: um arquivo por vez.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      ...fileEnv,
      NODE_ENV: "test",
      DATABASE_URL: testDbUrl,
      DATA_DIR: "./data/test",
    },
  },
});
