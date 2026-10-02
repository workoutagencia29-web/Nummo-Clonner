"use client";

import { DownloadIcon, FileArchiveIcon, RotateCwIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { EXPORT_STATUS_LABEL, EXPORTS_KEPT_PER_OFFER, type ExportView } from "@/lib/export/options";
import { dateTime } from "@/lib/format";
import { clampProgress, formatBytes, optionsSummary } from "./logic";
import { BusyIcon } from "./parts";

/** "ZIPs anteriores": os últimos 5 desta oferta, com baixar e apagar. */
export function ExportHistory({
  rows,
  loading,
  error,
  hasVariants,
  deletingId,
  onRetry,
  onDelete,
  onDownload,
  emptyText = "Nenhum ZIP gerado ainda.",
}: {
  rows: ExportView[];
  loading: boolean;
  error: string | null;
  hasVariants: boolean;
  deletingId: string | null;
  onRetry: () => void;
  onDelete: (item: ExportView) => void;
  /** Baixa um ZIP pronto (conferindo antes se o arquivo ainda existe). */
  onDownload: (item: ExportView) => void;
  emptyText?: string;
}) {
  return (
    <section aria-labelledby="export-history-title" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="export-history-title" className="font-medium text-sm">
          ZIPs anteriores
        </h3>
        <span className="text-muted-foreground text-xs">Guardamos os {EXPORTS_KEPT_PER_OFFER} mais recentes</span>
      </div>

      {error && rows.length === 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          <p className="text-muted-foreground">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RotateCwIcon />
            Tentar de novo
          </Button>
        </div>
      ) : loading && rows.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3" aria-busy="true">
          <span className="sr-only">Carregando os ZIPs…</span>
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-md" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-64" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-center text-muted-foreground text-sm">{emptyText}</p>
      ) : (
        <ul aria-label="ZIPs anteriores" className="flex flex-col divide-y rounded-lg border">
          {rows.map((item) => {
            const done = item.status === "DONE";
            const running = item.status === "QUEUED" || item.status === "RUNNING";
            const chips = optionsSummary(item.options, hasVariants);
            return (
              <li key={item.id} data-export-id={item.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <FileArchiveIcon className="size-4" aria-hidden="true" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-sm">{item.fileName}</span>
                    {!done && (
                      <Badge variant={item.status === "FAILED" ? "destructive" : "secondary"} className="shrink-0">
                        {running && <BusyIcon className="size-3" />}
                        {EXPORT_STATUS_LABEL[item.status]}
                        {running && ` · ${clampProgress(item.progress)}%`}
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-muted-foreground text-xs">
                    {[dateTime(item.createdAt), done ? formatBytes(item.bytes) : null, ...chips]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {item.status === "FAILED" && item.errorMessage && (
                    <p className="line-clamp-2 text-destructive text-xs">{item.errorMessage}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {done && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Baixar ${item.fileName} de ${dateTime(item.createdAt)}`}
                      onClick={() => onDownload(item)}
                    >
                      <DownloadIcon />
                      Baixar
                    </Button>
                  )}
                  {/* Na fila dá para apagar (cancela o pedido); sendo gerado, não. */}
                  {item.status !== "RUNNING" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${item.status === "QUEUED" ? "Cancelar" : "Apagar"} ${item.fileName} de ${dateTime(item.createdAt)}`}
                      title={item.status === "QUEUED" ? "Cancelar este pedido" : "Apagar este ZIP"}
                      disabled={deletingId === item.id}
                      onClick={() => onDelete(item)}
                    >
                      {deletingId === item.id ? <Spinner /> : <Trash2Icon />}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
