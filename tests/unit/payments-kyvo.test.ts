/**
 * Adaptador da Kyvo (src/server/services/payments/kyvo.ts) contra o servidor
 * FALSO (tests/unit/kyvo-fake.ts): nenhuma chamada sai deste Mac.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type GatewayErrorCode, PaymentGatewayError } from "@/lib/payments/gateway";
import { newExternalOrderId } from "@/lib/payments/orders";
import { KYVO_API_BASE, kyvoApiBase, kyvoGateway, parseKyvoCharge } from "@/server/services/payments/kyvo";
import { catchError } from "./helpers";
import { type FakeKyvo, KYVO_KEY, KYVO_KEY_DOWN, KYVO_KEY_NO_READ, startFakeKyvo } from "./kyvo-fake";

let kyvo: FakeKyvo;
const customer = { name: "María López", email: "maria@ejemplo.mx" };

beforeAll(async () => {
  kyvo = await startFakeKyvo();
  process.env.OS_KYVO_API_BASE = kyvo.base;
  // Garantia: nada vai para a Kyvo de verdade.
  expect(kyvoApiBase()).toBe(kyvo.base);
});

afterAll(async () => {
  delete process.env.OS_KYVO_API_BASE;
  await kyvo.close();
});

async function gatewayCode(promise: Promise<unknown>): Promise<GatewayErrorCode> {
  const err = await catchError(promise);
  expect(err).toBeInstanceOf(PaymentGatewayError);
  return (err as PaymentGatewayError).code;
}

describe("endereço da API", () => {
  it("só aceita trocar por um endereço deste Mac", () => {
    const saved = process.env.OS_KYVO_API_BASE;
    try {
      process.env.OS_KYVO_API_BASE = "https://evil.example.com/api";
      expect(kyvoApiBase()).toBe(KYVO_API_BASE);
      process.env.OS_KYVO_API_BASE = "http://localhost:9999/api/";
      expect(kyvoApiBase()).toBe("http://localhost:9999/api");
      process.env.OS_KYVO_API_BASE = "nada";
      expect(kyvoApiBase()).toBe(KYVO_API_BASE);
    } finally {
      process.env.OS_KYVO_API_BASE = saved;
    }
  });
});

describe("cobrança SPEI", () => {
  it("manda valor em centavos, cliente, metadata, Bearer e Idempotency-Key = externalOrderId", async () => {
    const externalOrderId = newExternalOrderId("checkout", "link-checkout");
    const charge = await kyvoGateway.createCharge(KYVO_KEY, {
      method: "spei",
      amountCents: 29_700,
      currency: "MXN",
      customer: { ...customer, document: "LOPM800101ABC" },
      externalOrderId,
      sourceUrl: "https://minhaoferta.com/",
      metadata: { utm_source: "facebook", ip: "1.2.3.4" },
    });
    const req = kyvo.requests.at(-1);
    expect(req?.method).toBe("POST");
    expect(req?.path).toBe("/api/v1/spei/charges");
    expect(req?.headers.authorization).toBe(`Bearer ${KYVO_KEY}`);
    expect(req?.headers["idempotency-key"]).toBe(externalOrderId);
    expect(req?.body).toEqual({
      amount: 29_700,
      customer: { ...customer, document: "LOPM800101ABC" },
      externalOrderId,
      sourceUrl: "https://minhaoferta.com/",
      metadata: { utm_source: "facebook", ip: "1.2.3.4" },
    });
    expect(charge).toMatchObject({
      status: "pending",
      amountCents: 29_700,
      currency: "MXN",
      instructions: {
        kind: "spei",
        clabe: "646180157000000004",
        bank: "STP",
        holder: "Mi Tienda Ejemplo", // nominal antes de beneficiary
        reference: "1234567",
      },
    });
    expect(charge.id).toMatch(/^tx_/);
  });

  it("mesmo pedido de novo devolve a mesma cobrança (replayed)", async () => {
    const input = {
      method: "spei" as const,
      amountCents: 10_000,
      currency: "MXN" as const,
      customer,
      externalOrderId: newExternalOrderId("checkout", "link-checkout"),
    };
    const a = await kyvoGateway.createCharge(KYVO_KEY, input);
    const b = await kyvoGateway.createCharge(KYVO_KEY, input);
    expect(b.id).toBe(a.id);
    expect(b.replayed).toBe(true);
    // Mesmo pedido com corpo diferente: conflito.
    expect(await gatewayCode(kyvoGateway.createCharge(KYVO_KEY, { ...input, amountCents: 10_001 }))).toBe("conflict");
  });

  it("SPEI com outra moeda nem chega a chamar", async () => {
    const before = kyvo.requests.length;
    const code = await gatewayCode(
      kyvoGateway.createCharge(KYVO_KEY, {
        method: "spei",
        amountCents: 1000,
        currency: "EUR",
        customer,
        externalOrderId: newExternalOrderId("x", "link-x"),
      }),
    );
    expect(code).toBe("invalid_request");
    expect(kyvo.requests.length).toBe(before);
  });

  it("valor acima do máximo vira invalid_request com o código da Kyvo", async () => {
    const err = (await catchError(
      kyvoGateway.createCharge(KYVO_KEY, {
        method: "spei",
        amountCents: 2_500_001,
        currency: "MXN",
        customer,
        externalOrderId: newExternalOrderId("x", "link-x"),
      }),
    )) as PaymentGatewayError;
    expect(err.code).toBe("invalid_request");
    expect(err.providerCode).toBe("amount_above_maximum");
    expect(err.message).not.toContain(KYVO_KEY);
  });
});

describe("cobrança de cartão, Bizum e MB WAY", () => {
  it("cartão: moeda no corpo, sem onlyMethods; sessão do SDK como veio", async () => {
    const charge = await kyvoGateway.createCharge(KYVO_KEY, {
      method: "card",
      amountCents: 4_900,
      currency: "USD",
      customer,
      externalOrderId: newExternalOrderId("checkout", "link-checkout"),
    });
    const body = kyvo.requests.at(-1)?.body as Record<string, unknown>;
    expect(kyvo.requests.at(-1)?.path).toBe("/api/v1/card/charges");
    expect(body.currency).toBe("USD");
    expect(body).not.toHaveProperty("onlyMethods");
    expect(charge.instructions).toMatchObject({
      kind: "card",
      sdkUrl: "https://kyvopay.com/sdk/card.js?v=1",
      session: { client_secret: `cs_${charge.id}`, transaction_id: charge.id },
    });
  });

  it.each(["bizum", "mb_way"] as const)("%s: onlyMethods com EUR", async (method) => {
    await kyvoGateway.createCharge(KYVO_KEY, {
      method,
      amountCents: 2_990,
      currency: "EUR",
      customer,
      externalOrderId: newExternalOrderId("checkout", "link-checkout"),
    });
    expect((kyvo.requests.at(-1)?.body as Record<string, unknown>).onlyMethods).toEqual([method]);
  });

  it("Bizum com outra moeda nem chega a chamar", async () => {
    const before = kyvo.requests.length;
    expect(
      await gatewayCode(
        kyvoGateway.createCharge(KYVO_KEY, {
          method: "bizum",
          amountCents: 2_990,
          currency: "USD",
          customer,
          externalOrderId: newExternalOrderId("x", "link-x"),
        }),
      ),
    ).toBe("invalid_request");
    expect(kyvo.requests.length).toBe(before);
  });

  it("cartão recusado (402) → declined", async () => {
    expect(
      await gatewayCode(
        kyvoGateway.createCharge(KYVO_KEY, {
          method: "card",
          amountCents: 2_990,
          currency: "EUR",
          customer: { name: "Cliente DECLINE", email: "x@y.es" },
          externalOrderId: newExternalOrderId("x", "link-x"),
        }),
      ),
    ).toBe("declined");
  });

  it("SDK fora da Kyvo é recusado (a página nunca carrega script de outro lugar)", () => {
    const body = {
      id: "tx_1",
      status: "pending",
      amount: 100,
      currency: "EUR",
      instructions: { method: "card", card: { sdk_url: "https://evil.io/sdk.js", session: {} } },
    };
    expect(() => parseKyvoCharge(body)).toThrow(PaymentGatewayError);
    expect(() => parseKyvoCharge({ ...body, status: "quase" })).toThrow(PaymentGatewayError);
  });
});

describe("consulta e erros", () => {
  it("transação: status, valor e o externalOrderId", async () => {
    const externalOrderId = newExternalOrderId("checkout", "link-checkout");
    const charge = await kyvoGateway.createCharge(KYVO_KEY, {
      method: "spei",
      amountCents: 29_700,
      currency: "MXN",
      customer,
      externalOrderId,
    });
    expect(await kyvoGateway.getTransaction(KYVO_KEY, charge.id)).toMatchObject({
      status: "pending",
      externalOrderId,
      method: "spei",
      paidAt: null,
    });
    kyvo.setStatus(charge.id, "paid");
    const tx = await kyvoGateway.getTransaction(KYVO_KEY, charge.id);
    expect(tx.status).toBe("paid");
    expect(tx.paidAt).toBeTruthy();
    expect(await gatewayCode(kyvoGateway.getTransaction(KYVO_KEY, "tx_naoexiste"))).toBe("not_found");
    expect(await gatewayCode(kyvoGateway.getTransaction(KYVO_KEY, "../../x"))).toBe("not_found");
  });

  it("chave inválida, sem escopo, Kyvo fora do ar e resposta estranha", async () => {
    expect(await gatewayCode(kyvoGateway.getTransaction("kyvo_live_errada000000000000", "tx_1"))).toBe("invalid_key");
    expect(await gatewayCode(kyvoGateway.getTransaction(KYVO_KEY_NO_READ, "tx_1"))).toBe("missing_scope");
    const down = (await catchError(kyvoGateway.getTransaction(KYVO_KEY_DOWN, "tx_1"))) as PaymentGatewayError;
    expect(down.code).toBe("unavailable");
    expect(down.retryable).toBe(true);
    kyvo.failNext(200, { nada: true });
    expect(await gatewayCode(kyvoGateway.getTransaction(KYVO_KEY, "tx_1"))).toBe("unexpected");
  });

  it("Testar conexão: ok, chave inválida, sem escopo, fora do ar, sem conexão", async () => {
    expect(await kyvoGateway.testConnection(KYVO_KEY)).toBe("ok");
    expect(kyvo.requests.at(-1)?.path).toBe("/api/v1/transactions?limit=1");
    expect(await kyvoGateway.testConnection("kyvo_live_errada000000000000")).toBe("invalid_key");
    expect(await kyvoGateway.testConnection(KYVO_KEY_NO_READ)).toBe("missing_scope");
    expect(await kyvoGateway.testConnection(KYVO_KEY_DOWN)).toBe("unavailable");
    const saved = process.env.OS_KYVO_API_BASE;
    process.env.OS_KYVO_API_BASE = "http://127.0.0.1:1/api";
    try {
      expect(await kyvoGateway.testConnection(KYVO_KEY)).toBe("offline");
    } finally {
      process.env.OS_KYVO_API_BASE = saved;
    }
  });
});
