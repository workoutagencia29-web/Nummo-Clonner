/**
 * Nome de cada evento em cada plataforma. `null` = a plataforma não tem esse
 * evento (não dispara). PAGE_VIEW é tratado pelo carregador de cada pixel.
 *
 * O usuário pode trocar qualquer nome no painel (TrackingSettings.eventNames),
 * útil quando a plataforma muda a nomenclatura.
 */
import type { PixelVendorId, TrackingEventId, TrackingSettings } from "./schema";

export const VENDOR_EVENT_NAMES: Record<PixelVendorId, Record<TrackingEventId, string | null>> = {
  META: {
    PAGE_VIEW: "PageView",
    VIEW_CONTENT: "ViewContent",
    INITIATE_CHECKOUT: "InitiateCheckout",
    LEAD: "Lead",
    COMPLETE_REGISTRATION: "CompleteRegistration",
    CONTACT: "Contact",
    ADD_TO_CART: "AddToCart",
    PURCHASE: "Purchase",
  },
  // Nomes atuais da documentação do TikTok (Lead/Purchase substituem SubmitForm/CompletePayment).
  TIKTOK: {
    PAGE_VIEW: "Pageview",
    VIEW_CONTENT: "ViewContent",
    INITIATE_CHECKOUT: "InitiateCheckout",
    LEAD: "Lead",
    COMPLETE_REGISTRATION: "CompleteRegistration",
    CONTACT: "Contact",
    ADD_TO_CART: "AddToCart",
    PURCHASE: "Purchase",
  },
  // Pixel web do Kwai: kwaiq.instance(id).track("<nome>") com os nomes em camelCase
  // (os EVENT_* são da API de servidor do Kwai). O PageView sai por kwaiq.page().
  KWAI: {
    PAGE_VIEW: "pageView",
    VIEW_CONTENT: "contentView",
    INITIATE_CHECKOUT: "initiatedCheckout",
    LEAD: "formSubmit",
    COMPLETE_REGISTRATION: "completeRegistration",
    CONTACT: "contact",
    ADD_TO_CART: "addToCart",
    PURCHASE: "purchase",
  },
  GA4: {
    PAGE_VIEW: "page_view",
    VIEW_CONTENT: "view_item",
    INITIATE_CHECKOUT: "begin_checkout",
    LEAD: "generate_lead",
    COMPLETE_REGISTRATION: "sign_up",
    CONTACT: "contact",
    ADD_TO_CART: "add_to_cart",
    PURCHASE: "purchase",
  },
  // Google Ads só registra conversões dos eventos que têm rótulo (options.conversionLabels).
  GOOGLE_ADS: {
    PAGE_VIEW: null,
    VIEW_CONTENT: "conversion",
    INITIATE_CHECKOUT: "conversion",
    LEAD: "conversion",
    COMPLETE_REGISTRATION: "conversion",
    CONTACT: "conversion",
    ADD_TO_CART: "conversion",
    PURCHASE: "conversion",
  },
  // O pixel da UTMify repassa os eventos padrão da Meta.
  UTMIFY: {
    PAGE_VIEW: "PageView",
    VIEW_CONTENT: "ViewContent",
    INITIATE_CHECKOUT: "InitiateCheckout",
    LEAD: "Lead",
    COMPLETE_REGISTRATION: "CompleteRegistration",
    CONTACT: "Contact",
    ADD_TO_CART: "AddToCart",
    PURCHASE: "Purchase",
  },
};

/** Nome final do evento, considerando o que o usuário personalizou. */
export function vendorEventName(
  vendor: PixelVendorId,
  event: TrackingEventId,
  overrides?: TrackingSettings["eventNames"],
): string | null {
  const custom = overrides?.[vendor]?.[event]?.trim();
  if (custom) return custom;
  return VENDOR_EVENT_NAMES[vendor][event];
}

/** Onde achar o ID de cada plataforma (texto de ajuda do painel). */
export const PIXEL_ID_HELP: Record<PixelVendorId, string> = {
  META: "Gerenciador de Eventos da Meta → Fontes de dados → seu pixel → ID (só números).",
  TIKTOK: "TikTok Ads Manager → Ferramentas → Eventos → Web → ID do pixel.",
  KWAI: "Kwai for Business → Ferramentas → Pixel → ID do pixel.",
  GA4: "Google Analytics → Administrador → Fluxos de dados → ID da métrica (G-…).",
  GOOGLE_ADS: "Google Ads → Metas → Conversões → Tag do Google → ID (AW-…). Cada conversão tem um rótulo.",
  UTMIFY: "Painel da UTMify → aba Pixel → ID do pixel (no código novo, que vem codificado, o ID não aparece escrito).",
};
