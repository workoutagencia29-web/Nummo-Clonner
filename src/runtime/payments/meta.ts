/**
 * Metadata da cobrança (o gateway usa nos pixels pelo servidor e na UTMify):
 * UTMs e src da chegada e, só com permissão (como no repasse ao checkout), os
 * IDs de clique e os cookies de anúncio (fbc, fbp, ttclid, ttp). No teste A/B,
 * os_versao e, se o anúncio não trouxe utm_content, a marca da versão nele
 * (como markVersion faz nos checkouts).
 *
 * O que vale com a escolha de cookies da hora vem do rastreamento
 * (src/runtime/tracking/index.ts): window.__osTracking.payMeta() (parâmetros
 * da chegada, sem IDs de clique antes do "Aceitar"), window.osConsent.granted()
 * (pode rastrear) e a versão A/B do #os-tracking. Sem o rastreamento na
 * página, só as UTMs do endereço.
 */
import { PAYMENT_METADATA_KEYS, PAYMENT_METADATA_VALUE_MAX } from "@/lib/payments/contract";

/** O que o rastreamento expõe para a janela. */
export interface TrackingInfo {
  /** Parâmetros que valem agora. */
  p: Record<string, string>;
  /** Pode rastrear (IDs de clique e cookies de anúncio). */
  g: boolean;
  /** Letra da versão A/B mostrada, ou null. */
  v: string | null;
}

/** Formato de um ID de clique (o mesmo do _fbc no rastreamento). */
const CLICK_ID_VALUE = /^[A-Za-z0-9_.-]{1,500}$/;
/** Campos de chegada que vão na metadata (sem permissão também: não identificam ninguém). */
const ARRIVAL = ["utm_source", "utm_campaign", "utm_medium", "utm_content", "utm_term", "src"];

function cookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? m[1] : null;
}

type Win = Window & {
  __osTracking?: { payMeta?: () => Record<string, string> };
  osConsent?: { granted?: () => boolean };
};

/** Lê do rastreamento da página (null = página sem rastreamento). */
export function trackingInfo(): TrackingInfo | null {
  const w = window as Win;
  const t = w.__osTracking;
  if (!t || typeof t.payMeta !== "function") return null;
  let v: string | null = null;
  // Prévia do app (modo "preview"): nada de identificadores de anúncio.
  let preview = false;
  try {
    const el = document.getElementById("os-tracking");
    const cfg = JSON.parse(el?.textContent || "null");
    preview = !!cfg && cfg.mode === "preview";
    const name = cfg?.variant?.name;
    v = typeof name === "string" && /^[\w-]{1,20}$/.test(name) ? name : null;
  } catch {
    v = null;
  }
  const c = w.osConsent;
  return { p: t.payMeta() || {}, g: !preview && !!(c && typeof c.granted === "function" && c.granted()), v: v };
}

/** Monta a metadata (só as chaves do contrato, cada valor com até 500 caracteres). */
export function payMetadata(info: TrackingInfo | null): Record<string, string> {
  const params = info ? info.p : {};
  const raw: Record<string, string> = {};
  const query = new URLSearchParams(location.search);
  for (let i = 0; i < ARRIVAL.length; i++) {
    const k = ARRIVAL[i];
    const v = params[k] || query.get(k);
    if (v) raw[k] = v;
  }
  if (info?.g) {
    const id = (k: string) => {
      const v = params[k] || query.get(k);
      return v && CLICK_ID_VALUE.test(v) ? v : null;
    };
    const fbclid = id("fbclid");
    const fbc = cookie("_fbc") || (fbclid ? `fb.1.${Date.now()}.${fbclid}` : null);
    const fbp = cookie("_fbp");
    const ttclid = id("ttclid");
    const ttp = cookie("_ttp");
    if (fbc) raw.fbc = fbc;
    if (fbp) raw.fbp = fbp;
    if (ttclid) raw.ttclid = ttclid;
    if (ttp) raw.ttp = ttp;
  }
  if (info?.v) {
    raw.os_versao = info.v;
    if (!raw.utm_content) raw.utm_content = `versao-${info.v.toLowerCase()}`;
  }
  const out: Record<string, string> = {};
  for (let i = 0; i < PAYMENT_METADATA_KEYS.length; i++) {
    const k = PAYMENT_METADATA_KEYS[i];
    const v = raw[k];
    if (typeof v === "string" && v) out[k] = v.slice(0, PAYMENT_METADATA_VALUE_MAX);
  }
  return out;
}
