import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OfferCard } from "@/components/offers/offer-card";
import { plural } from "@/lib/format";
import { getSidebarData } from "@/server/queries";
import { listOffers, OFFER_SORTS, OFFER_STATUS_VALUES, type OfferFilters } from "@/server/services/offers";
import { listTags } from "@/server/services/organize";
import { requireSession } from "@/server/session";
import { EmptyOffers, NewOfferButton } from "./offers-empty";
import { OffersToolbar } from "./offers-toolbar";

export const metadata: Metadata = { title: "Ofertas" };

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export default async function OfertasPage({ searchParams }: PageProps<"/ofertas">) {
  await requireSession();
  const sp = await searchParams;
  const filters: OfferFilters = {
    q: typeof sp.q === "string" ? sp.q.slice(0, 200) : undefined,
    folder: typeof sp.pasta === "string" ? sp.pasta : undefined,
    tag: typeof sp.tag === "string" ? sp.tag : undefined,
    status: pick(sp.status, OFFER_STATUS_VALUES),
    sort: pick(sp.ordem, OFFER_SORTS),
  };

  const [offers, tags, sidebar] = await Promise.all([listOffers(filters), listTags(), getSidebarData()]);
  const folder = filters.folder ? sidebar.folders.find((f) => f.id === filters.folder) : undefined;
  // Pasta excluída (link antigo): volta para todas as ofertas.
  if (filters.folder && filters.folder !== "sem-pasta" && !folder) redirect("/ofertas");
  const folders = sidebar.folders.map(({ id, name }) => ({ id, name }));
  const allTags = tags.map(({ id, name, color }) => ({ id, name, color }));
  const filtering = Boolean(filters.q || filters.status || filters.tag);
  // Nada para filtrar nem botões repetidos: o estado vazio já mostra o próximo passo.
  const empty = offers.length === 0 && !filtering;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{folder ? folder.name : "Ofertas"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtering
              ? `${plural(offers.length, "oferta encontrada", "ofertas encontradas")}`
              : folder
                ? plural(offers.length, "oferta nesta pasta", "ofertas nesta pasta")
                : "Clone, edite e baixe suas páginas de oferta."}
          </p>
        </div>
        {!empty && <NewOfferButton folderId={folder?.id ?? null} />}
      </div>

      {!empty && <OffersToolbar tags={allTags} />}

      {offers.length === 0 ? (
        <EmptyOffers filtering={filtering} inFolder={Boolean(filters.folder)} folderId={folder?.id ?? null} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {offers.map((offer) => (
            <OfferCard key={offer.id} offer={offer} folders={folders} allTags={allTags} />
          ))}
        </div>
      )}
    </div>
  );
}
