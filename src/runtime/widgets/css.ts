/**
 * CSS dos widgets na página publicada (prévia e ZIP). O visual de cada bloco
 * vem das regras editáveis do editor; aqui ficam só estados de comportamento
 * (popup aberto, notificação visível), animações e mensagens do formulário.
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
  "@media (prefers-reduced-motion:reduce){.os-sc-a *{animation:none!important}}";
