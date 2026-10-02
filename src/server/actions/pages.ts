"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { protectedAction } from "@/server/action";
import { PAGE_TEMPLATE_IDS } from "@/server/services/page-templates";
import * as pages from "@/server/services/pages";

const id = z.string().min(1, "Item inválido.");
const pageName = z
  .string()
  .trim()
  .min(1, "Dê um nome para a página.")
  .max(120, "O nome pode ter no máximo 120 caracteres.");
const slug = z.string().trim().toLowerCase();

function refreshAll() {
  revalidatePath("/", "layout");
}

export const createPageAction = protectedAction(
  z.object({
    offerId: id,
    name: pageName,
    type: z.enum(pages.PAGE_TYPE_VALUES).optional(),
    slug: slug.optional(),
    templateId: z.enum(PAGE_TEMPLATE_IDS, "Modelo de página inválido.").optional(),
  }),
  async (input) => {
    const page = await pages.createPage({ ...input, slug: input.slug || undefined });
    refreshAll();
    return page;
  },
);

export const updatePageAction = protectedAction(
  z.object({ id, name: pageName.optional(), slug: slug.optional(), type: z.enum(pages.PAGE_TYPE_VALUES).optional() }),
  async (input) => {
    await pages.updatePage(input);
    refreshAll();
  },
);

export const reorderPagesAction = protectedAction(
  z.object({ offerId: id, orderedIds: z.array(id).min(1).max(200) }),
  async ({ offerId, orderedIds }) => {
    await pages.reorderPages(offerId, orderedIds);
    refreshAll();
  },
);

export const setHomePageAction = protectedAction(z.object({ id }), async ({ id }) => {
  await pages.setHomePage(id);
  refreshAll();
});

export const duplicatePageAction = protectedAction(z.object({ id }), async ({ id }) => {
  const page = await pages.duplicatePage(id);
  refreshAll();
  return page;
});

/**
 * Exclui a página. Links de outras páginas para ela ficam sem destino ("#"), ou
 * passam a levar para `redirectToPageId` (outra página da mesma oferta).
 */
export const deletePageAction = protectedAction(
  z.object({ id, redirectToPageId: id.optional() }),
  async ({ id, redirectToPageId }) => {
    await pages.deletePage(id, { redirectToPageId });
    refreshAll();
  },
);

/** Quantas outras páginas da oferta têm botões/links para esta (aviso antes de excluir). */
export const pageReferencesAction = protectedAction(z.object({ pageId: id }), async ({ pageId }) =>
  pages.pageReferences(pageId),
);
