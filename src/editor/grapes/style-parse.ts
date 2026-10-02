/**
 * Leitura de `style="…"` para o GrapesJS.
 *
 * O analisador do GrapesJS 0.23.6 (ParserHtml.parseStyle) corta o texto em
 * todo ";" — inclusive dentro de url(data:image/svg+xml;base64,…) e de nomes
 * entre aspas ('Foo;Bar'). Com avoidInlineStyle, isso vira uma regra #id com um
 * url( ou aspas sem fechar, e no CSS salvo (tudo numa linha) essa regra quebrada
 * engole todas as regras seguintes — as edições somem na página publicada.
 *
 * Aqui o ";" só separa declarações fora de aspas e de parênteses.
 */
import type { Editor } from "grapesjs";

export type ParsedStyle = Record<string, string | string[]>;

/** Declarações de um style="…" (mesmo formato do GrapesJS: chave repetida vira lista). */
export function parseInlineStyle(input: string): ParsedStyle {
  const str = String(input ?? "");
  const decls: string[] = [];
  let current = "";
  let quote = "";
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (quote) {
      current += c;
      if (c === "\\" && i + 1 < str.length) {
        current += str[++i];
      } else if (c === quote) {
        quote = "";
      }
      continue;
    }
    // Comentário fora de aspas e parênteses: ignorado (como o GrapesJS faz).
    if (c === "/" && str[i + 1] === "*" && depth === 0) {
      const end = str.indexOf("*/", i + 2);
      i = end < 0 ? str.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) {
      decls.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  decls.push(current);

  const result: ParsedStyle = {};
  for (const raw of decls) {
    const decl = raw.trim();
    if (!decl) continue;
    const colon = decl.indexOf(":");
    if (colon <= 0) continue;
    const key = decl.slice(0, colon).trim();
    const value = decl.slice(colon + 1).trim();
    if (!key) continue;
    const prev = result[key];
    // Chave repetida (fallback de fornecedor): guarda todas, a última vale.
    if (prev !== undefined) result[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
    else result[key] = value;
  }
  return result;
}

const PATCHED = Symbol.for("offerstudio.safe-parse-style");

/**
 * Troca o parseStyle do GrapesJS (as duas instâncias do ParserHtml — do Parser
 * e dos modelos com estilo — são da mesma classe).
 */
export function installSafeStyleParser(editor: Editor) {
  const parser = (editor.Parser as unknown as { parserHtml?: object }).parserHtml;
  const proto = parser && (Object.getPrototypeOf(parser) as Record<string | symbol, unknown>);
  if (!proto || proto[PATCHED]) return;
  proto.parseStyle = parseInlineStyle;
  proto[PATCHED] = true;
}
