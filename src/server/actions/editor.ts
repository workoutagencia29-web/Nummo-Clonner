"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { createPreviewToken, previewUrl } from "@/lib/preview";
import { protectedAction } from "@/server/action";
import { convertToEditable } from "@/server/services/documents";

/** Link de prévia das páginas salvas da oferta (abre na página pedida). */
export const offerPreviewUrlAction = protectedAction(
  z.object({
    offerId: z.string().min(1),
    pageId: z.string().min(1).optional(),
    variantId: z.string().min(1).optional(),
  }),
  async ({ offerId, pageId, variantId }) => {
    const offer = await prisma.offer.count({ where: { id: offerId, deletedAt: null } });
    if (!offer) throw new UserError("Oferta não encontrada.");
    const token = await createPreviewToken({ kind: "offer", offerId, pageId, variantId });
    return { url: previewUrl(token) };
  },
);

/** "Converter para editável" (página "Preservar JS"): troca pela cópia editável da clonagem. */
export const convertToEditableAction = protectedAction(
  z.object({ documentId: z.string().min(1) }),
  async ({ documentId }) => convertToEditable(documentId),
);
