/**
 * Regras do checkout do Offer Studio (página de checkout própria de um link da
 * oferta com destino "Checkout do Offer Studio") que valem no painel, na ação
 * e no serviço, sem banco e sem rede: que gateway cobra em que moeda (PIX em
 * real pela FlevoPay ou pela BlackCat; Kyvo em peso, euro e dólar), formas de
 * pagamento, idioma dos textos, os dados de quem compra que cada gateway exige
 * (os travados no painel), limites de valor e a conferência do produto.
 *
 * Valores sempre em centavos inteiros da moeda. Total (produto + bumps + frete)
 * em ./contract.ts (o mesmo cálculo do servidor e da página).
 */
import type { StoreCurrency } from "@/lib/store";
import {
  accessUrlProblem,
  amountProblem,
  formatAmount,
  METHOD_LABEL,
  METHOD_LIMITS,
  methodAllows,
  normalizeAccessUrl,
  PAYMENT_METHODS,
  type PaymentCurrencyId,
  type PaymentLocaleId,
  type PaymentMethodId,
  type PaymentProviderId,
  PROVIDER_LABEL,
  parseAmount,
} from "../payments/rules";

/** Gateways do checkout, na ordem do painel (os de PIX primeiro: a maioria vende no Brasil). */
export const CHECKOUT_PROVIDERS = ["FLEVOPAY", "BLACKCAT", "KYVO"] as const satisfies readonly PaymentProviderId[];
export type CheckoutProviderId = (typeof CHECKOUT_PROVIDERS)[number];

/** Gateways de PIX (só real). */
export const PIX_PROVIDERS = ["FLEVOPAY", "BLACKCAT"] as const satisfies readonly CheckoutProviderId[];

/** Moedas do checkout = as moedas da oferta (Offer.settings.currency). */
export const CHECKOUT_CURRENCIES = ["BRL", "MXN", "EUR", "USD"] as const satisfies readonly StoreCurrency[];
export type CheckoutCurrencyId = (typeof CHECKOUT_CURRENCIES)[number];

/** Formas de pagamento do checkout: PIX (real) e as da Kyvo. */
export const CHECKOUT_METHODS = ["PIX", ...PAYMENT_METHODS] as const;
export type CheckoutMethodId = (typeof CHECKOUT_METHODS)[number];

export const CHECKOUT_METHOD_LABEL: Record<CheckoutMethodId, string> = { PIX: "PIX", ...METHOD_LABEL };

/** Moedas em que cada gateway cobra no checkout. */
export const PROVIDER_CURRENCIES: Record<CheckoutProviderId, readonly CheckoutCurrencyId[]> = {
  FLEVOPAY: ["BRL"],
  BLACKCAT: ["BRL"],
  KYVO: ["MXN", "EUR", "USD"],
};

/** O que cada gateway cobra (texto curto para o painel). */
export const CHECKOUT_PROVIDER_HINT: Record<CheckoutProviderId, string> = {
  FLEVOPAY: "PIX no Brasil, em real.",
  BLACKCAT: "PIX no Brasil, em real.",
  KYVO: "Peso mexicano (SPEI e cartão), euro (cartão, Bizum e MB WAY) e dólar (cartão).",
};

export function isCheckoutProvider(v: unknown): v is CheckoutProviderId {
  return typeof v === "string" && (CHECKOUT_PROVIDERS as readonly string[]).includes(v);
}

export function isPixProvider(v: unknown): v is (typeof PIX_PROVIDERS)[number] {
  return typeof v === "string" && (PIX_PROVIDERS as readonly string[]).includes(v);
}

export function isCheckoutCurrency(v: unknown): v is CheckoutCurrencyId {
  return typeof v === "string" && (CHECKOUT_CURRENCIES as readonly string[]).includes(v);
}

/** O gateway cobra nessa moeda? */
export function providerAllows(provider: CheckoutProviderId, currency: CheckoutCurrencyId): boolean {
  return PROVIDER_CURRENCIES[provider].includes(currency);
}

const CURRENCY_NAME: Record<CheckoutCurrencyId, string> = {
  BRL: "real",
  MXN: "peso mexicano",
  EUR: "euro",
  USD: "dólar",
};

/** Por que o gateway não serve para a moeda da oferta (null = serve). */
export function providerCurrencyProblem(provider: CheckoutProviderId, currency: CheckoutCurrencyId): string | null {
  if (providerAllows(provider, currency)) return null;
  const label = PROVIDER_LABEL[provider];
  return isPixProvider(provider)
    ? `A ${label} só cobra em real (PIX), e esta oferta roda em ${CURRENCY_NAME[currency]}. Escolha a Kyvo em “Pagamento” ou troque a moeda da oferta.`
    : `A Kyvo não cobra em real. Esta oferta roda em real: escolha a FlevoPay ou a BlackCat (PIX) em “Pagamento”.`;
}

/**
 * Gateway para a moeda: o atual quando serve; senão, em real, o de PIX que já
 * tem chave salva na oferta (`withKey`, FlevoPay antes), ou a FlevoPay; nas
 * outras moedas, a Kyvo.
 */
export function providerForCurrency(
  currency: CheckoutCurrencyId,
  current: CheckoutProviderId | null = null,
  withKey: readonly CheckoutProviderId[] = [],
): CheckoutProviderId {
  if (current && providerAllows(current, currency)) return current;
  if (currency !== "BRL") return "KYVO";
  return PIX_PROVIDERS.find((p) => withKey.includes(p)) ?? "FLEVOPAY";
}

/** A forma de pagamento serve para o gateway e a moeda? */
export function checkoutMethodAllows(
  method: CheckoutMethodId,
  provider: CheckoutProviderId,
  currency: CheckoutCurrencyId,
): boolean {
  if (method === "PIX") return isPixProvider(provider) && currency === "BRL";
  return provider === "KYVO" && currency !== "BRL" && methodAllows(method, currency);
}

/**
 * Formas de pagamento do produto: PIX nos gateways de PIX; na Kyvo, as
 * escolhidas que a moeda aceita (nenhuma → todas as que ela aceita).
 */
export function checkoutMethodsFor(
  provider: CheckoutProviderId,
  currency: CheckoutCurrencyId,
  chosen: readonly string[] = [],
): CheckoutMethodId[] {
  if (isPixProvider(provider)) return ["PIX"];
  if (currency === "BRL") return [];
  const allowed = PAYMENT_METHODS.filter((m) => methodAllows(m, currency));
  const picked = allowed.filter((m) => chosen.includes(m));
  return picked.length ? picked : allowed;
}

/**
 * Idiomas dos textos do checkout por moeda: real → português; peso → espanhol;
 * dólar → inglês; euro → português ou espanhol (Portugal ou Espanha).
 */
export const CHECKOUT_LOCALES: Record<CheckoutCurrencyId, readonly PaymentLocaleId[]> = {
  BRL: ["PT"],
  MXN: ["ES"],
  USD: ["EN"],
  EUR: ["ES", "PT"],
};

export function defaultCheckoutLocale(currency: CheckoutCurrencyId): PaymentLocaleId {
  return CHECKOUT_LOCALES[currency][0];
}

/** O idioma escolhido serve para a moeda? Senão, o padrão dela. */
export function checkoutLocaleFor(currency: CheckoutCurrencyId, locale: string | null | undefined): PaymentLocaleId {
  const list = CHECKOUT_LOCALES[currency];
  return list.find((l) => l === locale) ?? list[0];
}

/** Gateway, formas de pagamento, idioma e moeda de um produto do checkout. */
export interface CheckoutCurrencySetup {
  provider: CheckoutProviderId;
  currency: CheckoutCurrencyId;
  methods: CheckoutMethodId[];
  locale: PaymentLocaleId;
}

/**
 * O produto do checkout numa moeda nova (troca da moeda da oferta): o gateway
 * passa a ser um que cobra nela (providerForCurrency: no real, o de PIX com
 * chave salva — `withKey` —, senão a FlevoPay; nas outras, a Kyvo). Formas de
 * pagamento na Kyvo como no pagamento na página (switchPaymentCurrency): ficam
 * as marcadas que a moeda nova aceita e entram as dela que a moeda de antes
 * não aceitava (a pessoa não tinha como marcar: o SPEI de quem chega ao peso,
 * o Bizum e o MB WAY de quem chega ao euro) quando o valor (`amountCents`; sem
 * ele, sempre) cabe na faixa delas; nenhuma → todas as da moeda. O idioma fica
 * quando a moeda nova o aceita (o português do real continua no euro, com os
 * textos trocados que estiverem nele); senão, o padrão dela. O valor não muda.
 */
export function switchCheckoutCurrency(
  p: CheckoutCurrencySetup,
  currency: CheckoutCurrencyId,
  withKey: readonly CheckoutProviderId[] = [],
  amountCents?: number | null,
): CheckoutCurrencySetup {
  if (p.currency === currency && providerAllows(p.provider, currency)) return { ...p, methods: [...p.methods] };
  const provider = providerForCurrency(currency, p.provider, withKey);
  let methods: CheckoutMethodId[];
  const kyvo = provider === "KYVO" ? kyvoCurrency(currency) : null;
  if (kyvo) {
    const before = kyvoCurrency(p.currency);
    const fits = (m: PaymentMethodId) =>
      amountCents === undefined ||
      amountCents === null ||
      (amountCents >= METHOD_LIMITS[m].min && amountCents <= METHOD_LIMITS[m].max);
    const chosen = PAYMENT_METHODS.filter(
      (m) =>
        methodAllows(m, kyvo) &&
        ((p.provider === "KYVO" && p.methods.includes(m)) || ((!before || !methodAllows(m, before)) && fits(m))),
    );
    methods = chosen.length ? chosen : checkoutMethodsFor(provider, currency);
  } else methods = checkoutMethodsFor(provider, currency, p.methods);
  return { provider, currency, methods, locale: checkoutLocaleFor(currency, p.locale) };
}

// ─── Endereço e frete ───────────────────────────────────────────────────────

/**
 * O endereço de entrega (CEP com a busca da BrasilAPI, UF) e o frete só
 * existem no checkout em real: o contrato da página só aceita endereço do
 * Brasil (readAddress em ./contract.ts).
 */
export function addressAllowed(currency: CheckoutCurrencyId): boolean {
  return currency === "BRL";
}

/** Por que o endereço não pode ficar ligado nesta moeda (erro do campo "address"). */
export function addressCurrencyProblem(currency: CheckoutCurrencyId): string | null {
  if (addressAllowed(currency)) return null;
  return `O endereço de entrega e o frete só existem no checkout em real (o CEP é do Brasil). Em ${CURRENCY_NAME[currency]}, desligue “Pedir o endereço de entrega”.`;
}

// ─── Página de checkout: prévia e ZIP ───────────────────────────────────────

/**
 * Onde a página de checkout existe: na prévia do app em simulação (nada é
 * cobrado) e no ZIP, em checkout/<chave do link>/, cobrando de verdade pelo
 * pagamento.php. O painel e o editor dizem isso com este texto.
 */
export const CHECKOUT_PAGE_NOTE =
  "Na prévia, a página de checkout abre em simulação (nada é cobrado). No site publicado (ZIP), ela vai na pasta checkout/ e cobra de verdade pelo pagamento.php (precisa de hospedagem com PHP e HTTPS).";

/**
 * Preferência do "Botão de checkout" solto numa oferta sem nenhum link
 * "Checkout do Offer Studio": o "＋ Criar link da oferta…" dele já vem com esse
 * destino, também depois de salvar e reabrir (src/editor/grapes/new-link.ts).
 * Só do editor: sai quando o botão é ligado a um link e o render a tira da
 * página (applyOfferLinks).
 */
export const NEW_LINK_TARGET_ATTR = "data-os-new-link";
export const NEW_LINK_TARGET_CHECKOUT = "checkout";

/** Explicação do link de checkout sem o produto salvo (editor e painel). */
export const CHECKOUT_UNSAVED_NOTE =
  "O checkout deste link ainda não foi salvo: até lá, os botões ligados a ele não levam a lugar nenhum. Monte-o em “Links e checkouts”.";

// ─── Dados de quem compra ───────────────────────────────────────────────────

/** Campos de quem compra, na ordem do formulário. */
export const BUYER_FIELDS = ["name", "email", "phone", "document"] as const;
export type BuyerField = (typeof BUYER_FIELDS)[number];

/** Nome do campo no painel (o documento é o CPF no real). */
export function buyerFieldLabel(field: BuyerField, currency: CheckoutCurrencyId): string {
  if (field === "name") return "Nome completo";
  if (field === "email") return "E-mail";
  if (field === "phone") return "Telefone / WhatsApp";
  return currency === "BRL" ? "CPF" : "Documento (RFC, NIF…)";
}

/** Campos que o gateway exige de quem compra (ficam sempre pedidos). */
export const PROVIDER_REQUIRED_FIELDS: Record<CheckoutProviderId, readonly BuyerField[]> = {
  FLEVOPAY: ["name", "email", "phone", "document"],
  BLACKCAT: ["name", "email", "phone", "document"],
  KYVO: ["name", "email"],
};

/**
 * Campos que o produto NOVO começa pedindo: nome e e-mail, e telefone e
 * documento só quando o gateway exige. No PIX, os quatro (travados); na Kyvo,
 * que só exige nome e e-mail, telefone e documento começam em "não pedir" e
 * podem ser ligados no formulário. O produto já salvo fica com os campos dele
 * (o padrão de `parseCheckoutConfig` continua tudo ligado).
 */
export function newBuyerFields(provider: CheckoutProviderId): Record<BuyerField, boolean> {
  const required = PROVIDER_REQUIRED_FIELDS[provider];
  return { name: true, email: true, phone: required.includes("phone"), document: required.includes("document") };
}

/** Explicação do campo travado ("A FlevoPay exige…"); null = o campo pode ser ligado e desligado. */
export function buyerFieldLock(provider: CheckoutProviderId, field: BuyerField): string | null {
  if (!PROVIDER_REQUIRED_FIELDS[provider].includes(field)) return null;
  const label = PROVIDER_LABEL[provider];
  return isPixProvider(provider)
    ? `A ${label} exige nome, e-mail, telefone e CPF de quem compra para gerar o PIX.`
    : `A ${label} exige nome e e-mail de quem compra.`;
}

/** Campos pedidos de verdade: os ligados + os que o gateway exige. */
export function askedBuyerFields(
  provider: CheckoutProviderId,
  fields: Partial<Record<BuyerField, boolean>>,
): BuyerField[] {
  return BUYER_FIELDS.filter((f) => fields[f] === true || PROVIDER_REQUIRED_FIELDS[provider].includes(f));
}

// ─── Limites ────────────────────────────────────────────────────────────────

export const CHECKOUT_LIMITS = {
  /** Order bumps por produto. */
  bumps: 3,
  /** Opções de frete. */
  shipping: 5,
  /** Depoimentos. */
  testimonials: 3,
  /** Cronômetro (minutos). */
  timerMin: 1,
  timerMax: 120,
  name: 80,
  description: 300,
  bumpTitle: 80,
  bumpDescription: 200,
  shippingName: 60,
  shippingEta: 60,
  testimonialText: 400,
  testimonialName: 60,
  text: 80,
} as const;

/**
 * Faixa de valor do PIX nos gateways (centavos): de R$ 1,00 a R$ 100.000,00 —
 * vale para o total da compra (produto + bumps + frete). A documentação da
 * FlevoPay e da BlackCat não traz limites: estes são os do Offer Studio, como
 * os do cartão na Kyvo.
 */
export const PIX_LIMITS = { min: 100, max: 10_000_000 } as const;

/** Valor mínimo de um bump (um bump de graça não é uma oferta a mais). */
export const BUMP_MIN_CENTS = 100;

/** Moeda da Kyvo (null = real: a Kyvo não cobra). */
export function kyvoCurrency(currency: CheckoutCurrencyId): PaymentCurrencyId | null {
  return currency === "BRL" ? null : currency;
}

/**
 * O total (centavos) não serve para o gateway e as formas de pagamento (texto
 * pronto); null = serve. PIX: PIX_LIMITS; Kyvo: as faixas das formas marcadas.
 */
export function checkoutAmountProblem(
  cents: number,
  provider: CheckoutProviderId,
  currency: CheckoutCurrencyId,
  methods: readonly CheckoutMethodId[],
): string | null {
  if (isPixProvider(provider)) {
    if (currency !== "BRL") return null;
    if (cents < PIX_LIMITS.min) return `O valor mínimo do PIX é ${formatAmount(PIX_LIMITS.min, "BRL")}.`;
    if (cents > PIX_LIMITS.max) return `O valor máximo do PIX é ${formatAmount(PIX_LIMITS.max, "BRL")} por compra.`;
    return null;
  }
  const kyvo = kyvoCurrency(currency);
  if (!kyvo) return null;
  return amountProblem(
    cents,
    kyvo,
    methods.filter((m): m is PaymentMethodId => m !== "PIX"),
  );
}

// ─── Produto (o que o painel salva nas colunas) ─────────────────────────────

/** O que a tela e o servidor recebem para salvar as colunas do produto do checkout. */
export interface CheckoutProductBase {
  name: string;
  /** Valor como digitado ("297,00"). */
  amount: string;
  provider: CheckoutProviderId;
  methods: CheckoutMethodId[];
  locale: PaymentLocaleId;
  thankYouPageId: string | null;
  accessUrl: string;
}

export type CheckoutBaseField = "name" | "amount" | "provider" | "methods" | "locale" | "thankYouPageId" | "accessUrl";

/**
 * Problemas das colunas do produto, por campo (vazio = pode salvar). A moeda
 * é a da oferta (não é escolhida aqui). Gateway que não cobra na moeda é
 * problema (o formulário mostra no campo); página de obrigado e link de acesso
 * podem ficar para depois (o "Próximos passos" avisa).
 */
export function checkoutBaseProblems(
  input: CheckoutProductBase,
  currency: CheckoutCurrencyId,
): Partial<Record<CheckoutBaseField, string>> {
  const out: Partial<Record<CheckoutBaseField, string>> = {};
  const name = input.name.trim();
  if (!name) out.name = "Dê um nome ao produto (o comprador vê esse nome no checkout).";
  else if (name.length > CHECKOUT_LIMITS.name)
    out.name = `O nome do produto pode ter no máximo ${CHECKOUT_LIMITS.name} caracteres.`;

  if (!isCheckoutProvider(input.provider)) out.provider = "Escolha o gateway de pagamento.";
  else {
    const problem = providerCurrencyProblem(input.provider, currency);
    if (problem) out.provider = problem;
  }

  if (!out.provider) {
    const methods = input.methods.filter((m) => (CHECKOUT_METHODS as readonly string[]).includes(m));
    if (!methods.length || methods.length !== input.methods.length) {
      out.methods = "Marque pelo menos uma forma de pagamento.";
    } else {
      const wrong = methods.find((m) => !checkoutMethodAllows(m, input.provider, currency));
      if (wrong) {
        out.methods =
          wrong === "PIX"
            ? "O PIX só existe em real, pela FlevoPay ou pela BlackCat."
            : `${CHECKOUT_METHOD_LABEL[wrong]} não está disponível em ${CURRENCY_NAME[currency]} com a ${PROVIDER_LABEL[input.provider]}.`;
      }
    }
  }

  if (!CHECKOUT_LOCALES[currency].includes(input.locale)) out.locale = "Escolha o idioma dos textos do checkout.";

  const cents = parseAmount(input.amount);
  if (!input.amount.trim()) out.amount = "Digite o valor do produto, como 297,00.";
  else if (cents === null) out.amount = "Valor inválido. Digite só o número, como 297,00 ou 1.297,90.";
  else if (!out.provider && !out.methods) {
    const problem = checkoutAmountProblem(cents, input.provider, currency, input.methods);
    if (problem) out.amount = problem;
  }

  const access = accessUrlProblem(normalizeAccessUrl(input.accessUrl));
  if (access) out.accessUrl = access;
  return out;
}
