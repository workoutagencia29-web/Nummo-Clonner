/**
 * Pagamento na página no ZIP: o que vai no pagamento-dados/config.php (a chave
 * do gateway e os produtos), o que vai em cada página (#os-pagamento com o
 * caminho relativo do pagamento.php) e os avisos (src/lib/export/warnings.ts).
 * A chave só é lida na montagem (worker), nunca na prévia do ZIP.
 */
import { PAGAMENTO_FILE, type PagamentoConfig } from "@/lib/export/payment-php";
import { PAYMENT_HOSTING_WARNING, paymentIssueWarning } from "@/lib/export/warnings";
import { type PaymentCheck, type PaymentIssue, paymentIssues } from "@/lib/payments/checks";
import { orderProductCode } from "@/lib/payments/orders";
import type { PaymentRender } from "@/lib/payments/render";
import { PROVIDER_LABEL } from "@/lib/payments/rules";
import { offerPaymentCheck } from "@/server/services/payments/checks";
import { paymentGatewayKey } from "@/server/services/payments/gateways";
import {
  offerPaymentProducts,
  payMethodOf,
  paymentRenderFor,
  type ServerPaymentProduct,
} from "@/server/services/payments/products";
import { type CheckoutExport, zipCheckoutKey, zipCheckouts } from "./checkout";

export interface PaymentExport {
  /** Oferta do ZIP: a chave do config.php é a dela. */
  offerId: string;
  check: PaymentCheck;
  issues: PaymentIssue[];
  products: ServerPaymentProduct[];
}

/** null = a oferta não tem "Pagamento na página" (o ZIP sai sem o pagamento.php). */
export async function loadPaymentExport(offerId: string): Promise<PaymentExport | null> {
  const [check, products] = await Promise.all([offerPaymentCheck(offerId), offerPaymentProducts(offerId)]);
  if (!check || !products.length) return null;
  return { offerId, check, issues: paymentIssues(check), products };
}

/** Avisos do pagamento na página (o que falta e a hospedagem com PHP/HTTPS). */
export function paymentWarnings(payment: PaymentExport | null): string[] {
  if (!payment) return [];
  const provider = PROVIDER_LABEL[payment.check.provider];
  return [...payment.issues.map((i) => paymentIssueWarning(i, provider)), PAYMENT_HOSTING_WARNING];
}

/** Consertos dos avisos para a tela do ZIP ("Abrir o link", "Abrir no editor"). */
export function paymentPlanFixes(payment: PaymentExport | null) {
  if (!payment) return {};
  const links = payment.issues.flatMap((i) => (i.kind === "product" ? [{ linkId: i.linkId, label: i.label }] : []));
  const pages = payment.issues.flatMap((i) =>
    i.kind === "accessBlock" || i.kind === "accessLang" ? [{ name: i.pageName, documentId: i.documentId }] : [],
  );
  return {
    hasPayments: true,
    ...(links.length ? { paymentLinks: links } : {}),
    ...(pages.length ? { accessBlockPages: pages } : {}),
  };
}

/**
 * #os-pagamento de uma página do ZIP: pagamento.php e página de obrigado com
 * caminhos relativos a ela. Com checkout do Offer Studio, mesmo sem produto
 * de pagamento na página: o bloco "Acesso ao produto" pergunta ao pagamento.php.
 */
export function zipPaymentRender(
  payment: PaymentExport | null,
  opts: { rel: string; pageHref: (pageId: string) => string; scriptTag: string; checkout?: boolean },
): PaymentRender | null {
  if (!payment && !opts.checkout) return null;
  return paymentRenderFor(
    payment?.products ?? [],
    {
      endpoint: `${opts.rel}${PAGAMENTO_FILE}`,
      simulation: false,
      pageHref: opts.pageHref,
      scriptTag: opts.scriptTag,
    },
    opts.checkout === true,
  );
}

/**
 * pagamento-dados/config.php: as chaves DA OFERTA (lidas aqui, no worker), os
 * produtos do pagamento na página e os checkouts do Offer Studio. Chave
 * ilegível, ausente, recusada ou sem permissão no último "Testar conexão" vai
 * vazia (o aviso já diz como resolver; o pagamento.php responde
 * "configuracao" em vez de cobrar — sem a consulta, quem pagasse não
 * receberia o acesso).
 */
export async function zipPaymentConfig(
  payment: PaymentExport | null,
  pageDirs: Record<string, string>,
  checkout: CheckoutExport | null = null,
): Promise<PagamentoConfig> {
  let apiKey = "";
  if (payment ? payment.check.key === "ok" : checkout?.check.keys.KYVO === "ok") {
    try {
      apiKey = (await paymentGatewayKey(payment?.offerId ?? checkout?.offerId ?? "", "KYVO")) ?? "";
    } catch {
      apiKey = "";
    }
  }
  return {
    apiKey,
    keys: checkout
      ? {
          flevopay: await zipCheckoutKey(checkout, "FLEVOPAY"),
          blackcat: await zipCheckoutKey(checkout, "BLACKCAT"),
          clownpay: await zipCheckoutKey(checkout, "CLOWNPAY"),
        }
      : {},
    checkouts: checkout ? zipCheckouts(checkout, pageDirs) : [],
    products: (payment?.products ?? []).map((p) => ({
      key: p.key,
      code: orderProductCode(p.key, p.linkId),
      name: p.name,
      amountCents: p.amountCents,
      currency: p.currency,
      methods: p.methods.map(payMethodOf),
      thankYou: p.thankYouPageId ? (pageDirs[p.thankYouPageId] ?? null) : null,
      accessUrl: p.accessUrl,
    })),
  };
}
