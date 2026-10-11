/**
 * Textos do script das páginas no idioma delas. O português é o padrão escrito
 * em cada chamada (`t("chave", "texto em pt-BR")`); nas páginas em espanhol ou
 * inglês o render embute o JSON #os-textos com os textos do idioma — e, com
 * telefone de fora do Brasil, a marca `intl` (src/lib/page-texts.ts). As
 * traduções ficam fora deste script: não pesam nas páginas em português.
 * Sem dependências: entra também no script da janela de pagamento (copy.ts).
 */
import { PAGE_TEXTS_ID, type PageTextKey } from "@/lib/page-texts";

let texts: Record<string, unknown> | null = null;

/** Texto da chave no idioma da página (o JSON é lido uma vez); sem ele, o padrão em português. */
export function t(key: PageTextKey, pt: string): string {
  if (!texts) {
    try {
      texts = JSON.parse((document.getElementById(PAGE_TEXTS_ID) || { textContent: "" }).textContent || "{}");
    } catch {
      // JSON estragado: fica o português
    }
    texts = texts || {};
  }
  const v = texts[key];
  return typeof v === "string" ? v : pt;
}

/** t() com {p}, {n}, {c}… trocados pelos valores. */
export function tf(key: PageTextKey, pt: string, vars: Record<string, string | number>): string {
  return t(key, pt).replace(/\{(\w)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Telefone de fora do Brasil (oferta fora do real ou página em espanhol/inglês). */
export const intlPhone = () => t("intl", "") === "1";
