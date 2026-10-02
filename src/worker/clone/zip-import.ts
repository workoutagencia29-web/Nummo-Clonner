/**
 * Importação de site salvo em ZIP (alternativa quando a página tem anti-robô).
 *
 * Lê tudo para a memória (nada é extraído para o disco) com validações contra
 * ZIPs maliciosos: caminhos absolutos ou com "..", links simbólicos, entradas
 * com senha, excesso de arquivos/bytes e taxa de compressão suspeita (bomba).
 */
import { isUtf8 } from "node:buffer";
import { posix } from "node:path";
import type { Readable } from "node:stream";
import iconv from "iconv-lite";
import yauzl from "yauzl";
import { UserError } from "@/lib/errors";
import { safeDecode } from "./urls";

export interface ZipLimits {
  /** Máximo de entradas no ZIP. Padrão: 5000. */
  maxEntries?: number;
  /** Máximo somado depois de descompactar. Padrão: 1 GB. */
  maxTotalBytes?: number;
  /** Máximo por arquivo depois de descompactar. Padrão: 200 MB. */
  maxFileBytes?: number;
  /** Taxa máxima descompactado/compactado (arquivos a partir de 1 MB). Padrão: 100. */
  maxRatio?: number;
}

export interface ZipSite {
  /** Caminho normalizado (NFC, "/") → conteúdo. */
  files: Map<string, Buffer>;
  /** Página de entrada (ex.: "index.html" ou "meu-site/index.html"). */
  indexPath: string;
  /** Pasta da página de entrada ("" ou "meu-site/"), raiz para links "/…". */
  rootDir: string;
  /** Avisos em português (duplicados, escolha da página inicial…). */
  warnings: string[];
}

/** Erro de importação com mensagem pronta para o usuário. */
export class ZipImportError extends UserError {
  constructor(message: string) {
    super(message);
    this.name = "ZipImportError";
  }
}

const MB = 1024 * 1024;
const DEFAULT_LIMITS: Required<ZipLimits> = {
  maxEntries: 5000,
  maxTotalBytes: 1024 * MB,
  maxFileBytes: 200 * MB,
  maxRatio: 100,
};
/** Abaixo disso a taxa de compressão não é verificada (arquivos pequenos e repetitivos são normais). */
const RATIO_MIN_BYTES = 1 * MB;

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

function formatSize(bytes: number) {
  if (bytes >= 1024 * MB) return `${+(bytes / (1024 * MB)).toFixed(1)} GB`.replace(".", ",");
  if (bytes >= MB) return `${+(bytes / MB).toFixed(1)} MB`.replace(".", ",");
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function malicious(detail: string) {
  return new ZipImportError(`O ZIP parece corrompido ou malicioso (${detail}).`);
}

/** Traduz os erros (em inglês) do yauzl. */
function translateZipError(err: unknown): Error {
  if (err instanceof UserError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  const path = msg.split(": ").slice(1).join(": ");
  if (/^invalid relative path|^absolute path|^invalid characters in fileName/.test(msg)) {
    return malicious(`caminho inválido: "${path}"`);
  }
  if (/end of central directory record signature not found|not a zip/i.test(msg)) {
    return new ZipImportError("O arquivo enviado não é um ZIP válido.");
  }
  if (/unsupported compression method/i.test(msg)) {
    return new ZipImportError(
      "O ZIP usa um tipo de compressão não suportado. Compacte a pasta de novo com o compactador padrão do Mac ou do Windows.",
    );
  }
  if (/too many bytes|not enough bytes|size mismatch/i.test(msg)) {
    return malicious("o tamanho declarado de um arquivo não confere");
  }
  if (/encrypted/i.test(msg)) {
    return new ZipImportError("O ZIP está protegido por senha. Compacte a pasta de novo sem senha.");
  }
  return malicious("não foi possível ler o arquivo");
}

/** Pastas e arquivos de sistema que não fazem parte do site. */
function isJunk(segments: string[]) {
  if (segments.some((s) => s === "__MACOSX")) return true;
  const base = segments[segments.length - 1] ?? "";
  const lower = base.toLowerCase();
  return lower === ".ds_store" || lower === "thumbs.db" || lower === "desktop.ini" || base.startsWith("._");
}

/**
 * Nome da entrada. Sem a marca de UTF-8, o yauzl usa CP437; mas o `zip` do
 * Mac/Linux grava UTF-8 sem marcar, e o Windows em português usa CP850.
 */
function entryName(entry: yauzl.Entry): string {
  const raw = (entry as yauzl.Entry & { fileNameRaw?: Buffer }).fileNameRaw;
  const utf8Flag = (entry.generalPurposeBitFlag & 0x800) !== 0;
  const unicodeExtra = entry.extraFields.some((f) => f.id === 0x7075);
  if (!raw || utf8Flag || unicodeExtra) return entry.fileName;
  return isUtf8(raw) ? raw.toString("utf8") : iconv.decode(raw, "cp850");
}

/**
 * Valida e normaliza o nome de uma entrada. Devolve null para pastas e
 * arquivos de sistema; lança erro para caminhos perigosos.
 */
function normalizeEntryName(raw: string): string | null {
  const name = raw.replace(/\\/g, "/").normalize("NFC");
  if (name.includes("\0") || name.startsWith("/") || /^[a-z]:/i.test(name)) {
    throw malicious(`caminho inválido: "${raw}"`);
  }
  if (name.endsWith("/")) return null;
  const segments = name.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.some((s) => s === "..")) throw malicious(`caminho inválido: "${raw}"`);
  if (!segments.length || isJunk(segments)) return null;
  return segments.join("/");
}

async function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, maxBytes: number, name: string): Promise<Buffer> {
  let stream: Readable;
  try {
    stream = await zip.openReadStreamPromise(entry);
  } catch (err) {
    throw translateZipError(err);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      total += (chunk as Buffer).length;
      if (total > maxBytes) throw malicious(`"${name}" tem mais de ${formatSize(maxBytes)}`);
      chunks.push(chunk as Buffer);
    }
  } catch (err) {
    stream.destroy();
    throw translateZipError(err);
  }
  return Buffer.concat(chunks, total);
}

const HTML_RE = /\.html?$/i;

/** Prefere .html a .htm e caminhos mais curtos. */
function pickPreferred(paths: string[]) {
  return [...paths].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

/**
 * Pasta de arquivos criada por "Salvar como → Página completa": "Página_files"
 * (Chrome, Edge) ou "Página_arquivos" (Firefox em português). Os .html dentro
 * dela são iframes salvos junto (chat, player, formulário), nunca a página.
 */
const SAVED_FILES_DIR_RE = /_(?:files|arquivos)$/i;

function inSavedFilesDir(filePath: string) {
  return filePath
    .split("/")
    .slice(0, -1)
    .some((dir) => SAVED_FILES_DIR_RE.test(dir));
}

/**
 * Página de entrada: index.html/index.htm na raiz → dentro de uma única pasta
 * de primeiro nível → o único .html → o maior .html. Os .html de pastas
 * "…_files" (salvas pelo navegador junto com a página) não contam.
 */
export function findIndexPath(files: Map<string, Buffer>): { indexPath: string; guessed: boolean } | null {
  const html = [...files.keys()].filter((p) => HTML_RE.test(p) && !inSavedFilesDir(p));
  if (!html.length) return null;

  const rootIndex = html.filter((p) => /^index\.html?$/i.test(p));
  if (rootIndex.length) return { indexPath: pickPreferred(rootIndex), guessed: false };

  const folderIndex = html.filter((p) => /^[^/]+\/index\.html?$/i.test(p));
  const folders = new Set(folderIndex.map((p) => p.split("/")[0]));
  if (folders.size === 1) return { indexPath: pickPreferred(folderIndex), guessed: false };

  if (html.length === 1) return { indexPath: html[0], guessed: false };

  const largest = [...html].sort((a, b) => {
    const diff = (files.get(b)?.length ?? 0) - (files.get(a)?.length ?? 0);
    return diff || a.split("/").length - b.split("/").length || a.localeCompare(b);
  })[0];
  return { indexPath: largest, guessed: true };
}

/** Lê um site inteiro de um ZIP para a memória, com as validações de segurança. */
export async function readZipSite(zipPath: string, limits: ZipLimits = {}): Promise<ZipSite> {
  const L = { ...DEFAULT_LIMITS, ...limits };
  let zip: yauzl.ZipFile;
  try {
    zip = await yauzl.openPromise(zipPath, {
      lazyEntries: true,
      autoClose: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: false,
    });
  } catch (err) {
    throw translateZipError(err);
  }

  const files = new Map<string, Buffer>();
  const warnings: string[] = [];
  const duplicates: string[] = [];
  let count = 0;
  let declaredTotal = 0;

  try {
    if (zip.entryCount > L.maxEntries) throw malicious(`tem mais de ${L.maxEntries} arquivos`);

    for await (const entry of zip.eachEntry()) {
      count++;
      if (count > L.maxEntries) throw malicious(`tem mais de ${L.maxEntries} arquivos`);

      const name = normalizeEntryName(entryName(entry));
      const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
      if ((mode & S_IFMT) === S_IFLNK) {
        throw malicious(`"${entry.fileName}" é um atalho (link simbólico)`);
      }
      if (name === null) continue;
      if (entry.isEncrypted()) {
        throw new ZipImportError("O ZIP está protegido por senha. Compacte a pasta de novo sem senha.");
      }
      if (entry.uncompressedSize > L.maxFileBytes) {
        throw malicious(`"${name}" tem mais de ${formatSize(L.maxFileBytes)}`);
      }
      declaredTotal += entry.uncompressedSize;
      if (declaredTotal > L.maxTotalBytes) {
        throw malicious(`passa de ${formatSize(L.maxTotalBytes)} depois de descompactado`);
      }
      if (entry.uncompressedSize >= RATIO_MIN_BYTES) {
        const ratio =
          entry.compressedSize > 0 ? entry.uncompressedSize / entry.compressedSize : Number.POSITIVE_INFINITY;
        if (ratio > L.maxRatio) throw malicious(`"${name}" tem uma taxa de compressão suspeita`);
      }

      // O yauzl confere se o conteúdo tem exatamente o tamanho declarado.
      const data = await readEntry(zip, entry, L.maxFileBytes, name);
      if (files.has(name)) {
        duplicates.push(name);
        continue;
      }
      files.set(name, data);
    }
  } catch (err) {
    throw translateZipError(err);
  } finally {
    zip.close();
  }

  if (duplicates.length) {
    warnings.push(
      `O ZIP tem ${duplicates.length} arquivo(s) repetido(s); usamos a primeira cópia (ex.: "${duplicates[0]}").`,
    );
  }

  const found = findIndexPath(files);
  if (!found) {
    // Quem compacta só a pasta "Página_files" fica sem a página principal.
    if (files.size && [...files.keys()].every(inSavedFilesDir)) {
      throw new ZipImportError(
        "Parece que você compactou só a pasta “_files”. Selecione o arquivo .html da página junto com essa pasta, compacte os dois e envie o ZIP de novo.",
      );
    }
    throw new ZipImportError("Não encontrei nenhum arquivo .html no ZIP.");
  }
  if (found.guessed) {
    warnings.push(`Não encontramos um index.html; usamos "${found.indexPath}" como página principal.`);
  }
  const dir = posix.dirname(found.indexPath);
  return { files, indexPath: found.indexPath, rootDir: dir === "." ? "" : `${dir}/`, warnings };
}

// ─── Resolução de caminhos dentro do ZIP ─────────────────────────────────────

/**
 * Resolve uma referência relativa (src/href/url()) a partir de um arquivo do
 * ZIP. Devolve o caminho normalizado (NFC) ou null quando é externa (http:,
 * data:, //cdn…), só âncora/consulta, ou sai da raiz do ZIP. Referências a
 * pastas ("pasta/") viram "pasta/index.html". Caminhos com "/" no início são
 * resolvidos a partir de `rootDir` (a pasta da página principal).
 */
export function resolveZipPath(fromPath: string, ref: string, rootDir = ""): string | null {
  let r = ref.trim();
  if (!r || r.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(r)) return null;
  r = r.replace(/[?#][\s\S]*$/, "");
  if (!r) return null;
  r = safeDecode(r.replace(/\\/g, "/"));
  if (r.includes("\0")) return null;

  const isDir = r.endsWith("/") || /(^|\/)\.{1,2}$/.test(r);
  const base = r.startsWith("/") ? rootDir : posix.dirname(fromPath);
  const out: string[] = [];
  for (const seg of `${base}/${r}`.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(seg);
  }
  if (isDir) out.push("index.html");
  if (!out.length) return null;
  return out.join("/").normalize("NFC");
}

const lowerIndexCache = new WeakMap<Map<string, Buffer>, { size: number; index: Map<string, string> }>();

/** Índice "minúsculo → chave real" (refeito se o mapa mudar de tamanho). */
function lowerIndex(files: Map<string, Buffer>) {
  const cached = lowerIndexCache.get(files);
  if (cached && cached.size === files.size) return cached.index;
  const index = new Map<string, string>();
  for (const key of files.keys()) {
    const lower = key.normalize("NFC").toLowerCase();
    if (!index.has(lower)) index.set(lower, key);
  }
  lowerIndexCache.set(files, { size: files.size, index });
  return index;
}

/**
 * Procura um arquivo no ZIP tentando as variantes NFC/NFD (acentos de nomes
 * criados no Mac), %XX decodificado, maiúsculas/minúsculas e index.htm.
 * Devolve a chave real encontrada e o conteúdo.
 */
export function findZipEntry(files: Map<string, Buffer>, filePath: string): { path: string; data: Buffer } | null {
  const bases = new Set([filePath, safeDecode(filePath)]);
  const candidates = new Set<string>();
  for (const b of bases) {
    const clean = b.replace(/^\/+/, "");
    for (const form of [clean, clean.normalize("NFC"), clean.normalize("NFD")]) {
      candidates.add(form);
      if (/(^|\/)index\.html$/i.test(form)) candidates.add(form.replace(/l$/i, ""));
    }
  }
  for (const c of candidates) {
    const data = files.get(c);
    if (data) return { path: c, data };
  }
  // Sites feitos no Mac/Windows costumam errar maiúsculas/minúsculas.
  const index = lowerIndex(files);
  for (const c of candidates) {
    const key = index.get(c.normalize("NFC").toLowerCase());
    const data = key ? files.get(key) : undefined;
    if (key && data) return { path: key, data };
  }
  return null;
}

/** Como `findZipEntry`, mas devolve só o conteúdo do arquivo (ou null). */
export function findZipFile(files: Map<string, Buffer>, filePath: string): Buffer | null {
  return findZipEntry(files, filePath)?.data ?? null;
}
