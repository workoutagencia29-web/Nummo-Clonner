/**
 * Adaptador da FlevoPay (https://app.flevopag.com/documentation): só PIX, em
 * real, no checkout do Offer Studio.
 *
 * - Base https://pagamento-processador.org.ua, cabeçalho "X-API-Key: <chave>".
 * - POST /api/v1/transaction (amount em centavos, description, reference =
 *   externalOrderId, source "api_externa", customer com nome, e-mail, CPF e
 *   telefone — os 4 obrigatórios —, address e tracking opcionais) → QR Code e
 *   código copia e cola. Os bumps NÃO vão como "orderbump" (são ofertas
 *   cadastradas na FlevoPay): eles entram no `amount`.
 * - GET /api/v1/query?action=get_transaction&id=<id> (status do pedido).
 * - GET /api/v1/seller no "Testar conexão" (nada é criado).
 *
 * O endereço base só muda por OS_FLEVOPAY_API_BASE, e só para um servidor
 * deste Mac (o servidor falso dos testes, tests/unit/flevopay-fake.ts).
 */
import type { PayStatus } from "@/lib/payments/contract";
import {
  type Charge,
  type ChargeInput,
  type ConnectionStatus,
  type PaymentGatewayAdapter,
  PaymentGatewayError,
  type TransactionInfo,
} from "@/lib/payments/gateway";
import {
  centsOf,
  connectionStatusOf,
  type GatewayResponse,
  gatewayApiBase,
  gatewayFetch,
  httpErrorCode,
  idOf,
  isObj,
  isoDate,
  pixCodeOf,
  qrImageOf,
  strOr,
} from "./http";

export const FLEVOPAY_API_BASE = "https://pagamento-processador.org.ua";
export const FLEVOPAY_BASE_ENV = "OS_FLEVOPAY_API_BASE";

export function flevopayApiBase(): string {
  return gatewayApiBase(FLEVOPAY_BASE_ENV, FLEVOPAY_API_BASE, "FlevoPay");
}

/** Status da FlevoPay → status do Offer Studio. */
export function flevopayStatus(v: unknown): PayStatus {
  switch (typeof v === "string" ? v.toLowerCase() : "") {
    case "pending":
    case "processing":
    case "under_review":
      return "pending";
    case "approved":
    case "paid":
      return "paid";
    case "failed":
      return "failed";
    case "refunded":
      return "refunded";
    case "chargeback":
      return "disputed";
    default:
      throw new PaymentGatewayError("unexpected", typeof v === "string" ? v.slice(0, 40) : null);
  }
}

/** Campos de rastreamento que a FlevoPay aceita (repassados às plataformas dela). */
const TRACKING_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "src", "sck"] as const;

function headers(apiKey: string) {
  return { "X-API-Key": apiKey };
}

function fail(res: GatewayResponse): never {
  const b = isObj(res.body) ? res.body : {};
  const code = strOr(b.error) || strOr(b.code) || null;
  throw new PaymentGatewayError(httpErrorCode(res.status), code ? code.slice(0, 60) : null, res.status);
}

/** Corpo da criação do PIX. */
export function flevopayChargeBody(input: ChargeInput): Record<string, unknown> {
  const c = input.customer;
  const customer = {
    name: c.name,
    email: c.email,
    document: (c.document ?? "").replace(/\D+/g, ""),
    phone: (c.phone ?? "").replace(/\D+/g, ""),
  };
  const body: Record<string, unknown> = {
    amount: input.amountCents,
    description: (input.description || "Pedido").slice(0, 120),
    reference: input.externalOrderId,
    source: "api_externa",
    customer,
  };
  if (c.address) {
    body.address = {
      street: c.address.street,
      number: c.address.number,
      complement: c.address.complement,
      neighborhood: c.address.neighborhood,
      city: c.address.city,
      state: c.address.state,
      zipcode: c.address.zipCode,
    };
  }
  const tracking: Record<string, string> = {};
  for (const k of TRACKING_KEYS) {
    const v = input.metadata?.[k];
    if (v) tracking[k] = v;
  }
  if (Object.keys(tracking).length) body.tracking = tracking;
  if (input.postbackUrl) body.postback_url = input.postbackUrl;
  return body;
}

/** Resposta da criação → Charge. */
export function parseFlevopayCharge(body: unknown, amountCents: number): Charge {
  if (!isObj(body) || (body.status !== undefined && body.status !== "success")) {
    throw new PaymentGatewayError("invalid_request", isObj(body) ? strOr(body.status).slice(0, 40) || null : null);
  }
  const copyPaste = pixCodeOf(body.qr_code);
  if (!copyPaste) throw new PaymentGatewayError("unexpected");
  return {
    id: idOf(body.transaction_id),
    status: "pending",
    amountCents: body.amount === undefined ? amountCents : centsOf(body.amount),
    currency: "BRL",
    instructions: {
      kind: "pix",
      copyPaste,
      qrImage: qrImageOf(body.qr_code_base64),
      expiresAt: isoDate(body.expires_at),
    },
  };
}

/** Transação consultada → TransactionInfo. */
export function parseFlevopayTransaction(body: unknown): TransactionInfo {
  const t = isObj(body) && isObj(body.data) ? body.data : body;
  if (!isObj(t)) throw new PaymentGatewayError("unexpected");
  const status = flevopayStatus(t.status);
  return {
    id: idOf(t.id),
    status,
    amountCents: centsOf(t.amount),
    currency: "BRL",
    method: "pix",
    externalOrderId: strOr(t.external_id) || strOr(t.reference) || null,
    paidAt: status === "paid" ? isoDate(t.paid_at) || isoDate(t.updated_at) : null,
  };
}

export const flevopayGateway: PaymentGatewayAdapter = {
  provider: "FLEVOPAY",
  methods: ["pix"],

  async createCharge(apiKey, input) {
    if (input.method !== "pix" || input.currency !== "BRL") {
      throw new PaymentGatewayError("invalid_request", "only_pix_brl");
    }
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
      throw new PaymentGatewayError("invalid_request", "amount");
    }
    const c = input.customer;
    if (!c.name || !c.email || !c.document || !c.phone) throw new PaymentGatewayError("invalid_request", "customer");
    const res = await gatewayFetch(`${flevopayApiBase()}/api/v1/transaction`, {
      method: "POST",
      headers: headers(apiKey),
      body: flevopayChargeBody(input),
    });
    if (!res.ok) fail(res);
    return parseFlevopayCharge(res.body, input.amountCents);
  },

  async getTransaction(apiKey, id) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new PaymentGatewayError("not_found");
    const res = await gatewayFetch(
      `${flevopayApiBase()}/api/v1/query?action=get_transaction&id=${encodeURIComponent(id)}`,
      { method: "GET", headers: headers(apiKey) },
    );
    if (!res.ok) fail(res);
    return parseFlevopayTransaction(res.body);
  },

  async testConnection(apiKey): Promise<ConnectionStatus> {
    try {
      const res = await gatewayFetch(`${flevopayApiBase()}/api/v1/seller`, { method: "GET", headers: headers(apiKey) });
      if (!res.ok) fail(res);
      const b = isObj(res.body) && isObj(res.body.data) ? res.body.data : res.body;
      return isObj(b) && (typeof b.name === "string" || typeof b.email === "string") ? "ok" : "unexpected";
    } catch (err) {
      return connectionStatusOf(err);
    }
  },
};
