/**
 * Token lacrado do pedido de checkout — a credencial pública na hospedagem SEM
 * PHP (Vercel/Netlify), no lugar do arquivo em pagamento-dados/pedidos/ (lá o
 * disco é efêmero e não vale entre uma chamada e outra).
 *
 * O `pedido` vira "ck_" + base64url(AES-256-GCM(iv || texto || selo)): carrega
 * só o necessário para conferir o pagamento direto no gateway (fonte da
 * verdade). Como é AEAD (autenticado), ninguém FORJA nem TROCA um campo (valor,
 * cobrança, forma) sem o selo falhar, e os campos ficam cifrados. A chave vem
 * de uma HKDF do segredo do ambiente (OS_PAY_SECRET, gerado pela exportação,
 * único por site); sem segredo forte não dá para lacrar nem abrir → a função
 * recusa cobrar (falha fechada, ver serverlessSecret).
 *
 * O id da cobrança no gateway (gid) NUNCA aparece na credencial (a FlevoPay
 * numera em sequência): fica cifrado dentro do token.
 *
 * node:crypto está disponível no runtime Node da Vercel/Netlify (não é Edge).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { CheckoutCurrency, CheckoutPayMethod } from "@/lib/checkout/contract";
import type { ServerlessProvider } from "./config";

/** Nome da variável de ambiente com o segredo que lacra os pedidos. */
export const SERVERLESS_SECRET_ENV = "OS_PAY_SECRET";
/** Tamanho mínimo do segredo (32 bytes = 256 bits). Abaixo disso, falha fechada. */
export const SERVERLESS_SECRET_MIN_BYTES = 32;
/** Prefixo da credencial de checkout (o despachante separa checkout × janela por ele, como o pagamento.php). */
export const CHECKOUT_TOKEN_PREFIX = "ck_";

const SALT = Buffer.from("offerstudio/serverless/pagamento/v1", "utf8");
const INFO = Buffer.from("checkout-token", "utf8");
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Conteúdo do token (campos curtos para o token caber em 512). Tudo o que
 * checkout_status e "acesso" precisam para conferir no gateway e achar o
 * produto no config embutido (o produto vem do código dentro de `x`).
 */
export interface CheckoutToken {
  /** Gateway da cobrança. */
  g: ServerlessProvider;
  /** Id da cobrança no gateway (gid). */
  i: string;
  /** pedidoExterno (externalOrderId): confere a cobrança e carrega o código do produto. */
  x: string;
  /** Valor total em centavos (confere contra o gateway). */
  v: number;
  /** Moeda. */
  m: CheckoutCurrency;
  /** Forma de pagamento. */
  t: CheckoutPayMethod;
  /** Validade da cobrança (ISO) ou null (para o PIX falho/cancelado virar "expirado"). */
  e: string | null;
  /** Fim da janela de acesso (ms desde 1970): depois disso a credencial não libera mais. */
  a: number;
  /** Ids dos bumps comprados (para os `extras` do acesso). */
  b: string[];
}

/**
 * Segredo do ambiente decodificado (>= 32 bytes) ou null (falha fechada). A
 * exportação grava base64 de 32 bytes aleatórios; aceitamos também o texto cru
 * se já tiver 32 bytes. Vazio, curto ou ausente → null.
 */
export function serverlessSecret(raw: string | null | undefined): Buffer | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const b64 = Buffer.from(s, "base64");
  if (b64.length >= SERVERLESS_SECRET_MIN_BYTES) return b64;
  const utf = Buffer.from(s, "utf8");
  return utf.length >= SERVERLESS_SECRET_MIN_BYTES ? utf : null;
}

/** Chave AES de 32 bytes derivada do segredo (HKDF-SHA256, separação de domínio). */
function aesKey(secret: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, SALT, INFO, 32));
}

/** Lacra o pedido num token "ck_…". Algoritmo fixo (sem campo de versão/algoritmo: nada de downgrade). */
export function sealCheckoutToken(secret: Buffer, payload: CheckoutToken): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", aesKey(secret), iv);
  const text = Buffer.from(JSON.stringify(payload), "utf8");
  const ct = Buffer.concat([cipher.update(text), cipher.final()]);
  const tag = cipher.getAuthTag();
  return CHECKOUT_TOKEN_PREFIX + Buffer.concat([iv, ct, tag]).toString("base64url");
}

/** Abre e confere o token (null = não é desta instalação, foi adulterado ou está em formato errado). */
export function openCheckoutToken(secret: Buffer, token: string): CheckoutToken | null {
  if (typeof token !== "string" || !token.startsWith(CHECKOUT_TOKEN_PREFIX)) return null;
  let blob: Buffer;
  try {
    blob = Buffer.from(token.slice(CHECKOUT_TOKEN_PREFIX.length), "base64url");
  } catch {
    return null;
  }
  if (blob.length < IV_LEN + TAG_LEN + 1) return null;
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ct = blob.subarray(IV_LEN, blob.length - TAG_LEN);
  try {
    const decipher = createDecipheriv("aes-256-gcm", aesKey(secret), iv);
    decipher.setAuthTag(tag);
    const text = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(text);
    return isToken(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isToken(p: unknown): p is CheckoutToken {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.g === "string" &&
    typeof o.i === "string" &&
    typeof o.x === "string" &&
    typeof o.v === "number" &&
    typeof o.m === "string" &&
    typeof o.t === "string" &&
    (o.e === null || typeof o.e === "string") &&
    typeof o.a === "number" &&
    Array.isArray(o.b) &&
    o.b.every((x) => typeof x === "string")
  );
}

/** A credencial é de checkout (prefixo ck_)? O despachante usa para separar do pagamento na página (id da Kyvo). */
export function isCheckoutToken(pedido: string): boolean {
  return typeof pedido === "string" && pedido.startsWith(CHECKOUT_TOKEN_PREFIX);
}
