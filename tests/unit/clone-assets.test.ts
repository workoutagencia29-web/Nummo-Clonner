import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { collectCssRefs, rewriteCss } from "@/worker/clone/css";
import {
  collectHtmlRefs,
  documentBase,
  type HtmlRef,
  removeBaseTag,
  rewriteHtmlRefs,
} from "@/worker/clone/html-assets";
import { isPlaceholderSrc, normalizeLazy } from "@/worker/clone/lazy";
import { absolutize, extensionFor, isHttpUrl } from "@/worker/clone/urls";

const CSS_URL = "https://cdn.site.com/assets/css/main.css";
const PAGE = "https://site.com/oferta/index.html";

/** Mapa de teste: troca tudo por /os-assets/<nome do arquivo>. */
const toLocal = (abs: string) => `/os-assets/${new URL(abs).pathname.split("/").pop()}`;

// ─── URLs ────────────────────────────────────────────────────────────────────

describe("absolutize", () => {
  it("resolve relativos, ../ e // (protocolo da base)", () => {
    expect(absolutize("img/a.png", PAGE)).toBe("https://site.com/oferta/img/a.png");
    expect(absolutize("../b.png", PAGE)).toBe("https://site.com/b.png");
    expect(absolutize("/c.png", PAGE)).toBe("https://site.com/c.png");
    expect(absolutize("//cdn.x.com/d.png", PAGE)).toBe("https://cdn.x.com/d.png");
    expect(absolutize("//cdn.x.com/d.png", "http://site.com/")).toBe("http://cdn.x.com/d.png");
  });

  it("tira #hash e espaços, mantém query", () => {
    expect(absolutize("  sprite.svg?v=2#icon \n", PAGE)).toBe("https://site.com/oferta/sprite.svg?v=2");
    expect(absolutize("a.eot?#iefix", PAGE)).toBe("https://site.com/oferta/a.eot?");
  });

  it("ignora data:, blob:, javascript:, about:, mailto:, tel:, sms:, #fragmento e vazio", () => {
    for (const ref of [
      "data:image/png;base64,AAAA",
      "blob:https://site.com/123",
      "javascript:void(0)",
      " JavaScript:alert(1)",
      "about:blank",
      "mailto:a@b.com",
      "tel:+5511999999999",
      "sms:+5511",
      "#topo",
      "",
      "   ",
    ]) {
      expect(absolutize(ref, PAGE), ref).toBeNull();
    }
  });

  it("não decodifica entidades de novo (o cheerio já decodificou)", () => {
    expect(absolutize("a.png?x=1&amp;y=2", PAGE)).toBe("https://site.com/oferta/a.png?x=1&amp;y=2");
  });

  it("isHttpUrl", () => {
    expect(isHttpUrl("https://a.com/x")).toBe(true);
    expect(isHttpUrl("http://a.com")).toBe(true);
    expect(isHttpUrl("ftp://a.com")).toBe(false);
    expect(isHttpUrl("/relativo")).toBe(false);
    expect(isHttpUrl(null)).toBe(false);
  });
});

describe("extensionFor", () => {
  it("usa o Content-Type quando conhecido (ignora parâmetros)", () => {
    expect(extensionFor("https://a.com/x", "text/css; charset=utf-8")).toBe("css");
    expect(extensionFor("https://a.com/x", "application/javascript")).toBe("js");
    expect(extensionFor("https://a.com/x.php", "image/jpeg")).toBe("jpg");
    expect(extensionFor("https://a.com/x", "image/svg+xml")).toBe("svg");
    expect(extensionFor("https://a.com/x", "image/x-icon")).toBe("ico");
    expect(extensionFor("https://a.com/x", "font/woff2")).toBe("woff2");
    expect(extensionFor("https://a.com/x", "application/font-woff")).toBe("woff");
    expect(extensionFor("https://a.com/x", "application/vnd.ms-fontobject")).toBe("eot");
    expect(extensionFor("https://a.com/x", "video/mp4")).toBe("mp4");
    expect(extensionFor("https://a.com/x", "audio/mpeg")).toBe("mp3");
    expect(extensionFor("https://a.com/x", "application/manifest+json")).toBe("json");
    expect(extensionFor("https://a.com/x", "IMAGE/AVIF")).toBe("avif");
  });

  it("cai para a extensão do caminho e, por fim, para bin", () => {
    expect(extensionFor("https://a.com/f/Font.TTF?v=1", "application/octet-stream")).toBe("ttf");
    expect(extensionFor("https://a.com/foto.jpeg", "")).toBe("jpg");
    expect(extensionFor("https://a.com/mod.mjs", null)).toBe("js");
    expect(extensionFor("https://a.com/pagina.php", "application/x-httpd-php")).toBe("bin");
    expect(extensionFor("https://a.com/sem-extensao", undefined)).toBe("bin");
  });

  it("documentos (iframes do Preservar JS) viram .html, não .bin", () => {
    expect(extensionFor("https://a.com/pagina.php", "text/html; charset=utf-8")).toBe("html");
    expect(extensionFor("https://a.com/quiz/frame", "application/xhtml+xml")).toBe("html");
    expect(extensionFor("https://a.com/antigo.htm", "")).toBe("html");
  });
});

// ─── CSS ─────────────────────────────────────────────────────────────────────

describe("collectCssRefs", () => {
  it("url() com aspas duplas, simples, sem aspas e com espaços", () => {
    const css = `.a{background:url("a.png")} .b{background:url('b.png')} .c{background:url(c.png)} .d{background:url(  "d e.png"  )}`;
    expect(collectCssRefs(css, CSS_URL).map((r) => r.url)).toEqual([
      "https://cdn.site.com/assets/css/a.png",
      "https://cdn.site.com/assets/css/b.png",
      "https://cdn.site.com/assets/css/c.png",
      "https://cdn.site.com/assets/css/d%20e.png",
    ]);
  });

  it("resolve ../ e // em relação ao CSS, não à página", () => {
    const refs = collectCssRefs(`.a{background:url(../img/bg.jpg)} .b{background:url(//fonts.x.com/f.woff2)}`, CSS_URL);
    expect(refs.map((r) => r.url)).toEqual(["https://cdn.site.com/assets/img/bg.jpg", "https://fonts.x.com/f.woff2"]);
  });

  it("ignora data:, url(#filtro), @namespace, behavior e url-prefix()", () => {
    const css = `@namespace svg url(http://www.w3.org/2000/svg);
      .a{background:url(data:image/png;base64,AAAA)} .b{filter:url(#blur)} .c{behavior:url(pie.htc)}
      @-moz-document url-prefix() { .d{color:red} }`;
    expect(collectCssRefs(css, CSS_URL)).toEqual([]);
  });

  it("@import com string e url(), com media queries", () => {
    const css = `@import "reset.css" screen;\n@import url(print.css) print and (min-width: 600px);\n@import url("layer.css") layer(base) supports(display: grid);`;
    expect(collectCssRefs(css, CSS_URL)).toEqual([
      { url: "https://cdn.site.com/assets/css/reset.css", kind: "import" },
      { url: "https://cdn.site.com/assets/css/print.css", kind: "import" },
      { url: "https://cdn.site.com/assets/css/layer.css", kind: "import" },
    ]);
  });

  it("image-set e -webkit-image-set com strings e url()", () => {
    const css = `.a{background-image:-webkit-image-set("a1.png" 1x, url(a2.png) 2x);background-image:image-set("a.avif" type("image/avif") 1x, 'a.webp' 2x)}`;
    expect(collectCssRefs(css, CSS_URL).map((r) => r.url.split("/").pop())).toEqual([
      "a1.png",
      "a2.png",
      "a.avif",
      "a.webp",
    ]);
  });

  it("@font-face com vários src/format marca como fonte", () => {
    const css = `@font-face{font-family:X;src:url(x.eot);src:url(x.eot?#iefix) format("embedded-opentype"),url('x.woff2') format('woff2'),url(x.woff) format("woff"),local("X")}`;
    const refs = collectCssRefs(css, CSS_URL);
    expect(refs.map((r) => r.url.split("/").pop())).toEqual(["x.eot", "x.eot?", "x.woff2", "x.woff"]);
    expect(refs.every((r) => r.font === true && r.kind === "asset")).toBe(true);
  });

  it("acha url() em propriedades --custom e dentro de hacks de IE", () => {
    const css = `:root{--hero: url(hero.jpg)} .a{*background:url(ie7.png);_background:url(ie6.png);background:url(all.png) no-repeat\\9}`;
    expect(collectCssRefs(css, CSS_URL).map((r) => r.url.split("/").pop())).toEqual([
      "hero.jpg",
      "ie7.png",
      "ie6.png",
      "all.png",
    ]);
  });

  it("não repete a mesma URL e resolve escapes do CSS", () => {
    const refs = collectCssRefs(`.a{background:url(a\\ b.png)} .b{background:url("a b.png")}`, CSS_URL);
    expect(refs).toEqual([{ url: "https://cdn.site.com/assets/css/a%20b.png", kind: "asset" }]);
  });

  it("lê um style inline (lista de declarações)", () => {
    const refs = collectCssRefs(`color:red; background: url(bg.png) center / cover`, PAGE, { inline: true });
    expect(refs).toEqual([{ url: "https://site.com/oferta/bg.png", kind: "asset" }]);
  });

  it("tolera CSS quebrado (chaves sobrando, sem fechar)", () => {
    const css = `.a { background: url(a.png) } } .b { background: url(b.png) ; color: red`;
    expect(collectCssRefs(css, CSS_URL).map((r) => r.url.split("/").pop())).toEqual(["a.png", "b.png"]);
  });
});

describe("rewriteCss", () => {
  it("troca url() mantendo o estilo de aspas e o resto do texto", () => {
    const css = `.a{background:url("a.png") no-repeat}\n.b{background:url('b.png')}\n.c { background : URL( c.png ) }`;
    expect(rewriteCss(css, CSS_URL, toLocal)).toBe(
      `.a{background:url("/os-assets/a.png") no-repeat}\n.b{background:url('/os-assets/b.png')}\n.c { background : URL( /os-assets/c.png ) }`,
    );
  });

  it("só troca o que o map devolve; null mantém", () => {
    const css = `.a{background:url(a.png)} .b{background:url(b.png)}`;
    const out = rewriteCss(css, CSS_URL, (abs) => (abs.endsWith("a.png") ? "/os-assets/1.png" : null));
    expect(out).toBe(`.a{background:url(/os-assets/1.png)} .b{background:url(b.png)}`);
  });

  it("sem trocas devolve o mesmo texto", () => {
    const css = `/* x */ .a{background:url(a.png)}`;
    expect(rewriteCss(css, CSS_URL, () => null)).toBe(css);
  });

  it("não mexe em data: e mantém o #fragmento de SVG", () => {
    const css = `.a{background:url(data:image/svg+xml;utf8,<svg></svg>)} .b{mask:url(icons.svg#check)} .c{filter:url(#f)}`;
    expect(rewriteCss(css, CSS_URL, toLocal)).toBe(
      `.a{background:url(data:image/svg+xml;utf8,<svg></svg>)} .b{mask:url(/os-assets/icons.svg#check)} .c{filter:url(#f)}`,
    );
  });

  it("@import com string e url() mantém media query", () => {
    const css = `@charset "utf-8";\n@import "reset.css" screen;\n@import url(print.css) print and (min-width: 600px);`;
    expect(rewriteCss(css, CSS_URL, toLocal)).toBe(
      `@charset "utf-8";\n@import "/os-assets/reset.css" screen;\n@import url(/os-assets/print.css) print and (min-width: 600px);`,
    );
  });

  it("image-set com strings e url()", () => {
    const css = `.a{background-image:image-set("a.avif" type("image/avif") 1x, url(a.png) 2x)}`;
    expect(rewriteCss(css, CSS_URL, toLocal)).toBe(
      `.a{background-image:image-set("/os-assets/a.avif" type("image/avif") 1x, url(/os-assets/a.png) 2x)}`,
    );
  });

  it("@font-face com vários src e format()", () => {
    const css = `@font-face {\n  font-family: "X";\n  src: url(x.eot?#iefix) format("embedded-opentype"), url('x.woff2') format('woff2'), local(X);\n}`;
    expect(rewriteCss(css, CSS_URL, toLocal)).toBe(
      `@font-face {\n  font-family: "X";\n  src: url(/os-assets/x.eot#iefix) format("embedded-opentype"), url('/os-assets/x.woff2') format('woff2'), local(X);\n}`,
    );
  });

  it("hacks de IE (*zoom, _height, \\9, filter progid) e comentários sobrevivem", () => {
    const css = `/* topo url(nao.png) */\n.a{*zoom:1;_height:1px;background:url(a.png) no-repeat\\9;filter:progid:DXImageTransform.Microsoft.gradient(startColorstr='#80000000',endColorstr='#80000000');/* fim */}\n.b{color:red;;}`;
    const out = rewriteCss(css, CSS_URL, toLocal);
    expect(out).toBe(css.replace("url(a.png)", "url(/os-assets/a.png)"));
  });

  it("@layer, @supports, @container e @keyframes ficam intactos", () => {
    const css = `@layer base, comp;\n@layer base { .a{background:url(a.png)} }\n@supports (display:grid) { .b{background:url(b.png)} }\n@container card (min-width: 400px) { .c{background:url(c.png)} }\n@keyframes k { from { background:url(d.png) } to { opacity: 1 } }`;
    const out = rewriteCss(css, CSS_URL, toLocal);
    expect(out).toBe(css.replace(/url\((\w)\.png\)/g, "url(/os-assets/$1.png)"));
  });

  it("propriedade --custom (Raw) também é reescrita", () => {
    expect(rewriteCss(`:root{--bg:url( "hero.jpg" )}`, CSS_URL, toLocal)).toBe(
      `:root{--bg:url( "/os-assets/hero.jpg" )}`,
    );
  });

  it("valor novo com caracteres especiais ganha aspas e escapes", () => {
    const out = rewriteCss(`.a{background:url(a.png)} .b{background:url("b.png")}`, CSS_URL, () => `/x/a b"c.png`);
    expect(out).toBe(`.a{background:url("/x/a b\\"c.png")} .b{background:url("/x/a b\\"c.png")}`);
  });

  it("style inline (lista de declarações)", () => {
    expect(rewriteCss(`background-image:url('bg.png');color:red`, PAGE, toLocal, { inline: true })).toBe(
      `background-image:url('/os-assets/bg.png');color:red`,
    );
  });
});

describe("CSS sem css-tree (plano B)", () => {
  it("se o css-tree falhar, um leitor simples cuida de url() e @import sem estragar o resto", async () => {
    vi.resetModules();
    vi.doMock("css-tree", () => ({
      parse: () => {
        throw new Error("falhou");
      },
      walk: () => {},
    }));
    try {
      const csstree = await import("css-tree");
      expect(() => csstree.parse("a{}")).toThrow("falhou");
      const mod = await import("@/worker/clone/css");
      const css = `@import 'a.css' screen;\n/* url(comentario.png) */\n.x{*zoom:1;background:URL( "b.png" ) no-repeat;content:"url(nao.png)"}\n@-moz-document url-prefix(){.y{background:url(c.png)}}\n.z{background:url(d e.png)}`;
      expect(mod.collectCssRefs(css, CSS_URL)).toEqual([
        { url: "https://cdn.site.com/assets/css/a.css", kind: "import" },
        { url: "https://cdn.site.com/assets/css/b.png", kind: "asset" },
        { url: "https://cdn.site.com/assets/css/c.png", kind: "asset" },
      ]);
      expect(mod.rewriteCss(css, CSS_URL, toLocal)).toBe(
        css
          .replace("'a.css'", "'/os-assets/a.css'")
          .replace('"b.png"', '"/os-assets/b.png"')
          .replace("url(c.png)", "url(/os-assets/c.png)"),
      );
    } finally {
      vi.doUnmock("css-tree");
      vi.resetModules();
    }
  });
});

// ─── HTML ────────────────────────────────────────────────────────────────────

function load(html: string) {
  return cheerio.load(html);
}

describe("collectHtmlRefs", () => {
  it("imagens, picture/srcset, vídeo, áudio e poster", () => {
    const $ = load(`<img src="a.jpg" srcset="a-1x.jpg 1x, a-2x.jpg 2x">
      <picture><source srcset="p.webp 480w, p2.webp 960w" type="image/webp"><img src="p.jpg"></picture>
      <video poster="v.jpg" src="v.mp4"><source src="v.webm" type="video/webm"></video>
      <audio src="s.mp3"></audio>
      <img src="data:image/gif;base64,R0lGOD">`);
    const refs = collectHtmlRefs($, PAGE);
    const byName = (n: string) => refs.find((r) => r.url.endsWith(`/${n}`));
    expect(refs.map((r) => r.url.split("/").pop())).toEqual([
      "a.jpg",
      "a-1x.jpg",
      "a-2x.jpg",
      "p.webp",
      "p2.webp",
      "p.jpg",
      "v.jpg",
      "v.mp4",
      "v.webm",
      "s.mp3",
    ]);
    expect(byName("a-2x.jpg")).toMatchObject({ kind: "image", attr: "srcset" });
    expect(byName("v.jpg")).toMatchObject({ kind: "image", attr: "poster" });
    expect(byName("v.webm")?.kind).toBe("media");
    expect(byName("s.mp3")?.kind).toBe("media");
  });

  it("link (css, ícones, preload, manifest), script e meta og/twitter", () => {
    const $ = load(`<head>
      <link rel="stylesheet" href="css/main.css">
      <link rel="shortcut icon" href="/favicon.ico">
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="preload" as="font" href="/f.woff2" crossorigin>
      <link rel="preload" href="/hero.webp" imagesrcset="/hero-1.webp 1x, /hero-2.webp 2x">
      <link rel="prefetch" href="/next.js">
      <link rel="manifest" href="/site.webmanifest">
      <link rel="preconnect" href="https://fonts.gstatic.com">
      <link rel="canonical" href="https://site.com/oferta">
      <script src="js/app.js"></script>
      <meta property="og:image" content="https://site.com/og.jpg">
      <meta name="twitter:image" content="/tw.jpg">
      <meta property="og:title" content="Oferta">
    </head>`);
    const refs = collectHtmlRefs($, PAGE);
    expect(refs).toEqual<HtmlRef[]>([
      { url: "https://site.com/oferta/css/main.css", kind: "stylesheet", attr: "href" },
      { url: "https://site.com/favicon.ico", kind: "icon", attr: "href" },
      { url: "https://site.com/apple.png", kind: "icon", attr: "href" },
      { url: "https://site.com/f.woff2", kind: "font", attr: "href" },
      { url: "https://site.com/hero.webp", kind: "image", attr: "href" },
      { url: "https://site.com/hero-1.webp", kind: "image", attr: "imagesrcset" },
      { url: "https://site.com/hero-2.webp", kind: "image", attr: "imagesrcset" },
      { url: "https://site.com/next.js", kind: "script", attr: "href" },
      { url: "https://site.com/site.webmanifest", kind: "other", attr: "href" },
      { url: "https://site.com/oferta/js/app.js", kind: "script", attr: "src" },
      { url: "https://site.com/og.jpg", kind: "image", attr: "content" },
      { url: "https://site.com/tw.jpg", kind: "image", attr: "content" },
    ]);
  });

  it("respeita <base href>", () => {
    const $ = load(
      `<head><base href="https://cdn.site.com/lp/"></head><body><img src="img/a.png"><img src="/b.png"></body>`,
    );
    expect(documentBase($, PAGE)).toBe("https://cdn.site.com/lp/");
    expect(collectHtmlRefs($, PAGE).map((r) => r.url)).toEqual([
      "https://cdn.site.com/lp/img/a.png",
      "https://cdn.site.com/b.png",
    ]);
  });

  it("style inline, bloco <style> (com @import) e atributo background", () => {
    const $ =
      load(`<style>@import "fonts.css"; .hero{background:url(img/hero.jpg)} @font-face{src:url(f/x.woff2)}</style>
      <div style="background-image: url('img/bg.png')"></div><table background="img/tb.gif"></table>`);
    const refs = collectHtmlRefs($, PAGE);
    expect(refs).toEqual<HtmlRef[]>([
      { url: "https://site.com/oferta/fonts.css", kind: "stylesheet", attr: "#style" },
      { url: "https://site.com/oferta/img/hero.jpg", kind: "image", attr: "#style" },
      { url: "https://site.com/oferta/f/x.woff2", kind: "font", attr: "#style" },
      { url: "https://site.com/oferta/img/bg.png", kind: "image", attr: "style" },
      { url: "https://site.com/oferta/img/tb.gif", kind: "image", attr: "background" },
    ]);
  });

  it("SVG: use externo (não o interno), image com xlink:href", () => {
    const $ = load(
      `<svg><use href="#local"></use><use xlink:href="/sprite.svg#icon-check"></use><image xlink:href="pic.png"></image></svg>`,
    );
    expect(collectHtmlRefs($, PAGE).map((r) => [r.url, r.kind])).toEqual([
      ["https://site.com/sprite.svg", "image"],
      ["https://site.com/oferta/pic.png", "image"],
    ]);
  });

  it("input type=image, object data e iframe (informado, sem alterar o documento)", () => {
    const html = `<input type="image" src="btn.png"><input type="text" src="x.png"><object data="anim.svg"></object><iframe src="https://www.youtube.com/embed/abc"></iframe>`;
    const $ = load(html);
    const before = $.html();
    const refs = collectHtmlRefs($, PAGE);
    expect(refs.map((r) => [r.url, r.kind])).toEqual([
      ["https://site.com/oferta/btn.png", "image"],
      ["https://site.com/oferta/anim.svg", "image"],
      ["https://www.youtube.com/embed/abc", "iframe"],
    ]);
    expect($.html()).toBe(before);
  });

  it("não repete a mesma URL e ignora esquemas que não são arquivos", () => {
    const $ = load(
      `<img src="a.png"><img src="a.png#x"><img src="blob:https://site.com/1"><img src="javascript:void(0)">`,
    );
    expect(collectHtmlRefs($, PAGE)).toEqual([{ url: "https://site.com/oferta/a.png", kind: "image", attr: "src" }]);
  });
});

describe("rewriteHtmlRefs", () => {
  it("picture/srcset: troca cada candidato e mantém os descritores", () => {
    const $ = load(
      `<picture><source srcset="p.webp 480w, p2.webp 960w"><img src="p.jpg" srcset="p-1x.jpg 1x, p-2x.jpg 2x" sizes="100vw"></picture>`,
    );
    rewriteHtmlRefs($, PAGE, (abs) => toLocal(abs));
    expect($("source").attr("srcset")).toBe("/os-assets/p.webp 480w, /os-assets/p2.webp 960w");
    expect($("img").attr("srcset")).toBe("/os-assets/p-1x.jpg 1x, /os-assets/p-2x.jpg 2x");
    expect($("img").attr("src")).toBe("/os-assets/p.jpg");
    expect($("img").attr("sizes")).toBe("100vw");
  });

  it("srcset com vírgula na URL (Cloudinary) e candidato sem troca", () => {
    const $ = load(
      `<img srcset="https://res.cloudinary.com/x/w_400,c_fill/a.jpg 400w, https://res.cloudinary.com/x/w_800,c_fill/a.jpg 800w">`,
    );
    rewriteHtmlRefs($, PAGE, (abs) => (abs.includes("w_400") ? "/os-assets/400.jpg" : null));
    expect($("img").attr("srcset")).toBe(
      "/os-assets/400.jpg 400w, https://res.cloudinary.com/x/w_800,c_fill/a.jpg 800w",
    );
  });

  it("remove integrity só de link/script reescritos", () => {
    const $ = load(
      `<link rel="stylesheet" href="a.css" integrity="sha384-x" crossorigin="anonymous"><script src="a.js" integrity="sha384-y"></script><script src="https://cdn.x.com/keep.js" integrity="sha384-z"></script>`,
    );
    rewriteHtmlRefs($, PAGE, (abs) => (abs.includes("site.com") ? toLocal(abs) : null));
    expect($("link").attr("href")).toBe("/os-assets/a.css");
    expect($("link").attr("integrity")).toBeUndefined();
    expect($("script").eq(0).attr("integrity")).toBeUndefined();
    expect($("script").eq(1).attr("integrity")).toBe("sha384-z");
  });

  it("og:image, style inline e bloco <style> (via rewriteCss)", () => {
    const $ = load(
      `<head><meta property="og:image" content="/og.jpg"><style>/* c */ .h{background:url( "img/h.jpg" )}</style></head><body><div style="background:url(img/bg.png) no-repeat;color:red">x</div></body>`,
    );
    rewriteHtmlRefs($, PAGE, (abs) => toLocal(abs));
    expect($("meta").attr("content")).toBe("/os-assets/og.jpg");
    expect($("style").text()).toBe(`/* c */ .h{background:url( "/os-assets/h.jpg" )}`);
    expect($("div").attr("style")).toBe("background:url(/os-assets/bg.png) no-repeat;color:red");
  });

  it("o map recebe o tipo e o atributo de cada referência", () => {
    const $ = load(
      `<link rel="stylesheet" href="a.css"><style>@font-face{src:url(f.woff2)}</style><iframe src="https://player.x.com/v"></iframe>`,
    );
    const seen: HtmlRef[] = [];
    rewriteHtmlRefs($, PAGE, (_abs, ref) => {
      seen.push(ref);
      return null;
    });
    expect(seen.map((r) => [r.kind, r.attr])).toEqual([
      ["stylesheet", "href"],
      ["font", "#style"],
      ["iframe", "src"],
    ]);
    expect($("iframe").attr("src")).toBe("https://player.x.com/v");
  });

  it("svg use externo mantém o #fragmento e o prefixo xlink", () => {
    const $ = load(`<svg><use xlink:href="img/sprite.svg#icon-check"></use><use href="#local"></use></svg>`);
    rewriteHtmlRefs($, PAGE, (abs) => toLocal(abs));
    const html = $("svg").html() ?? "";
    expect(html).toContain(`xlink:href="/os-assets/sprite.svg#icon-check"`);
    expect(html).toContain(`href="#local"`);
  });

  it("<base href>: resolve pela base, remove a tag e deixa absolutas as referências e links não trocados", () => {
    const $ = load(
      `<head><base href="https://cdn.site.com/lp/" target="_blank"></head><body><img src="a.png"><img src="b.png"><a href="obrigado.html">ok</a><a href="#topo">topo</a><form action="enviar.php"></form></body>`,
    );
    rewriteHtmlRefs($, PAGE, (abs) => (abs.endsWith("a.png") ? "/os-assets/a.png" : null));
    expect($("base").length).toBe(0);
    expect($("img").eq(0).attr("src")).toBe("/os-assets/a.png");
    expect($("img").eq(1).attr("src")).toBe("https://cdn.site.com/lp/b.png");
    expect($("a").eq(0).attr("href")).toBe("https://cdn.site.com/lp/obrigado.html");
    expect($("a").eq(0).attr("target")).toBe("_blank");
    expect($("a").eq(1).attr("href")).toBe("#topo");
    expect($("form").attr("action")).toBe("https://cdn.site.com/lp/enviar.php");
  });

  it("sem <base>, null mantém o valor original intacto", () => {
    const $ = load(`<img src="a.png" srcset="a.png 1x"><div style="background:url(b.png)"></div>`);
    const before = $.html();
    rewriteHtmlRefs($, PAGE, () => null);
    expect($.html()).toBe(before);
  });

  it("removeBaseTag remove todas as <base>", () => {
    const $ = load(`<head><base href="/x/"><base target="_self"></head><body><a href="p">p</a></body>`);
    removeBaseTag($);
    expect($("base").length).toBe(0);
    expect($("a").attr("href")).toBe("p");
  });
});

// ─── Lazy load ───────────────────────────────────────────────────────────────

describe("normalizeLazy", () => {
  it("data-src → src quando o src está vazio, ausente, é data: ou placeholder conhecido", () => {
    const $ = load(
      `<img id="a" data-src="a.jpg"><img id="b" src="" data-src="b.jpg"><img id="c" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="c.jpg"><img id="d" src="/wp-content/plugins/x/blank.gif" data-src="d.jpg"><img id="e" src="real.jpg" data-src="zoom.jpg">`,
    );
    expect(normalizeLazy($)).toBe(4);
    expect($("#a").attr("src")).toBe("a.jpg");
    expect($("#b").attr("src")).toBe("b.jpg");
    expect($("#c").attr("src")).toBe("c.jpg");
    expect($("#d").attr("src")).toBe("d.jpg");
    expect($("#d").attr("data-src")).toBeUndefined();
    // src real e sem classe de lazy load: não mexe (data-src pode ser outra coisa)
    expect($("#e").attr("src")).toBe("real.jpg");
    expect($("#e").attr("data-src")).toBe("zoom.jpg");
  });

  it("lazysizes: troca o LQIP, data-srcset/data-sizes e lazyload → lazyloaded", () => {
    const $ = load(
      `<img class="lazyload blur" src="lqip.jpg" data-src="full.jpg" data-srcset="f-400.jpg 400w, f-800.jpg 800w" data-sizes="(max-width: 600px) 100vw, 50vw" loading="lazy">`,
    );
    expect(normalizeLazy($)).toBe(1);
    const img = $("img");
    expect(img.attr("src")).toBe("full.jpg");
    expect(img.attr("srcset")).toBe("f-400.jpg 400w, f-800.jpg 800w");
    expect(img.attr("sizes")).toBe("(max-width: 600px) 100vw, 50vw");
    expect(img.attr("class")).toBe("blur lazyloaded");
    expect(img.attr("loading")).toBe("lazy");
  });

  it("WP Rocket: data-lazy-src/srcset/sizes e iframe rocket-lazyload", () => {
    const $ = load(
      `<img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" data-lazy-src="w.jpg" data-lazy-srcset="w.jpg 1x, w2.jpg 2x" data-lazy-sizes="100vw"><iframe class="rocket-lazyload" src="about:blank" data-lazy-src="https://www.youtube.com/embed/x"></iframe>`,
    );
    expect(normalizeLazy($)).toBe(2);
    expect($("img").attr("src")).toBe("w.jpg");
    expect($("img").attr("srcset")).toBe("w.jpg 1x, w2.jpg 2x");
    expect($("img").attr("sizes")).toBe("100vw");
    expect($("img").attr("data-lazy-src")).toBeUndefined();
    expect($("iframe").attr("src")).toBe("https://www.youtube.com/embed/x");
    expect($("iframe").attr("class")).toBe("lazyloaded");
  });

  it("jQuery lazyload (data-original), Revolution (data-lazyload) e data-ll-src", () => {
    const $ = load(
      `<img id="a" src="grey.gif" data-original="o.jpg"><img id="b" src="dummy.png" data-lazyload="r.jpg"><img id="c" data-ll-src="l.jpg">`,
    );
    expect(normalizeLazy($)).toBe(3);
    expect($("#a").attr("src")).toBe("o.jpg");
    expect($("#b").attr("src")).toBe("r.jpg");
    expect($("#c").attr("src")).toBe("l.jpg");
  });

  it("picture > source[data-srcset] e vídeo com data-src/data-poster", () => {
    const $ = load(
      `<picture><source data-srcset="p.webp 1x" type="image/webp"><img data-src="p.jpg"></picture><video data-src="v.mp4" data-poster="v.jpg"></video>`,
    );
    expect(normalizeLazy($)).toBe(3);
    expect($("source").attr("srcset")).toBe("p.webp 1x");
    expect($("picture img").attr("src")).toBe("p.jpg");
    expect($("video").attr("src")).toBe("v.mp4");
    expect($("video").attr("poster")).toBe("v.jpg");
  });

  it("fundos: data-bg/data-background/data-background-image/data-bg-src mesclados ao style", () => {
    const $ = load(`<div id="a" class="lazyload" data-bg="bg-a.jpg"></div>
      <div id="b" style="color: red; background-image: url(data:image/gif;base64,R0l)" data-background="url('bg-b.jpg')"></div>
      <section id="c" data-background-image="https://x.com/c.png"></section>
      <div id="d" data-bg-src="/d.webp" style="padding:0"></div>
      <div id="e" data-bg="#ffffff"></div>`);
    expect(normalizeLazy($)).toBe(4);
    expect($("#a").attr("style")).toBe(`background-image: url("bg-a.jpg");`);
    expect($("#a").attr("class")).toBe("lazyloaded");
    expect($("#b").attr("style")).toBe(`color: red; background-image: url('bg-b.jpg');`);
    expect($("#c").attr("style")).toBe(`background-image: url("https://x.com/c.png");`);
    expect($("#d").attr("style")).toBe(`padding:0; background-image: url("/d.webp");`);
    expect($("#d").attr("data-bg-src")).toBeUndefined();
    // cor não é imagem
    expect($("#e").attr("style")).toBeUndefined();
    expect($("#e").attr("data-bg")).toBe("#ffffff");
  });

  it("Elementor: containers ganham e-lazyloaded", () => {
    const $ = load(
      `<div id="a" class="elementor-element e-con e-parent e-flex"></div><div id="b" class="elementor-element elementor-widget" data-bg="w.jpg"></div><div id="c" class="elementor-element e-con e-child"></div><div id="d" class="elementor-element e-con e-parent e-lazyloaded"></div>`,
    );
    expect(normalizeLazy($)).toBe(2);
    expect($("#a").hasClass("e-lazyloaded")).toBe(true);
    expect($("#b").hasClass("e-lazyloaded")).toBe(true);
    expect($("#b").attr("style")).toBe(`background-image: url("w.jpg");`);
    expect($("#c").hasClass("e-lazyloaded")).toBe(false);
  });

  it("LiteSpeed: data-lazyloaded sai e ganha litespeed-loaded", () => {
    const $ = load(
      `<img data-lazyloaded="1" src="data:image/svg+xml;base64,PHN2Zz4=" data-src="ls.jpg" width="10"><iframe data-lazyloaded="1" src="about:blank" data-src="https://player.vimeo.com/video/1"></iframe>`,
    );
    expect(normalizeLazy($)).toBe(2);
    expect($("img").attr("src")).toBe("ls.jpg");
    expect($("img").attr("data-lazyloaded")).toBeUndefined();
    expect($("img").hasClass("litespeed-loaded")).toBe(true);
    expect($("iframe").attr("src")).toBe("https://player.vimeo.com/video/1");
  });

  it("classe lazyload esconde imagem já carregada: vira lazyloaded; a3 lazy-hidden → lazy-loaded", () => {
    const $ = load(
      `<img id="a" class="lazyload" src="real.jpg"><img id="b" class="lazy-hidden" src="blank.gif" data-src="a3.jpg"><img id="c" class="lazyload" src="data:image/gif;base64,R0l">`,
    );
    expect(normalizeLazy($)).toBe(2);
    expect($("#a").attr("class")).toBe("lazyloaded");
    expect($("#b").attr("class")).toBe("lazy-loaded");
    expect($("#b").attr("src")).toBe("a3.jpg");
    // sem endereço real: nada a mostrar, fica como está
    expect($("#c").attr("class")).toBe("lazyload");
  });

  it("idempotente: segunda passada não muda nada", () => {
    const $ = load(`<img class="lazyload" data-src="a.jpg"><div data-bg="b.jpg"></div>`);
    expect(normalizeLazy($)).toBe(2);
    const once = $.html();
    expect(normalizeLazy($)).toBe(0);
    expect($.html()).toBe(once);
  });

  it("isPlaceholderSrc", () => {
    expect(isPlaceholderSrc("")).toBe(true);
    expect(isPlaceholderSrc("data:image/gif;base64,x")).toBe(true);
    expect(isPlaceholderSrc("/img/lazy_placeholder.gif")).toBe(true);
    expect(isPlaceholderSrc("https://x.com/spacer.gif?v=1")).toBe(true);
    expect(isPlaceholderSrc("/img/hero.jpg")).toBe(false);
    expect(isPlaceholderSrc("/img/produto.png")).toBe(false);
  });

  it("depois do normalizeLazy, collect/rewrite enxergam os endereços reais", () => {
    const $ = load(`<img class="lazyload" src="blank.gif" data-src="img/real.jpg"><div data-bg="img/bg.jpg"></div>`);
    normalizeLazy($);
    expect(collectHtmlRefs($, PAGE).map((r) => r.url)).toEqual([
      "https://site.com/oferta/img/real.jpg",
      "https://site.com/oferta/img/bg.jpg",
    ]);
    rewriteHtmlRefs($, PAGE, toLocal);
    expect($("img").attr("src")).toBe("/os-assets/real.jpg");
    expect($("div").attr("style")).toBe(`background-image: url("/os-assets/bg.jpg");`);
  });
});
