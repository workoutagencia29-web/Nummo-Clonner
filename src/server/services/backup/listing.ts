/**
 * Backups encontrados numa pasta (pelo nome do arquivo + manifest) e a limpeza
 * dos automáticos antigos (só os desta instalação; manuais e de segurança ficam
 * até você apagar).
 */
import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { UserError } from "@/lib/errors";
import {
  APP_BACKUP_NAME_RE,
  BACKUP_FILE_RE,
  BACKUP_TEMP_RE,
  type BackupKindValue,
  type BackupManifest,
  compatibilityProblem,
  ICLOUD_PLACEHOLDER_RE,
  installTag,
  installTagOfName,
  isDataless,
} from "./format";
import { readBackupManifest } from "./reader";

export interface BackupFileView {
  path: string;
  fileName: string;
  /** Quando o backup foi feito (ISO). */
  createdAt: string;
  kind: BackupKindValue | null;
  bytes: number;
  offers: number | null;
  pages: number | null;
  files: number | null;
  accountEmail: string | null;
  accountName: string | null;
  computer: string | null;
  appVersion: string | null;
  /** Feito por esta instalação do Offer Studio. */
  mine: boolean;
  /** Por que não dá para restaurar (pt-BR), ou null. */
  problem: string | null;
  /** Na iCloud Drive, ainda não baixado para este Mac. */
  cloudOnly: boolean;
}

export interface ListContext {
  installId: string | null;
  appVersion: string;
  migrations: string[];
}

export const ICLOUD_PENDING_MESSAGE =
  "Este backup ainda está só na iCloud Drive. Clique em “Mostrar no Finder” e baixe o arquivo (ícone de nuvem) antes de restaurar.";

/** Na lista, a leitura de um arquivo desiste se o disco parar de mandar dados por isso. */
const LIST_STALL_MS = 30_000;
/**
 * Um erro de leitura fica guardado só por isso: permissão liberada no macOS,
 * download da iCloud Drive terminado ou disco reconectado não mudam o arquivo,
 * e a próxima lista precisa tentar de novo.
 */
export const ERROR_CACHE_MS = 30_000;

type FileStamp = { size: number; mtimeMs: number; ctimeMs: number };
type CacheEntry = FileStamp & { manifest: BackupManifest | null; error: string | null; at: number };
const manifestCache = new Map<string, CacheEntry>();

function sameStamp(a: FileStamp, b: FileStamp) {
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

/** Manifest já lido deste arquivo (sem abrir o arquivo), se ainda vale. */
function cachedManifest(file: string, stamp: FileStamp): BackupManifest | null {
  const cached = manifestCache.get(file);
  return cached?.manifest && sameStamp(cached, stamp) ? cached.manifest : null;
}

async function manifestOf(
  file: string,
  stamp: FileStamp,
): Promise<{ manifest: BackupManifest | null; error: string | null }> {
  const cached = manifestCache.get(file);
  if (cached && sameStamp(cached, stamp) && (cached.manifest || Date.now() - cached.at < ERROR_CACHE_MS)) {
    return cached;
  }
  let entry: CacheEntry;
  try {
    entry = { ...stamp, manifest: await readBackupManifest(file, { stallMs: LIST_STALL_MS }), error: null, at: 0 };
  } catch (err) {
    entry = {
      ...stamp,
      manifest: null,
      error: err instanceof UserError ? err.message : "Não foi possível ler este arquivo.",
      at: Date.now(),
    };
  }
  if (manifestCache.size > 500) manifestCache.clear();
  manifestCache.set(file, entry);
  return entry;
}

function stampOf(info: { size: number; mtimeMs: number; ctimeMs: number }): FileStamp {
  return { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs };
}

/** O que existe no disco para um backup que está só na nuvem: o marcador ".…zip.icloud" (macOS antigo) ou o próprio arquivo. */
export function cloudOnlyTarget(file: Pick<BackupFileView, "path" | "fileName">): string {
  const placeholder = path.join(path.dirname(file.path), `.${file.fileName}.icloud`);
  return existsSync(placeholder) ? placeholder : file.path;
}

/** Data do nome do arquivo ("…-2026-10-01-0300.zip"), na hora local. */
function dateFromName(name: string): Date | null {
  const m = BACKUP_FILE_RE.exec(name);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Backups da pasta, do mais novo para o mais antigo. Pasta que não existe: lista vazia. */
export async function listBackupFiles(folder: string, ctx: ListContext): Promise<BackupFileView[]> {
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return [];
  }
  const out: BackupFileView[] = [];
  for (const name of names) {
    const full = path.join(folder, name);
    const placeholder = ICLOUD_PLACEHOLDER_RE.exec(name);
    if (placeholder) {
      const real = placeholder[1];
      if (!BACKUP_FILE_RE.test(real) || names.includes(real)) continue;
      const info = await stat(full).catch(() => null);
      out.push({
        path: path.join(folder, real),
        fileName: real,
        createdAt: (dateFromName(real) ?? info?.mtime ?? new Date(0)).toISOString(),
        kind: null,
        bytes: 0,
        offers: null,
        pages: null,
        files: null,
        accountEmail: null,
        accountName: null,
        computer: null,
        appVersion: null,
        mine: false,
        problem: ICLOUD_PENDING_MESSAGE,
        cloudOnly: true,
      });
      continue;
    }
    if (!BACKUP_FILE_RE.test(name)) continue;
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) continue;
    // Só na iCloud Drive (macOS 14+: nome de verdade, nenhum bloco no disco):
    // ler o manifest baixaria o arquivo inteiro. Mostra sem abrir.
    if (isDataless(info)) {
      const known = cachedManifest(full, stampOf(info));
      out.push({
        path: full,
        fileName: name,
        createdAt: known?.createdAt ?? (dateFromName(name) ?? info.mtime).toISOString(),
        kind: known?.kind ?? null,
        bytes: info.size,
        offers: known?.summary.offers ?? null,
        pages: known?.summary.pages ?? null,
        files: known?.storage.files ?? null,
        accountEmail: known?.summary.account?.email ?? null,
        accountName: known?.summary.account?.name ?? null,
        computer: known?.computer ?? null,
        appVersion: known?.appVersion ?? null,
        mine: Boolean(known && ctx.installId && known.installId === ctx.installId),
        problem: ICLOUD_PENDING_MESSAGE,
        cloudOnly: true,
      });
      continue;
    }
    const { manifest, error } = await manifestOf(full, stampOf(info));
    const problem = manifest
      ? compatibilityProblem(manifest, { appVersion: ctx.appVersion, migrations: ctx.migrations })
      : error;
    out.push({
      path: full,
      fileName: name,
      createdAt: manifest?.createdAt ?? (dateFromName(name) ?? info.mtime).toISOString(),
      kind: manifest?.kind ?? null,
      bytes: info.size,
      offers: manifest?.summary.offers ?? null,
      pages: manifest?.summary.pages ?? null,
      files: manifest?.storage.files ?? null,
      accountEmail: manifest?.summary.account?.email ?? null,
      accountName: manifest?.summary.account?.name ?? null,
      computer: manifest?.computer ?? null,
      appVersion: manifest?.appVersion ?? null,
      mine: Boolean(manifest && ctx.installId && manifest.installId === ctx.installId),
      problem,
      cloudOnly: false,
    });
  }
  return out.sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.fileName < b.fileName ? 1 : -1,
  );
}

/** Um automático do histórico de backups desta instalação: onde foi gravado e com quantos bytes. */
export interface KnownAutoBackup {
  filePath: string;
  bytes: number | bigint | null;
}

export interface RetentionOptions extends ListContext {
  installId: string;
  keep: number;
  /** Arquivos que nunca podem ser apagados agora (backup escolhido para uma restauração na fila). */
  protect?: Iterable<string>;
  /**
   * Automáticos feitos por esta instalação (histórico de backups): um desses
   * que está só na iCloud Drive entra na conta sem ser baixado — se ainda for
   * o mesmo arquivo (mesmo tamanho e, no nome, a marca desta instalação).
   */
  knownAuto?: Iterable<KnownAutoBackup>;
}

/**
 * Arquivo só na nuvem que é mesmo um automático desta instalação, sem abrir o
 * manifest: o caminho está no histórico e o tamanho confere (com a marca da
 * instalação no nome, ela também). Sem tamanho para comparar (marcador
 * ".…zip.icloud" do macOS antigo), só com a marca desta instalação no nome.
 * Assim um arquivo de outro Mac que a iCloud Drive pôs no mesmo caminho nunca
 * é apagado.
 */
function isKnownCloudAuto(file: BackupFileView, known: Map<string, KnownAutoBackup>, myTag: string): boolean {
  const row = known.get(path.resolve(file.path));
  if (!row) return false;
  const tag = installTagOfName(file.fileName);
  if (tag && tag !== myTag) return false;
  if (file.bytes > 0) return row.bytes !== null && Number(row.bytes) === file.bytes;
  return tag === myTag;
}

/**
 * Fica com os `keep` backups automáticos mais novos desta instalação na pasta e
 * apaga os outros automáticos dela. Só entram na conta arquivos com o nome que
 * o app dá (APP_BACKUP_NAME_RE): cópias e arquivos renomeados por você nunca
 * são apagados. Manuais, de segurança, de outras instalações, arquivos que não
 * dá para ler e os protegidos também nunca são apagados.
 */
export async function applyRetention(folder: string, opts: RetentionOptions): Promise<string[]> {
  const files = await listBackupFiles(folder, opts);
  const known = new Map([...(opts.knownAuto ?? [])].map((row) => [path.resolve(row.filePath), row] as const));
  const protect = new Set([...(opts.protect ?? [])].map((p) => path.resolve(p)));
  const myTag = installTag(opts.installId);
  const auto = files.filter(
    (f) =>
      APP_BACKUP_NAME_RE.test(f.fileName) &&
      (f.cloudOnly ? isKnownCloudAuto(f, known, myTag) : f.kind === "AUTO" && f.mine),
  );
  const doomed = auto.slice(Math.max(1, opts.keep)).filter((f) => !protect.has(path.resolve(f.path)));
  const deleted: string[] = [];
  for (const file of doomed) {
    try {
      // Só na nuvem: apaga sem baixar (o marcador antigo ou o próprio arquivo).
      await rm(file.cloudOnly ? cloudOnlyTarget(file) : file.path, { force: true });
      manifestCache.delete(file.path);
      deleted.push(file.path);
    } catch (err) {
      console.error(`[backup] não foi possível apagar ${file.fileName}:`, err);
    }
  }
  return deleted;
}

/** Apaga temporários esquecidos de backups interrompidos (só os com mais de `olderThanMs`). */
export async function removeStaleTemps(folder: string, olderThanMs: number, now = Date.now()): Promise<number> {
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!BACKUP_TEMP_RE.test(name)) continue;
    const full = path.join(folder, name);
    const info = await stat(full).catch(() => null);
    if (!info || now - info.mtimeMs < olderThanMs) continue;
    await rm(full, { force: true }).catch(() => undefined);
    removed++;
  }
  return removed;
}

/** Esquece o manifest guardado de um arquivo (apagado ou substituído). */
export function forgetManifest(file: string) {
  manifestCache.delete(file);
}
