/**
 * Fase 4 — refix 4 do script de rastreamento (Chromium de verdade, sem internet):
 *
 * - regra "ao rolar X%": imagens "lazy" sem altura, mas com borda, padding
 *   (img-thumbnail do Bootstrap, também com box-sizing: border-box) ou
 *   min-height, ainda vão crescer a página — a regra não dispara sem rolar;
 * - "submit" criado pela página (form.dispatchEvent) com o pixel ainda
 *   carregando: o formulário não é enviado (o navegador não envia; o
 *   rastreamento também não); o envio de verdade continua esperando o pixel.
 *
 * Caminho real da prévia/ZIP: composeTrackingConfig + renderPageHtml (modo live).
 */
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderPageHtml } from "@/lib/page-render";
import { inlineTrackingScriptTag } from "@/lib/runtime-bundle";
import { composeTrackingConfig, type TrackingSourceRule } from "@/lib/tracking/compose";
import { parseTrackingSettings } from "@/lib/tracking/schema";

const SITE = "http://site.test";
const META_URL = "https://connect.facebook.net/";
/** fbevents.js local: anota cada chamada em window.__calls. */
const FBEVENTS = `(function(){var c=window.__calls=window.__calls||[];var q=fbq.queue.slice();fbq.queue.length=0;
  fbq.callMethod=function(){c.push(["fbq"].concat([].slice.call(arguments)))};
  q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`;

function page(opts: { consent: "OPT_IN" | "NOTICE" | "OFF"; rules: Partial<TrackingSourceRule>[]; body: string }) {
  const settings = parseTrackingSettings({ consent: { mode: opts.consent } });
  const config = composeTrackingConfig({
    mode: "live",
    settings,
    pixels: [{ vendor: "META", pixelId: "123456789012345", enabled: true, options: {} }],
    rules: opts.rules.map((r) => ({
      pageId: null,
      event: "LEAD",
      trigger: "PAGE_LOAD",
      value: null,
      selector: null,
      enabled: true,
      ...r,
    })) as TrackingSourceRule[],
    links: [],
    pageId: "p1",
    policyUrl: null,
    test: null,
    serverEndpoint: null,
  });
  return renderPageHtml(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Oferta</title></head><body>${opts.body}</body></html>`,
    {
      links: [],
      pageHref: (id) => `/p/${id}`,
      runtimeTag: "",
      tracking: { config, scriptTag: inlineTrackingScriptTag(), offerCode: null },
    },
  );
}

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

interface Site {
  page: Page;
  context: BrowserContext;
  /** Páginas do site abertas (navegações). */
  navigations: string[];
  errors: string[];
}

async function open(
  html: string,
  opts: {
    /** Arquivos do site (caminho → [tipo, conteúdo, atraso ms]). */
    files?: Record<string, [string, string, number?]>;
    pages?: Record<string, string>;
    /** Atraso do fbevents.js (ms). */
    metaDelay?: number;
    viewport?: { width: number; height: number };
  } = {},
): Promise<Site> {
  const context = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 800 } });
  const page = await context.newPage();
  const site: Site = { page, context, navigations: [], errors: [] };
  page.on("pageerror", (e) => site.errors.push(String(e)));
  const pages: Record<string, string> = { "/oferta": html, ...opts.pages };
  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === SITE) {
      if (req.isNavigationRequest()) site.navigations.push(req.url());
      if (pages[url.pathname] !== undefined) {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: pages[url.pathname] });
      }
      const file = opts.files?.[url.pathname];
      if (file) {
        if (file[2]) await new Promise((r) => setTimeout(r, file[2]));
        return route.fulfill({ contentType: file[0], body: file[1] }).catch(() => undefined);
      }
      return route.fulfill({ status: 404, body: "" });
    }
    if (req.url().startsWith(META_URL)) {
      if (opts.metaDelay) await new Promise((r) => setTimeout(r, opts.metaDelay));
      return route.fulfill({ contentType: "application/javascript", body: FBEVENTS }).catch(() => undefined);
    }
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto(`${SITE}/oferta`, { waitUntil: "domcontentloaded" });
  return site;
}

const fbEvents = (p: Page) =>
  p.evaluate(() =>
    ((window as { __calls?: unknown[][] }).__calls ?? []).filter((c) => c[1] === "track").map((c) => c[2]),
  );

describe("refix 4: rolagem com imagens 'lazy' sem altura, mas com borda, padding ou min-height", () => {
  const SLICE =
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800"/></svg>';
  /** 20 fatias: a primeira chega logo (é ela que antes fazia a regra disparar), as outras 1,5 s depois. */
  const files: Record<string, [string, string, number?]> = Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [`/s${i}.svg`, ["image/svg+xml", SLICE, i === 0 ? 0 : 1500]]),
  );
  const slices = (attrs = "") =>
    Array.from({ length: 20 }, (_, i) => `<img src="/s${i}.svg" loading="lazy" alt="Fatia ${i + 1}"${attrs}>`).join("");
  const rules = [{ event: "VIEW_CONTENT" as const, trigger: "SCROLL_DEPTH" as const, value: 50 }];

  const variants: Record<string, string> = {
    "borda de 1px": `<style>body{margin:0}img{display:block;border:1px solid #eee}</style>${slices()}`,
    "img-thumbnail do Bootstrap": `<style>body{margin:0}.img-thumbnail{padding:.25rem;border:1px solid #dee2e6;max-width:100%;height:auto}</style>${slices(' class="img-thumbnail"')}`,
    "img-thumbnail com box-sizing: border-box (Bootstrap inteiro)": `<style>*,::before,::after{box-sizing:border-box}body{margin:0}img{display:block}.img-thumbnail{padding:.25rem;border:1px solid #dee2e6;max-width:100%;height:auto}</style>${slices(' class="img-thumbnail"')}`,
    "min-height de 1px": `<style>body{margin:0}img{display:block;min-height:1px}</style>${slices()}`,
  };

  for (const [label, body] of Object.entries(variants)) {
    it(`${label}: não dispara sem rolar; rolando até o fim, dispara`, async () => {
      const site = await open(page({ consent: "OFF", rules, body }), { files, viewport: { width: 390, height: 844 } });
      const { page: p } = site;
      await expect.poll(() => fbEvents(p)).toEqual(["PageView"]);
      // A primeira fatia já carregou e as outras ainda não (a página ainda vai crescer).
      await expect.poll(() => p.evaluate(() => (document.images[0] as HTMLImageElement).complete)).toBe(true);
      await p.waitForTimeout(400);
      expect(await p.evaluate(() => [scrollY, document.images[1].complete])).toEqual([0, false]);
      expect(await fbEvents(p)).toEqual(["PageView"]);
      // Todas carregaram: a página é longa e ninguém rolou.
      await expect
        .poll(() => p.evaluate(() => [...document.images].every((i) => i.complete)), { timeout: 8000 })
        .toBe(true);
      await p.waitForTimeout(300);
      expect(await fbEvents(p)).toEqual(["PageView"]);
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(() => fbEvents(p)).toEqual(["PageView", "ViewContent"]);
      expect(site.errors).toEqual([]);
      await site.context.close();
    });
  }

  it("página de vendas com depoimentos em print (img-thumbnail, sem width/height): nada a 0 de rolagem", async () => {
    const shot =
      '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><rect width="720" height="1280"/></svg>';
    const deps: Record<string, [string, string, number?]> = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`/dep${i}.svg`, ["image/svg+xml", shot, 400]]),
    );
    const body = `<style>body{margin:0;font:16px/1.5 sans-serif}.c{max-width:720px;margin:auto;padding:16px}.img-thumbnail{padding:.25rem;background:#fff;border:1px solid #dee2e6;border-radius:.25rem;max-width:100%;height:auto}.v{position:relative;padding-top:56.25%}.v iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style>
<div class="c"><h1>Descubra o método</h1><div class="v"><iframe src="about:blank" title="vídeo"></iframe></div>
<p>${"Texto de venda. ".repeat(40)}</p><h2>Depoimentos</h2>
${Array.from({ length: 8 }, (_, i) => `<p><img class="img-thumbnail" src="/dep${i}.svg" loading="lazy" alt="Depoimento ${i + 1}"></p>`).join("")}
<p><a href="https://pay.hotmart.com/X1">Quero comprar</a></p></div>`;
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 800 },
    ]) {
      const site = await open(page({ consent: "OFF", rules, body }), { files: deps, viewport });
      await expect.poll(() => fbEvents(site.page)).toEqual(["PageView"]);
      await site.page.waitForTimeout(2500);
      expect(await fbEvents(site.page), JSON.stringify(viewport)).toEqual(["PageView"]);
      expect(await site.page.evaluate(() => scrollY)).toBe(0);
      await site.context.close();
    }
  });

  it("imagem 'lazy' com altura reservada (width/height, CSS ou aspect-ratio) numa página curta: dispara ao carregar", async () => {
    const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
    // A segunda imagem nunca carrega (fora do carrossel): com altura reservada, ela não segura a regra.
    const hidden = (style: string, attrs = "") =>
      `<div style="width:300px;overflow:hidden"><div style="display:flex;width:600px"><img src="/a.svg" loading="lazy" width="300" height="100" alt=""><img src="/b.svg" loading="lazy" alt=""${attrs} style="margin-left:2000px;${style}"></div></div>`;
    for (const [label, extra] of [
      [
        "width/height com borda e border-box",
        hidden("box-sizing:border-box;padding:4px;border:1px solid", ' width="300" height="100"'),
      ],
      ["altura no CSS", hidden("height:120px;border:1px solid")],
      ["aspect-ratio", hidden("width:300px;aspect-ratio:3/1;padding:4px")],
    ] as const) {
      const site = await open(page({ consent: "OFF", rules, body: `<h1>Obrigado!</h1>${extra}` }), {
        files: { "/a.svg": ["image/svg+xml", SVG] },
      });
      await expect.poll(() => fbEvents(site.page), { message: label }).toEqual(["PageView", "ViewContent"]);
      // Disparou com a imagem fora do carrossel ainda sem carregar (a altura reservada basta).
      expect(await site.page.evaluate(() => document.images[1].complete), label).toBe(false);
      await site.context.close();
    }
  });
});

describe("refix 4: 'submit' criado pela página com o pixel ainda carregando", () => {
  const body = `<form id="f" action="/enviado"><input name="email" value="ana@example.com"><button type="button" id="avisar">Avisar</button></form>
<script>document.getElementById("avisar").addEventListener("click",function(){
  window.__avisos=(window.__avisos||0)+1;
  document.getElementById("f").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
})</script>
<form id="g" action="/enviado2"><input name="email" value="ana@example.com"><button id="real">Enviar de verdade</button></form>
<script>addEventListener("pagehide",function(){sessionStorage.setItem("calls",JSON.stringify(window.__calls||[]))})</script>`;
  const pages = { "/enviado": "<h1>enviado</h1>", "/enviado2": "<h1>enviado2</h1>" };
  const rules = [{ event: "LEAD" as const, trigger: "FORM_SUBMIT" as const }];

  it("dispatchEvent(new Event('submit')): a página não sai (o navegador também não enviaria); o Lead conta", async () => {
    const site = await open(page({ consent: "NOTICE", rules, body }), { metaDelay: 700, pages });
    const { page: p } = site;
    await p.waitForTimeout(150);
    await p.click("#avisar");
    await p.waitForTimeout(1800);
    expect(p.url()).toBe(`${SITE}/oferta`);
    expect(site.navigations).toEqual([`${SITE}/oferta`]);
    expect(await p.evaluate(() => (window as { __avisos?: number }).__avisos)).toBe(1);
    expect(await fbEvents(p)).toEqual(["PageView", "Lead"]);
    expect(site.errors).toEqual([]);
    await site.context.close();
  });

  it("envio de verdade com o pixel carregando: espera o pixel e envia (com os campos)", async () => {
    const site = await open(page({ consent: "NOTICE", rules, body }), { metaDelay: 700, pages });
    const { page: p } = site;
    await p.waitForTimeout(150);
    await p.click("#real");
    await p.waitForURL(/\/enviado2/);
    expect(site.navigations).toEqual([`${SITE}/oferta`, `${SITE}/enviado2?email=ana%40example.com`]);
    // O Lead saiu para o pixel antes de a página trocar.
    const kept = JSON.parse((await p.evaluate(() => sessionStorage.getItem("calls"))) ?? "[]") as unknown[][];
    expect(kept.filter((c) => c[1] === "track").map((c) => c[2])).toEqual(["PageView", "Lead"]);
    await site.context.close();
  });
});
