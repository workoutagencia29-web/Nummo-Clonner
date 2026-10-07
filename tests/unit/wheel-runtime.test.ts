/**
 * Roleta de desconto na página publicada (Chromium sem rede externa). A roleta
 * sai do editor de verdade (bloco + Configurações) e passa pelo mesmo caminho
 * da prévia/ZIP (finalizeFromEditor + renderPageHtml com o mapa de prêmios); a
 * página de vendas é o modelo "Página de vendas longa" com os botões ligados ao
 * checkout cheio, mais o script de rastreamento (repasse de UTMs, teste A/B e
 * InitiateCheckout na Meta).
 *
 * Roleta: o sorteio vem antes da animação (Math.random injetado) e a roda para
 * na fatia sorteada; resultado, cupom, aviso para leitores de tela e foco no
 * "Resgatar", que leva o os_premio; uma vez por visitante; fatia sem prêmio;
 * teclado e prefers-reduced-motion; sem JavaScript.
 *
 * Página de vendas: botões de checkout trocados pelo link do prêmio (com UTMs,
 * marca da versão A/B e InitiateCheckout), faixa com contador que, ao zerar,
 * muda o texto e o desconto continua; visibilidade condicional; sem prêmio nada
 * muda; prêmio forjado (chave fora do mapa, validade esticada, vencido) ignorado.
 */
import path from "node:path";
import { buildSync } from "esbuild";
import { type Browser, type BrowserContextOptions, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAGE_TEMPLATES } from "@/editor/templates";
import { renderPageHtml } from "@/lib/page-render";
import { runtimeScript } from "@/lib/runtime-bundle";
import type { TrackingRuntimeConfig } from "@/lib/tracking/runtime-config";
import { DEFAULT_FORWARD_PARAMS, PIXEL_VENDORS, TRACKING_EVENTS } from "@/lib/tracking/schema";
import { vendorEventName } from "@/lib/tracking/vendors";
import { prizeId, prizeParam, sliceAt, type WheelSlice } from "@/lib/wheel";
import { type WheelRender, wheelRenderData } from "@/lib/wheel-prizes";
import { addBlock, type EditorWindow, exportPage, openEditor, setAttrs, setTrait } from "./blocks-harness";
import { fakeId } from "./helpers";

const SALES = fakeId("vendas");
const WHEEL_PATH = "/roleta/";
const SALES_PATH = `/p/${SALES}`;
const DAY = 864e5;

const SLICES: WheelSlice[] = [
  { text: "10% OFF", color: "#7c3aed", chance: 40, link: "c10", coupon: "" },
  { text: "30% OFF", color: "#ec4899", chance: 20, link: "c30", coupon: "ROLETA30" },
  { text: "Não foi dessa vez", color: "#64748b", chance: 30, link: "", coupon: "", lose: true },
  { text: "50% OFF", color: "#10b981", chance: 10, link: "c30", coupon: "" },
];

const LINKS = [
  { key: "checkout", url: "https://pay.exemplo.com/cheio", kind: "CHECKOUT" },
  { key: "c10", url: "https://pay.exemplo.com/dez", kind: "CHECKOUT" },
  { key: "c30", url: "https://pay.exemplo.com/trinta", kind: "CHECKOUT" },
];

const TRACKING = buildSync({
  entryPoints: [path.join(process.cwd(), "src/runtime/tracking/index.ts")],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2018", "safari13"],
  write: false,
  legalComments: "none",
}).outputFiles[0].text;

const NAMES = Object.fromEntries(
  PIXEL_VENDORS.map((v) => [v, Object.fromEntries(TRACKING_EVENTS.map((e) => [e, vendorEventName(v, e)]))]),
) as TrackingRuntimeConfig["names"];

/** Rastreamento sem aviso de cookies, Meta, InitiateCheckout no checkout e teste A/B (versão B). */
const CONFIG: TrackingRuntimeConfig = {
  v: 1,
  mode: "live",
  pixels: [{ vendor: "META", id: "123456789012345", options: {} }],
  rules: [{ event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK", value: null, selector: null }],
  names: NAMES,
  value: { currency: "BRL", amount: null },
  checkoutLinkKeys: LINKS.map((l) => l.key),
  checkoutHosts: [],
  marketingCode: false,
  server: null,
  test: null,
  variant: { name: "B", folder: "vendas-b/", srcHosts: [] },
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
};

const META_STUB = `(function(){var c=window.__calls=window.__calls||[];var A=function(a){return [].slice.call(a)};
  var q=fbq.queue.slice();fbq.queue.length=0;fbq.callMethod=function(){c.push(["fbq"].concat(A(arguments)))};
  q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`;

let browser: Browser;
let wheelHtml = "";
let salesHtml = "";
let wheel: WheelRender;
/** Roleta e um botão de compra (checkout cheio) na mesma página: o bloco solto na página de vendas. */
let comboHtml = "";
/** "Resgatar" ligado ao link de checkout da oferta (checkout cheio). */
let goCheckoutHtml = "";
/** "Resgatar" levando a uma âncora da própria página. */
let anchorHtml = "";
/** A mesma roleta em duas ofertas (código da oferta diferente). */
const scoped: Record<string, string> = {};

/** Página de vendas do modelo, com os botões no checkout cheio e blocos condicionais. */
function salesPage(render: WheelRender | null) {
  const template = PAGE_TEMPLATES.find((t) => t.id === "vendas-longa")?.html ?? "";
  const html = template
    .replaceAll('data-os-link=""', 'data-os-link="checkout"')
    .replace(
      "<body>",
      '<body><p id="so-ganhou" data-os-premio="ganhou">Preço com desconto só hoje</p><p id="so-nao" data-os-premio="nao">Preço cheio</p>',
    );
  return renderPageHtml(html, {
    links: LINKS,
    pageHref: (id) => `/p/${id}`,
    runtimeTag: `<script data-os-runtime>${runtimeScript()}</script>`,
    tracking: { config: CONFIG, scriptTag: `<script data-os-tracking>${TRACKING}</script>` },
    wheel: render,
  });
}

beforeAll(async () => {
  browser = await chromium.launch();
  const editor = await openEditor(browser, {
    pages: [
      { id: fakeId("roleta"), name: "Roleta" },
      { id: SALES, name: "Página de vendas", type: "SALES" },
    ],
    links: LINKS.map((l) => ({ key: l.key, label: l.key, kind: l.kind })),
  });
  await addBlock(editor, "roleta");
  await setAttrs(editor, '[data-os-widget="wheel"]', { "data-os-slices": JSON.stringify(SLICES) });
  await setTrait(editor, '[data-os-widget="wheel"]', "os-wh-page", SALES);
  const draft = await exportPage(editor, { links: LINKS });
  wheel = wheelRenderData([draft], LINKS);
  wheelHtml = await exportPage(editor, { links: LINKS, wheel });
  for (const scope of ["ofa", "ofb"]) {
    scoped[`/${scope}/roleta/`] = await exportPage(editor, { links: LINKS, wheel: { ...wheel, scope } });
    scoped[`/${scope}/vendas/`] = salesPage({ ...wheel, scope });
  }
  await editor.evaluate(() => {
    (window as unknown as EditorWindow).ed
      .getWrapper()
      ?.append('<a id="comprar" class="os-btn" href="#" data-os-link="checkout">COMPRAR AGORA</a>');
  });
  comboHtml = await exportPage(editor, { links: LINKS, wheel });
  await setTrait(editor, '[data-os-widget="wheel"]', "os-wh-link", "checkout");
  goCheckoutHtml = await exportPage(editor, { links: LINKS, wheel });
  await editor.evaluate(() => {
    const go = (window as unknown as EditorWindow).ed.getWrapper()?.find("[data-os-wh-go]")[0];
    go?.removeAttributes("data-os-link");
    go?.addAttributes({ href: "#comprar" });
  });
  anchorHtml = await exportPage(editor, { links: LINKS, wheel });
  await editor.close();
  salesHtml = salesPage(wheel);
}, 90_000);

afterAll(async () => {
  await browser?.close();
});

/** Anota os avisos "os:wheel" em window.__wheel; Math.random fixo (sorteio previsível). */
const init = (random?: number) =>
  `window.__wheel=[];document.addEventListener("os:wheel",function(e){window.__wheel.push(e.detail)});${
    random === undefined ? "" : `Math.random=function(){return ${random}};`
  }`;

interface Site {
  page: Page;
  close: () => Promise<void>;
  /** Endereços de checkout abertos (navegação para fora). */
  checkouts: string[];
}

/** Roleta em /roleta/, página de vendas em /p/<id>, checkouts respondem com uma página simples. */
async function open(
  url: string,
  opts: {
    random?: number;
    context?: BrowserContextOptions;
    sales?: string;
    clock?: boolean;
    /** Outras páginas do site (caminho → HTML). */
    routes?: Record<string, string>;
  } = {},
): Promise<Site> {
  const context = await browser.newContext(
    opts.context ?? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  );
  const checkouts: string[] = [];
  await context.addInitScript({ content: init(opts.random) });
  await context.route("**/*", (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const html = (body: string) => route.fulfill({ contentType: "text/html; charset=utf-8", body });
    if (u.origin === "http://site.test") {
      const extra = opts.routes?.[u.pathname];
      if (extra) return html(extra);
      if (u.pathname === WHEEL_PATH) return html(wheelHtml);
      if (u.pathname === SALES_PATH) return html(opts.sales ?? salesHtml);
    }
    if (u.hostname === "pay.exemplo.com") {
      checkouts.push(req.url());
      return html("<!doctype html><title>Checkout</title><h1>Checkout</h1>");
    }
    if (req.url().startsWith("https://connect.facebook.net/")) {
      return route.fulfill({ contentType: "application/javascript", body: META_STUB });
    }
    return route.fulfill({ status: 204, body: "" });
  });
  const page = await context.newPage();
  if (opts.clock) await page.clock.install();
  await page.goto(`http://site.test${url}`);
  return { page, checkouts, close: () => context.close() };
}

const wheelEvents = (page: Page) =>
  page.evaluate(() => (window as unknown as { __wheel: Record<string, unknown>[] }).__wheel);

/** Ângulo atual do disco (graus) a partir da transformação aplicada. */
const discAngle = (page: Page) =>
  page.$eval("[data-os-wh-disc]", (el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return (Math.atan2(m.b, m.a) * 180) / Math.PI;
  });

const visible = (page: Page, sel: string) => page.locator(sel).first().isVisible();

describe("roleta na página", () => {
  it("celular: sorteia antes, gira até a fatia sorteada e mostra prêmio, cupom e o Resgatar com o os_premio", async () => {
    // 0.5 → pesos 40/20/30/10: fatia 2 (índice 1), “30% OFF” com cupom.
    const site = await open(WHEEL_PATH, { random: 0.5 });
    const { page } = site;
    expect(await visible(page, "[data-os-wh-spin]")).toBe(true);
    expect(await visible(page, ".os-wh-nojs")).toBe(false);
    expect(await visible(page, "[data-os-wh-result]")).toBe(false);
    expect(await page.locator("[data-os-wh-disc] svg path[fill]").count()).toBe(4);

    const t0 = Date.now();
    await page.locator("[data-os-wh-spin]").tap();
    // O sorteio já aconteceu e foi guardado antes da animação acabar.
    expect(await wheelEvents(page)).toEqual([{ kind: "spin", prize: "30% OFF", won: true, track: true }]);
    expect(await page.locator("[data-os-wh-spin]").isDisabled()).toBe(true);
    expect(await page.locator(".os-wh-sr").textContent()).toBe("Girando a roleta…");
    await page.waitForTimeout(1500);
    expect(await visible(page, "[data-os-wh-result]")).toBe(false);
    await expect.poll(() => visible(page, "[data-os-wh-result]"), { timeout: 8000 }).toBe(true);
    // Desacelera por ~5 s (4 a 6 s).
    expect(Date.now() - t0).toBeGreaterThan(4000);
    expect(Date.now() - t0).toBeLessThan(7500);
    expect(sliceAt(await discAngle(page), 4)).toBe(1);

    expect(await page.locator("[data-os-wh-prize]").textContent()).toBe("30% OFF");
    expect(await visible(page, "[data-os-wh-win]")).toBe(true);
    expect(await visible(page, "[data-os-wh-lose]")).toBe(false);
    expect(await page.locator("[data-os-wh-code]").textContent()).toBe("ROLETA30");
    expect(await visible(page, "[data-os-wh-coupon]")).toBe(true);
    expect(await visible(page, "[data-os-wh-spin]")).toBe(false);
    expect(await page.locator(".os-wh-sr").textContent()).toBe("Você ganhou 30% OFF! Seu cupom: ROLETA30.");
    expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-os-wh-go"))).toBe(true);
    // Confete (some sozinho) e sem rolagem lateral no celular.
    expect(await page.locator(".os-wh-cf i").count()).toBeGreaterThan(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

    // Prêmio guardado; visibilidade "só para quem ganhou" ligada na própria roleta.
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("os_premio") ?? "null"));
    expect(saved).toMatchObject({ k: prizeId(SLICES[1]) });
    expect(saved.u).toBeGreaterThan(t0 + 7 * DAY - 60_000);
    expect(saved.u).toBeLessThan(t0 + 7 * DAY + 60_000);
    expect(await page.evaluate(() => document.documentElement.classList.contains("os-premio-on"))).toBe(true);

    const href = (await page.locator("[data-os-wh-go]").getAttribute("href")) ?? "";
    expect(href).toBe(`${SALES_PATH}?os_premio=${prizeParam(prizeId(SLICES[1]), saved.u)}`);

    // Resgatar: avisa os pixels e leva o prêmio à página de vendas.
    await page.locator("[data-os-wh-go]").tap({ force: true });
    await page.waitForURL((u) => u.pathname === SALES_PATH);
    await expect.poll(() => page.locator(".os-pz").count()).toBe(1);
    expect(new URL(page.url()).searchParams.get("os_premio")).toBeNull();
    await site.close();
  }, 40_000);

  it("uma vez por visitante: quem volta vê a roda parada no prêmio, com o resultado e o botão", async () => {
    const site = await open(WHEEL_PATH, { random: 0.05 });
    const { page } = site;
    await page.locator("[data-os-wh-spin]").tap();
    await expect.poll(() => visible(page, "[data-os-wh-result]"), { timeout: 8000 }).toBe(true);
    expect(await page.locator("[data-os-wh-prize]").textContent()).toBe("10% OFF");
    const href = await page.locator("[data-os-wh-go]").getAttribute("href");

    await page.reload();
    // Na hora, sem animação nem confete, sem novo giro.
    expect(await visible(page, "[data-os-wh-result]")).toBe(true);
    expect(await visible(page, "[data-os-wh-spin]")).toBe(false);
    expect(await page.locator(".os-wh-cf").count()).toBe(0);
    expect(sliceAt(await discAngle(page), 4)).toBe(0);
    expect(await page.locator("[data-os-wh-prize]").textContent()).toBe("10% OFF");
    expect(await page.locator("[data-os-wh-go]").getAttribute("href")).toBe(href);
    expect(await wheelEvents(page)).toEqual([]);
    expect(await visible(page, "[data-os-wh-coupon]")).toBe(false);
    await site.close();
  }, 30_000);

  it("fatia sem prêmio: texto de “não foi dessa vez” e o botão continua para a oferta, sem prêmio", async () => {
    // 0.65 → fatia 3 (índice 2), sem prêmio.
    const site = await open(WHEEL_PATH, { random: 0.65 });
    const { page } = site;
    await page.locator("[data-os-wh-spin]").tap();
    await expect.poll(() => visible(page, "[data-os-wh-result]"), { timeout: 8000 }).toBe(true);
    expect(sliceAt(await discAngle(page), 4)).toBe(2);
    expect(await visible(page, "[data-os-wh-lose]")).toBe(true);
    expect(await visible(page, "[data-os-wh-win]")).toBe(false);
    expect(await visible(page, "[data-os-wh-prize]")).toBe(false);
    expect(await page.locator("[data-os-wh-go]").textContent()).toBe("CONTINUAR PARA A OFERTA");
    expect(await page.locator("[data-os-wh-go]").getAttribute("href")).toBe(SALES_PATH);
    expect(await page.locator(".os-wh-cf").count()).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem("os_premio"))).toBeNull();
    expect(await page.evaluate(() => document.documentElement.classList.contains("os-premio-on"))).toBe(false);
    expect(await wheelEvents(page)).toEqual([{ kind: "spin", prize: "Não foi dessa vez", won: false, track: true }]);
    // Sem a observação "Seu desconto fica reservado…" (quem perdeu não tem desconto).
    expect(await page.locator(".os-wh-note").count()).toBe(1);
    expect(await visible(page, ".os-wh-note")).toBe(false);
    // "Continuar para a oferta" não conta como resgate do prêmio.
    await page.evaluate(() => document.addEventListener("click", (e) => e.preventDefault()));
    await page.locator("[data-os-wh-go]").tap({ force: true });
    expect(await wheelEvents(page)).toEqual([{ kind: "spin", prize: "Não foi dessa vez", won: false, track: true }]);
    await site.close();
  }, 30_000);

  it("quem ganhou continua vendo a observação do desconto", async () => {
    const site = await open(WHEEL_PATH, {
      random: 0.05,
      context: { viewport: { width: 390, height: 844 }, reducedMotion: "reduce" },
    });
    await site.page.locator("[data-os-wh-spin]").click();
    await expect.poll(() => visible(site.page, "[data-os-wh-result]"), { timeout: 3000 }).toBe(true);
    expect(await visible(site.page, ".os-wh-note")).toBe(true);
    await site.close();
  }, 30_000);

  it("computador, teclado e menos movimento: Enter gira, sem animação nem confete, resultado anunciado", async () => {
    const site = await open(WHEEL_PATH, {
      random: 0.95,
      context: { viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" },
    });
    const { page } = site;
    await page.locator("[data-os-wh-spin]").focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => visible(page, "[data-os-wh-result]"), { timeout: 1500 }).toBe(true);
    expect(sliceAt(await discAngle(page), 4)).toBe(3);
    expect(await page.locator("[data-os-wh-prize]").textContent()).toBe("50% OFF");
    expect(await page.locator(".os-wh-cf").count()).toBe(0);
    expect(await page.locator(".os-wh-sr").getAttribute("aria-live")).toBe("polite");
    expect(await page.locator(".os-wh-sr").textContent()).toBe("Você ganhou 50% OFF!");
    await page.keyboard.press("Enter");
    await page.waitForURL((u) => u.pathname === SALES_PATH);
    await site.close();
  }, 30_000);

  it("sem JavaScript: a roda desenhada e um aviso discreto; sem “Girar” nem resultado", async () => {
    const site = await open(WHEEL_PATH, {
      context: { javaScriptEnabled: false, viewport: { width: 390, height: 844 } },
    });
    const { page } = site;
    expect(await page.locator("[data-os-wh-disc] svg path[fill]").count()).toBe(4);
    expect(await visible(page, ".os-wh-nojs")).toBe(true);
    expect(await page.locator(".os-wh-nojs").textContent()).toBe(
      "Para girar a roleta, ative o JavaScript do seu navegador.",
    );
    expect(await visible(page, "[data-os-wh-spin]")).toBe(false);
    expect(await visible(page, "[data-os-wh-result]")).toBe(false);
    await site.close();
  });
});

describe("prêmio na página de vendas", () => {
  const valid = () => prizeParam(prizeId(SLICES[1]), Date.now() + 2 * DAY);

  it("botões de checkout com o link do prêmio (UTMs, versão A/B e InitiateCheckout), faixa com contador e visibilidade", async () => {
    const site = await open(`${SALES_PATH}?utm_source=facebook&utm_campaign=roleta&os_premio=${valid()}`, {
      clock: true,
    });
    const { page } = site;
    // O endereço fica limpo, as UTMs ficam.
    const now = new URL(page.url());
    expect(now.searchParams.get("os_premio")).toBeNull();
    expect(now.searchParams.get("utm_source")).toBe("facebook");

    const buttons = page.locator('[data-os-link="checkout"]');
    expect(await buttons.count()).toBeGreaterThan(1);
    for (const href of await buttons.evaluateAll((els) => els.map((e) => e.getAttribute("href")))) {
      expect(href).toBe("https://pay.exemplo.com/trinta");
    }
    expect(await page.locator(".os-pz-msg").textContent()).toBe(
      "🎉 Você ganhou 30% OFF — seu desconto está reservado por 10:00",
    );
    expect(await page.locator(".os-pz-cp code").textContent()).toBe("ROLETA30");
    expect(await visible(page, "#so-ganhou")).toBe(true);
    expect(await visible(page, "#so-nao")).toBe(false);
    // A faixa não cobre o topo da página.
    const bar = await page.locator(".os-pz").boundingBox();
    const spacer = await page.locator(".os-pz-sp").boundingBox();
    expect(Math.round(spacer?.height ?? 0)).toBe(Math.round(bar?.height ?? -1));

    await page.clock.runFor(61_000);
    expect(await page.locator(".os-pz-t").textContent()).toBe("08:59");
    // Zerou: o desconto continua (texto muda, botões continuam no prêmio).
    await page.clock.runFor(10 * 60_000);
    expect(await page.locator(".os-pz-msg").textContent()).toBe(
      "🎉 Seu desconto de 30% OFF continua reservado — aproveite agora",
    );
    expect(await buttons.first().getAttribute("href")).toBe("https://pay.exemplo.com/trinta");

    // (o botão pulsa: sem esperar ficar parado)
    // Clique de verdade no botão (ele pulsa e o relógio é de mentira: nunca "para").
    await page
      .locator('[data-os-link="checkout"]:visible')
      .nth(1)
      .evaluate((el) => (el as HTMLElement).click());
    // (o relógio é de mentira: a espera pelo pixel antes de sair precisa andar)
    await page.clock.runFor(2000);
    await expect.poll(() => site.checkouts.length).toBe(1);
    const checkout = new URL(site.checkouts[0]);
    expect(checkout.origin + checkout.pathname).toBe("https://pay.exemplo.com/trinta");
    expect(checkout.searchParams.get("utm_source")).toBe("facebook");
    expect(checkout.searchParams.get("utm_campaign")).toBe("roleta");
    expect(checkout.searchParams.get("utm_content")).toBe("versao-b");
    expect(checkout.searchParams.get("os_premio")).toBeNull();
    await site.close();
  }, 40_000);

  it("InitiateCheckout continua saindo no botão trocado; voltar depois (sem o parâmetro) mantém o prêmio e o contador", async () => {
    const site = await open(`${SALES_PATH}?os_premio=${valid()}`);
    const { page } = site;
    await expect.poll(() => page.locator(".os-pz").count()).toBe(1);
    await page.evaluate(() => {
      // Fica na página para ver o evento (o checkout abriria fora).
      document.addEventListener("click", (e) => e.preventDefault());
    });
    await page.locator('[data-os-link="checkout"]:visible').nth(1).click({ force: true });
    await expect
      .poll(() =>
        page.evaluate(() =>
          ((window as { __calls?: unknown[][] }).__calls ?? []).filter((c) => c[1] === "track").map((c) => c[2]),
        ),
      )
      .toContain("InitiateCheckout");
    await page.goto(`http://site.test${SALES_PATH}`);
    expect(await page.locator('[data-os-link="checkout"]').first().getAttribute("href")).toBe(
      "https://pay.exemplo.com/trinta",
    );
    expect(await page.locator(".os-pz-t").textContent()).toMatch(/^(09:5\d|10:00)$/);
    // Fechar a faixa: some nesta visita; os botões continuam com o desconto.
    await page.getByRole("button", { name: "Fechar o aviso do desconto" }).click();
    expect(await page.locator(".os-pz").count()).toBe(0);
    await page.reload();
    expect(await page.locator(".os-pz").count()).toBe(0);
    expect(await page.locator('[data-os-link="checkout"]').first().getAttribute("href")).toBe(
      "https://pay.exemplo.com/trinta",
    );
    await site.close();
  }, 30_000);

  it("sem prêmio (veio direto do anúncio) nada muda", async () => {
    const site = await open(`${SALES_PATH}?utm_source=facebook`);
    const { page } = site;
    // (o rastreamento completa o link com as UTMs e a versão A/B, como sempre)
    expect(await page.locator('[data-os-link="checkout"]').first().getAttribute("href")).toBe(
      "https://pay.exemplo.com/cheio?utm_source=facebook&utm_content=versao-b",
    );
    expect(await page.locator(".os-pz").count()).toBe(0);
    expect(await visible(page, "#so-ganhou")).toBe(false);
    expect(await visible(page, "#so-nao")).toBe(true);
    await site.close();
  });

  it("prêmio forjado ou vencido é ignorado; validade esticada não passa do prazo da roleta", async () => {
    const forged = await open(`${SALES_PATH}?os_premio=${prizeParam("evil", Date.now() + DAY)}`);
    expect(await forged.page.locator('[data-os-link="checkout"]').first().getAttribute("href")).toMatch(
      /^https:\/\/pay\.exemplo\.com\/cheio(\?|$)/,
    );
    expect(await forged.page.locator(".os-pz").count()).toBe(0);
    // Prêmio guardado que aponta para fora do mapa, ou já vencido: nada.
    await forged.page.evaluate((d) => {
      localStorage.setItem("os_premio", JSON.stringify({ k: d, u: Date.now() - 1000, at: 0 }));
    }, prizeId(SLICES[1]));
    await forged.page.reload();
    expect(await forged.page.locator(".os-pz").count()).toBe(0);
    await forged.page.evaluate(() => {
      localStorage.setItem("os_premio", JSON.stringify({ k: "javascript:alert(1)", u: Date.now() + 9e9, at: 0 }));
    });
    await forged.page.reload();
    expect(await forged.page.locator(".os-pz").count()).toBe(0);
    expect(await forged.page.locator('[data-os-link="checkout"]').first().getAttribute("href")).toMatch(
      /^https:\/\/pay\.exemplo\.com\/cheio(\?|$)/,
    );
    await forged.close();

    const stretched = await open(`${SALES_PATH}?os_premio=${prizeParam(prizeId(SLICES[1]), Date.now() + 400 * DAY)}`);
    const saved = await stretched.page.evaluate(() => JSON.parse(localStorage.getItem("os_premio") ?? "null"));
    expect(saved.u).toBeLessThanOrEqual(Date.now() + 7 * DAY + 1000);
    await stretched.close();
  }, 30_000);

  it("faixa desligada na roleta: botões trocados, sem faixa; sem JavaScript, “só para quem ganhou” fica escondido", async () => {
    const off: WheelRender = {
      ...wheel,
      prizes: Object.fromEntries(Object.entries(wheel.prizes).map(([k, p]) => [k, { ...p, b: 0 }])),
    };
    const site = await open(`${SALES_PATH}?os_premio=${valid()}`, { sales: salesPage(off) });
    expect(await site.page.locator(".os-pz").count()).toBe(0);
    expect(await site.page.locator('[data-os-link="checkout"]').first().getAttribute("href")).toBe(
      "https://pay.exemplo.com/trinta",
    );
    await site.close();

    const nojs = await open(`${SALES_PATH}?os_premio=${valid()}`, {
      context: { javaScriptEnabled: false, viewport: { width: 390, height: 844 } },
    });
    expect(await visible(nojs.page, "#so-ganhou")).toBe(false);
    expect(await visible(nojs.page, "#so-nao")).toBe(true);
    await nojs.close();
  }, 30_000);
});

describe("roleta e checkout na mesma página", () => {
  const desktop = { viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" as const };
  const spinNow = async (page: Page) => {
    await page.locator("[data-os-wh-spin]").click();
    await expect.poll(() => visible(page, "[data-os-wh-result]"), { timeout: 3000 }).toBe(true);
  };

  it("bloco na página de vendas: o botão de compra vai para o checkout do prêmio logo depois do giro, ao voltar e com o os_premio; sem faixa", async () => {
    const site = await open("/combo/", { random: 0.5, context: desktop, routes: { "/combo/": comboHtml } });
    const { page } = site;
    expect(await page.locator("#comprar").getAttribute("href")).toBe("https://pay.exemplo.com/cheio");
    await spinNow(page);
    expect(await page.locator("[data-os-wh-prize]").textContent()).toBe("30% OFF");
    expect(await page.locator("#comprar").getAttribute("href")).toBe("https://pay.exemplo.com/trinta");
    expect(await page.locator(".os-pz").count()).toBe(0);
    // Voltou à página: a roda parada no prêmio e o botão no checkout do prêmio.
    await page.reload();
    expect(await page.locator("#comprar").getAttribute("href")).toBe("https://pay.exemplo.com/trinta");
    expect(await page.locator(".os-pz").count()).toBe(0);
    await page.locator("#comprar").click();
    await expect.poll(() => site.checkouts.length).toBe(1);
    expect(site.checkouts[0]).toBe("https://pay.exemplo.com/trinta");
    await site.close();

    // Chegou com o prêmio no endereço (o "Resgatar" levando para a mesma página).
    const back = await open(`/combo/?os_premio=${prizeParam(prizeId(SLICES[1]), Date.now() + DAY)}`, {
      context: desktop,
      routes: { "/combo/": comboHtml },
    });
    expect(await back.page.locator("#comprar").getAttribute("href")).toBe("https://pay.exemplo.com/trinta");
    expect(await back.page.locator(".os-pz").count()).toBe(0);
    await back.close();
  }, 40_000);

  it("“Resgatar” ligado a um link de checkout da oferta: leva ao checkout do prêmio sorteado, não ao cheio", async () => {
    const site = await open("/go/", { random: 0.5, context: desktop, routes: { "/go/": goCheckoutHtml } });
    const { page } = site;
    expect(await page.locator("[data-os-wh-go]").getAttribute("href")).toBe("https://pay.exemplo.com/cheio");
    await spinNow(page);
    expect(await page.locator("[data-os-wh-prize]").textContent()).toBe("30% OFF");
    expect(await page.locator("[data-os-wh-go]").getAttribute("href")).toBe("https://pay.exemplo.com/trinta");
    // (o botão pulsa: clique direto no elemento)
    await page.locator("[data-os-wh-go]").evaluate((el) => (el as HTMLElement).click());
    await expect.poll(() => site.checkouts.length).toBe(1);
    expect(site.checkouts[0]).toBe("https://pay.exemplo.com/trinta");
    await site.close();

    // Quem caiu em "Sem prêmio" continua indo ao checkout escolhido.
    const lost = await open("/go/", { random: 0.65, context: desktop, routes: { "/go/": goCheckoutHtml } });
    await spinNow(lost.page);
    expect(await lost.page.locator("[data-os-wh-go]").getAttribute("href")).toBe("https://pay.exemplo.com/cheio");
    await lost.close();
  }, 40_000);

  it("“Resgatar” para uma âncora da própria página: só rola até ela (sem recarregar com o os_premio)", async () => {
    const site = await open("/ancora/", { random: 0.5, context: desktop, routes: { "/ancora/": anchorHtml } });
    const { page } = site;
    await spinNow(page);
    expect(await page.locator("[data-os-wh-go]").getAttribute("href")).toBe("#comprar");
    // O botão de compra da página já está no checkout do prêmio.
    expect(await page.locator("#comprar").getAttribute("href")).toBe("https://pay.exemplo.com/trinta");
    await page.evaluate(() => {
      (window as unknown as { __marca: number }).__marca = 1;
    });
    await page.locator("[data-os-wh-go]").evaluate((el) => (el as HTMLElement).click());
    await expect.poll(() => new URL(page.url()).hash).toBe("#comprar");
    expect(await page.evaluate(() => (window as unknown as { __marca?: number }).__marca)).toBe(1);
    await site.close();
  }, 30_000);
});

describe("duas ofertas no mesmo domínio", () => {
  it("o giro e o prêmio de uma oferta não valem na outra (memória separada pelo código da oferta)", async () => {
    const site = await open("/ofa/roleta/", {
      random: 0.5,
      context: { viewport: { width: 390, height: 844 }, reducedMotion: "reduce" },
      routes: scoped,
    });
    const { page } = site;
    await page.locator("[data-os-wh-spin]").click();
    await expect.poll(() => visible(page, "[data-os-wh-result]"), { timeout: 3000 }).toBe(true);
    expect(await page.locator("[data-os-wh-prize]").textContent()).toBe("30% OFF");

    // Página de vendas da outra oferta, direto do anúncio: nada muda.
    await page.goto("http://site.test/ofb/vendas/");
    expect(await page.locator(".os-pz").count()).toBe(0);
    expect(await page.locator('[data-os-link="checkout"]').first().getAttribute("href")).toMatch(
      /^https:\/\/pay\.exemplo\.com\/cheio(\?|$)/,
    );
    expect(await visible(page, "#so-ganhou")).toBe(false);
    // Roleta da outra oferta: dá para girar.
    await page.goto("http://site.test/ofb/roleta/");
    expect(await visible(page, "[data-os-wh-spin]")).toBe(true);
    expect(await page.locator("[data-os-wh-spin]").isDisabled()).toBe(false);
    expect(await visible(page, "[data-os-wh-result]")).toBe(false);

    // A página de vendas da mesma oferta mostra o prêmio (sem o parâmetro: do armazenamento).
    await page.goto("http://site.test/ofa/vendas/");
    await expect.poll(() => page.locator(".os-pz").count()).toBe(1);
    expect(await page.locator('[data-os-link="checkout"]').first().getAttribute("href")).toBe(
      "https://pay.exemplo.com/trinta",
    );
    await site.close();
  }, 40_000);
});

describe("modelo de página “Roleta” publicado direto", () => {
  it("gira com as 4 fatias de exemplo (10/20/30/50% OFF); prêmio ainda sem link não vai para a página de vendas", async () => {
    const template = PAGE_TEMPLATES.find((t) => t.id === "roleta");
    expect(template?.pageType).toBe("OTHER");
    const html = renderPageHtml(template?.html ?? "", {
      links: [],
      pageHref: () => "#",
      runtimeTag: `<script data-os-runtime>${runtimeScript()}</script>`,
    });
    const site = await open(WHEEL_PATH, { random: 0.75 });
    await site.page.route("http://site.test/roleta/", (route) =>
      route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await site.page.reload();
    const { page } = site;
    await page.locator("[data-os-wh-spin]").tap();
    await expect.poll(() => visible(page, "[data-os-wh-result]"), { timeout: 8000 }).toBe(true);
    expect(await page.locator("[data-os-wh-prize]").textContent()).toBe("30% OFF");
    expect(await page.evaluate(() => localStorage.getItem("os_premio"))).toBeNull();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await site.close();
  }, 30_000);
});
