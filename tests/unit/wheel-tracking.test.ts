/**
 * Eventos da roleta de desconto nos pixels (src/runtime/tracking/wheel.ts) num
 * Chromium sem internet, como os do quiz: a página leva a roleta, o script das
 * páginas e o de rastreamento, e os scripts das plataformas são trocados por
 * versões locais que anotam cada chamada em window.__calls.
 *
 * Confere: RoletaGirou/RoletaResgatou na Meta e no TikTok e roleta_girou/
 * roleta_resgatou no GA4, com o texto do prêmio (nada da pessoa) e o mesmo
 * eventID; nada antes do "Aceitar" (o giro feito antes sai depois); nada com
 * "Recusar"; desligado na roleta, nada sai; versão do teste A/B nos
 * parâmetros; o "Resgatar" leva as UTMs e o prêmio para a página de vendas.
 */
import path from "node:path";
import { buildSync } from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defToHtml } from "@/editor/widgets/quiz-content";
import { DEFAULT_WHEEL, WHEEL_CSS, wheelDef } from "@/editor/widgets/wheel-content";
import { runtimeScript } from "@/lib/runtime-bundle";
import { injectTracking } from "@/lib/tracking/inject";
import type { PixelTestReport, TrackingRuntimeConfig } from "@/lib/tracking/runtime-config";
import { DEFAULT_FORWARD_PARAMS, PIXEL_VENDORS, TRACKING_EVENTS } from "@/lib/tracking/schema";
import { vendorEventName } from "@/lib/tracking/vendors";
import type { WheelSlice } from "@/lib/wheel";

const SCRIPT = buildSync({
  entryPoints: [path.join(process.cwd(), "src/runtime/tracking/index.ts")],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2018", "safari13"],
  write: false,
  legalComments: "none",
}).outputFiles[0].text;
const TAG = `<script data-os-tracking>${SCRIPT}</script>`;

const NAMES = Object.fromEntries(
  PIXEL_VENDORS.map((v) => [v, Object.fromEntries(TRACKING_EVENTS.map((e) => [e, vendorEventName(v, e)]))]),
) as TrackingRuntimeConfig["names"];

const META = { vendor: "META" as const, id: "123456789012345", options: {} };
const TIKTOK = { vendor: "TIKTOK" as const, id: "C1ABCDEFGHIJ2KLMNOPQ", options: {} };
const GA4 = { vendor: "GA4" as const, id: "G-ABC123DEF4", options: {} };
const KWAI = { vendor: "KWAI" as const, id: "283746592837465", options: {} };

function config(over: Partial<TrackingRuntimeConfig> = {}, consentMode: "OPT_IN" | "NOTICE" = "OPT_IN") {
  const cfg: TrackingRuntimeConfig = {
    v: 1,
    mode: "live",
    pixels: [META, TIKTOK, GA4, KWAI],
    rules: [],
    names: NAMES,
    value: { currency: "BRL", amount: null },
    checkoutLinkKeys: [],
    checkoutHosts: [],
    marketingCode: false,
    server: null,
    test: null,
    ...over,
    consent: {
      mode: consentMode,
      text: "Usamos cookies.",
      acceptLabel: "Aceitar",
      rejectLabel: "Recusar",
      noticeLabel: "Entendi",
      policyLabel: "Política de privacidade",
      position: "bottom",
      theme: "dark",
      policyUrl: null,
    },
    forwarding: {
      enabled: true,
      params: [...DEFAULT_FORWARD_PARAMS],
      toCheckout: true,
      toInternalLinks: true,
      persistDays: 30,
    },
  };
  return cfg;
}

/** Página com a roleta (prêmio "30% OFF" garantido, "Resgatar" indo para /vendas/), os dois scripts e a configuração. */
function pageHtml(cfg: TrackingRuntimeConfig, opts: { track?: boolean } = {}) {
  const slices: WheelSlice[] = [
    { text: "30% OFF", color: "#ec4899", chance: 100, link: "c30", coupon: "" },
    { text: "Não foi dessa vez", color: "#64748b", chance: 1, link: "", coupon: "", lose: true },
  ];
  let wheel = defToHtml(wheelDef({ ...DEFAULT_WHEEL, slices }, { html: true })).replace(
    'href="#" data-os-link=""',
    'href="/vendas/"',
  );
  if (opts.track === false) wheel = wheel.replace('data-os-track="1"', 'data-os-track="0"');
  const base = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Roleta</title><style>${WHEEL_CSS}</style></head><body>${wheel}<script data-os-runtime>${runtimeScript()}</script></body></html>`;
  return injectTracking(base, cfg, TAG);
}

const REC = "var c=window.__calls=window.__calls||[];var A=function(a){return [].slice.call(a)};";
const STUBS: Record<string, string> = {
  "https://connect.facebook.net/en_US/fbevents.js": `(function(){${REC}c.push(["load","META"]);
    var q=fbq.queue.slice();fbq.queue.length=0;
    fbq.callMethod=function(){c.push(["fbq"].concat(A(arguments)))};
    q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`,
  "https://analytics.tiktok.com/i18n/pixel/events.js": `(function(){${REC}
    if(ttq.__stub)return;ttq.__stub=1;var q=ttq.splice(0);
    q.forEach(function(a){c.push(["ttq"].concat(a))});
    ["page","track"].forEach(function(m){ttq[m]=function(){c.push(["ttq",m].concat(A(arguments)))}});})();`,
  "https://s1.kwai.net/kos/s101/nlav11187/pixel/events.js": `(function(){${REC}c.push(["load","KWAI"]);
    var id=new URL(document.currentScript.src).searchParams.get("sdkid");
    (kwaiq._i[id]||[]).splice(0).forEach(function(a){c.push(["kwaiq:"+id].concat(a))});
    kwaiq.instance=function(p){return {track:function(){c.push(["kwaiq:"+p,"track"].concat(A(arguments)))}}};})();`,
  "https://www.googletagmanager.com/gtag/js": `(function(){${REC}c.push(["load","GTAG"]);})();`,
};

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

interface Site {
  page: Page;
  reports: PixelTestReport[];
  close: () => Promise<void>;
}

async function open(html: string, query = ""): Promise<Site> {
  // Menos movimento: a roda vai direto para a fatia (o teste não espera 5 s).
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const reports: PixelTestReport[] = [];
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === "http://site.test") {
      if (url.pathname === "/roleta") return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
      if (url.pathname === "/__os/pixel-test") {
        reports.push(JSON.parse(req.postData() ?? "{}"));
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: "<!doctype html><h1>Vendas</h1>" });
    }
    const stub = Object.keys(STUBS).find((prefix) => req.url().startsWith(prefix));
    if (stub) return route.fulfill({ contentType: "application/javascript", body: STUBS[stub] });
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto(`http://site.test/roleta${query}`);
  return { page, reports, close: () => context.close() };
}

type Call = unknown[];
const calls = (page: Page): Promise<Call[]> => page.evaluate(() => (window as { __calls?: Call[] }).__calls ?? []);
const wheelCalls = async (page: Page) =>
  (await calls(page)).filter((c) => JSON.stringify(c).includes("Roleta")).map((c) => [c[0], c[1], c[2], c[3]]);
const gaWheel = (page: Page) =>
  page.evaluate(() =>
    ((window as { dataLayer?: IArguments[] }).dataLayer ?? [])
      .map((a) => Array.from(a))
      .filter((a) => a[0] === "event" && String(a[1]).startsWith("roleta_")),
  );

/** Gira (com a animação mais curta: menos movimento) e espera o resultado. */
async function spin(page: Page) {
  await page.locator("[data-os-wh-spin]").click();
  await expect.poll(() => page.locator("[data-os-wh-result]").isVisible(), { timeout: 3000 }).toBe(true);
}

describe("eventos da roleta nos pixels", () => {
  it("Pedir permissão: o giro espera o Aceitar; depois giro e resgate saem na Meta, TikTok e GA4 com o prêmio", async () => {
    const site = await open(pageHtml(config()), "?utm_source=facebook&utm_campaign=roleta");
    const { page } = site;
    await spin(page);
    await page.waitForTimeout(200);
    expect(await wheelCalls(page)).toEqual([]);
    await page.getByRole("button", { name: "Aceitar" }).click();
    await expect
      .poll(() => wheelCalls(page))
      .toContainEqual(["fbq", "trackCustom", "RoletaGirou", { roleta_premio: "30% OFF" }]);

    // Resgatar: o evento sai e o link leva as UTMs e o prêmio à página de vendas.
    await page.evaluate(() => document.addEventListener("click", (e) => e.preventDefault()));
    await page.locator("[data-os-wh-go]").click({ force: true });
    await expect
      .poll(() => wheelCalls(page))
      .toContainEqual(["fbq", "trackCustom", "RoletaResgatou", { roleta_premio: "30% OFF" }]);
    const all = await calls(page);
    const meta = all.filter((c) => c[0] === "fbq" && c[1] === "trackCustom");
    const tiktok = all.filter((c) => c[0] === "ttq" && c[1] === "track" && String(c[2]).startsWith("Roleta"));
    expect(tiktok.map((c) => c[2])).toEqual(["RoletaGirou", "RoletaResgatou"]);
    expect((meta[0][4] as { eventID: string }).eventID).toBe((tiktok[0][4] as { event_id: string }).event_id);
    const ga = await gaWheel(page);
    expect(ga.map((a) => a[1])).toEqual(["roleta_girou", "roleta_resgatou"]);
    expect(ga[0][2]).toMatchObject({ send_to: GA4.id, roleta_premio: "30% OFF" });
    expect(all.filter((c) => String(c[0]).startsWith("kwaiq") && JSON.stringify(c).includes("Roleta"))).toEqual([]);

    const href = (await page.locator("[data-os-wh-go]").getAttribute("href")) ?? "";
    const url = new URL(href, "http://site.test/");
    expect(url.pathname).toBe("/vendas/");
    expect(url.searchParams.get("utm_source")).toBe("facebook");
    expect(url.searchParams.get("os_premio")).toMatch(/^c30-[0-9a-z]{1,6}\.[0-9a-z]+$/);
    await site.close();
  }, 30_000);

  it("Recusar: nada da roleta sai (a tela de teste mostra o bloqueio)", async () => {
    const cfg = config({ mode: "test", test: { endpoint: "/__os/pixel-test", token: "abcdefghijklmnopqrstuvwxyz" } });
    const site = await open(pageHtml(cfg));
    const { page } = site;
    await page.getByRole("button", { name: "Recusar" }).click();
    await spin(page);
    await page.waitForTimeout(200);
    expect(await wheelCalls(page)).toEqual([]);
    await expect
      .poll(() => site.reports.filter((r) => r.vendor === "CONSENT" && r.status === "BLOCKED").map((r) => r.event))
      .toContain("RoletaGirou");
    await site.close();
  }, 30_000);

  it("Só avisar + teste A/B: sai na hora com a versão; com o rastreamento desligado na roleta, nada", async () => {
    const cfg = config({ variant: { name: "B", folder: "roleta-b/", srcHosts: [] } }, "NOTICE");
    const site = await open(pageHtml(cfg));
    await spin(site.page);
    await expect
      .poll(() => wheelCalls(site.page))
      .toContainEqual(["fbq", "trackCustom", "RoletaGirou", { roleta_premio: "30% OFF", os_versao: "B" }]);
    await site.close();

    const off = await open(pageHtml(config({}, "NOTICE"), { track: false }));
    await spin(off.page);
    await off.page.waitForTimeout(300);
    expect(await wheelCalls(off.page)).toEqual([]);
    expect(await gaWheel(off.page)).toEqual([]);
    await off.close();
  }, 30_000);
});

describe("“Recusar” tira o ID de clique do “Resgatar” (antes ou depois do giro)", () => {
  const QUERY = "?utm_source=fb&fbclid=ABC123";
  /** Clica no "Resgatar" (o aviso de cookies pode cobrir o botão no celular) e devolve a página de vendas. */
  async function redeem(page: Page) {
    await page.locator("[data-os-wh-go]").evaluate((el) => (el as HTMLElement).click());
    await page.waitForURL((u) => u.pathname === "/vendas/");
    return new URL(page.url());
  }
  const reject = (page: Page) => page.getByRole("button", { name: "Recusar" }).click();

  it("recusar e depois girar", async () => {
    const site = await open(pageHtml(config()), QUERY);
    await reject(site.page);
    await spin(site.page);
    const url = await redeem(site.page);
    expect(url.searchParams.get("fbclid")).toBeNull();
    expect(url.searchParams.get("utm_source")).toBe("fb");
    expect(url.searchParams.get("os_premio")).toMatch(/^c30-/);
    await site.close();
  }, 30_000);

  it("girar sem escolher (o ID de clique segue nos links do funil) e depois recusar", async () => {
    const site = await open(pageHtml(config()), QUERY);
    await spin(site.page);
    // Sem escolha ainda: o "Resgatar" já aparece completo (UTMs e o ID de clique, como os outros links do funil).
    const before = new URL(
      (await site.page.locator("[data-os-wh-go]").getAttribute("href")) ?? "",
      "http://site.test/",
    );
    expect(before.searchParams.get("fbclid")).toBe("ABC123");
    expect(before.searchParams.get("os_premio")).toMatch(/^c30-/);
    await reject(site.page);
    const url = await redeem(site.page);
    expect(url.searchParams.get("fbclid")).toBeNull();
    expect(url.searchParams.get("utm_source")).toBe("fb");
    expect(url.searchParams.get("os_premio")).toMatch(/^c30-/);
    await site.close();
  }, 30_000);

  it("voltar à roleta já girada e recusar", async () => {
    const site = await open(pageHtml(config()), QUERY);
    await spin(site.page);
    await site.page.reload();
    expect(await site.page.locator("[data-os-wh-result]").isVisible()).toBe(true);
    await reject(site.page);
    const url = await redeem(site.page);
    expect(url.searchParams.get("fbclid")).toBeNull();
    expect(url.searchParams.get("os_premio")).toMatch(/^c30-/);
    await site.close();
  }, 30_000);
});
