import { expect, type Locator, type Page } from "@playwright/test";

/** Sufixo único para os nomes criados em cada teste (os testes não dependem uns dos outros). */
export function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Menu lateral do painel (no desktop). */
export function sidebar(page: Page) {
  return page.getByRole("complementary");
}

/** Notificação (toast do sonner) com o texto indicado. */
export function toast(page: Page, text: string | RegExp) {
  return page
    .getByRole("region", { name: /Notificações/ })
    .getByText(text, typeof text === "string" ? { exact: true } : undefined)
    .first();
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(toast(page, text)).toBeVisible();
}

/** Abre o diálogo "Nova oferta" pelo menu lateral, preenche o nome e cria. Devolve o id da oferta. */
export async function createOffer(page: Page, name: string, opts: { from?: string } = {}) {
  if (opts.from !== undefined || !/\/ofertas|\/lixeira|\/configuracoes/.test(page.url())) {
    await page.goto(opts.from ?? "/ofertas");
  }
  await sidebar(page).getByRole("button", { name: "Nova oferta" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova oferta" });
  await dialog.getByLabel("Nome da oferta").fill(name);
  // A galeria já vem com a página de vendas: os testes partem de uma página em branco.
  await dialog.getByRole("radio", { name: "Em branco", exact: true }).click();
  await dialog.getByRole("button", { name: "Criar oferta" }).click();
  await expect(page).toHaveURL(/\/ofertas\/[^/?]+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return offerIdFromUrl(page);
}

export function offerIdFromUrl(page: Page) {
  const id = new URL(page.url()).pathname.split("/").at(-1);
  if (!id) throw new Error(`URL sem id de oferta: ${page.url()}`);
  return id;
}

/** Card de uma oferta no painel (pelo link "Abrir <nome>", nome exato). */
export function offerCard(page: Page, name: string): Locator {
  return page.locator("article").filter({ has: page.getByRole("link", { name: `Abrir ${name}`, exact: true }) });
}

/** Abre o menu "⋯" do card de uma oferta. */
export async function openCardMenu(page: Page, name: string) {
  const card = offerCard(page, name);
  await card.hover();
  await card.getByRole("button", { name: `Ações de ${name}`, exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** Escolhe uma opção num submenu do menu da oferta (ex.: "Status" → "No ar"). */
export async function chooseInSubmenu(page: Page, submenu: string, option: string) {
  await page.getByRole("menuitem", { name: submenu }).click();
  await page.getByRole("menuitemradio", { name: option, exact: true }).click();
}

/** Escolhe um valor num Select (Radix) identificado pelo nome acessível. */
export async function selectOption(scope: Page | Locator, page: Page, combobox: string, option: string) {
  await scope.getByRole("combobox", { name: combobox }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** Linhas da lista de páginas do funil (tela da oferta; o "Próximos passos" também é uma lista). */
export function pageRows(page: Page) {
  return page.getByRole("list", { name: "Páginas do funil" }).getByRole("listitem");
}

export function pageRow(page: Page, name: string) {
  return pageRows(page).filter({ has: page.getByRole("button", { name: `Arrastar ${name}`, exact: true }) });
}

/** Abre o menu "⋯" de uma página do funil. */
export async function openPageMenu(page: Page, name: string) {
  await page.getByRole("button", { name: `Ações da página ${name}`, exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** Adiciona uma página pelo botão "Adicionar página". */
export async function addPage(page: Page, name: string, opts: { slug?: string; type?: string } = {}) {
  await page.getByRole("button", { name: "Adicionar página" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova página" });
  await dialog.getByLabel("Nome", { exact: true }).fill(name);
  if (opts.slug !== undefined) await dialog.getByLabel("Endereço da página").fill(opts.slug);
  if (opts.type) await selectOption(dialog, page, "Tipo", opts.type);
  await dialog.getByRole("button", { name: "Criar página" }).click();
  await expect(dialog).toBeHidden();
  await expect(pageRow(page, name)).toBeVisible();
}

/** Resposta de uma server action (POST com cabeçalho Next-Action). */
export function waitForServerAction(page: Page) {
  return page.waitForResponse((r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]));
}

// ─── Editor visual ───────────────────────────────────────────────────────────

/** Cria uma oferta pelo menu lateral com a primeira página vinda de um modelo (galeria "Primeira página"). Devolve o id. */
export async function createOfferFromTemplate(page: Page, name: string, template: string) {
  await page.goto("/ofertas");
  await sidebar(page).getByRole("button", { name: "Nova oferta" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova oferta" });
  await dialog.getByLabel("Nome da oferta").fill(name);
  await dialog
    .getByRole("radiogroup", { name: "Primeira página" })
    .getByRole("radio", { name: template, exact: true })
    .click();
  await dialog.getByRole("button", { name: "Criar oferta" }).click();
  await expect(page).toHaveURL(/\/ofertas\/[^/?]+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return offerIdFromUrl(page);
}

/** Canvas do editor (iframe do GrapesJS). */
export function editorCanvas(page: Page) {
  return page.frameLocator("iframe.gjs-frame");
}

/**
 * Situação do salvamento na barra do editor ("Salvo às 10:42", "Salvando…"…).
 * Pela tag (e não pelo papel "banner"): com um diálogo aberto, o resto da tela
 * sai da árvore de acessibilidade, mas o texto continua lá.
 */
export function saveStatus(page: Page) {
  return page.locator("header").getByText(/^(Salvo|Salvando…|Alterações não salvas|Conflito ao salvar|Erro ao salvar)/);
}

/** Bloco do painel "Blocos" (pelo nome que aparece no card). */
export function editorBlock(page: Page, label: string) {
  return page.getByRole("tabpanel", { name: "Blocos" }).getByTitle(label, { exact: true });
}

/** Espera o editor ficar pronto: canvas carregado e tudo salvo. */
export async function waitForEditor(page: Page) {
  await expect(page).toHaveURL(/\/editor\/[^/?]+$/);
  await expect(page.getByRole("button", { name: "Modo prévia" })).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator("iframe.gjs-frame")).toBeVisible();
  await expect(editorCanvas(page).locator("body")).toBeAttached();
  await expect(saveStatus(page)).toHaveText(/^Salvo/);
}

/** Abre o editor de uma página pelo botão "Editar" da tela da oferta. */
export async function openEditor(page: Page, pageName: string) {
  await page.getByRole("link", { name: `Editar ${pageName}`, exact: true }).click();
  await waitForEditor(page);
}

/** Documento salvo pelo editor (PUT /api/documents/<id>). */
export function waitForDocumentSave(page: Page) {
  return page.waitForResponse(
    (r) => r.request().method() === "PUT" && /^\/api\/documents\/[^/]+$/.test(new URL(r.url()).pathname),
  );
}

/** Faz uma alteração e espera o salvamento automático terminar ("Salvo"). */
export async function expectAutosave(page: Page, action: () => Promise<unknown>) {
  const saved = waitForDocumentSave(page);
  await action();
  expect((await saved).ok()).toBe(true);
  await expect(saveStatus(page)).toHaveText(/^Salvo/);
}

/**
 * Edita um texto direto no canvas: dois cliques, seleciona tudo e digita.
 * Clicar em `done` (outro elemento) termina a edição, como o usuário faria.
 */
export async function editCanvasText(page: Page, target: Locator, text: string, done: Locator) {
  await target.dblclick();
  await expect(target).toHaveAttribute("contenteditable", "true");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
  await done.click();
  await expect(target).not.toHaveAttribute("contenteditable", "true");
}
