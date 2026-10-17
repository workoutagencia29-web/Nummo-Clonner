/**
 * Widgets do editor: tipos de componente do GrapesJS para os blocos com
 * comportamento (contador, escassez, notificação, popup, formulário, WhatsApp,
 * vídeos, quiz, roleta de desconto, acesso ao produto, vitrine de produtos,
 * cabeçalho de loja, galeria e caixa de compra da página do produto, rodapé
 * com logo) e botões. Cada widget guarda as opções em atributos
 * data-os-*, editáveis em "Configurações"; o comportamento roda só na página
 * publicada (src/runtime/widgets), nunca no canvas.
 *
 * registerWidgetTypes roda dentro do plugin de inicialização (via
 * registerBlocks), antes de o projeto carregar.
 */
import type { Editor } from "grapesjs";
import { forgetNewLinkTarget } from "@/editor/grapes/new-link";
import { registerAccessTypes } from "./access";
import { registerBannerTypes } from "./banner";
import { registerButtonType } from "./button";
import { registerCanvasCss } from "./canvas";
import { registerCountdownType } from "./countdown";
import { registerExitPopupType } from "./exit-popup";
import { registerFooterTypes } from "./footer";
import { registerCreateHooks } from "./hooks";
import { registerLeadFormType } from "./lead-form";
import { registerProductPageTypes } from "./product-page";
import { registerProductsTypes } from "./products";
import { registerQuizTypes } from "./quiz";
import { registerSalesNotificationType } from "./sales-notification";
import { registerScarcityType } from "./scarcity";
import { registerStoreHeaderTypes } from "./store-header";
import { registerTraitTypes } from "./traits";
import { registerVideoTypes } from "./video";
import { registerWhatsappType } from "./whatsapp";
import { registerWheelTypes } from "./wheel";

export { setWidgetContext, type WidgetContext, type WidgetLink, type WidgetPage } from "./context";

export function registerWidgetTypes(editor: Editor) {
  registerTraitTypes(editor);
  registerCreateHooks(editor);
  // "Botão de checkout" ligado a um link: sai a preferência pelo destino do link novo.
  forgetNewLinkTarget(editor);
  registerCanvasCss(editor);
  registerButtonType(editor);
  registerCountdownType(editor);
  registerScarcityType(editor);
  registerSalesNotificationType(editor);
  registerExitPopupType(editor);
  registerLeadFormType(editor);
  registerWhatsappType(editor);
  registerVideoTypes(editor);
  registerQuizTypes(editor);
  registerWheelTypes(editor);
  registerAccessTypes(editor);
  registerProductsTypes(editor);
  // Depois da vitrine: a caixa de compra usa as partes e os campos do cartão.
  registerProductPageTypes(editor);
  registerStoreHeaderTypes(editor);
  registerBannerTypes(editor);
  registerFooterTypes(editor);
}
