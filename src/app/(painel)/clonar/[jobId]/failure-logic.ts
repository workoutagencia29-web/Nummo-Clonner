/**
 * O que a tela "Não foi possível clonar" oferece, conforme o motivo (sem React;
 * testado em tests/unit/polish-x-clone.test.ts). "Tentar de novo" só é a ação
 * principal quando tentar de novo pode resolver (falha passageira).
 */

/** Bloqueios em que salvar a página pelo navegador e importar resolve. */
export const IMPORTABLE_BLOCKS = new Set(["BOT_CHALLENGE", "CAPTCHA", "LOGIN_WALL", "EMPTY_SHELL"]);
/** Erros de importação que se repetiriam iguais numa nova tentativa (ZIP com senha, sem .html…). */
const PERMANENT_ERRORS = new Set(["IMPORT_INVALID"]);

export interface FailureInput {
  variant: "failed" | "canceled" | "expired";
  source: "URL" | "ZIP" | "HTML";
  errorCode: string | null;
  /** Detalhe técnico da proteção (ex.: "HTTP 403"). */
  protectionDetail: string | null;
  message: string | null;
  /** false quando o arquivo enviado (ZIP/HTML) já foi apagado. */
  canRetry: boolean;
}

export interface FailureActions {
  /** O site bloqueia o robô: salvar pelo navegador e importar resolve. */
  importAdvice: boolean;
  /** "Tentar de novo" aparece (como ação principal ou secundária). */
  showRetry: boolean;
  /** "Tentar de novo" é a ação principal (senão, a outra ação é). */
  retryPrimary: boolean;
  next: { href: string; label: string; kind: "zip" | "html" | "new" };
}

/** Endereço que nunca vai abrir igual: rede interna (bloqueado), inexistente ou página que não existe mais. */
function permanentUrlFailure({ errorCode, protectionDetail, message }: FailureInput) {
  const text = message ?? "";
  if (/rede interna/i.test(text)) return "blocked" as const;
  if (/Não encontramos esse endereço/i.test(text)) return "fix-link" as const;
  if (errorCode === "HTTP_ERROR" && /\b(?:404|410)\b/.test(protectionDetail ?? "")) return "fix-link" as const;
  return null;
}

export function failureActions(input: FailureInput): FailureActions {
  const { variant, source, errorCode, protectionDetail, canRetry } = input;
  // Só sugerimos importar o ZIP quando o problema é o site bloquear o robô —
  // não para ZIP/HTML que falharam, página inexistente ou falta de internet.
  const importAdvice =
    variant === "failed" &&
    source === "URL" &&
    (IMPORTABLE_BLOCKS.has(errorCode ?? "") ||
      (errorCode === "HTTP_ERROR" && /\b40[13]\b/.test(protectionDetail ?? "")));
  const permanent = variant === "failed" && source === "URL" ? permanentUrlFailure(input) : null;

  const next: FailureActions["next"] =
    importAdvice || source === "ZIP"
      ? { href: "/clonar?aba=zip", label: source === "ZIP" ? "Enviar outro ZIP" : "Importar ZIP", kind: "zip" }
      : source === "HTML"
        ? { href: "/clonar?aba=html", label: "Colar outro HTML", kind: "html" }
        : { href: "/clonar", label: permanent ? "Clonar outro link" : "Nova clonagem", kind: "new" };

  // Endereço bloqueado por segurança: tentar de novo nunca funciona.
  const showRetry = canRetry && !PERMANENT_ERRORS.has(errorCode ?? "") && permanent !== "blocked";
  // Proteção do site ou link errado: a outra ação vem primeiro; tentar de novo fica de reserva.
  const retryPrimary = showRetry && !importAdvice && !permanent;
  return { importAdvice, showRetry, retryPrimary, next };
}
