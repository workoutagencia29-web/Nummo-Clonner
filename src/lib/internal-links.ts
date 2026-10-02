/**
 * Links internos do funil.
 *
 * Dentro do editor e do banco, um link para outra página da mesma oferta é
 * gravado como `os-page:<pageId>` (ex.: href="os-page:clx123"). Assim, trocar o
 * slug de uma página ou duplicar a oferta não quebra os links: na prévia e no ZIP
 * eles são convertidos para o endereço relativo certo.
 */
export const INTERNAL_LINK_PREFIX = "os-page:";

const INTERNAL_LINK_RE = /os-page:([a-z0-9]{20,32})/g;

export function internalLink(pageId: string) {
  return `${INTERNAL_LINK_PREFIX}${pageId}`;
}

/** Substitui IDs de página em qualquer texto (HTML ou JSON do editor). */
export function remapInternalLinks(text: string, idMap: Map<string, string>) {
  return text.replace(INTERNAL_LINK_RE, (match, id: string) => {
    const next = idMap.get(id);
    return next ? internalLink(next) : match;
  });
}

/** IDs de página referenciados num texto. */
export function referencedPageIds(text: string) {
  return new Set([...text.matchAll(INTERNAL_LINK_RE)].map((m) => m[1]));
}
