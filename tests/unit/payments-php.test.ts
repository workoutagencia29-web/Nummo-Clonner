/**
 * pagamento.php do ZIP (Etapa 3 do pagamento na página).
 *
 * - Sempre: sintaxe PHP 7.4 (php-parser) do pagamento.php e do
 *   pagamento-dados/config.php, segredos só no config.php, escape da chave e
 *   dos textos, .htaccess que bloqueia a pasta, os mesmos códigos/limites do
 *   contrato (src/lib/payments/contract.ts).
 * - Com PHP de verdade (`php` do computador ou OS_PHP_BIN — ver
 *   export-php.test.ts para rodar com o PHP em WebAssembly), contra a Kyvo
 *   FALSA (tests/unit/kyvo-fake.ts; nunca a de verdade): `php -S` servindo a
 *   pasta como a hospedagem; criar (SPEI, cartão, Bizum, MB WAY), status e
 *   acesso com os mesmos contratos da prévia; valor e moeda só do config.php;
 *   pedido os_<código>_<20> = Idempotency-Key; metadata filtrada + ip/ua;
 *   origem, tamanho, campos, método × moeda, produto sem link de acesso,
 *   erros da Kyvo traduzidos (nunca crus), nova tentativa com a mesma
 *   Idempotency-Key, Kyvo fora do ar, limites por IP em pagamento-dados/, envio
 *   sem cURL (allow_url_fopen) e a chave nunca numa resposta.
 */
import type { ChildProcess } from "node:child_process";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Engine as PhpParser } from "php-parser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PAGAMENTO_CONFIG_DIR,
  PAGAMENTO_CONFIG_FILE,
  PAGAMENTO_CREATE_LIMIT,
  PAGAMENTO_HTACCESS_FILE,
  PAGAMENTO_KYVO_API,
  type PagamentoProduct,
  pagamentoConfigPhp,
  pagamentoHtaccess,
  pagamentoPhp,
} from "@/lib/export/payment-php";
import { PAYMENT_ERROR_STATUS, PAYMENT_MAX_BODY, PAYMENT_METADATA_KEYS } from "@/lib/payments/contract";
import { newExternalOrderId, orderProductCode } from "@/lib/payments/orders";
import { KYVO_API_BASE } from "@/server/services/payments/kyvo";
import { type FakeKyvo, KYVO_KEY, KYVO_KEY_DOWN, startFakeKyvo } from "./kyvo-fake";
import { findPhp, instrumentPagamento, startPhp, TEST_REMOTE_ROUTER } from "./php-server";

const parser = new PhpParser({ parser: { version: "7.4", extractDoc: false }, ast: { withPositions: false } });
const PHP = findPhp();

const ACCESS_MX = "https://membros.exemplo.com/reposteria?token=abc";
const ACCESS_US = "https://members.example.com/course";
const ACCESS_EU = "https://socios.ejemplo.es/curso";

const LONG_KEY = "upsell-do-curso-completo-de-reposteria-mexicana";
const PRODUCTS: PagamentoProduct[] = [
  {
    key: "checkout",
    code: orderProductCode("checkout", "link-checkout"),
    name: "Curso de Repostería",
    amountCents: 49700,
    currency: "MXN",
    methods: ["spei", "card"],
    thankYou: "obrigado/",
    accessUrl: ACCESS_MX,
  },
  {
    key: LONG_KEY,
    code: orderProductCode(LONG_KEY, "link-longo"),
    name: "Upsell",
    amountCents: 2900,
    currency: "USD",
    methods: ["card"],
    thankYou: null,
    accessUrl: ACCESS_US,
  },
  {
    key: "europa",
    code: orderProductCode("europa", "link-europa"),
    name: "Curso 'Europa'",
    amountCents: 1990,
    currency: "EUR",
    methods: ["card", "bizum", "mb_way"],
    thankYou: "",
    accessUrl: ACCESS_EU,
  },
  // Método que a moeda não aceita (só por config.php editado à mão): nunca cobra.
  {
    key: "errado",
    code: "errado",
    name: "Errado",
    amountCents: 1000,
    currency: "MXN",
    methods: ["bizum"],
    thankYou: null,
    accessUrl: ACCESS_MX,
  },
  // Sem link de acesso: não cobra (quem pagasse não receberia o produto).
  {
    key: "sem-acesso",
    code: "sem-acesso",
    name: "Sem acesso",
    amountCents: 1000,
    currency: "MXN",
    methods: ["spei"],
    thankYou: null,
    accessUrl: "",
  },
];

describe("pagamento.php gerado (sem PHP)", () => {
  it("é PHP 7.4 válido, sem segredos e com as regras do contrato", () => {
    const code = pagamentoPhp();
    expect(() => parser.parseCode(code, "pagamento.php")).not.toThrow();
    expect(code).not.toContain("${");
    expect(code).not.toMatch(/kyvo_(live|test)_/);
    expect(PAGAMENTO_KYVO_API).toBe(KYVO_API_BASE);
    expect(code).toContain(`const OS_API = '${KYVO_API_BASE}';`);
    expect(code).toContain(`const OS_MAX_BODY = ${PAYMENT_MAX_BODY};`);
    for (const [erro, status] of Object.entries(PAYMENT_ERROR_STATUS)) expect(code).toContain(`'${erro}' => ${status}`);
    for (const key of PAYMENT_METADATA_KEYS) expect(code).toContain(`'${key}'`);
    expect(code).toContain("'spei' => array('MXN')");
    expect(code).toContain("'mb_way' => array('EUR')");
    expect(code).toContain("'card' => array('MXN', 'EUR', 'USD')");
    // Sem eval, sem shell, sem mostrar erros do PHP.
    expect(code).not.toMatch(/\b(eval|exec|shell_exec|system|passthru|proc_open)\s*\(/);
    expect(code).toContain("error_reporting(0);");
    expect(code).toContain("define('OS_PAGAMENTO', 1);");
    // A mesma regra de chave do contrato (até 80, como as chaves de link).
    expect(code).toContain(`const OS_PRODUCT_RE = '/^[a-z0-9-]{1,80}$/';`);
    expect(code).not.toContain("{1,60}");
  });

  it("config.php: chave e textos escapados, nada impresso quando aberto direto", () => {
    const key = "kyvo_live_a'b\\c\u0000\n";
    const code = pagamentoConfigPhp({ apiKey: key, products: PRODUCTS });
    expect(() => parser.parseCode(code, "config.php")).not.toThrow();
    expect(code).toContain("'chave' => 'kyvo_live_a\\'b\\\\c',");
    expect(code).toContain("'nome' => 'Curso \\'Europa\\'',");
    expect(code).toContain("'valor' => 49700,");
    expect(code).toContain("'metodos' => array('card', 'bizum', 'mb_way'),");
    expect(code).toContain("'obrigado' => 'obrigado/',");
    expect(code).toContain("'obrigado' => null,");
    expect(code).toContain(`'codigo' => '${orderProductCode(LONG_KEY, "link-longo")}',`);
    expect(code).toContain("if (!defined('OS_PAGAMENTO')) {\n  http_response_code(404);\n  exit;\n}");
    expect(code).toContain("'trust_proxy' => false,");
    // Sem produto: ainda é PHP válido.
    expect(() => parser.parseCode(pagamentoConfigPhp({ apiKey: "", products: [] }), "c.php")).not.toThrow();
  });

  it(".htaccess bloqueia a pasta inteira (Apache 2.2 e 2.4)", () => {
    const h = pagamentoHtaccess();
    expect(h).toContain("Require all denied");
    expect(h).toContain("Deny from all");
    expect(PAGAMENTO_HTACCESS_FILE).toBe(`${PAGAMENTO_CONFIG_DIR}.htaccess`);
    expect(PAGAMENTO_CONFIG_FILE).toBe("pagamento-dados/config.php");
  });
});

describe.skipIf(!PHP)("pagamento.php no PHP de verdade (Kyvo falsa)", () => {
  let kyvo: FakeKyvo;
  let dir: string;
  let limitDir: string;
  let server: ChildProcess | null = null;
  let limitServer: ChildProcess | null = null;
  let origin = "";
  let limitOrigin = "";
  const responses: string[] = [];

  beforeAll(async () => {
    kyvo = await startFakeKyvo();
    dir = await mkdtemp(path.join(os.tmpdir(), "os-pagamento-php-"));
    await mkdir(path.join(dir, PAGAMENTO_CONFIG_DIR), { recursive: true });
    const code = instrumentPagamento(pagamentoPhp(), kyvo.base);
    await writeFile(path.join(dir, "pagamento.php"), code);
    // A mesma lógica sem cURL (hospedagem só com allow_url_fopen).
    const noCurl = code.replaceAll("function_exists('curl_init')", "false");
    expect(noCurl).not.toBe(code);
    await writeFile(path.join(dir, "sem-curl.php"), noCurl);
    await writeFile(
      path.join(dir, PAGAMENTO_CONFIG_FILE),
      pagamentoConfigPhp({ apiKey: KYVO_KEY, products: PRODUCTS }),
    );
    await writeFile(path.join(dir, PAGAMENTO_HTACCESS_FILE), pagamentoHtaccess());
    ({ server, origin } = await startPhp(PHP as string, dir, "/pagamento.php"));

    // Outro site: Kyvo fora do ar e limites baixos.
    limitDir = await mkdtemp(path.join(os.tmpdir(), "os-pagamento-limite-"));
    await mkdir(path.join(limitDir, PAGAMENTO_CONFIG_DIR), { recursive: true });
    await writeFile(
      path.join(limitDir, "pagamento.php"),
      instrumentPagamento(pagamentoPhp(), kyvo.base, { OS_CREATE_LIMIT: 2, OS_READ_LIMIT: 3 }),
    );
    await writeFile(
      path.join(limitDir, PAGAMENTO_CONFIG_FILE),
      pagamentoConfigPhp({ apiKey: KYVO_KEY_DOWN, products: PRODUCTS }),
    );
    ({ server: limitServer, origin: limitOrigin } = await startPhp(PHP as string, limitDir, "/pagamento.php"));
  }, 120_000);

  afterAll(async () => {
    server?.kill();
    limitServer?.kill();
    await kyvo?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
    if (limitDir) await rm(limitDir, { recursive: true, force: true });
  });

  async function post(
    body: unknown,
    opts: { file?: string; headers?: Record<string, string>; site?: string } = {},
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const site = opts.site ?? origin;
    const res = await fetch(`${site}/${opts.file ?? "pagamento.php"}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: site,
        referer: `${site}/loja/?utm_source=facebook&fbclid=IwAR_ABC&email=ana%40x.com#topo`,
        "user-agent": "Mozilla/5.0 Comprador",
        "x-forwarded-for": "200.150.10.20",
        ...opts.headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    responses.push(text);
    return { status: res.status, json: JSON.parse(text) };
  }

  const buyer = { nome: "  Ana   Pérez ", email: " Ana@Ejemplo.MX ", documento: "pepa800101hdf" };
  const lastCharge = () => [...kyvo.requests].reverse().find((r) => r.method === "POST");

  it("php -l aceita os arquivos gerados", () => {
    for (const file of ["pagamento.php", PAGAMENTO_CONFIG_FILE]) {
      const r = spawnSync(PHP as string, ["-l", path.join(dir, file)], { encoding: "utf8", timeout: 60_000 });
      expect(r.status, `${file}: ${r.stdout}${r.stderr}`).toBe(0);
    }
  });

  it("aberto no navegador: mostra que funciona, sem a chave nem os links de acesso", async () => {
    const res = await fetch(`${origin}/pagamento.php`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain("pagamento.php do Offer Studio funcionando.");
    expect(text).toContain("Chave da Kyvo: cadastrada");
    expect(text).toContain(`Produtos: ${PRODUCTS.length}`);
    expect(text).toContain("HTTPS: NÃO");
    expect(text).toContain("Limite por IP: ligado");
    expect(text).not.toContain(KYVO_KEY);
    expect(text).not.toContain("membros.exemplo.com");
  });

  it("pagamento-dados/config.php aberto direto: 404 sem conteúdo", async () => {
    const res = await fetch(`${origin}/${PAGAMENTO_CONFIG_FILE}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });

  it("criar SPEI: valor e moeda do config.php, pedido = Idempotency-Key, metadata filtrada com ip e ua", async () => {
    const r = await post({
      acao: "criar",
      produto: "checkout",
      metodo: "spei",
      ...buyer,
      valor: 1,
      moeda: "USD",
      metadata: { utm_source: "facebook", utm_campaign: " lancamento ", fbp: "fb.1.1.1", ip: "1.1.1.1", outro: "x" },
    });
    expect(r.status).toBe(201);
    const j = r.json;
    expect(j).toMatchObject({ ok: true, status: "pending", valor: 49700, moeda: "MXN", metodo: "spei" });
    expect(j.pedido).toMatch(/^tx_fake\d+$/);
    expect(j.pedidoExterno).toMatch(new RegExp(`^os_${orderProductCode("checkout", "link-checkout")}_[a-z0-9]{20}$`));
    expect(j.spei).toEqual({
      clabe: "646180157000000004",
      banco: "STP",
      titular: "Mi Tienda Ejemplo",
      referencia: "1234567",
      expiraEm: expect.any(String),
    });
    expect(j.cartao).toBeUndefined();
    expect(j.simulacao).toBeUndefined();

    const req = lastCharge();
    expect(req?.path).toBe("/api/v1/spei/charges");
    expect(req?.headers.authorization).toBe(`Bearer ${KYVO_KEY}`);
    expect(req?.headers["idempotency-key"]).toBe(j.pedidoExterno);
    expect(req?.body).toEqual({
      amount: 49700,
      customer: { name: "Ana Pérez", email: "ana@ejemplo.mx", document: "PEPA800101HDF" },
      externalOrderId: j.pedidoExterno,
      // Sem a query: fbclid e e-mail do endereço nunca vão à Kyvo (as UTMs seguem na metadata).
      sourceUrl: `${origin}/loja/`,
      metadata: {
        utm_source: "facebook",
        utm_campaign: "lancamento",
        fbp: "fb.1.1.1",
        // IP da conexão: o X-Forwarded-For só vale com trust_proxy.
        ip: "127.0.0.1",
        ua: "Mozilla/5.0 Comprador",
      },
    });
  });

  it("criar cartão (USD, chave longa) e Bizum/MB WAY (EUR): sessão do SDK como veio", async () => {
    const card = await post({ acao: "criar", produto: LONG_KEY, metodo: "card", ...buyer });
    expect(card.status).toBe(201);
    expect(card.json.pedidoExterno).toMatch(
      new RegExp(`^os_${orderProductCode(LONG_KEY, "link-longo")}_[a-z0-9]{20}$`),
    );
    expect(card.json).toMatchObject({ valor: 2900, moeda: "USD", metodo: "card" });
    expect(card.json.cartao).toEqual({
      sdkUrl: "https://kyvopay.com/sdk/card.js?v=1",
      sessao: {
        client_secret: `cs_${card.json.pedido}`,
        public_key: "pk_fake",
        account: "acct_fake",
        transaction_id: card.json.pedido,
      },
      expiraEm: expect.any(String),
    });
    expect(lastCharge()?.path).toBe("/api/v1/card/charges");
    expect(lastCharge()?.body).toMatchObject({ amount: 2900, currency: "USD" });
    expect((lastCharge()?.body as Record<string, unknown>).onlyMethods).toBeUndefined();

    for (const metodo of ["bizum", "mb_way"]) {
      const r = await post({ acao: "criar", produto: "europa", metodo, ...buyer });
      expect(r.status).toBe(201);
      expect(r.json).toMatchObject({ valor: 1990, moeda: "EUR", metodo });
      expect(lastCharge()?.body).toMatchObject({ amount: 1990, currency: "EUR", onlyMethods: [metodo] });
    }
  });

  it("método não ligado, método que a moeda não aceita e produto desconhecido", async () => {
    const before = kyvo.requests.length;
    expect(await post({ acao: "criar", produto: "checkout", metodo: "bizum", ...buyer })).toEqual({
      status: 400,
      json: { ok: false, erro: "metodo_indisponivel" },
    });
    expect((await post({ acao: "criar", produto: "errado", metodo: "bizum", ...buyer })).json.erro).toBe(
      "metodo_indisponivel",
    );
    expect(await post({ acao: "criar", produto: "nao-existe", metodo: "spei", ...buyer })).toEqual({
      status: 404,
      json: { ok: false, erro: "produto_desconhecido" },
    });
    // Chave longa (nome de link repetido: até 80) é aceita; só não existe aqui.
    expect((await post({ acao: "criar", produto: `${"a".repeat(75)}-2`, metodo: "spei", ...buyer })).json.erro).toBe(
      "produto_desconhecido",
    );
    // Sem link de acesso: não cobra.
    expect(await post({ acao: "criar", produto: "sem-acesso", metodo: "spei", ...buyer })).toEqual({
      status: 503,
      json: { ok: false, erro: "configuracao" },
    });
    expect(kyvo.requests.length).toBe(before);
  });

  it("pedidos inválidos, outra origem, corpo grande e a ação da prévia", async () => {
    const before = kyvo.requests.length;
    const invalid = [
      { acao: "criar", produto: "checkout", metodo: "spei", nome: "A", email: "a@b.mx" },
      { acao: "criar", produto: "checkout", metodo: "spei", nome: "Ana", email: "sem-arroba" },
      { acao: "criar", produto: "checkout", metodo: "spei", nome: "Ana", email: "a@b.mx", documento: "<x>" },
      { acao: "criar", produto: "CHECKOUT", metodo: "spei", nome: "Ana", email: "a@b.mx" },
      { acao: "criar", produto: "checkout", metodo: "pix", nome: "Ana", email: "a@b.mx" },
      { acao: "status", pedido: "../x", produto: "checkout" },
      { acao: "acesso", pedido: "tx_1", produto: "X Y" },
      { acao: "simular", pedido: "tx_fake000001", resultado: "pago" },
      { acao: "apagar" },
      ["criar"],
    ];
    for (const body of invalid) {
      expect(await post(body), JSON.stringify(body)).toEqual({ status: 400, json: { ok: false, erro: "invalido" } });
    }
    expect((await post("{nao é json")).json.erro).toBe("invalido");
    expect((await post({ acao: "status" }, { headers: { "content-type": "text/html" } })).json.erro).toBe("invalido");
    expect(await post({ acao: "status" }, { headers: { origin: "https://outro-site.com" } })).toEqual({
      status: 403,
      json: { ok: false, erro: "origem" },
    });
    // "Origin: null" (iframe sandbox de outro site): recusado, mesmo com um Referer do site.
    expect(
      await post({ acao: "criar", produto: "checkout", metodo: "card", ...buyer }, { headers: { origin: "null" } }),
    ).toEqual({ status: 403, json: { ok: false, erro: "origem" } });
    const big = JSON.stringify({ acao: "criar", x: "a".repeat(PAYMENT_MAX_BODY) });
    expect(await post(big)).toEqual({ status: 413, json: { ok: false, erro: "corpo_grande" } });

    // Sem Origin nem Referer (não é a página): 403.
    const res = await fetch(`${origin}/pagamento.php`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acao: "status", pedido: "tx_fake000001", produto: "checkout" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, erro: "origem" });
    const put = await fetch(`${origin}/pagamento.php`, { method: "PUT", headers: { origin } });
    expect(put.status).toBe(400);
    expect(kyvo.requests.length).toBe(before);
  });

  it("status: só do produto e só de pedidos criados por este site", async () => {
    const created = await post({ acao: "criar", produto: "checkout", metodo: "spei", ...buyer });
    const pedido = created.json.pedido as string;
    expect(await post({ acao: "status", pedido, produto: "checkout" })).toEqual({
      status: 200,
      json: {
        ok: true,
        pedido,
        status: "pending",
        pago: false,
        pedidoExterno: created.json.pedidoExterno,
        valor: 49700,
        moeda: "MXN",
      },
    });
    kyvo.setStatus(pedido, "paid");
    expect((await post({ acao: "status", pedido, produto: "checkout" })).json).toMatchObject({
      status: "paid",
      pago: true,
    });
    // Outro produto, transação de fora (sem o pedido do Offer Studio) e transação que não existe.
    expect((await post({ acao: "status", pedido, produto: "europa" })).json.erro).toBe("nao_encontrado");
    kyvo.transactions.set("tx_de_fora", {
      id: "tx_de_fora",
      status: "paid",
      amount: 49700,
      currency: "MXN",
      paymentMethod: "card",
      externalOrderId: "pedido-do-checkout-hospedado",
      metadata: null,
      createdAt: new Date().toISOString(),
      paidAt: new Date().toISOString(),
    });
    expect(await post({ acao: "status", pedido: "tx_de_fora", produto: "checkout" })).toEqual({
      status: 404,
      json: { ok: false, erro: "nao_encontrado" },
    });
    expect((await post({ acao: "status", pedido: "tx_nao_existe", produto: "checkout" })).json.erro).toBe(
      "nao_encontrado",
    );
  });

  it("acesso: só para pedido PAGO, com o link do produto do pedido", async () => {
    const a = await post({ acao: "criar", produto: "checkout", metodo: "spei", ...buyer });
    const b = await post({ acao: "criar", produto: "europa", metodo: "bizum", ...buyer });
    const pa = a.json.pedido as string;
    const pb = b.json.pedido as string;
    expect(await post({ acao: "acesso", pedido: pa })).toEqual({ status: 409, json: { ok: false, erro: "pendente" } });
    kyvo.setStatus(pa, "paid");
    expect(await post({ acao: "acesso", pedido: pa })).toEqual({
      status: 200,
      json: { ok: true, pedido: pa, status: "paid", acesso: ACCESS_MX, produto: "checkout" },
    });
    expect((await post({ acao: "acesso", pedido: pa, produto: "checkout" })).json.acesso).toBe(ACCESS_MX);
    // Pedir o acesso de outro produto com um pedido pago: nada.
    expect((await post({ acao: "acesso", pedido: pa, produto: "europa" })).json.erro).toBe("nao_encontrado");
    kyvo.setStatus(pb, "expired");
    expect(await post({ acao: "acesso", pedido: pb })).toEqual({ status: 403, json: { ok: false, erro: "nao_pago" } });
    kyvo.setStatus(pb, "paid");
    expect((await post({ acao: "acesso", pedido: pb })).json).toMatchObject({ acesso: ACCESS_EU, produto: "europa" });
    // Transação de fora da loja, mesmo paga: nada.
    expect((await post({ acao: "acesso", pedido: "tx_de_fora" })).json.erro).toBe("nao_encontrado");
  });

  it("pedido pago de OUTRA oferta com a mesma chave de link (mesma conta da Kyvo): nem status nem acesso", async () => {
    // "Checkout principal" vira "checkout" nas duas ofertas; o código do pedido leva o id do link.
    kyvo.transactions.set("tx_outra_oferta", {
      id: "tx_outra_oferta",
      status: "paid",
      amount: 900,
      currency: "MXN",
      paymentMethod: "spei",
      externalOrderId: newExternalOrderId("checkout", "link-de-outra-oferta"),
      metadata: null,
      createdAt: new Date().toISOString(),
      paidAt: new Date().toISOString(),
    });
    expect(await post({ acao: "acesso", pedido: "tx_outra_oferta" })).toEqual({
      status: 404,
      json: { ok: false, erro: "nao_encontrado" },
    });
    expect((await post({ acao: "acesso", pedido: "tx_outra_oferta", produto: "checkout" })).json.erro).toBe(
      "nao_encontrado",
    );
    expect((await post({ acao: "status", pedido: "tx_outra_oferta", produto: "checkout" })).json.erro).toBe(
      "nao_encontrado",
    );
  });

  it("erros da Kyvo viram os códigos do contrato (nunca a mensagem dela)", async () => {
    const declined = await post({
      acao: "criar",
      produto: LONG_KEY,
      metodo: "card",
      nome: "Ana DECLINE",
      email: "a@b.mx",
    });
    expect(declined).toEqual({ status: 402, json: { ok: false, erro: "recusado" } });
    kyvo.failNext(401, { error: { code: "invalid_api_key", message: "SEGREDO-DA-KYVO" } });
    expect(await post({ acao: "criar", produto: "checkout", metodo: "spei", ...buyer })).toEqual({
      status: 503,
      json: { ok: false, erro: "configuracao" },
    });
    kyvo.failNext(400, { error: { code: "amount_below_minimum", message: "SEGREDO-DA-KYVO" } });
    expect((await post({ acao: "criar", produto: "checkout", metodo: "spei", ...buyer })).json.erro).toBe(
      "configuracao",
    );
    kyvo.failNext(400, { error: { code: "bad_request", message: "SEGREDO-DA-KYVO" } });
    expect((await post({ acao: "criar", produto: "checkout", metodo: "spei", ...buyer })).json.erro).toBe("invalido");
    // Resposta fora do formato, ou SDK de outro endereço: não vai para a página.
    kyvo.failNext(201, { id: "tx_estranho" });
    expect((await post({ acao: "criar", produto: "checkout", metodo: "spei", ...buyer })).json.erro).toBe(
      "indisponivel",
    );
    kyvo.failNext(201, {
      id: "tx_sdk",
      status: "pending",
      amount: 2900,
      currency: "USD",
      instructions: { method: "card", card: { sdk_url: "https://evil.example/sdk.js", session: { a: 1 } } },
    });
    expect((await post({ acao: "criar", produto: LONG_KEY, metodo: "card", ...buyer })).json.erro).toBe("indisponivel");
    expect(responses.join("\n")).not.toContain("SEGREDO-DA-KYVO");
  });

  it("Kyvo instável: tenta de novo com a mesma Idempotency-Key (sem cobrar duas vezes)", async () => {
    kyvo.failNext(502, { error: { code: "provider_unavailable", message: "x" } });
    const before = kyvo.requests.length;
    const r = await post({ acao: "criar", produto: "checkout", metodo: "spei", ...buyer });
    expect(r.status).toBe(201);
    const posts = kyvo.requests.slice(before);
    expect(posts).toHaveLength(2);
    expect(posts[0].headers["idempotency-key"]).toBe(r.json.pedidoExterno);
    expect(posts[1].headers["idempotency-key"]).toBe(r.json.pedidoExterno);
    expect(posts[0].body).toEqual(posts[1].body);
  });

  it("sem cURL (só allow_url_fopen): cria e consulta igual", async () => {
    const r = await post({ acao: "criar", produto: "checkout", metodo: "spei", ...buyer }, { file: "sem-curl.php" });
    expect(r.status).toBe(201);
    expect(lastCharge()?.headers["idempotency-key"]).toBe(r.json.pedidoExterno);
    kyvo.setStatus(r.json.pedido as string, "paid");
    expect((await post({ acao: "acesso", pedido: r.json.pedido }, { file: "sem-curl.php" })).json.acesso).toBe(
      ACCESS_MX,
    );
    expect(
      (await post({ acao: "status", pedido: "tx_nao_existe", produto: "checkout" }, { file: "sem-curl.php" })).json
        .erro,
    ).toBe("nao_encontrado");
  });

  it("limites por IP em pagamento-dados/limites (arquivos que não mostram nada) e Kyvo fora do ar", async () => {
    const create = () => post({ acao: "criar", produto: "checkout", metodo: "spei", ...buyer }, { site: limitOrigin });
    // KYVO_KEY_DOWN: a Kyvo responde 502 (duas tentativas) → indisponivel.
    expect(await create()).toEqual({ status: 502, json: { ok: false, erro: "indisponivel" } });
    expect((await create()).json.erro).toBe("indisponivel");
    expect(await create()).toEqual({ status: 429, json: { ok: false, erro: "limite" } });
    const status = () => post({ acao: "status", pedido: "tx_fake000001", produto: "checkout" }, { site: limitOrigin });
    for (let i = 0; i < 3; i++) expect((await status()).json.erro).toBe("indisponivel");
    expect((await status()).json.erro).toBe("limite");

    const files = await readdir(path.join(limitDir, PAGAMENTO_CONFIG_DIR, "limites"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f).toMatch(/^(criar|criar-rede|criar-email|criar-site|consulta)-[0-9a-f]{2}\.php$/);
      const res = await fetch(`${limitOrigin}/${PAGAMENTO_CONFIG_DIR}limites/${f}`);
      expect(await res.text()).toBe("");
    }
    // O limite padrão é folgado para quem tenta outro cartão.
    expect(PAGAMENTO_CREATE_LIMIT).toBeGreaterThanOrEqual(10);
  }, 60_000);

  it("limites: IPv6 por /64 e /48, teto do site só para quem já criou várias, cartão por e-mail", async () => {
    const netDir = await mkdtemp(path.join(os.tmpdir(), "os-pagamento-rede-"));
    let netServer: ChildProcess | null = null;
    try {
      await mkdir(path.join(netDir, PAGAMENTO_CONFIG_DIR), { recursive: true });
      await writeFile(
        path.join(netDir, "pagamento.php"),
        instrumentPagamento(pagamentoPhp(), kyvo.base, {
          OS_CREATE_LIMIT: 2,
          OS_CREATE_NET_LIMIT: 4,
          OS_CREATE_FREE: 1,
          OS_CREATE_TOTAL: 3,
          OS_CARD_EMAIL_LIMIT: 2,
        }),
      );
      await writeFile(
        path.join(netDir, PAGAMENTO_CONFIG_FILE),
        pagamentoConfigPhp({ apiKey: KYVO_KEY, products: PRODUCTS }),
      );
      await writeFile(path.join(netDir, "router.php"), TEST_REMOTE_ROUTER);
      const started = await startPhp(PHP as string, netDir, "/pagamento.php", path.join(netDir, "router.php"));
      netServer = started.server;
      const from = (ip: string, metodo = "spei", email = "ana@ejemplo.mx") =>
        post(
          { acao: "criar", produto: metodo === "spei" ? "checkout" : LONG_KEY, metodo, nome: "Ana", email },
          { site: started.origin, headers: { "x-test-remote": ip } },
        ).then((r) => (r.status === 201 ? 201 : r.json.erro));

      // Mesmo /64: endereços diferentes contam juntos.
      expect(await from("2001:db8:1:2::1")).toBe(201);
      expect(await from("2001:db8:1:2::1")).toBe(201); // 2ª deste IP: conta no teto do site (1 de 3)
      expect(await from("2001:db8:1:2::2")).toBe("limite");
      // Outro /64 da mesma rede /48: passa até o limite da rede.
      expect(await from("2001:db8:1:3::1")).toBe(201);
      expect(await from("2001:db8:1:4::1")).toBe(201);
      expect(await from("2001:db8:1:5::1")).toBe("limite");
      // Rede diferente: livre.
      expect(await from("2001:db8:9:1::1")).toBe(201);

      // Teto do site: só para quem já criou mais que as livres; quem chega passa sempre.
      expect(await from("203.0.113.10")).toBe(201);
      expect(await from("203.0.113.10")).toBe(201); // teto 2 de 3
      expect(await from("203.0.113.11")).toBe(201);
      expect(await from("203.0.113.11")).toBe(201); // teto 3 de 3
      expect(await from("203.0.113.12")).toBe(201);
      expect(await from("203.0.113.12")).toBe("limite"); // passou do teto do site
      expect(await from("203.0.113.13")).toBe(201); // comprador novo: nunca barrado pelo teto

      // Cartão: no máximo OS_CARD_EMAIL_LIMIT cobranças por e-mail, de qualquer IP; SPEI não conta.
      expect(await from("203.0.113.20", "card", "teste@cartao.co")).toBe(201);
      expect(await from("203.0.113.21", "card", "teste@cartao.co")).toBe(201);
      expect(await from("203.0.113.22", "card", "teste@cartao.co")).toBe("limite");
      expect(await from("203.0.113.23", "card", "outro@cartao.co")).toBe(201);
      expect(await from("203.0.113.24", "spei", "teste@cartao.co")).toBe(201);
    } finally {
      netServer?.kill();
      await rm(netDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("a chave nunca aparece numa resposta", () => {
    expect(responses.length).toBeGreaterThan(20);
    const all = responses.join("\n");
    expect(all).not.toContain(KYVO_KEY);
    expect(all).not.toContain(KYVO_KEY_DOWN);
  });
});
