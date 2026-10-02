/**
 * Configurações do backup (AppSetting "backup") e a pasta de destino:
 * "Documentos/Offer Studio Backups" (padrão), "iCloud Drive/Offer Studio
 * Backups" (recomendada: fica fora deste Mac; só quando a iCloud Drive existe)
 * ou uma pasta à escolha (caminho completo, que dá para criar e gravar, fora da
 * pasta de dados do app).
 */
import { randomBytes } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { mkdir, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { UserError } from "@/lib/errors";
import { backupHome } from "./context";
import type { LOCAL_SETTING_KEYS } from "./format";

export const BACKUP_SETTING_KEY: (typeof LOCAL_SETTING_KEYS)[number] = "backup";
export const INSTALL_SETTING_KEY: (typeof LOCAL_SETTING_KEYS)[number] = "install";

export const BACKUP_FOLDER_NAME = "Offer Studio Backups";

export const FolderPresetSchema = z.enum(["documents", "icloud", "custom"]);
export type FolderPreset = z.infer<typeof FolderPresetSchema>;

export interface BackupSettings {
  folder: FolderPreset;
  /** Caminho completo, quando folder = "custom". */
  customPath: string | null;
  /** Backup automático todo dia (ligado por padrão). */
  auto: boolean;
  /** Hora do backup automático (0–23, hora deste Mac). */
  hour: number;
  /** Quantos backups automáticos guardar na pasta (os manuais ficam até você apagar). */
  keep: number;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  folder: "documents",
  customPath: null,
  auto: true,
  hour: 3,
  keep: 10,
};

export const BackupSettingsPatchSchema = z.object({
  folder: FolderPresetSchema.optional(),
  customPath: z.string().max(1024, "Caminho longo demais.").nullable().optional(),
  auto: z.boolean().optional(),
  hour: z.number().int().min(0, "Escolha uma hora entre 0 e 23.").max(23, "Escolha uma hora entre 0 e 23.").optional(),
  keep: z.number().int().min(1, "Guarde pelo menos 1 backup.").max(100, "Guarde no máximo 100 backups.").optional(),
});
export type BackupSettingsPatch = z.infer<typeof BackupSettingsPatchSchema>;

/** Lê o valor guardado campo a campo: o que estiver estranho volta ao padrão. */
export function parseBackupSettings(value: unknown): BackupSettings {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const pick = <T>(schema: z.ZodType<T>, raw: unknown, fallback: T): T => {
    const r = schema.safeParse(raw);
    return r.success ? r.data : fallback;
  };
  const d = DEFAULT_BACKUP_SETTINGS;
  const customPath = pick(z.string().min(1).nullable(), v.customPath ?? null, null);
  let folder = pick(FolderPresetSchema, v.folder, d.folder);
  if (folder === "custom" && !customPath) folder = d.folder;
  return {
    folder,
    customPath,
    auto: pick(z.boolean(), v.auto, d.auto),
    hour: pick(z.number().int().min(0).max(23), v.hour, d.hour),
    keep: pick(z.number().int().min(1).max(100), v.keep, d.keep),
  };
}

export async function getBackupSettings(): Promise<BackupSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: BACKUP_SETTING_KEY }, select: { value: true } });
  return parseBackupSettings(row?.value);
}

// ─── Pastas ──────────────────────────────────────────────────────────────────

export interface FolderPresetInfo {
  id: Exclude<FolderPreset, "custom">;
  label: string;
  path: string;
  available: boolean;
}

/** Raiz da iCloud Drive no Mac (só existe com a iCloud Drive ligada). */
export function iCloudDriveRoot(home = backupHome()): string {
  return path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs");
}

export function folderPresets(home = backupHome()): FolderPresetInfo[] {
  return [
    {
      id: "documents",
      label: `Documentos › ${BACKUP_FOLDER_NAME}`,
      path: path.join(home, "Documents", BACKUP_FOLDER_NAME),
      available: true,
    },
    {
      id: "icloud",
      label: `iCloud Drive › ${BACKUP_FOLDER_NAME}`,
      path: path.join(iCloudDriveRoot(home), BACKUP_FOLDER_NAME),
      available: existsSync(iCloudDriveRoot(home)),
    },
  ];
}

export interface ResolvedFolder {
  preset: FolderPreset;
  path: string;
  label: string;
  /** Pasta que não dá para usar agora (iCloud Drive desligada). */
  unavailable: string | null;
}

export function resolveBackupFolder(settings: BackupSettings, home = backupHome()): ResolvedFolder {
  if (settings.folder === "custom" && settings.customPath) {
    return { preset: "custom", path: settings.customPath, label: settings.customPath, unavailable: null };
  }
  const presets = folderPresets(home);
  const preset = presets.find((p) => p.id === settings.folder) ?? presets[0];
  return {
    preset: preset.id,
    path: preset.path,
    label: preset.label,
    unavailable: preset.available
      ? null
      : "A iCloud Drive não está ligada neste Mac. Ligue em Ajustes do Sistema → [seu nome] → iCloud → iCloud Drive, ou escolha outra pasta.",
  };
}

/**
 * Caminho real (segue links) do maior trecho que já existe; o resto é
 * acrescentado como está. Usa o realpath do sistema, que no Mac devolve as
 * maiúsculas e minúsculas gravadas no disco (o do Node manteria as do link:
 * "…/DADOS/storage" e "…/dados/storage" seriam textos diferentes).
 */
function realPathOf(p: string): string {
  let current = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync.native(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...rest);
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** realPathOf sem travar o processo (o worker usa numa pasta que pode ser de rede). */
async function realPathOfAsync(p: string): Promise<string> {
  let current = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(await realpath(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...rest);
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

type DiskId = { dev: number; ino: number };

/** Alguma pasta do caminho (ou ele mesmo) é `target` no disco? Partes que não existem são puladas. */
function hasAncestor(p: string, target: DiskId): boolean {
  for (let current = p; ; current = path.dirname(current)) {
    try {
      const info = statSync(current);
      if (info.dev === target.dev && info.ino === target.ino) return true;
    } catch {
      // ainda não existe: confere a pasta de cima
    }
    if (path.dirname(current) === current) return false;
  }
}

async function hasAncestorAsync(p: string, target: DiskId): Promise<boolean> {
  for (let current = p; ; current = path.dirname(current)) {
    const info = await stat(current).catch(() => null);
    if (info && info.dev === target.dev && info.ino === target.ino) return true;
    if (path.dirname(current) === current) return false;
  }
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

export const INSIDE_DATA_DIR_MESSAGE =
  "Escolha uma pasta fora da pasta de dados do Offer Studio: o backup precisa ficar a salvo mesmo se essa pasta for apagada.";

/**
 * A pasta fica dentro da pasta de dados do app? Compara pela identidade no
 * disco (não pelo texto): no Mac, "DataDir" e "datadir" são a mesma pasta, e
 * um link pode apontar para dentro dela (inclusive escrito com outras
 * maiúsculas). Confere o caminho digitado e o caminho real (links seguidos).
 */
export function isInsideDataDir(folder: string): boolean {
  const dataDir = path.resolve(env.dataDir);
  const normalized = path.resolve(folder);
  if (isInside(normalized, dataDir)) return true;
  const real = realPathOf(normalized);
  if (isInside(real, realPathOf(dataDir))) return true;
  let data: DiskId;
  try {
    data = statSync(dataDir);
  } catch {
    return false;
  }
  return hasAncestor(normalized, data) || hasAncestor(real, data);
}

/**
 * isInsideDataDir sem chamadas síncronas ao disco: no worker, uma pasta de rede
 * travada não pode congelar o processo inteiro (e os vigias de travamento).
 */
export async function isInsideDataDirAsync(folder: string): Promise<boolean> {
  const dataDir = path.resolve(env.dataDir);
  const normalized = path.resolve(folder);
  if (isInside(normalized, dataDir)) return true;
  const real = await realPathOfAsync(normalized);
  if (isInside(real, await realPathOfAsync(dataDir))) return true;
  const data = await stat(dataDir).catch(() => null);
  if (!data) return false;
  return (await hasAncestorAsync(normalized, data)) || (await hasAncestorAsync(real, data));
}

/** Recusa (UserError) uma pasta dentro da pasta de dados do app (tela de configurações). */
export function assertOutsideDataDir(folder: string, field?: string): void {
  if (isInsideDataDir(folder)) throw new UserError(INSIDE_DATA_DIR_MESSAGE, field);
}

/** assertOutsideDataDir para o worker (sem travar o processo numa pasta de rede). */
export async function assertOutsideDataDirAsync(folder: string): Promise<void> {
  if (await isInsideDataDirAsync(folder)) throw new UserError(INSIDE_DATA_DIR_MESSAGE);
}

/**
 * Confere o caminho de uma pasta escolhida: completo (começando com "/"; "~/"
 * vale como a pasta pessoal) e fora da pasta de dados do app. Devolve o caminho
 * normalizado. A gravação é conferida por ensureWritableFolder.
 */
export function normalizeCustomFolder(input: string, home = backupHome()): string {
  let raw = input.trim().replace(/^["']|["']$/g, "");
  if (!raw) throw new UserError("Informe o caminho da pasta.", "customPath");
  if (raw === "~" || raw.startsWith("~/")) raw = path.join(home, raw.slice(1));
  if (!path.isAbsolute(raw)) {
    throw new UserError(
      "Use o caminho completo da pasta, começando com “/” (ex.: /Volumes/MeuHD/Backups).",
      "customPath",
    );
  }
  const normalized = path.resolve(raw);
  if (normalized === path.parse(normalized).root) {
    throw new UserError("Escolha uma pasta, não a raiz do disco.", "customPath");
  }
  assertOutsideDataDir(normalized, "customPath");
  return normalized;
}

/**
 * O disco externo ou de rede /Volumes/<nome> está conectado? Lê só a lista de
 * /Volumes (no disco do sistema): nunca toca no próprio disco, que pode ser
 * justamente o que parou de responder.
 */
async function volumeConnected(volume: string): Promise<boolean> {
  try {
    return (await readdir("/Volumes")).includes(volume);
  } catch {
    return true;
  }
}

/** Mensagem clara para um erro do disco ao usar a pasta de backup (sem chamadas que travam o processo). */
export async function folderErrorMessage(err: unknown, folder: string): Promise<string> {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  const volume = /^\/Volumes\/([^/]+)/.exec(folder)?.[1];
  if (volume && !(await volumeConnected(volume))) {
    return `O disco “${volume}” não está conectado. Conecte o disco ou escolha outra pasta para os backups.`;
  }
  if (code === "ENOSPC")
    return "Não há espaço livre no disco da pasta de backup. Libere espaço ou escolha outra pasta.";
  if (code === "EPERM" || code === "EACCES") {
    const home = backupHome();
    if (isInside(folder, path.join(home, "Documents")) || isInside(folder, path.join(home, "Library"))) {
      return "O macOS não deixou o Offer Studio usar essa pasta. Abra Ajustes do Sistema → Privacidade e Segurança → Arquivos e Pastas e permita que o Terminal acesse a pasta (Documentos ou iCloud Drive). Depois, tente de novo.";
    }
    return "O Offer Studio não tem permissão para gravar nessa pasta. Escolha outra pasta.";
  }
  if (code === "ENOTDIR" || code === "EEXIST") return "Esse caminho é de um arquivo, não de uma pasta.";
  if (code === "EROFS") return "Essa pasta fica num disco só de leitura. Escolha outra pasta.";
  return "Não foi possível usar essa pasta para os backups. Confira o caminho ou escolha outra pasta.";
}

/** Cria a pasta (se preciso) e confere que dá para gravar nela. Lança UserError em pt-BR. */
export async function ensureWritableFolder(folder: string, field?: string): Promise<void> {
  try {
    const info = await stat(folder).catch(() => null);
    if (info && !info.isDirectory()) {
      throw Object.assign(new Error("not a directory"), { code: "ENOTDIR" });
    }
    // Pasta criada pelo app: só você lê (os backups levam a chave dos tokens dos pixels).
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const probe = path.join(folder, `.offer-studio-teste-${randomBytes(4).toString("hex")}`);
    await writeFile(probe, "ok");
    await rm(probe, { force: true });
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw new UserError(await folderErrorMessage(err, folder), field);
  }
}

/**
 * Salva as configurações (só os campos enviados). Uma pasta escolhida é
 * conferida antes (caminho, gravação); trocar de pasta não move os backups que
 * já estão na antiga.
 */
export async function saveBackupSettings(patch: BackupSettingsPatch): Promise<BackupSettings> {
  const parsed = BackupSettingsPatchSchema.parse(patch);
  const current = await getBackupSettings();
  const next: BackupSettings = { ...current };
  if (parsed.auto !== undefined) next.auto = parsed.auto;
  if (parsed.hour !== undefined) next.hour = parsed.hour;
  if (parsed.keep !== undefined) next.keep = parsed.keep;
  if (parsed.folder !== undefined) {
    if (parsed.folder === "custom") {
      const raw = parsed.customPath ?? current.customPath;
      if (!raw) throw new UserError("Informe o caminho da pasta.", "customPath");
      const folder = normalizeCustomFolder(raw);
      await ensureWritableFolder(folder, "customPath");
      next.folder = "custom";
      next.customPath = folder;
    } else {
      const preset = folderPresets().find((p) => p.id === parsed.folder);
      if (preset && !preset.available) {
        throw new UserError(
          "A iCloud Drive não está ligada neste Mac. Ligue em Ajustes do Sistema → [seu nome] → iCloud → iCloud Drive, ou escolha outra pasta.",
          "folder",
        );
      }
      next.folder = parsed.folder;
    }
  }
  await prisma.appSetting.upsert({
    where: { key: BACKUP_SETTING_KEY },
    create: { key: BACKUP_SETTING_KEY, value: { ...next } },
    update: { value: { ...next } },
  });
  return next;
}

/** Identidade desta instalação (criada na primeira vez). Uma restauração não troca. */
export async function getInstallId(): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { key: INSTALL_SETTING_KEY }, select: { value: true } });
  const current = (row?.value as { id?: unknown } | undefined)?.id;
  if (typeof current === "string" && current) return current;
  const id = `os-${randomBytes(12).toString("hex")}`;
  const value = JSON.stringify({ id, createdAt: new Date().toISOString() });
  // Duas chamadas ao mesmo tempo: fica a primeira gravada (um valor estragado é trocado).
  await prisma.$executeRaw`
    insert into "AppSetting" (key, value, "updatedAt")
    values (${INSTALL_SETTING_KEY}, ${value}::jsonb, now())
    on conflict (key) do update set value = excluded.value, "updatedAt" = now()
    where jsonb_typeof("AppSetting".value -> 'id') is distinct from 'string'`;
  const saved = await prisma.appSetting.findUnique({ where: { key: INSTALL_SETTING_KEY }, select: { value: true } });
  const savedId = (saved?.value as { id?: unknown } | undefined)?.id;
  return typeof savedId === "string" && savedId ? savedId : id;
}
