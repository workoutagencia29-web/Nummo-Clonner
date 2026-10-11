/**
 * Faixa "Este botão leva para: …" do painel Estilo (botão ou link selecionado):
 * o destino em palavras simples — nome do link da oferta, página do funil,
 * site do endereço ou "nenhum lugar ainda". Só leitura: o destino muda em
 * Configurações ("Mudar destino").
 */
import { destinationOf, linkKindOf, OFFER_LINK_ATTR, PAGE_LINK_PREFIX } from "@/lib/find-replace";
import { PRODUCT_ATTR, STORE_NAV_CLASSES } from "@/lib/store";

/**
 * Tipos de link/botão comuns (botões de páginas clonadas, bloco "Botão", botão
 * final do quiz): nas Configurações o destino vem primeiro, e no Estilo a faixa.
 */
export const LEAD_LINK_TYPES: ReadonlySet<string> = new Set(["link", "os-button"]);

/**
 * O elemento ganha a faixa? Links e botões comuns — não os da loja (cartão,
 * logo, categorias: destino opcional, com avisos próprios) nem o botão do
 * "Acesso ao produto" (o destino vem do servidor, só para quem pagou).
 */
export function showsLinkTarget(type: string, tag: string, attrs: Record<string, unknown>, classes: string[]) {
  if (tag !== "a" || !LEAD_LINK_TYPES.has(type)) return false;
  if ("data-os-ac-go" in attrs || PRODUCT_ATTR in attrs) return false;
  return !classes.some((c) => (STORE_NAV_CLASSES as readonly string[]).includes(c));
}

export interface LinkTargetData {
  links: { key: string; label: string; payment?: string | null; checkout?: string | null }[];
  pages: { id: string; name: string }[];
}

/** Site do endereço ("https://www.pay.hotmart.com/x" → "pay.hotmart.com"); sem site, o endereço. */
function siteOf(url: string) {
  const absolute = url.startsWith("//") ? `https:${url}` : url;
  if (!/^https?:\/\//i.test(absolute)) return url;
  try {
    const host = new URL(absolute).hostname.replace(/^www\./i, "");
    if (/^(wa\.me|(api|web)\.whatsapp\.com)$/i.test(host)) return "WhatsApp";
    return host || url;
  } catch {
    return url;
  }
}

/** Para onde o elemento leva (texto da faixa), ou null quando não é um link. */
export function linkTargetText(tag: string, attrs: Record<string, unknown>, data: LinkTargetData): string | null {
  if (tag !== "a") return null;
  const key = typeof attrs[OFFER_LINK_ATTR] === "string" ? String(attrs[OFFER_LINK_ATTR]).trim() : "";
  if (key) {
    const link = data.links.find((l) => l.key === key);
    if (!link) return "um link da oferta que foi excluído";
    if (link.payment) return `${link.label} (pagamento na página)`;
    return link.checkout != null ? `${link.label} (checkout do Offer Studio)` : link.label;
  }
  const dest = destinationOf(tag, attrs);
  if (!dest) return "nenhum lugar ainda";
  const url = dest.url;
  switch (linkKindOf(url)) {
    case "funnel-page": {
      const page = data.pages.find((p) => p.id === url.slice(PAGE_LINK_PREFIX.length));
      return page ? `a página “${page.name}”` : "uma página que foi excluída";
    }
    case "anchor":
      return "uma parte desta página";
    case "email":
      return `o e-mail ${url.replace(/^mailto:/i, "").split("?")[0]}`;
    case "phone":
      return "uma ligação ou mensagem de celular";
    default:
      return siteOf(url);
  }
}

/** "botão" ou "link" (texto da faixa). */
export function linkTargetNoun(type: string, classes: string[]) {
  if (type === "os-button") return "botão";
  return classes.some((c) => /(^|[-_])(btn|button|botao|cta)([-_]|$)/i.test(c)) ? "botão" : "link";
}
