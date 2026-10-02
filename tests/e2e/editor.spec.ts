import { expect, type Page, test } from "@playwright/test";
import sharp from "sharp";
import {
  createOffer,
  createOfferFromTemplate,
  editCanvasText,
  editorBlock,
  editorCanvas,
  expectAutosave,
  expectToast,
  offerIdFromUrl,
  openEditor,
  pageRow,
  saveStatus,
  uid,
  waitForDocumentSave,
  waitForEditor,
} from "./helpers";

/**
 * Editor visual (Fase 3), de ponta a ponta: cada teste cria a própria oferta a
 * partir de um modelo, abre o editor pela tela da oferta e usa a página como
 * o usuário usaria (cliques, dois cliques no texto, painéis e diálogos).
 *
 * Textos do modelo "Upsell" usados aqui: src/editor/templates/upsell.ts.
 */
const UPSELL_HEADLINE = "Parabéns pela sua compra! Antes de acessar, veja esta oferta exclusiva";
const UPSELL_BUY = "SIM, QUERO ADICIONAR AO MEU PEDIDO";
/** Endereço da prévia: http://<token>.localhost:<porta do painel + 1>/ */
const PREVIEW_ORIGIN = /^http:\/\/[a-z0-9_-]+\.localhost:3201\//i;

/**
 * Seleciona o botão de compra do modelo Upsell e, em Configurações → "Link da
 * oferta", usa "＋ Criar link da oferta…" para criar o link e ligar o botão.
 */
async function bindBuyButtonToNewLink(page: Page, checkout: string) {
  const canvas = editorCanvas(page);
  const settings = page.getByRole("tabpanel", { name: "Configurações" });
  const linkSelect = settings
    .locator(".gjs-trt-trait", { has: page.getByText("Link da oferta", { exact: true }) })
    .getByRole("combobox");
  // O botão pulsa (animação infinita): o Playwright nunca o acha "parado" para clicar.
  // Com a máquina ocupada, o primeiro clique no canvas recém-aberto às vezes não
  // seleciona: tenta de novo (com intervalo, para não virar clique duplo).
  await expect(async () => {
    await canvas.getByText(UPSELL_BUY).click({ force: true });
    await page.getByRole("tab", { name: "Configurações" }).click();
    await expect(linkSelect).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000, intervals: [1000] });
  await expect(linkSelect.locator("option:checked")).toHaveText("— nenhum (usar o endereço) —");
  await linkSelect.selectOption({ label: "＋ Criar link da oferta…" });

  const dialog = page.getByRole("dialog", { name: "Novo link da oferta" });
  await expect(dialog.getByLabel("Nome", { exact: true })).toHaveValue("Checkout principal");
  // Escolher a opção não grava nada no elemento: o valor volta ao anterior.
  await expect(canvas.getByText(UPSELL_BUY)).toHaveAttribute("data-os-link", "");
  await expectAutosave(page, async () => {
    await dialog.getByLabel("Endereço", { exact: true }).fill(checkout);
    await dialog.getByRole("button", { name: "Criar e ligar" }).click();
    await expectToast(page, "Link criado e ligado ao elemento.");
  });
  await expect(dialog).toBeHidden();
  await expect(linkSelect.locator("option:checked")).toHaveText("Checkout principal");
}

test.describe("Editor", () => {
  test.describe.configure({ timeout: 90_000 });

  test("oferta com modelo abre no editor: esqueleto, canvas e primeiro salvamento", async ({ page }) => {
    const name = `Editor Abrir ${uid()}`;
    await createOfferFromTemplate(page, name, "Upsell");
    await expect(pageRow(page, "Página principal")).toContainText("Upsell");
    await openEditor(page, "Página principal");
    const canvas = editorCanvas(page);
    await expect(canvas.locator("h1")).toHaveText(UPSELL_HEADLINE);
    await expect(page.getByRole("banner")).toContainText(name);
    // Primeira abertura: o modelo é importado e salvo (vira a "Versão original").
    await expect(saveStatus(page)).toHaveText(/^Salvo às \d\d:\d\d$/);

    // Recarregando com o código do editor lento: primeiro o esqueleto, depois o canvas.
    await page.route(/\/_next\/static\/chunks\/.+\.js/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });
    await page.reload();
    await expect(page.getByText("Carregando o editor…")).toBeAttached();
    await expect(page.locator('[aria-busy="true"]')).toBeVisible();
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await expect(canvas.locator("h1")).toHaveText(UPSELL_HEADLINE, { timeout: 30_000 });
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(saveStatus(page)).toHaveText("Salvo");
  });

  test("texto com dois cliques, bloco pelo clique, salvamento automático, desfazer e refazer", async ({ page }) => {
    await createOfferFromTemplate(page, `Editor Texto ${uid()}`, "Upsell");
    await openEditor(page, "Página principal");
    const canvas = editorCanvas(page);
    const headline = canvas.locator("h1");
    const lead = canvas.locator(".os-lead").first();
    const newHeadline = `Headline nova ${uid()}`;

    // Dois cliques no título: edita direto na página e salva sozinho.
    await expectAutosave(page, () => editCanvasText(page, headline, newHeadline, lead));
    await expect(headline).toHaveText(newHeadline);

    // Clique num bloco: entra logo abaixo do elemento selecionado (o parágrafo).
    await expectAutosave(page, () => editorBlock(page, "Texto").click());
    const added = canvas.locator(".os-lead + p");
    await expect(added).toHaveText(/^Escreva aqui o seu texto/);

    // Desfazer tira o bloco; refazer volta.
    const undo = page.getByRole("button", { name: "Desfazer (⌘Z)" });
    const redo = page.getByRole("button", { name: "Refazer (⌘⇧Z)" });
    await expect(redo).toBeDisabled();
    await expectAutosave(page, () => undo.click());
    await expect(canvas.getByText(/^Escreva aqui o seu texto/)).toHaveCount(0);
    await expect(redo).toBeEnabled();
    await expectAutosave(page, () => redo.click());
    await expect(canvas.getByText(/^Escreva aqui o seu texto/)).toHaveCount(1);

    // Tudo continua lá depois de recarregar.
    await page.reload();
    await waitForEditor(page);
    await expect(headline).toHaveText(newHeadline);
    await expect(canvas.locator(".os-lead + p")).toHaveText(/^Escreva aqui o seu texto/);
    await expect(saveStatus(page)).toHaveText("Salvo");
  });

  test("celular e Estilo: a cor escolhida no celular vale só no celular", async ({ page }) => {
    await createOfferFromTemplate(page, `Editor Estilo ${uid()}`, "Upsell");
    await openEditor(page, "Página principal");
    const canvas = editorCanvas(page);
    const frame = page.locator("iframe.gjs-frame");
    const headline = canvas.locator("h1");
    const red = "rgb(220, 38, 38)";

    const mobile = page.getByRole("radio", { name: "Celular", exact: true });
    const desktop = page.getByRole("radio", { name: "Computador", exact: true });
    await expect(desktop).toHaveAttribute("aria-checked", "true");
    await mobile.click();
    await expect(mobile).toHaveAttribute("aria-checked", "true");
    await expect.poll(async () => Math.round((await frame.boundingBox())?.width ?? 0)).toBe(375);

    await headline.click();
    await page.getByRole("tab", { name: "Estilo" }).click();
    const styles = page.getByRole("tabpanel", { name: "Estilo" });
    const color = styles
      .locator(".gjs-sm-property", { has: page.getByText("Cor do texto", { exact: true }) })
      .getByRole("textbox");
    await expectAutosave(page, async () => {
      await color.fill("#dc2626");
      await color.press("Enter");
    });
    await expect(headline).toHaveCSS("color", red);

    // No desktop a cor original continua.
    await desktop.click();
    await expect.poll(async () => Math.round((await frame.boundingBox())?.width ?? 0)).toBeGreaterThan(375);
    await expect(headline).not.toHaveCSS("color", red);

    // Depois de recarregar, a cor do celular continua salva.
    await page.reload();
    await waitForEditor(page);
    await expect(headline).not.toHaveCSS("color", red);
    await mobile.click();
    await expect(headline).toHaveCSS("color", red);
  });

  test("botão ligado a um link novo da oferta: modo prévia, ver página e Links e checkouts", async ({
    page,
    context,
  }) => {
    await createOfferFromTemplate(page, `Editor Link ${uid()}`, "Upsell");
    await openEditor(page, "Página principal");
    const canvas = editorCanvas(page);
    const checkout = `https://pay.hotmart.com/E2E${Date.now()}X?off=e2e`;
    await bindBuyButtonToNewLink(page, checkout);

    // Modo prévia (com os scripts, em outra origem): o botão leva ao checkout.
    await page.getByRole("button", { name: "Modo prévia" }).click();
    await expect(page.getByRole("button", { name: "Voltar a editar" })).toBeVisible();
    const previewFrame = page.locator('iframe[title="Prévia da página"]');
    await expect(previewFrame).toHaveAttribute("src", PREVIEW_ORIGIN);
    const preview = page.frameLocator('iframe[title="Prévia da página"]');
    await expect(preview.getByRole("heading", { level: 1 })).toHaveText(UPSELL_HEADLINE);
    await expect(preview.getByRole("link", { name: UPSELL_BUY })).toHaveAttribute("href", checkout);
    await expect(page.getByRole("button", { name: "Desfazer (⌘Z)" })).toBeDisabled();

    // "Ver página" abre a mesma prévia numa aba nova.
    const visitorPromise = context.waitForEvent("page");
    await page.getByRole("button", { name: "Ver página" }).click();
    const visitor = await visitorPromise;
    await expect(visitor).toHaveURL(PREVIEW_ORIGIN);
    await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(UPSELL_HEADLINE);
    await expect(visitor.getByRole("link", { name: UPSELL_BUY })).toHaveAttribute("href", checkout);
    await visitor.close();

    await page.getByRole("button", { name: "Voltar a editar" }).click();
    await expect(previewFrame).toHaveCount(0);
    await expect(canvas.locator("h1")).toBeVisible();

    // Reabrindo o editor, "Links e checkouts" lista o link com o botão ligado.
    await page.reload();
    await waitForEditor(page);
    await page.getByRole("button", { name: "Links e checkouts" }).click();
    const links = page.getByRole("dialog", { name: "Links e checkouts" });
    const group = links.getByRole("listitem").filter({ hasText: "Checkout principal" });
    await expect(group).toContainText("Link da oferta");
    await expect(group).toContainText(checkout);
    await expect(group).toContainText("1 elemento");
    await expect(group).toContainText(`“${UPSELL_BUY}”`);
    await expect(group.getByText("Hotmart", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(links).toBeHidden();

    // O link também aparece na aba "Links e checkouts" da oferta.
    await page.getByRole("link", { name: "Voltar para a oferta" }).click();
    await expect(page).toHaveURL(/\/ofertas\/[^/?]+$/);
    await page.getByRole("tab", { name: "Links e checkouts" }).click();
    await expect(page.getByRole("main").getByText("Checkout principal")).toBeVisible();
  });

  test("Links e checkouts mostra na hora o link criado por '＋ Criar link da oferta…'", async ({ page }) => {
    // A lista de links do diálogo é lida de novo a cada abertura (o link novo
    // entra em payload.links pelo diálogo de link novo).
    await createOfferFromTemplate(page, `Editor Link Na Hora ${uid()}`, "Upsell");
    await openEditor(page, "Página principal");
    const checkout = `https://pay.hotmart.com/E2E${Date.now()}Y?off=e2e`;
    await bindBuyButtonToNewLink(page, checkout);

    await page.getByRole("button", { name: "Links e checkouts" }).click();
    const links = page.getByRole("dialog", { name: "Links e checkouts" });
    const group = links.getByRole("listitem").filter({ hasText: `“${UPSELL_BUY}”` });
    await expect(group).toHaveCount(1);
    await expect(group.getByText("Esse link da oferta foi excluído", { exact: false })).toHaveCount(0);
    await expect(group).toContainText("Checkout principal");
    await expect(group).toContainText("Link da oferta");
    await expect(group).toContainText(checkout);
  });

  test("Links e checkouts mostra o botão de compra do modelo ainda sem link e liga ele", async ({ page }) => {
    await createOfferFromTemplate(page, `Editor Botão Sem Link ${uid()}`, "Upsell");
    await openEditor(page, "Página principal");
    const canvas = editorCanvas(page);
    await page.getByRole("button", { name: "Links e checkouts" }).click();
    const links = page.getByRole("dialog", { name: "Links e checkouts" });
    const group = links.getByRole("listitem").filter({ hasText: "Botões de compra sem link" });
    await expect(group).toContainText("1 elemento");
    await expect(group).toContainText(`“${UPSELL_BUY}”`);
    await expect(links.getByText(/ainda não tem links nem botões/)).toHaveCount(0);

    const checkout = `https://pay.hotmart.com/E2E${Date.now()}Z?off=e2e`;
    await group.getByRole("button", { name: "Criar link da oferta" }).click();
    await expect(group.getByRole("textbox", { name: "Nome do link" })).toHaveValue("Checkout principal");
    await group.getByRole("textbox", { name: "Endereço do link" }).fill(checkout);
    await expectAutosave(page, () => group.getByRole("button", { name: "Criar e ligar" }).click());
    await expect(canvas.getByText(UPSELL_BUY)).toHaveAttribute("data-os-link", /^checkout-principal/);
    const bound = links.getByRole("listitem").filter({ hasText: "Checkout principal" });
    await expect(bound).toContainText("Link da oferta");
    await expect(bound).toContainText(checkout);
    await expect(links.getByText("Botões de compra sem link")).toHaveCount(0);
  });

  test("botão voltar do navegador logo depois de editar não perde a alteração", async ({ page }) => {
    await createOfferFromTemplate(page, `Editor Voltar Navegador ${uid()}`, "Upsell");
    await openEditor(page, "Página principal");
    const canvas = editorCanvas(page);
    const text = `Headline antes do voltar ${uid()}`;
    await editCanvasText(page, canvas.locator("h1"), text, canvas.locator(".os-lead").first());
    await expect(saveStatus(page)).toHaveText("Alterações não salvas");
    const saved = waitForDocumentSave(page);
    await page.goBack();
    await expect(page).toHaveURL(/\/ofertas\/[^/?]+$/);
    expect((await saved).ok()).toBe(true);

    await openEditor(page, "Página principal");
    await expect(canvas.locator("h1")).toHaveText(text);
  });

  test("histórico: salva um ponto com nome, muda a página e restaura", async ({ page }) => {
    await createOfferFromTemplate(page, `Editor Histórico ${uid()}`, "Upsell");
    await openEditor(page, "Página principal");
    const canvas = editorCanvas(page);
    const headline = canvas.locator("h1");
    const versionName = `Antes da headline nova ${uid()}`;

    await page.getByRole("button", { name: "Histórico" }).click();
    const dialog = page.getByRole("dialog", { name: "Histórico" });
    const rows = dialog.getByRole("listitem");
    await expect(rows.filter({ hasText: "Página original" })).toHaveCount(1);
    await dialog.getByLabel("Nome do ponto de restauração").fill(versionName);
    await dialog.getByRole("button", { name: "Salvar ponto de restauração" }).click();
    await expectToast(page, "Ponto de restauração salvo.");
    const named = rows.filter({ hasText: versionName });
    await expect(named).toContainText("Salvo por você");
    await expect(rows.first()).toContainText(versionName);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await expectAutosave(page, () =>
      editCanvasText(page, headline, "Headline que vai ser desfeita", canvas.locator(".os-lead").first()),
    );
    await expect(headline).toHaveText("Headline que vai ser desfeita");

    await page.getByRole("button", { name: "Histórico" }).click();
    await named.getByRole("button", { name: "Restaurar" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Voltar para este ponto?" });
    const reloaded = page.waitForEvent("load");
    await confirm.getByRole("button", { name: "Restaurar" }).click();
    await reloaded;
    await waitForEditor(page);
    await expect(headline).toHaveText(UPSELL_HEADLINE);

    // A situação de antes de restaurar ficou guardada.
    await page.getByRole("button", { name: "Histórico" }).click();
    await expect(rows.filter({ hasText: "Antes de restaurar" })).toHaveCount(1);
  });

  test("localizar e substituir: troca todas as ocorrências da página", async ({ page }) => {
    await createOfferFromTemplate(page, `Editor Substituir ${uid()}`, "Upsell");
    await openEditor(page, "Página principal");
    const canvas = editorCanvas(page);

    await page.getByRole("button", { name: "Localizar e substituir" }).click();
    const panel = page.getByRole("dialog", { name: "Localizar e substituir" });
    await panel.getByRole("textbox", { name: "Localizar" }).fill("produto complementar");
    const results = panel.getByRole("list", { name: "Resultados nesta página" }).getByRole("listitem");
    await expect(results.first()).toBeVisible();
    const found = await results.count();
    expect(found).toBeGreaterThanOrEqual(3);
    await expect(panel.getByText(`1 de ${found}`)).toBeVisible();

    await panel.getByRole("textbox", { name: "Substituir por" }).fill("kit turbo e2e");
    await expectAutosave(page, () => panel.getByRole("button", { name: `Substituir todas (${found})` }).click());
    await expectToast(page, `${found} trocas feitas nesta página. Para voltar, use Desfazer (⌘Z).`);
    await expect(panel.getByText("Nada encontrado nesta página.")).toBeVisible();
    await expect(canvas.getByText(/produto complementar/)).toHaveCount(0);
    await expect(canvas.getByText(/kit turbo e2e/).first()).toBeVisible();

    // Um Desfazer volta todas as trocas; Refazer troca de novo.
    const undo = page.getByRole("button", { name: "Desfazer (⌘Z)" });
    const redo = page.getByRole("button", { name: "Refazer (⌘⇧Z)" });
    await expectAutosave(page, () => undo.click());
    await expect(canvas.locator(".os-lead").first()).toContainText("[produto complementar]");
    await expect(canvas.getByText(/kit turbo e2e/)).toHaveCount(0);
    await expect(panel.getByText(`1 de ${found}`)).toBeVisible();
    await expectAutosave(page, () => redo.click());
    await expect(canvas.getByText(/produto complementar/)).toHaveCount(0);

    await page.reload();
    await waitForEditor(page);
    await expect(canvas.getByText(/produto complementar/)).toHaveCount(0);
    await expect(canvas.locator(".os-lead").first()).toContainText("[kit turbo e2e]");
  });

  test("código: HTML do elemento (com desfazer) e códigos da página que aparecem na prévia", async ({ page }) => {
    await createOfferFromTemplate(page, `Editor Código ${uid()}`, "Upsell");
    await openEditor(page, "Página principal");
    const canvas = editorCanvas(page);
    const headline = canvas.locator("h1");

    await headline.click();
    await page.getByRole("button", { name: "Código (HTML/CSS)" }).click();
    const dialog = page.getByRole("dialog", { name: "Código" });
    await expect(dialog.getByRole("tab", { name: "HTML do elemento" })).toHaveAttribute("aria-selected", "true");
    const html = dialog.getByRole("textbox", { name: "HTML do elemento" });
    await expect(html).toContainText(UPSELL_HEADLINE);
    await html.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText('<h1 class="os-h1">Título escrito no código</h1>');
    await expectAutosave(page, async () => {
      await dialog.getByRole("button", { name: "Aplicar" }).click();
      await expectToast(page, "HTML aplicado. Para voltar atrás, use Desfazer (⌘Z).");
    });
    await expect(dialog).toBeHidden();
    await expect(headline).toHaveText("Título escrito no código");

    // Desfazer volta o elemento como era; Refazer aplica de novo.
    await expectAutosave(page, () => page.getByRole("button", { name: "Desfazer (⌘Z)" }).click());
    await expect(headline).toHaveText(UPSELL_HEADLINE);
    await expectAutosave(page, () => page.getByRole("button", { name: "Refazer (⌘⇧Z)" }).click());
    await expect(headline).toHaveText("Título escrito no código");

    // Códigos da página (head): guardados na página, fora do editor.
    await page.getByRole("button", { name: "Código (HTML/CSS)" }).click();
    await dialog.getByRole("tab", { name: "Códigos da página" }).click();
    const head = dialog.getByRole("textbox", { name: "Código No <head>" });
    await head.click();
    await page.keyboard.insertText('<meta name="os-e2e-verificacao" content="ok-123">');
    await dialog.getByRole("button", { name: "Salvar códigos" }).click();
    await expectToast(page, "Códigos salvos. Eles entram na prévia e na página publicada.");
    await expect(dialog.getByRole("button", { name: "Salvar códigos" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Fechar", exact: true }).first().click();
    await expect(dialog).toBeHidden();

    // Os códigos nunca rodam no editor, só na prévia (e na página publicada).
    await expect(canvas.locator('meta[name="os-e2e-verificacao"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Modo prévia" }).click();
    const preview = page.frameLocator('iframe[title="Prévia da página"]');
    await expect(preview.getByRole("heading", { level: 1 })).toHaveText("Título escrito no código");
    await expect(preview.locator('head meta[name="os-e2e-verificacao"]')).toHaveAttribute("content", "ok-123");
  });

  test("código: CSS da página aplicado vale no canvas, na prévia e depois de recarregar", async ({ page }) => {
    // Trocar a lista de regras não conta como alteração no GrapesJS 0.23:
    // applyPageCss avisa o editor (changesUp) para salvar e ligar o Desfazer.
    await createOfferFromTemplate(page, `Editor CSS ${uid()}`, "Upsell");
    await openEditor(page, "Página principal");
    const canvas = editorCanvas(page);
    const headline = canvas.locator("h1");

    await page.getByRole("button", { name: "Código (HTML/CSS)" }).click();
    const dialog = page.getByRole("dialog", { name: "Código" });
    // Sem nada selecionado, o diálogo abre direto no CSS da página.
    await expect(dialog.getByRole("tab", { name: "CSS da página" })).toHaveAttribute("aria-selected", "true");
    const css = dialog.getByRole("textbox", { name: "CSS da página" });
    await css.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText("\n.os-h1 { letter-spacing: 3px; }\n");
    await dialog.getByRole("button", { name: "Aplicar" }).click();
    await expectToast(page, "CSS aplicado. Para voltar atrás, use Desfazer (⌘Z).");
    await expect(dialog).toBeHidden();
    await expect(headline).toHaveCSS("letter-spacing", "3px");
    // O aviso diz para usar Desfazer: o botão precisa estar ligado.
    await expect(page.getByRole("button", { name: "Desfazer (⌘Z)" })).toBeEnabled();

    await page.getByRole("button", { name: "Modo prévia" }).click();
    const preview = page.frameLocator('iframe[title="Prévia da página"]');
    await expect(preview.getByRole("heading", { level: 1 })).toHaveText(UPSELL_HEADLINE);
    await expect(preview.getByRole("heading", { level: 1 })).toHaveCSS("letter-spacing", "3px");

    await page.reload();
    await waitForEditor(page);
    await expect(headline).toHaveCSS("letter-spacing", "3px");
  });

  test("imagem: envio pelo gerenciador de imagens vira WebP na página", async ({ page }) => {
    await createOfferFromTemplate(page, `Editor Imagem ${uid()}`, "Upsell");
    await openEditor(page, "Página principal");
    const canvas = editorCanvas(page);
    const image = canvas.getByRole("img", { name: "Imagem da oferta" });
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#dc2626" } })
      .png()
      .toBuffer();

    await image.dblclick();
    const modal = page.locator(".gjs-mdl-dialog").filter({ hasText: "Escolher imagem" });
    await expect(modal).toBeVisible();
    await expect(modal.getByText("Nenhuma imagem nesta oferta ainda.")).toBeVisible();
    await expectAutosave(page, async () => {
      await modal
        .locator('input[type="file"]')
        .setInputFiles({ name: "produto-e2e.png", mimeType: "image/png", buffer: png });
      await expectToast(page, "Imagem enviada.");
    });
    await expect(image).toHaveAttribute("src", /^\/os-assets\/[a-f0-9]{64}\.webp$/);
    await expect(modal.getByText("64 × 48", { exact: false })).toBeVisible();

    const src = (await image.getAttribute("src")) ?? "";
    const res = await page.request.get(src);
    expect(res.ok()).toBe(true);
    expect(res.headers()["content-type"]).toContain("image/webp");

    await modal.locator("[data-close-modal]").click();
    await expect(modal).toBeHidden();
    await page.reload();
    await waitForEditor(page);
    await expect(image).toHaveAttribute("src", src);
  });

  test("nova página com modelo pela tela da oferta, troca de página no editor e volta para a oferta", async ({
    page,
  }) => {
    const name = `Editor Nova Página ${uid()}`;
    const offerId = await createOffer(page, name);
    await page.getByRole("button", { name: "Adicionar página" }).click();
    const dialog = page.getByRole("dialog", { name: "Nova página" });
    await dialog.getByRole("radio", { name: "Obrigado" }).click();
    await expect(dialog.getByLabel("Nome", { exact: true })).toHaveValue("Obrigado");
    await expect(dialog.getByLabel("Endereço da página")).toHaveValue("obrigado");
    await expect(dialog.getByRole("combobox", { name: "Tipo" })).toHaveText("Obrigado");
    await dialog.getByRole("button", { name: "Criar página" }).click();
    await expectToast(page, 'Página criada com o modelo "Obrigado".');
    await expect(pageRow(page, "Obrigado")).toContainText("/obrigado/");

    await openEditor(page, "Obrigado");
    const canvas = editorCanvas(page);
    await expect(canvas.locator("h1")).toHaveText("Parabéns! Sua compra foi confirmada 🎉");

    // Aba "Páginas": a atual fica marcada; clicar em outra abre o editor dela.
    await page.getByRole("tab", { name: "Páginas" }).click();
    const pages = page.getByRole("tabpanel", { name: "Páginas" });
    await expect(pages.getByRole("button", { name: "Obrigado" })).toBeDisabled();
    const firstUrl = page.url();
    await pages.getByRole("button", { name: /Página principal/ }).click();
    await expect(page).not.toHaveURL(firstUrl);
    await waitForEditor(page);
    await expect(canvas.locator("h1")).toHaveCount(0);
    await expect(page.getByRole("banner")).toContainText("Página principal");

    await page.getByRole("link", { name: "Voltar para a oferta" }).click();
    await expect(page).toHaveURL(new RegExp(`/ofertas/${offerId}$`));
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    expect(offerIdFromUrl(page)).toBe(offerId);
  });

  test("endereço de editor que não existe: 404 com a tela de 'não encontrada' do app", async ({ page }) => {
    const res = await page.goto("/editor/naoexiste123");
    expect(res?.status()).toBe(404);
    await expect(page).toHaveTitle("Página não encontrada · Offer Studio");
    await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
    await expect(page.getByText("Esta página foi excluída, ou a oferta dela está na lixeira.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir a lixeira" })).toHaveAttribute("href", "/lixeira");
  });

  test("editor inexistente numa aba nova: 'Ir para as ofertas' leva ao painel", async ({ page, context }) => {
    // Numa aba aberta direto no endereço do editor (⌘-clique em "Editar",
    // favorito, link colado) não há para onde voltar: o botão leva às ofertas.
    await page.goto("/ofertas");
    const tabPromise = context.waitForEvent("page");
    await page.evaluate(() => window.open("/editor/naoexiste123", "_blank", "noopener"));
    const tab = await tabPromise;
    await expect(tab.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
    await tab.getByRole("link", { name: "Ir para as ofertas" }).click();
    await expect(tab).toHaveURL(/\/ofertas$/);
    await tab.close();
  });

  test("aba do editor tem o nome da página e da oferta", async ({ page }) => {
    const name = `Editor Aba ${uid()}`;
    await createOfferFromTemplate(page, name, "Upsell");
    await openEditor(page, "Página principal");
    await expect(page).toHaveTitle(`Página principal · ${name} · Offer Studio`);
  });

  test("voltar para a oferta logo depois de editar não perde a alteração", async ({ page }) => {
    // O salvamento automático espera 1,5 s; "Voltar para a oferta" salva antes de sair.
    await createOfferFromTemplate(page, `Editor Voltar Rápido ${uid()}`, "Upsell");
    await openEditor(page, "Página principal");
    const canvas = editorCanvas(page);
    const text = `Headline antes de sair ${uid()}`;
    await editCanvasText(page, canvas.locator("h1"), text, canvas.locator(".os-lead").first());
    await expect(saveStatus(page)).toHaveText("Alterações não salvas");
    await page.getByRole("link", { name: "Voltar para a oferta" }).click();
    await expect(page).toHaveURL(/\/ofertas\/[^/?]+$/);
    await expect(pageRow(page, "Página principal")).toBeVisible();

    await openEditor(page, "Página principal");
    await expect(canvas.locator("h1")).toHaveText(text);
  });

  test("'Ver página' tem nome em telas menores que 1280 px", async ({ page }) => {
    // O texto some abaixo de 1280 px, mas o botão tem nome (aria-label) e dica.
    await page.setViewportSize({ width: 1180, height: 760 });
    await createOfferFromTemplate(page, `Editor Tela Menor ${uid()}`, "Upsell");
    await openEditor(page, "Página principal");
    await expect(page.getByRole("button", { name: "Ver página" })).toBeVisible();
  });

  test("duas abas: salvar na segunda depois da primeira mostra o conflito", async ({ page, context }) => {
    await createOfferFromTemplate(page, `Editor Conflito ${uid()}`, "Upsell");
    await openEditor(page, "Página principal");
    const other = await context.newPage();
    await other.goto(page.url());
    await waitForEditor(other);

    const canvasA = editorCanvas(page);
    const canvasB = editorCanvas(other);
    await expectAutosave(page, () =>
      editCanvasText(page, canvasA.locator("h1"), "Versão da aba A", canvasA.locator(".os-lead").first()),
    );

    const conflict = waitForDocumentSave(other);
    await editCanvasText(other, canvasB.locator("h1"), "Versão da aba B", canvasB.locator(".os-lead").first());
    expect((await conflict).status()).toBe(409);
    const dialog = other.getByRole("dialog", { name: "Esta página foi alterada em outra aba" });
    await expect(dialog).toBeVisible();
    await expect(saveStatus(other)).toHaveText("Conflito ao salvar");

    // "Manter a minha": grava por cima da outra aba.
    await expectAutosave(other, () => dialog.getByRole("button", { name: "Manter a minha (sobrescrever)" }).click());
    await expect(dialog).toBeHidden();
    await other.reload();
    await waitForEditor(other);
    await expect(canvasB.locator("h1")).toHaveText("Versão da aba B");
    await other.close();
  });

  test("duas abas: 'Recarregar o que foi salvo' fica com o que a outra aba salvou", async ({ page, context }) => {
    // No 409 a revisão do servidor fica guardada à parte (só "Manter a minha" usa);
    // recarregar descarta as alterações desta aba sem gravar nada.
    await createOfferFromTemplate(page, `Editor Conflito Recarregar ${uid()}`, "Upsell");
    await openEditor(page, "Página principal");
    const other = await context.newPage();
    await other.goto(page.url());
    await waitForEditor(other);

    const canvasA = editorCanvas(page);
    const canvasB = editorCanvas(other);
    await expectAutosave(page, () =>
      editCanvasText(page, canvasA.locator("h1"), "Versão da aba A", canvasA.locator(".os-lead").first()),
    );

    const conflict = waitForDocumentSave(other);
    await editCanvasText(other, canvasB.locator("h1"), "Versão da aba B", canvasB.locator(".os-lead").first());
    expect((await conflict).status()).toBe(409);
    const dialog = other.getByRole("dialog", { name: "Esta página foi alterada em outra aba" });
    await expect(dialog).toBeVisible();

    // Se o navegador perguntar "Sair da página?", a pessoa lê e confirma.
    other.on("dialog", (d) => void new Promise((resolve) => setTimeout(resolve, 800)).then(() => d.accept()));
    const saves: number[] = [];
    other.on("response", (r) => {
      if (r.request().method() === "PUT" && /\/api\/documents\//.test(r.url())) saves.push(r.status());
    });
    const reloaded = other.waitForEvent("load");
    await dialog.getByRole("button", { name: "Recarregar o que foi salvo" }).click();
    await reloaded;
    await waitForEditor(other);
    await expect(canvasB.locator("h1")).toHaveText("Versão da aba A");
    // Recarregar descarta as alterações desta aba: nada é gravado.
    expect(saves).toEqual([]);

    // A versão da aba A continua sendo a salva.
    await page.reload();
    await waitForEditor(page);
    await expect(canvasA.locator("h1")).toHaveText("Versão da aba A");
    await other.close();
  });
});
