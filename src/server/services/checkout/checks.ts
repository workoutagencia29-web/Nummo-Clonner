/**
 * Dados do que falta para o checkout do Offer Studio funcionar no site
 * publicado (regras em src/lib/checkout/checks.ts): chave do gateway de cada
 * produto, gateway × moeda da oferta, página de obrigado com o bloco "Acesso
 * ao produto", links de acesso (do produto e dos bumps), valor, endereço e
 * frete e textos trocados de outro idioma. Usado pelo "Próximos passos" e
 * pelos avisos do ZIP. Nunca devolve chave nem link de acesso.
 */
import type { CheckoutCheck } from "@/lib/checkout/checks";
import { parseCheckoutConfig, staleCheckoutTexts } from "@/lib/checkout/config";
import {
  CHECKOUT_METHODS,
  type CheckoutMethodId,
  type CheckoutProviderId,
  isCheckoutProvider,
} from "@/lib/checkout/rules";
import { type Db, prisma } from "@/lib/db";
import { offerCurrencyOf } from "@/lib/offer-currency";
import { ACCESS_MARK, accessBlockLangs, type PaymentKeyState } from "@/lib/payments/checks";
import { PURCHASE_AUTO_TRIGGERS, paymentKeyState } from "@/server/services/payments/checks";

/** null = a oferta não tem link "Checkout do Offer Studio" com produto. */
export async function offerCheckoutCheck(offerId: string, db: Db = prisma): Promise<CheckoutCheck | null> {
  const [offer, rows] = await Promise.all([
    db.offer.findUnique({ where: { id: offerId }, select: { settings: true } }),
    db.checkoutProduct.findMany({
      where: { link: { offerId, target: "CHECKOUT" } },
      orderBy: [{ link: { position: "asc" } }, { link: { createdAt: "asc" } }],
      select: {
        provider: true,
        amountCents: true,
        currency: true,
        methods: true,
        locale: true,
        accessUrl: true,
        config: true,
        linkId: true,
        link: { select: { label: true } },
        thankYouPage: { select: { id: true, name: true } },
      },
    }),
  ]);
  if (!offer || !rows.length) return null;
  const providers = [...new Set(rows.map((r) => r.provider))].filter(isCheckoutProvider);
  const pageIds = [...new Set(rows.flatMap((r) => (r.thankYouPage ? [r.thankYouPage.id] : [])))];
  const [states, docs, withAccess, rules] = await Promise.all([
    Promise.all(providers.map(async (p) => [p, await paymentKeyState(offerId, p, db)] as const)),
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
    // Purchase que dispara sozinho na página de obrigado (ou em todas): a página de checkout já manda o dela.
    db.eventRule.findMany({
      where: {
        offerId,
        enabled: true,
        event: "PURCHASE",
        trigger: { in: [...PURCHASE_AUTO_TRIGGERS] },
        OR: [{ pageId: null }, ...(pageIds.length ? [{ pageId: { in: pageIds } }] : [])],
      },
      orderBy: { createdAt: "asc" },
      select: { page: { select: { name: true } } },
    }),
  ]);
  const keys: Partial<Record<CheckoutProviderId, PaymentKeyState>> = Object.fromEntries(states);
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
    offerCurrency: offerCurrencyOf(offer.settings),
    keys,
    purchaseRules: rules.map((r) => ({ pageName: r.page?.name ?? null })),
    products: rows.flatMap((r) => {
      if (!isCheckoutProvider(r.provider)) return [];
      const config = parseCheckoutConfig(r.config);
      const bumps = config.bumps.reduce((n, b) => n + b.priceCents, 0);
      const shippingMax = Math.max(0, ...config.shipping.map((s) => s.priceCents));
      return [
        {
          linkId: r.linkId,
          label: r.link.label,
          provider: r.provider,
          currency: r.currency,
          methods: CHECKOUT_METHODS.filter((m): m is CheckoutMethodId => r.methods.includes(m)),
          amountCents: r.amountCents,
          maxTotalCents: r.amountCents + bumps + (config.address ? shippingMax : 0),
          thankYou: r.thankYouPage
            ? {
                pageId: r.thankYouPage.id,
                name: r.thankYouPage.name,
                missingAccessDocumentId: missingDoc.get(r.thankYouPage.id) ?? null,
                accessLangs: langsOf.get(r.thankYouPage.id) ?? [],
              }
            : null,
          locale: r.locale,
          hasAccessUrl: Boolean(r.accessUrl.trim()),
          bumpsWithoutAccess: config.bumps.filter((b) => !b.accessUrl.trim()).map((b) => b.title),
          address: config.address,
          paidShippingCents: shippingMax,
          staleTexts: staleCheckoutTexts(config, r.locale, r.provider),
        },
      ];
    }),
  };
}
