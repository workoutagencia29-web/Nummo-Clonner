/**
 * Modelos de página inteira: lista para a galeria e HTML inicial das páginas
 * criadas a partir de um modelo (usado ao criar página e ao criar oferta).
 */
import {
  isTemplateId,
  PAGE_TEMPLATES,
  type PageTemplate,
  type PageTemplateId,
  TEMPLATE_IDS,
  TEMPLATE_SUMMARIES,
  type TemplatePageType,
  type TemplateSummary,
  TODAY_MARKER,
  YEAR_MARKER,
} from "@/editor/templates";
import { THUMBNAILS } from "@/editor/templates/thumbnails";
import type { PageType } from "@/generated/prisma/client";
import { UserError } from "@/lib/errors";
import { putContentAddressed } from "@/lib/storage";
import { blankPageHtml } from "@/lib/templates";

/** IDs aceitos (para validar com z.enum nas server actions). */
export const PAGE_TEMPLATE_IDS = TEMPLATE_IDS;
export type { PageTemplateId };

const NOT_FOUND = "Modelo de página não encontrado. Escolha outro modelo ou comece em branco.";

/** Modelos para a galeria, na ordem do funil (sem o HTML). */
export function listTemplates(): TemplateSummary[] {
  return TEMPLATE_SUMMARIES.map((t) => ({ ...t }));
}

/**
 * Miniatura do modelo guardada como arquivo (a capa da oferta criada com ele,
 * até existir um print de verdade). null = sem modelo, ou não deu para gravar
 * (a capa colorida com as iniciais continua valendo).
 */
export async function templateThumbnailKey(templateId: string | null | undefined): Promise<string | null> {
  const svg = templateId ? THUMBNAILS[templateId] : undefined;
  if (!svg) return null;
  try {
    return (await putContentAddressed(new TextEncoder().encode(svg), "svg")).key;
  } catch {
    return null;
  }
}

export function getTemplate(id: string): PageTemplate | null {
  return PAGE_TEMPLATES.find((t) => t.id === id) ?? null;
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function formatToday(now: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(now);
}

function yearOf(now: Date) {
  return new Intl.DateTimeFormat("pt-BR", { year: "numeric", timeZone: "America/Sao_Paulo" }).format(now);
}

/**
 * HTML inicial de uma página criada a partir do modelo: o <title> vira o nome
 * da página e as datas (atualização, ano do rodapé) ficam com a data de hoje.
 */
export function templateHtml(id: string, title: string, now = new Date()): string {
  const template = getTemplate(id);
  if (!template) throw new UserError(NOT_FOUND);
  const safeTitle = escapeHtml(title.trim() || template.pageName);
  return template.html
    .replace(/<title>[^<]*<\/title>/, `<title>${safeTitle}</title>`)
    .replaceAll(TODAY_MARKER, formatToday(now))
    .replaceAll(YEAR_MARKER, yearOf(now));
}

/**
 * Como começa uma página nova: do modelo escolhido ou em branco.
 * Sem modelo, o tipo padrão é "Página de vendas".
 */
export function pageStart(templateId: string | null | undefined, title: string): { html: string; type: PageType } {
  if (!templateId) return { html: blankPageHtml(title), type: "SALES" };
  if (!isTemplateId(templateId)) throw new UserError(NOT_FOUND);
  const template = getTemplate(templateId) as PageTemplate;
  const type: TemplatePageType = template.pageType;
  return { html: templateHtml(templateId, title), type };
}
