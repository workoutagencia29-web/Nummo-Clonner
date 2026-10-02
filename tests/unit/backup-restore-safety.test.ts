/**
 * A restauração nunca fica esperando para sempre e, quando desiste, deixa os
 * dados atuais exatamente como estavam:
 * - outra conexão usando uma tabela (leitura longa numa transação) → "ocupado"
 *   em poucos segundos, nada muda; liberou, restaura normalmente;
 * - trava no meio da transação (linha presa por outra conexão) → "ocupado";
 * - comando do banco que passa do limite → mensagem clara, nada muda;
 * - linha que não entra no meio do caminho (depois de esvaziar as tabelas) →
 *   a transação inteira é desfeita;
 * - em todos os casos a conexão da restauração some (nenhuma tranca esquecida).
 */
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { type CreatedBackup, createBackupArchive } from "@/server/services/backup/archive";
import {
  BUSY_MESSAGE,
  OLD_INCOMPATIBLE_MESSAGE,
  restoreBackup,
  TIMEOUT_MESSAGE,
} from "@/server/services/backup/restore";
import { resetDatabase } from "../setup/per-file";
import {
  cleanupRichData,
  createRichData,
  type RichData,
  rewriteArchive,
  snapshotTables,
  tempDir,
} from "./backup-fixture";
import { expectUserError } from "./helpers";

let data: RichData;
let work: string;
let backup: CreatedBackup;
let blocker: pg.Client | null = null;

async function openBlocker(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: env.DATABASE_URL, application_name: "teste-bloqueio" });
  await client.connect();
  blocker = client;
  return client;
}

async function closeBlocker() {
  if (!blocker) return;
  await blocker.query("rollback").catch(() => undefined);
  await blocker.end().catch(() => undefined);
  blocker = null;
}

/** Conexões da restauração ainda abertas (devem sumir logo depois de desistir). */
async function restoreConnections(): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and application_name = 'offer-studio-restore'`;
    if (!rows[0]?.n) return 0;
    await new Promise((r) => setTimeout(r, 100));
  }
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    select count(*)::int as n from pg_stat_activity
    where datname = current_database() and application_name = 'offer-studio-restore'`;
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  await resetDatabase();
  work = await tempDir("backup-restore-safety");
  data = await createRichData();
  backup = await createBackupArchive({
    folder: path.join(work, "backups"),
    kind: "MANUAL",
    installId: "os-teste",
  });
  // Estado "atual" diferente do backup (é ele que precisa ficar intacto quando a restauração desiste).
  await prisma.offer.create({ data: { name: "Oferta de agora" } });
}, 120_000);

afterAll(async () => {
  await closeBlocker();
  await cleanupRichData(data);
  const { rm } = await import("node:fs/promises");
  await rm(work, { recursive: true, force: true });
});

describe("restauração que não consegue terminar", () => {
  it("outra conexão lendo uma tabela numa transação: desiste rápido com “ocupado” e nada muda", async () => {
    const before = await snapshotTables();
    const other = await openBlocker();
    await other.query("begin");
    await other.query(`select count(*) from "Offer"`);

    const started = Date.now();
    await expectUserError(
      restoreBackup({
        filePath: backup.filePath,
        storageRoot: path.join(work, "storage-ocupado"),
        tmpRoot: path.join(work, "tmp"),
        timeouts: { lockWaitMs: 1_500 },
      }),
      BUSY_MESSAGE,
    );
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await restoreConnections()).toBe(0);
    await closeBlocker();
    expect(await snapshotTables()).toEqual(before);
    expect(await prisma.offer.count({ where: { name: "Oferta de agora" } })).toBe(1);

    // Liberou: a mesma restauração vai até o fim.
    await restoreBackup({
      filePath: backup.filePath,
      storageRoot: path.join(work, "storage-ocupado"),
      tmpRoot: path.join(work, "tmp"),
      timeouts: { lockWaitMs: 1_500 },
    });
    expect(await prisma.offer.count({ where: { name: "Oferta de agora" } })).toBe(0);
    expect(await prisma.offer.count({ where: { id: data.fx.offerId } })).toBe(1);
    expect(await restoreConnections()).toBe(0);
    await prisma.offer.create({ data: { name: "Oferta de agora" } });
  }, 60_000);

  it("linha presa por outra conexão no meio da transação: desiste com “ocupado” e desfaz tudo", async () => {
    const before = await snapshotTables();
    const row = await prisma.backupRestore.create({
      data: { sourcePath: backup.filePath, status: "RUNNING", startedAt: new Date() },
    });
    const other = await openBlocker();
    await other.query("begin");
    await other.query(`select id from "BackupRestore" where id = $1 for update`, [row.id]);

    const started = Date.now();
    await expectUserError(
      restoreBackup({
        filePath: backup.filePath,
        restoreId: row.id,
        storageRoot: path.join(work, "storage-linha"),
        tmpRoot: path.join(work, "tmp"),
        timeouts: { lockWaitMs: 1_500 },
      }),
      BUSY_MESSAGE,
    );
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await restoreConnections()).toBe(0);
    await closeBlocker();
    expect(await snapshotTables()).toEqual(before);
    expect((await prisma.backupRestore.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("RUNNING");
    await prisma.backupRestore.delete({ where: { id: row.id } });
  }, 60_000);

  it("comando do banco que passa do limite no meio da transação: mensagem clara e nada muda", async () => {
    await prisma.appSetting.create({ data: { key: "lixo", value: { x: 1 } } });
    const before = await snapshotTables();
    // Comando "lento": a limpeza das configurações espera uma linha presa por outra
    // conexão por mais tempo que o limite de cada comando (e menos que o de trancas).
    const other = await openBlocker();
    await other.query("begin");
    await other.query(`select key from "AppSetting" where key = 'lixo' for update`);

    const started = Date.now();
    await expectUserError(
      restoreBackup({
        filePath: backup.filePath,
        storageRoot: path.join(work, "storage-limite"),
        tmpRoot: path.join(work, "tmp"),
        timeouts: { statementMs: 1_000, lockWaitMs: 30_000 },
      }),
      TIMEOUT_MESSAGE,
    );
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await restoreConnections()).toBe(0);
    await closeBlocker();
    expect(await snapshotTables()).toEqual(before);
    await prisma.appSetting.delete({ where: { key: "lixo" } });
  }, 60_000);

  it("linha que não entra no meio do caminho (depois de esvaziar as tabelas): desfaz a transação inteira", async () => {
    const before = await snapshotTables();
    const broken = path.join(work, "linha-quebrada.zip");
    await rewriteArchive(backup.filePath, broken, {
      fixManifest: true,
      edit: (name, buf) => {
        if (name !== "db/Page.jsonl") return buf;
        const lines = buf.toString("utf8").split("\n").filter(Boolean);
        const last = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
        last.offerId = "oferta-que-nao-existe";
        lines[lines.length - 1] = JSON.stringify(last);
        return Buffer.from(`${lines.join("\n")}\n`, "utf8");
      },
    });
    await expectUserError(
      restoreBackup({
        filePath: broken,
        storageRoot: path.join(work, "storage-quebrado"),
        tmpRoot: path.join(work, "tmp"),
      }),
      OLD_INCOMPATIBLE_MESSAGE,
    );
    expect(await restoreConnections()).toBe(0);
    expect(await snapshotTables()).toEqual(before);
    expect(await prisma.offer.count({ where: { name: "Oferta de agora" } })).toBe(1);
  }, 60_000);
});
