"use client";

/**
 * Peças comuns dos formulários de rastreamento e configurações: rascunho com
 * "alterações não salvas", barra de salvar/descartar, linha com interruptor e
 * contador de caracteres.
 */
import { CheckIcon, RotateCcwIcon } from "lucide-react";
import { type ReactNode, useCallback, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { cn } from "@/lib/utils";

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Rascunho de um formulário: `dirty` compara com a última versão salva.
 * `commit(salvo)` marca o que o servidor devolveu como a nova versão salva.
 */
export function useDraft<T>(initial: T) {
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  // A versão salva mudou fora daqui (ex.: dados da empresa salvos pelo "Baixar ZIP",
  // com a aba montada): sem nada digitado, o formulário passa a mostrar a nova.
  const initialKey = JSON.stringify(initial);
  const [seenKey, setSeenKey] = useState(initialKey);
  if (initialKey !== seenKey) {
    setSeenKey(initialKey);
    setBaseline(initial);
    if (same(draft, baseline)) setDraft(initial);
  }
  const dirty = useMemo(() => !same(draft, baseline), [draft, baseline]);
  const patch = useCallback((changes: Partial<T>) => setDraft((d) => ({ ...d, ...changes })), []);
  const reset = useCallback(() => setDraft(baseline), [baseline]);
  const commit = useCallback((saved: T) => {
    setBaseline(saved);
    setDraft(saved);
  }, []);
  return { draft, setDraft, patch, dirty, reset, commit, baseline };
}

/** Rodapé do formulário: situação + Descartar + Salvar (fica grudado no fim da tela com alterações). */
export function SaveBar({
  dirty,
  pending,
  onReset,
  saveLabel = "Salvar",
  className,
}: {
  dirty: boolean;
  pending: boolean;
  onReset: () => void;
  saveLabel?: string;
  className?: string;
}) {
  // A aba ganha o ponto de "não salvo" e sair da tela pergunta antes.
  useUnsavedChanges(dirty);
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 border-t pt-4",
        dirty &&
          "sticky bottom-0 z-10 -mx-4 bg-card px-4 pb-4 shadow-[0_-10px_16px_-14px_rgb(0_0_0/0.35)] sm:-mx-6 sm:px-6",
        className,
      )}
    >
      <p className="mr-auto text-sm text-muted-foreground" aria-live="polite">
        {dirty ? (
          <span className="font-medium text-foreground">Alterações não salvas</span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon className="size-3.5 text-success" />
            Tudo salvo
          </span>
        )}
      </p>
      {dirty && (
        <Button type="button" variant="ghost" onClick={onReset} disabled={pending}>
          <RotateCcwIcon />
          Descartar
        </Button>
      )}
      <Button type="submit" disabled={!dirty || pending}>
        {pending && <Spinner />}
        {saveLabel}
      </Button>
    </div>
  );
}

/** Título de uma parte da tela, com descrição e ações à direita. */
export function SectionHeading({
  title,
  description,
  actions,
  as: Tag = "h2",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-72">
        <Tag className={cn("font-semibold tracking-tight", Tag === "h2" ? "text-lg" : "text-base")}>{title}</Tag>
        {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Interruptor com rótulo e explicação (o rótulo é o nome acessível do interruptor). */
export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <Field orientation="horizontal" className={cn("items-start", className)} data-disabled={disabled}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="mt-0.5" />
    </Field>
  );
}

/** "42/160" ao lado dos campos de texto com limite (amarelo acima do recomendado). */
export function CharCount({ value, max, recommended }: { value: string; max: number; recommended?: number }) {
  const n = value.length;
  const over = recommended !== undefined && n > recommended;
  return (
    <span
      className={cn("text-xs tabular-nums text-muted-foreground", over && "text-warning-foreground dark:text-warning")}
    >
      {n}/{recommended ?? max}
      {over && " — pode aparecer cortado"}
    </span>
  );
}

/** Cartão de uma parte do formulário (borda + espaço interno). */
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-col gap-5 rounded-xl border bg-card p-4 sm:p-6", className)}>{children}</div>;
}
