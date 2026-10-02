"use client";

import { FileCodeIcon, ShieldAlertIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import {
  detectCodeTrackers,
  joinTrackerNames,
  necessaryTrackerWarning,
  unknownScriptHint,
} from "@/lib/tracking/code-trackers";
import {
  CODE_CATEGORIES,
  CODE_CATEGORY_LABEL,
  type CodeCategoryId,
  type ConsentModeId,
  type TrackingSettings,
} from "@/lib/tracking/schema";
import { savePageCodeCategoryAction, saveTrackingSettingsAction } from "@/server/actions/tracking";
import type { TrackingPanelPage } from "@/server/services/tracking";
import { Callout } from "./callout";
import { Panel, SaveBar, SectionHeading, useDraft } from "./form-kit";
import { CATEGORY_HELP } from "./helpers";

type Code = TrackingSettings["customCode"];
type CodeField = "head" | "bodyStart" | "bodyEnd" | "category" | "form";

const PARTS: { key: "head" | "bodyStart" | "bodyEnd"; label: string; help: string; placeholder: string }[] = [
  {
    key: "head",
    label: "No <head>",
    help: "Scripts de verificação, tags de outras ferramentas, estilos.",
    placeholder: "<script>…</script>",
  },
  {
    key: "bodyStart",
    label: "No início do <body>",
    help: "Códigos que pedem para ficar logo depois de abrir o <body> (ex.: noscript do Google Tag Manager).",
    placeholder: "<noscript>…</noscript>",
  },
  {
    key: "bodyEnd",
    label: "No fim do <body>",
    help: "Chats, widgets e scripts que podem carregar por último.",
    placeholder: '<script src="https://…"></script>',
  },
];

/** O código "Essencial" tem rastreador e o aviso pede permissão: ele passaria na frente do "Aceitar". */
export function trackerRisk(category: CodeCategoryId, trackers: readonly string[], consentMode: ConsentModeId) {
  return consentMode === "OPT_IN" && category === "NECESSARY" && trackers.length > 0;
}

function PageCategoryRow({
  page,
  consentMode,
  acceptLabel,
}: {
  page: TrackingPanelPage;
  consentMode: ConsentModeId;
  acceptLabel: string;
}) {
  const save = useAction(savePageCodeCategoryAction);
  const [value, setValue] = useState<CodeCategoryId>(page.codeCategory);
  const [auto, setAuto] = useState(page.codeCategoryAuto);
  const id = useId();
  const helpId = `${id}-help`;
  const risk = trackerRisk(value, page.codeTrackers, consentMode);

  function choose(next: CodeCategoryId) {
    const before = { value, auto };
    setValue(next);
    setAuto(false);
    void save.run(
      { pageId: page.id, category: next },
      {
        success: `O código da página “${page.name}” ${next === "NECESSARY" ? "carrega sempre" : "espera o “Aceitar” do aviso de cookies"}.`,
        onError: () => {
          setValue(before.value);
          setAuto(before.auto);
        },
      },
    );
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3" data-risk={risk || undefined}>
      <div className="flex flex-wrap items-center gap-3">
        <FileCodeIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <label htmlFor={id} className="min-w-0 flex-1 truncate font-medium text-sm">
          {page.name}
        </label>
        <Select value={value} disabled={save.pending} onValueChange={(v) => choose(v as CodeCategoryId)}>
          <SelectTrigger
            id={id}
            size="sm"
            className="w-72 max-w-full"
            aria-label={`Quando carrega o código da página ${page.name}`}
            aria-describedby={helpId}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CODE_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {CODE_CATEGORY_LABEL[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p id={helpId} className="text-xs text-muted-foreground sm:pl-7">
        {auto && page.codeTrackers.length > 0
          ? `Automático: o código tem ${joinTrackerNames(page.codeTrackers)}, então espera o “${acceptLabel}” do aviso de cookies.`
          : CATEGORY_HELP[value]}
      </p>
      {consentMode === "OPT_IN" && auto && value === "NECESSARY" && page.codeUnknownScripts.length > 0 && (
        <p className="text-xs text-warning-foreground sm:pl-7 dark:text-warning" data-testid="unknown-script-hint">
          {unknownScriptHint(page.codeUnknownScripts, acceptLabel)}
        </p>
      )}
      {risk && (
        <Callout
          variant="warning"
          icon={ShieldAlertIcon}
          className="sm:ml-7"
          title={necessaryTrackerWarning(page.codeTrackers, acceptLabel)}
          action={
            <Button size="sm" variant="outline" disabled={save.pending} onClick={() => choose("MARKETING")}>
              {save.pending && <Spinner />}
              Esperar o “{acceptLabel}”
            </Button>
          }
        />
      )}
    </li>
  );
}

/** Código livre da oferta (todas as páginas) e quando o código de cada página carrega. */
export function CodeSection({
  offerId,
  code,
  pages,
  consentMode = "OPT_IN",
  acceptLabel = "Aceitar",
}: {
  offerId: string;
  code: Code;
  pages: TrackingPanelPage[];
  consentMode?: ConsentModeId;
  acceptLabel?: string;
}) {
  const { draft, patch, dirty, reset, commit } = useDraft(code);
  const [errors, setErrors] = useState<Partial<Record<CodeField, string>>>({});
  const save = useAction(saveTrackingSettingsAction);
  const ids = useId();
  const withCode = pages.filter((p) => p.hasCode);
  const withHtmlTrackers = pages.filter((p) => p.htmlTrackers.length > 0);
  // Confere o que está sendo digitado (o aviso aparece antes de salvar).
  const trackers = useMemo(
    () => detectCodeTrackers(draft.head, draft.bodyStart, draft.bodyEnd),
    [draft.head, draft.bodyStart, draft.bodyEnd],
  );
  const risk = trackerRisk(draft.category, trackers, consentMode);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    void save.run(
      { offerId, customCode: draft },
      {
        success: "Código livre salvo.",
        silentError: true,
        onError: (message, field) => {
          const key = field?.replace(/^customCode\./, "");
          setErrors(
            key && ["head", "bodyStart", "bodyEnd", "category"].includes(key) ? { [key]: message } : { form: message },
          );
        },
        onSuccess: (s) => commit(s.customCode),
      },
    );
  }

  return (
    <section aria-labelledby="os-code-title" className="flex flex-col gap-4">
      <SectionHeading
        title={<span id="os-code-title">Código livre</span>}
        description="Para ferramentas que não estão na lista de pixels. O código daqui vai em todas as páginas desta oferta."
      />
      <Panel>
        <form noValidate onSubmit={submit} className="flex flex-col gap-6">
          <Field data-invalid={Boolean(errors.category)} className="max-w-xl">
            <FieldLabel htmlFor={`${ids}-category`}>Quando o código carrega</FieldLabel>
            <Select value={draft.category} onValueChange={(v) => patch({ category: v as CodeCategoryId })}>
              <SelectTrigger id={`${ids}-category`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CODE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CODE_CATEGORY_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{CATEGORY_HELP[draft.category]}</FieldDescription>
            <FieldError>{errors.category}</FieldError>
          </Field>
          {risk && (
            <Callout
              variant="warning"
              icon={ShieldAlertIcon}
              title={necessaryTrackerWarning(trackers, acceptLabel)}
              action={
                <Button type="button" size="sm" variant="outline" onClick={() => patch({ category: "MARKETING" })}>
                  Esperar o “{acceptLabel}”
                </Button>
              }
            >
              Escolha “Marketing” e salve: o código só carrega depois que o visitante aceitar os cookies.
            </Callout>
          )}

          {PARTS.map((part) => (
            <Field key={part.key} data-invalid={Boolean(errors[part.key])}>
              <FieldLabel htmlFor={`${ids}-${part.key}`}>{part.label}</FieldLabel>
              <Textarea
                id={`${ids}-${part.key}`}
                rows={4}
                spellCheck={false}
                autoComplete="off"
                placeholder={part.placeholder}
                value={draft[part.key]}
                aria-invalid={Boolean(errors[part.key])}
                className="max-h-96 min-h-24 font-mono text-xs"
                onChange={(e) => {
                  patch({ [part.key]: e.target.value });
                  setErrors((x) => ({ ...x, [part.key]: undefined, form: undefined }));
                }}
              />
              <FieldDescription>{part.help}</FieldDescription>
              <FieldError>{errors[part.key]}</FieldError>
            </Field>
          ))}

          {errors.form && <FieldError>{errors.form}</FieldError>}
          <SaveBar
            dirty={dirty}
            pending={save.pending}
            onReset={() => {
              reset();
              setErrors({});
            }}
            saveLabel="Salvar código"
          />
        </form>
      </Panel>

      <Panel>
        <SectionHeading
          as="h3"
          title="Código de cada página"
          description="Para colar código numa página só, abra a página no editor → “Códigos da página”. Aqui você escolhe quando esse código carrega."
        />
        {consentMode === "OPT_IN" && withHtmlTrackers.length > 0 && (
          <Callout
            variant="warning"
            icon={ShieldAlertIcon}
            title={`Pixel no HTML ${withHtmlTrackers.length > 1 ? "de páginas" : "da página"}: carrega antes do “${acceptLabel}”`}
          >
            <ul className="flex flex-col gap-1" data-testid="html-trackers">
              {withHtmlTrackers.map((p) => (
                <li key={p.id}>
                  <strong>{p.name}</strong>: {joinTrackerNames(p.htmlTrackers)}
                </li>
              ))}
            </ul>
            <p className="mt-1">
              Mantido na clonagem ou colado no HTML de um elemento, ele fica fora do aviso de cookies. Abra a página no
              editor, tire o código do HTML e cole em “Códigos da página”, que espera o “{acceptLabel}”.
            </p>
          </Callout>
        )}
        {withCode.length === 0 ? (
          <Callout>Nenhuma página desta oferta tem código próprio.</Callout>
        ) : (
          <ul className="flex flex-col divide-y overflow-hidden rounded-lg border" aria-label="Código das páginas">
            {withCode.map((page) => (
              <PageCategoryRow
                key={`${page.id}:${page.codeCategory}:${page.codeCategoryAuto}`}
                page={page}
                consentMode={consentMode}
                acceptLabel={acceptLabel}
              />
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}
