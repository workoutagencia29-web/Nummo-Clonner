/**
 * Configuração da página de checkout de um produto (CheckoutProduct.config):
 * o que o painel salva além das colunas (nome, valor, gateway…) — descrição,
 * foto e preço "de"; dados pedidos de quem compra; endereço e opções de frete;
 * order bumps; aparência (banners, logo, cor, cronômetro, selos, depoimentos)
 * e os textos trocados.
 *
 * Dois formatos:
 * - CheckoutConfig: o guardado (centavos, chaves do storage "a/3f/<sha>.webp"),
 *   lido com parseCheckoutConfig — valor estranho num campo não apaga o resto;
 * - CheckoutConfigDraft: o do formulário (valores digitados "29,90", imagens
 *   como "/os-assets/<sha>.webp"). checkoutConfigFromDraft confere e converte
 *   (mensagens em pt-BR por campo); a imagem ser da oferta o serviço confere.
 *
 * Os links de acesso dos bumps são privados: ficam aqui, mas nunca vão para a
 * página (só o servidor entrega a quem pagou).
 */
import { z } from "zod";
import {
  accessUrlProblem,
  formatAmount,
  normalizeAccessUrl,
  PAYMENT_LOCALES,
  type PaymentLocaleId,
  parseAmount,
} from "../payments/rules";
import {
  addressCurrencyProblem,
  BUMP_MIN_CENTS,
  BUYER_FIELDS,
  type BuyerField,
  CHECKOUT_LIMITS,
  type CheckoutCurrencyId,
  type CheckoutProviderId,
  isPixProvider,
  PIX_LIMITS,
} from "./rules";
import { CHECKOUT_EDITABLE_TEXTS, type CheckoutEditableText, editableTextMax } from "./texts";

// ─── Imagens ────────────────────────────────────────────────────────────────

const STORAGE_KEY_RE = /^a\/([0-9a-f]{2})\/([0-9a-f]{64}\.[a-z0-9]{1,8})$/;
const ASSET_SRC_RE = /^\/os-assets\/([0-9a-f]{64}\.[a-z0-9]{1,8})$/;

/** Chave do storage ("a/3f/<sha>.webp") → endereço da biblioteca ("/os-assets/<sha>.webp"). */
export function checkoutImageSrc(key: string | null | undefined): string | null {
  const m = STORAGE_KEY_RE.exec(key ?? "");
  return m ? `/os-assets/${m[2]}` : null;
}

/** Endereço da biblioteca (ou a própria chave) → chave do storage; null = vazio; undefined = inválido. */
export function checkoutImageKey(src: string | null | undefined): string | null | undefined {
  const v = (src ?? "").trim();
  if (!v) return null;
  if (STORAGE_KEY_RE.test(v)) return v;
  const m = ASSET_SRC_RE.exec(v);
  return m ? `a/${m[1].slice(0, 2)}/${m[1]}` : undefined;
}

// ─── Formato guardado ───────────────────────────────────────────────────────

/** Id curto de bump, frete ou depoimento (gerado no painel; o navegador do comprador manda os ids). */
export const ITEM_ID_RE = /^[a-z0-9]{4,16}$/;
const itemId = z.string().regex(ITEM_ID_RE);
const key = z.string().regex(STORAGE_KEY_RE).nullable().catch(null);
const cents = z.number().int().min(0).max(PIX_LIMITS.max);
const text = (max: number) => z.string().trim().max(max).catch("");

export const ShippingOptionSchema = z.object({
  id: itemId,
  name: z.string().trim().min(1).max(CHECKOUT_LIMITS.shippingName),
  /** Prazo em texto ("3 a 7 dias úteis"). */
  eta: text(CHECKOUT_LIMITS.shippingEta).default(""),
  /** 0 = grátis. */
  priceCents: cents,
});
export type ShippingOption = z.infer<typeof ShippingOptionSchema>;

export const BumpSchema = z.object({
  id: itemId,
  title: z.string().trim().min(1).max(CHECKOUT_LIMITS.bumpTitle),
  description: text(CHECKOUT_LIMITS.bumpDescription).default(""),
  priceCents: z.number().int().min(BUMP_MIN_CENTS).max(PIX_LIMITS.max),
  compareAtCents: cents.nullable().catch(null).default(null),
  imageKey: key.default(null),
  /** Link de acesso do bump (privado: nunca vai para a página). */
  accessUrl: z.string().trim().max(2000).catch("").default(""),
});
export type Bump = z.infer<typeof BumpSchema>;

export const TestimonialSchema = z.object({
  id: itemId,
  text: z.string().trim().min(1).max(CHECKOUT_LIMITS.testimonialText),
  name: z.string().trim().min(1).max(CHECKOUT_LIMITS.testimonialName),
  photoKey: key.default(null),
});
export type Testimonial = z.infer<typeof TestimonialSchema>;

const HEX_RE = /^#[0-9a-f]{6}$/i;
/** Cor principal padrão (botão, destaques): verde de checkout escuro o bastante para o texto branco (5:1). */
export const DEFAULT_CHECKOUT_COLOR = "#15803d";

const textsSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((raw) => {
    const out: Partial<Record<CheckoutEditableText, string>> = {};
    for (const k of CHECKOUT_EDITABLE_TEXTS) {
      const v = raw[k];
      if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, editableTextMax(k));
    }
    return out;
  });

/** Lista que guarda só os itens válidos (um item estragado não apaga os outros). */
function listOf<T extends z.ZodType>(item: T, max: number) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((rows) => {
      const out: z.infer<T>[] = [];
      const ids = new Set<string>();
      for (const row of rows) {
        const parsed = item.safeParse(row);
        if (!parsed.success) continue;
        const id = (parsed.data as { id: string }).id;
        if (ids.has(id)) continue;
        ids.add(id);
        out.push(parsed.data);
        if (out.length >= max) break;
      }
      return out;
    });
}

export const CheckoutConfigSchema = z.object({
  /** Descrição curta do produto (no resumo do pedido). */
  description: text(CHECKOUT_LIMITS.description).default(""),
  /** Preço "de" (riscado), em centavos; null = sem. */
  compareAtCents: cents.nullable().catch(null).default(null),
  /** Foto do produto. */
  imageKey: key.default(null),
  /** Campos pedidos (os que o gateway exige ficam pedidos de qualquer jeito). */
  fields: z
    .object({
      name: z.boolean().catch(true).default(true),
      email: z.boolean().catch(true).default(true),
      phone: z.boolean().catch(true).default(true),
      document: z.boolean().catch(true).default(true),
    })
    .catch({ name: true, email: true, phone: true, document: true })
    .default({ name: true, email: true, phone: true, document: true }),
  /** Pede o endereço de entrega (CEP preenche o resto) e mostra o frete. */
  address: z.boolean().catch(false).default(false),
  shipping: listOf(ShippingOptionSchema, CHECKOUT_LIMITS.shipping).default([]),
  /** Frete marcado ao abrir (null/sumido = o primeiro). */
  shippingDefault: itemId.nullable().catch(null).default(null),
  bumps: listOf(BumpSchema, CHECKOUT_LIMITS.bumps).default([]),
  bannerDesktopKey: key.default(null),
  bannerMobileKey: key.default(null),
  logoKey: key.default(null),
  color: z.string().regex(HEX_RE).catch(DEFAULT_CHECKOUT_COLOR).default(DEFAULT_CHECKOUT_COLOR),
  /** Cronômetro no topo, em minutos; null = desligado. */
  timerMinutes: z
    .number()
    .int()
    .min(CHECKOUT_LIMITS.timerMin)
    .max(CHECKOUT_LIMITS.timerMax)
    .nullable()
    .catch(null)
    .default(null),
  badges: z
    .object({
      secure: z.boolean().catch(true).default(true),
      guarantee: z.boolean().catch(true).default(true),
    })
    .catch({ secure: true, guarantee: true })
    .default({ secure: true, guarantee: true }),
  testimonials: listOf(TestimonialSchema, CHECKOUT_LIMITS.testimonials).default([]),
  /** Textos trocados no painel (vazio = o padrão do idioma). */
  texts: textsSchema.default({}),
  /**
   * Para que idioma e pagamento os textos trocados foram escritos (posto ao
   * salvar; null = sem textos trocados, ou salvo antes de existir): a troca da
   * moeda da oferta muda o idioma e o gateway, e os textos trocados ficam.
   */
  textsFor: z
    .object({ locale: z.enum(PAYMENT_LOCALES), pix: z.boolean() })
    .nullable()
    .catch(null)
    .default(null),
});
export type CheckoutConfig = z.infer<typeof CheckoutConfigSchema>;

/** Configuração guardada (JSON do banco) → CheckoutConfig (nunca falha: o que estiver estragado volta ao padrão). */
export function parseCheckoutConfig(raw: unknown): CheckoutConfig {
  const parsed = CheckoutConfigSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  return parsed.success ? parsed.data : CheckoutConfigSchema.parse({});
}

/**
 * Os textos trocados foram escritos para outro idioma ou outro pagamento (PIX
 * × Kyvo) — a troca da moeda da oferta mudou o produto e eles ficaram: o
 * formulário, o "Próximos passos" e o ZIP pedem para revisar. Salvar o
 * checkout de novo marca os textos para o idioma e o gateway de agora.
 */
export function staleCheckoutTexts(
  config: { texts: CheckoutConfig["texts"]; textsFor?: CheckoutConfig["textsFor"] },
  locale: PaymentLocaleId,
  provider: CheckoutProviderId,
): boolean {
  if (!config.textsFor || !Object.keys(config.texts).length) return false;
  return config.textsFor.locale !== locale || config.textsFor.pix !== isPixProvider(provider);
}

/** Frete marcado ao abrir: o escolhido, ou o primeiro (null = sem opções). */
export function defaultShipping(config: Pick<CheckoutConfig, "shipping" | "shippingDefault">): ShippingOption | null {
  return config.shipping.find((s) => s.id === config.shippingDefault) ?? config.shipping[0] ?? null;
}

// ─── Formato do formulário ──────────────────────────────────────────────────

export interface ShippingDraft {
  id: string;
  name: string;
  eta: string;
  /** Preço digitado ("19,90"; vazio ou "0" = grátis). */
  price: string;
}

export interface BumpDraft {
  id: string;
  title: string;
  description: string;
  price: string;
  /** Preço "de" digitado (vazio = sem). */
  compareAt: string;
  /** "/os-assets/<sha>.webp" ou null. */
  imageSrc: string | null;
  accessUrl: string;
}

export interface TestimonialDraft {
  id: string;
  text: string;
  name: string;
  photoSrc: string | null;
}

export interface CheckoutConfigDraft {
  description: string;
  compareAt: string;
  imageSrc: string | null;
  fields: Record<BuyerField, boolean>;
  address: boolean;
  shipping: ShippingDraft[];
  shippingDefault: string | null;
  bumps: BumpDraft[];
  bannerDesktopSrc: string | null;
  bannerMobileSrc: string | null;
  logoSrc: string | null;
  color: string;
  /** Minutos digitados ("" = desligado). */
  timer: string;
  badges: { secure: boolean; guarantee: boolean };
  testimonials: TestimonialDraft[];
  texts: Partial<Record<CheckoutEditableText, string>>;
  /** Para que idioma e pagamento os textos foram escritos (só leitura: quem salva põe o de agora). */
  textsFor?: CheckoutConfig["textsFor"];
}

/** Valor em centavos → texto do campo ("1990" → "19,90"; null → ""). */
function centsText(v: number | null): string {
  if (v === null) return "";
  const n = Math.max(0, Math.round(v));
  const int = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${int},${String(n % 100).padStart(2, "0")}`;
}

/** CheckoutConfig → o formulário. */
export function checkoutConfigDraft(config: CheckoutConfig): CheckoutConfigDraft {
  return {
    description: config.description,
    compareAt: centsText(config.compareAtCents),
    imageSrc: checkoutImageSrc(config.imageKey),
    fields: { ...config.fields },
    address: config.address,
    shipping: config.shipping.map((s) => ({ id: s.id, name: s.name, eta: s.eta, price: centsText(s.priceCents) })),
    shippingDefault: defaultShipping(config)?.id ?? null,
    bumps: config.bumps.map((b) => ({
      id: b.id,
      title: b.title,
      description: b.description,
      price: centsText(b.priceCents),
      compareAt: centsText(b.compareAtCents),
      imageSrc: checkoutImageSrc(b.imageKey),
      accessUrl: b.accessUrl,
    })),
    bannerDesktopSrc: checkoutImageSrc(config.bannerDesktopKey),
    bannerMobileSrc: checkoutImageSrc(config.bannerMobileKey),
    logoSrc: checkoutImageSrc(config.logoKey),
    color: config.color,
    timer: config.timerMinutes === null ? "" : String(config.timerMinutes),
    badges: { ...config.badges },
    testimonials: config.testimonials.map((t) => ({
      id: t.id,
      text: t.text,
      name: t.name,
      photoSrc: checkoutImageSrc(t.photoKey),
    })),
    texts: { ...config.texts },
    textsFor: config.textsFor ? { ...config.textsFor } : null,
  };
}

/** Id novo para bump, frete ou depoimento (o painel gera; o servidor confere). */
export function newItemId(): string {
  let out = "";
  while (out.length < 10) out += Math.random().toString(36).slice(2);
  return out.slice(0, 10);
}

/** Erros por caminho do campo ("bumps.0.price", "shipping.1.name", "texts.payButton"…). */
export type CheckoutDraftErrors = Record<string, string>;

function moneyField(
  raw: string,
  opts: { required: boolean; min: number; label: string; currency: CheckoutCurrencyId },
): { cents: number | null; error: string | null } {
  const v = raw.trim();
  if (!v)
    return opts.required ? { cents: null, error: `Digite ${opts.label}, como 29,90.` } : { cents: null, error: null };
  const c = parseAmount(v);
  if (c === null) return { cents: null, error: "Valor inválido. Digite só o número, como 29,90." };
  if (c < opts.min) return { cents: null, error: `O valor mínimo é ${formatAmount(opts.min, opts.currency)}.` };
  if (c > PIX_LIMITS.max)
    return { cents: null, error: `O valor máximo é ${formatAmount(PIX_LIMITS.max, opts.currency)}.` };
  return { cents: c, error: null };
}

/**
 * Confere o formulário e devolve a configuração para guardar (com as imagens
 * já como chaves do storage) ou os erros por campo. `productCents`: valor do
 * produto (o preço "de" tem de ser maior que ele).
 */
export function checkoutConfigFromDraft(
  draft: CheckoutConfigDraft,
  currency: CheckoutCurrencyId,
  productCents: number | null,
): { config: CheckoutConfig; errors: CheckoutDraftErrors } {
  const errors: CheckoutDraftErrors = {};
  const image = (src: string | null, path: string): string | null => {
    const k = checkoutImageKey(src);
    if (k === undefined) {
      errors[path] = "Escolha a imagem de novo.";
      return null;
    }
    return k;
  };
  const ids = new Set<string>();
  const freshId = (id: string) => {
    let next = ITEM_ID_RE.test(id) && !ids.has(id) ? id : newItemId();
    while (ids.has(next)) next = newItemId();
    ids.add(next);
    return next;
  };

  const description = draft.description.trim();
  if (description.length > CHECKOUT_LIMITS.description) {
    errors.description = `A descrição pode ter no máximo ${CHECKOUT_LIMITS.description} caracteres.`;
  }
  const compare = moneyField(draft.compareAt, { required: false, min: 1, label: "o preço “de”", currency });
  if (compare.error) errors.compareAt = compare.error;
  else if (compare.cents !== null && productCents !== null && compare.cents <= productCents) {
    errors.compareAt = "O preço “de” precisa ser maior que o valor do produto (ou deixe vazio).";
  }

  if (draft.shipping.length > CHECKOUT_LIMITS.shipping) {
    errors.shipping = `Cadastre no máximo ${CHECKOUT_LIMITS.shipping} opções de frete.`;
  }
  const shipping: ShippingOption[] = [];
  draft.shipping.slice(0, CHECKOUT_LIMITS.shipping).forEach((s, i) => {
    const name = s.name.trim();
    if (!name) errors[`shipping.${i}.name`] = "Dê um nome ao frete (ex.: “Correios PAC”).";
    else if (name.length > CHECKOUT_LIMITS.shippingName) {
      errors[`shipping.${i}.name`] = `O nome do frete pode ter no máximo ${CHECKOUT_LIMITS.shippingName} caracteres.`;
    }
    const eta = s.eta.trim();
    if (eta.length > CHECKOUT_LIMITS.shippingEta) {
      errors[`shipping.${i}.eta`] = `O prazo pode ter no máximo ${CHECKOUT_LIMITS.shippingEta} caracteres.`;
    }
    const price = s.price.trim() ? moneyField(s.price, { required: false, min: 0, label: "o preço", currency }) : null;
    if (price?.error) errors[`shipping.${i}.price`] = price.error;
    shipping.push({ id: freshId(s.id), name, eta, priceCents: price?.cents ?? 0 });
  });
  // Endereço só no real (o CEP e a UF do contrato são do Brasil).
  const addressProblem = draft.address ? addressCurrencyProblem(currency) : null;
  if (addressProblem) errors.address = addressProblem;
  else if (draft.address && !shipping.length) {
    errors.shipping = "Com o endereço ligado, cadastre pelo menos uma opção de frete (pode ser grátis).";
  }
  const defaultIndex = draft.shipping.findIndex((s) => s.id === draft.shippingDefault);
  const shippingDefault = shipping[defaultIndex >= 0 ? defaultIndex : 0]?.id ?? null;

  if (draft.bumps.length > CHECKOUT_LIMITS.bumps) {
    errors.bumps = `Cadastre no máximo ${CHECKOUT_LIMITS.bumps} order bumps.`;
  }
  const bumps: Bump[] = [];
  draft.bumps.slice(0, CHECKOUT_LIMITS.bumps).forEach((b, i) => {
    const title = b.title.trim();
    if (!title) errors[`bumps.${i}.title`] = "Dê um título ao order bump.";
    else if (title.length > CHECKOUT_LIMITS.bumpTitle) {
      errors[`bumps.${i}.title`] = `O título pode ter no máximo ${CHECKOUT_LIMITS.bumpTitle} caracteres.`;
    }
    const desc = b.description.trim();
    if (desc.length > CHECKOUT_LIMITS.bumpDescription) {
      errors[`bumps.${i}.description`] =
        `A descrição pode ter no máximo ${CHECKOUT_LIMITS.bumpDescription} caracteres.`;
    }
    const price = moneyField(b.price, { required: true, min: BUMP_MIN_CENTS, label: "o preço do bump", currency });
    if (price.error) errors[`bumps.${i}.price`] = price.error;
    const was = moneyField(b.compareAt, { required: false, min: 1, label: "o preço “de”", currency });
    if (was.error) errors[`bumps.${i}.compareAt`] = was.error;
    else if (was.cents !== null && price.cents !== null && was.cents <= price.cents) {
      errors[`bumps.${i}.compareAt`] = "O preço “de” precisa ser maior que o preço do bump (ou deixe vazio).";
    }
    const accessUrl = normalizeAccessUrl(b.accessUrl);
    const access = accessUrlProblem(accessUrl);
    if (access) errors[`bumps.${i}.accessUrl`] = access;
    bumps.push({
      id: freshId(b.id),
      title,
      description: desc,
      priceCents: price.cents ?? BUMP_MIN_CENTS,
      compareAtCents: was.cents,
      imageKey: image(b.imageSrc, `bumps.${i}.image`),
      accessUrl,
    });
  });

  const color = draft.color.trim();
  if (!HEX_RE.test(color)) errors.color = "Escolha uma cor (no formato #15803d).";

  let timerMinutes: number | null = null;
  const timer = draft.timer.trim();
  if (timer) {
    const n = Number(timer);
    if (!Number.isInteger(n) || n < CHECKOUT_LIMITS.timerMin || n > CHECKOUT_LIMITS.timerMax) {
      errors.timer = `O cronômetro vai de ${CHECKOUT_LIMITS.timerMin} a ${CHECKOUT_LIMITS.timerMax} minutos (ou deixe vazio para desligar).`;
    } else timerMinutes = n;
  }

  if (draft.testimonials.length > CHECKOUT_LIMITS.testimonials) {
    errors.testimonials = `Cadastre no máximo ${CHECKOUT_LIMITS.testimonials} depoimentos.`;
  }
  const testimonials: Testimonial[] = [];
  draft.testimonials.slice(0, CHECKOUT_LIMITS.testimonials).forEach((t, i) => {
    const body = t.text.trim();
    const name = t.name.trim();
    if (!body) errors[`testimonials.${i}.text`] = "Escreva o depoimento.";
    else if (body.length > CHECKOUT_LIMITS.testimonialText) {
      errors[`testimonials.${i}.text`] =
        `O depoimento pode ter no máximo ${CHECKOUT_LIMITS.testimonialText} caracteres.`;
    }
    if (!name) errors[`testimonials.${i}.name`] = "Digite o nome de quem deu o depoimento.";
    else if (name.length > CHECKOUT_LIMITS.testimonialName) {
      errors[`testimonials.${i}.name`] = `O nome pode ter no máximo ${CHECKOUT_LIMITS.testimonialName} caracteres.`;
    }
    testimonials.push({ id: freshId(t.id), text: body, name, photoKey: image(t.photoSrc, `testimonials.${i}.photo`) });
  });

  const texts: Partial<Record<CheckoutEditableText, string>> = {};
  for (const k of CHECKOUT_EDITABLE_TEXTS) {
    const v = (draft.texts[k] ?? "").trim();
    if (!v) continue;
    if (v.length > editableTextMax(k)) {
      errors[`texts.${k}`] = `Este texto pode ter no máximo ${editableTextMax(k)} caracteres.`;
    }
    texts[k] = v.slice(0, editableTextMax(k));
  }

  const fields = {} as Record<BuyerField, boolean>;
  for (const f of BUYER_FIELDS) fields[f] = draft.fields[f] !== false;

  const config: CheckoutConfig = {
    description: description.slice(0, CHECKOUT_LIMITS.description),
    compareAtCents: compare.cents,
    imageKey: image(draft.imageSrc, "image"),
    fields,
    address: draft.address,
    shipping,
    shippingDefault,
    bumps,
    bannerDesktopKey: image(draft.bannerDesktopSrc, "bannerDesktop"),
    bannerMobileKey: image(draft.bannerMobileSrc, "bannerMobile"),
    logoKey: image(draft.logoSrc, "logo"),
    color: HEX_RE.test(color) ? color.toLowerCase() : DEFAULT_CHECKOUT_COLOR,
    timerMinutes,
    badges: { secure: draft.badges.secure !== false, guarantee: draft.badges.guarantee !== false },
    testimonials,
    texts,
    textsFor: Object.keys(texts).length && draft.textsFor ? { ...draft.textsFor } : null,
  };
  return { config, errors };
}

/** Chaves de imagem usadas pela configuração (a conferir na biblioteca da oferta). */
export function checkoutConfigImageKeys(config: CheckoutConfig): { path: string; key: string }[] {
  const out: { path: string; key: string }[] = [];
  const add = (path: string, k: string | null) => {
    if (k) out.push({ path, key: k });
  };
  add("image", config.imageKey);
  add("bannerDesktop", config.bannerDesktopKey);
  add("bannerMobile", config.bannerMobileKey);
  add("logo", config.logoKey);
  config.bumps.forEach((b, i) => {
    add(`bumps.${i}.image`, b.imageKey);
  });
  config.testimonials.forEach((t, i) => {
    add(`testimonials.${i}.photo`, t.photoKey);
  });
  return out;
}
