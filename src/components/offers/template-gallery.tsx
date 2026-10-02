"use client";

import { CheckIcon, PlusIcon, ScaleIcon } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { TEMPLATE_SUMMARIES, templateSummary, thumbnailUrl } from "@/editor/templates/catalog";
import type { TemplateSummary } from "@/editor/templates/types";
import { cn } from "@/lib/utils";

/** Valor do cartão "Em branco" na galeria. */
export const BLANK_TEMPLATE = "em-branco";

/** Modelos que fazem sentido como primeira página de uma oferta (sem as páginas legais). */
export const OFFER_START_TEMPLATES: readonly TemplateSummary[] = TEMPLATE_SUMMARIES.filter(
  (t) => t.pageType !== "LEGAL",
);

/** Modelo já escolhido ao criar uma oferta: a página de vendas completa. */
export const DEFAULT_OFFER_TEMPLATE = "vendas-longa";

const cardClass =
  "group relative flex flex-col overflow-hidden rounded-lg border bg-card text-left shadow-xs outline-none transition-[border-color,box-shadow] hover:border-foreground/25 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=checked]:border-primary data-[state=checked]:ring-1 data-[state=checked]:ring-primary";

/** Card da galeria (um item de rádio: setas do teclado navegam entre os modelos). */
function TemplateCard({
  value,
  name,
  description,
  preview,
}: {
  value: string;
  name: string;
  description: string;
  preview: React.ReactNode;
}) {
  return (
    <RadioGroupPrimitive.Item value={value} className={cardClass} aria-label={name} title={description}>
      <span className="block aspect-[4/3] overflow-hidden border-b bg-muted">{preview}</span>
      <span className="flex flex-col gap-0.5 p-2.5">
        <span className="text-sm font-medium leading-snug">{name}</span>
        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{description}</span>
      </span>
      <RadioGroupPrimitive.Indicator className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
        <CheckIcon className="size-3.5" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

/** Miniatura do modelo (SVG embutido). */
export function TemplateThumbnail({ template, className }: { template: TemplateSummary; className?: string }) {
  return (
    // biome-ignore lint/performance/noImgElement: miniatura SVG embutida (data:), sem otimização a fazer
    <img src={thumbnailUrl(template)} alt="" className={cn("size-full object-cover", className)} draggable={false} />
  );
}

/**
 * Galeria de modelos (rádio com miniaturas), usada no "Nova página" e no
 * "Nova oferta": os dois mostram os modelos do mesmo jeito.
 */
export function TemplateGallery({
  value,
  onValueChange,
  templates = TEMPLATE_SUMMARIES,
  label,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  templates?: readonly TemplateSummary[];
  /** Nome acessível do grupo ("Modelo da página"). */
  label: string;
  className?: string;
}) {
  const selected = value === BLANK_TEMPLATE ? undefined : templateSummary(value);
  return (
    <div className="flex flex-col gap-3">
      <RadioGroupPrimitive.Root
        value={value}
        onValueChange={onValueChange}
        aria-label={label}
        className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5", className)}
      >
        <TemplateCard
          value={BLANK_TEMPLATE}
          name="Em branco"
          description="Comece do zero e monte a página com os blocos."
          preview={
            <span className="grid size-full place-items-center bg-background">
              <span className="grid size-10 place-items-center rounded-full border border-dashed text-muted-foreground">
                <PlusIcon className="size-5" />
              </span>
            </span>
          }
        />
        {templates.map((t) => (
          <TemplateCard
            key={t.id}
            value={t.id}
            name={t.name}
            description={t.description}
            preview={<TemplateThumbnail template={t} />}
          />
        ))}
      </RadioGroupPrimitive.Root>

      {selected?.notice && (
        <div
          role="note"
          className="flex gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200"
        >
          <ScaleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{selected.notice}</p>
        </div>
      )}
    </div>
  );
}
