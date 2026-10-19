import { Panel } from "@/components/offers/tracking/form-kit";
import { Skeleton } from "@/components/ui/skeleton";
import { upsellPanel } from "@/server/services/upsell";
import { UpsellPanel } from "./upsell-panel";

/** Aba "Upsell": carrega o funil, os produtos (links) e as páginas da oferta. */
export async function UpsellTab({ offerId }: { offerId: string }) {
  const panel = await upsellPanel(offerId);
  return <UpsellPanel offerId={offerId} initial={panel} />;
}

export function UpsellSkeleton() {
  return (
    <Panel className="max-w-5xl">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </Panel>
  );
}
