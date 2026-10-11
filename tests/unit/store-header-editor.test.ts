/**
 * Cabeçalho de loja no editor de verdade (GrapesJS no Chromium): o bloco entra
 * primeiro na categoria "Loja" com logo, local de entrega, pesquisa, carrinho e
 * categorias (ícones gerados, iguais no canvas e no HTML salvo); "Partes do
 * cabeçalho" liga/desliga cada parte (o "Entre" e o carrinho ligados sem
 * destino pedem o link da oferta e, desligados, não ficam como botão sem
 * link); "Página da loja" grava o href do logo; textos da pesquisa; cores
 * prontas e cada cor; "＋ Adicionar categoria"; o clique nas caixas seleciona o
 * cabeçalho; avisos só no canvas (pesquisa sem página da loja, fixo no topo); o
 * projeto e o HTML reabertos; e a página publicada (sem script) no computador e
 * no celular.
 */
import * as cheerio from "cheerio";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SH_THEMES } from "@/editor/widgets/store-header-content";
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
  setTrait,
} from "./blocks-harness";
import { fakeId } from "./helpers";

const HEADER = '[data-os-widget="store-header"]';
const LOJA = fakeId("loja");
const PRODUTO = fakeId("produto");
const PAGES = [
  { id: LOJA, name: "Loja" },
  { id: PRODUTO, name: "Fone de ouvido", type: "SALES" },
];
const LINKS = [{ key: "checkout", label: "Checkout principal", kind: "CHECKOUT", url: "https://pay.exemplo.com/c" }];
const STORE_PAGE_HINT = '"Escolha a página da loja em Configurações para a pesquisa funcionar nesta página"';
/** Página sem vitrine com categorias sem destino (as do bloco novo). */
const STORE_PAGE_HINT_CATS =
  '"Escolha a página da loja em Configurações para a pesquisa e as categorias funcionarem nesta página"';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** O que o canvas mostra do cabeçalho: partes à vista, avisos e os ícones desenhados. */
const canvas = (page: Page) =>
  page.evaluate(() => {
    const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
    const view = doc.defaultView as Window;
    const header = doc.querySelector('[data-os-widget="store-header"]') as HTMLElement;
    const shown = (sel: string) => {
      const el = header.querySelector(sel);
      return !!el && view.getComputedStyle(el).display !== "none";
    };
    return {
      strip: shown(".os-sh-strip"),
      search: shown(".os-sh-search"),
      loc: shown(".os-sh-loc"),
      account: shown(".os-sh-acc"),
      cart: shown(".os-sh-cart"),
      cats: shown(".os-sh-cats"),
      before: view.getComputedStyle(header, "::before").content,
      after: view.getComputedStyle(header, "::after").content,
      icons: Array.from(header.querySelectorAll("[data-os-sh-icon]")).map(
        (el) => `${el.getAttribute("data-os-sh-icon")}:${el.querySelectorAll("svg").length}`,
      ),
      cartHint: view.getComputedStyle(header.querySelector(".os-sh-cart") as Element, "::after").content,
      // Carrinho/"Entre" sem link: uma linha do cabeçalho (no lugar do balão de cada um).
      linkNote: view.getComputedStyle(header.querySelector(".os-sh-main") as Element, "::after").content,
    };
  });

/** Nomes dos campos das Configurações do componente, na ordem. */
const traitNames = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const ed = (window as unknown as EditorWindow).ed;
    const comp = ed.getWrapper()?.find(sel)[0];
    if (!comp) throw new Error(`nada com ${sel}`);
    ed.select(comp);
    return comp.getTraits().map((t) => String(t.get("name")));
  }, selector);

const traitValue = (page: Page, selector: string, name: string) =>
  page.evaluate(
    ([sel, n]) => {
      const ed = (window as unknown as EditorWindow).ed;
      const comp = ed.getWrapper()?.find(sel)[0];
      if (!comp) throw new Error(`nada com ${sel}`);
      ed.select(comp);
      return comp.getTrait(n)?.getValue();
    },
    [selector, name] as const,
  );

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

describe("bloco Cabeçalho de loja", () => {
  let page: Page;
  beforeAll(async () => {
    page = await openEditor(browser, { pages: PAGES, links: LINKS });
    await addBlock(page, "cabecalho-loja");
    await page.waitForTimeout(100);
  }, 60_000);
  afterAll(() => page?.close());

  it("é o primeiro da Loja e entra com as partes, os ícones gerados e o carrinho já no checkout da oferta", async () => {
    expect(pageErrors(page)).toEqual([]);
    const first = await page.evaluate(
      () => (window as unknown as EditorWindow).OS.ALL_BLOCKS.find((b) => b.category === "loja")?.id,
    );
    expect(first).toBe("cabecalho-loja");
    expect(await attrs(page, HEADER)).toMatchObject({
      "data-os-sticky": "0",
      "data-os-sh-strip": "1",
      "data-os-sh-search": "1",
      "data-os-sh-loc": "1",
      "data-os-sh-account": "0",
      "data-os-sh-cart": "1",
      "data-os-sh-cats": "1",
      "data-os-sh-found": "Resultados para “{busca}”",
      "data-os-sh-empty": "Nenhum produto encontrado para “{busca}”",
      "data-os-sh-all": "Ver todos os produtos",
    });
    const view = await canvas(page);
    expect(view).toMatchObject({ strip: true, search: true, loc: true, account: false, cart: true, cats: true });
    expect(view.icons).toEqual(["pin:1", "search:1", "user:1", "cart:1"]);
    // Como o "Botão do checkout": a oferta tem checkout, o carrinho já nasce ligado a ele.
    expect(view.cartHint).toBe("none");
    expect(view.linkNote).toBe("none");

    const { html, css } = await editorOutput(page);
    const $ = cheerio.load(html);
    const header = $(HEADER);
    expect(header.prop("tagName")).toBe("HEADER");
    expect(header.find("form").length).toBe(0);
    expect(header.find(".os-sh-strip").text()).toBe("🚚 Frete grátis em todo o site");
    expect(header.find(".os-sh-loc-1").text()).toBe("Entrega em");
    expect(header.find(".os-sh-loc-2").text()).toBe("todo o Brasil");
    expect(header.find("input.os-sh-q").attr()).toMatchObject({
      type: "search",
      placeholder: "Buscar produtos, marcas e muito mais…",
      "aria-label": "Buscar produtos",
    });
    expect(header.find("button.os-sh-go").attr()).toMatchObject({ type: "button", "aria-label": "Buscar" });
    expect(header.find(".os-sh-search").attr("role")).toBe("search");
    expect(header.find("a.os-sh-logo").attr("href")).toBe("#");
    expect(header.find("a.os-sh-logo img.os-sh-logo-img").attr("alt")).toBe("Logo da loja");
    expect(header.find("a.os-sh-cart").attr()).toMatchObject({ "aria-label": "Carrinho", "data-os-link": "checkout" });
    // "Entre" desligado não pede link (não vai ao ar como botão sem destino).
    expect(header.find("a.os-sh-acc").attr("data-os-link")).toBeUndefined();
    expect(
      header
        .find("a.os-sh-cat")
        .toArray()
        .map((el) => $(el).text()),
    ).toEqual(["Ofertas do dia", "Mais vendidos", "Fones", "Smartwatch", "Air fryer", "Tênis"]);
    // Ícones vão prontos no HTML (um SVG cada), sem texto.
    expect(header.find(".os-sh-ico svg").length).toBe(4);
    expect(header.find('[data-os-sh-icon="cart"]').attr("aria-hidden")).toBe("true");
    expect(css).toContain(".os-store-header{");
    expect(css).toMatch(/--os-sh-bg:#ffe94d/);
    // Aviso só do canvas: nada dele no HTML/CSS salvos.
    expect(html + css).not.toContain("Escolha a página da loja");
  });

  it("clicar nas caixas, no campo e na lupa seleciona o cabeçalho; o ícone, o link dele", async () => {
    const selected = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const what = () => {
        const s = ed.getSelected();
        return s?.get("type") === "os-sh-link" ? s.getClasses()[0] : s?.get("type");
      };
      return [".os-sh-main", ".os-sh-search", ".os-sh-q", ".os-sh-go", '[data-os-sh-icon="cart"]', ".os-sh-cats"].map(
        (sel) => {
          ed.select(ed.getWrapper()?.find(sel)[0]);
          return what();
        },
      );
    });
    expect(selected).toEqual([
      "os-store-header",
      "os-store-header",
      "os-store-header",
      "os-store-header",
      "os-sh-cart",
      "os-store-header",
    ]);
    // A estrutura fica: caixas, campo, lupa, logo e carrinho não saem nem se copiam.
    const fixed = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      return [".os-sh-strip", ".os-sh-search", ".os-sh-q", ".os-sh-go", ".os-sh-logo", ".os-sh-cart"].map((sel) => {
        const c = ed.getWrapper()?.find(sel)[0];
        return [c?.get("removable"), c?.get("copyable"), c?.get("draggable")];
      });
    });
    for (const f of fixed) expect(f).toEqual([false, false, false]);
  });

  it("Partes do cabeçalho: cada parte liga/desliga; “Entre” e carrinho pedem o link só quando ligados", async () => {
    const names = await traitNames(page, HEADER);
    expect(names.slice(0, 15)).toEqual([
      "os-h-sh-logo",
      "os-sh-logo-swap",
      "os-sh-logo-pos",
      "os-sh-logo-pos-m",
      "os-sh-logo-h",
      "os-sh-logo-place-note",
      "os-sh-logo-note",
      "os-h-sh-partes",
      "data-os-sh-strip",
      "data-os-sh-search",
      "data-os-sh-loc",
      "data-os-sh-account",
      "data-os-sh-cart",
      "data-os-sh-cats",
      "os-sh-add-cat",
    ]);
    for (const part of ["strip", "search", "loc", "cats"]) {
      await setTrait(page, HEADER, `data-os-sh-${part}`, false);
      expect((await attrs(page, HEADER))[`data-os-sh-${part}`]).toBe("0");
      expect((await canvas(page))[part as "strip"]).toBe(false);
      await setTrait(page, HEADER, `data-os-sh-${part}`, true);
      expect((await canvas(page))[part as "strip"]).toBe(true);
    }

    // "Entre": ligado sem destino pede o link; desligado, o pedido sai.
    await setTrait(page, HEADER, "data-os-sh-account", true);
    expect(await canvas(page)).toMatchObject({ account: true });
    expect((await attrs(page, ".os-sh-acc"))["data-os-link"]).toBe("");
    await setTrait(page, HEADER, "data-os-sh-account", false);
    expect(await canvas(page)).toMatchObject({ account: false });
    expect((await attrs(page, ".os-sh-acc"))["data-os-link"]).toBeUndefined();

    // Carrinho sem link (pede o link): desligado, sem pedido; ligado de novo, volta a pedir.
    await setTrait(page, ".os-sh-cart", "data-os-link", "");
    expect((await attrs(page, ".os-sh-cart"))["data-os-link"]).toBe("");
    await setTrait(page, HEADER, "data-os-sh-cart", false);
    expect((await attrs(page, ".os-sh-cart"))["data-os-link"]).toBeUndefined();
    let html = (await editorOutput(page)).html;
    expect(html).not.toContain('data-os-link=""');
    // Um Desfazer volta as duas coisas (a parte e o pedido de link).
    await undo(page);
    expect((await attrs(page, HEADER))["data-os-sh-cart"]).toBe("1");
    expect((await attrs(page, ".os-sh-cart"))["data-os-link"]).toBe("");
    await setTrait(page, HEADER, "data-os-sh-cart", false);
    expect((await attrs(page, ".os-sh-cart"))["data-os-link"]).toBeUndefined();
    await setTrait(page, HEADER, "data-os-sh-cart", true);
    expect((await attrs(page, ".os-sh-cart"))["data-os-link"]).toBe("");

    // Carrinho ligado a um link de verdade: desligar e ligar não perdem o link escolhido.
    await setTrait(page, ".os-sh-cart", "data-os-link", "checkout");
    await setTrait(page, HEADER, "data-os-sh-cart", false);
    expect((await attrs(page, ".os-sh-cart"))["data-os-link"]).toBe("checkout");
    await setTrait(page, HEADER, "data-os-sh-cart", true);
    expect((await attrs(page, ".os-sh-cart"))["data-os-link"]).toBe("checkout");

    // Com endereço próprio, ligar o "Entre" não pede link.
    await setTrait(page, ".os-sh-acc", "href", "minhaloja.com/conta");
    expect((await attrs(page, ".os-sh-acc")).href).toBe("https://minhaloja.com/conta");
    await setTrait(page, HEADER, "data-os-sh-account", true);
    expect((await attrs(page, ".os-sh-acc"))["data-os-link"]).toBeUndefined();
    html = (await editorOutput(page)).html;
    expect(cheerio.load(html)(HEADER).attr("data-os-sh-account")).toBe("1");
    await setTrait(page, HEADER, "data-os-sh-account", false);
    expect(pageErrors(page)).toEqual([]);
  });

  it("Página da loja grava o href do logo; o aviso da pesquisa (página sem vitrine) some e volta", async () => {
    expect((await canvas(page)).before).toBe(STORE_PAGE_HINT_CATS);
    const options = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const t = ed.getSelected()?.getTrait("os-sh-store");
      return (t?.get("options") as { id: string; label: string }[]).map((o) => o.label);
    });
    expect(options).toEqual(["— nenhuma —", "Loja", "Fone de ouvido"]);
    await setTrait(page, HEADER, "os-sh-store", LOJA);
    expect((await attrs(page, ".os-sh-logo")).href).toBe(`os-page:${LOJA}`);
    expect(await traitValue(page, HEADER, "os-sh-store")).toBe(LOJA);
    expect((await canvas(page)).before).toBe("none");
    await setTrait(page, HEADER, "os-sh-store", "");
    expect((await attrs(page, ".os-sh-logo")).href).toBe("#");
    expect((await canvas(page)).before).toBe(STORE_PAGE_HINT_CATS);
    // Categorias desligadas: só a pesquisa precisa da página da loja.
    await setTrait(page, HEADER, "data-os-sh-cats", false);
    expect((await canvas(page)).before).toBe(STORE_PAGE_HINT);
    // Pesquisa desligada também: nada a avisar.
    await setTrait(page, HEADER, "data-os-sh-search", false);
    expect((await canvas(page)).before).toBe("none");
    // Só as categorias (sem destino) ligadas: o aviso fala delas.
    await setTrait(page, HEADER, "data-os-sh-cats", true);
    expect((await canvas(page)).before).toBe(
      '"Escolha a página da loja em Configurações para as categorias funcionarem nesta página"',
    );
    await setTrait(page, HEADER, "data-os-sh-search", true);
    // No logo, "— nenhum —" do link da oferta tira o atributo (não pede um checkout).
    await setTrait(page, ".os-sh-logo", "data-os-link", "checkout");
    expect((await canvas(page)).before).toBe("none");
    await setTrait(page, ".os-sh-logo", "data-os-link", "");
    expect((await attrs(page, ".os-sh-logo"))["data-os-link"]).toBeUndefined();
    await setTrait(page, HEADER, "os-sh-store", LOJA);
  });

  it("textos da pesquisa e da linha de resultados (vazio volta ao padrão)", async () => {
    await setTrait(page, HEADER, "os-sh-placeholder", "Buscar en la tienda…");
    expect(await attrs(page, ".os-sh-q")).toMatchObject({
      placeholder: "Buscar en la tienda…",
      "aria-label": "Buscar en la tienda",
    });
    await setTrait(page, HEADER, "data-os-sh-found", "Resultados para “{busca}”: <b>ok</b>");
    expect((await attrs(page, HEADER))["data-os-sh-found"]).toBe("Resultados para “{busca}”: ok");
    await setTrait(page, HEADER, "data-os-sh-empty", "");
    expect((await attrs(page, HEADER))["data-os-sh-empty"]).toBe("Nenhum produto encontrado para “{busca}”");
    await setTrait(page, HEADER, "data-os-sh-all", "Ver todo");
    await setTrait(page, HEADER, "os-sh-go-label", "Buscar");
    expect((await attrs(page, ".os-sh-go"))["aria-label"]).toBe("Buscar");
  });

  it("cores prontas aplicam o conjunto; mudar uma cor vira “Personalizadas”; Desfazer volta", async () => {
    expect(await traitValue(page, HEADER, "os-sh-theme")).toBe("amarelo");
    await setTrait(page, HEADER, "os-sh-theme", "azul");
    expect(await traitValue(page, HEADER, "os-sh-theme")).toBe("azul");
    expect(await traitValue(page, HEADER, "os-sh-color-bg")).toBe(SH_THEMES.azul.colors.bg);
    expect(await traitValue(page, HEADER, "os-sh-color-go")).toBe(SH_THEMES.azul.colors.go);
    const bg = () =>
      page.evaluate(() => {
        const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
        return getComputedStyle(doc.querySelector('[data-os-widget="store-header"]') as Element).backgroundColor;
      });
    expect(await bg()).toBe("rgb(20, 28, 39)");
    expect((await editorOutput(page)).css).toMatch(/--os-sh-bg:#141c27/);

    await setTrait(page, HEADER, "os-sh-color-go", "#22c55e");
    expect(await traitValue(page, HEADER, "os-sh-theme")).toBe("");
    await undo(page);
    expect(await traitValue(page, HEADER, "os-sh-theme")).toBe("azul");

    // Amarelo (o do CSS) tira as cores próprias: o padrão volta a valer.
    await setTrait(page, HEADER, "os-sh-theme", "amarelo");
    expect(await traitValue(page, HEADER, "os-sh-theme")).toBe("amarelo");
    // (Só a definição da variável conta: o painel Estilo pode copiar "var(--os-sh-bg)" para a regra do elemento.)
    expect((await editorOutput(page)).css).not.toMatch(/#[\w-]+\{[^}]*--os-sh-bg:/);
    await setTrait(page, HEADER, "os-sh-theme", "branco");
    expect(await bg()).toBe("rgb(255, 255, 255)");
  });

  it("“＋ Adicionar categoria”, duplicar e excluir; categoria sem destino não pede link", async () => {
    const added = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const h = ed.getWrapper()?.find('[data-os-widget="store-header"]')[0];
      if (!h) throw new Error("sem cabeçalho");
      ed.select(h);
      const t = h.getTrait("os-sh-add-cat");
      (t?.get("command") as (e: unknown, t: unknown) => void)(ed, t);
      const sel = ed.getSelected();
      return {
        cats: ed.getWrapper()?.find("a.os-sh-cat").length,
        last: ed.getWrapper()?.find("a.os-sh-cat").at(-1) === sel,
        name: sel?.getName(),
        href: sel?.getAttributes().href,
      };
    });
    expect(added).toEqual({ cats: 7, last: true, name: "Categoria · Nova categoria", href: "#" });
    const names = await traitNames(page, "a.os-sh-cat");
    expect(names).toContain("os-sh-cat-note");
    expect(names).toContain("data-os-link");
    await setTrait(page, "a.os-sh-cat", "data-os-link", "checkout");
    await setTrait(page, "a.os-sh-cat", "data-os-link", "");
    expect((await attrs(page, "a.os-sh-cat"))["data-os-link"]).toBeUndefined();

    const counts = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const count = () => ed.getWrapper()?.find("a.os-sh-cat").length;
      ed.select(ed.getWrapper()?.find("a.os-sh-cat")[0]);
      ed.runCommand("tlb-clone");
      const afterClone = count();
      ed.select(ed.getWrapper()?.find("a.os-sh-cat").at(-1));
      ed.runCommand("tlb-delete");
      return { afterClone, afterDelete: count() };
    });
    expect(counts).toEqual({ afterClone: 8, afterDelete: 7 });
    expect(pageErrors(page)).toEqual([]);
  });

  it("projeto salvo e HTML reaberto: mesmos tipos e ícones refeitos (sem SVG repetido)", async () => {
    const first = await editorOutput(page);
    const project = await page.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData());
    const again = await openEditor(browser, { project, pages: PAGES, links: LINKS });
    expect(sortedAttrs((await editorOutput(again)).html)).toBe(sortedAttrs(first.html));
    await again.close();
    const reopened = await page.evaluate(
      ([h, header]) => {
        const ed = (window as unknown as EditorWindow).ed;
        ed.setComponents(h, { asDocument: true } as never);
        const w = ed.getWrapper();
        const typeOf = (sel: string) => w?.find(sel)[0]?.get("type");
        return {
          types: [header, ".os-sh-main", ".os-sh-strip", ".os-sh-logo", ".os-sh-q", ".os-sh-go", "a.os-sh-cat"].map(
            typeOf,
          ),
          listType: w?.find(".os-sh-cats > .os-sh-in")[0]?.get("type"),
          iconChildren: w?.find('[data-os-sh-icon="cart"]')[0]?.components().length,
          html: ed.getHtml(),
        };
      },
      [prepareForEditor(first.html).html, HEADER] as const,
    );
    expect(reopened.types).toEqual([
      "os-store-header",
      "os-sh-box",
      "os-sh-text",
      "os-sh-link",
      "os-sh-input",
      "os-sh-go",
      "os-sh-cat",
    ]);
    expect(reopened.listType).toBe("os-sh-cats");
    expect(reopened.iconChildren).toBe(0);
    const $ = cheerio.load(reopened.html);
    expect($('[data-os-sh-icon="cart"] svg').length).toBe(1);
    expect($(".os-sh-ico svg").length).toBe(4);
  });
});

describe("avisos do canvas", () => {
  it("pesquisa: sem aviso numa página com vitrine; fixo no topo: selo como o da barra, e “fica no lugar” num bloco escondido", async () => {
    const page = await openEditor(browser, { pages: PAGES });
    await addBlock(page, "cabecalho-loja");
    expect((await canvas(page)).before).toBe(STORE_PAGE_HINT_CATS);
    // Oferta sem checkout: o carrinho nasce pedindo o link (a linha do cabeçalho, sem o balão).
    expect((await attrs(page, ".os-sh-cart"))["data-os-link"]).toBe("");
    expect((await canvas(page)).cartHint).toBe("none");
    expect((await canvas(page)).linkNote).toBe(
      '"Carrinho sem destino: clique nele e escolha o link da oferta em Configurações"',
    );
    await addBlock(page, "grade-produtos");
    expect((await canvas(page)).before).toBe("none");

    expect((await canvas(page)).after).toBe("none");
    await setTrait(page, HEADER, "data-os-sticky", true);
    expect((await attrs(page, HEADER))["data-os-sticky"]).toBe("1");
    expect((await canvas(page)).after).toBe('"Cabeçalho fixo no topo (na página, acompanha a rolagem)"');
    await addBlock(page, "popup-saida");
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const header = ed.getWrapper()?.find('[data-os-widget="store-header"]')[0];
      ed.getWrapper()
        ?.find('[data-os-widget="exit-popup"]')[0]
        ?.append(header as never);
    });
    expect((await canvas(page)).after).toBe(
      '"Fica no lugar: está dentro de um bloco que nem sempre aparece (atraso, popup, quiz ou roleta)"',
    );
    const { html, css } = await editorOutput(page);
    expect(html + css).not.toContain("fixo no topo (na página");
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });
});

describe("categorias que não acham produto", () => {
  it("o canvas contorna as categorias sem destino que não acham nenhum produto da página (só no canvas)", async () => {
    const page = await openEditor(browser, { pages: PAGES });
    await addBlock(page, "cabecalho-loja");
    await addBlock(page, "grade-produtos");
    const marked = async () => {
      await page.waitForTimeout(300);
      return page.evaluate(() => {
        const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
        const nav = doc.querySelector(".os-sh-cats") as Element;
        return {
          cats: Array.from(doc.querySelectorAll("a.os-sh-cat[data-os-cv-nada]")).map((a) => a.textContent),
          hint: (doc.defaultView as Window).getComputedStyle(nav, "::before").content,
        };
      });
    };
    // As categorias padrão batem com os produtos de exemplo ("Mais vendidos" é o título da
    // grade; Fones, Smartwatch, Air fryer e Tênis são nomes): só "Ofertas do dia" (título de
    // outra vitrine, que esta página não tem) não acha nada.
    expect(await marked()).toEqual({
      cats: ["Ofertas do dia"],
      hint: '"Categoria com contorno: nenhum produto desta página tem esse nome — clique nela e escolha para onde leva (ou troque o texto)"',
    });
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const cats = ed.getWrapper()?.find("a.os-sh-cat") ?? [];
      cats[0]?.addAttributes({ href: "https://minhaloja.com/ofertas" });
      cats[2]?.components("Celulares");
      cats[3]?.components("Casa");
    });
    expect((await marked()).cats).toEqual(["Celulares", "Casa"]);
    // Nada disso vai para o HTML salvo.
    const { html } = await editorOutput(page);
    expect(html).not.toContain("data-os-cv-nada");
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });
});

describe("barra de texto dentro dos links do cabeçalho", () => {
  it("texto do “Entre” e categoria: a barra de texto não oferece link (um link dentro do outro quebraria o cabeçalho)", async () => {
    const page = await openEditor(browser, { pages: PAGES });
    await addBlock(page, "cabecalho-loja");
    await setTrait(page, HEADER, "data-os-sh-account", true);
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
    expect(await linkButton(".os-sh-acc-t")).toBe(false);
    expect(await linkButton(".os-sh-cat")).toBe(false);
    expect(await linkButton(".os-sh-strip")).toBe(true);
    // Link que ficou dentro do "Entre" (colado ou de antes): o HTML sai só com o texto.
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.getWrapper()?.find(".os-sh-acc-t")[0]?.components('<a href="">Entre</a>');
    });
    const $ = cheerio.load((await editorOutput(page)).html);
    expect($("a.os-sh-acc a").length).toBe(0);
    expect($("a.os-sh-acc .os-sh-acc-t").text()).toBe("Entre");
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });
});

describe("na página publicada (sem script)", () => {
  let html = "";
  beforeAll(async () => {
    const page = await openEditor(browser, { pages: PAGES });
    await page.evaluate(() =>
      (window as unknown as EditorWindow).ed.Css.addRules(
        'body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}',
      ),
    );
    await addBlock(page, "cabecalho-loja");
    await setTrait(page, HEADER, "data-os-sh-account", true);
    await addBlock(page, "grade-produtos");
    html = (await exportPage(page)).replace(/<script data-os-runtime>[\s\S]*?<\/script>/, "");
    await page.close();
  }, 60_000);

  const layout = (page: Page) =>
    page.evaluate(() => {
      const box = (sel: string) => {
        const r = (document.querySelector(sel) as HTMLElement).getBoundingClientRect();
        return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), bottom: r.bottom };
      };
      const accText = document.querySelector(".os-sh-acc-t") as HTMLElement;
      return {
        logo: box(".os-sh-logo"),
        loc: box(".os-sh-loc"),
        search: box(".os-sh-search"),
        acc: box(".os-sh-acc"),
        cart: box(".os-sh-cart"),
        cats: box(".os-sh-cats"),
        cartRight: (document.querySelector(".os-sh-cart") as HTMLElement).getBoundingClientRect().right,
        contentRight: (document.querySelector(".os-pd-track") as HTMLElement).getBoundingClientRect().right,
        inputFont: getComputedStyle(document.querySelector(".os-sh-q") as Element).fontSize,
        accTextWidth: accText.getBoundingClientRect().width,
        catsScroll: (document.querySelector(".os-sh-cats .os-sh-in") as HTMLElement).scrollWidth,
        scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

  it("computador: logo, local, pesquisa, “Entre” e carrinho numa linha; categorias embaixo", async () => {
    const site = await openSite(browser, html, { contextOptions: { viewport: { width: 1280, height: 800 } } });
    const m = await layout(site.page);
    const mid = (b: { top: number }) => b.top;
    expect(Math.abs(mid(m.logo) - mid(m.search))).toBeLessThan(12);
    expect(m.loc.left).toBeGreaterThan(m.logo.left);
    expect(m.search.left).toBeGreaterThan(m.loc.left);
    expect(m.acc.left).toBeGreaterThan(m.search.left + m.search.width - 1);
    expect(m.cart.left).toBeGreaterThan(m.acc.left);
    expect(m.search.width).toBeGreaterThan(500);
    expect(m.accTextWidth).toBeGreaterThan(20);
    expect(m.cats.top).toBeGreaterThan(m.search.bottom - 1);
    // O carrinho encosta na direita, alinhado com a vitrine (sem faixa vazia sobrando).
    expect(Math.abs(m.cartRight - m.contentRight)).toBeLessThan(2);
    expect(m.scroll).toBe(0);
    await site.context.close();
  });

  it("celular: logo + “Entre” (só o ícone) + carrinho em cima, a pesquisa inteira embaixo, categorias rolando de lado", async () => {
    for (const width of [360, 390]) {
      const site = await openSite(browser, html, { contextOptions: { viewport: { width, height: 800 } } });
      const m = await layout(site.page);
      expect(Math.abs(m.logo.top - m.cart.top)).toBeLessThan(16);
      expect(m.cart.left).toBeGreaterThan(m.acc.left);
      expect(m.accTextWidth).toBeLessThanOrEqual(1);
      expect(m.search.top).toBeGreaterThan(m.logo.top + 20);
      expect(m.search.width).toBeGreaterThan(width - 40);
      expect(m.loc.top).toBeGreaterThan(m.search.top);
      // 16 px: o Safari do iPhone não amplia a página ao tocar na pesquisa.
      expect(m.inputFont).toBe("16px");
      // As categorias passam da tela dentro da linha delas (rolam de lado), a página não.
      expect(m.catsScroll).toBeGreaterThan(width);
      expect(m.scroll).toBe(0);
      await site.context.close();
    }
  });
});
