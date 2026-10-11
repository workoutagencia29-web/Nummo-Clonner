/**
 * Loja (src/lib/store.ts): formatação de preço nas 4 moedas, leitura do preço
 * digitado (com o milhar de cada moeda), % de desconto, parcelas, dados do
 * produto nos atributos, o HTML escapado das partes geradas do cartão (com a
 * frase única dos leitores de tela) e as frases em português, espanhol e inglês.
 */
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import {
  cleanStoreText,
  discountPercent,
  formatPrice,
  installmentText,
  parseRating,
  parseStorePrice,
  priceInput,
  priceParts,
  productAttrs,
  productPartHtml,
  readProduct,
  STORE_MAX_CENTS,
  stockText,
  storeCurrency,
  storeLang,
} from "@/lib/store";

describe("moedas", () => {
  it("formata as 4 moedas à mão (igual no Node e no navegador)", () => {
    expect(formatPrice(104490, "BRL")).toBe("R$ 1.044,90");
    expect(formatPrice(104490, "MXN")).toBe("$1,044.90");
    expect(formatPrice(104490, "USD")).toBe("US$ 1,044.90");
    expect(formatPrice(104490, "EUR")).toBe("1.044,90 €");
    expect(formatPrice(123456789, "BRL")).toBe("R$ 1.234.567,89");
    expect(formatPrice(5, "BRL")).toBe("R$ 0,05");
    expect(formatPrice(139900, "BRL")).toBe("R$ 1.399,00");
    expect(formatPrice(139900, "BRL", { short: true })).toBe("R$ 1.399");
    expect(formatPrice(139950, "BRL", { short: true })).toBe("R$ 1.399,50");
  });

  it("partes do preço: centavos 00 somem (como “R$ 1.399”)", () => {
    expect(priceParts(17980, "BRL")).toEqual({
      symbol: "R$",
      int: "179",
      cents: "80",
      dec: ",",
      symbolAfter: false,
      space: true,
    });
    expect(priceParts(139900, "BRL")).toMatchObject({ int: "1.399", cents: "" });
    expect(priceParts(6307, "EUR")).toMatchObject({ symbol: "€", int: "63", cents: "07", symbolAfter: true });
    expect(priceParts(250000, "MXN")).toMatchObject({ symbol: "$", int: "2,500", cents: "", space: false });
  });

  it("moeda desconhecida vira BRL", () => {
    expect(storeCurrency("usd")).toBe("USD");
    expect(storeCurrency("XYZ")).toBe("BRL");
    expect(storeCurrency(undefined)).toBe("BRL");
    expect(storeCurrency("toString")).toBe("BRL");
  });
});

describe("parseStorePrice", () => {
  it("entende o preço digitado de vários jeitos", () => {
    expect(parseStorePrice("63,76")).toBe(6376);
    expect(parseStorePrice("63.76")).toBe(6376);
    expect(parseStorePrice("R$ 1.044,90")).toBe(104490);
    expect(parseStorePrice("1,044.90")).toBe(104490);
    expect(parseStorePrice("49")).toBe(4900);
    expect(parseStorePrice("US$ 12.5")).toBe(1250);
    expect(parseStorePrice("1.399")).toBe(139900);
  });

  it("dólar e peso mexicano: vírgula é o milhar (“1,299” = 1.299,00); no real, “49,900” é engano", () => {
    expect(parseStorePrice("1,299", "USD")).toBe(129900);
    expect(parseStorePrice("US$ 1,299", "USD")).toBe(129900);
    expect(parseStorePrice("$1,299.90", "MXN")).toBe(129990);
    expect(parseStorePrice("49,900", "MXN")).toBe(4990000);
    expect(parseStorePrice("12,499,000", "USD")).toBe(1249900000);
    expect(parseStorePrice("49,90", "USD")).toBe(4990);
    expect(parseStorePrice("49,900", "BRL")).toBeNull();
    expect(parseStorePrice("49,900", "EUR")).toBeNull();
  });

  it("vazio, inválido ou grande demais → null", () => {
    expect(parseStorePrice("")).toBeNull();
    expect(parseStorePrice("   ")).toBeNull();
    expect(parseStorePrice(null)).toBeNull();
    expect(parseStorePrice("abc")).toBeNull();
    expect(parseStorePrice("49,900")).toBeNull();
    expect(parseStorePrice("-5")).toBeNull();
    expect(parseStorePrice(String(STORE_MAX_CENTS / 100 + 1))).toBeNull();
  });

  it("valor do campo das Configurações no formato da moeda", () => {
    expect(priceInput(104490, "BRL")).toBe("1.044,90");
    expect(priceInput(104490, "USD")).toBe("1,044.90");
    expect(priceInput(4900, "BRL")).toBe("49,00");
    expect(priceInput(null, "BRL")).toBe("");
    for (const cur of ["BRL", "MXN", "USD", "EUR"] as const) {
      expect(parseStorePrice(priceInput(123456, cur))).toBe(123456);
      expect(parseStorePrice(priceInput(123456, cur), cur)).toBe(123456);
    }
  });
});

describe("desconto e parcelas", () => {
  it("% OFF só quando o preço antigo é maior", () => {
    expect(discountPercent(10990, 6376)).toBe(42);
    expect(discountPercent(42551, 17980)).toBe(58);
    expect(discountPercent(6376, 6376)).toBeNull();
    expect(discountPercent(5000, 6376)).toBeNull();
    expect(discountPercent(null, 6376)).toBeNull();
    expect(discountPercent(10000, 0)).toBeNull();
    expect(discountPercent(10000, 9990)).toBe(null); // 0,1% arredonda para 0
    expect(discountPercent(1000000, 1)).toBe(99);
  });

  it("parcelas sem juros (preço ÷ n) ou com o valor digitado", () => {
    expect(installmentText(6376, 12, null, "BRL")).toBe("12x R$ 5,31 sem juros");
    expect(installmentText(12400, 4, null, "BRL")).toBe("4x R$ 31 sem juros");
    expect(installmentText(17980, 12, 1777, "BRL")).toBe("12x R$ 17,77");
    expect(installmentText(17980, "3", null, "USD")).toBe("3x US$ 59.93 sem juros");
    expect(installmentText(17980, 0, null, "BRL")).toBe("");
    expect(installmentText(17980, "", null, "BRL")).toBe("");
    expect(installmentText(null, 12, null, "BRL")).toBe("");
  });
});

describe("dados do produto", () => {
  it("lê e grava os atributos (inválido fica vazio; textos sem HTML e até 60 caracteres)", () => {
    const attrs = productAttrs({
      price: 6376,
      old: 10990,
      inst: 12,
      ship: "  Frete   <b>grátis</b> ",
      sold: "+10mil vendidos",
      stock: 3,
      badge: "OFERTA DO DIA",
      rating: 4.84,
      reviews: 1234,
    });
    expect(attrs).toEqual({
      "data-os-pd-price": "6376",
      "data-os-pd-old": "10990",
      "data-os-pd-inst": "12",
      "data-os-pd-inst-value": "",
      "data-os-pd-ship": "Frete grátis",
      "data-os-pd-sold": "+10mil vendidos",
      "data-os-pd-stock": "3",
      "data-os-pd-badge": "OFERTA DO DIA",
      "data-os-pd-rating": "4.8",
      "data-os-pd-reviews": "1234",
    });
    expect(readProduct(attrs)).toEqual({
      price: 6376,
      old: 10990,
      inst: 12,
      instValue: null,
      ship: "Frete grátis",
      sold: "+10mil vendidos",
      stock: 3,
      badge: "OFERTA DO DIA",
      rating: 4.8,
      reviews: 1234,
    });
    expect(
      readProduct({
        "data-os-pd-price": "abc",
        "data-os-pd-inst": "99",
        "data-os-pd-stock": "-1",
        "data-os-pd-rating": "7",
        "data-os-pd-badge": "x".repeat(80),
      }),
    ).toMatchObject({ price: null, inst: 0, stock: null, rating: null, badge: "x".repeat(60) });
    expect(parseRating("4,5")).toBe(4.5);
    expect(cleanStoreText("<img src=x onerror=alert(1)>Oi <script>")).toBe("Oi");
  });

  it("partes geradas: preço com % OFF, antigo riscado, centavos pequenos e parcelas", () => {
    const data = readProduct(productAttrs({ price: 6376, old: 10990, inst: 12 }));
    const $ = cheerio.load(`<div>${productPartHtml("price", data, "BRL")}</div>`);
    expect(
      $("div")
        .children()
        .toArray()
        .map((e) => $(e).attr("class")),
    ).toEqual(["os-pd-sr", "os-pd-off", "os-pd-old", "os-pd-now", "os-pd-inst os-pd-free"]);
    // Leitores de tela: uma frase só ("de… por…"); as partes visuais ficam escondidas deles.
    expect($(".os-pd-sr").text()).toBe("De R$ 109,90 por R$ 63,76 (42% OFF)");
    expect($(".os-pd-sr .os-pd-sr-old").text()).toBe("De R$ 109,90 por ");
    expect($(".os-pd-sr .os-pd-sr-off").text()).toBe(" (42% OFF)");
    expect([".os-pd-off", ".os-pd-old", ".os-pd-now"].map((sel) => $(sel).attr("aria-hidden"))).toEqual([
      "true",
      "true",
      "true",
    ]);
    expect($(".os-pd-inst").attr("aria-hidden")).toBeUndefined();
    expect($(".os-pd-off").text()).toBe("42% OFF");
    expect($("s.os-pd-old").text()).toBe("R$ 109,90");
    expect($(".os-pd-now").text()).toBe("R$ 63,76");
    expect($(".os-pd-now sup.os-pd-cents").text()).toBe("76");
    expect($(".os-pd-inst").text()).toBe("12x R$ 5,31 sem juros");

    // Sem antigo, sem parcelas, centavos 00 e moeda com o símbolo depois.
    const plain = cheerio.load(
      `<div>${productPartHtml("price", readProduct({ "data-os-pd-price": "139900" }), "EUR")}</div>`,
    );
    expect(plain("div").children().length).toBe(2);
    expect(plain(".os-pd-sr").text()).toBe("1.399 €");
    expect(plain(".os-pd-now").text()).toBe("1.399 €");
    expect(plain(".os-pd-cents").length).toBe(0);
    // Parcela com valor próprio: sem "sem juros".
    const custom = cheerio.load(
      productPartHtml("price", readProduct(productAttrs({ price: 17980, inst: 12, instValue: 1777 })), "BRL"),
    );
    expect(custom(".os-pd-inst").attr("class")).toBe("os-pd-inst");
    expect(custom(".os-pd-inst").text()).toBe("12x R$ 17,77");
    // Sem preço: nada.
    expect(productPartHtml("price", readProduct({}), "BRL")).toBe("");
  });

  it("avaliação, estoque e textos (escapados)", () => {
    const data = readProduct(
      productAttrs({ rating: 4.8, reviews: 1234, stock: 19, ship: "Frete grátis", sold: "+500 vendidos" }),
    );
    const $ = cheerio.load(productPartHtml("rating", data, "BRL"));
    // Nota e contagem numa frase só para leitores de tela; os números da tela ficam escondidos deles.
    expect($(".os-pd-stars").attr("aria-label")).toBe("Avaliação 4,8 de 5, 1.234 avaliações");
    expect($(".os-pd-rate").attr("aria-hidden")).toBe("true");
    expect($(".os-pd-count").attr("aria-hidden")).toBe("true");
    expect($(".os-pd-stars-on").attr("style")).toBe("width:96%");
    expect($(".os-pd-rate").text()).toBe("4,8");
    expect($(".os-pd-count").text()).toBe("(1.234)");
    expect(
      cheerio
        .load(productPartHtml("rating", data, "USD"))(".os-pd-count")
        .text(),
    ).toBe("(1,234)");
    expect(productPartHtml("stock", data, "BRL")).toBe('<span class="os-pd-stk">Restam 19 unidades</span>');
    expect(productPartHtml("stock", { ...data, stock: 4 }, "BRL")).toBe(
      '<span class="os-pd-stk os-pd-low">Restam 4 unidades</span>',
    );
    expect(stockText(1)).toBe("Última unidade!");
    expect(stockText(0)).toBe("Esgotado");
    expect(productPartHtml("stock", { ...data, stock: null }, "BRL")).toBe("");
    expect(productPartHtml("ship", data, "BRL")).toBe("Frete grátis");
    expect(productPartHtml("sold", data, "BRL")).toBe("+500 vendidos");
    expect(productPartHtml("badge", { ...data, badge: `<b>"Oi" & 'tchau'` }, "BRL")).toBe(
      "&#60;b&#62;&#34;Oi&#34; &#38; &#39;tchau&#39;",
    );
    expect(productPartHtml("rating", { ...data, rating: null }, "BRL")).toBe("");
  });
});

describe("idioma das frases geradas", () => {
  it("sem idioma escolhido, vale o da moeda (real → pt, peso → es, dólar → en, euro → pt)", () => {
    expect(storeLang("", "BRL")).toBe("pt");
    expect(storeLang("", "MXN")).toBe("es");
    expect(storeLang(undefined, "USD")).toBe("en");
    expect(storeLang("", "EUR")).toBe("pt");
    expect(storeLang("ES", "BRL")).toBe("es");
    expect(storeLang("fr", "USD")).toBe("en");
  });

  it("parcelas, estoque, avaliação e a frase do preço em espanhol e inglês", () => {
    const data = readProduct(
      productAttrs({ price: 12990, old: 21990, inst: 12, stock: 1, rating: 4.5, reviews: 1, sold: "+500" }),
    );
    expect(installmentText(12990, 12, null, "MXN", "es")).toBe("12x $10.83 sin intereses");
    expect(installmentText(12990, 12, null, "USD", "en")).toBe("12x US$ 10.83 interest-free");
    expect(stockText(19, "es")).toBe("Quedan 19 unidades");
    expect(stockText(1, "es")).toBe("¡Última unidad!");
    expect(stockText(0, "en")).toBe("Sold out");
    expect(stockText(4, "en")).toBe("Only 4 left");
    const es = cheerio.load(`<div>${productPartHtml("price", data, "MXN", "es")}</div>`);
    expect(es(".os-pd-sr").text()).toBe("Antes $219.90, ahora $129.90 (41% OFF)");
    expect(es(".os-pd-inst").text()).toBe("12x $10.83 sin intereses");
    expect(
      cheerio
        .load(productPartHtml("rating", data, "MXN", "es"))(".os-pd-stars")
        .attr("aria-label"),
    ).toBe("Calificación 4.5 de 5, 1 opinión");
    const en = cheerio.load(`<div>${productPartHtml("price", data, "USD", "en")}</div>`);
    expect(en(".os-pd-sr").text()).toBe("Was US$ 219.90, now US$ 129.90 (41% OFF)");
    expect(productPartHtml("stock", data, "USD", "en")).toBe('<span class="os-pd-stk os-pd-low">Last one!</span>');
    // Sem o idioma, o padrão continua o português (como antes).
    expect(productPartHtml("stock", data, "USD")).toContain("Última unidade!");
  });
});

describe("cores padrão com contraste para letra pequena (4,5:1)", () => {
  const lum = (hex: string) => {
    const c = [0, 2, 4]
      .map((i) => Number.parseInt(hex.replace("#", "").slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  it("vitrine: frete, % OFF, selo e “Ver todas” no cartão branco; branco sobre o % OFF e o selo", async () => {
    const { productsThemeColor, PRODUCTS_CSS } = await import("@/editor/widgets/products-content");
    for (const model of ["classic", "compact", "highlight"]) {
      for (const color of ["ship", "off", "badge", "more", "price", "ink"] as const) {
        expect(ratio(productsThemeColor(model, color), "#ffffff")).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Vendidos e preço antigo (cinza) e o placeholder da pesquisa.
    expect(PRODUCTS_CSS).toContain("color:#767676");
    expect(ratio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("cabeçalho: texto, categorias e faixa de aviso em todas as cores prontas", async () => {
    const { SH_THEMES } = await import("@/editor/widgets/store-header-content");
    for (const { colors } of Object.values(SH_THEMES)) {
      expect(ratio(colors.ink, colors.bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(colors.catsInk, colors.catsBg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(colors.stripInk, colors.stripBg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
