"use client";

import { ArrowDownIcon, CheckIcon, CopyIcon, GiftIcon, PlusIcon, ShoppingBagIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { SaveBar, useDraft } from "@/components/offers/tracking/form-kit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { PAGE_TYPE_LABEL } from "@/lib/labels";
import { formatAmount } from "@/lib/payments/rules";
import {
  attachedDownsell,
  DOWNSELL_MAX,
  downsellCount,
  mainPath,
  UPSELL_MAX,
  type UpsellFlow,
  type UpsellStep,
  upsellCount,
  upsellProblems,
} from "@/lib/upsell";
import { cn } from "@/lib/utils";
import { createUpsellPageAction, saveUpsellAction } from "@/server/actions/upsell";
import type { UpsellPageOption, UpsellPanel as UpsellPanelData } from "@/server/services/upsell";
import { UpsellApplyDialog } from "./upsell-apply-dialog";

/** "— nenhum —" num Select (o Radix não aceita value vazio). */
const NONE = "__none__";
const freshId = () => `s${Math.random().toString(36).slice(2, 9)}`;

type Option = { value: string; label: string };

export function UpsellPanel({ offerId, initial }: { offerId: string; initial: UpsellPanelData }) {
  const { draft, setDraft, dirty, reset, commit } = useDraft<{ flow: UpsellFlow }>({ flow: initial.flow });
  const { run, pending } = useAction(saveUpsellAction);
  const { run: runCreate, pending: creating } = useAction(createUpsellPageAction);
  const flow = draft.flow;
  const { products } = initial;
  // Sempre funcional (lê o rascunho mais recente): criar uma página revalida a
  // tela, então uma atualização presa a um `flow` antigo se perderia.
  const updateFlow = (fn: (f: UpsellFlow) => UpsellFlow) => setDraft((d) => ({ ...d, flow: fn(d.flow) }));

  const [applyOpen, setApplyOpen] = useState(false);
  // Páginas criadas aqui aparecem na hora, juntas com as da oferta e sem repetir.
  const [created, setCreated] = useState<UpsellPageOption[]>([]);
  const pages = useMemo(() => {
    const seen = new Set<string>();
    const out: UpsellPageOption[] = [];
    for (const p of [...initial.pages, ...created]) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
      }
    }
    return out;
  }, [initial.pages, created]);

  const pageById = new Map(pages.map((p) => [p.id, p]));
  const productOptions: Option[] = products.map((p) => ({
    value: p.key,
    label: `${p.productName} — ${formatAmount(p.amountCents, p.currency as never)}`,
  }));
  const pageOptions: Option[] = pages.map((p) => ({
    value: p.id,
    label: `${p.name} · ${PAGE_TYPE_LABEL[p.type as keyof typeof PAGE_TYPE_LABEL] ?? p.type}`,
  }));

  const problems = upsellProblems(flow);
  const problemsOf = (id: string | "flow") => problems.filter((p) => p.stepId === id).map((p) => p.message);

  const main = mainPath(flow);
  const upsellSteps = main.filter((s) => s.kind === "UPSELL");

  // ── Compras que iniciam: produtos que NÃO são uma oferta da sequência.
  const stepKeys = new Set(flow.steps.map((s) => s.linkKey).filter(Boolean) as string[]);
  const startCandidates = products.filter((p) => !stepKeys.has(p.key));
  const startSet = new Set(flow.startLinkKeys);
  const toggleStart = (key: string) =>
    updateFlow((f) => ({
      ...f,
      startLinkKeys: f.startLinkKeys.includes(key)
        ? f.startLinkKeys.filter((k) => k !== key)
        : [...f.startLinkKeys, key],
    }));

  // ── Etapas.
  const addUpsell = () => {
    if (upsellCount(flow) >= UPSELL_MAX) return;
    updateFlow((f) => ({
      ...f,
      steps: [...f.steps, { id: freshId(), kind: "UPSELL", pageId: null, linkKey: null, attachedTo: null }],
    }));
  };
  const updateStep = (id: string, changes: Partial<UpsellStep>) =>
    updateFlow((f) => ({ ...f, steps: f.steps.map((s) => (s.id === id ? { ...s, ...changes } : s)) }));
  // Tirar uma oferta tira também o downsell atrelado a ela.
  const removeStep = (id: string) =>
    updateFlow((f) => ({ ...f, steps: f.steps.filter((s) => s.id !== id && s.attachedTo !== id) }));
  const toggleDownsell = (upsellId: string, on: boolean) =>
    updateFlow((f) => {
      const existing = f.steps.find((s) => s.kind === "DOWNSELL" && s.attachedTo === upsellId);
      if (on && !existing)
        return {
          ...f,
          steps: [...f.steps, { id: freshId(), kind: "DOWNSELL", pageId: null, linkKey: null, attachedTo: upsellId }],
        };
      if (!on && existing) return { ...f, steps: f.steps.filter((s) => s.id !== existing.id) };
      return f;
    });

  // Cria a página-modelo e já a escolhe (o vínculo é feito ao "Salvar upsell").
  const makePage = (kind: "UPSELL" | "DOWNSELL" | "THANK_YOU", assign: (pageId: string) => void) =>
    void runCreate(
      { offerId, kind },
      {
        success: "Página criada.",
        onSuccess: (page) => {
          setCreated((prev) => [...prev, page]);
          assign(page.id);
        },
      },
    );

  const save = () => void run({ offerId, flow }, { success: "Upsell salvo.", onSuccess: () => commit({ flow }) });
  const noProducts = products.length === 0;
  const flowProblems = problemsOf("flow");

  return (
    <div className="flex flex-col gap-6">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex max-w-3xl flex-col gap-8"
      >
        {noProducts ? (
          <p className="rounded-md border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
            Para montar o upsell, primeiro crie em <b>Links e checkouts</b> os produtos (com pagamento ou checkout
            salvo) — os que começam a sequência e os das ofertas de upsell/downsell.
          </p>
        ) : (
          <>
            {/* 1 · Em quais compras esse upsell começa? */}
            <section>
              <SectionTitle n={1}>Em quais compras esse upsell começa?</SectionTitle>
              <p className="mt-1 text-muted-foreground text-xs">
                Marque os produtos. Depois de comprar um deles, a pessoa entra na sequência de ofertas abaixo.
              </p>
              {startCandidates.length === 0 ? (
                <p className="mt-3 text-muted-foreground text-sm">
                  Todos os seus produtos já são ofertas da sequência. Crie um produto de compra em “Links e checkouts”
                  para iniciar o upsell por ele.
                </p>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  {startCandidates.map((p) => {
                    const checked = startSet.has(p.key);
                    return (
                      <div
                        key={p.key}
                        className={cn(
                          "flex items-center gap-3 rounded-md border px-3 py-2.5",
                          checked ? "border-primary/50 bg-primary/5" : "bg-card",
                        )}
                      >
                        <Checkbox id={`start-${p.key}`} checked={checked} onCheckedChange={() => toggleStart(p.key)} />
                        <Label
                          htmlFor={`start-${p.key}`}
                          className="flex flex-1 cursor-pointer items-center gap-3 font-normal"
                        >
                          <ShoppingBagIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0 truncate text-sm">{p.productName}</span>
                          <span className="ml-auto shrink-0 text-muted-foreground text-xs">
                            {formatAmount(p.amountCents, p.currency as never)}
                          </span>
                        </Label>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 2 · A sequência */}
            <section>
              <SectionTitle n={2}>A sequência</SectionTitle>
              <p className="mt-1 text-muted-foreground text-xs">O que a pessoa vê, em ordem, depois de comprar.</p>

              {main.length === 0 ? (
                <div className="mt-3 rounded-lg border border-dashed p-6 text-center">
                  <p className="text-muted-foreground text-sm">Nenhuma oferta ainda.</p>
                  <Button type="button" variant="outline" size="sm" className="mt-3" onClick={addUpsell}>
                    <PlusIcon /> Adicionar a 1ª oferta
                  </Button>
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-emerald-800 text-xs dark:bg-emerald-950/30 dark:text-emerald-200">
                    <ShoppingBagIcon className="size-4 shrink-0" aria-hidden="true" />
                    Pessoa comprou — mostramos a 1ª oferta.
                  </div>

                  {main.map((step, i) => {
                    const isLast = i === main.length - 1;
                    if (step.kind === "DOWNSELL") {
                      return (
                        <LooseDownsellCard
                          key={step.id}
                          step={step}
                          pageOptions={pageOptions}
                          productOptions={productOptions}
                          needsManual={needsManual(pageById, step.pageId)}
                          creating={creating}
                          errors={problemsOf(step.id)}
                          onChange={(c) => updateStep(step.id, c)}
                          onRemove={() => removeStep(step.id)}
                          onCreatePage={() => makePage("DOWNSELL", (pageId) => updateStep(step.id, { pageId }))}
                        />
                      );
                    }
                    const idx = upsellSteps.findIndex((s) => s.id === step.id) + 1;
                    const down = attachedDownsell(flow, step.id);
                    const canAddDownsell = !!down || downsellCount(flow) < DOWNSELL_MAX;
                    const declineText = down
                      ? "Se clicar NÃO, vê a oferta mais barata abaixo."
                      : isLast
                        ? "Se clicar NÃO, vai para a página de obrigado."
                        : "Se clicar NÃO, vai para a próxima oferta.";
                    return (
                      <UpsellCard
                        key={step.id}
                        index={idx}
                        step={step}
                        down={down}
                        declineText={declineText}
                        canAddDownsell={canAddDownsell}
                        pageOptions={pageOptions}
                        productOptions={productOptions}
                        needsManual={needsManual(pageById, step.pageId)}
                        downNeedsManual={down ? needsManual(pageById, down.pageId) : false}
                        creating={creating}
                        errors={problemsOf(step.id)}
                        downErrors={down ? problemsOf(down.id) : []}
                        onChange={(c) => updateStep(step.id, c)}
                        onRemove={() => removeStep(step.id)}
                        onCreatePage={() => makePage("UPSELL", (pageId) => updateStep(step.id, { pageId }))}
                        onToggleDownsell={(on) => toggleDownsell(step.id, on)}
                        onChangeDown={(c) => down && updateStep(down.id, c)}
                        onCreateDownPage={() =>
                          down && makePage("DOWNSELL", (pageId) => updateStep(down.id, { pageId }))
                        }
                      />
                    );
                  })}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    disabled={upsellCount(flow) >= UPSELL_MAX}
                    onClick={addUpsell}
                  >
                    <PlusIcon /> Adicionar oferta ({upsellCount(flow)}/{UPSELL_MAX})
                  </Button>
                </div>
              )}
            </section>

            {/* 3 · Fim */}
            <section>
              <SectionTitle n={3}>No fim de tudo</SectionTitle>
              <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                <span className="shrink-0 text-muted-foreground text-xs sm:w-40">Vai para a página de</span>
                <div className="flex-1">
                  <PickSelect
                    value={flow.thankYouPageId}
                    options={pageOptions}
                    ariaLabel="Página de obrigado do fim"
                    onChange={(v) => updateFlow((f) => ({ ...f, thankYouPageId: v }))}
                  />
                  <CreatePageButton
                    label="Criar página de obrigado"
                    pending={creating}
                    onClick={() =>
                      makePage("THANK_YOU", (pageId) => updateFlow((f) => ({ ...f, thankYouPageId: pageId })))
                    }
                  />
                </div>
              </div>
            </section>

            {flowProblems.length > 0 && (
              <div className="rounded-md bg-amber-50 p-4 text-amber-900 text-sm dark:bg-amber-950/40 dark:text-amber-200">
                <p className="font-medium">Falta ajustar antes de o upsell rodar:</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {flowProblems.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            {initial.flow.steps.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-4">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="font-medium text-sm">Montou o upsell? Use ele em outras ofertas.</p>
                  <p className="text-muted-foreground text-xs">
                    Copia as páginas, os produtos e as ligações para as ofertas que você escolher (mesma moeda).
                    {dirty && " Salve as alterações primeiro."}
                  </p>
                </div>
                <Button type="button" variant="outline" disabled={dirty} onClick={() => setApplyOpen(true)}>
                  <CopyIcon /> Usar em outras ofertas
                </Button>
              </div>
            )}
          </>
        )}

        <SaveBar dirty={dirty} pending={pending} onReset={() => reset()} saveLabel="Salvar upsell" />
      </form>
      <UpsellApplyDialog open={applyOpen} onOpenChange={setApplyOpen} offerId={offerId} />
    </div>
  );
}

/** A página da etapa é clonada (não foi criada aqui): precisa ligar os botões à mão. */
function needsManual(pageById: Map<string, UpsellPageOption>, pageId: string | null): boolean {
  const p = pageId ? pageById.get(pageId) : undefined;
  return !!p && !p.autoWire;
}

function SectionTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-medium text-sm">
      <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 font-medium text-[11px] text-primary">
        {n}
      </span>
      {children}
    </h2>
  );
}

function UpsellCard({
  index,
  step,
  down,
  declineText,
  canAddDownsell,
  pageOptions,
  productOptions,
  needsManual: manual,
  downNeedsManual,
  creating,
  errors,
  downErrors,
  onChange,
  onRemove,
  onCreatePage,
  onToggleDownsell,
  onChangeDown,
  onCreateDownPage,
}: {
  index: number;
  step: UpsellStep;
  down: UpsellStep | undefined;
  declineText: string;
  canAddDownsell: boolean;
  pageOptions: Option[];
  productOptions: Option[];
  needsManual: boolean;
  downNeedsManual: boolean;
  creating: boolean;
  errors: string[];
  downErrors: string[];
  onChange: (c: Partial<UpsellStep>) => void;
  onRemove: () => void;
  onCreatePage: () => void;
  onToggleDownsell: (on: boolean) => void;
  onChangeDown: (c: Partial<UpsellStep>) => void;
  onCreateDownPage: () => void;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 font-medium text-sm">
          <GiftIcon className="size-4 text-primary" aria-hidden="true" /> Oferta {index}
        </span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remover oferta ${index}`} onClick={onRemove}>
          <Trash2Icon />
        </Button>
      </div>

      <FieldRow label="Mostrar a página">
        <PickSelect
          value={step.pageId}
          options={pageOptions}
          ariaLabel={`Página da oferta ${index}`}
          onChange={(v) => onChange({ pageId: v })}
        />
        <CreatePageButton label="Criar página de oferta" pending={creating} onClick={onCreatePage} />
        {manual && <ManualNote />}
      </FieldRow>

      <div className="mt-3 flex items-center gap-3 rounded-md bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
        <CheckIcon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <span className="shrink-0 text-emerald-800 text-xs dark:text-emerald-200">Se clicar SIM, cobra</span>
        <div className="flex-1">
          <PickSelect
            value={step.linkKey}
            options={productOptions}
            emptyLabel="escolher o produto"
            ariaLabel={`Produto cobrado no SIM da oferta ${index}`}
            onChange={(v) => onChange({ linkKey: v })}
          />
        </div>
      </div>

      <p className="mt-2 flex items-center gap-2 px-1 text-muted-foreground text-xs">
        <ArrowDownIcon className="size-3.5 shrink-0" aria-hidden="true" />
        {declineText}
      </p>

      <div className="mt-3 flex items-start gap-2 border-t pt-3">
        <Checkbox
          id={`ds-${step.id}`}
          checked={!!down}
          disabled={!canAddDownsell}
          onCheckedChange={(v) => onToggleDownsell(v === true)}
          className="mt-0.5"
        />
        <Label
          htmlFor={`ds-${step.id}`}
          className={cn(
            "cursor-pointer font-normal text-xs",
            canAddDownsell ? "text-muted-foreground" : "text-muted-foreground/60",
          )}
        >
          Se recusar, oferecer algo mais barato antes (downsell)
          {!canAddDownsell && !down && " — você já tem 2 downsells (o máximo)."}
        </Label>
      </div>

      {down && (
        <div className="mt-2.5 ml-6 flex flex-col rounded-lg border bg-muted/30 p-3">
          <span className="mb-2 font-medium text-xs">Downsell — oferta mais barata</span>
          <FieldRow label="Mostrar a página">
            <PickSelect
              value={down.pageId}
              options={pageOptions}
              ariaLabel={`Página do downsell da oferta ${index}`}
              onChange={(v) => onChangeDown({ pageId: v })}
            />
            <CreatePageButton label="Criar página de downsell" pending={creating} onClick={onCreateDownPage} />
            {downNeedsManual && <ManualNote />}
          </FieldRow>
          <div className="mt-3 flex items-center gap-3 rounded-md bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
            <CheckIcon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span className="shrink-0 text-emerald-800 text-xs dark:text-emerald-200">Se clicar SIM, cobra</span>
            <div className="flex-1">
              <PickSelect
                value={down.linkKey}
                options={productOptions}
                emptyLabel="escolher o produto"
                ariaLabel={`Produto cobrado no downsell da oferta ${index}`}
                onChange={(v) => onChangeDown({ linkKey: v })}
              />
            </div>
          </div>
          <SoftErrors messages={downErrors} />
        </div>
      )}

      <SoftErrors messages={errors} />
    </div>
  );
}

/** Downsell "solto" (só de ofertas antigas): aparece para todo mundo que chega nele. */
function LooseDownsellCard({
  step,
  pageOptions,
  productOptions,
  needsManual: manual,
  creating,
  errors,
  onChange,
  onRemove,
  onCreatePage,
}: {
  step: UpsellStep;
  pageOptions: Option[];
  productOptions: Option[];
  needsManual: boolean;
  creating: boolean;
  errors: string[];
  onChange: (c: Partial<UpsellStep>) => void;
  onRemove: () => void;
  onCreatePage: () => void;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-2 font-medium text-sm">
          <GiftIcon className="size-4 text-primary" aria-hidden="true" /> Oferta mais barata (downsell)
        </span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remover downsell" onClick={onRemove}>
          <Trash2Icon />
        </Button>
      </div>
      <p className="mb-3 text-muted-foreground text-xs">Aparece para todo mundo que chega aqui.</p>
      <FieldRow label="Mostrar a página">
        <PickSelect
          value={step.pageId}
          options={pageOptions}
          ariaLabel="Página do downsell"
          onChange={(v) => onChange({ pageId: v })}
        />
        <CreatePageButton label="Criar página de downsell" pending={creating} onClick={onCreatePage} />
        {manual && <ManualNote />}
      </FieldRow>
      <div className="mt-3 flex items-center gap-3 rounded-md bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
        <CheckIcon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <span className="shrink-0 text-emerald-800 text-xs dark:text-emerald-200">Se clicar SIM, cobra</span>
        <div className="flex-1">
          <PickSelect
            value={step.linkKey}
            options={productOptions}
            emptyLabel="escolher o produto"
            ariaLabel="Produto cobrado no SIM do downsell"
            onChange={(v) => onChange({ linkKey: v })}
          />
        </div>
      </div>
      <SoftErrors messages={errors} />
    </div>
  );
}

/** Linha "rótulo à esquerda, campo à direita" (empilha no celular). */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <span className="shrink-0 pt-2 text-muted-foreground text-xs sm:w-28">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Pendências de uma etapa, em tom calmo (sem vermelho na cara). */
function SoftErrors({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return <p className="mt-2 text-amber-700 text-xs dark:text-amber-300">{messages.join(" ")}</p>;
}

/** Aviso de página clonada (precisa ligar os botões à mão no editor). */
function ManualNote() {
  return (
    <p className="mt-1.5 rounded-md bg-amber-50 p-2 text-amber-900 text-xs dark:bg-amber-950/40 dark:text-amber-200">
      Essa página é clonada (não foi criada aqui). No editor dela, ligue o botão de compra ao produto (em “Link da
      oferta”) e o botão de recusar à próxima página (em “Página do funil”). As páginas criadas por aqui já vêm ligadas.
    </p>
  );
}

/** Botão discreto "＋ Criar página de …" sob um select de página. */
function CreatePageButton({ label, pending, onClick }: { label: string; pending: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="mt-1.5 h-auto px-1 py-0.5 text-xs"
      disabled={pending}
      onClick={onClick}
    >
      {pending ? <Spinner /> : <PlusIcon />}
      {label}
    </Button>
  );
}

/** Select sem rótulo (o rótulo vem de fora, via FieldRow ou do bloco SIM). */
function PickSelect({
  value,
  options,
  emptyLabel = "— escolher —",
  ariaLabel,
  onChange,
}: {
  value: string | null;
  options: Option[];
  emptyLabel?: string;
  ariaLabel: string;
  onChange: (value: string | null) => void;
}) {
  return (
    // v === "" nunca vem do usuário (a opção vazia é NONE): é o Radix "limpando"
    // quando o valor escolhido ainda não está na lista (página recém-criada). Ignorar.
    <Select
      value={value ?? NONE}
      onValueChange={(v) => {
        if (v === NONE) onChange(null);
        else if (v) onChange(v);
      }}
    >
      <SelectTrigger className="w-full" aria-label={ariaLabel}>
        <SelectValue placeholder={emptyLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{emptyLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
