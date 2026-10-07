/**
 * Pagamento na página no HTML servido (prévia e ZIP): o JSON público
 * #os-pagamento (PaymentPageConfig, ver ./contract) no <head> e o script da
 * janela de pagamento (src/runtime/payments) antes do </body> — só nas
 * ofertas com produto de pagamento. Os botões ganham data-os-pay em
 * applyOfferLinks (src/lib/offer-links.ts).
 */
import { scriptString } from "@/lib/export/head";
import { inlinePaymentScriptTag, PAYMENT_SCRIPT_ATTR } from "@/lib/runtime-bundle";
import { injectAtHeadStart } from "@/lib/tracking/inject";
import {
  ORDER_PARAM,
  ORDER_STORE_PREFIX,
  PAYMENT_CONFIG_ID,
  PAYMENT_CONFIG_VERSION,
  type PaymentPageConfig,
  type PublicPaymentProduct,
} from "./contract";

/** O que o render precisa para levar o pagamento à página. */
export interface PaymentRender {
  /** Endpoint relativo à página (prévia: /__os/pagamento; ZIP: caminho do pagamento.php). */
  endpoint: string;
  /** Prévia do app: sempre simulação (nada é cobrado). */
  simulation: boolean;
  /** Chave do link → produto público (com o endereço da página de obrigado já relativo à página). */
  products: Record<string, PublicPaymentProduct>;
  /**
   * Tag do script da janela de pagamento (prévia: PAYMENT_SCRIPT_TAG; ZIP: assets/os-pagamento-<hash>.js).
   * Sem ela, o script vai embutido na página.
   */
  scriptTag?: string;
}

/** Configuração embutida na página (null = a oferta não tem produto de pagamento). */
export function paymentPageConfig(render: PaymentRender | null | undefined): PaymentPageConfig | null {
  if (!render || !Object.keys(render.products).length) return null;
  return {
    v: PAYMENT_CONFIG_VERSION,
    endpoint: render.endpoint,
    simulacao: render.simulation,
    produtos: render.products,
  };
}

/** Atributo do script que tira o ?pedido= do endereço. */
export const ORDER_STRIP_ATTR = "data-os-pedido";

/**
 * Tira o ?pedido= do endereço antes dos pixels (dl da Meta, page_location do
 * GA4, TikTok, event_source_url do eventos.php) e dos scripts de terceiros
 * (UTMify, chat, scripts clonados): é a credencial do link de acesso. Guarda o
 * pedido para o bloco de acesso (src/runtime/payments/access.ts). Safari 13:
 * ES5, sem desestruturação.
 */
export const ORDER_STRIP_SCRIPT = `<script ${ORDER_STRIP_ATTR}>(function(){try{var u=new URL(location.href),p=u.searchParams.get(${JSON.stringify(
  ORDER_PARAM,
)});if(!p)return;window.__osPedido=p;try{sessionStorage.setItem(${JSON.stringify(
  ORDER_STORE_PREFIX,
)}+u.pathname,p)}catch(e){}u.searchParams.delete(${JSON.stringify(
  ORDER_PARAM,
)});history.replaceState(history.state,"",u.pathname+u.search+u.hash)}catch(e){}})();</script>`;

/**
 * Põe o script que tira o ?pedido= no começo do <head> — depois do
 * rastreamento já injetado, para ficar na frente dele (uma vez).
 */
export function injectOrderStrip(html: string, render: PaymentRender | null | undefined): string {
  if (!paymentPageConfig(render) || html.includes(ORDER_STRIP_ATTR)) return html;
  return injectAtHeadStart(html, ORDER_STRIP_SCRIPT);
}

/** Põe o #os-pagamento antes do </head> e o script da janela antes do </body> (uma vez cada). */
export function injectPaymentConfig(html: string, render: PaymentRender | null | undefined): string {
  const config = paymentPageConfig(render);
  if (!config || !render) return html;
  let out = html;
  if (!out.includes(`id="${PAYMENT_CONFIG_ID}"`)) {
    const tag = `<script type="application/json" id="${PAYMENT_CONFIG_ID}">${scriptString(config)}</script>`;
    out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, (m) => `${tag}${m}`) : `${tag}${out}`;
  }
  if (!out.includes(PAYMENT_SCRIPT_ATTR)) {
    // Por função: o script embutido pode ter "$&", "$1"… que o replace com texto interpretaria.
    const script = render.scriptTag ?? inlinePaymentScriptTag();
    out = /<\/body>/i.test(out)
      ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, (m) => `${script}${m}`)
      : `${out}${script}`;
  }
  return out;
}
