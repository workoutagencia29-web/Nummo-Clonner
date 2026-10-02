import { Badge } from "@/components/ui/badge";
import { OFFER_STATUS_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

type Status = keyof typeof OFFER_STATUS_LABEL;

const DOT: Record<Status, string> = {
  DRAFT: "bg-muted-foreground/60",
  LIVE: "bg-success",
  ARCHIVED: "bg-warning",
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 bg-background/90 backdrop-blur", className)}>
      <span className={cn("size-1.5 rounded-full", DOT[status])} aria-hidden />
      {OFFER_STATUS_LABEL[status]}
    </Badge>
  );
}
