/**
 * Opções dos widgets: funções puras, usadas pelo script das páginas
 * (src/runtime) e pelo editor (valores de exemplo no canvas). Sem efeitos
 * colaterais e sem dependências — entram no script minificado das páginas.
 */
import type { PageTextKey } from "@/lib/page-texts";

/** Fuso usado quando a data do contador não diz o fuso (horário de Brasília). */
export const BR_TZ = "-03:00";

export interface Person {
  name: string;
  city: string;
}

/**
 * "Maria - São Paulo", "Maria | São Paulo" ou "Maria, São Paulo" (uma pessoa
 * por linha ou separadas por ";"). A cidade é opcional.
 */
export function parsePeople(text: string): Person[] {
  const out: Person[] = [];
  for (const raw of text.split(/\r?\n|;/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.+?)\s*(?:\||\s[-\u2013\u2014]\s|,)\s*(.+)$/.exec(line);
    out.push(m ? { name: m[1].trim(), city: m[2].trim() } : { name: line, city: "" });
  }
  return out;
}

export function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

export interface TimeParts {
  d: number;
  h: number;
  m: number;
  s: number;
}

/** Milissegundos → dias, horas, minutos e segundos (nunca negativos). */
export function splitTime(ms: number): TimeParts {
  const t = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

/**
 * Data final do contador. Aceita "2026-10-10T23:59" (o que o editor grava),
 * "2026-10-10 23:59", "10/10/2026 23:59" ou só a data (vale até 23:59:59). Sem
 * fuso explícito, usa o horário de Brasília. Devolve null se não entender.
 */
export function parseDeadline(value: string, tz = BR_TZ): number | null {
  let v = value.trim().replace(/\s+/, "T");
  const br = /^(\d\d?)\/(\d\d?)\/(\d{4})(.*)$/.exec(v);
  if (br) v = `${br[3]}-${pad2(+br[2])}-${pad2(+br[1])}${br[4]}`;
  if (/^\d{4}-\d\d-\d\d$/.test(v)) v += "T23:59:59";
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v)) return null;
  if (!/(Z|[+-]\d\d:?\d\d)$/i.test(v)) v += tz;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

export function onlyDigits(s: string) {
  return s.replace(/\D/g, "");
}

/**
 * Número de WhatsApp no formato internacional (só dígitos). Com "+" ou "00" na
 * frente, o número já tem o código do país e fica como está (sem o "00"). Sem
 * isso, DDD + número (10 ou 11 dígitos) ganha o 55 do Brasil — só em oferta em
 * real (`brazil`, o padrão); nas outras moedas o número fica como foi digitado.
 */
export function normalizePhone(input: string, brazil = true): string {
  const raw = onlyDigits(input);
  const d = raw.replace(/^0+/, "");
  if (/^\D*\+/.test(input) || raw.slice(0, 2) === "00") return d;
  return brazil && (d.length === 10 || d.length === 11) ? `55${d}` : d;
}

/** Link de conversa do WhatsApp (wa.me) com mensagem inicial opcional (`brazil`: ver normalizePhone). */
export function whatsappUrl(phone: string, message = "", brazil = true): string {
  const text = message.trim();
  return `https://wa.me/${normalizePhone(phone, brazil)}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

/**
 * Telefone com DDD (10–11 dígitos), com ou sem +55, ou internacional até 15
 * dígitos. `intl` (oferta fora do real ou página em espanhol/inglês): a partir
 * de 8 dígitos, com ou sem o código do país (celular da Espanha: 612 345 678).
 */
export function isValidPhone(v: string, intl = false) {
  const d = onlyDigits(v).replace(/^0+/, "");
  return d.length >= (intl ? 8 : 10) && d.length <= 15;
}

/**
 * (11) 91234-5678 / (11) 1234-5678; com +55 fica "+55 (11) 91234-5678". Número
 * de outro país (+1, +351…) e outros formatos ficam como o visitante digitou.
 */
export function formatPhoneBR(v: string) {
  let d = onlyDigits(v);
  const intl = v.trim()[0] === "+";
  if (intl) {
    if (d.slice(0, 2) !== "55") return v;
    d = d.slice(2);
  }
  const f =
    d.length === 11
      ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
      : d.length === 10
        ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
        : "";
  return f ? (intl ? `+55 ${f}` : f) : v;
}

/**
 * Endereço digitado sem "https://" ("meusite.com.br/obrigado", "wa.me/55…")
 * ganha o https:// — senão o navegador o trataria como caminho desta página.
 * Caminhos ("/obrigado", "obrigado.html"), âncoras e endereços completos ficam
 * como estão.
 */
export function withScheme(value: string): string {
  const v = value.trim();
  const host = /^[\w-]+(?:\.[\w-]+)*\.([a-z]{2,})(?::\d+)?(?=[/?#]|$)/i.exec(v);
  return host && !/^(html?|php|aspx?|jsp|pdf)$/i.test(host[1]) ? `https://${v}` : v;
}

export type LeadFieldKind = "name" | "email" | "phone" | "other";

/**
 * Texto no idioma da página (t de ./texts, que lê o #os-textos); o padrão
 * devolve o português. Recebido de fora: estas funções continuam puras.
 */
export type PageText = (key: PageTextKey, pt: string) => string;
const inPortuguese: PageText = (_key, pt) => pt;

const EMPTY_MESSAGE: Record<LeadFieldKind, [PageTextKey, string]> = {
  name: ["lfName", "Digite seu nome."],
  email: ["lfEmail", "Digite seu e-mail."],
  phone: ["lfPhone", "Digite seu WhatsApp com DDD."],
  other: ["lfField", "Preencha este campo."],
};

/**
 * Mensagem de erro de um campo do formulário de captura, ou "" se está ok.
 * Em pt-BR; `text` traz a do idioma da página. `intl`: telefone de fora do
 * Brasil (isValidPhone).
 */
export function leadFieldError(
  kind: LeadFieldKind,
  value: string,
  required: boolean,
  text: PageText = inPortuguese,
  intl = false,
): string {
  const v = value.trim();
  const empty = text(EMPTY_MESSAGE[kind][0], EMPTY_MESSAGE[kind][1]);
  if (!v) return required ? empty : "";
  if (kind === "email" && !isValidEmail(v)) return text("lfEmailBad", "Digite um e-mail válido (ex.: nome@gmail.com).");
  if (kind === "phone" && !isValidPhone(v, intl))
    return text("lfPhoneBad", "Digite um WhatsApp válido com DDD (ex.: (11) 91234-5678).");
  if (kind === "name" && v.length < 2) return empty;
  return "";
}
