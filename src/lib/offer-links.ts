/**
 * Links da oferta aplicados às páginas.
 *
 * Um botão ligado a um link da oferta guarda só a chave: data-os-link="checkout".
 * Na prévia e no ZIP, o href (ou data-os-href/action) recebe a URL atual do link.
 */
import * as cheerio from "cheerio";
import { restoreDoctype } from "@/lib/doctype";
import { PAY_ATTR } from "@/lib/payments/contract";
import { SLUG_MAX, slugify } from "@/lib/text";

export const LINK_ATTR = "data-os-link";

export interface OfferLinkValue {
  key: string;
  url: string;
  /**
   * "Pagamento na página" com o produto salvo: o botão abre a janela de
   * pagamento (data-os-pay), não vai a endereço nenhum.
   */
  pay?: boolean;
}

/** O link leva a algum lugar: endereço preenchido ou pagamento na página. */
export function linkHasDestination(link: { url: string; pay?: boolean }): boolean {
  return Boolean(link.pay) || Boolean(link.url.trim());
}

/**
 * Chave estável a partir do nome ("Checkout principal" → "checkout-principal").
 * Nunca passa de SLUG_MAX, nem com o sufixo de nome repetido ("-2"): a chave
 * de um link de pagamento precisa caber no PRODUCT_KEY_RE.
 */
export function linkKey(label: string, taken: Iterable<string>) {
  const used = new Set(taken);
  const root = slugify(label) || "link";
  if (!used.has(root)) return root;
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    const candidate = `${root.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Troca o destino de todo elemento ligado a um link da oferta. Link de
 * pagamento na página: o elemento ganha data-os-pay="<chave>" (a janela de
 * pagamento abre no clique, src/runtime), o <a> fica com href="#" e os outros
 * perdem o data-os-href — nada leva ao checkout antigo do site clonado.
 */
export function applyOfferLinks(html: string, links: OfferLinkValue[]) {
  if (!html.includes(LINK_ATTR)) return html;
  const byKey = new Map(links.filter((l) => l.url && !l.pay).map((l) => [l.key, l.url]));
  const pay = new Set(links.filter((l) => l.pay).map((l) => l.key));
  const $ = cheerio.load(html);
  $(`[${LINK_ATTR}]`).each((_, el) => {
    const node = $(el);
    const key = node.attr(LINK_ATTR) ?? "";
    if (pay.has(key)) {
      node.attr(PAY_ATTR, key);
      if (el.tagName === "a" || el.tagName === "area") node.attr("href", "#");
      node.removeAttr("data-os-href");
      return;
    }
    const url = byKey.get(key);
    if (!url) return;
    if (el.tagName === "a" || el.tagName === "area") node.attr("href", url);
    else if (el.tagName === "form") node.attr("action", url);
    else node.attr("data-os-href", url);
  });
  return restoreDoctype($.html(), html);
}

/**
 * Para onde o elemento leva ao ser clicado (mesma regra do script das páginas e
 * de destinationOf em src/lib/find-replace.ts): <a>/<area> usam o href, ou o
 * data-os-href se o href for vazio, "#" ou "javascript:"; <form> usa o action;
 * os demais, data-os-href.
 */
function destinationOf(tagName: string, attrs: Record<string, string> | undefined): string | undefined {
  const href = attrs?.href?.trim();
  const osHref = attrs?.["data-os-href"]?.trim() || undefined;
  if (tagName === "a" || tagName === "area") {
    return href && href !== "#" && !/^javascript:/i.test(href) ? href : osHref;
  }
  if (tagName === "form") return attrs?.action?.trim() || osHref;
  return osHref;
}

/**
 * Liga ao link da oferta todo elemento cujo destino é `url` (usado ao salvar um
 * clone: cada checkout detectado vira um link da oferta).
 */
export function bindUrlToLink(html: string, url: string, key: string) {
  const $ = cheerio.load(html);
  let count = 0;
  const same = (value: string | undefined) => {
    if (!value) return false;
    try {
      return new URL(value).href === new URL(url).href;
    } catch {
      return value === url;
    }
  };
  $("a[href], area[href], [data-os-href], form[action]").each((_, el) => {
    const node = $(el);
    if (same(destinationOf(el.tagName, node.attr()))) {
      node.attr(LINK_ATTR, key);
      count++;
    }
  });
  return { html: count ? restoreDoctype($.html(), html) : html, count };
}
