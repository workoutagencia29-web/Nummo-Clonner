"use server";

/**
 * Ações do funil de upsell pós-compra (aba "Upsell"). A tela lê tudo com
 * upsellPanel (src/server/services/upsell.ts) e salva com saveUpsellAction.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { UpsellFlow } from "@/lib/upsell";
import { protectedAction } from "@/server/action";
import { createUpsellPage, saveUpsellFlow } from "@/server/services/upsell";

const offerId = z.string().min(1, "Oferta inválida.").max(40, "Oferta inválida.");
const nullable = z
  .string()
  .max(120)
  .nullish()
  .transform((v) => v || null);

const stepSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(["UPSELL", "DOWNSELL"]),
  pageId: nullable,
  linkKey: nullable,
  attachedTo: nullable,
});

const flowSchema = z.object({
  startLinkKey: nullable,
  steps: z.array(stepSchema).max(12, "Etapas demais."),
  thankYouPageId: nullable,
});

export const saveUpsellAction = protectedAction(
  z.object({ offerId, flow: flowSchema }),
  async ({ offerId: id, flow }) => {
    await saveUpsellFlow(id, flow as UpsellFlow);
    revalidatePath("/", "layout");
  },
);

/**
 * Cria uma página da sequência (upsell/downsell/obrigado) a partir do modelo e
 * devolve a página criada. NÃO revalida a tela de propósito: a página já volta
 * aqui e entra na lista na hora (estado local do painel); revalidar agora
 * recarregaria o rascunho ainda não salvo e desfaria a escolha da página. O
 * "Salvar upsell" é quem revalida tudo (aba "Páginas", "Próximos passos").
 */
export const createUpsellPageAction = protectedAction(
  z.object({ offerId, kind: z.enum(["UPSELL", "DOWNSELL", "THANK_YOU"]) }),
  async ({ offerId: id, kind }) => createUpsellPage(id, kind),
);
