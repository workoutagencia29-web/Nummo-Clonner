"use client";

import { ArchiveRestoreIcon, ChevronDownIcon, CloudDownloadIcon, CloudIcon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { formatBytes, friendlyDate, kindLabel, offersLabel } from "@/app/(painel)/configuracoes/_backup/logic";
import { RestoreDialog, type RestoreStarted } from "@/app/(painel)/configuracoes/_backup/restore-dialog";
import { RestoreProgress } from "@/app/(painel)/configuracoes/_backup/restore-progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { ActionResult } from "@/server/action";
import {
  downloadFirstRunBackupAction,
  inspectFirstRunBackupAction,
  startFirstRunRestoreAction,
} from "@/server/actions/backup";
import type { BackupFileView, BackupInspection } from "@/server/services/backup";

const OFFLINE = "Não foi possível falar com o Offer Studio. Ele ainda está aberto?";
/** Depois disso baixando, a tela para de perguntar (o download continua) e explica. */
const DOWNLOAD_GIVE_UP_MS = 15 * 60_000;
/** Download que demora demais: conexão, e o caminho manual no Finder (com a pasta do arquivo). */
function downloadSlowMessage(folderLabel: string): string {
  return `O download da iCloud Drive ainda não terminou. Confira a conexão com a internet e clique em “Atualizar” daqui a pouco. Se não andar, no Finder abra ${folderLabel}, clique no ícone de nuvem ao lado do arquivo e, quando terminar de baixar, clique em “Atualizar” aqui.`;
}

/**
 * Primeiro acesso de uma instalação nova: "Restaurar de um backup" com os
 * backups achados em Documentos/iCloud Drive (pastas sugeridas) ou o caminho de
 * outro arquivo. Depois de restaurar, a tela de entrada pede a conta do backup.
 */
export function FirstRunRestore({
  backups,
  folders,
  onRestored,
}: {
  backups: BackupFileView[];
  /** Pastas procuradas (para dizer onde o app olhou). */
  folders: string[];
  onRestored: (accountEmail: string | null) => void;
}) {
  const [open, setOpen] = useState(backups.length > 0);
  const [inspection, setInspection] = useState<BackupInspection | null>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [restore, setRestore] = useState<RestoreStarted | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const router = useRouter();
  const alive = useRef(true);
  const pathId = useId();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function refresh() {
    setListError(null);
    startRefresh(() => router.refresh());
  }

  /** “Baixar”: pede o backup à iCloud Drive e pergunta até ele chegar; aí atualiza a lista. */
  async function download(file: string) {
    setListError(null);
    setDownloading(file);
    const giveUpAt = Date.now() + DOWNLOAD_GIVE_UP_MS;
    try {
      while (alive.current) {
        let result: ActionResult<{ ready: boolean; folderLabel: string }>;
        try {
          result = await downloadFirstRunBackupAction({ path: file });
        } catch {
          result = { ok: false, error: OFFLINE };
        }
        if (!alive.current) return;
        if (!result.ok) {
          setListError(result.error);
          return;
        }
        if (result.data.ready) {
          startRefresh(() => router.refresh());
          return;
        }
        if (Date.now() >= giveUpAt) {
          setListError(downloadSlowMessage(result.data.folderLabel));
          return;
        }
      }
    } finally {
      if (alive.current) setDownloading(null);
    }
  }

  async function inspect(file: string, onError: (message: string) => void) {
    setInspecting(file);
    let result: ActionResult<BackupInspection>;
    try {
      result = await inspectFirstRunBackupAction({ path: file });
    } catch {
      result = { ok: false, error: OFFLINE };
    }
    setInspecting(null);
    if (result.ok) setInspection(result.data);
    else onError(result.error);
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <ArchiveRestoreIcon className="size-4" aria-hidden="true" />
              Restaurar de um backup
            </CardTitle>
            <CardDescription>Já usava o Offer Studio em outro Mac? Traga tudo de volta.</CardDescription>
          </span>
          <ChevronDownIcon
            className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </CardHeader>
      {open && (
        <CardContent className="flex flex-col gap-4">
          <div className="-my-1 flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{backups.length ? "Backups neste Mac" : "Nenhum backup encontrado"}</p>
            <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing}>
              {refreshing ? <Spinner /> : <RefreshCwIcon />}
              Atualizar
            </Button>
          </div>
          {backups.length ? (
            <ul className="flex flex-col divide-y rounded-lg border" aria-label="Backups encontrados">
              {backups.map((file) => (
                <li key={file.path} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {friendlyDate(file.createdAt)}
                      {file.kind && <Badge variant="outline">{kindLabel(file.kind)}</Badge>}
                      {file.cloudOnly && (
                        <Badge variant="outline">
                          <CloudIcon />
                          Na iCloud
                        </Badge>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        file.cloudOnly ? null : formatBytes(file.bytes),
                        file.offers !== null ? offersLabel(file.offers) : null,
                        file.accountEmail,
                        file.computer ? `de “${file.computer}”` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {file.cloudOnly ? (
                      <p className="text-xs text-muted-foreground" aria-live="polite">
                        {downloading === file.path
                          ? "Baixando da iCloud Drive… Pode levar alguns minutos; deixe esta tela aberta."
                          : file.problem}
                      </p>
                    ) : (
                      file.problem && <p className="text-xs text-destructive">{file.problem}</p>
                    )}
                  </div>
                  {file.cloudOnly ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={downloading !== null || inspecting !== null}
                      onClick={() => void download(file.path)}
                      aria-label={`Baixar backup de ${friendlyDate(file.createdAt)} da iCloud Drive`}
                    >
                      {downloading === file.path ? <Spinner /> : <CloudDownloadIcon />}
                      Baixar
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={Boolean(file.problem) || inspecting !== null || downloading !== null}
                      onClick={() => void inspect(file.path, setListError)}
                      aria-label={`Restaurar backup de ${friendlyDate(file.createdAt)}`}
                    >
                      {inspecting === file.path && <Spinner />}
                      Restaurar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Procuramos em {folders.join(" e em ")}. Se o backup está em outro lugar (um disco externo, por exemplo),
              informe o caminho abaixo — ou copie o backup para uma dessas pastas e clique em “Atualizar”.
            </p>
          )}
          {listError && (
            <p role="alert" className="text-sm text-destructive">
              {listError}
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPathError(null);
              void inspect(path, setPathError);
            }}
          >
            <Field data-invalid={Boolean(pathError)}>
              <FieldLabel htmlFor={pathId}>Outro arquivo de backup</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id={pathId}
                  value={path}
                  placeholder="/Volumes/MeuHD/offer-studio-backup-….zip"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(pathError)}
                  onChange={(e) => setPath(e.target.value)}
                />
                <Button type="submit" variant="outline" disabled={!path.trim() || inspecting !== null}>
                  {inspecting === path && <Spinner />}
                  Continuar
                </Button>
              </div>
              <FieldDescription>
                No Finder, clique no arquivo com o botão direito segurando Option e escolha “Copiar … como Caminho”.
              </FieldDescription>
              {pathError && <FieldError>{pathError}</FieldError>}
            </Field>
          </form>
        </CardContent>
      )}

      <RestoreDialog
        firstRun
        inspection={inspection}
        onClose={() => setInspection(null)}
        onConfirm={(input) => startFirstRunRestoreAction(input)}
        onStarted={(started) => {
          setInspection(null);
          setRestore(started);
        }}
      />
      {restore && (
        <RestoreProgress
          restoreId={restore.restoreId}
          accountEmail={restore.accountEmail}
          onDone={() => {
            const email = restore.accountEmail;
            setRestore(null);
            onRestored(email);
          }}
          onDismiss={() => setRestore(null)}
        />
      )}
    </Card>
  );
}
