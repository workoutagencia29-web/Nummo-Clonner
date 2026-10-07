/**
 * Página em branco no editor (GrapesJS no Chromium): o <body> só com uma
 * quebra de linha (blankPageHtml — ex.: a página de obrigado criada sem
 * modelo) era importado com a raiz da página detectada como "text"; salvo
 * assim, o projeto não abria mais (canvas vazio). importPageHtml mantém a raiz
 * como "wrapper" e fixPageRoots conserta projetos já salvos com o defeito.
 */
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blankPageHtml } from "@/lib/templates";
import { type EditorWindow, openEditor, pageErrors } from "./blocks-harness";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

type Project = { pages: { frames: { component: { type?: string } }[] }[] };

describe("página em branco", () => {
  it("importada, recebe um bloco, é salva e reabre com o bloco", async () => {
    const page = await openEditor(browser, {});
    const project = await page.evaluate((html) => {
      const w = window as unknown as EditorWindow;
      w.OS.importPageHtml(w.ed, html);
      w.ed.getWrapper()?.append(w.ed.Blocks.get("acesso-produto")?.get("content") as never);
      return w.ed.getProjectData() as Project;
    }, blankPageHtml("Obrigado"));
    expect(project.pages[0].frames[0].component.type).toBe("wrapper");
    await page.close();

    const again = await openEditor(browser, { project });
    expect(
      await again.evaluate(
        () => (window as unknown as EditorWindow).ed.getWrapper()?.find('[data-os-widget="access"]').length,
      ),
    ).toBe(1);
    expect(pageErrors(again)).toEqual([]);
    await again.close();

    // Projeto salvo antes da correção (raiz "text"): abre e mostra o bloco.
    project.pages[0].frames[0].component.type = "text";
    const broken = await openEditor(browser, { project });
    const state = await broken.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const doc = ed.Canvas.getDocument() as Document;
      return { type: ed.getWrapper()?.get("type"), shown: !!doc.querySelector('[data-os-widget="access"]') };
    });
    expect(state).toEqual({ type: "wrapper", shown: true });
    expect(pageErrors(broken)).toEqual([]);
    await broken.close();
  }, 60_000);
});
