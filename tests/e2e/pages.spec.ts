import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  addPage,
  createOffer,
  expectToast,
  openPageMenu,
  pageRow,
  pageRows,
  selectOption,
  uid,
  waitForServerAction,
} from "./helpers";

/**
 * "Pega" uma página pelo teclado (foco na alça + Espaço). O dnd-kit só passa a
 * ouvir as setas num setTimeout depois de pegar; esperar um ciclo de timers da
 * página garante que as próximas teclas não se percam.
 */
async function pickUp(page: Page, handle: Locator) {
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
}

test.describe("Páginas do funil", () => {
  test("adiciona página com endereço automático e recusa endereços repetidos ou reservados", async ({ page }) => {
    await createOffer(page, `Oferta Páginas ${uid()}`);

    await page.getByRole("button", { name: "Adicionar página" }).click();
    const dialog = page.getByRole("dialog", { name: "Nova página" });
    await dialog.getByLabel("Nome", { exact: true }).fill("Upsell 1 — Kit");
    await expect(dialog.getByLabel("Endereço da página")).toHaveValue("upsell-1-kit");
    await expect(dialog.getByRole("combobox", { name: "Tipo" })).toHaveText("Página de vendas");
    await selectOption(dialog, page, "Tipo", "Upsell");
    await dialog.getByRole("button", { name: "Criar página" }).click();
    await expectToast(page, "Página criada.");
    await expect(dialog).toBeHidden();

    const row = pageRow(page, "Upsell 1 — Kit");
    await expect(row).toContainText("/upsell-1-kit/");
    await expect(row).toContainText("Upsell");
    await expect(row.getByText("Inicial", { exact: true })).toHaveCount(0);
    await expect(pageRows(page)).toHaveCount(2);

    // Endereço repetido: erro do servidor, em português, no campo.
    await page.getByRole("button", { name: "Adicionar página" }).click();
    await dialog.getByLabel("Nome", { exact: true }).fill("Outra página");
    await dialog.getByLabel("Endereço da página").fill("upsell-1-kit");
    await dialog.getByRole("button", { name: "Criar página" }).click();
    await expect(dialog.getByText("Já existe uma página com esse endereço (slug) nesta oferta.")).toBeVisible();
    await expect(dialog.getByLabel("Endereço da página")).toHaveAttribute("aria-invalid", "true");

    // Endereço reservado pelo sistema.
    await dialog.getByLabel("Endereço da página").fill("assets");
    await dialog.getByRole("button", { name: "Criar página" }).click();
    await expect(dialog.getByText('"assets" é reservado pelo sistema. Escolha outro endereço.')).toBeVisible();

    // O campo normaliza o que foi digitado ao sair dele.
    await dialog.getByLabel("Endereço da página").fill("Página Extra!");
    await dialog.getByLabel("Nome", { exact: true }).focus();
    await expect(dialog.getByLabel("Endereço da página")).toHaveValue("pagina-extra");
    await dialog.getByRole("button", { name: "Criar página" }).click();
    await expectToast(page, "Página criada.");
    await expect(pageRow(page, "Outra página")).toContainText("/pagina-extra/");
    await expect(pageRows(page)).toHaveCount(3);

    // Nome vazio.
    await page.getByRole("button", { name: "Adicionar página" }).click();
    await dialog.getByRole("button", { name: "Criar página" }).click();
    await expect(dialog.getByText("Dê um nome para a página.")).toBeVisible();
  });

  test("edita nome, endereço e tipo de uma página", async ({ page }) => {
    await createOffer(page, `Oferta Editar Página ${uid()}`);
    await addPage(page, "Captura Leads", { type: "Captura" });

    await openPageMenu(page, "Captura Leads");
    await page.getByRole("menuitem", { name: "Nome, endereço e tipo" }).click();
    const dialog = page.getByRole("dialog", { name: "Editar página" });
    await expect(dialog.getByLabel("Nome", { exact: true })).toHaveValue("Captura Leads");
    await expect(dialog.getByLabel("Endereço da página")).toHaveValue("captura-leads");
    await expect(dialog.getByRole("combobox", { name: "Tipo" })).toHaveText("Captura");

    // Editando, o endereço não muda sozinho com o nome.
    await dialog.getByLabel("Nome", { exact: true }).fill("Quiz do Emagrecimento");
    await expect(dialog.getByLabel("Endereço da página")).toHaveValue("captura-leads");
    await dialog.getByLabel("Endereço da página").fill("quiz");
    await selectOption(dialog, page, "Tipo", "Quiz");

    // Não pode usar o endereço de outra página da oferta.
    await dialog.getByLabel("Endereço da página").fill("principal");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(dialog.getByText("Já existe uma página com esse endereço (slug) nesta oferta.")).toBeVisible();

    await dialog.getByLabel("Endereço da página").fill("quiz");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expectToast(page, "Página atualizada.");
    await expect(dialog).toBeHidden();

    const row = pageRow(page, "Quiz do Emagrecimento");
    await expect(row).toContainText("/quiz/");
    await expect(row).toContainText("Quiz");
    await expect(pageRow(page, "Captura Leads")).toHaveCount(0);

    await page.reload();
    await expect(pageRow(page, "Quiz do Emagrecimento")).toContainText("/quiz/");
  });

  test("'Tornar página inicial' move o selo Inicial e a raiz do ZIP", async ({ page }) => {
    await createOffer(page, `Oferta Inicial ${uid()}`);
    await addPage(page, "Advertorial", { type: "Advertorial" });
    const principal = pageRow(page, "Página principal");
    const advertorial = pageRow(page, "Advertorial");
    await expect(principal.getByText("Inicial", { exact: true })).toBeVisible();
    await expect(advertorial).toContainText("/advertorial/");

    await openPageMenu(page, "Página principal");
    await expect(page.getByRole("menuitem", { name: "Tornar página inicial" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await openPageMenu(page, "Advertorial");
    await page.getByRole("menuitem", { name: "Tornar página inicial" }).click();
    await expectToast(page, '"Advertorial" agora é a página inicial.');
    await expect(advertorial.getByText("Inicial", { exact: true })).toBeVisible();
    await expect(advertorial).toContainText("Início do site (/)");
    await expect(principal.getByText("Inicial", { exact: true })).toHaveCount(0);
    await expect(principal).toContainText("/principal/");

    await page.reload();
    await expect(pageRow(page, "Advertorial").getByText("Inicial", { exact: true })).toBeVisible();
    await expect(pageRow(page, "Página principal")).toContainText("/principal/");
  });

  test("duplica e exclui páginas; a única página não pode ser excluída", async ({ page }) => {
    await createOffer(page, `Oferta Duplicar Página ${uid()}`);

    await openPageMenu(page, "Página principal");
    const onlyOne = page.getByRole("menuitem", { name: "É a única página" });
    await expect(onlyOne).toBeVisible();
    await expect(onlyOne).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("menuitem", { name: "Excluir página" })).toHaveCount(0);

    await page.getByRole("menuitem", { name: "Duplicar página" }).click();
    await expectToast(page, "Página duplicada.");
    const copy = pageRow(page, "Cópia de Página principal");
    await expect(copy).toContainText("/principal-copia/");
    await expect(copy.getByText("Inicial", { exact: true })).toHaveCount(0);
    await expect(pageRows(page)).toHaveText([/^1Página principal/, /^2Cópia de Página principal/]);

    // Excluir a inicial: a próxima da lista vira a inicial.
    await openPageMenu(page, "Página principal");
    await page.getByRole("menuitem", { name: "Excluir página" }).click();
    const confirm = page.getByRole("alertdialog", { name: 'Excluir a página "Página principal"?' });
    await expect(confirm).toContainText("Ela é a página inicial");
    await confirm.getByRole("button", { name: "Cancelar" }).click();
    await expect(pageRows(page)).toHaveCount(2);

    await openPageMenu(page, "Página principal");
    await page.getByRole("menuitem", { name: "Excluir página" }).click();
    await confirm.getByRole("button", { name: "Excluir página" }).click();
    await expectToast(page, "Página excluída.");
    await expect(pageRows(page)).toHaveCount(1);
    await expect(copy.getByText("Inicial", { exact: true })).toBeVisible();
    await expect(copy).toContainText("Início do site (/)");

    await openPageMenu(page, "Cópia de Página principal");
    await expect(page.getByRole("menuitem", { name: "É a única página" })).toHaveAttribute("aria-disabled", "true");
  });

  test("reordena as páginas pelo teclado e a ordem continua depois de recarregar", async ({ page }) => {
    await createOffer(page, `Oferta Ordem ${uid()}`);
    await addPage(page, "Página B");
    await addPage(page, "Página C");
    await expect(pageRows(page)).toHaveText([/Página principal/, /Página B/, /Página C/]);
    // Avisos do dnd-kit para leitores de tela (região "status"), em português.
    const announcement = page.getByRole("status").filter({ hasText: /"Página/ });

    const handle = page.getByRole("button", { name: "Arrastar Página principal", exact: true });
    await expect(handle).toHaveAccessibleDescription(/barra de espaço/i);
    await pickUp(page, handle);
    await page.keyboard.press("ArrowDown");
    await expect(announcement).toHaveText('"Página principal" movida para a posição 2 de 3.');
    const saved = waitForServerAction(page);
    await page.keyboard.press("Space");
    await expect(handle).not.toHaveAttribute("aria-pressed", "true");
    await expect(announcement).toHaveText('"Página principal" solta na posição 2 de 3.');
    expect((await saved).ok()).toBe(true);

    await expect(pageRows(page)).toHaveText([/^1Página B/, /^2Página principal/, /^3Página C/]);
    await page.reload();
    await expect(pageRows(page)).toHaveText([/^1Página B/, /^2Página principal/, /^3Página C/]);
    // A inicial continua sendo a mesma, só mudou de posição.
    await expect(pageRow(page, "Página principal").getByText("Inicial", { exact: true })).toBeVisible();

    // Esc cancela o arrasto sem mudar nada.
    const handleC = page.getByRole("button", { name: "Arrastar Página C", exact: true });
    await pickUp(page, handleC);
    await page.keyboard.press("ArrowUp");
    await expect(announcement).toHaveText('"Página C" movida para a posição 2 de 3.');
    await page.keyboard.press("Escape");
    await expect(handleC).not.toHaveAttribute("aria-pressed", "true");
    await expect(announcement).toHaveText('Movimento cancelado. "Página C" voltou para o lugar.');
    await expect(pageRows(page)).toHaveText([/^1Página B/, /^2Página principal/, /^3Página C/]);
    await page.reload();
    await expect(pageRows(page)).toHaveText([/^1Página B/, /^2Página principal/, /^3Página C/]);
  });
});
