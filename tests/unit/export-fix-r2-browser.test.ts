/**
 * Script de chegada num Chromium de verdade (2ª rodada de correções):
 *
 * - quem vem de outro site e é mandado para celular/ (ou recarrega com a barra
 *   no fim) não perde a origem da visita: ela fica em sessionStorage "os_ref"
 *   e a página que fica a devolve ao document.referrer;
 * - numa hospedagem que entrega o index.html da raiz para QUALQUER caminho
 *   (Cloudflare Pages sem 404.html, try_files do Nginx), a ida para celular/
 *   para depois de uma vez (nada de "celular/celular/…" sem fim) e
 *   "//outro-site/x" continua no site.
 *
 * A hospedagem de mentira tem só os arquivos de um ZIP com a página inicial e
 * o "Upsell", cada um com a versão celular separada; qualquer outro caminho
 * recebe o index.html da raiz.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { earlyScriptTag } from "@/lib/export/head";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const pageHtml = (title: string, mobileDir: string | null) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">${earlyScriptTag({ mobileDir })}<title>${title}</title></head><body><h1>${title}</h1></body></html>`;

/** Arquivos do "ZIP" (pasta → página); o resto recebe o index.html da raiz. */
const FILES: Record<string, string> = {
  "/": pageHtml("Início computador", "celular/"),
  "/celular/": pageHtml("Início celular", null),
  "/upsell/": pageHtml("Upsell computador", "celular/"),
  "/upsell/celular/": pageHtml("Upsell celular", null),
};

interface Site {
  origin: string;
  paths: string[];
  close: () => Promise<void>;
}

async function fallbackSite(): Promise<Site> {
  const paths: string[] = [];
  const server: Server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    paths.push(pathname);
    const key = pathname.replace(/index\.html$/, "");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(FILES[key] ?? FILES["/"]);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    paths,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

let browser: Browser;
let site: Site;

beforeAll(async () => {
  browser = await chromium.launch();
  site = await fallbackSite();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await site?.close();
});

/** Visitante novo (celular ou computador), sem sair para a internet. */
async function visitor(mobile: boolean) {
  const context = await browser.newContext(
    mobile ? { userAgent: IPHONE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {},
  );
  const outside: string[] = [];
  await context.route(
    (url) => url.hostname !== "127.0.0.1" && url.hostname !== "localhost",
    (route) => {
      outside.push(route.request().url());
      return route.abort();
    },
  );
  return { context, outside };
}

/** Espera a página parar de redirecionar (o mesmo endereço por um instante). */
async function settledUrl(page: Page): Promise<URL> {
  let last = "";
  for (let i = 0; i < 40; i++) {
    await page.waitForLoadState("load").catch(() => {});
    const now = page.url();
    if (now === last) return new URL(now);
    last = now;
    await page.waitForTimeout(150);
  }
  return new URL(page.url());
}

/** Página de outro site (localhost × 127.0.0.1) com um link para `href`. */
async function fromOtherSite(page: Page, href: string) {
  const other = site.origin.replace("127.0.0.1", "localhost");
  await page
    .context()
    .route(`${other}/post`, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: `<a id="ir" href="${href}">Ver oferta</a>` }),
    );
  await page.goto(`${other}/post`);
  await page.click("#ir");
  return `${other}/`;
}

const osRef = (page: Page) => page.evaluate(() => sessionStorage.getItem("os_ref"));

describe("a origem da visita sobrevive aos redirecionamentos do script de chegada", () => {
  it("celular vindo de outro site para /upsell/ termina em /upsell/celular/ vendo o outro site como origem", async () => {
    const { context } = await visitor(true);
    const page = await context.newPage();
    const other = await fromOtherSite(page, `${site.origin}/upsell/?utm_source=ig`);
    const url = await settledUrl(page);
    expect(url.pathname).toBe("/upsell/celular/");
    expect(url.search).toBe("?utm_source=ig");
    expect(await page.locator("h1").textContent()).toBe("Upsell celular");
    // O navegador veria a página de computador como origem; o os_ref guardou a de verdade e
    // o script de chegada da página celular a devolveu (e apagou a chave).
    expect(await page.evaluate(() => document.referrer)).toBe(other);
    expect(await osRef(page)).toBeNull();
    await context.close();
  }, 60_000);

  it("computador vindo de outro site para /upsell (sem a barra): recarrega com a barra e guarda a origem", async () => {
    const { context } = await visitor(false);
    const page = await context.newPage();
    const other = await fromOtherSite(page, `${site.origin}/upsell?utm_source=google`);
    const url = await settledUrl(page);
    expect(url.pathname).toBe("/upsell/");
    expect(url.search).toBe("?utm_source=google");
    expect(await page.locator("h1").textContent()).toBe("Upsell computador");
    expect(await page.evaluate(() => document.referrer)).toBe(other);
    expect(await osRef(page)).toBeNull();
    await context.close();
  }, 60_000);

  it("link de dentro do site: não troca a origem guardada", async () => {
    const { context } = await visitor(true);
    const page = await context.newPage();
    await page.goto(`${site.origin}/upsell/celular/`);
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.id = "voltar";
      a.href = "/upsell/";
      a.textContent = "Voltar";
      document.body.append(a);
    });
    await page.click("#voltar");
    expect((await settledUrl(page)).pathname).toBe("/upsell/celular/");
    expect(await osRef(page)).toBeNull();
    // A origem é a página de dentro do site (nada de outro site inventado).
    expect(await page.evaluate(() => document.referrer)).toContain(site.origin);
    await context.close();
  }, 60_000);
});

describe("hospedagem que entrega o index.html da raiz para qualquer caminho", () => {
  it("celular num endereço que não existe (/promo/): vai para /promo/celular/ uma vez e para ali", async () => {
    const { context, outside } = await visitor(true);
    const page = await context.newPage();
    const before = site.paths.length;
    await page.goto(`${site.origin}/promo/?utm_source=x`);
    const url = await settledUrl(page);
    await page.waitForTimeout(400);
    expect(url.pathname).toBe("/promo/celular/");
    expect(page.url()).toBe(url.href);
    expect(site.paths.slice(before).filter((p) => p !== "/favicon.ico")).toEqual(["/promo/", "/promo/celular/"]);
    // Ficou na página de computador (a única que a hospedagem entrega ali), sem travar.
    expect(await page.locator("h1").textContent()).toBe("Início computador");
    // O endereço certo continua indo para o celular no mesmo navegador.
    await page.goto(`${site.origin}/`);
    expect((await settledUrl(page)).pathname).toBe("/celular/");
    expect(await page.locator("h1").textContent()).toBe("Início celular");
    expect(outside).toEqual([]);
    await context.close();
  }, 60_000);

  it("“//outro-site/x”: recarrega com a barra no próprio site", async () => {
    for (const mobile of [false, true]) {
      const { context, outside } = await visitor(mobile);
      const page = await context.newPage();
      await page.goto(`${site.origin}//attacker.test/x`).catch(() => {});
      const url = await settledUrl(page);
      expect(url.origin).toBe(site.origin);
      expect(url.pathname).toBe(mobile ? "/attacker.test/x/celular/" : "/attacker.test/x/");
      expect(outside).toEqual([]);
      await context.close();
    }
  }, 60_000);
});
