/**
 * Telas do pagamento na página num Chromium de verdade (ações de mentira, que
 * registram o que foi pedido):
 * - cartão "Pagamento na página — conta da Kyvo desta oferta" (aba "Links e
 *   checkouts"): colar a chave (erro no campo), chave salva só mascarada com
 *   "Testar conexão" / "Trocar chave" / "Remover", "Usar a mesma chave de outra
 *   oferta"; quando aparece (link de pagamento) e o atalho discreto quando não;
 *   o aviso do formulário do link leva até ele;
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
import { PaymentAccountCard } from "@/components/offers/payment-account-card";
import { OfferLinks } from "@/components/offers/offer-links";
let root = null;
window.OS = {
  card(props) {
    root = root || createRoot(document.getElementById("root"));
    root.render(createElement(PaymentAccountCard, props));
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
export const copyPaymentGatewayKeyAction = (i) => reply("copyPaymentGatewayKeyAction", i, { ok: true, data: { offerName: "Oferta México" } });
export const testPaymentGatewayAction = (i) => reply("testPaymentGatewayAction", i, {
  ok: true,
  data: { status: "ok", message: "x", checkedAt: "2026-10-06T21:00:00.000Z" },
});
export const savePaymentProductAction = (i) => reply("savePaymentProductAction", i, {
  ok: true,
  data: { ...i, amount: i.amount, price: "MX$ 297,00", amountCents: 29700, provider: "KYVO" },
});
export const setOfferLinkTargetAction = (i) => reply("setOfferLinkTargetAction", i, { ok: true, data: undefined });
export const checkoutPreviewUrlAction = (i) => reply("checkoutPreviewUrlAction", i, { ok: true, data: { url: "about:blank" } });
export const saveCheckoutProductAction = (i) => reply("saveCheckoutProductAction", i, { ok: true, data: undefined });
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
    b.onResolve({ filter: /^@\/server\/actions\/(payments|offer-links|checkout)$/ }, () => ({
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
            ? // Como o do Next: acompanha pushState/replaceState (navegação e replaceQuery).
              `import { useSyncExternalStore } from "react";
               for (const m of ["pushState", "replaceState"]) {
                 const orig = history[m].bind(history);
                 history[m] = (...a) => { orig(...a); dispatchEvent(new Event("os:url")); };
               }
               const sub = (cb) => { addEventListener("os:url", cb); return () => removeEventListener("os:url", cb); };
               export function useSearchParams() {
                 return new URLSearchParams(useSyncExternalStore(sub, () => location.search));
               }`
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

/** Endereço da tela da oferta (a página de teste é servida nele: o replaceQuery precisa de um endereço de verdade). */
const OFFER_URL = "http://painel.os.test/ofertas/o1";

/** Página em branco num endereço da oferta (`query` = ?aba=links&conta=… etc.), com o pacote carregado. */
async function blank(page: Page, query = "") {
  await page.route("http://painel.os.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="pt-BR"><body><main id="root"></main></body></html>',
    }),
  );
  await page.goto(`${OFFER_URL}${query}`);
  await page.addScriptTag({ content: bundle });
}

/** Tira o foco, espera o destaque acabar e volta a página para o topo (como quem leu e subiu). */
async function backToTop(page: Page, highlighted: ReturnType<Page["locator"]>) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(() => highlighted.getAttribute("data-highlight"), { timeout: 6000 }).toBeNull();
  await expect
    .poll(() =>
      page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: "instant" });
        return window.scrollY;
      }),
    )
    .toBe(0);
}

/** Como um <Link> do Next para outro endereço da mesma tela (navegação sem recarregar). */
const navigate = (page: Page, href: string) => page.evaluate((h) => history.pushState(null, "", h), href);

async function open(
  kind: "card" | "links",
  props: Record<string, unknown>,
  replies: Record<string, unknown> = {},
): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ locale: "pt-BR", viewport: { width: 1100, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await blank(page);
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
const KYVO_OK = { ...KYVO_EMPTY, configured: true, keyHint: "••••••6789" };

describe("cartão da conta da Kyvo da oferta", () => {
  it("sem chave: campo de senha, ajuda de onde achar e erro do servidor no campo", async () => {
    const { page, errors } = await open(
      "card",
      { offerId: "o1", account: KYVO_EMPTY },
      {
        savePaymentGatewayKeyAction: {
          ok: false,
          error: "A chave da Kyvo começa com “kyvo_live_”. Confira se copiou a chave da API certa.",
          field: "apiKey",
        },
      },
    );
    await page.getByRole("heading", { name: "Pagamento na página — conta da Kyvo desta oferta" }).waitFor();
    await page.getByText("Sem chave", { exact: true }).waitFor();
    // Sem outras ofertas com chave: sem a opção de copiar.
    expect(await page.getByText("Ou use a mesma chave de outra oferta").count()).toBe(0);
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
      {
        name: "savePaymentGatewayKeyAction",
        input: { offerId: "o1", provider: "KYVO", apiKey: "sk_live_xxxxxxxxxxxxxxxxxxxx" },
      },
    ]);
    expect(await input.getAttribute("aria-invalid")).toBe("true");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("com chave: só o final mascarado; testar mostra o resultado; trocar e remover", async () => {
    const { page, errors } = await open(
      "card",
      {
        offerId: "o1",
        account: { ...KYVO_EMPTY, configured: true, keyHint: "••••••6789", checkedAt: null, checkStatus: null },
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
    await page.getByText(/Ainda não testada nesta oferta/).waitFor();
    await page.getByRole("button", { name: "Testar conexão" }).click();
    await page.getByText("A conexão falhou").waitFor();
    await page.getByText(/não tem a permissão de consultar transações \(transactions:read\)/).waitFor();
    // O selo deixa de dizer "Chave configurada" (o "Próximos passos" e o ZIP também avisam).
    await page.getByText("Sem permissão", { exact: true }).waitFor();
    expect(await page.getByText("Chave configurada").count()).toBe(0);
    if (PRINTS) await page.screenshot({ path: path.join(PRINTS, "ui-conta-kyvo-oferta.png"), fullPage: true });

    await page.getByRole("button", { name: "Trocar chave" }).click();
    await page.getByLabel("Chave da API da Kyvo").fill("kyvo_live_novaChave1234567890");
    await page.getByRole("button", { name: "Cancelar troca" }).waitFor();
    await page.getByRole("button", { name: "Salvar chave" }).click();
    await page.getByRole("button", { name: "Trocar chave" }).waitFor();

    await page.getByRole("button", { name: "Remover" }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByText("Remover a chave da Kyvo desta oferta?").waitFor();
    await dialog.getByRole("button", { name: "Remover chave" }).click();
    await dialog.waitFor({ state: "detached" });
    expect(await calls(page)).toEqual([
      { name: "testPaymentGatewayAction", input: { offerId: "o1", provider: "KYVO" } },
      {
        name: "savePaymentGatewayKeyAction",
        input: { offerId: "o1", provider: "KYVO", apiKey: "kyvo_live_novaChave1234567890" },
      },
      { name: "removePaymentGatewayKeyAction", input: { offerId: "o1", provider: "KYVO" } },
    ]);
    expect(await toasts(page)).toContainEqual({ type: "success", message: "Chave removida." });
    expect(errors).toEqual([]);
    await page.close();
  });
  it("usar a mesma chave de outra oferta: escolhe a oferta (só nome e final da chave) e o servidor copia", async () => {
    const sources = [
      { offerId: "o2", offerName: "Oferta México", keyHint: "••••••1111" },
      { offerId: "o3", offerName: "Oferta Espanha", keyHint: "••••••2222" },
    ];
    const { page, errors } = await open("card", { offerId: "o1", account: KYVO_EMPTY, sources });
    await page.getByText("Ou use a mesma chave de outra oferta").waitFor();
    await page.getByRole("button", { name: "Usar esta chave" }).click();
    await page.getByText("Escolha a oferta de onde copiar a chave.").waitFor();
    expect(await calls(page)).toEqual([]);
    await page.getByRole("combobox", { name: "Oferta de onde copiar a chave" }).click();
    await page.getByRole("option", { name: /Oferta Espanha/ }).waitFor();
    await page.getByRole("option", { name: /Oferta México/ }).click();
    if (PRINTS) await page.screenshot({ path: path.join(PRINTS, "ui-usar-chave-de-outra-oferta.png"), fullPage: true });
    await page.getByRole("button", { name: "Usar esta chave" }).click();
    await page.waitForFunction(() => ((window as unknown as { __calls?: unknown[] }).__calls ?? []).length > 0);
    expect(await calls(page)).toEqual([
      { name: "copyPaymentGatewayKeyAction", input: { offerId: "o1", fromOfferId: "o2", provider: "KYVO" } },
    ]);
    expect(await toasts(page)).toContainEqual({
      type: "success",
      message: "Chave copiada de “Oferta México”. Clique em “Testar conexão” para conferir.",
    });
    // A chave nunca chega à tela: no HTML, kyvo_live_ só no exemplo do campo e na ajuda.
    expect(await page.content()).not.toMatch(/kyvo_live_[A-Za-z0-9]/);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("Trocar chave avisa as ofertas com a mesma chave e troca nelas também (ou só aqui, se desmarcar)", async () => {
    const sources = [
      { offerId: "o2", offerName: "Oferta México", keyHint: "••••••6789", sameKey: true },
      { offerId: "o3", offerName: "Cópia de Oferta", keyHint: "••••••6789", sameKey: true },
      { offerId: "o4", offerName: "Oferta Espanha", keyHint: "••••••2222", sameKey: false },
    ];
    const { page, errors } = await open("card", {
      offerId: "o1",
      account: { ...KYVO_OK, checkStatus: "ok", checkedAt: "2026-10-06T21:00:00.000Z" },
      sources,
    });
    // A resposta conta as outras ofertas trocadas (como o servidor).
    await page.evaluate(() => {
      const w = window as unknown as { __replies: Record<string, unknown> };
      w.__replies.savePaymentGatewayKeyAction = (i: { alsoOfferIds?: string[] }) => ({
        ok: true,
        data: { alsoChanged: i.alsoOfferIds?.length ?? 0 },
      });
    });
    // Com a chave salva, o cartão já diz onde mais ela está.
    await page.getByText("A mesma chave também está em: “Oferta México”, “Cópia de Oferta”.").waitFor();
    await page.getByRole("button", { name: "Trocar chave" }).click();
    const warning = page.locator('[data-slot="callout"]', { hasText: "2 outras ofertas usam esta mesma chave" });
    await warning.waitFor();
    await warning
      .getByText(/“Oferta México”, “Cópia de Oferta”\. Se você trocar só aqui, elas continuam com a chave antiga/)
      .waitFor();
    expect(await warning.getByText("Oferta Espanha").count()).toBe(0);
    const also = page.getByRole("checkbox", { name: "Trocar também nelas" });
    expect(await also.isChecked()).toBe(true);
    // "Usar a mesma chave de outra oferta" não lista as que já têm esta chave.
    await page.getByRole("combobox", { name: "Oferta de onde copiar a chave" }).click();
    await page.getByRole("option", { name: /Oferta Espanha/ }).waitFor();
    expect(await page.getByRole("option", { name: /Oferta México/ }).count()).toBe(0);
    await page.keyboard.press("Escape");
    if (PRINTS) await page.screenshot({ path: path.join(PRINTS, "ui-trocar-chave-compartilhada.png"), fullPage: true });
    await page.getByLabel("Chave da API da Kyvo").fill("kyvo_live_novaChave1234567890");
    await page.getByRole("button", { name: "Salvar chave" }).click();
    await page.getByRole("button", { name: "Trocar chave" }).waitFor();
    expect(await toasts(page)).toContainEqual({
      type: "success",
      message: "Chave trocada nesta oferta e em mais 2 ofertas. Clique em “Testar conexão” para conferir.",
    });

    // Desmarcado: troca só aqui.
    await page.getByRole("button", { name: "Trocar chave" }).click();
    await page.getByRole("checkbox", { name: "Trocar também nelas" }).click();
    await page.getByLabel("Chave da API da Kyvo").fill("kyvo_live_outraChave123456789");
    await page.getByRole("button", { name: "Salvar chave" }).click();
    await page.getByRole("button", { name: "Trocar chave" }).waitFor();
    expect(await calls(page)).toEqual([
      {
        name: "savePaymentGatewayKeyAction",
        input: { offerId: "o1", provider: "KYVO", apiKey: "kyvo_live_novaChave1234567890", alsoOfferIds: ["o2", "o3"] },
      },
      {
        name: "savePaymentGatewayKeyAction",
        input: { offerId: "o1", provider: "KYVO", apiKey: "kyvo_live_outraChave123456789" },
      },
    ]);
    expect(await toasts(page)).toContainEqual({
      type: "success",
      message: "Chave salva. Clique em “Testar conexão” para conferir.",
    });
    // Uma oferta só: texto no singular.
    await page.evaluate((p) => (window as unknown as { OS: Record<string, (p: unknown) => void> }).OS.card(p), {
      offerId: "o1",
      account: KYVO_OK,
      sources: [sources[0], sources[2]],
    });
    await page.getByRole("button", { name: "Trocar chave" }).click();
    const one = page.locator('[data-slot="callout"]', { hasText: "Outra oferta usa esta mesma chave" });
    await one
      .getByText(/“Oferta México”\. Se você trocar só aqui, ela continua .* o pagamento dela para de funcionar/)
      .waitFor();
    expect(await page.getByRole("checkbox", { name: "Trocar também nela" }).isChecked()).toBe(true);
    await page.getByRole("button", { name: "Cancelar troca" }).click();
    // Ninguém mais com a mesma chave: sem aviso no "Trocar chave".
    await page.evaluate((p) => (window as unknown as { OS: Record<string, (p: unknown) => void> }).OS.card(p), {
      offerId: "o1",
      account: KYVO_OK,
      sources: [sources[2]],
    });
    await page.getByRole("button", { name: "Trocar chave" }).click();
    await page.getByLabel("Chave da API da Kyvo").waitFor();
    expect(await page.getByText(/usam? esta mesma chave/).count()).toBe(0);
    expect(await page.getByRole("checkbox").count()).toBe(0);
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
    await form.getByText("Falta a chave da Kyvo desta oferta").waitFor();
    // Escolheu "Pagamento na página": o cartão da conta da oferta aparece.
    await page.getByRole("heading", { name: "Pagamento na página — conta da Kyvo desta oferta" }).waitFor();
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

    // Euro: SPEI sai; Bizum e MB WAY (que o peso não aceitava) já vêm marcados, como num produto novo em
    // euro; idioma continua Español (padrão do EUR).
    await form.getByRole("combobox", { name: "Moeda" }).click();
    await page.getByRole("option", { name: "Euro (EUR)" }).click();
    expect(await form.getByRole("checkbox", { name: /SPEI/ }).isDisabled()).toBe(true);
    expect(await form.getByRole("checkbox", { name: /SPEI/ }).isChecked()).toBe(false);
    expect(await form.getByRole("checkbox", { name: /Bizum/ }).isChecked()).toBe(true);
    expect(await form.getByRole("checkbox", { name: /MB WAY/ }).isChecked()).toBe(true);
    // Dólar: idioma padrão vira English; só cartão.
    await form.getByRole("combobox", { name: "Moeda" }).click();
    await page.getByRole("option", { name: "Dólar americano (USD)" }).click();
    expect(await form.getByRole("combobox", { name: "Idioma da janela de pagamento" }).textContent()).toBe("English");
    expect(await form.getByRole("checkbox", { name: /Bizum/ }).isChecked()).toBe(false);
    await form.getByRole("combobox", { name: "Moeda" }).click();
    await page.getByRole("option", { name: "Euro (EUR)" }).click();
    expect(await form.getByRole("checkbox", { name: /Bizum/ }).isChecked()).toBe(true);
    await form.getByRole("checkbox", { name: /MB WAY/ }).uncheck();

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
        paymentAccount: KYVO_OK,
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
    expect(await form.getByText("Falta a chave da Kyvo desta oferta").count()).toBe(0);
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
      ["invalid_key", "A Kyvo recusou a chave"],
      ["missing_scope", "A chave da Kyvo não tem a permissão transactions:read"],
    ]) {
      const { page, errors } = await open("links", {
        offerId: "o1",
        links: [{ ...LINK, target: "PAYMENT", payment }],
        pages: PAGES,
        paymentAccount: { ...KYVO_OK, checkStatus: state, checkedAt: "2026-10-06T21:00:00.000Z" },
      });
      const form = page.getByRole("form", { name: "Produto do pagamento na página" });
      await form.getByText(title, { exact: true }).waitFor();
      expect(await form.getByRole("button", { name: "Abrir a conta da Kyvo desta oferta" }).count()).toBe(1);
      expect(errors).toEqual([]);
      await page.close();
    }
  });

  it("Novo link já como pagamento na página (sem URL)", async () => {
    const { page, errors } = await open("links", { offerId: "o1", links: [], pages: PAGES, paymentAccount: KYVO_OK });
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

  it("?link=<id> (“Abrir o link” do Próximos passos e dos avisos do ZIP): destaca, põe o foco e sai do endereço", async () => {
    const page = await browser.newPage({ locale: "pt-BR", viewport: { width: 1100, height: 500 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await blank(page, "?aba=links&link=l6");
    const links = [
      LINK,
      ...[2, 3, 4, 5, 6].map((n) => ({ ...LINK, id: `l${n}`, key: `c${n}`, label: `Checkout ${n}` })),
    ];
    await page.evaluate(
      (props) => (window as unknown as { OS: Record<string, (p: unknown) => void> }).OS.links(props),
      { offerId: "o1", links, pages: PAGES, paymentAccount: KYVO_OK },
    );
    const row = page.locator("#link-l6");
    await expect.poll(() => row.getAttribute("data-highlight")).toBe("true");
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("link-l6");
    expect(await page.locator("[data-highlight]").count()).toBe(1);
    await expect.poll(() => row.isVisible()).toBe(true);
    // Usado: sai do endereço (o resto fica).
    await expect.poll(() => page.evaluate(() => location.search)).toBe("?aba=links");
    // O mesmo "Abrir o link" de novo, com a página no topo: rola e põe o foco outra vez.
    await backToTop(page, row);
    await navigate(page, "/ofertas/o1?aba=links&link=l6");
    await expect.poll(() => row.getAttribute("data-highlight")).toBe("true");
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("link-l6");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => location.search)).toBe("?aba=links");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("sem link de pagamento: só o atalho discreto; ele abre o cartão com a chave em foco", async () => {
    const { page, errors } = await open("links", { offerId: "o1", links: [LINK], pages: PAGES });
    const heading = page.getByRole("heading", { name: "Pagamento na página — conta da Kyvo desta oferta" });
    await page.getByRole("button", { name: "Pagamento na página: conta da Kyvo desta oferta" }).waitFor();
    expect(await heading.count()).toBe(0);
    await page.getByRole("button", { name: "Pagamento na página: conta da Kyvo desta oferta" }).click();
    await heading.waitFor();
    await expect
      .poll(() => page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type))
      .toBe("password");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("formulário do link sem chave: o aviso leva ao cartão da oferta (rola e põe o foco na chave)", async () => {
    const payment = {
      name: "Curso",
      amount: "297,00",
      price: "MX$ 297,00",
      currency: "MXN",
      methods: ["SPEI"],
      locale: "ES",
      thankYouPageId: "p-obrigado",
      accessUrl: "https://membros.exemplo.com/x",
    };
    const page = await browser.newPage({ locale: "pt-BR", viewport: { width: 1100, height: 600 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await blank(page);
    const links = [
      { ...LINK, target: "PAYMENT", payment },
      ...[2, 3, 4].map((n) => ({ ...LINK, id: `l${n}`, key: `c${n}`, label: `Checkout ${n}` })),
    ];
    await page.evaluate(
      (props) => (window as unknown as { OS: Record<string, (p: unknown) => void> }).OS.links(props),
      {
        offerId: "o1",
        links,
        pages: PAGES,
        paymentKeySources: [{ offerId: "o2", offerName: "Oferta México", keyHint: "••••••1111" }],
      },
    );
    const form = page.getByRole("form", { name: "Produto do pagamento na página" });
    await form.getByText("Falta a chave da Kyvo desta oferta").waitFor();
    if (PRINTS) await page.screenshot({ path: path.join(PRINTS, "ui-link-pagamento-sem-chave.png"), fullPage: true });
    await form.getByRole("button", { name: "Cadastrar a chave desta oferta" }).click();
    const card = page.locator("#conta-pagamento");
    await expect.poll(() => card.getAttribute("data-highlight")).toBe("true");
    await expect
      .poll(() => page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type))
      .toBe("password");
    await expect.poll(() => card.isVisible()).toBe(true);
    await card.getByText("Ou use a mesma chave de outra oferta").waitFor();
    expect(errors).toEqual([]);
    await page.close();
  });

  it("?conta=pagamento (“Abrir a conta da Kyvo” do Próximos passos e dos avisos do ZIP): abre o cartão em foco, de novo a cada clique", async () => {
    const page = await browser.newPage({ locale: "pt-BR", viewport: { width: 1100, height: 500 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await blank(page, "?aba=links&conta=pagamento");
    // Vários links: o cartão fica bem abaixo da dobra.
    const links = [
      LINK,
      ...[2, 3, 4, 5, 6].map((n) => ({ ...LINK, id: `l${n}`, key: `c${n}`, label: `Checkout ${n}` })),
    ];
    await page.evaluate(
      (props) => (window as unknown as { OS: Record<string, (p: unknown) => void> }).OS.links(props),
      { offerId: "o1", links, pages: PAGES },
    );
    const card = page.locator("#conta-pagamento");
    const focusedType = () => page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type);
    await expect.poll(() => card.getAttribute("data-highlight")).toBe("true");
    await expect.poll(focusedType).toBe("password");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    // Usado: o ?conta sai do endereço. Trocar de aba ou voltar do editor não pula mais para o cartão.
    await expect.poll(() => page.evaluate(() => location.search)).toBe("?aba=links");

    // 2º clique em "Abrir a conta da Kyvo" (mesmo endereço), com a página no topo: rola e põe o foco de novo.
    for (const round of [2, 3]) {
      await backToTop(page, card);
      await navigate(page, "/ofertas/o1?aba=links&conta=pagamento");
      await expect.poll(() => card.getAttribute("data-highlight"), { message: `clique ${round}` }).toBe("true");
      await expect.poll(focusedType, { message: `clique ${round}` }).toBe("password");
      await expect.poll(() => page.evaluate(() => window.scrollY), { message: `clique ${round}` }).toBeGreaterThan(0);
      await expect.poll(() => page.evaluate(() => location.search)).toBe("?aba=links");
    }
    // Outra navegação sem o ?conta (ex.: só a aba): nada acontece.
    await backToTop(page, card);
    await navigate(page, "/ofertas/o1?aba=links");
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await card.getAttribute("data-highlight")).toBeNull();
    // No celular a barra fixa do topo (56 px) não cobre o título do cartão.
    expect(await card.getAttribute("class")).toMatch(/(^|\s)scroll-mt-20(\s|$)/);
    expect(await card.getAttribute("class")).toMatch(/(^|\s)md:scroll-mt-6(\s|$)/);
    expect(errors).toEqual([]);
    await page.close();
  });
});
