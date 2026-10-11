/**
 * Trocar a moeda da oferta, visto na PRÉVIA do app (servidor de prévia de
 * verdade, src/preview/server.ts, com o banco de testes) num Chromium: a
 * vitrine da loja e a caixa de compra da página do produto em real antes e em
 * peso mexicano depois (preço, parcelas "sin intereses"), e a janela de
 * pagamento da Kyvo (simulação) cobrando em peso mexicano — o produto estava
 * em euro com cartão e Bizum e ficou com SPEI e cartão (o cartão fica, o SPEI
 * entra e o Bizum, que o peso não aceita, sai). Nada sai para a internet e a
 * prévia nunca chama a Kyvo (nem a falsa).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import * as cheerio from "cheerio";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { restoreDoctype } from "@/lib/doctype";
import { PAYMENT_CONFIG_ID } from "@/lib/payments/contract";
import { createPreviewToken } from "@/lib/preview";
import { switchOfferCurrency } from "@/server/services/offer-currency";
import { createOfferLink } from "@/server/services/offer-links";
import { createOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { savePaymentGatewayKey } from "@/server/services/payments/gateways";
import { savePaymentProduct } from "@/server/services/payments/products";
import { resetDatabase } from "../setup/per-file";
import { type FakeKyvo, KYVO_KEY, startFakeKyvo } from "./kyvo-fake";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PRINTS = process.env.OS_PRINTS_DIR;
let port = 0;
let child: ChildProcess | null = null;
let output = "";
let kyvo: FakeKyvo;
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

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toMatch(/\/offerstudio_test_\d+$/);
  kyvo = await startFakeKyvo();
  port = await freePort();
  child = spawn(path.join(ROOT, "node_modules/.bin/tsx"), ["src/preview/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, PREVIEW_PORT: String(port), OS_KYVO_API_BASE: kyvo.base },
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
  await browser?.close();
  child?.kill("SIGTERM");
  await kyvo?.close();
  expect(kyvo.requests).toEqual([]);
});

beforeEach(async () => {
  await resetDatabase();
});

/** Loja em real (vitrines), página do produto com o "Comprar agora" no pagamento na página (euro, cartão e Bizum). */
async function storeOffer() {
  const offer = await createOffer({ name: "Loja", templateId: "loja", currency: "BRL" });
  const product = await createPage({ offerId: offer.id, name: "Fone", templateId: "produto" });
  const link = await createOfferLink(offer.id, { label: "Checkout", url: "", kind: "CHECKOUT" });
  await savePaymentGatewayKey(offer.id, "KYVO", KYVO_KEY);
  await savePaymentProduct(link.id, {
    name: "Fone de ouvido",
    amount: "497",
    currency: "EUR",
    methods: ["CARD", "BIZUM"],
    locale: "ES",
    thankYouPageId: null,
    accessUrl: "",
  });
  for (const doc of await prisma.pageDocument.findMany({ where: { variant: { pageId: product.id } } })) {
    const $ = cheerio.load(doc.html ?? "");
    $(".os-pb-buy").attr("data-os-link", link.key);
    await prisma.pageDocument.update({
      where: { id: doc.id },
      data: { html: restoreDoctype($.html(), doc.html ?? "") },
    });
  }
  const token = await createPreviewToken({ kind: "offer", offerId: offer.id });
  return { offerId: offer.id, productId: product.id, base: `http://${token}.localhost:${port}` };
}

async function openPreview(url: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const outside: string[] = [];
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname.endsWith(".localhost")) return route.continue();
    outside.push(u.href);
    return route.fulfill({ status: 204, body: "" });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url);
  return { page, outside, errors, close: () => context.close() };
}

/** Preço grande e parcelas do primeiro produto de um seletor (vitrine ou caixa de compra). */
async function shownPrice(page: import("playwright").Page, host: string) {
  const box = page.locator(host).first();
  return {
    now: (await box.locator(".os-pd-now").first().textContent())?.replace(/\s+/g, " ").trim(),
    inst: (await box.locator(".os-pd-inst").first().textContent())?.trim(),
  };
}

const SHOP = '[data-os-widget="products"]';
const BUY = '[data-os-widget="product-buy"]';

describe("prévia depois de trocar a moeda da oferta de real para peso mexicano", () => {
  it("vitrine e caixa de compra mudam de moeda (os números iguais) e a janela da Kyvo cobra em MXN", async () => {
    const o = await storeOffer();

    // Antes: real.
    const store = await openPreview(`${o.base}/`);
    expect(await shownPrice(store.page, SHOP)).toEqual({ now: "R$ 63,76", inst: "4x R$ 15,94 sem juros" });
    if (PRINTS)
      await store.page
        .locator(SHOP)
        .first()
        .screenshot({ path: path.join(PRINTS, "vitrine-antes-real.png") });
    const product = await openPreview(`${o.base}/p/${o.productId}`);
    const before = await shownPrice(product.page, BUY);
    expect(before.now).toBe("R$ 129,90");
    if (PRINTS)
      await product.page.locator(BUY).screenshot({ path: path.join(PRINTS, "caixa-de-compra-antes-real.png") });

    const result = await switchOfferCurrency(o.offerId, "MXN");
    expect(result).toMatchObject({ to: "MXN", payments: 1, paymentProblems: [] });

    // Depois: peso mexicano, os mesmos números, frases em espanhol.
    await store.page.reload();
    expect(await shownPrice(store.page, SHOP)).toEqual({ now: "$63.76", inst: "4x $15.94 sin intereses" });
    expect(await store.page.locator(SHOP).first().innerText()).not.toContain("R$");
    if (PRINTS)
      await store.page
        .locator(SHOP)
        .first()
        .screenshot({ path: path.join(PRINTS, "vitrine-depois-peso-mexicano.png") });
    await product.page.reload();
    const after = await shownPrice(product.page, BUY);
    expect(after.now).toBe("$129.90");
    expect(after.inst).toMatch(/sin intereses$/);
    expect(await product.page.locator(BUY).innerText()).not.toContain("R$");
    if (PRINTS)
      await product.page
        .locator(BUY)
        .screenshot({ path: path.join(PRINTS, "caixa-de-compra-depois-peso-mexicano.png") });

    // O pagamento na página da prévia (simulação) cobra em peso mexicano.
    const config = JSON.parse((await product.page.locator(`#${PAYMENT_CONFIG_ID}`).textContent()) ?? "{}");
    expect(JSON.stringify(config)).toContain('"moeda":"MXN"');
    const created: unknown[] = [];
    product.page.on("response", async (res) => {
      if (res.url().includes("/__os/pagamento") && res.request().method() === "POST") {
        created.push(await res.json().catch(() => null));
      }
    });
    await product.page.locator(".os-pb-buy").first().click();
    const dialog = product.page.getByRole("dialog");
    await expect.poll(() => dialog.isVisible()).toBe(true);
    const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(497);
    expect(await dialog.locator(".os-pw-p").textContent()).toBe(mxn);
    // Euro com cartão e Bizum → peso mexicano com SPEI e cartão: o cartão fica, o SPEI (que o euro não
    // aceitava) entra e o Bizum sai (switchPaymentCurrency).
    await expect
      .poll(() => dialog.locator(".os-pw-m").allTextContents())
      .toEqual([expect.stringContaining("SPEI"), expect.stringContaining("Tarjeta")]);
    await product.page.locator("input[name=nome]").first().fill("María López");
    await product.page.locator("input[name=email]").fill("maria@ejemplo.mx");
    await product.page.getByRole("button", { name: "Generar datos de transferencia" }).click();
    await expect.poll(() => product.page.locator(".os-pw-rows").isVisible()).toBe(true);
    expect(await product.page.locator(".os-pw-rows").innerText()).toContain(mxn);
    expect(created).toEqual([expect.objectContaining({ ok: true, valor: 49_700, moeda: "MXN", simulacao: true })]);
    if (PRINTS) await product.page.screenshot({ path: path.join(PRINTS, "janela-pagamento-previa-mxn.png") });

    expect([...store.outside, ...product.outside]).toEqual([]);
    expect([...store.errors, ...product.errors]).toEqual([]);
    await store.close();
    await product.close();
  }, 90_000);
});
