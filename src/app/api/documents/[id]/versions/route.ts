import { toUserMessage } from "@/lib/errors";
import { guardApi, readJson } from "@/server/api";
import { createVersion, listVersions } from "@/server/services/documents";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/documents/[id]/versions">) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    return Response.json(await listVersions(id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ error: toUserMessage(err).message }, { status: 404 });
  }
}

/**
 * Versão manual (com nome), do estado salvo atual. `openAsIs`: restaurada, abre
 * como está (a versão de antes do reparo de páginas antigas, ver createVersion).
 */
export async function POST(req: Request, ctx: RouteContext<"/api/documents/[id]/versions">) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const body = await readJson<{ label?: string; openAsIs?: boolean }>(req, 10_000);
  if (body instanceof Response) return body;
  const { id } = await ctx.params;
  try {
    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : "Versão salva";
    return Response.json(await createVersion(id, "MANUAL", label, undefined, { openAsIs: body.openAsIs === true }));
  } catch (err) {
    return Response.json({ error: toUserMessage(err).message }, { status: 400 });
  }
}
