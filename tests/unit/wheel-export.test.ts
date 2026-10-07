/**
 * Funil quiz → roleta → página de vendas no ZIP de verdade: oferta criada com o
 * modelo "Quiz", a página "Roleta" (modelo) e a página de vendas (modelo, com
 * teste A/B: duas versões). Antes de ligar, o ZIP e o "Próximos passos" avisam
 * dos prêmios sem link e do "Resgatar" sem destino (conserto "Abrir no
 * editor"). Depois de ligar, o ZIP é descompactado e servido numa SUBPASTA e
 * aberto direto do computador (file://).
 *
 * Confere: girar na roleta e resgatar leva o prêmio à página de vendas (passando
 * pelo divisor A/B), que troca os botões de compra pelo checkout do prêmio,
 * mostra a faixa e o "só para quem ganhou" — também por file://, onde o
 * localStorage pode não valer entre pastas (o parâmetro os_premio leva o prêmio).
 */
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as cheerio from "cheerio";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { exportWarningFix } from "@/lib/export/warnings";
import { storagePath } from "@/lib/storage";
import type { WheelSlice } from "@/lib/wheel";
import { startExport } from "@/server/services/export";
import { claimNextExport, exportFileKey, runExportJob } from "@/server/services/export/jobs";
import { exportPlan } from "@/server/services/export/plan";
import { createOfferLink } from "@/server/services/offer-links";
import { createOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { getOfferReadiness } from "@/server/services/readiness";
import { createVariant } from "@/server/services/variants";
import { resetDatabase } from "../setup/per-file";
import { removeExportFiles, unzipTo } from "./export-fixture";

const PREFIX = "/clientes/roleta/";
const MIME: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css" };

let browser: Browser;
let dir = "";
let server: Server;
let base = "";
let deadPlan: Awaited<ReturnType<typeof exportPlan>>;
let readiness: Awaited<ReturnType<typeof getOfferReadiness>>;
let wheelDocId = "";
let wheelSlug = "";
let salesSlug = "";

/** Troca o HTML de todos os documentos de uma página (todas as versões). */
async function editPage(pageId: string, fn: (html: string) => string) {
  const docs = await prisma.pageDocument.findMany({ where: { variant: { pageId } } });
  for (const doc of docs)
    await prisma.pageDocument.update({ where: { id: doc.id }, data: { html: fn(doc.html ?? "") } });
  return docs;
}

beforeAll(async () => {
  await resetDatabase();
  const offer = await createOffer({ name: "Quiz com roleta", templateId: "quiz" });
  const wheelPage = await createPage({ offerId: offer.id, name: "Roleta", templateId: "roleta" });
  const sales = await createPage({ offerId: offer.id, name: "Página de vendas", templateId: "vendas-longa" });
  await createVariant({ pageId: sales.id });
  const checkout = await createOfferLink(offer.id, {
    label: "Checkout",
    url: "https://pay.exemplo.com/cheio",
    kind: "CHECKOUT",
  });
  const c20 = await createOfferLink(offer.id, {
    label: "Checkout 20",
    url: "https://pay.exemplo.com/vinte",
    kind: "CHECKOUT",
  });
  const c50 = await createOfferLink(offer.id, {
    label: "Checkout 50",
    url: "https://pay.exemplo.com/cinquenta",
    kind: "CHECKOUT",
  });

  // Antes de ligar: avisos do ZIP e do "Próximos passos".
  deadPlan = await exportPlan(offer.id);
  readiness = await getOfferReadiness({ id: offer.id, liveUrl: null, links: [checkout, c20, c50] });
  const pages = await prisma.page.findMany({
    where: { offerId: offer.id },
    select: { id: true, slug: true, isHome: true },
  });
  wheelSlug = pages.find((p) => p.id === wheelPage.id)?.slug ?? "";
  salesSlug = pages.find((p) => p.id === sales.id)?.slug ?? "";
  const home = pages.find((p) => p.isHome);

  // Quiz → roleta; roleta: prêmios ligados e "Resgatar" → vendas; vendas: botões no checkout cheio.
  await editPage(home?.id ?? "", (h) =>
    h.replace('href="#" data-os-link="" data-os-qz-go=""', `href="os-page:${wheelPage.id}" data-os-qz-go=""`),
  );
  const docs = await editPage(wheelPage.id, (h) => {
    const $ = cheerio.load(h);
    const wheel = $('[data-os-widget="wheel"]');
    const slices = JSON.parse(wheel.attr("data-os-slices") ?? "[]") as WheelSlice[];
    wheel.attr(
      "data-os-slices",
      JSON.stringify(slices.map((s, i) => ({ ...s, link: i < 2 ? c20.key : c50.key, coupon: i === 1 ? "VINTE" : "" }))),
    );
    $("[data-os-wh-go]").attr("href", `os-page:${sales.id}`).removeAttr("data-os-link");
    return $.html();
  });
  wheelDocId = docs[0]?.id ?? "";
  await editPage(sales.id, (h) =>
    h
      .replaceAll('data-os-link=""', `data-os-link="${checkout.key}"`)
      .replace("<body>", '<body><p id="so-ganhou" data-os-premio="ganhou">Preço com o seu desconto</p>'),
  );

  const { exportId } = await startExport(offer.id, {});
  await claimNextExport();
  await runExportJob(exportId);
  dir = await mkdtemp(path.join(os.tmpdir(), "os-wheel-zip-"));
  await unzipTo(storagePath(exportFileKey(offer.id, exportId)), dir);

  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith(PREFIX)) {
      res.writeHead(404).end();
      return;
    }
    void (async () => {
      let file = path.join(dir, pathname.slice(PREFIX.length));
      if ((await stat(file).catch(() => null))?.isDirectory()) file = path.join(file, "index.html");
      if (!(await stat(file).catch(() => null))?.isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[file.split(".").pop() ?? ""] ?? "application/octet-stream" });
      createReadStream(file).pipe(res);
    })();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${PREFIX}`;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) await rm(dir, { recursive: true, force: true });
  await removeExportFiles();
  await resetDatabase();
});

async function expectPrizeOnSales(page: Page) {
  await expect.poll(() => page.locator(".os-pz").count()).toBe(1);
  expect(await page.locator(".os-pz-msg").textContent()).toMatch(
    /^🎉 Você ganhou 20% OFF — seu desconto está reservado por (10:00|09:5\d)$/,
  );
  expect(await page.locator(".os-pz-cp code").textContent()).toBe("VINTE");
  const hrefs = await page
    .locator('[data-os-link="checkout"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  expect(hrefs.length).toBeGreaterThan(1);
  for (const h of hrefs) expect(h).toBe("https://pay.exemplo.com/vinte");
  expect(await page.locator("#so-ganhou").isVisible()).toBe(true);
}

describe("roleta no ZIP", () => {
  it("antes de ligar: o ZIP avisa dos prêmios sem link e do “Resgatar” sem destino; o “Próximos passos” abre a roleta no editor", () => {
    const prizes = deadPlan.warnings.find((w) => w.startsWith("Roleta com prêmio sem link de checkout"));
    expect(prizes).toBe(
      "Roleta com prêmio sem link de checkout na página “Roleta” (os prêmios “10% OFF”, “20% OFF”, “30% OFF” e mais 1): quem ganhar não recebe o desconto. Para resolver, abra a página no editor, clique na roleta e escolha o checkout com o desconto de cada prêmio em Configurações → Fatias.",
    );
    const dead = deadPlan.warnings.find((w) => w.includes("da roleta da página"));
    expect(dead).toBe(
      "O botão “RESGATAR MEU DESCONTO” da roleta da página “Roleta” ainda não leva a lugar nenhum: abra a página no editor, clique na roleta e escolha a página de vendas em “Ao resgatar o prêmio”, nas Configurações.",
    );
    expect(exportWarningFix(prizes ?? "")).toEqual({ kind: "deadButtons", wheel: true });
    expect(deadPlan.deadButtonPages).toContainEqual(
      expect.objectContaining({ name: "Roleta", wheel: true, buy: false }),
    );
    // O "Resgatar" não entra no aviso dos botões de compra.
    expect(deadPlan.warnings.some((w) => w.includes("RESGATAR") && w.includes("sem link de checkout):"))).toBe(false);

    const item = readiness.items.find((i) => i.id === "roleta");
    expect(item).toMatchObject({
      title: "Roleta com prêmio sem link de checkout",
      cta: "Abrir no editor",
      done: false,
    });
    expect(item?.target).toEqual({ editor: wheelDocId });
  });

  it("numa subpasta: gira, resgata e a página de vendas (com A/B) troca os botões e mostra a faixa", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    await context.addInitScript({ content: "Math.random=function(){return 0.5}" });
    await context.route(
      (url) => url.hostname !== "127.0.0.1",
      (route) => route.abort(),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}${wheelSlug}/?utm_source=facebook`);
    await page.locator("[data-os-wh-spin]").click();
    await expect.poll(() => page.locator("[data-os-wh-result]").isVisible(), { timeout: 3000 }).toBe(true);
    expect(await page.locator("[data-os-wh-prize]").textContent()).toBe("20% OFF");
    const href = (await page.locator("[data-os-wh-go]").getAttribute("href")) ?? "";
    // Caminho relativo à pasta, com as UTMs da chegada e o prêmio.
    expect(href).toMatch(new RegExp(`^\\.\\./${salesSlug}/\\?`));
    const params = new URL(href, "http://x/a/b/").searchParams;
    expect(params.get("utm_source")).toBe("facebook");
    expect(params.get("os_premio")).toMatch(/^[a-z0-9-]+\.[0-9a-z]+$/);
    await page.locator("[data-os-wh-go]").click({ force: true });
    // Divisor A/B: vai para uma das versões, com o prêmio no endereço.
    await page.waitForURL(
      (u) => u.pathname.startsWith(`${PREFIX}${salesSlug}/`) && u.pathname !== `${PREFIX}${salesSlug}/`,
    );
    await expectPrizeOnSales(page);
    expect(new URL(page.url()).searchParams.get("os_premio")).toBeNull();
    expect(errors).toEqual([]);
    await context.close();
  }, 60_000);

  it("aberto direto do computador (file://): o prêmio vai pelo endereço até a página de vendas", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await context.addInitScript({ content: "Math.random=function(){return 0.5}" });
    await context.route(
      (url) => /^https?:$/.test(url.protocol),
      (route) => route.abort(),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(dir, wheelSlug, "index.html")).href);
    await page.locator("[data-os-wh-spin]").click();
    await expect.poll(() => page.locator("[data-os-wh-result]").isVisible(), { timeout: 3000 }).toBe(true);
    await page.locator("[data-os-wh-go]").click({ force: true });
    await page.waitForURL(
      (u) =>
        u.protocol === "file:" &&
        u.pathname.includes(`/${salesSlug}/`) &&
        !u.pathname.endsWith(`/${salesSlug}/index.html`),
    );
    await expectPrizeOnSales(page);
    expect(errors).toEqual([]);
    await context.close();
  }, 60_000);
});
