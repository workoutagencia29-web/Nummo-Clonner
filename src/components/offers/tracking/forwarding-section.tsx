"use client";

import { PlusIcon, RotateCcwIcon, ShieldCheckIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { plural } from "@/lib/format";
import { type ConsentModeId, DEFAULT_FORWARD_PARAMS, type TrackingSettings } from "@/lib/tracking/schema";
import { cn } from "@/lib/utils";
import { saveTrackingSettingsAction } from "@/server/actions/tracking";
import { Callout } from "./callout";
import { Panel, SaveBar, SectionHeading, SwitchRow, useDraft } from "./form-kit";
import { forwardParamProblem, isDefaultParams, MAX_FORWARD_PARAMS, paramGroup } from "./helpers";

type Forwarding = TrackingSettings["forwarding"];

const GROUP_STYLE: Record<ReturnType<typeof paramGroup>, string> = {
  utm: "border-primary/30 bg-primary/5",
  click: "border-sky-500/30 bg-sky-500/5",
  platform: "border-amber-500/40 bg-amber-500/10",
  other: "border-border bg-muted/40",
};

/** O que muda no repasse com "Pedir permissão" (tudo o que fica guardado ou sai para o checkout espera o "Aceitar"). */
export function optInForwardingNote(acceptLabel: string) {
  return `Com “Pedir permissão”, os IDs de clique (fbclid, gclid…) só vão para o checkout depois do “${acceptLabel}”, e as UTMs só ficam guardadas para quem aceitou. Entre as páginas do funil eles seguem no endereço até a pessoa escolher; quem recusa fica só com as UTMs da visita atual.`;
}

/**
 * Para quem o "Pedir permissão" mostra o aviso mesmo sem pixel ativo nem código
 * de estatística/marketing: quem chega com o que espera o "Aceitar" (waiting()
 * em src/runtime/tracking/index.ts) — IDs de clique do repasse, UTMs que ficam
 * guardadas ("Lembrar" > 0) ou, nas páginas com formulário de captura ligado a
 * um webhook, IDs de clique do endereço (com ou sem repasse).
 */
export function optInArrivalClause(forwarding: Pick<Forwarding, "enabled" | "persistDays" | "params">) {
  const { enabled, persistDays, params } = forwarding;
  const clickIds = enabled && params.some((p) => paramGroup(p) === "click");
  const utms = enabled && persistDays > 0 && params.some((p) => paramGroup(p) !== "click");
  if (clickIds) return `para quem chega de um anúncio com IDs de clique (fbclid, gclid…)${utms ? " ou UTMs" : ""}`;
  const webhook = "com IDs de clique (fbclid, gclid…) numa página com formulário de captura ligado a um webhook";
  return utms ? `para quem chega com UTMs ou ${webhook}` : `para quem chega ${webhook}`;
}

/**
 * Quando nada na oferta pede o aviso para todos (pixel ativo, código de
 * estatística/marketing da oferta ou de uma página), o "Pedir permissão" só
 * mostra o aviso para quem chega de um anúncio (src/runtime/tracking/index.ts):
 * com IDs de clique — do repasse ou, fora dele (repasse desligado ou sem IDs
 * de clique na lista), lidos pelo formulário de captura com webhook — ou com
 * UTMs que ficam guardadas.
 */
export function optInNoPixelsNote({
  acceptLabel,
  hasPixels,
  forwarding,
}: {
  acceptLabel: string;
  /** A oferta tem pixels, todos desligados. */
  hasPixels: boolean;
  forwarding: Pick<Forwarding, "enabled" | "persistDays" | "params">;
}) {
  const start = `Esta oferta ${hasPixels ? "não tem nenhum pixel ativo" : "ainda não tem pixels"} nem código de estatística ou marketing`;
  // IDs de clique fora do repasse: só o formulário de captura os lê do endereço (e manda ao webhook).
  const webhook = `nas páginas com formulário de captura ligado a um webhook, para quem chega de um anúncio com IDs de clique (fbclid, gclid…), que vão para o webhook depois do “${acceptLabel}”`;
  if (!forwarding.enabled) return `${start}, e o repasse está desligado: o aviso de cookies só aparece ${webhook}.`;
  // UTMs (e outros parâmetros da lista que não são IDs de clique) pedem o aviso só quando ficam guardadas.
  const utms =
    forwarding.persistDays > 0 && forwarding.params.some((p) => paramGroup(p) !== "click")
      ? `com UTMs (guardadas por ${plural(forwarding.persistDays, "dia", "dias")} depois do “${acceptLabel}”)`
      : null;
  if (!forwarding.params.some((p) => paramGroup(p) === "click")) {
    return `${start}, e a lista do repasse não tem IDs de clique: o aviso de cookies só aparece ${utms ? `para quem chega ${utms} e, ` : ""}${webhook}.`;
  }
  const rest = utms
    ? ` ou ${utms}`
    : forwarding.persistDays > 0
      ? ""
      : "; só UTMs não pedem o aviso, porque nada fica guardado (“Lembrar” em 0 dias)";
  return `${start}: o aviso de cookies só aparece para quem chega de um anúncio com IDs de clique (fbclid, gclid…)${rest}. O “${acceptLabel}” libera o repasse completo.`;
}

/** Repasse de UTMs e IDs de clique para os checkouts e para as páginas do funil. */
export function ForwardingSection({
  offerId,
  forwarding,
  consentMode = "OPT_IN",
  acceptLabel = "Aceitar",
  adsOnly,
}: {
  offerId: string;
  forwarding: Forwarding;
  consentMode?: ConsentModeId;
  acceptLabel?: string;
  /**
   * Nada na oferta pede o aviso para todos (ver optInNoPixelsNote); `hasPixels`:
   * ela tem pixels, todos desligados. Ausente: o aviso aparece para todos.
   */
  adsOnly?: { hasPixels: boolean } | null;
}) {
  const optIn = consentMode === "OPT_IN";
  const { draft, patch, dirty, reset, commit } = useDraft({ ...forwarding, days: String(forwarding.persistDays) });
  const [newParam, setNewParam] = useState("");
  const [errors, setErrors] = useState<{ params?: string; days?: string; form?: string }>({});
  const save = useAction(saveTrackingSettingsAction);
  const ids = useId();

  function addParam() {
    const problem = forwardParamProblem(newParam, draft.params);
    if (problem) {
      setErrors((e) => ({ ...e, params: problem }));
      return;
    }
    patch({ params: [...draft.params, newParam.trim()] });
    setNewParam("");
    setErrors((e) => ({ ...e, params: undefined }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const days = Number(draft.days);
    if (!draft.days.trim() || !Number.isInteger(days) || days < 0 || days > 90) {
      setErrors({ days: "Escolha de 0 a 90 dias." });
      return;
    }
    if (draft.enabled && draft.params.length === 0) {
      setErrors({ params: "Deixe pelo menos um parâmetro na lista (ou desligue o repasse)." });
      return;
    }
    setErrors({});
    void save.run(
      {
        offerId,
        forwarding: {
          enabled: draft.enabled,
          params: draft.params,
          toCheckout: draft.toCheckout,
          toInternalLinks: draft.toInternalLinks,
          persistDays: days,
        },
      },
      {
        success: "Repasse de UTMs salvo.",
        silentError: true,
        onError: (message, field) =>
          setErrors(
            field === "forwarding.params"
              ? { params: message }
              : field === "forwarding.persistDays"
                ? { days: message }
                : { form: message },
          ),
        onSuccess: (s) => commit({ ...s.forwarding, days: String(s.forwarding.persistDays) }),
      },
    );
  }

  return (
    <section aria-labelledby="os-forwarding-title" className="flex flex-col gap-4">
      <SectionHeading
        title={<span id="os-forwarding-title">UTMs e checkout</span>}
        description={
          <>
            <p>
              Quem chega pelo anúncio traz UTMs e IDs de clique no endereço. O Offer Studio leva esses dados até o
              checkout, para a venda aparecer no anúncio certo.
            </p>
            {optIn && (
              <p className="mt-2" data-testid="forwarding-consent-note">
                {optInForwardingNote(acceptLabel)}
              </p>
            )}
          </>
        }
      />
      {optIn && adsOnly && (
        // Quem vê o aviso de cookies sem pixels: em destaque, fora do texto da seção.
        <Callout icon={ShieldCheckIcon} title="Quem vê o aviso de cookies">
          <span data-testid="forwarding-no-pixels-note">
            {optInNoPixelsNote({ acceptLabel, hasPixels: adsOnly.hasPixels, forwarding })}
          </span>
        </Callout>
      )}
      <Panel>
        <form noValidate onSubmit={submit} className="flex flex-col gap-6">
          <SwitchRow
            label="Repassar UTMs e IDs de clique"
            description="Completa os links com os parâmetros da visita. Nunca troca um parâmetro que o link já tem."
            checked={draft.enabled}
            onCheckedChange={(enabled) => patch({ enabled })}
          />

          {draft.enabled && (
            <>
              <div className="flex flex-col gap-4 rounded-lg border p-4">
                <SwitchRow
                  label="Nos links de checkout"
                  description="Checkout, upsell e downsell cadastrados em “Links e checkouts” e os checkouts reconhecidos (Hotmart, Kiwify, Eduzz…)."
                  checked={draft.toCheckout}
                  onCheckedChange={(toCheckout) => patch({ toCheckout })}
                />
                <SwitchRow
                  label="Nos links entre as páginas do funil"
                  description="Assim as UTMs continuam na página de obrigado, no upsell etc."
                  checked={draft.toInternalLinks}
                  onCheckedChange={(toInternalLinks) => patch({ toInternalLinks })}
                />
              </div>

              <Field data-invalid={Boolean(errors.days)} className="max-w-md">
                <FieldLabel htmlFor={`${ids}-days`}>Lembrar por quantos dias</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id={`${ids}-days`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={90}
                    step={1}
                    value={draft.days}
                    aria-invalid={Boolean(errors.days)}
                    className="w-24"
                    onChange={(e) => {
                      patch({ days: e.target.value });
                      setErrors((x) => ({ ...x, days: undefined }));
                    }}
                  />
                  <span className="text-sm text-muted-foreground">dias</span>
                </div>
                <FieldDescription>
                  Se a pessoa voltar direto (sem UTMs) dentro desse prazo, o checkout ainda recebe as UTMs do anúncio
                  {optIn ? ` — com “Pedir permissão”, só para quem clicou em “${acceptLabel}”` : ""}. Use 0 para
                  repassar só na visita atual.
                </FieldDescription>
                <FieldError>{errors.days}</FieldError>
              </Field>

              <Field data-invalid={Boolean(errors.params)}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <FieldLabel id={`${ids}-params-label`}>
                    Parâmetros repassados ({draft.params.length}/{MAX_FORWARD_PARAMS})
                  </FieldLabel>
                  {!isDefaultParams(draft.params) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        patch({ params: [...DEFAULT_FORWARD_PARAMS] });
                        setErrors((x) => ({ ...x, params: undefined }));
                      }}
                    >
                      <RotateCcwIcon />
                      Restaurar padrão
                    </Button>
                  )}
                </div>
                <ul aria-labelledby={`${ids}-params-label`} className="flex flex-wrap gap-1.5">
                  {draft.params.map((param) => (
                    <li
                      key={param}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2 font-mono text-xs",
                        GROUP_STYLE[paramGroup(param)],
                      )}
                    >
                      {param}
                      <button
                        type="button"
                        aria-label={`Remover ${param}`}
                        className="grid size-5 place-items-center rounded text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                        onClick={() => {
                          patch({ params: draft.params.filter((p) => p !== param) });
                          setErrors((x) => ({ ...x, params: undefined }));
                        }}
                      >
                        <XIcon className="size-3" />
                      </button>
                    </li>
                  ))}
                  {draft.params.length === 0 && (
                    <li className="text-sm text-muted-foreground">Nenhum parâmetro na lista.</li>
                  )}
                </ul>
                <div className="flex max-w-md gap-2">
                  <Input
                    value={newParam}
                    maxLength={40}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="Ex.: utm_id ou afiliado"
                    aria-label="Novo parâmetro"
                    aria-invalid={Boolean(errors.params)}
                    className="font-mono"
                    onChange={(e) => {
                      setNewParam(e.target.value);
                      setErrors((x) => ({ ...x, params: undefined }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addParam();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={addParam}>
                    <PlusIcon />
                    Adicionar
                  </Button>
                </div>
                <FieldError>{errors.params}</FieldError>
              </Field>

              <Callout title="src, sck e xcod (Hotmart, Kiwify e UTMify)">
                A Hotmart e a Kiwify leem <strong>src</strong> e <strong>sck</strong> (e a Hotmart também o{" "}
                <strong>xcod</strong>) para mostrar de onde veio cada venda. A UTMify usa esses mesmos campos para ligar
                a venda ao anúncio. Deixe-os na lista para as vendas não aparecerem “sem origem”.
              </Callout>
            </>
          )}

          {errors.form && <FieldError>{errors.form}</FieldError>}
          <SaveBar
            dirty={dirty}
            pending={save.pending}
            onReset={() => {
              reset();
              setNewParam("");
              setErrors({});
            }}
            saveLabel="Salvar repasse"
          />
        </form>
      </Panel>
    </section>
  );
}
