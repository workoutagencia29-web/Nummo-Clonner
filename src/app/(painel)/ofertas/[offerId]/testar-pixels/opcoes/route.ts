import { buildTestSetup } from "@/components/offers/pixel-test/logic";
import { toUserMessage } from "@/lib/errors";
import { guardApi } from "@/server/api";
import { getTrackingPanel } from "@/server/services/tracking";
import { offerVariantChoices } from "@/server/services/variants";

export const dynamic = "force-dynamic";

const OFFER_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const NOT_FOUND = "Oferta não encontrada. Ela pode ter sido excluída.";

/**
 * Tela "Testar pixels": páginas e versões A/B atuais da oferta
 * (GET /ofertas/<oferta>/testar-pixels/opcoes → { pages }). A tela busca de
 * novo quando o "Iniciar teste" é recusado porque a página ou a versão
 * escolhida foi excluída em outra aba — a lista dela tinha ficado velha.
 */
export async function GET(req: Request, ctx: { params: Promise<{ offerId: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const headers = { "Cache-Control": "no-store" };
  const { offerId } = await ctx.params;
  if (!OFFER_ID_RE.test(offerId)) return Response.json({ error: NOT_FOUND }, { status: 404, headers });
  try {
    const [panel, variants] = await Promise.all([getTrackingPanel(offerId), offerVariantChoices(offerId)]);
    if (!panel) return Response.json({ error: NOT_FOUND }, { status: 404, headers });
    return Response.json({ pages: buildTestSetup(panel, variants).pages }, { headers });
  } catch (err) {
    console.error("[testar pixels] opções:", err);
    return Response.json({ error: toUserMessage(err).message }, { status: 500, headers });
  }
}
