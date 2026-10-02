"use client";

import { useEffect, useState } from "react";
import { type ExportView, exportStatusUrl } from "@/lib/export/options";
import { fatalPollMessage, isFinished, nextPollDelay } from "./logic";

export interface ExportPoll {
  /** Última leitura do ZIP acompanhado (null até a primeira chegar). */
  view: ExportView | null;
  /** Falha passageira (sem conexão, erro do servidor): continua tentando. */
  error: string | null;
  /** Falha definitiva (ZIP apagado, sessão vencida): parou de ler. */
  fatal: string | null;
}

const OFFLINE = "Sem conexão com o Offer Studio. Tentando de novo…";

type PollState = ExportPoll & { forId: string | null };

const fresh = (id: string | null): PollState => ({ forId: id, view: null, error: null, fatal: null });

/**
 * Lê GET /api/exports/<id> a cada segundo até o ZIP ficar pronto ou falhar.
 * Trocar de id recomeça do zero na mesma renderização (sem mostrar o ZIP anterior).
 */
export function useExportPoll(exportId: string | null, intervalMs = 1000): ExportPoll {
  const [stored, setState] = useState<PollState>(() => fresh(exportId));
  const state = stored.forId === exportId ? stored : fresh(exportId);

  useEffect(() => {
    if (!exportId) return;
    const update = (fn: (s: PollState) => PollState) => setState((s) => fn(s.forId === exportId ? s : fresh(exportId)));
    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();

    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(tick, ms);
    };

    async function tick() {
      if (stopped) return;
      try {
        const res = await fetch(exportStatusUrl(exportId as string), {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: abort.signal,
        });
        const body = (await res.json().catch(() => null)) as (ExportView & { error?: string }) | null;
        if (stopped) return;
        const fatal = res.ok ? null : fatalPollMessage(res.status, body?.error);
        if (fatal) {
          stopped = true;
          update((s) => ({ ...s, error: null, fatal }));
          return;
        }
        if (!res.ok || !body || typeof body.status !== "string" || body.id !== exportId) {
          throw new Error(body?.error || OFFLINE);
        }
        failures = 0;
        update((s) => ({ ...s, view: body, error: null }));
        if (isFinished(body.status)) stopped = true;
        else schedule(intervalMs);
      } catch (err) {
        if (stopped || abort.signal.aborted) return;
        failures++;
        // Falha de rede (TypeError do fetch) → mensagem padrão; as outras já vêm em português.
        const message = err instanceof Error && !(err instanceof TypeError) && err.message ? err.message : OFFLINE;
        update((s) => ({ ...s, error: message }));
        schedule(nextPollDelay(failures, intervalMs));
      }
    }

    void tick();
    return () => {
      stopped = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [exportId, intervalMs]);

  const { forId: _forId, ...view } = state;
  return view;
}
