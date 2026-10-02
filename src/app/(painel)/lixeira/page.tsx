import type { Metadata } from "next";
import { listTrashedOffers } from "@/server/services/offers";
import { requireSession } from "@/server/session";
import { TrashList } from "./trash-list";

export const metadata: Metadata = { title: "Lixeira" };

export default async function LixeiraPage() {
  await requireSession();
  const offers = await listTrashedOffers();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lixeira</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ofertas apagadas ficam aqui até você restaurar ou excluir de vez.
        </p>
      </div>
      <TrashList
        offers={offers.map((o) => ({
          id: o.id,
          name: o.name,
          thumbnailKey: o.thumbnailKey,
          deletedAt: o.deletedAt as Date,
          pages: o._count.pages,
        }))}
      />
    </div>
  );
}
