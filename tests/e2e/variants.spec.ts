import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { parse } from "dotenv";
import { Client } from "pg";
import {
  createOffer,
  createOfferFromTemplate,
  editCanvasText,
  editorCanvas,
  expectAutosave,
  expectToast,
  openPageMenu,
  pageRow,
  uid,
  waitForEditor,
} from "./helpers";

/**
 * Teste A/B (Fase 5), de ponta a ponta: criar a versão B pela lista de páginas,
 * editar o texto só da B, trocar de versão no editor, dividir 70/30, trocar o
 * controle e excluir uma versão. Criar como cópia da versão de controle é um
 * clique ("Criar versão B (cópia da A)"); nome, modelo ou outra versão ficam em
 * "Modelo ou outra versão…".
 *
 * Textos do modelo "Upsell": src/editor/templates/upsell.ts.
 */
const UPSELL_HEADLINE = "Parabéns pela sua compra! Antes de acessar, veja esta oferta exclusiva";
const PREVIEW_ORIGIN = /^http:\/\/[a-z2-7]{26}\.localhost:3201\/$/;

/** Diálogo "Teste A/B" (o título muda para "Criar versão X" no formulário de criar). */
function abDialog(page: Page) {
  return page.getByRole("dialog");
}

function versionRow(page: Page, letter: string) {
  return abDialog(page).getByRole("listitem", { name: `Versão ${letter}`, exact: true });
}

function versionSwitcher(page: Page) {
  return page.getByRole("radiogroup", { name: "Versão A/B da página" });
}

/** Banco dos testes E2E (scripts/e2e-server.ts). Nunca o "offerstudio" (dados reais). */
async function withE2eDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const env = parse(readFileSync(path.join(process.cwd(), ".env")));
  const client = new Client({
    host: "127.0.0.1",
    port: Number(env.PG_PORT || 5433),
    user: env.PG_USER || "offerstudio",
    password: env.PG_PASSWORD,
    database: "offerstudio_e2e_auto",
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const versionHtml = (title: string) =>
  `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><h1>${title}</h1></body></html>`;

test.describe("Teste A/B", () => {
  test.describe.configure({ timeout: 120_000 });

  test("cria a versão B, edita só a B, divide 70/30, troca o controle e exclui", async ({ page, context }) => {
    const name = `Oferta A/B ${uid()}`;
    await createOfferFromTemplate(page, name, "Upsell");

    // Página com uma versão: sem selo; o menu abre o Teste A/B.
    const row = pageRow(page, "Página principal");
    await expect(row.getByRole("button", { name: /versões A\/B/ })).toHaveCount(0);
    await openPageMenu(page, "Página principal");
    await page.getByRole("menuitem", { name: "Teste A/B" }).click();
    const dialog = abDialog(page);
    await expect(dialog).toBeVisible();
    await expect(versionRow(page, "A")).toContainText("Controle");
    // Uma versão só: fica no endereço da própria página (não existe oferta-a/ no ZIP).
    await expect(versionRow(page, "A")).toContainText("Início do site (/)");
    await expect(versionRow(page, "A")).not.toContainText("oferta-a");
    await expect(dialog.getByText("Divisão do tráfego")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Criar versão B (cópia da A)" })).toBeVisible();

    // Criar versão B (cópia da A) com um nome: "Modelo ou outra versão…".
    await dialog.getByRole("button", { name: "Modelo ou outra versão…" }).click();
    await expect(dialog.getByRole("radio", { name: /Cópia de uma versão/ })).toHaveAttribute("aria-checked", "true");
    await dialog.getByLabel("Nome da versão (opcional)").fill("Headline nova");
    await dialog.getByRole("button", { name: "Criar versão B", exact: true }).click();
    await expect(dialog.getByRole("status").filter({ hasText: "Versão B criada." })).toBeVisible();
    await expect(versionRow(page, "B")).toContainText("Headline nova");
    await expect(versionRow(page, "B")).toContainText("50% do tráfego");
    await expect(versionRow(page, "A")).toContainText("50% do tráfego");
    // Com duas versões, cada uma na pasta dela.
    await expect(versionRow(page, "A")).toContainText("/oferta-a/");
    await expect(versionRow(page, "B")).toContainText("/oferta-b/");

    // Editar a B: o editor abre na B, com o seletor de versão.
    await versionRow(page, "B").getByRole("link", { name: "Editar a versão B" }).click();
    await waitForEditor(page);
    const switcher = versionSwitcher(page);
    await expect(switcher.getByRole("radio", { name: "Versão B" })).toHaveAttribute("aria-checked", "true");
    await expect(switcher.getByRole("radio", { name: "Versão A, controle" })).toHaveAttribute("aria-checked", "false");
    const bDocUrl = page.url();

    const canvas = editorCanvas(page);
    const headlineB = `Headline só da B ${uid()}`;
    await expect(canvas.locator("h1")).toHaveText(UPSELL_HEADLINE);
    await expectAutosave(page, () =>
      editCanvasText(page, canvas.locator("h1"), headlineB, canvas.locator(".os-lead").first()),
    );

    // Trocar para a A: a A continua com o texto original.
    await switcher.getByRole("radio", { name: "Versão A, controle" }).click();
    await expect(page).not.toHaveURL(bDocUrl);
    await waitForEditor(page);
    await expect(versionSwitcher(page).getByRole("radio", { name: "Versão A, controle" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(canvas.locator("h1")).toHaveText(UPSELL_HEADLINE);

    // E de volta para a B: o texto novo ficou salvo.
    await versionSwitcher(page).getByRole("radio", { name: "Versão B" }).click();
    await expect(page).toHaveURL(bDocUrl);
    await waitForEditor(page);
    await expect(canvas.locator("h1")).toHaveText(headlineB);

    // De volta à oferta: o selo abre o Teste A/B.
    await page.getByRole("link", { name: "Voltar para a oferta" }).click();
    await expect(page).toHaveURL(/\/ofertas\/[^/?]+$/);
    await pageRow(page, "Página principal").getByRole("button", { name: "2 versões A/B" }).click();
    await expect(dialog).toBeVisible();

    // Prévia da B: abre numa aba nova, direto na versão B.
    const previewPromise = context.waitForEvent("page");
    await versionRow(page, "B").getByRole("button", { name: "Ver página da versão B" }).click();
    const preview = await previewPromise;
    await expect(preview).toHaveURL(PREVIEW_ORIGIN);
    await expect(preview.getByRole("heading", { level: 1 })).toHaveText(headlineB);
    await preview.close();

    // 70/30: mudar a A ajusta a B.
    const inputA = dialog.getByLabel("Percentual da versão A");
    const inputB = dialog.getByLabel("Percentual da versão B");
    await inputA.fill("70");
    await expect(inputB).toHaveValue("30");
    await inputB.fill("");
    await expect(dialog.getByRole("alert")).toHaveText("Digite um número inteiro de 0 a 100 em cada versão.");
    await expect(dialog.getByRole("button", { name: "Salvar divisão" })).toBeDisabled();
    await inputB.fill("30");
    await expect(inputA).toHaveValue("70");
    await dialog.getByRole("button", { name: "Salvar divisão" }).click();
    await expectToast(page, "Divisão do tráfego salva.");
    await expect(versionRow(page, "A")).toContainText("70% do tráfego");
    await expect(versionRow(page, "B")).toContainText("30% do tráfego");

    // B vira o controle.
    await versionRow(page, "B").getByRole("button", { name: "Ações da versão B" }).click();
    await page.getByRole("menuitem", { name: "Tornar controle" }).click();
    await expectToast(page, "A versão B agora é o controle.");
    await expect(versionRow(page, "B")).toContainText("Controle");
    await expect(versionRow(page, "A")).not.toContainText("Controle");

    // Excluir a A (com confirmação): a B fica com 100%.
    await versionRow(page, "A").getByRole("button", { name: "Ações da versão A" }).click();
    await page.getByRole("menuitem", { name: "Excluir versão" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Excluir a versão A?" });
    await expect(confirm).toContainText("A versão B passa a receber 100% do tráfego.");
    await confirm.getByRole("button", { name: "Excluir versão A" }).click();
    await expectToast(page, "Versão A excluída.");
    await expect(abDialog(page).getByRole("listitem")).toHaveCount(1);
    await expect(versionRow(page, "B")).toContainText("Controle");
    await expect(dialog.getByText("1 de 5 versões")).toBeVisible();
    await expect(dialog.getByText("Divisão do tráfego")).toHaveCount(0);
    // A próxima versão não reaproveita logo a letra da excluída (a pasta oferta-a/ era da A antiga).
    await expect(dialog.getByRole("button", { name: "Criar versão C (cópia da B)" })).toBeVisible();

    await dialog.getByRole("button", { name: "Fechar" }).first().click();
    await expect(dialog).toBeHidden();
    await expect(row.getByRole("button", { name: /versões A\/B/ })).toHaveCount(0);

    // "Editar" da página abre a versão que ficou (B), sem seletor (uma versão só).
    await page.getByRole("link", { name: "Editar Página principal", exact: true }).click();
    await waitForEditor(page);
    await expect(page).toHaveURL(bDocUrl);
    await expect(editorCanvas(page).locator("h1")).toHaveText(headlineB);
    await expect(versionSwitcher(page)).toHaveCount(0);
  });

  test("cria versão a partir de um modelo e respeita o limite de 5 versões", async ({ page }) => {
    await createOfferFromTemplate(page, `Oferta A/B limite ${uid()}`, "Upsell");
    await openPageMenu(page, "Página principal");
    await page.getByRole("menuitem", { name: "Teste A/B" }).click();
    const dialog = abDialog(page);

    await dialog.getByRole("button", { name: "Modelo ou outra versão…" }).click();
    await dialog.getByRole("radio", { name: /Modelo pronto ou em branco/ }).click();
    await dialog.getByRole("radio", { name: "VSL" }).click();
    await dialog.getByRole("button", { name: "Criar versão B", exact: true }).click();
    await expect(dialog.getByRole("status").filter({ hasText: "Versão B criada." })).toBeVisible();

    // As próximas num clique só (cópia da versão de controle).
    for (const letter of ["C", "D", "E"]) {
      await dialog.getByRole("button", { name: `Criar versão ${letter} (cópia da A)` }).click();
      await expect(versionRow(page, letter)).toBeVisible();
      await expect(dialog.getByRole("status").filter({ hasText: `Versão ${letter} criada.` })).toBeVisible();
    }
    for (const letter of ["A", "B", "C", "D", "E"]) {
      await expect(versionRow(page, letter)).toContainText("20% do tráfego");
    }
    await expect(dialog.getByRole("button", { name: /Criar versão/ })).toHaveCount(0);
    await expect(dialog.getByText("5 de 5 versões — limite atingido (A a E)")).toBeVisible();

    // A versão B (modelo VSL) é outra página: o título do Upsell não está nela.
    await versionRow(page, "B").getByRole("link", { name: "Editar a versão B" }).click();
    await waitForEditor(page);
    await expect(editorCanvas(page).locator("h1").first()).not.toHaveText(UPSELL_HEADLINE);
    await expect(versionSwitcher(page).getByRole("radio")).toHaveCount(5);
  });

  test("Testar pixels da versão B: escolhe a versão e a página de teste abre nela", async ({ page, context }) => {
    const offerId = await createOffer(page, `Pixels A/B ${uid()}`);
    await openPageMenu(page, "Página principal");
    await page.getByRole("menuitem", { name: "Teste A/B" }).click();
    await abDialog(page).getByRole("button", { name: "Criar versão B (cópia da A)" }).click();
    await expect(versionRow(page, "B")).toBeVisible();

    // Conteúdo de cada versão e o pixel da Meta direto no banco (a tela de pixels é da Fase 4).
    await withE2eDb(async (db) => {
      for (const letter of ["A", "B"]) {
        const updated = await db.query(
          `UPDATE "PageDocument" d SET html = $1, project = NULL, "updatedAt" = now()
             FROM "PageVariant" v JOIN "Page" p ON p.id = v."pageId"
            WHERE d."variantId" = v.id AND p."offerId" = $2 AND p."isHome" AND v.name = $3`,
          [versionHtml(`Conteúdo da versão ${letter}`), offerId, letter],
        );
        expect(updated.rowCount).toBe(1);
      }
      const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.padEnd(25, "0").slice(0, 25);
      await db.query(
        `INSERT INTO "PixelConfig" (id, "offerId", vendor, enabled, "pixelId", options, "createdAt", "updatedAt")
         VALUES ($1, $2, 'META', true, '123456789012345', '{}', now(), now())`,
        [id, offerId],
      );
    });
    // Nada vai para a internet (o script da Meta só carregaria depois do "Aceitar").
    await context.route(
      (url) => !(url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname === "127.0.0.1"),
      (route) => route.abort(),
    );

    await page.goto(`/ofertas/${offerId}/testar-pixels`);
    const version = page.getByRole("combobox", { name: "Versão para testar" });
    await expect(version).toHaveText("Versão A (controle)");
    await version.click();
    await page.getByRole("option", { name: "Versão B" }).click();
    await expect(version).toHaveText("Versão B");

    await page.getByRole("button", { name: "Iniciar teste" }).click();
    const open = page.getByRole("link", { name: "Abrir página de teste" });
    await expect(open).toBeVisible();
    await expect(page.getByRole("region", { name: "Controle do teste" })).toContainText(
      "Página: Página principal · Versão B · vence em",
    );
    const [testPage] = await Promise.all([context.waitForEvent("page"), open.click()]);
    await testPage.waitForLoadState("domcontentloaded");
    await expect(testPage.getByRole("heading", { level: 1 })).toHaveText("Conteúdo da versão B");
    await testPage.close();
  });
});
