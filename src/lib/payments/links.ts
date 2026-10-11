/**
 * Links da oferta como o render (prévia e ZIP) e o rastreamento os usam: link
 * de "Pagamento na página" com o produto salvo vira `pay` (sem endereço);
 * link "Checkout do Offer Studio" com o produto salvo leva à página de
 * checkout (`checkoutHref`, quem renderiza diz o endereço; sem ele, sem destino).
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
  checkout: { select: { id: true } },
} as const satisfies Prisma.OfferLinkSelect;

type RenderLinkRow = Prisma.OfferLinkGetPayload<{ select: typeof RENDER_LINK_SELECT }>;

/**
 * Link como o render usa: `pay` = abre a janela de pagamento (sem endereço);
 * `checkout` = destino "Checkout do Offer Studio" — true com o produto salvo
 * (leva à página de checkout: o endereço dela, em `url`, quando quem
 * renderiza já a tem), false ainda sem o produto (não leva a lugar nenhum).
 * Ausente = outro destino.
 */
export interface RenderLink {
  key: string;
  url: string;
  kind: string;
  pay: boolean;
  checkout?: boolean;
}

export interface RenderLinkOptions {
  /**
   * Endereço da página de checkout do link a partir da página renderizada
   * (prévia: /checkout/<chave>; ZIP: "./checkout/<chave>/" a partir da raiz,
   * trocado pelo relativo de cada página — rebaseCheckoutLinks). Sem ele, o
   * link de checkout fica sem destino.
   */
  checkoutHref?: ((key: string) => string) | null;
}

/**
 * Linhas do banco → links do render. "Pagamento na página" e "Checkout do
 * Offer Studio" só valem com o produto salvo; sem ele o link fica sem destino
 * (como um link sem URL). O endereço guardado de um link de pagamento ou de
 * checkout do Offer Studio nunca vai para a página.
 */
export function renderLinks(rows: RenderLinkRow[], opts: RenderLinkOptions = {}): RenderLink[] {
  return rows.map((r) => {
    const pay = r.target === "PAYMENT" && Boolean(r.payment);
    const checkout = r.target === "CHECKOUT" && Boolean(r.checkout);
    const url = r.target === "URL" ? r.url : checkout && opts.checkoutHref ? opts.checkoutHref(r.key) : "";
    return r.target === "CHECKOUT"
      ? { key: r.key, url, kind: r.kind, pay, checkout }
      : { key: r.key, url, kind: r.kind, pay };
  });
}

/** Links da oferta para o render (prévia e ZIP). */
export async function loadRenderLinks(
  offerId: string,
  db: Db = prisma,
  opts: RenderLinkOptions = {},
): Promise<RenderLink[]> {
  const rows = await db.offerLink.findMany({
    where: { offerId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: RENDER_LINK_SELECT,
  });
  return renderLinks(rows, opts);
}
