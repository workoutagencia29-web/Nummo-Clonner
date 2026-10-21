/**
 * Montador de upsell (UpsellPanel) num Chromium de verdade, com o CSS do painel:
 * - mostra as "compras que iniciam" como caixinhas (vários checkouts);
 * - adicionar oferta, escolher página + produto do SIM e marcar o downsell;
 * - o produto escolhido como oferta some da lista de "compras que iniciam";
 * - "Salvar upsell" manda o flow com startLinkKeys[] e a etapa + downsell atrelado.
 *
 * As server actions são de mentira (gravam a chamada e devolvem ok).
 */
import path from "node:path";
import { build, type Plugin } from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { choose, panelCss } from "./tracking-ui-harness";

const ROOT = path.resolve(import.meta.dirname, "../..");
const URL = "http://painel.os.test/ofertas/o1/upsell";

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { UpsellPanel } from "@/components/offers/upsell/upsell-panel";
let root = null;
window.OS = {
  render(initial) {
    root = root || createRoot(document.getElementById("root"));
    root.render(createElement(UpsellPanel, { offerId: "o1", initial }));
  },
};
`;

const stubs: Plugin = {
  name: "upsell-ui-stubs",
  setup(b) {
    b.onResolve({ filter: /^sonner$/ }, () => ({ path: "sonner", namespace: "stub" }));
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "stub" }));
    b.onResolve({ filter: /^@\/server\/actions\/upsell$/ }, () => ({ path: "upsell-actions", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
      loader: "js",
      resolveDir: ROOT,
      contents:
        args.path === "sonner"
          ? "export const toast = Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} });"
          : args.path === "navigation"
            ? `export function useRouter() { return { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }; }
               export function useSearchParams() { return new URLSearchParams(); }
               export function usePathname() { return "/ofertas/o1/upsell"; }`
            : args.path === "link"
              ? `import { createElement } from "react";
                 export default function Link({ href, children, scroll, prefetch, ...rest }) {
                   return createElement("a", { href, ...rest }, children);
                 }`
              : // Actions do upsell: gravam a chamada em window.__calls e devolvem ok.
                `const calls = (window.__calls = window.__calls || []);
                 export const saveUpsellAction = (input) => { calls.push(["save", input]); return Promise.resolve({ ok: true, data: undefined }); };
                 let n = 0;
                 export const createUpsellPageAction = (input) => {
                   n++;
                   const name = (input.kind === "THANK_YOU" ? "Obrigado" : input.kind === "DOWNSELL" ? "Downsell" : "Upsell") + " novo " + n;
                   const page = { id: "nova" + n, name, type: input.kind, autoWire: true };
                   calls.push(["create", input, page]);
                   return Promise.resolve({ ok: true, data: page });
                 };
                 export const offersForUpsellApplyAction = () => Promise.resolve({ ok: true, data: [] });
                 export const applyUpsellAction = () => Promise.resolve({ ok: true, data: { applied: [], skipped: [] } });`,
    }));
  },
};

const PRODUCTS = [
  {
    key: "mentoria",
    label: "Mentoria",
    target: "CHECKOUT",
    productName: "Mentoria",
    amountCents: 199700,
    currency: "BRL",
  },
  {
    key: "curso",
    label: "Curso",
    target: "CHECKOUT",
    productName: "Curso completo",
    amountCents: 49700,
    currency: "BRL",
  },
  { key: "ebook", label: "Ebook", target: "PAYMENT", productName: "Ebook", amountCents: 4700, currency: "BRL" },
];
const PAGES = [
  { id: "p-ofertaA", name: "Oferta especial", type: "UPSELL", autoWire: true },
  { id: "p-obg", name: "Obrigado", type: "THANK_YOU", autoWire: false },
];
const INITIAL = {
  flow: { startLinkKeys: [], steps: [], thankYouPageId: null },
  products: PRODUCTS,
  pages: PAGES,
  problems: [],
};

let bundle: string;
let css: string;
let browser: Browser;

beforeAll(async () => {
  const out = await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "upsell-ui-entry.tsx" },
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

async function open(): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ locale: "pt-BR", viewport: { width: 1100, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("http://painel.os.test/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="pt-BR" class="light"><head><meta charset="utf-8"><style>${css}</style></head><body><main id="root" style="padding:16px"></main></body></html>`,
    }),
  );
  await page.goto(URL);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(
    (initial) => (window as unknown as { OS: { render(i: unknown): void } }).OS.render(initial),
    INITIAL,
  );
  await page.getByText("Em quais compras esse upsell começa?").waitFor();
  return { page, errors };
}

describe("montador de upsell", () => {
  it("monta a sequência com caixinhas de início e salva o flow com startLinkKeys[]", async () => {
    const { page, errors } = await open();
    const prints = process.env.OS_PRINTS_DIR;
    if (prints) await page.screenshot({ path: path.join(prints, "upsell-vazio.png"), fullPage: true });

    // 1 · As compras que iniciam aparecem como caixinhas (vários checkouts).
    expect(await page.getByRole("checkbox", { name: /Mentoria/ }).isVisible()).toBe(true);
    expect(await page.getByRole("checkbox", { name: /Curso completo/ }).isVisible()).toBe(true);
    expect(await page.getByRole("checkbox", { name: /Ebook/ }).isVisible()).toBe(true);
    // Sequência vazia: só o convite para a 1ª oferta.
    expect(await page.getByRole("button", { name: /Adicionar a 1ª oferta/ }).isVisible()).toBe(true);

    // Marca "Curso completo" como uma das compras que começam o upsell.
    await page.getByRole("checkbox", { name: /Curso completo/ }).click();

    // 2 · Adiciona a 1ª oferta e configura página + produto do SIM.
    await page.getByRole("button", { name: /Adicionar a 1ª oferta/ }).click();
    await page.getByText("Oferta 1").waitFor();
    await choose(page, "Página da oferta 1", /Oferta especial/);
    await choose(page, "Produto cobrado no SIM da oferta 1", /Mentoria/);

    // O produto virou oferta da sequência → sai da lista de "compras que iniciam".
    await expect.poll(() => page.getByRole("checkbox", { name: /Mentoria/ }).count()).toBe(0);

    // Marca o downsell (caixinha) → aparece a sub-oferta mais barata.
    await page.getByRole("checkbox", { name: /oferecer algo mais barato/ }).click();
    expect(await page.getByText("Downsell — oferta mais barata").isVisible()).toBe(true);

    // 3 · Página de obrigado do fim.
    await choose(page, "Página de obrigado do fim", /Obrigado/);

    // Salva.
    await page.getByRole("button", { name: "Salvar upsell" }).click();

    const saved = await (async () => {
      for (let i = 0; i < 40; i++) {
        const call = await page.evaluate(
          () =>
            (window as unknown as { __calls?: [string, { flow: unknown }][] }).__calls?.find(
              (c) => c[0] === "save",
            )?.[1],
        );
        if (call)
          return call as {
            flow: {
              startLinkKeys: string[];
              steps: {
                id: string;
                kind: string;
                pageId: string | null;
                linkKey: string | null;
                attachedTo?: string | null;
              }[];
              thankYouPageId: string | null;
            };
          };
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error("o Salvar não chamou a action");
    })();

    expect(saved.flow.startLinkKeys).toEqual(["curso"]);
    expect(saved.flow.thankYouPageId).toBe("p-obg");
    const up = saved.flow.steps.find((s) => s.kind === "UPSELL");
    expect(up).toMatchObject({ pageId: "p-ofertaA", linkKey: "mentoria" });
    const down = saved.flow.steps.find((s) => s.kind === "DOWNSELL");
    expect(down).toBeTruthy();
    expect(down?.attachedTo).toBe(up?.id);

    if (prints) await page.screenshot({ path: path.join(prints, "upsell-montado.png"), fullPage: true });
    expect(errors).toEqual([]);
    await page.close();
  });
});
