/**
 * Backup automático (Fase 6) — o que o painel usa: situação, lista de backups
 * da pasta, pedir um backup, acompanhar, conferir um arquivo antes de
 * restaurar, pedir a restauração, apagar e mostrar no Finder.
 *
 * O trabalho pesado (montar o ZIP, restaurar) fica no worker (./jobs,
 * ./archive, ./restore): este arquivo não importa nenhum deles.
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { UserError } from "@/lib/errors";
import { timeAgo } from "@/lib/format";
import { appVersion, backupHome, keyFingerprint } from "./context";
import { type BackupKindValue, CORRUPT_FILES_RE, compatibilityProblem, isDataless } from "./format";
import { type BackupFileView, cloudOnlyTarget, forgetManifest, listBackupFiles } from "./listing";
import { prismaQueryable, QUEUED_STEP, RESTORE_IN_PROGRESS_MESSAGE, requestBackup } from "./queue";
import { openBackup } from "./reader";
import { autoBackupDue, type BackupHealth, backupHealth, nextAutoBackupAt } from "./schedule";
import {
  type BackupSettings,
  type FolderPresetInfo,
  folderPresets,
  getBackupSettings,
  getInstallId,
  type ResolvedFolder,
  resolveBackupFolder,
} from "./settings";
import { appliedMigrations } from "./tables";

export type { BackupFileView } from "./listing";
export type { BackupHealth } from "./schedule";
export type { BackupSettings, FolderPresetInfo } from "./settings";
export { BackupSettingsPatchSchema, saveBackupSettings } from "./settings";

/** O worker é dado como parado sem sinal de vida há mais que isso. */
const WORKER_SILENT_MS = 30_000;

export interface BackupJobView {
  id: string;
  kind: BackupKindValue;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  progress: number;
  step: string | null;
  errorMessage: string | null;
  filePath: string | null;
  fileName: string | null;
  bytes: number | null;
  offerCount: number | null;
  warnings: string[];
  createdAt: string;
  finishedAt: string | null;
  /** Na fila e o worker parado: não vai começar. */
  workerOnline?: boolean;
}

export interface RestoreJobView {
  id: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  progress: number;
  step: string | null;
  errorMessage: string | null;
  accountEmail: string | null;
  safetyPath: string | null;
  createdAt: string;
  finishedAt: string | null;
  workerOnline?: boolean;
}

export interface BackupOverview {
  settings: BackupSettings;
  folder: ResolvedFolder;
  presets: FolderPresetInfo[];
  lastBackup: {
    at: string;
    bytes: number | null;
    offers: number | null;
    kind: BackupKindValue;
    fileName: string | null;
  } | null;
  lastFailure: { at: string; message: string } | null;
  current: BackupJobView | null;
  restore: RestoreJobView | null;
  /** Próximo backup automático (ISO); null = desligado. */
  nextAutoAt: string | null;
  /** O automático está atrasado e vai rodar em instantes (worker no ar). */
  autoSoon: boolean;
  workerOnline: boolean;
  health: BackupHealth;
}

type BackupRow = Awaited<ReturnType<typeof prisma.backup.findFirstOrThrow>>;
type RestoreRow = Awaited<ReturnType<typeof prisma.backupRestore.findFirstOrThrow>>;

function warningsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((w): w is string => typeof w === "string") : [];
}

export function toBackupJobView(row: BackupRow): BackupJobView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    progress: row.progress,
    step: row.step,
    errorMessage: row.errorMessage,
    filePath: row.filePath,
    fileName: row.filePath ? path.basename(row.filePath) : null,
    bytes: row.bytes === null ? null : Number(row.bytes),
    offerCount: row.offerCount,
    warnings: warningsOf(row.warnings),
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export function toRestoreJobView(row: RestoreRow): RestoreJobView {
  return {
    id: row.id,
    status: row.status,
    progress: row.progress,
    step: row.step,
    errorMessage: row.errorMessage,
    accountEmail: row.accountEmail,
    safetyPath: row.safetyPath,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

async function workerInfo(now = Date.now()): Promise<{ online: boolean; startedAt: Date | null }> {
  const hb = await prisma.serviceHeartbeat.findUnique({ where: { name: "worker" } });
  const online = Boolean(hb && now - hb.lastSeenAt.getTime() < WORKER_SILENT_MS);
  const started = (hb?.info as { startedAt?: unknown } | undefined)?.startedAt;
  const startedAt = typeof started === "string" ? new Date(started) : null;
  return { online, startedAt: startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt : null };
}

/** Situação do backup para o card de Configurações (e a saúde para o card "Sistema"). */
export async function getBackupOverview(now = new Date()): Promise<BackupOverview> {
  const settings = await getBackupSettings();
  const folder = resolveBackupFolder(settings);
  const [lastDone, lastFailed, current, restore, worker, lastAuto] = await Promise.all([
    prisma.backup.findFirst({ where: { status: "DONE" }, orderBy: { finishedAt: { sort: "desc", nulls: "last" } } }),
    prisma.backup.findFirst({ where: { status: "FAILED" }, orderBy: { finishedAt: { sort: "desc", nulls: "last" } } }),
    prisma.backup.findFirst({ where: { status: { in: ["QUEUED", "RUNNING"] } }, orderBy: { createdAt: "asc" } }),
    prisma.backupRestore.findFirst({ where: { status: { in: ["QUEUED", "RUNNING"] } }, orderBy: { createdAt: "asc" } }),
    workerInfo(now.getTime()),
    prisma.backup.findFirst({
      where: { kind: "AUTO", status: { in: ["DONE", "FAILED"] } },
      orderBy: { finishedAt: { sort: "desc", nulls: "last" } },
    }),
  ]);
  const lastAutoSuccess = await prisma.backup.findFirst({
    where: { kind: "AUTO", status: "DONE" },
    orderBy: { finishedAt: { sort: "desc", nulls: "last" } },
    select: { finishedAt: true },
  });
  const health = backupHealth(
    {
      now,
      auto: settings.auto,
      running: Boolean(current && current.status === "RUNNING"),
      lastSuccessAt: lastDone?.finishedAt ?? null,
      lastFailure:
        lastFailed?.finishedAt && lastFailed.errorMessage
          ? { at: lastFailed.finishedAt, message: lastFailed.errorMessage }
          : null,
      folderProblem: folder.unavailable,
      lastWarning: lastDone ? (warningsOf(lastDone.warnings).find((w) => CORRUPT_FILES_RE.test(w)) ?? null) : null,
    },
    (d) => timeAgo(d),
  );
  const autoSoon = Boolean(
    worker.online &&
      worker.startedAt &&
      autoBackupDue({
        now: new Date(Math.max(now.getTime(), worker.startedAt.getTime() + 120_000)),
        auto: settings.auto,
        hour: settings.hour,
        workerStartedAt: worker.startedAt,
        lastSuccessAt: lastAutoSuccess?.finishedAt ?? null,
        lastAttemptAt: lastAuto?.finishedAt ?? null,
        lastAttemptFailed: lastAuto?.status === "FAILED",
      }),
  );
  const currentView = current ? toBackupJobView(current) : null;
  if (currentView?.status === "QUEUED") currentView.workerOnline = worker.online;
  const restoreView = restore ? toRestoreJobView(restore) : null;
  if (restoreView?.status === "QUEUED") restoreView.workerOnline = worker.online;
  return {
    settings,
    folder,
    presets: folderPresets(),
    lastBackup: lastDone
      ? {
          at: (lastDone.finishedAt ?? lastDone.createdAt).toISOString(),
          bytes: lastDone.bytes === null ? null : Number(lastDone.bytes),
          offers: lastDone.offerCount,
          kind: lastDone.kind,
          fileName: lastDone.filePath ? path.basename(lastDone.filePath) : null,
        }
      : null,
    lastFailure:
      lastFailed?.finishedAt &&
      lastFailed.errorMessage &&
      (!lastDone?.finishedAt || lastFailed.finishedAt > lastDone.finishedAt)
        ? { at: lastFailed.finishedAt.toISOString(), message: lastFailed.errorMessage }
        : null,
    current: currentView,
    restore: restoreView,
    nextAutoAt: nextAutoBackupAt({ now, auto: settings.auto, hour: settings.hour })?.toISOString() ?? null,
    autoSoon,
    workerOnline: worker.online,
    health,
  };
}

async function listContext() {
  return {
    installId: await getInstallId(),
    appVersion: appVersion(),
    migrations: await appliedMigrations(prismaQueryable),
  };
}

/** Backups encontrados na pasta configurada. */
export async function listBackups(): Promise<{ folder: string; files: BackupFileView[] }> {
  const folder = resolveBackupFolder(await getBackupSettings()).path;
  return { folder, files: await listBackupFiles(folder, await listContext()) };
}

/** Um backup (andamento). */
export async function getBackupJob(id: string): Promise<BackupJobView | null> {
  const row = await prisma.backup.findUnique({ where: { id } });
  if (!row) return null;
  const view = toBackupJobView(row);
  if (row.status === "QUEUED") view.workerOnline = (await workerInfo()).online;
  return view;
}

/** Uma restauração (andamento). Sem dados pessoais: é lida também sem login (tela de entrada). */
export async function getRestoreJob(id: string): Promise<RestoreJobView | null> {
  const row = await prisma.backupRestore.findUnique({ where: { id } });
  if (!row) return null;
  const view = toRestoreJobView(row);
  view.accountEmail = null;
  view.safetyPath = null;
  if (row.status === "QUEUED") view.workerOnline = (await workerInfo()).online;
  return view;
}

// ─── Arquivos ────────────────────────────────────────────────────────────────

/** Arquivo escolhido pelo caminho que ainda está só na iCloud Drive. */
export const ICLOUD_PENDING_PATH_MESSAGE =
  "Este backup ainda está só na iCloud Drive. Abra a pasta dele no Finder e baixe o arquivo (ícone de nuvem) antes de restaurar.";
export const BACKUP_CHANGED_MESSAGE =
  "O arquivo de backup mudou desde que você abriu a confirmação. Feche e abra a restauração de novo para conferir o backup.";
/** Chave da tranca que deixa só um pedido de restauração entrar por vez. */
const RESTORE_REQUEST_LOCK = 726_354_001;

/** Confere o caminho de um arquivo de backup digitado (completo, .zip, existe). */
export async function normalizeBackupFilePath(input: string): Promise<string> {
  let raw = input.trim().replace(/^["']|["']$/g, "");
  if (!raw) throw new UserError("Informe o caminho do arquivo de backup.", "path");
  if (raw === "~" || raw.startsWith("~/")) raw = path.join(backupHome(), raw.slice(1));
  if (!path.isAbsolute(raw)) {
    throw new UserError("Use o caminho completo do arquivo, começando com “/”.", "path");
  }
  const full = path.resolve(raw);
  if (!/\.zip$/i.test(full)) throw new UserError("Escolha o arquivo .zip do backup.", "path");
  const info = await stat(full).catch(() => null);
  if (!info) {
    const placeholder = path.join(path.dirname(full), `.${path.basename(full)}.icloud`);
    if (await stat(placeholder).catch(() => null)) throw new UserError(ICLOUD_PENDING_PATH_MESSAGE, "path");
    throw new UserError("Arquivo não encontrado. Confira o caminho.", "path");
  }
  if (!info.isFile()) throw new UserError("Esse caminho é de uma pasta. Escolha o arquivo .zip do backup.", "path");
  // Só na nuvem (macOS 14+): abrir baixaria o arquivo inteiro sem aviso.
  if (isDataless(info)) throw new UserError(ICLOUD_PENDING_PATH_MESSAGE, "path");
  return full;
}

export interface BackupInspection {
  path: string;
  fileName: string;
  createdAt: string;
  kind: BackupKindValue;
  bytes: number;
  offers: number;
  trashedOffers: number;
  pages: number;
  files: number;
  filesBytes: number;
  accountEmail: string | null;
  accountName: string | null;
  computer: string | null;
  appVersion: string;
  /** Feito nesta instalação. */
  sameInstall: boolean;
  /** A chave dos tokens é outra (backup de outro Mac): os tokens são convertidos. */
  otherKey: boolean;
  /** Por que não dá para restaurar (pt-BR), ou null. */
  problem: string | null;
  /** Identifica este backup (a restauração confere que o arquivo não mudou desde a confirmação). */
  fingerprint: string;
}

/** Lê o manifest de um backup para a confirmação (lança UserError se não for um backup legível). */
export async function inspectBackupFile(input: string): Promise<BackupInspection> {
  const file = await normalizeBackupFilePath(input);
  const archive = await openBackup(file, { mode: "manifest", stallMs: 60_000 });
  archive.close();
  // Leu agora: a lista também tenta de novo (um erro guardado de antes não vale mais).
  forgetManifest(file);
  const m = archive.manifest;
  const ctx = await listContext();
  const info = await stat(file);
  return {
    path: file,
    fileName: path.basename(file),
    createdAt: m.createdAt,
    kind: m.kind,
    bytes: info.size,
    offers: m.summary.offers,
    trashedOffers: m.summary.trashedOffers,
    pages: m.summary.pages,
    files: m.storage.files,
    filesBytes: m.storage.bytes,
    accountEmail: m.summary.account?.email ?? null,
    accountName: m.summary.account?.name ?? null,
    computer: m.computer ?? null,
    appVersion: m.appVersion,
    sameInstall: m.installId === ctx.installId,
    otherKey: m.encryption.keyFingerprint !== keyFingerprint(env.APP_ENCRYPTION_KEY),
    problem: compatibilityProblem(m, ctx),
    fingerprint: archive.manifestSha256,
  };
}

/** Pede um backup agora (o worker faz). */
export async function startManualBackup(): Promise<{ backupId: string }> {
  return requestBackup("MANUAL");
}

/**
 * Pede a restauração de um backup (o worker faz, com as outras tarefas em
 * pausa). `fingerprint` é o da confirmação que você viu: se o arquivo mudou
 * desde então, recusa. Dois pedidos ao mesmo tempo (duas abas): só um entra.
 */
export async function startRestore(
  input: string,
  fingerprint?: string | null,
): Promise<{ restoreId: string; accountEmail: string | null }> {
  const inspection = await inspectBackupFile(input);
  if (inspection.problem) throw new UserError(inspection.problem);
  if (fingerprint && fingerprint !== inspection.fingerprint) throw new UserError(BACKUP_CHANGED_MESSAGE);
  if (await prisma.backupRestore.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })) {
    throw new UserError(RESTORE_IN_PROGRESS_MESSAGE);
  }
  const row = await prisma.$transaction(async (tx) => {
    // Conferir e criar de uma vez: outro pedido espera esta transação terminar.
    await tx.$executeRawUnsafe(`select pg_advisory_xact_lock(${RESTORE_REQUEST_LOCK})`);
    if (await tx.backupRestore.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })) {
      throw new UserError(RESTORE_IN_PROGRESS_MESSAGE);
    }
    return tx.backupRestore.create({
      data: {
        sourcePath: inspection.path,
        accountEmail: inspection.accountEmail,
        manifestSha256: inspection.fingerprint,
        step: QUEUED_STEP,
      },
      select: { id: true },
    });
  });
  return { restoreId: row.id, accountEmail: inspection.accountEmail };
}

/** Desiste de uma restauração que ainda não começou. */
export async function cancelRestore(id: string): Promise<void> {
  const { count } = await prisma.backupRestore.deleteMany({ where: { id, status: "QUEUED" } });
  if (!count) throw new UserError("A restauração já começou e não pode mais ser cancelada.");
}

/** O arquivo precisa estar na lista da pasta configurada (só esses podem ser apagados ou mostrados). */
async function listedFile(input: string): Promise<BackupFileView> {
  const { files } = await listBackups();
  const target = path.resolve(input);
  const file = files.find((f) => f.path === target);
  if (!file) throw new UserError("Este backup não está mais na pasta. Atualize a lista.");
  return file;
}

/** Apaga um backup da pasta (só arquivos da lista). */
export async function deleteBackupFile(input: string): Promise<void> {
  const file = await listedFile(input);
  // Só na nuvem: apaga sem baixar (o marcador antigo ".…zip.icloud" ou o próprio arquivo).
  await rm(file.cloudOnly ? cloudOnlyTarget(file) : file.path, { force: true });
  forgetManifest(file.path);
}

export type Opener = (args: string[]) => Promise<void>;

const openInFinder: Opener = (args) =>
  new Promise((resolve, reject) => {
    execFile("open", args, { timeout: 10_000 }, (err) => (err ? reject(err) : resolve()));
  });

/** Mostra o arquivo no Finder (open -R), só para arquivos da lista. */
export async function revealBackupFile(input: string, opener: Opener = openInFinder): Promise<void> {
  const file = await listedFile(input);
  const target = file.cloudOnly ? cloudOnlyTarget(file) : file.path;
  if (process.platform !== "darwin" && opener === openInFinder) {
    throw new UserError("Mostrar no Finder só funciona no Mac.");
  }
  try {
    await opener(["-R", target]);
  } catch {
    throw new UserError("Não foi possível abrir o Finder. Abra a pasta de backups manualmente.");
  }
}

// ─── Primeiro acesso ─────────────────────────────────────────────────────────

/** Instalação nova: sem conta e sem ofertas (só aí a restauração vale sem login). */
export async function isBrandNewInstall(): Promise<boolean> {
  const [users, offers] = await Promise.all([prisma.user.count(), prisma.offer.count()]);
  return users === 0 && offers === 0;
}

/** Pastas onde o primeiro acesso procura backups (para mostrar). */
export async function firstRunFolderLabels(): Promise<string[]> {
  const labels = folderPresets()
    .filter((p) => p.available)
    .map((p) => p.label);
  const configured = resolveBackupFolder(await getBackupSettings());
  if (configured.preset === "custom") labels.push(configured.path);
  return labels;
}

/**
 * Primeiro acesso: backup que está só na iCloud Drive. A tela tem o botão
 * “Baixar” (que pede o arquivo à iCloud Drive) e o “Atualizar”.
 */
export const FIRST_RUN_ICLOUD_MESSAGE =
  "Este backup ainda está só na iCloud Drive. Clique em “Baixar” para trazê-lo para este Mac (pode levar alguns minutos).";
export const FIRST_RUN_GONE_MESSAGE = "Este backup não está mais na pasta. Clique em “Atualizar”.";

/** Quando a iCloud Drive não aceita o pedido (ou não baixa): o caminho manual, com a pasta do arquivo. */
export function firstRunManualDownloadMessage(folderLabel: string): string {
  return `Não foi possível trazer o arquivo da iCloud Drive por aqui. No Finder, abra ${folderLabel}, clique no ícone de nuvem ao lado do arquivo e, quando terminar de baixar, clique em “Atualizar” aqui.`;
}

/** Pastas onde o primeiro acesso procura backups, com o nome para mostrar. */
async function firstRunFolders(): Promise<Map<string, string>> {
  const folders = new Map<string, string>();
  for (const preset of folderPresets()) if (preset.available) folders.set(preset.path, preset.label);
  const configured = resolveBackupFolder(await getBackupSettings());
  if (!folders.has(configured.path)) folders.set(configured.path, configured.label);
  return folders;
}

/** Backups encontrados nas pastas sugeridas (e na configurada) — tela de primeiro acesso. */
export async function firstRunBackups(): Promise<BackupFileView[]> {
  const ctx = await listContext();
  const all: BackupFileView[] = [];
  for (const folder of (await firstRunFolders()).keys()) all.push(...(await listBackupFiles(folder, ctx)));
  // Só na nuvem: esta tela não tem “Mostrar no Finder”; tem “Baixar”.
  for (const file of all) if (file.cloudOnly) file.problem = FIRST_RUN_ICLOUD_MESSAGE;
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Pedido de download à iCloud Drive (sem esperar o download terminar).
 * `finished()` diz se o pedido já acabou — a leitura que traz o arquivo
 * terminou: se o arquivo continua só na nuvem, o pedido não funcionou.
 */
export interface CloudDownloadRequest {
  finished?: () => boolean;
}

/** Pede à iCloud Drive um arquivo que está só na nuvem. */
export type CloudDownloader = (
  file: string,
  opts: { placeholder: boolean },
) => Promise<CloudDownloadRequest | undefined>;

/** Leituras que estão (ou estavam) trazendo um arquivo da iCloud Drive (uma por arquivo). */
const cloudDownloads = new Map<string, { child: ChildProcess; ended: boolean }>();
/** Uma leitura que não termina nesse tempo (sem internet) é encerrada; “Baixar” pede de novo. */
const CLOUD_DOWNLOAD_MAX_MS = 2 * 60 * 60 * 1000;

/**
 * Pede o download como o Finder faz ao abrir o arquivo: ler qualquer pedaço de
 * um arquivo só na nuvem faz o macOS baixá-lo inteiro (a leitura só termina
 * quando ele chega). A leitura fica num processo à parte (o Offer Studio não
 * espera por ela). Se ela terminar (bem ou com erro) e o arquivo continuar só
 * na nuvem, o pedido não funcionou (finished). No macOS antigo (marcador ".…zip.icloud"),
 * usa o "brctl download".
 */
export const requestCloudDownload: CloudDownloader = (file, { placeholder }) => {
  if (process.platform !== "darwin") return Promise.reject(new Error("só no Mac"));
  if (placeholder) {
    return new Promise((resolve, reject) => {
      execFile("brctl", ["download", file], { timeout: 15_000 }, (err) => (err ? reject(err) : resolve(undefined)));
    });
  }
  const current = cloudDownloads.get(file);
  // Ainda lendo (baixando), ou já terminou (quem chamou confere o arquivo e,
  // se ele continua só na nuvem, explica o caminho manual e esquece o pedido).
  if (current) return Promise.resolve({ finished: () => current.ended });
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/head", ["-c", "1", file], { stdio: "ignore", detached: true });
    const entry = { child, ended: false };
    const limit = setTimeout(() => child.kill(), CLOUD_DOWNLOAD_MAX_MS);
    limit.unref();
    child.once("spawn", () => {
      cloudDownloads.set(file, entry);
      child.unref();
      resolve({ finished: () => entry.ended });
    });
    child.once("error", reject);
    // Terminou (o arquivo chegou, a iCloud Drive recusou, sem internet…): fica
    // guardado até alguém conferir o arquivo; aí sai e o próximo “Baixar” pede de novo.
    child.once("exit", () => {
      clearTimeout(limit);
      entry.ended = true;
    });
  });
};

/** O arquivo já está inteiro neste Mac (não é mais só da nuvem)? */
async function isDownloaded(file: string): Promise<boolean> {
  const info = await stat(file).catch(() => null);
  return Boolean(info?.isFile() && !isDataless(info));
}

/**
 * Primeiro acesso: traz da iCloud Drive um backup da lista que está só na
 * nuvem. Pede o download e espera até `waitMs`; devolve ready = false se ainda
 * está baixando (a tela pergunta de novo). Só arquivos da lista do primeiro
 * acesso.
 */
export async function downloadFirstRunBackup(
  input: string,
  opts: { waitMs?: number; pollMs?: number; downloader?: CloudDownloader } = {},
): Promise<{ ready: boolean; folderLabel: string }> {
  const target = path.resolve(input);
  const file = (await firstRunBackups()).find((f) => f.path === target);
  if (!file) throw new UserError(FIRST_RUN_GONE_MESSAGE);
  const folder = path.dirname(file.path);
  // Pasta do arquivo como a tela mostra (para o caminho manual no Finder).
  const folderLabel = (await firstRunFolders()).get(folder) ?? folder;
  if (!file.cloudOnly) return { ready: true, folderLabel };
  const placeholder = !(await stat(file.path).catch(() => null));
  let request: CloudDownloadRequest | undefined;
  try {
    request = await (opts.downloader ?? requestCloudDownload)(file.path, { placeholder });
  } catch {
    throw new UserError(firstRunManualDownloadMessage(folderLabel));
  }
  const waitMs = opts.waitMs ?? 20_000;
  const pollMs = opts.pollMs ?? 1_000;
  const until = Date.now() + waitMs;
  for (;;) {
    if (await isDownloaded(file.path)) {
      forgetManifest(file.path);
      forgetCloudDownload(file.path);
      return { ready: true, folderLabel };
    }
    // A leitura que devia trazer o arquivo já terminou e ele continua só na
    // nuvem: a iCloud Drive não baixou. Explica o caminho manual na hora (em vez
    // de deixar "Baixando…" por muitos minutos). O próximo “Baixar” pede de novo.
    if (request?.finished?.()) {
      if (await isDownloaded(file.path)) {
        forgetManifest(file.path);
        forgetCloudDownload(file.path);
        return { ready: true, folderLabel };
      }
      forgetCloudDownload(file.path);
      throw new UserError(firstRunManualDownloadMessage(folderLabel));
    }
    if (Date.now() >= until) return { ready: false, folderLabel };
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, until - Date.now()))));
  }
}

/** Esquece um pedido de download que já terminou (o próximo “Baixar” pede de novo). */
function forgetCloudDownload(file: string) {
  if (cloudDownloads.get(file)?.ended) cloudDownloads.delete(file);
}
