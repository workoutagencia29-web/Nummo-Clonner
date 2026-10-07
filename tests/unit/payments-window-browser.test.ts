/**
 * Janela de pagamento e bloco "Acesso ao produto" (Chromium, sem rede): as
 * páginas são renderizadas como na prévia/ZIP (renderPageHtml com o
 * #os-pagamento e o script da janela embutido), o endpoint de pagamento é um
 * servidor falso aqui no teste (mesmo contrato do pagamento.php,
 * src/lib/payments/contract.ts) e o SDK de cartão da Kyvo
 * (https://kyvopay.com/sdk/card.js?v=1) é trocado por um falso — nada sai
 * para a internet.
 *
 * Confere: janela acessível (dialog, foco preso, Esc), idioma por produto
 * (textos e moeda via Intl), métodos por moeda, validação, SPEI (dados,
 * copiar, conferência a cada ~4 s, fechar/reabrir/recarregar com a mesma
 * CLABE), cartão com o SDK (sessão inteira, idioma, cor; onSuccess não é pago;
 * recusado → cobrança nova), Bizum, vencido, erros de rede/servidor, pago →
 * Purchase (valor/moeda do produto, eventID = pedidoExterno, consentimento) e
 * página de obrigado com ?pedido=, UTMs/IDs de clique na metadata (com e sem
 * permissão, versão A/B), e o bloco de acesso só com pedido pago.
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCESS_CSS, ACCESS_TEXTS, accessDef } from "@/editor/widgets/access-content";
import { defToHtml } from "@/editor/widgets/quiz-content";
import { renderPageHtml } from "@/lib/page-render";
import type { PayMethod, PublicPaymentProduct } from "@/lib/payments/contract";
import { runtimeScript, trackingScript } from "@/lib/runtime-bundle";
import { TRACKING_SCRIPT_ATTR, type TrackingRuntimeConfig } from "@/lib/tracking/runtime-config";
import { DEFAULT_FORWARD_PARAMS, PIXEL_VENDORS, TRACKING_EVENTS } from "@/lib/tracking/schema";
import { vendorEventName } from "@/lib/tracking/vendors";

const SDK_URL = "https://kyvopay.com/sdk/card.js?v=1";
// https: a área de transferência só funciona em contexto seguro (como no site publicado).
const ORIGIN = "https://loja.test";
const ENDPOINT = "/api/pagar";
const ORIGIN_ENDPOINT = `${ORIGIN}${ENDPOINT}`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

// ── Produtos ────────────────────────────────────────────────────────────────

const PRODUCTS: Record<string, PublicPaymentProduct> = {
  mx: {
    nome: "Curso de Repostería",
    valor: 49_700,
    moeda: "MXN",
    // Bizum não vale com MXN: a janela não mostra.
    metodos: ["spei", "card", "bizum"],
    idioma: "es",
    obrigado: "/obrigado/",
  },
  eu: {
    nome: "Curso Europa",
    valor: 2_990,
    moeda: "EUR",
    metodos: ["bizum", "mb_way"],
    idioma: "pt",
    obrigado: "/obrigado/",
  },
  us: { nome: "Masterclass", valor: 1_900, moeda: "USD", metodos: ["card"], idioma: "en", obrigado: null },
};

const ACCESS: Record<string, string> = {
  mx: "https://membros.exemplo.com/reposteria",
  eu: "https://membros.exemplo.com/europa",
};

// ── Endpoint falso (contrato do pagamento.php) ────────────────────────────────

interface Order {
  id: string;
  ext: string;
  produto: string;
  metodo: PayMethod;
  status: string;
}

class FakeEndpoint {
  requests: Record<string, unknown>[] = [];
  orders = new Map<string, Order>();
  seq = 0;
  /** Resposta forçada da próxima criação (uma vez). */
  nextCreate: { status: number; body: unknown } | "abort" | null = null;
  sdkUrl = SDK_URL;

  handle(body: Record<string, unknown>): { status: number; body: unknown } | "abort" {
    this.requests.push(body);
    const fail = (status: number, erro: string) => ({ status, body: { ok: false, erro } });
    if (body.acao === "criar") {
      if (this.nextCreate) {
        const forced = this.nextCreate;
        this.nextCreate = null;
        return forced;
      }
      const key = String(body.produto);
      const p = PRODUCTS[key];
      if (!p) return fail(404, "produto_desconhecido");
      const n = ++this.seq;
      const order: Order = {
        id: `tx_${n}`,
        ext: `os_${key}_${String(n).padStart(20, "0")}`,
        produto: key,
        metodo: body.metodo as PayMethod,
        status: "pending",
      };
      this.orders.set(order.id, order);
      const base = {
        ok: true,
        pedido: order.id,
        pedidoExterno: order.ext,
        status: "pending",
        valor: p.valor,
        moeda: p.moeda,
        metodo: order.metodo,
      };
      if (order.metodo === "spei") {
        return {
          status: 201,
          body: {
            ...base,
            spei: {
              clabe: `64618011040000000${n}`,
              banco: "STP",
              titular: "Kyvo Pagos SA de CV",
              referencia: `REF${n}`,
              expiraEm: "2099-01-01T12:00:00.000Z",
            },
          },
        };
      }
      return {
        status: 201,
        body: {
          ...base,
          cartao: {
            sdkUrl: this.sdkUrl,
            sessao: { client_secret: `cs_${n}`, public_key: "pk_test_1", account: "acct_1", transaction_id: order.id },
            expiraEm: null,
          },
        },
      };
    }
    const order = this.orders.get(String(body.pedido));
    if (!order) return fail(404, "nao_encontrado");
    const p = PRODUCTS[order.produto];
    if (body.acao === "status") {
      if (body.produto !== order.produto) return fail(404, "nao_encontrado");
      return {
        status: 200,
        body: {
          ok: true,
          pedido: order.id,
          status: order.status,
          pago: order.status === "paid",
          pedidoExterno: order.ext,
          valor: p.valor,
          moeda: p.moeda,
        },
      };
    }
    if (body.acao === "acesso") {
      if (order.status === "pending") return fail(409, "pendente");
      if (order.status !== "paid") return fail(403, "nao_pago");
      return {
        status: 200,
        body: { ok: true, pedido: order.id, status: "paid", acesso: ACCESS[order.produto], produto: order.produto },
      };
    }
    return fail(400, "invalido");
  }

  creates() {
    return this.requests.filter((r) => r.acao === "criar");
  }
  setStatus(id: string, status: string) {
    const o = this.orders.get(id);
    if (o) o.status = status;
  }
}

// ── SDK falso da Kyvo ─────────────────────────────────────────────────────────

const FAKE_SDK = `(function(){
  var k = window.__kyvo = window.__kyvo || { mounts: [], unmounts: 0, loads: 0 };
  k.loads++;
  window.KyvoCard = { mount: function (o) {
    k.mounts.push({ session: o.session, locale: o.locale, appearance: o.appearance,
      inWindow: !!(o.container && o.container.closest && o.container.closest('[role=dialog]')) });
    o.container.innerHTML = '<div class="fake-sdk"><button type="button" id="sdk-pay">Pagar com cartão</button><button type="button" id="sdk-fail">Cartão recusado</button></div>';
    o.container.querySelector('#sdk-pay').onclick = function () { o.onSuccess({ status: 'processing' }); };
    o.container.querySelector('#sdk-fail').onclick = function () { o.onError({ code: 'payment_declined' }); };
    return { unmount: function () { k.unmounts++; } };
  } };
})();`;

// ── Páginas ──────────────────────────────────────────────────────────────────

const NAMES = Object.fromEntries(
  PIXEL_VENDORS.map((v) => [v, Object.fromEntries(TRACKING_EVENTS.map((e) => [e, vendorEventName(v, e)]))]),
) as TrackingRuntimeConfig["names"];

function trackingConfig(
  consentMode: "OPT_IN" | "NOTICE" | "OFF",
  over: Partial<TrackingRuntimeConfig> = {},
): TrackingRuntimeConfig {
  return {
    v: 1,
    mode: "live",
    pixels: [
      { vendor: "META", id: "123456789012345", options: {} },
      { vendor: "GA4", id: "G-ABC123DEF4", options: {} },
    ],
    rules: [{ event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK" }] as TrackingRuntimeConfig["rules"],
    names: NAMES,
    value: { currency: "BRL", amount: 97 },
    checkoutLinkKeys: ["mx", "eu", "us"],
    checkoutHosts: [],
    marketingCode: false,
    server: null,
    test: null,
    consent: {
      mode: consentMode,
      text: "Usamos cookies.",
      acceptLabel: "Aceitar",
      rejectLabel: "Recusar",
      noticeLabel: "Entendi",
      policyLabel: "Política de privacidade",
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
    ...over,
  };
}

const SALES = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vendas</title>
<style>body{margin:0;font-family:sans-serif}.cta{display:inline-block;padding:16px 24px;background:#7c3aed;color:#fff;border-radius:10px}</style></head>
<body><h1>Oferta</h1>
<a id="comprar" class="cta" data-os-link="mx" href="https://pay.antigo.com/x">Comprar MX</a>
<button id="europa" class="cta" style="background:#0ea5e9" data-os-link="eu">Comprar EU</button>
<a id="usa" class="cta" style="background:#ffffff;color:#111" data-os-link="us" href="#">Buy US</a>
<p class="os-pay" id="selo">🔒 Pagamento seguro · Pix, cartão de crédito ou boleto</p>
<p style="height:1400px">Texto longo</p>
</body></html>`;

const THANKS = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Obrigado</title><style>${ACCESS_CSS}</style></head><body>${defToHtml(accessDef("es"))}</body></html>`;

const LINKS = [
  { key: "mx", url: "", kind: "CHECKOUT", pay: true },
  { key: "eu", url: "", kind: "UPSELL", pay: true },
  { key: "us", url: "", kind: "CHECKOUT", pay: true },
];

function render(html: string, opts: { tracking?: TrackingRuntimeConfig; simulation?: boolean } = {}) {
  return renderPageHtml(html, {
    links: LINKS,
    pageHref: () => "#",
    runtimeTag: `<script data-os-runtime>${runtimeScript().replace(/<\/(script)/gi, "<\\/$1")}</script>`,
    payments: { endpoint: ENDPOINT, simulation: opts.simulation === true, products: PRODUCTS },
    tracking: opts.tracking
      ? { config: opts.tracking, scriptTag: `<script ${TRACKING_SCRIPT_ATTR}>${trackingScript()}</script>` }
      : null,
  });
}

/**
 * Chamadas aos pixels anotadas no Node (window.__rec): sobrevivem à ida para a
 * página de obrigado. O dataLayer do Google anota cada push.
 */
const META_STUB = `(function(){var q=fbq.queue.slice();fbq.queue.length=0;
  fbq.callMethod=function(){window.__rec(JSON.stringify(["fbq"].concat([].slice.call(arguments))))};
  q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`;
const DATA_LAYER = `window.dataLayer=[];(function(p){window.dataLayer.push=function(){
  for(var i=0;i<arguments.length;i++){try{window.__rec(JSON.stringify(["dl"].concat([].slice.call(arguments[i]))))}catch(e){}}
  return p.apply(this,arguments)}})(window.dataLayer.push);`;

interface Site {
  page: Page;
  fake: FakeEndpoint;
  close: () => Promise<void>;
  /** Scripts pedidos pela página. */
  scripts: string[];
  /** Chamadas aos pixels (fbq e dataLayer), de todas as páginas abertas. */
  calls: unknown[][];
  /** HTML como o servidor mandou (antes do script mexer). */
  html: string;
  /** Endereços das páginas pedidas ao servidor (com a query como foi pedida). */
  docs: string[];
}

async function open(
  opts: {
    tracking?: TrackingRuntimeConfig;
    simulation?: boolean;
    query?: string;
    mobile?: boolean;
    clock?: boolean;
    fake?: FakeEndpoint;
    path?: string;
  } = {},
): Promise<Site> {
  const context = await browser.newContext({
    viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 },
    ...(opts.mobile ? { isMobile: true, hasTouch: true } : {}),
    reducedMotion: "reduce",
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
  const calls: unknown[][] = [];
  await context.exposeBinding("__rec", (_src, json: string) => {
    calls.push(JSON.parse(json));
  });
  await context.addInitScript(DATA_LAYER);
  const page = await context.newPage();
  const fake = opts.fake ?? new FakeEndpoint();
  const scripts: string[] = [];
  const docs: string[] = [];
  const sales = render(SALES, opts);
  const thanks = render(THANKS, opts);
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.resourceType() === "script") scripts.push(req.url());
    if (req.resourceType() === "document") docs.push(req.url());
    if (url.origin === ORIGIN) {
      if (url.pathname === ENDPOINT && req.method() === "POST") {
        const r = fake.handle(JSON.parse(req.postData() ?? "{}"));
        if (r === "abort") return route.abort("internetdisconnected");
        const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
        return route.fulfill({ status: r.status, contentType: "application/json", body: text });
      }
      if (url.pathname === "/obrigado/")
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: thanks });
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: sales });
    }
    if (req.url() === SDK_URL) return route.fulfill({ contentType: "application/javascript", body: FAKE_SDK });
    if (req.url().startsWith("https://connect.facebook.net/en_US/fbevents.js")) {
      return route.fulfill({ contentType: "application/javascript", body: META_STUB });
    }
    return route.fulfill({ status: 204, body: "" });
  });
  if (opts.clock) await page.clock.install();
  const res = await page.goto(`${ORIGIN}${opts.path ?? "/vendas/"}${opts.query ?? ""}`);
  const html = (await res?.text()) ?? "";
  return { page, fake, scripts, calls, html, docs, close: () => context.close() };
}

const dialog = (page: Page) => page.getByRole("dialog");

/**
 * A janela levou à página de obrigado com ?pedido=<id>, e o script do <head>
 * já tirou o pedido do endereço (credencial do link de acesso).
 */
async function toThanks(s: Site, pedido: string) {
  await expect.poll(() => s.docs.includes(`${ORIGIN}/obrigado/?${"pedido"}=${pedido}`), { timeout: 10_000 }).toBe(true);
  await s.page.waitForURL(`${ORIGIN}/obrigado/`);
}

async function fillBuyer(page: Page, name = "María López", email = "maria@ejemplo.mx") {
  await page.locator(".os-pw-f input[name=nome]").fill(name);
  await page.locator(".os-pw-f input[name=email]").fill(email);
}

const purchases = (s: Site) => s.calls.filter((c) => c[0] === "fbq" && c[2] === "Purchase");
const gaPurchases = (s: Site) => s.calls.filter((c) => c[0] === "dl" && c[1] === "event" && c[2] === "purchase");

// ── Testes ───────────────────────────────────────────────────────────────────

describe("janela de pagamento", () => {
  it("abre por cima da página, acessível, no idioma e na moeda do produto; Esc fecha e o foco volta", async () => {
    const s = await open();
    const { page } = s;
    expect(await page.locator("#comprar").getAttribute("href")).toBe("#");
    await page.locator("#comprar").click();
    const d = dialog(page);
    await expect.poll(() => d.isVisible()).toBe(true);
    expect(await d.getAttribute("aria-modal")).toBe("true");
    expect(await d.getAttribute("lang")).toBe("es");
    expect(await page.locator(".os-pw-k").textContent()).toBe("Finaliza tu compra");
    expect(await page.locator(".os-pw-n").textContent()).toBe("Curso de Repostería");
    const expected = await page.evaluate(() =>
      new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(497),
    );
    expect(await page.locator(".os-pw-p").textContent()).toBe(expected);
    // Só os métodos que valem para MXN.
    expect(await page.locator(".os-pw-m b").allTextContents()).toEqual(["Transferencia SPEI", "Tarjeta"]);
    // A página não pulou para o topo nem saiu.
    expect(new URL(page.url()).pathname).toBe("/vendas/");
    // A classe os-pay do modelo de vendas não vira a janela (o CSS da janela usa os-pw-).
    expect(await page.locator("#selo").evaluate((el) => getComputedStyle(el).position)).toBe("static");
    // Foco dentro da janela (título) e preso nela.
    expect(await page.evaluate(() => document.activeElement?.className)).toBe("os-pw-n");
    for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"))).toBe(true);
    for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"))).toBe(true);
    // A página por trás não rola.
    expect(await page.evaluate(() => document.documentElement.classList.contains("os-pw-open"))).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(() => d.isVisible()).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("comprar");
    expect(await page.evaluate(() => document.documentElement.classList.contains("os-pw-open"))).toBe(false);
    // Fechar no "×" e clicando fora da caixa também.
    await page.locator("#comprar").click();
    await page.getByRole("button", { name: "Cerrar" }).click();
    await expect.poll(() => d.isVisible()).toBe(false);
    await page.locator("#comprar").click();
    await page.mouse.click(8, 8);
    await expect.poll(() => d.isVisible()).toBe(false);
    expect(s.fake.requests).toEqual([]);
    await s.close();
  }, 30_000);

  it("valida nome e e-mail no idioma do comprador; RFC/CURP só no SPEI", async () => {
    const s = await open();
    const { page } = s;
    await page.locator("#comprar").click();
    await page.getByRole("button", { name: "Generar datos de transferencia" }).click();
    expect(await page.locator(".os-pw-err:not([hidden])").allTextContents()).toEqual([
      "Escribe tu nombre completo.",
      "Escribe un correo electrónico válido.",
    ]);
    expect(await page.locator("input[name=nome]").getAttribute("aria-invalid")).toBe("true");
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement).name)).toBe("nome");
    await fillBuyer(page, "María", "maria@");
    await page.locator("input[name=documento]").fill("x");
    await page.getByRole("button", { name: "Generar datos de transferencia" }).click();
    expect(await page.locator(".os-pw-err:not([hidden])").allTextContents()).toEqual([
      "Escribe un correo electrónico válido.",
      "Revisa el RFC o CURP (o deja el campo vacío).",
    ]);
    // Cartão: sem RFC/CURP e com o botão do cartão.
    await page.locator(".os-pw-m", { hasText: "Tarjeta" }).click();
    expect(await page.locator("input[name=documento]").isVisible()).toBe(false);
    expect(await page.locator(".os-pw-go").textContent()).toBe("Continuar al pago");
    expect(s.fake.creates()).toEqual([]);
    await s.close();
  }, 30_000);

  it("SPEI: dados com Copiar, conferência a cada ~4 s; fechar, reabrir e recarregar mostram a mesma CLABE; pago → obrigado com ?pedido=", async () => {
    const s = await open({ clock: true, query: "?utm_source=facebook&utm_campaign=mx&fbclid=ABC123" });
    const { page, fake } = s;
    await page.locator("#comprar").click();
    await fillBuyer(page);
    await page.locator("input[name=documento]").fill("lopm800101abc");
    await page.getByRole("button", { name: "Generar datos de transferencia" }).click();
    await expect.poll(() => page.locator(".os-pw-rows").isVisible()).toBe(true);
    const created = fake.creates()[0];
    expect(created).toEqual({
      acao: "criar",
      produto: "mx",
      metodo: "spei",
      nome: "María López",
      email: "maria@ejemplo.mx",
      documento: "LOPM800101ABC",
      // Sem o script de rastreamento: só as UTMs do endereço (nada de ID de clique).
      metadata: { utm_source: "facebook", utm_campaign: "mx" },
    });
    const rows = await page
      .locator(".os-pw-r")
      .evaluateAll((els) =>
        els.map((el) => [
          el.querySelector("dt")?.textContent,
          el.querySelector("dd")?.textContent,
          !!el.querySelector("button"),
        ]),
      );
    expect(rows.map((r) => r[0])).toEqual([
      "CLABE",
      "Banco",
      "Beneficiario",
      "Monto exacto",
      "Referencia (concepto)",
      "Válido hasta",
    ]);
    expect(rows[0]).toEqual(["CLABE", "646 180 11040000000 1", true]);
    expect(rows[1]).toEqual(["Banco", "STP", true]);
    expect(rows[2]).toEqual(["Beneficiario", "Kyvo Pagos SA de CV", true]);
    expect(rows[5][2]).toBe(false);
    expect(await page.locator(".os-pw-st").textContent()).toBe("Esperando tu transferencia…");
    // Copiar a CLABE (sem espaços) e o valor exato.
    await page.getByRole("button", { name: "Copiar: CLABE" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("646180110400000001");
    expect(await page.getByRole("button", { name: "Copiar: CLABE" }).textContent()).toBe("¡Copiado!");
    await page.getByRole("button", { name: "Copiar: Monto exacto" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("497.00");

    // Confere o status a cada ~4 s.
    const statuses = () => fake.requests.filter((r) => r.acao === "status").length;
    expect(statuses()).toBe(0);
    await page.clock.runFor(4100);
    await expect.poll(statuses).toBe(1);
    await page.clock.runFor(4100);
    await expect.poll(statuses).toBe(2);
    expect(fake.requests.find((r) => r.acao === "status")).toEqual({ acao: "status", pedido: "tx_1", produto: "mx" });

    // Fechar: para de conferir. Reabrir: mesma CLABE (nada de cobrança nova) e confere na hora.
    await page.keyboard.press("Escape");
    await page.clock.runFor(10_000);
    expect(statuses()).toBe(2);
    await page.locator("#comprar").click();
    await page.clock.runFor(50);
    await expect.poll(statuses).toBe(3);
    expect(await page.locator(".os-pw-r dd").first().textContent()).toBe("646 180 11040000000 1");

    // Recarregar a página: a CLABE continua (guardada no navegador).
    await page.reload();
    await page.locator("#comprar").click();
    await expect.poll(() => page.locator(".os-pw-rows").isVisible()).toBe(true);
    expect(await page.locator(".os-pw-r dd").first().textContent()).toBe("646 180 11040000000 1");
    expect(fake.creates()).toHaveLength(1);
    // Nada do comprador guardado no navegador.
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    expect(stored).toContain("tx_1");
    expect(stored).not.toContain("maria");

    // Pago → confirmação e a página de obrigado com o pedido.
    fake.setStatus("tx_1", "paid");
    await page.clock.runFor(4100);
    await expect.poll(() => page.locator(".os-pw-h").textContent()).toBe("¡Pago confirmado!");
    expect(await page.locator(".os-pw-ctr .os-pw-txt").textContent()).toBe("Te llevamos a la página de acceso…");
    await page.clock.runFor(2000);
    await toThanks(s, "tx_1");
    // O pedido aberto foi esquecido.
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("tx_1");
    await s.close();
  }, 60_000);

  it("SPEI vencido: mensagem e dados novos (cobrança nova); “Cambiar forma de pago” volta ao formulário", async () => {
    const s = await open({ clock: true });
    const { page, fake } = s;
    await page.locator("#comprar").click();
    await fillBuyer(page);
    await page.getByRole("button", { name: "Generar datos de transferencia" }).click();
    await expect.poll(() => page.locator(".os-pw-rows").isVisible()).toBe(true);
    fake.setStatus("tx_1", "expired");
    await page.clock.runFor(4100);
    await expect.poll(() => page.locator(".os-pw-h").textContent()).toBe("Los datos de pago vencieron");
    await page.getByRole("button", { name: "Generar nuevos datos" }).click();
    await expect.poll(() => page.locator(".os-pw-r dd").first().textContent()).toBe("646 180 11040000000 2");
    expect(fake.creates()).toHaveLength(2);
    expect(fake.creates()[1]).toMatchObject({ nome: "María López", metodo: "spei" });
    // SPEI aberto: "Cambiar" pergunta antes; trocando mesmo assim, o SPEI fica guardado à parte.
    await page.getByRole("button", { name: "Cambiar forma de pago" }).click();
    await page.getByRole("button", { name: "Cambiar de todos modos" }).click();
    expect(await page.locator("input[name=nome]").inputValue()).toBe("María López");
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys).toEqual([`os_pago:${ORIGIN_ENDPOINT}:mx:spei`]);
    // Vencido: deixa de ser conferido e a nota some sem apagar o que foi digitado.
    await page.locator("input[name=email]").fill("outra@ejemplo.mx");
    fake.setStatus("tx_2", "expired");
    await page.clock.runFor(4100);
    await expect.poll(() => page.locator(".os-pw-old").count()).toBe(0);
    expect(await page.locator("input[name=email]").inputValue()).toBe("outra@ejemplo.mx");
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("tx_2");
    await s.close();
  }, 30_000);

  it("SPEI pendente: “Cambiar” pede confirmação; o SPEI anterior segue conferido (fechar, recarregar) e, pago, leva ao acesso", async () => {
    const s = await open({ clock: true, mobile: true });
    const { page, fake } = s;
    await page.locator("#comprar").click();
    await fillBuyer(page);
    await page.getByRole("button", { name: "Generar datos de transferencia" }).click();
    await expect.poll(() => page.locator(".os-pw-rows").isVisible()).toBe(true);
    const statusOf = (id: string) => fake.requests.filter((r) => r.acao === "status" && r.pedido === id).length;

    // 1) Pergunta antes de trocar; "seguir esperando" volta à mesma CLABE e confere na hora.
    await page.getByRole("button", { name: "Cambiar forma de pago" }).click();
    await page.getByText("¿Ya hiciste la transferencia?").waitFor();
    await page.getByText(/Si ya transferiste, no cambies/).waitFor();
    expect(await page.locator("input[name=nome]").count()).toBe(0);
    const before = statusOf("tx_1");
    await page.getByRole("button", { name: "Ya transferí, seguir esperando" }).click();
    expect(await page.locator(".os-pw-r dd").first().textContent()).toBe("646 180 11040000000 1");
    await page.clock.runFor(50);
    await expect.poll(() => statusOf("tx_1")).toBe(before + 1);

    // 2) Trocar mesmo assim: formulário com a nota; o SPEI anterior continua sendo conferido.
    await page.getByRole("button", { name: "Cambiar forma de pago" }).click();
    await page.getByRole("button", { name: "Cambiar de todos modos" }).click();
    await page.getByText(/Seguimos revisando tu transferencia SPEI anterior/).waitFor();
    const mid = statusOf("tx_1");
    await page.clock.runFor(4100);
    await expect.poll(() => statusOf("tx_1")).toBe(mid + 1);

    // 3) Fechar e recarregar: a nota e a conferência voltam; "Ver datos…" mostra a mesma CLABE.
    await page.keyboard.press("Escape");
    await page.reload();
    await page.locator("#comprar").click();
    await page.getByText(/Seguimos revisando tu transferencia SPEI anterior/).waitFor();
    await page.getByRole("button", { name: "Ver datos de la transferencia anterior" }).click();
    expect(await page.locator(".os-pw-r dd").first().textContent()).toBe("646 180 11040000000 1");
    await page.getByRole("button", { name: "Cambiar forma de pago" }).click();
    await page.getByRole("button", { name: "Cambiar de todos modos" }).click();

    // 4) Escolhe cartão (cobrança nova) e, no meio, a transferência anterior chega: vai ao acesso dela.
    await page.locator(".os-pw-m", { hasText: "Tarjeta" }).click();
    await fillBuyer(page);
    await page.getByRole("button", { name: "Continuar al pago" }).click();
    await expect.poll(() => page.locator("#sdk-pay").isVisible()).toBe(true);
    expect(fake.creates().map((c) => c.metodo)).toEqual(["spei", "card"]);
    fake.setStatus("tx_1", "paid");
    await page.clock.runFor(4100);
    await expect.poll(() => page.locator(".os-pw-h").textContent()).toBe("¡Pago confirmado!");
    await page.clock.runFor(2000);
    await toThanks(s, "tx_1");
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("tx_1");
    await s.close();
  }, 60_000);

  it("cartão: SDK da Kyvo dentro da janela (sessão inteira, idioma, cor do botão); onSuccess confirma pelo status; pago → obrigado", async () => {
    const s = await open({ clock: true });
    const { page, fake } = s;
    await page.locator("#comprar").click();
    await page.locator(".os-pw-m", { hasText: "Tarjeta" }).click();
    await fillBuyer(page);
    await page.getByRole("button", { name: "Continuar al pago" }).click();
    await expect.poll(() => page.locator("#sdk-pay").isVisible()).toBe(true);
    expect(fake.creates()[0]).toMatchObject({ metodo: "card", produto: "mx" });
    expect(fake.creates()[0]).not.toHaveProperty("documento");
    const kyvo = await page.evaluate(() => (window as { __kyvo?: unknown }).__kyvo);
    expect(kyvo).toEqual({
      loads: 1,
      unmounts: 0,
      mounts: [
        {
          session: { client_secret: "cs_1", public_key: "pk_test_1", account: "acct_1", transaction_id: "tx_1" },
          locale: "es",
          // Cor do botão "Comprar" (#7c3aed).
          appearance: { accent: "#7c3aed", radius: 12 },
          inWindow: true,
        },
      ],
    });
    expect(s.scripts.filter((u) => u.startsWith("https://kyvopay.com/"))).toEqual([SDK_URL]);

    // onSuccess NÃO é pago: confere o status.
    await page.locator("#sdk-pay").click();
    expect(await page.locator(".os-pw-h").textContent()).toBe("Confirmando tu pago…");
    await page.clock.runFor(1600);
    await expect.poll(() => fake.requests.filter((r) => r.acao === "status").length).toBe(1);
    expect(await page.locator(".os-pw-h").textContent()).toBe("Confirmando tu pago…");
    fake.setStatus("tx_1", "paid");
    await page.clock.runFor(4100);
    await expect.poll(() => page.locator(".os-pw-h").textContent()).toBe("¡Pago confirmado!");
    await page.clock.runFor(2000);
    await toThanks(s, "tx_1");
    await s.close();
  }, 30_000);

  it("cartão recusado: mensagem e “Intentar con otra tarjeta” cria cobrança nova (sessão nova no SDK)", async () => {
    const s = await open({ clock: true });
    const { page, fake } = s;
    await page.locator("#comprar").click();
    await page.locator(".os-pw-m", { hasText: "Tarjeta" }).click();
    await fillBuyer(page);
    await page.getByRole("button", { name: "Continuar al pago" }).click();
    await expect.poll(() => page.locator("#sdk-fail").isVisible()).toBe(true);
    await page.locator("#sdk-fail").click();
    expect(await page.locator(".os-pw-h").textContent()).toBe("Pago no aprobado");
    expect(await page.getByRole("alert").textContent()).toContain("No se te cobró nada");
    await page.getByRole("button", { name: "Intentar con otra tarjeta" }).click();
    await expect.poll(() => page.locator("#sdk-pay").isVisible()).toBe(true);
    expect(fake.creates()).toHaveLength(2);
    const kyvo = await page.evaluate(
      () => (window as { __kyvo?: { mounts: { session: { client_secret: string } }[]; unmounts: number } }).__kyvo,
    );
    expect(kyvo?.mounts.map((m) => m.session.client_secret)).toEqual(["cs_1", "cs_2"]);
    expect(kyvo?.unmounts).toBe(1);

    // Recusa no status depois do onSuccess (falhou no banco): também pede outro cartão.
    await page.locator("#sdk-pay").click();
    fake.setStatus("tx_2", "failed");
    await page.clock.runFor(1600);
    await expect.poll(() => page.locator(".os-pw-h").textContent()).toBe("Pago no aprobado");

    // 402 "recusado" já na criação.
    fake.nextCreate = { status: 402, body: { ok: false, erro: "recusado" } };
    await page.getByRole("button", { name: "Intentar con otra tarjeta" }).click();
    await expect.poll(() => page.locator(".os-pw-h").textContent()).toBe("Pago no aprobado");
    await s.close();
  }, 30_000);

  it("cartão sem confirmação do banco por 2 minutos: aparece “Intentar de nuevo” (cobrança nova)", async () => {
    const s = await open({ clock: true });
    const { page, fake } = s;
    await page.locator("#comprar").click();
    await page.locator(".os-pw-m", { hasText: "Tarjeta" }).click();
    await fillBuyer(page);
    await page.getByRole("button", { name: "Continuar al pago" }).click();
    await expect.poll(() => page.locator("#sdk-pay").isVisible()).toBe(true);
    await page.locator("#sdk-pay").click();
    const again = page.getByRole("button", { name: "Intentar de nuevo" });
    expect(await again.isVisible()).toBe(false);
    for (let i = 0; i < 32; i++) {
      await page.clock.runFor(4100);
      if (await again.isVisible()) break;
    }
    expect(await again.isVisible()).toBe(true);
    expect(await page.locator(".os-pw-note").textContent()).toBe(
      "¿Tu banco no confirmó el pago? Puedes intentarlo de nuevo.",
    );
    await again.click();
    await expect.poll(() => fake.creates().length).toBe(2);
    await s.close();
  }, 60_000);

  it("SDK fora de https://kyvopay.com/sdk/ nunca carrega", async () => {
    const fake = new FakeEndpoint();
    fake.sdkUrl = "https://evil.example/sdk.js";
    const s = await open({ fake });
    const { page } = s;
    await page.locator("#comprar").click();
    await page.locator(".os-pw-m", { hasText: "Tarjeta" }).click();
    await fillBuyer(page);
    await page.getByRole("button", { name: "Continuar al pago" }).click();
    await expect.poll(() => page.getByRole("alert").textContent()).toContain("no está disponible");
    expect(s.scripts.some((u) => u.includes("evil.example"))).toBe(false);
    await s.close();
  }, 30_000);

  it("Bizum em português (EUR): textos, moeda e onlyMethods pelo método; MB WAY também", async () => {
    const s = await open();
    const { page, fake } = s;
    await page.locator("#europa").click();
    expect(await page.locator(".os-pw-k").textContent()).toBe("Finalize sua compra");
    const expected = await page.evaluate(() =>
      new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(29.9),
    );
    expect(await page.locator(".os-pw-p").textContent()).toBe(expected);
    expect(await page.locator(".os-pw-m b").allTextContents()).toEqual(["Bizum", "MB WAY"]);
    await page.getByRole("button", { name: "Continuar para o pagamento" }).click();
    expect(await page.locator(".os-pw-err:not([hidden])").first().textContent()).toBe("Escreva seu nome completo.");
    await fillBuyer(page, "Ana Sousa", "ana@exemplo.pt");
    await page.locator(".os-pw-m", { hasText: "MB WAY" }).click();
    await page.getByRole("button", { name: "Continuar para o pagamento" }).click();
    await expect.poll(() => page.locator("#sdk-pay").isVisible()).toBe(true);
    expect(fake.creates()[0]).toMatchObject({ produto: "eu", metodo: "mb_way" });
    expect(await page.locator(".os-pw-body .os-pw-txt").first().textContent()).toBe(
      "Confirme o pagamento com MB WAY no seu telemóvel.",
    );
    const kyvo = await page.evaluate(
      () => (window as { __kyvo?: { mounts: { locale: string; appearance: { accent: string } }[] } }).__kyvo,
    );
    expect(kyvo?.mounts[0].locale).toBe("pt");
    expect(kyvo?.mounts[0].appearance.accent).toBe("#0ea5e9");
    await s.close();
  }, 30_000);

  it("inglês (USD), botão branco usa a cor padrão; produto sem página de obrigado fica na janela", async () => {
    const s = await open({ clock: true });
    const { page, fake } = s;
    await page.locator("#usa").click();
    expect(await page.locator(".os-pw-k").textContent()).toBe("Complete your purchase");
    expect(await page.locator(".os-pw-p").textContent()).toBe("$19.00");
    // Um método só: sem a escolha.
    expect(await page.locator(".os-pw-m").count()).toBe(0);
    await fillBuyer(page, "John Smith", "john@example.com");
    await page.getByRole("button", { name: "Continue to payment" }).click();
    await expect.poll(() => page.locator("#sdk-pay").isVisible()).toBe(true);
    const accent = await page.evaluate(
      () =>
        (window as { __kyvo?: { mounts: { appearance: { accent: string } }[] } }).__kyvo?.mounts[0].appearance.accent,
    );
    expect(accent).toBe("#16a34a");
    await page.locator("#sdk-pay").click();
    fake.setStatus("tx_1", "paid");
    await page.clock.runFor(1600);
    await expect.poll(() => page.locator(".os-pw-h").textContent()).toBe("Payment confirmed!");
    expect(await page.locator(".os-pw-ctr .os-pw-txt").textContent()).toBe("Thank you for your purchase.");
    await page.clock.runFor(3000);
    expect(new URL(page.url()).pathname).toBe("/vendas/");
    await s.close();
  }, 30_000);

  it("erros de rede e do servidor: mensagem clara no idioma e “Intentar de nuevo” refaz", async () => {
    const s = await open();
    const { page, fake } = s;
    await page.locator("#comprar").click();
    await fillBuyer(page);
    fake.nextCreate = "abort";
    await page.getByRole("button", { name: "Generar datos de transferencia" }).click();
    await expect
      .poll(() => page.getByRole("alert").textContent())
      .toContain("No pudimos conectar. Revisa tu conexión a internet");
    fake.nextCreate = { status: 502, body: { ok: false, erro: "indisponivel" } };
    await page.getByRole("button", { name: "Intentar de nuevo" }).click();
    await expect.poll(() => page.getByRole("alert").textContent()).toContain("El sistema de pago no responde");
    fake.nextCreate = { status: 429, body: { ok: false, erro: "limite" } };
    await page.getByRole("button", { name: "Intentar de nuevo" }).click();
    await expect.poll(() => page.getByRole("alert").textContent()).toContain("Demasiados intentos");
    // Resposta que não é JSON (erro interno da hospedagem): "não responde", nada do texto dela.
    fake.nextCreate = { status: 500, body: "<html>erro interno</html>" };
    await page.getByRole("button", { name: "Intentar de nuevo" }).click();
    await expect.poll(() => page.getByRole("alert").textContent()).toContain("El sistema de pago no responde");
    expect(await page.getByRole("dialog").textContent()).not.toContain("erro interno");
    fake.nextCreate = { status: 503, body: { ok: false, erro: "configuracao" } };
    await page.getByRole("button", { name: "Intentar de nuevo" }).click();
    await expect.poll(() => page.getByRole("alert").textContent()).toContain("no está disponible");
    // Nenhum texto do servidor aparece; e não é prévia: sem código de erro.
    expect(await page.locator(".os-pw-sim").count()).toBe(0);
    await page.getByRole("button", { name: "Intentar de nuevo" }).click();
    await expect.poll(() => page.locator(".os-pw-rows").isVisible()).toBe(true);
    expect(fake.creates()).toHaveLength(6);
    await s.close();
  }, 30_000);

  it("no celular: folha de baixo na largura toda, sem rolagem lateral", async () => {
    const s = await open({ mobile: true });
    const { page } = s;
    await page.locator("#comprar").click();
    const box = await page.locator(".os-pw-box").boundingBox();
    expect(box?.x).toBe(0);
    expect(box?.width).toBe(390);
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Campo com 16px (o iPhone não dá zoom ao tocar).
    expect(await page.locator("input[name=email]").evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    expect(await page.locator("input[name=email]").getAttribute("inputmode")).toBe("email");
    await s.close();
  }, 30_000);
});

describe("Purchase e metadata (rastreamento)", () => {
  it("Só avisar: Purchase com o valor/moeda do produto e eventID = pedidoExterno, uma vez; InitiateCheckout no clique", async () => {
    const base = trackingConfig("NOTICE");
    const ads = { vendor: "GOOGLE_ADS", id: "AW-123456789", options: { conversionLabels: { PURCHASE: "AbCdEf" } } };
    const cfg = { ...base, pixels: [...base.pixels, ads] } as TrackingRuntimeConfig;
    const s = await open({ clock: true, tracking: cfg, query: "?utm_source=fb&fbclid=CLICK1" });
    const { page, fake } = s;
    await page.locator("#comprar").click();
    await expect.poll(() => s.calls.filter((c) => c[0] === "fbq" && c[2] === "InitiateCheckout").length).toBe(1);
    await fillBuyer(page);
    await page.getByRole("button", { name: "Generar datos de transferencia" }).click();
    await expect.poll(() => page.locator(".os-pw-rows").isVisible()).toBe(true);
    // Com permissão (Só avisar): UTMs e IDs de clique/cookies de anúncio na metadata.
    const meta = fake.creates()[0].metadata as Record<string, string>;
    expect(meta.utm_source).toBe("fb");
    expect(meta.fbc).toMatch(/^fb\.1\.\d+\.CLICK1$/);
    expect(meta.fbp).toMatch(/^fb\.1\.\d+\.\d+$/);
    expect(Object.keys(meta).sort()).toEqual(["fbc", "fbp", "utm_source"]);
    fake.setStatus("tx_1", "paid");
    await page.clock.runFor(4100);
    await expect.poll(() => purchases(s)).toHaveLength(1);
    const p = purchases(s)[0];
    expect(p).toEqual([
      "fbq",
      "track",
      "Purchase",
      { value: 497, currency: "MXN" },
      { eventID: "os_mx_00000000000000000001" },
    ]);
    await expect.poll(() => gaPurchases(s)).toHaveLength(1);
    const ga = gaPurchases(s);
    expect(ga[0][3]).toMatchObject({
      send_to: "G-ABC123DEF4",
      event_id: "os_mx_00000000000000000001",
      // GA4 deduplica a compra (e mostra no relatório de e-commerce) por transaction_id.
      transaction_id: "os_mx_00000000000000000001",
      value: 497,
      currency: "MXN",
    });
    // Conversão do Google Ads: também com transaction_id (deduplica a compra).
    const adsCall = s.calls.find(
      (c) => c[0] === "dl" && c[1] === "event" && (c[3] as { send_to?: string })?.send_to === "AW-123456789/AbCdEf",
    );
    expect(adsCall?.[3]).toEqual({
      send_to: "AW-123456789/AbCdEf",
      value: 497,
      currency: "MXN",
      transaction_id: "os_mx_00000000000000000001",
    });
    await page.clock.runFor(2000);
    await page.clock.runFor(2000);
    await toThanks(s, "tx_1");
    // Um evento só.
    expect(purchases(s)).toHaveLength(1);
    await s.close();
  }, 30_000);

  it("Pedir permissão sem escolha: metadata sem IDs de clique; Recusar: nenhum Purchase", async () => {
    const s = await open({
      clock: true,
      tracking: trackingConfig("OPT_IN"),
      query: "?utm_source=tt&ttclid=TT1&fbclid=FB1",
    });
    const { page, fake } = s;
    await page.locator("#comprar").click();
    await fillBuyer(page);
    await page.getByRole("button", { name: "Generar datos de transferencia" }).click();
    await expect.poll(() => page.locator(".os-pw-rows").isVisible()).toBe(true);
    expect(fake.creates()[0].metadata).toEqual({ utm_source: "tt" });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Recusar" }).click();
    await page.locator("#comprar").click();
    fake.setStatus("tx_1", "paid");
    await page.clock.runFor(100);
    await expect.poll(() => page.locator(".os-pw-h").textContent()).toBe("¡Pago confirmado!");
    await page.clock.runFor(300);
    expect(purchases(s)).toEqual([]);
    expect(gaPurchases(s)).toEqual([]);
    await s.close();
  }, 30_000);

  it("Pedir permissão sem escolha, no celular: o aviso de cookies fica por cima da janela e “Aceitar” vale na hora", async () => {
    const s = await open({
      clock: true,
      mobile: true,
      tracking: trackingConfig("OPT_IN"),
      query: "?utm_source=facebook&fbclid=IwAR_teste123",
    });
    const { page, fake } = s;
    await page.locator("#comprar").click();
    await expect.poll(() => dialog(page).isVisible()).toBe(true);
    const accept = page.getByRole("button", { name: "Aceitar" });
    const box = await accept.boundingBox();
    expect(box).not.toBeNull();
    const b = box as { x: number; y: number; width: number; height: number };
    // O ponto do "Aceitar" é do aviso (host os-consent), não da janela de pagamento.
    const hit = await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.tagName.toLowerCase(), {
      x: b.x + b.width / 2,
      y: b.y + b.height / 2,
    });
    expect(hit).toBe("os-consent");
    await accept.click();
    // A janela continua aberta.
    expect(await dialog(page).isVisible()).toBe(true);
    await fillBuyer(page);
    await page.getByRole("button", { name: "Generar datos de transferencia" }).click();
    await expect.poll(() => fake.creates().length).toBe(1);
    const meta = fake.creates()[0].metadata as Record<string, string>;
    expect(meta.utm_source).toBe("facebook");
    expect(meta.fbc).toMatch(/^fb\.1\.\d+\.IwAR_teste123$/);
    expect(meta.fbp).toMatch(/^fb\.1\./);
    fake.setStatus("tx_1", "paid");
    await page.clock.runFor(4100);
    await expect.poll(() => purchases(s)).toHaveLength(1);
    expect(purchases(s)[0][4]).toEqual({ eventID: "os_mx_00000000000000000001" });
    await s.close();
  }, 30_000);

  it("Pedir permissão + Aceitar + teste A/B: IDs de clique, os_versao e utm_content com a versão", async () => {
    const cfg = trackingConfig("OPT_IN", { variant: { name: "B", folder: "b/", srcHosts: [] } });
    const s = await open({ tracking: cfg, query: "?utm_source=tt&ttclid=TT1" });
    const { page, fake } = s;
    await page.getByRole("button", { name: "Aceitar" }).click();
    await page.locator("#comprar").click();
    await page.locator(".os-pw-m", { hasText: "Tarjeta" }).click();
    await fillBuyer(page);
    await page.getByRole("button", { name: "Continuar al pago" }).click();
    await expect.poll(() => fake.creates().length).toBe(1);
    expect(fake.creates()[0].metadata).toEqual({
      utm_source: "tt",
      ttclid: "TT1",
      fbp: expect.stringMatching(/^fb\.1\./),
      os_versao: "B",
      utm_content: "versao-b",
    });
    await s.close();
  }, 30_000);
});

describe("bloco “Acesso ao produto” (página de obrigado)", () => {
  it("pedido pago: o botão aparece com o link do servidor (o HTML não tem o link)", async () => {
    const fake = new FakeEndpoint();
    fake.handle({ acao: "criar", produto: "mx", metodo: "spei", nome: "A B", email: "a@b.co" });
    fake.setStatus("tx_1", "paid");
    fake.requests = [];
    const s = await open({ fake, path: "/obrigado/", query: "?pedido=tx_1" });
    const { page } = s;
    expect(s.html).toContain('data-os-ac-go=""');
    expect(s.html).not.toContain("membros.exemplo.com");
    await expect.poll(() => page.locator("[data-os-ac-go]").isVisible()).toBe(true);
    expect(await page.locator("[data-os-ac-go]").getAttribute("href")).toBe(ACCESS.mx);
    expect(await page.locator("[data-os-ac-go]").textContent()).toBe("Acceder a mi producto");
    expect(await page.locator("[data-os-ac-wait]").isVisible()).toBe(false);
    expect(await page.locator("[data-os-ac-none]").isVisible()).toBe(false);
    expect(fake.requests).toEqual([{ acao: "acesso", pedido: "tx_1" }]);
    // O ?pedido= sai do endereço antes dos pixels e de qualquer script (é a credencial do acesso)…
    expect(page.url()).toBe(`${ORIGIN}/obrigado/`);
    // …e recarregar a aba continua dando o acesso.
    await page.reload();
    await expect.poll(() => page.locator("[data-os-ac-go]").isVisible()).toBe(true);
    expect(fake.requests).toEqual([
      { acao: "acesso", pedido: "tx_1" },
      { acao: "acesso", pedido: "tx_1" },
    ]);
    await s.close();
  }, 30_000);

  it("o script que tira o ?pedido= vem antes do rastreamento e de qualquer script da página", async () => {
    const s = await open({
      tracking: trackingConfig("NOTICE"),
      path: "/obrigado/",
      query: "?utm_source=fb&pedido=tx_1",
    });
    const strip = s.html.indexOf("<script data-os-pedido>");
    expect(strip).toBeGreaterThan(0);
    // É o primeiro <script> da página.
    expect(s.html.indexOf("<script")).toBe(strip);
    // As outras partes do endereço ficam.
    expect(s.page.url()).toBe(`${ORIGIN}/obrigado/?utm_source=fb`);
    // Página sem pagamento na oferta: nada disso.
    expect(renderPageHtml(SALES, { links: [], pageHref: () => "#", runtimeTag: "" })).not.toContain("data-os-pedido");
    await s.close();
  }, 30_000);

  it("pendente: continua conferindo e libera quando pagar; sem pedido ou não pago: a mensagem", async () => {
    const fake = new FakeEndpoint();
    fake.handle({ acao: "criar", produto: "eu", metodo: "bizum", nome: "A B", email: "a@b.co" });
    const s = await open({ fake, path: "/obrigado/", query: "?pedido=tx_1", clock: true });
    const { page } = s;
    await expect.poll(() => fake.requests.filter((r) => r.acao === "acesso").length).toBe(1);
    expect(await page.locator("[data-os-ac-wait]").isVisible()).toBe(true);
    expect(await page.locator("[data-os-ac-ok]").isVisible()).toBe(false);
    expect(await page.locator("[data-os-ac-none]").isVisible()).toBe(false);
    fake.setStatus("tx_1", "paid");
    await page.clock.runFor(4100);
    await expect.poll(() => page.locator("[data-os-ac-go]").isVisible()).toBe(true);
    expect(await page.locator("[data-os-ac-go]").getAttribute("href")).toBe(ACCESS.eu);
    // Bloco em Español, produto pago em Português: os textos padrão viram os do produto.
    expect(await page.locator("[data-os-ac-ok] h2").textContent()).toBe(ACCESS_TEXTS.pt.okTitle);
    expect(await page.locator("[data-os-ac-go]").textContent()).toBe(ACCESS_TEXTS.pt.go);
    expect(await page.locator(".os-access").getAttribute("lang")).toBe("pt");
    await s.close();

    for (const query of ["", "?pedido=tx_999", "?pedido=<script>"]) {
      const t = await open({ path: "/obrigado/", query });
      await expect.poll(() => t.page.locator("[data-os-ac-none]").isVisible()).toBe(true);
      expect(await t.page.locator("[data-os-ac-ok]").isVisible()).toBe(false);
      expect(await t.page.locator("[data-os-ac-none] h2").textContent()).toBe("Aún no encontramos tu pago");
      await t.close();
    }

    const failed = new FakeEndpoint();
    failed.handle({ acao: "criar", produto: "mx", metodo: "spei", nome: "A B", email: "a@b.co" });
    failed.setStatus("tx_1", "expired");
    const u = await open({ fake: failed, path: "/obrigado/", query: "?pedido=tx_1" });
    await expect.poll(() => u.page.locator("[data-os-ac-none]").isVisible()).toBe(true);
    expect(await u.page.locator("[data-os-ac-go]").getAttribute("href")).toBe("#");
    await u.close();
  }, 60_000);
});
