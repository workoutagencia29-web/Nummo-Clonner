"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Cliente de autenticação usado nas telas de login e conta. Erros HTTP voltam
 * como { error }; falhas de rede lançam exceção — use `safeAuthCall`.
 */
export const authClient = createAuthClient();

type AuthResult = { error: { code?: string; status?: number; statusText?: string; message?: string } | null };

/** Executa uma chamada do login sem deixar "Failed to fetch" (inglês) chegar à tela. */
export async function safeAuthCall<T extends AuthResult>(call: () => Promise<T>): Promise<T | AuthResult> {
  try {
    return await call();
  } catch {
    return { error: { statusText: "Fetch Error" } };
  }
}
