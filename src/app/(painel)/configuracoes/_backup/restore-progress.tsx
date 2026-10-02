"use client";

import { CircleAlertIcon, CircleCheckIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { Callout } from "@/components/offers/tracking/callout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cancelRestoreAction, restoreStatusAction } from "@/server/actions/backup";
import { useJobPoll } from "./use-job-poll";

/**
 * Andamento da restauração, bloqueando a tela (o painel não pode ser usado
 * enquanto os dados são trocados). No fim: entrar com a conta do backup; com
 * falha: a mensagem e a garantia de que nada mudou.
 */
export function RestoreProgress({
  restoreId,
  accountEmail,
  onDone,
  onDismiss,
}: {
  restoreId: string;
  accountEmail: string | null;
  /** Restaurado: ir para a tela de entrada. */
  onDone: () => void;
  /** Falhou ou foi cancelada: fecha. */
  onDismiss: () => void;
}) {
  const { job, error } = useJobPoll(restoreId, restoreStatusAction);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const status = job?.status ?? "QUEUED";
  const done = status === "DONE";
  const failed = status === "FAILED";

  async function cancel() {
    setCanceling(true);
    setCancelError(null);
    const result = await cancelRestoreAction({ id: restoreId }).catch(() => ({
      ok: false as const,
      error: "Não foi possível falar com o Offer Studio.",
    }));
    setCanceling(false);
    if (result.ok) onDismiss();
    else setCancelError(result.error);
  }

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {done ? (
              <CircleCheckIcon className="size-5 text-success" aria-hidden="true" />
            ) : failed ? (
              <CircleAlertIcon className="size-5 text-destructive" aria-hidden="true" />
            ) : (
              <Loader2Icon className="size-5 animate-spin text-primary" aria-hidden="true" />
            )}
            {done ? "Backup restaurado" : failed ? "Não deu para restaurar" : "Restaurando o backup…"}
          </DialogTitle>
          {!done && !failed && (
            <DialogDescription>
              Não feche o Offer Studio. Clonagens e ZIPs ficam em pausa até terminar.
            </DialogDescription>
          )}
        </DialogHeader>

        {!done && !failed && (
          <div className="flex flex-col gap-2" aria-live="polite">
            <Progress value={job?.progress ?? 0} aria-label="Andamento da restauração" />
            <p className="flex justify-between gap-3 text-sm text-muted-foreground">
              <span>{job?.step ?? "Preparando…"}</span>
              <span className="tabular-nums">{job?.progress ?? 0}%</span>
            </p>
            {error && <p className="text-xs text-muted-foreground">{error}</p>}
            {status === "QUEUED" && job?.workerOnline === false && (
              <Callout
                variant="warning"
                title="O robô de tarefas está parado"
                action={
                  <Button variant="outline" size="sm" onClick={() => void cancel()} disabled={canceling}>
                    {canceling && <Spinner />}
                    Cancelar restauração
                  </Button>
                }
              >
                A restauração começa quando ele voltar. Feche o Offer Studio e abra de novo pelo atalho — ou cancele.
                {cancelError && <span className="mt-1 block text-destructive">{cancelError}</span>}
              </Callout>
            )}
          </div>
        )}

        {done && (
          <output className="block text-sm">
            {accountEmail ? (
              <>
                Agora entre com a conta do backup: <strong className="break-all">{accountEmail}</strong> (com a senha
                que valia quando o backup foi feito).
              </>
            ) : (
              "Agora crie o seu acesso na tela de entrada."
            )}
          </output>
        )}

        {failed && (
          <p className="text-sm" role="alert">
            {job?.errorMessage ?? "Não foi possível restaurar o backup. Nada foi alterado."}
          </p>
        )}

        {(done || failed) && (
          <DialogFooter>
            {done ? (
              <Button onClick={onDone} autoFocus>
                {accountEmail ? "Ir para a tela de entrada" : "Criar acesso"}
              </Button>
            ) : (
              <Button variant="outline" onClick={onDismiss} autoFocus>
                Fechar
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
