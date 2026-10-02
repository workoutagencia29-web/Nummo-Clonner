/**
 * Páginas de uma oferta (o funil): criar, renomear, trocar endereço, ordenar,
 * definir a inicial, duplicar e excluir.
 */
import { gunzipSync } from "node:zlib";
import { type PageType, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { internalLink } from "@/lib/internal-links";
import { copyName, slugify, slugProblem, uniqueSlug } from "@/lib/text";
import { bulkReplace } from "@/server/services/bulk-replace";
import { relabelLatestVersions, removeVersionFiles } from "@/server/services/documents";
import { pageStart } from "@/server/services/page-templates";

export const PAGE_TYPE_VALUES = [
  "SALES",
  "VSL",
  "ADVERTORIAL",
  "QUIZ",
  "CAPTURE",
  "UPSELL",
  "DOWNSELL",
  "THANK_YOU",
  "LEGAL",
  "OTHER",
] as const satisfies readonly PageType[];

async function offerOrThrow(offerId: string) {
  const offer = await prisma.offer.findFirst({ where: { id: offerId, deletedAt: null }, select: { id: true } });
  if (!offer) throw new UserError("Oferta não encontrada.");
  return offer;
}

async function pageOrThrow(pageId: string) {
  const page = await prisma.page.findFirst({
    where: { id: pageId, offer: { deletedAt: null } },
    select: { id: true, offerId: true, isHome: true, name: true, slug: true, position: true },
  });
  if (!page) throw new UserError("Página não encontrada.");
  return page;
}

async function takenSlugs(offerId: string, exceptPageId?: string) {
  const pages = await prisma.page.findMany({
    where: { offerId, ...(exceptPageId ? { id: { not: exceptPageId } } : {}) },
    select: { slug: true },
  });
  return pages.map((p) => p.slug);
}

async function touchOffer(offerId: string) {
  await prisma.offer.update({ where: { id: offerId }, data: { updatedAt: new Date() } });
}

export interface CreatePageInput {
  offerId: string;
  name: string;
  type?: PageType;
  slug?: string;
  /** Modelo de página inteira (src/editor/templates); sem modelo, começa em branco. */
  templateId?: string | null;
}

export async function createPage(input: CreatePageInput) {
  await offerOrThrow(input.offerId);
  const start = pageStart(input.templateId, input.name);
  const taken = await takenSlugs(input.offerId);
  let slug: string;
  if (input.slug) {
    const problem = slugProblem(input.slug);
    if (problem) throw new UserError(problem, "slug");
    if (taken.includes(input.slug))
      throw new UserError("Já existe uma página com esse endereço (slug) nesta oferta.", "slug");
    slug = input.slug;
  } else {
    slug = uniqueSlug(input.name, taken);
  }
  const last = await prisma.page.aggregate({ where: { offerId: input.offerId }, _max: { position: true } });
  const hasHome = await prisma.page.count({ where: { offerId: input.offerId, isHome: true } });
  const page = await prisma.page.create({
    data: {
      offerId: input.offerId,
      name: input.name,
      slug,
      type: input.type ?? start.type,
      position: (last._max.position ?? -1) + 1,
      isHome: hasHome === 0,
      variants: {
        create: {
          name: "A",
          isControl: true,
          weight: 100,
          documents: { create: { device: "ALL", html: start.html } },
        },
      },
    },
    select: { id: true },
  });
  await touchOffer(input.offerId);
  return page;
}

export interface UpdatePageInput {
  id: string;
  name?: string;
  slug?: string;
  type?: PageType;
}

export async function updatePage(input: UpdatePageInput) {
  const page = await pageOrThrow(input.id);
  if (input.slug !== undefined && input.slug !== page.slug) {
    const problem = slugProblem(input.slug);
    if (problem) throw new UserError(problem, "slug");
    if ((await takenSlugs(page.offerId, page.id)).includes(input.slug)) {
      throw new UserError("Já existe uma página com esse endereço (slug) nesta oferta.", "slug");
    }
  }
  await prisma.page.update({
    where: { id: page.id },
    data: { name: input.name, slug: input.slug, type: input.type },
  });
  await touchOffer(page.offerId);
}

/** Define a ordem das páginas (lista completa de IDs na nova ordem). */
export async function reorderPages(offerId: string, orderedIds: string[]) {
  await offerOrThrow(offerId);
  const pages = await prisma.page.findMany({ where: { offerId }, select: { id: true } });
  const current = new Set(pages.map((p) => p.id));
  if (
    orderedIds.length !== current.size ||
    new Set(orderedIds).size !== orderedIds.length ||
    !orderedIds.every((id) => current.has(id))
  ) {
    throw new UserError("A lista de páginas mudou. Recarregue a tela e tente de novo.");
  }
  await prisma.$transaction(
    orderedIds.map((id, position) => prisma.page.update({ where: { id }, data: { position } })),
  );
  await touchOffer(offerId);
}

/** Marca a página como inicial (vai para a raiz do ZIP). */
export async function setHomePage(pageId: string) {
  const page = await pageOrThrow(pageId);
  if (page.isHome) return;
  await prisma.$transaction([
    prisma.page.updateMany({ where: { offerId: page.offerId, isHome: true }, data: { isHome: false } }),
    prisma.page.update({ where: { id: page.id }, data: { isHome: true } }),
  ]);
  await touchOffer(page.offerId);
}

/** Duplica uma página dentro da mesma oferta (todas as variações). */
export async function duplicatePage(pageId: string) {
  const source = await prisma.page.findFirst({
    where: { id: pageId, offer: { deletedAt: null } },
    include: { variants: { orderBy: { position: "asc" }, include: { documents: true } } },
  });
  if (!source) throw new UserError("Página não encontrada.");
  const siblings = await prisma.page.findMany({
    where: { offerId: source.offerId },
    select: { name: true, slug: true },
  });
  const name = copyName(
    source.name,
    siblings.map((s) => s.name),
  );
  const slug = uniqueSlug(
    `${source.slug}-copia`,
    siblings.map((s) => s.slug),
  );

  const created = await prisma.$transaction(async (tx) => {
    await tx.page.updateMany({
      where: { offerId: source.offerId, position: { gt: source.position } },
      data: { position: { increment: 1 } },
    });
    return tx.page.create({
      data: {
        offerId: source.offerId,
        name,
        slug,
        type: source.type,
        position: source.position + 1,
        isHome: false,
        cloneMode: source.cloneMode,
        sourceUrl: source.sourceUrl,
        seo: source.seo ?? {},
        customCode: source.customCode ?? {},
        variants: {
          create: source.variants.map((v) => ({
            name: v.name,
            label: v.label,
            isControl: v.isControl,
            weight: v.weight,
            position: v.position,
            documents: {
              create: v.documents.map((d) => ({
                device: d.device,
                html: d.html,
                project: d.project,
                // "Preservar JS": arquivos nos caminhos originais (sem isso, 404 na cópia).
                assetMap: d.assetMap ?? Prisma.JsonNull,
                editableHtml: d.editableHtml,
                revision: 0,
              })),
            },
          })),
        },
      },
      select: { id: true },
    });
  });
  await touchOffer(source.offerId);
  return created;
}

// ─── Links de outras páginas (os-page:<id>) ──────────────────────────────────

function projectText(project: Uint8Array | null) {
  if (!project) return "";
  try {
    return gunzipSync(project).toString("utf8");
  } catch {
    return Buffer.from(project).toString("utf8");
  }
}

export interface PageReferences {
  /** Quantas outras páginas da oferta têm botões/links que levam a esta página. */
  count: number;
  /** Essas páginas, na ordem do funil. */
  pages: { id: string; name: string }[];
}

/**
 * Outras páginas da oferta com botões ou links para esta ("Página do funil",
 * formulários que levam a ela, links do funil clonado). Usado para avisar antes
 * de excluir a página.
 */
export async function pageReferences(pageId: string): Promise<PageReferences> {
  const page = await pageOrThrow(pageId);
  const token = internalLink(page.id);
  const docs = await prisma.pageDocument.findMany({
    where: { variant: { page: { offerId: page.offerId, id: { not: page.id } } } },
    select: {
      html: true,
      project: true,
      variant: { select: { page: { select: { id: true, name: true, position: true } } } },
    },
  });
  const found = new Map<string, { id: string; name: string; position: number }>();
  for (const doc of docs) {
    const p = doc.variant.page;
    if (found.has(p.id)) continue;
    if (doc.html?.includes(token) || projectText(doc.project).includes(token)) found.set(p.id, p);
  }
  const pages = [...found.values()].sort((a, b) => a.position - b.position).map(({ id, name }) => ({ id, name }));
  return { count: pages.length, pages };
}

function shortName(name: string) {
  return name.length > 60 ? `${name.slice(0, 59)}…` : name;
}

/**
 * Tira de todas as outras páginas da oferta os links para esta página (no HTML
 * e no projeto do editor): viram "#" ou passam a levar para `replacementPageId`.
 * Cada documento alterado ganha antes uma versão "Antes de excluir a página…"
 * e a revisão sobe (uma aba aberta com a página avisa do conflito).
 */
async function unlinkPage(
  page: { id: string; offerId: string; name: string },
  ownDocumentIds: string[],
  replacementPageId?: string,
) {
  if (!(await pageReferences(page.id)).count) return;
  const result = await bulkReplace({
    offerId: page.offerId,
    query: internalLink(page.id),
    replacement: replacementPageId ? internalLink(replacementPageId) : "#",
    targets: { text: false, attributes: true },
    excludeDocumentIds: ownDocumentIds,
  });
  await relabelLatestVersions(
    result.changedDocumentIds,
    "BULK_REPLACE",
    `Antes de excluir a página “${shortName(page.name)}”`,
  );
}

export interface DeletePageOptions {
  /**
   * Os links de outras páginas para a página excluída passam a levar para esta
   * página da mesma oferta. Sem ela, esses links ficam sem destino ("#").
   */
  redirectToPageId?: string;
}

/**
 * Exclui uma página. Se for a inicial, a primeira das restantes vira inicial.
 * A última página de uma oferta não pode ser excluída. Botões e links de outras
 * páginas que levavam a ela são desfeitos (ou apontados para outra página), e o
 * histórico de versões dela sai do disco.
 */
export async function deletePage(pageId: string, opts: DeletePageOptions = {}) {
  const page = await pageOrThrow(pageId);
  const total = await prisma.page.count({ where: { offerId: page.offerId } });
  if (total <= 1) throw new UserError("A oferta precisa ter pelo menos uma página.");
  if (opts.redirectToPageId) {
    const target = await prisma.page.count({
      where: { id: opts.redirectToPageId, offerId: page.offerId, NOT: { id: page.id } },
    });
    if (!target) throw new UserError("A página escolhida para os links não existe mais nesta oferta.");
  }
  const ownDocumentIds = (
    await prisma.pageDocument.findMany({ where: { variant: { pageId: page.id } }, select: { id: true } })
  ).map((d) => d.id);

  await unlinkPage(page, ownDocumentIds, opts.redirectToPageId);

  await prisma.$transaction(async (tx) => {
    await tx.page.delete({ where: { id: page.id } });
    if (page.isHome) {
      const next = await tx.page.findFirst({ where: { offerId: page.offerId }, orderBy: { position: "asc" } });
      if (next) await tx.page.update({ where: { id: next.id }, data: { isHome: true } });
    }
  });
  await removeVersionFiles(ownDocumentIds);
  await touchOffer(page.offerId);
}

/** Sugestão de slug a partir do nome (usada no formulário). */
export function suggestSlug(name: string) {
  return slugify(name);
}
