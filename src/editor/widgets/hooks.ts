/**
 * Ajustes feitos quando um componente nasce (bloco solto na página):
 *
 * - Bloco solto com o modo Celular/Tablet ligado: o GrapesJS guardaria o estilo
 *   do bloco só naquele aparelho (e no computador ele ficaria "pelado"). Aqui o
 *   estilo volta para a regra base, que vale em todos os aparelhos.
 * - `osMobile`: ajustes do bloco só para celular (regra @media do modo Celular).
 * - `osAutoLink`: liga o botão ao primeiro link da oferta daquele tipo
 *   (CHECKOUT, WHATSAPP…), se existir.
 * - `osLegal`: liga o link à página do funil de termos/privacidade, se existir.
 *
 * As propriedades auxiliares são apagadas logo em seguida: não vão para o projeto.
 */
import type { Component, Editor } from "grapesjs";
import { MOBILE_MEDIA, PROP_AUTO_LINK, PROP_LEGAL, PROP_MOBILE, type Style } from "@/editor/blocks/shared";
import { INTERNAL_LINK_PREFIX } from "@/lib/internal-links";
import { findLegalPage, widgetContext } from "./context";

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
    const link = widgetContext(editor).links.find((l) => l.kind === kind);
    if (link && !component.getAttributes()["data-os-link"]) component.addAttributes({ "data-os-link": link.key });
  }

  const legal = component.get(PROP_LEGAL) as "terms" | "privacy" | undefined;
  if (legal) {
    component.unset(PROP_LEGAL, { silent: true });
    const page = findLegalPage(widgetContext(editor).pages, legal);
    if (page) component.addAttributes({ href: `${INTERNAL_LINK_PREFIX}${page.id}` });
  }
}

export function registerCreateHooks(editor: Editor) {
  editor.on("component:create", (component: Component) => applyCreateHooks(editor, component));
}
