/**
 * Códigos livres de uma página (Page.customCode): o que vai no <head>, logo
 * depois de abrir o <body> e antes de fechar o </body>.
 *
 * Esses códigos NUNCA rodam no editor: só entram no HTML servido na prévia e
 * no ZIP (via `injectPageCode` de src/lib/page-code.ts, chamado por
 * renderPageHtml em src/lib/page-render.ts). A fase de pixels guarda outras
 * chaves no mesmo JSON — por isso salvar aqui preserva tudo o que não for
 * head/bodyStart/bodyEnd.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import {
  EMPTY_PAGE_CODE,
  isRecord,
  PAGE_CODE_FIELDS,
  type PageCodeField,
  type PageCustomCode,
  parsePageCode,
  unclosedCodePart,
} from "@/lib/page-code";
import { type CodeCategoryId, explicitPageCodeCategory } from "@/lib/tracking/schema";

export {
  EMPTY_PAGE_CODE,
  injectPageCode,
  PAGE_CODE_FIELDS,
  type PageCodeField,
  type PageCustomCode,
  parsePageCode,
} from "@/lib/page-code";

/** Limite somado dos três campos (bytes em UTF-8). */
export const PAGE_CODE_MAX_BYTES = 200 * 1024;

export const PAGE_CODE_LABELS: Record<PageCodeField, string> = {
  head: "no <head>",
  bodyStart: "no início do <body>",
  bodyEnd: "no fim do <body>",
};

export function pageCodeBytes(code: PageCustomCode) {
  return PAGE_CODE_FIELDS.reduce((sum, field) => sum + Buffer.byteLength(code[field], "utf8"), 0);
}

/** KB com uma casa, arredondando para cima (201 KB nunca aparece como "200 KB"). */
function formatKb(bytes: number) {
  return `${(Math.ceil(bytes / 102.4) / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB`;
}

/**
 * Limpa e valida (tamanho e tags/comentários sem fechar). Lança UserError com o
 * campo culpado.
 */
export function normalizePageCode(input: Partial<PageCustomCode>): PageCustomCode {
  const code = { ...EMPTY_PAGE_CODE };
  for (const field of PAGE_CODE_FIELDS) {
    code[field] = (input[field] ?? "").replace(/\r\n?/g, "\n").trim();
  }
  const total = pageCodeBytes(code);
  if (total > PAGE_CODE_MAX_BYTES) {
    const biggest = PAGE_CODE_FIELDS.reduce((a, b) => (code[b].length > code[a].length ? b : a));
    throw new UserError(
      `Os códigos da página somam ${formatKb(total)} e o limite é ${formatKb(PAGE_CODE_MAX_BYTES)}. ` +
        "Diminua o código ou carregue scripts grandes por um endereço (<script src=…>).",
      biggest,
    );
  }
  // Um <script> sem </script> (ou <!-- sem -->) engole o resto da página: o
  // script do Offer Studio some e a oferta com atraso nunca aparece.
  for (const field of PAGE_CODE_FIELDS) {
    const problem = unclosedCodePart(code[field]);
    if (problem) {
      throw new UserError(
        `O código ${PAGE_CODE_LABELS[field]} tem ${problem}. Do jeito que está, ele esconde o resto da página ` +
          "e desliga os recursos do Offer Studio (atraso da oferta, contador, formulários). " +
          "Confira o final do código colado e feche o que ficou aberto.",
        field,
      );
    }
  }
  return code;
}

async function pageOrThrow(pageId: string) {
  const page = await prisma.page.findFirst({
    where: { id: pageId, offer: { deletedAt: null } },
    select: { id: true, offerId: true, customCode: true },
  });
  if (!page) throw new UserError("Página não encontrada. Ela pode ter sido excluída.");
  return page;
}

export async function getPageCode(pageId: string): Promise<PageCustomCode> {
  const page = await pageOrThrow(pageId);
  return parsePageCode(page.customCode);
}

/** Códigos + quando carregam (categoria escolhida; null = automática), para o editor. */
export interface PageCodeView extends PageCustomCode {
  category: CodeCategoryId | null;
}

export async function getPageCodeView(pageId: string): Promise<PageCodeView> {
  const page = await pageOrThrow(pageId);
  return { ...parsePageCode(page.customCode), category: explicitPageCodeCategory(page.customCode) };
}

/** Salva head/início/fim do body, mantendo as outras chaves do JSON (pixels etc.). */
export async function savePageCode(pageId: string, input: Partial<PageCustomCode>): Promise<PageCustomCode> {
  const page = await pageOrThrow(pageId);
  const code = normalizePageCode(input);
  const previous = isRecord(page.customCode) ? page.customCode : {};
  const customCode = { ...previous, ...code } as Prisma.InputJsonObject;
  await prisma.$transaction([
    prisma.page.update({ where: { id: page.id }, data: { customCode } }),
    prisma.offer.update({ where: { id: page.offerId }, data: { updatedAt: new Date() } }),
  ]);
  return code;
}
