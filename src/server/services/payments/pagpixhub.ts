/**
 * Adaptador do PagPixHub (https://pagpixhub.com/docs): só PIX, em real, no
 * checkout do Offer Studio.
 *
 * - Base https://pagpixhub.com/api/v1, cabeçalho "Authorization: Bearer <chave>"
 *   (as chaves começam com bp_live_…).
 * - POST /transactions (amount_cents em centavos — mínimo 500 —, method "pix",
 *   external_reference = externalOrderId, customer com nome, e-mail, CPF e
 *   telefone) → 200 com id e pix.copy_paste (o "copia e cola"; o PagPixHub NÃO
 *   devolve imagem do QR, a página gera). "Idempotency-Key" (= externalOrderId):
 *   repetir nunca cria outra cobrança.
 *   Quando o código ainda está sendo gerado, a resposta vem 202 com
 *   pix.copy_paste null e pix_status "generating": NÃO recria — consulta
 *   GET /transactions/{id} até o código ficar pronto (os_pix_create do
 *   pagamento.php faz o mesmo).
 * - GET /transactions/{id} (estado da cobrança; status em MAIÚSCULAS).
 * - GET /me no "Testar conexão" (nada é criado).
 *
 * O endereço base só muda por OS_PAGPIXHUB_API_BASE, e só para um servidor
 * deste Mac (o servidor falso dos testes, tests/unit/pix-fakes.ts).
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

export const PAGPIXHUB_API_BASE = "https://pagpixhub.com/api/v1";
export const PAGPIXHUB_BASE_ENV = "OS_PAGPIXHUB_API_BASE";

export function pagpixhubApiBase(): string {
  return gatewayApiBase(PAGPIXHUB_BASE_ENV, PAGPIXHUB_API_BASE, "PagPixHub");
}

/** Status do PagPixHub (MAIÚSCULAS) → status do Offer Studio. */
export function pagpixhubStatus(v: unknown): PayStatus {
  switch (typeof v === "string" ? v.toUpperCase() : "") {
    case "PENDING":
      return "pending";
    case "PAID":
      return "paid";
    case "EXPIRED":
      return "expired";
    case "FAILED":
      return "failed";
    case "REFUNDED":
      return "refunded";
    case "CHARGEBACK":
      return "disputed";
    default:
      throw new PaymentGatewayError("unexpected", typeof v === "string" ? v.slice(0, 40) : null);
  }
}

function headers(apiKey: string, idempotencyKey?: string) {
  const h: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (idempotencyKey) h["Idempotency-Key"] = idempotencyKey;
  return h;
}

function fail(res: GatewayResponse): never {
  const b = isObj(res.body) ? res.body : {};
  const err = isObj(b.error) ? b.error : {};
  const code = strOr(err.code) || strOr(b.code) || null;
  throw new PaymentGatewayError(httpErrorCode(res.status), code ? code.slice(0, 60) : null, res.status);
}

/** UTM do metadata do Offer Studio → objeto `utm` do PagPixHub. */
const UTM_MAP: [string, string][] = [
  ["utm_source", "source"],
  ["utm_medium", "medium"],
  ["utm_campaign", "campaign"],
  ["utm_content", "content"],
  ["utm_term", "term"],
  ["ttclid", "ttclid"],
];

/** Corpo da criação do PIX. */
export function pagpixhubChargeBody(input: ChargeInput): Record<string, unknown> {
  const c = input.customer;
  const body: Record<string, unknown> = {
    amount_cents: input.amountCents,
    method: "pix",
    external_reference: input.externalOrderId,
    customer: {
      name: c.name,
      email: c.email,
      cpf: (c.document ?? "").replace(/\D+/g, ""),
      phone: (c.phone ?? "").replace(/\D+/g, ""),
    },
  };
  if (input.description) body.description = input.description.slice(0, 300);
  const utm: Record<string, string> = {};
  for (const [from, to] of UTM_MAP) {
    const v = input.metadata?.[from];
    if (v) utm[to] = v;
  }
  if (Object.keys(utm).length) body.utm = utm;
  const meta: Record<string, string> = {};
  if (input.metadata) {
    for (const k of Object.keys(input.metadata)) {
      const v = input.metadata[k];
      if (v) meta[k] = v;
    }
  }
  if (input.sourceUrl) meta.site_url = input.sourceUrl;
  if (Object.keys(meta).length) body.metadata = meta;
  return body;
}

/** Transação do PagPixHub → Charge (precisa do copia-e-cola pronto). */
function chargeFrom(t: Record<string, unknown>, copyPaste: string, amountCents: number): Charge {
  const pix = isObj(t.pix) ? t.pix : {};
  return {
    id: idOf(t.id),
    status: pagpixhubStatus(t.status),
    amountCents: t.amount_cents === undefined ? amountCents : centsOf(t.amount_cents),
    currency: "BRL",
    instructions: {
      kind: "pix",
      copyPaste,
      // O PagPixHub devolve só o "copia e cola" (sem imagem do QR): a página gera o QR.
      qrImage: null,
      expiresAt: isoDate(pix.expires_at),
    },
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Consulta a cobrança até o copia-e-cola ficar pronto (código gerado de forma assíncrona). */
async function waitForCode(apiKey: string, id: string, amountCents: number): Promise<Charge> {
  for (let i = 0; i < 6; i++) {
    await sleep(i === 0 ? 500 : 800);
    const res = await gatewayFetch(`${pagpixhubApiBase()}/transactions/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: headers(apiKey),
    });
    if (!res.ok) {
      if (res.status === 404) continue;
      fail(res);
    }
    const t = isObj(res.body) ? res.body : {};
    const pix = isObj(t.pix) ? t.pix : {};
    const code = pixCodeOf(pix.copy_paste);
    if (code) return chargeFrom(t, code, amountCents);
    const ps = strOr(t.pix_status).toLowerCase();
    if (ps === "failed" || ps === "expired") throw new PaymentGatewayError("unavailable", `pix_${ps}`);
  }
  throw new PaymentGatewayError("unavailable", "pix_generating_timeout");
}

/** Transação consultada → TransactionInfo. */
export function parsePagpixhubTransaction(body: unknown): TransactionInfo {
  if (!isObj(body)) throw new PaymentGatewayError("unexpected");
  const status = pagpixhubStatus(body.status);
  return {
    id: idOf(body.id),
    status,
    amountCents: centsOf(body.amount_cents),
    currency: "BRL",
    method: "pix",
    externalOrderId: strOr(body.external_reference) || null,
    paidAt: status === "paid" ? isoDate(body.paid_at) || isoDate(body.created_at) : null,
  };
}

export const pagpixhubGateway: PaymentGatewayAdapter = {
  provider: "PAGPIXHUB",
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
    const res = await gatewayFetch(`${pagpixhubApiBase()}/transactions`, {
      method: "POST",
      headers: headers(apiKey, input.externalOrderId),
      body: pagpixhubChargeBody(input),
    });
    if (!res.ok) fail(res);
    const t = isObj(res.body) ? res.body : {};
    const pix = isObj(t.pix) ? t.pix : {};
    const code = pixCodeOf(pix.copy_paste);
    if (code) return chargeFrom(t, code, input.amountCents);
    // 202: o código ainda está sendo gerado — consulta a cobrança (NUNCA recria).
    return waitForCode(apiKey, idOf(t.id), input.amountCents);
  },

  async getTransaction(apiKey, id) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new PaymentGatewayError("not_found");
    const res = await gatewayFetch(`${pagpixhubApiBase()}/transactions/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: headers(apiKey),
    });
    if (!res.ok) fail(res);
    return parsePagpixhubTransaction(res.body);
  },

  async testConnection(apiKey): Promise<ConnectionStatus> {
    try {
      const res = await gatewayFetch(`${pagpixhubApiBase()}/me`, { method: "GET", headers: headers(apiKey) });
      if (!res.ok) fail(res);
      return isObj(res.body) ? "ok" : "unexpected";
    } catch (err) {
      return connectionStatusOf(err);
    }
  },
};
