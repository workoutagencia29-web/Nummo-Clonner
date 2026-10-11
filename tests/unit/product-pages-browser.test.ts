/**
 * "＋ Criar página deste produto" e "Criar as páginas que faltam" (Fase 2.4 da
 * loja) no editor-app.tsx de verdade, num Chromium (harness E1, com a ação
 * respondida pelo teste):
 *
 * - cartão sem destino: o botão das Configurações abre o diálogo (nome da
 *   página = nome do produto, "Botão “Comprar agora” leva para"), a ação recebe
 *   o produto, a página da vitrine e o cabeçalho (HTML + regras de CSS dele), o
 *   cartão passa a levar à página nova, o botão some e o toast tem "Abrir"
 *   (salva antes de sair);
 * - a opção "＋ Criar página deste produto…" da lista "Página do produto" abre o
 *   mesmo diálogo sem gravar nada (nem no Desfazer);
 * - vitrine: "Criar as páginas que faltam (N)" lista os produtos sem destino,
 *   cada um com o seu link, cria todas e liga cada cartão à sua página;
 * - erro da ação aparece no diálogo e nada é ligado;
 * - a página criada pelo serviço (fillProductPage) abre no editor com as cores
 *   do cabeçalho da vitrine (as regras dele viram regras do editor);
 * - excluir uma página de produto avisa que a vitrine leva a ela.
 */
import { type Browser, chromium, type Page, type Route } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { productHtml } from "@/editor/templates/product";
import { storeHtml } from "@/editor/templates/store";
import { LAYER_ORDER, linkBaseStylesheet, prepareForEditor } from "@/lib/editor-html";
import { readProduct } from "@/lib/store";
import type { EditorPayload } from "@/server/services/documents";
import { fillProductPage } from "@/server/services/store";
import {
  actionCalls,
  appBundle,
  clickToastAction,
  FakeServer,
  makePayload,
  OFFER_ID,
  openApp,
  type Session,
  setActionResult,
  toasts,
  waitFor,
  withEditor,
} from "./fix3-E1-harness";

let browser: Browser;
beforeAll(async () => {
  await appBundle();
  browser = await chromium.launch();
}, 180_000);
afterAll(async () => {
  await browser?.close();
});

const sessions: Session[] = [];
afterAll(async () => {
  for (const s of sessions) await s.page.close().catch(() => undefined);
});

const STORE_PAGE = "cpaginaloja00000000000001";
const LINKS = [
  { id: "l1", key: "checkout", label: "Checkout principal", url: "https://pay.exemplo.com/a", kind: "CHECKOUT" },
  { id: "l2", key: "checkout-mochila", label: "Checkout da mochila", url: "", kind: "CHECKOUT" },
];

/** Resposta da ação: uma página por produto (ids e documentos previsíveis). */
const CREATED = `(input) => ({ ok: true, data: input.products.map((p, i) => ({
  id: "cprodutonovo" + String(i).padStart(13, "0"),
  name: p.pageName,
  slug: "produto-" + i,
  type: "SALES",
  isHome: false,
  documentId: "docproduto" + i,
})) })`;

async function openStore(id: string, over: Partial<EditorPayload> = {}) {
  const server = new FakeServer();
  server.add(
    makePayload({
      documentId: id,
      html: storeHtml,
      page: { id: STORE_PAGE, name: "Loja", slug: "loja", type: "OTHER" },
      pages: [{ id: STORE_PAGE, name: "Loja", slug: "loja", type: "OTHER", isHome: true, documentId: id }],
      links: LINKS,
      ...over,
    }),
  );
  const s = await openApp(browser, server, id);
  sessions.push(s);
  await waitFor(() => server.okPuts.length === 1, 10_000, "primeiro salvamento");
  return s;
}

/** Seleciona o n-ésimo cartão da vitrine com este título; devolve o nome do produto. */
function selectCard(s: Session, title: string, index: number) {
  return withEditor<string>(
    s.page,
    `(ed, [title, index]) => {
      const shop = ed.getWrapper().find('[data-os-widget="products"]').find((w) => w.getEl().querySelector(".os-pd-title")?.textContent.trim() === title);
      const card = shop.find("a[data-os-product]")[index];
      ed.select(card);
      return card.getEl().querySelector(".os-pd-name").textContent.trim();
    }`,
    [title, index],
  );
}

function selectShop(s: Session, title: string) {
  return withEditor<number>(
    s.page,
    `(ed, title) => {
      const shop = ed.getWrapper().find('[data-os-widget="products"]').find((w) => w.getEl().querySelector(".os-pd-title")?.textContent.trim() === title);
      ed.select(shop);
      return shop.find("a[data-os-product]").length;
    }`,
    title,
  );
}

/** href dos cartões da vitrine com este título. */
function cardHrefs(s: Session, title: string) {
  return withEditor<string[]>(
    s.page,
    `(ed, title) => {
      const shop = ed.getWrapper().find('[data-os-widget="products"]').find((w) => w.getEl().querySelector(".os-pd-title")?.textContent.trim() === title);
      return shop.find("a[data-os-product]").map((c) => c.getAttributes().href + (("data-os-link" in c.getAttributes()) ? " +link" : ""));
    }`,
    title,
  );
}

/** A linha do botão das Configurações está à vista? */
const actionShown = (page: Page, text: string | RegExp) =>
  page.evaluate(
    ([source, flags]) => {
      const re = new RegExp(source, flags);
      const btn = [...document.querySelectorAll<HTMLButtonElement>('[data-os-panel="config"] button')].find((b) =>
        re.test(b.textContent ?? ""),
      );
      if (!btn) return null;
      const row = btn.closest<HTMLElement>('[class*="trait__wrp"]');
      return { shown: row?.style.display !== "none", disabled: btn.disabled, text: btn.textContent };
    },
    typeof text === "string" ? [text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), ""] : [text.source, text.flags],
  );

/** Servidor falso que também entrega a folha base (CSS do modelo, em camada). */
class BaseCssServer extends FakeServer {
  constructor(private files: Record<string, string>) {
    super();
  }
  override async handle(route: Route) {
    const css = this.files[new URL(route.request().url()).pathname];
    if (css !== undefined) return route.fulfill({ contentType: "text/css", body: css });
    return super.handle(route);
  }
}

const undoSize = (s: Session) => withEditor<number>(s.page, "(ed) => ed.UndoManager.getStack().length");

describe("criar a página de um produto (cartão)", { timeout: 60_000 }, () => {
  it("botão das Configurações → diálogo → página criada, cartão ligado, toast com “Abrir”", async () => {
    const s = await openStore("docloja000000000000000001");
    await setActionResult(s, "createProductPagesAction", CREATED);
    const name = await selectCard(s, "Mais vendidos", 0);
    expect(name).toBe("Fone de ouvido Bluetooth sem fio");
    await waitFor(
      async () => (await actionShown(s.page, "＋ Criar página deste produto"))?.shown === true,
      4000,
      "botão",
    );

    await s.page.getByRole("button", { name: "＋ Criar página deste produto" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Nova página do produto" });
    await dialog.waitFor();
    expect(await dialog.getByLabel("Nome da página").inputValue()).toBe("Fone de ouvido Bluetooth sem fio");
    expect(await dialog.textContent()).toContain("O cabeçalho de loja desta página vai junto");
    await dialog.getByRole("combobox", { name: "Botão “Comprar agora” leva para" }).click();
    await s.page.getByRole("option", { name: "Checkout principal" }).click();
    await dialog.getByLabel("Nome da página").fill("Fone sem fio");
    await dialog.getByRole("button", { name: "Criar página" }).click();
    await dialog.waitFor({ state: "hidden" });

    const [call] = await actionCalls(s, "createProductPagesAction");
    const input = call.input as {
      offerId: string;
      storePageId: string;
      header: { html: string; css: string } | null;
      products: Record<string, unknown>[];
    };
    expect(input.offerId).toBe(OFFER_ID);
    expect(input.storePageId).toBe(STORE_PAGE);
    expect(input.products).toEqual([
      {
        pageName: "Fone sem fio",
        name: "Fone de ouvido Bluetooth sem fio",
        photo: expect.stringMatching(/^data:image\/svg\+xml/),
        data: expect.objectContaining({ "data-os-pd-price": "12990", "data-os-pd-old": "21990" }),
        currency: "BRL",
        lang: "",
        linkKey: "checkout",
      },
    ]);
    // O cabeçalho da vitrine vai junto: o HTML e só as regras dele (nada da vitrine de produtos).
    expect(input.header?.html).toMatch(/^<header [^>]*data-os-widget="store-header"/);
    expect(input.header?.css).toContain(".os-store-header");
    expect(input.header?.css).not.toContain(".os-products");
    expect(input.header?.css).not.toContain(".os-pd-card");
    // Regras da página toda (que também pegam o que está fora do cabeçalho) não vão.
    expect(input.header?.css).not.toMatch(/(^|})(a|img[^{]*)\{/);
    expect(input.header?.css).not.toContain("body{");

    // O cartão leva à página nova (sem link da oferta) e isso é salvo.
    expect((await cardHrefs(s, "Mais vendidos"))[0]).toBe("os-page:cprodutonovo0000000000000");
    await waitFor(
      () => s.server.okPuts.some((p) => p.html.includes('href="os-page:cprodutonovo0000000000000"')),
      6000,
      "cartão ligado salvo",
    );
    // O botão some; a lista "Página do produto" já mostra a página nova.
    await waitFor(
      async () => (await actionShown(s.page, "＋ Criar página deste produto"))?.shown === false,
      4000,
      "botão some",
    );
    const info = await withEditor<string>(s.page, `(ed) => ed.getSelected().getTrait("os-destino")?.get("text")`);
    expect(info).toBe("Página do produto: Fone sem fio");

    const list = await toasts(s);
    const index = list.findIndex((t) => t.message === "Página “Fone sem fio” criada");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(list[index]).toMatchObject({ type: "success", action: "Abrir" });
    // "Abrir": salva antes e vai para o editor da página nova.
    await withEditor(
      s.page,
      `(ed) => { ed.getWrapper().find(".os-lj-h1")[0].addAttributes({ "data-x": "1" }); return true; }`,
    );
    const puts = s.server.okPuts.length;
    await clickToastAction(s, index);
    await waitFor(() => s.server.navs.length === 1, 6000, "navegação");
    expect(s.server.navs).toEqual(["/editor/docproduto0"]);
    expect(s.server.okPuts.length).toBeGreaterThan(puts);
    expect(s.server.okPuts.at(-1)?.html).toContain('data-x="1"');
    expect(s.errors).toEqual([]);
  });

  it("a opção “＋ Criar página deste produto…” da lista abre o diálogo sem gravar nada", async () => {
    const s = await openStore("docloja000000000000000002");
    await selectCard(s, "Mais vendidos", 1);
    const select = s.page
      .locator('[data-os-panel="config"] select')
      .filter({ has: s.page.locator("option", { hasText: "＋ Criar página deste produto…" }) });
    await select.waitFor();
    const before = await undoSize(s);
    await select.selectOption({ label: "＋ Criar página deste produto…" });
    const dialog = s.page.getByRole("dialog", { name: "Nova página do produto" });
    await dialog.waitFor();
    expect(await dialog.getByLabel("Nome da página").inputValue()).toBe("Smartwatch com monitor cardíaco");
    // A lista volta a "— nenhuma —"; o cartão continua sem destino e nada entra no Desfazer.
    await waitFor(async () => (await select.inputValue()) === "", 3000, "lista de volta");
    expect((await cardHrefs(s, "Mais vendidos"))[1]).toBe("#");
    expect(await undoSize(s)).toBe(before);
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await dialog.waitFor({ state: "hidden" });
    expect(await actionCalls(s, "createProductPagesAction")).toEqual([]);
  });

  it("erro da ação aparece no diálogo e nada é ligado", async () => {
    const s = await openStore("docloja000000000000000003");
    await setActionResult(
      s,
      "createProductPagesAction",
      `() => ({ ok: false, error: "O link escolhido para o produto “X” não existe mais nesta oferta. Recarregue o editor e escolha de novo.", field: "products.0.linkKey" })`,
    );
    await selectCard(s, "Mais vendidos", 2);
    await s.page.getByRole("button", { name: "＋ Criar página deste produto" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Nova página do produto" });
    await dialog.getByRole("button", { name: "Criar página" }).click();
    await dialog.getByText(/não existe mais nesta oferta/).waitFor();
    expect(await dialog.isVisible()).toBe(true);
    expect((await cardHrefs(s, "Mais vendidos"))[2]).toBe("#");
  });
});

describe("criar as páginas que faltam (vitrine)", { timeout: 60_000 }, () => {
  it("lista os produtos sem destino, cada um com o seu link, e liga cada cartão à sua página", async () => {
    const s = await openStore("docloja000000000000000004");
    await setActionResult(s, "createProductPagesAction", CREATED);
    // Um cartão já leva a algum lugar: fica fora da lista.
    await withEditor(
      s.page,
      `(ed) => {
        const shop = ed.getWrapper().find('[data-os-widget="products"]').find((w) => w.getEl().querySelector(".os-pd-title")?.textContent.trim() === "Mais vendidos");
        shop.find("a[data-os-product]")[5].addAttributes({ href: "https://minhaloja.com/tenis" });
        return true;
      }`,
    );
    expect(await selectShop(s, "Mais vendidos")).toBe(8);
    await waitFor(
      async () =>
        (await actionShown(s.page, /Criar as páginas que faltam/))?.text === "Criar as páginas que faltam (7)",
      4000,
      "botão da vitrine",
    );
    await s.page.getByRole("button", { name: "Criar as páginas que faltam (7)" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Criar as páginas que faltam" });
    await dialog.waitFor();
    expect(await dialog.getByRole("listitem").count()).toBe(7);
    expect(await dialog.getByRole("listitem").allTextContents()).not.toContainEqual(
      expect.stringContaining("Tênis de corrida"),
    );

    // Todos para o checkout principal; a mochila no checkout dela; o primeiro para depois.
    await dialog.getByRole("combobox", { name: "Botão “Comprar agora” de todos leva para" }).click();
    await s.page.getByRole("option", { name: "Checkout principal" }).click();
    await dialog.getByRole("combobox", { name: "Botão “Comprar agora” de Mochila para notebook" }).click();
    await s.page.getByRole("option", { name: "Checkout da mochila" }).click();
    await dialog.getByRole("combobox", { name: "Botão “Comprar agora” de Fone de ouvido Bluetooth sem fio" }).click();
    await s.page.getByRole("option", { name: "— escolher depois —" }).click();
    expect(await dialog.getByRole("combobox", { name: "Botão “Comprar agora” de todos leva para" }).textContent()).toBe(
      "Destinos diferentes",
    );
    await dialog.getByRole("button", { name: "Criar 7 páginas" }).click();
    await dialog.waitFor({ state: "hidden" });

    const [call] = await actionCalls(s, "createProductPagesAction");
    const products = (call.input as { products: { pageName: string; name: string; linkKey: string | null }[] })
      .products;
    expect(products.map((p) => [p.pageName, p.linkKey])).toEqual([
      ["Fone de ouvido Bluetooth sem fio", null],
      ["Smartwatch com monitor cardíaco", "checkout"],
      ["Caixa de som portátil à prova d'água", "checkout"],
      ["Air fryer 4 litros", "checkout"],
      ["Kit 3 panelas antiaderentes", "checkout"],
      ["Mochila para notebook", "checkout-mochila"],
      ["Luminária LED de mesa", "checkout"],
    ]);

    // Cada cartão leva à página dele (o que já tinha destino continua igual).
    expect(await cardHrefs(s, "Mais vendidos")).toEqual([
      "os-page:cprodutonovo0000000000000",
      "os-page:cprodutonovo0000000000001",
      "os-page:cprodutonovo0000000000002",
      "os-page:cprodutonovo0000000000003",
      "os-page:cprodutonovo0000000000004",
      "https://minhaloja.com/tenis",
      "os-page:cprodutonovo0000000000005",
      "os-page:cprodutonovo0000000000006",
    ]);
    // A vitrine continua selecionada: o botão diz que não falta nada; o aviso do canvas some.
    await waitFor(
      async () => (await actionShown(s.page, /Todos os produtos/))?.disabled === true,
      4000,
      "botão sem produtos faltando",
    );
    const warning = await withEditor<string | null>(
      s.page,
      `(ed) => ed.getSelected().getEl().getAttribute("data-os-cv-aviso")`,
    );
    expect(warning).toBeNull();
    expect((await toasts(s)).some((t) => t.message === "7 páginas de produto criadas")).toBe(true);

    // As páginas novas aparecem na aba "Páginas" e na lista "Página do produto".
    await s.page.getByRole("tab", { name: "Páginas" }).click();
    await s.page.getByRole("button", { name: "Luminária LED de mesa" }).waitFor();
    await selectCard(s, "Ofertas", 0);
    const options = await withEditor<string[]>(
      s.page,
      `(ed) => ed.getSelected().getTrait("os-page").get("options").map((o) => o.label)`,
    );
    expect(options).toContain("Mochila para notebook");
    expect(options.at(-1)).toBe("＋ Criar página deste produto…");
    await waitFor(
      () => s.server.okPuts.some((p) => p.html.includes('href="os-page:cprodutonovo0000000000006"')),
      6000,
      "vitrine salva",
    );
    expect(s.errors).toEqual([]);
  });

  it("o cabeçalho vai com as cores e o logo escolhidos (regra do id, posição, altura, imagem enviada) e a página nova abre no editor com eles", async () => {
    const s = await openStore("docloja000000000000000005");
    await setActionResult(s, "createProductPagesAction", CREATED);
    const logoSrc = `/os-assets/${"b".repeat(64)}.webp`;
    // Cores do cabeçalho mudadas (como o "Cores prontas"): variáveis no estilo base dele. Logo:
    // imagem enviada, no centro (computador) e à direita (celular), com 56 px de altura.
    const headerId = await withEditor<string>(
      s.page,
      `(ed) => {
        const header = ed.getWrapper().find('[data-os-widget="store-header"]')[0];
        ed.Css.setIdRule(header.getId(), { "--os-sh-bg": "rgb(16, 24, 40)", "--os-sh-ink": "rgb(255, 255, 255)" });
        ed.select(header);
        header.getTrait("os-sh-logo-pos").setValue("center");
        header.getTrait("os-sh-logo-pos-m").setValue("right");
        header.getTrait("os-sh-logo-h").setValue("56");
        header.find("img.os-sh-logo-img")[0].set("src", "${logoSrc}");
        return header.getId();
      }`,
    );
    await selectCard(s, "Mais vendidos", 0);
    await s.page.getByRole("button", { name: "＋ Criar página deste produto" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Nova página do produto" });
    await dialog.getByRole("button", { name: "Criar página" }).click();
    await dialog.waitFor({ state: "hidden" });
    const [call] = await actionCalls(s, "createProductPagesAction");
    const input = call.input as {
      header: { html: string; css: string };
      products: { name: string; photo: string; data: Record<string, string>; currency: string }[];
    };
    expect(input.header.html).toContain(`id="${headerId}"`);
    expect(input.header.css).toContain(`#${headerId}{--os-sh-bg:rgb(16, 24, 40);`);
    expect(input.header.css).toMatch(new RegExp(`#${headerId}\\{[^}]*--os-sh-logo-h:56px`));
    expect(input.header.html).toContain('data-os-sh-logo-pos="center"');
    expect(input.header.html).toContain('data-os-sh-logo-pos-m="right"');
    expect(input.header.html).toContain(`src="${logoSrc}"`);

    // O serviço monta a página com isso; aberta no editor, o cabeçalho tem as cores da vitrine.
    const [p] = input.products;
    const html = fillProductPage(productHtml, {
      storePageId: STORE_PAGE,
      name: p.name,
      photo: p.photo,
      data: readProduct(p.data),
      currency: "BRL",
      lang: null,
      linkKey: "checkout",
      header: input.header,
    });
    // Como o servidor entrega a página ao editor (htmlForEditor): o CSS do modelo vai para a
    // folha base, em camada; o <style data-os-edits> (o do cabeçalho) fica como regras do editor.
    const prepared = prepareForEditor(html);
    const base = `${LAYER_ORDER}\n@layer os-original{${prepared.styles.map((st) => st.text ?? "").join("\n")}}`;
    const server = new BaseCssServer({ "/os-assets/base-produto.css": base });
    const id = "docprodutoaberto000000001";
    server.add(
      makePayload({
        documentId: id,
        html: linkBaseStylesheet(prepared.html, "/os-assets/base-produto.css"),
        page: { id: "cprodutonovo0000000000000", name: p.name, slug: "fone", type: "SALES" },
        links: LINKS,
      }),
    );
    const t = await openApp(browser, server, id);
    sessions.push(t);
    await waitFor(() => server.okPuts.length === 1, 10_000, "primeiro salvamento da página nova");
    const look = await t.page.evaluate(() => {
      const doc = (document.querySelector("iframe.gjs-frame") as HTMLIFrameElement).contentDocument as Document;
      const header = doc.querySelector<HTMLElement>('[data-os-widget="store-header"]') as HTMLElement;
      const view = doc.defaultView as Window;
      const logo = header.querySelector("img.os-sh-logo-img") as HTMLImageElement;
      const row = (header.querySelector(".os-sh-main .os-sh-in") as HTMLElement).getBoundingClientRect();
      const link = (header.querySelector("a.os-sh-logo") as HTMLElement).getBoundingClientRect();
      return {
        bg: view.getComputedStyle(header).backgroundColor,
        logoHeight: view.getComputedStyle(logo).height,
        pos: [header.getAttribute("data-os-sh-logo-pos"), header.getAttribute("data-os-sh-logo-pos-m")],
        centered: Math.abs((link.left + link.right) / 2 - (row.left + row.right) / 2) < 2,
        stage: doc.querySelector<HTMLImageElement>(".os-pg-main")?.getAttribute("src") ?? "",
        price: doc.querySelector('[data-os-widget="product-buy"] .os-pd-now')?.textContent ?? "",
        name: doc.querySelector(".os-pb-name")?.textContent ?? "",
      };
    });
    expect(look.bg).toBe("rgb(16, 24, 40)");
    expect(look.logoHeight).toBe("56px");
    // (o canvas desenha um substituto quando a imagem não carrega: o endereço é o do elemento)
    expect(await withEditor<string>(t.page, `(ed) => ed.getWrapper().find("img.os-sh-logo-img")[0].get("src")`)).toBe(
      logoSrc,
    );
    expect(look.pos).toEqual(["center", "right"]);
    expect(look.centered).toBe(true);
    expect(look.stage).toBe(p.photo);
    expect(look.price).toBe("R$ 129,90");
    expect(look.name).toBe("Fone de ouvido Bluetooth sem fio");
    // Salva de novo com a regra do cabeçalho como edição (não perde para o CSS do tipo).
    const saved = server.okPuts[0];
    expect(saved.css).toContain(`#${headerId}{--os-sh-bg:rgb(16, 24, 40);`);
    expect(t.errors).toEqual([]);
  });
});

/** href (e "+link" com data-os-link) de todos os cartões da página, com o nome do produto. */
function allCards(s: Session) {
  return withEditor<{ name: string; href: string }[]>(
    s.page,
    `(ed) => ed.getWrapper().find("a[data-os-product]").map((c) => ({
      name: c.getEl().querySelector(".os-pd-name").textContent.trim(),
      href: c.getAttributes().href + (("data-os-link" in c.getAttributes()) ? " +link" : ""),
    }))`,
  );
}

/** Aviso do canvas de cada vitrine (null = todos os produtos levam a algum lugar). */
function shopWarnings(s: Session) {
  return withEditor<(string | null)[]>(
    s.page,
    `(ed) => ed.getWrapper().find('[data-os-widget="products"]').map((w) => w.getEl().getAttribute("data-os-cv-aviso"))`,
  );
}

const PAGE_FONE = "cpaginafone00000000000001";
/** O produto "Fone…" já tem página (de uma versão A/B, do layout do celular ou de antes do Desfazer). */
const WITH_FONE: Partial<EditorPayload> = {
  pages: [
    { id: STORE_PAGE, name: "Loja", slug: "loja", type: "OTHER", isHome: true, documentId: "x" },
    { id: PAGE_FONE, name: "Fone sem fio", slug: "fone", type: "SALES", isHome: false, documentId: "docfone" },
  ],
  storeProducts: [{ pageId: PAGE_FONE, name: "Fone de ouvido Bluetooth sem fio" }],
};

describe("uma página por produto (revisão)", { timeout: 60_000 }, () => {
  it("modelo Loja: as páginas criadas numa vitrine valem para o mesmo produto nas outras (nada de “Fone 2”)", async () => {
    const s = await openStore("docloja000000000000000011");
    await setActionResult(s, "createProductPagesAction", CREATED);
    expect((await allCards(s)).length).toBe(28);
    expect((await shopWarnings(s)).every((w) => w !== null)).toBe(true);
    await selectShop(s, "Mais vendidos");
    await s.page.getByRole("button", { name: "Criar as páginas que faltam (8)" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Criar as páginas que faltam" });
    await dialog.waitFor();
    // Os mesmos 8 produtos aparecem em outras vitrines: 20 cartões a mais vão junto.
    expect(await dialog.textContent()).toContain("(20 cartões a mais)");
    await dialog.getByRole("button", { name: "Criar 8 páginas" }).click();
    await dialog.waitFor({ state: "hidden" });
    const [call] = await actionCalls(s, "createProductPagesAction");
    expect((call.input as { products: unknown[] }).products).toHaveLength(8);

    // Todos os 28 cartões levam à página do produto deles; nenhuma vitrine avisa mais.
    const cards = await allCards(s);
    const pageOf = new Map<string, string>();
    for (const c of cards) {
      expect(c.href).toMatch(/^os-page:cprodutonovo/);
      if (!pageOf.has(c.name)) pageOf.set(c.name, c.href);
      expect(c.href).toBe(pageOf.get(c.name));
    }
    expect(new Set(pageOf.values()).size).toBe(8);
    expect(await shopWarnings(s)).toEqual([null, null, null, null, null]);
    // Na vitrine "Ofertas": não falta nada.
    await selectShop(s, "Ofertas");
    await waitFor(
      async () =>
        (await actionShown(s.page, /Todos os produtos|Criar as páginas/))?.text === "Todos os produtos já têm destino",
      4000,
      "nada faltando em Ofertas",
    );
    // Um passo só no Desfazer: os 28 cartões voltam juntos.
    await withEditor(s.page, "(ed) => { ed.UndoManager.undo(); return true; }");
    expect((await allCards(s)).every((c) => c.href === "#")).toBe(true);
    expect(s.errors).toEqual([]);
  });

  it("produto que já tem página (versão A/B, layout do celular): “Criar as páginas que faltam” liga a ela", async () => {
    const s = await openStore("docloja000000000000000012", WITH_FONE);
    await setActionResult(s, "createProductPagesAction", CREATED);
    await selectShop(s, "Mais vendidos");
    await s.page.getByRole("button", { name: "Criar as páginas que faltam (8)" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Criar as páginas que faltam" });
    await dialog.waitFor();
    const fone = dialog.getByRole("listitem").filter({ hasText: "Fone de ouvido Bluetooth sem fio" });
    expect(await fone.textContent()).toContain("Já tem a página “Fone sem fio”: passa a levar a ela");
    expect(await fone.getByRole("combobox").count()).toBe(0);
    await dialog.getByRole("button", { name: "Criar 7 páginas" }).click();
    await dialog.waitFor({ state: "hidden" });
    const [call] = await actionCalls(s, "createProductPagesAction");
    const names = (call.input as { products: { name: string }[] }).products.map((p) => p.name);
    expect(names).toHaveLength(7);
    expect(names).not.toContain("Fone de ouvido Bluetooth sem fio");
    const cards = await allCards(s);
    expect(cards.filter((c) => c.name === "Fone de ouvido Bluetooth sem fio").map((c) => c.href)).toEqual(
      Array(4).fill(`os-page:${PAGE_FONE}`),
    );
    expect((await toasts(s)).find((t) => t.message === "7 páginas de produto criadas")?.description).toContain(
      "1 produto já tinha página e passou a levar a ela.",
    );
  });

  it("cartão de um produto que já tem página: o diálogo oferece usar ela (sem criar outra)", async () => {
    const s = await openStore("docloja000000000000000013", WITH_FONE);
    await selectCard(s, "Mais vendidos", 0);
    await s.page.getByRole("button", { name: "＋ Criar página deste produto" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Nova página do produto" });
    await dialog.waitFor();
    const use = dialog.getByRole("radio", { name: "Usar a página “Fone sem fio”, que já é deste produto" });
    expect(await use.getAttribute("aria-checked")).toBe("true");
    expect(await dialog.getByLabel("Nome da página").count()).toBe(0);
    // "Criar outra página": aparecem o nome e o link.
    await dialog.getByRole("radio", { name: "Criar outra página" }).click();
    expect(await dialog.getByLabel("Nome da página").inputValue()).toBe("Fone de ouvido Bluetooth sem fio");
    await use.click();
    await dialog.getByRole("button", { name: "Ligar à página" }).click();
    await dialog.waitFor({ state: "hidden" });
    expect(await actionCalls(s, "createProductPagesAction")).toEqual([]);
    expect((await cardHrefs(s, "Mais vendidos"))[0]).toBe(`os-page:${PAGE_FONE}`);
    const list = await toasts(s);
    expect(list.find((t) => t.message === "Produto ligado à página “Fone sem fio”")).toMatchObject({
      type: "success",
      action: "Abrir",
    });
  });

  it("Desfazer depois de criar: a lista acompanha o cartão, e criar de novo usa a mesma página", async () => {
    const s = await openStore("docloja000000000000000014");
    await setActionResult(s, "createProductPagesAction", CREATED);
    await selectCard(s, "Mais vendidos", 0);
    await s.page.getByRole("button", { name: "＋ Criar página deste produto" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Nova página do produto" });
    await dialog.getByRole("button", { name: "Criar página" }).click();
    await dialog.waitFor({ state: "hidden" });
    const page = "os-page:cprodutonovo0000000000000";
    expect((await cardHrefs(s, "Mais vendidos"))[0]).toBe(page);

    await withEditor(s.page, "(ed) => { ed.UndoManager.undo(); return true; }");
    expect((await cardHrefs(s, "Mais vendidos"))[0]).toBe("#");
    const select = s.page.locator('[data-os-panel="config"] [class*="trait__wrp-os-page"] select');
    await waitFor(async () => (await select.inputValue()) === "", 3000, "lista em “— nenhuma —”");
    // Escolher a página de novo religa o cartão.
    await select.selectOption({ label: "Fone de ouvido Bluetooth sem fio" });
    expect((await cardHrefs(s, "Mais vendidos"))[0]).toBe(page);

    // Desligado de novo, "＋ Criar página deste produto" oferece a página que já existe (não "… 2").
    await select.selectOption({ label: "— nenhuma —" });
    await s.page.getByRole("button", { name: "＋ Criar página deste produto" }).click();
    await dialog.waitFor();
    expect(
      await dialog
        .getByRole("radio", { name: "Usar a página “Fone de ouvido Bluetooth sem fio”, que já é deste produto" })
        .count(),
    ).toBe(1);
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await dialog.waitFor({ state: "hidden" });
    expect(await actionCalls(s, "createProductPagesAction")).toHaveLength(1);
  });

  it("depois do diálogo, o foco fica nas Configurações: Backspace/Delete não apagam o cartão", async () => {
    const s = await openStore("docloja000000000000000015");
    await setActionResult(s, "createProductPagesAction", CREATED);
    const count = async () => (await cardHrefs(s, "Mais vendidos")).length;
    await selectCard(s, "Mais vendidos", 0);
    await s.page.getByRole("button", { name: "＋ Criar página deste produto" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Nova página do produto" });
    await dialog.getByLabel("Nome da página").press("Enter");
    await dialog.waitFor({ state: "hidden" });
    await waitFor(() => s.page.evaluate(() => document.activeElement !== document.body), 3000, "foco fora do <body>");
    expect(await s.page.evaluate(() => document.activeElement?.tagName)).toBe("SELECT");
    await s.page.keyboard.press("Backspace");
    await s.page.keyboard.press("Delete");
    expect(await count()).toBe(8);
    expect((await cardHrefs(s, "Mais vendidos"))[0]).toBe("os-page:cprodutonovo0000000000000");

    // Cancelar com Esc: idem.
    await selectCard(s, "Mais vendidos", 1);
    await s.page.getByRole("button", { name: "＋ Criar página deste produto" }).click();
    await dialog.waitFor();
    await s.page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    // O Radix devolve o foco num setTimeout depois de tirar o diálogo: até lá ele fica no <body>.
    await waitFor(() => s.page.evaluate(() => document.activeElement !== document.body), 3000, "foco fora do <body>");
    expect(await s.page.evaluate(() => document.activeElement?.tagName)).toBe("SELECT");
    await s.page.keyboard.press("Delete");
    expect(await count()).toBe(8);
    // Com o diálogo aberto, Backspace num botão dele também não apaga o cartão.
    await s.page.getByRole("button", { name: "＋ Criar página deste produto" }).click();
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Cancelar" }).focus();
    await s.page.keyboard.press("Backspace");
    expect(await count()).toBe(8);
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    expect(s.errors).toEqual([]);
  });

  it("cartão ligado a um link da oferta sem endereço conta como sem destino (como no ZIP)", async () => {
    const s = await openStore("docloja000000000000000016");
    await withEditor(
      s.page,
      `(ed) => {
        const shop = ed.getWrapper().find('[data-os-widget="products"]').find((w) => w.getEl().querySelector(".os-pd-title")?.textContent.trim() === "Mais vendidos");
        const cards = shop.find("a[data-os-product]");
        cards.forEach((c, i) => c.addAttributes(i < 7 ? { href: "https://minhaloja.com/p" + i } : { "data-os-link": "checkout-mochila" }));
        return true;
      }`,
    );
    await selectShop(s, "Mais vendidos");
    await waitFor(
      async () =>
        (await actionShown(s.page, /Criar as páginas que faltam/))?.text === "Criar as páginas que faltam (1)",
      4000,
      "botão da vitrine com 1",
    );
    const state = await withEditor<{ warning: string | null; marked: boolean }>(
      s.page,
      `(ed) => {
        const shop = ed.getSelected();
        const card = shop.find("a[data-os-product]")[7];
        return { warning: shop.getEl().getAttribute("data-os-cv-aviso"), marked: card.getEl().hasAttribute("data-os-cv-sem") };
      }`,
    );
    expect(state.warning).toMatch(/^1 produto ainda sem página/);
    expect(state.marked).toBe(true);
    await selectCard(s, "Mais vendidos", 7);
    await waitFor(
      async () => (await actionShown(s.page, "＋ Criar página deste produto"))?.shown === true,
      4000,
      "botão do cartão",
    );
    await s.page.getByRole("button", { name: "＋ Criar página deste produto" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Nova página do produto" });
    await dialog.waitFor();
    // O "Comprar agora" nasce no link do cartão.
    expect(await dialog.getByRole("combobox", { name: "Botão “Comprar agora” leva para" }).textContent()).toBe(
      "Checkout da mochila",
    );
    await dialog.getByRole("button", { name: "Cancelar" }).click();
  });

  it("produto sem nome: aparece com o aviso e fica de fora (as outras páginas são criadas)", async () => {
    const s = await openStore("docloja000000000000000017");
    await setActionResult(s, "createProductPagesAction", CREATED);
    await withEditor(
      s.page,
      `(ed) => {
        const shop = ed.getWrapper().find('[data-os-widget="products"]').find((w) => w.getEl().querySelector(".os-pd-title")?.textContent.trim() === "Mais vendidos");
        shop.find("a[data-os-product]")[2].find(".os-pd-name")[0].components("");
        return true;
      }`,
    );
    await selectShop(s, "Mais vendidos");
    await s.page.getByRole("button", { name: "Criar as páginas que faltam (8)" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Criar as páginas que faltam" });
    await dialog.waitFor();
    const nameless = dialog.getByRole("listitem").filter({ hasText: "Produto sem nome" });
    expect(await nameless.textContent()).toContain("Sem nome: escreva o nome no cartão para criar a página dele");
    expect(await dialog.textContent()).toContain("O produto sem nome fica de fora.");
    await dialog.getByRole("button", { name: "Criar 7 páginas" }).click();
    await dialog.waitFor({ state: "hidden" });
    const [call] = await actionCalls(s, "createProductPagesAction");
    const names = (call.input as { products: { name: string }[] }).products.map((p) => p.name);
    expect(names).toHaveLength(7);
    expect(names.every(Boolean)).toBe(true);
    expect((await cardHrefs(s, "Mais vendidos"))[2]).toBe("#");
  });
});

describe("excluir a página de um produto", { timeout: 40_000 }, () => {
  it("o aviso diz de que produto da vitrine ela é a página", async () => {
    const server = new FakeServer();
    const pages = [
      {
        id: "cpagLoja00000000000000001",
        name: "Loja",
        slug: "loja",
        type: "OTHER",
        isHome: true,
        variantCount: 1,
        documentId: "docL",
        mobileDocumentId: null,
      },
      {
        id: "cpagFone00000000000000001",
        name: "Fone sem fio",
        slug: "fone",
        type: "SALES",
        isHome: false,
        variantCount: 1,
        documentId: "docF",
        mobileDocumentId: null,
      },
    ];
    const s = await openApp(browser, server, "lista", { waitReady: false, pages: { offerId: OFFER_ID, pages } });
    sessions.push(s);
    await setActionResult(
      s,
      "pageReferencesAction",
      `() => ({ ok: true, data: { count: 1, pages: [{ id: "cpagLoja00000000000000001", name: "Loja" }], products: [{ pageId: "cpagLoja00000000000000001", pageName: "Loja", names: ["Fone de ouvido Bluetooth sem fio"] }] } })`,
    );
    await s.page.getByRole("button", { name: "Ações da página Fone sem fio" }).click();
    await s.page.getByRole("menuitem", { name: "Excluir página" }).click();
    const dialog = s.page.getByRole("alertdialog", { name: 'Excluir a página "Fone sem fio"?' });
    await dialog
      .getByText("Ela é a página do produto “Fone de ouvido Bluetooth sem fio”, da vitrine da página “Loja”.")
      .waitFor();
    await dialog.getByText(/O produto fica sem página: a vitrine avisa no editor/).waitFor();
    // Escolhendo outra página para os links, o aviso de "sem página" some.
    await dialog.getByRole("combobox").click();
    await s.page.getByRole("option", { name: "Loja" }).click();
    expect(await dialog.getByText(/O produto fica sem página/).count()).toBe(0);
  });
});
