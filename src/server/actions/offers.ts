"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { protectedAction } from "@/server/action";
import * as offers from "@/server/services/offers";
import { PAGE_TEMPLATE_IDS } from "@/server/services/page-templates";

const id = z.string().min(1, "Item inválido.");
const offerName = z
  .string()
  .trim()
  .min(1, "Dê um nome para a oferta.")
  .max(120, "O nome pode ter no máximo 120 caracteres.");
const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => !v || /^https?:\/\/[^\s]+\.[^\s]+/i.test(v), "Digite um endereço completo, começando com https://")
  .nullish();

function refreshAll() {
  revalidatePath("/", "layout");
}

export const createOfferAction = protectedAction(
  z.object({
    name: offerName,
    folderId: id.nullish(),
    tagIds: z.array(id).max(30).default([]),
    notes: z.string().trim().max(2000).nullish(),
    templateId: z.enum(PAGE_TEMPLATE_IDS, "Modelo de página inválido.").optional(),
  }),
  async (input) => {
    const offer = await offers.createOffer(input);
    refreshAll();
    return offer;
  },
);

export const updateOfferAction = protectedAction(
  z.object({
    id,
    name: offerName.optional(),
    notes: z.string().trim().max(2000, "As notas podem ter no máximo 2000 caracteres.").nullish(),
    status: z.enum(offers.OFFER_STATUS_VALUES).optional(),
    liveUrl: optionalUrl,
    folderId: id.nullish(),
  }),
  async (input) => {
    await offers.updateOffer(input);
    refreshAll();
  },
);

export const setOfferTagsAction = protectedAction(
  z.object({ offerId: id, tagIds: z.array(id).max(30, "No máximo 30 tags por oferta.") }),
  async ({ offerId, tagIds }) => {
    await offers.setOfferTags(offerId, tagIds);
    refreshAll();
  },
);

export const duplicateOfferAction = protectedAction(z.object({ id }), async ({ id }) => {
  const copy = await offers.duplicateOffer(id);
  refreshAll();
  return copy;
});

export const trashOfferAction = protectedAction(z.object({ id }), async ({ id }) => {
  await offers.trashOffer(id);
  refreshAll();
});

export const restoreOfferAction = protectedAction(z.object({ id }), async ({ id }) => {
  await offers.restoreOffer(id);
  refreshAll();
});

export const deleteOfferForeverAction = protectedAction(z.object({ id }), async ({ id }) => {
  await offers.deleteOfferForever(id);
  refreshAll();
});

export const emptyTrashAction = protectedAction(z.object({}), async () => {
  const count = await offers.emptyTrash();
  refreshAll();
  return { count };
});
