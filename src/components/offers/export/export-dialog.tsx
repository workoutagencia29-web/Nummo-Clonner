"use client";

import { ArrowLeftIcon, DownloadIcon, RotateCwIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ExportHistory } from "./export-history";
import { HostingGuide, SafariZipTip } from "./hosting-guide";
import { clampProgress, formatBytes, progressStep } from "./logic";
import { BusyIcon, ExportOptionsForm, ExportTree, Notice } from "./parts";
import { EXPORT_FAILED_FALLBACK, type ExportController } from "./use-export-controller";
import { useIsSafari } from "./use-is-safari";
import { ExportWarning } from "./warning-fixes";

/** Avisos do "Antes de subir"; os que a tela sabe resolver vêm com o campo (ExportWarning). */
function WarningList({ items, c }: { items: string[]; c: ExportController }) {
  if (items.length === 1)
    return (
      <div>
        <ExportWarning text={items[0]} c={c} />
      </div>
    );
  return (
    <ul className="ml-4 list-disc space-y-1">
      {items.map((w) => (
        <li key={w}>
          <ExportWarning text={w} c={c} />
        </li>
      ))}
    </ul>
  );
}

function SetupStage({ c }: { c: ExportController }) {
  const plan = c.plan.data;
  const warnings = c.planWarnings;
  const relativeOk = plan ? plan.preserveJsPages.length === 0 : false;
  return (
    <>
      <section aria-labelledby="export-tree-title" className="flex flex-col gap-2">
        <h3 id="export-tree-title" className="font-medium text-sm">
          O que vai no ZIP
        </h3>
        {c.plan.error && !plan ? (
          <Notice variant="error" role="alert" title="Não foi possível montar a lista do ZIP">
            <p>{c.plan.error}</p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void c.reloadPlan()}>
              <RotateCwIcon />
              Tentar de novo
            </Button>
          </Notice>
        ) : (
          <ExportTree rows={c.treeRows} loading={c.plan.loading || !c.planSettled} />
        )}
        {relativeOk && (
          <p className="text-muted-foreground text-xs">
            Endereços relativos: funciona na raiz do domínio ou numa subpasta da hospedagem.
          </p>
        )}
      </section>

      {warnings.length > 0 && (
        <Notice variant="warning" title="Antes de subir">
          <WarningList items={warnings} c={c} />
        </Notice>
      )}

      <section aria-labelledby="export-options-title" className="flex flex-col gap-2">
        <h3 id="export-options-title" className="font-medium text-sm">
          Opções
        </h3>
        <ExportOptionsForm
          options={c.options}
          onChange={c.changeOptions}
          hasVariants={plan?.hasVariants ?? false}
          hasServerEventTokens={plan?.hasServerEventTokens ?? false}
          serverEventVendors={plan?.serverEventVendors}
          disabled={c.generating}
        />
      </section>
    </>
  );
}

function ProgressStage({ c }: { c: ExportController }) {
  const pct = clampProgress(c.view?.progress);
  const queued = !c.view || c.view.status === "QUEUED";
  return (
    <>
      <section aria-labelledby="export-progress-title" className="flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <BusyIcon />
          <h3 id="export-progress-title" className="font-medium text-sm">
            {queued ? "Na fila para gerar o ZIP…" : "Gerando o ZIP…"}
          </h3>
          <span className="ml-auto text-muted-foreground text-sm tabular-nums">{pct}%</span>
        </div>
        <Progress value={pct} aria-label="Progresso do ZIP" />
        <p className="text-muted-foreground text-sm" aria-live="polite" data-slot="export-step">
          {progressStep(c.view)}
        </p>
        {c.pollError && <p className="text-warning-foreground text-xs dark:text-warning">{c.pollError}</p>}
        <p className="text-muted-foreground text-xs">
          Pode fechar esta janela: se continuar nesta tela, avisamos quando ficar pronto. O ZIP também fica em “ZIPs
          anteriores”.
        </p>
      </section>
      {c.stalled && (
        <Notice variant="warning" role="alert" title="O ZIP não começou">
          <p>
            O robô de tarefas do Offer Studio parece parado, por isso o ZIP continua na fila. Feche o Offer Studio e
            abra de novo pelo atalho: o ZIP começa sozinho. Se preferir, cancele o pedido.
          </p>
        </Notice>
      )}
    </>
  );
}

function DoneStage({ c }: { c: ExportController }) {
  const view = c.view;
  const safari = useIsSafari();
  if (!view) return null;
  return (
    <>
      <Notice
        variant="success"
        role="status"
        title={c.autoDownloaded ? "ZIP pronto! O download começou." : "ZIP pronto!"}
      >
        <p>
          <strong className="break-all">{view.fileName}</strong>
          {view.bytes != null && ` · ${formatBytes(view.bytes)}`}
        </p>
        <p>
          {c.autoDownloaded
            ? "Se o download não começar, clique em “Baixar de novo”."
            : "Clique em “Baixar de novo” para salvar o arquivo."}
        </p>
      </Notice>
      {safari && (
        <Notice variant="info" title="Baixou pelo Safari?">
          <SafariZipTip />
        </Notice>
      )}
      {view.warnings.length > 0 && (
        <Notice variant="warning" title="Antes de subir">
          <WarningList items={view.warnings} c={c} />
        </Notice>
      )}
    </>
  );
}

function FailedStage({ c }: { c: ExportController }) {
  return (
    <Notice variant="error" role="alert" title="Não foi possível gerar o ZIP">
      {c.fatal || c.view?.errorMessage || EXPORT_FAILED_FALLBACK}
    </Notice>
  );
}

function Footer({ c }: { c: ExportController }) {
  const close = (label: string, primary = false) => (
    <DialogClose asChild>
      <Button type="button" variant={primary ? "default" : "outline"}>
        {label}
      </Button>
    </DialogClose>
  );
  const back = (
    <Button type="button" variant="ghost" className="sm:mr-auto" onClick={c.backToOptions}>
      <ArrowLeftIcon />
      Voltar às opções
    </Button>
  );
  switch (c.stage) {
    case "setup":
      return (
        <>
          {close("Cancelar")}
          <Button type="button" onClick={() => c.generate()} disabled={c.generating || !c.planSettled}>
            {c.generating || !c.planSettled ? <BusyIcon /> : <DownloadIcon />}
            Gerar ZIP
          </Button>
        </>
      );
    case "progress":
      return (
        <>
          {back}
          {c.view?.status === "QUEUED" && (
            <Button type="button" variant="outline" onClick={c.cancelQueued} disabled={c.cancelling}>
              {c.cancelling ? <BusyIcon /> : <XIcon />}
              Cancelar pedido
            </Button>
          )}
          {close("Fechar")}
        </>
      );
    case "done":
      return (
        <>
          {back}
          {close("Fechar")}
          {c.view && (
            <Button type="button" onClick={() => c.view && c.download(c.view)}>
              <DownloadIcon />
              Baixar de novo
            </Button>
          )}
        </>
      );
    case "failed":
      return (
        <>
          {back}
          {close("Fechar")}
          <Button type="button" onClick={c.retry} disabled={c.generating}>
            {c.generating ? <BusyIcon /> : <RotateCwIcon />}
            Tentar de novo
          </Button>
        </>
      );
  }
}

/** Diálogo "Baixar ZIP": o que vai no ZIP, opções, progresso, download, ZIPs anteriores e o passo a passo. */
export function ExportDialog({ c }: { c: ExportController }) {
  const plan = c.plan.data;
  return (
    <Dialog open={c.open} onOpenChange={c.setOpen}>
      <DialogContent className="flex max-h-[min(92dvh,880px)] flex-col gap-0 p-0 sm:max-w-2xl" data-stage={c.stage}>
        <DialogHeader className="border-b px-6 pt-6 pb-4 pr-12">
          <DialogTitle>Baixar ZIP</DialogTitle>
          <DialogDescription>
            Um arquivo pronto para subir em qualquer hospedagem: Hostinger, HostGator, cPanel, Netlify…
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          {c.stage === "setup" && <SetupStage c={c} />}
          {c.stage === "progress" && <ProgressStage c={c} />}
          {c.stage === "done" && <DoneStage c={c} />}
          {c.stage === "failed" && <FailedStage c={c} />}
          <HostingGuide
            open={c.guideOpen}
            onOpenChange={c.setGuideOpen}
            preserveJsPages={plan?.preserveJsPages}
            hasPayments={plan?.hasPayments ?? false}
          />
          {(c.stage === "setup" || c.historyRows.length > 0) && (
            <ExportHistory
              rows={c.historyRows}
              loading={c.history.loading || (!c.history.data && !c.history.error)}
              error={c.history.error}
              hasVariants={plan?.hasVariants ?? false}
              deletingId={c.deletingId}
              onRetry={() => void c.loadHistory()}
              onDelete={c.deleteExport}
              onDownload={c.download}
            />
          )}
        </div>
        <DialogFooter className="border-t px-6 py-4">
          <Footer c={c} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
