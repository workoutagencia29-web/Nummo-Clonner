/**
 * Segredo que lacra os pedidos do checkout na hospedagem sem PHP (o valor de
 * OS_PAY_SECRET que o usuário cola no painel da Vercel/Netlify).
 *
 * Derivado da APP_ENCRYPTION_KEY do Offer Studio por HKDF com o id da oferta:
 * - ESTÁVEL: a mesma oferta dá sempre o mesmo valor, então reexportar não
 *   obriga a trocar a variável (pedidos em aberto continuam valendo);
 * - ÚNICO por oferta: o token de uma oferta não abre em outra (mesmo
 *   compartilhando a conta do gateway);
 * - FORTE: 32 bytes. Nunca entra em arquivo do ZIP — só é MOSTRADO na tela
 *   (guia de deploy) para o usuário colar no ambiente.
 */
import { hkdfSync } from "node:crypto";
import { env } from "@/lib/env";

export function offerPaySecret(offerId: string): string {
  const master = Buffer.from(env.APP_ENCRYPTION_KEY, "base64");
  const derived = hkdfSync("sha256", master, Buffer.from("offerstudio/pay-secret/v1"), Buffer.from(offerId), 32);
  return Buffer.from(derived).toString("base64");
}
