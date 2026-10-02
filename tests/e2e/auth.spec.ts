import { expect, type Page, test } from "@playwright/test";
import { expectToast, uid } from "./helpers";
import { TEST_USER } from "./test-user";

/**
 * Login e sessão. Roda por último (projeto "auth", sem sessão salva) porque o
 * último teste estoura o limite de tentativas de login (5 por minuto, um só
 * "balde" para a máquina inteira).
 *
 * Tentativas de login antes do teste do limite: 4 (1 errada + 3 certas).
 */

const LOGIN_ERROR = "E-mail ou senha incorretos.";
const RATE_LIMITED = "Muitas tentativas. Aguarde um minuto e tente de novo.";

function signInForm(page: Page) {
  return {
    email: page.getByLabel("E-mail"),
    password: page.getByLabel("Senha", { exact: true }),
    submit: page.getByRole("button", { name: "Entrar" }),
    alert: page.locator("form").getByRole("alert"),
  };
}

async function expectSignInScreen(page: Page) {
  await expect(page.getByText("Use o e-mail e a senha que você cadastrou.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  await expect(page.getByText("Crie seu acesso")).toHaveCount(0);
  await expect(page.getByLabel("Confirme a senha")).toHaveCount(0);
}

async function signIn(page: Page, password = TEST_USER.password) {
  const form = signInForm(page);
  await form.email.fill(TEST_USER.email);
  await form.password.fill(password);
  await form.submit.click();
}

async function signOut(page: Page) {
  await page.getByRole("complementary").getByRole("button", { name: TEST_USER.email }).click();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await expectSignInScreen(page);
}

async function changePassword(page: Page, current: string, next: string) {
  await page.goto("/configuracoes");
  await page.getByLabel("Senha atual").fill(current);
  await page.getByLabel("Nova senha", { exact: true }).fill(next);
  await page.getByLabel("Confirme a nova senha").fill(next);
  await page.getByRole("button", { name: "Trocar senha" }).click();
  await expectToast(page, "Senha alterada.");
  await expect(page.getByLabel("Senha atual")).toHaveValue("");
}

test.describe("Login", () => {
  test("sem login, as telas do painel mandam para /entrar guardando o destino", async ({ page }) => {
    await page.goto("/ofertas");
    await expect(page).toHaveURL(/\/entrar\?voltar=%2Fofertas$/);
    await expectSignInScreen(page);

    await page.goto("/configuracoes");
    await expect(page).toHaveURL(/\/entrar\?voltar=%2Fconfiguracoes$/);

    await page.goto("/");
    await expect(page).toHaveURL(/\/entrar$/);
    await expectSignInScreen(page);
  });

  test("senha errada mostra erro em português", async ({ page }) => {
    await page.goto("/entrar");
    const form = signInForm(page);

    // Validações locais (não contam como tentativa).
    await form.email.fill("nao-e-email");
    await form.password.fill("curta");
    await form.submit.click();
    await expect(page.getByText("Digite um e-mail válido.")).toBeVisible();
    await expect(page.getByText("A senha precisa ter pelo menos 8 caracteres.")).toBeVisible();

    await signIn(page, `errada-${uid()}`);
    await expect(form.alert).toHaveText(LOGIN_ERROR);
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test("login correto volta para a tela pedida e 'Sair' encerra a sessão", async ({ page }) => {
    await page.goto("/lixeira");
    await expect(page).toHaveURL(/\/entrar\?voltar=%2Flixeira$/);
    await signIn(page);
    await expect(page).toHaveURL(/\/lixeira$/);
    await expect(page.getByRole("heading", { level: 1, name: "Lixeira" })).toBeVisible();

    // Logado, /entrar leva direto ao painel.
    await page.goto("/entrar");
    await expect(page).toHaveURL(/\/ofertas$/);
    await expect(page.getByRole("heading", { level: 1, name: "Ofertas" })).toBeVisible();

    await signOut(page);
    await page.goto("/ofertas");
    await expect(page).toHaveURL(/\/entrar\?voltar=%2Fofertas$/);
  });

  test("um segundo cadastro é recusado", async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? "http://localhost:3200").origin;
    const res = await page.request.post("/api/auth/sign-up/email", {
      headers: { Origin: origin },
      data: { name: "Intruso", email: `intruso-${uid()}@offerstudio.test`, password: "Senha-Do-Intruso-123" },
    });
    expect(res.ok()).toBe(false);
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ code: "SINGLE_USER_ONLY" });
    // Nenhum cookie de sessão foi entregue.
    expect((await page.context().cookies()).filter((c) => c.name.includes("session"))).toHaveLength(0);

    await page.goto("/entrar");
    await expectSignInScreen(page);
  });

  test("troca a senha, entra com a nova e volta para a original", async ({ page }) => {
    const newPassword = `Nova-Senha-${uid()}`;

    // Um "voltar" para fora do app é ignorado.
    await page.goto("/entrar?voltar=%2F%2Fexample.com");
    await signIn(page);
    await expect(page).toHaveURL(/^http:\/\/localhost:3200\/ofertas$/);

    await changePassword(page, TEST_USER.password, newPassword);
    await signOut(page);
    await signIn(page, newPassword);
    await expect(page).toHaveURL(/\/ofertas$/);
    await changePassword(page, newPassword, TEST_USER.password);
  });

  // Deixe este por último: bloqueia o login por 1 minuto.
  test("limite de tentativas: depois de várias senhas erradas o login é bloqueado", async ({ page }) => {
    await page.goto("/entrar");
    const form = signInForm(page);
    const statuses: number[] = [];

    for (let attempt = 1; attempt <= 6; attempt++) {
      const response = page.waitForResponse((r) => r.url().includes("/api/auth/sign-in/email"));
      await signIn(page, `errada-${attempt}-${uid()}`);
      statuses.push((await response).status());
      await expect(form.alert).toHaveText(statuses.at(-1) === 429 ? RATE_LIMITED : LOGIN_ERROR);
      await expect(form.submit).toBeEnabled();
    }

    // Erradas (401) até o limite, depois bloqueado (429) — nunca volta a liberar no mesmo minuto.
    const firstBlocked = statuses.indexOf(429);
    expect(firstBlocked, `respostas: ${statuses.join(", ")}`).toBeGreaterThanOrEqual(0);
    expect(statuses.slice(0, firstBlocked).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(firstBlocked).every((s) => s === 429)).toBe(true);
    await expect(form.alert).toHaveText(RATE_LIMITED);

    // Até a senha certa é recusada enquanto o bloqueio durar.
    await signIn(page);
    await expect(form.alert).toHaveText(RATE_LIMITED);
    await expect(page).toHaveURL(/\/entrar$/);

    // Trocar o X-Forwarded-For não escapa do bloqueio (o app ignora esse cabeçalho).
    for (const ip of ["10.0.0.1", "203.0.113.7"]) {
      const res = await page.request.post("/api/auth/sign-in/email", {
        headers: { "X-Forwarded-For": ip, Origin: "http://localhost:3200" },
        data: { email: TEST_USER.email, password: TEST_USER.password },
      });
      expect(res.status(), `X-Forwarded-For ${ip}`).toBe(429);
    }
  });
});
