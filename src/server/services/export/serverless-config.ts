/**
 * Monta a config embutida da função serverless (Vercel/Netlify) a partir do que
 * a exportação já carregou (PaymentExport/CheckoutExport) — o equivalente ao
 * pagamento-dados/config.php, SEM a chave (essa vem do ambiente). Roda no
 * worker; o JSON é embutido no .mjs da função (serverlessFunctionJs).
 */
import type { ServerlessConfig, ServerlessProvider } from "@/server/services/payments/serverless/config";
import type { CheckoutExport } from "./checkout";
import type { PaymentExport } from "./payments";

export function buildServerlessConfig(
  payment: PaymentExport | null,
  checkout: CheckoutExport | null,
): ServerlessConfig {
  return {
    v: 1,
    payments: (payment?.products ?? []).map((p) => ({
      key: p.key,
      linkId: p.linkId,
      name: p.name,
      amountCents: p.amountCents,
      currency: p.currency,
      methods: p.methods,
      accessUrl: p.accessUrl,
    })),
    checkouts: (checkout?.products ?? []).map((p) => ({
      key: p.key,
      linkId: p.linkId,
      provider: p.provider,
      name: p.name,
      amountCents: p.amountCents,
      currency: p.currency,
      methods: p.methods,
      locale: p.locale,
      accessUrl: p.accessUrl,
      config: {
        fields: p.config.fields,
        address: p.config.address,
        shipping: p.config.shipping,
        bumps: p.config.bumps,
        maxQuantity: p.config.maxQuantity,
      },
    })),
  };
}

/** Gateways usados pela oferta (define quais chaves o .env.example pede). */
export function serverlessGateways(
  payment: PaymentExport | null,
  checkout: CheckoutExport | null,
): ServerlessProvider[] {
  const used = new Set<ServerlessProvider>();
  for (const p of checkout?.products ?? []) used.add(p.provider);
  if (payment?.products.length) used.add("KYVO");
  return (["FLEVOPAY", "BLACKCAT", "CLOWNPAY", "PAGPIXHUB", "KYVO"] as const).filter((g) => used.has(g));
}
