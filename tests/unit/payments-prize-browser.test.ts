/**
 * Prêmio da roleta com "Pagamento na página" (Chromium, sem rede): a página
 * de vendas renderizada como na prévia/ZIP (renderPageHtml + mapa de prêmios)
 * troca os botões de checkout para o produto de pagamento do prêmio
 * (data-os-pay) — e um prêmio com endereço tira o data-os-pay dos botões de
 * pagamento. O endereço/produto vem sempre do mapa embutido.
 */
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderPageHtml } from "@/lib/page-render";
import { runtimeScript } from "@/lib/runtime-bundle";
import { prizeId, prizeParam, type WheelSlice } from "@/lib/wheel";
import { wheelRenderData } from "@/lib/wheel-prizes";

let browser: Browser;
const DAY = 864e5;

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

const PAY_SLICE: WheelSlice = { text: "30% OFF", color: "#000", chance: 50, link: "desconto", coupon: "" };
const URL_SLICE: WheelSlice = { text: "10% OFF", color: "#111", chance: 50, link: "dez", coupon: "" };
const WHEEL = `<div data-os-widget="wheel" data-os-slices='${JSON.stringify([PAY_SLICE, URL_SLICE])}'></div>`;

const SALES =
  '<!DOCTYPE html><html><head><title>Vendas</title></head><body><a id="a" data-os-link="checkout" href="#">Comprar</a><button id="b" data-os-link="checkout">Quero</button></body></html>';

async function salesPage(links: { key: string; url: string; kind: string; pay?: boolean }[], slice: WheelSlice) {
  const html = renderPageHtml(SALES, {
    links,
    wheel: wheelRenderData([WHEEL], links, "oferta-1"),
    pageHref: () => "#",
    runtimeTag: '<script src="/os-runtime.js"></script>',
  });
  const context = await browser.newContext();
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/os-runtime.js") {
      return route.fulfill({ contentType: "application/javascript", body: runtimeScript() });
    }
    if (u.pathname === "/vendas/") return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 204, body: "" });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://site.test/vendas/?os_premio=${prizeParam(prizeId(slice), Date.now() + DAY)}`);
  await page.waitForFunction(() => document.documentElement.classList.contains("os-premio-on"));
  const attrs = (id: string) =>
    page.evaluate((i) => {
      const el = document.getElementById(i) as HTMLElement;
      return {
        pay: el.getAttribute("data-os-pay"),
        href: el.getAttribute("href"),
        osHref: el.getAttribute("data-os-href"),
      };
    }, id);
  return { page, context, errors, attrs };
}

describe("prêmio da roleta e pagamento na página", () => {
  it("botões com endereço passam a abrir o pagamento do prêmio", async () => {
    const links = [
      { key: "checkout", url: "https://pay.exemplo.com/cheio", kind: "CHECKOUT" },
      { key: "desconto", url: "", kind: "CHECKOUT", pay: true },
      { key: "dez", url: "https://pay.exemplo.com/dez", kind: "CHECKOUT" },
    ];
    const s = await salesPage(links, PAY_SLICE);
    expect(await s.attrs("a")).toEqual({ pay: "desconto", href: "#", osHref: null });
    expect(await s.attrs("b")).toEqual({ pay: "desconto", href: null, osHref: null });
    expect(s.errors).toEqual([]);
    await s.context.close();
  });

  it("botões de pagamento com prêmio de endereço: deixam de abrir a janela e levam ao endereço", async () => {
    const links = [
      { key: "checkout", url: "", kind: "CHECKOUT", pay: true },
      { key: "desconto", url: "", kind: "CHECKOUT", pay: true },
      { key: "dez", url: "https://pay.exemplo.com/dez", kind: "CHECKOUT" },
    ];
    const s = await salesPage(links, URL_SLICE);
    expect(await s.attrs("a")).toEqual({ pay: null, href: "https://pay.exemplo.com/dez", osHref: null });
    expect(await s.attrs("b")).toEqual({ pay: null, href: null, osHref: "https://pay.exemplo.com/dez" });
    await s.context.close();

    // E o prêmio de pagamento troca o produto dos botões que já eram de pagamento.
    const p = await salesPage(links, PAY_SLICE);
    expect(await p.attrs("a")).toEqual({ pay: "desconto", href: "#", osHref: null });
    expect(p.errors).toEqual([]);
    await p.context.close();
  });
});
