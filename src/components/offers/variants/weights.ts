/**
 * Versões A/B de uma página: letras, pasta de cada versão no ZIP e as contas
 * dos percentuais do divisor. Sem dependências de servidor ou de tela: usado
 * pelo serviço (src/server/services/variants.ts), pelo painel e pelo editor.
 */
import { variantFolderName } from "@/lib/export/paths";

/** Cada página tem de 1 a 5 versões, com as letras A a E. */
export const MAX_VARIANTS = 5;
export const VARIANT_NAMES = ["A", "B", "C", "D", "E"] as const;
export type VariantName = (typeof VARIANT_NAMES)[number];

/** Tamanho máximo do nome opcional da versão ("Headline nova"). */
export const VARIANT_LABEL_MAX = 60;

// ─── Mensagens do serviço que a tela reconhece ───────────────────────────────

export const PAGE_NOT_FOUND = "Página não encontrada. Ela pode ter sido excluída.";
export const VARIANT_NOT_FOUND = "Versão não encontrada. Ela pode ter sido excluída.";
/** As versões da página não são as que a tela mostrava (criada ou excluída em outra aba). */
export const LIST_CHANGED = "A lista de versões mudou em outra aba ou janela. Confira e tente de novo.";
/** A divisão salva não é a que a tela mostrava quando a pessoa começou a mexer. */
export const WEIGHTS_CHANGED =
  "A divisão do tráfego foi mudada em outra aba ou janela. Confira os percentuais atuais e salve de novo.";
export const COPY_SOURCE_GONE = "A versão escolhida para copiar não existe mais. Escolha outra.";
export const TOO_MANY_VARIANTS = `Cada página pode ter no máximo ${MAX_VARIANTS} versões (A a E).`;
export const LAST_VARIANT = "A página precisa ter pelo menos uma versão.";

const STALE_ERRORS = new Set([
  PAGE_NOT_FOUND,
  VARIANT_NOT_FOUND,
  LIST_CHANGED,
  WEIGHTS_CHANGED,
  COPY_SOURCE_GONE,
  TOO_MANY_VARIANTS,
  LAST_VARIANT,
]);

/**
 * Erro que só acontece quando a tela está desatualizada (outra aba ou janela
 * criou, excluiu ou mudou versões): a tela "Teste A/B" recarrega a lista.
 * (Na tela, criar com 5 versões e excluir a última nem aparecem como opção.)
 */
export function isStaleVariantsError(message: string | null | undefined): boolean {
  return Boolean(message && STALE_ERRORS.has(message));
}

/** Pasta da versão no ZIP: "A" → "oferta-a" (a mesma regra da montagem do ZIP). */
export function variantFolder(name: string) {
  return variantFolderName(name, 0);
}

/**
 * Letra da próxima versão: a seguinte à maior em uso (A, C → D), para não
 * reaproveitar logo a letra de uma versão excluída (a pasta oferta-b/ na
 * hospedagem e o histórico dela no Meta/GA4 são da versão antiga). Depois do
 * E, a primeira livre. null quando a página já tem 5 versões.
 */
export function nextVariantName(taken: Iterable<string>): VariantName | null {
  const used = new Set(taken);
  const highest = Math.max(-1, ...VARIANT_NAMES.map((n, i) => (used.has(n) ? i : -1)));
  return VARIANT_NAMES.slice(highest + 1).find((n) => !used.has(n)) ?? VARIANT_NAMES.find((n) => !used.has(n)) ?? null;
}

/** "Versão B" ou "Versão B · Headline nova". */
export function variantTitle(v: { name: string; label?: string | null }) {
  return v.label ? `Versão ${v.name} · ${v.label}` : `Versão ${v.name}`;
}

export function weightsTotal(weights: readonly number[]) {
  return weights.reduce((sum, w) => sum + w, 0);
}

/** `total` dividido por igual: 3 versões → [34, 33, 33] (o resto vai para as primeiras). */
export function evenSplit(count: number, total = 100): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const rest = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rest ? 1 : 0));
}

/**
 * `total` repartido na proporção dos pesos atuais (inteiros, pelo maior resto;
 * empate → a primeira). Pesos todos zerados → por igual. Usado ao excluir uma
 * versão: o percentual dela vai para as outras sem mudar a proporção entre elas.
 */
export function proportionalSplit(weights: readonly number[], total = 100): number[] {
  if (!weights.length) return [];
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = weightsTotal(safe);
  if (sum <= 0) return evenSplit(weights.length, total);
  const exact = safe.map((w) => (w * total) / sum);
  const result = exact.map(Math.floor);
  let left = total - weightsTotal(result);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    result[index]++;
    left--;
  }
  return result;
}

/**
 * Percentuais depois de criar uma versão: a nova entra na divisão por igual
 * com as versões ativas (as com tráfego), e as pausadas (0%) continuam
 * pausadas — uma versão parada de propósito (a que perdeu o teste) nunca volta
 * a receber visitas sozinha. Devolve os percentuais das atuais (na ordem) e o
 * da nova. Ex.: 90/10/0 + nova → 34/33/0 e 33.
 */
export function weightsAfterCreate(weights: readonly number[]): { weights: number[]; created: number } {
  const active = weights.map((w, i) => (Number.isFinite(w) && w > 0 ? i : -1)).filter((i) => i >= 0);
  // Sem nenhuma ativa (não deveria acontecer: a soma é 100), todas entram.
  const sharing = active.length ? active : weights.map((_, i) => i);
  const split = evenSplit(sharing.length + 1);
  const next = weights.map(() => 0);
  sharing.forEach((index, i) => {
    next[index] = split[i];
  });
  return { weights: next, created: split[sharing.length] };
}

/**
 * Excluir uma versão: as que ficam (na ordem), os percentuais delas (o da
 * excluída vai para as outras na proporção de cada uma) e a versão de
 * controle depois. Se a excluída era o controle, vira controle a que ficar com
 * o maior percentual (empate: a primeira da lista) — nunca uma versão pausada
 * (0%) enquanto outra recebe o tráfego.
 */
export function afterDelete<T extends { id: string; isControl: boolean; weight: number }>(
  variants: readonly T[],
  deletedId: string,
): { rest: T[]; weights: number[]; control: T | null } {
  const rest = variants.filter((v) => v.id !== deletedId);
  const weights = proportionalSplit(rest.map((v) => v.weight));
  let control = rest.find((v) => v.isControl) ?? null;
  if (!control && rest.length) {
    let best = 0;
    for (let i = 1; i < rest.length; i++) if (weights[i] > weights[best]) best = i;
    control = rest[best];
  }
  return { rest, weights, control };
}

/** Problema com os percentuais, em português (ou null se estiver tudo certo). */
export function weightsProblem(weights: readonly number[]): string | null {
  if (!weights.length) return "Nenhuma versão para dividir o tráfego.";
  if (weights.some((w) => !Number.isInteger(w) || w < 0 || w > 100)) {
    return "Use números inteiros de 0 a 100 em cada versão.";
  }
  const total = weightsTotal(weights);
  if (total !== 100) return `Os percentuais precisam somar 100% (agora somam ${total}%).`;
  return null;
}

function clampWeight(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Soma `diff` aos pesos das versões `targets`, por igual e sem sair de 0–100.
 * Devolve o que não coube (0 quando coube tudo).
 */
function spread(weights: number[], targets: readonly number[], diff: number): number {
  let left = diff;
  const canMove = (i: number) => (left > 0 ? weights[i] < 100 : weights[i] > 0);
  let active = targets.filter(canMove);
  while (left !== 0 && active.length) {
    const share = left > 0 ? Math.floor(left / active.length) : Math.ceil(left / active.length);
    const step = share === 0 ? Math.sign(left) : share;
    for (const i of active) {
      if (left === 0) break;
      const amount = Math.abs(step) > Math.abs(left) ? left : step;
      const next = clampWeight(weights[i] + amount);
      left -= next - weights[i];
      weights[i] = next;
    }
    active = active.filter(canMove);
  }
  return left;
}

/**
 * Muda o percentual da versão `index` e ajusta as outras para a soma continuar
 * 100%. Quem absorve a diferença: primeiro as versões que a pessoa ainda não
 * mexeu (por igual); depois as que ela mexeu há mais tempo. `touched` são os
 * índices já editados, do mais antigo para o mais recente.
 *
 * Ex.: 34/33/33, A → 50: 50/25/25. Depois B → 30: 50/30/20 (A, já escolhida, fica).
 */
export function rebalance(
  weights: readonly number[],
  index: number,
  value: number,
  touched: readonly number[] = [],
): number[] {
  const next = weights.map(clampWeight);
  if (index < 0 || index >= next.length) return next;
  next[index] = clampWeight(value);
  if (next.length === 1) {
    next[0] = 100;
    return next;
  }
  const others = next.map((_, i) => i).filter((i) => i !== index);
  // Mexidas há mais tempo absorvem antes das mexidas agora há pouco (a última ocorrência vale).
  const edited = touched.filter((i, pos) => others.includes(i) && touched.lastIndexOf(i) === pos);
  const untouched = others.filter((i) => !edited.includes(i));
  let diff = 100 - weightsTotal(next);
  diff = spread(next, untouched, diff);
  for (const i of edited) {
    if (diff === 0) break;
    diff = spread(next, [i], diff);
  }
  return next;
}

/** `touched` com `index` passado para o fim (a edição mais recente). */
export function markTouched(touched: readonly number[], index: number): number[] {
  return [...touched.filter((i) => i !== index), index];
}
