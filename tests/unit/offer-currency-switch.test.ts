/**
 * Trocar a moeda da oferta troca TUDO o que tem preço nela
 * (src/server/services/offer-currency.ts + src/lib/offer-currency-switch.ts),
 * com o banco de testes:
 *
 * - vitrines e caixas de compra no HTML salvo (partes refeitas = as do modelo
 *   montado direto na moeda nova), no projeto do editor (JSON, inclusive HTML
 *   guardado como texto nele) e na cópia editável da clonagem, em todas as
 *   versões A/B e no layout do celular; os números ficam os mesmos; idioma
 *   escolhido na vitrine fica;
 * - um ponto no Histórico por cópia que muda ("Antes de trocar a moeda para
 *   …", com a página como estava) e a revisão sobe (o editor aberto antes
 *   recebe o conflito);
 * - produtos da Kyvo: moeda nova, formas que a moeda aceita (nenhuma: as do
 *   produto novo), idioma da janela que estava no padrão acompanha; valor fora
 *   da faixa vira problema (Próximos passos, aviso do ZIP); em real ficam
 *   como estão e o "Próximos passos" avisa;
 * - "Valor da oferta" dos pixels acompanha;
 * - preço escrito como texto não muda (o plano aponta);
 * - repetir não muda nada (nem cria ponto no Histórico); trocar de volta volta;
 * - ações (com o login simulado) e o salvamento das configurações com moeda.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import * as cheerio from "cheerio";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { productBuyDef } from "@/editor/widgets/product-page-content";
import { defToHtml } from "@/editor/widgets/quiz-content";
import { prisma } from "@/lib/db";
import { exportWarningFix, paymentIssueWarning } from "@/lib/export/warnings";
import { chosenOfferCurrency, offerCurrencyOf } from "@/lib/offer-currency";
import { switchHtmlCurrency, switchProjectCurrency, textPricesIn } from "@/lib/offer-currency-switch";
import { paymentIssues } from "@/lib/payments/checks";
import { amountProblem, formatAmount, switchPaymentCurrency } from "@/lib/payments/rules";
import { packProject, unpackProject } from "@/lib/project-data";
import { getObject } from "@/lib/storage";
import { getCurrencySwitchPlanAction, switchOfferCurrencyAction } from "@/server/actions/offer-settings";
import {
  getEditorPayload,
  RevisionConflictError,
  restoreVersion,
  saveEditorDocument,
} from "@/server/services/documents";
import { exportPlan } from "@/server/services/export/plan";
import { currencySwitchPlan, storeCurrencyMismatch, switchOfferCurrency } from "@/server/services/offer-currency";
import { createOfferLink, listOfferLinks } from "@/server/services/offer-links";
import { getOfferSettingsPanel, saveOfferSettings } from "@/server/services/offer-settings";
import { createOffer } from "@/server/services/offers";
import { pageStart } from "@/server/services/page-templates";
import { createPage } from "@/server/services/pages";
import { offerPaymentCheck } from "@/server/services/payments/checks";
import { savePaymentGatewayKey } from "@/server/services/payments/gateways";
import { savePaymentProduct } from "@/server/services/payments/products";
import { getOfferReadiness } from "@/server/services/readiness";
import { createPixel, getTrackingSettings, saveTrackingSettings } from "@/server/services/tracking";
import { createVariant } from "@/server/services/variants";
import { resetDatabase } from "../setup/per-file";
import { KYVO_KEY } from "./kyvo-fake";

beforeEach(async () => {
  await resetDatabase();
});

const LABEL_MXN = "Antes do peso mexicano";
/** HTML de um modelo montado na moeda (como a página nova nasce). */
const tpl = (id: string, title: string, currency: "BRL" | "MXN" | "EUR" | "USD") => pageStart(id, title, currency).html;
/** "Com SPEI, o valor máximo é MX$ 25.000,00 por compra." (com o espaço do Intl). */
const SPEI_MAX = `Com SPEI, o valor máximo é ${formatAmount(2_500_000, "MXN")} por compra.`;

/** Moedas (data-os-currency) das vitrines e caixas de compra de um HTML. */
function currencies(html: string | null) {
  const $ = cheerio.load(html ?? "");
  return $("[data-os-currency]")
    .map((_, el) => $(el).attr("data-os-currency"))
    .get();
}

/** Frases de preço para leitores de tela (uma por produto). */
function prices(html: string | null) {
  const $ = cheerio.load(html ?? "");
  return $(".os-pd-price .os-pd-sr")
    .map((_, el) => $(el).text())
    .get();
}

/** HTML das vitrines e caixas (o que a troca refaz), para comparar com o modelo montado na moeda. */
function widgets(html: string | null) {
  const $ = cheerio.load(html ?? "");
  return $('[data-os-widget="products"], [data-os-widget="product-buy"]')
    .map((_, el) => $.html(el))
    .get();
}

async function docsOf(offerId: string) {
  return prisma.pageDocument.findMany({
    where: { variant: { page: { offerId } } },
    orderBy: [{ variant: { page: { position: "asc" } } }, { variant: { position: "asc" } }, { device: "asc" }],
    select: {
      id: true,
      device: true,
      revision: true,
      html: true,
      project: true,
      editableHtml: true,
      variant: { select: { name: true, page: { select: { id: true, name: true } } } },
    },
  });
}

/** Projeto do editor (JSON) com uma vitrine e uma caixa de compra guardada como HTML num texto. */
function projectWith(currency: string) {
  const buy = defToHtml(
    productBuyDef(
      { name: "Kit", data: { price: 4990, old: 5990, inst: 3 }, currency: currency as "BRL" },
      { html: true },
    ),
  );
  return {
    assets: [],
    styles: [],
    pages: [
      {
        frames: [
          {
            component: {
              type: "wrapper",
              components: [
                {
                  type: "os-products",
                  tagName: "section",
                  attributes: { "data-os-widget": "products", "data-os-currency": currency, "data-os-layout": "grid" },
                  components: [
                    {
                      type: "os-product",
                      tagName: "a",
                      attributes: { href: "#", "data-os-product": "", "data-os-pd-price": "12990" },
                      components: [
                        { type: "os-product-part", tagName: "div", attributes: { "data-os-pd-part": "price" } },
                      ],
                    },
                  ],
                },
                { tagName: "div", content: buy },
                { type: "text", tagName: "p", components: [{ type: "textnode", content: "Só R$ 297 hoje" }] },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** Lê o arquivo de um ponto do Histórico (como o editor restaura). */
async function snapshotOf(storageKey: string) {
  return JSON.parse(gunzipSync(await getObject(storageKey)).toString("utf8")) as {
    project: unknown;
    html: string | null;
    preserve?: { editableHtml: string | null } | null;
  };
}

/**
 * Oferta em real com: loja (vitrines; versão B; layout do celular com projeto
 * do editor salvo), página do produto (caixa de compra), página clonada "Com
 * scripts" com a cópia editável e a página de vendas (preço escrito em R$).
 */
async function storeOffer() {
  const offer = await createOffer({ name: "Loja", templateId: "loja", currency: "BRL" });
  const store = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
  // Celular separado: o computador com o projeto do editor; o celular com o HTML do modelo.
  const desktop = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: store.id } } });
  await prisma.pageDocument.update({
    where: { id: desktop.id },
    data: { device: "DESKTOP", project: packProject(projectWith("BRL")) },
  });
  await prisma.pageDocument.create({
    data: { variantId: desktop.variantId, device: "MOBILE", html: tpl("loja", "Loja", "BRL") },
  });
  const variantB = await createVariant({ pageId: store.id, source: { kind: "copy" } });
  const product = await createPage({ offerId: offer.id, name: "Produto", templateId: "produto" });
  const cloned = await createPage({ offerId: offer.id, name: "Clonada" });
  await prisma.page.update({ where: { id: cloned.id }, data: { cloneMode: "PRESERVE_JS" } });
  await prisma.pageDocument.updateMany({
    where: { variant: { pageId: cloned.id } },
    data: {
      html: "<!DOCTYPE html><html><head><script>/* do site */</script></head><body><p>Promo R$ 99,90</p></body></html>",
      editableHtml: tpl("loja", "Clonada", "BRL"),
      assetMap: {},
    },
  });
  const sales = await createPage({ offerId: offer.id, name: "Vendas", templateId: "vendas-longa" });
  return { offer, store, desktop, variantB, product, cloned, sales };
}

describe("regras dos documentos (src/lib/offer-currency-switch.ts)", () => {
  it("HTML: a vitrine e a caixa trocadas ficam iguais às dos modelos montados na moeda nova", () => {
    for (const [template, to] of [
      ["loja", "MXN"],
      ["loja", "EUR"],
      ["produto", "USD"],
      ["produto", "MXN"],
    ] as const) {
      const brl = tpl(template, "P", "BRL");
      const r = switchHtmlCurrency(brl, to);
      expect(r.hosts.length, `${template} ${to}`).toBeGreaterThan(0);
      expect(widgets(r.html), `${template} ${to}`).toEqual(widgets(tpl(template, "P", to)));
      // Os números ficam: só a moeda muda.
      expect(cheerio.load(r.html)("[data-os-pd-price]").first().attr("data-os-pd-price")).toBe(
        cheerio.load(brl)("[data-os-pd-price]").first().attr("data-os-pd-price"),
      );
      // De novo na mesma moeda: nada muda (o HTML volta intacto).
      expect(switchHtmlCurrency(r.html, to)).toEqual({ html: r.html, hosts: [] });
    }
    // Sem vitrine nem caixa: intacto (sem passar pelo cheerio).
    const plain = "<!doctype html><html><body><p>R$ 10</p></body></html>";
    expect(switchHtmlCurrency(plain, "MXN")).toEqual({ html: plain, hosts: [] });
  });

  it("idioma escolhido na vitrine fica; sem escolha, acompanha a moeda (com o nome das setas)", () => {
    const html = tpl("loja", "Loja", "BRL").replace(
      'data-os-widget="products"',
      'data-os-widget="products" data-os-pd-lang="pt"',
    );
    const r = switchHtmlCurrency(html, "MXN");
    const $ = cheerio.load(r.html);
    const first = $('[data-os-widget="products"]').first();
    expect(first.attr("data-os-pd-lang")).toBe("pt");
    expect(first.find(".os-pd-inst").first().text()).toMatch(/^\d+x \$[\d.,]+ sem juros$/);
    // As outras vitrines (sem idioma escolhido) ficam em espanhol, setas também.
    const others = $('[data-os-widget="products"]').slice(1).find(".os-pd-inst.os-pd-free");
    expect(others.length).toBeGreaterThan(0);
    for (const el of others.toArray()) expect($(el).text()).toMatch(/^\d+x \$[\d.,]+ sin intereses$/);
    expect($(".os-pd-nav.os-pd-next .os-pd-sr").last().text()).toBe("Siguiente");
  });

  it("projeto do editor: atributo trocado (as partes o editor refaz) e HTML guardado como texto também", () => {
    const project = projectWith("BRL");
    const r = switchProjectCurrency(project, "MXN");
    expect(r.count).toBe(2);
    const json = JSON.stringify(r.project);
    expect(json).toContain('"data-os-currency":"MXN"');
    expect(json).not.toContain('data-os-currency=\\"BRL\\"');
    expect(json).toContain("$49.90");
    // O texto escrito no parágrafo não muda; o projeto recebido também não.
    expect(json).toContain("Só R$ 297 hoje");
    expect(JSON.stringify(project)).toContain('"data-os-currency":"BRL"');
    expect(switchProjectCurrency(r.project, "MXN")).toEqual({ project: r.project, count: 0 });
  });

  it("preço escrito como texto: acha o da moeda de antes, fora das partes geradas", () => {
    expect(textPricesIn(tpl("vendas-longa", "V", "BRL"), "BRL").length).toBeGreaterThan(0);
    // A vitrine em real não conta (as partes geradas mudam com a troca).
    expect(textPricesIn(tpl("loja", "L", "BRL"), "BRL")).toEqual([]);
    const html =
      "<html><head><title>R$ 1</title></head><body><p>Hoje $497 MXN, antes US$ 99 e R$ 49,90.</p></body></html>";
    expect(textPricesIn(html, "BRL")).toEqual(["R$ 49,90"]);
    expect(textPricesIn(html, "USD")).toEqual(["US$ 99"]);
    expect(textPricesIn(html, "MXN")).toEqual(["$497 MXN"]);
  });

  it("produto da Kyvo numa moeda nova: formas que ficam, padrão quando nenhuma sobra, idioma que acompanha", () => {
    // O SPEI (que o euro não aceitava: não havia como marcar) entra ao chegar no peso.
    expect(switchPaymentCurrency({ currency: "EUR", methods: ["CARD", "BIZUM"], locale: "ES" }, "MXN", 4990)).toEqual({
      currency: "MXN",
      methods: ["SPEI", "CARD"],
      locale: "ES",
    });
    // …só quando o valor cabe na faixa dele (até MX$ 25.000): senão fica o cartão.
    expect(switchPaymentCurrency({ currency: "USD", methods: ["CARD"], locale: "EN" }, "MXN", 3_000_000)).toEqual({
      currency: "MXN",
      methods: ["CARD"],
      locale: "ES",
    });
    // Nenhuma sobra: as do produto novo nessa moeda (o valor fora da faixa vira problema do produto).
    expect(
      switchPaymentCurrency({ currency: "EUR", methods: ["BIZUM", "MB_WAY"], locale: "ES" }, "MXN", 3_000_000),
    ).toEqual({
      currency: "MXN",
      methods: ["SPEI", "CARD"],
      locale: "ES",
    });
    // Bizum e MB WAY (que o dólar não aceitava) entram ao chegar no euro.
    expect(switchPaymentCurrency({ currency: "USD", methods: ["CARD"], locale: "EN" }, "EUR")).toEqual({
      currency: "EUR",
      methods: ["CARD", "BIZUM", "MB_WAY"],
      locale: "ES",
    });
    // Ida e volta pelo euro e pelo dólar: o SPEI do produto do México não se perde.
    let p = { currency: "MXN" as const, methods: ["SPEI", "CARD"] as ("SPEI" | "CARD")[], locale: "ES" as const };
    let setup = switchPaymentCurrency(p, "EUR", 49_700);
    setup = switchPaymentCurrency(setup, "USD", 49_700);
    setup = switchPaymentCurrency(setup, "MXN", 49_700);
    expect(setup).toEqual({ currency: "MXN", methods: ["SPEI", "CARD"], locale: "ES" });
    // Escolhida à parte (só cartão no peso): continua só o cartão enquanto a moeda for a mesma.
    p = { ...p, methods: ["CARD"] };
    expect(switchPaymentCurrency(p, "MXN", 49_700).methods).toEqual(["CARD"]);
    // Idioma escolhido à parte (não é o padrão da moeda de antes): fica.
    expect(switchPaymentCurrency({ currency: "MXN", methods: ["SPEI"], locale: "PT" }, "USD")).toEqual({
      currency: "USD",
      methods: ["CARD"],
      locale: "PT",
    });
    expect(amountProblem(3_000_000, "MXN", ["SPEI", "CARD"])).toBe(SPEI_MAX);
    expect(amountProblem(3_000_000, "MXN", ["CARD"])).toBeNull();
    expect(amountProblem(50, "EUR", ["CARD"])).toBe(`O valor mínimo é ${formatAmount(100, "EUR")}.`);
  });
});

describe("trocar a moeda da oferta (serviço e banco)", () => {
  it("todas as páginas: HTML, projeto, cópia editável, versões A/B e celular — com o ponto no Histórico", async () => {
    const o = await storeOffer();
    const before = await docsOf(o.offer.id);
    const original = new Map(before.map((d) => [d.id, d]));

    const plan = await currencySwitchPlan(o.offer.id, "MXN");
    expect(plan.from).toBe("BRL");
    expect(plan.to).toBe("MXN");
    expect(plan.pages.map((p) => p.pageName)).toEqual([o.store.name, "Produto", "Clonada"]);
    const loja = plan.pages[0];
    expect(loja.showcases).toBe(5);
    expect(loja.alsoIn).toBe("nas versões A e B e no layout do celular");
    expect(plan.pages[1]).toMatchObject({ showcases: 0, buyBoxes: 1, alsoIn: null });
    // Os mesmos números na moeda nova.
    expect(plan.products[0]).toMatchObject({ pageName: o.store.name });
    for (const p of plan.products) {
      if (p.before) expect(p.after?.replace(/[^\d]/g, "")).toBe(p.before.replace(/[^\d]/g, ""));
    }
    // No formato do painel (um formato só no diálogo: "$129.90" pareceria dólar).
    expect(
      plan.products.some((p) => p.before === formatAmount(12_990, "BRL") && p.after === formatAmount(12_990, "MXN")),
    ).toBe(true);
    expect(plan.textPrices.map((t) => t.pageName)).toEqual(["Clonada", "Vendas"]);
    expect(plan.textPrices[0].examples).toEqual(["R$ 99,90"]);
    // Loja: computador e celular das versões A e B; Produto: 1; Clonada: 1 (a cópia editável).
    expect(plan.documents).toBe(6);
    expect(plan.payments).toEqual([]);
    // Sem pixel ligado nem "Valor da oferta" salvo: nada a dizer sobre pixels.
    expect(plan.pixel).toBeNull();
    // Com um pixel ligado (sem valor): a moeda enviada a ele muda.
    const pixel = await createPixel(o.offer.id, { vendor: "META", pixelId: "123456789012345" });
    expect((await currencySwitchPlan(o.offer.id, "MXN")).pixel).toEqual({ from: "BRL", to: "MXN", amount: null });
    // O plano não grava nada.
    expect((await docsOf(o.offer.id)).map((d) => d.revision)).toEqual(before.map((d) => d.revision));

    const result = await switchOfferCurrency(o.offer.id, "MXN");
    expect(result).toMatchObject({
      from: "BRL",
      to: "MXN",
      showcases: 10,
      buyBoxes: 1,
      pages: 3,
      documents: 6,
      payments: 0,
      paymentsKept: 0,
      pixel: true,
      textPricePages: 2,
    });
    await prisma.pixelConfig.delete({ where: { id: pixel.id } });
    expect(offerCurrencyOf((await prisma.offer.findUniqueOrThrow({ where: { id: o.offer.id } })).settings)).toBe("MXN");

    const after = await docsOf(o.offer.id);
    for (const doc of after) {
      const old = original.get(doc.id);
      if (!old) throw new Error("documento novo");
      const page = doc.variant.page.name;
      if (page === "Vendas") {
        // Sem vitrine: nada muda (o R$ escrito fica), sem ponto no Histórico.
        expect(doc.html).toBe(old.html);
        expect(doc.revision).toBe(old.revision);
        continue;
      }
      expect(doc.revision, page).toBe(old.revision + 1);
      if (page === "Clonada") {
        expect(doc.html).toBe(old.html);
        expect(currencies(doc.editableHtml)).toEqual(Array(5).fill("MXN"));
      } else {
        expect(new Set(currencies(doc.html)), `${page} ${doc.device}`).toEqual(new Set(["MXN"]));
        expect(doc.html).not.toContain(">R$<");
        for (const text of prices(doc.html)) expect(text, page).not.toContain("R$");
      }
      const versions = await prisma.pageVersion.findMany({ where: { documentId: doc.id } });
      expect(versions.map((v) => [v.kind, v.label])).toEqual([["BULK_REPLACE", LABEL_MXN]]);
      const snap = await snapshotOf(versions[0].storageKey);
      expect(snap.html).toBe(old.html);
      if (page === "Clonada") expect(snap.preserve?.editableHtml).toBe(old.editableHtml);
    }
    // O projeto do editor (computador da loja) também.
    const desktop = after.find((d) => d.id === o.desktop.id);
    const project = JSON.stringify(unpackProject(desktop?.project as Uint8Array));
    expect(project).toContain('"data-os-currency":"MXN"');
    expect(project).not.toContain('"data-os-currency":"BRL"');
    // O editor abre na moeda nova (o contexto dos widgets também).
    const payload = await getEditorPayload(o.desktop.id);
    expect(payload.offer.currency).toBe("MXN");
    expect(JSON.stringify(payload.project)).toContain('"data-os-currency":"MXN"');
    // Editor aberto antes da troca: a gravação dele dá o conflito de sempre (não volta para real).
    await expect(
      saveEditorDocument({
        documentId: o.desktop.id,
        revision: original.get(o.desktop.id)?.revision ?? 0,
        project: projectWith("BRL"),
        html: "<!doctype html><html><body></body></html>",
        css: "",
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);

    // De novo em peso: nada muda, nenhum ponto novo no Histórico.
    const again = await switchOfferCurrency(o.offer.id, "MXN");
    expect(again).toMatchObject({ documents: 0, showcases: 0, buyBoxes: 0, pages: 0, pixel: false });
    expect(await prisma.pageVersion.count()).toBe(6);
    expect((await docsOf(o.offer.id)).map((d) => d.revision)).toEqual(after.map((d) => d.revision));

    // De volta para real: as partes voltam a ser as de antes.
    await switchOfferCurrency(o.offer.id, "BRL");
    const back = await docsOf(o.offer.id);
    for (const doc of back) {
      const old = original.get(doc.id);
      expect(widgets(doc.html), doc.variant.page.name).toEqual(widgets(old?.html ?? null));
      expect(widgets(doc.editableHtml)).toEqual(widgets(old?.editableHtml ?? null));
    }
    expect(await prisma.pageVersion.count({ where: { label: "Antes do real" } })).toBe(6);
  });

  it("pagamento na página: moeda, formas e idioma; valor fora da faixa vira problema; pixels acompanham", async () => {
    const offer = await createOffer({ name: "Curso", currency: "EUR" });
    const thanks = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
    const product = (name: string, amount: string, methods: string[], locale: string, currency = "EUR") => ({
      name,
      amount,
      currency: currency as "EUR",
      methods: methods as ["CARD"],
      locale: locale as "ES",
      thankYouPageId: thanks.id,
      accessUrl: "https://membros.exemplo.com/x",
    });
    const links = [];
    for (const [label, input] of [
      ["Checkout", product("Curso", "49,90", ["CARD", "BIZUM"], "ES")],
      ["Upsell", product("Mentoria", "30.000,00", ["BIZUM", "MB_WAY"], "ES")],
      ["Downsell", product("Ebook", "19,00", ["CARD"], "EN", "USD")],
      ["Order bump", product("Bônus", "9,90", ["CARD"], "PT")],
    ] as const) {
      const link = await createOfferLink(offer.id, {
        label,
        url: "",
        kind: label === "Checkout" ? "CHECKOUT" : "UPSELL",
      });
      await savePaymentProduct(link.id, input);
      links.push(link);
    }
    await savePaymentGatewayKey(offer.id, "KYVO", KYVO_KEY);
    // Um link desligado (leva ao endereço): o produto guardado acompanha também.
    await prisma.offerLink.update({ where: { id: links[3].id }, data: { target: "URL" } });
    await saveTrackingSettings(offer.id, { value: { currency: "EUR", amount: 49.9 } });

    const plan = await currencySwitchPlan(offer.id, "MXN");
    expect(plan.paymentsKept).toBe(false);
    // O SPEI entra (o euro e o dólar não o aceitavam) quando o valor cabe na faixa dele.
    expect(plan.payments.map((p) => [p.label, p.active, p.after?.currency, p.after?.methods, p.after?.locale])).toEqual(
      [
        ["Checkout", true, "MXN", ["SPEI", "CARD"], "ES"],
        ["Upsell", true, "MXN", ["SPEI", "CARD"], "ES"],
        ["Downsell", true, "MXN", ["SPEI", "CARD"], "ES"],
        ["Order bump", false, "MXN", ["SPEI", "CARD"], "PT"],
      ],
    );
    expect(plan.payments[0].after?.price).toBe(formatAmount(4990, "MXN"));
    expect(plan.payments[1].problem).toBe(SPEI_MAX);
    expect(plan.payments.filter((p) => p.problem).length).toBe(1);
    expect(plan.pixel).toEqual({ from: "EUR", to: "MXN", amount: 49.9 });

    const result = await switchOfferCurrencyAction({ offerId: offer.id, currency: "MXN" });
    expect(result).toMatchObject({
      ok: true,
      data: {
        payments: 4,
        paymentsKept: 0,
        pixel: true,
        paymentProblems: [{ linkId: links[1].id, label: "Upsell", problem: plan.payments[1].problem }],
      },
    });
    const saved = await listOfferLinks(offer.id);
    expect(
      saved.map((l) => [l.label, l.payment?.currency, l.payment?.methods, l.payment?.locale, l.payment?.amount]),
    ).toEqual([
      ["Checkout", "MXN", ["SPEI", "CARD"], "ES", "49,90"],
      ["Upsell", "MXN", ["SPEI", "CARD"], "ES", "30.000,00"],
      ["Downsell", "MXN", ["SPEI", "CARD"], "ES", "19,00"],
      ["Order bump", "MXN", ["SPEI", "CARD"], "PT", "9,90"],
    ]);
    expect((await getTrackingSettings(offer.id)).value).toEqual({ currency: "MXN", amount: 49.9 });

    // O valor fora da faixa não passa calado: Próximos passos e aviso do ZIP.
    const check = await offerPaymentCheck(offer.id);
    const issues = paymentIssues(check as NonNullable<typeof check>).filter((i) => i.kind === "product");
    expect(issues).toEqual([expect.objectContaining({ label: "Upsell", amount: SPEI_MAX })]);
    // Só o valor não serve: o aviso pede para ajustar o valor (não "completar o pagamento"), com o atalho do link.
    const warning = paymentIssueWarning(issues[0]);
    expect(warning).toBe(
      `O link “Upsell” (pagamento na página) tem um valor que a Kyvo recusa: ${SPEI_MAX} No site publicado, o comprador vê “pagamento indisponível”. Para resolver, abra o link em “Links e checkouts”, ajuste o valor ou as formas de pagamento e gere o ZIP de novo.`,
    );
    expect(exportWarningFix(warning)).toEqual({ kind: "paymentLink" });
    // Faltando algo além do valor, o fim continua "complete o pagamento na página".
    expect(paymentIssueWarning({ ...issues[0], thankYou: true } as (typeof issues)[number])).toMatch(
      /complete o pagamento na página e gere o ZIP de novo\.$/,
    );
    const readiness = await getOfferReadiness({ id: offer.id, liveUrl: null, links: saved });
    const step = readiness.items.find((i) => i.id === "pagamento");
    expect(step).toMatchObject({
      title: "Ajustar o valor de “Upsell”",
      target: { link: links[1].id },
      done: false,
    });
    expect(step?.detail).toContain(SPEI_MAX);
    // Tudo na moeda da oferta: o passo da moeda do pagamento não aparece.
    expect(readiness.items.some((i) => i.id === "moeda-pagamento")).toBe(false);
  });

  it("real: a Kyvo não cobra em real — os produtos ficam e o Próximos passos avisa; o resto troca", async () => {
    const offer = await createOffer({ name: "Loja", templateId: "loja", currency: "MXN" });
    const link = await createOfferLink(offer.id, { label: "Checkout", url: "", kind: "CHECKOUT" });
    await savePaymentProduct(link.id, {
      name: "Curso",
      amount: "497",
      currency: "MXN",
      methods: ["SPEI", "CARD"],
      locale: "ES",
      thankYouPageId: null,
      accessUrl: "",
    });
    const plan = await currencySwitchPlan(offer.id, "BRL");
    expect(plan.paymentsKept).toBe(true);
    expect(plan.payments).toEqual([
      expect.objectContaining({
        label: "Checkout",
        after: null,
        problem: null,
        before: expect.objectContaining({ currency: "MXN", price: formatAmount(49_700, "MXN") }),
      }),
    ]);
    const result = await switchOfferCurrency(offer.id, "BRL");
    expect(result).toMatchObject({ payments: 0, paymentsKept: 1, showcases: 5 });
    const [saved] = await listOfferLinks(offer.id);
    expect(saved.payment).toMatchObject({ currency: "MXN", methods: ["SPEI", "CARD"], locale: "ES" });
    const home = (await docsOf(offer.id))[0];
    expect(new Set(currencies(home.html))).toEqual(new Set(["BRL"]));
    const readiness = await getOfferReadiness({ id: offer.id, liveUrl: null, links: await listOfferLinks(offer.id) });
    expect(readiness.items.find((i) => i.id === "moeda-pagamento")).toEqual({
      id: "moeda-pagamento",
      title: "Conferir a moeda do pagamento na página",
      detail:
        "A oferta roda em real, mas a Kyvo não cobra em real: “Checkout” cobra em peso mexicano. Para vender no Brasil, use no link um checkout em real (Hotmart, Kiwify…); para vender fora, troque a moeda da oferta em “Moeda, empresa e SEO”.",
      done: false,
      optional: true,
      cta: "Abrir o link",
      target: { link: link.id },
    });
  });

  it("ações e configurações: plano sem gravar, moeda inválida recusada, salvar a moeda troca tudo", async () => {
    const offer = await createOffer({ name: "Loja", templateId: "loja", currency: "BRL" });
    const plan = await getCurrencySwitchPlanAction({ offerId: offer.id, currency: "USD" });
    expect(plan).toMatchObject({ ok: true, data: { from: "BRL", to: "USD", documents: 1 } });
    expect(await prisma.pageVersion.count()).toBe(0);
    expect(await getCurrencySwitchPlanAction({ offerId: offer.id, currency: "ARS" as never })).toEqual({
      ok: false,
      error: "Escolha a moeda da oferta.",
      field: "currency",
    });
    expect(await switchOfferCurrencyAction({ offerId: "nao-existe", currency: "USD" })).toMatchObject({
      ok: false,
      error: "Oferta não encontrada. Ela pode ter sido excluída.",
    });
    // Salvar a moeda pelas configurações também troca o que já existe (nunca só o símbolo).
    const saved = await saveOfferSettings(offer.id, { currency: "EUR", company: { name: "ACME" } });
    expect(saved).toMatchObject({ currency: "EUR", company: { name: "ACME" } });
    const [home] = await docsOf(offer.id);
    expect(new Set(currencies(home.html))).toEqual(new Set(["EUR"]));
    expect(await prisma.pageVersion.count({ where: { label: "Antes do euro" } })).toBe(1);
  });
});

describe("página que voltou para a moeda de antes", () => {
  const readinessOf = async (offerId: string) =>
    getOfferReadiness({ id: offerId, liveUrl: null, links: await listOfferLinks(offerId) });
  const STORE_WARNING_RE = /mas a oferta roda em/;

  it("editor aberto antes da troca: o conflito traz a moeda de agora e “Manter a minha” grava nela", async () => {
    const o = await storeOffer();
    const opened = (await docsOf(o.offer.id)).find((d) => d.id === o.desktop.id);
    await switchOfferCurrency(o.offer.id, "MXN");
    const now = (await docsOf(o.offer.id)).find((d) => d.id === o.desktop.id);
    const stale = {
      documentId: o.desktop.id,
      project: projectWith("BRL"),
      html: tpl("loja", "Loja", "BRL"),
      css: "",
      currency: "BRL" as const,
    };
    const conflict = await saveEditorDocument({ ...stale, revision: opened?.revision ?? 0 }).catch((e) => e);
    expect(conflict).toBeInstanceOf(RevisionConflictError);
    expect(conflict.currency).toBe("MXN");

    // "Manter a minha": a revisão nova e a moeda que o editor conhecia → a página vai em peso, não volta a real.
    const saved = await saveEditorDocument({ ...stale, revision: now?.revision ?? 0 });
    expect(saved.currency).toBe("MXN");
    expect(saved.currencySwitched).toBeGreaterThan(0);
    const after = (await docsOf(o.offer.id)).find((d) => d.id === o.desktop.id);
    expect(new Set(currencies(after?.html ?? null))).toEqual(new Set(["MXN"]));
    for (const text of prices(after?.html ?? null)) expect(text).not.toContain("R$");
    const project = JSON.stringify(unpackProject(after?.project as Uint8Array));
    expect(project).toContain('"data-os-currency":"MXN"');
    expect(project).not.toContain('"data-os-currency":"BRL"');
    expect(project).not.toContain('data-os-currency=\\"BRL\\"');
    expect(await storeCurrencyMismatch(o.offer.id)).toEqual({ currency: "MXN", pages: [] });

    // Editor em dia (já em peso): grava como está — o campo Moeda de uma vitrine continua valendo.
    const usd = switchHtmlCurrency(tpl("loja", "Loja", "MXN"), "USD").html;
    const again = await saveEditorDocument({
      ...stale,
      revision: after?.revision ?? 0,
      project: projectWith("USD"),
      html: usd,
      currency: "MXN",
    });
    expect(again.currencySwitched).toBe(0);
    const kept = (await docsOf(o.offer.id)).find((d) => d.id === o.desktop.id);
    expect(new Set(currencies(kept?.html ?? null))).toEqual(new Set(["USD"]));
    // …e aparece como página fora da moeda da oferta.
    expect(await storeCurrencyMismatch(o.offer.id)).toEqual({
      currency: "MXN",
      pages: [{ pageId: o.store.id, pageName: o.store.name, hosts: 5, currencies: ["USD"] }],
    });
  });

  it("Histórico: a página volta para real; Próximos passos, ZIP e cartão avisam; “Passar tudo para …” conserta", async () => {
    const o = await storeOffer();
    await switchOfferCurrency(o.offer.id, "MXN");
    expect(await storeCurrencyMismatch(o.offer.id)).toEqual({ currency: "MXN", pages: [] });
    expect((await readinessOf(o.offer.id)).items.some((i) => i.id === "moeda-vitrines")).toBe(false);

    // Restaurar o ponto de antes da troca na página do produto: só ela volta para real.
    const productDoc = (await docsOf(o.offer.id)).find((d) => d.variant.page.name === "Produto");
    if (!productDoc) throw new Error("sem a página do produto");
    const [point] = await prisma.pageVersion.findMany({ where: { documentId: productDoc.id } });
    expect(point.label).toBe(LABEL_MXN);
    await restoreVersion(productDoc.id, point.id);
    const mismatch = await storeCurrencyMismatch(o.offer.id);
    expect(mismatch).toEqual({
      currency: "MXN",
      pages: [{ pageId: o.product.id, pageName: "Produto", hosts: 1, currencies: ["BRL"] }],
    });

    // Próximos passos: passo obrigatório que leva ao cartão da moeda.
    expect((await readinessOf(o.offer.id)).items.find((i) => i.id === "moeda-vitrines")).toEqual({
      id: "moeda-vitrines",
      title: "Passar as vitrines para peso mexicano",
      detail:
        "A vitrine (ou caixa de compra) da página “Produto” ainda mostra os preços em real, mas a oferta roda em peso mexicano. Acontece quando uma página volta pelo Histórico a um ponto de antes da troca da moeda, ou é gravada por um editor aberto antes dela. No cartão “Moeda da oferta”, use “Passar tudo para peso mexicano”.",
      done: false,
      optional: false,
      cta: "Abrir a moeda da oferta",
      target: { setting: "moeda" },
    });
    // Aviso do ZIP, com o atalho para o cartão.
    const warning = (await exportPlan(o.offer.id)).warnings.find((w) => STORE_WARNING_RE.test(w));
    expect(warning).toBe(
      "A vitrine (ou caixa de compra) da página “Produto” ainda mostra os preços em real, mas a oferta roda em peso mexicano. Para resolver, passe tudo para a moeda da oferta no cartão “Moeda da oferta” (aba “Moeda, empresa e SEO”) e gere o ZIP de novo.",
    );
    expect(exportWarningFix(warning ?? "")).toEqual({ kind: "currency" });
    // Cartão da moeda.
    expect((await getOfferSettingsPanel(o.offer.id))?.currencyMismatch).toEqual(mismatch);

    // "Passar tudo para peso mexicano" (a moeda que a oferta já tem): só o que ficou fora muda.
    const plan = await currencySwitchPlan(o.offer.id, "MXN");
    expect(plan).toMatchObject({ from: "MXN", to: "MXN", documents: 1, payments: [], pixel: null });
    expect(plan.pages.map((p) => [p.pageName, p.buyBoxes])).toEqual([["Produto", 1]]);
    // Nada sobre texto escrito (a moeda da oferta não muda).
    expect(plan.textPrices).toEqual([]);
    const result = await switchOfferCurrency(o.offer.id, "MXN");
    expect(result).toMatchObject({ from: "MXN", to: "MXN", documents: 1, buyBoxes: 1, pages: 1, textPricePages: 0 });
    const fixed = (await docsOf(o.offer.id)).find((d) => d.id === productDoc.id);
    expect(currencies(fixed?.html ?? null)).toEqual(["MXN"]);
    expect(await storeCurrencyMismatch(o.offer.id)).toEqual({ currency: "MXN", pages: [] });
    expect((await readinessOf(o.offer.id)).items.some((i) => i.id === "moeda-vitrines")).toBe(false);
    expect((await exportPlan(o.offer.id)).warnings.some((w) => STORE_WARNING_RE.test(w))).toBe(false);
    expect((await getOfferSettingsPanel(o.offer.id))?.currencyMismatch).toBeNull();
    const labels = (await prisma.pageVersion.findMany({ where: { documentId: productDoc.id } })).map((v) => v.label);
    expect(labels.filter((l) => l === LABEL_MXN)).toHaveLength(2);
  });

  it("oferta de antes da pergunta (sem moeda escolhida): nada é apontado", async () => {
    const offer = await createOffer({ name: "Antiga", templateId: "loja" });
    await prisma.offer.update({ where: { id: offer.id }, data: { settings: {} } });
    const [doc] = await docsOf(offer.id);
    await prisma.pageDocument.update({
      where: { id: doc.id },
      data: { html: switchHtmlCurrency(doc.html ?? "", "MXN").html },
    });
    expect(await storeCurrencyMismatch(offer.id)).toBeNull();
    expect((await readinessOf(offer.id)).items.some((i) => i.id === "moeda-vitrines")).toBe(false);
  });

  it("página sem vitrine: o projeto do editor nem é lido (nem copiado) na troca", async () => {
    const offer = await createOffer({ name: "Loja", templateId: "loja", currency: "BRL" });
    const sales = await createPage({ offerId: offer.id, name: "Vendas", templateId: "vendas-longa" });
    // Projeto que nem é JSON: se a troca o lesse, daria erro.
    const broken = new Uint8Array(gzipSync(Buffer.from("{ isto não é JSON — página clonada grande")));
    await prisma.pageDocument.updateMany({ where: { variant: { pageId: sales.id } }, data: { project: broken } });
    const plan = await currencySwitchPlan(offer.id, "MXN");
    expect(plan.documents).toBe(1);
    const result = await switchOfferCurrency(offer.id, "MXN");
    expect(result.documents).toBe(1);
    const [salesDoc] = await prisma.pageDocument.findMany({ where: { variant: { pageId: sales.id } } });
    expect(salesDoc.revision).toBe(0);
    expect(Buffer.from(salesDoc.project as Uint8Array).equals(Buffer.from(broken))).toBe(true);
    // Sem nada a trocar, o projeto volta o mesmo (sem cópia).
    const plain = { pages: [{ frames: [{ component: { type: "wrapper", components: [{ tagName: "p" }] } }] }] };
    expect(switchProjectCurrency(plain, "MXN").project).toBe(plain);
  });
});

describe("configurações da oferta com a moeda", () => {
  it("salvar a empresa numa oferta de antes da pergunta não grava “real” como escolha", async () => {
    const offer = await createOffer({ name: "Curso" });
    await prisma.offer.update({ where: { id: offer.id }, data: { settings: {} } });
    const link = await createOfferLink(offer.id, { label: "Checkout", url: "", kind: "CHECKOUT" });
    await savePaymentProduct(link.id, {
      name: "Curso",
      amount: "497",
      currency: "MXN",
      methods: ["SPEI", "CARD"],
      locale: "ES",
      thankYouPageId: null,
      accessUrl: "",
    });
    const readinessIds = async () =>
      (await getOfferReadiness({ id: offer.id, liveUrl: null, links: await listOfferLinks(offer.id) })).items.map(
        (i) => i.id,
      );
    expect(await readinessIds()).not.toContain("moeda-pagamento");
    const saved = await saveOfferSettings(offer.id, { company: { name: "Minha Empresa" } });
    // O que a tela recebe continua dizendo real (o padrão), mas a oferta não "escolheu" real.
    expect(saved.currency).toBe("BRL");
    const settings = (await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).settings;
    expect(settings).toMatchObject({ company: { name: "Minha Empresa" } });
    expect(chosenOfferCurrency(settings)).toBeNull();
    await saveOfferSettings(offer.id, { seo: { title: "Curso" }, language: "es" });
    expect(
      chosenOfferCurrency((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).settings),
    ).toBeNull();
    expect(await readinessIds()).not.toContain("moeda-pagamento");
    // Escolher a moeda grava (mesmo o real).
    await saveOfferSettings(offer.id, { currency: "BRL" });
    expect(chosenOfferCurrency((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).settings)).toBe(
      "BRL",
    );
  });

  it("moeda com outro campo inválido: nada é trocado (nem a moeda, nem as páginas, nem o Histórico)", async () => {
    const o = await storeOffer();
    const before = await docsOf(o.offer.id);
    await expect(saveOfferSettings(o.offer.id, { currency: "MXN", company: { email: "x" } })).rejects.toMatchObject({
      message: "Digite um e-mail válido, como contato@suaempresa.com.br.",
    });
    expect(offerCurrencyOf((await prisma.offer.findUniqueOrThrow({ where: { id: o.offer.id } })).settings)).toBe("BRL");
    expect((await docsOf(o.offer.id)).map((d) => [d.revision, d.html])).toEqual(
      before.map((d) => [d.revision, d.html]),
    );
    expect(await prisma.pageVersion.count()).toBe(0);
    // Com os campos certos, a troca e as configurações vão juntas.
    const saved = await saveOfferSettings(o.offer.id, { currency: "MXN", company: { email: "oi@loja.mx" } });
    expect(saved).toMatchObject({ currency: "MXN", company: { email: "oi@loja.mx" } });
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: o.offer.id } })).settings).toMatchObject({
      currency: "MXN",
      company: { email: "oi@loja.mx" },
    });
    expect(await prisma.pageVersion.count({ where: { label: LABEL_MXN } })).toBe(6);
  });
});
