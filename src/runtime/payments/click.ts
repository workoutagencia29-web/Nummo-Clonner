/**
 * Botões de "Pagamento na página" no script das páginas (src/runtime/os-runtime.ts):
 * data-os-pay="<chave do link>" (posto pelo render, ou pelo prêmio da roleta)
 * abre a janela de pagamento do produto. A janela mora num script à parte
 * (./index.ts → window.__osPay), que o render só põe nas ofertas com
 * pagamento: as outras páginas não carregam nada disso.
 *
 * O clique é tratado na captura do documento: depois do rastreamento (que já
 * contou o InitiateCheckout na captura da janela) e antes dos scripts da
 * página. O href="#" do botão nunca leva ao topo da página.
 */
import { PAY_ATTR, PAYMENT_CONFIG_ID } from "@/lib/payments/contract";

/** O que o script da janela de pagamento expõe (./index.ts). */
export interface PayApi {
  open(key: string, trigger: Element): boolean;
}

/**
 * Bloco "Acesso ao produto" numa página sem pagamento (#os-pagamento): sem o
 * script da janela (que liga o bloco, ./access.ts), mostra a mensagem de
 * "não encontramos seu pagamento" em vez de ficar em "confirmando".
 */
function accessFallback() {
  if (document.getElementById(PAYMENT_CONFIG_ID)) return;
  for (const el of Array.from(document.querySelectorAll('[data-os-widget="access"]'))) el.classList.add("os-ac-none");
}

export function initPayments() {
  accessFallback();
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target as Element | null;
      const el = target?.closest?.(`[${PAY_ATTR}]`);
      if (!el) return;
      e.preventDefault();
      const key = el.getAttribute(PAY_ATTR) || "";
      const api = (window as unknown as { __osPay?: PayApi }).__osPay;
      if (!api || !api.open(key, el)) {
        console.warn(`[Offer Studio] Pagamento “${key}” sem produto configurado nesta página.`);
      }
    },
    true,
  );
}
