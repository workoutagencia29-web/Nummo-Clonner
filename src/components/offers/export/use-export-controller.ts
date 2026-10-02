"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAction } from "@/hooks/use-action";
import {
  type ExportOptions,
  ExportOptionsSchema,
  type ExportPlan,
  type ExportView,
  exportDownloadUrl,
} from "@/lib/export/options";
import type { ActionResult } from "@/server/action";
import { deleteExportAction, exportPlanAction, listExportsAction, startExportAction } from "@/server/actions/export";
import { checkedDownload, startDownload } from "./download";
import {
  buildTreeRows,
  type ExportStage,
  exportStage,
  historyRows,
  initialOptions,
  isFinished,
  mergeExportView,
  optionsToSend,
  planOptionsFor,
  queueStalled,
  runningExport,
  type TreeOptions,
  treeForOptions,
  visiblePlanWarnings,
} from "./logic";
import { useExportPoll } from "./use-export-poll";

const OFFLINE = "Não foi possível falar com o Offer Studio. Ele ainda está aberto?";
export const EXPORT_FAILED_FALLBACK =
  "Algo deu errado ao montar o ZIP. Tente de novo; se continuar, confira as páginas da oferta.";

interface Loaded<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Plano + as opções com que ele foi pedido. */
interface PlanState extends Loaded<ExportPlan> {
  for: TreeOptions;
}

const DEFAULT_TREE_OPTIONS: TreeOptions = { splitter: true, serverEvents: false };

const empty = <T>(): Loaded<T> => ({ data: null, loading: false, error: null });

async function call<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch {
    return { ok: false, error: OFFLINE };
  }
}

/** Aviso de um ZIP que ficou pronto (com "Baixar") ou falhou longe da tela de progresso. */
function notifyFinished(view: ExportView) {
  if (view.status === "DONE") {
    const url = exportDownloadUrl(view.id);
    toast.success("Seu ZIP está pronto.", {
      description: view.fileName,
      duration: 20_000,
      action: {
        label: "Baixar",
        onClick: () => void checkedDownload(url, view.fileName).then((problem) => problem && toast.error(problem)),
      },
    });
  } else {
    toast.error(view.errorMessage || EXPORT_FAILED_FALLBACK);
  }
}

/**
 * Tudo o que o "Baixar ZIP" de uma oferta precisa, fora do diálogo (que some
 * ao fechar): o ZIP acompanhado continua sendo lido com o diálogo fechado e,
 * ao ficar pronto, o download começa sozinho (diálogo aberto) ou aparece um
 * aviso com "Baixar" (diálogo fechado).
 *
 * "Voltar às opções" com o ZIP ainda na fila ou sendo gerado não abandona o
 * ZIP: ele continua sendo lido em segundo plano, aparece em "ZIPs anteriores"
 * com o andamento (na fila, dá para cancelar ali) e, ao ficar pronto, avisa
 * com "Baixar" — com o diálogo aberto ou fechado.
 */
export function useExportController(offerId: string) {
  const [open, setOpenState] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [options, setOptions] = useState<ExportOptions>(() => ExportOptionsSchema.parse({}));
  const touched = useRef(false);
  const [plan, setPlan] = useState<PlanState>(() => ({ ...empty<ExportPlan>(), for: DEFAULT_TREE_OPTIONS }));
  const [history, setHistory] = useState<Loaded<ExportView[]>>(empty);
  const [guideOpen, setGuideOpen] = useState(false);
  const [downloadedId, setDownloadedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const poll = useExportPoll(activeId);
  const stage: ExportStage = exportStage(activeId, poll.view, poll.fatal);
  const view = poll.view && poll.view.id === activeId ? poll.view : null;

  // ZIPs deixados gerando ao "Voltar às opções" (lidos um por vez, o mais antigo primeiro).
  const [detached, setDetachedState] = useState<string[]>([]);
  const detachedRef = useRef<string[]>([]);
  const setDetached = useCallback((fn: (ids: string[]) => string[]) => {
    detachedRef.current = fn(detachedRef.current);
    setDetachedState(detachedRef.current);
  }, []);
  const backgroundId = detached[0] ?? null;
  const background = useExportPoll(backgroundId);
  const backgroundView = background.view && background.view.id === backgroundId ? background.view : null;

  const { run: runStart, pending: generating } = useAction(startExportAction);
  const { run: runDelete } = useAction(deleteExportAction);

  // Refs para os efeitos assíncronos lerem o valor atual sem recomeçar.
  const openRef = useRef(open);
  const activeRef = useRef(activeId);
  const viewRef = useRef(view);
  useEffect(() => {
    openRef.current = open;
    activeRef.current = activeId;
    viewRef.current = view;
  });

  // Plano (o que vai no ZIP) pedido com as opções que mudam a árvore; sem token, nunca com o eventos.php.
  const tokens = plan.data?.hasServerEventTokens;
  const wantSplitter = options.splitter;
  const wantEvents = planOptionsFor(options, tokens).serverEvents;
  const planSeq = useRef(0);
  const loadPlan = useCallback(
    async (forOptions: TreeOptions) => {
      const seq = ++planSeq.current;
      setPlan((p) => ({ ...p, loading: true, error: null }));
      const result = await call(() => exportPlanAction({ offerId, options: forOptions }));
      if (seq !== planSeq.current) return;
      setPlan((p) =>
        result.ok
          ? { data: result.data, for: forOptions, loading: false, error: null }
          : { ...p, loading: false, error: result.error },
      );
    },
    [offerId],
  );
  const reloadPlan = useCallback(
    () => loadPlan({ splitter: wantSplitter, serverEvents: wantEvents }),
    [loadPlan, wantSplitter, wantEvents],
  );
  // Ao abrir, na hora; ao mudar uma opção, logo depois (a árvore já se ajusta enquanto isso).
  const hasPlan = plan.data !== null;
  const hasPlanRef = useRef(hasPlan);
  useEffect(() => {
    hasPlanRef.current = hasPlan;
  });
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(
      () => void loadPlan({ splitter: wantSplitter, serverEvents: wantEvents }),
      hasPlanRef.current ? 250 : 0,
    );
    return () => clearTimeout(timer);
  }, [open, loadPlan, wantSplitter, wantEvents]);

  const historySeq = useRef(0);
  const loadHistory = useCallback(async () => {
    const seq = ++historySeq.current;
    setHistory((h) => ({ ...h, loading: true, error: null }));
    const result = await call(() => listExportsAction({ offerId }));
    if (seq !== historySeq.current) return;
    if (!result.ok) {
      setHistory((h) => ({ ...h, loading: false, error: result.error }));
      return;
    }
    setHistory({ data: result.data, loading: false, error: null });
    if (!touched.current) setOptions(initialOptions(result.data));
    // Um ZIP desta oferta ainda sendo gerado (ex.: a tela foi recarregada): volta a acompanhar
    // (menos o que a pessoa deixou gerando ao voltar às opções).
    const running = runningExport(result.data, detachedRef.current);
    if (running && !activeRef.current && openRef.current) setActiveId(running.id);
  }, [offerId]);

  // Abriu o diálogo: lista atualizada (os dados anteriores continuam na tela enquanto isso).
  useEffect(() => {
    if (!open) return;
    void loadHistory();
  }, [open, loadHistory]);

  // O ZIP acompanhado terminou: download automático (ou aviso) e lista atualizada.
  const handled = useRef(new Set<string>());
  useEffect(() => {
    if (!view || !isFinished(view.status) || handled.current.has(view.id)) return;
    handled.current.add(view.id);
    if (openRef.current) {
      if (view.status === "DONE") {
        startDownload(exportDownloadUrl(view.id), view.fileName);
        setDownloadedId(view.id);
      }
      void loadHistory();
    } else {
      notifyFinished(view);
    }
  }, [view, loadHistory]);

  // ZIP deixado gerando: cada leitura atualiza a linha dele em "ZIPs anteriores"; pronto
  // (ou com falha), avisa e sai da lista de acompanhamento.
  useEffect(() => {
    if (!backgroundView) return;
    setHistory((h) => (h.data ? { ...h, data: mergeExportView(h.data, backgroundView) } : h));
    if (!isFinished(backgroundView.status)) return;
    setDetached((ids) => ids.filter((id) => id !== backgroundView.id));
    if (!handled.current.has(backgroundView.id)) {
      handled.current.add(backgroundView.id);
      notifyFinished(backgroundView);
    }
    if (openRef.current) void loadHistory();
  }, [backgroundView, setDetached, loadHistory]);
  // Apagado (ou a sessão venceu): para de acompanhar sem aviso.
  useEffect(() => {
    if (!backgroundId || !background.fatal) return;
    setDetached((ids) => ids.filter((id) => id !== backgroundId));
    if (openRef.current) void loadHistory();
  }, [backgroundId, background.fatal, setDetached, loadHistory]);

  // Primeiro ZIP pronto desta oferta: já abre o passo a passo da hospedagem.
  const firstZip = stage === "done" && !(history.data ?? []).some((e) => e.status === "DONE" && e.id !== activeId);
  useEffect(() => {
    if (firstZip) setGuideOpen(true);
  }, [firstZip]);

  const stageRef = useRef(stage);
  useEffect(() => {
    stageRef.current = stage;
  });
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    // Fechou com o ZIP já pronto (ou com erro): na próxima vez, começa pelas opções.
    if (!next && (stageRef.current === "done" || stageRef.current === "failed")) setActiveId(null);
  }, []);

  const changeOptions = useCallback((patch: Partial<ExportOptions>) => {
    touched.current = true;
    setOptions((o) => ({ ...o, ...patch }));
  }, []);

  const generate = useCallback(
    (opts: ExportOptions = options) => {
      void runStart(
        { offerId, options: optionsToSend(opts, plan.data) },
        {
          onSuccess: ({ exportId }) => {
            setDownloadedId(null);
            setActiveId(exportId);
          },
        },
      );
    },
    [runStart, offerId, options, plan.data],
  );

  const retry = useCallback(() => generate(view?.options ?? options), [generate, view, options]);
  /**
   * Volta às opções. Com o ZIP ainda na fila ou sendo gerado, ele continua em
   * segundo plano (ver acima) e já entra em "ZIPs anteriores".
   */
  const backToOptions = useCallback(() => {
    const id = activeRef.current;
    const current = viewRef.current;
    if (id && stageRef.current === "progress") {
      setDetached((ids) => (ids.includes(id) ? ids : [...ids, id]));
      // Entra já em "ZIPs anteriores" (a lista foi lida antes de o ZIP ser pedido).
      if (current) setHistory((h) => ({ ...h, data: mergeExportView(h.data, current) }));
    }
    setActiveId(null);
    void loadHistory();
  }, [setDetached, loadHistory]);

  // Na fila há muito tempo com o robô de tarefas parado? (a leitura de cada segundo atualiza a hora)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (view) setNow(Date.now());
  }, [view]);
  const stalled = queueStalled(view, now);

  /** Cancela o ZIP acompanhado enquanto ele ainda está na fila (volta às opções). */
  const [cancelling, setCancelling] = useState(false);
  const cancelQueued = useCallback(() => {
    const id = activeRef.current;
    if (!id) return;
    setCancelling(true);
    void runDelete(
      { exportId: id },
      {
        success: "Pedido do ZIP cancelado.",
        onSuccess: () => {
          setActiveId((current) => (current === id ? null : current));
          void loadHistory();
        },
      },
    ).then(() => setCancelling(false));
  }, [runDelete, loadHistory]);

  /** Baixa um ZIP já pronto, conferindo antes se o arquivo ainda existe (senão, diz o motivo). */
  const download = useCallback(
    (item: Pick<ExportView, "id" | "fileName">) => {
      void checkedDownload(exportDownloadUrl(item.id), item.fileName).then((problem) => {
        if (!problem) return;
        toast.error(problem);
        void loadHistory();
      });
    },
    [loadHistory],
  );

  const deleteExport = useCallback(
    (item: ExportView) => {
      setDeletingId(item.id);
      void runDelete(
        { exportId: item.id },
        {
          success: item.status === "QUEUED" ? "Pedido do ZIP cancelado." : "ZIP apagado.",
          onSuccess: () => {
            setDetached((ids) => ids.filter((id) => id !== item.id));
            setHistory((h) => ({ ...h, data: h.data ? h.data.filter((e) => e.id !== item.id) : h.data }));
          },
        },
      ).then(() => setDeletingId(null));
    },
    [runDelete, setDetached],
  );

  const treeRows = useMemo(
    () => (plan.data ? buildTreeRows(treeForOptions(plan.data, options, plan.for)) : []),
    [plan.data, plan.for, options],
  );
  const planWarnings = useMemo(() => visiblePlanWarnings(plan.data?.warnings), [plan.data]);

  return {
    offerId,
    open,
    setOpen,
    stage,
    activeId,
    view,
    pollError: poll.error,
    fatal: poll.fatal,
    options,
    changeOptions,
    plan,
    /** O plano já respondeu (com a lista ou com erro): sem ele, não dá para saber se o eventos.php pode ir. */
    planSettled: plan.data !== null || plan.error !== null,
    planWarnings,
    reloadPlan,
    treeRows,
    history,
    historyRows: historyRows(history.data, activeId),
    loadHistory,
    deletingId,
    deleteExport,
    generate,
    generating,
    retry,
    backToOptions,
    /** Algum ZIP deixado gerando ao voltar às opções ainda não terminou. */
    background: detached.length > 0,
    stalled,
    cancelQueued,
    cancelling,
    download,
    guideOpen,
    setGuideOpen,
    autoDownloaded: downloadedId !== null && downloadedId === activeId,
  };
}

export type ExportController = ReturnType<typeof useExportController>;
