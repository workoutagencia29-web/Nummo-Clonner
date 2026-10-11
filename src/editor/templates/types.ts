/** Tipos dos modelos de página inteira (galeria "Nova página"). */
import type { PageType } from "@/generated/prisma/enums";

/** Tipos de página que têm modelo pronto (subconjunto do PageType do banco). */
export type TemplatePageType = Extract<
  PageType,
  "SALES" | "VSL" | "QUIZ" | "CAPTURE" | "UPSELL" | "DOWNSELL" | "THANK_YOU" | "ADVERTORIAL" | "LEGAL" | "OTHER"
>;

/** O que a tela precisa para mostrar um modelo (sem o HTML, que é pesado). */
export interface TemplateSummary {
  id: string;
  /** Nome curto do modelo (card da galeria). */
  name: string;
  /** Uma frase sobre o que a página tem. */
  description: string;
  pageType: TemplatePageType;
  /** Nome sugerido para a página criada com o modelo. */
  pageName: string;
  /** Ilustração SVG (markup) usada como miniatura. */
  thumbnail: string;
  /** Aviso mostrado no painel ao escolher o modelo (ex.: textos jurídicos). */
  notice?: string;
  /**
   * O modelo tem preços escritos como texto ("De R$ 297,00 por…"): eles não
   * acompanham a moeda da oferta (a "Nova oferta" avisa numa moeda que não é o
   * real). Os modelos da loja montam os preços na moeda (templateHtmlFor).
   */
  textPrices?: boolean;
}

/** Modelo completo: resumo + documento HTML. */
export interface PageTemplate extends TemplateSummary {
  /**
   * Documento HTML completo. Pode conter os marcadores de data
   * (TODAY_MARKER / YEAR_MARKER), trocados por `templateHtml` na criação.
   */
  html: string;
}
