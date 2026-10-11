/**
 * CSS dos widgets na página publicada (prévia e ZIP). O visual de cada bloco
 * vem das regras editáveis do editor; aqui ficam só estados de comportamento
 * (popup aberto, notificação visível, etapa atual do quiz, roleta girando e o
 * resultado, produtos escondidos pela busca da loja e a linha de resultados),
 * animações e mensagens do formulário.
 * Classes com prefixo os- (colocadas pelo script) para não brigar com a página.
 * (Realce e pulso dos botões vão no CSS da própria página: ver
 * src/editor/widgets/button.ts.)
 * Compacto de propósito: entra no script de todas as páginas.
 */
import { BAR_COLORS, BAR_SIZES } from "@/lib/countdown-bar";

export const WIDGET_CSS =
  // Barra de escassez (listras andando enquanto diminui).
  "[data-os-sc-fill]{transition:width .8s}" +
  ".os-sc-a [data-os-sc-fill]{background-image:linear-gradient(45deg,#fff3 25%,#0000 25% 50%,#fff3 50% 75%,#0000 75%);background-size:22px 22px;animation:os-s 1s linear infinite}@keyframes os-s{to{background-position:22px 0}}" +
  // Notificação de compra.
  ".os-sn{position:fixed!important;z-index:2147483000;left:16px;bottom:16px;width:340px;max-width:calc(100vw - 32px);margin:0!important;opacity:0;transform:translateY(16px);transition:.35s;pointer-events:none}" +
  ".os-sn-r{left:auto;right:16px}.os-sn.os-show{opacity:1;transform:none;pointer-events:auto}" +
  // Popup de saída aberto.
  ".os-pop{position:fixed!important;top:0;right:0;bottom:0;left:0;z-index:2147483600;display:flex!important;margin:0!important;padding:16px;width:auto!important;max-width:none!important;background:#0a0c14b8;overflow:auto}" +
  ".os-pop>*{margin:auto!important}.os-lock,.os-lock body{overflow:hidden!important}" +
  ".os-pop-x{position:absolute;top:8px;right:8px;width:40px;height:40px;border:0;border-radius:50%;background:#0001;color:inherit;font:26px/1 sans-serif}" +
  // Formulário de captura.
  ".os-lf-err{display:block;margin-top:6px;color:#dc2626;font-size:14px;text-align:left}[aria-invalid=true]{border-color:#dc2626!important}" +
  ".os-lf-ok{margin:12px 0 0;padding:12px;border-radius:10px;background:#dcfce7;color:#166534;font-weight:600;text-align:center}" +
  ".os-lf-warn{background:#fef3c7;color:#92400e}" +
  // Contador: caixa "dias" (menos de um dia) e encerrado.
  '[data-os-cd-days="0"] [data-os-cd-unit=d]{display:none!important}.os-cd-exp{font-weight:800;text-align:center}' +
  // Quiz: só a etapa atual, entrando com uma transição; "Voltar" some na primeira etapa e no fim.
  ".os-qz-on [data-os-qz-step]:not(.os-qz-cur){display:none!important}" +
  ".os-qz-in{animation:os-qz .35s ease-out both}@keyframes os-qz{from{opacity:0;transform:translateY(14px)}}" +
  // (só o "Voltar" do próprio quiz, no topo dele: não o de um quiz dentro de uma etapa).
  ".os-qz-noback>*>[data-os-qz-back]{display:none!important}[data-os-qz-step] [tabindex='-1']:focus{outline:0}" +
  ".os-qz-sr,.os-wh-sr{position:absolute!important;width:1px;height:1px;margin:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
  // Roleta: depois do giro some o "Girar"; quem não ganhou vê o texto de "não foi dessa vez" (sem a observação do desconto).
  ".os-wh-done [data-os-wh-spin]{display:none!important}.os-wh-on:not(.os-wh-lost) [data-os-wh-lose]," +
  ".os-wh-lost [data-os-wh-win],.os-wh-lost [data-os-wh-prize],.os-wh-lost [data-os-wh-coupon],.os-wh-lost [data-os-wh-note],.os-wh-lost .os-wh-note{display:none!important}" +
  ".os-wh-done [data-os-wh-result]{animation:os-qz .45s ease-out both}" +
  ".os-wh-spinning .os-wh-ptr{animation:os-wh-t .14s ease-in-out infinite alternate;transform-origin:50% 0}@keyframes os-wh-t{from{transform:rotate(-8deg)}to{transform:rotate(8deg)}}" +
  ".os-wh-cf{position:fixed;top:0;left:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:2147483600}" +
  ".os-wh-cf i{position:absolute;top:-16px;width:9px;height:14px;border-radius:2px;animation:os-wh-f 3s cubic-bezier(.25,.6,.45,1) both}" +
  "@keyframes os-wh-f{to{transform:translate3d(var(--x),112vh,0) rotate(var(--r))}}" +
  // Loja: o que a busca escondeu, a linha de resultados e a sombra do cabeçalho preso no topo.
  ".os-sh-hide{display:none!important}.os-sh-res{box-sizing:border-box;max-width:1200px;margin:14px auto;padding:0 16px;font-size:15px;line-height:1.4;text-align:left}" +
  ".os-sh-res button{margin:0;padding:0;border:0;background:none;color:#1f63d6;font:inherit;font-weight:600;text-decoration:underline;cursor:pointer}" +
  // Linha dentro do cabeçalho preso no topo: nas cores dele.
  ".os-top .os-sh-res{margin:0 auto;padding:8px 16px;font-size:14px}.os-top .os-sh-res button{color:inherit}" +
  ".os-store-header.os-top{box-shadow:0 2px 8px #0002}" +
  "@media (prefers-reduced-motion:reduce){.os-sc-a *,.os-qz-in,.os-wh-done [data-os-wh-result],.os-wh-ptr{animation:none!important}}";

/**
 * Faixa do prêmio da roleta na página de vendas (src/runtime/widgets/prize.ts):
 * o mesmo visual da "Contagem no topo (barra)" (src/lib/countdown-bar.ts) —
 * barra preta fina, frase, "TERMINA EM" e o tempo em caixinhas —, com o cupom
 * (copiar) e o fechar. Fixa no topo pela classe os-top (src/runtime/widgets/top.ts).
 */
const K = BAR_COLORS;
const Z = BAR_SIZES;
export const PRIZE_CSS =
  `.os-pz{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:${Z.gap};padding:${Z.pad};padding-right:48px;background:${K.bg};color:${K.text};font-size:${Z.msg};font-weight:${Z.weight};line-height:1.3;text-align:center}` +
  ".os-pz p{margin:0}.os-pz b{font-weight:inherit;color:inherit}" +
  `.os-pz-tm{display:flex;align-items:center;justify-content:center;gap:${Z.sepGap};white-space:nowrap}` +
  `.os-pz-l{margin-right:6px;font-size:${Z.label};font-weight:600;letter-spacing:${Z.labelSpacing};text-transform:uppercase;opacity:.9}` +
  `.os-pz-t{display:flex;align-items:center;gap:${Z.sepGap};font-variant-numeric:tabular-nums}` +
  `.os-pz .os-pz-t b{min-width:${Z.boxW};padding:${Z.boxPad};border:1px solid ${K.boxBorder};border-radius:6px;background:${K.boxBg};color:${K.num};font-size:${Z.num};font-weight:${Z.weight};line-height:22px;box-sizing:border-box}` +
  // Faixa aberta: substitui a "Contagem no topo (barra)" da página (classe os-pz-on, prize.ts).
  ".os-pz-on [data-os-widget=countdown][data-os-cd-style=bar]{display:none!important}" +
  `.os-pz-cp{display:inline-flex;align-items:center;gap:8px;padding:2px 2px 2px 10px;border:1px dashed ${K.boxBorder};border-radius:7px;font-size:13px;font-weight:600}` +
  `.os-pz-cp code{font:800 13px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;color:${K.num}}` +
  `.os-pz-cp button{margin:0;padding:5px 10px;border:0;border-radius:5px;background:${K.num};color:#111827;font-family:inherit;font-size:12px;font-weight:800;line-height:1;cursor:pointer}` +
  ".os-pz-x{position:absolute;top:50%;right:8px;width:30px;height:30px;margin:-15px 0 0;padding:0;border:0;border-radius:50%;background:#ffffff1f;color:#fff;font:20px/1 sans-serif;cursor:pointer}" +
  `.os-pz button:focus-visible{outline:3px solid ${K.num};outline-offset:2px}` +
  `@media (max-width:480px){.os-pz{gap:${Z.gapMobile};padding:${Z.padMobile};padding-right:40px;font-size:${Z.msgMobile}}` +
  `.os-pz-l{margin-right:2px;font-size:${Z.labelMobile}}.os-pz-tm,.os-pz-t{gap:${Z.sepGapMobile}}` +
  `.os-pz .os-pz-t b{min-width:${Z.boxWMobile};padding:${Z.boxPadMobile};font-size:${Z.numMobile};line-height:20px}.os-pz-x{right:4px}}`;
