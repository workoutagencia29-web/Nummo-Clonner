import { expect, type Page, test } from "@playwright/test";
import { createOffer, expectToast, offerIdFromUrl, openPageMenu, selectOption, uid } from "./helpers";

/**
 * Fase 4 — aba "Pixels e rastreamento" e "Empresa e SEO" da oferta, no app de
 * verdade: pixels (com token que nunca volta para a tela), regras de evento,
 * aviso de cookies (LGPD), repasse de UTMs, dados da empresa e SEO da página.
 */

const META_TOKEN = "EAAGm0PX4ZCpsBAKZCZBe2eTokenDeTeste1234567890abcdefghijk";

/** Abre a aba "Pixels e rastreamento" (opcionalmente numa parte: eventos, privacidade, utms, codigo). */
async function openTracking(page: Page, offerId: string, section?: string) {
  await page.goto(`/ofertas/${offerId}?aba=rastreamento${section ? `&secao=${section}` : ""}`);
  await expect(page.getByRole("heading", { level: 2, name: "Pixels e rastreamento" })).toBeVisible();
}

function trackingDialog(page: Page) {
  return page.getByRole("dialog");
}

test.describe("Pixels e rastreamento", () => {
  test("adiciona Meta (ID inválido → válido, token só como “configurado”), TikTok, GA4 e Google Ads", async ({
    page,
  }) => {
    await createOffer(page, `Oferta Pixels ${uid()}`);
    const offerId = offerIdFromUrl(page);

    // A aba aparece na tela da oferta.
    await page.getByRole("tab", { name: "Pixels e rastreamento" }).click();
    await expect(page.getByText("Nenhum pixel nesta oferta ainda")).toBeVisible();
    await expect(page.getByRole("link", { name: "Testar pixels" })).toHaveAttribute(
      "href",
      `/ofertas/${offerId}/testar-pixels`,
    );

    // Meta: escolher a plataforma já abre o formulário.
    await page.getByRole("button", { name: /^Meta \(Facebook e Instagram\)/ }).click();
    const dialog = trackingDialog(page);
    await expect(dialog.getByRole("heading", { name: "Adicionar pixel" })).toBeVisible();
    await dialog.getByLabel("ID do pixel").fill("12345abc");
    await dialog.getByLabel("Apelido (opcional)").click();
    await expect(dialog.getByText("O ID do pixel da Meta tem só números (10 a 20 dígitos).")).toBeVisible();
    await expect(dialog.getByLabel("ID do pixel")).toHaveAttribute("aria-invalid", "true");
    await dialog.getByLabel("ID do pixel").fill("fbq('init', '123456789012345');");
    await expect(dialog.getByText("ID encontrado:")).toBeVisible();
    await expect(dialog.getByText("O ID do pixel da Meta tem só números (10 a 20 dígitos).")).toBeHidden();

    await dialog.getByRole("switch", { name: "Enviar também pela API de Conversões" }).click();
    await expect(dialog.getByText("Precisa de hospedagem com PHP")).toBeVisible();
    await expect(dialog.getByText("O token nunca vai para o HTML da página")).toBeVisible();
    await expect(dialog.getByLabel("Token de acesso da API de Conversões")).toHaveAttribute("type", "password");
    await dialog.getByLabel("Token de acesso da API de Conversões").fill(META_TOKEN);
    await dialog.getByRole("button", { name: "Adicionar pixel" }).click();
    await expectToast(page, "Pixel Meta adicionado.");
    await expect(dialog).toBeHidden();
    const meta = page.getByRole("region", { name: "Meta (Facebook e Instagram)" });
    await expect(meta.getByText("123456789012345")).toBeVisible();
    await expect(meta.getByText("API de Conversões ligada")).toBeVisible();

    // O token nunca volta: nem na lista, nem no formulário, nem depois de recarregar.
    await openTracking(page, offerId);
    await expect(page.getByRole("region", { name: "Meta (Facebook e Instagram)" })).toBeVisible();
    expect(await page.content()).not.toContain(META_TOKEN);
    await page.getByRole("button", { name: "Editar pixel 123456789012345" }).click();
    await expect(dialog.getByText("Token configurado")).toBeVisible();
    await expect(dialog.getByText("••••••hijk")).toBeVisible();
    await expect(dialog.getByLabel("Token de acesso da API de Conversões")).toHaveCount(0);
    expect(await page.content()).not.toContain(META_TOKEN);
    await dialog.getByRole("button", { name: "Cancelar" }).click();

    // TikTok (o ID vira maiúsculas).
    await page.getByRole("button", { name: "Adicionar pixel" }).click();
    await dialog.getByRole("button", { name: /^TikTok/ }).click();
    await dialog.getByLabel("ID do pixel").fill("c1abcdefghij2klmnopq");
    await dialog.getByRole("button", { name: "Adicionar pixel" }).click();
    await expectToast(page, "Pixel TikTok adicionado.");
    await expect(page.getByRole("region", { name: "TikTok" }).getByText("C1ABCDEFGHIJ2KLMNOPQ")).toBeVisible();

    // GA4.
    await page.getByRole("button", { name: "Adicionar pixel" }).click();
    await dialog.getByRole("button", { name: /^Google Analytics 4/ }).click();
    await dialog.getByLabel("ID do pixel").fill("G-ABC123DEF4");
    await dialog.getByRole("button", { name: "Adicionar pixel" }).click();
    await expectToast(page, "Pixel GA4 adicionado.");

    // Google Ads com rótulo de conversão por evento (aceita o send_to inteiro).
    await page.getByRole("button", { name: "Adicionar pixel" }).click();
    await dialog.getByRole("button", { name: /^Google Ads/ }).click();
    await dialog.getByLabel("ID do pixel").fill("AW-123456789");
    await dialog.getByLabel(/^Cadastro \/ lead/).fill("AbC-D_efG-h12");
    await dialog.getByLabel(/^Compra/).fill("AW-123456789/Zyx_123");
    await dialog.getByRole("button", { name: "Adicionar pixel" }).click();
    await expectToast(page, "Pixel Google Ads adicionado.");
    await expect(page.getByRole("region", { name: "Google Ads" }).getByText("2 conversões")).toBeVisible();
    await expect(page.getByRole("list", { name: "Resumo" })).toContainText("4 pixels ativos");
  });

  test("eventos: recomendados e regra de clique num link da oferta", async ({ page }) => {
    await createOffer(page, `Oferta Eventos ${uid()}`);
    const offerId = offerIdFromUrl(page);

    // Link da oferta cadastrado na aba "Links e checkouts".
    await page.getByRole("tab", { name: "Links e checkouts" }).click();
    await page.getByLabel("Nome do novo link").fill("Checkout principal");
    await page.getByLabel("URL do novo link").fill("https://pay.hotmart.com/X12345");
    await page.getByRole("button", { name: "Adicionar", exact: true }).click();
    await expectToast(page, "Link criado.");

    await openTracking(page, offerId, "eventos");
    await expect(page.getByText("O PageView é automático", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Usar recomendados" }).click();
    await expectToast(page, "3 regras recomendadas criadas.");
    const rules = page.getByRole("list", { name: "Regras de evento" });
    await expect(rules.getByRole("listitem")).toHaveCount(3);
    await expect(rules).toContainText("Depois de 15 segundos na página");
    await expect(rules).toContainText("Ao clicar em um botão de checkout");
    await expect(rules).toContainText("Ao enviar um formulário");
    await expect(page.getByRole("button", { name: "Usar recomendados" })).toHaveCount(0);

    await page.getByRole("button", { name: "Nova regra" }).click();
    const dialog = trackingDialog(page);
    await selectOption(dialog, page, "Evento", "Adicionou ao carrinho (AddToCart)");
    await selectOption(dialog, page, "Quando dispara", "Ao clicar em um elemento / link da oferta");
    await dialog.getByRole("combobox", { name: "O que a pessoa clica" }).click();
    await page.getByRole("option", { name: /Clique no link da oferta: Checkout principal/ }).click();
    await expect(dialog.getByTestId("rule-summary")).toHaveText(
      "AddToCart dispara ao clicar no link “Checkout principal”, em todas as páginas.",
    );
    await dialog.getByRole("button", { name: "Criar regra" }).click();
    await expectToast(page, "Regra criada.");
    await expect(rules.getByRole("listitem")).toHaveCount(4);
    await expect(rules).toContainText("Ao clicar no link “Checkout principal”");
    await expect(page.getByRole("list", { name: "Resumo" })).toContainText("PageView + 4 regras");
  });

  test("LGPD: troca o modo do aviso com prévia ao vivo e salva", async ({ page }) => {
    await createOffer(page, `Oferta LGPD ${uid()}`);
    const offerId = offerIdFromUrl(page);
    await openTracking(page, offerId, "privacidade");

    const preview = page.getByTestId("consent-preview-banner");
    await expect(page.getByRole("radio", { name: /^Pedir permissão/ })).toBeChecked();
    await expect(preview.getByText("Recusar", { exact: true })).toBeVisible();

    await expect(page.getByLabel("Texto do aviso")).toHaveValue(/Você pode aceitar ou recusar\.$/);
    await page.getByRole("radio", { name: /^Só avisar/ }).check();
    // "Só avisar" não tem "Recusar": o texto padrão muda junto (e só informa: continuar
    // navegando não é consentimento, pelo guia de cookies da ANPD).
    await expect(page.getByLabel("Texto do aviso")).toHaveValue(/medir nossos anúncios\.$/);
    await expect(page.getByLabel("Texto do aviso")).not.toHaveValue(/concorda/);
    await expect(preview.getByText("Entendi", { exact: true })).toBeVisible();
    await expect(preview.getByText("Recusar", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Recomendamos “Pedir permissão”")).toBeVisible();
    await page.getByRole("radio", { name: "Claro" }).click();
    await expect(preview).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Salvar aviso" }).click();
    await expectToast(page, "Aviso de cookies salvo.");
    await expect(page.getByRole("list", { name: "Resumo" })).toContainText("Só avisa sobre cookies");

    await page.reload();
    await expect(page.getByRole("radio", { name: /^Só avisar/ })).toBeChecked();
    await expect(page.getByTestId("consent-preview-banner")).toHaveAttribute("data-theme", "light");
  });

  test("UTMs: edita os parâmetros repassados", async ({ page }) => {
    await createOffer(page, `Oferta UTMs ${uid()}`);
    const offerId = offerIdFromUrl(page);
    await openTracking(page, offerId, "utms");

    await page.getByRole("button", { name: "Remover xcod" }).click();
    await page.getByLabel("Novo parâmetro").fill("utm source");
    await page.getByLabel("Novo parâmetro").press("Enter");
    await expect(page.getByText("Use só letras sem acento, números, _ . e - (sem espaços).")).toBeVisible();
    await page.getByLabel("Novo parâmetro").fill("afiliado");
    await page.getByLabel("Novo parâmetro").press("Enter");
    await expect(page.getByRole("button", { name: "Remover afiliado" })).toBeVisible();
    await page.getByLabel("Lembrar por quantos dias").fill("7");
    await page.getByRole("button", { name: "Salvar repasse" }).click();
    await expectToast(page, "Repasse de UTMs salvo.");

    await page.reload();
    await expect(page.getByRole("button", { name: "Remover afiliado" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remover xcod" })).toHaveCount(0);
    await expect(page.getByLabel("Lembrar por quantos dias")).toHaveValue("7");
    await page.getByRole("button", { name: "Restaurar padrão" }).click();
    await expect(page.getByRole("button", { name: "Remover xcod" })).toBeVisible();
  });
});

test.describe("Empresa e SEO", () => {
  test("salva os dados da empresa e o SEO de uma página", async ({ page }) => {
    await createOffer(page, `Oferta Empresa ${uid()}`);
    await page.getByRole("tab", { name: "Empresa e SEO" }).click();

    await page.getByLabel("Nome da empresa (ou seu nome)").fill("Minha Empresa Ltda.");
    await page.getByLabel("CNPJ ou CPF").fill("12.345.678/0001-90");
    await page.getByLabel("E-mail de contato").fill("contato@empresa");
    await page.getByRole("button", { name: "Salvar dados da empresa" }).click();
    await expect(page.getByText("Digite um e-mail válido, como contato@suaempresa.com.br.")).toBeVisible();
    await page.getByLabel("E-mail de contato").fill("contato@empresa.com.br");
    await page.getByRole("button", { name: "Salvar dados da empresa" }).click();
    await expectToast(page, "Dados da empresa salvos.");

    // SEO da página inicial, pelo diálogo.
    await page.getByRole("button", { name: "SEO da página Página principal" }).click();
    const dialog = page.getByRole("dialog", { name: "SEO da página “Página principal”" });
    await expect(dialog.getByLabel("Título")).toBeVisible();
    await dialog.getByLabel("Título").fill("Método X — oferta especial");
    await dialog.getByLabel("Descrição").fill("Aprenda o método X em 7 dias.");
    await selectOption(dialog, page, "Aparecer no Google", "Não aparecer no Google");
    await dialog.getByRole("button", { name: "Salvar SEO" }).click();
    await expectToast(page, "SEO da página “Página principal” salvo.");
    await expect(dialog).toBeHidden();
    const row = page
      .getByRole("list", { name: "SEO das páginas" })
      .getByRole("listitem")
      .filter({ hasText: "Página principal" });
    await expect(row.getByText("SEO próprio")).toBeVisible();
    await expect(row.getByText("Fora do Google")).toBeVisible();

    // Continua salvo depois de recarregar.
    await page.goto(`${new URL(page.url()).pathname}?aba=configuracoes`);
    await expect(page.getByLabel("Nome da empresa (ou seu nome)")).toHaveValue("Minha Empresa Ltda.");
    await expect(page.getByLabel("E-mail de contato")).toHaveValue("contato@empresa.com.br");
    await page.getByRole("button", { name: "SEO da página Página principal" }).click();
    await expect(page.getByRole("dialog").getByLabel("Título")).toHaveValue("Método X — oferta especial");
    await page.keyboard.press("Escape");

    // Também pela lista de páginas do funil (menu ⋯ da página).
    await page.getByRole("tab", { name: "Páginas do funil" }).click();
    const menu = await openPageMenu(page, "Página principal");
    await menu.getByRole("menuitem", { name: "SEO da página" }).click();
    const fromList = page.getByRole("dialog", { name: "SEO da página “Página principal”" });
    await expect(fromList.getByLabel("Título")).toHaveValue("Método X — oferta especial");
    await expect(fromList.getByLabel("Descrição")).toHaveValue("Aprenda o método X em 7 dias.");
  });
});
