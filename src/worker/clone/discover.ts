/**
 * Clonar o funil inteiro: as páginas do MESMO site a que a página clonada
 * leva — a próxima etapa do quiz, a roleta, a loja, a página de cada produto,
 * upsell, obrigado… Cada uma vira uma clonagem filha (services/clone-funnel.ts).
 *
 * Fontes, da mais forte para a mais fraca:
 * - `click`: o robô clicou pela página (explore.ts) e ela navegou para lá;
 * - `code`: o endereço está no código da página — `location.href = "/roleta"`,
 *   `window.open(…)`, `navigate("/loja")`, rotas `path: "/produto/x"`,
 *   `href:`/`to:` de componentes, endereços absolutos do próprio site — nos
 *   scripts inline, nos on* e nos scripts do próprio site capturados;
 * - `link`: <a>/<area>/[onclick]/[data-href] no HTML (cartão de produto marcado).
 *
 * Fora sempre: outros sites (o checkout é tratado à parte), arquivos, páginas
 * legais/institucionais, login/conta/carrinho/busca/API, âncoras e a própria
 * página. Funções puras (sem rede, sem banco).
 */
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { nameKey } from "@/lib/text";
import { spacedText } from "./classify";
import {
  ASSET_EXT,
  classify,
  cleanUrl,
  EXCLUDED_PATH,
  EXCLUDED_TEXT,
  normalizeLabel,
  onclickTarget,
  pagePath,
  registrableDomain,
} from "./funnel";
import { documentBase, isElement } from "./html-assets";
import { isSyntheticOrigin } from "./synthetic";
import type { PageLinkFound } from "./types";

/** Máximo de páginas guardadas por página clonada. */
export const LINKS_MAX = 80;
/** Código lido por página: cada script e o total (scripts enormes de bibliotecas não ajudam). */
export const CODE_FILE_MAX = 3 * 1024 * 1024;
export const CODE_TOTAL_MAX = 8 * 1024 * 1024;

/**
 * Caminhos que não são etapas do funil para seguir: busca, lista de desejos,
 * API, pastas de arquivos, páginas de erro, área de membros/administração.
 * (Legais, login, conta e carrinho já ficam de fora por EXCLUDED_PATH.)
 */
const CRAWL_EXCLUDED_PATH =
  /(?:^|\/)(?:busca|buscar|search|pesquisa|wishlist|favoritos|lista-de-desejos|api|wp-json|graphql|wp-content|wp-includes|cdn-cgi|_next|static|assets|404|500|feed|rss|sitemap[^/]*|robots\.txt|xmlrpc\.php|admin|administrador|dashboard|painel|area-de-membros|membros|members|logout|sair|cadastro|register|signup|sign-up|recuperar-senha|esqueci-a-senha|password-reset)(?=$|[/?#._-])/i;

const SKIP_SCHEME = /^(?:mailto|tel|sms|whatsapp|javascript|data|blob|about|intent|file|os-page):/i;
/** Preço escrito na página (cartão de produto). */
const PRICE_RE = /(?:R\$|US\$|MX\$|\$|€|£)\s?\d|\d[\d.,]*\s?(?:€|reais\b)/i;

interface Scope {
  base: string;
  domain: string;
  /** host + caminho da própria página (não é link para seguir). */
  pageKey: string;
  checkouts: Set<string>;
}

function scopeOf($: CheerioAPI, pageUrl: string, checkoutUrls: Iterable<string>): Scope | null {
  if (isSyntheticOrigin(pageUrl)) return null;
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return null;
  }
  if (page.protocol !== "http:" && page.protocol !== "https:") return null;
  const checkouts = new Set<string>();
  for (const url of checkoutUrls) {
    const clean = cleanUrl(url, pageUrl);
    if (clean) checkouts.add(clean);
  }
  return {
    base: documentBase($, pageUrl),
    domain: registrableDomain(page.hostname),
    pageKey: `${page.hostname.toLowerCase()}${pagePath(page)}`,
    checkouts,
  };
}

/** Endereço que vale seguir (mesmo site, página de verdade), já limpo; senão null. */
function followable(raw: string | undefined, base: string, scope: Scope): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed.startsWith("#") || SKIP_SCHEME.test(trimmed) || trimmed.includes("${")) return null;
  const clean = cleanUrl(trimmed, base);
  if (!clean) return null;
  const url = new URL(clean);
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (isSyntheticOrigin(clean)) return null;
  if (registrableDomain(url.hostname) !== scope.domain) return null;
  const path = pagePath(url);
  if (`${url.hostname.toLowerCase()}${path}` === scope.pageKey) return null;
  if (scope.checkouts.has(clean)) return null;
  if (ASSET_EXT.test(path) || EXCLUDED_PATH.test(path) || CRAWL_EXCLUDED_PATH.test(path)) return null;
  return clean;
}

const NAV_SELECTOR = "header, nav, footer, [role=navigation], [role=banner], [role=contentinfo]";
const NAME_SELECTOR =
  "h1, h2, h3, h4, h5, h6, [class*=title], [class*=Title], [class*=name], [class*=Name], [class*=nome], [class*=titulo]";

function text(_$: CheerioAPI, el: Element): string {
  return spacedText([el]);
}

function ownLabel($: CheerioAPI, el: Element): string {
  const $el = $(el);
  return normalizeLabel(
    text($, el) || $el.attr("title") || $el.attr("aria-label") || $el.find("img[alt]").attr("alt") || "",
  );
}

/** Destino de um elemento clicável (href, data-href ou onclick simples). */
function targetOf($: CheerioAPI, el: Element): string | undefined {
  const $el = $(el);
  if (el.tagName === "a" || el.tagName === "area") return $el.attr("href");
  return $el.attr("data-href") ?? $el.attr("data-url") ?? $el.attr("data-link") ?? onclickTarget($el.attr("onclick"));
}

/**
 * Cartão de produto: o link (ou o bloco ao redor dele, até 4 níveis, que só
 * leva ao mesmo endereço) tem foto e preço. Devolve o nome do produto.
 */
function productCard($: CheerioAPI, el: Element, url: string, scope: Scope): string | null {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 5; depth++) {
    const $node = $(node);
    // O bloco não pode levar a outros lugares (senão é uma seção, não um cartão).
    // Conferido antes do texto: numa seção grande, ler o texto inteiro custa caro.
    const targets = new Set<string>();
    for (const a of $node
      .find("a[href], [data-href], [onclick]")
      .addBack("a[href], [data-href], [onclick]")
      .toArray()) {
      if (!isElement(a)) continue;
      const t = followable(targetOf($, a), scope.base, scope);
      if (t) targets.add(t);
    }
    if (targets.size > 1 || (targets.size === 1 && !targets.has(url))) return null;
    const content = text($, node);
    if (content.length > 600) return null;
    const hasImage = $node.find("img, picture, [style*=background-image]").addBack("img").length > 0;
    if (hasImage && PRICE_RE.test(content)) {
      const heading = $node
        .find(NAME_SELECTOR)
        .toArray()
        .filter(isElement)
        .map((h) => text($, h))
        .find((t) => t && !PRICE_RE.test(t) && t.length <= 160);
      const alt = $node.find("img[alt]").attr("alt")?.trim();
      return normalizeLabel(heading || alt || content.replace(PRICE_RE, " ").split(/(?:R\$|US\$|MX\$|\$|€)/)[0] || "");
    }
    node = node.parent && isElement(node.parent) ? node.parent : null;
  }
  return null;
}

// ─── Código ──────────────────────────────────────────────────────────────────

/** Valor entre aspas sem escapes (os "\/" do JSON são trocados antes). */
const VALUE = String.raw`(["'\x60])([^"'\x60\\\s<>{}]{1,200})\1`;
/** Navegação explícita: location, window.open, navigate(), router.push(), history.push(), redirect(). */
const NAV_CALL_RE = new RegExp(
  String.raw`(?:\blocation(?:\.href)?\s*=|\blocation\.(?:assign|replace)\s*\(|\bwindow\.open\s*\(|\bnavigate(?:To)?\s*\(|\brouter\.(?:push|replace)\s*\(|\bhistory\.(?:push|replace)(?:State)?\s*\((?:[^,()]{0,40},\s*){0,2}|\bredirect(?:To)?\s*\()\s*${VALUE}`,
  "g",
);
/** Propriedades com destino: href:"/x", to:"/x", path:"/x" (rotas), redirect, próxima página… */
const NAV_PROP_RE = new RegExp(
  String.raw`["']?\b(?:href|to|url|link|path|redirect|redirectTo|redirectUrl|nextUrl|next_url|nextPage|next_page|next|destination|destino|proxima|proximaPagina|proxima_pagina|goTo|goto)["']?\s*:\s*${VALUE}`,
  "g",
);
/** Endereço absoluto escrito no código (o domínio é conferido depois). */
const ABS_URL_RE = /https?:\/\/[^\s"'`<>\\(){}[\],;|^]+/gi;
/** Caminho que parece página: "/roleta", "./loja", "/produto/camiseta-azul", "obrigado.html". */
const PATHISH_RE = /^(?:\.{0,2}\/[\w\-.~%/]*|[\w-]+\.html?)(?:\?[\w\-.~%=&]*)?$/;

/** Endereços de páginas no código: explícitos (navegação) primeiro, depois propriedades e absolutos. */
export function pathsInCode(code: string): { url: string; strong: boolean }[] {
  const src = code.replace(/\\\//g, "/").replace(/\\u002[fF]/g, "/");
  const out = new Map<string, boolean>();
  const add = (value: string, strong: boolean) => {
    const v = value.trim();
    if (!v || v === "/" || v === "./" || v.includes("*") || v.includes("${")) return;
    const absolute = /^https?:\/\//i.test(v);
    if (!absolute && (v.includes(":") || !PATHISH_RE.test(v))) return;
    // Rota com parâmetro (":id") nunca é um endereço de verdade.
    if (/\/:/.test(v)) return;
    if (out.get(v) !== true) out.set(v, strong || (out.get(v) ?? false));
  };
  for (const m of src.matchAll(NAV_CALL_RE)) add(m[2] ?? "", true);
  for (const m of src.matchAll(NAV_PROP_RE)) add(m[2] ?? "", false);
  for (const m of src.matchAll(ABS_URL_RE)) add(m[0].replace(/[.!?:]+$/, ""), false);
  return [...out].map(([url, strong]) => ({ url, strong }));
}

export interface CodeSource {
  text: string;
}

// ─── Junção ──────────────────────────────────────────────────────────────────

/** Ordem de prioridade (quem entra primeiro na fila do funil). */
function rank(link: PageLinkFound): number {
  if (link.via === "click") return 0;
  if (link.kind) return 1;
  if (link.product) return 2;
  if (link.via === "code") return 3;
  if (!link.nav) return 4;
  return 5;
}

export interface DiscoverInput {
  /** DOM renderizado (com os scripts inline ainda no lugar). */
  $: CheerioAPI;
  pageUrl: string;
  /** Checkouts detectados (ficam de fora). */
  checkoutUrls: Iterable<string>;
  /** Scripts do próprio site capturados (texto). */
  scripts?: CodeSource[];
  /** Navegações do robô (clique); `product`: cartão de vitrine aberto pelo robô. */
  clicks?: { url: string; label: string; product?: boolean }[];
}

/**
 * Páginas do mesmo site a que esta página leva, na ordem em que devem ser
 * clonadas (clique do robô → upsell/downsell/obrigado → produtos → código →
 * links do conteúdo → cabeçalho/rodapé), sem repetir, no máximo LINKS_MAX.
 */
export function discoverPageLinks(input: DiscoverInput): PageLinkFound[] {
  const { $, pageUrl } = input;
  const scope = scopeOf($, pageUrl, input.checkoutUrls);
  if (!scope) return [];
  const byUrl = new Map<string, PageLinkFound>();
  const add = (link: PageLinkFound) => {
    const prev = byUrl.get(link.url);
    if (!prev) {
      byUrl.set(link.url, link);
      return;
    }
    // A mesma página achada de outro jeito: fica a fonte mais forte, com as marcas das duas.
    const merged: PageLinkFound = rank(link) < rank(prev) ? { ...prev, ...link } : { ...link, ...prev };
    merged.nav = Boolean(prev.nav && link.nav);
    merged.product = Boolean(prev.product || link.product) || undefined;
    if (!merged.nav) delete merged.nav;
    if (!merged.product) delete merged.product;
    merged.kind = prev.kind ?? link.kind;
    if (!merged.kind) delete merged.kind;
    // Nome do produto (do cartão) vale mais que o texto do clique ou do link.
    const named = [prev, link].find((l) => l.product && l.label);
    merged.label = named?.label || merged.label || prev.label || link.label;
    byUrl.set(link.url, merged);
  };

  for (const nav of input.clicks ?? []) {
    const url = followable(nav.url, pageUrl, scope);
    if (url) add({ url, label: normalizeLabel(nav.label), via: "click", ...(nav.product ? { product: true } : {}) });
  }

  for (const el of $("a[href], area[href], [onclick], [data-href], [data-url], [data-link]").toArray()) {
    if (!isElement(el)) continue;
    const url = followable(targetOf($, el), scope.base, scope);
    if (!url) continue;
    const label = ownLabel($, el);
    if (EXCLUDED_TEXT.test(nameKey(label))) continue;
    const link: PageLinkFound = { url, label: label || pagePath(new URL(url)), via: "link" };
    if ($(el).closest(NAV_SELECTOR).length) link.nav = true;
    const product = productCard($, el, url, scope);
    if (product !== null) {
      link.product = true;
      if (product) link.label = product;
    }
    const u = new URL(url);
    const sub = u.hostname.toLowerCase().slice(0, -scope.domain.length).replace(/\.$/, "");
    const found = classify(`${sub}${pagePath(u)}`, label);
    if (found) link.kind = found.kind;
    add(link);
  }

  // Código: scripts inline, on* (fora os já lidos acima) e os scripts do próprio site.
  const sources: string[] = [];
  for (const el of $("script").toArray()) {
    if (!isElement(el)) continue;
    const type = ($(el).attr("type") ?? "").toLowerCase();
    if ($(el).attr("src") || (type && !/javascript|ecmascript|module|json|babel/.test(type))) continue;
    sources.push($(el).text());
  }
  let total = 0;
  for (const s of input.scripts ?? []) {
    if (s.text.length > CODE_FILE_MAX || total + s.text.length > CODE_TOTAL_MAX) continue;
    total += s.text.length;
    sources.push(s.text);
  }
  for (const code of sources) {
    for (const found of pathsInCode(code)) {
      // Navegação no código é relativa ao endereço da página (não ao do script).
      const url = followable(found.url, pageUrl, scope);
      if (!url) continue;
      if (!found.strong && !byUrl.has(url) && !/^https?:/i.test(found.url) && !looksLikePage(found.url)) continue;
      add({ url, label: pagePath(new URL(url)), via: "code" });
    }
  }

  return [...byUrl.values()]
    .map((link, i) => ({ link, i }))
    .sort((a, b) => rank(a.link) - rank(b.link) || a.i - b.i)
    .slice(0, LINKS_MAX)
    .map((x) => x.link);
}

/**
 * Propriedade solta (href/to/path…) só conta como página com cara de etapa:
 * um ou dois pedaços de caminho com letras ("/roleta", "/produto/camiseta").
 */
function looksLikePage(value: string): boolean {
  const path = value.replace(/^\.{0,2}\//, "/").split("?")[0];
  const segs = path.split("/").filter(Boolean);
  return segs.length >= 1 && segs.length <= 3 && segs.every((s) => /[a-z]/i.test(s) && s.length <= 80);
}
