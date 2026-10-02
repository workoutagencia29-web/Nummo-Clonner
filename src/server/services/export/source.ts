/**
 * Leitura da oferta para o ZIP: páginas, versões, documentos (com ou sem o
 * HTML), links e pixels com envio pelo servidor. Só ofertas fora da lixeira.
 */
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import type { LayoutPage } from "@/lib/export/layout";
import type { ServerEventVendor } from "@/lib/export/options";
import { serverApiEnabled } from "@/lib/tracking/schema";

export const OFFER_NOT_FOUND = "Oferta não encontrada. Ela pode ter sido excluída ou estar na lixeira.";

export interface SourceDocument {
  id: string;
  device: "ALL" | "DESKTOP" | "MOBILE";
  html: string | null;
  assetMap: Record<string, string> | null;
}

export interface SourceVariant {
  id: string;
  name: string;
  label: string | null;
  isControl: boolean;
  weight: number;
  position: number;
  documents: SourceDocument[];
}

export interface SourcePage {
  id: string;
  name: string;
  slug: string;
  type: string;
  isHome: boolean;
  position: number;
  cloneMode: "EDITABLE" | "PRESERVE_JS";
  /** Endereço de onde a página foi clonada ("Preservar JS": pasta original dos scripts). */
  sourceUrl: string | null;
  seo: unknown;
  customCode: unknown;
  variants: SourceVariant[];
}

export interface ExportSource {
  offer: { id: string; name: string; settings: unknown; liveUrl: string | null; updatedAt: Date };
  pages: SourcePage[];
  links: { key: string; url: string }[];
}

function assetMapOf(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
  return out;
}

/**
 * Oferta completa. `withHtml: false` (prévia do ZIP) não lê o HTML dos
 * documentos, só a estrutura e os mapas do "Preservar JS".
 */
export async function loadExportSource(offerId: string, { withHtml = true } = {}): Promise<ExportSource> {
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, deletedAt: null },
    select: {
      id: true,
      name: true,
      settings: true,
      liveUrl: true,
      updatedAt: true,
      links: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { key: true, url: true } },
      pages: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          isHome: true,
          position: true,
          cloneMode: true,
          sourceUrl: true,
          seo: true,
          customCode: true,
          variants: {
            orderBy: [{ isControl: "desc" }, { position: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              name: true,
              label: true,
              isControl: true,
              weight: true,
              position: true,
              documents: {
                orderBy: { device: "asc" },
                select: { id: true, device: true, html: withHtml, assetMap: true },
              },
            },
          },
        },
      },
    },
  });
  if (!offer) throw new UserError(OFFER_NOT_FOUND);
  return {
    offer: {
      id: offer.id,
      name: offer.name,
      settings: offer.settings,
      liveUrl: offer.liveUrl,
      updatedAt: offer.updatedAt,
    },
    links: offer.links,
    pages: offer.pages.map((p) => ({
      ...p,
      variants: p.variants.map((v) => ({
        ...v,
        documents: v.documents.map((d) => ({
          id: d.id,
          device: d.device,
          html: "html" in d ? ((d as { html: string | null }).html ?? null) : null,
          assetMap: assetMapOf(d.assetMap),
        })),
      })),
    })),
  };
}

/** Estrutura para planLayout. */
export function layoutPages(source: ExportSource): LayoutPage[] {
  return source.pages.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    type: p.type,
    isHome: p.isHome,
    position: p.position,
    cloneMode: p.cloneMode,
    variants: p.variants.map((v) => ({
      id: v.id,
      name: v.name,
      label: v.label,
      isControl: v.isControl,
      weight: v.weight,
      position: v.position,
      documents: v.documents.map((d) => ({ id: d.id, device: d.device })),
    })),
  }));
}

export interface ServerEventPixelRow {
  id: string;
  vendor: ServerEventVendor;
  pixelId: string;
  testEventCode: string | null;
}

/**
 * Pixels que o eventos.php atende: ligados, com a API de Conversões (Meta) ou a
 * Events API (TikTok) ativada e com token salvo. Não lê os tokens.
 */
export async function serverEventPixels(offerId: string): Promise<ServerEventPixelRow[]> {
  const rows = await prisma.pixelConfig.findMany({
    where: { offerId, enabled: true, vendor: { in: ["META", "TIKTOK"] }, accessTokenEnc: { not: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, vendor: true, pixelId: true, options: true, testEventCode: true },
  });
  return rows
    .filter((r) => serverApiEnabled(r.vendor, r.options))
    .map((r) => ({
      id: r.id,
      vendor: r.vendor as ServerEventVendor,
      pixelId: r.pixelId,
      testEventCode: r.testEventCode?.trim() || null,
    }));
}
