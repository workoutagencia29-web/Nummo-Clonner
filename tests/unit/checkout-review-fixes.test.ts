/**
 * Correções da revisão do checkout do Offer Studio (fase 2) — regras puras,
 * sem navegador nem banco:
 * - o `pedido` público é uma credencial: número sequencial do gateway nunca vale;
 * - botão clonado (data-os-checkout, href do checkout da página original)
 *   ligado a um "Checkout do Offer Studio": o render tira o endereço antigo
 *   quando a página de checkout não está ali (ZIP) ou o produto não foi
 *   salvo, e tira a marca do clonador sempre;
 * - página de checkout sem as regras "ao enviar um formulário" (Lead a cada
 *   "Pagar") e "ao clicar no checkout";
 * - "Próximos passos": prêmio da roleta num checkout do Offer Studio sem o
 *   produto salvo é falta (não "já funciona na prévia");
 * - bloco "Acesso ao produto" em outro idioma que o checkout: aviso;
 * - validade da cobrança guardada pelo relógio do servidor.
 */
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { defToHtml } from "@/editor/widgets/quiz-content";
import { DEFAULT_WHEEL, wheelDef } from "@/editor/widgets/wheel-content";
import { type CheckoutCheck, checkoutIssues } from "@/lib/checkout/checks";
import { CHECKOUT_ORDER_RE, isCheckoutOrderId, parseCheckoutRequest } from "@/lib/checkout/contract";
import { checkoutPageTracking } from "@/lib/checkout/page";
import { checkoutIssueWarning, exportWarningFix } from "@/lib/export/warnings";
import { applyOfferLinks } from "@/lib/offer-links";
import { renderLinks } from "@/lib/payments/links";
import { computeReadiness, type ReadinessInput } from "@/lib/readiness";
import type { TrackingRuntimeConfig } from "@/lib/tracking/runtime-config";
import { RECOMMENDED_RULES } from "@/lib/tracking/schema";
import type { WheelSlice } from "@/lib/wheel";
import { type OpenCheckout, openValid } from "@/runtime/checkout/store";
import { handleSimulatedPayment, resetSimulation } from "@/server/services/payments/simulation";

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
  // Checkout do Offer Studio com o produto salvo.
  {
    key: "proprio",
    url: "https://antigo.exemplo.com",
    kind: "CHECKOUT",
    target: "CHECKOUT",
    payment: null,
    checkout: { id: "c1" },
  },
  // Ainda sem o produto salvo.
  { key: "proprio-vazio", url: "", kind: "CHECKOUT", target: "CHECKOUT", payment: null, checkout: null },
] as Parameters<typeof renderLinks>[0];

const PREVIEW = renderLinks(ROWS, { checkoutHref: (key) => `/checkout/${key}` });
const ZIP = renderLinks(ROWS);

/** Página clonada: o botão guarda o checkout do dono da página original. */
const CLONED = `<!DOCTYPE html><html><head><title>V</title></head><body>
<a id="a" href="https://pay.hotmart.com/ORIGINAL" data-os-checkout="1" data-os-link="proprio">Comprar</a>
<button id="b" data-os-href="https://pay.hotmart.com/ORIGINAL" data-os-checkout="1" data-os-link="proprio">Comprar</button>
<form id="f" action="https://pay.hotmart.com/ORIGINAL" data-os-link="proprio"><button>Ir</button></form>
<a id="v" href="https://pay.hotmart.com/ORIGINAL" data-os-checkout="1" data-os-link="proprio-vazio">Comprar</a>
<a id="h" href="https://pay.hotmart.com/X" data-os-checkout="1" data-os-link="checkout">Comprar</a>
</body></html>`;

describe("o pedido público é uma credencial", () => {
  it("número sequencial do gateway (FlevoPay: 238, 239…) nunca vale; o id aleatório da prévia vale", () => {
    for (const bad of ["238", "5120", "12345678901234567890", "tx_1", "abc"])
      expect(isCheckoutOrderId(bad), bad).toBe(false);
    for (const good of ["sim_0123456789abcdef01", "ck_Q1w2E3r4T5y6U7i8O9p0"])
      expect(isCheckoutOrderId(good), good).toBe(true);
    expect(CHECKOUT_ORDER_RE.test("a".repeat(101))).toBe(false);
    expect(parseCheckoutRequest({ acao: "checkout_status", checkout: "checkout", pedido: "239" })).toBeNull();
  });

  it("prévia: o acesso de um pedido do checkout só com a credencial aleatória", async () => {
    resetSimulation();
    // Pedido inexistente com número: nada.
    const r = await handleSimulatedPayment("oferta", { acao: "acesso", pedido: "5119" });
    expect(r.body).toMatchObject({ ok: false, erro: "nao_encontrado" });
  });
});

describe("botão clonado ligado ao checkout do Offer Studio", () => {
  const attrs = (html: string, id: string) => cheerio.load(html)(`#${id}`).attr() ?? {};

  it("ZIP (sem a página de checkout): nada leva ao checkout da página original e a marca do clonador sai", () => {
    const html = applyOfferLinks(CLONED, ZIP);
    expect(attrs(html, "a").href).toBe("#");
    expect(attrs(html, "a")["data-os-checkout"]).toBeUndefined();
    expect(attrs(html, "b")["data-os-href"]).toBeUndefined();
    expect(attrs(html, "b")["data-os-checkout"]).toBeUndefined();
    expect(attrs(html, "f").action).toBeUndefined();
    expect(html).not.toContain("ORIGINAL");
    // Link comum (Hotmart) continua igual, com a marca do clonador.
    expect(attrs(html, "h")).toMatchObject({ href: "https://pay.hotmart.com/CHEIO", "data-os-checkout": "1" });
  });

  it("prévia: leva à página de checkout, sem a marca (o rastreamento não conta InitiateCheckout no clique)", () => {
    const html = applyOfferLinks(CLONED, PREVIEW);
    expect(attrs(html, "a")).toMatchObject({ href: "/checkout/proprio" });
    expect(attrs(html, "a")["data-os-checkout"]).toBeUndefined();
    expect(attrs(html, "b")["data-os-href"]).toBe("/checkout/proprio");
    expect(attrs(html, "f").action).toBe("/checkout/proprio");
  });

  it("checkout ainda sem o produto salvo: não leva a lugar nenhum nem na prévia (nunca ao endereço antigo)", () => {
    expect(PREVIEW.find((l) => l.key === "proprio-vazio")).toMatchObject({ url: "", checkout: false });
    for (const links of [PREVIEW, ZIP]) {
      const html = applyOfferLinks(CLONED, links);
      expect(attrs(html, "v").href).toBe("#");
      expect(attrs(html, "v")["data-os-checkout"]).toBeUndefined();
    }
  });
});

describe("rastreamento da página de checkout", () => {
  it("sem as regras “ao enviar um formulário” e “ao clicar em um botão de checkout”; o resto fica", () => {
    const rules: TrackingRuntimeConfig["rules"] = [
      ...RECOMMENDED_RULES.map((r) => ({ ...r })),
      { event: "VIEW_CONTENT", trigger: "PAGE_LOAD", value: null, selector: null },
      { event: "LEAD", trigger: "ELEMENT_CLICK", value: null, selector: "#x" },
    ] as TrackingRuntimeConfig["rules"];
    const config = { rules } as TrackingRuntimeConfig;
    const out = checkoutPageTracking(config).rules;
    expect(out.map((r) => r.trigger)).not.toContain("FORM_SUBMIT");
    expect(out.map((r) => r.trigger)).not.toContain("CHECKOUT_CLICK");
    expect(out).toContainEqual({ event: "VIEW_CONTENT", trigger: "PAGE_LOAD", value: null, selector: null });
    expect(out).toContainEqual({ event: "LEAD", trigger: "ELEMENT_CLICK", value: null, selector: "#x" });
    // A configuração das outras páginas não muda.
    expect(config.rules).toBe(rules);
  });
});

describe("Próximos passos: prêmio num checkout do Offer Studio sem o produto salvo", () => {
  const SLICES: WheelSlice[] = [
    { text: "30% OFF", color: "#ec4899", chance: 50, link: "proprio-30", coupon: "" },
    { text: "Não foi dessa vez", color: "#64748b", chance: 50, link: "", coupon: "", lose: true },
  ];
  const wheel = `<!doctype html><html><head><title>R</title></head><body>${defToHtml(
    wheelDef({ ...DEFAULT_WHEEL, slices: SLICES }, { html: true }),
  )}</body></html>`;
  const base: Omit<ReadinessInput, "htmls" | "links"> = {
    clonedCheckoutUrls: [],
    pixelCount: 1,
    company: { name: "", document: "", email: "", phone: "", address: "" },
    liveUrl: null,
    lastZipAt: null,
  };
  const roleta = (checkout: unknown) =>
    computeReadiness(
      {
        ...base,
        htmls: [wheel, '<a class="os-btn" href="#" data-os-link="proprio-30">COMPRAR</a>'],
        links: [
          {
            id: "l30",
            key: "proprio-30",
            label: "Checkout 30% OFF",
            url: "",
            kind: "CHECKOUT",
            target: "CHECKOUT",
            checkout,
          },
        ],
      },
      () => "",
    ).items.find((i) => i.id === "roleta");

  it("sem o produto: é falta, com “monte o checkout” e o link; salvo: o passo de sempre", () => {
    const unsaved = roleta(null);
    expect(unsaved).toMatchObject({
      title: "Roleta com prêmio sem link de checkout",
      done: false,
      cta: "Abrir o link",
      target: { link: "l30" },
    });
    expect(unsaved?.detail).toContain("O checkout do Offer Studio de “Checkout 30% OFF” ainda não foi salvo");
    expect(unsaved?.detail).not.toContain("na prévia, quem ganhar já vai");
    expect(unsaved?.detail).not.toContain("Cole o endereço");
    // Salvo: leva à página de checkout (prévia e ZIP) e o botão ligado a ele recebe o prêmio.
    const saved = roleta({});
    expect(saved).toMatchObject({ title: "Prêmios da roleta ligados", done: true });
  });
});

describe("bloco “Acesso ao produto” em outro idioma que o checkout", () => {
  const check = (blockLang: "es" | "pt"): CheckoutCheck => ({
    offerCurrency: "BRL",
    keys: { FLEVOPAY: "ok" },
    products: [
      {
        linkId: "l1",
        label: "Checkout principal",
        provider: "FLEVOPAY",
        currency: "BRL",
        methods: ["PIX"],
        amountCents: 9_700,
        maxTotalCents: 9_700,
        thankYou: {
          pageId: "p1",
          name: "Obrigado",
          missingAccessDocumentId: null,
          accessLangs: [{ documentId: "d1", lang: blockLang }],
        },
        locale: "PT",
        hasAccessUrl: true,
        bumpsWithoutAccess: [],
        address: false,
        paidShippingCents: 0,
      },
    ],
  });

  it("aviso no checkoutIssues, no ZIP (com o conserto que abre a página) e no Próximos passos", () => {
    expect(checkoutIssues(check("pt"))).toEqual([]);
    const issues = checkoutIssues(check("es"));
    expect(issues).toEqual([
      {
        kind: "accessLang",
        pageName: "Obrigado",
        documentId: "d1",
        blockLang: "es",
        products: [{ label: "Checkout principal", locale: "PT" }],
      },
    ]);
    const warning = checkoutIssueWarning(issues[0]);
    expect(warning).toContain("O bloco “Acesso ao produto” da página “Obrigado” está em Español");
    expect(warning).toContain("o comprador vê o checkout num idioma e a página de obrigado em outro");
    expect(exportWarningFix(warning)).toEqual({ kind: "accessBlock" });
    const item = computeReadiness(
      {
        htmls: [],
        links: [],
        clonedCheckoutUrls: [],
        pixelCount: 1,
        company: { name: "", document: "", email: "", phone: "", address: "" },
        liveUrl: null,
        lastZipAt: null,
        checkouts: check("es"),
      },
      () => "",
    ).items.find((i) => i.id === "checkout-proprio");
    expect(item).toMatchObject({ title: "Ajustar o idioma do acesso", target: { editor: "d1" } });
  });
});

describe("cobrança guardada: validade pelo relógio do servidor", () => {
  const NOW = Date.parse("2026-10-11T12:00:00Z");
  const pix = (expiresInMin: number, skew?: number): OpenCheckout => ({
    v: 1,
    pedido: "sim_0123456789abcdef01",
    ext: "os_x_1",
    metodo: "pix",
    valor: 9_700,
    moeda: "BRL",
    at: NOW,
    itens: [],
    pix: { codigo: "000201", expiraEm: new Date(NOW + expiresInMin * 60_000).toISOString() },
    ...(skew === undefined ? {} : { skew }),
  });

  it("aparelho 2 horas adiantado: o PIX de 30 min continua valendo (a conta usa a diferença guardada)", () => {
    const ahead = NOW + 2 * 3_600_000;
    expect(openValid(pix(30), ahead)).toBe(false);
    expect(openValid(pix(30, -2 * 3_600_000), ahead)).toBe(true);
    // Venceu de verdade (no relógio do servidor) há mais de 1 hora: sai da memória.
    expect(openValid(pix(30, 0), NOW + 91 * 60_000)).toBe(false);
    expect(openValid(pix(30, 0), NOW + 89 * 60_000)).toBe(true);
  });
});
