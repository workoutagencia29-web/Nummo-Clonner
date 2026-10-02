/**
 * Contador regressivo do site original na cópia "Editável": os scripts do site
 * saem, então o contador fica parado (ex.: 00:14:55) na prévia, no "Ver como
 * visitante" e no ZIP. A revisão avisa e oferece o modo "Com scripts".
 * Só no servidor (lê o HTML da cópia).
 */
import * as cheerio from "cheerio";

/** Nomes que sites de oferta costumam dar ao contador (classe ou id). */
const TIMER_NAME_RE = /count-?down|timer|cron[oô]metro|contador|contagem|relogio|clock/i;
/** "00:14:55", "1:02:33" (horas:minutos:segundos). */
const HMS_RE = /(?<![\d:])\d{1,2}\s*:\s*[0-5]\d\s*:\s*[0-5]\d(?![\d:])/;
/** "14:55" ou "14 : 55" (minutos:segundos), só dentro de um elemento com nome de contador. */
const MS_RE = /(?<![\d:])\d{1,2}\s*:\s*[0-5]\d(?![\d:])/;

/** Números em caixas separadas ("00 h 14 min 55 s"): três números curtos próximos. */
const SPLIT_RE = /(?<!\d)\d{1,2}(?!\d)\D{1,12}(?<!\d)\d{1,2}(?!\d)\D{1,12}(?<!\d)\d{1,2}(?!\d)/;

/** "14 min 55 s", "2h 30min" (números com a unidade de tempo). */
const UNITS_RE =
  /(?<!\d)\d{1,2}\s*(?:h|hrs?|horas?|min|minutos?|m)\b\D{0,12}(?<!\d)\d{1,2}\s*(?:s|seg|segundos?|min|minutos?|m)\b/i;

/**
 * A página (HTML da cópia "Editável") mostra um contador que dependia de
 * script? Contadores do próprio Offer Studio (data-os-widget) funcionam e não contam.
 */
export function hasFrozenTimer(html: string): boolean {
  if (!html) return false;
  const $ = cheerio.load(html);
  $("script, style, noscript, template, [data-os-widget], os-script").remove();
  let found = false;
  $("[class], [id]").each((_, el) => {
    if (found) return false;
    const node = $(el);
    const name = `${node.attr("class") ?? ""} ${node.attr("id") ?? ""}`;
    if (!TIMER_NAME_RE.test(name)) return;
    const text = node.text().replace(/\s+/g, " ");
    // Contador com os números em caixas separadas: "00 h 14 min 55 s" também conta.
    if (HMS_RE.test(text) || MS_RE.test(text) || SPLIT_RE.test(text) || UNITS_RE.test(text)) found = true;
  });
  if (found) return true;
  return HMS_RE.test($("body").text().replace(/\s+/g, " "));
}
