/**
 * Fase 4 — partes puras do rastreamento: IDs de pixel, contrato (schema),
 * configuração pública da página (compose) e relatórios da tela de teste.
 */
import { describe, expect, it } from "vitest";
import {
  composeTrackingConfig,
  knownCheckoutHosts,
  literalPathPrefixes,
  publicPixelOptions,
  type TrackingSource,
} from "@/lib/tracking/compose";
import { checkConversionLabel, checkPixelId, normalizePixelId } from "@/lib/tracking/ids";
import {
  consentTextFor,
  DEFAULT_CONSENT_TEXT,
  DEFAULT_NOTICE_TEXT,
  EventRuleInputSchema,
  LEGACY_NOTICE_TEXT,
  PAGE_CODE_DEFAULT_CATEGORY,
  parsePageCodeCategory,
  parseTrackingSettings,
  parseVendorOptions,
  RULE_EVENTS,
  serverApiEnabled,
  TRACKING_EVENTS,
  TrackingSettingsSchema,
} from "@/lib/tracking/schema";
import { parsePixelTestReport, summarizePixelTest } from "@/lib/tracking/test-report";

describe("IDs de pixel (colados pelo usuário)", () => {
  it("aceita o ID puro de cada plataforma, com espaços e caixa corrigidos", () => {
    expect(checkPixelId("META", " 123456789012345 ")).toEqual({ ok: true, id: "123456789012345" });
    expect(checkPixelId("TIKTOK", "c1abcdefghij2klmnopq")).toEqual({ ok: true, id: "C1ABCDEFGHIJ2KLMNOPQ" });
    expect(checkPixelId("KWAI", "283746592837465")).toEqual({ ok: true, id: "283746592837465" });
    expect(checkPixelId("GA4", "g-abc123def4")).toEqual({ ok: true, id: "G-ABC123DEF4" });
    expect(checkPixelId("GOOGLE_ADS", "aw-123456789")).toEqual({ ok: true, id: "AW-123456789" });
    expect(checkPixelId("UTMIFY", "66f1a2b3c4d5e6f7a8b9c0d1")).toEqual({ ok: true, id: "66f1a2b3c4d5e6f7a8b9c0d1" });
  });

  it("acha o ID dentro do código de instalação colado inteiro", () => {
    const meta = `<!-- Meta Pixel Code --><script>!function(f,b,e,v,n,t,s){...}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '987654321098765');
fbq('track', 'PageView');</script><noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=987654321098765&ev=PageView&noscript=1"/></noscript>`;
    expect(normalizePixelId("META", meta)).toBe("987654321098765");
    expect(normalizePixelId("META", '<img src="https://www.facebook.com/tr?id=111122223333444&ev=PageView">')).toBe(
      "111122223333444",
    );
    expect(normalizePixelId("TIKTOK", "ttq.load('CABCDEFGHIJKLMNOPQ12');\nttq.page();")).toBe("CABCDEFGHIJKLMNOPQ12");
    expect(normalizePixelId("KWAI", "kwaiq.load('283746592837465');kwaiq.page();")).toBe("283746592837465");
    expect(
      normalizePixelId(
        "GA4",
        `<script async src="https://www.googletagmanager.com/gtag/js?id=G-ZZ99YY88"></script><script>gtag('config', 'G-ZZ99YY88');</script>`,
      ),
    ).toBe("G-ZZ99YY88");
    expect(normalizePixelId("GOOGLE_ADS", "gtag('config', 'AW-987654321');")).toBe("AW-987654321");
    expect(
      normalizePixelId(
        "UTMIFY",
        `<script>window.pixelId = "66f1a2b3c4d5e6f7a8b9c0d1"; var a = document.createElement("script");</script>`,
      ),
    ).toBe("66f1a2b3c4d5e6f7a8b9c0d1");
  });

  it("recusa IDs no formato errado com mensagem em português", () => {
    expect(checkPixelId("META", "abc")).toEqual({
      ok: false,
      message: "O ID do pixel da Meta tem só números (10 a 20 dígitos).",
    });
    expect(checkPixelId("GA4", "UA-12345-1")).toMatchObject({ ok: false, message: expect.stringMatching(/G-/) });
    expect(checkPixelId("GOOGLE_ADS", "123456789")).toMatchObject({ ok: false, message: expect.stringMatching(/AW-/) });
    expect(checkPixelId("TIKTOK", "")).toMatchObject({ ok: false, message: expect.stringMatching(/Informe o ID/) });
    // Código da Meta colado no campo do TikTok não vira um ID "válido".
    expect(checkPixelId("TIKTOK", "fbq('init', '987654321098765');")).toMatchObject({ ok: false });
  });

  it("rótulo de conversão do Google Ads: sozinho ou o send_to inteiro", () => {
    expect(checkConversionLabel("AbC-D_efG-h12")).toEqual({ ok: true, label: "AbC-D_efG-h12" });
    expect(checkConversionLabel(" AW-123456789/AbC-D_efG ", "AW-123456789")).toEqual({ ok: true, label: "AbC-D_efG" });
    expect(checkConversionLabel("'AW-123456789/XyZ123'", "AW-123456789")).toEqual({ ok: true, label: "XyZ123" });
    expect(checkConversionLabel("AW-111111111/AbCdEf", "AW-123456789")).toMatchObject({
      ok: false,
      message: expect.stringMatching(/conta AW-111111111.*AW-123456789/),
    });
    expect(checkConversionLabel("rótulo com espaço")).toMatchObject({
      ok: false,
      message: expect.stringMatching(/rótulo/),
    });
  });
});

describe("contrato (schema)", () => {
  it("categoria do código da página: padrão Essencial; valores válidos são lidos", () => {
    expect(PAGE_CODE_DEFAULT_CATEGORY).toBe("NECESSARY");
    expect(parsePageCodeCategory({})).toBe("NECESSARY");
    expect(parsePageCodeCategory(null)).toBe("NECESSARY");
    expect(parsePageCodeCategory({ head: "<script></script>" })).toBe("NECESSARY");
    expect(parsePageCodeCategory({ category: "MARKETING" })).toBe("MARKETING");
    expect(parsePageCodeCategory({ category: "ANALYTICS" })).toBe("ANALYTICS");
    expect(parsePageCodeCategory({ category: "outra" })).toBe("NECESSARY");
    expect(parsePageCodeCategory([])).toBe("NECESSARY");
  });

  it("padrões do rastreamento: LGPD pedindo permissão, código livre da oferta em Marketing", () => {
    const s = parseTrackingSettings(undefined);
    expect(s.consent.mode).toBe("OPT_IN");
    expect(s.customCode.category).toBe("MARKETING");
    expect(s.forwarding.params).toContain("fbclid");
    expect(s.forwarding.persistDays).toBe(30);
    // JSON inválido volta ao padrão (a página nunca quebra).
    expect(parseTrackingSettings({ consent: "lgpd" })).toEqual(TrackingSettingsSchema.parse({}));
  });

  it("opções por plataforma com padrão e envio pelo servidor", () => {
    expect(parseVendorOptions("META", {})).toEqual({ capi: false });
    expect(parseVendorOptions("UTMIFY", { preventSubids: true })).toEqual({
      utmsScript: true,
      preventSubids: true,
      preventXcodSck: false,
    });
    expect(parseVendorOptions("GOOGLE_ADS", "lixo")).toEqual({ conversionLabels: {} });
    expect(serverApiEnabled("META", { capi: true })).toBe(true);
    expect(serverApiEnabled("TIKTOK", { eventsApi: true })).toBe(true);
    expect(serverApiEnabled("TIKTOK", { capi: true })).toBe(false);
    expect(serverApiEnabled("GA4", { capi: true })).toBe(false);
  });

  it("regra de evento: PageView não vira regra; valor/seletor exigidos por gatilho", () => {
    expect(RULE_EVENTS).not.toContain("PAGE_VIEW");
    expect(TRACKING_EVENTS.filter((e) => e !== "PAGE_VIEW")).toEqual([...RULE_EVENTS]);
    const issue = (input: unknown) => EventRuleInputSchema.safeParse(input).error?.issues[0]?.message;
    expect(issue({ event: "PAGE_VIEW", trigger: "PAGE_LOAD" })).toMatch(/PageView já dispara sozinho/);
    expect(issue({ event: "VIEW_CONTENT", trigger: "TIME_ON_PAGE" })).toBe("Informe quantos segundos.");
    expect(issue({ event: "VIEW_CONTENT", trigger: "SCROLL_DEPTH", value: 150 })).toMatch(/porcentagem/);
    expect(issue({ event: "LEAD", trigger: "ELEMENT_CLICK" })).toBe("Escolha o elemento ou link.");
    expect(issue({ event: "LEAD", trigger: "ELEMENT_CLICK", selector: "<a href=x>" })).toMatch(/trecho de HTML/);
    expect(EventRuleInputSchema.safeParse({ event: "LEAD", trigger: "FORM_SUBMIT" }).success).toBe(true);
  });
});

function source(overrides: Partial<TrackingSource> = {}): TrackingSource {
  return {
    mode: "live",
    settings: parseTrackingSettings({}),
    pixels: [],
    rules: [],
    links: [],
    pageId: "pagina1",
    policyUrl: null,
    ...overrides,
  };
}

describe("composeTrackingConfig (configuração pública da página)", () => {
  it("só pixels ligados, sem repetição, só opções públicas", () => {
    const config = composeTrackingConfig(
      source({
        pixels: [
          { vendor: "META", pixelId: "111111111111", enabled: true, options: { capi: true } },
          { vendor: "META", pixelId: "111111111111", enabled: true, options: {} },
          { vendor: "META", pixelId: "222222222222", enabled: false, options: {} },
          {
            vendor: "GOOGLE_ADS",
            pixelId: "AW-123456789",
            enabled: true,
            options: { conversionLabels: { LEAD: "abcd1234", PURCHASE: "" } },
          },
          { vendor: "UTMIFY", pixelId: "66f1a2b3c4d5", enabled: true, options: { preventXcodSck: true, extra: "x" } },
          { vendor: "TIKTOK", pixelId: "CABCDEFGHIJKLMNOPQ12", enabled: true, options: { eventsApi: true } },
        ],
      }),
    );
    expect(config.pixels).toEqual([
      { vendor: "META", id: "111111111111", options: {} },
      { vendor: "GOOGLE_ADS", id: "AW-123456789", options: { conversionLabels: { LEAD: "abcd1234" } } },
      {
        vendor: "UTMIFY",
        id: "66f1a2b3c4d5",
        options: { utmsScript: true, preventSubids: false, preventXcodSck: true },
      },
      { vendor: "TIKTOK", id: "CABCDEFGHIJKLMNOPQ12", options: {} },
    ]);
    expect(JSON.stringify(config)).not.toMatch(/capi|eventsApi|extra/);
    expect(publicPixelOptions("KWAI", { anything: 1 })).toEqual({});
  });

  it("nomes por plataforma com as personalizações; só das plataformas usadas", () => {
    const settings = parseTrackingSettings({ eventNames: { META: { LEAD: "CadastroVIP" } } });
    const config = composeTrackingConfig(
      source({
        settings,
        pixels: [
          { vendor: "META", pixelId: "111111111111", enabled: true, options: {} },
          { vendor: "KWAI", pixelId: "283746592837465", enabled: true, options: {} },
          { vendor: "GOOGLE_ADS", pixelId: "AW-123456789", enabled: true, options: {} },
        ],
      }),
    );
    expect(Object.keys(config.names)).toEqual(["META", "KWAI", "GOOGLE_ADS"]);
    expect(config.names.META?.LEAD).toBe("CadastroVIP");
    expect(config.names.META?.PURCHASE).toBe("Purchase");
    expect(config.names.KWAI?.INITIATE_CHECKOUT).toBe("initiatedCheckout");
    expect(config.names.GOOGLE_ADS?.PAGE_VIEW).toBeNull();
    expect(config.names.TIKTOK).toBeUndefined();
  });

  it("regras: da oferta + desta página, ligadas, limpas e sem repetição", () => {
    const base = { value: null, selector: null, enabled: true };
    const config = composeTrackingConfig(
      source({
        pageId: "pagina1",
        rules: [
          { ...base, pageId: null, event: "VIEW_CONTENT", trigger: "TIME_ON_PAGE", value: 15 },
          { ...base, pageId: "pagina1", event: "VIEW_CONTENT", trigger: "TIME_ON_PAGE", value: 15 },
          { ...base, pageId: "pagina2", event: "LEAD", trigger: "FORM_SUBMIT" },
          { ...base, pageId: null, event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK", value: 99, selector: "a" },
          { ...base, pageId: null, event: "CONTACT", trigger: "ELEMENT_CLICK", selector: '[data-os-link="whats"]' },
          { ...base, pageId: null, event: "LEAD", trigger: "FORM_SUBMIT", enabled: false },
          { ...base, pageId: null, event: "PAGE_VIEW", trigger: "PAGE_LOAD" },
          { ...base, pageId: null, event: "PURCHASE", trigger: "SCROLL_DEPTH", value: null },
        ],
      }),
    );
    expect(config.rules).toEqual([
      { event: "VIEW_CONTENT", trigger: "TIME_ON_PAGE", value: 15, selector: null },
      { event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK", value: null, selector: null },
      { event: "CONTACT", trigger: "ELEMENT_CLICK", value: null, selector: '[data-os-link="whats"]' },
    ]);
    // Documento solto (sem página): só as da oferta inteira.
    const loose = composeTrackingConfig(
      source({ pageId: null, rules: [{ ...base, pageId: "pagina1", event: "LEAD", trigger: "FORM_SUBMIT" }] }),
    );
    expect(loose.rules).toEqual([]);
  });

  it("checkout: chaves dos links CHECKOUT/UPSELL/DOWNSELL e hosts conhecidos + dos links", () => {
    const config = composeTrackingConfig(
      source({
        links: [
          { key: "checkout", kind: "CHECKOUT", url: "https://pay.hotmart.com/X123" },
          { key: "upsell", kind: "UPSELL", url: "https://www.checkout.minhaloja.com.br/p/1" },
          { key: "down", kind: "DOWNSELL", url: "" },
          { key: "whats", kind: "WHATSAPP", url: "https://wa.me/5511999999999" },
          { key: "blog", kind: "OTHER", url: "https://blog.exemplo.com" },
        ],
      }),
    );
    expect(config.checkoutLinkKeys).toEqual(["checkout", "upsell", "down"]);
    expect(config.checkoutHosts).toContain("pay.hotmart.com");
    expect(config.checkoutHosts).toContain("pay.kiwify.com.br");
    expect(config.checkoutHosts).toContain("checkout.minhaloja.com.br");
    expect(config.checkoutHosts).not.toContain("wa.me");
    expect(config.checkoutHosts).not.toContain("blog.exemplo.com");
    // Regras que dependem do caminho (institucionais) ficam de fora; curinga vira ".dominio".
    expect(knownCheckoutHosts()).not.toContain("lastlink.com");
    expect(knownCheckoutHosts()).not.toContain("paypal.com");
    expect(knownCheckoutHosts()).toContain(".checkout-ds24.com");
    expect(knownCheckoutHosts()).not.toContain(".mycartpanda.com"); // só com /checkout no caminho
    expect(knownCheckoutHosts().every((h) => h === h.toLowerCase() && !h.startsWith("www."))).toBe(true);
  });

  it("checkouts que dependem do caminho entram como domínio + começo do caminho (Monetizze, Lastlink, Cartpanda…)", () => {
    const hosts = knownCheckoutHosts();
    for (const entry of [
      "app.monetizze.com.br/checkout/",
      "app.monetizze.com.br/r/",
      "lastlink.com/p/",
      ".mycartpanda.com/checkout",
      "sec.hotmart.com/payment",
    ]) {
      expect(hosts).toContain(entry);
    }
    // Só o domínio (sem caminho) continua de fora: o site institucional não é checkout.
    expect(hosts).not.toContain("app.monetizze.com.br");
    expect(hosts).not.toContain("sec.hotmart.com");
    // Expressões ancoradas simples viram prefixos; o resto fica de fora.
    expect(literalPathPrefixes(/^\/(?:checkout|r)\//i)).toEqual(["/checkout/", "/r/"]);
    expect(literalPathPrefixes(/^\/checkout/i)).toEqual(["/checkout"]);
    expect(literalPathPrefixes(/^\/(?:a|b(?:c|d))\/x/)).toEqual(["/a/x", "/bc/x", "/bd/x"]);
    expect(literalPathPrefixes(/^\/p\/[^/]+/)).toBeNull();
    expect(literalPathPrefixes(/\/checkout/)).toBeNull(); // sem âncora
    expect(literalPathPrefixes(/^\/checkout\b/)).toBeNull();
    expect(literalPathPrefixes(/^\//)).toBeNull(); // "/" sozinho valeria o site inteiro
  });

  it("servidor (eventos.php) só no modo live com endereço e plataforma ligada; teste só no modo test", () => {
    const pixels = [
      { vendor: "META" as const, pixelId: "111111111111", enabled: true, options: { capi: true } },
      { vendor: "TIKTOK" as const, pixelId: "CABCDEFGHIJKLMNOPQ12", enabled: true, options: { eventsApi: false } },
    ];
    const live = composeTrackingConfig(source({ pixels, serverEndpoint: "eventos.php" }));
    expect(live.server).toEqual({ endpoint: "eventos.php", vendors: ["META"] });
    expect(composeTrackingConfig(source({ pixels })).server).toBeNull();
    const preview = composeTrackingConfig(source({ mode: "preview", pixels, serverEndpoint: "eventos.php" }));
    expect(preview.server).toBeNull();
    expect(preview.test).toBeNull();
    const test = { endpoint: "/__os/pixel-test", token: "a".repeat(26) };
    expect(composeTrackingConfig(source({ mode: "test", pixels, test })).test).toEqual(test);
    expect(composeTrackingConfig(source({ mode: "live", pixels, test })).test).toBeNull();
  });

  it("consentimento com a política já resolvida; repasse e valor da oferta", () => {
    const settings = parseTrackingSettings({
      consent: { mode: "NOTICE", theme: "light", policyPageId: "pol" },
      forwarding: { params: ["utm_source", "utm_source", "sck"], persistDays: 7 },
      value: { currency: "USD", amount: 97 },
    });
    const config = composeTrackingConfig(source({ settings, policyUrl: "/p/pol" }));
    expect(config.v).toBe(1);
    expect(config.consent).toEqual({
      mode: "NOTICE",
      // "Só avisar" não tem "Recusar": o texto padrão vira o do aviso.
      text: DEFAULT_NOTICE_TEXT,
      acceptLabel: "Aceitar",
      rejectLabel: "Recusar",
      noticeLabel: "Entendi",
      policyLabel: "Política de privacidade",
      position: "bottom",
      theme: "light",
      policyUrl: "/p/pol",
    });
    expect(config.consent).not.toHaveProperty("policyPageId");
    expect(config.forwarding.params).toEqual(["utm_source", "sck"]);
    expect(config.forwarding.persistDays).toBe(7);
    expect(config.value).toEqual({ currency: "USD", amount: 97 });
  });

  it("texto do aviso: o padrão acompanha o modo; texto escrito pela pessoa fica igual", () => {
    expect(parseTrackingSettings({}).consent.text).toBe(DEFAULT_CONSENT_TEXT);
    expect(consentTextFor("NOTICE", DEFAULT_CONSENT_TEXT)).toBe(DEFAULT_NOTICE_TEXT);
    expect(consentTextFor("OPT_IN", DEFAULT_NOTICE_TEXT)).toBe(DEFAULT_CONSENT_TEXT);
    expect(consentTextFor("OFF", DEFAULT_NOTICE_TEXT)).toBe(DEFAULT_CONSENT_TEXT);
    expect(consentTextFor("OPT_IN", DEFAULT_CONSENT_TEXT)).toBe(DEFAULT_CONSENT_TEXT);
    expect(consentTextFor("NOTICE", "Meu texto.")).toBe("Meu texto.");
    // "Ao continuar navegando, você concorda" não é consentimento (guia de cookies da ANPD):
    // o padrão novo só informa, e ofertas salvas com o padrão antigo passam a usar o novo.
    expect(DEFAULT_NOTICE_TEXT).not.toMatch(/concorda|continuar navegando/i);
    expect(consentTextFor("NOTICE", LEGACY_NOTICE_TEXT)).toBe(DEFAULT_NOTICE_TEXT);
    expect(consentTextFor("NOTICE", ` ${LEGACY_NOTICE_TEXT} `)).toBe(DEFAULT_NOTICE_TEXT);
    expect(consentTextFor("OPT_IN", LEGACY_NOTICE_TEXT)).toBe(DEFAULT_CONSENT_TEXT);
    const legacy = parseTrackingSettings({ consent: { mode: "NOTICE", text: LEGACY_NOTICE_TEXT } });
    expect(composeTrackingConfig(source({ settings: legacy })).consent.text).toBe(DEFAULT_NOTICE_TEXT);
    const custom = parseTrackingSettings({ consent: { mode: "NOTICE", text: "Este site usa cookies." } });
    expect(composeTrackingConfig(source({ settings: custom })).consent.text).toBe("Este site usa cookies.");
    const optIn = parseTrackingSettings({ consent: { mode: "OPT_IN" } });
    expect(composeTrackingConfig(source({ settings: optIn })).consent.text).toBe(DEFAULT_CONSENT_TEXT);
  });
});

describe("relatórios da tela de teste", () => {
  const token = "abcdefghijklmnopqrstuvwxyz";
  it("aceita o formato do contrato e recusa o resto", () => {
    const ok = {
      token,
      vendor: "META",
      event: "PageView",
      status: "FIRED",
      detail: { id: "1", value: 9.9, ok: true, x: null },
    };
    expect(parsePixelTestReport(ok)).toEqual(ok);
    expect(parsePixelTestReport({ token, vendor: "CONSENT", event: "accept", status: "LOADED" })).toBeTruthy();
    for (const bad of [
      null,
      "texto",
      { ...ok, token: "curto" },
      { ...ok, vendor: "OUTRO" },
      { ...ok, status: "OK" },
      { ...ok, event: "" },
      { ...ok, event: "<script>" },
      { ...ok, event: "x".repeat(81) },
      { ...ok, detail: { "chave com espaço": 1 } },
      { ...ok, detail: { a: { nested: true } } },
      { ...ok, detail: { a: "x".repeat(301) } },
      { ...ok, detail: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i])) },
      { ...ok, extra: 1 },
    ]) {
      expect(parsePixelTestReport(bad)).toBeNull();
    }
  });

  it("resume por plataforma: carregado, bloqueado, eventos disparados e falhos", () => {
    let id = 0;
    const row = (vendor: string, event: string, status: "LOADED" | "FIRED" | "BLOCKED" | "ERROR") => ({
      id: ++id,
      at: new Date(),
      vendor,
      event,
      status,
      detail: {},
    });
    const summary = summarizePixelTest(
      [
        row("META", "load", "LOADED"),
        row("META", "PageView", "FIRED"),
        row("META", "PageView", "FIRED"),
        row("META", "Lead", "ERROR"),
        row("TIKTOK", "load", "BLOCKED"),
        row("CONSENT", "accept", "FIRED"),
        row("GA4", "page_view", "FIRED"),
      ],
      ["META", "TIKTOK", "KWAI", "META"],
    );
    expect(summary).toEqual([
      {
        vendor: "META",
        state: "LOADED",
        fired: [{ event: "PageView", count: 2 }],
        failed: [{ event: "Lead", status: "ERROR", count: 1 }],
      },
      { vendor: "TIKTOK", state: "BLOCKED", fired: [], failed: [] },
      { vendor: "KWAI", state: "WAITING", fired: [], failed: [] },
    ]);
  });
});
