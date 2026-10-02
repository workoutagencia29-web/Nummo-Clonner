import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import {
  BASE_CSS_ATTR,
  baseStylesheetText,
  EDITS_STYLE_ATTR,
  FIX_STYLE_ATTR,
  finalizeFromEditor,
  importantFixCss,
  linkBaseStylesheet,
  OS_NOSCRIPT_TAG,
  OS_SCRIPT_TAG,
  prepareForEditor,
  protectStyleValue,
  stripEditorMarkers,
} from "@/lib/editor-html";

const PAGE = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Oferta</title>
<link rel="stylesheet" href="/os-assets/aaa.css">
<style>.titulo{color:red}</style>
<link rel="stylesheet" href="/os-assets/bbb.css" media="(max-width: 600px)">
<script type="application/ld+json">{"@type":"Product","name":"<b>X</b>"}</script>
</head><body>
<h1 class="titulo" onclick="alert('oi')">Olá & bem-vindo</h1>
<style>.corpo{margin:0}</style>
<button data-os-href="https://pay.hotmart.com/X" onmouseover="x()">Comprar</button>
<script src="/os-assets/ccc.js" defer></script>
<script>if (a < b && c > d) { document.write("<p>oi</p>"); }</script>
</body></html>`;

describe("prepareForEditor", () => {
  const prepared = prepareForEditor(PAGE);
  const $ = cheerio.load(prepared.html);

  it("tira todo o CSS original, na ordem, com media", () => {
    expect(prepared.styles).toEqual([
      { kind: "link", href: "/os-assets/aaa.css", media: undefined },
      { kind: "inline", text: ".titulo{color:red}", media: undefined },
      { kind: "link", href: "/os-assets/bbb.css", media: "(max-width: 600px)" },
      { kind: "inline", text: ".corpo{margin:0}", media: undefined },
    ]);
    expect($('link[rel="stylesheet"], style')).toHaveLength(0);
  });

  it("scripts viram elementos inertes e escondidos (os do <head> ficam fora do editor)", () => {
    expect($("script")).toHaveLength(0);
    expect($(`body ${OS_SCRIPT_TAG}`)).toHaveLength(2);
    expect($(`head ${OS_SCRIPT_TAG}`)).toHaveLength(0);
    expect($(OS_SCRIPT_TAG).first().attr("hidden")).toBeDefined();
    // O <head> do editor só tem o que o canvas usa.
    expect(
      $("head")
        .children()
        .toArray()
        .map((el) => el.tagName),
    ).toEqual(["meta", "meta", "title"]);
  });

  it("on* viram data-os-on-*", () => {
    expect($("h1").attr("onclick")).toBeUndefined();
    expect($("h1").attr("data-os-on-click")).toBe("alert('oi')");
    expect($("button").attr("data-os-on-mouseover")).toBe("x()");
  });
});

describe("ida e volta (prepare → finalize)", () => {
  it("devolve scripts, atributos on* e texto exatamente como eram", () => {
    const prepared = prepareForEditor(PAGE);
    // Como no salvar: o HTML guardado antes devolve o <head> (com o JSON-LD).
    const back = cheerio.load(finalizeFromEditor(prepared.html, "", PAGE));
    const scripts = back("script");
    expect(scripts).toHaveLength(3);
    expect(scripts.eq(0).attr("type")).toBe("application/ld+json");
    expect(scripts.eq(0).html()).toBe('{"@type":"Product","name":"<b>X</b>"}');
    expect(scripts.eq(1).attr("src")).toBe("/os-assets/ccc.js");
    expect(scripts.eq(1).attr("defer")).toBeDefined();
    expect(scripts.eq(2).html()).toBe('if (a < b && c > d) { document.write("<p>oi</p>"); }');
    expect(back("h1").attr("onclick")).toBe("alert('oi')");
    expect(back("h1").text()).toBe("Olá & bem-vindo");
    expect(back("[data-os-on-click]")).toHaveLength(0);
  });

  it("injeta as edições logo depois da folha base e garante charset/viewport/doctype", () => {
    const withBase = linkBaseStylesheet(
      prepareForEditor("<html><head></head><body><p>x</p></body></html>").html,
      "/os-assets/base.css",
    );
    const out = finalizeFromEditor(withBase, "#i1{color:blue}");
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
    const $ = cheerio.load(out);
    expect($("meta[charset]")).toHaveLength(1);
    expect($('meta[name="viewport"]')).toHaveLength(1);
    const base = $(`link[${BASE_CSS_ATTR}]`);
    expect(base.attr("href")).toBe("/os-assets/base.css");
    expect(base.next().is(`style[${EDITS_STYLE_ATTR}]`)).toBe(true);
    expect($(`style[${EDITS_STYLE_ATTR}]`).text()).toBe("#i1{color:blue}");
  });

  it("não duplica a folha base nem as edições em salvamentos seguidos", () => {
    let html = linkBaseStylesheet("<html><head></head><body></body></html>", "/os-assets/b1.css");
    html = linkBaseStylesheet(html, "/os-assets/b2.css");
    html = finalizeFromEditor(html, "a{}");
    html = finalizeFromEditor(prepareForEditor(html).html, "b{}");
    const $ = cheerio.load(html);
    expect($(`link[${BASE_CSS_ATTR}]`)).toHaveLength(1);
    expect($(`style[${EDITS_STYLE_ATTR}]`)).toHaveLength(1);
    expect($(`style[${EDITS_STYLE_ATTR}]`).text()).toBe("b{}");
  });
});

describe("baseStylesheetText", () => {
  it("importa as folhas na camada os-original, com media", () => {
    expect(
      baseStylesheetText([
        { href: "/os-assets/a.css" },
        { href: "/os-assets/b.css", media: "print" },
        { href: "/os-assets/c.css", media: "all" },
      ]),
    ).toBe(
      '@layer os-fix, os-original;\n@import url("/os-assets/a.css") layer(os-original);\n@import url("/os-assets/b.css") layer(os-original) print;\n@import url("/os-assets/c.css") layer(os-original);\n',
    );
  });
});

// ─── Correções da Fase 3 (grupo H) ───────────────────────────────────────────

/** Ida e volta sem o GrapesJS: o que o editor devolveria sem mexer em nada. */
const roundTrip = (stored: string, css = "") => finalizeFromEditor(prepareForEditor(stored).html, css, stored);

describe("marcas do editor vindas da página (#0 e #3)", () => {
  const HOSTILE = `<!doctype html><html><head><title>T</title></head><body>
<div data-gjs-type="script" data-GJS-script="top.x=1" data-gjs-attributes='{"onclick":"x()"}'>a</div>
<os-script data-os-attrs='{"src":"https://tracker.evil.example/t.js"}' hidden></os-script>
<os-noscript data-os-attrs='{}' hidden>&lt;img src=x&gt;</os-noscript>
<button data-os-on-click="location.href='https://evil.example'" data-os-attrs="{}">b</button>
<a data-os-js-href="alert(1)" data-os-dup-id="x">c</a>
</body></html>`;

  it("prepareForEditor apaga data-gjs-* e as marcas prontas antes de criar as suas", () => {
    const html = prepareForEditor(HOSTILE).html;
    expect(html).not.toMatch(/data-gjs-/i);
    expect(html).not.toContain("tracker.evil.example");
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain(OS_NOSCRIPT_TAG);
    expect(html).not.toMatch(/data-os-(attrs|js-|dup-id)/);
  });

  it("o salvar não transforma nada disso em script, on* ou javascript:", () => {
    const out = roundTrip(HOSTILE);
    const $ = cheerio.load(out);
    expect($("script")).toHaveLength(0);
    expect($("noscript")).toHaveLength(0);
    expect(out).not.toMatch(/onclick|javascript:|evil\.example|data-gjs-/i);
    expect($("div").text()).toBe("a");
  });

  it("stripEditorMarkers só tira marcas (data-os-* legítimos ficam)", () => {
    const $ = cheerio.load(
      '<p data-os-href="https://pay.x" data-os-link="checkout" data-os-delay="3" data-gjs-type="x" data-os-on-x="y">p</p>',
    );
    stripEditorMarkers($);
    expect($("p").attr()).toEqual({
      "data-os-href": "https://pay.x",
      "data-os-link": "checkout",
      "data-os-delay": "3",
    });
  });
});

describe("<head> fica com a página (#8)", () => {
  const STORED = `<!DOCTYPE html>
<html lang="pt-BR" class="no-js"><head>
<meta charset="utf-8"><script>window.dataLayer=[];</script>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Minha Oferta</title><meta name="description" content="Descrição">
<meta property="og:image" content="/os-assets/og.png"><link rel="canonical" href="https://minha.oferta/">
<link rel="icon" href="/os-assets/f.ico"><meta http-equiv="refresh" content="30">
<base href="https://minha.oferta/"><noscript><img src="/os-assets/px.gif"></noscript>
<link rel="stylesheet" href="/os-assets/a.css"><style>.x{color:red}</style>
</head><body><p>Oi</p></body></html>`;

  it("o editor recebe só título, metas simples e a folha base", () => {
    const $ = cheerio.load(linkBaseStylesheet(prepareForEditor(STORED).html, "/os-assets/base.css"));
    expect(
      $("head")
        .children()
        .toArray()
        .map((el) => $.html(el)),
    ).toEqual([
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">',
      `<link rel="stylesheet" href="/os-assets/base.css" ${BASE_CSS_ATTR}="">`,
      "<title>Minha Oferta</title>",
      '<meta name="description" content="Descrição">',
      '<meta property="og:image" content="/os-assets/og.png">',
    ]);
    expect($("body").children()).toHaveLength(1);
  });

  it("ao salvar, o <head> guardado volta inteiro e na ordem (sem o CSS original, que está na base)", () => {
    const editor = linkBaseStylesheet(prepareForEditor(STORED).html, "/os-assets/base.css");
    const out = finalizeFromEditor(editor, "#i1{color:blue}", STORED);
    const $ = cheerio.load(out);
    expect(
      $("head")
        .children()
        .toArray()
        .map((el) => el.tagName),
    ).toEqual([
      "meta",
      "script",
      "meta",
      "link",
      "style",
      "title",
      "meta",
      "meta",
      "link",
      "link",
      "meta",
      "base",
      "noscript",
    ]);
    expect($("head > link").first().attr(BASE_CSS_ATTR)).toBeDefined();
    expect($(`style[${EDITS_STYLE_ATTR}]`).text()).toBe("#i1{color:blue}");
    expect($('meta[name="viewport"]')).toHaveLength(1);
    expect($('meta[name="viewport"]').attr("content")).toContain("maximum-scale=1");
    expect($("html").attr("class")).toBe("no-js");
    expect($('link[href="/os-assets/a.css"], style:not([data-os-edits])')).toHaveLength(0);
    expect($("body").html()).toBe("<p>Oi</p>");
    // Salvar de novo (o HTML anterior agora é o finalizado) não duplica nada.
    const again = cheerio.load(finalizeFromEditor(editor, "#i1{color:blue}", out));
    expect(again("head").html()).toBe($("head").html());
  });

  it("repara páginas salvas antes: título, metas e links que foram parar no <body> voltam para o <head>", () => {
    const damagedStored =
      '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
      '<body><script>window.dataLayer=[];</script><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">' +
      '<title>Minha Oferta</title><meta name="description" content="D"><link rel="canonical" href="https://x/">' +
      '<meta itemprop="price" content="97"><p>Oi</p></body></html>';
    // O projeto salvo ainda tem esses elementos no corpo.
    const exported = prepareForEditor(damagedStored).html;
    const out = finalizeFromEditor(exported, "", damagedStored);
    const $ = cheerio.load(out);
    expect($("head > title").text()).toBe("Minha Oferta");
    expect($('head > meta[name="description"]')).toHaveLength(1);
    expect($('head > link[rel="canonical"]')).toHaveLength(1);
    expect($('meta[name="viewport"]')).toHaveLength(1);
    expect($('meta[name="viewport"]').attr("content")).toContain("maximum-scale=1");
    expect($("body > title, body > meta[name], body > link")).toHaveLength(0);
    // Microdados continuam onde estavam; o script também.
    expect($("body > meta[itemprop]")).toHaveLength(1);
    expect($("body > script")).toHaveLength(1);
    // No salvamento seguinte (o projeto ainda tem os elementos no corpo) nada se repete.
    const again = cheerio.load(finalizeFromEditor(exported, "", out));
    expect(again("title")).toHaveLength(1);
    expect(again('meta[name="description"]')).toHaveLength(1);
  });

  it("se o editor não mandou a folha base, a anterior fica (o CSS não some)", () => {
    const stored = finalizeFromEditor(
      linkBaseStylesheet("<html><head><title>T</title></head><body></body></html>", "/os-assets/b1.css"),
      "",
    );
    const $ = cheerio.load(finalizeFromEditor("<html><head></head><body><p>x</p></body></html>", "", stored));
    expect($(`link[${BASE_CSS_ATTR}]`).attr("href")).toBe("/os-assets/b1.css");
  });

  it("sem HTML anterior (página nova) o <head> do editor é usado", () => {
    const out = cheerio.load(roundTrip("<html><head><title>Nova</title></head><body></body></html>"));
    expect(out("title").text()).toBe("Nova");
  });
});

describe("ids repetidos (#9)", () => {
  const STORED =
    '<html><head></head><body><a id="comprar" class="btn">1</a><section><a id="comprar" class="btn">2</a></section>' +
    '<div id="bloco">a</div><div id="bloco">b</div><div id="unico">c</div></body></html>';

  it("o editor não vê o id repetido; ao salvar ele volta igual", () => {
    const $p = cheerio.load(prepareForEditor(STORED).html);
    expect($p("#comprar")).toHaveLength(1);
    expect($p('[data-os-dup-id="comprar"]')).toHaveLength(1);
    const $ = cheerio.load(roundTrip(STORED));
    expect($('[id="comprar"]')).toHaveLength(2);
    expect($('[id="bloco"]')).toHaveLength(2);
    expect($("#unico")).toHaveLength(1);
    expect($("[data-os-dup-id]")).toHaveLength(0);
  });

  it("repetido que ganhou estilo no editor: o id original volta e a regra mira o elemento certo", () => {
    const editor = prepareForEditor(STORED).html.replace(
      'data-os-dup-id="comprar"',
      'data-os-dup-id="comprar" id="i9xk"',
    );
    const out = finalizeFromEditor(editor, "#i9xk{color:blue;}#i9xk:hover{color:red !important;}", STORED);
    const $ = cheerio.load(out);
    expect($('[id="comprar"]')).toHaveLength(2);
    expect($('[id="comprar"]').eq(1).attr("data-os-eid")).toBe("i9xk");
    expect($(`style[${EDITS_STYLE_ATTR}]`).text()).toBe(
      '#comprar[data-os-eid="i9xk"]{color:blue}#comprar[data-os-eid="i9xk"]:hover{color:red!important}',
    );
    expect($(`style[${FIX_STYLE_ATTR}]`).text()).toContain('#comprar[data-os-eid="i9xk"]:hover{color:red!important}');
  });

  it("edição do PRIMEIRO elemento de um id repetido fica só nele (os repetidos levam a marca)", () => {
    const editor = prepareForEditor(STORED).html;
    const css =
      "#comprar{color:blue;}#comprar:hover{color:red !important;}@media (max-width: 480px){#comprar::before{content:'x';}}" +
      "#comprar .icone{color:green;}#comprar.btn{margin:0;}#unico{color:blue;}";
    const out = finalizeFromEditor(editor, css, STORED);
    const $ = cheerio.load(out);
    expect($('[id="comprar"]')).toHaveLength(2);
    // Só o repetido de um id com regra do primeiro ganha a marca.
    expect($('[id="comprar"]').eq(0).attr("data-os-dup-id")).toBeUndefined();
    expect($('[id="comprar"]').eq(1).attr("data-os-dup-id")).toBe("comprar");
    expect($("[data-os-dup-id]")).toHaveLength(1);
    // Só as regras "de um id" (id + estados), como o editor as lê; as compostas ficam iguais.
    expect($(`style[${EDITS_STYLE_ATTR}]`).text()).toBe(
      "#comprar:not([data-os-dup-id]){color:blue}#comprar:not([data-os-dup-id]):hover{color:red!important}" +
        "@media (max-width: 480px){#comprar:not([data-os-dup-id])::before{content:'x'}}" +
        "#comprar .icone{color:green}#comprar.btn{margin:0}#unico{color:blue}",
    );
    expect($(`style[${FIX_STYLE_ATTR}]`).text()).toContain("#comprar:not([data-os-dup-id]):hover{color:red!important}");
    // Salvar de novo não repete a marca.
    expect(finalizeFromEditor(editor, css, out)).toBe(out);
  });

  it("marca data-os-eid que já estava no repetido continua a mesma (as regras antigas miram nela)", () => {
    const editor = prepareForEditor(STORED).html.replace(
      'data-os-dup-id="comprar"',
      'data-os-dup-id="comprar" data-os-eid="antigo" id="i9xk"',
    );
    const out = finalizeFromEditor(editor, '#i9xk{color:blue;}#comprar[data-os-eid="antigo"]{margin:0}', STORED);
    const $ = cheerio.load(out);
    expect($('[id="comprar"]').eq(1).attr("data-os-eid")).toBe("antigo");
    expect($(`style[${EDITS_STYLE_ATTR}]`).text()).toBe(
      '#comprar[data-os-eid="antigo"]{color:blue}#comprar[data-os-eid="antigo"]{margin:0}',
    );
  });

  it("id do editor que precisa de escape no CSS (#\\31 -2, cópia de Duplicar ou reparo): a regra também vai para o repetido", () => {
    const html =
      '<html><head></head><body><div id="1">a</div><div id="1-2" data-os-dup-id="1">b</div>' +
      '<div id="a.b">c</div><div id="a.b-2" data-os-dup-id="a.b">d</div>' +
      '<div id="ok">e</div><div id="ok-2" data-os-dup-id="ok">f</div></body></html>';
    const css =
      "#\\31 -2{color:blue;}#a\\.b-2:hover{color:red;}#ok-2{color:green;}" +
      "@media (max-width: 767px){:is(#\\31 -2){color:revert-layer;}:is(#a\\.b-2){color:revert-layer;}}";
    const $ = cheerio.load(finalizeFromEditor(html, css));
    expect(
      $("body > div")
        .map((_, el) => `${$(el).attr("id")}|${$(el).attr("data-os-eid") ?? ""}`)
        .get(),
    ).toEqual(["1|", "1|1-2", "a.b|", "a.b|a.b-2", "ok|", "ok|ok-2"]);
    expect($(`style[${EDITS_STYLE_ATTR}]`).text()).toBe(
      // "\\31 " é o escape do "1" (o espaço faz parte dele).
      '#\\31 [data-os-eid="1-2"]{color:blue}#a\\.b[data-os-eid="a.b-2"]:hover{color:red}#ok[data-os-eid="ok-2"]{color:green}' +
        '@media (max-width: 767px){:is(#\\31 [data-os-eid="1-2"]){color:revert-layer}:is(#a\\.b[data-os-eid="a.b-2"]){color:revert-layer}}',
    );
  });
});

describe("<noscript> (#14 e #42)", () => {
  const STORED = `<html><head><noscript><style id="rocket-lazyload-nojs-css">.rll-youtube-player, [data-lazy-src]{display:none !important;}</style></noscript></head>
<body><noscript class="n"><style>.lazyload{display:none!important}</style><img src="/os-assets/a.png"></noscript><img class="lazyload" src="/os-assets/a.png"></body></html>`;

  it("vira texto inerte no editor (nenhum <style> para o editor ler)", () => {
    const $ = cheerio.load(prepareForEditor(STORED).html);
    expect($("noscript, style")).toHaveLength(0);
    expect($(OS_NOSCRIPT_TAG).attr("hidden")).toBeDefined();
    expect($(OS_NOSCRIPT_TAG).text()).toBe(
      '<style>.lazyload{display:none!important}</style><img src="/os-assets/a.png">',
    );
  });

  it("volta igual (head e body), sem virar CSS das edições", () => {
    const out = roundTrip(STORED);
    expect(out).toContain(
      '<noscript><style id="rocket-lazyload-nojs-css">.rll-youtube-player, [data-lazy-src]{display:none !important;}</style></noscript>',
    );
    expect(out).toContain(
      '<noscript class="n"><style>.lazyload{display:none!important}</style><img src="/os-assets/a.png"></noscript>',
    );
    expect(out).not.toContain(EDITS_STYLE_ATTR);
    expect(prepareForEditor(STORED).styles).toEqual([]);
  });
});

describe("javascript: e CSS assíncrono (#12)", () => {
  const STORED = `<html><head>
<link rel="stylesheet" href="/os-assets/async.css" media="print" onload="this.media='all'">
<link rel="preload" as="style" href="/os-assets/load.css" onload="this.onload=null;this.rel='stylesheet'">
<link rel="alternate stylesheet" href="/os-assets/alt.css" title="alt">
</head><body><a id="b1" href="javascript:void(0)" onclick="javascript:abrir()">Abrir</a>
<iframe src="javascript:false"></iframe><a id="b2" href="JavaScript:x()">b2</a></body></html>`;

  it("valores javascript: passam pelo editor como marca e voltam; on* com javascript: também", () => {
    const $p = cheerio.load(prepareForEditor(STORED).html);
    // Nada que o GrapesJS apagaria (valor começando com "javascript:").
    for (const el of $p("*").toArray()) {
      if (!("attribs" in el)) continue;
      for (const v of Object.values(el.attribs)) expect(v.startsWith("javascript:")).toBe(false);
    }
    const $ = cheerio.load(roundTrip(STORED));
    expect($("#b1").attr("href")).toBe("javascript:void(0)");
    expect($("#b1").attr("onclick")).toBe("javascript:abrir()");
    expect($("iframe").attr("src")).toBe("javascript:false");
    expect($("#b2").attr("href")).toBe("JavaScript:x()");
    expect(roundTrip(STORED)).not.toContain("data-os-js-");
  });

  it("um endereço novo posto no editor vence o javascript: antigo", () => {
    const editor = prepareForEditor(STORED).html.replace(
      'data-os-js-href="void(0)"',
      'data-os-js-href="void(0)" href="https://pay.x/1"',
    );
    const $ = cheerio.load(finalizeFromEditor(editor, "", STORED));
    expect($("#b1").attr("href")).toBe("https://pay.x/1");
  });

  it("CSS carregado depois (media=print + onload, preload do loadCSS) vale na tela e sai do <head>", () => {
    const prepared = prepareForEditor(STORED);
    expect(prepared.styles).toEqual([
      { kind: "link", href: "/os-assets/async.css", media: undefined },
      { kind: "link", href: "/os-assets/load.css", media: undefined },
    ]);
    const editor = linkBaseStylesheet(prepared.html, "/os-assets/base.css");
    const $ = cheerio.load(finalizeFromEditor(editor, "", STORED));
    // Sem cópia fora da camada (ela venceria as edições depois do onload).
    expect($('link[href="/os-assets/async.css"], link[href="/os-assets/load.css"]')).toHaveLength(0);
    expect($('link[href="/os-assets/alt.css"]')).toHaveLength(1);
    expect($(`link[${BASE_CSS_ATTR}]`)).toHaveLength(1);
    const media = prepareForEditor(STORED.replace("this.media='all'", "this.media='screen'")).styles[0].media;
    expect(media).toBe("screen");
    const removed = STORED.replace("this.media='all'", "this.onload=null;this.removeAttribute('media')");
    expect(prepareForEditor(removed).styles[0].media).toBeUndefined();
    // Folha de impressão de verdade (sem onload) continua só na impressão.
    expect(prepareForEditor('<link rel="stylesheet" href="/p.css" media="print">').styles).toEqual([
      { kind: "link", href: "/p.css", media: "print" },
    ]);
  });
});

describe("style com url(data:…;base64) (#53)", () => {
  it("';' e '*' dentro de url() e de aspas viram escapes CSS", () => {
    expect(protectStyleValue("color:red;background:url(data:image/gif;base64,R0l/*x*/GOD==) repeat")).toBe(
      "color:red;background:url(data:image/gif\\3b base64,R0l/\\2a x\\2a /GOD==) repeat",
    );
    expect(protectStyleValue(`background:url("data:image/svg+xml;utf8,<svg/>");font-family:"a;b",x`)).toBe(
      `background:url("data:image/svg+xml\\3b utf8,<svg/>");font-family:"a\\3b b",x`,
    );
    expect(protectStyleValue("color:red;margin:0")).toBe("color:red;margin:0");
    expect(protectStyleValue("content:'\\';';x:y")).toBe("content:'\\'\\3b ';x:y");
  });

  it("prepareForEditor protege o style de todos os elementos", () => {
    const $ = cheerio.load(prepareForEditor('<div style="background:url(data:image/gif;base64,AA)">x</div>').html);
    expect($("div").attr("style")).toBe("background:url(data:image/gif\\3b base64,AA)");
  });
});

describe("!important do CSS original (#46)", () => {
  it("a base declara os-fix antes de os-original", () => {
    expect(baseStylesheetText([])).toBe("@layer os-fix, os-original;\n");
  });

  it("as edições !important ganham cópia na camada os-fix, antes da folha base", () => {
    const editor = linkBaseStylesheet(
      prepareForEditor("<html><head></head><body><h1>x</h1></body></html>").html,
      "/os-assets/b.css",
    );
    const css =
      "#t1{color:blue !important;margin:0}@media (max-width: 480px){#t1{font-size:10px!important}}.c{width:1px}@keyframes k{from{opacity:0}}";
    const $ = cheerio.load(finalizeFromEditor(editor, css));
    const fix = $(`style[${FIX_STYLE_ATTR}]`);
    expect(fix.next().is(`link[${BASE_CSS_ATTR}]`)).toBe(true);
    expect(fix.text()).toBe(
      "@layer os-fix, os-original;@layer os-fix{#t1{color:blue!important}@media (max-width: 480px){#t1{font-size:10px!important}}}",
    );
    expect($(`style[${EDITS_STYLE_ATTR}]`).text()).toBe(css);
    // Sem !important, nada de os-fix.
    expect(cheerio.load(finalizeFromEditor(editor, "#t1{color:blue}"))(`style[${FIX_STYLE_ATTR}]`)).toHaveLength(0);
  });

  it("um </style> dentro do CSS não fecha a tag das edições", () => {
    const css = '.a::after{content:"</style><script>x()</script>" !important}';
    const $ = cheerio.load(finalizeFromEditor("<html><head></head><body></body></html>", css));
    expect($("script")).toHaveLength(0);
    expect($(`style[${EDITS_STYLE_ATTR}]`).text()).toBe(
      '.a::after{content:"<\\/style><script>x()</script>" !important}',
    );
    expect($(`style[${FIX_STYLE_ATTR}]`).text()).toContain("<\\/style>");
  });

  it("importantFixCss ignora CSS inválido e regras sem !important", () => {
    expect(importantFixCss("")).toBe("");
    expect(importantFixCss(".a{color:red}")).toBe("");
    expect(importantFixCss("@font-face{font-family:x!important}")).toBe("");
  });

  it("reimportar a página não leva a cópia os-fix para o editor", () => {
    const html = finalizeFromEditor(
      linkBaseStylesheet("<html><head></head><body></body></html>", "/os-assets/b.css"),
      "#a{color:red!important}",
    );
    const prepared = prepareForEditor(html);
    expect(prepared.html).not.toContain(FIX_STYLE_ATTR);
    expect(prepared.styles).toEqual([]);
    expect(cheerio.load(prepared.html)(`style[${EDITS_STYLE_ATTR}]`)).toHaveLength(1);
  });
});
