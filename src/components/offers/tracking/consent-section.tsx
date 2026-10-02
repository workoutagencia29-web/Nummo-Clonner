"use client";

import { ShieldCheckIcon } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAction } from "@/hooks/use-action";
import {
  autoPolicyPage,
  CONSENT_MODE_LABEL,
  CONSENT_MODES,
  CONSENT_POSITION_LABEL,
  CONSENT_POSITIONS,
  CONSENT_THEME_LABEL,
  CONSENT_THEMES,
  type ConsentModeId,
  consentTextFor,
  POLICY_NONE,
  type TrackingSettings,
} from "@/lib/tracking/schema";
import { cn } from "@/lib/utils";
import { saveTrackingSettingsAction } from "@/server/actions/tracking";
import { Callout } from "./callout";
import { ConsentPreview } from "./consent-preview";
import { CharCount, Panel, SaveBar, SectionHeading, useDraft } from "./form-kit";
import { optInArrivalClause } from "./forwarding-section";
import { type PanelPage, policyPageOptions } from "./helpers";

type Consent = TrackingSettings["consent"];
type ConsentField = "text" | "acceptLabel" | "rejectLabel" | "noticeLabel" | "policyLabel" | "policyPageId" | "form";

/** Valor do campo "Página da política" para a escolha automática (policyPageId null). */
const AUTO_POLICY = "__auto__";

const MODE_HELP: Record<ConsentModeId, string> = {
  OPT_IN:
    "Os pixels e o código de marketing só carregam depois do “Aceitar”. O Google recebe o sinal pelo Consent Mode v2.",
  NOTICE:
    "Mostra um aviso com o botão “Entendi”, mas os pixels carregam direto, sem esperar. Quem recusou quando a oferta pedia permissão continua sem pixels; o código livre carrega direto para todos.",
  OFF: "Nenhum aviso. Os pixels carregam direto, para todos (até para quem recusou quando a oferta pedia permissão).",
};

/** Consentimento LGPD: modo, textos, aparência e página da política, com prévia ao vivo. */
export function ConsentSection({
  offerId,
  consent,
  pages,
  pixelCount,
  forwarding,
}: {
  offerId: string;
  consent: Consent;
  pages: PanelPage[];
  /** Pixels ativos (os desligados não carregam). */
  pixelCount: number;
  /** Repasse salvo: decide quem chega de um anúncio e vê o aviso sem pixels (optInArrivalClause). */
  forwarding: TrackingSettings["forwarding"];
}) {
  const { draft, patch, dirty, reset, commit } = useDraft(consent);
  const [errors, setErrors] = useState<Partial<Record<ConsentField, string>>>({});
  const save = useAction(saveTrackingSettingsAction);
  const ids = useId();
  const options = policyPageOptions(pages);
  const legal = options.filter((p) => p.type === "LEGAL");
  const others = options.filter((p) => p.type !== "LEGAL");
  const auto = autoPolicyPage(pages);
  const policyNone = draft.policyPageId === POLICY_NONE;
  // Página escolhida que foi excluída: volta ao automático.
  const policyMissing = !!draft.policyPageId && !policyNone && !pages.some((p) => p.id === draft.policyPageId);
  const policyValue = policyNone
    ? POLICY_NONE
    : draft.policyPageId && !policyMissing
      ? draft.policyPageId
      : AUTO_POLICY;
  const hasPolicy = policyValue === AUTO_POLICY ? auto !== null : policyValue !== POLICY_NONE;
  const withoutLink = pages.filter((p) => p.hasConsentLink === false);

  function change(changes: Partial<Consent>, field?: ConsentField) {
    patch(changes);
    if (field) setErrors((e) => ({ ...e, [field]: undefined, form: undefined }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const found: Partial<Record<ConsentField, string>> = {};
    if (draft.mode !== "OFF" && !draft.text.trim()) found.text = "Escreva o texto do aviso de cookies.";
    if (draft.mode === "OPT_IN" && !draft.acceptLabel.trim()) found.acceptLabel = "Escreva o texto do botão “Aceitar”.";
    if (draft.mode === "OPT_IN" && !draft.rejectLabel.trim()) found.rejectLabel = "Escreva o texto do botão “Recusar”.";
    if (draft.mode === "NOTICE" && !draft.noticeLabel.trim()) found.noticeLabel = "Escreva o texto do botão “Entendi”.";
    if (draft.mode !== "OFF" && hasPolicy && !draft.policyLabel.trim()) {
      found.policyLabel = "Escreva o texto do link da política de privacidade.";
    }
    setErrors(found);
    if (Object.keys(found).length) return;
    void save.run(
      {
        offerId,
        consent: {
          ...draft,
          // Campos escondidos no modo atual voltam ao que estava salvo (o servidor exige texto nos botões).
          acceptLabel: draft.acceptLabel.trim() || consent.acceptLabel,
          rejectLabel: draft.rejectLabel.trim() || consent.rejectLabel,
          noticeLabel: draft.noticeLabel.trim() || consent.noticeLabel,
          policyLabel: draft.policyLabel.trim() || consent.policyLabel,
          text: draft.text.trim() || consent.text,
          policyPageId: policyMissing ? null : draft.policyPageId,
        },
      },
      {
        success: "Aviso de cookies salvo.",
        silentError: true,
        onError: (message, field) => {
          const key = field?.replace(/^consent\./, "") as ConsentField | undefined;
          setErrors(
            key && ["text", "acceptLabel", "rejectLabel", "noticeLabel", "policyLabel", "policyPageId"].includes(key)
              ? { [key]: message }
              : { form: message },
          );
        },
        onSuccess: (s) => commit(s.consent),
      },
    );
  }

  return (
    <section aria-labelledby="os-consent-title" className="flex flex-col gap-4">
      <SectionHeading
        title={<span id="os-consent-title">Privacidade (LGPD)</span>}
        description={`O aviso de cookies aparece nas páginas desta oferta quando ela tem pixels ativos ou código de estatística ou marketing. No “Pedir permissão”, mesmo sem nada disso, ele também aparece ${optInArrivalClause(forwarding)}.`}
      />
      <Panel>
        <form noValidate onSubmit={submit} className="flex flex-col gap-6">
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 font-medium text-sm">Como os pixels carregam</legend>
            <div role="radiogroup" aria-label="Como os pixels carregam" className="grid gap-2">
              {CONSENT_MODES.map((mode) => {
                const checked = draft.mode === mode;
                return (
                  <label
                    key={mode}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                      checked && "border-primary bg-primary/5",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${ids}-mode`}
                      value={mode}
                      checked={checked}
                      onChange={() => change({ mode, text: consentTextFor(mode, draft.text) })}
                      className="mt-0.5 size-4 accent-[var(--primary)]"
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 font-medium text-sm">
                        {CONSENT_MODE_LABEL[mode]}
                        {mode === "OPT_IN" && <Badge variant="success">Recomendado</Badge>}
                      </span>
                      <span className="text-sm text-muted-foreground">{MODE_HELP[mode]}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {draft.mode !== "OPT_IN" && (
            <Callout variant="warning" icon={ShieldCheckIcon} title="Recomendamos “Pedir permissão”">
              A LGPD pede consentimento antes de usar cookies de marketing. Com “Pedir permissão”, os pixels e o código
              de marketing só carregam depois do “Aceitar”, e os IDs de clique dos anúncios (fbclid, gclid…) só vão para
              o checkout depois dele — quem recusa não é rastreado. As UTMs da campanha continuam indo para o checkout.
              {draft.mode === "OFF" && pixelCount > 0 && " Hoje esta oferta tem pixels que vão carregar sem perguntar."}
            </Callout>
          )}

          {draft.mode !== "OFF" && (
            // Largura do próprio painel (não da janela): com o menu do app e o das partes, a
            // prévia só fica ao lado quando sobra espaço de verdade.
            <div className="@container">
              <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
                <div className="flex flex-col gap-5">
                  <Field data-invalid={Boolean(errors.text)}>
                    <div className="flex items-center justify-between gap-2">
                      <FieldLabel htmlFor={`${ids}-text`}>Texto do aviso</FieldLabel>
                      <CharCount value={draft.text} max={600} />
                    </div>
                    <Textarea
                      id={`${ids}-text`}
                      rows={3}
                      maxLength={600}
                      value={draft.text}
                      aria-invalid={Boolean(errors.text)}
                      onChange={(e) => change({ text: e.target.value }, "text")}
                    />
                    <FieldError>{errors.text}</FieldError>
                  </Field>

                  {draft.mode === "OPT_IN" ? (
                    <div className="grid gap-4 @md:grid-cols-2">
                      <Field data-invalid={Boolean(errors.acceptLabel)}>
                        <FieldLabel htmlFor={`${ids}-accept`}>Botão de aceitar</FieldLabel>
                        <Input
                          id={`${ids}-accept`}
                          maxLength={40}
                          value={draft.acceptLabel}
                          aria-invalid={Boolean(errors.acceptLabel)}
                          onChange={(e) => change({ acceptLabel: e.target.value }, "acceptLabel")}
                        />
                        <FieldError>{errors.acceptLabel}</FieldError>
                      </Field>
                      <Field data-invalid={Boolean(errors.rejectLabel)}>
                        <FieldLabel htmlFor={`${ids}-reject`}>Botão de recusar</FieldLabel>
                        <Input
                          id={`${ids}-reject`}
                          maxLength={40}
                          value={draft.rejectLabel}
                          aria-invalid={Boolean(errors.rejectLabel)}
                          onChange={(e) => change({ rejectLabel: e.target.value }, "rejectLabel")}
                        />
                        <FieldError>{errors.rejectLabel}</FieldError>
                      </Field>
                    </div>
                  ) : (
                    <Field data-invalid={Boolean(errors.noticeLabel)} className="@md:max-w-[calc(50%-0.5rem)]">
                      <FieldLabel htmlFor={`${ids}-notice`}>Botão do aviso</FieldLabel>
                      <Input
                        id={`${ids}-notice`}
                        maxLength={40}
                        value={draft.noticeLabel}
                        aria-invalid={Boolean(errors.noticeLabel)}
                        onChange={(e) => change({ noticeLabel: e.target.value }, "noticeLabel")}
                      />
                      <FieldDescription>
                        No modo “Só avisar”, o aviso tem um botão só, que fecha o aviso.
                      </FieldDescription>
                      <FieldError>{errors.noticeLabel}</FieldError>
                    </Field>
                  )}

                  <div className="grid gap-4 @md:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor={`${ids}-position`}>Posição</FieldLabel>
                      <Select
                        value={draft.position}
                        onValueChange={(v) => change({ position: v as Consent["position"] })}
                      >
                        <SelectTrigger id={`${ids}-position`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CONSENT_POSITIONS.map((p) => (
                            <SelectItem key={p} value={p}>
                              {CONSENT_POSITION_LABEL[p]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel id={`${ids}-theme-label`}>Cores</FieldLabel>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        value={draft.theme}
                        aria-labelledby={`${ids}-theme-label`}
                        onValueChange={(v) => v && change({ theme: v as Consent["theme"] })}
                      >
                        {CONSENT_THEMES.map((t) => (
                          <ToggleGroupItem key={t} value={t} className="px-4">
                            {CONSENT_THEME_LABEL[t]}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </Field>
                  </div>

                  <Field data-invalid={Boolean(errors.policyPageId)}>
                    <FieldLabel htmlFor={`${ids}-policy`}>Página da política de privacidade</FieldLabel>
                    <Select
                      value={policyValue}
                      onValueChange={(v) => change({ policyPageId: v === AUTO_POLICY ? null : v }, "policyPageId")}
                    >
                      <SelectTrigger
                        id={`${ids}-policy`}
                        className="w-full"
                        aria-invalid={Boolean(errors.policyPageId)}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={AUTO_POLICY}>
                          {auto ? `Automático: ${auto.name}` : "Automático (quando houver uma política)"}
                        </SelectItem>
                        <SelectItem value={POLICY_NONE}>Nenhuma (aviso sem link)</SelectItem>
                        {legal.length > 0 && (
                          <SelectGroup>
                            <SelectLabel>Política / Termos</SelectLabel>
                            {legal.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                        {others.length > 0 && (
                          <SelectGroup>
                            <SelectLabel>Outras páginas</SelectLabel>
                            {others.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                      </SelectContent>
                    </Select>
                    {policyNone && legal.length > 0 ? (
                      <p className="text-sm text-warning-foreground dark:text-warning" data-slot="field-description">
                        Esta oferta tem página de política, mas o aviso vai sem link. A LGPD pede que o visitante saiba
                        como os dados dele são usados: escolha a página.
                      </p>
                    ) : !hasPolicy ? (
                      <FieldDescription>
                        Esta oferta ainda não tem política de privacidade. Em “Páginas do funil”, adicione uma página
                        com o modelo “Política de privacidade”: o aviso ganha o link sozinho.
                      </FieldDescription>
                    ) : (
                      <FieldDescription>O aviso ganha um link para essa página.</FieldDescription>
                    )}
                    <FieldError>{errors.policyPageId}</FieldError>
                  </Field>

                  {hasPolicy && (
                    <Field data-invalid={Boolean(errors.policyLabel)}>
                      <div className="flex items-center justify-between gap-2">
                        <FieldLabel htmlFor={`${ids}-policy-label`}>Texto do link</FieldLabel>
                        <CharCount value={draft.policyLabel} max={60} />
                      </div>
                      <Input
                        id={`${ids}-policy-label`}
                        maxLength={60}
                        value={draft.policyLabel}
                        aria-invalid={Boolean(errors.policyLabel)}
                        onChange={(e) => change({ policyLabel: e.target.value }, "policyLabel")}
                      />
                      <FieldError>{errors.policyLabel}</FieldError>
                    </Field>
                  )}

                  <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                    {draft.mode === "OPT_IN" ? (
                      <p>
                        Para o visitante mudar de ideia depois, o rodapé tem o link “Preferências de cookies”: ele já
                        vem no bloco “Rodapé com políticas” e nos modelos, e existe como bloco próprio no editor (grupo
                        “Rodapé e políticas”). Páginas sem esse link ganham um botão flutuante “Cookies” no canto da
                        tela.
                      </p>
                    ) : (
                      <p>
                        O link “Preferências de cookies” do rodapé (bloco “Rodapé com políticas” e modelos) mostra o
                        aviso de novo. No “Só avisar” não há o que escolher, então as páginas não ganham o botão
                        flutuante “Cookies” (ele só aparece para quem recusou quando a oferta pedia permissão, para
                        poder aceitar depois).
                      </p>
                    )}
                    {draft.mode === "OPT_IN" && withoutLink.length > 0 && (
                      <p data-testid="pages-without-consent-link">
                        Com o botão “Cookies”: {withoutLink.map((p) => p.name).join(", ")}.
                      </p>
                    )}
                  </div>
                </div>

                <ConsentPreview consent={draft} hasPolicy={hasPolicy} />
              </div>
            </div>
          )}

          {errors.form && <FieldError>{errors.form}</FieldError>}
          <SaveBar
            dirty={dirty}
            pending={save.pending}
            onReset={() => {
              reset();
              setErrors({});
            }}
            saveLabel="Salvar aviso"
          />
        </form>
      </Panel>
    </section>
  );
}
