/**
 * Fase 4 — telas "Pixels e rastreamento" e "Empresa e SEO" num Chromium de
 * verdade (tests/unit/tracking-ui-harness.ts), com as server actions e o banco
 * de teste de verdade.
 */
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/api", () => ({ guardApi: vi.fn(async () => null) }));

import sharp from "sharp";
import { decryptSecret, maskSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { parseOfferSettings, parsePageSeo } from "@/lib/offer-settings";
import { DEFAULT_FORWARD_PARAMS, parseTrackingSettings } from "@/lib/tracking/schema";
import { createOfferLink } from "@/server/services/offer-links";
import { saveOfferSettings } from "@/server/services/offer-settings";
import { createOffer } from "@/server/services/offers";
import { savePageCode } from "@/server/services/page-code";
import { createPage } from "@/server/services/pages";
import { applyRecommendedRules, createPixel } from "@/server/services/tracking";
import { resetDatabase } from "../setup/per-file";
import {
  callsOf,
  choose,
  openPanel,
  panelBundle,
  panelCss,
  type Session,
  toasts,
  waitFor,
  waitToast,
} from "./tracking-ui-harness";

const SHOTS = process.env.OS_UI_SHOTS;

let browser: Browser;
const sessions: Session[] = [];

beforeAll(async () => {
  await Promise.all([panelBundle(), panelCss()]);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  for (const s of sessions) await s.page.close().catch(() => undefined);
  await browser?.close();
});

beforeEach(async () => {
  await resetDatabase();
});

async function open(kind: Parameters<typeof openPanel>[1], offerId: string, props?: Record<string, unknown>) {
  const s = await openPanel(browser, kind, offerId, props);
  sessions.push(s);
  return s;
}

/** Oferta com página inicial, política, obrigado e dois links (checkout e WhatsApp). */
async function offerFixture() {
  const offer = await createOffer({ name: "Oferta Pixels" });
  const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
  const legal = await createPage({ offerId: offer.id, name: "Política de privacidade", type: "LEGAL" });
  const thanks = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
  await createOfferLink(offer.id, { label: "Checkout principal", kind: "CHECKOUT", url: "https://pay.hotmart.com/X1" });
  await createOfferLink(offer.id, { label: "WhatsApp", kind: "WHATSAPP", url: "https://wa.me/5511999999999" });
  return { offerId: offer.id, homeId: home.id, legalId: legal.id, thanksId: thanks.id };
}

const META_TOKEN = "EAAGm0PX4ZCpsBAKZCZBy1234567890abcdefghijklmnopqrstuvwxyz";
const META_TOKEN_2 = "EAAGnovoTokenZCZBy0987654321zyxwvutsrqponmlkjihgfedcba";

const dialog = (s: Session) => s.page.getByRole("dialog");

async function tracking(offerId: string) {
  return parseTrackingSettings((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).tracking);
}

async function expectNoErrors(s: Session) {
  expect(s.errors).toEqual([]);
}

describe("pixels", () => {
  it("Meta: ID inválido no campo, código colado vira o ID e o token só aparece como “configurado”", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId);
    const p = s.page;

    // Oferta sem pixel: a grade de plataformas já aparece (2 cliques até o formulário).
    await expect(p.getByText("Nenhum pixel nesta oferta ainda")).toBeTruthy();
    await p.getByRole("button", { name: /^Meta \(Facebook e Instagram\)/ }).click();
    const d = dialog(s);
    const id = d.getByLabel("ID do pixel");
    await id.fill("abc");
    await d.getByLabel("Apelido (opcional)").click();
    await d.getByText("O ID do pixel da Meta tem só números (10 a 20 dígitos).").waitFor();
    expect(await id.getAttribute("aria-invalid")).toBe("true");

    await id.fill("<script>fbq('init', '123456789012345');</script>");
    await d.getByText("ID encontrado:").waitFor();
    expect(await d.getByText("123456789012345").count()).toBe(1);
    expect(await d.getByText("O ID do pixel da Meta tem só números (10 a 20 dígitos).").count()).toBe(0);
    await d.getByLabel("Apelido (opcional)").fill("Conta principal");

    await d.getByRole("switch", { name: "Enviar também pela API de Conversões" }).click();
    await d.getByText("O token nunca vai para o HTML da página").waitFor();
    const token = d.getByLabel("Token de acesso da API de Conversões");
    expect(await token.getAttribute("type")).toBe("password");
    await token.fill(META_TOKEN);
    await d.getByLabel("Código de teste de eventos (opcional)").fill("TEST123");
    await d.getByRole("button", { name: "Adicionar pixel" }).click();
    await waitToast(s, "Pixel Meta adicionado.", "success");
    await d.waitFor({ state: "hidden" });

    const card = p.getByRole("region", { name: "Meta (Facebook e Instagram)" });
    await card.getByText("Conta principal").waitFor();
    await card.getByText("API de Conversões ligada").waitFor();
    await card.getByText("Código de teste: TEST123").waitFor();

    const row = await prisma.pixelConfig.findFirstOrThrow({ where: { offerId } });
    expect(row).toMatchObject({
      vendor: "META",
      pixelId: "123456789012345",
      label: "Conta principal",
      testEventCode: "TEST123",
    });
    expect(row.options).toEqual({ capi: true });
    expect(row.accessTokenEnc).toMatch(/^v1:/);
    expect(decryptSecret(row.accessTokenEnc as string)).toBe(META_TOKEN);
    // O token nunca volta para a tela.
    expect(JSON.stringify(s.calls.map((c) => c.result))).not.toContain(META_TOKEN);
    expect(await p.content()).not.toContain(META_TOKEN);

    // Editar: "configurado" + final mascarado, sem o valor em nenhum campo.
    await p.getByRole("button", { name: "Editar pixel 123456789012345" }).click();
    await d.getByText("Token configurado").waitFor();
    await d.getByText(maskSecret(META_TOKEN)).waitFor();
    const values = await d.locator("input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(values.join(" ")).not.toContain(META_TOKEN.slice(0, 12));
    expect(await d.getByLabel("Token de acesso da API de Conversões").count()).toBe(0);

    // Trocar o token.
    await d.getByRole("button", { name: "Trocar token" }).click();
    const fresh = d.getByLabel("Token de acesso da API de Conversões");
    expect(await fresh.inputValue()).toBe("");
    await fresh.fill(META_TOKEN_2);
    await d.getByRole("button", { name: "Salvar pixel" }).click();
    await waitToast(s, "Pixel Meta atualizado.", "success");
    await d.waitFor({ state: "hidden" });
    expect(callsOf(s, "setPixelTokenAction")).toHaveLength(1);
    const updated = await prisma.pixelConfig.findFirstOrThrow({ where: { offerId } });
    expect(decryptSecret(updated.accessTokenEnc as string)).toBe(META_TOKEN_2);

    // Remover o token (com confirmação): o pixel fica avisando que falta o token.
    await p.getByRole("button", { name: "Editar pixel 123456789012345" }).click();
    await d.getByRole("button", { name: "Remover" }).click();
    await p
      .getByRole("alertdialog", { name: "Remover o token?" })
      .getByRole("button", { name: "Remover token" })
      .click();
    await waitToast(s, "Token removido.", "success");
    await d.getByLabel("Token de acesso da API de Conversões").waitFor();
    await d.getByRole("button", { name: "Cancelar" }).click();
    await card.getByText("API de Conversões sem token").waitFor();
    await p.getByText("Falta o token de acesso").waitFor();
    expect((await prisma.pixelConfig.findFirstOrThrow({ where: { offerId } })).accessTokenEnc).toBeNull();
    await expectNoErrors(s);
  });

  it("token recusado pelo servidor: erro no campo (ao criar) e aviso de que só o pixel foi salvo (ao editar)", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId);
    const p = s.page;
    const d = dialog(s);
    await p.getByRole("button", { name: /^Meta/ }).click();
    await d.getByLabel("ID do pixel").fill("123456789012345");
    await d.getByRole("switch", { name: "Enviar também pela API de Conversões" }).click();
    await d.getByLabel("Token de acesso da API de Conversões").fill("curto");
    await d.getByRole("button", { name: "Adicionar pixel" }).click();
    await d.getByText("Esse token parece incompleto. Copie de novo o token da API de Conversões.").waitFor();
    expect(await d.getByLabel("Token de acesso da API de Conversões").getAttribute("aria-invalid")).toBe("true");
    expect(await prisma.pixelConfig.count({ where: { offerId } })).toBe(0);
    // Sem token: salva e avisa que falta.
    await d.getByLabel("Token de acesso da API de Conversões").fill("");
    await d.getByRole("button", { name: "Adicionar pixel" }).click();
    await waitToast(s, "Pixel Meta adicionado.");
    await p.getByText("API de Conversões sem token").waitFor();

    await p.getByRole("button", { name: "Editar pixel 123456789012345" }).click();
    await d.getByLabel("Apelido (opcional)").fill("Principal");
    await d.getByLabel("Token de acesso da API de Conversões").fill("tem espaço no meio do token");
    await d.getByRole("button", { name: "Salvar pixel" }).click();
    await d.getByText("O token não pode ter espaços nem quebras de linha. Copie de novo.").waitFor();
    expect(callsOf(s, "updatePixelAction")).toHaveLength(0);
    await d.getByLabel("Token de acesso da API de Conversões").fill("curto");
    await d.getByRole("button", { name: "Salvar pixel" }).click();
    await waitToast(s, "O pixel foi salvo, mas o token não. Confira o token e salve de novo.", "error");
    await d.getByText("Esse token parece incompleto. Copie de novo o token da API de Conversões.").waitFor();
    expect((await prisma.pixelConfig.findFirstOrThrow({ where: { offerId } })).label).toBe("Principal");
    await expectNoErrors(s);
  });

  it("pixel repetido: o erro do servidor aparece no campo do ID e o diálogo continua aberto", async () => {
    const { offerId } = await offerFixture();
    await createPixel(offerId, { vendor: "META", pixelId: "123456789012345" });
    const s = await open("tracking", offerId);
    await s.page.getByRole("button", { name: "Adicionar pixel" }).click();
    await dialog(s).getByRole("button", { name: /^Meta/ }).click();
    await dialog(s).getByLabel("ID do pixel").fill("123456789012345");
    await dialog(s).getByRole("button", { name: "Adicionar pixel" }).click();
    await dialog(s).getByText("Esse pixel (Meta (Facebook e Instagram)) já está cadastrado nesta oferta.").waitFor();
    expect((await toasts(s)).filter((t) => t.type === "error")).toEqual([]);
    expect(await prisma.pixelConfig.count({ where: { offerId } })).toBe(1);
    // Voltar para a grade e trocar de plataforma.
    await dialog(s).getByRole("button", { name: "Trocar plataforma" }).click();
    await dialog(s).getByRole("list", { name: "Plataformas" }).waitFor();
    await expectNoErrors(s);
  });

  it("TikTok (Events API sem token), GA4 e Google Ads com rótulos; desativar e excluir", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId);
    const p = s.page;
    const d = dialog(s);

    await p.getByRole("button", { name: /^TikTok/ }).click();
    await d.getByLabel("ID do pixel").fill("c1abcdefghij2klmnopq");
    await d.getByText("ID encontrado:").waitFor();
    await d.getByText("C1ABCDEFGHIJ2KLMNOPQ").waitFor();
    await d.getByRole("switch", { name: "Enviar também pela Events API" }).click();
    await d.getByRole("button", { name: "Adicionar pixel" }).click();
    await waitToast(s, "Pixel TikTok adicionado.");
    await p.getByText("Events API sem token").waitFor();
    await p.getByText("Falta o token de acesso").waitFor();

    await p.getByRole("button", { name: "Adicionar pixel" }).click();
    await d.getByRole("button", { name: /^Google Analytics 4/ }).click();
    await d.getByLabel("ID do pixel").fill("G-ABC123DEF4");
    await d.getByRole("button", { name: "Adicionar pixel" }).click();
    await waitToast(s, "Pixel GA4 adicionado.");

    await p.getByRole("button", { name: "Adicionar pixel" }).click();
    await d.getByRole("button", { name: /^Google Ads/ }).click();
    await d.getByLabel("ID do pixel").fill("AW-123456789");
    await d.getByText("Sem nenhum rótulo, o Google Ads só recebe as visitas").waitFor();
    const lead = d.getByLabel(/^Cadastro \/ lead/);
    const purchase = d.getByLabel(/^Compra/);
    await lead.fill("x");
    await purchase.click();
    await d.getByText(/O rótulo de conversão tem só letras, números/).waitFor();
    await purchase.fill("AW-999999999/AbC-D_efG");
    await lead.click();
    await d
      .getByText("Esse rótulo é da conta AW-999999999, mas este pixel é AW-123456789. Confira o ID do Google Ads.")
      .waitFor();
    // Salvar com erro não chama o servidor.
    await d.getByRole("button", { name: "Adicionar pixel" }).click();
    expect(callsOf(s, "createPixelAction")).toHaveLength(2);
    await lead.fill("AbC-D_efG-h12");
    await purchase.fill("AW-123456789/Zyx_123");
    await d.getByRole("button", { name: "Adicionar pixel" }).click();
    await waitToast(s, "Pixel Google Ads adicionado.");
    await p.getByText("2 conversões").waitFor();
    const ads = await prisma.pixelConfig.findFirstOrThrow({ where: { offerId, vendor: "GOOGLE_ADS" } });
    expect(ads.options).toEqual({ conversionLabels: { LEAD: "AbC-D_efG-h12", PURCHASE: "Zyx_123" } });
    await p.getByText("3 pixels ativos").waitFor();

    // Desativar (sem confirmação) e excluir (com confirmação).
    await p.getByRole("switch", { name: "Pixel G-ABC123DEF4 ativo" }).click();
    await waitToast(s, /Pixel desativado/);
    expect((await prisma.pixelConfig.findFirstOrThrow({ where: { offerId, vendor: "GA4" } })).enabled).toBe(false);
    await p.getByText("2 de 3 pixels ativos").waitFor();
    await p.getByRole("region", { name: "Google Analytics 4" }).getByText("Desativado").waitFor();

    await p.getByRole("button", { name: "Excluir pixel C1ABCDEFGHIJ2KLMNOPQ" }).click();
    await p.getByRole("alertdialog").getByRole("button", { name: "Excluir pixel" }).click();
    await waitToast(s, "Pixel excluído.");
    await waitFor(
      async () => (await p.getByRole("region", { name: "TikTok" }).count()) === 0,
      5000,
      "card do TikTok sumir",
    );
    expect(await prisma.pixelConfig.count({ where: { offerId } })).toBe(2);
    await expectNoErrors(s);
  });

  it("UTMify e Kwai: opções do script de UTMs e mais de um pixel da mesma plataforma", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId);
    const p = s.page;
    const d = dialog(s);
    await p.getByRole("button", { name: /^UTMify/ }).click();
    await d.getByLabel("ID do pixel").fill('<script>window.pixelId = "66f1a2b3c4d5e6f7a8b9c0d1";</script>');
    await d.getByText("ID encontrado:").waitFor();
    await d.getByRole("switch", { name: "Não preencher xcod e sck da Hotmart" }).click();
    await d.getByRole("button", { name: "Adicionar pixel" }).click();
    await waitToast(s, "Pixel UTMify adicionado.");
    const utmify = await prisma.pixelConfig.findFirstOrThrow({ where: { offerId, vendor: "UTMIFY" } });
    expect(utmify).toMatchObject({ pixelId: "66f1a2b3c4d5e6f7a8b9c0d1" });
    expect(utmify.options).toEqual({ utmsScript: true, preventSubids: false, preventXcodSck: true });

    for (const [n, id] of [
      ["1", "283746592837465"],
      ["2", "999746592837465"],
    ]) {
      await p.getByRole("button", { name: "Adicionar pixel" }).click();
      await d.getByRole("button", { name: /^Kwai/ }).click();
      await d.getByLabel("ID do pixel").fill(id);
      await d.getByLabel("Apelido (opcional)").fill(`Kwai ${n}`);
      await d.getByRole("button", { name: "Adicionar pixel" }).click();
      await waitToast(s, "Pixel Kwai adicionado.");
      await d.waitFor({ state: "hidden" });
    }
    const kwai = p.getByRole("region", { name: "Kwai" });
    await kwai.getByText("2 pixels").waitFor();
    // "Outro pixel" no cartão da plataforma abre o formulário direto na plataforma.
    await kwai.getByRole("button", { name: "Adicionar outro pixel Kwai" }).click();
    await d.getByText("Anúncios no Kwai").waitFor();
    await d.getByLabel("ID do pixel").waitFor();
    await expectNoErrors(s);
  });
});

describe("eventos", () => {
  it("“Usar recomendados” cria as 3 regras uma vez; depois o aviso some", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId, { initialSection: "eventos" });
    const p = s.page;
    await p.getByText("Comece pelos eventos recomendados").waitFor();
    await p.getByRole("button", { name: "Usar recomendados" }).click();
    await waitToast(s, "3 regras recomendadas criadas.");
    const list = p.getByRole("list", { name: "Regras de evento" });
    await list.getByText("Depois de 15 segundos na página").waitFor();
    await list.getByText("Ao clicar em um botão de checkout").waitFor();
    await list.getByText("Ao enviar um formulário").waitFor();
    await waitFor(
      async () => (await p.getByRole("button", { name: "Usar recomendados" }).count()) === 0,
      5000,
      "botão sumir",
    );
    expect(await prisma.eventRule.count({ where: { offerId } })).toBe(3);
    await p.getByText("PageView + 3 regras").waitFor();
    await expectNoErrors(s);
  });

  it("clique no link da oferta (Contato sugere o WhatsApp) e seletor CSS avançado conferido ao digitar", async () => {
    const { offerId, homeId } = await offerFixture();
    const s = await open("tracking", offerId, { initialSection: "eventos" });
    const p = s.page;
    const d = dialog(s);

    await p.getByRole("button", { name: "Criar regra" }).click();
    await choose(p, "Evento", /^Contato \/ WhatsApp/);
    expect(await d.getByRole("combobox", { name: "Quando dispara" }).textContent()).toContain(
      "Ao clicar em um elemento / link da oferta",
    );
    expect(await d.getByRole("combobox", { name: "O que a pessoa clica" }).textContent()).toContain(
      "Clique no link da oferta: WhatsApp",
    );
    expect(await d.getByTestId("rule-summary").textContent()).toBe(
      "Contact dispara ao clicar no link “WhatsApp”, em todas as páginas.",
    );
    await d.getByRole("button", { name: "Criar regra" }).click();
    await waitToast(s, "Regra criada.");
    const rules = p.getByRole("list", { name: "Regras de evento" });
    await rules.getByText("Ao clicar no link “WhatsApp”").waitFor();
    expect(await prisma.eventRule.findFirstOrThrow({ where: { offerId, event: "CONTACT" } })).toMatchObject({
      trigger: "ELEMENT_CLICK",
      selector: '[data-os-link="whatsapp"]',
      pageId: null,
    });

    // InitiateCheckout no botão do checkout principal, só na página inicial.
    await p.getByRole("button", { name: "Nova regra" }).click();
    await choose(p, "Evento", /^Iniciou checkout/);
    await choose(p, "Quando dispara", "Ao clicar em um elemento / link da oferta");
    await choose(p, "O que a pessoa clica", /Checkout principal/);
    await choose(p, "Em quais páginas", /^Página principal/);
    await d.getByRole("button", { name: "Criar regra" }).click();
    await waitToast(s, "Regra criada.");
    expect(await prisma.eventRule.findFirstOrThrow({ where: { offerId, event: "INITIATE_CHECKOUT" } })).toMatchObject({
      selector: '[data-os-link="checkout-principal"]',
      pageId: homeId,
    });

    // Seletor CSS: inválido e HTML são recusados enquanto digita.
    await p.getByRole("button", { name: "Nova regra" }).click();
    await choose(p, "Evento", /^Adicionou ao carrinho/);
    await choose(p, "Quando dispara", "Ao clicar em um elemento / link da oferta");
    await choose(p, "O que a pessoa clica", /Outro elemento/);
    const selector = d.getByLabel("Seletor CSS");
    await selector.fill("a[href=]");
    await d.getByText(/Esse seletor CSS não é válido/).waitFor();
    expect(await selector.getAttribute("aria-invalid")).toBe("true");
    await selector.fill("<button>Comprar</button>");
    await d.getByText(/Isso parece um trecho de HTML/).waitFor();
    await d.getByRole("button", { name: "Criar regra" }).click();
    expect(callsOf(s, "createEventRuleAction")).toHaveLength(2);
    // O navegador aceita "a[href" (fecha sozinho), o servidor não: o erro dele volta para o campo.
    await selector.fill("a[href");
    await d.getByRole("button", { name: "Criar regra" }).click();
    await d.getByText(/Esse seletor CSS não é válido/).waitFor();
    expect(callsOf(s, "createEventRuleAction")).toHaveLength(3);
    await selector.fill("#comprar .cta");
    await d.getByTestId("rule-summary").waitFor();
    await d.getByRole("button", { name: "Criar regra" }).click();
    await waitToast(s, "Regra criada.");
    await rules.getByText("Ao clicar em #comprar .cta").waitFor();
    expect((await prisma.eventRule.findFirstOrThrow({ where: { offerId, event: "ADD_TO_CART" } })).selector).toBe(
      "#comprar .cta",
    );
    await expectNoErrors(s);
  });

  it("rolagem com % rápido, compra sugere a página de obrigado, editar, desativar e excluir", async () => {
    const { offerId, thanksId } = await offerFixture();
    const s = await open("tracking", offerId, { initialSection: "eventos" });
    const p = s.page;
    const d = dialog(s);

    await p.getByRole("button", { name: "Criar regra" }).click();
    await choose(p, "Evento", /^Visualizou conteúdo/);
    expect(await d.getByLabel("Segundos na página").inputValue()).toBe("15");
    await choose(p, "Quando dispara", "Ao rolar X% da página");
    expect(await d.getByLabel("Quanto da página (%)").inputValue()).toBe("50");
    await d.getByRole("button", { name: "75%" }).click();
    await d.getByRole("button", { name: "Criar regra" }).click();
    await waitToast(s, "Regra criada.");
    expect((await prisma.eventRule.findFirstOrThrow({ where: { offerId } })).value).toBe(75);

    await p.getByRole("button", { name: "Nova regra" }).click();
    await choose(p, "Evento", /^Compra/);
    expect(await d.getByRole("combobox", { name: "Em quais páginas" }).textContent()).toContain("Obrigado");
    await choose(p, "Em quais páginas", "Todas as páginas da oferta");
    await d.getByText("Assim, toda visita a qualquer página conta como compra.").waitFor();
    await choose(p, "Em quais páginas", /^Obrigado/);
    await d.getByRole("button", { name: "Criar regra" }).click();
    await waitToast(s, "Regra criada.");
    expect(await prisma.eventRule.findFirstOrThrow({ where: { offerId, event: "PURCHASE" } })).toMatchObject({
      trigger: "PAGE_LOAD",
      pageId: thanksId,
    });

    // Editar a regra de rolagem: o diálogo abre preenchido.
    await p.getByRole("button", { name: "Editar regra ViewContent: Ao rolar 75% da página" }).click();
    expect(await d.getByLabel("Quanto da página (%)").inputValue()).toBe("75");
    await d.getByLabel("Quanto da página (%)").fill("120");
    await d.getByRole("button", { name: "Salvar regra" }).click();
    await d.getByText("Informe uma porcentagem entre 1 e 100.").waitFor();
    await d.getByRole("button", { name: "90%" }).click();
    await d.getByRole("button", { name: "Salvar regra" }).click();
    await waitToast(s, "Regra salva.");
    await p.getByRole("list", { name: "Regras de evento" }).getByText("Ao rolar 90% da página").waitFor();

    await p.getByRole("switch", { name: "Regra ViewContent (Ao rolar 90% da página) ativa" }).click();
    await waitToast(s, "Regra desativada.");
    expect((await prisma.eventRule.findFirstOrThrow({ where: { offerId, event: "VIEW_CONTENT" } })).enabled).toBe(
      false,
    );

    await p.getByRole("button", { name: "Excluir regra Purchase: Ao abrir a página" }).click();
    await p.getByRole("alertdialog").getByText("Purchase — Ao abrir a página (Obrigado).", { exact: false }).waitFor();
    await p.getByRole("alertdialog").getByRole("button", { name: "Excluir regra" }).click();
    await waitToast(s, "Regra excluída.");
    expect(await prisma.eventRule.count({ where: { offerId } })).toBe(1);
    await expectNoErrors(s);
  });

  it("regra repetida: a mensagem do servidor aparece e o diálogo continua aberto", async () => {
    const { offerId } = await offerFixture();
    await applyRecommendedRules(offerId);
    const s = await open("tracking", offerId, { initialSection: "eventos" });
    const d = dialog(s);
    await s.page.getByRole("button", { name: "Nova regra" }).click();
    await choose(s.page, "Evento", /^Cadastro \/ lead/);
    await d.getByRole("button", { name: "Criar regra" }).click();
    await waitToast(s, "Essa regra já existe nesta oferta.", "error");
    await d.getByRole("button", { name: "Criar regra" }).waitFor();
    expect(await prisma.eventRule.count({ where: { offerId } })).toBe(3);
    await expectNoErrors(s);
  });

  it("valor da oferta (formato brasileiro) e nomes personalizados dos eventos", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId, { initialSection: "eventos" });
    const p = s.page;
    await p.getByLabel("Valor", { exact: true }).fill("abc");
    await p.getByRole("button", { name: "Salvar valor" }).click();
    await p.getByText("Informe um valor entre 0 e 1.000.000, como 97,00.").waitFor();
    await p.getByLabel("Valor", { exact: true }).fill("1.997,00");
    await choose(p, "Moeda", "Dólar (US$)");
    await p.getByRole("button", { name: "Salvar valor" }).click();
    await waitToast(s, "Valor salvo.");
    expect((await tracking(offerId)).value).toEqual({ currency: "USD", amount: 1997 });
    expect(await p.getByLabel("Valor", { exact: true }).inputValue()).toBe("1.997,00");

    await p.getByRole("button", { name: /Nomes dos eventos \(avançado\)/ }).click();
    const lead = p.getByLabel("Nome do evento Cadastro / lead no Meta");
    expect(await lead.getAttribute("placeholder")).toBe("Lead");
    await lead.fill("Lead ç");
    await p.getByRole("button", { name: "Salvar nomes" }).click();
    await p.getByText(/Use só letras sem acento/).waitFor();
    await lead.fill("LeadCaptura");
    await p.getByRole("radio", { name: "TikTok" }).click();
    await p.getByLabel("Nome do evento Compra no TikTok").fill("CompletePayment");
    await p.getByRole("button", { name: "Salvar nomes" }).click();
    await waitToast(s, "Nomes dos eventos salvos.");
    expect((await tracking(offerId)).eventNames).toEqual({
      META: { LEAD: "LeadCaptura" },
      TIKTOK: { PURCHASE: "CompletePayment" },
    });
    await expectNoErrors(s);
  });
});

describe("privacidade (LGPD)", () => {
  it("troca o modo, atualiza a prévia ao vivo e salva", async () => {
    const { offerId, legalId } = await offerFixture();
    await createPixel(offerId, { vendor: "META", pixelId: "123456789012345" });
    const s = await open("tracking", offerId, { initialSection: "privacidade" });
    const p = s.page;
    const banner = p.getByTestId("consent-preview-banner");
    await banner.getByText("Aceitar", { exact: true }).waitFor();
    await banner.getByText("Recusar", { exact: true }).waitFor();

    await p.getByRole("radio", { name: /^Só avisar/ }).check();
    await banner.getByText("Entendi", { exact: true }).waitFor();
    expect(await banner.getByText("Recusar", { exact: true }).count()).toBe(0);
    expect(await p.getByLabel("Botão de aceitar").count()).toBe(0);
    await p.getByText("Recomendamos “Pedir permissão”").waitFor();

    await p.getByRole("radio", { name: "Claro" }).click();
    await choose(p, "Posição", "Caixa no canto direito");
    expect(await banner.getAttribute("data-theme")).toBe("light");
    expect(await banner.getAttribute("data-position")).toBe("bottom-right");
    // Sem escolha, o aviso já usa a página "Política de privacidade" da oferta.
    await banner.getByText("Política de privacidade", { exact: true }).waitFor();
    await choose(p, "Página da política de privacidade", "Nenhuma (aviso sem link)");
    await p.getByText("Esta oferta tem página de política, mas o aviso vai sem link.", { exact: false }).waitFor();
    expect(await banner.getByText("Política de privacidade", { exact: true }).count()).toBe(0);
    await choose(p, "Página da política de privacidade", /^Política de privacidade$/);
    await banner.getByText("Política de privacidade", { exact: true }).waitFor();
    // Textos do botão "Entendi" e do link são da oferta (ex.: página em inglês).
    await p.getByLabel("Botão do aviso").fill("Got it");
    await banner.getByText("Got it", { exact: true }).waitFor();
    await p.getByLabel("Texto do link").fill("Privacy policy");
    await banner.getByText("Privacy policy", { exact: true }).waitFor();
    await p.getByLabel("Texto do aviso").fill("Usamos cookies.");
    await banner.getByText("Usamos cookies.").waitFor();
    await p.getByText("Alterações não salvas").waitFor();
    await p.getByRole("button", { name: "Salvar aviso" }).click();
    await waitToast(s, "Aviso de cookies salvo.");
    expect((await tracking(offerId)).consent).toMatchObject({
      mode: "NOTICE",
      theme: "light",
      position: "bottom-right",
      policyPageId: legalId,
      text: "Usamos cookies.",
      noticeLabel: "Got it",
      policyLabel: "Privacy policy",
    });
    await p
      .getByRole("tabpanel", { name: /Privacidade/ })
      .getByText("Tudo salvo")
      .waitFor();

    // Voltar para "Pedir permissão" exige o texto dos botões.
    await p.getByRole("radio", { name: /^Pedir permissão/ }).check();
    await p.getByLabel("Botão de aceitar").fill("");
    await p.getByRole("button", { name: "Salvar aviso" }).click();
    await p.getByText("Escreva o texto do botão “Aceitar”.").waitFor();

    // Sem banner com pixels: aviso claro.
    await p.getByRole("radio", { name: /^Sem banner/ }).check();
    await p.getByText("Hoje esta oferta tem pixels que vão carregar sem perguntar.", { exact: false }).waitFor();
    expect(await p.getByTestId("consent-preview-banner").count()).toBe(0);
    expect(await p.getByLabel("Texto do aviso").count()).toBe(0);
    await expectNoErrors(s);
  });

  it("trocar de parte da tela não perde o que não foi salvo", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId, { initialSection: "privacidade" });
    const p = s.page;
    await p.getByLabel("Texto do aviso").fill("Rascunho do aviso");
    await p.getByRole("tab", { name: /UTMs e checkout/ }).click();
    await p.getByRole("switch", { name: "Repassar UTMs e IDs de clique" }).waitFor();
    await p.getByRole("tab", { name: /Privacidade/ }).click();
    expect(await p.getByLabel("Texto do aviso").inputValue()).toBe("Rascunho do aviso");
    await p
      .getByRole("tabpanel", { name: /Privacidade/ })
      .getByText("Alterações não salvas")
      .waitFor();
    await p.getByRole("button", { name: "Descartar" }).click();
    expect(await p.getByLabel("Texto do aviso").inputValue()).toMatch(/^Usamos cookies/);
    await expectNoErrors(s);
  });
});

describe("UTMs", () => {
  it("edita os parâmetros (chips), valida, salva e restaura o padrão", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId, { initialSection: "utms" });
    const p = s.page;
    await p.getByRole("button", { name: "Remover xcod" }).click();
    const input = p.getByLabel("Novo parâmetro");
    await input.fill("utm source");
    await input.press("Enter");
    await p.getByText("Use só letras sem acento, números, _ . e - (sem espaços).").waitFor();
    await input.fill("utm_source");
    await input.press("Enter");
    await p.getByText("“utm_source” já está na lista.").waitFor();
    await input.fill("afiliado");
    await input.press("Enter");
    await p.getByRole("button", { name: "Remover afiliado" }).waitFor();
    expect(await input.inputValue()).toBe("");
    await p.getByRole("button", { name: "Restaurar padrão" }).waitFor();

    await p.getByLabel("Lembrar por quantos dias").fill("120");
    await p.getByRole("button", { name: "Salvar repasse" }).click();
    await p.getByText("Escolha de 0 a 90 dias.").waitFor();
    await p.getByLabel("Lembrar por quantos dias").fill("7");
    await p.getByRole("switch", { name: "Nos links entre as páginas do funil" }).click();
    await p.getByRole("button", { name: "Salvar repasse" }).click();
    await waitToast(s, "Repasse de UTMs salvo.");
    const saved = (await tracking(offerId)).forwarding;
    expect(saved).toMatchObject({ enabled: true, toCheckout: true, toInternalLinks: false, persistDays: 7 });
    expect(saved.params).toEqual([...DEFAULT_FORWARD_PARAMS.filter((x) => x !== "xcod"), "afiliado"]);

    await p.getByRole("button", { name: "Restaurar padrão" }).click();
    await p.getByRole("button", { name: "Remover xcod" }).waitFor();
    await p.getByRole("button", { name: "Salvar repasse" }).click();
    await waitToast(s, "Repasse de UTMs salvo.");
    expect((await tracking(offerId)).forwarding.params).toEqual([...DEFAULT_FORWARD_PARAMS]);

    // Desligar o repasse esconde as opções.
    await p.getByRole("switch", { name: "Repassar UTMs e IDs de clique" }).click();
    expect(await p.getByLabel("Novo parâmetro").count()).toBe(0);
    await expectNoErrors(s);
  });
});

describe("código livre", () => {
  it("salva o código da oferta com a categoria; o erro do servidor aparece no campo", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId, { initialSection: "codigo" });
    const p = s.page;
    await p.getByLabel("No <head>").fill("<script>console.log('oi')");
    await p.getByRole("button", { name: "Salvar código" }).click();
    await p.getByText(/O código no <head> tem/).waitFor();
    expect(await p.getByLabel("No <head>").getAttribute("aria-invalid")).toBe("true");
    await p.getByLabel("No <head>").fill("<script>console.log('oi')</script>");
    await p.getByLabel("No fim do <body>").fill('<script src="https://chat.exemplo.com/w.js"></script>');
    await choose(p, "Quando o código carrega", "Estatística (espera o consentimento)");
    await p.getByText(/ferramentas de estatística, mapas de calor/).waitFor();
    await p.getByRole("button", { name: "Salvar código" }).click();
    await waitToast(s, "Código livre salvo.");
    expect((await tracking(offerId)).customCode).toEqual({
      head: "<script>console.log('oi')</script>",
      bodyStart: "",
      bodyEnd: '<script src="https://chat.exemplo.com/w.js"></script>',
      category: "ANALYTICS",
    });
    await expectNoErrors(s);
  });

  it("escolhe quando o código de cada página carrega (mantém o código)", async () => {
    const { offerId, thanksId } = await offerFixture();
    await savePageCode(thanksId, { head: "<meta name='x' content='1'>", bodyStart: "", bodyEnd: "" });
    const s = await open("tracking", offerId, { initialSection: "codigo" });
    const p = s.page;
    const list = p.getByRole("list", { name: "Código das páginas" });
    await list.getByText("Obrigado").waitFor();
    expect(await list.getByRole("listitem").count()).toBe(1);
    await choose(p, "Quando carrega o código da página Obrigado", "Marketing (espera o consentimento)");
    await waitToast(s, "O código da página “Obrigado” espera o “Aceitar” do aviso de cookies.");
    const page = await prisma.page.findUniqueOrThrow({ where: { id: thanksId } });
    expect(page.customCode).toMatchObject({ head: "<meta name='x' content='1'>", category: "MARKETING" });
    await expectNoErrors(s);
  });
});

describe("empresa e SEO", () => {
  async function png(color: string) {
    return sharp({ create: { width: 64, height: 64, channels: 4, background: color } })
      .png()
      .toBuffer();
  }

  it("dados da empresa: e-mail inválido no campo; salva e marca “Tudo salvo”", async () => {
    const { offerId } = await offerFixture();
    const s = await open("settings", offerId);
    const p = s.page;
    await p.getByLabel("Nome da empresa (ou seu nome)").fill("Minha Empresa Ltda.");
    await p.getByLabel("CNPJ ou CPF").fill("12.345.678/0001-90");
    await p.getByLabel("E-mail de contato").fill("contato@empresa");
    await p.getByRole("button", { name: "Salvar dados da empresa" }).click();
    await p.getByText("Digite um e-mail válido, como contato@suaempresa.com.br.").waitFor();
    expect(callsOf(s, "saveOfferSettingsAction")).toHaveLength(0);
    await p.getByLabel("E-mail de contato").fill("contato@empresa.com.br");
    await p.getByLabel("Telefone ou WhatsApp").fill("(11) 99999-9999");
    await p.getByRole("button", { name: "Salvar dados da empresa" }).click();
    await waitToast(s, "Dados da empresa salvos.");
    const settings = parseOfferSettings((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).settings);
    expect(settings.company).toEqual({
      name: "Minha Empresa Ltda.",
      document: "12.345.678/0001-90",
      email: "contato@empresa.com.br",
      phone: "(11) 99999-9999",
      address: "",
    });
    await p.getByText("Tudo salvo").first().waitFor();
    await expectNoErrors(s);
  });

  it("SEO padrão: título, descrição, favicon e imagem de compartilhamento enviados pela rota de imagens", async () => {
    const { offerId } = await offerFixture();
    const s = await open("settings", offerId);
    const p = s.page;
    await p.getByLabel("Título", { exact: true }).fill("Método X — aprenda em 7 dias");
    await p.getByLabel("Descrição", { exact: true }).fill("O passo a passo completo.");
    await p.getByRole("figure", { name: "Prévia no Google" }).getByText("Método X — aprenda em 7 dias").waitFor();
    await p.getByLabel("Ícone da aba (favicon): escolher arquivo").setInputFiles({
      name: "icone.png",
      mimeType: "image/png",
      buffer: await png("#ff0000"),
    });
    await p.getByRole("button", { name: "Trocar ícone da aba (favicon)" }).waitFor();
    await p.getByLabel("Imagem de compartilhamento: escolher arquivo").setInputFiles({
      name: "capa.png",
      mimeType: "image/png",
      buffer: await png("#00ff00"),
    });
    await p.getByRole("button", { name: "Trocar imagem de compartilhamento" }).waitFor();
    expect(s.uploads).toBe(2);
    await p.getByRole("switch", { name: "Não aparecer no Google" }).click();
    await choose(p, "Idioma das páginas", "Espanhol");
    await p.getByRole("button", { name: "Salvar SEO padrão" }).click();
    await waitToast(s, "SEO padrão salvo.");
    const settings = parseOfferSettings((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).settings);
    expect(settings.seo).toMatchObject({
      title: "Método X — aprenda em 7 dias",
      description: "O passo a passo completo.",
      noindex: true,
    });
    expect(settings.seo.faviconKey).toMatch(/^a\/[0-9a-f]{2}\/[0-9a-f]{64}\.\w+$/);
    expect(settings.seo.ogImageKey).toMatch(/^a\/[0-9a-f]{2}\/[0-9a-f]{64}\.\w+$/);
    expect(settings.seo.faviconKey).not.toBe(settings.seo.ogImageKey);
    expect(settings.language).toBe("es");

    // Remover a imagem e salvar: volta a null.
    await p.getByRole("button", { name: "Remover" }).first().click();
    await p.getByRole("button", { name: "Salvar SEO padrão" }).click();
    await waitToast(s, "SEO padrão salvo.");
    const after = parseOfferSettings((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).settings);
    expect(after.seo.faviconKey).toBeNull();
    expect(after.seo.ogImageKey).toBe(settings.seo.ogImageKey);
    await expectNoErrors(s);
  });

  it("imagem inválida: a mensagem da rota aparece no campo", async () => {
    const { offerId } = await offerFixture();
    const s = await open("settings", offerId);
    await s.page.getByLabel("Ícone da aba (favicon): escolher arquivo").setInputFiles({
      name: "nao-e-imagem.png",
      mimeType: "image/png",
      buffer: Buffer.from("isto não é uma imagem"),
    });
    await s.page.getByRole("alert").first().waitFor();
    expect(await s.page.getByRole("button", { name: "Enviar ícone da aba (favicon)" }).count()).toBe(1);
    expect(s.uploads).toBe(1);
  });

  it("SEO de cada página: carrega, mostra o padrão da oferta e salva", async () => {
    const { offerId, thanksId } = await offerFixture();
    await saveOfferSettings(offerId, { seo: { title: "Título padrão", description: "Descrição padrão" } });
    const s = await open("settings", offerId);
    const p = s.page;
    const row = p.getByRole("list", { name: "SEO das páginas" }).getByRole("listitem").filter({ hasText: "Obrigado" });
    await row.getByText("Usa o padrão").waitFor();
    await p.getByRole("button", { name: "SEO da página Obrigado" }).click();
    const d = dialog(s);
    const title = d.getByLabel("Título");
    await title.waitFor();
    expect(await title.getAttribute("placeholder")).toBe("Padrão: Título padrão");
    await title.fill("Obrigado pela compra");
    await choose(p, "Aparecer no Google", "Não aparecer no Google");
    await d
      .getByRole("figure", { name: "Prévia no Google" })
      .getByText(/não vai aparecer nas buscas/)
      .waitFor();
    await d.getByRole("button", { name: "Salvar SEO" }).click();
    await waitToast(s, "SEO da página “Obrigado” salvo.");
    await d.waitFor({ state: "hidden" });
    await row.getByText("SEO próprio").waitFor();
    await row.getByText("Fora do Google").waitFor();
    await row.getByText("Obrigado pela compra").waitFor();
    const seo = parsePageSeo((await prisma.page.findUniqueOrThrow({ where: { id: thanksId } })).seo);
    expect(seo).toMatchObject({ title: "Obrigado pela compra", description: "", noindex: true, faviconKey: null });

    // "Usar tudo da oferta" limpa o que a página definiu.
    await p.getByRole("button", { name: "SEO da página Obrigado" }).click();
    await d.getByLabel("Título").waitFor();
    expect(await d.getByLabel("Título").inputValue()).toBe("Obrigado pela compra");
    await d.getByRole("button", { name: "Usar tudo da oferta" }).click();
    await d.getByRole("button", { name: "Salvar SEO" }).click();
    await waitToast(s, "SEO da página “Obrigado” salvo.");
    expect(parsePageSeo((await prisma.page.findUniqueOrThrow({ where: { id: thanksId } })).seo)).toMatchObject({
      title: "",
      noindex: null,
    });
    await expectNoErrors(s);
  });

  it("diálogo de SEO sozinho (usado na lista de páginas): esqueleto, erro ao carregar e “Tentar de novo”", async () => {
    const { offerId, homeId } = await offerFixture();
    const s = await open("seo", offerId, { page: { id: "inexistente00000000000000", name: "Some" } });
    // Enquanto carrega: esqueleto (a primeira resposta demora de propósito).
    const slow = await open("seo", offerId, { page: { id: homeId, name: "Página principal" }, startClosed: true });
    let release: () => void = () => undefined;
    slow.override.set("getPageSeoAction", async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      return { ok: false, error: "Sem resposta." };
    });
    await slow.page.getByRole("button", { name: "Abrir SEO" }).click();
    await slow.page.getByText("Carregando SEO da página…").waitFor({ state: "attached" });
    expect(await dialog(slow).getByRole("button", { name: "Salvar SEO" }).isDisabled()).toBe(true);
    release();
    await dialog(slow).getByText("Sem resposta.").waitFor();

    const d = dialog(s);
    await d.getByText("Página não encontrada. Ela pode ter sido excluída.").waitFor();
    await d.getByRole("button", { name: "Tentar de novo" }).click();
    await waitFor(() => callsOf(s, "getPageSeoAction").length === 2, 5000, "segunda tentativa");
    await d.getByText("Página não encontrada. Ela pode ter sido excluída.").waitFor();
    await d.getByRole("button", { name: "Cancelar" }).click();
    await d.waitFor({ state: "hidden" });

    const ok = await open("seo", offerId, { page: { id: homeId, name: "Página principal" } });
    await dialog(ok).getByRole("heading", { name: "SEO da página “Página principal”" }).waitFor();
    await dialog(ok).getByLabel("Título").waitFor();
    await expectNoErrors(ok);
  });
});

describe("visão geral", () => {
  it("resumo, “Testar pixels” e a parte pedida no endereço", async () => {
    const { offerId } = await offerFixture();
    await createPixel(offerId, {
      vendor: "META",
      pixelId: "123456789012345",
      options: { capi: true },
    });
    const s = await open("tracking", offerId, { initialSection: "utms" });
    const p = s.page;
    expect(await p.getByRole("tab", { name: /UTMs e checkout/ }).getAttribute("aria-selected")).toBe("true");
    await p
      .getByRole("tab", { name: /Pixels \(1\)/ })
      .getByLabel("Precisa de atenção")
      .waitFor();
    const summary = p.getByRole("list", { name: "Resumo" });
    expect((await summary.textContent())?.replace(/\s+/g, " ")).toBe(
      "1 pixel ativoSó PageViewPede permissão (LGPD)Repassa UTMs",
    );
    const link = p.getByRole("link", { name: "Testar pixels" });
    expect(await link.getAttribute("href")).toBe(`/ofertas/${offerId}/testar-pixels`);
    await link.click();
    expect(await p.evaluate(() => (window as unknown as { __navs: string[] }).__navs)).toEqual([
      `/ofertas/${offerId}/testar-pixels`,
    ]);
    await expectNoErrors(s);
  });
});

/** Capturas de tela para revisão visual: OS_UI_SHOTS=/pasta npx vitest run tests/unit/tracking-ui-browser.test.ts */
describe("visual", () => {
  it.runIf(SHOTS)("capturas", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId);
    const p = s.page;
    const shot = (name: string) => p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
    const settle = () => p.waitForTimeout(400);
    await shot("01-empty");
    await p.getByRole("button", { name: /Meta \(Facebook/ }).click();
    const dialog = p.getByRole("dialog");
    await dialog.getByLabel("ID do pixel").fill("abc");
    await dialog.getByLabel("Apelido (opcional)").click();
    await dialog.getByRole("switch", { name: /API de Conversões/ }).click();
    await settle();
    await shot("02-meta-dialog");
    await dialog.getByLabel("ID do pixel").fill("fbq('init', '123456789012345');");
    await dialog.getByLabel(/Token de acesso/).fill("EAAGm0PX4ZCpsBAKZCZBy1234567890abcdefghijklmnop");
    await dialog.getByRole("button", { name: "Adicionar pixel" }).click();
    await dialog.waitFor({ state: "hidden" });
    await p.getByRole("button", { name: "Adicionar pixel" }).click();
    await p
      .getByRole("dialog")
      .getByRole("button", { name: /Google Ads/ })
      .click();
    await p.getByRole("dialog").getByLabel("ID do pixel").fill("AW-123456789");
    await shot("03-ads-dialog");
    await p.getByRole("dialog").getByRole("button", { name: "Adicionar pixel" }).click();
    await p.getByRole("dialog").waitFor({ state: "hidden" });
    await shot("04-pixels-list");
    await p.getByRole("button", { name: "Editar pixel 123456789012345" }).click();
    await settle();
    await shot("05-meta-edit");
    await p.keyboard.press("Escape");
    await p.getByRole("tab", { name: /Eventos/ }).click();
    await shot("06-events-empty");
    await p.getByRole("button", { name: "Usar recomendados" }).click();
    await p.getByText("Ao enviar um formulário").waitFor();
    await p.getByRole("button", { name: "Nova regra" }).click();
    await settle();
    await choose(p, "Evento", /Contato/);
    await settle();
    await shot("07-rule-dialog");
    await p.keyboard.press("Escape");
    await p.getByRole("button", { name: /Nomes dos eventos/ }).click();
    await shot("08-events-list");
    await p.getByRole("tab", { name: /Privacidade/ }).click();
    await shot("09-consent");
    await p.getByRole("tab", { name: /UTMs/ }).click();
    await shot("10-utms");
    await p.getByRole("tab", { name: /Código livre/ }).click();
    await shot("11-code");
    const st = await open("settings", offerId);
    await st.page.screenshot({ path: `${SHOTS}/12-settings.png`, fullPage: true });
    await st.page.getByRole("button", { name: "SEO da página Obrigado" }).click();
    await st.page.getByRole("dialog").getByLabel("Título").waitFor();
    await st.page.waitForTimeout(400);
    await st.page.screenshot({ path: `${SHOTS}/13-page-seo.png`, fullPage: true });
    await p.evaluate(() => {
      document.documentElement.className = "dark";
    });
    await p.getByRole("tab", { name: /Pixels/ }).click();
    await shot("16-dark-pixels");
    await p.getByRole("tab", { name: /Privacidade/ }).click();
    await p.getByRole("radio", { name: /^Só avisar/ }).check();
    await shot("17-dark-consent");
    await p.evaluate(() => {
      document.documentElement.className = "light";
    });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.getByRole("tab", { name: /Pixels/ }).click();
    await shot("14-mobile-pixels");
    await p.getByRole("tab", { name: /Privacidade/ }).click();
    await shot("15-mobile-consent");
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(s.errors).toEqual([]);
    expect(st.errors).toEqual([]);
  });
});
