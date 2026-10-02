"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createPreviewToken, previewUrl } from "@/lib/preview";
import { protectedAction } from "@/server/action";
import * as clone from "@/server/services/clone";
import type { CloneResult } from "@/worker/clone/types";

const id = z.string().min(1, "Item inválido.");
const startOptions = z.object({
  devices: z
    .array(z.enum(["desktop", "mobile"]))
    .min(1, "Escolha o que capturar: computador, celular ou os dois.")
    .default(["desktop", "mobile"]),
  maxVideoMb: z.number().int().min(0).max(1000).default(200),
});

/** Limite do HTML colado (bytes em UTF-8). A tela confere antes de enviar. */
const HTML_MAX_BYTES = 10 * 1024 * 1024;
const HTML_TOO_BIG = "O HTML pode ter no máximo 10 MB. Para páginas maiores, use o ZIP.";

export const startUrlCloneAction = protectedAction(
  startOptions.extend({ url: z.string().max(4000, "Link muito longo.") }),
  async ({ url, ...options }) => clone.startUrlClone(url, options),
);

export const startHtmlCloneAction = protectedAction(
  startOptions.extend({
    html: z
      .string()
      .max(HTML_MAX_BYTES, HTML_TOO_BIG)
      .refine((html) => Buffer.byteLength(html, "utf8") <= HTML_MAX_BYTES, HTML_TOO_BIG),
    baseUrl: z.string().max(4000).nullish(),
  }),
  async ({ html, baseUrl, ...options }) => clone.startHtmlClone(html, baseUrl?.trim() || null, options),
);

export const cancelCloneAction = protectedAction(z.object({ id }), async ({ id }) => {
  await clone.cancelClone(id);
});

export const retryCloneAction = protectedAction(z.object({ id }), async ({ id }) => clone.retryClone(id));

export const startFunnelClonesAction = protectedAction(
  z.object({
    parentId: id,
    urls: z
      .array(z.string().max(4000, "Link muito longo."))
      .min(1, "Escolha pelo menos uma página.")
      .max(clone.FUNNEL_PAGE_LIMIT, `${clone.FUNNEL_LIMIT_MESSAGE} Desmarque algumas páginas.`),
  }),
  async ({ parentId, urls }) => ({ created: await clone.startFunnelClones(parentId, urls) }),
);

export const clonePreviewUrlAction = protectedAction(
  z.object({ jobId: id, device: z.enum(["desktop", "mobile"]), mode: z.enum(["EDITABLE", "PRESERVE_JS"]) }),
  async ({ jobId, device, mode }) => {
    // Clonagem só de celular (ou só de desktop) não tem a outra versão: abre a
    // que existe em vez de uma prévia vazia.
    const job = await prisma.cloneJob.findUnique({ where: { id: jobId }, select: { result: true } });
    const devices = (job?.result as CloneResult | null)?.devices ?? {};
    const available = devices[device] ? device : devices.desktop ? "desktop" : devices.mobile ? "mobile" : device;
    const token = await createPreviewToken({ kind: "clone", jobId, device: available, mode });
    return { url: previewUrl(token) };
  },
);

export const saveCloneAction = protectedAction(
  z.object({
    jobId: id,
    name: z.string().trim().min(1, "Dê um nome para a oferta.").max(120, "O nome pode ter no máximo 120 caracteres."),
    folderId: id.nullish(),
    mode: z.enum(["EDITABLE", "PRESERVE_JS"]),
    keepRemoved: z.array(z.string().max(200)).max(500).default([]),
    childJobIds: z
      .array(id)
      .max(clone.FUNNEL_PAGE_LIMIT, `${clone.FUNNEL_LIMIT_MESSAGE} Desmarque algumas páginas do funil.`)
      .default([]),
  }),
  async (input) => {
    const offer = await clone.saveClone({ ...input, folderId: input.folderId ?? null });
    revalidatePath("/", "layout");
    return offer;
  },
);
