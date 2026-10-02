/**
 * Ids repetidos da página (ex.: dois botões id="comprar", comuns em páginas
 * clonadas). O GrapesJS não aceita dois elementos com o mesmo id (renomearia o
 * segundo para "comprar-2"), então os repetidos entram no editor com o id
 * guardado em `data-os-dup-id` (src/lib/editor-html.ts) e o canvas mostra o id
 * original neles (src/editor/grapes/components.ts). Usado dos dois lados.
 */

/** Id original de um repetido (2º em diante). */
export const DUP_ID_ATTR = "data-os-dup-id";

/**
 * Id próprio de um repetido que ganhou estilo no editor: a regra dele vira
 * `#original[data-os-eid="<id do editor>"]` (mesma força de um #id).
 */
export const EID_ATTR = "data-os-eid";

/**
 * Regra de estilo do PRIMEIRO elemento de um id repetido (`#comprar`): no editor
 * ela vale só para ele, então mira `#comprar:not([data-os-dup-id])`.
 */
export const NOT_DUP = `:not([${DUP_ID_ATTR}])`;

/**
 * Só no canvas: id do editor de um repetido (o canvas mostra nele o id
 * original). Quando o GrapesJS relê o HTML do canvas (fim da edição de um
 * texto), o repetido volta a ser o mesmo componente, com o estilo dele.
 */
export const CCID_ATTR = "data-os-ccid";

/** Texto entre aspas para um seletor de atributo (`[x="…"]`). */
export function cssAttrValue(value: string) {
  return `"${value.replace(/["\\]/g, "\\$&").replace(/\n/g, "\\a ")}"`;
}
