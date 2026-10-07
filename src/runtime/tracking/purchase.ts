/**
 * Pagamento na página (janela de pagamento, src/runtime/payments) no
 * rastreamento:
 *
 * - Compra confirmada: a janela avisa com o evento "os:purchase"
 *   ({ id: pedidoExterno, value, currency }) e aqui ele vira o Purchase dos
 *   pixels (e do eventos.php), pelo mesmo `fire` dos outros eventos
 *   (consentimento: espera o "Aceitar"; "Recusar" bloqueia), com o valor e a
 *   moeda do PRODUTO (não o valor fixo da oferta) e eventID = pedidoExterno —
 *   o mesmo event_id do Purchase que o gateway (Kyvo) manda pelo servidor: a
 *   Meta e o TikTok juntam os dois pelo eventID; o GA4 e o Google Ads
 *   identificam a compra pelo transaction_id (= pedidoExterno, ./vendors.ts).
 *   A janela avisa uma vez só por pedido.
 * - A metadata da cobrança (UTMs e, com permissão, IDs de clique e cookies de
 *   anúncio) é montada no script da janela (src/runtime/payments/meta.ts) com
 *   os parâmetros de window.__osTracking.payMeta() (./index.ts), a permissão de
 *   window.osConsent.granted() e a versão A/B do #os-tracking: o código fica
 *   fora deste script, que vai em todas as páginas.
 */
import type { Ev } from "./config";

/** Purchase da janela de pagamento (valor e moeda do produto; eventID = pedidoExterno). */
export interface PurchaseEvent {
  std: Ev;
  id: string;
  amount: { value: number; currency: string };
}

/** Evento para um aviso "os:purchase" (null = inválido). */
export function purchaseEvent(detail: unknown): PurchaseEvent | null {
  const d = (detail || {}) as { id: string; value: number; currency: string };
  return /^[\w.:-]{1,100}$/.test(d.id) && d.value >= 0 && d.value <= 1e7 && /^[A-Z]{3}$/.test(d.currency)
    ? { std: "PURCHASE", id: d.id, amount: { value: d.value, currency: d.currency } }
    : null;
}

/** Sem depender de ./util: purchaseEvent é testado fora do navegador. A janela avisa uma vez por pedido. */
export function startPurchaseEvents(fire: (ev: PurchaseEvent) => void) {
  document.addEventListener("os:purchase", (e) => {
    const ev = purchaseEvent((e as CustomEvent).detail);
    if (ev) fire(ev);
  });
}
