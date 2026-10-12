/**
 * Página de checkout do Offer Studio (fase 2): QR Code gerado do "copia e
 * cola", JSON público e HTML da página (nada secreto, textos escapados,
 * seções por moeda), conferência do pedido com o produto salvo (o total sai
 * dos preços salvos), simulação da prévia (PIX de exemplo, status, simular,
 * acesso do produto e dos bumps comprados), links do render levando à página
 * e o rastreamento (InitiateCheckout não conta no clique; eventos do checkout
 * no aviso "os:purchase"). Nada chama gateway de verdade nem a BrasilAPI.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  type CheckoutConfigDraft,
  checkoutConfigDraft,
  DEFAULT_CHECKOUT_COLOR,
  parseCheckoutConfig,
} from "@/lib/checkout/config";
import { checkoutTotal, readCheckoutConfig } from "@/lib/checkout/contract";
import { checkCheckoutOrder } from "@/lib/checkout/orders";
import {
  colorReadable,
  contrastRatio,
  darkOnWhite,
  previewCheckoutPath,
  publicCheckoutConfig,
  renderCheckoutDocument,
  textOnColor,
} from "@/lib/checkout/page";
import { prisma } from "@/lib/db";
import { loadRenderLinks } from "@/lib/payments/links";
import { composeTrackingConfig } from "@/lib/tracking/compose";
import { parseTrackingSettings } from "@/lib/tracking/schema";
import { qrMatrix, qrSvg, utf8Bytes } from "@/runtime/checkout/qr";
import { purchaseEvent } from "@/runtime/tracking/purchase";
import { renderCheckoutPage } from "@/server/services/checkout/page";
import { saveCheckoutProduct } from "@/server/services/checkout/products";
import { createOfferLink } from "@/server/services/offer-links";
import { createOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { offerPaymentRender } from "@/server/services/payments/products";
import { handleSimulatedPayment, resetSimulation, simulatedPixCode } from "@/server/services/payments/simulation";
import { resetDatabase } from "../setup/per-file";

beforeEach(async () => {
  await resetDatabase();
  resetSimulation();
});

const emptyConfig = (): CheckoutConfigDraft => checkoutConfigDraft(parseCheckoutConfig({}));
const CPF = "529.982.247-25";

function fullConfig(): CheckoutConfigDraft {
  return {
    ...emptyConfig(),
    description: "Aulas em vídeo <com> receitas",
    compareAt: "197,00",
    address: true,
    shipping: [
      { id: "sedex0001", name: "Sedex", eta: "2 a 4 dias úteis", price: "29,90" },
      { id: "pac000001", name: "PAC", eta: "5 a 9 dias úteis", price: "" },
    ],
    shippingDefault: "pac000001",
    bumps: [
      {
        id: "bump0001",
        title: "Apostila",
        description: "PDF",
        price: "27,00",
        compareAt: "47,00",
        imageSrc: null,
        accessUrl: "https://drive.exemplo.com/apostila",
      },
      {
        id: "bump0002",
        title: "Mentoria",
        description: "",
        price: "50,00",
        compareAt: "",
        imageSrc: null,
        accessUrl: "",
      },
    ],
    timer: "10",
    testimonials: [{ id: "dep00001", text: "Amei!", name: "Ana", photoSrc: null }],
  };
}

async function setup(opts: { currency?: "BRL" | "MXN"; config?: CheckoutConfigDraft } = {}) {
  const currency = opts.currency ?? "BRL";
  const offer = await createOffer({ name: "Curso", currency });
  const thanks = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
  const link = await createOfferLink(offer.id, { label: "Checkout principal", url: "", kind: "CHECKOUT" });
  const product = await saveCheckoutProduct(link.id, {
    name: currency === "BRL" ? "Curso de Confeitaria" : "Curso de Repostería",
    amount: "97,00",
    provider: currency === "BRL" ? "FLEVOPAY" : "KYVO",
    methods: currency === "BRL" ? ["PIX"] : ["SPEI", "CARD"],
    locale: currency === "BRL" ? "PT" : "ES",
    thankYouPageId: thanks.id,
    accessUrl: "https://area.exemplo.com/curso",
    config: opts.config ?? (currency === "BRL" ? fullConfig() : emptyConfig()),
  });
  return { offer, thanks, link, product };
}

describe("QR Code do PIX", () => {
  it("tamanho pela versão, cantos de leitura e formato válido (nível M)", () => {
    const code = simulatedPixCode(9700, "sim_abc123");
    const m = qrMatrix(code);
    expect(m).not.toBeNull();
    const size = (m as boolean[][]).length;
    expect((size - 17) % 4).toBe(0);
    // Cantos de leitura: 7×7 com borda escura e miolo 3×3 escuro, nos três cantos.
    const finder = (x: number, y: number) =>
      [0, 6].every((d) => (m as boolean[][])[y + d][x] && (m as boolean[][])[y][x + d]) &&
      (m as boolean[][])[y + 3][x + 3] &&
      !(m as boolean[][])[y + 1][x + 1];
    expect(finder(0, 0)).toBe(true);
    expect(finder(size - 7, 0)).toBe(true);
    expect(finder(0, size - 7)).toBe(true);
    // Bits de formato (15, com a máscara 0x5412): nível M = 00; código BCH certo.
    const bits: number[] = [];
    for (let i = 0; i <= 5; i++) bits.push((m as boolean[][])[i][8] ? 1 : 0);
    bits.push((m as boolean[][])[7][8] ? 1 : 0, (m as boolean[][])[8][8] ? 1 : 0, (m as boolean[][])[8][7] ? 1 : 0);
    for (let i = 9; i < 15; i++) bits.push((m as boolean[][])[8][14 - i] ? 1 : 0);
    const value = bits.reduce((acc, b, i) => acc | (b << i), 0) ^ 0x5412;
    expect(value >> 13).toBe(0);
    let rem = value >> 10;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    expect(((value >> 10) << 10) | rem).toBe(value);
  });

  it("textos grandes sobem de versão; acentos viram UTF-8; SVG escapa o rótulo", () => {
    expect(qrMatrix("a")?.length).toBe(21);
    expect(qrMatrix("x".repeat(300))?.length).toBeGreaterThan(41);
    expect(qrMatrix("x".repeat(5000))).toBeNull();
    expect(utf8Bytes("ação€")).toEqual([0x61, 0xc3, 0xa7, 0xc3, 0xa3, 0x6f, 0xe2, 0x82, 0xac]);
    const svg = qrSvg("teste", 'Pague "<já>"') as string;
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 29 29"/);
    expect(svg).toContain('aria-label="Pague já"');
  });

  it("código PIX de exemplo: formato do PIX, valor, chave que não existe e CRC certo", () => {
    const code = simulatedPixCode(12345, "sim_0a1b2c");
    expect(code).toMatch(/^000201/);
    expect(code).toContain("br.gov.bcb.pix");
    expect(code).toContain("simulacao@offerstudio.invalid");
    expect(code).toContain("5406123.45");
    expect(code).toContain("5303986");
    expect(code).toMatch(/6304[0-9A-F]{4}$/);
  });
});

describe("página de checkout (JSON e HTML)", () => {
  it("JSON público sem segredos, com os textos, os campos travados e o frete marcado", async () => {
    const { offer, link } = await setup();
    const product = (await prisma.checkoutProduct.findUniqueOrThrow({ where: { linkId: link.id } })).id;
    expect(product).toBeTruthy();
    const html = (await renderCheckoutPage(offer.id, link.key, {
      endpoint: "/__os/pagamento",
      simulation: true,
      pageHref: (id) => `/p/${id}`,
      scriptTag: '<script src="/os-checkout.js"></script>',
      tracking: null,
    })) as string;
    expect(html).not.toContain("area.exemplo.com");
    expect(html).not.toContain("drive.exemplo.com");
    const json = /<script type="application\/json" id="os-checkout">([\s\S]*?)<\/script>/.exec(html)?.[1];
    const cfg = readCheckoutConfig(json);
    expect(cfg).toMatchObject({
      chave: link.key,
      valor: 9700,
      valorDe: 19700,
      moeda: "BRL",
      idioma: "pt",
      gateway: "pix",
      metodos: ["pix"],
      campos: ["name", "email", "phone", "document"],
      endereco: true,
      freteInicial: "pac000001",
      cronometro: 10,
      simulacao: true,
      maxQtd: 10,
    });
    // Seletor de quantidade, linha de subtotal e o frete escondido até o CEP.
    expect(html).toContain("data-osc-qtd");
    expect(html).toContain("data-osc-subtotal");
    expect(html).toContain("data-osc-ship-empty");
    expect(html).toContain("Preencha seu CEP para encontrar o melhor frete");
    expect(cfg?.textos.payButton).toBe("Pagar com PIX");
    expect(cfg?.obrigado).toMatch(/^\/p\/[a-z0-9]+$/);
    expect(cfg?.bumps.map((b) => b.titulo)).toEqual(["Apostila", "Mentoria"]);
    // A descrição com "<" vai escapada no HTML e no JSON.
    expect(html).not.toContain("<com>");
    expect(html).toContain("Aulas em vídeo &lt;com&gt; receitas");
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow">/);
    expect(html).toContain('<html lang="pt-BR">');
    // Seções numeradas: 1 dados, 2 entrega, 3 pagamento; os bumps sem número.
    expect(html).toMatch(/osc-step[^>]*>1<\/span>Seus dados/);
    expect(html).toMatch(/osc-step[^>]*>2<\/span>Entrega/);
    expect(html).toMatch(/osc-step[^>]*>3<\/span>Pagamento/);
    expect(html).toContain("Aproveite também");
    // O total da tela começa com o frete marcado (grátis): R$ 97,00.
    expect(html).toMatch(/data-osc-total[^>]*>R\$\s97,00</);
    expect(html).toContain('<script src="/os-checkout.js"></script>');
  });

  it("peso mexicano pela Kyvo: espanhol, SPEI e cartão, sem endereço, pagamento é o passo 2", async () => {
    const { offer, link } = await setup({ currency: "MXN" });
    const html = (await renderCheckoutPage(offer.id, link.key, {
      endpoint: "/__os/pagamento",
      simulation: true,
      pageHref: () => "#",
      scriptTag: "",
      tracking: null,
    })) as string;
    const cfg = readCheckoutConfig(/id="os-checkout">([\s\S]*?)<\/script>/.exec(html)?.[1]);
    expect(cfg).toMatchObject({ idioma: "es", gateway: "kyvo", metodos: ["spei", "card"], endereco: false });
    expect(cfg?.campos).toEqual(["name", "email", "phone", "document"]);
    expect(html).toContain('<html lang="es">');
    expect(html).toMatch(/osc-step[^>]*>2<\/span>Pago/);
    expect(html).toContain("Transferencia SPEI");
    expect(html).not.toContain('name="cep"');
  });

  it("aviso de cookies: link “Preferências de cookies” no rodapé (sem o botão flutuante por cima dos campos)", async () => {
    const { offer, link } = await setup();
    const tracking = (mode: "OPT_IN" | "OFF") => ({
      scriptTag: "",
      config: composeTrackingConfig({
        mode: "live",
        settings: parseTrackingSettings({ consent: { mode } }, "BRL"),
        pixels: [],
        rules: [],
        links: [],
        pageId: null,
        policyUrl: null,
      }),
    });
    const render = (t: ReturnType<typeof tracking> | null) =>
      renderCheckoutPage(offer.id, link.key, {
        endpoint: "/__os/pagamento",
        simulation: true,
        pageHref: () => "#",
        scriptTag: "",
        tracking: t,
      }) as Promise<string>;
    const footer = (html: string) => /<footer class="osc-foot">[\s\S]*?<\/footer>/.exec(html)?.[0] ?? "";
    expect(footer(await render(tracking("OPT_IN")))).toContain(
      '<a href="#" data-os-consent-open>Preferências de cookies</a>',
    );
    // Sem aviso de cookies (ou sem rastreamento), o link não teria o que abrir.
    expect(await render(tracking("OFF"))).not.toContain("data-os-consent-open");
    expect(await render(null)).not.toContain("data-os-consent-open");
  });

  it("produto de outro link, sem checkout salvo ou com outro destino: sem página", async () => {
    const { offer, link } = await setup();
    const opts = { endpoint: "/x", simulation: true, pageHref: () => "#", scriptTag: "", tracking: null };
    expect(await renderCheckoutPage(offer.id, "nao-existe", opts)).toBeNull();
    await prisma.offerLink.update({ where: { id: link.id }, data: { target: "URL" } });
    expect(await renderCheckoutPage(offer.id, link.key, opts)).toBeNull();
  });

  it("cor do texto sobre a cor principal (a de maior contraste); preços legíveis no branco; caminho da prévia", () => {
    // O padrão (verde escuro) fica com o texto branco a 5:1.
    expect(DEFAULT_CHECKOUT_COLOR).toBe("#15803d");
    expect(textOnColor(DEFAULT_CHECKOUT_COLOR)).toBe("#ffffff");
    expect(contrastRatio(DEFAULT_CHECKOUT_COLOR, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(textOnColor("#1e3a8a")).toBe("#ffffff");
    expect(textOnColor("#fde047")).toBe("#0f172a");
    // Verdes e laranjas claros de checkout: o branco ficava com 2,2–3,3:1; agora o texto escuro.
    for (const color of ["#16a34a", "#22c55e", "#00c853", "#10b981", "#f97316", "#0ea5e9"]) {
      const on = textOnColor(color);
      expect(on, color).toBe("#0f172a");
      expect(contrastRatio(color, on), color).toBeGreaterThanOrEqual(4.5);
      expect(colorReadable(color), color).toBe(true);
      // Preços, total e valor do PIX sobre o branco: a cor escurecida até 4,5:1.
      expect(contrastRatio(darkOnWhite(color), "#ffffff"), color).toBeGreaterThanOrEqual(4.5);
    }
    // Nenhuma das duas chega a 4,5:1: o painel avisa.
    expect(colorReadable("#8b5cf6")).toBe(false);
    expect(colorReadable("#ff0000")).toBe(false);
    expect(colorReadable("#15803d")).toBe(true);
    // Cor muito clara: preços no quase preto.
    expect(darkOnWhite("#fde047")).toBe("#0f172a");
    const html = renderCheckoutDocument(
      publicCheckoutConfig(
        {
          key: "c",
          provider: "FLEVOPAY",
          name: "Curso",
          amountCents: 9_700,
          currency: "BRL",
          methods: ["PIX"],
          locale: "PT",
          config: parseCheckoutConfig({ color: "#22c55e" }),
        },
        { endpoint: "/x", simulation: true, imageHref: () => null, thankYouHref: null },
      ),
      { scriptTag: "" },
    );
    expect(html).toContain("--osc-on:#0f172a");
    expect(html).toContain(`--osc-dark:${darkOnWhite("#22c55e")}`);
    // Preço "de" legível (4,8:1) e textos livres que quebram em qualquer ponto (endereço longo a 320 px).
    expect(html).toContain(".osc-price s{margin-right:6px;color:#6b7280");
    expect(html).toMatch(/\.osc-prod-t\{[^}]*overflow-wrap:anywhere/);
    expect(previewCheckoutPath("checkout-principal")).toBe("/checkout/checkout-principal");
  });

  it("render puro: depoimento e nome escapados, banner do celular e logo", () => {
    const cfg = publicCheckoutConfig(
      {
        key: "k",
        provider: "BLACKCAT",
        name: 'Curso "<b>"',
        amountCents: 500,
        currency: "BRL",
        methods: ["PIX"],
        locale: "PT",
        config: parseCheckoutConfig({
          bannerDesktopKey: `a/aa/${"a".repeat(64)}.webp`,
          bannerMobileKey: `a/bb/${"b".repeat(64)}.webp`,
          logoKey: `a/cc/${"c".repeat(64)}.png`,
          testimonials: [{ id: "abcd1234", text: "<img src=x onerror=alert(1)>", name: "Zé" }],
          badges: { secure: true, guarantee: false },
        }),
      },
      { endpoint: "/e", simulation: false, imageHref: (k) => (k ? `/img/${k.slice(-10)}` : null), thankYouHref: null },
    );
    const html = renderCheckoutDocument(cfg, {
      scriptTag: "",
      company: { name: "ACME", document: "12.345", email: "" },
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('Curso "<b>"');
    expect(html).toContain('media="(max-width: 767px)"');
    // O checkout não tem mais a barra de topo (logo + "Pagamento seguro"): só o banner, se houver.
    expect(html).not.toContain("osc-logo");
    expect(html).not.toContain("osc-head");
    const body = html.split("</head>")[1];
    expect(body).toContain("Compra 100% segura");
    expect(body).not.toContain("Garantia de 7 dias");
    expect(html).toContain("ACME · 12.345");
    expect(body).not.toContain('class="osc-sim"');
  });
});

describe("conferência do pedido (servidor)", () => {
  const product = () => ({
    provider: "FLEVOPAY" as const,
    currency: "BRL" as const,
    methods: ["PIX" as const],
    amountCents: 9700,
    config: parseCheckoutConfig({
      address: true,
      shipping: [
        { id: "sedex0001", name: "Sedex", priceCents: 2990 },
        { id: "pac000001", name: "PAC", priceCents: 0 },
      ],
      bumps: [{ id: "bump0001", title: "Apostila", priceCents: 2700 }],
    }),
  });
  const req = (over: Record<string, unknown> = {}) => ({
    acao: "checkout_criar" as const,
    checkout: "k",
    metodo: "pix" as const,
    nome: "Maria da Silva",
    email: "maria@exemplo.com",
    telefone: "11987654321",
    documento: "52998224725",
    endereco: {
      cep: "01310100",
      rua: "Av. Paulista",
      numero: "1000",
      complemento: "",
      bairro: "Bela Vista",
      cidade: "São Paulo",
      uf: "SP",
    },
    bumps: ["bump0001"],
    frete: "sedex0001",
    ...over,
  });

  it("total com os preços salvos (produto + bumps + frete)", () => {
    const r = checkCheckoutOrder(req(), product());
    expect(r).toMatchObject({ ok: true, total: { total: 9700 + 2700 + 2990, bumps: ["bump0001"] }, method: "PIX" });
    expect(checkoutTotal({ valor: 100, bumps: [], fretes: [], endereco: false }, [], null)?.total).toBe(100);
  });

  it("recusa CPF errado, telefone fora do padrão, nome sem sobrenome, endereço faltando, bump ou frete desconhecido", () => {
    const bad = (over: Record<string, unknown>) => checkCheckoutOrder(req(over), product());
    expect(bad({ documento: "52998224724" })).toEqual({ ok: false, erro: "invalido" });
    expect(bad({ telefone: "1187654321" })).toEqual({ ok: false, erro: "invalido" });
    expect(bad({ telefone: undefined })).toEqual({ ok: false, erro: "invalido" });
    expect(bad({ nome: "Maria" })).toEqual({ ok: false, erro: "invalido" });
    expect(bad({ endereco: undefined })).toEqual({ ok: false, erro: "invalido" });
    expect(bad({ endereco: { ...req().endereco, uf: "XX" } })).toEqual({ ok: false, erro: "invalido" });
    expect(bad({ bumps: ["outro0001"] })).toEqual({ ok: false, erro: "invalido" });
    expect(bad({ frete: "outro0001" })).toEqual({ ok: false, erro: "invalido" });
    expect(bad({ frete: null })).toEqual({ ok: false, erro: "invalido" });
    expect(bad({ metodo: "card" })).toEqual({ ok: false, erro: "metodo_indisponivel" });
  });

  it("gateway que não cobra na moeda e total fora da faixa: configuração", () => {
    expect(checkCheckoutOrder(req(), { ...product(), currency: "MXN" as never })).toEqual({
      ok: false,
      erro: "configuracao",
    });
    expect(checkCheckoutOrder(req(), { ...product(), amountCents: 20_000_000 })).toEqual({
      ok: false,
      erro: "configuracao",
    });
  });
});

describe("simulação da prévia (checkout)", () => {
  const body = (key: string, over: Record<string, unknown> = {}) => ({
    acao: "checkout_criar",
    checkout: key,
    metodo: "pix",
    nome: "Maria da Silva",
    email: "maria@exemplo.com",
    telefone: "(11) 98765-4321",
    documento: CPF,
    endereco: {
      cep: "01310-100",
      rua: "Av. Paulista",
      numero: "1000",
      bairro: "Bela Vista",
      cidade: "São Paulo",
      uf: "sp",
    },
    bumps: ["bump0001"],
    frete: "sedex0001",
    ...over,
  });

  it("PIX de exemplo com o total do servidor → aprovado → acesso do produto e só dos bumps comprados com link", async () => {
    const { offer, link } = await setup();
    const created = await handleSimulatedPayment(offer.id, body(link.key, { bumps: ["bump0001", "bump0002"] }));
    expect(created.status).toBe(201);
    const c = created.body as {
      pedido: string;
      pedidoExterno: string;
      valor: number;
      moeda: string;
      pix: { codigo: string; imagem: null; expiraEm: string };
    };
    expect(c).toMatchObject({ valor: 9700 + 2700 + 5000 + 2990, moeda: "BRL", simulacao: true, metodo: "pix" });
    expect(c.pix.codigo).toContain("5406203.90");
    expect(c.pix.imagem).toBeNull();
    expect(Date.parse(c.pix.expiraEm)).toBeGreaterThan(Date.now());
    expect(c.pedidoExterno).toMatch(/^os_checkout-principal-[a-z0-9]+_[a-z0-9]{20}$/);

    const status = () =>
      handleSimulatedPayment(offer.id, { acao: "checkout_status", pedido: c.pedido, checkout: link.key });
    expect((await status()).body).toMatchObject({ status: "pending", pago: false, valor: 20390 });
    // Outro checkout, a ação do pagamento na página e outra oferta não enxergam o pedido.
    expect(
      (await handleSimulatedPayment(offer.id, { acao: "checkout_status", pedido: c.pedido, checkout: "outro" })).body,
    ).toMatchObject({ ok: false, erro: "nao_encontrado" });
    expect(
      (await handleSimulatedPayment(offer.id, { acao: "status", pedido: c.pedido, produto: link.key })).body,
    ).toMatchObject({ ok: false, erro: "nao_encontrado" });
    expect((await handleSimulatedPayment(offer.id, { acao: "acesso", pedido: c.pedido })).body).toMatchObject({
      erro: "pendente",
    });

    await handleSimulatedPayment(offer.id, { acao: "simular", pedido: c.pedido, resultado: "pago" });
    expect((await status()).body).toMatchObject({ status: "paid", pago: true });
    const access = await handleSimulatedPayment(offer.id, { acao: "acesso", pedido: c.pedido });
    expect(access.body).toEqual({
      ok: true,
      pedido: c.pedido,
      status: "paid",
      acesso: "https://area.exemplo.com/curso",
      produto: link.key,
      extras: [{ titulo: "Apostila", acesso: "https://drive.exemplo.com/apostila" }],
      idioma: "pt",
    });
  });

  it("recusa dados que o produto exige e preço vindo do navegador não muda nada", async () => {
    const { offer, link } = await setup();
    const fail = async (over: Record<string, unknown>) =>
      (await handleSimulatedPayment(offer.id, body(link.key, over))).body;
    expect(await fail({ documento: "111.111.111-11" })).toEqual({ ok: false, erro: "invalido" });
    expect(await fail({ frete: null })).toEqual({ ok: false, erro: "invalido" });
    expect(await fail({ checkout: "nao-existe" })).toEqual({ ok: false, erro: "produto_desconhecido" });
    const cheap = (await handleSimulatedPayment(offer.id, { ...body(link.key), valor: 1, total: 1 })).body as {
      valor: number;
    };
    expect(cheap.valor).toBe(9700 + 2700 + 2990);
  });

  it("recusado e expirado: sem acesso", async () => {
    const { offer, link } = await setup();
    for (const resultado of ["recusado", "expirado"] as const) {
      const c = (await handleSimulatedPayment(offer.id, body(link.key))).body as { pedido: string };
      await handleSimulatedPayment(offer.id, { acao: "simular", pedido: c.pedido, resultado });
      const st = await handleSimulatedPayment(offer.id, {
        acao: "checkout_status",
        pedido: c.pedido,
        checkout: link.key,
      });
      expect(st.body).toMatchObject({ status: resultado === "recusado" ? "failed" : "expired", pago: false });
      expect((await handleSimulatedPayment(offer.id, { acao: "acesso", pedido: c.pedido })).body).toMatchObject({
        erro: "nao_pago",
      });
    }
  });

  it("Kyvo no peso: SPEI e cartão de exemplo; PIX recusado", async () => {
    const { offer, link } = await setup({ currency: "MXN" });
    const base = {
      acao: "checkout_criar",
      checkout: link.key,
      nome: "María López",
      email: "maria@ejemplo.mx",
      telefone: "+52 55 1234 5678",
      documento: "LOPM800101ABC",
      bumps: [],
      frete: null,
    };
    const spei = (await handleSimulatedPayment(offer.id, { ...base, metodo: "spei" })).body as {
      spei: { clabe: string };
      moeda: string;
    };
    expect(spei.spei.clabe).toMatch(/^\d{18}$/);
    expect(spei.moeda).toBe("MXN");
    const card = (await handleSimulatedPayment(offer.id, { ...base, metodo: "card" })).body as unknown as {
      cartao: { sdkUrl: string; sessao: { simulacao: boolean } };
    };
    expect(card.cartao).toMatchObject({ sdkUrl: "", sessao: { simulacao: true } });
    expect((await handleSimulatedPayment(offer.id, { ...base, metodo: "pix" })).body).toEqual({
      ok: false,
      erro: "metodo_indisponivel",
    });
    expect((await handleSimulatedPayment(offer.id, { ...base, metodo: "bizum" })).body).toEqual({
      ok: false,
      erro: "metodo_indisponivel",
    });
  });
});

describe("links e rastreamento", () => {
  it("o link de checkout leva à página na prévia (o ZIP ainda não) e as páginas levam o acesso", async () => {
    const { offer, link } = await setup();
    expect((await loadRenderLinks(offer.id)).find((l) => l.key === link.key)).toMatchObject({
      url: "",
      checkout: true,
    });
    expect(
      (await loadRenderLinks(offer.id, prisma, { checkoutHref: previewCheckoutPath })).find((l) => l.key === link.key),
    ).toMatchObject({ url: `/checkout/${link.key}`, checkout: true, pay: false });
    const opts = { endpoint: "/__os/pagamento", simulation: true, pageHref: () => "#" };
    expect(await offerPaymentRender(offer.id, opts)).toBeNull();
    expect(await offerPaymentRender(offer.id, opts, prisma, true)).toMatchObject({ checkout: true, products: {} });
  });

  it("o clique no botão de checkout próprio não conta InitiateCheckout (a página conta ao abrir)", () => {
    const cfg = composeTrackingConfig({
      mode: "live",
      settings: parseTrackingSettings({}, "BRL"),
      pixels: [],
      rules: [],
      links: [
        { key: "proprio", kind: "CHECKOUT", url: "/checkout/proprio", checkout: true },
        { key: "hotmart", kind: "CHECKOUT", url: "https://pay.hotmart.com/X" },
      ],
      pageId: null,
      policyUrl: null,
    });
    expect(cfg.checkoutLinkKeys).toEqual(["hotmart"]);
    expect(cfg.names).toEqual({});
  });

  it("aviso os:purchase: InitiateCheckout e AddPaymentInfo com o conteúdo; outro std vira Purchase", () => {
    const x = { content_ids: ["k"] };
    expect(purchaseEvent({ std: "INITIATE_CHECKOUT", id: "ic-1", value: 97, currency: "BRL", x })).toEqual({
      std: "INITIATE_CHECKOUT",
      id: "ic-1",
      amount: { value: 97, currency: "BRL" },
      x,
    });
    expect(purchaseEvent({ std: "ADD_PAYMENT_INFO", id: "a", value: 1, currency: "BRL" })?.std).toBe(
      "ADD_PAYMENT_INFO",
    );
    expect(purchaseEvent({ std: "LEAD", id: "a", value: 1, currency: "BRL" })?.std).toBe("PURCHASE");
    expect(purchaseEvent({ id: "a", value: 1, currency: "BRL" })?.std).toBe("PURCHASE");
  });
});
