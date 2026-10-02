/**
 * Fase 4 — serviços de rastreamento com o banco: pixels (token criptografado,
 * nunca devolvido), configurações, categoria do código das páginas, regras de
 * evento, tela do painel, configuração pública montada do banco e duplicação.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { buildTrackingConfig, loadTracking } from "@/lib/tracking/config";
import { POLICY_NONE, RECOMMENDED_RULES } from "@/lib/tracking/schema";
import { createOfferLink } from "@/server/services/offer-links";
import { createOffer, duplicateOffer } from "@/server/services/offers";
import { getPageCode, getPageCodeView, savePageCode } from "@/server/services/page-code";
import { createPage } from "@/server/services/pages";
import {
  applyRecommendedRules,
  checkSelector,
  createEventRule,
  createPixel,
  deleteEventRule,
  deletePixel,
  dismissRecommendedRules,
  getTrackingPanel,
  getTrackingSettings,
  listEventRules,
  listPixels,
  readPixelTokenForServerFile,
  savePageCodeCategory,
  saveTrackingSettings,
  setEventRuleEnabled,
  setPixelEnabled,
  setPixelToken,
  UTMIFY_SINGLE_MESSAGE,
  updateEventRule,
  updatePixel,
} from "@/server/services/tracking";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";

const META_TOKEN = "EAAGm0PX4ZCpsBAKZCZBy1234567890abcdefghijklmnopqrstuvwxyz";
const TIKTOK_TOKEN = "0123456789abcdef0123456789abcdef01234567";

async function offerWithPages() {
  const offer = await createOffer({ name: "Oferta" });
  const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
  const legal = await createPage({ offerId: offer.id, name: "Política", type: "LEGAL" });
  const obrigado = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
  return { offerId: offer.id, homeId: home.id, legalId: legal.id, obrigadoId: obrigado.id };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("pixels", () => {
  it("cria com ID validado/normalizado (inclusive colando o código) e lista sem token", async () => {
    const { offerId } = await offerWithPages();
    const meta = await createPixel(offerId, {
      vendor: "META",
      pixelId: "fbq('init', '123456789012345');",
      label: "  Pixel principal ",
      options: { capi: true },
      accessToken: META_TOKEN,
      testEventCode: "TEST123",
    });
    expect(meta).toMatchObject({
      vendor: "META",
      pixelId: "123456789012345",
      label: "Pixel principal",
      enabled: true,
      options: { capi: true },
      hasToken: true,
      tokenHint: "••••••wxyz",
      tokenUnreadable: false,
      testEventCode: "TEST123",
      needsToken: false,
    });
    const ga = await createPixel(offerId, { vendor: "GA4", pixelId: "g-abc123def4" });
    expect(ga).toMatchObject({ pixelId: "G-ABC123DEF4", options: {}, hasToken: false, tokenHint: null });

    const list = await listPixels(offerId);
    expect(list.map((p) => p.vendor)).toEqual(["META", "GA4"]);
    const json = JSON.stringify(list);
    expect(json).not.toContain(META_TOKEN);
    expect(json).not.toContain("accessTokenEnc");
    expect(json).not.toContain("v1:");
    // No banco, criptografado no formato v1.
    const row = await prisma.pixelConfig.findUniqueOrThrow({ where: { id: meta.id } });
    expect(row.accessTokenEnc).toMatch(/^v1:/);
    expect(decryptSecret(row.accessTokenEnc as string)).toBe(META_TOKEN);
    expect(await readPixelTokenForServerFile(meta.id)).toBe(META_TOKEN);
  });

  it("recusa ID inválido, token em plataforma sem API e repetição, com mensagens claras", async () => {
    const { offerId } = await offerWithPages();
    await expectUserError(
      createPixel(offerId, { vendor: "META", pixelId: "abc" }),
      "O ID do pixel da Meta tem só números (10 a 20 dígitos).",
      "pixelId",
    );
    await expectUserError(
      createPixel(offerId, { vendor: "GA4", pixelId: "G-ABC123", accessToken: META_TOKEN }),
      "Google Analytics 4 não usa token de API.",
      "accessToken",
    );
    await expectUserError(
      createPixel(offerId, { vendor: "META", pixelId: "123456789012345", accessToken: "curto" }),
      /token parece incompleto.*API de Conversões/,
      "accessToken",
    );
    await expectUserError(
      createPixel(offerId, { vendor: "META", pixelId: "123456789012345", accessToken: "EAAG abc 123456789012345678" }),
      /não pode ter espaços/,
      "accessToken",
    );
    await expectUserError(
      createPixel(offerId, { vendor: "TIKTOK", pixelId: "CABCDEFGHIJKLMNOPQ12", testEventCode: "com espaço" }),
      /código de teste/,
      "testEventCode",
    );
    await expectUserError(
      createPixel(offerId, { vendor: "KWAI", pixelId: "283746592837465", label: "x".repeat(61) }),
      /apelido/,
      "label",
    );
    await createPixel(offerId, { vendor: "META", pixelId: "123456789012345" });
    await expectUserError(
      createPixel(offerId, { vendor: "META", pixelId: " 123456789012345" }),
      "Esse pixel (Meta (Facebook e Instagram)) já está cadastrado nesta oferta.",
      "pixelId",
    );
    // Mesmo ID em outra plataforma ou em outra oferta pode.
    await createPixel(offerId, { vendor: "KWAI", pixelId: "123456789012345" });
    const other = await createOffer({ name: "Outra" });
    await createPixel(other.id, { vendor: "META", pixelId: "123456789012345" });
  });

  it("Google Ads: rótulos por evento (aceita o send_to inteiro) e avisa conta errada", async () => {
    const { offerId } = await offerWithPages();
    const ads = await createPixel(offerId, {
      vendor: "GOOGLE_ADS",
      pixelId: "AW-123456789",
      options: {
        conversionLabels: { LEAD: "AW-123456789/AbCdEf12", PURCHASE: " XyZ-987_a ", VIEW_CONTENT: "", NOPE: "x" },
      },
    });
    expect(ads.options).toEqual({ conversionLabels: { LEAD: "AbCdEf12", PURCHASE: "XyZ-987_a" } });
    await expectUserError(
      updatePixel(ads.id, { options: { conversionLabels: { LEAD: "AW-555555555/AbCdEf12" } } }),
      /conta AW-555555555/,
      "options.conversionLabels.LEAD",
    );
    // Opções parciais juntam com as atuais; a lista de rótulos é trocada inteira.
    const utm = await createPixel(offerId, { vendor: "UTMIFY", pixelId: "66f1a2b3c4d5e6f7a8b9c0d1" });
    expect(utm.options).toEqual({ utmsScript: true, preventSubids: false, preventXcodSck: false });
    const utm2 = await updatePixel(utm.id, { options: { preventXcodSck: true, lixo: 1 } });
    expect(utm2.options).toEqual({ utmsScript: true, preventSubids: false, preventXcodSck: true });
    await expectUserError(
      updatePixel(utm.id, { options: { utmsScript: "sim" } }),
      /opção do pixel/,
      "options.utmsScript",
    );
  });

  it("token: salvar, trocar, remover; envio pelo servidor sem token fica sinalizado", async () => {
    const { offerId } = await offerWithPages();
    const tt = await createPixel(offerId, {
      vendor: "TIKTOK",
      pixelId: "CABCDEFGHIJKLMNOPQ12",
      options: { eventsApi: true },
    });
    expect(tt).toMatchObject({ hasToken: false, needsToken: true });
    const withToken = await setPixelToken(tt.id, ` ${TIKTOK_TOKEN} `);
    expect(withToken).toMatchObject({ hasToken: true, needsToken: false, tokenHint: "••••••4567" });
    const first = (await prisma.pixelConfig.findUniqueOrThrow({ where: { id: tt.id } })).accessTokenEnc;
    await setPixelToken(tt.id, `${TIKTOK_TOKEN}ff`);
    const second = (await prisma.pixelConfig.findUniqueOrThrow({ where: { id: tt.id } })).accessTokenEnc;
    expect(second).not.toBe(first);
    expect(decryptSecret(second as string)).toBe(`${TIKTOK_TOKEN}ff`);
    const removed = await setPixelToken(tt.id, null);
    expect(removed).toMatchObject({ hasToken: false, needsToken: true });
    expect(await readPixelTokenForServerFile(tt.id)).toBeNull();

    // Token que não dá para ler (chave trocada): o painel pede para colar de novo.
    await prisma.pixelConfig.update({
      where: { id: tt.id },
      data: { accessTokenEnc: "v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
    });
    const [broken] = await listPixels(offerId);
    expect(broken).toMatchObject({ hasToken: true, tokenUnreadable: true, tokenHint: null, needsToken: true });
    await expectUserError(readPixelTokenForServerFile(tt.id), /Cole o token de novo/, "accessToken");
  });

  it("liga/desliga, troca o ID (checando repetição) e exclui", async () => {
    const { offerId } = await offerWithPages();
    const a = await createPixel(offerId, { vendor: "KWAI", pixelId: "283746592837465" });
    const b = await createPixel(offerId, { vendor: "KWAI", pixelId: "999999999" });
    expect((await setPixelEnabled(a.id, false)).enabled).toBe(false);
    await expectUserError(updatePixel(b.id, { pixelId: "283746592837465" }), /já está cadastrado/, "pixelId");
    expect((await updatePixel(b.id, { pixelId: "111111111", label: "" })).label).toBeNull();
    await deletePixel(a.id);
    expect((await listPixels(offerId)).map((p) => p.pixelId)).toEqual(["111111111"]);
    await expectUserError(deletePixel(a.id), "Pixel não encontrado. Ele pode ter sido excluído.");
  });
});

describe("configurações de rastreamento", () => {
  it("lê com padrões e salva mudanças parciais sem perder o resto", async () => {
    const { offerId, legalId } = await offerWithPages();
    expect((await getTrackingSettings(offerId)).consent.mode).toBe("OPT_IN");
    await saveTrackingSettings(offerId, { consent: { mode: "NOTICE", policyPageId: legalId } });
    const saved = await saveTrackingSettings(offerId, {
      forwarding: { params: [" utm_source ", "sck", "sck", ""], persistDays: 7 },
      value: { amount: 197 },
    });
    expect(saved.consent).toMatchObject({ mode: "NOTICE", policyPageId: legalId, acceptLabel: "Aceitar" });
    expect(saved.forwarding).toMatchObject({ params: ["utm_source", "sck"], persistDays: 7, enabled: true });
    expect(saved.value).toEqual({ currency: "BRL", amount: 197 });
    expect(await getTrackingSettings(offerId)).toEqual(saved);
  });

  it("valida tudo com mensagens em português e o campo culpado", async () => {
    const { offerId } = await offerWithPages();
    const other = await createOffer({ name: "Outra" });
    const otherPage = await prisma.page.findFirstOrThrow({ where: { offerId: other.id } });
    await expectUserError(
      saveTrackingSettings(offerId, { consent: { policyPageId: otherPage.id } }),
      "Essa página não faz parte desta oferta.",
      "consent.policyPageId",
    );
    await expectUserError(
      saveTrackingSettings(offerId, { consent: { text: "x".repeat(601) } }),
      "O texto do banner pode ter no máximo 600 caracteres.",
      "consent.text",
    );
    await expectUserError(
      saveTrackingSettings(offerId, { consent: { acceptLabel: "  " } }),
      "Escreva o texto do botão “Aceitar”.",
      "consent.acceptLabel",
    );
    await expectUserError(
      saveTrackingSettings(offerId, { forwarding: { params: ["utm source"] } }),
      /parâmetro “utm source” tem caracteres inválidos/,
      "forwarding.params",
    );
    await expectUserError(
      saveTrackingSettings(offerId, { forwarding: { persistDays: 365 } }),
      "Escolha de 0 a 90 dias.",
      "forwarding.persistDays",
    );
    await expectUserError(
      saveTrackingSettings(offerId, { value: { amount: -1 } }),
      "Informe um valor entre 0 e 1.000.000.",
      "value.amount",
    );
    await expectUserError(
      saveTrackingSettings(offerId, { consent: { mode: "TALVEZ" as never } }),
      "Escolha uma das opções da lista.",
      "consent.mode",
    );
    await expectUserError(
      saveTrackingSettings(offerId, { customCode: { head: "<script>fbq('init','1')" } }),
      /código no <head> tem um <script> sem <\/script>/,
      "customCode.head",
    );
    await expectUserError(
      saveTrackingSettings(offerId, { customCode: { bodyEnd: `<!--${"x".repeat(205 * 1024)}-->` } }),
      /200 KB/,
      "customCode.head",
    );
    // Nada foi salvo.
    expect(await getTrackingSettings(offerId)).toEqual(await getTrackingSettings(other.id));
  });

  it("código livre da oferta (limpo) e nomes de evento personalizados (vazio = padrão)", async () => {
    const { offerId } = await offerWithPages();
    const saved = await saveTrackingSettings(offerId, {
      customCode: { head: "  <script>a()</script>\r\n  ", category: "ANALYTICS" },
      eventNames: { META: { LEAD: " CadastroVIP ", PURCHASE: "" }, TIKTOK: { LEAD: "" } },
    });
    expect(saved.customCode).toEqual({
      head: "<script>a()</script>",
      bodyStart: "",
      bodyEnd: "",
      category: "ANALYTICS",
    });
    expect(saved.eventNames).toEqual({ META: { LEAD: "CadastroVIP" } });
    const cleared = await saveTrackingSettings(offerId, { eventNames: { META: {} } });
    expect(cleared.eventNames).toEqual({});
    await expectUserError(
      saveTrackingSettings(offerId, { eventNames: { META: { LEAD: "Cadastro<script>" } } }),
      /nome do evento/,
      "eventNames.META.LEAD",
    );
  });
});

describe("categoria do código livre da página", () => {
  it("salva a categoria sem mexer nos códigos, e salvar os códigos mantém a categoria", async () => {
    const { homeId } = await offerWithPages();
    await savePageCode(homeId, { head: "<script>x()</script>" });
    expect(await savePageCodeCategory(homeId, "MARKETING")).toBe("MARKETING");
    let page = await prisma.page.findUniqueOrThrow({ where: { id: homeId } });
    expect(page.customCode).toMatchObject({ head: "<script>x()</script>", category: "MARKETING" });
    await savePageCode(homeId, { head: "<script>y()</script>" });
    page = await prisma.page.findUniqueOrThrow({ where: { id: homeId } });
    expect(page.customCode).toMatchObject({ head: "<script>y()</script>", category: "MARKETING" });
    expect(await getPageCode(homeId)).toEqual({ head: "<script>y()</script>", bodyStart: "", bodyEnd: "" });
    await expectUserError(
      savePageCodeCategory(homeId, "TUDO" as never),
      "Escolha quando o código carrega.",
      "category",
    );
    await expectUserError(savePageCodeCategory("nao-existe", "MARKETING"), /Página não encontrada/);
  });
});

describe("regras de evento", () => {
  it("cria, lista (com o nome da página), edita, liga/desliga e exclui", async () => {
    const { offerId, obrigadoId } = await offerWithPages();
    const lead = await createEventRule(offerId, { event: "LEAD", trigger: "FORM_SUBMIT", value: 30, selector: "#x" });
    expect(lead).toMatchObject({ pageId: null, pageName: null, value: null, selector: null, enabled: true });
    const purchase = await createEventRule(offerId, { pageId: obrigadoId, event: "PURCHASE", trigger: "PAGE_LOAD" });
    expect(purchase).toMatchObject({ pageId: obrigadoId, pageName: "Obrigado" });
    const click = await createEventRule(offerId, {
      event: "CONTACT",
      trigger: "ELEMENT_CLICK",
      selector: ' [data-os-link="whatsapp"] ',
    });
    expect(click.selector).toBe('[data-os-link="whatsapp"]');

    const edited = await updateEventRule(purchase.id, { pageId: null, trigger: "TIME_ON_PAGE", value: 5 });
    expect(edited).toMatchObject({
      pageId: null,
      pageName: null,
      event: "PURCHASE",
      trigger: "TIME_ON_PAGE",
      value: 5,
    });
    expect((await setEventRuleEnabled(lead.id, false)).enabled).toBe(false);
    await deleteEventRule(click.id);
    expect((await listEventRules(offerId)).map((r) => r.event)).toEqual(["LEAD", "PURCHASE"]);
    await expectUserError(deleteEventRule(click.id), "Regra não encontrada. Ela pode ter sido excluída.");
  });

  it("valida evento, gatilho, valor, seletor, página e repetição", async () => {
    const { offerId, homeId } = await offerWithPages();
    const other = await createOffer({ name: "Outra" });
    const otherPage = await prisma.page.findFirstOrThrow({ where: { offerId: other.id } });
    await expectUserError(
      createEventRule(offerId, { event: "PAGE_VIEW", trigger: "PAGE_LOAD" }),
      /PageView já dispara sozinho/,
      "event",
    );
    await expectUserError(
      createEventRule(offerId, { event: "VIEW_CONTENT", trigger: "TIME_ON_PAGE" }),
      "Informe quantos segundos.",
      "value",
    );
    await expectUserError(
      createEventRule(offerId, { event: "VIEW_CONTENT", trigger: "TIME_ON_PAGE", value: 100_000 }),
      /até 24 horas/,
      "value",
    );
    await expectUserError(
      createEventRule(offerId, { event: "VIEW_CONTENT", trigger: "SCROLL_DEPTH", value: 0 }),
      "Informe uma porcentagem entre 1 e 100.",
      "value",
    );
    await expectUserError(
      createEventRule(offerId, { event: "LEAD", trigger: "ELEMENT_CLICK", selector: "<button>" }),
      /trecho de HTML/,
      "selector",
    );
    await expectUserError(
      createEventRule(offerId, { event: "LEAD", trigger: "ELEMENT_CLICK", selector: "div[" }),
      /seletor CSS não é válido/,
      "selector",
    );
    await expectUserError(
      createEventRule(offerId, { event: "LEAD", trigger: "ELEMENT_CLICK", selector: "a >" }),
      /incompleto/,
      "selector",
    );
    await expectUserError(
      createEventRule(offerId, { pageId: otherPage.id, event: "LEAD", trigger: "FORM_SUBMIT" }),
      "Essa página não faz parte desta oferta.",
      "pageId",
    );
    await createEventRule(offerId, { pageId: homeId, event: "LEAD", trigger: "FORM_SUBMIT" });
    await expectUserError(
      createEventRule(offerId, { pageId: homeId, event: "LEAD", trigger: "FORM_SUBMIT" }),
      "Essa regra já existe nesta oferta.",
    );
    // Mesma regra para a oferta inteira é outra regra.
    await createEventRule(offerId, { event: "LEAD", trigger: "FORM_SUBMIT" });
    expect(checkSelector("a[href*='hotmart'], .cta > button:nth-child(2)")).toBeNull();
  });

  it("'Usar recomendadas' é idempotente e não duplica o que já existe", async () => {
    const { offerId } = await offerWithPages();
    await createEventRule(offerId, { event: "LEAD", trigger: "FORM_SUBMIT" });
    const first = await applyRecommendedRules(offerId);
    expect(first.created).toBe(RECOMMENDED_RULES.length - 1);
    expect(first.rules.map((r) => `${r.event}:${r.trigger}:${r.value ?? ""}`).sort()).toEqual([
      "INITIATE_CHECKOUT:CHECKOUT_CLICK:",
      "LEAD:FORM_SUBMIT:",
      "VIEW_CONTENT:TIME_ON_PAGE:15",
    ]);
    const second = await applyRecommendedRules(offerId);
    expect(second.created).toBe(0);
    expect(second.rules).toHaveLength(3);
  });
});

describe("tela do painel e configuração pública do banco", () => {
  it("getTrackingPanel devolve tudo o que a tela precisa (e null para oferta inexistente)", async () => {
    const { offerId, homeId } = await offerWithPages();
    await createOfferLink(offerId, { label: "Checkout", url: "https://pay.hotmart.com/X1", kind: "CHECKOUT" });
    await createPixel(offerId, { vendor: "META", pixelId: "123456789012345", options: { capi: true } });
    await savePageCode(homeId, { head: "<script>x()</script>" });
    await savePageCodeCategory(homeId, "ANALYTICS");
    const panel = await getTrackingPanel(offerId);
    expect(panel).not.toBeNull();
    expect(panel?.offer).toEqual({ id: offerId, name: "Oferta" });
    expect(panel?.pixels).toHaveLength(1);
    expect(panel?.pixelsNeedingToken).toBe(1);
    expect(panel?.missingRecommended.map((r) => `${r.event}:${r.trigger}`)).toEqual([
      "VIEW_CONTENT:TIME_ON_PAGE",
      "INITIATE_CHECKOUT:CHECKOUT_CLICK",
      "LEAD:FORM_SUBMIT",
    ]);
    expect(panel?.offerCodeTrackers).toEqual([]);
    expect(panel?.settings.consent.mode).toBe("OPT_IN");
    expect(panel?.links).toEqual([expect.objectContaining({ key: "checkout", kind: "CHECKOUT" })]);
    expect(panel?.pages.map((p) => [p.name, p.codeCategory, p.hasCode])).toEqual([
      ["Página principal", "ANALYTICS", true],
      ["Política", "NECESSARY", false],
      ["Obrigado", "NECESSARY", false],
    ]);
    expect(await getTrackingPanel("nao-existe")).toBeNull();
  });

  it("buildTrackingConfig: pixels ligados, regras da página, checkout, política; nunca o token", async () => {
    const { offerId, homeId, legalId, obrigadoId } = await offerWithPages();
    await createOfferLink(offerId, { label: "Checkout", url: "https://checkout.minhaloja.com/p/1", kind: "CHECKOUT" });
    await createOfferLink(offerId, { label: "WhatsApp", url: "https://wa.me/551199999999", kind: "WHATSAPP" });
    await createPixel(offerId, {
      vendor: "META",
      pixelId: "123456789012345",
      accessToken: META_TOKEN,
      options: { capi: true },
    });
    const off = await createPixel(offerId, { vendor: "GA4", pixelId: "G-ABC123DEF4" });
    await setPixelEnabled(off.id, false);
    await applyRecommendedRules(offerId);
    await createEventRule(offerId, { pageId: obrigadoId, event: "PURCHASE", trigger: "PAGE_LOAD" });
    const disabled = await createEventRule(offerId, { event: "CONTACT", trigger: "ELEMENT_CLICK", selector: "#w" });
    await setEventRuleEnabled(disabled.id, false);
    await saveTrackingSettings(offerId, {
      consent: { policyPageId: legalId },
      eventNames: { META: { LEAD: "CadastroVIP" } },
      customCode: { head: "<script>oferta()</script>" },
    });

    const home = await buildTrackingConfig({ offerId, pageId: homeId, mode: "preview", pageHref: (id) => `/p/${id}` });
    expect(home).not.toBeNull();
    expect(home?.mode).toBe("preview");
    expect(home?.pixels).toEqual([{ vendor: "META", id: "123456789012345", options: {} }]);
    expect(home?.rules.map((r) => r.event)).toEqual(["VIEW_CONTENT", "INITIATE_CHECKOUT", "LEAD"]);
    expect(home?.names.META?.LEAD).toBe("CadastroVIP");
    expect(home?.checkoutLinkKeys).toEqual(["checkout"]);
    expect(home?.checkoutHosts).toContain("checkout.minhaloja.com");
    expect(home?.consent.policyUrl).toBe(`/p/${legalId}`);
    expect(home?.server).toBeNull();
    expect(home?.test).toBeNull();
    expect(JSON.stringify(home)).not.toContain(META_TOKEN);
    expect(JSON.stringify(home)).not.toContain("v1:");

    const thanks = await loadTracking({
      offerId,
      pageId: obrigadoId,
      mode: "live",
      pageHref: (id) => `../${id}/`,
      serverEndpoint: "eventos.php",
    });
    expect(thanks?.config.rules.map((r) => r.event)).toEqual(["VIEW_CONTENT", "INITIATE_CHECKOUT", "LEAD", "PURCHASE"]);
    expect(thanks?.config.server).toEqual({ endpoint: "eventos.php", vendors: ["META"] });
    expect(thanks?.settings.customCode.head).toBe("<script>oferta()</script>");

    // Política apontando para uma página excluída: sem link.
    await prisma.page.delete({ where: { id: legalId } });
    const after = await buildTrackingConfig({ offerId, pageId: homeId, mode: "preview", pageHref: (id) => `/p/${id}` });
    expect(after?.consent.policyUrl).toBeNull();

    await prisma.offer.update({ where: { id: offerId }, data: { deletedAt: new Date() } });
    expect(await buildTrackingConfig({ offerId, pageId: homeId, mode: "preview", pageHref: () => "#" })).toBeNull();
  });
});

describe("duplicar oferta", () => {
  it("copia pixels (com token), regras (páginas novas), rastreamento (política remapeada) e configurações", async () => {
    const { offerId, legalId, obrigadoId } = await offerWithPages();
    await createPixel(offerId, {
      vendor: "META",
      pixelId: "123456789012345",
      accessToken: META_TOKEN,
      options: { capi: true },
    });
    await createPixel(offerId, {
      vendor: "GOOGLE_ADS",
      pixelId: "AW-123456789",
      options: { conversionLabels: { LEAD: "AbCdEf12" } },
    });
    await createEventRule(offerId, { pageId: obrigadoId, event: "PURCHASE", trigger: "PAGE_LOAD" });
    await applyRecommendedRules(offerId);
    await saveTrackingSettings(offerId, { consent: { mode: "NOTICE", policyPageId: legalId } });
    await prisma.offer.update({ where: { id: offerId }, data: { settings: { company: { name: "ACME" } } } });

    const copy = await duplicateOffer(offerId);
    const pixels = await listPixels(copy.id);
    expect(pixels.map((p) => [p.vendor, p.pixelId, p.hasToken])).toEqual([
      ["META", "123456789012345", true],
      ["GOOGLE_ADS", "AW-123456789", false],
    ]);
    expect(await readPixelTokenForServerFile(pixels[0].id)).toBe(META_TOKEN);
    expect(pixels[1].options).toEqual({ conversionLabels: { LEAD: "AbCdEf12" } });

    const newObrigado = await prisma.page.findFirstOrThrow({ where: { offerId: copy.id, name: "Obrigado" } });
    const newLegal = await prisma.page.findFirstOrThrow({ where: { offerId: copy.id, name: "Política" } });
    const rules = await listEventRules(copy.id);
    expect(rules).toHaveLength(4);
    expect(rules.find((r) => r.event === "PURCHASE")?.pageId).toBe(newObrigado.id);

    const settings = await getTrackingSettings(copy.id);
    expect(settings.consent).toMatchObject({ mode: "NOTICE", policyPageId: newLegal.id });
    // A original continua apontando para a página dela.
    expect((await getTrackingSettings(offerId)).consent.policyPageId).toBe(legalId);
    const copyRow = await prisma.offer.findUniqueOrThrow({ where: { id: copy.id } });
    expect(copyRow.settings).toEqual({ company: { name: "ACME" } });
  });
});

// ─── Correções da revisão da Fase 4 ──────────────────────────────────────────

const META_BASE =
  "<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){};t=b.createElement(e);t.src=v;b.head.appendChild(t)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','123456789012345');fbq('track','PageView');</script>";

describe("código livre com pixel (categoria automática)", () => {
  it("página sem categoria escolhida: com pixel vale Marketing (automático); escolha explícita vale; null volta ao automático", async () => {
    const { offerId, homeId, legalId } = await offerWithPages();
    await savePageCode(homeId, { head: META_BASE });
    await savePageCode(legalId, { bodyEnd: "<script>window.chat=1</script>" });
    let panel = await getTrackingPanel(offerId);
    const row = (id: string) => panel?.pages.find((p) => p.id === id);
    expect(row(homeId)).toMatchObject({
      codeCategory: "MARKETING",
      codeCategoryAuto: true,
      codeTrackers: ["Meta Pixel"],
      hasCode: true,
    });
    expect(row(legalId)).toMatchObject({ codeCategory: "NECESSARY", codeCategoryAuto: true, codeTrackers: [] });
    expect(await getPageCodeView(homeId)).toMatchObject({ head: META_BASE, category: null });

    // A pessoa escolhe "Essencial": vale a escolha (o painel avisa do risco).
    await savePageCodeCategory(homeId, "NECESSARY");
    panel = await getTrackingPanel(offerId);
    expect(row(homeId)).toMatchObject({
      codeCategory: "NECESSARY",
      codeCategoryAuto: false,
      codeTrackers: ["Meta Pixel"],
    });
    expect((await getPageCodeView(homeId)).category).toBe("NECESSARY");
    // Salvar o código de novo mantém a escolha.
    await savePageCode(homeId, { head: META_BASE, bodyEnd: "<p>x</p>" });
    expect((await getPageCodeView(homeId)).category).toBe("NECESSARY");

    // null = automático de novo (a chave some do JSON; head/body ficam).
    expect(await savePageCodeCategory(homeId, null)).toBeNull();
    const stored = await prisma.page.findUniqueOrThrow({ where: { id: homeId }, select: { customCode: true } });
    expect(stored.customCode).not.toHaveProperty("category");
    expect(await getPageCode(homeId)).toMatchObject({ head: META_BASE, bodyEnd: "<p>x</p>" });
    panel = await getTrackingPanel(offerId);
    expect(row(homeId)).toMatchObject({ codeCategory: "MARKETING", codeCategoryAuto: true });
  });

  it("código livre da oferta: o painel recebe os rastreadores achados", async () => {
    const { offerId } = await offerWithPages();
    await saveTrackingSettings(offerId, {
      customCode: {
        head: '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4"></script>',
        category: "NECESSARY",
      },
    });
    expect((await getTrackingPanel(offerId))?.offerCodeTrackers).toEqual(["Google Analytics"]);
  });

  it("refix 1: rastreador só da base third-party-web, script de fora desconhecido e pixel no HTML da página", async () => {
    const { offerId, homeId, legalId } = await offerWithPages();
    await savePageCode(homeId, { head: '<script src="https://cdn.inspectlet.com/inspectlet.js?wid=1"></script>' });
    await savePageCode(legalId, { bodyEnd: '<script src="https://widget.desconhecido-exemplo.com/w.js"></script>' });
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: legalId } } });
    await prisma.pageDocument.update({ where: { id: doc.id }, data: { html: `<p>x</p>${META_BASE}` } });
    const panel = await getTrackingPanel(offerId);
    const row = (id: string) => panel?.pages.find((p) => p.id === id);
    expect(row(homeId)).toMatchObject({
      codeCategory: "MARKETING",
      codeTrackers: ["Inspectlet"],
      codeUnknownScripts: [],
      htmlTrackers: [],
    });
    expect(row(legalId)).toMatchObject({
      codeCategory: "NECESSARY",
      codeCategoryAuto: true,
      codeTrackers: [],
      codeUnknownScripts: ["widget.desconhecido-exemplo.com"],
      htmlTrackers: ["Meta Pixel"],
    });
  });
});

describe("regras recomendadas que faltam", () => {
  it("lista só as que faltam; 'Não sugerir mais' esconde enquanto houver regras", async () => {
    const { offerId } = await offerWithPages();
    await createEventRule(offerId, { event: "LEAD", trigger: "FORM_SUBMIT" });
    await createEventRule(offerId, { event: "VIEW_CONTENT", trigger: "TIME_ON_PAGE", value: 15 });
    let panel = await getTrackingPanel(offerId);
    expect(panel?.missingRecommended.map((r) => r.event)).toEqual(["INITIATE_CHECKOUT"]);

    await dismissRecommendedRules(offerId);
    expect((await getTrackingSettings(offerId)).dismissedRecommended).toBe(true);
    panel = await getTrackingPanel(offerId);
    expect(panel?.missingRecommended).toEqual([]);

    // Sem nenhuma regra, as recomendadas voltam (é o ponto de partida da aba).
    for (const rule of await listEventRules(offerId)) await deleteEventRule(rule.id);
    panel = await getTrackingPanel(offerId);
    expect(panel?.missingRecommended).toHaveLength(3);
  });
});

describe("UTMify: um pixel por oferta", () => {
  it("recusa um segundo pixel ativo (criar, ativar ou editar); desativado pode ficar guardado", async () => {
    const { offerId } = await offerWithPages();
    const first = await createPixel(offerId, { vendor: "UTMIFY", pixelId: "66f1a2b3c4d5e6f7a8b9c0d1" });
    await expectUserError(
      createPixel(offerId, { vendor: "UTMIFY", pixelId: "77f1a2b3c4d5e6f7a8b9c0d1" }),
      UTMIFY_SINGLE_MESSAGE,
      "pixelId",
    );
    const second = await createPixel(offerId, {
      vendor: "UTMIFY",
      pixelId: "77f1a2b3c4d5e6f7a8b9c0d1",
      enabled: false,
    });
    await expectUserError(setPixelEnabled(second.id, true), UTMIFY_SINGLE_MESSAGE, "pixelId");
    await expectUserError(updatePixel(second.id, { enabled: true }), UTMIFY_SINGLE_MESSAGE, "pixelId");
    // Editar o ativo (ou o desativado sem ligar) continua valendo.
    await updatePixel(first.id, { label: "Conta A", enabled: true });
    await updatePixel(second.id, { label: "Conta B" });
    // Trocar: desativa o primeiro e ativa o segundo.
    await setPixelEnabled(first.id, false);
    expect((await setPixelEnabled(second.id, true)).enabled).toBe(true);
    // Outras plataformas continuam aceitando vários pixels.
    await createPixel(offerId, { vendor: "META", pixelId: "123456789012345" });
    await createPixel(offerId, { vendor: "META", pixelId: "223456789012345" });
    expect((await listPixels(offerId)).filter((p) => p.enabled).map((p) => p.vendor)).toEqual([
      "UTMIFY",
      "META",
      "META",
    ]);
  });
});

describe("aviso de cookies: textos e política automática", () => {
  it("textos do botão 'Entendi' e do link da política: salvos, obrigatórios quando enviados, na configuração pública", async () => {
    const { offerId, homeId } = await offerWithPages();
    await expectUserError(
      saveTrackingSettings(offerId, { consent: { noticeLabel: "  " } }),
      /botão/,
      "consent.noticeLabel",
    );
    await expectUserError(
      saveTrackingSettings(offerId, { consent: { policyLabel: " " } }),
      "Escreva o texto do link da política de privacidade.",
      "consent.policyLabel",
    );
    await expectUserError(
      saveTrackingSettings(offerId, { consent: { policyLabel: "x".repeat(61) } }),
      "O texto do link pode ter no máximo 60 caracteres.",
      "consent.policyLabel",
    );
    await saveTrackingSettings(offerId, {
      consent: { mode: "NOTICE", noticeLabel: "Got it", policyLabel: "Privacy policy" },
    });
    const cfg = await buildTrackingConfig({ offerId, pageId: homeId, mode: "preview", pageHref: (id) => `/p/${id}` });
    expect(cfg?.consent).toMatchObject({ mode: "NOTICE", noticeLabel: "Got it", policyLabel: "Privacy policy" });
  });

  it("sem escolha, o link vai para a página 'Política de privacidade' da oferta; 'Nenhuma' tira o link", async () => {
    const { offerId, homeId, legalId } = await offerWithPages();
    const href = (id: string) => `/p/${id}`;
    const policyUrl = async () =>
      (await buildTrackingConfig({ offerId, pageId: homeId, mode: "preview", pageHref: href }))?.consent.policyUrl;
    // "Política" (Termos? não dá para saber) não conta como política de privacidade.
    expect(await policyUrl()).toBeNull();
    const terms = await createPage({ offerId, name: "Termos de uso", type: "LEGAL" });
    const privacy = await createPage({ offerId, name: "Política de privacidade", type: "LEGAL" });
    expect(await policyUrl()).toBe(href(privacy.id));

    await saveTrackingSettings(offerId, { consent: { policyPageId: POLICY_NONE } });
    expect((await getTrackingSettings(offerId)).consent.policyPageId).toBe(POLICY_NONE);
    expect(await policyUrl()).toBeNull();

    await saveTrackingSettings(offerId, { consent: { policyPageId: legalId } });
    expect(await policyUrl()).toBe(href(legalId));
    // A escolhida foi excluída: volta ao automático.
    await prisma.page.delete({ where: { id: legalId } });
    expect(await policyUrl()).toBe(href(privacy.id));
    await saveTrackingSettings(offerId, { consent: { policyPageId: null } });
    expect(await policyUrl()).toBe(href(privacy.id));
    expect(terms.id).not.toBe(privacy.id);
  });

  it("páginas sem o link 'Preferências de cookies' aparecem no painel (ganham o botão flutuante)", async () => {
    const { offerId, homeId, legalId } = await offerWithPages();
    await prisma.pageDocument.updateMany({
      where: { variant: { pageId: homeId } },
      data: {
        html: '<html><body><footer><a href="#" data-os-consent-open>Preferências de cookies</a></footer></body></html>',
      },
    });
    await prisma.pageDocument.updateMany({
      where: { variant: { pageId: legalId } },
      data: { html: "<html><body><h1>Política</h1></body></html>" },
    });
    const panel = await getTrackingPanel(offerId);
    expect(panel?.pages.find((p) => p.id === homeId)?.hasConsentLink).toBe(true);
    expect(panel?.pages.find((p) => p.id === legalId)?.hasConsentLink).toBe(false);
  });
});
