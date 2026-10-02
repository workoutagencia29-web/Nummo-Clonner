import { tagColorClass } from "@/lib/labels";
import { cn } from "@/lib/utils";

export function TagChip({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-40 items-center truncate rounded-full px-2 text-[11px] font-medium",
        tagColorClass(color).chip,
        className,
      )}
    >
      {name}
    </span>
  );
}
