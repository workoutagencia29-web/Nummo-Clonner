"use client";

import { useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/server/action";

const OFFLINE = "Sem conexão com o Offer Studio. Tentando de novo…";

interface JobLike {
  id: string;
  status: string;
}

export interface JobPoll<T> {
  job: T | null;
  /** Falha passageira (continua tentando). */
  error: string | null;
}

/**
 * Lê o andamento de um backup/restauração a cada `intervalMs` até terminar
 * (DONE ou FAILED). Falhas de conexão continuam tentando, com espera maior.
 */
export function useJobPoll<T extends JobLike>(
  id: string | null,
  read: (input: { id: string }) => Promise<ActionResult<T>>,
  intervalMs = 1000,
): JobPoll<T> {
  const [state, setState] = useState<{ forId: string | null; job: T | null; error: string | null }>({
    forId: id,
    job: null,
    error: null,
  });
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  });

  useEffect(() => {
    if (!id) return;
    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      let result: ActionResult<T>;
      try {
        result = await readRef.current({ id });
      } catch {
        result = { ok: false, error: OFFLINE };
      }
      if (stopped) return;
      if (result.ok) {
        failures = 0;
        setState({ forId: id, job: result.data, error: null });
        if (result.data.status === "DONE" || result.data.status === "FAILED") return;
        timer = setTimeout(tick, intervalMs);
      } else {
        failures++;
        setState((s) => ({ forId: id, job: s.forId === id ? s.job : null, error: result.ok ? null : result.error }));
        timer = setTimeout(tick, Math.min(10_000, intervalMs * 2 ** Math.min(failures, 4)));
      }
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, intervalMs]);

  if (state.forId !== id) return { job: null, error: null };
  return { job: state.job, error: state.error };
}
