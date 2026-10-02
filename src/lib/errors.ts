/**
 * Tradução de erros para mensagens claras em português.
 *
 * Regra: nenhuma mensagem técnica em inglês chega à tela. Todo erro passa por
 * `toUserMessage()` (servidor) ou `authErrorMessage()` (tela de login/conta).
 */
import { z } from "zod";

// Mensagens de validação do zod em português do Brasil.
z.config(z.locales.ptBR());

/** Erro com mensagem já pronta para o usuário (lançado pelo nosso código). */
export class UserError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "UserError";
  }
}

/** Nomes amigáveis dos campos únicos, usados na mensagem "Já existe…". */
const UNIQUE_FIELD_MESSAGES: Record<string, string> = {
  slug: "Já existe uma página com esse endereço (slug) nesta oferta.",
  nameKey: "Já existe um item com esse nome.",
  email: "Já existe uma conta com esse e-mail.",
  name: "Já existe uma variação com esse nome nesta página.",
  pixelId: "Esse pixel já está cadastrado nesta oferta.",
};

/** Nome repetido (nameKey) dito pelo que é: pasta ou tag. */
const NAME_KEY_MESSAGES: Record<string, string> = {
  Folder: "Já existe uma pasta com esse nome.",
  Tag: "Já existe uma tag com esse nome.",
};

interface PrismaLikeError {
  code?: string;
  meta?: {
    target?: string[] | string;
    modelName?: string;
    driverAdapterError?: { cause?: { constraint?: { fields?: string[]; index?: string }; table?: string } };
  };
}

function isPrismaError(err: unknown): err is PrismaLikeError & Error {
  return (
    err instanceof Error &&
    typeof (err as PrismaLikeError).code === "string" &&
    /^P\d{4}$/.test((err as PrismaLikeError).code ?? "")
  );
}

/** Campos envolvidos numa violação de unicidade (formato varia com o driver). */
export function uniqueViolationFields(err: unknown): string[] {
  if (!isPrismaError(err) || err.code !== "P2002") return [];
  const target = err.meta?.target;
  if (Array.isArray(target)) return target;
  if (typeof target === "string") return [target];
  const cause = err.meta?.driverAdapterError?.cause;
  if (cause?.constraint?.fields) return cause.constraint.fields.map((f) => f.replaceAll('"', ""));
  // O adapter do Postgres informa só o nome do índice, no padrão do Prisma
  // "<Tabela>_<campo1>_<campo2>_key" (ex.: "Page_offerId_slug_key").
  const index = cause?.constraint?.index;
  const table = cause?.table ?? err.meta?.modelName;
  if (index && table && index.startsWith(`${table}_`) && index.endsWith("_key")) {
    return index.slice(table.length + 1, -"_key".length).split("_");
  }
  return [];
}

/** Tabela (modelo do Prisma) de uma violação de unicidade, quando o driver informa. */
export function uniqueViolationModel(err: unknown): string | undefined {
  if (!isPrismaError(err) || err.code !== "P2002") return undefined;
  const table = err.meta?.modelName ?? err.meta?.driverAdapterError?.cause?.table;
  return table?.replaceAll('"', "") || undefined;
}

export interface ErrorInfo {
  message: string;
  field?: string;
}

/** Converte qualquer erro em mensagem segura e clara em português. */
export function toUserMessage(err: unknown): ErrorInfo {
  if (err instanceof UserError) return { message: err.message, field: err.field };

  if (err instanceof z.ZodError) {
    const first = err.issues[0];
    return { message: first?.message ?? "Dados inválidos.", field: first?.path.join(".") || undefined };
  }

  if (isPrismaError(err)) {
    switch (err.code) {
      case "P2002": {
        const fields = uniqueViolationFields(err);
        const model = uniqueViolationModel(err);
        const byModel = fields.includes("nameKey") && model ? NAME_KEY_MESSAGES[model] : undefined;
        const known = byModel ?? fields.map((f) => UNIQUE_FIELD_MESSAGES[f]).find(Boolean);
        return { message: known ?? "Esse item já existe.", field: fields.at(-1) };
      }
      case "P2025":
        return { message: "Não encontramos esse item. Ele pode ter sido excluído." };
      case "P2003":
        return { message: "Não foi possível concluir: há itens ligados a este registro." };
      case "P1001":
      case "P1002":
        return { message: "O banco de dados não está respondendo. Feche e abra o Offer Studio de novo." };
      default:
        break;
    }
  }

  return { message: "Algo deu errado. Tente de novo em alguns segundos." };
}
