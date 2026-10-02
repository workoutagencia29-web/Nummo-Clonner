/**
 * Plataformas de checkout conhecidas (foco em ofertas brasileiras) e padrões
 * de texto/classe usados para reconhecer botões de compra.
 *
 * Só dados: a lógica de detecção fica em src/worker/clone/checkouts.ts.
 */

/** Nome usado quando o link parece checkout mas a plataforma não é reconhecida. */
export const UNKNOWN_CHECKOUT_PLATFORM = "Desconhecida";

/**
 * Regra de reconhecimento de um link de checkout. Todas as partes informadas
 * precisam casar. O host é comparado já em minúsculas e sem "www.".
 */
export interface CheckoutRule {
  /**
   * Texto exato ("pay.hotmart.com"), "*.dominio" (qualquer subdomínio, mas não
   * o domínio puro) ou RegExp testada no host inteiro. Ausente = qualquer host.
   */
  host?: string | RegExp;
  /** RegExp aplicada ao caminho (pathname, com a barra inicial). */
  path?: RegExp;
  /** RegExp aplicada à query string (sem o "?"). */
  query?: RegExp;
  /** Confiança 0–100 quando a regra casa (padrão: 100). */
  confidence?: number;
}

export interface CheckoutPlatform {
  /** Nome amigável mostrado ao usuário. */
  name: string;
  rules: CheckoutRule[];
  /** Parâmetros típicos dos links da plataforma (oferta, origem, afiliado…). */
  params?: string[];
}

/** Plataformas conhecidas. Em empate de confiança vence a que vem antes. */
export const CHECKOUT_PLATFORMS: CheckoutPlatform[] = [
  {
    name: "Hotmart",
    rules: [
      { host: "pay.hotmart.com" },
      { host: "go.hotmart.com" },
      { host: "sec.hotmart.com", path: /^\/payment/i },
      // Parâmetro exclusivo do checkout da Hotmart, mesmo em domínio próprio.
      { query: /(?:^|&)checkoutMode=/i, confidence: 70 },
    ],
    params: ["off", "checkoutMode", "src", "sck", "bid"],
  },
  {
    name: "Kiwify",
    rules: [{ host: "pay.kiwify.com.br" }, { host: "kiwify.app" }],
    params: ["afid", "src", "sck"],
  },
  {
    name: "Eduzz",
    rules: [{ host: "sun.eduzz.com" }, { host: "chk.eduzz.com" }],
    params: ["a", "src", "sck"],
  },
  {
    name: "Monetizze",
    rules: [{ host: "app.monetizze.com.br", path: /^\/(?:checkout|r)\//i }],
    params: ["src", "sck"],
  },
  {
    name: "Braip",
    rules: [{ host: "ev.braip.com" }, { host: "pay.braip.co" }],
    params: ["pv", "af", "src", "sck"],
  },
  {
    name: "Ticto",
    rules: [{ host: "checkout.ticto.app" }, { host: "payment.ticto.app" }],
    params: ["src", "sck"],
  },
  {
    name: "PerfectPay",
    rules: [{ host: "go.perfectpay.com.br" }, { host: "checkout.perfectpay.com.br" }],
    params: ["src", "sck"],
  },
  {
    name: "Cartpanda",
    rules: [{ host: "*.mycartpanda.com", path: /^\/checkout/i }],
  },
  {
    name: "Yampi",
    rules: [
      { host: "pay.yampi.com.br" },
      // Link de compra da Yampi no domínio da loja: seguro.<loja>/r/<token>.
      { host: /^seguro\./, path: /^\/r\/[\w-]+/i, confidence: 90 },
    ],
  },
  {
    name: "Kirvano",
    rules: [{ host: "pay.kirvano.com" }],
    params: ["src", "sck"],
  },
  {
    name: "Greenn",
    rules: [{ host: "payfast.greenn.com.br" }, { host: "pay.greenn.com.br" }],
    params: ["src", "sck"],
  },
  {
    name: "Lastlink",
    rules: [{ host: "lastlink.com", path: /^\/p\//i }],
  },
  {
    name: "Pagtrust",
    rules: [{ host: "checkout.pagtrust.com.br" }, { host: "p.pagtrust.com.br" }],
  },
  {
    name: "Payt",
    rules: [{ host: "checkout.payt.com.br" }],
  },
  {
    name: "Doppus",
    rules: [{ host: "checkout.doppus.app" }],
  },
  {
    name: "Hubla",
    rules: [{ host: "pay.hub.la" }],
  },
  {
    name: "Guru",
    rules: [
      { host: "clkdmg.site", path: /^\/pay\b/i },
      { host: "digitalmanager.guru", confidence: 95 },
      { host: "*.digitalmanager.guru", confidence: 95 },
    ],
  },
  {
    name: "Cakto",
    rules: [{ host: "pay.cakto.com.br" }],
  },
  {
    name: "Vega Checkout",
    rules: [{ host: /(?:^|\.)vegacheckout\./ }],
  },
  {
    name: "Appmax",
    rules: [
      { host: /(?:^|\.)appmax\.com\.br$/, path: /^\/(?:checkout|pagamento|pay)\b/i },
      // Subdomínios de loja; os institucionais ficam de fora.
      { host: /^(?!(?:blog|docs|ajuda|help|admin|app|status)\.)[a-z0-9-]+\.appmax\.com\.br$/, confidence: 80 },
    ],
  },
  {
    name: "Stripe",
    rules: [{ host: "buy.stripe.com" }, { host: "checkout.stripe.com" }],
    params: ["prefilled_email", "client_reference_id"],
  },
  {
    name: "Mercado Pago",
    rules: [
      { host: "mpago.la" },
      { host: "mpago.li" },
      { host: "link.mercadopago.com.br" },
      { host: /^mercadopago\.com(?:\.[a-z]{2})?$/, path: /^\/checkout/i },
    ],
  },
  {
    name: "PagBank",
    rules: [{ host: "pag.ae" }, { host: "pagseguro.uol.com.br" }, { host: "*.pagseguro.uol.com.br" }],
  },
  {
    name: "PayPal",
    rules: [
      { host: "paypal.me" },
      { host: "paypal.com", path: /^\/(?:checkoutnow|cgi-bin\/webscr|webapps\/(?:hermes|checkout)|ncp\/payment)/i },
    ],
  },
  {
    name: "ClickBank",
    rules: [
      { host: "pay.clickbank.net" },
      { host: "*.pay.clickbank.net" },
      { host: "hop.clickbank.net" },
      { host: "*.hop.clickbank.net" },
      { host: "orders.clickbank.net" },
    ],
    params: ["cbitems", "cbfid", "tid", "vtid"],
  },
  {
    name: "BuyGoods",
    rules: [{ host: "buygoods.com", path: /^\/secure\/checkout/i }],
    params: ["account_id", "product_codename", "subid", "subid2"],
  },
  {
    name: "Digistore24",
    rules: [
      { host: "checkout-ds24.com" },
      { host: "*.checkout-ds24.com" },
      { host: /^(?:[a-z0-9-]+\.)?digistore24\.com$/, path: /^\/product\//i },
    ],
    params: ["aff", "cam"],
  },
  {
    name: "Shopify",
    rules: [
      // Link permanente de carrinho: /cart/<variante>:<qtd>[,<variante>:<qtd>…]
      { path: /^\/cart\/\d+:\d+(?:,\d+:\d+)*\/?$/i, confidence: 85 },
      { path: /(?:^|\/)checkouts\/[^/]/i, confidence: 85 },
      { host: "*.myshopify.com", path: /^\/cart\/(?:add|\d)/i, confidence: 90 },
      { path: /^\/cart\/add\/?$/i, query: /(?:^|&)id=\d+/i, confidence: 70 },
    ],
    params: ["discount", "ref"],
  },
  {
    name: "WooCommerce",
    rules: [{ query: /(?:^|&)add-to-cart=\d+/i, confidence: 70 }],
  },
];

/** Padrões genéricos (confiança menor): a plataforma fica "Desconhecida". */
export const GENERIC_CHECKOUT_RULES: CheckoutRule[] = [
  { host: /^(?:checkout|checkouts|pay|payment|payments|pagamento|pagamentos|pagar|secure-checkout)\./, confidence: 60 },
  { host: /checkout/, confidence: 55 },
  { path: /(?:^|\/)(?:checkout|finalizar-compra|finalizar-pedido)(?:\/|\.[a-z]+$|$)/i, confidence: 50 },
];

/** Links de WhatsApp: são contato, nunca checkout. */
export const WHATSAPP_HOSTS: (string | RegExp)[] = [
  "wa.me",
  "api.whatsapp.com",
  "web.whatsapp.com",
  "chat.whatsapp.com",
  "wa.link",
  /(?:^|\.)whatsapp\.com$/,
];

/**
 * Domínios que nunca viram checkout pela heurística de texto (redes sociais,
 * selos de confiança, lojas de apps…). Plataformas conhecidas não são afetadas.
 */
export const NON_CHECKOUT_HOSTS: (string | RegExp)[] = [
  /(?:^|\.)(?:facebook|fb|instagram|youtube|tiktok|twitter|x|linkedin|pinterest|threads|spotify|vimeo)\.com$/,
  "youtu.be",
  "fb.me",
  "t.me",
  "telegram.me",
  /(?:^|\.)google\.[a-z.]+$/,
  "goo.gl",
  "maps.app.goo.gl",
  "apps.apple.com",
  /(?:^|\.)reclameaqui\.com\.br$/,
  /(?:^|\.)siteblindado\.com(?:\.br)?$/,
  /(?:^|\.)transparencyreport\.google\.com$/,
];

/**
 * Texto de botão de compra (aplicado ao texto já sem acentos e em minúsculas).
 * "garant(ir|a)" evita "garantia"; "compra" sozinho fica de fora ("compra segura").
 */
export const BUY_TEXT_RE =
  /\b(?:comprar|compre|comprei|quero|garant(?:ir|a)|adquir\w*|assin\w*|matricul\w*|inscrev\w*|pagar|finalizar|pedido|aproveit\w*|desbloque\w*|liberar acesso|acessar agora|carrinho|levar|kit|buy|order|get access|add to cart|checkout|purchase)\b/;

/** Textos que indicam que o link NÃO é de compra, mesmo com classe de botão. */
export const NOT_BUY_TEXT_RE =
  /\b(?:saiba mais|saber mais|leia mais|ver mais|contato|fale conosco|suporte|ajuda|login|entrar|politica|termos|privacidade|instagram|facebook|youtube|tiktok|telegram|whatsapp|blog|download|baixar)\b/;

/** Classes/ids de botão de chamada (CTA). */
export const CTA_CLASS_RE = /(?:^|[\s_-])(?:btn|button|botao|cta|buy|comprar|compra|checkout)(?:$|[\s_-])/i;

/** Classes/ids que por si só indicam compra (sem depender do texto). */
export const STRONG_BUY_CLASS_RE = /(?:^|[\s_-])(?:buy|comprar|compra|checkout|purchase)(?:$|[\s_-])/i;

/** Extensões de arquivo estático: nunca são checkout (ex.: widget .js da plataforma). */
export const STATIC_ASSET_RE =
  /\.(?:m?js|css|map|json|xml|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mov|m3u8|ts|mp3|wav|ogg|pdf|zip)$/i;
