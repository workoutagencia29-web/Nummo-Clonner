/**
 * Carrossel de banners no editor de verdade (GrapesJS no Chromium) e rodando na
 * página publicada.
 *
 * Editor (tudo nas Configurações do carrossel): "Quantas imagens você quer?"
 * muda a quantidade; cada banner tem a sua caixinha (imagem, destino e
 * descrição); "Estático/Dinâmico" liga/desliga o autoplay e os segundos.
 * Página: o script liga os-bn-js, cria uma bolinha por banner, as setas e as
 * bolinhas navegam, e o carrossel passa sozinho.
 */
import * as cheerio from "cheerio";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BANNER_MAX_SLIDES } from "@/lib/banner";
import { addBlock, attrs, type EditorWindow, exportPage, openEditor, openSite, pageErrors } from "./blocks-harness";

const LINKS = [{ key: "promo", label: "Promoção", kind: "CHECKOUT", url: "https://loja.exemplo.com/promo" }];
const PAGES = [
  { id: "p-home", name: "Início" },
  { id: "p-fones", name: "Fones" },
];

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

const slideCount = (page: Page) =>
  page.evaluate(() => (window as unknown as EditorWindow).ed.getWrapper()?.find(".os-bn-slide").length ?? 0);

/** Muda um campo dentro do painel do carrossel (seleciona o widget e dispara "change"). */
async function setField(page: Page, trait: string, selector: string, value: string) {
  await page.evaluate(
    ([traitName, sel, val]) => {
      const ed = (window as unknown as EditorWindow).ed;
      const widget = ed.getWrapper()?.find('[data-os-widget="banner"]')[0];
      if (!widget) throw new Error("sem carrossel");
      ed.select(widget);
      const t = widget.getTrait(traitName) as unknown as { view?: { getInputElem(): HTMLElement } };
      const box = t.view?.getInputElem();
      if (!box) throw new Error(`campo ${traitName} não desenhado`);
      const f = box.querySelector(sel) as HTMLInputElement | HTMLSelectElement | null;
      if (!f) throw new Error(`sem ${sel}`);
      f.value = val;
      f.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [trait, selector, value] as const,
  );
}

/** Existe o campo `selector` no painel `trait`? */
async function hasField(page: Page, trait: string, selector: string): Promise<boolean> {
  return page.evaluate(
    ([traitName, sel]) => {
      const ed = (window as unknown as EditorWindow).ed;
      const widget = ed.getWrapper()?.find('[data-os-widget="banner"]')[0];
      if (!widget) return false;
      ed.select(widget);
      const t = widget.getTrait(traitName) as unknown as { view?: { getInputElem(): HTMLElement } };
      return !!t.view?.getInputElem().querySelector(sel);
    },
    [trait, selector] as const,
  );
}

describe("carrossel de banners no editor", () => {
  it("o painel tem 'Quantas imagens' e uma caixinha por banner; mudar a quantidade adiciona/remove", async () => {
    const page = await openEditor(browser, { links: LINKS, pages: PAGES });
    await addBlock(page, "carrossel-banners");
    expect(await slideCount(page)).toBe(2);

    const painel = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const w = ed.getWrapper()?.find('[data-os-widget="banner"]')[0];
      if (!w) throw new Error("sem carrossel");
      ed.select(w);
      const t = w.getTrait("os-bn-images") as unknown as { view?: { getInputElem(): HTMLElement } };
      const box = t.view?.getInputElem();
      if (!box) throw new Error("sem painel");
      return {
        pergunta: box.querySelector(".os-bnp-count-label")?.textContent,
        quantidade: (box.querySelector(".os-bnp-count select") as HTMLSelectElement)?.value,
        caixas: Array.from(box.querySelectorAll(".os-bnp-head")).map((h) => h.textContent),
        opcoes: Array.from(box.querySelectorAll<HTMLOptionElement>(".os-bnp-count option")).map((o) => o.value),
      };
    });
    expect(painel.pergunta).toBe("Quantas imagens você quer?");
    expect(painel.quantidade).toBe("2");
    expect(painel.caixas).toEqual(["Banner 1", "Banner 2"]);
    expect(painel.opcoes).toEqual(["1", "2", "3", "4", "5"]);

    // Muda para 3 imagens → 3 banners; depois 1 → 1 banner.
    await setField(page, "os-bn-images", ".os-bnp-count select", "3");
    expect(await slideCount(page)).toBe(3);
    await setField(page, "os-bn-images", ".os-bnp-count select", "1");
    expect(await slideCount(page)).toBe(1);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it("escolher o destino de um banner grava o link; no HTML vira o endereço; 'sem link' é decorativo", async () => {
    const page = await openEditor(browser, { links: LINKS, pages: PAGES });
    await addBlock(page, "carrossel-banners");

    // Link da oferta → data-os-link; no HTML final vira o endereço.
    await setField(page, "os-bn-images", '[data-os-bnp="0"] .os-bnp-link', "link:promo");
    expect((await attrs(page, ".os-bn-slide"))["data-os-link"]).toBe("promo");
    const html = await exportPage(page, { links: [{ key: "promo", url: "https://loja.exemplo.com/promo" }] });
    expect(cheerio.load(html)(".os-bn-slide").first().attr("href")).toBe("https://loja.exemplo.com/promo");

    // Página do funil → href os-page:<id> (e tira o data-os-link).
    await setField(page, "os-bn-images", '[data-os-bnp="0"] .os-bnp-link', "page:p-fones");
    const comPagina = await attrs(page, ".os-bn-slide");
    expect(comPagina.href).toBe("os-page:p-fones");
    expect(comPagina["data-os-link"]).toBeUndefined();

    // "— sem link —": decorativo (sem href nem data-os-link).
    await setField(page, "os-bn-images", '[data-os-bnp="0"] .os-bnp-link', "");
    const decorativo = await attrs(page, ".os-bn-slide");
    expect(decorativo.href).toBeUndefined();
    expect(decorativo["data-os-link"]).toBeUndefined();

    // Descrição grava o alt da imagem.
    await setField(page, "os-bn-images", '[data-os-bnp="0"] .os-bnp-alt', "Promoção de verão");
    expect((await attrs(page, ".os-bn-img")).alt).toBe("Promoção de verão");
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it("Estático × Dinâmico: liga/desliga o autoplay e mostra os segundos só no dinâmico", async () => {
    const page = await openEditor(browser, {});
    await addBlock(page, "carrossel-banners");

    // Começa dinâmico: seletor em "1" e o campo de segundos aparece.
    const inicio = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const w = ed.getWrapper()?.find('[data-os-widget="banner"]')[0];
      if (!w) throw new Error("sem carrossel");
      ed.select(w);
      const t = w.getTrait("os-bn-timing") as unknown as { view?: { getInputElem(): HTMLElement } };
      const box = t.view?.getInputElem();
      return {
        modo: (box?.querySelector(".os-bnp-mode") as HTMLSelectElement)?.value,
        temSegundos: !!box?.querySelector(".os-bnp-secs"),
      };
    });
    expect(inicio.modo).toBe("1");
    expect(inicio.temSegundos).toBe(true);

    // Estático → autoplay=0 e some o campo de segundos.
    await setField(page, "os-bn-timing", ".os-bnp-mode", "0");
    expect((await attrs(page, ".os-bn"))["data-os-autoplay"]).toBe("0");
    expect(await hasField(page, "os-bn-timing", ".os-bnp-secs")).toBe(false);

    // Dinâmico de novo e muda os segundos.
    await setField(page, "os-bn-timing", ".os-bnp-mode", "1");
    await setField(page, "os-bn-timing", ".os-bnp-secs", "8");
    expect((await attrs(page, ".os-bn"))["data-os-interval"]).toBe("8");
    expect(BANNER_MAX_SLIDES).toBe(5);
    await page.close();
  });
});

/** Estado do carrossel na página publicada. */
const state = (page: Page) =>
  page.evaluate(() => {
    const bn = document.querySelector(".os-bn") as HTMLElement;
    const dots = Array.from(document.querySelectorAll<HTMLButtonElement>(".os-bn-dot"));
    const track = document.querySelector("[data-os-bn-track]") as HTMLElement;
    return {
      js: bn.classList.contains("os-bn-js"),
      dots: dots.length,
      labels: dots.map((d) => d.getAttribute("aria-label")),
      active: dots.findIndex((d) => d.getAttribute("aria-current") === "true"),
      scrollLeft: track.scrollLeft,
      clientWidth: track.clientWidth,
    };
  });

describe("carrossel de banners na página", () => {
  it("liga o JS, cria uma bolinha por banner e navega pelas setas/bolinhas", async () => {
    const page = await openEditor(browser, {});
    await addBlock(page, "carrossel-banners");
    await setField(page, "os-bn-images", ".os-bnp-count select", "3");
    const html = await exportPage(page);
    await page.close();

    const site = await openSite(browser, html, { contextOptions: { reducedMotion: "reduce" } });
    const s = await state(site.page);
    expect(s.js).toBe(true);
    expect(s.dots).toBe(3);
    expect(s.labels).toEqual(["Ir para o banner 1", "Ir para o banner 2", "Ir para o banner 3"]);
    expect(s.active).toBe(0);

    await site.page.click(".os-bn-next");
    await site.page.waitForTimeout(50);
    const s2 = await state(site.page);
    expect(s2.scrollLeft).toBeGreaterThan(s2.clientWidth - 5);
    expect(s2.active).toBe(1);

    await site.page.click(".os-bn-dot:nth-child(3)");
    await site.page.waitForTimeout(50);
    expect((await state(site.page)).active).toBe(2);

    expect(site.requests.filter((r) => r.url.startsWith("http://") && !r.url.includes("site.test"))).toEqual([]);
    await site.context.close();
  });

  it("passa sozinho (dinâmico)", async () => {
    const page = await openEditor(browser, {});
    await addBlock(page, "carrossel-banners");
    await setField(page, "os-bn-timing", ".os-bnp-secs", "2");
    const html = await exportPage(page);
    await page.close();

    const site = await openSite(browser, html);
    expect((await state(site.page)).scrollLeft).toBe(0);
    await site.page.waitForTimeout(2600);
    expect((await state(site.page)).scrollLeft).toBeGreaterThan(50);
    await site.context.close();
  });
});
