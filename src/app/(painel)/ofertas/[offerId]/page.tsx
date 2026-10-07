import { CalendarIcon, ChevronRightIcon, FileStackIcon, MoreHorizontalIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { UnsavedChangesGuard } from "@/components/app/unsaved-changes-guard";
import { EXPORT_QUERY_PARAM } from "@/components/offers/export/logic";
import { OfferExportActions } from "@/components/offers/export/offer-export-actions";
import { OfferDetailsForm } from "@/components/offers/offer-details-form";
import { OfferLinks } from "@/components/offers/offer-links";
import { OfferTabs } from "@/components/offers/offer-tabs";
import { OfferThumbnail } from "@/components/offers/offer-thumbnail";
import { PagesList } from "@/components/offers/pages-list";
import { RENAME_QUERY_PARAM } from "@/components/offers/query-params";
import { ReadinessCard } from "@/components/offers/readiness-card";
import { OfferSettingsSkeleton } from "@/components/offers/settings/settings-skeleton";
import { OfferSettingsTab } from "@/components/offers/settings/settings-tab";
import { StatusBadge } from "@/components/offers/status-badge";
import { TagChip } from "@/components/offers/tag-chip";
import { trackingSectionOf } from "@/components/offers/tracking/helpers";
import { TrackingSkeleton } from "@/components/offers/tracking/tracking-skeleton";
import { TrackingTab } from "@/components/offers/tracking/tracking-tab";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { dateTime, plural } from "@/lib/format";
import { gatewayKeyState } from "@/lib/payments/checks";
import { getOfferDetail, getSidebarData } from "@/server/queries";
import { existingFunnel } from "@/server/services/funnel";
import { linkUsageDetail, listOfferLinks } from "@/server/services/offer-links";
import { listTags } from "@/server/services/organize";
import { listPaymentGateways } from "@/server/services/payments/gateways";
import { getOfferReadiness } from "@/server/services/readiness";
import { requireSession } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/ofertas/[offerId]">): Promise<Metadata> {
  await requireSession();
  const { offerId } = await params;
  const offer = await getOfferDetail(offerId);
  return { title: offer?.name ?? "Oferta não encontrada" };
}

/** ?baixar=1 (vindo do "Baixar ZIP" do menu do card): abre o diálogo do ZIP ao chegar. */
function wantsExport(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) === "1";
}

/** Documento que abre no editor: o único, ou a versão para computador; e a versão celular separada. */
function documentsOf(documents: { id: string; device: "ALL" | "DESKTOP" | "MOBILE" }[]) {
  const main = documents.find((d) => d.device === "ALL") ?? documents.find((d) => d.device === "DESKTOP");
  const mobile = documents.find((d) => d.device === "MOBILE");
  return {
    documentId: (main ?? mobile)?.id ?? null,
    mobileDocumentId: main && mobile ? mobile.id : null,
  };
}

export default async function OfferPage({ params, searchParams }: PageProps<"/ofertas/[offerId]">) {
  await requireSession();
  const { offerId } = await params;
  const query = await searchParams;
  const [offer, tags, sidebar] = await Promise.all([getOfferDetail(offerId), listTags(), getSidebarData()]);
  if (!offer) notFound();
  const [links, usage, funnel, gateways] = await Promise.all([
    listOfferLinks(offer.id),
    linkUsageDetail(offer.id),
    existingFunnel(offer.id),
    listPaymentGateways(),
  ]);
  const readiness = await getOfferReadiness({ id: offer.id, liveUrl: offer.liveUrl, links });

  const folders = sidebar.folders.map(({ id, name }) => ({ id, name }));
  const allTags = tags.map(({ id, name, color }) => ({ id, name, color }));

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Caminho" className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/ofertas" className="hover:text-foreground">
          Ofertas
        </Link>
        {offer.folder && (
          <>
            <ChevronRightIcon className="size-3.5" />
            <Link href={`/ofertas?pasta=${offer.folder.id}`} className="hover:text-foreground">
              {offer.folder.name}
            </Link>
          </>
        )}
        <ChevronRightIcon className="size-3.5" />
        <span className="truncate text-foreground">{offer.name}</span>
      </nav>

      <header className="flex items-start gap-4">
        <div className="aspect-[16/10] w-24 shrink-0 overflow-hidden rounded-lg border bg-muted sm:w-44">
          <OfferThumbnail name={offer.name} thumbnailKey={offer.thumbnailKey} />
        </div>
        <div className="min-w-0 flex-1">
          {/* No celular, os botões descem para baixo do título (senão o nome quebra no meio da palavra). */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <h1 className="min-w-0 text-xl font-semibold tracking-tight break-words sm:text-2xl">{offer.name}</h1>
            <OfferExportActions
              offerId={offer.id}
              autoOpen={wantsExport(query[EXPORT_QUERY_PARAM])}
              menu={{
                offer: {
                  id: offer.id,
                  name: offer.name,
                  status: offer.status,
                  folderId: offer.folderId,
                  tagIds: offer.tags.map((t) => t.tag.id),
                  liveUrl: offer.liveUrl,
                },
                autoRename: query[RENAME_QUERY_PARAM] === "1",
                folders,
                allTags,
                afterTrashHref: "/ofertas",
                trigger: (
                  <Button variant="outline" size="sm">
                    <MoreHorizontalIcon />
                    Ações
                  </Button>
                ),
              }}
            />
          </div>
          {/* Sem "·" entre os itens: ao quebrar a linha no celular, nenhum separador fica solto. */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            <StatusBadge status={offer.status} />
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <FileStackIcon className="size-3.5" aria-hidden="true" />
              {plural(offer.pages.length, "página", "páginas")}
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <CalendarIcon className="size-3.5" aria-hidden="true" />
              Criada em {dateTime(offer.createdAt)}
            </span>
          </div>
          {offer.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {offer.tags.map(({ tag }) => (
                <TagChip key={tag.id} name={tag.name} color={tag.color} />
              ))}
            </div>
          )}
        </div>
      </header>

      <ReadinessCard offerId={offer.id} readiness={readiness} />

      <OfferTabs>
        <TabsContent value="paginas" keepMounted className="mt-4">
          <PagesList
            offerId={offer.id}
            pages={offer.pages.map((p) => ({
              id: p.id,
              name: p.name,
              slug: p.slug,
              type: p.type,
              isHome: p.isHome,
              variantCount: p._count.variants,
              ...documentsOf(p.variants[0]?.documents ?? []),
            }))}
            existingFunnel={funnel}
          />
        </TabsContent>
        <TabsContent value="links" keepMounted className="mt-4">
          <OfferLinks
            offerId={offer.id}
            links={links.map((l) => ({
              ...l,
              usage: usage.buttons.get(l.key) ?? 0,
              prizes: usage.prizes.get(l.key) ?? 0,
            }))}
            pages={offer.pages.map((p) => ({ id: p.id, name: p.name, type: p.type }))}
            paymentsKey={gatewayKeyState(
              gateways.find((g) => g.configured) ?? { configured: false, keyUnreadable: false, checkStatus: null },
            )}
          />
        </TabsContent>
        <TabsContent value="rastreamento" keepMounted className="mt-4">
          <Suspense fallback={<TrackingSkeleton />}>
            <TrackingTab offerId={offer.id} section={trackingSectionOf(query.secao)} />
          </Suspense>
        </TabsContent>
        <TabsContent value="configuracoes" keepMounted className="mt-4">
          <Suspense fallback={<OfferSettingsSkeleton />}>
            <OfferSettingsTab offerId={offer.id} />
          </Suspense>
        </TabsContent>
        <TabsContent value="detalhes" keepMounted className="mt-4">
          <OfferDetailsForm offer={offer} />
        </TabsContent>
      </OfferTabs>
      {/* Abas abertas continuam montadas (keepMounted): o não salvo fica lá na volta; sair pergunta antes. */}
      <UnsavedChangesGuard />
    </div>
  );
}
