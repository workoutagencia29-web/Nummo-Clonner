/**
 * Editor: clicar num bloco adiciona o bloco (abaixo do item selecionado, depois
 * da seção atual ou no fim da página) e a opção "＋ Criar link da oferta…".
 */
import type { Component } from "grapesjs";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type EditorWindow, openEditor, pageErrors } from "./blocks-harness";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

const START = `
  <section id="s1"><h2 id="t1">Título</h2><p id="p1">Texto <b id="b1">forte</b></p></section>
  <section id="s2"><p id="p2">Outra seção</p></section>`;

async function freshEditor() {
  const page = await openEditor(browser);
  await page.evaluate((html) => {
    const ed = (window as unknown as EditorWindow).ed;
    ed.setComponents(html);
  }, START);
  return page;
}

/** Clica no bloco do painel (como o usuário). */
async function clickBlock(page: Page, label: string) {
  await page.locator("#blocks .gjs-block", { hasText: label }).first().click();
}

/** Ordem dos filhos (id ou tipo) de um componente, pelo id do pai. */
async function childrenOf(page: Page, parentId: string | null) {
  return page.evaluate((id) => {
    const ed = (window as unknown as EditorWindow).ed;
    const parent = id ? (ed.getWrapper()?.find(`#${id}`)[0] as Component) : ed.getWrapper();
    return parent?.components().map((c: Component) => c.getAttributes().id || c.get("type") || c.get("tagName")) ?? [];
  }, parentId);
}

async function selectById(page: Page, id: string) {
  await page.evaluate((cid) => {
    const ed = (window as unknown as EditorWindow).ed;
    ed.select(ed.getWrapper()?.find(`#${cid}`)[0] as Component);
  }, id);
}

async function selectedInfo(page: Page) {
  return page.evaluate(() => {
    const ed = (window as unknown as EditorWindow).ed;
    const sel = ed.getSelected();
    return { tag: sel?.get("tagName"), parent: sel?.parent()?.getAttributes().id ?? null };
  });
}

describe("clicar num bloco", () => {
  it("sem seleção: vai para o fim da página e fica selecionado", async () => {
    const page = await freshEditor();
    await clickBlock(page, "Título");
    const top = await childrenOf(page, null);
    expect(top.slice(0, 2)).toEqual(["s1", "s2"]);
    expect(top).toHaveLength(3);
    expect((await selectedInfo(page)).tag).toBe("h2");
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it("elemento: entra logo abaixo do item selecionado (subindo de <b> para o parágrafo)", async () => {
    const page = await freshEditor();
    await selectById(page, "b1");
    await clickBlock(page, "Botão do checkout");
    const inside = await childrenOf(page, "s1");
    expect(inside[0]).toBe("t1");
    expect(inside[1]).toBe("p1");
    expect(inside).toHaveLength(3);
    expect((await selectedInfo(page)).parent).toBe("s1");
    await page.close();
  });

  it("seção: entra depois da seção do item selecionado, não dentro dela", async () => {
    const page = await freshEditor();
    await selectById(page, "t1");
    await clickBlock(page, "Seção colorida");
    const top = await childrenOf(page, null);
    expect(top[0]).toBe("s1");
    expect(top[2]).toBe("s2");
    expect(top).toHaveLength(3);
    expect(await childrenOf(page, "s1")).toEqual(["t1", "p1"]);
    await page.close();
  });

  it("itens fixos na tela (WhatsApp flutuante) vão para o fim da página", async () => {
    const page = await freshEditor();
    await selectById(page, "t1");
    await clickBlock(page, "WhatsApp flutuante");
    expect(await childrenOf(page, "s1")).toEqual(["t1", "p1"]);
    expect(await childrenOf(page, null)).toHaveLength(3);
    await page.close();
  });

  it("um ⌘Z desfaz a inclusão", async () => {
    const page = await freshEditor();
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed.UndoManager.clear();
    });
    await selectById(page, "p2");
    await clickBlock(page, "Texto");
    expect(await childrenOf(page, "s2")).toHaveLength(2);
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed.UndoManager.undo();
    });
    expect(await childrenOf(page, "s2")).toEqual(["p2"]);
    await page.close();
  });
});

describe("＋ Criar link da oferta…", () => {
  it("abre o pedido de link novo e não grava a opção no elemento", async () => {
    const page = await openEditor(browser, { links: [{ key: "checkout", label: "Checkout" }] });
    const result = await page.evaluate(async () => {
      const w = window as unknown as EditorWindow;
      const ed = w.ed;
      const calls: string[] = [];
      w.OS.installNewLinkOption(ed, (req) => calls.push(`${req.kind}:${req.component.getAttributes().id}`));
      ed.setComponents('<a id="btn" href="#" data-os-link="checkout">Comprar</a>');
      const btn = ed.getWrapper()?.find("#btn")[0] as Component;
      ed.select(btn);
      const trait = btn.getTrait("data-os-link");
      const options = (trait?.get("options") as { id: string }[]).map((o) => o.id);
      trait?.setValue("__novo-link__");
      await new Promise((r) => setTimeout(r, 50));
      return { calls, value: btn.getAttributes()["data-os-link"], options };
    });
    expect(result.options).toEqual(["", "checkout", "__novo-link__"]);
    expect(result.calls).toEqual(["CHECKOUT:btn"]);
    expect(result.value).toBe("checkout");
    await page.close();
  });

  it("escolher uma página do funil desliga o link da oferta", async () => {
    const page = await openEditor(browser, {
      links: [{ key: "checkout", label: "Checkout" }],
      pages: [
        { id: "pagina0000000000000001", name: "Vendas" },
        { id: "pagina0000000000000002", name: "Obrigado" },
      ],
    });
    const attrs = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.setComponents('<a id="btn" href="#" data-os-link="checkout">Comprar</a>');
      const btn = ed.getWrapper()?.find("#btn")[0] as Component;
      ed.select(btn);
      btn.getTrait("os-page")?.setValue("pagina0000000000000002");
      return btn.getAttributes();
    });
    expect(attrs.href).toBe("os-page:pagina0000000000000002");
    expect(attrs["data-os-link"]).toBeUndefined();
    await page.close();
  });
});
