/**
 * Servidor FALSO da Kyvo para os testes (nunca a API de verdade: nada de
 * cobrança real). Imita o que a documentação descreve:
 *
 * - "Authorization: Bearer <chave>": chave desconhecida → 401 invalid_api_key;
 *   KYVO_KEY_NO_READ → 403 missing_scope no GET de transações; KYVO_KEY_DOWN →
 *   502 provider_unavailable em tudo.
 * - POST /api/v1/spei/charges (MXN, até 2.500.000 centavos) e
 *   POST /api/v1/card/charges (USD/EUR/MXN, 100..10.000.000; onlyMethods
 *   ["bizum"] ou ["mb_way"] só com EUR). Idempotency-Key: mesmo corpo → 200 com
 *   "Idempotency-Replayed: true"; corpo diferente → 409 idempotency_conflict;
 *   externalOrderId repetido com outra chave → 409 duplicate_order. Cartão
 *   terminado em DECLINE no nome do cliente → 402 payment_declined.
 * - GET /api/v1/transactions/{id} e GET /api/v1/transactions?limit=…
 *
 * Uso: const kyvo = await startFakeKyvo(); process.env.OS_KYVO_API_BASE = kyvo.base;
 * kyvo.setStatus(id, "paid"); kyvo.requests (o que chegou); await kyvo.close().
 * Também serve para o pagamento.php (Etapa 3): o PHP aponta para kyvo.base.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export const KYVO_KEY = "kyvo_live_testeFalsoDoOfferStudio0123456789";
export const KYVO_KEY_NO_READ = "kyvo_live_semPermissaoDeLeitura0123456789";
export const KYVO_KEY_DOWN = "kyvo_live_kyvoForaDoAr0123456789abcdef";

export interface FakeRequest {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: unknown;
}

interface Tx {
  id: string;
  status: string;
  amount: number;
  currency: string;
  paymentMethod: "spei" | "card";
  externalOrderId: string | null;
  metadata: unknown;
  createdAt: string;
  paidAt: string | null;
}

export interface FakeKyvo {
  /** Base da API ("http://127.0.0.1:<porta>/api"). */
  base: string;
  requests: FakeRequest[];
  transactions: Map<string, Tx>;
  setStatus(id: string, status: string): void;
  /** Próxima resposta forçada (status + corpo), uma vez. */
  failNext(status: number, body: unknown): void;
  close(): Promise<void>;
}

const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
const err = (res: ServerResponse, status: number, code: string, message = code) =>
  send(res, status, { error: { code, message } });

export async function startFakeKyvo(): Promise<FakeKyvo> {
  const requests: FakeRequest[] = [];
  const transactions = new Map<string, Tx>();
  const idem = new Map<string, { body: string; tx: Tx }>();
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
        body = raw;
      }
      requests.push({ method: req.method ?? "", path: `${url.pathname}${url.search}`, headers: req.headers, body });
      if (forced) {
        const f = forced;
        forced = null;
        return send(res, f.status, f.body);
      }
      const auth = String(req.headers.authorization ?? "");
      if (!auth) return err(res, 401, "missing_api_key");
      const key = auth.replace(/^Bearer /, "");
      if (![KYVO_KEY, KYVO_KEY_NO_READ, KYVO_KEY_DOWN].includes(key)) return err(res, 401, "invalid_api_key");
      if (key === KYVO_KEY_DOWN) return err(res, 502, "provider_unavailable");

      if (req.method === "GET" && url.pathname === "/api/v1/transactions") {
        if (key === KYVO_KEY_NO_READ) return err(res, 403, "missing_scope", "transactions:read");
        const limit = Number(url.searchParams.get("limit") ?? 20);
        const all = [...transactions.values()];
        return send(res, 200, { data: all.slice(0, limit), total: all.length });
      }
      const txMatch = /^\/api\/v1\/transactions\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && txMatch) {
        if (key === KYVO_KEY_NO_READ) return err(res, 403, "missing_scope", "transactions:read");
        const tx = transactions.get(decodeURIComponent(txMatch[1]));
        if (!tx) return err(res, 404, "not_found");
        return send(res, 200, {
          id: tx.id,
          status: tx.status,
          amount: tx.amount,
          netAmount: Math.round(tx.amount * 0.95),
          feeAmount: tx.amount - Math.round(tx.amount * 0.95),
          currency: tx.currency,
          paymentMethod: tx.paymentMethod,
          externalOrderId: tx.externalOrderId,
          paidAt: tx.paidAt,
        });
      }
      const spei = url.pathname === "/api/v1/spei/charges";
      const card = url.pathname === "/api/v1/card/charges";
      if (req.method !== "POST" || (!spei && !card)) return err(res, 404, "not_found");
      const b = (body ?? {}) as Record<string, unknown>;
      const amount = b.amount;
      if (typeof amount !== "number" || !Number.isInteger(amount)) return err(res, 400, "bad_request");
      const customer = b.customer as Record<string, unknown> | undefined;
      if (!customer || typeof customer.name !== "string" || typeof customer.email !== "string") {
        return err(res, 400, "bad_request");
      }
      const currency = spei ? "MXN" : String(b.currency ?? "");
      if (spei) {
        if (amount < 100) return err(res, 400, "amount_below_minimum");
        if (amount > 2_500_000) return err(res, 400, "amount_above_maximum");
      } else {
        if (!["USD", "EUR", "MXN"].includes(currency)) return err(res, 400, "currency_not_allowed");
        if (amount < 100) return err(res, 400, "amount_below_minimum");
        if (amount > 10_000_000) return err(res, 400, "amount_above_maximum");
        const only = b.onlyMethods;
        if (only !== undefined) {
          if (!Array.isArray(only) || only.length !== 1 || !["bizum", "mb_way"].includes(String(only[0]))) {
            return err(res, 400, "only_methods_invalid");
          }
          if (currency !== "EUR") return err(res, 400, "only_methods_currency_mismatch");
        }
        if (/DECLINE$/.test(customer.name)) return err(res, 402, "payment_declined");
      }
      const idemKey = String(req.headers["idempotency-key"] ?? "");
      if (idemKey && idem.has(idemKey)) {
        const prev = idem.get(idemKey) as { body: string; tx: Tx };
        if (prev.body !== raw) return err(res, 409, "idempotency_conflict");
        return send(res, 200, chargeBody(prev.tx, spei), { "Idempotency-Replayed": "true" });
      }
      const external = typeof b.externalOrderId === "string" ? b.externalOrderId : null;
      if (external && [...transactions.values()].some((t) => t.externalOrderId === external)) {
        return err(res, 409, "duplicate_order");
      }
      seq++;
      const tx: Tx = {
        id: `tx_fake${String(seq).padStart(6, "0")}`,
        status: "pending",
        amount,
        currency,
        paymentMethod: spei ? "spei" : "card",
        externalOrderId: external,
        metadata: b.metadata ?? null,
        createdAt: new Date().toISOString(),
        paidAt: null,
      };
      transactions.set(tx.id, tx);
      if (idemKey) idem.set(idemKey, { body: raw, tx });
      return send(res, 201, chargeBody(tx, spei));
    });
  });

  function chargeBody(tx: Tx, spei: boolean) {
    const expires = new Date(Date.now() + 3600_000).toISOString();
    return {
      id: tx.id,
      status: tx.status,
      amount: tx.amount,
      currency: tx.currency,
      instructions: spei
        ? {
            method: "spei",
            spei: {
              clabe: "646180157000000004",
              bank: "STP",
              beneficiary: "KYVO PAY SA DE CV",
              nominal: "Mi Tienda Ejemplo",
              reference: "1234567",
              expires_at: expires,
            },
          }
        : {
            method: "card",
            card: {
              sdk_url: "https://kyvopay.com/sdk/card.js?v=1",
              session: {
                client_secret: `cs_${tx.id}`,
                public_key: "pk_fake",
                account: "acct_fake",
                transaction_id: tx.id,
              },
              expires_at: expires,
            },
          },
    };
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}/api`,
    requests,
    transactions,
    setStatus(id, status) {
      const tx = transactions.get(id);
      if (!tx) throw new Error(`transação ${id} não existe no servidor falso`);
      tx.status = status;
      tx.paidAt = status === "paid" ? new Date().toISOString() : null;
    },
    failNext(status, body) {
      forced = { status, body };
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
