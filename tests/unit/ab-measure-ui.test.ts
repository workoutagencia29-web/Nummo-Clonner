/**
 * Tela "Testar pixels" (src/components/offers/pixel-test) com versões A/B, num
 * Chromium de verdade, sem Next e sem banco (as server actions e as rotas são
 * respondidas pelo teste; next/link e sonner viram versões simples):
 *
 * - versão excluída em outra aba: o "Iniciar teste" recusado mostra a
 *   mensagem em português, a tela busca as opções de novo (sem recarregar) e o
 *   próximo "Iniciar teste" já vai com a lista nova;
 * - página excluída em outra aba: a escolha volta para a página inicial;
 * - a versão que a página de teste informou aparece na linha do tempo e no
 *   cabeçalho do teste.
 */
import path from "node:path";
import { build, type Plugin } from "esbuild";
import { type Browser, chromium, type Page, type Route } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type PixelTestSetup, pixelTestChoicesUrl, type TestPage } from "@/components/offers/pixel-test/logic";
import type { PixelTestEventRow } from "@/lib/tracking/test-report";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ORIGIN = "http://panel.test";
const OFFER_ID = "oferta00000000000000ab1";
const SESSION_ID = "sessao00000000000000ab01";
const TOKEN = "abcdefghijklmnopqrstuvwxyz";

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { PixelTestScreen } from "@/components/offers/pixel-test/pixel-test-screen";
window.OS = { mount(setup) { createRoot(document.getElementById("root")).render(createElement(PixelTestScreen, { setup })); } };
`;

const stubs: Plugin = {
  name: "ab-measure-ui-stubs",
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
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "ab-measure-entry.tsx" },
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

const HOME_AB: TestPage = {
  id: "home",
  name: "Página principal",
  isHome: true,
  variants: [
    { id: "va", name: "A", label: null, isControl: true },
    { id: "vb", name: "B", label: "Headline nova", isControl: false },
  ],
};
const SALES: TestPage = { id: "vendas", name: "Vendas", isHome: false };

const SETUP: PixelTestSetup = {
  offerId: OFFER_ID,
  offerName: "Oferta A/B",
  pages: [SALES, HOME_AB],
  pixels: [{ id: "p1", vendor: "META", pixelId: "123456789012345", label: null, conversionLabels: {} }],
  disabledPixels: 0,
  rules: [],
  consentMode: "OPT_IN",
  acceptLabel: "Aceitar",
  noticeLabel: "Entendi",
  eventNames: {},
  links: [],
};

class FakePanel {
  actions: { name: string; input: Record<string, unknown> }[] = [];
  /** Próximas respostas de erro do "Iniciar teste". */
  failures: { error: string; field?: string }[] = [];
  /** Páginas atuais (rota de opções). */
  choices: TestPage[] = SETUP.pages;
  choiceReads = 0;
  events: PixelTestEventRow[] = [];

  async action(name: string, input: Record<string, unknown>) {
    this.actions.push({ name, input });
    if (name !== "createPixelTestSessionAction") return { ok: true, data: undefined };
    const fail = this.failures.shift();
    if (fail) return { ok: false, ...fail };
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
        url: `http://zyxwvutsrqponmlkjihgfedcba.localhost:3001/?os_teste=${TOKEN}`,
        vendors: ["META"],
      },
    };
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
    if (url.pathname === pixelTestChoicesUrl(OFFER_ID)) {
      this.choiceReads++;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ pages: this.choices }) });
    }
    const m = /^\/api\/pixel-test\/([^/]+)$/.exec(url.pathname);
    if (!m) return route.fulfill({ status: 404, body: "" });
    const after = Number(url.searchParams.get("after"));
    const events = this.events.filter((e) => e.id > after);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          id: m[1],
          offerId: OFFER_ID,
          pageId: "home",
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          expired: false,
          eventCount: this.events.length,
          full: false,
        },
        events,
        lastId: events.at(-1)?.id ?? after,
      }),
    });
  }
}

let browser: Browser;
let page: Page;
let server: FakePanel;

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

afterEach(async () => {
  await page?.context().close();
});

async function mount(setup: PixelTestSetup = SETUP) {
  server = new FakePanel();
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  page = await context.newPage();
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
  await page.addScriptTag({ content: await appBundle() });
  await page.evaluate((s) => (window as unknown as { OS: { mount: (x: unknown) => void } }).OS.mount(s), setup);
  return errors;
}

const toasts = () =>
  page.evaluate(() => (window as unknown as { __toasts: { type: string; message: string }[] }).__toasts);
const variantSelect = () => page.getByRole("combobox", { name: "Versão para testar" });
const pageSelect = () => page.getByRole("combobox", { name: "Página para testar" });
const startButton = () => page.getByRole("button", { name: "Iniciar teste" });

describe("Testar pixels: opções velhas (excluídas em outra aba)", () => {
  it("versão excluída: mensagem em português, lista nova sem recarregar e o próximo teste já vai certo", async () => {
    const errors = await mount();
    await expect.poll(() => variantSelect().count()).toBe(1);
    await variantSelect().click();
    await page.getByRole("option", { name: "Versão B · Headline nova" }).click();
    // Em outra aba, a versão B foi excluída.
    server.failures.push({ error: "Essa versão não faz parte desta página.", field: "variantId" });
    server.choices = [SALES, { ...HOME_AB, variants: [HOME_AB.variants?.[0] as NonNullable<TestPage["variants"]>[0]] }];
    await startButton().click();
    await expect.poll(async () => (await toasts()).length).toBe(1);
    const [toast] = await toasts();
    expect(toast.type).toBe("error");
    expect(toast.message).toMatch(/^Essa versão não existe mais/);
    expect(toast.message).toContain("A lista de versões foi atualizada");
    // A lista foi buscada de novo: com uma versão só, o "Versão" some.
    await expect.poll(() => variantSelect().count()).toBe(0);
    expect(server.choiceReads).toBe(1);
    expect(server.actions[0].input).toEqual({ offerId: OFFER_ID, pageId: "home", variantId: "vb" });
    await startButton().click();
    await page.getByRole("link", { name: "Abrir página de teste" }).waitFor();
    expect(server.actions[1].input).toEqual({ offerId: OFFER_ID, pageId: "home" });
    expect(errors).toEqual([]);
  });

  it("outra versão continua: a escolha volta para a versão de controle", async () => {
    await mount();
    await variantSelect().click();
    await page.getByRole("option", { name: "Versão B · Headline nova" }).click();
    server.failures.push({ error: "Essa versão não faz parte desta página.", field: "variantId" });
    const c = { id: "vc", name: "C", label: null, isControl: false };
    server.choices = [SALES, { ...HOME_AB, variants: [HOME_AB.variants?.[0] as typeof c, c] }];
    await startButton().click();
    await expect.poll(async () => (await variantSelect().textContent()) ?? "").toBe("Versão A (controle)");
    await variantSelect().click();
    expect(await page.getByRole("option").allTextContents()).toEqual(["Versão A (controle)", "Versão C"]);
  });

  it("página excluída: mensagem em português e a escolha volta para a página inicial", async () => {
    await mount();
    await pageSelect().click();
    await page.getByRole("option", { name: "Vendas" }).click();
    server.failures.push({ error: "Essa página não faz parte desta oferta.", field: "pageId" });
    server.choices = [HOME_AB];
    await startButton().click();
    await expect.poll(async () => (await toasts())[0]?.message ?? "").toMatch(/^Essa página não existe mais/);
    await expect.poll(async () => (await pageSelect().textContent()) ?? "").toBe("Página principal (inicial)");
    await pageSelect().click();
    expect(await page.getByRole("option").allTextContents()).toEqual(["Página principal (inicial)"]);
  });

  it("outro erro (ex.: sem pixels): mostra a mensagem do servidor e não busca opções", async () => {
    await mount();
    server.failures.push({ error: "Nenhum pixel ligado nesta oferta. Cadastre ou ligue um pixel para testar." });
    await startButton().click();
    await expect
      .poll(async () => (await toasts())[0]?.message ?? "")
      .toBe("Nenhum pixel ligado nesta oferta. Cadastre ou ligue um pixel para testar.");
    expect(server.choiceReads).toBe(0);
  });
});

describe("Testar pixels: a versão que a página informou", () => {
  it("linha do tempo mostra versão e pasta; cada evento, a versão que a plataforma recebeu", async () => {
    await mount();
    await variantSelect().click();
    await page.getByRole("option", { name: "Versão B · Headline nova" }).click();
    await startButton().click();
    await page.getByRole("link", { name: "Abrir página de teste" }).waitFor();
    const at = new Date().toISOString();
    server.events.push(
      { id: 1, at, vendor: "RUNTIME", event: "START", status: "LOADED", detail: { versao: "B", pasta: "oferta-b/" } },
      { id: 2, at, vendor: "META", event: "load", status: "LOADED", detail: { pixel: "123456789012345" } },
      {
        id: 3,
        at,
        vendor: "META",
        event: "PageView",
        status: "FIRED",
        detail: { event: "PAGE_VIEW", pixel: "123456789012345", os_versao: "B" },
      },
    );
    // A tela lê os passos a cada ~1,5 s.
    await expect
      .poll(async () => (await page.locator("#root").textContent()) ?? "", { timeout: 6000 })
      .toContain("Versão B · pasta oferta-b/");
    const meta = page.locator('section[data-vendor="META"]');
    await expect.poll(async () => (await meta.textContent()) ?? "", { timeout: 6000 }).toContain("versão B");
    expect(await page.getByRole("region", { name: "Controle do teste" }).textContent()).toContain(
      "Versão B · vence em",
    );
  });
});
