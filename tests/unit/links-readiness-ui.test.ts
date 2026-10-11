/**
 * Telas num Chromium de verdade, com o CSS do painel:
 * - aba "Links e checkouts": o selo "Checkout da página clonada — troque pelo
 *   seu" só no link que ainda leva ao checkout da página original; "Abrir o
 *   link" (?link=<id>) rola até ele; no celular (390 px) nada passa da tela,
 *   nem o atalho "Pagamento na página: conta da Kyvo desta oferta";
 * - "Próximos passos": os botões levam ao link, ao editor e ao campo "Idioma
 *   das páginas";
 * - aba "Moeda, empresa e SEO": ?campo=idioma rola até o campo e põe o foco
 *   nele (e o pedido sai do endereço).
 */
import path from "node:path";
import { build, type Plugin } from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { offerLinkHref, offerSettingHref } from "@/components/offers/offer-link-href";
import type { Readiness } from "@/lib/readiness";
import { createOffer } from "@/server/services/offers";
import { resetDatabase } from "../setup/per-file";
import { openPanel, panelBundle, panelCss } from "./tracking-ui-harness";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OFFER_URL = "http://painel.os.test/ofertas/o1";

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { OfferLinks } from "@/components/offers/offer-links";
import { ReadinessCard } from "@/components/offers/readiness-card";
let root = null;
window.OS = {
  render(links, readiness) {
    root = root || createRoot(document.getElementById("root"));
    root.render(createElement("div", { className: "flex flex-col gap-6" },
      createElement(ReadinessCard, { offerId: "o1", readiness }),
      createElement(OfferLinks, links),
    ));
  },
};
`;

const stubs: Plugin = {
  name: "links-ui-stubs",
  setup(b) {
    b.onResolve({ filter: /^sonner$/ }, () => ({ path: "sonner", namespace: "stub" }));
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "stub" }));
    b.onResolve({ filter: /^@\/server\/actions\// }, () => ({ path: "actions", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
      loader: "js",
      resolveDir: ROOT,
      contents:
        args.path === "sonner"
          ? "export const toast = Object.assign(() => {}, { success: () => {}, error: () => {} });"
          : args.path === "navigation"
            ? // Como o do Next: acompanha pushState/replaceState (navegação e replaceQuery).
              `import { useSyncExternalStore } from "react";
               for (const m of ["pushState", "replaceState"]) {
                 const orig = history[m].bind(history);
                 history[m] = (...a) => { orig(...a); dispatchEvent(new Event("os:url")); };
               }
               const sub = (cb) => { addEventListener("os:url", cb); return () => removeEventListener("os:url", cb); };
               export function useSearchParams() { return new URLSearchParams(useSyncExternalStore(sub, () => location.search)); }
               export function useRouter() { return { push: () => {}, replace: () => {}, refresh: () => {} }; }`
            : args.path === "link"
              ? `import { createElement } from "react";
                 export default function Link({ href, children, scroll, prefetch, ...rest }) {
                   return createElement("a", { href, ...rest }, children);
                 }`
              : // Toda server action responde "ok" (a tela só precisa existir).
                `const ok = () => Promise.resolve({ ok: true, data: undefined });
                 export const createOfferLinkAction = ok, updateOfferLinkAction = ok, deleteOfferLinkAction = ok,
                   setOfferLinkTargetAction = ok, savePaymentGatewayKeyAction = ok, removePaymentGatewayKeyAction = ok,
                   copyPaymentGatewayKeyAction = ok, testPaymentGatewayAction = ok, savePaymentProductAction = ok,
                   saveCheckoutProductAction = ok, checkoutPreviewUrlAction = ok;`,
    }));
  },
};

let bundle: string;
let css: string;
let browser: Browser;

beforeAll(async () => {
  await resetDatabase();
  const out = await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "links-ui-entry.tsx" },
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
  [css] = await Promise.all([panelCss(), panelBundle()]);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
});

const link = (over: Record<string, unknown>) => ({
  key: "checkout",
  label: "Checkout",
  url: "",
  kind: "CHECKOUT",
  target: "URL",
  payment: null,
  usage: 1,
  prizes: 0,
  ...over,
});

const LINKS = [
  link({
    id: "l1",
    key: "hotmart",
    label: "Checkout Hotmart",
    url: "https://pay.hotmart.com/K1234X?off=a",
    fromClone: true,
  }),
  link({ id: "l2", key: "upsell", label: "Upsell", url: "https://pay.kiwify.com.br/meu", kind: "UPSELL" }),
  ...Array.from({ length: 6 }, (_, i) =>
    link({ id: `x${i}`, key: `extra-${i}`, label: `Link ${i + 1}`, url: `https://exemplo.com/${i}`, kind: "OTHER" }),
  ),
];

const READINESS: Readiness = {
  done: 0,
  total: 3,
  complete: false,
  items: [
    {
      id: "checkout",
      title: "Trocar o checkout da página original",
      detail: "1 link ainda leva ao checkout da página que você clonou.",
      done: false,
      optional: false,
      cta: "Abrir o link",
      target: { link: "l1" },
    },
    {
      id: "links-legais",
      title: "Ligar os links de política, termos e contato",
      detail: "O link “Contato” da página “Vendas” ainda não leva a lugar nenhum.",
      done: false,
      optional: true,
      cta: "Abrir no editor",
      target: { editor: "d1" },
    },
    {
      id: "idioma",
      title: "Conferir o idioma das páginas",
      detail: "Suas páginas estão marcadas como português, mas a oferta roda em peso mexicano.",
      done: false,
      optional: true,
      cta: "Escolher o idioma",
      target: { setting: "idioma" },
    },
  ],
};

async function open(
  viewport: { width: number; height: number },
  query = "",
): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ locale: "pt-BR", viewport });
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("http://painel.os.test/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="pt-BR" class="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main id="root" style="padding:16px"></main></body></html>`,
    }),
  );
  await page.goto(`${OFFER_URL}${query}`);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(
    ([links, readiness]) =>
      (window as unknown as { OS: { render(l: unknown, r: unknown): void } }).OS.render(links, readiness),
    [{ offerId: "o1", links: LINKS }, READINESS] as const,
  );
  await page.locator("#link-l1").waitFor();
  return { page, errors };
}

describe("aba Links e checkouts", () => {
  it("selo só no link com o checkout da página clonada", async () => {
    const { page, errors } = await open({ width: 1280, height: 900 });
    const rows = page.locator('li[id^="link-"]');
    const badge = (id: string) => page.locator(`#link-${id}`).getByText("Checkout da página clonada — troque pelo seu");
    expect(await badge("l1").isVisible()).toBe(true);
    expect(await badge("l2").count()).toBe(0);
    expect(await rows.getByText("Checkout da página clonada — troque pelo seu").count()).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("“Abrir o link” do Próximos passos rola até o link e destaca; sai do endereço", async () => {
    const { page } = await open({ width: 1280, height: 600 });
    const action = page.getByRole("link", { name: /^Abrir o link/ });
    expect(await action.getAttribute("href")).toBe(offerLinkHref("o1", "l1"));
    // Como o <Link> do Next: muda o endereço sem recarregar.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.evaluate((h) => history.pushState(null, "", h), offerLinkHref("o1", "l1"));
    const row = page.locator("#link-l1");
    await expect.poll(() => row.getAttribute("data-highlight")).toBe("true");
    await expect.poll(() => row.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeLessThan(200);
    await expect.poll(() => page.evaluate(() => location.search)).toBe("?aba=links");
    await page.close();
  });

  it("no celular (390 px) nada passa da tela, nem o atalho da conta da Kyvo", async () => {
    const { page, errors } = await open({ width: 390, height: 844 });
    const shortcut = page.getByRole("button", { name: "Pagamento na página: conta da Kyvo desta oferta" });
    await shortcut.waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await shortcut.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    // Quebra a linha em vez de passar.
    expect(box?.height ?? 0).toBeGreaterThan(32);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("Próximos passos: botões para o editor e para o campo “Idioma das páginas”", async () => {
    const { page } = await open({ width: 1280, height: 900 });
    expect(await page.getByRole("link", { name: /^Abrir no editor/ }).getAttribute("href")).toBe("/editor/d1");
    const language = page.getByRole("link", { name: /^Escolher o idioma/ });
    expect(await language.getAttribute("href")).toBe("/ofertas/o1?aba=configuracoes&campo=idioma");
    expect(offerSettingHref("o1", "idioma")).toBe("/ofertas/o1?aba=configuracoes&campo=idioma");
    expect(await page.getByText("Opcional").count()).toBe(2);
    await page.close();
  });
});

describe("aba Moeda, empresa e SEO", () => {
  it("?campo=idioma rola até “Idioma das páginas”, põe o foco e sai do endereço", async () => {
    const offer = await createOffer({ name: "Oferta México", currency: "MXN" });
    const s = await openPanel(browser, "settings", offer.id);
    const p = s.page;
    await p.setViewportSize({ width: 1280, height: 500 });
    const trigger = p.getByRole("combobox", { name: "Idioma das páginas" });
    await trigger.waitFor();
    expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(false);
    // Como o <Link> do Next (navegação sem recarregar, com o painel já montado).
    await p.evaluate(() => {
      history.pushState(null, "", "/?aba=configuracoes&campo=idioma");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect.poll(() => trigger.evaluate((el) => el === document.activeElement)).toBe(true);
    // O anel de foco não aparece com o foco vindo do código: o campo fica destacado e depois volta.
    expect(await trigger.getAttribute("data-highlight")).toBe("true");
    expect(await trigger.getAttribute("class")).toMatch(/\bring-2\b/);
    await expect
      .poll(() =>
        trigger.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= window.innerHeight;
        }),
      )
      .toBe(true);
    expect(await p.evaluate(() => location.search)).toBe("?aba=configuracoes");
    expect(s.errors).toEqual([]);
    await p.close();
  });
});
