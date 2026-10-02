/**
 * CSS só do canvas do editor para os widgets: mostra no lugar (com um rótulo)
 * o que na página final fica escondido até agir — popup de saída e notificação
 * de compra — e avisa botões ainda sem link da oferta e formulários sem destino.
 * Nada disso vai para o HTML exportado.
 *
 * WIDGET_CANVAS_CSS também entra no `canvasCss` do grapesjs.init
 * (src/editor/grapes/setup.ts), que sobrevive à troca do <head> do quadro. A
 * cópia no <head> (registerCanvasCss) volta sozinha se o <head> for refeito
 * (setComponents com asDocument na primeira abertura da página).
 */
import type { Editor } from "grapesjs";

const LABEL =
  "display:block;width:max-content;max-width:100%;box-sizing:border-box;margin:0 0 12px;padding:5px 10px;border-radius:6px;" +
  "background:#ede9fe;color:#5b21b6;font:600 12px/1.3 system-ui,-apple-system,sans-serif;letter-spacing:0;text-transform:none;text-align:left;";

/**
 * As regras !important ficam na camada os-fix: o CSS da página está em
 * @layer os-original, e no !important uma camada anterior vence — até uma regra
 * !important fora de camada perde para `[hidden]{display:none!important}` do
 * Bootstrap (comum em páginas clonadas). A ordem das camadas (os-fix antes)
 * também vem no começo da folha base e da cópia os-fix do canvas.
 */
export const WIDGET_CANVAS_CSS = `
@layer os-fix, os-original;
@layer os-fix{
[data-os-widget][hidden]{display:block!important}
[data-os-widget=countdown][data-os-cd-days="0"] [data-os-cd-unit=d]{display:none!important}
.os-pulse{animation:none!important}
}
[data-os-widget=exit-popup],[data-os-widget=sales-notification]{
  outline:2px dashed #8b5cf6;outline-offset:6px;margin-top:24px;margin-bottom:24px;
}
[data-os-widget=exit-popup]{padding:16px;background:repeating-linear-gradient(45deg,rgba(139,92,246,.06) 0 12px,transparent 12px 24px)}
[data-os-widget=exit-popup]::before{content:"Popup de saída (aparece ao sair)";${LABEL}}
[data-os-widget=sales-notification]::before{content:"Notificação de compra (aparece no canto da tela)";${LABEL}}
[data-os-widget=sales-notification] [data-os-sn]{pointer-events:none}
[data-os-widget=sales-notification][data-os-time="0"] [data-os-sn=time]{display:none}
form[data-os-widget=lead-form]:is([data-os-webhook=""],:not([data-os-webhook])):is(:not([action]),[action=""],[action="#"]):is(:not([data-os-link]),[data-os-link=""])::before{
  content:"Formulário sem destino: os dados não vão para lugar nenhum. Configure o webhook ou o destino em Configurações";
  ${LABEL}width:auto;background:#fef3c7;color:#92400e;
}
a[data-os-link=""]{position:relative}
a[data-os-link=""]::after{
  content:"Escolha o link da oferta em Configurações";position:absolute;right:-6px;top:-11px;
  white-space:nowrap;padding:3px 8px;border-radius:6px;background:#4f46e5;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.2);
  font:600 11px/1.2 system-ui,-apple-system,sans-serif;letter-spacing:0;text-transform:none;pointer-events:none;z-index:5;
}
`;

const STYLE_ID = "os-widgets-canvas";
const watchedHeads = new WeakSet<HTMLHeadElement>();

function inject(doc: Document | undefined | null) {
  const head = doc?.head;
  if (!doc || !head) return;
  const add = () => {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = WIDGET_CANVAS_CSS;
    head.appendChild(style);
  };
  add();
  // Abrir uma página pela primeira vez importa o documento inteiro (asDocument):
  // o GrapesJS refaz o <head> do quadro e apagaria o estilo. Ele volta na hora.
  if (watchedHeads.has(head)) return;
  watchedHeads.add(head);
  new MutationObserver(add).observe(head, { childList: true });
}

export function registerCanvasCss(editor: Editor) {
  editor.on("canvas:frame:load", ({ window }: { window: Window }) => inject(window.document));
  // Se o frame já estava pronto (ex.: plugin registrado tarde).
  editor.on("load", () => inject(editor.Canvas.getDocument()));
}
