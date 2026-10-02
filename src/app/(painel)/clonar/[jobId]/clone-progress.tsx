"use client";

import { WifiOffIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { cancelCloneAction } from "@/server/actions/clone";
import type { CloneStatus } from "@/server/services/clone";
import { CloneLog } from "./clone-log";
import { useCloneStatus } from "./use-clone-status";

/** Barra de progresso + log ao vivo. Quando termina, recarrega a tela (revisão ou erro). */
export function CloneProgress({
  jobId,
  label,
  initial,
}: {
  jobId: string;
  label: string;
  initial: CloneStatus | null;
}) {
  const router = useRouter();
  const { status, logs, offline } = useCloneStatus(jobId, initial, true);
  const cancel = useAction(cancelCloneAction);
  const finished = status && !["QUEUED", "RUNNING"].includes(status.status);

  useEffect(() => {
    if (finished) router.refresh();
  }, [finished, router]);

  const progress = status?.progress ?? 0;
  const queued = status?.status === "QUEUED";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clonando…</h1>
        <p className="mt-1 truncate text-sm text-muted-foreground" title={label}>
          {label}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Spinner className="size-4 text-primary" />
            {queued ? "Na fila…" : (status?.step ?? "Preparando")}
          </CardTitle>
          <CardDescription>
            {queued
              ? "Outra clonagem está em andamento. Esta começa em seguida."
              : "Pode levar de 30 segundos a alguns minutos, dependendo do tamanho da página e dos vídeos."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Progress value={progress} className="h-2" aria-label="Progresso da clonagem" />
            <span className="w-10 text-right text-sm tabular-nums text-muted-foreground">{progress}%</span>
          </div>
          {offline && (
            <p className="flex items-center gap-2 text-sm text-warning">
              <WifiOffIcon className="size-4" />
              Sem resposta do Offer Studio. Verifique se a janela do atalho continua aberta.
            </p>
          )}
          <CloneLog logs={logs} />
          <div>
            <Button
              variant="outline"
              disabled={cancel.pending || Boolean(finished)}
              onClick={() => void cancel.run({ id: jobId }, { success: "Clonagem cancelada." })}
            >
              {cancel.pending ? <Spinner /> : <XIcon />}
              Cancelar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
