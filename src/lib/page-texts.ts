/**
 * Textos do script das páginas (src/runtime) em espanhol e inglês, e a marca de
 * telefone de fora do Brasil.
 *
 * O português continua sendo o padrão escrito no próprio script, em cada
 * chamada (`t("chave", "texto em pt-BR")`, src/runtime/widgets/texts.ts). Nas
 * páginas com <html lang="es…"> ou "en…" (depois do SEO), o render embute no
 * <head> o JSON #os-textos com os textos do idioma; assim as traduções não
 * pesam no script de todas as páginas (orçamento de tamanho do os-runtime).
 *
 * Telefone de fora do Brasil (`intl`): oferta que não é em real, página em
 * espanhol/inglês ou em português de fora do Brasil (pt-PT…). O formulário de
 * captura passa a aceitar 8 a 15 dígitos, sem a formatação (11) 91234-5678 e
 * sem pedir DDD nas mensagens.
 *
 * Página em português de oferta em real: nada é embutido (HTML igual ao de antes).
 * Numa oferta em real, só vale o idioma escolhido em "Idioma das páginas": o
 * lang que veio da página clonada não muda nada sozinho (injectPageTexts).
 *
 * O script das páginas importa daqui (PAGE_TEXTS_ID e os tipos): nada de
 * importações que não sejam de tipos neste arquivo (o esbuild levaria o
 * módulo inteiro para o script). Quem embute o JSON é o render
 * (injectPageTexts em src/lib/page-render.ts).
 */
import type { StoreCurrency } from "@/lib/store";

/** Id do JSON com os textos da página. */
export const PAGE_TEXTS_ID = "os-textos";
/** Chave da marca de telefone de fora do Brasil no JSON ("1"). */
export const INTL_PHONE_KEY = "intl";

/** Idiomas com tradução dos textos do script. */
export type PageTextLang = "es" | "en";

/**
 * Textos em espanhol e inglês. `{p}` = prêmio, `{c}` = cupom ou cidade, `{n}` =
 * número ou nome, `{t}` = total. Os padrões em português ficam no script
 * (comentário ao lado de cada chave).
 */
export const PAGE_TEXTS = {
  es: {
    // Formulário de captura
    lfName: "Escribe tu nombre.", // Digite seu nome.
    lfEmail: "Escribe tu correo electrónico.", // Digite seu e-mail.
    lfPhone: "Escribe tu número de WhatsApp.", // Digite seu WhatsApp com DDD.
    lfField: "Completa este campo.", // Preencha este campo.
    lfEmailBad: "Escribe un correo válido (ej.: nombre@gmail.com).", // Digite um e-mail válido (ex.: nome@gmail.com).
    lfPhoneBad: "Escribe un número de WhatsApp válido.", // Digite um WhatsApp válido com DDD (ex.: (11) 91234-5678).
    lfOk: "¡Listo! Recibimos tus datos.", // Pronto! Recebemos seus dados.
    lfThanks: "¡Gracias!", // Obrigado!
    // Faixa do prêmio da roleta (nas outras páginas da oferta)
    pzRegion: "Tu descuento", // Seu desconto
    pzEnds: "Termina en", // Termina em
    pzKept: "Tu descuento de {p} sigue reservado: aprovéchalo ahora", // Seu desconto de {p} continua reservado — aproveite agora
    pzCoupon: "¡{p} desbloqueado! Usa el cupón al pagar", // {p} liberado! Use o cupom no pagamento
    pzAuto: "¡{p} aplicado automáticamente!", // {p} aplicado automaticamente!
    pzCode: "Cupón ", // Cupom
    pzCopy: "Copiar", // Copiar
    pzCopyLabel: "Copiar el cupón {c}", // Copiar o cupom {c}
    pzClose: "Cerrar el aviso del descuento", // Fechar o aviso do desconto
    // Botão "Copiar" (cupom)
    copied: "¡Copiado!", // Copiado!
    copyFail: "Copia el cupón", // Copie o cupom
    // Roleta
    whLose: "No fue esta vez", // Não foi dessa vez
    whWon: "¡Ganaste {p}!", // Você ganhou {p}!
    whCode: " Tu cupón: {c}.", // Seu cupom: {c}.
    whSpin: "Girando la ruleta…", // Girando a roleta…
    whAgain: "¡Casi! Tienes una oportunidad más. Gira de nuevo.", // Quase! Você tem mais uma chance. Gire de novo.
    // Quiz (leitores de tela)
    qzStep: "Pregunta {n} de {t}", // Pergunta {n} de {t}
    // Notificação de compra
    snFrom: "{n}, de {c}", // {n}, de {c}
    snAction: "acaba de comprar", // acabou de comprar
    snAgo: "hace {n} minutos", // há {n} minutos
    // Popup de saída
    popClose: "Cerrar", // Fechar
  },
  en: {
    lfName: "Please enter your name.",
    lfEmail: "Please enter your email.",
    lfPhone: "Please enter your WhatsApp number.",
    lfField: "Please fill in this field.",
    lfEmailBad: "Please enter a valid email (e.g. name@gmail.com).",
    lfPhoneBad: "Please enter a valid WhatsApp number.",
    lfOk: "Done! We got your details.",
    lfThanks: "Thank you!",
    pzRegion: "Your discount",
    pzEnds: "Ends in",
    pzKept: "Your {p} discount is still reserved — grab it now",
    pzCoupon: "{p} unlocked! Use the coupon at checkout",
    pzAuto: "{p} applied automatically!",
    pzCode: "Coupon ",
    pzCopy: "Copy",
    pzCopyLabel: "Copy coupon {c}",
    pzClose: "Close the discount notice",
    copied: "Copied!",
    copyFail: "Copy the coupon",
    whLose: "Not this time",
    whWon: "You won {p}!",
    whCode: " Your coupon: {c}.",
    whSpin: "Spinning the wheel…",
    whAgain: "Almost! You have one more chance. Spin again.",
    qzStep: "Question {n} of {t}",
    snFrom: "{n} from {c}",
    snAction: "just bought",
    snAgo: "{n} minutes ago",
    popClose: "Close",
  },
} satisfies Record<PageTextLang, Record<string, string>>;

/** Chave de um texto do script (ou a marca de telefone de fora do Brasil). */
export type PageTextKey = keyof (typeof PAGE_TEXTS)["es"] | typeof INTL_PHONE_KEY;

/** Mensagens do telefone sem "DDD", para página em português com telefone de fora do Brasil. */
const PT_INTL_PHONE: Partial<Record<PageTextKey, string>> = {
  lfPhone: "Digite seu WhatsApp.",
  lfPhoneBad: "Digite um WhatsApp válido.",
};

/**
 * Idioma declarado no <html lang> (o primeiro <html> do documento; "" sem ele).
 * Lê só a tag de abertura, em tempo linear.
 */
export function htmlLang(html: string): string {
  const at = html.search(/<html[\s>]/i);
  if (at < 0) return "";
  const end = html.indexOf(">", at);
  const tag = html.slice(at, end < 0 ? html.length : end);
  const m = /\slang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
}

/** Idioma com tradução ("es"/"en") de um <html lang>; null = português (ou sem tradução). */
export function pageTextLang(lang: string): PageTextLang | null {
  const l = lang.trim().toLowerCase();
  return /^es(-|$)/.test(l) ? "es" : /^en(-|$)/.test(l) ? "en" : null;
}

/**
 * Telefones de fora do Brasil: oferta em outra moeda, página em espanhol/inglês
 * ou em português de outro país (pt-PT, pt-AO…).
 */
export function intlPhones(lang: string, currency?: StoreCurrency | null): boolean {
  if (currency && currency !== "BRL") return true;
  const l = lang.trim().toLowerCase();
  return pageTextLang(l) !== null || /^pt-(?!br$)[a-z]+$/.test(l);
}

/** Textos do JSON #os-textos da página; null = nada a embutir (português de oferta em real). */
export function pageTexts(lang: string, currency?: StoreCurrency | null): Partial<Record<PageTextKey, string>> | null {
  const textLang = pageTextLang(lang);
  const intl = intlPhones(lang, currency);
  if (!textLang && !intl) return null;
  return {
    ...(textLang ? PAGE_TEXTS[textLang] : PT_INTL_PHONE),
    ...(intl && { [INTL_PHONE_KEY]: "1" }),
  };
}
