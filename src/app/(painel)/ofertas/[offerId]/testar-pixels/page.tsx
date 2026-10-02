import { ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { buildTestSetup } from "@/components/offers/pixel-test/logic";
import { PixelTestScreen } from "@/components/offers/pixel-test/pixel-test-screen";
import { getTrackingPanel } from "@/server/services/tracking";
import { offerVariantChoices } from "@/server/services/variants";
import { requireSession } from "@/server/session";

/** Uma leitura por requisição (título da aba + tela). */
const loadPanel = cache(getTrackingPanel);

interface Props {
  params: Promise<{ offerId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireSession();
  const { offerId } = await params;
  const panel = await loadPanel(offerId);
  return { title: panel ? `Testar pixels · ${panel.offer.name}` : "Oferta não encontrada" };
}

/**
 * Tela "Testar pixels" de uma oferta: abre a página com os pixels de verdade
 * numa aba nova e mostra, ao vivo, cada pixel carregando e cada evento disparando.
 */
export default async function PixelTestPage({ params }: Props) {
  await requireSession();
  const { offerId } = await params;
  const [panel, variants] = await Promise.all([loadPanel(offerId), offerVariantChoices(offerId)]);
  if (!panel) notFound();

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Caminho" className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        <Link href="/ofertas" className="hover:text-foreground">
          Ofertas
        </Link>
        <ChevronRightIcon className="size-3.5 shrink-0" />
        <Link href={`/ofertas/${panel.offer.id}?aba=rastreamento`} className="truncate hover:text-foreground">
          {panel.offer.name}
        </Link>
        <ChevronRightIcon className="size-3.5 shrink-0" />
        <span className="shrink-0 text-foreground">Testar pixels</span>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Testar pixels</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Abra a página com os pixels de verdade e acompanhe aqui, ao vivo, cada pixel carregando e cada evento
          disparando — inclusive os que um bloqueador de anúncios impediu.
        </p>
      </header>

      <PixelTestScreen setup={buildTestSetup(panel, variants)} />
    </div>
  );
}
