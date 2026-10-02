/** Cabeçalho HTTP Range (vídeos na prévia: o Safari só toca vídeos com Range). */

/**
 * Intervalo pedido no cabeçalho Range ("bytes=início-fim"). Só um intervalo;
 * null = arquivo inteiro; "invalid" = fora do arquivo (416).
 */
export function parseByteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | "invalid" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? "").trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    // "bytes=-500": os últimos 500 bytes.
    const suffix = Number(m[2]);
    if (!suffix) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}
