/**
 * Identificador do pedido gerado pelo servidor (externalOrderId na Kyvo,
 * Idempotency-Key da criação e eventID do Purchase — a Kyvo manda o Purchase
 * server-side com event_id = externalOrderId, e a página dispara o dela com o
 * mesmo eventID: as plataformas juntam os dois).
 *
 * Formato: "os_<código do produto>_<20 letras/números aleatórios>". O código do
 * produto é o começo da chave do link (só para ler no painel da Kyvo) mais um
 * resumo do link (id único no app inteiro): a chave do link se repete entre
 * ofertas ("checkout-principal", oferta duplicada) e a chave da Kyvo é uma só
 * para todas — sem o resumo, o pedido pago numa oferta liberaria o acesso do
 * produto de outra. Minúsculas, números e hífen, nunca "_": lendo o
 * externalOrderId devolvido pelo gateway, o servidor sabe de que produto é o
 * pedido (acesso só ao produto pago). O pagamento.php recebe o código pronto
 * de cada produto no config.php.
 */
import { createHash, randomBytes } from "node:crypto";

const RANDOM_LEN = 20;
const CODE_MAX = 32;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

const HASH_LEN = 10;

/**
 * Código do produto no pedido (determinístico pelo link): chave do link
 * cortada + resumo de `linkId:chave`. O linkId (cuid do OfferLink) é único no
 * app inteiro e muda ao duplicar a oferta.
 */
export function orderProductCode(linkKey: string, linkId: string): string {
  const hash = createHash("sha256").update(`${linkId}:${linkKey}`).digest("hex").slice(0, HASH_LEN);
  const slug = linkKey.slice(0, CODE_MAX - HASH_LEN - 1).replace(/-+$/, "") || "p";
  return `${slug}-${hash}`;
}

function randomPart(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  // 252 = 7 × 36: descarta o resto para não favorecer letras.
  for (let i = 0; out.length < len; i++) {
    const b = i < bytes.length ? bytes[i] : randomBytes(1)[0];
    if (b < 252) out += ALPHABET[b % 36];
  }
  return out;
}

/** Pedido novo para o produto (chave e id do link da oferta). */
export function newExternalOrderId(linkKey: string, linkId: string): string {
  return `os_${orderProductCode(linkKey, linkId)}_${randomPart(RANDOM_LEN)}`;
}

const ORDER_RE = /^os_([a-z0-9-]{1,32})_([a-z0-9]{20})$/;

/** Código do produto de um pedido (null = não é um pedido do Offer Studio). */
export function productCodeOfOrder(externalOrderId: string | null | undefined): string | null {
  return ORDER_RE.exec(externalOrderId ?? "")?.[1] ?? null;
}

/** O pedido é deste produto (chave e id do link)? */
export function orderIsForProduct(
  externalOrderId: string | null | undefined,
  linkKey: string,
  linkId: string,
): boolean {
  const code = productCodeOfOrder(externalOrderId);
  return code !== null && code === orderProductCode(linkKey, linkId);
}
