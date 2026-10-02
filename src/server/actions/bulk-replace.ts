"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { protectedAction } from "@/server/action";
import { bulkLinkChange, bulkReplace, classifyUrls } from "@/server/services/bulk-replace";

const id = z.string().min(1, "Item inválido.");
const url = z.string().trim().min(1, "Informe o endereço.").max(4000, "Endereço muito longo.");

const bulkOptions = {
  offerId: id,
  /** Só contar (prévia), sem gravar. */
  dryRun: z.boolean().default(false),
  /** Documentos que ficam de fora (o aberto no editor muda pelo próprio editor). */
  excludeDocumentIds: z.array(id).max(50).default([]),
  /** Documento aberto no editor, que ganha a versão "antes" aqui. */
  snapshotDocumentId: id.optional(),
};

/** Localizar e substituir em todas as páginas da oferta (ou só contar, com dryRun). */
export const bulkReplaceAction = protectedAction(
  z.object({
    ...bulkOptions,
    query: z.string().min(1, "Digite o que procurar.").max(500, "O texto procurado pode ter no máximo 500 caracteres."),
    replacement: z.string().max(4000, "O texto novo pode ter no máximo 4000 caracteres."),
    accentInsensitive: z.boolean().default(false),
    preserveCase: z.boolean().default(false),
    targets: z.object({ text: z.boolean(), attributes: z.boolean() }),
  }),
  async (input) => {
    const result = await bulkReplace(input);
    if (result.changedDocumentIds.length) revalidatePath("/", "layout");
    return result;
  },
);

const linkMatch = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url"), url }),
  z.object({ kind: z.literal("link"), key: z.string().min(1).max(100) }),
]);

const linkOp = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bind"), key: z.string().min(1).max(100) }),
  z.object({ type: z.literal("set-url"), url }),
  z.object({ type: z.literal("unbind"), url: z.string().trim().max(4000).optional() }),
]);

/** Ligar/desligar/trocar endereço de links em todas as páginas da oferta. */
export const bulkLinkAction = protectedAction(
  z.object({ ...bulkOptions, match: linkMatch, op: linkOp }),
  async (input) => {
    const result = await bulkLinkChange(input);
    if (result.changedDocumentIds.length) revalidatePath("/", "layout");
    return result;
  },
);

/** Plataforma de checkout / WhatsApp de cada endereço (a detecção fica no servidor). */
export const classifyLinksAction = protectedAction(
  z.object({ urls: z.array(z.string().max(4000)).max(1000) }),
  async ({ urls }) => classifyUrls(urls),
);
