/**
 * Carregadores codificados: o código de instalação novo da UTMify (e de quem
 * copiar a ideia) esconde o que carrega — `atob("…")` com um JSON embaralhado
 * por XOR: { url, globals: [{ name, value }], attributes: [{ name, value }] }.
 * O script define as globais (ex.: window.pixelId), cria um <script src=url> e
 * põe os atributos nele. Sem decodificar, ninguém acha o rastreador nem o ID.
 *
 * Formato do texto em base64: 1º byte = tamanho da chave (n); depois n bytes de
 * chave; o resto é o JSON (UTF-8) com cada byte em XOR com a chave (cíclica).
 * JSON em base64 sem a chave NÃO conta: configurações comuns (endereço de API,
 * de formulário) também vêm assim, e não carregam script nenhum.
 *
 * Só LÊ o texto (nunca executa nada) e roda no navegador e no servidor (atob e
 * TextDecoder). `withDecodedLoaders` devolve o código com um "equivalente
 * legível" de cada carregador no fim, para as regras de sempre (endereços,
 * `window.pixelId = …`, `<script src>`) acharem o rastreador e o ID.
 */

export interface EncodedLoader {
  /** Endereço do script carregado (http, https, "//host/…" ou relativo à página). */
  url: string;
  /** Globais definidas antes de carregar (ex.: pixelId). */
  globals: { name: string; value: string | number | boolean }[];
  /** Atributos do <script> criado (ex.: data-utmify-prevent-subids). */
  attributes: { name: string; value: string }[];
}

/**
 * atob("…") / window.atob ('…'): texto em base64 de 16 a 50 mil caracteres, como
 * está escrito no código (com escapes de JavaScript: \/, \n, continuação de linha…).
 */
const ATOB_CALL = /\batob\s*\(\s*(["'`])((?:[A-Za-z0-9+/=\s]|\\[\s\S]){16,50000})\1\s*\)/g;
const HAS_ATOB = /\batob\s*\(/;
/**
 * Códigos maiores que isso não são lidos (não perde tempo). Cobre o maior campo de
 * código livre (PAGE_CODE_MAX_BYTES = 200 KiB em src/server/services/page-code.ts;
 * literal porque este arquivo roda no navegador).
 */
const MAX_CODE = 400_000;
const MAX_LOADERS = 10;
const IDENTIFIER = /^[A-Za-z_$][\w$]{0,63}$/;
const ATTRIBUTE = /^[A-Za-z_:][\w:.-]{0,63}$/;

const SIMPLE_ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", v: "\v", f: "\f", b: "\b" };

/** O valor do texto como o navegador lê (escapes de JavaScript interpretados). */
function unescapeLiteral(text: string): string {
  return text.replace(/\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|(\r\n|[\s\S]))/g, (_m, hex, uni, ch: string) => {
    if (hex) return String.fromCharCode(Number.parseInt(hex, 16));
    if (uni) return String.fromCharCode(Number.parseInt(uni, 16));
    // Continuação de linha (\ + quebra) não vira nada; \/ vira /; \n vira quebra (sai junto com os espaços).
    if (/^[\r\n\u2028\u2029]/.test(ch)) return "";
    return SIMPLE_ESCAPES[ch] ?? ch;
  });
}

function bytesOf(base64: string): Uint8Array | null {
  const atob = (globalThis as { atob?: (s: string) => string }).atob;
  if (typeof atob !== "function") return null;
  let binary: string;
  try {
    binary = atob(unescapeLiteral(base64).replace(/\s+/g, ""));
  } catch {
    return null;
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i) & 255;
  return out;
}

function utf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** JSON do carregador, validado; null se não for um carregador. */
function asLoader(text: string | null): EncodedLoader | null {
  if (!text || !text.trimStart().startsWith("{")) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const raw = data as { url?: unknown; globals?: unknown; attributes?: unknown };
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  // http(s), "//host/…" ou relativo; nada de javascript:, data: e outros esquemas.
  if (!/^(?:(?:https?:)?\/\/|(?![a-z][a-z0-9+.-]*:))[^\s"'<>]+$/i.test(url)) return null;
  const pairs = (list: unknown) =>
    (Array.isArray(list) ? list : []).filter(
      (p): p is { name: string; value: unknown } =>
        Boolean(p) && typeof p === "object" && typeof (p as { name?: unknown }).name === "string",
    );
  const globals = pairs(raw.globals)
    .filter((g) => IDENTIFIER.test(g.name) && ["string", "number", "boolean"].includes(typeof g.value))
    .map((g) => ({ name: g.name, value: g.value as string | number | boolean }));
  const attributes = pairs(raw.attributes)
    .filter((a) => ATTRIBUTE.test(a.name) && !/^on/i.test(a.name))
    .map((a) => ({ name: a.name, value: String(a.value ?? "") }));
  return { url, globals, attributes };
}

/** Um texto em base64 (como está no código) → carregador com chave XOR, ou null. */
export function decodeLoaderPayload(base64: string): EncodedLoader | null {
  const bytes = bytesOf(base64);
  if (!bytes || bytes.length < 3) return null;
  const n = bytes[0];
  if (n < 1 || bytes.length <= 1 + n) return null;
  const key = bytes.subarray(1, 1 + n);
  return asLoader(utf8(bytes.subarray(1 + n).map((b, i) => b ^ key[i % n])));
}

/** Carregadores codificados achados no código (na ordem). [] = nenhum. */
export function decodeEncodedLoaders(code: string): EncodedLoader[] {
  if (typeof code !== "string" || code.length > MAX_CODE || !HAS_ATOB.test(code)) return [];
  const out: EncodedLoader[] = [];
  for (const m of code.matchAll(ATOB_CALL)) {
    const loader = decodeLoaderPayload(m[2] ?? "");
    if (loader) out.push(loader);
    if (out.length >= MAX_LOADERS) break;
  }
  return out;
}

const escapeAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * O que o carregador faz, escrito do jeito comum:
 * `<script>window.pixelId = "…";</script><script src="…" data-…=""></script>`.
 */
export function loaderEquivalent(loader: EncodedLoader): string {
  const globals = loader.globals.map((g) => `window.${g.name} = ${JSON.stringify(g.value).replace(/</g, "\\u003c")};`);
  const attrs = loader.attributes.map((a) => ` ${a.name}="${escapeAttr(a.value)}"`).join("");
  const set = globals.length ? `<script>${globals.join(" ")}</script>` : "";
  return `${set}<script src="${escapeAttr(loader.url)}"${attrs}></script>`;
}

/**
 * O código com o equivalente legível de cada carregador codificado no fim
 * (o mesmo código, sem mudança, quando não há nenhum). Só para análise: nunca
 * grave nem execute o resultado.
 */
export function withDecodedLoaders(code: string): string {
  const loaders = decodeEncodedLoaders(code);
  if (!loaders.length) return code;
  return `${code}\n${loaders.map(loaderEquivalent).join("\n")}`;
}

/** Scripts em data: maiores que isso não são lidos (não são código de instalação de pixel). */
const DATA_SCRIPT_MAX = 400_000;

/**
 * Código de um <script src="data:text/javascript;base64,…"> (plugins de cache
 * como WP Rocket e LiteSpeed adiam o JS inline assim), ou null se o src não é
 * um script em data:.
 */
export function dataUriScript(src: string): string | null {
  const m = /^\s*data:([^,]*),([\s\S]*)$/i.exec(src);
  if (!m || m[2].length > DATA_SCRIPT_MAX) return null;
  const meta = m[1].toLowerCase();
  const type = meta.split(";")[0].trim();
  if (type && !/javascript|ecmascript/.test(type)) return null;
  try {
    if (!/;\s*base64\s*$/.test(meta)) return decodeURIComponent(m[2]);
    const bytes = bytesOf(m[2]);
    return bytes ? new TextDecoder("utf-8").decode(bytes) : null;
  } catch {
    return null;
  }
}

/** src (ou src atrasado por plugin de cache) em data: de um <script>, como escrito no HTML. */
const DATA_SCRIPT_TAG =
  /<script\b[^>]*?\s(?:src|data-src|data-rocket-src|data-lazy-src|data-litespeed-src|data-pmdelayedscript)\s*=\s*(?:"(data:[^"]*)"|'(data:[^']*)')/gi;

/**
 * Para análise de código livre (HTML com <script>): o texto com o código dos
 * scripts em data: e o equivalente legível dos carregadores codificados no fim.
 */
export function readableCode(code: string): string {
  if (typeof code !== "string" || code.length > MAX_CODE) return code;
  const inner = code.includes("data:")
    ? [...code.matchAll(DATA_SCRIPT_TAG)]
        .map((m) => dataUriScript((m[1] ?? m[2] ?? "").replace(/&amp;/gi, "&")))
        .filter((s): s is string => Boolean(s))
    : [];
  return withDecodedLoaders(inner.length ? `${code}\n<script>${inner.join("\n")}</script>` : code);
}
