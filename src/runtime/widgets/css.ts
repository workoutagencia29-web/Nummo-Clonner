/**
 * CSS dos widgets na página publicada (prévia e ZIP). O visual de cada bloco
 * vem das regras editáveis do editor; aqui ficam só estados de comportamento
 * (popup aberto, notificação visível, etapa atual do quiz, roleta girando e o
 * resultado), animações e mensagens do formulário.
 * Classes com prefixo os- (colocadas pelo script) para não brigar com a página.
 * (Realce e pulso dos botões vão no CSS da própria página: ver
 * src/editor/widgets/button.ts.)
 * Compacto de propósito: entra no script de todas as páginas.
 */
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
  "@media (prefers-reduced-motion:reduce){.os-sc-a *,.os-qz-in,.os-wh-done [data-os-wh-result],.os-wh-ptr{animation:none!important}}";

/**
 * Faixa do prêmio da roleta na página de vendas (src/runtime/widgets/prize.ts):
 * fixa no topo, escura e discreta, com o contador em destaque e o cupom.
 */
export const PRIZE_CSS =
  ".os-pz{position:fixed;top:0;left:0;right:0;z-index:2147483000;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 14px;margin:0;padding:9px 46px 9px 14px;background:#111827;color:#fff;font:600 14px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;text-align:center;box-shadow:0 6px 18px rgba(0,0,0,.25)}" +
  ".os-pz p{margin:0}.os-pz b{font-weight:800;color:#fde047}" +
  ".os-pz .os-pz-t{display:inline-block;min-width:3.4em;margin-left:2px;padding:1px 7px;border-radius:6px;background:#fde047;color:#111827;font-variant-numeric:tabular-nums}" +
  ".os-pz-cp{display:inline-flex;align-items:center;gap:8px;padding:3px 3px 3px 10px;border:1px dashed #fde047;border-radius:9px;font-size:13px}" +
  ".os-pz-cp code{font:800 13px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;color:#fff}" +
  ".os-pz-cp button{margin:0;padding:5px 10px;border:0;border-radius:6px;background:#fde047;color:#111827;font-family:inherit;font-size:12px;font-weight:800;line-height:1;cursor:pointer}" +
  ".os-pz-x{position:absolute;top:50%;right:8px;width:30px;height:30px;margin:-15px 0 0;padding:0;border:0;border-radius:50%;background:#ffffff1f;color:#fff;font:20px/1 sans-serif;cursor:pointer}" +
  ".os-pz button:focus-visible{outline:3px solid #fde047;outline-offset:2px}" +
  "@media (max-width:480px){.os-pz{gap:6px 10px;padding:8px 42px 8px 10px;font-size:13px}}";
