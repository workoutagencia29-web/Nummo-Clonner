/**
 * Links de páginas legais e de contato sem destino: "Política de privacidade",
 * "Termos de uso", "Contato"… com href="#", vazio ou javascript: (como o
 * rodapé e o aviso do formulário dos modelos, até a pessoa escolher a página
 * de cada um). No ar, o clique não leva a lugar nenhum. Usado no aviso do ZIP
 * (src/server/services/export/plan.ts) e no passo opcional do "Próximos
 * passos" (src/lib/readiness.ts).
 *
 * Leitura linear do HTML, sem cheerio e sem regex com repetição aninhada: roda
 * a cada abertura da tela da oferta, em todas as páginas.
 */

/** Texto de link de página legal ou de contato (pt, es, en), já sem acento e em minúsculas. */
const LEGAL_TEXT_RE =
  /\b(?:politica|privacidade|privacidad|privacy|termos|terminos|terms|contato|contacto|contact|aviso legal|legal notice|cookies|lgpd|reembolso)\b/;

/** Mais que isso não é o nome de um link de rodapé (um card inteiro dentro de um <a>, por exemplo). */
const MAX_TEXT = 80;

/** Elementos cujo conteúdo não é HTML de verdade para o visitante (nem links). */
const SKIP_CONTENT = ["script", "style", "template", "noscript", "textarea", "os-script", "os-noscript"];

const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/**
 * Fim da tag de abertura (depois do ">"), respeitando valores entre aspas (só
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

function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of tag.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    if (!out.has(name)) out.set(name, m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** O valor leva a algum lugar? ("#", vazio e javascript: não levam; a mesma regra dos botões.) */
function leads(value: string | undefined): boolean {
  const v = (value ?? "").trim();
  return Boolean(v) && v !== "#" && !/^javascript:/i.test(v);
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };

/** Texto visível do link, numa linha. */
function linkText(inner: string): string {
  let text = "";
  let i = 0;
  while (i < inner.length) {
    const lt = inner.indexOf("<", i);
    if (lt < 0) {
      text += inner.slice(i);
      break;
    }
    text += `${inner.slice(i, lt)} `;
    const gt = inner.indexOf(">", lt);
    i = gt < 0 ? inner.length : gt + 1;
  }
  return text
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, e: string) => ENTITIES[e] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * Textos dos links legais/de contato sem destino de um HTML (sem repetir).
 * Não contam: links ligados a um link da oferta (data-os-link: o aviso deles é
 * o dos botões de compra), o "Preferências de cookies" (data-os-consent-open:
 * reabre o aviso de cookies), links com código no clique (on…) ou com
 * data-os-href, e o que está dentro de <script>, <template>, <noscript>,
 * comentários…
 */
export function deadLegalLinks(html: string | null | undefined): string[] {
  if (!html?.includes("<")) return [];
  const lower = html.toLowerCase();
  const found: string[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = lower.indexOf("<", i);
    if (lt < 0) break;
    if (lower.startsWith("<!--", lt)) {
      const close = lower.indexOf("-->", lt + 4);
      i = close < 0 ? html.length : close + 3;
      continue;
    }
    const skip = SKIP_CONTENT.find((name) => {
      const after = lower[lt + 1 + name.length];
      return lower.startsWith(name, lt + 1) && (after === undefined || /[\s>/]/.test(after));
    });
    if (skip) {
      const close = lower.indexOf(`</${skip}`, lt + 1 + skip.length);
      i = close < 0 ? html.length : close + 2 + skip.length;
      continue;
    }
    const next = lower[lt + 2];
    if (lower[lt + 1] !== "a" || (next !== undefined && !/[\s>/]/.test(next))) {
      i = lt + 1;
      continue;
    }
    const end = tagEnd(html, lt + 2);
    const attrs = attributes(html.slice(lt + 2, end - 1));
    const close = lower.indexOf("</a", end);
    const stop = close < 0 ? html.length : close;
    i = stop;
    if (!attrs.has("href") || leads(attrs.get("href")) || leads(attrs.get("data-os-href"))) continue;
    if (attrs.has("data-os-link") || attrs.has("data-os-consent-open") || attrs.has("data-os-pay")) continue;
    if ([...attrs.keys()].some((name) => name.startsWith("on") || name.startsWith("data-os-on-"))) continue;
    const text = linkText(html.slice(end, stop));
    if (!text || text.length > MAX_TEXT || !LEGAL_TEXT_RE.test(fold(text))) continue;
    if (!found.includes(text)) found.push(text);
  }
  return found;
}
