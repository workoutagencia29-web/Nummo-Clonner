/**
 * Pagamento na página de ponta a ponta na PRÉVIA do app (simulação): sobe o
 * servidor de prévia de verdade (src/preview/server.ts) com o banco de testes
 * e abre a oferta num Chromium. O comprador clica em "Comprar", a janela abre
 * (com o aviso da prévia), gera o SPEI de exemplo, "Simular pagamento
 * aprovado" leva à página de obrigado com ?pedido= e o bloco "Acesso ao
 * produto" mostra o link de acesso — que nunca está no HTML. Cartão simulado:
 * recusado → outro cartão → aprovado. Nada sai para a internet (nem o SDK da
 * Kyvo) e a prévia nunca chama a Kyvo (nem a falsa).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_CSS, accessDef } from "@/editor/widgets/access-content";
import { defToHtml } from "@/editor/widgets/quiz-content";
import { prisma } from "@/lib/db";
import { createPreviewToken } from "@/lib/preview";
import { createOfferLink } from "@/server/services/offer-links";
import { createOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { savePaymentGatewayKey } from "@/server/services/payments/gateways";
import { savePaymentProduct } from "@/server/services/payments/products";
import { resetDatabase } from "../setup/per-file";
import { type FakeKyvo, KYVO_KEY, startFakeKyvo } from "./kyvo-fake";

const ROOT = path.resolve(import.meta.dirname, "../..");
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

const SALES =
  '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Oferta</title></head><body><h1>Curso</h1><a id="comprar" data-os-link="checkout" href="https://pay.hotmart.com/ANTIGO" style="display:inline-block;padding:16px;background:#db2777;color:#fff">Comprar</a></body></html>';
const THANKS = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Obrigado</title><style>${ACCESS_CSS}</style></head><body>${defToHtml(accessDef("es"))}</body></html>`;
const ACCESS_URL = "https://membros.exemplo.com/reposteria";

async function paymentOffer() {
  const offer = await createOffer({ name: "Oferta" });
  const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
  const thanks = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
  await prisma.pageDocument.updateMany({ where: { variant: { pageId: home.id } }, data: { html: SALES } });
  await prisma.pageDocument.updateMany({ where: { variant: { pageId: thanks.id } }, data: { html: THANKS } });
  const link = await createOfferLink(offer.id, { label: "Checkout", url: "", kind: "CHECKOUT" });
  await savePaymentGatewayKey("KYVO", KYVO_KEY);
  await savePaymentProduct(link.id, {
    name: "Curso de Repostería",
    amount: "497",
    currency: "MXN",
    methods: ["SPEI", "CARD"],
    locale: "ES",
    thankYouPageId: thanks.id,
    accessUrl: ACCESS_URL,
  });
  const token = await createPreviewToken({ kind: "offer", offerId: offer.id });
  return { thanksId: thanks.id, base: `http://${token}.localhost:${port}` };
}

async function openPreview(url: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
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

async function fill(page: Page) {
  await page.locator("input[name=nome]").fill("María López");
  await page.locator("input[name=email]").fill("maria@ejemplo.mx");
}

describe("pagamento na prévia (simulação) de ponta a ponta", () => {
  it("SPEI simulado → aprovado → página de obrigado com o acesso", async () => {
    const o = await paymentOffer();
    const s = await openPreview(`${o.base}/`);
    const { page } = s;
    const html = await page.content();
    expect(html).not.toContain(ACCESS_URL);
    expect(html).not.toContain("pay.hotmart.com/ANTIGO");
    await page.locator("#comprar").click();
    await expect.poll(() => page.getByRole("dialog").isVisible()).toBe(true);
    expect(await page.locator(".os-pw-sim").first().textContent()).toContain("Prévia do Offer Studio: nada é cobrado");
    await fill(page);
    await page.getByRole("button", { name: "Generar datos de transferencia" }).click();
    await expect.poll(() => page.locator(".os-pw-rows").isVisible()).toBe(true);
    expect(await page.locator(".os-pw-r dd").nth(2).textContent()).toContain("SIMULACIÓN");
    expect(await page.locator(".os-pw-st").textContent()).toBe("Esperando tu transferencia…");
    await page.getByRole("button", { name: "Simular pagamento aprovado" }).click();
    await expect.poll(() => page.locator(".os-pw-h").textContent()).toBe("¡Pago confirmado!");
    // O script do <head> tira o ?pedido= do endereço (credencial do acesso) e o guarda para o bloco.
    await page.waitForURL(new RegExp(`/p/${o.thanksId}$`), { timeout: 10_000 });
    await expect.poll(() => page.locator("[data-os-ac-go]").isVisible(), { timeout: 10_000 }).toBe(true);
    expect(await page.locator("[data-os-ac-go]").getAttribute("href")).toBe(ACCESS_URL);
    expect(await page.locator("[data-os-ac-ok] h2").textContent()).toBe("¡Pago confirmado! 🎉");

    // A página de obrigado aberta direto (sem pedido, em outra aba/navegador) não dá acesso.
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(`${o.base}/p/${o.thanksId}`);
    await expect.poll(() => page.locator("[data-os-ac-none]").isVisible()).toBe(true);
    expect(await page.locator("[data-os-ac-go]").getAttribute("href")).toBe("#");
    expect(s.outside).toEqual([]);
    expect(s.errors).toEqual([]);
    await s.close();
  }, 60_000);

  it("cartão simulado: sem SDK; recusado → outro cartão → aprovado", async () => {
    const o = await paymentOffer();
    const s = await openPreview(`${o.base}/`);
    const { page } = s;
    await page.locator("#comprar").click();
    await page.locator(".os-pw-m", { hasText: "Tarjeta" }).click();
    await fill(page);
    await page.getByRole("button", { name: "Continuar al pago" }).click();
    await expect.poll(() => page.locator(".os-pw-fake").isVisible()).toBe(true);
    await page.getByRole("button", { name: "Simular pagamento recusado" }).click();
    await expect.poll(() => page.locator(".os-pw-h").textContent()).toBe("Pago no aprobado");
    await page.getByRole("button", { name: "Intentar con otra tarjeta" }).click();
    await expect.poll(() => page.locator(".os-pw-fake").isVisible()).toBe(true);
    await page.getByRole("button", { name: "Simular pagamento aprovado" }).click();
    await expect.poll(() => page.locator(".os-pw-h").textContent()).toBe("¡Pago confirmado!");
    await page.waitForURL(new RegExp(`/p/${o.thanksId}$`), { timeout: 10_000 });
    await expect.poll(() => page.locator("[data-os-ac-go]").isVisible(), { timeout: 10_000 }).toBe(true);
    // Nada de SDK nem nada fora da prévia.
    expect(s.outside).toEqual([]);
    expect(s.errors).toEqual([]);
    await s.close();
  }, 60_000);
});
