import { guardApi } from "@/server/api";
import { getExportView } from "@/server/services/export";

export const dynamic = "force-dynamic";

/** Andamento de um ZIP (ExportView). A tela consulta a cada segundo enquanto ele é gerado. */
export async function GET(req: Request, ctx: RouteContext<"/api/exports/[id]">) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const view = await getExportView(id);
  if (!view) return Response.json({ error: "ZIP não encontrado. Ele pode ter sido apagado." }, { status: 404 });
  return Response.json(view, { headers: { "Cache-Control": "no-store" } });
}
