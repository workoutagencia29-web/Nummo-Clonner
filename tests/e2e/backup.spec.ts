import { expect, test } from "@playwright/test";
import { createOffer, expectToast, offerCard, uid } from "./helpers";
import { TEST_USER } from "./test-user";

/**
 * Backup (Fase 6): Configurações → "Fazer backup agora" → o arquivo aparece na
 * lista → restaurar (com "RESTAURAR" digitado) → entrar de novo com a conta do
 * backup → as ofertas voltam ao que eram no backup.
 *
 * Os backups do E2E vão para <DATA_DIR>/backup-home (banco de teste), nunca
 * para a pasta Documentos de quem usa o Mac.
 */
test.describe("Backup", () => {
  test("fazer backup agora, aparece na lista e restaurar traz os dados de volta", async ({ page }) => {
    test.setTimeout(180_000);
    const kept = `Oferta do backup ${uid()}`;
    const later = `Criada depois do backup ${uid()}`;
    await createOffer(page, kept);

    await page.goto("/configuracoes");
    const card = page.locator("#backup");
    await expect(card.getByText("O que vai no backup")).toBeVisible();
    await expect(card.getByText(/tokens dos pixels/)).toBeVisible();
    await expect(card.getByRole("radio", { name: /Documentos › Offer Studio Backups/ })).toBeChecked();

    // Fazer backup agora → andamento → pronto → aparece na lista.
    await card.getByRole("button", { name: "Fazer backup agora" }).click();
    await expectToast(
      page,
      /^Backup concluído: offer-studio-backup-\d{4}-\d{2}-\d{2}-\d{4}(-[0-9a-f]{5})?(-\d+)?\.zip\.$/,
    );
    const list = card.getByRole("list", { name: "Backups encontrados" });
    const newest = list.getByRole("listitem").first();
    await expect(newest).toContainText("Manual");
    await expect(newest).toContainText(/hoje às \d{2}:\d{2}/);
    await expect(card.getByText(/^Último backup: hoje às/)).toBeVisible();
    // O card "Sistema" mostra a saúde do backup.
    await expect(page.locator("#sistema").getByText("Backup em dia")).toBeVisible();

    // Depois do backup, mais uma oferta (que a restauração tem que tirar).
    await createOffer(page, later, { from: "/ofertas" });

    await page.goto("/configuracoes");
    await card
      .getByRole("list", { name: "Backups encontrados" })
      .getByRole("listitem")
      .first()
      .getByRole("button", { name: /^Restaurar backup de/ })
      .click();
    const confirm = page.getByRole("dialog", { name: "Restaurar este backup?" });
    await expect(confirm).toContainText(TEST_USER.email);
    await expect(confirm).toContainText("backup de segurança");
    const go = confirm.getByRole("button", { name: "Restaurar backup" });
    await expect(go).toBeDisabled();
    await confirm.getByLabel("Digite RESTAURAR para confirmar").fill("restaura");
    await expect(go).toBeDisabled();
    await confirm.getByLabel("Digite RESTAURAR para confirmar").fill("RESTAURAR");
    await go.click();

    // Tela bloqueada com o andamento até terminar.
    const done = page.getByRole("dialog", { name: "Backup restaurado" });
    await expect(done).toBeVisible({ timeout: 90_000 });
    await expect(done).toContainText(TEST_USER.email);
    await done.getByRole("button", { name: "Ir para a tela de entrada" }).click();

    // As sessões foram encerradas: entra de novo com a conta do backup.
    await expect(page).toHaveURL(/\/entrar/);
    await expect(page.getByText("Use o e-mail e a senha que você cadastrou.")).toBeVisible();
    await page.getByLabel("E-mail").fill(TEST_USER.email);
    await page.getByLabel("Senha", { exact: true }).fill(TEST_USER.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/ofertas$/);
    // Os outros testes usam a sessão nova.
    await page.context().storageState({ path: "tests/.auth/user.json" });

    await expect(offerCard(page, kept)).toBeVisible();
    await expect(offerCard(page, later)).toHaveCount(0);

    // O backup de segurança (estado de antes) ficou na lista, como o mais novo.
    // (A pasta de backups do E2E sobrevive entre execuções: pode haver outros mais antigos.)
    await page.goto("/configuracoes");
    const safety = page
      .locator("#backup")
      .getByRole("list", { name: "Backups encontrados" })
      .getByRole("listitem")
      .first();
    await expect(safety).toContainText("Antes de restaurar");
  });
});
