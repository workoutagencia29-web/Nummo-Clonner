/**
 * Configurações gerais de uma oferta (Offer.settings) e SEO de cada página
 * (Page.seo). Usadas pelo painel, pela prévia e pelo ZIP.
 */
import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);

/** Idiomas do <html lang> das páginas; "" = não muda (fica o da página). */
export const PAGE_LANGUAGES = ["", "pt-BR", "en", "es"] as const;
/** Chave de arquivo no storage (imagem enviada ou baixada no clone). */
const storageKey = z
  .string()
  .max(200)
  .regex(/^[a-z0-9/._-]+$/i);

export const CompanySchema = z.object({
  name: text(160).default(""),
  /** CNPJ ou CPF, como o usuário digitar. */
  document: text(40).default(""),
  email: text(160).default(""),
  phone: text(40).default(""),
  address: text(300).default(""),
});
export type Company = z.infer<typeof CompanySchema>;

export const SeoSchema = z.object({
  title: text(160).default(""),
  description: text(320).default(""),
  /** Ícone da aba (favicon). */
  faviconKey: storageKey.nullable().default(null),
  /** Imagem de compartilhamento (og:image). */
  ogImageKey: storageKey.nullable().default(null),
  /** Pede para o Google não indexar (bom para upsell, obrigado e páginas de teste). */
  noindex: z.boolean().default(false),
});
export type Seo = z.infer<typeof SeoSchema>;

export const OfferSettingsSchema = z.object({
  company: CompanySchema.prefault({}),
  /** SEO padrão de todas as páginas (cada página pode sobrescrever). */
  seo: SeoSchema.prefault({}),
  /**
   * Idioma do <html lang>. "" (o padrão) = igual à página: cada página fica com o
   * idioma que já declara (uma página clonada em inglês continua "en").
   */
  language: z.enum(PAGE_LANGUAGES).default(""),
});
export type OfferSettings = z.infer<typeof OfferSettingsSchema>;

/** Page.seo: campos vazios herdam da oferta. */
export const PageSeoSchema = SeoSchema.extend({
  noindex: z.boolean().nullable().default(null),
});
export type PageSeo = z.infer<typeof PageSeoSchema>;

export function parseOfferSettings(value: unknown): OfferSettings {
  const parsed = OfferSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : OfferSettingsSchema.parse({});
}

export function parsePageSeo(value: unknown): PageSeo {
  const parsed = PageSeoSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : PageSeoSchema.parse({});
}

/** SEO efetivo de uma página: o da página, completando com o da oferta. */
export function effectiveSeo(offer: OfferSettings, page: PageSeo): Seo {
  return {
    title: page.title || offer.seo.title,
    description: page.description || offer.seo.description,
    faviconKey: page.faviconKey ?? offer.seo.faviconKey,
    ogImageKey: page.ogImageKey ?? offer.seo.ogImageKey,
    noindex: page.noindex ?? offer.seo.noindex,
  };
}

/** Marcadores dos modelos de páginas legais, trocados pelos dados da empresa. */
export const COMPANY_PLACEHOLDERS: Record<string, (c: Company) => string> = {
  "{{EMPRESA}}": (c) => c.name,
  "{{CNPJ}}": (c) => c.document,
  "{{EMAIL}}": (c) => c.email,
  "{{TELEFONE}}": (c) => c.phone,
  "{{ENDERECO}}": (c) => c.address,
};

/** CPF (11 dígitos) ou CNPJ (14 dígitos) pelo número digitado; null = não dá para saber. */
export function documentKind(document: string): "CPF" | "CNPJ" | null {
  const digits = document.replace(/\D/g, "").length;
  return digits === 11 ? "CPF" : digits === 14 ? "CNPJ" : null;
}

/**
 * "CNPJ/CPF" (e o "CNPJ" dos modelos antigos: "inscrita no CNPJ sob o nº")
 * logo antes do marcador {{CNPJ}}.
 */
const DOCUMENT_LABEL_RE = /\bCNPJ(?:\/CPF)?(?=(?:\s+sob\s+o)?(?:\s+n[º°o]\.?)?\s*(?:<span\b[^>]*>\s*)?\{\{CNPJ\}\})/g;

/** Marcador (com o destaque do editor em volta, se houver). */
const markerRe = (name: string) => `(?:<span\\b[^>]*>\\s*)?\\{\\{${name}\\}\\}(?:\\s*</span>)?`;

/**
 * Trechos com telefone/endereço (opcionais: a LGPD não exige publicar) que
 * saem da página quando o dado está vazio: o <span data-os-company> dos modelos
 * e, nas páginas criadas antes dele, as frases do modelo em volta do marcador.
 */
const OPTIONAL_PARTS: Record<"phone" | "address", RegExp[]> = {
  phone: [
    /<span\b[^>]*\bdata-os-company=["']?phone\b[^>]*>(?:(?!<\/?span\b)[\s\S])*(?:<span\b[^>]*>(?:(?!<\/?span\b)[\s\S])*<\/span>(?:(?!<\/?span\b)[\s\S])*)*<\/span>/gi,
    new RegExp(`<br\\s*/?>\\s*Telefone:\\s*${markerRe("TELEFONE")}`, "gi"),
    new RegExp(`\\s*·\\s*${markerRe("TELEFONE")}`, "g"),
  ],
  address: [
    /<span\b[^>]*\bdata-os-company=["']?address\b[^>]*>(?:(?!<\/?span\b)[\s\S])*(?:<span\b[^>]*>(?:(?!<\/?span\b)[\s\S])*<\/span>(?:(?!<\/?span\b)[\s\S])*)*<\/span>/gi,
    new RegExp(`<br\\s*/?>\\s*Endereço:\\s*${markerRe("ENDERECO")}`, "gi"),
    new RegExp(`,\\s*com endereço em\\s*${markerRe("ENDERECO")}`, "gi"),
    new RegExp(`\\s*—\\s*${markerRe("ENDERECO")}`, "g"),
  ],
};

/**
 * Troca os marcadores preenchidos. Telefone e endereço vazios saem da página
 * junto com o trecho em volta (OPTIONAL_PARTS); nome, documento e e-mail vazios
 * ficam visíveis para o usuário notar. O rótulo do documento vira "CPF" ou
 * "CNPJ" conforme o número.
 */
export function fillCompanyPlaceholders(html: string, company: Company) {
  let out = html;
  for (const field of ["phone", "address"] as const) {
    if (!company[field].trim()) for (const re of OPTIONAL_PARTS[field]) out = out.replace(re, "");
  }
  const kind = documentKind(company.document);
  if (kind) out = out.replace(DOCUMENT_LABEL_RE, kind);
  for (const [marker, value] of Object.entries(COMPANY_PLACEHOLDERS)) {
    const v = value(company);
    if (v) out = out.split(marker).join(escapeHtml(v));
  }
  return out;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
