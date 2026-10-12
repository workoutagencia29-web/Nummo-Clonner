/**
 * Moeda da oferta nas telas do painel, num Chromium de verdade (com o CSS do
 * painel):
 *
 * - "Nova oferta": pergunta "Em qual moeda essa oferta vai rodar?" com real,
 *   peso mexicano, euro e dólar; vem marcada a última escolhida (real na
 *   primeira vez); modelo com preço escrito em R$ avisa numa linha; a ação
 *   recebe a moeda;
 * - "Salvar como oferta" da clonagem: a mesma pergunta, com a última marcada;
 * - aba "Moeda, empresa e SEO": trocar a moeda (ação e banco de verdade) abre a
 *   confirmação com tudo o que muda (vitrines, caixas, produtos com o preço na
 *   moeda nova, Kyvo, pixels no formato do painel, preço escrito como texto);
 *   Cancelar não grava; o aviso depois da troca fica até ser fechado quando há
 *   o que conferir; em real, o aviso de que a Kyvo não cobra em real; página
 *   que voltou para a moeda de antes: o cartão avisa, o atalho do "Próximos
 *   passos" (?campo=moeda) chega ao "Passar tudo para …", que conserta;
 * - produto da Kyvo depois da troca: moeda nova e o valor fora da faixa no campo;
 * - pagamento na página (Kyvo): o produto novo começa na moeda da oferta, com
 *   as formas de pagamento e o idioma dela; oferta em real avisa que a Kyvo não
 *   cobra em real e deixa escolher outra; oferta de antes da pergunta não diz
 *   que "roda em real", e o segundo produto começa na moeda do já salvo;
 * - "Nova página" e versão A/B a partir de modelo: o aviso do R$ escrito;
 * - "Valor da oferta" dos pixels na moeda da oferta (com o peso mexicano);
 * - abas da oferta no celular: o nome novo com o ponto de "não salvo" cabe.
 */
import path from "node:path";
import { build, type Plugin } from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { checkoutConfigDraft, parseCheckoutConfig } from "@/lib/checkout/config";
import { prisma } from "@/lib/db";
import { offerCurrencyOf } from "@/lib/offer-currency";
import { switchHtmlCurrency } from "@/lib/offer-currency-switch";
import * as checkoutActions from "@/server/actions/checkout";
import * as cloneActions from "@/server/actions/clone";
import * as offerLinkActions from "@/server/actions/offer-links";
import * as offerActions from "@/server/actions/offers";
import * as pageActions from "@/server/actions/pages";
import * as paymentActions from "@/server/actions/payments";
import * as variantActions from "@/server/actions/variants";
import { saveCheckoutProduct } from "@/server/services/checkout/products";
import { CURRENCY_SWITCH_CONFLICT, switchOfferCurrency } from "@/server/services/offer-currency";
import { createOfferLink, listOfferLinks } from "@/server/services/offer-links";
import { createOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { offerPaymentAccounts, savePaymentGatewayKey } from "@/server/services/payments/gateways";
import { savePaymentProduct } from "@/server/services/payments/products";
import { saveTrackingSettings } from "@/server/services/tracking";
import { listVariants } from "@/server/services/variants";
import type { CloneResult } from "@/worker/clone/types";
import { resetDatabase } from "../setup/per-file";
import { KYVO_KEY } from "./kyvo-fake";
import { callsOf, choose, openPanel, panelCss, toasts, waitFor, waitToast } from "./tracking-ui-harness";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ORIGIN = "http://painel.test";
const PRINTS = process.env.OS_PRINTS_DIR;

const ENTRY = `
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { CreateOfferDialog } from "@/components/app/create-offer-dialog";
import { CloneReview } from "@/app/(painel)/clonar/[jobId]/clone-review";
import { OfferLinks } from "@/components/offers/offer-links";
import { OfferTabs } from "@/components/offers/offer-tabs";
import { PageDialog } from "@/components/offers/page-dialog";
import { VariantsDialog } from "@/components/offers/variants/variants-dialog";
import { TabsContent } from "@/components/ui/tabs";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";

let root = null;
function NewOffer(props) {
  const [open, setOpen] = useState(true);
  window.__reopen = () => setOpen(true);
  return createElement("div", null,
    createElement("button", { type: "button", onClick: () => setOpen(true) }, "Nova oferta"),
    createElement(CreateOfferDialog, { ...props, open, onOpenChange: setOpen }),
  );
}
function NewPage(props) {
  const [open, setOpen] = useState(true);
  return createElement(PageDialog, { ...props, open, onOpenChange: setOpen });
}
function Variants(props) {
  return createElement(VariantsDialog, { ...props, onClose: () => {} });
}
/** Formulário com mudança não salva: a aba dele ganha o ponto. */
function Dirty() {
  useUnsavedChanges(true);
  return createElement("p", null, "Formulário com mudança");
}
function Tabs() {
  return createElement(OfferTabs, null,
    createElement(TabsContent, { value: "paginas", keepMounted: true }, "Páginas"),
    createElement(TabsContent, { value: "configuracoes", keepMounted: true }, createElement(Dirty)),
  );
}
const KINDS = { new: NewOffer, clone: CloneReview, links: OfferLinks, page: NewPage, variants: Variants, tabs: Tabs };
window.OS = {
  render(kind, props) {
    // Respostas das ações antes de montar (a lista de versões é pedida logo ao abrir).
    if (props && props.__replies) window.__replies = props.__replies;
    root = root || createRoot(document.getElementById("root"));
    root.render(createElement(KINDS[kind], props));
  },
};
`;

/** Ações de mentira (anotam o pedido e respondem ok), com os nomes das de verdade. */
const ACTIONS: Record<string, string[]> = {
  offers: Object.keys(offerActions),
  clone: Object.keys(cloneActions),
  payments: Object.keys(paymentActions),
  checkout: Object.keys(checkoutActions),
  "offer-links": Object.keys(offerLinkActions),
  pages: Object.keys(pageActions),
  variants: Object.keys(variantActions),
};

const stubs: Plugin = {
  name: "moeda-ui-stubs",
  setup(b) {
    b.onResolve({ filter: /^sonner$/ }, () => ({ path: "sonner", namespace: "stub" }));
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "stub" }));
    b.onResolve({ filter: /^@\/server\/actions\// }, (args) => ({
      path: args.path.replace("@/server/actions/", ""),
      namespace: "action",
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
               const sub = (cb) => { addEventListener("popstate", cb); return () => removeEventListener("popstate", cb); };
               export function useSearchParams() { return new URLSearchParams(useSyncExternalStore(sub, () => location.search)); }
               export function usePathname() { return location.pathname; }
               export function useRouter() {
                 return { push: (h) => (window.__navs = [...(window.__navs || []), h]), replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} };
               }`
            : `import { createElement } from "react";
               export default function Link({ href, children, scroll, prefetch, ...rest }) {
                 return createElement("a", { href, ...rest }, children);
               }`,
    }));
    b.onLoad({ filter: /.*/, namespace: "action" }, (args) => {
      const names = ACTIONS[args.path];
      if (!names) throw new Error(`server action sem stub: ${args.path}`);
      return {
        loader: "js",
        contents: names
          .map(
            (n) => `export const ${n} = (input) => {
              (window.__calls = window.__calls || []).push({ name: ${JSON.stringify(n)}, input });
              const r = (window.__replies || {})[${JSON.stringify(n)}];
              return Promise.resolve(r || { ok: true, data: { id: "nova-oferta", ...input } });
            };`,
          )
          .join("\n"),
      };
    });
  },
};

let bundle: string;
let browser: Browser;

beforeAll(async () => {
  const out = await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "moeda-ui-entry.tsx" },
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
}, 180_000);

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  await resetDatabase();
});

type Kind = "new" | "clone" | "links" | "page" | "variants" | "tabs";

async function open(kind: Kind, props: Record<string, unknown>, viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ locale: "pt-BR", viewport });
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const css = await panelCss();
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="pt-BR" class="light"><head><meta charset="utf-8"><style>${css}</style></head>
        <body><main id="root" style="padding:24px"></main></body></html>`,
    });
  });
  await page.goto(`${ORIGIN}/ofertas/o1`);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(
    ([k, p]) => (window as unknown as { OS: { render(k: string, p: unknown): void } }).OS.render(k, p),
    [kind, props] as const,
  );
  return { page, errors };
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __calls?: { name: string; input: unknown }[] }).__calls ?? []);

/** Nome acessível da moeda marcada no grupo (fieldset) da pergunta. */
const checkedCurrency = (page: Page, question = "Em qual moeda essa oferta vai rodar?") =>
  page.getByRole("group", { name: question }).getByRole("radio", { checked: true }).getAttribute("value");

describe("Nova oferta", () => {
  it("pergunta a moeda (real na primeira vez), avisa do R$ escrito no modelo e manda a escolhida", async () => {
    const { page, errors } = await open("new", { folders: [] });
    const dialog = page.getByRole("dialog", { name: "Nova oferta" });
    const group = dialog.getByRole("group", { name: "Em qual moeda essa oferta vai rodar?" });
    await group.waitFor();
    const names = await group
      .getByRole("radio")
      .evaluateAll((els) =>
        els.map((el) => (el as HTMLInputElement).labels?.[0]?.textContent?.replace(/\s+/g, " ").trim()),
      );
    expect(names).toEqual(["Real (R$)", "Peso mexicano ($)", "Euro (€)", "Dólar (US$)"]);
    expect(await checkedCurrency(page)).toBe("BRL");
    await dialog
      .getByText("Vitrines, caixa de compra e pagamento na página nascem nessa moeda.", { exact: false })
      .waitFor();
    // Real + página de vendas (preços escritos em R$): nada a avisar.
    expect(await dialog.getByText(/preços escritos neste modelo/).count()).toBe(0);

    // Euro com a página de vendas (padrão): a linha do aviso aparece; com a loja, some.
    await group.getByRole("radio", { name: "Euro (€)" }).check();
    await dialog.getByText("Os preços escritos neste modelo estão em R$ (são texto): troque-os no editor.").waitFor();
    if (PRINTS) await page.screenshot({ path: path.join(PRINTS, "nova-oferta-euro-aviso-r$.png") });
    await dialog.getByRole("radio", { name: "Loja (vitrine)" }).click();
    expect(await dialog.getByText(/preços escritos neste modelo/).count()).toBe(0);

    // Teclado: as setas andam entre as moedas.
    await group.getByRole("radio", { name: "Euro (€)" }).focus();
    await page.keyboard.press("ArrowRight");
    expect(await checkedCurrency(page)).toBe("USD");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    expect(await checkedCurrency(page)).toBe("MXN");

    await dialog.getByLabel("Nome da oferta").fill("Loja México");
    await dialog.getByRole("button", { name: "Criar oferta" }).click();
    await page.waitForFunction(() => ((window as unknown as { __calls?: unknown[] }).__calls ?? []).length > 0);
    expect(await calls(page)).toEqual([
      {
        name: "createOfferAction",
        input: { name: "Loja México", folderId: null, tagIds: [], currency: "MXN", templateId: "loja" },
      },
    ]);
    expect(await page.evaluate(() => (window as unknown as { __navs?: string[] }).__navs)).toEqual([
      "/ofertas/nova-oferta",
    ]);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("vem marcada a última moeda escolhida (e volta a ela ao abrir de novo)", async () => {
    const { page, errors } = await open("new", { folders: [], defaultCurrency: "MXN" });
    const dialog = page.getByRole("dialog", { name: "Nova oferta" });
    await dialog.getByRole("group", { name: "Em qual moeda essa oferta vai rodar?" }).waitFor();
    expect(await checkedCurrency(page)).toBe("MXN");
    if (PRINTS) await page.screenshot({ path: path.join(PRINTS, "nova-oferta-pergunta-moeda.png") });
    await dialog.getByRole("radio", { name: "Dólar (US$)" }).check();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Nova oferta" }).click();
    await dialog.waitFor();
    expect(await checkedCurrency(page)).toBe("MXN");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("no celular: as moedas em duas colunas, sem rolagem para o lado", async () => {
    const { page, errors } = await open("new", { folders: [], defaultCurrency: "EUR" }, { width: 390, height: 844 });
    const group = page.getByRole("group", { name: "Em qual moeda essa oferta vai rodar?" });
    await group.waitFor();
    const boxes = await group.getByRole("radio").evaluateAll((els) =>
      els.map((el) => {
        const r = (el.closest("label") as HTMLElement).getBoundingClientRect();
        return { top: Math.round(r.top), right: Math.round(r.right) };
      }),
    );
    expect(new Set(boxes.map((b) => b.top)).size).toBe(2);
    expect(Math.max(...boxes.map((b) => b.right))).toBeLessThanOrEqual(390);
    const dialogScroll = await page
      .getByRole("dialog", { name: "Nova oferta" })
      .evaluate((d) => d.scrollWidth - d.clientWidth);
    expect(dialogScroll).toBe(0);
    if (PRINTS) await page.screenshot({ path: path.join(PRINTS, "nova-oferta-celular.png") });
    expect(errors).toEqual([]);
    await page.close();
  });
});

const CLONE_RESULT: CloneResult = {
  title: "Loja",
  finalUrl: "https://loja.exemplo.com/",
  responsive: true,
  devices: {
    desktop: {
      outputs: {
        EDITABLE: { htmlKey: "clones/x/d-e.html" },
        PRESERVE_JS: { htmlKey: "clones/x/d-p.html", assetMap: {} },
      },
    },
  },
  removed: [],
  checkouts: [],
  funnel: [],
  videos: [],
  delay: null,
  warnings: [],
  suggestedMode: "EDITABLE",
  assets: [],
  stats: { assets: 1, bytes: 1, failed: 0, blockedRequests: 0, durationMs: 1 },
};

const cloneProps = (extra: Record<string, unknown> = {}) => ({
  jobId: "job1",
  label: "https://loja.exemplo.com/",
  result: CLONE_RESULT,
  defaultName: "Loja",
  previews: {},
  folders: [],
  initialChildren: [],
  funnelKeys: {},
  capturedDevices: ["desktop"],
  ...extra,
});

describe("Salvar como oferta (clonagem)", () => {
  it("pergunta a moeda com a última marcada e manda a escolhida", async () => {
    const { page, errors } = await open("clone", cloneProps({ defaultCurrency: "USD" }));
    const group = page.getByRole("group", { name: "Em qual moeda essa oferta vai rodar?" });
    await group.waitFor();
    expect(await checkedCurrency(page)).toBe("USD");
    await page.getByText("A página clonada fica como veio.", { exact: false }).waitFor();
    await group.getByRole("radio", { name: "Peso mexicano ($)" }).check();
    if (PRINTS) {
      await page
        .getByText("Salvar como oferta", { exact: true })
        .locator("xpath=ancestor::div[@data-slot='card'][1]")
        .screenshot({ path: path.join(PRINTS, "clonagem-salvar-como-oferta-moeda.png") });
    }
    await page.getByRole("button", { name: "Salvar oferta" }).click();
    await page.waitForFunction(() => ((window as unknown as { __calls?: unknown[] }).__calls ?? []).length > 0);
    expect(await calls(page)).toEqual([
      {
        name: "saveCloneAction",
        input: {
          jobId: "job1",
          name: "Loja",
          folderId: null,
          mode: "EDITABLE",
          currency: "MXN",
          keepRemoved: [],
          childJobIds: [],
          modes: { job1: "EDITABLE" },
        },
      },
    ]);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("sem preferência: real", async () => {
    const { page } = await open("clone", cloneProps());
    await page.getByRole("group", { name: "Em qual moeda essa oferta vai rodar?" }).waitFor();
    expect(await checkedCurrency(page)).toBe("BRL");
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

/**
 * Abre a aba de links numa oferta na moeda `currency` (sem: oferta de antes da
 * pergunta) e liga o pagamento na página no link `pick` (o checkout).
 */
async function paymentForm(currency: string | undefined, links: (typeof LINK)[] = [LINK], pick = 0) {
  const { page, errors } = await open("links", {
    offerId: "o1",
    links,
    pages: PAGES,
    ...(currency && { offerCurrency: currency }),
  });
  if (links[pick].target !== "PAYMENT") {
    await page.getByRole("combobox", { name: `Destino do link ${links[pick].label}` }).click();
    await page.getByRole("option", { name: "Pagamento na página" }).click();
  }
  // O formulário do link escolhido (os links de pagamento antes dele também têm o deles).
  const before = links.slice(0, pick).filter((l) => l.target === "PAYMENT").length;
  const form = page.getByRole("form", { name: "Produto do pagamento na página" }).nth(before);
  await form.waitFor();
  const state = async () => ({
    currency: await form.getByRole("combobox", { name: "Moeda" }).textContent(),
    locale: await form.getByRole("combobox", { name: "Idioma da janela de pagamento" }).textContent(),
    checked: await form
      .getByRole("checkbox")
      .evaluateAll((els) =>
        els
          .filter((el) => (el as HTMLInputElement).checked)
          .map((el) => el.closest("label")?.querySelector(".font-medium")?.textContent),
      ),
    realWarning: await form.getByText("A Kyvo não cobra em real").count(),
  });
  return { page, errors, form, state };
}

describe("pagamento na página: o produto novo começa na moeda da oferta", () => {
  it("peso mexicano: SPEI e cartão, janela em espanhol", async () => {
    const { page, errors, state } = await paymentForm("MXN");
    expect(await state()).toEqual({
      currency: "Peso mexicano (MXN)",
      locale: "Español",
      checked: ["SPEI", "Cartão"],
      realWarning: 0,
    });
    if (PRINTS) await page.screenshot({ path: path.join(PRINTS, "kyvo-produto-novo-mxn.png"), fullPage: true });
    expect(errors).toEqual([]);
    await page.close();
  });

  it("euro: cartão, Bizum e MB WAY (SPEI fica de fora); dólar: só cartão, em inglês", async () => {
    const euro = await paymentForm("EUR");
    expect(await euro.state()).toEqual({
      currency: "Euro (EUR)",
      locale: "Español",
      checked: ["Cartão", "Bizum", "MB WAY"],
      realWarning: 0,
    });
    expect(await euro.form.getByRole("checkbox", { name: /SPEI/ }).isDisabled()).toBe(true);
    await euro.page.close();
    const dollar = await paymentForm("USD");
    expect(await dollar.state()).toEqual({
      currency: "Dólar americano (USD)",
      locale: "English",
      checked: ["Cartão"],
      realWarning: 0,
    });
    await dollar.page.close();
  });

  it("oferta em real: avisa que a Kyvo não cobra em real e deixa escolher outra moeda", async () => {
    const { page, errors, form, state } = await paymentForm("BRL");
    expect(await state()).toMatchObject({ currency: "Peso mexicano (MXN)", realWarning: 1 });
    await form
      .getByText(
        /Esta oferta roda em\s+Real \(R\$\), mas o pagamento na página só cobra em peso mexicano, euro ou dólar/,
      )
      .waitFor();
    if (PRINTS) await page.screenshot({ path: path.join(PRINTS, "kyvo-oferta-em-real.png"), fullPage: true });
    await form.getByRole("combobox", { name: "Moeda" }).click();
    await page.getByRole("option", { name: "Euro (EUR)" }).click();
    // Trocar a moeda mantém as formas que combinam com ela (cartão) e marca as da moeda nova que o
    // peso não aceitava (Bizum e MB WAY), como num produto novo em euro.
    expect(await state()).toMatchObject({ currency: "Euro (EUR)", checked: ["Cartão", "Bizum", "MB WAY"] });
    expect(errors).toEqual([]);
    await page.close();
  });

  it("oferta de antes da pergunta (sem moeda gravada): peso mexicano, sem dizer que ela “roda em real”", async () => {
    const { page, errors, form, state } = await paymentForm(undefined);
    expect(await state()).toEqual({
      currency: "Peso mexicano (MXN)",
      locale: "Español",
      checked: ["SPEI", "Cartão"],
      realWarning: 0,
    });
    expect(await form.getByText(/Esta oferta roda em/).count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });

  const SAVED = {
    name: "Curso",
    amount: "297,00",
    price: "€ 297,00",
    currency: "EUR",
    methods: ["CARD"],
    locale: "PT",
    thankYouPageId: null,
    accessUrl: "",
  };
  const UPSELL = { ...LINK, id: "l2", key: "upsell", label: "Upsell", url: "https://pay.hotmart.com/X2", usage: 1 };

  it("produto já salvo numa oferta em real: a moeda dele fica e o aviso não aparece", async () => {
    const { page, state } = await paymentForm("BRL", [{ ...LINK, target: "PAYMENT", payment: SAVED } as never]);
    expect(await state()).toEqual({ currency: "Euro (EUR)", locale: "Português", checked: ["Cartão"], realWarning: 0 });
    await page.close();
  });

  it("segundo produto (upsell): sem moeda da Kyvo na oferta, começa na moeda do produto já salvo, sem o aviso", async () => {
    const saved = [{ ...LINK, target: "PAYMENT", payment: { ...SAVED, currency: "MXN", price: "$297.00" } }, UPSELL];
    // Oferta de antes da pergunta que já cobra em peso.
    const old = await paymentForm(undefined, saved as never, 1);
    expect(await old.state()).toEqual({
      currency: "Peso mexicano (MXN)",
      locale: "Español",
      checked: ["SPEI", "Cartão"],
      realWarning: 0,
    });
    if (PRINTS) await old.page.screenshot({ path: path.join(PRINTS, "kyvo-oferta-antiga-upsell.png"), fullPage: true });
    expect(old.errors).toEqual([]);
    await old.page.close();
    // Oferta em real com um produto em euro: o upsell começa em euro, sem o aviso.
    const real = await paymentForm("BRL", [{ ...LINK, target: "PAYMENT", payment: SAVED }, UPSELL] as never, 1);
    expect(await real.state()).toMatchObject({ currency: "Euro (EUR)", realWarning: 0 });
    await real.page.close();
    // Oferta em dólar: a moeda da oferta vale mais que a do produto salvo.
    const dollar = await paymentForm("USD", saved as never, 1);
    expect(await dollar.state()).toMatchObject({ currency: "Dólar americano (USD)", realWarning: 0 });
    await dollar.page.close();
  });
});

describe("aba “Moeda, empresa e SEO”: trocar a moeda troca tudo (ação e banco de verdade)", () => {
  /** Oferta em real com loja, página do produto, página de vendas (R$ escrito), Kyvo em euro e valor nos pixels. */
  async function realOffer() {
    const offer = await createOffer({ name: "Loja", templateId: "loja", currency: "BRL" });
    await prisma.offer.update({
      where: { id: offer.id },
      data: { settings: { currency: "BRL", company: { name: "ACME" } } },
    });
    await createPage({ offerId: offer.id, name: "Produto", templateId: "produto" });
    await createPage({ offerId: offer.id, name: "Vendas", templateId: "vendas-longa" });
    const link = await createOfferLink(offer.id, { label: "Checkout", url: "", kind: "CHECKOUT" });
    await savePaymentProduct(link.id, {
      name: "Curso",
      amount: "297,00",
      currency: "EUR",
      methods: ["CARD", "BIZUM"],
      locale: "ES",
      thankYouPageId: null,
      accessUrl: "",
    });
    await saveTrackingSettings(offer.id, { value: { amount: 297 } });
    return { offer, link };
  }

  it("Salvar abre a confirmação com tudo o que muda; Cancelar não grava; “Trocar a moeda de tudo” troca", async () => {
    const { offer } = await realOffer();
    const s = await openPanel(browser, "settings", offer.id);
    const form = s.page.getByRole("form", { name: "Moeda da oferta" });
    await form.getByRole("heading", { name: "Moeda da oferta" }).waitFor();
    expect(await checkedCurrency(s.page, "Em qual moeda essa oferta roda?")).toBe("BRL");
    await form.getByText("Trocar a moeda troca tudo o que tem preço na oferta").waitFor();
    // A nota antiga ("vale só para o que for criado depois") saiu.
    expect(await form.getByText(/daqui em diante/).count()).toBe(0);
    await form.getByText("Tudo salvo").waitFor();

    await form.getByRole("radio", { name: "Peso mexicano ($)" }).check();
    await form.getByText("Alterações não salvas").waitFor();
    expect(await form.getByText(/A Kyvo \(pagamento na página\) não cobra/).count()).toBe(0);
    await form.getByRole("button", { name: "Salvar moeda" }).click();

    const dialog = s.page.getByRole("dialog", { name: "Trocar a moeda da oferta para Peso mexicano ($)?" });
    await dialog.waitFor();
    await dialog.getByText("Passam para peso mexicano:", { exact: false }).waitFor();
    const text = (await dialog.innerText()).replace(/\s+/g, " ");
    expect(text).toContain(
      "Tudo o que tem preço nesta oferta passa para peso mexicano. Os números continuam os mesmos",
    );
    expect(text).toContain("Passam para peso mexicano: 5 vitrines e 1 caixa de compra em 2 páginas.");
    expect(text).toContain("Produto — 1 caixa de compra");
    // A tabela dos produtos: os mesmos números na moeda nova, no formato do painel (um formato só no diálogo).
    const row = dialog.getByRole("row").filter({ hasText: "R$ 129,90" }).first();
    expect((await row.innerText()).replace(/\s+/g, " ")).toMatch(/MX\$\s129,90/);
    expect(text).not.toContain("$129.90");
    await dialog.getByText("Confira se os valores fazem sentido em peso mexicano").waitFor();
    // Kyvo: como fica.
    expect(text).toContain("Checkout · Curso");
    expect(text).toContain("Hoje: Euro (EUR) · Cartão e Bizum · janela em Español");
    // O SPEI (que o euro não aceitava) entra: o valor cabe na faixa dele.
    expect(text).toContain("Depois: Peso mexicano (MXN) · SPEI e Cartão · janela em Español");
    // Pixels no formato do painel, como a Kyvo (MX$, não o "$" da página, que parece dólar); e o texto escrito.
    expect(text).toContain("O valor enviado aos pixels nas compras passa de R$ 297,00 para MX$ 297,00.");
    expect(text).not.toContain("Preços como aparecem na página.");
    expect(text).toContain("Preço escrito no texto das páginas não muda");
    expect(text).toMatch(/Vendas: “R\$ \d/);
    // O ponto no Histórico desfaz só a página: desfazer a troca é trocar a moeda de volta.
    expect(text).toContain(
      "Cada página que muda ganha antes um ponto no Histórico do editor (“Antes do peso mexicano”), com a página como estava. Para desfazer a troca, troque a moeda de volta aqui: restaurar esse ponto volta só aquela página.",
    );
    if (PRINTS) {
      await s.page.screenshot({ path: path.join(PRINTS, "dialogo-trocar-moeda-tela.png") });
      // Janela alta: o diálogo inteiro cabe na captura (sem a rolagem do miolo).
      await s.page.setViewportSize({ width: 1400, height: 2400 });
      await dialog.screenshot({ path: path.join(PRINTS, "dialogo-trocar-moeda.png") });
      await s.page.setViewportSize({ width: 1400, height: 1000 });
    }

    // Cancelar: nada gravado, a escolha continua lá.
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await dialog.waitFor({ state: "hidden" });
    expect(offerCurrencyOf((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).settings)).toBe("BRL");
    await form.getByText("Alterações não salvas").waitFor();
    expect(callsOf(s, "switchOfferCurrencyAction")).toEqual([]);

    await form.getByRole("button", { name: "Salvar moeda" }).click();
    // A troca falha (ex.: uma página salva no editor bem na hora): o aviso aparece e dá para tentar de novo.
    s.override.set("switchOfferCurrencyAction", () => ({ ok: false, error: CURRENCY_SWITCH_CONFLICT }));
    await dialog.getByRole("button", { name: "Trocar a moeda de tudo" }).click();
    await dialog.getByText("Não deu para trocar a moeda").waitFor();
    await dialog.getByText(CURRENCY_SWITCH_CONFLICT).waitFor();
    await dialog.getByRole("button", { name: "Trocar a moeda de tudo" }).click();
    await waitToast(
      s,
      "Moeda da oferta trocada para Peso mexicano ($). Mudou: 5 vitrines e 1 caixa de compra em 2 páginas, 1 produto do pagamento na página e a moeda dos pixels. Confira se os preços fazem sentido (os números ficaram iguais) e os preços escritos como texto em 1 página.",
      "success",
    );
    // Com o que conferir, o aviso fica até a pessoa fechar (o padrão some em 4 s).
    expect((await toasts(s)).at(-1)).toMatchObject({ type: "success", persistent: true, closeButton: true });
    expect(callsOf(s, "getCurrencySwitchPlanAction").map((c) => c.input)).toEqual([
      { offerId: offer.id, currency: "MXN" },
      { offerId: offer.id, currency: "MXN" },
    ]);
    expect(callsOf(s, "switchOfferCurrencyAction").map((c) => [c.input, c.result.ok])).toEqual([
      [{ offerId: offer.id, currency: "MXN" }, false],
      [{ offerId: offer.id, currency: "MXN" }, true],
    ]);
    const settings = (await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).settings;
    expect(settings).toMatchObject({ currency: "MXN", company: { name: "ACME" } });
    const [link] = await listOfferLinks(offer.id);
    expect(link.payment).toMatchObject({ currency: "MXN", methods: ["SPEI", "CARD"], locale: "ES" });
    await form.getByText("Tudo salvo").waitFor();
    expect(await checkedCurrency(s.page, "Em qual moeda essa oferta roda?")).toBe("MXN");
    expect(s.errors).toEqual([]);
    await s.page.close();
  });

  it("real: a nota e a confirmação avisam que a Kyvo não cobra em real (os produtos ficam como estão)", async () => {
    const offer = await createOffer({ name: "México", templateId: "loja", currency: "MXN" });
    const link = await createOfferLink(offer.id, { label: "Checkout", url: "", kind: "CHECKOUT" });
    await savePaymentProduct(link.id, {
      name: "Curso",
      amount: "497",
      currency: "MXN",
      methods: ["SPEI", "CARD"],
      locale: "ES",
      thankYouPageId: null,
      accessUrl: "",
    });
    const s = await openPanel(browser, "settings", offer.id);
    const form = s.page.getByRole("form", { name: "Moeda da oferta" });
    await form.getByRole("radio", { name: "Real (R$)" }).check();
    await form
      .getByText("A Kyvo (pagamento na página) não cobra em real: os produtos dela continuam na moeda de hoje.")
      .waitFor();
    // Descartar volta.
    await form.getByRole("button", { name: "Descartar" }).click();
    expect(await checkedCurrency(s.page, "Em qual moeda essa oferta roda?")).toBe("MXN");
    await form.getByRole("radio", { name: "Real (R$)" }).check();
    await form.getByRole("button", { name: "Salvar moeda" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Trocar a moeda da oferta para Real (R$)?" });
    await dialog.getByText("A Kyvo não cobra em real").waitFor();
    const text = (await dialog.innerText()).replace(/\s+/g, " ");
    expect(text).toContain(
      "O produto do pagamento na página fica como está, cobrando na moeda de hoje. Para vender em real, use nesses links um checkout em real (Hotmart, Kiwify…)",
    );
    expect(text).toMatch(/Peso mexicano \(MXN\) · SPEI e Cartão · janela em Español · MX\$\s497,00 — fica como está\./);
    // Sem pixel e sem "Valor da oferta" salvo: o diálogo não fala de pixels.
    expect(text).not.toContain("Pixels (valor da oferta)");
    if (PRINTS) {
      await s.page.setViewportSize({ width: 1400, height: 2000 });
      await dialog.screenshot({ path: path.join(PRINTS, "dialogo-trocar-moeda-real.png") });
      await s.page.setViewportSize({ width: 1400, height: 1000 });
    }
    await dialog.getByRole("button", { name: "Trocar a moeda de tudo" }).click();
    await waitToast(
      s,
      "Moeda da oferta trocada para Real (R$). Mudou: 5 vitrines em 1 página. Confira se os preços fazem sentido (os números ficaram iguais) e o pagamento na página, que continua na moeda de antes (a Kyvo não cobra em real).",
      "success",
    );
    expect((await toasts(s)).at(-1)).toMatchObject({ persistent: true });
    const [saved] = await listOfferLinks(offer.id);
    expect(saved.payment).toMatchObject({ currency: "MXN", methods: ["SPEI", "CARD"] });
    expect(s.errors).toEqual([]);
    await s.page.close();
  });

  it("checkout do Offer Studio em real → euro: idioma, endereço desligado e textos trocados no diálogo e no aviso", async () => {
    const offer = await createOffer({ name: "Brasil", currency: "BRL" });
    const link = await createOfferLink(offer.id, { label: "Checkout principal", url: "", kind: "CHECKOUT" });
    await saveCheckoutProduct(link.id, {
      name: "Curso",
      amount: "97,00",
      provider: "FLEVOPAY",
      methods: ["PIX"],
      locale: "PT",
      thankYouPageId: null,
      accessUrl: "",
      config: {
        ...checkoutConfigDraft(parseCheckoutConfig({})),
        address: true,
        shipping: [{ id: "frete001", name: "Sedex", eta: "", price: "29,90" }],
        texts: { payButton: "Pagar com PIX agora" },
      },
    });
    const s = await openPanel(browser, "settings", offer.id);
    const form = s.page.getByRole("form", { name: "Moeda da oferta" });
    await form.getByRole("radio", { name: "Euro (€)" }).check();
    await form.getByRole("button", { name: "Salvar moeda" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Trocar a moeda da oferta para Euro (€)?" });
    await dialog.getByText("Checkout do Offer Studio").first().waitFor();
    const text = (await dialog.innerText()).replace(/\s+/g, " ");
    // O português do real continua no euro (que aceita português): o idioma não muda.
    expect(text).toMatch(/Depois: Kyvo · € 97,00(?! · textos)/);
    expect(text).toContain("O endereço de entrega e o frete deixam de ser pedidos: só existem no checkout em real");
    expect(text).toContain("Os textos que você trocou em “Aparência → Textos” ficam como estão");
    await dialog.getByRole("button", { name: "Trocar a moeda de tudo" }).click();
    await waitFor(
      async () => Boolean((await toasts(s))?.at(-1)?.message.includes("os textos trocados de “Checkout principal”")),
      8000,
      "o aviso da troca",
    );
    const message = (await toasts(s)).at(-1)?.message ?? "";
    expect(message).toContain(
      "o frete de “Checkout principal”: o endereço foi desligado (só existe no checkout em real)",
    );
    expect(s.errors).toEqual([]);
    await s.page.close();
  });

  it("página que voltou para real: o cartão avisa e “Passar tudo para peso mexicano” conserta (com o atalho)", async () => {
    const offer = await createOffer({ name: "Loja", templateId: "loja", currency: "MXN" });
    await createPage({ offerId: offer.id, name: "Produto", templateId: "produto" });
    // A loja volta para real (como restaurar no Histórico o ponto de antes da troca).
    const home = await prisma.pageDocument.findFirstOrThrow({
      where: { variant: { page: { offerId: offer.id, isHome: true } } },
    });
    await prisma.pageDocument.update({
      where: { id: home.id },
      data: { html: switchHtmlCurrency(home.html ?? "", "BRL").html },
    });
    const s = await openPanel(browser, "settings", offer.id);
    const form = s.page.getByRole("form", { name: "Moeda da oferta" });
    const note = form.locator('[data-slot="callout"]', { hasText: "1 página com preços em real" });
    await note.waitFor();
    expect((await note.innerText()).replace(/\s+/g, " ")).toContain(
      "As vitrines e caixas de compra da página “Página principal” ainda mostram os preços em real, mas a oferta roda em peso mexicano. Acontece quando uma página volta pelo Histórico a um ponto de antes da troca da moeda, ou é gravada por um editor aberto antes dela.",
    );
    // Sem nada para salvar: a escolha continua no peso.
    expect(await checkedCurrency(s.page, "Em qual moeda essa oferta roda?")).toBe("MXN");

    // "Abrir a moeda da oferta" do Próximos passos (?campo=moeda): o foco vai para o botão e o pedido sai do endereço.
    await s.page.evaluate(() => {
      history.replaceState(null, "", "/?aba=configuracoes&campo=moeda");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(
      async () =>
        (await s.page.evaluate(() => document.activeElement?.textContent)) === "Passar tudo para peso mexicano",
      4000,
      "foco no botão",
    );
    expect(await s.page.evaluate(() => location.search)).toBe("?aba=configuracoes");
    if (PRINTS) await s.page.screenshot({ path: path.join(PRINTS, "moeda-paginas-fora-da-moeda.png") });

    await note.getByRole("button", { name: "Passar tudo para peso mexicano" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Passar tudo para Peso mexicano ($)?" });
    await dialog.getByText("Passam para peso mexicano:", { exact: false }).waitFor();
    const text = (await dialog.innerText()).replace(/\s+/g, " ");
    expect(text).toContain(
      "A oferta já roda em peso mexicano, mas algumas páginas ficaram com preços em outra moeda. Elas passam para peso mexicano.",
    );
    expect(text).toContain("Passam para peso mexicano: 5 vitrines em 1 página.");
    expect(text).not.toContain("Produto —");
    // Nada sobre texto escrito nem sobre desfazer a troca (a moeda da oferta não muda).
    expect(text).not.toContain("Preço escrito no texto das páginas não muda");
    expect(text).not.toContain("Para desfazer a troca");
    const row = dialog.getByRole("row").filter({ hasText: "R$ 129,90" }).first();
    expect((await row.innerText()).replace(/\s+/g, " ")).toMatch(/MX\$\s129,90/);
    if (PRINTS) {
      await s.page.setViewportSize({ width: 1400, height: 2000 });
      await dialog.screenshot({ path: path.join(PRINTS, "dialogo-passar-tudo-para-peso.png") });
      await s.page.setViewportSize({ width: 1400, height: 1000 });
    }
    await dialog.getByRole("button", { name: "Passar tudo para peso mexicano" }).click();
    await waitToast(
      s,
      "Tudo passou para Peso mexicano ($). Mudou: 5 vitrines em 1 página. Confira se os preços fazem sentido (os números ficaram iguais).",
      "success",
    );
    expect(callsOf(s, "switchOfferCurrencyAction").map((c) => c.input)).toEqual([
      { offerId: offer.id, currency: "MXN" },
    ]);
    // O aviso sai do cartão (a tela recebe os dados novos) e a loja está em peso.
    await note.waitFor({ state: "hidden" });
    const fixed = await prisma.pageDocument.findUniqueOrThrow({ where: { id: home.id } });
    expect(fixed.html).toContain('data-os-currency="MXN"');
    expect(fixed.html).not.toContain('data-os-currency="BRL"');
    expect(s.errors).toEqual([]);
    await s.page.close();
  });
});

describe("produto da Kyvo depois de trocar a moeda da oferta", () => {
  it("o formulário mostra a moeda nova e já aponta o valor que passou do máximo do SPEI", async () => {
    const offer = await createOffer({ name: "Curso", currency: "EUR" });
    const link = await createOfferLink(offer.id, { label: "Checkout", url: "", kind: "CHECKOUT" });
    await savePaymentProduct(link.id, {
      name: "Mentoria",
      amount: "30.000,00",
      currency: "EUR",
      methods: ["BIZUM", "MB_WAY"],
      locale: "ES",
      thankYouPageId: null,
      accessUrl: "",
    });
    await savePaymentGatewayKey(offer.id, "KYVO", KYVO_KEY);
    await switchOfferCurrency(offer.id, "MXN");
    const links = (await listOfferLinks(offer.id)).map((l) => ({ ...l, usage: 1, prizes: 0 }));
    const [paymentAccount] = await offerPaymentAccounts(offer.id);
    const { page, errors } = await open("links", {
      offerId: offer.id,
      links,
      pages: PAGES,
      offerCurrency: "MXN",
      paymentAccount,
    });
    const form = page.getByRole("form", { name: "Produto do pagamento na página" });
    await form.waitFor();
    expect(await form.getByRole("combobox", { name: "Moeda" }).textContent()).toBe("Peso mexicano (MXN)");
    const checked = await form
      .getByRole("checkbox")
      .evaluateAll((els) =>
        els
          .filter((el) => (el as HTMLInputElement).checked)
          .map((el) => el.closest("label")?.querySelector(".font-medium")?.textContent),
      );
    expect(checked).toEqual(["SPEI", "Cartão"]);
    expect(await form.getByLabel("Valor").inputValue()).toBe("30.000,00");
    // O valor que passou do máximo do SPEI aparece no campo, sem esperar o "Salvar".
    await form.getByText(/^Com SPEI, o valor máximo é MX\$\s25\.000,00 por compra\.$/).waitFor();
    if (PRINTS) await page.screenshot({ path: path.join(PRINTS, "kyvo-produto-depois-da-troca.png"), fullPage: true });
    // Mudou o valor: o aviso do produto salvo sai (o "Salvar" confere de novo).
    await form.getByLabel("Valor").fill("2.000,00");
    expect(await form.getByText(/Com SPEI, o valor máximo/).count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });
});

const TEXT_PRICES_NOTE = "Os preços escritos neste modelo estão em R$ (são texto): troque-os no editor.";

describe("“Nova página” e versão A/B: modelo com preço escrito em R$ avisa numa oferta em outra moeda", () => {
  it("Nova página: Upsell numa oferta em peso avisa (com a moeda); a loja e uma oferta em real, não", async () => {
    const { page, errors } = await open("page", { offerId: "o1", existingSlugs: ["principal"], offerCurrency: "MXN" });
    const dialog = page.getByRole("dialog", { name: "Nova página" });
    await dialog.getByRole("radio", { name: "Upsell" }).click();
    const note = dialog.getByText(`Esta oferta roda em peso mexicano. ${TEXT_PRICES_NOTE}`);
    await note.waitFor();
    if (PRINTS) await page.screenshot({ path: path.join(PRINTS, "nova-pagina-upsell-peso-aviso.png") });
    await dialog.getByRole("radio", { name: "Loja (vitrine)" }).click();
    expect(await dialog.getByText(/preços escritos neste modelo/).count()).toBe(0);
    await dialog.getByRole("radio", { name: "Downsell" }).click();
    await note.waitFor();
    expect(errors).toEqual([]);
    await page.close();

    const real = await open("page", { offerId: "o1", offerCurrency: "BRL" });
    const realDialog = real.page.getByRole("dialog", { name: "Nova página" });
    await realDialog.getByRole("radio", { name: "Upsell" }).click();
    expect(await realDialog.getByText(/preços escritos neste modelo/).count()).toBe(0);
    await real.page.close();
  });

  it("versão A/B a partir de modelo: Upsell numa oferta em euro avisa; em real, não", async () => {
    const offer = await createOffer({ name: "Portugal", currency: "EUR" });
    const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
    const view = await listVariants(home.id);
    for (const [currency, count] of [
      ["EUR", 1],
      ["BRL", 0],
    ] as const) {
      const { page, errors } = await open("variants", {
        page: { id: home.id, name: home.name },
        offerCurrency: currency,
        __replies: { listVariantsAction: { ok: true, data: view } },
      });
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Modelo ou outra versão…" }).click();
      await dialog.getByRole("radio", { name: /Modelo pronto ou em branco/ }).click();
      await dialog.getByRole("radio", { name: "Upsell" }).click();
      await dialog.getByRole("radio", { name: "Upsell", checked: true }).waitFor();
      expect(await dialog.getByText(`Esta oferta roda em euro. ${TEXT_PRICES_NOTE}`).count(), currency).toBe(count);
      if (PRINTS && count) await page.screenshot({ path: path.join(PRINTS, "versao-ab-upsell-euro-aviso.png") });
      expect(errors).toEqual([]);
      await page.close();
    }
  });
});

describe("“Valor da oferta” (Pixels e rastreamento) na moeda da oferta", () => {
  it("oferta em peso: a moeda vem em peso mexicano (com o $) e o valor salvo vai em MXN", async () => {
    const offer = await createOffer({ name: "México", currency: "MXN" });
    const s = await openPanel(browser, "tracking", offer.id, { initialSection: "eventos" });
    const p = s.page;
    const currency = p.getByRole("combobox", { name: "Moeda" });
    await currency.waitFor();
    expect(await currency.textContent()).toBe("Peso mexicano ($)");
    await currency.click();
    expect(await p.getByRole("option").allTextContents()).toEqual([
      "Real (R$)",
      "Peso mexicano ($)",
      "Euro (€)",
      "Dólar (US$)",
    ]);
    await p.keyboard.press("Escape");
    await p.getByLabel("Valor", { exact: true }).fill("297");
    await p.getByRole("button", { name: "Salvar valor" }).click();
    await waitToast(s, "Valor salvo.");
    const saved = (await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).tracking as {
      value?: unknown;
    };
    expect(saved.value).toEqual({ currency: "MXN", amount: 297 });
    // Trocar para outra moeda continua possível.
    await choose(p, "Moeda", "Dólar (US$)");
    await p.getByRole("button", { name: "Salvar valor" }).click();
    await waitToast(s, "Valor salvo.");
    expect(
      ((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).tracking as { value?: unknown }).value,
    ).toEqual({ currency: "USD", amount: 297 });
    expect(s.errors).toEqual([]);
    await p.close();
  });
});

describe("abas da oferta no celular", () => {
  it("“Moeda, empresa e SEO” com o ponto de não salvo cabe na aba em 390, 360 e 320 px (o nome quebra a linha)", async () => {
    for (const width of [390, 360, 320]) {
      const { page, errors } = await open("tabs", {}, { width, height: 740 });
      // O mesmo respiro dos lados do painel no celular (16 px).
      await page.evaluate(() => {
        (document.getElementById("root") as HTMLElement).style.padding = "16px";
      });
      await page.getByRole("tab", { name: "Moeda, empresa e SEO" }).click();
      await page.locator('[data-slot="tabs-unsaved"]').waitFor();
      const m = await page.evaluate(() => {
        const list = document.querySelector('[data-slot="tabs-list"]') as HTMLElement;
        const tabs = Array.from(list.querySelectorAll<HTMLElement>('[data-slot="tabs-trigger"]'));
        const dot = list.querySelector('[data-slot="tabs-unsaved"]') as HTMLElement;
        const tab = dot.closest('[data-slot="tabs-trigger"]') as HTMLElement;
        const d = dot.getBoundingClientRect();
        const t = tab.getBoundingClientRect();
        const heights = tabs.map((el) => Math.round(el.getBoundingClientRect().height));
        return {
          list: list.scrollWidth - list.clientWidth,
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          over: tabs.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent),
          dotInside: d.left >= t.left && d.right <= t.right,
          // As duas abas de cada linha da grade com a mesma altura.
          rows: [heights[0] === heights[1], heights[2] === heights[3]],
        };
      });
      expect(m, String(width)).toEqual({ list: 0, page: 0, over: [], dotInside: true, rows: [true, true] });
      if (PRINTS) await page.screenshot({ path: path.join(PRINTS, `abas-nao-salvo-${width}.png`) });
      expect(errors).toEqual([]);
      await page.close();
    }
  });
});
