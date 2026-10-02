/**
 * Configurações gerais da oferta (Offer.settings: dados da empresa para as
 * páginas legais, SEO padrão e idioma) e SEO de cada página (Page.seo). Usadas
 * pelo painel, pela prévia e pelo ZIP (Fase 5).
 */
import * as cheerio from "cheerio";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import {
  type Company,
  effectiveSeo,
  fillCompanyPlaceholders,
  type OfferSettings,
  OfferSettingsSchema,
  type PageSeo,
  PageSeoSchema,
  parseOfferSettings,
  parsePageSeo,
  type Seo,
} from "@/lib/offer-settings";

const STORAGE_KEY_RE = /^a\/[0-9a-f]{2}\/([0-9a-f]{64}\.[a-z0-9]{1,8})$/;
const ASSET_SRC_RE = /^\/os-assets\/([0-9a-f]{64}\.[a-z0-9]{1,8})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "/os-assets/<sha>.<ext>" a partir da chave do storage (mesma regra de assetSrc em ./assets). */
function assetSrc(key: string): string | null {
  const m = STORAGE_KEY_RE.exec(key);
  return m ? `/os-assets/${m[1]}` : null;
}

async function offerOrThrow(offerId: string) {
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, deletedAt: null },
    select: { id: true, name: true, settings: true },
  });
  if (!offer) throw new UserError("Oferta não encontrada. Ela pode ter sido excluída.");
  return offer;
}

async function pageOrThrow(pageId: string) {
  const page = await prisma.page.findFirst({
    where: { id: pageId, offer: { deletedAt: null } },
    select: { id: true, offerId: true, seo: true, offer: { select: { settings: true, liveUrl: true } } },
  });
  if (!page) throw new UserError("Página não encontrada. Ela pode ter sido excluída.");
  return page;
}

/** Mensagens claras para os limites dos campos. */
function issueMessage(path: string, code: string, fallback: string): string {
  const field = path.split(".").pop() ?? "";
  if (path === "company.name") return "O nome da empresa pode ter no máximo 160 caracteres.";
  if (path === "company.document") return "O CNPJ/CPF pode ter no máximo 40 caracteres.";
  if (path === "company.email") return "O e-mail pode ter no máximo 160 caracteres.";
  if (path === "company.phone") return "O telefone pode ter no máximo 40 caracteres.";
  if (path === "company.address") return "O endereço pode ter no máximo 300 caracteres.";
  if (field === "title") return "O título pode ter no máximo 160 caracteres.";
  if (field === "description") return "A descrição pode ter no máximo 320 caracteres.";
  if (field === "faviconKey" || field === "ogImageKey") return "Escolha a imagem de novo na biblioteca.";
  if (path === "language") return "Escolha o idioma da página.";
  if (code === "invalid_type") return "Algum valor está num formato inválido. Confira e salve de novo.";
  return fallback;
}

function throwFirstIssue(error: { issues: { path: PropertyKey[]; code: string; message: string }[] }, prefix = "") {
  const issue = error.issues[0];
  const path = [prefix, ...issue.path.map(String)].filter(Boolean).join(".");
  throw new UserError(issueMessage(path, issue.code, issue.message), path || undefined);
}

/**
 * Imagem do SEO: aceita a chave do storage ("a/3f/<sha>.webp") ou o endereço da
 * biblioteca ("/os-assets/<sha>.webp") e confere que a imagem é desta oferta.
 */
async function cleanImageKey(offerId: string, value: unknown, field: string): Promise<string | null> {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new UserError("Escolha a imagem de novo na biblioteca.", field);
  const text = value.trim();
  const fromSrc = ASSET_SRC_RE.exec(text);
  const key = fromSrc ? `a/${fromSrc[1].slice(0, 2)}/${fromSrc[1]}` : text;
  if (!STORAGE_KEY_RE.test(key)) throw new UserError("Escolha a imagem de novo na biblioteca.", field);
  const asset = await prisma.asset.count({ where: { offerId, key, kind: { in: ["IMAGE", "ICON"] } } });
  if (!asset) {
    throw new UserError("Essa imagem não está na biblioteca desta oferta. Envie a imagem de novo.", field);
  }
  return key;
}

// ─────────────────────────────────────────────────────────────────────────────
// Oferta
// ─────────────────────────────────────────────────────────────────────────────

export interface OfferSettingsPatch {
  company?: Partial<Company>;
  seo?: Partial<Seo>;
  language?: OfferSettings["language"];
}

export async function getOfferSettings(offerId: string): Promise<OfferSettings> {
  const offer = await offerOrThrow(offerId);
  return parseOfferSettings(offer.settings);
}

/**
 * Junta as mudanças com o que está salvo, valida e grava. Mantém chaves que
 * outras fases guardam no mesmo JSON.
 */
export async function saveOfferSettings(offerId: string, patch: OfferSettingsPatch): Promise<OfferSettings> {
  const offer = await offerOrThrow(offerId);
  const current = parseOfferSettings(offer.settings);
  const merged = {
    company: { ...current.company, ...(patch.company ?? {}) },
    seo: { ...current.seo, ...(patch.seo ?? {}) },
    language: patch.language ?? current.language,
  };
  const email = typeof merged.company.email === "string" ? merged.company.email.trim() : "";
  if (email && !EMAIL_RE.test(email)) {
    throw new UserError("Digite um e-mail válido, como contato@suaempresa.com.br.", "company.email");
  }
  if (patch.seo && "faviconKey" in patch.seo) {
    merged.seo.faviconKey = await cleanImageKey(offerId, patch.seo.faviconKey, "seo.faviconKey");
  }
  if (patch.seo && "ogImageKey" in patch.seo) {
    merged.seo.ogImageKey = await cleanImageKey(offerId, patch.seo.ogImageKey, "seo.ogImageKey");
  }
  const parsed = OfferSettingsSchema.safeParse(merged);
  if (!parsed.success) throwFirstIssue(parsed.error);
  const settings = parsed.data as OfferSettings;
  const previous =
    typeof offer.settings === "object" && offer.settings !== null && !Array.isArray(offer.settings)
      ? (offer.settings as Record<string, unknown>)
      : {};
  await prisma.offer.update({
    where: { id: offerId },
    data: { settings: { ...previous, ...settings } as unknown as Prisma.InputJsonObject },
  });
  return settings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Página
// ─────────────────────────────────────────────────────────────────────────────

export interface PageSeoData {
  /** O que a página definiu (vazio/null = herda da oferta). */
  seo: PageSeo;
  /** O que vale de fato (página completando com a oferta). */
  effective: Seo;
  /** SEO padrão da oferta (para mostrar o que é herdado). */
  offerSeo: Seo;
  faviconSrc: string | null;
  ogImageSrc: string | null;
}

/** SEO da página para o diálogo "SEO da página": também o que a página já tem no HTML. */
export interface PageSeoDialogData extends PageSeoData {
  /**
   * <title> e meta description do HTML da página (versão de controle, a do
   * computador): é o que fica publicado quando o SEO da página e o padrão da
   * oferta estão vazios. Vazio = a página não tem.
   */
  own: { title: string; description: string };
  /** "Onde está no ar" (aba Detalhes): a imagem de compartilhamento precisa dele no ZIP. */
  liveUrl: string | null;
}

function pageSeoData(seo: PageSeo, offerSettings: OfferSettings): PageSeoData {
  const effective = effectiveSeo(offerSettings, seo);
  return {
    seo,
    effective,
    offerSeo: offerSettings.seo,
    faviconSrc: effective.faviconKey ? assetSrc(effective.faviconKey) : null,
    ogImageSrc: effective.ogImageKey ? assetSrc(effective.ogImageKey) : null,
  };
}

/**
 * Título e descrição que o HTML da página já tem (mesma escolha de documento da
 * prévia: versão de controle, computador, senão o único), com os dados da
 * empresa trocados como na prévia.
 */
async function ownSeo(pageId: string, offerSettings: OfferSettings): Promise<PageSeoDialogData["own"]> {
  const variant = await prisma.pageVariant.findFirst({
    where: { pageId },
    orderBy: [{ isControl: "desc" }, { position: "asc" }],
    select: { documents: { select: { device: true, html: true } } },
  });
  const docs = variant?.documents ?? [];
  const doc = docs.find((d) => d.device === "DESKTOP") ?? docs.find((d) => d.device === "ALL") ?? docs[0];
  if (!doc?.html) return { title: "", description: "" };
  const $ = cheerio.load(fillCompanyPlaceholders(doc.html, offerSettings.company));
  const clean = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
  return {
    title: clean($("head title").first().text() || $("title").first().text()),
    description: clean($('meta[name="description" i]').first().attr("content")),
  };
}

export async function getPageSeo(pageId: string): Promise<PageSeoDialogData> {
  const page = await pageOrThrow(pageId);
  const settings = parseOfferSettings(page.offer.settings);
  return {
    ...pageSeoData(parsePageSeo(page.seo), settings),
    own: await ownSeo(pageId, settings),
    liveUrl: page.offer.liveUrl,
  };
}

export async function savePageSeo(pageId: string, patch: Partial<PageSeo>): Promise<PageSeoData> {
  const page = await pageOrThrow(pageId);
  const current = parsePageSeo(page.seo);
  const merged = { ...current, ...patch };
  if ("faviconKey" in patch) merged.faviconKey = await cleanImageKey(page.offerId, patch.faviconKey, "faviconKey");
  if ("ogImageKey" in patch) merged.ogImageKey = await cleanImageKey(page.offerId, patch.ogImageKey, "ogImageKey");
  const parsed = PageSeoSchema.safeParse(merged);
  if (!parsed.success) throwFirstIssue(parsed.error);
  const seo = parsed.data as PageSeo;
  await prisma.$transaction([
    prisma.page.update({ where: { id: pageId }, data: { seo: seo as unknown as Prisma.InputJsonObject } }),
    prisma.offer.update({ where: { id: page.offerId }, data: { updatedAt: new Date() } }),
  ]);
  return pageSeoData(seo, parseOfferSettings(page.offer.settings));
}

// ─────────────────────────────────────────────────────────────────────────────
// Tela de configurações da oferta
// ─────────────────────────────────────────────────────────────────────────────

export interface OfferSettingsPanel {
  /** liveUrl: "Onde está no ar" (Detalhes). O ZIP usa para o endereço completo da imagem de compartilhamento. */
  offer: { id: string; name: string; liveUrl: string | null };
  settings: OfferSettings;
  faviconSrc: string | null;
  ogImageSrc: string | null;
  pages: ({ id: string; name: string; type: string; isHome: boolean } & PageSeoData)[];
}

/** Tudo o que a tela de configurações (empresa + SEO) precisa. null = oferta não encontrada. */
export async function getOfferSettingsPanel(offerId: string): Promise<OfferSettingsPanel | null> {
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, deletedAt: null },
    select: {
      id: true,
      name: true,
      liveUrl: true,
      settings: true,
      pages: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, type: true, isHome: true, seo: true },
      },
    },
  });
  if (!offer) return null;
  const settings = parseOfferSettings(offer.settings);
  return {
    offer: { id: offer.id, name: offer.name, liveUrl: offer.liveUrl },
    settings,
    faviconSrc: settings.seo.faviconKey ? assetSrc(settings.seo.faviconKey) : null,
    ogImageSrc: settings.seo.ogImageKey ? assetSrc(settings.seo.ogImageKey) : null,
    pages: offer.pages.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      isHome: p.isHome,
      ...pageSeoData(parsePageSeo(p.seo), settings),
    })),
  };
}
