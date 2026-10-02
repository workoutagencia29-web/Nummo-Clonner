/**
 * Fase 3 — terceira rodada, no editor-app.tsx de verdade (harness E1):
 * - ⌘S (ou fechar a aba) com o foco parado num campo do painel, sem digitar:
 *   nada muda (antes o campo de cor reescrevia o valor e, no Celular, criava
 *   uma regra só do celular que congelava a cor);
 * - ⌘S no meio da digitação de um texto: o ⌘Z do navegador continua
 *   desfazendo o que foi digitado antes do ⌘S, e o texto na tela volta a ser o
 *   do projeto quando a edição fecha.
 */
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appBundle,
  FakeServer,
  makePayload,
  openApp,
  type Session,
  saveStatusText,
  sleep,
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

const COLORED = `<!doctype html><html><head><title>T</title></head><body><h1 id="t" style="font-size:40px;color:rgb(10, 20, 30)">Título</h1><p id="p">Parágrafo da página</p></body></html>`;

async function freshDoc(id: string, html?: string) {
  const server = new FakeServer();
  server.add(makePayload({ documentId: id, ...(html && { html }) }));
  const s = await openApp(browser, server, id);
  sessions.push(s);
  await waitFor(() => server.okPuts.length === 1, 8000, "primeiro salvamento");
  await waitFor(async () => (await saveStatusText(s.page)).startsWith("Salvo"), 4000, "Salvo");
  return s;
}

const frameLoc = (s: Session, selector: string) => s.page.frameLocator("iframe.gjs-frame").locator(selector);

describe("foco parado num campo do painel", () => {
  it("Celular, campo de cor: ⌘S não cria regra do celular, e a cor do Desktop continua valendo no celular", async () => {
    const s = await freshDoc("docfoco00000000000000001", COLORED);
    await withEditor(s.page, `(ed) => { ed.setDevice("mobile"); return true; }`);
    await sleep(600);
    await withEditor(s.page, `(ed) => { ed.select(ed.getWrapper().find("#t")[0]); return true; }`);
    await sleep(300);
    const color = s.page.locator(".gjs-sm-property__color input").first();
    await color.click();
    await s.page.keyboard.press("ControlOrMeta+s");
    await waitFor(() => s.server.okPuts.length === 2, 4000, "gravação do ⌘S");
    expect(s.server.okPuts[1].css).toBe(s.server.okPuts[0].css);
    expect(s.server.okPuts[1].css).not.toContain("@media");

    // Fechar a aba com o foco ali: nada a gravar, sem aviso.
    const prevented = await s.page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(false);

    // A cor mudada depois no Desktop vale no celular também.
    await withEditor(s.page, `(ed) => { ed.setDevice("desktop"); return true; }`);
    await sleep(600);
    await withEditor(
      s.page,
      `(ed) => { ed.getWrapper().find("#t")[0].addStyle({ color: "rgb(200, 0, 0)" }); return true; }`,
    );
    await withEditor(s.page, `(ed) => { ed.setDevice("mobile"); return true; }`);
    await sleep(600);
    expect(await frameLoc(s, "h1").evaluate((el) => getComputedStyle(el).color)).toBe("rgb(200, 0, 0)");
  });

  it("Desktop, campo de cor: ⌘S grava sem reescrever a cor; digitar e ⌘S ainda aplica o valor", async () => {
    const s = await freshDoc("docfoco00000000000000002", COLORED);
    await withEditor(s.page, `(ed) => { ed.select(ed.getWrapper().find("#t")[0]); return true; }`);
    await sleep(300);
    const color = s.page.locator(".gjs-sm-property__color input").first();
    await color.click();
    await s.page.keyboard.press("ControlOrMeta+s");
    await waitFor(() => s.server.okPuts.length === 2, 4000, "gravação do ⌘S");
    expect(s.server.okPuts[1].css).toBe(s.server.okPuts[0].css);

    await color.fill("rgb(0, 90, 0)");
    await s.page.keyboard.press("ControlOrMeta+s");
    await waitFor(() => s.server.okPuts.length === 3, 4000, "gravação do segundo ⌘S");
    // O campo de cor grava em hexadecimal.
    expect(s.server.okPuts[2].css).toMatch(/#t\{[^}]*color:#005a00/);
  });
});

describe("⌘S no meio da digitação × desfazer do navegador", () => {
  it("⌘Z desfaz também o que foi digitado antes do ⌘S; ao fechar, o projeto fica com o texto da tela", async () => {
    const s = await freshDoc("docdesfaz000000000000001");
    const h1 = frameLoc(s, "h1");
    await h1.dblclick();
    await waitFor(async () => (await h1.getAttribute("contenteditable")) === "true", 4000, "edição de texto");
    await s.page.keyboard.press("End");
    await s.page.keyboard.type(" abc");
    await s.page.keyboard.press("ControlOrMeta+s");
    await waitFor(() => s.server.okPuts.length === 2, 4000, "gravação do ⌘S");
    expect(s.server.okPuts[1].html).toContain("Título abc");
    // A tela do texto não foi redesenhada (nenhuma marca do editor no que se digita).
    expect(await h1.evaluate((el) => el.innerHTML)).toBe("Título abc");

    await s.page.keyboard.type(" def");
    await s.page.keyboard.press("ControlOrMeta+z");
    await sleep(150);
    // Sem o ⌘S no meio, o ⌘Z do navegador desfaz a digitação toda: igual aqui.
    expect(await h1.textContent()).toBe("Título");

    await frameLoc(s, "p").click();
    await waitFor(() => s.server.okPuts.at(-1)?.html.includes('<h1 id="t">Título</h1>') ?? false, 6000, "gravação");
    await waitFor(async () => (await saveStatusText(s.page)).startsWith("Salvo"), 4000, "Salvo");
    expect(s.errors).toEqual([]);
  });

  it("⌘S e fechar a edição sem digitar mais: os elementos do texto na tela são os do projeto", async () => {
    const s = await freshDoc(
      "docdesfaz000000000000002",
      `<!doctype html><html><head><title>T</title></head><body><h1 id="t">Título <b>forte</b></h1><p id="p">x</p></body></html>`,
    );
    const h1 = frameLoc(s, "h1");
    await h1.dblclick();
    await waitFor(async () => (await h1.getAttribute("contenteditable")) === "true", 4000, "edição de texto");
    await s.page.keyboard.press("End");
    await s.page.keyboard.type(" ok");
    await s.page.keyboard.press("ControlOrMeta+s");
    await waitFor(() => s.server.okPuts.length === 2, 4000, "gravação do ⌘S");
    await frameLoc(s, "p").click();
    await sleep(300);
    const drawn = await withEditor<{ bound: boolean; text: string }>(
      s.page,
      `(ed) => {
        const h1 = ed.getWrapper().find("#t")[0];
        const container = h1.getView().getChildrenContainer();
        const bound = h1.components().models.every((c) => { const el = c.getEl(); return !!el && container.contains(el); });
        return { bound, text: container.textContent };
      }`,
    );
    expect(drawn).toEqual({ bound: true, text: "Título forte ok" });
    // O <b> do texto é um elemento de verdade de novo: dá para selecionar.
    await withEditor(s.page, `(ed) => { ed.select(ed.getWrapper().find("#t b")[0]); return true; }`);
    expect(
      await withEditor<boolean>(s.page, `(ed) => ed.getSelected()?.getEl()?.ownerDocument === ed.Canvas.getDocument()`),
    ).toBe(true);
    expect(s.errors).toEqual([]);
  });
});
