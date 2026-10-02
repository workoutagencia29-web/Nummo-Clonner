"use client";

/**
 * Seletor "Versão A / B / …" da barra do editor (páginas com teste A/B). Não
 * fala com o servidor: quem usa decide como trocar de documento (o editor
 * salva antes de sair; a tela "Preservar JS" só navega).
 */
import { FlagIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type Device = "ALL" | "DESKTOP" | "MOBILE";

export interface SwitcherVariant {
  id: string;
  name: string;
  label?: string | null;
  isControl: boolean;
  weight: number;
  documents: { id: string; device: Device }[];
}

/**
 * Documento da versão `target` que corresponde ao que está aberto: o mesmo
 * aparelho (versão celular → versão celular), senão o documento principal.
 */
export function documentForVariant(target: Pick<SwitcherVariant, "documents">, device: Device): string | null {
  const docs = target.documents;
  const same = docs.find((d) => d.device === device);
  const main = docs.find((d) => d.device === "ALL") ?? docs.find((d) => d.device === "DESKTOP") ?? docs[0];
  return (same ?? main)?.id ?? null;
}

/** "Versão B (controle) · Headline nova · 50% do tráfego". */
function describe(v: SwitcherVariant) {
  return [`Versão ${v.name}${v.isControl ? " (controle)" : ""}`, v.label || null, `${v.weight}% do tráfego no divisor`]
    .filter(Boolean)
    .join(" · ");
}

export function VariantSwitcher({
  variants,
  currentVariantId,
  device,
  onSelect,
  className,
}: {
  variants: readonly SwitcherVariant[] | undefined;
  currentVariantId: string;
  /** Aparelho do documento aberto (para abrir o mesmo na outra versão). */
  device: Device;
  onSelect: (documentId: string, variant: SwitcherVariant) => void;
  className?: string;
}) {
  if (!variants || variants.length < 2) return null;
  return (
    <div className={cn("flex shrink-0 items-center gap-1.5", className)}>
      <span className="hidden text-xs text-muted-foreground 2xl:inline">Versão</span>
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={currentVariantId}
        onValueChange={(value) => {
          if (!value || value === currentVariantId) return;
          const target = variants.find((v) => v.id === value);
          const documentId = target ? documentForVariant(target, device) : null;
          if (target && documentId) onSelect(documentId, target);
        }}
        aria-label="Versão A/B da página"
      >
        {variants.map((v) => (
          <ToggleGroupItem
            key={v.id}
            value={v.id}
            aria-label={`Versão ${v.name}${v.isControl ? ", controle" : ""}`}
            title={describe(v)}
            className="gap-1 px-2.5 font-semibold"
          >
            {v.name}
            {v.isControl && <FlagIcon aria-hidden className="size-3 text-muted-foreground" />}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
