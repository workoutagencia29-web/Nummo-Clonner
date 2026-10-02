/**
 * Fase 4 — pixels e tags dentro de código livre (src/lib/tracking/code-trackers.ts):
 * o código-base da Meta colado em "Códigos da página" não pode carregar antes do
 * "Aceitar" só porque a página nunca teve categoria escolhida.
 */
import { describe, expect, it } from "vitest";
import { renderPageHtml } from "@/lib/page-render";
import {
  detectCodeTrackers,
  detectHtmlTrackers,
  joinTrackerNames,
  keptNeedsConsent,
  necessaryTrackerWarning,
  resolveCodeCategory,
  unknownScriptHint,
  unknownScriptHosts,
} from "@/lib/tracking/code-trackers";
import {
  detectAllCodeTrackers,
  resolveCodeCategoryFull,
  unknownCodeScripts,
} from "@/lib/tracking/code-trackers-server";
import { composeTrackingConfig } from "@/lib/tracking/compose";
import { parseTrackingSettings } from "@/lib/tracking/schema";

/** Configuração da página publicada (modo "live", "Pedir permissão"), sem pixels. */
const runtimeConfig = () =>
  composeTrackingConfig({
    mode: "live",
    settings: parseTrackingSettings({}),
    pixels: [],
    rules: [],
    links: [],
    pageId: null,
    policyUrl: null,
  });

const SNIPPETS = {
  meta: "<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){};t=b.createElement(e);t.src=v;b.head.appendChild(t)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','123456789012345');fbq('track','PageView');</script>",
  metaNoscript:
    '<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=123&ev=PageView&noscript=1"/></noscript>',
  gtm: "<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-XXXX');</script>",
  ga4: '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config","G-ABC123DEF4");</script>',
  ads: '<script async src="https://www.googletagmanager.com/gtag/js?id=AW-123456789"></script><script>gtag("config","AW-123456789")</script>',
  tiktok:
    "<script>!function (w, d, t) {w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.load=function(e,n){var r='https://analytics.tiktok.com/i18n/pixel/events.js'};ttq.load('C1');ttq.page();}(window, document, 'ttq');</script>",
  kwai: '<script src="https://s1.kwai.net/kos/s101/nlav11187/pixel/events.js"></script>',
  utmify:
    '<script>window.pixelId = "66f1";var a=document.createElement("script");a.setAttribute("src","https://cdn.utmify.com.br/scripts/pixel/pixel.js");document.head.appendChild(a);</script>',
  clarity:
    '<script>(function(c,l,a,r,i,t,y){t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window, document, "clarity", "script", "abc");</script>',
  escaped: '<script>var u="https:\\/\\/connect.facebook.net\\/en_US\\/fbevents.js";</script>',
} as const;

describe("detectCodeTrackers", () => {
  it("reconhece os códigos-base oficiais das plataformas (inclusive o noscript da Meta e endereço com \\/)", () => {
    expect(detectCodeTrackers(SNIPPETS.meta)).toEqual(["Meta Pixel"]);
    expect(detectCodeTrackers(SNIPPETS.metaNoscript)).toEqual(["Meta Pixel"]);
    expect(detectCodeTrackers(SNIPPETS.escaped)).toEqual(["Meta Pixel"]);
    expect(detectCodeTrackers(SNIPPETS.gtm)).toEqual(["Google Tag Manager"]);
    expect(detectCodeTrackers(SNIPPETS.tiktok)).toEqual(["TikTok Pixel"]);
    expect(detectCodeTrackers(SNIPPETS.kwai)).toEqual(["Kwai Pixel"]);
    expect(detectCodeTrackers(SNIPPETS.utmify)).toEqual(["UTMify"]);
    expect(detectCodeTrackers(SNIPPETS.clarity)).toEqual(["Microsoft Clarity"]);
  });

  it("gtag do GA4/Google Ads: o nome do produto (o dataLayer.push do gtag não vira 'Google Tag Manager')", () => {
    expect(detectCodeTrackers(SNIPPETS.ga4)).toEqual(["Google Analytics"]);
    expect(detectCodeTrackers(SNIPPETS.ads)).toEqual(["Google Ads"]);
    // GTM de verdade junto com o GA4 continua aparecendo.
    expect(detectCodeTrackers(SNIPPETS.ga4, SNIPPETS.gtm)).toEqual(["Google Analytics", "Google Tag Manager"]);
    expect(detectCodeTrackers(SNIPPETS.gtm, SNIPPETS.ga4)).toEqual(["Google Tag Manager", "Google Analytics"]);
  });

  it("várias partes (head / início / fim do body) sem repetir, na ordem em que aparecem", () => {
    expect(detectCodeTrackers(SNIPPETS.tiktok, null, `${SNIPPETS.meta}${SNIPPETS.metaNoscript}`)).toEqual([
      "TikTok Pixel",
      "Meta Pixel",
    ]);
  });

  it("código que não é rastreamento: nada (chat, fontes, jQuery, player de vídeo, estilos, link do WhatsApp)", () => {
    expect(
      detectCodeTrackers(
        '<script src="https://embed.tawk.to/abc/default" async></script>',
        '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">',
        '<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>',
        '<script src="https://scripts.converteai.net/abc/players/123/player.js"></script>',
        "<style>h1{color:red}</style><script>console.log(1)</script>",
        '<a href="https://wa.me/5511999999999">WhatsApp</a>',
      ),
    ).toEqual([]);
    expect(detectCodeTrackers("", "   ", null, undefined)).toEqual([]);
  });
});

describe("resolveCodeCategory", () => {
  it("sem escolha: Marketing quando há rastreador, Essencial quando não há; a escolha da pessoa sempre vale", () => {
    expect(resolveCodeCategory({ head: SNIPPETS.meta }, null)).toEqual({
      category: "MARKETING",
      trackers: ["Meta Pixel"],
      auto: true,
    });
    expect(resolveCodeCategory({ bodyEnd: "<script>window.chat=1</script>" }, null)).toEqual({
      category: "NECESSARY",
      trackers: [],
      auto: true,
    });
    expect(resolveCodeCategory({ bodyStart: SNIPPETS.gtm }, "NECESSARY")).toEqual({
      category: "NECESSARY",
      trackers: ["Google Tag Manager"],
      auto: false,
    });
    expect(resolveCodeCategory({ head: "<script>x()</script>" }, "ANALYTICS").category).toBe("ANALYTICS");
    expect(resolveCodeCategory(null, null)).toEqual({ category: "NECESSARY", trackers: [], auto: true });
  });
});

describe("textos do aviso", () => {
  it("junta os nomes em português e usa o texto do botão de aceitar da oferta", () => {
    expect(joinTrackerNames([])).toBe("");
    expect(joinTrackerNames(["A"])).toBe("A");
    expect(joinTrackerNames(["A", "B"])).toBe("A e B");
    expect(joinTrackerNames(["A", "B", "C"])).toBe("A, B e C");
    expect(necessaryTrackerWarning(["Meta Pixel"], "Concordo")).toBe(
      "Este código tem Meta Pixel e carrega antes do “Concordo” do aviso de cookies — quem recusa continua sendo rastreado.",
    );
  });
});

// ─── Refix 1: rastreadores comuns fora das assinaturas do clonador ───────────

const COMMON = {
  rdstation:
    '<script type="text/javascript" async src="https://d335luupugsy2.cloudfront.net/js/loader-scripts/1a2b3c4d-1111-2222-3333-444455556666-loader.js" ></script>',
  hubspot:
    '<!-- Start of HubSpot Embed Code -->\n<script type="text/javascript" id="hs-script-loader" async defer src="//js.hs-scripts.com/1234567.js"></script>\n<!-- End of HubSpot Embed Code -->',
  mouseflow:
    '<script type="text/javascript">window._mfq = window._mfq || [];(function() {var mf = document.createElement("script");mf.type = "text/javascript"; mf.defer = true;mf.src = "//cdn.mouseflow.com/projects/abcd1234-1234-1234-1234-123456789012.js";document.getElementsByTagName("head")[0].appendChild(mf);})();</script>',
  smartlook:
    "<script type='text/javascript'>window.smartlook||(function(d) {var o=smartlook=function(){ o.api.push(arguments)},h=d.getElementsByTagName('head')[0];var c=d.createElement('script');o.api=new Array();c.async=true;c.type='text/javascript';c.charset='utf-8';c.src='https://web-sdk.smartlook.com/recorder.js';h.appendChild(c);})(document);smartlook('init', 'abc123', { region: 'eu' });</script>",
  criteo: '<script type="text/javascript" src="//dynamic.criteo.com/js/ld/ld.js?a=12345" async="true"></script>',
  mixpanel:
    '<script src="https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js"></script><script>mixpanel.init("abc");</script>',
  segment:
    '<script>!function(){var analytics=window.analytics=window.analytics||[];analytics.load=function(key){var t=document.createElement("script");t.src="https://cdn.segment.com/analytics.js/v1/" + key + "/analytics.min.js";};analytics.load("KEY");analytics.page();}();</script>',
} as const;

describe("refix 1: RD Station, HubSpot, Mouseflow, Smartlook, Criteo, Mixpanel e Segment", () => {
  it("são rastreamento para o consentimento (o automático vira Marketing)", () => {
    const expected: Record<keyof typeof COMMON, string> = {
      rdstation: "RD Station",
      hubspot: "HubSpot",
      mouseflow: "Mouseflow",
      smartlook: "Smartlook",
      criteo: "Criteo",
      mixpanel: "Mixpanel",
      segment: "Segment",
    };
    for (const [key, code] of Object.entries(COMMON) as [keyof typeof COMMON, string][]) {
      expect(detectCodeTrackers(code), key).toEqual([expected[key]]);
      expect(resolveCodeCategory({ head: code }, null).category, key).toBe("MARKETING");
      expect(resolveCodeCategoryFull({ bodyEnd: code }, null).category, key).toBe("MARKETING");
    }
  });

  it("formulários e imagens do RD Station continuam conteúdo (não pedem consentimento)", () => {
    expect(
      detectCodeTrackers(
        '<script src="https://d335luupugsy2.cloudfront.net/js/rdstation-forms/stable/rdstation-forms.min.js"></script>',
        '<img src="https://d335luupugsy2.cloudfront.net/cms/files/1/logo.png">',
      ),
    ).toEqual([]);
  });

  it("no servidor, a base third-party-web completa o resto da internet (e não troca o que as regras próprias decidiram)", () => {
    const inspectlet = '<script src="https://cdn.inspectlet.com/inspectlet.js?wid=123"></script>';
    expect(detectCodeTrackers(inspectlet)).toEqual([]);
    expect(detectAllCodeTrackers(inspectlet)).toEqual(["Inspectlet"]);
    expect(resolveCodeCategoryFull({ head: inspectlet }, null)).toEqual({
      category: "MARKETING",
      trackers: ["Inspectlet"],
      auto: true,
    });
    // O GA4 continua um só nome (a base third-party-web não traz o "Google Tag" de volta).
    expect(detectAllCodeTrackers(SNIPPETS.ga4)).toEqual(["Google Analytics"]);
    // Chat, player e CDN seguem fora.
    expect(
      detectAllCodeTrackers(
        '<script src="https://embed.tawk.to/abc/default" async></script>',
        '<script src="https://scripts.converteai.net/abc/players/123/player.js"></script>',
        '<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>',
      ),
    ).toEqual([]);
    // A escolha da pessoa sempre vale.
    expect(resolveCodeCategoryFull({ head: inspectlet }, "NECESSARY").category).toBe("NECESSARY");
  });

  it("script de fora que ninguém reconhece: vira dica (o servidor tira os que a third-party-web conhece)", () => {
    const unknown = '<script async src="https://widget.desconhecido-exemplo.com/w.js"></script>';
    const onesignal = "<script src='https://cdn.onesignal.com/sdks/OneSignalSDK.js'></script>";
    expect(unknownScriptHosts([unknown, onesignal, COMMON.mouseflow, SNIPPETS.ga4, "<script>x()</script>"])).toEqual([
      "widget.desconhecido-exemplo.com",
      "cdn.onesignal.com",
    ]);
    expect(unknownCodeScripts(unknown, onesignal)).toEqual(["widget.desconhecido-exemplo.com"]);
    expect(
      unknownScriptHosts([
        '<script src="https://embed.tawk.to/abc/default"></script>',
        '<script src="/local.js"></script>',
      ]),
    ).toEqual([]);
    expect(unknownScriptHint(["a.com"], "Concordo")).toBe(
      "Este código carrega um script de fora que o Offer Studio não reconhece (a.com). Se ele rastreia os visitantes (análise, anúncios, mapa de calor), escolha “Marketing” para esperar o “Concordo”.",
    );
    expect(unknownScriptHint(["a.com", "b.com", "c.com", "d.com"])).toContain("(a.com, b.com e c.com…)");
  });
});

describe("refix 1: HTML de página e rastreadores mantidos na clonagem", () => {
  it("detectHtmlTrackers olha só scripts, noscript, img e iframe (um link para o Facebook não conta)", () => {
    expect(detectHtmlTrackers(`<div><h1>Oi</h1>${SNIPPETS.meta}</div>`)).toEqual(["Meta Pixel"]);
    expect(detectHtmlTrackers(`<section>${SNIPPETS.metaNoscript}</section>`)).toEqual(["Meta Pixel"]);
    expect(detectHtmlTrackers(COMMON.rdstation)).toEqual(["RD Station"]);
    expect(
      detectHtmlTrackers(
        '<a href="https://www.facebook.com/tr?id=1">Facebook</a><p>https://connect.facebook.net/en_US/fbevents.js</p>',
      ),
    ).toEqual([]);
  });

  it("keptNeedsConsent: pixels, análise, tags e o carregador do RD Station esperam; chats não", () => {
    expect(keptNeedsConsent({ category: "PIXEL", snippet: SNIPPETS.meta })).toBe(true);
    expect(keptNeedsConsent({ category: "ANALYTICS", snippet: SNIPPETS.clarity })).toBe(true);
    expect(keptNeedsConsent({ category: "CHAT", snippet: COMMON.rdstation })).toBe(true);
    expect(keptNeedsConsent({ category: "CHAT", snippet: COMMON.hubspot })).toBe(true);
    expect(
      keptNeedsConsent({
        category: "CHAT",
        snippet: '<script src="https://embed.tawk.to/abc/default" async></script>',
      }),
    ).toBe(false);
    expect(keptNeedsConsent({ category: "OTHER", snippet: "" })).toBe(false);
  });
});

describe("refix 1: prévia/ZIP com o código da página sem categoria", () => {
  it("RD Station colado em 'Códigos da página' (sem categoria) espera o 'Aceitar' no 'Pedir permissão'", () => {
    const html = renderPageHtml("<!doctype html><html><head><title>x</title></head><body><h1>x</h1></body></html>", {
      links: [],
      pageHref: (id) => `/p/${id}`,
      runtimeTag: "<script data-os-runtime></script>",
      customCode: { head: COMMON.rdstation, category: null },
      tracking: {
        config: runtimeConfig(),
        scriptTag: "<script data-os-tracking></script>",
        offerCode: null,
      },
    });
    expect(html).toContain('<script type="application/json" data-os-consent="marketing" data-os-block>');
    // Fora do bloco em espera (JSON, sem "<"), nenhum <script> do RD Station.
    expect(html.replace(/<script type="application\/json" data-os-consent[^>]*>[^<]*<\/script>/g, "")).not.toContain(
      "loader-scripts",
    );
  });
});
