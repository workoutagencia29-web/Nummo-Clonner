"use client";

import { useId, useState } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { CURRENCIES, CURRENCY_LABEL, type TrackingSettings } from "@/lib/tracking/schema";
import { saveTrackingSettingsAction } from "@/server/actions/tracking";
import { Panel, SaveBar, SectionHeading, useDraft } from "./form-kit";
import { formatAmount, parseAmount } from "./helpers";

type Currency = TrackingSettings["value"]["currency"];

const SYMBOL: Record<Currency, string> = { BRL: "R$", USD: "US$", EUR: "€" };

/** Moeda e valor enviados junto com InitiateCheckout e Purchase. */
export function ValueForm({ offerId, value }: { offerId: string; value: TrackingSettings["value"] }) {
  const { draft, patch, dirty, reset, commit } = useDraft({
    currency: value.currency,
    amount: formatAmount(value.amount),
  });
  const [error, setError] = useState<string | undefined>();
  const save = useAction(saveTrackingSettingsAction);
  const ids = useId();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseAmount(draft.amount);
    if (amount !== null && (Number.isNaN(amount) || amount < 0 || amount > 1_000_000)) {
      setError("Informe um valor entre 0 e 1.000.000, como 97,00.");
      return;
    }
    void save.run(
      { offerId, value: { currency: draft.currency, amount } },
      {
        success: "Valor salvo.",
        silentError: true,
        onError: setError,
        onSuccess: (s) => commit({ currency: s.value.currency, amount: formatAmount(s.value.amount) }),
      },
    );
  }

  return (
    <Panel>
      <form noValidate onSubmit={submit} className="flex flex-col gap-5">
        <SectionHeading
          as="h3"
          title="Valor da oferta"
          description="Vai junto com os eventos InitiateCheckout e Purchase. Ajuda a Meta, o TikTok e o Google a otimizar as campanhas por valor. Deixe em branco para não enviar."
        />
        <div className="flex flex-wrap items-start gap-3">
          <Field className="w-44">
            <FieldLabel htmlFor={`${ids}-currency`}>Moeda</FieldLabel>
            <Select value={draft.currency} onValueChange={(v) => patch({ currency: v as Currency })}>
              <SelectTrigger id={`${ids}-currency`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CURRENCY_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="w-52" data-invalid={Boolean(error)}>
            <FieldLabel htmlFor={`${ids}-amount`}>Valor</FieldLabel>
            <div className="flex items-center rounded-md border border-input shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 has-[[aria-invalid=true]]:border-destructive">
              <span className="pl-3 text-sm text-muted-foreground">{SYMBOL[draft.currency]}</span>
              <Input
                id={`${ids}-amount`}
                inputMode="decimal"
                autoComplete="off"
                placeholder="97,00"
                value={draft.amount}
                aria-invalid={Boolean(error)}
                className="border-0 shadow-none focus-visible:ring-0"
                onChange={(e) => {
                  patch({ amount: e.target.value });
                  setError(undefined);
                }}
                onBlur={() => {
                  const n = parseAmount(draft.amount);
                  if (n !== null && !Number.isNaN(n)) patch({ amount: formatAmount(n) });
                }}
              />
            </div>
          </Field>
        </div>
        {error ? (
          <FieldError>{error}</FieldError>
        ) : (
          <FieldDescription>Use o preço principal do produto. Pode escrever 97, 97,90 ou 1.997,00.</FieldDescription>
        )}
        <SaveBar
          dirty={dirty}
          pending={save.pending}
          onReset={() => {
            reset();
            setError(undefined);
          }}
          saveLabel="Salvar valor"
        />
      </form>
    </Panel>
  );
}
