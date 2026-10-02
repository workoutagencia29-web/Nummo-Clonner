import { expect, type Page, test } from "@playwright/test";
import { expectToast, sidebar, uid } from "./helpers";
import { TEST_USER } from "./test-user";

const THEME_COOKIE = "offerstudio-theme";

async function themeCookie(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === THEME_COOKIE)?.value;
}

function userMenuTrigger(page: Page) {
  return sidebar(page).getByRole("button", { name: TEST_USER.email });
}

test.describe("Configurações", () => {
  test("tema escolhido em Configurações vale na hora e continua depois de recarregar", async ({ page }) => {
    await page.goto("/configuracoes");
    const html = page.locator("html");
    const themes = page.getByRole("radiogroup", { name: "Tema" });
    await expect(themes.getByRole("radio", { name: "Igual ao sistema" })).toHaveAttribute("aria-checked", "true");

    await themes.getByRole("radio", { name: "Escuro" }).click();
    await expect(html).toHaveClass(/\bdark\b/);
    await expect(themes.getByRole("radio", { name: "Escuro" })).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => themeCookie(page)).toBe("dark");
    await page.reload();
    await expect(html).toHaveClass(/\bdark\b/);
    await expect(themes.getByRole("radio", { name: "Escuro" })).toHaveAttribute("aria-checked", "true");

    await themes.getByRole("radio", { name: "Claro" }).click();
    await expect(html).toHaveClass(/\blight\b/);
    await expect(html).not.toHaveClass(/\bdark\b/);
    await expect.poll(() => themeCookie(page)).toBe("light");
    await page.reload();
    await expect(html).toHaveClass(/\blight\b/);
    await expect(themes.getByRole("radio", { name: "Claro" })).toHaveAttribute("aria-checked", "true");

    // Outras telas também abrem com o tema escolhido.
    await page.goto("/ofertas");
    await expect(html).toHaveClass(/\blight\b/);

    // "Igual ao sistema" segue o tema do sistema operacional.
    await page.goto("/configuracoes");
    await themes.getByRole("radio", { name: "Igual ao sistema" }).click();
    await expect(html).toHaveClass(/\bsystem\b/);
    await expect.poll(() => themeCookie(page)).toBe("system");
    const colorScheme = () => html.evaluate((el) => getComputedStyle(el).colorScheme);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(colorScheme).toBe("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(colorScheme).toBe("light");
  });

  test("tema pelo menu do usuário", async ({ page }) => {
    await page.goto("/ofertas");
    const html = page.locator("html");

    await userMenuTrigger(page).click();
    await page.getByRole("menuitemradio", { name: "Escuro" }).click();
    await expect(html).toHaveClass(/\bdark\b/);
    await expect.poll(() => themeCookie(page)).toBe("dark");

    await userMenuTrigger(page).click();
    await expect(page.getByRole("menuitemradio", { name: "Escuro" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    await page.reload();
    await expect(html).toHaveClass(/\bdark\b/);

    // Trocado pelo menu enquanto Configurações está aberta, a escolha da tela acompanha.
    await page.goto("/configuracoes");
    const themes = page.getByRole("radiogroup", { name: "Tema" });
    await expect(themes.getByRole("radio", { name: "Escuro" })).toHaveAttribute("aria-checked", "true");
    await userMenuTrigger(page).click();
    await page.getByRole("menuitemradio", { name: "Claro" }).click();
    await expect(html).toHaveClass(/\blight\b/);
    await expect.poll(() => themeCookie(page)).toBe("light");
    await expect(themes.getByRole("radio", { name: "Claro" })).toHaveAttribute("aria-checked", "true");
    await expect(themes.getByRole("radio", { name: "Escuro" })).toHaveAttribute("aria-checked", "false");
    await page.reload();
    await expect(html).toHaveClass(/\blight\b/);
  });

  test("muda o nome da conta e ele aparece no menu do usuário", async ({ page }) => {
    const newName = `Marketeiro ${uid()}`;
    await page.goto("/configuracoes");
    const nameInput = page.getByLabel("Nome", { exact: true });
    const save = page.getByRole("button", { name: "Salvar conta" });
    await expect(nameInput).toHaveValue(TEST_USER.name);
    await expect(page.getByLabel("E-mail", { exact: true })).toHaveValue(TEST_USER.email);
    await expect(save).toBeDisabled();

    // Validações do formulário.
    await nameInput.fill("");
    await save.click();
    await expect(page.getByText("Digite seu nome.")).toBeVisible();
    await nameInput.fill(TEST_USER.name);
    await page.getByLabel("E-mail", { exact: true }).fill("sem-arroba");
    await save.click();
    await expect(page.getByText("Digite um e-mail válido.")).toBeVisible();
    await page.getByLabel("E-mail", { exact: true }).fill(TEST_USER.email);
    await expect(save).toBeDisabled();

    try {
      await nameInput.fill(newName);
      await save.click();
      await expectToast(page, "Conta atualizada.");
      await expect(userMenuTrigger(page)).toContainText(newName);
      await page.reload();
      await expect(nameInput).toHaveValue(newName);
      await expect(userMenuTrigger(page)).toContainText(newName);
      await expect(userMenuTrigger(page)).toContainText(TEST_USER.email);
    } finally {
      // Devolve o nome original (outros testes não dependem dele, mas fica limpo).
      await page.goto("/configuracoes");
      await nameInput.fill(TEST_USER.name);
      if (await save.isEnabled()) {
        await save.click();
        await expectToast(page, "Conta atualizada.");
      }
    }
    await expect(userMenuTrigger(page)).toContainText(TEST_USER.name);
  });

  test("trocar senha com a senha atual errada mostra erro em português", async ({ page }) => {
    await page.goto("/configuracoes");
    const current = page.getByLabel("Senha atual");
    const next = page.getByLabel("Nova senha", { exact: true });
    const confirm = page.getByLabel("Confirme a nova senha");
    const submit = page.getByRole("button", { name: "Trocar senha" });
    await expect(submit).toBeDisabled();

    // Validações locais (não chegam ao servidor).
    await current.fill("qualquer-coisa");
    await next.fill("curta");
    await confirm.fill("outra");
    await submit.click();
    await expect(page.getByText("A nova senha precisa ter pelo menos 8 caracteres.")).toBeVisible();
    await expect(page.getByText("As senhas não são iguais.")).toBeVisible();

    await current.fill(`errada-${uid()}`);
    await next.fill("NovaSenha-Forte-123");
    await confirm.fill("NovaSenha-Forte-123");
    await submit.click();
    await expect(page.getByText("Senha atual incorreta.")).toBeVisible();
    await expect(current).toHaveAttribute("aria-invalid", "true");

    // A sessão continua válida (a senha não mudou).
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Configurações" })).toBeVisible();
  });
});
