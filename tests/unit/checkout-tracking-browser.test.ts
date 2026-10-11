/**
 * Pixels na página de checkout do Offer Studio (Chromium, sem rede): a página
 * como o render a monta (JSON + HTML + script do checkout embutido), passada
 * pelo render das páginas com o rastreamento no modo publicado ("live"); o
 * endpoint é falso aqui no teste e os pixels da Meta e do Google são trocados
 * por gravadores. Confere: InitiateCheckout ao abrir (valor do produto, uma
 * vez por aba), AddPaymentInfo ao gerar o PIX (total), Purchase ao aprovar
 * (total, moeda, eventID = pedidoExterno, conteúdo = produto + bumps; GA4 com
 * transaction_id só na compra) sem repetir ao voltar, e nada com "Recusar".
 * Teste A/B: a versão vinda no endereço (?os_versao=B, posta pelo render nos
 * botões da página de vendas) vai nos eventos e na metadata da cobrança.
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCheckoutConfig } from "@/lib/checkout/config";
import { injectCheckoutVersion, publicCheckoutConfig, renderCheckoutDocument } from "@/lib/checkout/page";
import { renderPageHtml } from "@/lib/page-render";
import { inlineCheckoutScriptTag, trackingScript } from "@/lib/runtime-bundle";
import { TRACKING_SCRIPT_ATTR, type TrackingRuntimeConfig } from "@/lib/tracking/runtime-config";
import { DEFAULT_FORWARD_PARAMS, PIXEL_VENDORS, TRACKING_EVENTS } from "@/lib/tracking/schema";
import { vendorEventName } from "@/lib/tracking/vendors";

const ORIGIN = "https://loja.test";
const ENDPOINT = "/api/pagar";
const EXT = "os_checkout-a1b2c3d4e5_abcdefghij0123456789";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

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

function tracking(consentMode: "OPT_IN" | "NOTICE"): TrackingRuntimeConfig {
  return {
    v: 1,
    mode: "live",
    pixels: [
      { vendor: "META", id: "123456789012345", options: {} },
      { vendor: "GA4", id: "G-ABC123DEF4", options: {} },
    ],
    rules: [],
    names: NAMES,
    value: { currency: "BRL", amount: null },
    checkoutLinkKeys: [],
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
  } as TrackingRuntimeConfig;
}

function checkoutHtml(consentMode: "OPT_IN" | "NOTICE") {
  const cfg = publicCheckoutConfig(
    {
      key: "checkout",
      provider: "FLEVOPAY",
      name: "Curso de Confeitaria",
      amountCents: 19_700,
      currency: "BRL",
      methods: ["PIX"],
      locale: "PT",
      config: parseCheckoutConfig({ bumps: [{ id: "bump0001", title: "Apostila", priceCents: 2_700 }] }),
    },
    { endpoint: ENDPOINT, simulation: false, imageHref: () => null, thankYouHref: "/obrigado/" },
  );
  // Como renderCheckoutPage: o script da versão A/B logo depois do #os-tracking.
  return injectCheckoutVersion(
    renderPageHtml(renderCheckoutDocument(cfg, { scriptTag: inlineCheckoutScriptTag() }), {
      links: [],
      pageHref: () => "#",
      runtimeTag: "",
      tracking: {
        config: tracking(consentMode),
        scriptTag: `<script ${TRACKING_SCRIPT_ATTR}>${trackingScript()}</script>`,
      },
    }),
  );
}

const META_STUB = `(function(){var q=fbq.queue.slice();fbq.queue.length=0;
  fbq.callMethod=function(){window.__rec(JSON.stringify(["fbq"].concat([].slice.call(arguments))))};
  q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`;
const DATA_LAYER = `window.dataLayer=[];(function(p){window.dataLayer.push=function(){
  for(var i=0;i<arguments.length;i++){try{window.__rec(JSON.stringify(["dl"].concat([].slice.call(arguments[i]))))}catch(e){}}
  return p.apply(this,arguments)}})(window.dataLayer.push);`;

/** Endpoint falso: PIX pendente até `paid`. */
function fakeEndpoint() {
  const state = { paid: false, creates: 0, bodies: [] as Record<string, unknown>[] };
  const handle = (body: Record<string, unknown>) => {
    if (body.acao === "checkout_criar") {
      state.creates++;
      state.bodies.push(body);
      const total = 19_700 + ((body.bumps as string[]).includes("bump0001") ? 2_700 : 0);
      return {
        status: 201,
        body: {
          ok: true,
          pedido: "tx_1",
          pedidoExterno: EXT,
          status: "pending",
          valor: total,
          moeda: "BRL",
          metodo: "pix",
          // A imagem do QR do gateway (base64) aparece no lugar do QR gerado na página.
          pix: { codigo: "00020101021226", imagem: PNG, expiraEm: new Date(Date.now() + 1800_000).toISOString() },
        },
      };
    }
    if (body.acao === "checkout_status") {
      return {
        status: 200,
        body: {
          ok: true,
          pedido: "tx_1",
          status: state.paid ? "paid" : "pending",
          pago: state.paid,
          pedidoExterno: EXT,
          valor: 22_400,
          moeda: "BRL",
        },
      };
    }
    return { status: 400, body: { ok: false, erro: "invalido" } };
  };
  return { state, handle };
}

async function open(consentMode: "OPT_IN" | "NOTICE", query = "") {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const calls: unknown[][] = [];
  await context.exposeBinding("__rec", (_src, json: string) => {
    calls.push(JSON.parse(json));
  });
  await context.addInitScript(DATA_LAYER);
  const page = await context.newPage();
  const fake = fakeEndpoint();
  const html = checkoutHtml(consentMode);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === ORIGIN) {
      if (url.pathname === ENDPOINT && req.method() === "POST") {
        const r = fake.handle(JSON.parse(req.postData() ?? "{}"));
        return route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
      }
      if (url.pathname === "/obrigado/") return route.fulfill({ contentType: "text/html", body: "<p>Obrigado</p>" });
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    }
    if (req.url().startsWith("https://connect.facebook.net/en_US/fbevents.js")) {
      return route.fulfill({ contentType: "application/javascript", body: META_STUB });
    }
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto(`${ORIGIN}/checkout/checkout/${query}`);
  return { page, calls, fake, errors, close: () => context.close() };
}

const fb = (calls: unknown[][], name: string) => calls.filter((c) => c[0] === "fbq" && c[2] === name);
const ga = (calls: unknown[][], name: string) =>
  calls.filter((c) => c[0] === "dl" && c[1] === "event" && c[2] === name);

async function pay(page: Page) {
  await page.locator("#osc-nome").fill("Maria da Silva");
  await page.locator("#osc-email").fill("maria@exemplo.com");
  await page.locator("#osc-telefone").fill("11987654321");
  await page.locator("#osc-documento").fill("52998224725");
  await page.locator(".osc-bump").click();
  await page.locator("[data-osc-pay]").click();
  await expect.poll(() => page.locator(".osc-code input").isVisible()).toBe(true);
}

describe("pixels na página de checkout", () => {
  it("InitiateCheckout, AddPaymentInfo e Purchase com valor, conteúdo e eventID; sem repetir", async () => {
    const s = await open("NOTICE");
    const { page, calls } = s;
    await expect.poll(() => fb(calls, "InitiateCheckout").length).toBe(1);
    const ic = fb(calls, "InitiateCheckout")[0];
    expect(ic[3]).toMatchObject({ value: 197, currency: "BRL", content_ids: ["checkout"], num_items: 1 });
    expect((ic[4] as { eventID: string }).eventID).toMatch(/^ic-[a-z0-9]{16}$/);
    await expect.poll(() => ga(calls, "begin_checkout").length).toBe(1);
    expect(ga(calls, "begin_checkout")[0][3]).not.toHaveProperty("transaction_id");

    await pay(page);
    expect(await page.locator(".osc-qr img").getAttribute("src")).toBe(PNG);
    expect(await page.locator(".osc-qr svg").count()).toBe(0);
    await expect.poll(() => fb(calls, "AddPaymentInfo").length).toBe(1);
    expect(fb(calls, "AddPaymentInfo")[0][3]).toMatchObject({
      value: 224,
      currency: "BRL",
      content_ids: ["checkout", "checkout-bump0001"],
      num_items: 2,
    });
    await expect.poll(() => ga(calls, "add_payment_info").length).toBe(1);

    // Recarregar com o PIX aberto: nada de InitiateCheckout de novo (e o QR sai do código guardado).
    await page.reload();
    await expect.poll(() => page.locator(".osc-code input").isVisible()).toBe(true);
    expect(await page.locator(".osc-qr svg").count()).toBe(1);
    s.fake.state.paid = true;
    await expect.poll(() => fb(calls, "Purchase").length, { timeout: 10_000 }).toBe(1);
    const p = fb(calls, "Purchase")[0];
    expect(p[3]).toMatchObject({
      value: 224,
      currency: "BRL",
      content_type: "product",
      content_ids: ["checkout", "checkout-bump0001"],
      contents: [
        { id: "checkout", quantity: 1, item_price: 197 },
        { id: "checkout-bump0001", quantity: 1, item_price: 27 },
      ],
    });
    expect(p[4]).toEqual({ eventID: EXT });
    await expect.poll(() => ga(calls, "purchase").length).toBe(1);
    expect(ga(calls, "purchase")[0][3]).toMatchObject({ transaction_id: EXT, value: 224, currency: "BRL" });
    await page.waitForURL(`${ORIGIN}/obrigado/?pedido=tx_1`, { timeout: 10_000 });

    // Voltar ao checkout depois de pagar: nenhuma compra a mais, nem InitiateCheckout (mesma aba).
    await page.goto(`${ORIGIN}/checkout/checkout/`);
    await expect.poll(() => page.locator("[data-osc-form]").isVisible()).toBe(true);
    await page.waitForTimeout(500);
    expect(fb(calls, "Purchase")).toHaveLength(1);
    expect(fb(calls, "InitiateCheckout")).toHaveLength(1);
    expect(s.fake.state.creates).toBe(1);
    expect(s.errors).toEqual([]);
    await s.close();
  }, 60_000);

  it("teste A/B: a versão do endereço (?os_versao=B) vai nos eventos e na metadata; valor estranho é ignorado", async () => {
    const s = await open("NOTICE", "?os_versao=B&utm_source=facebook");
    const { page, calls } = s;
    await expect.poll(() => fb(calls, "InitiateCheckout").length).toBe(1);
    expect(fb(calls, "InitiateCheckout")[0][3]).toMatchObject({ value: 197, os_versao: "B" });
    await pay(page);
    await expect.poll(() => fb(calls, "AddPaymentInfo").length).toBe(1);
    expect(fb(calls, "AddPaymentInfo")[0][3]).toMatchObject({ os_versao: "B" });
    expect(s.fake.state.bodies[0].metadata).toMatchObject({
      os_versao: "B",
      utm_source: "facebook",
      utm_content: "versao-b",
    });
    expect(s.errors).toEqual([]);
    await s.close();

    // Sem a versão (ou com um valor fora do formato): nada de os_versao.
    for (const query of ["", "?os_versao=%3Cscript%3E"]) {
      const plain = await open("NOTICE", query);
      await expect.poll(() => fb(plain.calls, "InitiateCheckout").length).toBe(1);
      expect(fb(plain.calls, "InitiateCheckout")[0][3]).not.toHaveProperty("os_versao");
      expect(plain.errors).toEqual([]);
      await plain.close();
    }
  }, 60_000);

  it("Pedir permissão → Recusar: nenhum evento dos pixels", async () => {
    const s = await open("OPT_IN");
    const { page, calls } = s;
    await page.getByRole("button", { name: "Recusar" }).click();
    await pay(page);
    s.fake.state.paid = true;
    await page.waitForURL(`${ORIGIN}/obrigado/?pedido=tx_1`, { timeout: 10_000 });
    expect(calls.filter((c) => c[0] === "fbq" && c[1] === "track")).toEqual([]);
    expect(ga(calls, "purchase")).toEqual([]);
    expect(s.errors).toEqual([]);
    await s.close();
  }, 60_000);
});
