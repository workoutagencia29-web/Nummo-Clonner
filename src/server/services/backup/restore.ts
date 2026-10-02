/**
 * Restauração de um backup (roda no worker, com as outras tarefas em pausa).
 *
 * 1. Confere o arquivo inteiro antes de mexer em qualquer coisa: manifest,
 *    versão (recusa backup de uma versão mais nova; aceita um mais antigo),
 *    SHA-256 de cada tabela e de cada arquivo que vai ser copiado. Os arquivos
 *    que faltam aqui vão para uma pasta temporária enquanto são conferidos.
 * 2. Faz um backup de segurança do estado atual (quem chama decide como).
 * 3. Põe os arquivos no storage (endereçados por hash: nunca sobrescreve).
 * 4. Numa única transação: esvazia as tabelas do app (e as sessões de login),
 *    insere as linhas em ordem de dependência só com as colunas que o backup
 *    tem (colunas novas ficam com o valor padrão), acerta as sequências,
 *    troca a criptografia dos tokens dos pixels se a chave do backup for outra
 *    e marca a restauração como concluída. Qualquer erro desfaz tudo.
 *
 * Nada espera para sempre (RestoreTimeouts): as tabelas são trancadas de uma
 * vez com tempo total limitado (outra tarefa usando o banco → "ocupado"), cada
 * comando e cada pausa no meio da transação têm limite no próprio PostgreSQL
 * (estourou → o banco desfaz a transação), o app também desiste se o banco não
 * responder, toda leitura do arquivo (tabelas, arquivos, índice) desiste se ele
 * parar de mandar dados, e tudo antes do banco desiste se ficar sem andamento.
 *
 * Arquivos endereçados por hash que já existem aqui mas não conferem com o
 * backup (cortados numa queda de energia, estragados no disco) são consertados
 * com a cópia do backup; os outros que já existem ficam como estão.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { type Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { env } from "@/lib/env";
import { UserError } from "@/lib/errors";
import { formatBytes, noSpaceMessage } from "./archive";
import { appVersion, defaultStorageRoot, keyFingerprint } from "./context";
import {
  type BackupManifest,
  compatibilityProblem,
  DAMAGED_MESSAGE,
  isBackupStorageKey,
  LOCAL_SETTING_KEYS,
  READ_STALLED_MESSAGE,
  RESTORE_NO_SPACE_MESSAGE,
  SECRETS_ENTRY,
  SecretsSchema,
  STORAGE_DIR,
  type StorageIndexLine,
  StorageIndexLineSchema,
  shaFromStorageKey,
  TRANSIENT_TABLES,
} from "./format";
import { type BackupArchive, backupReadError, openBackup } from "./reader";
import {
  appliedMigrations,
  backupTableNames,
  dependencyOrder,
  ident,
  loadSchema,
  type SchemaMeta,
  selfReferenceColumns,
  type TableMeta,
} from "./tables";

export const RESTORE_STEP = {
  queued: "Na fila…",
  waiting: "Esperando as tarefas em andamento terminarem…",
  checking: "Conferindo o arquivo de backup…",
  safety: "Fazendo um backup de segurança do estado atual…",
  files: "Copiando imagens e arquivos…",
  database: "Restaurando ofertas, páginas e configurações…",
  done: "Backup restaurado",
} as const;

export const OLD_INCOMPATIBLE_MESSAGE =
  "Este backup é de uma versão do Offer Studio que não dá para restaurar nesta versão.";
export const BUSY_MESSAGE =
  "O Offer Studio estava ocupado e não deu para restaurar agora. Feche as outras abas do Offer Studio e tente de novo. Nada foi alterado.";
export const TIMEOUT_MESSAGE =
  "A restauração parou de responder e foi cancelada. Nada foi alterado: seus dados continuam como estavam. Tente de novo; se repetir, feche e abra o Offer Studio.";
export { READ_STALLED_MESSAGE, RESTORE_NO_SPACE_MESSAGE };
export const CHANGED_SINCE_CONFIRM_MESSAGE =
  "O arquivo de backup mudou desde a confirmação. Abra a restauração de novo e confira o backup. Nada foi alterado.";

/**
 * Limites de tempo da restauração: ela nunca fica parada esperando para sempre.
 * Se algo travar, a transação é desfeita (o banco fica como estava) e a
 * mensagem em pt-BR explica.
 */
export interface RestoreTimeouts {
  /** Espera total para trancar as tabelas do app (outra tarefa usando o banco). */
  lockWaitMs: number;
  /** Tempo máximo de cada comando no banco. */
  statementMs: number;
  /** Tempo máximo parado no meio da transação (lendo o arquivo entre um comando e outro). */
  idleMs: number;
  /** Tempo máximo sem receber dados do arquivo de backup. */
  readStallMs: number;
  /**
   * Tempo máximo sem nenhum andamento antes de mexer no banco (conferência,
   * backup de segurança, arquivos): passou → desiste e nada é alterado.
   */
  stepMs: number;
}

export const DEFAULT_RESTORE_TIMEOUTS: RestoreTimeouts = {
  lockWaitMs: 30_000,
  statementMs: 5 * 60_000,
  idleMs: 2 * 60_000,
  readStallMs: 2 * 60_000,
  stepMs: 10 * 60_000,
};

export interface RestoreOptions {
  filePath: string;
  /** Linha de BackupRestore marcada como concluída na mesma transação. */
  restoreId?: string;
  storageRoot?: string;
  /** Onde ficam os arquivos enquanto são conferidos (padrão: <DATA_DIR>/tmp). */
  tmpRoot?: string;
  databaseUrl?: string;
  /** Chave atual (os tokens dos pixels ficam criptografados com ela). */
  encryptionKey?: string;
  /** Backup de segurança, feito depois da conferência e antes de qualquer mudança. Devolve o caminho (ou null). */
  safetyBackup?: (onProgress: (fraction: number) => void) => Promise<string | null>;
  onProgress?: (progress: number, step: string) => unknown;
  freeBytes?: (dir: string) => Promise<number>;
  /** Limites de tempo (padrão: DEFAULT_RESTORE_TIMEOUTS). */
  timeouts?: Partial<RestoreTimeouts>;
  /** SHA-256 do manifest que você confirmou: se o arquivo mudou desde então, nada é feito. */
  expectedManifestSha256?: string | null;
}

export interface RestoreResult {
  manifest: BackupManifest;
  safetyPath: string | null;
  tables: { name: string; rows: number }[];
  /** Arquivos que não existiam aqui e foram copiados. */
  filesCopied: number;
  /** Arquivos que existiam aqui estragados (não conferiam com o backup) e foram trocados. */
  filesRepaired: number;
  /** Tokens de pixels criptografados de novo com a chave deste Mac. */
  reencrypted: number;
  warnings: string[];
}

const MB = 1024 * 1024;
const BATCH_BYTES = 4 * MB;
const BATCH_ROWS = 500;
const MAX_INDEX_BYTES = 512 * MB;
/** Uma linha de tabela nunca passa disso (bem abaixo do limite de texto do Node). */
const MAX_LINE_BYTES = 128 * MB;
/** Arquivos que já existem com o tamanho certo têm o hash conferido até esse total. */
const REPAIR_HASH_LIMIT = 1024 * MB;

function damaged(): UserError {
  return new UserError(DAMAGED_MESSAGE);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Próximo pedaço da entrada; sem dados por `stallMs`, desiste (disco/iCloud que parou de responder). */
function nextChunk(iterator: AsyncIterator<Buffer>, stream: Readable, stallMs: number) {
  if (!(stallMs > 0)) return iterator.next();
  let timer: NodeJS.Timeout | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new UserError(READ_STALLED_MESSAGE));
      stream.destroy();
    }, stallMs);
  });
  return Promise.race([iterator.next(), stalled]).finally(() => clearTimeout(timer));
}

/**
 * Linhas (sem o "\n") de uma entrada, com o SHA-256 e o tamanho do conteúdo
 * inteiro. Mais que `maxBytes` (o tamanho que o manifest promete) ou uma linha
 * gigante: arquivo danificado (nunca ocupa a memória toda).
 */
async function* lines(
  stream: Readable,
  stats: { sha: ReturnType<typeof createHash>; bytes: number },
  stallMs: number,
  maxBytes: number,
) {
  let pending: Buffer[] = [];
  let pendingLength = 0;
  const iterator = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  try {
    for (;;) {
      const next = await nextChunk(iterator, stream, stallMs);
      if (next.done) break;
      const buf = next.value;
      stats.sha.update(buf);
      stats.bytes += buf.length;
      if (stats.bytes > maxBytes) throw damaged();
      let start = 0;
      for (let i = buf.indexOf(10); i !== -1; i = buf.indexOf(10, start)) {
        const piece = buf.subarray(start, i);
        if (pendingLength) {
          pending.push(piece);
          yield Buffer.concat(pending, pendingLength + piece.length);
          pending = [];
          pendingLength = 0;
        } else {
          yield piece;
        }
        start = i + 1;
      }
      if (start < buf.length) {
        pending.push(buf.subarray(start));
        pendingLength += buf.length - start;
        if (pendingLength > MAX_LINE_BYTES) throw damaged();
      }
    }
  } finally {
    // Leitura interrompida (erro, tempo esgotado): fecha a entrada.
    if (!stream.destroyed) stream.destroy();
  }
  if (pendingLength) yield Buffer.concat(pending, pendingLength);
}

async function nearestExisting(dir: string): Promise<string> {
  let current = path.resolve(dir);
  for (;;) {
    if (await stat(current).catch(() => null)) return current;
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

/**
 * Índice dos arquivos do backup. Um arquivo endereçado por hash cujo conteúdo
 * não confere com o próprio nome já estava estragado no Mac de origem (backups
 * de antes desta conferência o levavam assim): fica de fora (`skipped`), o
 * resto do backup é restaurado.
 */
async function readStorageIndex(archive: BackupArchive): Promise<{ lines: StorageIndexLine[]; skipped: number }> {
  const { index } = archive.manifest.storage;
  const buf = await archive.readEntry(index.file, MAX_INDEX_BYTES);
  if (buf.length !== index.bytes || createHash("sha256").update(buf).digest("hex") !== index.sha256) throw damaged();
  const out: StorageIndexLine[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of buf.toString("utf8").split("\n")) {
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw damaged();
    }
    const line = StorageIndexLineSchema.safeParse(parsed);
    if (!line.success || !isBackupStorageKey(line.data.key) || seen.has(line.data.key)) throw damaged();
    seen.add(line.data.key);
    const promised = shaFromStorageKey(line.data.key);
    if (promised && promised !== line.data.sha256) {
      skipped++;
      continue;
    }
    out.push(line.data);
  }
  return { lines: out, skipped };
}

/** Caminho de uma chave dentro do storage (nunca fora dele). */
function storageTarget(root: string, key: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, ...key.split("/"));
  if (!target.startsWith(`${base}${path.sep}`)) throw damaged();
  return target;
}

/** Erro ao copiar uma entrada para a pasta temporária: escrita (espaço) ou leitura do backup. */
function stageError(err: unknown, target: string): unknown {
  if (err instanceof UserError) return err;
  const e = err as NodeJS.ErrnoException;
  if (e?.code === "ENOSPC") return new UserError(RESTORE_NO_SPACE_MESSAGE);
  // Problema ao gravar aqui (não no arquivo de backup): erro inesperado, não "danificado".
  if (e?.path === target || e?.path === path.dirname(target)) return err;
  return backupReadError(err);
}

async function fileSha256(full: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(full)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function readSecrets(archive: BackupArchive): Promise<string> {
  const buf = await archive.readEntry(SECRETS_ENTRY, 64 * 1024);
  if (createHash("sha256").update(buf).digest("hex") !== archive.manifest.secrets.sha256) throw damaged();
  let parsed: unknown;
  try {
    parsed = JSON.parse(buf.toString("utf8"));
  } catch {
    throw damaged();
  }
  const secrets = SecretsSchema.safeParse(parsed);
  if (!secrets.success || Buffer.from(secrets.data.APP_ENCRYPTION_KEY, "base64").length !== 32) throw damaged();
  if (keyFingerprint(secrets.data.APP_ENCRYPTION_KEY) !== archive.manifest.encryption.keyFingerprint) throw damaged();
  return secrets.data.APP_ENCRYPTION_KEY;
}

/**
 * Copia uma entrada para um arquivo, conferindo tamanho e SHA-256. Nunca grava
 * mais que o tamanho prometido no índice (um arquivo forjado não enche o disco).
 */
async function stageEntry(archive: BackupArchive, line: StorageIndexLine, target: string, onChunk: () => void) {
  await mkdir(path.dirname(target), { recursive: true });
  const sha = createHash("sha256");
  let bytes = 0;
  const hasher = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > line.bytes) {
        cb(damaged());
        return;
      }
      sha.update(chunk);
      onChunk();
      cb(null, chunk);
    },
  });
  try {
    const stream = await archive.openEntry(`${STORAGE_DIR}${line.key}`);
    await pipeline(stream, hasher, createWriteStream(target));
  } catch (err) {
    throw stageError(err, target);
  }
  if (bytes !== line.bytes || sha.digest("hex") !== line.sha256) throw damaged();
}

/**
 * Coloca um arquivo conferido no storage. Se já existir, fica o que estava —
 * menos quando `replace` (arquivo endereçado por hash estragado aqui): aí é
 * trocado de uma vez (rename por cima), sem nunca ficar pela metade.
 */
async function placeFile(staged: string, target: string, replace = false) {
  if (!replace && (await stat(target).catch(() => null))) return false;
  await mkdir(path.dirname(target), { recursive: true });
  if (replace) {
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      await rename(staged, tmp);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
      await copyFile(staged, tmp);
    }
    await rename(tmp, target);
    return true;
  }
  try {
    await rename(staged, target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    const tmp = `${target}.${randomUUID()}.tmp`;
    await copyFile(staged, tmp);
    await rename(tmp, target);
  }
  return true;
}

interface TablePlan {
  name: string;
  file: string;
  rows: number;
  bytes: number;
  sha256: string;
  meta: TableMeta;
  columns: string[];
  selfColumns: string[];
}

function planTables(manifest: BackupManifest, schema: SchemaMeta, archive: BackupArchive): TablePlan[] {
  const current = new Set(backupTableNames(schema));
  const plans = new Map<string, TablePlan>();
  for (const entry of manifest.tables) {
    if (!archive.entries.has(entry.file) || !entry.file.startsWith("db/")) throw damaged();
    const meta = schema.get(entry.name);
    // Tabela que não existe mais nesta versão: fica de fora.
    if (!meta || !current.has(entry.name)) continue;
    const present = new Set(entry.columns);
    const missingRequired = meta.columns.filter((c) => !present.has(c.name) && !c.nullable && !c.hasDefault);
    if (missingRequired.length) throw new UserError(OLD_INCOMPATIBLE_MESSAGE);
    const columns = meta.columns.map((c) => c.name).filter((c) => present.has(c));
    plans.set(entry.name, {
      name: entry.name,
      file: entry.file,
      rows: entry.rows,
      bytes: entry.bytes,
      sha256: entry.sha256,
      meta,
      columns,
      selfColumns: selfReferenceColumns(meta).filter((c) => present.has(c)),
    });
  }
  return dependencyOrder([...plans.keys()], schema).map((name) => plans.get(name) as TablePlan);
}

/** Restaura um backup. Lança UserError em pt-BR; antes do passo 3 nada foi alterado. */
export async function restoreBackup(opts: RestoreOptions): Promise<RestoreResult> {
  const storageRoot = opts.storageRoot ?? defaultStorageRoot();
  const tmpRoot = opts.tmpRoot ?? path.join(/*turbopackIgnore: true*/ env.dataDir, "tmp");
  const databaseUrl = opts.databaseUrl ?? env.DATABASE_URL;
  const currentKey = opts.encryptionKey ?? env.APP_ENCRYPTION_KEY;
  const timeouts: RestoreTimeouts = { ...DEFAULT_RESTORE_TIMEOUTS, ...opts.timeouts };

  // Vigia da parte antes do banco: sem nenhum andamento por `stepMs`, desiste
  // (o que ainda estiver rodando por trás para antes de mexer em qualquer coisa).
  let lastProgressAt = Date.now();
  let aborted = false;
  const poke = () => {
    lastProgressAt = Date.now();
  };
  let watchdog: NodeJS.Timeout | null = null;
  const stopWatchdog = () => {
    if (watchdog) clearInterval(watchdog);
    watchdog = null;
  };
  const stuck = new Promise<never>((_, reject) => {
    if (!(timeouts.stepMs > 0)) return;
    watchdog = setInterval(
      () => {
        if (Date.now() - lastProgressAt <= timeouts.stepMs) return;
        stopWatchdog();
        aborted = true;
        reject(new UserError(TIMEOUT_MESSAGE));
      },
      Math.min(5_000, Math.max(25, Math.floor(timeouts.stepMs / 4))),
    );
  });
  stuck.catch(() => undefined);
  const checkAborted = () => {
    if (aborted) throw new UserError(TIMEOUT_MESSAGE);
  };

  const report = (progress: number, step: string) => {
    poke();
    try {
      const r = opts.onProgress?.(Math.max(0, Math.min(99, Math.round(progress))), step);
      if (r instanceof Promise) r.catch(() => undefined);
    } catch {
      // andamento nunca derruba a restauração
    }
  };
  const warnings: string[] = [];
  report(1, RESTORE_STEP.checking);

  // Pasta temporária com o id do pedido: o worker reconhece e apaga sobras de uma restauração interrompida.
  const staging = path.join(tmpRoot, `restore-${opts.restoreId ?? randomUUID()}`);
  let archive: BackupArchive | null = null;

  // Passos 1 a 3: conferência, backup de segurança e arquivos (nada no banco ainda).
  const prepare = async () => {
    const opened = await openBackup(opts.filePath, { stallMs: timeouts.readStallMs });
    archive = opened;
    checkAborted();
    const { manifest } = opened;
    if (opts.expectedManifestSha256 && opened.manifestSha256 !== opts.expectedManifestSha256) {
      throw new UserError(CHANGED_SINCE_CONFIRM_MESSAGE);
    }

    // Versão e estrutura do banco atual.
    const probe = restoreClient(databaseUrl, timeouts);
    let schema: SchemaMeta;
    let migrations: string[];
    try {
      await probe.connect();
      schema = await loadSchema(probe);
      migrations = await appliedMigrations(probe);
    } catch (err) {
      throw databaseError(err, "probe") ?? err;
    } finally {
      await closeClient(probe);
    }
    const problem = compatibilityProblem(manifest, { appVersion: appVersion(), migrations });
    if (problem) throw new UserError(problem);
    const plans = planTables(manifest, schema, opened);
    // O tamanho de cada entrada tem que ser o prometido (o leitor do ZIP nunca
    // entrega mais que isso): um arquivo forjado não enche o disco nem a memória.
    for (const plan of plans) {
      if (opened.entries.get(plan.file)?.uncompressedSize !== plan.bytes) throw damaged();
    }
    const backupKey = await readSecrets(opened);
    const { lines: index, skipped } = await readStorageIndex(opened);
    if (index.length + skipped !== manifest.storage.files) throw damaged();
    for (const line of index) {
      if (opened.entries.get(`${STORAGE_DIR}${line.key}`)?.uncompressedSize !== line.bytes) throw damaged();
    }
    if (skipped) {
      warnings.push(
        skipped === 1
          ? "1 arquivo já estava estragado no Mac de origem quando o backup foi feito e ficou de fora."
          : `${skipped} arquivos já estavam estragados no Mac de origem quando o backup foi feito e ficaram de fora.`,
      );
    }

    // Arquivos que faltam aqui. Os que já existem ficam como estão, menos os
    // endereçados por hash estragados aqui (tamanho ou conteúdo que não confere):
    // esses são consertados com a cópia do backup.
    const toCopy: { line: StorageIndexLine; repair: boolean }[] = [];
    const sameSize: StorageIndexLine[] = [];
    for (const line of index) {
      const info = await stat(storageTarget(storageRoot, line.key)).catch(() => null);
      if (!info) toCopy.push({ line, repair: false });
      else if (line.key.startsWith("a/") && info.isFile()) {
        if (info.size !== line.bytes) toCopy.push({ line, repair: true });
        else sameSize.push(line);
      }
    }
    if (sameSize.reduce((sum, l) => sum + l.bytes, 0) <= REPAIR_HASH_LIMIT) {
      for (const line of sameSize) {
        const sha = await fileSha256(storageTarget(storageRoot, line.key)).catch(() => null);
        if (sha !== null && sha !== line.sha256) toCopy.push({ line, repair: true });
        poke();
      }
    }
    checkAborted();
    const copyBytes = toCopy.reduce((sum, c) => sum + c.line.bytes, 0);
    const dbBytes = plans.reduce((sum, p) => sum + p.bytes, 0);
    const needed = copyBytes * 2 + dbBytes * 2 + 64 * MB;
    const free = await (
      opts.freeBytes ??
      (async (dir) => {
        const info = await statfs(dir);
        return Number(info.bavail) * Number(info.bsize);
      })
    )(await nearestExisting(storageRoot));
    if (free < needed) throw new UserError(noSpaceMessage(needed, free, "neste Mac para restaurar o backup"));

    // 1. Conferência: tabelas (SHA-256 e número de linhas) e arquivos que vão ser copiados.
    const checkTotal = dbBytes + copyBytes || 1;
    let checked = 0;
    for (const plan of plans) {
      const stats = { sha: createHash("sha256"), bytes: 0 };
      let rows = 0;
      try {
        for await (const _line of lines(await opened.openEntry(plan.file), stats, timeouts.readStallMs, plan.bytes)) {
          rows++;
          if (rows % 1000 === 0) poke();
        }
      } catch (err) {
        throw backupReadError(err);
      }
      if (rows !== plan.rows || stats.bytes !== plan.bytes || stats.sha.digest("hex") !== plan.sha256) throw damaged();
      checked += plan.bytes;
      report(1 + (24 * checked) / checkTotal, RESTORE_STEP.checking);
    }
    for (const { line } of toCopy) {
      checkAborted();
      await stageEntry(opened, line, path.join(staging, ...line.key.split("/")), poke);
      checked += line.bytes;
      report(1 + (24 * checked) / checkTotal, RESTORE_STEP.checking);
    }

    // 2. Backup de segurança do estado atual.
    checkAborted();
    let safetyPath: string | null = null;
    if (opts.safetyBackup) {
      report(25, RESTORE_STEP.safety);
      safetyPath = await opts.safetyBackup((fraction) => report(25 + 25 * fraction, RESTORE_STEP.safety));
    }

    // 3. Arquivos.
    report(50, RESTORE_STEP.files);
    let filesCopied = 0;
    let filesRepaired = 0;
    let moved = 0;
    for (const { line, repair } of toCopy) {
      checkAborted();
      const placed = await placeFile(
        path.join(staging, ...line.key.split("/")),
        storageTarget(storageRoot, line.key),
        repair,
      );
      if (placed && repair) filesRepaired++;
      else if (placed) filesCopied++;
      moved++;
      report(50 + (20 * moved) / (toCopy.length || 1), RESTORE_STEP.files);
    }
    if (filesRepaired) {
      warnings.push(
        filesRepaired === 1
          ? "1 arquivo estragado neste Mac foi consertado com a cópia do backup."
          : `${filesRepaired} arquivos estragados neste Mac foram consertados com a cópia do backup.`,
      );
    }
    checkAborted();
    return { opened, plans, schema, backupKey, safetyPath, filesCopied, filesRepaired };
  };

  const preparing = prepare();
  preparing.catch(() => undefined);
  try {
    const ready = await Promise.race([preparing, stuck]);
    stopWatchdog();
    const { manifest } = ready.opened;

    // 4. Banco, numa transação só (com os próprios limites de tempo).
    report(70, RESTORE_STEP.database);
    const result = await restoreDatabase({
      archive: ready.opened,
      plans: ready.plans,
      schema: ready.schema,
      databaseUrl,
      backupKey: ready.backupKey,
      currentKey,
      restoreId: opts.restoreId,
      safetyPath: ready.safetyPath,
      timeouts,
      onProgress: (fraction) => report(70 + 29 * fraction, RESTORE_STEP.database),
    });
    if (manifest.storage.missing.length) {
      warnings.push(
        `${manifest.storage.missing.length} arquivo(s) não estavam no backup (faltavam ou estavam estragados no Mac de origem).`,
      );
    }
    return {
      manifest,
      safetyPath: ready.safetyPath,
      tables: result.tables,
      filesCopied: ready.filesCopied,
      filesRepaired: ready.filesRepaired,
      reencrypted: result.reencrypted,
      warnings,
    };
  } finally {
    stopWatchdog();
    (archive as BackupArchive | null)?.close();
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

interface DatabaseRestoreInput {
  archive: BackupArchive;
  plans: TablePlan[];
  schema: SchemaMeta;
  databaseUrl: string;
  backupKey: string;
  currentKey: string;
  restoreId?: string;
  safetyPath: string | null;
  timeouts: RestoreTimeouts;
  onProgress: (fraction: number) => void;
}

/** Cliente do banco da restauração: nenhum comando espera para sempre. */
function restoreClient(databaseUrl: string, timeouts: RestoreTimeouts): pg.Client {
  const client = new pg.Client({
    connectionString: databaseUrl,
    application_name: "offer-studio-restore",
    connectionTimeoutMillis: 15_000,
    statement_timeout: timeouts.statementMs,
    lock_timeout: timeouts.lockWaitMs,
    idle_in_transaction_session_timeout: timeouts.idleMs,
    // Rede de segurança do lado do app: o banco não respondeu nem com o limite dele.
    query_timeout: timeouts.statementMs + 15_000,
  });
  // Conexão que cai fora de um comando (banco reiniciado…): o próximo comando falha; o worker não cai.
  client.on("error", (err) => console.error("[restore] conexão com o banco:", err.message));
  return client;
}

/** Conexões derrubadas à força (não adianta esperar o "end" delas). */
const destroyed = new WeakSet<pg.Client>();

/** Fecha a conexão sem esperar para sempre (conexão travada é derrubada; o banco desfaz a transação). */
async function closeClient(client: pg.Client) {
  if (destroyed.has(client)) return;
  const ended = await Promise.race([
    client.end().then(
      () => true,
      () => true,
    ),
    sleep(5_000).then(() => false),
  ]);
  if (!ended) destroyConnection(client);
}

function destroyConnection(client: pg.Client) {
  destroyed.add(client);
  try {
    (client as unknown as { connection?: { stream?: { destroy(): void } } }).connection?.stream?.destroy();
  } catch {
    // já fechada
  }
}

/** Erros de conexão/tempo do banco (o comando não terminou): a transação não foi gravada. */
function isStuckError(err: unknown): boolean {
  const code = (err as { code?: string }).code ?? "";
  const message = err instanceof Error ? err.message : "";
  return (
    code === "57014" || // statement_timeout
    code === "25P03" || // idle_in_transaction_session_timeout
    code.startsWith("57P") || // banco desligado/reiniciado
    code.startsWith("08") || // conexão
    /Query read timeout|Connection terminated|timeout expired|ECONNRESET|ECONNREFUSED|EPIPE/i.test(message)
  );
}

/**
 * Traduz erros do banco que significam "ocupado" ou "travou" para pt-BR.
 * Na fase "lock" (trancando as tabelas) qualquer espera esgotada é "ocupado".
 */
function databaseError(err: unknown, phase: "probe" | "lock" | "data"): UserError | null {
  if (err instanceof UserError) return err;
  const code = (err as { code?: string }).code;
  if (code === "55P03" || code === "40P01") return new UserError(BUSY_MESSAGE);
  // Disco do banco cheio.
  if (code === "53100") return new UserError(RESTORE_NO_SPACE_MESSAGE);
  if (phase === "lock" && code === "57014") return new UserError(BUSY_MESSAGE);
  if (isStuckError(err)) {
    console.error(`[restore] banco não respondeu (${phase}):`, err);
    return new UserError(TIMEOUT_MESSAGE);
  }
  return null;
}

/** Troca a criptografia de um token (chave do backup → chave deste Mac). Ilegível: fica como está. */
function reencryptToken(value: string, backupKey: string, currentKey: string): string | null {
  try {
    return encryptSecret(decryptSecret(value, backupKey), currentKey);
  } catch {
    return null;
  }
}

async function restoreDatabase(input: DatabaseRestoreInput) {
  const { archive, plans, schema } = input;
  const localKeys = new Set<string>(LOCAL_SETTING_KEYS);
  const reencrypt = keyFingerprint(input.backupKey) !== keyFingerprint(input.currentKey);
  let reencrypted = 0;
  const totalBytes = plans.reduce((sum, p) => sum + p.bytes, 0) || 1;
  let doneBytes = 0;

  const { timeouts } = input;
  const client = restoreClient(input.databaseUrl, timeouts);
  let phase: "lock" | "data" = "lock";
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query("begin");
    // Tabelas do app (exceto as configurações deste Mac) e as passageiras (sessões de login…).
    const appTables = backupTableNames(schema).filter((t) => t !== "AppSetting");
    const transient = TRANSIENT_TABLES.filter((t) => schema.has(t));
    const truncate = [...appTables, ...transient];
    // Tranca tudo de uma vez, com tempo total limitado: se outra tarefa estiver usando
    // o banco, desiste ("ocupado") em vez de ficar esperando (e travando o app inteiro).
    if (truncate.length) {
      await client.query(`set local statement_timeout = ${Math.max(1, Math.round(timeouts.lockWaitMs))}`);
      await client.query(`lock table ${truncate.map(ident).join(", ")} in access exclusive mode`);
      await client.query(`set local statement_timeout = ${Math.max(1, Math.round(timeouts.statementMs))}`);
    }
    phase = "data";
    if (truncate.length) await client.query(`truncate table ${truncate.map(ident).join(", ")} restart identity`);
    if (schema.has("AppSetting")) {
      await client.query(`delete from "AppSetting" where key <> all($1::text[])`, [[...localKeys]]);
    }

    const tables: { name: string; rows: number }[] = [];
    for (const plan of plans) {
      const table = ident(plan.name);
      const cols = plan.columns;
      if (!cols.length) continue;
      const selfCols = plan.selfColumns;
      const pk = plan.meta.primaryKey;
      const insertSql = `insert into ${table} (${cols.map(ident).join(", ")}) select ${cols
        .map((c) => (selfCols.includes(c) ? `null as ${ident(c)}` : `v.${ident(c)}`))
        .join(", ")} from json_populate_recordset(null::${table}, $1::json) v`;
      const updateSql =
        selfCols.length && pk.length
          ? `update ${table} as t set ${selfCols.map((c) => `${ident(c)} = v.${ident(c)}`).join(", ")} from json_populate_recordset(null::${table}, $1::json) v where ${pk.map((c) => `t.${ident(c)} = v.${ident(c)}`).join(" and ")}`
          : null;

      let batch: string[] = [];
      let batchBytes = 0;
      const selfLinks: string[] = [];
      const flush = async () => {
        if (!batch.length) return;
        await client.query(insertSql, [`[${batch.join(",")}]`]);
        batch = [];
        batchBytes = 0;
      };

      const stats = { sha: createHash("sha256"), bytes: 0 };
      let rows = 0;
      let reported = 0;
      for await (const raw of lines(await archive.openEntry(plan.file), stats, timeouts.readStallMs, plan.bytes)) {
        rows++;
        let text = raw.toString("utf8");
        if (plan.name === "AppSetting" || plan.name === "PixelConfig" || selfCols.length) {
          let row: Record<string, unknown>;
          try {
            row = JSON.parse(text) as Record<string, unknown>;
          } catch {
            throw damaged();
          }
          if (plan.name === "AppSetting" && typeof row.key === "string" && localKeys.has(row.key)) continue;
          if (plan.name === "PixelConfig" && reencrypt && typeof row.accessTokenEnc === "string") {
            const next = reencryptToken(row.accessTokenEnc, input.backupKey, input.currentKey);
            if (next) {
              row.accessTokenEnc = next;
              text = JSON.stringify(row);
              reencrypted++;
            }
          }
          if (updateSql && selfCols.some((c) => row[c] !== null && row[c] !== undefined)) {
            const link: Record<string, unknown> = {};
            for (const c of [...pk, ...selfCols]) link[c] = row[c];
            selfLinks.push(JSON.stringify(link));
          }
        }
        batch.push(text);
        batchBytes += text.length;
        if (batchBytes >= BATCH_BYTES || batch.length >= BATCH_ROWS) await flush();
        if (stats.bytes - reported > MB) {
          reported = stats.bytes;
          input.onProgress((doneBytes + stats.bytes) / totalBytes);
        }
      }
      await flush();
      if (rows !== plan.rows || stats.bytes !== plan.bytes || stats.sha.digest("hex") !== plan.sha256) throw damaged();
      if (updateSql) {
        for (let i = 0; i < selfLinks.length; i += BATCH_ROWS) {
          await client.query(updateSql, [`[${selfLinks.slice(i, i + BATCH_ROWS).join(",")}]`]);
        }
      }
      doneBytes += plan.bytes;
      input.onProgress(doneBytes / totalBytes);
      tables.push({ name: plan.name, rows });
    }

    // Próximo número das colunas autoincremento (logs).
    for (const plan of plans) {
      for (const col of plan.meta.serialColumns) {
        await client.query(
          `select setval(pg_get_serial_sequence($1, $2), coalesce((select max(${ident(col)}) from ${ident(plan.name)}), 0) + 1, false)`,
          [ident(plan.name), col],
        );
      }
    }

    if (input.restoreId) {
      await client.query(
        `update "BackupRestore" set status = 'DONE', progress = 100, step = $2, "safetyPath" = $3,
                "errorMessage" = null, "finishedAt" = now() where id = $1`,
        [input.restoreId, RESTORE_STEP.done, input.safetyPath],
      );
    }
    await client.query("commit");
    return { tables, reencrypted };
  } catch (err) {
    if (connected) {
      if (isStuckError(err)) {
        // Conexão travada: derrubar faz o banco desfazer a transação sozinho.
        destroyConnection(client);
      } else {
        await Promise.race([client.query("rollback").catch(() => destroyConnection(client)), sleep(10_000)]);
      }
    }
    const translated = databaseError(err, phase);
    if (translated) throw translated;
    const code = (err as { code?: string }).code;
    // Erro do sistema ao ler o arquivo de backup (disco desconectado…): não é dado incompatível.
    if (code && /^E[A-Z0-9]+$/.test(code)) throw backupReadError(err);
    // Dado que não entra nesta versão (coluna obrigatória, valor de lista que não existe mais…).
    if (code && /^(22|23|42)/.test(code)) {
      console.error("[restore] dado incompatível:", err);
      throw new UserError(OLD_INCOMPATIBLE_MESSAGE);
    }
    throw err;
  } finally {
    await closeClient(client);
  }
}

export { formatBytes };
