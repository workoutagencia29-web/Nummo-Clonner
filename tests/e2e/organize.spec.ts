import { expect, type Page, test } from "@playwright/test";
import {
  chooseInSubmenu,
  createOffer,
  expectToast,
  offerCard,
  openCardMenu,
  selectOption,
  sidebar,
  uid,
} from "./helpers";

function folderLink(page: Page, name: string) {
  return sidebar(page).getByRole("link", { name, exact: false }).filter({ hasText: name });
}

/** Contador ao lado do nome da pasta no menu lateral ("" quando vazia). */
function folderCount(page: Page, name: string) {
  return folderLink(page, name).locator("span").last();
}

async function createFolder(page: Page, name: string) {
  await sidebar(page).getByRole("button", { name: "Nova pasta" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova pasta" });
  await dialog.getByLabel("Nome da pasta").fill(name);
  await dialog.getByRole("button", { name: "Criar pasta" }).click();
  await expectToast(page, "Pasta criada.");
  await expect(dialog).toBeHidden();
  await expect(folderLink(page, name)).toBeVisible();
}

async function openFolderMenu(page: Page, name: string) {
  await folderLink(page, name).hover();
  await sidebar(page)
    .getByRole("button", { name: `Opções da pasta ${name}`, exact: true })
    .click();
  await expect(page.getByRole("menu")).toBeVisible();
}

async function folderIdOf(page: Page, name: string) {
  const href = await folderLink(page, name).getAttribute("href");
  const id = new URL(href ?? "", "http://x").searchParams.get("pasta");
  if (!id) throw new Error(`Pasta sem id: ${name}`);
  return id;
}

/** Cria uma tag nova pelo diálogo "Tags…" do card e salva. */
async function createTagOnCard(page: Page, offerName: string, tagName: string) {
  await openCardMenu(page, offerName);
  await page.getByRole("menuitem", { name: "Tags…" }).click();
  const dialog = page.getByRole("dialog", { name: "Tags da oferta" });
  const search = dialog.getByRole("combobox", { name: "Buscar ou criar tag" });
  await search.fill(tagName);
  await dialog
    .getByRole("listbox", { name: "Tags" })
    .getByRole("option", { name: `Criar tag “${tagName}”` })
    .click();
  await expectToast(page, `Tag "${tagName}" criada.`);
  // A tag criada já vem marcada (e continua marcada depois que a tela atualiza); a busca volta a ficar vazia.
  await expect(search).toHaveValue("");
  await expect(dialog.getByRole("option", { name: tagName, exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "Salvar tags" }).click();
  await expectToast(page, "Tags atualizadas.");
  await expect(dialog).toBeHidden();
}

test.describe("Pastas", () => {
  test("cria pasta, cria ofertas dentro dela, filtra, renomeia e exclui", async ({ page }) => {
    const id = uid();
    const folder = `Pasta ${id} Nutra`;
    const renamed = `Pasta ${id} Clientes`;
    const inside = `Dentro da pasta ${id}`;
    const inside2 = `Dentro da pasta dois ${id}`;
    const outside = `Fora da pasta ${id}`;

    await createOffer(page, outside);
    await page.goto("/ofertas");

    // Validação e nome repetido.
    await sidebar(page).getByRole("button", { name: "Nova pasta" }).click();
    const dialog = page.getByRole("dialog", { name: "Nova pasta" });
    await dialog.getByRole("button", { name: "Criar pasta" }).click();
    await expect(dialog.getByText('Preencha o campo "Nome da pasta".')).toBeVisible();
    await dialog.getByRole("button", { name: "Cancelar" }).click();

    await createFolder(page, folder);
    await expect(folderCount(page, folder)).toHaveText("");

    await sidebar(page).getByRole("button", { name: "Nova pasta" }).click();
    await dialog.getByLabel("Nome da pasta").fill(folder.toUpperCase());
    await dialog.getByRole("button", { name: "Criar pasta" }).click();
    await expect(dialog.getByText("Já existe uma pasta com esse nome.")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancelar" }).click();

    // Nova oferta pelo menu da pasta: a pasta já vem escolhida.
    await openFolderMenu(page, folder);
    await page.getByRole("menuitem", { name: "Nova oferta nesta pasta" }).click();
    const create = page.getByRole("dialog", { name: "Nova oferta" });
    await expect(create.getByRole("combobox", { name: "Pasta" })).toHaveText(folder);
    await create.getByLabel("Nome da oferta").fill(inside);
    await create.getByRole("button", { name: "Criar oferta" }).click();
    await expect(page.getByRole("heading", { level: 1, name: inside })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Caminho" }).getByRole("link", { name: folder })).toBeVisible();
    await expect(folderCount(page, folder)).toHaveText("1");

    // Na tela da pasta, o "Nova oferta" do menu lateral também já escolhe a pasta.
    await folderLink(page, folder).click();
    const folderId = await folderIdOf(page, folder);
    await expect(page).toHaveURL(new RegExp(`/ofertas\\?pasta=${folderId}$`));
    await expect(folderLink(page, folder)).toHaveAttribute("aria-current", "page");
    await sidebar(page).getByRole("button", { name: "Nova oferta" }).click();
    await expect(create.getByRole("combobox", { name: "Pasta" })).toHaveText(folder);
    await create.getByLabel("Nome da oferta").fill(inside2);
    await create.getByRole("button", { name: "Criar oferta" }).click();
    await expect(page.getByRole("heading", { level: 1, name: inside2 })).toBeVisible();
    await expect(folderCount(page, folder)).toHaveText("2");

    // /ofertas?pasta=<id> mostra só as ofertas da pasta, com o nome dela no título.
    await page.goto(`/ofertas?pasta=${folderId}`);
    await expect(page.getByRole("heading", { level: 1, name: folder })).toBeVisible();
    await expect(page.getByText("2 ofertas nesta pasta")).toBeVisible();
    await expect(offerCard(page, inside)).toBeVisible();
    await expect(offerCard(page, inside2)).toBeVisible();
    await expect(offerCard(page, outside)).toHaveCount(0);
    await expect(page.locator("article")).toHaveCount(2);

    // Renomear.
    await openFolderMenu(page, folder);
    await page.getByRole("menuitem", { name: "Renomear" }).click();
    const rename = page.getByRole("dialog", { name: "Renomear pasta" });
    await expect(rename.getByLabel("Nome da pasta")).toHaveValue(folder);
    await rename.getByLabel("Nome da pasta").fill(renamed);
    await rename.getByRole("button", { name: "Salvar" }).click();
    await expectToast(page, "Pasta renomeada.");
    await expect(page.getByRole("heading", { level: 1, name: renamed })).toBeVisible();
    await expect(folderLink(page, renamed)).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: folder })).toHaveCount(0);

    // Excluir: as ofertas continuam, agora sem pasta.
    await openFolderMenu(page, renamed);
    await page.getByRole("menuitem", { name: "Excluir pasta" }).click();
    const confirm = page.getByRole("alertdialog", { name: `Excluir a pasta "${renamed}"?` });
    await expect(confirm).toContainText("As 2 ofertas dela não serão apagadas: elas ficam sem pasta.");
    await confirm.getByRole("button", { name: "Excluir pasta" }).click();
    await expectToast(page, "Pasta excluída.");
    await expect(page).toHaveURL(/\/ofertas$/);
    await expect(folderLink(page, renamed)).toHaveCount(0);
    await expect(offerCard(page, inside)).toBeVisible();
    await expect(offerCard(page, inside2)).toBeVisible();

    await offerCard(page, inside).getByRole("link", { name: inside, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: inside })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Caminho" }).getByRole("link")).toHaveCount(1);
  });

  test("move uma oferta para outra pasta pelo menu do card", async ({ page }) => {
    const id = uid();
    const from = `Origem ${id}`;
    const to = `Destino ${id}`;
    const offer = `Oferta Mover ${id}`;
    await page.goto("/ofertas");
    await createFolder(page, from);
    await createFolder(page, to);
    const fromId = await folderIdOf(page, from);
    const toId = await folderIdOf(page, to);

    await openFolderMenu(page, from);
    await page.getByRole("menuitem", { name: "Nova oferta nesta pasta" }).click();
    const create = page.getByRole("dialog", { name: "Nova oferta" });
    await create.getByLabel("Nome da oferta").fill(offer);
    await create.getByRole("button", { name: "Criar oferta" }).click();
    await expect(page.getByRole("heading", { level: 1, name: offer })).toBeVisible();

    await page.goto(`/ofertas?pasta=${fromId}`);
    await expect(offerCard(page, offer)).toBeVisible();
    await openCardMenu(page, offer);
    await page.getByRole("menuitem", { name: "Mover para pasta" }).click();
    await expect(page.getByRole("menuitemradio", { name: from, exact: true })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menuitemradio", { name: to, exact: true }).click();
    await expectToast(page, "Oferta movida.");
    await expect(offerCard(page, offer)).toHaveCount(0);
    await expect(page.getByText("Esta pasta está vazia")).toBeVisible();
    await expect(folderCount(page, from)).toHaveText("");
    await expect(folderCount(page, to)).toHaveText("1");

    await page.goto(`/ofertas?pasta=${toId}`);
    await expect(offerCard(page, offer)).toBeVisible();

    await openCardMenu(page, offer);
    await chooseInSubmenu(page, "Mover para pasta", "Sem pasta");
    await expectToast(page, "Oferta tirada da pasta.");
    await expect(offerCard(page, offer)).toHaveCount(0);
    await page.goto("/ofertas");
    await expect(offerCard(page, offer)).toBeVisible();
  });
});

test.describe("Tags", () => {
  test("cria tag no diálogo da oferta, mostra no card e filtra por ela", async ({ page }) => {
    const id = uid();
    const tagged = `Oferta Com Tag ${id}`;
    const plain = `Oferta Sem Tag ${id}`;
    const tag = `Nutra ${id}`;
    await createOffer(page, tagged);
    await createOffer(page, plain);
    await page.goto("/ofertas");

    await createTagOnCard(page, tagged, tag);
    await expect(offerCard(page, tagged).getByText(tag, { exact: true })).toBeVisible();
    await expect(offerCard(page, plain).getByText(tag, { exact: true })).toHaveCount(0);

    await selectOption(page, page, "Filtrar por tag", tag);
    await expect(page).toHaveURL(/[?&]tag=[^&]+/);
    await expect(offerCard(page, tagged)).toBeVisible();
    await expect(offerCard(page, plain)).toHaveCount(0);

    // A busca também encontra pelo nome da tag.
    await page.goto(`/ofertas?q=${encodeURIComponent(tag.toLowerCase())}`);
    await expect(offerCard(page, tagged)).toBeVisible();
    await expect(offerCard(page, plain)).toHaveCount(0);

    // Desmarcar a tag tira o chip do card.
    await page.goto("/ofertas");
    await openCardMenu(page, tagged);
    await page.getByRole("menuitem", { name: "Tags…" }).click();
    const dialog = page.getByRole("dialog", { name: "Tags da oferta" });
    const option = dialog.getByRole("option", { name: tag, exact: true });
    await expect(option).toBeChecked();
    await option.click();
    await expect(option).not.toBeChecked();
    await dialog.getByRole("button", { name: "Salvar tags" }).click();
    await expectToast(page, "Tags atualizadas.");
    await expect(offerCard(page, tagged).getByText(tag, { exact: true })).toHaveCount(0);
  });

  test("Configurações: renomeia, muda a cor e exclui uma tag", async ({ page }) => {
    const id = uid();
    const offer = `Oferta Tag Config ${id}`;
    const tag = `Tag Config ${id}`;
    const renamed = `Tag Renomeada ${id}`;
    await createOffer(page, offer);
    await page.goto("/ofertas");
    await createTagOnCard(page, offer, tag);

    await page.goto("/configuracoes");
    await page.getByRole("button", { name: `Renomear ${tag}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Renomear tag" });
    await expect(dialog.getByLabel("Nome da tag")).toHaveValue(tag);
    await dialog.getByLabel("Nome da tag").fill(renamed);
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expectToast(page, "Tag renomeada.");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: `Renomear ${renamed}`, exact: true })).toBeVisible();

    await page.getByRole("button", { name: `Cor da tag ${renamed}`, exact: true }).click();
    await page.getByRole("button", { name: "Verde", exact: true }).click();
    await expectToast(page, "Cor atualizada.");
    await page.keyboard.press("Escape");

    await page.goto("/ofertas");
    await expect(offerCard(page, offer).getByText(renamed, { exact: true })).toBeVisible();
    await expect(offerCard(page, offer).getByText(tag, { exact: true })).toHaveCount(0);

    await page.goto("/configuracoes");
    await page.getByRole("button", { name: `Excluir ${renamed}`, exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: `Excluir a tag "${renamed}"?` });
    await expect(confirm).toContainText("Ela será removida de 1 oferta. As ofertas não são apagadas.");
    await confirm.getByRole("button", { name: "Excluir tag" }).click();
    await expectToast(page, "Tag excluída.");
    await expect(page.getByRole("button", { name: `Excluir ${renamed}`, exact: true })).toHaveCount(0);

    await page.goto("/ofertas");
    await expect(offerCard(page, offer)).toBeVisible();
    await expect(offerCard(page, offer).getByText(renamed, { exact: true })).toHaveCount(0);
  });
});
