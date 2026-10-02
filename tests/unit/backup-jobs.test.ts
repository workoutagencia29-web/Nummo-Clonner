/**
 * Backup no dia a dia: configurações e pastas (Documentos, iCloud Drive,
 * pasta escolhida — com as mensagens em pt-BR), fila do worker (pedido, duplo
 * clique, andamento, falha por falta de espaço, interrompido), lista da pasta,
 * limpeza dos automáticos antigos (só os desta instalação), excluir/mostrar no
 * Finder só arquivos da lista, pedido de restauração (com backup de segurança,
 * sessões encerradas, pausa do worker) e a tela de primeiro acesso.
 */
import { chmod, copyFile, mkdir, readdir, rm, stat, truncate, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { createBackupArchive } from "@/server/services/backup/archive";
import { backupHome } from "@/server/services/backup/context";
import { DAMAGED_MESSAGE, NEWER_VERSION_MESSAGE } from "@/server/services/backup/format";
import {
  cancelRestore,
  deleteBackupFile,
  downloadFirstRunBackup,
  FIRST_RUN_GONE_MESSAGE,
  FIRST_RUN_ICLOUD_MESSAGE,
  firstRunBackups,
  firstRunManualDownloadMessage,
  getBackupOverview,
  getRestoreJob,
  inspectBackupFile,
  isBrandNewInstall,
  listBackups,
  normalizeBackupFilePath,
  requestCloudDownload,
  revealBackupFile,
  startManualBackup,
  startRestore,
} from "@/server/services/backup/index";
import {
  BACKUP_INTERRUPTED_MESSAGE,
  claimNextBackup,
  claimNextRestore,
  failInterruptedBackups,
  requestBackup,
  runBackupJob,
  runRestoreJob,
} from "@/server/services/backup/jobs";
import { applyRetention, listBackupFiles } from "@/server/services/backup/listing";
import { readBackupManifest } from "@/server/services/backup/reader";
import {
  ensureWritableFolder,
  folderPresets,
  getBackupSettings,
  getInstallId,
  normalizeCustomFolder,
  parseBackupSettings,
  saveBackupSettings,
} from "@/server/services/backup/settings";
import { backupLoop, checkAutoBackup, waitForIdle } from "@/worker/backup";
import { workerState } from "@/worker/state";
import { resetDatabase } from "../setup/per-file";
import { cleanupRichData, createRichData, type RichData, rewriteArchive, tempDir } from "./backup-fixture";
import { expectUserError } from "./helpers";

let work: string;
let home: string;
let folder: string;
let data: RichData | undefined;
const previousHome = process.env.OS_BACKUP_HOME;

async function runQueued(): Promise<string> {
  const job = await claimNextBackup();
  if (!job) throw new Error("nada na fila");
  return runBackupJob(job.id);
}

beforeAll(async () => {
  work = await tempDir("backup-jobs");
  home = path.join(work, "home");
  folder = path.join(work, "pasta-escolhida");
  process.env.OS_BACKUP_HOME = home;
});

afterAll(async () => {
  if (previousHome === undefined) delete process.env.OS_BACKUP_HOME;
  else process.env.OS_BACKUP_HOME = previousHome;
  await cleanupRichData(data);
  await chmod(path.join(work, "so-leitura"), 0o755).catch(() => undefined);
  await rm(work, { recursive: true, force: true });
});

describe("configurações e pastas", () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it("padrões e valores estragados voltam ao padrão", async () => {
    expect(await getBackupSettings()).toEqual({ folder: "documents", customPath: null, auto: true, hour: 3, keep: 10 });
    expect(parseBackupSettings({ folder: "custom", hour: 99, keep: "x", auto: "sim" })).toEqual({
      folder: "documents",
      customPath: null,
      auto: true,
      hour: 3,
      keep: 10,
    });
  });

  it("pastas sugeridas: Documentos sempre; iCloud Drive só quando existe", async () => {
    let [docs, icloud] = folderPresets();
    expect(docs.path).toBe(path.join(home, "Documents", "Offer Studio Backups"));
    expect(icloud.available).toBe(false);
    await expectUserError(saveBackupSettings({ folder: "icloud" }), /iCloud Drive não está ligada/, "folder");
    await mkdir(path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs"), { recursive: true });
    [docs, icloud] = folderPresets();
    expect(icloud.available).toBe(true);
    expect(icloud.path).toBe(
      path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs", "Offer Studio Backups"),
    );
    expect((await saveBackupSettings({ folder: "icloud" })).folder).toBe("icloud");
  });

  it("sem OS_BACKUP_HOME, só o banco de verdade usa a pasta pessoal do Mac", () => {
    const saved = process.env.OS_BACKUP_HOME;
    delete process.env.OS_BACKUP_HOME;
    try {
      expect(backupHome()).toBe(path.join(env.dataDir, "backup-home"));
    } finally {
      process.env.OS_BACKUP_HOME = saved;
    }
  });

  it("pasta escolhida: caminho completo, fora da pasta de dados, que dá para gravar", async () => {
    expect(() => normalizeCustomFolder("   ")).toThrow("Informe o caminho da pasta.");
    expect(() => normalizeCustomFolder("Backups")).toThrow(/caminho completo/);
    expect(() => normalizeCustomFolder("/")).toThrow(/não a raiz/);
    expect(() => normalizeCustomFolder(path.join(env.dataDir, "storage", "x"))).toThrow(/fora da pasta de dados/);
    expect(() => normalizeCustomFolder(env.dataDir)).toThrow(/fora da pasta de dados/);
    expect(normalizeCustomFolder("~/Backups do Offer")).toBe(path.join(home, "Backups do Offer"));
    expect(normalizeCustomFolder(`"${folder}/"`)).toBe(folder);

    const file = path.join(work, "um-arquivo");
    await writeFile(file, "x");
    await expectUserError(ensureWritableFolder(file), "Esse caminho é de um arquivo, não de uma pasta.");
    const readOnly = path.join(work, "so-leitura");
    await mkdir(readOnly);
    await chmod(readOnly, 0o500);
    await expectUserError(ensureWritableFolder(path.join(readOnly, "sub")), /não tem permissão/);
    await expectUserError(
      ensureWritableFolder("/Volumes/DiscoQueNaoExiste123/Backups"),
      "O disco “DiscoQueNaoExiste123” não está conectado. Conecte o disco ou escolha outra pasta para os backups.",
    );

    await expectUserError(
      saveBackupSettings({ folder: "custom", customPath: "relativa" }),
      /caminho completo/,
      "customPath",
    );
    const saved = await saveBackupSettings({
      folder: "custom",
      customPath: `${folder}/`,
      auto: false,
      hour: 22,
      keep: 2,
    });
    expect(saved).toEqual({ folder: "custom", customPath: folder, auto: false, hour: 22, keep: 2 });
    expect((await stat(folder)).isDirectory()).toBe(true);
    expect(await readdir(folder)).toEqual([]); // o teste de gravação não deixa sobra
  });

  it("identidade da instalação é estável", async () => {
    const id = await getInstallId();
    expect(id).toMatch(/^os-[0-9a-f]{24}$/);
    expect(await getInstallId()).toBe(id);
  });
});

describe("fila de backup", () => {
  beforeAll(async () => {
    await resetDatabase();
    data = await createRichData();
    await saveBackupSettings({ folder: "custom", customPath: folder, auto: false, keep: 2 });
  });

  it("“Fazer backup agora”: duplo clique vira um pedido só; o worker faz e grava o resultado", async () => {
    const a = await startManualBackup();
    const b = await startManualBackup();
    expect(b.backupId).toBe(a.backupId);
    const overview = await getBackupOverview();
    expect(overview.current).toMatchObject({ id: a.backupId, status: "QUEUED", step: "Na fila…" });
    expect(overview.current?.workerOnline).toBe(false);

    const filePath = await runQueued();
    const row = await prisma.backup.findUniqueOrThrow({ where: { id: a.backupId } });
    expect(row).toMatchObject({ status: "DONE", progress: 100, step: "Backup concluído", filePath, offerCount: 1 });
    expect(Number(row.bytes)).toBe((await stat(filePath)).size);
    expect(path.dirname(filePath)).toBe(folder);

    const after = await getBackupOverview();
    expect(after.current).toBeNull();
    expect(after.lastBackup).toMatchObject({ offers: 1, kind: "MANUAL", fileName: path.basename(filePath) });
    expect(after.health.level).toBe("warn"); // automático desligado
    expect(after.nextAutoAt).toBeNull();

    const { files } = await listBackups();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: filePath, kind: "MANUAL", mine: true, offers: 1, problem: null });
  });

  it("manual pedido com o automático na fila toma o lugar dele; com o automático rodando, entra depois", async () => {
    const auto = await requestBackup("AUTO");
    expect((await requestBackup("AUTO")).backupId).toBe(auto.backupId);
    const manual = await requestBackup("MANUAL");
    expect(manual.backupId).toBe(auto.backupId);
    expect((await prisma.backup.findUniqueOrThrow({ where: { id: auto.backupId } })).kind).toBe("MANUAL");
    await prisma.backup.delete({ where: { id: auto.backupId } });

    const running = await requestBackup("AUTO");
    await prisma.backup.update({ where: { id: running.backupId }, data: { status: "RUNNING" } });
    const after = await requestBackup("MANUAL");
    expect(after.backupId).not.toBe(running.backupId);
    expect((await requestBackup("MANUAL")).backupId).toBe(after.backupId);
    expect((await requestBackup("AUTO")).backupId).toBe(running.backupId);
    await prisma.backup.deleteMany({ where: { id: { in: [running.backupId, after.backupId] } } });
  });

  it("sem espaço no disco: mensagem clara e nenhum arquivo pela metade", async () => {
    const before = await readdir(folder);
    await expectUserError(
      createBackupArchive({ folder, kind: "MANUAL", installId: "x", freeBytes: async () => 1024 }),
      /^Não há espaço suficiente na pasta de backup \(precisa de cerca de .+, há .+ livres\)\. Libere espaço ou escolha outra pasta\.$/,
    );
    expect(await readdir(folder)).toEqual(before);
  });

  it("pasta indisponível: o backup falha com a mensagem e fica registrado", async () => {
    await prisma.appSetting.update({
      where: { key: "backup" },
      data: {
        value: { folder: "custom", customPath: "/Volumes/DiscoQueNaoExiste123/B", auto: false, hour: 3, keep: 2 },
      },
    });
    const { backupId } = await requestBackup("MANUAL");
    await expectUserError(runQueued(), /DiscoQueNaoExiste123/);
    const row = await prisma.backup.findUniqueOrThrow({ where: { id: backupId } });
    expect(row.status).toBe("FAILED");
    expect(row.errorMessage).toMatch(/não está conectado/);
    const overview = await getBackupOverview();
    expect(overview.health).toMatchObject({ level: "error", title: "O último backup falhou" });
    await saveBackupSettings({ folder: "custom", customPath: folder });
  });

  it("interrompido (worker fechado no meio): vira falha e o temporário antigo sai", async () => {
    const running = await prisma.backup.create({ data: { kind: "AUTO", status: "RUNNING", startedAt: new Date() } });
    const oldTmp = path.join(folder, ".offer-studio-backup-2026-01-01-0300.zip.abcd1234.tmp");
    const newTmp = path.join(folder, ".offer-studio-backup-2026-01-01-0301.zip.abcd5678.tmp");
    await writeFile(oldTmp, "meio backup");
    await writeFile(newTmp, "outro mac gravando agora");
    const longAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
    await utimes(oldTmp, longAgo, longAgo);
    const result = await failInterruptedBackups();
    expect(result.backups).toBe(1);
    const row = await prisma.backup.findUniqueOrThrow({ where: { id: running.id } });
    expect(row).toMatchObject({ status: "FAILED", errorMessage: BACKUP_INTERRUPTED_MESSAGE });
    const names = await readdir(folder);
    expect(names).not.toContain(path.basename(oldTmp));
    expect(names).toContain(path.basename(newTmp));
    await rm(newTmp);
  });

  it("limpeza: fica com os N automáticos mais novos desta instalação; manuais, de outro Mac e estranhos ficam", async () => {
    const installId = await getInstallId();
    const autos: { path: string; createdAt: string }[] = [];
    for (let i = 0; i < 4; i++) {
      await requestBackup("AUTO");
      const file = await runQueued();
      autos.push({ path: file, createdAt: (await readBackupManifest(file)).createdAt });
    }
    // Automático de outro Mac na mesma pasta (ex.: iCloud compartilhada).
    const foreign = await createBackupArchive({
      folder,
      kind: "AUTO",
      installId: "os-outro-mac",
      now: new Date(2020, 0, 1),
    });
    await writeFile(path.join(folder, "offer-studio-backup-2019-05-05-0500.zip"), "não é zip");
    await writeFile(path.join(folder, "outro-arquivo.zip"), "x");

    // Ficaram os 2 automáticos mais novos desta instalação (o nome de um apagado pode ser reaproveitado).
    const ctx = { installId, appVersion: "0.1.0", migrations: [] as string[] };
    const mineAuto = (await listBackupFiles(folder, ctx)).filter((f) => f.kind === "AUTO" && f.mine);
    expect(mineAuto.map((f) => f.createdAt)).toEqual(
      autos
        .map((a) => a.createdAt)
        .slice(-2)
        .reverse(),
    );
    const names = await readdir(folder);
    expect(names).toContain(path.basename(autos[3].path));
    expect(names).toContain("offer-studio-backup-2019-05-05-0500.zip");
    expect(names).toContain("outro-arquivo.zip");
    expect((await listBackupFiles(folder, ctx)).filter((f) => f.kind === "MANUAL")).toHaveLength(1);
    expect(names).toContain(path.basename(foreign.filePath));

    // Uma rodada de limpeza à parte não apaga nada a mais.
    const again = await applyRetention(folder, { ...ctx, keep: 2 });
    expect(again).toEqual([]);
    const files = await listBackupFiles(folder, ctx);
    const broken = files.find((f) => f.fileName === "offer-studio-backup-2019-05-05-0500.zip");
    expect(broken?.problem).toBe(DAMAGED_MESSAGE);
    expect(files.find((f) => f.path === foreign.filePath)?.mine).toBe(false);
    expect(files.some((f) => f.fileName === "outro-arquivo.zip")).toBe(false);
    // Lista do mais novo para o mais antigo.
    const dates = files.map((f) => f.createdAt);
    expect([...dates].sort().reverse()).toEqual(dates);
    // Migrations que este banco não tem: o backup aparece com o motivo.
    const strict = await listBackupFiles(folder, { ...ctx, appVersion: "0.0.1" });
    expect(strict.find((f) => f.path === autos[3].path)?.problem).toBe(NEWER_VERSION_MESSAGE);
  });

  it("excluir e mostrar no Finder: só arquivos da lista", async () => {
    const opened: string[][] = [];
    const opener = async (args: string[]) => {
      opened.push(args);
    };
    const { files } = await listBackups();
    const target = files.find((f) => f.kind === "MANUAL");
    expect(target).toBeDefined();
    await revealBackupFile(target?.path as string, opener);
    expect(opened).toEqual([["-R", target?.path]]);
    await expectUserError(revealBackupFile("/etc/hosts", opener), /não está mais na pasta/);
    await expectUserError(deleteBackupFile(path.join(work, "um-arquivo")), /não está mais na pasta/);
    await deleteBackupFile(target?.path as string);
    expect((await listBackups()).files.some((f) => f.path === target?.path)).toBe(false);
  });

  it("conferir um arquivo antes de restaurar (caminho, .zip, existe)", async () => {
    await expectUserError(normalizeBackupFilePath(""), "Informe o caminho do arquivo de backup.", "path");
    await expectUserError(normalizeBackupFilePath("backup.zip"), /caminho completo/, "path");
    await expectUserError(
      normalizeBackupFilePath(path.join(work, "x.txt")),
      "Escolha o arquivo .zip do backup.",
      "path",
    );
    await expectUserError(normalizeBackupFilePath(path.join(work, "nao-existe.zip")), /não encontrado/, "path");
    await mkdir(path.join(work, "pasta.zip"));
    await expectUserError(normalizeBackupFilePath(path.join(work, "pasta.zip")), /é de uma pasta/, "path");
    // Ainda na iCloud (só o marcador .icloud no disco).
    await writeFile(path.join(work, ".na-nuvem.zip.icloud"), "");
    await expectUserError(normalizeBackupFilePath(path.join(work, "na-nuvem.zip")), /só na iCloud Drive/, "path");

    const { files } = await listBackups();
    const info = await inspectBackupFile(files[0].path);
    expect(info).toMatchObject({
      offers: 1,
      trashedOffers: 1,
      pages: 4,
      sameInstall: true,
      otherKey: false,
      problem: null,
    });
    expect(info.accountEmail).toMatch(/@backup\.test$/);
  });
});

describe("restauração pelo worker", () => {
  let source: string;

  beforeAll(async () => {
    const { files } = await listBackups();
    source = files.find((f) => f.kind === "AUTO" && f.mine)?.path as string;
    expect(source).toBeTruthy();
  });

  beforeEach(() => {
    workerState.paused = false;
    workerState.cloning = false;
    workerState.exporting = false;
  });

  it("pedido: confere o arquivo, recusa outro ao mesmo tempo e pode ser cancelado antes de começar", async () => {
    const newer = path.join(work, "mais-novo.zip");
    await rewriteArchive(source, newer, { manifest: (m) => ({ ...m, appVersion: "99.0.0" }) });
    await expectUserError(startRestore(newer), NEWER_VERSION_MESSAGE);
    const first = await startRestore(source);
    expect(first.accountEmail).toMatch(/@backup\.test$/);
    await expectUserError(startRestore(source), /restauração de backup está em andamento/);
    await expectUserError(requestBackup("MANUAL"), /restauração de backup está em andamento/);
    // Sem login, o andamento não mostra dados pessoais.
    expect(await getRestoreJob(first.restoreId)).toMatchObject({
      status: "QUEUED",
      accountEmail: null,
      safetyPath: null,
    });
    await cancelRestore(first.restoreId);
    expect(await getRestoreJob(first.restoreId)).toBeNull();
    const second = await startRestore(source);
    await prisma.backupRestore.update({ where: { id: second.restoreId }, data: { status: "RUNNING" } });
    await expectUserError(cancelRestore(second.restoreId), /já começou/);
    await prisma.backupRestore.delete({ where: { id: second.restoreId } });
  });

  it("restaura: backup de segurança antes, dados trocados, sessões encerradas, concluída na mesma transação", async () => {
    // Estado atual diferente do backup.
    const extra = await prisma.offer.create({ data: { name: "Criada depois do backup" } });
    const session = await prisma.session.findFirstOrThrow();
    const { restoreId } = await startRestore(source);
    expect(await claimNextRestore()).toBe(restoreId);
    const ok = await runRestoreJob(restoreId, {
      storageRoot: path.join(work, "storage-restaurado"),
      tmpRoot: path.join(work, "tmp"),
    });
    expect(ok).toBe(true);

    const row = await prisma.backupRestore.findUniqueOrThrow({ where: { id: restoreId } });
    expect(row).toMatchObject({ status: "DONE", progress: 100, step: "Backup restaurado", errorMessage: null });
    expect(row.safetyPath).toBeTruthy();
    expect(await prisma.offer.count({ where: { id: extra.id } })).toBe(0);
    expect(await prisma.session.count({ where: { id: session.id } })).toBe(0);
    // O backup de segurança tem o estado de antes (com a oferta criada depois).
    const safety = await readBackupManifest(row.safetyPath as string);
    expect(safety.kind).toBe("SAFETY");
    expect(safety.summary.offers).toBe(2);
    expect(await prisma.backup.count({ where: { kind: "SAFETY", status: "DONE", filePath: row.safetyPath } })).toBe(1);
    // Aparece na lista como "Antes de restaurar" e não é apagado pela limpeza.
    const { files } = await listBackups();
    expect(files.find((f) => f.path === row.safetyPath)?.kind).toBe("SAFETY");
  });

  it("arquivo danificado: falha clara, nada muda e nem o backup de segurança é feito", async () => {
    const broken = path.join(work, "danificado.zip");
    await rewriteArchive(source, broken, {
      edit: (name, buf) =>
        name === "db/Page.jsonl" ? Buffer.from(buf.toString("utf8").replace("Upsell", "Upsel")) : buf,
    });
    const offers = await prisma.offer.count();
    const safetyBefore = await prisma.backup.count({ where: { kind: "SAFETY" } });
    const { restoreId } = await startRestore(broken);
    await claimNextRestore();
    expect(await runRestoreJob(restoreId, { storageRoot: path.join(work, "storage-x") })).toBe(false);
    const row = await prisma.backupRestore.findUniqueOrThrow({ where: { id: restoreId } });
    expect(row.status).toBe("FAILED");
    expect(row.errorMessage).toBe(`${DAMAGED_MESSAGE} Nada foi alterado.`);
    expect(await prisma.offer.count()).toBe(offers);
    expect(await prisma.backup.count({ where: { kind: "SAFETY" } })).toBe(safetyBefore);
  });

  it("pausa do worker: espera a clonagem em andamento; sem terminar a tempo, explica", async () => {
    workerState.cloning = true;
    await expect(waitForIdle(300)).rejects.toThrow(/não terminou a tempo/);
    setTimeout(() => {
      workerState.cloning = false;
    }, 200);
    await waitForIdle(5000);
  });

  it("laço do worker: pausa as outras filas durante a restauração e volta ao normal", async () => {
    workerState.exporting = true; // um ZIP "em andamento"
    const { restoreId } = await startRestore(source);
    let stop = false;
    const loop = backupLoop(() => stop, new Date());
    const deadline = Date.now() + 20_000;
    while (!workerState.paused && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(workerState.paused).toBe(true);
    expect((await prisma.backupRestore.findUniqueOrThrow({ where: { id: restoreId } })).step).toBe(
      "Esperando as tarefas em andamento terminarem…",
    );
    workerState.exporting = false; // o ZIP terminou
    let status = "RUNNING";
    while (Date.now() < deadline) {
      status = (await prisma.backupRestore.findUniqueOrThrow({ where: { id: restoreId } })).status;
      if (status === "DONE" || status === "FAILED") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    stop = true;
    await loop;
    expect(status).toBe("DONE");
    expect(workerState.paused).toBe(false);
  }, 40_000);

  it("agendamento: atrasado → põe um automático na fila (uma vez)", async () => {
    await saveBackupSettings({ auto: true });
    await prisma.backup.deleteMany({ where: { kind: "AUTO" } });
    const started = new Date(Date.now() - 10 * 60_000);
    expect(await checkAutoBackup(started)).toBe("overdue");
    expect(await prisma.backup.count({ where: { kind: "AUTO", status: "QUEUED" } })).toBe(1);
    expect(await checkAutoBackup(started)).toBeNull();
    // Logo depois de abrir, espera.
    await prisma.backup.deleteMany({ where: { kind: "AUTO" } });
    expect(await checkAutoBackup(new Date())).toBeNull();
    await saveBackupSettings({ auto: false });
    expect(await checkAutoBackup(started)).toBeNull();
  });
});

describe("primeiro acesso de uma instalação nova", () => {
  it("só sem conta e sem ofertas; acha os backups nas pastas sugeridas", async () => {
    expect(await isBrandNewInstall()).toBe(false);
    const { files } = await listBackups();
    const docs = folderPresets()[0].path;
    await mkdir(docs, { recursive: true });
    const { copyFile } = await import("node:fs/promises");
    await copyFile(files[0].path, path.join(docs, files[0].fileName));
    await resetDatabase();
    expect(await isBrandNewInstall()).toBe(true);
    const found = await firstRunBackups();
    expect(found.some((f) => f.path === path.join(docs, files[0].fileName))).toBe(true);
  });

  it("backup só na iCloud Drive: “Baixar” traz o arquivo e aí dá para restaurar (sem citar botão que não existe)", async () => {
    expect(await isBrandNewInstall()).toBe(true);
    const icloud = folderPresets()[1];
    expect(icloud.available).toBe(true);
    await mkdir(icloud.path, { recursive: true });
    const docs = folderPresets()[0].path;
    const real = (await readdir(docs)).find((n) => n.endsWith(".zip")) as string;
    const source = path.join(docs, real);
    const size = (await stat(source)).size;
    // Só na nuvem (macOS 14+): nome de verdade, nenhum bloco no disco.
    const cloud = path.join(icloud.path, "offer-studio-backup-2026-09-15-0300.zip");
    await writeFile(cloud, "");
    await truncate(cloud, size);
    expect((await stat(cloud)).blocks).toBe(0);

    const listed = (await firstRunBackups()).find((f) => f.path === cloud);
    expect(listed).toMatchObject({ cloudOnly: true, problem: FIRST_RUN_ICLOUD_MESSAGE });
    expect(listed?.problem).not.toMatch(/Mostrar no Finder/);

    // Ainda baixando: avisa que não está pronto (a tela pergunta de novo).
    const asked: string[] = [];
    const slow = async (file: string) => {
      asked.push(file);
      return undefined;
    };
    expect(await downloadFirstRunBackup(cloud, { downloader: slow, waitMs: 150, pollMs: 20 })).toEqual({
      ready: false,
      folderLabel: icloud.label,
    });
    expect(asked).toEqual([cloud]);

    // A leitura que pede o arquivo já terminou e ele continua só na nuvem (a
    // iCloud Drive não baixou): explica o caminho manual na hora, sem esperar.
    let started = Date.now();
    await expectUserError(
      downloadFirstRunBackup(cloud, { downloader: async () => ({ finished: () => true }), waitMs: 10_000 }),
      firstRunManualDownloadMessage(icloud.label),
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    // O pedido de verdade (ler 1 byte com o head): aqui o "arquivo só na nuvem"
    // é um arquivo esparso, que a leitura não traz — mesma explicação, logo que
    // a leitura termina (antes, a tela ficava "Baixando…" por 15 minutos).
    if (process.platform === "darwin") {
      for (let attempt = 0; attempt < 2; attempt++) {
        started = Date.now();
        await expectUserError(
          downloadFirstRunBackup(cloud, { downloader: requestCloudDownload, waitMs: 10_000, pollMs: 20 }),
          firstRunManualDownloadMessage(icloud.label),
        );
        expect(Date.now() - started).toBeLessThan(5_000);
      }
    }

    // A iCloud Drive não aceitou o pedido: explica o caminho manual, com a pasta certa.
    await expectUserError(
      downloadFirstRunBackup(cloud, {
        downloader: async () => {
          throw new Error("brctl");
        },
      }),
      firstRunManualDownloadMessage(icloud.label),
    );
    // Só arquivos da lista.
    await expectUserError(downloadFirstRunBackup(path.join(work, "outro.zip")), FIRST_RUN_GONE_MESSAGE);

    // Download que termina um pouco depois: pronto, e a lista libera “Restaurar”.
    const downloads = async (file: string) => {
      setTimeout(() => void copyFile(source, file), 100);
      return undefined;
    };
    expect(await downloadFirstRunBackup(cloud, { downloader: downloads, waitMs: 10_000, pollMs: 20 })).toEqual({
      ready: true,
      folderLabel: icloud.label,
    });
    const after = (await firstRunBackups()).find((f) => f.path === cloud);
    expect(after).toMatchObject({ cloudOnly: false, problem: null });
    // Já baixado: nada a fazer.
    expect(await downloadFirstRunBackup(cloud, { downloader: slow })).toEqual({
      ready: true,
      folderLabel: icloud.label,
    });
    expect(asked).toEqual([cloud]);
  }, 60_000);
});
