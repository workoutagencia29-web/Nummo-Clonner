/**
 * Arquivos de "Preservar JS" na prévia: o mapa guarda o caminho original como o
 * navegador pede (codificado: %20, %C3%A7…) e, às vezes, com a query string.
 * Procura nessa ordem: codificado + query, codificado, decodificado + query,
 * decodificado. "%" solto no nome não quebra a busca.
 */
export function findMappedAsset(assetMap: Record<string, string>, url: URL): string | undefined {
  const raw = url.pathname;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // mantém o caminho como veio
  }
  for (const key of [`${raw}${url.search}`, raw, `${decoded}${url.search}`, decoded]) {
    const found = assetMap[key];
    if (found) return found;
  }
  return undefined;
}
