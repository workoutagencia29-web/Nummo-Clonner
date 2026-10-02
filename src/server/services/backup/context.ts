/**
 * Onde o backup mora: versão do app, pasta pessoal usada pelas pastas sugeridas
 * (Documentos, iCloud Drive), pasta de arquivos do app e impressão digital da
 * chave que protege os tokens dos pixels.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "@/lib/env";

let cachedVersion: string | null = null;

/** Versão do Offer Studio (package.json). */
export function appVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "package.json"), "utf8"),
    ) as { version?: unknown };
    cachedVersion = typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
}

/** Nome do banco do DATABASE_URL ("offerstudio" na instalação de verdade). */
export function databaseName(url = env.DATABASE_URL): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

/**
 * Pasta pessoal onde ficam as pastas sugeridas (Documentos, iCloud Drive).
 *
 * Só a instalação de verdade (banco "offerstudio") usa a pasta pessoal do Mac.
 * Testes, E2E e servidores de rascunho (outros bancos) usam
 * <DATA_DIR>/backup-home, para nunca gravar — nem apagar, na limpeza dos
 * automáticos — backups na pasta Documentos de quem está usando o Mac.
 * OS_BACKUP_HOME troca essa pasta (testes).
 */
export function backupHome(): string {
  const override = process.env.OS_BACKUP_HOME?.trim();
  if (override) return path.resolve(override);
  if (databaseName() === "offerstudio") return os.homedir();
  return path.join(/*turbopackIgnore: true*/ env.dataDir, "backup-home");
}

/** Pasta dos arquivos do app (<DATA_DIR>/storage). */
export function defaultStorageRoot(): string {
  return path.join(/*turbopackIgnore: true*/ env.dataDir, "storage");
}

/** Impressão digital (não secreta) da chave APP_ENCRYPTION_KEY. */
export function keyFingerprint(base64Key: string): string {
  return createHash("sha256").update(Buffer.from(base64Key, "base64")).digest("hex").slice(0, 16);
}

/** Nome do computador para mostrar na lista ("MacBook de Ana"). */
export function computerName(): string | null {
  const name = os
    .hostname()
    .replace(/\.local$/i, "")
    .trim();
  return name || null;
}
