/**
 * Moeda da oferta (Offer.settings.currency): em qual moeda a oferta vai rodar.
 * Perguntada na "Nova oferta" e no "Salvar como oferta" da clonagem (vem
 * marcada a última escolhida: src/server/services/preferences.ts) e trocada na
 * aba "Moeda, empresa e SEO" da oferta.
 *
 * O que nasce com preço nasce nela: blocos da loja soltos no editor (contexto
 * dos widgets), modelos "Loja (vitrine)" e "Página do produto" (o servidor
 * monta o HTML na moeda: pageStart) e o produto novo do pagamento na página,
 * quando a Kyvo cobra nela. Trocar a moeda troca também o que já existe
 * (src/server/services/offer-currency.ts): vitrines e caixas de compra de
 * todas as páginas, produtos do pagamento na página e o "Valor da oferta" dos
 * pixels — os números ficam, só a moeda muda. Cada vitrine e caixa de compra
 * ainda tem o campo Moeda dela no editor; uma página que volta à moeda de
 * antes (Histórico, editor aberto antes da troca) aparece no "Próximos
 * passos", no aviso do ZIP e no cartão da moeda ("Passar tudo para …").
 * Ofertas criadas antes: real.
 *
 * Sem dependências do servidor: usada nas telas, no editor e nos serviços.
 */
import { PAYMENT_CURRENCIES, type PaymentCurrencyId } from "@/lib/payments/rules";
import { DEFAULT_CURRENCY, STORE_CURRENCIES, type StoreCurrency, storeCurrency } from "@/lib/store";

/** Ordem das moedas na pergunta (real primeiro: o padrão). */
export const OFFER_CURRENCIES: readonly StoreCurrency[] = ["BRL", "MXN", "EUR", "USD"];

export const OFFER_CURRENCY_QUESTION = "Em qual moeda essa oferta vai rodar?";

/** "Real (R$)", "Peso mexicano ($)", "Euro (€)", "Dólar (US$)". */
export const offerCurrencyLabel = (currency: StoreCurrency) => STORE_CURRENCIES[currency].label;

/** Nome da moeda numa frase ("real", "peso mexicano"…). */
export const OFFER_CURRENCY_NAME: Record<StoreCurrency, string> = {
  BRL: "real",
  MXN: "peso mexicano",
  EUR: "euro",
  USD: "dólar",
};

/**
 * Nome do ponto no Histórico que a troca da moeda grava antes de mudar uma
 * página: "Antes do peso mexicano" (curto, com a moeda — a lista do Histórico
 * mostra ao lado o selo "Troca de moeda"). Os quatro nomes são masculinos.
 */
export const currencyVersionLabel = (to: StoreCurrency) => `Antes do ${OFFER_CURRENCY_NAME[to]}`;

/** Nome que a troca gravava antes ("Antes de trocar a moeda para peso mexicano"). */
const OLD_VERSION_PREFIX = "Antes de trocar a moeda para ";

/**
 * Moeda para a qual a troca ia quando gravou o ponto do Histórico (null = o
 * ponto não é de uma troca de moeda). Vale para pontos do tipo "antes de
 * substituir" (BULK_REPLACE), o tipo que a troca usa.
 */
export function currencyVersionTarget(label: string | null | undefined): StoreCurrency | null {
  const text = label?.trim() ?? "";
  for (const currency of OFFER_CURRENCIES) {
    if (text === currencyVersionLabel(currency) || text === `${OLD_VERSION_PREFIX}${OFFER_CURRENCY_NAME[currency]}`) {
      return currency;
    }
  }
  return null;
}

/**
 * Moeda escolhida para a oferta (Offer.settings), ou null nas ofertas de antes
 * da pergunta (sem a chave): nelas o real é só o padrão, não uma escolha — o
 * pagamento na página não diz que elas "rodam em real" (muitas já cobram em
 * peso mexicano pela Kyvo).
 */
export function chosenOfferCurrency(settings: unknown): StoreCurrency | null {
  const raw = settings && typeof settings === "object" ? (settings as { currency?: unknown }).currency : undefined;
  return raw === undefined ? null : storeCurrency(raw);
}

/** Moeda guardada nas configurações da oferta (Offer.settings); sem ela ou desconhecida: real. */
export function offerCurrencyOf(settings: unknown): StoreCurrency {
  return chosenOfferCurrency(settings) ?? DEFAULT_CURRENCY;
}

/**
 * Moeda do produto do pagamento na página para a moeda da oferta: a mesma
 * quando a Kyvo cobra nela (peso mexicano, euro, dólar); null = real (a Kyvo
 * não cobra em real).
 */
export function paymentCurrencyFor(currency: StoreCurrency): PaymentCurrencyId | null {
  return (PAYMENT_CURRENCIES as readonly string[]).includes(currency) ? (currency as PaymentCurrencyId) : null;
}
