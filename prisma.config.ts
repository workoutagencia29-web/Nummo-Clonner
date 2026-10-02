import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Vazio é aceito: `prisma generate` (no npm install) não precisa de banco.
    // Os scripts sempre passam DATABASE_URL para as migrations.
    url: process.env.DATABASE_URL ?? "",
  },
});
