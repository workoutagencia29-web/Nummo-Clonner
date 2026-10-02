import { Skeleton } from "@/components/ui/skeleton";

const NAV = ["a", "b", "c", "d", "e"];
const ROWS = ["a", "b", "c"];

/** Esqueleto da aba "Pixels e rastreamento" enquanto os dados carregam. */
export function TrackingSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Carregando pixels e rastreamento…</span>
      <div className="flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center">
        <div className="flex-1 space-y-3">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-full max-w-lg" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex gap-2 lg:w-60 lg:flex-col">
          {NAV.map((k) => (
            <Skeleton key={k} className="h-10 w-28 lg:w-full" />
          ))}
        </div>
        <div className="flex-1 space-y-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <div className="divide-y rounded-xl border">
            {ROWS.map((k) => (
              <div key={k} className="flex items-center gap-3 p-4">
                <Skeleton className="size-9 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
