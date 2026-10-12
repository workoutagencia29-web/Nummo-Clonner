/**
 * Pagamento REAL na PRÉVIA do app (src/server/services/payments/live-preview.ts):
 * com a chave do gateway salva na oferta, `handlePreviewPayment` cobra DE
 * VERDADE pelos adaptadores (FlevoPay, BlackCat e Kyvo), contra os servidores
 * FALSOS (nunca a internet). Sem chave, cai na simulação. Confere a segurança:
 * a credencial pública do checkout é um id nosso ("lv_…"), nunca o id da
 * cobrança no gateway; "pago" só vale confirmado pela API; o acesso só sai
 * pago; e um pedido real não pode ser "simulado".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type CheckoutConfigDraft, checkoutConfigDraft, parseCheckoutConfig } from "@/lib/checkout/config";
import { saveCheckoutProduct } from "@/server/services/checkout/products";
import { createOfferLink } from "@/server/services/offer-links";
import { createOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { savePaymentGatewayKey } from "@/server/services/payments/gateways";
import { handlePreviewPayment, resetLivePreview } from "@/server/services/payments/live-preview";
import { savePaymentProduct } from "@/server/services/payments/products";
import { resetSimulation } from "@/server/services/payments/simulation";
import { resetDatabase } from "../setup/per-file";
import { type FakeKyvo, KYVO_KEY, startFakeKyvo } from "./kyvo-fake";
import {
  BLACKCAT_KEY,
  FAKE_PIX_CODE,
  type FakePix,
  FLEVO_KEY,
  startFakeBlackcat,
  startFakeFlevopay,
} from "./pix-fakes";

const CPF = "529.982.247-25";
let flevo: FakePix;
let blackcat: FakePix;
let kyvo: FakeKyvo;

beforeAll(async () => {
  flevo = await startFakeFlevopay();
  blackcat = await startFakeBlackcat();
  kyvo = await startFakeKyvo();
  process.env.OS_FLEVOPAY_API_BASE = flevo.base;
  process.env.OS_BLACKCAT_API_BASE = blackcat.base;
  process.env.OS_KYVO_API_BASE = kyvo.base;
});

afterAll(async () => {
  await Promise.all([flevo.close(), blackcat.close(), kyvo.close()]);
});

beforeEach(async () => {
  await resetDatabase();
  resetSimulation();
  resetLivePreview();
});

const emptyConfig = (): CheckoutConfigDraft => checkoutConfigDraft(parseCheckoutConfig({}));

function pixConfig(): CheckoutConfigDraft {
  return {
    ...emptyConfig(),
    bumps: [
      {
        id: "bump0001",
        title: "Apostila",
        description: "",
        price: "27,00",
        compareAt: "",
        imageSrc: null,
        accessUrl: "https://area.exemplo.com/apostila",
      },
    ],
  };
}

async function setupCheckout(provider: "FLEVOPAY" | "BLACKCAT" | "KYVO", key: string) {
  const brl = provider !== "KYVO";
  const offer = await createOffer({ name: "Curso", currency: brl ? "BRL" : "MXN" });
  const thanks = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
  const link = await createOfferLink(offer.id, { label: "Checkout", url: "", kind: "CHECKOUT" });
  await saveCheckoutProduct(link.id, {
    name: "Curso de Confeitaria",
    amount: "97,00",
    provider,
    methods: brl ? ["PIX"] : ["SPEI"],
    locale: brl ? "PT" : "ES",
    thankYouPageId: thanks.id,
    accessUrl: "https://area.exemplo.com/curso",
    config: brl ? pixConfig() : emptyConfig(),
  });
  await savePaymentGatewayKey(offer.id, provider, key);
  return { offer, link };
}

const pixBody = (key: string, over: Record<string, unknown> = {}) => ({
  acao: "checkout_criar",
  checkout: key,
  metodo: "pix",
  nome: "Maria da Silva",
  email: "maria@exemplo.com",
  telefone: "(11) 98765-4321",
  documento: CPF,
  bumps: ["bump0001"],
  frete: null,
  ...over,
});

/** O id da única cobrança criada no gateway falso. */
function onlyGid(txns: Map<string, unknown>): string {
  const k = [...txns.keys()][0];
  if (!k) throw new Error("nenhuma cobrança criada no gateway");
  return k;
}

describe("checkout com pagamento real na prévia", () => {
  it("FlevoPay: PIX de verdade, credencial própria, pago só confirmado na API, acesso", async () => {
    const { offer, link } = await setupCheckout("FLEVOPAY", FLEVO_KEY);
    const created = await handlePreviewPayment(offer.id, pixBody(link.key));
    expect(created.status).toBe(201);
    const c = created.body as {
      ok: true;
      pedido: string;
      pedidoExterno: string;
      valor: number;
      moeda: string;
      metodo: string;
      simulacao?: true;
      pix: { codigo: string; imagem: string | null };
    };
    // PIX de verdade (o do gateway), não o de exemplo; sem a marca de simulação.
    expect(c.pix.codigo).toBe(FAKE_PIX_CODE);
    expect(c.simulacao).toBeUndefined();
    expect(c).toMatchObject({ valor: 9700 + 2700, moeda: "BRL", metodo: "pix" });
    // A credencial pública é nossa ("lv_…"), nunca o id (sequencial) da cobrança no gateway.
    expect(c.pedido).toMatch(/^lv_[0-9a-f]{20}$/);
    const gid = onlyGid(flevo.transactions);
    expect(c.pedido).not.toBe(gid);

    const status = () =>
      handlePreviewPayment(offer.id, { acao: "checkout_status", pedido: c.pedido, checkout: link.key });
    expect((await status()).body).toMatchObject({ status: "pending", pago: false, valor: 12400 });

    // Acesso antes de pagar: negado.
    expect((await handlePreviewPayment(offer.id, { acao: "acesso", pedido: c.pedido })).body).toMatchObject({
      ok: false,
      erro: "pendente",
    });

    // Pago no banco (gateway) → a prévia confirma pela API.
    flevo.setStatus(gid, "approved");
    expect((await status()).body).toMatchObject({ status: "paid", pago: true });

    // Pago continua pago: se o gateway voltar "pending" (consistência eventual), não rebaixa.
    flevo.setStatus(gid, "pending");
    expect((await status()).body).toMatchObject({ status: "paid", pago: true });

    const access = await handlePreviewPayment(offer.id, { acao: "acesso", pedido: c.pedido });
    expect(access.body).toMatchObject({
      ok: true,
      status: "paid",
      acesso: "https://area.exemplo.com/curso",
      extras: [{ acesso: "https://area.exemplo.com/apostila" }],
    });
  });

  it("BlackCat: PIX de verdade (itens somando o total) e status pela API", async () => {
    const { offer, link } = await setupCheckout("BLACKCAT", BLACKCAT_KEY);
    const created = await handlePreviewPayment(offer.id, pixBody(link.key));
    expect(created.status).toBe(201);
    const c = created.body as { pedido: string; pix: { codigo: string }; simulacao?: true };
    expect(c.pix.codigo).toBe(FAKE_PIX_CODE);
    expect(c.simulacao).toBeUndefined();
    const gid = onlyGid(blackcat.transactions);
    blackcat.setStatus(gid, "paid");
    const st = await handlePreviewPayment(offer.id, { acao: "checkout_status", pedido: c.pedido, checkout: link.key });
    expect(st.body).toMatchObject({ status: "paid", pago: true });
  });

  it("Kyvo (peso): SPEI de verdade na prévia", async () => {
    const { offer, link } = await setupCheckout("KYVO", KYVO_KEY);
    const created = await handlePreviewPayment(offer.id, {
      acao: "checkout_criar",
      checkout: link.key,
      metodo: "spei",
      nome: "María López",
      email: "maria@exemplo.com",
      telefone: "5215512345678",
      documento: "LOPM800101",
      bumps: [],
      frete: null,
    });
    expect(created.status).toBe(201);
    const c = created.body as { pedido: string; moeda: string; spei?: { clabe: string }; simulacao?: true };
    expect(c.moeda).toBe("MXN");
    expect(c.spei?.clabe).toBeTruthy();
    expect(c.simulacao).toBeUndefined();
    expect(c.pedido).toMatch(/^lv_[0-9a-f]{20}$/);
  });

  it("sem a chave do gateway salvo: a prévia volta a simular", async () => {
    const offer = await createOffer({ name: "Curso", currency: "BRL" });
    const thanks = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
    const link = await createOfferLink(offer.id, { label: "Checkout", url: "", kind: "CHECKOUT" });
    await saveCheckoutProduct(link.id, {
      name: "Curso",
      amount: "97,00",
      provider: "FLEVOPAY",
      methods: ["PIX"],
      locale: "PT",
      thankYouPageId: thanks.id,
      accessUrl: "https://area.exemplo.com/curso",
      config: pixConfig(),
    });
    const before = flevo.transactions.size;
    const created = await handlePreviewPayment(offer.id, pixBody(link.key));
    const c = created.body as { pedido: string; simulacao?: true; pix: { codigo: string } };
    expect(c.simulacao).toBe(true);
    expect(c.pedido).toMatch(/^sim_/);
    // Nenhuma cobrança nova foi para o gateway (o fake é compartilhado no arquivo).
    expect(flevo.transactions.size).toBe(before);
  });

  it("produto sem link de acesso: a prévia AINDA gera o PIX (para testar); só o acesso fica indisponível", async () => {
    const offer = await createOffer({ name: "Curso", currency: "BRL" });
    const thanks = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
    const link = await createOfferLink(offer.id, { label: "Checkout", url: "", kind: "CHECKOUT" });
    await saveCheckoutProduct(link.id, {
      name: "Curso",
      amount: "97,00",
      provider: "FLEVOPAY",
      methods: ["PIX"],
      locale: "PT",
      thankYouPageId: thanks.id,
      accessUrl: "",
      config: pixConfig(),
    });
    await savePaymentGatewayKey(offer.id, "FLEVOPAY", FLEVO_KEY);
    // Basta a chave do gateway: o PIX de verdade é gerado para você testar.
    const created = await handlePreviewPayment(offer.id, pixBody(link.key));
    expect(created.status).toBe(201);
    const c = created.body as { pedido: string; pix: { codigo: string } };
    expect(c.pix.codigo).toBe(FAKE_PIX_CODE);
    // Pago na API → mas sem link de acesso, o "acesso" fica indisponível (o produto é liberado só com o link).
    const gid = [...flevo.transactions.keys()].sort((a, b) => Number(b) - Number(a))[0];
    flevo.setStatus(gid, "approved");
    await handlePreviewPayment(offer.id, { acao: "checkout_status", pedido: c.pedido, checkout: link.key });
    expect((await handlePreviewPayment(offer.id, { acao: "acesso", pedido: c.pedido })).body).toMatchObject({
      ok: false,
      erro: "configuracao",
    });
  });

  it("um pedido real não pode ser “simulado” e nem o status de outra oferta o vê", async () => {
    const { offer, link } = await setupCheckout("FLEVOPAY", FLEVO_KEY);
    const created = await handlePreviewPayment(offer.id, pixBody(link.key));
    const c = created.body as { pedido: string };
    // "simular" só existe na simulação: o pedido real não está lá.
    expect(
      (await handlePreviewPayment(offer.id, { acao: "simular", pedido: c.pedido, resultado: "pago" })).body,
    ).toMatchObject({ ok: false, erro: "nao_encontrado" });
    // Outra oferta não enxerga o pedido.
    const other = await createOffer({ name: "Outra", currency: "BRL" });
    expect(
      (await handlePreviewPayment(other.id, { acao: "checkout_status", pedido: c.pedido, checkout: link.key })).body,
    ).toMatchObject({ ok: false, erro: "nao_encontrado" });
  });
});

describe("pagamento na página (janela, Kyvo) com cobrança real na prévia", () => {
  async function setupWindow() {
    const offer = await createOffer({ name: "Oferta", currency: "MXN" });
    const thanks = await createPage({ offerId: offer.id, name: "Gracias", type: "THANK_YOU" });
    const link = await createOfferLink(offer.id, { label: "Pagamento", url: "", kind: "CHECKOUT" });
    await savePaymentProduct(link.id, {
      name: "Curso de Repostería",
      amount: "497",
      currency: "MXN",
      methods: ["SPEI", "CARD"],
      locale: "ES",
      thankYouPageId: thanks.id,
      accessUrl: "https://membros.exemplo.com/reposteria",
    });
    await savePaymentGatewayKey(offer.id, "KYVO", KYVO_KEY);
    return { offer, link };
  }

  it("SPEI de verdade: pedido = id da cobrança (não sequencial), pago pela API, acesso", async () => {
    const { offer, link } = await setupWindow();
    const created = await handlePreviewPayment(offer.id, {
      acao: "criar",
      produto: link.key,
      metodo: "spei",
      nome: "María López",
      email: "maria@exemplo.com",
    });
    expect(created.status).toBe(201);
    const c = created.body as {
      pedido: string;
      pedidoExterno: string;
      moeda: string;
      spei?: { clabe: string };
      simulacao?: true;
    };
    expect(c.simulacao).toBeUndefined();
    expect(c.moeda).toBe("MXN");
    expect(c.spei?.clabe).toBeTruthy();
    // Janela: o pedido público é o id da cobrança na Kyvo (tx_…), não sequencial.
    expect(c.pedido).toMatch(/^tx_/);
    // Na janela o pedido público é o próprio id da cobrança (não é segredo: a Kyvo não é sequencial).
    const gid = c.pedido;

    const status = () => handlePreviewPayment(offer.id, { acao: "status", pedido: c.pedido, produto: link.key });
    expect((await status()).body).toMatchObject({ status: "pending", pago: false });
    // Acesso antes de pagar: negado.
    expect((await handlePreviewPayment(offer.id, { acao: "acesso", pedido: c.pedido })).body).toMatchObject({
      ok: false,
      erro: "pendente",
    });
    kyvo.setStatus(gid, "paid");
    expect((await status()).body).toMatchObject({ status: "paid", pago: true });
    expect((await handlePreviewPayment(offer.id, { acao: "acesso", pedido: c.pedido })).body).toMatchObject({
      ok: true,
      status: "paid",
      acesso: "https://membros.exemplo.com/reposteria",
      produto: link.key,
    });
  });
});
