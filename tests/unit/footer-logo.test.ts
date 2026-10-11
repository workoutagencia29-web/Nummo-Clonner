/**
 * Logo no rodapé (tipo "Rodapé", src/editor/widgets/footer.ts), num Chromium
 * de verdade:
 *
 * - reconhecimento: o rodapé dos modelos (de agora e de antes), o do bloco
 *   "Rodapé com políticas" (de agora e o gravado antes, pelo ano do copyright)
 *   e o projeto salvo antes do tipo viram "Rodapé"; o <footer> de página
 *   clonada, não (nem com o bloco posto dentro dele);
 * - "Mostrar logo" acompanha quando outro campo liga o logo; "Trocar logo"
 *   com o logo desligado só liga quando a imagem é escolhida (Cancelar não
 *   muda nada); o rodapé mantém a "Âncora (para links #)" e a dica;
 * - "Mostrar logo" (põe o logo provisório no começo do conteúdo, um passo de
 *   Desfazer; desligar esconde), o clique no logo seleciona a imagem com
 *   "Trocar logo" (no logo e no rodapé), "Usar o mesmo logo do cabeçalho",
 *   lugar no computador e no celular, "Altura do logo" (com a proporção da
 *   imagem), para onde o logo leva e a nota do rodapé escuro;
 * - a página publicada, sem script: as 3 posições em 1280, 390 e 360 px, sem
 *   rolagem lateral, logo largo sem faixa vazia, logo desligado escondido;
 * - no editor completo (editor-app.tsx), com o mouse de verdade: o rodapé
 *   abre nas Configurações com "Mostrar logo", o clique no logo traz o
 *   "Trocar logo" e o arquivo enviado vira o logo (e é salvo).
 */
import * as cheerio from "cheerio";
import { type Browser, chromium, type Page, type Route } from "playwright";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storeHtml } from "@/editor/templates/store";
import { footer as templateFooter } from "@/editor/templates/widgets";
import { FOOTER_TYPE, retypeFooters } from "@/editor/widgets/footer-content";
import { prepareForEditor } from "@/lib/editor-html";
import { templateHtml } from "@/server/services/page-templates";
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
import { appBundle, FakeServer, makePayload, openApp, type Session, waitFor, withEditor } from "./fix3-E1-harness";
import { fakeId } from "./helpers";

const FOOTER = "footer";
const LOGO = "img.os-ft-logo-img";
const STORE_PAGE = fakeId("loja");
const PAGES = [
  { id: STORE_PAGE, name: "Loja" },
  { id: fakeId("obrigado"), name: "Obrigado" },
];

/** <footer> de um site clonado (nada do Offer Studio). */
const CLONE_FOOTER = `<footer class="site-footer"><div class="container"><p>© 2024 Outra empresa</p></div></footer>`;
/** Outro site com a mesma classe por acaso, sem a .os-container dos modelos. */
const CLONE_OS_FOOTER = `<footer class="os-footer"><div class="wrap"><p>Rodapé de outro site</p></div></footer>`;
/** Rodapé do bloco "Rodapé com políticas" gravado antes do tipo (sem data-os-ft-logo). */
const OLD_BLOCK_FOOTER = `<footer id="rodape-antigo"><div id="rodape-antigo-in"><nav id="rodape-links"><a href="#">Termos de uso</a><a href="#">Política de privacidade</a></nav><p id="rodape-copy">© <span data-os-year="">2025</span> Nome da sua empresa. Todos os direitos reservados.</p></div></footer>`;
/** Rodapé dos modelos gravado antes do tipo. */
const OLD_TEMPLATE_FOOTER = templateFooter({ links: true }).replace(' data-os-ft-logo="0"', "");

let browser: Browser;
/** Logo de exemplo (600 × 140, sem marca nenhuma). */
let logo = "";
beforeAll(async () => {
  browser = await chromium.launch();
  logo = await pngLogo(600, 140);
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** Logo de exemplo (PNG, só retângulos) com este tamanho, como data URI. */
async function pngLogo(width: number, height: number, fill = "#1d4ed8") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${Math.round(height / 6)}" fill="${fill}"/><rect x="${Math.round(height * 0.2)}" y="${Math.round(height * 0.2)}" width="${Math.round(width * 0.6)}" height="${Math.round(height * 0.6)}" fill="#ffffff"/></svg>`;
  return `data:image/png;base64,${(await sharp(Buffer.from(svg)).png().toBuffer()).toString("base64")}`;
}

/** O harness não carrega o CSS do GrapesJS (o canvas ficaria com 300 × 150 px): largura do canvas. */
async function sizeCanvas(page: Page, width: number) {
  await page.evaluate((w) => {
    const frame = (window as unknown as EditorWindow).ed.Canvas.getFrameEl();
    frame.style.cssText = `display:block;width:${w}px;height:760px;border:0`;
  }, width);
  await page.waitForTimeout(200);
}

/**
 * Abre o HTML de uma página (modelo, página gravada) no editor do harness. O
 * CSS da página vai para o canvas em @layer os-original, como a folha base do
 * editor completo (o harness não a monta).
 */
async function openHtml(html: string) {
  const page = await openEditor(browser, { pages: PAGES });
  const prepared = prepareForEditor(html);
  const css = prepared.styles.map((s) => (s.kind === "inline" ? s.text : "")).join("\n");
  await page.evaluate(
    ([h, base]) => {
      const w = window as unknown as EditorWindow;
      w.OS.importPageHtml(w.ed, h);
      w.ed.UndoManager.clear();
      const doc = w.ed.Canvas.getDocument() as Document;
      const style = doc.createElement("style");
      style.textContent = `@layer os-original{${base}}`;
      doc.head.prepend(style);
    },
    [prepared.html, css] as const,
  );
  await sizeCanvas(page, 1200);
  return page;
}

/** Clique no canvas como o GrapesJS o repassa (seleção com o evento do clique). */
const clickSelect = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const e = (window as unknown as EditorWindow).ed;
    const c = e.getWrapper()?.find(sel)[0];
    if (!c) throw new Error(`nada com ${sel}`);
    e.select(c, { event: new MouseEvent("click", { detail: 1 }) } as never);
    return { type: e.getSelected()?.get("type"), cls: e.getSelected()?.getClasses().join(" ") };
  }, selector);

const selectFirst = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const e = (window as unknown as EditorWindow).ed;
    e.select(e.getWrapper()?.find(sel)[0]);
  }, selector);

const selectedTraits = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as EditorWindow).ed
      .getSelected()
      ?.getTraits()
      .map((t) => String(t.get("name"))),
  );

const undo = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as EditorWindow).ed.UndoManager.undo();
  });
const redo = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as EditorWindow).ed.UndoManager.redo();
  });
const undoSteps = (page: Page) =>
  page.evaluate(() => (window as unknown as EditorWindow).ed.UndoManager.getStackGroup().length);
/** Uma ação da pessoa por vez (cada uma num passo do Desfazer). */
const settle = (page: Page) => page.waitForTimeout(30);

const amOpen = (page: Page) => page.evaluate(() => (window as unknown as EditorWindow).ed.AssetManager.isOpen());

/** Escolhe a imagem no gerenciador aberto (clique nela, como a pessoa faz) e fecha. */
async function pick(page: Page, src: string) {
  await page.evaluate((s) => {
    const am = (window as unknown as EditorWindow).ed.AssetManager;
    am.add({ type: "image", src: s, name: "logo.png" });
    const asset = am.get(s) as unknown as { view?: { el?: HTMLElement } } | null;
    asset?.view?.el?.click();
    am.close();
  }, src);
  await page.waitForTimeout(150);
}

/** Estilo próprio do rodapé (altura e proporção do logo). */
const footerStyle = (page: Page) =>
  page.evaluate(() => {
    const e = (window as unknown as EditorWindow).ed;
    const f = e.getWrapper()?.find("footer")[0];
    const rule = f ? e.Css.getIdRule(f.getId(), { mediaText: "", state: "" } as never) : null;
    return (rule?.getStyle() ?? {}) as Record<string, string>;
  });

interface Box {
  l: number;
  r: number;
  t: number;
  b: number;
  w: number;
  h: number;
}

/** Medidas do logo, da linha de links e do conteúdo do rodapé (no canvas ou na página). */
function measure(doc: Document) {
  const rect = (el: Element | null): Box | null => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height };
  };
  const footer = doc.querySelector("footer");
  const box = footer?.querySelector("[data-os-ft-box]") ?? null;
  const img = footer?.querySelector("img.os-ft-logo-img") as HTMLImageElement | null;
  const view = doc.defaultView as Window;
  const pad = box ? Number.parseFloat(view.getComputedStyle(box).paddingLeft) : 0;
  const padR = box ? Number.parseFloat(view.getComputedStyle(box).paddingRight) : 0;
  const boxRect = rect(box);
  return {
    logo: rect(img),
    shown: !!img && view.getComputedStyle(img).display !== "none" && img.getBoundingClientRect().height > 0,
    natural: img ? [img.naturalWidth, img.naturalHeight] : null,
    links: rect(footer?.querySelector("nav, .os-footer-links") ?? null),
    // Área do conteúdo (sem o padding da caixa, como a .os-container dos modelos).
    content: boxRect ? { ...boxRect, l: boxRect.l + pad, r: boxRect.r - padR } : null,
    // O que passa da largura da tela no rodapé (rolagem lateral por causa dele).
    scroll: footer
      ? Math.max(
          0,
          ...Array.from(footer.querySelectorAll("*"), (el) => el.getBoundingClientRect().right),
          footer.scrollWidth,
        ) - doc.documentElement.clientWidth
      : 0,
  };
}

const canvasMeasure = (page: Page) =>
  page.evaluate((fn) => {
    const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
    return new Function("doc", `return (${fn})(doc)`)(doc) as ReturnType<typeof measure>;
  }, measure.toString());

describe("rodapé reconhecido", () => {
  it("modelos (de agora e de antes), bloco e rodapé do bloco gravado antes viram “Rodapé”; o de página clonada, não", async () => {
    const page = await openHtml(
      `<!doctype html><html><head><title>T</title></head><body>${templateFooter({ links: true })}${OLD_TEMPLATE_FOOTER}${OLD_BLOCK_FOOTER}${CLONE_FOOTER}${CLONE_OS_FOOTER}<footer><p>© 2024</p></footer></body></html>`,
    );
    await addBlock(page, "rodape");
    const types = await page.evaluate(() =>
      (window as unknown as EditorWindow).ed
        .getWrapper()
        ?.find("footer")
        .map((f) => String(f.get("type"))),
    );
    // (O tipo comum do GrapesJS é "".)
    expect(types).toEqual([FOOTER_TYPE, FOOTER_TYPE, FOOTER_TYPE, "", "", "", FOOTER_TYPE]);
    // O bloco nasce com o logo desligado e sem o elemento do logo (o visual de sempre).
    const block = await page.evaluate(() => {
      const f = (window as unknown as EditorWindow).ed.getWrapper()?.find("footer").at(-1);
      return { attrs: f?.getAttributes(), logos: f?.find(".os-ft-logo").length, name: f?.getName() };
    });
    expect(block.attrs?.["data-os-ft-logo"]).toBe("0");
    expect(block.logos).toBe(0);
    expect(block.name).toBe("Rodapé");
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it("modelos novos nascem com o rodapé reconhecido e o logo desligado (o HTML do modelo não muda de visual)", () => {
    for (const id of ["vendas-longa", "captura", "loja", "produto", "obrigado"]) {
      const $ = cheerio.load(templateHtml(id, "Página", new Date("2026-01-10T12:00:00Z")));
      const footer = $("footer");
      expect(footer.length, id).toBe(1);
      expect(footer.attr("data-os-ft-logo"), id).toBe("0");
      expect(footer.find(".os-ft-logo").length, id).toBe(0);
      expect(footer.children().first().hasClass("os-container"), id).toBe(true);
    }
  });

  it("projeto salvo antes do tipo: os rodapés do Offer Studio voltam como “Rodapé” (o de página clonada continua comum)", async () => {
    const fresh = await openEditor(browser, { pages: PAGES });
    await addBlock(fresh, "rodape");
    await fresh.evaluate((clone) => {
      (window as unknown as EditorWindow).ed.getWrapper()?.append(clone);
    }, CLONE_FOOTER);
    const project = (await fresh.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData())) as Record<
      string,
      unknown
    >;
    await fresh.close();
    // Como era: o rodapé do bloco sem o tipo e sem o atributo do logo.
    let stripped = 0;
    const strip = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(strip);
      const def = node as Record<string, unknown>;
      if (def.type === FOOTER_TYPE) {
        delete def.type;
        def.tagName = "footer";
        delete (def.attributes as Record<string, unknown>)["data-os-ft-logo"];
        stripped++;
      }
      for (const value of Object.values(def)) strip(value);
    };
    strip(project.pages);
    expect(stripped).toBe(1);
    const copy = JSON.parse(JSON.stringify(project));
    // A função pura: só o rodapé do bloco ganha o tipo.
    const typed: string[] = [];
    const collect = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(collect);
      const def = node as Record<string, unknown>;
      if (String(def.tagName ?? "") === "footer") typed.push(String(def.type ?? "default"));
      for (const value of Object.values(def)) collect(value);
    };
    collect(retypeFooters(copy).pages);
    expect(typed).toEqual([FOOTER_TYPE, "default"]);

    const again = await openEditor(browser, { pages: PAGES, project });
    const reopened = await again.evaluate(() =>
      (window as unknown as EditorWindow).ed
        .getWrapper()
        ?.find("footer")
        .map((f) => ({ type: f.get("type"), traits: f.getTraits().length })),
    );
    expect(reopened?.[0].type).toBe(FOOTER_TYPE);
    expect(reopened?.[0].traits).toBeGreaterThan(5);
    expect(reopened?.[1].type).toBe("");
    // Ligar o logo num rodapé assim: entra no começo da caixa do conteúdo.
    await setTrait(again, FOOTER, "os-ft-logo-on", true);
    const html = await again.evaluate(() =>
      (window as unknown as EditorWindow).ed.getWrapper()?.find("footer")[0].toHTML(),
    );
    const $ = cheerio.load(html ?? "");
    expect($("footer").attr("data-os-ft-logo")).toBe("1");
    expect($("footer > div[data-os-ft-box] > a.os-ft-logo:first-child > img.os-ft-logo-img").length).toBe(1);
    expect(pageErrors(again)).toEqual([]);
    await again.close();
  });

  it("bloco “Rodapé com políticas” dentro do <footer> de página clonada: só o do bloco vira “Rodapé” (no HTML e no projeto salvo)", async () => {
    const clonedFooter = (inner: string, id = "") =>
      `<footer${id ? ` id="${id}"` : ""} data-elementor-type="footer"><section class="elementor-section"><div><p>© 2024 Outra empresa</p></div></section>${inner}</footer>`;
    const footerTypes = (page: Page) =>
      page.evaluate(() =>
        (window as unknown as EditorWindow).ed
          .getWrapper()
          ?.find("footer")
          .map((f) => String(f.get("type"))),
      );

    // Pelo HTML (página aberta, "Editar código"): o bloco gravado antes, com o ano, dentro do rodapé clonado.
    const html = await openHtml(
      `<!doctype html><html><head><title>T</title></head><body>${clonedFooter(OLD_BLOCK_FOOTER)}</body></html>`,
    );
    expect(await footerTypes(html)).toEqual(["", FOOTER_TYPE]);
    await html.close();

    // Pelo projeto salvo: o bloco de agora posto dentro do rodapé clonado (o clique-para-adicionar
    // põe o bloco depois da <section>, dentro dele) e o bloco gravado antes, sem o tipo.
    const fresh = await openEditor(browser, { pages: PAGES });
    await fresh.evaluate(
      ([first, second, old]) => {
        const e = (window as unknown as EditorWindow).ed;
        const wrapper = e.getWrapper();
        wrapper?.append(first);
        wrapper?.append(second);
        wrapper?.find("#clonado-1")[0].append(e.Blocks.get("rodape")?.get("content") as never);
        wrapper?.find("#clonado-2")[0].append(old);
      },
      [clonedFooter("", "clonado-1"), clonedFooter("", "clonado-2"), OLD_BLOCK_FOOTER] as const,
    );
    expect(await footerTypes(fresh)).toEqual(["", FOOTER_TYPE, "", FOOTER_TYPE]);
    const project = (await fresh.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData())) as Record<
      string,
      unknown
    >;
    await fresh.close();
    // O bloco gravado antes: sem o tipo (como era).
    const strip = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(strip);
      const def = node as Record<string, unknown>;
      const a = def.attributes as Record<string, unknown> | undefined;
      if (def.type === FOOTER_TYPE && a?.id === "rodape-antigo") {
        delete def.type;
        def.tagName = "footer";
      }
      for (const value of Object.values(def)) strip(value);
    };
    strip(project.pages);
    const again = await openEditor(browser, { pages: PAGES, project });
    expect(await footerTypes(again)).toEqual(["", FOOTER_TYPE, "", FOOTER_TYPE]);
    // O rodapé clonado continua com os campos de todo elemento (sem o grupo "Logo").
    await selectFirst(again, "footer");
    expect(await selectedTraits(again)).not.toContain("os-ft-logo-on");
    expect(pageErrors(again)).toEqual([]);
    await again.close();
  });
});

describe("logo do rodapé no editor", () => {
  let page: Page;
  beforeAll(async () => {
    // Página de vendas (rodapé escuro dos modelos).
    page = await openHtml(templateHtml("vendas-longa", "Vendas", new Date("2026-01-10T12:00:00Z")));
  }, 60_000);
  afterAll(() => page?.close());

  it("Configurações do rodapé: grupo “Logo” com “Mostrar logo”; ligar põe o logo provisório no começo do conteúdo, num passo de Desfazer; desligar esconde", async () => {
    await selectFirst(page, FOOTER);
    expect(await selectedTraits(page)).toEqual([
      "os-h-ft-logo",
      "os-ft-logo-on",
      "os-ft-logo-swap",
      "os-ft-logo-same",
      "os-ft-logo-dark",
      "os-ft-logo-pos",
      "os-ft-logo-pos-m",
      "os-ft-logo-h",
      "os-ft-logo-place-note",
      "os-ft-logo-dest",
      "os-ft-logo-note",
      "os-h-ft-outros",
      "title",
      "id",
    ]);
    const before = await editorOutput(page);
    expect(before.css).not.toContain("os-ft-logo");

    await setTrait(page, FOOTER, "os-ft-logo-on", true);
    await page.waitForTimeout(150);
    const $ = cheerio.load((await editorOutput(page)).html);
    expect($("footer").attr("data-os-ft-logo")).toBe("1");
    const box = $("footer > .os-container");
    expect(box.attr("data-os-ft-box")).toBe("");
    const link = box.children().first();
    expect(link.is("a.os-ft-logo")).toBe(true);
    // Sem destino: <a> sem href (não é link).
    expect(link.attr("href")).toBeUndefined();
    expect(link.find("img.os-ft-logo-img").attr("src")).toMatch(/^data:image\/svg\+xml/);
    expect(link.find("img.os-ft-logo-img").attr("alt")).toBe("Logo da empresa");
    expect((await editorOutput(page)).css).toContain(".os-ft-logo-img");

    // Canvas (computador): o logo no centro, em cima dos links.
    let m = await canvasMeasure(page);
    expect(m.shown).toBe(true);
    expect(m.logo?.h).toBeCloseTo(40, 0);
    expect(
      Math.abs((m.logo?.l ?? 0) + (m.logo?.w ?? 0) / 2 - ((m.content?.l ?? 0) + (m.content?.r ?? 0)) / 2),
    ).toBeLessThan(1.5);
    expect(m.logo?.b ?? 0).toBeLessThanOrEqual((m.links?.t ?? 0) + 0.5);

    // Um passo de Desfazer: sai o logo, o atributo e o CSS do logo; Refazer devolve.
    await settle(page);
    const steps = await undoSteps(page);
    await undo(page);
    expect(await undoSteps(page)).toBe(steps);
    let out = await editorOutput(page);
    expect(cheerio.load(out.html)("footer").attr("data-os-ft-logo")).toBe("0");
    expect(cheerio.load(out.html)(".os-ft-logo").length).toBe(0);
    expect(out.css).not.toContain("os-ft-logo");
    await redo(page);
    out = await editorOutput(page);
    expect(cheerio.load(out.html)(".os-ft-logo").length).toBe(1);
    expect(out.css).toContain(".os-ft-logo-img");

    // Desligar: o logo fica no lugar, escondido; ligar de novo não põe outro.
    await setTrait(page, FOOTER, "os-ft-logo-on", false);
    expect((await attrs(page, FOOTER))["data-os-ft-logo"]).toBe("0");
    m = await canvasMeasure(page);
    expect(m.shown).toBe(false);
    expect(
      await page.evaluate(() =>
        (window as unknown as EditorWindow).ed.getWrapper()?.find("footer")[0].getTrait("os-ft-logo-on")?.getValue(),
      ),
    ).toBe(false);
    await setTrait(page, FOOTER, "os-ft-logo-on", true);
    expect(cheerio.load((await editorOutput(page)).html)(".os-ft-logo").length).toBe(1);
    expect((await canvasMeasure(page)).shown).toBe(true);
    expect(pageErrors(page)).toEqual([]);
  });

  it("um clique no logo seleciona a imagem, com “Trocar logo” em destaque; “Trocar logo” (no logo e no rodapé) abre o gerenciador e a imagem vira o logo, na proporção dela", async () => {
    expect(await clickSelect(page, LOGO)).toMatchObject({ type: "os-ft-logo-img" });
    expect(await selectedTraits(page)).toEqual([
      "os-ft-logo-swap",
      "os-ft-logo-same",
      "os-ft-logo-tip",
      "os-ft-logo-dark",
      "os-ft-logo-alt",
      "os-h-ft-logo-lugar",
      "os-ft-logo-pos",
      "os-ft-logo-pos-m",
      "os-ft-logo-h",
      "os-ft-logo-place-note",
      "os-ft-logo-dest",
      "os-ft-logo-hide",
    ]);
    const swap = page.locator("#traits button.os-action-primary");
    expect(await swap.textContent()).toBe("Trocar logo");
    const sel = await page.evaluate(() => {
      const s = (window as unknown as EditorWindow).ed.getSelected();
      return {
        resizable: s?.get("resizable"),
        toolbar: (s?.get("toolbar") as { id?: string }[]).map((i) => i.id ?? ""),
      };
    });
    expect(sel.resizable).toBe(false);
    expect(sel.toolbar).toContain("os-swap-image");
    // O link em volta não é selecionável (o destino fica nas Configurações do logo e do rodapé).
    expect(
      await page.evaluate(() => {
        const e = (window as unknown as EditorWindow).ed;
        e.select(e.getWrapper()?.find("a.os-ft-logo")[0]);
        return e.getSelected()?.getClasses().join(" ");
      }),
    ).not.toBe("os-ft-logo");

    // Descrição da imagem: vazia volta ao padrão.
    await setTrait(page, LOGO, "os-ft-logo-alt", "Logo da Empresa Modelo");
    expect((await attrs(page, LOGO)).alt).toBe("Logo da Empresa Modelo");
    await setTrait(page, LOGO, "os-ft-logo-alt", "  ");
    expect((await attrs(page, LOGO)).alt).toBe("Logo da empresa");

    await selectFirst(page, LOGO);
    await page.locator("#traits button.os-action-primary").click();
    expect(await amOpen(page)).toBe(true);
    await pick(page, logo);
    await page.waitForTimeout(150);
    let m = await canvasMeasure(page);
    expect(m.natural).toEqual([600, 140]);
    expect(m.logo?.h).toBeCloseTo(40, 0);
    expect(m.logo?.w).toBeCloseTo((600 / 140) * 40, 0);
    // A proporção da imagem fica no estilo do rodapé (vai junto para a página).
    expect(Number.parseFloat((await footerStyle(page))["--os-ft-logo-r"])).toBeCloseTo(600 / 140, 3);

    // No rodapé, o mesmo botão.
    await selectFirst(page, FOOTER);
    const footerSwap = page.locator("#traits button.os-action-primary");
    expect(await footerSwap.textContent()).toBe("Trocar logo");
    await footerSwap.click();
    expect(await amOpen(page)).toBe(true);
    await page.evaluate(() => (window as unknown as EditorWindow).ed.AssetManager.close());
    m = await canvasMeasure(page);
    expect(m.logo?.h).toBeCloseTo(40, 0);
    expect(pageErrors(page)).toEqual([]);
  });

  it("rodapé escuro: a nota pede a versão clara do logo (no rodapé claro, não aparece)", async () => {
    await selectFirst(page, FOOTER);
    await page.waitForTimeout(100);
    const note = page.locator("#traits p", { hasText: "Este rodapé tem fundo escuro" });
    expect(await note.isVisible()).toBe(true);
    await selectFirst(page, LOGO);
    expect(await page.locator("#traits p", { hasText: "Este rodapé tem fundo escuro" }).isVisible()).toBe(true);

    const light = await openHtml(storeHtml);
    await selectFirst(light, FOOTER);
    await light.waitForTimeout(100);
    expect(await light.locator("#traits p", { hasText: "Este rodapé tem fundo escuro" }).count()).toBe(1);
    expect(await light.locator("#traits p", { hasText: "Este rodapé tem fundo escuro" }).isVisible()).toBe(false);
    await light.close();
  });

  it("posição no computador e no celular e altura: no rodapé e no logo, com Desfazer; valor que não serve avisa e não grava", async () => {
    // Pelo logo: grava no rodapé. Esquerda: logo de um lado, links do outro, na mesma altura.
    await setTrait(page, LOGO, "os-ft-logo-pos", "left");
    expect((await attrs(page, FOOTER))["data-os-ft-logo-pos"]).toBe("left");
    await page.waitForTimeout(100);
    let m = await canvasMeasure(page);
    expect(Math.abs((m.logo?.l ?? 0) - (m.content?.l ?? 0))).toBeLessThan(1.5);
    expect(m.logo?.r ?? 0).toBeLessThan(m.links?.l ?? 0);
    expect(Math.abs((m.logo?.t ?? 0) - (m.links?.t ?? 0))).toBeLessThan(2);
    await settle(page);
    await setTrait(page, FOOTER, "os-ft-logo-pos", "right");
    await page.waitForTimeout(100);
    m = await canvasMeasure(page);
    expect(Math.abs((m.logo?.r ?? 0) - (m.content?.r ?? 0))).toBeLessThan(1.5);
    expect(m.logo?.l ?? 0).toBeGreaterThan(m.links?.r ?? 0);
    // "Centro" (o padrão) tira o atributo; Desfazer volta "Direita".
    await settle(page);
    await setTrait(page, FOOTER, "os-ft-logo-pos", "center");
    expect((await attrs(page, FOOTER))["data-os-ft-logo-pos"]).toBeUndefined();
    await undo(page);
    expect((await attrs(page, FOOTER))["data-os-ft-logo-pos"]).toBe("right");

    // Os campos releem o valor ao selecionar o outro (o GrapesJS guarda o campo desenhado).
    const shown = (label: string) =>
      page
        .locator("#traits .gjs-trt-trait", { has: page.getByText(label, { exact: true }) })
        .locator("select")
        .inputValue();
    await selectFirst(page, LOGO);
    expect(await shown("Posição do logo no computador")).toBe("right");
    await page
      .locator("#traits .gjs-trt-trait", { has: page.getByText("Posição do logo no computador", { exact: true }) })
      .locator("select")
      .selectOption("left");
    await selectFirst(page, FOOTER);
    expect(await shown("Posição do logo no computador")).toBe("left");

    // Celular: atributo próprio; no canvas do celular, o logo em cima dos links, na ponta direita.
    await setTrait(page, FOOTER, "os-ft-logo-pos-m", "right");
    expect((await attrs(page, FOOTER))["data-os-ft-logo-pos-m"]).toBe("right");
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed.setDevice("mobile");
    });
    await sizeCanvas(page, 375);
    m = await canvasMeasure(page);
    expect(Math.abs((m.logo?.r ?? 0) - (m.content?.r ?? 0))).toBeLessThan(1.5);
    expect(m.logo?.b ?? 0).toBeLessThanOrEqual((m.links?.t ?? 0) + 0.5);
    expect(m.scroll).toBeLessThanOrEqual(0);
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed.setDevice("desktop");
    });
    await sizeCanvas(page, 1200);

    // Altura: variável no estilo do rodapé; o padrão tira a variável.
    await setTrait(page, LOGO, "os-ft-logo-h", "64");
    expect((await footerStyle(page))["--os-ft-logo-h"]).toBe("64px");
    await page.waitForTimeout(100);
    expect((await canvasMeasure(page)).logo?.h).toBeCloseTo(64, 0);
    await setTrait(page, FOOTER, "os-ft-logo-h", "40");
    expect((await footerStyle(page))["--os-ft-logo-h"]).toBeUndefined();
    // Valor que não serve: o campo avisa e nada muda.
    await selectFirst(page, FOOTER);
    const field = page.locator("#traits .gjs-trt-trait", {
      has: page.getByText("Altura do logo (px; padrão 40)", { exact: true }),
    });
    await field.locator("input").fill("500");
    await field.locator("input").dispatchEvent("change");
    expect(await field.locator("[data-os-field-err]").textContent()).toBe(
      "Use um número de 20 a 120 (em pixels; o padrão é 40).",
    );
    expect((await footerStyle(page))["--os-ft-logo-h"]).toBeUndefined();
    expect(pageErrors(page)).toEqual([]);
  });

  it("para onde o logo leva: uma página da oferta (vira o endereço dela na página); sem destino, o logo não é link", async () => {
    await setTrait(page, FOOTER, "os-ft-logo-dest", STORE_PAGE);
    expect((await attrs(page, "a.os-ft-logo")).href).toBe(`os-page:${STORE_PAGE}`);
    let $ = cheerio.load(await exportPage(page));
    expect($("footer a.os-ft-logo").attr("href")).toBe(`/p/${STORE_PAGE}`);
    expect(
      await page.evaluate(
        (sel) =>
          (window as unknown as EditorWindow).ed.getWrapper()?.find(sel)[0].getTrait("os-ft-logo-dest")?.getValue(),
        LOGO,
      ),
    ).toBe(STORE_PAGE);
    await setTrait(page, LOGO, "os-ft-logo-dest", "");
    expect((await attrs(page, "a.os-ft-logo")).href).toBeUndefined();
    $ = cheerio.load(await exportPage(page));
    expect($("footer a.os-ft-logo").length).toBe(1);
    expect($("footer a.os-ft-logo").attr("href")).toBeUndefined();
    expect(pageErrors(page)).toEqual([]);
  });

  it("“Tirar o logo do rodapé” (no logo) desliga e seleciona o rodapé", async () => {
    await selectFirst(page, LOGO);
    await page.locator("#traits button", { hasText: "Tirar o logo do rodapé" }).click();
    expect((await attrs(page, FOOTER))["data-os-ft-logo"]).toBe("0");
    expect(await page.evaluate(() => (window as unknown as EditorWindow).ed.getSelected()?.get("type"))).toBe(
      FOOTER_TYPE,
    );
    await undo(page);
    expect((await attrs(page, FOOTER))["data-os-ft-logo"]).toBe("1");
  });
});

describe("o painel acompanha o logo; “Trocar logo” só liga quando a imagem é escolhida; âncora e dica", () => {
  /** A caixa “Mostrar logo” desenhada nas Configurações (não só o valor guardado no campo). */
  const showBox = (page: Page) => page.locator("#traits .gjs-trt-trait__wrp-os-ft-logo-on input[type=checkbox]");
  const logoState = (page: Page) =>
    page.evaluate(() => {
      const f = (window as unknown as EditorWindow).ed.getWrapper()?.find("footer")[0];
      const img = f?.find("img.os-ft-logo-img")[0];
      return { on: f?.getAttributes()["data-os-ft-logo"], logo: img ? String(img.get("src")) : null };
    });

  it("“Mostrar logo” fica marcado quando a posição, a altura ou o destino ligam o logo, e um clique desliga", async () => {
    for (const [trait, value] of [
      ["os-ft-logo-pos", "left"],
      ["os-ft-logo-pos-m", "right"],
      ["os-ft-logo-h", "56"],
      ["os-ft-logo-dest", STORE_PAGE],
    ] as const) {
      const page = await openEditor(browser, { pages: PAGES });
      await addBlock(page, "rodape");
      await selectFirst(page, FOOTER);
      expect(await showBox(page).isChecked(), trait).toBe(false);
      await setTrait(page, FOOTER, trait, value);
      expect((await logoState(page)).on, trait).toBe("1");
      // Sem selecionar de novo: a caixa já acompanha.
      expect(await showBox(page).isChecked(), trait).toBe(true);
      // Um clique só desliga (antes, o 1º só marcava a caixa e o logo continuava).
      await page.locator("#traits .gjs-trt-trait__wrp-os-ft-logo-on label").click();
      expect((await logoState(page)).on, trait).toBe("0");
      expect(await showBox(page).isChecked(), trait).toBe(false);
      expect(pageErrors(page)).toEqual([]);
      await page.close();
    }
  });

  it("“Trocar logo” com o logo desligado: Cancelar não muda nada; escolher a imagem liga o logo com ela, num passo de Desfazer", async () => {
    const page = await openEditor(browser, { pages: PAGES });
    await addBlock(page, "rodape");
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed.UndoManager.clear();
    });
    await selectFirst(page, FOOTER);
    const swap = page.locator("#traits button.os-action-primary");
    expect(await swap.textContent()).toBe("Trocar logo");

    // Sem o elemento do logo ainda: abre o gerenciador e fecha sem escolher.
    await swap.click();
    expect(await amOpen(page)).toBe(true);
    await page.evaluate(() => (window as unknown as EditorWindow).ed.AssetManager.close());
    expect(await logoState(page)).toEqual({ on: "0", logo: null });
    expect(cheerio.load((await editorOutput(page)).html)(".os-ft-logo").length).toBe(0);
    expect(await undoSteps(page)).toBe(0);
    expect(await showBox(page).isChecked()).toBe(false);

    // Escolhendo a imagem: o logo entra ligado, já com ela, e a caixa acompanha.
    await swap.click();
    await pick(page, logo);
    expect(await logoState(page)).toEqual({ on: "1", logo });
    expect(await showBox(page).isChecked()).toBe(true);
    await settle(page);
    expect(await undoSteps(page)).toBe(1);
    await undo(page);
    expect(await logoState(page)).toEqual({ on: "0", logo: null });
    // Refazer devolve o logo ligado. (A imagem em si o GrapesJS 0.23 não refaz em nenhuma
    // imagem: o Refazer grava o src só nos atributos. Por isso ela é escolhida de novo abaixo.)
    await redo(page);
    expect((await logoState(page)).on).toBe("1");
    await page.evaluate((src) => {
      (window as unknown as EditorWindow).ed.getWrapper()?.find("img.os-ft-logo-img")[0].set("src", src);
    }, logo);

    // Com o logo desligado (o elemento fica, escondido): Cancelar não liga; escolher liga com a imagem nova.
    await setTrait(page, FOOTER, "os-ft-logo-on", false);
    await selectFirst(page, FOOTER);
    await swap.click();
    await page.evaluate(() => (window as unknown as EditorWindow).ed.AssetManager.close());
    expect(await logoState(page)).toEqual({ on: "0", logo });
    const other = await pngLogo(300, 100, "#047857");
    await swap.click();
    await pick(page, other);
    expect(await logoState(page)).toEqual({ on: "1", logo: other });
    expect(await showBox(page).isChecked()).toBe(true);

    // Logo ligado: o mesmo de sempre (Cancelar deixa como estava).
    await swap.click();
    await page.evaluate(() => (window as unknown as EditorWindow).ed.AssetManager.close());
    expect(await logoState(page)).toEqual({ on: "1", logo: other });
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it("o rodapé tem a “Âncora (para links #)” e a “Dica ao passar o mouse”, como os outros elementos", async () => {
    const page = await openHtml(templateHtml("captura", "Captura", new Date("2026-01-10T12:00:00Z")));
    await selectFirst(page, FOOTER);
    const traits = await selectedTraits(page);
    expect(traits?.slice(-3)).toEqual(["os-h-ft-outros", "title", "id"]);
    const anchor = page.locator("#traits .gjs-trt-trait__wrp-id");
    expect(await anchor.textContent()).toContain("Âncora (para links #)");
    expect(await page.locator("#traits .gjs-trt-trait__wrp-title").textContent()).toContain("Dica ao passar o mouse");
    await anchor.locator("input").fill("contato");
    await anchor.locator("input").dispatchEvent("change");
    expect((await attrs(page, FOOTER)).id).toBe("contato");
    expect(
      cheerio
        .load((await editorOutput(page)).html)("footer")
        .attr("id"),
    ).toBe("contato");
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });
});

describe("“Usar o mesmo logo do cabeçalho”", () => {
  it("só aparece com cabeçalho de loja com logo enviado; copia a imagem e a descrição e liga o logo do rodapé", async () => {
    const page = await openEditor(browser, { pages: PAGES });
    await addBlock(page, "rodape");
    const sameBtn = () => page.locator("#traits button", { hasText: /logo do cabeçalho/ });
    await selectFirst(page, FOOTER);
    await page.waitForTimeout(80);
    expect(await sameBtn().isVisible()).toBe(false);
    // Cabeçalho com o logo provisório: ainda não.
    await addBlock(page, "cabecalho-loja");
    await selectFirst(page, FOOTER);
    await page.waitForTimeout(80);
    expect(await sameBtn().isVisible()).toBe(false);
    // Logo enviado no cabeçalho: aparece.
    const headerLogo = await pngLogo(500, 100, "#b91c1c");
    await page.evaluate((src) => {
      const e = (window as unknown as EditorWindow).ed;
      const img = e.getWrapper()?.find("img.os-sh-logo-img")[0];
      img?.set("src", src);
      img?.addAttributes({ alt: "Logo da Loja Modelo" });
    }, headerLogo);
    await selectFirst(page, FOOTER);
    await page.waitForTimeout(80);
    expect(await sameBtn().isVisible()).toBe(true);
    expect(await sameBtn().textContent()).toBe("Usar o mesmo logo do cabeçalho");
    await sameBtn().click();
    await page.waitForTimeout(150);
    expect((await attrs(page, FOOTER))["data-os-ft-logo"]).toBe("1");
    const img = await page.evaluate(() => {
      const c = (window as unknown as EditorWindow).ed.getWrapper()?.find("img.os-ft-logo-img")[0];
      return { src: String(c?.get("src")), alt: c?.getAttributes().alt };
    });
    expect(img).toEqual({ src: headerLogo, alt: "Logo da Loja Modelo" });
    expect(await sameBtn().textContent()).toBe("Já é o mesmo logo do cabeçalho");
    expect(await sameBtn().isDisabled()).toBe(true);
    // A proporção do logo novo vai para o rodapé quando ele carrega no canvas.
    await sizeCanvas(page, 1200);
    await page.waitForTimeout(200);
    expect(Number.parseFloat((await footerStyle(page))["--os-ft-logo-r"])).toBeCloseTo(5, 3);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });
});

describe("página publicada (sem script)", () => {
  /** Mede o rodapé na página publicada sem nenhum script (o lugar do logo é só CSS), nesta largura. */
  async function published(html: string, width: number) {
    const $ = cheerio.load(html);
    $("script").remove();
    const site = await openSite(browser, $.html(), { contextOptions: { viewport: { width, height: 900 } } });
    await site.page.locator("footer").scrollIntoViewIfNeeded();
    await site.page.waitForFunction(() => {
      const img = document.querySelector("img.os-ft-logo-img") as HTMLImageElement | null;
      return !img || img.complete;
    });
    const m = await site.page.evaluate(
      (fn) => new Function("doc", `return (${fn})(doc)`)(document) as ReturnType<typeof measure>,
      measure.toString(),
    );
    await site.context.close();
    return m;
  }

  for (const [name, source] of [
    ["bloco “Rodapé com políticas” (escuro)", "bloco"],
    ["modelo da loja (claro)", "modelo"],
    ["bloco gravado antes", "antigo"],
  ] as const) {
    it(`${name}: as 3 posições em 1280, 390 e 360 px, sem rolagem lateral; desligado, escondido`, async () => {
      let page: Page;
      /**
       * Página do modelo: o CSS dele vai na folha base, em @layer os-original (o
       * harness não a monta; no editor completo ela volta ao salvar).
       */
      const base =
        source === "modelo"
          ? prepareForEditor(storeHtml)
              .styles.map((st) => (st.kind === "inline" ? st.text : ""))
              .join("\n")
          : "";
      const save = async () => {
        const html = await exportPage(page);
        return base ? html.replace(/<head>/i, `<head><style>@layer os-original{${base}}</style>`) : html;
      };
      if (source === "bloco") {
        page = await openEditor(browser, { pages: PAGES });
        await addBlock(page, "rodape");
      } else if (source === "modelo") {
        page = await openHtml(storeHtml);
      } else {
        page = await openHtml(
          `<!doctype html><html><head><title>T</title></head><body><h1>Página</h1>${OLD_BLOCK_FOOTER}</body></html>`,
        );
      }
      await sizeCanvas(page, 1200);
      await setTrait(page, FOOTER, "os-ft-logo-on", true);
      await page.evaluate((src) => {
        (window as unknown as EditorWindow).ed.getWrapper()?.find("img.os-ft-logo-img")[0]?.set("src", src);
      }, logo);
      await page.waitForFunction(() => {
        const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
        const img = doc.querySelector("img.os-ft-logo-img") as HTMLImageElement | null;
        return !!img && img.complete && img.naturalWidth === 600;
      });
      await page.waitForTimeout(150);
      for (const pos of ["center", "left", "right"] as const) {
        await setTrait(page, FOOTER, "os-ft-logo-pos", pos);
        await setTrait(page, FOOTER, "os-ft-logo-pos-m", pos);
        const html = await save();
        for (const width of [1280, 390, 360]) {
          const m = await published(html, width);
          const label = `${source} · ${pos} · ${width}`;
          expect(m.shown, label).toBe(true);
          expect(m.natural, label).toEqual([600, 140]);
          expect(m.scroll, label).toBeLessThanOrEqual(0);
          const logoBox = m.logo as Box;
          const links = m.links as Box;
          const content = m.content as Box;
          expect(logoBox.h, label).toBeCloseTo(40, 0);
          expect(logoBox.w, label).toBeCloseTo((600 / 140) * 40, 0);
          expect(logoBox.l, label).toBeGreaterThanOrEqual(content.l - 0.5);
          expect(logoBox.r, label).toBeLessThanOrEqual(content.r + 0.5);
          const side = width > 768 && pos !== "center";
          if (!side) {
            // Logo em cima dos links e textos.
            expect(logoBox.b, label).toBeLessThanOrEqual(links.t + 0.5);
          } else {
            // Logo ao lado dos links, na mesma altura, sem encostar.
            expect(Math.abs(logoBox.t - links.t), label).toBeLessThan(2);
            if (pos === "left") expect(logoBox.r, label).toBeLessThan(links.l);
            else expect(logoBox.l, label).toBeGreaterThan(links.r);
          }
          if (pos === "center") {
            expect(Math.abs(logoBox.l + logoBox.w / 2 - (content.l + content.r) / 2), label).toBeLessThan(1.5);
          } else if (pos === "left") {
            expect(Math.abs(logoBox.l - content.l), label).toBeLessThan(1.5);
          } else {
            expect(Math.abs(logoBox.r - content.r), label).toBeLessThan(1.5);
          }
        }
      }

      // Logo largo (7,5 : 1) com altura 120: para em 280 px de largura, sem faixa vazia.
      await page.evaluate(
        async (src) => {
          (window as unknown as EditorWindow).ed.getWrapper()?.find("img.os-ft-logo-img")[0]?.set("src", src);
        },
        await pngLogo(600, 80),
      );
      await page.waitForFunction(() => {
        const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
        const img = doc.querySelector("img.os-ft-logo-img") as HTMLImageElement | null;
        return !!img && img.complete && img.naturalHeight === 80;
      });
      await page.waitForTimeout(150);
      await setTrait(page, FOOTER, "os-ft-logo-h", "120");
      const wide = await save();
      for (const width of [1280, 360]) {
        const m = await published(wide, width);
        expect(m.logo?.w, `largo · ${width}`).toBeCloseTo(280, 0);
        expect(m.logo?.h, `largo · ${width}`).toBeCloseTo(280 / 7.5, 0);
        expect(m.scroll).toBeLessThanOrEqual(0);
      }

      // Desligado: o logo fica no HTML, escondido; o resto do rodapé como antes.
      await setTrait(page, FOOTER, "os-ft-logo-on", false);
      const off = await save();
      expect(cheerio.load(off)("footer .os-ft-logo").length).toBe(1);
      for (const width of [1280, 390]) {
        const m = await published(off, width);
        expect(m.shown, `desligado · ${width}`).toBe(false);
        expect(m.scroll).toBeLessThanOrEqual(0);
      }
      expect(pageErrors(page)).toEqual([]);
      await page.close();
    });
  }
});

// ─── Editor completo (editor-app.tsx) ────────────────────────────────────────

/** Envio de imagem (/api/assets/upload) e a imagem enviada em /os-assets/. */
class UploadServer extends FakeServer {
  uploads = 0;
  constructor(
    private file: Buffer,
    private path: string,
  ) {
    super();
  }
  override async handle(route: Route) {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/assets/upload") {
      this.uploads++;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [{ type: "image", src: this.path, name: "exemplo-logo.png", width: 600, height: 140 }],
        }),
      });
    }
    if (url.pathname === this.path) return route.fulfill({ contentType: "image/png", body: this.file });
    return super.handle(route);
  }
}

describe("logo do rodapé no editor completo", { timeout: 120_000 }, () => {
  let s: Session;
  beforeAll(async () => {
    await appBundle();
  }, 180_000);
  afterAll(async () => {
    await s?.page.close().catch(() => undefined);
  });

  it("clique no rodapé: Configurações com “Mostrar logo”; o clique no logo traz “Trocar logo” e o arquivo enviado vira o logo (e é salvo)", async () => {
    const src = `/os-assets/${"d".repeat(64)}.png`;
    const png = Buffer.from(logo.split(",")[1], "base64");
    const server = new UploadServer(png, src);
    const id = "docrodapelogo000000000001";
    server.add(
      makePayload({
        documentId: id,
        html: templateHtml("captura", "Captura", new Date("2026-01-10T12:00:00Z")),
        page: { id: "cpaginacaptura00000000001", name: "Captura", slug: "captura", type: "OTHER" },
      }),
    );
    s = await openApp(browser, server, id);
    await waitFor(() => server.okPuts.length === 1, 10_000, "primeiro salvamento");
    const page = s.page;
    type W = { OS: { editor(): EditorWindow["ed"] } };
    await page.waitForFunction(() => (window as unknown as W).OS.editor().Canvas.getZoom() <= 100);
    await page.waitForTimeout(500);
    /** Ponto na tela de um elemento do canvas (`dy`: a partir do alto dele), rolando o canvas até ele. */
    const point = (sel: string, dy?: number) =>
      page.evaluate(
        ([selector, offset]) => {
          const e = (window as unknown as W).OS.editor();
          const doc = e.Canvas.getDocument() as Document;
          const el = doc.querySelector(selector as string) as HTMLElement | null;
          if (!el) throw new Error(`sem ${selector}`);
          // Sem a rolagem suave da página (a medida vem logo em seguida).
          el.scrollIntoView({ block: "center", behavior: "instant" });
          const frame = e.Canvas.getFrameEl().getBoundingClientRect();
          const r = el.getBoundingClientRect();
          const z = e.Canvas.getZoom() / 100;
          const y = offset === null ? r.top + r.height / 2 : r.top + (offset as number);
          return { x: frame.left + (r.left + 12) * z, y: frame.top + y * z };
        },
        [sel, dy ?? null] as const,
      );

    // Um clique no espaço do rodapé (acima do conteúdo): o rodapé, nas Configurações.
    let target = await point("footer", 12);
    await page.mouse.click(target.x, target.y);
    const panel = page.locator('[data-os-panel="config"]');
    const show = panel.locator(".gjs-trt-trait", { has: page.getByText("Mostrar logo", { exact: true }) });
    await show.waitFor({ state: "attached" });
    expect(await withEditor<string>(page, `(ed) => ed.getSelected().get("type")`)).toBe(FOOTER_TYPE);
    expect(await page.getByRole("tab", { name: "Configurações" }).getAttribute("aria-selected")).toBe("true");
    const amIsOpen = () => withEditor<boolean>(page, "(ed) => ed.AssetManager.isOpen()");

    // "Trocar logo" com o logo desligado e "Cancelar" na janela: nada muda (o logo provisório não entra).
    await panel.getByRole("button", { name: "Trocar logo" }).click();
    await waitFor(amIsOpen, 4000, "gerenciador aberto pelo “Trocar logo” do rodapé");
    await page.locator(".gjs-mdl-container").getByRole("button", { name: "Cancelar" }).click();
    await waitFor(async () => !(await amIsOpen()), 4000, "gerenciador fechado pelo Cancelar");
    expect(await withEditor<number>(page, `(ed) => ed.getWrapper().find(".os-ft-logo").length`)).toBe(0);
    expect(await withEditor<string>(page, `(ed) => ed.getSelected().getAttributes()["data-os-ft-logo"]`)).toBe("0");
    expect(await show.locator("input").isChecked()).toBe(false);

    await show.locator("label").click();
    await waitFor(
      () => withEditor<boolean>(page, `(ed) => ed.getWrapper().find("img.os-ft-logo-img").length === 1`),
      4000,
      "logo ligado",
    );

    // Um clique no logo: a imagem, com "Trocar logo" (sem atalho de link: o logo não é link).
    await page.waitForTimeout(200);
    target = await point("img.os-ft-logo-img");
    await page.mouse.click(target.x, target.y);
    const swap = panel.getByRole("button", { name: "Trocar logo" });
    await swap.waitFor({ state: "attached" });
    expect(await withEditor<string>(page, `(ed) => ed.getSelected().get("type")`)).toBe("os-ft-logo-img");
    expect(await panel.textContent()).not.toContain("Configurar o botão");
    expect(await panel.textContent()).toContain("Posição do logo no celular");

    // Dois cliques (mouse de verdade) abrem o gerenciador de imagens.
    await page.mouse.dblclick(target.x, target.y);
    await waitFor(amIsOpen, 4000, "gerenciador aberto pelos dois cliques");
    await page.keyboard.press("Escape");
    await waitFor(async () => !(await amIsOpen()), 4000, "gerenciador fechado");

    // "Trocar logo" e o envio do arquivo: vira o logo.
    target = await point("img.os-ft-logo-img");
    await page.mouse.click(target.x, target.y);
    await swap.waitFor({ state: "attached" });
    await swap.click();
    expect(await amIsOpen()).toBe(true);
    const input = page.locator(".gjs-mdl-container input[type=file]");
    await input.waitFor({ state: "attached" });
    await input.setInputFiles({ name: "exemplo-logo.png", mimeType: "image/png", buffer: png });
    await waitFor(
      () => withEditor<boolean>(page, `(ed) => ed.getWrapper().find("img.os-ft-logo-img")[0].get("src") === "${src}"`),
      6000,
      "logo trocado",
    );
    expect(server.uploads).toBe(1);
    await page.keyboard.press("Escape");

    await waitFor(
      () =>
        server.okPuts.some(
          (p) =>
            p.html.includes(`src="${src}"`) &&
            p.css.includes(".os-ft-logo-img") &&
            p.css.includes("--os-ft-logo-r:4.2857"),
        ),
      8000,
      "logo salvo",
    );
    const saved = cheerio.load(server.okPuts.at(-1)?.html ?? "");
    expect(saved('footer[data-os-ft-logo="1"] a.os-ft-logo img.os-ft-logo-img').attr("src")).toBe(src);
    expect(s.errors).toEqual([]);
  });
});
