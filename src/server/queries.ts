import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { requireSession } from "@/server/session";

/** Contagens do menu lateral (uma consulta por requisição, mesmo se chamada 2×). */
export const getSidebarData = cache(async () => {
  await requireSession();
  const [folders, activeCount, trashCount] = await Promise.all([
    prisma.folder.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, _count: { select: { offers: { where: { deletedAt: null } } } } },
    }),
    prisma.offer.count({ where: { deletedAt: null } }),
    prisma.offer.count({ where: { deletedAt: { not: null } } }),
  ]);
  return {
    folders: folders.map((f) => ({ id: f.id, name: f.name, count: f._count.offers })),
    activeCount,
    trashCount,
  };
});

/** Oferta com páginas e variações, para a tela de detalhe. */
export const getOfferDetail = cache(async (id: string) => {
  await requireSession();
  return prisma.offer.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      notes: true,
      status: true,
      liveUrl: true,
      sourceUrl: true,
      thumbnailKey: true,
      createdAt: true,
      updatedAt: true,
      folderId: true,
      folder: { select: { id: true, name: true } },
      tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
      pages: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          isHome: true,
          sourceUrl: true,
          updatedAt: true,
          _count: { select: { variants: true } },
          variants: {
            orderBy: [{ isControl: "desc" }, { position: "asc" }],
            take: 1,
            select: { documents: { select: { id: true, device: true } } },
          },
        },
      },
    },
  });
});

export type OfferDetail = NonNullable<Awaited<ReturnType<typeof getOfferDetail>>>;

/** Worker está vivo se deu sinal nos últimos 30 segundos. */
export async function getWorkerStatus() {
  await requireSession();
  const hb = await prisma.serviceHeartbeat.findUnique({ where: { name: "worker" } });
  const online = Boolean(hb && Date.now() - hb.lastSeenAt.getTime() < 30_000);
  return { online, lastSeenAt: hb?.lastSeenAt ?? null };
}

export async function hasAnyUser() {
  return (await prisma.user.count()) > 0;
}

/**
 * Nomes da página aberta no editor (aba do navegador), ou null se ela não
 * existe mais (página excluída ou oferta na lixeira).
 */
export const getEditorDocumentInfo = cache(async (documentId: string) => {
  await requireSession();
  const doc = await prisma.pageDocument.findFirst({
    where: { id: documentId, variant: { page: { offer: { deletedAt: null } } } },
    select: {
      device: true,
      variant: {
        select: {
          name: true,
          page: { select: { name: true, offer: { select: { name: true } }, _count: { select: { variants: true } } } },
        },
      },
    },
  });
  if (!doc) return null;
  const page = doc.variant.page;
  return {
    pageName: page.name,
    offerName: page.offer.name,
    variantName: doc.variant.name,
    hasVariants: page._count.variants > 1,
    device: doc.device,
  };
});
