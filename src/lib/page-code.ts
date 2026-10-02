/**
 * Códigos livres de uma página (Page.customCode): tipos e funções puras usadas
 * pelo renderizador (prévia e ZIP). As regras de salvar ficam em
 * src/server/services/page-code.ts.
 */
import { type DefaultTreeAdapterMap, parse, parseFragment } from "parse5";

export const PAGE_CODE_FIELDS = ["head", "bodyStart", "bodyEnd"] as const;
export type PageCodeField = (typeof PAGE_CODE_FIELDS)[number];
export type PageCustomCode = Record<PageCodeField, string>;

export const EMPTY_PAGE_CODE: PageCustomCode = { head: "", bodyStart: "", bodyEnd: "" };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lê os três campos do JSON guardado (qualquer formato vira texto ou vazio). */
export function parsePageCode(json: unknown): PageCustomCode {
  const source = isRecord(json) ? json : {};
  const out = { ...EMPTY_PAGE_CODE };
  for (const field of PAGE_CODE_FIELDS) {
    const value = source[field];
    out[field] = typeof value === "string" ? value : "";
  }
  return out;
}

// ─── Código que não fecha ────────────────────────────────────────────────────

type ParsedNode = DefaultTreeAdapterMap["node"];
type ParsedElement = DefaultTreeAdapterMap["element"];

const HTML_NS = "http://www.w3.org/1999/xhtml";
const SENTINEL = "data-os-fim-do-codigo";
/** Elementos cujo conteúdo é texto até a tag de fechamento (com scripts ligados). */
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "noscript", "xmp", "iframe", "noembed", "noframes"]);

function isParsedElement(node: ParsedNode): node is ParsedElement {
  return "tagName" in node;
}

function childrenOf(node: ParsedNode): ParsedNode[] {
  return "childNodes" in node ? (node.childNodes as ParsedNode[]) : [];
}

/**
 * O que ficou aberto num código colado (e engoliria o resto da página, inclusive
 * o script do Offer Studio): um <script> sem </script>, um comentário <!-- sem
 * -->, uma tag sem ">"… Devolve a descrição em português ("um <script> sem
 * </script>") ou null se o código fecha tudo. Tags comuns abertas (<div>) não
 * contam: o navegador fecha sozinho sem esconder nada.
 */
export function unclosedCodePart(code: string): string | null {
  if (!code.trim()) return null;
  // Um <script> logo depois do código: se ele não sai como <script> de verdade, o código engoliu o resto.
  const root = parseFragment(`${code}<script ${SENTINEL}></script>`, { scriptingEnabled: true });
  const isSentinel = (node: ParsedNode) =>
    isParsedElement(node) && node.tagName === "script" && node.attrs.some((a) => a.name === SENTINEL);
  const found = (node: ParsedNode): boolean =>
    (isSentinel(node) && (node as ParsedElement).namespaceURI === HTML_NS) || childrenOf(node).some(found);
  if (found(root)) return null;

  // Onde ele foi parar diz o que ficou aberto.
  let problem: string | null = null;
  const visit = (node: ParsedNode, foreign: string | null, template: boolean) => {
    if (problem) return;
    if (node.nodeName === "#comment" && "data" in node && node.data.includes(SENTINEL)) {
      problem = "um comentário <!-- sem -->";
      return;
    }
    if (node.nodeName === "#text" && "value" in node && node.value.includes(SENTINEL)) {
      const parent = node.parentNode && isParsedElement(node.parentNode) ? node.parentNode.tagName : "";
      problem =
        RAW_TEXT.has(parent) || parent === "plaintext"
          ? `um <${parent}> sem </${parent}>`
          : "uma tag ou comentário sem fechar";
      return;
    }
    if (isParsedElement(node)) {
      if (isSentinel(node)) {
        if (template) problem = "um <template> sem </template>";
        else if (foreign) problem = `um <${foreign}> sem </${foreign}>`;
        return;
      }
      if (
        node.attrs.some((a) => a.name.includes(SENTINEL) || a.value.includes(SENTINEL)) ||
        /[<"'=]/.test(node.tagName)
      ) {
        problem = 'uma tag sem fechar (falta um ">" ou uma aspa)';
        return;
      }
      const nextForeign = foreign ?? (node.namespaceURI !== HTML_NS ? node.tagName : null);
      for (const child of childrenOf(node)) visit(child, nextForeign, template);
      if (node.tagName === "template" && "content" in node) {
        for (const child of childrenOf(node.content as ParsedNode)) visit(child, foreign, true);
      }
      return;
    }
    for (const child of childrenOf(node)) visit(child, foreign, template);
  };
  visit(root, null, false);
  // Sumiu de vez: o navegador descarta uma tag que não termina (sem ">" ou com aspas abertas).
  return problem ?? 'uma tag sem fechar (falta um ">" ou uma aspa)';
}

/** Onde cada código entra no HTML (posições no texto original); null = o elemento não está escrito no HTML. */
interface CodeSpots {
  head: number | null;
  bodyStart: number | null;
  bodyEnd: number | null;
}

/**
 * As posições pelo parser de HTML (o mesmo do navegador), nunca pelo primeiro
 * "<body" ou "</head>" do texto: um comentário condicional antigo
 * (<!--[if IE 8]><body class="ie8"><![endif]-->) ou um "</head>" dentro de um
 * comentário não enganam. Head/body sem a tag de fechamento terminam onde o
 * navegador os fecha.
 */
function codeSpots(html: string): CodeSpots {
  const spots: CodeSpots = { head: null, bodyStart: null, bodyEnd: null };
  const root = parse(html, { sourceCodeLocationInfo: true }).childNodes.find(
    (n): n is ParsedElement => isParsedElement(n) && n.tagName === "html",
  );
  for (const node of root ? root.childNodes : []) {
    const at = isParsedElement(node) ? node.sourceCodeLocation : null;
    if (!at) continue;
    if (node.nodeName === "head") spots.head = at.endTag ? at.endTag.startOffset : at.endOffset;
    if (node.nodeName === "body") {
      if (at.startTag) spots.bodyStart = at.startTag.endOffset;
      spots.bodyEnd = at.endTag ? at.endTag.startOffset : at.endOffset;
    }
  }
  return spots;
}

/**
 * Coloca os códigos no HTML final da página (prévia e ZIP). Puro e idempotente
 * por chamada (não detecta injeção anterior: chame uma vez por renderização).
 * - head: antes de </head>;
 * - bodyStart: logo depois da tag <body …>;
 * - bodyEnd: antes do </body>.
 * As posições vêm do parser (ver codeSpots): o código nunca cai dentro de um
 * comentário, onde o "-->" dele mesmo soltaria o resto antes do consentimento.
 * Só um HTML sem as tags <head>/<body> escritas usa a busca pelo texto (e cria
 * o head ou coloca o código nas pontas).
 * Um código que não fecha (ver unclosedCodePart) fica de fora: ele nunca
 * funcionaria e esconderia o resto da página e o script do Offer Studio. Salvar
 * já recusa esses códigos; isto protege os guardados antes da checagem.
 */
export function injectPageCode(html: string, code: Partial<PageCustomCode> | null | undefined): string {
  if (!code) return html;
  const usable = (value: string | undefined) => {
    const text = value?.trim() ?? "";
    return text && !unclosedCodePart(text) ? text : "";
  };
  const head = usable(code.head);
  const bodyStart = usable(code.bodyStart);
  const bodyEnd = usable(code.bodyEnd);
  if (!head && !bodyStart && !bodyEnd) return html;

  const at = codeSpots(html);
  if ((!head || at.head !== null) && (!bodyStart || at.bodyStart !== null) && (!bodyEnd || at.bodyEnd !== null)) {
    // Do fim para o começo (as posições são do texto original); na mesma
    // posição (body vazio), o início do body vem antes do fim.
    const edits: [number | null, string][] = [
      [bodyEnd ? at.bodyEnd : null, `${bodyEnd}\n`],
      [bodyStart ? at.bodyStart : null, `\n${bodyStart}`],
      [head ? at.head : null, `${head}\n`],
    ];
    edits.sort((a, b) => (b[0] ?? -1) - (a[0] ?? -1));
    let out = html;
    for (const [pos, text] of edits) if (pos !== null) out = `${out.slice(0, pos)}${text}${out.slice(pos)}`;
    return out;
  }
  return injectByText(html, head, bodyStart, bodyEnd);
}

/** HTML sem <head>/<body> escritos (o parser não tem onde apontar): pelo texto, como antes. */
function injectByText(html: string, head: string, bodyStart: string, bodyEnd: string): string {
  let out = html;
  if (head) {
    if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, () => `${head}\n</head>`);
    else if (/<body[\s>]/i.test(out)) out = out.replace(/<body[\s>]/i, (m) => `<head>${head}</head>\n${m}`);
    else out = `${head}\n${out}`;
  }
  if (bodyStart) {
    const open = /<body\b[^>]*>/i.exec(out);
    if (open) {
      const at = open.index + open[0].length;
      out = `${out.slice(0, at)}\n${bodyStart}${out.slice(at)}`;
    } else {
      out = `${bodyStart}\n${out}`;
    }
  }
  if (bodyEnd) {
    const close = out.search(/<\/body>(?![\s\S]*<\/body>)/i);
    out = close >= 0 ? `${out.slice(0, close)}${bodyEnd}\n${out.slice(close)}` : `${out}\n${bodyEnd}`;
  }
  return out;
}
