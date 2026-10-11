/**
 * Moeda da oferta (Offer.settings.currency) no serviço, nas ações e no banco:
 * a "Nova oferta" e o "Salvar como oferta" da clonagem gravam a moeda escolhida
 * e ela vem marcada na próxima (preferência do app; real na primeira vez); os
 * modelos "Loja (vitrine)" e "Página do produto" nascem na moeda da oferta
 * (criar oferta, página e versão A/B), os outros modelos não mudam (preço
 * escrito é texto); as páginas de produto criadas pela vitrine herdam a moeda
 * da vitrine; trocar a moeda nas configurações troca também o que já existe
 * (detalhes em offer-currency-switch.test.ts); duplicar leva a moeda junto;
 * ofertas de antes continuam em real; o editor recebe a moeda da oferta.
 */
import * as cheerio from "cheerio";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { PAGE_TEMPLATES, TEMPLATE_IDS, templateHtmlFor } from "@/editor/templates";
import { prisma } from "@/lib/db";
import {
  OFFER_CURRENCIES,
  OFFER_CURRENCY_QUESTION,
  offerCurrencyLabel,
  offerCurrencyOf,
  paymentCurrencyFor,
} from "@/lib/offer-currency";
import { parseOfferSettings } from "@/lib/offer-settings";
import { deleteObject, putObject } from "@/lib/storage";
import { productAttrs } from "@/lib/store";
import { loadTracking } from "@/lib/tracking/config";
import { CURRENCIES, CURRENCY_LABEL, parseTrackingSettings } from "@/lib/tracking/schema";
import { saveCloneAction } from "@/server/actions/clone";
import { saveOfferSettingsAction } from "@/server/actions/offer-settings";
import { createOfferAction } from "@/server/actions/offers";
import { saveTrackingSettingsAction } from "@/server/actions/tracking";
import { saveClone } from "@/server/services/clone";
import { getEditorPayload } from "@/server/services/documents";
import { getOfferSettingsPanel, saveOfferSettings } from "@/server/services/offer-settings";
import { createOffer, duplicateOffer } from "@/server/services/offers";
import { pageStart, templateHtml } from "@/server/services/page-templates";
import { createPage } from "@/server/services/pages";
import { lastOfferCurrency, PREFERENCES_SETTING_KEY, rememberOfferCurrency } from "@/server/services/preferences";
import { createProductPages } from "@/server/services/store";
import { getTrackingPanel, getTrackingSettings, saveTrackingSettings } from "@/server/services/tracking";
import { createVariant } from "@/server/services/variants";
import type { CloneResult } from "@/worker/clone/types";
import { resetDatabase } from "../setup/per-file";

beforeEach(async () => {
  await resetDatabase();
});

const written = new Set<string>();
afterAll(async () => {
  for (const key of written) await deleteObject(key).catch(() => {});
});

const settingsOf = async (offerId: string) =>
  (await prisma.offer.findUniqueOrThrow({ where: { id: offerId }, select: { settings: true } })).settings;

async function homeHtml(offerId: string) {
  const doc = await prisma.pageDocument.findFirstOrThrow({
    where: { variant: { page: { offerId, isHome: true }, isControl: true } },
  });
  return doc.html ?? "";
}

async function htmlOf(pageId: string, variantName = "A") {
  const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId, name: variantName } } });
  return doc.html ?? "";
}

/** Moedas (data-os-currency) das vitrines e caixas de compra da página. */
function currencies(html: string) {
  const $ = cheerio.load(html);
  return [
    ...new Set(
      $("[data-os-currency]")
        .map((_, el) => $(el).attr("data-os-currency"))
        .get(),
    ),
  ];
}

/** Frase do preço para leitores de tela do primeiro produto ("De R$ 109,90 por R$ 63,76…"). */
const firstPrice = (html: string) => cheerio.load(html)(".os-pd-sr").first().text();

describe("regras (src/lib/offer-currency.ts)", () => {
  it("pergunta, ordem e nomes das moedas", () => {
    expect(OFFER_CURRENCY_QUESTION).toBe("Em qual moeda essa oferta vai rodar?");
    expect(OFFER_CURRENCIES.map(offerCurrencyLabel)).toEqual([
      "Real (R$)",
      "Peso mexicano ($)",
      "Euro (€)",
      "Dólar (US$)",
    ]);
  });

  it("moeda das configurações: sem ela (ofertas de antes) ou estranha, real", () => {
    expect(offerCurrencyOf({})).toBe("BRL");
    expect(offerCurrencyOf(null)).toBe("BRL");
    expect(offerCurrencyOf({ currency: "MXN" })).toBe("MXN");
    expect(offerCurrencyOf({ currency: "ARS" })).toBe("BRL");
    expect(parseOfferSettings({}).currency).toBe("BRL");
    // Moeda estragada não apaga o resto das configurações.
    const parsed = parseOfferSettings({ currency: 12, company: { name: "ACME" }, language: "es" });
    expect(parsed).toMatchObject({ currency: "BRL", company: { name: "ACME" }, language: "es" });
  });

  it("pagamento na página: a Kyvo cobra em peso, euro e dólar; em real não", () => {
    expect(paymentCurrencyFor("MXN")).toBe("MXN");
    expect(paymentCurrencyFor("EUR")).toBe("EUR");
    expect(paymentCurrencyFor("USD")).toBe("USD");
    expect(paymentCurrencyFor("BRL")).toBeNull();
  });
});

describe("modelos na moeda da oferta", () => {
  it("em real, o HTML é o mesmo de sempre; os modelos sem loja não mudam com a moeda", () => {
    for (const t of PAGE_TEMPLATES) expect(templateHtmlFor(t.id as never, "BRL"), t.id).toBe(t.html);
    for (const id of TEMPLATE_IDS.filter((x) => x !== "loja" && x !== "produto")) {
      expect(templateHtmlFor(id, "MXN"), id).toBe(templateHtmlFor(id, "BRL"));
    }
    const now = new Date("2026-10-09T12:00:00Z");
    expect(templateHtml("vendas-longa", "Vendas", now, "EUR")).toBe(templateHtml("vendas-longa", "Vendas", now));
  });

  it("“Loja (vitrine)” em cada moeda: todas as vitrines nela, no idioma dela, sem R$", () => {
    const cases = [
      ["MXN", "Antes $109.90, ahora $63.76", "4x $15.94 sin intereses", "Siguiente"],
      ["USD", "Was US$ 109.90, now US$ 63.76", "4x US$ 15.94 interest-free", "Next"],
      ["EUR", "De 109,90 € por 63,76 €", "4x 15,94 € sem juros", "Próximo"],
      ["BRL", "De R$ 109,90 por R$ 63,76", "4x R$ 15,94 sem juros", "Próximo"],
    ] as const;
    for (const [currency, price, inst, next] of cases) {
      const html = pageStart("loja", "Loja", currency).html;
      const $ = cheerio.load(html);
      expect(currencies(html), currency).toEqual([currency]);
      // Cinco vitrines, nenhuma com idioma próprio (o idioma acompanha a moeda).
      expect($('[data-os-widget="products"]').length).toBe(5);
      expect($("[data-os-pd-lang]").length).toBe(0);
      expect(firstPrice(html)).toContain(price);
      expect($(".os-pd-inst").first().text()).toBe(inst);
      expect($(".os-pd-next").first().text()).toBe(next);
      if (currency !== "BRL") expect(html.includes("R$"), currency).toBe(false);
    }
  });

  it("“Página do produto”: a caixa de compra e a nota das opiniões na moeda", () => {
    const html = pageStart("produto", "Fone", "MXN").html;
    const $ = cheerio.load(html);
    expect(currencies(html)).toEqual(["MXN"]);
    expect(firstPrice(html)).toContain("Antes $219.90, ahora $129.90");
    expect($(".os-pd-inst").first().text()).toBe("12x $10.83 sin intereses");
    expect($(".os-pp-avg").text()).toBe("4.7");
    expect(cheerio.load(pageStart("produto", "Fone").html)(".os-pp-avg").text()).toBe("4,7");
  });

  it("modelos com preço escrito como texto estão marcados (a “Nova oferta” avisa)", () => {
    for (const t of PAGE_TEMPLATES) {
      if (t.id === "loja" || t.id === "produto") {
        expect(t.textPrices, t.id).toBeUndefined();
        continue;
      }
      const body = t.html.slice(t.html.indexOf("<body"));
      expect(Boolean(t.textPrices), t.id).toBe(body.includes("R$"));
    }
    expect(PAGE_TEMPLATES.filter((t) => t.textPrices).map((t) => t.id)).toEqual(["vendas-longa", "upsell", "downsell"]);
  });
});

describe("Nova oferta", () => {
  it("primeira vez: real; a moeda escolhida fica na oferta e vem marcada na próxima", async () => {
    expect(await lastOfferCurrency()).toBe("BRL");
    const offer = await createOffer({ name: "Loja México", templateId: "loja", currency: "MXN" });
    expect(await settingsOf(offer.id)).toEqual({ currency: "MXN" });
    expect(await lastOfferCurrency()).toBe("MXN");
    const html = await homeHtml(offer.id);
    expect(currencies(html)).toEqual(["MXN"]);
    expect(html).toContain("sin intereses");
    expect(html.includes("R$")).toBe(false);

    const euro = await createOffer({ name: "Loja Portugal", templateId: "produto", currency: "EUR" });
    expect(offerCurrencyOf(await settingsOf(euro.id))).toBe("EUR");
    expect(await lastOfferCurrency()).toBe("EUR");
  });

  it("sem moeda (chamadas antigas): real, e a última escolhida não muda", async () => {
    await rememberOfferCurrency("USD");
    const offer = await createOffer({ name: "Sem moeda", templateId: "loja" });
    expect(await settingsOf(offer.id)).toEqual({});
    expect((await getOfferSettingsPanel(offer.id))?.settings.currency).toBe("BRL");
    expect(currencies(await homeHtml(offer.id))).toEqual(["BRL"]);
    expect(await lastOfferCurrency()).toBe("USD");
  });

  it("modelo com preço escrito (página de vendas): o texto continua como está", async () => {
    const offer = await createOffer({ name: "Vendas", templateId: "vendas-longa", currency: "USD" });
    const html = await homeHtml(offer.id);
    expect(html).toContain("De <s>R$ 47</s> por R$ 0");
    expect(offerCurrencyOf(await settingsOf(offer.id))).toBe("USD");
  });

  it("ação: valida a moeda (mensagem em português) e grava a escolhida", async () => {
    const bad = await createOfferAction({ name: "X", tagIds: [], currency: "ARS" as never });
    expect(bad).toEqual({ ok: false, error: "Escolha a moeda da oferta.", field: "currency" });
    expect(await prisma.offer.count()).toBe(0);
    const ok = await createOfferAction({ name: "Loja", tagIds: [], templateId: "loja", currency: "USD" });
    if (!ok.ok) throw new Error(ok.error);
    expect(offerCurrencyOf(await settingsOf(ok.data.id))).toBe("USD");
    expect(await lastOfferCurrency()).toBe("USD");
  });

  it("preferência: junta com as outras chaves; valor estragado é trocado", async () => {
    await prisma.appSetting.create({ data: { key: PREFERENCES_SETTING_KEY, value: { outra: 1 } } });
    await rememberOfferCurrency("EUR");
    expect((await prisma.appSetting.findUniqueOrThrow({ where: { key: PREFERENCES_SETTING_KEY } })).value).toEqual({
      outra: 1,
      offerCurrency: "EUR",
    });
    await prisma.appSetting.update({ where: { key: PREFERENCES_SETTING_KEY }, data: { value: [1, 2] } });
    expect(await lastOfferCurrency()).toBe("BRL");
    await rememberOfferCurrency("MXN");
    expect((await prisma.appSetting.findUniqueOrThrow({ where: { key: PREFERENCES_SETTING_KEY } })).value).toEqual({
      offerCurrency: "MXN",
    });
    await prisma.appSetting.update({
      where: { key: PREFERENCES_SETTING_KEY },
      data: { value: { offerCurrency: "XYZ" } },
    });
    expect(await lastOfferCurrency()).toBe("BRL");
  });
});

describe("páginas e versões novas", () => {
  it("“Nova página” com os modelos da loja nasce na moeda da oferta; oferta de antes, em real", async () => {
    const offer = await createOffer({ name: "Oferta", currency: "MXN" });
    const store = await createPage({ offerId: offer.id, name: "Loja", templateId: "loja" });
    const product = await createPage({ offerId: offer.id, name: "Produto", templateId: "produto" });
    const sales = await createPage({ offerId: offer.id, name: "Vendas", templateId: "vendas-longa" });
    expect(currencies(await htmlOf(store.id))).toEqual(["MXN"]);
    expect(currencies(await htmlOf(product.id))).toEqual(["MXN"]);
    expect(await htmlOf(sales.id)).toContain("R$ 97");

    // Oferta criada antes da moeda (sem a chave): real, sem mudar nada nela.
    const old = await prisma.offer.create({ data: { name: "Antiga", settings: { language: "es" } } });
    const oldStore = await createPage({ offerId: old.id, name: "Loja", templateId: "loja" });
    expect(currencies(await htmlOf(oldStore.id))).toEqual(["BRL"]);
    expect(await settingsOf(old.id)).toEqual({ language: "es" });
  });

  it("versão A/B de um modelo da loja: na moeda da oferta", async () => {
    const offer = await createOffer({ name: "Oferta", templateId: "loja", currency: "EUR" });
    const page = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
    await createVariant({ pageId: page.id, source: { kind: "template", templateId: "produto" } });
    const html = await htmlOf(page.id, "B");
    expect(currencies(html)).toEqual(["EUR"]);
    expect(firstPrice(html)).toContain("De 219,90 € por 129,90 €");
  });

  it("páginas de produto criadas pela vitrine herdam a moeda (e o idioma) da vitrine", async () => {
    // Oferta em euro com uma vitrine em peso mexicano (trocada no editor).
    const offer = await createOffer({ name: "Loja", templateId: "loja", currency: "EUR" });
    const store = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
    const [created] = await createProductPages({
      offerId: offer.id,
      storePageId: store.id,
      products: [
        {
          pageName: "Fone",
          name: "Fone",
          data: productAttrs({ price: 12990, old: 21990, inst: 12, rating: 4.5 }),
          currency: "MXN",
          lang: "",
        },
      ],
    });
    const html = await htmlOf(created.id);
    expect(currencies(html)).toEqual(["MXN"]);
    expect(firstPrice(html)).toContain("Antes $219.90, ahora $129.90");
    expect(cheerio.load(html)(".os-pp-avg").text()).toBe("4.5");
  });
});

describe("configurações da oferta", () => {
  it("trocar a moeda troca também o que já existe e vale para o que vem depois", async () => {
    const offer = await createOffer({ name: "Loja", templateId: "loja", currency: "BRL" });
    await saveOfferSettings(offer.id, { company: { name: "ACME" } });
    expect(currencies(await homeHtml(offer.id))).toEqual(["BRL"]);
    const saved = await saveOfferSettings(offer.id, { currency: "MXN" });
    expect(saved).toMatchObject({ currency: "MXN", company: { name: "ACME" } });
    expect(await settingsOf(offer.id)).toMatchObject({ currency: "MXN", company: { name: "ACME" } });
    // Outra parte das configurações salva depois não volta a moeda.
    expect((await saveOfferSettings(offer.id, { seo: { title: "Loja" } })).currency).toBe("MXN");
    // A vitrine que já estava na página passou para peso (nunca só o símbolo: as partes foram refeitas).
    expect(currencies(await homeHtml(offer.id))).toEqual(["MXN"]);
    expect(firstPrice(await homeHtml(offer.id))).not.toContain("R$");
    const page = await createPage({ offerId: offer.id, name: "Outra loja", templateId: "loja" });
    expect(currencies(await htmlOf(page.id))).toEqual(["MXN"]);
    // A preferência da "Nova oferta" é só de quem cria oferta.
    expect(await lastOfferCurrency()).toBe("BRL");
    expect((await getOfferSettingsPanel(offer.id))?.settings.currency).toBe("MXN");
  });

  it("ação: aceita só as quatro moedas", async () => {
    const offer = await createOffer({ name: "Oferta" });
    const bad = await saveOfferSettingsAction({ offerId: offer.id, currency: "GBP" as never });
    expect(bad).toEqual({ ok: false, error: "Escolha a moeda da oferta.", field: "currency" });
    const ok = await saveOfferSettingsAction({ offerId: offer.id, currency: "USD" });
    expect(ok).toMatchObject({ ok: true, data: { currency: "USD" } });
    expect(offerCurrencyOf(await settingsOf(offer.id))).toBe("USD");
  });

  it("duplicar a oferta leva a moeda", async () => {
    const offer = await createOffer({ name: "Loja", templateId: "loja", currency: "MXN" });
    const copy = await duplicateOffer(offer.id);
    expect(offerCurrencyOf(await settingsOf(copy.id))).toBe("MXN");
    expect(currencies(await homeHtml(copy.id))).toEqual(["MXN"]);
  });

  it("o editor recebe a moeda da oferta (blocos com preço nascem nela)", async () => {
    const offer = await createOffer({ name: "Loja", currency: "USD" });
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { page: { offerId: offer.id } } } });
    expect((await getEditorPayload(doc.id)).offer).toEqual({ id: offer.id, name: "Loja", currency: "USD" });
    // Oferta sem a moeda nas configurações (como as de antes): real.
    const old = await createOffer({ name: "Antiga" });
    const oldDoc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { page: { offerId: old.id } } } });
    expect((await getEditorPayload(oldDoc.id)).offer.currency).toBe("BRL");
  });
});

describe("“Valor da oferta” dos pixels (InitiateCheckout, Purchase) na moeda da oferta", () => {
  it("regras: peso mexicano entre as moedas; sem moeda salva, vale a da oferta; a salva fica", () => {
    expect(CURRENCIES).toEqual(["BRL", "MXN", "EUR", "USD"]);
    expect(CURRENCY_LABEL.MXN).toBe("Peso mexicano ($)");
    expect(parseTrackingSettings({}, "MXN").value).toEqual({ currency: "MXN", amount: null });
    expect(parseTrackingSettings({ value: { amount: 297 } }, "USD").value).toEqual({ currency: "USD", amount: 297 });
    expect(parseTrackingSettings({ value: { currency: "EUR", amount: 10 } }, "MXN").value).toEqual({
      currency: "EUR",
      amount: 10,
    });
    // Sem a moeda da oferta (ou estranha) e JSON estragado: real, como sempre.
    expect(parseTrackingSettings({}).value.currency).toBe("BRL");
    expect(parseTrackingSettings({}, "ARS").value.currency).toBe("BRL");
    expect(parseTrackingSettings("lixo", "MXN").value.currency).toBe("MXN");
  });

  it("oferta em peso: a tela mostra peso, o valor salvo vai em MXN para os pixels; trocar a moeda depois leva junto; oferta de antes, real", async () => {
    const offer = await createOffer({ name: "México", currency: "MXN" });
    expect((await getTrackingSettings(offer.id)).value).toEqual({ currency: "MXN", amount: null });
    expect((await getTrackingPanel(offer.id))?.settings.value.currency).toBe("MXN");
    // Salvar outra parte (o aviso de cookies) grava junto a moeda que vale agora.
    await saveTrackingSettings(offer.id, { consent: { mode: "NOTICE" } });
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).tracking).toMatchObject({
      value: { currency: "MXN", amount: null },
    });
    const saved = await saveTrackingSettings(offer.id, { value: { amount: 297 } });
    expect(saved.value).toEqual({ currency: "MXN", amount: 297 });
    const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
    const loaded = await loadTracking({ offerId: offer.id, pageId: home.id, mode: "preview", pageHref: () => "#" });
    expect(loaded?.config.value).toEqual({ currency: "MXN", amount: 297 });
    // Trocar a moeda da oferta leva junto a moeda do valor salvo (o número fica).
    await saveOfferSettings(offer.id, { currency: "EUR" });
    expect((await getTrackingSettings(offer.id)).value).toEqual({ currency: "EUR", amount: 297 });

    // Euro e dólar também; oferta de antes (sem moeda): real.
    const euro = await createOffer({ name: "Portugal", currency: "EUR" });
    expect((await getTrackingSettings(euro.id)).value.currency).toBe("EUR");
    const old = await createOffer({ name: "Antiga" });
    expect((await getTrackingSettings(old.id)).value.currency).toBe("BRL");
    // A ação aceita o peso mexicano.
    const ok = await saveTrackingSettingsAction({ offerId: old.id, value: { currency: "MXN", amount: 49.9 } });
    expect(ok).toMatchObject({ ok: true, data: { value: { currency: "MXN", amount: 49.9 } } });
  });
});

describe("clonagem: “Salvar como oferta”", () => {
  /** Clonagem pronta para salvar (uma página, HTML no storage). */
  async function readyClone() {
    const job = await prisma.cloneJob.create({
      data: {
        source: "URL",
        sourceUrl: "https://loja.exemplo.com/",
        status: "REVIEW",
        options: { devices: ["desktop"] },
      },
    });
    const html = "<!DOCTYPE html><html><head><title>Loja</title></head><body><p>R$ 49,90</p></body></html>";
    const outputs = {
      EDITABLE: { htmlKey: `clones/${job.id}/desktop-editable.html` },
      PRESERVE_JS: { htmlKey: `clones/${job.id}/desktop-preserve.html`, assetMap: {} },
    };
    for (const out of Object.values(outputs)) {
      await putObject(out.htmlKey, html);
      written.add(out.htmlKey);
    }
    const result: CloneResult = {
      title: "Loja",
      finalUrl: "https://loja.exemplo.com/",
      responsive: true,
      devices: { desktop: { outputs } },
      removed: [],
      checkouts: [],
      funnel: [],
      videos: [],
      delay: null,
      warnings: [],
      suggestedMode: "EDITABLE",
      assets: [],
      stats: { assets: 0, bytes: 0, failed: 0, blockedRequests: 0, durationMs: 1 },
    };
    await prisma.cloneJob.update({ where: { id: job.id }, data: { result: result as object } });
    return job;
  }

  const input = (jobId: string) => ({
    jobId,
    name: "Loja clonada",
    folderId: null,
    mode: "EDITABLE" as const,
    keepRemoved: [],
    childJobIds: [],
  });

  it("grava a moeda escolhida (a página clonada fica como veio) e ela vem marcada na próxima", async () => {
    const job = await readyClone();
    const offer = await saveClone({ ...input(job.id), currency: "EUR" });
    expect(await settingsOf(offer.id)).toEqual({ currency: "EUR" });
    expect(await homeHtml(offer.id)).toContain("R$ 49,90");
    expect(await lastOfferCurrency()).toBe("EUR");
  });

  it("sem moeda: real, e a última escolhida não muda", async () => {
    await rememberOfferCurrency("MXN");
    const job = await readyClone();
    const offer = await saveClone(input(job.id));
    expect(offerCurrencyOf(await settingsOf(offer.id))).toBe("BRL");
    expect(await lastOfferCurrency()).toBe("MXN");
  });

  it("ação: valida a moeda e grava", async () => {
    const job = await readyClone();
    const bad = await saveCloneAction({ ...input(job.id), currency: "JPY" as never });
    expect(bad).toEqual({ ok: false, error: "Escolha a moeda da oferta.", field: "currency" });
    const ok = await saveCloneAction({ ...input(job.id), currency: "MXN" });
    if (!ok.ok) throw new Error(ok.error);
    expect(offerCurrencyOf(await settingsOf(ok.data.id))).toBe("MXN");
    expect(await lastOfferCurrency()).toBe("MXN");
  });
});
