import { toUserMessage } from "@/lib/errors";
import { guardApi } from "@/server/api";
import { restoreVersion } from "@/server/services/documents";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: RouteContext<"/api/documents/[id]/versions/[versionId]/restore">) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id, versionId } = await ctx.params;
  try {
    return Response.json(await restoreVersion(id, versionId));
  } catch (err) {
    return Response.json({ error: toUserMessage(err).message }, { status: 400 });
  }
}
