"use client";

import { useCallback, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/server/action";

interface RunOptions<O> {
  /** Mensagem de sucesso (toast). Omitir = sem toast. */
  success?: string | ((data: O) => string);
  onSuccess?: (data: O) => void;
  onError?: (error: string, field?: string) => void;
  /** Não mostrar toast de erro (quando o formulário mostra o erro no campo). */
  silentError?: boolean;
}

/**
 * Executa uma server action com estado de carregamento e toasts em português.
 * Uso: const { run, pending } = useAction(createOfferAction);
 */
export function useAction<I, O>(action: (input: I) => Promise<ActionResult<O>>) {
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    (input: I, opts: RunOptions<O> = {}) =>
      new Promise<ActionResult<O>>((resolve) => {
        startTransition(async () => {
          let result: ActionResult<O>;
          try {
            result = await action(input);
          } catch {
            result = { ok: false, error: "Não foi possível falar com o Offer Studio. Ele ainda está aberto?" };
          }
          if (result.ok) {
            const msg = typeof opts.success === "function" ? opts.success(result.data) : opts.success;
            if (msg) toast.success(msg);
            opts.onSuccess?.(result.data);
          } else {
            if (!opts.silentError) toast.error(result.error);
            opts.onError?.(result.error, result.field);
          }
          resolve(result);
        });
      }),
    [action],
  );

  return { run, pending };
}
