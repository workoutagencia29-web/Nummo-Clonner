/**
 * Janela "Adicionar funil Quiz → Roleta" (Fase 2B) num Chromium de verdade:
 * página de vendas (padrão: a inicial), prêmios prontos (tirar, adicionar,
 * chance mínima de 1%), conferência dos links antes de mandar, aviso de funil
 * que já existe, erro do servidor no campo certo e o resultado com "Abrir o
 * quiz no editor", "Ver o funil" e o que falta preencher. As server actions são
 * de mentira (registram o que foi pedido).
 */
import path from "node:path";
import { build, type Plugin } from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { FunnelDialog } from "@/components/offers/funnel-dialog";
let root = null;
window.open = (url) => { (window.__opened = window.__opened || []).push(url); return null; };
window.OS = {
  render(props) {
    root = root || createRoot(document.getElementById("root"));
    root.render(createElement(FunnelDialog, { ...props, open: true, onOpenChange: (o) => (window.__open = o) }));
  },
};
`;

const ACTIONS = `
const rec = (name, input) => (window.__calls = window.__calls || []).push({ name, input });
export const createQuizWheelFunnelAction = async (input) => {
  rec("createQuizWheelFunnelAction", input);
  return window.__funnelReply || { ok: false, error: "sem resposta" };
};
export const offerPreviewUrlAction = async (input) => {
  rec("offerPreviewUrlAction", input);
  return { ok: true, data: { url: "http://token.localhost:3001/" } };
};
`;

const stubs: Plugin = {
  name: "funnel-dialog-stubs",
  setup(b) {
    b.onResolve({ filter: /^sonner$/ }, () => ({ path: "sonner", namespace: "stub" }));
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
    b.onResolve({ filter: /^@\/server\/actions\/(funnel|editor)$/ }, () => ({ path: "actions", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
      loader: "js",
      resolveDir: ROOT,
      contents:
        args.path === "sonner"
          ? `const rec = (type) => (m) => (window.__toasts = [...(window.__toasts || []), { type, message: String(m) }]);
             export const toast = Object.assign(rec("default"), { success: rec("success"), error: rec("error") });`
          : args.path === "link"
            ? `import { createElement } from "react";
               export default function Link({ href, children, scroll, prefetch, ...rest }) {
                 return createElement("a", { href, ...rest }, children);
               }`
            : ACTIONS,
    }));
  },
};

let bundle: string;
let browser: Browser;

beforeAll(async () => {
  const out = await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "funnel-dialog-entry.tsx" },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    write: false,
    logLevel: "silent",
    tsconfig: path.join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "empty" },
    plugins: [stubs],
  });
  bundle = out.outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

const PAGES = [
  { id: "p-vendas", name: "Página de vendas", slug: "principal", isHome: true, type: "SALES", documentId: "d-vendas" },
  { id: "p-up", name: "Upsell", slug: "upsell", isHome: false, type: "UPSELL", documentId: "d-up" },
];

const CREATED = {
  quiz: { id: "p-quiz", name: "Quiz", slug: "quiz", documentId: "d-quiz" },
  wheel: { id: "p-roleta", name: "Roleta", slug: "roleta", documentId: "d-roleta" },
  sales: { id: "p-vendas", name: "Página de vendas", slug: "principal" },
  missingUrls: ["20% OFF", "50% OFF"],
  salesHasCheckoutButtons: false,
};

async function openDialog(
  props: Record<string, unknown> = {},
  reply: unknown = { ok: true, data: CREATED },
): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ locale: "pt-BR", viewport: { width: 1100, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setContent('<!doctype html><html lang="pt-BR"><body><main id="root"></main></body></html>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate((r) => {
    (window as unknown as { __funnelReply: unknown }).__funnelReply = r;
  }, reply);
  await page.evaluate((p) => (window as unknown as { OS: { render(p: unknown): void } }).OS.render(p), {
    offerId: "o1",
    pages: PAGES,
    existing: { quiz: [], wheel: [] },
    ...props,
  });
  await page.getByRole("dialog").waitFor();
  return { page, errors };
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __calls?: { name: string; input: unknown }[] }).__calls ?? []);

const prizeTexts = (page: Page) =>
  page.locator("input[data-prize-text]").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

describe("janela “Adicionar funil Quiz → Roleta”", () => {
  it("abre com a página inicial como página de vendas e os 4 prêmios prontos; cria com os links colados", async () => {
    const { page, errors } = await openDialog();
    const dialog = page.getByRole("dialog", { name: "Adicionar funil Quiz → Roleta" });
    expect(await dialog.getByRole("combobox", { name: "Página de vendas (depois da roleta)" }).textContent()).toBe(
      "Página de vendas (página inicial)",
    );
    await dialog.getByText("O quiz passa a ser a página inicial", { exact: false }).waitFor();
    expect(await dialog.getByRole("list", { name: "Caminho do visitante" }).textContent()).toBe(
      "AnúncioQuizRoletaPágina de vendas",
    );
    expect(await prizeTexts(page)).toEqual(["10% OFF", "20% OFF", "30% OFF", "50% OFF"]);
    expect(await dialog.getByText("As chances somam 100%.").count()).toBe(1);
    expect(await dialog.getByText("Já existe um funil").count()).toBe(0);

    await dialog.getByLabel("Link do checkout com desconto — 10% OFF").fill("pay.hotmart.com/A1?off=dez");
    await dialog.getByLabel("Cupom do prêmio 1 (opcional)").fill("DEZ");
    await dialog.getByRole("button", { name: "Criar funil" }).click();
    await expect.poll(() => calls(page)).toHaveLength(1);
    expect((await calls(page))[0]).toEqual({
      name: "createQuizWheelFunnelAction",
      input: {
        offerId: "o1",
        salesPageId: "p-vendas",
        prizes: [
          { text: "10% OFF", chance: 40, url: "pay.hotmart.com/A1?off=dez", coupon: "DEZ" },
          { text: "20% OFF", chance: 30, url: "", coupon: "" },
          { text: "30% OFF", chance: 20, url: "", coupon: "" },
          { text: "50% OFF", chance: 10, url: "", coupon: "" },
        ],
        allowExisting: false,
      },
    });
    await page.getByRole("dialog", { name: "Funil criado" }).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  });

  it("tira e adiciona prêmios (mínimo 2, máximo 12), chance 0 volta para 1% e outra página de vendas", async () => {
    const { page } = await openDialog();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Tirar o prêmio 50% OFF" }).click();
    await dialog.getByRole("button", { name: "Tirar o prêmio 30% OFF" }).click();
    expect(await prizeTexts(page)).toEqual(["10% OFF", "20% OFF"]);
    const locked = dialog.getByRole("button", { name: "A roleta precisa de pelo menos 2 prêmios" });
    expect(await locked.count()).toBe(2);
    expect(await locked.first().isDisabled()).toBe(true);

    await dialog.getByRole("button", { name: "Adicionar prêmio" }).click();
    expect(await prizeTexts(page)).toEqual(["10% OFF", "20% OFF", "5% OFF"]);
    // O prêmio novo ganha o foco.
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.value)).toBe("5% OFF");
    await dialog.getByText("As chances somam 80", { exact: false }).waitFor();
    expect(await dialog.getByText("real 50%").count()).toBe(1);

    const chance = dialog.getByLabel("Chance do prêmio 3 (%)");
    await chance.fill("0");
    await chance.blur();
    expect(await chance.inputValue()).toBe("1");
    await dialog.getByText("Todo prêmio precisa ter chance de sair (mínimo 1%)", { exact: false }).waitFor();

    for (let i = 0; i < 9; i++) await dialog.getByRole("button", { name: "Adicionar prêmio" }).click();
    expect(await prizeTexts(page)).toHaveLength(12);
    expect(await dialog.getByRole("button", { name: "Máximo de 12 prêmios" }).isDisabled()).toBe(true);

    await dialog.getByRole("combobox", { name: "Página de vendas (depois da roleta)" }).click();
    await page.getByRole("option", { name: "Upsell" }).click();
    expect(await dialog.getByText("O quiz passa a ser a página inicial", { exact: false }).count()).toBe(0);
    expect(await dialog.getByRole("list", { name: "Caminho do visitante" }).textContent()).toBe(
      "AnúncioQuizRoletaUpsell",
    );
    await page.close();
  });

  it("Enter num campo (depois de colar o link) não cria o funil: só o botão “Criar funil” cria", async () => {
    const { page } = await openDialog();
    const dialog = page.getByRole("dialog", { name: "Adicionar funil Quiz → Roleta" });
    await dialog.getByLabel("Link do checkout com desconto — 10% OFF").fill("https://pay.hotmart.com/DEZ");
    await dialog.getByLabel("Link do checkout com desconto — 10% OFF").press("Enter");
    await dialog.getByLabel("Cupom do prêmio 1 (opcional)").press("Enter");
    await dialog.getByLabel("Chance do prêmio 2 (%)").press("Enter");
    await dialog.getByLabel("Prêmio 3", { exact: true }).press("Enter");
    await page.waitForTimeout(300);
    expect(await calls(page)).toEqual([]);
    expect(await dialog.isVisible()).toBe(true);
    // Enter com o foco no botão continua criando.
    await dialog.getByRole("button", { name: "Criar funil" }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => calls(page)).toHaveLength(1);
    expect((await calls(page))[0].input).toMatchObject({
      prizes: [{ text: "10% OFF", url: "https://pay.hotmart.com/DEZ" }, {}, {}, {}],
    });
    await page.close();
  });

  it("link incompleto ou prêmio sem texto: avisa na linha e não manda", async () => {
    const { page } = await openDialog();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Link do checkout com desconto — 20% OFF").fill("pay.kiwify");
    await dialog.getByLabel("Prêmio 3", { exact: true }).fill("");
    await dialog.getByRole("button", { name: "Criar funil" }).click();
    await dialog.getByText("faltou o final depois de “kiwify”", { exact: false }).waitFor();
    await dialog.getByText("Escreva o prêmio (ex.: 30% OFF).").waitFor();
    await dialog.getByText("Confira os campos marcados.").waitFor();
    expect(await dialog.getByLabel("Link do checkout com desconto — 20% OFF").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(await calls(page)).toEqual([]);
    // Checkout sem o código do produto: só um aviso (não bloqueia).
    await dialog.getByLabel("Link do checkout com desconto — 20% OFF").fill("https://pay.hotmart.com");
    await dialog.getByText("faltou o final", { exact: false }).waitFor({ state: "detached" });
    await page.close();
  });

  it("erro do servidor num link aparece na linha certa", async () => {
    const { page } = await openDialog(
      {},
      { ok: false, error: "Prêmio 2: Digite um link completo, como https://pay.hotmart.com/…", field: "prizes.1.url" },
    );
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Criar funil" }).click();
    await expect
      .poll(() => dialog.getByLabel("Link do checkout com desconto — 20% OFF").getAttribute("aria-invalid"))
      .toBe("true");
    expect(await dialog.getByText("Prêmio 2: Digite um link completo", { exact: false }).count()).toBe(2);
    await page.close();
  });

  it("oferta que já tem quiz/roleta: avisa, sugere a página de vendas (não o quiz inicial) e o botão vira “Criar outro funil”", async () => {
    const { page } = await openDialog({
      pages: [
        { id: "p-quiz", name: "Quiz", slug: "quiz", isHome: true, type: "QUIZ", documentId: "d-quiz" },
        { id: "p-roleta", name: "Roleta", slug: "roleta", isHome: false, type: "OTHER", documentId: "d-roleta" },
        ...PAGES.map((p) => ({ ...p, isHome: false })),
      ],
      existing: { quiz: [{ id: "p-quiz", name: "Quiz" }], wheel: [{ id: "p-roleta", name: "Roleta" }] },
    });
    const dialog = page.getByRole("dialog");
    expect(await dialog.getByRole("combobox", { name: "Página de vendas (depois da roleta)" }).textContent()).toBe(
      "Página de vendas",
    );
    await dialog.getByText("Já existe um funil nesta oferta").waitFor();
    await dialog
      .getByText("Esta oferta já tem um quiz (página “Quiz”) e uma roleta (página “Roleta”).", { exact: false })
      .waitFor();
    await dialog.getByRole("button", { name: "Criar outro funil" }).click();
    await expect.poll(() => calls(page)).toHaveLength(1);
    expect((await calls(page))[0].input).toMatchObject({ allowExisting: true, salesPageId: "p-vendas" });
    await page.close();
  });

  it("resultado: caminho criado, o que falta e os botões “Abrir o quiz no editor” e “Ver o funil”", async () => {
    const { page, errors } = await openDialog();
    await page.getByRole("button", { name: "Criar funil" }).click();
    const done = page.getByRole("dialog", { name: "Funil criado" });
    await done.waitFor();
    expect(
      await done
        .getByRole("list", { name: "Funil criado" })
        .getByRole("listitem")
        .evaluateAll((els) => els.map((e) => e.textContent)),
    ).toEqual([
      "1QuizPágina inicial (o link do anúncio abre nela)",
      "2Roleta/roleta/",
      "3Página de vendas/principal/ · recebe o desconto ganho",
    ]);
    await done.getByText("2 prêmios ficaram sem o link do checkout").waitFor();
    await done.getByText("Quem ganhar “20% OFF” e “50% OFF” ainda não recebe o desconto.", { exact: false }).waitFor();
    expect(await done.getByRole("link", { name: "Preencher os links" }).getAttribute("href")).toBe(
      "/ofertas/o1?aba=links",
    );
    await done.getByText("Botões de compra sem link de checkout").waitFor();
    expect(await done.getByRole("link", { name: "Abrir no editor" }).getAttribute("href")).toBe("/editor/d-vendas");
    expect(await done.getByRole("link", { name: "Abrir o quiz no editor" }).getAttribute("href")).toBe(
      "/editor/d-quiz",
    );

    await done.getByRole("button", { name: "Ver o funil" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __opened?: string[] }).__opened ?? []))
      .toEqual(["http://token.localhost:3001/"]);
    expect((await calls(page)).at(-1)).toEqual({
      name: "offerPreviewUrlAction",
      input: { offerId: "o1", pageId: "p-quiz" },
    });
    await done.getByRole("button", { name: "Fechar" }).first().click();
    expect(await page.evaluate(() => (window as unknown as { __open?: boolean }).__open)).toBe(false);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("resultado sem pendências: nenhum aviso", async () => {
    const { page } = await openDialog(
      {},
      { ok: true, data: { ...CREATED, missingUrls: [], salesHasCheckoutButtons: true } },
    );
    await page.getByRole("button", { name: "Criar funil" }).click();
    const done = page.getByRole("dialog", { name: "Funil criado" });
    await done.waitFor();
    expect(await done.locator('[data-slot="callout"]').count()).toBe(0);
    await page.close();
  });
});
