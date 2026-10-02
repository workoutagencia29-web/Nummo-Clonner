/**
 * Script de rastreamento das páginas (src/runtime/tracking) num Chromium de
 * verdade, sem internet: o HTML passa pelo mesmo caminho da prévia/ZIP
 * (injectTracking + script compilado como em src/lib/runtime-bundle.ts) e os
 * scripts das plataformas (Meta, TikTok, Kwai, gtag, UTMify) são trocados por
 * versões locais que anotam cada chamada em window.__calls.
 */
import path from "node:path";
import { gzipSync } from "node:zlib";
import { buildSync } from "esbuild";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { injectPageCode } from "@/lib/page-code";
import { DELAY_STYLE, runtimeScript } from "@/lib/runtime-bundle";
import { knownCheckoutHosts } from "@/lib/tracking/compose";
import { gateCode, injectTracking } from "@/lib/tracking/inject";
import type { PixelTestReport, RuntimePixel, TrackingRuntimeConfig } from "@/lib/tracking/runtime-config";
import { DEFAULT_FORWARD_PARAMS, PIXEL_VENDORS, TRACKING_EVENTS } from "@/lib/tracking/schema";
import { parsePixelTestReport } from "@/lib/tracking/test-report";
import { vendorEventName } from "@/lib/tracking/vendors";

// ─── Script compilado (mesmas opções de src/lib/runtime-bundle.ts) ───────────

const SCRIPT = buildSync({
  entryPoints: [path.join(process.cwd(), "src/runtime/tracking/index.ts")],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2018", "safari13"],
  write: false,
  legalComments: "none",
}).outputFiles[0].text;

const TAG = `<script data-os-tracking>${SCRIPT.replace(/<\/(script)/gi, "<\\/$1")}</script>`;

// ─── Configuração ────────────────────────────────────────────────────────────

const NAMES = Object.fromEntries(
  PIXEL_VENDORS.map((v) => [v, Object.fromEntries(TRACKING_EVENTS.map((e) => [e, vendorEventName(v, e)]))]),
) as TrackingRuntimeConfig["names"];

const TOKEN = "abcdefghijklmnopqrstuvwxyz";

const PX = {
  META: { vendor: "META", id: "123456789012345", options: {} },
  META2: { vendor: "META", id: "999999999999999", options: {} },
  TIKTOK: { vendor: "TIKTOK", id: "C1ABCDEFGHIJ2KLMNOPQ", options: {} },
  KWAI: { vendor: "KWAI", id: "283746592837465", options: {} },
  GA4: { vendor: "GA4", id: "G-ABC123DEF4", options: {} },
  ADS: {
    vendor: "GOOGLE_ADS",
    id: "AW-123456789",
    options: { conversionLabels: { LEAD: "rotuloLead", INITIATE_CHECKOUT: "rotuloCk" } },
  },
  UTMIFY: {
    vendor: "UTMIFY",
    id: "66f1a2b3c4d5e6f7a8b9c0d1",
    options: { utmsScript: true, preventSubids: true, preventXcodSck: false },
  },
} satisfies Record<string, RuntimePixel>;

type Over = Partial<Omit<TrackingRuntimeConfig, "consent" | "forwarding">> & {
  consent?: Partial<TrackingRuntimeConfig["consent"]>;
  forwarding?: Partial<TrackingRuntimeConfig["forwarding"]>;
};

function config(over: Over = {}): TrackingRuntimeConfig {
  return {
    v: 1,
    mode: "live",
    pixels: [],
    rules: [],
    names: NAMES,
    value: { currency: "BRL", amount: null },
    checkoutLinkKeys: ["checkout", "upsell"],
    checkoutHosts: ["pay.hotmart.com", ".kiwify.com.br"],
    marketingCode: false,
    server: null,
    test: null,
    ...over,
    consent: {
      mode: "OPT_IN",
      text: "Usamos cookies para medir nossos anúncios.",
      acceptLabel: "Aceitar",
      rejectLabel: "Recusar",
      noticeLabel: "Entendi",
      policyLabel: "Política de privacidade",
      position: "bottom",
      theme: "dark",
      policyUrl: "/privacidade",
      ...over.consent,
    },
    forwarding: {
      enabled: true,
      params: [...DEFAULT_FORWARD_PARAMS],
      toCheckout: true,
      toInternalLinks: true,
      persistDays: 30,
      ...over.forwarding,
    },
  };
}

const testMode = { mode: "test" as const, test: { endpoint: "/__os/pixel-test", token: TOKEN } };

/** Página como o visitante recebe: configuração + script no começo do <head> (injectTracking). */
function pageHtml(cfg: TrackingRuntimeConfig | null, body = "", opts: { head?: string; bodyEnd?: string } = {}) {
  const base = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Oferta</title>${opts.head ?? ""}</head><body>${body}${opts.bodyEnd ?? ""}</body></html>`;
  return cfg ? injectTracking(base, cfg, TAG) : base;
}

// ─── Scripts das plataformas (versões locais) ────────────────────────────────

const REC = "var c=window.__calls=window.__calls||[];var A=function(a){return [].slice.call(a)};";
const STUBS: Record<string, string> = {
  "https://connect.facebook.net/en_US/fbevents.js": `(function(){${REC}c.push(["load","META"]);
    var q=fbq.queue.slice();fbq.queue.length=0;
    fbq.callMethod=function(){c.push(["fbq"].concat(A(arguments)))};
    q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`,
  "https://analytics.tiktok.com/i18n/pixel/events.js": `(function(){${REC}var u=new URL(document.currentScript.src);
    c.push(["load","TIKTOK",u.searchParams.get("sdkid"),u.searchParams.get("lib"),window.TiktokAnalyticsObject]);
    if(ttq.__stub)return;ttq.__stub=1;var q=ttq.splice(0);
    q.forEach(function(a){c.push(["ttq"].concat(a))});
    ["page","track","grantConsent","revokeConsent"].forEach(function(m){ttq[m]=function(){c.push(["ttq",m].concat(A(arguments)))}});})();`,
  "https://s1.kwai.net/kos/s101/nlav11187/pixel/events.js": `(function(){${REC}var u=new URL(document.currentScript.src);var id=u.searchParams.get("sdkid");
    c.push(["load","KWAI",id,u.searchParams.get("lib"),window.KwaiAnalyticsObject]);
    (kwaiq._i[id]||[]).splice(0).forEach(function(a){c.push(["kwaiq:"+id].concat(a))});
    if(kwaiq.__stub)return;kwaiq.__stub=1;kwaiq.splice(0).forEach(function(a){c.push(["kwaiq"].concat(a))});
    kwaiq.page=function(){c.push(["kwaiq","page"])};
    kwaiq.instance=function(p){return {track:function(){c.push(["kwaiq:"+p,"track"].concat(A(arguments)))}}};})();`,
  "https://www.googletagmanager.com/gtag/js": `(function(){${REC}c.push(["load","GTAG",new URL(document.currentScript.src).searchParams.get("id")]);})();`,
  "https://cdn.utmify.com.br/scripts/pixel/pixel.js": `(function(){${REC}c.push(["load","UTMIFY",window.pixelId]);})();`,
  "https://cdn.utmify.com.br/scripts/utms/latest.js": `(function(){${REC}var s=document.currentScript;
    c.push(["load","UTMS",s.hasAttribute("data-utmify-prevent-subids"),s.hasAttribute("data-utmify-prevent-xcod-sck")]);})();`,
};
const META_URL = "https://connect.facebook.net/";

// ─── Navegador ───────────────────────────────────────────────────────────────

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

interface Site {
  page: Page;
  context: BrowserContext;
  /** Passos recebidos pela tela de teste. */
  reports: PixelTestReport[];
  /** Eventos recebidos pelo eventos.php. */
  server: Record<string, unknown>[];
  /** Scripts de plataformas pedidos (inclusive os bloqueados). */
  vendorRequests: string[];
  /** Endereços para onde a página navegou fora de site.test (checkouts). */
  navigations: string[];
  /** Todos os pedidos para fora de site.test (scripts, imagens, CSS, iframes…), menos os scripts das plataformas. */
  requests: string[];
  errors: string[];
  info: string[];
  goto: (pathAndQuery: string) => Promise<void>;
}

interface OpenOptions {
  query?: string;
  /** Outras páginas do site (caminho → HTML). */
  pages?: Record<string, string>;
  /** Scripts de plataformas bloqueados (prefixo da URL), como um bloqueador de anúncios. */
  block?: string[];
  /** Arquivos extras (caminho → [tipo, conteúdo, atraso ms]). */
  files?: Record<string, [string, string, number?]>;
  init?: string;
  clock?: boolean;
  viewport?: { width: number; height: number };
  context?: BrowserContext;
  /** Scripts de plataformas trocados (prefixo da URL → código). */
  stubs?: Record<string, string>;
  /** Atraso (ms) para responder os scripts de plataformas (prefixo da URL). */
  delay?: Record<string, number>;
  /** Páginas de fora (prefixo da URL → HTML), para navegar de verdade (ex.: o checkout). */
  external?: Record<string, string>;
  /** Endereço inicial (padrão: /oferta). */
  path?: string;
  /** Até quando esperar a primeira página (padrão: load). */
  waitUntil?: "load" | "domcontentloaded";
}

async function open(html: string, opts: OpenOptions = {}): Promise<Site> {
  const context =
    opts.context ?? (await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 800 } }));
  const page = await context.newPage();
  const site: Site = {
    page,
    context,
    reports: [],
    server: [],
    vendorRequests: [],
    navigations: [],
    requests: [],
    errors: [],
    info: [],
    goto: async (p) => {
      await page.goto(`http://site.test${p}`, { waitUntil: opts.waitUntil ?? "load" });
    },
  };
  page.on("pageerror", (e) => site.errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "info") site.info.push(m.text());
  });
  const pages: Record<string, string> = { "/oferta": html, ...opts.pages };
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === "http://site.test") {
      if (pages[url.pathname] !== undefined) {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: pages[url.pathname] });
      }
      if (url.pathname === "/__os/pixel-test") {
        site.reports.push(JSON.parse(req.postData() ?? "{}"));
        return route.fulfill({ status: 204 });
      }
      if (url.pathname === "/eventos.php") {
        site.server.push(JSON.parse(req.postData() ?? "{}"));
        return route.fulfill({ status: 204 });
      }
      const file = opts.files?.[url.pathname];
      if (file) {
        if (file[2]) await new Promise((r) => setTimeout(r, file[2]));
        return route.fulfill({ contentType: file[0], body: file[1] });
      }
      return route.fulfill({ status: 404, body: "" });
    }
    // Os trocados pelo teste valem antes dos padrões.
    const stubs = { ...opts.stubs, ...STUBS, ...opts.stubs };
    const stub = Object.keys(stubs).find((prefix) => req.url().startsWith(prefix));
    if (stub) {
      site.vendorRequests.push(req.url());
      if (opts.block?.some((b) => req.url().startsWith(b))) return route.abort("blockedbyclient");
      const wait = Object.entries(opts.delay ?? {}).find(([prefix]) => req.url().startsWith(prefix))?.[1];
      if (wait) await new Promise((r) => setTimeout(r, wait));
      return route.fulfill({ contentType: "application/javascript", body: stubs[stub] }).catch(() => {});
    }
    site.requests.push(req.url());
    if (req.isNavigationRequest()) site.navigations.push(req.url());
    const external = Object.entries(opts.external ?? {}).find(([prefix]) => req.url().startsWith(prefix));
    if (external) return route.fulfill({ contentType: "text/html; charset=utf-8", body: external[1] });
    return route.fulfill({ status: 204, body: "" });
  });
  if (opts.init) await page.addInitScript({ content: opts.init });
  if (opts.clock) await page.clock.install();
  await site.goto(`${opts.path ?? "/oferta"}${opts.query ?? ""}`);
  return site;
}

type Call = unknown[];
const calls = (page: Page): Promise<Call[]> => page.evaluate(() => (window as { __calls?: Call[] }).__calls ?? []);
const dataLayer = (page: Page): Promise<Call[]> =>
  page.evaluate(() =>
    ((window as { dataLayer?: IArguments[] }).dataLayer ?? []).map((a) =>
      Array.from(a).map((x) => (x instanceof Date ? "<data>" : x)),
    ),
  );
const byPrefix = (list: Call[], prefix: string) => list.filter((c) => c[0] === prefix);
const stored = (page: Page, key: string) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), key) as Promise<Record<string, unknown> | null>;
const banner = (page: Page) => page.getByRole("region", { name: "Aviso de cookies" });
/** Guarda as chamadas dos pixels e o dataLayer ao sair da página (a próxima página lê). */
const KEEP_CALLS = `addEventListener("pagehide",function(){try{sessionStorage.setItem("calls",JSON.stringify(window.__calls||[]));sessionStorage.setItem("dl",JSON.stringify((window.dataLayer||[]).map(function(a){return [].slice.call(a).map(function(x){return x instanceof Date?"<data>":x})})))}catch(e){}})`;
const keptCalls = async (page: Page, key = "calls"): Promise<Call[]> =>
  JSON.parse((await page.evaluate((k) => sessionStorage.getItem(k), key)) ?? "[]");
/** Anota os cliques em links sem sair da página (o checkout abriria outro site). */
const STAY = `<script>document.addEventListener("click",function(e){if(e.target.closest("a"))e.preventDefault()})</script>`;

async function settle(page: Page, ms = 150) {
  await page.waitForTimeout(ms);
}

// ─── Consentimento ───────────────────────────────────────────────────────────

describe("consentimento (LGPD)", () => {
  it("OPT_IN: nada carrega antes do Aceitar; o banner é acessível; depois do Aceitar tudo carrega e fica lembrado", async () => {
    const cfg = config({ pixels: [PX.META, PX.TIKTOK] });
    const site = await open(pageHtml(cfg, "<h1>Oferta</h1>"));
    const { page } = site;

    const dialog = banner(page);
    await expect.poll(() => dialog.isVisible()).toBe(true);
    await expect.poll(() => dialog.textContent()).toContain("Usamos cookies para medir nossos anúncios.");
    // Região (não modal) no começo do <body>: primeira na ordem do Tab, sem roubar o foco.
    expect(await page.evaluate(() => document.body.firstElementChild?.tagName)).toBe("OS-CONSENT");
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("OS-CONSENT");
    expect(await page.getByRole("link", { name: "Política de privacidade" }).getAttribute("href")).toBe("/privacidade");
    expect(await page.getByRole("button", { name: "Recusar" }).isVisible()).toBe(true);
    // Banner flutuante: não empurra a página.
    expect(
      await page.$eval("os-consent", (el) => getComputedStyle(el.shadowRoot?.querySelector(".b") as Element).position),
    ).toBe("fixed");

    await settle(page, 300);
    expect(site.vendorRequests).toEqual([]);
    expect(await page.evaluate(() => typeof (window as { fbq?: unknown }).fbq)).toBe("undefined");
    expect(await page.evaluate(() => typeof (window as { ttq?: unknown }).ttq)).toBe("undefined");

    await page.getByRole("button", { name: "Aceitar" }).click();
    await expect.poll(async () => byPrefix(await calls(page), "load").length).toBe(2);
    expect(await dialog.count()).toBe(0);
    const saved = await stored(page, "os_consent");
    expect(saved).toMatchObject({ v: 1, choice: "accepted" });
    expect(Math.abs(Number(saved?.at) - Date.now())).toBeLessThan(60_000);
    expect(await page.evaluate(() => (window as { osConsent?: { get(): string } }).osConsent?.get())).toBe("accepted");

    // Voltando: sem banner, pixels carregam direto.
    site.vendorRequests.length = 0;
    await page.reload();
    await expect.poll(() => site.vendorRequests.length).toBe(2);
    await settle(page);
    expect(await dialog.count()).toBe(0);
    expect(site.errors).toEqual([]);
    await site.context.close();
  });

  it("Recusar: nada carrega, a escolha fica lembrada e os eventos não saem", async () => {
    const cfg = config({
      ...testMode,
      pixels: [PX.META],
      rules: [{ event: "LEAD", trigger: "ELEMENT_CLICK", value: null, selector: "#cta" }],
    });
    const site = await open(pageHtml(cfg, `<button id="cta">Quero</button>`));
    const { page } = site;
    await page.getByRole("button", { name: "Recusar" }).click();
    expect(await banner(page).count()).toBe(0);
    expect(await stored(page, "os_consent")).toMatchObject({ v: 1, choice: "rejected" });
    await page.click("#cta");
    await settle(page, 300);
    expect(site.vendorRequests).toEqual([]);
    expect(site.reports.find((r) => r.vendor === "CONSENT" && r.event === "REJECTED")?.status).toBe("BLOCKED");
    expect(site.reports.find((r) => r.vendor === "CONSENT" && r.event === "LEAD")).toMatchObject({ status: "BLOCKED" });

    await page.reload();
    await settle(page, 300);
    expect(await banner(page).count()).toBe(0);
    expect(site.vendorRequests).toEqual([]);
    expect(await page.evaluate(() => (window as { osConsent?: { get(): string } }).osConsent?.get())).toBe("rejected");
    await site.context.close();
  });

  it("NOTICE: só avisa (botão Entendi) e os pixels carregam na hora; OFF: sem banner e carrega direto", async () => {
    const notice = await open(pageHtml(config({ pixels: [PX.META], consent: { mode: "NOTICE" } })));
    await expect.poll(() => notice.vendorRequests.length).toBe(1);
    expect(await notice.page.getByRole("button", { name: "Entendi" }).isVisible()).toBe(true);
    expect(await notice.page.getByRole("button", { name: "Recusar" }).count()).toBe(0);
    await notice.page.getByRole("button", { name: "Entendi" }).click();
    expect(await stored(notice.page, "os_consent")).toMatchObject({ choice: "notice" });
    await notice.page.reload();
    await settle(notice.page, 300);
    expect(await banner(notice.page).count()).toBe(0);
    await notice.context.close();

    const off = await open(pageHtml(config({ pixels: [PX.META], consent: { mode: "OFF" } })));
    await expect.poll(() => off.vendorRequests.length).toBe(1);
    await settle(off.page, 300);
    expect(await off.page.locator("os-consent").count()).toBe(0);
    await off.page.evaluate(() => (window as { osConsent?: { open(): void } }).osConsent?.open());
    await settle(off.page);
    expect(await off.page.locator("os-consent").count()).toBe(0);
    await off.context.close();
  });

  it("OFF: o link 'Preferências de cookies' some (não haveria o que abrir); nos outros modos continua visível", async () => {
    const footer = `<footer><a href="#" id="cookies" data-os-consent-open style="display:inline-block !important">Preferências de cookies</a><a href="/termos" id="termos">Termos</a></footer>`;
    const off = await open(pageHtml(config({ pixels: [PX.META], consent: { mode: "OFF" } }), footer));
    await expect.poll(() => off.page.locator("#cookies").isVisible()).toBe(false);
    expect(await off.page.locator("#termos").isVisible()).toBe(true);
    await off.context.close();
    for (const mode of ["OPT_IN", "NOTICE"] as const) {
      const site = await open(pageHtml(config({ pixels: [PX.META], consent: { mode } }), footer));
      await settle(site.page, 200);
      expect(await site.page.locator("#cookies").isVisible()).toBe(true);
      await site.context.close();
    }
  });

  it("[data-os-consent-open] e osConsent.open() reabrem o banner com o foco nele; dá para mudar de ideia", async () => {
    const cfg = config({ pixels: [PX.META, PX.TIKTOK] });
    const site = await open(
      pageHtml(
        cfg,
        `<button id="lead" data-os-event="LEAD">Quero</button><footer><a href="#" id="cookies" data-os-consent-open>Preferências de cookies</a></footer>`,
      ),
      { init: KEEP_CALLS },
    );
    const { page } = site;
    await page.getByRole("button", { name: "Recusar" }).click();
    await settle(page);
    expect(site.vendorRequests).toEqual([]);

    await page.click("#cookies");
    await expect.poll(() => banner(page).isVisible()).toBe(true);
    // O foco vai para o primeiro botão do banner (dentro do shadow DOM).
    expect(await page.evaluate(() => document.activeElement?.shadowRoot?.activeElement?.textContent)).toBe("Recusar");
    expect(page.url()).toBe("http://site.test/oferta"); // o href="#" não navegou
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.shadowRoot?.activeElement?.textContent)).toBe("Aceitar");
    await page.keyboard.press("Enter");
    await expect.poll(() => site.vendorRequests.length).toBe(2);
    // O foco volta para o link que abriu o banner.
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("cookies");
    expect(await stored(page, "os_consent")).toMatchObject({ choice: "accepted" });

    await page.evaluate(() => (window as { osConsent?: { open(): void } }).osConsent?.open());
    await expect.poll(() => banner(page).isVisible()).toBe(true);
    // Revogar depois de aceitar: Meta e TikTok param na hora e a página recarrega
    // (TikTok, Kwai, UTMify e o código de marketing já carregados não têm como ser desligados).
    await expect.poll(async () => byPrefix(await calls(page), "fbq").length).toBe(2); // init + PageView
    site.vendorRequests.length = 0;
    const reloaded = page.waitForEvent("load");
    await page.getByRole("button", { name: "Recusar" }).click();
    await reloaded;
    const before = await keptCalls(page);
    expect(byPrefix(before, "fbq").slice(2)).toEqual([["fbq", "consent", "revoke"]]);
    expect(byPrefix(before, "ttq")).toContainEqual(["ttq", "revokeConsent"]);
    expect(await stored(page, "os_consent")).toMatchObject({ choice: "rejected" });
    // Depois de recarregar, com "recusado" guardado: nada carrega e os eventos não saem.
    await page.click("#lead");
    await settle(page, 300);
    expect(site.vendorRequests).toEqual([]);
    expect(await page.evaluate(() => typeof (window as { fbq?: unknown }).fbq)).toBe("undefined");
    expect(await page.evaluate(() => document.cookie)).not.toMatch(/_fbp|_fbc/);
    await site.context.close();
  });

  it("escolha vencida (mais de 180 dias) ou só um 'Entendi' antigo pedem permissão de novo", async () => {
    const cfg = config({ pixels: [PX.META] });
    const old = Date.now() - 181 * 86_400_000;
    for (const value of [{ v: 1, choice: "accepted", at: old }, { v: 1, choice: "notice", at: Date.now() }, "lixo{"]) {
      const site = await open(pageHtml(cfg), {
        init: `localStorage.setItem("os_consent", ${JSON.stringify(typeof value === "string" ? value : JSON.stringify(value))})`,
      });
      await expect.poll(() => banner(site.page).isVisible()).toBe(true);
      expect(site.vendorRequests).toEqual([]);
      await site.context.close();
    }
  });

  it("sem pixels nem código de marketing, não mostra banner à toa (mas osConsent.open() mostra)", async () => {
    const site = await open(pageHtml(config()));
    await settle(site.page, 300);
    expect(await site.page.locator("os-consent").count()).toBe(0);
    await site.page.evaluate(() => (window as { osConsent?: { open(): void } }).osConsent?.open());
    await expect.poll(() => banner(site.page).isVisible()).toBe(true);
    await site.context.close();
  });

  it("tema claro, posição no canto e celular: cabe na tela sem rolagem lateral", async () => {
    const cfg = config({ pixels: [PX.META], consent: { theme: "light", position: "bottom-right" } });
    const desktop = await open(pageHtml(cfg, "<p>conteúdo</p>"));
    const box = await desktop.page.$eval("os-consent", (el) => {
      const b = el.shadowRoot?.querySelector(".b") as HTMLElement;
      const r = b.getBoundingClientRect();
      return {
        cls: b.className,
        left: r.left,
        right: r.right,
        bottom: r.bottom,
        bg: getComputedStyle(b).backgroundColor,
      };
    });
    expect(box.cls).toContain("l");
    expect(box.cls).toContain("br");
    expect(box.right).toBeCloseTo(1280 - 12, 0);
    expect(box.left).toBeGreaterThan(800);
    expect(box.bg).toBe("rgb(255, 255, 255)");
    await desktop.context.close();

    const phone = await open(pageHtml(cfg, "<p>conteúdo</p>"), { viewport: { width: 360, height: 700 } });
    const m = await phone.page.$eval("os-consent", (el) => {
      const r = (el.shadowRoot?.querySelector(".b") as HTMLElement).getBoundingClientRect();
      const buttons = Array.from(el.shadowRoot?.querySelectorAll("button") ?? []).map((b) => b.getBoundingClientRect());
      return {
        left: r.left,
        right: r.right,
        bottom: r.bottom,
        scroll: document.documentElement.scrollWidth,
        buttons: buttons.map((b) => b.width),
      };
    });
    expect(m.left).toBeCloseTo(12, 0);
    expect(m.right).toBeCloseTo(348, 0);
    expect(m.bottom).toBeLessThanOrEqual(700);
    expect(m.scroll).toBeLessThanOrEqual(360);
    // Botões dividem a largura no celular (fáceis de tocar).
    expect(m.buttons[0]).toBeGreaterThan(120);
    await phone.context.close();
  });

  it("o CSS da página não desmonta o banner (shadow DOM) e o texto da configuração nunca vira HTML", async () => {
    const cfg = config({
      pixels: [PX.META],
      consent: { text: '<img src=x onerror="window.__xss=1">Cookies', policyUrl: "javascript:alert(1)" },
    });
    const site = await open(
      pageHtml(cfg, "", {
        head: "<style>button{display:none!important}div{display:none}*{color:red!important}</style>",
      }),
    );
    const { page } = site;
    await expect.poll(() => page.getByRole("button", { name: "Aceitar" }).isVisible()).toBe(true);
    await expect.poll(() => banner(page).textContent()).toContain('<img src=x onerror="window.__xss=1">Cookies');
    expect(await page.getByRole("link", { name: "Política de privacidade" }).count()).toBe(0);
    await settle(page);
    expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
    await site.context.close();
  });
});

// ─── Google Consent Mode v2 ──────────────────────────────────────────────────

describe("Google Consent Mode v2", () => {
  it("OPT_IN: padrão negado antes de tudo; no Aceitar, update concedido e só então js/config", async () => {
    const cfg = config({ pixels: [PX.GA4, PX.ADS] });
    const site = await open(pageHtml(cfg), { init: KEEP_CALLS });
    const { page } = site;
    const denied = {
      ad_storage: "denied",
      analytics_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      wait_for_update: 500,
    };
    await settle(page, 200);
    expect(await dataLayer(page)).toEqual([["consent", "default", denied]]);
    expect(site.vendorRequests).toEqual([]);

    await page.getByRole("button", { name: "Aceitar" }).click();
    await expect.poll(async () => byPrefix(await calls(page), "load")).toEqual([["load", "GTAG", "G-ABC123DEF4"]]);
    const granted = {
      ad_storage: "granted",
      analytics_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
    };
    expect(await dataLayer(page)).toEqual([
      ["consent", "default", denied],
      ["consent", "update", granted],
      ["js", "<data>"],
      ["config", "G-ABC123DEF4"],
      ["config", "AW-123456789"],
    ]);

    // Mudou de ideia: update negado (e a página recarrega).
    await page.evaluate(() => (window as { osConsent?: { open(): void } }).osConsent?.open());
    const reloaded = page.waitForEvent("load");
    await page.getByRole("button", { name: "Recusar" }).click();
    await reloaded;
    const { wait_for_update: _, ...deniedUpdate } = denied;
    expect((await keptCalls(page, "dl")).at(-1)).toEqual(["consent", "update", deniedUpdate]);

    // Com "recusado" guardado: só o padrão negado, nada de config.
    await settle(page, 200);
    expect(await dataLayer(page)).toEqual([["consent", "default", denied]]);
    await site.context.close();
  });

  it("aceite lembrado: default negado → update concedido antes do config; NOTICE/OFF: padrão já concedido", async () => {
    const cfg = config({ pixels: [PX.GA4] });
    const remembered = await open(pageHtml(cfg), {
      init: `localStorage.setItem("os_consent", JSON.stringify({ v: 1, choice: "accepted", at: Date.now() }))`,
    });
    await expect
      .poll(async () => (await dataLayer(remembered.page)).map((c) => `${c[0]}:${c[1]}`))
      .toEqual(["consent:default", "consent:update", "js:<data>", "config:G-ABC123DEF4"]);
    await remembered.context.close();

    for (const mode of ["NOTICE", "OFF"] as const) {
      const site = await open(pageHtml(config({ pixels: [PX.GA4], consent: { mode } })));
      await expect.poll(async () => (await dataLayer(site.page)).length).toBe(3);
      expect((await dataLayer(site.page))[0]).toEqual([
        "consent",
        "default",
        { ad_storage: "granted", analytics_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" },
      ]);
      await site.context.close();
    }
  });
});

// ─── Pixels ──────────────────────────────────────────────────────────────────

describe("pixels de cada plataforma", () => {
  it("cada plataforma inicia com o código base padrão e registra a visualização de página", async () => {
    const cfg = config({
      consent: { mode: "OFF" },
      pixels: [PX.META, PX.META2, PX.TIKTOK, PX.KWAI, PX.GA4, PX.ADS, PX.UTMIFY],
    });
    const site = await open(pageHtml(cfg));
    const { page } = site;
    await expect.poll(async () => byPrefix(await calls(page), "load").length).toBe(6);
    const all = await calls(page);
    expect(byPrefix(all, "load")).toEqual(
      expect.arrayContaining([
        ["load", "META"],
        ["load", "TIKTOK", "C1ABCDEFGHIJ2KLMNOPQ", "ttq", "ttq"],
        ["load", "KWAI", "283746592837465", "kwaiq", "kwaiq"],
        ["load", "GTAG", "G-ABC123DEF4"],
        ["load", "UTMIFY", "66f1a2b3c4d5e6f7a8b9c0d1"],
        ["load", "UTMS", true, false],
      ]),
    );
    // Meta: um init por pixel e um PageView (vale para os dois) com eventID.
    const fbq = byPrefix(all, "fbq");
    expect(fbq.slice(0, 2)).toEqual([
      ["fbq", "init", "123456789012345"],
      ["fbq", "init", "999999999999999"],
    ]);
    expect(fbq[2].slice(0, 4)).toEqual(["fbq", "track", "PageView", {}]);
    const pageViewId = (fbq[2][4] as { eventID: string }).eventID;
    expect(pageViewId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(fbq).toHaveLength(3);
    expect(byPrefix(all, "ttq")).toEqual([["ttq", "page"]]);
    expect(byPrefix(all, "kwaiq")).toEqual([["kwaiq", "page"]]);
    expect((await dataLayer(page)).map((c) => `${c[0]}:${c[1]}`)).toEqual([
      "consent:default",
      "js:<data>",
      "config:G-ABC123DEF4",
      "config:AW-123456789",
    ]);
    expect(await page.evaluate(() => (window as { pixelId?: string }).pixelId)).toBe("66f1a2b3c4d5e6f7a8b9c0d1");
    expect(site.errors).toEqual([]);
    await site.context.close();
  });

  it("um evento sai com o MESMO eventID em todas as plataformas (e no eventos.php); Google Ads só com rótulo", async () => {
    const cfg = config({
      ...testMode,
      consent: { mode: "OFF" },
      pixels: [PX.META, PX.TIKTOK, PX.KWAI, PX.GA4, PX.ADS],
      value: { currency: "BRL", amount: 97 },
      server: { endpoint: "/eventos.php", vendors: ["META", "TIKTOK"] },
      rules: [
        { event: "VIEW_CONTENT", trigger: "PAGE_LOAD", value: null, selector: null },
        { event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK", value: null, selector: null },
      ],
    });
    const site = await open(
      pageHtml(
        cfg,
        `<button id="lead" data-os-event="LEAD">Quero</button><a id="buy" href="https://pay.hotmart.com/X1?off=a">Comprar</a>${STAY}`,
      ),
      { query: "?ttclid=TT1&fbclid=FB1" },
    );
    const { page } = site;
    await expect.poll(async () => byPrefix(await calls(page), "ttq").length).toBe(2); // page + ViewContent
    await page.click("#lead");
    await page.click("#buy");
    await expect.poll(async () => byPrefix(await calls(page), "fbq").filter((c) => c[1] === "track").length).toBe(4);
    const all = await calls(page);

    const fbTracks = byPrefix(all, "fbq").filter((c) => c[1] === "track");
    expect(fbTracks.map((c) => c[2])).toEqual(["PageView", "ViewContent", "Lead", "InitiateCheckout"]);
    const lead = fbTracks[2];
    const leadId = (lead[4] as { eventID: string }).eventID;
    expect(lead[3]).toEqual({});
    const ck = fbTracks[3];
    const ckId = (ck[4] as { eventID: string }).eventID;
    expect(ck[3]).toEqual({ value: 97, currency: "BRL" });
    expect(new Set(fbTracks.map((c) => (c[4] as { eventID: string }).eventID)).size).toBe(4);

    // TikTok e Kwai com os nomes deles; o mesmo id no TikTok.
    expect(byPrefix(all, "ttq")).toEqual([
      ["ttq", "page"],
      ["ttq", "track", "ViewContent", {}, { event_id: expect.any(String) }],
      ["ttq", "track", "Lead", {}, { event_id: leadId }],
      ["ttq", "track", "InitiateCheckout", { value: 97, currency: "BRL" }, { event_id: ckId }],
    ]);
    expect(byPrefix(all, `kwaiq:${PX.KWAI.id}`).map((c) => c.slice(1, 3))).toEqual([
      ["track", "contentView"],
      ["track", "formSubmit"],
      ["track", "initiatedCheckout"],
    ]);

    // GA4 recebe tudo (com event_id); Google Ads só as conversões com rótulo.
    const events = (await dataLayer(page)).filter((c) => c[0] === "event");
    expect(events).toEqual([
      ["event", "view_item", { send_to: "G-ABC123DEF4", event_id: expect.any(String) }],
      ["event", "generate_lead", { send_to: "G-ABC123DEF4", event_id: leadId }],
      ["event", "conversion", { send_to: "AW-123456789/rotuloLead" }],
      ["event", "begin_checkout", { send_to: "G-ABC123DEF4", event_id: ckId, value: 97, currency: "BRL" }],
      ["event", "conversion", { send_to: "AW-123456789/rotuloCk", value: 97, currency: "BRL" }],
    ]);

    // eventos.php: mesmos ids, nomes por plataforma, dados para deduplicar.
    await expect.poll(() => site.server.length).toBe(4);
    const leadServer = site.server.find((s) => s.event === "LEAD");
    expect(leadServer).toMatchObject({
      event_name: { META: "Lead", TIKTOK: "Lead" },
      event_id: leadId,
      event_source_url: "http://site.test/oferta?ttclid=TT1&fbclid=FB1",
      ttclid: "TT1",
    });
    expect(String(leadServer?.fbc)).toMatch(/^fb\.1\.\d{13}\.FB1$/);
    expect(Math.abs(Number(leadServer?.event_time) - Date.now() / 1000)).toBeLessThan(60);
    // O PageView do TikTok (ttq.page) não tem eventID para deduplicar: só a Meta recebe pelo servidor.
    expect(site.server.find((s) => s.event === "PAGE_VIEW")?.event_name).toEqual({ META: "PageView" });
    expect(site.server.find((s) => s.event === "INITIATE_CHECKOUT")).toMatchObject({
      event_id: ckId,
      value: 97,
      currency: "BRL",
    });

    // Tela de teste: cada plataforma informa o mesmo id; todo passo tem o formato que o servidor aceita.
    await expect.poll(() => site.reports.filter((r) => r.detail?.eventId === leadId).length).toBe(5);
    expect(
      site.reports
        .filter((r) => r.detail?.eventId === leadId)
        .map((r) => `${r.vendor}:${r.event}:${r.status}`)
        .sort(),
    ).toEqual([
      "GA4:generate_lead:FIRED",
      "GOOGLE_ADS:conversion:FIRED",
      "KWAI:formSubmit:FIRED",
      "META:Lead:FIRED",
      "TIKTOK:Lead:FIRED",
    ]);
    for (const r of site.reports) expect(parsePixelTestReport(r), JSON.stringify(r)).not.toBeNull();
    // detail.seq dá a ordem (os envios podem chegar fora de ordem).
    const seqs = site.reports.map((r) => Number(r.detail?.seq));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(site.reports.find((r) => r.detail?.seq === 1)).toMatchObject({
      vendor: "RUNTIME",
      event: "START",
      status: "LOADED",
    });
    await site.context.close();
  });

  it("nome personalizado na Meta vai como trackCustom; evento desligado (null) não sai", async () => {
    const names = structuredClone(NAMES) as Record<string, Record<string, string | null>>;
    names.META.LEAD = "CadastroVIP";
    names.TIKTOK.LEAD = null;
    const cfg = config({ consent: { mode: "OFF" }, pixels: [PX.META, PX.TIKTOK], names });
    const site = await open(pageHtml(cfg, `<button id="lead" data-os-event="lead">Quero</button>`));
    await expect.poll(async () => byPrefix(await calls(site.page), "ttq").length).toBe(1);
    await site.page.click("#lead");
    await expect.poll(async () => byPrefix(await calls(site.page), "fbq").length).toBe(3);
    const all = await calls(site.page);
    expect(byPrefix(all, "fbq")[2].slice(1, 3)).toEqual(["trackCustom", "CadastroVIP"]);
    expect(byPrefix(all, "ttq")).toEqual([["ttq", "page"]]);
    await site.context.close();
  });

  it("script bloqueado (bloqueador de anúncios): o teste mostra BLOQUEADO na plataforma e nos eventos dela; as outras seguem", async () => {
    const cfg = config({ ...testMode, consent: { mode: "OFF" }, pixels: [PX.META, PX.TIKTOK] });
    const site = await open(pageHtml(cfg, `<button id="lead" data-os-event="LEAD">Quero</button>`), {
      block: [META_URL],
    });
    await expect.poll(() => site.reports.filter((r) => r.event === "load").length).toBe(2);
    await site.page.click("#lead");
    await expect.poll(() => site.reports.filter((r) => r.event === "Lead").length).toBe(2);
    const meta = site.reports.filter((r) => r.vendor === "META");
    expect(meta.map((r) => `${r.event}:${r.status}`)).toEqual(["load:BLOCKED", "PageView:BLOCKED", "Lead:BLOCKED"]);
    expect(String(meta[0].detail?.hint)).toContain("bloqueador de anúncios");
    expect(meta[0].detail?.pixel).toBe(PX.META.id);
    const tiktok = site.reports.filter((r) => r.vendor === "TIKTOK");
    expect(tiktok.map((r) => `${r.event}:${r.status}`)).toEqual(["load:LOADED", "Pageview:FIRED", "Lead:FIRED"]);
    for (const r of site.reports) expect(parsePixelTestReport(r)).not.toBeNull();
    // Console em português no modo teste.
    expect(site.info.some((t) => t.includes("[Offer Studio]") && t.includes("META"))).toBe(true);
    expect(site.errors).toEqual([]);
    await site.context.close();
  });

  it("uma plataforma quebrada não derruba as outras nem a página", async () => {
    const cfg = config({ ...testMode, consent: { mode: "OFF" }, pixels: [PX.KWAI, PX.META, PX.TIKTOK] });
    const site = await open(pageHtml(cfg, `<button id="lead" data-os-event="LEAD">Quero</button>`), {
      init: `Object.defineProperty(window, "kwaiq", { get() { throw new Error("kwai quebrado") }, set() {}, configurable: true });`,
    });
    await expect.poll(async () => byPrefix(await calls(site.page), "load").length).toBe(2);
    await site.page.click("#lead");
    await expect.poll(async () => byPrefix(await calls(site.page), "ttq").length).toBe(2);
    expect(site.reports.find((r) => r.vendor === "KWAI")).toMatchObject({
      event: "load",
      status: "ERROR",
      detail: { message: expect.stringContaining("kwai quebrado") },
    });
    expect(site.errors).toEqual([]);
    await site.context.close();
  });
});

// ─── Regras de evento ────────────────────────────────────────────────────────

/** Controla a visibilidade da aba (o Playwright não troca de aba de verdade). */
const VISIBILITY = `window.__vis = "visible";
  Object.defineProperty(Document.prototype, "visibilityState", { get() { return window.__vis }, configurable: true });
  Object.defineProperty(Document.prototype, "hidden", { get() { return window.__vis === "hidden" }, configurable: true });`;

const fbEvents = async (page: Page) =>
  byPrefix(await calls(page), "fbq")
    .filter((c) => c[1] === "track" || c[1] === "trackCustom")
    .map((c) => c[2]);

describe("regras de evento", () => {
  it("tempo na página só conta com a aba visível e dispara uma vez", async () => {
    const cfg = config({
      consent: { mode: "OFF" },
      pixels: [PX.META],
      rules: [{ event: "VIEW_CONTENT", trigger: "TIME_ON_PAGE", value: 15, selector: null }],
    });
    const site = await open(pageHtml(cfg), { clock: true, init: VISIBILITY });
    const { page } = site;
    await expect.poll(() => fbEvents(page)).toEqual(["PageView"]);
    await page.clock.runFor(5_000);
    await page.evaluate(() => {
      (window as { __vis?: string }).__vis = "hidden";
    });
    await page.clock.runFor(30_000); // escondida: não conta
    expect(await fbEvents(page)).toEqual(["PageView"]);
    await page.evaluate(() => {
      (window as { __vis?: string }).__vis = "visible";
    });
    await page.clock.runFor(9_000); // 14 s visíveis
    expect(await fbEvents(page)).toEqual(["PageView"]);
    await page.clock.runFor(1_500); // 15 s
    await expect.poll(() => fbEvents(page)).toEqual(["PageView", "ViewContent"]);
    await page.clock.runFor(60_000);
    expect(await fbEvents(page)).toEqual(["PageView", "ViewContent"]);
    await site.context.close();
  });

  it("rolagem: dispara ao passar da porcentagem, uma vez só", async () => {
    const cfg = config({
      consent: { mode: "OFF" },
      pixels: [PX.META],
      rules: [{ event: "CONTACT", trigger: "SCROLL_DEPTH", value: 50, selector: null }],
    });
    const site = await open(pageHtml(cfg, `<div style="height:4000px">longa</div>`), {
      viewport: { width: 1000, height: 1000 },
    });
    const { page } = site;
    await expect.poll(() => fbEvents(page)).toEqual(["PageView"]);
    await page.evaluate(() => window.scrollTo(0, 700)); // (700+1000)/4016 ≈ 42%
    await settle(page);
    expect(await fbEvents(page)).toEqual(["PageView"]);
    await page.evaluate(() => window.scrollTo(0, 1200)); // ≈ 55%
    await expect.poll(() => fbEvents(page)).toEqual(["PageView", "Contact"]);
    await page.evaluate(() => window.scrollTo(0, 3000));
    await settle(page);
    expect(await fbEvents(page)).toEqual(["PageView", "Contact"]);
    await site.context.close();
  });

  it("clique em checkout: link da oferta, marcação do clonador e hosts conhecidos (inclusive subdomínio); intervalo de 1,5 s", async () => {
    const cfg = config({
      consent: { mode: "OFF" },
      pixels: [PX.META],
      rules: [{ event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK", value: null, selector: null }],
      // Checkout da oferta no próprio domínio: o host entra na lista, mas o site em si não vira checkout.
      checkoutHosts: ["pay.hotmart.com", ".kiwify.com.br", "site.test"],
    });
    const body = `
      <a id="offer" data-os-link="checkout" href="https://checkout.minhaloja.com/p/1"><span id="inner">Comprar</span></a>
      <button id="cloned" data-os-checkout="1">Comprar agora</button>
      <a id="hotmart" href="https://www.pay.hotmart.com/X?off=1">Hotmart</a>
      <button id="kiwify" data-os-href="https://secure.kiwify.com.br/abc">Kiwify</button>
      <a id="bare" href="https://kiwify.com.br/">Site da Kiwify</a>
      <a id="whats" data-os-link="whatsapp" href="https://wa.me/5511">WhatsApp</a>
      <a id="same" href="/obrigado">Obrigado</a>
      <a id="www" href="http://www.site.test/checkout">Mesmo site</a>
      ${STAY}`;
    const site = await open(pageHtml(cfg, body), { clock: true });
    const { page } = site;
    await expect.poll(() => fbEvents(page)).toEqual(["PageView"]);
    const count = async () => (await fbEvents(page)).filter((e) => e === "InitiateCheckout").length;

    await page.click("#inner");
    await page.click("#inner"); // clique duplo: não conta dobrado
    await expect.poll(count).toBe(1);
    let expected = 1;
    for (const id of ["#cloned", "#hotmart", "#kiwify"]) {
      await page.clock.runFor(1_600);
      await page.click(id);
      expected++;
      await expect.poll(count, { message: id }).toBe(expected);
    }
    for (const id of ["#bare", "#whats", "#same", "#www"]) {
      await page.clock.runFor(1_600);
      await page.click(id);
    }
    await settle(page);
    expect(await count()).toBe(expected);
    await site.context.close();
  });

  it("clique em elemento (seletor), data-os-event e seletor inválido que não quebra nada", async () => {
    const cfg = config({
      consent: { mode: "OFF" },
      pixels: [PX.META],
      rules: [
        { event: "ADD_TO_CART", trigger: "ELEMENT_CLICK", value: null, selector: "[[[inválido" },
        { event: "CONTACT", trigger: "ELEMENT_CLICK", value: null, selector: ".zap" },
      ],
    });
    const site = await open(
      pageHtml(
        cfg,
        `<div class="zap"><b id="zapInner">Fale conosco</b></div><button id="reg" data-os-event="COMPLETE_REGISTRATION">Cadastro</button><button id="bad" data-os-event="QUALQUER COISA">x</button><button id="pv" data-os-event="PAGE_VIEW">pv</button>`,
      ),
      { clock: true },
    );
    const { page } = site;
    await expect.poll(() => fbEvents(page)).toEqual(["PageView"]);
    await page.click("#zapInner");
    await page.click("#reg");
    await page.click("#bad");
    await page.click("#pv");
    await expect.poll(() => fbEvents(page)).toEqual(["PageView", "Contact", "CompleteRegistration"]);
    await page.clock.runFor(2_000);
    await page.click("#zapInner");
    await expect.poll(() => fbEvents(page)).toEqual(["PageView", "Contact", "CompleteRegistration", "Contact"]);
    expect(site.errors).toEqual([]);
    await site.context.close();
  });

  it("formulário: o 'os:lead' do formulário de captura (script das páginas de verdade) e o envio de outros formulários; uma vez por visualização", async () => {
    const cfg = config({
      consent: { mode: "OFF" },
      pixels: [PX.META],
      rules: [{ event: "LEAD", trigger: "FORM_SUBMIT", value: null, selector: null }],
    });
    const lead = `<form data-os-widget="lead-form" data-os-success="Recebido!">
        <input name="email" type="email" required><button type="submit">Enviar</button></form>`;
    const site = await open(pageHtml(cfg, lead, { bodyEnd: `<script data-os-runtime>${runtimeScript()}</script>` }));
    const { page } = site;
    await expect.poll(() => fbEvents(page)).toEqual(["PageView"]);
    await page.click("button[type=submit]"); // vazio: o widget não valida → sem Lead
    await settle(page);
    expect(await fbEvents(page)).toEqual(["PageView"]);
    await page.fill("input[name=email]", "maria@gmail.com");
    await page.click("button[type=submit]");
    await expect.poll(() => fbEvents(page)).toEqual(["PageView", "Lead"]);
    await page.fill("input[name=email]", "joao@gmail.com");
    await page.click("button[type=submit]");
    await settle(page);
    expect(await fbEvents(page)).toEqual(["PageView", "Lead"]);
    await site.context.close();

    const other = await open(
      pageHtml(
        cfg,
        `<form action="/obrigado" method="get"><input name="q" value="1"><button id="go">Ir</button></form>`,
      ),
      { pages: { "/obrigado": "<!doctype html><p>ok</p>" } },
    );
    await expect.poll(() => fbEvents(other.page)).toEqual(["PageView"]);
    const beforeNav = other.page.evaluate(
      () =>
        new Promise<unknown[]>((resolve) => {
          document.addEventListener("submit", () =>
            resolve(((window as { __calls?: unknown[][] }).__calls ?? []).map((c) => c[2])),
          );
        }),
    );
    await other.page.click("#go");
    expect(await beforeNav).toContain("Lead");
    await other.context.close();
  });

  it("formulário de captura que leva a outra página: o Lead sai antes de trocar de página", async () => {
    const cfg = config({
      consent: { mode: "OFF" },
      pixels: [PX.META],
      rules: [{ event: "LEAD", trigger: "FORM_SUBMIT", value: null, selector: null }],
    });
    const lead = `<form data-os-widget="lead-form" action="/obrigado">
        <input name="email" type="email" required><button type="submit">Enviar</button></form>`;
    const site = await open(pageHtml(cfg, lead, { bodyEnd: `<script data-os-runtime>${runtimeScript()}</script>` }), {
      pages: { "/obrigado": "<!doctype html><title>Obrigado</title><p>ok</p>" },
      // Guarda as chamadas dos pixels ao sair da página (a próxima página lê).
      init: `addEventListener("pagehide",function(){sessionStorage.setItem("calls",JSON.stringify(window.__calls||[]))})`,
    });
    const { page } = site;
    await expect.poll(() => fbEvents(page)).toEqual(["PageView"]);
    await page.fill("input[name=email]", "maria@gmail.com");
    await page.click("button[type=submit]");
    await page.waitForURL("http://site.test/obrigado");
    const before = JSON.parse((await page.evaluate(() => sessionStorage.getItem("calls"))) ?? "[]") as Call[];
    expect(byPrefix(before, "fbq").map((c) => c[2])).toContain("Lead");
    await site.context.close();
  });

  it("eventos antes do Aceitar esperam (PageView primeiro); ao abrir a página, a regra PAGE_LOAD dispara", async () => {
    const cfg = config({
      pixels: [PX.META],
      rules: [
        { event: "VIEW_CONTENT", trigger: "PAGE_LOAD", value: null, selector: null },
        { event: "LEAD", trigger: "ELEMENT_CLICK", value: null, selector: "#cta" },
      ],
    });
    const site = await open(pageHtml(cfg, `<button id="cta">Quero</button>`));
    const { page } = site;
    await page.click("#cta");
    await settle(page);
    expect(site.vendorRequests).toEqual([]);
    await page.getByRole("button", { name: "Aceitar" }).click();
    await expect.poll(() => fbEvents(page)).toEqual(["PageView", "ViewContent", "Lead"]);
    await site.context.close();
  });
});

// ─── Repasse de UTMs e IDs de clique ─────────────────────────────────────────

const LINKS = `
  <a id="ck" href="https://pay.hotmart.com/X1?off=abc&utm_source=manual#pagar">Checkout</a>
  <a id="offerLink" data-os-link="upsell" href="https://minhaloja.com/upsell">Upsell</a>
  <button id="osHref" data-os-link="checkout" data-os-href="https://pay.kiwify.com.br/abc">Comprar</button>
  <a id="internal" href="/obrigado">Obrigado</a>
  <a id="relative" href="obrigado?x=1">Obrigado 2</a>
  <a id="anchor" href="#depoimentos">Depoimentos</a>
  <a id="samePage" href="/oferta#preco">Preço</a>
  <a id="external" href="https://www.google.com/search?q=a">Google</a>
  <a id="mail" href="mailto:a@b.com">E-mail</a>
  <a id="tel" href="tel:+5511999999999">Telefone</a>
  <a id="js" href="javascript:void(0)">JS</a>
  <form id="form" action="https://pay.hotmart.com/F1"><button>ok</button></form>`;

const hrefs = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, string | null> = {};
    for (const el of Array.from(document.querySelectorAll("[id]"))) {
      out[el.id] = el.getAttribute("href") ?? el.getAttribute("data-os-href") ?? el.getAttribute("action");
    }
    return out;
  });

describe("repasse de UTMs e IDs de clique", () => {
  it("completa checkouts e links do funil ao carregar; não troca o que já existe, mantém o #, ignora o resto", async () => {
    const site = await open(pageHtml(config({ consent: { mode: "OFF" } }), LINKS), {
      query: "?utm_source=fb&utm_campaign=black%20friday&fbclid=FB.1-x&sck=afiliado&foo=nao",
    });
    const h = await hrefs(site.page);
    expect(h.ck).toBe(
      "https://pay.hotmart.com/X1?off=abc&utm_source=manual&utm_campaign=black%20friday&fbclid=FB.1-x&sck=afiliado#pagar",
    );
    expect(h.offerLink).toBe(
      "https://minhaloja.com/upsell?utm_source=fb&utm_campaign=black%20friday&fbclid=FB.1-x&sck=afiliado",
    );
    expect(h.osHref).toBe(
      "https://pay.kiwify.com.br/abc?utm_source=fb&utm_campaign=black%20friday&fbclid=FB.1-x&sck=afiliado",
    );
    expect(h.internal).toBe("/obrigado?utm_source=fb&utm_campaign=black%20friday&fbclid=FB.1-x&sck=afiliado");
    expect(h.relative).toBe("obrigado?x=1&utm_source=fb&utm_campaign=black%20friday&fbclid=FB.1-x&sck=afiliado");
    // Formulário GET: o navegador troca a query do action pelos campos — os parâmetros vão como campos (no envio).
    expect(h.form).toBe("https://pay.hotmart.com/F1");
    expect(h.anchor).toBe("#depoimentos");
    expect(h.samePage).toBe("/oferta#preco");
    expect(h.external).toBe("https://www.google.com/search?q=a");
    expect(h.mail).toBe("mailto:a@b.com");
    expect(h.tel).toBe("tel:+5511999999999");
    expect(h.js).toBe("javascript:void(0)");
    // Guardado para as próximas páginas (sem aviso de cookies, não há consentimento a esperar).
    expect(await stored(site.page, "os_params")).toMatchObject({
      v: 1,
      p: { utm_source: "fb", utm_campaign: "black friday", fbclid: "FB.1-x", sck: "afiliado" },
    });
    await site.context.close();
  });

  it("no clique, completa botões que apareceram depois — antes do script das páginas navegar para o checkout", async () => {
    const cfg = config({ consent: { mode: "OFF" } });
    const html = pageHtml(cfg, `<div id="box"></div>`, {
      bodyEnd: `<script data-os-runtime>${runtimeScript()}</script>`,
    });
    const site = await open(html, { query: "?utm_source=tiktok&ttclid=T9" });
    const { page } = site;
    await page.evaluate(() => {
      const b = document.createElement("button");
      b.id = "late";
      b.setAttribute("data-os-link", "checkout");
      b.setAttribute("data-os-href", "https://pay.hotmart.com/LATE?off=9");
      b.textContent = "Comprar";
      document.getElementById("box")?.appendChild(b);
    });
    await page.click("#late");
    await expect
      .poll(() => site.navigations)
      .toEqual(["https://pay.hotmart.com/LATE?off=9&utm_source=tiktok&ttclid=T9"]);
    await site.context.close();
  });

  it("guarda por N dias (último clique vale inteiro), respeita persistDays 0 e as opções de destino", async () => {
    const cfg = config({ consent: { mode: "OFF" } });
    const page2 = pageHtml(cfg, LINKS);
    const site = await open(pageHtml(cfg, LINKS), {
      query: "?utm_source=fb&utm_medium=cpc&gclid=G1",
      pages: { "/pagina2": page2, "/pagina3": page2 },
    });
    await site.goto("/pagina2");
    expect((await hrefs(site.page)).internal).toBe("/obrigado?utm_source=fb&utm_medium=cpc&gclid=G1");
    // Nova chegada com outra origem: vale só o que veio agora (nada de misturar campanhas).
    await site.goto("/pagina3?utm_source=google&utm_medium=");
    expect((await hrefs(site.page)).internal).toBe("/obrigado?utm_source=google");
    await site.goto("/pagina2");
    expect((await hrefs(site.page)).internal).toBe("/obrigado?utm_source=google");
    // Vencido (mais que persistDays): ignora.
    await site.page.evaluate(() => {
      const v = JSON.parse(localStorage.getItem("os_params") ?? "{}");
      v.at = Date.now() - 31 * 86_400_000;
      localStorage.setItem("os_params", JSON.stringify(v));
    });
    await site.goto("/pagina2");
    expect((await hrefs(site.page)).internal).toBe("/obrigado");
    await site.context.close();

    const noStore = await open(pageHtml(config({ consent: { mode: "OFF" }, forwarding: { persistDays: 0 } }), LINKS), {
      query: "?utm_source=fb",
    });
    expect((await hrefs(noStore.page)).internal).toBe("/obrigado?utm_source=fb");
    expect(await stored(noStore.page, "os_params")).toBeNull();
    await noStore.context.close();

    const onlyCheckout = await open(pageHtml(config({ forwarding: { toInternalLinks: false } }), LINKS), {
      query: "?utm_source=fb",
    });
    const oc = await hrefs(onlyCheckout.page);
    expect(oc.internal).toBe("/obrigado");
    expect(oc.ck).toContain("utm_source=manual");
    expect(oc.osHref).toBe("https://pay.kiwify.com.br/abc?utm_source=fb");
    await onlyCheckout.context.close();

    const onlyInternal = await open(pageHtml(config({ forwarding: { toCheckout: false } }), LINKS), {
      query: "?utm_source=fb",
    });
    const oi = await hrefs(onlyInternal.page);
    expect(oi.internal).toBe("/obrigado?utm_source=fb");
    expect(oi.osHref).toBe("https://pay.kiwify.com.br/abc");
    await onlyInternal.context.close();

    const off = await open(pageHtml(config({ forwarding: { enabled: false } }), LINKS), { query: "?utm_source=fb" });
    expect((await hrefs(off.page)).internal).toBe("/obrigado");
    expect(await stored(off.page, "os_params")).toBeNull();
    await off.context.close();
  });

  it("cookie _fbc (fbclid) só depois do consentimento", async () => {
    const site = await open(pageHtml(config({ pixels: [PX.META] })), { query: "?fbclid=ABC123" });
    const { page } = site;
    await settle(page);
    expect(await page.evaluate(() => document.cookie)).toBe("");
    await page.getByRole("button", { name: "Aceitar" }).click();
    await expect.poll(() => page.evaluate(() => document.cookie)).toMatch(/(?:^|; )_fbc=fb\.1\.\d{13}\.ABC123(?:;|$)/);
    // _fbp também sai já no consentimento (o eventos.php recebe desde o primeiro PageView).
    expect(await page.evaluate(() => document.cookie)).toMatch(/(?:^|; )_fbp=fb\.1\.\d{13}\.\d{10}(?:;|$)/);
    await site.context.close();
  });
});

// ─── Prévia ──────────────────────────────────────────────────────────────────

describe("modo prévia", () => {
  it("nunca carrega pixels (nem com Aceitar), avisa uma vez no console, mostra o banner e repassa UTMs", async () => {
    const cfg = config({
      mode: "preview",
      pixels: [PX.META, PX.TIKTOK, PX.GA4],
      rules: [{ event: "LEAD", trigger: "ELEMENT_CLICK", value: null, selector: "#cta" }],
    });
    const gated = `<script type="text/plain" data-os-consent="marketing" data-os-type="">window.__mkt = 1</script>`;
    const site = await open(
      pageHtml(cfg, `<button id="cta">Quero</button><a id="internal" href="/obrigado">ok</a>${gated}`),
      {
        query: "?utm_source=fb",
      },
    );
    const { page } = site;
    await expect.poll(() => banner(page).isVisible()).toBe(true);
    expect((await hrefs(page)).internal).toBe("/obrigado?utm_source=fb");
    await page.getByRole("button", { name: "Aceitar" }).click();
    await page.click("#cta");
    await settle(page, 400);
    expect(site.vendorRequests).toEqual([]);
    expect(
      await page.evaluate(() => [
        typeof (window as { fbq?: unknown }).fbq,
        (window as { dataLayer?: unknown }).dataLayer,
      ]),
    ).toEqual(["undefined", undefined]);
    expect(await page.evaluate(() => (window as { __mkt?: number }).__mkt)).toBeUndefined();
    const previewInfo = site.info.filter((t) => t.includes("Pixels desligados na prévia"));
    expect(previewInfo).toHaveLength(1);
    expect(previewInfo[0]).toContain("123456789012345");
    // Escolha só na sessão da prévia (não "suja" o navegador do usuário).
    expect(await stored(page, "os_consent")).toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem("os_consent"))).toContain("accepted");
    await site.context.close();
  });
});

// ─── Código livre com consentimento ──────────────────────────────────────────

describe("código livre que espera o consentimento", () => {
  const gatedBody = `
    <script type="text/plain" data-os-consent="marketing" data-os-type="">(window.__order = window.__order || []).push("a")</script>
    <script type="text/plain" data-os-consent="marketing" data-os-type="" async src="/ext.js"></script>
    <script type="text/plain" data-os-consent="analytics" data-os-type="text/javascript">window.__order.push("c")</script>
    <script type="application/ld+json">{"@type":"Product"}</script>
    <img id="px" data-os-consent="marketing" data-os-src="/px.gif" alt="">
    <img id="px2" data-os-consent="marketing" data-os-srcset="/px.gif 1x" alt="">
    <iframe id="frame" data-os-consent="marketing" data-os-src="/frame.html"></iframe>`;
  const files: OpenOptions["files"] = {
    "/ext.js": ["application/javascript", `window.__order.push("b")`, 300],
    "/px.gif": ["image/gif", "GIF89a", 0],
    "/frame.html": ["text/html", "<p>frame</p>", 0],
  };

  it("OPT_IN: nada roda antes do Aceitar; depois, os scripts rodam na ordem da página (externo antes do seguinte)", async () => {
    const site = await open(pageHtml(config(), gatedBody), { files });
    const { page } = site;
    // Só o código de marketing já pede o banner, mesmo sem pixels.
    await expect.poll(() => banner(page).isVisible()).toBe(true);
    await settle(page, 400);
    expect(await page.evaluate(() => (window as { __order?: string[] }).__order)).toBeUndefined();
    expect(await page.getAttribute("#px", "src")).toBeNull();
    await page.getByRole("button", { name: "Aceitar" }).click();
    await expect.poll(() => page.evaluate(() => (window as { __order?: string[] }).__order)).toEqual(["a", "b", "c"]);
    expect(await page.getAttribute("#px", "src")).toBe("/px.gif");
    expect(await page.getAttribute("#px2", "srcset")).toBe("/px.gif 1x");
    expect(await page.getAttribute("#frame", "src")).toBe("/frame.html");
    expect(await page.locator("[data-os-consent]").count()).toBe(0);
    expect(await page.locator('script[type="application/ld+json"]').count()).toBe(1);
    await site.context.close();
  });

  it("NOTICE e OFF: o código roda direto; recusado: nunca roda", async () => {
    for (const mode of ["NOTICE", "OFF"] as const) {
      const site = await open(pageHtml(config({ consent: { mode } }), gatedBody), { files });
      await expect
        .poll(() => site.page.evaluate(() => (window as { __order?: string[] }).__order))
        .toEqual(["a", "b", "c"]);
      await site.context.close();
    }
    const rejected = await open(pageHtml(config(), gatedBody), { files });
    await rejected.page.getByRole("button", { name: "Recusar" }).click();
    await settle(rejected.page, 500);
    expect(await rejected.page.evaluate(() => (window as { __order?: string[] }).__order)).toBeUndefined();
    await rejected.context.close();
  });
});

// ─── Robustez ────────────────────────────────────────────────────────────────

describe("robustez", () => {
  it("roda uma vez só mesmo com o script duas vezes na página", async () => {
    const cfg = config({ pixels: [PX.META] });
    // Segunda cópia depois da injeção (injectTracking tiraria uma cópia antiga).
    const html = pageHtml(cfg).replace("</body>", () => `${TAG}</body>`);
    expect(html.split("data-os-tracking>").length).toBe(3);
    const site = await open(html);
    await expect.poll(() => banner(site.page).isVisible()).toBe(true);
    expect(await site.page.locator("os-consent").count()).toBe(1);
    await site.page.getByRole("button", { name: "Aceitar" }).click();
    await expect.poll(async () => byPrefix(await calls(site.page), "fbq").length).toBe(2);
    await settle(site.page);
    expect(byPrefix(await calls(site.page), "fbq").map((c) => c[1])).toEqual(["init", "track"]);
    await site.context.close();
  });

  it("sem configuração, JSON inválido ou formato errado: não quebra nem mostra nada", async () => {
    const variants = [
      pageHtml(null, "", { head: TAG }),
      pageHtml(null, "", { head: `<script type="application/json" id="os-tracking">{nao é json</script>${TAG}` }),
      pageHtml(null, "", { head: `<script type="application/json" id="os-tracking">[1,2]</script>${TAG}` }),
      pageHtml(null, "", {
        head: `<script type="application/json" id="os-tracking">{"consent":"x","pixels":"y","rules":[1,null,{"trigger":"ELEMENT_CLICK","selector":5}],"forwarding":null,"names":7,"server":{"endpoint":""},"checkoutHosts":[3]}</script>${TAG}`,
      }),
    ];
    for (const html of variants) {
      const site = await open(`${html}`, { query: "?utm_source=x" });
      await site.page.mouse.click(10, 10);
      await settle(site.page, 300);
      expect(site.errors).toEqual([]);
      expect(site.vendorRequests).toEqual([]);
      await site.context.close();
    }
  });

  it("o script também funciona no fim do <body> (depois do HTML)", async () => {
    const cfg = config({ consent: { mode: "OFF" }, pixels: [PX.META] });
    const base = `<!doctype html><html><head><meta charset="utf-8"></head><body><a id="internal" href="/obrigado">ok</a>
      <script type="application/json" id="os-tracking">${JSON.stringify(cfg)}</script>${TAG}</body></html>`;
    const site = await open(base, { query: "?utm_source=fb" });
    await expect.poll(() => fbEvents(site.page)).toEqual(["PageView"]);
    expect((await hrefs(site.page)).internal).toBe("/obrigado?utm_source=fb");
    await site.context.close();
  });

  it("não deixa variáveis globais além das que as plataformas exigem", async () => {
    const cfg = config({
      consent: { mode: "OFF" },
      pixels: [PX.META, PX.TIKTOK, PX.KWAI, PX.GA4, PX.ADS, PX.UTMIFY],
      rules: [{ event: "LEAD", trigger: "FORM_SUBMIT", value: null, selector: null }],
    });
    const site = await open(pageHtml(cfg), {
      init: `window.__before = Object.getOwnPropertyNames(window);`,
    });
    await expect.poll(async () => byPrefix(await calls(site.page), "load").length).toBe(6);
    const added = await site.page.evaluate(() => {
      const before = new Set((window as { __before?: string[] }).__before);
      return Object.getOwnPropertyNames(window).filter((k) => !before.has(k));
    });
    const allowed = [
      "__osTracking",
      "osConsent",
      "fbq",
      "_fbq",
      "ttq",
      "TiktokAnalyticsObject",
      "kwaiq",
      "KwaiAnalyticsObject",
      "dataLayer",
      "gtag",
      "pixelId",
      // só do teste:
      "__before",
      "__calls",
    ];
    expect(added.filter((k) => !allowed.includes(k))).toEqual([]);
    await site.context.close();
  });

  // Consentimento com botão "Cookies" (que sobe acima das barras fixas), ativação do
  // código em espera, regras de formulário/navegação, IDs de clique no funil e dados
  // do formulário para o checkout: ~10,5 KB com gzip. 25 KB desde o refix 3 (clique
  // tratado pela página, espera compartilhada com o os-runtime e o botão de enviar
  // no Safari antigo); 26 KB desde a Fase 6 (versão A/B em cada evento e a marca
  // no checkout); o limite com gzip, o que de fato trafega, não mudou.
  it(`cabe no orçamento: ${SCRIPT.length} bytes minificado (< 26 KB; ${gzipSync(SCRIPT).length} com gzip)`, () => {
    expect(SCRIPT.length).toBeLessThan(26 * 1024);
    expect(gzipSync(SCRIPT).length).toBeLessThan(11 * 1024);
  });
});

// ─── Correções da revisão da Fase 4 ──────────────────────────────────────────

const TRACKER = "https://tracker.example/";
const fromTracker = (site: Site) => site.requests.filter((u) => u.startsWith(TRACKER));
const accept = (page: Page) => page.getByRole("button", { name: "Aceitar" }).click();

describe("código em espera: bloco inerte até o Aceitar", () => {
  it("comentários e atributos com <script>, <style> ou <title> não soltam nada antes do Aceitar; depois roda igual", async () => {
    const code = [
      "<!-- cole o <script> abaixo -->",
      `<script src="${TRACKER}t.js"></script>`,
      "<!-- estilos antigos: <style> e <title> e <textarea> -->",
      `<div title="<script>" id="attr">ok</div>`,
      `<img id="px" src="${TRACKER}px.gif" alt="">`,
      "<script>window.__inline = (window.__inline || 0) + 1</script>",
    ].join("\n");
    const site = await open(pageHtml(config(), gateCode(code, "MARKETING")));
    const { page } = site;
    await expect.poll(() => banner(page).isVisible()).toBe(true);
    await settle(page, 300);
    expect(fromTracker(site)).toEqual([]);
    expect(await page.evaluate(() => (window as { __inline?: number }).__inline)).toBeUndefined();
    expect(await page.locator("#attr").count()).toBe(0);

    await accept(page);
    await expect.poll(() => page.evaluate(() => (window as { __inline?: number }).__inline)).toBe(1);
    expect(fromTracker(site)).toEqual([`${TRACKER}t.js`, `${TRACKER}px.gif`]);
    expect(await page.getAttribute("#attr", "title")).toBe("<script>");
    expect(await page.locator("template, [data-os-consent]").count()).toBe(0);
    expect(site.errors).toEqual([]);
    await site.context.close();
  });

  it("preload, stylesheet, srcdoc, <picture>, SVG, poster, <object> e CSS inline: nenhum pedido antes do Aceitar", async () => {
    const code = [
      `<link rel="preload" href="${TRACKER}fbevents.js" as="script">`,
      `<link rel="stylesheet" href="${TRACKER}chat.css">`,
      `<iframe srcdoc="<img src='${TRACKER}srcdoc.gif'>"></iframe>`,
      `<picture><source srcset="${TRACKER}pic.webp" type="image/webp"><img src="${TRACKER}pic.jpg" alt=""></picture>`,
      `<svg width="10" height="10"><image href="${TRACKER}svg.png" width="10" height="10"/></svg>`,
      `<svg onload="window.__svg=1"></svg>`,
      `<video poster="${TRACKER}poster.jpg"></video>`,
      `<object data="${TRACKER}obj.bin" width="10" height="10"></object>`,
      `<div style="width:10px;height:10px;background:url(${TRACKER}bg.png)"></div>`,
      `<noscript><img src="${TRACKER}noscript.gif"></noscript>`,
    ].join("");
    const site = await open(pageHtml(config(), gateCode(code, "MARKETING")));
    const { page } = site;
    await expect.poll(() => banner(page).isVisible()).toBe(true);
    await settle(page, 400);
    expect(fromTracker(site)).toEqual([]);
    expect(await page.evaluate(() => (window as { __svg?: number }).__svg)).toBeUndefined();

    await accept(page);
    for (const file of ["fbevents.js", "chat.css", "srcdoc.gif", "svg.png", "poster.jpg", "bg.png"]) {
      await expect.poll(() => fromTracker(site).some((u) => u.endsWith(file)), { message: file }).toBe(true);
    }
    // <noscript> só vale sem JavaScript: nem depois do Aceitar ele carrega.
    await settle(page, 200);
    expect(fromTracker(site).some((u) => u.endsWith("noscript.gif"))).toBe(false);
    await site.context.close();
  });

  it("código com um </template> solto vai em JSON e também espera o Aceitar", async () => {
    const code = `<p id="solto">a</p></template><img src="${TRACKER}escape.gif"><script>window.__json=1</script>`;
    const gated = gateCode(code, "ANALYTICS");
    expect(gated).toMatch(/^<script type="application\/json" data-os-consent="analytics" data-os-block>/);
    const site = await open(pageHtml(config(), gated));
    const { page } = site;
    await expect.poll(() => banner(page).isVisible()).toBe(true);
    await settle(page, 300);
    expect(fromTracker(site)).toEqual([]);
    await accept(page);
    await expect.poll(() => page.evaluate(() => (window as { __json?: number }).__json)).toBe(1);
    expect(fromTracker(site)).toEqual([`${TRACKER}escape.gif`]);
    expect(await page.locator("#solto").count()).toBe(1);
    await site.context.close();
  });

  const READY_CODE = `<script>window.__inline = 1;
    document.addEventListener("DOMContentLoaded", function () { window.__dcl = 1 });
    addEventListener("load", function () { window.__load = 1 });</script>`;
  const readyState = (page: Page) =>
    page.evaluate(() => {
      const w = window as { __inline?: number; __dcl?: number; __load?: number };
      return [w.__inline ?? null, w.__dcl ?? null, w.__load ?? null];
    });

  it("código ativado recebe DOMContentLoaded e load: aceite lembrado, Aceitar depois do load e modo NOTICE", async () => {
    const head = gateCode(READY_CODE, "MARKETING");
    const remembered = await open(pageHtml(config(), "", { head }), {
      init: `localStorage.setItem("os_consent", JSON.stringify({ v: 1, choice: "accepted", at: Date.now() }))`,
    });
    await expect.poll(() => readyState(remembered.page)).toEqual([1, 1, 1]);
    // O addEventListener volta ao normal depois (nada fica na janela).
    expect(await remembered.page.evaluate(() => Object.hasOwn(window, "addEventListener"))).toBe(false);
    await remembered.context.close();

    const late = await open(pageHtml(config(), "", { head }));
    await settle(late.page, 300); // "load" já passou
    expect(await readyState(late.page)).toEqual([null, null, null]);
    await accept(late.page);
    await expect.poll(() => readyState(late.page)).toEqual([1, 1, 1]);
    await late.context.close();

    const notice = await open(pageHtml(config({ consent: { mode: "NOTICE" } }), "", { head }));
    await expect.poll(() => readyState(notice.page)).toEqual([1, 1, 1]);
    await notice.context.close();
  });
});

describe("repasse de UTMs e consentimento", () => {
  const osHref = (page: Page) => page.getAttribute("#osHref", "data-os-href");

  it("Pedir permissão: antes do Aceitar nada é guardado e os IDs de clique não vão para o checkout; Aceitar guarda e completa", async () => {
    const site = await open(pageHtml(config({ pixels: [PX.META] }), LINKS), {
      query: "?fbclid=AAA&gclid=GGG&utm_source=fb",
    });
    const { page } = site;
    expect(await osHref(page)).toBe("https://pay.kiwify.com.br/abc?utm_source=fb");
    expect(await stored(page, "os_params")).toBeNull();
    await accept(page);
    await expect.poll(() => osHref(page)).toBe("https://pay.kiwify.com.br/abc?utm_source=fb&fbclid=AAA&gclid=GGG");
    expect(await stored(page, "os_params")).toMatchObject({ p: { utm_source: "fb", fbclid: "AAA", gclid: "GGG" } });
    await site.context.close();
  });

  it("Recusar: apaga o que estava guardado e os IDs de clique ficam fora do checkout (as UTMs seguem)", async () => {
    const page2 = pageHtml(config({ pixels: [PX.META] }), LINKS, {
      bodyEnd: `<script data-os-runtime>${runtimeScript()}</script>`,
    });
    const site = await open(page2, {
      query: "?fbclid=AAA&gclid=GGG&utm_source=fb",
      pages: { "/pagina2": page2 },
      init: `if (!sessionStorage.getItem("x")) { sessionStorage.setItem("x", "1"); localStorage.setItem("os_params", JSON.stringify({ v: 1, at: Date.now(), p: { utm_source: "antigo", fbclid: "OLD" } })) }`,
    });
    const { page } = site;
    await page.getByRole("button", { name: "Recusar" }).click();
    expect(await stored(page, "os_params")).toBeNull();
    await page.click("#osHref");
    await expect.poll(() => site.navigations).toEqual(["https://pay.kiwify.com.br/abc?utm_source=fb"]);
    // Próxima página sem parâmetros: nada guardado para repassar.
    await site.goto("/pagina2");
    expect((await hrefs(page)).internal).toBe("/obrigado");
    await site.context.close();
  });

  it("valores enormes, com ';' ou caracteres de controle não são guardados nem repassados", async () => {
    const big = "x".repeat(600);
    const site = await open(pageHtml(config({ consent: { mode: "OFF" } }), LINKS), {
      query: `?utm_source=${big}&utm_campaign=a%3Bb&utm_content=ok%0A1&fbclid=A%20B&utm_medium=cpc`,
    });
    expect(await osHref(site.page)).toBe("https://pay.kiwify.com.br/abc?utm_medium=cpc");
    expect((await stored(site.page, "os_params"))?.p).toEqual({ utm_medium: "cpc" });
    await site.context.close();
  });

  it("formulário GET de checkout: as UTMs chegam de verdade (campos escondidos), sem trocar os que o formulário tem", async () => {
    const form = `<form id="f" data-os-checkout action="https://pay.hotmart.com/X123"><input type="hidden" name="off" value="abc"><input type="hidden" name="utm_source" value="form"><input name="email" id="e"><button id="buy">Comprar</button></form>`;
    const site = await open(pageHtml(config({ consent: { mode: "OFF" } }), form), {
      query: "?utm_source=fb&utm_campaign=bf&fbclid=F1",
    });
    await site.page.click("#buy");
    await expect
      .poll(() => site.navigations)
      .toEqual(["https://pay.hotmart.com/X123?off=abc&utm_source=form&email=&utm_campaign=bf&fbclid=F1"]);
    await site.context.close();
  });

  it("_fbc: fbclid com ';' não injeta atributos (domínio) no cookie nem é guardado", async () => {
    const site = await open(pageHtml(config({ pixels: [PX.META], consent: { mode: "NOTICE" } })), {
      query: "?fbclid=X%3B%20domain%3Dsite.test%3B%20path%3D%2Fcheckout&utm_source=fb",
    });
    await expect.poll(() => site.vendorRequests.length).toBe(1);
    const cookies = await site.context.cookies("http://site.test/");
    expect(cookies.find((c) => c.name === "_fbc")).toBeUndefined();
    expect(cookies.find((c) => c.name === "_fbp")?.domain).toBe("site.test");
    expect((await stored(site.page, "os_params"))?.p).toEqual({ utm_source: "fb" });
    await site.context.close();
  });
});

describe("eventos: formulários, botão de enviar e navegação", () => {
  const RUNTIME = `<script data-os-runtime>${runtimeScript()}</script>`;
  const icCount = async (page: Page) => (await fbEvents(page)).filter((e) => e === "InitiateCheckout").length;

  it("formulário de captura ligado ao checkout: clicar nos campos não é InitiateCheckout; só o envio válido, uma vez", async () => {
    const cfg = config({
      consent: { mode: "OFF" },
      pixels: [PX.META],
      rules: [{ event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK", value: null, selector: null }],
    });
    const lead = `<form data-os-widget="lead-form" data-os-link="checkout" action="https://pay.hotmart.com/X9">
      <input name="name" id="nome" required><input name="email" type="email" id="email" required>
      <button type="submit" id="send">Enviar</button></form>`;
    const site = await open(pageHtml(cfg, lead, { bodyEnd: RUNTIME }), { clock: true });
    const { page } = site;
    await expect.poll(() => fbEvents(page)).toEqual(["PageView"]);
    await page.click("#nome");
    await page.clock.runFor(1_600);
    await page.click("#email");
    await page.clock.runFor(1_600);
    await page.click("#send"); // vazio: não valida
    await settle(page);
    expect(await icCount(page)).toBe(0);
    await page.fill("#nome", "Maria");
    await page.fill("#email", "maria@gmail.com");
    await page.click("#send");
    await expect.poll(() => icCount(page)).toBe(1);
    await site.context.close();
  });

  it("formulário marcado pelo clonador: InitiateCheckout só no envio (não no clique no campo)", async () => {
    const cfg = config({
      consent: { mode: "OFF" },
      pixels: [PX.META],
      rules: [
        { event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK", value: null, selector: null },
        { event: "ADD_TO_CART", trigger: "ELEMENT_CLICK", value: null, selector: "#f" },
      ],
    });
    const form = `<form id="f" data-os-checkout action="https://pay.hotmart.com/X123"><input name="email" id="e2"><button id="buy">Comprar</button></form>`;
    const site = await open(pageHtml(cfg, form), { clock: true });
    const { page } = site;
    await expect.poll(() => fbEvents(page)).toEqual(["PageView"]);
    await page.click("#e2");
    await page.clock.runFor(1_600);
    expect(await fbEvents(page)).toEqual(["PageView"]);
    const sent = page.evaluate(
      () =>
        new Promise<unknown[]>((resolve) => {
          document.addEventListener("submit", () =>
            resolve(((window as { __calls?: unknown[][] }).__calls ?? []).map((c) => c[2])),
          );
        }),
    );
    await page.click("#buy");
    const names = await sent;
    expect(names.filter((n) => n === "InitiateCheckout")).toHaveLength(1);
    expect(names.filter((n) => n === "AddToCart")).toHaveLength(1);
    await site.context.close();
  });

  it("“Evento ao clicar: Lead” no botão do formulário + regra de envio: tentativa inválida não conta e o lead conta uma vez", async () => {
    const cfg = config({
      consent: { mode: "OFF" },
      pixels: [PX.META],
      rules: [{ event: "LEAD", trigger: "FORM_SUBMIT", value: null, selector: null }],
    });
    const lead = `<form data-os-widget="lead-form"><input name="email" type="email" id="email" required>
      <button type="submit" id="send" data-os-event="LEAD">Enviar</button></form>`;
    const site = await open(pageHtml(cfg, lead, { bodyEnd: RUNTIME }));
    const { page } = site;
    await expect.poll(() => fbEvents(page)).toEqual(["PageView"]);
    await page.click("#send");
    await settle(page, 300);
    expect(await fbEvents(page)).toEqual(["PageView"]);
    await page.fill("#email", "maria@gmail.com");
    await page.click("#send");
    await expect.poll(() => fbEvents(page)).toEqual(["PageView", "Lead"]);
    await settle(page, 500);
    expect(await fbEvents(page)).toEqual(["PageView", "Lead"]);
    await site.context.close();
  });

  it("checkout logo depois do Aceitar, com o pixel ainda carregando: a navegação espera e o evento chega à Meta", async () => {
    const beacon = `(function(){var q=fbq.queue.slice();fbq.queue.length=0;
      fbq.callMethod=function(){var a=[].slice.call(arguments);if(a[0]==="track")navigator.sendBeacon("https://www.facebook.com/tr?ev="+a[1]);};
      q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`;
    const cfg = config({
      pixels: [PX.META],
      rules: [{ event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK", value: null, selector: null }],
    });
    const site = await open(
      pageHtml(cfg, `<a id="ck" data-os-link="checkout" href="https://pay.hotmart.com/X1">Comprar</a>`),
      {
        stubs: { [META_URL]: beacon },
        delay: { [META_URL]: 700 },
        external: { "https://pay.hotmart.com/": "<!doctype html><h1>checkout</h1>" },
      },
    );
    const { page } = site;
    await accept(page);
    await page.waitForTimeout(150);
    await page.click("#ck");
    await page.waitForURL(/pay\.hotmart\.com/);
    await settle(page, 500);
    const tr = site.requests
      .filter((u) => u.startsWith("https://www.facebook.com/tr"))
      .map((u) => new URL(u).searchParams.get("ev"));
    expect(tr).toEqual(["PageView", "InitiateCheckout"]);
    await site.context.close();
  });

  it("pixel já carregado: o clique no checkout navega na hora (nada de espera)", async () => {
    const cfg = config({
      consent: { mode: "OFF" },
      pixels: [PX.META],
      rules: [{ event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK", value: null, selector: null }],
    });
    const site = await open(
      pageHtml(cfg, `<a id="ck" data-os-link="checkout" href="https://pay.hotmart.com/X1">Comprar</a>`),
    );
    await expect.poll(() => fbEvents(site.page)).toEqual(["PageView"]);
    const prevented = await site.page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const a = document.getElementById("ck") as HTMLAnchorElement;
          a.addEventListener("click", (e) => {
            resolve(e.defaultPrevented);
            e.preventDefault();
          });
          a.click();
        }),
    );
    expect(prevented).toBe(false);
    await site.context.close();
  });

  it("links de checkout com caminho (Monetizze, Lastlink, Cartpanda): InitiateCheckout e UTMs; o resto do site não", async () => {
    const cfg = config({
      consent: { mode: "OFF" },
      pixels: [PX.META],
      checkoutHosts: knownCheckoutHosts(),
      rules: [{ event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK", value: null, selector: null }],
    });
    const body = `
      <a id="mon" href="https://app.monetizze.com.br/checkout/DAB123">Monetizze</a>
      <a id="last" href="https://lastlink.com/p/C1234/checkout">Lastlink</a>
      <a id="cart" href="https://loja.mycartpanda.com/checkout/123">Cartpanda</a>
      <a id="login" href="https://app.monetizze.com.br/login">Entrar</a>
      ${STAY}`;
    const site = await open(pageHtml(cfg, body), { clock: true, query: "?utm_source=fb" });
    const { page } = site;
    await expect.poll(() => fbEvents(page)).toEqual(["PageView"]);
    for (const id of ["#mon", "#last", "#cart", "#login"]) {
      await page.clock.runFor(1_600);
      await page.click(id);
    }
    await expect.poll(() => icCount(page)).toBe(3);
    const h = await hrefs(page);
    expect(h.mon).toBe("https://app.monetizze.com.br/checkout/DAB123?utm_source=fb");
    expect(h.last).toBe("https://lastlink.com/p/C1234/checkout?utm_source=fb");
    expect(h.cart).toBe("https://loja.mycartpanda.com/checkout/123?utm_source=fb");
    expect(h.login).toBe("https://app.monetizze.com.br/login");
    await site.context.close();
  });
});

describe("rolagem em páginas que ainda vão crescer", () => {
  const scrollRule = (value: number) => ({
    consent: { mode: "OFF" as const },
    pixels: [PX.META],
    rules: [{ event: "VIEW_CONTENT" as const, trigger: "SCROLL_DEPTH" as const, value, selector: null }],
  });

  it("VSL com a oferta escondida (data-os-delay): não dispara sem rolar; aparecendo e rolando, dispara", async () => {
    const body = `<h1>VSL</h1><div style="height:405px">vídeo</div><section id="oferta" data-os-delay="600" style="height:4000px">oferta</section><script data-os-runtime>${runtimeScript()}</script>`;
    const site = await open(pageHtml(config(scrollRule(75)), body, { head: DELAY_STYLE }), {
      viewport: { width: 1000, height: 800 },
    });
    const { page } = site;
    await expect.poll(() => fbEvents(page)).toEqual(["PageView"]);
    await settle(page, 400);
    expect(await fbEvents(page)).toEqual(["PageView"]);
    // O botão aparece (os-runtime avisa) e a pessoa rola até o fim.
    await page.evaluate(() => {
      document.getElementById("oferta")?.classList.add("os-revealed");
      document.dispatchEvent(new CustomEvent("os:revealed"));
    });
    await settle(page);
    expect(await fbEvents(page)).toEqual(["PageView"]);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => fbEvents(page)).toEqual(["PageView", "ViewContent"]);
    await site.context.close();
  });

  it("imagens 'lazy' sem altura: não dispara no carregamento; página curta de verdade dispara", async () => {
    const slices = Array.from({ length: 20 }, (_, i) => `<img loading="lazy" src="/slice.svg?i=${i}" alt="">`).join("");
    const files: OpenOptions["files"] = {
      "/slice.svg": ["image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="800"></svg>', 300],
    };
    const site = await open(pageHtml(config(scrollRule(50)), `<div>${slices}</div>`), {
      files,
      viewport: { width: 1000, height: 800 },
    });
    const { page } = site;
    await expect.poll(() => fbEvents(page)).toEqual(["PageView"]);
    await page.waitForTimeout(1_000);
    expect(await fbEvents(page)).toEqual(["PageView"]);

    const short = await open(pageHtml(config(scrollRule(50)), "<p>Página curta</p>"));
    await expect.poll(() => fbEvents(short.page)).toEqual(["PageView", "ViewContent"]);
    await short.context.close();
    await site.context.close();
  });
});

describe("consentimento: Consent Mode, pixels, UTMify e botão Cookies", () => {
  it("Consent Mode v2 vale em todo 'Pedir permissão', mesmo sem pixel do Google (gtag colado na página)", async () => {
    const gtagCode = `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config","G-XYZ9876543")</script>`;
    const site = await open(pageHtml(config({ pixels: [PX.META] }), "", { head: gtagCode }));
    const { page } = site;
    await settle(page, 200);
    const list = await dataLayer(page);
    expect(list[0]).toEqual([
      "consent",
      "default",
      {
        ad_storage: "denied",
        analytics_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        wait_for_update: 500,
      },
    ]);
    expect(list.map((c) => `${c[0]}:${c[1]}`)).toEqual(["consent:default", "js:<data>", "config:G-XYZ9876543"]);
    await accept(page);
    await expect
      .poll(async () => (await dataLayer(page)).at(-1))
      .toEqual([
        "consent",
        "update",
        { ad_storage: "granted", analytics_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" },
      ]);
    await site.context.close();
  });

  it("código-base da Meta colado na página com o fbevents.js bloqueado: o teste mostra BLOQUEADO (não 'carregou')", async () => {
    const base = `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','123456789012345');fbq('track','PageView');</script>`;
    const site = await open(pageHtml(config({ ...testMode, pixels: [PX.META] }), "", { head: base }), {
      block: [META_URL],
    });
    await accept(site.page);
    await expect
      .poll(() => site.reports.find((r) => r.vendor === "META" && r.event === "load")?.status, { timeout: 9_000 })
      .toBe("BLOCKED");
    // Os passos chegam cada um no seu pedido: sob carga, o do evento pode chegar depois.
    await expect
      .poll(() => site.reports.find((r) => r.vendor === "META" && r.event === "PageView")?.status)
      .toBe("BLOCKED");
    await site.context.close();
  });

  it("UTMify: o script de UTMs bloqueado aparece no teste; um segundo pixel aparece como erro (só o primeiro carrega)", async () => {
    const second = { ...PX.UTMIFY, id: "77f1a2b3c4d5e6f7a8b9c0d1" };
    const site = await open(pageHtml(config({ ...testMode, consent: { mode: "OFF" }, pixels: [PX.UTMIFY, second] })), {
      block: ["https://cdn.utmify.com.br/scripts/utms/"],
    });
    await expect.poll(() => site.reports.filter((r) => r.vendor === "UTMIFY").length).toBe(3);
    const rows = site.reports.filter((r) => r.vendor === "UTMIFY");
    expect(rows.find((r) => r.status === "LOADED")?.detail).toMatchObject({ pixel: PX.UTMIFY.id });
    expect(rows.find((r) => r.status === "BLOCKED")?.detail).toMatchObject({ pixel: PX.UTMIFY.id, script: "utms" });
    expect(rows.find((r) => r.status === "ERROR")?.detail).toMatchObject({ pixel: second.id, extra: true });
    for (const r of site.reports) expect(parsePixelTestReport(r), JSON.stringify(r)).not.toBeNull();
    expect(await site.page.evaluate(() => (window as { pixelId?: string }).pixelId)).toBe(PX.UTMIFY.id);
    await site.context.close();
  });

  it("eventos.php: o primeiro PageView já leva fbp (e fbc)", async () => {
    const site = await open(
      pageHtml(
        config({
          consent: { mode: "NOTICE" },
          pixels: [PX.META],
          server: { endpoint: "/eventos.php", vendors: ["META"] },
        }),
      ),
      { query: "?fbclid=ABC" },
    );
    await expect.poll(() => site.server.length).toBe(1);
    expect(site.server[0]).toMatchObject({ event: "PAGE_VIEW" });
    expect(String(site.server[0].fbp)).toMatch(/^fb\.1\.\d{13}\.\d{10}$/);
    expect(String(site.server[0].fbc)).toMatch(/^fb\.1\.\d{13}\.ABC$/);
    await site.context.close();
  });

  it("página sem o link 'Preferências de cookies' ganha o botão flutuante Cookies depois da escolha", async () => {
    const site = await open(pageHtml(config({ pixels: [PX.META] }), "<h1>Oferta clonada</h1>"));
    const { page } = site;
    const fab = page.getByRole("button", { name: "Preferências de cookies" });
    await expect.poll(() => banner(page).isVisible()).toBe(true);
    expect(await fab.count()).toBe(0);
    await page.getByRole("button", { name: "Recusar" }).click();
    await expect.poll(() => fab.isVisible()).toBe(true);
    await fab.click();
    await expect.poll(() => banner(page).isVisible()).toBe(true);
    expect(await fab.count()).toBe(0); // some enquanto o banner está aberto
    expect(await page.evaluate(() => document.activeElement?.shadowRoot?.activeElement?.textContent)).toBe("Recusar");
    await accept(page);
    await expect.poll(() => site.vendorRequests.length).toBe(1);
    await expect.poll(() => fab.isVisible()).toBe(true);
    await site.context.close();

    // Com o link no rodapé, ou sem aviso (OFF): sem botão.
    for (const [cfg, body] of [
      [config({ pixels: [PX.META] }), `<a href="#" data-os-consent-open>Preferências de cookies</a>`],
      [config({ pixels: [PX.META], consent: { mode: "OFF" } }), "<p>x</p>"],
    ] as const) {
      const other = await open(pageHtml(cfg, body), {
        init: `localStorage.setItem("os_consent", JSON.stringify({ v: 1, choice: "accepted", at: Date.now() }))`,
      });
      await settle(other.page, 300);
      expect(await other.page.locator("os-cookies").count()).toBe(0);
      await other.context.close();
    }
  });

  it("Recusar e Aceitar com o mesmo destaque; textos do botão 'Entendi' e do link da política configuráveis", async () => {
    for (const theme of ["dark", "light"] as const) {
      const site = await open(pageHtml(config({ pixels: [PX.META], consent: { theme } })));
      await expect.poll(() => banner(site.page).isVisible()).toBe(true);
      const styles = await site.page.$eval("os-consent", (el) =>
        Array.from(el.shadowRoot?.querySelectorAll("button") ?? []).map((b) => {
          const c = getComputedStyle(b);
          return `${c.backgroundColor}|${c.color}|${c.borderColor}|${c.fontWeight}`;
        }),
      );
      expect(styles).toHaveLength(2);
      expect(styles[0]).toBe(styles[1]);
      await site.context.close();
    }
    const custom = await open(
      pageHtml(
        config({
          pixels: [PX.META],
          consent: { mode: "NOTICE", noticeLabel: "Got it", policyLabel: "Privacy policy" },
        }),
      ),
    );
    await expect.poll(() => custom.page.getByRole("button", { name: "Got it" }).isVisible()).toBe(true);
    expect(await custom.page.getByRole("link", { name: "Privacy policy" }).getAttribute("href")).toBe("/privacidade");
    await custom.context.close();
  });
});

// ─── Refix 1 da revisão da Fase 4 ────────────────────────────────────────────

describe("refix 1: funil, formulário de captura e consentimento", () => {
  const RUNTIME = `<script data-os-runtime>${runtimeScript()}</script>`;
  const qs = (href: string | null) => Object.fromEntries(new URL(href ?? "", "http://site.test").searchParams);
  const cookie = async (site: Site, name: string) =>
    (await site.context.cookies("http://site.test/")).find((c) => c.name === name)?.value ?? null;

  it("antes da escolha, os IDs de clique seguem só nos links do funil; Aceitar na página 2 guarda o fbclid, cria o _fbc e completa o checkout", async () => {
    const cfg = config({ pixels: [PX.META] });
    const p1 = pageHtml(
      cfg,
      `<a id="next" href="/p2">Próxima</a><a id="ck" href="https://pay.hotmart.com/X1">Comprar</a>`,
    );
    const p2 = pageHtml(cfg, `<a id="ck2" href="https://pay.hotmart.com/X1">Comprar</a>`);
    const site = await open(p1, { query: "?fbclid=F1&utm_source=fb", pages: { "/p2": p2 } });
    const { page } = site;
    expect(qs(await page.getAttribute("#next", "href"))).toEqual({ utm_source: "fb", fbclid: "F1" });
    expect(qs(await page.getAttribute("#ck", "href"))).toEqual({ utm_source: "fb" });
    expect(await stored(page, "os_params")).toBeNull();

    await page.click("#next");
    await page.waitForURL(/\/p2\?/);
    expect(qs(await page.getAttribute("#ck2", "href"))).toEqual({ utm_source: "fb" });
    await accept(page);
    await expect.poll(() => page.getAttribute("#ck2", "href").then(qs)).toEqual({ utm_source: "fb", fbclid: "F1" });
    expect(await stored(page, "os_params")).toMatchObject({ p: { utm_source: "fb", fbclid: "F1" } });
    expect(await cookie(site, "_fbc")).toMatch(/^fb\.1\.\d{13}\.F1$/);
    await site.context.close();
  });

  it("Recusar tira os IDs de clique que já estavam nos links do funil (as UTMs ficam) e não desfaz o que a página mudou", async () => {
    const body = `<a id="next" href="/p2">Próxima</a><a id="other" href="/p3">Outra</a>`;
    const site = await open(pageHtml(config({ pixels: [PX.META] }), body), { query: "?fbclid=F1&utm_source=fb" });
    const { page } = site;
    expect(qs(await page.getAttribute("#next", "href"))).toEqual({ utm_source: "fb", fbclid: "F1" });
    // O script da página troca um destino depois: vale o novo.
    await page.evaluate(() => document.getElementById("other")?.setAttribute("href", "/p4"));
    await page.getByRole("button", { name: "Recusar" }).click();
    await expect.poll(() => page.getAttribute("#next", "href")).toBe("/p2?utm_source=fb");
    expect(await page.getAttribute("#other", "href")).toBe("/p4?utm_source=fb");
    await site.context.close();
  });

  it("formulário de captura: o webhook só recebe fbclid/gclid (inclusive no endereço da página) depois do Aceitar", async () => {
    const lead = `<form data-os-widget="lead-form" data-os-webhook="http://site.test/hook">
      <input name="email" type="email" value="ana@example.com"><button type="submit">Enviar</button></form>`;
    const html = pageHtml(config({ pixels: [PX.META] }), lead, { bodyEnd: RUNTIME });
    const run = async (choice: "Aceitar" | "Recusar" | null) => {
      const site = await open(html, { query: "?fbclid=AAA&gclid=GGG&utm_source=fb" });
      const bodies: string[] = [];
      site.page.on("request", (r) => {
        if (r.url() === "http://site.test/hook") bodies.push(r.postData() ?? "");
      });
      if (choice) await site.page.getByRole("button", { name: choice }).click();
      await site.page.click("button[type=submit]");
      await expect.poll(() => bodies.length).toBe(1);
      await site.context.close();
      return JSON.parse(bodies[0]) as Record<string, string>;
    };
    for (const choice of [null, "Recusar"] as const) {
      const body = await run(choice);
      expect(body).toMatchObject({ email: "ana@example.com", utm_source: "fb" });
      expect(body.fbclid).toBeUndefined();
      expect(body.gclid).toBeUndefined();
      expect(body.page).toBe("http://site.test/oferta?utm_source=fb");
    }
    const accepted = await run("Aceitar");
    expect(accepted).toMatchObject({ fbclid: "AAA", gclid: "GGG", utm_source: "fb" });
    expect(accepted.page).toBe("http://site.test/oferta?fbclid=AAA&gclid=GGG&utm_source=fb");
  });

  it("'Levar nome e e-mail' para uma página do funil: nada no endereço nem no eventos.php; o checkout de lá recebe", async () => {
    const cfg = config({
      consent: { mode: "NOTICE" },
      pixels: [PX.META],
      server: { endpoint: "/eventos.php", vendors: ["META"] },
    });
    const lead = `<form data-os-widget="lead-form" data-os-pass="1" action="/obrigado">
      <input name="name" value="Ana Maria"><input name="email" type="email" value="ana@example.com">
      <input name="phone" type="tel" value="(11) 91234-5678"><button type="submit">Enviar</button></form>`;
    const thanks = pageHtml(cfg, `<a id="ck" data-os-link="checkout" href="https://pay.hotmart.com/X1">Comprar</a>`, {
      bodyEnd: RUNTIME,
    });
    const site = await open(pageHtml(cfg, lead, { bodyEnd: RUNTIME }), {
      pages: { "/obrigado": thanks },
      external: { "https://pay.hotmart.com/": "<!doctype html><h1>checkout</h1>" },
    });
    const { page } = site;
    await page.click("button[type=submit]");
    await page.waitForURL("http://site.test/obrigado");
    await expect.poll(() => site.server.map((s) => s.event_source_url)).toContain("http://site.test/obrigado");
    for (const s of site.server) expect(String(s.event_source_url)).not.toMatch(/ana|email|name|phone/i);
    await page.click("#ck");
    await expect.poll(() => site.navigations.length).toBe(1);
    expect(qs(site.navigations[0])).toEqual({ name: "Ana Maria", email: "ana@example.com", phone: "(11) 91234-5678" });
    await site.context.close();

    // Destino de fora (checkout direto): na URL, como sempre.
    const direct = await open(
      pageHtml(cfg, lead.replace('action="/obrigado"', 'action="https://pay.hotmart.com/X1"'), { bodyEnd: RUNTIME }),
      { external: { "https://pay.hotmart.com/": "<!doctype html><h1>checkout</h1>" } },
    );
    await direct.page.click("button[type=submit]");
    await expect.poll(() => direct.navigations.length).toBe(1);
    expect(qs(direct.navigations[0])).toMatchObject({ name: "Ana Maria", email: "ana@example.com" });
    await direct.context.close();
  });

  it("eventos.php: dados pessoais na URL da página não vão no event_source_url", async () => {
    const cfg = config({
      consent: { mode: "NOTICE" },
      pixels: [PX.META],
      server: { endpoint: "/eventos.php", vendors: ["META"] },
    });
    const site = await open(pageHtml(cfg), { query: "?utm_source=fb&email=ana%40example.com&nome=Ana&cpf=123" });
    await expect.poll(() => site.server.length).toBe(1);
    expect(site.server[0].event_source_url).toBe("http://site.test/oferta?utm_source=fb");
    await site.context.close();
  });

  it("formulário de captura logo depois do Aceitar, com o pixel ainda carregando: o Lead e o PageView saem antes de trocar de página", async () => {
    const cfg = config({
      pixels: [PX.META],
      rules: [{ event: "LEAD", trigger: "FORM_SUBMIT", value: null, selector: null }],
    });
    const lead = `<form data-os-widget="lead-form" action="/obrigado">
      <input name="email" type="email" value="ana@example.com"><button type="submit">Enviar</button></form>`;
    const site = await open(pageHtml(cfg, lead, { bodyEnd: RUNTIME }), {
      pages: { "/obrigado": "<!doctype html><title>Obrigado</title><p>ok</p>" },
      delay: { [META_URL]: 700 },
      init: KEEP_CALLS,
    });
    const { page } = site;
    await accept(page);
    await page.waitForTimeout(100);
    await page.click("button[type=submit]");
    await page.waitForURL("http://site.test/obrigado");
    const before = await keptCalls(page);
    expect(
      byPrefix(before, "fbq")
        .filter((c) => c[1] === "track")
        .map((c) => c[2]),
    ).toEqual(["PageView", "Lead"]);
    await site.context.close();
  });
});

describe("refix 1: navegação enquanto o pixel carrega", () => {
  const RUNTIME = `<script data-os-runtime>${runtimeScript()}</script>`;
  const BEACON = `(function(){var q=fbq.queue.slice();fbq.queue.length=0;
    fbq.callMethod=function(){var a=[].slice.call(arguments);if(a[0]==="track"||a[0]==="trackCustom")navigator.sendBeacon("https://www.facebook.com/tr?ev="+a[1]);};
    q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`;
  const tr = (site: Site) =>
    site.requests
      .filter((u) => u.startsWith("https://www.facebook.com/tr"))
      .map((u) => new URL(u).searchParams.get("ev"));
  const CHECKOUT_RULE = [
    { event: "INITIATE_CHECKOUT" as const, trigger: "CHECKOUT_CLICK" as const, value: null, selector: null },
  ];
  const slow = {
    stubs: { [META_URL]: BEACON },
    delay: { [META_URL]: 700 },
    external: {
      "https://pay.hotmart.com/": "<!doctype html><h1>checkout</h1>",
      "https://www.youtube.com/": "<!doctype html><h1>video</h1>",
    },
  };

  it("clique duplo (ou dois cliques) no checkout: a espera vale para os dois e os eventos chegam à Meta (Só avisar e Pedir permissão)", async () => {
    for (const mode of ["NOTICE", "OPT_IN"] as const) {
      for (const how of ["dblclick", "twice"] as const) {
        const cfg = config({ pixels: [PX.META], rules: CHECKOUT_RULE, consent: { mode } });
        const site = await open(
          pageHtml(cfg, `<a id="ck" data-os-link="checkout" href="https://pay.hotmart.com/X1">Comprar</a>`),
          { ...slow, waitUntil: "domcontentloaded" },
        );
        const { page } = site;
        if (mode === "OPT_IN") await accept(page);
        await page.waitForTimeout(150);
        if (how === "dblclick") await page.dblclick("#ck");
        else {
          await page.click("#ck");
          await page.waitForTimeout(300);
          await page.click("#ck").catch(() => {}); // a página pode já estar saindo
        }
        await page.waitForURL(/pay\.hotmart\.com/);
        await settle(page, 500);
        expect(tr(site), `${mode} ${how}`).toEqual(["PageView", "InitiateCheckout"]);
        await site.context.close();
      }
    }
  });

  it("botão data-os-href logo depois do Aceitar: o script das páginas espera o pixel e o evento chega à Meta", async () => {
    const cfg = config({ pixels: [PX.META], rules: CHECKOUT_RULE });
    const body = `<button id="ck" data-os-link="checkout" data-os-href="https://pay.hotmart.com/X1">Comprar</button>`;
    const site = await open(pageHtml(cfg, body, { bodyEnd: RUNTIME }), slow);
    const { page } = site;
    await accept(page);
    await page.waitForTimeout(150);
    await page.dblclick("#ck");
    await page.waitForURL(/pay\.hotmart\.com/);
    await settle(page, 500);
    expect(tr(site)).toEqual(["PageView", "InitiateCheckout"]);
    expect(site.navigations).toEqual(["https://pay.hotmart.com/X1"]);
    await site.context.close();
  });

  it("o script da própria página que trata o clique (modal) vale mesmo com o pixel carregando", async () => {
    const cfg = config({
      consent: { mode: "NOTICE" },
      pixels: [PX.META],
      rules: [{ event: "CONTACT", trigger: "ELEMENT_CLICK", value: null, selector: "#v" }],
    });
    const body = `<a id="v" href="https://www.youtube.com/watch?v=1">Ver vídeo</a>
      <script>document.getElementById("v").addEventListener("click",function(e){e.preventDefault();window.__modal=1})</script>`;
    const site = await open(pageHtml(cfg, body), { ...slow, waitUntil: "domcontentloaded" });
    const { page } = site;
    await page.waitForTimeout(150);
    await page.click("#v");
    await settle(page, 1_200);
    expect(page.url()).toBe("http://site.test/oferta");
    expect(await page.evaluate(() => (window as { __modal?: number }).__modal)).toBe(1);
    expect(tr(site)).toEqual(["PageView", "Contact"]);
    await site.context.close();
  });
});

describe("refix 1: código em espera e navegadores antigos", () => {
  const ownListener = (page: Page) => page.evaluate(() => Object.hasOwn(window, "addEventListener"));

  it("<script type=module> + <script nomodule> no código em espera: o seguinte roda e o addEventListener volta ao normal", async () => {
    const head = gateCode(
      `<script type="module" src="/w.esm.js"></script><script nomodule src="/w.js"></script><script>window.__after=1</script>`,
      "MARKETING",
    );
    const files: OpenOptions["files"] = {
      "/w.esm.js": ["application/javascript", "window.__esm=1", 0],
      "/w.js": ["application/javascript", "window.__legacy=1", 0],
    };
    const site = await open(pageHtml(config({ pixels: [PX.META] }), "", { head }), { files });
    const { page } = site;
    await accept(page);
    await expect.poll(() => page.evaluate(() => (window as { __after?: number }).__after)).toBe(1);
    expect(await page.evaluate(() => (window as { __esm?: number }).__esm)).toBe(1);
    expect(await page.evaluate(() => (window as { __legacy?: number }).__legacy)).toBeUndefined();
    expect(await ownListener(page)).toBe(false);
    await site.context.close();
  });

  it("script externo que nunca responde: depois de 10 s os seguintes rodam", async () => {
    const hang = "https://tracker.example/hang.js";
    const head = gateCode(`<script src="${hang}"></script><script>window.__after=1</script>`, "MARKETING");
    const site = await open(pageHtml(config(), "", { head }), {
      clock: true,
      stubs: { [hang]: "window.__hang=1" },
      delay: { [hang]: 30_000 },
    });
    const { page } = site;
    await accept(page);
    await page.clock.runFor(2_000);
    expect(await page.evaluate(() => (window as { __after?: number }).__after)).toBeUndefined();
    await page.clock.runFor(8_500);
    await expect.poll(() => page.evaluate(() => (window as { __after?: number }).__after)).toBe(1);
    expect(await ownListener(page)).toBe(false);
    await site.context.close();
  });

  it("sem Object.hasOwn (Safari < 15.4, Chrome < 93): o código em espera roda depois do Aceitar e o botão Cookies aparece", async () => {
    const head = gateCode(`<script>window.__ran=(window.__ran||0)+1</script>`, "MARKETING");
    const noHasOwn = "delete Object.hasOwn;";
    // Como a prévia/ZIP montam: código de marketing na página (renderPageHtml).
    const cfg = config({ marketingCode: true });
    const site = await open(pageHtml(cfg, "", { head }), { init: noHasOwn });
    const { page } = site;
    await accept(page);
    await expect.poll(() => page.evaluate(() => (window as { __ran?: number }).__ran)).toBe(1);
    await expect.poll(() => page.locator("os-cookies").count()).toBe(1);
    expect(site.errors).toEqual([]);
    await site.context.close();

    const remembered = await open(pageHtml(cfg, "", { head }), {
      init: `${noHasOwn}localStorage.setItem("os_consent", JSON.stringify({ v: 1, choice: "accepted", at: Date.now() }))`,
    });
    await expect.poll(() => remembered.page.evaluate(() => (window as { __ran?: number }).__ran)).toBe(1);
    expect(remembered.errors).toEqual([]);
    await remembered.context.close();
  });

  it("os scripts compilados não usam APIs que o Safari 13 não tem", () => {
    for (const code of [SCRIPT, runtimeScript()]) {
      for (const api of ["Object.hasOwn", ".at(", "findLast", "replaceAll", "structuredClone"]) {
        expect(code.includes(api), api).toBe(false);
      }
    }
  });
});

describe("refix 1: botão Cookies", () => {
  const BAR = `<style>.bar{position:fixed;left:0;right:0;bottom:0;height:66px;display:flex;align-items:center;padding:0 16px;background:#111;color:#fff}</style>
    <div class="bar"><span id="price">Oferta: R$ 97</span><a href="https://pay.hotmart.com/X1" style="margin-left:auto">Comprar</a></div>`;

  it("fica acima de uma barra fixa no rodapé (computador e celular) e não cobre o preço", async () => {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      const site = await open(pageHtml(config({ pixels: [PX.META] }), `<h1>Oferta</h1>${BAR}`), { viewport });
      const { page } = site;
      await page.getByRole("button", { name: "Recusar" }).click();
      const fab = page.getByRole("button", { name: "Preferências de cookies" });
      await expect.poll(() => fab.isVisible()).toBe(true);
      const bar = await page.locator(".bar").boundingBox();
      await expect.poll(async () => (await fab.boundingBox())?.y ?? 9999).toBeLessThan((bar?.y ?? 0) - 1);
      const box = await fab.boundingBox();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? 0);
      const price = await page.locator("#price").boundingBox();
      const center = { x: (price?.x ?? 0) + 5, y: (price?.y ?? 0) + (price?.height ?? 0) / 2 };
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, center)).toBe("price");
      await site.context.close();
    }
  });

  it("sem barra fixa, fica no canto; uma camada de tela inteira (popup) não o empurra para fora da tela", async () => {
    const overlay = `<div style="position:fixed;inset:0;background:#0003;pointer-events:none"></div>`;
    const site = await open(pageHtml(config({ pixels: [PX.META] }), `<h1>Oferta</h1>${overlay}`));
    const { page } = site;
    await page.getByRole("button", { name: "Recusar" }).click();
    const fab = page.getByRole("button", { name: "Preferências de cookies" });
    await expect.poll(() => fab.isVisible()).toBe(true);
    const box = await fab.boundingBox();
    expect(800 - ((box?.y ?? 0) + (box?.height ?? 0))).toBeCloseTo(12, 0);
    await site.context.close();
  });

  it("Só avisar: depois do 'Entendi' não aparece botão Cookies (não haveria o que mudar)", async () => {
    const site = await open(
      pageHtml(config({ pixels: [PX.META], consent: { mode: "NOTICE", noticeLabel: "Ok, entendi" } }), "<h1>x</h1>"),
    );
    const { page } = site;
    await page.getByRole("button", { name: "Ok, entendi" }).click();
    await settle(page, 300);
    expect(await page.locator("os-cookies").count()).toBe(0);
    await site.context.close();
  });
});

// ─── Refix 2 da revisão da Fase 4 ────────────────────────────────────────────

describe("refix 2: aviso sem pixels e 'Recusar' guardado", () => {
  const RUNTIME = `<script data-os-runtime>${runtimeScript()}</script>`;
  const qs = (href: string | null) => Object.fromEntries(new URL(href ?? "", "http://site.test").searchParams);

  it("'Pedir permissão' sem pixels: quem chega com fbclid/gclid vê o aviso; o 'Aceitar' leva os IDs ao checkout e ao webhook e guarda tudo", async () => {
    const body = `<a id="ck" href="https://pay.hotmart.com/X123?off=a">Comprar</a>
      <form data-os-widget="lead-form" data-os-webhook="http://site.test/hook">
      <input name="email" type="email" value="ana@example.com"><button type="submit">Enviar</button></form>`;
    const site = await open(pageHtml(config(), body, { bodyEnd: RUNTIME }), {
      query: "?utm_source=fb&utm_campaign=bf&fbclid=F1&gclid=G1",
    });
    const { page } = site;
    const hook: string[] = [];
    page.on("request", (r) => {
      if (r.url() === "http://site.test/hook") hook.push(r.postData() ?? "");
    });
    await expect.poll(() => banner(page).isVisible()).toBe(true);
    expect(qs(await page.getAttribute("#ck", "href"))).toEqual({ off: "a", utm_source: "fb", utm_campaign: "bf" });
    expect(await stored(page, "os_params")).toBeNull();

    await accept(page);
    await expect
      .poll(() => page.getAttribute("#ck", "href").then(qs))
      .toEqual({ off: "a", utm_source: "fb", utm_campaign: "bf", fbclid: "F1", gclid: "G1" });
    expect(await stored(page, "os_params")).toMatchObject({ p: { utm_source: "fb", fbclid: "F1", gclid: "G1" } });
    expect(await page.evaluate(() => (window as { osConsent?: { granted(): boolean } }).osConsent?.granted())).toBe(
      true,
    );
    await page.click("button[type=submit]");
    await expect.poll(() => hook.length).toBe(1);
    expect(JSON.parse(hook[0])).toMatchObject({ fbclid: "F1", gclid: "G1", utm_source: "fb" });
    expect(site.vendorRequests).toEqual([]);
    await site.context.close();
  });

  it("sem pixels: só UTMs pedem o aviso quando há o que guardar (dias > 0); sem parâmetros ou só na visita, nada de aviso", async () => {
    const utms = await open(pageHtml(config(), LINKS), { query: "?utm_source=fb" });
    await expect.poll(() => banner(utms.page).isVisible()).toBe(true);
    await utms.context.close();

    for (const [cfg, query] of [
      [config({ forwarding: { persistDays: 0 } }), "?utm_source=fb"],
      [config(), ""],
      [config({ consent: { mode: "NOTICE" } }), "?fbclid=F1"],
    ] as const) {
      const site = await open(pageHtml(cfg, LINKS), { query });
      await settle(site.page, 400);
      expect(await site.page.locator("os-consent").count(), `${cfg.consent.mode} ${query}`).toBe(0);
      await site.context.close();
    }
  });

  it("'Recusar' no 'Pedir permissão' vale depois de a oferta passar para 'Só avisar': nada carrega; o botão Cookies deixa aceitar", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const gtagCode = `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config","G-XYZ9876543")</script>`;
    const first = await open(pageHtml(config({ pixels: [PX.META] }), LINKS), {
      context,
      query: "?fbclid=F1&utm_source=fb",
    });
    await first.page.getByRole("button", { name: "Recusar" }).click();
    await first.page.close();

    const notice = pageHtml(config({ pixels: [PX.META, PX.GA4], consent: { mode: "NOTICE" } }), LINKS, {
      head: gtagCode,
    });
    const second = await open(notice, { context, query: "?fbclid=F2&utm_source=fb" });
    const { page } = second;
    await settle(page, 400);
    expect(second.vendorRequests).toEqual([]);
    expect(await page.locator("os-consent").count()).toBe(0);
    expect((await context.cookies("http://site.test/")).map((c) => c.name)).toEqual([]);
    expect(await stored(page, "os_params")).toBeNull();
    expect(await page.getAttribute("#osHref", "data-os-href")).toBe("https://pay.kiwify.com.br/abc?utm_source=fb");
    // Google Consent Mode: negado para quem recusou (também para a tag colada na página).
    expect((await dataLayer(page))[0]).toMatchObject(["consent", "default", { ad_storage: "denied" }]);

    const fab = page.getByRole("button", { name: "Preferências de cookies" });
    await expect.poll(() => fab.isVisible()).toBe(true);
    await fab.click();
    await accept(page);
    await expect.poll(() => second.vendorRequests.some((u) => u.startsWith(META_URL))).toBe(true);
    await expect.poll(() => page.getAttribute("#osHref", "data-os-href")).toContain("fbclid=F2");
    await expect
      .poll(async () => (await context.cookies("http://site.test/")).map((c) => c.name).sort())
      .toEqual(["_fbc", "_fbp"]);
    // Aceitou no "Só avisar": não sobra o que mudar, o botão some.
    expect(await page.locator("os-cookies").count()).toBe(0);
    await page.close();

    // "Sem aviso" é a escolha explícita de não pedir: os pixels carregam.
    const off = await open(pageHtml(config({ pixels: [PX.META], consent: { mode: "OFF" } })), {
      context,
      init: `localStorage.setItem("os_consent", JSON.stringify({ v: 1, choice: "rejected", at: Date.now() }))`,
    });
    await expect.poll(() => off.vendorRequests.length).toBe(1);
    await context.close();
  });
});

describe("refix 2: código em espera no lugar certo e onload", () => {
  it("o código nunca cai num comentário: <body> de comentário condicional antigo e '</head>' dentro de comentário", async () => {
    const meta = `<!-- Meta Pixel Code --><script>window.__mk=(window.__mk||0)+1</script><img src="${TRACKER}mk.gif" alt=""><!-- End Meta Pixel Code -->`;
    const base = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Oferta</title><!-- antigo: </head> --></head><!--[if IE 8 ]><body class="ie8"><![endif]--><body class="real"><h1>Oferta</h1><!-- fim: </body> --></body></html>`;
    const gated = gateCode(meta, "MARKETING");
    const html = injectTracking(
      injectPageCode(base, { head: gated, bodyStart: gated, bodyEnd: gated }),
      config({ pixels: [PX.META] }),
      TAG,
    );
    const site = await open(html);
    const { page } = site;
    await expect.poll(() => banner(page).isVisible()).toBe(true);
    await settle(page, 400);
    expect(fromTracker(site)).toEqual([]);
    expect(site.vendorRequests).toEqual([]);
    expect(await page.evaluate(() => (window as { __mk?: number }).__mk)).toBeUndefined();

    await accept(page);
    await expect.poll(() => page.evaluate(() => (window as { __mk?: number }).__mk)).toBe(3);
    expect(fromTracker(site).filter((u) => u.endsWith("mk.gif")).length).toBeGreaterThanOrEqual(1);
    await site.context.close();
  });

  it("script externo em espera com onload/onerror próprios: rodam depois do 'Aceitar' (carregar e depois iniciar)", async () => {
    const head = gateCode(
      `<script src="/w.js" onload="window.__inited=(window.__w===1)?'ok':'sem w'"></script>` +
        `<script src="/falta.js" onerror="window.__err=1"></script><script>window.__after=1</script>`,
      "MARKETING",
    );
    const site = await open(pageHtml(config({ pixels: [PX.META] }), "", { head }), {
      files: { "/w.js": ["application/javascript", "window.__w=1", 50] },
    });
    const { page } = site;
    const state = () =>
      page.evaluate(() => {
        const w = window as { __w?: number; __inited?: string; __err?: number; __after?: number };
        return [w.__w ?? null, w.__inited ?? null, w.__err ?? null, w.__after ?? null];
      });
    await settle(page, 300);
    expect(await state()).toEqual([null, null, null, null]);
    await accept(page);
    await expect.poll(state).toEqual([1, "ok", 1, 1]);
    await site.context.close();
  });
});

describe("refix 2: saída da página enquanto o pixel carrega", () => {
  const RUNTIME = `<script data-os-runtime>${runtimeScript()}</script>`;
  const BEACON = `(function(){var q=fbq.queue.slice();fbq.queue.length=0;
    fbq.callMethod=function(){var a=[].slice.call(arguments);if(a[0]==="track"||a[0]==="trackCustom")navigator.sendBeacon("https://www.facebook.com/tr?ev="+a[1]);};
    q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`;
  const tr = (site: Site) =>
    site.requests
      .filter((u) => u.startsWith("https://www.facebook.com/tr"))
      .map((u) => new URL(u).searchParams.get("ev"));
  const CHECKOUT_RULE = [
    { event: "INITIATE_CHECKOUT" as const, trigger: "CHECKOUT_CLICK" as const, value: null, selector: null },
  ];
  const slow = {
    stubs: { [META_URL]: BEACON },
    delay: { [META_URL]: 700 },
    external: {
      "https://pay.hotmart.com/": "<!doctype html><h1>checkout</h1>",
      "https://www.youtube.com/": "<!doctype html><h1>video</h1>",
    },
  };

  it("formulário de captura com webhook logo depois do 'Aceitar': sai quando o webhook respondeu E o Lead saiu", async () => {
    const cfg = config({
      pixels: [PX.META],
      rules: [{ event: "LEAD", trigger: "FORM_SUBMIT", value: null, selector: null }],
    });
    const lead = `<form data-os-widget="lead-form" data-os-webhook="http://site.test/hook" action="/obrigado">
      <input name="email" type="email" value="ana@example.com"><button type="submit">Enviar</button></form>`;
    const site = await open(pageHtml(cfg, lead, { bodyEnd: RUNTIME }), {
      pages: { "/obrigado": "<!doctype html><title>Obrigado</title><p>ok</p>" },
      files: { "/hook": ["application/json", "{}", 80] },
      delay: { [META_URL]: 700 },
      init: KEEP_CALLS,
    });
    const { page } = site;
    const hook: string[] = [];
    page.on("request", (r) => {
      if (r.url() === "http://site.test/hook") hook.push(r.method());
    });
    await accept(page);
    await page.waitForTimeout(100);
    await page.click("button[type=submit]");
    await page.waitForURL("http://site.test/obrigado");
    const before = await keptCalls(page);
    expect(
      byPrefix(before, "fbq")
        .filter((c) => c[1] === "track")
        .map((c) => c[2]),
    ).toEqual(["PageView", "Lead"]);
    expect(hook).toEqual(["POST"]);
    await site.context.close();
  });

  it("formulário de checkout (GET e POST) enviado com o pixel carregando: InitiateCheckout chega; reenvio sem repetir o script da página", async () => {
    for (const method of ["get", "post"] as const) {
      for (const mode of ["NOTICE", "OPT_IN"] as const) {
        const cfg = config({ pixels: [PX.META], rules: CHECKOUT_RULE, consent: { mode } });
        const form = `<form id="f" data-os-checkout method="${method}" action="https://pay.hotmart.com/X123">
          <input type="hidden" name="off" value="abc"><button id="buy" name="plano" value="ouro">Comprar</button></form>
          <script>document.getElementById("f").addEventListener("submit",function(){console.info("envio da página")})</script>`;
        const site = await open(pageHtml(cfg, form), {
          ...slow,
          waitUntil: "domcontentloaded",
          query: "?utm_source=fb",
        });
        const { page } = site;
        const posted: string[] = [];
        page.on("request", (r) => {
          if (r.isNavigationRequest() && r.method() === "POST") posted.push(r.postData() ?? "");
        });
        if (mode === "OPT_IN") await accept(page);
        await page.waitForTimeout(150);
        // Clique duplo: o segundo envio não passa na frente do pixel.
        if (mode === "NOTICE") await page.dblclick("#buy");
        else await page.click("#buy");
        await page.waitForURL(/pay\.hotmart\.com/);
        await settle(page, 500);
        const label = `${method} ${mode}`;
        expect(tr(site), label).toEqual(["PageView", "InitiateCheckout"]);
        expect(
          site.info.filter((m) => m === "envio da página"),
          label,
        ).toHaveLength(1);
        if (method === "get") {
          expect(site.navigations, label).toEqual(["https://pay.hotmart.com/X123?off=abc&plano=ouro&utm_source=fb"]);
        } else {
          expect(site.navigations, label).toEqual(["https://pay.hotmart.com/X123?utm_source=fb"]);
          expect(posted, label).toEqual(["off=abc&plano=ouro"]);
        }
        await site.context.close();
      }
    }
  });

  it("script da página que só para a propagação do clique no checkout: a espera vale e o evento chega à Meta", async () => {
    for (const stop of ["stopPropagation", "stopImmediatePropagation"] as const) {
      const cfg = config({ consent: { mode: "NOTICE" }, pixels: [PX.META], rules: CHECKOUT_RULE });
      const body = `<div id="menu"><a id="buy" href="https://pay.hotmart.com/X123">Comprar</a></div>
        <script>document.getElementById("menu").addEventListener("click",function(e){e.${stop}()})</script>`;
      const site = await open(pageHtml(cfg, body), { ...slow, waitUntil: "domcontentloaded" });
      const { page } = site;
      await page.waitForTimeout(150);
      await page.click("#buy");
      await page.waitForURL(/pay\.hotmart\.com/);
      await settle(page, 500);
      expect(tr(site), stop).toEqual(["PageView", "InitiateCheckout"]);
      await site.context.close();
    }
  });

  it("a página que trata o clique depois da decisão (ouvinte na janela, ou 'return false' do jQuery) continua valendo", async () => {
    const cfg = config({
      consent: { mode: "NOTICE" },
      pixels: [PX.META],
      rules: [{ event: "CONTACT", trigger: "ELEMENT_CLICK", value: null, selector: "#v" }],
    });
    for (const script of [
      `addEventListener("click",function(e){if(e.target.closest("#v")){e.preventDefault();window.__modal=1}})`,
      `document.getElementById("v").addEventListener("click",function(e){e.stopPropagation();e.preventDefault();window.__modal=1})`,
    ]) {
      const body = `<a id="v" href="https://www.youtube.com/watch?v=1">Ver vídeo</a><script>${script}</script>`;
      const site = await open(pageHtml(cfg, body), { ...slow, waitUntil: "domcontentloaded" });
      const { page } = site;
      await page.waitForTimeout(150);
      await page.click("#v");
      await settle(page, 1_200);
      expect(page.url()).toBe("http://site.test/oferta");
      expect(await page.evaluate(() => (window as { __modal?: number }).__modal)).toBe(1);
      expect(tr(site)).toEqual(["PageView", "Contact"]);
      // Os cliques seguintes voltam a valer (a página não ficou "saindo").
      await page.evaluate(() => {
        const a = document.createElement("a");
        a.id = "next";
        a.href = "/obrigado";
        a.textContent = "Obrigado";
        document.body.appendChild(a);
      });
      await page.click("#next");
      await page.waitForURL(/\/obrigado/);
      await site.context.close();
    }
  });
});

describe("refix 2: botão Cookies e barras que aparecem depois", () => {
  const bar = (css: string, script: string) =>
    `<style>.bar{position:fixed;left:0;right:0;bottom:0;height:66px;display:flex;align-items:center;padding:0 16px;background:#111;color:#fff;${css}}.bar.on{transform:none}</style>
    <div style="height:3000px"><h1>Oferta</h1></div>
    <div class="bar" id="bar"><span id="price">Oferta: R$ 97</span></div><script>${script}</script>`;
  const SLIDE = bar(
    "transform:translateY(110%);transition:transform .4s",
    `addEventListener("scroll",function(){if(scrollY>300)document.getElementById("bar").classList.add("on")},{passive:true})`,
  );
  const TIMER = bar("display:none", `setTimeout(function(){document.getElementById("bar").style.display="flex"},1500)`);
  const bottom = async (page: Page, sel: string) => {
    const b = await page.locator(sel).boundingBox();
    return (b?.y ?? 0) + (b?.height ?? 0);
  };

  it("barra que desliza ao rolar (transição): o botão sobe sem precisar rolar de novo (computador e celular)", async () => {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      const site = await open(pageHtml(config({ pixels: [PX.META] }), SLIDE), { viewport });
      const { page } = site;
      await page.getByRole("button", { name: "Recusar" }).click();
      const fab = page.getByRole("button", { name: "Preferências de cookies" });
      await expect.poll(() => fab.isVisible()).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 400));
      await page.waitForTimeout(1_000);
      const barTop = (await page.locator("#bar").boundingBox())?.y ?? 0;
      expect(barTop).toBeLessThan(viewport.height);
      expect(await bottom(page, "os-cookies >> button"), `${viewport.width}`).toBeLessThanOrEqual(barTop);
      await site.context.close();
    }
  });

  it("barra que aparece por um timer do script da página: o botão sobe sem rolagem", async () => {
    const site = await open(pageHtml(config({ pixels: [PX.META] }), TIMER));
    const { page } = site;
    await page.getByRole("button", { name: "Recusar" }).click();
    const fab = page.getByRole("button", { name: "Preferências de cookies" });
    await expect.poll(() => fab.isVisible()).toBe(true);
    expect(800 - (await bottom(page, "os-cookies >> button"))).toBeCloseTo(12, 0);
    await expect
      .poll(async () => (await page.locator("#bar").boundingBox())?.height ?? 0, { timeout: 4_000 })
      .toBeGreaterThan(0);
    const barTop = (await page.locator("#bar").boundingBox())?.y ?? 0;
    await expect.poll(() => bottom(page, "os-cookies >> button")).toBeLessThanOrEqual(barTop);
    await site.context.close();
  });
});

// ─── Refix 3 da revisão da Fase 4 ────────────────────────────────────────────

describe("refix 3: 'Evento ao clicar' num botão de enviar cujo clique a página trata", () => {
  const form = (button: string, script = "") =>
    `<form id="f" action="/postback" method="post"><input name="email" type="email" id="email" value="ana@example.com">${button}</form><script>${script}</script>`;

  it("clique tratado pela página (fetch com preventDefault, 'return false', jQuery): o evento sai uma vez, sem envio", async () => {
    const cases: [string, string, string, string][] = [
      [
        "fetch no clique",
        `<button id="b" data-os-event="LEAD">Quero</button>`,
        `document.getElementById("b").addEventListener("click",function(e){e.preventDefault();fetch("/api",{method:"POST"});window.__sent=1})`,
        "Lead",
      ],
      [
        "formulário da página inteira, botão com 'return false'",
        `<h1>Oferta</h1><button id="b" data-os-event="CONTACT" onclick="window.__sent=1;return false">WhatsApp</button>`,
        "",
        "Contact",
      ],
      [
        "jQuery: stopPropagation + preventDefault",
        `<button id="b" data-os-event="LEAD">Quero</button>`,
        `document.getElementById("b").addEventListener("click",function(e){e.stopPropagation();e.preventDefault();window.__sent=1})`,
        "Lead",
      ],
    ];
    for (const [label, button, script, event] of cases) {
      const cfg = config({ consent: { mode: "NOTICE" }, pixels: [PX.META] });
      const site = await open(pageHtml(cfg, form(button, script)), { files: { "/api": ["application/json", "{}"] } });
      const { page } = site;
      await expect.poll(() => fbEvents(page)).toEqual(["PageView"]);
      await page.click("#b");
      await expect.poll(() => fbEvents(page), { message: label }).toEqual(["PageView", event]);
      await settle(page, 300);
      expect(await fbEvents(page), label).toEqual(["PageView", event]);
      expect(page.url(), label).toBe("http://site.test/oferta");
      expect(await page.evaluate(() => (window as { __sent?: number }).__sent), label).toBe(1);
      await site.context.close();
    }
  });

  it("tentativa barrada pela validação do navegador não conta; o envio válido depois (tratado pela página) conta uma vez", async () => {
    const cfg = config({
      consent: { mode: "OFF" },
      pixels: [PX.META],
      rules: [{ event: "LEAD", trigger: "FORM_SUBMIT", value: null, selector: null }],
    });
    const body = `<form id="f"><input name="email" type="email" id="email" required><button id="b" data-os-event="LEAD">Quero</button></form>
      <script>document.getElementById("f").addEventListener("submit",function(e){e.preventDefault();window.__sent=(window.__sent||0)+1})</script>`;
    const site = await open(pageHtml(cfg, body), { clock: true });
    const { page } = site;
    await expect.poll(() => fbEvents(page)).toEqual(["PageView"]);
    await page.click("#b");
    await page.clock.runFor(2_000);
    expect(await fbEvents(page)).toEqual(["PageView"]);
    await page.fill("#email", "ana@example.com");
    await page.click("#b");
    await page.clock.runFor(2_000);
    expect(await fbEvents(page)).toEqual(["PageView", "Lead"]);
    expect(await page.evaluate(() => (window as { __sent?: number }).__sent)).toBe(1);
    await site.context.close();
  });
});

describe("refix 3: rolagem em página curta com imagens 'lazy' que não vão crescer a página", () => {
  const rule = config({
    consent: { mode: "OFF" },
    pixels: [PX.META],
    rules: [{ event: "VIEW_CONTENT", trigger: "SCROLL_DEPTH", value: 50, selector: null }],
  });
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';

  it("imagem escondida (só no celular), quebrada (404 ou resposta inválida) ou slide fora do carrossel: dispara ao carregar", async () => {
    const variants: Record<string, string> = {
      "só no celular": `<style>@media(min-width:768px){.mob{display:none}}</style><img class="mob" src="/a.svg" loading="lazy" alt="">`,
      "404 com tamanho": `<img src="/nao-existe.png" loading="lazy" width="100" height="100" alt="">`,
      "404 sem tamanho": `<img src="/nao-existe.png" loading="lazy" alt="">`,
      "resposta inválida depois do load": `<img src="/lenta.png" loading="lazy" alt="Foto">`,
      carrossel: `<div style="width:300px;overflow:hidden"><div style="display:flex;width:600px"><img src="/a.svg" loading="lazy" width="300" height="100" alt=""><img src="/b.svg" loading="lazy" width="300" height="100" alt="" style="margin-left:2000px"></div></div>`,
    };
    for (const [label, extra] of Object.entries(variants)) {
      const site = await open(pageHtml(rule, `<h1>Obrigado!</h1><p>Seu acesso chega por e-mail.</p>${extra}`), {
        files: {
          "/a.svg": ["image/svg+xml", SVG],
          "/b.svg": ["image/svg+xml", SVG],
          "/lenta.png": ["image/png", "não é imagem", 600],
        },
      });
      await expect.poll(() => fbEvents(site.page), { message: label }).toEqual(["PageView", "ViewContent"]);
      await site.context.close();
    }
  });
});

describe("refix 3: 'Pedir permissão' sem pixels, com o repasse desligado ou sem os IDs de clique na lista", () => {
  const RUNTIME = `<script data-os-runtime>${runtimeScript()}</script>`;
  const lead = (webhook: string) => `<form data-os-widget="lead-form" data-os-webhook="${webhook}">
    <input name="email" type="email" value="ana@example.com"><button type="submit" id="go">Enviar</button></form>`;

  it("formulário de captura com webhook: quem chega com fbclid/gclid vê o aviso e o 'Aceitar' manda os IDs ao webhook", async () => {
    for (const forwarding of [{ enabled: false }, { params: ["utm_source", "utm_campaign"], persistDays: 0 }]) {
      const label = JSON.stringify(forwarding);
      const site = await open(pageHtml(config({ forwarding }), lead("http://site.test/hook"), { bodyEnd: RUNTIME }), {
        query: "?utm_source=fb&fbclid=F1&gclid=G1",
        files: { "/hook": ["application/json", "{}"] },
      });
      const { page } = site;
      const hook: string[] = [];
      page.on("request", (r) => {
        if (r.url() === "http://site.test/hook") hook.push(r.postData() ?? "");
      });
      await expect.poll(() => banner(page).isVisible(), { message: label }).toBe(true);
      await accept(page);
      await page.click("#go");
      await expect.poll(() => hook.length, { message: label }).toBe(1);
      expect(JSON.parse(hook[0]), label).toMatchObject({
        fbclid: "F1",
        gclid: "G1",
        page: "http://site.test/oferta?utm_source=fb&fbclid=F1&gclid=G1",
      });
      expect(site.vendorRequests, label).toEqual([]);
      await site.context.close();
    }
  });

  it("sem formulário com webhook (ou com o webhook vazio), os IDs de clique fora do repasse não pedem o aviso; ID vazio também não", async () => {
    const cases: [string, string][] = [
      [LINKS, "?fbclid=F1"],
      [lead(""), "?fbclid=F1"],
      [lead("   "), "?fbclid=F1"],
      [lead("http://site.test/hook"), "?fbclid=&utm_source=fb"],
    ];
    for (const [body, query] of cases) {
      const site = await open(pageHtml(config({ forwarding: { enabled: false } }), body, { bodyEnd: RUNTIME }), {
        query,
      });
      await settle(site.page, 400);
      expect(await site.page.locator("os-consent").count()).toBe(0);
      await site.context.close();
    }
  });
});

describe("refix 3: navegação enquanto o pixel carrega", () => {
  const RUNTIME = `<script data-os-runtime>${runtimeScript()}</script>`;
  const BEACON = `(function(){var q=fbq.queue.slice();fbq.queue.length=0;
    fbq.callMethod=function(){var a=[].slice.call(arguments);if(a[0]==="track")navigator.sendBeacon("https://www.facebook.com/tr?ev="+a[1]);};
    q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`;
  const tr = (site: Site) =>
    site.requests
      .filter((u) => u.startsWith("https://www.facebook.com/tr"))
      .map((u) => new URL(u).searchParams.get("ev"));
  const slow = {
    stubs: { [META_URL]: BEACON },
    delay: { [META_URL]: 700 },
    external: { "https://pay.hotmart.com/": "<!doctype html><h1>checkout</h1>" },
    waitUntil: "domcontentloaded" as const,
  };
  const CHECKOUT_RULE = [
    { event: "INITIATE_CHECKOUT" as const, trigger: "CHECKOUT_CLICK" as const, value: null, selector: null },
  ];

  it("botão data-os-href e, 100 ms depois, um link <a> de checkout: a espera vale para os dois e os eventos chegam", async () => {
    const cfg = config({ pixels: [PX.META], rules: CHECKOUT_RULE });
    const body = `<button id="ck" data-os-href="https://pay.hotmart.com/X1">Comprar</button>
      <p><a id="ck2" href="https://pay.hotmart.com/X2">Comprar 2</a></p>`;
    const site = await open(pageHtml(cfg, body, { bodyEnd: RUNTIME }), slow);
    const { page } = site;
    await accept(page);
    await page.waitForTimeout(150);
    await page.click("#ck");
    await page.waitForTimeout(100);
    await page.click("#ck2").catch(() => undefined);
    await page.waitForURL(/pay\.hotmart\.com/);
    await settle(page, 500);
    expect(tr(site)).toEqual(["PageView", "InitiateCheckout"]);
    expect(site.navigations).toEqual(["https://pay.hotmart.com/X1"]);
    await site.context.close();
  });

  it("Safari 13–15.3 (sem requestSubmit nem SubmitEvent.submitter): o reenvio leva o botão clicado (nome/valor e formaction)", async () => {
    const oldSafari = `delete HTMLFormElement.prototype.requestSubmit;
      Object.defineProperty(SubmitEvent.prototype, "submitter", { get() { return undefined }, configurable: true });`;
    const cases: [string, string][] = [
      [`<button id="ouro" name="plano" value="ouro">Ouro</button>`, "https://pay.hotmart.com/X123?off=abc&plano=ouro"],
      [
        `<button id="ouro" name="plano" value="ouro" formaction="https://pay.hotmart.com/X999">Ouro</button>`,
        "https://pay.hotmart.com/X999?off=abc&plano=ouro",
      ],
    ];
    for (const [ouro, expected] of cases) {
      const cfg = config({ consent: { mode: "NOTICE" }, pixels: [PX.META], rules: CHECKOUT_RULE });
      const body = `<form data-os-checkout action="https://pay.hotmart.com/X123"><input type="hidden" name="off" value="abc">
        <button name="plano" value="prata">Prata</button>${ouro}</form>`;
      const site = await open(pageHtml(cfg, body), { ...slow, init: oldSafari });
      const { page } = site;
      await page.waitForTimeout(150);
      await page.click("#ouro");
      await page.waitForURL(/pay\.hotmart\.com/);
      await settle(page, 500);
      expect(site.navigations).toEqual([expected]);
      expect(tr(site)).toEqual(["PageView", "InitiateCheckout"]);
      await site.context.close();
    }
  });
});
