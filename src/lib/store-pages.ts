/**
 * Loja no HTML salvo das páginas (servidor): o que ainda não leva a lugar
 * nenhum, para os avisos do ZIP (src/server/services/export/plan.ts) e o passo
 * "produtos" do "Próximos passos" (src/lib/readiness.ts):
 *
 * - cartões de produto sem destino (productGaps), por vitrine;
 * - "Ver todas" ligado na vitrine e sem destino (ProductGap.more);
 * - categorias do cabeçalho de loja sem destino cuja busca não mostra nenhum
 *   produto (categoryGaps): o clique de uma categoria assim busca o texto dela
 *   nos produtos da página (ou, numa página sem vitrine, na página da loja — o
 *   destino do logo), com as mesmas regras do script da página
 *   (src/lib/store-search.ts).
 *
 * Um link leva a algum lugar quando tem endereço (href que não é vazio, "#"
 * nem javascript: — a página do produto é "os-page:<id>") ou está ligado a um
 * link da oferta com destino (endereço ou pagamento na página).
 */

import type { Cheerio, CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { INTERNAL_LINK_PREFIX } from "@/lib/internal-links";
import { LINK_ATTR, linkHasDestination } from "@/lib/offer-links";
import { PRODUCT_ATTR } from "@/lib/store";
import { matchesSearch } from "@/lib/store-search";

/** Marca de um cartão de produto no HTML salvo (atalho antes de analisar o HTML). */
export const PRODUCT_MARK = PRODUCT_ATTR;
/** Marca do cabeçalho de loja no HTML salvo. */
export const STORE_HEADER_MARK = 'data-os-widget="store-header"';

const SHOPS = '[data-os-widget="products"]';

type Links = readonly { key: string; url: string; pay?: boolean }[];

export interface ProductGap {
  /** Título da vitrine ("" = sem título). */
  showcase: string;
  /** Posição da vitrine entre as de mesmo título na página (0 = a primeira). */
  index: number;
  /** Cartões sem destino nessa vitrine. */
  count: number;
  /** "Ver todas" ligado e sem destino. */
  more: boolean;
}

/** Endereço que leva a algum lugar (mesma regra de hasDestination no plano do ZIP). */
function leads(href: string | undefined): boolean {
  const v = href?.trim() ?? "";
  return Boolean(v) && v !== "#" && !/^javascript:/i.test(v);
}

/** O link leva a algum lugar (endereço, pagamento na página ou link da oferta com destino)? */
function linkLeads(node: Cheerio<Element>, ok: Set<string>) {
  const key = node.attr(LINK_ATTR) ?? "";
  return (key && ok.has(key)) || node.attr("data-os-pay") !== undefined || leads(node.attr("href"));
}

const linksWithDestination = (links: Links) => new Set(links.filter(linkHasDestination).map((l) => l.key));

const textOf = (node: Cheerio<Element>) => node.text().replace(/\s+/g, " ").trim();

/**
 * Vitrines da página com cartões sem destino ou com o "Ver todas" sem destino,
 * na ordem (uma entrada por vitrine).
 */
export function productGaps(html: string | null | undefined, links: Links): ProductGap[] {
  if (!html?.includes(PRODUCT_MARK)) return [];
  const ok = linksWithDestination(links);
  const $ = cheerio.load(html);
  const out: ProductGap[] = [];
  const seen = new Map<string, number>();
  $(SHOPS).each((_, el) => {
    const shop = $(el);
    const title = textOf(shop.find(".os-pd-title").first());
    const index = seen.get(title) ?? 0;
    seen.set(title, index + 1);
    let count = 0;
    shop.find(`a[${PRODUCT_ATTR}]`).each((_, card) => {
      if (!linkLeads($(card), ok)) count++;
    });
    const moreLink = shop.find("a.os-pd-more").first();
    const more = shop.attr("data-os-show-more") === "1" && moreLink.length > 0 && !linkLeads(moreLink, ok);
    if (count || more) out.push({ showcase: title, index, count, more });
  });
  return out;
}

/** Total de cartões sem destino. */
export const gapCount = (gaps: readonly ProductGap[]) => gaps.reduce((n, g) => n + g.count, 0);

/** Marca da caixa de compra no HTML salvo (página do produto). */
export const PRODUCT_BUY_MARK = 'data-os-widget="product-buy"';
/** Marca do "‹ Voltar para a loja" no HTML salvo (página do produto). */
export const BACK_MARK = "data-os-pd-back";

/**
 * "‹ Voltar para a loja" sem destino numa página cujo logo do cabeçalho de
 * loja também não leva a lugar nenhum (ou sem cabeçalho): para quem chega de
 * fora do site (anúncio, link direto) o clique não leva a lugar nenhum — o
 * script da página só volta no histórico quando a página anterior é do
 * próprio site (src/runtime/product/back.ts).
 */
export function backGap(html: string | null | undefined, links: Links): boolean {
  if (!html?.includes(BACK_MARK)) return false;
  const ok = linksWithDestination(links);
  const $ = cheerio.load(html);
  const lost = $(`a[${BACK_MARK}]`).filter((_, el) => !linkLeads($(el), ok));
  if (!lost.length) return false;
  return !$(`[${STORE_HEADER_MARK}] .os-sh-logo`).filter((_, el) => linkLeads($(el), ok)).length;
}

/**
 * Nomes dos produtos de uma página de produto DESTA vitrine — o "‹ Voltar
 * para a loja" ou o logo do cabeçalho de loja leva à página `storePageId`
 * (como nas páginas criadas pela vitrine): o h1 de cada caixa de compra. []
 * = não é uma página de produto desta vitrine. O editor liga a ela o produto
 * de mesmo nome (productKey) em vez de criar outra página.
 */
export function productPageNames(html: string | null | undefined, storePageId: string): string[] {
  const store = `${INTERNAL_LINK_PREFIX}${storePageId}`;
  if (!html?.includes(PRODUCT_BUY_MARK) || !html.includes(store)) return [];
  const $ = cheerio.load(html);
  const back = $('a[data-os-pd-back], [data-os-widget="store-header"] .os-sh-logo').filter(
    (_, el) => ($(el).attr("href") ?? "").trim() === store,
  );
  if (!back.length) return [];
  const names: string[] = [];
  $(`[${PRODUCT_BUY_MARK}] .os-pb-name`).each((_, el) => {
    const name = textOf($(el));
    if (name && !names.includes(name)) names.push(name);
  });
  return names;
}

/**
 * Junta as vitrines sem destino de vários documentos da MESMA página (versões
 * A/B, layout do celular): a mesma vitrine (mesmo título e mesma posição entre
 * as de mesmo título) conta uma vez, com o maior número.
 */
export function mergeProductGaps(into: ProductGap[], more: readonly ProductGap[]) {
  for (const g of more) {
    const same = into.find((x) => x.showcase === g.showcase && x.index === g.index);
    if (same) {
      same.count = Math.max(same.count, g.count);
      same.more = same.more || g.more;
    } else into.push({ ...g });
  }
  return into;
}

// ─── Categorias do cabeçalho de loja ─────────────────────────────────────────

/** O que a busca da loja enxerga numa página: nome + selo de cada produto e os títulos das vitrines. */
export interface Catalog {
  products: string[];
  titles: string[];
}

function catalogFrom($: CheerioAPI): Catalog {
  const out: Catalog = { products: [], titles: [] };
  $(SHOPS).each((_, el) => {
    const shop = $(el);
    if (shop.attr("data-os-show-title") !== "0") out.titles.push(textOf(shop.find(".os-pd-title").first()));
    const badges = shop.attr("data-os-show-badge") !== "0";
    shop.find(`a[${PRODUCT_ATTR}]`).each((_, card) => {
      const node = $(card);
      out.products.push(
        `${textOf(node.find(".os-pd-name").first())} ${badges ? (node.attr("data-os-pd-badge") ?? "") : ""}`,
      );
    });
  });
  return out;
}

/** Produtos e títulos de vitrine de uma página (null = a página não tem vitrine). */
export function storeCatalog(html: string | null | undefined): Catalog | null {
  if (!html?.includes(PRODUCT_MARK)) return null;
  const catalog = catalogFrom(cheerio.load(html));
  return catalog.products.length || catalog.titles.length ? catalog : null;
}

/** A busca acha alguma coisa em algum desses catálogos (as versões da página)? */
const finds = (catalogs: readonly Catalog[], query: string) =>
  catalogs.some(
    (c) => c.titles.some((t) => matchesSearch(t, query)) || c.products.some((p) => matchesSearch(p, query)),
  );

/**
 * Categorias do cabeçalho de loja (linha ligada) sem destino cuja busca não
 * mostra nenhum produto. Página com vitrine: procura nela. Página sem vitrine:
 * a busca vai para a página do logo — `catalogsOf(pageId)` dá os catálogos
 * dela (um por versão; nenhum = sem vitrine); logo sem destino → a categoria
 * não leva a lugar nenhum; logo com outro destino (endereço, link da oferta) →
 * não dá para conferir daqui, não avisa.
 */
export function categoryGaps(
  html: string | null | undefined,
  links: Links,
  catalogsOf: (pageId: string) => readonly Catalog[],
): string[] {
  if (!html?.includes(STORE_HEADER_MARK)) return [];
  const ok = linksWithDestination(links);
  const $ = cheerio.load(html);
  const here = $(SHOPS).length ? [catalogFrom($)] : null;
  const out: string[] = [];
  $(`[${STORE_HEADER_MARK}]`).each((_, el) => {
    const header = $(el);
    if (header.attr("data-os-sh-cats") === "0") return;
    let catalogs = here;
    if (!catalogs) {
      const logo = header.find(".os-sh-logo").first();
      const href = logo.attr("href")?.trim() ?? "";
      if (href.startsWith(INTERNAL_LINK_PREFIX)) catalogs = [...catalogsOf(href.slice(INTERNAL_LINK_PREFIX.length))];
      else if (linkLeads(logo, ok)) return;
      else catalogs = [];
    }
    header.find("a.os-sh-cat").each((_, cat) => {
      const node = $(cat);
      if (linkLeads(node, ok) || node.attr(LINK_ATTR)) return;
      const text = textOf(node);
      if (text && !finds(catalogs as Catalog[], text) && !out.includes(text)) out.push(text);
    });
  });
  return out;
}
