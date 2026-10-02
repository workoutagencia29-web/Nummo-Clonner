/**
 * "Baixar ZIP" (Fase 5): pedir um ZIP (fila do worker), acompanhar, listar,
 * apagar e baixar. Usado pelo painel (ações e rotas). A montagem fica em
 * ./build.ts e a fila em ./jobs.ts — só o worker importa esses dois (eles
 * compilam os scripts das páginas com o esbuild).
 */
import type { Export } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import {
  EXPORT_STEP,
  EXPORTS_KEPT_PER_OFFER,
  type ExportOptions,
  type ExportView,
  exportFileName,
} from "@/lib/export/options";
import { deleteObject, objectInfo } from "@/lib/storage";
import { exportFileKey, NO_PAGES_MESSAGE } from "./keys";
import { parseExportOptions } from "./plan";
import { OFFER_NOT_FOUND } from "./source";

// A fila e a montagem (./jobs, ./build) ficam de fora de propósito: elas
// importam o esbuild (scripts das páginas), que não pode entrar no Next.
export { exportPlan } from "./plan";

export const EXPORT_NOT_FOUND = "ZIP não encontrado. Ele pode ter sido apagado.";
/** Quantos ZIPs podem esperar na fila por oferta (evita cliques repetidos enchendo a fila). */
const MAX_PENDING_PER_OFFER = 3;

function warningsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((w): w is string => typeof w === "string") : [];
}

export function toExportView(row: Export): ExportView {
  return {
    id: row.id,
    offerId: row.offerId,
    status: row.status,
    progress: row.progress,
    step: row.step,
    options: parseExportOptions(row.options),
    fileName: row.fileName ?? "oferta.zip",
    bytes: row.bytes,
    errorMessage: row.errorMessage,
    warnings: warningsOf(row.warnings),
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function sameOptions(a: ExportOptions, b: ExportOptions) {
  return a.splitter === b.splitter && a.serverEvents === b.serverEvents && a.optimizeHtml === b.optimizeHtml;
}

/**
 * Pede um ZIP. Se já há um igual na fila ou sendo gerado (duplo clique),
 * devolve esse em vez de criar outro.
 */
export async function startExport(offerId: string, rawOptions?: unknown): Promise<{ exportId: string }> {
  const options = parseExportOptions(rawOptions);
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, deletedAt: null },
    select: { id: true, name: true, _count: { select: { pages: true } } },
  });
  if (!offer) throw new UserError(OFFER_NOT_FOUND);
  if (!offer._count.pages) throw new UserError(NO_PAGES_MESSAGE);

  const pending = await prisma.export.findMany({
    where: { offerId, status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, options: true },
  });
  const twin = pending.find((p) => sameOptions(parseExportOptions(p.options), options));
  if (twin) return { exportId: twin.id };
  if (pending.length >= MAX_PENDING_PER_OFFER) {
    throw new UserError("Já tem ZIPs desta oferta sendo gerados. Espere terminar e tente de novo.");
  }
  const now = new Date();
  const row = await prisma.export.create({
    data: {
      offerId,
      options,
      step: EXPORT_STEP.queued,
      fileName: exportFileName(offer.name, now),
      createdAt: now,
    },
    select: { id: true },
  });
  return { exportId: row.id };
}

/** ZIPs da oferta, do mais novo para o mais antigo. */
export async function listExports(offerId: string): Promise<ExportView[]> {
  const offer = await prisma.offer.count({ where: { id: offerId, deletedAt: null } });
  if (!offer) throw new UserError(OFFER_NOT_FOUND);
  const rows = await prisma.export.findMany({
    where: { offerId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: EXPORTS_KEPT_PER_OFFER + MAX_PENDING_PER_OFFER,
  });
  return rows.map(toExportView);
}

/** O worker é dado como parado quando não dá sinal de vida há mais que isso (ele avisa a cada 10 s). */
export const WORKER_SILENT_MS = 30_000;

/** O robô de tarefas (worker, que gera os ZIPs) deu sinal de vida há pouco? */
export async function isWorkerOnline(now = Date.now()): Promise<boolean> {
  const hb = await prisma.serviceHeartbeat.findUnique({ where: { name: "worker" }, select: { lastSeenAt: true } });
  return Boolean(hb && now - hb.lastSeenAt.getTime() < WORKER_SILENT_MS);
}

/**
 * Um ZIP (andamento). null = não existe ou a oferta está na lixeira. Na fila,
 * diz também se o worker está vivo (parado, o ZIP não vai começar).
 */
export async function getExportView(exportId: string): Promise<ExportView | null> {
  const row = await prisma.export.findFirst({ where: { id: exportId, offer: { deletedAt: null } } });
  if (!row) return null;
  const view = toExportView(row);
  if (row.status === "QUEUED") view.workerOnline = await isWorkerOnline();
  return view;
}

/** Apaga um ZIP (linha e arquivo). Um ZIP sendo gerado não pode ser apagado. */
export async function deleteExport(exportId: string): Promise<void> {
  const row = await prisma.export.findUnique({
    where: { id: exportId },
    select: { id: true, offerId: true, status: true, fileKey: true },
  });
  if (!row) throw new UserError(EXPORT_NOT_FOUND);
  if (row.status === "RUNNING") throw new UserError("Este ZIP está sendo gerado agora. Espere terminar para apagar.");
  const { count } = await prisma.export.deleteMany({ where: { id: exportId, status: { not: "RUNNING" } } });
  if (!count) throw new UserError("Este ZIP começou a ser gerado agora. Espere terminar para apagar.");
  await deleteObject(row.fileKey ?? exportFileKey(row.offerId, row.id)).catch(() => {});
}

export type ExportDownload =
  | { ok: true; key: string; fileName: string; size: number }
  | { ok: false; status: number; error: string };

/** Arquivo para baixar (ou o motivo em português de não dar). */
export async function exportDownload(exportId: string): Promise<ExportDownload> {
  const row = await prisma.export.findFirst({
    where: { id: exportId, offer: { deletedAt: null } },
    select: { status: true, fileKey: true, fileName: true },
  });
  if (!row) return { ok: false, status: 404, error: EXPORT_NOT_FOUND };
  if (row.status === "FAILED") return { ok: false, status: 409, error: "Este ZIP falhou. Gere de novo." };
  if (row.status !== "DONE" || !row.fileKey) {
    return { ok: false, status: 409, error: "O ZIP ainda está sendo gerado. Espere ficar pronto." };
  }
  const info = await objectInfo(row.fileKey);
  if (!info) return { ok: false, status: 410, error: "O arquivo deste ZIP não existe mais. Gere de novo." };
  return { ok: true, key: row.fileKey, fileName: row.fileName ?? "oferta.zip", size: info.size };
}
