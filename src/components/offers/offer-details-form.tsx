"use client";

import { useState } from "react";
import { Panel, SaveBar, useDraft } from "@/components/offers/tracking/form-kit";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { updateOfferAction } from "@/server/actions/offers";

/** "meusite.com/oferta" vira "https://meusite.com/oferta". */
function withScheme(value: string) {
  const v = value.trim();
  return v && !/^https?:\/\//i.test(v) ? `https://${v}` : v;
}

/**
 * Notas internas e o endereço onde a oferta foi hospedada. Mesmo jeito de
 * salvar das outras abas: "Alterações não salvas · Descartar · Salvar".
 */
export function OfferDetailsForm({
  offer,
}: {
  offer: { id: string; notes: string | null; liveUrl: string | null; sourceUrl: string | null };
}) {
  const { draft, patch, dirty, reset, commit } = useDraft({
    notes: offer.notes ?? "",
    liveUrl: offer.liveUrl ?? "",
  });
  const [errors, setErrors] = useState<{ notes?: string; liveUrl?: string }>({});
  const { run, pending } = useAction(updateOfferAction);

  return (
    <Panel className="max-w-5xl">
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          const saved = { notes: draft.notes.trim(), liveUrl: withScheme(draft.liveUrl) };
          void run(
            { id: offer.id, notes: saved.notes || null, liveUrl: saved.liveUrl || null },
            {
              success: "Detalhes salvos.",
              silentError: true,
              onError: (msg, field) => setErrors(field === "liveUrl" ? { liveUrl: msg } : { notes: msg }),
              onSuccess: () => commit(saved),
            },
          );
        }}
      >
        <FieldGroup>
          <Field data-invalid={Boolean(errors.liveUrl)}>
            <FieldLabel htmlFor="live-url">Onde está no ar</FieldLabel>
            <Input
              id="live-url"
              type="url"
              inputMode="url"
              placeholder="https://seudominio.com.br/oferta"
              value={draft.liveUrl}
              aria-invalid={Boolean(errors.liveUrl)}
              className="max-w-2xl"
              onChange={(e) => {
                patch({ liveUrl: e.target.value });
                setErrors((x) => ({ ...x, liveUrl: undefined }));
              }}
            />
            <FieldDescription>
              Depois de subir o ZIP na sua hospedagem, cole o endereço aqui: ele aparece no card e deixa a imagem de
              compartilhamento funcionar no WhatsApp e no Facebook.
            </FieldDescription>
            <FieldError>{errors.liveUrl}</FieldError>
          </Field>
          {offer.sourceUrl && (
            <Field>
              <FieldLabel>Página original</FieldLabel>
              <a
                href={offer.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="truncate text-sm text-primary underline-offset-4 hover:underline"
              >
                {offer.sourceUrl}
              </a>
            </Field>
          )}
          <Field data-invalid={Boolean(errors.notes)}>
            <FieldLabel htmlFor="notes">Notas</FieldLabel>
            <Textarea
              id="notes"
              rows={5}
              maxLength={2000}
              placeholder="Ex.: oferta do nicho X, criativos Y, testar headline B…"
              value={draft.notes}
              aria-invalid={Boolean(errors.notes)}
              onChange={(e) => {
                patch({ notes: e.target.value });
                setErrors((x) => ({ ...x, notes: undefined }));
              }}
            />
            <FieldError>{errors.notes}</FieldError>
          </Field>
        </FieldGroup>
        <SaveBar
          dirty={dirty}
          pending={pending}
          onReset={() => {
            reset();
            setErrors({});
          }}
          saveLabel="Salvar detalhes"
        />
      </form>
    </Panel>
  );
}
