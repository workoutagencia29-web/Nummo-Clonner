/**
 * Produtos de pagamento: um link da oferta do tipo "Pagamento na página"
 * (OfferLink.target = PAYMENT) com o produto vendido (PaymentProduct). Regras
 * de valor/moeda/métodos em src/lib/payments/rules.ts.
 */
import type { OfferLinkTarget, Prisma } from "@/generated/prisma/client";
import { type Db, prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import type { PayLocale, PayMethod, PublicPaymentProduct } from "@/lib/payments/contract";
import type { PaymentRender } from "@/lib/payments/render";
import {
  amountInput,
  formatAmount,
  normalizeAccessUrl,
  PAYMENT_METHODS,
  type PaymentCurrencyId,
  type PaymentLocaleId,
  type PaymentMethodId,
  type PaymentProductField,
  type PaymentProductInput,
  type PaymentProviderId,
  parseAmount,
  paymentProductProblems,
} from "@/lib/payments/rules";

/** Tipos de link que podem virar "Pagamento na página" (os de compra). */
export const PAYMENT_LINK_KINDS = ["CHECKOUT", "UPSELL", "DOWNSELL"] as const;
export const NOT_PAYMENT_KIND_MESSAGE =
  "Só links de checkout (checkout, upsell ou downsell) podem ser “Pagamento na página”. Mude o tipo do link antes.";

export const PAYMENT_PRODUCT_SELECT = {
  provider: true,
  name: true,
  amountCents: true,
  currency: true,
  methods: true,
  locale: true,
  thankYouPageId: true,
  accessUrl: true,
} as const satisfies Prisma.PaymentProductSelect;

type ProductRow = Prisma.PaymentProductGetPayload<{ select: typeof PAYMENT_PRODUCT_SELECT }>;

/** Produto como o painel mostra (o link de acesso aparece só para você, no painel). */
export interface PaymentProductView {
  provider: PaymentProviderId;
  name: string;
  amountCents: number;
  /** Valor para o campo ("297,00"). */
  amount: string;
  /** "MX$ 297,00" (pt-BR). */
  price: string;
  currency: PaymentCurrencyId;
  methods: PaymentMethodId[];
  locale: PaymentLocaleId;
  thankYouPageId: string | null;
  accessUrl: string;
}

/** Ordem fixa dos métodos (a do PAYMENT_METHODS), sem repetidos. */
function orderedMethods(methods: readonly string[]): PaymentMethodId[] {
  return PAYMENT_METHODS.filter((m) => methods.includes(m));
}

export function paymentProductView(row: ProductRow): PaymentProductView {
  return {
    provider: row.provider,
    name: row.name,
    amountCents: row.amountCents,
    amount: amountInput(row.amountCents),
    price: formatAmount(row.amountCents, row.currency),
    currency: row.currency,
    methods: orderedMethods(row.methods),
    locale: row.locale,
    thankYouPageId: row.thankYouPageId,
    accessUrl: row.accessUrl,
  };
}

async function linkOrThrow(linkId: string, db: Db) {
  const link = await db.offerLink.findFirst({
    where: { id: linkId, offer: { deletedAt: null } },
    select: { id: true, offerId: true, kind: true, key: true },
  });
  if (!link) throw new UserError("Link não encontrado.");
  return link;
}

function isPaymentKind(kind: string) {
  return (PAYMENT_LINK_KINDS as readonly string[]).includes(kind);
}

/** Primeiro problema do produto como UserError (com o campo). */
function assertValid(input: PaymentProductInput) {
  const problems = paymentProductProblems(input);
  const field = Object.keys(problems)[0] as PaymentProductField | undefined;
  if (field) throw new UserError(problems[field] as string, field);
}

/**
 * Salva o produto do link e liga o "Pagamento na página" nele. Valor e moeda
 * vêm daqui para a cobrança (nunca do navegador do comprador).
 */
export async function savePaymentProduct(linkId: string, input: PaymentProductInput, db: Db = prisma) {
  const link = await linkOrThrow(linkId, db);
  if (!isPaymentKind(link.kind)) throw new UserError(NOT_PAYMENT_KIND_MESSAGE);
  assertValid(input);
  const amountCents = parseAmount(input.amount) as number;
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
    name: input.name.trim(),
    amountCents,
    currency: input.currency,
    methods: orderedMethods(input.methods),
    locale: input.locale,
    thankYouPageId,
    accessUrl: normalizeAccessUrl(input.accessUrl),
  };
  const row = await db.paymentProduct.upsert({
    where: { linkId },
    create: { linkId, ...data },
    update: data,
    select: PAYMENT_PRODUCT_SELECT,
  });
  await db.offerLink.update({ where: { id: linkId }, data: { target: "PAYMENT" } });
  await db.offer.update({ where: { id: link.offerId }, data: { updatedAt: new Date() } });
  return paymentProductView(row);
}

/**
 * Troca para onde o link leva: endereço (URL) ou pagamento na página. O
 * produto e o endereço ficam guardados: voltar não perde nada.
 */
export async function setOfferLinkTarget(linkId: string, target: OfferLinkTarget, db: Db = prisma) {
  const link = await linkOrThrow(linkId, db);
  if (target === "PAYMENT" && !isPaymentKind(link.kind)) throw new UserError(NOT_PAYMENT_KIND_MESSAGE);
  await db.offerLink.update({ where: { id: linkId }, data: { target } });
  await db.offer.update({ where: { id: link.offerId }, data: { updatedAt: new Date() } });
}

// ─── Render (prévia e ZIP) ──────────────────────────────────────────────────

export { loadRenderLinks } from "@/lib/payments/links";

const METHOD_ID: Record<PaymentMethodId, PayMethod> = { SPEI: "spei", CARD: "card", BIZUM: "bizum", MB_WAY: "mb_way" };
const LOCALE_ID: Record<PaymentLocaleId, PayLocale> = { ES: "es", EN: "en", PT: "pt" };

export function payMethodOf(method: PaymentMethodId): PayMethod {
  return METHOD_ID[method];
}

/** Produto completo, para o servidor de pagamento (prévia em simulação, pagamento.php do ZIP). */
export interface ServerPaymentProduct extends PaymentProductView {
  key: string;
  linkId: string;
  offerId: string;
}

/** Produtos de pagamento ativos da oferta (link em "Pagamento na página" com produto salvo). */
export async function offerPaymentProducts(offerId: string, db: Db = prisma): Promise<ServerPaymentProduct[]> {
  const rows = await db.paymentProduct.findMany({
    where: { link: { offerId, target: "PAYMENT" } },
    orderBy: [{ link: { position: "asc" } }, { link: { createdAt: "asc" } }],
    select: { ...PAYMENT_PRODUCT_SELECT, linkId: true, link: { select: { key: true, offerId: true } } },
  });
  return rows.map((r) => ({ ...paymentProductView(r), key: r.link.key, linkId: r.linkId, offerId: r.link.offerId }));
}

/** Produto como a página o conhece (nada secreto: sem link de acesso). */
export function publicPaymentProduct(
  p: PaymentProductView,
  pageHref: (pageId: string) => string,
): PublicPaymentProduct {
  return {
    nome: p.name,
    valor: p.amountCents,
    moeda: p.currency,
    metodos: p.methods.map(payMethodOf),
    idioma: LOCALE_ID[p.locale],
    obrigado: p.thankYouPageId ? pageHref(p.thankYouPageId) : null,
  };
}

/** Opções do pagamento no render de uma página (ver PaymentRender). */
export interface PaymentRenderOptions {
  endpoint: string;
  simulation: boolean;
  /** Endereço de uma página do funil a partir da página renderizada (página de obrigado). */
  pageHref: (pageId: string) => string;
  scriptTag?: string;
}

/**
 * Pagamento na página para o render de uma página, a partir dos produtos já
 * lidos (o ZIP lê uma vez e monta para cada arquivo). null = sem produto.
 */
export function paymentRenderFor(
  products: readonly ServerPaymentProduct[],
  opts: PaymentRenderOptions,
): PaymentRender | null {
  if (!products.length) return null;
  const out: Record<string, PublicPaymentProduct> = {};
  for (const p of products) out[p.key] = publicPaymentProduct(p, opts.pageHref);
  return {
    endpoint: opts.endpoint,
    simulation: opts.simulation,
    products: out,
    ...(opts.scriptTag ? { scriptTag: opts.scriptTag } : {}),
  };
}

/**
 * Pagamento na página para o render de uma página: produtos públicos da
 * oferta (com o endereço da página de obrigado relativo à página) e o
 * endpoint (e a tag do script da janela; sem ela, o script vai embutido).
 * null = a oferta não tem produto de pagamento.
 */
export async function offerPaymentRender(
  offerId: string,
  opts: PaymentRenderOptions,
  db: Db = prisma,
): Promise<PaymentRender | null> {
  return paymentRenderFor(await offerPaymentProducts(offerId, db), opts);
}
