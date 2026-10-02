/**
 * Referências a arquivos dentro de CSS: coleta e reescrita.
 *
 * A leitura usa o css-tree (tolerante a CSS inválido e a "hacks" de IE). A
 * reescrita NÃO regenera o CSS: troca só o trecho de cada referência no texto
 * original, então comentários, hacks e formatação continuam idênticos. Se o
 * css-tree falhar por completo, um leitor simples de `url(...)` e `@import`
 * assume o lugar.
 */
import * as csstree from "css-tree";
import { absolutize, fragmentOf, isHttpUrl } from "./urls";

/** Referência encontrada num CSS (URL absoluta, sem #hash). */
export interface CssRef {
  url: string;
  /** "import" = outra folha de estilo (`@import`); "asset" = imagem, fonte etc. */
  kind: "import" | "asset";
  /** true quando a referência está dentro de `@font-face` (é uma fonte). */
  font?: boolean;
}

export interface CssOptions {
  /** true para o conteúdo de um atributo `style=""` (lista de declarações). */
  inline?: boolean;
}

/** Uma ocorrência de referência no texto do CSS. */
export interface CssOccurrence {
  /** Valor como o navegador lê (escapes do CSS já resolvidos). */
  value: string;
  kind: "import" | "asset";
  font: boolean;
  /** Faixa do conteúdo (sem aspas) no texto original. */
  contentStart: number;
  contentEnd: number;
  /** Aspas originais; "" = `url(...)` sem aspas. */
  quote: '"' | "'" | "";
}

const IMAGE_SET_FUNCTIONS = new Set(["image-set", "-webkit-image-set", "-moz-image-set", "-o-image-set"]);
const IGNORED_PROPERTIES = new Set(["behavior", "-ms-behavior"]);

// ─── Leitura ─────────────────────────────────────────────────────────────────

/** Encontra todas as referências (com posição) num CSS. */
export function findCssOccurrences(css: string, opts: CssOptions = {}): CssOccurrence[] {
  let found: CssOccurrence[];
  try {
    found = occurrencesFromAst(css, opts);
  } catch {
    found = [];
    scanText(css, 0, css.length, false, false, found);
  }
  // Ordena e descarta sobreposições (não deveriam existir, mas a reescrita depende disso).
  found.sort((a, b) => a.contentStart - b.contentStart);
  const out: CssOccurrence[] = [];
  let lastEnd = -1;
  for (const occ of found) {
    if (occ.contentStart < lastEnd) continue;
    out.push(occ);
    lastEnd = occ.contentEnd;
  }
  return out;
}

function occurrencesFromAst(css: string, opts: CssOptions): CssOccurrence[] {
  const errors: unknown[] = [];
  const ast = csstree.parse(css, {
    context: opts.inline ? "declarationList" : "stylesheet",
    positions: true,
    parseValue: true,
    parseCustomProperty: false,
    parseRulePrelude: false,
    onParseError: (error) => {
      errors.push(error);
    },
  });
  const found: CssOccurrence[] = [];

  csstree.walk(ast, function (node) {
    if (node.type !== "Url" && node.type !== "String" && node.type !== "Raw") return;
    const loc = node.loc;
    if (!loc) return;
    const atrule = this.atrule?.name.toLowerCase() ?? "";
    if (atrule === "namespace") return;
    const property = this.declaration?.property.toLowerCase();
    if (property && IGNORED_PROPERTIES.has(property)) return;
    const inImportPrelude = atrule === "import" && this.atrulePrelude !== null;
    const font = atrule === "font-face";
    const start = loc.start.offset;
    const end = loc.end.offset;

    if (node.type === "Url") {
      const token = locateUrlContent(css, start, end);
      if (!token) return;
      found.push({
        value: node.value,
        kind: inImportPrelude && !this.function ? "import" : "asset",
        font,
        ...token,
      });
      return;
    }

    if (node.type === "String") {
      const fn = this.function?.name.toLowerCase();
      let kind: CssOccurrence["kind"] | null = null;
      if (inImportPrelude && !this.function) kind = "import";
      else if (fn && IMAGE_SET_FUNCTIONS.has(fn)) kind = "asset";
      if (!kind) return;
      const quote = css[start];
      if (quote !== '"' && quote !== "'") return;
      const close = endOfString(css, start, end);
      const closed = css[close - 1] === quote && close - 1 > start;
      found.push({
        value: node.value,
        kind,
        font,
        contentStart: start + 1,
        contentEnd: closed ? close - 1 : close,
        quote,
      });
      return;
    }

    // Raw: trecho que o css-tree não entendeu (hacks, propriedades --custom…).
    if (this.rule && this.rule.prelude === node) return; // seletor
    scanText(css, start, end, inImportPrelude, font, found);
  });

  return found;
}

/** Localiza o conteúdo de um `url(...)` cujo texto vai de `start` a `end`. */
function locateUrlContent(
  css: string,
  start: number,
  end: number,
): Pick<CssOccurrence, "contentStart" | "contentEnd" | "quote"> | null {
  const open = css.indexOf("(", start);
  if (open < 0 || open >= end) return null;
  let i = open + 1;
  while (i < end && isWhitespace(css.charCodeAt(i))) i++;
  const ch = css[i];
  if (ch === '"' || ch === "'") {
    const close = endOfString(css, i, end);
    const contentEnd = css[close - 1] === ch && close - 1 > i ? close - 1 : close;
    return { contentStart: i + 1, contentEnd, quote: ch };
  }
  let j = end;
  if (css[j - 1] === ")") j--;
  while (j > i && isWhitespace(css.charCodeAt(j - 1))) j--;
  return { contentStart: i, contentEnd: j, quote: "" };
}

/**
 * Leitor simples (sem css-tree) de `url(...)` e `@import "..."` num trecho do
 * texto. Pula comentários e strings; ignora `url-prefix(` e afins.
 */
function scanText(
  css: string,
  start: number,
  end: number,
  importMode: boolean,
  font: boolean,
  out: CssOccurrence[],
): void {
  let pendingImport = importMode;
  let i = start;
  while (i < end) {
    const ch = css[i];
    if (ch === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      i = close < 0 || close + 2 > end ? end : close + 2;
      continue;
    }
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const close = endOfString(css, i, end);
      if (pendingImport) {
        const closed = css[close - 1] === ch && close - 1 > i;
        const contentEnd = closed ? close - 1 : close;
        out.push({
          value: decodeCssEscapes(css.slice(i + 1, contentEnd)),
          kind: "import",
          font,
          contentStart: i + 1,
          contentEnd,
          quote: ch,
        });
        pendingImport = false;
      }
      i = close;
      continue;
    }
    if ((ch === "u" || ch === "U") && css.slice(i, i + 4).toLowerCase() === "url(" && !isIdentChar(css[i - 1])) {
      const token = readUrlToken(css, i, end);
      if (token.occurrence) {
        out.push({ ...token.occurrence, kind: pendingImport ? "import" : "asset", font });
      }
      pendingImport = false;
      i = token.end;
      continue;
    }
    if (ch === "@" && css.slice(i, i + 7).toLowerCase() === "@import" && !isIdentChar(css[i + 7])) {
      pendingImport = true;
      i += 7;
      continue;
    }
    if (ch === ";" || ch === "{" || ch === "}") pendingImport = false;
    i++;
  }
}

/** Lê um `url(` a partir de `start`; devolve o fim do token e a ocorrência (se válida). */
function readUrlToken(
  css: string,
  start: number,
  end: number,
): { end: number; occurrence?: Omit<CssOccurrence, "kind" | "font"> } {
  let i = start + 4;
  while (i < end && isWhitespace(css.charCodeAt(i))) i++;
  const q = css[i];
  if (q === '"' || q === "'") {
    const close = endOfString(css, i, end);
    const closed = css[close - 1] === q && close - 1 > i;
    const contentEnd = closed ? close - 1 : close;
    let j = close;
    while (j < end && isWhitespace(css.charCodeAt(j))) j++;
    if (!closed || css[j] !== ")") return { end: close };
    return {
      end: j + 1,
      occurrence: {
        value: decodeCssEscapes(css.slice(i + 1, contentEnd)),
        contentStart: i + 1,
        contentEnd,
        quote: q,
      },
    };
  }
  const contentStart = i;
  while (i < end) {
    const c = css[i];
    if (c === ")") {
      return {
        end: i + 1,
        occurrence: {
          value: decodeCssEscapes(css.slice(contentStart, i)),
          contentStart,
          contentEnd: i,
          quote: "",
        },
      };
    }
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (isWhitespace(css.charCodeAt(i))) {
      const contentEnd = i;
      while (i < end && isWhitespace(css.charCodeAt(i))) i++;
      if (css[i] === ")") {
        return {
          end: i + 1,
          occurrence: {
            value: decodeCssEscapes(css.slice(contentStart, contentEnd)),
            contentStart,
            contentEnd,
            quote: "",
          },
        };
      }
      return { end: skipBadUrl(css, i, end) };
    }
    if (c === '"' || c === "'" || c === "(") return { end: skipBadUrl(css, i, end) };
    i++;
  }
  return { end };
}

/** Pula o resto de um url() inválido (até o próximo ")"). */
function skipBadUrl(css: string, i: number, end: number): number {
  while (i < end) {
    if (css[i] === "\\") {
      i += 2;
      continue;
    }
    if (css[i] === ")") return i + 1;
    i++;
  }
  return end;
}

/** Índice logo após a aspa de fechamento da string que começa em `start`. */
function endOfString(css: string, start: number, end: number): number {
  const quote = css[start];
  let i = start + 1;
  while (i < end) {
    const c = css[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    if (c === "\n" || c === "\r" || c === "\f") return i; // string quebrada termina na linha
    i++;
  }
  return end;
}

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c;
}

function isIdentChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\w-]/.test(ch);
}

/** Resolve escapes do CSS (`\31 `, `\"`, quebra de linha escapada). */
export function decodeCssEscapes(value: string): string {
  if (!value.includes("\\")) return value;
  return value.replace(
    /\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|(\r\n|[\n\r\f])|([\s\S]))/g,
    (_m, hex: string | undefined, newline: string | undefined, char: string | undefined) => {
      if (hex) {
        const code = Number.parseInt(hex, 16);
        if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
        return String.fromCodePoint(code);
      }
      if (newline) return "";
      return char ?? "";
    },
  );
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Referências de um CSS, resolvidas contra a URL do próprio CSS (não da
 * página). Ignora data:, `#fragmento`, `@namespace` e `behavior:`. Sem
 * repetições.
 */
export function collectCssRefs(css: string, cssUrl: string, opts: CssOptions = {}): CssRef[] {
  const seen = new Map<string, CssRef>();
  for (const occ of findCssOccurrences(css, opts)) {
    const url = absolutize(occ.value, cssUrl);
    if (!isHttpUrl(url)) continue;
    const key = `${occ.kind} ${url}`;
    const prev = seen.get(key);
    if (prev) {
      if (occ.font) prev.font = true;
      continue;
    }
    seen.set(key, occ.font ? { url, kind: occ.kind, font: true } : { url, kind: occ.kind });
  }
  return [...seen.values()];
}

/** Função de troca: recebe a URL absoluta e devolve o novo endereço, ou null para manter. */
export type CssUrlMap = (absUrl: string) => string | null;

/**
 * Troca as referências do CSS para as quais `map` devolve um valor. Todo o
 * resto (comentários, hacks, espaços, aspas) fica igual. O `#fragmento`
 * original é mantido quando o novo endereço não tem um.
 */
export function rewriteCss(css: string, cssUrl: string, map: CssUrlMap, opts: CssOptions = {}): string {
  return rewriteCssWith(css, cssUrl, (absUrl) => map(absUrl), opts);
}

/** Versão interna de `rewriteCss` que também entrega a ocorrência para o `map`. */
export function rewriteCssWith(
  css: string,
  baseUrl: string,
  map: (absUrl: string, occ: CssOccurrence) => string | null,
  opts: CssOptions = {},
): string {
  const occurrences = findCssOccurrences(css, opts);
  if (!occurrences.length) return css;
  let out = "";
  let last = 0;
  let changed = false;
  for (const occ of occurrences) {
    const abs = absolutize(occ.value, baseUrl);
    if (!isHttpUrl(abs)) continue;
    const replacement = map(abs, occ);
    if (replacement == null) continue;
    const fragment = replacement.includes("#") ? "" : fragmentOf(occ.value);
    out += css.slice(last, occ.contentStart) + encodeCssValue(replacement + fragment, occ.quote);
    last = occ.contentEnd;
    changed = true;
  }
  return changed ? out + css.slice(last) : css;
}

/** Escreve um valor no lugar do conteúdo original, respeitando as aspas usadas. */
function encodeCssValue(value: string, quote: CssOccurrence["quote"]): string {
  if (quote === "") {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: caracteres proibidos em url() sem aspas
    if (!/[\s"'()\\\u0000-\u001f\u007f]/.test(value)) return value;
    return `"${escapeCssString(value, '"')}"`;
  }
  return escapeCssString(value, quote);
}

function escapeCssString(value: string, quote: '"' | "'"): string {
  let out = "";
  for (const ch of value) {
    if (ch === "\\" || ch === quote) out += `\\${ch}`;
    else if (ch === "\n") out += "\\a ";
    else if (ch === "\r") out += "\\d ";
    else if (ch === "\f") out += "\\c ";
    else out += ch;
  }
  return out;
}
