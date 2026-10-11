/**
 * Página do produto publicada (Chromium, mesmo HTML da prévia/ZIP com os
 * scripts das páginas), a partir do modelo "Página do produto":
 *
 * - o script da página do produto vai à parte (só nas páginas com galeria,
 *   caixa de compra ou "Voltar para a loja") — o script de todas as páginas
 *   não cresce;
 * - galeria: miniatura mostra a foto dela (aria-current), a foto grande passa
 *   para a próxima, uma foto só esconde a fileira;
 * - barra de compra no celular: aparece quando o "Comprar agora" sai da tela,
 *   a cópia do botão leva ao mesmo checkout, o WhatsApp e a notificação sobem;
 *   no computador e com a barra desligada, nada;
 * - "‹ Voltar para a loja": volta para a página anterior do site, senão vai
 *   para o logo; com destino, é um link comum.
 */
import * as cheerio from "cheerio";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMatcher, replaceInHtml } from "@/lib/find-replace";
import { renderPageHtml } from "@/lib/page-render";
import {
  hasProductPage,
  injectProductScript,
  PRODUCT_SCRIPT_ATTR,
  PRODUCT_SCRIPT_TAG,
  productScript,
  runtimeScript,
} from "@/lib/runtime-bundle";
import { templateHtml } from "@/server/services/page-templates";
import { openSite } from "./blocks-harness";

const NOW = new Date("2026-10-07T15:00:00Z");
const CHECKOUT = "http://site.test/checkout";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** Foto de teste (SVG de uma cor, para saber qual miniatura está na foto grande). */
const photo = (color: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${color}"/></svg>`)}`;
const COLORS = ["#ef4444", "#22c55e", "#3b82f6", "#eab308"];

/**
 * Modelo "Página do produto" publicado: fotos diferentes nas miniaturas, o
 * "Comprar agora" e o carrinho ligados ao checkout. `edit` mexe no HTML salvo.
 */
function productPage(edit?: ($: cheerio.CheerioAPI) => void) {
  const $ = cheerio.load(templateHtml("produto", "Fone de ouvido", NOW));
  $(".os-pg-thumb img").each((i, el) => {
    $(el).attr("src", photo(COLORS[i]));
  });
  $("[data-os-pg-stage] img").attr("src", photo(COLORS[0]));
  $('[data-os-link=""]').attr("data-os-link", "checkout");
  edit?.($);
  return renderPageHtml($.html(), {
    links: [{ key: "checkout", url: CHECKOUT }],
    pageHref: (id) => `/p/${id}`,
    runtimeTag: `<script data-os-runtime>${runtimeScript()}</script>`,
  });
}

/** Abre a página e anota erros. */
async function open(html: string, width: number, opts: Parameters<typeof openSite>[2] = {}) {
  const site = await openSite(browser, html, {
    contextOptions: { viewport: { width, height: 844 } },
    extra: { [CHECKOUT]: "<!doctype html><title>Checkout</title>" },
    ...opts,
  });
  const errors: string[] = [];
  site.page.on("pageerror", (e) => errors.push(e.message));
  return { ...site, errors };
}

describe("script da página do produto", () => {
  it("vai à parte, só nas páginas com galeria, caixa de compra ou “Voltar para a loja”", () => {
    const product = templateHtml("produto", "Fone", NOW);
    expect(hasProductPage(product)).toBe(true);
    expect(hasProductPage(templateHtml("loja", "Loja", NOW))).toBe(false);
    expect(hasProductPage(templateHtml("vendas-longa", "Vendas", NOW))).toBe(false);
    expect(hasProductPage('<a href="#" class="os-pd-back" data-os-pd-back="">Voltar</a>')).toBe(true);

    // Sem tag (testes, prévia antiga): embutido, depois do script das páginas.
    const inline = renderPageHtml(product, {
      links: [],
      pageHref: () => "#",
      runtimeTag: "<script data-os-runtime></script>",
    });
    expect(inline.split(PRODUCT_SCRIPT_ATTR)).toHaveLength(2);
    expect(inline.indexOf("data-os-runtime")).toBeLessThan(inline.indexOf(PRODUCT_SCRIPT_ATTR));
    expect(inline.indexOf(PRODUCT_SCRIPT_ATTR)).toBeLessThan(inline.lastIndexOf("</body>"));
    expect(inject(inline)).toBe(inline);
    // Prévia: o arquivo /os-produto.js.
    const preview = renderPageHtml(product, {
      links: [],
      pageHref: () => "#",
      runtimeTag: "<script data-os-runtime></script>",
      productScriptTag: PRODUCT_SCRIPT_TAG,
    });
    expect(preview).toContain('<script src="/os-produto.js" data-os-product-script></script>');
    // A loja (vitrine) não carrega nada disto.
    const store = renderPageHtml(templateHtml("loja", "Loja", NOW), {
      links: [],
      pageHref: () => "#",
      runtimeTag: "<script data-os-runtime></script>",
      productScriptTag: PRODUCT_SCRIPT_TAG,
    });
    expect(store).not.toContain(PRODUCT_SCRIPT_ATTR);
  });

  it("é pequeno e só ASCII; o script de todas as páginas não leva a página do produto", () => {
    const script = productScript();
    expect(script).toContain("__osProduct");
    // Galeria, barra de compra do celular (uma só para todas as caixas), "Voltar" e o CSS deles: ~5,9 KB (~2,6 KB com gzip).
    expect(script.length).toBeLessThan(6 * 1024);
    expect(script.match(/[\u0080-￿]/g) ?? []).toEqual([]);
    expect(runtimeScript()).not.toContain("os-pb-bar");
    expect(runtimeScript()).not.toContain("os-pg-main");
  });
});

const inject = (html: string) => injectProductScript(html);

describe("galeria na página", () => {
  const state = (page: Page) =>
    page.evaluate(() => {
      const main = document.querySelector(".os-pg-main") as HTMLImageElement;
      const thumbs = Array.from(document.querySelectorAll(".os-pg-thumb"));
      return {
        main: main.getAttribute("src"),
        alt: main.alt,
        current: thumbs.map((t) => t.getAttribute("aria-current")),
      };
    });

  it("miniatura mostra a foto dela; a foto grande passa para a próxima (e volta à primeira)", async () => {
    const site = await open(productPage(), 1280);
    const { page } = site;
    expect(await state(page)).toEqual({
      main: photo(COLORS[0]),
      alt: "Foto 1 do produto",
      current: ["true", null, null, null],
    });
    await page.click(".os-pg-thumb >> nth=2");
    expect(await state(page)).toEqual({
      main: photo(COLORS[2]),
      alt: "Foto 3 do produto",
      current: [null, null, "true", null],
    });
    await page.click(".os-pg-main");
    expect((await state(page)).main).toBe(photo(COLORS[3]));
    await page.click(".os-pg-main");
    expect(await state(page)).toMatchObject({ main: photo(COLORS[0]), current: ["true", null, null, null] });
    // Teclado: a miniatura é um botão.
    await page.focus(".os-pg-thumb >> nth=1");
    await page.keyboard.press("Enter");
    expect((await state(page)).main).toBe(photo(COLORS[1]));
    expect(site.errors).toEqual([]);
    await site.context.close();
  });

  it("uma foto só: a fileira de miniaturas some", async () => {
    const html = productPage(($) => {
      $(".os-pg-thumb").slice(1).remove();
    });
    const site = await open(html, 1280);
    const shown = await site.page.evaluate(
      () => getComputedStyle(document.querySelector(".os-pg-thumb") as Element).display,
    );
    expect(shown).toBe("none");
    expect(site.errors).toEqual([]);
    await site.context.close();
  });
});

describe("barra de compra fixa no celular", () => {
  /** Acrescenta o WhatsApp flutuante e uma notificação de compra à vista (para ver se sobem). */
  const withFloating = ($: cheerio.CheerioAPI) => {
    $("body").append(
      '<a data-os-widget="whatsapp" href="https://wa.me/5511999999999" style="position:fixed;right:14px;bottom:14px;width:56px;height:56px;background:#25d366"></a>' +
        '<div class="os-sn os-show" id="notif" style="height:60px;background:#fff">Maria comprou</div>',
    );
  };
  const bar = (page: Page) =>
    page.evaluate(() => {
      const el = document.querySelector(".os-pb-bar") as HTMLElement | null;
      const wa = document.querySelector('[data-os-widget="whatsapp"]') as HTMLElement | null;
      const sn = document.getElementById("notif");
      return {
        exists: !!el,
        on: !!el && el.classList.contains("os-pb-on") && getComputedStyle(el).visibility === "visible",
        display: el ? getComputedStyle(el).display : null,
        up: document.documentElement.classList.contains("os-pb-up"),
        price: el?.querySelector(".os-pd-now")?.textContent ?? null,
        inst: el?.querySelector(".os-pd-inst")?.textContent ?? null,
        go: el?.querySelector(".os-pb-bar-go")?.textContent ?? null,
        wa: wa ? wa.style.transform : null,
        sn: sn ? Number.parseFloat(getComputedStyle(sn).bottom) : null,
      };
    });
  /** Rola até o "Comprar agora" sair por cima da tela. */
  const pastButton = (page: Page) =>
    page.evaluate(() => {
      const b = document.querySelector(".os-pb-buy") as HTMLElement;
      window.scrollTo(0, b.getBoundingClientRect().bottom + window.scrollY + 40);
    });

  it("aparece quando o “Comprar agora” sai da tela, com o preço e a cópia do botão; WhatsApp e notificação sobem", async () => {
    const site = await open(productPage(withFloating), 390);
    const { page } = site;
    expect(await bar(page)).toMatchObject({ exists: true, on: false, up: false, wa: "" });
    await pastButton(page);
    await expect.poll(async () => (await bar(page)).on).toBe(true);
    const state = await bar(page);
    expect(state).toMatchObject({
      up: true,
      price: "R$ 129,90",
      inst: "12x R$ 10,83 sem juros",
      go: "Comprar agora",
    });
    expect(state.wa).toMatch(/^translateY\(-\d+px\)$/);
    // (a notificação sobe com a transição dela)
    await expect.poll(async () => (await bar(page)).sn).toBeGreaterThan(60);
    // A barra fica embaixo, inteira na tela (depois de subir), e o fim da página não fica escondido atrás dela.
    await page.waitForTimeout(400);
    const box = await page.evaluate(() => {
      const r = (document.querySelector(".os-pb-bar") as HTMLElement).getBoundingClientRect();
      const sp = (document.querySelector(".os-pb-sp") as HTMLElement).getBoundingClientRect();
      return { bottom: Math.round(r.bottom), height: r.height, spacer: sp.height, inner: innerHeight };
    });
    expect(box.bottom).toBe(box.inner);
    expect(box.spacer).toBeGreaterThanOrEqual(box.height);
    // Voltar para cima: a barra some e os botões descem.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => (await bar(page)).on).toBe(false);
    expect(await bar(page)).toMatchObject({ up: false, wa: "" });
    expect(site.errors).toEqual([]);
    await site.context.close();
  });

  it("o clique na cópia é o clique no botão original: vai para o checkout dele", async () => {
    const site = await open(productPage(), 390);
    const { page } = site;
    await pastButton(page);
    await expect.poll(async () => (await bar(page)).on).toBe(true);
    await Promise.all([page.waitForURL(CHECKOUT), page.click(".os-pb-bar-go")]);
    await site.context.close();
  });

  it("várias caixas de compra: uma barra só, da última que passou, e some com algum botão à vista", async () => {
    const html = productPage(($) => {
      const second = $('[data-os-widget="product-buy"]').first().clone();
      second.find(".os-pb-buy").text("Comprar o kit");
      second.find(".os-pd-now").html("R$ 199,90");
      $("main").append('<div style="height:1200px"></div>').append(second).append('<div style="height:1200px"></div>');
      // Uma terceira, escondida (como a de "só para quem ganhou" da roleta): não conta.
      $("main").append($("<div hidden></div>").append(second.clone().find(".os-pb-buy").text("Escondida").end()));
    });
    const site = await open(html, 390);
    const { page } = site;
    const counts = () =>
      page.evaluate(() => [
        document.querySelectorAll(".os-pb-bar").length,
        document.querySelectorAll(".os-pb-sp").length,
      ]);
    expect(await counts()).toEqual([1, 1]);
    // Passou só do 1º botão (o 2º ainda está lá embaixo): a barra é do 1º.
    await pastButton(page);
    await expect.poll(async () => (await bar(page)).on).toBe(true);
    expect(await bar(page)).toMatchObject({ up: true, go: "Comprar agora", price: "R$ 129,90" });
    // Mudar o tamanho da tela (a barra de endereço do celular some) não desliga nada.
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(150);
    expect(await bar(page)).toMatchObject({ on: true, up: true });
    // O 2º botão à vista: a barra some.
    await page.evaluate(() => {
      const b = document.querySelectorAll<HTMLElement>(".os-pb-buy")[1];
      window.scrollTo(0, b.getBoundingClientRect().top + window.scrollY - 300);
    });
    await expect.poll(async () => (await bar(page)).on).toBe(false);
    expect((await bar(page)).up).toBe(false);
    // Passou dos dois: a barra é a do 2º (e só uma).
    await page.evaluate(() => {
      const b = document.querySelectorAll<HTMLElement>(".os-pb-buy")[1];
      window.scrollTo(0, b.getBoundingClientRect().bottom + window.scrollY + 40);
    });
    // (a página rola suave e a barra aparece com transição: espera as duas coisas juntas)
    await expect.poll(async () => ((b) => (b.on ? b.go : null))(await bar(page))).toBe("Comprar o kit");
    expect(await bar(page)).toMatchObject({ on: true, up: true, price: "R$ 199,90" });
    expect(await counts()).toEqual([1, 1]);
    // A cópia clica no botão da caixa mostrada.
    const clicked = await page.evaluate(() => {
      const hits: string[] = [];
      document.querySelectorAll<HTMLElement>(".os-pb-buy").forEach((b) => {
        b.addEventListener("click", (e) => {
          e.preventDefault();
          hits.push(b.textContent ?? "");
        });
      });
      (document.querySelector(".os-pb-bar-go") as HTMLElement).click();
      return hits;
    });
    expect(clicked).toEqual(["Comprar o kit"]);
    expect(site.errors).toEqual([]);
    await site.context.close();
  });

  it("um salto na rolagem (tecla End, link #) também mostra a barra; o espaço no fim tem a altura dela", async () => {
    const site = await open(productPage(), 390);
    const { page } = site;
    await page.evaluate(() => window.scrollTo({ top: 1600, behavior: "instant" }));
    await expect.poll(async () => (await bar(page)).on).toBe(true);
    await page.keyboard.press("End");
    await page.waitForTimeout(400);
    const box = await page.evaluate(() => {
      const bar = (document.querySelector(".os-pb-bar") as HTMLElement).getBoundingClientRect();
      const sp = (document.querySelector(".os-pb-sp") as HTMLElement).getBoundingClientRect();
      const footer = (document.querySelector(".os-footer") as HTMLElement).getBoundingClientRect();
      return { bar: bar.height, sp: sp.height, footerBottom: footer.bottom, barTop: bar.top };
    });
    // (a altura da barra arredondada para cima)
    expect(box.sp - box.bar).toBeGreaterThanOrEqual(0);
    expect(box.sp - box.bar).toBeLessThan(1);
    // No fim da página, o rodapé fica inteiro acima da barra (nem faixa sobrando, nem coberto).
    expect(Math.abs(box.footerBottom - box.barTop)).toBeLessThan(2);
    // Texto longo no botão: a barra cresce e o espaço acompanha.
    const long = await open(
      productPage(($) => {
        $(".os-pb-buy").text("Quero garantir o meu agora com 41% de desconto e frete grátis");
      }),
      390,
    );
    await long.page.evaluate(() => window.scrollTo({ top: 1600, behavior: "instant" }));
    await expect.poll(async () => (await bar(long.page)).on).toBe(true);
    const sizes = await long.page.evaluate(() => [
      (document.querySelector(".os-pb-bar") as HTMLElement).getBoundingClientRect().height,
      (document.querySelector(".os-pb-sp") as HTMLElement).getBoundingClientRect().height,
    ]);
    expect(sizes[0]).toBeGreaterThan(box.bar + 20);
    expect(sizes[1] - sizes[0]).toBeGreaterThanOrEqual(0);
    expect(sizes[1] - sizes[0]).toBeLessThan(1);
    await long.context.close();
    await site.context.close();
  });

  it("cabeçalho fixo no topo: o “Comprar agora” escondido atrás dele já mostra a barra", async () => {
    const site = await open(
      productPage(($) => {
        $('[data-os-widget="store-header"]').attr("data-os-sticky", "1");
      }),
      390,
    );
    const { page } = site;
    const top = await page.evaluate(() => Number.parseFloat(document.documentElement.style.scrollPaddingTop) || 0);
    expect(top).toBeGreaterThan(60);
    // O botão passa por baixo do cabeçalho preso (o topo dele a 4 px do topo da tela).
    await page.evaluate(() => {
      const b = document.querySelector(".os-pb-buy") as HTMLElement;
      window.scrollTo(0, b.getBoundingClientRect().top + window.scrollY - 4);
    });
    await expect.poll(async () => (await bar(page)).on).toBe(true);
    expect(site.errors).toEqual([]);
    await site.context.close();
  });

  it("notificação de compra já aberta acima do WhatsApp: sobe junto quando a barra aparece", async () => {
    const html = productPage(($) => {
      $("body").append(
        '<a data-os-widget="whatsapp" href="https://wa.me/5511999999999" style="position:fixed;right:14px;bottom:14px;width:56px;height:56px;background:#25d366"></a>' +
          '<div data-os-widget="sales-notification" data-os-people="Maria - São Paulo" data-os-start="0" data-os-duration="60" data-os-position="right" hidden><p data-os-sn="title"></p><p data-os-sn="text"></p></div>',
      );
    });
    const site = await open(html, 390);
    const { page } = site;
    await page.waitForSelector(".os-sn.os-show");
    await page.waitForTimeout(400);
    const rects = () =>
      page.evaluate(() => {
        const sn = (document.querySelector(".os-sn") as HTMLElement).getBoundingClientRect();
        const wa = (document.querySelector('[data-os-widget="whatsapp"]') as HTMLElement).getBoundingClientRect();
        return { snBottom: sn.bottom, waTop: wa.top };
      });
    expect((await rects()).snBottom).toBeLessThanOrEqual((await rects()).waTop);
    await pastButton(page);
    await expect.poll(async () => (await bar(page)).on).toBe(true);
    await page.waitForTimeout(500);
    const up = await rects();
    // O WhatsApp subiu com a barra e a notificação continua acima dele (não o cobre).
    expect(up.snBottom).toBeLessThanOrEqual(up.waTop);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => (await bar(page)).on).toBe(false);
    await page.waitForTimeout(500);
    const down = await rects();
    expect(down.snBottom).toBeLessThanOrEqual(down.waTop);
    expect(site.errors).toEqual([]);
    await site.context.close();
  });

  it("no computador não aparece; com a barra desligada, nem existe", async () => {
    const desk = await open(productPage(), 1280);
    await pastButton(desk.page);
    await desk.page.waitForTimeout(300);
    expect(await bar(desk.page)).toMatchObject({ exists: true, on: false, display: "none", up: false });
    await desk.context.close();
    const off = await open(
      productPage(($) => {
        $('[data-os-widget="product-buy"]').attr("data-os-pb-bar", "0");
      }),
      390,
    );
    await pastButton(off.page);
    await off.page.waitForTimeout(300);
    expect(await bar(off.page)).toMatchObject({ exists: false, up: false });
    await off.context.close();
  });
});

describe("“‹ Voltar para a loja”", () => {
  const STORE = '<!doctype html><title>Loja</title><a id="ir" href="/oferta">Fone</a>';

  it("vindo da loja (mesmo site): volta para ela", async () => {
    const site = await open(productPage(), 1280, { path: "/oferta", extra: { "http://site.test/loja": STORE } });
    const { page } = site;
    await page.goto("http://site.test/loja");
    await Promise.all([page.waitForURL("http://site.test/oferta"), page.click("#ir")]);
    await Promise.all([page.waitForURL("http://site.test/loja"), page.click("a[data-os-pd-back]")]);
    await site.context.close();
  });

  it("criada pela vitrine (com destino = a loja): volta no histórico e a loja continua com a busca", async () => {
    const html = productPage(($) => {
      $("a[data-os-pd-back]").attr("href", "/loja");
    });
    const site = await open(html, 1280, { extra: { "http://site.test/loja": STORE } });
    const { page } = site;
    await page.goto("http://site.test/loja?busca=fone");
    await Promise.all([page.waitForURL("http://site.test/oferta"), page.click("#ir")]);
    await Promise.all([page.waitForURL("http://site.test/loja?busca=fone"), page.click("a[data-os-pd-back]")]);
    // O "Avançar" do navegador volta ao produto (foi um "Voltar", não uma página nova).
    await Promise.all([page.waitForURL("http://site.test/oferta"), page.goForward()]);
    await site.context.close();
  });

  it("popup de saída “ao tentar voltar”: o “Voltar” leva à loja sem abrir o popup", async () => {
    const html = productPage(($) => {
      $("body").append(
        '<div data-os-widget="exit-popup" data-os-back="1" data-os-arm="0" data-os-exit="0" data-os-scrollup="0" data-os-mobile-seconds="0" hidden><div><p>Espere!</p></div></div>',
      );
    });
    const site = await open(html, 1280, { path: "/oferta", extra: { "http://site.test/loja": STORE } });
    const { page } = site;
    await page.goto("http://site.test/loja");
    await Promise.all([page.waitForURL("http://site.test/oferta"), page.click("#ir")]);
    // Um toque na página (a miniatura) arma o popup: ele empilha uma entrada no histórico.
    await page.click(".os-pg-thumb >> nth=1");
    await page.waitForFunction(() => (history.state as { osPopup?: number } | null)?.osPopup === 1);
    await Promise.all([page.waitForURL("http://site.test/loja"), page.click("a[data-os-pd-back]")]);
    await site.context.close();
  });

  it("sem destino, sem página do site antes e sem logo com destino: fica (nada de voltar ao anúncio)", async () => {
    const site = await open(productPage(), 1280, { extra: { "https://anuncio.exemplo.com/": STORE } });
    const { page } = site;
    await page.goto("https://anuncio.exemplo.com/");
    await page.evaluate(() => {
      location.href = "http://site.test/oferta";
    });
    await page.waitForURL("http://site.test/oferta");
    await page.click("a[data-os-pd-back]");
    await page.waitForTimeout(500);
    expect(page.url()).toBe("http://site.test/oferta");
    expect(site.errors).toEqual([]);
    await site.context.close();
  });

  it("chegou direto (anúncio): vai para o logo do cabeçalho; com destino próprio, é um link comum", async () => {
    const html = productPage(($) => {
      $(".os-sh-logo").attr("href", "/loja");
    });
    const site = await open(html, 1280, { extra: { "http://site.test/loja": STORE, "http://site.test/outra": STORE } });
    await Promise.all([site.page.waitForURL("http://site.test/loja"), site.page.click("a[data-os-pd-back]")]);
    await site.context.close();

    const own = productPage(($) => {
      $("a[data-os-pd-back]").attr("href", "/outra");
    });
    const other = await open(own, 1280, { extra: { "http://site.test/outra": STORE } });
    await Promise.all([other.page.waitForURL("http://site.test/outra"), other.page.click("a[data-os-pd-back]")]);
    await other.context.close();
  });
});

describe("layout da página do produto", () => {
  it("tablet em pé (768 px): galeria e caixa de compra lado a lado, o “Comprar agora” na primeira tela", async () => {
    const site = await openSite(browser, productPage(), { contextOptions: { viewport: { width: 768, height: 1024 } } });
    const r = await site.page.evaluate(() => {
      const rect = (sel: string) => (document.querySelector(sel) as HTMLElement).getBoundingClientRect();
      return {
        gallery: rect(".os-pp-gal"),
        buy: rect(".os-pp-buy"),
        button: rect(".os-pb-buy"),
        scroll: document.documentElement.scrollWidth,
      };
    });
    expect(r.buy.left).toBeGreaterThanOrEqual(r.gallery.right);
    expect(r.button.bottom).toBeLessThan(1024);
    expect(r.scroll).toBeLessThanOrEqual(768);
    await site.context.close();
  });
});

describe("localizar e substituir na página do produto", () => {
  it("a foto grande (gerada) acompanha a 1ª miniatura; o frete muda no atributo da caixa e na parte", async () => {
    const html = templateHtml("produto", "Fone", NOW);
    const alt = await replaceInHtml(html, createMatcher("Foto 1 do produto") as never, "Fone preto, de lado");
    // Só a miniatura conta (a foto grande é refeita a partir dela).
    expect(alt.count).toBe(1);
    const $ = cheerio.load(alt.html);
    expect($(".os-pg-thumb img").first().attr("alt")).toBe("Fone preto, de lado");
    expect($("[data-os-pg-stage] img").attr("alt")).toBe("Fone preto, de lado");
    expect($("[data-os-pg-stage] img")).toHaveLength(1);
    const ship = await replaceInHtml(html, createMatcher("Frete grátis") as never, "Envío gratis");
    const $s = cheerio.load(ship.html);
    expect($s('[data-os-widget="product-buy"]').attr("data-os-pd-ship")).toBe("Envío gratis");
    expect($s('[data-os-widget="product-buy"] .os-pd-ship').text()).toBe("Envío gratis");
  });
});
