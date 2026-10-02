/**
 * Dados do cartão "Próximos passos" da oferta (regras em src/lib/readiness.ts).
 */
import { prisma } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { parseOfferSettings } from "@/lib/offer-settings";
import { computeReadiness, type Readiness } from "@/lib/readiness";

export async function getOfferReadiness(offer: {
  id: string;
  liveUrl: string | null;
  links: { key: string; url: string }[];
}): Promise<Readiness> {
  const [docs, settings, pixelCount, lastZip, checkouts] = await Promise.all([
    prisma.pageDocument.findMany({ where: { variant: { page: { offerId: offer.id } } }, select: { html: true } }),
    prisma.offer.findUnique({ where: { id: offer.id }, select: { settings: true } }),
    prisma.pixelConfig.count({ where: { offerId: offer.id, enabled: true } }),
    prisma.export.findFirst({
      where: { offerId: offer.id, status: "DONE" },
      orderBy: { createdAt: "desc" },
      select: { finishedAt: true, createdAt: true },
    }),
    prisma.checkoutLink.findMany({ where: { page: { offerId: offer.id } }, select: { url: true } }),
  ]);
  return computeReadiness(
    {
      htmls: docs.map((d) => d.html ?? ""),
      links: offer.links,
      clonedCheckoutUrls: checkouts.map((c) => c.url),
      pixelCount,
      company: parseOfferSettings(settings?.settings).company,
      liveUrl: offer.liveUrl,
      lastZipAt: lastZip ? (lastZip.finishedAt ?? lastZip.createdAt) : null,
    },
    dateTime,
  );
}
