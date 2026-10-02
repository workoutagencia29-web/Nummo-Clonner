/**
 * Fase 4 — tela "Testar pixels" (src/components/offers/pixel-test) num
 * Chromium de verdade, sem Next e sem banco:
 *
 * - as server actions (iniciar/encerrar) são respondidas pelo teste;
 * - GET /api/pixel-test/<sessão> é um servidor falso com os passos que o teste
 *   manda, anotando cada leitura (para conferir o ritmo e a pausa com a aba escondida);
 * - next/link e sonner viram versões simples.
 */
import path from "node:path";
import { build, type Plugin } from "esbuild";
import { type Browser, chromium, type Page, type Route } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PixelTestSetup } from "@/components/offers/pixel-test/logic";
import type { PixelTestEventRow } from "@/lib/tracking/test-report";

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
  name: "pixel-test-stubs",
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
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "pixel-test-entry.tsx" },
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
  events: PixelTestEventRow[] = [];
  expiresAt = new Date(Date.now() + 2 * 3600_000);
  expired = false;
  full = false;
  /** Próximas respostas especiais da leitura. */
  next: ("404" | "500" | "slow")[] = [];
  reads: { after: number; at: number }[] = [];
  actions: { name: string; input: Record<string, unknown> }[] = [];
  private seq = 0;

  add(vendor: string, event: string, status: PixelTestEventRow["status"], detail: Record<string, unknown> = {}) {
    this.events.push({ id: ++this.seq, at: new Date().toISOString(), vendor, event, status, detail });
  }

  sessionView(expiresAt = this.expiresAt) {
    return {
      id: SESSION_ID,
      offerId: OFFER_ID,
      pageId: "home",
      token: TOKEN,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      url: TEST_URL,
      vendors: ["META", "GA4"],
    };
  }

  async action(name: string, input: Record<string, unknown>) {
    this.actions.push({ name, input });
    if (name === "createPixelTestSessionAction") return { ok: true, data: this.sessionView() };
    if (name === "endPixelTestSessionAction") {
      this.expired = true;
      return { ok: true, data: undefined };
    }
    return { ok: false, error: "ação desconhecida" };
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
    const after = Number(url.searchParams.get("after"));
    this.reads.push({ after, at: Date.now() });
    const special = this.next.shift();
    if (special === "404") {
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "Este teste não existe mais. Comece um novo teste." }),
      });
    }
    if (special === "500") {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Algo deu errado. Tente de novo em alguns segundos." }),
      });
    }
    if (special === "slow") await new Promise((r) => setTimeout(r, 1500));
    const events = this.events.filter((e) => e.id > after);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          id: m[1],
          offerId: OFFER_ID,
          pageId: "home",
          expiresAt: this.expiresAt.toISOString(),
          expired: this.expired || this.expiresAt.getTime() <= Date.now(),
          eventCount: this.events.length,
          full: this.full,
        },
        events,
        lastId: events.at(-1)?.id ?? after,
      }),
    });
  }
}

const SETUP: PixelTestSetup = {
  offerId: OFFER_ID,
  offerName: "Oferta de teste",
  pages: [
    { id: "vendas", name: "Vendas", isHome: false },
    { id: "home", name: "Página principal", isHome: true },
  ],
  pixels: [
    { id: "p1", vendor: "META", pixelId: "123456789012345", label: null, conversionLabels: {} },
    { id: "p2", vendor: "GA4", pixelId: "G-ABC123DEF4", label: null, conversionLabels: {} },
  ],
  disabledPixels: 1,
  rules: [
    { pageId: null, event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK", value: null, selector: null },
    { pageId: null, event: "LEAD", trigger: "FORM_SUBMIT", value: null, selector: null },
  ],
  consentMode: "OPT_IN",
  acceptLabel: "Aceitar",
  noticeLabel: "Entendi",
  eventNames: {},
  links: [{ key: "checkout", label: "Checkout" }],
};

let browser: Browser;
let page: Page;
let server: FakePanel;

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  await page?.context().close();
});

/** Abre a tela. `stored`: sessão já guardada na aba (recarregar a tela). */
async function mount(setup: PixelTestSetup = SETUP, stored?: unknown) {
  server = new FakePanel();
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  (page as Page & { osErrors?: string[] }).osErrors = errors;
  await page.exposeFunction("__actionNode", (name: string, input: Record<string, unknown>) =>
    server.action(name, input),
  );
  // Visibilidade controlada pelo teste (aba do painel escondida ou não).
  await context.addInitScript(() => {
    const w = window as unknown as { __vis?: string; __action: unknown; __actionNode: unknown };
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => w.__vis ?? "visible" });
    w.__action = (name: string, input: unknown) =>
      (w.__actionNode as (n: string, i: unknown) => Promise<unknown>)(name, input);
  });
  await context.route("**/*", (route) => server.handle(route));
  await page.goto(`${ORIGIN}/`);
  if (stored !== undefined) {
    await page.evaluate(([key, value]) => sessionStorage.setItem(key, JSON.stringify(value)), [
      `os-pixel-test:${setup.offerId}`,
      stored,
    ] as const);
  }
  await page.addScriptTag({ content: await appBundle() });
  await page.evaluate((s) => (window as unknown as { OS: { mount: (x: unknown) => void } }).OS.mount(s), setup);
}

function errorsOf(p: Page) {
  return (p as Page & { osErrors?: string[] }).osErrors ?? [];
}

async function setVisible(visible: boolean) {
  await page.evaluate((v) => {
    (window as unknown as { __vis?: string }).__vis = v ? "visible" : "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
  }, visible);
}

const metaCard = () => page.locator('section[data-vendor="META"]');
const ga4Card = () => page.locator('section[data-vendor="GA4"]');
const checkItem = (card: ReturnType<typeof metaCard>, label: string) =>
  card.getByRole("listitem").filter({ hasText: label }).first();

async function start() {
  await page.getByRole("button", { name: "Iniciar teste" }).click();
  await page.getByRole("link", { name: "Abrir página de teste" }).waitFor();
}

describe("tela Testar pixels", () => {
  it("antes do teste: página inicial escolhida, pixels que vão carregar e conferência pendente", async () => {
    await mount();
    await expect
      .poll(() => page.getByRole("combobox", { name: "Página para testar" }).textContent())
      .toContain("Página principal (inicial)");
    const text = (await page.locator("#root").textContent()) ?? "";
    expect(text).toContain("2 pixels vão carregar de verdade · 1 desligado fica de fora.");
    expect(await metaCard().textContent()).toContain("123456789012345");
    expect(await metaCard().textContent()).toContain("O que vai ser conferido");
    // Antes do teste: sem linha do tempo nem selo de situação.
    expect(
      await metaCard()
        .getByRole("list", { name: /Linha do tempo/ })
        .count(),
    ).toBe(0);
    expect(await metaCard().locator("header").textContent()).not.toContain("Aguardando");
    expect(text).toContain("não conclua a compra");
    expect(await checkItem(metaCard(), "InitiateCheckout ao clicar no checkout").getAttribute("data-state")).toBe(
      "pending",
    );
    expect(await checkItem(ga4Card(), "begin_checkout ao clicar no checkout").count()).toBe(1);
    // Nada é lido antes de começar.
    expect(server.reads).toEqual([]);
    expect(errorsOf(page)).toEqual([]);
  });

  it("Iniciar teste → link da página de teste em aba nova, contagem regressiva e sessão guardada na aba", async () => {
    await mount();
    await start();
    expect(server.actions).toEqual([
      { name: "createPixelTestSessionAction", input: { offerId: OFFER_ID, pageId: "home" } },
    ]);
    const link = page.getByRole("link", { name: "Abrir página de teste" });
    expect(await link.getAttribute("href")).toBe(TEST_URL);
    expect(await link.getAttribute("target")).toBe("_blank");
    expect(await link.getAttribute("rel")).toContain("noopener");
    const status = (await page.getByRole("region", { name: "Controle do teste" }).textContent()) ?? "";
    expect(status).toContain("Teste em andamento");
    expect(status).toMatch(/Página: Página principal · vence em (2 h 00|1 h 59) min/);
    expect(await page.getByRole("button", { name: "Iniciar teste" }).count()).toBe(0);
    const stored = await page.evaluate((k) => sessionStorage.getItem(k), `os-pixel-test:${OFFER_ID}`);
    expect(JSON.parse(stored ?? "{}")).toMatchObject({ id: SESSION_ID, url: TEST_URL, pageId: "home", ended: false });
    // Sem passos ainda: dica para abrir a página.
    await expect.poll(() => page.locator('[data-tip="open-page"]').count()).toBe(1);
  });

  it("linha do tempo ao vivo: consentimento, pixel carregando e eventos disparando, com a conferência marcada", async () => {
    await mount();
    await start();
    await expect.poll(() => server.reads.length).toBeGreaterThanOrEqual(1);
    expect(server.reads[0].after).toBe(0);

    server.add("RUNTIME", "START", "LOADED", { mode: "test", consent: "OPT_IN", pixels: 2 });
    server.add("CONSENT", "WAITING", "BLOCKED", { hint: 'Os pixels esperam o visitante clicar em "Aceitar".' });
    server.add("CONSENT", "BANNER", "LOADED", { mode: "OPT_IN" });
    const consent = page.getByRole("region", { name: /Consentimento \(LGPD\)/ });
    await expect.poll(() => consent.textContent(), { timeout: 5000 }).toContain("Esperando o “Aceitar”");
    expect(await page.locator('[data-tip="consent-waiting"]').count()).toBe(1);
    expect(await page.locator('[data-tip="open-page"]').count()).toBe(0);
    expect(await consent.getByRole("listitem").filter({ hasText: "Página de teste aberta" }).count()).toBe(1);

    server.add("CONSENT", "ACCEPTED", "FIRED", { remembered: false });
    server.add("META", "load", "LOADED", { pixel: "123456789012345" });
    server.add("META", "PageView", "FIRED", { event: "PAGE_VIEW", pixel: "123456789012345" });
    server.add("GA4", "load", "LOADED", { pixel: "G-ABC123DEF4" });
    server.add("GA4", "page_view", "FIRED", { event: "PAGE_VIEW", pixel: "G-ABC123DEF4" });
    await expect.poll(() => metaCard().locator("header").textContent(), { timeout: 5000 }).toContain("Carregou");
    expect(await consent.locator("header").textContent()).toContain("Aceito");
    expect(await checkItem(metaCard(), "Pixel carregou").getAttribute("data-state")).toBe("done");
    expect(await checkItem(metaCard(), "PageView disparou").getAttribute("data-state")).toBe("done");
    expect(await checkItem(metaCard(), "InitiateCheckout ao clicar no checkout").getAttribute("data-state")).toBe(
      "pending",
    );
    expect(await page.locator('[data-tip="only-page-view"]').textContent()).toContain(
      "Clique no botão de compra da página de teste",
    );
    // A leitura continua de onde parou.
    const lastAfter = server.reads.at(-1)?.after ?? 0;
    expect(lastAfter).toBeGreaterThan(0);

    server.add("META", "InitiateCheckout", "FIRED", { event: "INITIATE_CHECKOUT", pixel: "123456789012345" });
    await expect
      .poll(() => checkItem(metaCard(), "InitiateCheckout ao clicar no checkout").getAttribute("data-state"), {
        timeout: 5000,
      })
      .toBe("done");
    const timeline = metaCard().getByRole("list", { name: "Linha do tempo — Meta (Facebook e Instagram)" });
    const rows = await timeline.getByRole("listitem").allTextContents();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/InitiateCheckout\s*Disparou/);
    expect(rows[2]).toMatch(/Pixel carregou\s*CarregouID 123456789012345/);
    expect(await page.locator('[data-tip="only-page-view"]').count()).toBe(0);
    expect(errorsOf(page)).toEqual([]);
  });

  it("script bloqueado: selo Bloqueado, explicação e dica (bloqueador, rede ou internet)", async () => {
    await mount();
    await start();
    const hint = "Bloqueado pelo navegador (bloqueador de anúncios, extensão ou rede).";
    server.add("CONSENT", "ACCEPTED", "FIRED");
    server.add("META", "load", "BLOCKED", { pixel: "123456789012345", hint });
    server.add("META", "PageView", "BLOCKED", { event: "PAGE_VIEW", hint });
    await expect.poll(() => metaCard().locator("header").textContent(), { timeout: 5000 }).toContain("Bloqueado");
    expect(await checkItem(metaCard(), "Pixel carregou").getAttribute("data-state")).toBe("failed");
    expect(await metaCard().textContent()).toContain(hint);
    const tip = await page.locator('[data-tip="blocked"]').textContent();
    expect(tip).toContain("Script bloqueado");
    expect(tip).toContain("Desative o bloqueador para a página de teste");
    expect(tip).toContain("a rede (firewall, filtro de DNS");
  });

  it("aba do painel escondida: para de ler; ao voltar, lê na hora", async () => {
    await mount();
    await start();
    await expect.poll(() => server.reads.length).toBeGreaterThanOrEqual(1);
    await setVisible(false);
    await page.waitForTimeout(200);
    const count = server.reads.length;
    await page.waitForTimeout(3500);
    expect(server.reads.length).toBe(count);
    const before = Date.now();
    await setVisible(true);
    await expect.poll(() => server.reads.length, { timeout: 1000 }).toBe(count + 1);
    expect((server.reads.at(-1)?.at ?? 0) - before).toBeLessThan(800);
  });

  it("lê a cada ~1,5 s", async () => {
    await mount();
    await start();
    await expect.poll(() => server.reads.length, { timeout: 6000 }).toBeGreaterThanOrEqual(3);
    const gaps = server.reads.slice(1, 3).map((r, i) => r.at - server.reads[i].at);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(1200);
      expect(gap).toBeLessThan(2500);
    }
  });

  it("Encerrar teste: ação, resultado continua na tela, leitura para e dá para começar outro", async () => {
    await mount();
    await start();
    server.add("META", "load", "LOADED");
    await expect.poll(() => metaCard().locator("header").textContent(), { timeout: 5000 }).toContain("Carregou");
    await page.getByRole("button", { name: "Encerrar teste" }).click();
    const control = page.getByRole("region", { name: "Controle do teste" });
    await expect.poll(() => control.textContent(), { timeout: 5000 }).toContain("Teste encerrado");
    expect(server.actions.at(-1)).toEqual({ name: "endPixelTestSessionAction", input: { sessionId: SESSION_ID } });
    expect(await page.evaluate(() => (window as unknown as { __toasts: { message: string }[] }).__toasts)).toEqual([
      { type: "success", message: "Teste encerrado. O link da página de teste parou de funcionar." },
    ]);
    // O resultado continua; a leitura parou.
    expect(await metaCard().locator("header").textContent()).toContain("Carregou");
    expect(await page.getByRole("link", { name: "Abrir página de teste" }).count()).toBe(0);
    await page.waitForTimeout(500);
    const reads = server.reads.length;
    await page.waitForTimeout(2500);
    expect(server.reads.length).toBe(reads);
    expect(await page.evaluate((k) => sessionStorage.getItem(k), `os-pixel-test:${OFFER_ID}`)).toBeNull();

    await page.getByRole("button", { name: "Começar novo teste" }).click();
    expect(await page.getByRole("button", { name: "Iniciar teste" }).count()).toBe(1);
    expect(await metaCard().textContent()).toContain("O que vai ser conferido");
    expect(await metaCard().locator("header").textContent()).not.toContain("Carregou");
  });

  it("recarregar a tela continua o teste guardado na aba", async () => {
    const stored = {
      id: SESSION_ID,
      token: TOKEN,
      url: TEST_URL,
      pageId: "vendas",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      vendors: ["META"],
      ended: false,
    };
    await mount(SETUP, stored);
    await page.getByRole("link", { name: "Abrir página de teste" }).waitFor();
    expect(server.actions).toEqual([]);
    expect(await page.getByRole("region", { name: "Controle do teste" }).textContent()).toContain("Página: Vendas");
    await expect.poll(() => server.reads.length).toBeGreaterThanOrEqual(1);
    // Só as plataformas da sessão.
    expect(await ga4Card().count()).toBe(0);
  });

  it("venceu pelo relógio: mostra o fim e faz uma última leitura", async () => {
    const stored = {
      id: SESSION_ID,
      token: TOKEN,
      url: TEST_URL,
      pageId: "home",
      expiresAt: new Date(Date.now() + 2500).toISOString(),
      vendors: ["META", "GA4"],
      ended: false,
    };
    await mount(SETUP, stored);
    server.expiresAt = new Date(stored.expiresAt);
    await page.getByRole("link", { name: "Abrir página de teste" }).waitFor();
    const control = page.getByRole("region", { name: "Controle do teste" });
    await expect.poll(() => control.textContent(), { timeout: 6000 }).toContain("Este teste venceu");
    expect(await control.textContent()).toContain("Cada teste vale por 2 horas");
    await page.waitForTimeout(500);
    const reads = server.reads.length;
    await page.waitForTimeout(2500);
    expect(server.reads.length).toBe(reads);
    expect(await page.getByRole("button", { name: "Começar novo teste" }).count()).toBe(1);
  });

  it("carregando: esqueleto até a primeira leitura; falha passageira mostra aviso e se recupera", async () => {
    await mount();
    server.next.push("slow");
    await start();
    expect(await metaCard().count()).toBe(0);
    await expect.poll(() => metaCard().count(), { timeout: 5000 }).toBe(1);

    server.next.push("500");
    await expect
      .poll(() => page.getByRole("status").textContent(), { timeout: 5000 })
      .toContain("Algo deu errado. Tente de novo em alguns segundos.");
    await expect.poll(() => page.getByRole("status").count(), { timeout: 8000 }).toBe(0);
  });

  it("teste apagado (404): tela explica e oferece começar outro", async () => {
    await mount();
    server.next.push("404");
    await start();
    const control = page.getByRole("region", { name: "Controle do teste" });
    await expect.poll(() => control.textContent(), { timeout: 5000 }).toContain("Teste indisponível");
    expect(await control.textContent()).toContain("Este teste não existe mais. Comece um novo teste.");
    expect(await page.getByRole("button", { name: "Começar novo teste" }).count()).toBe(1);
  });

  it("sem pixels ligados: estado vazio com o caminho para configurar", async () => {
    await mount({ ...SETUP, pixels: [], disabledPixels: 0 });
    expect(await page.getByText("Nenhum pixel ligado nesta oferta").count()).toBe(1);
    const link = page.getByRole("link", { name: "Configurar pixels" });
    expect(await link.getAttribute("href")).toBe(`/ofertas/${OFFER_ID}?aba=rastreamento&secao=pixels`);
    expect(await page.getByRole("button", { name: "Iniciar teste" }).count()).toBe(0);

    await mount({ ...SETUP, pixels: [], disabledPixels: 2 });
    expect(await page.locator("#root").textContent()).toContain("Os pixels desta oferta estão desligados");
  });
});
