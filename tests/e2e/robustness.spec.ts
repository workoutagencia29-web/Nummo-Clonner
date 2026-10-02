import { expect, type Page, test } from "@playwright/test";
import { createOffer, uid } from "./helpers";

/** Guarda erros do console e exceções da página (ignora o aviso do React DevTools). */
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/React DevTools/i.test(text)) return;
    errors.push(`[console] ${text}`);
  });
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
  return errors;
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(doc.scrollWidth, document.body.scrollWidth) - doc.clientWidth;
  });
}

const SCREENS = [
  { path: "/ofertas", heading: "Ofertas" },
  { path: "/lixeira", heading: "Lixeira" },
  { path: "/configuracoes", heading: "Configurações" },
];

test.describe("Robustez", () => {
  test("as telas principais abrem sem erros no console", async ({ page }) => {
    const name = `Oferta Console ${uid()}`;
    const id = await createOffer(page, name);
    const errors = collectErrors(page);

    for (const screen of [...SCREENS, { path: `/ofertas/${id}`, heading: name }]) {
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1, name: screen.heading })).toBeVisible();
      await page.waitForLoadState("networkidle");
    }
    // Também a aba "Detalhes" da oferta.
    await page.getByRole("tab", { name: "Detalhes" }).click();
    await expect(page.getByRole("textbox", { name: "Onde está no ar" })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test.describe("no celular (390px)", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("nenhuma tela rola para os lados", async ({ page }) => {
      const name = `Oferta Celular Com Um Nome Bem Comprido Para Testar Quebra ${uid()}`;
      const errors = collectErrors(page);
      await page.goto("/ofertas");
      await page.getByRole("button", { name: "Abrir menu" }).click();
      await page.getByRole("dialog", { name: "Menu" }).getByRole("button", { name: "Nova oferta" }).click();
      const dialog = page.getByRole("dialog", { name: "Nova oferta" });
      await dialog.getByLabel("Nome da oferta").fill(name);
      await dialog.getByRole("button", { name: "Criar oferta" }).click();
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      const id = new URL(page.url()).pathname.split("/").at(-1);

      for (const screen of [...SCREENS, { path: `/ofertas/${id}`, heading: name }]) {
        await page.goto(screen.path);
        await expect(page.getByRole("heading", { level: 1, name: screen.heading })).toBeVisible();
        await expect(page.getByRole("complementary")).toBeHidden();
        expect(await horizontalOverflow(page), `rolagem horizontal em ${screen.path}`).toBeLessThanOrEqual(0);
      }
      expect(errors).toEqual([]);
    });

    test("o menu 'Abrir menu' abre e navega", async ({ page }) => {
      await page.goto("/ofertas");
      const menuButton = page.getByRole("button", { name: "Abrir menu" });
      await expect(menuButton).toBeVisible();

      await menuButton.click();
      const sheet = page.getByRole("dialog", { name: "Menu" });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole("link", { name: /Todas as ofertas/ })).toHaveAttribute("aria-current", "page");
      await sheet.getByRole("link", { name: /Lixeira/ }).click();
      await expect(page).toHaveURL(/\/lixeira$/);
      await expect(sheet).toBeHidden();
      await expect(page.getByRole("heading", { level: 1, name: "Lixeira" })).toBeVisible();

      await menuButton.click();
      await expect(sheet.getByRole("link", { name: /Lixeira/ })).toHaveAttribute("aria-current", "page");
      await sheet.getByRole("link", { name: "Configurações" }).click();
      await expect(page).toHaveURL(/\/configuracoes$/);
      await expect(sheet).toBeHidden();
      await expect(page.getByRole("heading", { level: 1, name: "Configurações" })).toBeVisible();

      // Fecha pelo botão "Fechar" sem navegar.
      await menuButton.click();
      await expect(sheet).toBeVisible();
      await sheet.getByRole("button", { name: "Fechar" }).click();
      await expect(sheet).toBeHidden();
      await expect(page).toHaveURL(/\/configuracoes$/);
    });
  });
});
