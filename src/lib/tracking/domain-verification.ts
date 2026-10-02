/**
 * Metas de verificação de domínio coladas nos códigos livres: Meta
 * (facebook-domain-verification), Google (google-site-verification), Pinterest
 * (p:domain_verify), Bing (msvalidate.01), Yandex e afins ("…-verification").
 *
 * Quem confere a verificação não roda JavaScript: essas metas nunca podem
 * ficar no bloco que espera o "Aceitar" (gateCode em ./inject, na prévia e no
 * ZIP) — e o ZIP/divisor usam as mesmas regras (src/lib/export/head.ts).
 *
 * Funções puras, sem DOM (rodam no servidor).
 */

const ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`;
const META_TAG_RE = new RegExp(`<meta\\b${ATTRS}>`, "gi");

/**
 * Trechos de código que nunca valem como HTML da página: comentários,
 * <script>, <style>, <noscript> e <template> (inclusive o código em espera do
 * consentimento). Uma meta dentro deles fica onde está.
 */
export const INERT_CODE_RE =
  /<!--[\s\S]*?-->|<(template|script|style|noscript)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>/gi;

/** Nome de uma meta de verificação de domínio. */
export const VERIFICATION_NAME_RE = /verification$|^p:domain_verify$|^msvalidate\.01$/i;

function attrOf(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

function decodeAttr(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A tag reescrita limpa (`<meta name="…" content="…">`) se for de verificação; senão null. */
function cleanVerificationMeta(tag: string): string | null {
  const name = decodeAttr(attrOf(tag, "name") ?? "").trim();
  const content = decodeAttr(attrOf(tag, "content") ?? "").trim();
  if (!name || !content || !VERIFICATION_NAME_RE.test(name)) return null;
  return `<meta name="${escapeAttr(name)}" content="${escapeAttr(content)}">`;
}

/**
 * Separa as metas de verificação do resto do código: `metas` (reescritas
 * limpas, sem repetir, na ordem) e `rest` (o código sem elas; comentários,
 * scripts e o resto ficam exatamente como estavam). Metas dentro de
 * comentários, scripts ou <template> não contam.
 */
export function splitVerificationMetas(code: string): { metas: string[]; rest: string } {
  const metas: string[] = [];
  const re = new RegExp(`${INERT_CODE_RE.source}|${META_TAG_RE.source}`, "gi");
  const rest = code.replace(re, (match: string, inert: string | undefined) => {
    if (inert !== undefined || match.startsWith("<!--")) return match;
    const clean = cleanVerificationMeta(match);
    if (!clean) return match;
    if (!metas.includes(clean)) metas.push(clean);
    return "";
  });
  return { metas, rest };
}

/** Metas de verificação de domínio de um código livre (fora de comentários e scripts), reescritas limpas. */
export function verificationMetas(code: string | null | undefined): string[] {
  return code ? splitVerificationMetas(code).metas : [];
}
