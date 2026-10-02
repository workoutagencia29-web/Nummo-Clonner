import "server-only";
import { auth } from "@/lib/auth";

/**
 * Checagens comuns das rotas de API: endereço do próprio painel (contra DNS
 * rebinding, já que algumas rotas ficam fora do proxy por causa do tamanho do
 * corpo) e login. Devolve uma Response de erro ou null quando está tudo certo.
 */
export async function guardApi(req: Request): Promise<Response | null> {
  const port = process.env.PORT || "3000";
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) {
    return Response.json({ error: "Endereço não permitido." }, { status: 403 });
  }
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "Sua sessão expirou. Entre de novo." }, { status: 401 });
  return null;
}

/** Corpo JSON com limite de tamanho (mensagem clara em vez de travar). */
export async function readJson<T>(req: Request, maxBytes: number): Promise<T | Response> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    return Response.json({ error: "Conteúdo grande demais para salvar." }, { status: 413 });
  }
  const text = await req.text();
  if (text.length > maxBytes) {
    return Response.json({ error: "Conteúdo grande demais para salvar." }, { status: 413 });
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return Response.json({ error: "Dados inválidos." }, { status: 400 });
  }
}
