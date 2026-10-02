import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Login do Offer Studio: e-mail e senha, um único usuário.
 *
 * - O cadastro só é aceito enquanto não existe nenhuma conta (primeiro acesso).
 *   Depois disso, o hook abaixo recusa qualquer tentativa de criar outra.
 * - Sessão de 30 dias, renovada a cada dia de uso.
 * - Limite de tentativas de login: 5 por minuto.
 */
export const auth = betterAuth({
  appName: "Offer Studio",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // O painel responde em localhost e 127.0.0.1 (mesma máquina).
  trustedOrigins: [env.BETTER_AUTH_URL, env.BETTER_AUTH_URL.replace("localhost", "127.0.0.1")],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  user: {
    // Usuário único e local: troca de e-mail sem confirmação por e-mail.
    changeEmail: { enabled: true, updateEmailWithoutVerification: true },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 5 },
      "/change-password": { window: 60, max: 5 },
    },
  },
  // App local: a rota /api/auth fixa o IP em 127.0.0.1, então o limite de
  // tentativas vale para a máquina inteira — o desejado para um usuário só.
  advanced: { cookiePrefix: "offerstudio", ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const existing = await prisma.user.count();
          if (existing > 0) {
            throw new APIError("FORBIDDEN", {
              code: "SINGLE_USER_ONLY",
              message: "Já existe uma conta neste Offer Studio.",
            });
          }
          return { data: user };
        },
      },
    },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
