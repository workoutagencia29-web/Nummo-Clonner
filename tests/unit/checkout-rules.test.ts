/**
 * Regras puras do checkout do Offer Studio (src/lib/checkout): dados de quem
 * compra (CPF, telefone, CEP, e-mail), gateway × moeda, campos travados,
 * limites, configuração da página (formulário ↔ guardado), contrato do
 * endpoint (total sempre com os preços salvos) e o que falta configurar.
 */
import { describe, expect, it } from "vitest";
import { type CheckoutCheck, type CheckoutCheckProduct, checkoutIssues } from "@/lib/checkout/checks";
import {
  type CheckoutConfigDraft,
  checkoutConfigDraft,
  checkoutConfigFromDraft,
  checkoutImageKey,
  checkoutImageSrc,
  defaultShipping,
  parseCheckoutConfig,
  staleCheckoutTexts,
} from "@/lib/checkout/config";
import { checkoutTotal, parseCheckoutRequest } from "@/lib/checkout/contract";
import {
  brPhoneDigits,
  formatBrPhone,
  formatCep,
  formatCpf,
  isValidBrPhone,
  isValidCep,
  isValidCpf,
  isValidEmail,
  isValidFullName,
} from "@/lib/checkout/fields";
import {
  askedBuyerFields,
  buyerFieldLock,
  checkoutAmountProblem,
  checkoutBaseProblems,
  checkoutMethodsFor,
  newBuyerFields,
  providerCurrencyProblem,
  providerForCurrency,
  switchCheckoutCurrency,
} from "@/lib/checkout/rules";
import { CHECKOUT_EDITABLE_TEXTS, checkoutFixedTexts, editableText } from "@/lib/checkout/texts";
import { formatAmount } from "@/lib/payments/rules";

const SHA = "a".repeat(64);
const KEY = `a/aa/${SHA}.webp`;
const SRC = `/os-assets/${SHA}.webp`;

describe("dados de quem compra", () => {
  it("CPF com os dígitos verificadores", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("1234567890")).toBe(false);
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
    expect(formatCpf("5299")).toBe("529.9");
  });

  it("telefone do Brasil: DDD + celular de 9 (começa com 9) ou fixo de 8", () => {
    expect(isValidBrPhone("(11) 98765-4321")).toBe(true);
    expect(isValidBrPhone("+55 11 98765-4321")).toBe(true);
    expect(isValidBrPhone("1133334444")).toBe(true);
    expect(isValidBrPhone("11 88765-4321")).toBe(false);
    expect(isValidBrPhone("01 98765-4321")).toBe(false);
    expect(isValidBrPhone("98765-4321")).toBe(false);
    expect(brPhoneDigits("+55 (11) 98765-4321")).toBe("11987654321");
    expect(formatBrPhone("11987654321")).toBe("(11) 98765-4321");
    expect(formatBrPhone("1133334444")).toBe("(11) 3333-4444");
    // Como se cola do WhatsApp ou da agenda: +55, 0 da ligação interurbana, 0 + código da operadora.
    for (const pasted of ["+55 11 98765-4321", "+55 (11) 98765-4321", "011987654321", "0 15 11 98765-4321"]) {
      expect(brPhoneDigits(pasted), pasted).toBe("11987654321");
      expect(isValidBrPhone(pasted), pasted).toBe(true);
      expect(formatBrPhone(pasted), pasted).toBe("(11) 98765-4321");
    }
    expect(brPhoneDigits("011 3333-4444")).toBe("1133334444");
  });

  it("CEP, e-mail e nome completo", () => {
    expect(isValidCep("01310-100")).toBe(true);
    expect(isValidCep("00000-000")).toBe(false);
    expect(isValidCep("1310100")).toBe(false);
    expect(formatCep("01310100")).toBe("01310-100");
    expect(isValidEmail("maria@exemplo.com.br")).toBe(true);
    expect(isValidEmail("maria@exemplo")).toBe(false);
    expect(isValidFullName("Maria da Silva")).toBe(true);
    expect(isValidFullName("Maria")).toBe(false);
  });
});

describe("gateway, moeda e campos", () => {
  it("PIX só em real (FlevoPay, BlackCat); Kyvo nas outras moedas", () => {
    expect(providerCurrencyProblem("FLEVOPAY", "BRL")).toBeNull();
    expect(providerCurrencyProblem("KYVO", "MXN")).toBeNull();
    expect(providerCurrencyProblem("FLEVOPAY", "MXN")).toBe(
      "A FlevoPay só cobra em real (PIX), e esta oferta roda em peso mexicano. Escolha a Kyvo em “Pagamento” ou troque a moeda da oferta.",
    );
    expect(providerCurrencyProblem("KYVO", "BRL")).toContain("A Kyvo não cobra em real");
    expect(providerForCurrency("BRL")).toBe("FLEVOPAY");
    expect(providerForCurrency("BRL", "KYVO", ["BLACKCAT"])).toBe("BLACKCAT");
    expect(providerForCurrency("BRL", "BLACKCAT")).toBe("BLACKCAT");
    expect(providerForCurrency("EUR", "FLEVOPAY")).toBe("KYVO");
    expect(checkoutMethodsFor("BLACKCAT", "BRL", ["CARD"])).toEqual(["PIX"]);
    expect(checkoutMethodsFor("KYVO", "MXN", [])).toEqual(["SPEI", "CARD"]);
    expect(checkoutMethodsFor("KYVO", "EUR", ["BIZUM", "PIX"])).toEqual(["BIZUM"]);
  });

  it("os gateways de PIX travam nome, e-mail, telefone e CPF; a Kyvo, nome e e-mail", () => {
    expect(buyerFieldLock("FLEVOPAY", "document")).toBe(
      "A FlevoPay exige nome, e-mail, telefone e CPF de quem compra para gerar o PIX.",
    );
    expect(buyerFieldLock("KYVO", "email")).toBe("A Kyvo exige nome e e-mail de quem compra.");
    expect(buyerFieldLock("KYVO", "phone")).toBeNull();
    const off = { name: false, email: false, phone: false, document: false };
    expect(askedBuyerFields("BLACKCAT", off)).toEqual(["name", "email", "phone", "document"]);
    expect(askedBuyerFields("KYVO", off)).toEqual(["name", "email"]);
    expect(askedBuyerFields("KYVO", { ...off, phone: true })).toEqual(["name", "email", "phone"]);
  });

  it("produto novo: no PIX pede os quatro; na Kyvo, só nome e e-mail (salvo continua como está)", () => {
    const all = { name: true, email: true, phone: true, document: true };
    expect(newBuyerFields("FLEVOPAY")).toEqual(all);
    expect(newBuyerFields("BLACKCAT")).toEqual(all);
    expect(newBuyerFields("KYVO")).toEqual({ name: true, email: true, phone: false, document: false });
    expect(askedBuyerFields("KYVO", newBuyerFields("KYVO"))).toEqual(["name", "email"]);
    // O formulário guarda o que veio do produto novo; ligar o documento fica ligado.
    const draft = checkoutConfigDraft(parseCheckoutConfig({ fields: newBuyerFields("KYVO") }));
    expect(draft.fields).toEqual({ name: true, email: true, phone: false, document: false });
    const { config } = checkoutConfigFromDraft(
      { ...draft, fields: { ...draft.fields, document: true } },
      "MXN",
      49_900,
    );
    expect(config.fields).toEqual({ name: true, email: true, phone: false, document: true });
    // Produto salvo antes (ou sem os campos guardados): continua pedindo tudo o que pedia.
    expect(parseCheckoutConfig({}).fields).toEqual(all);
    expect(parseCheckoutConfig({ fields: all }).fields).toEqual(all);
  });

  it("faixa de valor: PIX de R$ 1,00 a R$ 100.000,00; Kyvo pelas formas marcadas", () => {
    expect(checkoutAmountProblem(50, "FLEVOPAY", "BRL", ["PIX"])).toBe(
      `O valor mínimo do PIX é ${formatAmount(100, "BRL")}.`,
    );
    expect(checkoutAmountProblem(10_000_001, "BLACKCAT", "BRL", ["PIX"])).toContain("valor máximo do PIX");
    expect(checkoutAmountProblem(9_700, "FLEVOPAY", "BRL", ["PIX"])).toBeNull();
    expect(checkoutAmountProblem(3_000_000, "KYVO", "MXN", ["SPEI", "CARD"])).toContain("Com SPEI");
  });

  it("produto: nome, valor, gateway da moeda, formas e idioma", () => {
    const ok = {
      name: "Curso",
      amount: "97,00",
      provider: "FLEVOPAY" as const,
      methods: ["PIX" as const],
      locale: "PT" as const,
      thankYouPageId: null,
      accessUrl: "",
    };
    expect(checkoutBaseProblems(ok, "BRL")).toEqual({});
    expect(checkoutBaseProblems({ ...ok, name: "", amount: "abc" }, "BRL")).toEqual({
      name: "Dê um nome ao produto (o comprador vê esse nome no checkout).",
      amount: "Valor inválido. Digite só o número, como 297,00 ou 1.297,90.",
    });
    expect(checkoutBaseProblems(ok, "MXN").provider).toContain("A FlevoPay só cobra em real");
    expect(checkoutBaseProblems({ ...ok, provider: "KYVO", methods: ["SPEI"], locale: "ES" }, "MXN")).toEqual({});
    expect(checkoutBaseProblems({ ...ok, provider: "KYVO", methods: ["SPEI"], locale: "PT" }, "MXN").locale).toBe(
      "Escolha o idioma dos textos do checkout.",
    );
    expect(checkoutBaseProblems({ ...ok, provider: "KYVO", methods: ["BIZUM"], locale: "ES" }, "MXN").methods).toBe(
      "Bizum não está disponível em peso mexicano com a Kyvo.",
    );
    expect(checkoutBaseProblems({ ...ok, accessUrl: "não é link" }, "BRL").accessUrl).toBeDefined();
  });

  it("troca da moeda: gateway que cobra na nova, formas e idioma acompanham", () => {
    expect(
      switchCheckoutCurrency({ provider: "FLEVOPAY", currency: "BRL", methods: ["PIX"], locale: "PT" }, "MXN"),
    ).toEqual({ provider: "KYVO", currency: "MXN", methods: ["SPEI", "CARD"], locale: "ES" });
    expect(
      switchCheckoutCurrency({ provider: "KYVO", currency: "EUR", methods: ["CARD"], locale: "PT" }, "BRL", [
        "BLACKCAT",
      ]),
    ).toEqual({ provider: "BLACKCAT", currency: "BRL", methods: ["PIX"], locale: "PT" });
    // Euro em português (escolhido à parte) para dólar: inglês (o dólar só tem inglês).
    expect(
      switchCheckoutCurrency({ provider: "KYVO", currency: "EUR", methods: ["CARD"], locale: "PT" }, "USD"),
    ).toEqual({ provider: "KYVO", currency: "USD", methods: ["CARD"], locale: "EN" });
  });

  it("troca da moeda na Kyvo: entram as formas que a moeda de antes não deixava marcar (como no pagamento na página)", () => {
    // Dólar só com cartão → peso: entra o SPEI.
    expect(
      switchCheckoutCurrency({ provider: "KYVO", currency: "USD", methods: ["CARD"], locale: "EN" }, "MXN", [], 9_700),
    ).toEqual({ provider: "KYVO", currency: "MXN", methods: ["SPEI", "CARD"], locale: "ES" });
    // Peso → euro: o SPEI sai, entram Bizum e MB WAY.
    expect(
      switchCheckoutCurrency({ provider: "KYVO", currency: "MXN", methods: ["SPEI", "CARD"], locale: "ES" }, "EUR"),
    ).toEqual({ provider: "KYVO", currency: "EUR", methods: ["CARD", "BIZUM", "MB_WAY"], locale: "ES" });
    // Valor acima do teto do SPEI: ele não entra sozinho.
    expect(
      switchCheckoutCurrency(
        { provider: "KYVO", currency: "USD", methods: ["CARD"], locale: "EN" },
        "MXN",
        [],
        3_000_000,
      ).methods,
    ).toEqual(["CARD"]);
    // Do real (PIX) para o euro: todas as do euro; o português continua (o euro aceita).
    expect(
      switchCheckoutCurrency({ provider: "FLEVOPAY", currency: "BRL", methods: ["PIX"], locale: "PT" }, "EUR"),
    ).toEqual({ provider: "KYVO", currency: "EUR", methods: ["CARD", "BIZUM", "MB_WAY"], locale: "PT" });
    // Ida e volta pelo real: o euro em português continua em português.
    const viaBrl = switchCheckoutCurrency(
      { provider: "KYVO", currency: "EUR", methods: ["CARD"], locale: "PT" },
      "BRL",
    );
    expect(switchCheckoutCurrency(viaBrl, "EUR").locale).toBe("PT");
  });
});

function draft(over: Partial<CheckoutConfigDraft> = {}): CheckoutConfigDraft {
  return { ...checkoutConfigDraft(parseCheckoutConfig({})), ...over };
}

describe("configuração da página", () => {
  it("padrões: campos pedidos, sem endereço, selos ligados, cor verde, sem cronômetro", () => {
    const c = parseCheckoutConfig(null);
    expect(c).toMatchObject({
      fields: { name: true, email: true, phone: true, document: true },
      address: false,
      shipping: [],
      bumps: [],
      color: "#15803d",
      timerMinutes: null,
      badges: { secure: true, guarantee: true },
      texts: {},
    });
  });

  it("guardado estragado não apaga o resto (item ruim some, o resto fica)", () => {
    const c = parseCheckoutConfig({
      description: "Ótimo",
      color: "vermelho",
      timerMinutes: 999,
      bumps: [
        { id: "bump0001", title: "Apostila", priceCents: 2700 },
        { id: "x", title: "id ruim", priceCents: 2700 },
        { id: "bump0002", title: "", priceCents: 2700 },
      ],
      texts: { payButton: "Comprar já", outro: "x" },
    });
    expect(c.description).toBe("Ótimo");
    expect(c.color).toBe("#15803d");
    expect(c.timerMinutes).toBeNull();
    expect(c.bumps.map((b) => b.id)).toEqual(["bump0001"]);
    expect(c.texts).toEqual({ payButton: "Comprar já" });
  });

  it("imagens: chave do storage ↔ endereço da biblioteca", () => {
    expect(checkoutImageSrc(KEY)).toBe(SRC);
    expect(checkoutImageKey(SRC)).toBe(KEY);
    expect(checkoutImageKey(KEY)).toBe(KEY);
    expect(checkoutImageKey("")).toBeNull();
    expect(checkoutImageKey("https://site.com/x.png")).toBeUndefined();
  });

  it("formulário → guardado: valores, frete, bumps, depoimentos, textos (e de volta)", () => {
    const { config, errors } = checkoutConfigFromDraft(
      draft({
        description: " Aprenda do zero ",
        compareAt: "197,00",
        imageSrc: SRC,
        address: true,
        shipping: [
          { id: "frete001", name: "Correios PAC", eta: "5 a 9 dias úteis", price: "19,90" },
          { id: "frete002", name: "Retirar na loja", eta: "", price: "" },
        ],
        shippingDefault: "frete002",
        bumps: [
          {
            id: "bump0001",
            title: "Apostila",
            description: "PDF",
            price: "27",
            compareAt: "47,00",
            imageSrc: null,
            accessUrl: "drive.google.com/x",
          },
        ],
        timer: "15",
        testimonials: [{ id: "dep00001", text: "Amei!", name: "Ana", photoSrc: null }],
        texts: { payButton: "Quero agora", dataTitle: "   " },
      }),
      "BRL",
      9_700,
    );
    expect(errors).toEqual({});
    expect(config).toMatchObject({
      description: "Aprenda do zero",
      compareAtCents: 19_700,
      imageKey: KEY,
      address: true,
      shipping: [
        { id: "frete001", name: "Correios PAC", eta: "5 a 9 dias úteis", priceCents: 1_990 },
        { id: "frete002", name: "Retirar na loja", eta: "", priceCents: 0 },
      ],
      shippingDefault: "frete002",
      bumps: [
        {
          id: "bump0001",
          title: "Apostila",
          priceCents: 2_700,
          compareAtCents: 4_700,
          accessUrl: "https://drive.google.com/x",
        },
      ],
      timerMinutes: 15,
      testimonials: [{ id: "dep00001", text: "Amei!", name: "Ana", photoKey: null }],
      texts: { payButton: "Quero agora" },
    });
    expect(defaultShipping(config)?.id).toBe("frete002");
    const back = checkoutConfigDraft(config);
    expect(back).toMatchObject({ compareAt: "197,00", imageSrc: SRC, timer: "15" });
    expect(back.shipping[0].price).toBe("19,90");
    expect(back.bumps[0].price).toBe("27,00");
  });

  it("erros por campo, em pt-BR", () => {
    const { errors } = checkoutConfigFromDraft(
      draft({
        compareAt: "50",
        address: true,
        shipping: [],
        bumps: [
          { id: "bump0001", title: "", description: "", price: "0,50", compareAt: "", imageSrc: null, accessUrl: "" },
        ],
        color: "verde",
        timer: "500",
        testimonials: [{ id: "dep00001", text: "", name: "", photoSrc: "https://fora.com/x.png" }],
        texts: { payButton: "x".repeat(41) },
      }),
      "BRL",
      9_700,
    );
    expect(errors).toEqual({
      compareAt: "O preço “de” precisa ser maior que o valor do produto (ou deixe vazio).",
      shipping: "Com o endereço ligado, cadastre pelo menos uma opção de frete (pode ser grátis).",
      "bumps.0.title": "Dê um título ao order bump.",
      "bumps.0.price": `O valor mínimo é ${formatAmount(100, "BRL")}.`,
      color: "Escolha uma cor (no formato #15803d).",
      timer: "O cronômetro vai de 1 a 120 minutos (ou deixe vazio para desligar).",
      "testimonials.0.text": "Escreva o depoimento.",
      "testimonials.0.name": "Digite o nome de quem deu o depoimento.",
      "testimonials.0.photo": "Escolha a imagem de novo.",
      "texts.payButton": "Este texto pode ter no máximo 40 caracteres.",
    });
  });

  it("endereço e frete valem em qualquer moeda; fora do real o contrato aceita o endereço genérico", () => {
    const withAddress = draft({
      address: true,
      shipping: [{ id: "frete001", name: "DHL", eta: "", price: "99,00" }],
    });
    // O endereço é opção do vendedor em QUALQUER moeda (como no real).
    for (const currency of ["BRL", "MXN", "EUR", "USD"] as const) {
      expect(checkoutConfigFromDraft(withAddress, currency, 9_700).errors).toEqual({});
    }
    // Endereço ligado sem nenhuma opção de frete continua sendo erro (em qualquer moeda).
    expect(checkoutConfigFromDraft({ ...withAddress, shipping: [] }, "MXN", 9_700).errors).toEqual({
      shipping: expect.stringContaining("pelo menos uma opção de frete"),
    });
    // Desligado, o frete guardado não atrapalha.
    expect(checkoutConfigFromDraft({ ...withAddress, address: false }, "MXN", 9_700).errors).toEqual({});
    // O contrato só confere o FORMATO (a regra por moeda — CEP+UF do Brasil × genérico — fica no
    // servidor, checkCheckoutOrder): aceita o CP de 5 dígitos do México e o estado texto livre.
    const order = (endereco: Record<string, string>) =>
      parseCheckoutRequest({
        acao: "checkout_criar",
        checkout: "checkout-principal",
        metodo: "card",
        nome: "Ana Lima",
        email: "ana@exemplo.com",
        bumps: [],
        frete: "frete001",
        endereco,
      });
    const street = { rua: "Reforma", numero: "1", bairro: "Centro", cidade: "Cidade" };
    expect(order({ ...street, cep: "01310-100", uf: "SP" })).not.toBeNull();
    expect(order({ ...street, cep: "06600", uf: "CMX" })).not.toBeNull();
    expect(order({ ...street, cep: "1000-001", uf: "Lisboa" })).not.toBeNull();
    // Formato inválido mesmo assim é recusado (código postal vazio).
    expect(order({ ...street, cep: "", uf: "CMX" })).toBeNull();
  });

  it("textos trocados escritos para outro idioma ou pagamento", () => {
    const config = parseCheckoutConfig({
      texts: { payButton: "Pagar com PIX agora" },
      textsFor: { locale: "PT", pix: true },
    });
    expect(staleCheckoutTexts(config, "PT", "FLEVOPAY")).toBe(false);
    expect(staleCheckoutTexts(config, "ES", "KYVO")).toBe(true);
    // Mesmo idioma (euro em português), mas sem PIX.
    expect(staleCheckoutTexts(config, "PT", "KYVO")).toBe(true);
    // Sem textos trocados (ou salvo antes de existir a marca): nada a revisar.
    expect(staleCheckoutTexts(parseCheckoutConfig({ textsFor: { locale: "PT", pix: true } }), "ES", "KYVO")).toBe(
      false,
    );
    expect(staleCheckoutTexts(parseCheckoutConfig({ texts: { payButton: "Já" } }), "ES", "KYVO")).toBe(false);
    // O formulário leva a marca de volta; sem textos, ela some.
    const back = checkoutConfigFromDraft(checkoutConfigDraft(config), "BRL", 9_700).config;
    expect(back.textsFor).toEqual({ locale: "PT", pix: true });
    expect(checkoutConfigFromDraft({ ...checkoutConfigDraft(config), texts: {} }, "BRL", 9_700).config.textsFor).toBe(
      null,
    );
  });

  it("ids repetidos ou ruins ganham um novo", () => {
    const { config } = checkoutConfigFromDraft(
      draft({
        bumps: [
          { id: "bump0001", title: "A", description: "", price: "10", compareAt: "", imageSrc: null, accessUrl: "" },
          { id: "bump0001", title: "B", description: "", price: "10", compareAt: "", imageSrc: null, accessUrl: "" },
          { id: "X!", title: "C", description: "", price: "10", compareAt: "", imageSrc: null, accessUrl: "" },
        ],
      }),
      "BRL",
      9_700,
    );
    const ids = config.bumps.map((b) => b.id);
    expect(ids[0]).toBe("bump0001");
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{4,16}$/);
  });
});

describe("contrato do endpoint", () => {
  const prices = {
    valor: 9_700,
    bumps: [
      { id: "bump0001", valor: 2_700 },
      { id: "bump0002", valor: 1_000 },
    ],
    fretes: [
      { id: "frete001", valor: 1_990 },
      { id: "frete002", valor: 0 },
    ],
    endereco: true,
  };

  it("total = produto + bumps escolhidos + frete escolhido (preços do servidor)", () => {
    expect(checkoutTotal(prices, ["bump0002"], "frete001")).toEqual({
      quantidade: 1,
      produto: 9_700,
      bumps: ["bump0002"],
      valorBumps: 1_000,
      frete: "frete001",
      valorFrete: 1_990,
      total: 12_690,
    });
    expect(checkoutTotal(prices, [], "frete002")?.total).toBe(9_700);
    // Bump que não existe, repetido, frete faltando ou desconhecido: inválido.
    expect(checkoutTotal(prices, ["bump9999"], "frete001")).toBeNull();
    expect(checkoutTotal(prices, ["bump0001", "bump0001"], "frete001")).toBeNull();
    expect(checkoutTotal(prices, [], null)).toBeNull();
    expect(checkoutTotal(prices, [], "frete999")).toBeNull();
    // Sem endereço, frete mandado é inválido.
    expect(checkoutTotal({ ...prices, endereco: false }, [], "frete001")).toBeNull();
    expect(checkoutTotal({ ...prices, endereco: false }, ["bump0001"], null)?.total).toBe(12_400);
  });

  it("quantidade: multiplica o produto e respeita o máximo", () => {
    const p3 = { ...prices, maxQtd: 3, endereco: false };
    // Produto 9700 × 3 = 29100, + bump0001 (2700) = 31800.
    expect(checkoutTotal(p3, ["bump0001"], null, 3)).toMatchObject({ quantidade: 3, produto: 29_100, total: 31_800 });
    expect(checkoutTotal(p3, [], null, 1)?.total).toBe(9_700);
    // Fora da faixa (0, acima do máximo, não inteiro): inválido.
    expect(checkoutTotal(p3, [], null, 0)).toBeNull();
    expect(checkoutTotal(p3, [], null, 4)).toBeNull();
    expect(checkoutTotal(p3, [], null, 1.5)).toBeNull();
    // Sem maxQtd (= 1), qualquer quantidade acima de 1 é inválida.
    expect(checkoutTotal({ ...prices, endereco: false }, [], null, 2)).toBeNull();
  });

  it("lê o pedido: só ids e dados de quem compra (preço do navegador é ignorado)", () => {
    const req = parseCheckoutRequest({
      acao: "checkout_criar",
      checkout: "checkout-principal",
      metodo: "pix",
      nome: "  Maria   da Silva ",
      email: "MARIA@Exemplo.com.br",
      telefone: "(11) 98765-4321",
      documento: "529.982.247-25",
      bumps: ["bump0001"],
      frete: "frete001",
      valor: 1,
      total: 1,
      endereco: {
        cep: "01310-100",
        rua: "Av. Paulista",
        numero: "1000",
        complemento: "",
        bairro: "Bela Vista",
        cidade: "São Paulo",
        uf: "sp",
      },
      metadata: { utm_source: "facebook", qualquer: "x" },
    });
    expect(req).toEqual({
      acao: "checkout_criar",
      checkout: "checkout-principal",
      metodo: "pix",
      nome: "Maria da Silva",
      email: "maria@exemplo.com.br",
      telefone: "11987654321",
      documento: "529.982.247-25",
      quantidade: 1,
      bumps: ["bump0001"],
      frete: "frete001",
      // O contrato só confere o FORMATO e mantém o endereço cru (a normalização do CEP/UF do
      // Brasil — dígitos e maiúsculas — fica no servidor, checkCheckoutOrder, que conhece a moeda).
      endereco: {
        cep: "01310-100",
        rua: "Av. Paulista",
        numero: "1000",
        complemento: "",
        bairro: "Bela Vista",
        cidade: "São Paulo",
        uf: "sp",
      },
      metadata: { utm_source: "facebook" },
    });
    expect(
      parseCheckoutRequest({
        acao: "checkout_status",
        checkout: "checkout-principal",
        pedido: "sim_0123456789abcdef01",
      }),
    ).toEqual({
      acao: "checkout_status",
      checkout: "checkout-principal",
      pedido: "sim_0123456789abcdef01",
    });
    for (const bad of [
      { acao: "checkout_criar", checkout: "X", metodo: "pix", nome: "Ana Li", email: "a@b.co" },
      { acao: "checkout_criar", checkout: "c", metodo: "boleto", nome: "Ana Li", email: "a@b.co" },
      { acao: "checkout_criar", checkout: "c", metodo: "pix", nome: "Ana Li", email: "a@b" },
      { acao: "checkout_criar", checkout: "c", metodo: "pix", nome: "Ana Li", email: "a@b.co", bumps: ["../x"] },
      { acao: "checkout_criar", checkout: "c", metodo: "pix", nome: "Ana Li", email: "a@b.co", endereco: { cep: "1" } },
      { acao: "checkout_status", checkout: "c", pedido: "<script>" },
      // Número de cobrança do gateway (a FlevoPay numera em sequência) nunca vale como credencial.
      { acao: "checkout_status", checkout: "c", pedido: "239" },
      { acao: "checkout_status", checkout: "c", pedido: "1234567890123456789" },
      { acao: "checkout_status", checkout: "c", pedido: "tx_curto" },
      { acao: "outra", checkout: "c" },
      null,
    ]) {
      expect(parseCheckoutRequest(bad)).toBeNull();
    }
  });
});

describe("textos", () => {
  it("por idioma; o botão do PIX diz “Pagar com PIX”; o trocado no painel vale", () => {
    expect(editableText("pt", "payButton", {}, true)).toBe("Pagar com PIX");
    expect(editableText("pt", "payButton", {}, false)).toBe("Pagar agora");
    expect(editableText("es", "bumpsTitle", null)).toBe("Aprovecha también");
    expect(editableText("en", "summaryTitle", { summaryTitle: " Seu pedido " })).toBe("Seu pedido");
    expect(checkoutFixedTexts("pt").invalidCpf).toBe("CPF inválido. Confira os números.");
    for (const k of CHECKOUT_EDITABLE_TEXTS) {
      for (const lang of ["pt", "es", "en"] as const) expect(editableText(lang, k, {})).not.toBe("");
    }
  });
});

describe("o que falta configurar", () => {
  const product = (over: Partial<CheckoutCheckProduct> = {}): CheckoutCheckProduct => ({
    linkId: "l1",
    label: "Checkout",
    provider: "FLEVOPAY",
    currency: "BRL",
    methods: ["PIX"],
    amountCents: 9_700,
    maxTotalCents: 9_700,
    thankYou: { pageId: "p1", name: "Obrigado", missingAccessDocumentId: null },
    hasAccessUrl: true,
    bumpsWithoutAccess: [],
    address: false,
    paidShippingCents: 0,
    ...over,
  });
  const check = (over: Partial<CheckoutCheck> = {}): CheckoutCheck => ({
    offerCurrency: "BRL",
    keys: { FLEVOPAY: "ok" },
    products: [product()],
    ...over,
  });

  it("tudo pronto: nada", () => {
    expect(checkoutIssues(check())).toEqual([]);
  });

  it("chave por gateway, produto sem página de obrigado, página sem o bloco (produto com link) e frete sem endereço", () => {
    const issues = checkoutIssues(
      check({
        keys: { FLEVOPAY: "missing", BLACKCAT: "rejected" },
        products: [
          product({ thankYou: null, hasAccessUrl: false, bumpsWithoutAccess: ["Apostila"] }),
          product({
            linkId: "l2",
            label: "Upsell",
            provider: "BLACKCAT",
            thankYou: { pageId: "p1", name: "Obrigado", missingAccessDocumentId: "doc1" },
            paidShippingCents: 1_990,
          }),
        ],
      }),
    );
    expect(issues).toEqual([
      { kind: "key", provider: "FLEVOPAY", state: "missing", labels: ["Checkout"] },
      { kind: "key", provider: "BLACKCAT", state: "rejected", labels: ["Upsell"] },
      {
        kind: "product",
        linkId: "l1",
        label: "Checkout",
        currency: null,
        thankYou: true,
        // O link de acesso (do produto e dos bumps) é opcional: nunca entra como "falta".
        access: false,
        bumpsAccess: [],
        amount: null,
      },
      // O "Upsell" tem link de acesso e a página de obrigado está sem o bloco → aviso do bloco.
      { kind: "accessBlock", pageName: "Obrigado", documentId: "doc1", labels: ["Upsell"] },
      { kind: "shipping", linkId: "l2", label: "Upsell", priceCents: 1_990, currency: "BRL" },
    ]);
  });

  it("link de acesso é opcional: sem ele, nem o produto nem a falta do bloco viram problema", () => {
    // Produto sem link de acesso, sem bloco de acesso na página de obrigado: nada a resolver.
    expect(
      checkoutIssues(
        check({
          products: [
            product({
              hasAccessUrl: false,
              bumpsWithoutAccess: ["Apostila"],
              thankYou: { pageId: "p1", name: "Obrigado", missingAccessDocumentId: "doc1" },
            }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("gateway que não cobra na moeda da oferta (a chave dele não conta) e total fora da faixa", () => {
    const issues = checkoutIssues(
      check({
        offerCurrency: "MXN",
        keys: {},
        products: [product({ currency: "MXN" }), product({ linkId: "l2", label: "Caro", maxTotalCents: 20_000_000 })],
      }),
    );
    expect(issues.map((i) => i.kind)).toEqual(["product", "product"]);
    expect(issues[0]).toMatchObject({ currency: expect.stringContaining("A FlevoPay só cobra em real") });
    const caro = checkoutIssues(
      check({ products: [product({ linkId: "l2", label: "Caro", maxTotalCents: 20_000_000 })] }),
    );
    expect(caro).toEqual([
      expect.objectContaining({ kind: "product", amount: expect.stringContaining("valor máximo do PIX") }),
    ]);
  });

  it("endereço ligado em peso não é problema; frete pago com endereço desligado é aviso; textos de outro idioma são aviso", () => {
    const kyvo = { provider: "KYVO" as const, currency: "MXN" as const, methods: ["CARD" as const] };
    const issues = checkoutIssues(
      check({
        offerCurrency: "MXN",
        keys: { KYVO: "ok" },
        products: [
          // Endereço ligado em peso agora vale (produto físico vendido no México): sem problema.
          product({ ...kyvo, address: true, paidShippingCents: 9_900, maxTotalCents: 19_600 }),
          // Endereço desligado, mas com frete pago guardado: aviso (o frete não aparece nem é cobrado).
          product({ ...kyvo, linkId: "l2", label: "Sem endereço", paidShippingCents: 9_900 }),
          product({ ...kyvo, linkId: "l3", label: "Textos", staleTexts: true }),
        ],
      }),
    );
    expect(issues).toEqual([
      expect.objectContaining({ kind: "shipping", linkId: "l2", label: "Sem endereço", priceCents: 9_900 }),
      { kind: "texts", linkId: "l3", label: "Textos" },
    ]);
  });
});
