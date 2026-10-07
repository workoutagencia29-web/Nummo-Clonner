/**
 * Endpoint de pagamento da PRÉVIA do app (POST /__os/pagamento em
 * src/preview/server.ts): SEMPRE simulação — nada de cobrança real a partir
 * do app. Responde com os mesmos contratos do pagamento.php do ZIP
 * (src/lib/payments/contract.ts): dados SPEI de exemplo, sessão de cartão
 * simulada e a ação "simular" (aprovado / recusado / expirado), que só existe aqui.
 *
 * Os pedidos simulados ficam na memória do processo da prévia (somem ao
 * fechar o Offer Studio), separados por oferta.
 */
import { randomBytes } from "node:crypto";
import {
  type PayMethod,
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
import { offerPaymentProducts, payMethodOf, type ServerPaymentProduct } from "./products";

interface SimOrder {
  id: string;
  offerId: string;
  productKey: string;
  externalOrderId: string;
  method: PayMethod;
  status: PayStatus;
  amountCents: number;
  currency: ServerPaymentProduct["currency"];
  createdAt: number;
  speiReference: string;
}

const MAX_ORDERS = 1000;
/** Cobranças simuladas por oferta a cada 10 minutos (mesma ideia do limite por IP do pagamento.php). */
export const SIM_CREATE_LIMIT = 60;
const WINDOW_MS = 10 * 60_000;
const SPEI_EXPIRES_MS = 72 * 3600_000;
const CARD_EXPIRES_MS = 30 * 60_000;

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

function statusBody(o: SimOrder): PaymentStatusResponse {
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

export type SimResult =
  | { status: number; body: PaymentCreateResponse | PaymentStatusResponse | PaymentAccessResponse }
  | ReturnType<typeof paymentError>;

const fail = (code: PaymentErrorCode) => paymentError(code);

/** Responde um pedido da página da prévia (corpo já lido como JSON). */
export async function handleSimulatedPayment(offerId: string, raw: unknown, now = Date.now()): Promise<SimResult> {
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
      moeda: order.currency,
      metodo: order.method,
      simulacao: true,
    };
    if (order.method === "spei") {
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
    if (order.productKey !== req.produto) return fail("nao_encontrado");
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
