"use client";

import { ChevronDownIcon } from "lucide-react";
import { useId, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAction } from "@/hooks/use-action";
import { RULE_EVENTS, type RuleEventId, type TrackingSettings } from "@/lib/tracking/schema";
import { VENDOR_EVENT_NAMES } from "@/lib/tracking/vendors";
import { cn } from "@/lib/utils";
import { saveTrackingSettingsAction } from "@/server/actions/tracking";
import { SaveBar, useDraft } from "./form-kit";
import { EVENT_NAME_VENDORS, type EventNameVendorId, eventNameProblem, eventParts } from "./helpers";
import { VENDOR_VISUAL, VendorIcon } from "./vendor-icon";

type Names = Record<EventNameVendorId, Partial<Record<RuleEventId, string>>>;

function namesFrom(eventNames: TrackingSettings["eventNames"]): Names {
  const out = {} as Names;
  for (const v of EVENT_NAME_VENDORS) {
    out[v] = {};
    for (const e of RULE_EVENTS) {
      const name = eventNames[v]?.[e];
      if (name) out[v][e] = name;
    }
  }
  return out;
}

/** Nomes dos eventos por plataforma (avançado, fechado por padrão). */
export function EventNamesForm({
  offerId,
  eventNames,
}: {
  offerId: string;
  eventNames: TrackingSettings["eventNames"];
}) {
  const initial = namesFrom(eventNames);
  const customized = EVENT_NAME_VENDORS.filter((v) => Object.keys(initial[v]).length).length;
  const [open, setOpen] = useState(customized > 0);
  const [vendor, setVendor] = useState<EventNameVendorId>("META");
  const { draft, setDraft, dirty, reset, commit } = useDraft(initial);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const save = useAction(saveTrackingSettingsAction);
  const ids = useId();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    for (const v of EVENT_NAME_VENDORS) {
      for (const ev of RULE_EVENTS) {
        const problem = eventNameProblem(draft[v][ev] ?? "");
        if (problem) found[`eventNames.${v}.${ev}`] = problem;
      }
    }
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      setVendor(first.split(".")[1] as EventNameVendorId);
      return;
    }
    const payload: Record<string, Record<string, string>> = {};
    for (const v of EVENT_NAME_VENDORS) {
      payload[v] = {};
      for (const ev of RULE_EVENTS) {
        const name = (draft[v][ev] ?? "").trim();
        if (name) payload[v][ev] = name;
      }
    }
    void save.run(
      { offerId, eventNames: payload },
      {
        success: "Nomes dos eventos salvos.",
        silentError: true,
        onError: (message, field) => {
          const key = field ?? "eventNames";
          setErrors({ [key]: message });
          const v = key.split(".")[1];
          if ((EVENT_NAME_VENDORS as readonly string[]).includes(v)) setVendor(v as EventNameVendorId);
        },
        onSuccess: (s) => commit(namesFrom(s.eventNames)),
      },
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border bg-card">
      <CollapsibleTrigger className="flex w-full items-center gap-3 rounded-xl p-4 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:px-6">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-base tracking-tight">Nomes dos eventos (avançado)</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {customized
              ? `Nomes personalizados em ${customized === 1 ? "1 plataforma" : `${customized} plataformas`}.`
              : "Cada plataforma já recebe o nome padrão dela. Troque só se a plataforma mudou o nome ou pediu outro."}
          </p>
        </div>
        <ChevronDownIcon className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <form noValidate onSubmit={submit} className="flex flex-col gap-5 border-t p-4 sm:p-6">
          <ToggleGroup
            type="single"
            variant="outline"
            value={vendor}
            onValueChange={(v) => v && setVendor(v as EventNameVendorId)}
            aria-label="Plataforma"
            className="flex-wrap"
          >
            {EVENT_NAME_VENDORS.map((v) => (
              <ToggleGroupItem key={v} value={v} className="gap-2 px-3">
                <VendorIcon vendor={v} size="sm" className="size-5 rounded [&_svg]:size-3" />
                {VENDOR_VISUAL[v].short}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="grid gap-3">
            {RULE_EVENTS.map((ev) => {
              const def = VENDOR_EVENT_NAMES[vendor][ev] ?? "";
              const key = `eventNames.${vendor}.${ev}`;
              const id = `${ids}-${vendor}-${ev}`;
              const { title } = eventParts(ev);
              return (
                <Field key={key} data-invalid={Boolean(errors[key])} className="gap-1.5">
                  <div className="grid items-center gap-1.5 sm:grid-cols-[14rem_1fr] sm:gap-3">
                    <FieldLabel htmlFor={id} className="font-normal">
                      {title}
                    </FieldLabel>
                    <Input
                      id={id}
                      value={draft[vendor][ev] ?? ""}
                      placeholder={def}
                      maxLength={60}
                      spellCheck={false}
                      autoComplete="off"
                      className="font-mono"
                      aria-label={`Nome do evento ${title} no ${VENDOR_VISUAL[vendor].short}`}
                      aria-invalid={Boolean(errors[key])}
                      onChange={(e) => {
                        const value = e.target.value;
                        setDraft((d) => ({ ...d, [vendor]: { ...d[vendor], [ev]: value } }));
                        setErrors((x) => ({ ...x, [key]: undefined }));
                      }}
                    />
                  </div>
                  <FieldError className="sm:pl-[15rem]">{errors[key]}</FieldError>
                </Field>
              );
            })}
          </div>
          {errors.eventNames && <FieldError>{errors.eventNames}</FieldError>}
          <p className="text-xs text-muted-foreground">
            Campo vazio = nome padrão (o que aparece em cinza). O PageView usa sempre o padrão. Google Ads e UTMify não
            usam estes nomes (o Google Ads usa os rótulos de conversão do pixel).
          </p>
          <SaveBar
            dirty={dirty}
            pending={save.pending}
            onReset={() => {
              reset();
              setErrors({});
            }}
            saveLabel="Salvar nomes"
          />
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}
