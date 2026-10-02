/**
 * "Esqueci a senha" (scripts/reset-password.ts): a troca grava o mesmo hash do
 * login, encerra as sessões e não mexe em mais nada.
 */
import { verifyPassword } from "better-auth/crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { listAccounts, passwordProblem, resetPassword } from "../../scripts/lib/reset-password";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });

beforeAll(async () => {
  await db.connect();
});
afterAll(async () => {
  await db.end();
});

describe("passwordProblem", () => {
  it("usa as regras da tela de login, em português", () => {
    expect(passwordProblem("curta", "curta")).toBe("A senha precisa ter pelo menos 8 caracteres.");
    expect(passwordProblem("x".repeat(129), "x".repeat(129))).toBe("A senha pode ter no máximo 128 caracteres.");
    expect(passwordProblem("senha-nova-1", "senha-nova-2")).toBe("As senhas não são iguais.");
    expect(passwordProblem("senha-nova-1", "senha-nova-1")).toBeNull();
  });
});

describe("resetPassword", () => {
  it("troca a senha (o login aceita a nova), encerra as sessões e mantém as ofertas", async () => {
    const user = await prisma.user.create({ data: { id: "u1", name: "Ana", email: "ana@exemplo.com" } });
    await prisma.account.create({
      data: { id: "a1", accountId: user.id, providerId: "credential", userId: user.id, password: "hash-antigo" },
    });
    await prisma.session.create({
      data: { id: "s1", token: "t1", userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    await prisma.offer.create({ data: { name: "Oferta que fica" } });

    expect(await listAccounts(db)).toEqual([{ id: "u1", name: "Ana", email: "ana@exemplo.com" }]);
    await resetPassword(db, user.id, "senha-nova-123");

    const account = await prisma.account.findUniqueOrThrow({ where: { id: "a1" } });
    expect(account.password).not.toBe("hash-antigo");
    expect(await verifyPassword({ hash: account.password ?? "", password: "senha-nova-123" })).toBe(true);
    expect(await verifyPassword({ hash: account.password ?? "", password: "outra" })).toBe(false);
    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.offer.count()).toBe(1);
  });

  it("recusa senha curta e conta sem senha cadastrada", async () => {
    await expect(resetPassword(db, "u1", "curta")).rejects.toThrow("A senha precisa ter pelo menos 8 caracteres.");
    await prisma.account.deleteMany({ where: { userId: "u1" } });
    await expect(resetPassword(db, "u1", "senha-nova-123")).rejects.toThrow("Esta conta não tem senha cadastrada.");
  });
});
