/**
 * CSS de comportamento da página do produto (posto pelo próprio script, só
 * nas páginas que o carregam): a barra de compra fixa do celular, o espaço
 * dela no fim da página (do tamanho da barra: --os-pb-sp, posto pelo script)
 * e a notificação de compra subindo enquanto ela aparece. Compacto de propósito. O visual da galeria e da caixa de compra
 * vem das regras editáveis do editor (src/editor/widgets/product-page-content.ts).
 */
export const PRODUCT_CSS =
  ".os-pb-bar,.os-pb-sp{display:none}" +
  "@media (max-width:768px){" +
  ".os-pb-sp{display:block;height:var(--os-pb-sp,0px)}" +
  ".os-pb-bar{position:fixed;left:0;right:0;bottom:0;z-index:2147482950;display:flex;align-items:center;box-sizing:border-box;margin:0;" +
  "padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:#fff;color:#333;font-family:inherit;line-height:1.2;" +
  "box-shadow:0 -2px 12px #00000026;transform:translateY(110%);visibility:hidden;transition:transform .25s,visibility .25s}" +
  ".os-pb-bar.os-pb-on{transform:none;visibility:visible}" +
  ".os-pb-bar-p{flex:1 1 auto;min-width:0;margin-right:12px}" +
  ".os-pb-bar .os-pd-now{display:block;font-size:22px;white-space:nowrap}" +
  ".os-pb-bar .os-pd-dec{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}" +
  ".os-pb-bar .os-pd-cents{position:relative;top:-.6em;margin-left:1px;font-size:50%;line-height:0}" +
  ".os-pb-bar .os-pd-inst{display:block;overflow:hidden;font-size:12px;white-space:nowrap;text-overflow:ellipsis}" +
  ".os-pb-bar .os-pd-free{color:#00863f}" +
  ".os-pb-bar-go{flex:0 0 auto;max-width:62%;margin:0;padding:13px 18px;border:0;border-radius:6px;background:#1f63d6;color:#fff;" +
  "font-family:inherit;font-size:16px;font-weight:600;line-height:1.2;cursor:pointer}" +
  ".os-pb-bar-go:focus-visible{outline:3px solid #111827;outline-offset:2px}" +
  ".os-pb-up .os-sn{bottom:calc(var(--os-pb-h) + 12px)}}" +
  "@media (prefers-reduced-motion:reduce){.os-pb-bar{transition:none}}";
