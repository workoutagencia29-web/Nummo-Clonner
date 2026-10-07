/**
 * Links da oferta como o render (prévia e ZIP) e o rastreamento os usam: link
 * de "Pagamento na página" com o produto salvo vira `pay` (sem endereço).
 */
import type { Prisma } from "@/generated/prisma/client";
import { type Db, prisma } from "@/lib/db";

/** Campos dos links da oferta que o render precisa (ver renderLinks). */
export const RENDER_LINK_SELECT = {
  key: true,
  url: true,
  kind: true,
  target: true,
  payment: { select: { id: true } },
} as const satisfies Prisma.OfferLinkSelect;

type RenderLinkRow = Prisma.OfferLinkGetPayload<{ select: typeof RENDER_LINK_SELECT }>;

/** Link como o render usa: `pay` = abre a janela de pagamento (sem endereço). */
export interface RenderLink {
  key: string;
  url: string;
  kind: string;
  pay: boolean;
}

/**
 * Linhas do banco → links do render. "Pagamento na página" só vale com o
 * produto salvo; sem ele o link fica sem destino (como um link sem URL). O
 * endereço guardado de um link de pagamento nunca vai para a página.
 */
export function renderLinks(rows: RenderLinkRow[]): RenderLink[] {
  return rows.map((r) => {
    const pay = r.target === "PAYMENT" && Boolean(r.payment);
    return { key: r.key, url: r.target === "PAYMENT" ? "" : r.url, kind: r.kind, pay };
  });
}

/** Links da oferta para o render (prévia e ZIP). */
export async function loadRenderLinks(offerId: string, db: Db = prisma): Promise<RenderLink[]> {
  const rows = await db.offerLink.findMany({
    where: { offerId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: RENDER_LINK_SELECT,
  });
  return renderLinks(rows);
}
