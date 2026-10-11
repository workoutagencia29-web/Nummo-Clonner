"use client";

import { ImageIcon, RefreshCwIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ICO_MAX_BYTES, ICO_NOT_FOR_SHARING, isIcoFile } from "@/lib/ico";
import { cn } from "@/lib/utils";

/** Mesmo limite do envio de imagens do editor (IMAGE_UPLOAD_LIMITS em src/server/services/assets.ts). */
const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml";
/** Ícone da aba também aceita .ico. */
const ACCEPT_WITH_ICON = `${ACCEPT},image/x-icon,image/vnd.microsoft.icon,.ico`;

/**
 * Envia uma imagem para a biblioteca da oferta (/api/assets/upload, a mesma
 * rota do editor) e devolve o endereço dela ("/os-assets/<sha>.webp").
 */
export async function uploadOfferImage(offerId: string, file: File): Promise<{ src: string } | { error: string }> {
  if (file.size > MAX_BYTES) return { error: "A imagem passou de 15 MB. Escolha uma imagem menor." };
  if (isIcoFile(file) && file.size > ICO_MAX_BYTES) {
    return { error: "O ícone .ico passou de 1 MB. Ícones de aba costumam ter poucos KB: exporte de novo, menor." };
  }
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
 * está vazio (a da oferta, no SEO de uma página). `icon` aceita também .ico (só
 * o ícone da aba: nos outros campos o .ico é recusado com o motivo).
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
  icon = false,
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
  icon?: boolean;
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
    if (!icon && isIcoFile(file)) {
      setUploadError(ICO_NOT_FOR_SHARING);
      return;
    }
    setUploading(true);
    const result = await uploadOfferImage(offerId, file);
    setUploading(false);
    if ("error" in result) setUploadError(result.error);
    // Um .ico com outro nome (ex.: "logo.png") só se revela no servidor.
    else if (!icon && /\.ico$/i.test(result.src)) setUploadError(ICO_NOT_FOR_SHARING);
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
        accept={icon ? ACCEPT_WITH_ICON : ACCEPT}
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
