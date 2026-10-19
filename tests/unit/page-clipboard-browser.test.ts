/**
 * Copiar/colar entre páginas no editor de verdade (GrapesJS no Chromium):
 * - copiar + colar recria o elemento com um ID NOVO e o estilo junto (a regra
 *   nova veio do clipboard, não existia antes);
 * - o CSS ORIGINAL da página (classe clonada) entra no clipboard; reset global
 *   (`a{}`) não;
 * - `installPageClipboard` faz o core:copy gravar o clipboard entre páginas.
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type EditorWindow, openEditor, pageErrors } from "./blocks-harness";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** display/estilo calculado no canvas do editor. */
async function bg(page: Page, selector: string, nth: number): Promise<string> {
  return page.evaluate(
    ([sel, i]) => {
      const ed = (window as unknown as EditorWindow).ed;
      const doc = ed.Canvas.getDocument();
      const el = doc?.querySelectorAll(sel as string)[i as number] as HTMLElement | undefined;
      return el && doc?.defaultView ? doc.defaultView.getComputedStyle(el).backgroundColor : "sem-elemento";
    },
    [selector, nth] as const,
  );
}

describe("copiar/colar entre páginas", () => {
  it("colar recria o elemento com id novo e o estilo junto", async () => {
    const page = await openEditor(browser);
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.setComponents('<section class="box" data-test="s"><p>Oi</p></section>');
      const comp = ed.getWrapper()?.find(".box")[0];
      if (!comp) throw new Error("sem .box");
      ed.select(comp);
      comp.setStyle({ "background-color": "rgb(0, 128, 0)" }); // vira regra #id (avoidInlineStyle)
      (window as unknown as EditorWindow).OS.copySelection(ed);
      (window as unknown as EditorWindow).OS.pasteFromClipboard(ed);
    });
    // Duas caixas agora (a original + a colada).
    expect(await page.evaluate(() => (window as unknown as EditorWindow).ed.getWrapper()?.find(".box").length)).toBe(2);
    // A colada tem um id DIFERENTE da original...
    const ids = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      return ed
        .getWrapper()
        ?.find(".box")
        .map((c) => c.getId());
    });
    expect(ids?.[0]).toBeTruthy();
    expect(ids?.[1]).toBeTruthy();
    expect(ids?.[0]).not.toBe(ids?.[1]);
    // ...e o estilo veio junto (a regra do id novo só existe porque o clipboard a trouxe).
    expect(await bg(page, ".box", 0)).toBe("rgb(0, 128, 0)");
    expect(await bg(page, ".box", 1)).toBe("rgb(0, 128, 0)");
    // O clipboard ficou no localStorage (compartilhado entre as páginas).
    expect(await page.evaluate(() => !!localStorage.getItem("offerstudio.editor.clipboard"))).toBe(true);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it("o clipboard leva a regra de classe do CSS original, mas não um reset global (a{})", async () => {
    const page = await openEditor(browser);
    const css = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.setComponents('<a class="btn" data-test="b">Comprar</a>');
      // Folha base como a de uma página clonada (@layer os-original lida pelo CSSOM).
      const doc = ed.Canvas.getDocument();
      doc?.head.insertAdjacentHTML(
        "beforeend",
        "<style data-os-base>a{color:red}.btn{color:rgb(0, 0, 255);font-weight:bold}</style>",
      );
      const comp = ed.getWrapper()?.find(".btn")[0];
      if (!comp) throw new Error("sem .btn");
      ed.select(comp);
      (window as unknown as EditorWindow).OS.copySelection(ed);
      return JSON.parse(localStorage.getItem("offerstudio.editor.clipboard") || "{}").css as string;
    });
    // A regra da classe clonada entra (o visual vai junto)...
    expect(css).toContain(".btn");
    expect(css).toContain("rgb(0, 0, 255)");
    // ...e o reset global do site (a{color:red}) NÃO entra (bagunçaria a página de destino).
    expect(css).not.toContain("red");
    await page.close();
  });

  it("installPageClipboard faz o Ctrl+C (core:copy) gravar o clipboard entre páginas", async () => {
    const page = await openEditor(browser);
    const saved = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      (window as unknown as EditorWindow).OS.installPageClipboard(ed);
      ed.setComponents('<section class="box2"><p>Oi</p></section>');
      const comp = ed.getWrapper()?.find(".box2")[0];
      if (!comp) throw new Error("sem .box2");
      ed.select(comp);
      localStorage.removeItem("offerstudio.editor.clipboard");
      ed.runCommand("core:copy"); // o atalho Ctrl+C roda este comando
      return !!localStorage.getItem("offerstudio.editor.clipboard");
    });
    expect(saved).toBe(true);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });
});
