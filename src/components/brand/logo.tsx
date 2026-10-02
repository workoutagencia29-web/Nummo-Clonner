import { cn } from "@/lib/utils";

/** Marca do Offer Studio: ícone + nome. */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          aria-hidden="true"
        >
          <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" strokeLinejoin="round" />
          <path d="M8.5 12.5 11 15l4.5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {!compact && <span className="text-[15px]">Offer Studio</span>}
    </span>
  );
}
