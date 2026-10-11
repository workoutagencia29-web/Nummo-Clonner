/**
 * Telas do checkout do Offer Studio num Chromium de verdade (ações de mentira,
 * que registram o que foi pedido):
 * - aba "Links e checkouts": destino "Checkout do Offer Studio" (só em links
 *   de checkout), no "Novo link" e num link que já existe;
 * - formulário do produto do checkout em seções (Produto, Dados do comprador,
 *   Endereço e frete, Order bumps, Aparência, Pagamento): campos travados pelo
 *   gateway, frete, bumps, imagens, erros por campo abrindo a seção certa;
 * - cartões "Checkout do Offer Studio — conta da FlevoPay/BlackCat desta
 *   oferta" (aparecem com o gateway escolhido; o aviso da chave leva até eles);
 * - oferta em peso mexicano: só a Kyvo, com SPEI e cartão.
 *
 * Capturas em OS_PRINTS_DIR, quando definido.
 */
import path from "node:path";
import { build, type Plugin } from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { panelCss } from "./tracking-ui-harness";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PRINTS = process.env.OS_PRINTS_DIR;

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { OfferLinks } from "@/components/offers/offer-links";
let root = null;
window.OS = {
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
const ok = (name) => (i) => reply(name, i, { ok: true, data: undefined });
export const savePaymentGatewayKeyAction = ok("savePaymentGatewayKeyAction");
export const removePaymentGatewayKeyAction = ok("removePaymentGatewayKeyAction");
export const copyPaymentGatewayKeyAction = ok("copyPaymentGatewayKeyAction");
export const testPaymentGatewayAction = ok("testPaymentGatewayAction");
export const savePaymentProductAction = ok("savePaymentProductAction");
export const setOfferLinkTargetAction = ok("setOfferLinkTargetAction");
export const createOfferLinkAction = (i) => reply("createOfferLinkAction", i, { ok: true, data: { id: "novo", key: "novo", ...i } });
export const updateOfferLinkAction = ok("updateOfferLinkAction");
export const deleteOfferLinkAction = ok("deleteOfferLinkAction");
export const checkoutPreviewUrlAction = (i) => reply("checkoutPreviewUrlAction", i, { ok: true, data: { url: "about:blank" } });
export const saveCheckoutProductAction = (i) => reply("saveCheckoutProductAction", i, {
  ok: true,
  data: { ...i, price: "R$ 97,00", currency: "BRL" },
});
`;

const stubs: Plugin = {
  name: "checkout-ui-stubs",
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
            ? `import { useSyncExternalStore } from "react";
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
let css: string;
let browser: Browser;

beforeAll(async () => {
  const out = await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "checkout-ui-entry.tsx" },
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
  css = await panelCss();
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
});

const OFFER_URL = "http://painel.os.test/ofertas/o1";
const SHA = "c".repeat(64);
/** Imagem enviada (SVG de exemplo, como um banner). */
const BANNER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300"><defs><linearGradient id="g"><stop offset="0" stop-color="#16a34a"/><stop offset="1" stop-color="#0f766e"/></linearGradient></defs><rect width="1200" height="300" fill="url(#g)"/><text x="600" y="170" font-size="64" font-family="sans-serif" text-anchor="middle" fill="white">Oferta especial</text></svg>`;

async function open(props: Record<string, unknown>, viewport = { width: 1100, height: 900 }) {
  const page = await browser.newPage({ locale: "pt-BR", viewport });
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  let uploads = 0;
  await page.route("http://painel.os.test/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/assets/upload") {
      uploads++;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: [{ src: `/os-assets/${SHA.slice(0, 63)}${uploads % 10}.svg` }] }),
      });
    }
    if (url.pathname.startsWith("/os-assets/")) {
      return route.fulfill({ contentType: "image/svg+xml", body: BANNER_SVG });
    }
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="pt-BR" class="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main id="root" style="padding:16px"></main></body></html>`,
    });
  });
  await page.goto(OFFER_URL);
  await page.addScriptTag({ content: bundle });
  await page.evaluate((p) => (window as unknown as { OS: { links: (p: unknown) => void } }).OS.links(p), props);
  return { page, errors };
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __calls?: { name: string; input: unknown }[] }).__calls ?? []);

const PAGES = [
  { id: "p1", name: "Vendas", type: "SALES" },
  { id: "p2", name: "Obrigado", type: "THANK_YOU" },
];

const account = (provider: string, label: string, configured = false) => ({
  provider,
  label,
  configured,
  keyHint: configured ? "••••••0123" : null,
  keyUnreadable: false,
  checkedAt: null,
  checkStatus: null,
});

const draftLink = {
  id: "l1",
  key: "checkout-principal",
  label: "Checkout principal",
  url: "",
  kind: "CHECKOUT",
  target: "CHECKOUT",
  checkout: null,
  usage: 2,
};

async function shot(page: Page, name: string, full = true) {
  if (!PRINTS) return;
  await page.screenshot({ path: path.join(PRINTS, name), fullPage: full });
}

describe("checkout do Offer Studio na aba de links", () => {
  it("real: FlevoPay por padrão, campos travados, aviso da chave abre o cartão, BlackCat mostra o dela", async () => {
    const { page, errors } = await open({
      offerId: "o1",
      links: [draftLink],
      pages: PAGES,
      offerCurrency: "BRL",
      checkoutCurrency: "BRL",
      checkoutAccounts: [account("FLEVOPAY", "FlevoPay"), account("BLACKCAT", "BlackCat")],
    });
    const form = page.getByRole("form", { name: "Produto do checkout do Offer Studio" });
    await form.waitFor();
    // Produto e Pagamento abertos no produto novo.
    await form.getByLabel("Nome do produto").waitFor();
    await expect.poll(() => form.getByRole("radio", { name: /FlevoPay/ }).isChecked()).toBe(true);
    expect(await form.getByRole("radio", { name: /Kyvo/ }).isDisabled()).toBe(true);
    await form.getByText("Só com peso mexicano, euro ou dólar.").waitFor();
    await form.getByText("Falta a chave da FlevoPay desta oferta").waitFor();
    expect(await page.getByText("Checkout do Offer Studio — conta da FlevoPay desta oferta").count()).toBe(0);
    await form.getByRole("button", { name: "Cadastrar a chave desta oferta" }).click();
    const card = page.getByRole("region", { name: "Checkout do Offer Studio — conta da FlevoPay desta oferta" });
    await card.waitFor();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("type"))).toBe("password");
    await card.getByText("PIX no Brasil, em real.").waitFor();

    // Dados do comprador: os 4 travados pela FlevoPay.
    await form.getByRole("button", { name: /Dados do comprador/ }).click();
    for (const label of ["Nome completo", "E-mail", "Telefone / WhatsApp", "CPF"]) {
      const box = form.getByRole("checkbox", { name: new RegExp(`^${label.replace("/", "\\/")}`) });
      expect(await box.isChecked()).toBe(true);
      expect(await box.isDisabled()).toBe(true);
    }
    // A explicação aparece uma vez; em cada campo, "Sempre pedido".
    await form.getByText("A FlevoPay exige nome, e-mail, telefone e CPF de quem compra para gerar o PIX.").waitFor();
    expect(await form.getByText("Sempre pedido: a FlevoPay exige.").count()).toBe(4);

    // BlackCat: o cartão dela aparece também.
    await form.getByRole("radio", { name: /BlackCat/ }).check();
    await page.getByRole("region", { name: "Checkout do Offer Studio — conta da BlackCat desta oferta" }).waitFor();
    await form.getByText("Falta a chave da BlackCat desta oferta").waitFor();
    await shot(page, "checkout-novo-link-real.png");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("preenche tudo e salva: erros por campo abrem a seção, frete, bump, imagem, cronômetro e textos", async () => {
    const { page, errors } = await open({
      offerId: "o1",
      links: [draftLink],
      pages: PAGES,
      offerCurrency: "BRL",
      checkoutCurrency: "BRL",
      checkoutAccounts: [account("FLEVOPAY", "FlevoPay", true), account("BLACKCAT", "BlackCat")],
    });
    const form = page.getByRole("form", { name: "Produto do checkout do Offer Studio" });
    await form.waitFor();
    // Chave da FlevoPay salva: sem aviso.
    expect(await form.getByText("Falta a chave da FlevoPay desta oferta").count()).toBe(0);
    // Página de obrigado escolhida sozinha (a única do tipo).
    await form.getByText("Depois do pagamento aprovado, o comprador vai para “Obrigado”.").waitFor();

    // Salvar vazio: erros no nome e no valor, foco no primeiro.
    await form.getByRole("button", { name: "Salvar e ligar o checkout" }).click();
    await form.getByText("Dê um nome ao produto (o comprador vê esse nome no checkout).").waitFor();
    await form.getByText("Digite o valor do produto, como 297,00.").waitFor();
    await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? "")).toMatch(/-name$/);
    expect((await calls(page)).filter((c) => c.name === "saveCheckoutProductAction")).toEqual([]);

    await form.getByLabel("Nome do produto").fill("Curso de Confeitaria");
    await form.getByLabel("Valor", { exact: true }).fill("97");
    await form.getByText("O comprador paga R$ 97,00.").waitFor();
    await form
      .getByLabel(/Preço “de”/)
      .first()
      .fill("197,00");
    await form
      .getByLabel(/Descrição curta/)
      .first()
      .fill("40 aulas e acesso vitalício.");
    await form.getByLabel("Link de acesso ao produto").fill("https://area.com/curso");

    // Endereço e frete.
    await form.getByRole("button", { name: /Endereço e frete/ }).click();
    await form.getByRole("checkbox", { name: /Pedir o endereço de entrega/ }).check();
    await form.getByRole("button", { name: "Adicionar opção de frete" }).click();
    await form.getByLabel("Nome", { exact: true }).nth(1).fill("Correios PAC");
    await form.getByLabel("Prazo", { exact: true }).nth(1).fill("5 a 9 dias úteis");
    await form.getByLabel("Preço", { exact: true }).nth(1).fill("19,90");

    // Order bump sem título: o erro abre a seção e põe o foco no campo.
    await form.getByRole("button", { name: /Order bumps/ }).click();
    await form.getByRole("button", { name: "Adicionar order bump" }).click();
    await form.getByLabel("Preço", { exact: true }).nth(2).fill("27");
    await form.getByRole("button", { name: /Order bumps/ }).click();
    await form.getByRole("button", { name: "Salvar e ligar o checkout" }).click();
    await form.getByText("Dê um título ao order bump.").waitFor();
    await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? "")).toMatch(/-bumps-0-title$/);
    await form.getByLabel("Título", { exact: true }).fill("Apostila com 50 receitas");
    await form.getByLabel("Link de acesso do bump").fill("drive.google.com/apostila");
    await form.getByText(/Com todos os order bumps e o frete mais caro, o total fica em R\$\s143,90\./).waitFor();

    // Aparência: banner, cronômetro, depoimento e o texto do botão.
    await form.getByRole("button", { name: /Aparência/ }).click();
    await page.getByLabel("Banner do computador: escolher arquivo").setInputFiles({
      name: "banner.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(BANNER_SVG),
    });
    await form.getByRole("button", { name: "Trocar banner do computador" }).waitFor();
    await form.getByLabel(/Cronômetro no topo/).fill("10");
    await form.getByText(/“Oferta termina em 10:00”/).waitFor();
    await form.getByRole("button", { name: "Adicionar depoimento" }).click();
    await form.getByLabel("Texto", { exact: true }).fill("Fiz o primeiro bolo na semana seguinte!");
    await form.getByLabel("Nome", { exact: true }).last().fill("Ana, de Curitiba");
    const button = form.getByLabel("Botão de pagar");
    expect(await button.getAttribute("placeholder")).toBe("Pagar com PIX");
    await button.fill("Quero meu acesso");
    if (PRINTS) {
      await page.setViewportSize({ width: 1100, height: 3200 });
      await shot(page, "checkout-formulario-completo.png");
      await page.setViewportSize({ width: 1100, height: 900 });
    }

    await form.getByRole("button", { name: "Salvar e ligar o checkout" }).click();
    await expect
      .poll(async () => (await calls(page)).filter((c) => c.name === "saveCheckoutProductAction").length)
      .toBe(1);
    const saved = (await calls(page)).find((c) => c.name === "saveCheckoutProductAction")?.input as Record<
      string,
      unknown
    > & { config: Record<string, unknown> };
    expect(saved).toMatchObject({
      linkId: "l1",
      name: "Curso de Confeitaria",
      amount: "97",
      provider: "FLEVOPAY",
      methods: ["PIX"],
      locale: "PT",
      thankYouPageId: "p2",
      accessUrl: "https://area.com/curso",
    });
    expect(saved.config).toMatchObject({
      compareAt: "197,00",
      description: "40 aulas e acesso vitalício.",
      // PIX: os quatro campos pedidos (travados pela FlevoPay), como sempre.
      fields: { name: true, email: true, phone: true, document: true },
      address: true,
      shipping: [
        { name: "Frete grátis", eta: "", price: "" },
        { name: "Correios PAC", eta: "5 a 9 dias úteis", price: "19,90" },
      ],
      bumps: [{ title: "Apostila com 50 receitas", price: "27", accessUrl: "drive.google.com/apostila" }],
      bannerDesktopSrc: expect.stringMatching(/^\/os-assets\/c{63}\d\.svg$/),
      timer: "10",
      testimonials: [{ text: "Fiz o primeiro bolo na semana seguinte!", name: "Ana, de Curitiba", photoSrc: null }],
      texts: { payButton: "Quero meu acesso" },
    });
    expect(errors).toEqual([]);
    await page.close();
  });

  it("peso mexicano: só a Kyvo, com SPEI e cartão; o produto novo pede só nome e e-mail (telefone e documento podem ser ligados)", async () => {
    const { page, errors } = await open({
      offerId: "o1",
      links: [draftLink],
      pages: PAGES,
      offerCurrency: "MXN",
      checkoutCurrency: "MXN",
      paymentAccount: account("KYVO", "Kyvo", true),
    });
    const form = page.getByRole("form", { name: "Produto do checkout do Offer Studio" });
    await form.waitFor();
    await expect.poll(() => form.getByRole("radio", { name: /Kyvo/ }).isChecked()).toBe(true);
    expect(await form.getByRole("radio", { name: /FlevoPay/ }).isDisabled()).toBe(true);
    expect(await form.getByRole("checkbox", { name: /SPEI/ }).isChecked()).toBe(true);
    expect(await form.getByRole("checkbox", { name: /Cartão/ }).isChecked()).toBe(true);
    expect(await form.getByRole("checkbox", { name: /Bizum/ }).count()).toBe(0);
    await form.getByText(/Textos do checkout em Español/).waitFor();
    await form.getByText(/Moeda:\s*Peso mexicano/).waitFor();
    await form.getByRole("button", { name: /Dados do comprador/ }).click();
    // A Kyvo só exige nome e e-mail: o produto novo começa sem telefone e sem documento.
    const phone = form.getByRole("checkbox", { name: /^Telefone/ });
    const doc = form.getByRole("checkbox", { name: /^Documento \(RFC, NIF…\)/ });
    expect(await phone.isDisabled()).toBe(false);
    expect(await phone.isChecked()).toBe(false);
    expect(await doc.isDisabled()).toBe(false);
    expect(await doc.isChecked()).toBe(false);
    expect(await form.getByRole("checkbox", { name: /^Nome completo/ }).isChecked()).toBe(true);
    expect(await form.getByRole("checkbox", { name: /^E-mail/ }).isChecked()).toBe(true);
    expect(await form.getByRole("checkbox", { name: /^E-mail/ }).isDisabled()).toBe(true);
    await form.getByRole("button", { name: /Dados do comprador/ }).click();
    await form.getByRole("button", { name: /Dados do comprador.*nome e e-mail/ }).waitFor();
    await form.getByRole("button", { name: /Dados do comprador/ }).click();
    // Pode ligar: o documento passa a ser pedido.
    await doc.check();
    await form.getByText("A Kyvo exige nome e e-mail de quem compra.").waitFor();
    expect(await form.getByText("Sempre pedido: a Kyvo exige.").count()).toBe(2);
    // Endereço e frete só no real: aqui, só a explicação (sem o liga/desliga).
    await form.getByRole("button", { name: /Endereço e frete/ }).click();
    await form.getByText(/só existem no checkout em real: em peso mexicano, o checkout não pede endereço/).waitFor();
    expect(await form.getByRole("checkbox", { name: /Pedir o endereço de entrega/ }).count()).toBe(0);
    // O cartão da Kyvo aparece com o nome do uso nesta oferta (o checkout, não o pagamento na página).
    await page.getByRole("region", { name: "Checkout do Offer Studio — conta da Kyvo desta oferta" }).waitFor();
    await shot(page, "checkout-peso-mexicano.png");
    // Salvo com o que foi marcado: nome, e-mail e documento; telefone não.
    await form.getByLabel("Nome do produto").fill("Curso de repostería");
    await form.getByLabel("Valor", { exact: true }).fill("499");
    await form.getByLabel("Link de acesso ao produto").fill("https://area.com/curso");
    await form.getByRole("button", { name: "Salvar e ligar o checkout" }).click();
    await expect
      .poll(async () => (await calls(page)).filter((c) => c.name === "saveCheckoutProductAction").length)
      .toBe(1);
    const saved = (await calls(page)).find((c) => c.name === "saveCheckoutProductAction")?.input as {
      provider: string;
      config: { fields: Record<string, boolean> };
    };
    expect(saved.provider).toBe("KYVO");
    expect(saved.config.fields).toEqual({ name: true, email: true, phone: false, document: true });
    expect(errors).toEqual([]);
    await page.close();
  });

  it("“Novo link” já como checkout; num link de endereço, escolher o checkout abre o formulário (Descartar volta)", async () => {
    const { page, errors } = await open({
      offerId: "o1",
      links: [
        {
          id: "l2",
          key: "checkout",
          label: "Checkout",
          url: "https://pay.hotmart.com/X1",
          kind: "CHECKOUT",
          target: "URL",
          usage: 1,
        },
      ],
      pages: PAGES,
      offerCurrency: "BRL",
      checkoutCurrency: "BRL",
    });
    // Link que já existe: destino → Checkout do Offer Studio.
    await page.getByRole("combobox", { name: "Destino do link Checkout" }).click();
    await page.getByRole("option", { name: "Checkout do Offer Studio" }).click();
    const form = page.getByRole("form", { name: "Produto do checkout do Offer Studio" });
    await form.waitFor();
    expect((await calls(page)).filter((c) => c.name === "setOfferLinkTargetAction")).toEqual([]);
    await form.getByRole("button", { name: "Descartar" }).click();
    await form.waitFor({ state: "detached" });
    await page.getByRole("textbox", { name: "URL do link Checkout" }).waitFor();

    // Novo link.
    await page.getByRole("textbox", { name: "Nome do novo link" }).fill("Checkout do upsell");
    await page.getByRole("combobox", { name: "Destino do novo link" }).click();
    await page.getByRole("option", { name: "Checkout do Offer Studio" }).click();
    await page.getByText(/Página de checkout do Offer Studio \(PIX em real; Kyvo nas outras moedas\)/).waitFor();
    expect(await page.getByRole("textbox", { name: "URL do novo link" }).count()).toBe(0);
    await page.getByRole("button", { name: "Adicionar" }).click();
    await expect
      .poll(async () => (await calls(page)).find((c) => c.name === "createOfferLinkAction")?.input)
      .toEqual({ offerId: "o1", label: "Checkout do upsell", url: "", kind: "CHECKOUT", target: "CHECKOUT" });
    // WhatsApp não pode ser checkout.
    await page.getByRole("combobox", { name: "Tipo do novo link" }).click();
    await page.getByRole("option", { name: "WhatsApp" }).click();
    await page.getByRole("combobox", { name: "Destino do novo link" }).click();
    expect(await page.getByRole("option", { name: "Checkout do Offer Studio (só checkout)" }).isDisabled()).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("checkout salvo: selo com o preço e o gateway, seções fechadas com o resumo; celular sem rolar para o lado", async () => {
    const config = {
      description: "",
      compareAt: "",
      imageSrc: null,
      fields: { name: true, email: true, phone: true, document: true },
      address: false,
      shipping: [],
      shippingDefault: null,
      bumps: [
        {
          id: "bump0001",
          title: "Apostila",
          description: "",
          price: "27,00",
          compareAt: "",
          imageSrc: null,
          accessUrl: "",
        },
      ],
      bannerDesktopSrc: null,
      bannerMobileSrc: null,
      logoSrc: null,
      color: "#16a34a",
      timer: "",
      badges: { secure: true, guarantee: true },
      testimonials: [],
      texts: {},
    };
    const props = {
      offerId: "o1",
      links: [
        {
          ...draftLink,
          checkout: {
            provider: "FLEVOPAY",
            name: "Curso de Confeitaria",
            amount: "97,00",
            price: "R$ 97,00",
            currency: "BRL",
            methods: ["PIX"],
            locale: "PT",
            thankYouPageId: "p2",
            accessUrl: "https://area.com/curso",
            config,
          },
        },
      ],
      pages: PAGES,
      offerCurrency: "BRL",
      checkoutCurrency: "BRL",
      checkoutAccounts: [account("FLEVOPAY", "FlevoPay", true), account("BLACKCAT", "BlackCat")],
    };
    const { page, errors } = await open(props);
    await page.getByText("R$ 97,00 · FlevoPay").waitFor();
    const form = page.getByRole("form", { name: "Produto do checkout do Offer Studio" });
    await form.getByText("Curso de Confeitaria · R$ 97,00").waitFor();
    await form.getByText("1 order bump").waitFor();
    await form.getByText("FlevoPay · PIX").waitFor();
    await form.getByText("Tudo salvo").waitFor();
    // A conta da FlevoPay (usada e com chave) aparece; a da BlackCat, não.
    await page.getByRole("region", { name: "Checkout do Offer Studio — conta da FlevoPay desta oferta" }).waitFor();
    expect(await page.getByText("Checkout do Offer Studio — conta da BlackCat desta oferta").count()).toBe(0);
    await shot(page, "checkout-salvo.png");
    await page.close();

    const mobile = await open(props, { width: 390, height: 844 });
    await mobile.page.getByText("R$ 97,00 · FlevoPay").waitFor();
    await mobile.page.getByRole("button", { name: /Order bumps/ }).click();
    expect(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(mobile.page, "checkout-celular.png");
    expect([...errors, ...mobile.errors]).toEqual([]);
    await mobile.page.close();
  });

  it("fase 1 e ajustes: aviso da página, resumo, frete marcado, bump sem acesso, erro do total, exclusão e saída", async () => {
    const config = {
      description: "",
      compareAt: "",
      imageSrc: null,
      fields: { name: true, email: true, phone: true, document: true },
      address: true,
      shipping: [
        { id: "frete001", name: "Frete grátis", eta: "", price: "" },
        { id: "frete002", name: "Sedex", eta: "2 dias", price: "29,90" },
      ],
      shippingDefault: "frete002",
      bumps: [
        {
          id: "bump0001",
          title: "Apostila",
          description: "",
          price: "27,00",
          compareAt: "",
          imageSrc: null,
          accessUrl: "",
        },
      ],
      bannerDesktopSrc: null,
      bannerMobileSrc: null,
      logoSrc: null,
      color: "#16a34a",
      timer: "",
      badges: { secure: true, guarantee: true },
      testimonials: [],
      texts: {},
    };
    const checkout = {
      provider: "FLEVOPAY",
      name: "Curso de Confeitaria",
      amount: "97,00",
      price: "R$ 97,00",
      currency: "BRL",
      methods: ["PIX"],
      locale: "PT",
      thankYouPageId: "p2",
      accessUrl: "https://area.com/curso",
      config,
    };
    const beforeUnload = (page: Page) =>
      page.evaluate(() => {
        const e = new Event("beforeunload", { cancelable: true });
        dispatchEvent(e);
        return e.defaultPrevented;
      });
    const { page, errors } = await open({
      offerId: "o1",
      links: [{ ...draftLink, checkout }],
      pages: PAGES,
      offerCurrency: "BRL",
      checkoutCurrency: "BRL",
      checkoutAccounts: [account("FLEVOPAY", "FlevoPay", true), account("BLACKCAT", "BlackCat")],
    });
    const form = page.getByRole("form", { name: "Produto do checkout do Offer Studio" });
    await form.waitFor();
    // A página de checkout: na prévia em simulação; no ZIP, cobra de verdade pelo pagamento.php.
    await form.getByText("Página de checkout", { exact: true }).waitFor();
    await form.getByText(/No site publicado \(ZIP\), ela vai na pasta checkout\/ e cobra de verdade/).waitFor();
    // "Ver checkout" abre a página salva na prévia (aba nova).
    await form.getByRole("button", { name: "Ver checkout" }).click();
    await expect
      .poll(async () => (await calls(page)).filter((c) => c.name === "checkoutPreviewUrlAction").map((c) => c.input))
      .toEqual([{ linkId: draftLink.id }]);
    // Resumo com as siglas certas; o bump sem acesso aparece no resumo e no aviso de baixo.
    await form.getByText("Pede nome, e-mail, WhatsApp e CPF").waitFor();
    await form.getByText("1 order bump · 1 sem link de acesso").waitFor();
    await form.getByText(/Falta colar o link de acesso do order bump “Apostila”/).waitFor();
    expect(await beforeUnload(page)).toBe(false);

    // Apagar o frete marcado: o primeiro que sobra passa a vir marcado.
    await form.getByRole("button", { name: /Endereço e frete/ }).click();
    const radios = form.getByRole("radio", { name: "Já vem escolhida" });
    await expect
      .poll(async () => [await radios.nth(0).isChecked(), await radios.nth(1).isChecked()])
      .toEqual([false, true]);
    await form.getByRole("button", { name: "Apagar o frete Sedex" }).click();
    await expect.poll(() => radios.count()).toBe(1);
    expect(await radios.first().isChecked()).toBe(true);
    await form.getByRole("button", { name: "Adicionar opção de frete" }).click();
    expect(await radios.nth(0).isChecked()).toBe(true);
    expect(await radios.nth(1).isChecked()).toBe(false);
    expect(await beforeUnload(page)).toBe(true);

    // Erro do maior total (vem do servidor, no campo dos bumps): some ao corrigir pelo valor do produto.
    await page.evaluate(() => {
      (window as unknown as { __replies: unknown }).__replies = {
        saveCheckoutProductAction: {
          ok: false,
          error:
            "Com todos os order bumps, o total fica em R$ 104.999,00: o valor máximo do PIX é R$ 100.000,00 por compra.",
          field: "bumps",
        },
      };
    });
    await form.getByLabel("Nome", { exact: true }).nth(1).fill("PAC");
    await form.getByRole("button", { name: "Salvar checkout" }).click();
    const totalError = form.getByText(/o total fica em R\$ 104\.999,00/);
    await totalError.waitFor();
    await form.getByText("1 ajuste").waitFor();
    await form.getByRole("button", { name: /^Produto/ }).click();
    await form.getByLabel("Valor", { exact: true }).fill("90");
    await totalError.waitFor({ state: "detached" });
    expect(await form.getByText("1 ajuste").count()).toBe(0);

    // Salvo: aviso neutro (a página de checkout ainda não existe).
    await page.evaluate(() => {
      (window as unknown as { __replies: unknown }).__replies = {};
    });
    await form.getByRole("button", { name: "Salvar checkout" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __toasts?: { message: string }[] }).__toasts ?? []))
      .toContainEqual({ type: "success", message: "Checkout salvo." });

    // Excluir o link avisa que o checkout vai junto.
    await page.getByRole("button", { name: "Excluir o link Checkout principal" }).click();
    await page
      .getByRole("alertdialog")
      .getByText(/Excluir o link apaga também o checkout do Offer Studio dele \(produto, order bumps, frete/)
      .waitFor();
    expect(errors).toEqual([]);
    await page.close();

    // Link já gravado como checkout e ainda sem produto: dá para salvar, mas sair não pergunta (nada mudou).
    const fresh = await open({
      offerId: "o1",
      links: [draftLink],
      pages: PAGES,
      offerCurrency: "BRL",
      checkoutCurrency: "BRL",
    });
    const freshForm = fresh.page.getByRole("form", { name: "Produto do checkout do Offer Studio" });
    await freshForm.getByText("Este link ainda não tem o checkout salvo").waitFor();
    expect(await freshForm.getByRole("button", { name: "Salvar e ligar o checkout" }).isEnabled()).toBe(true);
    expect(await beforeUnload(fresh.page)).toBe(false);
    await freshForm.getByLabel("Nome do produto").fill("Curso");
    expect(await beforeUnload(fresh.page)).toBe(true);
    expect(fresh.errors).toEqual([]);
    await fresh.page.close();

    // Conta da BlackCat não liberada (chave válida): esperar e testar de novo, não trocar a chave.
    const blocked = await open({
      offerId: "o1",
      links: [{ ...draftLink, checkout: { ...checkout, provider: "BLACKCAT" } }],
      pages: PAGES,
      offerCurrency: "BRL",
      checkoutCurrency: "BRL",
      checkoutAccounts: [
        account("FLEVOPAY", "FlevoPay"),
        {
          ...account("BLACKCAT", "BlackCat", true),
          checkedAt: "2026-10-10T12:00:00.000Z",
          checkStatus: "missing_scope",
        },
      ],
    });
    const blockedForm = blocked.page.getByRole("form", { name: "Produto do checkout do Offer Studio" });
    await blockedForm.getByText("A BlackCat não liberou a conta").waitFor();
    await blockedForm.getByText(/espere a BlackCat liberar a conta \(a chave é válida\)/).waitFor();
    expect(await blockedForm.getByText(/troque a chave/).count()).toBe(0);
    expect(blocked.errors).toEqual([]);
    await blocked.page.close();
  });
});
