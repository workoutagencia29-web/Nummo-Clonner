/**
 * Utilidades de URL do clonador: resolver referências relativas, filtrar
 * esquemas que não são arquivos e escolher a extensão de um arquivo baixado.
 *
 * Funções puras (sem rede, sem banco).
 */

/** Esquemas que nunca apontam para um arquivo a baixar. */
const SKIPPED_SCHEMES =
  /^(?:data|blob|javascript|vbscript|about|mailto|tel|sms|callto|whatsapp|intent|chrome|chrome-extension|moz-extension|file):/i;

/**
 * Resolve `ref` contra `base` e devolve a URL absoluta, sem `#hash`.
 *
 * Retorna `null` para referências vazias, só com fragmento (`#x`) ou com
 * esquemas que não são arquivos (data:, blob:, javascript:, about:, mailto:,
 * tel:, sms:…). Aceita `//host/caminho` (herda o protocolo da base).
 *
 * Observação: os valores vindos do cheerio já têm as entidades HTML
 * decodificadas (`&amp;` → `&`); aqui não se decodifica de novo, igual ao
 * navegador.
 */
export function absolutize(ref: string, base: string): string | null {
  if (typeof ref !== "string") return null;
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  // O navegador ignora TAB/quebras de linha dentro da URL; tiramos antes do teste de esquema.
  const compact = trimmed.replace(/[\t\n\r]/g, "");
  if (!compact || SKIPPED_SCHEMES.test(compact)) return null;
  let url: URL;
  try {
    url = new URL(compact, base);
  } catch {
    try {
      url = new URL(compact);
    } catch {
      return null;
    }
  }
  if (SKIPPED_SCHEMES.test(url.protocol)) return null;
  url.hash = "";
  return url.href;
}

/**
 * Decodifica sequências %XX sem nunca lançar erro: `decodeURIComponent` quebra
 * com "%" solto ("desconto-50%.png") ou bytes que não são UTF-8 ("%E7%E3o" de
 * sites antigos em Latin-1). Cada trecho inválido fica como veio.
 */
export function safeDecode(value: string): string {
  return value.replace(/(?:%[0-9a-f]{2})+/gi, (seq) => {
    try {
      return decodeURIComponent(seq);
    } catch {
      // Decodifica o que for UTF-8 válido (sequências de 1 a 4 bytes) e deixa o resto.
      const escapes = seq.match(/%[0-9a-f]{2}/gi) ?? [];
      let out = "";
      for (let i = 0; i < escapes.length; ) {
        let step = 0;
        for (let len = Math.min(4, escapes.length - i); len > 0 && !step; len--) {
          try {
            out += decodeURIComponent(escapes.slice(i, i + len).join(""));
            step = len;
          } catch {
            // tenta uma sequência menor
          }
        }
        if (!step) {
          out += escapes[i];
          step = 1;
        }
        i += step;
      }
      return out;
    }
  });
}

/** `true` para URLs absolutas http: ou https:. */
export function isHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Fragmento (`#...`) de uma referência, com o `#`; vazio quando não há. */
export function fragmentOf(ref: string): string {
  const i = ref.indexOf("#");
  return i < 0 ? "" : ref.slice(i).trim();
}

/** Extensões conhecidas (a mesma lista vale para o tipo e para o caminho). */
export const KNOWN_EXTENSIONS = [
  "css",
  "js",
  "png",
  "jpg",
  "webp",
  "avif",
  "gif",
  "svg",
  "ico",
  "woff2",
  "woff",
  "ttf",
  "otf",
  "eot",
  "mp4",
  "webm",
  "mp3",
  "json",
  "pdf",
  "html",
] as const;

export type KnownExtension = (typeof KNOWN_EXTENSIONS)[number];

const CONTENT_TYPE_EXT: Record<string, KnownExtension> = {
  "text/css": "css",
  "text/javascript": "js",
  "application/javascript": "js",
  "application/x-javascript": "js",
  "application/ecmascript": "js",
  "text/ecmascript": "js",
  "text/jscript": "js",
  "application/x-ecmascript": "js",
  "image/png": "png",
  "image/apng": "png",
  "image/x-png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/svg": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/ico": "ico",
  "image/icon": "ico",
  "font/woff2": "woff2",
  "application/font-woff2": "woff2",
  "application/x-font-woff2": "woff2",
  "font/woff": "woff",
  "application/font-woff": "woff",
  "application/x-font-woff": "woff",
  "font/ttf": "ttf",
  "font/sfnt": "ttf",
  "application/x-font-ttf": "ttf",
  "application/x-font-truetype": "ttf",
  "application/font-sfnt": "ttf",
  "font/otf": "otf",
  "font/opentype": "otf",
  "application/x-font-opentype": "otf",
  "application/font-otf": "otf",
  "application/vnd.ms-fontobject": "eot",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "application/json": "json",
  "application/pdf": "pdf",
  // Documentos do próprio site (iframes, trechos buscados por scripts) no "Preservar JS":
  // guardados como .html para a prévia servi-los como página, e não como download (.bin).
  "text/html": "html",
  "application/xhtml+xml": "html",
  "application/manifest+json": "json",
  "text/json": "json",
};

/** Sinônimos de extensão no caminho da URL. */
const PATH_EXT_ALIASES: Record<string, KnownExtension> = {
  jpeg: "jpg",
  jpe: "jpg",
  jfif: "jpg",
  mjs: "js",
  cjs: "js",
  webmanifest: "json",
  apng: "png",
  svgz: "svg",
  htm: "html",
  xhtml: "html",
};

const KNOWN_SET = new Set<string>(KNOWN_EXTENSIONS);

/** Extensão conhecida do caminho de uma URL (ou `null`). */
export function extensionFromPath(url: string): KnownExtension | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split(/[?#]/)[0] ?? "";
  }
  const last = pathname.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot < 0) return null;
  let ext = last.slice(dot + 1).toLowerCase();
  try {
    ext = decodeURIComponent(ext);
  } catch {
    // mantém como está
  }
  if (KNOWN_SET.has(ext)) return ext as KnownExtension;
  return PATH_EXT_ALIASES[ext] ?? null;
}

/**
 * Extensão para guardar um arquivo: pelo Content-Type quando reconhecido,
 * senão pelo caminho da URL, senão "bin".
 */
export function extensionFor(url: string, contentType?: string | null): string {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const byType = CONTENT_TYPE_EXT[type];
  if (byType) return byType;
  return extensionFromPath(url) ?? "bin";
}
