/**
 * Troca a senha do acesso do Offer Studio direto no banco (para quem esqueceu).
 * Usado por scripts/reset-password.ts ("Redefinir senha.command" /
 * `npm run redefinir-senha`). A senha é gravada com o mesmo hash do login
 * (Better Auth) e as sessões abertas são encerradas.
 */
import { hashPassword } from "better-auth/crypto";

export interface Queryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

export interface AccountRow {
  id: string;
  name: string;
  email: string;
}

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** Problema da senha nova (as mesmas regras da tela de login), ou null. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN) return `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`;
  if (password.length > PASSWORD_MAX) return `A senha pode ter no máximo ${PASSWORD_MAX} caracteres.`;
  if (password !== confirm) return "As senhas não são iguais.";
  return null;
}

export async function listAccounts(db: Queryable): Promise<AccountRow[]> {
  const { rows } = await db.query(`select id, name, email from "user" order by "createdAt" asc`);
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), email: String(r.email) }));
}

/** Grava a senha nova, encerra as sessões e zera o limite de tentativas de login. */
export async function resetPassword(db: Queryable, userId: string, password: string) {
  const problem = passwordProblem(password, password);
  if (problem) throw new Error(problem);
  const hash = await hashPassword(password);
  const updated = await db.query(
    `update "account" set password = $1, "updatedAt" = now() where "userId" = $2 and "providerId" = 'credential'`,
    [hash, userId],
  );
  if (!updated.rowCount) throw new Error("Esta conta não tem senha cadastrada.");
  await db.query(`delete from "session" where "userId" = $1`, [userId]);
  await db.query(`delete from "rateLimit" where key like '%/sign-in/email%'`);
}
