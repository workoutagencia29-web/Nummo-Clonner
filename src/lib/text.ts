/** Remove acentos e baixa a caixa: "Página Ação" → "pagina acao". */
export function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** Chave para unicidade de nomes sem diferenciar maiúsculas/acentos. */
export function nameKey(value: string) {
  return normalizeText(value).replace(/\s+/g, " ");
}

/**
 * Pastas usadas pelo ZIP exportado ou pelo app; uma página não pode ter esses
 * endereços para não colidir com elas: assets/, eventos-dados/ (tokens do
 * eventos.php), as pastas das versões A/B da página inicial (oferta-a/ a
 * oferta-e/) e a da versão celular (celular/).
 */
export const RESERVED_SLUGS = new Set([
  "assets",
  "arquivos",
  "static",
  "api",
  "index",
  "eventos",
  "eventos-dados",
  "_os",
  "celular",
  "oferta-a",
  "oferta-b",
  "oferta-c",
  "oferta-d",
  "oferta-e",
]);

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MAX = 80;

/** Converte um texto em slug: "Página de Obrigado!" → "pagina-de-obrigado". */
export function slugify(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

/** Mensagem de erro se o slug for inválido; null se estiver ok. */
export function slugProblem(slug: string): string | null {
  if (!slug) return "Informe o endereço da página.";
  if (slug.length > SLUG_MAX) return `O endereço pode ter no máximo ${SLUG_MAX} caracteres.`;
  if (!SLUG_PATTERN.test(slug)) return "Use só letras minúsculas, números e hífen (ex.: pagina-de-vendas).";
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" é reservado pelo sistema. Escolha outro endereço.`;
  return null;
}

/**
 * Problema do endereço ao salvar uma página: editando sem trocar o endereço,
 * nenhum (como no servidor, que só confere um endereço novo) — uma página
 * antiga cujo endereço passou a ser reservado continua podendo mudar de nome
 * ou de tipo. `currentSlug`: o endereço salvo (ausente = página nova).
 */
export function pageSlugProblem(slug: string, currentSlug?: string | null): string | null {
  return currentSlug != null && slug === currentSlug ? null : slugProblem(slug);
}

/** Gera um slug livre acrescentando -2, -3… quando já existe. */
export function uniqueSlug(base: string, taken: Iterable<string>) {
  const used = new Set(taken);
  let root = slugify(base) || "pagina";
  if (RESERVED_SLUGS.has(root)) root = `${root}-pagina`;
  if (!used.has(root)) return root;
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    // Sem hífen no fim do corte, senão ficaria "--" (slug inválido).
    const candidate = `${root.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** "Cópia de X", "Cópia de X (2)"… evitando nomes repetidos (máx. 120 caracteres). */
export function copyName(original: string, existing: Iterable<string>, maxLength = 120) {
  const used = new Set([...existing].map(nameKey));
  const full = `Cópia de ${original}`;
  const base = full.slice(0, maxLength).trimEnd();
  if (!used.has(nameKey(base))) return base;
  for (let i = 2; ; i++) {
    const suffix = ` (${i})`;
    const candidate = `${full.slice(0, maxLength - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(nameKey(candidate))) return candidate;
  }
}

/**
 * Separa o número das cópias ("Cópia de Oferta (3)" → "Cópia de Oferta" + "(3)")
 * para o card mostrar o número mesmo quando o nome é cortado.
 */
export function splitCopySuffix(name: string): { base: string; suffix: string | null } {
  const m = /^(.*\S)\s+(\(\d+\))$/.exec(name);
  return m ? { base: m[1], suffix: m[2] } : { base: name, suffix: null };
}

/** Domínio de uma URL para exibir no card ("https://www.x.com/a" → "x.com/a"). */
export function displayUrl(url: string | null | undefined) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const pathPart = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return `${u.hostname.replace(/^www\./, "")}${pathPart}`;
  } catch {
    return url;
  }
}
