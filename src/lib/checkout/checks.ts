/**
 * O que falta para o checkout do Offer Studio funcionar no site publicado —
 * regras puras, sem banco (como src/lib/payments/checks.ts): o servidor junta
 * os dados (offerCheckoutCheck, src/server/services/checkout/checks.ts) e o
 * "Próximos passos" (src/lib/readiness.ts) e os avisos do ZIP
 * (src/lib/export/warnings.ts) explicam cada problema.
 */

import type { PaymentKeyState } from "../payments/checks";
import { formatAmount, type PaymentLocaleId, PROVIDER_LABEL } from "../payments/rules";
import {
  addressAllowed,
  type CheckoutCurrencyId,
  type CheckoutMethodId,
  type CheckoutProviderId,
  checkoutAmountProblem,
  checkoutMethodAllows,
  providerCurrencyProblem,
} from "./rules";

export interface CheckoutCheckProduct {
  linkId: string;
  /** Nome do link da oferta ("Checkout principal"). */
  label: string;
  provider: CheckoutProviderId;
  /** Moeda guardada no produto. */
  currency: CheckoutCurrencyId;
  methods: CheckoutMethodId[];
  amountCents: number;
  /** Maior total possível (produto + todos os bumps + o frete mais caro). */
  maxTotalCents: number;
  thankYou: {
    pageId: string;
    name: string;
    /** Documento (versão/celular) da página sem o bloco "Acesso ao produto" (null = todos têm). */
    missingAccessDocumentId: string | null;
    /** Idioma do bloco "Acesso ao produto" em cada documento que o tem. Opcional: dados antigos. */
    accessLangs?: { documentId: string; lang: "es" | "en" | "pt" }[];
  } | null;
  /** Idioma dos textos do checkout (o do bloco de acesso deve ser o mesmo). Opcional: dados antigos. */
  locale?: PaymentLocaleId;
  hasAccessUrl: boolean;
  /** Títulos dos bumps sem link de acesso. */
  bumpsWithoutAccess: string[];
  /** Endereço ligado. */
  address: boolean;
  /** Maior preço de frete cadastrado (0 = só grátis ou nenhum). */
  paidShippingCents: number;
  /** Textos trocados escritos para outro idioma ou pagamento (staleCheckoutTexts). Opcional: dados antigos. */
  staleTexts?: boolean;
}

export interface CheckoutCheck {
  /** Moeda em que a oferta roda agora. */
  offerCurrency: CheckoutCurrencyId;
  /** Estado da chave de cada gateway usado pelos produtos. */
  keys: Partial<Record<CheckoutProviderId, PaymentKeyState>>;
  products: CheckoutCheckProduct[];
  /**
   * Regras "Purchase" que disparam sozinhas (ao abrir, tempo, rolagem) nas
   * páginas de obrigado do checkout (ou em todas as páginas): contam a compra
   * de novo, com outro eventID. pageName null = regra de todas as páginas.
   * Opcional: dados antigos.
   */
  purchaseRules?: { pageName: string | null }[];
}

export type CheckoutIssue =
  | { kind: "key"; provider: CheckoutProviderId; state: Exclude<PaymentKeyState, "ok">; labels: string[] }
  | {
      kind: "product";
      linkId: string;
      label: string;
      /** Gateway que não cobra na moeda da oferta (texto pronto), ou null. */
      currency: string | null;
      /** Sem página de obrigado. */
      thankYou: boolean;
      /** Sem link de acesso do produto. */
      access: boolean;
      /** Bumps sem link de acesso (títulos). */
      bumpsAccess: string[];
      /** Valor (ou o maior total) fora da faixa do gateway (texto pronto), ou null. */
      amount: string | null;
      /** Endereço ligado fora do real (o CEP é do Brasil): ninguém consegue comprar. */
      address: boolean;
    }
  /** Endereço desligado com frete pago cadastrado: o frete não é cobrado. Não impede a venda. */
  | { kind: "shipping"; linkId: string; label: string; priceCents: number; currency: CheckoutCurrencyId }
  /** Textos trocados escritos para outro idioma ou pagamento (a moeda da oferta mudou). Não impede a venda. */
  | { kind: "texts"; linkId: string; label: string }
  | { kind: "accessBlock"; pageName: string; documentId: string; labels: string[] }
  /**
   * Bloco "Acesso ao produto" da página de obrigado em outro idioma que o do
   * checkout: quem compra lê "Confirmando tu pago…" numa compra em português
   * (o script só troca os textos depois de liberar o acesso). Não impede a venda.
   */
  | {
      kind: "accessLang";
      pageName: string;
      documentId: string;
      blockLang: "es" | "en" | "pt";
      products: { label: string; locale: PaymentLocaleId }[];
    }
  /** Regra de Purchase automática na página de obrigado (ou em todas): a venda conta duas vezes. Só aviso do ZIP. */
  | { kind: "doublePurchase"; pageNames: (string | null)[] };

/** Problemas na ordem em que precisam ser resolvidos (vazio = pronto para vender). */
export function checkoutIssues(check: CheckoutCheck): CheckoutIssue[] {
  const out: CheckoutIssue[] = [];
  const byProvider = new Map<CheckoutProviderId, string[]>();
  for (const p of check.products) {
    // Gateway que não serve para a moeda: a chave dele não importa (o conserto é trocar o gateway).
    if (providerCurrencyProblem(p.provider, check.offerCurrency)) continue;
    const list = byProvider.get(p.provider) ?? [];
    list.push(p.label);
    byProvider.set(p.provider, list);
  }
  for (const [provider, labels] of byProvider) {
    const state = check.keys[provider] ?? "missing";
    if (state !== "ok") out.push({ kind: "key", provider, state, labels });
  }
  for (const p of check.products) {
    const currency =
      providerCurrencyProblem(p.provider, check.offerCurrency) ??
      (p.currency !== check.offerCurrency
        ? "O produto foi salvo em outra moeda: abra o link e salve de novo na moeda da oferta."
        : null);
    const methodsOk = p.methods.length > 0 && p.methods.every((m) => checkoutMethodAllows(m, p.provider, p.currency));
    let amount: string | null = null;
    if (!currency && methodsOk) {
      amount =
        checkoutAmountProblem(p.amountCents, p.provider, p.currency, p.methods) ??
        (p.maxTotalCents !== p.amountCents
          ? checkoutAmountProblem(p.maxTotalCents, p.provider, p.currency, p.methods)
          : null);
    }
    if (!currency && !methodsOk) amount = "Nenhuma forma de pagamento serve para o gateway e a moeda.";
    // Veio de um backup ou de uma gravação de antes da regra: em peso, euro ou dólar não há endereço.
    const address = p.address && (!addressAllowed(check.offerCurrency) || !addressAllowed(p.currency));
    if (currency || amount || address || !p.thankYou || !p.hasAccessUrl || p.bumpsWithoutAccess.length) {
      out.push({
        kind: "product",
        linkId: p.linkId,
        label: p.label,
        currency,
        thankYou: !p.thankYou,
        access: !p.hasAccessUrl,
        bumpsAccess: p.bumpsWithoutAccess,
        amount,
        address,
      });
    }
  }
  const pages = new Map<string, { pageName: string; documentId: string; labels: string[] }>();
  for (const p of check.products) {
    const doc = p.thankYou?.missingAccessDocumentId;
    if (!p.thankYou || !doc) continue;
    const entry = pages.get(p.thankYou.pageId) ?? { pageName: p.thankYou.name, documentId: doc, labels: [] };
    if (!entry.labels.includes(p.label)) entry.labels.push(p.label);
    pages.set(p.thankYou.pageId, entry);
  }
  for (const page of pages.values()) out.push({ kind: "accessBlock", ...page });
  const langs = new Map<string, Extract<CheckoutIssue, { kind: "accessLang" }>>();
  for (const p of check.products) {
    const thanks = p.thankYou;
    const locale = p.locale;
    if (!thanks || !locale) continue;
    const wrong = (thanks.accessLangs ?? []).find((a) => a.lang !== locale.toLowerCase());
    if (!wrong) continue;
    const entry = langs.get(thanks.pageId) ?? {
      kind: "accessLang" as const,
      pageName: thanks.name,
      documentId: wrong.documentId,
      blockLang: wrong.lang,
      products: [],
    };
    if (!entry.products.some((x) => x.label === p.label)) entry.products.push({ label: p.label, locale });
    langs.set(thanks.pageId, entry);
  }
  for (const issue of langs.values()) out.push(issue);
  for (const p of check.products) {
    // Fora do real não há endereço: o frete guardado só volta a valer se a oferta voltar ao real.
    if (!p.address && p.paidShippingCents > 0 && addressAllowed(check.offerCurrency)) {
      out.push({
        kind: "shipping",
        linkId: p.linkId,
        label: p.label,
        priceCents: p.paidShippingCents,
        currency: p.currency,
      });
    }
  }
  for (const p of check.products) {
    if (p.staleTexts) out.push({ kind: "texts", linkId: p.linkId, label: p.label });
  }
  if (check.purchaseRules?.length) {
    out.push({ kind: "doublePurchase", pageNames: check.purchaseRules.map((r) => r.pageName) });
  }
  return out;
}

/** Endereço ligado fora do real (texto pronto). */
export const ADDRESS_ISSUE_TEXT =
  "O endereço de entrega está ligado, mas ele só existe no checkout em real (o CEP é do Brasil): ninguém consegue comprar. Desligue o endereço em “Endereço e frete”.";

/** Frase dos textos trocados de outro idioma ou pagamento. */
export function textsIssueText(issue: Extract<CheckoutIssue, { kind: "texts" }>): string {
  return `Os textos trocados do checkout “${issue.label}” foram escritos para outro idioma ou outra forma de pagamento (a moeda da oferta mudou depois): quem compra pode ver textos misturados ou um “PIX” que não existe.`;
}

/** "Falta X" de um problema de produto (para o "Próximos passos" e o ZIP). */
export function checkoutProductMissing(issue: Extract<CheckoutIssue, { kind: "product" }>): string[] {
  const out: string[] = [];
  if (issue.thankYou) out.push("a página de obrigado");
  if (issue.access) out.push("o link de acesso");
  if (issue.bumpsAccess.length) {
    out.push(
      issue.bumpsAccess.length === 1
        ? `o link de acesso do bump “${issue.bumpsAccess[0]}”`
        : `os links de acesso de ${issue.bumpsAccess.length} bumps`,
    );
  }
  return out;
}

/** Frase do frete não cobrado ("o frete de R$ 19,90 não é cobrado"). */
export function shippingIssueText(issue: Extract<CheckoutIssue, { kind: "shipping" }>): string {
  return `O checkout “${issue.label}” tem frete pago cadastrado (até ${formatAmount(issue.priceCents, issue.currency)}), mas o endereço está desligado: o frete não aparece nem é cobrado.`;
}

/** Nome do gateway ("FlevoPay"). */
export const checkoutProviderLabel = (provider: CheckoutProviderId) => PROVIDER_LABEL[provider];
