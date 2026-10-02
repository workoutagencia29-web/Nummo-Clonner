/**
 * Fase 4 — regras puras das telas "Pixels e rastreamento" e "Empresa e SEO":
 * textos das regras, seletor dos links da oferta, valor em reais, parâmetros
 * de UTM, nomes de evento, partes da tela e selos dos pixels.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/actions/tracking", () => ({}));

import { assetSrcFromKey, COMPANY_FIELDS, companyEmailProblem, SEO_LIMITS } from "@/components/offers/settings/helpers";
import {
  CATEGORY_HELP,
  eventNameProblem,
  eventParts,
  fieldErrors,
  formatAmount,
  forwardParamProblem,
  isDefaultParams,
  linkKeyFromSelector,
  paramGroup,
  parseAmount,
  policyPageOptions,
  ruleHasMissingLink,
  ruleScopeText,
  ruleTriggerText,
  selectorForLink,
  selectorProblem,
  suggestedTrigger,
  testPixelsHref,
  trackingSectionOf,
  triggerValueKind,
} from "@/components/offers/tracking/helpers";
import { pixelBadges, pixelName } from "@/components/offers/tracking/pixels-section";
import { COMPANY_PLACEHOLDERS } from "@/lib/offer-settings";
import { CODE_CATEGORIES, DEFAULT_FORWARD_PARAMS, RULE_EVENTS, TRACKING_EVENTS } from "@/lib/tracking/schema";
import type { PixelView } from "@/server/services/tracking";

const LINKS = [
  { id: "l1", key: "checkout", label: "Checkout principal", kind: "CHECKOUT", url: "https://pay.hotmart.com/X" },
  { id: "l2", key: "whatsapp", label: "WhatsApp", kind: "WHATSAPP", url: "https://wa.me/5511999999999" },
];

describe("eventos", () => {
  it("separa o nome em português e o código de cada evento", () => {
    expect(eventParts("INITIATE_CHECKOUT")).toEqual({ title: "Iniciou checkout", code: "InitiateCheckout" });
    expect(eventParts("LEAD")).toEqual({ title: "Cadastro / lead", code: "Lead" });
    for (const e of TRACKING_EVENTS) {
      const parts = eventParts(e);
      expect(parts.title.length).toBeGreaterThan(3);
      expect(parts.code).toMatch(/^[A-Za-z]+$/);
    }
  });

  it("gatilhos com número: segundos e porcentagem", () => {
    expect(triggerValueKind("TIME_ON_PAGE")).toBe("seconds");
    expect(triggerValueKind("SCROLL_DEPTH")).toBe("percent");
    expect(triggerValueKind("ELEMENT_CLICK")).toBeNull();
  });
});

describe("links da oferta como alvo de clique", () => {
  it("gera o seletor [data-os-link] e lê a chave de volta (com aspas escapadas)", () => {
    expect(selectorForLink("checkout")).toBe('[data-os-link="checkout"]');
    for (const key of ["checkout", "upsell-2", 'com"aspas', "barra\\"]) {
      expect(linkKeyFromSelector(selectorForLink(key))).toBe(key);
    }
    expect(linkKeyFromSelector("[data-os-link='whatsapp']")).toBe("whatsapp");
    expect(linkKeyFromSelector("[data-os-link=checkout]")).toBe("checkout");
    expect(linkKeyFromSelector("#comprar")).toBeNull();
    expect(linkKeyFromSelector('a[data-os-link="checkout"]')).toBeNull();
    expect(linkKeyFromSelector(null)).toBeNull();
  });

  it("descreve quando a regra dispara, com o nome do link", () => {
    expect(ruleTriggerText({ trigger: "TIME_ON_PAGE", value: 15, selector: null }, LINKS)).toBe(
      "Depois de 15 segundos na página",
    );
    expect(ruleTriggerText({ trigger: "TIME_ON_PAGE", value: 1, selector: null }, LINKS)).toBe(
      "Depois de 1 segundo na página",
    );
    expect(ruleTriggerText({ trigger: "SCROLL_DEPTH", value: 75, selector: null }, LINKS)).toBe(
      "Ao rolar 75% da página",
    );
    expect(ruleTriggerText({ trigger: "CHECKOUT_CLICK", value: null, selector: null }, LINKS)).toBe(
      "Ao clicar em um botão de checkout",
    );
    expect(ruleTriggerText({ trigger: "FORM_SUBMIT", value: null, selector: null }, LINKS)).toBe(
      "Ao enviar um formulário",
    );
    expect(ruleTriggerText({ trigger: "PAGE_LOAD", value: null, selector: null }, LINKS)).toBe("Ao abrir a página");
    expect(
      ruleTriggerText({ trigger: "ELEMENT_CLICK", value: null, selector: '[data-os-link="whatsapp"]' }, LINKS),
    ).toBe("Ao clicar no link “WhatsApp”");
    expect(ruleTriggerText({ trigger: "ELEMENT_CLICK", value: null, selector: "#comprar" }, LINKS)).toBe(
      "Ao clicar em #comprar",
    );
    const gone = { trigger: "ELEMENT_CLICK" as const, value: null, selector: '[data-os-link="antigo"]' };
    expect(ruleTriggerText(gone, LINKS)).toBe("Ao clicar em um link da oferta que foi excluído");
    expect(ruleHasMissingLink(gone, LINKS)).toBe(true);
    expect(ruleHasMissingLink({ trigger: "ELEMENT_CLICK", selector: "#x" }, LINKS)).toBe(false);
  });

  it("escopo: todas as páginas, o nome da página ou “Página excluída”", () => {
    const pages = [{ id: "p1", name: "Vendas", type: "SALES" }];
    expect(ruleScopeText({ pageId: null }, pages)).toBe("Todas as páginas");
    expect(ruleScopeText({ pageId: "p1", pageName: null }, pages)).toBe("Vendas");
    expect(ruleScopeText({ pageId: "p1", pageName: "Nome do servidor" }, pages)).toBe("Nome do servidor");
    expect(ruleScopeText({ pageId: "zz" }, pages)).toBe("Página excluída");
  });

  it("sugere o gatilho de cada evento (contato → link do WhatsApp)", () => {
    expect(suggestedTrigger("VIEW_CONTENT", LINKS)).toEqual({ trigger: "TIME_ON_PAGE", value: 15, selector: null });
    expect(suggestedTrigger("INITIATE_CHECKOUT", LINKS).trigger).toBe("CHECKOUT_CLICK");
    expect(suggestedTrigger("LEAD", LINKS).trigger).toBe("FORM_SUBMIT");
    expect(suggestedTrigger("CONTACT", LINKS)).toEqual({
      trigger: "ELEMENT_CLICK",
      value: null,
      selector: '[data-os-link="whatsapp"]',
    });
    expect(suggestedTrigger("CONTACT", []).selector).toBeNull();
    expect(suggestedTrigger("PURCHASE", LINKS).trigger).toBe("PAGE_LOAD");
    for (const e of RULE_EVENTS) expect(suggestedTrigger(e, LINKS).trigger).toBeTruthy();
  });

  it("problemas óbvios do seletor CSS (o servidor confere de novo)", () => {
    expect(selectorProblem("")).toBe("Escolha o elemento ou link.");
    expect(selectorProblem("<button>")).toMatch(/trecho de HTML/);
    expect(selectorProblem("> a")).toMatch(/incompleto/);
    expect(selectorProblem("a,")).toMatch(/incompleto/);
    expect(selectorProblem("x".repeat(301))).toMatch(/300 caracteres/);
    expect(selectorProblem("#comprar .cta")).toBeNull();
  });

  it("política de privacidade: páginas LEGAL primeiro", () => {
    const pages = [
      { id: "a", name: "Vendas", type: "SALES" },
      { id: "b", name: "Termos", type: "LEGAL" },
      { id: "c", name: "Obrigado", type: "THANK_YOU" },
      { id: "d", name: "Política", type: "LEGAL" },
    ];
    expect(policyPageOptions(pages).map((p) => p.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("valor da oferta", () => {
  it("lê valores do jeito brasileiro e americano", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("  ")).toBeNull();
    expect(parseAmount("97")).toBe(97);
    expect(parseAmount("97,9")).toBe(97.9);
    expect(parseAmount("97,90")).toBe(97.9);
    expect(parseAmount("R$ 1.997,00")).toBe(1997);
    expect(parseAmount("1.997")).toBe(1997);
    expect(parseAmount("97.90")).toBe(97.9);
    expect(parseAmount("1,997.50")).toBe(1997.5);
    expect(parseAmount("1.000.000")).toBe(1_000_000);
    expect(parseAmount("US$ 47")).toBe(47);
    expect(parseAmount("abc")).toBeNaN();
    expect(parseAmount("-5")).toBeNaN();
    expect(parseAmount("9,999")).toBe(10);
  });

  it("mostra no formato brasileiro", () => {
    expect(formatAmount(null)).toBe("");
    expect(formatAmount(1997)).toBe("1.997,00");
    expect(formatAmount(97.9)).toBe("97,90");
    expect(formatAmount(Number.NaN)).toBe("");
  });
});

describe("parâmetros repassados", () => {
  it("recusa vazio, espaço, acento, repetido e acima do limite", () => {
    const list = ["utm_source"];
    expect(forwardParamProblem("", list)).toMatch(/Digite o nome/);
    expect(forwardParamProblem("utm source", list)).toMatch(/sem espaços/);
    expect(forwardParamProblem("código", list)).toMatch(/sem acento/);
    expect(forwardParamProblem("utm_source", list)).toBe("“utm_source” já está na lista.");
    expect(forwardParamProblem("x".repeat(41), list)).toMatch(/40 caracteres/);
    const full = Array.from({ length: 40 }, (_, i) => `p${i}`);
    expect(forwardParamProblem("mais", full)).toMatch(/no máximo 40/);
    expect(forwardParamProblem(" afiliado ", list)).toBeNull();
  });

  it("reconhece a lista padrão e agrupa os chips", () => {
    expect(isDefaultParams([...DEFAULT_FORWARD_PARAMS])).toBe(true);
    expect(isDefaultParams(DEFAULT_FORWARD_PARAMS.slice(1))).toBe(false);
    expect(paramGroup("utm_campaign")).toBe("utm");
    expect(paramGroup("fbclid")).toBe("click");
    expect(paramGroup("sck")).toBe("platform");
    expect(paramGroup("afiliado")).toBe("other");
  });
});

describe("nomes de evento e erros por campo", () => {
  it("nomes personalizados: vazio é o padrão; acento e símbolos não", () => {
    expect(eventNameProblem("")).toBeNull();
    expect(eventNameProblem("Lead_Custom 2")).toBeNull();
    expect(eventNameProblem("Lead ç")).toMatch(/sem acento/);
    expect(eventNameProblem("a".repeat(61))).toMatch(/60 caracteres/);
  });

  it("erro do servidor vai para o campo certo (ou para o geral)", () => {
    expect(fieldErrors(["a", "b", "form"] as const, "b", "msg", "form")).toEqual({ b: "msg" });
    expect(fieldErrors(["a", "b", "form"] as const, "zzz", "msg", "form")).toEqual({ form: "msg" });
    expect(fieldErrors(["a", "form"] as const, undefined, "msg", "form")).toEqual({ form: "msg" });
  });

  it("endereço do “Testar pixels” e explicação de cada categoria de código", () => {
    expect(testPixelsHref("abc")).toBe("/ofertas/abc/testar-pixels");
    for (const c of CODE_CATEGORIES) expect(CATEGORY_HELP[c].length).toBeGreaterThan(20);
  });

  it("parte da tela pedida no endereço", () => {
    expect(trackingSectionOf("eventos")).toBe("eventos");
    expect(trackingSectionOf(["utms", "x"])).toBe("utms");
    expect(trackingSectionOf("outra")).toBe("pixels");
    expect(trackingSectionOf(undefined)).toBe("pixels");
  });
});

describe("empresa e SEO", () => {
  it("endereço da imagem a partir da chave do storage", () => {
    const sha = "a".repeat(64);
    expect(assetSrcFromKey(`a/aa/${sha}.webp`)).toBe(`/os-assets/${sha}.webp`);
    expect(assetSrcFromKey("../../etc/passwd")).toBeNull();
    expect(assetSrcFromKey(null)).toBeNull();
  });

  it("os campos da empresa cobrem todos os marcadores dos modelos legais", () => {
    expect(COMPANY_FIELDS.map((f) => f.marker).sort()).toEqual(Object.keys(COMPANY_PLACEHOLDERS).sort());
    expect(companyEmailProblem("")).toBeNull();
    expect(companyEmailProblem("contato@empresa.com.br")).toBeNull();
    expect(companyEmailProblem("contato@empresa")).toMatch(/e-mail válido/);
    expect(SEO_LIMITS.title.recommended).toBeLessThan(SEO_LIMITS.title.max);
  });
});

describe("selos dos pixels", () => {
  const base = {
    id: "p",
    pixelId: "123456789012345",
    label: null,
    enabled: true,
    hasToken: false,
    tokenHint: null,
    tokenUnreadable: false,
    testEventCode: null,
    needsToken: false,
    createdAt: new Date(),
  };

  it("Meta: API de Conversões ligada, sem token ou com token ilegível; código de teste", () => {
    const on = { ...base, vendor: "META", options: { capi: true }, hasToken: true } as PixelView;
    expect(pixelBadges(on).map((b) => b.text)).toEqual(["API de Conversões ligada"]);
    const missing = { ...on, hasToken: false, needsToken: true } as PixelView;
    expect(pixelBadges(missing)).toEqual([{ text: "API de Conversões sem token", variant: "warning" }]);
    const unreadable = { ...on, tokenUnreadable: true, needsToken: true } as PixelView;
    expect(pixelBadges(unreadable)[0]).toEqual({ text: "API de Conversões: cole o token de novo", variant: "warning" });
    const test = { ...on, testEventCode: "TEST123" } as PixelView;
    expect(pixelBadges(test).map((b) => b.text)).toContain("Código de teste: TEST123");
    const off = { ...base, vendor: "META", options: { capi: false }, enabled: false } as PixelView;
    expect(pixelBadges(off)).toEqual([{ text: "Desativado", variant: "outline" }]);
  });

  it("TikTok, Google Ads e UTMify", () => {
    const tiktok = { ...base, vendor: "TIKTOK", options: { eventsApi: true }, needsToken: true } as PixelView;
    expect(pixelBadges(tiktok)[0].text).toBe("Events API sem token");
    const ads = { ...base, vendor: "GOOGLE_ADS", options: { conversionLabels: {} } } as PixelView;
    expect(pixelBadges(ads)).toEqual([{ text: "Sem rótulos de conversão", variant: "warning" }]);
    const ads2 = { ...ads, options: { conversionLabels: { LEAD: "abcd", PURCHASE: "efgh" } } } as PixelView;
    expect(pixelBadges(ads2)).toEqual([{ text: "2 conversões", variant: "success" }]);
    const utmify = {
      ...base,
      vendor: "UTMIFY",
      options: { utmsScript: true, preventSubids: false, preventXcodSck: false },
    } as PixelView;
    expect(pixelBadges(utmify).map((b) => b.text)).toEqual(["Script de UTMs"]);
    expect(pixelName({ vendor: "GA4", label: null })).toBe("Pixel GA4");
    expect(pixelName({ vendor: "GA4", label: "Site" })).toBe("Site");
  });
});
