/**
 * Assinaturas de rastreadores (pixels, analytics, tag managers), chats e
 * banners de cookies, com foco em páginas de oferta brasileiras.
 *
 * Só dados: a lógica fica em src/worker/clone/trackers.ts, que usa esta lista
 * primeiro e o pacote `third-party-web` como base para o resto da internet.
 */
import type { TrackerCategory, TrackerMatch } from "@/worker/clone/types";

/** Regra de URL. Todas as partes informadas precisam casar. */
export interface TrackerUrlRule {
  /** Testada no hostname (minúsculo, sem porta). Ausente = qualquer host. */
  host?: RegExp;
  /** Testada em `pathname + search` (ex.: "/tr?id=123&ev=PageView"). */
  path?: RegExp;
}

export interface TrackerSignature extends TrackerMatch {
  /** URLs de scripts, pixels e endpoints do fornecedor. */
  urls?: readonly TrackerUrlRule[];
  /** Padrões "fortes" no código inline (código-base, carregador): bastam sozinhos. */
  inline?: readonly RegExp[];
  /**
   * Início de chamadas soltas (ex.: `fbq('track', …)`). Só contam quando o
   * script inteiro é feito dessas chamadas; misturadas com outro código, o
   * script fica (removê-lo quebraria botões e redirecionamentos).
   */
  calls?: readonly RegExp[];
  /** Onde achar o ID do pixel/conta (1º grupo de captura). Testados em URLs e código. */
  ids?: readonly RegExp[];
}

/** Casa o domínio e todos os subdomínios. */
function domains(...list: string[]): RegExp {
  return new RegExp(`(?:^|\\.)(?:${list.map(escapeHost).join("|")})$`, "i");
}

/** Casa só os hosts exatos. */
function exact(...list: string[]): RegExp {
  return new RegExp(`^(?:${list.map(escapeHost).join("|")})$`, "i");
}

function escapeHost(host: string): string {
  return host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** IDs do ecossistema Google (GTM-, G-, AW-, UA-, GT-, DC-). */
const GOOGLE_IDS = [
  /\b(GTM-[A-Z0-9]{4,12}|G-[A-Z0-9]{6,14}|AW-\d{6,14}|UA-\d{4,12}-\d{1,4}|GT-[A-Z0-9]{6,14}|DC-\d{6,14})\b/,
];

/** Vendors do gtag.js: o nome final depende do primeiro ID configurado no script. */
export const GTAG_FAMILY = {
  analytics: "Google Analytics",
  ads: "Google Ads",
  tag: "Google Tag (gtag.js)",
} as const;

/**
 * Assinaturas próprias. A ordem importa: a primeira que casar vence (ex.: o
 * GA vem antes do Google Ads para `stats.g.doubleclick.net`).
 */
export const TRACKER_SIGNATURES: readonly TrackerSignature[] = [
  // ─── Pixels ────────────────────────────────────────────────────────────────
  {
    vendor: "Meta Pixel",
    category: "PIXEL",
    urls: [
      { host: exact("connect.facebook.net") },
      { host: domains("facebook.com"), path: /^\/tr\/?(?:[?#]|$)/i },
      { host: domains("facebook.com"), path: /^\/privacy_sandbox\/pixel\//i },
      { path: /\/wp-content\/plugins\/official-facebook-pixel\//i },
    ],
    inline: [
      /\bfbq\s*\(\s*['"](?:init|set|consent|dataProcessingOptions)['"]/,
      /\b_fbq\b/,
      /connect\.facebook\.net\/[\w-]+\/fbevents/,
      /\bfbevents\.js\b/,
    ],
    calls: [/\bfbq\s*\(/],
    ids: [
      /\bfbq\s*\(\s*['"]init['"]\s*,\s*['"]?(\d{6,20})/,
      /facebook\.com\/tr\/?\?(?:[^"'\s<>]*?&)?id=(\d{6,20})/,
      /\/signals\/config\/(\d{6,20})/,
      /["']pixelIds?["']\s*:\s*\[?\s*["'](\d{6,20})/,
    ],
  },
  {
    vendor: "PixelYourSite",
    category: "PIXEL",
    urls: [{ path: /\/wp-content\/plugins\/pixelyoursite(?:-pro)?\//i }],
    inline: [/\bpysOptions\b/],
    ids: [/["']pixelIds["']\s*:\s*\[\s*["'](\d{6,20})/],
  },
  {
    vendor: "TikTok Pixel",
    category: "PIXEL",
    urls: [{ host: /^analytics[\w-]*\.tiktokw?\.(?:com|us)$/i }],
    inline: [/\bTiktokAnalyticsObject\b/, /\bttq\.load\s*\(/, /analytics\.tiktok\.com/],
    calls: [/\bttq\.\w+\s*\(/],
    ids: [/\bttq\.load\s*\(\s*['"]([A-Z0-9]{10,30})['"]/i, /[?&]sdkid=([A-Z0-9]{10,30})/i],
  },
  {
    vendor: "Kwai Pixel",
    category: "PIXEL",
    urls: [
      { host: exact("s1.kwai.net") },
      { host: domains("kwai.net", "kwai.com", "kwai-pro.com"), path: /pixel/i },
      { path: /\/kos\/[\w/.-]*\/pixel\/events\.js/i },
    ],
    inline: [
      /\bkwaiq\.load\s*\(/,
      /\bKwaiAnalyticsObject\b/,
      // Carregador UMD do código-base do Kwai (define window.install).
      /exports\.install\s*=\s*\w+\(\)\s*:\s*\w+\.install\s*=\s*\w+\(\)/,
    ],
    calls: [/\bkwaiq\.\w+\s*\(/],
    ids: [
      /\bkwaiq\.load\s*\(\s*['"]([\w-]{6,40})['"]/,
      /\bkwaiq\.instance\s*\(\s*['"]([\w-]{6,40})['"]/,
      /[?&]sdkid=([\w-]{6,40})/,
    ],
  },
  {
    vendor: "UTMify",
    category: "PIXEL",
    urls: [{ host: domains("utmify.com.br", "utmify.com") }],
    inline: [/\butmify\b/i, /\bwindow\.pixelId\s*=/, /\bwindow\.(?:google|tiktok|kwai|pinterest)PixelId\s*=/],
    ids: [
      /\bwindow\.pixelId\s*=\s*['"]([\w-]{4,64})['"]/,
      /\bwindow\.(?:google|tiktok|kwai|pinterest)PixelId\s*=\s*['"]([\w-]{4,64})['"]/,
    ],
  },

  // ─── Google ────────────────────────────────────────────────────────────────
  {
    vendor: GTAG_FAMILY.analytics,
    category: "ANALYTICS",
    urls: [
      { host: domains("google-analytics.com", "analytics.google.com") },
      { host: exact("stats.g.doubleclick.net") },
      { host: domains("googletagmanager.com"), path: /^\/gtag\/js\?(?:[^#]*&)?id=(?:G|UA)-/i },
      { path: /\/gtag\/js\?(?:[^#]*&)?id=(?:G|UA)-/i },
    ],
    inline: [
      /google-analytics\.com\/(?:analytics|ga|urchin)\.js/,
      /\bGoogleAnalyticsObject\b/,
      /\bga\s*\(\s*['"]create['"]/,
    ],
    calls: [/\bga\s*\(\s*['"](?:send|set|require|create)['"]/],
    ids: GOOGLE_IDS,
  },
  {
    vendor: GTAG_FAMILY.ads,
    category: "ADS",
    urls: [
      { host: domains("googleadservices.com", "doubleclick.net") },
      { host: /^adservice\.google\.[a-z.]+$/i },
      { host: domains("googletagmanager.com"), path: /^\/gtag\/js\?(?:[^#]*&)?id=(?:AW|DC)-/i },
      { host: /(?:^|\.)google\.com(?:\.[a-z]{2})?$/i, path: /^\/(?:pagead\/|ads\/|ccm\/)/i },
      { path: /\/gtag\/js\?(?:[^#]*&)?id=(?:AW|DC)-/i },
    ],
    inline: [/\bgoogle_conversion_id\b/, /googleadservices\.com\/pagead\/conversion/],
    ids: GOOGLE_IDS,
  },
  {
    vendor: "Google AdSense",
    category: "ADS",
    urls: [{ host: domains("googlesyndication.com", "googletagservices.com", "adtrafficquality.google") }],
    inline: [/\badsbygoogle\b/],
    ids: [/\b(ca-pub-\d{10,20})\b/],
  },
  {
    vendor: GTAG_FAMILY.tag,
    category: "TAG_MANAGER",
    urls: [{ host: domains("googletagmanager.com"), path: /^\/gtag\//i }, { path: /\/gtag\/js\?(?:[^#]*&)?id=GT-/i }],
    inline: [/\bgtag\s*\(\s*['"](?:js|config|consent|set)['"]/],
    calls: [/\bgtag\s*\(/],
    ids: GOOGLE_IDS,
  },
  {
    vendor: "Google Tag Manager",
    category: "TAG_MANAGER",
    urls: [
      { host: domains("googletagmanager.com") },
      { path: /\/gtm\.js\?(?:[^#]*&)?id=GTM-/i },
      { path: /\/wp-content\/plugins\/duracelltomi-google-tag-manager\//i },
    ],
    inline: [/['"]gtm\.start['"]/, /googletagmanager\.com\/(?:gtm\.js|ns\.html)/, /\bgtm4wp_\w+/],
    calls: [/\bdataLayer\.push\s*\(/],
    ids: GOOGLE_IDS,
  },
  {
    vendor: "Google Optimize",
    category: "ANALYTICS",
    urls: [{ host: domains("googleoptimize.com") }],
    // Snippet "anti-flicker": esconde a página por até 4 s esperando o Optimize.
    inline: [/['"]async-hide['"]/],
    ids: GOOGLE_IDS,
  },

  // ─── Analytics e mapas de calor ────────────────────────────────────────────
  {
    vendor: "Hotjar",
    category: "ANALYTICS",
    urls: [{ host: domains("hotjar.com", "hotjar.io") }],
    inline: [/\b_hjSettings\b/, /static\.hotjar\.com/],
    calls: [/\bhj\s*\(\s*['"]/],
    ids: [/\bhjid\s*:\s*(\d{4,12})/, /hotjar-(\d{4,12})\.js/],
  },
  {
    vendor: "Microsoft Clarity",
    category: "ANALYTICS",
    urls: [{ host: domains("clarity.ms") }],
    inline: [/["']clarity["']\s*,\s*["']script["']/, /clarity\.ms\/tag/],
    calls: [/\bclarity\s*\(\s*['"]/],
    ids: [
      /["']clarity["']\s*,\s*["']script["']\s*,\s*["']([a-z0-9]{6,20})["']/i,
      /clarity\.ms\/tag\/([a-z0-9]{6,20})/i,
    ],
  },
  {
    vendor: "Yandex Metrica",
    category: "ANALYTICS",
    urls: [{ host: /^mc\.yandex\.[a-z.]+$/i }],
    inline: [/mc\.yandex\.[a-z.]+\/metrika/, /\bym\s*\(\s*\d{4,}\s*,\s*['"]init['"]/],
    calls: [/\bym\s*\(\s*\d{4,}\s*,/],
    ids: [/\bym\s*\(\s*(\d{4,14})\s*,/, /mc\.yandex\.[a-z.]+\/watch\/(\d{4,14})/],
  },
  {
    vendor: "Cloudflare Web Analytics",
    category: "ANALYTICS",
    urls: [{ host: domains("cloudflareinsights.com") }],
    ids: [/["']token["']\s*:\s*["']([0-9a-f]{20,40})["']/i],
  },
  {
    vendor: "ActiveCampaign",
    category: "ANALYTICS",
    urls: [{ host: domains("trackcmp.net") }, { host: /^prism\.app-us\d+\.com$/i }],
    inline: [/trackcmp\.net/, /\bvgo\s*\(\s*['"]setAccount['"]/],
    calls: [/\bvgo\s*\(\s*['"]/],
    ids: [/\bvgo\s*\(\s*['"]setAccount['"]\s*,\s*['"](\d{4,14})['"]/],
  },

  // ─── Redes de anúncio e pixels de outras plataformas ──────────────────────
  {
    vendor: "Taboola",
    category: "ADS",
    urls: [{ host: domains("taboola.com", "taboolasyndication.com") }],
    inline: [/\b_tfa\s*=/, /cdn\.taboola\.com/, /\btb_tfa_script\b/],
    calls: [/\b_tfa\.push\s*\(/],
    ids: [/\/unip\/(\d{4,12})\//, /\b_tfa\.push\s*\(\s*\{[^}]*?\bid\s*:\s*['"]?(\d{4,12})/],
  },
  {
    vendor: "Outbrain",
    category: "ADS",
    urls: [{ host: domains("outbrain.com", "outbrainimg.com") }],
    inline: [/\bOB_ADV_ID\b/, /amplify\.outbrain\.com/, /\bobApi\.version\b/],
    calls: [/\bobApi\s*\(/],
    ids: [/\bOB_ADV_ID\s*=\s*['"]([0-9a-f]{16,40})['"]/i],
  },
  {
    vendor: "Pinterest Tag",
    category: "PIXEL",
    urls: [{ host: exact("ct.pinterest.com") }, { host: domains("pinimg.com"), path: /^\/ct\//i }],
    inline: [/\bpintrk\s*\(\s*['"]load['"]/, /s\.pinimg\.com\/ct\//],
    calls: [/\bpintrk\s*\(/],
    ids: [/\bpintrk\s*\(\s*['"]load['"]\s*,\s*['"]?(\d{6,20})/, /[?&]tid=(\d{6,20})/],
  },
  {
    vendor: "Snap Pixel",
    category: "PIXEL",
    urls: [
      { host: exact("tr.snapchat.com", "tr-shadow.snapchat.com") },
      { host: domains("sc-static.net"), path: /scevent/i },
    ],
    inline: [/\bsnaptr\s*\(\s*['"]init['"]/, /sc-static\.net\/scevent/],
    calls: [/\bsnaptr\s*\(/],
    ids: [/\bsnaptr\s*\(\s*['"]init['"]\s*,\s*['"]([0-9a-f-]{20,40})['"]/i],
  },
  {
    vendor: "LinkedIn Insight Tag",
    category: "PIXEL",
    urls: [{ host: exact("snap.licdn.com", "px.ads.linkedin.com", "dc.ads.linkedin.com") }],
    inline: [/\b_linkedin_partner_id\b/, /\b_linkedin_data_partner_ids\b/, /snap\.licdn\.com/],
    calls: [/\blintrk\s*\(/],
    ids: [/\b_linkedin_partner_id\s*=\s*['"]?(\d{4,12})/, /[?&]pid=(\d{4,12})/],
  },
  {
    vendor: "X (Twitter) Pixel",
    category: "PIXEL",
    urls: [
      { host: domains("ads-twitter.com") },
      { host: exact("analytics.twitter.com") },
      { host: exact("t.co"), path: /^\/(?:i\/)?adsct/i },
    ],
    inline: [/\btwq\s*\(\s*['"](?:init|config)['"]/, /static\.ads-twitter\.com/],
    calls: [/\btwq\s*\(/],
    ids: [/\btwq\s*\(\s*['"](?:init|config)['"]\s*,\s*['"]([a-z0-9]{4,12})['"]/i],
  },
  {
    vendor: "Reddit Pixel",
    category: "PIXEL",
    urls: [{ host: domains("redditstatic.com"), path: /^\/ads\//i }, { host: exact("alb.reddit.com") }],
    inline: [/\brdt\s*\(\s*['"]init['"]/, /redditstatic\.com\/ads\/pixel\.js/],
    calls: [/\brdt\s*\(/],
    ids: [/\brdt\s*\(\s*['"]init['"]\s*,\s*['"]([\w-]{4,40})['"]/],
  },
  {
    vendor: "Microsoft Ads (Bing UET)",
    category: "ADS",
    urls: [{ host: exact("bat.bing.com", "bat.bing.net", "bat.r.msn.com") }],
    inline: [/bat\.bing\.com/, /\bnew\s+UET\s*\(/],
    calls: [/\buetq\.push\s*\(/],
    ids: [/\bti\s*:\s*['"]?(\d{4,12})/, /[?&]ti=(\d{4,12})/],
  },

  // ─── Chats e widgets de atendimento ────────────────────────────────────────
  {
    vendor: "JivoChat",
    category: "CHAT",
    urls: [{ host: domains("jivosite.com", "jivosite.ru", "jivo.ru", "jivo.chat") }],
    inline: [
      /\bjivo_(?:api|onLoadCallback|onOpen|onClose|onChangeState|config|init|destroy|cookie_get|cookie_set)\b/,
      /jivosite\.com/,
    ],
    ids: [/jivosite\.com\/(?:script\/)?widget\/([\w-]{4,40})/],
  },
  {
    vendor: "Tawk.to",
    category: "CHAT",
    urls: [{ host: domains("tawk.to") }],
    inline: [/\bTawk_API\b/, /\bTawk_LoadStart\b/, /embed\.tawk\.to/],
    ids: [/embed\.tawk\.to\/([0-9a-f]{16,40}(?:\/[\w-]+)?)/i],
  },
  {
    vendor: "Zendesk",
    category: "CHAT",
    urls: [{ host: domains("zdassets.com", "zopim.com", "zopim.io") }],
    inline: [/\bzESettings\b/, /\bzE\s*\(\s*['"](?:webWidget|messenger)/, /static\.zdassets\.com/, /\$zopim\b/],
    ids: [/snippet\.js\?key=([0-9a-f-]{20,40})/i],
  },
  {
    vendor: "Intercom",
    category: "CHAT",
    urls: [{ host: domains("intercom.io", "intercomcdn.com", "intercomassets.com") }],
    inline: [
      /\bintercomSettings\b/,
      /widget\.intercom\.io/,
      /\bIntercom\s*\(\s*['"](?:boot|update|shutdown|show|reattach_activator|trackEvent)['"]/,
    ],
    ids: [/\bapp_id\s*:\s*['"]([a-z0-9]{6,12})['"]/i, /widget\.intercom\.io\/widget\/([a-z0-9]{6,12})/i],
  },
  {
    vendor: "Crisp",
    category: "CHAT",
    urls: [{ host: domains("crisp.chat") }],
    inline: [/\$crisp\b/, /\bCRISP_WEBSITE_ID\b/, /client\.crisp\.chat/],
    ids: [/\bCRISP_WEBSITE_ID\s*=\s*['"]([0-9a-f-]{20,40})['"]/i],
  },
  {
    vendor: "HubSpot",
    category: "CHAT",
    urls: [
      {
        host: domains(
          "hs-scripts.com",
          "usemessages.com",
          "hs-analytics.net",
          "hs-banner.com",
          "hscollectedforms.net",
          "hsleadflows.net",
          "hsadspixel.net",
        ),
      },
      { host: exact("track.hubspot.com") },
    ],
    inline: [/\b_hsq\b/, /hs-script-loader/, /js\.hs-scripts\.com/],
    calls: [/\b_hsq\.push\s*\(/],
    ids: [/hs-scripts\.com\/(\d{4,12})\.js/, /hs-analytics\.net\/analytics\/\d+\/(\d{4,12})\.js/],
  },
  {
    vendor: "RD Station",
    category: "CHAT",
    urls: [{ host: exact("d335luupugsy2.cloudfront.net"), path: /^\/js\/loader-scripts\//i }],
    // "RDStationForms" (formulário visível) não casa: \b exige o fim da palavra.
    inline: [/\bRDStation\b/, /d335luupugsy2\.cloudfront\.net\/js\/loader-scripts/],
    ids: [/loader-scripts\/([0-9a-f-]{20,40})-loader\.js/i],
  },
  {
    vendor: "Manychat",
    category: "CHAT",
    urls: [{ host: exact("widget.manychat.com") }, { host: domains("mccdn.me") }],
    inline: [/widget\.manychat\.com/, /\bmcwidget\b/],
    ids: [/widget\.manychat\.com\/(\d{4,20})\.js/],
  },
  {
    vendor: "Tidio",
    category: "CHAT",
    urls: [{ host: domains("tidio.co", "tidiochat.com") }],
    inline: [/\btidioChatApi\b/, /code\.tidio\.co/, /\btidioIdentify\b/],
    ids: [/code\.tidio\.co\/([a-z0-9]{10,40})\.js/i],
  },
  {
    vendor: "Octadesk",
    category: "CHAT",
    urls: [{ host: domains("octadesk.services", "octadesk.com") }],
    inline: [/\b\w+\.octadesk\s*=/, /octadesk\.services/, /\boctadesk\.chat\./],
  },
  {
    vendor: "Chatwoot",
    category: "CHAT",
    urls: [{ host: domains("chatwoot.com") }, { path: /\/packs\/js\/sdk\.js(?:$|\?)/i }],
    inline: [/\bchatwootSDK\b/, /\bchatwootSettings\b/],
    ids: [/\bwebsiteToken\s*:\s*['"]([\w-]{10,40})['"]/],
  },
  {
    vendor: "GetButton (WhatsApp)",
    category: "CHAT",
    urls: [{ host: domains("getbutton.io") }],
    inline: [/getbutton\.io/, /\bWhWidgetSendButton\b/],
  },
  {
    vendor: "Blip (Take)",
    category: "CHAT",
    urls: [
      { host: domains("unpkg.com", "jsdelivr.net"), path: /blip-chat-widget/i },
      { host: domains("blip.ai", "take.net") },
    ],
    inline: [/\bBlipChat\b/, /blip-chat-widget/],
  },
  {
    vendor: "Joinchat (WhatsApp)",
    category: "CHAT",
    urls: [{ path: /\/wp-content\/plugins\/creame-whatsapp-me\//i }],
    inline: [/\bjoinchat_obj\b/],
  },
  {
    vendor: "Click to Chat (WhatsApp)",
    category: "CHAT",
    urls: [{ path: /\/wp-content\/plugins\/click-to-chat-for-whatsapp\//i }],
    inline: [/\bht_ctc_chat_var\b/],
  },

  // ─── Banners de cookies do site original ───────────────────────────────────
  {
    vendor: "Banner de cookies (Cookiebot)",
    category: "OTHER",
    urls: [{ host: domains("cookiebot.com", "cookiebot.eu") }],
    ids: [/data-cbid=["']([0-9a-f-]{36})["']/i],
  },
  {
    vendor: "Banner de cookies (OneTrust)",
    category: "OTHER",
    urls: [{ host: domains("cookielaw.org", "onetrust.com", "cookiepro.com") }],
    inline: [/function\s+OptanonWrapper\s*\(\s*\)\s*\{\s*\}/],
    ids: [/data-domain-script=["']([0-9a-f-]{36}(?:-test)?)["']/i],
  },
  {
    vendor: "Banner de cookies (CookieYes)",
    category: "OTHER",
    urls: [
      { host: domains("cookieyes.com", "cdn-cookieyes.com") },
      { path: /\/wp-content\/plugins\/cookie-law-info\//i },
    ],
    ids: [/client_data\/([0-9a-f]{16,40})\//i],
  },
  {
    vendor: "Banner de cookies (Usercentrics)",
    category: "OTHER",
    urls: [{ host: domains("usercentrics.eu", "usercentrics.com") }],
    ids: [/data-settings-id=["']([\w-]{6,40})["']/i],
  },
  {
    vendor: "Banner de cookies (AdOpt)",
    category: "OTHER",
    urls: [{ host: domains("goadopt.io") }],
  },
  {
    vendor: "Banner de cookies (Complianz)",
    category: "OTHER",
    urls: [{ path: /\/wp-content\/plugins\/complianz-gdpr(?:-premium)?\//i }],
    inline: [/\bvar\s+complianz\s*=\s*\{/],
  },
];

/**
 * Nunca são rastreadores, mesmo que alguma lista diga o contrário: players de
 * vídeo (VSL), fontes, CDNs de bibliotecas, pagamentos e checkouts.
 * Regras com `path` valem antes de todas as outras; as só de host valem antes
 * das regras só de host/caminho das assinaturas (ex.: o Blip no unpkg continua
 * sendo chat, mas o resto do unpkg é liberado).
 */
export const SAFE_URLS: readonly TrackerUrlRule[] = [
  // SDK social do Facebook (comentários, curtir): não é o pixel.
  { host: exact("connect.facebook.net"), path: /^\/[\w-]+\/(?:sdk|all)(?:\/debug)?\.js/i },
  // Formulários do RD Station (conteúdo visível da página).
  { host: exact("d335luupugsy2.cloudfront.net"), path: /^\/js\/rdstation-forms\//i },
  // Imagens e arquivos das landing pages do RD Station (o rastreador é só /js/loader-scripts/).
  { host: exact("d335luupugsy2.cloudfront.net"), path: /^\/cms\//i },
  { host: /(?:^|\.)google\.com(?:\.[a-z]{2})?$/i, path: /^\/recaptcha\//i },
  // Vídeo.
  { host: domains("youtube.com", "youtube-nocookie.com", "ytimg.com", "googlevideo.com", "youtu.be") },
  { host: domains("vimeo.com", "vimeocdn.com") },
  { host: domains("converteai.net", "vturb.com.br", "vturb.com", "vturb.net") },
  { host: domains("pandavideo.com.br", "pandavideo.com") },
  { host: domains("wistia.com", "wistia.net", "wi.st", "vidalytics.com") },
  { host: domains("jwplayer.com", "jwplatform.com", "jwpcdn.com", "mediadelivery.net") },
  // Fontes e CDNs de bibliotecas.
  { host: exact("fonts.googleapis.com", "ajax.googleapis.com") },
  { host: domains("gstatic.com", "typekit.net", "fontawesome.com", "bootstrapcdn.com") },
  { host: domains("jquery.com", "cdnjs.cloudflare.com", "jsdelivr.net", "unpkg.com") },
  { host: domains("recaptcha.net", "hcaptcha.com", "challenges.cloudflare.com") },
  // Pagamentos e checkouts.
  { host: domains("stripe.com", "stripe.network", "stripecdn.com", "paypal.com", "paypalobjects.com") },
  { host: domains("hotmart.com", "hotmart.com.br", "kiwify.com.br", "kiwify.com", "kiwify.app") },
  { host: domains("eduzz.com", "monetizze.com.br", "braip.com", "greenn.com.br", "perfectpay.com.br", "ticto.com.br") },
  { host: domains("pagar.me", "mercadopago.com", "mercadopago.com.br", "mercadolibre.com", "pagseguro.uol.com.br") },
];

// ─── third-party-web ─────────────────────────────────────────────────────────

/** Categorias do third-party-web tratadas como rastreador/chat, e a nossa categoria. */
export const TPW_CATEGORIES: Readonly<Record<string, TrackerCategory>> = {
  ad: "ADS",
  analytics: "ANALYTICS",
  "tag-manager": "TAG_MANAGER",
  "customer-success": "CHAT",
  marketing: "OTHER",
  "consent-provider": "OTHER",
};

/**
 * Entidades do third-party-web que NÃO devem ser tratadas como rastreador:
 * domínios amplos demais (microsoft.com, apple.com, licdn.com…), hospedagem de
 * páginas/lojas, players de vídeo e widgets de conteúdo (avaliações).
 */
export const TPW_EXCLUDED: ReadonlySet<string> = new Set([
  "Bing Ads",
  "LinkedIn Ads",
  "Auto Link Maker",
  "Unbounce",
  "Hubspot",
  "Tray Commerce",
  "Bigcommerce",
  "HP Optimost",
  "Microsoft XBox Live",
  "Amplience",
  "Wishpond Technologies",
  "Tealium",
  "LongTail Ad Solutions",
  "Yotpo",
  "Judge.me",
  "Trust Pilot",
  "PowerReviews",
  "Net Reviews",
  "Webcollage",
  "Foursixty",
  "AOL / Oath / Verizon Media",
  "Guardian Media",
  "Radar",
  "ABA RESEARCH",
  // Hospeda imagens das landing pages feitas nele (multimedia.getresponse.com).
  "GetResponse",
]);

/** Nomes amigáveis (e categoria corrigida) para entidades do third-party-web. */
export const TPW_OVERRIDES: Readonly<Record<string, Partial<TrackerMatch>>> = {
  "Google/Doubleclick Ads": { vendor: "Google Ads" },
  "Twitter Online Conversion Tracking": { vendor: "X (Twitter) Pixel", category: "PIXEL" },
  Snapchat: { vendor: "Snap Pixel", category: "PIXEL" },
  Jivochat: { vendor: "JivoChat" },
  ZenDesk: { vendor: "Zendesk" },
  Zopim: { vendor: "Zendesk" },
  "Tidio Live Chat": { vendor: "Tidio" },
  Drift: { category: "CHAT" },
  "Tiledesk Live Chat": { vendor: "Tiledesk" },
  Optanon: { vendor: "OneTrust" },
  "WordPress Site Stats": { vendor: "Estatísticas do WordPress (Jetpack)" },
};

// ─── Outras marcas que ficam no HTML ─────────────────────────────────────────

/** `<meta name>` de verificação de domínio do site original. */
export const VERIFICATION_METAS: readonly { name: string; vendor: string }[] = [
  { name: "facebook-domain-verification", vendor: "Verificação de domínio (Meta)" },
  { name: "google-site-verification", vendor: "Verificação de domínio (Google)" },
  { name: "p:domain_verify", vendor: "Verificação de domínio (Pinterest)" },
  { name: "msvalidate.01", vendor: "Verificação de domínio (Bing)" },
  { name: "yandex-verification", vendor: "Verificação de domínio (Yandex)" },
];

/**
 * Restos que chats e banners de cookies deixam no DOM renderizado (balão do
 * chat, banner já desenhado). Sem o script eles ficam mortos na página.
 * Seletores específicos de cada fornecedor.
 */
export const WIDGET_RESIDUE: readonly { vendor: string; selector: string }[] = [
  { vendor: "JivoChat", selector: "jdiv, #jivo-iframe-container, #jivo_custom_widget, #jcont" },
  { vendor: "Tawk.to", selector: "iframe[title='chat widget'], #tawkchat-container, #tawkchat-minified-wrapper" },
  { vendor: "Crisp", selector: "#crisp-chatbox, .crisp-client" },
  {
    vendor: "Intercom",
    selector: "#intercom-container, #intercom-frame, #intercom-css-container, .intercom-lightweight-app, .intercom-app",
  },
  { vendor: "Zendesk", selector: "iframe#launcher, iframe#webWidget, div[data-product='web_widget']" },
  { vendor: "HubSpot", selector: "#hubspot-messages-iframe-container, #hs-eu-cookie-confirmation" },
  { vendor: "Tidio", selector: "#tidio-chat, #tidio-chat-iframe, #tidio-chat-code" },
  { vendor: "Chatwoot", selector: ".woot-widget-holder, .woot--bubble-holder, #cw-widget-holder, #cw-bubble-holder" },
  { vendor: "Blip (Take)", selector: "#blip-chat-container, #blip-chat-open-iframe" },
  { vendor: "Octadesk", selector: "[id^='octadesk-']" },
  { vendor: "Manychat", selector: ".mcwidget-embed" },
  { vendor: "GetButton (WhatsApp)", selector: "[id^='gb-widget-']" },
  { vendor: "Joinchat (WhatsApp)", selector: ".joinchat" },
  { vendor: "Click to Chat (WhatsApp)", selector: ".ht-ctc" },
  { vendor: "Hotjar", selector: "[id^='_hjSafeContext'], [id^='_hjRemoteVarsFrame'], #_hj_feedback_container" },
  { vendor: "Google AdSense", selector: "ins.adsbygoogle" },
  // Estilo "anti-flicker" do VWO: deixa a página invisível até o script carregar.
  { vendor: "VWO", selector: "style#_vis_opt_path_hides" },
  {
    vendor: "Banner de cookies (Cookiebot)",
    selector: "#CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay, #CookiebotWidget",
  },
  { vendor: "Banner de cookies (OneTrust)", selector: "#onetrust-consent-sdk" },
  {
    vendor: "Banner de cookies (CookieYes)",
    selector:
      ".cky-consent-container, .cky-overlay, .cky-modal, .cky-btn-revisit-wrapper, #cookie-law-info-bar, #cookie-law-info-again",
  },
  { vendor: "Banner de cookies (Usercentrics)", selector: "#usercentrics-root, #usercentrics-cmp-ui" },
  {
    vendor: "Banner de cookies (Complianz)",
    selector: "#cmplz-cookiebanner-container, .cmplz-cookiebanner, #cmplz-manage-consent",
  },
];

/**
 * Variáveis de fila dos rastreadores (`window.dataLayer = window.dataLayer || []`).
 * Usadas para decidir se um script inline é "só rastreamento".
 */
export const TRACKER_QUEUE_GLOBALS: readonly string[] = [
  "dataLayer",
  "_tfa",
  "uetq",
  "_hsq",
  "_paq",
  "_fbq",
  "ttq",
  "kwaiq",
  "twq",
  "snaptr",
  "pintrk",
  "lintrk",
  "_linkedin_data_partner_ids",
  "obApi",
  "rdt",
  "adsbygoogle",
];
