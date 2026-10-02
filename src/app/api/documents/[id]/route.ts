import { toUserMessage } from "@/lib/errors";
import { guardApi, readJson } from "@/server/api";
import { getEditorPayload, RevisionConflictError, saveEditorDocument } from "@/server/services/documents";

export const dynamic = "force-dynamic";

/** Abre a página no editor. */
export async function GET(req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    return Response.json(await getEditorPayload(id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ error: toUserMessage(err).message }, { status: 404 });
  }
}

interface SaveBody {
  revision: number;
  project: unknown;
  html: string;
  css: string;
}

/** Salva (autosave e botão). 409 quando outra aba salvou antes. */
export async function PUT(req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const body = await readJson<SaveBody>(req, 60 * 1024 * 1024);
  if (body instanceof Response) return body;
  if (
    typeof body.revision !== "number" ||
    typeof body.html !== "string" ||
    typeof body.css !== "string" ||
    !body.project
  ) {
    return Response.json({ error: "Dados inválidos." }, { status: 400 });
  }
  const { id } = await ctx.params;
  try {
    return Response.json(await saveEditorDocument({ documentId: id, ...body }));
  } catch (err) {
    if (err instanceof RevisionConflictError) {
      return Response.json({ error: err.message, revision: err.current }, { status: 409 });
    }
    const info = toUserMessage(err);
    if (info.message.startsWith("Algo deu errado")) console.error("[editor] salvar:", err);
    return Response.json({ error: info.message }, { status: 400 });
  }
}
