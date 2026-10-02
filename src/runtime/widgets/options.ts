/**
 * Opções dos widgets: funções puras, usadas pelo script das páginas
 * (src/runtime) e pelo editor (valores de exemplo no canvas). Sem efeitos
 * colaterais e sem dependências — entram no script minificado das páginas.
 */

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
    const m = /^(.+?)\s*(?:\||\s[-–—]\s|,)\s*(.+)$/.exec(line);
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

/** Número de WhatsApp no formato internacional: DDD + número ganha o 55 do Brasil. */
export function normalizePhone(input: string): string {
  const d = onlyDigits(input).replace(/^0+/, "");
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

/** Link de conversa do WhatsApp (wa.me) com mensagem inicial opcional. */
export function whatsappUrl(phone: string, message = ""): string {
  const text = message.trim();
  return `https://wa.me/${normalizePhone(phone)}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

/** Telefone com DDD (10–11 dígitos), com ou sem +55, ou internacional até 15 dígitos. */
export function isValidPhone(v: string) {
  const d = onlyDigits(v).replace(/^0+/, "");
  return d.length >= 10 && d.length <= 15;
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

const EMPTY_MESSAGE: Record<LeadFieldKind, string> = {
  name: "Digite seu nome.",
  email: "Digite seu e-mail.",
  phone: "Digite seu WhatsApp com DDD.",
  other: "Preencha este campo.",
};

/** Mensagem de erro (pt-BR) de um campo do formulário de captura, ou "" se está ok. */
export function leadFieldError(kind: LeadFieldKind, value: string, required: boolean): string {
  const v = value.trim();
  if (!v) return required ? EMPTY_MESSAGE[kind] : "";
  if (kind === "email" && !isValidEmail(v)) return "Digite um e-mail válido (ex.: nome@gmail.com).";
  if (kind === "phone" && !isValidPhone(v)) return "Digite um WhatsApp válido com DDD (ex.: (11) 91234-5678).";
  if (kind === "name" && v.length < 2) return EMPTY_MESSAGE.name;
  return "";
}
