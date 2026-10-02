/**
 * Fase 5, correção 4 — "Testar pixels" com a versão A/B, na tela de verdade
 * (src/components/offers/pixel-test) num Chromium, sem Next e sem banco: as
 * server actions e a leitura dos passos são respondidas pelo teste.
 *
 * - página com mais de uma versão: select "Versão" (começa na de controle) e a
 *   versão escolhida vai no "Iniciar teste";
 * - página com uma versão só: sem o select e o pedido de sempre;
 * - trocar de página volta para a de controle; o teste em andamento mostra a
 *   versão e continua depois de recarregar a tela.
 */
import path from "node:path";
import { build, type Plugin } from "esbuild";
import { type Browser, chromium, type Page, type Route } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PixelTestSetup } from "@/components/offers/pixel-test/logic";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ORIGIN = "http://panel.test";
const OFFER_ID = "oferta00000000000000001";
const SESSION_ID = "sessao0000000000000000001";
const TOKEN = "abcdefghijklmnopqrstuvwxyz";
const TEST_URL = `http://zyxwvutsrqponmlkjihgfedcba.localhost:3001/?os_teste=${TOKEN}`;

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { PixelTestScreen } from "@/components/offers/pixel-test/pixel-test-screen";
let root = null;
window.OS = {
  mount(setup) {
    root = createRoot(document.getElementById("root"));
    root.render(createElement(PixelTestScreen, { setup }));
  },
  unmount() { root?.unmount(); root = null; },
};
`;

const stubs: Plugin = {
  name: "pixel-test-variant-stubs",
  setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
    b.onResolve({ filter: /^sonner$/ }, () => ({ path: "sonner", namespace: "stub" }));
    b.onResolve({ filter: /^@\/server\/actions\/tracking$/ }, () => ({ path: "tracking", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => {
      if (args.path === "link") {
        return {
          loader: "js",
          resolveDir: ROOT,
          contents: `import { createElement } from "react";
            export default function Link({ href, prefetch, replace, scroll, ...rest }) { return createElement("a", { ...rest, href }); }`,
        };
      }
      if (args.path === "sonner") {
        return {
          loader: "js",
          contents: `const calls = (window.__toasts = []);
            const rec = (type) => (message) => { calls.push({ type, message }); return calls.length; };
            export const toast = Object.assign(rec("default"), { success: rec("success"), error: rec("error") });`,
        };
      }
      return {
        loader: "js",
        contents: ["createPixelTestSessionAction", "endPixelTestSessionAction"]
          .map((n) => `export const ${n} = (input) => window.__action(${JSON.stringify(n)}, input);`)
          .join("\n"),
      };
    });
  },
};

let bundle: Promise<string> | null = null;
function appBundle() {
  bundle ??= build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "pixel-test-variant-entry.tsx" },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    write: false,
    logLevel: "silent",
    tsconfig: path.join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "empty" },
    plugins: [stubs],
  }).then((r) => r.outputFiles[0].text);
  return bundle;
}

// ─── Servidor falso ──────────────────────────────────────────────────────────

class FakePanel {
  actions: { name: string; input: Record<string, unknown> }[] = [];

  async action(name: string, input: Record<string, unknown>) {
    this.actions.push({ name, input });
    if (name === "createPixelTestSessionAction") {
      return {
        ok: true,
        data: {
          id: SESSION_ID,
          offerId: OFFER_ID,
          pageId: input.pageId ?? null,
          variantId: input.variantId ?? null,
          token: TOKEN,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
          url: TEST_URL,
          vendors: ["META"],
        },
      };
    }
    return { ok: true, data: undefined };
  }

  async handle(route: Route) {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === "/") {
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Testar pixels</title></head><body><div id="root"></div></body></html>`,
      });
    }
    const m = /^\/api\/pixel-test\/([^/]+)$/.exec(url.pathname);
    if (!m) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          id: m[1],
          offerId: OFFER_ID,
          pageId: "home",
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          expired: false,
          eventCount: 0,
          full: false,
        },
        events: [],
        lastId: 0,
      }),
    });
  }
}

const SETUP: PixelTestSetup = {
  offerId: OFFER_ID,
  offerName: "Oferta de teste",
  pages: [
    {
      id: "home",
      name: "Página principal",
      isHome: true,
      variants: [
        { id: "va", name: "A", label: null, isControl: true },
        { id: "vb", name: "B", label: "Headline nova", isControl: false },
      ],
    },
    {
      id: "obrigado",
      name: "Obrigado",
      isHome: false,
      variants: [{ id: "oa", name: "A", label: null, isControl: true }],
    },
  ],
  pixels: [{ id: "p1", vendor: "META", pixelId: "123456789012345", label: null, conversionLabels: {} }],
  disabledPixels: 0,
  rules: [],
  consentMode: "OPT_IN",
  acceptLabel: "Aceitar",
  noticeLabel: "Entendi",
  eventNames: {},
  links: [],
};

let browser: Browser;
const opened: Page[] = [];

beforeAll(async () => {
  await appBundle();
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  for (const p of opened)
    await p
      .context()
      .close()
      .catch(() => undefined);
  await browser?.close();
});

/** Abre a tela. `stored`: sessão já guardada na aba (recarregar a tela). */
async function mount(stored?: unknown) {
  const server = new FakePanel();
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();
  opened.push(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.exposeFunction("__actionNode", (name: string, input: Record<string, unknown>) =>
    server.action(name, input),
  );
  await context.addInitScript(() => {
    const w = window as unknown as { __action: unknown; __actionNode: unknown };
    w.__action = (name: string, input: unknown) =>
      (w.__actionNode as (n: string, i: unknown) => Promise<unknown>)(name, input);
  });
  await context.route("**/*", (route) => server.handle(route));
  await page.goto(`${ORIGIN}/`);
  if (stored !== undefined) {
    await page.evaluate(([key, value]) => sessionStorage.setItem(key, JSON.stringify(value)), [
      `os-pixel-test:${OFFER_ID}`,
      stored,
    ] as const);
  }
  await page.addScriptTag({ content: await appBundle() });
  await page.evaluate((s) => (window as unknown as { OS: { mount: (x: unknown) => void } }).OS.mount(s), SETUP);
  return { page, server, errors };
}

const pageSelect = (page: Page) => page.getByRole("combobox", { name: "Página para testar" });
const variantSelect = (page: Page) => page.getByRole("combobox", { name: "Versão para testar" });

async function choose(page: Page, combobox: ReturnType<typeof pageSelect>, option: string) {
  await combobox.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect.poll(() => combobox.textContent()).toContain(option.replace(" (inicial)", ""));
}

describe("Testar pixels com a versão A/B", () => {
  it("página com A e B: o select começa no controle; escolher B manda a versão e o teste mostra qual é", async () => {
    const { page, server, errors } = await mount();
    await expect.poll(() => variantSelect(page).count()).toBe(1);
    expect(await page.getByText("Versão", { exact: true }).count()).toBe(1);
    expect(await variantSelect(page).textContent()).toBe("Versão A (controle)");
    await variantSelect(page).click();
    expect(await page.getByRole("option").allTextContents()).toEqual([
      "Versão A (controle)",
      "Versão B · Headline nova",
    ]);
    await page.getByRole("option", { name: "Versão B · Headline nova" }).click();
    await expect.poll(() => variantSelect(page).textContent()).toBe("Versão B · Headline nova");

    await page.getByRole("button", { name: "Iniciar teste" }).click();
    await page.getByRole("link", { name: "Abrir página de teste" }).waitFor();
    expect(server.actions).toEqual([
      { name: "createPixelTestSessionAction", input: { offerId: OFFER_ID, pageId: "home", variantId: "vb" } },
    ]);
    const status = (await page.getByRole("region", { name: "Controle do teste" }).textContent()) ?? "";
    expect(status).toMatch(/Página: Página principal · Versão B · vence em (2 h 00|1 h 59) min/);
    const stored = await page.evaluate((k) => sessionStorage.getItem(k), `os-pixel-test:${OFFER_ID}`);
    expect(JSON.parse(stored ?? "{}")).toMatchObject({ pageId: "home", variantId: "vb", ended: false });
    expect(errors).toEqual([]);
  });

  it("sem mexer no select: vai a de controle (o teste fica preso a ela)", async () => {
    const { page, server } = await mount();
    await expect.poll(() => variantSelect(page).count()).toBe(1);
    await page.getByRole("button", { name: "Iniciar teste" }).click();
    await page.getByRole("link", { name: "Abrir página de teste" }).waitFor();
    expect(server.actions[0].input).toEqual({ offerId: OFFER_ID, pageId: "home", variantId: "va" });
    expect(await page.getByRole("region", { name: "Controle do teste" }).textContent()).toContain(
      "Página: Página principal · Versão A · vence em",
    );
  });

  it("página com uma versão só: sem select e o pedido de sempre; voltar para a página A/B começa no controle", async () => {
    const { page, server, errors } = await mount();
    await expect.poll(() => variantSelect(page).count()).toBe(1);
    await variantSelect(page).click();
    await page.getByRole("option", { name: "Versão B · Headline nova" }).click();

    await choose(page, pageSelect(page), "Obrigado");
    expect(await variantSelect(page).count()).toBe(0);
    await choose(page, pageSelect(page), "Página principal (inicial)");
    // Outra página e de volta: a escolha anterior não fica (começa no controle).
    await expect.poll(() => variantSelect(page).textContent()).toBe("Versão A (controle)");

    await choose(page, pageSelect(page), "Obrigado");
    await page.getByRole("button", { name: "Iniciar teste" }).click();
    await page.getByRole("link", { name: "Abrir página de teste" }).waitFor();
    expect(server.actions[0].input).toEqual({ offerId: OFFER_ID, pageId: "obrigado" });
    const status = (await page.getByRole("region", { name: "Controle do teste" }).textContent()) ?? "";
    expect(status).toContain("Página: Obrigado · vence em");
    expect(status).not.toContain("Versão");
    expect(errors).toEqual([]);
  });

  it("recarregar a tela continua o teste da versão B; versão que não existe mais descarta o teste guardado", async () => {
    const stored = {
      id: SESSION_ID,
      token: TOKEN,
      url: TEST_URL,
      pageId: "home",
      variantId: "vb",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      vendors: ["META"],
      ended: false,
    };
    const { page, server } = await mount(stored);
    await page.getByRole("link", { name: "Abrir página de teste" }).waitFor();
    expect(server.actions).toEqual([]);
    expect(await page.getByRole("region", { name: "Controle do teste" }).textContent()).toContain(
      "Página: Página principal · Versão B · vence em",
    );
    // "Começar novo teste": a mesma página e a mesma versão já escolhidas.
    await page.getByRole("button", { name: "Encerrar teste" }).click();
    await page.getByRole("button", { name: "Começar novo teste" }).click();
    await expect.poll(() => variantSelect(page).textContent()).toBe("Versão B · Headline nova");

    const gone = await mount({ ...stored, variantId: "excluida" });
    await gone.page.getByRole("button", { name: "Iniciar teste" }).waitFor();
    expect(await gone.page.getByRole("link", { name: "Abrir página de teste" }).count()).toBe(0);
    await expect.poll(() => variantSelect(gone.page).textContent()).toBe("Versão A (controle)");
  });
});
