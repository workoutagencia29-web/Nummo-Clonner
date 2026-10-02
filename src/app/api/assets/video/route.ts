import { toUserMessage } from "@/lib/errors";
import { guardApi } from "@/server/api";
import { AssetError } from "@/server/services/assets";
import { saveOfferVideo } from "@/server/services/video-assets";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function fail(error: string, status: number) {
  return Response.json({ error }, { status, headers: NO_STORE });
}

function headerName(req: Request) {
  const raw = req.headers.get("x-file-name");
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Upload de um vídeo (bloco "Vídeo do arquivo"): o corpo é o próprio arquivo
 * (sem multipart), a oferta vai em ?offerId= e o nome original em X-File-Name
 * (codificado com encodeURIComponent). Fica fora do proxy (src/proxy.ts) para
 * não passar inteiro pela memória.
 * Resposta: { data: [{ type: "video", src, name, bytes }] } ou { error }.
 */
export async function POST(req: Request) {
  const denied = await guardApi(req);
  if (denied) return denied;

  const offerId = new URL(req.url).searchParams.get("offerId")?.trim();
  if (!offerId) return fail("Não foi possível identificar a oferta. Recarregue o editor e tente de novo.", 400);

  try {
    const video = await saveOfferVideo(
      offerId,
      headerName(req),
      req.body,
      Number(req.headers.get("content-length") ?? 0),
    );
    return Response.json({ data: [video] }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof AssetError) return fail(err.message, err.status);
    console.error("[vídeos] upload:", err);
    return fail(toUserMessage(err).message, 500);
  }
}
