/**
 * Imagens dos modelos, todas embutidas (data: URI em SVG): os modelos funcionam
 * sem internet e o usuário troca cada uma pela dele com dois cliques no editor.
 */

/** SVG → data: URI (codificado, sem nenhum "http://" solto no HTML). */
export function svgData(svg: string) {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const FONT = "system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif";

function escapeXml(text: string) {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

export type ImageTone = "light" | "dark" | "warm" | "cool";

const TONES: Record<ImageTone, { from: string; to: string; ink: string }> = {
  light: { from: "#eef2f7", to: "#dfe6ef", ink: "#64748b" },
  dark: { from: "#1e293b", to: "#0f172a", ink: "#94a3b8" },
  warm: { from: "#fff7ed", to: "#fde7c7", ink: "#b45309" },
  cool: { from: "#eef2ff", to: "#dbe4ff", ink: "#4f46e5" },
};

/**
 * Imagem de exemplo com o que deve ir no lugar e o tamanho recomendado
 * (ex.: "Foto do produto · 1200 × 800").
 */
export function placeholderImage(label: string, width: number, height: number, tone: ImageTone = "light") {
  const t = TONES[tone];
  const scale = Math.max(0.6, Math.min(width, height) / 360);
  const icon = Math.round(64 * scale);
  const cx = width / 2;
  const cy = height / 2 - 18 * scale;
  const fs = Math.round(Math.max(14, 20 * scale));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.from}"/><stop offset="1" stop-color="${t.to}"/></linearGradient></defs>` +
    `<rect width="${width}" height="${height}" fill="url(#g)"/>` +
    `<g transform="translate(${cx - icon / 2} ${cy - icon / 2})" fill="none" stroke="${t.ink}" stroke-width="${Math.max(2, 3 * scale)}" stroke-linejoin="round" stroke-linecap="round" opacity=".85">` +
    `<rect x="0" y="${icon * 0.1}" width="${icon}" height="${icon * 0.8}" rx="${icon * 0.12}"/>` +
    `<circle cx="${icon * 0.32}" cy="${icon * 0.36}" r="${icon * 0.09}"/>` +
    `<path d="M${icon * 0.06} ${icon * 0.8} L${icon * 0.4} ${icon * 0.52} L${icon * 0.6} ${icon * 0.68} L${icon * 0.74} ${icon * 0.58} L${icon * 0.95} ${icon * 0.76}"/></g>` +
    `<text x="${cx}" y="${cy + icon / 2 + fs * 1.6}" text-anchor="middle" font-family="${FONT}" font-size="${fs}" font-weight="700" fill="${t.ink}">${escapeXml(label)}</text>` +
    `<text x="${cx}" y="${cy + icon / 2 + fs * 2.9}" text-anchor="middle" font-family="${FONT}" font-size="${Math.round(fs * 0.75)}" fill="${t.ink}" opacity=".8">${width} × ${height}</text>` +
    `</svg>`;
  return svgData(svg);
}

const AVATAR_COLORS = ["#c7d2fe", "#fde68a", "#bbf7d0", "#fbcfe8", "#bae6fd", "#fed7aa"];

/** Foto de perfil de exemplo (silhueta), para depoimentos e comentários. */
export function avatarImage(index = 0) {
  const bg = AVATAR_COLORS[index % AVATAR_COLORS.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
    `<rect width="96" height="96" fill="${bg}"/>` +
    `<circle cx="48" cy="38" r="17" fill="#fff" opacity=".9"/>` +
    `<path d="M16 92c3-19 16-29 32-29s29 10 32 29z" fill="#fff" opacity=".9"/></svg>`;
  return svgData(svg);
}

/** Ícones usados no CSS (url(...)). */
export const CSS_ICONS = {
  check: svgData(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  ),
  cross: svgData(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>`,
  ),
  play: svgData(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="46" fill="#ffffff" fill-opacity=".14" stroke="#ffffff" stroke-opacity=".5" stroke-width="2"/><path d="M39 30l28 18-28 18z" fill="#fff"/></svg>`,
  ),
} as const;
