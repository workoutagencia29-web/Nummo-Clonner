/**
 * Telas do pagamento na página num Chromium de verdade (ações de mentira, que
 * registram o que foi pedido):
 * - Configurações → Pagamentos: colar a chave (erro no campo), chave salva só
 *   mascarada com "Testar conexão" / "Trocar chave" / "Remover";
 * - aba "Links e checkouts": destino "Pagamento na página" (só em links de
 *   checkout), formulário do produto (moeda × métodos, idioma acompanhando a
 *   moeda, faixas de valor, página de obrigado, link de acesso) e o "Novo link"
 *   já como pagamento.
 */
import path from "node:path";
import { build, type Plugin } from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PRINTS = process.env.OS_PRINTS_DIR;

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { PaymentsCard } from "@/app/(painel)/configuracoes/payments-card";
import { OfferLinks } from "@/components/offers/offer-links";
let root = null;
window.OS = {
  card(props) {
    root = root || createRoot(document.getElementById("root"));
    root.render(createElement(PaymentsCard, props));
  },
  links(props) {
    root = root || createRoot(document.getElementById("root"));
    root.render(createElement(OfferLinks, props));
  },
};
`;

const ACTIONS = `
const rec = (name, input) => (window.__calls = window.__calls || []).push({ name, input });
const reply = (name, input, fallback) => {
  rec(name, input);
  const r = (window.__replies || {})[name];
  return Promise.resolve(typeof r === "function" ? r(input) : r || fallback);
};
export const savePaymentGatewayKeyAction = (i) => reply("savePaymentGatewayKeyAction", i, { ok: true, data: undefined });
export const removePaymentGatewayKeyAction = (i) => reply("removePaymentGatewayKeyAction", i, { ok: true, data: undefined });
export const testPaymentGatewayAction = (i) => reply("testPaymentGatewayAction", i, {
  ok: true,
  data: { status: "ok", message: "x", checkedAt: "2026-10-06T21:00:00.000Z" },
});
export const savePaymentProductAction = (i) => reply("savePaymentProductAction", i, {
  ok: true,
  data: { ...i, amount: i.amount, price: "MX$ 297,00", amountCents: 29700, provider: "KYVO" },
});
export const setOfferLinkTargetAction = (i) => reply("setOfferLinkTargetAction", i, { ok: true, data: undefined });
export const createOfferLinkAction = (i) => reply("createOfferLinkAction", i, { ok: true, data: { id: "novo", key: "novo", ...i } });
export const updateOfferLinkAction = (i) => reply("updateOfferLinkAction", i, { ok: true, data: undefined });
export const deleteOfferLinkAction = (i) => reply("deleteOfferLinkAction", i, { ok: true, data: undefined });
`;

const stubs: Plugin = {
  name: "payments-ui-stubs",
  setup(b) {
    b.onResolve({ filter: /^sonner$/ }, () => ({ path: "sonner", namespace: "stub" }));
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "stub" }));
    b.onResolve({ filter: /^@\/server\/actions\/(payments|offer-links)$/ }, () => ({
      path: "actions",
      namespace: "stub",
    }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
      loader: "js",
      resolveDir: ROOT,
      contents:
        args.path === "sonner"
          ? `const rec = (type) => (m) => (window.__toasts = [...(window.__toasts || []), { type, message: String(m) }]);
             export const toast = Object.assign(rec("default"), { success: rec("success"), error: rec("error") });`
          : args.path === "navigation"
            ? "export function useSearchParams() { return new URLSearchParams(window.__search || location.search); }"
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
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "payments-ui-entry.tsx" },
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

async function open(
  kind: "card" | "links",
  props: Record<string, unknown>,
  replies: Record<string, unknown> = {},
): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ locale: "pt-BR", viewport: { width: 1100, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setContent('<!doctype html><html lang="pt-BR"><body><main id="root"></main></body></html>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate((r) => {
    (window as unknown as { __replies: unknown }).__replies = r;
  }, replies);
  await page.evaluate(
    ([k, p]) => (window as unknown as { OS: Record<string, (p: unknown) => void> }).OS[k as string](p),
    [kind, props] as const,
  );
  return { page, errors };
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __calls?: { name: string; input: unknown }[] }).__calls ?? []);
const toasts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __toasts?: { type: string; message: string }[] }).__toasts ?? []);

const KYVO_EMPTY = {
  provider: "KYVO",
  label: "Kyvo",
  configured: false,
  keyHint: null,
  keyUnreadable: false,
  checkedAt: null,
  checkStatus: null,
};

describe("Configurações → Pagamentos", () => {
  it("sem chave: campo de senha, ajuda de onde achar e erro do servidor no campo", async () => {
    const { page, errors } = await open(
      "card",
      { gateways: [KYVO_EMPTY] },
      {
        savePaymentGatewayKeyAction: {
          ok: false,
          error: "A chave da Kyvo começa com “kyvo_live_”. Confira se copiou a chave da API certa.",
          field: "apiKey",
        },
      },
    );
    await page.getByText("Não configurado").waitFor();
    await page.getByText("México (SPEI), cartão internacional, Bizum (Espanha) e MB WAY (Portugal).").waitFor();
    await page.getByText(/permissões spei_charges:create, card_charges:create e transactions:read/).waitFor();
    await page.getByText(/A chave fica só neste Mac/).waitFor();
    const input = page.getByLabel("Chave da API da Kyvo");
    expect(await input.getAttribute("type")).toBe("password");
    await page.getByRole("button", { name: "Salvar chave" }).click();
    await page.getByText("Cole a chave da API da Kyvo.").waitFor();
    expect(await calls(page)).toEqual([]);
    await input.fill("sk_live_xxxxxxxxxxxxxxxxxxxx");
    await page.getByRole("button", { name: "Salvar chave" }).click();
    await page.getByText(/começa com “kyvo_live_”/).waitFor();
    expect(await calls(page)).toEqual([
      { name: "savePaymentGatewayKeyAction", input: { provider: "KYVO", apiKey: "sk_live_xxxxxxxxxxxxxxxxxxxx" } },
    ]);
    expect(await input.getAttribute("aria-invalid")).toBe("true");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("com chave: só o final mascarado; testar mostra o resultado; trocar e remover", async () => {
    const { page, errors } = await open(
      "card",
      {
        gateways: [{ ...KYVO_EMPTY, configured: true, keyHint: "••••••6789", checkedAt: null, checkStatus: null }],
      },
      {
        testPaymentGatewayAction: {
          ok: true,
          data: { status: "missing_scope", message: "x", checkedAt: "2026-10-06T21:00:00.000Z" },
        },
      },
    );
    await page.getByText("Chave configurada").waitFor();
    await page.getByText("••••••6789").waitFor();
    expect(await page.getByLabel("Chave da API da Kyvo").count()).toBe(0);
    await page.getByRole("button", { name: "Testar conexão" }).click();
    await page.getByText("A conexão falhou").waitFor();
    await page.getByText(/não tem a permissão de consultar transações \(transactions:read\)/).waitFor();
    // O selo deixa de dizer "Chave configurada" (o "Próximos passos" e o ZIP também avisam).
    await page.getByText("Sem permissão", { exact: true }).waitFor();
    expect(await page.getByText("Chave configurada").count()).toBe(0);
    if (PRINTS) await page.screenshot({ path: path.join(PRINTS, "ui-configuracoes-pagamentos.png"), fullPage: true });

    await page.getByRole("button", { name: "Trocar chave" }).click();
    await page.getByLabel("Chave da API da Kyvo").fill("kyvo_live_novaChave1234567890");
    await page.getByRole("button", { name: "Cancelar troca" }).waitFor();
    await page.getByRole("button", { name: "Salvar chave" }).click();
    await page.getByRole("button", { name: "Trocar chave" }).waitFor();

    await page.getByRole("button", { name: "Remover" }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByText("Remover a chave da Kyvo?").waitFor();
    await dialog.getByRole("button", { name: "Remover chave" }).click();
    await dialog.waitFor({ state: "detached" });
    expect((await calls(page)).map((c) => c.name)).toEqual([
      "testPaymentGatewayAction",
      "savePaymentGatewayKeyAction",
      "removePaymentGatewayKeyAction",
    ]);
    expect(await toasts(page)).toContainEqual({ type: "success", message: "Chave removida." });
    expect(errors).toEqual([]);
    await page.close();
  });
});

const PAGES = [
  { id: "p-vendas", name: "Página de vendas", type: "SALES" },
  { id: "p-obrigado", name: "Obrigado", type: "THANK_YOU" },
];

const LINK = {
  id: "l1",
  key: "checkout",
  label: "Checkout principal",
  url: "https://pay.hotmart.com/X1",
  kind: "CHECKOUT",
  target: "URL",
  payment: null,
  usage: 2,
  prizes: 0,
};

describe("aba Links e checkouts: pagamento na página", () => {
  it("trocar o destino abre o formulário do produto; moeda manda nos métodos; salva o que o servidor precisa", async () => {
    const { page, errors } = await open("links", {
      offerId: "o1",
      links: [LINK, { ...LINK, id: "l2", key: "zap", label: "WhatsApp", kind: "WHATSAPP", url: "https://wa.me/55" }],
      pages: PAGES,
      paymentsKey: "missing",
    });
    // WhatsApp não pode ser pagamento.
    await page.getByRole("combobox", { name: "Destino do link WhatsApp" }).click();
    expect(
      await page.getByRole("option", { name: "Pagamento na página (só checkout)" }).getAttribute("aria-disabled"),
    ).toBe("true");
    await page.keyboard.press("Escape");

    await page.getByRole("combobox", { name: "Destino do link Checkout principal" }).click();
    await page.getByRole("option", { name: "Pagamento na página" }).click();
    const form = page.getByRole("form", { name: "Produto do pagamento na página" });
    await form.waitFor();
    // Nada foi gravado ainda: o link só vira pagamento ao salvar o produto.
    expect(await calls(page)).toEqual([]);
    await form.getByText("Falta a chave da Kyvo").waitFor();
    expect(await form.getByRole("link", { name: "Abrir Configurações → Pagamentos" }).getAttribute("href")).toBe(
      "/configuracoes#pagamentos",
    );
    // Padrões: MXN, SPEI + Cartão, Español, a única página de obrigado.
    expect(await form.getByRole("combobox", { name: "Moeda" }).textContent()).toBe("Peso mexicano (MXN)");
    expect(await form.getByRole("checkbox", { name: /SPEI/ }).isChecked()).toBe(true);
    expect(await form.getByRole("checkbox", { name: /Cartão/ }).isChecked()).toBe(true);
    expect(await form.getByRole("checkbox", { name: /Bizum/ }).isDisabled()).toBe(true);
    await form.getByText("Só com EUR: troque a moeda para usar.").first().waitFor();
    expect(await form.getByRole("combobox", { name: "Idioma da janela de pagamento" }).textContent()).toBe("Español");
    expect(await form.getByRole("combobox", { name: "Página de obrigado" }).textContent()).toBe("Obrigado");

    // Conferência antes de mandar.
    await form.getByRole("button", { name: "Salvar e ligar o pagamento" }).click();
    await form.getByText(/Dê um nome ao produto/).waitFor();
    await form.getByLabel("Nome do produto").fill("Curso de Repostería");
    await form.getByLabel("Valor").fill("30.000,00");
    await form.getByRole("button", { name: "Salvar e ligar o pagamento" }).click();
    await form.getByText(/Com SPEI, o valor máximo é MX\$\s25\.000,00 por compra\./).waitFor();
    expect(await calls(page)).toEqual([]);
    await form.getByLabel("Valor").fill("297,00");
    await form.getByText(/O comprador paga MX\$\s297,00\./).waitFor();

    // Euro: SPEI sai, Bizum e MB WAY liberam; idioma continua Español (padrão do EUR).
    await form.getByRole("combobox", { name: "Moeda" }).click();
    await page.getByRole("option", { name: "Euro (EUR)" }).click();
    expect(await form.getByRole("checkbox", { name: /SPEI/ }).isDisabled()).toBe(true);
    expect(await form.getByRole("checkbox", { name: /SPEI/ }).isChecked()).toBe(false);
    await form.getByRole("checkbox", { name: /Bizum/ }).check();
    await form.getByRole("checkbox", { name: /MB WAY/ }).check();
    // Dólar: idioma padrão vira English; só cartão.
    await form.getByRole("combobox", { name: "Moeda" }).click();
    await page.getByRole("option", { name: "Dólar americano (USD)" }).click();
    expect(await form.getByRole("combobox", { name: "Idioma da janela de pagamento" }).textContent()).toBe("English");
    expect(await form.getByRole("checkbox", { name: /Bizum/ }).isChecked()).toBe(false);
    await form.getByRole("combobox", { name: "Moeda" }).click();
    await page.getByRole("option", { name: "Euro (EUR)" }).click();
    await form.getByRole("checkbox", { name: /Bizum/ }).check();

    await form.getByLabel("Link de acesso ao produto").fill("ftp://errado");
    await form.getByRole("button", { name: "Salvar e ligar o pagamento" }).click();
    await form.getByText("Digite o link de acesso completo, começando com https://").waitFor();
    await form.getByLabel("Link de acesso ao produto").fill("membros.exemplo.com/curso");
    if (PRINTS) await page.screenshot({ path: path.join(PRINTS, "ui-link-pagamento.png"), fullPage: true });
    await form.getByRole("button", { name: "Salvar e ligar o pagamento" }).click();
    await page.waitForFunction(() => ((window as unknown as { __calls?: unknown[] }).__calls ?? []).length > 0);
    expect(await calls(page)).toEqual([
      {
        name: "savePaymentProductAction",
        input: {
          linkId: "l1",
          name: "Curso de Repostería",
          amount: "297,00",
          currency: "EUR",
          methods: ["CARD", "BIZUM"],
          // Voltou ao euro: o idioma ainda no padrão (English do dólar) acompanha → Español.
          locale: "ES",
          thankYouPageId: "p-obrigado",
          accessUrl: "membros.exemplo.com/curso",
        },
      },
    ]);
    expect(await toasts(page)).toContainEqual({
      type: "success",
      message: "Produto salvo. Os botões ligados a este link abrem a janela de pagamento.",
    });
    expect(errors).toEqual([]);
    await page.close();
  });

  it("link já de pagamento: preço no selo; voltar para endereço chama a ação; erro do servidor no campo", async () => {
    const payment = {
      name: "Curso",
      amount: "297,00",
      price: "MX$ 297,00",
      currency: "MXN",
      methods: ["SPEI"],
      locale: "ES",
      thankYouPageId: null,
      accessUrl: "",
    };
    const { page, errors } = await open(
      "links",
      {
        offerId: "o1",
        links: [{ ...LINK, target: "PAYMENT", payment }],
        pages: PAGES,
        paymentsKey: "ok",
      },
      {
        savePaymentProductAction: {
          ok: false,
          error: "Essa página de obrigado não é desta oferta. Escolha outra.",
          field: "thankYouPageId",
        },
      },
    );
    await page.getByText("MX$ 297,00").first().waitFor();
    const form = page.getByRole("form", { name: "Produto do pagamento na página" });
    expect(await form.getByText("Falta a chave da Kyvo").count()).toBe(0);
    await form.getByText(/Falta escolher a página de obrigado e colar o link de acesso/).waitFor();
    // URL do link some (não vale para pagamento).
    expect(await page.getByLabel("URL do link Checkout principal").count()).toBe(0);
    await form.getByLabel("Nome do produto").fill("Curso novo");
    await form.getByRole("button", { name: "Salvar produto" }).click();
    await form.getByText("Essa página de obrigado não é desta oferta. Escolha outra.").waitFor();

    await page.getByRole("combobox", { name: "Destino do link Checkout principal" }).click();
    await page.getByRole("option", { name: "Endereço (link)" }).click();
    await page.waitForFunction(() => ((window as unknown as { __calls?: unknown[] }).__calls ?? []).length > 1);
    expect((await calls(page)).at(-1)).toEqual({
      name: "setOfferLinkTargetAction",
      input: { linkId: "l1", target: "URL" },
    });
    expect(errors).toEqual([]);
    await page.close();
  });

  it("chave recusada no último “Testar conexão”: o formulário do produto avisa", async () => {
    const payment = {
      provider: "KYVO",
      name: "Curso",
      amountCents: 29700,
      amount: "297,00",
      price: "MX$ 297,00",
      currency: "MXN",
      methods: ["SPEI"],
      locale: "ES",
      thankYouPageId: "p-obrigado",
      accessUrl: "https://membros.exemplo.com/x",
    };
    for (const [state, title] of [
      ["rejected", "A Kyvo recusou a chave"],
      ["no_scope", "A chave da Kyvo não tem a permissão transactions:read"],
    ]) {
      const { page, errors } = await open("links", {
        offerId: "o1",
        links: [{ ...LINK, target: "PAYMENT", payment }],
        pages: PAGES,
        paymentsKey: state,
      });
      const form = page.getByRole("form", { name: "Produto do pagamento na página" });
      await form.getByText(title, { exact: true }).waitFor();
      expect(await form.getByRole("link", { name: "Abrir Configurações → Pagamentos" }).count()).toBe(1);
      expect(errors).toEqual([]);
      await page.close();
    }
  });

  it("Novo link já como pagamento na página (sem URL)", async () => {
    const { page, errors } = await open("links", { offerId: "o1", links: [], pages: PAGES, paymentsKey: "ok" });
    await page.getByLabel("Nome do novo link").fill("Pagamento México");
    await page.getByRole("combobox", { name: "Destino do novo link" }).click();
    await page.getByRole("option", { name: "Pagamento na página" }).click();
    expect(await page.getByLabel("URL do novo link").count()).toBe(0);
    await page.getByText(/Depois de adicionar, preencha o produto/).waitFor();
    // Tipo que não é de checkout volta o destino para endereço.
    await page.getByRole("combobox", { name: "Tipo do novo link" }).click();
    await page.getByRole("option", { name: "WhatsApp" }).click();
    await page.getByLabel("URL do novo link").waitFor();
    await page.getByRole("combobox", { name: "Tipo do novo link" }).click();
    await page.getByRole("option", { name: "Checkout do upsell" }).click();
    await page.getByRole("combobox", { name: "Destino do novo link" }).click();
    await page.getByRole("option", { name: "Pagamento na página" }).click();
    await page.getByRole("button", { name: "Adicionar" }).click();
    await page.waitForFunction(() => ((window as unknown as { __calls?: unknown[] }).__calls ?? []).length > 0);
    expect(await calls(page)).toEqual([
      {
        name: "createOfferLinkAction",
        input: { offerId: "o1", label: "Pagamento México", url: "", kind: "UPSELL", target: "PAYMENT" },
      },
    ]);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("?link=<id> (“Abrir o link” do Próximos passos e dos avisos do ZIP): destaca e põe o foco no link", async () => {
    const page = await browser.newPage({ locale: "pt-BR", viewport: { width: 1100, height: 500 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setContent('<!doctype html><html lang="pt-BR"><body><main id="root"></main></body></html>');
    await page.addScriptTag({ content: bundle });
    const links = [
      LINK,
      ...[2, 3, 4, 5, 6].map((n) => ({ ...LINK, id: `l${n}`, key: `c${n}`, label: `Checkout ${n}` })),
    ];
    await page.evaluate(
      (props) => {
        (window as unknown as { __search: string }).__search = "?aba=links&link=l6";
        (window as unknown as { OS: Record<string, (p: unknown) => void> }).OS.links(props);
      },
      { offerId: "o1", links, pages: PAGES, paymentsKey: "ok" },
    );
    const row = page.locator("#link-l6");
    await expect.poll(() => row.getAttribute("data-highlight")).toBe("true");
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("link-l6");
    expect(await page.locator("[data-highlight]").count()).toBe(1);
    await expect.poll(() => row.isVisible()).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  });
});
