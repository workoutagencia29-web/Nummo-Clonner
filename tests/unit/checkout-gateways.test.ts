/**
 * Adaptadores de PIX do checkout do Offer Studio (FlevoPay e BlackCat, em
 * src/server/services/payments/) contra os servidores FALSOS de
 * tests/unit/pix-fakes.ts: nenhuma chamada sai deste Mac.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ChargeInput, type GatewayErrorCode, PaymentGatewayError } from "@/lib/payments/gateway";
import { newExternalOrderId } from "@/lib/payments/orders";
import {
  BLACKCAT_API_BASE,
  BLACKCAT_BASE_ENV,
  blackcatApiBase,
  blackcatGateway,
  blackcatStatus,
} from "@/server/services/payments/blackcat";
import {
  CLOWNPAY_API_BASE,
  CLOWNPAY_BASE_ENV,
  clownpayApiBase,
  clownpayGateway,
  clownpayStatus,
} from "@/server/services/payments/clownpay";
import {
  FLEVOPAY_API_BASE,
  FLEVOPAY_BASE_ENV,
  flevopayApiBase,
  flevopayGateway,
  flevopayStatus,
} from "@/server/services/payments/flevopay";
import { isoDate, qrImageOf } from "@/server/services/payments/http";
import { kyvoGateway } from "@/server/services/payments/kyvo";
import { catchError } from "./helpers";
import { KYVO_KEY } from "./kyvo-fake";
import {
  BLACKCAT_KEY,
  BLACKCAT_KEY_DOWN,
  BLACKCAT_KEY_UNAPPROVED,
  CLOWNPAY_KEY,
  CLOWNPAY_KEY_DOWN,
  CLOWNPAY_KEY_KYC,
  FAKE_PIX_CODE,
  FAKE_QR_BASE64,
  type FakePix,
  FLEVO_KEY,
  FLEVO_KEY_DOWN,
  startFakeBlackcat,
  startFakeClownpay,
  startFakeFlevopay,
} from "./pix-fakes";

let flevo: FakePix;
let blackcat: FakePix;
let clown: FakePix;

beforeAll(async () => {
  [flevo, blackcat, clown] = await Promise.all([startFakeFlevopay(), startFakeBlackcat(), startFakeClownpay()]);
  process.env[FLEVOPAY_BASE_ENV] = flevo.base;
  process.env[BLACKCAT_BASE_ENV] = blackcat.base;
  process.env[CLOWNPAY_BASE_ENV] = clown.base;
  // Garantia: nada vai para os gateways de verdade.
  expect(flevopayApiBase()).toBe(flevo.base);
  expect(blackcatApiBase()).toBe(blackcat.base);
  expect(clownpayApiBase()).toBe(clown.base);
});

afterAll(async () => {
  delete process.env[FLEVOPAY_BASE_ENV];
  delete process.env[BLACKCAT_BASE_ENV];
  delete process.env[CLOWNPAY_BASE_ENV];
  await Promise.all([flevo.close(), blackcat.close(), clown.close()]);
});

async function gatewayCode(promise: Promise<unknown>): Promise<GatewayErrorCode> {
  const err = await catchError(promise);
  expect(err).toBeInstanceOf(PaymentGatewayError);
  return (err as PaymentGatewayError).code;
}

const buyer = {
  name: "Maria da Silva",
  email: "maria@exemplo.com.br",
  document: "529.982.247-25",
  phone: "(11) 98765-4321",
};

function pixInput(over: Partial<ChargeInput> = {}): ChargeInput {
  return {
    method: "pix",
    amountCents: 9_700,
    currency: "BRL",
    customer: buyer,
    description: "Curso de Confeitaria",
    externalOrderId: newExternalOrderId("checkout", "link-checkout"),
    metadata: { utm_source: "facebook", utm_campaign: "lancamento", src: "anuncio1", ip: "1.2.3.4" },
    ...over,
  };
}

describe("endereço das APIs", () => {
  it("só troca por um endereço deste Mac", () => {
    const saved = { f: process.env[FLEVOPAY_BASE_ENV], b: process.env[BLACKCAT_BASE_ENV] };
    try {
      process.env[FLEVOPAY_BASE_ENV] = "https://evil.example.com";
      process.env[BLACKCAT_BASE_ENV] = "http://10.0.0.5/api";
      expect(flevopayApiBase()).toBe(FLEVOPAY_API_BASE);
      expect(blackcatApiBase()).toBe(BLACKCAT_API_BASE);
      process.env[FLEVOPAY_BASE_ENV] = "http://localhost:9999/";
      process.env[BLACKCAT_BASE_ENV] = "http://127.0.0.1:9998/api/";
      expect(flevopayApiBase()).toBe("http://localhost:9999");
      expect(blackcatApiBase()).toBe("http://127.0.0.1:9998/api");
      delete process.env[FLEVOPAY_BASE_ENV];
      expect(flevopayApiBase()).toBe("https://pagamento-processador.org.ua");
    } finally {
      process.env[FLEVOPAY_BASE_ENV] = saved.f;
      process.env[BLACKCAT_BASE_ENV] = saved.b;
    }
  });
});

describe("FlevoPay", () => {
  it("cria o PIX: centavos, reference = pedido, source api_externa, os 4 dados de quem compra só com algarismos", async () => {
    const input = pixInput();
    const charge = await flevopayGateway.createCharge(FLEVO_KEY, input);
    expect(charge).toMatchObject({ status: "pending", amountCents: 9_700, currency: "BRL" });
    expect(charge.instructions).toEqual({
      kind: "pix",
      copyPaste: FAKE_PIX_CODE,
      qrImage: `data:image/png;base64,${FAKE_QR_BASE64}`,
      expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/),
    });
    const req = flevo.requests.at(-1);
    expect(req?.headers["x-api-key"]).toBe(FLEVO_KEY);
    expect(req?.body).toEqual({
      amount: 9_700,
      description: "Curso de Confeitaria",
      reference: input.externalOrderId,
      source: "api_externa",
      customer: { name: buyer.name, email: buyer.email, document: "52998224725", phone: "11987654321" },
      // Só os campos de rastreamento que a FlevoPay conhece (o ip não vai).
      tracking: { utm_source: "facebook", utm_campaign: "lancamento", src: "anuncio1" },
    });
    // Os bumps entram no amount: nunca o "orderbump" da FlevoPay.
    expect(JSON.stringify(req?.body)).not.toContain("orderbump");
  });

  it("endereço e postback quando vêm; status consultado pela API", async () => {
    const input = pixInput({
      customer: {
        ...buyer,
        address: {
          zipCode: "01310100",
          street: "Avenida Paulista",
          number: "1000",
          complement: "ap 12",
          neighborhood: "Bela Vista",
          city: "São Paulo",
          state: "SP",
        },
      },
      postbackUrl: "https://minhaoferta.com.br/pagamento.php?webhook=flevopay",
    });
    const charge = await flevopayGateway.createCharge(FLEVO_KEY, input);
    const body = flevo.requests.at(-1)?.body as Record<string, unknown>;
    expect(body.address).toEqual({
      street: "Avenida Paulista",
      number: "1000",
      complement: "ap 12",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      zipcode: "01310100",
    });
    expect(body.postback_url).toBe("https://minhaoferta.com.br/pagamento.php?webhook=flevopay");

    expect(await flevopayGateway.getTransaction(FLEVO_KEY, charge.id)).toMatchObject({
      id: charge.id,
      status: "pending",
      amountCents: 9_700,
      currency: "BRL",
      method: "pix",
      externalOrderId: input.externalOrderId,
      paidAt: null,
    });
    flevo.setStatus(charge.id, "approved");
    const paid = await flevopayGateway.getTransaction(FLEVO_KEY, charge.id);
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).not.toBeNull();
    flevo.setStatus(charge.id, "failed");
    expect((await flevopayGateway.getTransaction(FLEVO_KEY, charge.id)).status).toBe("failed");
  });

  it("recusa o que não é PIX em real e quem compra sem os 4 dados (sem chamar a FlevoPay)", async () => {
    const before = flevo.requests.length;
    expect(await gatewayCode(flevopayGateway.createCharge(FLEVO_KEY, pixInput({ currency: "MXN" })))).toBe(
      "invalid_request",
    );
    expect(await gatewayCode(flevopayGateway.createCharge(FLEVO_KEY, pixInput({ method: "card" })))).toBe(
      "invalid_request",
    );
    expect(
      await gatewayCode(
        flevopayGateway.createCharge(FLEVO_KEY, pixInput({ customer: { name: "Maria", email: "m@x.com" } })),
      ),
    ).toBe("invalid_request");
    expect(await gatewayCode(flevopayGateway.createCharge(FLEVO_KEY, pixInput({ amountCents: 0 })))).toBe(
      "invalid_request",
    );
    expect(flevo.requests.length).toBe(before);
  });

  it("erros: chave recusada, fora do ar, pedido repetido, transação que não existe, resposta estranha", async () => {
    expect(await gatewayCode(flevopayGateway.createCharge("flevopay_sk_errada0000000000", pixInput()))).toBe(
      "invalid_key",
    );
    expect(await gatewayCode(flevopayGateway.createCharge(FLEVO_KEY_DOWN, pixInput()))).toBe("unavailable");
    const input = pixInput();
    await flevopayGateway.createCharge(FLEVO_KEY, input);
    expect(await gatewayCode(flevopayGateway.createCharge(FLEVO_KEY, input))).toBe("invalid_request");
    expect(await gatewayCode(flevopayGateway.getTransaction(FLEVO_KEY, "999999"))).toBe("not_found");
    expect(await gatewayCode(flevopayGateway.getTransaction(FLEVO_KEY, "../seller"))).toBe("not_found");
    flevo.failNext(200, { status: "success", transaction_id: 1, qr_code: "" });
    expect(await gatewayCode(flevopayGateway.createCharge(FLEVO_KEY, pixInput()))).toBe("unexpected");
    flevo.failNext(200, { status: "error", message: "saldo" });
    expect(await gatewayCode(flevopayGateway.createCharge(FLEVO_KEY, pixInput()))).toBe("invalid_request");
  });

  it("“Testar conexão” pelo vendedor (nada é criado)", async () => {
    const before = flevo.transactions.size;
    expect(await flevopayGateway.testConnection(FLEVO_KEY)).toBe("ok");
    expect(flevo.requests.at(-1)).toMatchObject({ method: "GET", path: "/api/v1/seller" });
    expect(await flevopayGateway.testConnection("flevopay_sk_errada0000000000")).toBe("invalid_key");
    expect(await flevopayGateway.testConnection(FLEVO_KEY_DOWN)).toBe("unavailable");
    flevo.failNext(200, { qualquer: "coisa" });
    expect(await flevopayGateway.testConnection(FLEVO_KEY)).toBe("unexpected");
    expect(flevo.transactions.size).toBe(before);
  });

  it("status da FlevoPay", () => {
    expect(["pending", "processing", "under_review"].map(flevopayStatus)).toEqual(["pending", "pending", "pending"]);
    expect(flevopayStatus("approved")).toBe("paid");
    expect(flevopayStatus("failed")).toBe("failed");
    expect(flevopayStatus("refunded")).toBe("refunded");
    expect(flevopayStatus("chargeback")).toBe("disputed");
    expect(() => flevopayStatus("estranho")).toThrow(PaymentGatewayError);
  });
});

describe("BlackCat", () => {
  it("cria a venda PIX com os itens (produto, bump, frete), o CPF como documento e o pedido em externalRef", async () => {
    const input = pixInput({
      amountCents: 9_700 + 2_700 + 1_990,
      items: [
        { title: "Curso de Confeitaria", unitPriceCents: 9_700, quantity: 1, tangible: false },
        { title: "Apostila de recheios", unitPriceCents: 2_700, quantity: 1, tangible: false },
        { title: "Frete: Correios PAC", unitPriceCents: 1_990, quantity: 1, tangible: false },
      ],
    });
    const charge = await blackcatGateway.createCharge(BLACKCAT_KEY, input);
    expect(charge).toMatchObject({ status: "pending", amountCents: 14_390, currency: "BRL" });
    // A imagem veio sem o "data:": o adaptador completa.
    expect(charge.instructions).toEqual({
      kind: "pix",
      copyPaste: FAKE_PIX_CODE,
      qrImage: `data:image/png;base64,${FAKE_QR_BASE64}`,
      expiresAt: expect.any(String),
    });
    const req = blackcat.requests.at(-1);
    expect(req?.headers["x-api-key"]).toBe(BLACKCAT_KEY);
    expect(req?.path).toBe("/sales/create-sale");
    expect(req?.body).toMatchObject({
      amount: 14_390,
      currency: "BRL",
      paymentMethod: "pix",
      items: [
        { title: "Curso de Confeitaria", unitPrice: 9_700, quantity: 1, tangible: false },
        { title: "Apostila de recheios", unitPrice: 2_700, quantity: 1, tangible: false },
        { title: "Frete: Correios PAC", unitPrice: 1_990, quantity: 1, tangible: false },
      ],
      customer: {
        name: buyer.name,
        email: buyer.email,
        phone: "11987654321",
        document: { number: "52998224725", type: "cpf" },
      },
      externalRef: input.externalOrderId,
      utm_source: "facebook",
      utm_campaign: "lancamento",
      metadata: JSON.stringify({ src: "anuncio1" }),
    });
    expect((req?.body as Record<string, unknown>).shipping).toBeUndefined();

    expect(await blackcatGateway.getTransaction(BLACKCAT_KEY, charge.id)).toMatchObject({
      id: charge.id,
      status: "pending",
      amountCents: 14_390,
      method: "pix",
      paidAt: null,
    });
    blackcat.setStatus(charge.id, "PAID");
    expect(await blackcatGateway.getTransaction(BLACKCAT_KEY, charge.id)).toMatchObject({ status: "paid" });
    blackcat.setStatus(charge.id, "CANCELLED");
    expect((await blackcatGateway.getTransaction(BLACKCAT_KEY, charge.id)).status).toBe("canceled");
  });

  it("item físico exige o endereço (vai em shipping); a soma dos itens tem de dar o valor", async () => {
    const tangible = { title: "Livro", unitPriceCents: 5_000, quantity: 1, tangible: true };
    expect(
      await gatewayCode(
        blackcatGateway.createCharge(BLACKCAT_KEY, pixInput({ amountCents: 5_000, items: [tangible] })),
      ),
    ).toBe("invalid_request");
    const address = {
      zipCode: "01310100",
      street: "Avenida Paulista",
      number: "1000",
      complement: "",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    };
    await blackcatGateway.createCharge(
      BLACKCAT_KEY,
      pixInput({ amountCents: 5_000, items: [tangible], customer: { ...buyer, address } }),
    );
    expect((blackcat.requests.at(-1)?.body as Record<string, unknown>).shipping).toEqual({
      name: buyer.name,
      street: "Avenida Paulista",
      number: "1000",
      complement: "",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      zipCode: "01310100",
    });
    expect(
      await gatewayCode(
        blackcatGateway.createCharge(BLACKCAT_KEY, pixInput({ amountCents: 4_999, items: [tangible] })),
      ),
    ).toBe("invalid_request");
  });

  it("erros e “Testar conexão”: chave recusada, conta não aprovada (403), fora do ar", async () => {
    expect(await gatewayCode(blackcatGateway.createCharge("bc_live_errada000000000", pixInput()))).toBe("invalid_key");
    expect(await gatewayCode(blackcatGateway.createCharge(BLACKCAT_KEY_UNAPPROVED, pixInput()))).toBe("missing_scope");
    expect(await gatewayCode(blackcatGateway.createCharge(BLACKCAT_KEY_DOWN, pixInput()))).toBe("unavailable");
    expect(await gatewayCode(blackcatGateway.getTransaction(BLACKCAT_KEY, "nao_existe"))).toBe("not_found");
    const before = blackcat.transactions.size;
    expect(await blackcatGateway.testConnection(BLACKCAT_KEY)).toBe("ok");
    expect(blackcat.requests.at(-1)).toMatchObject({ method: "GET", path: "/sales/seller" });
    expect(await blackcatGateway.testConnection("bc_live_errada000000000")).toBe("invalid_key");
    expect(await blackcatGateway.testConnection(BLACKCAT_KEY_UNAPPROVED)).toBe("missing_scope");
    expect(await blackcatGateway.testConnection(BLACKCAT_KEY_DOWN)).toBe("unavailable");
    expect(blackcat.transactions.size).toBe(before);
  });

  it("status da BlackCat", () => {
    expect(blackcatStatus("PENDING")).toBe("pending");
    expect(blackcatStatus("PAID")).toBe("paid");
    expect(blackcatStatus("CANCELLED")).toBe("canceled");
    expect(blackcatStatus("REFUNDED")).toBe("refunded");
    expect(blackcatStatus("FAILED")).toBe("failed");
    expect(() => blackcatStatus("")).toThrow(PaymentGatewayError);
  });
});

describe("ClownPay", () => {
  it("cria o PIX: Bearer, Idempotency-Key = pedido, buyer com os 4 dados, products somam o valor", async () => {
    const input = pixInput({
      amountCents: 9_700 + 2_700,
      items: [
        { title: "Curso de Confeitaria", unitPriceCents: 9_700, quantity: 1, tangible: false },
        { title: "Apostila de recheios", unitPriceCents: 2_700, quantity: 1, tangible: false },
      ],
    });
    const charge = await clownpayGateway.createCharge(CLOWNPAY_KEY, input);
    expect(charge).toMatchObject({ status: "pending", amountCents: 12_400, currency: "BRL" });
    // A ClownPay devolve só o "copia e cola" (sem imagem do QR): a página gera o QR.
    expect(charge.instructions).toEqual({ kind: "pix", copyPaste: FAKE_PIX_CODE, qrImage: null, expiresAt: null });
    const req = clown.requests.at(-1);
    expect(req?.headers.authorization).toBe(`Bearer ${CLOWNPAY_KEY}`);
    expect(req?.headers["idempotency-key"]).toBe(input.externalOrderId);
    expect(req?.body).toMatchObject({
      amount: 12_400,
      payment_method: "pix",
      external_reference: input.externalOrderId,
      buyer: { name: buyer.name, email: buyer.email, document: "52998224725", phone: "11987654321" },
      products: [
        { id: "item-1", name: "Curso de Confeitaria", quantity: 1, price_in_cents: 9_700 },
        { id: "item-2", name: "Apostila de recheios", quantity: 1, price_in_cents: 2_700 },
      ],
      // Só os campos de rastreamento que a ClownPay conhece (o ip não vai).
      tracking: { utm_source: "facebook", utm_campaign: "lancamento", src: "anuncio1" },
    });
  });

  it("status consultado pela API (pago, depois cancelado); Idempotency-Key repetida devolve a mesma cobrança", async () => {
    const input = pixInput();
    const charge = await clownpayGateway.createCharge(CLOWNPAY_KEY, input);
    expect(await clownpayGateway.getTransaction(CLOWNPAY_KEY, charge.id)).toMatchObject({
      id: charge.id,
      status: "pending",
      amountCents: 9_700,
      method: "pix",
      externalOrderId: input.externalOrderId,
      paidAt: null,
    });
    clown.setStatus(charge.id, "paid");
    const paid = await clownpayGateway.getTransaction(CLOWNPAY_KEY, charge.id);
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).not.toBeNull();
    // Mesma Idempotency-Key (mesmo pedido): a ClownPay devolve a cobrança já criada, sem criar outra.
    const before = clown.transactions.size;
    const again = await clownpayGateway.createCharge(CLOWNPAY_KEY, input);
    expect(again.id).toBe(charge.id);
    expect(clown.transactions.size).toBe(before);
    clown.setStatus(charge.id, "canceled");
    expect((await clownpayGateway.getTransaction(CLOWNPAY_KEY, charge.id)).status).toBe("canceled");
  });

  it("recusa o que não é PIX em real e quem compra sem os 4 dados (sem chamar a ClownPay)", async () => {
    const before = clown.requests.length;
    expect(await gatewayCode(clownpayGateway.createCharge(CLOWNPAY_KEY, pixInput({ currency: "MXN" })))).toBe(
      "invalid_request",
    );
    expect(await gatewayCode(clownpayGateway.createCharge(CLOWNPAY_KEY, pixInput({ method: "card" })))).toBe(
      "invalid_request",
    );
    expect(
      await gatewayCode(
        clownpayGateway.createCharge(CLOWNPAY_KEY, pixInput({ customer: { name: "Maria", email: "m@x.com" } })),
      ),
    ).toBe("invalid_request");
    expect(clown.requests.length).toBe(before);
  });

  it("erros e “Testar conexão”: chave recusada, conta em análise (403), fora do ar (503)", async () => {
    expect(await gatewayCode(clownpayGateway.createCharge("cp_live_errada0000000000", pixInput()))).toBe("invalid_key");
    expect(await gatewayCode(clownpayGateway.createCharge(CLOWNPAY_KEY_KYC, pixInput()))).toBe("missing_scope");
    expect(await gatewayCode(clownpayGateway.createCharge(CLOWNPAY_KEY_DOWN, pixInput()))).toBe("unavailable");
    expect(await gatewayCode(clownpayGateway.getTransaction(CLOWNPAY_KEY, "nao-existe-uuid"))).toBe("not_found");
    const before = clown.transactions.size;
    expect(await clownpayGateway.testConnection(CLOWNPAY_KEY)).toBe("ok");
    expect(clown.requests.at(-1)).toMatchObject({ method: "GET", path: "/v1/payments" });
    expect(await clownpayGateway.testConnection("cp_live_errada0000000000")).toBe("invalid_key");
    expect(await clownpayGateway.testConnection(CLOWNPAY_KEY_KYC)).toBe("missing_scope");
    expect(await clownpayGateway.testConnection(CLOWNPAY_KEY_DOWN)).toBe("unavailable");
    expect(clown.transactions.size).toBe(before);
  });

  it("status da ClownPay", () => {
    expect(["pending", "processing"].map(clownpayStatus)).toEqual(["pending", "pending"]);
    expect(clownpayStatus("paid")).toBe("paid");
    expect(clownpayStatus("failed")).toBe("failed");
    expect(clownpayStatus("canceled")).toBe("canceled");
    expect(clownpayStatus("refunded")).toBe("refunded");
    expect(clownpayStatus("chargeback")).toBe("disputed");
    expect(() => clownpayStatus("estranho")).toThrow(PaymentGatewayError);
  });

  it("endereço da API só troca por um endereço deste Mac", () => {
    const saved = process.env[CLOWNPAY_BASE_ENV];
    try {
      process.env[CLOWNPAY_BASE_ENV] = "https://evil.example.com";
      expect(clownpayApiBase()).toBe(CLOWNPAY_API_BASE);
      process.env[CLOWNPAY_BASE_ENV] = "http://127.0.0.1:9997/";
      expect(clownpayApiBase()).toBe("http://127.0.0.1:9997");
    } finally {
      process.env[CLOWNPAY_BASE_ENV] = saved;
    }
  });
});

describe("Kyvo não cobra PIX nem real", () => {
  it("recusa antes de chamar a Kyvo", async () => {
    expect(await gatewayCode(kyvoGateway.createCharge(KYVO_KEY, pixInput()))).toBe("invalid_request");
    expect(await gatewayCode(kyvoGateway.createCharge(KYVO_KEY, pixInput({ method: "card" })))).toBe("invalid_request");
  });
});

describe("leitura das respostas", () => {
  it("datas sem fuso são de Brasília; imagem do QR só em base64 de imagem", () => {
    expect(isoDate("2026-10-11 21:30:00")).toBe("2026-10-12T00:30:00.000Z");
    expect(isoDate("2026-10-11T21:30:00Z")).toBe("2026-10-11T21:30:00.000Z");
    expect(isoDate("amanhã")).toBeNull();
    expect(qrImageOf(`data:image/png;base64,${FAKE_QR_BASE64}`)).toBe(`data:image/png;base64,${FAKE_QR_BASE64}`);
    expect(qrImageOf("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(qrImageOf("javascript:alert(1)")).toBeNull();
    expect(qrImageOf("")).toBeNull();
  });
});
