/**
 * Criação do arquivo de backup (roda no worker).
 *
 * 1. Lê todas as tabelas do app numa única fotografia do banco (transação
 *    REPEATABLE READ, só leitura), em fluxo: um cursor por tabela, linhas de
 *    row_to_json direto para o ZIP (nada inteiro na memória).
 * 2. Descobre os arquivos usados (./refs.ts) e confere o espaço livre.
 * 3. Copia os arquivos para o ZIP, calculando o SHA-256 de cada um.
 * 4. Grava índice, segredos e manifest, confere o ZIP e só então dá o nome
 *    final (temporário oculto na mesma pasta + link/rename: nunca fica um
 *    backup pela metade com o nome de um backup).
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, link, rename, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { PassThrough, Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { ZipFile } from "yazl";
import { env } from "@/lib/env";
import { UserError } from "@/lib/errors";
import { isPrecompressed } from "@/lib/export/paths";
import { appVersion, computerName, defaultStorageRoot, keyFingerprint } from "./context";
import {
  BACKUP_APP,
  BACKUP_FORMAT,
  type BackupKindValue,
  type BackupManifest,
  backupFileName,
  corruptFilesWarning,
  DB_DIR,
  LOCAL_SETTING_KEYS,
  MANIFEST_ENTRY,
  ManifestSchema,
  SECRETS_ENTRY,
  STORAGE_DIR,
  STORAGE_INDEX_ENTRY,
  type StorageIndexLine,
  shaFromStorageKey,
  type TableEntry,
} from "./format";
import { openBackup } from "./reader";
import { resolveStorageFiles, StorageRefs } from "./refs";
import { ensureWritableFolder, folderErrorMessage } from "./settings";
import { appliedMigrations, backupTableNames, dependencyOrder, ident, loadSchema, type TableMeta } from "./tables";

export const BACKUP_STEP = {
  queued: "Na fila…",
  database: "Lendo ofertas, páginas e configurações…",
  files: "Copiando imagens e arquivos…",
  checking: "Conferindo o backup…",
  done: "Backup concluído",
} as const;

export interface CreateBackupOptions {
  /** Pasta de destino (criada se preciso). */
  folder: string;
  kind: BackupKindValue;
  /** Identidade desta instalação (vai no manifest). */
  installId: string;
  now?: Date;
  storageRoot?: string;
  databaseUrl?: string;
  encryptionKey?: string;
  /** Andamento (0–100) e etapa em pt-BR. */
  onProgress?: (progress: number, step: string) => unknown;
  /** Espaço livre na pasta (testes). */
  freeBytes?: (dir: string) => Promise<number>;
  /** Sem avançar nada por esse tempo (pasta ou disco que parou de responder), desiste. Padrão: BACKUP_STALL_MS. */
  stallMs?: number;
}

export interface CreatedBackup {
  filePath: string;
  fileName: string;
  bytes: number;
  manifest: BackupManifest;
  /** Avisos em pt-BR. */
  warnings: string[];
}

const MB = 1024 * 1024;
/** Lote de leitura do cursor (ajustado pelo tamanho médio das linhas). */
const FETCH_TARGET_BYTES = 8 * MB;
/** Margem de espaço livre além do tamanho estimado. */
const SPACE_MARGIN = 64 * MB;
/** Sem avançar nada por esse tempo, o backup desiste (pasta de rede ou disco externo que parou de responder). */
export const BACKUP_STALL_MS = 3 * 60_000;
export const BACKUP_STALLED_MESSAGE =
  "O backup parou de avançar: a pasta de backup ou o disco parou de responder (disco externo ou rede desconectados?). Tente de novo ou escolha outra pasta.";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A promessa termina (bem ou mal) em até `ms`? */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const settled = await Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
    }),
  ]);
  clearTimeout(timer);
  return settled;
}

// ─── Pastas que pararam de responder ─────────────────────────────────────────

/**
 * Pedidos à pasta de backup que passaram do limite de tempo e ainda não
 * voltaram, por pasta. Desistir de esperar não cancela o pedido: ele continua
 * ocupando uma das poucas linhas de trabalho de disco do Node (4, se nada mudar).
 * Enquanto houver um assim, um novo backup nessa pasta falha na hora sem tocar
 * nela — senão cada tentativa (automático de hora em hora, cliques, backup de
 * segurança antes de restaurar) prenderia mais uma, até parar todo o acesso a
 * disco do worker (clonagens, ZIPs, restauração). Quando o pedido volta (a
 * pasta respondeu, mesmo com erro), a pasta é liberada.
 */
const stalledFolders = new Map<string, Set<Promise<unknown>>>();

/** Mesmo disco externo ou de rede (/Volumes/<nome>), ou uma pasta dentro da outra. */
function sameStuckPlace(a: string, b: string): boolean {
  const inside = (child: string, parent: string) => {
    const rel = path.relative(parent, child);
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
  };
  if (inside(a, b) || inside(b, a)) return true;
  const volume = (p: string) => /^\/Volumes\/[^/]+/.exec(p)?.[0] ?? null;
  const va = volume(a);
  return va !== null && va === volume(b);
}

/** Guarda um pedido à pasta que não voltou a tempo (até ele voltar). */
export function markFolderStalled(folder: string, pending: Promise<unknown>): void {
  const key = path.resolve(folder);
  let set = stalledFolders.get(key);
  if (!set) {
    set = new Set();
    stalledFolders.set(key, set);
  }
  set.add(pending);
  const release = () => {
    const current = stalledFolders.get(key);
    if (!current) return;
    current.delete(pending);
    if (!current.size) stalledFolders.delete(key);
  };
  pending.then(release, release);
}

/** A pasta (ou outra do mesmo disco) tem um pedido que parou de responder e ainda não voltou? */
export function folderStalled(folder: string): boolean {
  const target = path.resolve(folder);
  for (const key of stalledFolders.keys()) if (sameStuckPlace(key, target)) return true;
  return false;
}

/** Falha na hora (sem tocar na pasta) se ela tem um pedido travado. */
export function assertFolderResponding(folder: string): void {
  if (folderStalled(folder)) throw new UserError(BACKUP_STALLED_MESSAGE);
}

/**
 * Espera algo da pasta de backup (criar, listar, conferir, dar nome) por no
 * máximo `ms`: uma pasta de rede ou um disco que já não responde antes de o
 * backup começar faz o pedido falhar com mensagem clara, em vez de deixar o
 * backup "Fazendo" para sempre (com uma restauração esperando atrás dele).
 * Com `folder`, o pedido que não voltou fica registrado (folderStalled) até
 * voltar. `ms` <= 0: sem limite.
 */
export function withinStall<T>(promise: Promise<T>, ms = BACKUP_STALL_MS, folder?: string): Promise<T> {
  if (!(ms > 0)) return promise;
  promise.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (folder) markFolderStalled(folder, promise);
      reject(new UserError(BACKUP_STALLED_MESSAGE));
    }, ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/** Hash e tamanho do que passa (cópia dos arquivos para o ZIP). */
class HashingStream extends Transform {
  private readonly hash = createHash("sha256");
  bytes = 0;
  sha256 = "";
  constructor(private readonly onChunk?: () => void) {
    super();
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    this.hash.update(chunk);
    this.bytes += chunk.length;
    this.onChunk?.();
    cb(null, chunk);
  }
  override _flush(cb: TransformCallback) {
    this.sha256 = this.hash.digest("hex");
    cb();
  }
}

/** Conta os bytes gravados no arquivo (andamento). */
class CountingStream extends Transform {
  bytes = 0;
  constructor(private readonly onChunk?: () => void) {
    super();
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    this.bytes += chunk.length;
    this.onChunk?.();
    cb(null, chunk);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(1).replace(".", ",")} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export async function freeBytesOf(dir: string): Promise<number> {
  const info = await statfs(dir);
  return Number(info.bavail) * Number(info.bsize);
}

/** Mensagem clara para falta de espaço. */
export function noSpaceMessage(needed: number, free: number, where: string): string {
  return `Não há espaço suficiente ${where} (precisa de cerca de ${formatBytes(needed)}, há ${formatBytes(free)} livres). Libere espaço ou escolha outra pasta.`;
}

/** Repassa o andamento sem gravar no banco a cada linha (no máximo 2× por segundo). */
function progressReporter(onProgress?: (progress: number, step: string) => unknown) {
  let lastAt = 0;
  let lastValue = -1;
  let lastStep = "";
  return (progress: number, step: string, force = false) => {
    if (!onProgress) return;
    const value = Math.max(0, Math.min(100, Math.round(progress)));
    const now = Date.now();
    if (!force && step === lastStep && (value === lastValue || now - lastAt < 500)) return;
    lastAt = now;
    lastValue = value;
    lastStep = step;
    try {
      const r = onProgress(value, step);
      if (r instanceof Promise) r.catch(() => undefined);
    } catch {
      // andamento nunca derruba o backup
    }
  };
}

/** Nome livre na pasta (nunca sobrescreve um backup). */
async function freeName(folder: string, now: Date, installId: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const name = backupFileName(now, n, installId);
    if (!(await stat(path.join(folder, name)).catch(() => null))) return name;
  }
  throw new UserError("Há backups demais com o mesmo horário nesta pasta. Tente de novo em um minuto.");
}

/** Dá o nome final sem nunca sobrescrever outro arquivo. Devolve o nome usado. */
async function publish(tmp: string, folder: string, now: Date, wanted: string, installId: string): Promise<string> {
  let name = wanted;
  for (let attempt = 0; attempt < 50; attempt++) {
    const target = path.join(folder, name);
    try {
      await link(tmp, target);
      await rm(tmp, { force: true });
      return name;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        name = await freeName(folder, now, installId);
        continue;
      }
      // Disco sem links (ex.: exFAT): confere e renomeia.
      if (await stat(target).catch(() => null)) {
        name = await freeName(folder, now, installId);
        continue;
      }
      await rename(tmp, target);
      return name;
    }
  }
  throw new UserError("Não foi possível dar nome ao backup. Tente de novo.");
}

function waitDrain(stream: PassThrough, failed: Promise<never>): Promise<void> {
  if (!stream.writableNeedDrain) return Promise.resolve();
  return Promise.race([new Promise<void>((resolve) => stream.once("drain", resolve)), failed]);
}

function sqlList(values: readonly string[]): string {
  return values.map((v) => `'${v.replaceAll("'", "''")}'`).join(", ");
}

/** Filtro de linhas que não vão para o backup (configurações deste Mac). */
function rowFilter(table: string): string {
  return table === "AppSetting" ? ` where t.key not in (${sqlList(LOCAL_SETTING_KEYS)})` : "";
}

interface DumpContext {
  zip: ZipFile;
  db: pg.Client;
  refs: StorageRefs;
  mtime: Date;
  failed: Promise<never>;
  onRow: () => void;
  /** Sinal de que o backup está andando (vigia de travamento). */
  poke: () => void;
}

/** Copia uma tabela para db/<tabela>.jsonl e coleta as referências a arquivos. */
async function dumpTable(meta: TableMeta, ctx: DumpContext): Promise<TableEntry> {
  const file = `${DB_DIR}${meta.name}.jsonl`;
  const pass = new PassThrough();
  ctx.zip.addReadStreamLazy(file, { mtime: ctx.mtime, mode: 0o100644, compress: true }, (cb) => cb(null, pass));
  const hash = createHash("sha256");
  let bytes = 0;
  let rows = 0;

  const byteaColumns = meta.columns.filter((c) => c.type === "bytea").map((c) => c.name);
  const isVersions = meta.name === "PageVersion";
  const isClones = meta.name === "CloneJob";
  const order = (meta.primaryKey.length ? meta.primaryKey : meta.columns.map((c) => c.name)).map(ident).join(", ");
  const cursor = `os_backup_${rows}_${Math.random().toString(36).slice(2, 8)}`;
  await ctx.db.query(
    `declare ${cursor} no scroll cursor for select row_to_json(t)::text as j from ${ident(meta.name)} t${rowFilter(meta.name)} order by ${order}`,
  );
  let batch = 200;
  try {
    for (;;) {
      ctx.poke();
      const res = await ctx.db.query<{ j: string }>(`fetch ${batch} from ${cursor}`);
      ctx.poke();
      if (!res.rows.length) break;
      let batchBytes = 0;
      for (const { j } of res.rows) {
        const line = `${j}\n`;
        const buf = Buffer.from(line, "utf8");
        hash.update(buf);
        bytes += buf.length;
        batchBytes += buf.length;
        rows++;
        ctx.refs.addText(j);
        if (byteaColumns.length || isVersions || isClones) {
          const row = JSON.parse(j) as Record<string, unknown>;
          for (const col of byteaColumns) {
            const value = row[col];
            if (typeof value === "string" && value.startsWith("\\x")) {
              ctx.refs.addMaybeGzip(Buffer.from(value.slice(2), "hex"));
            }
          }
          if (isVersions && typeof row.storageKey === "string") ctx.refs.versionKeys.add(row.storageKey);
          if (isClones && row.status === "REVIEW" && typeof row.id === "string") ctx.refs.cloneJobs.add(row.id);
        }
        if (!pass.write(buf)) await waitDrain(pass, ctx.failed);
        ctx.onRow();
      }
      const avg = batchBytes / res.rows.length || 1;
      batch = Math.max(1, Math.min(1000, Math.floor(FETCH_TARGET_BYTES / avg)));
    }
  } finally {
    await ctx.db.query(`close ${cursor}`).catch(() => undefined);
    pass.end();
  }
  return {
    name: meta.name,
    file,
    rows,
    columns: meta.columns.map((c) => c.name),
    bytes,
    sha256: hash.digest("hex"),
  };
}

/** Faz o backup completo na pasta. Lança UserError (pt-BR) se não der. */
export async function createBackupArchive(opts: CreateBackupOptions): Promise<CreatedBackup> {
  const now = opts.now ?? new Date();
  const storageRoot = opts.storageRoot ?? defaultStorageRoot();
  const encryptionKey = opts.encryptionKey ?? env.APP_ENCRYPTION_KEY;
  const report = progressReporter(opts.onProgress);
  const folder = path.resolve(opts.folder);
  const warnings: string[] = [];

  // Vigia: nada andou (nenhum byte gravado, nenhuma linha ou arquivo lido) por
  // `stallMs` → a pasta ou o disco parou de responder: desiste em vez de travar
  // a fila (e uma restauração esperando atrás dele). Vale desde o primeiro
  // acesso à pasta (uma pasta de rede pode já estar travada antes de começar).
  const stallMs = opts.stallMs ?? BACKUP_STALL_MS;
  // Um pedido anterior a esta pasta ainda não voltou: não prende mais um.
  assertFolderResponding(folder);
  await withinStall(ensureWritableFolder(folder), stallMs, folder);
  const wantedName = await withinStall(freeName(folder, now, opts.installId), stallMs, folder);
  const tmp = path.join(folder, `.${wantedName}.${randomUUID().slice(0, 8)}.tmp`);

  let lastProgressAt = Date.now();
  const poke = () => {
    lastProgressAt = Date.now();
  };
  let rejectStalled: (err: Error) => void = () => undefined;
  const stalled = new Promise<never>((_, reject) => {
    rejectStalled = reject;
  });
  stalled.catch(() => undefined);
  /** Espera algo que pode travar (disco) sem passar do vigia. */
  const guarded = <T>(promise: Promise<T>) => Promise.race([promise, stalled]);

  const zip = new ZipFile();
  const output = zip.outputStream as unknown as Readable;
  const counter = new CountingStream(poke);
  // Só o dono lê o backup (ele leva a chave que abre os tokens dos pixels).
  const writing = pipeline(output, counter, createWriteStream(tmp, { mode: 0o600 }));
  // Falha na gravação (disco cheio…) ou travamento interrompe quem espera o ZIP consumir dados.
  const failed = Promise.race([
    writing.then(
      () => new Promise<never>(() => undefined),
      (err) => Promise.reject(err),
    ),
    stalled,
  ]);
  failed.catch(() => undefined);
  writing.catch(() => undefined);
  const abort = (err: unknown) => {
    output.destroy(err instanceof Error ? err : new Error(String(err)));
  };
  zip.on("error", abort);
  const watchdog =
    stallMs > 0
      ? setInterval(
          () => {
            if (Date.now() - lastProgressAt <= stallMs) return;
            clearInterval(watchdog as NodeJS.Timeout);
            const err = new UserError(BACKUP_STALLED_MESSAGE);
            rejectStalled(err);
            abort(err);
          },
          Math.min(5_000, Math.max(25, Math.floor(stallMs / 4))),
        )
      : null;

  const db = new pg.Client({
    connectionString: opts.databaseUrl ?? env.DATABASE_URL,
    application_name: "offer-studio-backup",
    connectionTimeoutMillis: 15_000,
    // Só lê: nunca fica esperando uma tranca para sempre (uma restauração, por exemplo).
    lock_timeout: 60_000,
    // Nenhum comando nem pausa no meio da fotografia do banco dura para sempre.
    statement_timeout: 5 * 60_000,
    idle_in_transaction_session_timeout: Math.max(stallMs, 60_000) + 60_000,
    query_timeout: 5 * 60_000 + 15_000,
  });
  // Conexão que cai fora de um comando: o próximo comando falha; o worker não cai.
  db.on("error", (err) => console.error("[backup] conexão com o banco:", err.message));
  let dbOpen = false;
  try {
    report(1, BACKUP_STEP.database, true);
    await db.connect();
    dbOpen = true;
    await db.query("begin isolation level repeatable read read only");
    const schema = await loadSchema(db);
    const migrations = await appliedMigrations(db);
    const names = dependencyOrder(backupTableNames(schema), schema);

    // Contagens (andamento) e resumo, na mesma fotografia do banco.
    let totalRows = 0;
    for (const name of names) {
      const r = await db.query<{ n: string }>(`select count(*)::text as n from ${ident(name)}`);
      totalRows += Number(r.rows[0]?.n ?? 0);
      poke();
    }
    const summaryRow = await db.query<{ offers: number; trashed: number; pages: number }>(
      `select (select count(*) from "Offer" where "deletedAt" is null)::int as offers,
              (select count(*) from "Offer" where "deletedAt" is not null)::int as trashed,
              (select count(*) from "Page" p join "Offer" o on o.id = p."offerId" where o."deletedAt" is null)::int as pages`,
    );
    const accountRow = await db.query<{ email: string; name: string }>(
      `select email, name from "user" order by "createdAt" asc limit 1`,
    );

    const refs = new StorageRefs();
    const tables: TableEntry[] = [];
    let doneRows = 0;
    const ctx: DumpContext = {
      zip,
      db,
      refs,
      mtime: now,
      failed,
      poke,
      onRow: () => {
        poke();
        doneRows++;
        if (doneRows % 50 === 0) report(1 + (29 * doneRows) / Math.max(1, totalRows), BACKUP_STEP.database);
      },
    };
    for (const name of names) tables.push(await dumpTable(schema.get(name) as TableMeta, ctx));
    await db.query("commit");
    await guarded(db.end());
    dbOpen = false;
    report(30, BACKUP_STEP.files, true);

    // Arquivos usados pelas ofertas.
    const { files, missing } = await guarded(resolveStorageFiles(refs, storageRoot));
    poke();
    const storageBytes = files.reduce((sum, f) => sum + f.bytes, 0);
    const free = await guarded((opts.freeBytes ?? freeBytesOf)(folder));
    poke();
    const needed = storageBytes + SPACE_MARGIN;
    if (free < needed)
      throw new UserError(noSpaceMessage(needed + counter.bytes, free + counter.bytes, "na pasta de backup"));
    if (missing.length) {
      warnings.push(
        missing.length === 1
          ? "1 arquivo de versão salva não estava no disco e ficou de fora."
          : `${missing.length} arquivos de versões salvas não estavam no disco e ficaram de fora.`,
      );
    }

    const index: StorageIndexLine[] = [];
    let copied = 0;
    const lost: string[] = [];
    /** Arquivos deste Mac que não conferem com o próprio hash (estragados no disco). */
    const corrupt: string[] = [];
    for (const file of files) {
      zip.addReadStreamLazy(
        `${STORAGE_DIR}${file.key}`,
        { mtime: now, mode: 0o100644, compress: !isPrecompressed(file.key) },
        (cb) => {
          const source = createReadStream(file.full);
          let started = false;
          source.once("open", () => {
            started = true;
            const hasher: HashingStream = new HashingStream(() => {
              poke();
              report(30 + (65 * (copied + hasher.bytes)) / Math.max(1, storageBytes), BACKUP_STEP.files);
            });
            hasher.once("error", abort);
            source.pipe(hasher);
            hasher.once("end", () => {
              // Arquivo endereçado por hash que não confere com o próprio nome
              // (cortado numa queda de energia, estragado no disco): fica de fora
              // do índice — senão a restauração recusaria o backup inteiro.
              const promised = shaFromStorageKey(file.key);
              if (promised && promised !== hasher.sha256) {
                corrupt.push(file.key);
                console.warn(`[backup] arquivo estragado no disco (não confere com o hash): ${file.key}`);
              } else {
                index.push({ key: file.key, bytes: hasher.bytes, sha256: hasher.sha256 });
              }
              copied += hasher.bytes;
              report(30 + (65 * copied) / Math.max(1, storageBytes), BACKUP_STEP.files);
            });
            cb(null, hasher);
          });
          source.on("error", (err) => {
            // Sumiu do disco depois de listado (limpeza automática): entra vazio e fora do índice.
            if (!started && (err as NodeJS.ErrnoException).code === "ENOENT") {
              lost.push(file.key);
              cb(null, Readable.from([], { objectMode: false }));
              return;
            }
            // O ZIP não ouve erros das entradas: interrompe a gravação inteira.
            abort(err);
          });
        },
      );
    }

    let indexInfo = { file: STORAGE_INDEX_ENTRY, bytes: 0, sha256: "" };
    zip.addReadStreamLazy(STORAGE_INDEX_ENTRY, { mtime: now, mode: 0o100644, compress: true }, (cb) => {
      const text = index.map((line) => `${JSON.stringify(line)}\n`).join("");
      const buf = Buffer.from(text, "utf8");
      indexInfo = {
        file: STORAGE_INDEX_ENTRY,
        bytes: buf.length,
        sha256: createHash("sha256").update(buf).digest("hex"),
      };
      report(97, BACKUP_STEP.checking, true);
      cb(null, Readable.from([buf], { objectMode: false }));
    });

    const secrets = Buffer.from(`${JSON.stringify({ APP_ENCRYPTION_KEY: encryptionKey }, null, 2)}\n`, "utf8");
    zip.addBuffer(secrets, SECRETS_ENTRY, { mtime: now, mode: 0o100600, compress: true });

    let manifest: BackupManifest | null = null;
    zip.addReadStreamLazy(MANIFEST_ENTRY, { mtime: now, mode: 0o100644, compress: true }, (cb) => {
      if (lost.length) {
        warnings.push(
          lost.length === 1
            ? "1 arquivo sumiu do disco durante o backup e ficou de fora."
            : `${lost.length} arquivos sumiram do disco durante o backup e ficaram de fora.`,
        );
      }
      if (corrupt.length) warnings.push(corruptFilesWarning(corrupt.length));
      const value: BackupManifest = {
        app: BACKUP_APP,
        format: BACKUP_FORMAT,
        appVersion: appVersion(),
        createdAt: now.toISOString(),
        kind: opts.kind,
        installId: opts.installId,
        computer: computerName(),
        migrations,
        tables,
        storage: {
          files: index.length,
          bytes: index.reduce((sum, l) => sum + l.bytes, 0),
          index: indexInfo,
          missing: [...missing, ...lost, ...corrupt],
        },
        secrets: { file: SECRETS_ENTRY, sha256: createHash("sha256").update(secrets).digest("hex") },
        summary: {
          offers: summaryRow.rows[0]?.offers ?? 0,
          trashedOffers: summaryRow.rows[0]?.trashed ?? 0,
          pages: summaryRow.rows[0]?.pages ?? 0,
          account: accountRow.rows[0] ? { email: accountRow.rows[0].email, name: accountRow.rows[0].name } : null,
        },
        encryption: { keyFingerprint: keyFingerprint(encryptionKey) },
      };
      manifest = ManifestSchema.parse(value);
      cb(null, Readable.from([Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")], { objectMode: false }));
    });
    zip.end();
    await Promise.race([writing, stalled]);
    if (!manifest) throw new Error("manifest não foi gravado");
    // A conferência abaixo tem o próprio limite de tempo (leitura que parou).
    if (watchdog) clearInterval(watchdog);

    // Confere o arquivo gravado antes de dar o nome final.
    const check = await openBackup(tmp, { stallMs: stallMs > 0 ? stallMs : undefined });
    check.close();
    const expected = tables.length + index.length + lost.length + corrupt.length + 3;
    if (check.entries.size !== expected)
      throw new Error(`ZIP com ${check.entries.size} entradas, esperado ${expected}`);

    const fileName = await withinStall(publish(tmp, folder, now, wantedName, opts.installId), stallMs, folder);
    const filePath = path.join(folder, fileName);
    // Disco que ignora o modo na criação (ou o rename em vez do link): garante só o dono.
    await withinStall(chmod(filePath, 0o600), stallMs, folder).catch((err) => {
      if (err instanceof UserError) throw err;
    });
    const bytes = (await withinStall(stat(filePath), stallMs, folder)).size;
    report(100, BACKUP_STEP.done, true);
    return { filePath, fileName, bytes, manifest, warnings };
  } catch (err) {
    if (dbOpen) await Promise.race([db.end().catch(() => undefined), sleep(5_000)]);
    output.destroy();
    // Destino travado: não espera a gravação nem a remoção para sempre — e o que
    // não voltou fica registrado (o próximo backup nessa pasta falha na hora).
    const written = writing.catch(() => undefined);
    if (!(await settlesWithin(written, 5_000))) markFolderStalled(folder, written);
    const removed = rm(tmp, { force: true }).catch(() => undefined);
    if (!(await settlesWithin(removed, 5_000))) markFolderStalled(folder, removed);
    throw await toBackupError(err, folder);
  } finally {
    if (watchdog) clearInterval(watchdog);
  }
}

export const BACKUP_FAILED_MESSAGE = "Não foi possível fazer o backup. Tente de novo em alguns minutos.";

/** Erro do backup em pt-BR (disco, permissão, banco). */
export async function toBackupError(err: unknown, folder: string): Promise<UserError> {
  if (err instanceof UserError) return err;
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === "ENOSPC") {
    return new UserError("O disco da pasta de backup ficou sem espaço. Libere espaço ou escolha outra pasta.");
  }
  if (code && ["EPERM", "EACCES", "EROFS", "ENOTDIR", "ENOENT"].includes(code)) {
    return new UserError(await folderErrorMessage(err, folder));
  }
  if (code === "ECONNREFUSED" || code === "57P01") {
    return new UserError("O banco de dados não respondeu durante o backup. Tente de novo em alguns minutos.");
  }
  console.error("[backup] falhou:", err);
  return new UserError(BACKUP_FAILED_MESSAGE);
}
