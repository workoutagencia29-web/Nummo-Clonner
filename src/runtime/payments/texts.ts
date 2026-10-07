/**
 * Textos da janela de pagamento no idioma do PRODUTO (o comprador é do México
 * ou da Europa): Español, English e Português. Nenhum texto do servidor
 * aparece para o comprador — os códigos de erro do endpoint viram estas frases.
 *
 * Exceção: os controles da simulação (só na prévia do Offer Studio) são para
 * você, em português do Brasil (SIM_TEXTS).
 */
import type { PayCurrency, PayLocale, PayMethod } from "@/lib/payments/contract";

export interface PayTexts {
  kicker: string;
  close: string;
  method: string;
  methods: Record<PayMethod, [string, string]>;
  name: string;
  email: string;
  doc: string;
  errName: string;
  errEmail: string;
  errDoc: string;
  goSpei: string;
  goCard: string;
  creating: string;
  secure: string;
  speiIntro: string;
  clabe: string;
  bank: string;
  holder: string;
  amount: string;
  reference: string;
  expires: string;
  copy: string;
  copied: string;
  copyFail: string;
  waitSpei: string;
  waitNote: string;
  cardIntro: Record<"card" | "bizum" | "mb_way", string>;
  loadingForm: string;
  confirming: string;
  confirmingNote: string;
  stuck: string;
  paidTitle: string;
  paidGo: string;
  paidStay: string;
  continue: string;
  declinedTitle: string;
  declinedText: string;
  otherCard: string;
  expiredTitle: string;
  expiredText: string;
  failedTitle: string;
  failedText: string;
  regen: string;
  again: string;
  change: string;
  /** "Cambiar" com SPEI aberto: quem já transferiu não pode perder o pedido. */
  changeSpeiTitle: string;
  changeSpeiText: string;
  keepWaiting: string;
  changeAnyway: string;
  /** Formulário com um SPEI anterior ainda aberto (continua sendo conferido). */
  oldSpeiNote: string;
  oldSpeiShow: string;
  errNetwork: string;
  errUnavailable: string;
  errLimit: string;
  errConfig: string;
  errInvalid: string;
  reconnecting: string;
}

const ES: PayTexts = {
  kicker: "Finaliza tu compra",
  close: "Cerrar",
  method: "Forma de pago",
  methods: {
    spei: ["Transferencia SPEI", "Desde la app de tu banco"],
    card: ["Tarjeta", "Crédito o débito"],
    bizum: ["Bizum", "Con tu móvil"],
    mb_way: ["MB WAY", "Con tu móvil"],
  },
  name: "Nombre completo",
  email: "Correo electrónico",
  doc: "RFC o CURP (opcional)",
  errName: "Escribe tu nombre completo.",
  errEmail: "Escribe un correo electrónico válido.",
  errDoc: "Revisa el RFC o CURP (o deja el campo vacío).",
  goSpei: "Generar datos de transferencia",
  goCard: "Continuar al pago",
  creating: "Preparando tu pago…",
  secure: "Pago seguro",
  speiIntro: "Transfiere desde la app de tu banco con estos datos. El monto debe ser exacto.",
  clabe: "CLABE",
  bank: "Banco",
  holder: "Beneficiario",
  amount: "Monto exacto",
  reference: "Referencia (concepto)",
  expires: "Válido hasta",
  copy: "Copiar",
  copied: "¡Copiado!",
  copyFail: "Cópialo a mano",
  waitSpei: "Esperando tu transferencia…",
  waitNote:
    "Esta ventana se actualiza sola cuando recibamos el pago. Puedes cerrarla y volver después: los datos seguirán aquí.",
  cardIntro: {
    card: "Introduce los datos de tu tarjeta.",
    bizum: "Confirma el pago con Bizum desde tu móvil.",
    mb_way: "Confirma el pago con MB WAY desde tu móvil.",
  },
  loadingForm: "Cargando el formulario de pago…",
  confirming: "Confirmando tu pago…",
  confirmingNote: "No cierres esta página. Tarda solo unos segundos.",
  stuck: "¿Tu banco no confirmó el pago? Puedes intentarlo de nuevo.",
  paidTitle: "¡Pago confirmado!",
  paidGo: "Te llevamos a la página de acceso…",
  paidStay: "Gracias por tu compra.",
  continue: "Continuar",
  declinedTitle: "Pago no aprobado",
  declinedText: "Tu banco no aprobó el pago. No se te cobró nada. Prueba con otra tarjeta u otra forma de pago.",
  otherCard: "Intentar con otra tarjeta",
  expiredTitle: "Los datos de pago vencieron",
  expiredText: "No recibimos el pago a tiempo. Genera nuevos datos para pagar.",
  failedTitle: "El pago no se completó",
  failedText: "No se te cobró nada. Puedes intentarlo de nuevo.",
  regen: "Generar nuevos datos",
  again: "Intentar de nuevo",
  change: "Cambiar forma de pago",
  changeSpeiTitle: "¿Ya hiciste la transferencia?",
  changeSpeiText:
    "Si ya transferiste, no cambies: confirmamos tu pago aquí en unos minutos. Si cambias, seguiremos revisando esa transferencia hasta que venzan los datos.",
  keepWaiting: "Ya transferí, seguir esperando",
  changeAnyway: "Cambiar de todos modos",
  oldSpeiNote:
    "Seguimos revisando tu transferencia SPEI anterior: si ya la hiciste, te llevamos al acceso en cuanto llegue.",
  oldSpeiShow: "Ver datos de la transferencia anterior",
  errNetwork: "No pudimos conectar. Revisa tu conexión a internet e inténtalo de nuevo.",
  errUnavailable: "El sistema de pago no responde en este momento. Inténtalo de nuevo en unos segundos.",
  errLimit: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
  errConfig: "Este pago no está disponible en este momento. Inténtalo más tarde.",
  errInvalid: "Revisa tus datos e inténtalo de nuevo.",
  reconnecting: "Reconectando…",
};

const EN: PayTexts = {
  kicker: "Complete your purchase",
  close: "Close",
  method: "Payment method",
  methods: {
    spei: ["SPEI bank transfer", "From your bank app"],
    card: ["Card", "Credit or debit"],
    bizum: ["Bizum", "With your phone"],
    mb_way: ["MB WAY", "With your phone"],
  },
  name: "Full name",
  email: "Email",
  doc: "RFC or CURP (optional)",
  errName: "Enter your full name.",
  errEmail: "Enter a valid email address.",
  errDoc: "Check the RFC or CURP (or leave it blank).",
  goSpei: "Get transfer details",
  goCard: "Continue to payment",
  creating: "Preparing your payment…",
  secure: "Secure payment",
  speiIntro: "Transfer from your bank app using these details. The amount must be exact.",
  clabe: "CLABE",
  bank: "Bank",
  holder: "Beneficiary",
  amount: "Exact amount",
  reference: "Reference",
  expires: "Valid until",
  copy: "Copy",
  copied: "Copied!",
  copyFail: "Copy it by hand",
  waitSpei: "Waiting for your transfer…",
  waitNote:
    "This window updates by itself when we receive the payment. You can close it and come back later: the details will still be here.",
  cardIntro: {
    card: "Enter your card details.",
    bizum: "Confirm the payment with Bizum on your phone.",
    mb_way: "Confirm the payment with MB WAY on your phone.",
  },
  loadingForm: "Loading the payment form…",
  confirming: "Confirming your payment…",
  confirmingNote: "Don't close this page. It only takes a few seconds.",
  stuck: "Didn't your bank confirm the payment? You can try again.",
  paidTitle: "Payment confirmed!",
  paidGo: "Taking you to your access page…",
  paidStay: "Thank you for your purchase.",
  continue: "Continue",
  declinedTitle: "Payment declined",
  declinedText: "Your bank didn't approve the payment. You were not charged. Try another card or payment method.",
  otherCard: "Try another card",
  expiredTitle: "The payment details expired",
  expiredText: "We didn't receive the payment in time. Get new details to pay.",
  failedTitle: "The payment wasn't completed",
  failedText: "You were not charged. You can try again.",
  regen: "Get new details",
  again: "Try again",
  change: "Change payment method",
  changeSpeiTitle: "Already made the transfer?",
  changeSpeiText:
    "If you already transferred, don't change: we'll confirm your payment here in a few minutes. If you change, we'll keep checking that transfer until the details expire.",
  keepWaiting: "I already transferred, keep waiting",
  changeAnyway: "Change anyway",
  oldSpeiNote:
    "We're still checking your previous SPEI transfer: if you already made it, we'll take you to your access as soon as it arrives.",
  oldSpeiShow: "See previous transfer details",
  errNetwork: "We couldn't connect. Check your internet connection and try again.",
  errUnavailable: "The payment system isn't responding right now. Try again in a few seconds.",
  errLimit: "Too many attempts. Wait a few minutes and try again.",
  errConfig: "This payment isn't available right now. Please try again later.",
  errInvalid: "Check your details and try again.",
  reconnecting: "Reconnecting…",
};

const PT: PayTexts = {
  kicker: "Finalize sua compra",
  close: "Fechar",
  method: "Forma de pagamento",
  methods: {
    spei: ["Transferência SPEI", "Pelo app do seu banco"],
    card: ["Cartão", "Crédito ou débito"],
    bizum: ["Bizum", "Pelo telemóvel"],
    mb_way: ["MB WAY", "Pelo telemóvel"],
  },
  name: "Nome completo",
  email: "E-mail",
  doc: "RFC ou CURP (opcional)",
  errName: "Escreva seu nome completo.",
  errEmail: "Escreva um e-mail válido.",
  errDoc: "Confira o RFC ou CURP (ou deixe em branco).",
  goSpei: "Gerar dados da transferência",
  goCard: "Continuar para o pagamento",
  creating: "Preparando seu pagamento…",
  secure: "Pagamento seguro",
  speiIntro: "Transfira pelo app do seu banco com estes dados. O valor precisa ser exato.",
  clabe: "CLABE",
  bank: "Banco",
  holder: "Beneficiário",
  amount: "Valor exato",
  reference: "Referência",
  expires: "Válido até",
  copy: "Copiar",
  copied: "Copiado!",
  copyFail: "Copie à mão",
  waitSpei: "Aguardando sua transferência…",
  waitNote:
    "Esta janela se atualiza sozinha quando o pagamento chegar. Você pode fechá-la e voltar depois: os dados continuam aqui.",
  cardIntro: {
    card: "Digite os dados do seu cartão.",
    bizum: "Confirme o pagamento com Bizum no seu telemóvel.",
    mb_way: "Confirme o pagamento com MB WAY no seu telemóvel.",
  },
  loadingForm: "Carregando o formulário de pagamento…",
  confirming: "Confirmando seu pagamento…",
  confirmingNote: "Não feche esta página. Leva só alguns segundos.",
  stuck: "Seu banco não confirmou o pagamento? Você pode tentar de novo.",
  paidTitle: "Pagamento confirmado!",
  paidGo: "Levando você para a página de acesso…",
  paidStay: "Obrigado pela sua compra.",
  continue: "Continuar",
  declinedTitle: "Pagamento não aprovado",
  declinedText: "Seu banco não aprovou o pagamento. Nada foi cobrado. Tente outro cartão ou outra forma de pagamento.",
  otherCard: "Tentar com outro cartão",
  expiredTitle: "Os dados de pagamento venceram",
  expiredText: "O pagamento não chegou a tempo. Gere novos dados para pagar.",
  failedTitle: "O pagamento não foi concluído",
  failedText: "Nada foi cobrado. Você pode tentar de novo.",
  regen: "Gerar novos dados",
  again: "Tentar de novo",
  change: "Mudar forma de pagamento",
  changeSpeiTitle: "Você já fez a transferência?",
  changeSpeiText:
    "Se já transferiu, não mude: confirmamos seu pagamento aqui em poucos minutos. Se mudar, continuamos conferindo essa transferência até os dados vencerem.",
  keepWaiting: "Já transferi, continuar aguardando",
  changeAnyway: "Mudar mesmo assim",
  oldSpeiNote:
    "Continuamos conferindo sua transferência SPEI anterior: se você já transferiu, levamos você ao acesso assim que ela chegar.",
  oldSpeiShow: "Ver os dados da transferência anterior",
  errNetwork: "Não conseguimos conectar. Confira sua internet e tente de novo.",
  errUnavailable: "O sistema de pagamento não está respondendo agora. Tente de novo em alguns segundos.",
  errLimit: "Muitas tentativas. Espere alguns minutos e tente de novo.",
  errConfig: "Este pagamento não está disponível agora. Tente mais tarde.",
  errInvalid: "Confira seus dados e tente de novo.",
  reconnecting: "Reconectando…",
};

const ALL: Record<PayLocale, PayTexts> = { es: ES, en: EN, pt: PT };

export function payTexts(locale: PayLocale): PayTexts {
  return ALL[locale] || ES;
}

/** Controles da simulação (prévia do Offer Studio): para você, em português do Brasil. */
export const SIM_TEXTS = {
  banner: "Prévia do Offer Studio: nada é cobrado. Use os botões de simulação para testar.",
  cardBox:
    "Aqui aparece o formulário de pagamento da Kyvo (cartão, Bizum ou MB WAY). Na prévia, simule o resultado com os botões abaixo.",
  approve: "Simular pagamento aprovado",
  decline: "Simular pagamento recusado",
  expire: "Simular dados vencidos",
  noThanks: "Na prévia: este produto não tem página de obrigado escolhida (Links e checkouts).",
  documentPreview:
    "Na prévia de uma página só, o comprador não vai para a página de obrigado. Use “Ver página” da oferta.",
};

/** Idioma das datas e valores (BCP 47) pelo idioma do produto e a moeda. */
export function localeTag(locale: PayLocale, currency: PayCurrency): string {
  if (locale === "es") return currency === "EUR" ? "es-ES" : "es-MX";
  if (locale === "pt") return currency === "EUR" ? "pt-PT" : "pt-BR";
  return "en-US";
}

/** Valor em centavos formatado na moeda ("MX$497.00", "29,90 €"…). */
export function formatMoney(cents: number, currency: PayCurrency, locale: PayLocale): string {
  try {
    return new Intl.NumberFormat(localeTag(locale, currency), { style: "currency", currency: currency }).format(
      cents / 100,
    );
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Data e hora curtas no idioma do comprador (null = sem data). */
export function formatDate(iso: string | null, locale: PayLocale, currency: PayCurrency): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(localeTag(locale, currency), {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}
