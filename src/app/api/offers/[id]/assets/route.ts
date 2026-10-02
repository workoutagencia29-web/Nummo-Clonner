import { toUserMessage } from "@/lib/errors";
import { guardApi } from "@/server/api";
import { AssetError, listOfferImages } from "@/server/services/assets";

export const dynamic = "force-dynamic";

/**
 * Imagens da oferta para o gerenciador de imagens do editor (mais novas primeiro),
 * no formato do GrapesJS: { data: [{ type: "image", src, name, width, height, bytes }] }.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    return Response.json({ data: await listOfferImages(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AssetError) return Response.json({ error: err.message }, { status: err.status });
    console.error("[imagens] listar:", err);
    return Response.json({ error: toUserMessage(err).message }, { status: 500 });
  }
}
