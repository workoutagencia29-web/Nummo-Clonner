/**
 * CSS só do canvas do editor para os widgets: mostra no lugar (com um rótulo)
 * o que na página final fica escondido até agir — popup de saída e notificação
 * de compra —, avisa botões ainda sem link da oferta e formulários sem destino
 * e mostra as etapas do quiz empilhadas, cada uma com o selo "Etapa 2 de 6 ·
 * Pergunta" (o texto vem de data-os-qz-badge, posto só no elemento desenhado
 * pelo tipo da etapa, src/editor/widgets/quiz.ts), mostra o resultado da
 * roleta (escondido na página até o giro) com rótulos e o aviso de prêmio sem
 * link (data-os-wh-badge, src/editor/widgets/wheel.ts), mostra as três partes
 * do bloco "Acesso ao produto" com rótulos, marca a "Contagem no topo (barra)"
 * fixa (no canvas fica no lugar, com o selo "Barra fixa no topo…" logo abaixo
 * dela; dentro de um bloco que começa escondido, o selo avisa que ela fica no
 * lugar, como na página), marca os elementos
 * com visibilidade pela roleta ("só para quem ganhou"), contorna o cartão da
 * vitrine de produtos que ainda não leva a lugar nenhum (sem página do
 * produto, link da oferta ou endereço) — com UM aviso no alto da vitrine
 * ("N produtos ainda sem página…", data-os-cv-aviso, posto só no elemento
 * desenhado por src/editor/widgets/products.ts) — e o "Ver todas" ligado sem
 * destino, mostra a miniatura da galeria do produto mesmo quando ela é a única
 * (na página, uma foto só esconde a fileira; no canvas é por ela que se troca
 * a foto), e,
 * no cabeçalho de loja, marca o "Fixo no topo" (selo como o da barra), troca o
 * balão "Escolha o link da oferta" do "Entre"/carrinho (cobriria o logo e a
 * pesquisa) por uma linha do cabeçalho logo abaixo da linha deles (o ícone
 * fica com o contorno tracejado de sempre), e avisa
 * quando a pesquisa, as categorias ou o "‹ Voltar para a loja" sem destino
 * não têm para onde levar
 * (página sem vitrine e sem a página da loja escolhida; :has() vale no
 * canvas) ou quando uma categoria sem destino não acha nenhum produto da
 * página (marca data-os-cv-nada, posta só no desenho do canvas por
 * src/editor/widgets/store-header.ts). Nada disso vai para o HTML exportado.
 *
 * WIDGET_CANVAS_CSS também entra no `canvasCss` do grapesjs.init
 * (src/editor/grapes/setup.ts), que sobrevive à troca do <head> do quadro. A
 * cópia no <head> (registerCanvasCss) volta sozinha se o <head> for refeito
 * (setComponents com asDocument na primeira abertura da página).
 */
import type { Editor } from "grapesjs";
import { OVERLAY_HIDE_ROOT_ATTR, OVERLAY_TAG_ATTR } from "@/editor/grapes/overlay-hider";
import { HIDDEN_HOST } from "@/lib/countdown-bar";
import { PRIZE_SHOW_ATTR } from "@/lib/wheel";
import { PRODUCT_NO_DEST_ATTR, PRODUCTS_WARN_ATTR } from "./products-content";

const LABEL =
  "display:block;width:max-content;max-width:100%;box-sizing:border-box;margin:0 0 12px;padding:5px 10px;border-radius:6px;" +
  "background:#ede9fe;color:#5b21b6;font:600 12px/1.3 system-ui,-apple-system,sans-serif;letter-spacing:0;text-transform:none;text-align:left;";

/** "Contagem no topo (barra)" fixa: selo logo abaixo dela (sem cobrir as caixinhas), com espaço só no canvas. */
const BAR = '[data-os-widget=countdown][data-os-cd-style=bar]:not([data-os-sticky="0"])';

/** Cabeçalho de loja fixo no topo ao rolar: o mesmo selo da barra. */
const SH_STICKY = '[data-os-widget=store-header][data-os-sticky="1"]';

/** Endereço que não leva a lugar nenhum. */
const VOID_HREF = ':is(:not([href]),[href=""],[href="#"])';

/**
 * Cabeçalho de loja sem para onde levar a busca: a página do editor não tem
 * vitrine e o logo não leva à página da loja (nem a um link da oferta).
 */
const SH_LOST = `:root:not(:has([data-os-widget=products])) [data-os-widget=store-header]:has(.os-sh-logo${VOID_HREF}:is(:not([data-os-link]),[data-os-link=""]))`;
/** …com a pesquisa ligada. */
const SH_SEARCH_ON = ':not([data-os-sh-search="0"])';
/** …com a linha de categorias ligada e uma categoria sem destino (o clique dela é uma busca). */
const SH_CATS_LOST = `:not([data-os-sh-cats="0"]):has(a.os-sh-cat${VOID_HREF}:is(:not([data-os-link]),[data-os-link=""]):not([data-os-pay]))`;

/**
 * Cartão da vitrine de produtos sem destino (sem página, endereço, pagamento
 * na página nem link da oferta com destino): marcado só no desenho do canvas
 * por src/editor/widgets/products.ts. A foto cobriria o contorno (outline com
 * recuo) desse aviso e o da seleção do GrapesJS: os dois vão também num
 * ::before por cima do cartão.
 */
const NO_DEST = `a[data-os-product][${PRODUCT_NO_DEST_ATTR}]`;

/** "Ver todas" ligado na vitrine e sem destino (sem endereço nem link da oferta). */
const MORE_NO_DEST = `[data-os-widget=products][data-os-show-more="1"] a.os-pd-more${VOID_HREF}:is(:not([data-os-link]),[data-os-link=""])`;

/**
 * "‹ Voltar para a loja" sem destino numa página sem a página da loja no logo
 * do cabeçalho: na página, só volta para quem veio de outra página do site.
 */
const BACK_LOST = `:root:not(:has([data-os-widget=store-header] .os-sh-logo:is(:not(${VOID_HREF}),[data-os-link]:not([data-os-link=""])))) a[data-os-pd-back]${VOID_HREF}:is(:not([data-os-link]),[data-os-link=""]):not([data-os-pay])`;

/**
 * Avisos do canvas nos pseudo-elementos do cabeçalho de loja: o CSS de página
 * clonada para header::before/::after e nav::before (camada escura de "header
 * herói", enfeites) ainda valeria no que o aviso não define e o transformaria
 * numa camada por cima do cabeçalho. `SH_NOTE_FLOW`: aviso na linha (o da
 * página da loja e o das categorias); `SH_NOTE_BOX`: o selo de baixo (posição
 * própria).
 */
const SH_NOTE_BOX = "right:auto;bottom:auto;float:none;height:auto;min-height:0;opacity:1;visibility:visible;";
const SH_NOTE_FLOW = `position:static;top:auto;left:auto;transform:none;${SH_NOTE_BOX}`;

/**
 * Carrinho e "Entre" do cabeçalho de loja ligados e ainda sem o link da oferta
 * (data-os-link=""; desligados, o pedido sai): no lugar do balão de cada um
 * (que cobriria o logo e a pesquisa, sobretudo no celular), uma linha do
 * cabeçalho logo abaixo da linha deles, como os outros avisos dele.
 */
const SH_CART_NEED = '[data-os-widget=store-header]:not([data-os-sh-cart="0"]):has(a.os-sh-cart[data-os-link=""])';
const SH_ACC_NEED = '[data-os-widget=store-header][data-os-sh-account="1"]:has(a.os-sh-acc[data-os-link=""])';

/** Elementos de bloco (o rótulo entra como primeira linha; em texto e imagens, só o contorno). */
const BLOCKISH = ":not(span,a,img,button,strong,em,b,i,code,input,video,iframe,svg)";

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
[data-os-widget=quiz] [data-os-qz-step]{margin-bottom:34px!important}
[data-os-widget=wheel] [data-os-wh-result][hidden]{display:block!important}
[data-os-widget=wheel] [data-os-wh-coupon][hidden]{display:flex!important}
${BAR},${SH_STICKY}{margin-bottom:34px!important}
[data-os-widget=product-gallery] .os-pg-thumb:only-child{display:block!important}
/* "Esconder sobreposições" (botão da barra): tira do caminho tudo que flutua por
   cima — o que o overlay-hider marca (fixo/sticky/modal, inclusive de clonadas) e
   o pop-up de saída / notificação do próprio Offer Studio. Vence o os-original. */
:root[${OVERLAY_HIDE_ROOT_ATTR}] [${OVERLAY_TAG_ATTR}],
:root[${OVERLAY_HIDE_ROOT_ATTR}] [data-os-widget=exit-popup],
:root[${OVERLAY_HIDE_ROOT_ATTR}] [data-os-widget=sales-notification]{display:none!important}
}
${BAR},${SH_STICKY}{position:relative;outline:2px dashed #8b5cf6;outline-offset:-2px}
${BAR}::after,${SH_STICKY}::after{
  content:"Barra fixa no topo (na página, acompanha a rolagem)";${LABEL}${SH_NOTE_BOX}
  position:absolute;left:50%;top:100%;z-index:5;margin:0;max-width:calc(100% - 16px);transform:translate(-50%,4px);
  text-align:center;pointer-events:none;box-shadow:0 2px 6px rgba(0,0,0,.18);
}
${SH_STICKY}::after{content:"Cabeçalho fixo no topo (na página, acompanha a rolagem)"}
:is(${HIDDEN_HOST}) :is(${BAR},${SH_STICKY})::after{content:"Fica no lugar: está dentro de um bloco que nem sempre aparece (atraso, popup, quiz ou roleta)"}
${SH_LOST}:is(${SH_SEARCH_ON},${SH_CATS_LOST})::before{
  content:"Escolha a página da loja em Configurações para a pesquisa funcionar nesta página";${LABEL}${SH_NOTE_FLOW}
  width:auto;max-width:none;margin:0;border-radius:0;background:#fef3c7;color:#92400e;text-align:center;
}
${SH_LOST}${SH_SEARCH_ON}${SH_CATS_LOST}::before{content:"Escolha a página da loja em Configurações para a pesquisa e as categorias funcionarem nesta página"}
${SH_LOST}[data-os-sh-search="0"]${SH_CATS_LOST}::before{content:"Escolha a página da loja em Configurações para as categorias funcionarem nesta página"}
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
[data-os-widget=quiz] [data-os-qz-step]{position:relative;border-radius:14px;outline:2px dashed #c4b5fd;outline-offset:6px}
[data-os-widget=quiz] [data-os-qz-step][data-os-qz-badge]::before{content:attr(data-os-qz-badge);${LABEL}}
[data-os-widget=wheel][data-os-wh-badge]::before{content:attr(data-os-wh-badge);${LABEL}width:auto;max-width:100%;margin:0 auto 16px;background:#fef3c7;color:#92400e;text-align:center}
[data-os-widget=wheel] [data-os-wh-result]{position:static!important;inset:auto!important;padding:0!important;background-color:transparent!important;outline:2px dashed #86efac;outline-offset:6px}
[data-os-widget=wheel] [data-os-wh-result]::before{content:"Resultado (aparece depois do giro)";${LABEL}margin:0 auto 12px}
[data-os-widget=wheel] [data-os-wh-lose]{margin-top:14px;padding-top:12px;border-top:1px dashed #86efac}
[data-os-widget=wheel] [data-os-wh-lose]::before{content:"Quem cair numa fatia sem prêmio vê:";${LABEL}margin:0 auto 8px}
[data-os-widget=wheel] [data-os-wh-coupon]::before{content:"Aparece só quando o prêmio tem cupom";${LABEL}flex-basis:100%;margin:0 auto 4px}
[data-os-widget=wheel] [data-os-wh-again]{position:static!important;inset:auto!important;padding:0!important;background-color:transparent!important;margin-top:20px;outline:2px dashed #93c5fd;outline-offset:8px}
[data-os-widget=wheel] [data-os-wh-again]::before{content:"Modal “mais uma chance” (aparece se não ganhar e a 2ª chance estiver ligada)";${LABEL}margin:0 auto 12px}
[data-os-widget=access] .os-ac-part{position:relative;margin-bottom:26px;padding:4px;border-radius:12px;outline:2px dashed #c4b5fd;outline-offset:6px}
[data-os-widget=access] .os-ac-part::before{${LABEL}margin:0 auto 12px}
[data-os-widget=access] [data-os-ac-wait]::before{content:"Enquanto confere o pagamento"}
[data-os-widget=access] [data-os-ac-ok]::before{content:"Pagamento confirmado: o botão leva ao link de acesso do produto (vem do servidor, só para quem pagou)"}
[data-os-widget=access] [data-os-ac-none]::before{content:"Sem pagamento confirmado (sem pedido, não pago ou pendente demais)"}
[${PRIZE_SHOW_ATTR}]{outline:2px dashed #db2777;outline-offset:3px}
[${PRIZE_SHOW_ATTR}]${BLOCKISH}::before{${LABEL}background:#fce7f3;color:#9d174d}
[${PRIZE_SHOW_ATTR}=ganhou]${BLOCKISH}::before{content:"Roleta: só para quem ganhou prêmio"}
[${PRIZE_SHOW_ATTR}=nao]${BLOCKISH}::before{content:"Roleta: só para quem não ganhou prêmio"}
a.os-sh-cat[data-os-cv-nada]{outline:2px dashed #f59e0b;outline-offset:2px}
[data-os-widget=store-header] .os-sh-cats:has(a[data-os-cv-nada])::before{
  content:"Categoria com contorno: nenhum produto desta página tem esse nome — clique nela e escolha para onde leva (ou troque o texto)";
  ${LABEL}${SH_NOTE_FLOW}width:auto;max-width:none;margin:0;border-radius:0;background:#fef3c7;color:#92400e;text-align:center;
}
${MORE_NO_DEST}{outline:2px dashed #f59e0b;outline-offset:2px}
${MORE_NO_DEST}::after{
  content:"Escolha para onde leva em Configurações (ou desligue o “Ver todas” na vitrine)";display:inline-block;
  margin-left:8px;padding:2px 8px;border-radius:6px;background:#fef3c7;color:#92400e;vertical-align:middle;
  font:600 11px/1.3 system-ui,-apple-system,sans-serif;letter-spacing:0;text-transform:none;white-space:normal;pointer-events:none;
}
${BACK_LOST}{outline:2px dashed #f59e0b;outline-offset:2px}
${BACK_LOST}::after{
  content:"Escolha a página da loja nas Configurações do cabeçalho (ou clique aqui e escolha para onde leva)";display:inline-block;
  margin-left:8px;padding:2px 8px;border-radius:6px;background:#fef3c7;color:#92400e;vertical-align:middle;
  font:600 11px/1.3 system-ui,-apple-system,sans-serif;letter-spacing:0;text-transform:none;white-space:normal;pointer-events:none;
}
${NO_DEST}{outline:2px dashed #f5b74a;outline-offset:-2px}
${NO_DEST}::before,a[data-os-product].gjs-selected::before{
  content:"";position:absolute;top:0;right:0;bottom:0;left:0;z-index:3;border-radius:inherit;pointer-events:none;
}
${NO_DEST}::before{border:2px dashed #f5b74a}
a[data-os-product].gjs-selected::before{border:2px solid #3b97e3}
[data-os-widget=products][${PRODUCTS_WARN_ATTR}]::before{content:attr(${PRODUCTS_WARN_ATTR});${LABEL}width:auto;max-width:100%;background:#fef3c7;color:#92400e}
a[data-os-link=""]{position:relative}
a[data-os-link=""]::after{
  content:"Escolha o link da oferta em Configurações";position:absolute;right:-6px;top:-11px;
  white-space:nowrap;padding:3px 8px;border-radius:6px;background:#4f46e5;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.2);
  font:600 11px/1.2 system-ui,-apple-system,sans-serif;letter-spacing:0;text-transform:none;pointer-events:none;z-index:5;
}
[data-os-widget=store-header] a[data-os-link=""]::after{content:none}
:is(${SH_CART_NEED},${SH_ACC_NEED}) .os-sh-main::after{
  content:"Carrinho sem destino: clique nele e escolha o link da oferta em Configurações";${LABEL}${SH_NOTE_FLOW}
  width:auto;max-width:none;margin:0;border-radius:0;background:#eef2ff;color:#3730a3;text-align:center;
}
${SH_ACC_NEED} .os-sh-main::after{content:"“Entre” sem destino: clique nele e escolha o link da oferta em Configurações"}
${SH_ACC_NEED}:not([data-os-sh-cart="0"]):has(a.os-sh-cart[data-os-link=""]) .os-sh-main::after{content:"Carrinho e “Entre” sem destino: clique em cada um e escolha o link da oferta em Configurações"}
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
