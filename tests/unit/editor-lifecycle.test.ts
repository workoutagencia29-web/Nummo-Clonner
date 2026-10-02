/**
 * Fechar o editor com agendamentos pendentes (duplo mount do React, sair do
 * editor logo depois de uma edição) não pode gerar erros: o GrapesJS avisa
 * "destroy" antes de desmontar os módulos, e a desmontagem reagenda tarefas.
 */
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type EditorWindow, openEditor, pageErrors } from "./blocks-harness";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

it("destruir o editor com tarefas agendadas não gera erros depois", async () => {
  const page = await openEditor(browser);
  await page.evaluate(async () => {
    const ed = (window as unknown as EditorWindow).ed;
    // Ids repetidos, estilos e seleção: agenda as rotinas de ids, cascata e dicas de estilo.
    ed.setComponents(
      '<section id="s"><h2 id="comprar">A</h2><h2 id="comprar">B</h2><p id="p">Texto</p></section><style>#comprar{color:red}</style>',
    );
    const p = ed.getWrapper()?.find("#p")[0];
    if (p) {
      ed.select(p);
      p.addStyle({ color: "blue" });
    }
    ed.getWrapper()?.append('<div id="novo">novo</div>');
    ed.destroy();
    await new Promise((r) => setTimeout(r, 300));
  });
  await page.waitForTimeout(200);
  expect(pageErrors(page)).toEqual([]);
  await page.close();
});

it("criar e destruir logo em seguida (duplo mount do React) não gera erros", async () => {
  const page = await openEditor(browser);
  await page.evaluate(async () => {
    const w = window as unknown as EditorWindow;
    for (let i = 0; i < 3; i++) {
      const box = document.createElement("div");
      box.style.height = "400px";
      const panels = ["blocks", "layers", "styles", "traits"].map(() => document.createElement("div"));
      document.body.append(box, ...panels);
      const [blocks, layers, styles, traits] = panels;
      const ed = w.OS.createEditor({ canvas: box, blocks, layers, styles, traits }, null);
      ed.setComponents('<h2 id="x">A</h2><h2 id="x">B</h2><style>#x{color:red}</style>');
      ed.destroy();
    }
    await new Promise((r) => setTimeout(r, 400));
  });
  await page.waitForTimeout(200);
  expect(pageErrors(page)).toEqual([]);
  await page.close();
});
