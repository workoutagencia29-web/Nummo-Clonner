/**
 * Roleta de desconto na prévia: prêmios de todas as roletas da oferta (a página
 * de vendas usa o prêmio ganho na página da roleta). O ZIP monta o mesmo a
 * partir do HTML que já leu (src/server/services/export/build.ts).
 */
import { prisma } from "@/lib/db";
import { WHEEL_MARK, type WheelRender, wheelRenderData } from "@/lib/wheel-prizes";

/** Mapa de prêmios e botões de checkout da oferta (só lê as páginas com roleta). */
export async function offerWheelRender(
  offerId: string,
  links: { key: string; url: string; kind: string; pay?: boolean }[],
): Promise<WheelRender> {
  const docs = await prisma.pageDocument.findMany({
    where: { variant: { page: { offerId } }, html: { contains: WHEEL_MARK } },
    select: { html: true },
  });
  return wheelRenderData(
    docs.map((d) => d.html),
    links,
    offerId,
  );
}

/** A oferta tem alguma roleta (em qualquer página, versão ou aparelho)? */
export async function offerHasWheel(offerId: string): Promise<boolean> {
  const n = await prisma.pageDocument.count({
    where: { variant: { page: { offerId } }, html: { contains: WHEEL_MARK } },
  });
  return n > 0;
}
