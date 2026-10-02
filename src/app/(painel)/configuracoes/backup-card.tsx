"use client";

import {
  ArchiveIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CloudIcon,
  FolderOpenIcon,
  HardDriveIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Callout } from "@/components/offers/tracking/callout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/action";
import {
  backupJobAction,
  deleteBackupFileAction,
  inspectBackupAction,
  revealBackupFileAction,
  saveBackupSettingsAction,
  startBackupAction,
  startRestoreAction,
} from "@/server/actions/backup";
import type { BackupFileView, BackupInspection, BackupOverview } from "@/server/services/backup";
import {
  formatBytes,
  friendlyDate,
  HOURS,
  hourLabel,
  keepChoices,
  kindLabel,
  nextAutoLabel,
  offersLabel,
} from "./_backup/logic";
import { RestoreDialog, type RestoreStarted } from "./_backup/restore-dialog";
import { RestoreProgress } from "./_backup/restore-progress";
import { useJobPoll } from "./_backup/use-job-poll";

const HEALTH_STYLE = {
  ok: { Icon: CircleCheckIcon, className: "text-success" },
  warn: { Icon: TriangleAlertIcon, className: "text-warning-foreground dark:text-warning" },
  error: { Icon: CircleAlertIcon, className: "text-destructive" },
  running: { Icon: Loader2Icon, className: "animate-spin text-primary" },
} as const;

const OFFLINE = "Não foi possível falar com o Offer Studio. Ele ainda está aberto?";

async function call<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch {
    return { ok: false, error: OFFLINE };
  }
}

/**
 * Card "Backup" de Configurações: situação (último, próximo, saúde), "Fazer
 * backup agora" com andamento, lista dos backups da pasta (restaurar, mostrar
 * no Finder, excluir), restaurar de outro arquivo, pasta/horário/quantos
 * guardar e o que vai no backup. Os dados vêm da página (router.refresh()
 * depois de cada mudança).
 */
export function BackupCard({
  overview,
  folder,
  files,
}: {
  overview: BackupOverview;
  folder: string;
  files: BackupFileView[];
}) {
  const router = useRouter();

  // Backup em andamento (o da página ou o que acabou de ser pedido).
  const [jobId, setJobId] = useState<string | null>(overview.current?.id ?? null);
  const [seenCurrent, setSeenCurrent] = useState(overview.current?.id ?? null);
  if ((overview.current?.id ?? null) !== seenCurrent) {
    setSeenCurrent(overview.current?.id ?? null);
    if (overview.current?.id) setJobId(overview.current.id);
  }
  const { job, error: pollError } = useJobPoll(jobId, backupJobAction);
  const handled = useRef(new Set<string>());
  useEffect(() => {
    if (!job || (job.status !== "DONE" && job.status !== "FAILED") || handled.current.has(job.id)) return;
    handled.current.add(job.id);
    if (job.status === "DONE") {
      toast.success(`Backup concluído: ${job.fileName ?? "arquivo salvo"}.`);
      for (const warning of job.warnings) toast.warning(warning);
    } else {
      toast.error(job.errorMessage ?? "O backup falhou.");
    }
    setJobId(null);
    router.refresh();
  }, [job, router]);

  const start = useAction(startBackupAction);
  const running = Boolean(jobId) && job?.status !== "DONE" && job?.status !== "FAILED";
  const progress = job?.progress ?? overview.current?.progress ?? 0;
  const step = job?.step ?? overview.current?.step ?? "Na fila…";
  const queuedOffline =
    (job ?? overview.current)?.status === "QUEUED" && (job ?? overview.current)?.workerOnline === false;

  // Restauração (a da página, se recarregou no meio, ou a que acabou de ser pedida).
  const [restore, setRestore] = useState<RestoreStarted | null>(
    overview.restore ? { restoreId: overview.restore.id, accountEmail: overview.restore.accountEmail } : null,
  );
  const [inspection, setInspection] = useState<BackupInspection | null>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [deleting, setDeleting] = useState<BackupFileView | null>(null);
  const remove = useAction(deleteBackupFileAction);
  const reveal = useAction(revealBackupFileAction);
  const restoring = Boolean(restore);

  async function inspect(path: string, onError?: (message: string, field?: string) => void) {
    setInspecting(path);
    const result = await call(() => inspectBackupAction({ path }));
    setInspecting(null);
    if (result.ok) {
      setOtherOpen(false);
      setInspection(result.data);
      return true;
    }
    if (onError) onError(result.error, result.field);
    else toast.error(result.error);
    return false;
  }

  const health = HEALTH_STYLE[running ? "running" : overview.health.level];
  const HealthIcon = health.Icon;
  const last = overview.lastBackup;

  return (
    <div className="flex flex-col gap-6">
      {/* Situação */}
      <section aria-label="Situação do backup" className="flex flex-col gap-4 rounded-lg border p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <HealthIcon className={cn("mt-0.5 size-5 shrink-0", health.className)} aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <p className="font-medium">{running ? "Fazendo backup agora" : overview.health.title}</p>
            <p className="text-muted-foreground">
              {last ? (
                <>
                  Último backup: {friendlyDate(last.at)} · {formatBytes(last.bytes)} · {offersLabel(last.offers)}
                </>
              ) : (
                "Nenhum backup ainda."
              )}
            </p>
            <p className="text-muted-foreground">
              Próximo automático:{" "}
              {nextAutoLabel({
                auto: overview.settings.auto,
                nextAutoAt: overview.nextAutoAt,
                autoSoon: overview.autoSoon,
              })}
            </p>
          </div>
          <Button
            className="sm:self-center"
            disabled={running || start.pending || restoring}
            onClick={() => void start.run({}, { onSuccess: ({ backupId }) => setJobId(backupId) })}
          >
            {running || start.pending ? <Spinner /> : <ArchiveIcon />}
            Fazer backup agora
          </Button>
        </div>

        {running && (
          <div className="flex flex-col gap-2" aria-live="polite">
            <Progress value={progress} aria-label="Andamento do backup" />
            <p className="flex justify-between gap-3 text-xs text-muted-foreground">
              <span>{step}</span>
              <span className="tabular-nums">{progress}%</span>
            </p>
            {pollError && <p className="text-xs text-muted-foreground">{pollError}</p>}
            {queuedOffline && (
              <Callout variant="warning" title="O robô de tarefas está parado">
                O backup começa quando ele voltar. Feche o Offer Studio e abra de novo pelo atalho.
              </Callout>
            )}
          </div>
        )}

        {!running && overview.health.level === "error" && (
          <Callout variant="warning" title={overview.health.title}>
            {overview.health.detail}
          </Callout>
        )}
        {!running && overview.health.level === "warn" && overview.health.title !== "Nenhum backup ainda" && (
          <p className="text-xs text-muted-foreground">{overview.health.detail}</p>
        )}
      </section>

      {/* Backups da pasta */}
      <section aria-labelledby="backups-pasta" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 id="backups-pasta" className="text-sm font-medium">
              Backups nesta pasta
            </h3>
            <p className="truncate font-mono text-xs text-muted-foreground" title={folder}>
              {folder}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => router.refresh()}>
            <RefreshCwIcon />
            Atualizar
          </Button>
        </div>

        {files.length ? (
          <ul className="flex flex-col divide-y rounded-lg border" aria-label="Backups encontrados">
            {files.map((file) => (
              <li key={file.path} className="flex items-center gap-3 px-3 py-2.5" aria-label={file.fileName}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {friendlyDate(file.createdAt)}
                    {file.kind && (
                      <Badge variant={file.kind === "AUTO" ? "secondary" : "outline"}>{kindLabel(file.kind)}</Badge>
                    )}
                    {file.cloudOnly && (
                      <Badge variant="outline">
                        <CloudIcon />
                        Na iCloud
                      </Badge>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {file.cloudOnly
                      ? file.fileName
                      : [
                          formatBytes(file.bytes),
                          file.offers !== null ? offersLabel(file.offers) : null,
                          !file.mine && file.computer ? `de “${file.computer}”` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </p>
                  {file.problem && !file.cloudOnly && <p className="text-xs text-destructive">{file.problem}</p>}
                  {file.cloudOnly && <p className="text-xs text-muted-foreground">{file.problem}</p>}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={Boolean(file.problem) || restoring || inspecting !== null}
                  onClick={() => void inspect(file.path)}
                  aria-label={`Restaurar backup de ${friendlyDate(file.createdAt)}`}
                >
                  {inspecting === file.path && <Spinner />}
                  Restaurar
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Mais ações do backup ${file.fileName}`}>
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void reveal.run({ path: file.path })}>
                      <FolderOpenIcon />
                      Mostrar no Finder
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(file)}>
                      <Trash2Icon />
                      Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhum backup nesta pasta ainda.
          </p>
        )}
        <div>
          <Button variant="link" className="h-auto px-0" disabled={restoring} onClick={() => setOtherOpen(true)}>
            Restaurar de outro arquivo…
          </Button>
        </div>
      </section>

      <BackupSettingsForm overview={overview} onSaved={() => router.refresh()} />

      <div className="flex flex-col gap-3">
        <Callout title="O que vai no backup">
          Tudo do Offer Studio: ofertas, páginas e versões A/B, histórico de versões, imagens e arquivos, links, pixels,
          regras de evento, configurações e a sua conta (e-mail e senha). Os ZIPs do “Baixar ZIP” ficam de fora (dá para
          gerar de novo).
        </Callout>
        <Callout variant="warning" icon={ShieldAlertIcon} title="Guarde o backup em lugar seguro">
          O arquivo leva os <strong>tokens dos pixels</strong> (API de Conversões da Meta e Events API do TikTok) e a
          chave que os protege, para funcionarem em outro Mac. Não envie o backup para ninguém.
        </Callout>
      </div>

      <OtherFileDialog
        open={otherOpen}
        onOpenChange={setOtherOpen}
        pending={inspecting !== null}
        onContinue={(path, onError) => void inspect(path, onError)}
      />

      <RestoreDialog
        inspection={inspection}
        onClose={() => setInspection(null)}
        onConfirm={(input) => startRestoreAction(input)}
        onStarted={(started) => {
          setInspection(null);
          setRestore(started);
        }}
      />

      {restore && (
        <RestoreProgress
          restoreId={restore.restoreId}
          accountEmail={restore.accountEmail}
          onDone={() => window.location.assign("/entrar")}
          onDismiss={() => {
            setRestore(null);
            router.refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir este backup?"
        description={
          deleting
            ? `O arquivo ${deleting.fileName} (${friendlyDate(deleting.createdAt)}) é apagado da pasta de backups. Isso não pode ser desfeito.`
            : ""
        }
        confirmLabel="Excluir backup"
        destructive
        pending={remove.pending}
        onConfirm={() => {
          if (!deleting) return;
          void remove.run(
            { path: deleting.path },
            {
              success: "Backup excluído.",
              onSuccess: () => {
                setDeleting(null);
                router.refresh();
              },
            },
          );
        }}
      />
    </div>
  );
}

/** "Restaurar de outro arquivo…": caminho completo do .zip (de outro disco, de outra pasta). */
function OtherFileDialog({
  open,
  onOpenChange,
  pending,
  onContinue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onContinue: (path: string, onError: (message: string) => void) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            onContinue(value, (message) => setError(message));
          }}
        >
          <DialogHeader>
            <DialogTitle>Restaurar de outro arquivo</DialogTitle>
            <DialogDescription>
              Um backup que está em outra pasta ou num disco externo (arquivo “offer-studio-backup-….zip”).
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor={id}>Caminho do arquivo</FieldLabel>
            <Input
              id={id}
              value={value}
              placeholder="/Volumes/MeuHD/offer-studio-backup-2026-10-01-0300.zip"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={Boolean(error)}
            />
            <FieldDescription>
              No Finder, clique no arquivo com o botão direito segurando a tecla Option e escolha “Copiar … como
              Caminho”. Depois cole aqui.
            </FieldDescription>
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || !value.trim()}>
              {pending && <Spinner />}
              Continuar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Pasta, automático, horário e quantos guardar: cada mudança é salva na hora. */
function BackupSettingsForm({ overview, onSaved }: { overview: BackupOverview; onSaved: () => void }) {
  const { settings, presets } = overview;
  const save = useAction(saveBackupSettingsAction);
  const [choice, setChoice] = useState<string>(settings.folder);
  const [custom, setCustom] = useState(settings.customPath ?? "");
  const [customError, setCustomError] = useState<string | null>(null);
  const [savedFolder, setSavedFolder] = useState(settings.folder);
  if (settings.folder !== savedFolder) {
    setSavedFolder(settings.folder);
    setChoice(settings.folder);
  }
  const ids = { auto: useId(), hour: useId(), keep: useId(), custom: useId() };

  const run = (patch: Parameters<typeof saveBackupSettingsAction>[0], success: string, onError?: (m: string) => void) =>
    save.run(patch, {
      success,
      silentError: Boolean(onError),
      onSuccess: onSaved,
      onError: (message) => onError?.(message),
    });

  return (
    <section aria-labelledby="backup-config" className="flex flex-col gap-4">
      <h3 id="backup-config" className="text-sm font-medium">
        Onde e quando
      </h3>
      <RadioGroup
        aria-label="Pasta dos backups"
        value={choice}
        onValueChange={(value) => {
          setChoice(value);
          setCustomError(null);
          if (value === "custom") return;
          void run({ folder: value as "documents" | "icloud" }, "Pasta dos backups alterada.");
        }}
        className="gap-2"
      >
        {presets.map((preset) => (
          <label
            key={preset.id}
            htmlFor={`backup-folder-${preset.id}`}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5",
              !preset.available && "cursor-not-allowed opacity-60",
            )}
          >
            <RadioGroupItem
              id={`backup-folder-${preset.id}`}
              value={preset.id}
              disabled={!preset.available || save.pending}
              className="mt-0.5"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {preset.id === "icloud" ? (
                  <CloudIcon className="size-4" aria-hidden="true" />
                ) : (
                  <HardDriveIcon className="size-4" aria-hidden="true" />
                )}
                {preset.label}
                {preset.id === "icloud" && preset.available && <Badge variant="success">Recomendado</Badge>}
              </span>
              <span className="text-xs text-muted-foreground">
                {preset.id === "icloud"
                  ? preset.available
                    ? "Fica fora deste Mac: se ele quebrar, for roubado ou trocado, o backup continua na sua iCloud."
                    : "A iCloud Drive não está ligada neste Mac (Ajustes do Sistema → [seu nome] → iCloud)."
                  : "Neste Mac. Se o Mac quebrar, o backup vai junto — copie de vez em quando para outro lugar."}
              </span>
            </span>
          </label>
        ))}
        <label
          htmlFor="backup-folder-custom"
          className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
        >
          <RadioGroupItem id="backup-folder-custom" value="custom" disabled={save.pending} className="mt-0.5" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-2 font-medium">
              <FolderOpenIcon className="size-4" aria-hidden="true" />
              Outra pasta
            </span>
            <span className="text-xs text-muted-foreground">
              Um disco externo ou uma pasta sincronizada (Google Drive, Dropbox…).
            </span>
          </span>
        </label>
      </RadioGroup>

      {choice === "custom" && (
        <form
          className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setCustomError(null);
            void run({ folder: "custom", customPath: custom }, "Pasta dos backups alterada.", setCustomError);
          }}
        >
          <Field data-invalid={Boolean(customError)}>
            <FieldLabel htmlFor={ids.custom}>Caminho da pasta</FieldLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={ids.custom}
                value={custom}
                placeholder="/Volumes/MeuHD/Backups do Offer Studio"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(customError)}
                onChange={(e) => setCustom(e.target.value)}
              />
              <Button type="submit" disabled={save.pending || !custom.trim()}>
                {save.pending && <Spinner />}
                Usar esta pasta
              </Button>
            </div>
            <FieldDescription>
              No Finder, clique na pasta com o botão direito segurando a tecla Option e escolha “Copiar … como Caminho”.
              A pasta é criada se não existir.
            </FieldDescription>
            {customError && <FieldError>{customError}</FieldError>}
          </Field>
        </form>
      )}
      <p className="text-xs text-muted-foreground">
        Trocar de pasta não move os backups que já existem. Na primeira vez, o macOS pode perguntar se o Terminal pode
        acessar a pasta: clique em Permitir.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field orientation="horizontal" className="items-center sm:col-span-3">
          <Switch
            id={ids.auto}
            checked={settings.auto}
            disabled={save.pending}
            onCheckedChange={(auto) =>
              void run({ auto }, auto ? "Backup automático ligado." : "Backup automático desligado.")
            }
          />
          <FieldLabel htmlFor={ids.auto} className="font-normal">
            Backup automático todo dia (com o Offer Studio aberto)
          </FieldLabel>
        </Field>
        <Field>
          <FieldLabel htmlFor={ids.hour}>Horário</FieldLabel>
          <Select
            value={String(settings.hour)}
            disabled={!settings.auto || save.pending}
            onValueChange={(v) => void run({ hour: Number(v) }, `Backup automático às ${hourLabel(Number(v))}.`)}
          >
            <SelectTrigger id={ids.hour} className="w-full" aria-label="Horário do backup automático">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {hourLabel(h)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor={ids.keep}>Guardar</FieldLabel>
          <Select
            value={String(settings.keep)}
            disabled={save.pending}
            onValueChange={(v) => void run({ keep: Number(v) }, `Guardando os ${v} backups automáticos mais novos.`)}
          >
            <SelectTrigger id={ids.keep} className="w-full" aria-label="Quantos backups automáticos guardar">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {keepChoices(settings.keep).map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Os {n} automáticos mais novos
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>Os manuais ficam até você excluir.</FieldDescription>
        </Field>
      </div>
    </section>
  );
}
