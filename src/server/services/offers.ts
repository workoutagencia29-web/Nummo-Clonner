/**
 * Regras de negócio das ofertas (usadas pelas server actions e pelos testes).
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { remapInternalLinks } from "@/lib/internal-links";
import { transformPackedProject } from "@/lib/project-data";
import { copyName, normalizeText } from "@/lib/text";
import { removeVersionFiles } from "@/server/services/documents";
import { pageStart, templateThumbnailKey } from "@/server/services/page-templates";

export const OFFER_STATUS_VALUES = ["DRAFT", "LIVE", "ARCHIVED"] as const;
export type OfferStatusValue = (typeof OFFER_STATUS_VALUES)[number];

export const OFFER_SORTS = ["recentes", "criacao", "nome"] as const;
export type OfferSort = (typeof OFFER_SORTS)[number];

export interface OfferFilters {
  q?: string;
  /** id da pasta, ou "sem-pasta" */
  folder?: string;
  tag?: string;
  status?: OfferStatusValue;
  sort?: OfferSort;
}

const offerCardSelect = {
  id: true,
  name: true,
  notes: true,
  status: true,
  liveUrl: true,
  sourceUrl: true,
  thumbnailKey: true,
  createdAt: true,
  updatedAt: true,
  folder: { select: { id: true, name: true } },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
  _count: { select: { pages: true } },
} satisfies Prisma.OfferSelect;

export type OfferCard = Prisma.OfferGetPayload<{ select: typeof offerCardSelect }>;

/**
 * Lista ofertas ativas (fora da lixeira) com filtros. A busca ignora acentos e
 * maiúsculas e procura no nome, nas notas, na URL de origem e nas tags.
 */
export async function listOffers(filters: OfferFilters = {}): Promise<OfferCard[]> {
  const where: Prisma.OfferWhereInput = { deletedAt: null };
  if (filters.folder === "sem-pasta") where.folderId = null;
  else if (filters.folder) where.folderId = filters.folder;
  if (filters.tag) where.tags = { some: { tagId: filters.tag } };
  if (filters.status) where.status = filters.status;

  const orderBy: Prisma.OfferOrderByWithRelationInput[] =
    filters.sort === "nome"
      ? [{ name: "asc" }]
      : filters.sort === "criacao"
        ? [{ createdAt: "desc" }]
        : [{ updatedAt: "desc" }];

  const offers = await prisma.offer.findMany({ where, orderBy, select: offerCardSelect });
  const q = filters.q ? normalizeText(filters.q) : "";
  if (!q) return offers;
  const terms = q.split(/\s+/).filter(Boolean);
  return offers.filter((o) => {
    const haystack = normalizeText(
      [o.name, o.notes ?? "", o.sourceUrl ?? "", o.liveUrl ?? "", ...o.tags.map((t) => t.tag.name)].join(" "),
    );
    return terms.every((t) => haystack.includes(t));
  });
}

export async function listTrashedOffers() {
  return prisma.offer.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    select: { ...offerCardSelect, deletedAt: true },
  });
}

async function assertFolder(folderId: string | null | undefined) {
  if (!folderId) return;
  const exists = await prisma.folder.count({ where: { id: folderId } });
  if (!exists) throw new UserError("A pasta escolhida não existe mais.", "folderId");
}

async function assertTags(tagIds: string[]) {
  if (!tagIds.length) return;
  const count = await prisma.tag.count({ where: { id: { in: tagIds } } });
  if (count !== new Set(tagIds).size) throw new UserError("Alguma tag escolhida não existe mais.", "tagIds");
}

export interface CreateOfferInput {
  name: string;
  folderId?: string | null;
  tagIds?: string[];
  notes?: string | null;
  /** Modelo da primeira página (src/editor/templates); sem modelo, ela começa em branco. */
  templateId?: string | null;
}

/** Cria uma oferta com a página inicial (variação A), em branco ou a partir de um modelo. */
export async function createOffer(input: CreateOfferInput) {
  await assertFolder(input.folderId);
  await assertTags(input.tagIds ?? []);
  const start = pageStart(input.templateId, input.name);
  // Oferta de modelo: a capa é o esboço do modelo (as clonadas ganham o print da página).
  const thumbnailKey = await templateThumbnailKey(input.templateId);
  return prisma.offer.create({
    data: {
      name: input.name,
      thumbnailKey,
      notes: input.notes || null,
      folderId: input.folderId || null,
      tags: { create: [...new Set(input.tagIds ?? [])].map((tagId) => ({ tagId })) },
      pages: {
        create: {
          name: "Página principal",
          slug: "principal",
          type: start.type,
          isHome: true,
          position: 0,
          variants: {
            create: {
              name: "A",
              isControl: true,
              weight: 100,
              documents: { create: { device: "ALL", html: start.html } },
            },
          },
        },
      },
    },
    select: { id: true },
  });
}

export interface UpdateOfferInput {
  id: string;
  name?: string;
  notes?: string | null;
  status?: OfferStatusValue;
  liveUrl?: string | null;
  folderId?: string | null;
}

export async function updateOffer(input: UpdateOfferInput) {
  const { id, ...data } = input;
  if (data.folderId !== undefined) await assertFolder(data.folderId);
  await prisma.offer.update({
    where: { id, deletedAt: null },
    data: {
      ...data,
      ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
      ...(data.liveUrl !== undefined ? { liveUrl: data.liveUrl || null } : {}),
    },
  });
}

export async function setOfferTags(offerId: string, tagIds: string[]) {
  const offer = await prisma.offer.count({ where: { id: offerId, deletedAt: null } });
  if (!offer) throw new UserError("Oferta não encontrada.");
  await assertTags(tagIds);
  await prisma.$transaction([
    prisma.offerTag.deleteMany({ where: { offerId } }),
    prisma.offerTag.createMany({ data: [...new Set(tagIds)].map((tagId) => ({ offerId, tagId })) }),
    prisma.offer.update({ where: { id: offerId }, data: { updatedAt: new Date() } }),
  ]);
}

/**
 * Duplica a oferta inteira: páginas, variações, documentos, pixels (com o token
 * criptografado), regras de eventos, configurações (rastreamento, empresa, SEO),
 * arquivos e itens detectados na clonagem. Links internos do funil
 * (os-page:<id>), as regras de uma página e a página da política de privacidade
 * do banner são remapeados para as páginas novas.
 */
export async function duplicateOffer(offerId: string) {
  const source = await prisma.offer.findFirst({
    where: { id: offerId, deletedAt: null },
    include: {
      tags: true,
      pages: {
        orderBy: { position: "asc" },
        include: {
          variants: { orderBy: { position: "asc" }, include: { documents: true } },
          removedItems: true,
          checkoutLinks: true,
        },
      },
      pixels: true,
      eventRules: true,
      assets: true,
      links: true,
    },
  });
  if (!source) throw new UserError("Oferta não encontrada.");

  const siblings = await prisma.offer.findMany({ where: { deletedAt: null }, select: { name: true } });
  const newName = copyName(
    source.name,
    siblings.map((s) => s.name),
  );

  return prisma.$transaction(
    async (tx) => {
      const copy = await tx.offer.create({
        data: {
          name: newName,
          notes: source.notes,
          status: "DRAFT",
          liveUrl: null,
          sourceUrl: source.sourceUrl,
          folderId: source.folderId,
          thumbnailKey: source.thumbnailKey,
          settings: source.settings ?? {},
          tracking: source.tracking ?? {},
          tags: { create: source.tags.map((t) => ({ tagId: t.tagId })) },
        },
        select: { id: true },
      });

      // 1ª passada: cria as páginas para conhecer os IDs novos.
      const pageIdMap = new Map<string, string>();
      for (const page of source.pages) {
        const created = await tx.page.create({
          data: {
            offerId: copy.id,
            name: page.name,
            slug: page.slug,
            type: page.type,
            position: page.position,
            isHome: page.isHome,
            cloneMode: page.cloneMode,
            sourceUrl: page.sourceUrl,
            seo: page.seo ?? {},
            customCode: page.customCode ?? {},
          },
          select: { id: true },
        });
        pageIdMap.set(page.id, created.id);
      }

      // 2ª passada: variações e documentos, com links internos remapeados.
      for (const page of source.pages) {
        const newPageId = pageIdMap.get(page.id) as string;
        for (const variant of page.variants) {
          await tx.pageVariant.create({
            data: {
              pageId: newPageId,
              name: variant.name,
              label: variant.label,
              isControl: variant.isControl,
              weight: variant.weight,
              position: variant.position,
              documents: {
                create: variant.documents.map((doc) => ({
                  device: doc.device,
                  html: doc.html ? remapInternalLinks(doc.html, pageIdMap) : doc.html,
                  project: doc.project
                    ? transformPackedProject(doc.project, (json) => remapInternalLinks(json, pageIdMap))
                    : null,
                  // "Preservar JS": arquivos nos caminhos originais (sem isso, 404 na cópia).
                  assetMap: doc.assetMap ?? Prisma.JsonNull,
                  editableHtml: doc.editableHtml ? remapInternalLinks(doc.editableHtml, pageIdMap) : doc.editableHtml,
                  revision: 0,
                })),
              },
            },
          });
        }
        if (page.removedItems.length) {
          await tx.removedItem.createMany({
            data: page.removedItems.map(({ id: _id, jobId: _job, pageId: _p, createdAt: _c, ...rest }) => ({
              ...rest,
              pageId: newPageId,
            })),
          });
        }
        if (page.checkoutLinks.length) {
          await tx.checkoutLink.createMany({
            data: page.checkoutLinks.map(({ id: _id, jobId: _job, pageId: _p, createdAt: _c, ...rest }) => ({
              ...rest,
              pageId: newPageId,
            })),
          });
        }
      }

      if (source.pixels.length) {
        await tx.pixelConfig.createMany({
          data: source.pixels.map(({ id: _id, offerId: _o, createdAt: _c, updatedAt: _u, options, ...rest }) => ({
            ...rest,
            options: options ?? {},
            offerId: copy.id,
          })),
        });
      }
      // Regras de uma página vão para a página nova (a de uma página sumida não vira "todas as páginas").
      const rules = source.eventRules.filter((r) => !r.pageId || pageIdMap.has(r.pageId));
      if (rules.length) {
        await tx.eventRule.createMany({
          data: rules.map(({ id: _id, offerId: _o, createdAt: _c, pageId, ...rest }) => ({
            ...rest,
            offerId: copy.id,
            pageId: pageId ? (pageIdMap.get(pageId) ?? null) : null,
          })),
        });
      }
      // A política de privacidade do banner LGPD aponta para a página nova.
      const tracking = remapTrackingPages(source.tracking, pageIdMap);
      if (tracking) await tx.offer.update({ where: { id: copy.id }, data: { tracking } });
      if (source.links.length) {
        // Os botões guardam a chave do link, então a cópia funciona sem remapear.
        await tx.offerLink.createMany({
          data: source.links.map(({ id: _id, offerId: _o, createdAt: _c, updatedAt: _u, ...rest }) => ({
            ...rest,
            offerId: copy.id,
          })),
        });
      }
      if (source.assets.length) {
        // Os arquivos são endereçados por hash: basta referenciar a mesma chave.
        await tx.asset.createMany({
          data: source.assets.map(({ id: _id, offerId: _o, createdAt: _c, ...rest }) => ({
            ...rest,
            offerId: copy.id,
          })),
          skipDuplicates: true,
        });
      }
      return copy;
    },
    { timeout: 60_000 },
  );
}

/**
 * Offer.tracking com as páginas trocadas pelas da cópia (consent.policyPageId).
 * null = nada a trocar (inclusive JSON em outro formato).
 */
function remapTrackingPages(tracking: Prisma.JsonValue, pageIdMap: Map<string, string>): Prisma.InputJsonObject | null {
  if (!tracking || typeof tracking !== "object" || Array.isArray(tracking)) return null;
  const consent = tracking.consent;
  if (!consent || typeof consent !== "object" || Array.isArray(consent)) return null;
  const policy = consent.policyPageId;
  if (typeof policy !== "string" || !pageIdMap.has(policy)) return null;
  return {
    ...tracking,
    consent: { ...consent, policyPageId: pageIdMap.get(policy) ?? null },
  } as Prisma.InputJsonObject;
}

export async function trashOffer(offerId: string) {
  await prisma.offer.update({ where: { id: offerId, deletedAt: null }, data: { deletedAt: new Date() } });
}

export async function restoreOffer(offerId: string) {
  await prisma.offer.update({ where: { id: offerId, deletedAt: { not: null } }, data: { deletedAt: null } });
}

/** Documentos das ofertas indicadas (para apagar os arquivos de versão depois). */
async function documentIdsOf(where: Prisma.OfferWhereInput) {
  const docs = await prisma.pageDocument.findMany({
    where: { variant: { page: { offer: where } } },
    select: { id: true },
  });
  return docs.map((d) => d.id);
}

/** Exclui de vez (só ofertas que já estão na lixeira), com o histórico de versões. */
export async function deleteOfferForever(offerId: string) {
  const documentIds = await documentIdsOf({ id: offerId, deletedAt: { not: null } });
  await prisma.offer.delete({ where: { id: offerId, deletedAt: { not: null } } });
  await removeVersionFiles(documentIds);
}

export async function emptyTrash() {
  const trashed = await prisma.offer.findMany({ where: { deletedAt: { not: null } }, select: { id: true } });
  if (!trashed.length) return 0;
  const ids = trashed.map((o) => o.id);
  const documentIds = await documentIdsOf({ id: { in: ids } });
  // Só as que ainda estão na lixeira (uma pode ter sido restaurada no meio).
  const { count } = await prisma.offer.deleteMany({ where: { id: { in: ids }, deletedAt: { not: null } } });
  const survivors = new Set(
    (
      await prisma.pageDocument.findMany({
        where: { id: { in: documentIds } },
        select: { id: true },
      })
    ).map((d) => d.id),
  );
  await removeVersionFiles(documentIds.filter((id) => !survivors.has(id)));
  return count;
}
