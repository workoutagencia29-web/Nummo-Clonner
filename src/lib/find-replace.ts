/**
 * Localizar e substituir + destinos de clique (links e checkouts).
 *
 * As mesmas regras valem em três lugares:
 * - no editor (GrapesJS), na página aberta — cada troca é um passo de desfazer;
 * - no JSON do projeto guardado no banco (troca em todas as páginas da oferta);
 * - no HTML final guardado junto (idem).
 *
 * Regras:
 * - Procura nos textos visíveis e nos atributos de SEARCH_ATTRIBUTES; nunca em
 *   nomes de tags/atributos, scripts, estilos ou no <head>.
 * - Maiúsculas e minúsculas contam como iguais; acentos, opcional (ação = acao).
 * - No JSON, só valores de texto conhecidos mudam (parse → percorre → stringify):
 *   o resultado continua sendo um projeto válido.
 * - O cheerio é carregado sob demanda (só o servidor usa as funções de HTML), para
 *   não pesar no editor.
 */
import type { AnyNode, Element, Text as TextNode } from "domhandler";
import type { Component, Editor } from "grapesjs";
import { restoreDoctype } from "@/lib/doctype";

// ─── Busca de texto ──────────────────────────────────────────────────────────

export interface TextRange {
  start: number;
  end: number;
}

export interface FindOptions {
  /** "acao" encontra "ação" (e vice-versa). */
  accentInsensitive?: boolean;
  /**
   * Nos textos (nunca em endereços), o texto novo segue as maiúsculas do trecho
   * encontrado: "COMPRE" → "GARANTA", "Compre" → "Garanta".
   */
  preserveCase?: boolean;
}

export interface Matcher {
  readonly query: string;
  readonly accentInsensitive: boolean;
  readonly preserveCase: boolean;
  /** Ocorrências (sem sobreposição) no texto, em posições do texto original. */
  ranges(text: string): TextRange[];
}

const MARKS_RE = /\p{M}/gu;
const MARK_RE = /^\p{M}/u;

function foldChar(ch: string, accentInsensitive: boolean) {
  const base = accentInsensitive ? ch.normalize("NFD").replace(MARKS_RE, "") : ch;
  return base.toLowerCase();
}

interface Folded {
  text: string;
  /** Início, no texto original, do caractere que gerou cada posição dobrada. */
  starts: number[];
  /** Fim, no texto original (inclui acentos soltos que vieram logo depois). */
  ends: number[];
  /** A posição dobrada é a primeira/última gerada pelo seu caractere original. */
  first: boolean[];
  last: boolean[];
}

function fold(text: string, accentInsensitive: boolean): Folded {
  const out: Folded = { text: "", starts: [], ends: [], first: [], last: [] };
  let pos = 0;
  let groupStart = -1;
  for (const ch of text) {
    const end = pos + ch.length;
    const folded = foldChar(ch, accentInsensitive);
    if (!folded.length) {
      // Acento solto (texto decomposto): fica grudado no caractere anterior.
      for (let k = Math.max(groupStart, 0); groupStart >= 0 && k < out.ends.length; k++) out.ends[k] = end;
    } else {
      groupStart = out.text.length;
      for (let j = 0; j < folded.length; j++) {
        out.starts.push(pos);
        out.ends.push(end);
        out.first.push(j === 0);
        out.last.push(j === folded.length - 1);
      }
      out.text += folded;
    }
    pos = end;
  }
  return out;
}

/** Texto como a busca enxerga (minúsculas e, opcionalmente, sem acentos). */
export function foldText(text: string, accentInsensitive = false) {
  return fold(text, accentInsensitive).text;
}

/** Cria o localizador. Devolve null para busca vazia (ou só espaços). */
export function createMatcher(query: string, opts: FindOptions = {}): Matcher | null {
  if (!query || !query.trim()) return null;
  const accentInsensitive = !!opts.accentInsensitive;
  const needle = fold(query, accentInsensitive).text;
  if (!needle) return null;
  return {
    query,
    accentInsensitive,
    preserveCase: !!opts.preserveCase,
    ranges(text: string) {
      if (!text) return [];
      const hay = fold(text, accentInsensitive);
      const found: TextRange[] = [];
      let from = 0;
      for (;;) {
        const idx = hay.text.indexOf(needle, from);
        if (idx < 0) break;
        const lastIdx = idx + needle.length - 1;
        const start = hay.starts[idx];
        const end = hay.ends[lastIdx];
        // Só aceita ocorrências que começam e terminam em caracteres inteiros
        // (nunca parte de uma letra acentuada decomposta).
        if (hay.first[idx] && hay.last[lastIdx] && !MARK_RE.test(text.slice(end))) {
          found.push({ start, end });
          from = idx + needle.length;
        } else {
          from = idx + 1;
        }
      }
      return found;
    },
  };
}

const LETTERS_RE = /\p{L}/gu;
const LEADING_LETTER_RE = /^(\s*)(\p{L})/u;

function isUpper(s: string) {
  return s === s.toUpperCase() && s !== s.toLowerCase();
}

/**
 * Ajusta as maiúsculas do texto novo ao trecho encontrado: tudo maiúsculo
 * ("COMPRE" → "GARANTA") ou primeira letra maiúscula ("Compre" → "Garanta").
 * Nos outros casos, fica como foi digitado.
 */
export function adaptCase(matched: string, replacement: string) {
  const letters = (matched.match(LETTERS_RE) ?? []).join("");
  if (!letters) return replacement;
  if (letters.length > 1 && isUpper(letters)) return replacement.toUpperCase();
  // Só quando o texto novo começa com letra ("3x sem juros" fica como está).
  if (isUpper(letters[0]))
    return replacement.replace(LEADING_LETTER_RE, (_, space: string, c: string) => space + c.toUpperCase());
  return replacement;
}

/**
 * Troca os trechos indicados (em ordem, sem sobreposição) pelo texto novo.
 * Com `keepCase`, o texto novo segue as maiúsculas de cada trecho.
 */
export function replaceRanges(text: string, ranges: TextRange[], replacement: string, keepCase = false) {
  if (!ranges.length) return text;
  let out = "";
  let pos = 0;
  for (const r of ranges) {
    out += text.slice(pos, r.start) + (keepCase ? adaptCase(text.slice(r.start, r.end), replacement) : replacement);
    pos = r.end;
  }
  return out + text.slice(pos);
}

/** Tipo do valor: textos seguem "manter maiúsculas"; endereços nunca. */
export type ValueKind = "text" | "url";

export function replaceAllText(text: string, matcher: Matcher, replacement: string, kind: ValueKind = "text") {
  const ranges = matcher.ranges(text);
  const keepCase = matcher.preserveCase && kind === "text";
  return { text: replaceRanges(text, ranges, replacement, keepCase), count: ranges.length };
}

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

/** Trecho em volta da ocorrência, para mostrar na lista de resultados. */
export function contextSnippet(text: string, range: TextRange, radius = 40): Snippet {
  const squash = (s: string) => s.replace(/\s+/g, " ");
  let before = squash(text.slice(Math.max(0, range.start - radius), range.start));
  let after = squash(text.slice(range.end, range.end + radius));
  if (range.start > radius) before = `…${before.replace(/^\S*\s/, "")}`;
  if (range.end + radius < text.length) after = `${after.replace(/\s\S*$/, "")}…`;
  return { before, match: squash(text.slice(range.start, range.end)), after };
}

// ─── Onde procurar ───────────────────────────────────────────────────────────

export interface SearchTargets {
  /** Textos visíveis da página. */
  text: boolean;
  /** Endereços, imagens, textos alternativos, dicas, textos de exemplo. */
  attributes: boolean;
}

export const ALL_TARGETS: SearchTargets = { text: true, attributes: true };

/** Atributos em que a busca procura (os demais nunca mudam). */
export const SEARCH_ATTRIBUTES = ["href", "data-os-href", "src", "alt", "title", "action", "placeholder"] as const;
const SEARCH_ATTRIBUTE_SET = new Set<string>(SEARCH_ATTRIBUTES);
/** Atributos que guardam endereços (a troca nunca mexe nas maiúsculas deles). */
const URL_ATTRIBUTES = new Set(["href", "data-os-href", "src", "action"]);

export function valueKindOfAttribute(name: string): ValueKind {
  return URL_ATTRIBUTES.has(name.toLowerCase()) ? "url" : "text";
}
const BUTTON_INPUT_TYPES = new Set(["submit", "button", "reset"]);

/** Conteúdo que nunca é tocado (código, estilos, cabeçalho). */
const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "os-script", "os-noscript", "head", "title"]);
const SKIP_TYPES = new Set(["os-script", "os-noscript", "script", "style", "comment"]);

type Attrs = Record<string, unknown>;

/** O atributo entra na busca? (value só em botões <input type="submit">). */
export function isSearchableAttribute(tag: string, name: string, attrs: Attrs) {
  const lower = name.toLowerCase();
  if (SEARCH_ATTRIBUTE_SET.has(lower)) return true;
  return lower === "value" && tag === "input" && BUTTON_INPUT_TYPES.has(String(attrs.type ?? "").toLowerCase());
}

/** Troca nos atributos pesquisáveis. Devolve só os atributos que mudaram. */
export function replaceInAttributes(tag: string, attrs: Attrs, matcher: Matcher, replacement: string) {
  const changes: Record<string, string> = {};
  let count = 0;
  for (const [name, value] of Object.entries(attrs)) {
    if (typeof value !== "string" || !isSearchableAttribute(tag, name, attrs)) continue;
    const r = replaceAllText(value, matcher, replacement, valueKindOfAttribute(name));
    if (r.count) {
      changes[name] = r.text;
      count += r.count;
    }
  }
  return { changes, count };
}

async function loadCheerio() {
  return (await import("cheerio")).load;
}

function isTag(node: AnyNode): node is Element {
  return node.type === "tag";
}

function isTextNode(node: AnyNode): node is TextNode {
  return node.type === "text";
}

/**
 * Troca no HTML (servidor). Documento completo: só dentro do <body>. Com
 * `fragment`, o HTML é um pedaço (conteúdo de um componente do editor).
 * Sem ocorrências, devolve o HTML original intacto.
 */
export async function replaceInHtml(
  html: string,
  matcher: Matcher,
  replacement: string,
  targets: SearchTargets = ALL_TARGETS,
  opts: { fragment?: boolean } = {},
) {
  if (!html) return { html, count: 0 };
  const load = await loadCheerio();
  const $ = opts.fragment ? load(html, null, false) : load(html);
  let count = 0;

  const visit = (node: AnyNode) => {
    if (isTextNode(node)) {
      if (!targets.text) return;
      const r = replaceAllText(node.data, matcher, replacement);
      if (r.count) {
        node.data = r.text;
        count += r.count;
      }
      return;
    }
    if (!isTag(node)) return;
    const tag = node.name.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    if (targets.attributes) {
      const r = replaceInAttributes(tag, node.attribs, matcher, replacement);
      Object.assign(node.attribs, r.changes);
      count += r.count;
    }
    for (const child of node.children) visit(child);
  };

  const body = opts.fragment ? null : $("body").get(0);
  const roots = body ? body.children : ($.root().get(0)?.children ?? []);
  for (const node of roots) visit(node);
  if (!count) return { html, count };
  // O cheerio reescreve qualquer doctype como <!DOCTYPE html>: volta o original
  // (páginas antigas dependem do modo quirks/quase-padrão).
  return { html: opts.fragment ? $.html() : restoreDoctype($.html(), html), count };
}

// ─── JSON do projeto (GrapesJS) ──────────────────────────────────────────────

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Tag padrão de cada tipo quando o JSON não traz tagName (o GrapesJS omite o padrão). */
const TYPE_TAGS: Record<string, string> = {
  link: "a",
  image: "img",
  video: "video",
  "os-video": "video",
  "os-embed": "iframe",
  iframe: "iframe",
  map: "iframe",
  script: "script",
  "os-script": "os-script",
  "os-noscript": "os-noscript",
  textnode: "",
  comment: "",
  wrapper: "body",
  table: "table",
  row: "tr",
  cell: "td",
  thead: "thead",
  tbody: "tbody",
  tfoot: "tfoot",
  label: "label",
  svg: "svg",
};

function jsonTag(node: Json) {
  if (typeof node.tagName === "string" && node.tagName) return node.tagName.toLowerCase();
  const type = typeof node.type === "string" ? node.type : "";
  return TYPE_TAGS[type] ?? "div";
}

interface ProjectVisitor {
  /** Cada componente (inclusive textnodes), já sem scripts/estilos/<head>. */
  component(node: Json, tag: string, type: string): void;
  /** Trecho de HTML guardado como texto (content ou components em string). */
  html?(holder: Json | unknown[], key: string | number, value: string): void;
}

function walkComponentJson(node: unknown, visitor: ProjectVisitor, holder: Json | unknown[], key: string | number) {
  if (typeof node === "string") {
    if (node) visitor.html?.(holder, key, node);
    return;
  }
  if (!isJson(node)) return;
  const type = typeof node.type === "string" ? node.type : "";
  const tag = jsonTag(node);
  if (SKIP_TYPES.has(type) || SKIP_TAGS.has(tag)) return;
  // O próprio wrapper representa o <body>: só os filhos contam.
  if (type !== "wrapper") visitor.component(node, tag, type);
  const children = node.components;
  if (Array.isArray(children)) {
    children.forEach((child, i) => {
      walkComponentJson(child, visitor, children, i);
    });
  } else if (typeof children === "string") {
    if (children) visitor.html?.(node, "components", children);
  }
  const hasChildren = Array.isArray(children) ? children.length > 0 : typeof children === "string" && !!children;
  if (!hasChildren && type !== "textnode" && typeof node.content === "string" && node.content) {
    visitor.html?.(node, "content", node.content);
  }
}

/** Percorre os componentes de todas as páginas (e símbolos) de um projeto do editor. */
export function walkProject(project: unknown, visitor: ProjectVisitor) {
  if (!isJson(project)) return;
  const pages = Array.isArray(project.pages) ? project.pages : [];
  for (const page of pages) {
    if (!isJson(page)) continue;
    const frames = Array.isArray(page.frames) ? page.frames : [];
    for (const frame of frames) {
      if (isJson(frame)) walkComponentJson(frame.component, visitor, frame, "component");
    }
    if (page.component !== undefined) walkComponentJson(page.component, visitor, page, "component");
  }
  const symbols = project.symbols;
  if (Array.isArray(symbols)) {
    symbols.forEach((symbol, i) => {
      walkComponentJson(symbol, visitor, symbols, i);
    });
  }
}

function setAt(holder: Json | unknown[], key: string | number, value: unknown) {
  if (Array.isArray(holder)) holder[Number(key)] = value;
  else holder[String(key)] = value;
}

/**
 * Troca no projeto do editor (textos e atributos pesquisáveis). Não altera o
 * objeto recebido: devolve uma cópia.
 */
export async function replaceInProject(
  project: unknown,
  matcher: Matcher,
  replacement: string,
  targets: SearchTargets = ALL_TARGETS,
) {
  const copy: unknown = structuredClone(project);
  let count = 0;
  const htmlJobs: { holder: Json | unknown[]; key: string | number; value: string }[] = [];

  walkProject(copy, {
    component(node, tag, type) {
      if (type === "textnode") {
        if (targets.text && typeof node.content === "string") {
          const r = replaceAllText(node.content, matcher, replacement);
          if (r.count) {
            node.content = r.text;
            count += r.count;
          }
        }
        return;
      }
      if (!targets.attributes) return;
      // Imagem: a propriedade src vale mais que o atributo (o editor exporta a propriedade).
      const hasSrcProp = typeof node.src === "string" && !node.src.startsWith("<svg");
      if (hasSrcProp) {
        const r = replaceAllText(node.src as string, matcher, replacement, "url");
        if (r.count) {
          node.src = r.text;
          count += r.count;
        }
      }
      if (isJson(node.attributes)) {
        const attrs = node.attributes;
        const r = replaceInAttributes(tag, attrs, matcher, replacement);
        // Com a propriedade src, o atributo é só uma cópia: troca, mas conta uma vez só.
        const duplicated = hasSrcProp && typeof attrs.src === "string" ? matcher.ranges(attrs.src).length : 0;
        Object.assign(attrs, r.changes);
        count += r.count - duplicated;
      }
    },
    html(holder, key, value) {
      htmlJobs.push({ holder, key, value });
    },
  });

  for (const job of htmlJobs) {
    const r = await replaceInHtml(job.value, matcher, replacement, targets, { fragment: true });
    if (r.count) {
      setAt(job.holder, job.key, r.html);
      count += r.count;
    }
  }
  return { project: copy, count };
}

// ─── Destinos de clique ──────────────────────────────────────────────────────

export const OFFER_LINK_ATTR = "data-os-link";
export const PAGE_LINK_PREFIX = "os-page:";

export type DestinationAttr = "href" | "data-os-href" | "action";

export interface Destination {
  attr: DestinationAttr;
  url: string;
}

function attrText(attrs: Attrs, name: string) {
  const v = attrs[name];
  return typeof v === "string" ? v.trim() : "";
}

/** "#" sozinho e javascript: não levam a lugar nenhum. */
function isVoidHref(href: string) {
  return href === "#" || /^javascript:/i.test(href);
}

/**
 * Para onde o elemento leva ao ser clicado (sem contar o link da oferta).
 * <a>: href (ou data-os-href se o href for vazio/"#"); <form>: action; demais: data-os-href.
 */
export function destinationOf(tag: string, attrs: Attrs): Destination | null {
  const href = attrText(attrs, "href");
  const osHref = attrText(attrs, "data-os-href");
  if (tag === "a" || tag === "area") {
    if (href && !isVoidHref(href)) return { attr: "href", url: href };
    if (osHref) return { attr: "data-os-href", url: osHref };
    return null;
  }
  if (tag === "form") {
    const action = attrText(attrs, "action");
    if (action) return { attr: "action", url: action };
  }
  return osHref ? { attr: "data-os-href", url: osHref } : null;
}

/** Atributo que guarda o destino quando o elemento ainda não tem um. */
export function defaultDestinationAttr(tag: string): DestinationAttr {
  if (tag === "a" || tag === "area") return "href";
  if (tag === "form") return "action";
  return "data-os-href";
}

/**
 * Chave de agrupamento de endereços: host em minúsculas, porta padrão removida,
 * "//x.com" = "https://x.com", "https://x.com" = "https://x.com/". Âncoras,
 * páginas do funil e endereços relativos ficam como estão (sem espaços nas pontas).
 */
export function normalizeUrlKey(raw: string) {
  const url = raw.trim();
  if (!url || url.startsWith("#")) return url;
  if (/^os-page:/i.test(url)) return `${PAGE_LINK_PREFIX}${url.slice(PAGE_LINK_PREFIX.length)}`;
  const scheme = /^(mailto|tel|sms|whatsapp):/i.exec(url);
  if (scheme) return `${scheme[1].toLowerCase()}:${url.slice(scheme[0].length)}`;
  const absolute = url.startsWith("//") ? `https:${url}` : url;
  if (/^https?:\/\//i.test(absolute)) {
    try {
      return new URL(absolute).href;
    } catch {
      return url;
    }
  }
  return url;
}

/** Completa o endereço digitado ("pay.hotmart.com/x" → "https://pay.hotmart.com/x"). */
export function completeUrl(input: string) {
  const v = input.trim();
  if (!v) return "";
  if (/^(https?|mailto|tel|sms|whatsapp|os-page):/i.test(v)) return v;
  if (/^(#|\/(?!\/)|\.\.?\/|\?)/.test(v)) return v;
  if (v.startsWith("//")) return `https:${v}`;
  if (/^[^\s/]+\.[^\s/]{2,}/.test(v)) return `https://${v}`;
  return v;
}

/**
 * "unlinked": botão de compra ainda sem destino — tem o atributo data-os-link
 * vazio (modelos e blocos de checkout) e nenhum endereço (href vazio ou "#").
 */
export type LinkKind = "offer-link" | "unlinked" | "funnel-page" | "anchor" | "email" | "phone" | "url";

/** Tipo do destino a partir do endereço (a plataforma de checkout é vista no servidor). */
export function linkKindOf(url: string): Exclude<LinkKind, "offer-link" | "unlinked"> {
  const v = url.trim();
  if (v.toLowerCase().startsWith(PAGE_LINK_PREFIX)) return "funnel-page";
  if (v.startsWith("#")) return "anchor";
  if (/^mailto:/i.test(v)) return "email";
  if (/^(tel|sms):/i.test(v)) return "phone";
  return "url";
}

/** Quais elementos uma operação de link atinge. */
export type LinkMatch =
  /** Elementos NÃO ligados a link da oferta cujo destino é este endereço. */
  | { kind: "url"; url: string }
  /**
   * Elementos ligados ao link da oferta com esta chave. Com a chave vazia: botões
   * de compra ainda sem link (atributo data-os-link vazio e nenhum destino).
   */
  | { kind: "link"; key: string };

export type LinkOp =
  /** Liga ao link da oferta (data-os-link="<chave>"). */
  | { type: "bind"; key: string }
  /** Troca o endereço de destino. */
  | { type: "set-url"; url: string }
  /** Desliga do link da oferta; com `url`, grava esse endereço como destino fixo. */
  | { type: "unbind"; url?: string };

/**
 * Botão de compra ainda sem link: data-os-link presente e vazio, e nenhum
 * destino (formulários sem destino têm o próprio aviso e ficam de fora).
 */
export function isUnlinkedButton(tag: string, attrs: Attrs) {
  if (tag === "form") return false;
  return OFFER_LINK_ATTR in attrs && !attrText(attrs, OFFER_LINK_ATTR) && !destinationOf(tag, attrs);
}

export function linkMatches(tag: string, attrs: Attrs, match: LinkMatch) {
  const key = attrText(attrs, OFFER_LINK_ATTR);
  if (match.kind === "link") {
    // attrText devolve "" tanto para o atributo vazio quanto para a falta dele:
    // a chave vazia só pega quem TEM o atributo (botões sem link), nunca todo o resto.
    return match.key ? key === match.key : isUnlinkedButton(tag, attrs);
  }
  if (key) return false;
  const dest = destinationOf(tag, attrs);
  return !!dest && normalizeUrlKey(dest.url) === normalizeUrlKey(match.url);
}

/** Aplica a operação nos atributos (altera o objeto). Devolve true se mudou algo. */
export function applyLinkOp(tag: string, attrs: Attrs, op: LinkOp) {
  if (op.type === "bind") {
    if (attrs[OFFER_LINK_ATTR] === op.key) return false;
    attrs[OFFER_LINK_ATTR] = op.key;
    return true;
  }
  // <a>/<area>: o endereço novo vai sempre no href. O script da página ignora o
  // data-os-href de um <a href> (e a prévia/ZIP gravam o link da oferta no href).
  const attr =
    tag === "a" || tag === "area" ? "href" : (destinationOf(tag, attrs)?.attr ?? defaultDestinationAttr(tag));
  if (op.type === "set-url") {
    if (attrs[attr] === op.url) return false;
    attrs[attr] = op.url;
    return true;
  }
  let changed = false;
  if (OFFER_LINK_ATTR in attrs) {
    delete attrs[OFFER_LINK_ATTR];
    changed = true;
  }
  if (op.url && attrs[attr] !== op.url) {
    attrs[attr] = op.url;
    changed = true;
  }
  return changed;
}

/** Operação de link no HTML final (só no <body>). */
export async function applyLinkOpToHtml(html: string, match: LinkMatch, op: LinkOp) {
  if (!html) return { html, count: 0 };
  const load = await loadCheerio();
  const $ = load(html);
  let count = 0;
  const visit = (node: AnyNode) => {
    if (!isTag(node)) return;
    const tag = node.name.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    if (linkMatches(tag, node.attribs, match) && applyLinkOp(tag, node.attribs, op)) count++;
    for (const child of node.children) visit(child);
  };
  for (const node of $("body").get(0)?.children ?? []) visit(node);
  return { html: count ? restoreDoctype($.html(), html) : html, count };
}

/** Operação de link no projeto do editor (devolve uma cópia). */
export function applyLinkOpToProject(project: unknown, match: LinkMatch, op: LinkOp) {
  const copy: unknown = structuredClone(project);
  let count = 0;
  walkProject(copy, {
    component(node, tag, type) {
      if (type === "textnode") return;
      const attrs: Attrs = isJson(node.attributes) ? node.attributes : {};
      if (!linkMatches(tag, attrs, match)) return;
      if (applyLinkOp(tag, attrs, op)) {
        node.attributes = attrs;
        count++;
      }
    },
  });
  return { project: copy, count };
}

// ─── Nomes para a tela ───────────────────────────────────────────────────────

const TAG_LABELS: Record<string, string> = {
  a: "Link",
  area: "Área de link",
  button: "Botão",
  img: "Imagem",
  h1: "Título (H1)",
  h2: "Título (H2)",
  h3: "Título (H3)",
  h4: "Título (H4)",
  h5: "Título (H5)",
  h6: "Título (H6)",
  p: "Parágrafo",
  span: "Texto",
  li: "Item de lista",
  ul: "Lista",
  ol: "Lista",
  form: "Formulário",
  input: "Campo",
  textarea: "Campo de texto",
  select: "Lista de opções",
  option: "Opção",
  label: "Rótulo",
  iframe: "Vídeo / incorporação",
  video: "Vídeo",
  source: "Vídeo",
  section: "Seção",
  header: "Cabeçalho",
  footer: "Rodapé",
  nav: "Menu",
  strong: "Negrito",
  b: "Negrito",
  em: "Itálico",
  i: "Itálico",
  u: "Sublinhado",
  s: "Riscado",
  del: "Riscado",
  small: "Texto pequeno",
  mark: "Destaque",
  blockquote: "Citação",
  td: "Célula",
  th: "Célula",
  figure: "Figura",
  figcaption: "Legenda",
  svg: "Ícone",
  div: "Bloco",
};

/** Nome amigável do elemento ("Botão", "Título (H2)"…). */
export function describeElement(tag: string, attrs: Attrs = {}) {
  if (tag === "input" && BUTTON_INPUT_TYPES.has(String(attrs.type ?? "").toLowerCase())) return "Botão";
  return TAG_LABELS[tag] ?? "Elemento";
}

/** Nome amigável do lugar onde o texto foi encontrado. */
export function describeAttribute(tag: string, name: string) {
  switch (name) {
    case "href":
      return tag === "a" ? "Endereço do link" : "Endereço";
    case "data-os-href":
      return "Endereço ao clicar";
    case "src":
      if (tag === "img") return "Arquivo da imagem";
      if (tag === "iframe") return "Endereço do vídeo";
      if (tag === "video" || tag === "source") return "Arquivo do vídeo";
      return "Arquivo";
    case "alt":
      return "Texto alternativo da imagem";
    case "title":
      return "Dica ao passar o mouse";
    case "action":
      return "Envio do formulário";
    case "placeholder":
      return "Texto de exemplo do campo";
    case "value":
      return "Texto do botão";
    default:
      return name;
  }
}

// ─── Editor (GrapesJS) ───────────────────────────────────────────────────────

type MatchPlace = { kind: "text" } | { kind: "attr"; name: string };

export type MatchField =
  /** Conteúdo de um textnode. */
  | { kind: "text" }
  /** Atributo do componente. */
  | { kind: "attr"; name: string }
  /** Propriedade src de uma imagem. */
  | { kind: "src" }
  /** HTML guardado em `content` (blocos): n-ésima ocorrência dentro dele. */
  | { kind: "content"; nth: number; inner: MatchPlace };

export interface EditorMatch {
  /** Identificador estável enquanto a página não muda. */
  id: string;
  /** Elemento a selecionar no canvas. */
  component: Component;
  /** Componente que guarda o valor (textnode ou o próprio elemento). */
  target: Component;
  field: MatchField;
  /** Texto onde a ocorrência está (para o trecho de contexto). */
  value: string;
  range: TextRange;
  /** Valor guardado no campo quando a busca foi feita (para saber se ficou velho). */
  source: string;
  /** "Botão", "Parágrafo"… */
  element: string;
  /** "Texto", "Endereço do link"… */
  where: string;
  /** Link da oferta ligado ao elemento (o endereço dele vale mais que o href). */
  linkKey: string | null;
}

function tagOf(comp: Component) {
  return String(comp.get("tagName") ?? "").toLowerCase();
}

function typeOf(comp: Component) {
  return String(comp.get("type") ?? "");
}

function attrsOf(comp: Component): Attrs {
  const attrs: unknown = comp.get("attributes");
  return isJson(attrs) ? attrs : {};
}

function childrenOf(comp: Component): Component[] {
  return [...comp.components().models];
}

function walkEditor(editor: Editor, visit: (comp: Component, tag: string, type: string) => void) {
  const wrapper = editor.getWrapper();
  if (!wrapper) return;
  const walk = (comp: Component) => {
    const type = typeOf(comp);
    const tag = tagOf(comp);
    if (SKIP_TYPES.has(type) || SKIP_TAGS.has(tag)) return;
    visit(comp, tag, type);
    for (const child of childrenOf(comp)) walk(child);
  };
  for (const child of childrenOf(wrapper)) walk(child);
}

/** Primeiro ancestral que pode ser selecionado (textnodes não podem). */
function selectableOf(comp: Component) {
  let current: Component | undefined = comp;
  while (current && (current.get("selectable") === false || typeOf(current) === "textnode")) current = current.parent();
  return current ?? comp;
}

function imageSrc(comp: Component) {
  const src: unknown = comp.get("src");
  return typeof src === "string" && src && !src.startsWith("<svg") ? src : null;
}

function componentLabel(comp: Component) {
  const custom: unknown = comp.get("name");
  if (typeof custom === "string" && custom.trim()) return custom.trim();
  return describeElement(tagOf(comp), attrsOf(comp));
}

// Pedaços de HTML (content) são lidos com o DOM do navegador.

type FragmentVisitor = (value: string, place: MatchPlace, tag: string, write: (next: string) => void) => void;

function eachFragmentValue(root: ParentNode, targets: SearchTargets, cb: FragmentVisitor, parentTag = "") {
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 3) {
      if (!targets.text) continue;
      const text = node as Text;
      cb(text.data, { kind: "text" }, parentTag, (next) => {
        text.data = next;
      });
    } else if (node.nodeType === 1) {
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      if (targets.attributes) {
        const attrs: Attrs = {};
        for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
        for (const a of Array.from(el.attributes)) {
          if (!isSearchableAttribute(tag, a.name, attrs)) continue;
          cb(a.value, { kind: "attr", name: a.name }, tag, (next) => el.setAttribute(a.name, next));
        }
      }
      eachFragmentValue(el, targets, cb, tag);
    }
  }
}

function parseFragment(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template;
}

interface FragmentHit {
  value: string;
  range: TextRange;
  place: MatchPlace;
  tag: string;
}

/** Ocorrências dentro de um pedaço de HTML (navegador). */
export function findInFragment(html: string, matcher: Matcher, targets: SearchTargets = ALL_TARGETS) {
  const hits: FragmentHit[] = [];
  eachFragmentValue(parseFragment(html).content, targets, (value, place, tag) => {
    for (const range of matcher.ranges(value)) hits.push({ value, range, place, tag });
  });
  return hits;
}

/** Troca num pedaço de HTML (navegador): todas as ocorrências ou só a n-ésima. */
export function replaceInFragment(
  html: string,
  matcher: Matcher,
  replacement: string,
  targets: SearchTargets = ALL_TARGETS,
  nth?: number,
) {
  const template = parseFragment(html);
  let seen = 0;
  let count = 0;
  eachFragmentValue(template.content, targets, (value, place, _tag, write) => {
    const ranges = matcher.ranges(value);
    const first = seen;
    seen += ranges.length;
    if (!ranges.length) return;
    const chosen = nth === undefined ? ranges : nth >= first && nth < seen ? [ranges[nth - first]] : [];
    if (!chosen.length) return;
    const kind = place.kind === "text" ? "text" : valueKindOfAttribute(place.name);
    write(replaceRanges(value, chosen, replacement, matcher.preserveCase && kind === "text"));
    count += chosen.length;
  });
  return { html: count ? template.innerHTML : html, count };
}

/** Procura na página aberta no editor. */
export function findInEditor(editor: Editor, matcher: Matcher, targets: SearchTargets = ALL_TARGETS): EditorMatch[] {
  const out: EditorMatch[] = [];
  const push = (
    target: Component,
    field: MatchField,
    value: string,
    range: TextRange,
    source: string,
    where: string,
    index: number,
  ) => {
    const component = selectableOf(target);
    const fieldId =
      field.kind === "attr" ? `attr:${field.name}` : field.kind === "content" ? `content:${field.nth}` : field.kind;
    out.push({
      id: `${target.ccid}:${fieldId}:${index}`,
      component,
      target,
      field,
      value,
      range,
      source,
      element: componentLabel(component),
      where,
      linkKey: attrText(attrsOf(component), OFFER_LINK_ATTR) || null,
    });
  };

  walkEditor(editor, (comp, tag, type) => {
    if (type === "textnode") {
      if (!targets.text) return;
      const value = String(comp.get("content") ?? "");
      matcher.ranges(value).forEach((range, i) => {
        push(comp, { kind: "text" }, value, range, value, "Texto", i);
      });
      return;
    }
    if (targets.attributes) {
      const attrs = attrsOf(comp);
      // Imagem: a propriedade src vale mais que o atributo (é ela que o editor exporta).
      const src = type === "image" ? imageSrc(comp) : null;
      const pushSrc = (value: string) => {
        matcher.ranges(value).forEach((range, i) => {
          push(comp, { kind: "src" }, value, range, value, describeAttribute("img", "src"), i);
        });
      };
      for (const [name, value] of Object.entries(attrs)) {
        if (src !== null && name === "src") {
          pushSrc(src);
          continue;
        }
        if (typeof value !== "string" || !isSearchableAttribute(tag, name, attrs)) continue;
        matcher.ranges(value).forEach((range, i) => {
          push(comp, { kind: "attr", name }, value, range, value, describeAttribute(tag, name), i);
        });
      }
      if (src !== null && !("src" in attrs)) pushSrc(src);
    }
    const content: unknown = comp.get("content");
    if (!comp.components().length && typeof content === "string" && content) {
      findInFragment(content, matcher, targets).forEach((hit, nth) => {
        const where = hit.place.kind === "text" ? "Texto" : describeAttribute(hit.tag, hit.place.name);
        push(comp, { kind: "content", nth, inner: hit.place }, hit.value, hit.range, content, where, nth);
      });
    }
  });
  return out;
}

function renderTextnode(comp: Component) {
  for (const view of comp.views ?? []) view.render();
}

/**
 * Imagem: só a propriedade src (como faz o próprio gerenciador de imagens do
 * GrapesJS). Mudar o atributo junto quebraria o "Refazer": o toJSON da imagem
 * omite src quando é igual ao atributo, e o refazer voltaria só o atributo.
 */
function setImageSrc(comp: Component, src: string) {
  comp.set("src", src);
}

/**
 * Troca UMA ocorrência. Devolve 0 se a página mudou desde a busca (procure de novo).
 */
export function replaceMatchInEditor(
  match: EditorMatch,
  matcher: Matcher,
  replacement: string,
  targets: SearchTargets = ALL_TARGETS,
) {
  const { target, field } = match;
  switch (field.kind) {
    case "text": {
      const value = String(target.get("content") ?? "");
      if (value !== match.source) return 0;
      target.set("content", replaceRanges(value, [match.range], replacement, matcher.preserveCase));
      renderTextnode(target);
      return 1;
    }
    case "attr": {
      const value = attrsOf(target)[field.name];
      if (value !== match.source) return 0;
      const keepCase = matcher.preserveCase && valueKindOfAttribute(field.name) === "text";
      target.addAttributes({ [field.name]: replaceRanges(value, [match.range], replacement, keepCase) });
      return 1;
    }
    case "src": {
      const value = imageSrc(target);
      if (value !== match.source) return 0;
      setImageSrc(target, replaceRanges(value, [match.range], replacement));
      return 1;
    }
    case "content": {
      const value: unknown = target.get("content");
      if (value !== match.source) return 0;
      const r = replaceInFragment(match.source, matcher, replacement, targets, field.nth);
      if (r.count) target.set("content", r.html);
      return r.count;
    }
  }
}

/**
 * Troca todas as ocorrências da página aberta. Tudo acontece de uma vez (mesma
 * pilha de chamadas), então o "Desfazer" do editor volta tudo num passo só.
 */
export function replaceAllInEditor(
  editor: Editor,
  matcher: Matcher,
  replacement: string,
  targets: SearchTargets = ALL_TARGETS,
) {
  let count = 0;
  walkEditor(editor, (comp, tag, type) => {
    if (type === "textnode") {
      if (!targets.text) return;
      const r = replaceAllText(String(comp.get("content") ?? ""), matcher, replacement);
      if (r.count) {
        comp.set("content", r.text);
        renderTextnode(comp);
        count += r.count;
      }
      return;
    }
    if (targets.attributes) {
      const attrs = attrsOf(comp);
      const src = type === "image" ? imageSrc(comp) : null;
      const r = replaceInAttributes(tag, attrs, matcher, replacement);
      if (src !== null) delete r.changes.src;
      const attrCount = src !== null ? r.count - matcher.ranges(String(attrs.src ?? "")).length : r.count;
      if (Object.keys(r.changes).length) comp.addAttributes(r.changes);
      count += attrCount;
      if (src !== null) {
        const s = replaceAllText(src, matcher, replacement, "url");
        if (s.count) {
          setImageSrc(comp, s.text);
          count += s.count;
        }
      }
    }
    const content: unknown = comp.get("content");
    if (!comp.components().length && typeof content === "string" && content) {
      const r = replaceInFragment(content, matcher, replacement, targets);
      if (r.count) {
        comp.set("content", r.html);
        count += r.count;
      }
    }
  });
  return count;
}

/**
 * Ajustes no editor para as trocas funcionarem também no desfazer/refazer:
 * - o GrapesJS não redesenha textnodes quando o conteúdo muda;
 * - no "Refazer" de uma imagem, só o atributo src volta (a propriedade, que é o
 *   que o editor exporta, ficaria com o endereço velho).
 * Devolve a função que remove os ouvintes.
 */
export function installEditorSync(editor: Editor) {
  const onContent = (comp: Component) => {
    if (typeOf(comp) === "textnode") renderTextnode(comp);
  };
  const onAttributes = (comp: Component) => {
    if (typeOf(comp) !== "image") return;
    const src = attrsOf(comp).src;
    if (typeof src === "string" && src && src !== comp.get("src")) comp.set("src", src, { avoidStore: true });
  };
  editor.on("component:update:content", onContent);
  editor.on("component:update:attributes", onAttributes);
  return () => {
    editor.off("component:update:content", onContent);
    editor.off("component:update:attributes", onAttributes);
  };
}

// ─── Links da página aberta ──────────────────────────────────────────────────

export interface LinkItem {
  component: Component;
  /** Texto do botão/link (ou descrição da imagem). */
  label: string;
  destination: Destination | null;
}

export interface LinkGroup {
  /** "link:<chave>", "url:<endereço normalizado>" ou "unlinked" (botões sem link). */
  id: string;
  kind: LinkKind;
  match: LinkMatch;
  /** Endereço como está no primeiro elemento ("" em links da oferta sem destino próprio). */
  url: string;
  linkKey: string | null;
  /** ID da página (links do funil). */
  pageId: string | null;
  items: LinkItem[];
}

const LABEL_MAX = 60;

/** Texto visível de um componente (para identificar botões na lista). */
export function componentText(comp: Component): string {
  const parts: string[] = [];
  let imageAlt = "";
  const walk = (c: Component) => {
    const type = typeOf(c);
    const tag = tagOf(c);
    if (SKIP_TYPES.has(type) || SKIP_TAGS.has(tag)) return;
    if (type === "textnode") {
      parts.push(String(c.get("content") ?? ""));
      return;
    }
    if (tag === "img" || type === "image") {
      imageAlt ||= attrText(attrsOf(c), "alt") || "imagem";
      return;
    }
    if (tag === "input") {
      parts.push(attrText(attrsOf(c), "value"));
      return;
    }
    const kids = childrenOf(c);
    const content: unknown = c.get("content");
    if (!kids.length && typeof content === "string") parts.push(content.replace(/<[^>]*>/g, " "));
    for (const kid of kids) walk(kid);
  };
  walk(comp);
  let text = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!text && imageAlt) text = `[${imageAlt}]`;
  return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text;
}

/** Todos os destinos de clique da página aberta, agrupados (ordem de aparição). */
export function collectLinkGroups(editor: Editor): LinkGroup[] {
  const groups = new Map<string, LinkGroup>();
  walkEditor(editor, (comp, tag, type) => {
    if (type === "textnode") return;
    const attrs = attrsOf(comp);
    const key = attrText(attrs, OFFER_LINK_ATTR);
    const destination = destinationOf(tag, attrs);
    let id: string;
    let group: Omit<LinkGroup, "items">;
    if (!key && !destination) {
      // Botões de compra dos modelos/blocos ainda sem link: são os que mais
      // precisam aparecer aqui (para ligar ao checkout).
      if (!isUnlinkedButton(tag, attrs)) return;
      id = "unlinked";
      group = { id, kind: "unlinked", match: { kind: "link", key: "" }, url: "", linkKey: null, pageId: null };
    } else if (key) {
      id = `link:${key}`;
      group = {
        id,
        kind: "offer-link",
        match: { kind: "link", key },
        url: destination?.url ?? "",
        linkKey: key,
        pageId: null,
      };
    } else if (destination) {
      const normalized = normalizeUrlKey(destination.url);
      const kind = linkKindOf(destination.url);
      id = `url:${normalized}`;
      group = {
        id,
        kind,
        match: { kind: "url", url: destination.url },
        url: destination.url,
        linkKey: null,
        pageId: kind === "funnel-page" ? destination.url.trim().slice(PAGE_LINK_PREFIX.length) : null,
      };
    } else {
      return;
    }
    const existing = groups.get(id) ?? { ...group, items: [] };
    existing.items.push({ component: comp, label: componentText(comp), destination });
    groups.set(id, existing);
  });
  return [...groups.values()];
}

/** Aplica a operação na página aberta (um passo de desfazer). Devolve quantos elementos mudaram. */
export function applyLinkOpInEditor(editor: Editor, match: LinkMatch, op: LinkOp) {
  let count = 0;
  walkEditor(editor, (comp, tag, type) => {
    if (type === "textnode") return;
    const attrs = { ...attrsOf(comp) };
    if (!linkMatches(tag, attrs, match)) return;
    if (applyLinkOp(tag, attrs, op)) {
      comp.setAttributes(attrs);
      count++;
    }
  });
  return count;
}
