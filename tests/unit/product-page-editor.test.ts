/**
 * Página do produto no editor de verdade (GrapesJS no Chromium): blocos
 * "Galeria de fotos do produto" e "Caixa de compra" da categoria "Loja".
 *
 * - Galeria: a foto grande é gerada a partir da primeira miniatura (nunca
 *   guardada como elemento: reabrir o HTML salvo refaz), clicar nela seleciona
 *   a galeria, clicar numa miniatura seleciona a miniatura, "＋ Adicionar foto"
 *   até 8 (o botão vira "Máximo de 8 fotos"), "Usar como foto principal",
 *   trocar a foto ou a descrição da primeira redesenha a foto grande e dois
 *   cliques na miniatura abrem a escolha da foto.
 * - Caixa de compra: as MESMAS partes geradas e os mesmos campos do cartão da
 *   vitrine (preço inválido avisa, preço e moeda redesenham), o nome no h1, o
 *   "Comprar agora" já ligado ao checkout da oferta, a barra do celular e as
 *   cores; o HTML salvo reaberto refaz as partes.
 */
import * as cheerio from "cheerio";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareForEditor } from "@/lib/editor-html";
import { addBlock, attrs, type EditorWindow, editorOutput, openEditor, pageErrors, setTrait } from "./blocks-harness";

const GALLERY = '[data-os-widget="product-gallery"]';
const BUY = '[data-os-widget="product-buy"]';
const LINKS = [{ key: "checkout", label: "Checkout principal", kind: "CHECKOUT" }];
const PHOTO = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** HTML com os atributos em ordem alfabética. */
function sortedAttrs(html: string) {
  const $ = cheerio.load(html);
  $("*").each((_, el) => {
    if (!("attribs" in el)) return;
    el.attribs = Object.fromEntries(Object.entries(el.attribs).sort(([a], [b]) => a.localeCompare(b)));
  });
  return $.html();
}

/** O que o canvas mostra da galeria. */
const gallery = (page: Page) =>
  page.evaluate(() => {
    const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
    const g = doc.querySelector('[data-os-widget="product-gallery"]') as HTMLElement;
    const main = g.querySelector(".os-pg-stage img.os-pg-main") as HTMLImageElement | null;
    const thumbs = Array.from(g.querySelectorAll<HTMLImageElement>(".os-pg-thumb img"));
    return {
      main: main ? { src: main.getAttribute("src"), alt: main.getAttribute("alt") } : null,
      stageChildren: (g.querySelector(".os-pg-stage") as HTMLElement).children.length,
      thumbs: thumbs.map((i) => ({ src: i.getAttribute("src"), alt: i.getAttribute("alt") })),
    };
  });

/** Seleciona o primeiro elemento do canvas que casa com o seletor, como o clique faz. */
const clickSelect = (page: Page, sel: string, index = 0) =>
  page.evaluate(
    ([s, i]) => {
      const ed = (window as unknown as EditorWindow).ed;
      const comp = ed.getWrapper()?.find(s as string)[i as number];
      if (!comp) throw new Error(`nada com ${s}`);
      ed.select(comp);
      const sel = ed.getSelected();
      return sel ? `${sel.get("type")}${sel.getClasses().length ? `.${sel.getClasses().join(".")}` : ""}` : null;
    },
    [sel, index] as const,
  );

/** Roda o botão (os-action) de um campo das Configurações, como o clique no painel. */
const runAction = (page: Page, sel: string, trait: string, index = 0) =>
  page.evaluate(
    ([s, name, i]) => {
      const ed = (window as unknown as EditorWindow).ed;
      const comp = ed.getWrapper()?.find(s as string)[i as number];
      if (!comp) throw new Error(`nada com ${s}`);
      ed.select(comp);
      const t = comp.getTrait(name as string);
      const view = (t as unknown as { view?: { getInputElem(): HTMLElement } }).view;
      if (!view) throw new Error(`campo ${name} não desenhado`);
      const btn = view.getInputElem() as HTMLButtonElement;
      const before = { text: btn.textContent, disabled: btn.disabled };
      btn.click();
      return { before, after: { text: btn.textContent, disabled: btn.disabled } };
    },
    [sel, trait, index] as const,
  );

describe("bloco Galeria de fotos do produto", () => {
  let page: Page;
  beforeAll(async () => {
    page = await openEditor(browser, { pages: [{ id: "p1", name: "Loja" }] });
    await addBlock(page, "galeria-produto");
    await page.waitForTimeout(100);
  }, 60_000);
  afterAll(() => page?.close());

  it("entra com 4 miniaturas e a foto grande gerada da primeira (no canvas e no HTML salvo)", async () => {
    expect(pageErrors(page)).toEqual([]);
    const g = await gallery(page);
    expect(g.thumbs).toHaveLength(4);
    expect(g.main).toEqual({ src: g.thumbs[0].src, alt: "Foto 1 do produto" });
    const { html, css } = await editorOutput(page);
    const $ = cheerio.load(html);
    expect($(`${GALLERY} [data-os-pg-stage] > img.os-pg-main`).attr("alt")).toBe("Foto 1 do produto");
    expect($(`${GALLERY} button.os-pg-thumb[type="button"] > img`)).toHaveLength(4);
    expect(css).toContain(".os-pg{");
    // A foto grande não é um elemento do editor (nem nas camadas).
    const stage = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const s = ed.getWrapper()?.find("[data-os-pg-stage]")[0];
      return { children: s?.components().length, layerable: s?.get("layerable"), removable: s?.get("removable") };
    });
    expect(stage).toEqual({ children: 0, layerable: false, removable: false });
  });

  it("clicar na foto grande ou entre as miniaturas seleciona a galeria; na miniatura, a miniatura", async () => {
    expect(await clickSelect(page, "[data-os-pg-stage]")).toBe("os-product-gallery.os-pg");
    expect(await clickSelect(page, ".os-pg-thumbs")).toBe("os-product-gallery.os-pg");
    expect(await clickSelect(page, ".os-pg-thumb img", 1)).toBe("os-pg-thumb.os-pg-thumb");
    const names = await page.evaluate(() =>
      ((window as unknown as EditorWindow).ed.getSelected()?.getTraits() ?? []).map((t) => String(t.get("name"))),
    );
    // (mais o "Evento ao clicar" que todo botão ganha)
    expect(names.filter((n) => n.startsWith("os-pg-"))).toEqual([
      "os-pg-thumb-note",
      "os-pg-swap",
      "os-pg-main",
      "os-pg-alt",
    ]);
  });

  it("“Usar como foto principal”: a miniatura vai para o começo e a foto grande acompanha", async () => {
    await page.evaluate((src) => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.getWrapper()?.find(".os-pg-thumb img")[2]?.set("src", src);
    }, PHOTO);
    const r = await runAction(page, ".os-pg-thumb", "os-pg-main", 2);
    expect(r.before).toEqual({ text: "Usar como foto principal", disabled: false });
    // Já é a primeira: o botão diz isso e fica desligado.
    expect(r.after).toEqual({ text: "Esta é a foto principal", disabled: true });
    await page.waitForTimeout(50);
    const g = await gallery(page);
    expect(g.thumbs[0].src).toBe(PHOTO);
    expect(g.main?.src).toBe(PHOTO);
    expect(g.main?.alt).toBe("Foto 3 do produto");
    // Desfazer volta a ordem (e a foto grande).
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed.UndoManager.undo();
    });
    await page.waitForTimeout(50);
    expect((await gallery(page)).main?.alt).toBe("Foto 1 do produto");
  });

  it("trocar a foto ou a descrição da primeira miniatura redesenha a foto grande", async () => {
    await page.evaluate((src) => {
      (window as unknown as EditorWindow).ed.getWrapper()?.find(".os-pg-thumb img")[0]?.set("src", src);
    }, PHOTO);
    expect((await gallery(page)).main?.src).toBe(PHOTO);
    await setTrait(page, ".os-pg-thumb", "os-pg-alt", "Fone preto, de lado");
    expect((await gallery(page)).main?.alt).toBe("Fone preto, de lado");
    const $ = cheerio.load((await editorOutput(page)).html);
    expect($("[data-os-pg-stage] img").attr("src")).toBe(PHOTO);
    expect($(".os-pg-thumb img").first().attr("alt")).toBe("Fone preto, de lado");
  });

  it("dois cliques na miniatura (e “Trocar foto”) abrem a escolha da foto", async () => {
    const open = () => page.evaluate(() => (window as unknown as EditorWindow).ed.Assets.isOpen());
    await page.evaluate(() => {
      const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
      doc.querySelector(".os-pg-thumb img")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(await open()).toBe(true);
    await page.evaluate(() => (window as unknown as EditorWindow).ed.Assets.close());
    expect(await open()).toBe(false);
    await runAction(page, ".os-pg-thumb", "os-pg-swap", 1);
    expect(await open()).toBe(true);
    await page.evaluate(() => (window as unknown as EditorWindow).ed.Assets.close());
  });

  it("“＋ Adicionar foto” até 8: a nova fica selecionada; no limite, “Máximo de 8 fotos”", async () => {
    const first = await runAction(page, GALLERY, "os-pg-add");
    expect(first.before).toEqual({ text: "＋ Adicionar foto", disabled: false });
    await page.evaluate(() => (window as unknown as EditorWindow).ed.Assets.close());
    const selected = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const sel = ed.getSelected();
      return {
        type: sel?.get("type"),
        name: sel?.getName(),
        last: ed.getWrapper()?.find(".os-pg-thumb").at(-1) === sel,
      };
    });
    expect(selected).toEqual({ type: "os-pg-thumb", name: "Foto 5", last: true });
    for (let i = 0; i < 3; i++) await runAction(page, GALLERY, "os-pg-add");
    await page.evaluate(() => (window as unknown as EditorWindow).ed.Assets.close());
    expect((await gallery(page)).thumbs).toHaveLength(8);
    const full = await runAction(page, GALLERY, "os-pg-add");
    expect(full.before).toEqual({ text: "Máximo de 8 fotos", disabled: true });
    expect((await gallery(page)).thumbs).toHaveLength(8);
    expect(pageErrors(page)).toEqual([]);
  });

  it("projeto e HTML salvos reabertos: a foto grande é refeita (sem foto repetida)", async () => {
    const first = await editorOutput(page);
    const project = await page.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData());
    const again = await openEditor(browser, { project });
    // (o GrapesJS pode trocar id/class de lugar)
    expect(sortedAttrs((await editorOutput(again)).html)).toBe(sortedAttrs(first.html));
    await again.close();
    const reopened = await page.evaluate((h) => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.setComponents(h, { asDocument: true } as never);
      const stage = ed.getWrapper()?.find("[data-os-pg-stage]")[0];
      return { children: stage?.components().length, html: ed.getHtml() };
    }, prepareForEditor(first.html).html);
    expect(reopened.children).toBe(0);
    const $ = cheerio.load(reopened.html);
    expect($("[data-os-pg-stage] img")).toHaveLength(1);
    expect($("[data-os-pg-stage] img").attr("src")).toBe(PHOTO);
    expect($(".os-pg-thumb")).toHaveLength(8);
  });

  it("de 1 a 8 fotos: Duplicar e colar param no limite; a última miniatura não sai (nem com Delete)", async () => {
    const thumbs = () =>
      page.evaluate(() => {
        const ed = (window as unknown as EditorWindow).ed;
        const list = ed.getWrapper()?.find(".os-pg-thumb") ?? [];
        const tools = (c: (typeof list)[number]) =>
          ((c.get("toolbar") as { command?: unknown }[]) ?? [])
            .map((t) => t.command)
            .filter((c) => typeof c === "string");
        return { n: list.length, tools: list.map(tools) };
      });
    const run = (cmds: string[], index = 0) =>
      page.evaluate(
        ([names, i]) => {
          const ed = (window as unknown as EditorWindow).ed;
          const thumb = ed.getWrapper()?.find(".os-pg-thumb")[i as number];
          if (!thumb) throw new Error("sem miniatura");
          ed.select(thumb);
          for (const name of names as string[]) ed.runCommand(name);
        },
        [cmds, index] as const,
      );
    await page.waitForTimeout(50);
    // 8 fotos: a barra das miniaturas não tem "Duplicar"; duplicar e copiar/colar não acrescentam.
    expect((await thumbs()).tools.every((t) => !t.includes("tlb-clone") && t.includes("tlb-delete"))).toBe(true);
    await run(["tlb-clone", "tlb-clone", "core:copy", "core:paste"]);
    await page.waitForTimeout(50);
    expect((await thumbs()).n).toBe(8);
    // Uma a menos: volta a duplicar (até 8 de novo).
    await run(["core:component-delete"], 7);
    await page.waitForTimeout(50);
    expect((await thumbs()).tools[0]).toContain("tlb-clone");
    await run(["tlb-clone", "tlb-clone"]);
    await page.waitForTimeout(50);
    expect((await thumbs()).n).toBe(8);
    // Apagando até sobrar uma: ela não sai (nem pelo Delete) e a barra não tem "Excluir".
    for (let i = 7; i >= 1; i--) await run(["core:component-delete"], i);
    await page.waitForTimeout(50);
    expect((await thumbs()).n).toBe(1);
    await run(["core:component-delete"]);
    await page.waitForTimeout(50);
    const last = await thumbs();
    expect(last.n).toBe(1);
    expect(last.tools[0]).not.toContain("tlb-delete");
    expect((await gallery(page)).main).not.toBeNull();
    // Desfazer devolve as fotos (e os limites acompanham).
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed.UndoManager.undo();
    });
    await page.waitForTimeout(50);
    const back = await thumbs();
    expect(back.n).toBe(2);
    expect(back.tools.every((t) => t.includes("tlb-delete") && t.includes("tlb-clone"))).toBe(true);
    expect(pageErrors(page)).toEqual([]);
  });
});

describe("bloco Caixa de compra", () => {
  let page: Page;
  beforeAll(async () => {
    page = await openEditor(browser, { pages: [{ id: "p1", name: "Loja" }], links: LINKS });
    await addBlock(page, "caixa-compra");
    await page.waitForTimeout(100);
  }, 60_000);
  afterAll(() => page?.close());

  /** O que o canvas mostra da caixa de compra. */
  const box = () =>
    page.evaluate(() => {
      const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
      const el = doc.querySelector('[data-os-widget="product-buy"]') as HTMLElement;
      const text = (sel: string) => el.querySelector(sel)?.textContent ?? null;
      return {
        name: text("h1.os-pb-name"),
        now: text(".os-pd-now"),
        off: text(".os-pd-off"),
        old: text(".os-pd-old"),
        inst: text(".os-pd-inst"),
        ship: text(".os-pd-ship"),
        rating: el.querySelector(".os-pd-stars")?.getAttribute("aria-label") ?? null,
        buy: text(".os-pb-buy"),
      };
    });

  it("entra com o produto de exemplo: as mesmas partes do cartão, o h1 e o “Comprar agora” já no checkout", async () => {
    expect(pageErrors(page)).toEqual([]);
    expect(await attrs(page, BUY)).toMatchObject({
      "data-os-widget": "product-buy",
      "data-os-currency": "BRL",
      "data-os-pd-price": "12990",
      "data-os-pd-old": "21990",
      "data-os-pb-bar": "1",
    });
    expect(await box()).toEqual({
      name: "Fone de ouvido Bluetooth sem fio",
      now: "R$ 129,90",
      off: "41% OFF",
      old: "R$ 219,90",
      inst: "12x R$ 10,83 sem juros",
      ship: "Frete grátis",
      rating: "Avaliação 4,7 de 5, 2.381 avaliações",
      buy: "Comprar agora",
    });
    // Como o "Botão do checkout": já nasce ligado ao primeiro checkout da oferta.
    expect((await attrs(page, ".os-pb-buy"))["data-os-link"]).toBe("checkout");
    const { html, css } = await editorOutput(page);
    const $ = cheerio.load(html);
    expect($(`${BUY} [data-os-pd-part]`)).toHaveLength(6);
    expect($(`${BUY} .os-pd-price .os-pd-sr`).text()).toBe("De R$ 219,90 por R$ 129,90 (41% OFF)");
    expect($(`${BUY} .os-pb-trust li`)).toHaveLength(3);
    expect(css).toContain(".os-pb{");
  });

  it("clicar no preço ou no selo seleciona a caixa; os campos são os do cartão + moeda, barra e cores", async () => {
    expect(await clickSelect(page, `${BUY} .os-pd-price`)).toBe("os-product-buy.os-pb");
    const names = await page.evaluate(() =>
      ((window as unknown as EditorWindow).ed.getSelected()?.getTraits() ?? []).map((t) => String(t.get("name"))),
    );
    for (const n of [
      "os-pd-name",
      "data-os-pd-price",
      "data-os-pd-old",
      "data-os-pd-inst",
      "data-os-pd-inst-value",
      "data-os-pd-ship",
      "data-os-pd-sold",
      "data-os-pd-stock",
      "data-os-pd-badge",
      "data-os-pd-rating",
      "data-os-pd-reviews",
      "data-os-currency",
      "data-os-pd-lang",
      "data-os-pb-bar",
      "os-pb-color-btn",
    ]) {
      expect(names).toContain(n);
    }
    // Sem destino próprio (o "Comprar agora" é que leva ao checkout).
    expect(names).not.toContain("os-page");
    expect(names).not.toContain("href");
  });

  it("preço inválido avisa e não grava; preço, estoque, nome e moeda redesenham", async () => {
    const typeField = (trait: string, value: string) =>
      page.evaluate(
        ([name, val]) => {
          const ed = (window as unknown as EditorWindow).ed;
          const comp = ed.getWrapper()?.find('[data-os-widget="product-buy"]')[0];
          if (!comp) throw new Error("sem caixa");
          ed.select(comp);
          const view = (comp.getTrait(name) as unknown as { view: { getInputElem(): HTMLElement } }).view;
          const input = view.getInputElem().querySelector("input") as HTMLInputElement;
          input.value = val;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          const err = view.getInputElem().querySelector("[data-os-field-err]") as HTMLElement;
          return err.style.display !== "none" ? err.textContent : "";
        },
        [trait, value] as const,
      );
    expect(await typeField("data-os-pd-price", "abc")).toBe("Preço não reconhecido — use, por exemplo, 49,90");
    expect((await attrs(page, BUY))["data-os-pd-price"]).toBe("12990");
    expect(await typeField("data-os-pd-price", "99,9")).toBe("");
    expect(await box()).toMatchObject({ now: "R$ 99,90", off: "55% OFF", inst: "12x R$ 8,33 sem juros" });
    expect(await typeField("data-os-pd-stock", "3")).toBe("");
    await setTrait(page, BUY, "os-pd-name", "Fone <i>sem fio</i> premium");
    await setTrait(page, BUY, "data-os-currency", "MXN");
    expect(await box()).toMatchObject({ name: "Fone sem fio premium", now: "$99.90", inst: "12x $8.33 sin intereses" });
    const $ = cheerio.load((await editorOutput(page)).html);
    expect($("h1.os-pb-name").html()).toBe("Fone sem fio premium");
    expect($(`${BUY} .os-pd-stock`).text()).toBe("Quedan 3 unidades");
    // Desfazer volta a moeda e o desenho.
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed.UndoManager.undo();
    });
    expect(await box()).toMatchObject({ now: "R$ 99,90" });
  });

  it("“Barra de compra fixa embaixo no celular” e as cores ficam na caixa", async () => {
    await setTrait(page, BUY, "data-os-pb-bar", false);
    expect((await attrs(page, BUY))["data-os-pb-bar"]).toBe("0");
    await setTrait(page, BUY, "os-pb-color-btn", "#e11d48");
    const color = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const doc = ed.Canvas.getDocument() as Document;
      return (doc.defaultView as Window).getComputedStyle(doc.querySelector(".os-pb-buy") as Element).backgroundColor;
    });
    expect(color).toBe("rgb(225, 29, 72)");
    expect((await editorOutput(page)).css).toMatch(/--os-pb-btn:#e11d48/);
  });

  it("HTML salvo reaberto: as partes são refeitas a partir dos atributos (sem elementos repetidos)", async () => {
    const first = await editorOutput(page);
    const reopened = await page.evaluate((h) => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.setComponents(h, { asDocument: true } as never);
      const price = ed.getWrapper()?.find('[data-os-widget="product-buy"] .os-pd-price')[0];
      const name = ed.getWrapper()?.find("h1.os-pb-name")[0];
      return {
        children: price?.components().length,
        type: price?.get("type"),
        name: name?.get("type"),
        html: ed.getHtml(),
      };
    }, prepareForEditor(first.html).html);
    expect(reopened).toMatchObject({ children: 0, type: "os-product-part", name: "os-product-name" });
    const $ = cheerio.load(reopened.html);
    expect($(`${BUY} .os-pd-now`)).toHaveLength(1);
    expect($(`${BUY} .os-pd-now`).text()).toBe("R$ 99,90");
    await setTrait(page, BUY, "data-os-pd-price", "1000");
    expect(await box()).toMatchObject({ now: "R$ 10" });
    expect(pageErrors(page)).toEqual([]);
  });
});
