"use client";

import { ArchiveRestoreIcon, KeyRoundIcon, ShieldCheckIcon, UserRoundIcon } from "lucide-react";
import { useId, useState } from "react";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { ActionResult } from "@/server/action";
import type { BackupInspection } from "@/server/services/backup";
import { CONFIRM_WORD, formatBytes, friendlyDate, isConfirmed, kindLabel, offersLabel } from "./logic";

export interface RestoreStarted {
  restoreId: string;
  accountEmail: string | null;
}

/**
 * Confirmação da restauração: o que tem no backup, o que acontece (troca tudo,
 * backup de segurança antes, entrar com a conta do backup) e "RESTAURAR"
 * digitado para liberar o botão.
 */
export function RestoreDialog({
  inspection,
  firstRun = false,
  onClose,
  onConfirm,
  onStarted,
}: {
  inspection: BackupInspection | null;
  /** Instalação nova (tela de entrada): não há nada a substituir. */
  firstRun?: boolean;
  onClose: () => void;
  onConfirm: (input: { path: string; confirm: string; fingerprint: string }) => Promise<ActionResult<RestoreStarted>>;
  onStarted: (started: RestoreStarted) => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputId = useId();
  const open = inspection !== null;
  const ready = isConfirmed(typed) && !inspection?.problem;

  function close() {
    if (pending) return;
    setTyped("");
    setError(null);
    onClose();
  }

  async function confirm() {
    if (!inspection || !ready) return;
    setPending(true);
    setError(null);
    let result: ActionResult<RestoreStarted>;
    try {
      result = await onConfirm({ path: inspection.path, confirm: typed, fingerprint: inspection.fingerprint });
    } catch {
      result = { ok: false, error: "Não foi possível falar com o Offer Studio. Ele ainda está aberto?" };
    }
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTyped("");
    onStarted(result.data);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-xl" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Restaurar este backup?</DialogTitle>
          <DialogDescription>
            {inspection
              ? `Backup ${kindLabel(inspection.kind).toLowerCase()} de ${friendlyDate(inspection.createdAt)}${inspection.computer ? `, feito em “${inspection.computer}”` : ""}.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {inspection && (
          <div className="flex flex-col gap-4 text-sm">
            <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-3 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Ofertas</dt>
                <dd className="font-medium">{offersLabel(inspection.offers)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Páginas</dt>
                <dd className="font-medium">{inspection.pages}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Arquivos</dt>
                <dd className="font-medium">
                  {inspection.files} ({formatBytes(inspection.filesBytes)})
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Tamanho</dt>
                <dd className="font-medium">{formatBytes(inspection.bytes)}</dd>
              </div>
            </dl>

            {inspection.problem ? (
              <Callout variant="warning" title="Este backup não pode ser restaurado">
                {inspection.problem}
              </Callout>
            ) : (
              <ul className="flex flex-col gap-3">
                {!firstRun && (
                  <li className="flex gap-3">
                    <ArchiveRestoreIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                    <span>
                      <strong>Tudo o que está neste Offer Studio agora é trocado</strong> pelo conteúdo do backup:
                      ofertas, páginas, versões, arquivos, pixels e configurações.
                    </span>
                  </li>
                )}
                {!firstRun && (
                  <li className="flex gap-3">
                    <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                    <span>
                      Antes, um <strong>backup de segurança</strong> do estado atual é salvo na pasta de backups. Dá
                      para voltar atrás restaurando ele.
                    </span>
                  </li>
                )}
                <li className="flex gap-3">
                  <UserRoundIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  {inspection.accountEmail ? (
                    <span>
                      {firstRun ? "Depois" : "Você sai do Offer Studio e, depois"}, entra com a conta do backup:{" "}
                      <strong className="break-all">{inspection.accountEmail}</strong>. A senha é a que valia quando o
                      backup foi feito.
                    </span>
                  ) : (
                    <span>O backup não tem uma conta: depois de restaurar, você cria um acesso novo.</span>
                  )}
                </li>
                {inspection.otherKey && (
                  <li className="flex gap-3">
                    <KeyRoundIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span>
                      O backup veio de outro computador: os tokens dos pixels (API de Conversões) são convertidos para
                      este Mac.
                    </span>
                  </li>
                )}
              </ul>
            )}

            {!inspection.problem && (
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor={inputId}>Digite {CONFIRM_WORD} para confirmar</FieldLabel>
                <Input
                  id={inputId}
                  value={typed}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  disabled={pending}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void confirm();
                  }}
                />
                <FieldDescription>Leva de alguns segundos a alguns minutos. Não feche o Offer Studio.</FieldDescription>
                {error && <FieldError>{error}</FieldError>}
              </Field>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={pending}>
            {inspection?.problem ? "Fechar" : "Cancelar"}
          </Button>
          {!inspection?.problem && (
            <Button variant="destructive" disabled={!ready || pending} onClick={() => void confirm()}>
              {pending && <Spinner />}
              Restaurar backup
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
