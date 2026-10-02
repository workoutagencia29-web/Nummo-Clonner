/**
 * Utilidades compartilhadas pelos testes unitários/integração.
 */
import { expect } from "vitest";
import { UserError } from "@/lib/errors";

/** Aguarda a promessa e devolve o erro lançado (falha o teste se ela resolver). */
export async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("Esperava que a operação lançasse um erro, mas ela terminou com sucesso.");
}

/** Garante que a promessa falha com um UserError (mensagem em português e campo). */
export async function expectUserError(promise: Promise<unknown>, message: string | RegExp, field?: string) {
  const err = await catchError(promise);
  expect(err).toBeInstanceOf(UserError);
  const userError = err as UserError;
  if (typeof message === "string") expect(userError.message).toBe(message);
  else expect(userError.message).toMatch(message);
  expect(userError.field).toBe(field);
  return userError;
}

/** Garante que a promessa falha com um erro do Prisma com o código indicado. */
export async function expectPrismaError(promise: Promise<unknown>, code: string) {
  const err = await catchError(promise);
  expect(err).toMatchObject({ code });
  return err;
}

/** ID no formato cuid (25 caracteres minúsculos), usado em links internos. */
export function fakeId(seed: string) {
  return `c${seed}`.padEnd(25, "0");
}
