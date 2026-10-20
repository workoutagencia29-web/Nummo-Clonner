/**
 * Configuração que a função serverless (Vercel/Netlify) carrega embutida — o
 * equivalente ao pagamento-dados/config.php, SEM a chave do gateway (essa vem
 * do ambiente). Os valores, as formas, os bumps e os LINKS DE ACESSO ficam
 * aqui: é código só do servidor (a função não é servida como arquivo estático),
 * o mesmo nível de confiança do config.php atrás do .htaccess.
 *
 * Tudo já é JSON puro (sem zod em runtime): a exportação roda parseCheckoutConfig
 * no worker e grava só o que a função precisa. O valor da compra sai SEMPRE
 * daqui (nunca do navegador).
 */
import type { CheckoutConfig } from "@/lib/checkout/config";
import type { CheckoutCurrencyId, CheckoutMethodId, CheckoutProviderId } from "@/lib/checkout/rules";
import type { PaymentCurrencyId, PaymentLocaleId, PaymentMethodId } from "@/lib/payments/rules";

/** Gateways que a função conhece (os mesmos do checkout). */
export type ServerlessProvider = CheckoutProviderId;

/** Produto do checkout do Offer Studio (um link com destino "Checkout do Offer Studio"). */
export interface ServerlessCheckoutProduct {
  /** Chave do link (o "checkout" dos pedidos). */
  key: string;
  /** Id do link (com a chave, forma o código do pedido — orderProductCode). */
  linkId: string;
  provider: ServerlessProvider;
  name: string;
  amountCents: number;
  currency: CheckoutCurrencyId;
  methods: CheckoutMethodId[];
  locale: PaymentLocaleId;
  /** Link de acesso do produto (vazio = sem entregável por link; a cobrança funciona mesmo assim). */
  accessUrl: string;
  /** O que checkCheckoutOrder e o acesso precisam (campos, endereço, fretes, bumps com link, quantidade). */
  config: Pick<CheckoutConfig, "fields" | "address" | "shipping" | "bumps" | "maxQuantity">;
}

/** Produto do pagamento na página (link "Pagamento na página" — sempre Kyvo). */
export interface ServerlessPaymentProduct {
  key: string;
  linkId: string;
  name: string;
  amountCents: number;
  currency: PaymentCurrencyId;
  methods: PaymentMethodId[];
  /** Link de acesso do produto (vazio = sem entregável por link). */
  accessUrl: string;
}

/** Tudo que a função precisa de uma oferta (sem chaves — essas vêm do ambiente). */
export interface ServerlessConfig {
  v: 1;
  /** Pagamento na página (Kyvo). */
  payments: ServerlessPaymentProduct[];
  /** Checkout do Offer Studio (FlevoPay/BlackCat/ClownPay/Kyvo). */
  checkouts: ServerlessCheckoutProduct[];
}

/** Variável de ambiente com a chave de cada gateway (a função lê daqui, nunca de arquivo). */
export const GATEWAY_KEY_ENV: Record<ServerlessProvider, string> = {
  FLEVOPAY: "OS_FLEVOPAY_KEY",
  BLACKCAT: "OS_BLACKCAT_KEY",
  CLOWNPAY: "OS_CLOWNPAY_KEY",
  KYVO: "OS_KYVO_KEY",
};
