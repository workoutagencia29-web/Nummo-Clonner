/**
 * Ajustes feitos quando um componente nasce (bloco solto na página):
 *
 * - Bloco solto com o modo Celular/Tablet ligado: o GrapesJS guardaria o estilo
 *   do bloco só naquele aparelho (e no computador ele ficaria "pelado"). Aqui o
 *   estilo volta para a regra base, que vale em todos os aparelhos.
 * - `osMobile`: ajustes do bloco só para celular (regra @media do modo Celular).
 * - `osAutoLink`: liga o botão ao primeiro link da oferta daquele tipo
 *   (CHECKOUT, WHATSAPP…), se existir. "OWN_CHECKOUT" (bloco "Botão de
 *   checkout"): ao primeiro link "Checkout do Offer Studio" (o do tipo
 *   checkout antes de upsell/downsell); sem nenhum, o botão fica pedindo o
 *   link e o "＋ Criar link da oferta…" dele já vem com esse destino (o botão
 *   guarda a preferência em data-os-new-link: vale depois de reabrir).
 * - `osLegal`: liga o link à página do funil de termos/privacidade, se existir.
 * - `osOfferCurrency`: vitrine ou caixa de compra sem moeda escolhida nasce na
 *   moeda da oferta (data-os-currency; o idioma das frases acompanha a moeda).
 *
 * As propriedades auxiliares são apagadas logo em seguida: não vão para o projeto.
 */
import type { Component, Editor } from "grapesjs";
import {
  AUTO_LINK_OWN_CHECKOUT,
  MOBILE_MEDIA,
  PROP_AUTO_LINK,
  PROP_LEGAL,
  PROP_MOBILE,
  PROP_OFFER_CURRENCY,
  type Style,
} from "@/editor/blocks/shared";
import { wantOwnCheckout } from "@/editor/grapes/new-link";
import { INTERNAL_LINK_PREFIX } from "@/lib/internal-links";
import { CURRENCY_ATTR, DEFAULT_CURRENCY, storeCurrency } from "@/lib/store";
import { findLegalPage, type WidgetLink, widgetContext } from "./context";

/** Link "Checkout do Offer Studio" para o "Botão de checkout": o do tipo checkout primeiro. */
export function ownCheckoutLink(links: WidgetLink[]): WidgetLink | undefined {
  const own = links.filter((l) => l.checkout != null);
  return own.find((l) => l.kind === "CHECKOUT") ?? own[0];
}

function keepStyleOnAllDevices(editor: Editor, component: Component) {
  const media = editor.getModel().getCurrentMedia();
  if (!media) return;
  const css = editor.Css;
  const id = component.getId();
  const rule = css.getIdRule(id, { mediaText: media });
  if (!rule || css.getIdRule(id, { mediaText: "" })) return;
  css.setIdRule(id, rule.getStyle() as Style, { mediaText: "" });
  css.remove(rule);
}

export function applyCreateHooks(editor: Editor, component: Component) {
  keepStyleOnAllDevices(editor, component);

  const mobile = component.get(PROP_MOBILE) as Style | undefined;
  if (mobile) {
    component.unset(PROP_MOBILE, { silent: true });
    editor.Css.setIdRule(component.getId(), mobile, { mediaText: MOBILE_MEDIA });
  }

  const kind = component.get(PROP_AUTO_LINK) as string | undefined;
  if (kind) {
    component.unset(PROP_AUTO_LINK, { silent: true });
    const links = widgetContext(editor).links;
    const own = kind === AUTO_LINK_OWN_CHECKOUT;
    const link = own ? ownCheckoutLink(links) : links.find((l) => l.kind === kind);
    if (link && !component.getAttributes()["data-os-link"]) component.addAttributes({ "data-os-link": link.key });
    else if (own && !link) wantOwnCheckout(component);
  }

  const legal = component.get(PROP_LEGAL) as "terms" | "privacy" | undefined;
  if (legal) {
    component.unset(PROP_LEGAL, { silent: true });
    const page = findLegalPage(widgetContext(editor).pages, legal);
    if (page) component.addAttributes({ href: `${INTERNAL_LINK_PREFIX}${page.id}` });
  }

  if (component.get(PROP_OFFER_CURRENCY)) {
    component.unset(PROP_OFFER_CURRENCY, { silent: true });
    const currency = storeCurrency(widgetContext(editor).currency ?? DEFAULT_CURRENCY);
    // As partes geradas (preço, parcelas…) se redesenham com a moeda (tipo da vitrine e da caixa).
    if (component.getAttributes()[CURRENCY_ATTR] !== currency) component.addAttributes({ [CURRENCY_ATTR]: currency });
  }
}

export function registerCreateHooks(editor: Editor) {
  editor.on("component:create", (component: Component) => applyCreateHooks(editor, component));
}
