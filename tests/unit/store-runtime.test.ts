/**
 * Loja na página publicada (Chromium, mesmo HTML da prévia/ZIP com o script
 * das páginas): busca do cabeçalho de loja (Enter, lupa, plural/acentos, sem
 * resultados, "Ver todos", ?busca= no endereço e ao abrir, rolagem até o
 * primeiro resultado abaixo das barras), categoria sem destino buscando o texto
 * dela, página sem vitrine levando à página da loja com a busca (e as UTMs do
 * link), setas do carrossel e o cabeçalho fixo no topo (embaixo da "Contagem
 * no topo", no lugar dentro de um bloco escondido). Também: categoria que bate
 * com o título de uma vitrine, setas de uma vitrine que começa escondida,
 * ?busca= com uma foto atrasada acima da vitrine, linha de resultados presa no
 * cabeçalho fixo, rolagem longa no celular sem abrir o popup de saída e a
 * página servida como latin-1.
 */
import { type Browser, type BrowserContextOptions, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addBlock, type EditorWindow, exportPage, openEditor, openSite, setTrait } from "./blocks-harness";
import { fakeId } from "./helpers";

const HEADER = '[data-os-widget="store-header"]';
const LOJA = fakeId("loja");
const PAGES = [
  { id: LOJA, name: "Loja" },
  { id: fakeId("produto"), name: "Produto" },
];
const FONT = `body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;font-size:16px}`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** Página montada no editor e exportada como o visitante recebe. */
async function build(blocks: string[], configure?: (page: Page) => Promise<void>) {
  const page = await openEditor(browser, { pages: PAGES });
  await page.evaluate((css) => (window as unknown as EditorWindow).ed.Css.addRules(css), FONT);
  for (const id of blocks) await addBlock(page, id);
  if (configure) await configure(page);
  const html = await exportPage(page);
  await page.close();
  return html;
}

/** Estado da busca: produtos e vitrines à vista, linha de resultados, campo e endereço. */
const state = (page: Page) =>
  page.evaluate(() => {
    const shown = (el: Element) =>
      (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === "fixed";
    const shops = Array.from(document.querySelectorAll('[data-os-widget="products"]'));
    const line = document.querySelector(".os-sh-res");
    return {
      names: Array.from(document.querySelectorAll("a[data-os-product]"))
        .filter(shown)
        .map((c) => c.querySelector(".os-pd-name")?.textContent ?? ""),
      shops: shops.map((s) => (shown(s) ? (s.querySelector(".os-pd-title")?.textContent ?? "") : null)),
      line: line && shown(line) ? line.textContent : null,
      input: (document.querySelector(".os-sh-q") as HTMLInputElement).value,
      search: location.search,
    };
  });

describe("busca na página da loja", () => {
  let html = "";
  beforeAll(async () => {
    html = await build(
      ["cabecalho-loja", "hero", "oferta-do-dia", "grade-produtos", "carrossel-produtos"],
      async (p) => {
        await setTrait(p, HEADER, "os-sh-store", LOJA);
        await p.evaluate(() => {
          const ed = (window as unknown as EditorWindow).ed;
          const cats = ed.getWrapper()?.find("a.os-sh-cat") ?? [];
          // "Fones" continua sem destino (busca); "Mais vendidos" leva a um endereço.
          cats[2]?.components("Fones");
          cats[1]?.addAttributes({ href: "https://exemplo.com/mais-vendidos" });
        });
      },
    );
  }, 60_000);

  it("Enter filtra pelo nome: esconde os outros produtos e a vitrine que ficou vazia, mostra a linha e grava ?busca=", async () => {
    const site = await openSite(browser, html, { contextOptions: { viewport: { width: 1280, height: 800 } } });
    const { page } = site;
    const before = await state(page);
    expect(before.names.length).toBe(24);
    expect(before.line).toBeNull();
    await page.fill(".os-sh-q", "  FONE ");
    await page.press(".os-sh-q", "Enter");
    const s = await state(page);
    expect(s.names).toEqual(Array(3).fill("Fone de ouvido Bluetooth sem fio"));
    // "Oferta do dia" (só a luminária) some; as outras ficam com o fone.
    expect(s.shops).toEqual([null, "Ofertas", "Mais vendidos", "Ofertas"]);
    expect(s.line).toBe("Resultados para “FONE” · Ver todos os produtos");
    expect(s.input).toBe("FONE");
    expect(s.search).toBe("?busca=FONE");
    // A linha fica logo abaixo do cabeçalho.
    const order = await page.evaluate(() => {
      const header = document.querySelector('[data-os-widget="store-header"]') as HTMLElement;
      return header.nextElementSibling?.className;
    });
    expect(order).toBe("os-sh-res");
    await site.context.close();
  });

  it("lupa, acento e plural; sem resultados: aviso e todas as vitrines (e a faixa cinza em volta) somem", async () => {
    const site = await openSite(browser, html, { contextOptions: { viewport: { width: 1280, height: 800 } } });
    const { page } = site;
    await page.fill(".os-sh-q", "luminarias");
    await page.click(".os-sh-go");
    let s = await state(page);
    expect(s.names).toEqual(Array(3).fill("Luminária LED de mesa"));
    expect(s.shops).toEqual(["Oferta do dia", null, "Mais vendidos", "Ofertas"]);

    await page.fill(".os-sh-q", "geladeira inox");
    await page.press(".os-sh-q", "Enter");
    s = await state(page);
    expect(s.names).toEqual([]);
    expect(s.shops).toEqual([null, null, null, null]);
    expect(s.line).toBe("Nenhum produto encontrado para “geladeira inox” · Ver todos os produtos");
    expect(s.search).toBe("?busca=geladeira+inox");
    // A seção cinza da "Oferta do dia + ofertas" não fica vazia na tela; o topo (hero) fica.
    const hidden = await page.evaluate(() => {
      const row = document.querySelector(".os-pd-row") as HTMLElement;
      return {
        row: getComputedStyle(row).display,
        section: getComputedStyle(row.parentElement as HTMLElement).display,
        header: getComputedStyle(document.querySelector('[data-os-widget="store-header"]') as Element).display,
      };
    });
    expect(hidden).toEqual({ row: "none", section: "none", header: "block" });

    // "Ver todos os produtos" desfaz tudo (e tira o ?busca=).
    await page.click(".os-sh-res button");
    s = await state(page);
    expect(s.names.length).toBe(24);
    expect(s.line).toBeNull();
    expect(s.input).toBe("");
    expect(s.search).toBe("");
    // Busca vazia também desfaz.
    await page.fill(".os-sh-q", "panela");
    await page.press(".os-sh-q", "Enter");
    expect((await state(page)).names.length).toBe(3);
    await page.fill(".os-sh-q", "   ");
    await page.press(".os-sh-q", "Enter");
    s = await state(page);
    expect(s.names.length).toBe(24);
    expect(s.line).toBeNull();
    expect(s.search).toBe("");
    await site.context.close();
  });

  it("abrir com ?busca= preenche o campo, filtra e rola até o primeiro resultado", async () => {
    const site = await openSite(browser, html, {
      query: "?busca=mochilas&utm_source=fb",
      contextOptions: { viewport: { width: 1280, height: 700 } },
    });
    const { page } = site;
    await page.waitForTimeout(900);
    const s = await state(page);
    expect(s.input).toBe("mochilas");
    expect(s.names).toEqual(Array(3).fill("Mochila para notebook"));
    expect(s.line).toBe("Resultados para “mochilas” · Ver todos os produtos");
    // Os outros parâmetros ficam no endereço.
    expect(new URLSearchParams(s.search).get("utm_source")).toBe("fb");
    const pos = await page.evaluate(() => {
      const shop = Array.from(document.querySelectorAll('[data-os-widget="products"]')).find(
        (el) => (el as HTMLElement).offsetParent,
      ) as HTMLElement;
      const card = shop.querySelector("a[data-os-product]:not(.os-sh-hide)") as HTMLElement;
      return { y: scrollY, top: shop.getBoundingClientRect().top, bottom: card.getBoundingClientRect().bottom };
    });
    // O topo (hero) empurra a vitrine para baixo da tela: a página rolou até ela.
    expect(pos.y).toBeGreaterThan(100);
    expect(pos.top).toBeGreaterThanOrEqual(0);
    expect(pos.top).toBeLessThan(40);
    expect(pos.bottom).toBeLessThanOrEqual(700);
    await site.context.close();
  });

  it("categoria sem destino busca o texto dela; categoria com endereço leva para lá", async () => {
    const site = await openSite(browser, html, { contextOptions: { viewport: { width: 1280, height: 800 } } });
    const { page } = site;
    await page.click("a.os-sh-cat >> text=Fones");
    const s = await state(page);
    expect(s.input).toBe("Fones");
    expect(s.names).toEqual(Array(3).fill("Fone de ouvido Bluetooth sem fio"));
    expect(s.search).toBe("?busca=Fones");
    // Categoria com o título de uma vitrine ("Ofertas do dia" ~ "Oferta do dia"): a vitrine inteira aparece.
    await page.click("a.os-sh-cat >> text=Ofertas do dia");
    const titled = await state(page);
    expect(titled.shops).toEqual(["Oferta do dia", null, null, null]);
    expect(titled.names).toEqual(["Luminária LED de mesa"]);
    // Texto da busca também acha o selo do produto ("Mais vendido" no primeiro da grade).
    await page.fill(".os-sh-q", "mais vendido");
    await page.press(".os-sh-q", "Enter");
    expect((await state(page)).shops).toEqual([null, null, "Mais vendidos", null]);
    await Promise.all([page.waitForURL("https://exemplo.com/mais-vendidos"), page.click("a.os-sh-cat >> nth=1")]);
    await site.context.close();
  });

  it("setas do carrossel: desligadas no começo/fim, rolam a trilha; a busca acerta as setas; no celular não aparecem", async () => {
    const site = await openSite(browser, html, { contextOptions: { viewport: { width: 1280, height: 800 } } });
    const { page } = site;
    // A última vitrine é o "Carrossel de produtos" (8 produtos, 5 por vez).
    const arrows = () =>
      page.evaluate(() => {
        const shops = document.querySelectorAll('[data-os-widget="products"]');
        const shop = shops[shops.length - 1] as HTMLElement;
        const track = shop.querySelector("[data-os-pd-track]") as HTMLElement;
        const btn = (sel: string) => shop.querySelector(sel) as HTMLButtonElement;
        return {
          js: shop.classList.contains("os-pd-js"),
          left: track.scrollLeft,
          max: track.scrollWidth - track.clientWidth,
          prev: btn(".os-pd-prev").disabled,
          next: btn(".os-pd-next").disabled,
          shown: getComputedStyle(btn(".os-pd-next")).display,
        };
      });
    expect(await arrows()).toMatchObject({ js: true, left: 0, prev: true, next: false, shown: "flex" });
    const next = page.locator(".os-pd-next").last();
    await next.scrollIntoViewIfNeeded();
    await next.click();
    await expect.poll(async () => (await arrows()).left).toBeGreaterThan(0);
    await expect.poll(async () => (await arrows()).next).toBe(true);
    const end = await arrows();
    expect(end.left).toBeGreaterThanOrEqual(end.max - 1);
    expect(end.prev).toBe(false);
    await page.locator(".os-pd-prev").last().click();
    await expect.poll(async () => (await arrows()).prev).toBe(true);

    // Com a busca, a trilha fica com um produto: as duas setas desligam.
    await page.fill(".os-sh-q", "air fryer");
    await page.press(".os-sh-q", "Enter");
    expect(await arrows()).toMatchObject({ prev: true, next: true });
    await site.context.close();

    const phone = await openSite(browser, html, { contextOptions: { viewport: { width: 390, height: 800 } } });
    const mobile = await phone.page.evaluate(() =>
      Array.from(document.querySelectorAll(".os-pd-nav")).map((b) => getComputedStyle(b).display),
    );
    expect(new Set(mobile)).toEqual(new Set(["none"]));
    expect(await phone.page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await phone.context.close();
  });
});

describe("página sem vitrine (ex.: página do produto)", () => {
  it("a pesquisa leva à página da loja com a busca (mantendo as UTMs do link); sem a página da loja, nada acontece", async () => {
    const withStore = await build(["cabecalho-loja", "hero"], async (p) => {
      await setTrait(p, HEADER, "os-sh-store", LOJA);
    });
    // O rastreamento põe as UTMs da chegada nos links do funil (aqui, já no HTML).
    const decorated = withStore.replace(`href="/p/${LOJA}"`, `href="/p/${LOJA}?utm_source=fb&amp;utm_campaign=loja"`);
    expect(decorated).not.toBe(withStore);
    const site = await openSite(browser, decorated, {
      extra: { "http://site.test/p/": "<!doctype html><title>Loja</title><p>loja</p>" },
    });
    const { page } = site;
    await page.fill(".os-sh-q", "fone sem fio");
    await Promise.all([page.waitForURL(/\/p\//), page.press(".os-sh-q", "Enter")]);
    const url = new URL(page.url());
    expect(url.pathname).toBe(`/p/${LOJA}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      utm_source: "fb",
      utm_campaign: "loja",
      busca: "fone sem fio",
    });
    await site.context.close();

    // Chegar nesta página com ?busca= não leva a lugar nenhum sozinho.
    const back = await openSite(browser, decorated, { query: "?busca=fone" });
    await back.page.waitForTimeout(400);
    expect(new URL(back.page.url()).pathname).toBe("/oferta");
    await back.context.close();

    const noStore = await build(["cabecalho-loja", "hero"]);
    const lost = await openSite(browser, noStore);
    await lost.page.fill(".os-sh-q", "fone");
    await lost.page.press(".os-sh-q", "Enter");
    await lost.page.click(".os-sh-go");
    await lost.page.waitForTimeout(400);
    expect(lost.page.url()).toBe("http://site.test/oferta");
    expect(await lost.page.locator(".os-sh-res").count()).toBe(0);
    await lost.context.close();
  });
});

describe("cabeçalho fixo no topo", () => {
  it("fica preso embaixo da “Contagem no topo (barra)”, com espaço reservado; a busca rola até o resultado abaixo dos dois", async () => {
    const html = await build(
      ["contador-barra", "cabecalho-loja", "hero", "grade-produtos", "lista-ofertas-dia"],
      async (p) => {
        await setTrait(p, HEADER, "data-os-sticky", true);
      },
    );
    const site = await openSite(browser, html, { contextOptions: { viewport: { width: 1280, height: 800 } } });
    const { page } = site;
    await page.waitForTimeout(300);
    const pinned = () =>
      page.evaluate(() => {
        const bar = document.querySelector('[data-os-widget="countdown"]') as HTMLElement;
        const header = document.querySelector('[data-os-widget="store-header"]') as HTMLElement;
        const spacer = document.querySelector(".os-top-sp") as HTMLElement;
        return {
          bar: bar.getBoundingClientRect().toJSON(),
          header: header.getBoundingClientRect().toJSON(),
          position: getComputedStyle(header).position,
          inBody: header.parentElement === document.body,
          spacer: spacer.getBoundingClientRect().height,
          pad: document.documentElement.style.scrollPaddingTop,
        };
      });
    const top = await pinned();
    expect(top.position).toBe("fixed");
    expect(top.inBody).toBe(true);
    expect(top.bar.top).toBe(0);
    expect(Math.abs(top.header.top - top.bar.height)).toBeLessThan(1);
    expect(Math.abs(top.spacer - (top.bar.height + top.header.height))).toBeLessThan(1);
    expect(Math.abs(parseFloat(top.pad) - top.spacer)).toBeLessThan(0.01);
    await page.mouse.wheel(0, 1200);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(300);
    expect(Math.abs((await pinned()).header.top - top.bar.height)).toBeLessThan(1);

    // Busca: a linha de resultados fica presa dentro do cabeçalho (o espaço do topo cresce
    // junto) e a vitrine do resultado para logo abaixo das barras (não embaixo delas).
    await page.evaluate(() => scrollTo(0, 0));
    await page.fill(".os-sh-q", "tenis");
    await page.press(".os-sh-q", "Enter");
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => {
      const shop = Array.from(document.querySelectorAll('[data-os-widget="products"]')).find(
        (el) => (el as HTMLElement).offsetParent,
      ) as HTMLElement;
      const line = document.querySelector(".os-sh-res") as HTMLElement;
      return {
        y: scrollY,
        top: shop.getBoundingClientRect().top,
        spacer: (document.querySelector(".os-top-sp") as HTMLElement).getBoundingClientRect().height,
        pad: parseFloat(document.documentElement.style.scrollPaddingTop),
        inHeader: !!line.closest('[data-os-widget="store-header"]'),
        line: line.getBoundingClientRect().toJSON(),
      };
    });
    expect(after.inHeader).toBe(true);
    expect(after.spacer).toBeGreaterThan(top.spacer + 20);
    expect(Math.abs(after.pad - after.spacer)).toBeLessThan(0.01);
    expect(after.y).toBeGreaterThan(0);
    expect(after.top).toBeGreaterThanOrEqual(after.spacer);
    expect(after.top).toBeLessThan(after.spacer + 40);
    expect(after.line.top).toBeGreaterThanOrEqual(0);
    expect(after.line.bottom).toBeLessThanOrEqual(after.spacer + 1);
    // "Ver todos os produtos": a linha sai, o espaço do topo volta e o foco volta para o campo.
    await page.click(".os-sh-res button");
    const reset = await page.evaluate(() => ({
      spacer: (document.querySelector(".os-top-sp") as HTMLElement).getBoundingClientRect().height,
      line: document.querySelectorAll(".os-sh-res").length,
      focus: document.activeElement?.className,
    }));
    expect(reset.line).toBe(0);
    expect(Math.abs(reset.spacer - top.spacer)).toBeLessThan(1);
    expect(reset.focus).toBe("os-sh-q");

    // Página rolada até o meio e busca sem resultado: a mensagem e o "Ver todos" ficam à vista.
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight / 2));
    await page.fill(".os-sh-q", "geladeira");
    await page.press(".os-sh-q", "Enter");
    await page.waitForTimeout(600);
    const empty = await page.evaluate(() => {
      const r = (document.querySelector(".os-sh-res") as HTMLElement).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, h: innerHeight, text: document.querySelector(".os-sh-res")?.textContent };
    });
    expect(empty.text).toBe("Nenhum produto encontrado para “geladeira” · Ver todos os produtos");
    expect(empty.top).toBeGreaterThanOrEqual(0);
    expect(empty.bottom).toBeLessThanOrEqual(empty.h);
    await site.context.close();
  });

  it("dentro de um bloco que começa escondido (popup de saída) fica no lugar", async () => {
    const html = await build(["popup-saida", "grade-produtos"], async (p) => {
      await p.evaluate(() => {
        const ed = (window as unknown as EditorWindow).ed;
        const content = ed.Blocks.get("cabecalho-loja")?.get("content") as never;
        const [header] = ed.getWrapper()?.find('[data-os-widget="exit-popup"]')[0]?.append(content) ?? [];
        header?.addAttributes({ "data-os-sticky": "1" });
      });
    });
    expect(html).toContain('data-os-sticky="1"');
    const site = await openSite(browser, html);
    await site.page.waitForTimeout(300);
    const info = await site.page.evaluate(() => {
      const header = document.querySelector('[data-os-widget="store-header"]') as HTMLElement;
      return {
        pinned: header.classList.contains("os-top"),
        inPopup: !!header.closest('[data-os-widget="exit-popup"]'),
        spacer: document.querySelectorAll(".os-top-sp").length,
      };
    });
    expect(info).toEqual({ pinned: false, inPopup: true, spacer: 0 });
    await site.context.close();
  });
});

/** Abre o HTML com rotas próprias (foto atrasada, outro charset): como openSite, com a resposta da página escolhida. */
async function openWith(
  html: string,
  opts: {
    query?: string;
    contentType?: string;
    contextOptions?: BrowserContextOptions;
    routes?: Record<string, () => Promise<{ contentType: string; body: string }>>;
    init?: string;
  } = {},
) {
  const context = await browser.newContext(opts.contextOptions ?? { viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://site.test" && url.pathname === "/oferta") {
      return route.fulfill({ contentType: opts.contentType ?? "text/html; charset=utf-8", body: html });
    }
    const custom = opts.routes?.[url.pathname];
    if (custom) return route.fulfill(await custom());
    return route.fulfill({ status: 204, body: "" });
  });
  if (opts.init) await context.addInitScript({ content: opts.init });
  await page.goto(`http://site.test/oferta${opts.query ?? ""}`);
  return { page, context, errors };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("revisão: vitrine que aparece depois, foto atrasada, celular e charset", () => {
  it("setas de um carrossel que começa escondido (atraso) ligam quando ele aparece; sem ResizeObserver, ao passar o mouse", async () => {
    const html = await build(["cabecalho-loja", "hero", "carrossel-produtos"], async (p) => {
      await p.evaluate(() => {
        const ed = (window as unknown as EditorWindow).ed;
        ed.getWrapper()?.find('[data-os-widget="products"]')[0]?.addAttributes({ "data-os-delay": "1" });
      });
    });
    const next = (page: Page) =>
      page.evaluate(() => {
        const btn = document.querySelector(".os-pd-next") as HTMLButtonElement;
        const shop = btn.closest('[data-os-widget="products"]') as HTMLElement;
        return { visible: !!shop.offsetParent, disabled: btn.disabled, opacity: getComputedStyle(btn).opacity };
      });
    for (const withObserver of [true, false]) {
      const site = await openWith(html, withObserver ? {} : { init: "delete window.ResizeObserver;" });
      const { page } = site;
      expect(await next(page)).toMatchObject({ visible: false, disabled: true });
      await page.waitForTimeout(1500);
      if (!withObserver) {
        // Safari 13.0: o mouse chegando na vitrine confere as setas.
        await page.locator('[data-os-widget="products"] .os-pd-title').scrollIntoViewIfNeeded();
        await page.hover('[data-os-widget="products"] .os-pd-title');
      }
      await expect.poll(() => next(page)).toMatchObject({ visible: true, disabled: false, opacity: "1" });
      expect(site.errors).toEqual([]);
      await site.context.close();
    }
  });

  it("?busca= com uma foto acima da vitrine que chega depois: quando a página termina de carregar, o resultado aparece", async () => {
    const html = await build(["cabecalho-loja", "grade-produtos", "carrossel-produtos"], async (p) => {
      await p.evaluate(() => {
        const ed = (window as unknown as EditorWindow).ed;
        ed.getWrapper()?.append('<img src="/banner.svg" alt="" style="display:block;max-width:100%;height:auto">', {
          at: 1,
        } as never);
      });
    });
    const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#ddd"/></svg>`;
    const site = await openWith(html, {
      query: "?busca=mochila",
      contextOptions: { viewport: { width: 1280, height: 800 } },
      routes: {
        "/banner.svg": async () => {
          await sleep(700);
          return { contentType: "image/svg+xml", body: banner };
        },
      },
    });
    const { page } = site;
    await page.waitForTimeout(2500);
    const pos = await page.evaluate(() => {
      const shop = Array.from(document.querySelectorAll('[data-os-widget="products"]')).find(
        (el) => (el as HTMLElement).offsetParent,
      ) as HTMLElement;
      const card = shop.querySelector("a[data-os-product]:not(.os-sh-hide)") as HTMLElement;
      return {
        y: scrollY,
        banner: (document.querySelector('img[src="/banner.svg"]') as HTMLElement).getBoundingClientRect().height,
        top: shop.getBoundingClientRect().top,
        bottom: card.getBoundingClientRect().bottom,
      };
    });
    expect(pos.banner).toBeGreaterThan(500);
    expect(pos.y).toBeGreaterThan(300);
    expect(pos.top).toBeGreaterThanOrEqual(0);
    expect(pos.bottom).toBeLessThanOrEqual(800);
    await site.context.close();
  });

  it("celular: busca lá do fim de uma página longa (cabeçalho fixo) sobe até o resultado sem abrir o popup de saída", async () => {
    const tall = Array(10).fill("hero");
    const html = await build(
      ["popup-saida", "cabecalho-loja", "grade-produtos", ...tall, "carrossel-produtos", "faixa-ofertas", ...tall],
      async (p) => {
        await setTrait(p, HEADER, "data-os-sticky", true);
      },
    );
    const site = await openWith(html, {
      contextOptions: { viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true },
      init: 'window.__popups = 0; document.addEventListener("os:popup", () => window.__popups++);',
    });
    const { page } = site;
    await page.waitForTimeout(300);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(height).toBeGreaterThan(15000);
    // Desce a página aos poucos (como a pessoa rolando), até o fim.
    for (let y = 0; y < height; y += 600) {
      await page.evaluate((top) => scrollTo(0, top), y);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(300);
    await page.fill(".os-sh-q", "fone");
    await page.press(".os-sh-q", "Enter");
    await page.waitForTimeout(3000);
    const after = await page.evaluate(() => ({
      y: scrollY,
      popups: (window as unknown as { __popups: number }).__popups,
      open: !!document.querySelector(".os-pop"),
    }));
    expect(after.popups).toBe(0);
    expect(after.open).toBe(false);
    expect(after.y).toBeLessThan(height / 2);
    await site.context.close();
  });

  it("página servida como latin-1 (charset da hospedagem): o script das páginas continua ligado", async () => {
    const html = await build(["contador-barra", "popup-saida", "cabecalho-loja", "grade-produtos"]);
    const site = await openWith(html, { contentType: "text/html; charset=iso-8859-1" });
    await site.page.waitForTimeout(300);
    const on = await site.page.evaluate(() => ({
      runtime: (window as unknown as { __osRuntime?: boolean }).__osRuntime === true,
      css: !!document.getElementById("os-widgets-css"),
    }));
    expect(site.errors).toEqual([]);
    expect(on).toEqual({ runtime: true, css: true });
    await site.context.close();
  });
});

describe("ajustes da fase 1: setas na borda, foto da vitrine de 1 coluna e texto da pesquisa", () => {
  let html = "";
  beforeAll(async () => {
    html = await build(["cabecalho-loja", "faixa-ofertas", "oferta-do-dia", "carrossel-produtos"]);
  }, 60_000);

  it.each([
    1280, 1024,
  ])("setas metade para fora da trilha, na altura da foto, sem cobrir texto nem criar rolagem lateral (%ipx)", async (width) => {
    const site = await openSite(browser, html, { contextOptions: { viewport: { width, height: 900 } } });
    const report = await site.page.evaluate(() => {
      const box = (el: Element | null) => (el as Element).getBoundingClientRect();
      const hits = (a: DOMRect, b: DOMRect) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      return {
        scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        shops: Array.from(document.querySelectorAll('[data-os-widget="products"][data-os-layout="carousel"]')).map(
          (shop) => {
            const wrap = box(shop.querySelector(".os-pd-wrap"));
            const photo = box(shop.querySelector("a[data-os-product] .os-pd-media"));
            const own = box(shop);
            const bodies = Array.from(shop.querySelectorAll(".os-pd-body")).map((b) => b.getBoundingClientRect());
            const arrow = (sel: string) => {
              const r = box(shop.querySelector(sel));
              return {
                shown: getComputedStyle(shop.querySelector(sel) as Element).display,
                x: Math.round(r.left + r.width / 2),
                y: Math.round(r.top + r.height / 2),
                inside: r.left >= own.left - 0.5 && r.right <= own.right + 0.5,
                text: bodies.some((b) => hits(r, b)),
              };
            };
            return {
              wrap: [Math.round(wrap.left), Math.round(wrap.right)],
              photoY: Math.round(photo.top + photo.height / 2),
              prev: arrow(".os-pd-prev"),
              next: arrow(".os-pd-next"),
            };
          },
        ),
      };
    });
    // Faixa de ofertas (ponta a ponta), "Ofertas" (ao lado da "Oferta do dia") e o carrossel.
    expect(report.shops).toHaveLength(3);
    expect(report.scroll).toBe(0);
    for (const shop of report.shops) {
      for (const [arrow, edge] of [
        [shop.prev, shop.wrap[0]],
        [shop.next, shop.wrap[1]],
      ] as const) {
        expect(arrow.shown).toBe("flex");
        // O meio da seta na borda da trilha (metade para fora), na altura do meio da foto.
        expect(Math.abs(arrow.x - edge)).toBeLessThanOrEqual(1);
        expect(Math.abs(arrow.y - shop.photoY), JSON.stringify(shop)).toBeLessThanOrEqual(1);
        // Inteira dentro da vitrine (não cortada) e longe do nome e do preço.
        expect(arrow.inside).toBe(true);
        expect(arrow.text).toBe(false);
      }
    }
    await site.context.close();
  });

  it("celular: a vitrine de 1 coluna (“Oferta do dia”) mostra a foto centralizada com no máximo 260 px; a pesquisa termina em “…”", async () => {
    const site = await openSite(browser, html, { contextOptions: { viewport: { width: 390, height: 844 } } });
    const got = await site.page.evaluate(() => {
      const card = document.querySelector(".os-pd-row a[data-os-product]") as HTMLElement;
      const photo = (card.querySelector(".os-pd-media") as HTMLElement).getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const img = (card.querySelector(".os-pd-img") as HTMLElement).getBoundingClientRect();
      const input = document.querySelector(".os-sh-q") as HTMLInputElement;
      return {
        w: Math.round(photo.width),
        h: Math.round(photo.height),
        img: [Math.round(img.width), Math.round(img.height)],
        sides: [Math.round(photo.left - c.left), Math.round(c.right - photo.right)],
        cardW: Math.round(c.width),
        ellipsis: getComputedStyle(input).textOverflow,
        scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        // "Ofertas" (carrossel) empilhada embaixo da "Oferta do dia": inteira, com os cartões à vista.
        offers: (() => {
          const shop = document.querySelectorAll(".os-pd-row > [data-os-widget]")[1] as HTMLElement;
          const first = (shop.querySelector("a[data-os-product]") as HTMLElement).getBoundingClientRect();
          return {
            height: Math.round(shop.getBoundingClientRect().height),
            inside: first.bottom <= shop.getBoundingClientRect().bottom,
          };
        })(),
      };
    });
    expect(got.offers.height).toBeGreaterThan(250);
    expect(got.offers.inside).toBe(true);
    expect(got.cardW).toBeGreaterThan(300);
    expect(got.w).toBe(260);
    expect(got.h).toBe(260);
    expect(got.img).toEqual([260, 260]);
    expect(Math.abs(got.sides[0] - got.sides[1])).toBeLessThanOrEqual(1);
    expect(got.ellipsis).toBe("ellipsis");
    expect(got.scroll).toBe(0);
    await site.context.close();
  });
});
