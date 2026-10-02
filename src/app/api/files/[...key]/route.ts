import { Readable } from "node:stream";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getObject, mimeFromKey, objectInfo, objectStream, storagePath } from "@/lib/storage";

/**
 * Entrega arquivos do storage para o painel (miniaturas, uploads).
 * Exige login. Arquivos endereçados por hash nunca mudam → cache longo.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/files/[...key]">) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Faça login para ver este arquivo.", { status: 401 });

  const { key: parts } = await ctx.params;
  // O Next já decodifica cada segmento da URL.
  const key = parts.join("/");
  try {
    storagePath(key);
  } catch {
    return new Response("Arquivo inválido.", { status: 400 });
  }
  const info = await objectInfo(key);
  if (!info) return new Response("Arquivo não encontrado.", { status: 404 });

  const mime = mimeFromKey(key);
  const immutable = key.startsWith("a/");
  // Arquivos pequenos (miniaturas, prints) vão de uma vez; os grandes, em fluxo.
  const body =
    info.size <= 8 * 1024 * 1024
      ? new Uint8Array(await getObject(key))
      : (Readable.toWeb(objectStream(key)) as ReadableStream);
  return new Response(body, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(info.size),
      "Cache-Control": immutable ? "private, max-age=31536000, immutable" : "private, no-cache",
      "X-Content-Type-Options": "nosniff",
      // Arquivos enviados/clonados nunca executam na origem do painel.
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
