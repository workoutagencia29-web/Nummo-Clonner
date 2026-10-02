import { Skeleton } from "@/components/ui/skeleton";

const CARD_KEYS = ["a", "b"];

export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Carregando o teste de pixels…</span>
      <Skeleton className="h-4 w-64" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col gap-4">
          {CARD_KEYS.map((key) => (
            <Skeleton key={key} className="h-48 w-full rounded-xl" />
          ))}
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
