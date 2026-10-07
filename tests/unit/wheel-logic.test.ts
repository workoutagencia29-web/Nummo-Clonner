/**
 * Roleta de desconto — regras puras (sem navegador): fatias (formato, chance
 * mínima de 1%, no máximo 12), sorteio pelo peso, parada na fatia sorteada,
 * desenho da roda, parâmetro os_premio, mapa de prêmios embutido pelo render
 * (só links da oferta com endereço; botões de checkout marcados), avisos do ZIP
 * e do "Próximos passos", eventos dos pixels e a tela "Testar pixels".
 */
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { describeRow } from "@/components/offers/pixel-test/logic";
import { defToHtml } from "@/editor/widgets/quiz-content";
import { DEFAULT_WHEEL, EXAMPLE_SLICES, wheelDef } from "@/editor/widgets/wheel-content";
import { deadWheelButtonsWarning, exportWarningFix, wheelPrizesWarning } from "@/lib/export/warnings";
import { computeReadiness } from "@/lib/readiness";
import {
  clampChance,
  parsePrizeParam,
  parseSlices,
  pickSlice,
  prizeId,
  prizeParam,
  realChances,
  sliceAt,
  stopRotation,
  type WheelSlice,
  wheelSvg,
} from "@/lib/wheel";
import { applyWheelPrizes, prizesWithoutLink, wheelPrizeMap, wheelRenderData, wheelsIn } from "@/lib/wheel-prizes";
import { wheelEvent } from "@/runtime/tracking/wheel";

const SLICES: WheelSlice[] = [
  { text: "10% OFF", color: "#7c3aed", chance: 40, link: "c10", coupon: "" },
  { text: "30% OFF", color: "#ec4899", chance: 20, link: "c30", coupon: "ROLETA30" },
  { text: "Não foi dessa vez", color: "#64748b", chance: 30, link: "", coupon: "", lose: true },
  { text: "50% OFF", color: "#10b981", chance: 10, link: "", coupon: "" },
];

const wheelHtml = (slices: WheelSlice[] = SLICES, extra = "") =>
  `<!doctype html><html><head><title>R</title></head><body>${defToHtml(
    wheelDef({ ...DEFAULT_WHEEL, slices }, { html: true }),
  ).replace('data-os-banner="1"', `data-os-banner="1"${extra}`)}</body></html>`;

describe("fatias", () => {
  it("lê o JSON, arruma o que vier errado e guarda no máximo 12", () => {
    const parsed = parseSlices(
      JSON.stringify([
        { text: "  20% OFF ", color: "vermelho", chance: 0, link: "Checkout X", coupon: "A" },
        { text: "", lose: true, link: "c10", coupon: "B", chance: 250 },
      ]),
    );
    expect(parsed).toEqual([
      { text: "20% OFF", color: "#7c3aed", chance: 1, link: "", coupon: "A" },
      { text: "Não foi dessa vez", color: "#f59e0b", chance: 100, link: "", coupon: "", lose: true },
    ]);
    expect(parseSlices("isso não é json")).toEqual([]);
    expect(parseSlices(JSON.stringify(Array.from({ length: 20 }, () => ({ text: "x" }))))).toHaveLength(12);
    // Toda fatia tem chance real: 0, negativo ou vazio vira 1%.
    expect([0, -5, "", "abc", 0.4, 1.6, "35,4", 140].map(clampChance)).toEqual([1, 1, 1, 1, 1, 2, 35, 100]);
  });

  it("chance real pelos pesos (as chances não precisam somar 100)", () => {
    expect(realChances([40, 30, 20, 10])).toEqual([40, 30, 20, 10]);
    expect(realChances([50, 30, 20, 10])).toEqual([45.5, 27.3, 18.2, 9.1]);
  });
});

describe("sorteio e parada", () => {
  it("sorteia pelo peso (10 mil giros com sementes ficam perto das chances)", () => {
    let seed = 7;
    const rand = () => {
      // mulberry32: determinístico, para o teste não oscilar.
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const count = [0, 0, 0, 0];
    for (let i = 0; i < 10_000; i++) count[pickSlice([40, 30, 20, 10], rand())]++;
    // Cada fatia a no máximo 2 pontos percentuais da chance dela.
    for (const [i, c] of [40, 30, 20, 10].entries()) expect(Math.abs(count[i] / 100 - c)).toBeLessThan(2);
    // Bordas: o começo é a primeira fatia, o fim a última; uma fatia de 1% sai.
    expect(pickSlice([40, 30, 20, 10], 0)).toBe(0);
    expect(pickSlice([40, 30, 20, 10], 0.9999)).toBe(3);
    expect(pickSlice([99, 1], 0.995)).toBe(1);
  });

  it("a roda para dentro da fatia sorteada (longe das bordas), depois das voltas pedidas", () => {
    for (const n of [2, 3, 4, 5, 7, 8, 12]) {
      for (let i = 0; i < n; i++) {
        for (const r of [0, 0.5, 1]) {
          const from = 123.4;
          const deg = stopRotation(i, n, from, 5, r);
          expect(sliceAt(deg, n)).toBe(i);
          expect(deg - from).toBeGreaterThan(5 * 360 - 360);
          // Longe da borda: pelo menos 15% da fatia.
          const seg = 360 / n;
          const at = (((360 - deg) % 360) + 360) % 360;
          const inside = at - i * seg;
          expect(inside).toBeGreaterThanOrEqual(seg * 0.15 - 1e-9);
          expect(inside).toBeLessThanOrEqual(seg * 0.85 + 1e-9);
        }
      }
    }
    // Quem volta: a roda parada no prêmio, sem voltas.
    expect(sliceAt(stopRotation(2, 4, 0, 0, 0.5), 4)).toBe(2);
  });

  it("desenho: uma fatia por cor, texto de cada fatia, nome acessível e texto escapado", () => {
    const svg = wheelSvg([...SLICES.slice(0, 3), { ...SLICES[3], text: "<b>&50%" }]);
    const $ = cheerio.load(svg, { xml: true });
    expect(
      $("path[fill]")
        .map((_, el) => $(el).attr("fill"))
        .get(),
    ).toEqual(["#7c3aed", "#ec4899", "#64748b", "#10b981"]);
    expect(
      $("text")
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(["10% OFF", "30% OFF", "Não foidessa vez", "<b>&50%"]);
    expect($("svg").attr("aria-label")).toBe("Roleta com 4 fatias: 10% OFF, 30% OFF, Não foi dessa vez, <b>&50%");
    expect(svg).not.toContain("<b>");
  });
});

describe("prêmio levado à página de vendas", () => {
  it("os_premio: chave do link + validade, e só o formato certo vale", () => {
    const until = 1_900_000_000_000;
    const id = prizeId({ link: "checkout-30", text: "30% OFF", coupon: "" });
    expect(parsePrizeParam(prizeParam(id, until))).toEqual({ key: id, until });
    for (const bad of ["", "checkout", "Checkout.x", "a b.1", "c30.", "<x>.1", `${"a".repeat(91)}.1`, null]) {
      expect(parsePrizeParam(bad)).toBeNull();
    }
  });

  it("mapa de prêmios: só fatias com link da oferta com endereço http(s); opções da roleta junto", () => {
    const html = wheelHtml(SLICES)
      .replace('data-os-days="7"', 'data-os-days="3"')
      .replace('data-os-banner="1"', 'data-os-banner="0"');
    expect(wheelsIn(html)).toMatchObject([{ days: 3, minutes: 10, banner: false }]);
    const links = [
      { key: "c10", url: "https://pay.exemplo.com/10" },
      { key: "c30", url: "javascript:alert(1)" },
    ];
    expect(wheelPrizeMap([html, null, "<p>sem roleta</p>"], links)).toEqual({
      [prizeId(SLICES[0])]: { u: "https://pay.exemplo.com/10", t: "10% OFF", c: "", d: 3, m: 10, b: 0 },
    });
    // O mesmo link em duas fatias com textos diferentes: dois prêmios (a faixa mostra o texto certo).
    const twice = wheelHtml([SLICES[0], { ...SLICES[1], text: "Frete grátis", link: "c10", coupon: "" }]);
    const map = wheelPrizeMap([twice], links);
    expect(Object.values(map).map((p) => p.t)).toEqual(["10% OFF", "Frete grátis"]);
    expect(Object.keys(map)[0]).toMatch(/^c10-[0-9a-z]{1,6}$/);
    expect(prizesWithoutLink(html, links)).toEqual(["30% OFF", "50% OFF"]);
  });

  it("render: marca os botões de checkout e embute o mapa (escapado) e o CSS da visibilidade", () => {
    const wheel = wheelRenderData(
      [wheelHtml(SLICES.map((s, i) => (i === 0 ? { ...s, coupon: "</script><b>" } : s)))],
      [
        { key: "c10", url: "https://pay.exemplo.com/10?a=1&b=</script>", kind: "CHECKOUT" },
        { key: "c30", url: "https://pay.exemplo.com/30", kind: "CHECKOUT" },
        { key: "checkout", url: "https://pay.exemplo.com/cheio", kind: "CHECKOUT" },
        { key: "zap", url: "https://wa.me/5511", kind: "WHATSAPP" },
      ],
    );
    expect(wheel.checkoutKeys).toEqual(["c10", "c30", "checkout"]);
    const sales = `<!doctype html><html><head><title>V</title></head><body>
      <a class="os-btn" href="https://pay.exemplo.com/cheio" data-os-link="checkout">Comprar</a>
      <a href="https://wa.me/5511" data-os-link="zap">WhatsApp</a>
      <div data-os-premio="ganhou">Preço com desconto</div></body></html>`;
    const out = applyWheelPrizes(sales, wheel);
    const $ = cheerio.load(out);
    expect($('[data-os-link="checkout"]').attr("data-os-link-kind")).toBe("checkout");
    expect($('[data-os-link="zap"]').attr("data-os-link-kind")).toBeUndefined();
    const json = $("#os-premios").text();
    expect(json).not.toContain("</script>");
    expect(JSON.parse(json)[prizeId({ ...SLICES[0], coupon: "</script><b>" })]).toMatchObject({
      u: "https://pay.exemplo.com/10?a=1&b=%3C/script%3E",
      c: "</script><b>",
    });
    expect($("#os-premio-style").text()).toContain(
      'html:not(.os-premio-on) [data-os-premio="ganhou"]{display:none!important}',
    );
    expect(out.startsWith("<!doctype html>")).toBe(true);
    // Idempotente; sem prêmio com link, só o CSS da visibilidade (se a página usa).
    expect(applyWheelPrizes(out, wheel)).toBe(out);
    expect(applyWheelPrizes(sales, { prizes: {}, checkoutKeys: ["checkout"] })).not.toContain("data-os-link-kind");
    expect(applyWheelPrizes("<p>nada</p>", null)).toBe("<p>nada</p>");
  });

  it("código da oferta: em cada roleta (mesmo sem prêmio com link) e no mapa; ofertas diferentes, códigos diferentes", () => {
    const links = [{ key: "c10", url: "https://pay.exemplo.com/10", kind: "CHECKOUT" }];
    const a = wheelRenderData([wheelHtml()], links, "oferta-a");
    const b = wheelRenderData([wheelHtml()], links, "oferta-b");
    expect(a.scope).toMatch(/^[0-9a-z]+$/);
    expect(a.scope).not.toBe(b.scope);
    expect(wheelRenderData([wheelHtml()], links, "oferta-a").scope).toBe(a.scope);
    const out = applyWheelPrizes(wheelHtml(), a);
    const $ = cheerio.load(out);
    expect($('[data-os-widget="wheel"]').attr("data-os-oferta")).toBe(a.scope);
    expect($("#os-premios").attr("data-os-oferta")).toBe(a.scope);
    // Sem prêmio com link: a roleta ganha o código mesmo assim (memória do giro separada), sem mapa.
    const empty = applyWheelPrizes(wheelHtml(EXAMPLE_SLICES), { ...a, prizes: {} });
    expect(cheerio.load(empty)('[data-os-widget="wheel"]').attr("data-os-oferta")).toBe(a.scope);
    expect(empty).not.toContain("os-premios");
    // Sem código (render antigo/testes): nada muda na roleta.
    expect(applyWheelPrizes(wheelHtml(), wheelRenderData([wheelHtml()], links))).not.toContain("data-os-oferta");
  });
});

describe("avisos", () => {
  it("ZIP: prêmio sem link e “Resgatar” sem destino, com o conserto “Abrir no editor”", () => {
    const prizes = wheelPrizesWarning([{ name: "Roleta", prizes: ["10% OFF", "20% OFF", "30% OFF", "50% OFF"] }]);
    expect(prizes).toBe(
      "Roleta com prêmio sem link de checkout na página “Roleta” (os prêmios “10% OFF”, “20% OFF”, “30% OFF” e mais 1): quem ganhar não recebe o desconto. Para resolver, abra a página no editor, clique na roleta e escolha o checkout com o desconto de cada prêmio em Configurações → Fatias.",
    );
    expect(exportWarningFix(prizes ?? "")).toEqual({ kind: "deadButtons", wheel: true });
    expect(wheelPrizesWarning([{ name: "Roleta", prizes: [] }])).toBeNull();
    const dead = deadWheelButtonsWarning([{ name: "Roleta", buttons: ["RESGATAR MEU DESCONTO"] }]);
    expect(dead).toBe(
      "O botão “RESGATAR MEU DESCONTO” da roleta da página “Roleta” ainda não leva a lugar nenhum: abra a página no editor, clique na roleta e escolha a página de vendas em “Ao resgatar o prêmio”, nas Configurações.",
    );
    expect(exportWarningFix(dead ?? "")).toEqual({ kind: "deadButtons", wheel: true });
  });

  it("Próximos passos: “Roleta com prêmio sem link de checkout” abre a roleta no editor; o “Resgatar” não conta como botão de compra", () => {
    const base = {
      clonedCheckoutUrls: [],
      pixelCount: 1,
      company: { name: "", document: "", email: "", phone: "", address: "" },
      liveUrl: null,
      lastZipAt: null,
    };
    const template = wheelHtml(EXAMPLE_SLICES);
    const r = computeReadiness(
      { ...base, htmls: [template], wheelDocs: [{ id: "doc-roleta", html: template }], links: [] },
      () => "",
    );
    const item = r.items.find((i) => i.id === "roleta");
    expect(item).toMatchObject({
      title: "Roleta com prêmio sem link de checkout",
      done: false,
      optional: false,
      cta: "Abrir no editor",
      target: { editor: "doc-roleta" },
    });
    expect(item?.detail).toMatch(/^Os prêmios “10% OFF”, “20% OFF”, “30% OFF” e mais 1 ainda não levam ao checkout/);
    // O "Resgatar" (data-os-wh-go) não é botão de compra.
    expect(r.items.find((i) => i.id === "checkout")?.title).toBe("Cadastrar o checkout");
    const linked = wheelHtml(SLICES.map((s) => (s.lose ? s : { ...s, link: "c10" })));
    const ok = computeReadiness(
      { ...base, htmls: [linked], links: [{ key: "c10", url: "https://pay.exemplo.com/10" }] },
      () => "",
    );
    expect(ok.items.find((i) => i.id === "roleta")).toMatchObject({ done: true, title: "Prêmios da roleta ligados" });
    // Com o tipo dos links: o prêmio só chega a botões ligados a um link do tipo checkout.
    const kinds = (sales: string, kind: string) =>
      computeReadiness(
        {
          ...base,
          htmls: [linked, sales],
          links: [
            { key: "c10", url: "https://pay.exemplo.com/10", kind: "CHECKOUT" },
            { key: "up", url: "https://pay.exemplo.com/cheio", kind },
          ],
        },
        () => "",
      ).items.find((i) => i.id === "roleta");
    const direct = kinds('<a class="os-btn" href="https://pay.hotmart.com/CHEIO">COMPRAR</a>', "CHECKOUT");
    expect(direct).toMatchObject({
      done: false,
      title: "Levar o prêmio da roleta aos botões de compra",
      cta: "Abrir links",
      target: { tab: "links" },
    });
    expect(direct?.detail).toContain("quem ganhar vê o prêmio, mas paga o preço cheio");
    expect(kinds('<a class="os-btn" href="#" data-os-link="up">COMPRAR</a>', "UPSELL")).toMatchObject({
      done: false,
      title: "Levar o prêmio da roleta aos botões de compra",
    });
    expect(kinds('<a class="os-btn" href="#" data-os-link="up">COMPRAR</a>', "CHECKOUT")).toMatchObject({
      done: true,
      title: "Prêmios da roleta ligados",
    });
    // O "Resgatar" ligado a um checkout também leva ao checkout do prêmio.
    const goCheckout = wheelHtml(SLICES.map((s) => (s.lose ? s : { ...s, link: "c10" }))).replace(
      'href="#" data-os-link=""',
      'href="#" data-os-link="up"',
    );
    expect(
      computeReadiness(
        {
          ...base,
          htmls: [goCheckout],
          links: [
            { key: "c10", url: "https://pay.exemplo.com/10", kind: "CHECKOUT" },
            { key: "up", url: "https://pay.exemplo.com/cheio", kind: "CHECKOUT" },
          ],
        },
        () => "",
      ).items.find((i) => i.id === "roleta"),
    ).toMatchObject({ done: true });
    // Oferta sem roleta: o passo não aparece.
    expect(
      computeReadiness({ ...base, htmls: ["<p>x</p>"], links: [] }, () => "").items.map((i) => i.id),
    ).not.toContain("roleta");
  });
});

describe("eventos dos pixels", () => {
  it("RoletaGirou / RoletaResgatou com o texto do prêmio (e nada com o rastreamento desligado)", () => {
    expect(wheelEvent({ kind: "spin", prize: "30% OFF", won: true, track: true })).toEqual({
      name: "RoletaGirou",
      ga: "roleta_girou",
      params: { roleta_premio: "30% OFF" },
    });
    expect(wheelEvent({ kind: "redeem", prize: "30% OFF", track: true })).toEqual({
      name: "RoletaResgatou",
      ga: "roleta_resgatou",
      params: { roleta_premio: "30% OFF" },
    });
    // Quem caiu em "Sem prêmio" e clicou em "Continuar" não conta como resgate (o giro conta).
    expect(wheelEvent({ kind: "redeem", prize: "Não foi dessa vez", won: false, track: true })).toBeNull();
    expect(wheelEvent({ kind: "spin", prize: "Não foi dessa vez", won: false, track: true })).toMatchObject({
      name: "RoletaGirou",
    });
    expect(wheelEvent({ kind: "redeem", prize: "30% OFF", won: true, track: true })).toMatchObject({
      name: "RoletaResgatou",
    });
    expect(wheelEvent({ kind: "spin", prize: "x", track: false })).toBeNull();
    expect(wheelEvent({ kind: "outro" })).toBeNull();
    expect(wheelEvent(null)).toBeNull();
  });

  it("Testar pixels explica as linhas da roleta", () => {
    const base = { id: 1, status: "FIRED" as const, at: new Date().toISOString() };
    expect(
      describeRow({ ...base, vendor: "META", event: "RoletaGirou", detail: { roleta_premio: "30% OFF" } }),
    ).toMatchObject({ title: "RoletaGirou", subtitle: "Roleta girada: saiu “30% OFF”" });
    expect(
      describeRow({
        ...base,
        vendor: "GA4",
        event: "roleta_resgatou",
        detail: { roleta_premio: "30% OFF", os_versao: "B" },
      }),
    ).toMatchObject({ subtitle: "Roleta: clicou em resgatar “30% OFF” · versão B" });
  });
});
