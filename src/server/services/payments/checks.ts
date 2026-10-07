/**
 * Dados do que falta para o pagamento na página funcionar no site publicado
 * (regras em src/lib/payments/checks.ts): chave do gateway, página de
 * obrigado com o bloco "Acesso ao produto", link de acesso, métodos e regras
 * de Purchase que contariam a compra duas vezes. Usado pelo "Próximos passos"
 * e pelos avisos do ZIP. Nunca devolve a chave nem o link de acesso.
 */
import { tryDecryptSecret } from "@/lib/crypto";
import { type Db, prisma } from "@/lib/db";
import {
  ACCESS_MARK,
  accessBlockLangs,
  gatewayKeyState,
  type PaymentCheck,
  type PaymentKeyState,
} from "@/lib/payments/checks";
import type { PaymentProviderId } from "@/lib/payments/rules";

/** A chave do gateway está cadastrada, legível e não foi recusada no último "Testar conexão"? */
export async function paymentKeyState(provider: PaymentProviderId, db: Db = prisma): Promise<PaymentKeyState> {
  const row = await db.paymentGateway.findUnique({
    where: { provider },
    select: { apiKeyEnc: true, checkStatus: true },
  });
  return gatewayKeyState({
    configured: Boolean(row),
    keyUnreadable: Boolean(row) && !tryDecryptSecret(row?.apiKeyEnc),
    checkStatus: row?.checkStatus ?? null,
  });
}

/** Gatilhos que disparam a regra sozinhos, sem o comprador fazer nada. */
const AUTO_TRIGGERS = ["PAGE_LOAD", "TIME_ON_PAGE", "SCROLL_DEPTH"] as const;

/** null = a oferta não tem link de "Pagamento na página" com produto. */
export async function offerPaymentCheck(offerId: string, db: Db = prisma): Promise<PaymentCheck | null> {
  const rows = await db.paymentProduct.findMany({
    where: { link: { offerId, target: "PAYMENT" } },
    orderBy: [{ link: { position: "asc" } }, { link: { createdAt: "asc" } }],
    select: {
      provider: true,
      currency: true,
      methods: true,
      locale: true,
      accessUrl: true,
      linkId: true,
      link: { select: { label: true } },
      thankYouPage: { select: { id: true, name: true } },
    },
  });
  if (!rows.length) return null;
  const provider = rows[0].provider;
  const pageIds = [...new Set(rows.flatMap((r) => (r.thankYouPage ? [r.thankYouPage.id] : [])))];
  const [key, docs, withAccess, rules] = await Promise.all([
    paymentKeyState(provider, db),
    pageIds.length
      ? db.pageDocument.findMany({
          where: { variant: { pageId: { in: pageIds } } },
          // Versão de controle e computador primeiro: é a que o conserto abre no editor.
          orderBy: [{ variant: { isControl: "desc" } }, { variant: { position: "asc" } }, { device: "asc" }],
          select: { id: true, variant: { select: { pageId: true } } },
        })
      : [],
    pageIds.length
      ? db.pageDocument.findMany({
          where: { variant: { pageId: { in: pageIds } }, html: { contains: ACCESS_MARK } },
          orderBy: [{ variant: { isControl: "desc" } }, { variant: { position: "asc" } }, { device: "asc" }],
          select: { id: true, html: true, variant: { select: { pageId: true } } },
        })
      : [],
    db.eventRule.findMany({
      where: {
        offerId,
        enabled: true,
        event: "PURCHASE",
        trigger: { in: [...AUTO_TRIGGERS] },
        OR: [{ pageId: null }, ...(pageIds.length ? [{ pageId: { in: pageIds } }] : [])],
      },
      orderBy: { createdAt: "asc" },
      select: { page: { select: { name: true } } },
    }),
  ]);
  const ok = new Set(withAccess.map((d) => d.id));
  // Idioma do bloco de acesso em cada documento que o tem (por página).
  const langsOf = new Map<string, { documentId: string; lang: "es" | "en" | "pt" }[]>();
  for (const doc of withAccess) {
    const list = langsOf.get(doc.variant.pageId) ?? [];
    for (const lang of accessBlockLangs(doc.html ?? "")) list.push({ documentId: doc.id, lang });
    langsOf.set(doc.variant.pageId, list);
  }
  // Cada versão A/B e o layout do celular precisam do bloco (o comprador pode cair em qualquer um).
  const missingDoc = new Map<string, string | null>();
  for (const id of pageIds) missingDoc.set(id, null);
  for (const doc of docs) {
    if (!ok.has(doc.id) && missingDoc.get(doc.variant.pageId) === null) missingDoc.set(doc.variant.pageId, doc.id);
  }
  return {
    provider,
    key,
    products: rows.map((r) => ({
      linkId: r.linkId,
      label: r.link.label,
      currency: r.currency,
      methods: r.methods,
      locale: r.locale,
      thankYou: r.thankYouPage
        ? {
            pageId: r.thankYouPage.id,
            name: r.thankYouPage.name,
            missingAccessDocumentId: missingDoc.get(r.thankYouPage.id) ?? null,
            accessLangs: langsOf.get(r.thankYouPage.id) ?? [],
          }
        : null,
      hasAccessUrl: Boolean(r.accessUrl.trim()),
    })),
    purchaseRules: rules.map((r) => ({ pageName: r.page?.name ?? null })),
  };
}
