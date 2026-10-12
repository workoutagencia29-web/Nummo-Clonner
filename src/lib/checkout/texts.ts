/**
 * Textos do checkout do Offer Studio para quem compra, por idioma (pt, es, en):
 * o idioma vem da moeda da oferta (real → português; peso → espanhol; dólar →
 * inglês; euro → português ou espanhol, escolhido no produto — ver
 * CHECKOUT_LOCALES em ./rules.ts).
 *
 * Os títulos, o botão, o cronômetro e os selos podem ser trocados no painel
 * (CHECKOUT_EDITABLE_TEXTS; vazio = o padrão do idioma). O resto (rótulos dos
 * campos, erros, PIX) é fixo.
 *
 * Sem dependências e sem desestruturação: o script da página importa daqui
 * (alvo Safari 13).
 */

export type CheckoutLang = "pt" | "es" | "en";

/** Textos que o painel deixa trocar, na ordem da seção "Aparência". */
export const CHECKOUT_EDITABLE_TEXTS = [
  "summaryTitle",
  "dataTitle",
  "deliveryTitle",
  "bumpsTitle",
  "bumpCheck",
  "paymentTitle",
  "payButton",
  "timerText",
  "badgeSecure",
  "badgeGuarantee",
  "testimonialsTitle",
] as const;
export type CheckoutEditableText = (typeof CHECKOUT_EDITABLE_TEXTS)[number];

/** Nome de cada texto editável no painel. */
export const EDITABLE_TEXT_LABEL: Record<CheckoutEditableText, string> = {
  summaryTitle: "Título do resumo",
  dataTitle: "Título dos dados",
  deliveryTitle: "Título da entrega",
  bumpsTitle: "Título dos order bumps",
  bumpCheck: "Caixa do order bump",
  paymentTitle: "Título do pagamento",
  payButton: "Botão de pagar",
  timerText: "Frase do cronômetro",
  badgeSecure: "Selo de compra segura",
  badgeGuarantee: "Selo de garantia",
  testimonialsTitle: "Título dos depoimentos",
};

/** Tamanho máximo de cada texto editável (o botão é curto). */
export function editableTextMax(key: CheckoutEditableText): number {
  return key === "payButton" || key === "bumpCheck" ? 40 : 80;
}

type EditableTexts = Record<CheckoutEditableText, string>;

const EDITABLE: Record<CheckoutLang, EditableTexts> = {
  pt: {
    summaryTitle: "Resumo do pedido",
    dataTitle: "Seus dados",
    deliveryTitle: "Entrega",
    bumpsTitle: "Aproveite também",
    bumpCheck: "Sim, quero adicionar",
    paymentTitle: "Pagamento",
    payButton: "Pagar agora",
    timerText: "Oferta termina em",
    badgeSecure: "Compra 100% segura",
    badgeGuarantee: "Garantia de 7 dias",
    testimonialsTitle: "Quem comprou aprova",
  },
  es: {
    summaryTitle: "Resumen del pedido",
    dataTitle: "Tus datos",
    deliveryTitle: "Envío",
    bumpsTitle: "Aprovecha también",
    bumpCheck: "Sí, quiero agregarlo",
    paymentTitle: "Pago",
    payButton: "Pagar ahora",
    timerText: "La oferta termina en",
    badgeSecure: "Compra 100% segura",
    badgeGuarantee: "Garantía de 7 días",
    testimonialsTitle: "Lo que dicen nuestros clientes",
  },
  en: {
    summaryTitle: "Order summary",
    dataTitle: "Your details",
    deliveryTitle: "Shipping",
    bumpsTitle: "You may also like",
    bumpCheck: "Yes, add it to my order",
    paymentTitle: "Payment",
    payButton: "Pay now",
    timerText: "Offer ends in",
    badgeSecure: "100% secure checkout",
    badgeGuarantee: "7-day money-back guarantee",
    testimonialsTitle: "What our customers say",
  },
};

/** Botão de pagar com PIX (o padrão quando o gateway é de PIX). */
const PIX_BUTTON = "Pagar com PIX";

/**
 * Texto padrão (o que vale quando o painel deixa vazio). `pix`: o gateway é de
 * PIX (o botão diz "Pagar com PIX").
 */
export function defaultEditableText(lang: CheckoutLang, key: CheckoutEditableText, pix = false): string {
  if (key === "payButton" && pix && lang === "pt") return PIX_BUTTON;
  return EDITABLE[lang][key];
}

/** Texto que vale: o trocado no painel ou o padrão do idioma. */
export function editableText(
  lang: CheckoutLang,
  key: CheckoutEditableText,
  overrides: Partial<Record<CheckoutEditableText, string>> | null | undefined,
  pix = false,
): string {
  const own = overrides ? overrides[key] : undefined;
  return own?.trim() ? own.trim() : defaultEditableText(lang, key, pix);
}

/** Textos fixos da página de checkout. */
export interface CheckoutFixedTexts {
  name: string;
  email: string;
  phone: string;
  /** Documento: CPF no real. */
  document: string;
  cpf: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  shippingFree: string;
  subtotal: string;
  shipping: string;
  total: string;
  from: string;
  required: string;
  invalidName: string;
  invalidEmail: string;
  invalidPhone: string;
  invalidCpf: string;
  invalidCep: string;
  cepNotFound: string;
  pixInstant: string;
  pixTitle: string;
  pixCopy: string;
  pixCopied: string;
  pixWaiting: string;
  pixExpiresIn: string;
  pixExpired: string;
  pixNew: string;
  pixSteps: string;
  approved: string;
  declined: string;
  unavailable: string;
  tryAgain: string;
  /** Selo do topo ("Pagamento seguro"). */
  secure: string;
  chooseShipping: string;
  /** Placeholder do frete antes do CEP ("Preencha seu CEP para encontrar o melhor frete"). */
  cepForShipping: string;
  cepForShippingHint: string;
  /** Seletor de quantidade (rótulos para leitores de tela). */
  quantity: string;
  qtyLess: string;
  qtyMore: string;
  cepSearching: string;
  optional: string;
  fixErrors: string;
  pixCreating: string;
  pixScan: string;
  pixCopyLabel: string;
  pixAmount: string;
  redirecting: string;
  approvedStay: string;
  errNetwork: string;
  errLimit: string;
  errInvalid: string;
  footer: string;
  /** Link do rodapé que reabre o aviso de cookies (no lugar do botão flutuante, que cobria os campos). */
  cookies: string;
  editData: string;
  /** Botão da tela do PIX: volta ao formulário (dados, bumps, frete). */
  pixChange: string;
  /** Confirmação antes de largar um PIX aberto (quem já pagou espera). */
  pixChangeTitle: string;
  pixChangeText: string;
  pixKeep: string;
  pixChangeAnyway: string;
  /** Formulário com um PIX anterior ainda conferido. */
  pixOldNote: string;
  pixOldShow: string;
  /** "Gerar novo PIX" sem os dados na memória (a página foi recarregada). */
  fillAgain: string;
}

const FIXED: Record<CheckoutLang, CheckoutFixedTexts> = {
  pt: {
    name: "Nome completo",
    email: "E-mail",
    phone: "Telefone / WhatsApp",
    document: "Documento",
    cpf: "CPF",
    cep: "CEP",
    street: "Rua",
    number: "Número",
    complement: "Complemento",
    neighborhood: "Bairro",
    city: "Cidade",
    state: "Estado",
    shippingFree: "Grátis",
    subtotal: "Subtotal",
    shipping: "Frete",
    total: "Total",
    from: "de",
    required: "Preencha este campo.",
    invalidName: "Digite o nome completo.",
    invalidEmail: "E-mail inválido. Confira.",
    invalidPhone: "Telefone inválido. Use o DDD e o número.",
    invalidCpf: "CPF inválido. Confira os números.",
    invalidCep: "CEP inválido.",
    cepNotFound: "Não encontramos o CEP. Preencha o endereço.",
    pixInstant: "Aprovação imediata",
    pixTitle: "Pague com PIX",
    pixCopy: "Copiar código",
    pixCopied: "Código copiado!",
    pixWaiting: "Aguardando o pagamento…",
    pixExpiresIn: "O código expira em",
    pixExpired: "O código PIX expirou.",
    pixNew: "Gerar novo PIX",
    pixSteps:
      "Abra o app do seu banco, escolha pagar com PIX (QR Code ou copia e cola) e confirme. A confirmação chega aqui sozinha.",
    approved: "Pagamento aprovado!",
    declined: "O pagamento não foi aprovado.",
    unavailable: "Pagamento indisponível no momento. Tente de novo em alguns minutos.",
    tryAgain: "Tentar de novo",
    secure: "Pagamento seguro",
    chooseShipping: "Escolha o melhor frete para você",
    cepForShipping: "Preencha seu CEP para encontrar o melhor frete",
    cepForShippingHint: "Após preenchido, encontraremos as melhores opções pra você",
    quantity: "Quantidade",
    qtyLess: "Diminuir a quantidade",
    qtyMore: "Aumentar a quantidade",
    cepSearching: "Buscando o endereço…",
    optional: "opcional",
    fixErrors: "Confira os campos marcados em vermelho.",
    pixCreating: "Gerando o seu PIX…",
    pixScan: "Escaneie o QR Code com o app do seu banco:",
    pixCopyLabel: "Ou copie o código PIX (copia e cola):",
    pixAmount: "Valor a pagar",
    redirecting: "Levando você para a página de confirmação…",
    approvedStay: "Obrigado pela compra! Os detalhes chegam no seu e-mail.",
    errNetwork: "Sem conexão. Confira a internet e tente de novo.",
    errLimit: "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.",
    errInvalid: "Confira os seus dados e tente de novo.",
    footer: "Ambiente seguro. Os seus dados são usados só para processar este pedido.",
    cookies: "Preferências de cookies",
    editData: "Alterar meus dados",
    pixChange: "Alterar dados ou pedido",
    pixChangeTitle: "Você já pagou este PIX?",
    pixChangeText:
      "Se já pagou, não altere: a confirmação chega aqui em instantes. Se alterar, continuamos conferindo este PIX até ele vencer.",
    pixKeep: "Já paguei, continuar esperando",
    pixChangeAnyway: "Alterar mesmo assim",
    pixOldNote: "Ainda conferimos o PIX anterior: se você já pagou, a confirmação aparece aqui.",
    pixOldShow: "Ver o PIX anterior",
    fillAgain: "Preencher os dados de novo",
  },
  es: {
    name: "Nombre completo",
    email: "Correo electrónico",
    phone: "Teléfono / WhatsApp",
    document: "Documento",
    cpf: "CPF",
    cep: "Código postal",
    street: "Calle",
    number: "Número",
    complement: "Complemento",
    neighborhood: "Colonia / barrio",
    city: "Ciudad",
    state: "Estado / provincia",
    shippingFree: "Gratis",
    subtotal: "Subtotal",
    shipping: "Envío",
    total: "Total",
    from: "antes",
    required: "Completa este campo.",
    invalidName: "Escribe tu nombre completo.",
    invalidEmail: "Correo inválido. Revísalo.",
    invalidPhone: "Teléfono inválido.",
    invalidCpf: "Documento inválido.",
    invalidCep: "Código postal inválido.",
    cepNotFound: "No encontramos el código postal. Completa la dirección.",
    pixInstant: "Aprobación inmediata",
    pixTitle: "Paga con PIX",
    pixCopy: "Copiar código",
    pixCopied: "¡Código copiado!",
    pixWaiting: "Esperando el pago…",
    pixExpiresIn: "El código vence en",
    pixExpired: "El código PIX venció.",
    pixNew: "Generar nuevo PIX",
    pixSteps: "Abre la app de tu banco, elige pagar con PIX y confirma.",
    approved: "¡Pago aprobado!",
    declined: "El pago no fue aprobado.",
    unavailable: "Pago no disponible en este momento. Inténtalo de nuevo en unos minutos.",
    tryAgain: "Intentar de nuevo",
    secure: "Pago seguro",
    chooseShipping: "Elige el mejor envío para ti",
    cepForShipping: "Introduce tu código postal para ver el mejor envío",
    cepForShippingHint: "Al completarlo, te mostramos las mejores opciones",
    quantity: "Cantidad",
    qtyLess: "Disminuir la cantidad",
    qtyMore: "Aumentar la cantidad",
    cepSearching: "Buscando la dirección…",
    optional: "opcional",
    fixErrors: "Revisa los campos marcados en rojo.",
    pixCreating: "Generando tu PIX…",
    pixScan: "Escanea el código QR con la app de tu banco:",
    pixCopyLabel: "O copia el código PIX:",
    pixAmount: "Monto a pagar",
    redirecting: "Te llevamos a la página de confirmación…",
    approvedStay: "¡Gracias por tu compra! Recibirás los detalles en tu correo.",
    errNetwork: "Sin conexión. Revisa tu internet e inténtalo de nuevo.",
    errLimit: "Demasiados intentos seguidos. Espera unos minutos e inténtalo de nuevo.",
    errInvalid: "Revisa tus datos e inténtalo de nuevo.",
    footer: "Sitio seguro. Tus datos se usan solo para procesar este pedido.",
    cookies: "Preferencias de cookies",
    editData: "Cambiar mis datos",
    pixChange: "Cambiar datos o pedido",
    pixChangeTitle: "¿Ya pagaste este PIX?",
    pixChangeText:
      "Si ya pagaste, no lo cambies: la confirmación llega aquí en unos instantes. Si lo cambias, seguimos revisando este PIX hasta que venza.",
    pixKeep: "Ya pagué, seguir esperando",
    pixChangeAnyway: "Cambiar de todos modos",
    pixOldNote: "Seguimos revisando el PIX anterior: si ya pagaste, la confirmación aparece aquí.",
    pixOldShow: "Ver el PIX anterior",
    fillAgain: "Completar mis datos de nuevo",
  },
  en: {
    name: "Full name",
    email: "Email",
    phone: "Phone / WhatsApp",
    document: "ID number",
    cpf: "CPF",
    cep: "ZIP code",
    street: "Street",
    number: "Number",
    complement: "Apt, suite (optional)",
    neighborhood: "District",
    city: "City",
    state: "State",
    shippingFree: "Free",
    subtotal: "Subtotal",
    shipping: "Shipping",
    total: "Total",
    from: "was",
    required: "Please fill in this field.",
    invalidName: "Enter your full name.",
    invalidEmail: "Invalid email. Please check it.",
    invalidPhone: "Invalid phone number.",
    invalidCpf: "Invalid ID number.",
    invalidCep: "Invalid ZIP code.",
    cepNotFound: "We couldn't find this ZIP code. Please fill in the address.",
    pixInstant: "Instant approval",
    pixTitle: "Pay with PIX",
    pixCopy: "Copy code",
    pixCopied: "Code copied!",
    pixWaiting: "Waiting for payment…",
    pixExpiresIn: "The code expires in",
    pixExpired: "The PIX code expired.",
    pixNew: "Generate a new PIX",
    pixSteps: "Open your bank app, choose to pay with PIX and confirm.",
    approved: "Payment approved!",
    declined: "The payment was not approved.",
    unavailable: "Payment unavailable right now. Please try again in a few minutes.",
    tryAgain: "Try again",
    secure: "Secure payment",
    chooseShipping: "Choose the best shipping for you",
    cepForShipping: "Enter your ZIP code to find the best shipping",
    cepForShippingHint: "Once filled in, we'll show you the best options",
    quantity: "Quantity",
    qtyLess: "Decrease quantity",
    qtyMore: "Increase quantity",
    cepSearching: "Looking up the address…",
    optional: "optional",
    fixErrors: "Please check the fields marked in red.",
    pixCreating: "Generating your PIX…",
    pixScan: "Scan the QR code with your bank app:",
    pixCopyLabel: "Or copy the PIX code:",
    pixAmount: "Amount due",
    redirecting: "Taking you to the confirmation page…",
    approvedStay: "Thank you for your purchase! The details are on their way to your email.",
    errNetwork: "No connection. Check your internet and try again.",
    errLimit: "Too many attempts in a row. Wait a few minutes and try again.",
    errInvalid: "Please check your details and try again.",
    footer: "Secure checkout. Your details are used only to process this order.",
    cookies: "Cookie preferences",
    editData: "Edit my details",
    pixChange: "Edit details or order",
    pixChangeTitle: "Already paid this PIX?",
    pixChangeText:
      "If you already paid, don't change anything: the confirmation will show up here in a moment. If you change, we'll keep checking this PIX until it expires.",
    pixKeep: "I paid, keep waiting",
    pixChangeAnyway: "Change anyway",
    pixOldNote: "We're still checking the previous PIX: if you already paid, the confirmation will show up here.",
    pixOldShow: "See the previous PIX",
    fillAgain: "Fill in my details again",
  },
};

export function checkoutFixedTexts(lang: CheckoutLang): CheckoutFixedTexts {
  return FIXED[lang] || FIXED.pt;
}

/** Idioma das datas e valores (BCP 47) pelo idioma dos textos e a moeda. */
export function checkoutLocaleTag(lang: CheckoutLang, currency: string): string {
  if (lang === "es") return currency === "EUR" ? "es-ES" : "es-MX";
  if (lang === "pt") return currency === "EUR" ? "pt-PT" : "pt-BR";
  return "en-US";
}

/** Valor em centavos na moeda, para quem compra ("R$ 297,00", "$497.00", "29,90 €"). */
export function checkoutMoney(cents: number, currency: string, lang: CheckoutLang): string {
  try {
    return new Intl.NumberFormat(checkoutLocaleTag(lang, currency), { style: "currency", currency: currency }).format(
      cents / 100,
    );
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** "PT" (coluna do produto) → "pt". */
export function checkoutLang(locale: string | null | undefined): CheckoutLang {
  const l = String(locale || "").toLowerCase();
  return l === "es" || l === "en" ? l : "pt";
}
