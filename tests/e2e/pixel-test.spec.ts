/**
 * Fase 4 — tela "Testar pixels" de ponta a ponta: oferta com pixel da Meta,
 * link de checkout e a regra "InitiateCheckout ao clicar no checkout"; o teste
 * abre a página em modo teste numa aba nova, aceita os cookies, clica no botão
 * de compra e vê, no painel, o pixel carregar e os eventos dispararem.
 *
 * Os pixels, links e regras entram direto no banco dos testes E2E (a tela de
 * configuração de pixels é de outra parte da Fase 4). Nada vai para a
 * internet: o script da Meta e o checkout são respondidos aqui.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { parse } from "dotenv";
import { Client } from "pg";
import { createOffer, uid } from "./helpers";

/** Banco dos testes E2E (scripts/e2e-server.ts). Nunca o "offerstudio" (dados reais). */
const E2E_DB = "offerstudio_e2e_auto";
const META_ID = "123456789012345";
const CHECKOUT_URL = "https://pay.hotmart.com/E2E123TESTE";
const PAGE_HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Oferta E2E</title></head><body><h1>Oferta de teste</h1><p><a id="comprar" data-os-link="checkout" href="#">Quero comprar</a></p></body></html>`;

/** Script da Meta de mentira: consome a fila do fbq (como o de verdade faria). */
const FB_STUB = `(function(){var c=window.__fbCalls=window.__fbCalls||[];
  var q=fbq.queue.slice();fbq.queue.length=0;
  fbq.callMethod=function(){c.push([].slice.call(arguments))};
  q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`;

async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const env = parse(readFileSync(path.join(process.cwd(), ".env")));
  const client = new Client({
    host: "127.0.0.1",
    port: Number(env.PG_PORT || 5433),
    user: env.PG_USER || "offerstudio",
    password: env.PG_PASSWORD,
    database: E2E_DB,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Id no formato do Prisma (cuid, 25 caracteres). */
function newId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(
    0,
    25,
  );
}

/** Página com botão de checkout, link de checkout, pixel da Meta e a regra de checkout. */
async function configureTracking(offerId: string) {
  await withDb(async (db) => {
    const updated = await db.query(
      `UPDATE "PageDocument" d SET html = $1, project = NULL, "updatedAt" = now()
         FROM "PageVariant" v JOIN "Page" p ON p.id = v."pageId"
        WHERE d."variantId" = v.id AND p."offerId" = $2 AND p."isHome"`,
      [PAGE_HTML, offerId],
    );
    expect(updated.rowCount).toBe(1);
    await db.query(
      `INSERT INTO "OfferLink" (id, "offerId", key, label, url, kind, position, "createdAt", "updatedAt")
       VALUES ($1, $2, 'checkout', 'Checkout', $3, 'CHECKOUT', 0, now(), now())`,
      [newId(), offerId, CHECKOUT_URL],
    );
    await db.query(
      `INSERT INTO "PixelConfig" (id, "offerId", vendor, enabled, "pixelId", options, "createdAt", "updatedAt")
       VALUES ($1, $2, 'META', true, $3, '{}', now(), now())`,
      [newId(), offerId, META_ID],
    );
    await db.query(
      `INSERT INTO "EventRule" (id, "offerId", "pageId", event, trigger, enabled, "createdAt")
       VALUES ($1, $2, NULL, 'INITIATE_CHECKOUT', 'CHECKOUT_CLICK', true, now())`,
      [newId(), offerId],
    );
  });
}

/** Tudo fora do Offer Studio (painel e prévias em *.localhost) é respondido aqui ou recusado. */
async function stubOutside(context: BrowserContext) {
  const local = (url: URL) =>
    url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname === "127.0.0.1";
  await context.route(
    (url) => !local(url),
    (route) => {
      const url = route.request().url();
      if (url.startsWith("https://connect.facebook.net/")) {
        return route.fulfill({ contentType: "application/javascript", body: FB_STUB });
      }
      if (url.startsWith("https://pay.hotmart.com/")) {
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: "<!doctype html><html><head><title>Checkout</title></head><body><h1>Checkout de teste</h1></body></html>",
        });
      }
      return route.abort();
    },
  );
}

function metaCard(page: Page) {
  return page.locator('section[data-vendor="META"]');
}

function checkItem(page: Page, label: string) {
  return metaCard(page)
    .getByRole("list", { name: /^Conferência/ })
    .getByRole("listitem")
    .filter({ hasText: label });
}

test.describe("Testar pixels", () => {
  test("pixel da Meta carrega e PageView + InitiateCheckout aparecem ao vivo", async ({ page, context }) => {
    const offerId = await createOffer(page, `Pixels ${uid()}`);
    await configureTracking(offerId);
    await stubOutside(context);

    await page.goto(`/ofertas/${offerId}/testar-pixels`);
    await expect(page.getByRole("heading", { level: 1, name: "Testar pixels" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Página para testar" })).toContainText("(inicial)");
    await expect(page.getByText("1 pixel vai carregar de verdade")).toBeVisible();

    await page.getByRole("button", { name: "Iniciar teste" }).click();
    const open = page.getByRole("link", { name: "Abrir página de teste" });
    await expect(open).toBeVisible();
    await expect(open).toHaveAttribute("target", "_blank");
    const testUrl = (await open.getAttribute("href")) ?? "";
    expect(testUrl).toMatch(/^http:\/\/[a-z2-7]{26}\.localhost:\d+\/\?os_teste=[a-z2-7]{26}$/);
    await expect(page.getByText("Teste em andamento")).toBeVisible();

    // A página de teste abre numa aba nova (pixels de verdade precisam de uma página de verdade).
    const [testPage] = await Promise.all([context.waitForEvent("page"), open.click()]);
    await testPage.waitForLoadState("domcontentloaded");
    await expect(testPage.getByRole("heading", { name: "Oferta de teste" })).toBeVisible();

    // Antes do "Aceitar": o painel mostra que os pixels esperam o consentimento.
    await page.bringToFront();
    const consent = page.getByRole("region", { name: /Consentimento \(LGPD\)/ });
    await expect(consent.locator("header")).toContainText("Esperando o “Aceitar”");

    await testPage.bringToFront();
    await testPage.getByRole("button", { name: "Aceitar" }).click();
    // init + PageView chegaram ao script (de mentira) da Meta.
    await expect
      .poll(() => testPage.evaluate(() => (window as unknown as { __fbCalls?: unknown[] }).__fbCalls?.length ?? 0))
      .toBeGreaterThanOrEqual(2);

    await page.bringToFront();
    await expect(consent.locator("header")).toContainText("Aceito");
    await expect(metaCard(page).locator("header")).toContainText("Carregou");
    await expect(checkItem(page, "Pixel carregou")).toHaveAttribute("data-state", "done");
    await expect(checkItem(page, "PageView disparou")).toHaveAttribute("data-state", "done");
    await expect(checkItem(page, "InitiateCheckout ao clicar no checkout")).toHaveAttribute("data-state", "pending");
    await expect(
      page.getByText("Clique no botão de compra da página de teste para ver o InitiateCheckout aqui."),
    ).toBeVisible();

    // Clique no botão de compra: vai para o checkout (com o evento já enviado).
    await testPage.bringToFront();
    await testPage.getByRole("link", { name: "Quero comprar" }).click();
    await expect(testPage).toHaveURL(/^https:\/\/pay\.hotmart\.com\/E2E123TESTE/);

    await page.bringToFront();
    await expect(checkItem(page, "InitiateCheckout ao clicar no checkout")).toHaveAttribute("data-state", "done");
    const timeline = metaCard(page).getByRole("list", { name: "Linha do tempo — Meta (Facebook e Instagram)" });
    await expect(timeline.getByRole("listitem").filter({ hasText: "InitiateCheckout" })).toContainText("Disparou");
    await expect(timeline.getByRole("listitem").filter({ hasText: "PageView" })).toContainText("Disparou");
    await expect(timeline.getByRole("listitem").filter({ hasText: "Pixel carregou" })).toContainText("Carregou");
    await expect(timeline.getByRole("listitem").filter({ hasText: "Pixel carregou" })).toContainText(META_ID);

    // Encerrar: o resultado fica, o link da página de teste para de funcionar.
    await page.getByRole("button", { name: "Encerrar teste" }).click();
    await expect(page.getByText("Teste encerrado", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir página de teste" })).toHaveCount(0);
    await expect(checkItem(page, "InitiateCheckout ao clicar no checkout")).toHaveAttribute("data-state", "done");
    const ended = await testPage.goto(testUrl);
    expect(ended?.status()).toBe(410);
    await expect(testPage.getByText("Este teste de pixels terminou")).toBeVisible();

    await page.getByRole("button", { name: "Começar novo teste" }).click();
    await expect(page.getByRole("button", { name: "Iniciar teste" })).toBeVisible();
  });

  test("oferta sem pixel: explica e leva para a configuração", async ({ page }) => {
    const offerId = await createOffer(page, `Sem pixel ${uid()}`);
    await page.goto(`/ofertas/${offerId}/testar-pixels`);
    await expect(page.getByText("Nenhum pixel ligado nesta oferta")).toBeVisible();
    await expect(page.getByRole("link", { name: "Configurar pixels" })).toHaveAttribute(
      "href",
      `/ofertas/${offerId}?aba=rastreamento&secao=pixels`,
    );
    await expect(page.getByRole("button", { name: "Iniciar teste" })).toHaveCount(0);
  });

  test("oferta que não existe: página de oferta não encontrada", async ({ page }) => {
    await page.goto("/ofertas/cnaoexiste000000000000000/testar-pixels");
    await expect(page.getByRole("heading", { name: "Oferta não encontrada" })).toBeVisible();
  });
});
