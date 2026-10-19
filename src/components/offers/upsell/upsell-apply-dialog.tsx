"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { applyUpsellAction, offersForUpsellApplyAction } from "@/server/actions/upsell";
import type { UpsellTargetOffer } from "@/server/services/upsell-apply";

/**
 * "Usar este upsell em outras ofertas": lista as ofertas da mesma moeda, você
 * marca as que quer e, ao aplicar, o upsell (páginas + produtos + ligações) é
 * copiado para cada uma. Reaplicar substitui o upsell que já estava lá.
 */
export function UpsellApplyDialog({
  open,
  onOpenChange,
  offerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offerId: string;
}) {
  const { run: loadOffers, pending: loading } = useAction(offersForUpsellApplyAction);
  const { run: apply, pending: applying } = useAction(applyUpsellAction);
  const [offers, setOffers] = useState<UpsellTargetOffer[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setOffers(null);
    setPicked(new Set());
    void loadOffers({ offerId }, { onSuccess: setOffers });
  }, [open, offerId, loadOffers]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allIds = offers?.map((o) => o.id) ?? [];
  const allPicked = allIds.length > 0 && allIds.every((id) => picked.has(id));
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(allIds));

  const submit = () => {
    if (!picked.size) return;
    void apply(
      { offerId, targetOfferIds: [...picked] },
      {
        success: (r) =>
          `Upsell aplicado em ${r.applied.length} ${r.applied.length === 1 ? "oferta" : "ofertas"}.${
            r.skipped.length ? ` ${r.skipped.length} não deu para aplicar.` : ""
          }`,
        onSuccess: () => onOpenChange(false),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Usar este upsell em outras ofertas</DialogTitle>
          <DialogDescription>
            Copia este upsell (as páginas, os produtos e as ligações) para as ofertas que você marcar. Aparecem só as
            ofertas na mesma moeda. A chave de pagamento <b>não</b> vai junto — cadastre em cada oferta. Reaplicar
            substitui o upsell que já estava na oferta.
          </DialogDescription>
        </DialogHeader>

        <div className="my-3">
          {offers === null || loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
              <Spinner /> Carregando ofertas…
            </div>
          ) : offers.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground text-sm">
              Você não tem outras ofertas na mesma moeda desta.
            </p>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-muted-foreground text-xs">
                  {picked.size} de {offers.length} escolhidas
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={toggleAll}>
                  {allPicked ? "Limpar" : "Selecionar todas"}
                </Button>
              </div>
              <ScrollArea className="h-64 rounded-md border">
                <ul className="divide-y">
                  {offers.map((o) => (
                    <li key={o.id} className="flex items-center gap-3 p-3 text-sm hover:bg-muted/40">
                      <Checkbox id={`ap-${o.id}`} checked={picked.has(o.id)} onCheckedChange={() => toggle(o.id)} />
                      <label htmlFor={`ap-${o.id}`} className="min-w-0 flex-1 cursor-pointer truncate">
                        {o.name}
                      </label>
                      {o.hasUpsell && (
                        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 text-xs dark:bg-amber-950/40 dark:text-amber-200">
                          já tem upsell — substitui
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            Cancelar
          </Button>
          <Button type="button" disabled={!picked.size || applying} onClick={submit}>
            {applying && <Spinner />}
            Aplicar{picked.size > 0 ? ` (${picked.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
