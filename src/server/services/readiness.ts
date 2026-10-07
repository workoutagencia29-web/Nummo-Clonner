/**
 * Dados do cartão "Próximos passos" da oferta (regras em src/lib/readiness.ts).
 */
import { prisma } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { parseOfferSettings } from "@/lib/offer-settings";
import { computeReadiness, type Readiness } from "@/lib/readiness";
import { WHEEL_MARK } from "@/lib/wheel-prizes";
import { offerPaymentCheck } from "./payments/checks";

export async function getOfferReadiness(offer: {
  id: string;
  liveUrl: string | null;
  links: { key: string; url: string; kind?: string | null; pay?: boolean }[];
}): Promise<Readiness> {
  const [docs, settings, pixelCount, lastZip, checkouts, payments] = await Promise.all([
    prisma.pageDocument.findMany({
      where: { variant: { page: { offerId: offer.id } } },
      // Versão de controle e computador primeiro: o passo da roleta abre essa página no editor.
      orderBy: [{ variant: { page: { position: "asc" } } }, { variant: { isControl: "desc" } }, { device: "asc" }],
      select: { id: true, html: true },
    }),
    prisma.offer.findUnique({ where: { id: offer.id }, select: { settings: true } }),
    prisma.pixelConfig.count({ where: { offerId: offer.id, enabled: true } }),
    prisma.export.findFirst({
      where: { offerId: offer.id, status: "DONE" },
      orderBy: { createdAt: "desc" },
      select: { finishedAt: true, createdAt: true },
    }),
    prisma.checkoutLink.findMany({ where: { page: { offerId: offer.id } }, select: { url: true } }),
    offerPaymentCheck(offer.id),
  ]);
  return computeReadiness(
    {
      htmls: docs.map((d) => d.html ?? ""),
      wheelDocs: docs.filter((d) => d.html?.includes(WHEEL_MARK)).map((d) => ({ id: d.id, html: d.html ?? "" })),
      links: offer.links,
      clonedCheckoutUrls: checkouts.map((c) => c.url),
      pixelCount,
      company: parseOfferSettings(settings?.settings).company,
      liveUrl: offer.liveUrl,
      lastZipAt: lastZip ? (lastZip.finishedAt ?? lastZip.createdAt) : null,
      payments,
    },
    dateTime,
  );
}
