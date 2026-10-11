/**
 * Vitrine de produtos no editor de verdade (GrapesJS no Chromium): os blocos da
 * categoria "Loja" entram com os cartões e as partes geradas (selo, avaliação,
 * preço, frete, vendidos, estoque) desenhadas a partir dos atributos; mudar o
 * preço redesenha a parte e o HTML salvo; preço inválido avisa e não grava; a
 * lista "Página do produto" aparece sempre no cartão; cartão sem destino tem o
 * aviso só no canvas; mostrar/ocultar, moeda, formato, modelo e cores; o
 * "＋ Adicionar produto"; e o HTML salvo reaberto refaz as partes.
 */
import * as cheerio from "cheerio";
import type { Component } from "grapesjs";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareForEditor } from "@/lib/editor-html";
import {
  addBlock,
  attrs,
  type EditorWindow,
  editorOutput,
  exportPage,
  openEditor,
  openSite,
  pageErrors,
  setAttrs,
  setTrait,
} from "./blocks-harness";
import { fakeId } from "./helpers";

const WIDGET = '[data-os-widget="products"]';
const CARD = "a[data-os-product]";
const LOJA = fakeId("loja");
const PRODUTO = fakeId("produto");
const PAGES = [
  { id: LOJA, name: "Loja" },
  { id: PRODUTO, name: "Fone de ouvido", type: "SALES" },
];
const LINKS = [{ key: "checkout", label: "Checkout principal", kind: "CHECKOUT" }];

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** O que o canvas mostra de um cartão (pela posição na página). */
const card = (page: Page, i = 0) =>
  page.evaluate((index) => {
    const ed = (window as unknown as EditorWindow).ed;
    const doc = ed.Canvas.getDocument() as Document;
    const view = doc.defaultView as Window;
    const el = doc.querySelectorAll<HTMLElement>("a[data-os-product]")[index];
    const text = (sel: string) => el.querySelector(sel)?.textContent ?? null;
    const shown = (sel: string) => {
      const part = el.querySelector(sel);
      return !!part && view.getComputedStyle(part).display !== "none";
    };
    return {
      name: text(".os-pd-name"),
      badge: text(".os-pd-badge"),
      off: text(".os-pd-off"),
      old: text(".os-pd-old"),
      now: text(".os-pd-now"),
      cents: text(".os-pd-cents"),
      inst: text(".os-pd-inst"),
      ship: text(".os-pd-ship"),
      sold: text(".os-pd-sold"),
      stock: text(".os-pd-stock"),
      rating: el.querySelector(".os-pd-stars")?.getAttribute("aria-label") ?? null,
      shownBadge: shown(".os-pd-badge"),
      shownOff: shown(".os-pd-off"),
      shownStock: shown(".os-pd-stock"),
      // Cartão sem destino: só um contorno tracejado (o aviso fica um só, no alto da vitrine).
      outline: view.getComputedStyle(el).outlineStyle,
      label: view.getComputedStyle(el, "::after").content,
    };
  }, i);

/** Aviso do canvas no alto da vitrine (n-ésima da página): "N produtos ainda sem página…". */
const warning = (page: Page, i = 0) =>
  page.evaluate((index) => {
    const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
    const shop = doc.querySelectorAll('[data-os-widget="products"]')[index] as Element;
    return (doc.defaultView as Window).getComputedStyle(shop, "::before").content;
  }, i);

/** Campo de um trait do painel (o mesmo desenhado em Configurações), digitado como a pessoa faz. */
async function typeField(page: Page, selector: string, trait: string, value: string) {
  return page.evaluate(
    ([sel, name, val]) => {
      const ed = (window as unknown as EditorWindow).ed;
      const comp = ed.getWrapper()?.find(sel as string)[0];
      if (!comp) throw new Error(`nada com ${sel}`);
      if (ed.getSelected() !== comp) ed.select(comp);
      const t = comp.getTrait(name as string);
      const view = (t as unknown as { view?: { getInputElem(): HTMLElement } }).view;
      if (!view) throw new Error(`campo ${name} não desenhado`);
      const box = view.getInputElem();
      const input = box.querySelector("input") as HTMLInputElement;
      input.value = val as string;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const err = box.querySelector("[data-os-field-err]") as HTMLElement | null;
      return { error: err && err.style.display !== "none" ? err.textContent : "", shown: input.value };
    },
    [selector, trait, value] as const,
  );
}

/** Nomes dos campos das Configurações do componente selecionado, na ordem. */
const traitNames = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const ed = (window as unknown as EditorWindow).ed;
    const comp = ed.getWrapper()?.find(sel)[0];
    if (!comp) throw new Error(`nada com ${sel}`);
    ed.select(comp);
    return comp.getTraits().map((t) => String(t.get("name")));
  }, selector);

const undo = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as EditorWindow).ed.UndoManager.undo();
  });

/** HTML com os atributos em ordem alfabética (o GrapesJS pode trocar id/class de lugar). */
function sortedAttrs(html: string) {
  const $ = cheerio.load(html);
  $("*").each((_, el) => {
    if (!("attribs" in el)) return;
    el.attribs = Object.fromEntries(Object.entries(el.attribs).sort(([a], [b]) => a.localeCompare(b)));
  });
  return $.html();
}

describe("bloco Grade de produtos", () => {
  let page: Page;
  beforeAll(async () => {
    page = await openEditor(browser, { pages: PAGES, links: LINKS });
    await addBlock(page, "grade-produtos");
    await page.waitForTimeout(100);
  }, 60_000);
  afterAll(() => page?.close());

  it("entra com 8 cartões e as partes desenhadas pelos atributos; o aviso de destino fica só no canvas", async () => {
    expect(pageErrors(page)).toEqual([]);
    expect(await attrs(page, WIDGET)).toMatchObject({
      "data-os-layout": "grid",
      "data-os-cols": "4",
      "data-os-cols-m": "2",
      "data-os-card": "classic",
      "data-os-currency": "BRL",
      "data-os-show-more": "0",
    });
    const first = await card(page, 0);
    expect(first).toMatchObject({
      name: "Fone de ouvido Bluetooth sem fio",
      badge: "Mais vendido",
      off: "41% OFF",
      old: "R$ 219,90",
      now: "R$ 129,90",
      cents: "90",
      inst: "12x R$ 10,83 sem juros",
      ship: "Frete grátis",
      sold: "+5mil vendidos",
      rating: "Avaliação 4,7 de 5, 2.381 avaliações",
      stock: "",
      shownBadge: true,
      shownStock: false,
    });
    expect(first.outline).toBe("dashed");
    // Um aviso só, na vitrine (nada de etiqueta em cima da foto de cada cartão).
    expect(first.label).toBe("none");
    expect(await warning(page)).toBe(
      '"8 produtos ainda sem página: use “Criar as páginas que faltam” nas Configurações da vitrine, ou clique em cada um e escolha a página dele"',
    );
    // Segundo: parcela com valor próprio (sem "sem juros") e sem selo (parte vazia some).
    expect(await card(page, 1)).toMatchObject({ inst: "12x R$ 17,77", badge: "", shownBadge: false });

    const { html, css } = await editorOutput(page);
    const $ = cheerio.load(html);
    expect($(CARD).length).toBe(8);
    expect($(CARD).first().attr("href")).toBe("#");
    expect($(CARD).first().attr("data-os-link")).toBeUndefined();
    expect($(CARD).first().find(".os-pd-price .os-pd-now").text()).toBe("R$ 129,90");
    // Frase dos leitores de tela + % OFF, antigo, preço e parcelas.
    expect($(CARD).first().find(".os-pd-price > *").length).toBe(5);
    expect($(CARD).first().find(".os-pd-price > .os-pd-sr").text()).toBe("De R$ 219,90 por R$ 129,90 (41% OFF)");
    expect($(CARD).first().find(".os-pd-name").text()).toBe("Fone de ouvido Bluetooth sem fio");
    // Foto sem descrição: o nome já está no h3 do mesmo link (não é lido duas vezes).
    expect($(CARD).first().find("img.os-pd-img").attr("alt")).toBe("");
    expect($(".os-pd-nav").length).toBe(2);
    expect($(".os-pd-nav .os-pd-sr").first().text()).toBe("Anterior");
    expect(css).toContain(".os-products{");
    expect(css).toMatch(/\.os-pd-row/);
    // O aviso é só do canvas.
    expect(html).not.toContain("data-os-cv-aviso");
    expect(html + css).not.toContain("ainda sem página");
  });

  it("clicar no preço, no selo ou nos dados seleciona o produto; entre os cartões, a vitrine", async () => {
    const selected = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      return [".os-pd-price", ".os-pd-badge", ".os-pd-body", ".os-pd-media", ".os-pd-track", ".os-pd-wrap"].map(
        (sel) => {
          ed.select(ed.getWrapper()?.find(sel)[0]);
          const s = ed.getSelected();
          return s?.getAttributes()["data-os-product"] !== undefined ? "produto" : (s?.get("type") ?? null);
        },
      );
    });
    expect(selected).toEqual(["produto", "produto", "produto", "produto", "os-products", "os-products"]);
  });

  it("Configurações do cartão: preço inválido avisa e não grava; preço e antigo redesenham; nome acompanha", async () => {
    const before = (await attrs(page, CARD))["data-os-pd-price"];
    expect(await typeField(page, CARD, "data-os-pd-price", "abc")).toMatchObject({
      error: "Preço não reconhecido — use, por exemplo, 49,90",
    });
    expect(await typeField(page, CARD, "data-os-pd-price", "49,900")).toMatchObject({
      error: "Use 2 algarismos para os centavos (49,90) ou ponto para o milhar (49.900).",
    });
    expect(await typeField(page, CARD, "data-os-pd-price", "")).toMatchObject({ error: "Digite o preço do produto." });
    expect((await attrs(page, CARD))["data-os-pd-price"]).toBe(before);

    expect(await typeField(page, CARD, "data-os-pd-price", "R$ 89,9")).toEqual({ error: "", shown: "89,90" });
    expect((await attrs(page, CARD))["data-os-pd-price"]).toBe("8990");
    expect(await card(page, 0)).toMatchObject({ now: "R$ 89,90", off: "59% OFF", inst: "12x R$ 7,49 sem juros" });

    // Sem preço antigo: o % OFF e o riscado somem.
    expect(await typeField(page, CARD, "data-os-pd-old", "")).toEqual({ error: "", shown: "" });
    expect(await card(page, 0)).toMatchObject({ off: null, old: null, now: "R$ 89,90" });
    expect(await typeField(page, CARD, "data-os-pd-inst", "30")).toMatchObject({
      error: "Use um número inteiro de 0 a 24.",
    });
    expect(await typeField(page, CARD, "data-os-pd-stock", "3")).toMatchObject({ error: "" });
    expect(await card(page, 0)).toMatchObject({ stock: "Restam 3 unidades", shownStock: true });
    expect(await typeField(page, CARD, "data-os-pd-rating", "4,2")).toEqual({ error: "", shown: "4,2" });
    expect(await card(page, 0)).toMatchObject({ rating: "Avaliação 4,2 de 5, 2.381 avaliações" });

    await setTrait(page, CARD, "os-pd-name", "Fone <b>sem fio</b> premium");
    expect(await card(page, 0)).toMatchObject({ name: "Fone sem fio premium" });
    const $ = cheerio.load((await editorOutput(page)).html);
    expect($(CARD).first().find(".os-pd-name").html()).toBe("Fone sem fio premium");
    expect($(CARD).first().find("img").attr("alt")).toBe("");
    expect($(CARD).first().find(".os-pd-now").text()).toBe("R$ 89,90");
    expect($(CARD).first().find(".os-pd-stock").text()).toBe("Restam 3 unidades");

    // Desfazer volta o atributo e o desenho.
    await undo(page);
    await undo(page);
    await undo(page);
    expect((await attrs(page, CARD))["data-os-pd-stock"]).toBe("");
    expect(await card(page, 0)).toMatchObject({ stock: "", shownStock: false });
    expect(pageErrors(page)).toEqual([]);
  });

  it('destino: “Página do produto” logo no começo; escolher a página tira o aviso; “— nenhum —” não deixa data-os-link=""', async () => {
    const names = await traitNames(page, CARD);
    expect(names.slice(0, 5)).toEqual(["os-h-pd-destino", "os-pd-criar-pagina", "os-page", "data-os-link", "href"]);
    const labels = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const t = ed.getSelected()?.getTrait("os-page");
      return [t?.get("label"), (t?.get("options") as { label: string }[]).map((o) => o.label)];
    });
    // Sem o diálogo do editor (aqui só o GrapesJS), nada de "＋ Criar página deste produto".
    expect(labels).toEqual(["Página do produto", ["— nenhuma —", "Loja", "Fone de ouvido"]]);
    const createRow = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Criar página"));
      const row = btn?.closest<HTMLElement>('[class*="trait__wrp"]');
      return row ? row.style.display : "sem botão";
    });
    expect(createRow).toBe("none");

    await setTrait(page, CARD, "os-page", PRODUTO);
    expect((await attrs(page, CARD)).href).toBe(`os-page:${PRODUTO}`);
    // (selecionado, o cartão tem o contorno da seleção do editor: só não é mais o tracejado)
    expect((await card(page, 0)).outline).not.toBe("dashed");
    expect(await warning(page)).toBe(
      '"7 produtos ainda sem página: use “Criar as páginas que faltam” nas Configurações da vitrine, ou clique em cada um e escolha a página dele"',
    );
    // A linha "Vai para" mostra a página do produto.
    const info = await page.evaluate(() =>
      (window as unknown as EditorWindow).ed.getSelected()?.getTrait("os-destino")?.get("text"),
    );
    expect(info).toBe("Página do produto: Fone de ouvido");

    await setTrait(page, CARD, "data-os-link", "checkout");
    expect((await attrs(page, CARD))["data-os-link"]).toBe("checkout");
    await setTrait(page, CARD, "data-os-link", "");
    expect((await attrs(page, CARD))["data-os-link"]).toBeUndefined();
    await setTrait(page, CARD, "os-page", "");
    expect((await attrs(page, CARD)).href).toBe("#");
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed.select();
    });
    expect((await card(page, 0)).outline).toBe("dashed");
    expect(await warning(page)).toMatch(/^"8 produtos/);
    await setTrait(page, CARD, "href", "minhaloja.com/fone");
    expect((await attrs(page, CARD)).href).toBe("https://minhaloja.com/fone");
    // (selecionado, o cartão tem o contorno da seleção do editor: só não é mais o tracejado)
    expect((await card(page, 0)).outline).not.toBe("dashed");
    // Todos com destino: o aviso some; um só faltando, a frase no singular.
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const cards = ed.getWrapper()?.find("a[data-os-product]") ?? [];
      cards.slice(1).forEach((c, i) => {
        c.addAttributes({ href: i ? `https://minhaloja.com/p${i}` : "#" });
      });
    });
    expect(await warning(page)).toBe(
      '"1 produto ainda sem página: use “Criar as páginas que faltam” nas Configurações da vitrine, ou clique nele e escolha a página dele"',
    );
    await setAttrs(page, `${CARD}[href="#"]`, { href: "https://minhaloja.com/p0" });
    expect(await warning(page)).toBe("none");
    // Volta como estava (os testes seguintes contam com os cartões sem destino).
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      for (const c of ed.getWrapper()?.find("a[data-os-product]").slice(1) ?? []) c.addAttributes({ href: "#" });
    });
    expect(await warning(page)).toMatch(/^"7 produtos/);
  });

  it("Configurações da vitrine: moeda redesenha todos os cartões; mostrar/ocultar; formato e modelo", async () => {
    await setTrait(page, WIDGET, "data-os-currency", "USD");
    expect(await card(page, 0)).toMatchObject({ now: "US$ 89.90" });
    expect(await card(page, 2)).toMatchObject({ now: "US$ 299.90", old: "US$ 497.48" });
    const { html } = await editorOutput(page);
    expect(cheerio.load(html)(CARD).eq(2).find(".os-pd-now").text()).toBe("US$ 299.90");

    await setTrait(page, WIDGET, "data-os-show-off", false);
    expect((await attrs(page, WIDGET))["data-os-show-off"]).toBe("0");
    expect(await card(page, 2)).toMatchObject({ shownOff: false });
    await setTrait(page, WIDGET, "data-os-show-off", true);
    expect(await card(page, 2)).toMatchObject({ shownOff: true });

    const state = () =>
      page.evaluate(() => {
        const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
        const view = doc.defaultView as Window;
        const css = (sel: string) => view.getComputedStyle(doc.querySelector(sel) as Element);
        return {
          more: css(".os-pd-more").display,
          track: css(".os-pd-track").display,
          price: css(".os-pd-price").display,
          nav: css(".os-pd-nav").display,
        };
      });
    expect(await state()).toEqual({ more: "none", track: "grid", price: "flex", nav: "none" });
    await setTrait(page, WIDGET, "data-os-show-more", true);
    await setTrait(page, WIDGET, "data-os-layout", "carousel");
    await setTrait(page, WIDGET, "data-os-card", "compact");
    // Setas só com o script da página (nada roda no canvas).
    expect(await state()).toEqual({ more: "block", track: "flex", price: "contents", nav: "none" });
    expect(await attrs(page, WIDGET)).toMatchObject({
      "data-os-show-more": "1",
      "data-os-layout": "carousel",
      "data-os-card": "compact",
    });
    // Cor padrão do modelo compacto (% OFF vermelho) e a cor trocada na vitrine.
    const color = () =>
      page.evaluate(() => {
        const ed = (window as unknown as EditorWindow).ed;
        const w = ed.getWrapper()?.find('[data-os-widget="products"]')[0];
        if (w) ed.select(w);
        return w?.getTrait("os-pd-color-off")?.getValue();
      });
    expect(await color()).toBe("#cc1f3b");
    await setTrait(page, WIDGET, "os-pd-color-off", "#7c3aed");
    expect(await color()).toBe("#7c3aed");
    expect((await editorOutput(page)).css).toMatch(/--os-pd-off:#7c3aed/);
  });

  it("“＋ Adicionar produto”: cartão novo no fim da trilha, selecionado e sem destino", async () => {
    const added = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const w = ed.getWrapper()?.find('[data-os-widget="products"]')[0];
      if (!w) throw new Error("sem vitrine");
      ed.select(w);
      const t = w.getTrait("os-pd-add");
      (t?.get("command") as (e: unknown, t: unknown) => void)(ed, t);
      const sel = ed.getSelected();
      return {
        cards: ed.getWrapper()?.find("a[data-os-product]").length,
        last: ed.getWrapper()?.find("a[data-os-product]").at(-1) === sel,
        href: sel?.getAttributes().href,
        name: sel?.getName(),
      };
    });
    expect(added).toEqual({ cards: 9, last: true, href: "#", name: "Produto · Novo produto" });
    expect(await card(page, 8)).toMatchObject({ name: "Novo produto", now: "US$ 99.90", off: "33% OFF" });
  });

  it("duplicar e excluir um cartão pela barra; as partes não saem sozinhas", async () => {
    const result = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const count = () => ed.getWrapper()?.find("a[data-os-product]").length;
      const first = ed.getWrapper()?.find("a[data-os-product]")[0];
      ed.select(first);
      ed.runCommand("tlb-clone");
      const afterClone = count();
      ed.select(ed.getWrapper()?.find("a[data-os-product]")[1]);
      ed.runCommand("tlb-delete");
      const part = ed.getWrapper()?.find(".os-pd-price")[0];
      return {
        afterClone,
        afterDelete: count(),
        partRemovable: part?.get("removable"),
        partCopy: part?.get("copyable"),
      };
    });
    expect(result).toEqual({ afterClone: 10, afterDelete: 9, partRemovable: false, partCopy: false });
    expect(pageErrors(page)).toEqual([]);
  });

  it("projeto salvo e HTML reaberto: as partes são refeitas (sem elementos repetidos)", async () => {
    const first = await editorOutput(page);
    const project = await page.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData());
    const again = await openEditor(browser, { project, pages: PAGES, links: LINKS });
    expect(sortedAttrs((await editorOutput(again)).html)).toBe(sortedAttrs(first.html));
    await again.close();
    const reopened = await page.evaluate((h) => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.setComponents(h, { asDocument: true } as never);
      const price = ed.getWrapper()?.find(".os-pd-price")[0];
      return { children: price?.components().length, type: price?.get("type"), html: ed.getHtml() };
    }, prepareForEditor(first.html).html);
    expect(reopened.children).toBe(0);
    expect(reopened.type).toBe("os-product-part");
    const $ = cheerio.load(reopened.html);
    expect($(CARD).first().find(".os-pd-price .os-pd-now").length).toBe(1);
    expect($(CARD).first().find(".os-pd-now").text()).toBe("US$ 89.90");
    // Mudar o atributo de novo depois de reabrir também redesenha.
    await setTrait(page, CARD, "data-os-pd-price", "1000");
    expect(await card(page, 0)).toMatchObject({ now: "US$ 10" });
  });
});

describe("cartão numa oferta de uma página só", () => {
  it("a lista “Página do produto” aparece mesmo assim", async () => {
    const page = await openEditor(browser, { pages: [{ id: LOJA, name: "Loja" }] });
    await addBlock(page, "lista-ofertas-dia");
    const names = await traitNames(page, CARD);
    expect(names).toContain("os-page");
    // Um link comum fora da vitrine continua sem a lista (só uma página).
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed.getWrapper()?.append('<a id="comum" href="#">Link</a>');
    });
    expect(await traitNames(page, "#comum")).not.toContain("os-page");
    await page.close();
  });
});

describe("todos os blocos da Loja", () => {
  let page: Page;
  beforeAll(async () => {
    page = await openEditor(browser, { pages: PAGES });
    for (const id of ["grade-produtos", "carrossel-produtos", "faixa-ofertas", "oferta-do-dia", "lista-ofertas-dia"]) {
      await addBlock(page, id);
    }
    await page.waitForTimeout(100);
  }, 60_000);
  afterAll(() => page?.close());

  it("entram sem erros, com o modelo, o formato e as cores de cada um", async () => {
    expect(pageErrors(page)).toEqual([]);
    const { html, css } = await editorOutput(page);
    const $ = cheerio.load(html);
    const widgets = $(WIDGET)
      .toArray()
      .map((el) => [$(el).attr("data-os-layout"), $(el).attr("data-os-card"), $(el).find(CARD).length]);
    expect(widgets).toEqual([
      ["grid", "classic", 8],
      ["carousel", "classic", 8],
      ["carousel", "compact", 8],
      ["grid", "classic", 1],
      ["carousel", "classic", 7],
      ["grid", "highlight", 4],
    ]);
    expect($(`.os-pd-row > ${WIDGET}`).length).toBe(2);
    // Faixa de ofertas: fundo azul e título branco na regra da própria vitrine.
    expect(css).toMatch(/--os-pd-bg:#1462d6/);
    const faixa = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const w = ed.getWrapper()?.find('[data-os-widget="products"]')[2];
      if (w) ed.select(w);
      return [w?.getTrait("os-pd-color-bg")?.getValue(), w?.getTrait("os-pd-color-title")?.getValue()];
    });
    expect(faixa).toEqual(["#1462d6", "#ffffff"]);
    // Lista de ofertas do dia: selo e estoque.
    const list = $(WIDGET).eq(5).find(CARD).first();
    expect(list.find(".os-pd-badge").text()).toBe("OFERTA DO DIA");
    expect(list.find(".os-pd-stock").text()).toBe("Restam 19 unidades");
    expect($(WIDGET).eq(5).find(CARD).eq(2).find(".os-pd-stk").attr("class")).toBe("os-pd-stk os-pd-low");
  });

  it("na página publicada (sem script): grade em colunas, carrossel numa linha, setas escondidas; no celular, 2 colunas", async () => {
    const html = await exportPage(page);
    // As partes vão prontas no HTML final (estrelas com a largura da nota).
    const $ = cheerio.load(html);
    expect($(`${CARD} .os-pd-stars-on`).first().attr("style")).toBe("width:94%");
    expect($(`${CARD} .os-pd-now`).first().text()).toBe("R$ 129,90");
    for (const [width, cols] of [
      [1280, 4],
      [390, 2],
    ] as const) {
      const site = await openSite(browser, html.replace(/<script data-os-runtime>[\s\S]*?<\/script>/, ""), {
        contextOptions: { viewport: { width, height: 900 } },
      });
      const layout = await site.page.evaluate(() => {
        const widgets = document.querySelectorAll('[data-os-widget="products"]');
        const rows = (w: Element) => {
          const tops = Array.from(w.querySelectorAll("a[data-os-product]")).map((c) =>
            Math.round(c.getBoundingClientRect().top),
          );
          return { first: tops.filter((t) => t === tops[0]).length, rows: new Set(tops).size };
        };
        const nav = getComputedStyle(widgets[1].querySelector(".os-pd-nav") as Element).display;
        const scroll = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        return { grid: rows(widgets[0]), carousel: rows(widgets[1]), nav, scroll };
      });
      expect(layout.grid.first).toBe(cols);
      expect(layout.carousel.rows).toBe(1);
      expect(layout.nav).toBe("none");
      // Nada passa da largura da tela (o carrossel rola dentro dele).
      expect(layout.scroll).toBe(0);
      await site.context.close();
    }
  });
});

describe("revisão: texto dentro do cartão, clicar num bloco, idioma, preço em dólar, “Ver todas” e carrossel", () => {
  let page: Page;
  beforeAll(async () => {
    page = await openEditor(browser, { pages: PAGES, links: LINKS });
    await addBlock(page, "texto");
    await addBlock(page, "grade-produtos");
    await page.waitForTimeout(100);
  }, 60_000);
  afterAll(() => page?.close());

  /** Abre a edição de texto de um elemento e diz se o botão de link da barra está à vista. */
  const linkButton = (sel: string) =>
    page.evaluate(async (s) => {
      const ed = (window as unknown as EditorWindow).ed;
      const comp = ed.getWrapper()?.find(s)[0];
      if (!comp) throw new Error(`nada com ${s}`);
      ed.select(comp);
      const view = comp.getView() as unknown as {
        onActive(e: unknown): Promise<void>;
        disableEditing(): Promise<void>;
      };
      await view.onActive({});
      await new Promise((r) => setTimeout(r, 50));
      const btn = document.querySelector('.gjs-rte-action[title="Criar ou remover link"]') as HTMLElement | null;
      const shown = !!btn && btn.style.display !== "none";
      await view.disableEditing();
      return shown;
    }, sel);

  it("nome do produto (dentro do link do cartão): a barra de texto não oferece link; um texto comum oferece", async () => {
    expect(await linkButton(`${CARD} .os-pd-name`)).toBe(false);
    expect(await linkButton("p")).toBe(true);
    expect(await linkButton(`${CARD} .os-pd-name`)).toBe(false);
  });

  it("link que ficou dentro do cartão (colado ou de antes) sai do HTML só com o texto: o cartão não se quebra", async () => {
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const name = ed.getWrapper()?.find("a[data-os-product] .os-pd-name")[0];
      name?.components('<a class="link" href="">Fone</a> de ouvido');
    });
    const { html } = await editorOutput(page);
    const $ = cheerio.load(html);
    expect($(CARD).length).toBe(8);
    expect($(`${CARD} a`).length).toBe(0);
    expect($(CARD).first().find(".os-pd-name").text()).toBe("Fone de ouvido");
    expect($(CARD).first().find("[data-os-pd-part]").length).toBe(6);
    // Reaberto do HTML salvo, continua com 8 cartões inteiros.
    const reopened = await page.evaluate((h) => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.setComponents(h, { asDocument: true } as never);
      return ed.getWrapper()?.find("a[data-os-product]").length;
    }, prepareForEditor(html).html);
    expect(reopened).toBe(8);
  });

  it("Moeda em peso mexicano: frases em espanhol (pela moeda); “Idioma dos textos” escolhe outro; setas acompanham", async () => {
    await setTrait(page, WIDGET, "data-os-currency", "MXN");
    await setTrait(page, CARD, "data-os-pd-stock", "1");
    expect(await card(page, 0)).toMatchObject({
      now: "$129.90",
      inst: "12x $10.83 sin intereses",
      stock: "¡Última unidad!",
      rating: "Calificación 4.7 de 5, 2,381 opiniones",
    });
    const nav = () =>
      page.evaluate(() => {
        const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
        return Array.from(doc.querySelectorAll(".os-pd-nav .os-pd-sr")).map((e) => e.textContent);
      });
    expect(await nav()).toEqual(["Anterior", "Siguiente"]);
    await setTrait(page, WIDGET, "data-os-pd-lang", "en");
    expect(await card(page, 0)).toMatchObject({ inst: "12x $10.83 interest-free", stock: "Last one!" });
    expect(await nav()).toEqual(["Previous", "Next"]);
    const $ = cheerio.load((await editorOutput(page)).html);
    expect($(WIDGET).attr("data-os-pd-lang")).toBe("en");
    expect($(CARD).first().find(".os-pd-inst").text()).toBe("12x $10.83 interest-free");
    expect($(".os-pd-nav .os-pd-sr").first().text()).toBe("Previous");
    // "Pela moeda" tira o atributo: volta o espanhol do peso.
    await setTrait(page, WIDGET, "data-os-pd-lang", "");
    expect((await attrs(page, WIDGET))["data-os-pd-lang"]).toBeUndefined();
    expect(await card(page, 0)).toMatchObject({ stock: "¡Última unidad!" });
    // Desfazer volta o idioma escolhido.
    await undo(page);
    expect(await card(page, 0)).toMatchObject({ stock: "Last one!" });
    expect(pageErrors(page)).toEqual([]);
  });

  it("preço em dólar/peso: “1,299” é mil duzentos e noventa e nove; o exemplo do erro segue a moeda", async () => {
    expect(await typeField(page, CARD, "data-os-pd-price", "1,299")).toEqual({ error: "", shown: "1,299.00" });
    expect((await attrs(page, CARD))["data-os-pd-price"]).toBe("129900");
    expect(await typeField(page, CARD, "data-os-pd-price", "abc")).toMatchObject({
      error: "Preço não reconhecido — use, por exemplo, 49.90",
    });
    await setTrait(page, WIDGET, "data-os-currency", "BRL");
    expect(await typeField(page, CARD, "data-os-pd-price", "1,299")).toMatchObject({
      error: "Use 2 algarismos para os centavos (49,90) ou ponto para o milhar (49.900).",
    });
  });

  it("“Ver todas” ligado sem destino: aviso no canvas; com endereço, some; cor própria nas Cores", async () => {
    await setTrait(page, WIDGET, "data-os-show-more", true);
    const hint = () =>
      page.evaluate(() => {
        const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
        const more = doc.querySelector(".os-pd-more") as Element;
        return (doc.defaultView as Window).getComputedStyle(more, "::after").content;
      });
    expect(await hint()).toBe('"Escolha para onde leva em Configurações (ou desligue o “Ver todas” na vitrine)"');
    // "— nenhum —" no link da oferta não pede um checkout (como o cartão).
    await setTrait(page, ".os-pd-more", "data-os-link", "checkout");
    await setTrait(page, ".os-pd-more", "data-os-link", "");
    expect((await attrs(page, ".os-pd-more"))["data-os-link"]).toBeUndefined();
    await setAttrs(page, ".os-pd-more", { href: "https://minhaloja.com/todas" });
    expect(await hint()).toBe("none");
    await setTrait(page, WIDGET, "os-pd-color-more", "#ffffff");
    expect((await editorOutput(page)).css).toMatch(/--os-pd-more:#ffffff/);
  });

  it("clicar num bloco com algo da “Oferta do dia + ofertas” selecionado: o bloco entra depois, não espremido na linha", async () => {
    await addBlock(page, "oferta-do-dia");
    const placed = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const click = (id: string) => {
        const block = ed.Blocks.get(id);
        const config = ed.Blocks.getConfig() as unknown as { appendOnClick: (b: unknown, e: unknown) => void };
        config.appendOnClick(block, ed);
        return ed.getSelected();
      };
      const row = ed.getWrapper()?.find(".os-pd-row")[0];
      const pickCard = () => ed.select(row?.find("a[data-os-product]").at(-1));
      const out: Record<string, string> = {};
      for (const id of ["grade-produtos", "cabecalho-loja", "botao", "contador-barra"]) {
        pickCard();
        const added = click(id);
        const parent = added?.parent();
        out[id] =
          parent === ed.getWrapper() ? "página" : (parent?.getClasses().join(".") ?? String(parent?.get("tagName")));
      }
      return { out, row: row?.components().map((c: Component) => String(c.getAttributes()["data-os-widget"])) };
    });
    // Só vitrines na linha.
    expect(placed.row).toEqual(["products", "products"]);
    // Seções (vitrine, cabeçalho) vão para depois da seção cinza; elementos, logo depois da linha.
    expect(placed.out["grade-produtos"]).toBe("página");
    expect(placed.out["cabecalho-loja"]).toBe("página");
    expect(placed.out.botao).not.toBe("os-pd-row");
    expect(placed.out["contador-barra"]).not.toBe("os-pd-row");
    expect(pageErrors(page)).toEqual([]);
  });

  it("carrossel publicado: cabem inteiros os produtos por linha escolhidos (sem espaço dobrado entre os cartões)", async () => {
    const editor = await openEditor(browser, { pages: PAGES });
    for (const id of ["carrossel-produtos", "faixa-ofertas", "oferta-do-dia"]) await addBlock(editor, id);
    const html = (await exportPage(editor)).replace(/<script data-os-runtime>[\s\S]*?<\/script>/, "");
    await editor.close();
    for (const [width, expected] of [
      [1280, [5, 6, 1, 4]],
      [1024, [4, 4, 1, 3]],
    ] as const) {
      const site = await openSite(browser, html, { contextOptions: { viewport: { width, height: 900 } } });
      const shown = await site.page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-os-widget="products"]')).map((shop) => {
          const track = shop.querySelector("[data-os-pd-track]") as HTMLElement;
          const box = track.getBoundingClientRect();
          const cards = Array.from(track.querySelectorAll("a[data-os-product]")).map((c) => c.getBoundingClientRect());
          const whole = cards.filter((r) => r.left >= box.left - 1 && r.right <= box.right + 1).length;
          const gap = cards[1] ? Math.round(cards[1].left - cards[0].right) : 16;
          return { whole, gap };
        }),
      );
      expect(shown.map((s) => s.whole)).toEqual(expected);
      expect(new Set(shown.map((s) => s.gap))).toEqual(new Set([16]));
      await site.context.close();
    }
  });
});
