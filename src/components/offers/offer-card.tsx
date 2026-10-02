"use client";

import { FileStackIcon, GlobeIcon, MoreHorizontalIcon } from "lucide-react";
import Link from "next/link";
import { OfferMenu } from "@/components/offers/offer-menu";
import { OfferThumbnail } from "@/components/offers/offer-thumbnail";
import { StatusBadge } from "@/components/offers/status-badge";
import { TagChip } from "@/components/offers/tag-chip";
import type { TagOption } from "@/components/offers/tag-editor-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { dateTime, plural, timeAgo } from "@/lib/format";
import { displayUrl, splitCopySuffix } from "@/lib/text";

export interface OfferCardData {
  id: string;
  name: string;
  status: "DRAFT" | "LIVE" | "ARCHIVED";
  liveUrl: string | null;
  sourceUrl: string | null;
  thumbnailKey: string | null;
  updatedAt: Date;
  folder: { id: string; name: string } | null;
  tags: { tag: TagOption }[];
  _count: { pages: number };
}

export function OfferCard({
  offer,
  folders,
  allTags,
}: {
  offer: OfferCardData;
  folders: { id: string; name: string }[];
  allTags: TagOption[];
}) {
  const where = displayUrl(offer.liveUrl);
  const title = splitCopySuffix(offer.name);
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md focus-within:ring-[3px] focus-within:ring-ring/40">
      <Link
        href={`/ofertas/${offer.id}`}
        className="relative block aspect-[16/10] overflow-hidden border-b bg-muted outline-none"
        aria-label={`Abrir ${offer.name}`}
      >
        <OfferThumbnail
          name={offer.name}
          thumbnailKey={offer.thumbnailKey}
          className="transition-transform duration-300 group-hover:scale-[1.02]"
        />
        <StatusBadge status={offer.status} className="absolute top-2.5 left-2.5 shadow-xs" />
      </Link>

      <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
        <OfferMenu
          offer={{
            id: offer.id,
            name: offer.name,
            status: offer.status,
            folderId: offer.folder?.id ?? null,
            tagIds: offer.tags.map((t) => t.tag.id),
          }}
          folders={folders}
          allTags={allTags}
          showOpen
          trigger={
            <Button variant="secondary" size="icon-sm" className="shadow-sm" aria-label={`Ações de ${offer.name}`}>
              <MoreHorizontalIcon />
            </Button>
          }
        />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        {/* O "(2)" das cópias fica fora do corte de 2 linhas: cópias de nomes longos não ficam iguais. */}
        <Link
          href={`/ofertas/${offer.id}`}
          title={offer.name}
          aria-label={offer.name}
          className="flex min-w-0 items-end gap-1 font-medium leading-snug hover:underline"
        >
          <span className="line-clamp-2 min-w-0 break-words">{title.base}</span>
          {title.suffix && (
            <span className="mb-px shrink-0 rounded-md bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
              nº {title.suffix.slice(1, -1)}
            </span>
          )}
        </Link>
        {where ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <GlobeIcon className="size-3.5 shrink-0" />
            <span className="truncate" title={offer.liveUrl ?? undefined}>
              {where}
            </span>
          </div>
        ) : offer.status === "LIVE" ? (
          // "No ar" sem endereço: em vez de um cartão contraditório, o atalho para informar.
          <Link
            href={`/ofertas/${offer.id}?aba=detalhes`}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            <GlobeIcon className="size-3.5 shrink-0" />
            <span className="truncate">Adicionar o endereço onde está no ar</span>
          </Link>
        ) : null}
        {offer.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {offer.tags.slice(0, 4).map(({ tag }) => (
              <TagChip key={tag.id} name={tag.name} color={tag.color} />
            ))}
            {offer.tags.length > 4 && (
              <span className="text-[11px] text-muted-foreground">+{offer.tags.length - 4}</span>
            )}
          </div>
        )}
        <div className="mt-auto flex items-center justify-between pt-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <FileStackIcon className="size-3.5" />
            {plural(offer._count.pages, "página", "páginas")}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <time dateTime={new Date(offer.updatedAt).toISOString()} suppressHydrationWarning>
                {timeAgo(offer.updatedAt)}
              </time>
            </TooltipTrigger>
            <TooltipContent>Atualizada em {dateTime(offer.updatedAt)}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </article>
  );
}
