/**
 * Valor próprio do celular mantido (#49) quando a edição é !important (#46).
 *
 * Uma edição no Desktop (ou no Tablet) de uma propriedade que o site original
 * muda em telas menores ganha uma regra "fixa" nas mesmas media queries:
 *   @media (max-width: 767px){ :is(#id){ font-size: revert-layer } }
 * Fora de camada, revert-layer devolve o valor da camada os-original.
 *
 * A regra fixa vale depois da edição que ela protege porque o GrapesJS (e o
 * canvas, ver installCanvasMediaOrder) põe as media queries de tela mais larga
 * antes: a edição do Desktop (sem @media) e a do Tablet (max-width: 992px)
 * perdem para ela; uma edição do Celular (max-width: 480px) vence.
 *
 * Quando a propriedade é !important no original, a edição também é !important
 * e ganha uma cópia na camada os-fix (a única que vence o !important original).
 * Ali um revert-layer não serve: os-fix é a primeira camada, e voltar uma camada
 * a partir dela leva ao estilo padrão do navegador. Por isso a cópia os-fix da
 * edição fica FORA dessas media queries (@media not …), e a regra fixa não é
 * copiada para os-fix. Usado no servidor (editor-html) e no canvas
 * (style-cascade): sem dependências.
 */

export const KEEP_VALUE = "revert-layer";

/** Identificador CSS seguro para #id (o mesmo que CSS.escape, também no servidor). */
export function cssIdent(value: string) {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const code = ch.charCodeAt(0);
    const leadingDigit = /[0-9]/.test(ch) && (i === 0 || (i === 1 && value[0] === "-"));
    if (code === 0) out += "�";
    else if (code <= 31 || code === 127 || leadingDigit) out += `\\${code.toString(16)} `;
    else if (i === 0 && ch === "-" && value.length === 1) out += "\\-";
    else if (code >= 128 || /[\w-]/.test(ch)) out += ch;
    else out += `\\${ch}`;
  }
  return out;
}

/** Tira os escapes CSS de um identificador (`\31 abc` → `1abc`, `a\.b` → `a.b`). */
export function unescapeIdent(value: string) {
  return value.replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?|\\([^\n\r\f0-9a-f])/gi, (_, hex: string, ch: string) => {
    if (!hex) return ch;
    const code = Number.parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
  });
}

const ID_ONLY = /^#((?:\\[0-9a-f]{1,6}[ \t\n\r\f]?|\\[^\n\r\f0-9a-f]|[\w\u0080-￿-])+)$/i;

/** Id (sem escapes) de um seletor que é só `#id`, ou null. */
export function idOfSelector(selector: string): string | null {
  const m = ID_ONLY.exec(normalizeSelector(selector));
  return m ? unescapeIdent(m[1]) : null;
}

/** Seletor da regra fixa de um elemento: `:is(#id)` (mesma força de #id). */
export function pinSelector(id: string) {
  return `:is(#${cssIdent(id)})`;
}

/** ":is(<seletor>)" → "<seletor>" (regra fixa), ou null. */
export function pinnedSelector(selector: string): string | null {
  const m = /^:is\(([\s\S]+)\)$/.exec(normalizeSelector(selector));
  return m ? m[1].trim() : null;
}

/** Id do elemento de uma regra fixa `:is(#id)`, ou null. */
export function pinnedId(selector: string): string | null {
  const inner = pinnedSelector(selector);
  return inner ? idOfSelector(inner) : null;
}

export function normalizeSelector(selector: string) {
  return selector.replace(/\s+/g, " ").trim();
}

/** Valor (sem !important) que só devolve o original: revert-layer. */
export function isKeepValue(value: string) {
  return (
    value
      .replace(/!\s*important/i, "")
      .trim()
      .toLowerCase() === KEEP_VALUE
  );
}

/** Divide uma lista de media queries nas vírgulas de fora dos parênteses. */
function splitQueries(media: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of media) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((q) => q.trim()).filter(Boolean);
}

/** Media query que vale exatamente quando `query` não vale. */
function negateQuery(query: string): string {
  const q = query.replace(/^only\s+/i, "").trim();
  const not = /^not\s+/i.exec(q);
  if (not) return q.slice(not[0].length).trim();
  // Começa com o tipo de mídia (screen, print, all…).
  if (/^[a-z][\w-]*(\s|$)/i.test(q)) return `not ${q}`;
  // Só condições: "(a) and (b)" ou "(a) or (b)" (este precisa de parênteses em volta).
  return /\)\s+or\s+\(/i.test(q) ? `not all and (${q})` : `not all and ${q}`;
}

/**
 * Envolve `css` em @media aninhados que só valem fora de TODAS as media queries
 * dadas (cada lista com vírgula vira um nível por query).
 */
export function outsideMedia(medias: Iterable<string>, css: string): string {
  let out = css;
  const queries = new Set<string>();
  for (const media of medias) for (const q of splitQueries(media)) queries.add(q);
  for (const q of [...queries].reverse()) out = `@media ${negateQuery(q)}{${out}}`;
  return out;
}

/**
 * Posição de uma media query na ordem do CSS das edições: o GrapesJS ordena os
 * @media pelo primeiro número (maior primeiro, "computador primeiro"); sem
 * número, antes de todos. Regras sem @media vêm antes de qualquer @media.
 */
export function mediaOrder(media: string): number {
  if (!media.trim()) return Number.POSITIVE_INFINITY;
  const m = /(-?\d*\.?\d+)\w{0,}/.exec(media);
  return m ? Number.parseFloat(m[1]) : Number.MAX_VALUE;
}

/**
 * A regra fixa (em `pinMedia`) vem depois, no CSS, de uma edição do elemento
 * em `ruleMedia` ("" = Desktop)? Só então ela devolve o valor original ali.
 */
export function pinComesAfter(ruleMedia: string, pinMedia: string) {
  return mediaOrder(ruleMedia) > mediaOrder(pinMedia);
}

/** Chave de um seletor: `#id` sem escapes (o GrapesJS e o servidor escapam igual ou não). */
function selectorKey(selector: string) {
  const id = idOfSelector(selector);
  return id !== null ? `#${id}` : normalizeSelector(selector);
}

/** Chave (seletor + propriedade) de um valor fixado. */
export function pinKey(selector: string, property: string) {
  return `${selectorKey(selector)}\n${property.trim().toLowerCase()}`;
}
