/**
 * Fase 4 — tela "Testar pixels": regras puras da tela
 * (src/components/offers/pixel-test/logic.ts): lista de conferência de cada
 * plataforma, consentimento, dicas, textos da linha do tempo, contagem
 * regressiva e a sessão guardada na aba.
 */
import { describe, expect, it } from "vitest";
import {
  badPixelIds,
  consentState,
  defaultPageId,
  describeRow,
  formatCountdown,
  mergeEvents,
  nextPollDelay,
  pixelSettingsHref,
  pixelTestEventsUrl,
  readStoredSession,
  rowTime,
  rulesForPage,
  STATUS_BADGE,
  sessionStorageKey,
  type TestPixel,
  type TestRule,
  testSteps,
  toStoredSession,
  troubleshootingTips,
  VENDOR_STATE_BADGE,
  vendorChecklist,
  vendorHelpers,
  vendorsOf,
} from "@/components/offers/pixel-test/logic";
import type { PixelVendorId, TrackingSettings } from "@/lib/tracking/schema";
import { type PixelTestEventRow, summarizePixelTest } from "@/lib/tracking/test-report";

let seq = 0;
function row(
  vendor: string,
  event: string,
  status: PixelTestEventRow["status"],
  detail: Record<string, unknown> = {},
): PixelTestEventRow {
  seq++;
  return { id: seq, at: new Date(Date.UTC(2026, 8, 29, 13, 0, seq % 60)).toISOString(), vendor, event, status, detail };
}

const pixel = (vendor: PixelVendorId, pixelId: string, extra: Partial<TestPixel> = {}): TestPixel => ({
  id: `px-${vendor}-${pixelId}`,
  vendor,
  pixelId,
  label: null,
  conversionLabels: {},
  ...extra,
});

const rule = (over: Partial<TestRule> & Pick<TestRule, "event" | "trigger">): TestRule => ({
  pageId: null,
  value: null,
  selector: null,
  ...over,
});

const RULES: TestRule[] = [
  rule({ event: "VIEW_CONTENT", trigger: "TIME_ON_PAGE", value: 15 }),
  rule({ event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK" }),
  rule({ event: "LEAD", trigger: "FORM_SUBMIT" }),
];
const LINKS = [
  { key: "checkout", label: "Checkout" },
  { key: "upsell", label: "Upsell" },
];
const META = pixel("META", "123456789012345");

function checklist(
  vendor: PixelVendorId,
  events: PixelTestEventRow[],
  opts: { rules?: TestRule[]; pixels?: TestPixel[]; eventNames?: TrackingSettings["eventNames"] } = {},
) {
  const pixels = opts.pixels ?? [pixel(vendor, "1")];
  return vendorChecklist({
    vendor,
    pixels,
    rules: opts.rules ?? RULES,
    eventNames: opts.eventNames ?? {},
    links: LINKS,
    events,
    summary: summarizePixelTest(events, [vendor])[0],
    consent: consentState(events),
  });
}

const view = (list: { items: { label: string; state: string }[] }) => list.items.map((i) => [i.label, i.state]);

// ─── Dados ───────────────────────────────────────────────────────────────────

describe("dados da tela", () => {
  it("página padrão = inicial; regras da página = as da oferta inteira + as dela; plataformas sem repetir", () => {
    const pages = [
      { id: "p1", name: "Vendas", isHome: false },
      { id: "p2", name: "Início", isHome: true },
    ];
    expect(defaultPageId(pages)).toBe("p2");
    expect(defaultPageId([{ id: "x", name: "Só", isHome: false }])).toBe("x");
    expect(defaultPageId([])).toBeNull();

    const rules = [
      rule({ event: "LEAD", trigger: "FORM_SUBMIT" }),
      rule({ event: "PURCHASE", trigger: "PAGE_LOAD", pageId: "obrigado" }),
      rule({ event: "CONTACT", trigger: "CHECKOUT_CLICK", pageId: "p2" }),
    ];
    expect(rulesForPage(rules, "p2").map((r) => r.event)).toEqual(["LEAD", "CONTACT"]);
    expect(rulesForPage(rules, "obrigado").map((r) => r.event)).toEqual(["LEAD", "PURCHASE"]);

    expect(vendorsOf([META, pixel("GA4", "G-ABC123DEF4"), pixel("META", "999999999999999")])).toEqual(["META", "GA4"]);
    expect(pixelSettingsHref("abc")).toBe("/ofertas/abc?aba=rastreamento&secao=pixels");
    expect(sessionStorageKey("abc")).toBe("os-pixel-test:abc");
  });

  it("junta passos novos sem repetir, em ordem, até o limite", () => {
    const [a, b, c] = [row("META", "PageView", "FIRED"), row("META", "Lead", "FIRED"), row("GA4", "load", "LOADED")];
    const first = mergeEvents([], [b, a]);
    expect(first.map((e) => e.id)).toEqual([a.id, b.id]);
    expect(mergeEvents(first, [])).toBe(first);
    expect(mergeEvents(first, [b])).toBe(first);
    expect(mergeEvents(first, [c, b]).map((e) => e.id)).toEqual([a.id, b.id, c.id]);
    expect(mergeEvents(first, [c], 2).map((e) => e.id)).toEqual([b.id, c.id]);
  });

  it("selos em português", () => {
    expect(Object.values(STATUS_BADGE).map((s) => s.label)).toEqual(["Carregou", "Disparou", "Bloqueado", "Erro"]);
    expect(VENDOR_STATE_BADGE.WAITING.label).toBe("Aguardando");
    expect(VENDOR_STATE_BADGE.BLOCKED.tone).toBe("warning");
    expect(VENDOR_STATE_BADGE.ERROR.tone).toBe("destructive");
  });
});

// ─── Textos da linha do tempo ────────────────────────────────────────────────

describe("describeRow", () => {
  it("script, consentimento e carregamento dos pixels", () => {
    expect(describeRow(row("RUNTIME", "START", "LOADED", { mode: "test" }))).toEqual({
      title: "Página de teste aberta",
      subtitle: null,
      hint: null,
    });
    expect(describeRow(row("RUNTIME", "START", "LOADED", { mode: "preview" })).subtitle).toMatch(/Fora do modo teste/);
    expect(describeRow(row("RUNTIME", "ERROR", "ERROR", { message: "TypeError: x" }))).toMatchObject({
      title: "Erro no script de rastreamento",
      hint: "TypeError: x",
    });
    expect(describeRow(row("CONSENT", "WAITING", "BLOCKED", { hint: "Espera" })).title).toBe(
      "Pixels esperando o “Aceitar”",
    );
    expect(describeRow(row("CONSENT", "ACCEPTED", "FIRED", { remembered: true }))).toMatchObject({
      title: "Visitante aceitou os cookies",
      subtitle: "Escolha guardada de antes",
    });
    expect(describeRow(row("CONSENT", "REJECTED", "BLOCKED", { remembered: false })).subtitle).toBeNull();
    expect(
      describeRow(row("CONSENT", "INITIATE_CHECKOUT", "BLOCKED", { hint: "Não enviado: cookies recusados." })),
    ).toMatchObject({ title: "InitiateCheckout não enviado", hint: "Não enviado: cookies recusados." });

    expect(describeRow(row("META", "load", "LOADED", { pixel: "123" }))).toEqual({
      title: "Pixel carregou",
      subtitle: "ID 123",
      hint: null,
    });
    expect(
      describeRow(row("TIKTOK", "load", "BLOCKED", { pixel: "C1", hint: "Bloqueado pelo navegador." })),
    ).toMatchObject({ title: "Pixel bloqueado", hint: "Bloqueado pelo navegador." });
    expect(describeRow(row("GA4", "load", "ERROR", { message: "falhou" })).title).toBe("Erro ao carregar o pixel");
    expect(describeRow(row("UTMIFY", "load", "LOADED", { script: "utms" })).title).toBe("Script de UTMs carregou");
  });

  it("eventos: nome recebido pela plataforma + evento neutro; Google Ads mostra a conversão", () => {
    expect(describeRow(row("META", "InitiateCheckout", "FIRED", { event: "INITIATE_CHECKOUT" }))).toEqual({
      title: "InitiateCheckout",
      subtitle: "Iniciou checkout (InitiateCheckout)",
      hint: null,
    });
    expect(
      describeRow(row("GOOGLE_ADS", "conversion", "FIRED", { event: "LEAD", sendTo: "AW-123456789/rotulo" })).subtitle,
    ).toBe("Conversão de Lead → AW-123456789/rotulo");
    expect(describeRow(row("META", "Custom", "FIRED")).subtitle).toBeNull();
    // Detalhe fora do formato (nunca quebra a tela).
    expect(describeRow({ ...row("META", "PageView", "FIRED"), detail: null }).title).toBe("PageView");
  });

  it("hora local HH:MM:SS; data inválida vira vazio", () => {
    expect(rowTime({ at: "2026-09-29T13:04:05.000Z" })).toMatch(/^\d{2}:04:05$/);
    expect(rowTime({ at: "ontem" })).toBe("");
  });
});

// ─── Consentimento ───────────────────────────────────────────────────────────

describe("consentState", () => {
  it("segue a última escolha recebida", () => {
    expect(consentState([]).state).toBe("PAGE");
    expect(consentState([row("RUNTIME", "START", "LOADED")]).label).toBe("Aguardando a página de teste");

    const waiting = [row("CONSENT", "WAITING", "BLOCKED"), row("CONSENT", "BANNER", "LOADED")];
    expect(consentState(waiting)).toMatchObject({ state: "WAITING", tone: "warning", label: "Esperando o “Aceitar”" });

    const accepted = [...waiting, row("CONSENT", "ACCEPTED", "FIRED")];
    expect(consentState(accepted)).toMatchObject({ state: "ACCEPTED", tone: "success", label: "Aceito" });
    // Reabrir o aviso pelo "Preferências de cookies" não desfaz o aceite.
    expect(consentState([...accepted, row("CONSENT", "BANNER", "LOADED")]).state).toBe("ACCEPTED");
    // Mudou de ideia.
    expect(consentState([...accepted, row("CONSENT", "REJECTED", "BLOCKED")])).toMatchObject({
      state: "REJECTED",
      tone: "destructive",
    });
    // Outra página do funil com a escolha guardada.
    expect(
      consentState([
        row("CONSENT", "REJECTED", "BLOCKED"),
        row("RUNTIME", "START", "LOADED"),
        row("CONSENT", "ACCEPTED", "FIRED", { remembered: true }),
      ]).state,
    ).toBe("ACCEPTED");
    expect(consentState([row("CONSENT", "NOTICE", "FIRED")]).state).toBe("NOTICE");
    expect(consentState([row("CONSENT", "OFF", "FIRED")])).toMatchObject({
      state: "OFF",
      label: "Sem aviso de cookies",
    });
    // Eventos bloqueados pelo consentimento não mudam a situação.
    expect(consentState([...accepted, row("CONSENT", "LEAD", "BLOCKED")]).state).toBe("ACCEPTED");
  });
});

// ─── Lista de conferência ────────────────────────────────────────────────────

describe("vendorChecklist", () => {
  it("Meta: pixel, PageView e um item por evento das regras, pendentes com o que fazer", () => {
    const list = checklist("META", [], {
      rules: [
        ...RULES,
        rule({ event: "INITIATE_CHECKOUT", trigger: "ELEMENT_CLICK", selector: '[data-os-link="upsell"]' }),
      ],
    });
    expect(view(list)).toEqual([
      ["Pixel carregou", "pending"],
      ["PageView disparou", "pending"],
      ["ViewContent depois de 15 s na página", "pending"],
      ["InitiateCheckout ao clicar no checkout ou ao clicar em “Upsell”", "pending"],
      ["Lead ao enviar o formulário", "pending"],
    ]);
    expect(list.items.map((i) => i.hint)).toEqual([
      "Abra a página de teste.",
      "Dispara sozinho quando o pixel carrega.",
      "Deixe a página de teste aberta, na tela, por 15 segundos.",
      "Clique no botão de compra da página de teste.",
      "Preencha e envie o formulário da página de teste.",
    ]);
    expect(list.note).toBeNull();
  });

  it("marca o que chegou (pelo evento neutro de cada passo)", () => {
    const events = [
      row("RUNTIME", "START", "LOADED"),
      row("CONSENT", "ACCEPTED", "FIRED"),
      row("META", "load", "LOADED", { pixel: "1" }),
      row("META", "PageView", "FIRED", { event: "PAGE_VIEW" }),
      row("META", "InitiateCheckout", "FIRED", { event: "INITIATE_CHECKOUT" }),
    ];
    expect(view(checklist("META", events))).toEqual([
      ["Pixel carregou", "done"],
      ["PageView disparou", "done"],
      ["ViewContent depois de 15 s na página", "pending"],
      ["InitiateCheckout ao clicar no checkout", "done"],
      ["Lead ao enviar o formulário", "pending"],
    ]);
  });

  it("nomes personalizados no painel; passo sem evento neutro casa pelo nome", () => {
    const eventNames = { META: { LEAD: "CadastroFeito" } };
    const events = [row("META", "load", "LOADED"), row("META", "CadastroFeito", "FIRED")];
    const list = checklist("META", events, { eventNames });
    expect(list.items.find((i) => i.id === "LEAD")).toMatchObject({
      label: "CadastroFeito ao enviar o formulário",
      state: "done",
    });
  });

  it("Kwai: o evento neutro separa PageView de ViewContent", () => {
    const events = [row("KWAI", "load", "LOADED"), row("KWAI", "contentView", "FIRED", { event: "VIEW_CONTENT" })];
    const list = checklist("KWAI", events);
    expect(list.items.find((i) => i.id === "PAGE_VIEW")).toMatchObject({
      label: "pageView disparou",
      state: "pending",
    });
    expect(list.items.find((i) => i.id === "VIEW_CONTENT")?.state).toBe("done");
  });

  it("bloqueado pelo navegador: pixel e eventos na fila aparecem como falha, com a explicação", () => {
    const hint = "Bloqueado pelo navegador (bloqueador de anúncios, extensão ou rede).";
    const events = [
      row("CONSENT", "ACCEPTED", "FIRED"),
      row("TIKTOK", "load", "BLOCKED", { pixel: "1", hint }),
      row("TIKTOK", "Pageview", "BLOCKED", { event: "PAGE_VIEW", hint }),
    ];
    const list = checklist("TIKTOK", events);
    expect(list.items[0]).toEqual({ id: "load", label: "Pixel carregou", state: "failed", hint });
    expect(list.items[1]).toMatchObject({ label: "Pageview disparou", state: "failed", hint });
    expect(list.items[2].state).toBe("pending");
  });

  it("consentimento: esperando o “Aceitar” e evento não enviado depois de “Recusar”", () => {
    const waiting = checklist("META", [row("CONSENT", "WAITING", "BLOCKED"), row("CONSENT", "BANNER", "LOADED")]);
    expect(waiting.items[0].hint).toBe("Clique em “Aceitar” no aviso de cookies da página de teste.");

    const rejected = checklist("META", [
      row("CONSENT", "REJECTED", "BLOCKED"),
      row("CONSENT", "INITIATE_CHECKOUT", "BLOCKED", { hint: "Não enviado: cookies recusados." }),
    ]);
    expect(rejected.items[0].hint).toBe("Os cookies foram recusados: o pixel não carrega.");
    expect(rejected.items.find((i) => i.id === "INITIATE_CHECKOUT")).toMatchObject({
      state: "failed",
      hint: "Não enviado: cookies recusados.",
    });
  });

  it("GA4 usa os nomes do Google", () => {
    const list = checklist("GA4", [row("GA4", "page_view", "FIRED", { event: "PAGE_VIEW" })]);
    expect(view(list)).toEqual([
      ["Pixel carregou", "done"],
      ["page_view disparou", "done"],
      ["view_item depois de 15 s na página", "pending"],
      ["begin_checkout ao clicar no checkout", "pending"],
      ["generate_lead ao enviar o formulário", "pending"],
    ]);
  });

  it("Google Ads: sem PageView; só eventos com rótulo de conversão; aviso sem rótulos", () => {
    const ads = pixel("GOOGLE_ADS", "AW-123456789", { conversionLabels: { INITIATE_CHECKOUT: "rotuloCk" } });
    const list = checklist(
      "GOOGLE_ADS",
      [row("GOOGLE_ADS", "conversion", "FIRED", { event: "INITIATE_CHECKOUT", sendTo: "AW-123456789/rotuloCk" })],
      { pixels: [ads] },
    );
    expect(view(list)).toEqual([
      ["Pixel carregou", "done"],
      ["Conversão de InitiateCheckout ao clicar no checkout", "done"],
    ]);
    expect(list.note).toBeNull();
    const none = checklist("GOOGLE_ADS", [], { pixels: [pixel("GOOGLE_ADS", "AW-123456789")] });
    expect(view(none)).toEqual([["Pixel carregou", "pending"]]);
    expect(none.note).toMatch(/Nenhum rótulo de conversão/);
  });

  it("UTMify: só o carregamento (ela dispara os eventos sozinha)", () => {
    const list = checklist("UTMIFY", [row("UTMIFY", "load", "LOADED")]);
    expect(view(list)).toEqual([["Pixel carregou", "done"]]);
    expect(list.note).toMatch(/UTMify dispara os eventos por conta própria/);
  });

  it("clique em elemento: o nome do link da oferta ou o seletor", () => {
    const list = checklist("META", [], {
      rules: [
        rule({ event: "CONTACT", trigger: "ELEMENT_CLICK", selector: "#whats" }),
        rule({ event: "ADD_TO_CART", trigger: "SCROLL_DEPTH", value: 50 }),
        rule({ event: "PURCHASE", trigger: "PAGE_LOAD" }),
      ],
    });
    expect(list.items.slice(2).map((i) => [i.label, i.hint])).toEqual([
      ["Contact ao clicar no elemento escolhido", "Clique no elemento #whats na página de teste."],
      ["AddToCart ao rolar 50% da página", "Role a página de teste até 50% da altura."],
      ["Purchase ao abrir a página", "Dispara ao abrir a página, depois que o pixel carrega."],
    ]);
  });
});

// ─── Dicas ───────────────────────────────────────────────────────────────────

describe("troubleshootingTips", () => {
  function tips(
    events: PixelTestEventRow[],
    extra: { pixels?: TestPixel[]; rules?: TestRule[]; running?: boolean } = {},
  ) {
    const pixels = extra.pixels ?? [META, pixel("TIKTOK", "C1ABCDEFGHIJ2KLMNOPQ")];
    return troubleshootingTips({
      events,
      summaries: summarizePixelTest(events, vendorsOf(pixels)),
      pixels,
      rules: extra.rules ?? RULES,
      consent: consentState(events),
      running: extra.running ?? true,
      full: false,
    });
  }
  const ids = (list: { id: string }[]) => list.map((t) => t.id);

  it("teste começou e a página não abriu: abrir a página", () => {
    expect(ids(tips([]))).toEqual(["open-page"]);
    expect(ids(tips([], { running: false }))).toEqual([]);
  });

  it("script bloqueado e erros primeiro, com os nomes das plataformas e todas as causas", () => {
    const list = tips([
      row("CONSENT", "ACCEPTED", "FIRED"),
      row("META", "load", "BLOCKED", { hint: "Bloqueado" }),
      row("TIKTOK", "Pageview", "BLOCKED", { event: "PAGE_VIEW" }),
      row("RUNTIME", "ERROR", "ERROR", { message: "falha X" }),
    ]);
    expect(ids(list)).toEqual(["blocked", "errors"]);
    expect(list[0].title).toBe("Script bloqueado");
    expect(list[0].text).toMatch(/^Meta \(Facebook e Instagram\) e TikTok foram bloqueados antes de chegar à página/);
    // Não culpa só o bloqueador: rede, firewall/DNS ou internet também bloqueiam.
    expect(list[0].text).toMatch(/bloqueador de anúncios/);
    expect(list[0].text).toMatch(/rede \(firewall, filtro de DNS/);
    expect(list[0].text).toMatch(/outro navegador ou rede/);
    expect(list[1].text).toMatch(/Detalhe: falha X/);
    expect(tips([row("META", "load", "BLOCKED")])[0].text).toMatch(/^Meta \(Facebook e Instagram\) foi bloqueado/);
  });

  it("ID com formato errado", () => {
    const bad = pixel("META", "12345");
    expect(badPixelIds([bad, META]).map((b) => b.pixel.pixelId)).toEqual(["12345"]);
    const list = tips([], { pixels: [bad], running: false });
    expect(list).toEqual([
      {
        id: `bad-id-${bad.id}`,
        tone: "warning",
        title: "ID do pixel parece errado",
        text: "Meta (Facebook e Instagram) (12345): O ID do pixel da Meta tem só números (10 a 20 dígitos).",
      },
    ]);
  });

  it("consentimento: aceitar / recusado", () => {
    expect(ids(tips([row("CONSENT", "WAITING", "BLOCKED")]))).toEqual(["consent-waiting"]);
    const rejected = tips([row("CONSENT", "REJECTED", "BLOCKED")]);
    expect(ids(rejected)).toEqual(["consent-rejected"]);
    expect(rejected[0].text).toMatch(/Preferências de cookies/);
  });

  it("só PageView até agora: clique no botão de compra (sai quando o checkout chega)", () => {
    const base = [
      row("CONSENT", "ACCEPTED", "FIRED"),
      row("META", "load", "LOADED"),
      row("META", "PageView", "FIRED", { event: "PAGE_VIEW" }),
      row("TIKTOK", "Pageview", "FIRED", { event: "PAGE_VIEW" }),
    ];
    const list = tips(base);
    expect(ids(list)).toEqual(["only-page-view"]);
    expect(list[0].text).toBe("Clique no botão de compra da página de teste para ver o InitiateCheckout aqui.");
    const noCheckout = tips(base, { rules: [rule({ event: "LEAD", trigger: "FORM_SUBMIT" })] });
    expect(noCheckout[0].text).toMatch(/Clique nos botões e envie o formulário/);
    expect(ids(tips([...base, row("META", "InitiateCheckout", "FIRED", { event: "INITIATE_CHECKOUT" })]))).toEqual([]);
  });

  it("sem regras de evento e limite de passos", () => {
    expect(ids(tips([row("RUNTIME", "START", "LOADED")], { rules: [] }))).toEqual(["no-rules"]);
    // Página de quiz sem regras: os eventos do quiz chegam, a dica não diz que "só o PageView dispara".
    const quiz = tips(
      [
        row("RUNTIME", "START", "LOADED"),
        row("CONSENT", "ACCEPTED", "FIRED"),
        row("META", "PageView", "FIRED", { event: "PAGE_VIEW" }),
        row("META", "QuizPergunta1", "FIRED", { quiz_pergunta: 1, quiz_total: 4 }),
        row("META", "QuizConcluido", "FIRED", { quiz_total: 4 }),
      ],
      { rules: [] },
    ).find((t) => t.id === "no-rules");
    expect(quiz?.text).not.toMatch(/Só o PageView/);
    expect(quiz?.text).toMatch(/eventos automáticos do quiz/);
    const full = troubleshootingTips({
      events: [],
      summaries: [],
      pixels: [META],
      rules: RULES,
      consent: consentState([]),
      running: false,
      full: true,
    });
    expect(ids(full)).toEqual(["full"]);
  });
});

// ─── Ferramentas das plataformas ─────────────────────────────────────────────

describe("vendorHelpers", () => {
  it("Meta: Pixel Helper e “Testar eventos” de cada pixel", () => {
    const one = vendorHelpers("META", ["123456789012345"]);
    expect(one.links.map((l) => l.href)).toEqual([
      "https://chromewebstore.google.com/detail/meta-pixel-helper/fdgfkebogiimcoedlicjlajpkdmockpc",
      "https://business.facebook.com/events_manager2/list/pixel/123456789012345/test_events",
    ]);
    expect(one.links[1].label).toBe("Gerenciador de Eventos → Testar eventos");
    const two = vendorHelpers("META", ["1", "2"]);
    expect(two.links.slice(1).map((l) => l.label)).toEqual(["Testar eventos do pixel 1", "Testar eventos do pixel 2"]);
  });

  it("todas as plataformas: links https e texto em português", () => {
    for (const vendor of ["META", "TIKTOK", "KWAI", "GA4", "GOOGLE_ADS", "UTMIFY"] as const) {
      const h = vendorHelpers(vendor, ["x"]);
      for (const link of h.links) expect(link.href).toMatch(/^https:\/\/[a-z.]+\.[a-z]+\//);
      expect(h.text).toBeTruthy();
    }
  });
});

// ─── Tempo, sessão guardada e leitura ────────────────────────────────────────

describe("contagem regressiva, sessão guardada e leitura", () => {
  it("formatCountdown", () => {
    expect(formatCountdown(2 * 3600_000)).toBe("2 h 00 min");
    expect(formatCountdown(7_199_000)).toBe("1 h 59 min");
    expect(formatCountdown(3_605_000)).toBe("1 h 00 min");
    expect(formatCountdown(12 * 60_000 + 30_000)).toBe("12 min");
    expect(formatCountdown(59_000)).toBe("59 s");
    expect(formatCountdown(400)).toBe("1 s");
    expect(formatCountdown(0)).toBe("0 s");
    expect(formatCountdown(-5)).toBe("0 s");
  });

  it("sessão guardada: ida e volta; descarta vencida, encerrada, quebrada ou de página excluída", () => {
    const now = Date.UTC(2026, 8, 29, 13);
    const view = {
      id: "cmsess0000000000000000001",
      token: "abcdefghijklmnopqrstuvwxyz",
      url: "http://zyxwvutsrqponmlkjihgfedcba.localhost:3001/?os_teste=abcdefghijklmnopqrstuvwxyz",
      pageId: "p1",
      expiresAt: new Date(now + 3600_000),
      vendors: ["META", "GA4"] as PixelVendorId[],
      offerId: "o1",
      createdAt: new Date(now),
      token2: "ignorado",
    };
    const stored = toStoredSession(view);
    expect(stored).toEqual({
      id: view.id,
      token: view.token,
      url: view.url,
      pageId: "p1",
      expiresAt: new Date(now + 3600_000).toISOString(),
      vendors: ["META", "GA4"],
      ended: false,
    });
    const raw = JSON.stringify(stored);
    expect(readStoredSession(raw, now, ["p1"])).toEqual(stored);
    expect(readStoredSession(JSON.stringify({ ...stored, pageId: null }), now, [])).toEqual({
      ...stored,
      pageId: null,
    });
    expect(readStoredSession(null, now, ["p1"])).toBeNull();
    expect(readStoredSession("{quebrado", now, ["p1"])).toBeNull();
    expect(readStoredSession("[]", now, ["p1"])).toBeNull();
    expect(readStoredSession(raw, now + 3600_000, ["p1"])).toBeNull();
    expect(readStoredSession(raw, now, ["outra"])).toBeNull();
    expect(readStoredSession(JSON.stringify({ ...stored, ended: true }), now, ["p1"])).toBeNull();
    expect(readStoredSession(JSON.stringify({ ...stored, url: "https://evil.example/" }), now, ["p1"])).toBeNull();
    expect(readStoredSession(JSON.stringify({ ...stored, token: "CURTO" }), now, ["p1"])).toBeNull();
    expect(readStoredSession(JSON.stringify({ ...stored, vendors: ["META", "X"] }), now, ["p1"])).toBeNull();
    expect(readStoredSession(JSON.stringify({ ...stored, expiresAt: "amanhã" }), now, ["p1"])).toBeNull();
    expect(readStoredSession(JSON.stringify({ ...stored, id: "a/b" }), now, ["p1"])).toBeNull();
  });

  it("endereço da leitura e espera entre leituras (mais longa depois de falhas)", () => {
    expect(pixelTestEventsUrl("abc", 12)).toBe("/api/pixel-test/abc?after=12");
    expect(pixelTestEventsUrl("a b", -3.5)).toBe("/api/pixel-test/a%20b?after=0");
    expect(nextPollDelay(0)).toBe(1500);
    expect(nextPollDelay(1)).toBe(3000);
    expect(nextPollDelay(2)).toBe(6000);
    expect(nextPollDelay(3)).toBe(12_000);
    expect(nextPollDelay(10)).toBe(15_000);
  });
});

// ─── Consentimento conforme o modo do aviso (Só avisar / Sem aviso) ─────────

describe("modo do aviso de cookies na tela de teste", () => {
  const banner = [row("RUNTIME", "START", "LOADED"), row("CONSENT", "BANNER", "LOADED")];

  it("“Só avisar”: o aviso aparecer não é esperar o Aceitar (os pixels já carregam)", () => {
    const events = [...banner, row("META", "load", "LOADED"), row("META", "PageView", "FIRED", { event: "PAGE_VIEW" })];
    const notice = consentState(events, { mode: "NOTICE" });
    expect(notice).toMatchObject({ state: "NOTICE", tone: "success", label: "Aviso mostrado" });
    expect(notice.hint).toMatch(/carregam direto/);
    // Nenhuma dica manda clicar num “Aceitar” que o aviso não tem.
    const tips = troubleshootingTips({
      events,
      summaries: summarizePixelTest(events, ["META"]),
      pixels: [META],
      rules: RULES,
      consent: notice,
      running: true,
      full: false,
    });
    expect(tips.map((t) => t.id)).not.toContain("consent-waiting");
    const list = vendorChecklist({
      vendor: "META",
      pixels: [META],
      rules: RULES,
      eventNames: {},
      links: LINKS,
      events: banner,
      summary: undefined,
      consent: consentState(banner, { mode: "NOTICE" }),
    });
    expect(list.items[0].hint).toBe("Abra a página de teste.");
    // Sem aviso (OFF) o mesmo vale; com “Pedir permissão”, o aviso é esperar.
    expect(consentState(banner, { mode: "OFF" }).state).not.toBe("WAITING");
    expect(consentState(banner, { mode: "OPT_IN" }).state).toBe("WAITING");
    expect(consentState(banner).state).toBe("WAITING");
  });

  it("usa o texto do botão de aceitar configurado na oferta", () => {
    const waiting = consentState(banner, { mode: "OPT_IN", acceptLabel: "Concordo" });
    expect(waiting.label).toBe("Esperando o “Concordo”");
    expect(waiting.hint).toMatch(/clica em “Concordo”/);
    const tips = troubleshootingTips({
      events: banner,
      summaries: summarizePixelTest(banner, ["META"]),
      pixels: [META],
      rules: RULES,
      consent: waiting,
      running: true,
      full: false,
      acceptLabel: "Concordo",
    });
    const tip = tips.find((t) => t.id === "consent-waiting");
    expect(tip?.text).toMatch(/depois do “Concordo”/);
    expect(tip?.text).not.toMatch(/Aceitar/);
    const list = vendorChecklist({
      vendor: "META",
      pixels: [META],
      rules: RULES,
      eventNames: {},
      links: LINKS,
      events: banner,
      summary: undefined,
      consent: waiting,
      acceptLabel: "Concordo",
    });
    expect(list.items[0].hint).toBe("Clique em “Concordo” no aviso de cookies da página de teste.");
  });

  it("passos na tela conforme o modo: Aceitar só no “Pedir permissão”; nada sobre o aviso sem aviso", () => {
    expect(testSteps({ consentMode: "OPT_IN", acceptLabel: "Concordo", noticeLabel: "Entendi" })).toEqual([
      "Abra a página de teste (ela abre numa aba nova).",
      "Clique em “Concordo” no aviso de cookies.",
      "Use a página como um visitante: responda o quiz, clique no botão de compra ou envie o formulário.",
    ]);
    expect(testSteps({ consentMode: "NOTICE", acceptLabel: "Aceitar", noticeLabel: "Ok" })).toEqual([
      "Abra a página de teste (ela abre numa aba nova).",
      "Os pixels já carregam; “Ok” só fecha o aviso de cookies.",
      "Use a página como um visitante: responda o quiz, clique no botão de compra ou envie o formulário.",
    ]);
    const off = testSteps({ consentMode: "OFF", acceptLabel: "Aceitar", noticeLabel: "Entendi" });
    expect(off).toHaveLength(2);
    expect(off.join(" ")).not.toMatch(/Aceitar|aviso/);
  });
});

describe("script bloqueado: causas além do bloqueador de anúncios", () => {
  it("navegador de teste sem internet: a dica fala da conexão (e não de bloqueador)", () => {
    const events = [row("RUNTIME", "START", "LOADED", { online: false }), row("META", "load", "BLOCKED")];
    const tips = troubleshootingTips({
      events,
      summaries: summarizePixelTest(events, ["META"]),
      pixels: [META],
      rules: RULES,
      consent: consentState(events, { mode: "OFF" }),
      running: true,
      full: false,
    });
    expect(tips[0]).toMatchObject({ id: "offline", title: "Sem internet no navegador de teste" });
    expect(tips.map((t) => t.id)).not.toContain("blocked");
    // Com internet, a dica é “Script bloqueado” (bloqueador, extensão, rede ou internet).
    const online = [row("RUNTIME", "START", "LOADED", { online: true }), row("META", "load", "BLOCKED")];
    const other = troubleshootingTips({
      events: online,
      summaries: summarizePixelTest(online, ["META"]),
      pixels: [META],
      rules: RULES,
      consent: consentState(online, { mode: "OFF" }),
      running: true,
      full: false,
    });
    expect(other[0]).toMatchObject({ id: "blocked", title: "Script bloqueado" });
  });

  it("UTMify: script de UTMs bloqueado e segundo pixel aparecem à parte, sem derrubar o pixel que carregou", () => {
    const utmify = pixel("UTMIFY", "66f1a2b3c4d5e6f7a8b9c0d1", { utmsScript: true });
    const events = [
      row("CONSENT", "ACCEPTED", "FIRED"),
      row("UTMIFY", "load", "LOADED", { pixel: utmify.pixelId }),
      row("UTMIFY", "load", "BLOCKED", { pixel: utmify.pixelId, script: "utms", hint: "Bloqueado pelo navegador." }),
      row("UTMIFY", "load", "ERROR", {
        pixel: "77f1a2b3c4d5e6f7a8b9c0d1",
        extra: true,
        message: "Só o primeiro pixel da UTMify carrega: a UTMify aceita um pixel por página.",
      }),
    ];
    const [summary] = summarizePixelTest(events, ["UTMIFY"]);
    expect(summary.state).toBe("LOADED");
    const list = vendorChecklist({
      vendor: "UTMIFY",
      pixels: [utmify],
      rules: RULES,
      eventNames: {},
      links: LINKS,
      events,
      summary,
      consent: consentState(events),
    });
    expect(list.items.map((i) => [i.id, i.state])).toEqual([
      ["load", "done"],
      ["utms", "failed"],
    ]);
    expect(list.note).toMatch(/Só o primeiro pixel da UTMify carrega/);
  });
});
