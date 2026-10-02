import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import {
  classifyInlineScript,
  classifyUrl,
  extractPixelId,
  extractPixelIds,
  isTrackerHost,
  removeTrackers,
  removeWidgetResidue,
  SNIPPET_MAX,
} from "@/worker/clone/trackers";

// ─── Trechos reais (ou fiéis aos oficiais) ───────────────────────────────────

const META_BASE = `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '1234567890123456');
fbq('track', 'PageView');`;

const META_NOSCRIPT = `<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=1234567890123456&ev=PageView&noscript=1"
/></noscript>`;

const TIKTOK_BASE = `!function (w, d, t) {
  w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(
var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script")
;n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};

  ttq.load('CQ1ABCDEFGHIJ2KLMNOP');
  ttq.page();
}(window, document, 'ttq');`;

const KWAI_LOADER = `!function(e,t){"object"==typeof exports&&"object"==typeof module?module.exports=t():"function"==typeof define&&define.amd?define([],t):"object"==typeof exports?exports.install=t():e.install=t()}(window,(function(){return function(e){var t={};function n(o){if(t[o])return t[o].exports;var r=t[o]={i:o,l:!1,exports:{}};return e[o].call(r.exports,r,r.exports,n),r.l=!0,r.exports}return n.m=e,n.c=t,n.p="",n(n.s=0)}([function(e,t,n){"use strict";var o=function(e,t){var o=e.createElement("script");o.type="text/javascript",o.async=!0,o.src=t;var i=e.getElementsByTagName("script")[0];i.parentNode.insertBefore(o,i)};t.default=function(){return{install:function(e,t,n){window[n]=window[n]||[];o(document,t)}}}}]).default}));`;

const KWAI_INIT = `install().install("KwaiAnalyticsObject","https://s1.kwai.net/kos/s101/nlav11187/pixel/events.js","kwaiq");
kwaiq.load('240011223344556677');
kwaiq.page();`;

const GTM_HEAD = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-ABC1234');`;

const GTM_NOSCRIPT = `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-ABC1234"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;

const GTAG_SRC = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ9"></script>`;

const GTAG_INLINE = `
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-ABC123XYZ9');
  gtag('config', 'AW-987654321');
`;

const GTAG_ADS_ONLY = `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'AW-987654321');`;

const ADS_CONVERSION = `gtag('event', 'conversion', {'send_to': 'AW-987654321/AbCdEfGhIjK', 'value': 97.0, 'currency': 'BRL', 'transaction_id': ''});`;

const UTMIFY_PIXEL = `
  window.pixelId = "6612ab34cd56ef7890123456";
  var a = document.createElement("script");
  a.setAttribute("async", "");
  a.setAttribute("defer", "");
  a.setAttribute("src", "https://cdn.utmify.com.br/scripts/pixel/pixel.js");
  document.head.appendChild(a);
`;

const UTMIFY_UTMS = `<script
  src="https://cdn.utmify.com.br/scripts/utms/latest.js"
  data-utmify-prevent-xcod-sck
  data-utmify-prevent-subids
  async
  defer
></script>`;

const HOTJAR = `(function(h,o,t,j,a,r){
        h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};
        h._hjSettings={hjid:1234567,hjsv:6};
        a=o.getElementsByTagName('head')[0];
        r=o.createElement('script');r.async=1;
        r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;
        a.appendChild(r);
    })(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');`;

const CLARITY = `(function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "abcdefghij");`;

const TABOOLA = `window._tfa = window._tfa || [];
window._tfa.push({notify: 'event', name: 'page_view', id: 1234567});
!function (t, f, a, x) {
  if (!document.getElementById(x)) {
    t.async = 1;t.src = a;t.id=x;f.parentNode.insertBefore(t, f);
  }
}(document.createElement('script'),
document.getElementsByTagName('script')[0],
'//cdn.taboola.com/libtrc/unip/1234567/tfa.js',
'tb_tfa_script');`;

const OUTBRAIN = `!function(_window, _document) {
  var OB_ADV_ID = '00a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
  if (_window.obApi) {var toArray = function(object) {return Object.prototype.toString.call(object) === '[object Array]' ? object : [object];};_window.obApi.marketerId = toArray(_window.obApi.marketerId).concat(toArray(OB_ADV_ID));return;}
  var api = _window.obApi = function() {api.dispatch ? api.dispatch.apply(api, arguments) : api.queue.push(arguments);};api.version = '1.1';api.loaded = true;api.marketerId = OB_ADV_ID;api.queue = [];var tag = _document.createElement('script');tag.async = true;tag.src = '//amplify.outbrain.com/cp/obtp.js';tag.type = 'text/javascript';var script = _document.getElementsByTagName('script')[0];script.parentNode.insertBefore(tag, script);}(window, document);
obApi('track', 'PAGE_VIEW');`;

const PINTEREST = `!function(e){if(!window.pintrk){window.pintrk = function () {
window.pintrk.queue.push(Array.prototype.slice.call(arguments))};var
  n=window.pintrk;n.queue=[],n.version="3.0";var
  t=document.createElement("script");t.async=!0,t.src=e;var
  r=document.getElementsByTagName("script")[0];
  r.parentNode.insertBefore(t,r)}}("https://s.pinimg.com/ct/core.js");
pintrk('load', '2612345678901', {em: '<user_email_address>'});
pintrk('page');`;

const SNAP = `(function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function()
{a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};
a.queue=[];var s='script';r=t.createElement(s);r.async=!0;
r.src=n;var u=t.getElementsByTagName(s)[0];
u.parentNode.insertBefore(r,u);})(window,document,
'https://sc-static.net/scevent.min.js');
snaptr('init', '0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d', {'user_email': '__INSERT_USER_EMAIL__'});
snaptr('track', 'PAGE_VIEW');`;

const LINKEDIN = `_linkedin_partner_id = "1234567";
window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
window._linkedin_data_partner_ids.push(_linkedin_partner_id);`;

const TWITTER = `!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);
},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
twq('config','o1a2b');`;

const BING = `(function(w,d,t,r,u){var f,n,i;w[u]=w[u]||[],f=function(){var o={ti:"187654321", enableAutoSpaTracking: true};o.q=w[u],w[u]=new UET(o),w[u].push("pageLoad")},n=d.createElement(t),n.src=r,n.async=1,n.onload=n.onreadystatechange=function(){var s=this.readyState;s&&s!=="loaded"&&s!=="complete"||(f(),n.onload=n.onreadystatechange=null)},i=d.getElementsByTagName(t)[0],i.parentNode.insertBefore(n,i)})(window,document,"script","//bat.bing.com/bat.js","uetq");`;

const YANDEX = `(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();
for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
ym(98765432, "init", { clickmap:true, trackLinks:true, accurateTrackBounce:true, webvisor:true });`;

const TAWK = `var Tawk_API=Tawk_API||{}, Tawk_LoadStart=new Date();
(function(){
var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];
s1.async=true;
s1.src='https://embed.tawk.to/5f1a2b3c4d5e6f7a8b9c0d1e/1eabcdefg';
s1.charset='UTF-8';
s1.setAttribute('crossorigin','*');
s0.parentNode.insertBefore(s1,s0);
})();`;

const CRISP = `window.$crisp=[];window.CRISP_WEBSITE_ID="0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d";(function(){d=document;s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();`;

const INTERCOM = `window.intercomSettings = { api_base: "https://api-iam.intercom.io", app_id: "abc123de" };
(function(){var w=window;var ic=w.Intercom;if(typeof ic==="function"){ic('reattach_activator');ic('update',w.intercomSettings);}else{var d=document;var i=function(){i.c(arguments);};i.q=[];i.c=function(args){i.q.push(args);};w.Intercom=i;var l=function(){var s=d.createElement('script');s.type='text/javascript';s.async=true;s.src='https://widget.intercom.io/widget/abc123de';var x=d.getElementsByTagName('script')[0];x.parentNode.insertBefore(s,x);};if(document.readyState==='complete'){l();}else if(w.attachEvent){w.attachEvent('onload',l);}else{w.addEventListener('load',l,false);}}})();`;

const CHATWOOT = `(function(d,t) {
  var BASE_URL="https://app.chatwoot.com";
  var g=d.createElement(t),s=d.getElementsByTagName(t)[0];
  g.src=BASE_URL+"/packs/js/sdk.js";
  g.defer = true;
  g.async = true;
  s.parentNode.insertBefore(g,s);
  g.onload=function(){
    window.chatwootSDK.run({
      websiteToken: 'AbCdEfGhIjKlMnOpQr123456',
      baseUrl: BASE_URL
    })
  }
})(document,"script");`;

const OCTADESK = `(function (o, c, t, a, d, e, s, k) {
  o.octadesk = o.octadesk || {};
  s = c.getElementsByTagName("body")[0];
  k = c.createElement("script");
  k.async = 1;
  k.src = t + '/' + a + '?showButton=' +  d + '&openOnMessage=' + e;
  s.appendChild(k);
})(window, document, 'https://chat.octadesk.services/api/widget', 'suaempresa',  true, true);`;

const GETBUTTON = `(function () {
    var options = { whatsapp: "+5511999999999", call_to_action: "Fale conosco", position: "right" };
    var proto = document.location.protocol, host = "getbutton.io", url = proto + "//static." + host;
    var s = document.createElement('script'); s.type = 'text/javascript'; s.async = true; s.src = url + '/widget-send-button/js/init.js';
    s.onload = function () { WhWidgetSendButton.init(host, proto, options); };
    var x = document.getElementsByTagName('script')[0]; x.parentNode.insertBefore(s, x);
})();`;

const BLIP = `(function () {
  window.onload = function () {
    new BlipChat()
      .withAppKey('YWJjZGVmZ2hpams=')
      .withButton({"color":"#2CC3D5","icon":""})
      .withCustomCommonUrl('https://chat.blip.ai/')
      .build();
  }
})();`;

const TIDIO = `document.tidioChatLang = "pt";
(function() {
  function onTidioChatApiReady() { window.tidioChatApi.hide(); }
  if (window.tidioChatApi) { window.tidioChatApi.on("ready", onTidioChatApiReady); }
  else { document.addEventListener("tidioChat-ready", onTidioChatApiReady); }
})();`;

const PYS = `/* <![CDATA[ */
var pysOptions = {"staticEvents":{"facebook":{"init_event":[{"delay":0,"type":"static","name":"PageView","pixelIds":["1234567890123456"],"eventID":"abc","params":{}}]}},"facebook":{"pixelIds":["1234567890123456"],"advancedMatching":[],"removeMetadata":false}};
/* ]]> */`;

const OPTIMIZE_ANTIFLICKER = `(function(a,s,y,n,c,h,i,d,e){s.className+=' '+y;h.start=1*new Date;
h.end=i=function(){s.className=s.className.replace(RegExp(' ?'+y),'')};
(a[n]=a[n]||[]).hide=h;setTimeout(function(){i();h.end=null},c);h.timeout=c;
})(window,document.documentElement,'async-hide','dataLayer',4000,
{'GTM-ABC1234':true});`;

// ─── Scripts legítimos (não podem ser tocados) ───────────────────────────────

const JQUERY_INIT = `jQuery(document).ready(function($){ $('.faq-item').on('click', function(){ $(this).toggleClass('open'); }); });`;

const COUNTDOWN = `(function(){ var end = Date.now() + 15*60*1000; var el = document.getElementById('timer');
function tick(){ var left = Math.max(0, end - Date.now()); var m = Math.floor(left/60000), s = Math.floor(left%60000/1000);
el.textContent = (m<10?'0':'')+m+':'+(s<10?'0':'')+s; if (left > 0) setTimeout(tick, 1000); } tick(); })();`;

const VTURB_ID = "6601a2b3c4d5e6f7a8b9c0d1";
const VTURB_PLAYER_URL = `https://scripts.converteai.net/0a1b2c3d-4e5f-6789-abcd-ef0123456789/players/${VTURB_ID}/v4/player.js`;
const VTURB_LOADER = ` var s=document.createElement("script"); s.src="${VTURB_PLAYER_URL}", s.async=!0,document.head.appendChild(s); `;
const VTURB_PLT = `!function(i,n){i._plt=i._plt||(n&&n.timeOrigin?n.timeOrigin+n.now():Date.now())}(window,performance);`;
const VTURB_DELAY = `var delaySeconds = 540; var player = document.querySelector("vturb-smartplayer");
player.addEventListener("player:ready", function() { player.displayHiddenElements(delaySeconds, [".esconder"], { persist: true }); });`;

const PANDA_SCRIPT = `window.pandascripttag = window.pandascripttag || [];
window.pandascripttag.push(function () {
  const p = new PandaPlayer('panda-0a1b2c3d', {
    onReady() { p.onEvent(function ({ message }) { if (message === 'panda_timeupdate') { document.querySelector('.esconder').style.display = 'block'; } }); }
  });
});`;

const ELEMENTOR_CONFIG = `var elementorFrontendConfig = {"environmentMode":{"edit":false,"wpPreview":false,"isScriptDebug":false},"i18n":{"shareOnFacebook":"Compartilhar no Facebook","shareOnTwitter":"Compartilhar no Twitter","pinIt":"Fixar","download":"Baixar","downloadImage":"Baixar imagem","fullscreen":"Tela cheia","zoom":"Zoom","share":"Compartilhar","playVideo":"Reproduzir v\\u00eddeo","previous":"Anterior","next":"Pr\\u00f3ximo","close":"Fechar"},"is_rtl":false,"breakpoints":{"xs":0,"sm":480,"md":768,"lg":1025,"xl":1440,"xxl":1600},"version":"3.21.4","is_static":false,"experimentalFeatures":{"e_optimized_assets_loading":true,"container":true},"urls":{"assets":"https:\\/\\/exemplo.com.br\\/wp-content\\/plugins\\/elementor\\/assets\\/"},"swiperClass":"swiper","settings":{"page":[],"editorPreferences":[]},"kit":{"active_breakpoints":["viewport_mobile","viewport_tablet"],"global_image_lightbox":"yes"},"post":{"id":42,"title":"Oferta%20Especial","excerpt":"","featuredImage":false}};`;

const YT_API = `var tag = document.createElement('script'); tag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName('script')[0]; firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);`;

const CLICK_HANDLER = `document.querySelectorAll('.btn-comprar').forEach(function(btn){
  btn.addEventListener('click', function(){
    fbq('track', 'InitiateCheckout');
    window.location.href = 'https://pay.hotmart.com/A12345678B?checkoutMode=10';
  });
});`;

const JSON_LD = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Curso X","url":"https://connect.facebook.net/","description":"fbq('init', '1')","offers":{"@type":"Offer","price":"97.00","priceCurrency":"BRL"}}</script>`;

// ─── classifyUrl ─────────────────────────────────────────────────────────────

describe("classifyUrl: rastreadores, chats e banners", () => {
  it.each([
    ["https://connect.facebook.net/en_US/fbevents.js", "Meta Pixel", "PIXEL"],
    ["https://connect.facebook.net/signals/config/1234567890123456?v=2.9.170&r=stable", "Meta Pixel", "PIXEL"],
    ["https://www.facebook.com/tr?id=1234567890123456&ev=PageView&noscript=1", "Meta Pixel", "PIXEL"],
    ["//connect.facebook.net/pt_BR/fbevents.js", "Meta Pixel", "PIXEL"],
    ["https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=CQ1ABCDEFGHIJ2KLMNOP&lib=ttq", "TikTok Pixel", "PIXEL"],
    ["https://s1.kwai.net/kos/s101/nlav11187/pixel/events.js", "Kwai Pixel", "PIXEL"],
    ["https://s21-def.kwai.net/kos/nlav10001/pixel/events.js?sdkid=123", "Kwai Pixel", "PIXEL"],
    ["https://cdn.utmify.com.br/scripts/pixel/pixel.js", "UTMify", "PIXEL"],
    ["https://cdn.utmify.com.br/scripts/utms/latest.js", "UTMify", "PIXEL"],
    ["https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234", "Google Tag Manager", "TAG_MANAGER"],
    ["https://www.googletagmanager.com/ns.html?id=GTM-ABC1234", "Google Tag Manager", "TAG_MANAGER"],
    ["https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ9", "Google Analytics", "ANALYTICS"],
    ["https://www.googletagmanager.com/gtag/js?id=AW-987654321", "Google Ads", "ADS"],
    ["https://www.google-analytics.com/analytics.js", "Google Analytics", "ANALYTICS"],
    ["https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC123XYZ9", "Google Analytics", "ANALYTICS"],
    ["https://googleads.g.doubleclick.net/pagead/viewthroughconversion/987654321/", "Google Ads", "ADS"],
    ["https://www.googleadservices.com/pagead/conversion_async.js", "Google Ads", "ADS"],
    ["https://www.google.com/pagead/1p-user-list/987654321/?random=1", "Google Ads", "ADS"],
    [
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456",
      "Google AdSense",
      "ADS",
    ],
    ["https://static.hotjar.com/c/hotjar-1234567.js?sv=6", "Hotjar", "ANALYTICS"],
    ["https://www.clarity.ms/tag/abcdefghij", "Microsoft Clarity", "ANALYTICS"],
    ["https://cdn.taboola.com/libtrc/unip/1234567/tfa.js", "Taboola", "ADS"],
    ["https://amplify.outbrain.com/cp/obtp.js", "Outbrain", "ADS"],
    ["https://s.pinimg.com/ct/core.js", "Pinterest Tag", "PIXEL"],
    ["https://sc-static.net/scevent.min.js", "Snap Pixel", "PIXEL"],
    ["https://snap.licdn.com/li.lms-analytics/insight.min.js", "LinkedIn Insight Tag", "PIXEL"],
    ["https://static.ads-twitter.com/uwt.js", "X (Twitter) Pixel", "PIXEL"],
    ["https://bat.bing.com/bat.js", "Microsoft Ads (Bing UET)", "ADS"],
    ["https://mc.yandex.ru/metrika/tag.js", "Yandex Metrica", "ANALYTICS"],
    ["https://www.redditstatic.com/ads/pixel.js", "Reddit Pixel", "PIXEL"],
    ["https://static.cloudflareinsights.com/beacon.min.js", "Cloudflare Web Analytics", "ANALYTICS"],
    ["https://code.jivosite.com/widget/AbCdEf1234", "JivoChat", "CHAT"],
    ["https://embed.tawk.to/5f1a2b3c4d5e6f7a8b9c0d1e/1eabcdefg", "Tawk.to", "CHAT"],
    ["https://static.zdassets.com/ekr/snippet.js?key=12345678-aaaa-bbbb-cccc-1234567890ab", "Zendesk", "CHAT"],
    ["https://widget.intercom.io/widget/abc123de", "Intercom", "CHAT"],
    ["https://client.crisp.chat/l.js", "Crisp", "CHAT"],
    ["https://js.hs-scripts.com/1234567.js", "HubSpot", "CHAT"],
    ["https://js.usemessages.com/conversations-embed.js", "HubSpot", "CHAT"],
    [
      "https://d335luupugsy2.cloudfront.net/js/loader-scripts/0a1b2c3d-1234-5678-9abc-def012345678-loader.js",
      "RD Station",
      "CHAT",
    ],
    ["https://widget.manychat.com/123456789012345.js", "Manychat", "CHAT"],
    ["https://code.tidio.co/abcdefghijklmnopqrstuvwxyz123456.js", "Tidio", "CHAT"],
    ["https://chat.octadesk.services/api/widget/suaempresa", "Octadesk", "CHAT"],
    ["https://app.chatwoot.com/packs/js/sdk.js", "Chatwoot", "CHAT"],
    ["https://chat.suaempresa.com.br/packs/js/sdk.js", "Chatwoot", "CHAT"],
    ["https://static.getbutton.io/widget-send-button/js/init.js", "GetButton (WhatsApp)", "CHAT"],
    ["https://unpkg.com/blip-chat-widget", "Blip (Take)", "CHAT"],
    ["https://consent.cookiebot.com/uc.js", "Banner de cookies (Cookiebot)", "OTHER"],
    ["https://cdn.cookielaw.org/scripttemplates/otSDKStub.js", "Banner de cookies (OneTrust)", "OTHER"],
    [
      "https://cdn-cookieyes.com/client_data/0123456789abcdef01234567/script.js",
      "Banner de cookies (CookieYes)",
      "OTHER",
    ],
    ["https://web.cmp.usercentrics.eu/ui/loader.js", "Banner de cookies (Usercentrics)", "OTHER"],
    ["https://exemplo.com.br/wp-content/plugins/pixelyoursite/dist/scripts/public.js", "PixelYourSite", "PIXEL"],
    // Base third-party-web (fora da lista própria).
    ["https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js", "Mixpanel", "ANALYTICS"],
    ["https://js.driftt.com/include/1/abc.js", "Drift", "CHAT"],
    ["https://sdk.privacy-center.org/loader.js", "Banner de cookies (Didomi)", "OTHER"],
  ])("%s → %s", (url, vendor, category) => {
    expect(classifyUrl(url)).toEqual({ vendor, category });
  });
});

describe("classifyUrl: nunca marca vídeo, fontes, CDNs, pagamentos e checkouts", () => {
  it.each([
    "https://www.youtube.com/iframe_api",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    "https://player.vimeo.com/video/123456789",
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap",
    "https://fonts.gstatic.com/s/inter/v13/abc.woff2",
    "https://code.jquery.com/jquery-3.7.1.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js",
    "https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js",
    "https://unpkg.com/aos@2.3.1/dist/aos.js",
    "https://js.stripe.com/v3/",
    "https://www.paypal.com/sdk/js?client-id=abc",
    "https://pay.hotmart.com/A12345678B?checkoutMode=10",
    "https://static.hotmart.com/checkout/widget.min.js",
    "https://pay.kiwify.com.br/AbCdEfG",
    VTURB_PLAYER_URL,
    "https://cdn.converteai.net/lib/js/smartplayer/v1/sdk.min.js",
    "https://images.converteai.net/0a1b2c3d/players/abc/thumbnail.jpg",
    "https://player-vz-7b6cf9e4-8bf.tv.pandavideo.com.br/embed/?v=0a1b2c3d-4e5f-6789-abcd-ef0123456789",
    "https://fast.wistia.com/embed/medias/abc123.jsonp",
    "https://fast.vidalytics.com/embeds/abc/def/",
    "https://ssl.p.jwpcdn.com/player/v/8.6.0/jwplayer.js",
    "https://connect.facebook.net/pt_BR/sdk.js#xfbml=1&version=v18.0",
    "https://www.facebook.com/plugins/comments.php?href=https://exemplo.com.br",
    "https://www.google.com/recaptcha/api.js",
    "https://d335luupugsy2.cloudfront.net/js/rdstation-forms/stable/rdstation-forms.min.js",
    "https://s.pinimg.com/originals/ab/cd/ef.jpg",
    "https://media.licdn.com/dms/image/abc.jpg",
    "https://www.microsoft.com/pt-br/",
    "https://multimedia.getresponse.com/getresponse-AbCdE/photos/123.jpg",
    "https://exemplo.com.br/wp-content/uploads/2024/01/logo.png",
    "/assets/js/app.js",
    "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    "",
    "isso não é uma url",
  ])("%s → null", (url) => {
    expect(classifyUrl(url)).toBeNull();
  });

  it("resolve caminhos relativos com a página e reconhece o GTM servido pelo próprio site", () => {
    expect(classifyUrl("/gtm.js?id=GTM-ABC1234", "https://exemplo.com.br/oferta")).toEqual({
      vendor: "Google Tag Manager",
      category: "TAG_MANAGER",
    });
  });

  it("ignora a base third-party-web para arquivos do próprio site", () => {
    expect(classifyUrl("https://cdn.mxpnl.com/libs/x.js")?.vendor).toBe("Mixpanel");
    expect(classifyUrl("https://cdn.mxpnl.com/libs/x.js", "https://www.mxpnl.com/pagina")).toBeNull();
    // As assinaturas próprias continuam valendo.
    expect(classifyUrl("https://static.hotjar.com/c/hotjar-1.js", "https://www.hotjar.com/")?.vendor).toBe("Hotjar");
  });
});

// ─── isTrackerHost ───────────────────────────────────────────────────────────

describe("isTrackerHost", () => {
  it.each([
    "connect.facebook.net",
    "analytics.tiktok.com",
    "www.googletagmanager.com",
    "static.hotjar.com",
    "code.jivosite.com",
    "embed.tawk.to",
    "cdn.utmify.com.br",
    "cdn.mxpnl.com",
    "WWW.Google-Analytics.com.",
  ])("%s é rastreador", (host) => {
    expect(isTrackerHost(host)).toBe(true);
  });

  it.each([
    "www.facebook.com",
    "www.youtube.com",
    "fonts.googleapis.com",
    "scripts.converteai.net",
    "unpkg.com",
    "pay.hotmart.com",
    "exemplo.com.br",
    "",
  ])("%s não é rastreador", (host) => {
    expect(isTrackerHost(host)).toBe(false);
  });
});

// ─── classifyInlineScript ────────────────────────────────────────────────────

describe("classifyInlineScript: reconhece o código-base", () => {
  it.each([
    ["Meta (código-base)", META_BASE, "Meta Pixel"],
    ["TikTok (código-base)", TIKTOK_BASE, "TikTok Pixel"],
    ["Kwai (carregador)", KWAI_LOADER, "Kwai Pixel"],
    ["Kwai (install + kwaiq.load)", KWAI_INIT, "Kwai Pixel"],
    ["GTM (head)", GTM_HEAD, "Google Tag Manager"],
    ["gtag GA4 + Ads", GTAG_INLINE, "Google Analytics"],
    ["gtag só Google Ads", GTAG_ADS_ONLY, "Google Ads"],
    ["evento de conversão do Google Ads", ADS_CONVERSION, "Google Ads"],
    ["UTMify (pixel)", UTMIFY_PIXEL, "UTMify"],
    ["Hotjar", HOTJAR, "Hotjar"],
    ["Microsoft Clarity", CLARITY, "Microsoft Clarity"],
    ["Taboola", TABOOLA, "Taboola"],
    ["Outbrain", OUTBRAIN, "Outbrain"],
    ["Pinterest", PINTEREST, "Pinterest Tag"],
    ["Snap", SNAP, "Snap Pixel"],
    ["LinkedIn", LINKEDIN, "LinkedIn Insight Tag"],
    ["X/Twitter", TWITTER, "X (Twitter) Pixel"],
    ["Bing UET", BING, "Microsoft Ads (Bing UET)"],
    ["Yandex", YANDEX, "Yandex Metrica"],
    ["Tawk.to", TAWK, "Tawk.to"],
    ["Crisp", CRISP, "Crisp"],
    ["Zendesk (zE)", "zE('messenger', 'open');", "Zendesk"],
    ["Zendesk (zESettings)", "window.zESettings = { webWidget: { color: { theme: '#78a300' } } };", "Zendesk"],
    ["Intercom", INTERCOM, "Intercom"],
    ["JivoChat", "function jivo_onLoadCallback(){ jivo_api.setContactInfo({ name: 'Visitante' }); }", "JivoChat"],
    ["Chatwoot", CHATWOOT, "Chatwoot"],
    ["Tidio", TIDIO, "Tidio"],
    ["Octadesk", OCTADESK, "Octadesk"],
    ["GetButton", GETBUTTON, "GetButton (WhatsApp)"],
    ["Blip", BLIP, "Blip (Take)"],
    [
      "Manychat (carregador)",
      "var s=document.createElement('script');s.src='//widget.manychat.com/123456789012345.js';document.body.appendChild(s);",
      "Manychat",
    ],
    ["OneTrust (OptanonWrapper vazio)", "function OptanonWrapper() { }", "Banner de cookies (OneTrust)"],
    ["PixelYourSite", PYS, "PixelYourSite"],
    ["Google Optimize (anti-flicker)", OPTIMIZE_ANTIFLICKER, "Google Optimize"],
    ["AdSense", "(adsbygoogle = window.adsbygoogle || []).push({});", "Google AdSense"],
    [
      "carregador pequeno de um host da base third-party-web",
      "(function(){var s=document.createElement('script');s.src='https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js';document.head.appendChild(s);})();",
      "Mixpanel",
    ],
  ])("%s", (_name, code, vendor) => {
    expect(classifyInlineScript(code)?.vendor).toBe(vendor);
  });
});

describe("classifyInlineScript: scripts feitos só de chamadas de rastreamento", () => {
  it.each([
    ["fbq('track') solto", "fbq('track', 'Purchase', {value: 97.00, currency: 'BRL'});", "Meta Pixel"],
    ["window.fbq", "window.fbq('track', 'Lead');", "Meta Pixel"],
    [
      "fbq dentro de DOMContentLoaded",
      "document.addEventListener('DOMContentLoaded', function(){ fbq('track','ViewContent'); });",
      "Meta Pixel",
    ],
    ["fbq com checagem de typeof", "if (typeof fbq === 'function') { fbq('track', 'Lead'); }", "Meta Pixel"],
    ["ttq.track solto", "ttq.track('CompletePayment', { value: 97, currency: 'BRL' });", "TikTok Pixel"],
    ["kwaiq.track solto", "kwaiq.instance('240011223344556677').track('purchase');", "Kwai Pixel"],
    [
      "dataLayer.push",
      "window.dataLayer = window.dataLayer || []; window.dataLayer.push({ event: 'lead', formId: 'captura' });",
      "Google Tag Manager",
    ],
  ])("%s", (_name, code, vendor) => {
    expect(classifyInlineScript(code)?.vendor).toBe(vendor);
  });
});

describe("classifyInlineScript: não marca scripts comuns", () => {
  it.each([
    ["inicialização do jQuery", JQUERY_INIT],
    ["contador regressivo", COUNTDOWN],
    ["carregador do VTurb (smartplayer)", VTURB_LOADER],
    ["medição de tempo do VTurb (_plt)", VTURB_PLT],
    ["atraso do VTurb (displayHiddenElements)", VTURB_DELAY],
    ["Panda Video (pandascripttag)", PANDA_SCRIPT],
    ["configuração do Elementor", ELEMENTOR_CONFIG],
    ["API do YouTube", YT_API],
    ["clique do botão com fbq e redirecionamento", CLICK_HANDLER],
    [
      "dados do Next.js que citam o GTM como texto",
      `self.__next_f.push([1,"(function(w,d,s,l,i){w[l].push({'gtm.start':new Date().getTime()})})(window,document,'script','dataLayer','GTM-ABC1234')"])`,
    ],
    [
      "código minificado com nomes zE/ym",
      "!function(){var zE=function(a){return a*2},ym=function(b){return b+1};console.log(zE(2),ym(3))}();",
    ],
    [
      "texto com a palavra clarity",
      `var copy = { title: "Clarity of mind", clarity: true }; document.title = copy.title;`,
    ],
    ["formulário do RD Station", "new RDStationForms('lead-form-abc123', 'UA-12345678-1').createForm();"],
    ["só a fila do dataLayer", "window.dataLayer = window.dataLayer || [];"],
    ["vazio", "   \n  "],
  ])("%s", (_name, code) => {
    expect(classifyInlineScript(code)).toBeNull();
  });
});

// ─── extractPixelId ──────────────────────────────────────────────────────────

describe("extractPixelId", () => {
  const meta = { vendor: "Meta Pixel", category: "PIXEL" } as const;
  const google = { vendor: "Google Analytics", category: "ANALYTICS" } as const;

  it("Meta: fbq('init') do código-base", () => {
    expect(extractPixelId(meta, META_BASE)).toBe("1234567890123456");
  });

  it("Meta: tr?id= do noscript (com &amp;)", () => {
    expect(extractPixelId(meta, META_NOSCRIPT.replace(/&/g, "&amp;"))).toBe("1234567890123456");
  });

  it("Meta: signals/config na URL", () => {
    expect(extractPixelId(meta, "https://connect.facebook.net/signals/config/998877665544332?v=2.9")).toBe(
      "998877665544332",
    );
  });

  it("Meta: vários pixels no mesmo script", () => {
    const code = "fbq('init', '111111111111111'); fbq('init', '222222222222222'); fbq('track', 'PageView');";
    expect(extractPixelIds(meta, code)).toEqual(["111111111111111", "222222222222222"]);
  });

  it("TikTok: ttq.load e sdkid=", () => {
    const tiktok = { vendor: "TikTok Pixel", category: "PIXEL" } as const;
    expect(extractPixelId(tiktok, TIKTOK_BASE)).toBe("CQ1ABCDEFGHIJ2KLMNOP");
    expect(extractPixelId(tiktok, "https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=CABCDEFGHIJKLMNOPQRS")).toBe(
      "CABCDEFGHIJKLMNOPQRS",
    );
  });

  it("Kwai: kwaiq.load", () => {
    expect(extractPixelId({ vendor: "Kwai Pixel", category: "PIXEL" }, KWAI_INIT)).toBe("240011223344556677");
  });

  it("UTMify: window.pixelId", () => {
    expect(extractPixelId({ vendor: "UTMify", category: "PIXEL" }, UTMIFY_PIXEL)).toBe("6612ab34cd56ef7890123456");
  });

  it("Google: GTM-, G-, AW- e UA-", () => {
    expect(extractPixelId({ vendor: "Google Tag Manager", category: "TAG_MANAGER" }, GTM_HEAD)).toBe("GTM-ABC1234");
    expect(extractPixelIds(google, GTAG_INLINE)).toEqual(["G-ABC123XYZ9", "AW-987654321"]);
    expect(extractPixelId({ vendor: "Google Ads", category: "ADS" }, ADS_CONVERSION)).toBe("AW-987654321");
    expect(extractPixelId(google, "ga('create', 'UA-12345678-1', 'auto');")).toBe("UA-12345678-1");
  });

  it("Clarity e Hotjar", () => {
    expect(extractPixelId({ vendor: "Microsoft Clarity", category: "ANALYTICS" }, CLARITY)).toBe("abcdefghij");
    expect(extractPixelId({ vendor: "Hotjar", category: "ANALYTICS" }, HOTJAR)).toBe("1234567");
  });

  it("chats: JivoChat, Crisp e HubSpot", () => {
    expect(extractPixelId({ vendor: "JivoChat", category: "CHAT" }, "//code.jivosite.com/widget/AbCdEf1234")).toBe(
      "AbCdEf1234",
    );
    expect(extractPixelId({ vendor: "Crisp", category: "CHAT" }, CRISP)).toBe("0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d");
    expect(extractPixelId({ vendor: "HubSpot", category: "CHAT" }, "//js.hs-scripts.com/1234567.js")).toBe("1234567");
  });

  it("devolve undefined quando não há ID ou o fornecedor não tem padrão", () => {
    expect(extractPixelId(meta, "fbq('track', 'PageView');")).toBeUndefined();
    expect(extractPixelId({ vendor: "Mixpanel", category: "ANALYTICS" }, "mixpanel.init('abc')")).toBeUndefined();
  });
});

// ─── removeTrackers ──────────────────────────────────────────────────────────

const PAGE_URL = "https://exemplo.com.br/oferta/";

function buildPage(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Oferta Especial</title>
  <meta name="facebook-domain-verification" content="abc123verif456" />
  <meta name="google-site-verification" content="GoOgLeVeRiF_123" />
  <meta name="description" content="Curso completo">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
  <link rel="dns-prefetch" href="//connect.facebook.net">
  <link rel="preconnect" href="https://www.googletagmanager.com">
  <link rel="preload" href="${VTURB_PLAYER_URL}" as="script">
  <link rel="dns-prefetch" href="https://cdn.converteai.net">
  <link rel="stylesheet" href="/wp-content/themes/tema/style.css">
  <!-- Google Tag Manager -->
  <script>${GTM_HEAD}</script>
  <!-- Meta Pixel Code -->
  <script>${META_BASE}</script>
  ${META_NOSCRIPT}
  <script>${TIKTOK_BASE}</script>
  ${GTAG_SRC}
  <script>${GTAG_INLINE}</script>
  <script>${UTMIFY_PIXEL}</script>
  ${UTMIFY_UTMS}
  <script>${HOTJAR}</script>
  <script type="text/javascript">${CLARITY}</script>
  <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
  ${JSON_LD}
  <script>${ELEMENTOR_CONFIG}</script>
  <script>${VTURB_PLT}</script>
</head>
<body class="page">
  ${GTM_NOSCRIPT}
  <header><h1 id="headline">Aprenda a vender todos os dias</h1></header>
  <main>
    <vturb-smartplayer id="vid-${VTURB_ID}" style="display: block; margin: 0 auto; width: 100%;"></vturb-smartplayer>
    <script type="text/javascript">${VTURB_LOADER}</script>
    <iframe id="panda-0a1b2c3d" src="https://player-vz-7b6cf9e4-8bf.tv.pandavideo.com.br/embed/?v=0a1b2c3d" width="100%" height="100%"></iframe>
    <iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
    <div class="esconder"><a class="btn-comprar" href="https://pay.hotmart.com/A12345678B?checkoutMode=10">Quero comprar</a></div>
    <span id="timer">15:00</span>
    <noscript><img src="/wp-content/uploads/2024/01/depoimento.jpg" alt="Depoimento"></noscript>
    <img src="/wp-content/uploads/2024/01/logo.png" alt="Logo" width="200" height="80">
  </main>
  <img height="1" width="1" style="display:none" alt="" src="https://px.ads.linkedin.com/collect/?pid=1234567&fmt=gif" />
  <script>${COUNTDOWN}</script>
  <script>${VTURB_DELAY}</script>
  <script>${CLICK_HANDLER}</script>
  <script>fbq('track', 'ViewContent');</script>
  <script>fbq('init', '1234567890123456');</script>
  <script src="//code.jivosite.com/widget/AbCdEf1234" async></script>
  <script type="text/javascript">${TAWK}</script>
  <script type="text/javascript" id="hs-script-loader" async defer src="//js.hs-scripts.com/1234567.js"></script>
  <script type="rocketlazyloadscript" data-rocket-src="https://static.hotjar.com/c/hotjar-7654321.js?sv=6"></script>
  <jdiv class="__jivoMobileButton"><jdiv class="button_xyz">Fale conosco</jdiv></jdiv>
  <div id="onetrust-consent-sdk"><div class="banner">Usamos cookies</div></div>
</body>
</html>`;
}

describe("removeTrackers: página completa", () => {
  const $ = cheerio.load(buildPage());
  const removed = removeTrackers($, PAGE_URL);
  const html = $.html();

  it("lista cada item uma vez, na ordem do documento", () => {
    expect(removed.map((r) => `${r.vendor} · ${r.kind}`)).toEqual([
      "Verificação de domínio (Meta) · meta",
      "Verificação de domínio (Google) · meta",
      "Meta Pixel · link",
      "Google Tag Manager · link",
      "Google Tag Manager · script-inline",
      "Meta Pixel · script-inline",
      "Meta Pixel · noscript",
      "TikTok Pixel · script-inline",
      "Google Analytics · script-src",
      "Google Analytics · script-inline",
      "UTMify · script-inline",
      "UTMify · script-src",
      "Hotjar · script-inline",
      "Microsoft Clarity · script-inline",
      "Google Tag Manager · noscript",
      "LinkedIn Insight Tag · pixel",
      "Meta Pixel · script-inline",
      "JivoChat · script-src",
      "Tawk.to · script-inline",
      "HubSpot · script-src",
      "Hotjar · script-src",
    ]);
  });

  it("guarda IDs, categorias e local", () => {
    const by = (vendor: string, kind: string) => removed.filter((r) => r.vendor === vendor && r.kind === kind);
    expect(by("Verificação de domínio (Meta)", "meta")[0]).toMatchObject({
      pixelId: "abc123verif456",
      location: "head",
    });
    expect(by("Google Tag Manager", "script-inline")[0]).toMatchObject({
      pixelId: "GTM-ABC1234",
      category: "TAG_MANAGER",
      location: "head",
    });
    expect(by("Google Tag Manager", "noscript")[0]).toMatchObject({ pixelId: "GTM-ABC1234", location: "body" });
    expect(by("Meta Pixel", "script-inline").map((r) => r.pixelId)).toEqual(["1234567890123456", undefined]);
    expect(by("Meta Pixel", "noscript")[0]).toMatchObject({ pixelId: "1234567890123456", location: "head" });
    expect(by("TikTok Pixel", "script-inline")[0].pixelId).toBe("CQ1ABCDEFGHIJ2KLMNOP");
    expect(by("Google Analytics", "script-src")[0].pixelId).toBe("G-ABC123XYZ9");
    expect(by("Google Analytics", "script-inline")[0].pixelId).toBe("G-ABC123XYZ9, AW-987654321");
    expect(by("UTMify", "script-inline")[0].pixelId).toBe("6612ab34cd56ef7890123456");
    expect(by("UTMify", "script-src")[0].pixelId).toBeUndefined();
    expect(by("Hotjar", "script-inline")[0].pixelId).toBe("1234567");
    expect(by("Hotjar", "script-src")[0].pixelId).toBe("7654321");
    expect(by("Microsoft Clarity", "script-inline")[0].pixelId).toBe("abcdefghij");
    expect(by("LinkedIn Insight Tag", "pixel")[0]).toMatchObject({ pixelId: "1234567", location: "body" });
    expect(by("JivoChat", "script-src")[0]).toMatchObject({
      pixelId: "AbCdEf1234",
      category: "CHAT",
      location: "body",
    });
    expect(by("HubSpot", "script-src")[0].pixelId).toBe("1234567");
  });

  it("guarda o HTML original para restaurar", () => {
    const meta = removed.find((r) => r.vendor === "Meta Pixel" && r.kind === "script-inline");
    expect(meta?.snippet.startsWith("<script>")).toBe(true);
    expect(meta?.snippet).toContain("fbq('init', '1234567890123456');");
    const utms = removed.find((r) => r.vendor === "UTMify" && r.kind === "script-src");
    expect(utms?.snippet).toContain("data-utmify-prevent-xcod-sck");
    expect(removed.every((r) => r.snippet.length > 0 && r.snippet.length <= SNIPPET_MAX)).toBe(true);
  });

  it("tira todos os rastreadores e chats do HTML", () => {
    // O JSON-LD cita o Facebook de propósito (é dado, não código) e fica.
    const code = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, "");
    for (const needle of [
      "fbq('init'",
      "fbq('track', 'ViewContent')",
      "connect.facebook.net",
      "facebook.com/tr",
      "googletagmanager",
      "gtag(",
      "TiktokAnalyticsObject",
      "utmify",
      "hotjar",
      "clarity.ms",
      "px.ads.linkedin.com",
      "jivosite",
      "Tawk_API",
      "hs-scripts",
      "facebook-domain-verification",
      "google-site-verification",
      "<jdiv",
      "onetrust-consent-sdk",
    ]) {
      expect(code, needle).not.toContain(needle);
    }
  });

  it("mantém o resto da página intacto", () => {
    expect($("title").text()).toBe("Oferta Especial");
    expect($('meta[name="description"]').attr("content")).toBe("Curso completo");
    expect($('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]')).toHaveLength(3);
    expect($(`link[rel="preload"][href="${VTURB_PLAYER_URL}"]`)).toHaveLength(1);
    expect($('link[href="https://cdn.converteai.net"]')).toHaveLength(1);
    expect($('link[href="/wp-content/themes/tema/style.css"]')).toHaveLength(1);
    expect($('script[src="https://code.jquery.com/jquery-3.7.1.min.js"]')).toHaveLength(1);
    expect($('script[type="application/ld+json"]')).toHaveLength(1);
    expect(html).toContain("elementorFrontendConfig");
    expect(html).toContain("i._plt=i._plt");
    expect($(`vturb-smartplayer#vid-${VTURB_ID}`)).toHaveLength(1);
    expect(html).toContain(VTURB_PLAYER_URL);
    expect(html).toContain("displayHiddenElements");
    expect($("iframe#panda-0a1b2c3d")).toHaveLength(1);
    expect($('iframe[src="https://www.youtube.com/embed/dQw4w9WgXcQ"]')).toHaveLength(1);
    expect($("a.btn-comprar").attr("href")).toBe("https://pay.hotmart.com/A12345678B?checkoutMode=10");
    expect($("#headline").text()).toBe("Aprenda a vender todos os dias");
    expect($("#timer").text()).toBe("15:00");
    expect(html).toContain("depoimento.jpg");
    expect($('img[alt="Logo"]')).toHaveLength(1);
    expect(html).toContain("Math.floor(left/60000)");
    // O clique mistura fbq com o redirecionamento: fica.
    expect(html).toContain("window.location.href = 'https://pay.hotmart.com/A12345678B?checkoutMode=10'");
  });
});

describe("removeTrackers: casos específicos", () => {
  it("junta duplicados (mesmo fornecedor + ID + tipo) e guarda o primeiro trecho", () => {
    const $ = cheerio.load(
      `<html><head><script>${GTM_HEAD}</script><script>/* cópia */${GTM_HEAD}</script></head><body></body></html>`,
    );
    const removed = removeTrackers($, PAGE_URL);
    expect(removed).toHaveLength(1);
    expect(removed[0].snippet).not.toContain("cópia");
    expect($("script")).toHaveLength(0);
  });

  it("corta o trecho em 4000 caracteres", () => {
    const big = `${KWAI_LOADER}\n/*${"x".repeat(10_000)}*/`;
    const $ = cheerio.load(`<html><head></head><body><script>${big}</script></body></html>`);
    const [item] = removeTrackers($, PAGE_URL);
    expect(item.vendor).toBe("Kwai Pixel");
    expect(item.snippet).toHaveLength(SNIPPET_MAX);
    expect($("script")).toHaveLength(0);
  });

  it("remove o código-base do Kwai (carregador + inicialização)", () => {
    const $ = cheerio.load(
      `<html><head><script>${KWAI_LOADER}</script><script>${KWAI_INIT}</script></head><body><p>ok</p></body></html>`,
    );
    const removed = removeTrackers($, PAGE_URL);
    expect(removed.map((r) => [r.vendor, r.kind, r.pixelId])).toEqual([
      ["Kwai Pixel", "script-inline", undefined],
      ["Kwai Pixel", "script-inline", "240011223344556677"],
    ]);
    expect($("script")).toHaveLength(0);
    expect($("p").text()).toBe("ok");
  });

  it("remove scripts atrasados (WP Rocket) e bloqueados por consentimento", () => {
    const $ = cheerio.load(`<html><head>
      <script type="rocketlazyloadscript">${META_BASE}</script>
      <script type="text/plain" data-cookieconsent="statistics">${GTAG_INLINE}</script>
      <script type="text/template"><div>{{ fbq('init', '1') }}</div></script>
    </head><body></body></html>`);
    const removed = removeTrackers($, PAGE_URL);
    expect(removed.map((r) => r.vendor)).toEqual(["Meta Pixel", "Google Analytics"]);
    expect($('script[type="text/template"]')).toHaveLength(1);
  });

  it("entende noscript já convertido em elementos (scripting desligado) sem duplicar", () => {
    const $ = cheerio.load(`<html><head></head><body>${GTM_NOSCRIPT}<p>fim</p></body></html>`, {
      scriptingEnabled: false,
    });
    const removed = removeTrackers($, PAGE_URL);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ vendor: "Google Tag Manager", kind: "noscript", pixelId: "GTM-ABC1234" });
    expect($("noscript, iframe")).toHaveLength(0);
  });

  it("remove chats e banners de cookies por URL e deixa os players", () => {
    const $ = cheerio.load(`<html><head>
      <script id="Cookiebot" src="https://consent.cookiebot.com/uc.js" data-cbid="12345678-1234-1234-1234-1234567890ab" data-blockingmode="auto" type="text/javascript"></script>
      <script src="https://cdn.cookielaw.org/scripttemplates/otSDKStub.js" type="text/javascript" charset="UTF-8" data-domain-script="01234567-89ab-cdef-0123-456789abcdef"></script>
      <script type="text/javascript">function OptanonWrapper() { }</script>
    </head><body>
      <script src="https://static.elfsight.com/platform/platform.js" async></script>
      <div class="elfsight-app-12345678-abcd-1234-abcd-1234567890ab" data-elfsight-app-lazy></div>
      <script src="https://unpkg.com/blip-chat-widget" type="text/javascript"></script>
      <script>${BLIP}</script>
      <script src="https://player.pandavideo.com.br/api.v2.js"></script>
      <script>${PANDA_SCRIPT}</script>
    </body></html>`);
    const removed = removeTrackers($, PAGE_URL);
    expect(removed.map((r) => [r.vendor, r.kind, r.pixelId])).toEqual([
      ["Banner de cookies (Cookiebot)", "script-src", "12345678-1234-1234-1234-1234567890ab"],
      ["Banner de cookies (OneTrust)", "script-src", "01234567-89ab-cdef-0123-456789abcdef"],
      ["Banner de cookies (OneTrust)", "script-inline", undefined],
      ["Blip (Take)", "script-src", undefined],
      ["Blip (Take)", "script-inline", undefined],
    ]);
    expect(removed.every((r) => r.location === (r.vendor.startsWith("Banner") ? "head" : "body"))).toBe(true);
    // Elfsight é plataforma de widgets visíveis (avaliações, contadores): fica.
    expect($("[class*='elfsight-app-']")).toHaveLength(1);
    expect($('script[src="https://static.elfsight.com/platform/platform.js"]')).toHaveLength(1);
    expect($('script[src="https://player.pandavideo.com.br/api.v2.js"]')).toHaveLength(1);
    expect($.html()).toContain("pandascripttag");
  });

  it("remove folhas de estilo e dicas de conexão de chats, mas não as do próprio site", () => {
    const $ = cheerio.load(`<html><head>
      <link rel="stylesheet" href="https://client.crisp.chat/static/stylesheets/client_default.css">
      <link rel="preconnect" href="https://embed.tawk.to" crossorigin>
      <link rel="stylesheet" href="/wp-content/plugins/creame-whatsapp-me/public/css/joinchat.min.css">
      <link rel="stylesheet" href="/wp-content/themes/tema/style.css">
      <link rel="icon" href="https://www.googletagmanager.com/favicon.ico">
    </head><body></body></html>`);
    const removed = removeTrackers($, PAGE_URL);
    expect(removed.map((r) => [r.vendor, r.kind])).toEqual([
      ["Crisp", "link"],
      ["Tawk.to", "link"],
      ["Joinchat (WhatsApp)", "link"],
    ]);
    expect(
      $("link")
        .map((_, el) => $(el).attr("href"))
        .get(),
    ).toEqual(["/wp-content/themes/tema/style.css", "https://www.googletagmanager.com/favicon.ico"]);
  });

  it("remove pixels 1x1 e iframes de rastreio fora de noscript", () => {
    const $ = cheerio.load(`<html><body>
      <img src="https://www.facebook.com/tr?id=1234567890123456&ev=Purchase" height="1" width="1">
      <iframe src="https://td.doubleclick.net/td/rul/987654321?random=1" width="0" height="0" style="display:none"></iframe>
      <img src="https://www.facebook.com/images/fb_icon.png" alt="Facebook">
    </body></html>`);
    const removed = removeTrackers($, PAGE_URL);
    expect(removed.map((r) => [r.vendor, r.kind, r.pixelId])).toEqual([
      ["Meta Pixel", "pixel", "1234567890123456"],
      ["Google Ads", "pixel", undefined],
    ]);
    expect($("img")).toHaveLength(1);
    expect($("iframe")).toHaveLength(0);
  });

  it("não mexe em página sem rastreadores", () => {
    const clean = `<html><head><title>Limpa</title><script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>${JSON_LD}</head><body><script>${COUNTDOWN}</script><script>${JQUERY_INIT}</script><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe></body></html>`;
    const $ = cheerio.load(clean);
    const before = $.html();
    expect(removeTrackers($, PAGE_URL)).toEqual([]);
    expect($.html()).toBe(before);
  });

  it("restos de widgets: opção desligada mantém; removeWidgetResidue lista os fornecedores", () => {
    const page = `<html class="js async-hide"><head><style id="_vis_opt_path_hides">body{opacity:0 !important}</style><style>.hero{color:red}</style></head><body><p>texto</p><jdiv><jdiv>chat</jdiv></jdiv><div id="CybotCookiebotDialog">cookies</div><div class="crisp-client"></div></body></html>`;
    const $keep = cheerio.load(page);
    expect(removeTrackers($keep, PAGE_URL, { residue: false })).toEqual([]);
    expect($keep("jdiv")).toHaveLength(2);
    expect($keep("html").hasClass("async-hide")).toBe(true);

    const $ = cheerio.load(page);
    expect(removeWidgetResidue($)).toEqual([
      "JivoChat",
      "Crisp",
      "VWO",
      "Banner de cookies (Cookiebot)",
      "Google Optimize",
    ]);
    expect($("jdiv, #CybotCookiebotDialog, .crisp-client, #_vis_opt_path_hides")).toHaveLength(0);
    expect($("html").attr("class")).toBe("js");
    expect($("style")).toHaveLength(1);
    expect($("p").text()).toBe("texto");
  });

  it("funciona sem URL da página", () => {
    const $ = cheerio.load(
      `<html><head><script src="/gtm.js?id=GTM-XYZ9876"></script><script>${CRISP}</script></head></html>`,
    );
    const removed = removeTrackers($, "");
    expect(removed.map((r) => r.vendor)).toEqual(["Crisp"]);
  });
});
