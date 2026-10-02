/**
 * Criptografia de segredos guardados no banco (tokens da API de Conversões da
 * Meta e da Events API do TikTok). AES-256-GCM com a chave APP_ENCRYPTION_KEY
 * do .env (32 bytes em base64, gerada pelo `npm run setup`).
 *
 * Formato guardado: "v1:" + base64(iv de 12 bytes | tag de 16 bytes | texto cifrado).
 * O prefixo de versão permite trocar o algoritmo no futuro sem perder o que já
 * está salvo. Só roda no servidor: os tokens nunca vão para o navegador nem
 * para o HTML das páginas (só para o eventos.php do ZIP).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { UserError } from "@/lib/errors";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Dado autenticado junto (não é segredo): impede usar o texto cifrado de outro sistema. */
const AAD = Buffer.from("offer-studio:secret:v1");

/** Mensagem para o usuário quando o token salvo não pode ser lido. */
export const SECRET_UNREADABLE_MESSAGE =
  "Não foi possível ler o token salvo (a chave do Offer Studio mudou ou o dado foi alterado). Cole o token de novo.";

function keyFrom(base64Key?: string): Buffer {
  const key = Buffer.from(base64Key ?? env.APP_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) throw new Error("APP_ENCRYPTION_KEY deve ter 32 bytes em base64.");
  return key;
}

/** Criptografa um texto (ex.: token de API). `key` só é passado nos testes. */
export function encryptSecret(plain: string, key?: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(key), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
}

/**
 * Lê um texto criptografado por encryptSecret. Dado alterado, chave diferente
 * ou formato desconhecido → UserError com mensagem em português.
 */
export function decryptSecret(value: string, key?: string): string {
  const [version, payload, ...rest] = value.split(":");
  if (version !== VERSION || !payload || rest.length) throw new UserError(SECRET_UNREADABLE_MESSAGE);
  const raw = Buffer.from(payload, "base64");
  if (raw.length < IV_BYTES + TAG_BYTES || raw.toString("base64") !== payload) {
    throw new UserError(SECRET_UNREADABLE_MESSAGE);
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = raw.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(key), iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    throw new UserError(SECRET_UNREADABLE_MESSAGE);
  }
}

/** Lê sem lançar: null quando não dá para ler (para listas do painel). */
export function tryDecryptSecret(value: string | null | undefined, key?: string): string | null {
  if (!value) return null;
  try {
    return decryptSecret(value, key);
  } catch {
    return null;
  }
}

/** Dica mascarada de um segredo para o painel ("••••••a1b2"): nunca o valor inteiro. */
export function maskSecret(plain: string): string {
  const tail = plain.length >= 12 ? plain.slice(-4) : "";
  return `••••••${tail}`;
}
