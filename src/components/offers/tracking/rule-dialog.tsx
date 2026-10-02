"use client";

/**
 * Nova regra / editar regra de evento: qual evento, quando dispara (com os
 * segundos, a porcentagem ou o elemento clicado) e em quais páginas.
 * Para "clique em um elemento", os links da oferta aparecem primeiro
 * ([data-os-link="chave"]); o seletor CSS fica como opção avançada.
 */
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { PAGE_TYPE_LABEL } from "@/lib/labels";
import {
  EVENT_TRIGGER_LABEL,
  EVENT_TRIGGERS,
  type EventTriggerId,
  RULE_EVENTS,
  type RuleEventId,
} from "@/lib/tracking/schema";
import { cn } from "@/lib/utils";
import { createEventRuleAction, updateEventRuleAction } from "@/server/actions/tracking";
import type { EventRuleView } from "@/server/services/tracking";
import { Callout } from "./callout";
import {
  eventParts,
  isRuleEvent,
  linkKeyFromSelector,
  type PanelLink,
  type PanelPage,
  ruleTriggerText,
  selectorForLink,
  selectorProblem,
  suggestedTrigger,
  triggerValueKind,
} from "./helpers";

const ALL_PAGES = "__todas__";
const CSS_TARGET = "__css__";
const LINK_KIND_LABEL: Record<string, string> = {
  CHECKOUT: "Checkout",
  UPSELL: "Checkout do upsell",
  DOWNSELL: "Checkout do downsell",
  WHATSAPP: "WhatsApp",
  OTHER: "Outro",
};
const INVALID_SELECTOR = "Esse seletor CSS não é válido. Use algo como #botao-comprar, .cta ou a[href*='hotmart'].";

function lowerFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Confere o seletor como o navegador faria (o servidor confere de novo). */
function checkSelectorLive(selector: string): string | null {
  const basic = selectorProblem(selector);
  if (basic) return basic;
  if (typeof document === "undefined") return null;
  try {
    document.createDocumentFragment().querySelector(selector.trim());
    return null;
  } catch {
    return INVALID_SELECTOR;
  }
}

interface Draft {
  event: RuleEventId | "";
  trigger: EventTriggerId | "";
  value: string;
  /** "link:<chave>" (link da oferta) ou CSS_TARGET. */
  target: string;
  selector: string;
  pageId: string;
}

function initialDraft(rule: EventRuleView | null, links: PanelLink[]): Draft {
  if (!rule) return { event: "", trigger: "", value: "", target: "", selector: "", pageId: ALL_PAGES };
  const key = linkKeyFromSelector(rule.selector);
  const isLink = key !== null && links.some((l) => l.key === key);
  return {
    event: isRuleEvent(rule.event) ? rule.event : "",
    trigger: rule.trigger,
    value: rule.value === null ? "" : String(rule.value),
    target: rule.trigger === "ELEMENT_CLICK" ? (isLink ? `link:${key}` : CSS_TARGET) : "",
    selector: isLink ? "" : (rule.selector ?? ""),
    pageId: rule.pageId ?? ALL_PAGES,
  };
}

type RuleField = "event" | "trigger" | "value" | "selector" | "pageId";

export function RuleDialog({
  offerId,
  open,
  onOpenChange,
  rule,
  links,
  pages,
}: {
  offerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = regra nova. */
  rule: EventRuleView | null;
  links: PanelLink[];
  pages: PanelPage[];
}) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(rule, links));
  const [touched, setTouched] = useState({ trigger: false, page: false });
  const [errors, setErrors] = useState<Partial<Record<RuleField, string>>>({});
  const create = useAction(createEventRuleAction);
  const update = useAction(updateEventRuleAction);
  const pending = create.pending || update.pending;
  const ids = useId();

  // Cada vez que abre, começa da regra (ou do zero). A lista pode atualizar com o diálogo aberto.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(initialDraft(rule, links));
      setTouched({ trigger: Boolean(rule), page: Boolean(rule) });
      setErrors({});
    }
  }

  function patch(changes: Partial<Draft>, clear: RuleField[]) {
    setDraft((d) => ({ ...d, ...changes }));
    setErrors((e) => {
      const next = { ...e };
      for (const f of clear) delete next[f];
      return next;
    });
  }

  function chooseEvent(value: string) {
    if (!isRuleEvent(value)) return;
    const changes: Partial<Draft> = { event: value };
    // Regra nova: sugere quando dispara (e a página de obrigado para a compra).
    if (!touched.trigger) {
      const s = suggestedTrigger(value, links);
      const key = linkKeyFromSelector(s.selector);
      changes.trigger = s.trigger;
      changes.value = s.value === null ? "" : String(s.value);
      changes.target = s.trigger === "ELEMENT_CLICK" && key ? `link:${key}` : "";
      changes.selector = "";
    }
    if (!touched.page) {
      const thanks = value === "PURCHASE" ? pages.find((p) => p.type === "THANK_YOU") : undefined;
      changes.pageId = thanks?.id ?? ALL_PAGES;
    }
    patch(changes, ["event", "trigger", "value", "selector"]);
  }

  function chooseTrigger(value: string) {
    const trigger = value as EventTriggerId;
    setTouched((t) => ({ ...t, trigger: true }));
    const kind = triggerValueKind(trigger);
    const before = draft.trigger ? triggerValueKind(draft.trigger) : null;
    // Segundos e porcentagem não se misturam: ao trocar de tipo, volta ao valor sugerido.
    const nextValue = kind === before && draft.value ? draft.value : kind === "seconds" ? "15" : "50";
    patch(
      {
        trigger,
        value: kind ? nextValue : "",
        target: trigger === "ELEMENT_CLICK" ? draft.target || (links.length ? "" : CSS_TARGET) : "",
      },
      ["trigger", "value", "selector"],
    );
  }

  const kind = draft.trigger ? triggerValueKind(draft.trigger) : null;
  const selector =
    draft.trigger !== "ELEMENT_CLICK"
      ? null
      : draft.target.startsWith("link:")
        ? selectorForLink(draft.target.slice(5))
        : draft.selector.trim();

  function validate(): Partial<Record<RuleField, string>> {
    const found: Partial<Record<RuleField, string>> = {};
    if (!draft.event) found.event = "Escolha o evento.";
    if (!draft.trigger) found.trigger = "Escolha quando o evento dispara.";
    if (kind) {
      const n = Number(draft.value.replace(",", "."));
      if (!draft.value.trim() || !Number.isInteger(n)) {
        found.value = kind === "seconds" ? "Informe quantos segundos (número inteiro)." : "Informe a porcentagem.";
      } else if (kind === "seconds" && (n < 1 || n > 86_400)) {
        found.value = "Informe os segundos (de 1 a 86400, ou seja, até 24 horas).";
      } else if (kind === "percent" && (n < 1 || n > 100)) {
        found.value = "Informe uma porcentagem entre 1 e 100.";
      }
    }
    if (draft.trigger === "ELEMENT_CLICK") {
      if (!draft.target) found.selector = "Escolha o elemento ou link.";
      else if (draft.target === CSS_TARGET) {
        const problem = checkSelectorLive(draft.selector);
        if (problem) found.selector = problem;
      }
    }
    return found;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length || !draft.event || !draft.trigger) return;
    const input = {
      event: draft.event,
      trigger: draft.trigger,
      value: kind ? Number(draft.value) : null,
      selector,
      pageId: draft.pageId === ALL_PAGES ? null : draft.pageId,
    };
    const opts = {
      silentError: true,
      onError: (message: string, field?: string) => {
        if (field && ["event", "trigger", "value", "selector", "pageId"].includes(field)) {
          setErrors({ [field]: message });
        } else toast.error(message);
      },
      onSuccess: () => onOpenChange(false),
    };
    if (rule) void update.run({ id: rule.id, ...input }, { ...opts, success: "Regra salva." });
    else void create.run({ offerId, ...input, enabled: true }, { ...opts, success: "Regra criada." });
  }

  const eventInfo = draft.event ? eventParts(draft.event) : null;
  const liveSelectorError =
    draft.trigger === "ELEMENT_CLICK" && draft.target === CSS_TARGET && draft.selector.trim()
      ? checkSelectorLive(draft.selector)
      : null;
  const selectorError = errors.selector ?? liveSelectorError ?? undefined;
  const pageName = draft.pageId === ALL_PAGES ? null : pages.find((p) => p.id === draft.pageId)?.name;
  const purchaseEverywhere = draft.event === "PURCHASE" && draft.trigger === "PAGE_LOAD" && draft.pageId === ALL_PAGES;
  const summaryReady = eventInfo && draft.trigger && !Object.keys(validate()).length;

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{rule ? "Editar regra" : "Nova regra de evento"}</DialogTitle>
          <DialogDescription>
            O evento vai para todos os pixels ativos da oferta, cada um com o nome da própria plataforma.
          </DialogDescription>
        </DialogHeader>

        <form id={`${ids}-form`} noValidate onSubmit={submit}>
          <FieldGroup className="gap-5">
            <Field data-invalid={Boolean(errors.event)}>
              <FieldLabel htmlFor={`${ids}-event`}>Evento</FieldLabel>
              <Select value={draft.event} onValueChange={chooseEvent}>
                <SelectTrigger id={`${ids}-event`} className="w-full" aria-invalid={Boolean(errors.event)}>
                  <SelectValue placeholder="Escolha o evento" />
                </SelectTrigger>
                <SelectContent>
                  {RULE_EVENTS.map((ev) => {
                    const { title, code } = eventParts(ev);
                    return (
                      <SelectItem key={ev} value={ev}>
                        {title} ({code})
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <FieldDescription>
                O PageView não aparece aqui: ele dispara sozinho ao abrir cada página.
              </FieldDescription>
              <FieldError>{errors.event}</FieldError>
            </Field>

            <Field data-invalid={Boolean(errors.trigger)}>
              <FieldLabel htmlFor={`${ids}-trigger`}>Quando dispara</FieldLabel>
              <Select value={draft.trigger} onValueChange={chooseTrigger}>
                <SelectTrigger id={`${ids}-trigger`} className="w-full" aria-invalid={Boolean(errors.trigger)}>
                  <SelectValue placeholder="Escolha quando" />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TRIGGERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {EVENT_TRIGGER_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {draft.trigger === "CHECKOUT_CLICK" && (
                <FieldDescription>
                  Vale para os links da oferta do tipo checkout e para os checkouts reconhecidos (Hotmart, Kiwify,
                  Eduzz, Monetizze…).
                </FieldDescription>
              )}
              {draft.trigger === "FORM_SUBMIT" && (
                <FieldDescription>
                  Vale para o formulário de captura do editor (depois de validar os campos) e para outros formulários da
                  página.
                </FieldDescription>
              )}
              <FieldError>{errors.trigger}</FieldError>
            </Field>

            {kind && (
              <Field data-invalid={Boolean(errors.value)}>
                <FieldLabel htmlFor={`${ids}-value`}>
                  {kind === "seconds" ? "Segundos na página" : "Quanto da página (%)"}
                </FieldLabel>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id={`${ids}-value`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={kind === "seconds" ? 86_400 : 100}
                    step={1}
                    value={draft.value}
                    aria-invalid={Boolean(errors.value)}
                    className="w-28"
                    onChange={(e) => patch({ value: e.target.value }, ["value"])}
                  />
                  <span className="text-sm text-muted-foreground">{kind === "seconds" ? "segundos" : "%"}</span>
                  {kind === "percent" && (
                    <fieldset className="flex gap-1" aria-label="Porcentagens comuns">
                      {[25, 50, 75, 90].map((p) => (
                        <Button
                          key={p}
                          type="button"
                          size="sm"
                          variant={draft.value === String(p) ? "secondary" : "ghost"}
                          onClick={() => patch({ value: String(p) }, ["value"])}
                        >
                          {p}%
                        </Button>
                      ))}
                    </fieldset>
                  )}
                </div>
                <FieldError>{errors.value}</FieldError>
              </Field>
            )}

            {draft.trigger === "ELEMENT_CLICK" && (
              <Field data-invalid={Boolean(selectorError)}>
                <FieldLabel htmlFor={`${ids}-target`}>O que a pessoa clica</FieldLabel>
                <Select value={draft.target} onValueChange={(v) => patch({ target: v }, ["selector"])}>
                  <SelectTrigger id={`${ids}-target`} className="w-full" aria-invalid={Boolean(selectorError)}>
                    <SelectValue placeholder="Escolha o link ou elemento" />
                  </SelectTrigger>
                  <SelectContent>
                    {links.map((l) => (
                      <SelectItem key={l.id} value={`link:${l.key}`}>
                        Clique no link da oferta: {l.label}
                        {LINK_KIND_LABEL[l.kind] && LINK_KIND_LABEL[l.kind] !== l.label && (
                          <span className="text-muted-foreground"> · {LINK_KIND_LABEL[l.kind]}</span>
                        )}
                      </SelectItem>
                    ))}
                    <SelectItem value={CSS_TARGET}>Outro elemento (seletor CSS, avançado)</SelectItem>
                  </SelectContent>
                </Select>
                {links.length === 0 && (
                  <FieldDescription>
                    Esta oferta ainda não tem links. Cadastre o checkout ou o WhatsApp na aba “Links e checkouts” e
                    ligue os botões a eles no editor — ou use um seletor CSS.
                  </FieldDescription>
                )}
                {draft.target.startsWith("link:") && (
                  <FieldDescription>
                    Dispara ao clicar em qualquer botão ligado a esse link, em qualquer página escolhida abaixo.
                  </FieldDescription>
                )}
                {draft.target === CSS_TARGET && (
                  <div className="flex flex-col gap-1.5">
                    <Input
                      id={`${ids}-selector`}
                      aria-label="Seletor CSS"
                      value={draft.selector}
                      maxLength={300}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="#botao-comprar, .cta ou a[href*='wa.me']"
                      className="font-mono"
                      aria-invalid={Boolean(selectorError)}
                      onChange={(e) => patch({ selector: e.target.value }, ["selector"])}
                    />
                    <FieldDescription>
                      Para quem conhece CSS: o evento dispara ao clicar no elemento (ou em algo dentro dele).
                    </FieldDescription>
                  </div>
                )}
                <FieldError>{selectorError}</FieldError>
              </Field>
            )}

            <Field data-invalid={Boolean(errors.pageId)}>
              <FieldLabel htmlFor={`${ids}-page`}>Em quais páginas</FieldLabel>
              <Select
                value={draft.pageId}
                onValueChange={(v) => {
                  setTouched((t) => ({ ...t, page: true }));
                  patch({ pageId: v }, ["pageId"]);
                }}
              >
                <SelectTrigger id={`${ids}-page`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_PAGES}>Todas as páginas da oferta</SelectItem>
                  {pages.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      <span className="text-muted-foreground">
                        {" "}
                        · {PAGE_TYPE_LABEL[p.type as keyof typeof PAGE_TYPE_LABEL] ?? p.type}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError>{errors.pageId}</FieldError>
            </Field>

            {purchaseEverywhere && (
              <Callout variant="warning">
                Assim, toda visita a qualquer página conta como compra. Escolha só a página de obrigado.
              </Callout>
            )}

            {summaryReady && eventInfo && draft.trigger && (
              <p
                className={cn("rounded-lg bg-muted/60 px-3 py-2 text-sm")}
                aria-live="polite"
                data-testid="rule-summary"
              >
                <span className="font-medium">{eventInfo.code}</span> dispara{" "}
                {lowerFirst(
                  ruleTriggerText(
                    { trigger: draft.trigger, value: kind ? Number(draft.value) : null, selector },
                    links,
                  ),
                )}
                {pageName ? `, na página “${pageName}”.` : ", em todas as páginas."}
              </p>
            )}
          </FieldGroup>
        </form>

        <DialogFooter className="-mx-6 -mb-6 -bottom-6 sticky rounded-b-lg border-t bg-background px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form={`${ids}-form`} disabled={pending}>
            {pending && <Spinner />}
            {rule ? "Salvar regra" : "Criar regra"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
