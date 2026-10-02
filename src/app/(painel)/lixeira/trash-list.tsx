"use client";

import { RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { OfferThumbnail } from "@/components/offers/offer-thumbnail";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useAction } from "@/hooks/use-action";
import { plural, timeAgo } from "@/lib/format";
import { deleteOfferForeverAction, emptyTrashAction, restoreOfferAction } from "@/server/actions/offers";

interface TrashedOffer {
  id: string;
  name: string;
  thumbnailKey: string | null;
  deletedAt: Date;
  pages: number;
}

export function TrashList({ offers }: { offers: TrashedOffer[] }) {
  const [deleting, setDeleting] = useState<TrashedOffer | null>(null);
  const [emptying, setEmptying] = useState(false);
  const restore = useAction(restoreOfferAction);
  const remove = useAction(deleteOfferForeverAction);
  const empty = useAction(emptyTrashAction);

  if (offers.length === 0) {
    return (
      <Empty className="border border-dashed py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Trash2Icon />
          </EmptyMedia>
          <EmptyTitle>A lixeira está vazia</EmptyTitle>
          <EmptyDescription>Quando você mover uma oferta para a lixeira, ela aparece aqui.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{plural(offers.length, "oferta", "ofertas")}</span>
        <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setEmptying(true)}>
          <Trash2Icon />
          Esvaziar lixeira
        </Button>
      </div>
      <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
        {offers.map((offer) => (
          <li key={offer.id} className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap sm:px-4">
            <div className="aspect-[16/10] w-20 shrink-0 overflow-hidden rounded-md border bg-muted">
              <OfferThumbnail name={offer.name} thumbnailKey={offer.thumbnailKey} className="text-base" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{offer.name}</p>
              <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                {plural(offer.pages, "página", "páginas")} · apagada {timeAgo(offer.deletedAt)}
              </p>
            </div>
            <div className="flex w-full shrink-0 justify-end gap-2 sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                disabled={restore.pending}
                onClick={() => void restore.run({ id: offer.id }, { success: `"${offer.name}" restaurada.` })}
              >
                <RotateCcwIcon />
                Restaurar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleting(offer)}
              >
                Excluir de vez
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Excluir "${deleting?.name ?? ""}" para sempre?`}
        description="Todas as páginas, versões e configurações desta oferta serão apagadas. Não dá para desfazer."
        confirmLabel="Excluir para sempre"
        destructive
        pending={remove.pending}
        onConfirm={() => {
          if (!deleting) return;
          void remove.run({ id: deleting.id }, { success: "Oferta excluída.", onSuccess: () => setDeleting(null) });
        }}
      />
      <ConfirmDialog
        open={emptying}
        onOpenChange={setEmptying}
        title="Esvaziar a lixeira?"
        description={`${plural(offers.length, "oferta será apagada", "ofertas serão apagadas")} para sempre. Não dá para desfazer.`}
        confirmLabel="Esvaziar lixeira"
        destructive
        pending={empty.pending}
        onConfirm={() =>
          void empty.run(
            {},
            {
              success: (r) => `${plural(r.count, "oferta excluída", "ofertas excluídas")}.`,
              onSuccess: () => setEmptying(false),
            },
          )
        }
      />
    </div>
  );
}
