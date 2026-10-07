/**
 * Funil em 1 clique no ZIP de verdade: a oferta com a página de vendas (modelo)
 * ganha o funil "Quiz → Roleta" pelo serviço, sem mexer em nada no editor. O
 * ZIP é descompactado e servido numa SUBPASTA, e um Chromium faz o caminho do
 * visitante: o link do anúncio (raiz) abre o quiz, o botão final leva à
 * roleta, o "Resgatar" leva à página de vendas (agora em /principal/), que
 * troca os botões de compra pelo checkout do prêmio e mostra a faixa.
 */
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { FUNNEL_PRIZES } from "@/lib/funnel";
import { storagePath } from "@/lib/storage";
import { startExport } from "@/server/services/export";
import { claimNextExport, exportFileKey, runExportJob } from "@/server/services/export/jobs";
import { exportPlan } from "@/server/services/export/plan";
import { createQuizWheelFunnel } from "@/server/services/funnel";
import { createOfferLink } from "@/server/services/offer-links";
import { createOffer } from "@/server/services/offers";
import { resetDatabase } from "../setup/per-file";
import { removeExportFiles, unzipTo } from "./export-fixture";

const PREFIX = "/clientes/funil/";
const MIME: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css" };

let browser: Browser;
let dir = "";
let server: Server;
let base = "";
let warnings: string[] = [];

beforeAll(async () => {
  await resetDatabase();
  const offer = await createOffer({ name: "Curso com funil", templateId: "vendas-longa" });
  const sales = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
  // A página de vendas já tinha os botões de compra ligados ao checkout cheio.
  const checkout = await createOfferLink(offer.id, {
    label: "Checkout principal",
    url: "https://pay.exemplo.com/cheio",
    kind: "CHECKOUT",
  });
  const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: sales.id } } });
  await prisma.pageDocument.update({
    where: { id: doc.id },
    data: { html: (doc.html ?? "").replaceAll('data-os-link=""', `data-os-link="${checkout.key}"`) },
  });

  const prizes = FUNNEL_PRIZES.map((p, i) => ({ ...p, url: `https://pay.exemplo.com/desconto-${i}` }));
  prizes[1].coupon = "VINTE";
  const funnel = await createQuizWheelFunnel({ offerId: offer.id, salesPageId: sales.id, prizes });
  expect(funnel.salesHasCheckoutButtons).toBe(true);
  expect(funnel.missingUrls).toEqual([]);

  warnings = (await exportPlan(offer.id)).warnings;
  const { exportId } = await startExport(offer.id, {});
  await claimNextExport();
  await runExportJob(exportId);
  dir = await mkdtemp(path.join(os.tmpdir(), "os-funnel-zip-"));
  await unzipTo(storagePath(exportFileKey(offer.id, exportId)), dir);

  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
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

async function answerQuiz(page: Page) {
  const option = (n: number) => page.locator(".os-qz-cur [data-os-qz-option]").nth(n);
  const kind = () => page.locator(".os-qz-cur").getAttribute("data-os-qz-step");
  const index = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-os-qz-step]")].findIndex((s) => s.classList.contains("os-qz-cur")),
    );
  await option(0).click();
  await expect.poll(index).toBe(1);
  await option(1).click();
  await expect.poll(kind).toBe("info");
  await page.locator(".os-qz-cur [data-os-qz-next]").click();
  await option(0).click();
  await page.locator(".os-qz-cur [data-os-qz-next]").click();
  await option(2).click();
  await expect.poll(kind, { timeout: 8000 }).toBe("final");
}

describe("funil em 1 clique no ZIP", () => {
  it("o ZIP não avisa de botão sem destino nem de prêmio sem link", () => {
    // (Só o aviso dos dados da empresa, que vale para qualquer modelo.)
    expect(warnings.filter((w) => !w.includes("{{EMPRESA}}"))).toEqual([]);
  });

  it("anúncio → quiz (raiz) → roleta → página de vendas com o desconto ganho", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    // 0,5 cai na 2ª fatia (chances 40/30/20/10): 20% OFF.
    await context.addInitScript({ content: "Math.random=function(){return 0.5}" });
    await context.route(
      (url) => url.hostname !== "127.0.0.1",
      (route) => route.abort(),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    const missing: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.url().startsWith("http://127.0.0.1") && r.status() >= 400) missing.push(`${r.status()} ${r.url()}`);
    });

    await page.goto(`${base}?utm_source=facebook`);
    expect(await page.locator('[data-os-widget="quiz"]').count()).toBe(1);
    await answerQuiz(page);
    await page.locator(".os-qz-cur [data-os-qz-go]").click({ force: true });
    await page.waitForURL((u) => u.pathname === `${PREFIX}roleta/`);
    expect(new URL(page.url()).searchParams.get("utm_source")).toBe("facebook");

    await page.locator("[data-os-wh-spin]").click();
    await expect.poll(() => page.locator("[data-os-wh-result]").isVisible(), { timeout: 3000 }).toBe(true);
    expect(await page.locator("[data-os-wh-prize]").textContent()).toBe("20% OFF");
    await page.locator("[data-os-wh-go]").click({ force: true });
    await page.waitForURL((u) => u.pathname === `${PREFIX}principal/`);

    await expect.poll(() => page.locator(".os-pz").count()).toBe(1);
    expect(await page.locator(".os-pz-msg").textContent()).toMatch(/^🎉 Você ganhou 20% OFF/);
    expect(await page.locator(".os-pz-cp code").textContent()).toBe("VINTE");
    const hrefs = await page
      .locator('[data-os-link-kind="checkout"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(hrefs.length).toBeGreaterThan(1);
    for (const h of hrefs) expect(h).toBe("https://pay.exemplo.com/desconto-1");
    expect(errors).toEqual([]);
    expect(missing).toEqual([]);
    await context.close();
  }, 60_000);
});
