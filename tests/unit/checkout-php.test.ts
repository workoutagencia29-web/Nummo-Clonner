/**
 * Checkout do Offer Studio no pagamento.php do ZIP (fase 3).
 *
 * - Sempre: sintaxe PHP 7.4 (php-parser) com os checkouts no config.php,
 *   textos escapados, as regras do servidor da prévia resolvidas no
 *   config.php (pagamentoCheckoutOf: gateway × moeda, formas, campos pedidos,
 *   endereço só no real, faixas) e as constantes do contrato.
 * - Com PHP de verdade (`php` do computador ou OS_PHP_BIN — ver
 *   export-php.test.ts), contra a FlevoPay, a BlackCat e a Kyvo FALSAS
 *   (tests/unit/pix-fakes.ts, kyvo-fake.ts; nunca as de verdade): PIX da
 *   FlevoPay e da BlackCat (corpo como a documentação pede, total SÓ do
 *   config.php, pedido público ck_… ≠ id do gateway), status conferido na API,
 *   webhook que nunca vale sozinho, acesso do produto e dos bumps só para pago
 *   do mesmo produto, Kyvo (SPEI) nas outras moedas, erros do contrato,
 *   pedidos guardados sem dados pessoais, webhook no endereço da cobrança com
 *   HTTPS e os limites.
 */
import type { ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Engine as PhpParser } from "php-parser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHECKOUT_ORDER_RE } from "@/lib/checkout/contract";
import { isValidCpf } from "@/lib/checkout/fields";
import {
  PAGAMENTO_BLACKCAT_API,
  PAGAMENTO_CLOWNPAY_API,
  PAGAMENTO_FLEVOPAY_API,
  PAGAMENTO_ORDER_KEEP_DAYS,
  PAGAMENTO_UNPAID_KEEP_DAYS,
  type PagamentoCheckout,
  pagamentoCheckoutOf,
} from "@/lib/export/checkout-php";
import {
  PAGAMENTO_CONFIG_DIR,
  PAGAMENTO_CONFIG_FILE,
  PAGAMENTO_HTACCESS_FILE,
  pagamentoConfigPhp,
  pagamentoHtaccess,
  pagamentoPhp,
} from "@/lib/export/payment-php";
import { orderProductCode } from "@/lib/payments/orders";
import { BLACKCAT_API_BASE } from "@/server/services/payments/blackcat";
import { CLOWNPAY_API_BASE } from "@/server/services/payments/clownpay";
import { FLEVOPAY_API_BASE } from "@/server/services/payments/flevopay";
import { type FakeKyvo, KYVO_KEY, startFakeKyvo } from "./kyvo-fake";
import { findPhp, instrumentCheckout, startPhp, TEST_REMOTE_ROUTER } from "./php-server";
import {
  BLACKCAT_KEY,
  CLOWNPAY_KEY,
  FAKE_PIX_CODE,
  FAKE_QR_BASE64,
  type FakePix,
  FLEVO_KEY,
  FLEVO_KEY_DOWN,
  startFakeBlackcat,
  startFakeClownpay,
  startFakeFlevopay,
} from "./pix-fakes";

/** Subpasta de pedidos (pedidos/<2>/). */
const ORDER_SUBDIR = /^[0-9a-f]{2}$/;

const parser = new PhpParser({ parser: { version: "7.4", extractDoc: false }, ast: { withPositions: false } });
const PHP = findPhp();

const ACCESS = "https://membros.exemplo.com.br/curso?token=segredo";
const BUMP_ACCESS = "https://membros.exemplo.com.br/apostila";
const CPF = "529.982.247-25";

const flevo = pagamentoCheckoutOf(
  {
    key: "checkout",
    provider: "FLEVOPAY",
    name: "Curso de Bolos 'Caseiros'",
    amountCents: 4990,
    currency: "BRL",
    methods: ["PIX"],
    locale: "PT",
    accessUrl: ACCESS,
    config: {
      fields: { name: true, email: true, phone: false, document: false },
      address: true,
      shipping: [
        { id: "gratis01", name: "Grátis", priceCents: 0 },
        { id: "sedex001", name: "Sedex", priceCents: 2990 },
      ],
      bumps: [
        { id: "apostila", title: "Apostila", priceCents: 1990, accessUrl: BUMP_ACCESS },
        { id: "receitas", title: "Receitas extras", priceCents: 990, accessUrl: "" },
      ],
    },
  },
  { code: orderProductCode("checkout", "link-flevo"), thankYou: "obrigado/" },
);

const blackcat = pagamentoCheckoutOf(
  {
    key: "kit-fisico",
    provider: "BLACKCAT",
    name: "Kit de Formas",
    amountCents: 8900,
    currency: "BRL",
    methods: ["PIX"],
    locale: "PT",
    accessUrl: ACCESS,
    config: {
      fields: { name: true, email: true, phone: true, document: true },
      address: true,
      shipping: [{ id: "pac00001", name: "PAC", priceCents: 1500 }],
      bumps: [{ id: "espatula", title: "Espátula", priceCents: 1200, accessUrl: "" }],
    },
  },
  { code: orderProductCode("kit-fisico", "link-blackcat"), thankYou: null },
);

const clown = pagamentoCheckoutOf(
  {
    key: "ebook",
    provider: "CLOWNPAY",
    name: "E-book de Marketing",
    amountCents: 2990,
    currency: "BRL",
    methods: ["PIX"],
    locale: "PT",
    accessUrl: ACCESS,
    config: {
      fields: { name: true, email: true, phone: true, document: true },
      address: false,
      shipping: [],
      bumps: [{ id: "planilha", title: "Planilha", priceCents: 990, accessUrl: BUMP_ACCESS }],
    },
  },
  { code: orderProductCode("ebook", "link-clown"), thankYou: "obrigado/" },
);

const kyvo = pagamentoCheckoutOf(
  {
    key: "mexico",
    provider: "KYVO",
    name: "Curso de Repostería",
    amountCents: 49700,
    currency: "MXN",
    methods: ["SPEI", "CARD"],
    locale: "ES",
    accessUrl: "https://miembros.ejemplo.mx/curso",
    config: {
      fields: { name: true, email: true, phone: false, document: false },
      address: true, // fora do real não vale: sai desligado
      shipping: [{ id: "envio001", name: "Envío", priceCents: 9900 }],
      bumps: [
        { id: "recetario", title: "Recetario", priceCents: 9900, accessUrl: "https://miembros.ejemplo.mx/recetas" },
      ],
    },
  },
  { code: orderProductCode("mexico", "link-kyvo"), thankYou: "gracias/" },
);

/** Gateway que não cobra na moeda (só por config.php antigo): nunca cobra. */
const wrongCurrency: PagamentoCheckout = { ...flevo, key: "errado", code: "errado-abc", gateway: "" };

const CHECKOUTS = [flevo, blackcat, clown, kyvo, wrongCurrency];

describe("checkout no pagamento.php (sem PHP)", () => {
  it("pagamentoCheckoutOf resolve as regras do servidor no config.php", () => {
    expect(flevo).toMatchObject({
      gateway: "flevopay",
      methods: ["pix"],
      ranges: { pix: { min: 100, max: 10_000_000 } },
      // A FlevoPay exige os 4 campos, mesmo desligados no painel.
      fields: ["name", "email", "phone", "document"],
      address: true,
      locale: "pt",
    });
    expect(kyvo).toMatchObject({
      gateway: "kyvo",
      methods: ["spei", "card"],
      ranges: { spei: { min: 100, max: 2_500_000 }, card: { min: 100, max: 10_000_000 } },
      fields: ["name", "email"],
      address: false,
      shipping: [],
      locale: "es",
    });
    // ClownPay: PIX em real, os 4 campos exigidos, faixa do PIX.
    expect(clown).toMatchObject({
      gateway: "clownpay",
      methods: ["pix"],
      ranges: { pix: { min: 100, max: 10_000_000 } },
      fields: ["name", "email", "phone", "document"],
      locale: "pt",
    });
    // PIX numa moeda que não é real: o gateway fica vazio (o PHP responde "configuracao").
    const pixMx = pagamentoCheckoutOf({ ...SOURCE_OF(flevo), currency: "MXN" }, { code: "x", thankYou: null });
    expect(pixMx.gateway).toBe("");
    expect(pixMx.methods).toEqual([]);
  });

  it("é PHP 7.4 válido, sem segredos, com os endereços das APIs e as constantes do contrato", () => {
    const code = pagamentoPhp();
    expect(() => parser.parseCode(code, "pagamento.php")).not.toThrow();
    expect(code).not.toContain("${");
    expect(PAGAMENTO_FLEVOPAY_API).toBe(FLEVOPAY_API_BASE);
    expect(PAGAMENTO_BLACKCAT_API).toBe(BLACKCAT_API_BASE);
    expect(PAGAMENTO_CLOWNPAY_API).toBe(CLOWNPAY_API_BASE);
    expect(code).toContain(`const OS_FLEVOPAY_API = '${FLEVOPAY_API_BASE}';`);
    expect(code).toContain(`const OS_BLACKCAT_API = '${BLACKCAT_API_BASE}';`);
    expect(code).toContain(`const OS_CLOWNPAY_API = '${CLOWNPAY_API_BASE}';`);
    expect(code).toContain("const OS_WEBHOOK_PARAM = 'webhook';");
    expect(code).not.toMatch(/\b(eval|exec|shell_exec|system|passthru|proc_open)\s*\(/);
  });

  it("config.php: chaves e textos escapados, checkouts com preços em centavos", () => {
    const code = pagamentoConfigPhp({
      apiKey: KYVO_KEY,
      products: [],
      keys: { flevopay: "flevopay_a'b\\c", blackcat: BLACKCAT_KEY },
      checkouts: CHECKOUTS,
    });
    expect(() => parser.parseCode(code, "config.php")).not.toThrow();
    expect(code).toContain("'flevopay' => 'flevopay_a\\'b\\\\c',");
    expect(code).toContain("'nome' => 'Curso de Bolos \\'Caseiros\\'',");
    expect(code).toContain("'sedex001' => array('nome' => 'Sedex', 'valor' => 2990)");
    expect(code).toContain(
      `'apostila' => array('titulo' => 'Apostila', 'valor' => 1990, 'acesso' => '${BUMP_ACCESS}')`,
    );
    expect(code).toContain("'faixas' => array('spei' => array(100, 2500000), 'card' => array(100, 10000000)),");
    expect(code).toContain("'nome_completo' => true,");
    expect(code).toContain("'idioma' => 'es',");
    // Sem checkout: continua PHP válido (só o pagamento na página).
    expect(() => parser.parseCode(pagamentoConfigPhp({ apiKey: "", products: [] }), "c.php")).not.toThrow();
  });
});

/** O produto de volta (para variar um campo nos testes). */
function SOURCE_OF(c: PagamentoCheckout) {
  return {
    key: c.key,
    provider: "FLEVOPAY" as const,
    name: c.name,
    amountCents: c.amountCents,
    currency: c.currency,
    methods: ["PIX" as const],
    locale: "PT" as const,
    accessUrl: c.accessUrl,
    config: { fields: {}, address: c.address, shipping: c.shipping, bumps: c.bumps },
  };
}

describe.skipIf(!PHP)("checkout no pagamento.php com PHP de verdade (gateways falsos)", () => {
  let flevoFake: FakePix;
  let blackcatFake: FakePix;
  let clownFake: FakePix;
  let kyvoFake: FakeKyvo;
  let dir: string;
  let server: ChildProcess | null = null;
  let origin = "";
  const responses: string[] = [];

  const config = (
    keys: { flevopay: string; blackcat: string; clownpay?: string } = {
      flevopay: FLEVO_KEY,
      blackcat: BLACKCAT_KEY,
      clownpay: CLOWNPAY_KEY,
    },
  ) => pagamentoConfigPhp({ apiKey: KYVO_KEY, products: [], keys, checkouts: CHECKOUTS });

  beforeAll(async () => {
    [flevoFake, blackcatFake, clownFake, kyvoFake] = await Promise.all([
      startFakeFlevopay(),
      startFakeBlackcat(),
      startFakeClownpay(),
      startFakeKyvo(),
    ]);
    dir = await mkdtemp(path.join(os.tmpdir(), "os-checkout-php-"));
    await mkdir(path.join(dir, PAGAMENTO_CONFIG_DIR), { recursive: true });
    const code = instrumentCheckout(
      pagamentoPhp(),
      { kyvo: kyvoFake.base, flevopay: flevoFake.base, blackcat: blackcatFake.base, clownpay: clownFake.base },
      { OS_CREATE_LIMIT: 30 },
    );
    await writeFile(path.join(dir, "pagamento.php"), code);
    await writeFile(path.join(dir, PAGAMENTO_CONFIG_FILE), config());
    await writeFile(path.join(dir, PAGAMENTO_HTACCESS_FILE), pagamentoHtaccess());
    await writeFile(path.join(dir, "router.php"), TEST_REMOTE_ROUTER);
    ({ server, origin } = await startPhp(PHP as string, dir, "/pagamento.php", path.join(dir, "router.php")));
  }, 120_000);

  afterAll(async () => {
    server?.kill();
    await Promise.all([flevoFake?.close(), blackcatFake?.close(), clownFake?.close(), kyvoFake?.close()]);
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function post(
    body: unknown,
    opts: { headers?: Record<string, string>; query?: string; noOrigin?: boolean } = {},
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await fetch(`${origin}/pagamento.php${opts.query ?? ""}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.noOrigin ? {} : { origin, referer: `${origin}/checkout/checkout/?utm_source=fb` }),
        "user-agent": "Mozilla/5.0 Comprador",
        ...opts.headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    responses.push(text);
    return { status: res.status, json: JSON.parse(text) };
  }

  const buyer = {
    nome: "  Ana   Souza ",
    email: " Ana@Exemplo.COM.br ",
    telefone: "+55 (11) 98765-4321",
    documento: CPF,
    endereco: {
      cep: "01310-100",
      rua: "Avenida Paulista",
      numero: "1000",
      complemento: "ap 12",
      bairro: "Bela Vista",
      cidade: "São Paulo",
      uf: "sp",
    },
  };
  const createFlevo = (extra: Record<string, unknown> = {}) =>
    post({
      acao: "checkout_criar",
      checkout: "checkout",
      metodo: "pix",
      ...buyer,
      bumps: ["apostila"],
      frete: "sedex001",
      metadata: { utm_source: "facebook", utm_campaign: "lancamento", src: "anuncio1", fbp: "fb.1.2", outro: "x" },
      ...extra,
    });

  /** Arquivos de pedidos guardados (conteúdo). */
  async function storedOrders(): Promise<string[]> {
    const base = path.join(dir, PAGAMENTO_CONFIG_DIR, "pedidos");
    const out: string[] = [];
    for (const sub of await readdir(base).catch(() => [])) {
      if (!ORDER_SUBDIR.test(sub)) continue; // pedidos/limpeza.php: a posição da limpeza
      for (const f of await readdir(path.join(base, sub))) out.push(await readFile(path.join(base, sub, f), "utf8"));
    }
    return out;
  }

  it("aberto no navegador: mostra os checkouts e as chaves sem mostrá-las", async () => {
    expect(isValidCpf(CPF)).toBe(true);
    const text = await (await fetch(`${origin}/pagamento.php`)).text();
    expect(text).toContain("Chave da FlevoPay: cadastrada");
    expect(text).toContain("Chave da BlackCat: cadastrada");
    expect(text).toContain("Chave da ClownPay: cadastrada");
    expect(text).toContain("Chave da Kyvo: cadastrada");
    expect(text).toContain(`Checkouts: ${CHECKOUTS.length}`);
    expect(text).toContain("Pedidos do checkout: gravando em pagamento-dados/pedidos");
    expect(text).not.toContain(FLEVO_KEY);
    expect(text).not.toContain(BLACKCAT_KEY);
    expect(text).not.toContain("membros.exemplo.com.br");
  });

  it("FlevoPay: PIX com o total do config.php, pedido público próprio e o corpo da documentação", async () => {
    const r = await createFlevo({ valor: 1, total: 1 });
    expect(r.status).toBe(201);
    const j = r.json;
    expect(j).toMatchObject({ ok: true, status: "pending", metodo: "pix", moeda: "BRL", valor: 4990 + 1990 + 2990 });
    expect(j.pedido).toMatch(/^ck_[a-z0-9]{24}$/);
    expect(CHECKOUT_ORDER_RE.test(String(j.pedido))).toBe(true);
    expect(j.pedidoExterno).toMatch(new RegExp(`^os_${flevo.code}_[a-z0-9]{20}$`));
    expect(j.pix).toEqual({
      codigo: FAKE_PIX_CODE,
      imagem: `data:image/png;base64,${FAKE_QR_BASE64}`,
      expiraEm: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/),
    });
    expect(typeof j.agora).toBe("number");
    expect(Math.abs(Number(j.agora) - Date.now())).toBeLessThan(60_000);
    // A validade "sem fuso" da FlevoPay é horário de Brasília (o falso manda em UTC sem o Z: +3 h).
    const tx = [...flevoFake.transactions.values()].at(-1);
    expect(tx).toBeDefined();
    const sent = tx?.body as Record<string, unknown>;
    expect(sent).toMatchObject({
      amount: 9970,
      description: "Curso de Bolos 'Caseiros'",
      reference: j.pedidoExterno,
      source: "api_externa",
      customer: { name: "Ana Souza", email: "ana@exemplo.com.br", document: "52998224725", phone: "11987654321" },
      address: {
        street: "Avenida Paulista",
        number: "1000",
        complement: "ap 12",
        neighborhood: "Bela Vista",
        city: "São Paulo",
        state: "SP",
        zipcode: "01310100",
      },
      tracking: { utm_source: "facebook", utm_campaign: "lancamento", src: "anuncio1" },
    });
    expect(sent.postback_url).toBeUndefined(); // http: sem webhook (a página confere sozinha)
    expect(sent.orderbump).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain("fbp");
    // O id do gateway (sequencial) nunca vai para a página.
    expect(j.pedido).not.toBe(String(tx?.id));
    expect(JSON.stringify(j)).not.toContain(`"${tx?.id}"`);
  });

  it("pedido guardado sem dados pessoais (nem nome, e-mail, telefone, CPF ou endereço)", async () => {
    const files = await storedOrders();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f.startsWith("<?php exit; ?>\n")).toBe(true);
      expect(f).not.toMatch(/Ana|exemplo\.com|98765|52998224725|529\.982|Paulista|01310/i);
    }
    // Aberto pelo navegador, o arquivo não mostra nada.
    const res = await fetch(`${origin}/${PAGAMENTO_CONFIG_DIR}pedidos/`);
    expect(await res.text()).not.toContain("externo");
  });

  it("status conferido na API: pendente → pago (fica pago); outro checkout ou pedido estranho não acham", async () => {
    const r = await createFlevo();
    const pedido = String(r.json.pedido);
    const gid = String([...flevoFake.transactions.values()].at(-1)?.id);
    const status = () => post({ acao: "checkout_status", pedido, checkout: "checkout" });
    let s = await status();
    expect(s.status).toBe(200);
    expect(s.json).toMatchObject({ ok: true, pedido, status: "pending", pago: false, valor: 9970, moeda: "BRL" });
    expect(s.json.pedidoExterno).toBe(r.json.pedidoExterno);
    expect(typeof s.json.agora).toBe("number");
    const queries = () => flevoFake.requests.filter((q) => q.path === "/api/v1/query").length;
    const before = queries();
    flevoFake.setStatus(gid, "approved");
    s = await status();
    expect(s.json).toMatchObject({ status: "paid", pago: true });
    expect(queries()).toBe(before + 1);
    // Pago confirmado fica guardado: o gateway dizendo "pending" depois não volta o pedido.
    flevoFake.setStatus(gid, "pending");
    s = await status();
    expect(s.json).toMatchObject({ status: "paid", pago: true });
    expect(queries()).toBe(before + 1);

    expect((await post({ acao: "checkout_status", pedido, checkout: "kit-fisico" })).json.erro).toBe("nao_encontrado");
    expect(
      (await post({ acao: "checkout_status", pedido: "ck_naoexiste000000000000", checkout: "checkout" })).status,
    ).toBe(404);
    // Número sequencial (o id da FlevoPay) nunca vale como pedido.
    expect((await post({ acao: "checkout_status", pedido: gid, checkout: "checkout" })).json.erro).toBe("invalido");
    expect(
      (await post({ acao: "checkout_status", pedido: "1234567890123456789", checkout: "checkout" })).json.erro,
    ).toBe("invalido");
    // Acesso de um pedido do checkout que não existe aqui: não encontrado (nunca vai à Kyvo).
    const kyvoReads = kyvoFake.requests.length;
    expect((await post({ acao: "acesso", pedido: "ck_naoexiste000000000000" })).json.erro).toBe("nao_encontrado");
    expect(kyvoFake.requests.length).toBe(kyvoReads);
  });

  it("PIX vencido que o gateway dá como falho/cancelado: “expirado” (a página oferece um PIX novo)", async () => {
    const r = await createFlevo();
    const pedido = String(r.json.pedido);
    const gid = String([...flevoFake.transactions.values()].at(-1)?.id);
    flevoFake.setStatus(gid, "failed");
    // Ainda na validade: recusado mesmo.
    expect((await post({ acao: "checkout_status", pedido, checkout: "checkout" })).json.status).toBe("failed");
    // Vencido (a validade guardada já passou): expirado.
    const base = path.join(dir, PAGAMENTO_CONFIG_DIR, "pedidos");
    for (const sub of await readdir(base)) {
      if (!ORDER_SUBDIR.test(sub)) continue;
      for (const f of await readdir(path.join(base, sub))) {
        const file = path.join(base, sub, f);
        const body = await readFile(file, "utf8");
        if (!body.includes(`"externo":"${r.json.pedidoExterno}"`)) continue;
        await writeFile(
          file,
          body
            .replace(/"expira":"[^"]+"/, '"expira":"2020-01-01T00:00:00.000Z"')
            .replace('"status":"failed"', '"status":"pending"'),
        );
      }
    }
    expect((await post({ acao: "checkout_status", pedido, checkout: "checkout" })).json.status).toBe("expired");
  });

  /** Arquivos de pedidos guardados (caminho, conteúdo e dados do arquivo). */
  async function orderFiles() {
    const base = path.join(dir, PAGAMENTO_CONFIG_DIR, "pedidos");
    const out: { file: string; body: string; mode: number; mtimeMs: number }[] = [];
    for (const sub of await readdir(base)) {
      if (!ORDER_SUBDIR.test(sub)) continue;
      for (const f of await readdir(path.join(base, sub))) {
        const file = path.join(base, sub, f);
        const st = await stat(file);
        out.push({ file, body: await readFile(file, "utf8"), mode: st.mode & 0o777, mtimeMs: st.mtimeMs });
      }
    }
    return out;
  }

  it("consulta: 404 passageiro ou cobrança diferente na API não encerram o PIX na página (nunca pago); o webhook também tenta de novo", async () => {
    const r = await createFlevo();
    const pedido = String(r.json.pedido);
    const tx = [...flevoFake.transactions.values()].at(-1);
    if (!tx) throw new Error("sem transação");
    const status = () => post({ acao: "checkout_status", pedido, checkout: "checkout" });
    // 404 uma vez só: "indisponivel" (a página tenta de novo com recuo), nunca "nao_encontrado" (que apaga o PIX).
    flevoFake.failNext(404, { status: "error", message: "Transação não encontrada" });
    let s = await status();
    expect(s.status).toBe(502);
    expect(s.json.erro).toBe("indisponivel");
    s = await status();
    expect(s.json).toMatchObject({ ok: true, status: "pending" });
    // Valor diferente na API (outra unidade, taxa…): nunca vale como pago, mas também não encerra.
    tx.amount = 99;
    flevoFake.setStatus(tx.id, "approved");
    s = await status();
    expect(s.json.erro).toBe("indisponivel");
    expect(s.json.pago).toBeUndefined();
    // Webhook na mesma situação: 503 (o gateway manda de novo), e o pedido não muda.
    const hook = () =>
      post({ transaction_id: Number(tx.id), status: "approved" }, { query: "?webhook=flevopay", noOrigin: true });
    let h = await hook();
    expect(h.status).toBe(503);
    expect(h.json.erro).toBe("indisponivel");
    flevoFake.failNext(404, { status: "error", message: "Transação não encontrada" });
    tx.amount = 9970;
    h = await hook();
    expect(h.status).toBe(503);
    expect(
      (await orderFiles()).some(
        (f) => f.body.includes(`"externo":"${r.json.pedidoExterno}"`) && f.body.includes('"status":"paid"'),
      ),
    ).toBe(false);
    // A cobrança certa, paga: confirma.
    s = await status();
    expect(s.json).toMatchObject({ status: "paid", pago: true });
  });

  it("acesso de pedido já pago: a API sem achar a cobrança (chave de outra conta) não tira o acesso; outra cobrança, sim", async () => {
    const r = await createFlevo();
    const pedido = String(r.json.pedido);
    const tx = [...flevoFake.transactions.values()].at(-1);
    if (!tx) throw new Error("sem transação");
    const access = () => post({ acao: "acesso", pedido });
    // Pendente com 404: "indisponivel" (o bloco tenta de novo), nunca o acesso.
    flevoFake.failNext(404, { status: "error", message: "Transação não encontrada" });
    let a = await access();
    expect(a.json.erro).toBe("indisponivel");
    flevoFake.setStatus(tx.id, "approved");
    a = await access();
    expect(a.json).toMatchObject({ ok: true, acesso: ACCESS });
    // Pago e confirmado: 404 (outra conta), 401 (chave recusada) ou 5xx mantêm o acesso.
    flevoFake.failNext(404, { status: "error", message: "Transação não encontrada" });
    a = await access();
    expect(a.status).toBe(200);
    expect(a.json).toMatchObject({ ok: true, acesso: ACCESS });
    flevoFake.failNext(401, { status: "error", message: "Chave inválida" });
    expect((await access()).json).toMatchObject({ ok: true, acesso: ACCESS });
    // A API devolvendo outra cobrança (valor diferente): sem acesso.
    tx.amount = 1;
    a = await access();
    expect(a.status).toBe(404);
    expect(a.json.erro).toBe("nao_encontrado");
    tx.amount = 9970;
    expect((await access()).json).toMatchObject({ ok: true, acesso: ACCESS });
  });

  it("pedidos: só o PHP lê (0600, pastas 0700); os nunca pagos vencem em 30 dias, os pagos em 180; limpeza em rodízio", async () => {
    const r = await createFlevo();
    const pedido = String(r.json.pedido);
    const day = 86_400_000;
    const mine = async () =>
      (await orderFiles()).filter(
        (f) => f.body.includes(`"externo":"${r.json.pedidoExterno}"`) || f.body.includes(`"pedido":"${pedido}"`),
      );
    let files = await mine();
    expect(files).toHaveLength(2); // o pedido e o índice do webhook
    for (const f of files) {
      expect(f.mode).toBe(0o600);
      expect((await stat(path.dirname(f.file))).mode & 0o777).toBe(0o700);
      // Não pago: a data do arquivo vem recuada — vence em 30 dias, não em 180.
      const age = Date.now() - f.mtimeMs;
      expect(Math.abs(age - (PAGAMENTO_ORDER_KEEP_DAYS - PAGAMENTO_UNPAID_KEEP_DAYS) * day)).toBeLessThan(120_000);
    }
    // Pago: os dois passam a valer os 180 dias.
    flevoFake.setStatus(String([...flevoFake.transactions.values()].at(-1)?.id), "approved");
    expect((await post({ acao: "checkout_status", pedido, checkout: "checkout" })).json.pago).toBe(true);
    files = await mine();
    expect(files).toHaveLength(2);
    for (const f of files) expect(Date.now() - f.mtimeMs).toBeLessThan(120_000);

    // Limpeza: a cada cobrança, as próximas subpastas do rodízio (mais uma a cada ~40 min sem limpeza).
    const base = path.join(dir, PAGAMENTO_CONFIG_DIR, "pedidos");
    const state = path.join(base, "limpeza.php");
    expect(await readFile(state, "utf8")).toMatch(/^<\?php exit; \?>\n\d{1,3}$/);
    await writeFile(state, "<?php exit; ?>\n200");
    const longAgo = new Date(Date.now() - day); // um dia sem limpeza: 32 subpastas de uma vez
    await utimes(state, longAgo, longAgo);
    const swept = path.join(base, "d5"); // 200 + 13: dentro das 32
    const outside = path.join(base, "f0"); // 240: fora delas
    await mkdir(swept, { recursive: true });
    await mkdir(outside, { recursive: true });
    const put = async (file: string, ageDays: number) => {
      await writeFile(file, "<?php exit; ?>\n{}");
      const t = new Date(Date.now() - ageDays * day);
      await utimes(file, t, t);
    };
    const exists = (file: string) =>
      stat(file).then(
        () => true,
        () => false,
      );
    // (Nomes próprios: as subpastas também têm pedidos de verdade dos outros testes.)
    await put(path.join(swept, "teste-velho.php"), PAGAMENTO_ORDER_KEEP_DAYS + 1);
    await put(path.join(swept, "teste-novo.php"), PAGAMENTO_ORDER_KEEP_DAYS - 1);
    await put(path.join(outside, "teste-velho.php"), PAGAMENTO_ORDER_KEEP_DAYS + 1);
    expect((await createFlevo()).status).toBe(201);
    expect(await exists(path.join(swept, "teste-velho.php"))).toBe(false);
    expect(await exists(path.join(swept, "teste-novo.php"))).toBe(true);
    expect(await exists(path.join(outside, "teste-velho.php"))).toBe(true);
    expect(await readFile(state, "utf8")).toBe(`<?php exit; ?>\n${(200 + 32) % 256}`);
    // Logo depois, uma subpasta por cobrança.
    expect((await createFlevo()).status).toBe(201);
    expect(await readFile(state, "utf8")).toBe(`<?php exit; ?>\n${(200 + 33) % 256}`);
    await rm(path.join(swept, "teste-novo.php"), { force: true });
    await rm(path.join(outside, "teste-velho.php"), { force: true });
  });

  it("acesso: só pago, com o link do produto e dos bumps comprados (com link); outro produto não", async () => {
    const r = await createFlevo({ bumps: ["apostila", "receitas"] });
    const pedido = String(r.json.pedido);
    expect(r.json.valor).toBe(4990 + 1990 + 990 + 2990);
    const access = (extra: Record<string, unknown> = {}) => post({ acao: "acesso", pedido, ...extra });
    let a = await access();
    expect(a.status).toBe(409);
    expect(a.json.erro).toBe("pendente");
    const gid = String([...flevoFake.transactions.values()].at(-1)?.id);
    flevoFake.setStatus(gid, "approved");
    a = await access();
    expect(a.status).toBe(200);
    expect(a.json).toEqual({
      ok: true,
      pedido,
      status: "paid",
      acesso: ACCESS,
      produto: "checkout",
      extras: [{ titulo: "Apostila", acesso: BUMP_ACCESS }],
      idioma: "pt",
    });
    expect((await access({ produto: "kit-fisico" })).json.erro).toBe("nao_encontrado");
    // Estornado na API: o acesso não sai mais.
    flevoFake.setStatus(gid, "refunded");
    a = await access();
    expect(a.status).toBe(403);
    expect(a.json.erro).toBe("nao_pago");
  });

  it("webhook: o corpo nunca vale sozinho — o pedido muda só com a API confirmando", async () => {
    const r = await createFlevo();
    const pedido = String(r.json.pedido);
    const tx = [...flevoFake.transactions.values()].at(-1);
    const gid = String(tx?.id);
    const hook = (body: unknown) => post(body, { query: "?webhook=flevopay", noOrigin: true });
    const forged = {
      transaction_id: Number(gid),
      external_id: r.json.pedidoExterno,
      status: "approved",
      amount: 9970,
      webhook_type: "transaction",
    };
    // Forjado (a API diz pendente): 200, mas o pedido continua pendente.
    let h = await hook(forged);
    expect(h.status).toBe(200);
    const statusOf = async () => (await post({ acao: "acesso", pedido })).json.erro ?? "paid";
    expect(await statusOf()).toBe("pendente");
    // Pago de verdade: o webhook atualiza o pedido (o status já sai pago, sem precisar da página).
    flevoFake.setStatus(gid, "approved");
    h = await hook(forged);
    expect(h.status).toBe(200);
    const files = await storedOrders();
    expect(files.some((f) => f.includes(`"externo":"${r.json.pedidoExterno}"`) && f.includes('"status":"paid"'))).toBe(
      true,
    );
    // Cobrança que não é deste site, corpo estranho e gateway desconhecido.
    expect((await hook({ transaction_id: 999999, status: "approved" })).status).toBe(200);
    expect((await hook("não é json")).status).toBe(200);
    expect((await post({ transaction_id: Number(gid) }, { query: "?webhook=outro", noOrigin: true })).status).toBe(400);
    // Gateway fora do ar na confirmação: 503 (ele manda de novo).
    const r2 = await createFlevo();
    expect(r2.status).toBe(201);
    const gid2 = String([...flevoFake.transactions.values()].at(-1)?.id);
    await writeFile(
      path.join(dir, PAGAMENTO_CONFIG_FILE),
      config({ flevopay: FLEVO_KEY_DOWN, blackcat: BLACKCAT_KEY }),
    );
    try {
      h = await hook({ transaction_id: Number(gid2), status: "approved" });
      expect(h.status).toBe(503);
    } finally {
      await writeFile(path.join(dir, PAGAMENTO_CONFIG_FILE), config());
    }
  });

  it("BlackCat: itens (produto, bumps, frete pago), endereço, documento e UTMs como a documentação pede", async () => {
    const r = await post({
      acao: "checkout_criar",
      checkout: "kit-fisico",
      metodo: "pix",
      ...buyer,
      bumps: ["espatula"],
      frete: "pac00001",
      metadata: { utm_source: "tiktok", utm_content: "video2", src: "s1", sck: "k1", os_versao: "B", ttclid: "t" },
    });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ valor: 8900 + 1200 + 1500, moeda: "BRL", metodo: "pix" });
    expect(r.json.pix).toMatchObject({ codigo: FAKE_PIX_CODE, imagem: `data:image/png;base64,${FAKE_QR_BASE64}` });
    const tx = [...blackcatFake.transactions.values()].at(-1);
    const sent = tx?.body as Record<string, unknown>;
    expect(sent).toMatchObject({
      amount: 11600,
      currency: "BRL",
      paymentMethod: "pix",
      items: [
        { title: "Kit de Formas", unitPrice: 8900, quantity: 1, tangible: true },
        { title: "Espátula", unitPrice: 1200, quantity: 1, tangible: false },
        { title: "Frete PAC", unitPrice: 1500, quantity: 1, tangible: false },
      ],
      customer: {
        name: "Ana Souza",
        email: "ana@exemplo.com.br",
        phone: "11987654321",
        document: { number: "52998224725", type: "cpf" },
      },
      shipping: { street: "Avenida Paulista", number: "1000", city: "São Paulo", state: "SP", zipCode: "01310100" },
      externalRef: r.json.pedidoExterno,
      utm_source: "tiktok",
      utm_content: "video2",
    });
    expect(JSON.parse(String(sent.metadata))).toEqual({ src: "s1", sck: "k1", os_versao: "B" });
    expect(String(tx?.id)).not.toBe(r.json.pedido);

    const pedido = String(r.json.pedido);
    blackcatFake.setStatus(String(tx?.id), "PAID");
    const s = await post({ acao: "checkout_status", pedido, checkout: "kit-fisico" });
    expect(s.json).toMatchObject({ status: "paid", pago: true, valor: 11600 });
    // Bump sem link de acesso: o acesso sai só com o do produto.
    const a = await post({ acao: "acesso", pedido });
    expect(a.json).toMatchObject({ acesso: ACCESS, produto: "kit-fisico", extras: [] });

    // Webhook da BlackCat (cabeçalhos dela; o corpo só aponta a cobrança).
    const r2 = await post({
      acao: "checkout_criar",
      checkout: "kit-fisico",
      metodo: "pix",
      ...buyer,
      frete: "pac00001",
    });
    const tx2 = [...blackcatFake.transactions.values()].at(-1);
    blackcatFake.setStatus(String(tx2?.id), "CANCELLED");
    const h = await post(
      { event: "transaction.failed", transactionId: tx2?.id, status: "PAID" },
      { query: "?webhook=blackcat", noOrigin: true, headers: { "x-webhook-source": "blackcat-api" } },
    );
    expect(h.status).toBe(200);
    const s2 = await post({ acao: "checkout_status", pedido: r2.json.pedido, checkout: "kit-fisico" });
    expect(s2.json).toMatchObject({ status: "canceled", pago: false });
  });

  it("ClownPay: PIX com Bearer e Idempotency-Key, só o copia-e-cola, status na API e acesso com o bump", async () => {
    const r = await post({
      acao: "checkout_criar",
      checkout: "ebook",
      metodo: "pix",
      ...buyer,
      bumps: ["planilha"],
      metadata: { utm_source: "facebook", utm_campaign: "lancamento", src: "s1", fbp: "fb.1.2", os_versao: "B" },
    });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ ok: true, status: "pending", metodo: "pix", moeda: "BRL", valor: 2990 + 990 });
    expect(r.json.pedido).toMatch(/^ck_[a-z0-9]{24}$/);
    // Só o "copia e cola": a ClownPay não manda imagem do QR (a página gera).
    expect(r.json.pix).toMatchObject({ codigo: FAKE_PIX_CODE, imagem: null });
    const tx = [...clownFake.transactions.values()].at(-1);
    const req = clownFake.requests.filter((q) => q.method === "POST").at(-1);
    expect(req?.headers.authorization).toBe(`Bearer ${CLOWNPAY_KEY}`);
    expect(req?.headers["idempotency-key"]).toBe(r.json.pedidoExterno);
    const sent = tx?.body as Record<string, unknown>;
    expect(sent).toMatchObject({
      amount: 3980,
      payment_method: "pix",
      external_reference: r.json.pedidoExterno,
      buyer: { name: "Ana Souza", email: "ana@exemplo.com.br", document: "52998224725", phone: "11987654321" },
      products: [
        { id: "item-1", name: "E-book de Marketing", quantity: 1, price_in_cents: 2990 },
        { id: "item-2", name: "Planilha", quantity: 1, price_in_cents: 990 },
      ],
      tracking: { utm_source: "facebook", utm_campaign: "lancamento", src: "s1" },
    });
    // A ClownPay recebe o webhook pelo painel dela, não pela API: sem postback no corpo.
    expect(sent.postback_url).toBeUndefined();
    expect(sent.postbackUrl).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain("fbp");
    expect(String(tx?.id)).not.toBe(r.json.pedido);

    const pedido = String(r.json.pedido);
    expect((await post({ acao: "checkout_status", pedido, checkout: "ebook" })).json.status).toBe("pending");
    clownFake.setStatus(String(tx?.id), "paid");
    expect((await post({ acao: "checkout_status", pedido, checkout: "ebook" })).json).toMatchObject({
      status: "paid",
      pago: true,
      valor: 3980,
    });
    const a = await post({ acao: "acesso", pedido });
    expect(a.json).toMatchObject({
      acesso: ACCESS,
      produto: "ebook",
      extras: [{ titulo: "Planilha", acesso: BUMP_ACCESS }],
      idioma: "pt",
    });
    // Webhook da ClownPay (o corpo só aponta a cobrança pelo id; o status vem da API).
    const r2 = await post({ acao: "checkout_criar", checkout: "ebook", metodo: "pix", ...buyer });
    const tx2 = [...clownFake.transactions.values()].at(-1);
    clownFake.setStatus(String(tx2?.id), "paid");
    const h = await post(
      { event: "payment.updated", data: { id: tx2?.id, status: "paid" } },
      { query: "?webhook=clownpay", noOrigin: true },
    );
    expect(h.status).toBe(200);
    expect((await post({ acao: "checkout_status", pedido: r2.json.pedido, checkout: "ebook" })).json.pago).toBe(true);
  });

  it("Kyvo (peso mexicano): SPEI com o total do config.php, pedido público próprio e acesso com o bump", async () => {
    const r = await post({
      acao: "checkout_criar",
      checkout: "mexico",
      metodo: "spei",
      nome: "Ana Pérez",
      email: "ana@ejemplo.mx",
      bumps: ["recetario"],
      // Fora do real não há frete: mandado, é ignorado (o endereço está desligado).
      frete: "envio001",
      metadata: { utm_source: "facebook", os_versao: "B" },
    });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ ok: true, metodo: "spei", moeda: "MXN", valor: 49700 + 9900, status: "pending" });
    expect(r.json.pedido).toMatch(/^ck_[a-z0-9]{24}$/);
    expect(r.json.spei).toMatchObject({ clabe: expect.any(String), referencia: expect.any(String) });
    const charge = [...kyvoFake.requests].reverse().find((q) => q.method === "POST");
    expect(charge?.body).toMatchObject({
      amount: 59600,
      externalOrderId: r.json.pedidoExterno,
      customer: { name: "Ana Pérez", email: "ana@ejemplo.mx" },
      metadata: { utm_source: "facebook", os_versao: "B", ua: "Mozilla/5.0 Comprador" },
    });
    expect(charge?.headers["idempotency-key"]).toBe(r.json.pedidoExterno);
    const tx = [...kyvoFake.transactions.values()].at(-1);
    const pedido = String(r.json.pedido);
    expect(pedido).not.toBe(tx?.id);
    expect((await post({ acao: "checkout_status", pedido, checkout: "mexico" })).json.status).toBe("pending");
    kyvoFake.setStatus(String(tx?.id), "paid");
    expect((await post({ acao: "checkout_status", pedido, checkout: "mexico" })).json).toMatchObject({
      status: "paid",
      pago: true,
    });
    const a = await post({ acao: "acesso", pedido });
    expect(a.json).toMatchObject({
      acesso: "https://miembros.ejemplo.mx/curso",
      extras: [{ titulo: "Recetario", acesso: "https://miembros.ejemplo.mx/recetas" }],
      idioma: "es",
    });
    // PIX num checkout da Kyvo: forma não ligada.
    expect(
      (await post({ acao: "checkout_criar", checkout: "mexico", metodo: "pix", nome: "Ana Pérez", email: "a@b.mx" }))
        .json.erro,
    ).toBe("metodo_indisponivel");
  });

  it("regras do servidor: dados pedidos, bumps e frete que existem, formas e checkout desconhecido", async () => {
    const before = flevoFake.transactions.size;
    const erro = async (extra: Record<string, unknown>) => (await createFlevo(extra)).json.erro;
    expect(await erro({ documento: "529.982.247-24" })).toBe("invalido"); // dígito errado
    expect(await erro({ documento: "" })).toBe("invalido"); // a FlevoPay exige o CPF
    expect(await erro({ telefone: "11 1234" })).toBe("invalido");
    expect(await erro({ telefone: "(11) 08765-4321" })).toBe("invalido");
    expect(await erro({ nome: "Ana" })).toBe("invalido"); // sem sobrenome
    expect(await erro({ endereco: null })).toBe("invalido");
    expect(await erro({ endereco: { ...buyer.endereco, uf: "XX" } })).toBe("invalido");
    expect(await erro({ endereco: { ...buyer.endereco, cep: "00000-000" } })).toBe("invalido");
    expect(await erro({ bumps: ["naoexiste"] })).toBe("invalido");
    expect(await erro({ bumps: ["apostila", "apostila"] })).toBe("invalido");
    expect(await erro({ bumps: { a: "apostila" } })).toBe("invalido");
    expect(await erro({ frete: null })).toBe("invalido");
    expect(await erro({ frete: "outro001" })).toBe("invalido");
    expect(await erro({ metodo: "spei" })).toBe("metodo_indisponivel");
    expect(await erro({ checkout: "nao-existe" })).toBe("produto_desconhecido");
    expect(await erro({ checkout: "errado" })).toBe("configuracao");
    expect(await erro({ checkout: "Checkout" })).toBe("invalido");
    expect(flevoFake.transactions.size).toBe(before);
    // Frete grátis: o total não muda.
    const free = await createFlevo({ frete: "gratis01", bumps: [] });
    expect(free.json.valor).toBe(4990);
    // Sem origem do site: recusado como o resto do pagamento.php.
    expect((await createFlevo({})).status).toBe(201);
    const noOrigin = await post(
      { acao: "checkout_criar", checkout: "checkout", metodo: "pix", ...buyer },
      { noOrigin: true },
    );
    expect(noOrigin.json.erro).toBe("origem");
  });

  it("erros do gateway viram códigos do contrato (sem a mensagem dele) e o PIX nunca é criado duas vezes", async () => {
    flevoFake.failNext(400, { status: "error", message: "CPF recusado pelo banco" });
    let r = await createFlevo();
    expect(r.json).toEqual({ ok: false, erro: "invalido" });
    const posts = () => flevoFake.requests.filter((q) => q.method === "POST").length;
    const before = posts();
    flevoFake.failNext(502, { status: "error" });
    r = await createFlevo();
    expect(r.json.erro).toBe("indisponivel");
    expect(posts()).toBe(before + 1); // sem nova tentativa: um PIX repetido seria outra cobrança
    flevoFake.failNext(401, { status: "error" });
    expect((await createFlevo()).json.erro).toBe("configuracao");
    expect(responses.join("\n")).not.toContain("CPF recusado");
  });

  it("sem a chave do gateway, não cobra; com HTTPS, o webhook vai no endereço da cobrança", async () => {
    await writeFile(path.join(dir, PAGAMENTO_CONFIG_FILE), config({ flevopay: "", blackcat: BLACKCAT_KEY }));
    try {
      expect((await createFlevo()).json.erro).toBe("configuracao");
    } finally {
      await writeFile(path.join(dir, PAGAMENTO_CONFIG_FILE), config());
    }
    const r = await createFlevo();
    expect(r.status).toBe(201);
    const https = await post(
      {
        acao: "checkout_criar",
        checkout: "checkout",
        metodo: "pix",
        ...buyer,
        bumps: [],
        frete: "gratis01",
      },
      { headers: { "x-forwarded-proto": "https" } },
    );
    expect(https.status).toBe(201);
    const sent = [...flevoFake.transactions.values()].at(-1)?.body as Record<string, unknown>;
    const port = new URL(origin).port;
    expect(sent.postback_url).toBe(`https://127.0.0.1:${port}/pagamento.php?webhook=flevopay`);
  });

  it("limite por IP vale também para o checkout (outro IP não é barrado)", async () => {
    const create = (remote: string) =>
      post(
        { acao: "checkout_criar", checkout: "checkout", metodo: "pix", ...buyer, frete: "gratis01" },
        { headers: { "x-test-remote": remote } },
      );
    for (let i = 0; i < 30; i++) expect((await create("200.10.20.30")).status).toBe(201);
    const over = await create("200.10.20.30");
    expect(over.status).toBe(429);
    expect(over.json.erro).toBe("limite");
    expect((await create("200.10.20.31")).status).toBe(201);
  }, 120_000);
});
