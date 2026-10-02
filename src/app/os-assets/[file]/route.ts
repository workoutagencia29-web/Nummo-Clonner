import { Readable } from "node:stream";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getObject, mimeFromKey, objectInfo, objectStream } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Arquivos das páginas (/os-assets/<sha256>.<ext>) para o canvas do editor, que
 * roda na origem do painel. Exige login. Nunca executa nada: SVG e HTML vão com
 * CSP "sandbox" e nosniff.
 */
export async function GET(_req: Request, ctx: RouteContext<"/os-assets/[file]">) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Faça login para ver este arquivo.", { status: 401 });
  const { file } = await ctx.params;
  if (!/^[a-f0-9]{64}\.[a-z0-9]{1,8}$/.test(file)) return new Response("Arquivo inválido.", { status: 400 });
  const key = `a/${file.slice(0, 2)}/${file}`;
  const info = await objectInfo(key);
  if (!info) return new Response("Arquivo não encontrado.", { status: 404 });
  // Pequenos vão de uma vez; vídeos grandes, em fluxo (sem carregar tudo na memória).
  const body =
    info.size <= 8 * 1024 * 1024
      ? new Uint8Array(await getObject(key))
      : (Readable.toWeb(objectStream(key)) as ReadableStream);
  return new Response(body, {
    headers: {
      "Content-Type": mimeFromKey(key),
      "Content-Length": String(info.size),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self'; sandbox",
    },
  });
}
