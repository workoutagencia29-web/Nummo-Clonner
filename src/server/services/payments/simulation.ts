/**
 * Endpoint de pagamento da PRÉVIA do app (POST /__os/pagamento em
 * src/preview/server.ts): SEMPRE simulação — nada de cobrança real a partir
 * do app. Responde com os mesmos contratos do pagamento.php do ZIP
 * (src/lib/payments/contract.ts): dados SPEI de exemplo, sessão de cartão
 * simulada e a ação "simular" (aprovado / recusado / expirado), que só existe aqui.
 *
 * Checkout do Offer Studio (src/lib/checkout/contract.ts): "checkout_criar"
 * confere o pedido com o produto salvo (checkCheckoutOrder: o total sai dos
 * preços salvos) e devolve um PIX de exemplo (código "copia e cola" no
 * formato do PIX, com uma chave que não existe — nenhum banco paga — e sem a
 * imagem: a página gera o QR do código) ou os dados da Kyvo (SPEI/cartão,
 * como acima); "checkout_status" e o "acesso" (link do produto e, em
 * `extras`, os dos bumps comprados).
 *
 * Os pedidos simulados ficam na memória do processo da prévia (somem ao
 * fechar o Offer Studio), separados por oferta.
 */
import { randomBytes } from "node:crypto";
import {
  type CheckoutCreateResponse,
  type CheckoutExtraAccess,
  type CheckoutPayMethod,
  type CheckoutStatusResponse,
  isCheckoutOrderId,
  parseCheckoutRequest,
} from "@/lib/checkout/contract";
import { checkCheckoutOrder } from "@/lib/checkout/orders";
import { checkoutLang } from "@/lib/checkout/texts";
import {
  type PaymentAccessResponse,
  type PaymentCreateResponse,
  type PaymentErrorCode,
  type PaymentStatusResponse,
  type PayStatus,
  parsePaymentRequest,
  paymentError,
} from "@/lib/payments/contract";
import { newExternalOrderId, orderIsForProduct } from "@/lib/payments/orders";
import { methodAllows } from "@/lib/payments/rules";
import { offerCheckoutProducts } from "../checkout/products";
import { offerPaymentProducts, payMethodOf } from "./products";

interface SimOrder {
  id: string;
  offerId: string;
  productKey: string;
  externalOrderId: string;
  method: CheckoutPayMethod;
  status: PayStatus;
  amountCents: number;
  currency: CheckoutCreateResponse["moeda"];
  createdAt: number;
  speiReference: string;
  /** Pedido da página de checkout do Offer Studio (com os bumps comprados). */
  checkout?: { linkId: string; bumps: string[] };
}

const MAX_ORDERS = 1000;
/** Cobranças simuladas por oferta a cada 10 minutos (mesma ideia do limite por IP do pagamento.php). */
export const SIM_CREATE_LIMIT = 60;
const WINDOW_MS = 10 * 60_000;
const SPEI_EXPIRES_MS = 72 * 3600_000;
const CARD_EXPIRES_MS = 30 * 60_000;
/** Validade do PIX de exemplo (os gateways dão de 30 minutos a 1 dia). */
export const SIM_PIX_EXPIRES_MS = 30 * 60_000;

const orders = new Map<string, SimOrder>();
const creations = new Map<string, number[]>();

/** Só para os testes. */
export function resetSimulation() {
  orders.clear();
  creations.clear();
}

function digits(n: number) {
  let out = "";
  for (const b of randomBytes(n)) out += String(b % 10);
  return out;
}

/** CLABE de exemplo (18 algarismos, com o dígito verificador certo). */
export function exampleClabe(): string {
  const base = `646180${digits(11)}`;
  const weights = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (Number(base[i]) * weights[i % 3]) % 10;
  return `${base}${(10 - (sum % 10)) % 10}`;
}

function rateLimited(offerId: string, now: number) {
  const recent = (creations.get(offerId) ?? []).filter((t) => now - t < WINDOW_MS);
  creations.set(offerId, recent);
  if (recent.length >= SIM_CREATE_LIMIT) return true;
  recent.push(now);
  return false;
}

function remember(order: SimOrder) {
  orders.set(order.id, order);
  if (orders.size > MAX_ORDERS) {
    const oldest = orders.keys().next().value;
    if (oldest) orders.delete(oldest);
  }
}

function statusBody(o: SimOrder): CheckoutStatusResponse {
  return {
    ok: true,
    pedido: o.id,
    status: o.status,
    pago: o.status === "paid",
    pedidoExterno: o.externalOrderId,
    valor: o.amountCents,
    moeda: o.currency,
  };
}

/** Resposta do acesso; no checkout, com os links dos bumps comprados e o idioma do produto. */
export type SimAccessResponse = PaymentAccessResponse & {
  extras?: CheckoutExtraAccess[];
  idioma?: "pt" | "es" | "en";
};

export type SimResult =
  | {
      status: number;
      body:
        | PaymentCreateResponse
        | PaymentStatusResponse
        | SimAccessResponse
        | CheckoutCreateResponse
        | CheckoutStatusResponse;
    }
  | ReturnType<typeof paymentError>;

const fail = (code: PaymentErrorCode) => paymentError(code);

/** Campo do PIX "copia e cola" (id + tamanho com 2 algarismos + valor). */
function emv(id: string, value: string) {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

/** CRC16-CCITT (0x1021, começo 0xFFFF): o verificador do fim do código PIX. */
function crc16(text: string) {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Código PIX "copia e cola" de EXEMPLO: o formato de verdade (o app do banco
 * lê), mas com uma chave que não existe (domínio .invalid) — nenhum banco
 * consegue pagar. Só para a prévia.
 */
export function simulatedPixCode(amountCents: number, txid: string) {
  const account = emv("00", "br.gov.bcb.pix") + emv("01", "simulacao@offerstudio.invalid");
  const body =
    emv("00", "01") +
    emv("26", account) +
    emv("52", "0000") +
    emv("53", "986") +
    emv("54", (amountCents / 100).toFixed(2)) +
    emv("58", "BR") +
    emv("59", "SIMULACAO OFFER STUDIO") +
    emv("60", "SAO PAULO") +
    emv("62", emv("05", txid.replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "SIMULACAO"));
  const withCrc = `${body}6304`;
  return withCrc + crc16(withCrc);
}

const KYVO_METHOD: Record<string, "spei" | "card" | "bizum" | "mb_way"> = {
  spei: "spei",
  card: "card",
  bizum: "bizum",
  mb_way: "mb_way",
};

/** Pedido da página de checkout (checkout_criar / checkout_status). */
async function handleCheckout(offerId: string, raw: unknown, now: number): Promise<SimResult> {
  const req = parseCheckoutRequest(raw);
  if (!req) return fail("invalido");
  if (req.acao === "checkout_status") {
    const order = orders.get(req.pedido);
    if (!order || order.offerId !== offerId || !order.checkout || order.productKey !== req.checkout) {
      return fail("nao_encontrado");
    }
    // A hora do servidor: a página conta a validade do PIX por ela (o relógio do aparelho pode estar errado).
    return { status: 200, body: { ...statusBody(order), agora: now } };
  }
  const product = (await offerCheckoutProducts(offerId)).find((p) => p.key === req.checkout);
  if (!product) return fail("produto_desconhecido");
  const check = checkCheckoutOrder(req, product);
  if (!check.ok) return fail(check.erro);
  if (rateLimited(offerId, now)) return fail("limite");
  const order: SimOrder = {
    id: `sim_${randomBytes(9).toString("hex")}`,
    offerId,
    productKey: product.key,
    externalOrderId: newExternalOrderId(product.key, product.linkId),
    method: req.metodo,
    status: "pending",
    amountCents: check.total.total,
    currency: product.currency,
    createdAt: now,
    speiReference: digits(7),
    checkout: { linkId: product.linkId, bumps: check.total.bumps },
  };
  remember(order);
  const body: CheckoutCreateResponse = {
    ok: true,
    pedido: order.id,
    pedidoExterno: order.externalOrderId,
    status: "pending",
    valor: order.amountCents,
    moeda: order.currency,
    metodo: order.method,
    simulacao: true,
    agora: now,
  };
  if (req.metodo === "pix") {
    body.pix = {
      codigo: simulatedPixCode(order.amountCents, order.id),
      imagem: null,
      expiraEm: new Date(now + SIM_PIX_EXPIRES_MS).toISOString(),
    };
  } else if (KYVO_METHOD[req.metodo] === "spei") {
    body.spei = {
      clabe: exampleClabe(),
      banco: "STP (simulación)",
      titular: "SIMULACIÓN — NO TRANSFERIR",
      referencia: order.speiReference,
      expiraEm: new Date(now + SPEI_EXPIRES_MS).toISOString(),
    };
  } else {
    body.cartao = {
      sdkUrl: "",
      sessao: { simulacao: true, transaction_id: order.id },
      expiraEm: new Date(now + CARD_EXPIRES_MS).toISOString(),
    };
  }
  return { status: 201, body };
}

/** Acesso de um pedido pago da página de checkout: o do produto e os dos bumps comprados. */
async function checkoutAccess(offerId: string, order: SimOrder): Promise<SimResult> {
  const product = (await offerCheckoutProducts(offerId)).find((p) =>
    orderIsForProduct(order.externalOrderId, p.key, p.linkId),
  );
  if (!product) return fail("nao_encontrado");
  if (!product.accessUrl) return fail("configuracao");
  const bought = order.checkout?.bumps ?? [];
  const extras: CheckoutExtraAccess[] = product.config.bumps
    .filter((b) => bought.includes(b.id) && b.accessUrl)
    .map((b) => ({ titulo: b.title, acesso: b.accessUrl }));
  return {
    status: 200,
    body: {
      ok: true,
      pedido: order.id,
      status: "paid",
      acesso: product.accessUrl,
      produto: product.key,
      extras,
      idioma: checkoutLang(product.locale),
    },
  };
}

/** Responde um pedido da página da prévia (corpo já lido como JSON). */
export async function handleSimulatedPayment(offerId: string, raw: unknown, now = Date.now()): Promise<SimResult> {
  const acao = raw && typeof raw === "object" ? (raw as { acao?: unknown }).acao : null;
  if (acao === "checkout_criar" || acao === "checkout_status") return handleCheckout(offerId, raw, now);
  const req = parsePaymentRequest(raw);
  if (!req) return fail("invalido");

  if (req.acao === "criar") {
    const product = (await offerPaymentProducts(offerId)).find((p) => p.key === req.produto);
    if (!product) return fail("produto_desconhecido");
    const allowed = product.methods.filter((m) => methodAllows(m, product.currency)).map(payMethodOf);
    if (!allowed.includes(req.metodo)) return fail("metodo_indisponivel");
    if (rateLimited(offerId, now)) return fail("limite");
    const order: SimOrder = {
      id: `sim_${randomBytes(9).toString("hex")}`,
      offerId,
      productKey: product.key,
      externalOrderId: newExternalOrderId(product.key, product.linkId),
      method: req.metodo,
      status: "pending",
      amountCents: product.amountCents,
      currency: product.currency,
      createdAt: now,
      speiReference: digits(7),
    };
    remember(order);
    const body: PaymentCreateResponse = {
      ok: true,
      pedido: order.id,
      pedidoExterno: order.externalOrderId,
      status: "pending",
      valor: order.amountCents,
      moeda: product.currency,
      metodo: req.metodo,
      simulacao: true,
    };
    if (req.metodo === "spei") {
      body.spei = {
        clabe: exampleClabe(),
        banco: "STP (simulación)",
        titular: "SIMULACIÓN — NO TRANSFERIR",
        referencia: order.speiReference,
        expiraEm: new Date(now + SPEI_EXPIRES_MS).toISOString(),
      };
    } else {
      body.cartao = {
        sdkUrl: "",
        sessao: { simulacao: true, transaction_id: order.id },
        expiraEm: new Date(now + CARD_EXPIRES_MS).toISOString(),
      };
    }
    return { status: 201, body };
  }

  const order = orders.get(req.pedido);
  if (!order || order.offerId !== offerId) return fail("nao_encontrado");

  if (req.acao === "status") {
    if (order.checkout || order.productKey !== req.produto) return fail("nao_encontrado");
    return { status: 200, body: statusBody(order) };
  }

  if (req.acao === "simular") {
    order.status = req.resultado === "pago" ? "paid" : req.resultado === "expirado" ? "expired" : "failed";
    return { status: 200, body: statusBody(order) };
  }

  // acesso: o produto vem do pedido (pedidoExterno gerado aqui), nunca do navegador.
  if (req.produto && req.produto !== order.productKey) return fail("nao_encontrado");
  if (order.status === "pending") return fail("pendente");
  if (order.status !== "paid") return fail("nao_pago");
  // Pedido do checkout: a credencial é o id aleatório da cobrança (nunca um número sequencial).
  if (order.checkout) return isCheckoutOrderId(req.pedido) ? checkoutAccess(offerId, order) : fail("nao_encontrado");
  const product = (await offerPaymentProducts(offerId)).find((p) =>
    orderIsForProduct(order.externalOrderId, p.key, p.linkId),
  );
  if (!product) return fail("nao_encontrado");
  if (!product.accessUrl) return fail("configuracao");
  return {
    status: 200,
    body: { ok: true, pedido: order.id, status: "paid", acesso: product.accessUrl, produto: product.key },
  };
}
