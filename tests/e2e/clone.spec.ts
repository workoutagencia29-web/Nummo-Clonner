import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Clonagem pela tela, com os sites de teste locais (ligados pelo
 * scripts/e2e-server.ts em *.fixture.test:4556).
 */
const FIXTURE = (site: string, p = "/") => `http://${site}.fixture.test:4556${p}`;

test.describe("clonar oferta", () => {
  test.describe.configure({ timeout: 240_000 });

  test("link → progresso → revisão com prévia → funil → salvar", async ({ page }) => {
    await page.goto("/ofertas");
    await page.getByRole("complementary").getByRole("link", { name: "Clonar oferta" }).click();
    await expect(page).toHaveURL(/\/clonar$/);

    await page.getByLabel("Link da página").fill(FIXTURE("vendas"));
    await page.getByRole("button", { name: "Clonar página" }).click();
    await expect(page).toHaveURL(/\/clonar\/[a-z0-9]+$/);
    await expect(page.getByRole("heading", { name: "Revisar cópia" })).toBeVisible({ timeout: 120_000 });

    // Prévia isolada (outra origem) mostrando a cópia.
    const preview = page.frameLocator('iframe[title^="Prévia da cópia"]');
    await expect(preview.getByText("Transforme sua cozinha")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("2 checkouts")).toBeVisible();
    await expect(page.getByText("https://pay.hotmart.com/A12345678B?off=abc123&checkoutMode=10")).toBeVisible();

    // Troca para celular e para "Original" (print).
    await page.getByRole("radio", { name: "Celular" }).click();
    await expect(page.locator('iframe[title="Prévia da cópia (celular)"]')).toBeVisible();
    await page.getByRole("radio", { name: "Original" }).click();
    await expect(page.getByRole("img", { name: "Print da página original" })).toBeVisible();

    // Clona o upsell sugerido e inclui na oferta.
    await page.getByRole("checkbox", { name: /Kit Festas Lucrativas/ }).click();
    await page.getByRole("button", { name: "Clonar páginas selecionadas" }).click();
    const save = page.getByRole("button", { name: "Salvar oferta" });
    await expect(save).toBeEnabled({ timeout: 120_000 });

    const name = `Confeitaria ${Date.now()}`;
    await page.getByLabel("Nome da oferta").fill(name);
    await save.click();
    await expect(page).toHaveURL(/\/ofertas\/[a-z0-9]+$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("Início do site (/)")).toBeVisible();
    await expect(page.getByText("/upsell/")).toBeVisible();
  });

  test("página protegida: mensagem clara, print e 'Tentar de novo'", async ({ page }) => {
    await page.goto("/clonar");
    await page.getByLabel("Link da página").fill(FIXTURE("protegido"));
    await page.getByRole("button", { name: "Clonar página" }).click();
    await expect(page.getByRole("heading", { name: "Não foi possível clonar" })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/proteção contra robôs/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
    // O passo a passo aparece uma vez (arquivo .html + pasta “_files”) e leva direto à aba do ZIP.
    await expect(page.getByText(/Página da Web, completa/)).toHaveCount(1);
    await expect(page.getByText(/Selecione os dois juntos/)).toBeVisible();
    await page.getByRole("link", { name: "Importar ZIP" }).click();
    await expect(page).toHaveURL(/\/clonar\?aba=zip$/);
    await expect(page.getByRole("tab", { name: "Arquivo ZIP" })).toHaveAttribute("aria-selected", "true");
  });

  test("funil: cancelar uma página que ainda está na fila e tentar de novo", async ({ page }) => {
    await page.goto("/clonar");
    await page.getByLabel("Link da página").fill(FIXTURE("vendas"));
    await page.getByRole("button", { name: "Clonar página" }).click();
    await expect(page.getByRole("heading", { name: "Revisar cópia" })).toBeVisible({ timeout: 120_000 });

    // Duas páginas do funil: o upsell sugerido e, depois dele na fila, uma página colada.
    const lento = FIXTURE("lento");
    // (O nome da página do upsell também tem "Kit Festas Lucrativas": a sugestão começa com "Upsell".)
    const suggestion = page.getByRole("checkbox", { name: /^Upsell · Kit Festas Lucrativas/ });
    await suggestion.click();
    await page.getByLabel("Link de outra página do funil").fill(lento);
    await page.getByRole("button", { name: "Clonar páginas selecionadas" }).click();
    const save = page.getByRole("button", { name: /Salvar oferta|Aguardando páginas do funil/ });
    await expect(save).toBeDisabled();

    // Não precisa esperar: cancela a página colada.
    await page.getByRole("button", { name: `Cancelar ${lento}` }).click();
    await expect(page.getByText("Cancelada", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Salvar oferta" })).toBeEnabled({ timeout: 120_000 });

    // A sugestão do upsell continua marcada (já clonada); a cancelada pode voltar para a fila.
    await expect(suggestion).toBeDisabled();
    await page.getByRole("button", { name: `Tentar de novo ${lento}` }).click();
    await expect(page.getByText("Cancelada", { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Salvar oferta" })).toBeEnabled({ timeout: 120_000 });
    await expect(page.getByText(/3 páginas no funil/)).toBeVisible();
  });

  test("link inválido mostra erro em português sem sair da tela", async ({ page }) => {
    await page.goto("/clonar");
    await page.getByLabel("Link da página").fill("isso não é um link");
    await page.getByRole("button", { name: "Clonar página" }).click();
    await expect(page.getByText(/não parece válido/)).toBeVisible();
    await expect(page).toHaveURL(/\/clonar$/);
  });

  test("importar ZIP salvo pelo navegador", async ({ page }) => {
    await page.goto("/clonar");
    await page.getByRole("tab", { name: "Arquivo ZIP" }).click();
    await page.locator("#clone-zip").setInputFiles(path.join(process.cwd(), "tests/fixtures/zips/good.zip"));
    await page.getByRole("button", { name: "Importar ZIP" }).click();
    await expect(page.getByRole("heading", { name: "Revisar cópia" })).toBeVisible({ timeout: 120_000 });
  });

  test("colar HTML", async ({ page }) => {
    await page.goto("/clonar");
    await page.getByRole("tab", { name: "Colar HTML" }).click();
    await page
      .getByLabel("Código HTML")
      .fill(
        '<!doctype html><html lang="pt-BR"><head><title>Oferta colada</title></head><body><h1>Página colada</h1><a href="https://pay.kiwify.com.br/Colado1">Comprar agora</a></body></html>',
      );
    await page.getByRole("button", { name: "Importar HTML" }).click();
    await expect(page.getByRole("heading", { name: "Revisar cópia" })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText("https://pay.kiwify.com.br/Colado1")).toBeVisible();
    const preview = page.frameLocator('iframe[title^="Prévia da cópia"]');
    await expect(preview.getByRole("heading", { name: "Página colada" })).toBeVisible();
  });
});
