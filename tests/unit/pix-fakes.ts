/**
 * Servidores FALSOS da FlevoPay e da BlackCat para os testes (nunca as APIs de
 * verdade: nada de PIX real). Imitam o que a documentação descreve
 * (resumo em src/server/services/payments/flevopay.ts e blackcat.ts):
 *
 * FlevoPay (startFakeFlevopay, base "http://127.0.0.1:<porta>"):
 * - "X-API-Key": FLEVO_KEY vale; FLEVO_KEY_DOWN → 502 em tudo; outra → 401.
 * - POST /api/v1/transaction (amount, description, reference, customer com os
 *   4 campos; source "api_externa") → { status: "success", transaction_id, id,
 *   qr_code, qr_code_base64, amount, expires_at }. Faltou campo → 400.
 *   reference repetida → 400.
 * - GET /api/v1/query?action=get_transaction&id=<id interno ou reference>.
 * - GET /api/v1/seller.
 *
 * BlackCat (startFakeBlackcat, base "http://127.0.0.1:<porta>/api"):
 * - "X-API-Key": BLACKCAT_KEY vale; BLACKCAT_KEY_UNAPPROVED → 403 (conta não
 *   aprovada); BLACKCAT_KEY_DOWN → 500; outra → 401.
 * - POST /sales/create-sale (amount = soma dos itens; customer com os 4 campos;
 *   shipping obrigatório com item físico) → 201 { success, data: { transactionId,
 *   status: "PENDING", paymentData: { qrCode, qrCodeBase64, copyPaste, expiresAt } } }.
 *   Erro de validação → 422.
 * - GET /sales/<id>/status e GET /sales/seller.
 *
 * ClownPay (startFakeClownpay, base "http://127.0.0.1:<porta>"):
 * - "Authorization: Bearer": CLOWNPAY_KEY vale; CLOWNPAY_KEY_KYC → 403 (conta em
 *   análise/KYC); CLOWNPAY_KEY_DOWN → 503; outra → 401.
 * - POST /v1/payments (amount em centavos, payment_method "pix",
 *   external_reference, buyer com os 4 campos; exige "Idempotency-Key") → 201
 *   { id (uuid), external_reference, status: "pending", amount, pix: { emv } }
 *   (só o copia-e-cola, sem imagem). Idempotency-Key repetida devolve a mesma
 *   cobrança. Erro de validação → 422.
 * - GET /v1/payments/<id> e GET /v1/payments?limit=1 (o "Testar conexão").
 *
 * Todos: `setStatus(id, status)` muda o status (como o pagamento do
 * comprador), `requests` guarda o que chegou e `failNext` força a próxima resposta.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export const FLEVO_KEY = "flevopay_sk_testeFalsoDoOfferStudio0123";
export const FLEVO_KEY_DOWN = "flevopay_sk_foraDoAr0123456789abcdef";
export const BLACKCAT_KEY = "bc_live_testeFalsoDoOfferStudio0123456";
export const BLACKCAT_KEY_UNAPPROVED = "bc_live_contaAindaEmAnalise0123456789";
export const BLACKCAT_KEY_DOWN = "bc_live_blackcatForaDoAr0123456789ab";
export const CLOWNPAY_KEY = "cp_live_testeFalsoDoOfferStudio0123456";
export const CLOWNPAY_KEY_KYC = "cp_live_contaEmAnaliseKyc0123456789ab";
export const CLOWNPAY_KEY_DOWN = "cp_live_clownpayForaDoAr0123456789ab";

/** Código PIX de exemplo (formato EMV do "copia e cola"). */
export const FAKE_PIX_CODE =
  "00020126580014br.gov.bcb.pix0136fake-offer-studio-pix-0000000000005204000053039865802BR5913OFFER STUDIO6009SAO PAULO62070503***6304ABCD";
/** PNG 1×1 em base64 (a "imagem do QR"). */
export const FAKE_QR_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export interface FakeRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: IncomingMessage["headers"];
  body: unknown;
}

export interface FakeTx {
  id: string;
  reference: string;
  status: string;
  amount: number;
  createdAt: string;
  paidAt: string | null;
  body: Record<string, unknown>;
}

export interface FakePix {
  base: string;
  requests: FakeRequest[];
  transactions: Map<string, FakeTx>;
  setStatus(id: string, status: string): void;
  failNext(status: number, body: unknown): void;
  close(): Promise<void>;
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const digits = (v: unknown) => (typeof v === "string" ? v.replace(/\D+/g, "") : "");

/** "2026-10-11 21:30:00" (como a FlevoPay manda, sem fuso). */
function naiveDate(d: Date) {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

type Handler = (
  req: FakeRequest,
  res: ServerResponse,
  state: { transactions: Map<string, FakeTx>; next: () => number },
) => void;

async function startFake(prefix: string, handler: Handler): Promise<FakePix> {
  const requests: FakeRequest[] = [];
  const transactions = new Map<string, FakeTx>();
  let forced: { status: number; body: unknown } | null = null;
  let seq = 0;
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://fake");
      let body: unknown = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = "__invalido__";
      }
      const query: Record<string, string> = {};
      url.searchParams.forEach((v, k) => {
        query[k] = v;
      });
      const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
      const entry = { method: req.method ?? "GET", path, query, headers: req.headers, body };
      requests.push(entry);
      if (forced) {
        const f = forced;
        forced = null;
        send(res, f.status, f.body);
        return;
      }
      handler(entry, res, { transactions, next: () => ++seq });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}${prefix}`,
    requests,
    transactions,
    setStatus(id, status) {
      const tx = transactions.get(id);
      if (!tx) throw new Error(`transação falsa ${id} não existe`);
      tx.status = status;
      if (/^(approved|paid)$/i.test(status)) tx.paidAt = new Date().toISOString();
    },
    failNext(status, body) {
      forced = { status, body };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ─── FlevoPay ───────────────────────────────────────────────────────────────

export function startFakeFlevopay(): Promise<FakePix> {
  return startFake("", (req, res, state) => {
    const key = req.headers["x-api-key"];
    if (key === FLEVO_KEY_DOWN) return send(res, 502, { status: "error", message: "Bad gateway" });
    if (key !== FLEVO_KEY) return send(res, 401, { status: "error", message: "Unauthorized" });

    if (req.method === "GET" && req.path === "/api/v1/seller") {
      return send(res, 200, {
        name: "Loja Teste",
        company_name: "Loja Teste LTDA",
        document: "12345678000199",
        email: "contato@lojateste.com.br",
        entity_type: "PJ",
      });
    }
    if (req.method === "POST" && req.path === "/api/v1/transaction") {
      const b = obj(req.body);
      const c = obj(b.customer);
      const amount = b.amount;
      if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
        return send(res, 400, { status: "error", message: "amount inválido" });
      }
      if (typeof b.description !== "string" || !b.description || typeof b.reference !== "string" || !b.reference) {
        return send(res, 400, { status: "error", message: "description e reference são obrigatórios" });
      }
      if (b.source === "api_externa" && b.productHash !== undefined && typeof b.productHash !== "string") {
        return send(res, 400, { status: "error", message: "productHash inválido" });
      }
      const doc = digits(c.document);
      const phone = digits(c.phone);
      if (!c.name || !c.email || !(doc.length === 11 || doc.length === 14) || phone.length < 10) {
        return send(res, 400, { status: "error", message: "customer incompleto" });
      }
      if ([...state.transactions.values()].some((t) => t.reference === b.reference)) {
        return send(res, 400, { status: "error", message: "reference já usada" });
      }
      const id = String(state.next() + 200);
      const now = new Date();
      state.transactions.set(id, {
        id,
        reference: b.reference,
        status: "pending",
        amount,
        createdAt: naiveDate(now),
        paidAt: null,
        body: b,
      });
      return send(res, 200, {
        status: "success",
        transaction_id: Number(id),
        id: b.reference,
        qr_code: FAKE_PIX_CODE,
        qr_code_base64: `data:image/png;base64,${FAKE_QR_BASE64}`,
        amount,
        acquirer: "fake",
        attempts: 1,
        expires_at: naiveDate(new Date(now.getTime() + 30 * 60_000)),
      });
    }
    if (req.method === "GET" && req.path === "/api/v1/query" && req.query.action === "get_transaction") {
      const id = req.query.id ?? "";
      const tx = state.transactions.get(id) ?? [...state.transactions.values()].find((t) => t.reference === id);
      if (!tx) return send(res, 404, { status: "error", message: "Transação não encontrada" });
      return send(res, 200, {
        id: Number(tx.id),
        external_id: tx.reference,
        status: tx.status,
        amount: tx.amount,
        created_at: tx.createdAt,
        updated_at: tx.paidAt ? naiveDate(new Date(tx.paidAt)) : tx.createdAt,
        customer_data: {},
        attempts_data: [],
        amount_in_reais: (tx.amount / 100).toFixed(2),
      });
    }
    return send(res, 404, { status: "error", message: "Rota não encontrada" });
  });
}

// ─── BlackCat ───────────────────────────────────────────────────────────────

export function startFakeBlackcat(): Promise<FakePix> {
  return startFake("/api", (req, res, state) => {
    const key = req.headers["x-api-key"];
    if (key === BLACKCAT_KEY_DOWN)
      return send(res, 500, { success: false, message: "Erro interno", error: "INTERNAL" });
    if (key === BLACKCAT_KEY_UNAPPROVED) {
      return send(res, 403, { success: false, message: "Conta não aprovada", error: "ACCOUNT_NOT_APPROVED" });
    }
    if (key !== BLACKCAT_KEY)
      return send(res, 401, { success: false, message: "Não autorizado", error: "UNAUTHORIZED" });

    if (req.method === "GET" && req.path === "/sales/seller") {
      return send(res, 200, {
        success: true,
        data: { name: "Loja Teste", legalName: "Loja Teste LTDA", cnpj: "12345678000199", logo: null },
      });
    }
    if (req.method === "POST" && req.path === "/sales/create-sale") {
      const b = obj(req.body);
      const c = obj(b.customer);
      const doc = obj(c.document);
      const items = Array.isArray(b.items) ? b.items.map(obj) : [];
      const invalid = (message: string) => send(res, 422, { success: false, message, error: "VALIDATION_ERROR" });
      if (b.paymentMethod !== "pix") return invalid("paymentMethod");
      if (!items.length) return invalid("items");
      const sum = items.reduce(
        (n, i) =>
          n + (typeof i.unitPrice === "number" ? i.unitPrice : 0) * (typeof i.quantity === "number" ? i.quantity : 0),
        0,
      );
      if (typeof b.amount !== "number" || b.amount !== sum || sum <= 0) return invalid("amount ≠ soma dos itens");
      if (!c.name || !c.email || digits(c.phone).length < 10 || !digits(doc.number) || !doc.type) {
        return invalid("customer");
      }
      if (items.some((i) => i.tangible === true)) {
        const s = obj(b.shipping);
        if (!s.street || !s.number || !s.city || !s.state || digits(s.zipCode).length !== 8) return invalid("shipping");
      }
      const id = `bc_tx_${state.next()}`;
      const now = new Date();
      state.transactions.set(id, {
        id,
        reference: typeof b.externalRef === "string" ? b.externalRef : "",
        status: "PENDING",
        amount: sum,
        createdAt: now.toISOString(),
        paidAt: null,
        body: b,
      });
      return send(res, 201, {
        success: true,
        data: {
          transactionId: id,
          status: "PENDING",
          paymentMethod: "pix",
          amount: sum,
          netAmount: Math.round(sum * 0.95),
          fees: Math.round(sum * 0.05),
          invoiceUrl: "https://example.invalid/fatura",
          createdAt: now.toISOString(),
          paymentData: {
            qrCode: FAKE_PIX_CODE,
            qrCodeBase64: FAKE_QR_BASE64,
            copyPaste: FAKE_PIX_CODE,
            expiresAt: new Date(now.getTime() + 24 * 3600_000).toISOString(),
          },
        },
      });
    }
    const status = /^\/sales\/([^/]+)\/status$/.exec(req.path);
    if (req.method === "GET" && status) {
      const tx = state.transactions.get(decodeURIComponent(status[1]));
      if (!tx) return send(res, 404, { success: false, message: "Venda não encontrada", error: "NOT_FOUND" });
      return send(res, 200, {
        success: true,
        data: {
          transactionId: tx.id,
          status: tx.status,
          paymentMethod: "pix",
          amount: tx.amount,
          netAmount: Math.round(tx.amount * 0.95),
          fees: Math.round(tx.amount * 0.05),
          paidAt: tx.paidAt,
          endToEndId: tx.paidAt ? "E00000000202610110000000000000" : null,
        },
      });
    }
    return send(res, 404, { success: false, message: "Rota não encontrada", error: "NOT_FOUND" });
  });
}

// ─── ClownPay ─────────────────────────────────────────────────────────────────

/** Um id com cara de UUID (estável pelo número da sequência), como os da ClownPay. */
function fakeUuid(n: number): string {
  const h = n.toString(16).padStart(12, "0");
  return `a1b2c3d4-e5f6-4000-8000-${h}`;
}

export function startFakeClownpay(): Promise<FakePix> {
  // Idempotency-Key → id da cobrança (repetir devolve a mesma, como a ClownPay).
  const idempo = new Map<string, string>();
  return startFake("", (req, res, state) => {
    const auth = req.headers.authorization;
    const key = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (key === CLOWNPAY_KEY_DOWN) return send(res, 503, { error: "provider_result_unknown", message: "Indisponível" });
    if (key === CLOWNPAY_KEY_KYC) return send(res, 403, { error: "kyc_required", message: "Conta em análise (KYC)" });
    if (key !== CLOWNPAY_KEY) return send(res, 401, { error: "unauthorized", message: "Chave inválida" });

    if (req.method === "GET" && req.path === "/v1/payments") {
      // Listagem (o "Testar conexão"): payments:read.
      return send(res, 200, {
        data: [...state.transactions.values()].slice(0, 1).map((t) => ({ id: t.id })),
        next_cursor: null,
      });
    }
    if (req.method === "POST" && req.path === "/v1/payments") {
      const b = obj(req.body);
      const buyer = obj(b.buyer);
      const invalid = (message: string) => send(res, 422, { error: "validation_error", message });
      const idem = req.headers["idempotency-key"];
      if (typeof idem !== "string" || !idem) return invalid("Idempotency-Key obrigatório");
      if (idempo.has(idem)) {
        const tx = state.transactions.get(idempo.get(idem) as string);
        if (tx)
          return send(res, 200, {
            id: tx.id,
            external_reference: tx.reference,
            status: tx.status,
            amount: tx.amount,
            payment_method: "pix",
            pix: { emv: FAKE_PIX_CODE },
            created_at: tx.createdAt,
          });
      }
      if (b.payment_method !== "pix") return invalid("payment_method");
      const amount = b.amount;
      if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return invalid("amount");
      if (typeof b.external_reference !== "string" || !b.external_reference) return invalid("external_reference");
      const doc = digits(buyer.document);
      if (!buyer.name || !buyer.email || !(doc.length === 11 || doc.length === 14) || digits(buyer.phone).length < 10) {
        return invalid("buyer");
      }
      const id = fakeUuid(state.next());
      const now = new Date();
      state.transactions.set(id, {
        id,
        reference: b.external_reference,
        status: "pending",
        amount,
        createdAt: now.toISOString(),
        paidAt: null,
        body: b,
      });
      idempo.set(idem, id);
      return send(res, 201, {
        id,
        external_reference: b.external_reference,
        status: "pending",
        amount,
        payment_method: "pix",
        pix: { emv: FAKE_PIX_CODE },
        created_at: now.toISOString(),
      });
    }
    const one = /^\/v1\/payments\/([^/]+)$/.exec(req.path);
    if (req.method === "GET" && one) {
      const tx = state.transactions.get(decodeURIComponent(one[1]));
      if (!tx) return send(res, 404, { error: "not_found", message: "Cobrança não encontrada" });
      return send(res, 200, {
        id: tx.id,
        external_reference: tx.reference,
        status: tx.status,
        amount: tx.amount,
        payment_method: "pix",
        created_at: tx.createdAt,
        paid_at: tx.paidAt,
      });
    }
    return send(res, 404, { error: "not_found", message: "Rota não encontrada" });
  });
}
