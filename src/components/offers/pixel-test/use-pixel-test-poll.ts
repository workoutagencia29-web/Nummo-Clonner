"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PixelTestEventRow } from "@/lib/tracking/test-report";
import {
  mergeEvents,
  nextPollDelay,
  PIXEL_TEST_PAGE_SIZE,
  type PixelTestPollResponse,
  pixelTestEventsUrl,
} from "./logic";

export interface PixelTestPoll {
  /** Primeira leitura ainda não chegou. */
  loading: boolean;
  events: PixelTestEventRow[];
  session: PixelTestPollResponse["session"] | null;
  /** Falha passageira (sem conexão, erro do servidor): continua tentando. */
  error: string | null;
  /** Falha definitiva (teste apagado, sessão do painel vencida): parou de ler. */
  fatal: string | null;
  /** Lê de novo agora (ex.: depois de "Encerrar teste"). */
  refresh: () => void;
}

const OFFLINE = "Sem conexão com o Offer Studio. Tentando de novo…";

/**
 * Lê os passos do teste a cada 1,5 s enquanto a aba do painel está visível
 * (aba escondida: para e volta a ler na hora em que a pessoa volta). Para de
 * vez quando o teste vence/é encerrado ou deixa de existir.
 */
type PollState = Omit<PixelTestPoll, "refresh"> & { forSession: string | null };

function fresh(sessionId: string | null): PollState {
  return { forSession: sessionId, loading: Boolean(sessionId), events: [], session: null, error: null, fatal: null };
}

export function usePixelTestPoll(sessionId: string | null, intervalMs = 1500): PixelTestPoll {
  const [stored, setState] = useState<PollState>(() => fresh(sessionId));
  // Outra sessão (ou nenhuma): começa do zero já nesta renderização (sem piscar o teste anterior).
  const state = stored.forSession === sessionId ? stored : fresh(sessionId);
  const [nonce, setNonce] = useState(0);
  // Último id recebido por sessão: a leitura extra (refresh) continua de onde parou.
  const after = useRef<{ sessionId: string | null; id: number }>({ sessionId: null, id: 0 });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` recomeça as leituras (refresh)
  useEffect(() => {
    if (!sessionId) return;
    if (after.current.sessionId !== sessionId) after.current = { sessionId, id: 0 };
    /** Atualiza o estado desta sessão (descarta o de uma sessão anterior). */
    const update = (fn: (s: PollState) => PollState) =>
      setState((s) => fn(s.forSession === sessionId ? s : fresh(sessionId)));
    let stopped = false;
    let busy = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();

    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(tick, ms);
    };

    async function tick() {
      if (stopped || busy) return;
      // Aba escondida: não lê (volta no "visibilitychange").
      if (document.visibilityState === "hidden") return;
      busy = true;
      try {
        const res = await fetch(pixelTestEventsUrl(sessionId as string, after.current.id), {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: abort.signal,
        });
        const body = (await res.json().catch(() => null)) as (PixelTestPollResponse & { error?: string }) | null;
        if (stopped) return;
        if (res.status === 404 || res.status === 401 || res.status === 403) {
          stopped = true;
          const fatal =
            body?.error ??
            (res.status === 404
              ? "Este teste não existe mais. Comece um novo teste."
              : "Entre de novo no Offer Studio.");
          update((s) => ({ ...s, loading: false, error: null, fatal }));
          return;
        }
        if (!res.ok || !body || !Array.isArray(body.events) || !body.session) {
          throw new Error(body?.error ?? OFFLINE);
        }
        failures = 0;
        after.current = { sessionId, id: Math.max(after.current.id, body.lastId) };
        update((s) => ({
          ...s,
          loading: false,
          error: null,
          session: body.session,
          events: mergeEvents(s.events, body.events),
        }));
        if (body.events.length >= PIXEL_TEST_PAGE_SIZE) schedule(50);
        else if (body.session.expired) stopped = true;
        else schedule(intervalMs);
      } catch (err) {
        if (stopped || abort.signal.aborted) return;
        failures++;
        // Falha de rede (TypeError do fetch) → mensagem padrão; as outras já vêm em português.
        const message = err instanceof Error && !(err instanceof TypeError) && err.message ? err.message : OFFLINE;
        update((s) => ({ ...s, loading: false, error: message }));
        schedule(nextPollDelay(failures, intervalMs));
      } finally {
        busy = false;
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      stopped = true;
      abort.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sessionId, intervalMs, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const { forSession: _forSession, ...view } = state;
  return { ...view, refresh };
}
