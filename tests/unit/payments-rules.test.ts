/**
 * Pagamento na página — regras puras (src/lib/payments): valor digitado,
 * moeda × método, faixas da Kyvo, idioma padrão, conferência do produto,
 * identificador do pedido e o contrato do endpoint (pedido da página).
 */
import { describe, expect, it } from "vitest";
import { exportWarningFix, paymentIssueWarning } from "@/lib/export/warnings";
import { accessBlockLangs, type PaymentCheck, type PaymentCheckProduct, paymentIssues } from "@/lib/payments/checks";
import {
  isAllowedSdkUrl,
  PAYMENT_ERROR_STATUS,
  PAYMENT_METADATA_VALUE_MAX,
  parsePaymentRequest,
  paymentError,
  readPaymentConfig,
} from "@/lib/payments/contract";
import { newExternalOrderId, orderIsForProduct, orderProductCode, productCodeOfOrder } from "@/lib/payments/orders";
import { injectPaymentConfig, paymentPageConfig } from "@/lib/payments/render";
import {
  AMBIGUOUS_COMMA_MESSAGE,
  amountInput,
  defaultLocale,
  defaultMethods,
  formatAmount,
  methodAllows,
  type PaymentProductInput,
  parseAmount,
  paymentProductProblems,
} from "@/lib/payments/rules";

describe("valor digitado", () => {
  it.each([
    ["297", 29_700],
    ["297,00", 29_700],
    ["297.5", 29_750],
    ["0,50", 50],
    ["1.297,90", 129_790],
    ["1,297.90", 129_790],
    ["1.297", 129_700],
    ["1.297.000", 129_700_000],
    ["12 500,00", 1_250_000],
    ["MX$ 297,00", 29_700],
    ["€29,90", 2_990],
    ["29,90 €", 2_990],
    ["US$ 1,000.00", 100_000],
  ])("%s → %d centavos", (text, cents) => {
    expect(parseAmount(text)).toBe(cents);
  });

  it.each([
    "",
    "abc",
    "1,2,3",
    "12,345,6",
    "-5",
    "1.2.3,4.5",
    "297,0011",
    "1e5",
    "49,900",
    "29,990",
    "297,999",
  ])("“%s” não é valor", (text) => {
    expect(parseAmount(text)).toBeNull();
  });

  it("vírgula com 3 algarismos (“49,900”) não vira milhar: o produto não salva e a mensagem explica", () => {
    expect(parseAmount("49,90")).toBe(4_990);
    expect(parseAmount("49.900")).toBe(4_990_000);
    expect(parseAmount("1,297,000")).toBe(129_700_000);
    const eur = {
      name: "Curso",
      amount: "49,900",
      currency: "EUR" as const,
      methods: ["CARD", "BIZUM", "MB_WAY"] as ("CARD" | "BIZUM" | "MB_WAY")[],
      locale: "ES" as const,
      thankYouPageId: "",
      accessUrl: "https://membros.exemplo.com/x",
    };
    expect(paymentProductProblems(eur).amount).toBe(AMBIGUOUS_COMMA_MESSAGE);
    expect(paymentProductProblems({ ...eur, amount: "€ 29,990" }).amount).toBe(AMBIGUOUS_COMMA_MESSAGE);
    expect(paymentProductProblems({ ...eur, amount: "49,90" })).toEqual({});
  });

  it("formata para o campo e com a moeda", () => {
    expect(amountInput(129_790)).toBe("1.297,90");
    expect(amountInput(50)).toBe("0,50");
    expect(formatAmount(29_700, "MXN").replace(/\s/g, " ")).toBe("MX$ 297,00");
    expect(formatAmount(2_990, "EUR").replace(/\s/g, " ")).toBe("€ 29,90");
    expect(formatAmount(1_000, "USD", "en-US")).toBe("$10.00");
  });
});

describe("moeda × método e padrões", () => {
  it("SPEI só MXN; Bizum e MB WAY só EUR; cartão em todas", () => {
    expect(methodAllows("SPEI", "MXN")).toBe(true);
    expect(methodAllows("SPEI", "EUR")).toBe(false);
    expect(methodAllows("BIZUM", "EUR")).toBe(true);
    expect(methodAllows("MB_WAY", "USD")).toBe(false);
    for (const c of ["MXN", "EUR", "USD"] as const) expect(methodAllows("CARD", c)).toBe(true);
    expect(defaultMethods("MXN")).toEqual(["SPEI", "CARD"]);
    expect(defaultMethods("EUR")).toEqual(["CARD", "BIZUM", "MB_WAY"]);
    expect(defaultMethods("USD")).toEqual(["CARD"]);
    expect(defaultLocale("MXN")).toBe("ES");
    expect(defaultLocale("EUR")).toBe("ES");
    expect(defaultLocale("USD")).toBe("EN");
  });
});

const base: PaymentProductInput = {
  name: "Curso de Repostería",
  amount: "297,00",
  currency: "MXN",
  methods: ["SPEI", "CARD"],
  locale: "ES",
  thankYouPageId: null,
  accessUrl: "",
};

describe("conferência do produto", () => {
  it("produto completo passa (página de obrigado e acesso podem ficar para depois)", () => {
    expect(paymentProductProblems(base)).toEqual({});
  });

  it("nome, valor e métodos obrigatórios, com mensagens em pt-BR", () => {
    const p = paymentProductProblems({ ...base, name: " ", amount: "", methods: [] });
    expect(p.name).toMatch(/Dê um nome ao produto/);
    expect(p.amount).toMatch(/Digite o valor/);
    expect(p.methods).toBe("Marque pelo menos uma forma de pagamento.");
    expect(paymentProductProblems({ ...base, amount: "dez reais" }).amount).toMatch(/Valor inválido/);
    expect(paymentProductProblems({ ...base, name: "x".repeat(81) }).name).toMatch(/no máximo 80/);
  });

  it("combinação inválida de moeda e método é explicada", () => {
    expect(paymentProductProblems({ ...base, currency: "EUR", methods: ["SPEI"] }).methods).toBe(
      "SPEI só funciona com MXN. Troque a moeda ou desmarque SPEI.",
    );
    expect(paymentProductProblems({ ...base, currency: "USD", methods: ["CARD", "BIZUM"] }).methods).toBe(
      "Bizum só funciona com EUR. Troque a moeda ou desmarque Bizum.",
    );
  });

  it("faixas da Kyvo: SPEI até MX$ 25.000,00; cartão de 1,00 a 100.000,00", () => {
    expect(paymentProductProblems({ ...base, amount: "25.000,00" })).toEqual({});
    expect(paymentProductProblems({ ...base, amount: "25.000,01" }).amount?.replace(/\s/g, " ")).toBe(
      "Com SPEI, o valor máximo é MX$ 25.000,00 por compra.",
    );
    expect(paymentProductProblems({ ...base, methods: ["CARD"], amount: "25.000,01" })).toEqual({});
    expect(
      paymentProductProblems({ ...base, methods: ["CARD"], amount: "100.000,01" }).amount?.replace(/\s/g, " "),
    ).toBe("O valor máximo é MX$ 100.000,00.");
    expect(paymentProductProblems({ ...base, amount: "0,99" }).amount?.replace(/\s/g, " ")).toBe(
      "O valor mínimo é MX$ 1,00.",
    );
  });

  it("link de acesso: completo e http(s) (sem esquema ganha https://)", () => {
    expect(paymentProductProblems({ ...base, accessUrl: "membros.exemplo.com/curso" })).toEqual({});
    expect(paymentProductProblems({ ...base, accessUrl: "javascript:alert(1)" }).accessUrl).toMatch(/link de acesso/);
    expect(paymentProductProblems({ ...base, accessUrl: "https://semponto" }).accessUrl).toMatch(/link de acesso/);
  });
});

describe("identificador do pedido", () => {
  it("leva o código do produto e 20 caracteres aleatórios", () => {
    const a = newExternalOrderId("checkout", "link1");
    const b = newExternalOrderId("checkout", "link1");
    const code = orderProductCode("checkout", "link1");
    expect(code).toMatch(/^checkout-[0-9a-f]{10}$/);
    expect(a).toMatch(new RegExp(`^os_${code}_[a-z0-9]{20}$`));
    expect(a).not.toBe(b);
    expect(productCodeOfOrder(a)).toBe(code);
    expect(orderIsForProduct(a, "checkout", "link1")).toBe(true);
    expect(orderIsForProduct(a, "checkout-2", "link1")).toBe(false);
    expect(orderIsForProduct("os_checkout_curto", "checkout", "link1")).toBe(false);
    expect(orderIsForProduct(null, "checkout", "link1")).toBe(false);
  });

  it("a mesma chave de link em ofertas diferentes (ou duplicadas) dá códigos diferentes", () => {
    // "Checkout principal" vira "checkout-principal" em toda oferta e a chave da Kyvo é uma só.
    const a = orderProductCode("checkout-principal", "cl_ofertaA");
    const b = orderProductCode("checkout-principal", "cl_ofertaB");
    expect(a).not.toBe(b);
    const pedidoA = newExternalOrderId("checkout-principal", "cl_ofertaA");
    expect(orderIsForProduct(pedidoA, "checkout-principal", "cl_ofertaA")).toBe(true);
    expect(orderIsForProduct(pedidoA, "checkout-principal", "cl_ofertaB")).toBe(false);
  });

  it("chave longa vira um código curto e estável (sem confundir com outra parecida)", () => {
    const long1 = `checkout-${"a".repeat(50)}`;
    const long2 = `checkout-${"a".repeat(49)}b`;
    const long3 = `checkout-${"a".repeat(70)}-2`;
    expect(orderProductCode(long1, "l").length).toBeLessThanOrEqual(32);
    expect(orderProductCode(long3, "l").length).toBeLessThanOrEqual(32);
    expect(orderProductCode(long1, "l")).toBe(orderProductCode(long1, "l"));
    expect(orderProductCode(long1, "l")).not.toBe(orderProductCode(long2, "l"));
    const id = newExternalOrderId(long1, "l");
    expect(productCodeOfOrder(id)).toBe(orderProductCode(long1, "l"));
    expect(orderIsForProduct(id, long1, "l")).toBe(true);
    expect(orderIsForProduct(id, long2, "l")).toBe(false);
  });
});

describe("contrato do endpoint", () => {
  it("criar: limpa nome/e-mail, aceita documento e filtra a metadata", () => {
    const req = parsePaymentRequest({
      acao: "criar",
      produto: "checkout",
      metodo: "spei",
      nome: "  María   López ",
      email: " Maria@Ejemplo.MX ",
      documento: "lopm800101abc",
      metadata: {
        utm_source: "facebook",
        fbc: "fb.1.123.abc",
        os_versao: "B",
        ip: "1.2.3.4",
        valor: "1",
        utm_term: "x".repeat(900),
      },
    });
    expect(req).toEqual({
      acao: "criar",
      produto: "checkout",
      metodo: "spei",
      nome: "María López",
      email: "maria@ejemplo.mx",
      documento: "LOPM800101ABC",
      metadata: {
        utm_source: "facebook",
        utm_term: "x".repeat(PAYMENT_METADATA_VALUE_MAX),
        fbc: "fb.1.123.abc",
        os_versao: "B",
      },
    });
  });

  it("valor e moeda nunca vêm do navegador (campos extras são ignorados)", () => {
    const req = parsePaymentRequest({
      acao: "criar",
      produto: "checkout",
      metodo: "card",
      nome: "Ana",
      email: "ana@x.es",
      valor: 1,
      moeda: "USD",
    });
    expect(req).not.toHaveProperty("valor");
    expect(req).not.toHaveProperty("moeda");
  });

  it.each([
    [{}],
    [{ acao: "criar", produto: "Checkout!", metodo: "spei", nome: "Ana", email: "ana@x.es" }],
    [{ acao: "criar", produto: "checkout", metodo: "pix", nome: "Ana", email: "ana@x.es" }],
    [{ acao: "criar", produto: "checkout", metodo: "spei", nome: "A", email: "ana@x.es" }],
    [{ acao: "criar", produto: "checkout", metodo: "spei", nome: "Ana", email: "ana@" }],
    [{ acao: "criar", produto: "checkout", metodo: "spei", nome: "Ana", email: "ana@x.es", documento: "<b>" }],
    [{ acao: "status", pedido: "tx_1", produto: "" }],
    [{ acao: "status", pedido: "../etc", produto: "checkout" }],
    [{ acao: "simular", pedido: "sim_1", resultado: "talvez" }],
    [{ acao: "apagar", pedido: "tx_1" }],
    [[1, 2]],
    ["texto"],
  ])("recusa %j", (body) => {
    expect(parsePaymentRequest(body)).toBeNull();
  });

  it("status, acesso (produto opcional) e simular", () => {
    expect(parsePaymentRequest({ acao: "status", pedido: "tx_abc", produto: "checkout" })).toEqual({
      acao: "status",
      pedido: "tx_abc",
      produto: "checkout",
    });
    expect(parsePaymentRequest({ acao: "acesso", pedido: "tx_abc" })).toEqual({ acao: "acesso", pedido: "tx_abc" });
    expect(parsePaymentRequest({ acao: "acesso", pedido: "tx_abc", produto: "up" })).toEqual({
      acao: "acesso",
      pedido: "tx_abc",
      produto: "up",
    });
    expect(parsePaymentRequest({ acao: "simular", pedido: "sim_1", resultado: "pago" })).toMatchObject({
      resultado: "pago",
    });
  });

  it("erros com status HTTP claros", () => {
    expect(paymentError("recusado")).toEqual({ status: 402, body: { ok: false, erro: "recusado" } });
    expect(PAYMENT_ERROR_STATUS.pendente).toBe(409);
    expect(PAYMENT_ERROR_STATUS.limite).toBe(429);
  });

  it("só o SDK da Kyvo por https", () => {
    expect(isAllowedSdkUrl("https://kyvopay.com/sdk/card.js?v=1")).toBe(true);
    expect(isAllowedSdkUrl("http://kyvopay.com/sdk/card.js?v=1")).toBe(false);
    expect(isAllowedSdkUrl("https://kyvopay.com.evil.io/sdk/card.js")).toBe(false);
    expect(isAllowedSdkUrl("https://evil.io/kyvopay.com/sdk/card.js")).toBe(false);
  });

  it("configuração da página: só com produto; lida de volta pelo script", () => {
    expect(paymentPageConfig(null)).toBeNull();
    expect(paymentPageConfig({ endpoint: "x", simulation: true, products: {} })).toBeNull();
    const html = injectPaymentConfig("<html><head></head><body></body></html>", {
      endpoint: "/__os/pagamento",
      simulation: true,
      products: {
        checkout: {
          nome: "Curso </script><script>alert(1)</script>",
          valor: 29_700,
          moeda: "MXN",
          metodos: ["spei", "card"],
          idioma: "es",
          obrigado: "/p/abc",
        },
      },
    });
    expect(html).not.toContain("</script><script>");
    const json = /<script type="application\/json" id="os-pagamento">([\s\S]*?)<\/script>/.exec(html)?.[1];
    const config = readPaymentConfig(json);
    expect(config?.produtos.checkout.nome).toBe("Curso </script><script>alert(1)</script>");
    expect(config?.simulacao).toBe(true);
    expect(readPaymentConfig("{")).toBeNull();
    expect(readPaymentConfig(JSON.stringify({ v: 99, endpoint: "x", produtos: {} }))).toBeNull();
  });
});

describe("idioma do bloco “Acesso ao produto” × idioma dos produtos", () => {
  const thanks = (langs: { documentId: string; lang: "es" | "en" | "pt" }[]) => ({
    pageId: "p-obrigado",
    name: "Obrigado",
    missingAccessDocumentId: null,
    accessLangs: langs,
  });
  const product = (
    label: string,
    locale: "ES" | "EN" | "PT",
    currency: "MXN" | "EUR" | "USD",
  ): PaymentCheckProduct => ({
    linkId: label,
    label,
    currency,
    methods: ["CARD"],
    locale,
    thankYou: thanks([{ documentId: "d1", lang: "pt" }]),
    hasAccessUrl: true,
  });
  const check = (products: PaymentCheckProduct[]): PaymentCheck => ({
    provider: "KYVO",
    key: "ok",
    products,
    purchaseRules: [],
  });

  it("lê o idioma da tag do bloco, em qualquer ordem de atributos", () => {
    expect(accessBlockLangs('<div class="os-access" data-os-widget="access" data-os-lang="pt">')).toEqual(["pt"]);
    expect(accessBlockLangs('<div data-os-lang="en" id="x" data-os-widget="access">')).toEqual(["en"]);
    expect(accessBlockLangs('<div data-os-widget="access">')).toEqual(["es"]);
    expect(accessBlockLangs('<p data-os-lang="en">sem bloco</p>')).toEqual([]);
  });

  it("produtos de idiomas diferentes na mesma página de obrigado: um aviso só, com quem fica no idioma errado", () => {
    const issues = paymentIssues(
      check([product("Curso EU", "PT", "EUR"), product("Curso MX", "ES", "MXN"), product("Course US", "EN", "USD")]),
    );
    expect(issues).toEqual([
      {
        kind: "accessLang",
        pageName: "Obrigado",
        documentId: "d1",
        blockLang: "pt",
        products: [
          { label: "Curso MX", locale: "ES" },
          { label: "Course US", locale: "EN" },
        ],
      },
    ]);
    const warning = paymentIssueWarning(issues[0]);
    expect(warning).toContain("está em Português");
    expect(warning).toContain("“Curso MX” (Español)");
    expect(exportWarningFix(warning)).toEqual({ kind: "accessBlock" });
    // Tudo no mesmo idioma: nada.
    expect(paymentIssues(check([product("Curso EU", "PT", "EUR")]))).toEqual([]);
  });
});
