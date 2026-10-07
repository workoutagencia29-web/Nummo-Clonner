"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { linkUrlProblem, normalizeLinkUrl } from "@/lib/link-url";
import { protectedAction } from "@/server/action";
import * as links from "@/server/services/offer-links";

const id = z.string().min(1, "Item inválido.");
const label = z.string().trim().min(1, "Dê um nome para o link.").max(60, "O nome pode ter no máximo 60 caracteres.");
/**
 * URL vazia é permitida (link ainda não configurado); se preenchida, precisa ser
 * completa, com o domínio inteiro ("pay.kiwify" sem o .com.br é recusado).
 */
const url = z
  .string()
  .trim()
  .max(2000, "Link muito longo.")
  .transform(normalizeLinkUrl)
  .superRefine((v, ctx) => {
    const problem = linkUrlProblem(v);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });
const kind = z.enum(links.OFFER_LINK_KINDS);
const target = z.enum(["URL", "PAYMENT"]);

function refresh() {
  revalidatePath("/", "layout");
}

export const createOfferLinkAction = protectedAction(
  z.object({ offerId: id, label, url: url.default(""), kind: kind.default("CHECKOUT"), target: target.default("URL") }),
  async ({ offerId, ...input }) => {
    const link = await links.createOfferLink(offerId, input);
    refresh();
    return link;
  },
);

export const updateOfferLinkAction = protectedAction(
  z.object({ id, label: label.optional(), url: url.optional(), kind: kind.optional() }),
  async ({ id, ...input }) => {
    await links.updateOfferLink(id, input);
    refresh();
  },
);

export const deleteOfferLinkAction = protectedAction(z.object({ id }), async ({ id }) => {
  await links.deleteOfferLink(id);
  refresh();
});
