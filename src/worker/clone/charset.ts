/**
 * Detecção de codificação (charset) e conversão para UTF-8.
 *
 * Ordem de prioridade (igual à dos navegadores, simplificada):
 * BOM → charset do Content-Type → <meta charset>/<meta http-equiv> nos
 * primeiros 2 KB (HTML) ou @charset (CSS) → UTF-8 válido → windows-1252.
 */
import { isUtf8 } from "node:buffer";
import iconv from "iconv-lite";

export interface DecodedText {
  text: string;
  /** Nome normalizado da codificação usada (ex.: "utf-8", "windows-1252"). */
  charset: string;
}

/** Quantos bytes do início do HTML são examinados atrás de <meta charset>. */
const SNIFF_BYTES = 2048;

/**
 * Rótulos que os navegadores tratam como windows-1252 (padrão WHATWG):
 * ISO-8859-1 e ASCII são subconjuntos, e sites que declaram "latin1"
 * normalmente usam aspas curvas/travessões do windows-1252.
 */
const WINDOWS_1252_LABELS = new Set([
  "ansi_x3.4-1968",
  "ascii",
  "cp1252",
  "cp819",
  "csisolatin1",
  "ibm819",
  "iso-8859-1",
  "iso-ir-100",
  "iso8859-1",
  "iso88591",
  "iso_8859-1",
  "iso_8859-1:1987",
  "l1",
  "latin1",
  "us-ascii",
  "windows-1252",
  "x-cp1252",
  "x-user-defined",
]);

const UTF8_LABELS = new Set([
  "utf-8",
  "utf8",
  "unicode-1-1-utf-8",
  "unicode11utf8",
  "unicode20utf8",
  "x-unicode20utf8",
]);

/** Normaliza um rótulo de charset; devolve null se desconhecido. */
export function normalizeCharset(label: string | null | undefined): string | null {
  if (!label) return null;
  const clean = label
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim()
    .toLowerCase();
  if (!clean) return null;
  if (UTF8_LABELS.has(clean)) return "utf-8";
  if (WINDOWS_1252_LABELS.has(clean)) return "windows-1252";
  if (clean === "utf-16" || clean === "utf-16le" || clean === "unicode" || clean === "ucs-2") return "utf-16le";
  if (clean === "utf-16be" || clean === "unicodefffe") return "utf-16be";
  if (clean === "latin9" || clean === "l9" || clean === "iso8859-15" || clean === "iso_8859-15") return "iso-8859-15";
  return iconv.encodingExists(clean) ? clean : null;
}

/** Extrai o parâmetro charset de um Content-Type. */
export function charsetFromContentType(contentType?: string | null): string | null {
  if (!contentType) return null;
  const match = /;\s*charset\s*=\s*("[^"]*"|'[^']*'|[^\s;]+)/i.exec(contentType);
  return match ? normalizeCharset(match[1]) : null;
}

function detectBom(body: Buffer): string | null {
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return "utf-8";
  if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) return "utf-16le";
  if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) return "utf-16be";
  return null;
}

/** Lê os atributos de uma tag (ex.: `<meta charset="x">`) como mapa minúsculo. */
export function parseTagAttributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const inner = tag.replace(/^<[a-z0-9-]+/i, "").replace(/\/?>$/, "");
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (let m = re.exec(inner); m; m = re.exec(inner)) {
    const name = m[1].toLowerCase();
    if (!attrs.has(name)) attrs.set(name, m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** Regex de tag <meta …> (respeita atributos entre aspas contendo ">"). */
const META_TAG_RE = /<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

/** Charset declarado por uma tag <meta>, se houver. */
function charsetFromMetaTag(tag: string): string | null {
  const attrs = parseTagAttributes(tag);
  const direct = attrs.get("charset");
  if (direct !== undefined) return direct;
  if (attrs.get("http-equiv")?.trim().toLowerCase() === "content-type") {
    const m = /charset\s*=\s*["']?\s*([^"'\s;]+)/i.exec(attrs.get("content") ?? "");
    if (m) return m[1];
  }
  return null;
}

/** Procura <meta charset> ou <?xml encoding> nos primeiros bytes do HTML. */
function sniffHtmlCharset(body: Buffer): string | null {
  const head = body
    .subarray(0, SNIFF_BYTES)
    .toString("latin1")
    .replace(/<!--[\s\S]*?-->/g, "");
  const xml = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(head);
  if (xml) {
    const cs = normalizeCharset(xml[1]);
    if (cs) return cs;
  }
  for (const tag of head.match(META_TAG_RE) ?? []) {
    const label = charsetFromMetaTag(tag);
    const cs = normalizeCharset(label);
    // Um HTML que declara UTF-16 dentro de si mesmo só pode ser ASCII-compatível.
    if (cs) return cs.startsWith("utf-16") ? "utf-8" : cs;
  }
  return null;
}

/** Lê o `@charset "x";` que só vale como primeira coisa do arquivo CSS. */
function sniffCssCharset(body: Buffer): string | null {
  const m = /^@charset "([^"]{1,40})";/.exec(body.subarray(0, 64).toString("latin1"));
  const cs = m ? normalizeCharset(m[1]) : null;
  if (!cs) return null;
  return cs.startsWith("utf-16") ? "utf-8" : cs;
}

function kindFromContentType(contentType?: string): "html" | "css" | "other" | "unknown" {
  const mime = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (!mime) return "unknown";
  if (mime === "text/css") return "css";
  if (mime.includes("html") || mime.includes("xml")) return "html";
  if (mime === "text/plain" || mime === "application/octet-stream") return "unknown";
  return "other";
}

function decodeWith(body: Buffer, charset: string): string {
  // iconv-lite remove o BOM de UTF-8/UTF-16 automaticamente.
  return iconv.decode(body, charset);
}

/**
 * Converte bytes (HTML, CSS, JS…) em texto, detectando a codificação.
 * Nunca lança erro: no pior caso decodifica como windows-1252.
 */
export function decodeText(body: Buffer, contentType?: string): DecodedText {
  const bom = detectBom(body);
  if (bom) return { text: decodeWith(body, bom), charset: bom };

  const fromHeader = charsetFromContentType(contentType);
  if (fromHeader) return { text: decodeWith(body, fromHeader), charset: fromHeader };

  const kind = kindFromContentType(contentType);
  let sniffed: string | null = null;
  if (kind === "css") sniffed = sniffCssCharset(body);
  else if (kind === "html") sniffed = sniffHtmlCharset(body);
  else if (kind === "unknown") sniffed = sniffCssCharset(body) ?? sniffHtmlCharset(body);
  if (sniffed) return { text: decodeWith(body, sniffed), charset: sniffed };

  if (isUtf8(body)) return { text: decodeWith(body, "utf-8"), charset: "utf-8" };
  return { text: decodeWith(body, "windows-1252"), charset: "windows-1252" };
}

/** A tag <meta> declara charset (direto ou via http-equiv)? */
function isCharsetMeta(tag: string): boolean {
  const attrs = parseTagAttributes(tag);
  if (attrs.has("charset")) return true;
  return attrs.get("http-equiv")?.trim().toLowerCase() === "content-type";
}

const UTF8_META = '<meta charset="utf-8">';

/**
 * Garante `<meta charset="utf-8">` como primeiro elemento do <head> e remove
 * as declarações antigas de charset (o texto já foi convertido para UTF-8).
 * Trabalha no texto (sem re-serializar o documento).
 */
export function fixMetaCharset(html: string): string {
  let doc = html.charCodeAt(0) === 0xfeff ? html.slice(1) : html;

  // Só mexe na região do <head> (até </head> ou <body>) para não tocar em
  // strings dentro de scripts do corpo.
  const headEnd = doc.search(/<\/head\s*>|<body[\s>/]/i);
  const limit = headEnd === -1 ? doc.length : headEnd;
  const region = doc.slice(0, limit).replace(META_TAG_RE, (tag) => (isCharsetMeta(tag) ? "" : tag));
  doc = region + doc.slice(limit);

  const head = /<head(?=[\s>/])[^>]*>/i.exec(doc);
  if (head) {
    const at = head.index + head[0].length;
    return doc.slice(0, at) + UTF8_META + doc.slice(at);
  }
  // Sem <head>: o <meta> logo após <html> (ou após o doctype) cria o head implícito.
  const htmlTag = /<html(?=[\s>])[^>]*>/i.exec(doc);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return doc.slice(0, at) + UTF8_META + doc.slice(at);
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(doc);
  if (doctype) {
    const at = doctype[0].length;
    return doc.slice(0, at) + UTF8_META + doc.slice(at);
  }
  return UTF8_META + doc;
}
