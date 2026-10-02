/** Rótulos em português para os valores guardados no banco. */

export const OFFER_STATUS_LABEL = {
  DRAFT: "Rascunho",
  LIVE: "No ar",
  ARCHIVED: "Arquivada",
} as const;

export const PAGE_TYPE_LABEL = {
  SALES: "Página de vendas",
  VSL: "VSL",
  ADVERTORIAL: "Advertorial",
  QUIZ: "Quiz",
  CAPTURE: "Captura",
  UPSELL: "Upsell",
  DOWNSELL: "Downsell",
  THANK_YOU: "Obrigado",
  LEGAL: "Política / Termos",
  OTHER: "Outra",
} as const;

export const TAG_COLOR_LABEL = {
  slate: "Cinza",
  red: "Vermelho",
  orange: "Laranja",
  amber: "Amarelo",
  green: "Verde",
  teal: "Turquesa",
  blue: "Azul",
  indigo: "Anil",
  violet: "Violeta",
  pink: "Rosa",
} as const;

/** Classes Tailwind (escritas por extenso para o Tailwind encontrá-las). */
export const TAG_COLOR_CLASS: Record<keyof typeof TAG_COLOR_LABEL, { chip: string; dot: string }> = {
  slate: { chip: "bg-slate-500/12 text-slate-700 dark:text-slate-300", dot: "bg-slate-500" },
  red: { chip: "bg-red-500/12 text-red-700 dark:text-red-300", dot: "bg-red-500" },
  orange: { chip: "bg-orange-500/12 text-orange-700 dark:text-orange-300", dot: "bg-orange-500" },
  amber: { chip: "bg-amber-500/15 text-amber-800 dark:text-amber-300", dot: "bg-amber-500" },
  // green-700 sobre o fundo verde claro fica abaixo de 4,5:1 com 11 px (WCAG AA).
  green: { chip: "bg-green-500/12 text-green-800 dark:text-green-300", dot: "bg-green-500" },
  teal: { chip: "bg-teal-500/12 text-teal-700 dark:text-teal-300", dot: "bg-teal-500" },
  blue: { chip: "bg-blue-500/12 text-blue-700 dark:text-blue-300", dot: "bg-blue-500" },
  indigo: { chip: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300", dot: "bg-indigo-500" },
  violet: { chip: "bg-violet-500/12 text-violet-700 dark:text-violet-300", dot: "bg-violet-500" },
  pink: { chip: "bg-pink-500/12 text-pink-700 dark:text-pink-300", dot: "bg-pink-500" },
};

export function tagColorClass(color: string) {
  return TAG_COLOR_CLASS[color as keyof typeof TAG_COLOR_CLASS] ?? TAG_COLOR_CLASS.slate;
}
