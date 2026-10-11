/**
 * Loja: páginas de produto criadas a partir dos cartões da vitrine ("＋ Criar
 * página deste produto" no cartão e "Criar as páginas que faltam" na vitrine,
 * no editor). Uma página por produto, do modelo "Página do produto", já
 * preenchida com o que o cartão tem:
 *
 * - galeria com UMA miniatura (a foto do cartão) e a foto grande desenhada;
 * - nome no h1 e no <title>; preço, parcelas, frete, vendidos, estoque, selo e
 *   avaliação (data-os-pd-*) + moeda e idioma da vitrine na caixa de compra,
 *   com as partes refeitas (productPartHtml);
 * - "Comprar agora" e o carrinho do cabeçalho ligados ao link da oferta
 *   escolhido (ou pedindo o link: data-os-link="");
 * - a nota média de "Opiniões do produto" = a avaliação do produto (sem
 *   avaliação, a nota sai);
 * - logo e "‹ Voltar para a loja" levando à página da vitrine (os-page:<id>);
 * - o cabeçalho de loja da vitrine no lugar do cabeçalho do modelo (o editor
 *   manda o HTML e as regras de CSS dele: vão num <style data-os-edits> no
 *   <head>, que o editor lê de volta como regras editáveis — no CSS original,
 *   em camada, perderiam para o CSS do tipo do cabeçalho).
 *
 * Tudo numa transação: se uma página falha, nenhuma fica criada. Ligar os
 * cartões às páginas novas é com o editor (a vitrine está aberta nele).
 */

import type { CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";
import {
  GALLERY_STAGE_ATTR,
  galleryThumbDef,
  PRODUCT_PAGE_HOOKS,
  scoreStars,
} from "@/editor/widgets/product-page-content";
import { productPlaceholder } from "@/editor/widgets/products-content";
import { defToHtml } from "@/editor/widgets/quiz-content";
import { atomically, type Db, prisma } from "@/lib/db";
import { restoreDoctype } from "@/lib/doctype";
import { EDITS_STYLE_ATTR } from "@/lib/editor-html";
import { UserError } from "@/lib/errors";
import { internalLink } from "@/lib/internal-links";
import { LINK_ATTR } from "@/lib/offer-links";
import {
  HEADER_COPY_MAX_BYTES,
  PAGE_NAME_MAX,
  PRODUCT_NAME_MAX,
  PRODUCT_PAGES_MAX,
  productPhotoProblem,
} from "@/lib/product-pages";
import {
  CURRENCY_ATTR,
  cleanStoreText,
  galleryStageHtml,
  isProductPart,
  LANG_ATTR,
  PART_ATTR,
  type ProductData,
  productAttrs,
  productPartHtml,
  ratingText,
  readProduct,
  STORE_LANG_IDS,
  type StoreCurrency,
  type StoreLang,
  storeCurrency,
  storeLang,
} from "@/lib/store";
import { createPage } from "@/server/services/pages";

/** Modelo das páginas criadas. */
export const PRODUCT_TEMPLATE_ID = "produto";

// ─── HTML da página nova ─────────────────────────────────────────────────────

/** Cabeçalho de loja copiado da vitrine (HTML do editor e as regras de CSS dele). */
export interface HeaderCopy {
  html: string;
  css: string;
}

export interface ProductPageSpec {
  /** Página da vitrine: o logo e o "‹ Voltar para a loja" levam a ela. */
  storePageId: string;
  /** Nome do produto (h1 e <title>). */
  name: string;
  /** Foto do cartão ("" = a foto provisória do modelo). */
  photo: string;
  data: ProductData;
  currency: StoreCurrency;
  /** Idioma escolhido na vitrine (null = o da moeda). */
  lang: StoreLang | null;
  /** Link da oferta do "Comprar agora" e do carrinho (null = escolher depois). */
  linkKey: string | null;
  /** Cabeçalho da vitrine (null = fica o do modelo). */
  header: HeaderCopy | null;
}

/** Elementos e atributos que não entram num cabeçalho copiado (nada que rode código). */
const UNSAFE_TAGS = "script, style, link, meta, iframe, frame, object, embed, noscript, template, base, form";
const UNSAFE_ATTR =
  /^(?:on|data-gjs-|data-os-on-|data-os-js-)|^(?:data-os-attrs|data-os-dup-id|data-os-ccid|srcdoc|formaction)$/i;
/** O cabeçalho de loja é sempre um <header> (ou <div>, se alguém trocou a tag): nada de iframe, style, base… */
const HEADER_ROOT = `header${PRODUCT_PAGE_HOOKS.header}, div${PRODUCT_PAGE_HOOKS.header}`;

/**
 * Endereço que roda código ("javascript:", "vbscript:"). Como o navegador lê o
 * endereço: sem os espaços e os caracteres de controle ("java&#9;script:" é
 * "javascript:" para ele).
 */
const runsCode = (value: string) =>
  /^(?:javascript|vbscript):/i.test([...value].filter((c) => c > " " && c !== "\u007f").join(""));

/**
 * O cabeçalho mandado pelo editor, conferido: um só elemento, o cabeçalho de
 * loja (<header>), sem scripts nem atributos que rodem código — nele e em
 * tudo o que tem dentro. null = não serve.
 */
export function cleanHeaderHtml(html: string): string | null {
  const $ = cheerio.load(html, null, false);
  const roots = $.root()
    .contents()
    .filter((_, node) => node.type === "tag" || (node.type === "text" && Boolean(node.data.trim())));
  if (roots.length !== 1 || !roots.is(HEADER_ROOT)) return null;
  roots.find(`${UNSAFE_TAGS}, os-script, os-noscript, os-meta`).remove();
  for (const el of [roots[0], ...roots.find("*").toArray()]) {
    if (el.type !== "tag") continue;
    for (const [name, value] of Object.entries(el.attribs)) {
      if (UNSAFE_ATTR.test(name) || runsCode(value)) delete el.attribs[name];
    }
  }
  return $.html(roots);
}

/** CSS dentro de <style>: um "</style" num texto do CSS fecharia a tag (em CSS, `\/` é o mesmo "/"). */
const styleText = (css: string) => css.replace(/<\/(style)/gi, "<\\/$1");

/** Troca o cabeçalho do modelo pelo da vitrine (o CSS dele entra como regras do editor). */
function putStoreHeader($: CheerioAPI, header: HeaderCopy) {
  const html = cleanHeaderHtml(header.html);
  if (!html) throw new UserError("Não deu para copiar o cabeçalho da loja. Recarregue o editor e tente de novo.");
  const current = $(PRODUCT_PAGE_HOOKS.header).first();
  if (current.length) current.replaceWith(html);
  else $("body").prepend(html);
  if (header.css.trim()) $("head").append(`<style ${EDITS_STYLE_ATTR}>${styleText(header.css)}</style>`);
}

/**
 * HTML de uma página de produto: o do modelo "Página do produto" (`html`, já
 * com o título da página) preenchido com o produto `spec`. Puro (sem banco).
 */
export function fillProductPage(html: string, spec: ProductPageSpec): string {
  const $ = cheerio.load(html);
  const H = PRODUCT_PAGE_HOOKS;
  const store = internalLink(spec.storePageId);
  if (spec.header) putStoreHeader($, spec.header);

  // Cabeçalho: o logo leva à vitrine; o carrinho, ao checkout do produto.
  $(H.header).each((_, el) => {
    const header = $(el);
    header.find(H.logo).attr("href", store).removeAttr(LINK_ATTR).removeAttr("data-os-pay");
    const cart = header.find(H.cart);
    cart.removeAttr("data-os-pay");
    if (spec.linkKey) cart.attr("href", "#").attr(LINK_ATTR, spec.linkKey);
    // Carrinho desligado não vai ao ar: não pede link (como no editor, ao desligar).
    else if (header.attr("data-os-sh-cart") === "0") cart.removeAttr(LINK_ATTR);
    else cart.attr("href", "#").attr(LINK_ATTR, "");
  });
  $(H.back).attr("href", store).removeAttr(LINK_ATTR);

  // Galeria: uma miniatura (a foto do cartão) e a foto grande a partir dela.
  const photo = spec.photo.trim() || productPlaceholder();
  const gallery = $(H.gallery).first();
  gallery.find(".os-pg-thumbs").html(defToHtml(galleryThumbDef({ src: photo, alt: spec.name })));
  gallery.find(`[${GALLERY_STAGE_ATTR}]`).html(galleryStageHtml(photo, spec.name));

  // Caixa de compra: os dados do cartão e as partes desenhadas de novo.
  const buy = $(H.buy).first();
  for (const [name, value] of Object.entries(productAttrs(spec.data))) buy.attr(name, value);
  buy.attr(CURRENCY_ATTR, spec.currency);
  if (spec.lang) buy.attr(LANG_ATTR, spec.lang);
  else buy.removeAttr(LANG_ATTR);
  const lang = storeLang(spec.lang ?? "", spec.currency);
  buy.find(`[${PART_ATTR}]`).each((_, el) => {
    const part = $(el).attr(PART_ATTR);
    if (isProductPart(part)) $(el).html(productPartHtml(part, spec.data, spec.currency, lang));
  });
  buy.find(H.name).text(spec.name);
  buy
    .find(H.buyButton)
    .attr("href", "#")
    .attr(LINK_ATTR, spec.linkKey ?? "")
    .removeAttr("data-os-pay");

  // "Opiniões do produto": a nota média é a avaliação do produto (a mesma da caixa de
  // compra); produto sem avaliação, sem nota (nada de número que pareça de clientes).
  if (spec.data.rating === null) $(H.score).remove();
  else {
    $(H.scoreAvg).text(ratingText(spec.data.rating, spec.currency));
    $(H.stars).text(scoreStars(spec.data.rating));
  }

  $("title").first().text(spec.name);
  return restoreDoctype($.html(), html);
}

// ─── Criar ───────────────────────────────────────────────────────────────────

export interface ProductPageRequest {
  /** Nome da página no funil. */
  pageName: string;
  /** Nome do produto (o do cartão). */
  name: string;
  /** Foto do cartão. */
  photo?: string;
  /** Atributos data-os-pd-* do cartão (o que não for dado do produto é ignorado). */
  data?: Record<string, string>;
  /** Moeda da vitrine (BRL, MXN, USD, EUR). */
  currency?: string;
  /** Idioma das frases geradas escolhido na vitrine ("" = o da moeda). */
  lang?: string;
  /** Chave do link da oferta do "Comprar agora" (null/"" = escolher depois). */
  linkKey?: string | null;
}

export interface CreateProductPagesInput {
  offerId: string;
  /** Página da vitrine (a que está aberta no editor). */
  storePageId: string;
  /** Cabeçalho de loja da vitrine (null = a vitrine não tem: fica o do modelo). */
  header?: HeaderCopy | null;
  products: ProductPageRequest[];
}

export interface CreatedProductPage {
  id: string;
  name: string;
  slug: string;
  type: string;
  isHome: boolean;
  /** Documento que abre no editor. */
  documentId: string;
}

const bytes = (text: string) => Buffer.byteLength(text, "utf8");

function checkHeader(header: HeaderCopy | null | undefined): HeaderCopy | null {
  if (!header) return null;
  if (bytes(header.html) > HEADER_COPY_MAX_BYTES || bytes(header.css) > HEADER_COPY_MAX_BYTES) {
    throw new UserError(
      `O cabeçalho da loja é grande demais para copiar (máximo de ${HEADER_COPY_MAX_BYTES / 1024} KB de HTML e de CSS). Simplifique o cabeçalho e tente de novo.`,
      "header",
    );
  }
  if (!cleanHeaderHtml(header.html)) {
    throw new UserError("Não deu para copiar o cabeçalho da loja. Recarregue o editor e tente de novo.", "header");
  }
  return header;
}

/** Produto conferido (textos limpos, dados nos limites, foto que dá para usar). */
function checkProduct(p: ProductPageRequest, i: number, linkKeys: Set<string>) {
  const name = cleanStoreText(p.name, PRODUCT_NAME_MAX);
  if (!name)
    throw new UserError(`O produto ${i + 1} está sem nome: escreva o nome dele no cartão.`, `products.${i}.name`);
  const pageName = p.pageName.replace(/\s+/g, " ").trim();
  if (!pageName) throw new UserError(`Dê um nome para a página do produto “${name}”.`, `products.${i}.pageName`);
  if (pageName.length > PAGE_NAME_MAX) {
    throw new UserError(
      `O nome da página do produto “${name}” pode ter no máximo ${PAGE_NAME_MAX} caracteres.`,
      `products.${i}.pageName`,
    );
  }
  const photo = (p.photo ?? "").trim();
  const photoProblem = productPhotoProblem(photo);
  if (photoProblem) {
    throw new UserError(`Produto “${name}”: ${photoProblem}.`, `products.${i}.photo`);
  }
  const linkKey = p.linkKey?.trim() || null;
  if (linkKey && !linkKeys.has(linkKey)) {
    throw new UserError(
      `O link escolhido para o produto “${name}” não existe mais nesta oferta. Recarregue o editor e escolha de novo.`,
      `products.${i}.linkKey`,
    );
  }
  const currency = storeCurrency(p.currency);
  const lang = STORE_LANG_IDS.includes(p.lang as StoreLang) ? (p.lang as StoreLang) : null;
  return { pageName, name, photo, data: readProduct(p.data ?? {}), currency, lang, linkKey };
}

/**
 * Cria uma página "Página do produto" para cada produto, numa transação, no
 * fim do funil da oferta. Devolve as páginas na mesma ordem dos produtos.
 */
export async function createProductPages(
  input: CreateProductPagesInput,
  db: Db = prisma,
): Promise<CreatedProductPage[]> {
  if (!input.products.length) throw new UserError("Escolha pelo menos um produto.", "products");
  if (input.products.length > PRODUCT_PAGES_MAX) {
    throw new UserError(`Dá para criar até ${PRODUCT_PAGES_MAX} páginas de produto de uma vez.`, "products");
  }
  const header = checkHeader(input.header);

  return atomically(
    db,
    async (tx) => {
      const offer = await tx.offer.findFirst({ where: { id: input.offerId, deletedAt: null }, select: { id: true } });
      if (!offer) throw new UserError("Oferta não encontrada.");
      const store = await tx.page.findFirst({
        where: { id: input.storePageId, offerId: offer.id },
        select: { id: true },
      });
      if (!store) {
        throw new UserError("A página da loja não existe mais nesta oferta. Recarregue o editor.", "storePageId");
      }
      const keys = new Set(
        (await tx.offerLink.findMany({ where: { offerId: offer.id }, select: { key: true } })).map((l) => l.key),
      );
      const products = input.products.map((p, i) => checkProduct(p, i, keys));

      const ids: string[] = [];
      for (const product of products) {
        const page = await createPage(
          {
            offerId: offer.id,
            name: product.pageName,
            templateId: PRODUCT_TEMPLATE_ID,
            adjustHtml: (html) =>
              fillProductPage(html, {
                storePageId: store.id,
                name: product.name,
                photo: product.photo,
                data: product.data,
                currency: product.currency,
                lang: product.lang,
                linkKey: product.linkKey,
                header,
              }),
          },
          tx,
        );
        ids.push(page.id);
      }

      const created = await tx.page.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          isHome: true,
          variants: { where: { isControl: true }, select: { documents: { select: { id: true, device: true } } } },
        },
      });
      return ids.map((id) => {
        const page = created.find((p) => p.id === id);
        const docs = page?.variants[0]?.documents ?? [];
        const doc = docs.find((d) => d.device === "ALL") ?? docs[0];
        if (!page || !doc) throw new Error("Página do produto sumiu no meio da criação.");
        return {
          id: page.id,
          name: page.name,
          slug: page.slug,
          type: page.type,
          isHome: page.isHome,
          documentId: doc.id,
        };
      });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
