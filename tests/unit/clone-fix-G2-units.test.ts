/**
 * Correções da Fase 2 (grupo G2), nível das funções puras do clonador:
 * rastreadores × conteúdo em CDNs de marketing, atraso de VSL com classe
 * própria da página, navegação por onclick, ganchos do modo Editável e
 * origens internas de importação (ZIP / HTML colado).
 */
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { convertJsNavigation, detectCheckouts, markCheckouts } from "@/worker/clone/checkouts";
import {
  convertToggles,
  markVideoFacades,
  normalizeAnimations,
  parseToggleActions,
  sanitizeScriptUrls,
} from "@/worker/clone/editable-compat";
import { suggestFunnel } from "@/worker/clone/funnel";
import { rewriteHtmlRefs } from "@/worker/clone/html-assets";
import {
  IMPORT_ORIGIN,
  isSyntheticOrigin,
  PASTE_ORIGIN,
  relativeToPage,
  syntheticSource,
} from "@/worker/clone/synthetic";
import { classifyRequest, classifyUrlSource, removeTrackers } from "@/worker/clone/trackers";
import { extractDelay, unhideDelayed } from "@/worker/clone/vsl";

const load = (html: string) => cheerio.load(html);

// ─── fidelity#8: imagens de CDNs de marketing não são "pixels" ─────────────────

describe("fidelity#8 — conteúdo em CDN de marketing (RD Station, ActiveCampaign, Mailchimp)", () => {
  const page = "https://oferta.com.br/lp";

  it("imagens visíveis do RD Station, ActiveCampaign e Mailchimp ficam na cópia", () => {
    const $ = load(`<body>
      <img id="rd" src="https://d335luupugsy2.cloudfront.net/cms/files/1/logo.png" alt="Logo">
      <img id="ac" src="https://content.app-us1.com/abc/2024/01/foto.jpg" width="600" height="400">
      <img id="mc" src="https://gallery.mailchimp.com/abc/images/banner.png">
      <noscript><img id="nsrd" src="https://gallery.mailchimp.com/abc/images/fallback.png"></noscript>
      <link rel="stylesheet" href="https://d335luupugsy2.cloudfront.net/cms/css/lp.css">
    </body>`);
    const removed = removeTrackers($, page);
    expect($("#rd")).toHaveLength(1);
    expect($("#ac")).toHaveLength(1);
    expect($("#mc")).toHaveLength(1);
    expect($("noscript")).toHaveLength(1);
    expect($('link[rel="stylesheet"]')).toHaveLength(1);
    expect(removed.filter((r) => r.kind === "pixel")).toEqual([]);
  });

  it("o carregador do RD Station e pixels invisíveis continuam sendo removidos", () => {
    const $ = load(`<body>
      <script src="https://d335luupugsy2.cloudfront.net/js/loader-scripts/abc-loader.js"></script>
      <img id="px" src="https://content.app-us1.com/track/1.gif" width="1" height="1">
      <img id="hid" src="https://gallery.mailchimp.com/abc/open.gif" style="display:none">
    </body>`);
    const removed = removeTrackers($, page);
    expect($("script")).toHaveLength(0);
    expect($("#px")).toHaveLength(0);
    expect($("#hid")).toHaveLength(0);
    expect(removed.map((r) => r.vendor)).toContain("RD Station");
  });

  it("classifyUrlSource diz se veio de assinatura própria ou só do host (third-party-web)", () => {
    expect(classifyUrlSource("https://d335luupugsy2.cloudfront.net/cms/files/1/logo.png")).toBeNull();
    expect(classifyUrlSource("https://d335luupugsy2.cloudfront.net/js/loader-scripts/x.js")?.via).toBe("signature");
    expect(classifyUrlSource("https://content.app-us1.com/abc/foto.jpg")?.via).toBe("tpw");
  });

  it("classifyRequest (captura): imagem/CSS/fonte de host só-TPW passa; script continua bloqueado", () => {
    const img = "https://content.app-us1.com/abc/2024/01/foto.jpg";
    expect(classifyRequest(img, "image")).toBeNull();
    expect(classifyRequest(img, "stylesheet")).toBeNull();
    expect(classifyRequest("https://content.app-us1.com/abc/app.js", "script")).not.toBeNull();
    // Caminho de pixel continua bloqueado mesmo sendo "imagem".
    expect(classifyRequest("https://content.app-us1.com/track/pixel.gif?ev=open", "image")).not.toBeNull();
    // Assinatura própria (pixel da Meta) bloqueia qualquer tipo.
    expect(classifyRequest("https://www.facebook.com/tr?id=1&ev=PageView", "image")).not.toBeNull();
  });
});

// ─── fidelity#6: atraso de VSL com classe/id próprios da página ────────────────

describe("fidelity#6 — atraso da VSL: o 'esconde' da própria página sai", () => {
  it("classe própria citada pelo script (.oculto-vsl) é removida do elemento marcado", () => {
    const $ = load(`<body>
      <style>.oculto-vsl{display:none}</style>
      <vturb-smartplayer id="vid-0123456789abcdef01234567"></vturb-smartplayer>
      <div id="cta" class="oculto-vsl bloco"><a href="https://pay.hotmart.com/X1" class="btn">Comprar</a></div>
      <script>
        var delaySeconds = 5;
        var player = document.querySelector("vturb-smartplayer");
        player.addEventListener("player:ready", function () { player.displayHiddenElements(delaySeconds, [".oculto-vsl"], { persist: true }); });
      </script>
    </body>`);
    expect(extractDelay($)).toMatchObject({ seconds: 5, elements: 1 });
    unhideDelayed($);
    expect($("#cta").attr("data-os-delay")).toBe("5");
    expect($("#cta").attr("class")).toBe("bloco");
    // A classe tirada resolveu: nada de display forçado.
    expect($("#cta").attr("style")).toBeUndefined();
  });

  it("seletor por #id: ganha o display que o script usaria (o runtime esconde até a hora)", () => {
    const $ = load(`<body>
      <style>#botao{display:none}</style>
      <div id="botao" class="linha"><a href="https://pay.kiwify.com.br/abc">Quero</a></div>
      <script>
        setTimeout(function () { document.getElementById("botao").style.display = "flex"; }, 30000);
      </script>
    </body>`);
    expect(extractDelay($)).toMatchObject({ seconds: 30 });
    unhideDelayed($);
    expect($("#botao").attr("style")).toBe("display: flex;");
    expect($("#botao").attr("class")).toBe("linha");
  });

  it("classe de estilo (sem cara de 'esconder') não é removida; visibility:hidden inline sai", () => {
    const $ = load(`<body>
      <div id="x" class="btn-comprar" style="visibility: hidden; color: red"><a href="https://pay.kiwify.com.br/a">Comprar</a></div>
      <script>displayHiddenElements(12, [".btn-comprar"]);</script>
    </body>`);
    extractDelay($);
    unhideDelayed($);
    expect($("#x").attr("class")).toBe("btn-comprar");
    expect($("#x").attr("style")).toBe("color: red");
  });

  it("elemento marcado dentro de outro marcado também perde o esconde", () => {
    const $ = load(`<body>
      <div id="fora" class="esconder"><div id="dentro" class="oculto-vsl"><a href="https://pay.hotmart.com/Y">Comprar</a></div></div>
      <script>displayHiddenElements(8, [".esconder", ".oculto-vsl"]);</script>
    </body>`);
    extractDelay($);
    unhideDelayed($);
    expect($("#fora").attr("data-os-delay")).toBe("8");
    expect($("#dentro").attr("data-os-delay")).toBeUndefined();
    expect($("#dentro").attr("class")).toBeUndefined();
    expect($("#fora").attr("class")).toBeUndefined();
  });
});

// ─── fidelity#5: navegação por onclick que não é checkout ──────────────────────

describe("fidelity#5 — onclick que navega (WhatsApp, #âncora, próxima página)", () => {
  const page = "https://oferta.com.br/vendas/";

  it("vira data-os-href / href e perde o onclick", () => {
    const $ = load(`<body>
      <button id="wa" onclick="window.open('https://wa.me/5511999999999?text=Oi')">Fale no WhatsApp</button>
      <button id="anc" onclick="location.href='#oferta'">Quero garantir minha vaga</button>
      <button id="up" onclick="window.location.href = '/obrigado'">Continuar</button>
      <a id="lnk" href="javascript:void(0)" onclick="location.href='proxima.html'">Próxima</a>
      <a id="scroll" href="#" onclick="document.getElementById('oferta').scrollIntoView({behavior:'smooth'})">Ver oferta</a>
      <button id="nada" onclick="fbq('track','Lead')">Só rastreio</button>
      <section id="oferta"></section>
    </body>`);
    markCheckouts($, page, detectCheckouts($, page));
    expect(convertJsNavigation($, page)).toBe(5);
    expect($("#wa").attr("data-os-href")).toBe("https://wa.me/5511999999999?text=Oi");
    expect($("#wa").attr("data-os-target")).toBe("_blank");
    expect($("#anc").attr("data-os-href")).toBe("#oferta");
    expect($("#anc").attr("data-os-target")).toBeUndefined();
    expect($("#up").attr("data-os-href")).toBe("https://oferta.com.br/obrigado");
    expect($("#lnk").attr("href")).toBe("https://oferta.com.br/vendas/proxima.html");
    expect($("#scroll").attr("href")).toBe("#oferta");
    for (const id of ["wa", "anc", "up", "lnk", "scroll"]) expect($(`#${id}`).attr("onclick")).toBeUndefined();
    expect($("#nada").attr("data-os-href")).toBeUndefined();
  });

  it("checkout marcado antes não é sobrescrito; javascript:/data: nunca viram destino", () => {
    const $ = load(`<body>
      <button id="buy" onclick="location.href='https://pay.hotmart.com/ABC123'">Comprar</button>
      <button id="js" onclick="location.href='javascript:alert(1)'">X</button>
    </body>`);
    markCheckouts($, page, detectCheckouts($, page));
    convertJsNavigation($, page);
    expect($("#buy").attr("data-os-href")).toBe("https://pay.hotmart.com/ABC123");
    expect($("#js").attr("data-os-href")).toBeUndefined();
  });

  it("na origem interna de importação o destino fica relativo", () => {
    const $ = load(`<button id="b" onclick="location.href='obrigado.html'">Ok</button>`);
    convertJsNavigation($, `${IMPORT_ORIGIN}/index.html`, {
      localOrigin: IMPORT_ORIGIN,
      toLocal: (target, raw, anchor) => (anchor ? raw : relativeToPage(target, `${IMPORT_ORIGIN}/index.html`)),
    });
    expect($("#b").attr("data-os-href")).toBe("obrigado.html");
  });
});

// ─── security#7: javascript: que sobraria no modo Editável ─────────────────────

describe("security#7 — nada de código em atributos no modo Editável", () => {
  it("data-os-href javascript: sai; http(s), #âncora e caminhos relativos ficam", () => {
    const $ = load(`<body>
      <div id="evil" data-os-href="javascript:location='https://original.com'" data-os-target="_blank">Comprar</div>
      <div id="evil2" data-os-href=" java&#9;script:alert(1)">Comprar</div>
      <div id="ok" data-os-href="https://pay.hotmart.com/X" data-os-target="_blank">Ok</div>
      <div id="anc" data-os-href="#oferta">Ok</div>
      <div id="rel" data-os-href="obrigado.html">Ok</div>
      <a id="a" href="javascript:alert(1)">Link</a>
      <form id="f" action="javascript:void(0)"><button id="b" formaction="JavaScript:alert(2)">Enviar</button></form>
      <iframe id="i" srcdoc="<script>alert(1)</script>"></iframe>
      <iframe id="i2" srcdoc="<p>ok</p>"></iframe>
      <svg><a id="s" xlink:href="javascript:alert(3)"><text>x</text></a></svg>
    </body>`);
    // Controles no começo são ignorados pelo navegador (ainda seria javascript:).
    $("body").append('<div id="ctl">x</div><a id="ctla" href="#">y</a>');
    $("#ctl").attr("data-os-href", "\u0001 javascript:alert(1)");
    $("#ctla").attr("href", "\u0001java\nscript:alert(1)");
    sanitizeScriptUrls($);
    expect($("#ctl").attr("data-os-href")).toBeUndefined();
    expect($("#ctla").attr("href")).toBe("#");
    expect($("#evil").attr("data-os-href")).toBeUndefined();
    expect($("#evil").attr("data-os-target")).toBeUndefined();
    expect($("#evil2").attr("data-os-href")).toBeUndefined();
    expect($("#ok").attr("data-os-href")).toBe("https://pay.hotmart.com/X");
    expect($("#ok").attr("data-os-target")).toBe("_blank");
    expect($("#anc").attr("data-os-href")).toBe("#oferta");
    expect($("#rel").attr("data-os-href")).toBe("obrigado.html");
    expect($("#a").attr("href")).toBe("#");
    expect($("#a").attr("data-os-noop")).toBe("");
    expect($("#f").attr("action")).toBeUndefined();
    expect($("#b").attr("formaction")).toBeUndefined();
    expect($("#i").attr("srcdoc")).toBeUndefined();
    expect($("#i2").attr("srcdoc")).toBe("<p>ok</p>");
    expect($.html()).not.toMatch(/javascript:/i);
  });
});

// ─── fidelity#1: animações de entrada ──────────────────────────────────────────

describe("fidelity#1 — animações de entrada ficam no estado final", () => {
  it("Elementor, AOS, sal.js, WOW e ScrollReveal", () => {
    const $ = load(`<body>
      <h2 id="el" class="elementor-element elementor-invisible elementor-hidden-desktop">Só no celular</h2>
      <div id="aos" data-aos="fade-up" class="aos-init">AOS</div>
      <div id="sal" data-sal="slide-up">sal</div>
      <div id="wow" class="wow fadeInUp" style="visibility: hidden; animation-name: none;">WOW</div>
      <div id="sr" data-sr-id="3" style="visibility: hidden; opacity: 0; transform: translateY(20px); color: red">SR</div>
    </body>`);
    expect(normalizeAnimations($)).toBe(5);
    expect($("#el").attr("class")).toBe("elementor-element elementor-hidden-desktop");
    expect($("#aos").hasClass("aos-animate")).toBe(true);
    expect($("#sal").hasClass("sal-animate")).toBe(true);
    expect($("#wow").attr("style")).toBeUndefined();
    expect($("#sr").attr("style")).toBe("color: red;");
  });
});

// ─── fidelity#10: capas de vídeo ───────────────────────────────────────────────

describe("fidelity#10 — capas 'clique para carregar' ganham data-os-embed", () => {
  it("WP Rocket, lite-youtube e a capa do vídeo do Elementor", () => {
    const $ = load(`<body>
      <div id="rocket" class="rll-youtube-player" data-src="https://www.youtube.com/embed/M7lc1UVf-VE" data-id="M7lc1UVf-VE" data-query="feature=oembed">
        <div data-id="M7lc1UVf-VE" data-query="feature=oembed"><img src="https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg"><div class="play"></div></div>
      </div>
      <lite-youtube id="lite" videoid="dQw4w9WgXcQ" params="controls=0"></lite-youtube>
      <div class="elementor-widget-video" data-settings='{"youtube_url":"https:\\/\\/www.youtube.com\\/watch?v=aqz-KE-bpKQ","video_type":"youtube","show_image_overlay":"yes"}'>
        <div class="elementor-wrapper"><div class="elementor-video"></div>
          <div id="ov" class="elementor-custom-embed-image-overlay" style="background-image:url(capa.jpg)"><div class="elementor-custom-embed-play"></div></div>
        </div>
      </div>
      <div class="elementor-widget-video" data-settings='{"video_type":"hosted"}'>
        <div class="elementor-wrapper"><video class="elementor-video" src="v.mp4"></video>
          <div id="ov2" class="elementor-custom-embed-image-overlay"></div>
        </div>
      </div>
      <div id="ok" class="rll-youtube-player" data-id="M7lc1UVf-VE"><iframe src="https://www.youtube.com/embed/M7lc1UVf-VE"></iframe></div>
    </body>`);
    expect(markVideoFacades($)).toBe(4);
    expect($("#rocket").attr("data-os-embed")).toBe(
      "https://www.youtube.com/embed/M7lc1UVf-VE?autoplay=1&feature=oembed",
    );
    expect($("#lite").attr("data-os-embed")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&controls=0",
    );
    expect($("#ov").attr("data-os-embed")).toBe("https://www.youtube.com/embed/aqz-KE-bpKQ?autoplay=1");
    expect($("#ov").attr("data-os-embed-mode")).toBe("overlay");
    expect($("#ov").attr("data-os-embed-slot")).toBe(".elementor-video");
    expect($("#ov2").attr("data-os-embed")).toBe("reveal");
    expect($("#ok").attr("data-os-embed")).toBeUndefined();
  });
});

// ─── fidelity#9: FAQ feito à mão ───────────────────────────────────────────────

describe("fidelity#9 — FAQ/acordeão feito à mão vira data-os-toggle", () => {
  it("parseToggleActions entende classList, display, maxHeight e jQuery", () => {
    expect(parseToggleActions("this.classList.toggle('active')")).toEqual([{ what: "active", path: "self" }]);
    expect(parseToggleActions("this.parentElement.classList.toggle('open')")).toEqual([
      { what: "open", path: "parent" },
    ]);
    expect(
      parseToggleActions(
        'var p = this.nextElementSibling; if (p.style.display === "block") { p.style.display = "none"; } else { p.style.display = "block"; }',
      ),
    ).toEqual([{ what: "!display", path: "next" }]);
    expect(
      parseToggleActions(
        'var panel = this.nextElementSibling; if (panel.style.maxHeight) { panel.style.maxHeight = null; } else { panel.style.maxHeight = panel.scrollHeight + "px"; }',
      ),
    ).toEqual([{ what: "!maxheight", path: "next" }]);
    expect(parseToggleActions("document.getElementById('r1').classList.toggle('show')")).toEqual([
      { what: "show", path: "id:r1" },
    ]);
    expect(parseToggleActions("$(this).next('.resposta').slideToggle(200)")).toEqual([
      { what: "!display", path: "next" },
    ]);
    expect(parseToggleActions("$(this).closest('.faq').toggleClass('aberto')")).toEqual([
      { what: "aberto", path: "closest:.faq" },
    ]);
    expect(parseToggleActions("fbq('track', 'Lead')")).toEqual([]);
  });

  it("acordeão da W3Schools, forEach com querySelector, onclick com função e jQuery", () => {
    const $ = load(`<body>
      <button class="accordion">Pergunta 1</button><div class="panel">Resposta 1</div>
      <button class="accordion">Pergunta 2</button><div class="panel">Resposta 2</div>
      <div class="faq-item"><h3 class="faq-q">P</h3><p class="faq-a">R</p></div>
      <div class="q2" onclick="abrir(this)">Q</div><div class="a2" style="display:none">A</div>
      <h4 class="jq">J</h4><p>R</p>
      <script>
        var acc = document.getElementsByClassName("accordion");
        var i;
        for (i = 0; i < acc.length; i++) {
          acc[i].addEventListener("click", function() {
            this.classList.toggle("active");
            var panel = this.nextElementSibling;
            if (panel.style.display === "block") { panel.style.display = "none"; } else { panel.style.display = "block"; }
          });
        }
        document.querySelectorAll('.faq-item').forEach(item => {
          item.querySelector('.faq-q').addEventListener('click', () => { item.classList.toggle('active'); });
        });
        function abrir(el) { var r = el.nextElementSibling; r.style.display = r.style.display === 'none' ? 'block' : 'none'; }
        jQuery(".jq").click(function () { jQuery(this).next().slideToggle(); });
      </script>
    </body>`);
    expect(convertToggles($)).toBe(5);
    expect($(".accordion").first().attr("data-os-toggle")).toBe("active@self !display@next");
    expect($(".faq-q").attr("data-os-toggle")).toBe("active@closest:.faq-item");
    expect($(".q2").attr("data-os-toggle")).toBe("!display@next");
    expect($(".jq").attr("data-os-toggle")).toBe("!display@next");
  });
});

// ─── data#4 / ux#2 / ux#10: origens internas de importação ─────────────────────

describe("data#4/ux#2 — ZIP e HTML colado: nada de host interno nos links e no funil", () => {
  it("isSyntheticOrigin / syntheticSource / relativeToPage", () => {
    expect(isSyntheticOrigin(`${IMPORT_ORIGIN}/index.html`)).toBe(true);
    expect(isSyntheticOrigin(`${PASTE_ORIGIN}/index.html`)).toBe(true);
    expect(isSyntheticOrigin("https://oferta.com.br/")).toBe(false);
    expect(isSyntheticOrigin(null)).toBe(false);
    expect(syntheticSource(`${PASTE_ORIGIN}/index.html`)).toBe("HTML");
    expect(syntheticSource(`${IMPORT_ORIGIN}/a/index.html`)).toBe("ZIP");
    expect(syntheticSource("https://oferta.com.br/")).toBeNull();
    const at = (p: string) => new URL(p, IMPORT_ORIGIN);
    expect(relativeToPage(at("/sub/obrigado.html"), `${IMPORT_ORIGIN}/sub/index.html`)).toBe("obrigado.html");
    expect(relativeToPage(at("/c.html?x=1#y"), `${IMPORT_ORIGIN}/a/b.html`)).toBe("../c.html?x=1#y");
    expect(relativeToPage(at("/sub/x/y.png"), `${IMPORT_ORIGIN}/index.html`)).toBe("sub/x/y.png");
  });

  it("suggestFunnel não sugere páginas de uma importação", () => {
    const html = `<a href="upsell.html">Oferta especial</a><a href="obrigado.html">Obrigado</a>`;
    expect(suggestFunnel(load(html), `${IMPORT_ORIGIN}/index.html`, new Set())).toEqual([]);
    expect(suggestFunnel(load(html), `${PASTE_ORIGIN}/index.html`, new Set())).toEqual([]);
    // Página real continua com sugestões.
    expect(suggestFunnel(load(html), "https://oferta.com.br/index.html", new Set()).length).toBe(2);
  });

  it("com <base href>, links da importação ficam relativos à página (sem host interno)", () => {
    const $ = load(
      `<head><base href="sub/"></head><body><a id="a" href="obrigado.html">Obrigado</a><img src="x.png"></body>`,
    );
    rewriteHtmlRefs($, `${IMPORT_ORIGIN}/index.html`, () => null, { localOrigin: IMPORT_ORIGIN });
    expect($("#a").attr("href")).toBe("sub/obrigado.html");
    expect($("img").attr("src")).toBe("sub/x.png");
    expect($.html()).not.toContain("offerstudio");
  });
});
