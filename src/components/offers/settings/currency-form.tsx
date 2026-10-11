"use client";

/**
 * Moeda da oferta (aba "Moeda, empresa e SEO"): em qual moeda a oferta roda.
 * Trocar troca também o que já existe (src/server/services/offer-currency.ts):
 * vitrines e caixas de compra de todas as páginas, os produtos do pagamento na
 * página (quando a Kyvo cobra na moeda) e o "Valor da oferta" dos pixels. O
 * "Salvar moeda" abre antes a confirmação com tudo o que vai mudar
 * (CurrencySwitchDialog).
 *
 * Página com vitrines ou caixas de compra fora da moeda da oferta (voltou pelo
 * Histórico a um ponto de antes da troca, ou foi gravada por um editor aberto
 * antes dela): o cartão avisa e oferece "Passar tudo para …" (a mesma
 * confirmação, com a moeda que a oferta já tem). O "Próximos passos" e o aviso
 * do ZIP trazem até aqui (?campo=moeda).
 */
import { CoinsIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { CurrencyPicker } from "@/components/offers/currency-picker";
import { CURRENCY_SETTING, SETTING_QUERY_PARAM } from "@/components/offers/offer-link-href";
import { Callout } from "@/components/offers/tracking/callout";
import { Panel, SaveBar, SectionHeading, useDraft } from "@/components/offers/tracking/form-kit";
import { Button } from "@/components/ui/button";
import { replaceQuery } from "@/hooks/replace-query";
import { OFFER_CURRENCY_NAME, paymentCurrencyFor } from "@/lib/offer-currency";
import type { CurrencyMismatch } from "@/lib/offer-currency-switch";
import type { StoreCurrency } from "@/lib/store";
import { cn } from "@/lib/utils";
import { CurrencySwitchDialog } from "./currency-switch-dialog";

/** "a, b e c". */
function listPt(items: string[]) {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
}

/** Aviso das páginas fora da moeda da oferta, com o "Passar tudo para …". */
function MismatchNote({
  mismatch,
  onReapply,
  buttonRef,
  flash,
}: {
  mismatch: CurrencyMismatch;
  onReapply: () => void;
  buttonRef: React.Ref<HTMLButtonElement>;
  flash: boolean;
}) {
  const name = OFFER_CURRENCY_NAME[mismatch.currency];
  const pages = mismatch.pages.map((p) => `“${p.pageName}”`);
  const total = mismatch.pages.reduce((n, p) => n + p.hosts, 0);
  const from = listPt([...new Set(mismatch.pages.flatMap((p) => p.currencies))].map((c) => OFFER_CURRENCY_NAME[c]));
  const where = pages.length === 1 ? `da página ${pages[0]}` : `das páginas ${listPt(pages)}`;
  return (
    <Callout
      variant="warning"
      title={`${pages.length === 1 ? "1 página" : `${pages.length} páginas`} com preços em ${from}`}
      action={
        <Button
          ref={buttonRef}
          type="button"
          size="sm"
          onClick={onReapply}
          className={cn(flash && "ring-2 ring-primary ring-offset-2")}
          data-highlight={flash || undefined}
        >
          Passar tudo para {name}
        </Button>
      }
    >
      {total === 1 ? "A vitrine (ou caixa de compra)" : "As vitrines e caixas de compra"} {where} ainda{" "}
      {total === 1 ? "mostra" : "mostram"} os preços em {from}, mas a oferta roda em {name}. Acontece quando uma página
      volta pelo Histórico a um ponto de antes da troca da moeda, ou é gravada por um editor aberto antes dela.
    </Callout>
  );
}

export function CurrencyForm({
  offerId,
  currency,
  mismatch = null,
}: {
  offerId: string;
  currency: StoreCurrency;
  /** Páginas fora da moeda da oferta (getOfferSettingsPanel); null = nenhuma. */
  mismatch?: CurrencyMismatch | null;
}) {
  const { draft, patch, dirty, reset, commit } = useDraft({ currency });
  const noteId = useId();
  /** Moeda da confirmação aberta (a escolhida, ou a de agora no "Passar tudo para …"); null = fechada. */
  const [confirming, setConfirming] = useState<StoreCurrency | null>(null);

  // "Abrir a moeda da oferta" do "Próximos passos" e do aviso do ZIP (?campo=moeda): rola até o cartão
  // e põe o foco no "Passar tudo para …" (sem ele, no cartão). Como o ?campo=idioma (offer-settings-panel.tsx):
  // o pedido vira um contador, sai do endereço, e a rolagem fica num efeito à parte.
  const params = useSearchParams();
  const focusRequested = params?.get(SETTING_QUERY_PARAM) === CURRENCY_SETTING;
  const panelRef = useRef<HTMLDivElement>(null);
  const reapplyRef = useRef<HTMLButtonElement>(null);
  const [focusCount, setFocusCount] = useState(0);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!focusRequested) return;
    setFocusCount((n) => n + 1);
    replaceQuery({ [SETTING_QUERY_PARAM]: null });
  }, [focusRequested]);
  useEffect(() => {
    if (!focusCount) return;
    setFlash(true);
    const frame = requestAnimationFrame(() => {
      const target = reapplyRef.current ?? panelRef.current;
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      reapplyRef.current?.focus({ preventScroll: true });
    });
    const timer = setTimeout(() => setFlash(false), 4000);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [focusCount]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (draft.currency !== currency) setConfirming(draft.currency);
  }

  return (
    <Panel>
      <div ref={panelRef} className="scroll-mt-20 md:scroll-mt-6">
        <form noValidate onSubmit={submit} className="flex flex-col gap-5" aria-label="Moeda da oferta">
          <SectionHeading
            title={
              <span className="flex items-center gap-2">
                <CoinsIcon className="size-4.5 text-muted-foreground" aria-hidden="true" />
                Moeda da oferta
              </span>
            }
            description="Os preços das vitrines e das caixas de compra, o pagamento na página e o valor dos pixels ficam nesta moeda."
          />
          {mismatch && mismatch.currency === currency && draft.currency === currency && (
            <MismatchNote
              mismatch={mismatch}
              onReapply={() => setConfirming(currency)}
              buttonRef={reapplyRef}
              flash={flash}
            />
          )}
          <CurrencyPicker
            label="Em qual moeda essa oferta roda?"
            value={draft.currency}
            onChange={(c) => patch({ currency: c })}
            describedBy={noteId}
          />
          <div id={noteId}>
            <Callout title="Trocar a moeda troca tudo o que tem preço na oferta">
              Vitrines e caixas de compra de todas as páginas (versões A/B e celular também), os produtos do pagamento
              na página e o valor dos pixels. Os números dos preços continuam os mesmos, e preço escrito como texto nas
              páginas não muda. Antes de trocar, você vê tudo o que vai mudar.
              {!paymentCurrencyFor(draft.currency) && (
                <>
                  {" "}
                  A Kyvo (pagamento na página) não cobra em {OFFER_CURRENCY_NAME[draft.currency]}: os produtos dela
                  continuam na moeda de hoje.
                </>
              )}
            </Callout>
          </div>
          <SaveBar dirty={dirty} pending={false} onReset={reset} saveLabel="Salvar moeda" />
        </form>
      </div>
      <CurrencySwitchDialog
        offerId={offerId}
        currency={confirming ?? draft.currency}
        open={confirming !== null}
        reapply={confirming === currency}
        onOpenChange={(open) => !open && setConfirming(null)}
        onSwitched={(r) => commit({ currency: r.to })}
      />
    </Panel>
  );
}
