/**
 * Cores da página de checkout a partir da cor principal escolhida no painel
 * (contraste WCAG): o texto sobre a cor (branco ou quase preto, o de maior
 * contraste), a cor dos preços sobre o branco (escurecida até 4,5:1) e o aviso
 * do painel quando nenhuma das duas deixa o texto do botão legível. Sem
 * dependências (o painel também usa).
 */

/** Texto escuro sobre cores claras (e o quase preto dos preços sobre o branco). */
const DARK_TEXT = "#0f172a";

function rgbOf(hex: string): [number, number, number] | null {
  const h = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Luminância relativa (WCAG) de uma cor RGB. */
function luminance(rgb: [number, number, number]): number {
  const ch = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Contraste (WCAG, de 1 a 21) entre duas cores #rrggbb. */
export function contrastRatio(a: string, b: string): number {
  const x = rgbOf(a);
  const y = rgbOf(b);
  if (!x || !y) return 1;
  const la = luminance(x);
  const lb = luminance(y);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Cor do texto sobre a cor principal: branco ou quase preto, o de MAIOR contraste. */
export function textOnColor(hex: string): string {
  if (!rgbOf(hex)) return "#ffffff";
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, DARK_TEXT) ? "#ffffff" : DARK_TEXT;
}

/** Contraste mínimo dos textos (WCAG AA para texto normal). */
export const TEXT_CONTRAST_MIN = 4.5;

/**
 * A cor principal deixa o texto do botão legível (4,5:1 com o branco ou com
 * o quase preto)? O painel avisa quando não.
 */
export function colorReadable(hex: string): boolean {
  return !rgbOf(hex) || contrastRatio(hex, textOnColor(hex)) >= TEXT_CONTRAST_MIN;
}

/**
 * Cor dos preços, do total e dos ícones sobre o branco: a cor principal
 * escurecida até ter 4,5:1 com o branco (cores muito claras: o quase preto).
 */
export function darkOnWhite(hex: string): string {
  const rgb = rgbOf(hex);
  if (!rgb || luminance(rgb) > 0.5) return DARK_TEXT;
  let c: [number, number, number] = rgb;
  for (let i = 0; i < 40 && contrastRatio(toHex(c), "#ffffff") < TEXT_CONTRAST_MIN; i++) {
    c = [Math.floor(c[0] * 0.92), Math.floor(c[1] * 0.92), Math.floor(c[2] * 0.92)];
  }
  return toHex(c);
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
