/**
 * Pagamento na página — serviços com banco: chave do gateway (criptografada,
 * mascarada, "Testar conexão" contra o servidor FALSO da Kyvo), produtos de
 * pagamento (validação, destino do link, página de obrigado da oferta), links
 * do render (data-os-pay e #os-pagamento sem segredos), rastreamento, "Próximos
 * passos", prêmio da roleta, exclusão do link e duplicar oferta.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { linkKey } from "@/lib/offer-links";
import { renderPageHtml } from "@/lib/page-render";
import { PREVIEW_PAYMENT_ENDPOINT, PRODUCT_KEY_RE, readPaymentConfig } from "@/lib/payments/contract";
import { loadRenderLinks } from "@/lib/payments/links";
import { orderIsForProduct, orderProductCode } from "@/lib/payments/orders";
import type { PaymentProductInput } from "@/lib/payments/rules";
import { loadTracking } from "@/lib/tracking/config";
import { prizeId, type WheelSlice } from "@/lib/wheel";
import { wheelPrizeMap } from "@/lib/wheel-prizes";
import { createOfferLink, deleteOfferLink, listOfferLinks, updateOfferLink } from "@/server/services/offer-links";
import { createOffer, duplicateOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import {
  listPaymentGateways,
  paymentGatewayKey,
  removePaymentGatewayKey,
  savePaymentGatewayKey,
  testPaymentGateway,
} from "@/server/services/payments/gateways";
import {
  NOT_PAYMENT_KIND_MESSAGE,
  offerPaymentRender,
  savePaymentProduct,
  setOfferLinkTarget,
} from "@/server/services/payments/products";
import { handleSimulatedPayment } from "@/server/services/payments/simulation";
import { getOfferReadiness } from "@/server/services/readiness";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";
import { type FakeKyvo, KYVO_KEY, KYVO_KEY_DOWN, KYVO_KEY_NO_READ, startFakeKyvo } from "./kyvo-fake";

let kyvo: FakeKyvo;

beforeAll(async () => {
  kyvo = await startFakeKyvo();
  process.env.OS_KYVO_API_BASE = kyvo.base;
});

afterAll(async () => {
  delete process.env.OS_KYVO_API_BASE;
  await kyvo.close();
});

beforeEach(async () => {
  await resetDatabase();
});

const PRODUCT: PaymentProductInput = {
  name: "Curso de Repostería",
  amount: "297,00",
  currency: "MXN",
  methods: ["CARD", "SPEI"],
  locale: "ES",
  thankYouPageId: null,
  accessUrl: "membros.exemplo.com/curso",
};

const HTML =
  '<!DOCTYPE html><html><head><title>Oferta</title></head><body><a id="a" data-os-link="checkout" href="https://pay.hotmart.com/ANTIGO">Comprar</a><button id="b" data-os-link="checkout" data-os-href="https://pay.hotmart.com/ANTIGO">Quero</button><a id="w" data-os-link="whats" href="#">Zap</a></body></html>';

async function offerWithPayment() {
  const offer = await createOffer({ name: "Oferta" });
  const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
  const thanks = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
  await prisma.pageDocument.updateMany({ where: { variant: { pageId: home.id } }, data: { html: HTML } });
  const link = await createOfferLink(offer.id, {
    label: "Checkout",
    url: "https://meucheckout.exemplo.com/antigo",
    kind: "CHECKOUT",
  });
  await createOfferLink(offer.id, { label: "Whats", url: "https://wa.me/5511999999999", kind: "WHATSAPP" });
  return { offerId: offer.id, homeId: home.id, thanksId: thanks.id, linkId: link.id };
}

describe("chave do gateway (Configurações → Pagamentos)", () => {
  it("confere a chave colada antes de salvar", async () => {
    await expectUserError(savePaymentGatewayKey("KYVO", "  "), "Cole a chave da API.", "apiKey");
    await expectUserError(
      savePaymentGatewayKey("KYVO", "sk_live_123456789012345678"),
      /começa com “kyvo_live_”/,
      "apiKey",
    );
    await expectUserError(savePaymentGatewayKey("KYVO", "kyvo_live_abc def"), /espaços/, "apiKey");
    await expectUserError(savePaymentGatewayKey("KYVO", "kyvo_live_1"), /incompleta/, "apiKey");
    expect(await prisma.paymentGateway.count()).toBe(0);
  });

  it("guarda criptografada; a tela recebe só o final mascarado", async () => {
    expect(await listPaymentGateways()).toEqual([
      {
        provider: "KYVO",
        label: "Kyvo",
        configured: false,
        keyHint: null,
        keyUnreadable: false,
        checkedAt: null,
        checkStatus: null,
      },
    ]);
    await savePaymentGatewayKey("KYVO", ` Bearer ${KYVO_KEY} `);
    const row = await prisma.paymentGateway.findUniqueOrThrow({ where: { provider: "KYVO" } });
    expect(row.apiKeyEnc).not.toContain(KYVO_KEY);
    expect(decryptSecret(row.apiKeyEnc)).toBe(KYVO_KEY);
    const [view] = await listPaymentGateways();
    expect(view).toMatchObject({ configured: true, keyHint: `••••••${KYVO_KEY.slice(-4)}`, keyUnreadable: false });
    expect(JSON.stringify(await listPaymentGateways())).not.toContain(KYVO_KEY.slice(0, 20));
    expect(await paymentGatewayKey("KYVO")).toBe(KYVO_KEY);
  });

  it("Testar conexão: o servidor do app consulta a Kyvo e explica em pt-BR", async () => {
    await expectUserError(testPaymentGateway("KYVO"), "Cadastre a chave da Kyvo antes de testar.");

    await savePaymentGatewayKey("KYVO", KYVO_KEY);
    const ok = await testPaymentGateway("KYVO");
    expect(ok.status).toBe("ok");
    expect(ok.message).toBe("A chave é válida e consegue consultar as suas vendas.");
    expect(kyvo.requests.at(-1)).toMatchObject({ method: "GET", path: "/api/v1/transactions?limit=1" });
    expect(kyvo.requests.at(-1)?.headers.authorization).toBe(`Bearer ${KYVO_KEY}`);
    expect((await listPaymentGateways())[0]).toMatchObject({ checkStatus: "ok" });

    await savePaymentGatewayKey("KYVO", "kyvo_live_chaveQueAKyvoNaoConhece0000");
    // Chave nova: o teste anterior não vale mais.
    expect((await listPaymentGateways())[0]).toMatchObject({ checkStatus: null, checkedAt: null });
    expect((await testPaymentGateway("KYVO")).message).toMatch(/A Kyvo recusou a chave/);

    await savePaymentGatewayKey("KYVO", KYVO_KEY_NO_READ);
    expect((await testPaymentGateway("KYVO")).message).toMatch(/transactions:read/);

    await savePaymentGatewayKey("KYVO", KYVO_KEY_DOWN);
    expect((await testPaymentGateway("KYVO")).message).toMatch(/fora do ar/);

    const saved = process.env.OS_KYVO_API_BASE;
    process.env.OS_KYVO_API_BASE = "http://127.0.0.1:1/api";
    try {
      expect((await testPaymentGateway("KYVO")).message).toMatch(/Não foi possível falar com a Kyvo/);
    } finally {
      process.env.OS_KYVO_API_BASE = saved;
    }
    for (const r of kyvo.requests) expect(JSON.stringify(r.body ?? "")).not.toContain("kyvo_live_");
  });

  it("chave ilegível (APP_ENCRYPTION_KEY trocada) pede para colar de novo; remover apaga", async () => {
    await prisma.paymentGateway.create({ data: { provider: "KYVO", apiKeyEnc: "v1:lixo" } });
    expect((await listPaymentGateways())[0]).toMatchObject({ configured: true, keyUnreadable: true, keyHint: null });
    await expectUserError(paymentGatewayKey("KYVO"), /Cole a chave de novo em Configurações → Pagamentos/);
    await removePaymentGatewayKey("KYVO");
    expect(await prisma.paymentGateway.count()).toBe(0);
  });
});

describe("produto de pagamento", () => {
  it("salvar liga o pagamento na página; valor guardado em centavos", async () => {
    const o = await offerWithPayment();
    const saved = await savePaymentProduct(o.linkId, { ...PRODUCT, thankYouPageId: o.thanksId });
    expect(saved).toMatchObject({
      name: "Curso de Repostería",
      amountCents: 29_700,
      amount: "297,00",
      currency: "MXN",
      methods: ["SPEI", "CARD"], // ordem fixa
      locale: "ES",
      thankYouPageId: o.thanksId,
      accessUrl: "https://membros.exemplo.com/curso",
    });
    const [link] = await listOfferLinks(o.offerId);
    expect(link).toMatchObject({ target: "PAYMENT", pay: true, url: "https://meucheckout.exemplo.com/antigo" });
    expect(link.payment?.price.replace(/\s/g, " ")).toBe("MX$ 297,00");

    // Voltar para endereço guarda o produto; voltar para pagamento não perde nada.
    await setOfferLinkTarget(o.linkId, "URL");
    expect((await listOfferLinks(o.offerId))[0]).toMatchObject({ target: "URL", pay: false });
    expect((await listOfferLinks(o.offerId))[0].payment?.amountCents).toBe(29_700);
    await setOfferLinkTarget(o.linkId, "PAYMENT");
    expect((await listOfferLinks(o.offerId))[0]).toMatchObject({ target: "PAYMENT", pay: true });
  });

  it("validação com o campo certo (mesmas regras da tela)", async () => {
    const o = await offerWithPayment();
    await expectUserError(savePaymentProduct(o.linkId, { ...PRODUCT, name: "" }), /Dê um nome/, "name");
    await expectUserError(
      savePaymentProduct(o.linkId, { ...PRODUCT, currency: "EUR", methods: ["SPEI"] }),
      "SPEI só funciona com MXN. Troque a moeda ou desmarque SPEI.",
      "methods",
    );
    await expectUserError(
      savePaymentProduct(o.linkId, { ...PRODUCT, amount: "30.000,00" }),
      /Com SPEI, o valor máximo é MX\$\s25\.000,00 por compra\./,
      "amount",
    );
    await expectUserError(
      savePaymentProduct(o.linkId, { ...PRODUCT, accessUrl: "ftp://x" }),
      /link de acesso/,
      "accessUrl",
    );
    expect(await prisma.paymentProduct.count()).toBe(0);
    expect((await listOfferLinks(o.offerId))[0].target).toBe("URL");
  });

  it("página de obrigado tem de ser da oferta; link que não é de checkout não vira pagamento", async () => {
    const o = await offerWithPayment();
    const other = await createOffer({ name: "Outra" });
    const otherPage = await prisma.page.findFirstOrThrow({ where: { offerId: other.id } });
    await expectUserError(
      savePaymentProduct(o.linkId, { ...PRODUCT, thankYouPageId: otherPage.id }),
      "Essa página de obrigado não é desta oferta. Escolha outra.",
      "thankYouPageId",
    );
    const whats = (await listOfferLinks(o.offerId)).find((l) => l.kind === "WHATSAPP");
    await expectUserError(savePaymentProduct(whats?.id as string, PRODUCT), NOT_PAYMENT_KIND_MESSAGE);
    await expectUserError(setOfferLinkTarget(whats?.id as string, "PAYMENT"), NOT_PAYMENT_KIND_MESSAGE);
    await expectUserError(
      createOfferLink(o.offerId, { label: "X", url: "", kind: "OTHER", target: "PAYMENT" }),
      NOT_PAYMENT_KIND_MESSAGE,
      "kind",
    );
    // Link de pagamento não vira WhatsApp/Outro sem antes voltar para endereço.
    await savePaymentProduct(o.linkId, PRODUCT);
    await expectUserError(updateOfferLink(o.linkId, { kind: "WHATSAPP" }), /só pode ser do tipo checkout/, "kind");
    await updateOfferLink(o.linkId, { kind: "UPSELL" });
  });

  it("página de obrigado excluída: o produto fica sem página (não quebra)", async () => {
    const o = await offerWithPayment();
    await savePaymentProduct(o.linkId, { ...PRODUCT, thankYouPageId: o.thanksId });
    await prisma.page.delete({ where: { id: o.thanksId } });
    expect((await listOfferLinks(o.offerId))[0].payment?.thankYouPageId).toBeNull();
  });
});

describe("na página (prévia e ZIP)", () => {
  it("link de pagamento sem produto não leva a lugar nenhum; com produto, abre a janela", async () => {
    const o = await offerWithPayment();
    const link = await createOfferLink(o.offerId, { label: "Upsell", url: "", kind: "UPSELL", target: "PAYMENT" });
    expect((await loadRenderLinks(o.offerId)).find((l) => l.key === link.key)).toEqual({
      key: "upsell",
      url: "",
      kind: "UPSELL",
      pay: false,
    });
    await savePaymentProduct(o.linkId, PRODUCT);
    expect((await loadRenderLinks(o.offerId)).find((l) => l.key === "checkout")).toEqual({
      key: "checkout",
      url: "", // o endereço guardado nunca vai para a página
      kind: "CHECKOUT",
      pay: true,
    });
  });

  it("botões ganham data-os-pay; o JSON público não leva link de acesso nem chave", async () => {
    const o = await offerWithPayment();
    await savePaymentGatewayKey("KYVO", KYVO_KEY);
    await savePaymentProduct(o.linkId, { ...PRODUCT, thankYouPageId: o.thanksId });
    const links = await loadRenderLinks(o.offerId);
    const pageHref = (id: string) => `/p/${id}`;
    const html = renderPageHtml(HTML, {
      links,
      pageHref,
      runtimeTag: "<script data-os-runtime></script>",
      payments: await offerPaymentRender(o.offerId, { endpoint: PREVIEW_PAYMENT_ENDPOINT, simulation: true, pageHref }),
    });
    expect(html).toContain('<a id="a" data-os-link="checkout" href="#" data-os-pay="checkout">Comprar</a>');
    expect(html).toContain('<button id="b" data-os-link="checkout" data-os-pay="checkout">Quero</button>');
    expect(html).toContain('<a id="w" data-os-link="whats" href="https://wa.me/5511999999999">Zap</a>');
    expect(html).not.toContain("pay.hotmart.com/ANTIGO");
    expect(html).not.toContain("meucheckout.exemplo.com");
    expect(html).not.toContain("membros.exemplo.com");
    expect(html).not.toContain(KYVO_KEY.slice(0, 16));
    const json = /<script type="application\/json" id="os-pagamento">([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(readPaymentConfig(json)).toEqual({
      v: 1,
      endpoint: "/__os/pagamento",
      simulacao: true,
      produtos: {
        checkout: {
          nome: "Curso de Repostería",
          valor: 29_700,
          moeda: "MXN",
          metodos: ["spei", "card"],
          idioma: "es",
          obrigado: `/p/${o.thanksId}`,
        },
      },
    });
  });

  it("rastreamento: o botão de pagamento é checkout (InitiateCheckout); o endereço guardado não vira host de checkout", async () => {
    const o = await offerWithPayment();
    await savePaymentProduct(o.linkId, PRODUCT);
    const loaded = await loadTracking({ offerId: o.offerId, pageId: o.homeId, mode: "preview", pageHref: () => "#" });
    expect(loaded?.config.checkoutLinkKeys).toEqual(["checkout"]);
    expect(loaded?.config.checkoutHosts).not.toContain("meucheckout.exemplo.com");
  });

  it("Próximos passos: botões de pagamento contam como botões de compra ligados", async () => {
    const o = await offerWithPayment();
    await prisma.offerLink.update({ where: { id: o.linkId }, data: { url: "" } });
    const ready = async () =>
      (await getOfferReadiness({ id: o.offerId, liveUrl: null, links: await listOfferLinks(o.offerId) })).items.find(
        (i) => i.id === "checkout",
      );
    expect(await ready()).toMatchObject({ done: false, title: "Ligar os botões de compra" });
    await savePaymentProduct(o.linkId, PRODUCT);
    expect(await ready()).toMatchObject({ done: true, title: "Checkout ligado" });
  });

  it("prêmio da roleta pode ser um link de pagamento (outro produto, outro preço)", () => {
    const slice: WheelSlice = { text: "30% OFF", color: "#000", chance: 50, link: "desconto", coupon: "" };
    const wheel = `<div data-os-widget="wheel" data-os-slices='${JSON.stringify([slice])}'></div>`;
    const map = wheelPrizeMap([wheel], [{ key: "desconto", url: "https://antigo.exemplo.com", pay: true }]);
    expect(map[prizeId(slice)]).toMatchObject({ p: "desconto", t: "30% OFF" });
    expect(map[prizeId(slice)]).not.toHaveProperty("u");
  });
});

describe("excluir e duplicar", () => {
  it("excluir um link de pagamento: os botões voltam ao endereço de antes (não ao guardado)", async () => {
    const o = await offerWithPayment();
    await savePaymentProduct(o.linkId, PRODUCT);
    await deleteOfferLink(o.linkId);
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: o.homeId } } });
    expect(doc.html).not.toContain('data-os-link="checkout"');
    expect(doc.html).not.toContain("meucheckout.exemplo.com");
    expect(await prisma.paymentProduct.count()).toBe(0);
  });

  it("duplicar a oferta copia o produto, com a página de obrigado da cópia", async () => {
    const o = await offerWithPayment();
    await savePaymentProduct(o.linkId, { ...PRODUCT, thankYouPageId: o.thanksId });
    const copy = await duplicateOffer(o.offerId);
    const [link] = await listOfferLinks(copy.id);
    const copyThanks = await prisma.page.findFirstOrThrow({ where: { offerId: copy.id, type: "THANK_YOU" } });
    expect(copyThanks.id).not.toBe(o.thanksId);
    expect(link).toMatchObject({ key: "checkout", target: "PAYMENT", pay: true });
    expect(link.payment).toMatchObject({ amountCents: 29_700, thankYouPageId: copyThanks.id });
    expect(await prisma.paymentProduct.count()).toBe(2);
    // Mesma chave de link, mesma conta da Kyvo: o pedido de uma oferta nunca vale na outra.
    expect(orderProductCode(link.key, link.id)).not.toBe(orderProductCode("checkout", o.linkId));
    const buyer = { nome: "Ana Pérez", email: "ana@ejemplo.mx" };
    const created = await handleSimulatedPayment(copy.id, {
      acao: "criar",
      produto: "checkout",
      metodo: "spei",
      ...buyer,
    });
    expect(created.status).toBe(201);
    const ext = (created.body as { pedidoExterno: string }).pedidoExterno;
    expect(orderIsForProduct(ext, "checkout", link.id)).toBe(true);
    expect(orderIsForProduct(ext, "checkout", o.linkId)).toBe(false);
  });

  it("nome de link repetido e longo: a chave nunca passa de 80 e o pagamento na página cobra", async () => {
    const o = await offerWithPayment();
    const name = "Checkout principal do curso completo de reposteria mexicanas";
    expect(name).toHaveLength(60);
    const a = await createOfferLink(o.offerId, { label: name, url: "", kind: "CHECKOUT" });
    const b = await createOfferLink(o.offerId, { label: name, url: "", kind: "CHECKOUT" });
    expect(b.key).not.toBe(a.key);
    expect(b.key.length).toBeLessThanOrEqual(80);
    expect(PRODUCT_KEY_RE.test(b.key)).toBe(true);
    expect(linkKey("x".repeat(80), ["x".repeat(80)])).toBe(`${"x".repeat(78)}-2`);
    await savePaymentProduct(b.id, PRODUCT);
    const r = await handleSimulatedPayment(o.offerId, {
      acao: "criar",
      produto: b.key,
      metodo: "spei",
      nome: "Ana Pérez",
      email: "ana@ejemplo.mx",
    });
    expect(r.status).toBe(201);
  });
});
