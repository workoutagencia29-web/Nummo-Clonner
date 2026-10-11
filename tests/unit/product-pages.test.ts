/**
 * Páginas de produto criadas a partir da vitrine (Fase 2.4 da loja), no
 * serviço, na ação e no banco: uma página do modelo "Página do produto" por
 * produto, já preenchida com o cartão (foto, nome, dados, moeda e idioma), com
 * o "Comprar agora" e o carrinho no link escolhido (ou pedindo o link), o logo e
 * o "‹ Voltar para a loja" levando à vitrine e o cabeçalho da vitrine (com as
 * regras de CSS dele) no lugar do cabeçalho do modelo. Tudo numa transação,
 * com os limites e as conferências da especificação. Depois: excluir a página
 * de um produto avisa que a vitrine leva a ela (e desfaz o link), e duplicar a
 * oferta mantém os cartões e as páginas de produto ligados entre as cópias.
 */
import * as cheerio from "cheerio";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** Falha de propósito na 2ª página (depois de criar a 1ª), para conferir a transação. */
const failSecond = vi.hoisted(() => ({ on: false, calls: 0 }));
vi.mock("@/server/services/pages", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/services/pages")>();
  return {
    ...real,
    createPage: async (...args: Parameters<typeof real.createPage>) => {
      failSecond.calls++;
      if (failSecond.on && failSecond.calls === 2) throw new Error("falha simulada");
      return real.createPage(...args);
    },
  };
});

import { PRODUCT_PAGE_HOOKS } from "@/editor/widgets/product-page-content";
import { prisma } from "@/lib/db";
import { EDITS_STYLE_ATTR } from "@/lib/editor-html";
import { internalLink } from "@/lib/internal-links";
import { renderPageHtml } from "@/lib/page-render";
import { freePageName, freePageNames, PRODUCT_PAGES_MAX, productPhotoProblem } from "@/lib/product-pages";
import { packProject, unpackProject } from "@/lib/project-data";
import { cleanStoreText, productAttrs, productPartHtml, readProduct } from "@/lib/store";
import { productPageNames } from "@/lib/store-pages";
import { cutText } from "@/lib/text";
import { createProductPagesAction } from "@/server/actions/store";
import { getEditorPayload } from "@/server/services/documents";
import { createOfferLink } from "@/server/services/offer-links";
import { createOffer, duplicateOffer } from "@/server/services/offers";
import { pageStart } from "@/server/services/page-templates";
import { deletePage, pageReferences } from "@/server/services/pages";
import { cleanHeaderHtml, createProductPages, fillProductPage, type ProductPageRequest } from "@/server/services/store";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";

beforeEach(async () => {
  failSecond.on = false;
  failSecond.calls = 0;
  await resetDatabase();
});

const H = PRODUCT_PAGE_HOOKS;
const PHOTO = "/os-assets/0f2a9c.webp";

/** Dados de um cartão (atributos data-os-pd-*), como o editor manda. */
const CARD_DATA = productAttrs({
  price: 6376,
  old: 14990,
  inst: 12,
  instValue: null,
  ship: "Frete grátis",
  sold: "+10mil vendidos",
  stock: 3,
  badge: "OFERTA DO DIA",
  rating: 4.8,
  reviews: 1234,
});

const product = (over: Partial<ProductPageRequest> = {}): ProductPageRequest => ({
  pageName: "Fone de ouvido sem fio",
  name: "Fone de ouvido sem fio",
  photo: PHOTO,
  data: CARD_DATA,
  currency: "BRL",
  lang: "",
  linkKey: null,
  ...over,
});

/** Cabeçalho de loja como o editor manda (toHTML + regras de CSS), com cor própria. */
function vitrineHeader(storeHtml: string) {
  const $ = cheerio.load(storeHtml);
  const header = $(H.header).first();
  header.attr("id", "icabeca");
  header.find(".os-sh-strip").text("Frete grátis para todo o México");
  header.find(H.logo).attr("href", "https://minhaloja.com").attr("data-os-link", "");
  return {
    html: $.html(header),
    css: "#icabeca{--os-sh-bg:#101828;--os-sh-ink:#ffffff;}@media (max-width: 768px){#icabeca .os-sh-logo-img{height:28px;}}",
  };
}

async function storeOffer() {
  const offer = await createOffer({ name: "Loja", templateId: "loja" });
  const store = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
  const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: store.id } } });
  const checkout = await createOfferLink(offer.id, {
    label: "Checkout do fone",
    url: "https://pay.exemplo.com/fone",
    kind: "CHECKOUT",
  });
  return { offerId: offer.id, store, storeHtml: doc.html ?? "", storeDocId: doc.id, checkout };
}

async function htmlOf(pageId: string) {
  const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId } } });
  return doc.html ?? "";
}

const pagesOf = (offerId: string) =>
  prisma.page.findMany({ where: { offerId }, orderBy: { position: "asc" }, select: { id: true, name: true } });

describe("regras puras (src/lib/product-pages.ts)", () => {
  it("foto: endereço https, arquivo enviado (/os-assets/) ou imagem data:; o resto não", () => {
    expect(productPhotoProblem("")).toBeNull();
    expect(productPhotoProblem("https://cdn.loja.com/fone.jpg")).toBeNull();
    expect(productPhotoProblem("/os-assets/abc123.png")).toBeNull();
    expect(productPhotoProblem("//cdn.loja.com/fone.webp")).toBeNull();
    expect(productPhotoProblem("data:image/svg+xml;charset=utf-8,%3Csvg%3E")).toBeNull();
    expect(productPhotoProblem("data:image/png;base64,iVBORw0KGgo=")).toBeNull();
    expect(productPhotoProblem("javascript:alert(1)")).toMatch(/não é válido/);
    expect(productPhotoProblem("data:text/html,<script>")).toMatch(/não é uma imagem/);
    expect(productPhotoProblem('https://x.com/a" onerror="b')).toMatch(/não é válido/);
    expect(productPhotoProblem("/outra-pasta/a.png")).toMatch(/não é válido/);
    expect(productPhotoProblem(`data:image/png;base64,${"A".repeat(600 * 1024)}`)).toMatch(/grande demais/);
  });

  it("nomes de página livres (sem repetir entre si nem com as páginas da oferta)", () => {
    expect(freePageName("Fone", ["fone", "Loja"])).toBe("Fone 2");
    expect(freePageName("  Mochila   nova ", [])).toBe("Mochila nova");
    expect(freePageName("x".repeat(130), [])).toHaveLength(120);
    expect(freePageNames(["Fone", "Fone", "Loja"], ["Loja"])).toEqual(["Fone", "Fone 2", "Loja 2"]);
  });

  it("cortes nunca deixam meio emoji (que vira “�” no nome da página, no h1 e no <title>)", () => {
    const loneHalf = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
    // 119 letras + 🔥 (2 unidades): o emoji não cabe nos 120 e sai inteiro.
    expect(freePageName(`${"a".repeat(119)}🔥`, [])).toBe("a".repeat(119));
    expect(freePageName(`${"a".repeat(118)}🔥`, [])).toBe(`${"a".repeat(118)}🔥`);
    // Com o sufixo " 2" (corte em 118): idem.
    const taken = `${"a".repeat(117)}🔥`;
    const second = freePageName(taken, [taken]);
    expect(second).toBe(`${"a".repeat(117)} 2`);
    expect(second.length).toBeLessThanOrEqual(120);
    // Nome do produto (até 150).
    expect(cleanStoreText(`${"b".repeat(149)}🔥`, 150)).toBe("b".repeat(149));
    expect(cutText("🔥🔥", 3)).toBe("🔥");
    for (const text of [
      freePageName(`${"a".repeat(119)}🔥`, []),
      second,
      cleanStoreText(`${"b".repeat(149)}🔥`, 150),
    ]) {
      expect(loneHalf.test(text)).toBe(false);
    }
  });
});

describe("fillProductPage (HTML da página nova)", () => {
  const start = () => pageStart("produto", "Fone de ouvido sem fio").html;

  it("preenche foto, nome, dados, moeda, links e as voltas para a vitrine", () => {
    const html = fillProductPage(start(), {
      storePageId: "cloja000000000000000000000",
      name: "Audífonos inalámbricos <b>",
      photo: PHOTO,
      data: readProduct(CARD_DATA),
      currency: "MXN",
      lang: "es",
      linkKey: "checkout-fone",
      header: null,
    });
    const $ = cheerio.load(html);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect($("title").text()).toBe("Audífonos inalámbricos <b>");
    // Galeria: uma miniatura (a foto do cartão) e a foto grande dela.
    const thumbs = $(`${H.gallery} .os-pg-thumb`);
    expect(thumbs.length).toBe(1);
    expect(thumbs.find("img").attr("src")).toBe(PHOTO);
    expect(thumbs.find("img").attr("alt")).toBe("Audífonos inalámbricos <b>");
    expect($(`${H.gallery} .os-pg-main`).attr("src")).toBe(PHOTO);
    // Caixa de compra: os atributos do cartão + moeda e idioma; partes refeitas.
    const buy = $(H.buy);
    expect(buy.attr("data-os-currency")).toBe("MXN");
    expect(buy.attr("data-os-pd-lang")).toBe("es");
    for (const [name, value] of Object.entries(CARD_DATA)) expect(buy.attr(name)).toBe(value);
    const data = readProduct(CARD_DATA);
    expect(buy.find('[data-os-pd-part="price"]').html()).toBe(productPartHtml("price", data, "MXN", "es"));
    expect(buy.find('[data-os-pd-part="stock"]').html()).toBe(productPartHtml("stock", data, "MXN", "es"));
    expect(buy.find('[data-os-pd-part="price"] .os-pd-now').text()).toBe("$63.76");
    expect(buy.find('[data-os-pd-part="badge"]').text()).toBe("OFERTA DO DIA");
    expect(buy.find(H.name).text()).toBe("Audífonos inalámbricos <b>");
    expect(buy.find(H.name).html()).toBe("Audífonos inalámbricos &lt;b&gt;");
    // "Comprar agora" e carrinho no link escolhido; logo e "Voltar" levam à vitrine.
    expect($(H.buyButton).attr("data-os-link")).toBe("checkout-fone");
    expect($(H.cart).attr("data-os-link")).toBe("checkout-fone");
    expect($(H.logo).attr("href")).toBe(internalLink("cloja000000000000000000000"));
    expect($(H.back).attr("href")).toBe(internalLink("cloja000000000000000000000"));
    expect($(H.back).attr("data-os-link")).toBeUndefined();
  });

  it("“escolher depois”: o botão e o carrinho pedem o link; carrinho desligado não pede", () => {
    const base = { storePageId: "cloja000000000000000000000", name: "Fone", photo: "", data: readProduct({}) };
    let $ = cheerio.load(
      fillProductPage(start(), { ...base, currency: "BRL", lang: null, linkKey: null, header: null }),
    );
    expect($(H.buyButton).attr("data-os-link")).toBe("");
    expect($(H.cart).attr("data-os-link")).toBe("");
    // Sem foto: a provisória do modelo (uma só miniatura); sem idioma escolhido: sem o atributo.
    expect($(`${H.gallery} .os-pg-thumb`).length).toBe(1);
    expect($(`${H.gallery} .os-pg-thumb img`).attr("src")).toMatch(/^data:image\/svg\+xml/);
    expect($(H.buy).attr("data-os-pd-lang")).toBeUndefined();
    expect($(H.buy).find('[data-os-pd-part="price"]').html()).toBe("");

    const off = cheerio.load(start());
    off(H.header).attr("data-os-sh-cart", "0");
    $ = cheerio.load(
      fillProductPage(off.html(), { ...base, currency: "BRL", lang: null, linkKey: null, header: null }),
    );
    expect($(H.cart).attr("data-os-link")).toBeUndefined();
    expect($(H.buyButton).attr("data-os-link")).toBe("");
  });

  it("cabeçalho da vitrine no lugar do modelo, com o CSS dele como regras do editor (e sem nada que rode código)", () => {
    const storeHtml = pageStart("loja", "Loja").html;
    const header = vitrineHeader(storeHtml);
    const dirty = header.html
      .replace("<header", '<header onclick="alert(1)" data-gjs-type="text"')
      .replace("</header>", '<script>alert(2)</script><a href="javascript:alert(3)" class="os-sh-cat">X</a></header>');
    const html = fillProductPage(start(), {
      storePageId: "cloja000000000000000000000",
      name: "Fone",
      photo: PHOTO,
      data: readProduct(CARD_DATA),
      currency: "BRL",
      lang: null,
      linkKey: "checkout-fone",
      header: { html: dirty, css: `${header.css}.x{content:"</style><script>alert(4)</script>"}` },
    });
    const $ = cheerio.load(html);
    expect($(H.header).length).toBe(1);
    expect($(H.header).attr("id")).toBe("icabeca");
    expect($(".os-sh-strip").text()).toBe("Frete grátis para todo o México");
    expect($(H.header).attr("onclick")).toBeUndefined();
    expect($(H.header).attr("data-gjs-type")).toBeUndefined();
    expect($(`${H.header} script`).length).toBe(0);
    expect($('a[href^="javascript:"]').length).toBe(0);
    // O logo leva à vitrine (o link escolhido na vitrine não vale aqui) e o carrinho ao checkout do produto.
    expect($(H.logo).attr("href")).toBe(internalLink("cloja000000000000000000000"));
    expect($(H.logo).attr("data-os-link")).toBeUndefined();
    expect($(H.cart).attr("data-os-link")).toBe("checkout-fone");
    // CSS das regras do cabeçalho: no <head>, como edições (o editor lê de volta como regras dele).
    const style = $(`head style[${EDITS_STYLE_ATTR}]`);
    expect(style.length).toBe(1);
    expect(style.html()).toContain("#icabeca{--os-sh-bg:#101828;");
    expect(style.html()).not.toContain("</style>");
    expect($("script").length).toBe(0);
  });

  it("logo enviado, posição e altura do logo da vitrine vão para a página do produto", () => {
    const storeHtml = pageStart("loja", "Loja").html;
    const header = vitrineHeader(storeHtml);
    const src = `/os-assets/${"a".repeat(64)}.webp`;
    const $v = cheerio.load(header.html, null, false);
    $v(H.header).attr("data-os-sh-logo-pos", "center").attr("data-os-sh-logo-pos-m", "right");
    $v(".os-sh-logo-img").attr("src", src).attr("alt", "Logo da Loja Modelo");
    const html = $v.html();
    // O cabeçalho conferido continua com tudo isso.
    const clean = cheerio.load(cleanHeaderHtml(html) ?? "", null, false);
    expect(clean(H.header).attr("data-os-sh-logo-pos")).toBe("center");
    expect(clean(H.header).attr("data-os-sh-logo-pos-m")).toBe("right");
    expect(clean(".os-sh-logo-img").attr("src")).toBe(src);

    const $ = cheerio.load(
      fillProductPage(start(), {
        storePageId: "cloja000000000000000000000",
        name: "Fone",
        photo: PHOTO,
        data: readProduct(CARD_DATA),
        currency: "BRL",
        lang: null,
        linkKey: null,
        header: { html, css: `${header.css}#icabeca{--os-sh-logo-h:56px;}` },
      }),
    );
    expect($(H.header).attr("data-os-sh-logo-pos")).toBe("center");
    expect($(H.header).attr("data-os-sh-logo-pos-m")).toBe("right");
    expect($(`${H.header} .os-sh-logo-img`).attr("src")).toBe(src);
    expect($(`${H.header} .os-sh-logo-img`).attr("alt")).toBe("Logo da Loja Modelo");
    expect($(`head style[${EDITS_STYLE_ATTR}]`).html()).toContain("--os-sh-logo-h:56px");
    // O CSS do modelo tem as regras de lugar e tamanho do logo (a página pode ir ao ar sem abrir no editor).
    expect($("style").text()).toContain('[data-os-sh-logo-pos="center"]');
    expect($("style").text()).toContain("var(--os-sh-logo-h,40px)");
  });

  it("“Opiniões do produto”: a nota média é a avaliação do produto; sem avaliação, a nota sai", () => {
    const base = { storePageId: "cloja000000000000000000000", name: "Fone", photo: PHOTO, header: null, linkKey: null };
    let $ = cheerio.load(
      fillProductPage(start(), { ...base, data: readProduct(CARD_DATA), currency: "BRL", lang: null }),
    );
    // A mesma da caixa de compra (4,8), não a do modelo.
    expect($(H.scoreAvg).text()).toBe("4,8");
    expect($(H.stars).text()).toBe("★★★★★");
    expect($(H.buy).find(".os-pd-rate").text()).toBe("4,8");
    $ = cheerio.load(
      fillProductPage(start(), {
        ...base,
        data: readProduct({ ...CARD_DATA, "data-os-pd-rating": "4.4" }),
        currency: "MXN",
        lang: null,
      }),
    );
    expect($(H.scoreAvg).text()).toBe("4.4");
    expect($(H.stars).text()).toBe("★★★★☆");
    // Sem avaliação (os cartões da "Faixa de ofertas"): nada de nota inventada; as opiniões provisórias ficam.
    $ = cheerio.load(
      fillProductPage(start(), {
        ...base,
        data: readProduct({ ...CARD_DATA, "data-os-pd-rating": "" }),
        currency: "BRL",
        lang: null,
      }),
    );
    expect($(H.score).length).toBe(0);
    expect($(H.scoreAvg).length).toBe(0);
    expect($(".os-pp-review").length).toBe(3);
    // O modelo nasce com a nota igual à da caixa de compra de exemplo.
    const $t = cheerio.load(start());
    expect($t(H.scoreAvg).text()).toBe($t(H.buy).find(".os-pd-rate").text());
  });

  it("cleanHeaderHtml: só um cabeçalho de loja serve", () => {
    expect(cleanHeaderHtml('<div data-os-widget="products"></div>')).toBeNull();
    expect(
      cleanHeaderHtml('<header data-os-widget="store-header"></header><header data-os-widget="store-header"></header>'),
    ).toBeNull();
    expect(cleanHeaderHtml('texto <header data-os-widget="store-header"></header>')).toBeNull();
    expect(cleanHeaderHtml(' <header data-os-widget="store-header" class="os-store-header"></header>\n')).toBe(
      '<header data-os-widget="store-header" class="os-store-header"></header>',
    );
  });

  it("cleanHeaderHtml: raiz que não é um <header> (iframe, os-script, style, base…) não serve; a raiz também é limpa", () => {
    for (const html of [
      '<iframe data-os-widget="store-header" srcdoc="&lt;script&gt;parent.alert(1)&lt;/script&gt;" onload="alert(2)"></iframe>',
      '<os-script data-os-widget="store-header">alert(1)</os-script>',
      '<style data-os-widget="store-header">body{display:none}</style>',
      '<base data-os-widget="store-header" href="https://outro.site/">',
      '<meta data-os-widget="store-header" http-equiv="refresh" content="0;url=https://outro.site">',
      '<object data-os-widget="store-header" data="x.swf"></object>',
      '<form data-os-widget="store-header" action="https://outro.site"></form>',
      '<script data-os-widget="store-header">alert(1)</script>',
    ]) {
      expect(cleanHeaderHtml(html), html).toBeNull();
    }
    // Na raiz: on*, srcdoc e marcas do editor saem (antes só saíam de dentro dela).
    expect(
      cleanHeaderHtml(
        '<header data-os-widget="store-header" onmouseover="alert(1)" data-gjs-type="x" class="a"></header>',
      ),
    ).toBe('<header data-os-widget="store-header" class="a"></header>');
    // "java&#9;script:" é "javascript:" para o navegador (ele tira tabs, quebras e espaços do começo).
    for (const href of ["java&#9;script:alert(1)", "&#10;javascript:alert(1)", " JaVaScRiPt:alert(1)", "vbscript:x"]) {
      const out = cleanHeaderHtml(
        `<header data-os-widget="store-header"><a class="os-sh-cat" href="${href}">X</a></header>`,
      );
      expect(out, href).toBe('<header data-os-widget="store-header"><a class="os-sh-cat">X</a></header>');
    }
    // Endereços comuns ficam.
    expect(
      cleanHeaderHtml(
        '<header data-os-widget="store-header"><a class="os-sh-logo" href="os-page:cloja1"><img src="data:image/png;base64,AA=="></a></header>',
      ),
    ).toContain('href="os-page:cloja1"');
  });
});

describe("createProductPages (banco)", () => {
  it("cria uma página por produto, preenchida, no fim do funil (numa transação)", async () => {
    const f = await storeOffer();
    await createOfferLink(f.offerId, { label: "Obrigado", url: "https://exemplo.com/obrigado", kind: "OTHER" });
    const header = vitrineHeader(f.storeHtml);
    const pages = await createProductPages({
      offerId: f.offerId,
      storePageId: f.store.id,
      header,
      products: [
        product({ linkKey: f.checkout.key }),
        product({
          pageName: "Mochila para notebook",
          name: "Mochila para notebook",
          photo: "https://cdn.loja.com/mochila.jpg",
          data: productAttrs({ price: 19990 }),
          currency: "EUR",
          lang: "en",
        }),
      ],
    });

    expect(pages).toHaveLength(2);
    expect(pages.map((p) => [p.name, p.slug, p.type, p.isHome])).toEqual([
      ["Fone de ouvido sem fio", "fone-de-ouvido-sem-fio", "SALES", false],
      ["Mochila para notebook", "mochila-para-notebook", "SALES", false],
    ]);
    expect((await pagesOf(f.offerId)).map((p) => p.name)).toEqual([
      "Página principal",
      "Fone de ouvido sem fio",
      "Mochila para notebook",
    ]);
    const doc = await prisma.pageDocument.findUniqueOrThrow({ where: { id: pages[0].documentId } });
    expect(doc.device).toBe("ALL");

    const $a = cheerio.load(await htmlOf(pages[0].id));
    expect($a("title").text()).toBe("Fone de ouvido sem fio");
    expect($a(H.name).text()).toBe("Fone de ouvido sem fio");
    expect($a(`${H.gallery} .os-pg-thumb img`).attr("src")).toBe(PHOTO);
    expect($a(H.buy).attr("data-os-pd-price")).toBe("6376");
    expect($a(H.buyButton).attr("data-os-link")).toBe(f.checkout.key);
    expect($a(H.cart).attr("data-os-link")).toBe(f.checkout.key);
    expect($a(H.logo).attr("href")).toBe(internalLink(f.store.id));
    expect($a(H.back).attr("href")).toBe(internalLink(f.store.id));
    expect($a(H.header).attr("id")).toBe("icabeca");
    expect($a(`style[${EDITS_STYLE_ATTR}]`).html()).toContain("--os-sh-bg:#101828");

    const $b = cheerio.load(await htmlOf(pages[1].id));
    expect($b(H.buy).attr("data-os-currency")).toBe("EUR");
    expect($b(H.buy).attr("data-os-pd-lang")).toBe("en");
    expect($b(H.buy).find(".os-pd-now").text()).toBe("199,90 €");
    expect($b(H.buyButton).attr("data-os-link")).toBe("");

    // Na página publicada: logo e "Voltar" levam ao endereço da vitrine; o botão ao checkout.
    const links = await prisma.offerLink.findMany({ where: { offerId: f.offerId }, select: { key: true, url: true } });
    const out = cheerio.load(
      renderPageHtml(await htmlOf(pages[0].id), { links, pageHref: (id) => `/p/${id}/`, runtimeTag: "" }),
    );
    expect(out(H.logo).attr("href")).toBe(`/p/${f.store.id}/`);
    expect(out(H.back).attr("href")).toBe(`/p/${f.store.id}/`);
    expect(out(H.buyButton).attr("href")).toBe("https://pay.exemplo.com/fone");
  });

  it("sem cabeçalho na vitrine, fica o do modelo (com o logo levando à vitrine)", async () => {
    const f = await storeOffer();
    const [page] = await createProductPages({ offerId: f.offerId, storePageId: f.store.id, products: [product()] });
    const $ = cheerio.load(await htmlOf(page.id));
    expect($(H.header).length).toBe(1);
    expect($(H.header).attr("id")).toBeUndefined();
    expect($(`style[${EDITS_STYLE_ATTR}]`).length).toBe(0);
    expect($(H.logo).attr("href")).toBe(internalLink(f.store.id));
  });

  it("nomes repetidos ganham endereços diferentes", async () => {
    const f = await storeOffer();
    const pages = await createProductPages({
      offerId: f.offerId,
      storePageId: f.store.id,
      products: [product(), product({ pageName: "Fone de ouvido sem fio 2" })],
    });
    expect(pages.map((p) => p.slug)).toEqual(["fone-de-ouvido-sem-fio", "fone-de-ouvido-sem-fio-2"]);
  });

  it("um erro no meio desfaz tudo (nenhuma página fica pela metade)", async () => {
    const f = await storeOffer();
    failSecond.on = true;
    await expect(
      createProductPages({ offerId: f.offerId, storePageId: f.store.id, products: [product(), product()] }),
    ).rejects.toThrow("falha simulada");
    expect((await pagesOf(f.offerId)).map((p) => p.name)).toEqual(["Página principal"]);
  });

  it("validações e limites", async () => {
    const f = await storeOffer();
    const other = await createOffer({ name: "Outra" });
    const otherPage = await prisma.page.findFirstOrThrow({ where: { offerId: other.id } });
    const otherLink = await createOfferLink(other.id, { label: "Checkout de lá", url: "", kind: "CHECKOUT" });
    const base = { offerId: f.offerId, storePageId: f.store.id };

    await expectUserError(createProductPages({ ...base, products: [] }), "Escolha pelo menos um produto.", "products");
    await expectUserError(
      createProductPages({ ...base, products: Array.from({ length: PRODUCT_PAGES_MAX + 1 }, () => product()) }),
      "Dá para criar até 60 páginas de produto de uma vez.",
      "products",
    );
    await expectUserError(
      createProductPages({ ...base, storePageId: otherPage.id, products: [product()] }),
      "A página da loja não existe mais nesta oferta. Recarregue o editor.",
      "storePageId",
    );
    await expectUserError(
      createProductPages({ ...base, products: [product(), product({ linkKey: otherLink.key })] }),
      "O link escolhido para o produto “Fone de ouvido sem fio” não existe mais nesta oferta. Recarregue o editor e escolha de novo.",
      "products.1.linkKey",
    );
    await expectUserError(
      createProductPages({ ...base, products: [product({ photo: "javascript:alert(1)" })] }),
      /^Produto “Fone de ouvido sem fio”: o endereço da foto não é válido/,
      "products.0.photo",
    );
    await expectUserError(
      createProductPages({ ...base, products: [product({ name: "  <b></b> " })] }),
      "O produto 1 está sem nome: escreva o nome dele no cartão.",
      "products.0.name",
    );
    await expectUserError(
      createProductPages({ ...base, products: [product({ pageName: "x".repeat(121) })] }),
      "O nome da página do produto “Fone de ouvido sem fio” pode ter no máximo 120 caracteres.",
      "products.0.pageName",
    );
    const header = vitrineHeader(f.storeHtml);
    await expectUserError(
      createProductPages({
        ...base,
        header: { html: header.html, css: "a".repeat(200 * 1024 + 1) },
        products: [product()],
      }),
      /^O cabeçalho da loja é grande demais para copiar \(máximo de 200 KB/,
      "header",
    );
    await expectUserError(
      createProductPages({ ...base, header: { html: "<div>outra coisa</div>", css: "" }, products: [product()] }),
      "Não deu para copiar o cabeçalho da loja. Recarregue o editor e tente de novo.",
      "header",
    );
    await expectUserError(
      createProductPages({ ...base, offerId: "nao-existe", products: [product()] }),
      "Oferta não encontrada.",
    );
    // Nada foi criado em nenhuma das tentativas.
    expect((await pagesOf(f.offerId)).map((p) => p.name)).toEqual(["Página principal"]);
  });

  it("dados fora dos limites ficam vazios (nada de HTML nos textos)", async () => {
    const f = await storeOffer();
    const [page] = await createProductPages({
      offerId: f.offerId,
      storePageId: f.store.id,
      products: [
        product({
          data: {
            "data-os-pd-price": "abc",
            "data-os-pd-ship": '<img src=x onerror="alert(1)">Frete grátis',
            "data-os-pd-inst": "99",
            "data-os-pd-qualquer": "x",
          },
          currency: "XYZ",
          lang: "fr",
        }),
      ],
    });
    const $ = cheerio.load(await htmlOf(page.id));
    expect($(H.buy).attr("data-os-pd-price")).toBe("");
    expect($(H.buy).attr("data-os-pd-ship")).toBe("Frete grátis");
    expect($(H.buy).attr("data-os-pd-inst")).toBe("0");
    expect($(H.buy).attr("data-os-pd-qualquer")).toBeUndefined();
    expect($(H.buy).attr("data-os-currency")).toBe("BRL");
    expect($(H.buy).attr("data-os-pd-lang")).toBeUndefined();
    expect($(H.buy).find("img").length).toBe(0);
  });
});

describe("createProductPagesAction", () => {
  it("cria as páginas (com login) e confere a entrada em pt-BR", async () => {
    const f = await storeOffer();
    const ok = await createProductPagesAction({
      offerId: f.offerId,
      storePageId: f.store.id,
      header: null,
      products: [{ pageName: " Fone ", name: "Fone", data: CARD_DATA, linkKey: f.checkout.key }],
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.data).toEqual([expect.objectContaining({ name: "Fone", slug: "fone", type: "SALES", isHome: false })]);
    expect(ok.data[0].documentId).toBeTruthy();

    expect(await createProductPagesAction({ offerId: f.offerId, storePageId: f.store.id, products: [] })).toMatchObject(
      { ok: false, error: "Escolha pelo menos um produto." },
    );
    expect(
      await createProductPagesAction({
        offerId: f.offerId,
        storePageId: f.store.id,
        products: Array.from({ length: 61 }, () => ({ pageName: "A", name: "A" })),
      }),
    ).toMatchObject({ ok: false, error: "Dá para criar até 60 páginas de produto de uma vez." });
    expect(
      await createProductPagesAction({
        offerId: f.offerId,
        storePageId: f.store.id,
        products: [{ pageName: "   ", name: "A" }],
      }),
    ).toMatchObject({ ok: false, error: "Dê um nome para a página." });
    expect(
      await createProductPagesAction({
        offerId: f.offerId,
        storePageId: f.store.id,
        products: [{ pageName: "x".repeat(121), name: "A" }],
      }),
    ).toMatchObject({ ok: false, error: "O nome da página pode ter no máximo 120 caracteres." });
    expect(
      await createProductPagesAction({
        offerId: f.offerId,
        storePageId: f.store.id,
        products: [{ pageName: "A", name: "A", linkKey: "nao-existe" }],
      }),
    ).toMatchObject({ ok: false, error: /não existe mais nesta oferta/ });
    // Produto sem nome: a mensagem diz qual é (e o campo dele).
    expect(
      await createProductPagesAction({
        offerId: f.offerId,
        storePageId: f.store.id,
        products: [
          { pageName: "A", name: "A" },
          { pageName: "Página do produto", name: "  " },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: "O produto 2 está sem nome: escreva o nome dele no cartão.",
      field: "products.1.name",
    });
    // Nome com emoji cortado no limite: nada de "�" no nome, no h1 nem no <title>.
    const long = await createProductPagesAction({
      offerId: f.offerId,
      storePageId: f.store.id,
      products: [{ pageName: freePageName(`${"a".repeat(119)}🔥`, []), name: `${"b".repeat(149)}🔥` }],
    });
    expect(long.ok).toBe(true);
    if (!long.ok) return;
    expect(long.data[0].name).toBe("a".repeat(119));
    const $ = cheerio.load(await htmlOf(long.data[0].id));
    expect($(H.name).text()).toBe("b".repeat(149));
    expect($("title").text()).toBe("b".repeat(149));
    expect((await htmlOf(long.data[0].id)).includes("\ufffd")).toBe(false);
  });
});

describe("páginas de produto que já existem (uma página por produto)", () => {
  it("productPageNames: o nome do produto das páginas que voltam para esta vitrine", () => {
    const html = fillProductPage(pageStart("produto", "Fone").html, {
      storePageId: "cloja1",
      name: "Fone de ouvido sem fio",
      photo: PHOTO,
      data: readProduct(CARD_DATA),
      currency: "BRL",
      lang: null,
      linkKey: null,
      header: null,
    });
    expect(productPageNames(html, "cloja1")).toEqual(["Fone de ouvido sem fio"]);
    // De outra vitrine, ou uma página sem caixa de compra: nada.
    expect(productPageNames(html, "cloja2")).toEqual([]);
    expect(productPageNames(pageStart("loja", "Loja").html, "cloja1")).toEqual([]);
    // Só o logo levando à vitrine (o "Voltar" sem destino) também conta.
    const $ = cheerio.load(html);
    $(H.back).attr("href", "#");
    expect(productPageNames($.html(), "cloja1")).toEqual(["Fone de ouvido sem fio"]);
    $(H.logo).attr("href", "#");
    expect(productPageNames($.html(), "cloja1")).toEqual([]);
  });

  it("o editor da vitrine recebe as páginas de produto dela (storeProducts), de todas as versões", async () => {
    const f = await storeOffer();
    const pages = await createProductPages({
      offerId: f.offerId,
      storePageId: f.store.id,
      products: [product(), product({ pageName: "Mochila", name: "Mochila para notebook" })],
    });
    // Uma página de produto de outra vitrine não entra.
    const other = await createOffer({ name: "Outra loja", templateId: "loja" });
    const otherStore = await prisma.page.findFirstOrThrow({ where: { offerId: other.id } });
    await createProductPages({ offerId: other.id, storePageId: otherStore.id, products: [product()] });

    const payload = await getEditorPayload(f.storeDocId);
    expect(payload.storeProducts).toEqual([
      { pageId: pages[0].id, name: "Fone de ouvido sem fio" },
      { pageId: pages[1].id, name: "Mochila para notebook" },
    ]);
    // O editor de uma página de produto não tem "páginas de produto" (nenhuma volta para ela).
    expect((await getEditorPayload(pages[0].documentId)).storeProducts).toEqual([]);
  });
});

// ─── Excluir e duplicar ──────────────────────────────────────────────────────

type Comp = { type?: string; tagName?: string; attributes?: Record<string, string>; components?: Comp[] };
const projectWith = (components: Comp[]) => ({ pages: [{ frames: [{ component: { type: "wrapper", components } }] }] });

/** A vitrine depois de salva no editor: os 2 primeiros cartões levam às páginas de produto (HTML e projeto). */
async function linkCards(storeDocId: string, storeHtml: string, pageIds: string[]) {
  const $ = cheerio.load(storeHtml);
  const cards = $("a[data-os-product]");
  pageIds.forEach((id, i) => {
    cards.eq(i).attr("href", internalLink(id));
  });
  const names = pageIds.map((_, i) => cards.eq(i).find(".os-pd-name").text().trim());
  const project = projectWith(
    pageIds.map((id) => ({ tagName: "a", attributes: { "data-os-product": "", href: internalLink(id) } })),
  );
  await prisma.pageDocument.update({
    where: { id: storeDocId },
    data: { html: $.html(), project: packProject(project), revision: 2 },
  });
  return names;
}

describe("página de produto excluída ou oferta duplicada", () => {
  it("excluir: o aviso diz que a vitrine leva a ela, e o produto fica sem página", async () => {
    const f = await storeOffer();
    const pages = await createProductPages({
      offerId: f.offerId,
      storePageId: f.store.id,
      products: [product(), product({ pageName: "Mochila", name: "Mochila" })],
    });
    const names = await linkCards(
      f.storeDocId,
      f.storeHtml,
      pages.map((p) => p.id),
    );

    const refs = await pageReferences(pages[0].id);
    expect(refs.count).toBe(1);
    expect(refs.pages).toEqual([{ id: f.store.id, name: "Página principal" }]);
    expect(refs.products).toEqual([{ pageId: f.store.id, pageName: "Página principal", names: [names[0]] }]);
    // A vitrine não é "página de produto" de ninguém (só os links de volta levam a ela).
    const back = await pageReferences(f.store.id);
    expect(back.pages.map((p) => p.id)).toEqual(pages.map((p) => p.id));
    expect(back.products).toEqual([]);

    await deletePage(pages[0].id);
    const doc = await prisma.pageDocument.findUniqueOrThrow({ where: { id: f.storeDocId } });
    const $ = cheerio.load(doc.html ?? "");
    expect($("a[data-os-product]").eq(0).attr("href")).toBe("#");
    expect($("a[data-os-product]").eq(1).attr("href")).toBe(internalLink(pages[1].id));
    const project = unpackProject<{ pages: { frames: { component: { components: Comp[] } }[] }[] }>(
      doc.project as Uint8Array,
    );
    expect(project.pages[0].frames[0].component.components.map((c) => c.attributes?.href)).toEqual([
      "#",
      internalLink(pages[1].id),
    ]);
  });

  it("duplicar a oferta: os cartões da cópia levam às páginas de produto da cópia (e elas à vitrine da cópia)", async () => {
    const f = await storeOffer();
    const pages = await createProductPages({
      offerId: f.offerId,
      storePageId: f.store.id,
      products: [product(), product({ pageName: "Mochila", name: "Mochila" })],
    });
    await linkCards(
      f.storeDocId,
      f.storeHtml,
      pages.map((p) => p.id),
    );

    const copy = await duplicateOffer(f.offerId);
    const copied = await prisma.page.findMany({
      where: { offerId: copy.id },
      orderBy: { position: "asc" },
      select: { id: true, name: true },
    });
    expect(copied.map((p) => p.name)).toEqual(["Página principal", "Fone de ouvido sem fio", "Mochila"]);
    const [store, fone, mochila] = copied;
    expect(new Set([store.id, fone.id, mochila.id]).size).toBe(3);
    expect([store.id, fone.id, mochila.id]).not.toContain(f.store.id);

    const storeDoc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: store.id } } });
    const $ = cheerio.load(storeDoc.html ?? "");
    expect($("a[data-os-product]").eq(0).attr("href")).toBe(internalLink(fone.id));
    expect($("a[data-os-product]").eq(1).attr("href")).toBe(internalLink(mochila.id));
    const project = unpackProject<{ pages: { frames: { component: { components: Comp[] } }[] }[] }>(
      storeDoc.project as Uint8Array,
    );
    expect(project.pages[0].frames[0].component.components.map((c) => c.attributes?.href)).toEqual([
      internalLink(fone.id),
      internalLink(mochila.id),
    ]);
    for (const page of [fone, mochila]) {
      const $p = cheerio.load(await htmlOf(page.id));
      expect($p(H.logo).attr("href")).toBe(internalLink(store.id));
      expect($p(H.back).attr("href")).toBe(internalLink(store.id));
    }
    // A original continua igual.
    const original = cheerio.load(await htmlOf(f.store.id));
    expect(original("a[data-os-product]").eq(0).attr("href")).toBe(internalLink(pages[0].id));
  });
});
