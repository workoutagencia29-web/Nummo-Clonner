/**
 * O que falta para o pagamento na página funcionar no site publicado — regras
 * puras, sem banco: o servidor junta os dados (offerPaymentCheck,
 * src/server/services/payments/checks.ts) e o "Próximos passos"
 * (src/lib/readiness.ts) e os avisos do ZIP (src/lib/export/warnings.ts)
 * explicam cada problema.
 */
import {
  methodAllows,
  methodCurrencyProblem,
  type PaymentCurrencyId,
  type PaymentLocaleId,
  type PaymentMethodId,
  type PaymentProviderId,
} from "./rules";

/** Marca do bloco "Acesso ao produto" no HTML salvo (src/editor/widgets/access-content.ts). */
export const ACCESS_MARK = 'data-os-widget="access"';

type BlockLang = "es" | "en" | "pt";

/** Idiomas dos blocos "Acesso ao produto" de um HTML salvo (data-os-lang da tag de abertura). */
export function accessBlockLangs(html: string): BlockLang[] {
  const out: BlockLang[] = [];
  const tags = html.match(/<[a-z][^>]*\bdata-os-widget="access"[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const m = /\bdata-os-lang="(es|en|pt)"/.exec(tag);
    const lang = (m ? m[1] : "es") as BlockLang;
    if (!out.includes(lang)) out.push(lang);
  }
  return out;
}

/**
 * A chave da API do gateway: cadastrada, faltando, salva mas ilegível
 * (APP_ENCRYPTION_KEY trocada), recusada pelo gateway no último "Testar
 * conexão" ou sem a permissão de consultar transações (transactions:read).
 */
export type PaymentKeyState = "ok" | "missing" | "unreadable" | "rejected" | "no_scope";

/**
 * Estado da chave a partir do que está salvo. Só os resultados do "Testar
 * conexão" que valem para a chave atual contam (trocar a chave zera o
 * resultado); sem conexão / gateway fora do ar são passageiros e não bloqueiam.
 */
export function gatewayKeyState(g: {
  configured: boolean;
  keyUnreadable: boolean;
  checkStatus: string | null;
}): PaymentKeyState {
  if (!g.configured) return "missing";
  if (g.keyUnreadable) return "unreadable";
  if (g.checkStatus === "invalid_key") return "rejected";
  if (g.checkStatus === "missing_scope") return "no_scope";
  return "ok";
}

export interface PaymentCheckProduct {
  linkId: string;
  /** Nome do link da oferta ("Checkout principal"). */
  label: string;
  currency: PaymentCurrencyId;
  methods: PaymentMethodId[];
  /** Idioma da janela para o comprador. */
  locale: PaymentLocaleId;
  /** Página de obrigado escolhida (null = nenhuma). */
  thankYou: {
    pageId: string;
    name: string;
    /** Documento (versão/celular) da página sem o bloco "Acesso ao produto" (null = todos têm). */
    missingAccessDocumentId: string | null;
    /** Idioma do bloco "Acesso ao produto" em cada documento que o tem. */
    accessLangs: { documentId: string; lang: BlockLang }[];
  } | null;
  hasAccessUrl: boolean;
}

export interface PaymentCheck {
  provider: PaymentProviderId;
  key: PaymentKeyState;
  products: PaymentCheckProduct[];
  /**
   * Regras "Purchase" que disparam sozinhas (ao abrir, tempo, rolagem) nas
   * páginas de obrigado do pagamento (ou em todas as páginas): contam a compra
   * de novo, com outro eventID. pageName null = regra de todas as páginas.
   */
  purchaseRules: { pageName: string | null }[];
}

export type PaymentIssue =
  | { kind: "key"; state: Exclude<PaymentKeyState, "ok"> }
  | {
      kind: "product";
      linkId: string;
      label: string;
      /** Sem página de obrigado. */
      thankYou: boolean;
      /** Sem link de acesso. */
      access: boolean;
      /** Método marcado que a moeda não aceita (texto pronto), ou null. */
      methods: string | null;
    }
  | { kind: "accessBlock"; pageName: string; documentId: string; labels: string[] }
  /**
   * O bloco "Acesso ao produto" está num idioma e um produto que leva à página
   * está em outro: o comprador sai da janela no idioma dele e cai na página de
   * obrigado em outro (os textos do pagamento confirmado o script troca; os de
   * "confirmando" e "não encontramos", não). Não impede a venda.
   */
  | {
      kind: "accessLang";
      pageName: string;
      documentId: string;
      blockLang: BlockLang;
      products: { label: string; locale: PaymentLocaleId }[];
    }
  | { kind: "doublePurchase"; pageNames: (string | null)[] };

/** Métodos do produto que a moeda não aceita ("Bizum só funciona com EUR…"), ou null. */
export function methodsProblem(currency: PaymentCurrencyId, methods: readonly PaymentMethodId[]): string | null {
  if (!methods.length) return "Nenhuma forma de pagamento marcada.";
  const wrong = methods.find((m) => !methodAllows(m, currency));
  return wrong ? methodCurrencyProblem(wrong, currency) : null;
}

/** Problemas na ordem em que precisam ser resolvidos (vazio = pronto para vender). */
export function paymentIssues(check: PaymentCheck): PaymentIssue[] {
  const out: PaymentIssue[] = [];
  if (check.key !== "ok") out.push({ kind: "key", state: check.key });
  for (const p of check.products) {
    const methods = methodsProblem(p.currency, p.methods);
    if (!p.thankYou || !p.hasAccessUrl || methods) {
      out.push({
        kind: "product",
        linkId: p.linkId,
        label: p.label,
        thankYou: !p.thankYou,
        access: !p.hasAccessUrl,
        methods,
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
  const langs = new Map<string, Extract<PaymentIssue, { kind: "accessLang" }>>();
  for (const p of check.products) {
    const thanks = p.thankYou;
    if (!thanks) continue;
    const wrong = thanks.accessLangs.find((a) => a.lang !== p.locale.toLowerCase());
    if (!wrong) continue;
    const entry = langs.get(thanks.pageId) ?? {
      kind: "accessLang" as const,
      pageName: thanks.name,
      documentId: wrong.documentId,
      blockLang: wrong.lang,
      products: [],
    };
    if (!entry.products.some((x) => x.label === p.label)) entry.products.push({ label: p.label, locale: p.locale });
    langs.set(thanks.pageId, entry);
  }
  for (const issue of langs.values()) out.push(issue);
  if (check.purchaseRules.length) {
    out.push({ kind: "doublePurchase", pageNames: check.purchaseRules.map((r) => r.pageName) });
  }
  return out;
}
