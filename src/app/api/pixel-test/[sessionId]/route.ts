import { toUserMessage, UserError } from "@/lib/errors";
import { guardApi } from "@/server/api";
import { listPixelTestEvents } from "@/server/services/pixel-test";

export const dynamic = "force-dynamic";

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const GONE = "Este teste não existe mais. Comece um novo teste.";

/** `after` da URL: número inteiro ≥ 0 (vazio = 0). null = inválido. */
function afterOf(value: string | null): number | null {
  if (value === null || value === "") return 0;
  if (!/^\d{1,12}$/.test(value)) return null;
  return Number(value);
}

/**
 * Tela "Testar pixels": passos recebidos da página de teste desde `after`
 * (GET /api/pixel-test/<sessão>?after=<último id>). O painel chama a cada 1,5 s
 * enquanto a aba está visível. Resposta: { session, events, lastId }.
 */
export async function GET(req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { sessionId } = await ctx.params;
  const headers = { "Cache-Control": "no-store" };
  if (!SESSION_ID_RE.test(sessionId)) return Response.json({ error: GONE }, { status: 404, headers });
  const after = afterOf(new URL(req.url).searchParams.get("after"));
  if (after === null) return Response.json({ error: "Parâmetro inválido." }, { status: 400, headers });
  try {
    return Response.json(await listPixelTestEvents(sessionId, after), { headers });
  } catch (err) {
    // O serviço só lança UserError quando a sessão sumiu (oferta excluída ou limpeza).
    if (err instanceof UserError) return Response.json({ error: err.message }, { status: 404, headers });
    console.error("[testar pixels] listar passos:", err);
    return Response.json({ error: toUserMessage(err).message }, { status: 500, headers });
  }
}
