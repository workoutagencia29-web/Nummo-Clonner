/**
 * Dados do cartão "Próximos passos" da oferta (regras em src/lib/readiness.ts).
 */
import { prisma } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { chosenOfferCurrency } from "@/lib/offer-currency";
import { parseOfferSettings } from "@/lib/offer-settings";
import { computeReadiness, type Readiness, type ReadinessInput } from "@/lib/readiness";
import { PRODUCT_MARK, STORE_HEADER_MARK } from "@/lib/store-pages";
import { parseUpsellFlow } from "@/lib/upsell";
import { WHEEL_MARK } from "@/lib/wheel-prizes";
import { offerCheckoutCheck } from "./checkout/checks";
import { storeCurrencyMismatch } from "./offer-currency";
import { clonedCheckoutUrls } from "./offer-links";
import { offerPaymentCheck } from "./payments/checks";

export async function getOfferReadiness(offer: {
  id: string;
  liveUrl: string | null;
  links: ReadinessInput["links"];
}): Promise<Readiness> {
  const [docs, settings, pixelCount, lastZip, checkouts, payments, currencyMismatch, ownCheckouts] = await Promise.all([
    prisma.pageDocument.findMany({
      where: { variant: { page: { offerId: offer.id } } },
      // Versão de controle e computador primeiro: os passos da roleta e dos produtos abrem essa página no editor.
      orderBy: [{ variant: { page: { position: "asc" } } }, { variant: { isControl: "desc" } }, { device: "asc" }],
      select: {
        id: true,
        html: true,
        variant: { select: { pageId: true, page: { select: { name: true, cloneMode: true } } } },
      },
    }),
    prisma.offer.findUnique({ where: { id: offer.id }, select: { settings: true, upsell: true } }),
    prisma.pixelConfig.count({ where: { offerId: offer.id, enabled: true } }),
    prisma.export.findFirst({
      where: { offerId: offer.id, status: "DONE" },
      orderBy: { createdAt: "desc" },
      select: { finishedAt: true, createdAt: true },
    }),
    clonedCheckoutUrls(offer.id),
    offerPaymentCheck(offer.id),
    storeCurrencyMismatch(offer.id),
    offerCheckoutCheck(offer.id),
  ]);
  const offerSettings = parseOfferSettings(settings?.settings);
  return computeReadiness(
    {
      htmls: docs.map((d) => d.html ?? ""),
      wheelDocs: docs.filter((d) => d.html?.includes(WHEEL_MARK)).map((d) => ({ id: d.id, html: d.html ?? "" })),
      productDocs: docs
        .filter((d) => d.html?.includes(PRODUCT_MARK) || d.html?.includes(STORE_HEADER_MARK))
        .map((d) => ({ id: d.id, pageId: d.variant.pageId, html: d.html ?? "" })),
      links: offer.links,
      clonedCheckoutUrls: checkouts,
      pixelCount,
      // Links de Política/Termos/Contato sem destino: páginas "Com scripts" ficam de fora (um script delas pode cuidar do clique).
      pageDocs: docs
        .filter((d) => d.variant.page.cloneMode !== "PRESERVE_JS")
        .map((d) => ({ id: d.id, pageId: d.variant.pageId, pageName: d.variant.page.name, html: d.html ?? "" })),
      currency: offerSettings.currency,
      chosenCurrency: chosenOfferCurrency(settings?.settings),
      language: offerSettings.language,
      currencyMismatch,
      upsell: parseUpsellFlow(settings?.upsell),
      company: offerSettings.company,
      liveUrl: offer.liveUrl,
      lastZipAt: lastZip ? (lastZip.finishedAt ?? lastZip.createdAt) : null,
      payments,
      checkouts: ownCheckouts,
    },
    dateTime,
  );
}
