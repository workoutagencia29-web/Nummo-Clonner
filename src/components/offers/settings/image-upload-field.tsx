"use client";

import { ImageIcon, RefreshCwIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** Mesmo limite do envio de imagens do editor (IMAGE_UPLOAD_LIMITS em src/server/services/assets.ts). */
const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml";

/**
 * Envia uma imagem para a biblioteca da oferta (/api/assets/upload, a mesma
 * rota do editor) e devolve o endereço dela ("/os-assets/<sha>.webp").
 */
export async function uploadOfferImage(offerId: string, file: File): Promise<{ src: string } | { error: string }> {
  if (file.size > MAX_BYTES) return { error: "A imagem passou de 15 MB. Escolha uma imagem menor." };
  const form = new FormData();
  form.append("offerId", offerId);
  form.append("files", file);
  let res: Response;
  try {
    res = await fetch("/api/assets/upload", { method: "POST", body: form });
  } catch {
    return { error: "Não foi possível falar com o Offer Studio. Ele ainda está aberto?" };
  }
  let body: { data?: { src?: string }[]; error?: string } | null = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const src = body?.data?.[0]?.src;
  if (!res.ok || !src) return { error: body?.error || "Não foi possível enviar a imagem. Tente de novo." };
  return { src };
}

/**
 * Campo de imagem (favicon ou imagem de compartilhamento): prévia, enviar,
 * trocar e remover. `inheritedSrc` mostra a imagem que vale quando este campo
 * está vazio (a da oferta, no SEO de uma página).
 */
export function ImageUploadField({
  offerId,
  label,
  description,
  value,
  onChange,
  error,
  shape,
  inheritedSrc,
  inheritedLabel = "Usando a da oferta",
  disabled,
}: {
  offerId: string;
  label: string;
  description?: string;
  value: string | null;
  onChange: (src: string | null) => void;
  error?: string;
  shape: "square" | "wide";
  inheritedSrc?: string | null;
  inheritedLabel?: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const shown = value ?? inheritedSrc ?? null;
  const inherited = !value && Boolean(inheritedSrc);
  const problem = uploadError ?? error;

  async function send(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    const result = await uploadOfferImage(offerId, file);
    setUploading(false);
    if ("error" in result) setUploadError(result.error);
    else onChange(result.src);
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 font-medium text-sm">{label}</legend>
      <div className={cn("flex gap-3", shape === "square" ? "flex-wrap items-center" : "flex-col items-start")}>
        <button
          type="button"
          aria-label={value ? `Trocar ${label.toLowerCase()}` : `Enviar ${label.toLowerCase()}`}
          disabled={disabled || uploading}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void send(e.dataTransfer.files[0]);
          }}
          className={cn(
            "relative grid shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted/40 outline-none transition-colors hover:border-foreground/30 focus-visible:ring-[3px] focus-visible:ring-ring/50",
            shape === "square" ? "size-16" : "aspect-[1.91/1] w-full max-w-64",
            !shown && "border-dashed",
            dragging && "border-primary bg-primary/5",
            problem && "border-destructive",
          )}
        >
          {shown ? (
            // biome-ignore lint/performance/noImgElement: imagem da biblioteca da oferta, servida pelo próprio app.
            <img
              src={shown}
              alt=""
              className={cn("size-full object-contain", shape === "wide" && "object-cover", inherited && "opacity-60")}
            />
          ) : (
            <ImageIcon className="size-5 text-muted-foreground" aria-hidden="true" />
          )}
          {uploading && (
            <span className="absolute inset-0 grid place-items-center bg-background/70">
              <Spinner />
            </span>
          )}
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || uploading}
              onClick={() => input.current?.click()}
            >
              {value ? <RefreshCwIcon /> : <UploadIcon />}
              {value ? "Trocar" : inherited ? "Usar outra" : "Enviar imagem"}
            </Button>
            {value && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || uploading}
                onClick={() => {
                  setUploadError(null);
                  onChange(null);
                }}
              >
                <Trash2Icon />
                {inheritedSrc ? "Usar a da oferta" : "Remover"}
              </Button>
            )}
          </div>
          {inherited && <span className="text-xs text-muted-foreground">{inheritedLabel}</span>}
          {description && <span className="text-xs text-muted-foreground">{description}</span>}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={`${label}: escolher arquivo`}
        onChange={(e) => {
          void send(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </fieldset>
  );
}
