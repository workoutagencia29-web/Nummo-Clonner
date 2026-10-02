/**
 * Medir o teste A/B (Fase 6) num Chromium de verdade.
 *
 * 1. O ZIP de verdade (oferta de export-fixture.ts com as versões A e B, mais
 *    GA4 e checkouts de outras plataformas), descompactado e servido por um
 *    servidor HTTP que faz o papel do PHP no eventos.php:
 *    - cada versão manda a letra dela em todos os eventos: Meta (custom_data
 *      os_versao no fbq), GA4 (propriedade de usuário, parâmetro do page_view e
 *      dos eventos no dataLayer), TikTok (properties) e eventos.php (os_versao);
 *    - checkout: Hotmart/Kiwify recebem src=versao-<letra>, as outras
 *      utm_content=versao-<letra> — só quando o parâmetro não existe (nem no
 *      link nem vindo do visitante); sck/xcod e o que o link já tem ficam;
 *    - página com uma versão só (upsell): nada de versão.
 * 2. A marca no checkout em detalhe (script das páginas direto, sem ZIP):
 *    domínio próprio da Hotmart, parâmetro vazio, formulário GET, repasse
 *    desligado e o "Recusar" (a marca não depende de consentimento).
 * 3. Modo teste ("Testar pixels"): a página informa a versão no passo de
 *    abertura e em cada evento, num formato que o servidor aceita.
 */
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { renderPageHtml } from "@/lib/page-render";
import { inlineTrackingScriptTag } from "@/lib/runtime-bundle";
import { storagePath } from "@/lib/storage";
import { composeTrackingConfig, type TrackingSource } from "@/lib/tracking/compose";
import { loadTracking } from "@/lib/tracking/config";
import { injectTracking } from "@/lib/tracking/inject";
import { PIXEL_TEST_ENDPOINT } from "@/lib/tracking/runtime-config";
import { parseTrackingSettings } from "@/lib/tracking/schema";
import { parsePixelTestReport } from "@/lib/tracking/test-report";
import { vendorEventName } from "@/lib/tracking/vendors";
import { startExport } from "@/server/services/export";
import { claimNextExport, exportFileKey, runExportJob } from "@/server/services/export/jobs";
import { createPixel } from "@/server/services/tracking";
import { resetDatabase } from "../setup/per-file";
import { createExportFixture, type ExportFixture, removeExportFiles, unzipTo } from "./export-fixture";

const GA4_ID = "G-ABC123DEF4";
const MONETIZZE_URL = "https://app.monetizze.com.br/checkout/DXYZ123?pv=1";
const GA4_CHECKOUT = vendorEventName("GA4", "INITIATE_CHECKOUT") as string;

/** Botões a mais nas duas versões da página inicial (checkouts de várias plataformas). */
const EXTRA_BUTTONS = [
  '<a id="mz" data-os-link="monetizze" href="#">Monetizze (link da oferta)</a>',
  '<a id="kiwify" href="https://pay.kiwify.com.br/AbC1?sck=meu-sck">Kiwify com sck</a>',
  '<a id="eduzz" href="https://sun.eduzz.com/12345">Eduzz</a>',
  '<a id="hotmart-src" href="https://pay.hotmart.com/Z9?src=bio&amp;sck=s1&amp;xcod=x1">Hotmart com src</a>',
  '<a id="mz-utm" href="https://app.monetizze.com.br/checkout/DXYZ123?utm_content=meu-criativo">Monetizze com utm_content</a>',
].join("\n");

// ─── Servidor de arquivos (como a hospedagem) ────────────────────────────────

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  png: "image/png",
  woff2: "font/woff2",
  json: "application/json",
};

interface Site {
  base: string;
  /** Corpo de cada POST ao eventos.php. */
  beacons: Record<string, unknown>[];
  close: () => Promise<void>;
}

async function serveDir(root: string): Promise<Site> {
  const beacons: Record<string, unknown>[] = [];
  const server: Server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        if (pathname === "/eventos.php") beacons.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        res.writeHead(pathname === "/eventos.php" ? 204 : 405);
        res.end();
      });
      return;
    }
    void (async () => {
      let file = path.join(root, pathname);
      if ((await stat(file).catch(() => null))?.isDirectory()) file = path.join(file, "index.html");
      const info = await stat(file).catch(() => null);
      if (!file.startsWith(root) || !info?.isFile() || file.endsWith(".php")) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[file.split(".").pop() ?? ""] ?? "application/octet-stream" });
      createReadStream(file).pipe(res);
    })();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    beacons,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

// ─── Plataformas (versões locais que anotam cada chamada) ────────────────────

const REC = "var c=window.__calls=window.__calls||[];var A=function(a){return [].slice.call(a)};";
const STUBS: Record<string, string> = {
  "https://connect.facebook.net/": `(function(){${REC}c.push(["load","META"]);
    var q=fbq.queue.slice();fbq.queue.length=0;
    fbq.callMethod=function(){c.push(["fbq"].concat(A(arguments)))};
    q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`,
  "https://analytics.tiktok.com/": `(function(){${REC}c.push(["load","TIKTOK"]);
    if(ttq.__stub)return;ttq.__stub=1;var q=ttq.splice(0);
    q.forEach(function(a){c.push(["ttq"].concat(a))});
    ["page","track","grantConsent","revokeConsent"].forEach(function(m){ttq[m]=function(){c.push(["ttq",m].concat(A(arguments)))}});})();`,
  "https://www.googletagmanager.com/": `(function(){${REC}c.push(["load","GTAG"]);})();`,
};
const CHECKOUT_HOSTS =
  /^(pay\.hotmart\.com|pay\.kiwify\.com\.br|sun\.eduzz\.com|app\.monetizze\.com\.br|checkout\.minhaloja\.com\.br)$/;

let browser: Browser;

/**
 * Visitante novo, sem sair para a internet. `stay`: o checkout responde 204 (o
 * navegador fica na página e dá para ler as chamadas depois do clique).
 */
async function newContext(random?: number, stay = false): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route(
    (url) => /^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1",
    async (route) => {
      const url = new URL(route.request().url());
      const stub = Object.entries(STUBS).find(([prefix]) => url.href.startsWith(prefix));
      if (stub) return route.fulfill({ status: 200, contentType: "text/javascript", body: stub[1] });
      if (CHECKOUT_HOSTS.test(url.hostname)) {
        if (stay) return route.fulfill({ status: 204 });
        return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Checkout</h1>" });
      }
      return route.abort();
    },
  );
  if (random !== undefined) await context.addInitScript(`Math.random = () => ${random};`);
  return context;
}

type Call = unknown[];
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls?: Call[] }).__calls ?? []);
/** dataLayer do Google como listas (cada item é o `arguments` de um gtag(...)). */
const dataLayer = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? []).map((a) => Array.from(a)),
  );
/** Endereço completo do link (relativo resolvido pela página). */
const href = (page: Page, sel: string) =>
  page
    .locator(sel)
    .evaluate((a) => (a as HTMLAnchorElement).href)
    .then((h) => new URL(h));
const query = (url: URL) => Object.fromEntries(url.searchParams);

async function accept(page: Page) {
  await page.getByRole("button", { name: "Aceitar" }).click();
}

// ─── 1. O ZIP de verdade ─────────────────────────────────────────────────────

let fx: ExportFixture;
let dir = "";
let site: Site;

beforeAll(async () => {
  await resetDatabase();
  fx = await createExportFixture();
  await createPixel(fx.offerId, { vendor: "GA4", pixelId: GA4_ID });
  await prisma.offerLink.create({
    data: {
      offerId: fx.offerId,
      key: "monetizze",
      label: "Monetizze",
      url: MONETIZZE_URL,
      kind: "CHECKOUT",
      position: 1,
    },
  });
  const docs = await prisma.pageDocument.findMany({
    where: { variant: { pageId: fx.homeId } },
    select: { id: true, html: true },
  });
  for (const d of docs) {
    await prisma.pageDocument.update({
      where: { id: d.id },
      data: { html: (d.html ?? "").replace("</body>", `${EXTRA_BUTTONS}\n</body>`) },
    });
  }
  const { exportId } = await startExport(fx.offerId, { serverEvents: true });
  await claimNextExport();
  await runExportJob(exportId);
  dir = await mkdtemp(path.join(os.tmpdir(), "os-ab-measure-"));
  await unzipTo(storagePath(exportFileKey(fx.offerId, exportId)), dir);
  site = await serveDir(dir);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await site?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
  await removeExportFiles();
  await resetDatabase();
});

describe("ZIP com as versões A e B", () => {
  it.each([
    ["A", 0.1],
    ["B", 0.9],
  ])("versão %s (pelo divisor): a letra vai na Meta, no GA4, no TikTok e no eventos.php", async (letter, random) => {
    site.beacons.length = 0;
    const context = await newContext(random);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${site.base}?utm_source=facebook&fbclid=AbC123`);
    await page.waitForURL(new RegExp(`/oferta-${letter.toLowerCase()}/\\?`));
    await accept(page);

    const version = { os_versao: letter };
    await expect
      .poll(async () => (await calls(page)).some((c) => c[0] === "fbq" && c[1] === "track" && c[2] === "PageView"))
      .toBe(true);
    // Meta: custom_data do PageView.
    const pv = (await calls(page)).find((c) => c[0] === "fbq" && c[2] === "PageView") as Call;
    expect(pv[3]).toEqual(version);
    // GA4: propriedade de usuário antes do config, e o page_view (o do config) com o parâmetro.
    const layer = await dataLayer(page);
    const userProps = layer.findIndex((a) => a[0] === "set" && a[1] === "user_properties");
    const config = layer.findIndex((a) => a[0] === "config" && a[1] === GA4_ID);
    expect(layer[userProps]).toEqual(["set", "user_properties", version]);
    expect(layer[config]).toEqual(["config", GA4_ID, version]);
    expect(userProps).toBeLessThan(config);
    // eventos.php: o PageView com a versão.
    await expect.poll(() => site.beacons.length).toBeGreaterThan(0);
    expect(site.beacons[0]).toMatchObject({ event: "PAGE_VIEW", os_versao: letter });

    // Checkout da Hotmart (link da oferta): src com a versão; InitiateCheckout em todas com a versão.
    const before = site.beacons.length;
    await page.click("#comprar");
    await page.waitForURL(/^https:\/\/pay\.hotmart\.com\//);
    const checkout = new URL(page.url());
    expect(checkout.searchParams.get("src")).toBe(`versao-${letter.toLowerCase()}`);
    expect(checkout.searchParams.get("off")).toBe("abc");
    expect(checkout.searchParams.get("utm_source")).toBe("facebook");
    expect(checkout.searchParams.has("sck")).toBe(false);
    await expect.poll(() => site.beacons.length).toBeGreaterThan(before);
    expect(site.beacons.slice(before).find((b) => b.event === "INITIATE_CHECKOUT")).toMatchObject({
      os_versao: letter,
      event_name: { META: "InitiateCheckout", TIKTOK: "InitiateCheckout" },
    });
    expect(errors).toEqual([]);
    await context.close();
  });

  it("InitiateCheckout no navegador: Meta (custom_data), TikTok (properties) e GA4 (parâmetro) com a versão", async () => {
    // O checkout responde 204: o navegador fica na página depois do clique.
    const context = await newContext(undefined, true);
    const page = await context.newPage();
    await page.goto(`${site.base}oferta-b/`);
    await accept(page);
    await expect.poll(async () => (await calls(page)).some((c) => c[0] === "load" && c[1] === "TIKTOK")).toBe(true);
    await page.click("#comprar");
    await expect
      .poll(async () => (await calls(page)).some((c) => c[0] === "fbq" && c[2] === "InitiateCheckout"))
      .toBe(true);
    const all = await calls(page);
    const meta = all.find((c) => c[0] === "fbq" && c[2] === "InitiateCheckout") as Call;
    expect(meta[3]).toEqual({ os_versao: "B" });
    expect((meta[4] as { eventID: string }).eventID).toMatch(/^[0-9a-f-]{36}$/);
    await expect
      .poll(async () =>
        (await calls(page)).some((c) => c[0] === "ttq" && c[1] === "track" && c[2] === "InitiateCheckout"),
      )
      .toBe(true);
    const tiktok = (await calls(page)).find((c) => c[0] === "ttq" && c[1] === "track") as Call;
    expect(tiktok[3]).toEqual({ os_versao: "B" });
    // O PageView do TikTok (ttq.page) não aceita parâmetros.
    expect((await calls(page)).find((c) => c[0] === "ttq" && c[1] === "page")).toEqual(["ttq", "page"]);
    const ga = (await dataLayer(page)).find((a) => a[0] === "event" && a[1] === GA4_CHECKOUT);
    expect(ga?.[2]).toMatchObject({ send_to: GA4_ID, os_versao: "B" });
    await context.close();
  });

  it("marca no checkout: src (Hotmart/Kiwify/Eduzz) ou utm_content (as outras), nunca por cima do que existe", async () => {
    const context = await newContext();
    const page = await context.newPage();
    // Sem utm_content na chegada. A marca não espera o "Aceitar" (só diz a versão vista).
    await page.goto(`${site.base}oferta-b/?utm_source=google`);
    await page.waitForLoadState("load");
    expect(query(await href(page, "#comprar"))).toEqual({ off: "abc", utm_source: "google", src: "versao-b" });
    expect(query(await href(page, "#mz"))).toEqual({ pv: "1", utm_source: "google", utm_content: "versao-b" });
    expect(query(await href(page, "#kiwify"))).toEqual({ sck: "meu-sck", utm_source: "google", src: "versao-b" });
    expect(query(await href(page, "#eduzz"))).toEqual({ utm_source: "google", src: "versao-b" });
    // O link já tem src (e sck/xcod): nada muda.
    expect(query(await href(page, "#hotmart-src"))).toEqual({
      src: "bio",
      sck: "s1",
      xcod: "x1",
      utm_source: "google",
    });
    expect(query(await href(page, "#mz-utm"))).toEqual({ utm_content: "meu-criativo", utm_source: "google" });
    // Links do funil não levam marca.
    expect((await href(page, "#ir-upsell")).searchParams.has("src")).toBe(false);
    expect((await href(page, "#ir-upsell")).searchParams.has("utm_content")).toBe(false);
    await context.close();
  });

  it("o visitante chegou com utm_content (anúncio, nome|ID) ou src: ficam como vieram, sem a versão", async () => {
    const context = await newContext();
    const page = await context.newPage();
    await page.goto(
      `${site.base}oferta-b/?utm_source=FB&utm_content=${encodeURIComponent("AD01|1234567890")}&src=insta`,
    );
    await page.waitForLoadState("load");
    await accept(page);
    const mz = query(await href(page, "#mz"));
    expect(mz.utm_content).toBe("AD01|1234567890");
    const hotmart = query(await href(page, "#comprar"));
    expect(hotmart.src).toBe("insta");
    expect(hotmart.utm_content).toBe("AD01|1234567890");
    // A Kiwify recebe o src que veio; o utm_content do anúncio vai junto, intacto.
    expect(query(await href(page, "#kiwify"))).toMatchObject({ src: "insta", sck: "meu-sck" });
    await context.close();
  });

  it("página com uma versão só (upsell): nenhum evento com versão, checkout sem marca", async () => {
    site.beacons.length = 0;
    const context = await newContext();
    const page = await context.newPage();
    await page.goto(`${site.base}upsell/`);
    await accept(page);
    await expect.poll(async () => (await calls(page)).some((c) => c[0] === "fbq" && c[2] === "PageView")).toBe(true);
    const pv = (await calls(page)).find((c) => c[0] === "fbq" && c[2] === "PageView") as Call;
    expect(pv[3]).toEqual({});
    expect((await dataLayer(page)).some((a) => a[0] === "set" && a[1] === "user_properties")).toBe(false);
    expect((await dataLayer(page)).find((a) => a[0] === "config" && a[1] === GA4_ID)).toEqual(["config", GA4_ID]);
    await expect.poll(() => site.beacons.length).toBeGreaterThan(0);
    expect("os_versao" in site.beacons[0]).toBe(false);
    expect(query(await href(page, "#comprar"))).toEqual({ off: "abc" });
    await context.close();
  });
});

// ─── 2. A marca em detalhe ───────────────────────────────────────────────────

function source(over: Partial<TrackingSource> = {}): TrackingSource {
  return {
    mode: "live",
    settings: parseTrackingSettings({}),
    pixels: [],
    rules: [],
    links: [],
    pageId: "p1",
    policyUrl: null,
    variant: { name: "C", folder: "oferta-c/" },
    ...over,
  };
}

async function servePage(html: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/oferta-c/`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const LINKS = `
<a id="own" data-os-checkout href="https://checkout.minhaloja.com.br/p/1?checkoutMode=10">Hotmart em domínio próprio</a>
<a id="empty" href="https://app.monetizze.com.br/checkout/K1?utm_content=&amp;pv=2#topo">utm_content vazio</a>
<a id="hash" href="https://pay.hotmart.com/H1#pagar">Hotmart com âncora</a>
<button id="btn" data-os-href="https://pay.kiwify.com.br/K2">Botão Kiwify</button>
<form id="form" action="https://app.monetizze.com.br/checkout/K3" method="get"><input name="pv" value="3"><button id="enviar">Comprar</button></form>`;

const pageWith = (over: Partial<TrackingSource>) =>
  injectTracking(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Versão C</title></head><body>${LINKS}</body></html>`,
    composeTrackingConfig(source(over)),
    inlineTrackingScriptTag(),
  );

describe("marca da versão no checkout (script das páginas)", () => {
  it("domínio próprio da Hotmart (checkoutMode) → src; parâmetro vazio preenchido no lugar; âncora mantida; botão data-os-href", async () => {
    const served = await servePage(pageWith({}));
    const context = await newContext();
    const page = await context.newPage();
    await page.goto(served.url);
    await page.waitForLoadState("load");
    expect(await page.locator("#own").getAttribute("href")).toBe(
      "https://checkout.minhaloja.com.br/p/1?checkoutMode=10&src=versao-c",
    );
    expect(await page.locator("#empty").getAttribute("href")).toBe(
      "https://app.monetizze.com.br/checkout/K1?utm_content=versao-c&pv=2#topo",
    );
    expect(await page.locator("#hash").getAttribute("href")).toBe("https://pay.hotmart.com/H1?src=versao-c#pagar");
    expect(await page.locator("#btn").getAttribute("data-os-href")).toBe("https://pay.kiwify.com.br/K2?src=versao-c");
    // Formulário GET: a marca vai como campo escondido (o navegador troca a query do action).
    await page.click("#enviar");
    await page.waitForURL(/^https:\/\/app\.monetizze\.com\.br\//);
    expect(query(new URL(page.url()))).toEqual({ pv: "3", utm_content: "versao-c" });
    await context.close();
    await served.close();
  });

  it("repasse desligado (ou só para o funil): a marca continua; o “Recusar” não a tira", async () => {
    const settings = parseTrackingSettings({});
    const served = await servePage(
      pageWith({ settings: { ...settings, forwarding: { ...settings.forwarding, enabled: false } } }),
    );
    const context = await newContext();
    const page = await context.newPage();
    await page.goto(`${served.url}?utm_source=ig`);
    await page.waitForLoadState("load");
    expect(await page.locator("#hash").getAttribute("href")).toBe("https://pay.hotmart.com/H1?src=versao-c#pagar");
    await context.close();
    await served.close();

    const noCheckout = await servePage(
      pageWith({
        settings: { ...settings, forwarding: { ...settings.forwarding, toCheckout: false } },
        pixels: [{ vendor: "META", pixelId: "123456789012345", enabled: true, options: {} }],
      }),
    );
    const ctx2 = await newContext();
    const p2 = await ctx2.newPage();
    await p2.goto(`${noCheckout.url}?utm_source=ig`);
    await p2.getByRole("button", { name: "Recusar" }).click();
    expect(await p2.locator("#hash").getAttribute("href")).toBe("https://pay.hotmart.com/H1?src=versao-c#pagar");
    await ctx2.close();
    await noCheckout.close();
  });
});

// ─── 3. Modo teste ("Testar pixels") ─────────────────────────────────────────

describe("modo teste: a página informa a versão", () => {
  it("passo de abertura com versão e pasta, eventos com os_versao — no formato que o servidor aceita", async () => {
    const variantB = await prisma.pageVariant.findFirstOrThrow({
      where: { pageId: fx.homeId, name: "B" },
      select: { id: true, documents: { select: { html: true } } },
    });
    const token = "abcdefghijklmnopqrstuvwxyz";
    const loaded = await loadTracking({
      offerId: fx.offerId,
      pageId: fx.homeId,
      mode: "test",
      test: { endpoint: PIXEL_TEST_ENDPOINT, token },
      pageHref: (id) => `/p/${id}`,
      variantId: variantB.id,
    });
    expect(loaded?.config.variant).toMatchObject({ name: "B", folder: "oferta-b/" });
    const html = renderPageHtml(variantB.documents[0].html ?? "", {
      links: [],
      pageHref: (id) => `/p/${id}`,
      runtimeTag: "",
      tracking: loaded ? { config: loaded.config, scriptTag: inlineTrackingScriptTag() } : null,
    });
    const reports: unknown[] = [];
    const server = createServer((req, res) => {
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          if (req.url === PIXEL_TEST_ENDPOINT) reports.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          res.writeHead(204);
          res.end();
        });
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const context = await newContext();
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    await expect.poll(() => reports.some((r) => (r as { event: string }).event === "START")).toBe(true);
    const start = parsePixelTestReport(reports.find((r) => (r as { event: string }).event === "START"));
    expect(start).toMatchObject({ vendor: "RUNTIME", event: "START", detail: { versao: "B", pasta: "oferta-b/" } });
    await accept(page);
    await expect
      .poll(() => reports.some((r) => (r as { vendor: string; event: string }).event === "PageView"))
      .toBe(true);
    const meta = reports.map(parsePixelTestReport).find((r) => r?.vendor === "META" && r.event === "PageView");
    expect(meta?.detail).toMatchObject({ os_versao: "B", event: "PAGE_VIEW" });
    // Todos os passos passam na validação do servidor (/__os/pixel-test).
    expect(reports.every((r) => parsePixelTestReport(r) !== null)).toBe(true);
    await context.close();
    await new Promise<void>((r) => server.close(() => r()));
  });
});
