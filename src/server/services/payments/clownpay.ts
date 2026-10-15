/**
 * Adaptador da ClownPay (https://docs.clownpay.com.br/pt-BR/documentacao): só
 * PIX, em real, no checkout do Offer Studio.
 *
 * - Base https://api.clownpay.com.br/v1, cabeçalho "Authorization: Bearer <chave>".
 * - POST /v1/payments (amount em centavos, payment_method "pix", external_reference
 *   = externalOrderId, buyer com nome, CPF/CNPJ, telefone e e-mail — os 4
 *   obrigatórios —, products opcionais e tracking) → 201 com id e pix.emv (o
 *   código "copia e cola"; a ClownPay NÃO devolve imagem do QR, a página gera).
 *   POST exige "Idempotency-Key" (= externalOrderId): repetir nunca cria outra
 *   cobrança.
 * - GET /v1/payments/{id} (estado da cobrança).
 * - GET /v1/payments?limit=1 no "Testar conexão" (nada é criado).
 *
 * Gerar PIX exige KYC aprovado na conta (403 operation_not_allowed/kyc_required
 * até liberar). As consultas funcionam durante a análise.
 *
 * O endereço base só muda por OS_CLOWNPAY_API_BASE, e só para um servidor deste
 * Mac (o servidor falso dos testes, tests/unit/pix-fakes.ts).
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
  strOr,
} from "./http";

export const CLOWNPAY_API_BASE = "https://api.clownpay.com.br";
export const CLOWNPAY_BASE_ENV = "OS_CLOWNPAY_API_BASE";

export function clownpayApiBase(): string {
  return gatewayApiBase(CLOWNPAY_BASE_ENV, CLOWNPAY_API_BASE, "ClownPay");
}

/** Status da ClownPay → status do Offer Studio. */
export function clownpayStatus(v: unknown): PayStatus {
  switch (typeof v === "string" ? v.toLowerCase() : "") {
    case "pending":
    case "processing":
      return "pending";
    case "paid":
      return "paid";
    case "failed":
      return "failed";
    case "canceled":
    case "cancelled":
      return "canceled";
    case "refunded":
      return "refunded";
    case "chargeback":
      return "disputed";
    default:
      throw new PaymentGatewayError("unexpected", typeof v === "string" ? v.slice(0, 40) : null);
  }
}

/** Campos de rastreamento que a ClownPay aceita (repassados às plataformas dela). */
const TRACKING_KEYS = ["src", "sck", "utm_source", "utm_campaign", "utm_medium", "utm_content", "utm_term"] as const;

function headers(apiKey: string, idempotencyKey?: string) {
  const h: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (idempotencyKey) h["Idempotency-Key"] = idempotencyKey;
  return h;
}

function fail(res: GatewayResponse): never {
  const b = isObj(res.body) ? res.body : {};
  const code = strOr(b.error) || strOr(b.code) || null;
  throw new PaymentGatewayError(httpErrorCode(res.status), code ? code.slice(0, 60) : null, res.status);
}

/** Corpo da criação do PIX. */
export function clownpayChargeBody(input: ChargeInput): Record<string, unknown> {
  const c = input.customer;
  const body: Record<string, unknown> = {
    amount: input.amountCents,
    payment_method: "pix",
    external_reference: input.externalOrderId,
    buyer: {
      name: c.name,
      document: (c.document ?? "").replace(/\D+/g, ""),
      phone: (c.phone ?? "").replace(/\D+/g, ""),
      email: c.email,
    },
  };
  if (input.items?.length) {
    body.products = input.items.map((it, i) => ({
      id: `item-${i + 1}`,
      name: it.title.slice(0, 160),
      quantity: it.quantity,
      price_in_cents: it.unitPriceCents,
    }));
  }
  const tracking: Record<string, string> = {};
  for (const k of TRACKING_KEYS) {
    const v = input.metadata?.[k];
    if (v) tracking[k] = v;
  }
  if (Object.keys(tracking).length) body.tracking = tracking;
  if (input.sourceUrl) body.metadata = { site_url: input.sourceUrl };
  return body;
}

/** Resposta da criação → Charge. */
export function parseClownpayCharge(body: unknown, amountCents: number): Charge {
  if (!isObj(body)) throw new PaymentGatewayError("unexpected");
  const pix = isObj(body.pix) ? body.pix : {};
  const copyPaste = pixCodeOf(pix.emv ?? body.emv);
  if (!copyPaste) throw new PaymentGatewayError("unexpected");
  return {
    id: idOf(body.id),
    status: "pending",
    amountCents: body.amount === undefined ? amountCents : centsOf(body.amount),
    currency: "BRL",
    instructions: {
      kind: "pix",
      copyPaste,
      // A ClownPay devolve só o "copia e cola" (sem imagem do QR): a página gera o QR.
      qrImage: null,
      expiresAt: isoDate(body.expires_at),
    },
  };
}

/** Transação consultada → TransactionInfo. */
export function parseClownpayTransaction(body: unknown): TransactionInfo {
  const t = isObj(body) && isObj(body.data) ? body.data : body;
  if (!isObj(t)) throw new PaymentGatewayError("unexpected");
  const status = clownpayStatus(t.status);
  return {
    id: idOf(t.id),
    status,
    amountCents: centsOf(t.amount),
    currency: "BRL",
    method: "pix",
    externalOrderId: strOr(t.external_reference) || null,
    paidAt: status === "paid" ? isoDate(t.paid_at) || isoDate(t.updated_at) : null,
  };
}

export const clownpayGateway: PaymentGatewayAdapter = {
  provider: "CLOWNPAY",
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
    const res = await gatewayFetch(`${clownpayApiBase()}/v1/payments`, {
      method: "POST",
      headers: headers(apiKey, input.externalOrderId),
      body: clownpayChargeBody(input),
    });
    if (!res.ok) fail(res);
    return parseClownpayCharge(res.body, input.amountCents);
  },

  async getTransaction(apiKey, id) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new PaymentGatewayError("not_found");
    const res = await gatewayFetch(`${clownpayApiBase()}/v1/payments/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: headers(apiKey),
    });
    if (!res.ok) fail(res);
    return parseClownpayTransaction(res.body);
  },

  async testConnection(apiKey): Promise<ConnectionStatus> {
    try {
      const res = await gatewayFetch(`${clownpayApiBase()}/v1/payments?limit=1`, {
        method: "GET",
        headers: headers(apiKey),
      });
      if (!res.ok) fail(res);
      return isObj(res.body) ? "ok" : "unexpected";
    } catch (err) {
      return connectionStatusOf(err);
    }
  },
};
