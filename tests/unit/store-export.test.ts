/**
 * Vitrine de produtos fora do editor: cartões sem destino (sem página do
 * produto, link da oferta ou endereço) viram o aviso próprio do ZIP (com o
 * conserto "Abrir no editor") e o passo "produtos" do "Próximos passos"; os
 * cartões não contam como botões de compra (a não ser ligados a um link da
 * oferta de verdade); versões A/B não contam o mesmo cartão duas vezes. Da
 * revisão: "Ver todas" ligado sem destino, categorias do cabeçalho que não
 * mostram nenhum produto, carrinho/"Entre" desligados fora da conta dos botões
 * e o localizar e substituir com cartões (partes geradas refeitas).
 */

import * as cheerio from "cheerio";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  deadBackWarning,
  deadCategoriesWarning,
  deadMoreWarning,
  deadProductsWarning,
  exportWarningFix,
} from "@/lib/export/warnings";
import { createMatcher, describeAttribute, isSearchableAttribute, replaceInHtml } from "@/lib/find-replace";
import { buyButtons, computeReadiness, type ReadinessInput } from "@/lib/readiness";
import { productAttrs, productPartHtml, readProduct } from "@/lib/store";
import { backGap, categoryGaps, productGaps, storeCatalog } from "@/lib/store-pages";
import { exportPlan } from "@/server/services/export";
import { createOffer } from "@/server/services/offers";
import { getOfferReadiness } from "@/server/services/readiness";
import { createVariant } from "@/server/services/variants";
import { resetDatabase } from "../setup/per-file";
import { removeExportFiles } from "./export-fixture";

const END =
  "abra a página no editor e use “Criar as páginas que faltam”, nas Configurações da vitrine (ou clique no produto e escolha a página dele).";

/** Cartão como o editor salva (as partes geradas não importam aqui). */
const cardHtml = (name: string, attrs = 'href="#"') =>
  `<a class="os-pd-card" data-os-product="" ${attrs} data-os-pd-price="9990"><div class="os-pd-body"><h3 class="os-pd-name">${name}</h3></div></a>`;

const showcase = (title: string, cards: string[]) =>
  `<section class="os-products" data-os-widget="products" data-os-layout="grid"><div class="os-pd-head"><h2 class="os-pd-title">${title}</h2></div><div class="os-pd-wrap"><div class="os-pd-track" data-os-pd-track="">${cards.join("")}</div></div></section>`;

describe("textos e regras", () => {
  it("aviso do ZIP: uma vitrine, várias vitrines e várias páginas; a tela reconhece o aviso", () => {
    const one = deadProductsWarning([{ name: "Loja", showcases: [{ showcase: "Mais vendidos", count: 3 }] }]);
    expect(one).toBe(`3 produtos da vitrine “Mais vendidos” na página “Loja” ainda não levam a lugar nenhum: ${END}`);
    expect(deadProductsWarning([{ name: "Loja", showcases: [{ showcase: "", count: 1 }] }])).toBe(
      `1 produto da vitrine na página “Loja” ainda não leva a lugar nenhum: ${END}`,
    );
    const many = deadProductsWarning([
      { name: "Loja", showcases: [{ showcase: "Ofertas", count: 2 }] },
      { name: "Outra", showcases: [{ showcase: "Mais vendidos", count: 1 }] },
      { name: "Sem nada", showcases: [] },
    ]);
    expect(many).toBe(`3 produtos das vitrines nas páginas “Loja” e “Outra” ainda não levam a lugar nenhum: ${END}`);
    expect(deadProductsWarning([{ name: "Loja", showcases: [{ showcase: "X", count: 0 }] }])).toBeNull();
    expect(exportWarningFix(one as string)).toEqual({ kind: "deadButtons", products: true });
    expect(exportWarningFix(many as string)).toEqual({ kind: "deadButtons", products: true });
  });

  it("cartão leva a algum lugar: página do produto, endereço ou link da oferta com destino", () => {
    const links = [
      { key: "checkout", url: "https://pay.exemplo.com/x" },
      { key: "vazio", url: "" },
      { key: "pix", url: "", pay: true },
    ];
    const html = showcase("Mais vendidos", [
      cardHtml("Sem nada"),
      cardHtml("Vazio", 'href=""'),
      cardHtml("Script", 'href="javascript:void(0)"'),
      cardHtml("Página", 'href="os-page:cabc0000000000000000000000"'),
      cardHtml("Endereço", 'href="https://loja.exemplo.com/p"'),
      cardHtml("Checkout", 'href="#" data-os-link="checkout"'),
      cardHtml("Link sem endereço", 'href="#" data-os-link="vazio"'),
      cardHtml("Pagamento", 'href="#" data-os-link="pix"'),
    ]);
    expect(productGaps(html + showcase("", [cardHtml("Outro")]), links)).toEqual([
      { showcase: "Mais vendidos", index: 0, count: 4, more: false },
      { showcase: "", index: 0, count: 1, more: false },
    ]);
    expect(productGaps("<p>sem vitrine</p>", links)).toEqual([]);
  });

  it("cartões não contam como botões de compra, a não ser ligados a um link da oferta que existe", () => {
    const html = `${showcase("Loja", [
      cardHtml("A"),
      cardHtml("B", 'href="#" data-os-link=""'),
      cardHtml("C", 'href="#" data-os-link="checkout"'),
      cardHtml("D", 'href="#" data-os-link="apagado"'),
    ])}<a href="#" data-os-link="">Comprar</a>`;
    expect(buyButtons([html], [{ key: "checkout", url: "https://pay.exemplo.com/x" }])).toEqual({
      total: 2,
      connected: 1,
    });
  });

  it("passo “produtos”: só com vitrine; não pronto com cartão sem destino, pronto com todos ligados", () => {
    const base: ReadinessInput = {
      htmls: [],
      links: [],
      clonedCheckoutUrls: [],
      pixelCount: 0,
      company: { name: "", document: "", email: "", phone: "", address: "" },
      liveUrl: null,
      lastZipAt: null,
    };
    const item = (input: Partial<ReadinessInput>) =>
      computeReadiness({ ...base, ...input }, () => "").items.find((i) => i.id === "produtos");
    expect(item({ htmls: ["<p>nada</p>"] })).toBeUndefined();
    const dead = showcase("Mais vendidos", [cardHtml("A"), cardHtml("B"), cardHtml("C", 'href="os-page:x"')]);
    expect(item({ productDocs: [{ id: "doc1", pageId: "p1", html: dead }], htmls: [dead] })).toEqual({
      id: "produtos",
      title: "Escolher a página de cada produto",
      detail:
        "2 produtos da vitrine “Mais vendidos” ainda não levam a lugar nenhum: no editor, use “Criar as páginas que faltam”, nas Configurações da vitrine (ou clique no produto e escolha a página dele).",
      done: false,
      optional: false,
      cta: "Abrir no editor",
      target: { editor: "doc1" },
    });
    // A mesma página em duas versões conta uma vez; outra página soma.
    const other = showcase("Ofertas", [cardHtml("X")]);
    expect(
      item({
        productDocs: [
          { id: "doc1", pageId: "p1", html: dead },
          { id: "doc2", pageId: "p1", html: dead },
          { id: "doc3", pageId: "p2", html: other },
        ],
      })?.detail,
    ).toBe(
      "3 produtos das vitrines de 2 páginas ainda não levam a lugar nenhum: no editor, use “Criar as páginas que faltam”, nas Configurações da vitrine (ou clique no produto e escolha a página dele).",
    );
    const ok = showcase("Mais vendidos", [cardHtml("C", 'href="os-page:x"')]);
    expect(item({ productDocs: [{ id: "doc1", pageId: "p1", html: ok }] })).toMatchObject({
      title: "Produtos da vitrine ligados",
      done: true,
      target: { editor: "doc1" },
    });
  });
});

const base: ReadinessInput = {
  htmls: [],
  links: [],
  clonedCheckoutUrls: [],
  pixelCount: 0,
  company: { name: "", document: "", email: "", phone: "", address: "" },
  liveUrl: null,
  lastZipAt: null,
};
const produtos = (input: Partial<ReadinessInput>) =>
  computeReadiness({ ...base, ...input }, () => "").items.find((i) => i.id === "produtos");

/** Cabeçalho de loja como o editor salva (só o que a análise lê). */
const headerHtml = (opts: { logo?: string; cats?: string[]; attrs?: string; cart?: string } = {}) =>
  `<header class="os-store-header" data-os-widget="store-header" data-os-sh-cats="1" data-os-sh-cart="1" data-os-sh-account="0" ${opts.attrs ?? ""}><div class="os-sh-main"><div class="os-sh-in"><a class="os-sh-logo" href="${opts.logo ?? "#"}"><img class="os-sh-logo-img" alt="Logo"></a><a class="os-sh-acc" href="#" data-os-link=""><span class="os-sh-acc-t">Entre</span></a><a class="os-sh-cart" href="#" aria-label="Carrinho" ${opts.cart ?? 'data-os-link=""'}></a></div></div><nav class="os-sh-cats"><div class="os-sh-in">${(opts.cats ?? ["Ofertas do dia", "Mais vendidos", "Casa"]).map((c) => `<a class="os-sh-cat" href="#">${c}</a>`).join("")}</div></nav></header>`;

describe("revisão: “Ver todas”, versões A/B, categorias e partes desligadas", () => {
  it("vitrines de mesmo título em versões A/B: cada uma conta (não viram uma só)", () => {
    const a = showcase("Ofertas", [cardHtml("Ligado", 'href="os-page:x"')]);
    const b = showcase("Ofertas", [cardHtml("A"), cardHtml("B")]) + showcase("Ofertas", Array(5).fill(cardHtml("C")));
    const docs = [
      { id: "docA", pageId: "p1", html: a },
      { id: "docB", pageId: "p1", html: b },
    ];
    expect(produtos({ productDocs: docs })?.detail).toMatch(/^7 produtos ainda não levam/);
    expect(produtos({ productDocs: [...docs].reverse() })?.detail).toMatch(/^7 produtos ainda não levam/);
    // A mesma vitrine nas duas versões conta uma vez (o maior número).
    expect(produtos({ productDocs: [docs[1], { id: "docC", pageId: "p1", html: b }] })?.detail).toMatch(/^7 produtos/);
  });

  it("“Ver todas” ligado sem destino: aviso do ZIP (com conserto) e passo dos “Próximos passos”", () => {
    const withMore = (href: string) =>
      showcase("Ofertas", [cardHtml("A", 'href="os-page:x"')])
        .replace('data-os-layout="grid"', 'data-os-layout="carousel" data-os-show-more="1"')
        .replace("</h2>", `</h2><a class="os-pd-more" href="${href}">Ver todas</a>`);
    expect(productGaps(withMore("#"), [])).toEqual([{ showcase: "Ofertas", index: 0, count: 0, more: true }]);
    expect(productGaps(withMore("os-page:x"), [])).toEqual([]);
    // Desligado (sem data-os-show-more="1"), não vai ao ar: nada a avisar.
    expect(productGaps(withMore("#").replace(' data-os-show-more="1"', ""), [])).toEqual([]);
    const warning = deadMoreWarning([{ name: "Loja", showcases: productGaps(withMore("#"), []) }]);
    expect(warning).toBe(
      "O “Ver todas” da vitrine “Ofertas” na página “Loja” ainda não leva a lugar nenhum: abra a página no editor, clique no “Ver todas” e escolha para onde ele leva em Configurações (ou desligue o “Ver todas” na vitrine).",
    );
    expect(exportWarningFix(warning as string)).toEqual({ kind: "deadButtons", products: true });
    // Só "Ver todas" sem destino: o aviso dos produtos não aparece.
    expect(deadProductsWarning([{ name: "Loja", showcases: productGaps(withMore("#"), []) }])).toBeNull();
    expect(produtos({ productDocs: [{ id: "d1", pageId: "p1", html: withMore("#") }] })).toMatchObject({
      title: "Escolher para onde vai o “Ver todas”",
      done: false,
      target: { editor: "d1" },
    });
  });

  it("categorias sem destino que não mostram nenhum produto: na página com vitrine, na página da loja (logo) e sem loja", () => {
    const store = showcase("Mais vendidos", [cardHtml("Fone de ouvido", 'href="os-page:x" data-os-pd-badge="Oferta"')]);
    // Página com vitrine: busca nela (título da vitrine e selo contam).
    const here = headerHtml({ cats: ["Mais vendidos", "Fones", "Ofertas", "Casa", "Moda"] }) + store;
    expect(categoryGaps(here, [], () => [])).toEqual(["Casa", "Moda"]);
    // Página sem vitrine: busca na página da loja (destino do logo).
    const catalogs = { loja: [storeCatalog(store)].filter((c) => c !== null) };
    const product = headerHtml({ logo: "os-page:loja", cats: ["Fone", "Casa"] });
    expect(categoryGaps(product, [], (id) => catalogs[id as "loja"] ?? [])).toEqual(["Casa"]);
    // Sem a página da loja, nenhuma categoria sem destino leva a lugar nenhum.
    expect(categoryGaps(headerHtml({ cats: ["Fone", "Casa"] }), [], () => [])).toEqual(["Fone", "Casa"]);
    // Logo com outro destino (endereço): não dá para conferir daqui, não avisa.
    expect(categoryGaps(headerHtml({ logo: "https://loja.exemplo.com", cats: ["Casa"] }), [], () => [])).toEqual([]);
    // Categoria com destino ou linha de categorias desligada: nada.
    const linked = headerHtml({ cats: ["Casa"] }).replace('href="#">Casa', 'href="https://x.com">Casa');
    expect(categoryGaps(linked + store, [], () => [])).toEqual([]);
    expect(
      categoryGaps(headerHtml({ attrs: 'data-os-sh-cats="0"' }).replace('data-os-sh-cats="1" ', ""), [], () => []),
    ).toEqual([]);

    const warning = deadCategoriesWarning([{ name: "Loja", categories: ["Casa", "Moda"] }]);
    expect(warning).toBe(
      "As categorias “Casa” e “Moda” do cabeçalho da página “Loja” não mostram nenhum produto: abra a página no editor, clique na categoria e escolha para onde ela leva em Configurações (ou troque o texto por uma palavra do nome dos produtos).",
    );
    expect(exportWarningFix(warning as string)).toEqual({ kind: "deadButtons", products: true });
    expect(deadCategoriesWarning([{ name: "Loja", categories: ["Casa"] }])).toMatch(
      /^A categoria “Casa” do cabeçalho da página “Loja” não mostra/,
    );

    // "Próximos passos": a categoria da página do produto confere a página da loja (outra página da oferta).
    expect(
      produtos({
        productDocs: [
          { id: "d1", pageId: "loja", html: headerHtml({ cats: ["Mais vendidos"] }) + store },
          { id: "d2", pageId: "produto", html: product },
        ],
      }),
    ).toMatchObject({
      title: "Ajustar as categorias do cabeçalho",
      detail:
        "A categoria “Casa” não mostra nenhum produto: no editor, clique na categoria e escolha para onde ela leva em Configurações (ou troque o texto por uma palavra do nome dos produtos).",
      target: { editor: "d2" },
      done: false,
    });
    // Só cabeçalho, tudo com destino: passo pronto.
    expect(
      produtos({ productDocs: [{ id: "d1", pageId: "p", html: headerHtml({ logo: "https://x.com", cats: [] }) }] }),
    ).toMatchObject({ title: "Cabeçalho de loja ligado", done: true });
  });

  it("carrinho e “Entre” desligados no cabeçalho não contam como botões de compra", () => {
    const links = [{ key: "checkout", url: "https://pay.exemplo.com/x" }];
    // Carrinho ligado pedindo link conta; "Entre" (desligado por padrão) não.
    expect(buyButtons([headerHtml()], links)).toEqual({ total: 1, connected: 0 });
    expect(
      buyButtons([headerHtml({ attrs: 'data-os-sh-cart="0"' }).replace('data-os-sh-cart="1" ', "")], links),
    ).toEqual({
      total: 0,
      connected: 0,
    });
    // Com o "Entre" ligado, ele conta.
    const account = headerHtml({ cart: 'data-os-link="checkout"' }).replace(
      'data-os-sh-account="0"',
      'data-os-sh-account="1"',
    );
    expect(buyButtons([account], links)).toEqual({ total: 2, connected: 1 });
  });

  it("localizar e substituir: textos do produto mudam no atributo e nas partes; o que é gerado não é tocado", async () => {
    const data = readProduct(productAttrs({ price: 12990, inst: 12, ship: "Frete grátis" }));
    const attrs = Object.entries(productAttrs({ price: 12990, inst: 12, ship: "Frete grátis" }))
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
    const parts = (["ship", "price"] as const)
      .map((p) => `<p class="os-pd-${p}" data-os-pd-part="${p}">${productPartHtml(p, data, "BRL")}</p>`)
      .join("");
    const html = `<!doctype html><html><head></head><body><section data-os-widget="products" data-os-currency="BRL"><a class="os-pd-card" data-os-product="" href="#" ${attrs}><h3 class="os-pd-name">Fone grátis</h3>${parts}</a></section></body></html>`;
    const ship = await replaceInHtml(html, createMatcher("Frete grátis") as never, "Envío gratis");
    // Uma ocorrência só (o atributo): o texto da parte é refeito a partir dele.
    expect(ship.count).toBe(1);
    const $ = cheerio.load(ship.html);
    expect($("a[data-os-product]").attr("data-os-pd-ship")).toBe("Envío gratis");
    expect($(".os-pd-ship").text()).toBe("Envío gratis");
    // "sem juros" é gerado (troca-se pelo "Idioma dos textos" da vitrine): a busca não mexe.
    const juros = await replaceInHtml(html, createMatcher("sem juros") as never, "sin intereses");
    expect(juros.count).toBe(0);
    expect(juros.html).toBe(html);
    // No editor, o frete aparece como "Frete do produto" (só nos cartões e na caixa de compra).
    expect(isSearchableAttribute("a", "data-os-pd-ship", { "data-os-product": "" })).toBe(true);
    expect(isSearchableAttribute("div", "data-os-pd-ship", {})).toBe(false);
    expect(describeAttribute("a", "data-os-pd-ship")).toBe("Frete do produto");
    // O nome do produto (texto comum) continua trocando normalmente.
    const name = await replaceInHtml(html, createMatcher("Fone") as never, "Auricular");
    expect(name.count).toBe(1);
    expect(cheerio.load(name.html)(".os-pd-name").text()).toBe("Auricular grátis");
  });
});

describe("revisão da fase 2: “‹ Voltar para a loja” sem destino", () => {
  const BACK_END =
    "abra a página no editor e escolha a página da loja nas Configurações do cabeçalho de loja (ou clique no “Voltar” e escolha para onde ele leva).";
  const back = (href = "#", extra = "") =>
    `<a href="${href}" class="os-pd-back" data-os-pd-back="" ${extra}>‹ Voltar para a loja</a>`;

  it("sem destino e sem a página da loja no logo: não leva a lugar nenhum para quem chega de fora", () => {
    const links = [
      { key: "checkout", url: "https://pay.exemplo.com/x" },
      { key: "vazio", url: "" },
    ];
    // Sem cabeçalho, ou com o logo sem destino: aviso.
    expect(backGap(back(), links)).toBe(true);
    expect(backGap(headerHtml() + back(), links)).toBe(true);
    expect(backGap(headerHtml({ logo: "#" }) + back("#", 'data-os-link="vazio"'), links)).toBe(true);
    // O logo leva à loja (página do funil, endereço ou link com destino): o "Voltar" vai para lá.
    expect(backGap(headerHtml({ logo: "os-page:cloja" }) + back(), links)).toBe(false);
    expect(backGap(headerHtml({ logo: "https://minhaloja.com" }) + back(), links)).toBe(false);
    // O próprio "Voltar" com destino.
    expect(backGap(back("os-page:cloja"), links)).toBe(false);
    expect(backGap(back("#", 'data-os-link="checkout"'), links)).toBe(false);
    expect(backGap("<p>sem voltar</p>", links)).toBe(false);

    const one = deadBackWarning(["Fone"]);
    expect(one).toBe(
      `O “‹ Voltar para a loja” da página “Fone” não leva a lugar nenhum para quem chega de fora do site (anúncio, link direto): ${BACK_END}`,
    );
    expect(deadBackWarning(["Fone", "Mochila"])).toMatch(
      /^O “‹ Voltar para a loja” das páginas “Fone” e “Mochila” não leva/,
    );
    expect(deadBackWarning([])).toBeNull();
    expect(exportWarningFix(one as string)).toEqual({ kind: "deadButtons", products: true });
  });
});

describe("oferta com vitrine", () => {
  beforeEach(async () => {
    await removeExportFiles();
    await resetDatabase();
  });

  it("ZIP e “Próximos passos” avisam dos produtos sem página (uma vez, mesmo com A/B); ligados, o aviso some", async () => {
    const offer = await createOffer({ name: "Loja" });
    const page = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: page.id } } });
    const setHtml = (body: string) =>
      prisma.pageDocument.updateMany({
        where: { variant: { pageId: page.id } },
        data: { html: `<!doctype html><html><head><title>T</title></head><body>${body}</body></html>` },
      });
    await setHtml(
      `${showcase("Mais vendidos", [
        cardHtml("Fone"),
        cardHtml("Relógio", 'href="#" data-os-link=""'),
        cardHtml("Caixa de som", `href="os-page:${page.id}"`),
      ])}<a href="#" data-os-link="">Comprar agora</a>`,
    );
    await createVariant({ pageId: page.id });

    const plan = await exportPlan(offer.id);
    const products = plan.warnings.filter((w) => w.endsWith(END));
    expect(products).toEqual([
      `2 produtos da vitrine “Mais vendidos” na página “${page.name}” ainda não levam a lugar nenhum: ${END}`,
    ]);
    // O cartão com data-os-link="" não entra no aviso dos botões de compra (só o botão de verdade).
    expect(plan.warnings.filter((w) => w.includes("sem link de checkout"))).toEqual([
      expect.stringContaining("O botão “Comprar agora”"),
    ]);
    expect(plan.deadButtonPages).toEqual([
      { name: page.name, documentId: doc.id, buy: true, quiz: false, wheel: false, products: true },
    ]);

    const readiness = await getOfferReadiness({ id: offer.id, liveUrl: null, links: [] });
    expect(readiness.items.find((i) => i.id === "produtos")).toMatchObject({
      title: "Escolher a página de cada produto",
      detail: expect.stringMatching(/^2 produtos da vitrine “Mais vendidos” ainda não levam/),
      done: false,
      target: { editor: doc.id },
    });
    // Só o botão de compra conta (um em cada versão A/B); os cartões não.
    expect(readiness.items.find((i) => i.id === "checkout")?.detail).toMatch(/^2 de 2 botões de compra ainda sem link/);

    await setHtml(
      showcase("Mais vendidos", [
        cardHtml("Fone", `href="os-page:${page.id}"`),
        cardHtml("Relógio", 'href="https://loja.exemplo.com/relogio"'),
      ]),
    );
    const after = await exportPlan(offer.id);
    expect(after.warnings.filter((w) => w.endsWith(END))).toEqual([]);
    expect(after.deadButtonPages).toBeUndefined();
    const ready = await getOfferReadiness({ id: offer.id, liveUrl: null, links: [] });
    expect(ready.items.find((i) => i.id === "produtos")).toMatchObject({
      title: "Produtos da vitrine ligados",
      done: true,
    });
  });

  it("cabeçalho de loja: categoria que não mostra produto vira aviso; carrinho desligado com pedido de link não", async () => {
    const offer = await createOffer({ name: "Loja" });
    const page = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: page.id } } });
    await prisma.pageDocument.update({
      where: { id: doc.id },
      data: {
        html: `<!doctype html><html><head><title>T</title></head><body>${headerHtml({
          attrs: 'data-os-sh-cart="0"',
          cats: ["Mais vendidos", "Casa"],
        }).replace('data-os-sh-cart="1" ', "")}${showcase("Mais vendidos", [
          cardHtml("Fone", `href="os-page:${page.id}"`),
        ])}</body></html>`,
      },
    });
    const plan = await exportPlan(offer.id);
    expect(plan.warnings.filter((w) => w.includes("do cabeçalho"))).toEqual([
      `A categoria “Casa” do cabeçalho da página “${page.name}” não mostra nenhum produto: abra a página no editor, clique na categoria e escolha para onde ela leva em Configurações (ou troque o texto por uma palavra do nome dos produtos).`,
    ]);
    // O carrinho desligado (com data-os-link="") não vai ao ar: nada de "sem link de checkout".
    expect(plan.warnings.filter((w) => w.includes("sem link de checkout"))).toEqual([]);
    expect(plan.deadButtonPages).toEqual([
      { name: page.name, documentId: doc.id, buy: false, quiz: false, wheel: false, products: true },
    ]);
    const readiness = await getOfferReadiness({ id: offer.id, liveUrl: null, links: [] });
    expect(readiness.items.find((i) => i.id === "produtos")).toMatchObject({
      title: "Ajustar as categorias do cabeçalho",
      done: false,
      target: { editor: doc.id },
    });
    expect(readiness.items.find((i) => i.id === "checkout")?.detail ?? "").not.toMatch(
      /botões? de compra ainda sem link/,
    );
  });

  it("página do produto sem a página da loja: o ZIP avisa do “‹ Voltar para a loja”; escolhida a loja, não", async () => {
    const offer = await createOffer({ name: "Loja", templateId: "produto" });
    const page = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: page.id } } });
    const plan = await exportPlan(offer.id);
    expect(plan.warnings.filter((w) => w.includes("‹ Voltar para a loja"))).toEqual([
      expect.stringMatching(new RegExp(`^O “‹ Voltar para a loja” da página “${page.name}” não leva a lugar nenhum`)),
    ]);
    expect(plan.deadButtonPages).toContainEqual(expect.objectContaining({ documentId: doc.id, products: true }));

    const $ = cheerio.load(doc.html ?? "");
    $(".os-sh-logo").attr("href", `os-page:${page.id}`);
    await prisma.pageDocument.update({ where: { id: doc.id }, data: { html: $.html() } });
    const after = await exportPlan(offer.id);
    expect(after.warnings.filter((w) => w.includes("‹ Voltar para a loja"))).toEqual([]);
  });
});
