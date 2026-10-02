import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createPreviewToken, previewUrl } from "@/lib/preview";
import { getObject, objectExists } from "@/lib/storage";
import { getSidebarData } from "@/server/queries";
import {
  CLONE_FILES_GONE,
  funnelMatchKey,
  getCloneStatus,
  isVirtualCloneUrl,
  isVirtualTitle,
} from "@/server/services/clone";
import { requireSession } from "@/server/session";
import type { CloneResult, Device, ProtectionReport } from "@/worker/clone/types";
import { CloneFailed } from "./clone-failed";
import { CloneProgress } from "./clone-progress";
import { CloneReview, type ReviewPreviews } from "./clone-review";
import { hasFrozenTimer } from "./timer-check";

export const metadata: Metadata = { title: "Clonagem" };

/** A cópia "Editável" (computador, senão celular) tem um contador que vai ficar parado? */
async function editableHasFrozenTimer(result: CloneResult): Promise<boolean> {
  const key = (result.devices.desktop ?? result.devices.mobile)?.outputs.EDITABLE.htmlKey;
  if (!key || !objectExists(key)) return false;
  try {
    return hasFrozenTimer((await getObject(key)).toString("utf8"));
  } catch {
    return false;
  }
}

export default async function CloneJobPage({ params }: PageProps<"/clonar/[jobId]">) {
  await requireSession();
  const { jobId } = await params;
  const job = await prisma.cloneJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      source: true,
      sourceUrl: true,
      uploadKey: true,
      options: true,
      result: true,
      errorCode: true,
      errorMessage: true,
      offerId: true,
      parentJobId: true,
      offer: { select: { deletedAt: true } },
    },
  });
  if (!job) notFound();
  if (job.parentJobId) redirect(`/clonar/${job.parentJobId}`);
  // Oferta na lixeira: a página dela não abre; a lixeira mostra como restaurar.
  if (job.status === "SAVED" && job.offerId) redirect(job.offer?.deletedAt ? "/lixeira" : `/ofertas/${job.offerId}`);

  const options = job.options as { fileName?: string; devices?: string[] } | null;
  const label = job.sourceUrl ?? options?.fileName ?? "HTML colado";

  if (job.status === "QUEUED" || job.status === "RUNNING") {
    const status = await getCloneStatus(job.id);
    return <CloneProgress jobId={job.id} label={label} initial={status} />;
  }

  // Arquivo enviado (ZIP/HTML) apagado pela limpeza automática: não dá para repetir.
  const canRetry = !job.uploadKey || objectExists(job.uploadKey);
  const result = job.result as unknown as CloneResult | null;
  const filesGone =
    (job.status === "REVIEW" || job.status === "SAVED") &&
    !Object.values(result?.devices ?? {}).some((d) => d && objectExists(d.outputs.EDITABLE.htmlKey));

  if (job.status === "FAILED" || job.status === "CANCELED" || filesGone) {
    // A tela de falha mostra o fim do log (onde está o erro) e não consulta de novo.
    const status = await getCloneStatus(job.id, 0, { tail: true });
    const failure = job.result as { protection?: ProtectionReport; screenshotKey?: string | null } | null;
    const shot = failure?.screenshotKey && objectExists(failure.screenshotKey) ? failure.screenshotKey : null;
    const expired = filesGone || job.errorCode === "EXPIRED";
    return (
      <CloneFailed
        jobId={job.id}
        label={label}
        variant={job.status === "CANCELED" ? "canceled" : expired ? "expired" : "failed"}
        message={filesGone ? CLONE_FILES_GONE : job.errorMessage}
        screenshotKey={shot}
        logs={status?.logs ?? []}
        source={job.source}
        errorCode={job.errorCode}
        protectionDetail={failure?.protection?.detail ?? null}
        canRetry={canRetry}
      />
    );
  }

  // Revisão: links de prévia para cada versão (dispositivo × modo).
  const review = result as CloneResult;
  const previews: ReviewPreviews = {};
  for (const device of ["desktop", "mobile"] as const) {
    if (!review.devices[device]) continue;
    previews[device] = {
      EDITABLE: previewUrl(await createPreviewToken({ kind: "clone", jobId: job.id, device, mode: "EDITABLE" })),
      PRESERVE_JS: previewUrl(await createPreviewToken({ kind: "clone", jobId: job.id, device, mode: "PRESERVE_JS" })),
    };
  }
  const [status, sidebar, frozenTimer] = await Promise.all([
    getCloneStatus(job.id),
    getSidebarData(),
    editableHasFrozenTimer(review),
  ]);

  // Links de um ZIP/HTML colado apontam para um endereço interno: não são páginas clonáveis.
  const funnel = review.funnel.filter((f) => !isVirtualCloneUrl(f.url));
  const fileName = options?.fileName?.replace(/\.zip$/i, "").trim();
  const defaultName =
    review.title && !isVirtualTitle(review.title)
      ? review.title
      : fileName || (job.source === "HTML" ? "HTML colado" : "Página importada");
  const capturedDevices = (options?.devices ?? ["desktop", "mobile"]).filter(
    (d): d is Device => d === "desktop" || d === "mobile",
  );

  return (
    <CloneReview
      jobId={job.id}
      label={label}
      result={{ ...review, funnel }}
      defaultName={defaultName}
      previews={previews}
      folders={sidebar.folders.map(({ id, name }) => ({ id, name }))}
      initialChildren={status?.children ?? []}
      funnelKeys={Object.fromEntries(funnel.map((f) => [f.url, funnelMatchKey(f.url)]))}
      capturedDevices={capturedDevices}
      offerDeleted={job.status === "SAVED" && !job.offerId}
      frozenTimer={frozenTimer}
    />
  );
}
