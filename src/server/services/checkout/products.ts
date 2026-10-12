/**
 * Produtos do checkout do Offer Studio: um link da oferta com destino
 * "Checkout do Offer Studio" (OfferLink.target = CHECKOUT) e o produto da
 * página de checkout dele (CheckoutProduct). Regras em src/lib/checkout
 * (rules.ts: gateway × moeda, campos, limites; config.ts: o resto da página).
 *
 * A moeda é a da oferta (Offer.settings.currency): o produto guarda a moeda de
 * quando foi salvo, e a troca da moeda da oferta passa os produtos junto
 * (switchCheckoutCurrency, src/server/services/offer-currency.ts).
 */
import type { Prisma } from "@/generated/prisma/client";
import {
  type CheckoutConfig,
  type CheckoutConfigDraft,
  checkoutConfigDraft,
  checkoutConfigFromDraft,
  checkoutConfigImageKeys,
  parseCheckoutConfig,
} from "@/lib/checkout/config";
import {
  CHECKOUT_METHODS,
  type CheckoutCurrencyId,
  type CheckoutMethodId,
  type CheckoutProductBase,
  type CheckoutProviderId,
  checkoutAmountProblem,
  checkoutBaseProblems,
  isCheckoutProvider,
  isPixProvider,
} from "@/lib/checkout/rules";
import { type Db, prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { offerCurrencyOf } from "@/lib/offer-currency";
import { amountInput, formatAmount, normalizeAccessUrl, type PaymentLocaleId, parseAmount } from "@/lib/payments/rules";
import { NOT_CHECKOUT_KIND_MESSAGE, PAYMENT_LINK_KINDS } from "@/server/services/payments/products";

export const CHECKOUT_PRODUCT_SELECT = {
  provider: true,
  name: true,
  amountCents: true,
  currency: true,
  methods: true,
  locale: true,
  thankYouPageId: true,
  accessUrl: true,
  config: true,
} as const satisfies Prisma.CheckoutProductSelect;

type ProductRow = Prisma.CheckoutProductGetPayload<{ select: typeof CHECKOUT_PRODUCT_SELECT }>;

/** Produto do checkout como o painel mostra (os links de acesso aparecem só para você, no painel). */
export interface CheckoutProductView {
  provider: CheckoutProviderId;
  name: string;
  amountCents: number;
  /** Valor para o campo ("297,00"). */
  amount: string;
  /** "R$ 297,00" (pt-BR). */
  price: string;
  currency: CheckoutCurrencyId;
  methods: CheckoutMethodId[];
  locale: PaymentLocaleId;
  thankYouPageId: string | null;
  accessUrl: string;
  /** O resto da página, no formato do formulário. */
  config: CheckoutConfigDraft;
}

/** Ordem fixa das formas de pagamento, sem repetidas. */
function orderedMethods(methods: readonly string[]): CheckoutMethodId[] {
  return CHECKOUT_METHODS.filter((m) => methods.includes(m));
}

function providerOf(v: string): CheckoutProviderId {
  return isCheckoutProvider(v) ? v : "FLEVOPAY";
}

export function checkoutProductView(row: ProductRow): CheckoutProductView {
  return {
    provider: providerOf(row.provider),
    name: row.name,
    amountCents: row.amountCents,
    amount: amountInput(row.amountCents),
    price: formatAmount(row.amountCents, row.currency),
    currency: row.currency,
    methods: orderedMethods(row.methods),
    locale: row.locale,
    thankYouPageId: row.thankYouPageId,
    accessUrl: row.accessUrl,
    config: checkoutConfigDraft(parseCheckoutConfig(row.config)),
  };
}

async function linkOrThrow(linkId: string, db: Db) {
  const link = await db.offerLink.findFirst({
    where: { id: linkId, offer: { deletedAt: null } },
    select: { id: true, offerId: true, kind: true, key: true, offer: { select: { settings: true } } },
  });
  if (!link) throw new UserError("Link não encontrado.");
  return link;
}

export function isCheckoutKind(kind: string) {
  return (PAYMENT_LINK_KINDS as readonly string[]).includes(kind);
}

/** O que o painel manda para salvar o produto do checkout. */
export interface CheckoutProductInput extends CheckoutProductBase {
  config: CheckoutConfigDraft;
}

/**
 * Maior total possível (produto + todos os bumps + o frete mais caro): tem de
 * caber na faixa do gateway, senão alguém que marca tudo não consegue pagar.
 */
function maxTotal(amountCents: number, config: CheckoutConfig): number {
  const bumps = config.bumps.reduce((n, b) => n + b.priceCents, 0);
  const shipping = config.address ? Math.max(0, ...config.shipping.map((s) => s.priceCents)) : 0;
  return amountCents * Math.max(1, config.maxQuantity) + bumps + shipping;
}

/** Erro do primeiro problema (com o campo, para o formulário pôr o foco). */
function firstProblem(problems: Partial<Record<string, string>>): UserError | null {
  const field = Object.keys(problems).find((k) => problems[k]);
  return field ? new UserError(problems[field] as string, field) : null;
}

/** Chaves de imagem que não são da biblioteca da oferta (caminho do campo → chave). */
async function foreignImages(offerId: string, config: CheckoutConfig, db: Db) {
  const used = checkoutConfigImageKeys(config);
  if (!used.length) return [];
  const rows = await db.asset.findMany({
    where: { offerId, key: { in: [...new Set(used.map((u) => u.key))] }, kind: "IMAGE" },
    select: { key: true },
  });
  const ok = new Set(rows.map((r) => r.key));
  return used.filter((u) => !ok.has(u.key));
}

/**
 * Salva o produto do checkout do link e liga o destino "Checkout do Offer
 * Studio" nele. Valor, bumps e frete vêm daqui para a cobrança (nunca do
 * navegador de quem compra).
 */
export async function saveCheckoutProduct(linkId: string, input: CheckoutProductInput, db: Db = prisma) {
  const link = await linkOrThrow(linkId, db);
  if (!isCheckoutKind(link.kind)) throw new UserError(NOT_CHECKOUT_KIND_MESSAGE);
  const currency = offerCurrencyOf(link.offer.settings);
  const baseError = firstProblem(checkoutBaseProblems(input, currency));
  if (baseError) throw baseError;
  const amountCents = parseAmount(input.amount) as number;
  const { config, errors } = checkoutConfigFromDraft(input.config, currency, amountCents);
  const configError = firstProblem(errors);
  if (configError) throw configError;
  // Os textos trocados valem para o idioma e o pagamento de agora (salvar = revisados).
  config.textsFor = Object.keys(config.texts).length
    ? { locale: input.locale, pix: isPixProvider(input.provider) }
    : null;
  const total = maxTotal(amountCents, config);
  const totalProblem = checkoutAmountProblem(total, input.provider, currency, input.methods);
  if (totalProblem && total !== amountCents) {
    // O maior total possível: a maior quantidade do produto + todos os bumps + o frete mais caro.
    const parts = [
      config.maxQuantity > 1 ? `${config.maxQuantity} unidades` : "",
      config.bumps.length ? "todos os order bumps" : "",
      config.address ? "o frete mais caro" : "",
    ].filter(Boolean);
    const list = parts.length <= 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}`;
    throw new UserError(
      `Com ${list}, o total fica em ${formatAmount(total, currency)}: ${totalProblem.charAt(0).toLowerCase()}${totalProblem.slice(1)}`,
      config.maxQuantity > 1 ? "maxQuantity" : config.bumps.length ? "bumps" : "shipping",
    );
  }
  const foreign = await foreignImages(link.offerId, config, db);
  if (foreign.length) {
    throw new UserError("Essa imagem não está na biblioteca desta oferta. Envie a imagem de novo.", foreign[0].path);
  }
  let thankYouPageId: string | null = input.thankYouPageId || null;
  if (thankYouPageId) {
    const page = await db.page.findFirst({
      where: { id: thankYouPageId, offerId: link.offerId },
      select: { id: true },
    });
    if (!page) throw new UserError("Essa página de obrigado não é desta oferta. Escolha outra.", "thankYouPageId");
    thankYouPageId = page.id;
  }
  const data = {
    provider: input.provider,
    name: input.name.trim(),
    amountCents,
    currency,
    methods: orderedMethods(input.methods),
    locale: input.locale,
    thankYouPageId,
    accessUrl: normalizeAccessUrl(input.accessUrl),
    config: config as unknown as Prisma.InputJsonObject,
  };
  const row = await db.checkoutProduct.upsert({
    where: { linkId },
    create: { linkId, ...data },
    update: data,
    select: CHECKOUT_PRODUCT_SELECT,
  });
  await db.offerLink.update({ where: { id: linkId }, data: { target: "CHECKOUT" } });
  await db.offer.update({ where: { id: link.offerId }, data: { updatedAt: new Date() } });
  return checkoutProductView(row);
}

// ─── Para o servidor (prévia em simulação, pagamento.php, conferências) ────

/** Produto completo do checkout, para o servidor (nunca vai inteiro para a página). */
export interface ServerCheckoutProduct {
  key: string;
  linkId: string;
  offerId: string;
  label: string;
  provider: CheckoutProviderId;
  name: string;
  amountCents: number;
  currency: CheckoutCurrencyId;
  methods: CheckoutMethodId[];
  locale: PaymentLocaleId;
  thankYouPageId: string | null;
  accessUrl: string;
  config: CheckoutConfig;
}

/** Produtos de checkout ATIVOS da oferta (link em "Checkout do Offer Studio" com produto salvo). */
export async function offerCheckoutProducts(offerId: string, db: Db = prisma): Promise<ServerCheckoutProduct[]> {
  const rows = await db.checkoutProduct.findMany({
    where: { link: { offerId, target: "CHECKOUT" } },
    orderBy: [{ link: { position: "asc" } }, { link: { createdAt: "asc" } }],
    select: {
      ...CHECKOUT_PRODUCT_SELECT,
      linkId: true,
      link: { select: { key: true, offerId: true, label: true } },
    },
  });
  return rows.map((r) => ({
    key: r.link.key,
    linkId: r.linkId,
    offerId: r.link.offerId,
    label: r.link.label,
    provider: providerOf(r.provider),
    name: r.name,
    amountCents: r.amountCents,
    currency: r.currency,
    methods: orderedMethods(r.methods),
    locale: r.locale,
    thankYouPageId: r.thankYouPageId,
    accessUrl: r.accessUrl,
    config: parseCheckoutConfig(r.config),
  }));
}
