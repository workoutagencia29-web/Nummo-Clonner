/**
 * Lê a configuração pública (<script type="application/json" id="os-tracking">,
 * montada por composeTrackingConfig) e conserta o que vier faltando ou com
 * formato errado — nunca lança erro: sem configuração válida, o script não faz nada.
 */
import type { TrackingRuntimeConfig } from "@/lib/tracking/runtime-config";
import type { PixelVendorId, TrackingEventId } from "@/lib/tracking/schema";
import { doc, isObj, type Loose } from "./util";

export type Cfg = TrackingRuntimeConfig;
export type Vendor = PixelVendorId;
export type Ev = TrackingEventId;

const VENDORS = /^(META|TIKTOK|KWAI|GA4|GOOGLE_ADS|UTMIFY)$/;

/** o[k] como lista, só com os itens que passam no teste (padrão: texto não vazio). */
const list = (o: Loose, k: string, ok: (x: Loose) => unknown = (x) => typeof x === "string" && x) => {
  o[k] = Array.isArray(o[k]) ? o[k].filter(ok) : [];
  return o[k];
};
const obj = (o: Loose, k: string): Loose => {
  if (!isObj(o[k])) o[k] = {};
  return o[k];
};

export function readConfig(): Cfg | null {
  let c: Loose;
  try {
    c = JSON.parse((doc.getElementById("os-tracking") as HTMLElement).textContent || "");
  } catch {
    return null;
  }
  if (!isObj(c)) return null;
  const consent = obj(c, "consent");
  if (!/^(NOTICE|OFF)$/.test(consent.mode)) consent.mode = "OPT_IN";
  for (const k of ["text", "acceptLabel", "rejectLabel", "noticeLabel", "policyLabel"]) {
    if (typeof consent[k] !== "string") consent[k] = "";
  }
  c.marketingCode = c.marketingCode === true;
  list(obj(c, "forwarding"), "params");
  const value = obj(c, "value");
  if (typeof value.amount !== "number") value.amount = null;
  obj(c, "names");
  list(c, "pixels", (p) => isObj(p) && VENDORS.test(p.vendor) && typeof p.id === "string" && p.id && isObj(p.options));
  list(c, "rules", (r) => isObj(r) && typeof r.event === "string");
  list(c, "checkoutLinkKeys");
  list(c, "checkoutHosts");
  const server = c.server;
  if (!isObj(server) || !server.endpoint) c.server = null;
  else list(server, "vendors");
  if (!isObj(c.test) || !c.test.endpoint || !c.test.token) c.test = null;
  const variant = c.variant;
  if (!isObj(variant) || !/^[\w-]{1,20}$/.test(variant.name)) c.variant = null;
  else list(variant, "srcHosts");
  return c as Cfg;
}

/** os_versao da versão A/B mostrada ({} = página com uma versão só). */
export function versionOf(cfg: Cfg): { os_versao?: string } {
  return cfg.variant ? { os_versao: cfg.variant.name } : {};
}

/** Nome do evento na plataforma (já com as personalizações). null = não dispara. */
export function nameOf(cfg: Cfg, vendor: Vendor, ev: Ev): string | null {
  // biome-ignore lint/complexity/useOptionalChain: "?." vira código mais longo no alvo es2018 (script pequeno)
  const n = ((cfg.names as Loose)[vendor] || {})[ev];
  return (typeof n === "string" && n.trim()) || null;
}

/** Valor/moeda para InitiateCheckout, AddToCart e Purchase (quando o valor está preenchido). */
export function amountOf(cfg: Cfg, ev: Ev): { value?: number; currency?: string } {
  const v = cfg.value;
  return v.amount !== null && /^(INITIATE_CHECKOUT|PURCHASE|ADD_TO_CART)$/.test(ev)
    ? { value: v.amount, currency: v.currency }
    : {};
}
