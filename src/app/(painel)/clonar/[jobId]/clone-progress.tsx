"use client";

import { WifiOffIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Callout } from "@/components/offers/tracking/callout";
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
  funnel = false,
}: {
  jobId: string;
  label: string;
  initial: CloneStatus | null;
  /** "Clonar o funil inteiro" ligado: depois desta página, o robô segue para as próximas. */
  funnel?: boolean;
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
  // Robô parado: nada começa nem avança até ele voltar.
  const workerDown = status?.workerOnline === false;
  // Na fila sem outra clonagem na frente e com o robô ligado: começa em instantes.
  const waiting = queued && (workerDown || Boolean(status?.otherRunning));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{funnel ? "Clonando o funil…" : "Clonando…"}</h1>
        <p className="mt-1 truncate text-sm text-muted-foreground" title={label}>
          {label}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Spinner className="size-4 text-primary" />
            {waiting ? "Na fila…" : queued ? "Começando…" : (status?.step ?? "Preparando")}
          </CardTitle>
          <CardDescription>
            {queued && !workerDown && status?.otherRunning
              ? "Outra clonagem está em andamento. Esta começa em seguida."
              : funnel
                ? "Primeiro a página do link (o robô clica pelo quiz ou pela roleta para achar a próxima etapa). Quando ela ficar pronta, a revisão abre com o mapa do funil e as próximas páginas vão aparecendo nele."
                : "Pode levar de 30 segundos a alguns minutos, dependendo do tamanho da página e dos vídeos."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Progress value={progress} className="h-2" aria-label="Progresso da clonagem" />
            <span className="w-10 text-right text-sm tabular-nums text-muted-foreground">{progress}%</span>
          </div>
          {offline ? (
            <p className="flex items-center gap-2 text-sm text-warning">
              <WifiOffIcon className="size-4" />
              Sem resposta do Offer Studio. Verifique se a janela do atalho continua aberta.
            </p>
          ) : workerDown ? (
            <Callout variant="warning" title="O robô de tarefas está parado">
              {queued
                ? "A clonagem começa quando ele voltar. Feche o Offer Studio e abra de novo pelo atalho."
                : "A clonagem parou no meio. Feche o Offer Studio e abra de novo pelo atalho; depois, use “Tentar de novo”."}
            </Callout>
          ) : (
            // Sem avanço há mais de CLONE_STALL_MS (src/server/services/clone.ts).
            status?.stalled && (
              <Callout variant="warning" title="A clonagem não avança há mais de 3 minutos">
                Páginas grandes ou com vídeos pesados podem demorar mesmo. Se continuar parada, a página pode ter
                travado: cancele e tente de novo, ou importe o HTML/ZIP salvo pelo navegador.
              </Callout>
            )
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
