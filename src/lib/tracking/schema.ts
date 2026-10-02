/**
 * Contrato do rastreamento de cada oferta (Fase 4).
 *
 * Cada oferta tem os PRÓPRIOS pixels (tabela PixelConfig), regras de evento
 * (EventRule) e configurações gerais (Offer.tracking), validadas aqui. O painel,
 * a prévia e o ZIP usam sempre estes esquemas — nada de JSON solto.
 *
 * Os nomes de evento são neutros (LEAD, INITIATE_CHECKOUT…) e cada plataforma
 * recebe o nome dela (ver VENDOR_EVENT_NAMES em ./vendors).
 */
import { z } from "zod";

export const PIXEL_VENDORS = ["META", "TIKTOK", "KWAI", "GA4", "GOOGLE_ADS", "UTMIFY"] as const;
export type PixelVendorId = (typeof PIXEL_VENDORS)[number];

export const TRACKING_EVENTS = [
  "PAGE_VIEW",
  "VIEW_CONTENT",
  "INITIATE_CHECKOUT",
  "LEAD",
  "COMPLETE_REGISTRATION",
  "CONTACT",
  "ADD_TO_CART",
  "PURCHASE",
] as const;
export type TrackingEventId = (typeof TRACKING_EVENTS)[number];

/** Eventos que podem virar regra (o PageView dispara sozinho ao abrir a página). */
export const RULE_EVENTS = [
  "VIEW_CONTENT",
  "INITIATE_CHECKOUT",
  "LEAD",
  "COMPLETE_REGISTRATION",
  "CONTACT",
  "ADD_TO_CART",
  "PURCHASE",
] as const satisfies readonly TrackingEventId[];
export type RuleEventId = (typeof RULE_EVENTS)[number];

export const EVENT_TRIGGERS = [
  "PAGE_LOAD",
  "TIME_ON_PAGE",
  "SCROLL_DEPTH",
  "CHECKOUT_CLICK",
  "ELEMENT_CLICK",
  "FORM_SUBMIT",
] as const;
export type EventTriggerId = (typeof EVENT_TRIGGERS)[number];

export const TRACKING_EVENT_LABEL: Record<TrackingEventId, string> = {
  PAGE_VIEW: "Visualização de página (PageView)",
  VIEW_CONTENT: "Visualizou conteúdo (ViewContent)",
  INITIATE_CHECKOUT: "Iniciou checkout (InitiateCheckout)",
  LEAD: "Cadastro / lead (Lead)",
  COMPLETE_REGISTRATION: "Cadastro completo (CompleteRegistration)",
  CONTACT: "Contato / WhatsApp (Contact)",
  ADD_TO_CART: "Adicionou ao carrinho (AddToCart)",
  PURCHASE: "Compra (Purchase)",
};

export const EVENT_TRIGGER_LABEL: Record<EventTriggerId, string> = {
  PAGE_LOAD: "Ao abrir a página",
  TIME_ON_PAGE: "Depois de X segundos na página",
  SCROLL_DEPTH: "Ao rolar X% da página",
  CHECKOUT_CLICK: "Ao clicar em um botão de checkout",
  ELEMENT_CLICK: "Ao clicar em um elemento / link da oferta",
  FORM_SUBMIT: "Ao enviar um formulário",
};

export const PIXEL_VENDOR_LABEL: Record<PixelVendorId, string> = {
  META: "Meta (Facebook e Instagram)",
  TIKTOK: "TikTok",
  KWAI: "Kwai",
  GA4: "Google Analytics 4",
  GOOGLE_ADS: "Google Ads",
  UTMIFY: "UTMify",
};

const trimmed = (max: number) => z.string().trim().max(max);

/** Formato do ID de cada plataforma, com mensagem em português. */
export const PIXEL_ID_RULES: Record<PixelVendorId, { pattern: RegExp; example: string; message: string }> = {
  META: {
    pattern: /^\d{10,20}$/,
    example: "123456789012345",
    message: "O ID do pixel da Meta tem só números (10 a 20 dígitos).",
  },
  TIKTOK: {
    pattern: /^[A-Z0-9]{15,25}$/,
    example: "C1ABCDEFGHIJ2KLMNOPQ",
    message: "O ID do pixel do TikTok tem letras maiúsculas e números (ex.: C1ABCDEFGHIJ2KLMNOPQ).",
  },
  KWAI: { pattern: /^\d{6,25}$/, example: "283746592837465", message: "O ID do pixel do Kwai tem só números." },
  GA4: {
    pattern: /^G-[A-Z0-9]{4,15}$/,
    example: "G-ABC123DEF4",
    message: "O ID do Google Analytics começa com G- (ex.: G-ABC123DEF4).",
  },
  GOOGLE_ADS: {
    pattern: /^AW-\d{6,15}$/,
    example: "AW-123456789",
    message: "O ID do Google Ads começa com AW- (ex.: AW-123456789).",
  },
  UTMIFY: {
    pattern: /^[A-Za-z0-9_-]{6,64}$/,
    example: "66f1a2b3c4d5e6f7a8b9c0d1",
    message: "Cole o ID do pixel que aparece no painel da UTMify.",
  },
};

/** Opções por plataforma (coluna PixelConfig.options). */
export const MetaOptionsSchema = z.object({
  /** Envia eventos também pela API de Conversões (precisa do eventos.php na hospedagem). */
  capi: z.boolean().default(false),
});
export const TikTokOptionsSchema = z.object({
  /** Envia eventos também pela Events API (precisa do eventos.php na hospedagem). */
  eventsApi: z.boolean().default(false),
});
export const GoogleAdsOptionsSchema = z.object({
  /** Rótulo de conversão por evento: send_to = "AW-123/rotulo". Eventos sem rótulo não viram conversão. */
  conversionLabels: z.partialRecord(z.enum(TRACKING_EVENTS), trimmed(80)).default({}),
});
export const UtmifyOptionsSchema = z.object({
  /** Script de UTMs da UTMify (repasse de UTMs para o checkout). */
  utmsScript: z.boolean().default(true),
  /** data-utmify-prevent-subids (não mexer nos subids). */
  preventSubids: z.boolean().default(false),
  /** data-utmify-prevent-xcod-sck (não preencher xcod/sck da Hotmart). */
  preventXcodSck: z.boolean().default(false),
});
export const EmptyOptionsSchema = z.object({});

export const VENDOR_OPTIONS_SCHEMA = {
  META: MetaOptionsSchema,
  TIKTOK: TikTokOptionsSchema,
  KWAI: EmptyOptionsSchema,
  GA4: EmptyOptionsSchema,
  GOOGLE_ADS: GoogleAdsOptionsSchema,
  UTMIFY: UtmifyOptionsSchema,
} as const satisfies Record<PixelVendorId, z.ZodType>;
export type VendorOptions<V extends PixelVendorId> = z.infer<(typeof VENDOR_OPTIONS_SCHEMA)[V]>;

/** Opções de um pixel com os valores padrão; opções inválidas voltam ao padrão. */
export function parseVendorOptions<V extends PixelVendorId>(vendor: V, value: unknown): VendorOptions<V> {
  const schema = VENDOR_OPTIONS_SCHEMA[vendor] as unknown as z.ZodType<VendorOptions<V>>;
  const parsed = schema.safeParse(value ?? {});
  return parsed.success ? parsed.data : schema.parse({});
}

/**
 * Plataformas com envio também pelo servidor (eventos.php no ZIP), a opção que
 * liga esse envio e o nome dele no painel. Só elas guardam token de API.
 */
export const SERVER_API_VENDORS = {
  META: { option: "capi", label: "API de Conversões" },
  TIKTOK: { option: "eventsApi", label: "Events API" },
} as const satisfies Partial<Record<PixelVendorId, { option: string; label: string }>>;
export type ServerApiVendorId = keyof typeof SERVER_API_VENDORS;

export function isServerApiVendor(vendor: PixelVendorId): vendor is ServerApiVendorId {
  return vendor in SERVER_API_VENDORS;
}

/** O envio pelo servidor está ligado nas opções deste pixel? */
export function serverApiEnabled(vendor: PixelVendorId, options: unknown): boolean {
  if (!isServerApiVendor(vendor)) return false;
  const parsed = parseVendorOptions(vendor, options) as Record<string, unknown>;
  return parsed[SERVER_API_VENDORS[vendor].option] === true;
}

/** Nome de evento personalizado por plataforma (sobrescreve o padrão). */
export const EventNameOverridesSchema = z.partialRecord(
  z.enum(PIXEL_VENDORS),
  z.partialRecord(z.enum(TRACKING_EVENTS), trimmed(60)),
);

export const CONSENT_MODES = ["OPT_IN", "NOTICE", "OFF"] as const;
export const CONSENT_MODE_LABEL: Record<(typeof CONSENT_MODES)[number], string> = {
  OPT_IN: "Pedir permissão antes de carregar os pixels (recomendado pela LGPD)",
  NOTICE: "Só avisar (os pixels carregam direto)",
  OFF: "Sem banner",
};

export const CODE_CATEGORIES = ["NECESSARY", "ANALYTICS", "MARKETING"] as const;
export const CODE_CATEGORY_LABEL: Record<(typeof CODE_CATEGORIES)[number], string> = {
  NECESSARY: "Essencial (carrega sempre)",
  ANALYTICS: "Estatística (espera o consentimento)",
  MARKETING: "Marketing (espera o consentimento)",
};

export type ConsentModeId = (typeof CONSENT_MODES)[number];
export type CodeCategoryId = (typeof CODE_CATEGORIES)[number];

export const CONSENT_POSITIONS = ["bottom", "bottom-left", "bottom-right"] as const;
export const CONSENT_POSITION_LABEL: Record<(typeof CONSENT_POSITIONS)[number], string> = {
  bottom: "Faixa no rodapé",
  "bottom-left": "Caixa no canto esquerdo",
  "bottom-right": "Caixa no canto direito",
};
export const CONSENT_THEMES = ["light", "dark"] as const;
export const CONSENT_THEME_LABEL: Record<(typeof CONSENT_THEMES)[number], string> = {
  light: "Claro",
  dark: "Escuro",
};
export const CURRENCIES = ["BRL", "USD", "EUR"] as const;
export const CURRENCY_LABEL: Record<(typeof CURRENCIES)[number], string> = {
  BRL: "Real (R$)",
  USD: "Dólar (US$)",
  EUR: "Euro (€)",
};

/** Nome de parâmetro repassado (utm_source, fbclid, sck…). */
export const FORWARD_PARAM_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * Categoria do código livre de cada PÁGINA (Page.customCode.category) quando a
 * pessoa nunca escolheu e o código não tem pixel nem tag de rastreamento:
 * "Essencial", para os códigos da Fase 3 continuarem rodando como antes. Sem
 * escolha e COM rastreador (pixel da Meta, gtag…), o código vale como
 * "Marketing" e espera o "Aceitar" (ver resolveCodeCategory em ./code-trackers).
 * O código livre da OFERTA (TrackingSettings.customCode) começa em "Marketing".
 */
export const PAGE_CODE_DEFAULT_CATEGORY: CodeCategoryId = "NECESSARY";

/** Categoria escolhida para o código livre de uma página (chave "category"); null = nunca escolhida. */
export function explicitPageCodeCategory(customCode: unknown): CodeCategoryId | null {
  const value =
    typeof customCode === "object" && customCode !== null && !Array.isArray(customCode)
      ? (customCode as Record<string, unknown>).category
      : undefined;
  return (CODE_CATEGORIES as readonly unknown[]).includes(value) ? (value as CodeCategoryId) : null;
}

/**
 * Categoria guardada do código livre de uma página, sem olhar o código (sem
 * escolha = "Essencial"). Para a categoria que vale de verdade (com a detecção
 * de pixels), use resolveCodeCategory de ./code-trackers.
 */
export function parsePageCodeCategory(customCode: unknown): CodeCategoryId {
  return explicitPageCodeCategory(customCode) ?? PAGE_CODE_DEFAULT_CATEGORY;
}

/** Parâmetros repassados por padrão (UTMs, IDs de clique e os da Hotmart/Kiwify). */
export const DEFAULT_FORWARD_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "ttclid",
  "kwai_click_id",
  "src",
  "sck",
  "xcod",
] as const;

/** Código livre (head / início e fim do body) com a categoria de consentimento. */
export const CodeSchema = z.object({
  head: z.string().max(200_000).default(""),
  bodyStart: z.string().max(200_000).default(""),
  bodyEnd: z.string().max(200_000).default(""),
  category: z.enum(CODE_CATEGORIES).default("MARKETING"),
});

/** Texto padrão do aviso de cookies (com "Aceitar"/"Recusar"). */
export const DEFAULT_CONSENT_TEXT =
  "Usamos cookies e tecnologias parecidas para melhorar sua experiência e medir nossos anúncios. Você pode aceitar ou recusar.";
/**
 * Texto padrão do modo "Só avisar" (o banner só tem o botão "Entendi"). Só
 * informa: continuar navegando não é consentimento (guia de cookies da ANPD),
 * então o texto não diz que a pessoa "concorda".
 */
export const DEFAULT_NOTICE_TEXT =
  "Usamos cookies e tecnologias parecidas para melhorar sua experiência e medir nossos anúncios.";
/** Texto padrão antigo do "Só avisar" (falava em concordar ao continuar navegando): vale como padrão. */
export const LEGACY_NOTICE_TEXT =
  "Usamos cookies e tecnologias parecidas para melhorar sua experiência e medir nossos anúncios. Ao continuar navegando, você concorda com isso.";

/**
 * Texto do aviso para o modo escolhido: o texto padrão de um modo vira o padrão
 * do outro (o de "Pedir permissão" fala em aceitar ou recusar, que o modo "Só
 * avisar" não tem). O padrão antigo do "Só avisar" vira o novo. Texto escrito
 * pela pessoa fica como está.
 */
export function consentTextFor(mode: ConsentModeId, text: string): string {
  const current = text.trim();
  const isDefault = (t: string) => current === t;
  if (mode === "NOTICE" && (isDefault(DEFAULT_CONSENT_TEXT) || isDefault(LEGACY_NOTICE_TEXT))) {
    return DEFAULT_NOTICE_TEXT;
  }
  if (mode !== "NOTICE" && (isDefault(DEFAULT_NOTICE_TEXT) || isDefault(LEGACY_NOTICE_TEXT))) {
    return DEFAULT_CONSENT_TEXT;
  }
  return text;
}

/** Texto padrão do link da política de privacidade e do botão do modo "Só avisar". */
export const DEFAULT_POLICY_LABEL = "Política de privacidade";
export const DEFAULT_NOTICE_LABEL = "Entendi";

/**
 * policyPageId = POLICY_NONE: o aviso fica sem link (escolha explícita). null =
 * automático: a página "Política de privacidade" da oferta, se houver (ver
 * resolvePolicyPage).
 */
export const POLICY_NONE = "none";

/** Nome/endereço que parece de uma política de privacidade. */
const PRIVACY_PAGE_RE = /privacidade|privacy|privacidad|lgpd|cookies/i;

/**
 * Página da política de privacidade usada automaticamente: a primeira página
 * do tipo "Política / Termos" cujo nome ou endereço fala em privacidade (os
 * Termos de uso não servem de política). null = nenhuma.
 */
export function autoPolicyPage<P extends { id: string; name: string; type: string; slug?: string }>(
  pages: readonly P[],
): P | null {
  return pages.find((p) => p.type === "LEGAL" && PRIVACY_PAGE_RE.test(`${p.name} ${p.slug ?? ""}`)) ?? null;
}

/**
 * Página do link "Política de privacidade" do aviso: a escolhida (se ainda
 * existir), nenhuma (POLICY_NONE) ou, sem escolha, a automática.
 */
export function resolvePolicyPage<P extends { id: string; name: string; type: string; slug?: string }>(
  policyPageId: string | null,
  pages: readonly P[],
): P | null {
  if (policyPageId === POLICY_NONE) return null;
  const chosen = policyPageId ? pages.find((p) => p.id === policyPageId) : undefined;
  return chosen ?? autoPolicyPage(pages);
}

export const ConsentSettingsSchema = z.object({
  mode: z.enum(CONSENT_MODES).default("OPT_IN"),
  text: trimmed(600).default(DEFAULT_CONSENT_TEXT),
  acceptLabel: trimmed(40).default("Aceitar"),
  rejectLabel: trimmed(40).default("Recusar"),
  /** Botão do modo "Só avisar". */
  noticeLabel: trimmed(40).default(DEFAULT_NOTICE_LABEL),
  /** Texto do link da política de privacidade. */
  policyLabel: trimmed(60).default(DEFAULT_POLICY_LABEL),
  /**
   * Página da oferta com a política de privacidade (link no banner). null =
   * automática (resolvePolicyPage); POLICY_NONE = aviso sem link.
   */
  policyPageId: z.string().max(40).nullable().default(null),
  position: z.enum(CONSENT_POSITIONS).default("bottom"),
  theme: z.enum(CONSENT_THEMES).default("dark"),
});

export const ForwardingSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  params: z
    .array(trimmed(40).regex(FORWARD_PARAM_RE))
    .max(40)
    .default([...DEFAULT_FORWARD_PARAMS]),
  /** Links de checkout/upsell/downsell (links da oferta e checkouts detectados). */
  toCheckout: z.boolean().default(true),
  /** Links entre páginas do funil. */
  toInternalLinks: z.boolean().default(true),
  /** Guarda os parâmetros do primeiro acesso por N dias (0 = só a visita atual). */
  persistDays: z.number().int().min(0).max(90).default(30),
});

/** Moeda e valor enviados com InitiateCheckout/Purchase (opcional). */
export const ValueSettingsSchema = z.object({
  currency: z.enum(CURRENCIES).default("BRL"),
  amount: z.number().min(0).max(1_000_000).nullable().default(null),
});

/** Offer.tracking */
export const TrackingSettingsSchema = z.object({
  consent: ConsentSettingsSchema.prefault({}),
  forwarding: ForwardingSettingsSchema.prefault({}),
  value: ValueSettingsSchema.prefault({}),
  eventNames: EventNameOverridesSchema.default({}),
  /** Código livre da oferta (todas as páginas), com categoria de consentimento. */
  customCode: CodeSchema.prefault({}),
  /** "Não sugerir mais" as regras recomendadas que faltam (aba Eventos). */
  dismissedRecommended: z.boolean().default(false),
});
export type TrackingSettings = z.infer<typeof TrackingSettingsSchema>;

/** Lê Offer.tracking com valores padrão; JSON inválido volta ao padrão sem quebrar a página. */
export function parseTrackingSettings(value: unknown): TrackingSettings {
  const parsed = TrackingSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : TrackingSettingsSchema.parse({});
}

/** Regra de evento (tabela EventRule). */
export const EventRuleInputSchema = z
  .object({
    pageId: z.string().max(40).nullable().default(null),
    event: z.enum(TRACKING_EVENTS),
    trigger: z.enum(EVENT_TRIGGERS),
    /** Segundos (TIME_ON_PAGE) ou % (SCROLL_DEPTH). */
    value: z.number().int().min(0).max(86_400).nullable().default(null),
    /** Seletor CSS (ELEMENT_CLICK). O painel gera [data-os-link="chave"] para links da oferta. */
    selector: trimmed(300).nullable().default(null),
    enabled: z.boolean().default(true),
  })
  .superRefine((rule, ctx) => {
    if (rule.event === "PAGE_VIEW") {
      ctx.addIssue({
        code: "custom",
        path: ["event"],
        message: "O PageView já dispara sozinho ao abrir a página. Escolha outro evento.",
      });
    }
    if (rule.trigger === "ELEMENT_CLICK" && rule.selector?.includes("<")) {
      ctx.addIssue({
        code: "custom",
        path: ["selector"],
        message: "Isso parece um trecho de HTML. Use um seletor CSS, como #botao-comprar ou .cta.",
      });
    }
    if (rule.trigger === "TIME_ON_PAGE" && !(rule.value && rule.value > 0)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Informe quantos segundos." });
    }
    if (rule.trigger === "SCROLL_DEPTH" && !(rule.value && rule.value > 0 && rule.value <= 100)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Informe uma porcentagem entre 1 e 100." });
    }
    if (rule.trigger === "ELEMENT_CLICK" && !rule.selector) {
      ctx.addIssue({ code: "custom", path: ["selector"], message: "Escolha o elemento ou link." });
    }
  });
export type EventRuleInput = z.infer<typeof EventRuleInputSchema>;

/**
 * Regras sugeridas para uma oferta nova (o painel oferece "Usar recomendadas").
 * PageView sempre dispara ao abrir a página — não precisa de regra.
 */
export const RECOMMENDED_RULES: ReadonlyArray<Omit<EventRuleInput, "pageId" | "enabled">> = [
  { event: "VIEW_CONTENT", trigger: "TIME_ON_PAGE", value: 15, selector: null },
  { event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK", value: null, selector: null },
  { event: "LEAD", trigger: "FORM_SUBMIT", value: null, selector: null },
];
