/**
 * Fase 4 — rastreamento no HTML final (src/lib/tracking/inject.ts) e no
 * renderizador (src/lib/page-render.ts): posição no <head>, JSON seguro,
 * código que espera o consentimento. Parte roda num Chromium de verdade (sem
 * rede externa: tudo que não é a página de teste é recusado).
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderPageHtml } from "@/lib/page-render";
import { TRACKING_SCRIPT_TAG, trackingScript } from "@/lib/runtime-bundle";
import { applySeo, seoRenderFrom } from "@/lib/seo-render";
import { composeTrackingConfig } from "@/lib/tracking/compose";
import { gateCode, injectTracking, serializeTrackingConfig, stripTracking } from "@/lib/tracking/inject";
import type { TrackingRuntimeConfig } from "@/lib/tracking/runtime-config";
import { parseTrackingSettings } from "@/lib/tracking/schema";

const TAG = '<script src="/os-tracking.js" data-os-tracking></script>';

function config(overrides: Partial<TrackingRuntimeConfig> = {}): TrackingRuntimeConfig {
  return {
    ...composeTrackingConfig({
      mode: "preview",
      settings: parseTrackingSettings({}),
      pixels: [{ vendor: "META", pixelId: "123456789012345", enabled: true, options: {} }],
      rules: [],
      links: [],
      pageId: null,
      policyUrl: null,
    }),
    ...overrides,
  };
}

describe("serializeTrackingConfig", () => {
  it("não deixa </script>, <!--, & nem U+2028/2029 crus, e volta igual no JSON.parse", () => {
    const nasty = "</script><script>alert(1)</script><!-- & \u2028 \u2029 ' \"";
    const cfg = config({ consent: { ...config().consent, text: nasty } });
    const json = serializeTrackingConfig(cfg);
    expect(json).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(json)).toEqual(cfg);
  });
});

describe("injectTracking", () => {
  it("entra logo depois das metas de charset/viewport, antes de qualquer script/estilo", () => {
    const html = `<!DOCTYPE html><html><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>Oferta</title>
  <meta name="description" content="x">
  <script src="/app.js"></script>
</head><body>oi</body></html>`;
    const out = injectTracking(html, config(), TAG);
    const at = out.indexOf('id="os-tracking"');
    expect(at).toBeGreaterThan(out.indexOf('name="viewport"'));
    expect(at).toBeLessThan(out.indexOf("<title>"));
    expect(out.indexOf(TAG)).toBeGreaterThan(at);
    expect(out.indexOf(TAG)).toBeLessThan(out.indexOf('src="/app.js"'));
  });

  it("sem metas: logo depois do <head>; metas depois de um script não contam", () => {
    const html = "<html><head><script>var a=1</script><meta charset=utf-8></head><body></body></html>";
    const out = injectTracking(html, config(), TAG);
    expect(out.startsWith('<html><head><meta charset="utf-8"><script type="application/json" id="os-tracking">')).toBe(
      true,
    );
    // <head> com atributos e "http-equiv" com charset também servem de âncora.
    const withEquiv = injectTracking(
      '<html><head lang="pt"><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><link rel="stylesheet" href="a.css"></head></html>',
      config(),
      TAG,
    );
    expect(withEquiv).toMatch(/charset=utf-8"><script type="application\/json" id="os-tracking">/);
  });

  it("sem <head>: cria um (depois do <html>, do doctype ou no começo)", () => {
    expect(injectTracking("<html><body>x</body></html>", config(), TAG)).toMatch(
      /^<html><head><meta charset="utf-8"><script type="application\/json" id="os-tracking">[\s\S]*data-os-tracking><\/script><\/head><body>/,
    );
    expect(injectTracking("<!doctype html><p>x</p>", config(), TAG)).toMatch(
      /^<!doctype html><head><meta charset="utf-8"><script/,
    );
    expect(injectTracking("<p>x</p>", config(), TAG)).toMatch(
      /^<head><meta charset="utf-8"><script type="application\/json"/,
    );
  });

  it("charset: não repete quando a página já declara no começo; declara quando vem tarde demais", () => {
    const early = injectTracking('<html><head><meta charset="utf-8"><title>t</title></head></html>', config(), TAG);
    expect(early.match(/charset/gi)).toHaveLength(1);
    // Charset depois de um script: o JSON o empurraria para além dos 1024 bytes.
    const late = injectTracking(
      '<html><head><script>1</script><meta charset="iso-8859-1"></head></html>',
      config(),
      TAG,
    );
    expect(late.indexOf('<meta charset="utf-8">')).toBeLessThan(200);
    expect(late.indexOf('<meta charset="utf-8">')).toBeLessThan(late.indexOf('id="os-tracking"'));
  });

  it("<header> no corpo não é confundido com <head>", () => {
    const out = injectTracking("<body><header>topo</header></body>", config(), TAG);
    expect(out.indexOf("os-tracking")).toBeLessThan(out.indexOf("<body>"));
  });

  it("troca um rastreamento anterior (página clonada de um ZIP do Offer Studio) e é idempotente", () => {
    const old = `<html><head><meta charset="utf-8"><script type="application/json" id="os-tracking">{"v":1,"mode":"live","antigo":true}</script><script data-os-tracking>/*antigo*/</script><title>t</title></head><body></body></html>`;
    const once = injectTracking(old, config(), TAG);
    expect(once).not.toContain("antigo");
    expect(once.match(/id="os-tracking"/g)).toHaveLength(1);
    const twice = injectTracking(once, config({ mode: "test" }), TAG);
    expect(twice.match(/id="os-tracking"/g)).toHaveLength(1);
    expect(twice.match(/data-os-tracking/g)).toHaveLength(1);
    expect(twice).toContain('"mode":"test"');
    // Não mexe em scripts parecidos.
    const keep =
      '<script id="os-tracking-extra">1</script><script data-os-tracking-x>2</script><div data-id="os-tracking"></div>';
    expect(stripTracking(keep)).toBe(keep);
  });
});

/** Bloco em espera como o gateCode monta: o código em JSON seguro dentro de <script type="application/json">. */
function gatedBlock(category: "analytics" | "marketing", code: string) {
  const json = JSON.stringify(code)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<script type="application/json" data-os-consent="${category}" data-os-block>${json}</script>`;
}

/** O código de volta de um bloco em espera (null = não é um bloco inteiro). */
function blockCode(out: string): string | null {
  const m =
    /^<script type="application\/json" data-os-consent="(?:analytics|marketing)" data-os-block>([\s\S]*)<\/script>$/.exec(
      out,
    );
  if (!m) return null;
  expect(m[1]).not.toMatch(/[<>&\u2028\u2029]/);
  return JSON.parse(m[1]);
}

describe("gateCode", () => {
  it("Essencial: código volta igual", () => {
    const code = '<script src="https://x.com/a.js"></script><img src="https://x.com/p.gif">';
    expect(gateCode(code, "NECESSARY")).toBe(code);
  });

  it("Estatística/Marketing: o código inteiro vai, igual, em JSON num <script type=application/json> com a categoria", () => {
    const code = [
      "<script>fbq('init','1')</script>",
      '<script async src="https://connect.facebook.net/en_US/fbevents.js"></script>',
      '<link rel="preload" href="https://connect.facebook.net/en_US/fbevents.js" as="script">',
      '<noscript><img src="https://www.facebook.com/tr?id=1&amp;ev=PageView&noscript=1"/></noscript>',
    ].join("\n");
    expect(gateCode(code, "MARKETING")).toBe(gatedBlock("marketing", code));
    expect(blockCode(gateCode(code, "MARKETING"))).toBe(code);
    expect(gateCode("<script>a()</script>", "ANALYTICS")).toBe(
      '<script type="application/json" data-os-consent="analytics" data-os-block>"\\u003cscript\\u003ea()\\u003c/script\\u003e"</script>',
    );
  });

  it("nenhum <template> (o pré-carregamento do Firefox busca as imagens de dentro dele); nada que feche o bloco", () => {
    for (const code of [
      '<!-- cole o <script> abaixo -->\n<script src="https://tracker.example/t.js"></script>',
      '<img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=1&ev=PageView&noscript=1">',
      '<picture><source srcset="https://tracker.example/p.webp"><img src="https://tracker.example/p.jpg"></picture>',
      '<video poster="https://tracker.example/poster.jpg"></video><svg><image href="https://tracker.example/s.png"/></svg>',
      '<div title="<script>">x</div><script>var s = "</template>";</script>',
      '<svg><![CDATA[ a>b </template>]]></svg><img src="https://tracker.example/px.gif">',
      '<p>a</p></template><img src="https://tracker.example/px.gif"></script><!-- \u2028 \u2029 -->',
    ]) {
      const out = gateCode(code, "MARKETING");
      expect(out, code).not.toContain("<template");
      expect(out.match(/<\/script/gi), code).toHaveLength(1);
      expect(blockCode(out), code).toBe(code);
    }
  });
});

describe("renderPageHtml com rastreamento", () => {
  const page =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>P</title></head><body><h1>Oi</h1></body></html>';
  const pageCode = {
    head: "<script>window.headCode=1</script>",
    bodyStart: "",
    bodyEnd: "<script>window.endCode=1</script>",
  };
  const META_BASE =
    "<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){};t=b.createElement(e);t.src=v;b.head.appendChild(t)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','123456789012345');fbq('track','PageView');</script>";
  const render = (opts: {
    code?: { head?: string; bodyEnd?: string; category?: "NECESSARY" | "ANALYTICS" | "MARKETING" | null };
    mode?: "live" | "preview" | "test";
    consent?: "OPT_IN" | "NOTICE" | "OFF";
    offerCode?: { head?: string; category: "NECESSARY" | "MARKETING" };
  }) =>
    renderPageHtml(page, {
      links: [],
      pageHref: () => "#",
      runtimeTag: "<script data-os-runtime></script>",
      customCode: opts.code ?? null,
      tracking: {
        config: config({
          mode: opts.mode ?? "preview",
          consent: { ...config().consent, mode: opts.consent ?? "OPT_IN" },
        }),
        scriptTag: TAG,
        offerCode: opts.offerCode ?? null,
      },
    });
  const configOf = (html: string) =>
    JSON.parse(/<script type="application\/json" id="os-tracking">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "null");

  it("sem rastreamento: igual à Fase 3 (códigos rodam direto, sem configuração)", () => {
    const out = renderPageHtml(page, {
      links: [],
      pageHref: () => "#",
      runtimeTag: "<script data-os-runtime></script>",
      customCode: { ...pageCode, category: "MARKETING" },
    });
    expect(out).toContain("<script>window.headCode=1</script>");
    expect(out).not.toContain("os-tracking");
    expect(out).not.toContain("data-os-consent");
  });

  it("com rastreamento: configuração no começo do <head>, código da oferta antes do da página, categorias aplicadas", () => {
    const out = renderPageHtml(page, {
      links: [],
      pageHref: () => "#",
      runtimeTag: "<script data-os-runtime></script>",
      customCode: { ...pageCode, category: "NECESSARY" },
      tracking: {
        config: config(),
        scriptTag: TAG,
        offerCode: {
          head: "<script>window.offerHead=1</script>",
          bodyStart: "<noscript><img src=https://t.example/p.gif></noscript>",
          bodyEnd: "<script>",
          category: "MARKETING",
        },
      },
    });
    expect(out.indexOf('id="os-tracking"')).toBeLessThan(out.indexOf("<title>"));
    // Código da oferta (Marketing) espera; o da página (Essencial) roda direto.
    expect(out).toContain(gatedBlock("marketing", "<script>window.offerHead=1</script>"));
    expect(out).toContain("<script>window.headCode=1</script>");
    expect(out.indexOf("window.offerHead")).toBeLessThan(out.indexOf("window.headCode"));
    expect(out).toContain(gatedBlock("marketing", "<noscript><img src=https://t.example/p.gif></noscript>"));
    // Código da oferta que não fecha fica de fora sem derrubar o da página.
    expect(out).toContain("<script>window.endCode=1</script>");
    expect(out).toContain("<script data-os-runtime></script>");
    // O aviso de cookies sabe que há código de marketing (mesmo sem pixels).
    expect(configOf(out).marketingCode).toBe(true);
  });

  it("código da página sem categoria escolhida: com pixel da Meta espera o Aceitar; sem pixel roda direto; escolha explícita vale", () => {
    const auto = render({ code: { head: META_BASE } });
    expect(auto).toContain(gatedBlock("marketing", META_BASE));
    expect(configOf(auto).marketingCode).toBe(true);
    const plain = render({ code: { head: "<script>window.chat=1</script>" } });
    expect(plain).toContain("<script>window.chat=1</script>");
    expect(plain).not.toContain("data-os-consent");
    expect(configOf(plain).marketingCode).toBe(false);
    const chosen = render({ code: { head: META_BASE, category: "NECESSARY" } });
    expect(chosen).not.toContain("data-os-consent");
    expect(chosen).toContain(META_BASE);
  });

  it("página publicada com 'Só avisar' ou sem aviso: o código roda no lugar dele; 'Pedir permissão', prévia e teste esperam", () => {
    const code = { head: "<script>window.mkt=1</script>", category: "MARKETING" as const };
    for (const consent of ["NOTICE", "OFF"] as const) {
      const out = render({ code, mode: "live", consent });
      expect(out, consent).toMatch(/<script>window\.mkt=1<\/script>\s*(?:<style[^>]*>[^<]*<\/style>)?<\/head>/);
      expect(out, consent).not.toContain("data-os-consent");
      // O aviso "Só avisar" ainda aparece por causa do código de marketing.
      expect(configOf(out).marketingCode, consent).toBe(true);
    }
    for (const [mode, consent] of [
      ["live", "OPT_IN"],
      ["preview", "NOTICE"],
      ["test", "OFF"],
    ] as const) {
      expect(render({ code, mode, consent }), `${mode} ${consent}`).toContain(
        gatedBlock("marketing", "<script>window.mkt=1</script>"),
      );
    }
  });
});

describe("SEO no HTML (applySeo)", () => {
  const html = `<!DOCTYPE html><html lang="en" class="x"><head><meta charset="utf-8"><title>Original</title>
<meta name="description" content="velha"><meta property="og:image" content="https://old/og.png"><meta property="og:image:width" content="10">
<link rel="icon" href="/old.ico"><link rel="shortcut icon" href="/old2.ico"><link rel="stylesheet" href="/a.css"><meta name="robots" content="index"></head><body><svg><title>svg</title></svg></body></html>`;

  it("troca título, descrição, og:image, favicon, noindex e idioma; mantém o resto", () => {
    const out = applySeo(html, {
      title: 'Método X & "cia" <b>',
      description: "Aprenda em 7 dias",
      faviconHref: "/os-assets/fav.png",
      ogImageHref: "/os-assets/og.webp",
      noindex: true,
      lang: "pt-BR",
    });
    expect(out).toContain('<html class="x" lang="pt-BR">');
    expect(out.match(/<title>/g)).toHaveLength(2); // o <title> do SVG (no corpo) fica
    expect(out).toContain('<title>Método X &amp; "cia" &lt;b&gt;</title>');
    expect(out).not.toContain("Original");
    expect(out).toContain('<meta property="og:title" content="Método X &amp; &quot;cia&quot; &lt;b&gt;">');
    expect(out).toContain('<meta name="description" content="Aprenda em 7 dias">');
    expect(out).not.toContain("velha");
    expect(out).toContain('<meta property="og:image" content="/os-assets/og.webp">');
    expect(out).not.toContain("https://old/og.png");
    expect(out).not.toContain("og:image:width");
    expect(out).toContain('<link rel="icon" href="/os-assets/fav.png">');
    expect(out).not.toContain("old.ico");
    expect(out).not.toContain("old2.ico");
    expect(out).toContain('<link rel="stylesheet" href="/a.css">');
    expect(out).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(out).not.toContain('content="index"');
    expect(out.indexOf("<title>Método")).toBeLessThan(out.indexOf("</head>"));
  });

  it("campos vazios mantêm o que a página tem; sem <head> ou <html>, cria", () => {
    expect(applySeo(html, { title: "", description: "", noindex: false, lang: "" })).toBe(html);
    expect(applySeo(html, null)).toBe(html);
    expect(applySeo("<p>x</p>", { title: "T", lang: "es" })).toBe(
      '<html lang="es"><head></head><p>x</p>'.replace(
        "<head></head>",
        '<head><title>T</title><meta property="og:title" content="T"></head>',
      ),
    );
  });

  it("renderPageHtml aplica o SEO e seoRenderFrom converte as chaves do storage", () => {
    const sha = "a".repeat(64);
    const seo = seoRenderFrom(
      { title: "Oferta", description: "", faviconKey: `a/aa/${sha}.png`, ogImageKey: null, noindex: false },
      "pt-BR",
    );
    expect(seo.faviconHref).toBe(`/os-assets/${sha}.png`);
    const out = renderPageHtml(html, {
      links: [],
      pageHref: () => "#",
      runtimeTag: "<script data-os-runtime></script>",
      seo,
    });
    expect(out).toContain("<title>Oferta</title>");
    expect(out).toContain(`<link rel="icon" href="/os-assets/${sha}.png">`);
    expect(out).toContain('lang="pt-BR"');
    expect(out).toContain('<meta name="description" content="velha">');
  });
});

// ─── Navegador de verdade ───────────────────────────────────────────────────

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

/** Abre o HTML em http://site.test/ (sem rede: outros endereços são recusados e anotados). */
async function open(html: string): Promise<{ page: Page; requests: string[] }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests: string[] = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url === "http://site.test/") return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    if (url === "http://site.test/os-tracking.js") {
      return route.fulfill({ contentType: "text/javascript", body: trackingScript() });
    }
    requests.push(url);
    return route.abort();
  });
  await page.goto("http://site.test/");
  return { page, requests };
}

describe("no navegador", () => {
  it("o script lê a configuração intacta, mesmo com textos maliciosos", async () => {
    const nasty = '</script><script>window.pwned=1</script><!-- \u2028\u2029 & "aspas"';
    const cfg = config({ consent: { ...config().consent, text: nasty } });
    const html = injectTracking(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>x</p></body></html>',
      cfg,
      TRACKING_SCRIPT_TAG,
    );
    const { page } = await open(html);
    const read = await page.evaluate(() => JSON.parse(document.getElementById("os-tracking")?.textContent ?? "null"));
    expect(read).toEqual(cfg);
    expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();
    // O script de rastreamento é o primeiro script executável da página.
    const first = await page.evaluate(() => {
      const s = [...document.scripts].find((el) => el.type !== "application/json");
      return s?.getAttribute("src");
    });
    expect(first).toBe("/os-tracking.js");
    await page.context().close();
  });

  it("código em espera não roda nem carrega nada até ser ativado; ativado, roda igual ao original", async () => {
    const code = `<script>window.ran = (window.ran || 0) + 1</script><img src="https://pixel.example/p.gif"><iframe src="https://frame.example/"></iframe><link rel="preload" as="image" href="https://pixel.example/pre.gif">`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${gateCode(code, "MARKETING")}</body></html>`;
    const { page, requests } = await open(html);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as unknown as { ran?: number }).ran)).toBeUndefined();
    expect(requests.filter((u) => /pixel\.example|frame\.example/.test(u))).toEqual([]);

    // Ativação mínima (o que o script de rastreamento faz depois do "Aceitar").
    await page.evaluate(() => {
      const block = document.querySelector("script[data-os-consent][data-os-block]") as HTMLScriptElement;
      const t = document.createElement("template");
      t.innerHTML = JSON.parse(block.textContent ?? '""');
      const frag = document.importNode(t.content, true);
      for (const old of Array.from(frag.querySelectorAll("script"))) {
        const s = document.createElement("script");
        s.text = old.text;
        old.replaceWith(s);
      }
      block.replaceWith(frag);
    });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as unknown as { ran?: number }).ran)).toBe(1);
    expect(requests.some((u) => u.startsWith("https://pixel.example/"))).toBe(true);
    expect(requests.some((u) => u.startsWith("https://frame.example/"))).toBe(true);
    await page.context().close();
  });
});

describe("trackingScript", () => {
  it("compila o script de rastreamento (IIFE) sem arrastar zod, Prisma ou código de servidor", () => {
    const js = trackingScript();
    expect(js.length).toBeGreaterThan(0);
    expect(js.length).toBeLessThan(150_000);
    expect(js).not.toMatch(/ZodError|PrismaClient|node:crypto|require\(/);
    expect(TRACKING_SCRIPT_TAG).toBe('<script src="/os-tracking.js" data-os-tracking></script>');
  });
});
