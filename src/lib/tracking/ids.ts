/**
 * IDs de pixel e rótulos de conversão digitados (ou colados) no painel.
 *
 * Quem não é programador costuma colar o código inteiro do pixel: aqui o ID é
 * achado dentro do código (fbq('init', '…'), ttq.load('…'), G-…, AW-…,
 * window.pixelId = "…"). Funções puras: o painel pode validar enquanto a
 * pessoa digita e o servidor valida de novo ao salvar.
 */
import { PIXEL_ID_RULES, PIXEL_VENDOR_LABEL, type PixelVendorId } from "./schema";

/** Onde o ID aparece no código de instalação de cada plataforma. */
const SNIPPET_PATTERNS: Record<PixelVendorId, RegExp[]> = {
  META: [/fbq\(\s*["']init["']\s*,\s*["']?(\d{10,20})/, /facebook\.com\/tr\/?\?(?:[^"'\s]*&(?:amp;)?)?id=(\d{10,20})/],
  TIKTOK: [/ttq\.load\(\s*["']([A-Za-z0-9]{15,25})["']/, /[?&]sdkid=([A-Za-z0-9]{15,25})/],
  KWAI: [
    /kwaiq\.load\(\s*["'](\d{6,25})["']/,
    /kwaiq\.page\(\s*["'](\d{6,25})["']/,
    /pixelId["']?\s*[:=]\s*["'](\d{6,25})["']/,
  ],
  GA4: [/\b(G-[A-Za-z0-9]{4,15})\b/],
  GOOGLE_ADS: [/\b(AW-\d{6,15})\b/i],
  UTMIFY: [/pixelId\s*=\s*["']([A-Za-z0-9_-]{6,64})["']/],
};

/** Plataformas cujo ID é sempre em maiúsculas. */
const UPPERCASE: ReadonlySet<PixelVendorId> = new Set(["TIKTOK", "GA4", "GOOGLE_ADS"]);

/**
 * ID limpo: tira espaços, acha o ID dentro de um código colado e põe em
 * maiúsculas quando a plataforma usa assim. Não valida (ver checkPixelId).
 */
export function normalizePixelId(vendor: PixelVendorId, raw: string): string {
  let text = raw.trim();
  if (/[\s<>()'"=;]/.test(text)) {
    for (const pattern of SNIPPET_PATTERNS[vendor]) {
      const match = pattern.exec(text);
      if (match) {
        text = match[1];
        break;
      }
    }
  }
  text = text.replace(/\s+/g, "");
  return UPPERCASE.has(vendor) ? text.toUpperCase() : text;
}

export type PixelIdCheck = { ok: true; id: string } | { ok: false; message: string };

/** Normaliza e valida o ID de uma plataforma (mensagem em português). */
export function checkPixelId(vendor: PixelVendorId, raw: string): PixelIdCheck {
  const id = normalizePixelId(vendor, raw);
  if (!id) return { ok: false, message: `Informe o ID do pixel (${PIXEL_VENDOR_LABEL[vendor]}).` };
  const rule = PIXEL_ID_RULES[vendor];
  if (!rule.pattern.test(id)) return { ok: false, message: rule.message };
  return { ok: true, id };
}

/** Rótulo de conversão do Google Ads (a parte depois da barra em send_to: "AW-123/rotulo"). */
export const CONVERSION_LABEL_RE = /^[A-Za-z0-9_-]{4,80}$/;

export type ConversionLabelCheck = { ok: true; label: string } | { ok: false; message: string };

/**
 * Aceita o rótulo sozinho ou o send_to inteiro ("AW-123456789/AbC-D_efG"). Se o
 * send_to for de outra conta, avisa (o rótulo só funciona com o ID dele).
 */
export function checkConversionLabel(raw: string, adsId?: string): ConversionLabelCheck {
  let text = raw.trim().replace(/^["']|["']$/g, "");
  const sendTo = /^(AW-\d{6,15})\s*\/\s*(.+)$/i.exec(text);
  if (sendTo) {
    const account = sendTo[1].toUpperCase();
    if (adsId && account !== adsId.toUpperCase()) {
      return {
        ok: false,
        message: `Esse rótulo é da conta ${account}, mas este pixel é ${adsId.toUpperCase()}. Confira o ID do Google Ads.`,
      };
    }
    text = sendTo[2].trim();
  }
  if (!CONVERSION_LABEL_RE.test(text)) {
    return {
      ok: false,
      message: "O rótulo de conversão tem só letras, números, - e _ (ex.: AbC-D_efG-h12). Copie do Google Ads.",
    };
  }
  return { ok: true, label: text };
}
