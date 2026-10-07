/**
 * Pagamento na página na PRÉVIA do app (src/preview/server.ts): sempre em
 * simulação — página com data-os-pay e #os-pagamento (simulacao: true) e o
 * endpoint POST /__os/pagamento com o contrato do pagamento.php (criar SPEI e
 * cartão, status, simular, acesso só para pedido pago e do mesmo produto,
 * erros). Sobe o servidor de prévia de verdade numa porta livre, com o banco
 * de testes. Nenhuma chamada vai para a Kyvo (o endereço da API aponta para
 * uma porta fechada: se a prévia tentasse cobrar de verdade, o teste falharia).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { request } from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { PAYMENT_MAX_BODY, readPaymentConfig } from "@/lib/payments/contract";
import { createPreviewToken } from "@/lib/preview";
import { createOfferLink } from "@/server/services/offer-links";
import { createOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { savePaymentGatewayKey } from "@/server/services/payments/gateways";
import { savePaymentProduct } from "@/server/services/payments/products";
import { resetDatabase } from "../setup/per-file";
import { type FakeKyvo, KYVO_KEY, startFakeKyvo } from "./kyvo-fake";

const ROOT = path.resolve(import.meta.dirname, "../..");
let port = 0;
let child: ChildProcess | null = null;
let output = "";
let kyvo: FakeKyvo;

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = (srv.address() as { port: number }).port;
      srv.close(() => resolve(p));
    });
  });
}

interface Res {
  status: number;
  body: string;
  json: Record<string, unknown>;
}

function call(
  token: string,
  pathname: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method: opts.method ?? "GET",
        headers: { host: `${token}.localhost:${port}`, ...(opts.headers ?? {}) },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => {
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(body);
          } catch {
            json = {};
          }
          resolve({ status: res.statusCode ?? 0, body, json });
        });
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const origin = (token: string) => `http://${token}.localhost:${port}`;

function pay(token: string, body: unknown, headers: Record<string, string> = {}) {
  return call(token, "/__os/pagamento", {
    method: "POST",
    headers: { origin: origin(token), "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toMatch(/\/offerstudio_test_\d+$/);
  kyvo = await startFakeKyvo();
  port = await freePort();
  child = spawn(path.join(ROOT, "node_modules/.bin/tsx"), ["src/preview/server.ts"], {
    cwd: ROOT,
    // Kyvo "de verdade" da prévia = servidor falso: se a prévia chamasse a API, apareceria em kyvo.requests.
    env: { ...process.env, PREVIEW_PORT: String(port), OS_KYVO_API_BASE: kyvo.base },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (c) => {
    output += String(c);
  });
  child.stderr?.on("data", (c) => {
    output += String(c);
  });
  const deadline = Date.now() + 30_000;
  while (!output.includes("servidor de prévia")) {
    if (Date.now() > deadline || child.exitCode !== null) throw new Error(`prévia não subiu:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}, 60_000);

afterAll(async () => {
  child?.kill("SIGTERM");
  await kyvo?.close();
  // A prévia nunca falou com a Kyvo (nem a falsa).
  expect(kyvo.requests).toEqual([]);
});

beforeEach(async () => {
  await resetDatabase();
});

const HTML =
  '<!DOCTYPE html><html><head><title>Oferta</title></head><body><a id="comprar" data-os-link="checkout" href="https://pay.hotmart.com/ANTIGO">Comprar</a><a data-os-link="europa" href="#">Comprar EUR</a></body></html>';

async function paymentOffer() {
  const offer = await createOffer({ name: "Oferta" });
  const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
  const thanks = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
  await prisma.pageDocument.updateMany({ where: { variant: { pageId: home.id } }, data: { html: HTML } });
  const mx = await createOfferLink(offer.id, { label: "Checkout", url: "", kind: "CHECKOUT" });
  const eu = await createOfferLink(offer.id, { label: "Europa", url: "", kind: "UPSELL" });
  await savePaymentGatewayKey("KYVO", KYVO_KEY);
  await savePaymentProduct(mx.id, {
    name: "Curso México",
    amount: "297",
    currency: "MXN",
    methods: ["SPEI", "CARD"],
    locale: "ES",
    thankYouPageId: thanks.id,
    accessUrl: "https://membros.exemplo.com/mx",
  });
  await savePaymentProduct(eu.id, {
    name: "Curso Europa",
    amount: "29,90",
    currency: "EUR",
    methods: ["BIZUM"],
    locale: "PT",
    thankYouPageId: thanks.id,
    accessUrl: "",
  });
  const token = await createPreviewToken({ kind: "offer", offerId: offer.id });
  return { offerId: offer.id, thanksId: thanks.id, token };
}

const criar = (extra: Record<string, unknown> = {}) => ({
  acao: "criar",
  produto: "checkout",
  metodo: "spei",
  nome: "María López",
  email: "maria@ejemplo.mx",
  metadata: { utm_source: "facebook" },
  ...extra,
});

describe("página da prévia", () => {
  it("botões de pagamento e #os-pagamento em simulação (sem link de acesso nem chave)", async () => {
    const o = await paymentOffer();
    const res = await call(o.token, "/");
    expect(res.status).toBe(200);
    expect(res.body).toContain('<a id="comprar" data-os-link="checkout" href="#" data-os-pay="checkout">');
    expect(res.body).not.toContain("pay.hotmart.com/ANTIGO");
    expect(res.body).not.toContain("membros.exemplo.com");
    expect(res.body).not.toContain(KYVO_KEY.slice(0, 16));
    const json = /<script type="application\/json" id="os-pagamento">([\s\S]*?)<\/script>/.exec(res.body)?.[1];
    const cfg = readPaymentConfig(json);
    expect(cfg).toMatchObject({ endpoint: "/__os/pagamento", simulacao: true });
    expect(cfg?.produtos.checkout).toEqual({
      nome: "Curso México",
      valor: 29_700,
      moeda: "MXN",
      metodos: ["spei", "card"],
      idioma: "es",
      obrigado: `/p/${o.thanksId}`,
    });
    expect(cfg?.produtos.europa).toMatchObject({ moeda: "EUR", metodos: ["bizum"], idioma: "pt" });
  });
});

describe("POST /__os/pagamento (simulação)", () => {
  it("SPEI: dados de exemplo, status pendente, simular pago e acesso só depois", async () => {
    const o = await paymentOffer();
    const created = await pay(o.token, criar());
    expect(created.status).toBe(201);
    const c = created.json as Record<string, unknown> & { spei: Record<string, string> };
    expect(c).toMatchObject({
      ok: true,
      status: "pending",
      valor: 29_700,
      moeda: "MXN",
      metodo: "spei",
      simulacao: true,
    });
    expect(c.pedido).toMatch(/^sim_/);
    expect(c.pedidoExterno).toMatch(/^os_checkout-[0-9a-f]{10}_[a-z0-9]{20}$/);
    expect(c.spei.clabe).toMatch(/^\d{18}$/);
    expect(c.spei.titular).toMatch(/SIMULACIÓN/);
    expect(c).not.toHaveProperty("cartao");

    const status = await pay(o.token, { acao: "status", pedido: c.pedido, produto: "checkout" });
    expect(status.json).toEqual({
      ok: true,
      pedido: c.pedido,
      status: "pending",
      pago: false,
      pedidoExterno: c.pedidoExterno,
      valor: 29_700,
      moeda: "MXN",
    });
    // Pendente: ainda sem acesso.
    expect(await pay(o.token, { acao: "acesso", pedido: c.pedido })).toMatchObject({
      status: 409,
      json: { ok: false, erro: "pendente" },
    });
    // Status de outro produto: não encontra (o pedido é do checkout).
    expect((await pay(o.token, { acao: "status", pedido: c.pedido, produto: "europa" })).json).toEqual({
      ok: false,
      erro: "nao_encontrado",
    });

    const paid = await pay(o.token, { acao: "simular", pedido: c.pedido, resultado: "pago" });
    expect(paid.json).toMatchObject({ status: "paid", pago: true });
    expect((await pay(o.token, { acao: "acesso", pedido: c.pedido })).json).toEqual({
      ok: true,
      pedido: c.pedido,
      status: "paid",
      acesso: "https://membros.exemplo.com/mx",
      produto: "checkout",
    });
    // Com o produto da página de obrigado: só o mesmo produto.
    expect((await pay(o.token, { acao: "acesso", pedido: c.pedido, produto: "europa" })).json).toEqual({
      ok: false,
      erro: "nao_encontrado",
    });
  });

  it("cartão/Bizum: sessão simulada sem SDK; recusado e expirado não dão acesso", async () => {
    const o = await paymentOffer();
    const card = await pay(o.token, criar({ metodo: "card" }));
    expect(card.status).toBe(201);
    expect(card.json.cartao).toMatchObject({ sdkUrl: "", sessao: { simulacao: true } });
    const declined = await pay(o.token, { acao: "simular", pedido: card.json.pedido, resultado: "recusado" });
    expect(declined.json).toMatchObject({ status: "failed", pago: false });
    expect((await pay(o.token, { acao: "acesso", pedido: card.json.pedido })).json).toEqual({
      ok: false,
      erro: "nao_pago",
    });

    const bizum = await pay(o.token, criar({ produto: "europa", metodo: "bizum", nome: "João Silva" }));
    expect(bizum.json).toMatchObject({ valor: 2_990, moeda: "EUR", metodo: "bizum" });
    await pay(o.token, { acao: "simular", pedido: bizum.json.pedido, resultado: "expirado" });
    expect((await pay(o.token, { acao: "status", pedido: bizum.json.pedido, produto: "europa" })).json).toMatchObject({
      status: "expired",
    });
    // Pago, mas o produto está sem link de acesso: erro de configuração (nada vaza).
    await pay(o.token, { acao: "simular", pedido: bizum.json.pedido, resultado: "pago" });
    expect(await pay(o.token, { acao: "acesso", pedido: bizum.json.pedido })).toMatchObject({
      status: 503,
      json: { ok: false, erro: "configuracao" },
    });
  });

  it("valor e moeda vêm do produto, nunca do navegador; método não ligado é recusado", async () => {
    const o = await paymentOffer();
    const res = await pay(o.token, criar({ valor: 1, moeda: "USD" }));
    expect(res.json).toMatchObject({ valor: 29_700, moeda: "MXN" });
    expect(await pay(o.token, criar({ metodo: "bizum" }))).toMatchObject({
      status: 400,
      json: { erro: "metodo_indisponivel" },
    });
    expect(await pay(o.token, criar({ produto: "nao-existe" }))).toMatchObject({
      status: 404,
      json: { erro: "produto_desconhecido" },
    });
  });

  it("recusa outro site, corpo grande, JSON inválido e pedido de outra oferta", async () => {
    const o = await paymentOffer();
    expect(await pay(o.token, criar(), { origin: "https://evil.example.com" })).toMatchObject({
      status: 403,
      json: { ok: false, erro: "origem" },
    });
    expect(await pay(o.token, criar(), { "content-type": "application/x-www-form-urlencoded" })).toMatchObject({
      status: 400,
      json: { erro: "invalido" },
    });
    expect(await pay(o.token, JSON.stringify(criar({ nome: "x".repeat(PAYMENT_MAX_BODY) })))).toMatchObject({
      status: 413,
      json: { erro: "corpo_grande" },
    });
    expect(await pay(o.token, "{nao é json")).toMatchObject({ status: 400, json: { erro: "invalido" } });
    expect(await pay(o.token, { acao: "criar" })).toMatchObject({ status: 400, json: { erro: "invalido" } });

    const created = await pay(o.token, criar());
    const other = await createOffer({ name: "Outra" });
    const otherToken = await createPreviewToken({ kind: "offer", offerId: other.id });
    expect((await pay(otherToken, { acao: "acesso", pedido: created.json.pedido })).json).toEqual({
      ok: false,
      erro: "nao_encontrado",
    });
    // GET no endpoint não existe.
    expect((await call(o.token, "/__os/pagamento")).status).toBe(404);
  });
});
