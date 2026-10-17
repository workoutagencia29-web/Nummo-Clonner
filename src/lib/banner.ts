/**
 * Carrossel de banners da loja (data-os-widget="banner"): limites e textos
 * puros, usados tanto no editor (src/editor/widgets/banner-content.ts e
 * banner.ts) quanto no runtime (src/runtime/widgets/banner.ts — só os limites).
 * Sem GrapesJS e sem dependências.
 *
 * Estrutura na página:
 *
 *   section.os-bn[data-os-widget=banner][data-os-autoplay=1][data-os-interval=5]
 *          [data-os-arrows=1][data-os-dots=1]
 *     div.os-bn-wrap
 *       div.os-bn-track[data-os-bn-track]
 *         a.os-bn-slide[href] > img.os-bn-img      (1, 2, 3… banners)
 *       button.os-bn-nav.os-bn-prev / .os-bn-next  (setas; só com JS)
 *     div.os-bn-dots[data-os-bn-dots]              (bolinhas; o runtime preenche)
 *
 * No editor os slides aparecem empilhados (dá para editar cada um); na página
 * publicada viram o carrossel que passa sozinho na horizontal (o runtime liga
 * a classe os-bn-js, cria as bolinhas e cuida do giro).
 */
import type { StoreLang } from "./store";

/** Banners por carrossel (1 = banner único). */
export const BANNER_MIN_SLIDES = 1;
export const BANNER_MAX_SLIDES = 5;

/** Trocar a cada N segundos (padrão, mínimo e máximo). */
export const BANNER_INTERVAL_DEFAULT = 5;
export const BANNER_INTERVAL_MIN = 2;
export const BANNER_INTERVAL_MAX = 30;

/** Textos para leitores de tela (setas e bolinhas), em cada idioma. */
export const BANNER_TEXTS: Record<StoreLang, { prev: string; next: string; goto: string }> = {
  pt: { prev: "Banner anterior", next: "Próximo banner", goto: "Ir para o banner" },
  es: { prev: "Banner anterior", next: "Banner siguiente", goto: "Ir al banner" },
  en: { prev: "Previous banner", next: "Next banner", goto: "Go to banner" },
};

export function bannerTexts(lang: StoreLang) {
  return BANNER_TEXTS[lang] ?? BANNER_TEXTS.pt;
}
