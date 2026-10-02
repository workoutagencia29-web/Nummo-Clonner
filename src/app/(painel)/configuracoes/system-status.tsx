"use client";

import { CheckCircle2Icon, CopyIcon, Loader2Icon, TriangleAlertIcon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BackupHealth } from "@/server/services/backup";

const BACKUP_ICON = {
  ok: { Icon: CheckCircle2Icon, className: "text-success" },
  warn: { Icon: TriangleAlertIcon, className: "text-warning-foreground dark:text-warning" },
  error: { Icon: XCircleIcon, className: "text-destructive" },
  running: { Icon: Loader2Icon, className: "animate-spin text-primary" },
} as const;

export function SystemStatus({
  workerOnline,
  workerLastSeen,
  dataDir,
  backupHealth,
}: {
  workerOnline: boolean;
  workerLastSeen: string | null;
  dataDir: string;
  backupHealth: BackupHealth;
}) {
  const backup = BACKUP_ICON[backupHealth.level];
  return (
    <dl className="flex flex-col gap-4 text-sm">
      {/* Cada grupo do <dl> só tem <dt>/<dd> (o ícone fica dentro do <dt>). */}
      <div>
        <dt className="flex items-start gap-3 font-medium">
          {workerOnline ? (
            <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <XCircleIcon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
          )}
          Robô de tarefas {workerOnline ? "funcionando" : "parado"}
        </dt>
        <dd className="pl-8 text-muted-foreground">
          {workerOnline
            ? "É ele quem faz clonagens, downloads em ZIP e backups."
            : `${workerLastSeen ? `Último sinal em ${dateTime(workerLastSeen)}. ` : ""}Feche o Offer Studio e abra de novo pelo atalho. Se continuar parado, veja as mensagens na janela do atalho.`}
        </dd>
      </div>
      <div>
        <dt className="flex items-start gap-3 font-medium">
          <backup.Icon className={cn("mt-0.5 size-5 shrink-0", backup.className)} aria-hidden="true" />
          {backupHealth.title}
        </dt>
        <dd className="pl-8 text-muted-foreground">
          {backupHealth.detail}{" "}
          <a href="#backup" className="text-primary underline-offset-4 hover:underline">
            Ver backup
          </a>
        </dd>
      </div>
      <div>
        <dt className="font-medium">Pasta dos dados</dt>
        <dd className="mt-1 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs">{dataDir}</code>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Copiar caminho"
            onClick={() => {
              void navigator.clipboard.writeText(dataDir).then(() => toast.success("Caminho copiado."));
            }}
          >
            <CopyIcon />
          </Button>
        </dd>
        <dd className="mt-1 text-xs text-muted-foreground">
          Banco de dados e arquivos ficam nesta pasta. Os backups ficam na pasta escolhida em Backup.
        </dd>
      </div>
    </dl>
  );
}
