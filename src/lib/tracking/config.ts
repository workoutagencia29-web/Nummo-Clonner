/**
 * Monta a configuração pública de rastreamento de uma página a partir do banco
 * (pixels ligados, regras da oferta + da página, links de checkout,
 * configurações). A parte pura fica em ./compose (testável sem banco).
 */

import { prisma } from "@/lib/db";
import { planLayout } from "@/lib/export/layout";
import { RENDER_LINK_SELECT, renderLinks } from "@/lib/payments/links";
import { composeTrackingConfig, type TrackingVariant } from "./compose";
import type { TrackingMode, TrackingRuntimeConfig } from "./runtime-config";
import { parseTrackingSettings, resolvePolicyPage, type TrackingSettings } from "./schema";

export {
  CHECKOUT_LINK_KINDS,
  composeTrackingConfig,
  knownCheckoutHosts,
  publicPixelOptions,
  type TrackingSource,
  type TrackingSourceLink,
  type TrackingSourcePixel,
  type TrackingSourceRule,
  type TrackingVariant,
  versionSrcHosts,
} from "./compose";

export interface BuildTrackingOptions {
  offerId: string;
  /** Página mostrada; null = documento solto (só regras da oferta inteira). */
  pageId: string | null;
  mode: TrackingMode;
  /** Tela de teste (só no modo "test"). */
  test?: TrackingRuntimeConfig["test"];
  /** Endereço de outra página do funil (prévia: /p/<id>; ZIP: caminho relativo). */
  pageHref: (pageId: string) => string;
  /** eventos.php (Fase 5, ZIP com API de Conversões/Events API ligada). */
  serverEndpoint?: string | null;
  /**
   * Versão A/B mostrada (página com mais de uma versão): vai em todo evento
   * (os_versao) e marca os links de checkout. O ZIP passa a de cada pasta
   * ({ name: "B", folder: "oferta-b/" }). null = nenhuma.
   */
  variant?: TrackingVariant | null;
  /**
   * Prévia/"Testar pixels": em vez de `variant`, o ID da versão mostrada; a
   * letra e a pasta saem do banco (a mesma pasta do ZIP). Versão de outra
   * página, inexistente, ou página com uma versão só → nenhuma.
   */
  variantId?: string | null;
}

/**
 * Versão A/B de uma página da oferta pelo ID (letra e pasta como no ZIP:
 * planLayout). null = a página tem uma versão só, ou a versão não é dela.
 */
export async function trackingVariantFor(
  offerId: string,
  pageId: string,
  variantId: string,
): Promise<TrackingVariant | null> {
  const pages = await prisma.page.findMany({
    where: { offerId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      type: true,
      isHome: true,
      position: true,
      cloneMode: true,
      variants: {
        select: {
          id: true,
          name: true,
          label: true,
          isControl: true,
          weight: true,
          position: true,
          documents: { select: { id: true, device: true } },
        },
      },
    },
  });
  if (!pages.some((p) => p.id === pageId)) return null;
  const file = planLayout(pages, { splitter: true }).files.find(
    (f) => f.pageId === pageId && f.variantId === variantId && f.version,
  );
  return file?.version ?? null;
}

export interface LoadedTracking {
  config: TrackingRuntimeConfig;
  /** Configurações da oferta (o código livre da oferta vai para a página junto). */
  settings: TrackingSettings;
}

/** Lê a oferta e monta a configuração. null = oferta inexistente ou na lixeira. */
export async function loadTracking(opts: BuildTrackingOptions): Promise<LoadedTracking | null> {
  const offer = await prisma.offer.findFirst({
    where: { id: opts.offerId, deletedAt: null },
    select: {
      tracking: true,
      pixels: {
        where: { enabled: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { vendor: true, pixelId: true, enabled: true, options: true },
      },
      eventRules: {
        where: { enabled: true, OR: [{ pageId: null }, ...(opts.pageId ? [{ pageId: opts.pageId }] : [])] },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { pageId: true, event: true, trigger: true, value: true, selector: true, enabled: true },
      },
      links: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: RENDER_LINK_SELECT,
      },
      pages: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, slug: true, type: true },
      },
    },
  });
  if (!offer) return null;
  const settings = parseTrackingSettings(offer.tracking);

  // A escolhida ou, sem escolha, a página "Política de privacidade" da oferta.
  const policyPage = resolvePolicyPage(settings.consent.policyPageId, offer.pages);
  const policyUrl = policyPage ? opts.pageHref(policyPage.id) : null;

  const variant =
    opts.variant !== undefined
      ? opts.variant
      : opts.variantId && opts.pageId
        ? await trackingVariantFor(opts.offerId, opts.pageId, opts.variantId)
        : null;

  const config = composeTrackingConfig({
    mode: opts.mode,
    settings,
    pixels: offer.pixels,
    rules: offer.eventRules,
    // Link de pagamento na página: sem endereço (o host guardado não conta como checkout).
    links: renderLinks(offer.links),
    pageId: opts.pageId,
    policyUrl,
    test: opts.test ?? null,
    serverEndpoint: opts.serverEndpoint ?? null,
    variant,
  });
  return { config, settings };
}

/** Configuração pública de uma página (DB → TrackingRuntimeConfig). null = oferta não encontrada. */
export async function buildTrackingConfig(opts: BuildTrackingOptions): Promise<TrackingRuntimeConfig | null> {
  return (await loadTracking(opts))?.config ?? null;
}
