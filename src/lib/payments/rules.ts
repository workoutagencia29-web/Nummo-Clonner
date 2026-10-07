/**
 * Regras do pagamento na página que valem para qualquer gateway, sem banco e
 * sem rede: moedas, métodos (qual moeda cada um aceita), faixas de valor,
 * idioma da janela do comprador, leitura do valor digitado ("297,00") e a
 * conferência de um produto de pagamento. Usado na tela (aba "Links e
 * checkouts"), na ação e no serviço (src/server/services/payments).
 *
 * Valores sempre em centavos inteiros da moeda (como as APIs dos gateways).
 */

export const PAYMENT_CURRENCIES = ["MXN", "EUR", "USD"] as const;
export type PaymentCurrencyId = (typeof PAYMENT_CURRENCIES)[number];

export const PAYMENT_METHODS = ["SPEI", "CARD", "BIZUM", "MB_WAY"] as const;
export type PaymentMethodId = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_LOCALES = ["ES", "EN", "PT"] as const;
export type PaymentLocaleId = (typeof PAYMENT_LOCALES)[number];

export const PAYMENT_PROVIDERS = ["KYVO"] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

/** Moedas aceitas por método (Kyvo: SPEI só MXN; Bizum e MB WAY só EUR; cartão em todas). */
export const METHOD_CURRENCIES: Record<PaymentMethodId, readonly PaymentCurrencyId[]> = {
  SPEI: ["MXN"],
  CARD: ["MXN", "EUR", "USD"],
  BIZUM: ["EUR"],
  MB_WAY: ["EUR"],
};

/**
 * Faixa de valor por método, em centavos (Kyvo: SPEI até MX$ 25.000,00;
 * cartão, Bizum e MB WAY de 1,00 a 100.000,00). O mínimo do SPEI não está na
 * documentação: 1,00 como o do cartão (a Kyvo recusa abaixo do mínimo dela com
 * amount_below_minimum).
 */
export const METHOD_LIMITS: Record<PaymentMethodId, { min: number; max: number }> = {
  SPEI: { min: 100, max: 2_500_000 },
  CARD: { min: 100, max: 10_000_000 },
  BIZUM: { min: 100, max: 10_000_000 },
  MB_WAY: { min: 100, max: 10_000_000 },
};

export const METHOD_LABEL: Record<PaymentMethodId, string> = {
  SPEI: "SPEI",
  CARD: "Cartão",
  BIZUM: "Bizum",
  MB_WAY: "MB WAY",
};

/** Explicação curta do método no painel. */
export const METHOD_HINT: Record<PaymentMethodId, string> = {
  SPEI: "Transferência bancária no México. Só com peso mexicano (MXN).",
  CARD: "Cartão de crédito ou débito internacional. Em qualquer moeda.",
  BIZUM: "Pagamento pelo celular na Espanha. Só com euro (EUR).",
  MB_WAY: "Pagamento pelo celular em Portugal. Só com euro (EUR).",
};

export const CURRENCY_LABEL: Record<PaymentCurrencyId, string> = {
  MXN: "Peso mexicano (MXN)",
  EUR: "Euro (EUR)",
  USD: "Dólar americano (USD)",
};

export const LOCALE_LABEL: Record<PaymentLocaleId, string> = {
  ES: "Español",
  EN: "English",
  PT: "Português",
};

export const PROVIDER_LABEL: Record<PaymentProviderId, string> = { KYVO: "Kyvo" };

/** O método aceita a moeda? */
export function methodAllows(method: PaymentMethodId, currency: PaymentCurrencyId): boolean {
  return METHOD_CURRENCIES[method].includes(currency);
}

/** Métodos que fazem sentido para a moeda (os que vêm marcados num produto novo). */
export function defaultMethods(currency: PaymentCurrencyId): PaymentMethodId[] {
  return PAYMENT_METHODS.filter((m) => methodAllows(m, currency));
}

/** Idioma padrão da janela pela moeda: MXN e EUR → Español (México/Espanha), USD → English. */
export function defaultLocale(currency: PaymentCurrencyId): PaymentLocaleId {
  return currency === "USD" ? "EN" : "ES";
}

/** Por que o método não pode ser usado com a moeda (null = pode). */
export function methodCurrencyProblem(method: PaymentMethodId, currency: PaymentCurrencyId): string | null {
  if (methodAllows(method, currency)) return null;
  const only = METHOD_CURRENCIES[method].join(" ou ");
  return `${METHOD_LABEL[method]} só funciona com ${only}. Troque a moeda ou desmarque ${METHOD_LABEL[method]}.`;
}

/**
 * Valor digitado → centavos (null = não é um valor). Aceita "297", "297,00",
 * "297.5", "1.297,90", "1,297.90", "MX$ 297", "€29,90". Com "." e "," juntos,
 * o último é o separador dos centavos; o ponto sozinho, seguido de exatamente
 * 3 algarismos, é separador de milhar ("1.297" = mil duzentos e noventa e sete).
 * A vírgula sozinha seguida de 3 algarismos ("49,900") é recusada: no padrão
 * brasileiro do painel ela é dos centavos, então é um zero a mais — ler como
 * milhar cobraria mil vezes o valor (ver AMBIGUOUS_COMMA_MESSAGE).
 */
export function parseAmount(raw: string): number | null {
  const text = raw
    .trim()
    .replace(/^(?:MX\$|US\$|R\$|\$|€|MXN|EUR|USD)\s*/i, "")
    .replace(/\s*(?:€|MXN|EUR|USD)$/i, "")
    .replace(/[\s ]/g, "");
  if (!/^\d[\d.,]*$/.test(text)) return null;
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  let intPart = text;
  let decPart = "";
  if (lastDot >= 0 && lastComma >= 0) {
    const sep = lastDot > lastComma ? "." : ",";
    const other = sep === "." ? "," : ".";
    const cut = text.lastIndexOf(sep);
    intPart = text.slice(0, cut);
    decPart = text.slice(cut + 1);
    if (intPart.includes(sep) || !/^\d{1,3}(?:[.,]\d{3})*$/.test(intPart)) return null;
    intPart = intPart.split(other).join("");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = text.split(sep);
    const last = parts[parts.length - 1];
    // "49,900": a vírgula é dos centavos (padrão brasileiro); 3 algarismos depois dela é engano, não milhar.
    if (sep === "," && parts.length === 2 && last.length === 3) return null;
    if (parts.length === 2 && last.length !== 3) {
      intPart = parts[0];
      decPart = last;
    } else {
      // Só separadores de milhar: "1.297" ou "1.297.000".
      if (!/^\d{1,3}$/.test(parts[0]) || parts.slice(1).some((p) => p.length !== 3)) return null;
      intPart = parts.join("");
    }
  }
  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(decPart)) return null;
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Valor com uma vírgula seguida de 3 algarismos ("49,900"): recusado por parseAmount. */
const AMBIGUOUS_COMMA_RE = /^\D*\d{1,3},\d{3}\D*$/;
export const AMBIGUOUS_COMMA_MESSAGE = "Use 2 algarismos para os centavos (49,90) ou ponto para o milhar (49.900).";

/** "29700" centavos → "297,00" (para o campo do painel). */
export function amountInput(cents: number): string {
  const n = Math.max(0, Math.round(cents));
  const int = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${int},${String(n % 100).padStart(2, "0")}`;
}

/** Valor com a moeda, no idioma pedido ("MX$ 297,00" em pt-BR). */
export function formatAmount(cents: number, currency: PaymentCurrencyId, locale = "pt-BR"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${currency} ${amountInput(cents)}`;
  }
}

/** O que a tela e o servidor recebem para salvar um produto de pagamento. */
export interface PaymentProductInput {
  name: string;
  /** Valor como digitado ("297,00"). */
  amount: string;
  currency: PaymentCurrencyId;
  methods: PaymentMethodId[];
  locale: PaymentLocaleId;
  thankYouPageId: string | null;
  accessUrl: string;
}

export type PaymentProductField =
  | "name"
  | "amount"
  | "currency"
  | "methods"
  | "locale"
  | "thankYouPageId"
  | "accessUrl";

export const PRODUCT_NAME_MAX = 80;
export const ACCESS_URL_MAX = 2000;

/** Link de acesso: vazio (ainda não tem) ou endereço http(s) completo. */
export function accessUrlProblem(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.length > ACCESS_URL_MAX) return "Link de acesso muito longo.";
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return "Digite o link de acesso completo, começando com https://";
  }
  if (!/^https?:$/.test(url.protocol) || /\s/.test(v) || !url.hostname.includes(".")) {
    return "Digite o link de acesso completo, começando com https://";
  }
  return null;
}

/** "area.com/x" → "https://area.com/x". */
export function normalizeAccessUrl(raw: string): string {
  const v = raw.trim();
  return v && !/^[a-z][a-z0-9+.-]*:/i.test(v) ? `https://${v}` : v;
}

/**
 * Faixa de valor dos métodos marcados juntos (o valor tem de servir para
 * todos). null = nenhum método marcado.
 */
export function amountRange(methods: readonly PaymentMethodId[]): { min: number; max: number } | null {
  if (!methods.length) return null;
  return {
    min: Math.max(...methods.map((m) => METHOD_LIMITS[m].min)),
    max: Math.min(...methods.map((m) => METHOD_LIMITS[m].max)),
  };
}

/**
 * Problemas do produto, por campo (vazio = pode salvar). Página de obrigado e
 * link de acesso podem ficar para depois (o "Próximos passos" e o ZIP avisam);
 * o resto é obrigatório.
 */
export function paymentProductProblems(input: PaymentProductInput): Partial<Record<PaymentProductField, string>> {
  const out: Partial<Record<PaymentProductField, string>> = {};
  const name = input.name.trim();
  if (!name) out.name = "Dê um nome ao produto (o comprador vê esse nome na janela de pagamento).";
  else if (name.length > PRODUCT_NAME_MAX)
    out.name = `O nome do produto pode ter no máximo ${PRODUCT_NAME_MAX} caracteres.`;

  if (!(PAYMENT_CURRENCIES as readonly string[]).includes(input.currency)) out.currency = "Escolha a moeda.";
  if (!(PAYMENT_LOCALES as readonly string[]).includes(input.locale)) out.locale = "Escolha o idioma da janela.";

  const methods = input.methods.filter((m) => (PAYMENT_METHODS as readonly string[]).includes(m));
  if (!methods.length || methods.length !== input.methods.length) {
    out.methods = "Marque pelo menos uma forma de pagamento.";
  } else if (!out.currency) {
    const wrong = methods.find((m) => !methodAllows(m, input.currency));
    if (wrong) out.methods = methodCurrencyProblem(wrong, input.currency) ?? undefined;
  }

  const cents = parseAmount(input.amount);
  if (!input.amount.trim()) out.amount = "Digite o valor do produto, como 297,00.";
  else if (cents === null && AMBIGUOUS_COMMA_RE.test(input.amount.trim())) out.amount = AMBIGUOUS_COMMA_MESSAGE;
  else if (cents === null) out.amount = "Valor inválido. Digite só o número, como 297,00 ou 1.297,90.";
  else if (!out.currency && !out.methods) {
    const range = amountRange(methods);
    if (range && cents < range.min) {
      out.amount = `O valor mínimo é ${formatAmount(range.min, input.currency)}.`;
    } else if (range && cents > range.max) {
      const spei = methods.includes("SPEI") && METHOD_LIMITS.SPEI.max === range.max;
      out.amount = spei
        ? `Com SPEI, o valor máximo é ${formatAmount(range.max, input.currency)} por compra.`
        : `O valor máximo é ${formatAmount(range.max, input.currency)}.`;
    }
  }

  const access = accessUrlProblem(normalizeAccessUrl(input.accessUrl));
  if (access) out.accessUrl = access;
  return out;
}

/** Resultado do "Testar conexão" explicado no painel (mesmos códigos de ConnectionStatus). */
export const CONNECTION_MESSAGE: Record<
  "ok" | "invalid_key" | "missing_scope" | "offline" | "unavailable" | "unexpected",
  string
> = {
  ok: "A chave é válida e consegue consultar as suas vendas.",
  invalid_key:
    "A Kyvo recusou a chave (inválida, apagada ou copiada pela metade). Copie a chave de novo no painel da Kyvo e cole aqui em “Trocar chave”.",
  missing_scope:
    "A chave é válida, mas não tem a permissão de consultar transações (transactions:read). No painel da Kyvo, crie uma chave com as permissões spei_charges:create, card_charges:create e transactions:read.",
  offline: "Não foi possível falar com a Kyvo. Confira a internet deste Mac e tente de novo.",
  unavailable: "A Kyvo está fora do ar ou instável agora. Tente de novo em alguns minutos.",
  unexpected:
    "A Kyvo respondeu de um jeito inesperado. Tente de novo em alguns minutos; se continuar, confira a chave.",
};
