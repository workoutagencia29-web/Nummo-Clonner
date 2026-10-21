/**
 * Checkout do Offer Studio — serviços com banco: produto do checkout (salvar,
 * conferir, destino do link, imagens da biblioteca da oferta), chave por
 * oferta da FlevoPay e da BlackCat ("Testar conexão" contra os servidores
 * FALSOS de tests/unit/pix-fakes.ts), links do render (sem destino até a
 * página de checkout existir), "Próximos passos", avisos do ZIP, duplicar
 * oferta e trocar a moeda da oferta.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type CheckoutConfigDraft, checkoutConfigDraft, parseCheckoutConfig } from "@/lib/checkout/config";
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { exportWarningFix } from "@/lib/export/warnings";
import { loadRenderLinks } from "@/lib/payments/links";
import { saveCheckoutProduct } from "@/server/services/checkout/products";
import { getEditorPayload } from "@/server/services/documents";
import { checkoutWarnings, loadCheckoutExport } from "@/server/services/export/checkout";
import { exportPlan } from "@/server/services/export/plan";
import { currencySwitchPlan, switchOfferCurrency } from "@/server/services/offer-currency";
import { createOfferLink, deleteOfferLink, listOfferLinks, updateOfferLink } from "@/server/services/offer-links";
import { createOffer, duplicateOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { BLACKCAT_BASE_ENV } from "@/server/services/payments/blackcat";
import { FLEVOPAY_BASE_ENV } from "@/server/services/payments/flevopay";
import { offerPaymentAccounts, savePaymentGatewayKey, testPaymentGateway } from "@/server/services/payments/gateways";
import { setOfferLinkTarget } from "@/server/services/payments/products";
import { getOfferReadiness } from "@/server/services/readiness";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";
import { KYVO_KEY } from "./kyvo-fake";
import {
  BLACKCAT_KEY,
  BLACKCAT_KEY_UNAPPROVED,
  type FakePix,
  FLEVO_KEY,
  startFakeBlackcat,
  startFakeFlevopay,
} from "./pix-fakes";

let flevo: FakePix;
let blackcat: FakePix;

beforeAll(async () => {
  [flevo, blackcat] = await Promise.all([startFakeFlevopay(), startFakeBlackcat()]);
  process.env[FLEVOPAY_BASE_ENV] = flevo.base;
  process.env[BLACKCAT_BASE_ENV] = blackcat.base;
});

afterAll(async () => {
  delete process.env[FLEVOPAY_BASE_ENV];
  delete process.env[BLACKCAT_BASE_ENV];
  await Promise.all([flevo.close(), blackcat.close()]);
});

beforeEach(async () => {
  await resetDatabase();
});

const SHA = "b".repeat(64);
const IMG_KEY = `a/bb/${SHA}.webp`;
const IMG_SRC = `/os-assets/${SHA}.webp`;

const emptyConfig = (): CheckoutConfigDraft => checkoutConfigDraft(parseCheckoutConfig({}));

async function setup(currency: "BRL" | "MXN" = "BRL") {
  const offer = await createOffer({ name: "Curso", currency });
  const thanks = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
  const link = await createOfferLink(offer.id, { label: "Checkout principal", url: "", kind: "CHECKOUT" });
  return { offer, thanks, link };
}

function input(over: Partial<Parameters<typeof saveCheckoutProduct>[1]> = {}) {
  return {
    name: "Curso de Confeitaria",
    amount: "97,00",
    provider: "FLEVOPAY" as const,
    methods: ["PIX" as const],
    locale: "PT" as const,
    thankYouPageId: null,
    accessUrl: "https://area.com/curso",
    config: emptyConfig(),
    ...over,
  };
}

describe("produto do checkout", () => {
  it("salva, liga o destino “Checkout do Offer Studio” e aparece na aba de links (com a configuração)", async () => {
    const { offer, thanks, link } = await setup();
    await prisma.asset.create({
      data: { offerId: offer.id, sha256: SHA, key: IMG_KEY, kind: "IMAGE", mime: "image/webp", bytes: 10 },
    });
    const saved = await saveCheckoutProduct(
      link.id,
      input({
        thankYouPageId: thanks.id,
        config: {
          ...emptyConfig(),
          imageSrc: IMG_SRC,
          bumps: [
            {
              id: "bump0001",
              title: "Apostila",
              description: "PDF com 50 receitas",
              price: "27,00",
              compareAt: "",
              imageSrc: IMG_SRC,
              accessUrl: "https://drive.com/apostila",
            },
          ],
        },
      }),
    );
    expect(saved).toMatchObject({
      provider: "FLEVOPAY",
      name: "Curso de Confeitaria",
      amountCents: 9_700,
      currency: "BRL",
      methods: ["PIX"],
      locale: "PT",
      thankYouPageId: thanks.id,
    });
    expect(saved.config.imageSrc).toBe(IMG_SRC);
    const row = await prisma.checkoutProduct.findUniqueOrThrow({ where: { linkId: link.id } });
    expect(parseCheckoutConfig(row.config)).toMatchObject({ imageKey: IMG_KEY, bumps: [{ imageKey: IMG_KEY }] });
    const [view] = await listOfferLinks(offer.id);
    expect(view).toMatchObject({
      target: "CHECKOUT",
      pay: false,
      checkout: { price: expect.stringMatching(/R\$\s97,00/) },
    });
    // Até a página de checkout existir no render, o link não leva a lugar nenhum (nunca ao endereço guardado).
    await updateOfferLink(link.id, { url: "https://pay.hotmart.com/X1" });
    expect((await loadRenderLinks(offer.id))[0]).toMatchObject({ key: link.key, url: "", pay: false });
  });

  it("confere: gateway da moeda, imagem da biblioteca da oferta, página de obrigado da oferta, total com os bumps", async () => {
    const { offer, link } = await setup();
    await expectUserError(
      saveCheckoutProduct(link.id, input({ provider: "KYVO", methods: ["CARD"] })),
      /A Kyvo não cobra em real/,
      "provider",
    );
    await expectUserError(
      saveCheckoutProduct(link.id, input({ config: { ...emptyConfig(), imageSrc: IMG_SRC } })),
      "Essa imagem não está na biblioteca desta oferta. Envie a imagem de novo.",
      "image",
    );
    const other = await createOffer({ name: "Outra" });
    const page = await createPage({ offerId: other.id, name: "Obrigado de lá", type: "THANK_YOU" });
    await expectUserError(
      saveCheckoutProduct(link.id, input({ thankYouPageId: page.id })),
      "Essa página de obrigado não é desta oferta. Escolha outra.",
      "thankYouPageId",
    );
    const bump = (id: string) => ({
      id,
      title: "Mentoria",
      description: "",
      price: "40.000,00",
      compareAt: "",
      imageSrc: null,
      accessUrl: "",
    });
    await expectUserError(
      saveCheckoutProduct(
        link.id,
        input({
          amount: "30.000,00",
          config: { ...emptyConfig(), maxQuantity: 1, bumps: [bump("bump0001"), bump("bump0002")] },
        }),
      ),
      /Com todos os order bumps, o total fica em R\$\s110\.000,00: o valor máximo do PIX é/,
      "bumps",
    );
    await expectUserError(
      saveCheckoutProduct(link.id, input({ config: { ...emptyConfig(), timer: "0" } })),
      "O cronômetro vai de 1 a 120 minutos (ou deixe vazio para desligar).",
      "timer",
    );
    // Link de WhatsApp não vira checkout.
    const zap = await createOfferLink(offer.id, { label: "WhatsApp", url: "", kind: "WHATSAPP" });
    await expectUserError(saveCheckoutProduct(zap.id, input()), /Só links de checkout/);
    expect(await prisma.checkoutProduct.count()).toBe(0);
  });

  it("destino: checkout só com o produto salvo; voltar para endereço guarda o produto; tipo não muda com checkout", async () => {
    const { link } = await setup();
    await expectUserError(setOfferLinkTarget(link.id, "CHECKOUT"), "Preencha e salve o produto do checkout antes.");
    await saveCheckoutProduct(link.id, input());
    await setOfferLinkTarget(link.id, "URL");
    expect(await prisma.checkoutProduct.count()).toBe(1);
    await setOfferLinkTarget(link.id, "CHECKOUT");
    expect((await prisma.offerLink.findUniqueOrThrow({ where: { id: link.id } })).target).toBe("CHECKOUT");
    await expectUserError(
      updateOfferLink(link.id, { kind: "WHATSAPP" }),
      /checkout do Offer Studio só pode ser/,
      "kind",
    );
    // Excluir o link apaga o produto junto.
    await deleteOfferLink(link.id);
    expect(await prisma.checkoutProduct.count()).toBe(0);
  });
});

describe("chave da FlevoPay e da BlackCat por oferta", () => {
  it("cada gateway tem a sua conta na oferta; a tela recebe só o final", async () => {
    const { offer } = await setup();
    expect((await offerPaymentAccounts(offer.id)).map((a) => [a.provider, a.label, a.configured])).toEqual([
      ["KYVO", "Kyvo", false],
      ["FLEVOPAY", "FlevoPay", false],
      ["BLACKCAT", "BlackCat", false],
      ["CLOWNPAY", "ClownPay", false],
      ["PAGPIXHUB", "PagPixHub", false],
    ]);
    await expectUserError(
      savePaymentGatewayKey(offer.id, "FLEVOPAY", KYVO_KEY),
      "Essa é uma chave da Kyvo. Cole aqui a chave da API da FlevoPay (no painel da FlevoPay).",
      "apiKey",
    );
    // A chave da FlevoPay (flevopay_…) colada no cartão da BlackCat é recusada.
    await expectUserError(
      savePaymentGatewayKey(offer.id, "BLACKCAT", FLEVO_KEY),
      "Essa é uma chave da FlevoPay. Cole aqui a chave da API da BlackCat (no painel da BlackCat).",
      "apiKey",
    );
    await savePaymentGatewayKey(offer.id, "FLEVOPAY", ` ${FLEVO_KEY} `);
    await savePaymentGatewayKey(offer.id, "BLACKCAT", BLACKCAT_KEY_UNAPPROVED);
    const row = await prisma.paymentGateway.findUniqueOrThrow({
      where: { offerId_provider: { offerId: offer.id, provider: "FLEVOPAY" } },
    });
    expect(row.apiKeyEnc).not.toContain(FLEVO_KEY);
    expect(decryptSecret(row.apiKeyEnc)).toBe(FLEVO_KEY);
    const accounts = await offerPaymentAccounts(offer.id);
    expect(accounts[1]).toMatchObject({ provider: "FLEVOPAY", configured: true, keyHint: expect.stringMatching(/•+/) });
    expect(JSON.stringify(accounts)).not.toContain(FLEVO_KEY.slice(0, 20));
  });

  it("“Testar conexão” pelo vendedor de cada gateway (servidores falsos), com o texto do gateway", async () => {
    const { offer } = await setup();
    await savePaymentGatewayKey(offer.id, "FLEVOPAY", FLEVO_KEY);
    expect(await testPaymentGateway(offer.id, "FLEVOPAY")).toMatchObject({
      status: "ok",
      message: "A chave é válida: a FlevoPay reconheceu a sua conta de vendedor.",
    });
    expect(flevo.requests.at(-1)?.path).toBe("/api/v1/seller");
    await savePaymentGatewayKey(offer.id, "BLACKCAT", BLACKCAT_KEY_UNAPPROVED);
    expect(await testPaymentGateway(offer.id, "BLACKCAT")).toMatchObject({
      status: "missing_scope",
      message: expect.stringContaining("a BlackCat não liberou a conta para vender"),
    });
    await savePaymentGatewayKey(offer.id, "BLACKCAT", "bc_live_chaveQueNaoExiste00");
    expect((await testPaymentGateway(offer.id, "BLACKCAT")).status).toBe("invalid_key");
    await savePaymentGatewayKey(offer.id, "BLACKCAT", BLACKCAT_KEY);
    expect((await testPaymentGateway(offer.id, "BLACKCAT")).status).toBe("ok");
    expect(blackcat.requests.at(-1)?.path).toBe("/sales/seller");
  });
});

describe("Próximos passos e avisos do ZIP", () => {
  it("chave, página de obrigado e frete sem endereço (o link de acesso do produto e dos bumps é opcional)", async () => {
    const { offer, thanks, link } = await setup();
    await saveCheckoutProduct(
      link.id,
      input({
        accessUrl: "",
        config: {
          ...emptyConfig(),
          shipping: [{ id: "frete001", name: "Correios", eta: "", price: "19,90" }],
          bumps: [
            {
              id: "bump0001",
              title: "Apostila",
              description: "",
              price: "27",
              compareAt: "",
              imageSrc: null,
              accessUrl: "",
            },
          ],
        },
      }),
    );
    const links = await listOfferLinks(offer.id);
    let item = (await getOfferReadiness({ id: offer.id, liveUrl: null, links })).items.find(
      (i) => i.id === "checkout-proprio",
    );
    expect(item).toMatchObject({
      title: "Cadastrar a chave da FlevoPay",
      done: false,
      optional: false,
      cta: "Abrir a conta da FlevoPay",
      target: { paymentAccount: true, provider: "FLEVOPAY" },
    });
    expect(item?.detail).toContain("Depois, falta mais 1 ajuste no checkout.");

    const checkout = await loadCheckoutExport(offer.id);
    const warnings = checkoutWarnings(checkout);
    // O link de acesso (do produto e dos bumps) é opcional: não entra como "falta".
    expect(warnings).toEqual([
      "O checkout “Checkout principal” não cobra no site publicado: falta a chave da FlevoPay desta oferta. Para resolver, abra a conta da FlevoPay em “Links e checkouts”, cadastre ou troque a chave, clique em “Testar conexão” e gere o ZIP de novo.",
      "O checkout “Checkout principal” precisa de ajustes. Falta a página de obrigado: quem pagar não recebe tudo o que comprou. Para resolver, abra o link em “Links e checkouts”, complete o checkout e gere o ZIP de novo.",
      expect.stringContaining("tem frete pago cadastrado (até R$"),
    ]);
    expect(warnings.map(exportWarningFix)).toEqual([
      { kind: "checkoutKey", provider: "FLEVOPAY" },
      { kind: "checkoutLink" },
      { kind: "checkoutLink" },
    ]);

    // Tudo cadastrado, menos o bloco de acesso na página de obrigado.
    await savePaymentGatewayKey(offer.id, "FLEVOPAY", FLEVO_KEY);
    await saveCheckoutProduct(link.id, input({ thankYouPageId: thanks.id }));
    item = (await getOfferReadiness({ id: offer.id, liveUrl: null, links })).items.find(
      (i) => i.id === "checkout-proprio",
    );
    expect(item).toMatchObject({ title: "Pôr o acesso na página de obrigado", target: { editor: expect.any(String) } });
    // Com o bloco: pronto.
    await prisma.pageDocument.updateMany({
      where: { variant: { pageId: thanks.id } },
      data: { html: '<html><body><section data-os-widget="access" data-os-lang="pt"></section></body></html>' },
    });
    item = (await getOfferReadiness({ id: offer.id, liveUrl: null, links })).items.find(
      (i) => i.id === "checkout-proprio",
    );
    // Tudo configurado: a página de checkout vai no ZIP (fase 3).
    expect(item).toMatchObject({ title: "Checkout do Offer Studio pronto", done: true });
    expect(item?.detail).toContain("faça uma compra com valor baixo no site publicado");
    expect(checkoutWarnings(await loadCheckoutExport(offer.id))).toEqual([]);
  });

  it("conta da BlackCat não liberada: conferir a conta (e testar de novo), não trocar a chave", async () => {
    const { offer, thanks, link } = await setup();
    await savePaymentGatewayKey(offer.id, "BLACKCAT", BLACKCAT_KEY_UNAPPROVED);
    await testPaymentGateway(offer.id, "BLACKCAT");
    await saveCheckoutProduct(link.id, input({ provider: "BLACKCAT", thankYouPageId: thanks.id }));
    const links = await listOfferLinks(offer.id);
    const item = (await getOfferReadiness({ id: offer.id, liveUrl: null, links })).items.find(
      (i) => i.id === "checkout-proprio",
    );
    expect(item).toMatchObject({ title: "Conferir a conta da BlackCat", done: false });
    expect(item?.detail).toContain("clique em “Testar conexão” de novo");
    const [warning] = checkoutWarnings(await loadCheckoutExport(offer.id));
    expect(warning).toContain("quando a BlackCat liberar a conta, clique em “Testar conexão” de novo");
    expect(warning).not.toContain("troque a chave");
    expect(exportWarningFix(warning)).toEqual({ kind: "checkoutKey", provider: "BLACKCAT" });
  });

  it("o endereço guardado de antes de virar checkout não conta como destino (passo, editor)", async () => {
    const { offer, thanks, link } = await setup();
    await updateOfferLink(link.id, { url: "https://pay.hotmart.com/X123" });
    await prisma.pageDocument.updateMany({
      where: { variant: { pageId: thanks.id } },
      data: { html: `<html><body><a class="os-btn" data-os-link="${link.key}" href="#">Comprar</a></body></html>` },
    });
    const step = async () => {
      const links = await listOfferLinks(offer.id);
      return (await getOfferReadiness({ id: offer.id, liveUrl: null, links })).items.find((i) => i.id === "checkout");
    };
    expect(await step()).toMatchObject({ title: "Checkout ligado", done: true });
    await saveCheckoutProduct(link.id, input({ thankYouPageId: thanks.id }));
    // O botão leva à página de checkout (prévia e ZIP), não ao endereço de antes.
    expect(await step()).toMatchObject({ title: "Checkout ligado", done: true });
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: thanks.id } } });
    const editorLink = (await getEditorPayload(doc.id)).links.find((l) => l.key === link.key);
    expect(editorLink).toMatchObject({
      url: "",
      payment: null,
      checkout: expect.stringMatching(/^Curso de Confeitaria · R\$\s97,00$/),
    });
  });
});

describe("botões e prêmios ligados ao checkout do Offer Studio", () => {
  const button = (key: string) =>
    `<html><body><a class="os-btn" data-os-link="${key}" href="#">COMPRAR AGORA</a></body></html>`;

  it("Próximos passos: link criado já como checkout e ainda sem produto pede para montar o checkout", async () => {
    const { offer, thanks } = await setup();
    const own = await createOfferLink(offer.id, {
      label: "Checkout próprio",
      url: "",
      kind: "CHECKOUT",
      target: "CHECKOUT",
    });
    await prisma.pageDocument.updateMany({
      where: { variant: { pageId: thanks.id } },
      data: { html: button(own.key) },
    });
    const step = async () =>
      (await getOfferReadiness({ id: offer.id, liveUrl: null, links: await listOfferLinks(offer.id) })).items.find(
        (i) => i.id === "checkout",
      );
    const before = await step();
    expect(before).toMatchObject({ title: "Ligar os botões de compra", cta: "Abrir o link", target: { link: own.id } });
    expect(before?.detail).toContain("O checkout do Offer Studio de “Checkout próprio” ainda não foi salvo");
    await saveCheckoutProduct(own.id, input({ thankYouPageId: thanks.id }));
    expect(await step()).toMatchObject({ title: "Checkout ligado", done: true });
  });

  it("ZIP: o botão ligado ao checkout do Offer Studio leva à página de checkout (sem aviso de “sem link”)", async () => {
    const { offer, thanks, link } = await setup();
    await saveCheckoutProduct(link.id, input({ thankYouPageId: thanks.id }));
    const sales = await createPage({ offerId: offer.id, name: "Vendas", type: "SALES" });
    await prisma.pageDocument.updateMany({
      where: { variant: { pageId: sales.id } },
      data: { html: button(link.key) },
    });
    const plan = await exportPlan(offer.id);
    expect(plan.warnings.some((w) => /sem link de checkout|não leva a lugar nenhum/.test(w))).toBe(false);
    expect(plan.deadButtonPages ?? []).toEqual([]);
    // A pasta das páginas de checkout e o pagamento.php aparecem no "O que vai no ZIP".
    expect(plan.tree.map((t) => t.path)).toEqual(expect.arrayContaining(["checkout/", "pagamento.php"]));
  });

  it("ZIP: botão de página clonada ligado a um checkout do Offer Studio SEM produto continua avisado", async () => {
    const { offer } = await setup();
    const own = await createOfferLink(offer.id, {
      label: "Sem produto",
      url: "",
      kind: "CHECKOUT",
      target: "CHECKOUT",
    });
    const sales = await createPage({ offerId: offer.id, name: "Vendas", type: "SALES" });
    await prisma.pageDocument.updateMany({
      where: { variant: { pageId: sales.id } },
      data: {
        html: `<html><body><a class="os-btn" href="https://pay.hotmart.com/ORIGINAL" data-os-checkout="1" data-os-link="${own.key}">COMPRAR AGORA</a></body></html>`,
      },
    });
    const plan = await exportPlan(offer.id);
    expect(plan.warnings.some((w) => w.includes("não leva a lugar nenhum"))).toBe(true);
  });
});

describe("bloco “Acesso ao produto” e o idioma do checkout", () => {
  it("editor: o bloco nasce no idioma do produto do checkout; ZIP e Próximos passos avisam bloco em outro idioma", async () => {
    const { offer, thanks, link } = await setup();
    await saveCheckoutProduct(link.id, input({ thankYouPageId: thanks.id }));
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: thanks.id } } });
    expect((await getEditorPayload(doc.id)).links.find((l) => l.key === link.key)?.paymentLocale).toBe("pt");
    // Bloco em espanhol (o padrão de antes) numa compra em português.
    await prisma.pageDocument.update({
      where: { id: doc.id },
      data: {
        html: '<html><body><div class="os-access" data-os-widget="access" data-os-lang="es"></div></body></html>',
      },
    });
    const plan = await exportPlan(offer.id);
    const warning = plan.warnings.find((w) => w.includes("o comprador vê o checkout num idioma"));
    expect(warning).toContain("O bloco “Acesso ao produto” da página “Obrigado” está em Español");
    expect(exportWarningFix(warning ?? "")).toEqual({ kind: "accessBlock" });
    expect(plan.accessBlockPages).toEqual([{ name: "Obrigado", documentId: doc.id }]);
    await savePaymentGatewayKey(offer.id, "FLEVOPAY", FLEVO_KEY);
    const links = await listOfferLinks(offer.id);
    const step = (await getOfferReadiness({ id: offer.id, liveUrl: null, links })).items.find(
      (i) => i.id === "checkout-proprio",
    );
    expect(step).toMatchObject({ title: "Ajustar o idioma do acesso", target: { editor: doc.id } });
  });
});

describe("duplicar e trocar a moeda", () => {
  it("duplicar leva o produto do checkout (com a página de obrigado da cópia), mas NÃO a chave", async () => {
    const { offer, thanks, link } = await setup();
    await savePaymentGatewayKey(offer.id, "BLACKCAT", BLACKCAT_KEY);
    await saveCheckoutProduct(link.id, input({ provider: "BLACKCAT", thankYouPageId: thanks.id }));
    const copy = await duplicateOffer(offer.id);
    expect(copy.droppedPaymentKey).toBe(true);
    const [copied] = await listOfferLinks(copy.id);
    const copiedThanks = await prisma.page.findFirstOrThrow({ where: { offerId: copy.id, type: "THANK_YOU" } });
    expect(copied).toMatchObject({
      target: "CHECKOUT",
      checkout: { provider: "BLACKCAT", thankYouPageId: copiedThanks.id },
    });
    // O produto do checkout vem junto, mas sem a chave da BlackCat: a cópia pede para cadastrar de novo.
    expect((await offerPaymentAccounts(copy.id))[2]).toMatchObject({ provider: "BLACKCAT", configured: false });
    expect(await prisma.paymentGateway.count({ where: { offerId: copy.id } })).toBe(0);
    // A original fica com a chave dela.
    expect(await prisma.paymentGateway.count({ where: { offerId: offer.id } })).toBe(1);
  });

  it("real → peso: o checkout passa para a Kyvo; de volta ao real, o gateway de PIX com chave", async () => {
    const { offer, link } = await setup();
    await saveCheckoutProduct(link.id, input());
    const plan = await currencySwitchPlan(offer.id, "MXN");
    expect(plan.checkouts).toEqual([
      {
        linkId: link.id,
        label: "Checkout principal",
        productName: "Curso de Confeitaria",
        active: true,
        before: { gateway: "FlevoPay (PIX)", price: expect.stringMatching(/R\$\s97,00/) },
        after: { gateway: "Kyvo", price: expect.stringMatching(/MX\$\s97,00/) },
        gatewayChanged: true,
        problem: null,
        locale: { from: "Português", to: "Español" },
        textsToReview: false,
      },
    ]);
    const result = await switchOfferCurrency(offer.id, "MXN");
    expect(result).toMatchObject({
      checkouts: 1,
      checkoutGateways: [{ linkId: link.id, label: "Checkout principal", gateway: "Kyvo" }],
    });
    expect(await prisma.checkoutProduct.findUniqueOrThrow({ where: { linkId: link.id } })).toMatchObject({
      provider: "KYVO",
      currency: "MXN",
      methods: ["SPEI", "CARD"],
      locale: "ES",
      amountCents: 9_700,
    });
    await savePaymentGatewayKey(offer.id, "BLACKCAT", BLACKCAT_KEY);
    await switchOfferCurrency(offer.id, "BRL");
    expect(await prisma.checkoutProduct.findUniqueOrThrow({ where: { linkId: link.id } })).toMatchObject({
      provider: "BLACKCAT",
      currency: "BRL",
      methods: ["PIX"],
      locale: "PT",
    });
    // Na moeda que já tem: nada muda.
    expect((await currencySwitchPlan(offer.id, "BRL")).checkouts).toEqual([]);
  });

  it("endereço vale em qualquer moeda: salvar em peso/euro é aceito e a troca de moeda mantém o endereço e o frete", async () => {
    const { offer, link } = await setup();
    const shipping = [{ id: "frete001", name: "Sedex", eta: "", price: "29,90" }];
    await saveCheckoutProduct(link.id, input({ config: { ...emptyConfig(), address: true, shipping } }));
    const plan = await currencySwitchPlan(offer.id, "EUR");
    // A troca de moeda não mexe mais no endereço.
    expect(plan.checkouts[0]).toMatchObject({ locale: null, textsToReview: false });
    await switchOfferCurrency(offer.id, "EUR");
    const row = await prisma.checkoutProduct.findUniqueOrThrow({ where: { linkId: link.id } });
    expect(row).toMatchObject({ provider: "KYVO", currency: "EUR", locale: "PT" });
    // O endereço e o frete continuam ligados (produto físico vendido fora do Brasil).
    expect(parseCheckoutConfig(row.config)).toMatchObject({ address: true, shipping: [{ id: "frete001" }] });
    // Endereço ligado em euro NÃO gera aviso de frete desligado.
    const issuesAfter = (await loadCheckoutExport(offer.id))?.issues ?? [];
    expect(issuesAfter.some((i) => i.kind === "shipping")).toBe(false);
    // Salvar de novo com o endereço ligado em euro é ACEITO (antes era recusado).
    await saveCheckoutProduct(
      link.id,
      input({ provider: "KYVO", methods: ["CARD"], config: { ...emptyConfig(), address: true, shipping } }),
    );
    const resaved = parseCheckoutConfig(
      (await prisma.checkoutProduct.findUniqueOrThrow({ where: { linkId: link.id } })).config,
    );
    expect(resaved).toMatchObject({ address: true, shipping: [{ id: "frete001" }] });
    // O único passo que falta é a chave da Kyvo (não há mais "desligar o endereço").
    const links = await listOfferLinks(offer.id);
    const step = (await getOfferReadiness({ id: offer.id, liveUrl: null, links })).items.find(
      (i) => i.id === "checkout-proprio",
    );
    expect(step).toMatchObject({ title: "Cadastrar a chave da Kyvo" });
    expect(step?.detail ?? "").not.toContain("endereço");
  });

  it("textos trocados: a troca de moeda avisa para revisar; salvar de novo marca como revisados", async () => {
    const { offer, link } = await setup();
    await savePaymentGatewayKey(offer.id, "KYVO", KYVO_KEY);
    await saveCheckoutProduct(
      link.id,
      input({ config: { ...emptyConfig(), texts: { payButton: "Pagar com PIX agora", dataTitle: "Seus dados" } } }),
    );
    expect((await prisma.checkoutProduct.findUniqueOrThrow({ where: { linkId: link.id } })).config).toMatchObject({
      textsFor: { locale: "PT", pix: true },
    });
    expect((await currencySwitchPlan(offer.id, "MXN")).checkouts[0]).toMatchObject({ textsToReview: true });
    const result = await switchOfferCurrency(offer.id, "MXN");
    expect(result.checkoutTexts).toEqual([{ linkId: link.id, label: "Checkout principal" }]);
    const checkout = await loadCheckoutExport(offer.id);
    expect(checkout?.issues).toContainEqual({ kind: "texts", linkId: link.id, label: "Checkout principal" });
    const textsWarning = checkoutWarnings(checkout).find((w) => w.includes("Os textos trocados"));
    expect(textsWarning && exportWarningFix(textsWarning)).toEqual({ kind: "checkoutLink" });
    // Salvo de novo (revisado) em espanhol pela Kyvo: o aviso some.
    const [view] = await listOfferLinks(offer.id);
    await saveCheckoutProduct(
      link.id,
      input({
        provider: "KYVO",
        methods: ["SPEI", "CARD"],
        locale: "ES",
        config: { ...(view.checkout?.config ?? emptyConfig()), texts: { payButton: "Pagar ahora" } },
      }),
    );
    expect((await loadCheckoutExport(offer.id))?.issues.some((i) => i.kind === "texts")).toBe(false);
  });
});
