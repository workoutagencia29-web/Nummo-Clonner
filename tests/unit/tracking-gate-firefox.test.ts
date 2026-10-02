/**
 * Fase 4 — refix 4: código em espera no Firefox de verdade (Playwright).
 *
 * O pré-carregamento do Firefox busca <img>, <img srcset>, <picture><source>,
 * <video poster> e <image> do SVG de dentro de um <template> do HTML — o pixel
 * de imagem da Meta (facebook.com/tr?ev=PageView) saía antes de qualquer
 * escolha e de novo depois do "Recusar". O código em espera agora vai em JSON
 * num <script type="application/json"> (gateCode): nenhum pedido antes do
 * "Aceitar" nem depois do "Recusar"; depois do "Aceitar", tudo carrega.
 *
 * Caminho real da prévia/ZIP: composeTrackingConfig + renderPageHtml (modo
 * live, "Pedir permissão") com o script de rastreamento embutido.
 */
import { type Browser, type BrowserContext, firefox, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CategorizedCode, renderPageHtml } from "@/lib/page-render";
import { inlineTrackingScriptTag } from "@/lib/runtime-bundle";
import { composeTrackingConfig } from "@/lib/tracking/compose";
import { parseTrackingSettings } from "@/lib/tracking/schema";

const FB_IMG = "https://www.facebook.com/tr?id=123456789012345&ev=PageView&noscript=1";
const T = "https://tracker.test/";
/** Pixel de imagem, <img srcset>, <picture>, poster, <image> do SVG e um script: tudo o que o Firefox pré-carregava. */
const IMAGE_CODE = [
  `<img height="1" width="1" style="display:none" src="${FB_IMG}">`,
  `<img alt="" srcset="${T}srcset.gif 1x">`,
  `<picture><source srcset="${T}pic.webp"><img src="${T}pic.jpg" alt=""></picture>`,
  `<video poster="${T}poster.jpg"></video>`,
  `<svg width="10" height="10"><image href="${T}svg.png" width="10" height="10"/></svg>`,
  "<script>window.__ran = (window.__ran || 0) + 1</script>",
].join("");
/** O que precisa ter sido pedido depois do "Aceitar" (o <picture> usa a primeira fonte). */
const AFTER_ACCEPT = ["facebook.com/tr", "srcset.gif", "pic.webp", "poster.jpg", "svg.png"];

const SITE = "http://site.test";

function page(code: { offer?: CategorizedCode | null; page?: CategorizedCode | null }) {
  const settings = parseTrackingSettings({ customCode: code.offer ?? {} });
  const config = composeTrackingConfig({
    mode: "live",
    settings,
    pixels: [{ vendor: "META", pixelId: "123456789012345", enabled: true, options: {} }],
    rules: [],
    links: [],
    pageId: "p1",
    policyUrl: null,
    test: null,
    serverEndpoint: null,
  });
  expect(config.consent.mode).toBe("OPT_IN");
  return renderPageHtml(
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Oferta</title></head><body><h1>Oferta</h1></body></html>',
    {
      links: [],
      pageHref: (id) => `/p/${id}`,
      runtimeTag: "",
      customCode: code.page ?? null,
      tracking: { config, scriptTag: inlineTrackingScriptTag(), offerCode: settings.customCode },
    },
  );
}

let browser: Browser;

beforeAll(async () => {
  browser = await firefox.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

interface Site {
  page: Page;
  context: BrowserContext;
  /** Pedidos para fora do site (pixels, imagens, scripts das plataformas). */
  requests: string[];
  errors: string[];
}

async function open(html: string): Promise<Site> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const site: Site = { page, context, requests: [], errors: [] };
  page.on("pageerror", (e) => site.errors.push(String(e)));
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(SITE)) {
      return url === `${SITE}/oferta`
        ? route.fulfill({ contentType: "text/html; charset=utf-8", body: html })
        : route.fulfill({ status: 404, body: "" });
    }
    site.requests.push(url);
    if (url.startsWith("https://connect.facebook.net/")) {
      return route.fulfill({ contentType: "application/javascript", body: "window.__fbevents = 1" });
    }
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto(`${SITE}/oferta`, { waitUntil: "load" });
  return site;
}

const banner = (p: Page) => p.locator("os-consent").getByRole("region", { name: "Aviso de cookies" });
const button = (p: Page, name: string) => p.locator("os-consent").getByRole("button", { name, exact: true });

describe("Firefox: código em espera não pede nada antes do “Aceitar” nem depois do “Recusar”", () => {
  const cases: [string, { offer?: CategorizedCode; page?: CategorizedCode }, string[]][] = [
    ["código da oferta (Marketing)", { offer: { bodyEnd: IMAGE_CODE, category: "MARKETING" } }, AFTER_ACCEPT],
    // No <head> o <video> não é desenhado: o poster não carrega nem depois do "Aceitar" (como sem o aviso).
    [
      "código da oferta no <head> (Estatística)",
      { offer: { head: IMAGE_CODE, category: "ANALYTICS" } },
      AFTER_ACCEPT.filter((f) => f !== "poster.jpg"),
    ],
    // Sem categoria escolhida: o pixel da Meta faz o código esperar (automático).
    [
      "código da página (automático)",
      { page: { head: "", bodyStart: IMAGE_CODE, bodyEnd: "", category: null } },
      AFTER_ACCEPT,
    ],
  ];

  for (const [label, code, afterAccept] of cases) {
    it(label, async () => {
      const html = page(code);

      // Antes de qualquer escolha.
      const site = await open(html);
      await banner(site.page).waitFor();
      await site.page.waitForTimeout(500);
      expect(site.requests).toEqual([]);
      expect(await site.page.evaluate(() => (window as { __ran?: number }).__ran)).toBeUndefined();

      // "Recusar" e a página de novo (o pixel saía outra vez a cada visita).
      await button(site.page, "Recusar").click();
      await site.page.waitForTimeout(200);
      await site.page.reload({ waitUntil: "load" });
      await site.page.waitForTimeout(500);
      expect(await site.page.evaluate(() => (window as { osConsent?: { get(): string } }).osConsent?.get())).toBe(
        "rejected",
      );
      expect(site.requests).toEqual([]);
      expect(await site.page.evaluate(() => (window as { __ran?: number }).__ran)).toBeUndefined();
      expect(site.errors).toEqual([]);
      await site.context.close();

      // "Aceitar": o pixel da Meta e todo o código carregam, uma vez.
      const accepted = await open(html);
      await banner(accepted.page).waitFor();
      await accepted.page.waitForTimeout(300);
      expect(accepted.requests).toEqual([]);
      await button(accepted.page, "Aceitar").click();
      await expect.poll(() => accepted.page.evaluate(() => (window as { __ran?: number }).__ran)).toBe(1);
      for (const part of [...afterAccept, "connect.facebook.net/en_US/fbevents.js"]) {
        await expect.poll(() => accepted.requests.some((u) => u.includes(part)), { message: part }).toBe(true);
      }
      expect(accepted.requests.filter((u) => u === FB_IMG)).toHaveLength(1);
      expect(await accepted.page.locator("[data-os-consent]").count()).toBe(0);
      expect(accepted.errors).toEqual([]);
      await accepted.context.close();
      // Em espera em JSON, nunca num <template>.
      expect(html).not.toContain("<template");
    });
  }

  it("código-base oficial da Meta (<img> dentro de <noscript>): nada antes do “Aceitar”; depois, o <noscript> continua sem carregar", async () => {
    const meta = `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','123456789012345');fbq('track','PageView');</script><noscript><img height="1" width="1" style="display:none" src="${FB_IMG}"/></noscript>`;
    const site = await open(page({ page: { head: meta, bodyStart: "", bodyEnd: "", category: null } }));
    await banner(site.page).waitFor();
    await site.page.waitForTimeout(500);
    expect(site.requests).toEqual([]);
    await button(site.page, "Aceitar").click();
    await expect.poll(() => site.requests.some((u) => u.startsWith("https://connect.facebook.net/"))).toBe(true);
    await site.page.waitForTimeout(300);
    expect(site.requests.filter((u) => u === FB_IMG)).toEqual([]);
    await site.context.close();
  });

  it("formato antigo (<template data-os-consent>, HTML exportado antes) continua ligando depois do “Aceitar”", async () => {
    const legacy = page({}).replace(
      "<h1>Oferta</h1>",
      `<h1>Oferta</h1><template data-os-consent="marketing"><p id="antigo">ok</p><script>window.__legacy = 1</script></template>`,
    );
    const site = await open(legacy);
    await banner(site.page).waitFor();
    expect(await site.page.locator("#antigo").count()).toBe(0);
    await button(site.page, "Aceitar").click();
    await expect.poll(() => site.page.evaluate(() => (window as { __legacy?: number }).__legacy)).toBe(1);
    expect(await site.page.locator("#antigo").count()).toBe(1);
    await site.context.close();
  });
});
