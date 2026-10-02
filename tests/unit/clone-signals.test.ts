import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { parseVideoUrl, videoProviderLabel, youtubeIdFromUrl } from "@/detection/videos";
import { cleanUrl, suggestFunnel } from "@/worker/clone/funnel";
import { detectProtection, type ProtectionInput } from "@/worker/clone/protection";
import { detectVideos, evaluateNumber, extractDelay, parseDelaySeconds } from "@/worker/clone/vsl";

const PAGE = "https://www.oferta.com.br/vsl";
const ACC = "8f2e4c1a-1b2c-4d5e-9f00-123456789abc";
const VT_NEW = "66f1a2b3c4d5e6f708192a3b";
const VT_OLD = "64b7e3f1a2c3d4000a1b2c3d";
const PANDA_ID = "3f1c9f2e-7a4b-4c8d-9e0f-1a2b3c4d5e6f";

const load = (body: string) => cheerio.load(`<!doctype html><html><head></head><body>${body}</body></html>`);

// ─── Vídeos ──────────────────────────────────────────────────────────────────

describe("detectVideos — VTurb/ConverteAI", () => {
  it("embed novo: <vturb-smartplayer> + script v4/player.js vira um único vídeo", () => {
    const $ = load(`
      <vturb-smartplayer id="vid-${VT_NEW}" style="display: block; margin: 0 auto; width: 100%; max-width: 400px;"></vturb-smartplayer>
      <script type="text/javascript"> var s=document.createElement("script"); s.src="https://scripts.converteai.net/${ACC}/players/${VT_NEW}/v4/player.js", s.async=!0,document.head.appendChild(s); </script>`);
    const videos = detectVideos($, PAGE);
    expect(videos).toEqual([
      {
        provider: "VTURB",
        videoId: VT_NEW,
        src: `https://scripts.converteai.net/${ACC}/players/${VT_NEW}/v4/player.js`,
        thirdParty: true,
      },
    ]);
  });

  it("embed clássico: div#vid_<id> + miniatura + script player.js (miniatura não vira src)", () => {
    const $ = load(`
      <div id="vid_${VT_OLD}" style="position: relative; width: 100%; padding: 56.25% 0 0;">
        <img id="thumb_${VT_OLD}" src="https://images.converteai.net/${ACC}/players/${VT_OLD}/thumbnail.jpg" alt="thumbnail">
        <div id="backdrop_${VT_OLD}" style="position: absolute; top: 0; height: 100%; width: 100%;"></div>
      </div>
      <script type="text/javascript" id="scr_${VT_OLD}"> var s=document.createElement("script"); s.src="https://scripts.converteai.net/${ACC}/players/${VT_OLD}/player.js", s.async=!0,document.head.appendChild(s); </script>`);
    const videos = detectVideos($, PAGE);
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ provider: "VTURB", videoId: VT_OLD, thirdParty: true });
    expect(videos[0].src).toMatch(/player\.js$/);
  });

  it("script externo v4/embed.js (DOM renderizado) e SDK sem ID não duplicam", () => {
    const $ = cheerio.load(`<html><head>
      <script src="https://scripts.converteai.net/lib/js/smartplayer/v1/sdk.min.js"></script>
      <script src="https://scripts.converteai.net/${ACC}/players/${VT_NEW}/v4/embed.js" async></script>
      </head><body><p>Assista</p></body></html>`);
    const videos = detectVideos($, PAGE);
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ provider: "VTURB", videoId: VT_NEW });
  });

  it("iframe do ConverteAI", () => {
    const $ = load(
      `<iframe src="https://scripts.converteai.net/${ACC}/players/${VT_OLD}/embed.html" frameborder="0"></iframe>`,
    );
    expect(detectVideos($, PAGE)).toEqual([
      {
        provider: "VTURB",
        videoId: VT_OLD,
        src: `https://scripts.converteai.net/${ACC}/players/${VT_OLD}/embed.html`,
        thirdParty: true,
      },
    ]);
  });

  it("<video> dentro do player (blob:) pertence ao VTurb e não vira outro vídeo", () => {
    const $ = load(
      `<vturb-smartplayer id="vid-${VT_NEW}"><div class="smartplayer-wrapper"><video src="blob:https://www.oferta.com.br/1234" playsinline></video></div></vturb-smartplayer>`,
    );
    const videos = detectVideos($, PAGE);
    expect(videos.map((v) => v.provider)).toEqual(["VTURB"]);
  });
});

describe("detectVideos — Panda Video", () => {
  it("iframe player-vz-*.tv.pandavideo.com.br/embed/?v=<id>", () => {
    const $ = load(`
      <div style="position:relative;padding-top:56.25%;"><iframe id="panda-${PANDA_ID}" src="https://player-vz-7b6cf9e4-8bf.tv.pandavideo.com.br/embed/?v=${PANDA_ID}" style="border:none;position:absolute;top:0;left:0;" allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture" allowfullscreen=true width="100%" height="100%" fetchpriority="high"></iframe></div>
      <script src="https://player.pandavideo.com.br/api.v2.js" async></script>`);
    const videos = detectVideos($, PAGE);
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ provider: "PANDA", videoId: PANDA_ID, thirdParty: true });
  });

  it("só o script da API (sem iframe) ainda indica Panda", () => {
    const $ = load(`<script src="https://player.pandavideo.com.br/api.v2.js"></script>`);
    expect(detectVideos($, PAGE)).toEqual([
      { provider: "PANDA", src: "https://player.pandavideo.com.br/api.v2.js", thirdParty: true },
    ]);
  });

  it("playlist .m3u8 da CDN do Panda num script vira Panda com ID (não HLS genérico)", () => {
    const $ = load(
      `<script>window.cfg = { hls: "https://b-vz-7b6cf9e4-8bf.tv.pandavideo.com.br/${PANDA_ID}/playlist.m3u8" };</script>`,
    );
    const videos = detectVideos($, PAGE);
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ provider: "PANDA", videoId: PANDA_ID });
  });
});

describe("detectVideos — YouTube e Vimeo", () => {
  it("iframe youtube.com/embed", () => {
    const $ = load(
      `<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ?si=Ab12&amp;controls=0" title="YouTube video player" frameborder="0" allowfullscreen></iframe>`,
    );
    expect(detectVideos($, PAGE)).toEqual([
      {
        provider: "YOUTUBE",
        videoId: "dQw4w9WgXcQ",
        src: "https://www.youtube.com/embed/dQw4w9WgXcQ?si=Ab12&controls=0",
        thirdParty: true,
      },
    ]);
  });

  it("youtube-nocookie e protocolo relativo", () => {
    const $ = load(`<iframe src="//www.youtube-nocookie.com/embed/aBcDeFgHiJk?rel=0"></iframe>`);
    expect(detectVideos($, PAGE)[0]).toMatchObject({ provider: "YOUTUBE", videoId: "aBcDeFgHiJk" });
  });

  it("<lite-youtube videoid>", () => {
    const $ = load(`<lite-youtube videoid="dQw4w9WgXcQ" playlabel="Assistir"></lite-youtube>`);
    expect(detectVideos($, PAGE)).toEqual([
      {
        provider: "YOUTUBE",
        videoId: "dQw4w9WgXcQ",
        src: "https://www.youtube.com/embed/dQw4w9WgXcQ",
        thirdParty: true,
      },
    ]);
  });

  it("iframe com lazy-load (data-lazy-src) e widget de vídeo do Elementor", () => {
    const $ = load(`
      <iframe src="about:blank" data-lazy-src="https://www.youtube.com/embed/abcdefghijk"></iframe>
      <div class="elementor-element elementor-widget elementor-widget-video" data-settings="{&quot;youtube_url&quot;:&quot;https:\\/\\/www.youtube.com\\/watch?v=zyxwvutsrqp&quot;,&quot;video_type&quot;:&quot;youtube&quot;}" data-widget_type="video.default"></div>`);
    expect(detectVideos($, PAGE).map((v) => v.videoId)).toEqual(["abcdefghijk", "zyxwvutsrqp"]);
  });

  it("iframe player.vimeo.com/video/<id>", () => {
    const $ = load(
      `<div style="padding:56.25% 0 0 0;position:relative;"><iframe src="https://player.vimeo.com/video/76979871?h=8272103f6e&amp;badge=0" frameborder="0" allow="autoplay; fullscreen"></iframe></div><script src="https://player.vimeo.com/api/player.js"></script>`,
    );
    const videos = detectVideos($, PAGE);
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ provider: "VIMEO", videoId: "76979871", thirdParty: true });
  });
});

describe("detectVideos — vídeo próprio, HLS e outros players", () => {
  it("<video> com mp4/webm é NATIVE, não é de terceiros e a URL fica absoluta", () => {
    const $ = load(
      `<video controls poster="capa.jpg"><source src="/videos/vsl.mp4" type="video/mp4"><source src="/videos/vsl.webm" type="video/webm"></video>`,
    );
    expect(detectVideos($, PAGE)).toEqual([
      { provider: "NATIVE", src: "https://www.oferta.com.br/videos/vsl.mp4", thirdParty: false },
    ]);
  });

  it("<video> num bloco com id parecido (vid-depoimentos) não é confundido com o VTurb", () => {
    const $ = load(`<div id="vid-depoimentos"><video src="/depoimento.webm" controls></video></div>`);
    expect(detectVideos($, PAGE)).toEqual([
      { provider: "NATIVE", src: "https://www.oferta.com.br/depoimento.webm", thirdParty: false },
    ]);
  });

  it("<video src> já reescrito para /os-assets/ fica como está", () => {
    const $ = load(`<video src="/os-assets/${"a".repeat(64)}.mp4" autoplay muted loop></video>`);
    expect(detectVideos($, PAGE)[0]).toEqual({
      provider: "NATIVE",
      src: `/os-assets/${"a".repeat(64)}.mp4`,
      thirdParty: false,
    });
  });

  it("<source> .m3u8 é HLS (terceiros)", () => {
    const $ = load(
      `<video id="vsl" controls><source src="https://cdn.streaming.com/hls/master.m3u8" type="application/x-mpegURL"></video>`,
    );
    expect(detectVideos($, PAGE)).toEqual([
      { provider: "HLS", src: "https://cdn.streaming.com/hls/master.m3u8", thirdParty: true },
    ]);
  });

  it("hls.js num script inline também é HLS", () => {
    const $ = load(
      `<video id="v"></video><script>var hls = new Hls(); hls.loadSource('https://stream.exemplo.com/vsl/index.m3u8'); hls.attachMedia(document.getElementById('v'));</script>`,
    );
    const videos = detectVideos($, PAGE);
    expect(videos).toEqual([{ provider: "HLS", src: "https://stream.exemplo.com/vsl/index.m3u8", thirdParty: true }]);
  });

  it("Wistia (div wistia_async_ + scripts) vira OTHER com ID e rótulo Wistia", () => {
    const $ = load(`
      <script src="https://fast.wistia.com/embed/medias/abc123xyz9.jsonp" async></script>
      <script src="https://fast.wistia.com/assets/external/E-v1.js" async></script>
      <div class="wistia_responsive_padding"><div class="wistia_embed wistia_async_abc123xyz9 videoFoam=true">&nbsp;</div></div>`);
    const videos = detectVideos($, PAGE);
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ provider: "OTHER", videoId: "abc123xyz9", thirdParty: true });
    expect(videoProviderLabel(videos[0])).toBe("Wistia");
  });

  it("Vidalytics (div + loader inline) vira OTHER com ID", () => {
    const $ = load(`
      <div id="vidalytics_embed_Xyz123AbC" style="width: 100%;position:relative;padding-top: 56.25%;"></div>
      <script type="text/javascript">
      (function (v, i, d, a, l, y, t, c, s) { y='_'+d.toLowerCase();c=d+'L'; })(window, document, 'Vidalytics', 'vidalytics_embed_Xyz123AbC', 'https://quick.vidalytics.com/embeds/AbCdEf12/Xyz123AbC/');
      </script>`);
    const videos = detectVideos($, PAGE);
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ provider: "OTHER", videoId: "Xyz123AbC", thirdParty: true });
    expect(videoProviderLabel(videos[0])).toBe("Vidalytics");
  });

  it("mantém a ordem da página e ignora iframes que não são vídeo", () => {
    const $ = load(`
      <iframe src="https://www.google.com/maps/embed?pb=123"></iframe>
      <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
      <video src="depoimento.mp4" controls></video>`);
    expect(detectVideos($, PAGE).map((v) => v.provider)).toEqual(["YOUTUBE", "NATIVE"]);
  });

  it("página sem vídeo devolve lista vazia", () => {
    const $ = load(`<h1>Oferta</h1><img src="capa.jpg"><a href="https://youtube.com/@canal">Canal</a>`);
    expect(detectVideos($, PAGE)).toEqual([]);
  });
});

describe("detection/videos", () => {
  it("parseVideoUrl reconhece host e ID", () => {
    expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({
      provider: "YOUTUBE",
      videoId: "dQw4w9WgXcQ",
    });
    expect(youtubeIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toBe("dQw4w9WgXcQ");
    expect(parseVideoUrl("https://vimeo.com/76979871")).toMatchObject({ provider: "VIMEO", videoId: "76979871" });
    expect(
      parseVideoUrl("https://iframe.mediadelivery.net/embed/12345/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0"),
    ).toMatchObject({ provider: "OTHER", label: "Bunny Stream", videoId: "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0" });
    expect(parseVideoUrl("https://www.oferta.com.br/video.mp4")).toBeNull();
  });

  it("videoProviderLabel em português", () => {
    expect(videoProviderLabel({ provider: "NATIVE" })).toBe("Vídeo próprio (arquivo)");
    expect(videoProviderLabel({ provider: "OTHER" })).toBe("Outro player");
    expect(videoProviderLabel({ provider: "PANDA" })).toBe("Panda Video");
  });
});

// ─── Atraso da VSL ───────────────────────────────────────────────────────────

describe("extractDelay", () => {
  it("VTurb novo: player:ready + displayHiddenElements(delaySeconds, ['.esconder'])", () => {
    const $ = load(`
      <vturb-smartplayer id="vid-${VT_NEW}"></vturb-smartplayer>
      <div class="esconder"><a href="https://pay.hotmart.com/X123?checkoutMode=10" class="btn">QUERO AGORA</a></div>
      <style>.esconder { display: none }</style>
      <script type="text/javascript">
        var delaySeconds = 10;
        var player = document.querySelector("vturb-smartplayer");
        player.addEventListener("player:ready", function() {
          player.displayHiddenElements(delaySeconds, [".esconder"], { persist: true });
        });
      </script>`);
    const delay = extractDelay($);
    expect(delay).toMatchObject({ seconds: 10, elements: 1, scriptsRemoved: 1 });
    expect($(".esconder").attr("data-os-delay")).toBe("10");
    expect($("script").length).toBe(0);
    expect(delay?.removedScripts[0]).toContain("displayHiddenElements");
    expect($("vturb-smartplayer").attr("data-os-delay")).toBeUndefined();
  });

  it("VTurb clássico com número literal em smartplayer.instances[0].displayHiddenElements(332, …)", () => {
    const $ = load(`
      <div id="vid_${VT_OLD}"></div>
      <div class="esconder"><img src="preco.png"></div>
      <div class="esconder"><a href="https://pay.kiwify.com.br/abc">Comprar</a></div>
      <script>
        var tries = 0;
        var i = setInterval(function () {
          if (typeof smartplayer === 'undefined' || !smartplayer.instances.length) return;
          clearInterval(i);
          smartplayer.instances[0].displayHiddenElements(332, ['.esconder'], { persist: true });
        }, 1000);
      </script>`);
    const delay = extractDelay($);
    expect(delay).toMatchObject({ seconds: 332, elements: 2, scriptsRemoved: 1 });
    expect($("[data-os-delay='332']").length).toBe(2);
  });

  it('script clássico "var SECONDS_TO_DISPLAY = 332" (com setTimeout de 700 ms e 1000 ms)', () => {
    const $ = load(`
      <div class="esconder" style="display:none"><a href="https://pay.hotmart.com/Y999" class="botao">SIM, EU QUERO</a></div>
      <script type="text/javascript">
        var SECONDS_TO_DISPLAY = 332;
        var CLASS_TO_DISPLAY = ".esconder";
        var attempts = 0;
        var elsDisplayed = false;
        var alreadyDisplayedKey = \`alreadyElsDisplayed\${SECONDS_TO_DISPLAY}\`;
        var alreadyElsDisplayed = localStorage.getItem(alreadyDisplayedKey);
        var showHiddenElements = function () {
          elsDisplayed = true;
          document.querySelectorAll(CLASS_TO_DISPLAY).forEach((e) => e.style.display = "block");
          localStorage.setItem(alreadyDisplayedKey, true);
        }
        var startWatchVideoProgress = function () {
          if (typeof smartplayer === 'undefined' || !(smartplayer.instances && smartplayer.instances.length)) {
            if (attempts >= 10) return;
            attempts += 1;
            return setTimeout(function () { startWatchVideoProgress() }, 1000);
          }
          smartplayer.instances[0].on('timeupdate', () => {
            if (elsDisplayed || smartplayer.instances[0].smartAutoPlay) return;
            if (smartplayer.instances[0].video.currentTime < SECONDS_TO_DISPLAY) return;
            showHiddenElements();
          })
        }
        if (alreadyElsDisplayed === 'true') { setTimeout(function () { showHiddenElements(); }, 100); } else { startWatchVideoProgress() }
      </script>`);
    const delay = extractDelay($);
    expect(delay).toMatchObject({ seconds: 332, elements: 1, scriptsRemoved: 1 });
    expect($(".esconder").attr("data-os-delay")).toBe("332");
  });

  it("Panda: mensagem panda_timeupdate com currentTime >= 120", () => {
    const $ = load(`
      <iframe src="https://player-vz-7b6cf9e4-8bf.tv.pandavideo.com.br/embed/?v=${PANDA_ID}"></iframe>
      <div class="hidden-cta" style="display:none"><a href="https://pay.kiwify.com.br/abc">Comprar agora</a></div>
      <script>
        window.addEventListener('message', function (e) {
          if (e.data.message === 'panda_timeupdate' && e.data.currentTime >= 120) {
            document.querySelectorAll('.hidden-cta').forEach(function (el) { el.style.display = 'block'; });
          }
        });
      </script>`);
    const delay = extractDelay($);
    expect(delay).toMatchObject({ seconds: 120, elements: 1, scriptsRemoved: 1 });
    expect($(".hidden-cta").attr("data-os-delay")).toBe("120");
    expect($("iframe").length).toBe(1);
  });

  it("setTimeout simples de 30000 ms mostrando .hide", () => {
    const $ = load(`
      <div class="hide"><a href="/checkout">Garantir minha vaga</a></div>
      <script>setTimeout(function(){ document.querySelectorAll('.hide').forEach(e => e.style.display = 'block') }, 30000);</script>`);
    const delay = extractDelay($);
    expect(delay).toMatchObject({ seconds: 30, elements: 1, scriptsRemoved: 1 });
    expect($(".hide").attr("data-os-delay")).toBe("30");
  });

  it("setTimeout com N * 1000 e seletor por ID", () => {
    const $ = load(`
      <section id="oferta" style="display:none"><a href="https://pay.hotmart.com/Z1">Comprar</a></section>
      <script>setTimeout(function () { $("#oferta").fadeIn(); }, 45 * 1000);</script>`);
    const delay = extractDelay($);
    expect(delay).toMatchObject({ seconds: 45, elements: 1 });
    expect($("#oferta").attr("data-os-delay")).toBe("45");
  });

  it("script de atraso sem segundos legíveis (Panda loadButtonInTime) marca com 0", () => {
    const $ = load(`
      <div class="esconder"><a href="https://pay.hotmart.com/X1">Quero</a></div>
      <script>
        window.pandascripttag = window.pandascripttag || [];
        window.pandascripttag.push(function () {
          const p = new PandaPlayer('panda-${PANDA_ID}', { onReady() { p.loadButtonInTime({ fetchApi: true }); } });
        });
      </script>`);
    const delay = extractDelay($);
    expect(delay).toMatchObject({ seconds: 0, elements: 1, scriptsRemoved: 1 });
    expect($(".esconder").attr("data-os-delay")).toBe("0");
  });

  it("só a classe .esconder com link de checkout (script externo) marca com 0 e não remove nada", () => {
    const $ = load(`
      <div class="esconder"><a href="https://pay.hotmart.com/X1">Comprar</a></div>
      <script src="js/delay.js"></script>`);
    const delay = extractDelay($);
    expect(delay).toMatchObject({ seconds: 0, elements: 1, scriptsRemoved: 0 });
    expect($("script").length).toBe(1);
  });

  it("marca só o elemento mais externo quando há .esconder aninhado", () => {
    const $ = load(`
      <div class="esconder" id="fora"><div class="esconder" id="dentro"><a href="https://pay.hotmart.com/X1">Comprar</a></div></div>
      <script>var delaySeconds = 5; player.displayHiddenElements(delaySeconds, ['.esconder'], { persist: true });</script>`);
    const delay = extractDelay($);
    expect(delay?.elements).toBe(1);
    expect($("#fora").attr("data-os-delay")).toBe("5");
    expect($("#dentro").attr("data-os-delay")).toBeUndefined();
  });

  it("script que aponta para .esconder não marca um .hide qualquer (menu, modal)", () => {
    const $ = load(`
      <div class="esconder"><a href="https://pay.hotmart.com/X1">Comprar</a></div>
      <nav class="hide"><a href="https://pay.hotmart.com/X1">Comprar</a></nav>
      <script>var delaySeconds = 20; player.displayHiddenElements(delaySeconds, ['.esconder'], { persist: true });</script>`);
    expect(extractDelay($)).toMatchObject({ seconds: 20, elements: 1 });
    expect($("nav").attr("data-os-delay")).toBeUndefined();
  });

  it("script sem seletor legível: marca blocos display:none com CTA", () => {
    const $ = load(`
      <div id="bloco" style="display: none"><a href="https://pay.kiwify.com.br/abc">Garantir agora</a></div>
      <div style="display:none"><p>Sem botão</p></div>
      <script>var SECONDS_TO_DISPLAY = 95; var els = document.querySelectorAll(window.CLS); </script>`);
    expect(extractDelay($)).toMatchObject({ seconds: 95, elements: 1 });
    expect($("#bloco").attr("data-os-delay")).toBe("95");
  });

  it("não remove script que também carrega o player", () => {
    const $ = load(`
      <div id="vid_${VT_OLD}"></div><div class="esconder"><a href="https://pay.hotmart.com/X">Comprar</a></div>
      <script>
        var s=document.createElement("script"); s.src="https://scripts.converteai.net/${ACC}/players/${VT_OLD}/player.js"; document.head.appendChild(s);
        var SECONDS_TO_DISPLAY = 60;
      </script>`);
    const delay = extractDelay($);
    expect(delay).toMatchObject({ seconds: 60, elements: 1, scriptsRemoved: 0 });
    expect($("script").length).toBe(1);
  });

  it("sem padrão de atraso devolve null (preloader de 500 ms, .hide sem script, popup comum)", () => {
    const $ = load(`
      <div id="preloader"></div>
      <div class="hide"><a href="https://pay.hotmart.com/X1">Comprar</a></div>
      <div class="modal" style="display:none"><p>Newsletter</p></div>
      <script>setTimeout(function(){ document.getElementById('preloader').style.display = 'none' }, 500);</script>
      <script>console.log("ok")</script>`);
    expect(extractDelay($)).toBeNull();
    expect($("script").length).toBe(2);
    expect($("[data-os-delay]").length).toBe(0);
  });
});

describe("parseDelaySeconds / evaluateNumber", () => {
  it("avalia expressões simples", () => {
    expect(evaluateNumber("332")).toBe(332);
    expect(evaluateNumber("5 * 60 + 32")).toBe(332);
    expect(evaluateNumber("(2*60)")).toBe(120);
    expect(evaluateNumber("alert(1)")).toBeNull();
  });

  it("resolve variáveis, milissegundos e comparações invertidas", () => {
    expect(parseDelaySeconds("var tempo = 5 * 60; if (video.currentTime > tempo) show();")).toBe(300);
    expect(parseDelaySeconds("const delayMs = 45000; setTimeout(show, delayMs);")).toBe(45);
    expect(parseDelaySeconds("if (90 <= player.currentTime) mostrar();")).toBe(90);
    expect(parseDelaySeconds("var x = 1; setTimeout(function(){ a(1, 2) }, 15000)")).toBe(15);
    expect(parseDelaySeconds("mostrar();")).toBeNull();
  });
});

// ─── Funil ───────────────────────────────────────────────────────────────────

describe("suggestFunnel", () => {
  const funnelPage = `
    <a href="https://pay.hotmart.com/X123?checkoutMode=10">Comprar agora</a>
    <a href="https://www.oferta.com.br/checkout?p=1">Finalizar compra</a>
    <a href="/pagamento-seguro">Comprar com desconto</a>
    <a href="/upsell-1?utm_source=fb&utm_campaign=x#topo">Sim, quero o upgrade!</a>
    <a href="https://www.oferta.com.br/upsell-1">Adicionar ao pedido</a>
    <a href="/ds1">Ver outra opção</a>
    <a href="https://oferta.com.br/oferta-especial">Não, obrigado</a>
    <a href="/obrigado">Acessar minha compra</a>
    <a href="/politica-de-privacidade">Política de Privacidade</a>
    <a href="/termos-de-uso">Termos de uso</a>
    <a href="/contato">Contato</a>
    <a href="/blog/5-bonus">Blog</a>
    <a href="/login">Área do aluno</a>
    <a href="#oferta">Ver oferta</a>
    <a href="mailto:suporte@oferta.com.br">E-mail</a>
    <a href="tel:+5511999999999">Telefone</a>
    <a href="/ebook-bonus.pdf">Baixar bônus</a>
    <a href="https://outrodominio.com/upsell">Upsell de outro site</a>
    <a href="/vsl#comprar">Comprar</a>
    <a href="/foto-produto">Ver foto</a>
    <a href="https://membros.oferta.com.br/grupo-vip">Entrar no grupo</a>
  `;

  it("sugere upsell, downsell e obrigado; dedupe por URL sem utm/hash", () => {
    const $ = load(funnelPage);
    const checkouts = new Set([
      "https://pay.hotmart.com/X123?checkoutMode=10",
      "https://www.oferta.com.br/pagamento-seguro",
    ]);
    const result = suggestFunnel($, PAGE, checkouts);
    expect(result.map((s) => [s.url, s.kind])).toEqual([
      ["https://www.oferta.com.br/upsell-1", "UPSELL"],
      ["https://www.oferta.com.br/ds1", "DOWNSELL"],
      ["https://oferta.com.br/oferta-especial", "DOWNSELL"],
      ["https://www.oferta.com.br/obrigado", "THANK_YOU"],
      ["https://membros.oferta.com.br/grupo-vip", "OTHER"],
    ]);
  });

  it("explica o motivo em português", () => {
    const $ = load(funnelPage);
    const result = suggestFunnel($, PAGE, new Set());
    const decline = result.find((s) => s.url === "https://oferta.com.br/oferta-especial");
    expect(decline).toMatchObject({ label: "Não, obrigado", reason: 'Link "Não, obrigado" costuma levar ao downsell' });
    expect(result.find((s) => s.kind === "UPSELL")?.reason).toBe('Endereço com "upsell" costuma ser um upsell');
    expect(result.find((s) => s.kind === "THANK_YOU")?.reason).toContain("página de obrigado");
  });

  it("exclui checkouts, outros domínios, páginas legais, âncoras e arquivos", () => {
    const $ = load(funnelPage);
    const urls = suggestFunnel($, PAGE, new Set(["https://www.oferta.com.br/pagamento-seguro"])).map((s) => s.url);
    for (const bad of [
      "hotmart",
      "checkout",
      "pagamento-seguro",
      "privacidade",
      "termos",
      "contato",
      "blog",
      "login",
    ]) {
      expect(urls.some((u) => u.includes(bad))).toBe(false);
    }
    expect(urls.some((u) => u.includes("outrodominio") || u.endsWith(".pdf") || u.includes("foto"))).toBe(false);
    expect(urls).not.toContain("https://www.oferta.com.br/vsl");
  });

  it("classifica pelo caminho (oto, down-2, upgrade, thank-you, parabens) e por onclick", () => {
    const $ = load(`
      <a href="/oto2">Continuar</a>
      <a href="/down-2">Continuar</a>
      <a href="/upgrade">Continuar</a>
      <a href="/thank-you">Continuar</a>
      <a href="/parabens">Continuar</a>
      <button onclick="window.location.href='/up2'">SIM, QUERO</button>
      <a href="/recusar">Não quero essa oferta</a>`);
    const kinds = Object.fromEntries(suggestFunnel($, PAGE, new Set()).map((s) => [new URL(s.url).pathname, s.kind]));
    expect(kinds).toEqual({
      "/oto2": "UPSELL",
      "/down-2": "DOWNSELL",
      "/upgrade": "UPSELL",
      "/thank-you": "THANK_YOU",
      "/parabens": "THANK_YOU",
      "/up2": "UPSELL",
      "/recusar": "DOWNSELL",
    });
  });

  it("o caminho de obrigado vence o texto de recusa; texto de upsell sem caminho também conta", () => {
    const $ = load(`
      <a href="/obrigado-compra">Não, obrigado</a>
      <a href="/pagina-2">Sim! Quero a oferta especial</a>`);
    const result = suggestFunnel($, PAGE, new Set());
    expect(result.map((s) => s.kind)).toEqual(["THANK_YOU", "UPSELL"]);
  });

  it("limita a 15 sugestões", () => {
    const links = Array.from({ length: 20 }, (_, i) => `<a href="/upsell-${i + 1}">Upsell ${i + 1}</a>`).join("");
    expect(suggestFunnel(load(links), PAGE, new Set())).toHaveLength(15);
  });

  it("cleanUrl remove hash e utm_* mas mantém outros parâmetros", () => {
    expect(cleanUrl("https://a.com/up?utm_source=x&id=2&fbclid=9#top")).toBe("https://a.com/up?id=2");
    expect(cleanUrl("nada", undefined)).toBeNull();
  });

  it("URL da página inválida devolve lista vazia", () => {
    expect(suggestFunnel(load(`<a href="/upsell">x</a>`), "não é url", new Set())).toEqual([]);
  });
});

// ─── Proteção ────────────────────────────────────────────────────────────────

const LONG_TEXT = "Texto de venda. ".repeat(200);
const normalPage = (extra = "") =>
  `<html><head><title>Método X</title></head><body><h1>Método X</h1><p>${LONG_TEXT}</p><img src="a.jpg"><img src="b.jpg">${extra}</body></html>`;

function input(partial: Partial<ProtectionInput>): ProtectionInput {
  return { status: 200, headers: {}, html: normalPage(), title: "Método X", bodyTextLength: 3200, ...partial };
}

describe("detectProtection", () => {
  it("página normal devolve null", () => {
    expect(detectProtection(input({}))).toBeNull();
  });

  it("Cloudflare pelo cabeçalho cf-mitigated: challenge", () => {
    const report = detectProtection(
      input({ status: 403, headers: { "CF-Mitigated": "challenge", Server: "cloudflare" }, bodyTextLength: 80 }),
    );
    expect(report).toMatchObject({ kind: "BOT_CHALLENGE", detail: "cf-mitigated: challenge" });
    expect(report?.message).toBe(
      "Esta página tem proteção contra robôs (Cloudflare). Não é possível clonar automaticamente. Abra a página no seu navegador e salve com Arquivo → Salvar como (página completa); compacte o arquivo .html junto com a pasta “_files” num ZIP, ou copie o HTML, e importe aqui.",
    );
  });

  it('Cloudflare pela página "Just a moment..." (challenge-platform)', () => {
    const html = `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title></head><body><div class="main-wrapper" role="main"><div class="main-content"><noscript><div class="h2"><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></div></noscript></div></div><script>(function(){window._cf_chl_opt={cvId: '3',cZone: "www.oferta.com.br",cType: 'managed'};var cpo = document.createElement('script');cpo.src = '/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=8c1';document.getElementsByTagName('head')[0].appendChild(cpo);}());</script></body></html>`;
    const report = detectProtection(
      input({ status: 403, headers: { server: "cloudflare" }, html, title: "Just a moment...", bodyTextLength: 60 }),
    );
    expect(report?.kind).toBe("BOT_CHALLENGE");
    expect(report?.message).toContain("Cloudflare");
  });

  it('Cloudflare "Attention Required! | Cloudflare" (bloqueio)', () => {
    const html = `<html><head><title>Attention Required! | Cloudflare</title></head><body><div id="cf-wrapper"><h1 data-translate="block_headline">Sorry, you have been blocked</h1></div></body></html>`;
    const report = detectProtection(
      input({ status: 403, html, title: "Attention Required! | Cloudflare", bodyTextLength: 300 }),
    );
    expect(report?.kind).toBe("BOT_CHALLENGE");
  });

  it('Cloudflare Turnstile em página "Um momento…" em português', () => {
    const html = `<html><head><title>Um momento…</title></head><body><div class="cf-turnstile" data-sitekey="0x4AAA"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>`;
    const report = detectProtection(input({ status: 200, html, title: "Um momento…", bodyTextLength: 40 }));
    expect(report?.kind).toBe("BOT_CHALLENGE");
  });

  it("página normal atrás da Cloudflare (script jsd e Turnstile num formulário) não é bloqueio", () => {
    const html = normalPage(
      `<form><div class="cf-turnstile" data-sitekey="0x4AAA"></div></form><script>(function(){var a=document.createElement('iframe');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';})();</script>`,
    );
    expect(detectProtection(input({ html, headers: { server: "cloudflare", "cf-ray": "8c1-GRU" } }))).toBeNull();
  });

  it("DataDome: captcha-delivery.com", () => {
    const html = `<html><head><title>oferta.com.br</title></head><body><script>var dd={'rt':'c','cid':'AHrlqAAA','hsh':'ABC','t':'fe','s':1,'host':'geo.captcha-delivery.com'}</script><script src="https://ct.captcha-delivery.com/c.js"></script></body></html>`;
    const report = detectProtection(
      input({ status: 403, headers: { "set-cookie": "datadome=abc; Path=/" }, html, bodyTextLength: 0 }),
    );
    expect(report?.kind).toBe("BOT_CHALLENGE");
    expect(report?.message).toContain("DataDome");
  });

  it("DataDome: 403 + cookie datadome; mas 200 com conteúdo e x-datadome: protected é normal", () => {
    const blocked = detectProtection(
      input({
        status: 403,
        headers: { "set-cookie": "datadome=xyz; Max-Age=31536000" },
        html: "<html></html>",
        bodyTextLength: 0,
      }),
    );
    expect(blocked?.message).toContain("DataDome");
    expect(detectProtection(input({ headers: { "x-datadome": "protected", "set-cookie": "datadome=1" } }))).toBeNull();
  });

  it("PerimeterX/HUMAN: #px-captcha (Press & Hold)", () => {
    const html = `<html><head><title>Access to this page has been denied</title></head><body><div id="px-captcha"></div><p>Press &amp; Hold to confirm you are a human (and not a bot).</p><script>window._pxAppId = 'PXabc123';</script></body></html>`;
    const report = detectProtection(
      input({ status: 403, headers: { "set-cookie": "_pxhd=abc" }, html, bodyTextLength: 90 }),
    );
    expect(report?.kind).toBe("BOT_CHALLENGE");
    expect(report?.message).toContain("PerimeterX");
  });

  it("Akamai: Access Denied com _abck", () => {
    const html = `<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY><H1>Access Denied</H1>You don't have permission to access this server.<P>Reference&#32;&#35;18&#46;4a2c1402&#46;1700000000&#46;1a2b3c4d<P>https&#58;&#47;&#47;errors&#46;edgesuite&#46;net</BODY></HTML>`;
    const report = detectProtection(
      input({
        status: 403,
        headers: { server: "AkamaiGHost", "set-cookie": "_abck=ABC~-1~; Path=/\nbm_sz=XYZ" },
        html,
        title: "Access Denied",
        bodyTextLength: 150,
      }),
    );
    expect(report?.kind).toBe("BOT_CHALLENGE");
    expect(report?.message).toContain("Akamai");
  });

  it("reCAPTCHA em página de desafio vira CAPTCHA", () => {
    const html = `<html><head><title>Verificação de segurança</title><script src="https://www.google.com/recaptcha/api.js" async defer></script></head><body><form method="post"><p>Confirme que você é humano</p><div class="g-recaptcha" data-sitekey="6Lc_aX0UAAAA"></div><button>Continuar</button></form></body></html>`;
    const report = detectProtection(input({ html, title: "Verificação de segurança", bodyTextLength: 40 }));
    expect(report?.kind).toBe("CAPTCHA");
    expect(report?.message).toContain("reCAPTCHA");
  });

  it("hCaptcha com pouco conteúdo vira CAPTCHA", () => {
    const html = `<html><head><title>oferta.com.br</title></head><body><div class="h-captcha" data-sitekey="10000000-ffff"></div><script src="https://js.hcaptcha.com/1/api.js" async defer></script></body></html>`;
    expect(detectProtection(input({ html, title: "oferta.com.br", bodyTextLength: 10 }))?.kind).toBe("CAPTCHA");
  });

  it("página de captura curta com reCAPTCHA v3 no formulário NÃO é desafio", () => {
    const html = `<html><head><title>Ebook grátis</title><script src="https://www.google.com/recaptcha/api.js?render=6Lc"></script></head><body><h1>Baixe o ebook grátis</h1><img src="capa.png"><form><input type="email" name="email"><button>Quero o ebook</button></form></body></html>`;
    expect(detectProtection(input({ html, title: "Ebook grátis", bodyTextLength: 120 }))).toBeNull();
  });

  it("login: campo de senha e quase nenhum conteúdo", () => {
    const html = `<html><head><title>Entrar</title></head><body><form><input type="email" name="email"><input type="password" name="senha"><button>Entrar</button></form><a href="/recuperar">Esqueci minha senha</a></body></html>`;
    const report = detectProtection(input({ html, title: "Entrar", bodyTextLength: 40 }));
    expect(report?.kind).toBe("LOGIN_WALL");
    expect(report?.message).toContain("login");
  });

  it("página protegida por senha do WordPress", () => {
    const html = normalPage(
      `<form action="https://www.oferta.com.br/wp-login.php?action=postpass" class="post-password-form" method="post"><input name="post_password" type="password"></form>`,
    );
    expect(detectProtection(input({ html }))?.kind).toBe("LOGIN_WALL");
  });

  it("página de vendas com modal de login escondido não é login", () => {
    const html = normalPage(`<div class="modal" style="display:none"><input type="password"></div>`);
    expect(detectProtection(input({ html }))).toBeNull();
  });

  it('SPA vazia: <div id="root"></div> + bundles', () => {
    const html = `<!doctype html><html><head><title>App</title><script type="module" crossorigin src="/assets/index-Bx12aZ.js"></script></head><body><div id="root"></div></body></html>`;
    const report = detectProtection(input({ html, title: "App", bodyTextLength: 0 }));
    expect(report).toMatchObject({ kind: "EMPTY_SHELL", detail: "#root vazio (página montada por JavaScript)" });
  });

  it("Next.js sem conteúdo (__next vazio) e página em branco com muitos scripts", () => {
    const next = `<html><body><div id="__next"></div><script src="/_next/static/chunks/main-abc.js"></script></body></html>`;
    expect(detectProtection(input({ html: next, bodyTextLength: 12 }))?.kind).toBe("EMPTY_SHELL");
    const blank = `<html><body><script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script></body></html>`;
    expect(detectProtection(input({ html: blank, bodyTextLength: 150 }))?.kind).toBe("EMPTY_SHELL");
  });

  it("página só de imagens (pouco texto) não é página vazia", () => {
    const html = `<html><body>${'<img src="secao.webp">'.repeat(8)}<a href="https://pay.hotmart.com/X">Comprar</a></body></html>`;
    expect(detectProtection(input({ html, bodyTextLength: 7 }))).toBeNull();
  });

  it("erro HTTP 404 e 500 viram HTTP_ERROR com o status no detalhe", () => {
    const notFound = detectProtection(input({ status: 404, html: "<h1>Not Found</h1>", bodyTextLength: 9 }));
    expect(notFound).toMatchObject({ kind: "HTTP_ERROR", detail: "HTTP 404" });
    expect(notFound?.message).toContain("não foi encontrada");
    const server = detectProtection(input({ status: 502, bodyTextLength: 3200 }));
    expect(server).toMatchObject({ kind: "HTTP_ERROR", detail: "HTTP 502" });
  });

  it("403 sem fornecedor conhecido é HTTP_ERROR com a alternativa de importar", () => {
    const report = detectProtection(input({ status: 403, html: "<h1>Forbidden</h1>", bodyTextLength: 9 }));
    expect(report?.kind).toBe("HTTP_ERROR");
    expect(report?.message).toContain("importe aqui");
  });

  it("mensagens nunca sugerem contornar a proteção", () => {
    const reports = [
      detectProtection(input({ headers: { "cf-mitigated": "challenge" } })),
      detectProtection(input({ html: `<div id="px-captcha"></div>`, bodyTextLength: 0 })),
      detectProtection(input({ status: 429, html: "", bodyTextLength: 0 })),
    ];
    for (const r of reports) {
      expect(r).not.toBeNull();
      expect(r?.message).not.toMatch(/contornar|burlar|bypass|proxy|vpn/i);
    }
  });
});
