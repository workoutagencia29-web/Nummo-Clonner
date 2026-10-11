import type { PaymentProviderId } from "@/lib/payments/rules";

/**
 * Endereço de um link da oferta na aba "Links e checkouts" (?link=<id>): a aba
 * abre rolada até ele e com ele em destaque (consertos do "Próximos passos" e
 * dos avisos do ZIP, como "Abrir o link").
 */
export const LINK_QUERY_PARAM = "link";

export function offerLinkHref(offerId: string, linkId: string): string {
  return `/ofertas/${offerId}?aba=links&${LINK_QUERY_PARAM}=${encodeURIComponent(linkId)}`;
}

/**
 * Cartão da conta de um gateway na aba "Links e checkouts" (?conta=pagamento
 * para a Kyvo — "Pagamento na página — conta da Kyvo desta oferta" —,
 * ?conta=flevopay e ?conta=blackcat para os do checkout do Offer Studio): a aba
 * abre rolada até ele, com o campo da chave em foco ("Abrir a conta da …" do
 * "Próximos passos" e dos avisos do ZIP).
 */
export const PAYMENT_ACCOUNT_QUERY_PARAM = "conta";
export const PAYMENT_ACCOUNT_QUERY_VALUE = "pagamento";

/** Valor do ?conta= de cada gateway. */
export const ACCOUNT_QUERY_VALUE: Record<PaymentProviderId, string> = {
  KYVO: PAYMENT_ACCOUNT_QUERY_VALUE,
  FLEVOPAY: "flevopay",
  BLACKCAT: "blackcat",
};

/** Gateway do ?conta= (null = nenhum). */
export function accountQueryProvider(value: string | null | undefined): PaymentProviderId | null {
  const found = (Object.keys(ACCOUNT_QUERY_VALUE) as PaymentProviderId[]).find((p) => ACCOUNT_QUERY_VALUE[p] === value);
  return found ?? null;
}

export function offerPaymentAccountHref(offerId: string, provider: PaymentProviderId = "KYVO"): string {
  return `/ofertas/${offerId}?aba=links&${PAYMENT_ACCOUNT_QUERY_PARAM}=${ACCOUNT_QUERY_VALUE[provider]}`;
}

/**
 * Campo da aba "Moeda, empresa e SEO" (?campo=idioma ou ?campo=moeda): a aba
 * abre rolada até ele, com ele em foco ("Escolher o idioma" e "Abrir a moeda
 * da oferta" do "Próximos passos", o conserto do aviso do ZIP da moeda das
 * vitrines). O pedido sai do endereço depois de usado.
 */
export const SETTING_QUERY_PARAM = "campo";
export const LANGUAGE_SETTING = "idioma";
export const CURRENCY_SETTING = "moeda";

export function offerSettingHref(offerId: string, field: typeof LANGUAGE_SETTING | typeof CURRENCY_SETTING): string {
  return `/ofertas/${offerId}?aba=configuracoes&${SETTING_QUERY_PARAM}=${field}`;
}
