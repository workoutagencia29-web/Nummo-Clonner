import type { TrackingSettings } from "@/lib/tracking/schema";
import { cn } from "@/lib/utils";

type Consent = TrackingSettings["consent"];

/**
 * Prévia do aviso de cookies (só visual, sem scripts), com as mesmas cores,
 * posições e botões do banner de verdade (src/runtime/tracking/consent.ts).
 */
export function ConsentPreview({ consent, hasPolicy }: { consent: Consent; hasPolicy: boolean }) {
  const light = consent.theme === "light";
  const notice = consent.mode === "NOTICE";
  const corner = consent.position !== "bottom";
  return (
    <figure className="flex flex-col gap-2" aria-label="Prévia do aviso de cookies">
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-lg border bg-white shadow-xs">
        <div className="flex h-6 items-center gap-1.5 border-b bg-zinc-100 px-2">
          <span className="size-2 rounded-full bg-zinc-300" />
          <span className="size-2 rounded-full bg-zinc-300" />
          <span className="size-2 rounded-full bg-zinc-300" />
          <span className="ml-2 h-3 flex-1 rounded bg-white" />
        </div>
        <div className="flex flex-col gap-2 p-4" aria-hidden="true">
          <div className="h-4 w-2/3 rounded bg-zinc-200" />
          <div className="h-3 w-5/6 rounded bg-zinc-100" />
          <div className="h-3 w-4/6 rounded bg-zinc-100" />
          <div className="mt-2 h-6 w-28 rounded bg-zinc-300" />
        </div>
        {consent.mode === "OFF" ? (
          <p className="absolute inset-x-3 bottom-3 rounded-md border border-dashed border-zinc-300 bg-white/90 p-2 text-center text-xs text-zinc-500">
            Sem aviso de cookies
          </p>
        ) : (
          <div
            data-testid="consent-preview-banner"
            data-position={consent.position}
            data-theme={consent.theme}
            className={cn(
              "absolute bottom-2 flex flex-wrap items-center gap-2 rounded-lg p-2.5 text-[11px] leading-snug shadow-lg",
              light ? "border border-zinc-200 bg-white text-zinc-900" : "bg-[#111827] text-white",
              consent.position === "bottom" && "inset-x-2",
              consent.position === "bottom-left" && "left-2 w-[58%]",
              consent.position === "bottom-right" && "right-2 w-[58%]",
            )}
          >
            <p className={cn("min-w-0", corner ? "basis-full" : "flex-1 basis-40")}>
              {consent.text || "Texto do aviso"}{" "}
              {hasPolicy && <span className="underline">{consent.policyLabel || "Política de privacidade"}</span>}
            </p>
            <div className="ml-auto flex gap-1.5">
              {/* Recusar e Aceitar com o mesmo destaque, como no banner de verdade. */}
              {(notice
                ? [consent.noticeLabel || "Entendi"]
                : [consent.rejectLabel || "Recusar", consent.acceptLabel || "Aceitar"]
              ).map((label, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: dois botões fixos (os textos podem ser iguais)
                  key={i}
                  className={cn(
                    "rounded-md border px-2 py-1 font-semibold",
                    light ? "border-[#111827] bg-[#111827] text-white" : "border-white bg-white text-[#111827]",
                  )}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <figcaption className="text-xs text-muted-foreground">
        Prévia aproximada. Veja o aviso de verdade em “Testar pixels” ou na prévia da página.
      </figcaption>
    </figure>
  );
}
