/**
 * Backup e restauração quando algo dá errado de verdade: arquivo estragado no
 * disco, iCloud Drive com arquivos só na nuvem, disco que para de responder ou
 * dá erro de leitura, arquivo de backup forjado (tamanhos que não conferem,
 * linha gigante, chave "/."), limpeza que apagaria o backup escolhido, pasta
 * escolhida dentro da pasta de dados, dois pedidos de restauração ao mesmo
 * tempo, backup trocado depois da confirmação e dois workers no mesmo banco.
 */
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readdir, readFile, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import yauzl from "yauzl";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { storagePath } from "@/lib/storage";
import { BACKUP_STALLED_MESSAGE, type CreatedBackup, createBackupArchive } from "@/server/services/backup/archive";
import { appVersion } from "@/server/services/backup/context";
import {
  BACKUP_FILE_RE,
  backupFileName,
  corruptFilesWarning,
  DAMAGED_MESSAGE,
  isBackupStorageKey,
  READ_IO_MESSAGE,
  READ_STALLED_MESSAGE,
  RESTORE_NO_SPACE_MESSAGE,
} from "@/server/services/backup/format";
import {
  BACKUP_CHANGED_MESSAGE,
  ICLOUD_PENDING_PATH_MESSAGE,
  inspectBackupFile,
  normalizeBackupFilePath,
  startRestore,
} from "@/server/services/backup/index";
import { removeRestoreLeftovers, runBackupJob, runRestoreJob } from "@/server/services/backup/jobs";
import { applyRetention, ICLOUD_PENDING_MESSAGE, listBackupFiles } from "@/server/services/backup/listing";
import { prismaQueryable, RESTORE_IN_PROGRESS_MESSAGE } from "@/server/services/backup/queue";
import { backupReadErrorMessage, guardStall, openBackup, readBackupManifest } from "@/server/services/backup/reader";
import { CHANGED_SINCE_CONFIRM_MESSAGE, restoreBackup, TIMEOUT_MESSAGE } from "@/server/services/backup/restore";
import { backupHealth } from "@/server/services/backup/schedule";
import {
  ensureWritableFolder,
  getInstallId,
  INSIDE_DATA_DIR_MESSAGE,
  isInsideDataDir,
  isInsideDataDirAsync,
  normalizeCustomFolder,
  saveBackupSettings,
} from "@/server/services/backup/settings";
import { appliedMigrations } from "@/server/services/backup/tables";
import { tryWorkerLock } from "@/worker/single-instance";
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
  tempDir,
} from "./backup-fixture";
import { readZip } from "./export-fixture";
import { catchError, expectUserError } from "./helpers";

let work: string;
let data: RichData;
let backup: CreatedBackup;
/** Chaves endereçadas por hash do backup (a/…). */
let hashKeys: string[];
const previousHome = process.env.OS_BACKUP_HOME;

const zipProto = yauzl.ZipFile.prototype as unknown as {
  openReadStreamPromise(this: yauzl.ZipFile, entry: yauzl.Entry, opts?: unknown): Promise<Readable>;
};

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true }).catch(() => [])) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(root, rel)));
    else out.push(rel);
  }
  return out.sort();
}

async function indexLines(file: string): Promise<{ key: string; bytes: number; sha256: string }[]> {
  const entries = await readZip(file);
  return (entries.get("storage-index.jsonl")?.data.toString("utf8") ?? "")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Reescreve o índice de arquivos de um backup (e acerta o manifest para ele conferir). */
async function rewriteIndex(
  src: string,
  dest: string,
  opts: {
    lines: (
      lines: { key: string; bytes: number; sha256: string }[],
    ) => { key: string; bytes: number; sha256: string }[];
    edit?: (name: string, data: Buffer) => Buffer | null;
  },
) {
  const next = opts.lines(await indexLines(src));
  const text = Buffer.from(next.map((l) => `${JSON.stringify(l)}\n`).join(""), "utf8");
  await rewriteArchive(src, dest, {
    edit: (name, buf) => (name === "storage-index.jsonl" ? text : opts.edit ? opts.edit(name, buf) : buf),
    manifest: (m) => ({
      ...m,
      storage: { ...m.storage, index: { ...m.storage.index, bytes: text.length, sha256: sha256(text) } },
    }),
  });
}

beforeAll(async () => {
  await resetDatabase();
  work = await tempDir("backup-hardening");
  process.env.OS_BACKUP_HOME = path.join(work, "home");
  data = await createRichData();
  backup = await createBackupArchive({
    folder: path.join(work, "backups"),
    kind: "MANUAL",
    installId: "os-teste",
    now: new Date(2026, 9, 1, 3, 0),
  });
  hashKeys = (await indexLines(backup.filePath)).map((l) => l.key).filter((k) => k.startsWith("a/"));
  expect(hashKeys.length).toBeGreaterThan(2);
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (previousHome === undefined) delete process.env.OS_BACKUP_HOME;
  else process.env.OS_BACKUP_HOME = previousHome;
  await cleanupRichData(data);
  await rm(work, { recursive: true, force: true });
});

describe("arquivo estragado no disco deste Mac", () => {
  it("fica de fora do backup com aviso; o backup restaura; a saúde avisa", async () => {
    const key = hashKeys[0];
    const full = storagePath(key);
    const original = await readFile(full);
    await writeFile(full, "lixo");
    let created: CreatedBackup;
    try {
      created = await createBackupArchive({ folder: path.join(work, "corrupt"), kind: "AUTO", installId: "os-teste" });
    } finally {
      await writeFile(full, original);
    }
    expect(created.warnings).toContain(corruptFilesWarning(1));
    expect(created.manifest.storage.missing).toContain(key);
    expect((await indexLines(created.filePath)).some((l) => l.key === key)).toBe(false);

    // O backup continua restaurável (antes: recusado inteiro como "danificado").
    const fresh = path.join(work, "storage-corrupt");
    const result = await restoreBackup({
      filePath: created.filePath,
      storageRoot: fresh,
      tmpRoot: path.join(work, "tmp"),
    });
    expect(result.filesCopied).toBe(created.manifest.storage.files);
    expect(await listFiles(fresh)).not.toContain(key);

    const health = backupHealth(
      {
        now: new Date(),
        auto: true,
        running: false,
        lastSuccessAt: new Date(),
        lastFailure: null,
        folderProblem: null,
        lastWarning: corruptFilesWarning(1),
      },
      () => "agora",
    );
    expect(health.level).toBe("warn");
    expect(health.detail).toContain("estragado");
  }, 60_000);

  it("backup antigo com um arquivo estragado no índice: restaura o resto e avisa", async () => {
    const key = hashKeys[1];
    const junk = Buffer.from("lixo-antigo");
    const file = path.join(work, "indice-antigo.zip");
    // Como o Offer Studio fazia antes: o índice guardava o hash do conteúdo estragado.
    await rewriteIndex(backup.filePath, file, {
      lines: (lines) => lines.map((l) => (l.key === key ? { key, bytes: junk.length, sha256: sha256(junk) } : l)),
      edit: (name, buf) => (name === `storage/${key}` ? junk : buf),
    });
    const fresh = path.join(work, "storage-indice-antigo");
    const result = await restoreBackup({ filePath: file, storageRoot: fresh, tmpRoot: path.join(work, "tmp") });
    expect(result.warnings.some((w) => /1 arquivo já estava estragado/.test(w))).toBe(true);
    expect(await listFiles(fresh)).not.toContain(key);
    expect((await listFiles(fresh)).length).toBe((await indexLines(backup.filePath)).length - 1);
  }, 60_000);

  it("restaurar conserta arquivos estragados aqui (tamanho ou conteúdo errado)", async () => {
    const root = path.join(work, "storage-conserto");
    await restoreBackup({ filePath: backup.filePath, storageRoot: root, tmpRoot: path.join(work, "tmp") });
    const [cut, flipped] = hashKeys;
    const cutFull = path.join(root, ...cut.split("/"));
    const flipFull = path.join(root, ...flipped.split("/"));
    await truncate(cutFull, 0);
    const bytes = await readFile(flipFull);
    bytes[bytes.length - 1] ^= 0xff;
    await writeFile(flipFull, bytes);
    const result = await restoreBackup({
      filePath: backup.filePath,
      storageRoot: root,
      tmpRoot: path.join(work, "tmp"),
    });
    expect(result.filesRepaired).toBe(2);
    expect(result.filesCopied).toBe(0);
    expect(await fileSha(cutFull)).toBe(/\/([0-9a-f]{64})\./.exec(cut)?.[1]);
    expect(await fileSha(flipFull)).toBe(/\/([0-9a-f]{64})\./.exec(flipped)?.[1]);
    expect(result.warnings.some((w) => /2 arquivos estragados neste Mac foram consertados/.test(w))).toBe(true);
  }, 60_000);
});

describe("disco que para de responder ou dá erro", () => {
  it("entrada que nunca manda dados: desiste com mensagem clara e nada muda", async () => {
    const before = await snapshotTables();
    const original = zipProto.openReadStreamPromise;
    const spy = vi.spyOn(zipProto, "openReadStreamPromise").mockImplementation(async function (
      this: yauzl.ZipFile,
      entry,
      opts,
    ) {
      if (entry.fileName.startsWith("storage/")) return new PassThrough();
      return original.call(this, entry, opts);
    });
    try {
      const started = Date.now();
      const fresh = path.join(work, "storage-parado");
      await expectUserError(
        restoreBackup({
          filePath: backup.filePath,
          storageRoot: fresh,
          tmpRoot: path.join(work, "tmp"),
          timeouts: { readStallMs: 300 },
        }),
        READ_STALLED_MESSAGE,
      );
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(await listFiles(fresh)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    expect(await snapshotTables()).toEqual(before);
    expect(await listFiles(path.join(work, "tmp"))).toEqual([]);
  }, 30_000);

  it("erro de leitura (disco desconectado): diz que o disco não respondeu, não que o backup está danificado", async () => {
    const before = await snapshotTables();
    const original = zipProto.openReadStreamPromise;
    const spy = vi.spyOn(zipProto, "openReadStreamPromise").mockImplementation(async function (
      this: yauzl.ZipFile,
      entry,
      opts,
    ) {
      if (!entry.fileName.startsWith("storage/")) return original.call(this, entry, opts);
      const s = new Readable({ read() {} });
      setTimeout(() => s.destroy(Object.assign(new Error("EIO: i/o error, read"), { code: "EIO" })), 10);
      return s;
    });
    try {
      await expectUserError(
        restoreBackup({
          filePath: backup.filePath,
          storageRoot: path.join(work, "storage-eio"),
          tmpRoot: path.join(work, "tmp"),
        }),
        READ_IO_MESSAGE,
      );
    } finally {
      spy.mockRestore();
    }
    expect(await snapshotTables()).toEqual(before);
    expect(backupReadErrorMessage(Object.assign(new Error("x"), { code: "ENXIO" }))).toBe(READ_IO_MESSAGE);
    expect(backupReadErrorMessage(Object.assign(new Error("x"), { code: "ENOSPC" }))).toBe(RESTORE_NO_SPACE_MESSAGE);
    expect(backupReadErrorMessage(Object.assign(new Error("incorrect header check"), { code: "Z_DATA_ERROR" }))).toBe(
      DAMAGED_MESSAGE,
    );
    expect(backupReadErrorMessage(new Error("invalid central directory file header signature"))).toBe(DAMAGED_MESSAGE);
  }, 30_000);

  it("vigia da leitura não dispara com quem consome devagar", async () => {
    const source = new PassThrough();
    source.end(Buffer.from("dados"));
    const guarded = guardStall(source, 100);
    await new Promise((r) => setTimeout(r, 300));
    const chunks: Buffer[] = [];
    for await (const chunk of guarded) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe("dados");
    // Sem dados enquanto alguém espera: desiste.
    const stuck = guardStall(new PassThrough(), 100);
    const err = await catchError(
      (async () => {
        for await (const _ of stuck) {
          // nada chega
        }
      })(),
    );
    expect((err as Error).message).toBe(READ_STALLED_MESSAGE);
  });

  it("restauração sem nenhum andamento antes do banco (backup de segurança travado): desiste e nada muda", async () => {
    const before = await snapshotTables();
    const fresh = path.join(work, "storage-travado");
    await expectUserError(
      restoreBackup({
        filePath: backup.filePath,
        storageRoot: fresh,
        tmpRoot: path.join(work, "tmp"),
        timeouts: { stepMs: 300 },
        safetyBackup: () => new Promise<string | null>(() => undefined),
      }),
      TIMEOUT_MESSAGE,
    );
    expect(await snapshotTables()).toEqual(before);
    expect(await listFiles(fresh)).toEqual([]);
  }, 30_000);

  it("backup que para de avançar (disco da pasta travado): desiste com mensagem clara e sem arquivo pela metade", async () => {
    const folder = path.join(work, "backup-travado");
    await expectUserError(
      createBackupArchive({
        folder,
        kind: "MANUAL",
        installId: "os-teste",
        stallMs: 300,
        freeBytes: () => new Promise<number>(() => undefined),
      }),
      BACKUP_STALLED_MESSAGE,
    );
    expect(await readdir(folder)).toEqual([]);
  }, 30_000);
});

describe("arquivo de backup forjado", () => {
  it("arquivo maior que o prometido no índice: recusa antes de gravar qualquer coisa", async () => {
    const key = hashKeys[0];
    const sha = /\/([0-9a-f]{64})\./.exec(key)?.[1] as string;
    const file = path.join(work, "enche-disco.zip");
    await rewriteIndex(backup.filePath, file, {
      lines: (lines) => lines.map((l) => (l.key === key ? { key, bytes: 3, sha256: sha } : l)),
      edit: (name, buf) => (name === `storage/${key}` ? Buffer.alloc(8 * 1024 * 1024) : buf),
    });
    const fresh = path.join(work, "storage-forjado");
    await expectUserError(
      restoreBackup({ filePath: file, storageRoot: fresh, tmpRoot: path.join(work, "tmp") }),
      DAMAGED_MESSAGE,
    );
    expect(await listFiles(fresh)).toEqual([]);
    expect(await listFiles(path.join(work, "tmp"))).toEqual([]);
  }, 30_000);

  it("tabela com uma linha gigante (sem quebra): recusa sem ler tudo para a memória", async () => {
    const file = path.join(work, "linha-gigante.zip");
    await rewriteArchive(backup.filePath, file, {
      edit: (name, buf) => (name === "db/Offer.jsonl" ? Buffer.alloc(32 * 1024 * 1024, 0x61) : buf),
    });
    const before = process.memoryUsage().rss;
    await expectUserError(
      restoreBackup({
        filePath: file,
        storageRoot: path.join(work, "storage-gigante"),
        tmpRoot: path.join(work, "tmp"),
      }),
      DAMAGED_MESSAGE,
    );
    expect(process.memoryUsage().rss - before).toBeLessThan(256 * 1024 * 1024);
  }, 30_000);

  it("chave com “.” (viraria a pasta de versões) e entradas faltando no índice central", async () => {
    expect(isBackupStorageKey("versions/revdoc/.")).toBe(false);
    expect(isBackupStorageKey("clones/job/.")).toBe(false);
    expect(isBackupStorageKey("versions/revdoc/v1.json.gz")).toBe(true);
    expect(() => storagePath("versions/x/.")).toThrow();
    expect(() => storagePath("a/./b.png")).toThrow();
    // Só o manifest, sem guardar o índice inteiro; entradas que faltam: danificado.
    const archive = await openBackup(backup.filePath, { mode: "manifest" });
    archive.close();
    expect(archive.entries.size).toBe(1);
    expect(archive.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    const missing = path.join(work, "sem-arquivo.zip");
    await rewriteArchive(backup.filePath, missing, {
      edit: (name, buf) => (name === `storage/${hashKeys[0]}` ? null : buf),
    });
    await expectUserError(readBackupManifest(missing), DAMAGED_MESSAGE);
  });
});

describe("pasta e lista de backups", () => {
  it("backup só para o dono; pasta criada pelo app só para o dono", async () => {
    expect((await stat(backup.filePath)).mode & 0o777).toBe(0o600);
    const folder = path.join(work, "nova-pasta", "Offer Studio Backups");
    await ensureWritableFolder(folder);
    expect((await stat(folder)).mode & 0o777).toBe(0o700);
  });

  it("iCloud Drive (macOS 14+): arquivo só na nuvem aparece sem ser baixado e a limpeza ainda o alcança", async () => {
    const folder = path.join(work, "icloud");
    await mkdir(folder, { recursive: true });
    const installId = await getInstallId();
    const ctx = { installId, appVersion: appVersion(), migrations: await appliedMigrations(prismaQueryable) };
    // Arquivo sem nenhum bloco no disco (como os "dataless" da iCloud Drive).
    const evicted = path.join(folder, "offer-studio-backup-2026-09-01-0300.zip");
    await writeFile(evicted, "");
    await truncate(evicted, 5 * 1024 * 1024);
    expect((await stat(evicted)).blocks).toBe(0);
    const newer = await createBackupArchive({ folder, kind: "AUTO", installId, now: new Date(2026, 8, 20, 3, 0) });
    // Conflito de nomes da iCloud Drive ("… 2.zip"): aparece pelo manifest.
    const conflict = path.join(folder, "offer-studio-backup-2026-09-20-0300 2.zip");
    await copyFile(newer.filePath, conflict);
    expect(BACKUP_FILE_RE.test("offer-studio-backup-2026-10-01-0300 (1).zip")).toBe(true);
    expect(BACKUP_FILE_RE.test("offer-studio-backup-2026-10-01-0300 copy.zip")).toBe(true);

    const files = await listBackupFiles(folder, ctx);
    const cloud = files.find((f) => f.path === evicted);
    expect(cloud).toMatchObject({ cloudOnly: true, problem: ICLOUD_PENDING_MESSAGE, bytes: 5 * 1024 * 1024 });
    expect(files.find((f) => f.path === conflict)).toMatchObject({ kind: "AUTO", mine: true, problem: null });
    await expectUserError(normalizeBackupFilePath(evicted), ICLOUD_PENDING_PATH_MESSAGE, "path");

    // Automático antigo desta instalação (pelo histórico, mesmo tamanho), só na nuvem: apagado sem baixar.
    const deleted = await applyRetention(folder, {
      ...ctx,
      keep: 2,
      knownAuto: [{ filePath: evicted, bytes: BigInt(5 * 1024 * 1024) }],
    });
    expect(deleted).toEqual([evicted]);
    expect(await stat(evicted).catch(() => null)).toBeNull();
  }, 60_000);

  it("só na nuvem: o caminho do histórico não basta — outro Mac no mesmo caminho nunca é apagado", async () => {
    const folder = path.join(work, "icloud-dois-macs");
    await mkdir(folder, { recursive: true });
    const installId = await getInstallId();
    const ctx = { installId, appVersion: appVersion(), migrations: await appliedMigrations(prismaQueryable) };
    const sparse = async (name: string, bytes: number) => {
      const file = path.join(folder, name);
      await writeFile(file, "");
      await truncate(file, bytes);
      return file;
    };
    // Os dois Macs fizeram o automático das 3h com o nome antigo (sem marca): a
    // iCloud Drive renomeou o deste Mac e o do outro Mac ficou no caminho do histórico.
    const otherMac = await sparse("offer-studio-backup-2026-09-01-0300.zip", 7 * 1024 * 1024);
    // Arquivo com a marca de outra instalação, mesmo tamanho do histórico.
    const otherTag = await sparse(backupFileName(new Date(2026, 8, 2, 3, 0), 1, "os-outro-mac"), 6 * 1024 * 1024);
    // Este Mac, com a marca desta instalação e o tamanho que o histórico guardou.
    const mine = await sparse(backupFileName(new Date(2026, 8, 3, 3, 0), 1, installId), 6 * 1024 * 1024);
    const newest = await createBackupArchive({ folder, kind: "AUTO", installId, now: new Date(2026, 8, 20, 3, 0) });
    const deleted = await applyRetention(folder, {
      ...ctx,
      keep: 1,
      knownAuto: [
        { filePath: otherMac, bytes: 6 * 1024 * 1024 },
        { filePath: otherTag, bytes: 6 * 1024 * 1024 },
        { filePath: mine, bytes: 6 * 1024 * 1024 },
        { filePath: newest.filePath, bytes: newest.bytes },
      ],
    });
    expect(deleted).toEqual([mine]);
    expect(await stat(otherMac).catch(() => null)).not.toBeNull();
    expect(await stat(otherTag).catch(() => null)).not.toBeNull();
    expect(await stat(newest.filePath).catch(() => null)).not.toBeNull();
  }, 60_000);

  it("limpeza: cópias e backups renomeados por você nunca são apagados", async () => {
    const folder = path.join(work, "copias");
    const installId = await getInstallId();
    const ctx = { installId, appVersion: appVersion(), migrations: await appliedMigrations(prismaQueryable) };
    const older = await createBackupArchive({ folder, kind: "AUTO", installId, now: new Date(2026, 8, 1, 3, 0) });
    const newer = await createBackupArchive({ folder, kind: "AUTO", installId, now: new Date(2026, 8, 2, 3, 0) });
    const base = (file: string) => file.replace(/\.zip$/, "");
    const copies = [
      `${base(older.filePath)} copy.zip`,
      `${base(older.filePath)} cópia.zip`,
      `${base(older.filePath)} (1).zip`,
      `${base(older.filePath)} IMPORTANTE antes da mudanca.zip`,
      // Cópia do mais novo (mesma data no manifest): não ocupa o lugar dele na conta.
      `${base(newer.filePath)} copy.zip`,
    ];
    for (const copy of copies) await copyFile(older.filePath, copy);
    await copyFile(newer.filePath, copies[4]);
    // Conflito da iCloud Drive ("… 2.zip"): nome do app, entra na limpeza.
    const conflict = `${base(older.filePath)} 2.zip`;
    await copyFile(older.filePath, conflict);
    // Todos aparecem na lista como automáticos desta instalação.
    const listed = await listBackupFiles(folder, ctx);
    for (const copy of copies) expect(listed.find((f) => f.path === copy)).toMatchObject({ kind: "AUTO", mine: true });

    const deleted = await applyRetention(folder, { ...ctx, keep: 1 });
    expect(deleted.sort()).toEqual([older.filePath, conflict].sort());
    for (const copy of copies) expect(await stat(copy).catch(() => null), copy).not.toBeNull();
    expect(await stat(newer.filePath).catch(() => null)).not.toBeNull();
    // Rodar de novo não apaga nenhuma cópia.
    expect(await applyRetention(folder, { ...ctx, keep: 1 })).toEqual([]);
  }, 120_000);

  it("erro de leitura não fica guardado: permissão liberada → a lista lê de novo", async () => {
    const folder = path.join(work, "permissao");
    const made = await createBackupArchive({
      folder,
      kind: "MANUAL",
      installId: "os-teste",
      now: new Date(2026, 8, 10, 3, 0),
    });
    const ctx = {
      installId: "os-teste",
      appVersion: appVersion(),
      migrations: await appliedMigrations(prismaQueryable),
    };
    await chmod(made.filePath, 0o000);
    try {
      expect((await listBackupFiles(folder, ctx))[0].problem).toMatch(/O macOS não deixou/);
    } finally {
      await chmod(made.filePath, 0o600);
    }
    const again = (await listBackupFiles(folder, ctx))[0];
    expect(again.problem).toBeNull();
    expect(again.offers).toBe(1);
  }, 60_000);

  it("pasta escolhida dentro da pasta de dados: recusa mesmo com maiúsculas, “..x” ou link", async () => {
    const dataDir = path.resolve(env.dataDir);
    await mkdir(path.join(dataDir, "storage"), { recursive: true });
    expect(isInsideDataDir(path.join(dataDir, "..backups"))).toBe(true);
    expect(isInsideDataDir(path.join(path.dirname(dataDir), `..${path.basename(dataDir)}`))).toBe(false);
    const upper = path.join(path.dirname(dataDir), path.basename(dataDir).toUpperCase(), "storage");
    const caseInsensitive = await stat(path.join(path.dirname(dataDir), path.basename(dataDir).toUpperCase()))
      .then(() => true)
      .catch(() => false);
    if (caseInsensitive) {
      expect(() => normalizeCustomFolder(upper)).toThrow(INSIDE_DATA_DIR_MESSAGE);
    }
    const link = path.join(work, "atalho-dados");
    await symlink(dataDir, link);
    expect(() => normalizeCustomFolder(path.join(link, "backups"))).toThrow(INSIDE_DATA_DIR_MESSAGE);
    expect(await isInsideDataDirAsync(path.join(link, "backups"))).toBe(true);
    if (caseInsensitive) {
      // Link escrito com outras maiúsculas ("…/DATA/storage"): no Mac é a mesma pasta.
      const caseLink = path.join(work, "atalho-maiusculas");
      await symlink(upper, caseLink);
      expect(isInsideDataDir(path.join(caseLink, "bk"))).toBe(true);
      expect(isInsideDataDir(caseLink)).toBe(true);
      expect(await isInsideDataDirAsync(path.join(caseLink, "bk"))).toBe(true);
      expect(() => normalizeCustomFolder(path.join(caseLink, "bk"))).toThrow(INSIDE_DATA_DIR_MESSAGE);
      expect(await isInsideDataDirAsync(upper)).toBe(true);
    }
    expect(await isInsideDataDirAsync(path.join(work, "fora"))).toBe(false);
    expect(isInsideDataDir(path.join(work, "fora"))).toBe(false);

    // Pasta aceita e depois trocada por um link para dentro da pasta de dados: o backup recusa.
    const chosen = path.join(work, "escolhida");
    await saveBackupSettings({ folder: "custom", customPath: chosen });
    await rm(chosen, { recursive: true, force: true });
    await symlink(path.join(dataDir, "storage"), chosen);
    const job = await prisma.backup.create({ data: { kind: "MANUAL", status: "RUNNING", startedAt: new Date() } });
    await expectUserError(runBackupJob(job.id), INSIDE_DATA_DIR_MESSAGE);
    expect(await prisma.backup.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "FAILED",
      errorMessage: INSIDE_DATA_DIR_MESSAGE,
    });
    await saveBackupSettings({ folder: "documents" });
  }, 30_000);
});

describe("restauração pedida", () => {
  it("o automático que termina com uma restauração na fila não apaga o backup escolhido", async () => {
    const folder = path.join(work, "retencao");
    const installId = await getInstallId();
    await saveBackupSettings({ keep: 1 });
    try {
      const oldest = await createBackupArchive({ folder, kind: "AUTO", installId, now: new Date(2026, 8, 1, 3, 0) });
      const { restoreId } = await startRestore(oldest.filePath);
      const auto = await prisma.backup.create({ data: { kind: "AUTO", status: "RUNNING", startedAt: new Date() } });
      await runBackupJob(auto.id, { folder });
      expect(await stat(oldest.filePath).catch(() => null)).not.toBeNull();
      // Sem restauração pendente, a limpeza volta a funcionar.
      await prisma.backupRestore.delete({ where: { id: restoreId } });
      const next = await prisma.backup.create({ data: { kind: "AUTO", status: "RUNNING", startedAt: new Date() } });
      const kept = await runBackupJob(next.id, { folder });
      expect(await stat(oldest.filePath).catch(() => null)).toBeNull();
      expect(await stat(kept).catch(() => null)).not.toBeNull();
    } finally {
      await saveBackupSettings({ keep: 10 });
    }
  }, 120_000);

  it("dois pedidos ao mesmo tempo: só um entra", async () => {
    const results = await Promise.allSettled([startRestore(backup.filePath), startRestore(backup.filePath)]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0].reason as Error).message).toBe(RESTORE_IN_PROGRESS_MESSAGE);
    await prisma.backupRestore.deleteMany({});
  }, 30_000);

  it("backup trocado depois da confirmação: recusa (no pedido e no worker) e nada muda", async () => {
    const info = await inspectBackupFile(backup.filePath);
    expect(info.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    await expectUserError(startRestore(backup.filePath, "0".repeat(64)), BACKUP_CHANGED_MESSAGE);
    const { restoreId } = await startRestore(backup.filePath, info.fingerprint);
    // O arquivo muda depois do pedido (outro backup com o mesmo nome).
    await prisma.backupRestore.update({
      where: { id: restoreId },
      data: { status: "RUNNING", manifestSha256: createHash("sha256").update("outro").digest("hex") },
    });
    const before = await snapshotTables();
    expect(await runRestoreJob(restoreId, { storageRoot: path.join(work, "storage-trocado") })).toBe(false);
    const row = await prisma.backupRestore.findUniqueOrThrow({ where: { id: restoreId } });
    expect(row).toMatchObject({ status: "FAILED", errorMessage: CHANGED_SINCE_CONFIRM_MESSAGE });
    expect(await snapshotTables()).toEqual(before);
    await prisma.backupRestore.deleteMany({});
  }, 30_000);

  it("sobras de uma restauração interrompida saem; a que está rodando fica", async () => {
    const tmpRoot = path.join(work, "tmp-sobras");
    const running = await prisma.backupRestore.create({
      data: { sourcePath: backup.filePath, status: "RUNNING", startedAt: new Date() },
    });
    await mkdir(path.join(tmpRoot, `restore-${running.id}`, "a"), { recursive: true });
    await mkdir(path.join(tmpRoot, "restore-interrompida", "a", "ab"), { recursive: true });
    await writeFile(path.join(tmpRoot, "restore-interrompida", "a", "ab", "x.png"), "x");
    await mkdir(path.join(tmpRoot, "clone"), { recursive: true });
    expect(await removeRestoreLeftovers({ tmpRoot })).toBe(1);
    expect((await readdir(tmpRoot)).sort()).toEqual(["clone", `restore-${running.id}`]);
    await prisma.backupRestore.deleteMany({});
  });
});

describe("um worker por banco", () => {
  it("o segundo worker não pega a tranca enquanto o primeiro está com ela", async () => {
    const first = await tryWorkerLock();
    expect(first).not.toBeNull();
    try {
      expect(await tryWorkerLock()).toBeNull();
    } finally {
      await first?.release();
    }
    const again = await tryWorkerLock();
    expect(again).not.toBeNull();
    await again?.release();
  });
});

// Garante que o arquivo original do storage voltou (outros testes usam os mesmos arquivos).
afterAll(async () => {
  for (const key of hashKeys ?? []) {
    const sha = /\/([0-9a-f]{64})\./.exec(key)?.[1];
    const full = path.join(STORAGE_ROOT, ...key.split("/"));
    if (sha && (await fileSha(full).catch(() => sha)) !== sha) await rm(full, { force: true });
  }
});
