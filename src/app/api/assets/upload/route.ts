import { toUserMessage } from "@/lib/errors";
import { guardApi } from "@/server/api";
import {
  AssetError,
  IMAGE_UPLOAD_LIMITS,
  type ImageUploadInput,
  importOfferImageFromUrl,
  saveOfferImages,
} from "@/server/services/assets";

export const dynamic = "force-dynamic";

/** Corpo máximo: 20 arquivos de 15 MB + folga para os campos do formulário. */
const MAX_BODY_BYTES = IMAGE_UPLOAD_LIMITS.maxFiles * IMAGE_UPLOAD_LIMITS.maxFileBytes + 1024 * 1024;
const TOO_BIG = "Envio grande demais: mande no máximo 20 imagens de até 15 MB cada.";
const NO_STORE = { "Cache-Control": "no-store" };

function fail(error: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ error, ...extra }, { status, headers: NO_STORE });
}

class BodyTooLarge extends Error {}

/** Lê o multipart com limite de tamanho (sem Content-Length, conta no caminho). */
async function readForm(req: Request): Promise<FormData> {
  if (!req.body) throw new TypeError("sem corpo");
  let received = 0;
  const limited = req.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > MAX_BODY_BYTES) controller.error(new BodyTooLarge());
        else controller.enqueue(chunk);
      },
    }),
  );
  const copy = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "content-type": req.headers.get("content-type") ?? "" },
    body: limited,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  try {
    return await copy.formData();
  } catch (err) {
    if (received > MAX_BODY_BYTES || err instanceof BodyTooLarge) throw new BodyTooLarge();
    throw err;
  }
}

function isFile(value: FormDataEntryValue): value is File {
  return typeof value !== "string";
}

/**
 * Upload de imagens do editor (gerenciador de imagens do GrapesJS).
 * multipart/form-data: "files" (ou "files[]"/"file") + "offerId" (ou ?offerId=).
 * Com o campo "url" (e sem arquivos), baixa a imagem desse link (botão "Usar link").
 * Resposta: { data: [{ type: "image", src, name, width, height, bytes }], errors? }.
 * Se nenhuma imagem der certo: { error, errors } com o status do problema.
 */
export async function POST(req: Request) {
  const denied = await guardApi(req);
  if (denied) return denied;

  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("multipart/form-data")) {
    return fail("Envio inválido. Escolha as imagens pelo editor.", 415);
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail(TOO_BIG, 413);

  let form: FormData;
  try {
    form = await readForm(req);
  } catch (err) {
    if (err instanceof BodyTooLarge) return fail(TOO_BIG, 413);
    return fail("Não foi possível ler o envio. Tente de novo.", 400);
  }

  const fromForm = form.get("offerId");
  const offerId = (typeof fromForm === "string" && fromForm.trim()) || new URL(req.url).searchParams.get("offerId");
  if (!offerId) return fail("Não foi possível identificar a oferta. Recarregue o editor e tente de novo.", 400);

  const files: ImageUploadInput[] = [...form.getAll("files"), ...form.getAll("files[]"), ...form.getAll("file")]
    .filter(isFile)
    .map((file) => ({
      name: file.name,
      size: file.size,
      read: async () => new Uint8Array(await file.arrayBuffer()),
    }));

  // "Usar link": o servidor baixa a imagem e guarda como se fosse enviada.
  const link = form.get("url");
  if (!files.length && typeof link === "string" && link.trim()) {
    try {
      const image = await importOfferImageFromUrl(offerId.trim(), link);
      return Response.json({ data: [image] }, { headers: NO_STORE });
    } catch (err) {
      if (err instanceof AssetError) return fail(err.message, err.status);
      console.error("[imagens] link:", err);
      return fail(toUserMessage(err).message, 500);
    }
  }

  try {
    const result = await saveOfferImages(offerId.trim(), files);
    if (!result.data.length) {
      const [first] = result.errors;
      const statuses = new Set(result.errors.map((e) => e.status));
      const status = statuses.size === 1 ? (first?.status ?? 400) : 400;
      const message =
        result.errors.length === 1
          ? (first?.error ?? "Nenhuma imagem foi enviada.")
          : `Nenhuma das ${result.errors.length} imagens foi enviada. ${first?.error ?? ""}`.trim();
      return fail(message, status, { errors: result.errors });
    }
    const body = result.errors.length ? result : { data: result.data };
    return Response.json(body, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof AssetError) return fail(err.message, err.status);
    console.error("[imagens] upload:", err);
    return fail(toUserMessage(err).message, 500);
  }
}
