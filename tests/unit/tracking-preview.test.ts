/**
 * Fase 4 — rastreamento no servidor de prévia (src/preview/server.ts):
 * configuração no modo "preview" e "test", /os-tracking.js, cookie do modo
 * teste pelo funil e o endereço POST /__os/pixel-test.
 *
 * Sobe o servidor de prévia de verdade numa porta livre, apontando para o banco
 * de testes desta execução. A parte no navegador recusa/simula qualquer endereço
 * fora da prévia (nada vai para a internet).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { request } from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createPreviewToken } from "@/lib/preview";
import type { TrackingRuntimeConfig } from "@/lib/tracking/runtime-config";
import { createOfferLink } from "@/server/services/offer-links";
import { saveOfferSettings, savePageSeo } from "@/server/services/offer-settings";
import { createOffer } from "@/server/services/offers";
import { savePageCode } from "@/server/services/page-code";
import { createPage } from "@/server/services/pages";
import { createPixelTestSession, endPixelTestSession } from "@/server/services/pixel-test";
import { createEventRule, createPixel, savePageCodeCategory, saveTrackingSettings } from "@/server/services/tracking";
import { createVariant } from "@/server/services/variants";
import { resetDatabase } from "../setup/per-file";

const ROOT = path.resolve(import.meta.dirname, "../..");
const META_TOKEN = "EAAGm0PX4ZCpsBAKZCZBy1234567890abcdefghijklmnopqrstuvwxyz";
let port = 0;
let child: ChildProcess | null = null;
let output = "";
let browser: Browser;

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = (srv.address() as { port: number }).port;
      srv.close(() => resolve(p));
    });
  });
}

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function call(
  token: string,
  pathname: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method: opts.method ?? "GET",
        headers: { host: `${token}.localhost:${port}`, ...(opts.headers ?? {}) },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

function configOf(html: string): TrackingRuntimeConfig {
  const m = /<script type="application\/json" id="os-tracking">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error(`sem configuração de rastreamento:\n${html.slice(0, 500)}`);
  return JSON.parse(m[1]);
}

function origin(token: string) {
  return `http://${token}.localhost:${port}`;
}

function post(token: string, body: unknown, headers: Record<string, string> = {}) {
  return call(token, "/__os/pixel-test", {
    method: "POST",
    headers: { origin: origin(token), "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeAll(async () => {
  // Nunca o banco real: o servidor recebe o banco de testes desta execução.
  expect(process.env.DATABASE_URL).toMatch(/\/offerstudio_test_\d+$/);
  port = await freePort();
  child = spawn(path.join(ROOT, "node_modules/.bin/tsx"), ["src/preview/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, PREVIEW_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (c) => {
    output += String(c);
  });
  child.stderr?.on("data", (c) => {
    output += String(c);
  });
  const deadline = Date.now() + 30_000;
  while (!output.includes("servidor de prévia")) {
    if (Date.now() > deadline || child.exitCode !== null) throw new Error(`prévia não subiu:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  child?.kill("SIGTERM");
  await browser?.close();
});

beforeEach(async () => {
  await resetDatabase();
});

const PAGE_HTML =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Oferta</title></head><body><h1>Oferta</h1><a id="obrigado" href="os-page:__OBRIGADO__">Obrigado</a><a data-os-link="checkout" href="#">Comprar</a></body></html>';

async function trackedOffer() {
  const offer = await createOffer({ name: "Oferta" });
  const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
  const obrigado = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
  const legal = await createPage({ offerId: offer.id, name: "Política", type: "LEGAL" });
  await prisma.pageDocument.updateMany({
    where: { variant: { pageId: home.id } },
    data: { html: PAGE_HTML.replace("__OBRIGADO__", obrigado.id) },
  });
  await createOfferLink(offer.id, { label: "Checkout", url: "https://pay.hotmart.com/X1", kind: "CHECKOUT" });
  await createPixel(offer.id, {
    vendor: "META",
    pixelId: "123456789012345",
    accessToken: META_TOKEN,
    options: { capi: true },
  });
  await createEventRule(offer.id, { event: "VIEW_CONTENT", trigger: "TIME_ON_PAGE", value: 10 });
  await createEventRule(offer.id, { pageId: obrigado.id, event: "PURCHASE", trigger: "PAGE_LOAD" });
  await saveTrackingSettings(offer.id, {
    consent: { policyPageId: legal.id },
    customCode: { head: "<script>window.offerCode=1</script>", category: "MARKETING" },
  });
  await savePageCode(home.id, { bodyEnd: "<script>window.pageCode=1</script>" });
  await savePageCodeCategory(home.id, "ANALYTICS");
  return { offerId: offer.id, homeId: home.id, obrigadoId: obrigado.id, legalId: legal.id };
}

describe("páginas na prévia", () => {
  it("modo preview: configuração da oferta (sem token), script de rastreamento e códigos em espera", async () => {
    const o = await trackedOffer();
    const token = await createPreviewToken({ kind: "offer", offerId: o.offerId });
    const res = await call(token, "/");
    expect(res.status).toBe(200);
    const cfg = configOf(res.body);
    expect(cfg.mode).toBe("preview");
    expect(cfg.test).toBeNull();
    expect(cfg.server).toBeNull();
    expect(cfg.pixels).toEqual([{ vendor: "META", id: "123456789012345", options: {} }]);
    expect(cfg.rules).toEqual([{ event: "VIEW_CONTENT", trigger: "TIME_ON_PAGE", value: 10, selector: null }]);
    expect(cfg.checkoutLinkKeys).toEqual(["checkout"]);
    expect(cfg.consent.policyUrl).toBe(`/p/${o.legalId}`);
    expect(res.body).not.toContain(META_TOKEN);
    expect(res.body).toContain('<script src="/os-tracking.js" data-os-tracking></script>');
    expect(res.body.indexOf('id="os-tracking"')).toBeLessThan(res.body.indexOf("<title>"));
    // Códigos em espera: em JSON (sem "<"), nunca num <template> (o Firefox pré-carrega imagens de dentro dele).
    expect(res.body).toContain(
      '<script type="application/json" data-os-consent="marketing" data-os-block>"\\u003cscript\\u003ewindow.offerCode=1\\u003c/script\\u003e"</script>',
    );
    expect(res.body).toContain(
      '<script type="application/json" data-os-consent="analytics" data-os-block>"\\u003cscript\\u003ewindow.pageCode=1\\u003c/script\\u003e"</script>',
    );
    expect(res.body).not.toContain("<template data-os-consent");
    expect(res.body).toContain('href="https://pay.hotmart.com/X1"');
    expect(res.headers["set-cookie"]).toBeUndefined();

    // Outra página do funil: regras dela entram.
    const thanks = configOf((await call(token, `/p/${o.obrigadoId}`)).body);
    expect(thanks.rules.map((r) => r.event)).toEqual(["VIEW_CONTENT", "PURCHASE"]);

    const js = await call(token, "/os-tracking.js");
    expect(js.status).toBe(200);
    expect(js.headers["content-type"]).toMatch(/javascript/);
  });

  it("prévia de um documento (editor) também recebe a configuração; clone não", async () => {
    const o = await trackedOffer();
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: o.obrigadoId } } });
    const token = await createPreviewToken({ kind: "document", documentId: doc.id });
    const cfg = configOf((await call(token, "/")).body);
    expect(cfg.mode).toBe("preview");
    expect(cfg.rules.map((r) => r.event)).toEqual(["VIEW_CONTENT", "PURCHASE"]);
  });

  it("prévia de uma versão A/B (oferta e documento) manda a versão para o rastreamento", async () => {
    const o = await trackedOffer();
    // Página com uma versão só: nenhuma versão nos eventos.
    const single = await createPreviewToken({ kind: "offer", offerId: o.offerId });
    expect(configOf((await call(single, "/")).body).variant ?? null).toBeNull();

    const b = await createVariant({ pageId: o.homeId });
    const offerB = await createPreviewToken({ kind: "offer", offerId: o.offerId, pageId: o.homeId, variantId: b.id });
    expect(configOf((await call(offerB, "/")).body).variant).toMatchObject({ name: "B", folder: "oferta-b/" });
    // Outra página do funil abre na versão de controle dela (uma versão só).
    expect(configOf((await call(offerB, `/p/${o.obrigadoId}`)).body).variant ?? null).toBeNull();

    const control = await createPreviewToken({ kind: "offer", offerId: o.offerId, pageId: o.homeId });
    expect(configOf((await call(control, "/")).body).variant).toMatchObject({ name: "A" });

    expect(b.documentId).toBeTruthy();
    const docB = await createPreviewToken({ kind: "document", documentId: b.documentId as string });
    expect(configOf((await call(docB, "/")).body).variant).toMatchObject({ name: "B" });
  });
});

describe("dados da empresa na prévia", () => {
  it("troca {{EMPRESA}}, {{CNPJ}}… (escapados) na oferta e no documento; campo vazio deixa o marcador; código livre fica igual", async () => {
    const o = await trackedOffer();
    const legalHtml =
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p id="dados">{{EMPRESA}} · CNPJ {{CNPJ}} · {{EMAIL}}</p></body></html>';
    await prisma.pageDocument.updateMany({ where: { variant: { pageId: o.legalId } }, data: { html: legalHtml } });
    await savePageCode(o.legalId, { bodyEnd: "<script>window.marker='{{EMPRESA}}'</script>" });
    await saveOfferSettings(o.offerId, { company: { name: "Loja <Boa> & Cia", document: "12.345.678/0001-90" } });

    const token = await createPreviewToken({ kind: "offer", offerId: o.offerId });
    const offerPage = (await call(token, `/p/${o.legalId}`)).body;
    expect(offerPage).toContain("Loja &#60;Boa&#62; &#38; Cia · CNPJ 12.345.678/0001-90 · {{EMAIL}}");
    expect(offerPage).toContain("window.marker='{{EMPRESA}}'");

    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: o.legalId } } });
    const docToken = await createPreviewToken({ kind: "document", documentId: doc.id });
    expect((await call(docToken, "/")).body).toContain("Loja &#60;Boa&#62; &#38; Cia · CNPJ 12.345.678/0001-90");
  });
});

describe("SEO na prévia", () => {
  it("título, descrição, favicon, noindex e idioma da oferta valem na prévia; o SEO da página vale na página", async () => {
    const o = await trackedOffer();
    const sha = "cd".repeat(32);
    await prisma.asset.create({
      data: { offerId: o.offerId, sha256: sha, key: `a/cd/${sha}.webp`, kind: "IMAGE", mime: "image/webp", bytes: 10 },
    });
    await saveOfferSettings(o.offerId, {
      language: "en",
      seo: { title: "Método X", description: "Aprenda em 7 dias", faviconKey: `a/cd/${sha}.webp`, noindex: true },
    });
    await savePageSeo(o.obrigadoId, { title: "Obrigado pela compra" });

    const token = await createPreviewToken({ kind: "offer", offerId: o.offerId });
    const home = (await call(token, "/")).body;
    expect(home).toContain("<title>Método X</title>");
    expect(home).not.toContain("<title>Oferta</title>");
    expect(home).toMatch(/<html[^>]*\slang="en"/);
    expect(home).toContain('<meta name="description" content="Aprenda em 7 dias">');
    expect(home).toContain(`<link rel="icon" href="/os-assets/${sha}.webp">`);
    expect(home).toContain('<meta name="robots" content="noindex, nofollow">');
    // O rastreamento continua o primeiro do <head> (antes do título).
    expect(home.indexOf('id="os-tracking"')).toBeLessThan(home.indexOf("<title>"));

    const thanks = (await call(token, `/p/${o.obrigadoId}`)).body;
    expect(thanks).toContain("<title>Obrigado pela compra</title>");
    expect(thanks).toContain('<meta name="description" content="Aprenda em 7 dias">');

    // Prévia de um documento (editor): o mesmo SEO.
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: o.obrigadoId } } });
    const docToken = await createPreviewToken({ kind: "document", documentId: doc.id });
    expect((await call(docToken, "/")).body).toContain("<title>Obrigado pela compra</title>");
  });

  it('idioma não escolhido (padrão): a página clonada em inglês continua com lang="en"', async () => {
    const o = await trackedOffer();
    await prisma.pageDocument.updateMany({
      where: { variant: { pageId: o.obrigadoId } },
      data: {
        html: '<!DOCTYPE html><html lang="en"><head><title>Thanks</title></head><body><h1>Thanks!</h1></body></html>',
      },
    });
    await saveOfferSettings(o.offerId, { company: { name: "ACME" }, seo: { title: "Método X" } });
    const token = await createPreviewToken({ kind: "offer", offerId: o.offerId });
    const page = (await call(token, `/p/${o.obrigadoId}`)).body;
    expect(page).toMatch(/<html lang="en">/);
    expect(page).toContain("<title>Método X</title>");

    await saveOfferSettings(o.offerId, { language: "es" });
    expect((await call(token, `/p/${o.obrigadoId}`)).body).toMatch(/<html lang="es">/);
  });
});

describe("modo teste (?os_teste=)", () => {
  it("token válido liga o modo teste e guarda o cookie; o funil continua em teste", async () => {
    const o = await trackedOffer();
    const session = await createPixelTestSession(o.offerId);
    const url = new URL(session.url);
    const token = url.hostname.split(".")[0];
    // Entra no modo teste: grava o cookie e volta para o mesmo endereço SEM o token
    // (ele não vai no endereço que os pixels mandam às plataformas); as UTMs ficam.
    const first = await call(token, `/?utm_source=fb&os_teste=${session.token}&fbclid=F1`);
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe("/?utm_source=fb&fbclid=F1");
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.body).not.toContain(session.token);
    expect((await call(token, `/p/${o.obrigadoId}?os_teste=${session.token}`)).headers.location).toBe(
      `/p/${o.obrigadoId}`,
    );
    const cookie = String(first.headers["set-cookie"]);
    const landed = await call(token, "/?utm_source=fb&fbclid=F1", { headers: { cookie: `os_teste=${session.token}` } });
    expect(landed.status).toBe(200);
    const cfg = configOf(landed.body);
    expect(cfg.mode).toBe("test");
    expect(cfg.test).toEqual({ endpoint: "/__os/pixel-test", token: session.token });
    expect(cookie).toMatch(new RegExp(`^os_teste=${session.token}; Path=/; Max-Age=\\d+; HttpOnly; SameSite=Lax`));
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
    expect(maxAge).toBeGreaterThan(7000);
    expect(maxAge).toBeLessThanOrEqual(7200);

    const next = await call(token, `/p/${o.obrigadoId}`, { headers: { cookie: `x=1; os_teste=${session.token}` } });
    expect(configOf(next.body).mode).toBe("test");
    expect(next.headers["set-cookie"]).toBeUndefined();
    // Sem cookie nem parâmetro: prévia normal.
    expect(configOf((await call(token, `/p/${o.obrigadoId}`)).body).mode).toBe("preview");
  });

  it("token vencido ou de outra oferta na URL → página explicando; no cookie → prévia normal e cookie apagado", async () => {
    const o = await trackedOffer();
    const other = await trackedOffer();
    const otherSession = await createPixelTestSession(other.offerId);
    const token = await createPreviewToken({ kind: "offer", offerId: o.offerId });
    const wrong = await call(token, `/?os_teste=${otherSession.token}`);
    expect(wrong.status).toBe(410);
    expect(wrong.body).toContain("Este teste de pixels terminou");
    expect(wrong.body).not.toContain("os-tracking");

    const session = await createPixelTestSession(o.offerId);
    await endPixelTestSession(session.id);
    expect((await call(token, `/?os_teste=${session.token}`)).status).toBe(410);
    const viaCookie = await call(token, "/", { headers: { cookie: `os_teste=${session.token}` } });
    expect(viaCookie.status).toBe(200);
    expect(configOf(viaCookie.body).mode).toBe("preview");
    expect(String(viaCookie.headers["set-cookie"])).toMatch(/^os_teste=; Path=\/; Max-Age=0/);
  });
});

describe("POST /__os/pixel-test", () => {
  async function setup() {
    const o = await trackedOffer();
    const session = await createPixelTestSession(o.offerId);
    const token = new URL(session.url).hostname.split(".")[0];
    const report = { token: session.token, vendor: "META", event: "PageView", status: "FIRED", detail: { n: 1 } };
    return { ...o, session, token, report };
  }

  it("grava um passo válido da mesma origem (JSON ou texto do sendBeacon)", async () => {
    const t = await setup();
    const res = await post(t.token, t.report);
    expect(res.status).toBe(204);
    const beacon = await post(
      t.token,
      { ...t.report, event: "load", status: "LOADED" },
      {
        "content-type": "text/plain;charset=UTF-8",
      },
    );
    expect(beacon.status).toBe(204);
    // Sem Origin, mas o navegador diz que é da mesma origem.
    const noOrigin = await call(t.token, "/__os/pixel-test", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ ...t.report, vendor: "CONSENT", event: "accept" }),
    });
    expect(noOrigin.status).toBe(204);
    const events = await prisma.pixelTestEvent.findMany({ orderBy: { id: "asc" } });
    expect(events.map((e) => [e.vendor, e.event, e.status])).toEqual([
      ["META", "PageView", "FIRED"],
      ["META", "load", "LOADED"],
      ["CONSENT", "accept", "FIRED"],
    ]);
    expect(events[0].detail).toEqual({ n: 1 });
  });

  it("recusa outra origem, corpo grande, JSON inválido, formato errado, outra oferta e teste vencido", async () => {
    const t = await setup();
    expect((await post(t.token, t.report, { origin: "https://site-malicioso.com" })).status).toBe(403);
    expect((await post(t.token, t.report, { origin: origin("outratoken") })).status).toBe(403);
    const crossNoOrigin = await call(t.token, "/__os/pixel-test", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" },
      body: JSON.stringify(t.report),
    });
    expect(crossNoOrigin.status).toBe(403);
    expect((await post(t.token, t.report, { "content-type": "application/x-www-form-urlencoded" })).status).toBe(415);
    const big = await post(t.token, { ...t.report, detail: { a: "x".repeat(5000) } });
    expect(big.status).toBe(413);
    const bad = await post(t.token, "{não é json");
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body).error).toBe("Passo do teste em formato inválido.");
    expect((await post(t.token, { ...t.report, status: "OK" })).status).toBe(400);

    // Sessão de outra oferta mandada pela prévia desta oferta.
    const other = await trackedOffer();
    const otherSession = await createPixelTestSession(other.offerId);
    const wrong = await post(t.token, { ...t.report, token: otherSession.token });
    expect(wrong.status).toBe(403);
    expect(JSON.parse(wrong.body).error).toBe("Este teste é de outra oferta.");

    await endPixelTestSession(t.session.id);
    expect((await post(t.token, t.report)).status).toBe(410);
    expect(await prisma.pixelTestEvent.count()).toBe(0);

    // Outros métodos/caminhos continuam recusados; prévia de clone não tem teste.
    expect((await call(t.token, "/outra", { method: "POST", body: "{}" })).status).toBe(405);
    expect((await call(t.token, "/__os/pixel-test", { method: "PUT", body: "{}" })).status).toBe(405);
    const clone = await createPreviewToken({ kind: "clone", jobId: "x", device: "desktop", mode: "EDITABLE" });
    expect((await post(clone, t.report)).status).toBe(404);
  });

  it("no navegador: a página em modo teste manda passos (fetch e sendBeacon) e o cookie segue pelo funil", async () => {
    const t = await setup();
    const context = await browser.newContext();
    const page = await context.newPage();
    const previewOrigin = origin(t.token);
    const outside: string[] = [];
    // Nada sai da prévia: pixels/CDNs recebem um script vazio simulado.
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(`${previewOrigin}/`)) return route.continue();
      outside.push(url);
      return route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
    });
    const landed = await page.goto(`${previewOrigin}/?os_teste=${t.session.token}&utm_source=fb`);
    // O token sai do endereço (location.href é o que os pixels mandam às plataformas):
    // um redirecionamento (302) não deixa o endereço com o token no histórico.
    expect(landed?.request().redirectedFrom()?.url()).toBe(
      `${previewOrigin}/?os_teste=${t.session.token}&utm_source=fb`,
    );
    expect(page.url()).toBe(`${previewOrigin}/?utm_source=fb`);
    expect(await page.evaluate(() => location.href)).not.toContain("os_teste");
    const cfg = await page.evaluate(() => JSON.parse(document.getElementById("os-tracking")?.textContent ?? "null"));
    expect(cfg.mode).toBe("test");
    // Cookie HttpOnly: a página não lê o token por document.cookie.
    expect(await page.evaluate(() => document.cookie)).not.toContain("os_teste");

    const status = await page.evaluate(async (report) => {
      const res = await fetch("/__os/pixel-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...report, event: "teste-fetch" }),
      });
      return res.status;
    }, t.report);
    expect(status).toBe(204);
    const queued = await page.evaluate(
      (report) => navigator.sendBeacon("/__os/pixel-test", JSON.stringify({ ...report, event: "teste-beacon" })),
      t.report,
    );
    expect(queued).toBe(true);
    // (O script de rastreamento da página também manda os passos dele: conta só os deste teste.)
    await expect
      .poll(() => prisma.pixelTestEvent.count({ where: { event: { in: ["teste-fetch", "teste-beacon"] } } }), {
        timeout: 5000,
      })
      .toBe(2);

    await page.click("#obrigado");
    // Link do funil: as UTMs da chegada seguem junto (o token não: ele fica no cookie).
    await page.waitForURL(`${previewOrigin}/p/${t.obrigadoId}?utm_source=fb`, { timeout: 5000 });
    const next = await page.evaluate(() => JSON.parse(document.getElementById("os-tracking")?.textContent ?? "null"));
    expect(next.mode).toBe("test");
    expect(next.test.token).toBe(t.session.token);
    expect(outside.every((u) => !u.startsWith("http://127.0.0.1"))).toBe(true);
    await context.close();
  });

  it("cadeia completa: o script de rastreamento da página informa os passos ao painel", async () => {
    const t = await setup();
    // Sem banner: os pixels (simulados) carregam direto.
    await saveTrackingSettings(t.offerId, { consent: { mode: "OFF" } });
    const context = await browser.newContext();
    const page = await context.newPage();
    const previewOrigin = origin(t.token);
    const outside: string[] = [];
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(`${previewOrigin}/`)) return route.continue();
      outside.push(url);
      return route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
    });
    await page.goto(`${previewOrigin}/?os_teste=${t.session.token}`);
    await expect
      .poll(() => prisma.pixelTestEvent.count({ where: { sessionId: t.session.id, vendor: "RUNTIME" } }), {
        timeout: 8000,
      })
      .toBeGreaterThan(0);
    // Pixel carregado (passo "load") e PageView disparado, no formato do contrato.
    const steps = async () =>
      (await prisma.pixelTestEvent.findMany({ where: { sessionId: t.session.id }, orderBy: { id: "asc" } })).map(
        (e) => `${e.vendor}/${e.event}/${e.status}`,
      );
    await expect
      .poll(steps, { timeout: 8000 })
      .toEqual(expect.arrayContaining(["META/load/LOADED", "META/PageView/FIRED"]));
    await context.close();
  });
});
