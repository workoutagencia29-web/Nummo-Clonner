"use client";

import {
  ClockIcon,
  FileInputIcon,
  MousePointerClickIcon,
  PencilIcon,
  PlusIcon,
  ShoppingCartIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  applyRecommendedRulesAction,
  deleteEventRuleAction,
  dismissRecommendedRulesAction,
  setEventRuleEnabledAction,
} from "@/server/actions/tracking";
import type { EventRuleView, RecommendedRuleView } from "@/server/services/tracking";
import { Callout } from "./callout";
import { SectionHeading } from "./form-kit";
import {
  eventParts,
  type PanelLink,
  type PanelPage,
  ruleHasMissingLink,
  ruleScopeText,
  ruleTriggerText,
} from "./helpers";
import { RuleDialog } from "./rule-dialog";

/** Ícone de cada gatilho das regras recomendadas. */
const TRIGGER_ICON = {
  TIME_ON_PAGE: ClockIcon,
  CHECKOUT_CLICK: ShoppingCartIcon,
  FORM_SUBMIT: FileInputIcon,
} as const;

/** Frase de uma regra recomendada que falta ("depois de 15 segundos na página"). */
function recommendedText(rule: RecommendedRuleView, links: PanelLink[]) {
  const text = ruleTriggerText(rule, links);
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function RuleRow({
  rule,
  links,
  pages,
  onEdit,
  onDelete,
}: {
  rule: EventRuleView;
  links: PanelLink[];
  pages: PanelPage[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const toggle = useAction(setEventRuleEnabledAction);
  const [enabled, setEnabled] = useState(rule.enabled);
  const [synced, setSynced] = useState(rule.enabled);
  if (synced !== rule.enabled) {
    setSynced(rule.enabled);
    setEnabled(rule.enabled);
  }
  const { title, code } = eventParts(rule.event);
  const when = ruleTriggerText(rule, links);
  const missing = ruleHasMissingLink(rule, links);
  const scope = ruleScopeText(rule, pages);

  return (
    <li className={cn("flex flex-wrap items-center gap-3 px-4 py-3", !enabled && "bg-muted/30")}>
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <MousePointerClickIcon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 basis-60">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("font-medium", !enabled && "text-muted-foreground")}>{title}</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{code}</code>
          {!enabled && <Badge variant="outline">Desativada</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="break-all">{when}</span>
          <span aria-hidden="true">·</span>
          <Badge variant={rule.pageId ? "secondary" : "outline"}>{scope}</Badge>
        </div>
        {missing && (
          <p className="mt-1 text-xs text-warning-foreground dark:text-warning">
            O link desta regra foi excluído: ela não dispara. Edite a regra e escolha outro link.
          </p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Switch
          checked={enabled}
          disabled={toggle.pending}
          aria-label={`Regra ${code} (${when}) ativa`}
          className="mr-2"
          onCheckedChange={(value) => {
            setEnabled(value);
            void toggle.run(
              { id: rule.id, enabled: value },
              { success: value ? "Regra ativada." : "Regra desativada.", onError: () => setEnabled(!value) },
            );
          }}
        />
        <Button variant="ghost" size="icon-sm" aria-label={`Editar regra ${code}: ${when}`} onClick={onEdit}>
          <PencilIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Excluir regra ${code}: ${when}`} onClick={onDelete}>
          <Trash2Icon />
        </Button>
      </div>
    </li>
  );
}

/** Regras de evento da oferta (quando cada evento dispara) + "Usar recomendados". */
export function RulesSection({
  offerId,
  rules,
  links,
  pages,
  missingRecommended,
}: {
  offerId: string;
  rules: EventRuleView[];
  links: PanelLink[];
  pages: PanelPage[];
  missingRecommended: RecommendedRuleView[];
}) {
  const [dialog, setDialog] = useState<{ open: boolean; rule: EventRuleView | null }>({ open: false, rule: null });
  const [deleting, setDeleting] = useState<EventRuleView | null>(null);
  const recommend = useAction(applyRecommendedRulesAction);
  const dismiss = useAction(dismissRecommendedRulesAction);
  const remove = useAction(deleteEventRuleAction);

  const recommendButton = (
    <Button
      variant={rules.length ? "outline" : "default"}
      disabled={recommend.pending}
      onClick={() =>
        void recommend.run(
          { offerId },
          {
            success: (r) =>
              r.created
                ? `${plural(r.created, "regra recomendada criada", "regras recomendadas criadas")}.`
                : "As regras recomendadas já estavam criadas.",
          },
        )
      }
    >
      {recommend.pending ? <Spinner /> : <SparklesIcon />}
      Usar recomendados
    </Button>
  );

  return (
    <section aria-labelledby="os-rules-title" className="flex flex-col gap-4">
      <SectionHeading
        title={<span id="os-rules-title">Regras de evento</span>}
        description={
          <>
            O <strong className="font-medium text-foreground">PageView é automático</strong>: dispara ao abrir cada
            página, em todos os pixels. Aqui você escolhe quando os outros eventos disparam.
          </>
        }
        actions={
          rules.length > 0 && (
            <Button onClick={() => setDialog({ open: true, rule: null })}>
              <PlusIcon />
              Nova regra
            </Button>
          )
        }
      />

      {missingRecommended.length > 0 && (
        <Callout
          variant="info"
          icon={SparklesIcon}
          title={
            !rules.length
              ? "Comece pelos eventos recomendados"
              : missingRecommended.length === 1
                ? "Falta uma regra recomendada"
                : "Faltam regras recomendadas"
          }
          action={
            <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
              {recommendButton}
              {rules.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={dismiss.pending}
                  onClick={() =>
                    void dismiss.run({ offerId }, { success: "Pronto: as regras recomendadas não aparecem mais aqui." })
                  }
                >
                  {dismiss.pending && <Spinner />}
                  Não sugerir mais
                </Button>
              )}
            </div>
          }
        >
          <ul className="mt-1 flex flex-col gap-1" aria-label="Regras recomendadas que faltam">
            {missingRecommended.map((rule) => {
              const Icon = TRIGGER_ICON[rule.trigger as keyof typeof TRIGGER_ICON] ?? MousePointerClickIcon;
              const { code } = eventParts(rule.event);
              return (
                <li key={`${rule.event}:${rule.trigger}`} className="flex items-center gap-2">
                  <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    <strong className="font-medium">{code}</strong> {recommendedText(rule, links)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Callout>
      )}

      {rules.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card p-8 text-center">
          <MousePointerClickIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="font-medium">Nenhuma regra ainda</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Sem regras, os pixels recebem só o PageView. Use os recomendados ou crie a sua.
            </p>
          </div>
          <Button variant="outline" onClick={() => setDialog({ open: true, rule: null })}>
            <PlusIcon />
            Criar regra
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card" aria-label="Regras de evento">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              links={links}
              pages={pages}
              onEdit={() => setDialog({ open: true, rule })}
              onDelete={() => setDeleting(rule)}
            />
          ))}
        </ul>
      )}

      <RuleDialog
        offerId={offerId}
        open={dialog.open}
        rule={dialog.rule}
        links={links}
        pages={pages}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir esta regra?"
        description={
          deleting
            ? `${eventParts(deleting.event).code} — ${ruleTriggerText(deleting, links)} (${ruleScopeText(deleting, pages)}). Para só pausar, use o botão de ativar.`
            : ""
        }
        confirmLabel="Excluir regra"
        destructive
        pending={remove.pending}
        onConfirm={() => {
          if (!deleting) return;
          void remove.run({ id: deleting.id }, { success: "Regra excluída.", onSuccess: () => setDeleting(null) });
        }}
      />
    </section>
  );
}
