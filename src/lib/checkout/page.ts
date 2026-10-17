/**
 * Página de checkout do Offer Studio (HTML próprio, não GrapesJS): o JSON
 * público #os-checkout (PublicCheckoutConfig, ./contract.ts) e a página
 * desenhada no servidor — topo (cronômetro, banner, logo), "Resumo do pedido"
 * (à direita no computador, no topo no celular), "1. Seus dados", "2.
 * Entrega" (só com o endereço ligado), order bumps ("Aproveite também"), "3.
 * Pagamento", selos e depoimentos. O script do checkout (src/runtime/checkout,
 * à parte) liga a validação, as máscaras, o CEP, o total ao vivo e o
 * pagamento; sem ele a página mostra tudo, mas não paga.
 *
 * Função pura (sem banco): a prévia e o ZIP montam a mesma página — quem
 * chama passa o endpoint, os endereços das imagens e da página de obrigado.
 * Nada secreto entra aqui: nunca a chave da API nem os links de acesso.
 */
import { scriptString } from "@/lib/export/head";
import type { PaymentLocaleId } from "@/lib/payments/rules";
import { type RuntimeRule, TRACKING_CONFIG_ID, type TrackingRuntimeConfig } from "@/lib/tracking/runtime-config";
import { darkOnWhite, textOnColor } from "./colors";
import { type CheckoutConfig, defaultShipping } from "./config";
import {
  CHECKOUT_CONFIG_ID,
  CHECKOUT_CONFIG_VERSION,
  CHECKOUT_VERSION_PARAM,
  CHECKOUT_VERSION_RE,
  type CheckoutPayMethod,
  PREVIEW_CHECKOUT_PREFIX,
  type PublicCheckoutConfig,
} from "./contract";
import { BR_STATES } from "./fields";
import {
  addressAllowed,
  askedBuyerFields,
  type CheckoutCurrencyId,
  type CheckoutMethodId,
  type CheckoutProviderId,
  checkoutMethodAllows,
  isPixProvider,
} from "./rules";
import {
  CHECKOUT_EDITABLE_TEXTS,
  type CheckoutLang,
  checkoutFixedTexts,
  checkoutLang,
  checkoutMoney,
  editableText,
} from "./texts";

/** Endereço da página de checkout na prévia (/checkout/<chave do link>). */
export function previewCheckoutPath(key: string): string {
  return `${PREVIEW_CHECKOUT_PREFIX}${key}`;
}

/** Atributo do script que leva a versão A/B do endereço ao rastreamento. */
export const CHECKOUT_VERSION_ATTR = "data-os-versao";

/**
 * Teste A/B: a versão da página de vendas que trouxe a pessoa (?os_versao=B,
 * posta pelo render nos botões e nos prêmios — withCheckoutVersion) entra no
 * #os-tracking antes de o script de rastreamento ler a configuração: os
 * eventos da página (InitiateCheckout, AddPaymentInfo, Purchase) saem com
 * os_versao e a metadata da cobrança leva a versão
 * (src/runtime/payments/meta.ts), como nas páginas com versões. Fica logo
 * depois do #os-tracking (injectCheckoutVersion). Uma versão que já está na
 * configuração não muda; valor fora do formato é ignorado. Safari 13: ES5.
 */
export const CHECKOUT_VERSION_SCRIPT = `<script ${CHECKOUT_VERSION_ATTR}>(function(){try{var v=new URLSearchParams(location.search).get(${JSON.stringify(
  CHECKOUT_VERSION_PARAM,
)});if(!v||!/${CHECKOUT_VERSION_RE.source}/.test(v))return;var e=document.getElementById(${JSON.stringify(
  TRACKING_CONFIG_ID,
)});if(!e)return;var c=JSON.parse(e.textContent||"null");if(!c||typeof c!=="object"||c.variant)return;c.variant={name:v,folder:"",srcHosts:[]};e.textContent=JSON.stringify(c)}catch(x){}})();</script>`;

/** Põe o CHECKOUT_VERSION_SCRIPT logo depois do #os-tracking (sem rastreamento na página: nada muda). */
export function injectCheckoutVersion(html: string): string {
  if (html.includes(CHECKOUT_VERSION_ATTR)) return html;
  const open = html.indexOf(`id="${TRACKING_CONFIG_ID}"`);
  const end = open < 0 ? -1 : html.indexOf("</script>", open);
  if (end < 0) return html;
  const at = end + "</script>".length;
  return `${html.slice(0, at)}${CHECKOUT_VERSION_SCRIPT}${html.slice(at)}`;
}

/**
 * Regras de evento que não valem na página de checkout: "Ao enviar um
 * formulário" (o formulário de pagamento contaria um Lead a cada "Pagar", com
 * os campos certos ou não) e "Ao clicar em um botão de checkout" (a página já
 * conta o InitiateCheckout ao abrir). A página manda os próprios eventos
 * (InitiateCheckout, AddPaymentInfo, Purchase).
 */
const CHECKOUT_PAGE_SKIPPED_TRIGGERS: readonly RuntimeRule["trigger"][] = ["FORM_SUBMIT", "CHECKOUT_CLICK"];

/** Rastreamento da página de checkout: o da oferta sem as regras que não valem nela. */
export function checkoutPageTracking(config: TrackingRuntimeConfig): TrackingRuntimeConfig {
  return { ...config, rules: config.rules.filter((r) => !CHECKOUT_PAGE_SKIPPED_TRIGGERS.includes(r.trigger)) };
}

/** O que a página precisa do produto (ServerCheckoutProduct cabe aqui). */
export interface CheckoutPageProduct {
  key: string;
  provider: CheckoutProviderId;
  name: string;
  amountCents: number;
  currency: CheckoutCurrencyId;
  methods: CheckoutMethodId[];
  locale: PaymentLocaleId;
  config: CheckoutConfig;
}

export interface PublicCheckoutOptions {
  /** Endpoint relativo à página (prévia /__os/pagamento; ZIP ../../pagamento.php). */
  endpoint: string;
  /** Prévia do app: nada é cobrado. */
  simulation: boolean;
  /** Prévia com a chave do gateway salva: a cobrança é real (aviso em pt-BR, sem simular). */
  realTest?: boolean;
  /** Chave do storage → endereço da imagem a partir da página (null = sem imagem). */
  imageHref: (key: string | null) => string | null;
  /** Endereço da página de obrigado a partir da página de checkout (null = sem). */
  thankYouHref: string | null;
}

const METHOD_ID: Record<CheckoutMethodId, CheckoutPayMethod> = {
  PIX: "pix",
  SPEI: "spei",
  CARD: "card",
  BIZUM: "bizum",
  MB_WAY: "mb_way",
};

/** Produto → o JSON público da página (#os-checkout). */
export function publicCheckoutConfig(p: CheckoutPageProduct, opts: PublicCheckoutOptions): PublicCheckoutConfig {
  const lang = checkoutLang(p.locale);
  const pix = isPixProvider(p.provider);
  const c = p.config;
  const endereco = c.address && addressAllowed(p.currency);
  const textos: Record<string, string> = {};
  for (const k of CHECKOUT_EDITABLE_TEXTS) textos[k] = editableText(lang, k, c.texts, pix);
  return {
    v: CHECKOUT_CONFIG_VERSION,
    endpoint: opts.endpoint,
    simulacao: opts.simulation,
    ...(opts.realTest ? { testeReal: true } : {}),
    chave: p.key,
    nome: p.name,
    descricao: c.description,
    imagem: opts.imageHref(c.imageKey),
    valor: p.amountCents,
    valorDe: c.compareAtCents !== null && c.compareAtCents > p.amountCents ? c.compareAtCents : null,
    moeda: p.currency,
    idioma: lang,
    gateway: pix ? "pix" : "kyvo",
    metodos: p.methods.filter((m) => checkoutMethodAllows(m, p.provider, p.currency)).map((m) => METHOD_ID[m]),
    campos: askedBuyerFields(p.provider, c.fields),
    endereco,
    fretes: endereco ? c.shipping.map((s) => ({ id: s.id, nome: s.name, prazo: s.eta, valor: s.priceCents })) : [],
    freteInicial: endereco ? (defaultShipping(c)?.id ?? null) : null,
    bumps: c.bumps.map((b) => ({
      id: b.id,
      titulo: b.title,
      descricao: b.description,
      valor: b.priceCents,
      valorDe: b.compareAtCents !== null && b.compareAtCents > b.priceCents ? b.compareAtCents : null,
      imagem: opts.imageHref(b.imageKey),
    })),
    maxQtd: c.maxQuantity,
    cor: c.color,
    bannerComputador: opts.imageHref(c.bannerDesktopKey),
    bannerCelular: opts.imageHref(c.bannerMobileKey),
    logo: opts.imageHref(c.logoKey),
    cronometro: c.timerMinutes,
    selos: { seguro: c.badges.secure, garantia: c.badges.guarantee },
    depoimentos: c.testimonials.map((t) => ({ texto: t.text, nome: t.name, foto: opts.imageHref(t.photoKey) })),
    textos,
    obrigado: opts.thankYouHref,
  };
}

// ─── HTML ────────────────────────────────────────────────────────────────────

export { colorReadable, contrastRatio, darkOnWhite, textOnColor } from "./colors";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ICON = {
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg>',
  shield:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.6 8 11 4.6-1.4 8-6 8-11V5l-8-3Zm-1.2 13.6-3.4-3.4 1.4-1.4 2 2 4.6-4.6 1.4 1.4-6 6Z"/></svg>',
  medal:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1a8 8 0 0 0-4.9 14.3L6 23l6-3 6 3-1.1-7.7A8 8 0 0 0 12 1Zm0 3.2 1.4 2.9 3.2.5-2.3 2.2.5 3.2-2.8-1.5-2.8 1.5.5-3.2-2.3-2.2 3.2-.5L12 4.2Z"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.4 3.5 2.1-1 1.7L11 13V6h2v6.4Z"/></svg>',
  pix: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.6 16.9a2.9 2.9 0 0 1-2.1-.9l-3-3a.6.6 0 0 0-.8 0l-3 3a2.9 2.9 0 0 1-2.1.9h-.6l3.8 3.8a3 3 0 0 0 4.3 0l3.8-3.8h-.3Zm-11.1-9.8c.8 0 1.5.3 2.1.9l3 3a.6.6 0 0 0 .8 0l3-3a2.9 2.9 0 0 1 2.1-.9h.3l-3.8-3.8a3 3 0 0 0-4.3 0L5.9 7.1h.6Zm14.6 2.8-2.3-2.3h-1.2c-.5 0-1 .2-1.4.6l-3 3a1.7 1.7 0 0 1-2.4 0l-3-3a2 2 0 0 0-1.4-.6H5l-2.3 2.3a3 3 0 0 0 0 4.3L5 16.4h1.5c.5 0 1-.2 1.4-.6l3-3a1.7 1.7 0 0 1 2.4 0l3 3c.4.4.9.6 1.4.6h1.2l2.3-2.3a3 3 0 0 0 0-4.3Z"/></svg>',
  card: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 4v2h16V9H4Zm0 5v3h6v-3H4Z"/></svg>',
  bank: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 2 7v2h20V7L12 2ZM4 11v7h3v-7H4Zm6.5 0v7h3v-7h-3ZM17 11v7h3v-7h-3ZM2 20v2h20v-2H2Z"/></svg>',
  phone:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 1h10a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2Zm0 4v14h10V5H7Zm4 15v1h2v-1h-2Z"/></svg>',
};

const METHOD_ICON: Record<CheckoutPayMethod, string> = {
  pix: ICON.pix,
  spei: ICON.bank,
  card: ICON.card,
  bizum: ICON.phone,
  mb_way: ICON.phone,
};

/** Nome e frase curta de cada forma de pagamento, por idioma. */
const METHOD_TEXT: Record<CheckoutLang, Record<CheckoutPayMethod, [string, string]>> = {
  pt: {
    pix: ["PIX", "Aprovação imediata"],
    spei: ["Transferência SPEI", "Pelo app do seu banco"],
    card: ["Cartão", "Crédito ou débito"],
    bizum: ["Bizum", "Pelo celular"],
    mb_way: ["MB WAY", "Pelo celular"],
  },
  es: {
    pix: ["PIX", "Aprobación inmediata"],
    spei: ["Transferencia SPEI", "Desde la app de tu banco"],
    card: ["Tarjeta", "Crédito o débito"],
    bizum: ["Bizum", "Con tu móvil"],
    mb_way: ["MB WAY", "Con tu móvil"],
  },
  en: {
    pix: ["PIX", "Instant approval"],
    spei: ["SPEI transfer", "From your bank app"],
    card: ["Card", "Credit or debit"],
    bizum: ["Bizum", "With your phone"],
    mb_way: ["MB WAY", "With your phone"],
  },
};

export function checkoutMethodText(lang: CheckoutLang, method: CheckoutPayMethod): [string, string] {
  return METHOD_TEXT[lang][method];
}

/** CSS da página (leve, sem fontes de fora: a da sistema de quem compra). */
export const CHECKOUT_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#f3f4f6;color:#111827;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
img{max-width:100%;display:block}
button,input,select{font:inherit;color:inherit}
[hidden]{display:none!important}
.osc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.osc-wrap{width:100%;max-width:1100px;margin:0 auto;padding:0 16px}
.osc-timer{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 16px;background:var(--osc-c);color:var(--osc-on);font-weight:700;font-size:15px;text-align:center}
.osc-timer svg{width:18px;height:18px;flex:none}
.osc-clock{display:inline-block;min-width:64px;padding:2px 10px;border-radius:999px;background:rgba(0,0,0,.18);font-variant-numeric:tabular-nums;font-size:16px}
.osc-banner{display:block;width:100%}
.osc-banner img{display:block;width:100%;height:auto}
.osc-grid{display:grid;gap:16px;padding-top:16px;padding-bottom:32px;grid-template-columns:minmax(0,1fr)}
.osc-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:18px 16px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.osc-main{display:flex;flex-direction:column;gap:16px;min-width:0}
.osc-form{display:flex;flex-direction:column;gap:16px;margin:0}
.osc-h{display:flex;align-items:center;gap:10px;margin:0 0 14px;font-size:18px;line-height:1.3;font-weight:800}
.osc-step{display:inline-grid;place-items:center;flex:none;width:28px;height:28px;border-radius:50%;background:var(--osc-c);color:var(--osc-on);font-size:15px}
.osc-row{display:grid;gap:12px;grid-template-columns:minmax(0,1fr)}
.osc-f{display:flex;flex-direction:column;gap:5px;min-width:0}
.osc-f>label{font-size:14px;font-weight:600;color:#374151}
.osc-f>label small{font-weight:400;color:#6b7280}
.osc-f input,.osc-f select{width:100%;height:48px;padding:0 14px;border:1px solid #d1d5db;border-radius:10px;background:#fff;font-size:16px;outline:none;transition:border-color .15s,box-shadow .15s}
.osc-f select{appearance:auto}
.osc-f input:focus,.osc-f select:focus{border-color:var(--osc-c);box-shadow:0 0 0 3px var(--osc-ring)}
.osc-f input[aria-invalid=true],.osc-f select[aria-invalid=true]{border-color:#dc2626;box-shadow:0 0 0 3px rgba(220,38,38,.12)}
.osc-f input[aria-invalid=true]:focus,.osc-f select[aria-invalid=true]:focus{border-color:#991b1b;box-shadow:0 0 0 3px rgba(220,38,38,.4)}
.osc-f.osc-valid input:not([aria-invalid=true]){padding-right:40px;background-image:url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%2316a34a'%20stroke-width='3'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M20%206%209%2017l-5-5'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 13px center;background-size:17px}
.osc-f-ac{position:relative}
.osc-ac{position:absolute;left:0;right:0;z-index:30;background:#fff;border:1px solid #d1d5db;border-radius:10px;box-shadow:0 10px 30px rgba(15,23,42,.14);overflow:hidden;max-height:244px;overflow-y:auto}
.osc-ac-i{padding:11px 14px;font-size:15px;color:#111827;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.osc-ac-i[aria-selected=true],.osc-ac-i:hover{background:var(--osc-tint)}
.osc-err{color:#b91c1c;font-size:13px;line-height:1.35}
.osc-note{margin:0;color:#6b7280;font-size:13px}
[data-osc-cep-status]:empty{display:none}
.osc-ship{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;border:0}
.osc-ship legend{padding:0;margin:0 0 8px;font-size:14px;font-weight:700;color:#374151}
.osc-opt{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid #d1d5db;border-radius:10px;cursor:pointer;background:#fff}
.osc-opt input{width:18px;height:18px;margin:0;flex:none;accent-color:var(--osc-c)}
.osc-opt:has(input:checked){border-color:var(--osc-c);background:var(--osc-tint);box-shadow:0 0 0 1px var(--osc-c)}
.osc-opt.osc-on{border-color:var(--osc-c);background:var(--osc-tint);box-shadow:0 0 0 1px var(--osc-c)}
.osc-opt-t{flex:1;min-width:0;display:flex;flex-direction:column}
.osc-opt-t b{font-size:15px}
.osc-opt-t small{color:#6b7280;font-size:13px}
.osc-opt-p{font-weight:800;white-space:nowrap}
.osc-free{color:#15803d}
.osc-bumps{border:0;background:transparent;box-shadow:none;padding:0}
.osc-bumps .osc-h{margin-bottom:10px}
.osc-bump{display:block;margin:0 0 12px;border:2px dashed var(--osc-c);border-radius:14px;background:#fff;cursor:pointer;overflow:hidden}
.osc-bump:last-child{margin-bottom:0}
.osc-bump-top{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--osc-tint);font-weight:800;font-size:15px}
.osc-bump-top input{width:22px;height:22px;margin:0;flex:none;accent-color:var(--osc-c)}
.osc-bump-b{display:flex;gap:12px;padding:12px 14px 14px}
.osc-bump-b img{width:72px;height:72px;object-fit:cover;border-radius:10px;flex:none;background:#f3f4f6}
.osc-bump-t{flex:1;min-width:0;overflow-wrap:anywhere}
.osc-bump-t b{display:block;font-size:16px;line-height:1.3}
.osc-bump-t p{margin:4px 0 0;color:#4b5563;font-size:14px;line-height:1.4}
.osc-price{margin-top:6px;font-weight:800;color:var(--osc-dark)}
.osc-price s{margin-right:6px;color:#6b7280;font-weight:400}
.osc-bump.osc-on{border-style:solid;box-shadow:0 0 0 3px var(--osc-ring)}
.osc-methods{display:grid;gap:10px;grid-template-columns:minmax(0,1fr)}
.osc-method{display:flex;align-items:center;gap:12px;padding:14px;border:1px solid #d1d5db;border-radius:12px;cursor:pointer;background:#fff}
.osc-method input{width:18px;height:18px;margin:0;flex:none;accent-color:var(--osc-c)}
.osc-method svg{width:26px;height:26px;flex:none;color:var(--osc-dark)}
.osc-method b{display:block;font-size:16px}
.osc-method small{display:block;color:#6b7280;font-size:13px}
.osc-method.osc-on{border-color:var(--osc-c);background:var(--osc-tint);box-shadow:0 0 0 1px var(--osc-c)}
.osc-tag{margin-left:auto;padding:3px 9px;border-radius:999px;background:#dcfce7;color:#166534;font-size:12px;font-weight:700;white-space:nowrap}
.osc-pay{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:58px;margin:16px 0 0;padding:12px 18px;border:0;border-radius:12px;background:var(--osc-c);color:var(--osc-on);font-size:18px;font-weight:800;line-height:1.2;cursor:pointer;box-shadow:0 12px 24px -12px var(--osc-c);transition:filter .15s,transform .05s}
.osc-pay:hover{filter:brightness(1.06)}
.osc-pay:active{transform:translateY(1px)}
.osc-pay:disabled{opacity:.7;cursor:wait}
.osc-pay svg{width:20px;height:20px;flex:none}
.osc-alert{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:#fef2f2;color:#991b1b;font-size:14px}
.osc-sim{margin:12px 0 0;padding:10px 12px;border:1px dashed #a16207;border-radius:10px;background:#fefce8;color:#713f12;font-size:13px}
.osc-simb{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.osc-simb button{padding:9px 12px;border:1px dashed #a16207;border-radius:10px;background:#fefce8;color:#713f12;font-size:13px;font-weight:700;cursor:pointer}
.osc-badges{display:flex;flex-wrap:wrap;justify-content:center;gap:10px 18px;color:#374151;font-size:14px;font-weight:600}
.osc-badges span{display:inline-flex;align-items:center;gap:6px}
.osc-badges svg{width:20px;height:20px;color:#15803d}
.osc-testi .osc-h{justify-content:center;margin-bottom:12px}
.osc-tlist{display:grid;gap:12px;grid-template-columns:minmax(0,1fr)}
.osc-t{margin:0;padding:16px;background:#fff;border:1px solid #e5e7eb;border-radius:14px}
.osc-stars{color:#f59e0b;letter-spacing:2px;font-size:14px}
.osc-t blockquote{margin:6px 0 10px;font-size:15px;line-height:1.5;color:#1f2937;overflow-wrap:anywhere}
.osc-t figcaption,.osc-opt-t{overflow-wrap:anywhere}
.osc-t figcaption{display:flex;align-items:center;gap:10px;font-weight:700;font-size:14px}
.osc-t figcaption img{width:40px;height:40px;border-radius:50%;object-fit:cover}
.osc-sum .osc-h{margin-bottom:12px}
.osc-prod{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.osc-sum .osc-price{white-space:nowrap}
.osc-prod .osc-qty{margin-left:auto}
.osc-prod img{width:72px;height:72px;object-fit:cover;border-radius:10px;flex:none;background:#f3f4f6}
.osc-prod-t{flex:1;min-width:0;overflow-wrap:anywhere}
.osc-prod-t b{display:block;font-size:16px;line-height:1.3}
.osc-prod-t p{margin:4px 0 0;color:#6b7280;font-size:13px;line-height:1.4}
.osc-qty{display:inline-flex;align-items:center;gap:0;border:1px solid #e5e7eb;border-radius:999px;flex:none;align-self:center;overflow:hidden}
.osc-qty-b{width:34px;height:34px;border:0;background:#fff;color:var(--osc-dark);font-size:20px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center}
.osc-qty-b:hover{background:var(--osc-tint)}
.osc-qty-n{min-width:28px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums}
.osc-shipwrap{margin:16px 0 0}
.osc-ship-h{margin:0 0 8px;font-size:14px;font-weight:700;color:#374151}
.osc-ship-empty{border:1px dashed #d1d5db;border-radius:12px;padding:16px;color:#6b7280;text-align:center}
.osc-ship-empty b{display:block;color:#374151;font-size:15px}
.osc-ship-empty small{display:block;margin-top:4px;font-size:13px}
.osc-lines{list-style:none;margin:14px 0 0;padding:12px 0 0;border-top:1px solid #e5e7eb;display:flex;flex-direction:column;gap:8px;font-size:14px}
.osc-lines li{display:flex;justify-content:space-between;gap:12px}
.osc-lines li span:first-child{color:#4b5563;min-width:0}
.osc-lines li span:last-child{white-space:nowrap;font-weight:600}
.osc-total{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-top:12px;padding-top:12px;border-top:1px solid #e5e7eb}
.osc-total span{font-weight:700}
.osc-total b{font-size:24px;color:var(--osc-dark);font-variant-numeric:tabular-nums}
.osc-flow{text-align:center}
.osc-flow .osc-h{justify-content:center}
.osc-amount{margin:0 0 12px;font-size:28px;font-weight:800;color:var(--osc-dark)}
.osc-amount small{display:block;font-size:13px;font-weight:600;color:#6b7280}
.osc-qr{width:232px;max-width:100%;margin:8px auto 14px;padding:8px;border:1px solid #e5e7eb;border-radius:14px;background:#fff}
.osc-qr svg,.osc-qr img{display:block;width:100%;height:auto}
.osc-code{display:flex;gap:8px;margin:8px 0 6px}
.osc-code input{flex:1;min-width:0;height:48px;padding:0 12px;border:1px solid #d1d5db;border-radius:10px;background:#f9fafb;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.osc-copy{flex:none;height:48px;padding:0 16px;border:0;border-radius:10px;background:var(--osc-c);color:var(--osc-on);font-weight:800;cursor:pointer}
.osc-copy-big{width:100%;margin:6px 0 2px}
.osc-alt{margin-top:12px;background:#fff;color:#374151;border:1px solid #d1d5db}
.osc-old{margin:12px 0 0;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb}
.osc-link{margin-top:4px;padding:0;border:0;background:none;color:var(--osc-dark);font-weight:700;font-size:14px;text-decoration:underline;cursor:pointer}
.osc-exp{margin:10px 0 0;color:#4b5563;font-size:14px}
.osc-exp b{font-variant-numeric:tabular-nums}
.osc-flow .osc-steps{margin:12px auto 0;max-width:420px;color:#4b5563;font-size:14px}
.osc-wait{display:flex;align-items:center;justify-content:center;gap:10px;margin:16px 0 0;padding:12px;border-radius:10px;background:#f0fdf4;color:#166534;font-weight:700}
.osc-spin{display:inline-block;width:18px;height:18px;border:3px solid currentColor;border-right-color:transparent;border-radius:50%;animation:osc-r .8s linear infinite;flex:none}
@keyframes osc-r{to{transform:rotate(360deg)}}
.osc-ic{display:inline-grid;place-items:center;width:64px;height:64px;margin:0 auto 10px;border-radius:50%;font-size:32px;font-weight:800}
.osc-ok{background:#dcfce7;color:#15803d}
.osc-bad{background:#fee2e2;color:#b91c1c}
.osc-warn{background:#fef3c7;color:#b45309}
.osc-flow p{margin:6px 0 0}
.osc-go{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;margin:16px 0 0;padding:10px 18px;border:0;border-radius:12px;background:var(--osc-c);color:var(--osc-on);font-weight:800;font-size:17px;text-decoration:none;cursor:pointer}
.osc-rows{margin:12px 0 0;text-align:left}
.osc-r{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #f3f4f6}
.osc-r dt{font-size:12px;color:#6b7280}
.osc-r dd{margin:0;font-weight:700;overflow-wrap:break-word;word-break:break-word}
.osc-r button{flex:none;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;background:#fff;font-weight:700;font-size:13px;cursor:pointer}
.osc-cardbox{min-height:120px;margin-top:12px;text-align:left}
.osc-foot{padding:20px 16px 32px;color:#6b7280;font-size:12px;text-align:center;overflow-wrap:anywhere}
.osc-foot p{margin:2px 0}
.osc-foot a{color:inherit}
@media (prefers-reduced-motion:reduce){.osc-spin{animation:none}}
@media (min-width:640px){.osc-row-2{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.osc-row-cep{grid-template-columns:180px minmax(0,1fr)}.osc-row-num{grid-template-columns:140px minmax(0,1fr)}.osc-row-city{grid-template-columns:minmax(0,1fr) 120px}.osc-card{padding:22px 22px}.osc-tlist{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}}
@media (min-width:920px){.osc-grid{grid-template-columns:minmax(0,1fr) 380px;align-items:start;padding-top:24px}.osc-side{grid-column:2;grid-row:1;position:sticky;top:var(--osc-top,16px)}.osc-main{grid-column:1;grid-row:1}.osc-methods{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}}
`;

function field(
  name: string,
  label: string,
  opts: {
    type?: string;
    auto?: string;
    mode?: string;
    placeholder?: string;
    max?: number;
    optional?: string;
    attrs?: string;
  } = {},
): string {
  const id = `osc-${name}`;
  const extra = [
    opts.auto ? ` autocomplete="${opts.auto}"` : "",
    opts.mode ? ` inputmode="${opts.mode}"` : "",
    opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : "",
    opts.max ? ` maxlength="${opts.max}"` : "",
    opts.optional ? "" : " required",
    opts.attrs ?? "",
  ].join("");
  // O erro fica FORA do <label> (senão o leitor de tela lê o erro duas vezes: no nome e na descrição).
  return `<div class="osc-f"><label for="${id}">${esc(label)}${opts.optional ? ` <small>(${esc(opts.optional)})</small>` : ""}</label><input id="${id}" name="${name}" type="${opts.type ?? "text"}"${extra}><small class="osc-err" id="${id}-e" hidden></small></div>`;
}

function priceHtml(cents: number, was: number | null, currency: string, lang: CheckoutLang): string {
  const now = esc(checkoutMoney(cents, currency, lang));
  return was !== null ? `<s>${esc(checkoutMoney(was, currency, lang))}</s>${now}` : now;
}

export interface CheckoutDocumentOptions {
  /** Tag do script do checkout (prévia: /os-checkout.js; ZIP: assets/…; sem ela, embutido por quem chama). */
  scriptTag: string;
  /** Dados da empresa no rodapé (vazios somem). */
  company?: { name: string; document: string; email: string } | null;
  /**
   * Link "Preferências de cookies" no rodapé (data-os-consent-open), quando a
   * página leva o aviso de cookies: com ele, o rastreamento não põe o botão
   * flutuante "Cookies", que no celular ficava por cima dos campos do formulário.
   */
  consentLink?: boolean;
}

/**
 * HTML completo da página de checkout. O rastreamento, o SEO da oferta e o
 * código livre entram depois, pelo render das páginas (renderPageHtml).
 */
export function renderCheckoutDocument(cfg: PublicCheckoutConfig, opts: CheckoutDocumentOptions): string {
  const lang = cfg.idioma;
  const fx = checkoutFixedTexts(lang);
  const tx = cfg.textos;
  const money = (cents: number) => checkoutMoney(cents, cfg.moeda, lang);
  const brl = cfg.moeda === "BRL";
  const on = textOnColor(cfg.cor);
  const htmlLang = lang === "pt" ? (cfg.moeda === "EUR" ? "pt-PT" : "pt-BR") : lang === "es" ? "es" : "en";
  let step = 0;
  const heading = (id: string, text: string, numbered = true) =>
    `<h2 class="osc-h" id="${id}">${numbered ? `<span class="osc-step" aria-hidden="true">${++step}</span>` : ""}${esc(text)}</h2>`;

  // ── Topo ──
  const timer =
    cfg.cronometro !== null
      ? `<div class="osc-timer" data-osc-timer role="timer">${ICON.clock}<span>${esc(tx.timerText)}</span> <b class="osc-clock" data-osc-clock>${String(cfg.cronometro).padStart(2, "0")}:00</b></div>`
      : "";
  let banner = "";
  const bannerSrc = cfg.bannerComputador || cfg.bannerCelular;
  if (bannerSrc) {
    const mobile =
      cfg.bannerCelular && cfg.bannerComputador
        ? `<source media="(max-width: 767px)" srcset="${esc(cfg.bannerCelular)}">`
        : "";
    banner = `<picture class="osc-banner">${mobile}<img src="${esc(bannerSrc)}" alt="" fetchpriority="high"></picture>`;
  }
  // ── Resumo ("Seu carrinho") ──
  const productImg = cfg.imagem ? `<img src="${esc(cfg.imagem)}" alt="" width="72" height="72">` : "";
  // O frete só entra no total depois do CEP (a tela mostra "Preencha seu CEP…").
  const total = cfg.valor;
  // Seletor de quantidade (só quando o máximo é maior que 1).
  const stepper =
    cfg.maxQtd > 1
      ? `<div class="osc-qty" data-osc-qty-box data-osc-max="${cfg.maxQtd}" role="group" aria-label="${esc(fx.quantity)}"><button type="button" class="osc-qty-b" data-osc-qty="-" aria-label="${esc(fx.qtyLess)}">&minus;</button><b class="osc-qty-n" data-osc-qtd aria-live="polite">1</b><button type="button" class="osc-qty-b" data-osc-qty="+" aria-label="${esc(fx.qtyMore)}">+</button></div>`
      : "";
  const summary = `<aside class="osc-side"><section class="osc-card osc-sum" aria-labelledby="osc-sum-t"><h2 class="osc-h" id="osc-sum-t">${esc(tx.summaryTitle)}</h2>
<div class="osc-prod">${productImg}<div class="osc-prod-t"><b>${esc(cfg.nome)}</b>${cfg.descricao ? `<p>${esc(cfg.descricao)}</p>` : ""}<div class="osc-price">${priceHtml(cfg.valor, cfg.valorDe, cfg.moeda, lang)}</div></div>${stepper}</div>
<ul class="osc-lines" data-osc-lines><li data-osc-line="subtotal"><span>${esc(fx.subtotal)}</span><span data-osc-subtotal>${esc(money(cfg.valor))}</span></li></ul>
<div class="osc-total"><span>${esc(fx.total)}</span><b data-osc-total aria-live="polite">${esc(money(total))}</b></div></section></aside>`;

  // ── 1. Seus dados ──
  // Dois a dois, como na referência: E-mail + Telefone, depois Nome + CPF/CNPJ.
  const asks = (f: string) => cfg.campos.indexOf(f as never) >= 0;
  const emailF = asks("email")
    ? field("email", fx.email, {
        type: "email",
        auto: "email",
        mode: "email",
        max: 254,
        placeholder: "email@email.com",
      })
    : "";
  const phoneF = asks("phone")
    ? field("telefone", fx.phone, {
        type: "tel",
        auto: "tel",
        mode: "tel",
        // Folga para o número colado como aparece ("+55 (11) 98765-4321"): a máscara limita os algarismos.
        max: 25,
        placeholder: brl ? "(99) 99999-9999" : "",
      })
    : "";
  const nameF = asks("name") ? field("nome", fx.name, { auto: "name", max: 120, placeholder: "Nome e Sobrenome" }) : "";
  const docF = asks("document")
    ? field("documento", brl ? fx.cpf : fx.document, {
        auto: "off",
        mode: brl ? "numeric" : undefined,
        max: brl ? 20 : 40,
        placeholder: brl ? "123.456.789-12" : "",
      })
    : "";
  const dataRows = [
    emailF || phoneF ? `<div class="osc-row osc-row-2">${emailF}${phoneF}</div>` : "",
    nameF || docF ? `<div class="osc-row osc-row-2">${nameF}${docF}</div>` : "",
  ].join("");
  const dataSection = `<section class="osc-card" aria-labelledby="osc-h-dados">${heading("osc-h-dados", tx.dataTitle)}<div class="osc-row">${dataRows}</div></section>`;

  // ── 2. Entrega ──
  let delivery = "";
  if (cfg.endereco) {
    const shipping = cfg.fretes
      .map((s) => {
        const checked = s.id === cfg.freteInicial ? " checked" : "";
        const price = s.valor ? esc(money(s.valor)) : `<span class="osc-free">${esc(fx.shippingFree)}</span>`;
        return `<label class="osc-opt${checked ? " osc-on" : ""}"><input type="radio" name="frete" value="${esc(s.id)}"${checked}><span class="osc-opt-t"><b>${esc(s.nome)}</b>${s.prazo ? `<small>${esc(s.prazo)}</small>` : ""}</span><span class="osc-opt-p">${price}</span></label>`;
      })
      .join("");
    // Estado: no Brasil, a lista de UF; fora do real, texto livre.
    const stateField = brl
      ? `<div class="osc-f"><label for="osc-uf">${esc(fx.state)}</label><select id="osc-uf" name="uf" autocomplete="address-level1" required><option value="">—</option>${BR_STATES.map((uf) => `<option value="${uf}">${uf}</option>`).join("")}</select><small class="osc-err" id="osc-uf-e" hidden></small></div>`
      : field("uf", fx.state, { auto: "address-level1", max: 60 });
    // Código postal: no Brasil, numérico com a máscara e a busca automática (o
    // endereço vem depois); fora do real, texto livre, sem busca.
    const cepField = brl
      ? `<div class="osc-row osc-row-cep">${field("cep", fx.cep, { auto: "postal-code", mode: "numeric", max: 12, placeholder: "00000-000" })}<p class="osc-note" data-osc-cep-status aria-live="polite" style="align-self:end;padding-bottom:14px"></p></div>`
      : `<div class="osc-row osc-row-cep">${field("cep", fx.cep, { auto: "postal-code", max: 16 })}</div>`;
    // No Brasil o endereço começa escondido (a busca do CEP revela); fora, já aparece.
    const addrAttr = brl ? " hidden" : "";
    delivery = `<section class="osc-card" aria-labelledby="osc-h-entrega">${heading("osc-h-entrega", tx.deliveryTitle)}<div class="osc-row">
${cepField}
<div class="osc-row" data-osc-addr${addrAttr}>
${field("rua", fx.street, { auto: "address-line1", max: 120 })}
<div class="osc-row osc-row-num">${field("numero", fx.number, { auto: "off", max: 20 })}${field("complemento", fx.complement, { auto: "address-line2", max: 120, optional: fx.optional })}</div>
${field("bairro", fx.neighborhood, { auto: "off", max: 120 })}
<div class="osc-row osc-row-city">${field("cidade", fx.city, { auto: "address-level2", max: 120 })}${stateField}</div>
</div>
</div>${
      shipping
        ? `<div class="osc-shipwrap"><p class="osc-ship-h">${esc(fx.chooseShipping)}</p><div class="osc-ship-empty" data-osc-ship-empty><b>${esc(fx.cepForShipping)}</b><small>${esc(fx.cepForShippingHint)}</small></div><fieldset class="osc-ship" data-osc-ship hidden><legend class="osc-sr">${esc(fx.chooseShipping)}</legend>${shipping}</fieldset></div>`
        : ""
    }</section>`;
  }

  // ── Order bumps ──
  let bumps = "";
  if (cfg.bumps.length) {
    const items = cfg.bumps
      .map(
        (b) =>
          `<label class="osc-bump"><span class="osc-bump-top"><input type="checkbox" name="bump" value="${esc(b.id)}">${esc(tx.bumpCheck)}</span><span class="osc-bump-b">${b.imagem ? `<img src="${esc(b.imagem)}" alt="" width="72" height="72" loading="lazy">` : ""}<span class="osc-bump-t"><b>${esc(b.titulo)}</b>${b.descricao ? `<p>${esc(b.descricao)}</p>` : ""}<span class="osc-price" style="display:block">${priceHtml(b.valor, b.valorDe, cfg.moeda, lang)}</span></span></span></label>`,
      )
      .join("");
    bumps = `<section class="osc-card osc-bumps" aria-labelledby="osc-h-bumps">${heading("osc-h-bumps", tx.bumpsTitle, false)}${items}</section>`;
  }

  // ── 3. Pagamento ──
  const methods = cfg.metodos
    .map((m, i) => {
      const t = METHOD_TEXT[lang][m];
      const checked = i === 0 ? " checked" : "";
      const tag = m === "pix" ? `<span class="osc-tag">${esc(fx.pixInstant)}</span>` : "";
      return `<label class="osc-method${checked ? " osc-on" : ""}"><input type="radio" name="metodo" value="${m}"${checked}>${METHOD_ICON[m]}<span><b>${esc(t[0])}</b>${m === "pix" ? "" : `<small>${esc(t[1])}</small>`}</span>${tag}</label>`;
    })
    .join("");
  const sim = cfg.simulacao
    ? `<p class="osc-sim">Prévia do Offer Studio: nada é cobrado. Depois de pagar, use os botões de simulação para testar.</p>`
    : "";
  const payment = `<section class="osc-card" aria-labelledby="osc-h-pagamento">${heading("osc-h-pagamento", tx.paymentTitle)}
<div class="osc-methods" role="radiogroup" aria-labelledby="osc-h-pagamento">${methods}</div>${sim}
<p class="osc-alert" data-osc-error role="alert" hidden></p>
<button class="osc-pay" type="submit" data-osc-pay>${ICON.lock}<span data-osc-pay-label>${esc(tx.payButton)}</span><span aria-hidden="true">·</span><span data-osc-pay-amount>${esc(money(total))}</span></button></section>`;

  // ── Selos e depoimentos ──
  const badges: string[] = [];
  if (cfg.selos.seguro) badges.push(`<span>${ICON.shield}${esc(tx.badgeSecure)}</span>`);
  if (cfg.selos.garantia) badges.push(`<span>${ICON.medal}${esc(tx.badgeGuarantee)}</span>`);
  const badgesHtml = badges.length ? `<div class="osc-badges">${badges.join("")}</div>` : "";
  const testimonials = cfg.depoimentos.length
    ? `<section class="osc-testi" aria-labelledby="osc-h-dep">${heading("osc-h-dep", tx.testimonialsTitle, false)}<div class="osc-tlist">${cfg.depoimentos
        .map(
          (t) =>
            `<figure class="osc-t"><div class="osc-stars" aria-hidden="true">★★★★★</div><blockquote>${esc(t.texto)}</blockquote><figcaption>${t.foto ? `<img src="${esc(t.foto)}" alt="" width="40" height="40" loading="lazy">` : ""}${esc(t.nome)}</figcaption></figure>`,
        )
        .join("")}</div></section>`
    : "";

  const company = opts.company;
  const footerLines = [
    company?.name ? esc(company.name) + (company.document ? ` · ${esc(company.document)}` : "") : "",
    company?.email ? esc(company.email) : "",
  ].filter(Boolean);
  const cookies = opts.consentLink ? `<p><a href="#" data-os-consent-open>${esc(fx.cookies)}</a></p>` : "";
  const footer = `<footer class="osc-foot">${footerLines.map((l) => `<p>${l}</p>`).join("")}<p>${esc(fx.footer)}</p>${cookies}</footer>`;

  const style = `<style>:root{--osc-c:${cfg.cor};--osc-on:${on};--osc-dark:${darkOnWhite(cfg.cor)};--osc-tint:${cfg.cor}14;--osc-ring:${cfg.cor}33${timer ? ";--osc-top:60px" : ""}}${CHECKOUT_CSS.replace(/\n/g, "")}</style>`;
  const json = `<script type="application/json" id="${CHECKOUT_CONFIG_ID}">${scriptString(cfg)}</script>`;
  const title = `${cfg.nome} — ${tx.paymentTitle}`;
  return `<!DOCTYPE html>
<html lang="${htmlLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="${cfg.cor}"><title>${esc(title)}</title>${style}${json}</head>
<body class="osc">${timer}${banner}
<div class="osc-wrap osc-grid">${summary}<main class="osc-main">
<form class="osc-form" data-osc-form novalidate>${dataSection}${delivery}${bumps}${payment}</form>
<section class="osc-card osc-flow" data-osc-flow tabindex="-1" hidden></section>
${badgesHtml}${testimonials}</main></div>
${footer}${opts.scriptTag}</body></html>`;
}
