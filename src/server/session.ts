import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";

/** Sessão atual (uma leitura por requisição, graças ao cache do React). */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/** Exige login: sem sessão, manda para a tela de entrada. */
export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/entrar");
  return session;
}
