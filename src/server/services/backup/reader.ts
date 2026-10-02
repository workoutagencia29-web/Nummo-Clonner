/**
 * Leitura de um arquivo de backup: abre o ZIP (índice central), lê e confere o
 * manifest e entrega as entradas em fluxo. Erros viram mensagens em pt-BR
 * (arquivo danificado, de outra versão, sem permissão, disco que não
 * respondeu…).
 *
 * Nada espera para sempre: abrir o arquivo, percorrer o índice e cada leitura
 * de entrada desistem (READ_STALLED_MESSAGE) se o disco ou a iCloud Drive
 * pararem de mandar dados por `stallMs`.
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import yauzl from "yauzl";
import { UserError } from "@/lib/errors";
import {
  BACKUP_APP,
  BACKUP_FORMAT,
  type BackupManifest,
  DAMAGED_MESSAGE,
  MANIFEST_ENTRY,
  ManifestSchema,
  NEWER_VERSION_MESSAGE,
  NOT_A_BACKUP_MESSAGE,
  READ_IO_MESSAGE,
  READ_STALLED_MESSAGE,
  RESTORE_NO_SPACE_MESSAGE,
} from "./format";

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
/** Um backup tem no máximo isso de entradas (proteção contra arquivos estranhos). */
const MAX_ENTRIES = 2_000_000;
/**
 * Só para ler o manifest (listas e conferência, no painel): limite bem menor,
 * para um arquivo estranho na pasta não ocupar o painel por muito tempo.
 */
const MAX_LIST_ENTRIES = 500_000;
/** Sem dados do disco por esse tempo, a leitura desiste (padrão). */
export const DEFAULT_READ_STALL_MS = 2 * 60_000;

export interface OpenBackupOptions {
  /**
   * "full" (padrão): guarda o índice inteiro do ZIP (restauração, conferência do
   * backup recém-gravado). "manifest": só procura o manifest, sem guardar o
   * resto (listas e a confirmação da restauração).
   */
  mode?: "full" | "manifest";
  /** Sem dados por esse tempo: desiste com READ_STALLED_MESSAGE. 0 = sem limite. */
  stallMs?: number;
}

export interface BackupArchive {
  filePath: string;
  manifest: BackupManifest;
  /** SHA-256 do manifest.json (identifica este backup: a confirmação e a restauração conferem). */
  manifestSha256: string;
  /** Quantas entradas o ZIP tem. */
  entryCount: number;
  /** Entradas do ZIP (no modo "manifest", só o manifest). */
  entries: Map<string, yauzl.Entry>;
  openEntry(name: string): Promise<Readable>;
  readEntry(name: string, maxBytes: number): Promise<Buffer>;
  close(): void;
}

/** Erros do sistema que querem dizer "o disco não respondeu" (o arquivo não está danificado). */
const IO_CODES = new Set(["EIO", "ENXIO", "ENODEV", "ENOTCONN", "ESTALE", "EHOSTDOWN", "EHOSTUNREACH", "ENETDOWN"]);

/** Mensagem em pt-BR para um erro ao abrir ou ler o arquivo de backup. */
export function backupReadErrorMessage(err: unknown): string {
  if (err instanceof UserError) return err.message;
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === "ENOENT") return "O arquivo de backup não foi encontrado. Ele pode ter sido movido ou apagado.";
  if (code === "EISDIR") return "Esse caminho é de uma pasta. Escolha o arquivo .zip do backup.";
  if (code === "EACCES" || code === "EPERM") {
    return "O macOS não deixou o Offer Studio ler esse arquivo. Abra Ajustes do Sistema → Privacidade e Segurança → Arquivos e Pastas e permita que o Terminal acesse a pasta do backup.";
  }
  if (code === "ETIMEDOUT" || code === "EDEADLK") {
    return "O arquivo ainda não foi baixado da iCloud Drive. Abra a pasta no Finder, espere o download terminar e tente de novo.";
  }
  if (code === "ENOSPC") return RESTORE_NO_SPACE_MESSAGE;
  // Outros erros do sistema (EIO de um disco desconectado, EMFILE…): problema
  // do disco, não do arquivo. Só erro de formato (ZIP, zlib, tamanho) é "danificado".
  if (code && (IO_CODES.has(code) || /^E[A-Z0-9]+$/.test(code))) return READ_IO_MESSAGE;
  return DAMAGED_MESSAGE;
}

/** O mesmo, como UserError (repassa um UserError como está). */
export function backupReadError(err: unknown): UserError {
  return err instanceof UserError ? err : new UserError(backupReadErrorMessage(err));
}

/**
 * Repassa uma entrada do ZIP e desiste se ela ficar `ms` sem mandar dados
 * enquanto alguém está esperando por eles (consumidor lento não conta).
 */
class StallGuard extends Readable {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly source: Readable,
    private readonly ms: number,
  ) {
    super();
    source.on("data", (chunk: Buffer) => {
      this.disarm();
      if (this.push(chunk)) this.arm();
      else source.pause();
    });
    source.once("end", () => {
      this.disarm();
      this.push(null);
    });
    source.once("error", (err) => {
      this.disarm();
      this.destroy(err);
    });
    source.pause();
  }

  private arm() {
    if (this.timer || this.destroyed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.destroy(new UserError(READ_STALLED_MESSAGE));
    }, this.ms);
  }

  private disarm() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  override _read() {
    this.arm();
    this.source.resume();
  }

  override _destroy(err: Error | null, cb: (err?: Error | null) => void) {
    this.disarm();
    if (!this.source.destroyed) this.source.destroy();
    cb(err);
  }
}

/** Uma entrada que desiste se parar de mandar dados (ms <= 0: sem limite). */
export function guardStall(source: Readable, ms: number): Readable {
  return ms > 0 ? new StallGuard(source, ms) : source;
}

/** Promessa com prazo: estourou → READ_STALLED_MESSAGE (o que chegar depois vai para `late`). */
function withDeadline<T>(promise: Promise<T>, ms: number, late?: (value: T) => void): Promise<T> {
  if (!(ms > 0)) return promise;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new UserError(READ_STALLED_MESSAGE));
    }, ms);
    promise.then(
      (value) => {
        if (settled) {
          late?.(value);
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function readStreamToBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        stream.destroy();
        reject(new UserError(DAMAGED_MESSAGE));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

/** Confere o JSON do manifest; versão do formato mais nova → mensagem própria. */
export function parseManifest(raw: unknown): BackupManifest {
  const obj = raw as { app?: unknown; format?: unknown } | null;
  if (!obj || typeof obj !== "object" || obj.app !== BACKUP_APP) throw new UserError(NOT_A_BACKUP_MESSAGE);
  if (typeof obj.format === "number" && obj.format > BACKUP_FORMAT) throw new UserError(NEWER_VERSION_MESSAGE);
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) throw new UserError(DAMAGED_MESSAGE);
  return parsed.data;
}

/** Abre um backup e lê o manifest. Feche com `close()` (mesmo se der erro depois). */
export async function openBackup(filePath: string, opts: OpenBackupOptions = {}): Promise<BackupArchive> {
  const mode = opts.mode ?? "full";
  const stallMs = opts.stallMs ?? DEFAULT_READ_STALL_MS;
  let zip: yauzl.ZipFile;
  try {
    zip = await withDeadline(
      yauzl.openPromise(filePath, {
        lazyEntries: true,
        autoClose: false,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      }),
      stallMs,
      (late) => late.close(),
    );
  } catch (err) {
    // Arquivo que nem é ZIP (ou cortado no meio, sem o índice no fim), disco que não respondeu…
    throw backupReadError(err);
  }
  const close = () => {
    try {
      zip.close();
    } catch {
      // já fechado
    }
  };
  try {
    if (zip.entryCount > (mode === "manifest" ? MAX_LIST_ENTRIES : MAX_ENTRIES)) {
      throw new UserError(NOT_A_BACKUP_MESSAGE);
    }
    const entries = new Map<string, yauzl.Entry>();
    const names = mode === "full" ? new Set<string>() : null;
    const walk = zip.eachEntry();
    for (;;) {
      const next = await withDeadline(walk.next(), stallMs);
      if (next.done) break;
      const entry = next.value;
      if (entry.isEncrypted()) throw new UserError(DAMAGED_MESSAGE);
      if (names) {
        if (names.has(entry.fileName)) throw new UserError(DAMAGED_MESSAGE);
        names.add(entry.fileName);
        entries.set(entry.fileName, entry);
      } else if (entry.fileName === MANIFEST_ENTRY) {
        if (entries.has(MANIFEST_ENTRY)) throw new UserError(DAMAGED_MESSAGE);
        entries.set(MANIFEST_ENTRY, entry);
      }
    }
    const openEntry = async (name: string): Promise<Readable> => {
      const entry = entries.get(name);
      if (!entry) throw new UserError(DAMAGED_MESSAGE);
      let stream: Readable;
      try {
        stream = await withDeadline(zip.openReadStreamPromise(entry), stallMs, (late) => late.destroy());
      } catch (err) {
        throw backupReadError(err);
      }
      return guardStall(stream, stallMs);
    };
    const readEntry = async (name: string, maxBytes: number) => {
      const entry = entries.get(name);
      if (!entry || entry.uncompressedSize > maxBytes) throw new UserError(DAMAGED_MESSAGE);
      try {
        return await readStreamToBuffer(await openEntry(name), maxBytes);
      } catch (err) {
        throw backupReadError(err);
      }
    };
    if (!entries.has(MANIFEST_ENTRY)) throw new UserError(NOT_A_BACKUP_MESSAGE);
    let raw: unknown;
    let manifestSha256: string;
    try {
      const buf = await readEntry(MANIFEST_ENTRY, MAX_MANIFEST_BYTES);
      manifestSha256 = createHash("sha256").update(buf).digest("hex");
      raw = JSON.parse(buf.toString("utf8"));
    } catch (err) {
      throw new UserError(err instanceof UserError ? err.message : DAMAGED_MESSAGE);
    }
    const manifest = parseManifest(raw);
    // Número de entradas que o manifest promete: tabelas + arquivos + índice,
    // segredos e manifest (+ arquivos que ficaram de fora, que podem ou não ter entrada).
    const least = manifest.tables.length + manifest.storage.files + 3;
    if (zip.entryCount < least || zip.entryCount > least + manifest.storage.missing.length) {
      throw new UserError(DAMAGED_MESSAGE);
    }
    return {
      filePath,
      manifest,
      manifestSha256,
      entryCount: zip.entryCount,
      entries,
      openEntry,
      readEntry,
      close,
    };
  } catch (err) {
    close();
    throw backupReadError(err);
  }
}

/** Só o manifest (para listas): abre, lê e fecha. */
export async function readBackupManifest(filePath: string, opts: { stallMs?: number } = {}): Promise<BackupManifest> {
  const archive = await openBackup(filePath, { mode: "manifest", stallMs: opts.stallMs });
  archive.close();
  return archive.manifest;
}
