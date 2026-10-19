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
import { applyUpsellToOffers, offersForUpsellApply } from "@/server/services/upsell-apply";

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

/** Lista as ofertas (mesma moeda) que podem receber este upsell. */
export const offersForUpsellApplyAction = protectedAction(z.object({ offerId }), async ({ offerId: id }) =>
  offersForUpsellApply(id),
);

/**
 * Aplica (copia) este upsell nas ofertas escolhidas. Revalida a tela (as ofertas
 * de destino ganham páginas e produtos novos). Devolve o que foi aplicado/pulado.
 */
export const applyUpsellAction = protectedAction(
  z.object({ offerId, targetOfferIds: z.array(offerId).min(1, "Escolha ao menos uma oferta.").max(200) }),
  async ({ offerId: id, targetOfferIds }) => {
    const result = await applyUpsellToOffers(id, targetOfferIds);
    revalidatePath("/", "layout");
    return result;
  },
);
