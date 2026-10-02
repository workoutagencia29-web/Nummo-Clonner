/**
 * Vídeos enviados pelo editor (bloco "Vídeo do arquivo"). Diferente das
 * imagens, o vídeo não é convertido: fica exatamente como foi enviado (MP4 ou
 * WebM, os formatos que todo navegador toca) e entra na biblioteca da oferta.
 *
 * O arquivo chega em streaming (corpo cru da requisição) e vai direto para o
 * disco, com limite de tamanho — nunca inteiro na memória.
 */
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { uniqueViolationFields } from "@/lib/errors";
import { putFileContentAddressed } from "@/lib/storage";
import { AssetError, assetSrc, cleanFileName } from "@/server/services/assets";

export const VIDEO_UPLOAD_LIMITS = {
  /** Tamanho máximo do arquivo (vídeos maiores: YouTube, Vimeo, Panda ou VTurb). */
  maxFileBytes: 200 * 1024 * 1024,
} as const;

export type VideoFormat = "mp4" | "webm";

const MIME: Record<VideoFormat, string> = { mp4: "video/mp4", webm: "video/webm" };

/** Marcas "ftyp" que são imagens (HEIC/AVIF), não vídeo. */
const IMAGE_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "avif", "avis"]);

export interface LibraryVideo {
  type: "video";
  src: string;
  name: string;
  bytes: number;
}

const TOO_BIG =
  "O vídeo pode ter no máximo 200 MB. Para vídeos maiores, use um bloco do YouTube, Vimeo, Panda ou VTurb.";

function ascii(data: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...data.subarray(start, end));
}

/**
 * Formato pelo conteúdo (não pelo nome). "mov" (QuickTime) e "mkv" são
 * reconhecidos só para dar uma mensagem melhor: não tocam em todo navegador.
 */
export function sniffVideoFormat(head: Uint8Array): VideoFormat | "mov" | "mkv" | null {
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12).toLowerCase();
    if (IMAGE_BRANDS.has(brand)) return null;
    if (brand === "qt  ") return "mov";
    return "mp4";
  }
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    const text = ascii(head, 0, Math.min(head.length, 64));
    if (text.includes("webm")) return "webm";
    if (text.includes("matroska")) return "mkv";
  }
  return null;
}

function unsupportedMessage(name: string, format: "mov" | "mkv" | null) {
  if (format === "mov")
    return `"${name}" é um vídeo do QuickTime (.mov), que não toca em todo navegador. Converta para MP4 e envie de novo.`;
  if (format === "mkv")
    return `"${name}" é um vídeo .mkv, que não toca em todo navegador. Converta para MP4 e envie de novo.`;
  return `"${name}" não é um vídeo aceito. Envie um arquivo MP4 ou WebM.`;
}

class TooLarge extends Error {}

/**
 * Guarda o vídeo enviado na biblioteca da oferta. `declaredBytes` (Content-Length)
 * permite recusar antes de receber; o limite também é conferido no caminho.
 */
export async function saveOfferVideo(
  offerId: string,
  rawName: string | null | undefined,
  body: ReadableStream<Uint8Array> | null,
  declaredBytes = 0,
): Promise<LibraryVideo> {
  const name = cleanFileName(rawName, "video.mp4");
  if (!body) throw new AssetError("Escolha um arquivo de vídeo para enviar.", 400);
  if (declaredBytes > VIDEO_UPLOAD_LIMITS.maxFileBytes) throw new AssetError(TOO_BIG, 413);
  const offer = await prisma.offer.findFirst({ where: { id: offerId, deletedAt: null }, select: { id: true } });
  if (!offer) throw new AssetError("Oferta não encontrada. Ela pode ter sido excluída.", 404);

  const tmpDir = path.join(env.dataDir, "tmp");
  await mkdir(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `${randomUUID()}.video.part`);
  let received = 0;
  let head = new Uint8Array(0);
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      if (received > VIDEO_UPLOAD_LIMITS.maxFileBytes) {
        cb(new TooLarge());
        return;
      }
      if (head.length < 64) {
        const next = new Uint8Array(Math.min(64, head.length + chunk.length));
        next.set(head);
        next.set(chunk.subarray(0, next.length - head.length), head.length);
        head = next;
      }
      cb(null, chunk);
    },
  });

  try {
    try {
      await pipeline(Readable.fromWeb(body as WebReadableStream<Uint8Array>), limiter, createWriteStream(tmp));
    } catch (err) {
      if (err instanceof TooLarge) throw new AssetError(TOO_BIG, 413);
      throw new AssetError("O envio do vídeo foi interrompido. Tente de novo.", 400);
    }
    if (!received) throw new AssetError("O arquivo de vídeo está vazio.", 400);
    const format = sniffVideoFormat(head);
    if (format !== "mp4" && format !== "webm") throw new AssetError(unsupportedMessage(name, format), 415);

    const stored = await putFileContentAddressed(tmp, format);
    const src = assetSrc(stored.key);
    if (!src) throw new Error(`Chave de storage inesperada: ${stored.key}`);
    const fields = { mime: MIME[format], bytes: stored.bytes, originalName: name };
    const upsert = () =>
      prisma.asset.upsert({
        where: { offerId_key: { offerId, key: stored.key } },
        create: { offerId, key: stored.key, sha256: stored.sha256, kind: "VIDEO", ...fields },
        update: { ...fields, kind: "VIDEO", createdAt: new Date() },
        select: { id: true },
      });
    try {
      await upsert();
    } catch (err) {
      // Dois envios iguais ao mesmo tempo: o segundo vira atualização.
      if (!uniqueViolationFields(err).length) throw err;
      await upsert();
    }
    return { type: "video", src, name, bytes: stored.bytes };
  } finally {
    await rm(tmp, { force: true });
  }
}
