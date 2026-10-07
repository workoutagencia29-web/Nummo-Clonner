/**
 * Formato do arquivo de backup do Offer Studio (Fase 6).
 *
 * "offer-studio-backup-<aaaa-mm-dd-hhmm>.zip" com:
 *   db/<tabela>.jsonl     uma linha por registro (row_to_json do PostgreSQL),
 *                         todas as tabelas do app, em ordem de dependência
 *   storage/<chave>       arquivos usados pelas ofertas (endereçados por hash,
 *                         versões salvas, saídas de clonagens ainda em revisão)
 *   storage-index.jsonl   chave, tamanho e SHA-256 de cada arquivo acima
 *   secrets.json          APP_ENCRYPTION_KEY (lê os tokens dos pixels e a chave do
 *                         gateway de pagamento em outro Mac)
 *   manifest.json         versão do formato e do app, migrations, contagens,
 *                         SHA-256 de cada entrada, impressão digital da chave
 *
 * O manifest é a última entrada (só se sabe tudo no fim); os leitores usam o
 * índice central do ZIP, então a ordem não importa.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

/** Versão do formato. Suba quando um leitor antigo não souber ler o novo. */
export const BACKUP_FORMAT = 1;
export const BACKUP_APP = "offer-studio";

export const MANIFEST_ENTRY = "manifest.json";
export const SECRETS_ENTRY = "secrets.json";
export const STORAGE_INDEX_ENTRY = "storage-index.jsonl";
export const DB_DIR = "db/";
export const STORAGE_DIR = "storage/";

/**
 * Backups que aparecem na lista (e podem ser restaurados): os nomes que o app
 * dá e também os que a iCloud Drive e o Finder dão a cópias, conflitos e
 * arquivos renomeados ("… 2.zip", "… (1).zip", "… copy.zip", "… cópia.zip",
 * "… IMPORTANTE.zip"): o que identifica o backup é o manifest, não o nome.
 */
export const BACKUP_FILE_RE = /^offer-studio-backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(?:[- ][^/]{0,60})?\.zip$/i;
/**
 * Nomes que o próprio app dá — "…-0300.zip", com a marca da instalação
 * ("…-0300-3fa9c.zip") e o sufixo -2, -3… de outro backup no mesmo minuto — e
 * o "… 2.zip" de um conflito da iCloud Drive. Só esses a limpeza automática
 * apaga: uma cópia ou um arquivo que você renomeou ("… copy.zip",
 * "… cópia.zip", "… (1).zip", "… IMPORTANTE.zip") fica até você apagar.
 */
export const APP_BACKUP_NAME_RE =
  /^offer-studio-backup-\d{4}-\d{2}-\d{2}-\d{4}(?:-([0-9a-f]{5}))?(?:-\d{1,3})?(?: \d{1,3})?\.zip$/i;
/** Temporário de um backup em andamento (oculto, ao lado do final). */
export const BACKUP_TEMP_RE = /^\.offer-studio-backup-.+\.tmp$/;
/** Arquivo da iCloud Drive que ainda não foi baixado para este Mac. */
export const ICLOUD_PLACEHOLDER_RE = /^\.(offer-studio-backup-.+\.zip)\.icloud$/;

/**
 * Tabelas que ficam de fora do backup e que a restauração não toca: é o estado
 * deste Mac (histórico de backups, pedido de restauração em andamento, sinal de
 * vida do worker) e a estrutura do banco.
 */
export const LOCAL_TABLES = ["_prisma_migrations", "Backup", "BackupRestore", "ServiceHeartbeat"] as const;
/**
 * Tabelas passageiras: ficam de fora do backup e a restauração esvazia
 * (sessões de login — depois de restaurar, entra-se com a conta do backup —,
 * códigos de verificação, contagem de tentativas de login e links de prévia).
 */
export const TRANSIENT_TABLES = ["session", "verification", "rateLimit", "PreviewToken"] as const;
/**
 * Colunas com segredos criptografados com a APP_ENCRYPTION_KEY (src/lib/crypto.ts):
 * restaurando o backup de outro Mac (outra chave), são criptografadas de novo
 * com a chave deste. Segredo novo numa tabela nova: acrescente aqui.
 */
export const ENCRYPTED_COLUMNS: Record<string, readonly string[]> = {
  PixelConfig: ["accessTokenEnc"],
  PaymentGateway: ["apiKeyEnc"],
};
/** Configurações (AppSetting) deste Mac: ficam de fora do backup e a restauração mantém. */
export const LOCAL_SETTING_KEYS = ["backup", "install"] as const;

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().nonnegative();

const TableEntrySchema = z.object({
  name: z.string().min(1),
  file: z.string().min(1),
  rows: count,
  columns: z.array(z.string()),
  bytes: count,
  sha256: sha,
});

export const BackupKindSchema = z.enum(["AUTO", "MANUAL", "SAFETY"]);
export type BackupKindValue = z.infer<typeof BackupKindSchema>;

export const ManifestSchema = z.object({
  app: z.literal(BACKUP_APP),
  format: z.number().int().positive(),
  appVersion: z.string(),
  createdAt: z.string(),
  kind: BackupKindSchema,
  /** Identifica a instalação que fez o backup (a limpeza automática só apaga os desta). */
  installId: z.string(),
  /** Nome do computador (só para mostrar). */
  computer: z.string().nullable().optional(),
  /** Migrations do Prisma aplicadas no banco de origem. */
  migrations: z.array(z.string()),
  tables: z.array(TableEntrySchema),
  storage: z.object({
    files: count,
    bytes: count,
    index: z.object({ file: z.string(), bytes: count, sha256: sha }),
    /** Arquivos citados pelas ofertas que não estavam no disco na hora do backup. */
    missing: z.array(z.string()),
  }),
  secrets: z.object({ file: z.string(), sha256: sha }),
  summary: z.object({
    offers: count,
    trashedOffers: count,
    pages: count,
    account: z.object({ email: z.string(), name: z.string() }).nullable(),
  }),
  encryption: z.object({ keyFingerprint: z.string() }),
});

export type BackupManifest = z.infer<typeof ManifestSchema>;
export type TableEntry = z.infer<typeof TableEntrySchema>;

export const StorageIndexLineSchema = z.object({ key: z.string(), bytes: count, sha256: sha });
export type StorageIndexLine = z.infer<typeof StorageIndexLineSchema>;

export const SecretsSchema = z.object({ APP_ENCRYPTION_KEY: z.string() });

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Marca curta da instalação no nome do arquivo ("3fa9c"). Dois Macs gravando na
 * mesma iCloud Drive no mesmo minuto (o automático das 3h) nunca disputam o
 * mesmo nome: sem isso, a iCloud Drive renomeia um deles e o caminho guardado
 * no histórico de um Mac passa a ser o arquivo do outro.
 */
export function installTag(installId: string): string {
  return createHash("sha256").update(installId).digest("hex").slice(0, 5);
}

/** Marca da instalação no nome de um arquivo do app, ou null (nome antigo, sem marca). */
export function installTagOfName(name: string): string | null {
  return APP_BACKUP_NAME_RE.exec(name)?.[1]?.toLowerCase() ?? null;
}

/**
 * "offer-studio-backup-2026-10-01-0300-3fa9c.zip" (hora local, marca da
 * instalação); sem instalação → "…-0300.zip"; n > 1 → "…-0300-3fa9c-2.zip".
 */
export function backupFileName(date: Date, n = 1, installId?: string): string {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const tag = installId ? `-${installTag(installId)}` : "";
  return `offer-studio-backup-${stamp}${tag}${n > 1 ? `-${n}` : ""}.zip`;
}

/** Chaves de storage que um backup pode trazer (qualquer outra é recusada). */
const STORAGE_KEY_RES = [
  /^a\/[0-9a-f]{2}\/[0-9a-f]{64}\.[a-z0-9]{1,8}$/,
  /^versions\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_.-]{1,128}$/,
  /^clones\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_.-]{1,128}$/,
];

export function isBackupStorageKey(key: string): boolean {
  // Nada de "", "." ou ".." como parte do caminho ("versions/x/." viraria a pasta "versions/x").
  const parts = key.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return false;
  return !key.includes("..") && STORAGE_KEY_RES.some((re) => re.test(key));
}

/** SHA-256 que o nome de um arquivo endereçado por hash promete ("a/3f/<sha>.png"), ou null. */
export function shaFromStorageKey(key: string): string | null {
  return /^a\/[0-9a-f]{2}\/([0-9a-f]{64})\./.exec(key)?.[1] ?? null;
}

/**
 * Arquivo da iCloud Drive que está só na nuvem. Desde o macOS 14 ele fica com o
 * nome de verdade, mas sem nenhum bloco no disco ("dataless"); ler qualquer
 * pedaço dele faz o macOS baixar o arquivo inteiro.
 */
export function isDataless(info: { isFile(): boolean; size: number; blocks: number }): boolean {
  return info.isFile() && info.size > 0 && info.blocks === 0;
}

/** Compara versões "1.2.3" (partes que faltam valem 0). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split(/[.+-]/).map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export const NEWER_VERSION_MESSAGE =
  "Este backup foi feito por uma versão mais nova do Offer Studio. Atualize o Offer Studio neste Mac e tente de novo.";
export const DAMAGED_MESSAGE =
  "O arquivo de backup está danificado ou incompleto. Escolha outro backup (os automáticos ficam na mesma pasta).";
export const NOT_A_BACKUP_MESSAGE = "Este arquivo não é um backup do Offer Studio.";
export const READ_STALLED_MESSAGE =
  "O arquivo de backup parou de responder durante a leitura (disco externo ou iCloud Drive desconectado?). Copie o backup para este Mac e tente de novo. Nada foi alterado.";
/** Erro de leitura do disco (disco externo desconectado, iCloud Drive que falhou): o backup não está danificado. */
export const READ_IO_MESSAGE =
  "O disco ou a iCloud Drive não respondeu ao ler o arquivo de backup (disco externo desconectado ou arquivo ainda baixando?). Confira a conexão e tente de novo; se repetir, copie o backup para este Mac.";
export const RESTORE_NO_SPACE_MESSAGE =
  "Não há espaço livre neste Mac para restaurar o backup. Libere espaço e tente de novo. Nada foi alterado.";

/** Aviso do backup quando arquivos deste Mac estavam estragados (não conferem com o próprio hash). */
export function corruptFilesWarning(n: number): string {
  return n === 1
    ? "1 arquivo estava estragado neste Mac e ficou de fora do backup (a imagem aparece quebrada nas páginas)."
    : `${n} arquivos estavam estragados neste Mac e ficaram de fora do backup (as imagens aparecem quebradas nas páginas).`;
}
export const CORRUPT_FILES_RE = /estragados? neste Mac e fic/;

/**
 * Diz se o backup pode ser restaurado nesta instalação. Recusa (com a mensagem
 * em pt-BR) um backup de uma versão mais nova: formato, versão do app ou uma
 * migration que este banco ainda não tem. Um backup mais antigo é aceito (as
 * colunas novas recebem o valor padrão).
 */
export function compatibilityProblem(
  manifest: Pick<BackupManifest, "format" | "appVersion" | "migrations">,
  current: { appVersion: string; migrations: string[] },
): string | null {
  if (manifest.format > BACKUP_FORMAT) return NEWER_VERSION_MESSAGE;
  if (compareVersions(manifest.appVersion, current.appVersion) > 0) return NEWER_VERSION_MESSAGE;
  const known = new Set(current.migrations);
  if (manifest.migrations.some((m) => !known.has(m))) return NEWER_VERSION_MESSAGE;
  return null;
}
