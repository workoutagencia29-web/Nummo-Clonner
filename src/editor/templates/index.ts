/**
 * Modelos de página inteira para montar uma página do zero (galeria "Nova
 * página"). Cada modelo é um documento HTML completo, com CSS próprio no
 * <head> e os ganchos do Offer Studio (links da oferta, contador, formulário,
 * popup…), pronto para abrir no editor.
 *
 * Use pelo servidor (src/server/services/page-templates.ts). A tela importa só
 * o catálogo (./catalog), sem o HTML.
 */

import type { StoreCurrency } from "@/lib/store";
import { advertorialHtml } from "./advertorial";
import { captureHtml } from "./capture";
import { type PageTemplateId, TEMPLATE_SUMMARIES } from "./catalog";
import { privacyHtml, termsHtml } from "./legal";
import { productHtml, productHtmlFor } from "./product";
import { quizHtml } from "./quiz";
import { salesHtml } from "./sales";
import { storeHtml, storeHtmlFor } from "./store";
import { thankYouHtml } from "./thank-you";
import type { PageTemplate } from "./types";
import { downsellHtml, upsellHtml } from "./upsell";
import { vslHtml } from "./vsl";
import { wheelHtml } from "./wheel";

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
  quiz: quizHtml,
  roleta: wheelHtml,
  loja: storeHtml,
  produto: productHtml,
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

/**
 * Modelos com preços da loja (vitrines, caixa de compra): o HTML muda com a
 * moeda da oferta. Os outros têm os preços escritos como texto ("R$ 97"): não
 * mudam (TemplateSummary.textPrices avisa na "Nova oferta").
 */
const PRICED: Partial<Record<PageTemplateId, (currency: StoreCurrency) => string>> = {
  loja: storeHtmlFor,
  produto: productHtmlFor,
};

/** HTML do modelo com os preços da loja na moeda `currency` (a da oferta). */
export function templateHtmlFor(id: PageTemplateId, currency: StoreCurrency): string {
  return PRICED[id]?.(currency) ?? HTML[id];
}
