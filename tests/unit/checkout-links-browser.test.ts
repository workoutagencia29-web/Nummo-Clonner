/**
 * Checkout do Offer Studio ligado ao editor e às páginas (Chromium, sem rede):
 *
 * - Editor de verdade (blocos + widgets): o bloco "Botão de checkout" nasce
 *   ligado ao primeiro link "Checkout do Offer Studio" da oferta; sem nenhum,
 *   fica pedindo o link e o "＋ Criar link da oferta…" dele já vem com esse
 *   destino (o do "Botão do checkout", não) — também reaberto do projeto ou
 *   do HTML salvo (data-os-new-link no botão; sai ao ligar, fora da página).
 * - Página de vendas (versão B do teste A/B, com o script das páginas e o de
 *   rastreamento): o botão do checkout do Offer Studio leva à página de
 *   checkout com ?os_versao=B e as UTMs (sem InitiateCheckout no clique: a
 *   página de checkout conta ao abrir); o prêmio da roleta que é um checkout
 *   do Offer Studio troca os botões de compra pela página de checkout do
 *   prêmio, e o botão passa a ser desse link; prêmio forjado com endereço de
 *   fora do site é ignorado.
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defToHtml } from "@/editor/widgets/quiz-content";
import { DEFAULT_WHEEL, wheelDef } from "@/editor/widgets/wheel-content";
import { finalizeFromEditor, prepareForEditor } from "@/lib/editor-html";
import { renderPageHtml } from "@/lib/page-render";
import { renderLinks } from "@/lib/payments/links";
import { runtimeScript, trackingScript } from "@/lib/runtime-bundle";
import { TRACKING_SCRIPT_ATTR, type TrackingRuntimeConfig } from "@/lib/tracking/runtime-config";
import { DEFAULT_FORWARD_PARAMS, PIXEL_VENDORS, TRACKING_EVENTS } from "@/lib/tracking/schema";
import { vendorEventName } from "@/lib/tracking/vendors";
import { type PrizeMap, prizeId, prizeParam, type WheelSlice } from "@/lib/wheel";
import { type WheelRender, wheelRenderData } from "@/lib/wheel-prizes";
import { addBlock, type EditorWindow, editorOutput, openEditor, pageErrors, setTrait } from "./blocks-harness";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

describe("editor: bloco “Botão de checkout”", () => {
  it("nasce ligado ao primeiro link “Checkout do Offer Studio” (o “Botão do checkout” segue no primeiro de checkout)", async () => {
    const page = await openEditor(browser, {
      links: [
        { key: "hotmart", label: "Hotmart", kind: "CHECKOUT" },
        { key: "upsell-proprio", label: "Upsell", kind: "UPSELL", checkout: "" },
        { key: "proprio", label: "Checkout próprio", kind: "CHECKOUT", checkout: "Curso · R$ 97,00" },
      ],
    });
    // No painel de blocos, a dica diz o que o bloco faz (o nome é parecido com o do "Botão do checkout").
    const hint = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#blocks [title]"))
        .map((e) => e.getAttribute("title") ?? "")
        .find((t) => t.includes("Offer Studio")),
    );
    expect(hint).toBe(
      "Leva à página de checkout do Offer Studio (PIX em real; Kyvo nas outras moedas), montada em “Links e checkouts”.",
    );
    await addBlock(page, "cta-checkout-proprio");
    await addBlock(page, "cta-checkout");
    const { html } = await editorOutput(page);
    expect(html).toMatch(/<a[^>]*data-os-link="proprio"[^>]*>COMPRAR AGORA<\/a>/);
    expect(html).toMatch(/<a[^>]*data-os-link="hotmart"[^>]*>QUERO COMPRAR AGORA<\/a>/);
    const project = await page.evaluate(() => JSON.stringify((window as unknown as EditorWindow).ed.getProjectData()));
    expect(project).not.toContain("osAutoLink");
    expect(project).not.toContain("OWN_CHECKOUT");
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it("sem checkout do Offer Studio na oferta: pede o link, e o “＋ Criar link da oferta…” já vem com esse destino", async () => {
    const page = await openEditor(browser, { links: [{ key: "hotmart", label: "Hotmart", kind: "CHECKOUT" }] });
    await page.evaluate(() => {
      const w = window as unknown as EditorWindow & { __reqs: { kind: string; target?: string; id: string }[] };
      w.__reqs = [];
      w.OS.installNewLinkOption(w.ed, (req) =>
        w.__reqs.push({ kind: req.kind, target: req.target, id: req.component.getId() }),
      );
    });
    const own = await addBlock(page, "cta-checkout-proprio");
    const plain = await addBlock(page, "cta-checkout");
    const { html } = await editorOutput(page);
    expect(html).toMatch(/<a[^>]*data-os-link=""[^>]*>COMPRAR AGORA<\/a>/);
    const ask = (id: string) =>
      page.evaluate((cid) => {
        const ed = (window as unknown as EditorWindow).ed;
        const box = ed.getWrapper()?.find(`#${cid}`)[0];
        const button = box?.find("a")[0];
        button?.addAttributes({ "data-os-link": "__novo-link__" });
      }, id);
    await ask(own);
    await ask(plain);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __reqs: unknown[] }).__reqs.length)).toBe(2);
    const reqs = await page.evaluate(
      () => (window as unknown as { __reqs: { kind: string; target?: string }[] }).__reqs,
    );
    expect(reqs.map((r) => [r.kind, r.target])).toEqual([
      ["CHECKOUT", "CHECKOUT"],
      ["CHECKOUT", "URL"],
    ]);
    // O valor volta ao de antes (o pedido não grava nada no botão).
    expect((await editorOutput(page)).html).not.toContain("__novo-link__");
    await page.close();
  });

  it("a preferência fica no botão: reaberto do projeto ou do HTML salvo, o “＋ Criar link da oferta…” ainda vem com o checkout; ligar tira a marca (o Desfazer devolve) e a página publicada não a leva", async () => {
    const LINKS = [{ key: "hotmart", label: "Hotmart", kind: "CHECKOUT" }];
    const page = await openEditor(browser, { links: LINKS });
    await addBlock(page, "cta-checkout-proprio");
    await addBlock(page, "cta-checkout");
    const out = await editorOutput(page);
    // Só o "Botão de checkout" guarda a preferência; é um atributo (nada de texto nem de estilo).
    expect(out.html.match(/data-os-new-link="checkout"/g)).toHaveLength(1);
    expect(out.html).toMatch(/<a[^>]*data-os-new-link="checkout"[^>]*>COMPRAR AGORA<\/a>/);
    expect(out.css).not.toContain("new-link");
    const project = await page.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData());
    const saved = finalizeFromEditor(out.html, out.css);
    expect(saved).toContain('data-os-new-link="checkout"');
    await page.close();

    /** Pede "＋ Criar link da oferta…" nos dois botões e devolve o destino sugerido de cada um. */
    const targets = async (p: Page) => {
      await p.evaluate(() => {
        const w = window as unknown as EditorWindow & { __reqs: (string | undefined)[] };
        w.__reqs = [];
        w.OS.installNewLinkOption(w.ed, (req) => w.__reqs.push(req.target));
        for (const a of w.ed.getWrapper()?.find("a.os-btn") ?? []) a.addAttributes({ "data-os-link": "__novo-link__" });
      });
      await expect.poll(() => p.evaluate(() => (window as unknown as { __reqs: unknown[] }).__reqs.length)).toBe(2);
      return p.evaluate(() => (window as unknown as { __reqs: (string | undefined)[] }).__reqs);
    };

    // Reaberto do projeto salvo.
    const fromProject = await openEditor(browser, { links: LINKS, project });
    expect(await targets(fromProject)).toEqual(["CHECKOUT", "URL"]);
    expect(pageErrors(fromProject)).toEqual([]);
    await fromProject.close();

    // Reaberto do HTML salvo (como o editor abre uma página sem projeto).
    const fromHtml = await openEditor(browser, { links: LINKS });
    await fromHtml.evaluate((html) => {
      const w = window as unknown as EditorWindow;
      w.OS.importPageHtml(w.ed, html);
    }, prepareForEditor(saved).html);
    expect(await targets(fromHtml)).toEqual(["CHECKOUT", "URL"]);

    // Ligado a um link (qualquer um): a preferência sai; o Desfazer devolve as duas coisas juntas.
    const own = () =>
      fromHtml.evaluate(() => {
        const a = (window as unknown as EditorWindow).ed.getWrapper()?.find("a.os-btn")[0];
        const at = a?.getAttributes() ?? {};
        return { link: at["data-os-link"], want: at["data-os-new-link"] };
      });
    await expect.poll(own).toEqual({ link: "", want: "checkout" });
    await fromHtml.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.getWrapper()?.find("a.os-btn")[0].addAttributes({ "data-os-link": "hotmart" });
    });
    expect(await own()).toEqual({ link: "hotmart", want: undefined });
    await fromHtml.evaluate(() => (window as unknown as EditorWindow).ed.UndoManager.undo());
    expect(await own()).toEqual({ link: "", want: "checkout" });
    // Endereço digitado no lugar do link da oferta: o botão não pede mais link, a preferência sai.
    await setTrait(fromHtml, "a.os-btn", "href", "https://pay.exemplo.com/x");
    expect(await own()).toEqual({ link: undefined, want: undefined });
    expect(pageErrors(fromHtml)).toEqual([]);
    await fromHtml.close();

    // A página publicada (prévia e ZIP passam pelo renderPageHtml) não leva a marca do editor.
    const html = renderPageHtml(saved, { links: [], pageHref: (id) => `/p/${id}`, runtimeTag: "" });
    expect(html).toMatch(/<a[^>]*data-os-link=""[^>]*>COMPRAR AGORA<\/a>/);
    expect(html).not.toContain("data-os-new-link");
  });
});

// ─── Página de vendas ────────────────────────────────────────────────────────

const ORIGIN = "http://loja.test";
const SALES_PATH = "/vendas/";
const DAY = 864e5;

/** Linhas do banco como o render as recebe: Hotmart, dois checkouts do Offer Studio e um prêmio de fora. */
const ROWS = [
  {
    key: "checkout",
    url: "https://pay.exemplo.com/cheio",
    kind: "CHECKOUT",
    target: "URL",
    payment: null,
    checkout: null,
  },
  { key: "c10", url: "https://pay.exemplo.com/dez", kind: "CHECKOUT", target: "URL", payment: null, checkout: null },
  { key: "proprio", url: "", kind: "CHECKOUT", target: "CHECKOUT", payment: null, checkout: { id: "p" } },
  { key: "proprio-30", url: "", kind: "CHECKOUT", target: "CHECKOUT", payment: null, checkout: { id: "p30" } },
] as Parameters<typeof renderLinks>[0];
const LINKS = renderLinks(ROWS, { checkoutHref: (key) => `/checkout/${key}` });

const SLICES: WheelSlice[] = [
  { text: "10% OFF", color: "#7c3aed", chance: 40, link: "c10", coupon: "" },
  { text: "30% OFF", color: "#ec4899", chance: 20, link: "proprio-30", coupon: "" },
  { text: "Não foi dessa vez", color: "#64748b", chance: 40, link: "", coupon: "", lose: true },
];

const NAMES = Object.fromEntries(
  PIXEL_VENDORS.map((v) => [v, Object.fromEntries(TRACKING_EVENTS.map((e) => [e, vendorEventName(v, e)]))]),
) as TrackingRuntimeConfig["names"];

/** Versão B, Meta, InitiateCheckout no clique do checkout; os links do checkout do Offer Studio não contam (como compose). */
const CONFIG: TrackingRuntimeConfig = {
  v: 1,
  mode: "live",
  pixels: [{ vendor: "META", id: "123456789012345", options: {} }],
  rules: [{ event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK", value: null, selector: null }],
  names: NAMES,
  value: { currency: "BRL", amount: null },
  checkoutLinkKeys: ["checkout", "c10"],
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

/** Meta trocada por um gravador (as chamadas ficam no teste, mesmo depois de sair da página). */
const META_STUB = `(function(){var q=fbq.queue.slice();fbq.queue.length=0;
  fbq.callMethod=function(){window.__rec(JSON.stringify([].slice.call(arguments)))};
  q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`;

const wheelHtml = `<!doctype html><html><head><title>R</title></head><body>${defToHtml(
  wheelDef({ ...DEFAULT_WHEEL, slices: SLICES }, { html: true }),
)}</body></html>`;

function salesHtml(wheel: WheelRender, config: TrackingRuntimeConfig = CONFIG) {
  const html = `<!doctype html><html><head><title>Vendas</title></head><body>
    <a id="hotmart" class="os-btn" href="#" data-os-link="checkout">COMPRAR</a>
    <a id="proprio" class="os-btn" href="#" data-os-link="proprio">COMPRAR NO CHECKOUT PRÓPRIO</a>
    <a id="clonado" href="https://pay.hotmart.com/X123" data-os-checkout="1" data-os-link="proprio">COMPRAR (CLONADO)</a>
    <a id="clonado-h" href="https://pay.hotmart.com/ORIGINAL" data-os-checkout="1" data-os-link="checkout">COMPRAR (CLONADO, HOTMART)</a>
  </body></html>`;
  return renderPageHtml(html, {
    links: LINKS,
    wheel,
    pageHref: () => "#",
    runtimeTag: `<script data-os-runtime>${runtimeScript()}</script>`,
    tracking: { config, scriptTag: `<script ${TRACKING_SCRIPT_ATTR}>${trackingScript()}</script>` },
  });
}

async function open(html: string, query: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const visited: string[] = [];
  const errors: string[] = [];
  const calls: unknown[][] = [];
  await context.exposeBinding("__rec", (_src, json: string) => {
    calls.push(JSON.parse(json));
  });
  await context.route("**/*", (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const page = (body: string) => route.fulfill({ contentType: "text/html; charset=utf-8", body });
    if (u.origin === ORIGIN && u.pathname === SALES_PATH) return page(html);
    if (u.origin === ORIGIN || u.hostname === "pay.exemplo.com") {
      visited.push(req.url());
      return page("<!doctype html><title>Checkout</title><h1>Checkout</h1>");
    }
    if (req.url().startsWith("https://connect.facebook.net/")) {
      return route.fulfill({ contentType: "application/javascript", body: META_STUB });
    }
    return route.fulfill({ status: 204, body: "" });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${ORIGIN}${SALES_PATH}${query}`);
  const initiateCheckouts = () => calls.filter((c) => c[0] === "track" && c[1] === "InitiateCheckout");
  return { page, visited, errors, initiateCheckouts, close: () => context.close() };
}

const attrs = (page: Page, sel: string) =>
  page.$eval(sel, (el) => ({ href: el.getAttribute("href"), link: el.getAttribute("data-os-link") }));

describe("página de vendas (versão B) com o checkout do Offer Studio", () => {
  const wheel = wheelRenderData([wheelHtml], LINKS, "oferta00000000000000001");

  it("o botão leva à página de checkout com a versão e as UTMs, sem InitiateCheckout no clique", async () => {
    const s = await open(salesHtml(wheel), "?utm_source=facebook&utm_campaign=lancamento");
    const { page } = s;
    await expect.poll(async () => (await attrs(page, "#proprio")).href).toContain("utm_source=facebook");
    const href = new URL((await attrs(page, "#proprio")).href ?? "", ORIGIN);
    expect(href.pathname).toBe("/checkout/proprio");
    expect(href.searchParams.get("os_versao")).toBe("B");
    expect(href.searchParams.get("utm_campaign")).toBe("lancamento");
    // A marca "versao-b" é dos checkouts de fora (a página de checkout recebe os_versao).
    expect(href.searchParams.get("utm_content")).toBeNull();
    await page.locator("#proprio").click();
    await expect.poll(() => s.visited.length).toBe(1);
    expect(new URL(s.visited[0]).pathname).toBe("/checkout/proprio");
    // A Meta carregou (PageView), mas o clique não contou InitiateCheckout.
    expect(s.initiateCheckouts()).toEqual([]);
    expect(s.errors).toEqual([]);
    await s.close();
  }, 30_000);

  it("prêmio da roleta no checkout do Offer Studio: os botões de compra vão à página de checkout do prêmio", async () => {
    const until = Date.now() + DAY;
    const s = await open(salesHtml(wheel), `?utm_source=facebook&os_premio=${prizeParam(prizeId(SLICES[1]), until)}`);
    const { page } = s;
    await expect.poll(async () => (await attrs(page, "#hotmart")).link).toBe("proprio-30");
    for (const sel of ["#hotmart", "#proprio"]) {
      const a = await attrs(page, sel);
      expect(a.link).toBe("proprio-30");
      const url = new URL(a.href ?? "", ORIGIN);
      expect(url.origin + url.pathname).toBe(`${ORIGIN}/checkout/proprio-30`);
      expect(url.searchParams.get("os_versao")).toBe("B");
      expect(url.searchParams.get("utm_content")).toBeNull();
    }
    // O botão que era da Hotmart agora é do checkout do Offer Studio: o clique não conta InitiateCheckout.
    await page.locator("#hotmart").click();
    await expect.poll(() => s.visited.length).toBe(1);
    // No clique, o rastreamento completa com as UTMs (como num link do funil), sem a marca "versao-b".
    const went = new URL(s.visited[0]);
    expect(went.pathname).toBe("/checkout/proprio-30");
    expect(went.searchParams.get("os_versao")).toBe("B");
    expect(went.searchParams.get("utm_source")).toBe("facebook");
    expect(went.searchParams.get("utm_content")).toBeNull();
    expect(s.errors).toEqual([]);

    expect(s.initiateCheckouts()).toEqual([]);
    await s.close();

    // Prêmio de fora (Hotmart) continua como sempre: endereço do prêmio, marca da versão e InitiateCheckout.
    const other = await open(salesHtml(wheel), `?os_premio=${prizeParam(prizeId(SLICES[0]), until)}`);
    await expect.poll(async () => (await attrs(other.page, "#hotmart")).href).toContain("pay.exemplo.com/dez");
    expect((await attrs(other.page, "#hotmart")).link).toBe("checkout");
    await other.page.locator("#hotmart").click();
    await expect.poll(() => other.visited.length).toBe(1);
    expect(other.visited[0]).toBe("https://pay.exemplo.com/dez?utm_content=versao-b");
    expect(other.initiateCheckouts()).toHaveLength(1);
    await other.close();
  }, 30_000);

  it("botão de página clonada ligado ao checkout do Offer Studio: sem InitiateCheckout no clique, UTMs como link do funil", async () => {
    // "Repassar para o checkout" desligado: só os links do funil recebem os parâmetros.
    const config = { ...CONFIG, forwarding: { ...CONFIG.forwarding, toCheckout: false } };
    const s = await open(salesHtml(wheel, config), "?utm_source=fb&fbclid=abc");
    const { page } = s;
    expect(await page.$eval("#clonado", (el) => el.hasAttribute("data-os-checkout"))).toBe(false);
    await page.locator("#clonado").click();
    await expect.poll(() => s.visited.length).toBe(1);
    const went = new URL(s.visited[0]);
    expect(went.pathname).toBe("/checkout/proprio");
    expect(went.searchParams.get("os_versao")).toBe("B");
    expect(went.searchParams.get("utm_source")).toBe("fb");
    expect(went.searchParams.get("fbclid")).toBe("abc");
    expect(went.searchParams.get("utm_content")).toBeNull();
    expect(s.initiateCheckouts()).toEqual([]);
    expect(s.errors).toEqual([]);
    await s.close();
  }, 30_000);

  it("prêmio do checkout do Offer Studio num botão clonado de checkout de fora: perde a marca e não conta InitiateCheckout", async () => {
    const until = Date.now() + DAY;
    const s = await open(salesHtml(wheel), `?utm_source=facebook&os_premio=${prizeParam(prizeId(SLICES[1]), until)}`);
    const { page } = s;
    await expect.poll(async () => (await attrs(page, "#clonado-h")).link).toBe("proprio-30");
    expect(await page.$eval("#clonado-h", (el) => el.hasAttribute("data-os-checkout"))).toBe(false);
    await page.locator("#clonado-h").click();
    await expect.poll(() => s.visited.length).toBe(1);
    const went = new URL(s.visited[0]);
    expect(went.pathname).toBe("/checkout/proprio-30");
    expect(went.searchParams.get("utm_content")).toBeNull();
    expect(s.initiateCheckouts()).toEqual([]);
    await s.close();
  }, 30_000);

  it("prêmio forjado no mapa com endereço de fora do site é ignorado", async () => {
    const bad: PrizeMap = {
      "fora-x1": { u: "//evil.example/x", o: "proprio-30", t: "99% OFF", c: "", d: 7, m: 0, b: 0 },
      "fora-x2": { u: "javascript:alert(1)", o: "proprio-30", t: "98% OFF", c: "", d: 7, m: 0, b: 0 },
    };
    for (const id of Object.keys(bad)) {
      const s = await open(salesHtml({ ...wheel, prizes: bad }), `?os_premio=${prizeParam(id, Date.now() + DAY)}`);
      await s.page.waitForLoadState("load");
      const a = await attrs(s.page, "#hotmart");
      expect(a.link).toBe("checkout");
      expect(a.href?.startsWith("https://pay.exemplo.com/cheio")).toBe(true);
      expect(await s.page.evaluate(() => document.documentElement.classList.contains("os-premio-on"))).toBe(false);
      await s.close();
    }
  }, 30_000);
});
