/**
 * Checkout do Offer Studio no ZIP: os avisos do que falta configurar
 * (src/lib/export/warnings.ts → checkoutIssueWarning) e os consertos da tela
 * do ZIP ("Abrir o link", "Abrir a conta da …", "Abrir no editor").
 */
import { type CheckoutCheck, type CheckoutIssue, checkoutIssues } from "@/lib/checkout/checks";
import type { CheckoutProviderId } from "@/lib/checkout/rules";
import { type PagamentoCheckout, pagamentoCheckoutOf } from "@/lib/export/checkout-php";
import { checkoutIssueWarning } from "@/lib/export/warnings";
import { orderProductCode } from "@/lib/payments/orders";
import { offerCheckoutCheck } from "@/server/services/checkout/checks";
import { offerCheckoutProducts, type ServerCheckoutProduct } from "@/server/services/checkout/products";
import { paymentGatewayKey } from "@/server/services/payments/gateways";

export interface CheckoutExport {
  offerId: string;
  check: CheckoutCheck;
  issues: CheckoutIssue[];
  /** Produtos ativos (cada um vira checkout/<chave>/index.html e uma entrada do config.php). */
  products: ServerCheckoutProduct[];
}

/** null = a oferta não tem link "Checkout do Offer Studio" com produto. */
export async function loadCheckoutExport(offerId: string): Promise<CheckoutExport | null> {
  const [check, products] = await Promise.all([offerCheckoutCheck(offerId), offerCheckoutProducts(offerId)]);
  if (!check || !products.length) return null;
  return { offerId, check, issues: checkoutIssues(check), products };
}

/** Gateways usados pelos checkouts da oferta (na ordem: FlevoPay, BlackCat, ClownPay, Kyvo). */
export function checkoutGateways(checkout: CheckoutExport | null): CheckoutProviderId[] {
  if (!checkout) return [];
  const used = new Set(checkout.products.map((p) => p.provider));
  return (["FLEVOPAY", "BLACKCAT", "CLOWNPAY", "KYVO"] as const).filter((p) => used.has(p));
}

/**
 * Chave de um gateway do checkout para o config.php (lida aqui, no worker):
 * vazia quando falta, não pôde ser lida, foi recusada ou a conta não foi
 * liberada no último "Testar conexão" (o aviso do ZIP já diz como resolver; o
 * pagamento.php responde "configuracao" em vez de cobrar).
 */
export async function zipCheckoutKey(checkout: CheckoutExport, provider: CheckoutProviderId): Promise<string> {
  if (checkout.check.keys[provider] !== "ok") return "";
  try {
    return (await paymentGatewayKey(checkout.offerId, provider)) ?? "";
  } catch {
    return "";
  }
}

/** Checkouts do config.php (preços, campos, bumps, frete e links de acesso; a página de obrigado relativa à raiz). */
export function zipCheckouts(checkout: CheckoutExport, pageDirs: Record<string, string>): PagamentoCheckout[] {
  return checkout.products.map((p) =>
    pagamentoCheckoutOf(p, {
      code: orderProductCode(p.key, p.linkId),
      thankYou: p.thankYouPageId ? (pageDirs[p.thankYouPageId] ?? null) : null,
    }),
  );
}

/**
 * Avisos do checkout do Offer Studio (o que falta para cobrar e entregar).
 * `purchaseWarned`: o pagamento na página já avisou da regra de Purchase
 * automática (o mesmo conserto, sem repetir).
 */
export function checkoutWarnings(checkout: CheckoutExport | null, purchaseWarned = false): string[] {
  if (!checkout) return [];
  return checkout.issues.filter((i) => !(purchaseWarned && i.kind === "doublePurchase")).map(checkoutIssueWarning);
}

/** Consertos dos avisos para a tela do ZIP. */
export function checkoutPlanFixes(checkout: CheckoutExport | null): {
  checkoutLinks?: { linkId: string; label: string }[];
  accessBlockPages?: { name: string; documentId: string }[];
} {
  if (!checkout) return {};
  const links = checkout.issues.flatMap((i) =>
    i.kind === "product" || i.kind === "shipping" || i.kind === "texts" ? [{ linkId: i.linkId, label: i.label }] : [],
  );
  const pages = checkout.issues.flatMap((i) =>
    i.kind === "accessBlock" || i.kind === "accessLang" ? [{ name: i.pageName, documentId: i.documentId }] : [],
  );
  return {
    ...(links.length ? { checkoutLinks: links } : {}),
    ...(pages.length ? { accessBlockPages: pages } : {}),
  };
}
