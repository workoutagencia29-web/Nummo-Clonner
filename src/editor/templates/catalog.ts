/**
 * Catálogo dos modelos de página (sem o HTML): pode ser importado pela tela
 * (galeria "Nova página" e "Nova oferta") sem pesar no navegador.
 * A ordem segue o funil: entrada → captura → pós-venda → páginas legais.
 */
import { svgData } from "./assets";
import { THUMBNAILS } from "./thumbnails";
import type { TemplateSummary } from "./types";

export const TEMPLATE_IDS = [
  "vendas-longa",
  "vsl",
  "advertorial",
  "captura",
  "upsell",
  "downsell",
  "obrigado",
  "politica-privacidade",
  "termos-de-uso",
] as const;

export type PageTemplateId = (typeof TEMPLATE_IDS)[number];

export const LEGAL_NOTICE =
  "Texto genérico de referência, não é aconselhamento jurídico. Troque {{EMPRESA}}, {{CNPJ}} e {{EMAIL}} pelos seus dados (no editor, use Localizar e substituir) e revise com um advogado antes de publicar.";

const SUMMARIES: Record<PageTemplateId, Omit<TemplateSummary, "id" | "thumbnail">> = {
  "vendas-longa": {
    name: "Página de vendas longa",
    description:
      "Carta de vendas completa: headline, benefícios, módulos, bônus, depoimentos, preço com parcelas, garantia, FAQ e popup de saída.",
    pageType: "SALES",
    pageName: "Página de vendas",
  },
  vsl: {
    name: "VSL",
    description: "Vídeo no topo, botão que aparece depois de um tempo, depoimentos e garantia.",
    pageType: "VSL",
    pageName: "VSL",
  },
  advertorial: {
    name: "Advertorial",
    description: "Matéria em formato jornalístico, marcada como publicidade, com chamadas para a oferta.",
    pageType: "ADVERTORIAL",
    pageName: "Advertorial",
  },
  captura: {
    name: "Captura de leads",
    description: "Isca digital com formulário (nome, e-mail e WhatsApp), prova social e notificação de inscrição.",
    pageType: "CAPTURE",
    pageName: "Captura",
  },
  upsell: {
    name: "Upsell",
    description: "Oferta única depois da compra, com contador e botões “Sim, quero” / “Não, obrigado”.",
    pageType: "UPSELL",
    pageName: "Upsell",
  },
  downsell: {
    name: "Downsell",
    description: "Alternativa mais barata para quem recusou o upsell, com os mesmos botões de sim/não.",
    pageType: "DOWNSELL",
    pageName: "Downsell",
  },
  obrigado: {
    name: "Obrigado",
    description: "Confirmação da compra, próximos passos e botão para o grupo do WhatsApp.",
    pageType: "THANK_YOU",
    pageName: "Obrigado",
  },
  "politica-privacidade": {
    name: "Política de privacidade",
    description: "Texto genérico baseado na LGPD, com os dados da empresa para preencher.",
    pageType: "LEGAL",
    pageName: "Política de privacidade",
    notice: LEGAL_NOTICE,
  },
  "termos-de-uso": {
    name: "Termos de uso",
    description: "Termos genéricos para produtos digitais (acesso, pagamento, garantia de 7 dias, direitos autorais).",
    pageType: "LEGAL",
    pageName: "Termos de uso",
    notice: LEGAL_NOTICE,
  },
};

/** Modelos na ordem da galeria. */
export const TEMPLATE_SUMMARIES: readonly TemplateSummary[] = TEMPLATE_IDS.map((id) => ({
  id,
  ...SUMMARIES[id],
  thumbnail: THUMBNAILS[id],
}));

export function isTemplateId(id: string): id is PageTemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(id);
}

export function templateSummary(id: string): TemplateSummary | undefined {
  return TEMPLATE_SUMMARIES.find((t) => t.id === id);
}

/** Miniatura pronta para <img src>. */
export function thumbnailUrl(summary: Pick<TemplateSummary, "thumbnail">) {
  return svgData(summary.thumbnail);
}
