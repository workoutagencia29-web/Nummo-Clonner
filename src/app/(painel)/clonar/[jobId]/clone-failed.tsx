"use client";

import { AlertOctagonIcon, ArrowLeftIcon, FileArchiveIcon, FileCode2Icon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { retryCloneAction } from "@/server/actions/clone";
import { IMPORT_HINT } from "@/worker/clone/protection";
import { SAFARI_SAVE_NOTE, SAVE_PAGE_STEPS } from "../import-steps";
import { CloneLog } from "./clone-log";
import { failureActions } from "./failure-logic";
import type { CloneLogLine } from "./use-clone-status";

export function CloneFailed({
  jobId,
  label,
  variant,
  message,
  screenshotKey,
  logs,
  source,
  errorCode,
  protectionDetail,
  canRetry,
}: {
  jobId: string;
  label: string;
  /** failed: deu erro · canceled: você cancelou · expired: arquivos apagados pela limpeza automática. */
  variant: "failed" | "canceled" | "expired";
  message: string | null;
  screenshotKey: string | null;
  logs: CloneLogLine[];
  source: "URL" | "ZIP" | "HTML";
  errorCode: string | null;
  /** Detalhe técnico da proteção (ex.: "HTTP 403"). */
  protectionDetail: string | null;
  /** false quando o arquivo enviado (ZIP/HTML) já foi apagado. */
  canRetry: boolean;
}) {
  const router = useRouter();
  const retry = useAction(retryCloneAction);

  const { importAdvice, showRetry, retryPrimary, next } = failureActions({
    variant,
    source,
    errorCode,
    protectionDetail,
    message,
    canRetry,
  });
  const hasHint = Boolean(message?.includes(IMPORT_HINT));
  // O passo a passo aparece uma vez só (na descrição), não repetido no título.
  const showSteps = importAdvice && (hasHint || errorCode !== "LOGIN_WALL");
  const title =
    variant === "canceled"
      ? "Você cancelou esta clonagem."
      : (showSteps && message ? message.replace(IMPORT_HINT, "").trim() : message) ||
        "Algo deu errado durante a clonagem.";
  const NextIcon = next.kind === "zip" ? FileArchiveIcon : next.kind === "html" ? FileCode2Icon : ArrowLeftIcon;
  const retryButton = showRetry && (
    <Button
      variant={retryPrimary ? "default" : "outline"}
      disabled={retry.pending}
      onClick={() => void retry.run({ id: jobId }, { onSuccess: (job) => router.push(`/clonar/${job.id}`) })}
    >
      {retry.pending ? <Spinner /> : <RotateCcwIcon />}
      Tentar de novo
    </Button>
  );

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {variant === "canceled"
            ? "Clonagem cancelada"
            : variant === "expired"
              ? "Clonagem expirada"
              : "Não foi possível clonar"}
        </h1>
        <p className="mt-1 truncate text-sm text-muted-foreground" title={label}>
          {label}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-start gap-2 text-base">
            {variant === "failed" && <AlertOctagonIcon className="mt-0.5 size-5 shrink-0 text-destructive" />}
            {title}
          </CardTitle>
          {showSteps && (
            <CardDescription className="flex flex-col gap-1.5">
              <span>{SAVE_PAGE_STEPS} na aba “Arquivo ZIP”.</span>
              <span>{SAFARI_SAVE_NOTE}</span>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {retryPrimary && retryButton}
            <Button variant={retryPrimary ? "outline" : "default"} asChild>
              <Link href={next.href}>
                <NextIcon />
                {next.label}
              </Link>
            </Button>
            {!retryPrimary && retryButton}
          </div>
          {screenshotKey && (
            <figure className="flex flex-col gap-2">
              <figcaption className="text-sm text-muted-foreground">O que o robô viu ao abrir a página:</figcaption>
              {/* biome-ignore lint/performance/noImgElement: print servido pela API local */}
              <img
                src={`/api/files/${screenshotKey}`}
                alt="Print da página bloqueada"
                className="max-h-96 rounded-lg border object-cover object-top"
              />
            </figure>
          )}
          {logs.length > 0 && <CloneLog logs={logs} className="max-h-60" />}
        </CardContent>
      </Card>
    </div>
  );
}
