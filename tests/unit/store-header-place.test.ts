/**
 * Cabeçalho de loja sempre na largura toda da tela: ele só mora no nível de
 * cima da página (filho direto do <body>). Dentro de um contêiner com padding
 * (o bloco "Seção") ele ficava estreito, com margem dos lados e um espaço em
 * cima — no canvas e na página publicada, no computador e no celular.
 *
 * No editor (GrapesJS no Chromium): arrastar o bloco para dentro da "Seção"
 * solta no nível de cima (num popup, solta dentro) — sobre um elemento de cima,
 * antes dele, como ao colar, com a linha de soltar no topo dele, também na
 * metade de baixo de uma seção alta e numa página clonada com um div raiz; o
 * canvas rola até ele —; clicar no bloco põe no topo
 * (depois da "Contagem no topo"); colado, movido ou posto por código dentro de
 * um contêiner volta para antes dele, num passo só do Desfazer; dentro de um
 * bloco que começa escondido fica onde está; página gravada com ele dentro de
 * um contêiner é reparada ao abrir (o servidor manda o reparo; o editor de
 * verdade guarda "Antes do reparo automático" e grava); regra do cabeçalho
 * gravada antes ganha as declarações de lugar. No canvas e na página
 * publicada: largura toda em 1280/390 px (e computador/tablet/celular no
 * canvas), também com CSS de página clonada para <header>, <nav> e os <div> de
 * dentro (camada escura em ::before, menu do celular escondido por
 * visibility/opacity, `header > div` como contêiner): a pesquisa e as
 * categorias continuam à vista, do tamanho delas e clicáveis.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type { Component } from "grapesjs";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SH_PLACE } from "@/editor/widgets/store-header-content";
import { prisma } from "@/lib/db";
import { nestedStoreHeader } from "@/lib/legacy-repair";
import { getEditorPayload, removeVersionFiles, saveEditorDocument } from "@/server/services/documents";
import { createOffer } from "@/server/services/offers";
import { resetDatabase } from "../setup/per-file";
import {
  addBlock,
  type EditorWindow,
  editorOutput,
  exportPage,
  openEditor,
  openSite,
  pageErrors,
} from "./blocks-harness";
import { FakeServer, makePayload, openApp, sleep, waitFor, withEditor } from "./fix3-E1-harness";

const HEADER = '[data-os-widget="store-header"]';
const FONT = 'body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}';
const GRAPES_CSS = readFileSync(path.join(process.cwd(), "node_modules/grapesjs/dist/css/grapes.min.css"), "utf8");
/**
 * CSS de página clonada que pega os elementos <header> e <nav> e os <div> de
 * dentro do <header> (na camada da folha base): fixo, deslocado, estreito,
 * camada escura de "header herói" no ::before, `header > div` como contêiner
 * centralizado em flex e o menu do celular escondido por visibility/opacity.
 */
const CLONE_CSS =
  "@layer os-fix, os-original;@layer os-original{" +
  "header{position:fixed;top:40px;left:30px;right:auto;z-index:5;float:left;clear:none;width:60%;min-width:500px;max-width:700px;height:50px;min-height:50px;max-height:50px;margin:30px auto;padding:10px;transform:translateX(20px);box-sizing:content-box;border:5px solid red;border-radius:20px;box-shadow:0 0 10px red;background-image:linear-gradient(red,blue)}" +
  "header::before{content:'';position:absolute;top:0;left:0;width:100%;height:100%;z-index:3;background:rgba(0,0,0,.6)}" +
  "header::after{content:'';position:absolute;top:0;right:0;bottom:0;left:0;z-index:4}" +
  "nav{position:fixed;top:0;left:0;width:200px;max-width:200px;height:30px;transform:translateY(10px);float:right;border:3px solid blue}" +
  "nav::before{content:'';position:absolute;top:0;left:0;width:100%;height:100%;z-index:3}" +
  "header > div{display:flex;justify-content:space-between;align-items:center;position:relative;max-width:1140px;height:80px;margin:0 auto;padding:20px}" +
  "header div{justify-content:space-between;padding:20px}" +
  "@media (max-width:768px){header{visibility:hidden;opacity:0}nav{left:-100%;width:80%;height:100vh;visibility:hidden;opacity:0}}" +
  "}";

/**
 * Cabeçalho de loja do documento à vista e clicável: a pesquisa e as categorias
 * recebem o clique (nada por cima), visíveis, a faixa de aviso na largura toda
 * e as categorias juntas (não espalhadas pela linha).
 */
function usableHeader(doc: Document) {
  const view = doc.defaultView as Window;
  const h = doc.querySelector('[data-os-widget="store-header"]') as HTMLElement;
  const center = (el: Element) => {
    const r = el.getBoundingClientRect();
    return doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  };
  const q = h.querySelector(".os-sh-q") as HTMLElement;
  const cats = Array.from(h.querySelectorAll<HTMLElement>(".os-sh-cat"));
  const hit = center(cats[0]);
  const style = (el: Element) => view.getComputedStyle(el);
  const strip = (h.querySelector(".os-sh-strip") as HTMLElement).getBoundingClientRect();
  return {
    searchHit: center(q) === q,
    catHit: !!hit && cats[0].contains(hit),
    visible: [h, h.querySelector(".os-sh-cats") as Element].every(
      (el) => style(el).visibility === "visible" && style(el).opacity === "1",
    ),
    searchWidth: Math.round((h.querySelector(".os-sh-search") as HTMLElement).getBoundingClientRect().width),
    stripFull: Math.round(strip.left) === 0 && Math.round(strip.width) === doc.documentElement.clientWidth,
    catsGap: Math.round(cats[1].getBoundingClientRect().left - cats[0].getBoundingClientRect().right),
  };
}
type Usable = ReturnType<typeof usableHeader>;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** Elementos do nível de cima da página, por nome curto (barra, cabeçalho, seção, popup…). */
const topLevel = (page: Page) =>
  page.evaluate(() => {
    const ed = (window as unknown as EditorWindow).ed;
    return (
      ed
        .getWrapper()
        ?.components()
        .map((c: Component) => {
          const a = c.getAttributes();
          if (a["data-os-widget"] === "store-header") return "cabeçalho";
          if (a["data-os-widget"] === "countdown") return "barra";
          if (a["data-os-widget"] === "exit-popup") return "popup";
          return String(a.id || c.get("tagName"));
        }) ?? []
    );
  });

/** Filhos do "Conteúdo" da seção (id s1), por tag ou "cabeçalho". */
const sectionContent = (page: Page) =>
  page.evaluate(() => {
    const ed = (window as unknown as EditorWindow).ed;
    const content = ed.getWrapper()?.find("#s1")[0]?.components().at(0);
    return content
      ?.components()
      .map((c: Component) =>
        c.getAttributes()["data-os-widget"] === "store-header" ? "cabeçalho" : String(c.get("tagName")),
      );
  });

/** Página do usuário: "Contagem no topo (barra)" e o bloco "Seção" (id s1; título e texto dentro). */
async function userPage(page: Page) {
  await page.evaluate((css) => {
    (window as unknown as EditorWindow).ed.Css.addRules(css);
  }, FONT);
  await addBlock(page, "contador-barra");
  const id = await addBlock(page, "secao");
  await page.evaluate((cid) => {
    const ed = (window as unknown as EditorWindow).ed;
    ed.getWrapper()?.find(`#${cid}`)[0]?.addAttributes({ id: "s1" });
  }, id);
}

/** Põe um cabeçalho de loja novo dentro do "Conteúdo" da seção, por código. */
const appendHeaderToSection = (page: Page) =>
  page.evaluate(() => {
    const ed = (window as unknown as EditorWindow).ed;
    const content = ed.getWrapper()?.find("#s1")[0]?.components().at(0);
    content?.append(ed.Blocks.get("cabecalho-loja")?.get("content") as never);
  });

/** Canvas do tamanho de verdade (o editor de teste não carrega o CSS do GrapesJS). */
async function sizeCanvas(page: Page) {
  await page.addStyleTag({
    content: `${GRAPES_CSS}
#canvas{position:relative;width:1300px;height:800px}
.gjs-cv-canvas{width:100%!important;left:0!important;top:0!important;height:800px!important}
.gjs-frame-wrapper{height:800px!important}
iframe.gjs-frame{height:800px!important}`,
  });
  await page.evaluate(() => {
    (window as unknown as EditorWindow).ed.refresh();
  });
}

/**
 * Arrasta um bloco do painel até o elemento `selector` do canvas, como o mouse
 * faz (arraste do GrapesJS: startDrag, movimentos no quadro, soltar).
 */
async function dragBlock(page: Page, blockId: string, selector: string) {
  await page.evaluate(
    async ([id, sel]) => {
      const ed = (window as unknown as EditorWindow).ed;
      const doc = ed.Canvas.getDocument() as Document;
      const target = doc.querySelector(sel) as HTMLElement;
      const frameEl = document.querySelector("iframe.gjs-frame") as HTMLIFrameElement;
      const r = target.getBoundingClientRect();
      const at = { clientX: r.left + 20, clientY: r.top + Math.min(r.height / 2, 20) };
      ed.Blocks.startDrag(ed.Blocks.get(id) as never);
      frameEl.dispatchEvent(new PointerEvent("pointerenter", at));
      for (let i = 0; i < 4; i++) {
        target.dispatchEvent(new MouseEvent("mousemove", { ...at, bubbles: true }));
        await new Promise((res) => setTimeout(res, 120));
      }
      document.dispatchEvent(new PointerEvent("pointerup", { ...at, bubbles: true }));
      ed.Blocks.endDrag(false);
    },
    [blockId, selector] as const,
  );
  await page.waitForTimeout(100);
}

/**
 * Arrasta o bloco "Cabeçalho de loja" até um ponto de `selector` (`fy` = fração
 * da altura dele), com o canvas rolado até lá. Devolve, um pouco antes de
 * soltar, onde estava a linha de soltar e o topo/fim do elemento de cima
 * `top` (na tela do editor), e se o cabeçalho ficou à vista depois de solto.
 */
async function dropHeaderOn(page: Page, selector: string, fy: number, top: string) {
  return page.evaluate(
    async ([sel, f, topSel]) => {
      const ed = (window as unknown as EditorWindow).ed;
      const doc = ed.Canvas.getDocument() as Document;
      const target = doc.querySelector(sel as string) as HTMLElement;
      target.scrollIntoView({ block: "center" });
      await new Promise((res) => setTimeout(res, 200));
      const frameEl = document.querySelector("iframe.gjs-frame") as HTMLIFrameElement;
      const r = target.getBoundingClientRect();
      const at = { clientX: r.left + 20, clientY: r.top + r.height * (f as number) };
      const hovered = doc.elementFromPoint(at.clientX, at.clientY) as HTMLElement;
      ed.Blocks.startDrag(ed.Blocks.get("cabecalho-loja") as never);
      frameEl.dispatchEvent(new PointerEvent("pointerenter", at));
      for (let i = 0; i < 4; i++) {
        hovered.dispatchEvent(new MouseEvent("mousemove", { ...at, bubbles: true }));
        await new Promise((res) => setTimeout(res, 150));
      }
      const placer = ed.Canvas.getPlacerEl() as HTMLElement;
      const frameTop = frameEl.getBoundingClientRect().top;
      const box = (doc.querySelector(topSel as string) as HTMLElement).getBoundingClientRect();
      const line = {
        shown: placer.style.display !== "none",
        top: Math.round(placer.getBoundingClientRect().top),
        elTop: Math.round(frameTop + box.top),
        elBottom: Math.round(frameTop + box.bottom),
      };
      document.dispatchEvent(new PointerEvent("pointerup", { ...at, bubbles: true }));
      ed.Blocks.endDrag(false);
      // Rolagem suave até o cabeçalho solto.
      await new Promise((res) => setTimeout(res, 1200));
      const header = doc.querySelector('[data-os-widget="store-header"]') as HTMLElement;
      const hr = header.getBoundingClientRect();
      const view = doc.defaultView as Window;
      return { line, inView: hr.top >= -1 && hr.top < view.innerHeight };
    },
    [selector, fy, top] as const,
  );
}

const undo = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as EditorWindow).ed.UndoManager.undo();
  });
const redo = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as EditorWindow).ed.UndoManager.redo();
  });

describe("no editor: o cabeçalho de loja só mora no nível de cima", () => {
  it("arrastar o bloco para dentro da Seção solta no nível de cima; para dentro do popup, solta dentro dele", async () => {
    const page = await openEditor(browser);
    await sizeCanvas(page);
    await userPage(page);
    await addBlock(page, "popup-saida");
    await page.waitForTimeout(200);
    await dragBlock(page, "cabecalho-loja", "#s1 p");
    expect(await sectionContent(page)).toEqual(["h2", "p"]);
    expect((await topLevel(page)).filter((t) => t === "cabeçalho")).toHaveLength(1);
    expect(
      await page.evaluate(() => (window as unknown as EditorWindow).ed.getWrapper()?.find("#s1 header").length),
    ).toBe(0);

    // Popup de saída: começa escondido na página, o cabeçalho fica onde soltou (como a barra fixa).
    await dragBlock(page, "cabecalho-loja", '[data-os-widget="exit-popup"] p');
    const inPopup = await page.evaluate(
      () =>
        (window as unknown as EditorWindow).ed
          .getWrapper()
          ?.find(`[data-os-widget="exit-popup"] [data-os-widget="store-header"]`).length,
    );
    expect(inPopup).toBe(1);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it("soltar na metade de baixo de uma seção alta: entra antes dela (como ao colar), a linha mostra isso e o canvas rola até ele", async () => {
    const page = await openEditor(browser);
    await sizeCanvas(page);
    await userPage(page);
    // A Seção com uma vitrine de 8 produtos (mais alta que a tela) e o rodapé depois.
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const content = ed.getWrapper()?.find("#s1")[0]?.components().at(0);
      content?.components().reset();
      content?.append(ed.Blocks.get("grade-produtos")?.get("content") as never);
      const [footer] = ed.getWrapper()?.append(ed.Blocks.get("rodape")?.get("content") as never) ?? [];
      footer?.addAttributes({ id: "pe" });
    });
    await page.waitForTimeout(300);
    const tall = await page.evaluate(() => {
      const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
      return (doc.querySelector("#s1") as HTMLElement).getBoundingClientRect().height > 1000;
    });
    expect(tall).toBe(true);
    const r = await dropHeaderOn(page, "#s1 [data-os-product]:last-of-type", 0.6, "#s1");
    // A linha de soltar estava no topo da Seção (não no fim dela, lá embaixo).
    expect(r.line.shown).toBe(true);
    expect(Math.abs(r.line.top - r.line.elTop)).toBeLessThanOrEqual(4);
    expect(Math.abs(r.line.top - r.line.elBottom)).toBeGreaterThan(500);
    expect(await topLevel(page)).toEqual(["barra", "cabeçalho", "s1", "pe"]);
    expect(await sectionContent(page)).toEqual(["section"]);
    // Ficou lá em cima, fora da tela: o canvas rola até ele.
    expect(r.inView).toBe(true);
    // Um passo só no Desfazer.
    await undo(page);
    expect(await topLevel(page)).toEqual(["barra", "s1", "pe"]);
    expect(pageErrors(page)).toEqual([]);
    await page.close();

    // Página clonada com um div raiz que guarda o site inteiro: entra no topo da página (antes do
    // div), nunca no fim, depois do rodapé.
    const site = await openEditor(browser);
    await sizeCanvas(site);
    await site.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.Css.addRules("body{margin:0}section{height:600px}");
      ed.getWrapper()?.append(
        '<div id="site"><nav id="menu">Menu</nav><section id="a">A</section><section id="b">B</section><section id="c">C</section><footer id="rodape">Rodapé</footer></div>' as never,
      );
    });
    await site.waitForTimeout(300);
    const s = await dropHeaderOn(site, "#c", 0.7, "#site");
    expect(Math.abs(s.line.top - s.line.elTop)).toBeLessThanOrEqual(4);
    expect(await topLevel(site)).toEqual(["cabeçalho", "site"]);
    expect(s.inView).toBe(true);
    expect(pageErrors(site)).toEqual([]);
    await site.close();
  });

  it("mover um cabeçalho que já está na página (barra do elemento, Camadas): só vale o nível de cima ou um bloco escondido", async () => {
    const page = await openEditor(browser);
    await userPage(page);
    await addBlock(page, "cabecalho-loja");
    await addBlock(page, "popup-saida");
    const can = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const w = ed.getWrapper();
      const header = w?.find('[data-os-widget="store-header"]')[0];
      const content = w?.find("#s1")[0]?.components().at(0);
      const popupBox = w?.find('[data-os-widget="exit-popup"]')[0]?.components().at(0);
      if (!w || !header || !content || !popupBox) throw new Error("página incompleta");
      const check = () => ({
        section: ed.Components.canMove(content, header).result,
        top: ed.Components.canMove(w, header).result,
        popup: ed.Components.canMove(popupBox, header).result,
      });
      ed.trigger("sorter:drag:start");
      const dragging = check();
      ed.trigger("sorter:drag:end");
      return { dragging, after: check() };
    });
    expect(can.dragging).toEqual({ section: false, top: true, popup: true });
    // Fora de um arraste (colar, código) entra: o que cair num contêiner volta para o nível de cima.
    expect(can.after).toEqual({ section: true, top: true, popup: true });
    await page.close();
  });

  it("clicar no bloco com algo da Seção selecionado: entra no topo, logo depois da Contagem no topo", async () => {
    const page = await openEditor(browser);
    await userPage(page);
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.select(ed.getWrapper()?.find("#s1 p")[0]);
    });
    await page.locator("#blocks .gjs-block", { hasText: "Cabeçalho de loja" }).first().click();
    expect(await topLevel(page)).toEqual(["barra", "cabeçalho", "s1"]);
    expect(await sectionContent(page)).toEqual(["h2", "p"]);
    const selected = await page.evaluate(
      () => (window as unknown as EditorWindow).ed.getSelected()?.getAttributes()["data-os-widget"],
    );
    expect(selected).toBe("store-header");
    // Outro clique: depois do primeiro (as barras do topo ficam juntas).
    await page.locator("#blocks .gjs-block", { hasText: "Cabeçalho de loja" }).first().click();
    expect(await topLevel(page)).toEqual(["barra", "cabeçalho", "cabeçalho", "s1"]);
    await page.close();

    // Página sem barra: o primeiro elemento da página.
    const blank = await openEditor(browser);
    await addBlock(blank, "secao");
    await blank.locator("#blocks .gjs-block", { hasText: "Cabeçalho de loja" }).first().click();
    expect((await topLevel(blank))[0]).toBe("cabeçalho");
    expect(pageErrors(blank)).toEqual([]);
    await blank.close();
  });

  it("colado com algo da Seção selecionado: vai para antes da Seção; um Desfazer tira, o Refazer põe no mesmo lugar", async () => {
    const page = await openEditor(browser);
    await userPage(page);
    await page.locator("#blocks .gjs-block", { hasText: "Cabeçalho de loja" }).first().click();
    // Último grupo do Desfazer (a pilha guarda os últimos 150 passos: contar os grupos não
    // serve quando ela enche e os mais antigos saem).
    const lastStep = () =>
      page.evaluate(() => {
        // (uma coleção do Backbone: .at(), não [i])
        const stack = (window as unknown as EditorWindow).ed.UndoManager.getStack() as unknown as {
          length: number;
          at(i: number): { get(k: string): unknown } | undefined;
        };
        return Number(stack.at(stack.length - 1)?.get("magicFusionIndex") ?? -1);
      });
    const before = await lastStep();
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.select(ed.getWrapper()?.find(`[data-os-widget="store-header"]`)[0]);
      ed.runCommand("core:copy");
      ed.select(ed.getWrapper()?.find("#s1 p")[0]);
      ed.runCommand("core:paste");
    });
    expect(await topLevel(page)).toEqual(["barra", "cabeçalho", "cabeçalho", "s1"]);
    expect(await sectionContent(page)).toEqual(["h2", "p"]);
    // Colar + levar para o nível de cima: um passo só.
    expect(await lastStep()).toBe(before + 1);
    await undo(page);
    expect(await topLevel(page)).toEqual(["barra", "cabeçalho", "s1"]);
    expect(await sectionContent(page)).toEqual(["h2", "p"]);
    await redo(page);
    await page.waitForTimeout(50);
    expect(await topLevel(page)).toEqual(["barra", "cabeçalho", "cabeçalho", "s1"]);
    expect(await sectionContent(page)).toEqual(["h2", "p"]);

    // Duplicar um cabeçalho do nível de cima: a cópia fica logo depois, no nível de cima.
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.select(ed.getWrapper()?.find(`[data-os-widget="store-header"]`)[0]);
      ed.runCommand("tlb-clone");
    });
    expect(await topLevel(page)).toEqual(["barra", "cabeçalho", "cabeçalho", "cabeçalho", "s1"]);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it("posto por código num contêiner (ou dentro de uma seção nova): volta para antes do elemento de cima", async () => {
    const page = await openEditor(browser);
    await userPage(page);
    await appendHeaderToSection(page);
    expect(await topLevel(page)).toEqual(["barra", "cabeçalho", "s1"]);
    expect(await sectionContent(page)).toEqual(["h2", "p"]);
    // Seção nova com o cabeçalho lá no fundo: ele sai, a seção fica.
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.getWrapper()?.append({
        tagName: "section",
        attributes: { id: "s2" },
        components: [{ tagName: "div", components: [ed.Blocks.get("cabecalho-loja")?.get("content")] }],
      } as never);
    });
    expect(await topLevel(page)).toEqual(["barra", "cabeçalho", "s1", "cabeçalho", "s2"]);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it("dentro de um bloco que começa escondido fica onde está (popup, atraso, [hidden]); com atraso 0, volta", async () => {
    const page = await openEditor(browser);
    await userPage(page);
    await addBlock(page, "popup-saida");
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const w = ed.getWrapper();
      const def = () => ed.Blocks.get("cabecalho-loja")?.get("content") as never;
      w?.find('[data-os-widget="exit-popup"]')[0]?.components().at(0).append(def());
      w?.append({ tagName: "div", attributes: { id: "atraso", "data-os-delay": "5" }, components: [def()] } as never);
      w?.append({
        tagName: "div",
        attributes: { id: "oculto", hidden: true },
        components: [{ components: [def()] }],
      } as never);
      w?.append({ tagName: "div", attributes: { id: "zero", "data-os-delay": "0" }, components: [def()] } as never);
    });
    expect(await topLevel(page)).toEqual(["barra", "s1", "popup", "atraso", "oculto", "cabeçalho", "zero"]);
    const nested = await page.evaluate(() => {
      const w = (window as unknown as EditorWindow).ed.getWrapper();
      return ['[data-os-widget="exit-popup"]', "#atraso", "#oculto", "#zero"].map(
        (sel) => w?.find(`${sel} [data-os-widget="store-header"]`).length,
      );
    });
    expect(nested).toEqual([1, 1, 1, 0]);
    await page.close();
  });

  it("página gravada com o cabeçalho dentro da Seção: o servidor acusa e o reparo ao abrir leva para o nível de cima", async () => {
    const page = await openEditor(browser);
    await userPage(page);
    await addBlock(page, "grade-produtos");
    // Projeto de antes da regra: gravado com o cabeçalho e a vitrine dentro da Seção.
    const project = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const w = ed.getWrapper();
      const content = w?.find("#s1")[0]?.components().at(0);
      content?.components().reset();
      content?.append(ed.Blocks.get("cabecalho-loja")?.get("content") as never);
      const shop = w?.find('[data-os-widget="products"]')[0];
      if (shop) content?.append(shop);
      // Antes da conferência do editor (microtask): como um projeto gravado antes.
      return ed.getProjectData();
    });
    await page.close();
    expect(nestedStoreHeader(project)).toBe(true);

    const again = await openEditor(browser, { project });
    // Abrir não mexe sozinho: o reparo é que leva (e o editor-app guarda a versão de antes).
    expect(await sectionContent(again)).toEqual(["cabeçalho", "section"]);
    const repaired = await again.evaluate(() => {
      const w = window as unknown as EditorWindow;
      return w.OS.applyLegacyRepair(w.ed, { noscriptCss: [], dupIds: {}, storeHeaders: true });
    });
    expect(repaired).toBe(true);
    expect(await topLevel(again)).toEqual(["barra", "cabeçalho", "s1"]);
    // A vitrine continua na Seção, como estava.
    expect(await sectionContent(again)).toEqual(["section"]);
    const $ = cheerio.load((await editorOutput(again)).html);
    expect($(HEADER).parent().is("body")).toBe(true);
    expect($(HEADER).next().attr("id")).toBe("s1");
    // Nada mais a reparar.
    expect(
      await again.evaluate(() => {
        const w = window as unknown as EditorWindow;
        return w.OS.applyLegacyRepair(w.ed, { noscriptCss: [], dupIds: {}, storeHeaders: true });
      }),
    ).toBe(false);
    expect(nestedStoreHeader(await again.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData()))).toBe(
      false,
    );
    await again.close();
  });

  it("regra do cabeçalho gravada antes ganha as declarações de lugar ao abrir (fora do Desfazer; o que a regra tem fica)", async () => {
    const page = await openEditor(browser);
    await addBlock(page, "cabecalho-loja");
    const project = await page.evaluate((place) => {
      const ed = (window as unknown as EditorWindow).ed;
      const rule = ed.Css.getRule(".os-store-header");
      if (!rule) throw new Error("sem a regra do cabeçalho");
      // Como a regra de antes: sem as declarações novas, com uma largura máxima escolhida no painel.
      const style = { ...(rule.getStyle() as Record<string, string>) };
      for (const prop of Object.keys(place)) {
        if (!["position", "display", "box-sizing", "width", "margin", "padding"].includes(prop)) delete style[prop];
      }
      rule.setStyle({ ...style, "max-width": "900px" });
      // As caixas de dentro como eram: sem as declarações de lugar, sem a regra da linha
      // principal e sem a dos pseudo-elementos.
      const old: Record<string, Record<string, string>> = {
        ".os-store-header .os-sh-in": {
          display: "flex",
          "align-items": "center",
          "max-width": "1200px",
          margin: "0 auto",
          padding: "10px 16px",
        },
        ".os-store-header .os-sh-strip": { display: "block", margin: "0", padding: "7px 16px" },
        ".os-store-header .os-sh-loc": { display: "flex", margin: "0 20px 0 0" },
      };
      for (const [sel, st] of Object.entries(old)) ed.Css.getRule(sel)?.setStyle(st);
      const gone = ed.Css.getRules().filter((r) => {
        const css = r.toCSS();
        return css.includes(".os-sh-main{") || /::before,\s*header\.os-store-header::after/.test(css);
      });
      if (gone.length !== 2) throw new Error(`regras novas: ${gone.length}`);
      for (const r of gone) ed.Css.remove(r);
      return ed.getProjectData();
    }, SH_PLACE);
    await page.close();
    const again = await openEditor(browser, { project });
    const after = await again.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const css = ed.getCss() ?? "";
      return {
        main: ed.Css.getRule(".os-store-header")?.getStyle() as Record<string, string>,
        inner: ed.Css.getRule(".os-store-header .os-sh-in")?.getStyle() as Record<string, string>,
        strip: ed.Css.getRule(".os-store-header .os-sh-strip")?.getStyle() as Record<string, string>,
        loc: ed.Css.getRule(".os-store-header .os-sh-loc")?.getStyle() as Record<string, string>,
        row: /\.os-store-header \.os-sh-main\{[^}]*display:block/.test(css),
        pseudo: /header\.os-store-header::before,\s*header\.os-store-header::after[^{]*\{content:none/.test(css),
        undo: ed.UndoManager.hasUndo(),
      };
    });
    expect(after.inner).toMatchObject({
      "max-width": "1200px",
      position: "static",
      width: "auto",
      "justify-content": "flex-start",
    });
    expect(after.strip).toMatchObject({ "max-width": "none", position: "static", height: "auto" });
    expect(after.loc).toMatchObject({ padding: "0" });
    // Regras novas do tipo, que o projeto não tinha, entram ao abrir.
    expect(after.row).toBe(true);
    expect(after.pseudo).toBe(true);
    expect(after.main).toMatchObject({
      position: "relative",
      top: "auto",
      float: "none",
      "min-width": "0",
      height: "auto",
      "max-height": "none",
      transform: "none",
      "max-width": "900px",
    });
    // margin:0 já estava (como margin-top…): não volta como atalho.
    expect(after.main.margin).toBeUndefined();
    expect(after.undo).toBe(false);
    await again.close();
  });
});

describe("no canvas: largura toda", () => {
  it("computador, tablet e celular — também com CSS de página clonada para <header> e <nav>", async () => {
    const page = await openEditor(browser);
    await sizeCanvas(page);
    await userPage(page);
    await appendHeaderToSection(page);
    await page.evaluate((css) => {
      const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
      const style = doc.createElement("style");
      style.textContent = css;
      doc.head.appendChild(style);
    }, CLONE_CSS);
    for (const device of ["desktop", "tablet", "mobile"]) {
      await page.evaluate((d) => {
        (window as unknown as EditorWindow).ed.setDevice(d);
      }, device);
      await page.waitForTimeout(500);
      const m = await page.evaluate(() => {
        const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
        const h = doc.querySelector('[data-os-widget="store-header"]') as HTMLElement;
        const nav = h.querySelector(".os-sh-cats") as HTMLElement;
        const r = h.getBoundingClientRect();
        const n = nav.getBoundingClientRect();
        const view = doc.defaultView as Window;
        return {
          left: Math.round(r.left),
          width: Math.round(r.width),
          page: doc.documentElement.clientWidth,
          height: Math.round(r.height),
          position: view.getComputedStyle(h).position,
          transform: view.getComputedStyle(h).transform,
          navInside: n.top >= r.top - 1 && n.bottom <= r.bottom + 1 && Math.round(n.width) === Math.round(r.width),
        };
      });
      expect(m.left, device).toBe(0);
      expect(m.width, device).toBe(m.page);
      expect(m.height, device).toBeGreaterThan(100);
      expect(m.position, device).toBe("relative");
      expect(m.transform, device).toBe("none");
      expect(m.navInside, device).toBe(true);
      const use = (await page.evaluate(`(${usableHeader})(window.ed.Canvas.getDocument())`)) as Usable;
      expect(use, device).toMatchObject({ searchHit: true, catHit: true, visible: true, stripFull: true });
      expect(use.catsGap, device).toBeLessThan(40);
      if (device === "desktop") expect(use.searchWidth).toBeGreaterThan(600);
    }
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });
});

// ─── Página publicada ────────────────────────────────────────────────────────

describe("na página publicada", () => {
  /** Página exportada com o cabeçalho no nível de cima (barra, cabeçalho, seção com a vitrine, popup). */
  let html = "";
  beforeAll(async () => {
    const page = await openEditor(browser);
    await userPage(page);
    await page.locator("#blocks .gjs-block", { hasText: "Cabeçalho de loja" }).first().click();
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const content = ed.getWrapper()?.find("#s1")[0]?.components().at(0);
      content?.components().reset();
      content?.append(ed.Blocks.get("grade-produtos")?.get("content") as never);
    });
    await addBlock(page, "popup-saida");
    expect(await topLevel(page)).toEqual(["barra", "cabeçalho", "s1", "popup"]);
    const { css } = await editorOutput(page);
    // As declarações de lugar vão para a página (regra do tipo, fora de camada).
    expect(css).toMatch(/\.os-store-header\{[^}]*max-width:none/);
    html = await exportPage(page);
    await page.close();
  }, 60_000);

  /** O HTML gravado antes da regra: o cabeçalho dentro da seção (ou de outro lugar). */
  function moved(into: string, sticky = false) {
    const $ = cheerio.load(html);
    const header = $(HEADER).first();
    if (sticky) header.attr("data-os-sticky", "1");
    $(into).first().prepend(header);
    return $.html();
  }

  const measure = (page: Page) =>
    page.evaluate(() => {
      const h = document.querySelector('[data-os-widget="store-header"]') as HTMLElement;
      const bar = document.querySelector('[data-os-widget="countdown"]') as HTMLElement;
      const r = h.getBoundingClientRect();
      return {
        left: Math.round(r.left),
        width: Math.round(r.width),
        top: Math.round(r.top),
        barBottom: Math.round(bar.getBoundingClientRect().bottom),
        vw: document.documentElement.clientWidth,
        parent: h.parentElement?.tagName,
        next: h.nextElementSibling?.id ?? h.nextElementSibling?.className ?? "",
        position: getComputedStyle(h).position,
        transform: getComputedStyle(h).transform,
        height: Math.round(r.height),
        navStatic: getComputedStyle(h.querySelector(".os-sh-cats") as Element).position,
        scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

  it("cabeçalho dentro da Seção (página ainda não reaberta): o script leva para o nível de cima, largura toda em 1280 e 390", async () => {
    const nested = moved("#s1 > div");
    expect(cheerio.load(nested)(`#s1 ${HEADER}`).length).toBe(1);
    for (const width of [1280, 390]) {
      const site = await openSite(browser, nested, { contextOptions: { viewport: { width, height: 800 } } });
      const m = await measure(site.page);
      expect(m, String(width)).toMatchObject({ left: 0, width: m.vw, parent: "BODY", next: "s1", scroll: 0 });
      // Logo abaixo da barra presa no topo (sem o espaço de cima da seção).
      expect(Math.abs(m.top - m.barBottom), String(width)).toBeLessThanOrEqual(1);
      // A busca continua: a linha de resultados vem logo depois do cabeçalho.
      await site.page.fill(".os-sh-q", "fone");
      await site.page.press(".os-sh-q", "Enter");
      const after = await site.page.evaluate(
        () => document.querySelector('[data-os-widget="store-header"]')?.nextElementSibling?.className,
      );
      expect(after).toBe("os-sh-res");
      await site.context.close();
    }
  });

  it("“Fixo no topo” dentro da Seção: preso logo abaixo da barra, na largura toda", async () => {
    const site = await openSite(browser, moved("#s1 > div", true), {
      contextOptions: { viewport: { width: 390, height: 800 } },
    });
    await site.page.evaluate(() => window.scrollTo(0, 900));
    await site.page.waitForTimeout(100);
    const m = await measure(site.page);
    expect(m).toMatchObject({ left: 0, width: m.vw, position: "fixed", parent: "BODY" });
    expect(Math.abs(m.top - m.barBottom)).toBeLessThanOrEqual(1);
    await site.context.close();
  });

  it("dentro do popup de saída (começa escondido) fica no lugar", async () => {
    const site = await openSite(browser, moved('[data-os-widget="exit-popup"] > div'));
    const inPopup = await site.page.evaluate(
      () => !!document.querySelector('[data-os-widget="exit-popup"] .os-store-header'),
    );
    expect(inPopup).toBe(true);
    await site.context.close();
  });

  it("CSS de página clonada para <header>, <nav> e os <div> de dentro (camada os-original): não estreita, não esconde nem cobre; “Fixo no topo” continua", async () => {
    const withClone = (h: string) => h.replace("</head>", `<style>${CLONE_CSS}</style></head>`);
    for (const width of [1280, 390]) {
      const site = await openSite(browser, withClone(html), { contextOptions: { viewport: { width, height: 800 } } });
      const m = await measure(site.page);
      expect(m, String(width)).toMatchObject({
        left: 0,
        width: m.vw,
        position: "relative",
        transform: "none",
        navStatic: "static",
        scroll: 0,
      });
      expect(Math.abs(m.top - m.barBottom), String(width)).toBeLessThanOrEqual(1);
      expect(m.height, String(width)).toBeGreaterThan(100);
      // Camada escura em header::before, menu do celular escondido, header > div em flex.
      const use = (await site.page.evaluate(`(${usableHeader})(document)`)) as Usable;
      expect(use, String(width)).toMatchObject({ searchHit: true, catHit: true, visible: true, stripFull: true });
      expect(use.catsGap, String(width)).toBeLessThan(40);
      if (width === 1280) expect(use.searchWidth).toBeGreaterThan(600);
      // A categoria sem destino continua buscando (o clique chega nela).
      await site.page.locator(".os-sh-cat", { hasText: "Fones" }).click();
      expect(await site.page.evaluate(() => document.querySelector(".os-sh-res")?.textContent ?? "")).toMatch(/Fones/);
      await site.context.close();
    }
    const $ = cheerio.load(html);
    $(HEADER).attr("data-os-sticky", "1");
    const site = await openSite(browser, withClone($.html()), {
      contextOptions: { viewport: { width: 390, height: 800 } },
    });
    await site.page.evaluate(() => window.scrollTo(0, 900));
    await site.page.waitForTimeout(100);
    const m = await measure(site.page);
    expect(m).toMatchObject({ left: 0, width: m.vw, position: "fixed" });
    expect(Math.abs(m.top - m.barBottom)).toBeLessThanOrEqual(1);
    await site.context.close();
  });
});

// ─── Servidor e editor de verdade ────────────────────────────────────────────

/** Projeto do GrapesJS com o cabeçalho dentro de `hosts` (do de fora para o de dentro). */
function projectWith(hosts: Record<string, unknown>[]) {
  let node: Record<string, unknown> = {
    type: "os-store-header",
    tagName: "header",
    classes: ["os-store-header"],
    attributes: { "data-os-widget": "store-header" },
  };
  for (const attributes of [...hosts].reverse()) node = { tagName: "div", attributes, components: [node] };
  return { styles: [], pages: [{ frames: [{ component: { type: "wrapper", components: [node] } }] }] };
}

describe("o servidor manda o reparo (nestedStoreHeader / getEditorPayload)", () => {
  it("contêiner comum: sim; nível de cima ou dentro de um bloco que começa escondido: não", () => {
    expect(nestedStoreHeader(projectWith([]))).toBe(false);
    expect(nestedStoreHeader(projectWith([{ id: "secao" }]))).toBe(true);
    expect(nestedStoreHeader(projectWith([{ id: "a" }, { class: "conteudo" }]))).toBe(true);
    expect(nestedStoreHeader(projectWith([{ "data-os-widget": "exit-popup", hidden: true }, {}]))).toBe(false);
    expect(nestedStoreHeader(projectWith([{ "data-os-delay": "5" }]))).toBe(false);
    expect(nestedStoreHeader(projectWith([{ "data-os-delay": "0" }]))).toBe(true);
    expect(nestedStoreHeader(projectWith([{ "data-os-qz-step": "question" }, {}]))).toBe(false);
    expect(nestedStoreHeader(projectWith([{ "data-os-premio": "ganhou" }]))).toBe(false);
    expect(nestedStoreHeader(projectWith([{ hidden: true }]))).toBe(false);
    expect(nestedStoreHeader(null)).toBe(false);
  });

  const touched = new Set<string>();
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await removeVersionFiles(touched);
  });

  it("projeto gravado (mesmo pelo editor de agora) com o cabeçalho num contêiner: repair.storeHeaders", async () => {
    const offer = await createOffer({ name: "Loja" });
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { page: { offerId: offer.id } } } });
    touched.add(doc.id);
    const save = async (project: unknown) => {
      const { revision } = await prisma.pageDocument.findUniqueOrThrow({ where: { id: doc.id } });
      await saveEditorDocument({ documentId: doc.id, revision, project, html: "<p>x</p>", css: "" });
    };
    await save(projectWith([{ id: "secao" }]));
    expect((await getEditorPayload(doc.id)).repair).toEqual({ noscriptCss: [], dupIds: {}, storeHeaders: true });
    await save(projectWith([]));
    expect((await getEditorPayload(doc.id)).repair).toBeNull();
    await save(projectWith([{ "data-os-widget": "exit-popup", hidden: true }]));
    expect((await getEditorPayload(doc.id)).repair).toBeNull();
  });
});

describe("editor de verdade (editor-app)", () => {
  it("abre a página do usuário com o cabeçalho na Seção: guarda “Antes do reparo automático” e grava com ele no nível de cima", async () => {
    // O projeto como ficou gravado: barra, Seção com o cabeçalho e a vitrine dentro.
    const page = await openEditor(browser);
    await userPage(page);
    const project = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const content = ed.getWrapper()?.find("#s1")[0]?.components().at(0);
      content?.components().reset();
      content?.append(ed.Blocks.get("cabecalho-loja")?.get("content") as never);
      content?.append(ed.Blocks.get("grade-produtos")?.get("content") as never);
      return ed.getProjectData();
    });
    await page.close();

    const id = "doclojacabecalho00000001";
    const server = new FakeServer();
    server.add(
      makePayload({
        documentId: id,
        project,
        html: null,
        repair: { noscriptCss: [], dupIds: {}, storeHeaders: true },
      }),
    );
    const s = await openApp(browser, server, id);
    await waitFor(() => server.okPuts.length === 1, 10_000, "gravação do reparo");
    expect(server.log.filter((e) => e.kind === "version" || e.kind === "put").map((e) => e.kind)).toEqual([
      "version",
      "put",
    ]);
    expect(server.log.find((e) => e.kind === "version")).toEqual({
      kind: "version",
      label: "Antes do reparo automático",
      openAsIs: true,
    });
    const $ = cheerio.load(server.okPuts[0].html);
    expect($(HEADER).parent().is("body")).toBe(true);
    expect($(HEADER).next().attr("id")).toBe("s1");
    expect($('#s1 [data-os-widget="products"]').length).toBe(1);
    // O reparo não entra no Desfazer; o canvas mostra o cabeçalho na largura toda.
    expect(await withEditor<boolean>(s.page, `(ed) => ed.UndoManager.hasUndo()`)).toBe(false);
    const width = await withEditor<{ header: number; page: number }>(
      s.page,
      `(ed) => { const d = ed.Canvas.getDocument(); return { header: Math.round(d.querySelector('[data-os-widget="store-header"]').getBoundingClientRect().width), page: d.documentElement.clientWidth }; }`,
    );
    expect(width.header).toBe(width.page);
    await sleep(1500);
    expect(server.okPuts).toHaveLength(1);
    expect(s.errors).toEqual([]);
    await s.page.close();
  }, 120_000);
});
