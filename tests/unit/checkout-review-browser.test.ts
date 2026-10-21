/**
 * Correções da revisão da página de checkout (Chromium, sem rede): a página
 * como o render a monta (JSON + HTML + script do checkout embutido, com o
 * rastreamento no modo publicado e as regras como o renderCheckoutPage as
 * deixa), endpoint falso aqui no teste e a BrasilAPI respondida pela rota.
 *
 * - PIX aberto: "Alterar dados ou pedido" (com confirmação) volta ao
 *   formulário como estava; o PIX anterior continua conferido e, pago mesmo
 *   assim, vale (Purchase com os itens dele, página de obrigado com ele);
 * - SPEI aberto (Kyvo, peso): "Cambiar forma de pago" com confirmação; a
 *   transferência anterior volta com "Ver datos de la transferencia anterior";
 * - relógio do aparelho adiantado 40 min: o PIX não "vence" na hora (conta
 *   pela hora do servidor; sem ela, não descarta pelo relógio);
 * - recarregou com o PIX aberto e ele venceu: "Preencher os dados de novo";
 * - telefone colado como o WhatsApp mostra; CEP trocado por um que a
 *   BrasilAPI não acha limpa o endereço do anterior; rua corrigida à mão fica;
 * - faixa do cronômetro: some ao zerar; o campo focado com Shift+Tab fica
 *   abaixo dela; campo com erro e foco tem um anel próprio; o erro não entra
 *   no nome do campo; 320 px sem rolagem lateral com um endereço longo;
 * - "Pagar" com tudo vazio não conta Lead (regras recomendadas da oferta).
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCheckoutConfig } from "@/lib/checkout/config";
import {
  type CheckoutPageProduct,
  checkoutPageTracking,
  injectCheckoutVersion,
  publicCheckoutConfig,
  renderCheckoutDocument,
} from "@/lib/checkout/page";
import { renderPageHtml } from "@/lib/page-render";
import { inlineCheckoutScriptTag, trackingScript } from "@/lib/runtime-bundle";
import { TRACKING_SCRIPT_ATTR, type TrackingRuntimeConfig } from "@/lib/tracking/runtime-config";
import { DEFAULT_FORWARD_PARAMS, PIXEL_VENDORS, RECOMMENDED_RULES, TRACKING_EVENTS } from "@/lib/tracking/schema";
import { vendorEventName } from "@/lib/tracking/vendors";

const ORIGIN = "https://loja.test";
const ENDPOINT = "/api/pagar";
const MIN = 60_000;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

const NAMES = Object.fromEntries(
  PIXEL_VENDORS.map((v) => [v, Object.fromEntries(TRACKING_EVENTS.map((e) => [e, vendorEventName(v, e)]))]),
) as TrackingRuntimeConfig["names"];

/** Meta no modo publicado, com as regras recomendadas da oferta (Lead ao enviar formulário…). */
const TRACKING = {
  v: 1,
  mode: "live",
  pixels: [{ vendor: "META", id: "123456789012345", options: {} }],
  rules: RECOMMENDED_RULES.map((r) => ({ event: r.event, trigger: r.trigger, value: r.value, selector: r.selector })),
  names: NAMES,
  value: { currency: "BRL", amount: null },
  checkoutLinkKeys: [],
  checkoutHosts: [],
  marketingCode: false,
  server: null,
  test: null,
  consent: {
    mode: "OFF",
    text: "",
    acceptLabel: "Aceitar",
    rejectLabel: "Recusar",
    noticeLabel: "Entendi",
    policyLabel: "",
    position: "bottom",
    theme: "dark",
    policyUrl: null,
  },
  forwarding: {
    enabled: true,
    params: [...DEFAULT_FORWARD_PARAMS],
    toCheckout: true,
    toInternalLinks: true,
    persistDays: 30,
  },
} as TrackingRuntimeConfig;

const META_STUB = `(function(){var q=fbq.queue.slice();fbq.queue.length=0;
  fbq.callMethod=function(){window.__rec(JSON.stringify([].slice.call(arguments)))};
  q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`;

const LONG_URL = "https://area.exemplo.com/confeitaria-profissional-modulo-completo-com-bonus-exclusivos";

function pixProduct(over: Record<string, unknown> = {}): CheckoutPageProduct {
  return {
    key: "checkout",
    provider: "FLEVOPAY",
    name: "Curso de Confeitaria",
    amountCents: 19_700,
    currency: "BRL",
    methods: ["PIX"],
    locale: "PT",
    config: parseCheckoutConfig({
      description: `Do zero ao primeiro bolo vendido. Acesse em ${LONG_URL}`,
      bumps: [{ id: "bump0001", title: "Apostila", priceCents: 2_700 }],
      timerMinutes: 10,
      ...over,
    }),
  };
}

const KYVO: CheckoutPageProduct = {
  key: "checkout",
  provider: "KYVO",
  name: "Curso de Repostería",
  amountCents: 49_700,
  currency: "MXN",
  methods: ["SPEI", "CARD"],
  locale: "ES",
  config: parseCheckoutConfig({ fields: { name: true, email: true, phone: false, document: false } }),
};

/** A página como o renderCheckoutPage a monta (com as regras que valem nela). */
function checkoutHtml(product: CheckoutPageProduct) {
  const cfg = publicCheckoutConfig(product, {
    endpoint: ENDPOINT,
    simulation: false,
    imageHref: () => null,
    thankYouHref: "/obrigado/",
  });
  return injectCheckoutVersion(
    renderPageHtml(renderCheckoutDocument(cfg, { scriptTag: inlineCheckoutScriptTag() }), {
      links: [],
      pageHref: () => "#",
      runtimeTag: "",
      tracking: {
        config: checkoutPageTracking(TRACKING),
        scriptTag: `<script ${TRACKING_SCRIPT_ATTR}>${trackingScript()}</script>`,
      },
    }),
  );
}

/** Endpoint falso: cada cobrança com um id aleatório nosso; status trocável pelo teste. */
function fakeEndpoint() {
  const state = {
    creates: 0,
    bodies: [] as Record<string, unknown>[],
    status: new Map<string, "pending" | "paid" | "expired" | "failed">(),
    checks: [] as string[],
    /** false = servidor sem `agora` (antigo). */
    agora: true,
    pixMinutes: 30,
  };
  const totalOf = (body: Record<string, unknown>) =>
    (body.metodo === "pix" ? 19_700 : 49_700) + ((body.bumps as string[]).includes("bump0001") ? 2_700 : 0);
  const handle = (body: Record<string, unknown>) => {
    const now = Date.now();
    const agora = state.agora ? { agora: now } : {};
    if (body.acao === "checkout_criar") {
      state.creates++;
      state.bodies.push(body);
      const pedido = `ck_${String(state.creates).padStart(20, "0")}`;
      state.status.set(pedido, "pending");
      const valor = totalOf(body);
      const base = {
        ok: true,
        pedido,
        pedidoExterno: `os_checkout_${state.creates}`,
        status: "pending",
        valor,
        moeda: body.metodo === "pix" ? "BRL" : "MXN",
        metodo: body.metodo,
        ...agora,
      };
      if (body.metodo === "pix") {
        const exp = new Date(now + state.pixMinutes * MIN).toISOString();
        return {
          status: 201,
          body: { ...base, pix: { codigo: `00020101021226${state.creates}`, imagem: null, expiraEm: exp } },
        };
      }
      if (body.metodo === "spei") {
        const spei = {
          clabe: "646180157000000004",
          banco: "STP",
          titular: "Repostería SA",
          referencia: `12345${state.creates}`,
          expiraEm: new Date(now + 3 * 24 * 60 * MIN).toISOString(),
        };
        return { status: 201, body: { ...base, spei } };
      }
      return { status: 201, body: { ...base, cartao: { sdkUrl: "", sessao: { simulacao: true }, expiraEm: null } } };
    }
    if (body.acao === "checkout_status") {
      const pedido = String(body.pedido);
      state.checks.push(pedido);
      const status = state.status.get(pedido);
      if (!status) return { status: 404, body: { ok: false, erro: "nao_encontrado" } };
      const n = Number(pedido.slice(3));
      const first = state.bodies[n - 1] ?? {};
      return {
        status: 200,
        body: {
          ok: true,
          pedido,
          status,
          pago: status === "paid",
          pedidoExterno: `os_checkout_${n}`,
          valor: totalOf(first),
          moeda: first.metodo === "pix" ? "BRL" : "MXN",
          ...agora,
        },
      };
    }
    return { status: 400, body: { ok: false, erro: "invalido" } };
  };
  return { state, handle };
}

const CEPS: Record<string, Record<string, string>> = {
  "01310100": { street: "Avenida Paulista", neighborhood: "Bela Vista", city: "São Paulo", state: "SP" },
  "20040002": { street: "Rua da Assembleia", neighborhood: "Centro", city: "Rio de Janeiro", state: "RJ" },
};

interface OpenOpts {
  product?: CheckoutPageProduct;
  viewport?: { width: number; height: number };
  init?: string;
  /** Relógio do aparelho adiantado (ms). */
  ahead?: number;
}

async function open(opts: OpenOpts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 860 } });
  const calls: unknown[][] = [];
  await context.exposeBinding("__rec", (_src, json: string) => {
    calls.push(JSON.parse(json));
  });
  if (opts.init) await context.addInitScript(opts.init);
  const page = await context.newPage();
  if (opts.ahead) await page.clock.setFixedTime(new Date(Date.now() + opts.ahead));
  const fake = fakeEndpoint();
  const html = checkoutHtml(opts.product ?? pixProduct());
  const errors: string[] = [];
  const visited: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === ORIGIN) {
      if (url.pathname === ENDPOINT && req.method() === "POST") {
        const r = fake.handle(JSON.parse(req.postData() ?? "{}"));
        return route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
      }
      if (url.pathname === "/obrigado/") {
        visited.push(req.url());
        return route.fulfill({ contentType: "text/html", body: "<p>Obrigado</p>" });
      }
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    }
    if (url.hostname === "brasilapi.com.br") {
      const found = CEPS[url.pathname.split("/").pop() ?? ""];
      return found
        ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ cep: "x", ...found }) })
        : route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
    if (req.url().startsWith("https://connect.facebook.net/")) {
      return route.fulfill({ contentType: "application/javascript", body: META_STUB });
    }
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto(`${ORIGIN}/checkout/checkout/`);
  const fb = (name: string) => calls.filter((c) => c[0] === "track" && c[1] === name);
  return { page, fake, errors, visited, fb, close: () => context.close() };
}

async function fillPix(page: Page) {
  await page.locator("#osc-nome").fill("Maria da Silva");
  await page.locator("#osc-email").fill("maria@exemplo.com");
  await page.locator("#osc-telefone").fill("11987654321");
  await page.locator("#osc-documento").fill("52998224725");
}

const pixShown = (page: Page) => page.locator(".osc-code input").isVisible();
const heading = (page: Page) => page.locator("[data-osc-flow] .osc-h").first().textContent();

describe("PIX ou SPEI aberto: voltar ao formulário sem perder quem já pagou", () => {
  it("PIX: “Alterar dados ou pedido” com confirmação; o PIX anterior continua conferido e, pago, vale", async () => {
    const s = await open();
    const { page, fake } = s;
    await fillPix(page);
    await page.locator(".osc-bump").click();
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => pixShown(page)).toBe(true);
    const change = page.locator("[data-osc-change]");
    expect(await change.textContent()).toBe("Alterar dados ou pedido");

    // Quem já pagou espera: a confirmação volta ao mesmo PIX.
    await change.click();
    expect(await heading(page)).toBe("Você já pagou este PIX?");
    await page.getByRole("button", { name: "Já paguei, continuar esperando" }).click();
    await expect.poll(() => pixShown(page)).toBe(true);
    expect(await page.locator(".osc-code input").inputValue()).toBe("000201010212261");

    // Alterar mesmo assim: o formulário volta como estava (dados e bump), com a nota do PIX anterior.
    await page.locator("[data-osc-change]").click();
    await page.locator("[data-osc-change-anyway]").click();
    await expect.poll(() => page.locator("[data-osc-form]").isVisible()).toBe(true);
    expect(await page.locator("#osc-email").inputValue()).toBe("maria@exemplo.com");
    expect(await page.locator('input[name="bump"]').isChecked()).toBe(true);
    expect(await page.locator("[data-osc-old]").textContent()).toContain("Ainda conferimos o PIX anterior");
    // E segue conferido em segundo plano.
    const before = fake.state.checks.filter((p) => p.endsWith("1")).length;
    await expect
      .poll(() => fake.state.checks.filter((p) => p.endsWith("1")).length, { timeout: 10_000 })
      .toBeGreaterThan(before);

    // Corrige o e-mail, tira o bump e gera outro PIX.
    await page.locator("#osc-email").fill("maria.silva@exemplo.com");
    await page.locator(".osc-bump").click();
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => pixShown(page)).toBe(true);
    expect(fake.state.creates).toBe(2);
    expect(fake.state.bodies[1]).toMatchObject({ email: "maria.silva@exemplo.com", bumps: [] });

    // A pessoa tinha pagado o primeiro PIX: ele vale (com o bump que estava nele).
    fake.state.status.set(`ck_${"1".padStart(20, "0")}`, "paid");
    await expect.poll(() => s.visited.length, { timeout: 15_000 }).toBe(1);
    expect(new URL(s.visited[0]).searchParams.get("pedido")).toBe(`ck_${"1".padStart(20, "0")}`);
    expect(s.fb("Purchase")).toHaveLength(1);
    expect(s.fb("Purchase")[0][2]).toMatchObject({ value: 224, content_ids: ["checkout", "checkout-bump0001"] });
    expect(s.errors).toEqual([]);
    await s.close();
  }, 60_000);

  it("SPEI (Kyvo): “Cambiar forma de pago” com confirmação; a transferência anterior volta e sobrevive ao recarregar", async () => {
    const s = await open({ product: KYVO });
    const { page, fake } = s;
    await page.locator("#osc-nome").fill("María López");
    await page.locator("#osc-email").fill("maria@ejemplo.mx");
    await page.locator('label.osc-method:has(input[value="spei"])').click();
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => page.locator(".osc-rows").isVisible()).toBe(true);
    const change = page.locator("[data-osc-change]");
    expect(await change.textContent()).toBe("Cambiar forma de pago");
    await change.click();
    expect(await heading(page)).toBe("¿Ya hiciste la transferencia?");
    await page.locator("[data-osc-change-anyway]").click();
    await expect.poll(() => page.locator("[data-osc-form]").isVisible()).toBe(true);
    expect(await page.locator('input[name="metodo"][value="spei"]').isChecked()).toBe(true);
    expect(await page.locator("[data-osc-old] .osc-link").textContent()).toBe("Ver datos de la transferencia anterior");

    // Paga com tarjeta (o formulário do SDK; aqui, o de exemplo) e volta: a nota continua.
    await page.locator('label.osc-method:has(input[value="card"])').click();
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => page.locator(".osc-cardbox").isVisible()).toBe(true);
    expect(fake.state.bodies[1]).toMatchObject({ metodo: "card" });
    await page.getByRole("button", { name: "Cambiar forma de pago" }).click();
    await expect.poll(() => page.locator("[data-osc-old]").isVisible()).toBe(true);

    // Volta para a transferência anterior (a mesma CLABE e referência) — e recarregar mantém.
    await page.locator("[data-osc-old] .osc-link").click();
    await expect.poll(() => page.locator(".osc-rows").isVisible()).toBe(true);
    expect(await page.locator(".osc-rows").textContent()).toContain("123451");
    await page.reload();
    await expect.poll(() => page.locator(".osc-rows").isVisible()).toBe(true);
    expect(await page.locator(".osc-rows").textContent()).toContain("123451");
    expect(fake.state.creates).toBe(2);
    expect(s.errors).toEqual([]);
    await s.close();
  }, 60_000);
});

describe("validade pelo relógio do servidor", () => {
  it("aparelho 40 min adiantado: o PIX de 30 min aparece com o tempo certo e não “expira” na hora", async () => {
    const s = await open({ ahead: 40 * MIN });
    const { page, fake } = s;
    await fillPix(page);
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => pixShown(page)).toBe(true);
    await expect.poll(() => page.locator(".osc-exp b").textContent()).toMatch(/^(29|30):\d\d$/);
    // Conferiu o status (pendente) e o PIX continua lá.
    await expect.poll(() => fake.state.checks.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(await pixShown(page)).toBe(true);
    expect(await heading(page)).toBe("Falta pouco! Pague com PIX");
    expect(s.errors).toEqual([]);
    await s.close();
  }, 30_000);

  it("servidor sem a hora (`agora`): não dá o PIX por vencido pelo relógio do aparelho", async () => {
    const s = await open({ ahead: 40 * MIN });
    const { page, fake } = s;
    fake.state.agora = false;
    await fillPix(page);
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => pixShown(page)).toBe(true);
    await expect.poll(() => fake.state.checks.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    expect(await pixShown(page)).toBe(true);
    // O relógio do aparelho está errado: a linha da validade some (em vez de "00:00").
    expect(await page.locator(".osc-exp").isVisible()).toBe(false);
    await s.close();
  }, 30_000);

  it("recarregou com o PIX aberto e ele venceu: o botão diz que volta ao formulário", async () => {
    const s = await open();
    const { page, fake } = s;
    await fillPix(page);
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => pixShown(page)).toBe(true);
    await page.reload();
    await expect.poll(() => pixShown(page)).toBe(true);
    fake.state.status.set(`ck_${"1".padStart(20, "0")}`, "expired");
    await expect.poll(() => heading(page), { timeout: 10_000 }).toBe("O código PIX expirou.");
    const again = page.locator("[data-osc-flow] .osc-go");
    expect(await again.textContent()).toBe("Preencher os dados de novo");
    await again.click();
    await expect.poll(() => page.locator("[data-osc-form]").isVisible()).toBe(true);
    await s.close();
  }, 30_000);
});

describe("formulário", () => {
  it("telefone colado como o WhatsApp mostra; CEP trocado limpa o endereço anterior; o que a pessoa corrigiu fica", async () => {
    const s = await open({
      product: pixProduct({ address: true, shipping: [{ id: "frete001", name: "PAC", priceCents: 0 }] }),
    });
    const { page } = s;
    const phone = page.locator("#osc-telefone");
    await phone.focus();
    await page.keyboard.insertText("+55 11 98765-4321");
    expect(await phone.inputValue()).toBe("(11) 98765-4321");
    await page.locator("#osc-email").focus();
    expect(await phone.getAttribute("aria-invalid")).toBeNull();
    // CEP colado com ponto.
    await page.locator("#osc-cep").focus();
    await page.keyboard.insertText("01.310-100");
    await expect.poll(() => page.locator("#osc-rua").inputValue()).toBe("Avenida Paulista");
    await page.locator("#osc-numero").fill("1000");

    const address = () =>
      Promise.all(["#osc-rua", "#osc-bairro", "#osc-cidade", "#osc-uf"].map((sel) => page.locator(sel).inputValue()));
    await page.locator("#osc-cep").fill("30140-071");
    await expect
      .poll(() => page.locator("[data-osc-cep-status]").textContent())
      .toBe("Não encontramos o CEP. Preencha o endereço.");
    expect(await address()).toEqual(["", "", "", ""]);
    expect(await page.locator("#osc-numero").inputValue()).toBe("1000");

    // A pessoa corrige a rua à mão: outra busca não troca o que ela digitou.
    await page.locator("#osc-cep").fill("01310-100");
    await expect.poll(() => page.locator("#osc-rua").inputValue()).toBe("Avenida Paulista");
    await page.locator("#osc-rua").fill("Rua que eu digitei");
    await page.locator("#osc-cep").fill("20040-002");
    await expect.poll(() => page.locator("#osc-cidade").inputValue()).toBe("Rio de Janeiro");
    expect(await address()).toEqual(["Rua que eu digitei", "Centro", "Rio de Janeiro", "RJ"]);
    expect(s.errors).toEqual([]);
    await s.close();
  }, 30_000);

  it("erro fora do nome do campo, anel de foco no campo com erro e nenhum Lead ao clicar em Pagar", async () => {
    const s = await open();
    const { page } = s;
    await expect.poll(() => s.fb("InitiateCheckout").length).toBe(1);
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("osc-nome");
    expect(await page.locator("#osc-nome").getAttribute("aria-invalid")).toBe("true");
    // O nome do campo é só o rótulo; o erro é a descrição.
    expect(await page.getByRole("textbox", { name: "Nome completo", exact: true }).count()).toBe(1);
    expect(await page.locator("#osc-nome").getAttribute("aria-describedby")).toBe("osc-nome-e");
    // Depois da transição (.15s) da borda e da sombra.
    await page.waitForTimeout(400);
    const shadow = (sel: string) => page.$eval(sel, (el) => getComputedStyle(el).boxShadow);
    expect(await shadow("#osc-nome")).not.toBe(await shadow("#osc-email"));
    await page.waitForTimeout(500);
    expect(s.fb("Lead")).toEqual([]);
    expect(s.errors).toEqual([]);
    await s.close();
  }, 30_000);

  it("Shift+Tab: o campo focado fica abaixo da faixa do cronômetro", async () => {
    const s = await open({
      product: pixProduct({ address: true, shipping: [{ id: "frete001", name: "PAC", priceCents: 0 }] }),
      viewport: { width: 1280, height: 700 },
    });
    const { page } = s;
    const pad = await page.evaluate(() => document.documentElement.style.scrollPaddingTop);
    const bar = await page.$eval("[data-osc-timer]", (el) => (el as HTMLElement).offsetHeight);
    expect(pad).toBe(`${bar + 12}px`);
    await page.locator("[data-osc-pay]").focus();
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Shift+Tab");
      const r = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const timer = document.querySelector("[data-osc-timer]") as HTMLElement;
        return { id: el.id, top: el.getBoundingClientRect().top, under: timer.getBoundingClientRect().bottom };
      });
      if (r.id === "osc-rua" || r.id === "osc-nome") expect(r.top, r.id).toBeGreaterThanOrEqual(r.under);
      if (r.id === "osc-nome") break;
    }
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("osc-nome");
    await s.close();
  }, 30_000);
});

describe("cronômetro e celular estreito", () => {
  it("cronômetro zerado: a faixa some (nada de “termina em 00:00”); 320 px sem rolagem lateral", async () => {
    const scope = `${ORIGIN}${ENDPOINT}:checkout`;
    const s = await open({
      viewport: { width: 320, height: 700 },
      init: `try{localStorage.setItem(${JSON.stringify(`os_cron:${scope}`)},JSON.stringify({m:10,end:Date.now()-5000}))}catch(e){}`,
    });
    const { page } = s;
    await expect.poll(() => page.locator("[data-osc-timer]").isVisible()).toBe(false);
    expect(await page.evaluate(() => document.documentElement.style.scrollPaddingTop)).toBe("");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await s.close();
    // Outra oferta no mesmo domínio (outro endpoint) com a mesma chave de link: o cronômetro é dela.
    const other = await open({
      init: `try{localStorage.setItem("os_cron:https://loja.test/outra/pagamento.php:checkout",JSON.stringify({m:10,end:Date.now()-5000}))}catch(e){}`,
    });
    await expect.poll(() => other.page.locator("[data-osc-clock]").textContent()).toMatch(/^(10:00|09:5\d)$/);
    expect(await other.page.locator("[data-osc-timer]").isVisible()).toBe(true);
    await other.close();
  }, 30_000);
});
