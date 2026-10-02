import path from "node:path";
import { z } from "zod";

/**
 * Variáveis de ambiente do servidor, validadas uma vez na inicialização.
 * O .env é criado automaticamente por `npm run setup`.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url("DATABASE_URL inválida"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET precisa ter 32+ caracteres"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  APP_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "APP_ENCRYPTION_KEY deve ter 32 bytes em base64"),
  DATA_DIR: z.string().default("./data"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Configuração inválida no .env:\n${issues}\nRode "npm run setup" para gerar um .env novo.`);
}

export const env = {
  ...parsed.data,
  /** Caminho absoluto da pasta de dados (banco, arquivos, backups). */
  // O caminho só é conhecido em tempo de execução; não precisa ser rastreado no build.
  dataDir: path.resolve(/*turbopackIgnore: true*/ process.cwd(), parsed.data.DATA_DIR),
};
