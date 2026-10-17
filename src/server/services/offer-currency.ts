/**
 * Trocar a moeda da oferta ("Moeda, empresa e SEO") troca TUDO o que tem preço
 * nela, numa transação:
 *
 * - vitrines e caixas de compra de todas as páginas — todas as versões A/B, o
 *   layout do celular e a cópia editável da clonagem (PageDocument.editableHtml)
 *   —, no HTML salvo e no projeto do editor, com as partes geradas refeitas
 *   (regras em src/lib/offer-currency-switch.ts). Os números dos preços ficam
 *   os mesmos: não há conversão pela cotação. Cada cópia que muda ganha antes
 *   um ponto no Histórico ("Antes do <moeda>": currencyVersionLabel) e a
 *   revisão sobe (um editor aberto em outra aba recebe o conflito, que diz
 *   que a moeda mudou; o que ele grava depois vai na moeda nova:
 *   saveEditorDocument);
 * - produtos do pagamento na página (Kyvo), quando a Kyvo cobra na moeda nova
 *   (peso mexicano, euro, dólar): ficam as formas de pagamento que a moeda
 *   aceita, entram as dela que a moeda de antes não aceitava quando o valor
 *   cabe (o SPEI de quem chega ao peso) — nenhuma: as do produto novo nessa
 *   moeda; o idioma da janela acompanha quando estava no padrão da moeda
 *   antiga (switchPaymentCurrency). Valor fora da faixa das formas vira problema do produto (Próximos passos,
 *   aviso do ZIP, formulário). Em real, a Kyvo não cobra: ficam como estão;
 * - produtos do checkout do Offer Studio (todos os links, ligados ou não): a
 *   moeda é a da oferta; o gateway passa a ser um que cobra nela (no real, o de
 *   PIX com chave salva, senão a FlevoPay; nas outras, a Kyvo), com as formas
 *   de pagamento e o idioma dela (switchCheckoutCurrency). Valores (produto,
 *   bumps, frete) com os mesmos números. O endereço de entrega e o frete valem
 *   em qualquer moeda: a troca não mexe neles. Textos trocados no painel ficam:
 *   com o idioma ou o gateway diferente, o plano e o aviso pedem para revisar
 *   (staleCheckoutTexts);
 * - a moeda do "Valor da oferta" dos pixels (Offer.tracking.value.currency).
 *
 * Preço escrito como texto nas páginas não muda: o plano (currencySwitchPlan,
 * o que o diálogo de confirmação mostra) aponta onde ele está.
 *
 * Chamada de novo com a moeda que a oferta já tem, passa para ela só o que
 * ficou fora ("Passar tudo para …" do cartão da moeda): páginas que voltaram
 * pelo Histórico a um ponto de antes da troca. storeCurrencyMismatch diz quais
 * são (cartão, "Próximos passos" e aviso do ZIP).
 */
import type { Prisma } from "@/generated/prisma/client";
import { parseCheckoutConfig, staleCheckoutTexts } from "@/lib/checkout/config";
import {
  CHECKOUT_METHODS,
  type CheckoutMethodId,
  type CheckoutProviderId,
  checkoutAmountProblem,
  isCheckoutProvider,
  isPixProvider,
  PIX_PROVIDERS,
  switchCheckoutCurrency,
} from "@/lib/checkout/rules";
import { atomically, type Db, prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { chosenOfferCurrency, currencyVersionLabel, offerCurrencyOf, paymentCurrencyFor } from "@/lib/offer-currency";
import {
  type CurrencyMismatch,
  type CurrencyMismatchPage,
  type CurrencyPlanCheckout,
  type CurrencyPlanPage,
  type CurrencyPlanPayment,
  type CurrencyPlanProduct,
  type CurrencySwitchPlan,
  type CurrencySwitchResult,
  type DocumentCurrencyChange,
  hasHostMark,
  hostCurrencies,
  PLAN_PRODUCTS_MAX,
  planPrice,
  projectHasHostMark,
  switchDocumentCurrency,
  textPricesIn,
} from "@/lib/offer-currency-switch";
import {
  amountProblem,
  formatAmount,
  LOCALE_LABEL,
  PAYMENT_METHODS,
  PROVIDER_LABEL,
  switchPaymentCurrency,
  windowCurrency,
} from "@/lib/payments/rules";
import { packProject, unpackProject, unpackProjectText } from "@/lib/project-data";
import { CURRENCY_ATTR, type StoreCurrency } from "@/lib/store";
import { parseTrackingSettings } from "@/lib/tracking/schema";
import { createVersion, preserveStateOf } from "@/server/services/documents";

/** Tentativas por documento quando o editor grava no meio. */
const MAX_ATTEMPTS = 3;
/** Prazo da transação (ofertas com dezenas de páginas clonadas grandes); quem chama a troca numa transação sua usa o mesmo. */
export const CURRENCY_TX_OPTIONS = { timeout: 120_000, maxWait: 15_000 };

export const CURRENCY_SWITCH_CONFLICT =
  "Uma página desta oferta foi salva no editor bem na hora da troca. Nada foi trocado: tente de novo.";

const documentSelect = {
  id: true,
  revision: true,
  project: true,
  html: true,
  editableHtml: true,
  assetMap: true,
  device: true,
  variant: { select: { name: true, position: true, page: { select: { id: true, name: true, position: true } } } },
} as const satisfies Prisma.PageDocumentSelect;

type DocRow = Prisma.PageDocumentGetPayload<{ select: typeof documentSelect }>;

async function offerOrThrow(offerId: string, db: Db) {
  const offer = await db.offer.findFirst({
    where: { id: offerId, deletedAt: null },
    select: { id: true, settings: true, tracking: true, _count: { select: { pixels: { where: { enabled: true } } } } },
  });
  if (!offer) throw new UserError("Oferta não encontrada. Ela pode ter sido excluída.");
  return offer;
}

const DEVICE_ORDER = { ALL: 0, DESKTOP: 1, MOBILE: 2 } as const;

/** Documentos da oferta na ordem do funil (versão, computador antes do celular). */
async function offerDocuments(offerId: string, db: Db): Promise<DocRow[]> {
  const docs = await db.pageDocument.findMany({
    where: { variant: { page: { offerId } } },
    select: documentSelect,
  });
  return docs.sort(
    (a, b) =>
      a.variant.page.position - b.variant.page.position ||
      a.variant.position - b.variant.position ||
      DEVICE_ORDER[a.device] - DEVICE_ORDER[b.device],
  );
}

/**
 * O que muda num documento. O projeto do editor só é montado (descompactado e
 * lido) quando o HTML ou o próprio texto dele tem marca de vitrine ou caixa
 * de compra: páginas clonadas grandes sem loja passam direto.
 */
function changeOf(doc: DocRow, to: StoreCurrency): DocumentCurrencyChange {
  let project: unknown | null = null;
  if (doc.project) {
    const text = unpackProjectText(doc.project);
    if (hasHostMark(doc.html) || hasHostMark(doc.editableHtml) || projectHasHostMark(text)) project = JSON.parse(text);
  }
  return switchDocumentCurrency({ project, html: doc.html, editableHtml: doc.editableHtml }, to);
}

/**
 * Documentos que mudam (com o que muda) e as páginas com preço escrito como
 * texto na moeda de antes. Só os que mudam ficam guardados até o fim da
 * troca (os outros, com o HTML inteiro, são soltos aqui).
 */
async function plannedDocuments(offerId: string, from: StoreCurrency, to: StoreCurrency, db: Db) {
  const docs = await offerDocuments(offerId, db);
  const planned: { doc: DocRow; change: DocumentCurrencyChange }[] = [];
  const textPricePages = new Map<string, { pageId: string; pageName: string; examples: string[] }>();
  for (const doc of docs) {
    const page = doc.variant.page;
    // Passar para a moeda que a oferta já tem não mexe em texto escrito: nada a apontar.
    const examples = from === to ? [] : textPricesIn(doc.html, from);
    if (examples.length) {
      const entry = textPricePages.get(page.id) ?? { pageId: page.id, pageName: page.name, examples: [] };
      for (const e of examples) if (entry.examples.length < 3 && !entry.examples.includes(e)) entry.examples.push(e);
      textPricePages.set(page.id, entry);
    }
    const change = changeOf(doc, to);
    if (change.changed) planned.push({ doc, change });
  }
  return { planned, textPrices: [...textPricePages.values()] };
}

/** Produtos do pagamento na página da oferta (links desligados também: o produto fica guardado). */
async function offerPaymentRows(offerId: string, db: Db) {
  return db.paymentProduct.findMany({
    where: { link: { offerId } },
    orderBy: [{ link: { position: "asc" } }, { link: { createdAt: "asc" } }],
    select: {
      linkId: true,
      name: true,
      amountCents: true,
      currency: true,
      methods: true,
      locale: true,
      link: { select: { label: true, target: true } },
    },
  });
}

type PaymentRow = Awaited<ReturnType<typeof offerPaymentRows>>[number];

function paymentPlan(row: PaymentRow, to: StoreCurrency): CurrencyPlanPayment {
  const methods = PAYMENT_METHODS.filter((m) => row.methods.includes(m));
  // O produto do pagamento na página é sempre da Kyvo (o real só existe no checkout do Offer Studio).
  const currency = windowCurrency(row.currency);
  const before = {
    currency,
    methods,
    locale: row.locale,
    price: formatAmount(row.amountCents, currency),
  };
  const target = paymentCurrencyFor(to);
  const next = target && target !== row.currency ? switchPaymentCurrency(before, target, row.amountCents) : null;
  return {
    linkId: row.linkId,
    label: row.link.label,
    productName: row.name,
    active: row.link.target === "PAYMENT",
    before,
    after: next ? { ...next, price: formatAmount(row.amountCents, next.currency) } : null,
    problem: next ? amountProblem(row.amountCents, next.currency, next.methods) : null,
  };
}

/** Produtos do checkout do Offer Studio da oferta (links desligados também: o produto fica guardado). */
async function offerCheckoutRows(offerId: string, db: Db) {
  return db.checkoutProduct.findMany({
    where: { link: { offerId } },
    orderBy: [{ link: { position: "asc" } }, { link: { createdAt: "asc" } }],
    select: {
      linkId: true,
      name: true,
      provider: true,
      amountCents: true,
      currency: true,
      methods: true,
      locale: true,
      config: true,
      link: { select: { label: true, target: true } },
    },
  });
}

type CheckoutRow = Awaited<ReturnType<typeof offerCheckoutRows>>[number];

/** Gateways de PIX com chave salva na oferta (o real escolhe um deles). */
async function pixProvidersWithKey(offerId: string, db: Db): Promise<CheckoutProviderId[]> {
  const rows = await db.paymentGateway.findMany({
    where: { offerId, provider: { in: [...PIX_PROVIDERS] } },
    select: { provider: true },
  });
  return rows.map((r) => r.provider).filter(isCheckoutProvider);
}

const gatewayName = (provider: CheckoutProviderId) =>
  isPixProvider(provider) ? `${PROVIDER_LABEL[provider]} (PIX)` : PROVIDER_LABEL[provider];

/** Como um produto do checkout fica na moeda `to` (null = já está nela, com um gateway que cobra nela). */
function checkoutPlan(
  row: CheckoutRow,
  to: StoreCurrency,
  withKey: readonly CheckoutProviderId[],
):
  | (CurrencyPlanCheckout & {
      next: ReturnType<typeof switchCheckoutCurrency>;
      /** Mudanças no JSON da configuração (null = nenhuma). */
      config: { address?: false; textsFor?: { locale: string; pix: boolean } } | null;
    })
  | null {
  if (!isCheckoutProvider(row.provider)) return null;
  const before = {
    provider: row.provider,
    currency: row.currency,
    methods: CHECKOUT_METHODS.filter((m): m is CheckoutMethodId => row.methods.includes(m)),
    locale: row.locale,
  };
  const next = switchCheckoutCurrency(before, to, withKey, row.amountCents);
  if (next.currency === before.currency && next.provider === before.provider) return null;
  const config = parseCheckoutConfig(row.config);
  // O endereço e o frete valem em qualquer moeda: a troca de moeda não mexe neles.
  // Textos trocados guardados antes de existir o `textsFor`: valem para o idioma e o gateway de antes.
  const textsFor =
    config.textsFor ??
    (Object.keys(config.texts).length ? { locale: before.locale, pix: isPixProvider(before.provider) } : null);
  const textsToReview = staleCheckoutTexts({ texts: config.texts, textsFor }, next.locale, next.provider);
  const configChanges = {
    ...(textsFor && !config.textsFor ? { textsFor } : {}),
  };
  const total =
    row.amountCents +
    config.bumps.reduce((n, b) => n + b.priceCents, 0) +
    (config.address ? Math.max(0, ...config.shipping.map((x) => x.priceCents)) : 0);
  const problem =
    checkoutAmountProblem(row.amountCents, next.provider, to, next.methods) ??
    (total !== row.amountCents ? checkoutAmountProblem(total, next.provider, to, next.methods) : null);
  return {
    linkId: row.linkId,
    label: row.link.label,
    productName: row.name,
    active: row.link.target === "CHECKOUT",
    before: { gateway: gatewayName(before.provider), price: formatAmount(row.amountCents, before.currency) },
    after: { gateway: gatewayName(next.provider), price: formatAmount(row.amountCents, to) },
    gatewayChanged: next.provider !== before.provider,
    problem,
    locale: next.locale !== before.locale ? { from: LOCALE_LABEL[before.locale], to: LOCALE_LABEL[next.locale] } : null,
    textsToReview,
    next,
    config: Object.keys(configChanges).length ? configChanges : null,
  };
}

/**
 * Moeda do "Valor da oferta" depois da troca (null = já está nela, ou não há o
 * que citar: oferta sem pixel ligado e sem valor salvo — a moeda guardada
 * acompanha do mesmo jeito, mas o diálogo e o aviso só falam do que existe).
 */
function pixelPlan(
  tracking: unknown,
  from: StoreCurrency,
  to: StoreCurrency,
  pixels: number,
): CurrencySwitchPlan["pixel"] {
  const value = parseTrackingSettings(tracking, from).value;
  if (value.currency === to || (pixels === 0 && value.amount === null)) return null;
  return { from: value.currency, to, amount: value.amount };
}

/** "na versão B e no layout do celular" (as outras cópias da página que também mudam). */
function alsoIn(docs: DocRow[]): string | null {
  if (docs.length < 2) return null;
  const variants = [...new Set(docs.map((d) => d.variant.name))];
  const mobile = docs.some((d) => d.device === "MOBILE");
  const parts: string[] = [];
  if (variants.length > 1) parts.push(`nas versões ${variants.slice(0, -1).join(", ")} e ${variants.at(-1)}`);
  if (mobile) parts.push("no layout do celular");
  return parts.length ? parts.join(" e ") : null;
}

/**
 * O que a troca para `to` muda na oferta (sem gravar nada): o diálogo de
 * confirmação mostra isso antes do "Trocar a moeda de tudo".
 */
export async function currencySwitchPlan(
  offerId: string,
  to: StoreCurrency,
  db: Db = prisma,
): Promise<CurrencySwitchPlan> {
  const offer = await offerOrThrow(offerId, db);
  const from = offerCurrencyOf(offer.settings);
  const [{ planned, textPrices }, payments, checkoutRows, withKey] = await Promise.all([
    plannedDocuments(offerId, from, to, db),
    offerPaymentRows(offerId, db),
    offerCheckoutRows(offerId, db),
    pixProvidersWithKey(offerId, db),
  ]);

  const byPage = new Map<string, { name: string; docs: DocRow[]; showcases: number; buyBoxes: number }>();
  const products: CurrencyPlanProduct[] = [];
  const seen = new Set<string>();
  let moreProducts = 0;
  let documents = 0;

  for (const { doc, change } of planned) {
    const page = doc.variant.page;
    documents++;
    const entry = byPage.get(page.id) ?? { name: page.name, docs: [], showcases: 0, buyBoxes: 0 };
    entry.docs.push(doc);
    entry.showcases = Math.max(entry.showcases, change.hosts.filter((h) => h.kind === "products").length);
    entry.buyBoxes = Math.max(entry.buyBoxes, change.hosts.filter((h) => h.kind === "product-buy").length);
    byPage.set(page.id, entry);
    for (const host of change.hosts) {
      for (const p of host.products) {
        const key = `${page.id}\u0000${p.name}\u0000${p.price}\u0000${host.from}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (products.length >= PLAN_PRODUCTS_MAX) {
          moreProducts++;
          continue;
        }
        products.push({
          pageName: page.name,
          name: p.name,
          before: planPrice(p.price, host.from),
          after: planPrice(p.price, to),
        });
      }
    }
  }

  const pages: CurrencyPlanPage[] = [...byPage].map(([pageId, p]) => ({
    pageId,
    pageName: p.name,
    showcases: p.showcases,
    buyBoxes: p.buyBoxes,
    alsoIn: alsoIn(p.docs),
  }));
  const paymentPlans = payments.map((row) => paymentPlan(row, to));
  return {
    from,
    to,
    pages,
    products,
    moreProducts,
    payments: paymentPlans,
    paymentsKept: paymentPlans.length > 0 && !paymentCurrencyFor(to),
    checkouts: checkoutRows.flatMap((row) => {
      const plan = checkoutPlan(row, to, withKey);
      if (!plan) return [];
      const { next: _next, config: _config, ...shown } = plan;
      return [shown];
    }),
    pixel: pixelPlan(offer.tracking, from, to, offer._count.pixels),
    textPrices,
    documents,
  };
}

const asObject = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Troca a moeda da oferta e de tudo o que tem preço nela (ver o começo do
 * arquivo). Pode ser chamada de novo com a mesma moeda: o que já está nela não
 * muda (nem ganha outro ponto no Histórico).
 */
export async function switchOfferCurrency(
  offerId: string,
  to: StoreCurrency,
  db: Db = prisma,
): Promise<CurrencySwitchResult> {
  const offer = await offerOrThrow(offerId, db);
  // O trabalho pesado (ler o HTML e o projeto de cada página) fica fora da transação.
  const { planned, textPrices } = await plannedDocuments(offerId, offerCurrencyOf(offer.settings), to, db);
  const label = currencyVersionLabel(to);

  return atomically(
    db,
    async (tx) => {
      // Uma troca por vez na oferta (dois cliques seguidos não se misturam).
      const locked = await tx.$queryRaw<{ id: string }[]>`
        select id from "Offer" where id = ${offerId} and "deletedAt" is null for update`;
      if (!locked.length) throw new UserError("Oferta não encontrada. Ela pode ter sido excluída.");
      const fresh = await tx.offer.findUniqueOrThrow({
        where: { id: offerId },
        select: { settings: true, tracking: true, _count: { select: { pixels: { where: { enabled: true } } } } },
      });
      const from = offerCurrencyOf(fresh.settings);
      let showcases = 0;
      let buyBoxes = 0;
      const touchedPages = new Set<string>();
      const counted = new Map<string, { showcases: number; buyBoxes: number }>();
      let documents = 0;

      for (const { doc, change: first } of planned) {
        let current: DocRow | null = doc;
        let change = first;
        for (let attempt = 0; ; attempt++) {
          if (!change.changed) break;
          if (attempt >= MAX_ATTEMPTS) throw new UserError(CURRENCY_SWITCH_CONFLICT);
          const { count } = await tx.pageDocument.updateMany({
            where: { id: doc.id, revision: current.revision },
            data: {
              ...(change.project !== null && { project: packProject(change.project) }),
              html: change.html,
              editableHtml: change.editableHtml,
              revision: current.revision + 1,
            },
          });
          if (count) {
            // O ponto no Histórico guarda a página como estava (e o modo dela, com a cópia editável de antes).
            await createVersion(
              doc.id,
              "BULK_REPLACE",
              label,
              {
                project: current.project ? unpackProject(current.project) : null,
                html: current.html,
                preserve: preserveStateOf(current),
              },
              { db: tx },
            );
            documents++;
            touchedPages.add(doc.variant.page.id);
            const page = counted.get(doc.variant.page.id) ?? { showcases: 0, buyBoxes: 0 };
            page.showcases = Math.max(page.showcases, change.hosts.filter((h) => h.kind === "products").length);
            page.buyBoxes = Math.max(page.buyBoxes, change.hosts.filter((h) => h.kind === "product-buy").length);
            counted.set(doc.variant.page.id, page);
            break;
          }
          // O editor gravou esta página no meio: refaz a partir do que está gravado agora.
          current = await tx.pageDocument.findUnique({ where: { id: doc.id }, select: documentSelect });
          if (!current) break;
          change = changeOf(current, to);
        }
      }
      for (const page of counted.values()) {
        showcases += page.showcases;
        buyBoxes += page.buyBoxes;
      }

      // Pagamento na página: só quando a Kyvo cobra na moeda nova.
      const rows = await offerPaymentRows(offerId, tx);
      const target = paymentCurrencyFor(to);
      let payments = 0;
      const paymentProblems: CurrencySwitchResult["paymentProblems"] = [];
      for (const row of rows) {
        const plan = paymentPlan(row, to);
        if (!plan.after) continue;
        await tx.paymentProduct.update({
          where: { linkId: row.linkId },
          data: { currency: plan.after.currency, methods: plan.after.methods, locale: plan.after.locale },
        });
        payments++;
        if (plan.problem) paymentProblems.push({ linkId: row.linkId, label: row.link.label, problem: plan.problem });
      }
      const paymentsKept = target ? 0 : rows.length;

      // Checkout do Offer Studio: moeda da oferta, gateway que cobra nela.
      const [checkoutRows, withKey] = await Promise.all([
        offerCheckoutRows(offerId, tx),
        pixProvidersWithKey(offerId, tx),
      ]);
      let checkouts = 0;
      const checkoutGateways: CurrencySwitchResult["checkoutGateways"] = [];
      const checkoutTexts: NonNullable<CurrencySwitchResult["checkoutTexts"]> = [];
      for (const row of checkoutRows) {
        const plan = checkoutPlan(row, to, withKey);
        if (!plan) continue;
        await tx.checkoutProduct.update({
          where: { linkId: row.linkId },
          data: {
            currency: plan.next.currency,
            provider: plan.next.provider,
            methods: plan.next.methods,
            locale: plan.next.locale,
            // Só o que muda no JSON (o resto da configuração fica como estava gravado).
            ...(plan.config && { config: { ...asObject(row.config), ...plan.config } as Prisma.InputJsonObject }),
          },
        });
        checkouts++;
        const who = { linkId: row.linkId, label: row.link.label };
        if (plan.gatewayChanged) checkoutGateways.push({ ...who, gateway: plan.after.gateway });
        if (plan.textsToReview) checkoutTexts.push(who);
      }

      // Configurações e "Valor da oferta" dos pixels.
      const settings = { ...asObject(fresh.settings), currency: to };
      const pixel = pixelPlan(fresh.tracking, from, to, fresh._count.pixels) !== null;
      const tracking = asObject(fresh.tracking);
      const value = asObject(tracking.value);
      // Sem moeda salva no "Valor da oferta", ele já acompanha a moeda da oferta (parseTrackingSettings).
      const nextTracking =
        "currency" in value && value.currency !== to ? { ...tracking, value: { ...value, currency: to } } : null;
      const now = new Date();
      await tx.offer.update({
        where: { id: offerId },
        data: {
          settings: settings as Prisma.InputJsonObject,
          ...(nextTracking && { tracking: nextTracking as Prisma.InputJsonObject }),
          updatedAt: now,
        },
      });
      if (touchedPages.size) {
        await tx.page.updateMany({ where: { id: { in: [...touchedPages] } }, data: { updatedAt: now } });
      }
      return {
        from,
        to,
        showcases,
        buyBoxes,
        pages: touchedPages.size,
        documents,
        payments,
        paymentsKept,
        paymentProblems,
        checkouts,
        checkoutGateways,
        checkoutTexts,
        pixel,
        textPricePages: textPrices.length,
      };
    },
    CURRENCY_TX_OPTIONS,
  );
}

/**
 * Vitrines e caixas de compra fora da moeda ESCOLHIDA da oferta, por página
 * (null = oferta de antes da pergunta da moeda, sem moeda escolhida): uma
 * página que voltou pelo Histórico a um ponto de antes da troca, ou que foi
 * gravada por um editor aberto antes dela. Lê só o HTML dos documentos com
 * alguma vitrine ou caixa (o HTML salvo e, na página "Com scripts", a cópia
 * editável). Usada pelo cartão da moeda, pelo "Próximos passos" e pelo ZIP.
 */
export async function storeCurrencyMismatch(offerId: string, db: Db = prisma): Promise<CurrencyMismatch | null> {
  const offer = await db.offer.findFirst({ where: { id: offerId, deletedAt: null }, select: { settings: true } });
  const currency = offer ? chosenOfferCurrency(offer.settings) : null;
  if (!currency) return null;
  const marks = [CURRENCY_ATTR, "data-os-widget"];
  const docs = await db.pageDocument.findMany({
    where: {
      variant: { page: { offerId } },
      OR: marks.flatMap((m) => [{ html: { contains: m } }, { editableHtml: { contains: m } }]),
    },
    select: {
      html: true,
      editableHtml: true,
      variant: { select: { position: true, page: { select: { id: true, name: true, position: true } } } },
    },
  });
  docs.sort((a, b) => a.variant.page.position - b.variant.page.position || a.variant.position - b.variant.position);
  const byPage = new Map<string, CurrencyMismatchPage>();
  for (const doc of docs) {
    // Como a troca conta: as do HTML salvo; sem nenhuma fora lá, as da cópia editável (página "Com scripts").
    const outside = (html: string | null) => hostCurrencies(html).filter((c) => c !== currency);
    const fromHtml = outside(doc.html);
    const off = fromHtml.length ? fromHtml : outside(doc.editableHtml);
    if (!off.length) continue;
    const page = doc.variant.page;
    const entry = byPage.get(page.id) ?? { pageId: page.id, pageName: page.name, hosts: 0, currencies: [] };
    entry.hosts = Math.max(entry.hosts, off.length);
    for (const c of off) if (!entry.currencies.includes(c)) entry.currencies.push(c);
    byPage.set(page.id, entry);
  }
  return { currency, pages: [...byPage.values()] };
}
