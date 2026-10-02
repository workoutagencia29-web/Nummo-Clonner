/**
 * Backup → apagar tudo → restaurar: cada tabela e cada arquivo voltam iguais.
 * Também: backup de versão antiga (coluna que não existia), de versão mais nova
 * (recusado), arquivo danificado ou cortado (erro em pt-BR e nada muda) e
 * troca da chave dos tokens dos pixels (backup de outro Mac).
 */
import { randomBytes } from "node:crypto";
import { readdir, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { type CreatedBackup, createBackupArchive } from "@/server/services/backup/archive";
import {
  APP_BACKUP_NAME_RE,
  DAMAGED_MESSAGE,
  installTag,
  LOCAL_SETTING_KEYS,
  NEWER_VERSION_MESSAGE,
} from "@/server/services/backup/format";
import { readBackupManifest } from "@/server/services/backup/reader";
import { restoreBackup } from "@/server/services/backup/restore";
import { resetDatabase } from "../setup/per-file";
import {
  cleanupRichData,
  createRichData,
  fileSha,
  type RichData,
  rewriteArchive,
  STORAGE_ROOT,
  sha256,
  snapshotTables,
  TRICKY_TEXT,
  tempDir,
  wipeAppTables,
} from "./backup-fixture";
import { META_TOKEN, readZip, TIKTOK_TOKEN } from "./export-fixture";
import { expectUserError } from "./helpers";

let data: RichData;
let work: string;
let backup: CreatedBackup;
let before: Record<string, string[]>;
/** sha256 de cada arquivo que precisa voltar (chave → sha). */
let expectedFiles: Map<string, string>;

const localKeys = new Set<string>(LOCAL_SETTING_KEYS);
/** AppSetting sem as configurações deste Mac (que ficam fora do backup). */
function portable(snapshot: Record<string, string[]>): Record<string, string[]> {
  return {
    ...snapshot,
    AppSetting: (snapshot.AppSetting ?? []).filter((j) => !localKeys.has((JSON.parse(j) as { key: string }).key)),
  };
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true }).catch(() => [])) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(root, rel)));
    else out.push(rel);
  }
  return out.sort();
}

beforeAll(async () => {
  await resetDatabase();
  work = await tempDir("backup-roundtrip");
  data = await createRichData();
  before = await snapshotTables();
  backup = await createBackupArchive({
    folder: path.join(work, "backups"),
    kind: "MANUAL",
    installId: "os-teste",
    now: new Date(2026, 9, 1, 3, 0),
  });
  const entries = await readZip(backup.filePath);
  const index = (entries.get("storage-index.jsonl")?.data.toString("utf8") ?? "").split("\n").filter(Boolean);
  expectedFiles = new Map(
    index.map((l) => {
      const line = JSON.parse(l) as { key: string; sha256: string };
      return [line.key, line.sha256];
    }),
  );
}, 120_000);

afterAll(async () => {
  await cleanupRichData(data);
  await rm(work, { recursive: true, force: true });
});

describe("arquivo de backup", () => {
  it("tem o nome, o manifest e todas as tabelas do app", async () => {
    // Data e hora + marca desta instalação (dois Macs na mesma iCloud Drive nunca disputam um nome).
    expect(path.basename(backup.filePath)).toBe(`offer-studio-backup-2026-10-01-0300-${installTag("os-teste")}.zip`);
    expect(path.basename(backup.filePath)).toMatch(APP_BACKUP_NAME_RE);
    const m = await readBackupManifest(backup.filePath);
    expect(m.app).toBe("offer-studio");
    expect(m.format).toBe(1);
    expect(m.kind).toBe("MANUAL");
    expect(m.installId).toBe("os-teste");
    expect(m.migrations).toContain("20260929004228_init");
    expect(m.migrations).toContain("20261001160000_backup");
    const names = m.tables.map((t) => t.name);
    // Ordem de dependência: pais antes dos filhos.
    expect(names.indexOf("Offer")).toBeLessThan(names.indexOf("Page"));
    expect(names.indexOf("Page")).toBeLessThan(names.indexOf("PageVariant"));
    expect(names.indexOf("PageDocument")).toBeLessThan(names.indexOf("PageVersion"));
    expect(names.indexOf("user")).toBeLessThan(names.indexOf("account"));
    // Fora do backup: estado deste Mac e tabelas passageiras.
    for (const skipped of [
      "Backup",
      "BackupRestore",
      "ServiceHeartbeat",
      "_prisma_migrations",
      "session",
      "verification",
      "rateLimit",
      "PreviewToken",
    ]) {
      expect(names).not.toContain(skipped);
    }
    for (const t of m.tables) {
      const expected = t.name === "AppSetting" ? portable(before).AppSetting.length : before[t.name]?.length;
      expect(t.rows, t.name).toBe(expected);
      // Todo tipo de dado está no teste (nenhuma tabela do app vazia).
      expect(t.rows, `${t.name} sem linhas no teste`).toBeGreaterThan(0);
    }
    expect(names.sort()).toEqual(Object.keys(before).sort());
    expect(m.summary.offers).toBe(1);
    expect(m.summary.trashedOffers).toBe(1);
    expect(m.summary.pages).toBe(4);
    expect(m.summary.account?.email).toMatch(/@backup\.test$/);
    expect(m.encryption.keyFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(backup.bytes).toBeGreaterThan(1000);
  });

  it("leva os arquivos usados (até os citados só dentro de outro arquivo) e deixa de fora o resto", async () => {
    const entries = await readZip(backup.filePath);
    const keys = [...entries.keys()].filter((k) => k.startsWith("storage/")).map((k) => k.slice("storage/".length));
    const has = (key: string) => keys.includes(key);
    const fx = data.fx.files;
    const ca = (file: string) => `a/${file.slice(0, 2)}/${file}`;
    // CSS em cadeia: base → main → fonts → fonte (só citada dentro do CSS).
    for (const f of ["base", "main", "fonts", "font", "bg", "bg2", "bg3", "img1", "img2", "img3", "favicon", "og"]) {
      expect(has(ca(fx[f])), f).toBe(true);
    }
    // Preservar JS (assetMap) e o que o CSS original cita.
    for (const f of ["quizCss", "quizJs", "quizImg", "quizJson", "origCss"]) expect(has(ca(fx[f])), f).toBe(true);
    for (const key of Object.values(data.hidden)) expect(has(key), key).toBe(true);
    // Fora: envio de clonagem, ZIP gerado e arquivo sem uso.
    for (const key of Object.values(data.excluded)) expect(has(key), key).toBe(false);
    // Miniatura do card.
    const offer = await prisma.offer.findUniqueOrThrow({ where: { id: data.fx.offerId } });
    expect(has(offer.thumbnailKey as string)).toBe(true);
    // Índice confere com o conteúdo (e com o arquivo no disco).
    expect([...expectedFiles.keys()].sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(sha256((entries.get(`storage/${key}`) as { data: Buffer }).data), key).toBe(expectedFiles.get(key));
      expect(await fileSha(path.join(STORAGE_ROOT, key)), key).toBe(expectedFiles.get(key));
    }
    // Segredos: a chave dos tokens.
    const secrets = JSON.parse(entries.get("secrets.json")?.data.toString("utf8") ?? "{}");
    expect(secrets.APP_ENCRYPTION_KEY).toBe(env.APP_ENCRYPTION_KEY);
    // Nada de temporário esquecido na pasta.
    expect((await readdir(path.dirname(backup.filePath))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});

describe("restauração completa", () => {
  let fresh: string;

  it("apaga tudo, restaura e cada tabela e arquivo volta igual", async () => {
    fresh = path.join(work, "storage-novo");
    await wipeAppTables();
    // Estado "atual" diferente: outra conta, outra oferta, sessão aberta e config deste Mac.
    await prisma.user.create({ data: { id: "outro", name: "Outra", email: "outra@x.test" } });
    await prisma.session.create({
      data: { id: "s-atual", token: "t-atual", userId: "outro", expiresAt: new Date(Date.now() + 60_000) },
    });
    await prisma.offer.create({ data: { name: "Oferta que vai sumir" } });
    await prisma.appSetting.create({
      data: { key: "backup", value: { folder: "icloud", auto: true, hour: 4, keep: 7 } },
    });
    await prisma.appSetting.create({ data: { key: "install", value: { id: "os-este-mac" } } });
    await prisma.appSetting.create({ data: { key: "lixo", value: { x: 1 } } });
    await prisma.backup.create({ data: { kind: "AUTO", status: "DONE", filePath: "/tmp/y.zip" } });

    const progress: string[] = [];
    const result = await restoreBackup({
      filePath: backup.filePath,
      storageRoot: fresh,
      tmpRoot: path.join(work, "tmp"),
      onProgress: (_p, step) => void progress.push(step),
    });
    expect(result.reencrypted).toBe(0);
    expect(progress).toContain("Conferindo o arquivo de backup…");
    expect(progress).toContain("Restaurando ofertas, páginas e configurações…");

    const after = await snapshotTables();
    const exp = portable(before);
    const got = portable(after);
    for (const table of Object.keys(exp)) expect(got[table], table).toEqual(exp[table]);
    expect(Object.keys(got).sort()).toEqual(Object.keys(exp).sort());
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: data.fx.offerId } })).notes).toBe(TRICKY_TEXT);

    // Sessões encerradas; configurações deste Mac mantidas; histórico de backups intacto.
    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.previewToken.count()).toBe(0);
    expect(await prisma.rateLimit.count()).toBe(0);
    const local = await prisma.appSetting.findMany({
      where: { key: { in: ["backup", "install"] } },
      orderBy: { key: "asc" },
    });
    expect(local.map((s) => s.value)).toEqual([
      { folder: "icloud", auto: true, hour: 4, keep: 7 },
      { id: "os-este-mac" },
    ]);
    expect(await prisma.appSetting.count({ where: { key: "lixo" } })).toBe(0);
    expect(await prisma.backup.count({ where: { filePath: "/tmp/y.zip" } })).toBe(1);

    // Cada arquivo voltou, idêntico; nada além deles.
    expect(await listFiles(fresh)).toEqual([...expectedFiles.keys()].sort());
    for (const [key, sha] of expectedFiles) expect(await fileSha(path.join(fresh, key)), key).toBe(sha);
    // Pasta temporária da conferência some.
    expect(await listFiles(path.join(work, "tmp"))).toEqual([]);

    // Tokens continuam legíveis e o autoincremento continua do último número.
    const pixels = await prisma.pixelConfig.findMany({ orderBy: { vendor: "asc" } });
    expect(pixels.map((p) => decryptSecret(p.accessTokenEnc as string))).toEqual([META_TOKEN, TIKTOK_TOKEN]);
    const maxLog = await prisma.cloneLog.aggregate({ _max: { id: true } });
    const log = await prisma.cloneLog.create({
      data: {
        jobId: (await prisma.cloneJob.findFirstOrThrow({ where: { status: "SAVED", parentJobId: null } })).id,
        message: "novo",
      },
    });
    expect(log.id).toBe((maxLog._max.id ?? 0) + 1);
  }, 60_000);

  it("restaurar de novo por cima não copia nem sobrescreve arquivos", async () => {
    const shaBefore = await fileSha(path.join(fresh, data.hidden.version));
    const result = await restoreBackup({
      filePath: backup.filePath,
      storageRoot: fresh,
      tmpRoot: path.join(work, "tmp"),
    });
    expect(result.filesCopied).toBe(0);
    expect(await fileSha(path.join(fresh, data.hidden.version))).toBe(shaBefore);
    expect(portable(await snapshotTables())).toEqual(portable(before));
  }, 60_000);
});

describe("compatibilidade de versões", () => {
  it("backup de uma versão antiga (sem uma coluna nova): a coluna fica com o valor padrão", async () => {
    const old = path.join(work, "antigo.zip");
    await rewriteArchive(backup.filePath, old, {
      fixManifest: true,
      edit: (name, buf) => {
        if (name !== "db/Export.jsonl") return buf;
        const lines = buf
          .toString("utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const row = JSON.parse(l) as Record<string, unknown>;
            delete row.warnings;
            delete row.step;
            return JSON.stringify(row);
          });
        return Buffer.from(`${lines.join("\n")}\n`, "utf8");
      },
      manifest: (m) => ({
        ...m,
        appVersion: "0.0.1",
        migrations: m.migrations.filter((x) => x !== "20260930010700_export" && x !== "20261001160000_backup"),
        tables: m.tables.map((t) =>
          t.name === "Export" ? { ...t, columns: t.columns.filter((c) => c !== "warnings" && c !== "step") } : t,
        ),
      }),
    });
    await wipeAppTables();
    await restoreBackup({
      filePath: old,
      storageRoot: path.join(work, "storage-antigo"),
      tmpRoot: path.join(work, "tmp"),
    });
    const exp = await prisma.export.findFirstOrThrow();
    expect(exp.warnings).toEqual([]);
    expect(exp.step).toBeNull();
    expect(exp.fileName).toBe("oferta.zip");
    // O resto igual.
    const { Export: _a, ...restBefore } = portable(before);
    const { Export: _b, ...restAfter } = portable(await snapshotTables());
    expect(restAfter).toEqual(restBefore);
  }, 60_000);

  it("recusa backup de uma versão mais nova (app, formato ou migration desconhecida)", async () => {
    const cases: [string, (m: import("@/server/services/backup/format").BackupManifest) => unknown][] = [
      ["app", (m) => ({ ...m, appVersion: "99.0.0" })],
      ["formato", (m) => ({ ...m, format: 2 })],
      ["migration", (m) => ({ ...m, migrations: [...m.migrations, "20991231000000_futuro"] })],
    ];
    const snapshot = await snapshotTables();
    for (const [label, edit] of cases) {
      const file = path.join(work, `novo-${label}.zip`);
      await rewriteArchive(backup.filePath, file, {
        manifest: edit as (
          m: import("@/server/services/backup/format").BackupManifest,
        ) => import("@/server/services/backup/format").BackupManifest,
      });
      const fresh = path.join(work, `storage-${label}`);
      await expectUserError(restoreBackup({ filePath: file, storageRoot: fresh }), NEWER_VERSION_MESSAGE);
      expect(await listFiles(fresh)).toEqual([]);
    }
    expect(await snapshotTables()).toEqual(snapshot);
  }, 60_000);
});

describe("arquivo danificado", () => {
  let snapshot: Record<string, string[]>;
  beforeAll(async () => {
    snapshot = await snapshotTables();
  });

  async function expectUntouched(fresh: string) {
    expect(await snapshotTables()).toEqual(snapshot);
    expect(await listFiles(fresh)).toEqual([]);
    expect(await listFiles(path.join(work, "tmp"))).toEqual([]);
  }

  it("cortado no meio (download/cópia interrompida)", async () => {
    const file = path.join(work, "cortado.zip");
    await writeFile(file, await readFile(backup.filePath));
    await truncate(file, Math.floor((await stat(file)).size / 2));
    const fresh = path.join(work, "storage-cortado");
    await expectUserError(
      restoreBackup({ filePath: file, storageRoot: fresh, tmpRoot: path.join(work, "tmp") }),
      DAMAGED_MESSAGE,
    );
    await expectUntouched(fresh);
  });

  it("tabela alterada (não confere com o manifest)", async () => {
    const file = path.join(work, "tabela.zip");
    await rewriteArchive(backup.filePath, file, {
      edit: (name, buf) =>
        name === "db/Offer.jsonl" ? Buffer.from(buf.toString("utf8").replace("Oferta", "Ofertx")) : buf,
    });
    const fresh = path.join(work, "storage-tabela");
    await expectUserError(
      restoreBackup({ filePath: file, storageRoot: fresh, tmpRoot: path.join(work, "tmp") }),
      DAMAGED_MESSAGE,
    );
    await expectUntouched(fresh);
  });

  it("arquivo de imagem alterado: nada é copiado nem restaurado", async () => {
    const file = path.join(work, "imagem.zip");
    const target = `storage/${data.hidden.inVersion}`;
    await rewriteArchive(backup.filePath, file, {
      edit: (name, buf) => (name === target ? Buffer.concat([buf, Buffer.from("x")]) : buf),
    });
    const fresh = path.join(work, "storage-imagem");
    await expectUserError(
      restoreBackup({ filePath: file, storageRoot: fresh, tmpRoot: path.join(work, "tmp") }),
      DAMAGED_MESSAGE,
    );
    await expectUntouched(fresh);
  });

  it("entrada faltando e arquivo que não é backup", async () => {
    const file = path.join(work, "sem-tabela.zip");
    await rewriteArchive(backup.filePath, file, { edit: (name, buf) => (name === "db/Page.jsonl" ? null : buf) });
    await expectUserError(restoreBackup({ filePath: file, storageRoot: path.join(work, "s1") }), DAMAGED_MESSAGE);
    const notZip = path.join(work, "texto.zip");
    await writeFile(notZip, "não sou um zip");
    await expectUserError(restoreBackup({ filePath: notZip, storageRoot: path.join(work, "s2") }), DAMAGED_MESSAGE);
    const otherZip = path.join(work, "outro.zip");
    await rewriteArchive(backup.filePath, otherZip, { manifest: (m) => ({ ...m, app: "outro-app" }) as never });
    await expectUserError(
      restoreBackup({ filePath: otherZip, storageRoot: path.join(work, "s3") }),
      "Este arquivo não é um backup do Offer Studio.",
    );
    expect(await snapshotTables()).toEqual(snapshot);
  });
});

describe("chave dos tokens de outro Mac", () => {
  it("criptografa os tokens de novo com a chave deste Mac", async () => {
    await resetDatabase();
    const otherKey = randomBytes(32).toString("base64");
    await wipeAppTables();
    const result = await restoreBackup({
      filePath: backup.filePath,
      storageRoot: path.join(work, "storage-chave"),
      tmpRoot: path.join(work, "tmp"),
      encryptionKey: otherKey,
    });
    expect(result.reencrypted).toBe(2);
    const pixels = await prisma.pixelConfig.findMany({ orderBy: { vendor: "asc" } });
    expect(pixels.map((p) => decryptSecret(p.accessTokenEnc as string, otherKey))).toEqual([META_TOKEN, TIKTOK_TOKEN]);
    // Com a chave antiga não abre mais (foi trocada de verdade).
    expect(() => decryptSecret(pixels[0].accessTokenEnc as string)).toThrow();
  }, 60_000);
});
