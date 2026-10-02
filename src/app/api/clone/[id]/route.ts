import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCloneStatus } from "@/server/services/clone";

export const dynamic = "force-dynamic";

/** Progresso de uma clonagem (a tela consulta a cada segundo). ?depois=<id do último log> */
export async function GET(req: Request, ctx: RouteContext<"/api/clone/[id]">) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Faça login de novo." }, { status: 401 });
  const { id } = await ctx.params;
  const after = Number(new URL(req.url).searchParams.get("depois") ?? 0) || 0;
  const status = await getCloneStatus(id, after);
  if (!status) return Response.json({ error: "Clonagem não encontrada." }, { status: 404 });
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
