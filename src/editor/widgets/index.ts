/**
 * Widgets do editor: tipos de componente do GrapesJS para os blocos com
 * comportamento (contador, escassez, notificação, popup, formulário, WhatsApp,
 * vídeos) e botões. Cada widget guarda as opções em atributos data-os-*,
 * editáveis em "Configurações"; o comportamento roda só na página publicada
 * (src/runtime/widgets), nunca no canvas.
 *
 * registerWidgetTypes roda dentro do plugin de inicialização (via
 * registerBlocks), antes de o projeto carregar.
 */
import type { Editor } from "grapesjs";
import { registerButtonType } from "./button";
import { registerCanvasCss } from "./canvas";
import { registerCountdownType } from "./countdown";
import { registerExitPopupType } from "./exit-popup";
import { registerCreateHooks } from "./hooks";
import { registerLeadFormType } from "./lead-form";
import { registerSalesNotificationType } from "./sales-notification";
import { registerScarcityType } from "./scarcity";
import { registerTraitTypes } from "./traits";
import { registerVideoTypes } from "./video";
import { registerWhatsappType } from "./whatsapp";

export { setWidgetContext, type WidgetContext, type WidgetLink, type WidgetPage } from "./context";

export function registerWidgetTypes(editor: Editor) {
  registerTraitTypes(editor);
  registerCreateHooks(editor);
  registerCanvasCss(editor);
  registerButtonType(editor);
  registerCountdownType(editor);
  registerScarcityType(editor);
  registerSalesNotificationType(editor);
  registerExitPopupType(editor);
  registerLeadFormType(editor);
  registerWhatsappType(editor);
  registerVideoTypes(editor);
}
