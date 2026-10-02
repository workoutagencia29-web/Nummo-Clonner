/**
 * Origens "de mentira" usadas nas importações: o ZIP enviado e o HTML colado
 * sem "Link de origem" são servidos ao Chromium em hosts internos que não
 * existem na internet. Esses endereços nunca podem vazar para a cópia (links,
 * sugestões de funil, "Página original").
 *
 * Funções puras (sem rede, sem banco).
 */

/** Origem dos arquivos de um ZIP importado. */
export const IMPORT_ORIGIN = "http://importado.offerstudio";
/** Origem do HTML colado sem "Link de origem". */
export const PASTE_ORIGIN = "http://colado.offerstudio";

/** Sufixo dos hosts internos (não é um domínio público). */
const SYNTHETIC_HOST_SUFFIX = ".offerstudio";

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

/** true quando a URL está numa origem interna de importação (ZIP ou HTML colado). */
export function isSyntheticOrigin(url: string | null | undefined): boolean {
  if (!url) return false;
  const host = hostOf(url);
  return !!host && (host.endsWith(SYNTHETIC_HOST_SUFFIX) || host === SYNTHETIC_HOST_SUFFIX.slice(1));
}

/** De onde veio a página de uma origem interna: "ZIP", "HTML" (colado) ou null. */
export function syntheticSource(url: string | null | undefined): "ZIP" | "HTML" | null {
  if (!isSyntheticOrigin(url)) return null;
  let origin: string;
  try {
    origin = new URL(url as string).origin;
  } catch {
    return null;
  }
  if (origin === PASTE_ORIGIN) return "HTML";
  return "ZIP";
}

/**
 * Caminho de `target` relativo à página `pageUrl` (mesma origem), ex.:
 * página /sub/index.html + /sub/obrigado.html → "obrigado.html";
 * /a/b.html + /c.html → "../c.html". Mantém query e #hash.
 */
export function relativeToPage(target: URL, pageUrl: string): string {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return `${target.pathname}${target.search}${target.hash}`;
  }
  const from = page.pathname.split("/").slice(0, -1);
  const to = target.pathname.split("/");
  const file = to.pop() ?? "";
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const up = from.slice(i).map(() => "..");
  const down = to.slice(i);
  let rel = [...up, ...down, file].join("/");
  if (!rel) rel = "./";
  else if (rel.startsWith("/")) rel = `.${rel}`;
  return `${rel}${target.search}${target.hash}`;
}
