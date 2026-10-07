/**
 * Funil em 1 clique "Quiz → Roleta" (tela da oferta): os prêmios que a janela
 * começa mostrando e as regras de cada linha. Sem banco e sem HTML: usado pela
 * tela (src/components/offers/funnel-dialog.tsx) e pelo servidor
 * (src/server/services/funnel.ts).
 */
import { linkUrlProblem, normalizeLinkUrl } from "@/lib/link-url";
import { clampChance, WHEEL_MAX_SLICES, WHEEL_MIN_SLICES } from "@/lib/wheel";

/** Um prêmio da roleta como a janela pede: texto, chance, checkout com o desconto e cupom. */
export interface FunnelPrize {
  /** Texto da fatia ("30% OFF"). */
  text: string;
  /** Peso da fatia (1 a 100). */
  chance: number;
  /** Endereço do checkout com o desconto ("" = preencher depois). */
  url: string;
  /** Cupom mostrado a quem ganhou ("" = sem cupom). */
  coupon: string;
}

export const FUNNEL_MIN_PRIZES = WHEEL_MIN_SLICES;
export const FUNNEL_MAX_PRIZES = WHEEL_MAX_SLICES;
export const PRIZE_TEXT_MAX = 40;
export const PRIZE_COUPON_MAX = 40;

/** Os prêmios de partida (os mesmos do modelo "Roleta"). */
export const FUNNEL_PRIZES: readonly FunnelPrize[] = [
  { text: "10% OFF", chance: 40, url: "", coupon: "" },
  { text: "20% OFF", chance: 30, url: "", coupon: "" },
  { text: "30% OFF", chance: 20, url: "", coupon: "" },
  { text: "50% OFF", chance: 10, url: "", coupon: "" },
];

/** Prêmio novo (botão "＋ Adicionar prêmio"): o próximo desconto da lista, com chance baixa. */
export function nextPrize(prizes: readonly Pick<FunnelPrize, "text">[]): FunnelPrize {
  const taken = new Set(prizes.map((p) => p.text.trim().toUpperCase()));
  const pct = [5, 15, 25, 40, 60, 70, 80, 90].find((n) => !taken.has(`${n}% OFF`));
  return { text: pct ? `${pct}% OFF` : `Prêmio ${prizes.length + 1}`, chance: 10, url: "", coupon: "" };
}

/** Nome do link da oferta criado para o prêmio ("Checkout 30% OFF"). */
export function prizeLinkLabel(text: string) {
  return `Checkout ${text.trim()}`.slice(0, 60);
}

/** Cupom como fica guardado (sem espaços nas pontas; maiúsculas e minúsculas como foram digitadas). */
export function cleanCoupon(coupon: string) {
  return coupon.trim().slice(0, PRIZE_COUPON_MAX);
}

export interface PrizeProblems {
  text?: string;
  url?: string;
}

/**
 * Problemas de uma linha (os mesmos textos do servidor). O endereço em branco
 * vale: o link é criado vazio e o app avisa até ele ser preenchido.
 */
export function prizeProblems(prize: Pick<FunnelPrize, "text" | "url">): PrizeProblems {
  const out: PrizeProblems = {};
  const text = prize.text.trim();
  if (!text) out.text = "Escreva o prêmio (ex.: 30% OFF).";
  else if (text.length > PRIZE_TEXT_MAX) out.text = `O prêmio pode ter no máximo ${PRIZE_TEXT_MAX} caracteres.`;
  const url = normalizeLinkUrl(prize.url);
  const problem = linkUrlProblem(url);
  if (problem) out.url = problem;
  // E-mail e telefone passam no link da oferta, mas o prêmio só leva a um checkout na web.
  else if (url && !/^https?:\/\//i.test(url)) out.url = "Cole o link do checkout com o desconto (https://…).";
  return out;
}

/** Linha arrumada para gravar (chance de 1 a 100, endereço completo, sem espaços nas pontas). */
export function cleanPrize(prize: FunnelPrize): FunnelPrize {
  return {
    text: prize.text.trim().slice(0, PRIZE_TEXT_MAX),
    chance: clampChance(prize.chance),
    url: normalizeLinkUrl(prize.url.trim()),
    coupon: cleanCoupon(prize.coupon),
  };
}

/** “a”, “b” e “c” (até 3 nomes; o resto vira "e mais N"). */
export function quotedList(items: readonly string[]) {
  const names = items.map((t) => `“${t}”`);
  if (names.length > 3) return `${names.slice(0, 3).join(", ")} e mais ${names.length - 3}`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} e ${names.at(-1)}` : (names[0] ?? "");
}

/** Aviso antes de criar outro funil numa oferta que já tem quiz ou roleta (null = não tem). */
export function existingFunnelWarning(existing: { quiz: readonly string[]; wheel: readonly string[] }) {
  const parts: string[] = [];
  if (existing.quiz.length) {
    parts.push(`${existing.quiz.length === 1 ? "um quiz (página" : "quizzes (páginas"} ${quotedList(existing.quiz)})`);
  }
  if (existing.wheel.length) {
    parts.push(
      `${existing.wheel.length === 1 ? "uma roleta (página" : "roletas (páginas"} ${quotedList(existing.wheel)})`,
    );
  }
  if (!parts.length) return null;
  return `Esta oferta já tem ${parts.join(" e ")}. Continuar cria mais um quiz e mais uma roleta, e o quiz novo vira a página inicial.`;
}

/**
 * Página de vendas que a janela sugere: a página inicial (onde o anúncio cai
 * hoje), a não ser que ela já seja um quiz ou uma roleta (funil criado antes);
 * aí, a primeira página de vendas (ou VSL) fora do funil.
 */
export function defaultSalesPage(
  pages: readonly { id: string; isHome: boolean; type: string }[],
  funnelPageIds: readonly string[],
): string {
  const free = pages.filter((p) => !funnelPageIds.includes(p.id));
  const pick =
    free.find((p) => p.isHome) ??
    free.find((p) => p.type === "SALES") ??
    free.find((p) => p.type === "VSL") ??
    free[0] ??
    pages.find((p) => p.isHome) ??
    pages[0];
  return pick?.id ?? "";
}
