/**
 * Motor da função serverless (Vercel/Netlify): o fluxo de ponta a ponta contra
 * os gateways FALSOS (nunca as APIs de verdade), e as garantias do token
 * lacrado (forjar, adulterar, segredo errado/ausente, janela de acesso).
 *
 * Checkout do Offer Studio (PIX pela FlevoPay) e pagamento na página (SPEI pela
 * Kyvo) num só handler, como no pagamento.php.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCheckoutConfig } from "@/lib/checkout/config";
import { CHECKOUT_ORDER_RE } from "@/lib/checkout/contract";
import { ORDER_ID_RE } from "@/lib/payments/contract";
import type { ServerlessConfig, ServerlessProvider } from "@/server/services/payments/serverless/config";
import { handleServerlessPayment, type ServerlessDeps } from "@/server/services/payments/serverless/engine";
import { type FakeKyvo, KYVO_KEY, startFakeKyvo } from "./kyvo-fake";
import { FAKE_PIX_CODE, type FakePix, FLEVO_KEY, startFakeFlevopay } from "./pix-fakes";

let flevo: FakePix;
let kyvo: FakeKyvo;

beforeAll(async () => {
  flevo = await startFakeFlevopay();
  kyvo = await startFakeKyvo();
  process.env.OS_FLEVOPAY_API_BASE = flevo.base;
  process.env.OS_KYVO_API_BASE = kyvo.base;
});

afterAll(async () => {
  delete process.env.OS_FLEVOPAY_API_BASE;
  delete process.env.OS_KYVO_API_BASE;
  await flevo.close();
  await kyvo.close();
});

const SECRET = randomBytes(32);

function baseConfig(): ServerlessConfig {
  const curso = parseCheckoutConfig({
    fields: { name: true, email: true, phone: true, document: true },
    address: false,
    bumps: [{ id: "bump0001", title: "Bônus exclusivo", priceCents: 1000, accessUrl: "https://curso.exemplo/bonus" }],
    maxQuantity: 1,
  });
  return {
    v: 1,
    payments: [
      {
        key: "mentoria",
        linkId: "link_mentoria_0001",
        name: "Mentoria",
        amountCents: 50000,
        currency: "MXN",
        methods: ["SPEI"],
        accessUrl: "https://mentoria.exemplo/acesso",
      },
    ],
    checkouts: [
      {
        key: "curso",
        linkId: "link_curso_0001",
        provider: "FLEVOPAY",
        name: "Curso completo",
        amountCents: 4990,
        currency: "BRL",
        methods: ["PIX"],
        locale: "PT",
        accessUrl: "https://curso.exemplo/acesso",
        config: {
          fields: curso.fields,
          address: curso.address,
          shipping: curso.shipping,
          bumps: curso.bumps,
          maxQuantity: curso.maxQuantity,
        },
      },
    ],
  };
}

function deps(over: Partial<ServerlessDeps> = {}): ServerlessDeps {
  const key = (p: ServerlessProvider) => (p === "FLEVOPAY" ? FLEVO_KEY : p === "KYVO" ? KYVO_KEY : null);
  return { config: baseConfig(), key, secret: SECRET, now: () => Date.now(), ...over };
}

const BUYER = { nome: "João Silva", email: "joao@exemplo.com.br", telefone: "11987654321", documento: "52998224725" };

function lastFlevoGid(): string {
  return [...flevo.transactions.values()].at(-1)?.id as string;
}
function lastKyvoGid(): string {
  return [...kyvo.transactions.values()].at(-1)?.id as string;
}

describe("checkout do Offer Studio (PIX pela FlevoPay) na função serverless", () => {
  it("criar → status(pendente) → pagar → status(pago) → acesso", async () => {
    const d = deps();
    const criar = await handleServerlessPayment(
      { acao: "checkout_criar", checkout: "curso", metodo: "pix", bumps: [], frete: null, ...BUYER },
      d,
    );
    expect(criar.status).toBe(201);
    const body = criar.body as {
      ok: boolean;
      pedido: string;
      pedidoExterno: string;
      valor: number;
      pix: { codigo: string };
      agora: number;
    };
    expect(body.ok).toBe(true);
    expect(body.valor).toBe(4990);
    expect(body.pix.codigo).toBe(FAKE_PIX_CODE);
    expect(body.pedidoExterno.startsWith("os_")).toBe(true);
    expect(typeof body.agora).toBe("number");

    // A credencial é o token lacrado (ck_…), nunca o id da cobrança no gateway.
    const pedido = body.pedido;
    expect(pedido.startsWith("ck_")).toBe(true);
    expect(CHECKOUT_ORDER_RE.test(pedido)).toBe(true);
    expect(ORDER_ID_RE.test(pedido)).toBe(true);
    const gid = lastFlevoGid();
    expect(pedido).not.toContain(gid);

    const pend = await handleServerlessPayment({ acao: "checkout_status", checkout: "curso", pedido }, d);
    expect((pend.body as { pago: boolean }).pago).toBe(false);

    flevo.setStatus(gid, "paid");
    const pago = await handleServerlessPayment({ acao: "checkout_status", checkout: "curso", pedido }, d);
    expect(pago.status).toBe(200);
    expect((pago.body as { pago: boolean; status: string }).pago).toBe(true);

    const acesso = await handleServerlessPayment({ acao: "acesso", pedido }, d);
    expect(acesso.status).toBe(200);
    const ab = acesso.body as { acesso: string; produto: string; extras: unknown[] };
    expect(ab.acesso).toBe("https://curso.exemplo/acesso");
    expect(ab.produto).toBe("curso");
    expect(ab.extras).toEqual([]);
  });

  it("acesso pedido antes de pagar → pendente (409)", async () => {
    const d = deps();
    const criar = await handleServerlessPayment(
      { acao: "checkout_criar", checkout: "curso", metodo: "pix", bumps: [], frete: null, ...BUYER },
      d,
    );
    const pedido = (criar.body as { pedido: string }).pedido;
    const acesso = await handleServerlessPayment({ acao: "acesso", pedido }, d);
    expect(acesso.status).toBe(409);
    expect((acesso.body as { erro: string }).erro).toBe("pendente");
  });

  it("bump comprado vira um extra no acesso", async () => {
    const d = deps();
    const criar = await handleServerlessPayment(
      { acao: "checkout_criar", checkout: "curso", metodo: "pix", bumps: ["bump0001"], frete: null, ...BUYER },
      d,
    );
    const pedido = (criar.body as { pedido: string; valor: number }).pedido;
    expect((criar.body as { valor: number }).valor).toBe(5990); // produto + bump
    flevo.setStatus(lastFlevoGid(), "paid");
    const acesso = await handleServerlessPayment({ acao: "acesso", pedido }, d);
    const extras = (acesso.body as { extras: { titulo: string; acesso: string }[] }).extras;
    expect(extras).toEqual([{ titulo: "Bônus exclusivo", acesso: "https://curso.exemplo/bonus" }]);
  });

  it("forma de pagamento não ligada no produto → metodo_indisponivel", async () => {
    const r = await handleServerlessPayment(
      { acao: "checkout_criar", checkout: "curso", metodo: "spei", bumps: [], frete: null, ...BUYER },
      deps(),
    );
    expect((r.body as { erro: string }).erro).toBe("metodo_indisponivel");
  });
});

describe("garantias do token lacrado", () => {
  async function freshToken(d: ServerlessDeps): Promise<string> {
    const r = await handleServerlessPayment(
      { acao: "checkout_criar", checkout: "curso", metodo: "pix", bumps: [], frete: null, ...BUYER },
      d,
    );
    return (r.body as { pedido: string }).pedido;
  }

  it("token adulterado não abre → nao_encontrado", async () => {
    const d = deps();
    const pedido = await freshToken(d);
    const mexido = pedido.slice(0, -1) + (pedido.at(-1) === "A" ? "B" : "A");
    const r = await handleServerlessPayment({ acao: "checkout_status", checkout: "curso", pedido: mexido }, d);
    expect(r.status).toBe(404);
    expect((r.body as { erro: string }).erro).toBe("nao_encontrado");
  });

  it("token de outra instalação (segredo diferente) não abre → nao_encontrado", async () => {
    const pedido = await freshToken(deps());
    const outro = deps({ secret: randomBytes(32) });
    const r = await handleServerlessPayment({ acao: "checkout_status", checkout: "curso", pedido }, outro);
    expect((r.body as { erro: string }).erro).toBe("nao_encontrado");
  });

  it("sem OS_PAY_SECRET a função recusa (falha fechada): criar e status → configuracao", async () => {
    const semSegredo = deps({ secret: null });
    const criar = await handleServerlessPayment(
      { acao: "checkout_criar", checkout: "curso", metodo: "pix", bumps: [], frete: null, ...BUYER },
      semSegredo,
    );
    expect(criar.status).toBe(503);
    expect((criar.body as { erro: string }).erro).toBe("configuracao");
    const status = await handleServerlessPayment(
      { acao: "checkout_status", checkout: "curso", pedido: `ck_${"A1b2".repeat(60)}` },
      semSegredo,
    );
    expect((status.body as { erro: string }).erro).toBe("configuracao");
  });

  it("acesso com a janela vencida (180 dias) não libera", async () => {
    const d = deps();
    const pedido = await freshToken(d);
    flevo.setStatus(lastFlevoGid(), "paid");
    const futuro = deps({ now: () => Date.now() + 181 * 24 * 60 * 60 * 1000 });
    const r = await handleServerlessPayment({ acao: "acesso", pedido }, futuro);
    expect((r.body as { erro: string }).erro).toBe("nao_encontrado");
  });

  it("produto trocado/removido do config (rebind): o acesso some → nao_encontrado", async () => {
    const d = deps();
    const pedido = await freshToken(d);
    flevo.setStatus(lastFlevoGid(), "paid");
    const semProduto: ServerlessDeps = { ...d, config: { v: 1, payments: [], checkouts: [] } };
    const r = await handleServerlessPayment({ acao: "acesso", pedido }, semProduto);
    expect((r.body as { erro: string }).erro).toBe("nao_encontrado");
  });
});

describe("pagamento na página (SPEI pela Kyvo) na função serverless", () => {
  it("criar → status → pagar → acesso", async () => {
    const d = deps();
    const criar = await handleServerlessPayment(
      { acao: "criar", produto: "mentoria", metodo: "spei", nome: "Ana", email: "ana@exemplo.com" },
      d,
    );
    expect(criar.status).toBe(201);
    const body = criar.body as { pedido: string; pedidoExterno: string; spei: { clabe: string } };
    // No pagamento na página o pedido é o id da cobrança da Kyvo (tx_…), como no pagamento.php.
    expect(body.pedido.startsWith("tx_")).toBe(true);
    expect(body.spei.clabe).toBe("646180157000000004");
    const gid = lastKyvoGid();
    expect(body.pedido).toBe(gid);

    const pend = await handleServerlessPayment({ acao: "status", produto: "mentoria", pedido: gid }, d);
    expect((pend.body as { pago: boolean }).pago).toBe(false);

    kyvo.setStatus(gid, "paid");
    const pago = await handleServerlessPayment({ acao: "status", produto: "mentoria", pedido: gid }, d);
    expect((pago.body as { pago: boolean }).pago).toBe(true);

    const acesso = await handleServerlessPayment({ acao: "acesso", pedido: gid }, d);
    expect((acesso.body as { acesso: string }).acesso).toBe("https://mentoria.exemplo/acesso");
  });
});

describe("despachante", () => {
  it("não existe simulação na função publicada → invalido", async () => {
    const r = await handleServerlessPayment(
      { acao: "simular", pedido: "ck_xxxxxxxxxxxxxxxx", resultado: "pago" },
      deps(),
    );
    expect(r.status).toBe(400);
    expect((r.body as { erro: string }).erro).toBe("invalido");
  });

  it("criação limitada por IP → limite", async () => {
    const r = await handleServerlessPayment(
      { acao: "checkout_criar", checkout: "curso", metodo: "pix", bumps: [], frete: null, ...BUYER },
      deps({ rateLimited: () => true }),
    );
    expect((r.body as { erro: string }).erro).toBe("limite");
  });

  it("produto desconhecido → produto_desconhecido", async () => {
    const r = await handleServerlessPayment(
      { acao: "checkout_criar", checkout: "naoexiste", metodo: "pix", bumps: [], frete: null, ...BUYER },
      deps(),
    );
    expect((r.body as { erro: string }).erro).toBe("produto_desconhecido");
  });
});
