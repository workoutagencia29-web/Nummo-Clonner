/**
 * Quais arquivos do storage entram no backup: os que as ofertas usam.
 *
 * - Arquivos endereçados por hash (a/<2>/<sha256>.<ext>) citados em qualquer
 *   registro do backup (HTML, projeto do editor, SEO, miniatura, resultado de
 *   clonagem…), nas versões salvas e — de forma transitiva — dentro de outros
 *   arquivos de texto (um CSS que importa outro CSS que usa uma fonte).
 * - Versões salvas (versions/<documento>/…) das linhas de PageVersion.
 * - Saídas de clonagens ainda em revisão (clones/<job>/…), para dar para salvar
 *   depois de restaurar.
 *
 * Ficam de fora o que dá para gerar de novo ou não tem mais uso: ZIPs do
 * "Baixar ZIP" (exports/), envios de clonagens (uploads/) e temporários.
 *
 * Pasta ou arquivo que existe mas não dá para ler (sem permissão, erro do
 * disco) não some calado: entra em `unreadable` e o backup avisa.
 */
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const SHA_RE = /[0-9a-f]{64}/g;
const CONTENT_FILE_RE = /^([0-9a-f]{64})\.([a-z0-9]{1,8})$/;
/** Arquivos de texto que podem citar outros arquivos (lidos para achar mais referências). */
const TEXT_EXT = new Set(["css", "js", "mjs", "cjs", "html", "htm", "svg", "json", "txt", "xml", "map", "webmanifest"]);
const MAX_SCAN_BYTES = 32 * 1024 * 1024;

export interface StorageFile {
  key: string;
  full: string;
  bytes: number;
}

export class StorageRefs {
  readonly shas = new Set<string>();
  readonly versionKeys = new Set<string>();
  readonly cloneJobs = new Set<string>();

  /** Hashes citados num texto qualquer. */
  addText(text: string | null | undefined) {
    if (!text) return;
    for (const m of text.matchAll(SHA_RE)) this.shas.add(m[0]);
  }

  /** Bytes que podem estar compactados com gzip (projeto do editor, versões). */
  addMaybeGzip(data: Buffer) {
    let text: string;
    try {
      text = gunzipSync(data).toString("utf8");
    } catch {
      text = data.toString("utf8");
    }
    this.addText(text);
  }
}

/** O que existe no disco mas não pôde ser lido (fica de fora do backup, com aviso). */
export interface UnreadableStorage {
  /** Arquivos (chaves do storage). */
  files: string[];
  /** Pastas (chaves terminadas em "/"), cujo conteúdo ficou de fora. */
  folders: string[];
  /** Todos por falta de permissão (o aviso diz isso). */
  denied: boolean;
}

/** Pasta ou arquivo que não existe (ou sumiu): não é erro de leitura. */
function isGone(err: unknown) {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function isDenied(err: unknown) {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "EACCES" || code === "EPERM";
}

function newUnreadable(): UnreadableStorage {
  return { files: [], folders: [], denied: true };
}

/** Conteúdo de uma pasta; pasta que existe e não abre fica registrada em `unreadable`. */
async function listDir(dir: string, key: string, unreadable: UnreadableStorage) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (!isGone(err)) {
      console.warn(`[backup] pasta que não pôde ser lida (${(err as NodeJS.ErrnoException).code ?? "erro"}): ${key}`);
      unreadable.folders.push(key);
      if (!isDenied(err)) unreadable.denied = false;
    }
    return [];
  }
}

/** Índice dos arquivos endereçados por hash: sha256 → nomes ("<sha>.png", "<sha>.webp"…). */
async function contentIndex(storageRoot: string, unreadable: UnreadableStorage): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>();
  const root = path.join(storageRoot, "a");
  for (const prefix of await listDir(root, "a/", unreadable)) {
    if (!prefix.isDirectory() || !/^[0-9a-f]{2}$/.test(prefix.name)) continue;
    for (const file of await listDir(path.join(root, prefix.name), `a/${prefix.name}/`, unreadable)) {
      const m = CONTENT_FILE_RE.exec(file.name);
      if (!file.isFile() || !m || m[1].slice(0, 2) !== prefix.name) continue;
      const list = index.get(m[1]) ?? [];
      list.push(file.name);
      index.set(m[1], list);
    }
  }
  return index;
}

async function scanFile(full: string, refs: StorageRefs, gz = false) {
  if (gz) {
    refs.addMaybeGzip(await readFile(full));
    return;
  }
  // Lido em pedaços (sem cortar um hash ao meio).
  let carry = "";
  for await (const chunk of createReadStream(full, { encoding: "utf8", highWaterMark: 1024 * 1024 })) {
    const text = carry + (chunk as string);
    refs.addText(text);
    carry = text.slice(-63);
  }
}

/**
 * Lista os arquivos que entram no backup (ordenados pela chave) e os citados
 * que não estão no disco (versões cujo arquivo sumiu).
 */
export async function resolveStorageFiles(
  refs: StorageRefs,
  storageRoot: string,
): Promise<{ files: StorageFile[]; missing: string[]; unreadable: UnreadableStorage }> {
  const files = new Map<string, StorageFile>();
  const missing: string[] = [];
  const unreadable = newUnreadable();
  /**
   * Lê um arquivo atrás de outras referências. Sem permissão para ler: sai da
   * lista (o backup também não conseguiria copiar) e entra nos ilegíveis.
   * Devolve false nesse caso.
   */
  const scan = async (file: StorageFile, into: StorageRefs, gz = false): Promise<boolean> => {
    try {
      await scanFile(file.full, into, gz);
      return true;
    } catch (err) {
      // Sumiu depois de listado: a cópia do backup registra como "sumiu durante o backup".
      if (isGone(err)) return true;
      if (isDenied(err)) {
        console.warn(`[backup] arquivo sem permissão de leitura: ${file.key}`);
        files.delete(file.key);
        if (!unreadable.files.includes(file.key)) unreadable.files.push(file.key);
        return false;
      }
      // Outro erro (disco): a cópia tenta ler de novo e, se falhar, o backup avisa.
      console.warn(`[backup] não foi possível procurar referências em ${file.key}:`, err);
      return true;
    }
  };
  const add = async (key: string): Promise<StorageFile | null> => {
    const existing = files.get(key);
    if (existing) return existing;
    const full = path.join(storageRoot, ...key.split("/"));
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) return null;
    const file = { key, full, bytes: info.size };
    files.set(key, file);
    return file;
  };

  // Versões salvas: o arquivo e o que ele cita.
  for (const key of [...refs.versionKeys].sort()) {
    const file = await add(key);
    if (!file) {
      missing.push(key);
      continue;
    }
    await scan(file, refs, true);
  }

  // Saídas de clonagens em revisão (HTML das duas saídas e prints do original).
  for (const jobId of [...refs.cloneJobs].sort()) {
    const dir = path.join(storageRoot, "clones", jobId);
    for (const entry of await listDir(dir, `clones/${jobId}/`, unreadable)) {
      if (!entry.isFile() || entry.name.endsWith(".tmp")) continue;
      const file = await add(`clones/${jobId}/${entry.name}`);
      if (file && /\.html?$/i.test(entry.name)) await scan(file, refs);
    }
  }

  // Arquivos por hash, seguindo as referências dentro dos arquivos de texto.
  const index = await contentIndex(storageRoot, unreadable);
  const queue = [...refs.shas];
  const seen = new Set<string>();
  while (queue.length) {
    const sha = queue.pop() as string;
    if (seen.has(sha)) continue;
    seen.add(sha);
    for (const name of index.get(sha) ?? []) {
      const file = await add(`a/${sha.slice(0, 2)}/${name}`);
      if (!file) continue;
      const ext = name.slice(name.lastIndexOf(".") + 1);
      if (!TEXT_EXT.has(ext) || file.bytes > MAX_SCAN_BYTES) continue;
      const inner = new StorageRefs();
      if (!(await scan(file, inner))) continue;
      for (const s of inner.shas) {
        refs.shas.add(s);
        if (!seen.has(s)) queue.push(s);
      }
    }
  }

  return {
    files: [...files.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    missing,
    unreadable,
  };
}
