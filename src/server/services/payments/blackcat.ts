/**
 * Adaptador da BlackCat (https://docs.blackcatoficial.com): só PIX, em real,
 * no checkout do Offer Studio. Cartão NÃO: os dados do cartão passariam pelo
 * servidor da hospedagem do usuário (o pagamento.php), o que traria o escopo
 * de segurança de cartões (PCI) para a hospedagem dele.
 *
 * - Base https://api.blackcatoficial.com/api, cabeçalho "X-API-Key: <chave>".
 * - POST /sales/create-sale (amount = soma dos itens em centavos, items com o
 *   produto, os bumps e o frete, customer com nome, e-mail, telefone e CPF —
 *   os 4 obrigatórios —, shipping quando algum item é físico, externalRef =
 *   externalOrderId) → paymentData com o QR Code e o copia e cola.
 * - GET /sales/{id}/status (status do pedido).
 * - GET /sales/seller no "Testar conexão" (403 = conta ainda não aprovada).
 *
 * O endereço base só muda por OS_BLACKCAT_API_BASE, e só para um servidor
 * deste Mac (o servidor falso dos testes, tests/unit/blackcat-fake.ts).
 */
import type { PayStatus } from "@/lib/payments/contract";
import {
  type Charge,
  type ChargeInput,
  type ChargeItem,
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

export const BLACKCAT_API_BASE = "https://api.blackcatoficial.com/api";
export const BLACKCAT_BASE_ENV = "OS_BLACKCAT_API_BASE";

export function blackcatApiBase(): string {
  return gatewayApiBase(BLACKCAT_BASE_ENV, BLACKCAT_API_BASE, "BlackCat");
}

/** Status da BlackCat → status do Offer Studio (CANCELLED = cancelada ou expirada). */
export function blackcatStatus(v: unknown): PayStatus {
  switch (typeof v === "string" ? v.toUpperCase() : "") {
    case "PENDING":
    case "PENDING_3DS":
    case "WAITING_PAYMENT":
      return "pending";
    case "PAID":
    case "APPROVED":
      return "paid";
    case "CANCELLED":
    case "CANCELED":
      return "canceled";
    case "EXPIRED":
      return "expired";
    case "FAILED":
    case "REFUSED":
      return "failed";
    case "REFUNDED":
      return "refunded";
    case "CHARGEBACK":
      return "disputed";
    default:
      throw new PaymentGatewayError("unexpected", typeof v === "string" ? v.slice(0, 40) : null);
  }
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

function headers(apiKey: string) {
  return { "X-API-Key": apiKey };
}

function fail(res: GatewayResponse): never {
  const b = isObj(res.body) ? res.body : {};
  const code = strOr(b.error) || strOr(b.code) || null;
  throw new PaymentGatewayError(httpErrorCode(res.status), code ? code.slice(0, 60) : null, res.status);
}

/** Itens da venda: os mandados, ou um item só com o valor todo. A soma tem de dar o `amount`. */
function itemsOf(input: ChargeInput): ChargeItem[] {
  const items = input.items?.length
    ? input.items
    : [{ title: input.description || "Pedido", unitPriceCents: input.amountCents, quantity: 1, tangible: false }];
  const sum = items.reduce((n, i) => n + i.unitPriceCents * i.quantity, 0);
  if (sum !== input.amountCents) throw new PaymentGatewayError("invalid_request", "items_sum");
  return items;
}

/** Corpo da criação da venda PIX. */
export function blackcatChargeBody(input: ChargeInput): Record<string, unknown> {
  const c = input.customer;
  const document = (c.document ?? "").replace(/\D+/g, "");
  const items = itemsOf(input);
  const body: Record<string, unknown> = {
    amount: input.amountCents,
    currency: "BRL",
    paymentMethod: "pix",
    items: items.map((i) => ({
      title: i.title.slice(0, 120),
      unitPrice: i.unitPriceCents,
      quantity: i.quantity,
      tangible: i.tangible,
    })),
    customer: {
      name: c.name,
      email: c.email,
      phone: (c.phone ?? "").replace(/\D+/g, ""),
      document: { number: document, type: document.length === 14 ? "cnpj" : "cpf" },
    },
    pix: { expiresInDays: 1 },
    externalRef: input.externalOrderId,
  };
  if (items.some((i) => i.tangible)) {
    if (!c.address) throw new PaymentGatewayError("invalid_request", "shipping");
    body.shipping = {
      name: c.name,
      street: c.address.street,
      number: c.address.number,
      complement: c.address.complement,
      neighborhood: c.address.neighborhood,
      city: c.address.city,
      state: c.address.state,
      zipCode: c.address.zipCode,
    };
  }
  for (const k of UTM_KEYS) {
    const v = input.metadata?.[k];
    if (v) body[k] = v;
  }
  const extra: Record<string, string> = {};
  for (const k of ["src", "sck", "os_versao"]) {
    const v = input.metadata?.[k];
    if (v) extra[k] = v;
  }
  if (Object.keys(extra).length) body.metadata = JSON.stringify(extra);
  if (input.postbackUrl) body.postbackUrl = input.postbackUrl;
  return body;
}

/** Resposta da criação (201) → Charge. */
export function parseBlackcatCharge(body: unknown): Charge {
  if (!isObj(body) || body.success === false) {
    throw new PaymentGatewayError("invalid_request", isObj(body) ? strOr(body.error).slice(0, 60) || null : null);
  }
  const d = isObj(body.data) ? body.data : null;
  const pay = d && isObj(d.paymentData) ? d.paymentData : null;
  if (!d || !pay) throw new PaymentGatewayError("unexpected");
  const copyPaste = pixCodeOf(pay.copyPaste) ?? pixCodeOf(pay.qrCode);
  if (!copyPaste) throw new PaymentGatewayError("unexpected");
  return {
    id: idOf(d.transactionId),
    status: blackcatStatus(d.status ?? "PENDING"),
    amountCents: centsOf(d.amount),
    currency: "BRL",
    instructions: {
      kind: "pix",
      copyPaste,
      qrImage: qrImageOf(pay.qrCodeBase64),
      expiresAt: isoDate(pay.expiresAt),
    },
  };
}

/** Status consultado → TransactionInfo. */
export function parseBlackcatTransaction(body: unknown): TransactionInfo {
  const d = isObj(body) && isObj(body.data) ? body.data : null;
  if (!d || (isObj(body) && body.success === false)) throw new PaymentGatewayError("unexpected");
  const status = blackcatStatus(d.status);
  return {
    id: idOf(d.transactionId),
    status,
    amountCents: centsOf(d.amount),
    currency: "BRL",
    method: "pix",
    externalOrderId: strOr(d.externalRef) || strOr(d.externalReference) || null,
    paidAt: status === "paid" ? isoDate(d.paidAt) : null,
  };
}

export const blackcatGateway: PaymentGatewayAdapter = {
  provider: "BLACKCAT",
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
    const res = await gatewayFetch(`${blackcatApiBase()}/sales/create-sale`, {
      method: "POST",
      headers: headers(apiKey),
      body: blackcatChargeBody(input),
    });
    if (!res.ok) fail(res);
    return parseBlackcatCharge(res.body);
  },

  async getTransaction(apiKey, id) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new PaymentGatewayError("not_found");
    const res = await gatewayFetch(`${blackcatApiBase()}/sales/${encodeURIComponent(id)}/status`, {
      method: "GET",
      headers: headers(apiKey),
    });
    if (!res.ok) fail(res);
    return parseBlackcatTransaction(res.body);
  },

  async testConnection(apiKey): Promise<ConnectionStatus> {
    try {
      const res = await gatewayFetch(`${blackcatApiBase()}/sales/seller`, { method: "GET", headers: headers(apiKey) });
      if (!res.ok) fail(res);
      const b = res.body;
      return isObj(b) && b.success !== false && isObj(b.data) ? "ok" : "unexpected";
    } catch (err) {
      return connectionStatusOf(err);
    }
  },
};
