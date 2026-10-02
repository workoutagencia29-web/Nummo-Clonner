import { Readable } from "node:stream";
import { objectStream } from "@/lib/storage";
import { guardApi } from "@/server/api";
import { exportDownload } from "@/server/services/export";

export const dynamic = "force-dynamic";

/** Content-Disposition com o nome do arquivo (ASCII + UTF-8 para nomes com acento). */
function contentDisposition(fileName: string) {
  const ascii = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Baixa o ZIP pronto (em fluxo, sem carregar o arquivo inteiro na memória). */
export async function GET(req: Request, ctx: RouteContext<"/api/exports/[id]/download">) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const found = await exportDownload(id);
  if (!found.ok) return Response.json({ error: found.error }, { status: found.status });
  const stream = objectStream(found.key);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(found.size),
      "Content-Disposition": contentDisposition(found.fileName),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Confere se o ZIP pode ser baixado sem mandar o arquivo (o painel pergunta
 * antes de baixar: se o arquivo sumiu, mostra o motivo em vez de um download
 * que falha calado). O motivo em português vem no GET.
 */
export async function HEAD(req: Request, ctx: RouteContext<"/api/exports/[id]/download">) {
  const denied = await guardApi(req);
  if (denied) return new Response(null, { status: denied.status });
  const { id } = await ctx.params;
  const found = await exportDownload(id);
  if (!found.ok) return new Response(null, { status: found.status, headers: { "Cache-Control": "no-store" } });
  return new Response(null, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(found.size),
      "Cache-Control": "no-store",
    },
  });
}
