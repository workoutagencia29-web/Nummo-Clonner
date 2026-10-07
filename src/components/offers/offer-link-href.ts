/**
 * Endereço de um link da oferta na aba "Links e checkouts" (?link=<id>): a aba
 * abre rolada até ele e com ele em destaque (consertos do "Próximos passos" e
 * dos avisos do ZIP, como "Abrir o link").
 */
export const LINK_QUERY_PARAM = "link";

export function offerLinkHref(offerId: string, linkId: string): string {
  return `/ofertas/${offerId}?aba=links&${LINK_QUERY_PARAM}=${encodeURIComponent(linkId)}`;
}
