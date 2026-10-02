import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { CHECKOUT_PLATFORMS, UNKNOWN_CHECKOUT_PLATFORM } from "@/detection/checkouts";
import { detectCheckouts, markCheckouts, matchCheckoutPlatform } from "@/worker/clone/checkouts";
import type { CheckoutCandidate } from "@/worker/clone/types";

const PAGE_URL = "https://minhaloja.com.br/vendas";

// ─── matchCheckoutPlatform ───────────────────────────────────────────────────

/** [url, plataforma esperada, confiança esperada] */
const POSITIVE: [string, string, number][] = [
  ["https://pay.hotmart.com/A12345678B?off=abc123&checkoutMode=10", "Hotmart", 100],
  ["https://go.hotmart.com/X987654321Y?dp=1", "Hotmart", 100],
  ["https://sec.hotmart.com/payment/checkout/xyz", "Hotmart", 100],
  ["https://PAY.HOTMART.COM/A1?src=lp&sck=HOTMART_LP", "Hotmart", 100],
  ["https://minhaloja.com.br/pagar?off=abc&checkoutMode=10", "Hotmart", 70],
  ["https://pay.kiwify.com.br/AbC123x", "Kiwify", 100],
  ["https://kiwify.app/xYz987", "Kiwify", 100],
  ["https://sun.eduzz.com/1234567", "Eduzz", 100],
  ["https://chk.eduzz.com/2345678", "Eduzz", 100],
  ["https://app.monetizze.com.br/checkout/DAB123456", "Monetizze", 100],
  ["https://app.monetizze.com.br/r/BXY98765", "Monetizze", 100],
  ["https://ev.braip.com/checkout/pla0abc/che1def", "Braip", 100],
  ["https://ev.braip.com/ref?pv=pro123&af=afi456", "Braip", 100],
  ["https://pay.braip.co/abc", "Braip", 100],
  ["https://checkout.ticto.app/O1A2B3C", "Ticto", 100],
  ["https://payment.ticto.app/xyz", "Ticto", 100],
  ["https://go.perfectpay.com.br/PPU38CABCDE", "PerfectPay", 100],
  ["https://checkout.perfectpay.com.br/pay/PPU38", "PerfectPay", 100],
  ["https://minhaloja.mycartpanda.com/checkout/12345678:1", "Cartpanda", 100],
  ["https://pay.yampi.com.br/r/ABC123", "Yampi", 100],
  ["https://seguro.minhaloja.com.br/r/ABCDE12345", "Yampi", 90],
  ["https://pay.kirvano.com/0a1b2c3d", "Kirvano", 100],
  ["https://payfast.greenn.com.br/12345", "Greenn", 100],
  ["https://pay.greenn.com.br/abc", "Greenn", 100],
  ["https://lastlink.com/p/C1234ABCD/checkout-payment", "Lastlink", 100],
  ["https://checkout.pagtrust.com.br/abc", "Pagtrust", 100],
  ["https://p.pagtrust.com.br/xyz", "Pagtrust", 100],
  ["https://checkout.payt.com.br/abc123", "Payt", 100],
  ["https://checkout.doppus.app/12345", "Doppus", 100],
  ["https://pay.hub.la/AbCdEf", "Hubla", 100],
  ["https://clkdmg.site/pay/meu-produto", "Guru", 100],
  ["https://digitalmanager.guru/pay/xyz", "Guru", 95],
  ["https://pay.cakto.com.br/abc_123", "Cakto", 100],
  ["https://pay.vegacheckout.com.br/abc", "Vega Checkout", 100],
  ["https://minhaloja.appmax.com.br/checkout/123", "Appmax", 100],
  ["https://buy.stripe.com/test_eVa0abc", "Stripe", 100],
  ["https://checkout.stripe.com/c/pay/cs_test_a1", "Stripe", 100],
  ["https://mpago.la/2aBcDeF", "Mercado Pago", 100],
  ["https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=123-abc", "Mercado Pago", 100],
  ["https://pag.ae/7ZabcDEF", "PagBank", 100],
  ["https://pagseguro.uol.com.br/checkout/v2/payment.html?code=ABC", "PagBank", 100],
  ["https://www.paypal.com/checkoutnow?token=EC-123", "PayPal", 100],
  ["https://vendor.pay.clickbank.net/?cbitems=1", "ClickBank", 100],
  ["https://affiliate.vendor.hop.clickbank.net/", "ClickBank", 100],
  ["https://hop.clickbank.net/?affiliate=a&vendor=b", "ClickBank", 100],
  ["https://www.buygoods.com/secure/checkout.html?account_id=1&product_codename=x", "BuyGoods", 100],
  ["https://www.checkout-ds24.com/product/123456", "Digistore24", 100],
  ["https://www.digistore24.com/product/123456", "Digistore24", 100],
  ["https://minhaloja.com.br/cart/39512345678:1", "Shopify", 85],
  ["https://minhaloja.com.br/cart/111:2,222:1", "Shopify", 85],
  ["https://minhaloja.myshopify.com/checkouts/cn/abc123", "Shopify", 85],
  ["https://minhaloja.com/?add-to-cart=123", "WooCommerce", 70],
  ["https://checkout.minhaloja.com.br/abc", UNKNOWN_CHECKOUT_PLATFORM, 60],
  ["https://pay.minhaplataforma.io/xyz", UNKNOWN_CHECKOUT_PLATFORM, 60],
  ["https://meucheckout.com.br/produto/1", UNKNOWN_CHECKOUT_PLATFORM, 55],
  ["https://loja.exemplo.com/checkout/", UNKNOWN_CHECKOUT_PLATFORM, 50],
];

const NEGATIVE: string[] = [
  "https://hotmart.com/pt-br",
  "https://www.hotmart.com/product/curso-x/A123",
  "https://kiwify.com.br/",
  "https://dashboard.kiwify.com.br/login",
  "https://app.monetizze.com.br/login",
  "https://eduzz.com/",
  "https://stripe.com/br",
  "https://www.appmax.com.br/",
  "https://wa.me/5511999999999",
  "https://api.whatsapp.com/send?phone=5511999999999",
  "https://www.youtube.com/watch?v=abc",
  "https://instagram.com/perfil",
  "https://pay.hotmart.com/assets/logo.png",
  "https://checkout.hotmart.com/lib/hotmart-checkout-elements.js",
  "https://lastlink.com/",
  "https://www.buygoods.com/",
  "https://www.digistore24.com/",
  "https://www.mercadopago.com.br/ajuda",
  "https://www.paypal.com/br/home",
  "https://minhaloja.com.br/cart",
  "https://minhaloja.com.br/obrigado",
  "https://seguro.minhaloja.com.br/politica",
  "https://blog.exemplo.com/como-fazer-checkout",
  "https://www.google.com/search?q=checkout",
  "https://payhip.com/b/abc",
  "mailto:contato@exemplo.com",
  "tel:+5511999999999",
  "javascript:void(0)",
  "ftp://pay.hotmart.com/x",
  "/relative/checkout",
  "not a url",
  "",
];

describe("matchCheckoutPlatform", () => {
  it("tem mais de 50 URLs de teste", () => {
    expect(POSITIVE.length + NEGATIVE.length).toBeGreaterThan(50);
  });

  it.each(POSITIVE)("reconhece %s como %s (%i)", (url, platform, confidence) => {
    expect(matchCheckoutPlatform(url)).toEqual({ platform, confidence });
  });

  it.each(NEGATIVE)("não considera checkout: %s", (url) => {
    expect(matchCheckoutPlatform(url)).toBeNull();
  });

  it("toda plataforma da lista tem nome e ao menos uma regra", () => {
    for (const platform of CHECKOUT_PLATFORMS) {
      expect(platform.name.length).toBeGreaterThan(0);
      expect(platform.rules.length).toBeGreaterThan(0);
    }
  });
});

// ─── detectCheckouts / markCheckouts ─────────────────────────────────────────

/** 20 tipos de botão de checkout (k1…k20) e vários negativos (n1…n13). */
const FIXTURE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Oferta</title>
<script>
  var checkoutUrl = "https://checkout.doppus.app/k15";
  window.__cfg = {"buy":"https:\\/\\/pay.hotmart.com\\/A1?off=aaa"};
  var logo = "https://pay.hotmart.com/assets/logo.png";
  var perfil = "https://instagram.com/minhaloja";
</script>
</head><body>
<a id="k1" href="https://pay.hotmart.com/A1?off=aaa">Comprar agora</a>
<a id="k2" href="https://pay.kiwify.com.br/k2x?utm_source=facebook&amp;utm_campaign=vsl">Quero meu acesso</a>
<button id="k3" onclick="window.location.href='https://sun.eduzz.com/300003'">Garantir minha vaga</button>
<div id="k4" class="botao" onclick="window.open('https://ev.braip.com/checkout/pla4/che4', '_blank')">Sim, quero!</div>
<div id="k5" data-href="https://checkout.ticto.app/K5">Comprar com desconto</div>
<form id="k6" action="https://go.perfectpay.com.br/PPU6" method="get">
  <input type="hidden" name="src" value="lp"><button type="submit">Finalizar pedido</button>
</form>
<div class="elementor-widget-button"><div class="elementor-button-wrapper">
  <a id="k7" class="elementor-button elementor-button-link elementor-size-lg" href="https://pay.kirvano.com/k7">
    <span class="elementor-button-content-wrapper"><span class="elementor-button-text">Quero aproveitar</span></span>
  </a>
</div></div>
<a id="k8" href="https://seguro.minhaloja.com.br/r/ABC123XYZ">Levar o kit</a>
<a id="k9" href="/cart/39512345678:1">Adicionar ao carrinho</a>
<a id="k10" href="//app.monetizze.com.br/checkout/DAB10">Comprar</a>
<span id="k11" onclick="location.assign(&quot;https://pay.greenn.com.br/k11&quot;); return false;">Assinar agora</span>
<a id="k12" href="javascript:window.location='https://checkout.payt.com.br/k12'">Pagar com Pix</a>
<section id="k13" class="elementor-section" data-settings='{"background_background":"classic","link":{"url":"https://pay.hub.la/k13","is_external":"on"}}'><h2>Clique e garanta</h2></section>
<iframe id="k14" src="https://pay.cakto.com.br/k14" title="Checkout seguro"></iframe>
<button id="k16" data-url="https://buy.stripe.com/k16">Buy now</button>
<a id="k17" class="btn btn-cta" href="https://meuproduto.exemplo.net/oferta-especial">SIM, QUERO GARANTIR MINHA VAGA</a>
<span id="k18" data-checkout="https://checkout.pagtrust.com.br/k18">Desbloquear acesso</span>
<a id="k19" href="https://mpago.la/k19"><img src="/os-assets/abc.png" alt="Comprar com Mercado Pago"></a>
<input id="k20" type="button" value="Matricule-se" onclick="document.location.href = &quot;https://lastlink.com/p/C20/checkout-payment&quot;">
<a id="k1b" class="btn" href="https://pay.hotmart.com/A1?off=aaa#topo">   </a>

<a id="n1" class="btn cta" href="/upsell-especial">Sim, quero aproveitar essa oferta</a>
<a id="n2" class="btn" href="https://wa.me/5511999999999?text=Quero%20comprar">Quero comprar pelo WhatsApp</a>
<a id="n3" class="btn" href="https://api.whatsapp.com/send?phone=5511999999999">Comprar agora</a>
<a id="n4" class="elementor-button" href="#comprar">Comprar agora</a>
<a id="n5" href="mailto:contato@minhaloja.com.br">Comprar por e-mail</a>
<a id="n6" href="tel:+5511999999999">Ligar e comprar</a>
<a id="n7" class="btn" href="javascript:void(0)">Comprar</a>
<a id="n8" class="btn" href="https://instagram.com/minhaloja">Quero seguir no Instagram</a>
<a id="n9" href="https://outrosite.com.br/politica-de-privacidade">Política de privacidade</a>
<a id="n10" class="btn" href="https://minhaloja.com.br/vendas#oferta">Quero comprar</a>
<a id="n11" class="cta" href="https://blog.minhaloja.com.br/depoimentos">Quero ver depoimentos</a>
<div id="n12" data-checkout="true">Comprar</div>
<button id="n13" onclick="abrirModal('comprar')">Comprar</button>
<div id="n14" class="btn" onclick="window.open('https://wa.me/5511999999999')">Falar e comprar</div>
</body></html>`;

/** URL esperada de cada botão positivo (k1…k20) e plataforma. */
const EXPECTED: Record<string, [url: string, platform: string, source: CheckoutCandidate["source"]]> = {
  k1: ["https://pay.hotmart.com/A1?off=aaa", "Hotmart", "HREF"],
  k2: ["https://pay.kiwify.com.br/k2x?utm_source=facebook&utm_campaign=vsl", "Kiwify", "HREF"],
  k3: ["https://sun.eduzz.com/300003", "Eduzz", "ONCLICK"],
  k4: ["https://ev.braip.com/checkout/pla4/che4", "Braip", "ONCLICK"],
  k5: ["https://checkout.ticto.app/K5", "Ticto", "ONCLICK"],
  k6: ["https://go.perfectpay.com.br/PPU6", "PerfectPay", "FORM"],
  k7: ["https://pay.kirvano.com/k7", "Kirvano", "HREF"],
  k8: ["https://seguro.minhaloja.com.br/r/ABC123XYZ", "Yampi", "HREF"],
  k9: ["https://minhaloja.com.br/cart/39512345678:1", "Shopify", "HREF"],
  k10: ["https://app.monetizze.com.br/checkout/DAB10", "Monetizze", "HREF"],
  k11: ["https://pay.greenn.com.br/k11", "Greenn", "ONCLICK"],
  k12: ["https://checkout.payt.com.br/k12", "Payt", "ONCLICK"],
  k13: ["https://pay.hub.la/k13", "Hubla", "ONCLICK"],
  k14: ["https://pay.cakto.com.br/k14", "Cakto", "HREF"],
  k15: ["https://checkout.doppus.app/k15", "Doppus", "SCRIPT"],
  k16: ["https://buy.stripe.com/k16", "Stripe", "ONCLICK"],
  k17: ["https://meuproduto.exemplo.net/oferta-especial", UNKNOWN_CHECKOUT_PLATFORM, "HREF"],
  k18: ["https://checkout.pagtrust.com.br/k18", "Pagtrust", "ONCLICK"],
  k19: ["https://mpago.la/k19", "Mercado Pago", "HREF"],
  k20: ["https://lastlink.com/p/C20/checkout-payment", "Lastlink", "ONCLICK"],
};

function byUrl(candidates: CheckoutCandidate[]) {
  return new Map(candidates.map((c) => [c.url, c]));
}

describe("detectCheckouts", () => {
  const candidates = detectCheckouts(cheerio.load(FIXTURE), PAGE_URL);
  const found = byUrl(candidates);

  it("detecta pelo menos 19 dos 20 tipos de botão", () => {
    const missing = Object.entries(EXPECTED)
      .filter(([, [url]]) => !found.has(url))
      .map(([id]) => id);
    expect(missing, `não detectados: ${missing.join(", ")}`).toHaveLength(0);
    expect(20 - missing.length).toBeGreaterThanOrEqual(19);
  });

  it("reconhece plataforma e origem de cada botão", () => {
    for (const [id, [url, platform, source]] of Object.entries(EXPECTED)) {
      const candidate = found.get(url);
      expect(candidate, id).toBeDefined();
      expect(candidate?.platform, id).toBe(platform);
      expect(candidate?.source, id).toBe(source);
    }
  });

  it("não inclui negativos (upsell do mesmo site, WhatsApp, âncoras, e-mail, redes sociais, arquivos)", () => {
    expect(candidates).toHaveLength(20);
    const urls = candidates.map((c) => c.url).join("\n");
    for (const bad of [
      "upsell-especial",
      "wa.me",
      "whatsapp",
      "instagram",
      "politica",
      "blog.minhaloja",
      "logo.png",
      "mailto",
      "tel:",
      "comprar",
      "/vendas",
      "true",
    ]) {
      expect(urls).not.toContain(bad);
    }
  });

  it("agrupa por URL (ignora #hash), conta ocorrências e usa o primeiro texto não vazio", () => {
    const hotmart = found.get("https://pay.hotmart.com/A1?off=aaa");
    // a#k1, a#k1b (mesma URL com #topo) e o literal no <script>.
    expect(hotmart?.occurrences).toBe(3);
    expect(hotmart?.label).toBe("Comprar agora");
    expect(hotmart?.confidence).toBe(100);
    expect(found.get(EXPECTED.k2[0])?.occurrences).toBe(1);
  });

  it("mantém a query (UTM) na URL do checkout", () => {
    expect(found.get(EXPECTED.k2[0])?.url).toContain("utm_source=facebook");
  });

  it("usa textos de botão, value de input, alt de imagem e texto de formulário", () => {
    expect(found.get(EXPECTED.k7[0])?.label).toBe("Quero aproveitar");
    expect(found.get(EXPECTED.k6[0])?.label).toBe("Finalizar pedido");
    expect(found.get(EXPECTED.k19[0])?.label).toBe("Comprar com Mercado Pago");
    expect(found.get(EXPECTED.k20[0])?.label).toBe("Matricule-se");
    expect(found.get(EXPECTED.k14[0])?.label).toBe("Checkout seguro");
    expect(found.get(EXPECTED.k15[0])?.label).toBeUndefined();
  });

  it("domínio desconhecido entra com confiança baixa e fica no fim da lista", () => {
    const unknown = found.get(EXPECTED.k17[0]);
    expect(unknown?.confidence).toBeGreaterThan(0);
    expect(unknown?.confidence).toBeLessThan(50);
    expect(candidates.at(-1)?.url).toBe(EXPECTED.k17[0]);
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].confidence).toBeGreaterThanOrEqual(candidates[i].confidence);
    }
  });

  it("limita o rótulo a 80 caracteres", () => {
    const long = "Quero garantir agora mesmo a minha vaga com desconto especial de lançamento ".repeat(3);
    const $ = cheerio.load(`<a href="https://pay.kiwify.com.br/longo">${long}</a>`);
    const [candidate] = detectCheckouts($, PAGE_URL);
    expect(candidate.label?.length).toBeLessThanOrEqual(80);
    expect(candidate.label?.startsWith("Quero garantir agora")).toBe(true);
  });

  it("pula rótulo vazio e usa o primeiro texto não vazio do grupo", () => {
    const $ = cheerio.load(
      `<a href="https://pay.kiwify.com.br/x"><img src="a.png"></a><a href="https://pay.kiwify.com.br/x#b">Quero</a>`,
    );
    const [candidate] = detectCheckouts($, PAGE_URL);
    expect(candidate.label).toBe("Quero");
    expect(candidate.occurrences).toBe(2);
  });

  it("segue a ordem do documento, qualquer que seja o tipo de elemento", () => {
    const $ = cheerio.load(
      `<div onclick="location.href='https://pay.kiwify.com.br/x'">Primeiro</div>` +
        `<a href="https://pay.kiwify.com.br/x">Segundo</a>` +
        `<span data-href="https://pay.kiwify.com.br/y">Y</span><a href="https://pay.kiwify.com.br/z">Z</a>`,
    );
    const candidates = detectCheckouts($, PAGE_URL);
    expect(candidates.map((c) => c.url)).toEqual([
      "https://pay.kiwify.com.br/x",
      "https://pay.kiwify.com.br/y",
      "https://pay.kiwify.com.br/z",
    ]);
    expect(candidates[0].label).toBe("Primeiro");
    // O mesmo checkout em <a> e em onclick: a origem mais forte (HREF) vence.
    expect(candidates[0].source).toBe("HREF");
  });

  it("resolve links relativos contra <base href>", () => {
    const $ = cheerio.load(
      `<head><base href="https://loja.outra.com/produtos/"></head><a href="../cart/10:2">Comprar</a>`,
    );
    const [candidate] = detectCheckouts($, PAGE_URL);
    expect(candidate.url).toBe("https://loja.outra.com/cart/10:2");
    expect(candidate.platform).toBe("Shopify");
  });

  it("heurística: domínio externo precisa de texto/classe de compra", () => {
    const $ = cheerio.load(`
      <a class="btn" href="https://site-externo.com/saiba">Saiba mais sobre o método</a>
      <a class="botao" href="https://site-externo.com/ver">Ver depoimentos</a>
      <a class="comprar" href="https://site-externo.com/x"><img src="b.png"></a>
      <a href="https://site-externo.com/y">Quero me inscrever</a>`);
    const found = byUrl(detectCheckouts($, PAGE_URL));
    expect(found.has("https://site-externo.com/saiba")).toBe(false);
    expect(found.has("https://site-externo.com/ver")).toBe(false);
    expect(found.get("https://site-externo.com/x")?.confidence).toBe(25);
    expect(found.get("https://site-externo.com/y")?.confidence).toBe(30);
  });

  it("formulário externo desconhecido: checkout sem e-mail entra, captura de lead não", () => {
    const $ = cheerio.load(`
      <form action="https://minhaconta.activehosted.com/proc.php" method="post">
        <input type="text" name="fullname"><input type="text" name="EMAIL">
        <button type="submit">Quero participar</button>
      </form>
      <form action="https://loja-exemplo.io/finalizar" method="post">
        <input type="hidden" name="produto" value="1"><button type="submit">Finalizar compra</button>
      </form>`);
    const candidates = detectCheckouts($, PAGE_URL);
    expect(candidates.map((c) => [c.url, c.source, c.confidence])).toEqual([
      ["https://loja-exemplo.io/finalizar", "FORM", 30],
    ]);
  });

  it("literal em script só entra para plataformas conhecidas", () => {
    const $ = cheerio.load(`<script>
      var a = "https://checkout.site-qualquer.com/x";
      var b = 'https://pay.kiwify.com.br/abc';
      fetch("https://api.site.com/checkout");
    </script>`);
    const urls = detectCheckouts($, PAGE_URL).map((c) => c.url);
    expect(urls).toEqual(["https://pay.kiwify.com.br/abc"]);
  });

  it("links do mesmo site sem padrão de checkout não entram, mesmo com texto de compra", () => {
    const $ = cheerio.load(`<a class="btn" href="/oferta-upsell">Sim, quero aproveitar</a>
      <a class="btn" href="https://www.minhaloja.com.br/downsell">Quero comprar</a>`);
    expect(detectCheckouts($, PAGE_URL)).toEqual([]);
  });
});

describe("markCheckouts", () => {
  const $ = cheerio.load(FIXTURE);
  const candidates = detectCheckouts($, PAGE_URL);
  const count = markCheckouts($, PAGE_URL, candidates);

  it("marca todos os elementos que levam aos checkouts (script não conta)", () => {
    // k1, k1b, k2…k14, k16…k20 = 2 + 13 + 5
    expect(count).toBe(20);
    expect($("[data-os-checkout]").length).toBe(20);
    for (const id of Object.keys(EXPECTED)) {
      if (id === "k15") continue;
      expect($(`#${id}`).attr("data-os-checkout"), id).toBe("1");
    }
  });

  it("não marca os negativos", () => {
    for (let i = 1; i <= 14; i++) expect($(`#n${i}`).attr("data-os-checkout"), `n${i}`).toBeUndefined();
    expect($("#n1").attr("href")).toBe("/upsell-especial");
    expect($("#n13").attr("onclick")).toBe("abrirModal('comprar')");
  });

  it("deixa o href dos links absoluto", () => {
    expect($("#k9").attr("href")).toBe("https://minhaloja.com.br/cart/39512345678:1");
    expect($("#k10").attr("href")).toBe("https://app.monetizze.com.br/checkout/DAB10");
    expect($("#k1b").attr("href")).toBe("https://pay.hotmart.com/A1?off=aaa#topo");
    expect($("#k12").attr("href")).toBe("https://checkout.payt.com.br/k12");
  });

  it("troca onclick por data-os-href", () => {
    expect($("#k3").attr("onclick")).toBeUndefined();
    expect($("#k3").attr("data-os-href")).toBe("https://sun.eduzz.com/300003");
    expect($("#k11").attr("onclick")).toBeUndefined();
    expect($("#k11").attr("data-os-href")).toBe("https://pay.greenn.com.br/k11");
    expect($("#k20").attr("onclick")).toBeUndefined();
    expect($("#k20").attr("data-os-href")).toBe("https://lastlink.com/p/C20/checkout-payment");
  });

  it("window.open vira data-os-target=_blank", () => {
    expect($("#k4").attr("data-os-href")).toBe("https://ev.braip.com/checkout/pla4/che4");
    expect($("#k4").attr("data-os-target")).toBe("_blank");
    expect($("#k3").attr("data-os-target")).toBeUndefined();
  });

  it("data-*, Elementor e iframe", () => {
    expect($("#k5").attr("data-os-href")).toBe("https://checkout.ticto.app/K5");
    expect($("#k16").attr("data-os-href")).toBe("https://buy.stripe.com/k16");
    expect($("#k18").attr("data-os-href")).toBe("https://checkout.pagtrust.com.br/k18");
    expect($("#k13").attr("data-os-href")).toBe("https://pay.hub.la/k13");
    expect($("#k14").attr("src")).toBe("https://pay.cakto.com.br/k14");
  });

  it("formulário é marcado no próprio <form>", () => {
    expect($("#k6").attr("data-os-checkout")).toBe("1");
    expect($("#k6").attr("action")).toBe("https://go.perfectpay.com.br/PPU6");
    expect($("#k6 button").attr("data-os-checkout")).toBeUndefined();
  });

  it("detectar de novo no HTML marcado encontra os mesmos checkouts", () => {
    const again = detectCheckouts(cheerio.load($.html()), PAGE_URL);
    expect(again.map((c) => c.url).sort()).toEqual(candidates.map((c) => c.url).sort());
  });

  it("marca checkout adicionado manualmente (URL relativa ou de outro domínio)", () => {
    const $$ = cheerio.load(FIXTURE);
    const manual: CheckoutCandidate = {
      url: "https://minhaloja.com.br/upsell-especial",
      platform: UNKNOWN_CHECKOUT_PLATFORM,
      source: "HREF",
      confidence: 100,
      occurrences: 1,
    };
    expect(markCheckouts($$, PAGE_URL, [manual])).toBe(1);
    expect($$("#n1").attr("data-os-checkout")).toBe("1");
    expect($$("#n1").attr("href")).toBe("https://minhaloja.com.br/upsell-especial");
  });

  it("<a> com onclick e href vazio recebe o href do checkout", () => {
    const $$ = cheerio.load(
      `<a id="a" href="#" onclick="window.open('https://pay.kiwify.com.br/z')">Comprar</a>` +
        `<div id="b" onclick="window.open('https://pay.kiwify.com.br/w', '_self')">Comprar</div>`,
    );
    expect(markCheckouts($$, PAGE_URL, detectCheckouts($$, PAGE_URL))).toBe(2);
    expect($$("#a").attr("href")).toBe("https://pay.kiwify.com.br/z");
    expect($$("#a").attr("target")).toBe("_blank");
    expect($$("#a").attr("onclick")).toBeUndefined();
    expect($$("#b").attr("data-os-href")).toBe("https://pay.kiwify.com.br/w");
    expect($$("#b").attr("data-os-target")).toBeUndefined();
  });

  it("sem candidatos não mexe no HTML", () => {
    const $$ = cheerio.load(FIXTURE);
    const before = $$.html();
    expect(markCheckouts($$, PAGE_URL, [])).toBe(0);
    expect($$.html()).toBe(before);
  });
});
