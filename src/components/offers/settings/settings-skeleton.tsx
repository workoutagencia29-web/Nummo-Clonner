import { Skeleton } from "@/components/ui/skeleton";

const FIELDS = ["a", "b", "c", "d"];

/** Esqueleto da aba "Empresa e SEO" enquanto os dados carregam. */
export function OfferSettingsSkeleton() {
  return (
    <div className="flex max-w-5xl flex-col gap-6" aria-busy="true">
      <span className="sr-only">Carregando dados da empresa e SEO…</span>
      {["empresa", "seo"].map((card) => (
        <div key={card} className="flex flex-col gap-5 rounded-xl border p-6">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full max-w-md" />
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map((k) => (
              <div key={k} className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
