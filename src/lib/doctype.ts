/**
 * Doctype das páginas clonadas. O doctype decide o modo de renderização
 * (padrão, quase-padrão ou quirks): páginas antigas feitas em tabelas com
 * fatias de imagem só ficam certas no modo em que foram feitas.
 *
 * O cheerio (parse5) reescreve qualquer doctype como `<!DOCTYPE html>` ao
 * serializar; quem monta HTML com o cheerio devolve o original com
 * `restoreDoctype`. Funções puras (sem rede, sem banco, sem navegador): usadas
 * pelo clonador (build.ts) e pelo painel (salvar a clonagem).
 *
 * O começo do arquivo é lido andando com indexOf (`leadingDoctype`,
 * `xmlProlog`), nunca com uma regex de repetição aninhada: com algumas dezenas
 * de comentários no início, uma regex assim levava minutos e travava o robô, a
 * prévia ou o painel. Um comentário termina no primeiro "-->", como no navegador.
 */

/** Espaços (o mesmo conjunto do \s das regex, que inclui o BOM). */
const SPACE_RE = /\s*/y;

function skipSpace(text: string, from: number): number {
  SPACE_RE.lastIndex = from;
  SPACE_RE.test(text);
  return SPACE_RE.lastIndex;
}

/** `text` tem `word` (sem diferenciar maiúsculas) na posição `at`? */
function startsWithAt(text: string, word: string, at: number): boolean {
  return text.slice(at, at + word.length).toLowerCase() === word;
}

/** Fim de um comentário que começa em `at` (logo depois do "-->"), ou -1 se ele não fecha. */
function commentEnd(text: string, at: number): number {
  const close = text.indexOf("-->", at + 4);
  return close < 0 ? -1 : close + 3;
}

export interface LeadingDoctype {
  /** Onde o doctype começa (depois de BOM, espaços e comentários). */
  start: number;
  /** Logo depois do ">" do doctype. */
  end: number;
  /** O doctype como está no texto. */
  text: string;
}

/**
 * Doctype do começo de um HTML — depois de BOM, espaços e comentários —, em
 * tempo linear. null quando o HTML não começa com um doctype.
 */
export function leadingDoctype(html: string): LeadingDoctype | null {
  let i = 0;
  for (;;) {
    i = skipSpace(html, i);
    if (html.startsWith("<!--", i)) {
      i = commentEnd(html, i);
      if (i < 0) return null;
      continue;
    }
    if (!startsWithAt(html, "<!doctype", i)) return null;
    // "<!doctype" seguido de uma letra/número não é um doctype (ex.: "<!doctypes>").
    if (/\w/.test(html.charAt(i + 9))) return null;
    const close = html.indexOf(">", i + 9);
    if (close < 0) return null;
    return { start: i, end: close + 1, text: html.slice(i, close + 1) };
  }
}

/** Doctype do início de um HTML (depois de BOM, espaços e comentários), ou "". */
export function doctypeOf(html: string): string {
  return leadingDoctype(html)?.text ?? "";
}

/** Posição logo depois do doctype do começo do HTML (0 se não houver). */
export function afterLeadingDoctype(html: string): number {
  return leadingDoctype(html)?.end ?? 0;
}

/**
 * Devolve `html` com o doctype de `source` — ou sem doctype, se `source` não
 * tem. O cheerio (parse5) reescreve qualquer doctype como `<!DOCTYPE html>`,
 * o que tira páginas antigas do modo quirks/quase-padrão e abre frestas entre
 * as fatias de imagem em tabelas.
 */
export function restoreDoctype(html: string, source: string): string {
  const original = doctypeOf(source);
  const current = leadingDoctype(html);
  if (current) {
    // O doctype atual sai junto com os espaços e a quebra de linha logo depois dele.
    const after = /[ \t]*\r?\n?/y;
    after.lastIndex = current.end;
    after.test(html);
    const prolog = html.slice(0, current.start);
    return `${prolog}${original ? `${original}\n` : ""}${html.slice(after.lastIndex)}`;
  }
  return original ? `${original}\n${html}` : html;
}

// ─── XML (SVG) ───────────────────────────────────────────────────────────────

export interface XmlDoctype {
  start: number;
  end: number;
  /** Conteúdo entre "[" e "]" (declarações de entidades), quando houver. */
  subset: string | null;
}

export interface XmlProlog {
  /** Onde o prólogo termina (primeiro caractere que não é espaço, comentário, <?…?> nem DOCTYPE). */
  end: number;
  doctypes: XmlDoctype[];
}

/**
 * Prólogo de um XML (SVG): BOM, espaços, comentários, instruções <?…?> e
 * DOCTYPE (com as declarações entre colchetes), em qualquer ordem — em tempo
 * linear. O que não fecha encerra o prólogo ali.
 */
export function xmlProlog(text: string): XmlProlog {
  const doctypes: XmlDoctype[] = [];
  let i = 0;
  for (;;) {
    const at = skipSpace(text, i);
    let end = -1;
    if (text.startsWith("<!--", at)) {
      end = commentEnd(text, at);
    } else if (text.startsWith("<?", at)) {
      const close = text.indexOf("?>", at + 2);
      end = close < 0 ? -1 : close + 2;
    } else if (startsWithAt(text, "<!doctype", at)) {
      const doctype = xmlDoctypeAt(text, at);
      if (doctype) {
        doctypes.push(doctype);
        end = doctype.end;
      }
    }
    if (end < 0) return { end: at, doctypes };
    i = end;
  }
}

/** DOCTYPE de XML que começa em `at`: até o ">" ou, com "[", até o "]" seguido de ">". */
function xmlDoctypeAt(text: string, at: number): XmlDoctype | null {
  let i = at + 9;
  while (i < text.length && text[i] !== "[" && text[i] !== ">") i++;
  if (i >= text.length) return null;
  if (text[i] === ">") return { start: at, end: i + 1, subset: null };
  const open = i;
  let search = open + 1;
  for (;;) {
    const close = text.indexOf("]", search);
    if (close < 0) return null;
    const gt = skipSpace(text, close + 1);
    if (text[gt] === ">") return { start: at, end: gt + 1, subset: text.slice(open + 1, close) };
    search = close + 1;
  }
}
