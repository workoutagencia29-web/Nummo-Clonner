import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/format";

type BadgeVariant = "secondary" | "success" | "warning" | "destructive" | "outline";

const STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  QUEUED: { label: "Na fila", variant: "secondary" },
  RUNNING: { label: "Clonando", variant: "secondary" },
  REVIEW: { label: "Pronta para revisar", variant: "warning" },
  SAVED: { label: "Salva", variant: "success" },
  FAILED: { label: "Falhou", variant: "destructive" },
  CANCELED: { label: "Cancelada", variant: "outline" },
};

export interface RecentCloneItem {
  id: string;
  source: string;
  label: string;
  status: string;
  errorCode: string | null;
  createdAt: string;
  offerId: string | null;
  /** A oferta criada está na lixeira. */
  offerTrashed: boolean;
}

/** Selo e destino de cada clonagem, considerando o que aconteceu com a oferta criada. */
export function recentCloneLink(job: RecentCloneItem): { label: string; variant: BadgeVariant; href: string } {
  if (job.status === "SAVED" && job.offerId) {
    return job.offerTrashed
      ? { label: "Oferta na lixeira", variant: "outline", href: "/lixeira" }
      : { ...STATUS.SAVED, href: `/ofertas/${job.offerId}` };
  }
  // A oferta foi excluída de vez: a clonagem pode ser salva de novo.
  if (job.status === "SAVED") return { label: "Oferta excluída", variant: "outline", href: `/clonar/${job.id}` };
  if (job.status === "FAILED" && job.errorCode === "EXPIRED") {
    return { label: "Expirada", variant: "outline", href: `/clonar/${job.id}` };
  }
  return { ...(STATUS[job.status] ?? STATUS.QUEUED), href: `/clonar/${job.id}` };
}

export function RecentClones({ jobs }: { jobs: RecentCloneItem[] }) {
  if (!jobs.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">Clonagens recentes</h2>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {jobs.map((job) => {
          const status = recentCloneLink(job);
          return (
            <li key={job.id}>
              <Link href={status.href} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                <span className="min-w-0 flex-1 truncate">{job.label}</span>
                <Badge variant={status.variant}>{status.label}</Badge>
                <span className="hidden text-xs text-muted-foreground sm:inline" suppressHydrationWarning>
                  {timeAgo(job.createdAt)}
                </span>
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
