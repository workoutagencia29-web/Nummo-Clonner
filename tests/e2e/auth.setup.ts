import { expect, test as setup } from "@playwright/test";
import { TEST_USER } from "./test-user";

/** Primeiro acesso: cria a conta de teste e guarda a sessão para os outros testes. */
setup("primeiro acesso cria a conta e entra no painel", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/entrar/);
  await expect(page.getByText("Crie seu acesso")).toBeVisible();

  await page.getByLabel("Seu nome").fill(TEST_USER.name);
  await page.getByLabel("E-mail").fill(TEST_USER.email);
  await page.getByLabel("Senha", { exact: true }).fill(TEST_USER.password);
  await page.getByLabel("Confirme a senha").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Criar acesso e entrar" }).click();

  await expect(page).toHaveURL(/\/ofertas$/);
  await expect(page.getByRole("heading", { name: "Ofertas" })).toBeVisible();
  await page.context().storageState({ path: "tests/.auth/user.json" });
});
