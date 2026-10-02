import type * as React from "react";
import { cn } from "@/lib/utils";

/** Cor estável derivada do nome, para a capa das ofertas sem miniatura. */
function hueFromText(text: string) {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

/**
 * Iniciais da capa: só palavras que começam com letra ("Emagrecimento 30D" →
 * "EM", não "E3"); com uma palavra só, as duas primeiras letras dela.
 */
export function initials(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w));
  const letters = words.length >= 2 ? (words[0][0] ?? "") + (words[1][0] ?? "") : (words[0]?.slice(0, 2) ?? "");
  return letters.toUpperCase() || "OS";
}

/**
 * Miniatura da oferta: o print da página (clonadas) ou o esboço do modelo
 * (criadas de um modelo). Sem imagem (oferta em branco), uma capa colorida com
 * as iniciais.
 */
export function OfferThumbnail({
  name,
  thumbnailKey,
  className,
}: {
  name: string;
  thumbnailKey: string | null;
  className?: string;
}) {
  if (thumbnailKey) {
    return (
      // biome-ignore lint/performance/noImgElement: arquivo local servido pela API autenticada
      <img
        src={`/api/files/${thumbnailKey}`}
        alt=""
        loading="lazy"
        className={cn("size-full object-cover object-top", className)}
      />
    );
  }
  const hue = hueFromText(name);
  // Cores pelo matiz do nome; no modo escuro, a mesma capa em tons escuros.
  const vars = { "--os-thumb-h": hue, "--os-thumb-h2": (hue + 40) % 360 } as React.CSSProperties;
  return (
    <div
      className={cn(
        "grid size-full place-items-center",
        "[background:linear-gradient(135deg,oklch(0.93_0.05_var(--os-thumb-h)),oklch(0.85_0.09_var(--os-thumb-h2)))]",
        "dark:[background:linear-gradient(135deg,oklch(0.34_0.06_var(--os-thumb-h)),oklch(0.27_0.08_var(--os-thumb-h2)))]",
        className,
      )}
      style={vars}
      aria-hidden
    >
      <span className="text-3xl font-semibold tracking-tight [color:oklch(0.42_0.12_var(--os-thumb-h))] dark:[color:oklch(0.86_0.08_var(--os-thumb-h))]">
        {initials(name)}
      </span>
    </div>
  );
}
