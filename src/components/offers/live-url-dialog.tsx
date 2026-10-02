"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { updateOfferAction } from "@/server/actions/offers";

/**
 * Marcar a oferta como "No ar" pedindo, no mesmo passo, o endereço onde ela está
 * publicada ("Onde está no ar"). Em branco, só troca o status.
 */
export function LiveUrlDialog({
  open,
  onOpenChange,
  offerId,
  offerName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offerId: string;
  offerName: string;
}) {
  const update = useAction(updateOfferAction);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUrl("");
      setError(null);
    }
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    let liveUrl = url.trim();
    // "minhaoferta.com.br" → "https://minhaoferta.com.br"
    if (liveUrl && !/^https?:\/\//i.test(liveUrl)) liveUrl = `https://${liveUrl}`;
    void update.run(
      { id: offerId, status: "LIVE", ...(liveUrl ? { liveUrl } : {}) },
      {
        success: liveUrl ? "Status: No ar. Endereço salvo." : "Status: No ar.",
        silentError: true,
        onError: setError,
        onSuccess: () => onOpenChange(false),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Onde a oferta está no ar?</DialogTitle>
            <DialogDescription>
              Informe o endereço em que você publicou “{offerName}”. Ele aparece no cartão e completa a imagem de
              compartilhamento do ZIP.
            </DialogDescription>
          </DialogHeader>
          <Field className="my-5" data-invalid={Boolean(error)}>
            <FieldLabel htmlFor="live-url-input">Endereço da página</FieldLabel>
            <Input
              id="live-url-input"
              type="text"
              inputMode="url"
              autoComplete="url"
              value={url}
              placeholder="https://suaoferta.com.br"
              aria-invalid={Boolean(error)}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              autoFocus
            />
            <FieldError>{error}</FieldError>
            <FieldDescription>Ainda não sabe? Deixe em branco e informe depois, em Detalhes.</FieldDescription>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={update.pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={update.pending}>
              {update.pending && <Spinner />}
              Marcar como no ar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
