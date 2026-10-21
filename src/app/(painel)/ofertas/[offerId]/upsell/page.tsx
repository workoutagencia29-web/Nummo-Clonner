import { ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { UnsavedChangesGuard } from "@/components/app/unsaved-changes-guard";
import { UpsellSkeleton, UpsellTab } from "@/components/offers/upsell/upsell-tab";
import { prisma } from "@/lib/db";
import { requireSession } from "@/server/session";

interface Props {
  params: Promise<{ offerId: string }>;
}

/** Uma leitura por requisição (nome para o título e o caminho). */
const loadOffer = cache((offerId: string) =>
  prisma.offer.findFirst({ where: { id: offerId, deletedAt: null }, select: { id: true, name: true } }),
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireSession();
  const { offerId } = await params;
  const offer = await loadOffer(offerId);
  return { title: offer ? `Montar upsell · ${offer.name}` : "Oferta não encontrada" };
}

/**
 * Página dedicada "Montar upsell" de uma oferta (fora das abas): monta a sequência
 * de upsell/downsell pós-compra uma vez e marca em quais compras ela começa.
 */
export default async function UpsellPage({ params }: Props) {
  await requireSession();
  const { offerId } = await params;
  const offer = await loadOffer(offerId);
  if (!offer) notFound();

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Caminho" className="flex min-w-0 items-center gap-1 text-muted-foreground text-sm">
        <Link href="/ofertas" className="hover:text-foreground">
          Ofertas
        </Link>
        <ChevronRightIcon className="size-3.5 shrink-0" />
        <Link href={`/ofertas/${offer.id}`} className="truncate hover:text-foreground">
          {offer.name}
        </Link>
        <ChevronRightIcon className="size-3.5 shrink-0" />
        <span className="shrink-0 text-foreground">Upsell</span>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">Montar upsell</h1>
        <p className="max-w-3xl text-muted-foreground text-sm">
          Depois que a pessoa compra, ela passa por uma sequência de ofertas (upsells e downsells) antes da página de
          obrigado. No “SIM”, abre um checkout rápido com os dados dela já preenchidos. Monte a sequência uma vez e
          marque em quais compras ela começa.
        </p>
      </header>

      <Suspense fallback={<UpsellSkeleton />}>
        <UpsellTab offerId={offer.id} />
      </Suspense>
      <UnsavedChangesGuard />
    </div>
  );
}
