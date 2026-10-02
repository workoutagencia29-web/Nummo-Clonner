"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MAX_VARIANTS, VARIANT_LABEL_MAX } from "@/components/offers/variants/weights";
import { createPreviewToken, previewUrl } from "@/lib/preview";
import { protectedAction } from "@/server/action";
import { PAGE_TEMPLATE_IDS } from "@/server/services/page-templates";
import * as variants from "@/server/services/variants";

/**
 * Teste A/B (versões de uma página). As ações que mudam algo devolvem a lista
 * atualizada, para a tela não precisar pedir de novo.
 */

const id = z.string().min(1, "Item inválido.");
const label = z
  .string()
  .max(VARIANT_LABEL_MAX, `O nome da versão pode ter no máximo ${VARIANT_LABEL_MAX} caracteres.`)
  .nullish();
const weight = z
  .number("Digite um número de 0 a 100.")
  .int("Use números inteiros de 0 a 100 em cada versão.")
  .min(0, "O percentual não pode ser menor que 0.")
  .max(100, "O percentual não pode passar de 100.");

/** A lista de páginas (selo "N versões A/B") e a tela da oferta refletem a mudança. */
function refreshAll() {
  revalidatePath("/", "layout");
}

export const listVariantsAction = protectedAction(z.object({ pageId: id }), async ({ pageId }) =>
  variants.listVariants(pageId),
);

export const createVariantAction = protectedAction(
  z.object({
    pageId: id,
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("copy"), variantId: id.nullish() }),
      z.object({
        kind: z.literal("template"),
        templateId: z.enum(PAGE_TEMPLATE_IDS, "Modelo de página inválido.").nullish(),
      }),
    ]),
    label,
  }),
  async ({ pageId, source, label }) => {
    const created = await variants.createVariant({ pageId, source, label });
    refreshAll();
    return { created, view: await variants.listVariants(pageId) };
  },
);

export const renameVariantAction = protectedAction(z.object({ variantId: id, label }), async ({ variantId, label }) => {
  const { pageId } = await variants.renameVariant({ variantId, label: label ?? null });
  refreshAll();
  return variants.listVariants(pageId);
});

export const setControlVariantAction = protectedAction(z.object({ variantId: id }), async ({ variantId }) => {
  const { pageId } = await variants.setControlVariant(variantId);
  refreshAll();
  return variants.listVariants(pageId);
});

export const setVariantWeightsAction = protectedAction(
  z.object({
    pageId: id,
    weights: z
      // saved: o percentual salvo que a tela mostrava (outra aba mudou → recusa em vez de sobrescrever).
      .array(z.object({ variantId: id, weight, saved: z.number().int().min(0).max(100).nullish() }))
      .min(1, "Nenhuma versão para dividir o tráfego.")
      .max(MAX_VARIANTS, `Cada página pode ter no máximo ${MAX_VARIANTS} versões (A a E).`),
  }),
  async ({ pageId, weights }) => {
    await variants.setVariantWeights({ pageId, weights });
    refreshAll();
    return variants.listVariants(pageId);
  },
);

export const deleteVariantAction = protectedAction(z.object({ variantId: id }), async ({ variantId }) => {
  const deleted = await variants.deleteVariant(variantId);
  refreshAll();
  return { deleted, view: await variants.listVariants(deleted.pageId) };
});

/** Link de prévia de uma versão (abre direto nela, sem o sorteio do divisor). */
export const variantPreviewUrlAction = protectedAction(z.object({ variantId: id }), async ({ variantId }) => {
  const target = await variants.variantPreviewTarget(variantId);
  const token = await createPreviewToken({ kind: "offer", ...target });
  return { url: previewUrl(token) };
});
