import "server-only";
import type { z } from "zod";
import { toUserMessage } from "@/lib/errors";
import { requireSession } from "@/server/session";

/**
 * Resultado padrão das server actions. A tela mostra `error` num toast e
 * `field` destaca o campo com problema no formulário.
 */
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string; field?: string };

/**
 * Cria uma server action protegida por login, com validação zod na entrada e
 * tradução de qualquer erro para português. Erros inesperados são registrados
 * no console do servidor, mas nunca vazam detalhes técnicos para a tela.
 */
export function protectedAction<S extends z.ZodType, T>(
  schema: S,
  handler: (input: z.output<S>) => Promise<T>,
): (input: z.input<S>) => Promise<ActionResult<T>> {
  return async (input) => {
    await requireSession();
    try {
      const parsed = schema.parse(input);
      const data = await handler(parsed);
      return { ok: true, data };
    } catch (err) {
      // redirect()/notFound() do Next usam exceções especiais: repassar.
      if (err instanceof Error && "digest" in err && String(err.digest).startsWith("NEXT_")) throw err;
      const info = toUserMessage(err);
      if (info.message.startsWith("Algo deu errado")) console.error("[action]", err);
      return { ok: false, error: info.message, field: info.field };
    }
  };
}
