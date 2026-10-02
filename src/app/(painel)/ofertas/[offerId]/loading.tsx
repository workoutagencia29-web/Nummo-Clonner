import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_KEYS = Array.from({ length: 3 }, (_, i) => `skeleton-${i}`);

export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Carregando oferta…</span>
      <Skeleton className="h-4 w-56" />
      <div className="flex items-start gap-4">
        <Skeleton className="aspect-[16/10] w-24 shrink-0 rounded-lg sm:w-44" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-9 w-full sm:w-[34rem]" />
      <div className="divide-y rounded-xl border">
        {SKELETON_KEYS.map((key) => (
          <div key={key} className="flex items-center gap-3 p-4">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
