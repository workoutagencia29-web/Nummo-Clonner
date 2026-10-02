/**
 * Transforma o HTML salvo de uma página no HTML servido ao visitante (prévia e,
 * na Fase 5, ZIP): marcadores da empresa ({{EMPRESA}}…) viram os dados da
 * oferta, links do funil (os-page:<id>) viram endereços reais, botões
 * ligados a links da oferta recebem a URL atual, o SEO (título, descrição,
 * favicon, imagem de compartilhamento, noindex, idioma) entra no <head>, os
 * códigos livres (da oferta e da página: head / início e fim do body) entram,
 * o script do Offer Studio vai antes do </body> e, com rastreamento, a
 * configuração e o script de pixels vão para o começo do <head>.
 */
import { INTERNAL_LINK_PREFIX } from "@/lib/internal-links";
import { applyOfferLinks, type OfferLinkValue } from "@/lib/offer-links";
import { type Company, fillCompanyPlaceholders } from "@/lib/offer-settings";
import { injectPageCode, PAGE_CODE_FIELDS, type PageCustomCode, unclosedCodePart } from "@/lib/page-code";
import { injectRuntime } from "@/lib/runtime-bundle";
import { applySeo, type SeoRender } from "@/lib/seo-render";
import { resolveCodeCategoryFull } from "@/lib/tracking/code-trackers-server";
import { gateCode, injectTracking } from "@/lib/tracking/inject";
import type { TrackingRuntimeConfig } from "@/lib/tracking/runtime-config";
import type { CodeCategoryId } from "@/lib/tracking/schema";

/**
 * Código livre com a categoria de consentimento. Sem categoria (a pessoa nunca
 * escolheu): "Marketing" se o código tem pixel/tag de rastreamento, senão
 * "Essencial" (ver resolveCodeCategoryFull).
 */
export type CategorizedCode = Partial<PageCustomCode> & { category?: CodeCategoryId | null };

export interface TrackingRenderOptions {
  /** Configuração pública (buildTrackingConfig / loadTracking). */
  config: TrackingRuntimeConfig;
  /** Tag do script de rastreamento (externo na prévia, embutido no ZIP). */
  scriptTag: string;
  /** Código livre da OFERTA (TrackingSettings.customCode), em todas as páginas. */
  offerCode?: CategorizedCode | null;
}

export interface RenderOptions {
  links: OfferLinkValue[];
  /** Endereço de outra página do funil (prévia: /p/<id>; ZIP: caminho relativo). */
  pageHref: (pageId: string) => string;
  /** Tag do script do Offer Studio (externo na prévia, embutido no ZIP). */
  runtimeTag: string;
  /**
   * Códigos livres da página (Page.customCode, ver parsePageCode; `category` via
   * explicitPageCodeCategory: null = automática, ver resolveCodeCategoryFull). Opcional.
   */
  customCode?: CategorizedCode | null;
  /**
   * Rastreamento (Fase 4). Sem ele, a página sai como na Fase 3: nada de pixels
   * e os códigos livres rodam direto (sem esperar consentimento).
   */
  tracking?: TrackingRenderOptions | null;
  /**
   * Dados da empresa (Offer.settings.company): trocam os marcadores {{EMPRESA}},
   * {{CNPJ}}… do HTML da página (não os dos códigos livres).
   */
  company?: Company | null;
  /** SEO da página (effectiveSeo + idioma, ver seoRenderFrom). Campos vazios mantêm o da página. */
  seo?: SeoRender | null;
}

const PAGE_LINK_RE = new RegExp(`${INTERNAL_LINK_PREFIX}([a-z0-9]{20,32})`, "g");

/**
 * Código usável (não vazio e que fecha tudo), já com a categoria aplicada.
 * `waits`: diz se sobrou código de Estatística/Marketing (o aviso de cookies
 * aparece por causa dele).
 */
function usableCode(
  code: CategorizedCode | null | undefined,
  gate: boolean,
): { parts: Partial<PageCustomCode>; waits: boolean } {
  const parts: Partial<PageCustomCode> = {};
  if (!code) return { parts, waits: false };
  const category = resolveCodeCategoryFull(code, code.category ?? null).category;
  let waits = false;
  for (const field of PAGE_CODE_FIELDS) {
    const text = code[field]?.trim() ?? "";
    // Um código que não fecha é descartado aqui (antes de juntar), para não
    // derrubar o código da oferta junto com o da página ou vice-versa.
    if (!text || unclosedCodePart(text)) continue;
    parts[field] = gate ? gateCode(text, category) : text;
    if (category !== "NECESSARY") waits = true;
  }
  return { parts, waits };
}

/** Código da oferta primeiro, depois o da página (em cada posição). */
function mergeCode(offer: Partial<PageCustomCode>, page: Partial<PageCustomCode>): Partial<PageCustomCode> {
  const out: Partial<PageCustomCode> = {};
  for (const field of PAGE_CODE_FIELDS) {
    const parts = [offer[field], page[field]].filter(Boolean);
    if (parts.length) out[field] = parts.join("\n");
  }
  return out;
}

/**
 * O código de Estatística/Marketing precisa esperar o "Aceitar"? Só com
 * rastreamento (sem ele não há quem ative o código: roda direto, como na
 * Fase 3) e, na página publicada, só no modo "Pedir permissão": com "Só avisar"
 * ou sem aviso o código roda no lugar dele, sem atraso (e com os eventos
 * DOMContentLoaded/load de sempre). A prévia nunca ativa e a tela de teste
 * ativa sozinha: nas duas o código fica em espera.
 */
function gatesCode(tracking: TrackingRenderOptions | null): boolean {
  if (!tracking) return false;
  return tracking.config.mode !== "live" || tracking.config.consent.mode === "OPT_IN";
}

export function renderPageHtml(html: string, opts: RenderOptions) {
  let out = opts.company ? fillCompanyPlaceholders(html, opts.company) : html;
  out = out.replace(PAGE_LINK_RE, (_, id: string) => opts.pageHref(id));
  out = applyOfferLinks(out, opts.links);
  out = applySeo(out, opts.seo);
  const tracking = opts.tracking ?? null;
  const gate = gatesCode(tracking);
  const pageCode = usableCode(opts.customCode, gate);
  const offerCode = tracking ? usableCode(tracking.offerCode, gate) : { parts: {}, waits: false };
  out = injectPageCode(out, mergeCode(offerCode.parts, pageCode.parts));
  out = injectRuntime(out, opts.runtimeTag);
  if (tracking) {
    // Código de marketing sem pixels também pede o aviso de cookies.
    const marketingCode = tracking.config.marketingCode || offerCode.waits || pageCode.waits;
    out = injectTracking(out, { ...tracking.config, marketingCode }, tracking.scriptTag);
  }
  return out;
}

/** Celular pelo User-Agent (para ofertas com versões separadas desktop/celular). */
export function isMobileUserAgent(ua: string | undefined) {
  return /iPhone|iPod|Android.*Mobile|Mobile Safari|Windows Phone|BlackBerry|Opera Mini/i.test(ua ?? "");
}
