/**
 * Modelos de página inteira para montar uma página do zero (galeria "Nova
 * página"). Cada modelo é um documento HTML completo, com CSS próprio no
 * <head> e os ganchos do Offer Studio (links da oferta, contador, formulário,
 * popup…), pronto para abrir no editor.
 *
 * Use pelo servidor (src/server/services/page-templates.ts). A tela importa só
 * o catálogo (./catalog), sem o HTML.
 */
import { advertorialHtml } from "./advertorial";
import { captureHtml } from "./capture";
import { type PageTemplateId, TEMPLATE_SUMMARIES } from "./catalog";
import { privacyHtml, termsHtml } from "./legal";
import { salesHtml } from "./sales";
import { thankYouHtml } from "./thank-you";
import type { PageTemplate } from "./types";
import { downsellHtml, upsellHtml } from "./upsell";
import { vslHtml } from "./vsl";

export {
  isTemplateId,
  LEGAL_NOTICE,
  type PageTemplateId,
  TEMPLATE_IDS,
  TEMPLATE_SUMMARIES,
  templateSummary,
  thumbnailUrl,
} from "./catalog";
export type { PageTemplate, TemplatePageType, TemplateSummary } from "./types";
export { TODAY_MARKER, YEAR_MARKER } from "./widgets";

const HTML: Record<PageTemplateId, string> = {
  "vendas-longa": salesHtml,
  vsl: vslHtml,
  advertorial: advertorialHtml,
  captura: captureHtml,
  upsell: upsellHtml,
  downsell: downsellHtml,
  obrigado: thankYouHtml,
  "politica-privacidade": privacyHtml,
  "termos-de-uso": termsHtml,
};

export const PAGE_TEMPLATES: readonly PageTemplate[] = TEMPLATE_SUMMARIES.map((summary) => ({
  ...summary,
  html: HTML[summary.id as PageTemplateId],
}));
