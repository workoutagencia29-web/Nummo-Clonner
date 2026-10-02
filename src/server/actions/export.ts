"use server";

import { z } from "zod";
import { ExportOptionsSchema } from "@/lib/export/options";
import { protectedAction } from "@/server/action";
import { deleteExport, exportPlan, listExports, startExport } from "@/server/services/export";

const offerId = z.string().min(1, "Oferta inválida.").max(40, "Oferta inválida.");
const exportId = z.string().min(1, "ZIP inválido.").max(40, "ZIP inválido.");
const options = ExportOptionsSchema.prefault({});

/** Pede um ZIP da oferta (o worker gera; acompanhe por GET /api/exports/<id>). */
export const startExportAction = protectedAction(z.object({ offerId, options }), ({ offerId, options }) =>
  startExport(offerId, options),
);

/** ZIPs da oferta, do mais novo para o mais antigo. */
export const listExportsAction = protectedAction(z.object({ offerId }), ({ offerId }) => listExports(offerId));

/** Apaga um ZIP (não vale para um que está sendo gerado). */
export const deleteExportAction = protectedAction(z.object({ exportId }), async ({ exportId }) => {
  await deleteExport(exportId);
});

/** Prévia do que vai no ZIP (pastas, avisos), com as opções escolhidas (opcional). */
export const exportPlanAction = protectedAction(
  z.object({ offerId, options: ExportOptionsSchema.partial().optional() }),
  ({ offerId, options }) => exportPlan(offerId, options),
);
