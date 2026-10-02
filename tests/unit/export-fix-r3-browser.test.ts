/**
 * Origem da visita depois do divisor A/B, em Chromium, WebKit (Safari) e
 * Firefox de verdade (3ª rodada de correções).
 *
 * O divisor manda o visitante para a pasta da versão com location.replace, e o
 * navegador passa a mostrar o próprio site (o divisor) como document.referrer
 * na página da versão: o GA4 contaria a visita do Instagram/Google/WhatsApp sem
 * UTMs como "direta". O divisor guarda a origem (sessionStorage "os_ref") e o
 * script de chegada da página da versão a devolve ao document.referrer antes
 * do rastreamento — aqui, um "rastreamento" de mentira (inline no <head> e um
 * script assíncrono, como o gtag.js) anota o que vê.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type Browser, type BrowserType, chromium, firefox, type Page, webkit } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { earlyScriptTag } from "@/lib/export/head";
import { splitterHtml } from "@/lib/export/splitter";

const VARIANTS = [
  { folder: "oferta-a/", weight: 50, id: "ia" },
  { folder: "oferta-b/", weight: 50, id: "ib" },
];

/** O que o "rastreamento" anota: o inline logo depois do script de chegada e o assíncrono (gtag.js). */
const TRACKER = '<script>window.__inline=document.referrer</script><script async src="/rastreio.js"></script>';

const page = (title: string, early: string, links = "") =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">${early}${TRACKER}<title>${title}</title></head><body><h1>${title}</h1>${links}</body></html>`;

const version = (name: "A" | "B") =>
  page(
    `Versão ${name}`,
    earlyScriptTag({ ab: { key: "k", folder: `oferta-${name.toLowerCase()}/`, id: `i${name.toLowerCase()}`, up: 1 } }),
    '<a id="upsell" href="../upsell/">Upsell</a>',
  );

const FILES: Record<string, string> = {
  "/": splitterHtml({ variants: VARIANTS, key: "k", title: "Oferta", lang: "pt-BR" }),
  "/oferta-a/": version("A"),
  "/oferta-b/": version("B"),
  "/upsell/": page("Upsell", earlyScriptTag({})),
};

let server: Server;
let origin = "";
let other = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    if (pathname === "/rastreio.js") {
      res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
      res.end("window.__async=document.referrer;");
      return;
    }
    const body = FILES[pathname];
    res.writeHead(body ? 200 : 404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(body ?? "não encontrada");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
  // Outro site (outra origem): localhost × 127.0.0.1.
  other = `http://localhost:${port}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
});

/** Espera a página parar de redirecionar (o mesmo endereço por um instante). */
async function settledUrl(p: Page): Promise<URL> {
  let last = "";
  for (let i = 0; i < 40; i++) {
    await p.waitForLoadState("load").catch(() => {});
    const now = p.url();
    if (now === last) return new URL(now);
    last = now;
    await p.waitForTimeout(150);
  }
  return new URL(p.url());
}

const seen = (p: Page) =>
  p
    .waitForFunction(() => "__async" in window)
    .then(() =>
      p.evaluate(() => {
        const w = window as unknown as { __inline: string; __async: string };
        return { inline: w.__inline, async: w.__async, now: document.referrer, key: sessionStorage.getItem("os_ref") };
      }),
    );

const ENGINES: [string, BrowserType][] = [
  ["Chromium", chromium],
  ["WebKit (Safari)", webkit],
  ["Firefox", firefox],
];

describe.each(ENGINES)("%s", (_name, engine) => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await engine.launch();
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
  });

  async function visitor(random: number) {
    const context = await browser.newContext();
    await context.route(
      (url) => url.hostname !== "127.0.0.1" && url.hostname !== "localhost",
      (route) => route.abort(),
    );
    await context.addInitScript(`Math.random = () => ${random};`);
    // O "outro site": uma página com um link para a oferta.
    await context.route(`${other}/post`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><a id="ir" href="${origin}/?utm_campaign=bio">Ver oferta</a>`,
      }),
    );
    return context;
  }

  it("de outro site pelo divisor: a página da versão (e o rastreamento) veem o outro site, uma vez só", async () => {
    const context = await visitor(0.9);
    const p = await context.newPage();
    await p.goto(`${other}/post`);
    await p.click("#ir");
    const url = await settledUrl(p);
    expect(url.pathname).toBe("/oferta-b/");
    expect(url.search).toBe("?utm_campaign=bio");
    const atVersion = await seen(p);
    // O navegador manda só a origem (strict-origin-when-cross-origin): é o que o GA4 veria sem o divisor.
    expect(atVersion).toEqual({ inline: `${other}/`, async: `${other}/`, now: `${other}/`, key: null });

    // Página seguinte do funil: a origem é a página anterior, como sempre.
    await p.click("#upsell");
    expect((await settledUrl(p)).pathname).toBe("/upsell/");
    const atUpsell = await seen(p);
    expect(atUpsell.inline).toBe(`${origin}/oferta-b/?utm_campaign=bio`);
    expect(atUpsell.async).toBe(atUpsell.inline);
    expect(atUpsell.key).toBeNull();
    await context.close();
  }, 60_000);

  it("visita direta ao divisor (sem origem): a versão continua sem origem de outro site", async () => {
    const context = await visitor(0.1);
    const p = await context.newPage();
    await p.goto(`${origin}/`);
    expect((await settledUrl(p)).pathname).toBe("/oferta-a/");
    const atVersion = await seen(p);
    // Sem origem guardada, nada muda: o navegador mostra o divisor (o próprio site).
    expect(atVersion.inline).toBe(`${origin}/`);
    expect(atVersion.async).toBe(`${origin}/`);
    expect(atVersion.key).toBeNull();
    await context.close();
  }, 60_000);

  it("origem que sobrou na aba (redirecionamento interrompido): o endereço digitado depois não a herda", async () => {
    const context = await visitor(0.1);
    const p = await context.newPage();
    await p.goto(`${origin}/upsell/`);
    // Guardada há 5 minutos por um redirecionamento que não chegou ao fim.
    await p.evaluate(() => sessionStorage.setItem("os_ref", `${Date.now() - 5 * 60_000}|https://velho.example/`));
    // Endereço digitado na mesma aba: sem origem nenhuma (como sem o ZIP).
    await p.goto(`${origin}/oferta-a/`);
    expect((await settledUrl(p)).pathname).toBe("/oferta-a/");
    expect(await seen(p)).toEqual({ inline: "", async: "", now: "", key: null });
    await context.close();
  }, 60_000);

  it("anúncio direto na pasta da versão: vale a origem do navegador (nada guardado é usado)", async () => {
    const context = await visitor(0.1);
    const p = await context.newPage();
    // Origem velha guardada nesta aba (de uma visita anterior que não chegou ao fim).
    await p.goto(`${origin}/upsell/`);
    await p.evaluate(() => sessionStorage.setItem("os_ref", "https://velho.example/"));
    await context.route(`${other}/anuncio`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><a id="ir" href="${origin}/oferta-b/">Ver</a>`,
      }),
    );
    await p.goto(`${other}/anuncio`);
    await p.click("#ir");
    expect((await settledUrl(p)).pathname).toBe("/oferta-b/");
    const atVersion = await seen(p);
    expect(atVersion.inline).toBe(`${other}/`);
    expect(atVersion.key).toBeNull();
    await context.close();
  }, 60_000);
});
