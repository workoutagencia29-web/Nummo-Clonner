/**
 * Doctype das páginas clonadas. O doctype decide o modo de renderização
 * (padrão, quase-padrão ou quirks): páginas antigas feitas em tabelas com
 * fatias de imagem só ficam certas no modo em que foram feitas.
 *
 * O cheerio (parse5) reescreve qualquer doctype como `<!DOCTYPE html>` ao
 * serializar; quem monta HTML com o cheerio devolve o original com
 * `restoreDoctype`. Funções puras (sem rede, sem banco, sem navegador): usadas
 * pelo clonador (build.ts) e pelo painel (salvar a clonagem).
 */

const LEADING_DOCTYPE_RE = /^(﻿?(?:\s|<!--[\s\S]*?-->)*)<!doctype\b[^>]*>[ \t]*\r?\n?/i;

/** Doctype do início de um HTML (depois de BOM, espaços e comentários), ou "". */
export function doctypeOf(html: string): string {
  return /^﻿?(?:\s|<!--[\s\S]*?-->)*(<!doctype\b[^>]*>)/i.exec(html)?.[1] ?? "";
}

/**
 * Devolve `html` com o doctype de `source` — ou sem doctype, se `source` não
 * tem. O cheerio (parse5) reescreve qualquer doctype como `<!DOCTYPE html>`,
 * o que tira páginas antigas do modo quirks/quase-padrão e abre frestas entre
 * as fatias de imagem em tabelas.
 */
export function restoreDoctype(html: string, source: string): string {
  const original = doctypeOf(source);
  if (LEADING_DOCTYPE_RE.test(html)) {
    return html.replace(LEADING_DOCTYPE_RE, (_m, prolog: string) => (original ? `${prolog}${original}\n` : prolog));
  }
  return original ? `${original}\n${html}` : html;
}
