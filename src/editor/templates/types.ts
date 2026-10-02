/** Tipos dos modelos de página inteira (galeria "Nova página"). */
import type { PageType } from "@/generated/prisma/enums";

/** Tipos de página que têm modelo pronto (subconjunto do PageType do banco). */
export type TemplatePageType = Extract<
  PageType,
  "SALES" | "VSL" | "CAPTURE" | "UPSELL" | "DOWNSELL" | "THANK_YOU" | "ADVERTORIAL" | "LEGAL"
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
}

/** Modelo completo: resumo + documento HTML. */
export interface PageTemplate extends TemplateSummary {
  /**
   * Documento HTML completo. Pode conter os marcadores de data
   * (TODAY_MARKER / YEAR_MARKER), trocados por `templateHtml` na criação.
   */
  html: string;
}
