/**
 * Adaptador da Kyvo (https://kyvopay.com/docs): SPEI (México), cartão
 * internacional, Bizum e MB WAY.
 *
 * - Base https://kyvopay.com/api, "Authorization: Bearer kyvo_live_…".
 * - POST /v1/spei/charges (MXN) e POST /v1/card/charges (USD/EUR/MXN;
 *   onlyMethods ["bizum"] ou ["mb_way"], só EUR), Idempotency-Key =
 *   externalOrderId; GET /v1/transactions/{id}; GET /v1/transactions?limit=1
 *   no "Testar conexão".
 * - Erros { error: { code, message } } viram PaymentGatewayError.
 *
 * O endereço base só muda pela variável OS_KYVO_API_BASE, e só para um
 * servidor neste Mac (127.0.0.1/localhost: o servidor falso dos testes). A
 * chave nunca vai para log nem para mensagem de erro.
 */
import type { PayCurrency, PayStatus } from "@/lib/payments/contract";
import { isAllowedSdkUrl, PAY_STATUSES } from "@/lib/payments/contract";
import {
  type Charge,
  type ChargeInput,
  type ConnectionStatus,
  type GatewayErrorCode,
  type PaymentGatewayAdapter,
  PaymentGatewayError,
  type TransactionInfo,
} from "@/lib/payments/gateway";

export const KYVO_API_BASE = "https://kyvopay.com/api";
const TIMEOUT_MS = 20_000;
const CURRENCIES: readonly PayCurrency[] = ["MXN", "EUR", "USD"];

/** Endereço base da API (OS_KYVO_API_BASE só vale apontando para este Mac). */
export function kyvoApiBase(): string {
  const override = process.env.OS_KYVO_API_BASE?.trim();
  if (override) {
    try {
      const url = new URL(override);
      if (/^https?:$/.test(url.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
        return url.href.replace(/\/+$/, "");
      }
    } catch {
      // inválido: usa a Kyvo de verdade
    }
    console.warn("[pagamentos] OS_KYVO_API_BASE ignorado: só é aceito um endereço deste Mac (testes).");
  }
  return KYVO_API_BASE;
}

/** Endereço do SDK aceito: o da Kyvo, ou o do servidor de testes quando a base é local. */
function sdkAllowed(url: string): boolean {
  if (isAllowedSdkUrl(url)) return true;
  const base = kyvoApiBase();
  return base !== KYVO_API_BASE && url.startsWith(`${new URL(base).origin}/`);
}

interface KyvoErrorBody {
  error?: { code?: unknown; message?: unknown };
}

function errorCodeFor(status: number, code: string | null): GatewayErrorCode {
  if (status === 401 || code === "invalid_api_key" || code === "missing_api_key") return "invalid_key";
  if (status === 403 || code === "missing_scope") return "missing_scope";
  if (status === 402 || code === "payment_declined") return "declined";
  if (status === 409) return "conflict";
  if (status === 404) return "not_found";
  if (status === 429 || status >= 500 || code === "provider_unavailable") return "unavailable";
  if (status >= 400) return "invalid_request";
  return "unexpected";
}

interface KyvoResponse {
  status: number;
  body: unknown;
  replayed: boolean;
}

async function call(
  apiKey: string,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string },
): Promise<KyvoResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`${kyvoApiBase()}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    throw new PaymentGatewayError("network");
  }
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as KyvoErrorBody | null)?.error;
    const code = typeof err?.code === "string" ? err.code : null;
    throw new PaymentGatewayError(errorCodeFor(res.status, code), code, res.status);
  }
  return { status: res.status, body, replayed: res.headers.get("idempotency-replayed") === "true" };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strOr = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

function payStatus(v: unknown): PayStatus {
  if (typeof v === "string" && (PAY_STATUSES as readonly string[]).includes(v)) return v as PayStatus;
  throw new PaymentGatewayError("unexpected", typeof v === "string" ? v.slice(0, 40) : null);
}

function currency(v: unknown): PayCurrency {
  if (typeof v === "string" && (CURRENCIES as readonly string[]).includes(v)) return v as PayCurrency;
  throw new PaymentGatewayError("unexpected");
}

function amount(v: unknown): number {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return v;
  throw new PaymentGatewayError("unexpected");
}

/** Resposta da criação (201, ou 200 repetida pela Idempotency-Key) → Charge. */
export function parseKyvoCharge(body: unknown, replayed = false): Charge {
  if (!isObj(body) || typeof body.id !== "string" || !body.id) throw new PaymentGatewayError("unexpected");
  const instructions = isObj(body.instructions) ? body.instructions : null;
  const base = {
    id: body.id,
    status: payStatus(body.status),
    amountCents: amount(body.amount),
    currency: currency(body.currency),
    ...(replayed ? { replayed: true } : {}),
  };
  if (instructions?.method === "spei" && isObj(instructions.spei)) {
    const s = instructions.spei;
    const clabe = strOr(s.clabe);
    if (!clabe) throw new PaymentGatewayError("unexpected");
    return {
      ...base,
      instructions: {
        kind: "spei",
        clabe,
        bank: strOr(s.bank),
        holder: strOr(s.nominal) || strOr(s.beneficiary),
        reference: strOr(s.reference),
        expiresAt: strOr(s.expires_at) || null,
      },
    };
  }
  if (instructions?.method === "card" && isObj(instructions.card)) {
    const c = instructions.card;
    const sdkUrl = strOr(c.sdk_url);
    if (!sdkAllowed(sdkUrl) || !isObj(c.session)) throw new PaymentGatewayError("unexpected");
    return {
      ...base,
      instructions: { kind: "card", sdkUrl, session: c.session, expiresAt: strOr(c.expires_at) || null },
    };
  }
  throw new PaymentGatewayError("unexpected");
}

/** Transação (GET /v1/transactions/{id}) → TransactionInfo. */
export function parseKyvoTransaction(body: unknown): TransactionInfo {
  if (!isObj(body) || typeof body.id !== "string") throw new PaymentGatewayError("unexpected");
  const method = body.paymentMethod === "spei" || body.paymentMethod === "card" ? body.paymentMethod : null;
  return {
    id: body.id,
    status: payStatus(body.status),
    amountCents: amount(body.amount),
    currency: currency(body.currency),
    method,
    externalOrderId: strOr(body.externalOrderId) || null,
    paidAt: strOr(body.paidAt) || null,
  };
}

function chargeBody(input: ChargeInput): Record<string, unknown> {
  const customer: Record<string, string> = { name: input.customer.name, email: input.customer.email };
  if (input.customer.document) customer.document = input.customer.document;
  const body: Record<string, unknown> = {
    amount: input.amountCents,
    customer,
    externalOrderId: input.externalOrderId,
  };
  if (input.sourceUrl) body.sourceUrl = input.sourceUrl;
  if (input.metadata && Object.keys(input.metadata).length) body.metadata = input.metadata;
  return body;
}

export const kyvoGateway: PaymentGatewayAdapter = {
  provider: "KYVO",
  methods: ["spei", "card", "bizum", "mb_way"],

  async createCharge(apiKey, input) {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
      throw new PaymentGatewayError("invalid_request", "amount");
    }
    const body = chargeBody(input);
    let path: string;
    if (input.method === "spei") {
      if (input.currency !== "MXN") throw new PaymentGatewayError("invalid_request", "currency_not_allowed");
      path = "/v1/spei/charges";
    } else {
      path = "/v1/card/charges";
      body.currency = input.currency;
      if (input.method === "bizum" || input.method === "mb_way") {
        if (input.currency !== "EUR")
          throw new PaymentGatewayError("invalid_request", "only_methods_currency_mismatch");
        body.onlyMethods = [input.method];
      }
    }
    const res = await call(apiKey, path, { method: "POST", body, idempotencyKey: input.externalOrderId });
    return parseKyvoCharge(res.body, res.replayed);
  },

  async getTransaction(apiKey, id) {
    if (!/^[A-Za-z0-9_-]{3,100}$/.test(id)) throw new PaymentGatewayError("not_found");
    const res = await call(apiKey, `/v1/transactions/${encodeURIComponent(id)}`, { method: "GET" });
    return parseKyvoTransaction(res.body);
  },

  async testConnection(apiKey): Promise<ConnectionStatus> {
    try {
      const res = await call(apiKey, "/v1/transactions?limit=1", { method: "GET" });
      return isObj(res.body) && Array.isArray(res.body.data) ? "ok" : "unexpected";
    } catch (err) {
      if (!(err instanceof PaymentGatewayError)) return "unexpected";
      if (err.code === "invalid_key") return "invalid_key";
      if (err.code === "missing_scope") return "missing_scope";
      if (err.code === "network") return "offline";
      if (err.code === "unavailable") return "unavailable";
      return "unexpected";
    }
  },
};
