/**
 * "Ver checkout" (aba "Links e checkouts"): endereço da página de checkout do
 * link na prévia da oferta (simulação; navega pelo funil até a página de obrigado).
 *
 * Fica à parte de page.ts de propósito: este arquivo entra nas ações do painel
 * (Next), e page.ts puxa o render das páginas, que usa o esbuild — o build de
 * produção do painel falha com ele no caminho.
 */
import { previewCheckoutPath } from "@/lib/checkout/page";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { createPreviewToken, previewUrl } from "@/lib/preview";

export async function checkoutPreviewUrl(linkId: string): Promise<string> {
  const link = await prisma.offerLink.findFirst({
    where: { id: linkId, offer: { deletedAt: null } },
    select: { key: true, offerId: true, target: true, checkout: { select: { id: true } } },
  });
  if (!link) throw new UserError("Link não encontrado.");
  if (link.target !== "CHECKOUT" || !link.checkout) {
    throw new UserError("Salve o checkout deste link antes de ver a página.");
  }
  const token = await createPreviewToken({ kind: "offer", offerId: link.offerId });
  return previewUrl(token, previewCheckoutPath(link.key));
}
