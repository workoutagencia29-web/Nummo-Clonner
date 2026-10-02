"use client";

import { useEffect, useRef, useState } from "react";
import type { CloneStatus } from "@/server/services/clone";

export type CloneLogLine = CloneStatus["logs"][number];

/**
 * Consulta o progresso da clonagem a cada segundo enquanto `active` for true.
 * Acumula as linhas de log (a API só devolve as novas).
 */
export function useCloneStatus(jobId: string, initial: CloneStatus | null, active: boolean, intervalMs = 1000) {
  const [status, setStatus] = useState<CloneStatus | null>(initial);
  const [logs, setLogs] = useState<CloneLogLine[]>(initial?.logs ?? []);
  const [offline, setOffline] = useState(false);
  const lastLog = useRef(initial?.logs.at(-1)?.id ?? 0);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(`/api/clone/${jobId}?depois=${lastLog.current}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as CloneStatus;
          if (stopped) return;
          setOffline(false);
          setStatus(next);
          if (next.logs.length) {
            lastLog.current = next.logs.at(-1)?.id ?? lastLog.current;
            setLogs((prev) => [...prev, ...next.logs].slice(-500));
          }
        }
      } catch {
        if (!stopped) setOffline(true);
      }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, intervalMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId, active, intervalMs]);

  return { status, logs, offline };
}
