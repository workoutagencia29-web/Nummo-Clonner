"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { Panel, SaveBar, SectionHeading, useDraft } from "@/components/offers/tracking/form-kit";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { PAGE_TYPE_LABEL } from "@/lib/labels";
import { formatAmount } from "@/lib/payments/rules";
import {
  DOWNSELL_MAX,
  downsellCount,
  UPSELL_MAX,
  type UpsellFlow,
  type UpsellKind,
  type UpsellStep,
  upsellCount,
  upsellProblems,
  upsellRouting,
} from "@/lib/upsell";
import { createUpsellPageAction, saveUpsellAction } from "@/server/actions/upsell";
import type { UpsellPageOption, UpsellPanel as UpsellPanelData } from "@/server/services/upsell";

/** "— nenhum —" num Select (o Radix não aceita value vazio). */
const NONE = "__none__";
const freshId = () => `s${Math.random().toString(36).slice(2, 9)}`;

/** Para onde a etapa leva (mostrado no cartão) e se a página precisa ser ligada à mão (clonada). */
interface StepRoute {
  sim: string;
  nao: string;
  needsManual: boolean;
}

export function UpsellPanel({ offerId, initial }: { offerId: string; initial: UpsellPanelData }) {
  const { draft, setDraft, dirty, reset, commit } = useDraft<{ flow: UpsellFlow }>({ flow: initial.flow });
  const { run, pending } = useAction(saveUpsellAction);
  const { run: runCreate, pending: creating } = useAction(createUpsellPageAction);
  const flow = draft.flow;
  const { products } = initial;
  // Sempre funcional (lê o rascunho mais recente): a criação de página revalida a
  // tela, então uma atualização presa a um `flow` antigo se perderia.
  const updateFlow = (fn: (f: UpsellFlow) => UpsellFlow) => setDraft((d) => ({ ...d, flow: fn(d.flow) }));

  // Páginas criadas aqui agora aparecem na hora (antes mesmo da tela recarregar),
  // juntas com as da oferta e sem repetir (quando o recarregar as traz também).
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

  const upsells = flow.steps.filter((s) => s.kind === "UPSELL");
  const problems = upsellProblems(flow);
  const problemsOf = (stepId: string | "flow") => problems.filter((p) => p.stepId === stepId).map((p) => p.message);

  // Roteamento (para onde cada etapa leva ao aceitar/recusar) e os nomes para mostrar.
  const routing = upsellRouting(flow);
  const routeById = new Map(routing.steps.map((r) => [r.stepId, r]));
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const pageLabel = (id: string | null): string => {
    const target = id ?? flow.thankYouPageId;
    if (!target) return "a página de obrigado";
    const p = pageById.get(target);
    return p ? `“${p.name}”` : "uma página excluída";
  };
  const productLabel = (key: string | null): string => {
    const p = key ? products.find((x) => x.key === key) : undefined;
    return p ? `“${p.productName}”` : "o produto da etapa";
  };
  const routeOf = (step: UpsellStep): StepRoute => {
    const r = routeById.get(step.id);
    const page = step.pageId ? pageById.get(step.pageId) : undefined;
    return {
      sim: productLabel(step.linkKey),
      nao: pageLabel(r ? r.declinePageId : null),
      needsManual: !!page && !page.autoWire,
    };
  };

  const addStep = (kind: UpsellKind) => {
    if (kind === "UPSELL" && upsellCount(flow) >= UPSELL_MAX) return;
    if (kind === "DOWNSELL" && downsellCount(flow) >= DOWNSELL_MAX) return;
    const step: UpsellStep = { id: freshId(), kind, pageId: null, linkKey: null, attachedTo: null };
    updateFlow((f) => ({ ...f, steps: [...f.steps, step] }));
  };
  const updateStep = (id: string, changes: Partial<UpsellStep>) =>
    updateFlow((f) => ({ ...f, steps: f.steps.map((s) => (s.id === id ? { ...s, ...changes } : s)) }));
  const removeStep = (id: string) =>
    // Tirar um upsell tira também o downsell atrelado a ele.
    updateFlow((f) => ({ ...f, steps: f.steps.filter((s) => s.id !== id && s.attachedTo !== id) }));

  // Cria a página-modelo da etapa e já a escolhe (o vínculo é feito ao "Salvar upsell").
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

  const productOptions = products.map((p) => ({
    value: p.key,
    label: `${p.label} · ${p.productName} — ${formatAmount(p.amountCents, p.currency as never)}`,
  }));
  const pageOptions = pages.map((p) => ({
    value: p.id,
    label: `${p.name} · ${PAGE_TYPE_LABEL[p.type as keyof typeof PAGE_TYPE_LABEL] ?? p.type}`,
  }));

  const save = () => void run({ offerId, flow }, { success: "Upsell salvo.", onSuccess: () => commit({ flow }) });

  const noProducts = products.length === 0;

  return (
    <Panel className="max-w-5xl">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <SectionHeading
          title="Upsell pós-compra"
          description="Depois que a pessoa compra o produto principal, ela passa por uma sequência de ofertas (upsells e downsells) antes de chegar na página de obrigado. No “SIM”, abre um checkout rápido com os dados dela já preenchidos (nenhum gateway cobra em 1 clique de verdade). No “Não”, vai para o downsell ou para a próxima etapa."
        />

        {noProducts ? (
          <p className="mt-4 rounded-md border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
            Para montar o upsell, primeiro crie em <b>Links e checkouts</b> os produtos (com pagamento ou checkout
            salvo) — o principal e os das etapas de upsell/downsell.
          </p>
        ) : (
          <>
            <LabeledSelect
              className="mt-5"
              label="Produto principal"
              hint="O produto cuja compra começa a sequência."
              value={flow.startLinkKey}
              options={productOptions}
              onChange={(v) => updateFlow((f) => ({ ...f, startLinkKey: v }))}
            />

            <div className="mt-6 flex flex-col gap-3">
              <h3 className="font-medium text-sm">Etapas</h3>
              {flow.steps.length === 0 && (
                <p className="text-muted-foreground text-sm">Nenhuma etapa ainda. Adicione um upsell abaixo.</p>
              )}
              {flow.steps.map((step) => (
                <StepCard
                  key={step.id}
                  step={step}
                  allSteps={flow.steps}
                  upsells={upsells}
                  pageOptions={pageOptions}
                  productOptions={productOptions}
                  errors={problemsOf(step.id)}
                  creating={creating}
                  route={routeOf(step)}
                  onChange={(c) => updateStep(step.id, c)}
                  onRemove={() => removeStep(step.id)}
                  onCreatePage={() => makePage(step.kind, (pageId) => updateStep(step.id, { pageId }))}
                />
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={upsellCount(flow) >= UPSELL_MAX}
                  onClick={() => addStep("UPSELL")}
                >
                  <PlusIcon /> Adicionar upsell ({upsellCount(flow)}/{UPSELL_MAX})
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={downsellCount(flow) >= DOWNSELL_MAX}
                  onClick={() => addStep("DOWNSELL")}
                >
                  <PlusIcon /> Adicionar downsell ({downsellCount(flow)}/{DOWNSELL_MAX})
                </Button>
              </div>
            </div>

            <div className="mt-6">
              <LabeledSelect
                label="Página de obrigado (fim da sequência)"
                hint="Para onde vai no fim de tudo."
                value={flow.thankYouPageId}
                options={pageOptions}
                onChange={(v) => updateFlow((f) => ({ ...f, thankYouPageId: v }))}
              />
              <CreatePageButton
                label="Criar página de obrigado"
                pending={creating}
                onClick={() => makePage("THANK_YOU", (pageId) => updateFlow((f) => ({ ...f, thankYouPageId: pageId })))}
              />
            </div>

            {problemsOf("flow").length > 0 && (
              <ul className="mt-5 list-disc space-y-1 rounded-md bg-amber-50 p-4 pl-8 text-amber-900 text-sm dark:bg-amber-950/40 dark:text-amber-200">
                {problemsOf("flow").map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </>
        )}

        <SaveBar dirty={dirty} pending={pending} onReset={() => reset()} saveLabel="Salvar upsell" />
      </form>
    </Panel>
  );
}

function StepCard({
  step,
  allSteps,
  upsells,
  pageOptions,
  productOptions,
  errors,
  creating,
  route,
  onChange,
  onRemove,
  onCreatePage,
}: {
  step: UpsellStep;
  allSteps: UpsellStep[];
  upsells: UpsellStep[];
  pageOptions: { value: string; label: string }[];
  productOptions: { value: string; label: string }[];
  errors: string[];
  creating: boolean;
  route: StepRoute;
  onChange: (c: Partial<UpsellStep>) => void;
  onRemove: () => void;
  onCreatePage: () => void;
}) {
  const sameKind = allSteps.filter((s) => s.kind === step.kind);
  const n = sameKind.findIndex((s) => s.id === step.id) + 1;
  const title = step.kind === "UPSELL" ? `Upsell ${n}` : `Downsell ${n}`;
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-medium text-sm">{title}</span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remover ${title}`} onClick={onRemove}>
          <Trash2Icon />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <LabeledSelect
            label="Página"
            value={step.pageId}
            options={pageOptions}
            onChange={(v) => onChange({ pageId: v })}
          />
          <CreatePageButton
            label={step.kind === "UPSELL" ? "Criar página de upsell" : "Criar página de downsell"}
            pending={creating}
            onClick={onCreatePage}
          />
        </div>
        <LabeledSelect
          label="Produto (checkout do SIM)"
          value={step.linkKey}
          options={productOptions}
          onChange={(v) => onChange({ linkKey: v })}
        />
        {step.kind === "DOWNSELL" && (
          <LabeledSelect
            className="sm:col-span-2"
            label="Quando aparece"
            hint="Atrelado a um upsell (aparece ao recusar aquele) ou solto na fila."
            value={step.attachedTo ?? null}
            emptyLabel="Solto na sequência"
            options={upsells.map((u) => {
              const i = upsells.findIndex((x) => x.id === u.id) + 1;
              return { value: u.id, label: `Ao recusar o Upsell ${i}` };
            })}
            onChange={(v) => onChange({ attachedTo: v })}
          />
        )}
      </div>
      <p className="mt-3 text-muted-foreground text-xs">
        Ao aceitar (<b>SIM</b>): abre o checkout de {route.sim}. Ao recusar (<b>Não</b>): vai para {route.nao}.
      </p>
      {route.needsManual && (
        <p className="mt-2 rounded-md bg-amber-50 p-2 text-amber-900 text-xs dark:bg-amber-950/40 dark:text-amber-200">
          Essa página é clonada (não foi criada aqui). No editor dela, ligue o botão de compra a {route.sim} (em “Link
          da oferta”) e o botão de recusar a {route.nao} (em “Página do funil”). As páginas criadas por aqui já vêm
          ligadas sozinhas.
        </p>
      )}
      {errors.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-destructive text-xs">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
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

function LabeledSelect({
  label,
  hint,
  value,
  options,
  emptyLabel = "— escolher —",
  onChange,
  className,
}: {
  label: string;
  hint?: string;
  value: string | null;
  options: { value: string; label: string }[];
  emptyLabel?: string;
  onChange: (value: string | null) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="font-medium text-sm">{label}</span>
      {hint && <p className="mb-1 text-muted-foreground text-xs">{hint}</p>}
      {/* v === "" nunca vem do usuário (a opção vazia é NONE): é o Radix "limpando" quando
          o valor escolhido ainda não está na lista (página recém-criada). Ignorar, senão apaga a escolha. */}
      <Select
        value={value ?? NONE}
        onValueChange={(v) => {
          if (v === NONE) onChange(null);
          else if (v) onChange(v);
        }}
      >
        <SelectTrigger className="mt-1 w-full" aria-label={label}>
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
    </div>
  );
}
