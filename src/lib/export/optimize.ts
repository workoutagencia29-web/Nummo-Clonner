/**
 * "HTML mais leve" do ZIP (opção optimizeHtml), conservador de propósito:
 *
 * - tira comentários HTML, menos os condicionais do Internet Explorer
 *   (<!--[if IE]>…<![endif]-->) e os de dentro de <script>, <style>,
 *   <textarea>, <pre>, <title>… (que não são comentários de verdade);
 * - encolhe os espaços SÓ entre uma tag e outra: uma sequência de espaços e
 *   quebras de linha vira uma quebra de linha (ou um espaço) — o navegador já
 *   mostra qualquer sequência de espaços como um só, então nada muda na tela;
 * - nunca mexe no conteúdo de <script>, <style>, <pre>, <textarea>, nem em
 *   atributos (um "<!--" dentro de aspas fica como está).
 *
 * Páginas "Preservar JS" não passam por aqui: frameworks usam comentários como
 * marcadores (Vue, React, Svelte) para "hidratar" a página.
 */

/** Elementos cujo conteúdo é texto cru para o navegador (ou que mostram os espaços como estão). */
const RAW_ELEMENTS = new Set(["script", "style", "textarea", "pre", "title", "xmp", "iframe", "noembed", "noframes"]);

/** Comentário condicional do IE (ou o fim dele): fica. */
function keepComment(body: string): boolean {
  return /^\[if\b/i.test(body) || /<!\[endif\]$/i.test(body) || /^<!\[endif\]/i.test(body);
}

/** Espaços entre tags → um só (quebra de linha se havia uma). */
function squeeze(ws: string): string {
  return ws.includes("\n") ? "\n" : " ";
}

export function optimizeHtml(html: string): string {
  let out = "";
  let i = 0;
  const n = html.length;
  /** Último pedaço escrito foi uma tag (para saber se o espaço está "entre tags"). */
  let afterTag = false;

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out += html.slice(i);
      break;
    }
    if (lt > i) {
      const text = html.slice(i, lt);
      out += afterTag && /^\s+$/.test(text) && isTagStart(html, lt) ? squeeze(text) : text;
      afterTag = false;
      i = lt;
    }

    // Comentário.
    if (html.startsWith("<!--", i)) {
      // "<!-->" e "<!--->" fecham na hora (regra do HTML).
      let end: number;
      let bodyEnd: number;
      if (html.startsWith("<!-->", i)) {
        end = i + 5;
        bodyEnd = i + 4;
      } else if (html.startsWith("<!--->", i)) {
        end = i + 6;
        bodyEnd = i + 4;
      } else {
        const close = html.indexOf("-->", i + 4);
        bodyEnd = close < 0 ? n : close;
        end = close < 0 ? n : close + 3;
      }
      const body = html.slice(i + 4, bodyEnd);
      if (keepComment(body)) {
        out += html.slice(i, end);
        afterTag = true;
      } else {
        // O comentário sai; espaços dos dois lados continuam "entre tags" e viram um só.
        afterTag = afterTag || out.length === 0 || /\s$/.test(out) || /[>]$/.test(out);
        const ws = /^\s+/.exec(html.slice(end, end + 4096));
        if (ws && /\s$/.test(out) && isTagStart(html, end + ws[0].length)) {
          if (ws[0].includes("\n") && out.endsWith(" ")) out = `${out.slice(0, -1)}\n`;
          i = end + ws[0].length;
          continue;
        }
      }
      i = end;
      continue;
    }

    // Doctype, <![CDATA[, <?xml…: copia até o ">".
    if (html.startsWith("<!", i) || html.startsWith("<?", i)) {
      const close = html.indexOf(">", i);
      const end = close < 0 ? n : close + 1;
      out += html.slice(i, end);
      afterTag = true;
      i = end;
      continue;
    }

    // Tag de abertura ou fechamento.
    const m = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/.exec(html.slice(i, i + 64));
    if (!m) {
      // "<" solto no texto.
      out += "<";
      afterTag = false;
      i++;
      continue;
    }
    const end = tagEnd(html, i + m[0].length);
    const tag = html.slice(i, end);
    out += tag;
    i = end;
    afterTag = true;
    const name = m[2].toLowerCase();
    if (!m[1] && RAW_ELEMENTS.has(name) && !/\/>$/.test(tag)) {
      // Conteúdo cru: copia até o fechamento, sem tocar.
      const closeRe = new RegExp(`</${name}\\b`, "ig");
      closeRe.lastIndex = i;
      const close = closeRe.exec(html);
      const stop = close ? close.index : n;
      out += html.slice(i, stop);
      i = stop;
      afterTag = false;
    }
  }
  return out.replace(/^\s+/, "");
}

/** A posição começa uma tag, comentário ou doctype (não um "<" solto)? */
function isTagStart(html: string, at: number): boolean {
  return /^<(?:\/?[A-Za-z]|!)/.test(html.slice(at, at + 3));
}

/**
 * Fim da tag (depois do ">"), respeitando valores de atributo entre aspas (só
 * aspas logo depois do "=": title=it's não abre aspas, como no navegador).
 */
function tagEnd(html: string, from: number): number {
  let quote: string | null = null;
  let afterEquals = false;
  for (let j = from; j < html.length; j++) {
    const c = html[j];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if ((c === '"' || c === "'") && afterEquals) {
      quote = c;
      afterEquals = false;
      continue;
    }
    if (c === ">") return j + 1;
    if (c === "=") afterEquals = true;
    else if (!/\s/.test(c)) afterEquals = false;
  }
  return html.length;
}
