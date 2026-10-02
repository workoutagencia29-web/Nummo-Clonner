/**
 * Envio de vídeo do computador para o bloco "Vídeo do arquivo": o botão
 * "Enviar vídeo do computador…" (em Configurações) roda o comando
 * VIDEO_PICK_COMMAND, que abre o seletor de arquivos, confere o formato e o
 * tamanho, envia para POST /api/assets/video e coloca o endereço no vídeo.
 * Progresso e erros aparecem em toasts, em português.
 */
import type { Component, Editor } from "grapesjs";
import { toast } from "sonner";
import { VIDEO_PICK_COMMAND } from "@/editor/widgets/video";

export const VIDEO_UPLOAD_URL = "/api/assets/video";

/** Mesmo limite de VIDEO_UPLOAD_LIMITS (src/server/services/video-assets.ts). */
export const CLIENT_VIDEO_MAX_BYTES = 200 * 1024 * 1024;

export const ACCEPTED_VIDEOS = "video/mp4,video/webm,.mp4,.m4v,.webm";

const VIDEO_EXT = /\.(?:mp4|m4v|webm)$/i;
const VIDEO_MIME = /^video\/(?:mp4|webm|x-m4v)$/i;

function formatMb(bytes: number) {
  const mb = Math.ceil((bytes / (1024 * 1024)) * 10) / 10;
  return `${mb.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

/** Problema do arquivo antes de enviar (pt-BR), ou null se pode enviar. */
export function checkVideoFile(file: { name: string; size: number; type: string }): string | null {
  if (!VIDEO_MIME.test(file.type) && !VIDEO_EXT.test(file.name)) {
    return /\.(?:mov|qt)$/i.test(file.name) || /quicktime/i.test(file.type)
      ? `"${file.name}" é um vídeo do QuickTime (.mov), que não toca em todo navegador. Converta para MP4 e envie de novo.`
      : `"${file.name}" não é um vídeo aceito. Envie um arquivo MP4 ou WebM.`;
  }
  if (!file.size) return `"${file.name}" está vazio.`;
  if (file.size > CLIENT_VIDEO_MAX_BYTES) {
    return `"${file.name}" tem ${formatMb(file.size)}. O limite é 200 MB — para vídeos maiores, use um bloco do YouTube, Vimeo, Panda ou VTurb.`;
  }
  return null;
}

/** Envia o vídeo e devolve o endereço guardado (/os-assets/…). Lança Error com mensagem pt-BR. */
export async function uploadVideo(offerId: string, file: File, fetchImpl: typeof fetch = fetch): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(`${VIDEO_UPLOAD_URL}?offerId=${encodeURIComponent(offerId)}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    });
  } catch {
    throw new Error("Não foi possível falar com o Offer Studio. Ele ainda está aberto?");
  }
  const body = (await res.json().catch(() => null)) as { data?: { src?: unknown }[]; error?: unknown } | null;
  const src = body?.data?.[0]?.src;
  if (!res.ok || typeof src !== "string") {
    throw new Error(typeof body?.error === "string" ? body.error : "Não foi possível enviar o vídeo. Tente de novo.");
  }
  return src;
}

function chooseFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPTED_VIDEOS;
    input.style.display = "none";
    const done = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => done(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => done(null), { once: true });
    document.body.append(input);
    input.click();
  });
}

/** Registra o comando de envio de vídeo. Devolve a função que o remove. */
export function configureVideoUpload(editor: Editor, offerId: string): () => void {
  editor.Commands.add(VIDEO_PICK_COMMAND, {
    run: async (_ed: Editor, _sender: unknown, opts: { component?: Component } = {}) => {
      const component = opts.component;
      if (!component) return;
      const file = await chooseFile();
      if (!file) return;
      const problem = checkVideoFile(file);
      if (problem) {
        toast.error(problem);
        return;
      }
      const toastId = toast.loading(`Enviando "${file.name}" (${formatMb(file.size)})…`);
      try {
        const src = await uploadVideo(offerId, file);
        component.addAttributes({ src });
        toast.success("Vídeo enviado.", { id: toastId });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Não foi possível enviar o vídeo.", { id: toastId });
      }
    },
  });
  return () => {
    editor.Commands.remove(VIDEO_PICK_COMMAND);
  };
}
