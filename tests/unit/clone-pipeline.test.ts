/**
 * Integração dos módulos do clonador (Fase 2), sem rede e sem Chromium:
 * HTML de um site de teste → normalizeLazy → removeTrackers →
 * detectVideos/extractDelay → detectCheckouts/markCheckouts → suggestFunnel →
 * collectHtmlRefs → "download" (lido do disco) → rewriteHtmlRefs/rewriteCss.
 *
 * O download é falso: cada URL de *.fixture.test vira o arquivo em
 * tests/fixtures/sites/<site>/…, guardado num mapa como /os-assets/<sha>.<ext>.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";
import { parseSrcset } from "srcset";
import { describe, expect, it } from "vitest";
import { CHECKOUT_PLATFORMS } from "@/detection/checkouts";
import { matchVideoHost, parseVideoUrl } from "@/detection/videos";
import { decodeText } from "@/worker/clone/charset";
import { detectCheckouts, markCheckouts, matchCheckoutPlatform } from "@/worker/clone/checkouts";
import { collectCssRefs, findCssOccurrences, rewriteCss } from "@/worker/clone/css";
import { suggestFunnel } from "@/worker/clone/funnel";
import { collectHtmlRefs, rewriteHtmlRefs } from "@/worker/clone/html-assets";
import { normalizeLazy } from "@/worker/clone/lazy";
import { classifyInlineScript, classifyUrl, isTrackerHost, removeTrackers } from "@/worker/clone/trackers";
import { ASSET_PREFIX } from "@/worker/clone/types";
import { extensionFor } from "@/worker/clone/urls";
import { detectVideos, extractDelay, unhideDelayed } from "@/worker/clone/vsl";
import { contentTypeFor, ORIGIN_TOKEN, SITES_DIR, siteNameFromHost } from "../fixtures/server";

function originOf(site: string) {
  return `https://${site}.fixture.test`;
}

/** Charset declarado no _site.json (o servidor de teste manda no Content-Type). */
function siteCharset(site: string): string {
  const file = path.join(SITES_DIR, site, "_site.json");
  if (!existsSync(file)) return "utf-8";
  return (JSON.parse(readFileSync(file, "utf8")) as { charset?: string }).charset ?? "utf-8";
}

/** "Download" sem rede: lê o arquivo do site de teste (null = fora dos sites de teste). */
function fakeFetch(url: string): { body: Buffer; contentType: string } | null {
  const u = new URL(url);
  const site = siteNameFromHost(u.hostname);
  if (!site) return null;
  let rel = decodeURIComponent(u.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(SITES_DIR, site, rel);
  if (!file.startsWith(path.join(SITES_DIR, site)) || !existsSync(file) || !statSync(file).isFile()) return null;
  const contentType = contentTypeFor(file, siteCharset(site));
  let body = readFileSync(file);
  // Igual ao servidor de teste: __ORIGIN__ vira a origem do site (latin1 preserva os bytes).
  if (body.includes(ORIGIN_TOKEN))
    body = Buffer.from(body.toString("latin1").replaceAll(ORIGIN_TOKEN, u.origin), "latin1");
  return { body, contentType };
}

/** Storage falso, endereçado por hash, com o mesmo formato de caminho do clonador. */
class FakeStore {
  readonly files = new Map<string, Buffer>();
  readonly failed: string[] = [];
  private readonly done = new Map<string, string | null>();
  private readonly inProgress = new Set<string>();

  private put(body: Buffer, ext: string): string {
    const sha = createHash("sha256").update(body).digest("hex");
    const local = `${ASSET_PREFIX}${sha}.${ext}`;
    this.files.set(local, body);
    return local;
  }

  asset(url: string): string | null {
    if (this.done.has(url)) return this.done.get(url) ?? null;
    const got = fakeFetch(url);
    const local = got ? this.put(got.body, extensionFor(url, got.contentType)) : null;
    if (!local) this.failed.push(url);
    this.done.set(url, local);
    return local;
  }

  css(url: string): string | null {
    if (this.done.has(url)) return this.done.get(url) ?? null;
    if (this.inProgress.has(url)) return null;
    this.inProgress.add(url);
    const got = fakeFetch(url);
    let local: string | null = null;
    if (got) local = this.put(Buffer.from(this.cssText(decodeText(got.body, got.contentType).text, url)), "css");
    else this.failed.push(url);
    this.inProgress.delete(url);
    this.done.set(url, local);
    return local;
  }

  /** Baixa o que o CSS cita (@import recursivo) e reescreve os endereços. */
  cssText(css: string, baseUrl: string): string {
    const map = new Map<string, string>();
    for (const ref of collectCssRefs(css, baseUrl)) {
      const local = ref.kind === "import" ? this.css(ref.url) : this.asset(ref.url);
      if (local) map.set(ref.url, local);
    }
    return rewriteCss(css, baseUrl, (abs) => map.get(abs) ?? null);
  }
}

/** A sequência do construtor, na ordem em que ele vai chamar os módulos. */
function clonePage(site: string, pagePath = "/") {
  const pageUrl = `${originOf(site)}${pagePath}`;
  const page = fakeFetch(pageUrl);
  if (!page) throw new Error(`página ausente: ${pageUrl}`);
  const $ = cheerio.load(decodeText(page.body, page.contentType).text);

  const lazy = normalizeLazy($);
  const removed = removeTrackers($, pageUrl);
  const videos = detectVideos($, pageUrl);
  const delay = extractDelay($);
  const checkouts = detectCheckouts($, pageUrl);
  const marked = markCheckouts($, pageUrl, checkouts);
  const funnel = suggestFunnel($, pageUrl, new Set(checkouts.map((c) => c.url)));

  const refs = collectHtmlRefs($, pageUrl);
  const store = new FakeStore();
  const map = new Map<string, string>();
  for (const ref of refs) {
    // Iframes ficam externos (o construtor só informa).
    if (ref.kind === "iframe" || map.has(ref.url)) continue;
    const local = ref.kind === "stylesheet" ? store.css(ref.url) : store.asset(ref.url);
    if (local) map.set(ref.url, local);
  }
  rewriteHtmlRefs($, pageUrl, (abs) => map.get(abs) ?? null);

  return { $, pageUrl, lazy, removed, videos, delay, checkouts, marked, funnel, refs, store };
}

const isLocal = (value: string | undefined) => !!value && value.startsWith(ASSET_PREFIX);
const isInline = (value: string) => /^data:/i.test(value.trim());

/** Endereços de arquivo que ainda não viraram /os-assets/ (ignora data: e iframes). */
function unlocalized($: CheerioAPI): string[] {
  const bad: string[] = [];
  const check = (what: string, value: string | undefined) => {
    if (value === undefined || isInline(value) || isLocal(value)) return;
    bad.push(`${what}: ${value}`);
  };
  const checkSrcset = (what: string, value: string | undefined) => {
    for (const c of parseSrcset(value ?? "")) check(what, c.url);
  };
  const checkCss = (what: string, css: string, inline: boolean) => {
    for (const occ of findCssOccurrences(css, { inline })) check(what, occ.value);
  };

  $("img").each((_, el) => {
    check("img[src]", $(el).attr("src"));
    checkSrcset("img[srcset]", $(el).attr("srcset"));
  });
  $("source").each((_, el) => {
    check("source[src]", $(el).attr("src"));
    checkSrcset("source[srcset]", $(el).attr("srcset"));
  });
  $("video[poster]").each((_, el) => check("video[poster]", $(el).attr("poster")));
  $("link[href]").each((_, el) => {
    const rel = ($(el).attr("rel") ?? "").toLowerCase();
    if (/\b(?:stylesheet|icon|apple-touch-icon|preload|modulepreload)\b/.test(rel))
      check(`link[${rel}]`, $(el).attr("href"));
  });
  $('meta[property="og:image"], meta[name="twitter:image"]').each((_, el) => check("meta", $(el).attr("content")));
  $("[style]").each((_, el) => checkCss("style=''", $(el).attr("style") ?? "", true));
  $("style").each((_, el) => checkCss("<style>", $(el).text(), false));
  $("script[src]").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    // Scripts de terceiros (player da VSL) não estão nos sites de teste: ficam externos.
    if (/^https?:\/\/[^/]*\.fixture\.test\//i.test(src) || src.startsWith("/")) check("script", src);
  });
  return bad;
}

/** Referências externas que sobraram em todos os CSS guardados. */
function unlocalizedInCss(store: FakeStore): string[] {
  const bad: string[] = [];
  for (const [local, body] of store.files) {
    if (!local.endsWith(".css")) continue;
    for (const occ of findCssOccurrences(body.toString("utf8"))) {
      if (!isInline(occ.value) && !isLocal(occ.value)) bad.push(`${local}: ${occ.value}`);
    }
  }
  return bad;
}

/** Tudo que ainda parece rastreador no documento. */
function trackersLeft($: CheerioAPI, pageUrl: string): string[] {
  const left: string[] = [];
  $("script").each((_, el) => {
    const type = ($(el).attr("type") ?? "").toLowerCase();
    if (type.includes("json")) return;
    const src = $(el).attr("src");
    if (src && classifyUrl(src, pageUrl)) left.push(`script ${src}`);
    if (!src && classifyInlineScript($(el).html() ?? "")) left.push(`inline ${($(el).html() ?? "").slice(0, 60)}`);
  });
  $("img[src], iframe[src], link[href]").each((_, el) => {
    const url = $(el).attr("src") ?? $(el).attr("href") ?? "";
    if (classifyUrl(url, pageUrl)) left.push(`${el.tagName} ${url}`);
  });
  $("noscript").each((_, el) => {
    const inner = $(el).html() ?? "";
    for (const m of inner.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      if (classifyUrl((m[1] ?? "").replace(/&amp;/g, "&"), pageUrl)) left.push(`noscript ${m[1]}`);
    }
  });
  $('meta[name="facebook-domain-verification"], meta[name="google-site-verification"]').each((_, el) => {
    left.push(`meta ${$(el).attr("name")}`);
  });
  return left;
}

// ─── vendas ──────────────────────────────────────────────────────────────────

describe("pipeline — site 'vendas' (WordPress/Elementor)", () => {
  const r = clonePage("vendas");
  const origin = originOf("vendas");

  it("normaliza o lazy load antes de coletar (data-src, data-srcset, data-bg, Elementor)", () => {
    expect(r.lazy).toBeGreaterThanOrEqual(3);
    expect(r.refs.map((ref) => ref.url)).toEqual(
      expect.arrayContaining([
        `${origin}/wp-content/uploads/2024/05/bonus-1-480.jpg`,
        `${origin}/wp-content/uploads/2024/05/bonus-2-960.jpg`,
        `${origin}/wp-content/uploads/2024/05/faixa-bonus.jpg`,
      ]),
    );
    expect(r.$("[data-src], [data-srcset], [data-bg]")).toHaveLength(0);
    expect(r.$(".e-con.e-parent:not(.e-lazyloaded)")).toHaveLength(0);
  });

  it("não remove nada de uma página sem rastreadores", () => {
    expect(r.removed).toEqual([]);
    expect(r.$("script[src]")).toHaveLength(2);
    expect(r.$("#elementor-lazyload-observer")).toHaveLength(1);
  });

  it("sem vídeo e sem atraso", () => {
    expect(r.videos).toEqual([]);
    expect(r.delay).toBeNull();
  });

  it("acha os 2 checkouts da Hotmart e marca os 4 botões (WhatsApp fica de fora)", () => {
    const summary = r.checkouts.map((c) => [c.url, c.platform, c.occurrences, c.source, c.confidence]);
    expect(summary).toEqual([
      ["https://pay.hotmart.com/A12345678B?off=abc123&checkoutMode=10", "Hotmart", 3, "HREF", 100],
      ["https://pay.hotmart.com/A12345678B?off=def456&checkoutMode=10", "Hotmart", 1, "HREF", 100],
    ]);
    expect(r.marked).toBe(4);
    const marked = r.$("[data-os-checkout]");
    expect(marked).toHaveLength(4);
    marked.each((_, el) => {
      expect(r.$(el).attr("href")).toMatch(/^https:\/\/pay\.hotmart\.com\/A12345678B\?off=/);
    });
    expect(r.$('a[href^="https://wa.me/"]').attr("data-os-checkout")).toBeUndefined();
  });

  it("sugere upsell e obrigado, mas não a política de privacidade", () => {
    expect(r.funnel.map((f) => [f.url, f.kind])).toEqual([
      [`${origin}/obrigado`, "THANK_YOU"],
      [`${origin}/upsell`, "UPSELL"],
    ]);
    for (const f of r.funnel) expect(f.reason).toMatch(/costuma|indica|parece/);
  });

  it("todo arquivo (img, srcset, picture, CSS, ícones, og:image, style='') vira /os-assets/", () => {
    expect(r.store.failed).toEqual([]);
    expect(unlocalized(r.$)).toEqual([]);
    expect(r.$('meta[property="og:image"]').attr("content")).toMatch(/^\/os-assets\/[0-9a-f]{64}\.jpg$/);
    expect(r.$(".selo").attr("style")).toMatch(/url\('\/os-assets\/[0-9a-f]{64}\.png'\)/);
    expect(r.$(".faixa-bonus").attr("style")).toMatch(/background-image: url\("\/os-assets\/[0-9a-f]{64}\.jpg"\)/);
    // Links para páginas e checkouts continuam apontando para fora.
    expect(r.$('a[href="/upsell"]')).toHaveLength(1);
  });

  it("a cadeia @import e a fonte woff2 dos CSS também são reescritas", () => {
    expect(unlocalizedInCss(r.store)).toEqual([]);
    const cssFiles = [...r.store.files.keys()].filter((k) => k.endsWith(".css"));
    // style.css → base.css → tipografia.css + frontend.min.css + post-12.css
    expect(cssFiles.length).toBeGreaterThanOrEqual(5);
    expect([...r.store.files.keys()].some((k) => k.endsWith(".woff2"))).toBe(true);
    const all = [...r.store.files.entries()]
      .filter(([k]) => k.endsWith(".css"))
      .map(([, v]) => v.toString("utf8"))
      .join("\n");
    expect(all).not.toContain("fixture.test");
    expect(all).not.toMatch(/url\(\s*["']?\/wp-content/);
  });

  it("não sobra nenhum endereço do site original fora de links e checkouts", () => {
    const html = r.$.html();
    const leftovers = [...html.matchAll(/(?:src|srcset|content|href)="([^"]*wp-content[^"]*)"/g)].map((m) => m[1]);
    expect(leftovers).toEqual([]);
  });
});

// ─── rastreadores ────────────────────────────────────────────────────────────

describe("pipeline — site 'rastreadores'", () => {
  const r = clonePage("rastreadores");

  it("remove todos os pixels, tags, chats e a meta de verificação", () => {
    const ids = r.removed.flatMap((t) => (t.pixelId ?? "").split(", ").filter(Boolean));
    for (const id of [
      "GTM-ABC1234",
      "1234567890123456",
      "CP1ABCDEFGH2IJKLMNO3",
      "520123456789012345",
      "G-ABCDEF1234",
      "AW-987654321",
      "66f1a2b3c4d5e6f7a8b9c0d1",
      "3456789",
      "k2abc3def4",
      "2613456789012",
      "1654321",
      "Ab1Cd2Ef3G",
      "k7abx9q2wz3plm4nt8rs1vf0yh6e5d",
    ]) {
      expect(ids, id).toContain(id);
    }
    expect(ids.some((id) => id.startsWith("65a1b2c3d4e5f6a7b8c9d0e1"))).toBe(true);
    const vendors = new Set(r.removed.map((t) => t.vendor));
    for (const v of [
      "Meta Pixel",
      "Google Tag Manager",
      "TikTok Pixel",
      "Kwai Pixel",
      "UTMify",
      "JivoChat",
      "Tawk.to",
    ]) {
      expect(vendors, v).toContain(v);
    }
    for (const t of r.removed) {
      expect(["head", "body"]).toContain(t.location);
      if (t.kind !== "meta") expect(t.snippet.length).toBeGreaterThan(0);
    }
    expect(trackersLeft(r.$, r.pageUrl)).toEqual([]);
    const html = r.$.html();
    for (const marker of [
      "fbq(",
      "ttq.",
      "kwaiq",
      "gtag(",
      "_hjSettings",
      "clarity",
      "pintrk",
      "_tfa",
      "Tawk_API",
      "jivosite",
    ]) {
      expect(html, marker).not.toContain(marker);
    }
  });

  it("mantém o que é do site: main.js, JSON-LD, player VTurb, script do ano e o aviso", () => {
    expect(r.$('script[type="application/ld+json"]')).toHaveLength(1);
    expect(r.$("vturb-smartplayer#vid-66f00aa11bb22cc33dd44ee5")).toHaveLength(1);
    expect(r.$("script:not([src])").filter((_, el) => /converteai\.net/.test(r.$(el).html() ?? ""))).toHaveLength(1);
    expect(r.$('link[rel="preconnect"][href="https://scripts.converteai.net"]')).toHaveLength(1);
    expect(
      r.$("script:not([src])").filter((_, el) => /getElementById\("ano"\)/.test(r.$(el).html() ?? "")),
    ).toHaveLength(1);
    expect(r.$("noscript")).toHaveLength(1);
    expect(r.$("noscript").text()).toContain("Ative o JavaScript");
    expect(r.$('link[rel="preconnect"][href="https://connect.facebook.net"]')).toHaveLength(0);
    expect(r.$('link[rel="dns-prefetch"]')).toHaveLength(0);
  });

  it("vê o vídeo VTurb (que não é rastreador) e nenhum atraso", () => {
    expect(r.videos).toHaveLength(1);
    expect(r.videos[0]).toMatchObject({ provider: "VTURB", videoId: "66f00aa11bb22cc33dd44ee5", thirdParty: true });
    expect(r.delay).toBeNull();
  });

  it("acha e marca o checkout da Hotmart", () => {
    expect(r.checkouts).toEqual([
      {
        url: "https://pay.hotmart.com/T12345678M?off=turma7",
        platform: "Hotmart",
        label: "Quero me inscrever",
        source: "HREF",
        confidence: 100,
        occurrences: 1,
      },
    ]);
    expect(r.$('a[data-os-checkout="1"]').attr("href")).toBe("https://pay.hotmart.com/T12345678M?off=turma7");
    expect(r.funnel).toEqual([]);
  });

  it("imagens, CSS, favicon e main.js viram /os-assets/", () => {
    expect(r.store.failed).toEqual([]);
    expect(unlocalized(r.$)).toEqual([]);
    expect(unlocalizedInCss(r.store)).toEqual([]);
    expect(r.$('script[src^="/os-assets/"]')).toHaveLength(1);
    expect(r.$('img[src^="/os-assets/"]')).toHaveLength(3);
    // Nenhum download foi pedido para um rastreador.
    for (const ref of r.refs) expect(classifyUrl(ref.url), ref.url).toBeNull();
  });
});

// ─── vsl ─────────────────────────────────────────────────────────────────────

describe("pipeline — site 'vsl' (iframes e players continuam externos)", () => {
  const r = clonePage("vsl");

  it("detecta VTurb, YouTube e o vídeo próprio; atraso de 332 s", () => {
    expect(r.videos.map((v) => [v.provider, v.videoId ?? null, v.thirdParty])).toEqual([
      ["VTURB", "abc123", true],
      ["YOUTUBE", "M7lc1UVf-VE", true],
      ["NATIVE", null, false],
    ]);
    expect(r.delay).toMatchObject({ seconds: 332, elements: 2 });
    expect(r.$('[data-os-delay="332"]')).toHaveLength(2);
  });

  it("checkout da Kiwify dentro do bloco com atraso é marcado", () => {
    expect(r.checkouts.map((c) => [c.url, c.platform])).toEqual([
      ["https://pay.kiwify.com.br/Pr0t0c0l0?afid=vsl01", "Kiwify"],
    ]);
    expect(r.$("[data-os-delay] [data-os-checkout]")).toHaveLength(1);
  });

  it("iframe do YouTube e script do player ficam externos; o resto vira /os-assets/", () => {
    expect(r.$("iframe").attr("src")).toBe("https://www.youtube.com/embed/M7lc1UVf-VE?rel=0&modestbranding=1");
    expect(r.$('script[src="https://scripts.converteai.net/acc/players/abc123/player.js"]')).toHaveLength(1);
    expect(r.store.failed).toEqual(["https://scripts.converteai.net/acc/players/abc123/player.js"]);
    expect(unlocalized(r.$)).toEqual([]);
    expect(unlocalizedInCss(r.store)).toEqual([]);
    expect(r.$("video source, video[src]").first().attr("src")).toMatch(/^\/os-assets\/[0-9a-f]{64}\.mp4$/);
  });

  it("unhideDelayed tira o .esconder dos blocos marcados (o runtime assume)", () => {
    expect(unhideDelayed(r.$)).toBe(2);
    expect(r.$(".esconder")).toHaveLength(0);
    expect(r.$("[data-os-delay]")).toHaveLength(2);
    expect(unhideDelayed(r.$)).toBe(0);
  });
});

describe("unhideDelayed — classes da detecção, Tailwind, hidden e display:none", () => {
  it("mostra tudo que o extractDelay marcou", () => {
    const $ = cheerio.load(`<body>
      <div class="escondido cta" id="a"><a href="https://pay.kiwify.com.br/x">Comprar</a></div>
      <div class="hidden" id="b" hidden><a href="https://pay.kiwify.com.br/y">Quero</a></div>
      <div id="c" style="display: none; color: red"><a href="https://pay.kiwify.com.br/z">Garantir</a></div>
      <script>setTimeout(function(){document.getElementById("b").classList.remove("hidden");
        document.getElementById("c").style.display="block";}, 30000);</script>
    </body>`);
    const delay = extractDelay($);
    expect(delay).toMatchObject({ seconds: 30 });
    expect($("[data-os-delay]").length).toBeGreaterThanOrEqual(2);
    unhideDelayed($);
    $("[data-os-delay]").each((_, el) => {
      expect($(el).attr("class") ?? "").not.toMatch(/\b(?:escondido|hidden)\b/);
      expect($(el).attr("hidden")).toBeUndefined();
      expect($(el).attr("style") ?? "").not.toMatch(/display\s*:\s*none/);
    });
    expect($("#c").attr("style")).toBe("color: red");
  });
});

// ─── legado (<base href>, ISO-8859-1) ───────────────────────────────────────

describe("pipeline — site 'legado' (<base href=\"/sub/\">, Latin-1)", () => {
  const r = clonePage("legado");
  const origin = originOf("legado");

  it("baixa tudo a partir de /sub/ e reescreve para /os-assets/", () => {
    expect(r.store.failed).toEqual([]);
    expect(unlocalized(r.$)).toEqual([]);
    expect(unlocalizedInCss(r.store)).toEqual([]);
    expect(r.refs.map((ref) => ref.url)).toEqual(
      expect.arrayContaining([
        `${origin}/sub/css/reset.css`,
        `${origin}/sub/img/banner.jpg`,
        `${origin}/sub/js/antigo.js`,
      ]),
    );
    expect(r.$("base")).toHaveLength(0);
    expect(r.$("[integrity]")).toHaveLength(0);
    const css = [...r.store.files.entries()]
      .filter(([k]) => k.endsWith(".css"))
      .map(([, v]) => v.toString("utf8"))
      .join("\n");
    expect(css).toContain("Promoção válida até domingo");
  });

  it("links relativos ao <base> viram absolutos no lugar certo; checkout da Hotmart marcado", () => {
    expect(r.$('a:contains("Como fazer o pedido")').attr("href")).toBe(`${origin}/sub/pedido.html`);
    expect(r.checkouts.map((c) => [c.url, c.platform, c.label])).toEqual([
      ["https://pay.hotmart.com/L4T1N0123?off=verao", "Hotmart", "Comprar já com desconto"],
    ]);
    expect(r.$("h1").text()).toBe("Promoção de Verão: Açaí na Tigela com 40% de desconto!");
  });
});

describe("rewriteHtmlRefs — <base> de outro host e valores já locais", () => {
  it("não transforma /os-assets/ de um <style> já reescrito em endereço do <base>", () => {
    const page = "https://site.com/pagina/";
    const $ = cheerio.load(
      `<html><head><base href="https://cdn.site.com/tema/"><style>.a{background:url(/os-assets/aaa.png)}</style></head>` +
        `<body><img src="img/b.png" srcset="/os-assets/ccc.png 2x, img/b.png 1x"><div style="background:url('/os-assets/ddd.png')"></div></body></html>`,
    );
    expect(collectHtmlRefs($, page).map((ref) => ref.url)).toEqual(["https://cdn.site.com/tema/img/b.png"]);
    rewriteHtmlRefs($, page, (abs) => (abs === "https://cdn.site.com/tema/img/b.png" ? "/os-assets/bbb.png" : null));
    expect($("style").text()).toBe(".a{background:url(/os-assets/aaa.png)}");
    expect($("img").attr("src")).toBe("/os-assets/bbb.png");
    expect($("img").attr("srcset")).toBe("/os-assets/ccc.png 2x, /os-assets/bbb.png 1x");
    expect($("div").attr("style")).toBe("background:url('/os-assets/ddd.png')");
    expect(collectHtmlRefs($, page)).toEqual([]);
  });
});

// ─── checkouts ───────────────────────────────────────────────────────────────

describe("pipeline — site 'checkouts'", () => {
  it("normalizeLazy e removeTrackers não fazem perder nenhum dos 20 checkouts", () => {
    const pageUrl = `${originOf("checkouts")}/`;
    const html = fakeFetch(pageUrl)?.body.toString("utf8") ?? "";
    const before = detectCheckouts(cheerio.load(html), pageUrl).map((c) => c.url);
    const r = clonePage("checkouts");
    expect(before).toHaveLength(20);
    expect(r.checkouts.map((c) => c.url).sort()).toEqual([...before].sort());
    expect(r.marked).toBeGreaterThanOrEqual(19);
    expect(unlocalized(r.$)).toEqual([]);
    // O host "checkouts.fixture.test" parece checkout, mas os links do próprio site não são.
    expect(r.checkouts.filter((c) => c.url.includes(".fixture.test"))).toEqual([]);
    expect(r.$('a[href="/upsell"]').attr("data-os-checkout")).toBeUndefined();
    expect(r.funnel.map((f) => [f.url, f.kind])).toEqual([[`${originOf("checkouts")}/upsell`, "UPSELL"]]);
  });

  it("padrões genéricos de host não valem para o próprio host da página", () => {
    const page = "https://pay.meusite.com.br/oferta";
    expect(matchCheckoutPlatform("https://pay.meusite.com.br/upsell", page)).toBeNull();
    expect(matchCheckoutPlatform("https://pay.meusite.com.br/upsell")).toMatchObject({ confidence: 60 });
    // Outro subdomínio do mesmo site continua valendo; caminho /checkout também.
    expect(matchCheckoutPlatform("https://checkout.meusite.com.br/pagar", page)).toMatchObject({ confidence: 60 });
    expect(matchCheckoutPlatform("https://pay.meusite.com.br/checkout/", page)).toMatchObject({ confidence: 50 });
    // Plataformas conhecidas não mudam.
    expect(matchCheckoutPlatform("https://pay.hotmart.com/X1", "https://pay.hotmart.com/")).toMatchObject({
      platform: "Hotmart",
      confidence: 100,
    });
  });
});

// ─── Listas de hosts dos módulos não se contradizem ─────────────────────────

describe("listas de rastreadores, checkouts e players são coerentes", () => {
  const PAGE = "https://minhaoferta.com.br/vendas";
  /** Exemplos para os hosts escritos como RegExp nas listas. */
  const VIDEO_SAMPLES = [
    "https://scripts.converteai.net/acc/players/66a1b2c3d4e5f6a7b8c9d0e1/v4/player.js",
    "https://cdn.vturb.com.br/player.js",
    "https://player-vz-7b6cf9e4-8bf.tv.pandavideo.com.br/embed/?v=5f2d0e3c-1234-4c5d-8e9f-0a1b2c3d4e5f",
    "https://player.pandavideo.com/api.v2.js",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://player.vimeo.com/video/123456789",
    "https://fast.wistia.net/embed/iframe/abc123def",
    "https://quick.vidalytics.com/embeds/abc/def/loader.min.js",
    "https://iframe.mediadelivery.net/embed/123/5f2d0e3c-1234-4c5d-8e9f-0a1b2c3d4e5f",
    "https://cdn.jwplayer.com/players/abcdefgh-ijklmnop.js",
    "https://vooplayer.com/v3/watch/abc",
    "https://www.dailymotion.com/embed/video/x7abc",
    "https://www.loom.com/embed/0123456789abcdef0123456789abcdef",
  ];
  const CHECKOUT_REGEX_SAMPLES = [
    "https://seguro.minhaloja.com.br/r/ABC123",
    "https://loja.vegacheckout.com.br/abc",
    "https://checkout.appmax.com.br/checkout/1",
    "https://loja.appmax.com.br/abc",
    "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=1",
    "https://www.digistore24.com/product/123",
  ];
  const TRACKER_SAMPLES = [
    "https://connect.facebook.net/en_US/fbevents.js",
    "https://www.facebook.com/tr?id=123456789012345&ev=PageView&noscript=1",
    "https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=C1234567890ABCDEFGHI",
    "https://s1.kwai.net/kos/s101/nlav11187/pixel/events.js",
    "https://cdn.utmify.com.br/scripts/utms/latest.js",
    "https://www.googletagmanager.com/gtm.js?id=GTM-ABC123",
    "https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ9",
    "https://googleads.g.doubleclick.net/pagead/viewthroughconversion/123/",
    "https://static.hotjar.com/c/hotjar-123456.js?sv=6",
    "https://www.clarity.ms/tag/abcdefgh",
    "https://code.jivosite.com/widget/AbCdEf123",
    "https://embed.tawk.to/0123456789abcdef01234567/default",
    "https://js.hs-scripts.com/1234567.js",
    "https://widget.manychat.com/12345.js",
    "https://cdn.cookielaw.org/scripttemplates/otSDKStub.js",
    "https://bat.bing.com/bat.js",
    "https://ct.pinterest.com/v3/?tid=123",
    "https://cdn.taboola.com/libtrc/unip/1234567/tfa.js",
  ];

  it("hosts de checkout e de player nunca são rastreadores", () => {
    const checkoutHosts = CHECKOUT_PLATFORMS.flatMap((p) => p.rules)
      .map((rule) => rule.host)
      .filter((host): host is string => typeof host === "string")
      .map((host) => host.replace(/^\*\./, "loja."));
    expect(checkoutHosts.length).toBeGreaterThan(30);
    for (const host of checkoutHosts) {
      expect(classifyUrl(`https://${host}/`, PAGE), host).toBeNull();
      expect(isTrackerHost(host), host).toBe(false);
    }
    for (const url of CHECKOUT_REGEX_SAMPLES) {
      expect(matchCheckoutPlatform(url), url).not.toBeNull();
      expect(classifyUrl(url, PAGE), url).toBeNull();
    }
    for (const url of VIDEO_SAMPLES) {
      expect(matchVideoHost(url), url).not.toBeNull();
      expect(classifyUrl(url, PAGE), url).toBeNull();
      expect(isTrackerHost(new URL(url).hostname), url).toBe(false);
    }
  });

  it("rastreadores nunca viram checkout nem vídeo", () => {
    for (const url of TRACKER_SAMPLES) {
      expect(classifyUrl(url, PAGE), url).not.toBeNull();
      expect(matchCheckoutPlatform(url, PAGE), url).toBeNull();
      expect(parseVideoUrl(url), url).toBeNull();
    }
  });
});
