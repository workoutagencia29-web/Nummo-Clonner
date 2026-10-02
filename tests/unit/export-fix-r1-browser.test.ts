/**
 * Divisor A/B e script de chegada num Chromium de verdade, numa hospedagem que
 * entrega o index.html do divisor para QUALQUER caminho (fallback de SPA,
 * Cloudflare Pages sem 404.html, try_files do Nginx):
 *
 * - "//outro-site.com/" no caminho nunca leva o visitante para outro site;
 * - endereço que não existe: o divisor redireciona uma vez e para (sem
 *   "/promo/oferta-b/oferta-b/…" sem fim);
 * - quem chega direto numa versão (anúncio para /oferta-b/) e volta ao
 *   endereço da página continua na mesma versão;
 * - a origem da visita (outro site) chega à página da versão (document.referrer).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { earlyScriptTag } from "@/lib/export/head";
import { splitterHtml } from "@/lib/export/splitter";

const VARIANTS = [
  { folder: "oferta-a/", weight: 50, id: "ia" },
  { folder: "oferta-b/", weight: 50, id: "ib" },
];

const versionPage = (name: "A" | "B") => {
  const folder = `oferta-${name.toLowerCase()}/`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">${earlyScriptTag({
    ab: { key: "k", folder, id: `i${name.toLowerCase()}`, up: 1 },
  })}<title>Versão ${name}</title></head><body><h1>Versão ${name}</h1><a id="inicio" href="../">Início</a></body></html>`;
};

const SPLITTER = splitterHtml({ variants: VARIANTS, key: "k", title: "Oferta", lang: "pt-BR" });

interface Site {
  origin: string;
  paths: string[];
  close: () => Promise<void>;
}

/**
 * Hospedagem "pega-tudo" de verdade: só /oferta-a/ e /oferta-b/ têm a página
 * delas; QUALQUER outro caminho (inclusive "/x/oferta-b/", que não existe)
 * recebe o divisor da raiz — como a Cloudflare Pages sem 404.html.
 */
async function catchAllSite(): Promise<Site> {
  const paths: string[] = [];
  const server: Server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    paths.push(pathname);
    const body = pathname === "/oferta-a/" ? versionPage("A") : pathname === "/oferta-b/" ? versionPage("B") : SPLITTER;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(body);
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
  site = await catchAllSite();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await site?.close();
});

/** Contexto novo (visitante novo), com Math.random fixo e sem sair para a internet. */
async function visitor(random: number) {
  const context = await browser.newContext();
  const outside: string[] = [];
  await context.route(
    (url) => url.hostname !== "127.0.0.1" && url.hostname !== "localhost",
    (route) => {
      outside.push(route.request().url());
      return route.abort();
    },
  );
  await context.addInitScript(`Math.random = () => ${random};`);
  return { context, outside };
}

/** Espera a página parar de redirecionar (o mesmo endereço por um instante). */
async function settledUrl(page: import("playwright").Page): Promise<URL> {
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

describe("divisor e script de chegada numa hospedagem que entrega o index.html para qualquer caminho", () => {
  it("“//outro-site/” no endereço: o divisor continua no site e para (sem redirecionar sem fim)", async () => {
    const { context, outside } = await visitor(0.9);
    const page = await context.newPage();
    for (const [path, end] of [
      ["//attacker.test/", "/attacker.test/oferta-b/"],
      ["//attacker.test/login", "/attacker.test/login/oferta-b/"],
      ["/%5Cattacker.test/", "/%5Cattacker.test/oferta-b/"],
    ]) {
      const before = site.paths.length;
      await page.goto(`${site.origin}${path}`).catch(() => {});
      const url = await settledUrl(page);
      expect(url.origin, path).toBe(site.origin);
      expect(url.pathname, path).toBe(end);
      // Um redirecionamento só: o divisor, entregue de novo em …/oferta-b/, para ali.
      await page.waitForTimeout(400);
      expect(site.paths.length - before, path).toBeLessThanOrEqual(3);
      expect(page.url(), path).toBe(url.href);
    }
    expect(outside).toEqual([]);
    await context.close();
  }, 60_000);

  it("endereço antigo ou digitado errado (/promo/): o divisor para em /promo/oferta-b/ em vez de repetir a pasta", async () => {
    for (const [random, folder] of [
      [0.9, "oferta-b"],
      [0.1, "oferta-a"],
    ] as const) {
      const { context } = await visitor(random);
      const page = await context.newPage();
      const before = site.paths.length;
      await page.goto(`${site.origin}/promo/?utm_source=x`);
      const url = await settledUrl(page);
      await page.waitForTimeout(400);
      expect(url.pathname).toBe(`/promo/${folder}/`);
      expect(url.search).toBe("?utm_source=x");
      expect(page.url()).toBe(url.href);
      expect(site.paths.slice(before).filter((p) => p !== "/favicon.ico")).toEqual(["/promo/", `/promo/${folder}/`]);
      // No mesmo navegador, o endereço certo continua funcionando.
      await page.goto(`${site.origin}/`);
      expect((await settledUrl(page)).pathname).toBe(`/${folder}/`);
      expect(await page.locator("h1").textContent()).toBe(folder === "oferta-b" ? "Versão B" : "Versão A");
      await context.close();
    }
  }, 60_000);

  it("quem chega direto na versão B e volta ao endereço da página continua na B (10 visitantes)", async () => {
    for (let i = 0; i < 10; i++) {
      // O sorteio sempre daria a A: só a escolha guardada leva de volta para a B.
      const { context } = await visitor(0.01);
      const page = await context.newPage();
      await page.goto(`${site.origin}/oferta-b/?utm_source=anuncio`);
      await expect.poll(() => page.locator("h1").textContent()).toBe("Versão B");
      await page.click("#inicio");
      const url = await settledUrl(page);
      expect(url.pathname).toBe("/oferta-b/");
      expect(await page.locator("h1").textContent()).toBe("Versão B");
      await context.close();
    }
    // Visitante novo pelo endereço da página: sorteio (0.01 → A).
    const { context } = await visitor(0.01);
    const page = await context.newPage();
    await page.goto(`${site.origin}/`);
    expect((await settledUrl(page)).pathname).toBe("/oferta-a/");
    await context.close();
  }, 90_000);

  it("a origem da visita (outro site) chega à página da versão", async () => {
    const { context } = await visitor(0.9);
    const page = await context.newPage();
    // Outro site (localhost × 127.0.0.1) com um link para a oferta.
    const other = site.origin.replace("127.0.0.1", "localhost");
    await context.route(`${other}/indicacao`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<a id="ir" href="${site.origin}/?utm_source=blog">Ver oferta</a>`,
      }),
    );
    await page.goto(`${other}/indicacao`);
    await page.click("#ir");
    const url = await settledUrl(page);
    expect(url.pathname).toBe("/oferta-b/");
    expect(url.search).toBe("?utm_source=blog");
    // O divisor guardou a origem (os_ref) e o script de chegada da versão a devolveu ao
    // document.referrer (sem isso, a versão veria o divisor como origem); a chave já saiu.
    expect(await page.evaluate(() => document.referrer)).toBe(`${other}/`);
    expect(await page.evaluate(() => sessionStorage.getItem("os_ref"))).toBeNull();
    await context.close();
  }, 60_000);
});
