/**
 * Checkout do Offer Studio ligado ao resto da oferta (fase 2, parte B) — regras
 * puras, sem navegador nem banco:
 * - bloco "Botão de checkout" (Conversão, nasce ligado ao checkout do Offer Studio);
 * - teste A/B: ?os_versao=<letra> nos botões e prêmios que levam à página de
 *   checkout (render) e o script da página que leva a versão ao rastreamento;
 * - roleta: prêmio "Checkout do Offer Studio" no mapa (página do próprio site
 *   + a chave do link), avisos do editor, do "Próximos passos" e do ZIP e
 *   cupom num prêmio desse checkout (passo e aviso próprios: a página de
 *   checkout não tem campo de cupom);
 * - "Próximos passos": botão ligado a um checkout do Offer Studio ainda não salvo.
 */
import vm from "node:vm";
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { ALL_BLOCKS } from "@/editor/blocks";
import { AUTO_LINK_OWN_CHECKOUT, PROP_AUTO_LINK } from "@/editor/blocks/shared";
import { ownCheckoutLink } from "@/editor/widgets/hooks";
import { defToHtml } from "@/editor/widgets/quiz-content";
import { sliceWarn, WARN_TEXT } from "@/editor/widgets/wheel";
import { DEFAULT_WHEEL, wheelDef } from "@/editor/widgets/wheel-content";
import { CHECKOUT_VERSION_PARAM, withCheckoutVersion } from "@/lib/checkout/contract";
import { CHECKOUT_VERSION_ATTR, CHECKOUT_VERSION_SCRIPT, injectCheckoutVersion } from "@/lib/checkout/page";
import { exportWarningFix, ownCheckoutCouponWarning } from "@/lib/export/warnings";
import { renderPageHtml } from "@/lib/page-render";
import { renderLinks } from "@/lib/payments/links";
import { computeReadiness, type ReadinessInput } from "@/lib/readiness";
import { TRACKING_CONFIG_ID, type TrackingRuntimeConfig, VERSION_PARAM } from "@/lib/tracking/runtime-config";
import { PRIZE_MAP_ID, prizeId, type WheelSlice } from "@/lib/wheel";
import {
  ownCheckoutCoupons,
  ownCheckoutPrizes,
  prizeGaps,
  prizesWithoutLink,
  wheelPrizeMap,
  wheelRenderData,
} from "@/lib/wheel-prizes";

const SLICES: WheelSlice[] = [
  { text: "10% OFF", color: "#7c3aed", chance: 40, link: "hotmart-10", coupon: "" },
  { text: "30% OFF", color: "#ec4899", chance: 20, link: "proprio-30", coupon: "" },
  { text: "Não foi dessa vez", color: "#64748b", chance: 30, link: "", coupon: "", lose: true },
  { text: "50% OFF", color: "#10b981", chance: 10, link: "proprio-50", coupon: "ROLETA50" },
];

const wheelHtml = (slices: WheelSlice[] = SLICES) =>
  `<!doctype html><html><head><title>R</title></head><body>${defToHtml(
    wheelDef({ ...DEFAULT_WHEEL, slices }, { html: true }),
  )}</body></html>`;

/** Linhas do banco como o render recebe (RENDER_LINK_SELECT). */
const ROWS = [
  {
    key: "checkout",
    url: "https://pay.hotmart.com/CHEIO",
    kind: "CHECKOUT",
    target: "URL",
    payment: null,
    checkout: null,
  },
  {
    key: "hotmart-10",
    url: "https://pay.hotmart.com/DEZ",
    kind: "CHECKOUT",
    target: "URL",
    payment: null,
    checkout: null,
  },
  // Checkout do Offer Studio com o produto salvo (o endereço de antes nunca vai para a página).
  {
    key: "proprio-30",
    url: "https://antigo.exemplo.com",
    kind: "CHECKOUT",
    target: "CHECKOUT",
    payment: null,
    checkout: { id: "c30" },
  },
  { key: "proprio-50", url: "", kind: "UPSELL", target: "CHECKOUT", payment: null, checkout: { id: "c50" } },
  // Ainda sem o produto salvo: sem destino em lugar nenhum.
  { key: "proprio-vazio", url: "", kind: "CHECKOUT", target: "CHECKOUT", payment: null, checkout: null },
] as Parameters<typeof renderLinks>[0];

const PREVIEW = renderLinks(ROWS, { checkoutHref: (key) => `/checkout/${key}` });
/** Quem renderiza sem dizer o endereço da página de checkout (o link fica sem destino). */
const ZIP = renderLinks(ROWS);

describe("bloco “Botão de checkout”", () => {
  it("fica em Conversão, logo depois do “Botão do checkout”, e nasce pedindo o checkout do Offer Studio", () => {
    const ids = ALL_BLOCKS.map((b) => b.id);
    const block = ALL_BLOCKS.find((b) => b.id === "cta-checkout-proprio");
    expect(block).toMatchObject({ label: "Botão de checkout", category: "conversao" });
    expect(block?.hint).toContain("checkout do Offer Studio");
    expect(ids.indexOf("cta-checkout-proprio")).toBe(ids.indexOf("cta-checkout") + 1);
    const button = JSON.stringify(block?.content);
    expect(button).toContain(`"${PROP_AUTO_LINK}":"${AUTO_LINK_OWN_CHECKOUT}"`);
    expect(button).toContain('"data-os-link":""');
    expect(button).toContain('"name":"Botão de checkout"');
    // O texto não promete PIX (fora do real quem cobra é a Kyvo).
    expect(button).not.toMatch(/pix/i);
  });

  it("liga ao primeiro link “Checkout do Offer Studio” (o do tipo checkout antes de upsell/downsell)", () => {
    const links = [
      { key: "hotmart", label: "Hotmart", kind: "CHECKOUT", url: "https://pay.hotmart.com/X" },
      { key: "upsell", label: "Upsell", kind: "UPSELL", checkout: "Upsell · R$ 47,00" },
      { key: "principal", label: "Principal", kind: "CHECKOUT", checkout: "" },
    ];
    expect(ownCheckoutLink(links)?.key).toBe("principal");
    expect(ownCheckoutLink(links.slice(0, 2))?.key).toBe("upsell");
    expect(ownCheckoutLink(links.slice(0, 1))).toBeUndefined();
  });
});

describe("render: links de checkout do Offer Studio e teste A/B", () => {
  it("withCheckoutVersion põe ?os_versao= sem trocar o que já existe e mantém o #", () => {
    expect(CHECKOUT_VERSION_PARAM).toBe(VERSION_PARAM);
    expect(withCheckoutVersion("/checkout/curso", "B")).toBe("/checkout/curso?os_versao=B");
    expect(withCheckoutVersion("/checkout/curso?utm_source=fb#topo", "B")).toBe(
      "/checkout/curso?utm_source=fb&os_versao=B#topo",
    );
    expect(withCheckoutVersion("/checkout/curso?", "C")).toBe("/checkout/curso?os_versao=C");
    expect(withCheckoutVersion("/checkout/curso?os_versao=A", "B")).toBe("/checkout/curso?os_versao=A");
    expect(withCheckoutVersion("../checkout/curso/index.html", "B")).toBe("../checkout/curso/index.html?os_versao=B");
    // Letra fora do formato do rastreamento ou link sem destino: nada muda.
    expect(withCheckoutVersion("/checkout/curso", "<b>")).toBe("/checkout/curso");
    expect(withCheckoutVersion("", "B")).toBe("");
  });

  const SALES = `<!doctype html><html><head><title>V</title></head><body>
    <a id="proprio" class="os-btn" href="#" data-os-link="proprio-30">COMPRAR</a>
    <a id="hotmart" class="os-btn" href="#" data-os-link="checkout">COMPRAR NA HOTMART</a>
    <a id="vazio" class="os-btn" href="#" data-os-link="proprio-vazio">SEM CHECKOUT</a>
  </body></html>`;

  const tracking = (variant: TrackingRuntimeConfig["variant"]) => ({
    config: { mode: "preview", consent: { mode: "OFF" }, variant } as unknown as TrackingRuntimeConfig,
    scriptTag: "<script data-os-tracking></script>",
  });

  const render = (variant: TrackingRuntimeConfig["variant"], links = PREVIEW) => {
    const wheel = wheelRenderData([wheelHtml()], links, "oferta00000000000000001");
    return cheerio.load(
      renderPageHtml(`${SALES.replace("</body>", "")}${wheelHtml().replace(/^[\s\S]*<body>/, "")}`, {
        links,
        wheel,
        pageHref: () => "#",
        runtimeTag: "",
        tracking: tracking(variant),
      }),
    );
  };

  it("na versão B, os botões e os prêmios do checkout do Offer Studio levam ?os_versao=B (os outros, não)", () => {
    const $ = render({ name: "B", folder: "vendas-b/", srcHosts: [] });
    expect($("#proprio").attr("href")).toBe("/checkout/proprio-30?os_versao=B");
    // Checkout de fora: a marca da versão vem do script (markVersion), não do render.
    expect($("#hotmart").attr("href")).toBe("https://pay.hotmart.com/CHEIO");
    expect($("#vazio").attr("href")).toBe("#");
    const map = JSON.parse($(`#${PRIZE_MAP_ID}`).text());
    expect(map[prizeId(SLICES[1])]).toMatchObject({ u: "/checkout/proprio-30?os_versao=B", o: "proprio-30" });
    expect(map[prizeId(SLICES[0])]).toMatchObject({ u: "https://pay.hotmart.com/DEZ" });
    expect(map[prizeId(SLICES[0])]).not.toHaveProperty("o");
  });

  it("página com uma versão só: o endereço da página de checkout fica como está", () => {
    const $ = render(null);
    expect($("#proprio").attr("href")).toBe("/checkout/proprio-30");
    expect(JSON.parse($(`#${PRIZE_MAP_ID}`).text())[prizeId(SLICES[1])].u).toBe("/checkout/proprio-30");
  });
});

describe("página de checkout: a versão do endereço vai para o rastreamento", () => {
  const CONFIG = { v: 1, mode: "live", pixels: [] };
  const page = (cfg: object | null) =>
    `<!doctype html><html><head><meta charset="utf-8">${
      cfg ? `<script type="application/json" id="${TRACKING_CONFIG_ID}">${JSON.stringify(cfg)}</script>` : ""
    }<script data-os-tracking>/* rastreamento */</script></head><body></body></html>`;

  /** Roda o script da versão com um endereço e um #os-tracking (sem navegador). */
  function run(search: string, cfg: object) {
    const el = { textContent: JSON.stringify(cfg) };
    const code = CHECKOUT_VERSION_SCRIPT.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    vm.runInNewContext(code, {
      location: { search },
      URLSearchParams,
      JSON,
      document: { getElementById: (id: string) => (id === TRACKING_CONFIG_ID ? el : null) },
    });
    return JSON.parse(el.textContent);
  }

  it("fica logo depois do #os-tracking, antes do script de rastreamento (uma vez)", () => {
    const html = injectCheckoutVersion(page(CONFIG));
    const config = html.indexOf(`id="${TRACKING_CONFIG_ID}"`);
    const script = html.indexOf(CHECKOUT_VERSION_ATTR);
    expect(config).toBeGreaterThan(0);
    expect(script).toBeGreaterThan(config);
    expect(script).toBeLessThan(html.indexOf("data-os-tracking>"));
    expect(injectCheckoutVersion(html)).toBe(html);
    // Sem rastreamento na página: nada muda.
    expect(injectCheckoutVersion(page(null))).toBe(page(null));
  });

  it("põe a versão do endereço no #os-tracking; sem ela, com valor estranho ou versão já definida, nada muda", () => {
    expect(run("?os_versao=B&utm_source=fb", CONFIG).variant).toEqual({ name: "B", folder: "", srcHosts: [] });
    expect(run("?utm_source=fb", CONFIG)).not.toHaveProperty("variant");
    expect(run("?os_versao=%3Cscript%3E", CONFIG)).not.toHaveProperty("variant");
    expect(run(`?os_versao=${"x".repeat(21)}`, CONFIG)).not.toHaveProperty("variant");
    const own = { ...CONFIG, variant: { name: "A", folder: "", srcHosts: [] } };
    expect(run("?os_versao=B", own).variant.name).toBe("A");
  });
});

describe("roleta com prêmio no checkout do Offer Studio", () => {
  it("mapa de prêmios: a página de checkout do site + a chave do link; sem o endereço da página, fica de fora", () => {
    const preview = wheelPrizeMap([wheelHtml()], PREVIEW);
    expect(preview[prizeId(SLICES[1])]).toMatchObject({ u: "/checkout/proprio-30", o: "proprio-30", t: "30% OFF" });
    expect(preview[prizeId(SLICES[3])]).toMatchObject({ u: "/checkout/proprio-50", o: "proprio-50", c: "ROLETA50" });
    const zip = wheelPrizeMap([wheelHtml()], ZIP);
    expect(Object.keys(zip)).toEqual([prizeId(SLICES[0])]);
    // Sem o endereço da página: os prêmios do checkout do Offer Studio não são "sem link".
    expect(prizesWithoutLink(wheelHtml(), ZIP)).toEqual([]);
    expect(ownCheckoutPrizes(wheelHtml(), ZIP)).toEqual(["30% OFF", "50% OFF"]);
    expect(ownCheckoutPrizes(wheelHtml(), PREVIEW)).toEqual([]);
    // Um link de endereço com um produto de checkout guardado (OfferLinkView) não é checkout do Offer Studio.
    const view = [{ key: "proprio-30", url: "/checkout/proprio-30", checkout: { id: "c30" } }];
    expect(prizeGaps(wheelHtml([SLICES[1], SLICES[2]]), view)).toEqual([{ text: "30% OFF", linked: true, own: false }]);
  });

  it("endereço de fora do site nunca entra como página de checkout", () => {
    for (const url of ["//evil.com/x", "https://evil.com/x", "javascript:alert(1)", "/\\evil.com"]) {
      const map = wheelPrizeMap([wheelHtml([SLICES[1], SLICES[2]])], [{ key: "proprio-30", url, checkout: true }]);
      expect(map).toEqual({});
    }
  });

  it("cupom num prêmio do checkout do Offer Studio: a página de checkout não tem onde digitar", () => {
    expect(ownCheckoutCoupons(wheelHtml(), ["proprio-30", "proprio-50"])).toEqual(["50% OFF"]);
    expect(ownCheckoutCoupons(wheelHtml(), ["hotmart-10"])).toEqual([]);
  });

  it("editor: avisos da fatia (checkout ainda não salvo, cupom); checkout salvo sem cupom não avisa", () => {
    const links = [
      { key: "proprio-30", url: "", checkout: "Curso · R$ 97,00" },
      { key: "proprio-50", url: "", checkout: "" },
      { key: "hotmart-10", url: "" },
    ];
    expect(sliceWarn(SLICES[1], links)).toBe("");
    expect(sliceWarn({ ...SLICES[1], coupon: "X" }, links)).toBe("coupon");
    expect(sliceWarn(SLICES[3], links)).toBe("checkout");
    // Link comum sem endereço continua pedindo o endereço.
    expect(sliceWarn(SLICES[0], links)).toBe("url");
    expect(WARN_TEXT.coupon).toContain("não tem campo de cupom");
  });

  const base: Omit<ReadinessInput, "htmls" | "links"> = {
    clonedCheckoutUrls: [],
    pixelCount: 1,
    company: { name: "", document: "", email: "", phone: "", address: "" },
    liveUrl: null,
    lastZipAt: null,
  };
  const LINKS: ReadinessInput["links"] = [
    { key: "checkout", url: "https://pay.hotmart.com/CHEIO", kind: "CHECKOUT" },
    { key: "hotmart-10", url: "https://pay.hotmart.com/DEZ", kind: "CHECKOUT" },
    { key: "proprio-30", url: "https://antigo.exemplo.com", kind: "CHECKOUT", target: "CHECKOUT", checkout: {} },
    { key: "proprio-50", url: "", kind: "UPSELL", target: "CHECKOUT", checkout: {} },
  ];
  const sales = '<a class="os-btn" href="#" data-os-link="checkout">COMPRAR</a>';
  const roleta = (htmls: string[], links = LINKS) =>
    computeReadiness({ ...base, htmls, links }, () => "").items.find((i) => i.id === "roleta");

  it("Próximos passos: prêmio no checkout do Offer Studio (salvo) leva à página de checkout, na prévia e no ZIP", () => {
    expect(roleta([wheelHtml(), sales])).toMatchObject({ title: "Prêmios da roleta ligados", done: true });
    // Prêmio sem link nenhum continua com o aviso de sempre.
    const gap = roleta([wheelHtml([...SLICES, { ...SLICES[0], text: "Brinde", link: "" }]), sales]);
    expect(gap?.title).toBe("Roleta com prêmio sem link de checkout");
    expect(gap?.detail).toMatch(/^O prêmio “Brinde” ainda não leva/);
  });

  it("Próximos passos: cupom num prêmio do checkout do Offer Studio é um passo opcional próprio", () => {
    const step = (htmls: string[]) =>
      computeReadiness({ ...base, htmls, links: LINKS }, () => "").items.find((i) => i.id === "roleta-cupom");
    expect(step([wheelHtml(), sales])).toMatchObject({
      title: "Cupom em prêmio do checkout do Offer Studio",
      optional: true,
      done: false,
      cta: "Abrir links",
    });
    expect(step([wheelHtml(), sales])?.detail).toMatch(
      /^O prêmio “50% OFF” tem cupom e leva a um link “Checkout do Offer Studio”, que não tem campo de cupom/,
    );
    expect(step([wheelHtml(SLICES.map((s) => ({ ...s, coupon: "" }))), sales])).toBeUndefined();
    // Cupom num prêmio de checkout de fora (Hotmart): o cupom vale lá, nada a dizer.
    expect(
      step([wheelHtml(SLICES.map((s) => ({ ...s, coupon: s.link === "hotmart-10" ? "X" : "" }))), sales]),
    ).toBeUndefined();
  });

  it("Próximos passos: botão ligado ao checkout do Offer Studio também recebe o prêmio da roleta", () => {
    const html = wheelHtml(SLICES.filter((s) => s.link !== "proprio-30" && s.link !== "proprio-50"));
    const ownButton = '<a class="os-btn" href="#" data-os-link="proprio-30">COMPRAR</a>';
    expect(roleta([html, ownButton])).toMatchObject({ title: "Prêmios da roleta ligados", done: true });
    // Sem nenhum botão ligado a um link do tipo checkout, continua pedindo.
    const upsellButton = '<a class="os-btn" href="#" data-os-link="proprio-50">COMPRAR</a>';
    expect(roleta([html, upsellButton])?.title).toBe("Levar o prêmio da roleta aos botões de compra");
  });
});

describe("ZIP: cupom num prêmio do checkout do Offer Studio", () => {
  it("aviso próprio, com conserto no editor (a roleta)", () => {
    const one = ownCheckoutCouponWarning([{ name: "Roleta", prizes: ["50% OFF"] }]);
    expect(one).toBe(
      "O prêmio “50% OFF” da roleta na página “Roleta” tem cupom e leva a um link “Checkout do Offer Studio”, que não tem campo de cupom: quem ganhar paga o valor do checkout, sem o desconto do cupom. Para resolver, ponha o valor já com o desconto no checkout do prêmio (em “Links e checkouts”) e apague o cupom na roleta (Configurações → Fatias), e gere o ZIP de novo.",
    );
    const many = ownCheckoutCouponWarning([
      { name: "Roleta", prizes: ["50% OFF"] },
      { name: "Roleta B", prizes: ["30% OFF", "50% OFF"] },
    ]);
    expect(many).toMatch(/^Os prêmios “50% OFF” e “30% OFF” da roleta nas páginas “Roleta” e “Roleta B” têm cupom/);
    expect(ownCheckoutCouponWarning([{ name: "Roleta", prizes: [] }])).toBeNull();
    expect(exportWarningFix(one ?? "")).toEqual({ kind: "deadButtons", wheel: true });
  });
});

describe("Próximos passos: botão no checkout do Offer Studio ainda não salvo", () => {
  const base: Omit<ReadinessInput, "htmls" | "links"> = {
    clonedCheckoutUrls: [],
    pixelCount: 1,
    company: { name: "", document: "", email: "", phone: "", address: "" },
    liveUrl: null,
    lastZipAt: null,
  };
  const step = (links: ReadinessInput["links"]) =>
    computeReadiness(
      { ...base, htmls: ['<a class="os-btn" href="#" data-os-link="proprio">COMPRAR</a>'], links },
      () => "",
    ).items.find((i) => i.id === "checkout");

  it("diz para montar o checkout (e leva ao link); salvo, o botão leva à página de checkout", () => {
    const unsaved = step([
      {
        id: "l1",
        key: "proprio",
        label: "Checkout principal",
        url: "",
        kind: "CHECKOUT",
        target: "CHECKOUT",
        checkout: null,
      },
    ]);
    expect(unsaved).toMatchObject({ title: "Ligar os botões de compra", cta: "Abrir o link", target: { link: "l1" } });
    expect(unsaved?.detail).toContain("O checkout do Offer Studio de “Checkout principal” ainda não foi salvo");
    expect(unsaved?.detail).not.toContain("já levam à página de checkout na prévia");
    const saved = step([
      {
        id: "l1",
        key: "proprio",
        label: "Checkout principal",
        url: "",
        kind: "CHECKOUT",
        target: "CHECKOUT",
        checkout: {},
      },
    ]);
    expect(saved).toMatchObject({ title: "Checkout ligado", done: true });
  });
});
