/**
 * Moeda da oferta no editor de verdade (GrapesJS no Chromium): as vitrines e a
 * caixa de compra soltas na página (clique no bloco, com o mouse) nascem na
 * moeda da oferta (contexto dos widgets), com as frases no idioma dela; um
 * passo só do Desfazer tira o bloco inteiro; a marca auxiliar não vai para o
 * projeto; o "＋ Adicionar produto" acompanha a vitrine; o editor sozinho não
 * muda a moeda do que já está na página (reabrir numa oferta de outra moeda);
 * depois de trocar a moeda da oferta, o editor abre tudo na moeda nova (e
 * desenha as partes iguais às que o servidor refez no HTML salvo); o editor
 * completo (editor-app.tsx) passa a moeda do payload aos blocos; e o editor
 * aberto ANTES da troca: o conflito diz que a moeda mudou, "Manter a minha"
 * grava com a moeda que ele conhecia (o servidor passa a página para a de
 * agora) e recarrega; numa página sem vitrine, só os blocos novos passam a
 * nascer na moeda de agora, sem recarregar. No Histórico, os pontos da troca
 * aparecem com a moeda ("Antes do peso mexicano", selo "Troca de moeda") e
 * restaurar um deles avisa que só aquela página volta para a moeda de antes.
 */
import * as cheerio from "cheerio";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { switchDocumentCurrency } from "@/lib/offer-currency-switch";
import { type EditorWindow, editorOutput, openEditor, pageErrors } from "./blocks-harness";
import { FakeServer, makePayload, openApp, type Session, waitFor, withEditor } from "./fix3-E1-harness";

const PRINTS = process.env.OS_PRINTS_DIR;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

const PRICED = '[data-os-widget="products"], [data-os-widget="product-buy"]';

/** Clica no bloco do painel (como o usuário): entra no fim da página. */
async function clickBlock(page: Page, label: string) {
  await page.locator("#blocks .gjs-block", { hasText: label }).first().click();
}

/** Moeda de cada vitrine/caixa de compra da página e o que o canvas mostra no primeiro preço. */
const shown = (page: Page) =>
  page.evaluate((sel) => {
    const ed = (window as unknown as EditorWindow).ed;
    const doc = ed.Canvas.getDocument() as Document;
    const comps = ed.getWrapper()?.find(sel) ?? [];
    return {
      currencies: comps.map((c) => c.getAttributes()["data-os-currency"]),
      langs: comps.map((c) => c.getAttributes()["data-os-pd-lang"] ?? null),
      now: doc.querySelector(".os-pd-now")?.textContent ?? null,
      inst: doc.querySelector(".os-pd-inst")?.textContent ?? null,
      old: doc.querySelector(".os-pd-old")?.textContent ?? null,
    };
  }, PRICED);

const undo = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as EditorWindow).ed.UndoManager.undo();
  });
const redo = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as EditorWindow).ed.UndoManager.redo();
  });
const clear = (page: Page) =>
  page.evaluate(() => {
    const ed = (window as unknown as EditorWindow).ed;
    ed.setComponents("");
    ed.UndoManager.clear();
  });
const projectJson = (page: Page) =>
  page.evaluate(() => JSON.stringify((window as unknown as EditorWindow).ed.getProjectData()));

describe("blocos da Loja numa oferta em peso mexicano", () => {
  let page: Page;
  beforeAll(async () => {
    page = await openEditor(browser, { currency: "MXN" });
  });
  afterAll(async () => {
    await page?.close();
  });

  const BLOCKS: [string, number][] = [
    ["Grade de produtos", 1],
    ["Carrossel de produtos", 1],
    ["Faixa de ofertas", 1],
    ["Oferta do dia + ofertas", 2],
    ["Lista de ofertas do dia", 1],
    ["Caixa de compra", 1],
  ];

  for (const [label, count] of BLOCKS) {
    it(`“${label}” nasce em peso mexicano, com as frases em espanhol`, async () => {
      await clear(page);
      await clickBlock(page, label);
      const s = await shown(page);
      expect(s.currencies).toEqual(Array(count).fill("MXN"));
      // O idioma acompanha a moeda (sem idioma próprio).
      expect(s.langs).toEqual(Array(count).fill(null));
      expect(s.now?.startsWith("$")).toBe(true);
      if (s.inst) expect(s.inst).toMatch(/^\d+x \$[\d.,]+( sin intereses)?$/);
      const { html } = await editorOutput(page);
      expect(html).not.toContain("R$");
      expect(html).toContain('data-os-currency="MXN"');
      // A marca auxiliar do bloco não vai para o projeto salvo.
      expect(await projectJson(page)).not.toContain("osOfferCurrency");
      expect(pageErrors(page)).toEqual([]);
    });
  }

  it("um passo do Desfazer tira o bloco inteiro; Refazer devolve em peso mexicano", async () => {
    await clear(page);
    await clickBlock(page, "Grade de produtos");
    expect((await shown(page)).currencies).toEqual(["MXN"]);
    await undo(page);
    expect((await shown(page)).currencies).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as EditorWindow).ed.UndoManager.hasUndo())).toBe(false);
    await redo(page);
    const s = await shown(page);
    expect(s.currencies).toEqual(["MXN"]);
    expect(s.now).toBe("$129.90");
  });

  it("“＋ Adicionar produto” entra na moeda da vitrine", async () => {
    await clear(page);
    await clickBlock(page, "Grade de produtos");
    const now = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const w = ed.getWrapper()?.find('[data-os-widget="products"]')[0];
      if (!w) throw new Error("sem vitrine");
      ed.select(w);
      const t = w.getTrait("os-pd-add");
      (t?.get("command") as (e: unknown, t: unknown) => void)(ed, t);
      const doc = ed.Canvas.getDocument() as Document;
      const cards = doc.querySelectorAll("a[data-os-product]");
      return cards[cards.length - 1]?.querySelector(".os-pd-now")?.textContent;
    });
    expect(now).toBe("$99.90");
    if (PRINTS) await page.screenshot({ path: `${PRINTS}/editor-vitrine-peso-mexicano.png` });
  });
});

describe("outras moedas e oferta sem moeda", () => {
  it("euro (frases em português), dólar (em inglês) e sem moeda no contexto: real", async () => {
    for (const [currency, now, inst] of [
      ["EUR", "129,90 €", "12x 10,83 € sem juros"],
      ["USD", "US$ 129.90", "12x US$ 10.83 interest-free"],
      [undefined, "R$ 129,90", "12x R$ 10,83 sem juros"],
    ] as const) {
      const page = await openEditor(browser, currency ? { currency } : {});
      await clickBlock(page, "Caixa de compra");
      const s = await shown(page);
      expect(s.currencies, String(currency)).toEqual([currency ?? "BRL"]);
      expect(s.now).toBe(now);
      expect(s.inst).toBe(inst);
      expect(pageErrors(page)).toEqual([]);
      await page.close();
    }
  });

  it("o editor sozinho não muda a moeda do que já está na página (reaberto numa oferta em dólar, continua em peso)", async () => {
    const first = await openEditor(browser, { currency: "MXN" });
    await clickBlock(first, "Grade de produtos");
    const project = await first.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData());
    await first.close();
    const again = await openEditor(browser, { currency: "USD", project });
    const s = await shown(again);
    expect(s.currencies).toEqual(["MXN"]);
    expect(s.now).toBe("$129.90");
    // Um bloco novo, na mesma página, nasce na moeda de agora.
    await clickBlock(again, "Caixa de compra");
    expect((await shown(again)).currencies).toEqual(["MXN", "USD"]);
    await again.close();
  });
});

describe("editor aberto depois de trocar a moeda da oferta", () => {
  it("vitrine e caixa salvas em real abrem em peso mexicano, iguais ao HTML que o servidor refez", async () => {
    // Página montada e salva no editor numa oferta em real.
    const first = await openEditor(browser, { currency: "BRL" });
    await clickBlock(first, "Grade de produtos");
    await clickBlock(first, "Caixa de compra");
    const project = await first.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData());
    const { html } = await editorOutput(first);
    await first.close();

    // A troca da moeda da oferta (mesmas regras do serviço) no projeto e no HTML salvo.
    const change = switchDocumentCurrency({ project, html, editableHtml: null }, "MXN");
    expect(change.changed).toBe(true);
    expect(change.hosts.map((h) => h.kind)).toEqual(["products", "product-buy"]);

    const again = await openEditor(browser, { currency: "MXN", project: change.project });
    const s = await shown(again);
    expect(s.currencies).toEqual(["MXN", "MXN"]);
    expect(s.now).toBe("$129.90");
    expect(s.inst).toMatch(/^\d+x \$[\d.,]+ sin intereses$/);
    // O campo Moeda das Configurações mostra o peso.
    const trait = await again.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const w = ed.getWrapper()?.find('[data-os-widget="products"]')[0];
      if (!w) throw new Error("sem vitrine");
      ed.select(w);
      return w.getTrait("data-os-currency")?.getValue();
    });
    expect(trait).toBe("MXN");
    // O editor desenha as partes exatamente como o servidor as refez no HTML salvo.
    const parts = (doc: string) => {
      const $ = cheerio.load(doc);
      return $("[data-os-pd-part], .os-pd-nav")
        .map((_, el) => $(el).html())
        .get();
    };
    expect(parts((await editorOutput(again)).html)).toEqual(parts(change.html ?? ""));
    expect(pageErrors(again)).toEqual([]);
    await again.close();

    // O editor completo (editor-app.tsx), com o payload da oferta já em peso mexicano.
    const server = new FakeServer();
    const id = "docmoedatrocada00000001";
    server.add(
      makePayload({
        documentId: id,
        project: change.project,
        html: null,
        offer: { id: "oferta00000000000000002", name: "Loja", currency: "MXN" },
      }),
    );
    const app = await openApp(browser, server, id);
    const canvas = app.page.frameLocator("iframe.gjs-frame");
    await canvas.locator(".os-pd-now").first().waitFor();
    expect(await canvas.locator(".os-pd-now").first().textContent()).toBe("$129.90");
    expect(await canvas.locator(".os-pb .os-pd-now").textContent()).toMatch(/^\$[\d,]+(\.\d+)?$/);
    expect(await canvas.locator("body").innerText()).not.toContain("R$");
    if (PRINTS) await app.page.screenshot({ path: `${PRINTS}/editor-depois-da-troca-peso-mexicano.png` });
    expect(app.errors).toEqual([]);
    await app.page.close();
  }, 60_000);
});

describe("editor completo: a moeda vem do payload da oferta", { timeout: 60_000 }, () => {
  let s: Session;
  afterAll(async () => {
    await s?.page.close();
  });

  it("clicar em “Grade de produtos” no painel de blocos põe a vitrine em peso mexicano", async () => {
    const server = new FakeServer();
    const id = "docmoedaoferta0000000001";
    server.add(
      makePayload({ documentId: id, offer: { id: "oferta00000000000000001", name: "Loja", currency: "MXN" } }),
    );
    s = await openApp(browser, server, id);
    await waitFor(() => server.okPuts.length === 1, 10_000, "primeiro salvamento");
    await s.page.locator(".gjs-block", { hasText: "Grade de produtos" }).first().click();
    const currencies = await withEditor<string[]>(
      s.page,
      `(ed) => ed.getWrapper().find('[data-os-widget="products"]').map((c) => c.getAttributes()["data-os-currency"])`,
    );
    expect(currencies).toEqual(["MXN"]);
    const price = await s.page.frameLocator("iframe.gjs-frame").locator(".os-pd-now").first().textContent();
    expect(price).toBe("$129.90");
    if (PRINTS) await s.page.screenshot({ path: `${PRINTS}/editor-completo-vitrine-peso-mexicano.png` });
    expect(s.errors).toEqual([]);
  });
});

describe("editor aberto antes de trocar a moeda da oferta", { timeout: 60_000 }, () => {
  it("o conflito diz que a moeda mudou; “Manter a minha” grava pela moeda de agora e recarrega", async () => {
    // Página com vitrine montada numa oferta em real.
    const first = await openEditor(browser, { currency: "BRL" });
    await clickBlock(first, "Grade de produtos");
    const project = await first.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData());
    await first.close();

    const server = new FakeServer();
    const id = "docmoedaabertaantes00001";
    server.add(
      makePayload({
        documentId: id,
        project,
        html: null,
        offer: { id: "oferta00000000000000003", name: "Loja", currency: "BRL" },
      }),
    );
    const app = await openApp(browser, server, id);
    // Em outra aba, a moeda da oferta foi trocada para peso: a página subiu de revisão.
    const doc = server.docs.get(id);
    if (doc) doc.revision = 5;
    server.offerCurrency = "MXN";
    server.currencySwitchedOnPut = 1;
    await withEditor(
      app.page,
      `(ed) => { ed.getWrapper().find('[data-os-widget="products"]')[0].addStyle({ "margin-top": "7px" }); return true; }`,
    );
    const dialog = app.page.getByRole("dialog", { name: "A moeda da oferta foi trocada" });
    await dialog.waitFor();
    const text = (await dialog.innerText()).replace(/\s+/g, " ");
    expect(text).toContain(
      "Enquanto esta página estava aberta, a moeda da oferta passou para peso mexicano, e as vitrines e caixas de compra desta página foram junto.",
    );
    expect(text).toContain("com as vitrines e caixas de compra também em peso mexicano");
    if (PRINTS) await app.page.screenshot({ path: `${PRINTS}/editor-conflito-moeda-trocada.png` });
    // O 409 não gravou nada; "Manter a minha" grava com a revisão nova e a moeda que o editor conhecia.
    expect(server.okPuts).toEqual([]);
    const reloaded = app.page.waitForEvent("load");
    await dialog.getByRole("button", { name: "Manter a minha (sobrescrever)" }).click();
    await reloaded;
    expect(server.okPuts.map((p) => [p.revision, p.currency])).toEqual([[5, "BRL"]]);
    expect(server.okPuts[0].css).toContain("margin-top:7px");
    expect(app.errors).toEqual([]);
    await app.page.close();
  });

  it("página sem vitrine: a gravação só passa a moeda de agora aos blocos novos (sem recarregar)", async () => {
    const server = new FakeServer();
    server.offerCurrency = "MXN";
    const id = "docmoedaabertaantes00002";
    server.add(
      makePayload({ documentId: id, offer: { id: "oferta00000000000000004", name: "Loja", currency: "BRL" } }),
    );
    const app = await openApp(browser, server, id);
    let loads = 0;
    app.page.on("load", () => loads++);
    await waitFor(() => server.okPuts.length >= 1, 10_000, "primeiro salvamento");
    expect(server.okPuts[0].currency).toBe("BRL");
    // A vitrine posta agora nasce em peso (a moeda que a gravação trouxe), e a próxima gravação vai com ela.
    await app.page.locator(".gjs-block", { hasText: "Grade de produtos" }).first().click();
    const currencies = await withEditor<string[]>(
      app.page,
      `(ed) => ed.getWrapper().find('[data-os-widget="products"]').map((c) => c.getAttributes()["data-os-currency"])`,
    );
    expect(currencies).toEqual(["MXN"]);
    await waitFor(() => server.okPuts.some((p) => p.html.includes('data-os-currency="MXN"')), 8000, "gravação");
    expect(server.okPuts.at(-1)?.currency).toBe("MXN");
    expect(loads).toBe(0);
    expect(app.errors).toEqual([]);
    await app.page.close();
  });
});

describe("Histórico do editor depois de trocar a moeda", { timeout: 60_000 }, () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 9, 18, minutes)).toISOString();

  it("os pontos da troca mostram a moeda e o selo “Troca de moeda”; restaurar avisa que só esta página volta", async () => {
    const server = new FakeServer();
    const id = "docmoedahistorico0000001";
    server.add(
      makePayload({ documentId: id, offer: { id: "oferta00000000000000005", name: "Loja", currency: "MXN" } }),
    );
    server.versions = [
      { id: "v1", kind: "BULK_REPLACE", label: "Antes do peso mexicano", createdAt: at(49), bytes: 10 },
      // Nome que a troca gravava antes: aparece com o nome curto de hoje.
      { id: "v2", kind: "BULK_REPLACE", label: "Antes de trocar a moeda para euro", createdAt: at(48), bytes: 10 },
      // Localizar e substituir continua com o selo dele.
      { id: "v3", kind: "BULK_REPLACE", label: "Antes de substituir “R$” por “$”", createdAt: at(47), bytes: 10 },
      { id: "v4", kind: "AUTO", label: null, createdAt: at(46), bytes: 10 },
    ];
    const app = await openApp(browser, server, id);
    await app.page.getByRole("button", { name: "Histórico" }).click();
    const dialog = app.page.getByRole("dialog", { name: "Histórico" });
    await dialog.locator("li").first().waitFor();
    const rows = await dialog.locator("li").evaluateAll((items) =>
      items.map((li) => {
        const name = li.querySelector("p");
        return {
          name: name?.textContent ?? "",
          title: name?.getAttribute("title") ?? null,
          // O nome quebra a linha em vez de sumir no "…".
          truncated: name?.classList.contains("truncate") ?? false,
          badge: li.querySelector('[data-slot="badge"]')?.textContent ?? null,
        };
      }),
    );
    expect(rows).toEqual([
      { name: "Antes do peso mexicano", title: "Antes do peso mexicano", truncated: false, badge: "Troca de moeda" },
      { name: "Antes do euro", title: "Antes do euro", truncated: false, badge: "Troca de moeda" },
      {
        name: "Antes de substituir “R$” por “$”",
        title: "Antes de substituir “R$” por “$”",
        truncated: false,
        badge: "Antes de substituir",
      },
      // Sem nome: o nome do tipo, sem repetir o selo.
      { name: "Automático", title: "Automático", truncated: false, badge: null },
    ]);

    // Restaurar um ponto da troca: a confirmação diz que só esta página volta para a moeda de antes.
    await dialog.getByRole("button", { name: "Restaurar: Antes do peso mexicano" }).click();
    const confirm = app.page.getByRole("alertdialog", { name: "Voltar para este ponto?" });
    await confirm.waitFor();
    expect((await confirm.innerText()).replace(/\s+/g, " ")).toContain(
      "Este ponto é de antes de a moeda da oferta mudar. Restaurar volta só esta página, com as vitrines e caixas de compra na moeda de antes: a oferta, o pagamento na página e as outras páginas continuam em peso mexicano. Para desfazer a troca na oferta inteira, troque a moeda de volta no cartão “Moeda da oferta” (aba “Moeda, empresa e SEO”).",
    );
    await confirm.getByRole("button", { name: "Cancelar" }).click();
    await confirm.waitFor({ state: "hidden" });

    // Outro ponto: a confirmação de sempre.
    await dialog.getByRole("button", { name: "Restaurar: Antes de substituir “R$” por “$”" }).click();
    await confirm.waitFor();
    const plain = (await confirm.innerText()).replace(/\s+/g, " ");
    expect(plain).toContain("A página volta a ficar como estava nesse ponto do histórico.");
    expect(plain).not.toContain("moeda");
    await confirm.getByRole("button", { name: "Cancelar" }).click();
    expect(server.restores).toBe(0);
    expect(app.errors).toEqual([]);
    await app.page.close();
  });
});
