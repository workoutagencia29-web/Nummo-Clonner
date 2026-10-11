/**
 * Busca da loja (cabeçalho de loja, src/runtime/widgets/store.ts): o que a
 * pessoa digita (ou o texto da categoria clicada) é comparado com o nome e o
 * selo de cada produto e com o título de cada vitrine (título que bate mostra a
 * vitrine inteira: a categoria "Mais vendidos" mostra a vitrine "Mais
 * vendidos"). Sem dependências: entra no script das páginas (alvo Safari 13) e
 * no servidor (categorias sem destino que não acham nada: src/lib/store-pages.ts).
 *
 * - Minúsculas, sem acentos e sem pontuação ("Fone d'Água" → "fone d agua").
 * - Cada palavra da busca precisa aparecer no nome (em qualquer ordem, também
 *   no meio de outra palavra: "fone" acha "Fone de ouvido").
 * - Plural simples: a palavra vale também sem o "s"/"es" final ("fones" acha
 *   "Fone", "luminárias" acha "Luminária").
 */

/** Parâmetro do endereço com a busca (?busca=fone). */
export const SEARCH_PARAM = "busca";

/** Busca maior que isto é cortada (ninguém digita tanto; evita endereço gigante). */
export const SEARCH_MAX = 100;

/**
 * Textos padrão da linha de resultados (o cabeçalho guarda os dele em
 * data-os-sh-found / -empty / -all, editáveis em Configurações).
 */
export const SEARCH_TEXTS = {
  found: "Resultados para “{busca}”",
  empty: "Nenhum produto encontrado para “{busca}”",
  all: "Ver todos os produtos",
} as const;

/** Texto comparável: minúsculas, sem acentos, só letras e números separados por um espaço. */
export function normalizeSearch(text: string): string {
  let s = String(text || "").toLowerCase();
  // Acentos soltos (U+0300 a U+036F) escritos com escape: o script da página fica só
  // com ASCII nessa expressão — numa hospedagem que serve a página como latin-1, a
  // classe com os caracteres crus viraria um intervalo inválido e derrubaria o script inteiro.
  if (s.normalize) s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return s.replace(/[^a-z0-9]+/g, " ").trim();
}

/** O texto (nome do produto, selo, título da vitrine) bate com a busca? (busca vazia: nada bate.) */
export function matchesSearch(name: string, query: string): boolean {
  const text = normalizeSearch(name);
  const words = normalizeSearch(query).split(" ");
  if (!words[0]) return false;
  for (const w of words) {
    if (text.indexOf(w) >= 0) continue;
    if (w.length > 3 && /es$/.test(w) && text.indexOf(w.slice(0, -2)) >= 0) continue;
    if (w.length > 2 && /s$/.test(w) && text.indexOf(w.slice(0, -1)) >= 0) continue;
    return false;
  }
  return true;
}

/** Texto da linha de resultados: troca {busca} pelo que foi buscado (sem {busca}, vai no fim). */
export function searchMessage(template: string, query: string): string {
  return template.indexOf("{busca}") >= 0 ? template.split("{busca}").join(query) : `${template} “${query}”`;
}
