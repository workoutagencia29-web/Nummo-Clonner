import { expect, test } from "@playwright/test";
import {
  addPage,
  chooseInSubmenu,
  createOffer,
  expectToast,
  offerCard,
  openCardMenu,
  pageRows,
  selectOption,
  sidebar,
  uid,
} from "./helpers";

test.describe("Ofertas", () => {
  test("cria oferta pelo menu lateral, valida o nome e abre a tela da oferta", async ({ page }) => {
    const name = `Oferta Nova ${uid()}`;
    await page.goto("/ofertas");

    await sidebar(page).getByRole("button", { name: "Nova oferta" }).click();
    const dialog = page.getByRole("dialog", { name: "Nova oferta" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Pasta" })).toHaveText("Sem pasta");
    // Mesma galeria do "Nova página", já com a página de vendas; políticas/termos não são ponto de partida.
    const gallery = dialog.getByRole("radiogroup", { name: "Primeira página" });
    await expect(gallery.getByRole("radio", { name: "Página de vendas longa" })).toBeChecked();
    await expect(gallery.getByRole("radio", { name: "VSL", exact: true })).toBeVisible();
    await expect(gallery.getByRole("radio", { name: "Política de privacidade" })).toHaveCount(0);
    await gallery.getByRole("radio", { name: "Em branco", exact: true }).click();

    // Nome vazio (ou só espaços) não é aceito.
    await dialog.getByRole("button", { name: "Criar oferta" }).click();
    await expect(dialog.getByText("Dê um nome para a oferta.")).toBeVisible();
    await dialog.getByLabel("Nome da oferta").fill("   ");
    await dialog.getByRole("button", { name: "Criar oferta" }).click();
    await expect(dialog.getByText("Dê um nome para a oferta.")).toBeVisible();
    await expect(page).toHaveURL(/\/ofertas$/);

    await dialog.getByLabel("Nome da oferta").fill(name);
    await expect(dialog.getByText("Dê um nome para a oferta.")).toBeHidden();
    await dialog.getByRole("button", { name: "Criar oferta" }).click();

    await expect(page).toHaveURL(/\/ofertas\/[^/?]+$/);
    await expectToast(page, "Oferta criada.");
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Caminho" })).toContainText(name);
    const rows = pageRows(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Página principal");
    await expect(rows.first().getByText("Inicial", { exact: true })).toBeVisible();
    await expect(rows.first()).toContainText("Início do site (/)");
    await expect(page.getByRole("main").getByText("Rascunho", { exact: true })).toBeVisible();

    await page.goto("/ofertas");
    const card = offerCard(page, name);
    await expect(card).toBeVisible();
    await expect(card).toContainText("Rascunho");
    await expect(card).toContainText("1 página");
    // Rascunho sem endereço: nada de "Ainda não hospedada" repetido em todo card.
    await expect(card).not.toContainText("hospedada");
    await expect(card).not.toContainText("endereço");
  });

  test("renomeia a oferta pelo menu do card", async ({ page }) => {
    const name = `Oferta Renomear ${uid()}`;
    const newName = `${name} (nova)`;
    await createOffer(page, name);
    await page.goto("/ofertas");

    await openCardMenu(page, name);
    await page.getByRole("menuitem", { name: "Renomear" }).click();
    const dialog = page.getByRole("dialog", { name: "Renomear oferta" });
    const input = dialog.getByLabel("Nome da oferta");
    await expect(input).toHaveValue(name);

    await input.fill("");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(dialog.getByText('Preencha o campo "Nome da oferta".')).toBeVisible();

    await input.fill(newName);
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expectToast(page, "Oferta renomeada.");
    await expect(dialog).toBeHidden();
    await expect(offerCard(page, newName)).toBeVisible();
    await expect(offerCard(page, name)).toHaveCount(0);
  });

  test("duplica a oferta com as mesmas páginas e abre a cópia", async ({ page }) => {
    const name = `Oferta Duplicar ${uid()}`;
    const originalId = await createOffer(page, name);
    await addPage(page, "Obrigado", { type: "Obrigado" });

    await page.goto("/ofertas");
    await openCardMenu(page, name);
    await page.getByRole("menuitem", { name: "Duplicar" }).click();

    await expectToast(page, "Oferta duplicada.");
    // A cópia abre já no "Renomear", com o nome selecionado (digitar substitui).
    const rename = page.getByRole("dialog", { name: "Renomear oferta" });
    await expect(rename).toBeVisible();
    await expect(rename.getByLabel("Nome da oferta")).toHaveValue(`Cópia de ${name}`);
    await expect
      .poll(() =>
        rename
          .getByLabel("Nome da oferta")
          .evaluate((el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0)),
      )
      .toBe(`Cópia de ${name}`.length);
    await page.keyboard.press("Escape");
    await expect(rename).toBeHidden();
    await expect(page).toHaveURL(/\/ofertas\/[^/?]+$/);
    await expect(page).not.toHaveURL(new RegExp(`/ofertas/${originalId}$`));
    await expect(page.getByRole("heading", { level: 1, name: `Cópia de ${name}` })).toBeVisible();
    await expect(page.getByRole("main").getByText("Rascunho", { exact: true })).toBeVisible();

    const rows = pageRows(page);
    await expect(rows).toHaveText([/Página principal.*Inicial/, /Obrigado.*\/obrigado\//]);

    // A original continua lá, intacta.
    await page.goto("/ofertas");
    await expect(offerCard(page, name)).toContainText("2 páginas");
    await expect(offerCard(page, `Cópia de ${name}`)).toContainText("2 páginas");
  });

  test("muda o status pelo submenu e o filtro de status mostra/esconde a oferta", async ({ page }) => {
    const name = `Oferta Status ${uid()}`;
    await createOffer(page, name);
    await page.goto("/ofertas");
    const card = offerCard(page, name);
    await expect(card).toContainText("Rascunho");

    await openCardMenu(page, name);
    await chooseInSubmenu(page, "Status", "No ar");
    // Sem "Onde está no ar", o próprio passo pede o endereço (pode ficar em branco).
    const live = page.getByRole("dialog", { name: "Onde a oferta está no ar?" });
    await expect(live).toBeVisible();
    await live.getByRole("button", { name: "Marcar como no ar" }).click();
    await expectToast(page, "Status: No ar.");
    await expect(card).toContainText("No ar");
    await expect(card).not.toContainText("Rascunho");
    await expect(card.getByRole("link", { name: "Adicionar o endereço onde está no ar" })).toBeVisible();

    await selectOption(page, page, "Filtrar por status", "No ar");
    await expect(page).toHaveURL(/[?&]status=LIVE\b/);
    await expect(card).toBeVisible();

    await selectOption(page, page, "Filtrar por status", "Rascunho");
    await expect(page).toHaveURL(/[?&]status=DRAFT\b/);
    await expect(card).toHaveCount(0);

    await page.goto("/ofertas?status=ARCHIVED");
    await expect(page.getByRole("combobox", { name: "Filtrar por status" })).toHaveText("Arquivada");
    await expect(offerCard(page, name)).toHaveCount(0);

    await page.goto("/ofertas?status=LIVE");
    await expect(offerCard(page, name)).toBeVisible();

    await selectOption(page, page, "Filtrar por status", "Todos os status");
    await expect(page).toHaveURL(/\/ofertas$/);
    await expect(offerCard(page, name)).toBeVisible();
  });

  test("busca ignora acentos, sobrevive ao recarregar e 'Limpar filtros' volta tudo", async ({ page }) => {
    const id = uid();
    const promo = `Promoção Relâmpago ${id}`;
    const other = `Outra Oferta ${id}`;
    await createOffer(page, promo);
    await createOffer(page, other);
    await page.goto("/ofertas");

    const search = page.getByRole("searchbox", { name: "Buscar ofertas" });
    await search.fill(`promocao relampago ${id}`);
    await expect(page).toHaveURL(/[?&]q=promocao/);
    await expect(offerCard(page, promo)).toBeVisible();
    await expect(offerCard(page, other)).toHaveCount(0);
    await expect(page.getByText("1 oferta encontrada")).toBeVisible();

    await page.reload();
    await expect(search).toHaveValue(`promocao relampago ${id}`);
    await expect(offerCard(page, promo)).toBeVisible();
    await expect(offerCard(page, other)).toHaveCount(0);

    // Maiúsculas também não importam.
    await search.fill(`PROMOÇÃO ${id}`);
    await expect(page).toHaveURL(/[?&]q=PROMO/);
    await expect(offerCard(page, promo)).toBeVisible();
    await expect(offerCard(page, other)).toHaveCount(0);

    await page.getByRole("button", { name: "Limpar filtros" }).click();
    await expect(page).toHaveURL(/\/ofertas$/);
    await expect(search).toHaveValue("");
    await expect(offerCard(page, promo)).toBeVisible();
    await expect(offerCard(page, other)).toBeVisible();
    await expect(page.getByRole("button", { name: "Limpar filtros" })).toHaveCount(0);

    // Sem resultados: estado vazio com o link para limpar.
    await search.fill(`nada-existe-${id}`);
    await expect(page.getByText("Nenhuma oferta encontrada")).toBeVisible();
    await page.getByRole("link", { name: "Limpar filtros" }).click();
    await expect(page).toHaveURL(/\/ofertas$/);
    await expect(search).toHaveValue("");
    await expect(offerCard(page, promo)).toBeVisible();
  });

  test("move para a lixeira sem confirmação, desfaz pelo aviso e restaura pela lixeira", async ({ page }) => {
    const name = `Oferta Lixeira ${uid()}`;
    const id = await createOffer(page, name);
    await page.goto("/ofertas");

    // Ação reversível: sem pergunta; o aviso traz o "Desfazer".
    await openCardMenu(page, name);
    await page.getByRole("menuitem", { name: "Mover para a lixeira" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expectToast(page, "Oferta movida para a lixeira.");
    await expect(offerCard(page, name)).toHaveCount(0);
    await page
      .getByRole("region", { name: /Notificações/ })
      .getByRole("button", { name: "Desfazer" })
      .click();
    await expectToast(page, `"${name}" restaurada.`);
    await expect(offerCard(page, name)).toBeVisible();

    await openCardMenu(page, name);
    await page.getByRole("menuitem", { name: "Mover para a lixeira" }).click();
    await expect(offerCard(page, name)).toHaveCount(0);

    // A tela da oferta não abre enquanto ela está na lixeira.
    await page.goto(`/ofertas/${id}`);
    await expect(page.getByRole("heading", { name: "Oferta não encontrada" })).toBeVisible();
    await page.getByRole("link", { name: "Abrir a lixeira" }).click();
    await expect(page).toHaveURL(/\/lixeira$/);

    const row = page.getByRole("main").getByRole("listitem").filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText("1 página");
    await row.getByRole("button", { name: "Restaurar" }).click();
    await expectToast(page, `"${name}" restaurada.`);
    await expect(row).toHaveCount(0);

    await page.goto("/ofertas");
    await expect(offerCard(page, name)).toBeVisible();
  });

  test("move para a lixeira pela tela da oferta e volta ao painel", async ({ page }) => {
    const name = `Oferta Lixeira Tela ${uid()}`;
    await createOffer(page, name);
    await page.getByRole("button", { name: "Ações", exact: true }).click();
    await page.getByRole("menuitem", { name: "Mover para a lixeira" }).click();
    await expectToast(page, "Oferta movida para a lixeira.");
    await expect(page).toHaveURL(/\/ofertas$/);
    await expect(offerCard(page, name)).toHaveCount(0);
  });

  test("exclui de vez e esvazia a lixeira, sempre com confirmação", async ({ page }) => {
    const id = uid();
    const names = [`Lixo A ${id}`, `Lixo B ${id}`, `Lixo C ${id}`];
    for (const name of names) {
      await createOffer(page, name);
      await page.getByRole("button", { name: "Ações", exact: true }).click();
      await page.getByRole("menuitem", { name: "Mover para a lixeira" }).click();
      await expect(page).toHaveURL(/\/ofertas$/);
    }

    await page.goto("/lixeira");
    const rows = page.getByRole("main").getByRole("listitem");
    const rowA = rows.filter({ hasText: names[0] });
    await rowA.getByRole("button", { name: "Excluir de vez" }).click();
    const confirmOne = page.getByRole("alertdialog", { name: `Excluir "${names[0]}" para sempre?` });
    await expect(confirmOne).toBeVisible();
    await confirmOne.getByRole("button", { name: "Cancelar" }).click();
    await expect(confirmOne).toBeHidden();
    await expect(rowA).toBeVisible();

    await rowA.getByRole("button", { name: "Excluir de vez" }).click();
    await confirmOne.getByRole("button", { name: "Excluir para sempre" }).click();
    await expectToast(page, "Oferta excluída.");
    await expect(rowA).toHaveCount(0);
    await expect(rows.filter({ hasText: names[1] })).toBeVisible();

    const total = await rows.count();
    expect(total).toBeGreaterThanOrEqual(2);
    await page.getByRole("button", { name: "Esvaziar lixeira" }).click();
    const confirmAll = page.getByRole("alertdialog", { name: "Esvaziar a lixeira?" });
    await expect(confirmAll).toContainText(`${total} ofertas serão apagadas para sempre`);
    await confirmAll.getByRole("button", { name: "Esvaziar lixeira" }).click();
    await expectToast(page, `${total} ofertas excluídas.`);
    await expect(page.getByText("A lixeira está vazia")).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: /Lixeira/ })).toHaveText("Lixeira");

    // Não voltam para o painel.
    await page.goto("/ofertas");
    for (const name of names) await expect(offerCard(page, name)).toHaveCount(0);
  });
});
