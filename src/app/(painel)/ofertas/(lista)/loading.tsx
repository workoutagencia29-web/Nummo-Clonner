import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_KEYS = Array.from({ length: 8 }, (_, i) => `skeleton-${i}`);

export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Carregando ofertas…</span>
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-48" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {SKELETON_KEYS.map((key) => (
          <div key={key} className="overflow-hidden rounded-xl border bg-card">
            <Skeleton className="aspect-[16/10] rounded-none" />
            <div className="space-y-2.5 p-3.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <div className="flex justify-between pt-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
