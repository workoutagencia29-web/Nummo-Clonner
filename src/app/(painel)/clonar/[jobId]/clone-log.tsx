"use client";

import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon, XCircleIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { CloneLogLine } from "./use-clone-status";

const ICON = {
  INFO: { icon: InfoIcon, cls: "text-muted-foreground" },
  SUCCESS: { icon: CheckCircle2Icon, cls: "text-success" },
  WARN: { icon: AlertTriangleIcon, cls: "text-warning" },
  ERROR: { icon: XCircleIcon, cls: "text-destructive" },
} as const;

/** Log ao vivo da clonagem (rola sozinho para a última linha). */
export function CloneLog({ logs, className }: { logs: CloneLogLine[]; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const count = logs.length;
  // Rola só a caixa do log (não a página) quando chegam linhas novas.
  // biome-ignore lint/correctness/useExhaustiveDependencies: o efeito deve rodar a cada linha nova
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  return (
    <div
      ref={box}
      className={cn("max-h-80 overflow-y-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs", className)}
      role="log"
      aria-live="polite"
      aria-label="Registro da clonagem"
    >
      {logs.length === 0 ? (
        <p className="text-muted-foreground">Aguardando…</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {logs.map((line) => {
            const { icon: Icon, cls } = ICON[line.level as keyof typeof ICON] ?? ICON.INFO;
            return (
              <li key={line.id} className="flex gap-2">
                <Icon className={cn("mt-px size-3.5 shrink-0", cls)} />
                <span className="min-w-0 break-words">
                  {line.message}
                  {line.url && <span className="block truncate text-muted-foreground">{line.url}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
