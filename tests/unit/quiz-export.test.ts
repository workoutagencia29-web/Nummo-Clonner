/**
 * Quiz no ZIP de verdade: oferta criada com o modelo "Quiz" (página inicial) e
 * uma página de vendas; o botão final do quiz vai para a página de vendas
 * (os-page:). O ZIP é gerado pelo mesmo serviço do painel, descompactado e
 * servido numa SUBPASTA (/clientes/quiz/) — e aberto direto do computador
 * (file://). Pixel da Meta trocado por uma versão local.
 *
 * Confere: o aviso de botão sem destino antes de escolher (com o texto do
 * quiz: próxima página do funil, não checkout) e o "Próximos passos" sem
 * mandar ligar o botão do quiz ao checkout; o quiz roda com o
 * script embutido; o botão final leva à página de vendas (caminho relativo,
 * com as UTMs da chegada); os eventos do quiz chegam à Meta depois do
 * "Aceitar".
 */
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { exportWarningFix } from "@/lib/export/warnings";
import { computeReadiness } from "@/lib/readiness";
import { storagePath } from "@/lib/storage";
import { startExport } from "@/server/services/export";
import { claimNextExport, exportFileKey, runExportJob } from "@/server/services/export/jobs";
import { exportPlan } from "@/server/services/export/plan";
import { createOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { createPixel } from "@/server/services/tracking";
import { resetDatabase } from "../setup/per-file";
import { removeExportFiles, unzipTo } from "./export-fixture";

const META_PIXEL = "123456789012345";
const PREFIX = "/clientes/quiz/";

let browser: Browser;
let dir = "";
let server: Server;
let base = "";
let deadPlan: Awaited<ReturnType<typeof exportPlan>>;
let deadWarning: string | undefined;
let templateHtml = "";

const MIME: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css" };

beforeAll(async () => {
  await resetDatabase();
  const offer = await createOffer({ name: "Oferta com quiz", templateId: "quiz" });
  await createPixel(offer.id, { vendor: "META", pixelId: META_PIXEL });

  // Antes de escolher o destino: o ZIP avisa do botão final sem destino.
  deadPlan = await exportPlan(offer.id);
  deadWarning = deadPlan.warnings.find((w) => /ainda não leva/.test(w));
  const sales = await createPage({ offerId: offer.id, name: "Página de vendas", templateId: "vendas-longa" });

  // Destino do botão final: a página de vendas (como "Página do funil" no editor).
  const doc = await prisma.pageDocument.findFirstOrThrow({
    where: { variant: { page: { offerId: offer.id, isHome: true } } },
  });
  const html = (doc.html ?? "").replace(
    'href="#" data-os-link="" data-os-qz-go=""',
    `href="os-page:${sales.id}" data-os-qz-go=""`,
  );
  templateHtml = doc.html ?? "";
  expect(html).toContain(`os-page:${sales.id}`);
  await prisma.pageDocument.update({ where: { id: doc.id }, data: { html } });

  const { exportId } = await startExport(offer.id, {});
  await claimNextExport();
  await runExportJob(exportId);
  dir = await mkdtemp(path.join(os.tmpdir(), "os-quiz-zip-"));
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

const META_STUB = `(function(){var c=window.__calls=window.__calls||[];var A=function(a){return [].slice.call(a)};
  var q=fbq.queue.slice();fbq.queue.length=0;fbq.callMethod=function(){c.push(["fbq"].concat(A(arguments)))};
  q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`;

async function answerAll(page: Page) {
  const option = (n: number) => page.locator(".os-qz-cur [data-os-qz-option]").nth(n);
  const next = () => page.locator(".os-qz-cur [data-os-qz-next]").click();
  const kind = () => page.locator(".os-qz-cur").getAttribute("data-os-qz-step");
  const index = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-os-qz-step]")].findIndex((s) => s.classList.contains("os-qz-cur")),
    );
  await option(0).click();
  await expect.poll(index).toBe(1);
  await option(1).click();
  await expect.poll(kind).toBe("info");
  await next();
  await option(0).click();
  await next();
  await option(2).click();
  await expect.poll(kind).toBe("loading");
  await expect.poll(kind, { timeout: 8000 }).toBe("final");
}

describe("quiz no ZIP", () => {
  it("antes de escolher o destino, o ZIP avisa do botão final sem destino (próxima página do funil, não checkout)", () => {
    expect(deadWarning).toBe(
      "O botão final do quiz “GIRAR A ROLETA AGORA” da página “Página principal” ainda não leva a lugar nenhum: abra a página no editor, clique no quiz e escolha a próxima página do funil em “Ao terminar o quiz”, nas Configurações.",
    );
    expect(deadPlan.warnings.join(" ")).not.toMatch(/checkout/i);
    // A tela oferece abrir a página do quiz no editor.
    expect(exportWarningFix(deadWarning ?? "")).toEqual({ kind: "deadButtons", quiz: true });
    expect(deadPlan.deadButtonPages).toEqual([
      expect.objectContaining({ name: "Página principal", buy: false, quiz: true }),
    ]);
  });

  it("“Próximos passos” não manda ligar o botão final do quiz ao checkout", () => {
    const base = {
      clonedCheckoutUrls: [],
      pixelCount: 1,
      company: { name: "", document: "", email: "", phone: "", address: "" },
      liveUrl: null,
      lastZipAt: null,
    };
    const checkout = (htmls: string[], links: { key: string; url: string }[] = []) =>
      computeReadiness({ ...base, htmls, links }, () => "").items.find((i) => i.id === "checkout");
    expect(templateHtml).toContain('data-os-link="" data-os-qz-go=""');
    const item = checkout([templateHtml]);
    expect(item?.title).toBe("Cadastrar o checkout");
    expect(item?.optional).toBe(true);
    // Um botão de compra de verdade na mesma página continua contando (e o do quiz não).
    const withBuy = `${templateHtml}<a class="os-btn" href="#" data-os-link="">Comprar</a>`;
    expect(checkout([withBuy])?.detail).toMatch(/^1 botão de compra ainda sem link/);
    expect(checkout([withBuy], [{ key: "checkout", url: "https://pay.exemplo.com" }])?.title).toBe(
      "Ligar os botões de compra",
    );
    // Atributo com ">" dentro das aspas não confunde a leitura das tags.
    const tricky = `<div data-os-messages="a > b"><a data-os-qz-go="" data-os-link="">Girar</a></div>`;
    expect(checkout([tricky])?.optional).toBe(true);
  });

  it("numa subpasta: roda o quiz, manda os eventos e o botão final leva à página de vendas com as UTMs", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(
      (url) => url.hostname !== "127.0.0.1",
      (route) =>
        route.request().url().startsWith("https://connect.facebook.net/")
          ? route.fulfill({ contentType: "text/javascript", body: META_STUB })
          : route.abort(),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    const missing: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.url().startsWith("http://127.0.0.1") && r.status() >= 400) missing.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}?utm_source=facebook&utm_campaign=quiz`);
    await page.getByRole("button", { name: "Aceitar" }).click();
    await answerAll(page);
    const metaQuiz = () =>
      page.evaluate(() =>
        ((window as { __calls?: unknown[][] }).__calls ?? []).filter((c) => c[1] === "trackCustom").map((c) => c[2]),
      );
    await expect
      .poll(metaQuiz)
      .toEqual(["QuizPergunta1", "QuizPergunta2", "QuizPergunta3", "QuizPergunta4", "QuizConcluido"]);

    await page.locator(".os-qz-cur [data-os-qz-go]").click({ force: true });
    await page.waitForURL((url) => url.pathname === `${PREFIX}pagina-de-vendas/`);
    const arrived = new URL(page.url());
    expect(arrived.searchParams.get("utm_source")).toBe("facebook");
    expect(arrived.searchParams.get("utm_campaign")).toBe("quiz");
    expect(errors).toEqual([]);
    expect(missing).toEqual([]);
    await context.close();
  }, 60_000);

  it("aberto direto do computador (file://): o quiz funciona com o script embutido", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(
      (url) => /^https?:$/.test(url.protocol),
      (route) => route.abort(),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(dir, "index.html")).href);
    expect(await page.locator("[data-os-qz-step]:visible").count()).toBe(1);
    await page.locator(".os-qz-cur [data-os-qz-option]").first().click();
    await expect.poll(() => page.locator(".os-qz-cur h2").textContent()).toBe("Você já tentou resolver isso antes?");
    const href = await page.locator("[data-os-qz-go]").getAttribute("href");
    expect(href).toMatch(/^(\.\.\/|\.\/)?pagina-de-vendas\/(index\.html)?/);
    expect(errors).toEqual([]);
    await context.close();
  });
});
