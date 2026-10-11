/**
 * Logo do cabeçalho de loja, num Chromium de verdade:
 *
 * - no editor (GrapesJS): um clique no logo seleciona a IMAGEM, com "Trocar
 *   logo" em destaque (também na barra do elemento) e sem as alças de
 *   redimensionar; num botão comum com ícone o clique continua pegando o
 *   botão; "Trocar logo"
 *   (no logo e no grupo "Logo" do cabeçalho) e dois cliques abrem o gerenciador
 *   de imagens, e a imagem escolhida vira o logo na proporção dela;
 * - "Posição do logo no computador/no celular" e "Altura do logo": atributos e
 *   variável no cabeçalho, valor que não serve avisa e não grava, Desfazer, e o
 *   canvas no computador e no celular;
 * - projeto e HTML reabertos; página gravada antes desta mudança (regra do
 *   logo com 40 px fixos, sem as regras novas): ao abrir, lugar e altura valem;
 * - a página publicada (sem script) em 1280, 390 e 360 px: as 3 posições com
 *   qualquer combinação de partes ligadas/desligadas, sem sobrepor nada nem
 *   rolagem lateral, e o tamanho (padrão, alto, celular com teto);
 * - no editor completo (editor-app.tsx), com o mouse de verdade: o clique abre
 *   as Configurações com "Trocar logo" e o atalho "Este logo é um link ·
 *   Configurar o link"; dois cliques abrem o gerenciador; o envio de um arquivo
 *   pelo gerenciador troca o logo (e é salvo).
 */
import * as cheerio from "cheerio";
import { type Browser, chromium, type Page, type Route } from "playwright";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storeHtml } from "@/editor/templates/store";
import { finalizeFromEditor, prepareForEditor } from "@/lib/editor-html";
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

const HEADER = '[data-os-widget="store-header"]';
const LOGO = "img.os-sh-logo-img";
const PAGES = [{ id: fakeId("loja"), name: "Loja" }];

let browser: Browser;
/** Logo de exemplo (600 × 140, sem marca nenhuma). */
let logoPng: Buffer;
let logo = "";
beforeAll(async () => {
  browser = await chromium.launch();
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="140"><rect width="600" height="140" rx="24" fill="#1d4ed8"/><rect x="20" y="20" width="100" height="100" rx="22" fill="#ffffff"/><rect x="150" y="50" width="400" height="40" rx="8" fill="#ffffff"/></svg>';
  logoPng = await sharp(Buffer.from(svg)).png().toBuffer();
  logo = `data:image/png;base64,${logoPng.toString("base64")}`;
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** O harness não carrega o CSS do GrapesJS (o canvas ficaria com 300 × 150 px): largura do canvas. */
async function sizeCanvas(page: Page, width: number) {
  await page.evaluate((w) => {
    const frame = (window as unknown as EditorWindow).ed.Canvas.getFrameEl();
    frame.style.cssText = `display:block;width:${w}px;height:760px;border:0`;
  }, width);
  await page.waitForTimeout(200);
}

/**
 * Clique no canvas como o GrapesJS o repassa (seleção com o evento do clique):
 * o harness não carrega o CSS do GrapesJS, e o mouse de verdade fica para o
 * editor completo (no fim deste arquivo).
 */
const clickSelect = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const e = (window as unknown as EditorWindow).ed;
    const c = e.getWrapper()?.find(sel)[0];
    if (!c) throw new Error(`nada com ${sel}`);
    e.select(c, { event: new MouseEvent("click", { detail: 1 }) } as never);
    const s = e.getSelected();
    return { type: s?.get("type"), id: s?.getId() };
  }, selector);

const undo = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as EditorWindow).ed.UndoManager.undo();
  });

const amOpen = (page: Page) => page.evaluate(() => (window as unknown as EditorWindow).ed.AssetManager.isOpen());

/** Escolhe a imagem no gerenciador aberto (clique nela, como a pessoa faz) e fecha. */
async function pick(page: Page, src: string) {
  await page.evaluate((s) => {
    const am = (window as unknown as EditorWindow).ed.AssetManager;
    const asset = am.get(s) as unknown as { view?: { el?: HTMLElement } } | null;
    asset?.view?.el?.click();
    am.close();
  }, src);
  await page.waitForTimeout(100);
}

const logoSrc = (page: Page) =>
  page.evaluate(() =>
    String((window as unknown as EditorWindow).ed.getWrapper()?.find("img.os-sh-logo-img")[0]?.get("src")),
  );

/** Logo de exemplo (PNG, só retângulos) com este tamanho, como data URI. */
async function pngLogo(width: number, height: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#b91c1c"/><rect x="${Math.round(height * 0.2)}" y="${Math.round(height * 0.2)}" width="${Math.round(width * 0.6)}" height="${Math.round(height * 0.6)}" fill="#ffffff"/></svg>`;
  return `data:image/png;base64,${(await sharp(Buffer.from(svg)).png().toBuffer()).toString("base64")}`;
}

/** Estilo próprio do cabeçalho (variáveis de cor, altura e proporção do logo). */
const headerStyle = (page: Page) =>
  page.evaluate(() => {
    const e = (window as unknown as EditorWindow).ed;
    const h = e.getWrapper()?.find('[data-os-widget="store-header"]')[0];
    const rule = h ? e.Css.getIdRule(h.getId(), { mediaText: "", state: "" } as never) : null;
    return (rule?.getStyle() ?? {}) as Record<string, string>;
  });

/** Troca a imagem do logo (como o gerenciador faz) e espera ela carregar no canvas. */
async function setLogoImage(page: Page, src: string) {
  await page.evaluate((s) => {
    (window as unknown as EditorWindow).ed.getWrapper()?.find("img.os-sh-logo-img")[0]?.set("src", s);
  }, src);
  await page.waitForFunction((s) => {
    const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
    const img = doc.querySelector("img.os-sh-logo-img") as HTMLImageElement | null;
    return !!img && img.getAttribute("src") === s && img.complete && img.naturalWidth > 0;
  }, src);
  await page.waitForTimeout(150);
}

/** Valor mostrado (o <select> do painel) no campo com este rótulo, nas Configurações do selecionado. */
const shownOption = (page: Page, label: string) =>
  page
    .locator("#traits .gjs-trt-trait", { has: page.getByText(label, { exact: true }) })
    .locator("select")
    .inputValue();

/** Escolhe uma opção no <select> do painel (como a pessoa faz). */
const chooseOption = (page: Page, label: string, value: string) =>
  page
    .locator("#traits .gjs-trt-trait", { has: page.getByText(label, { exact: true }) })
    .locator("select")
    .selectOption(value);

const selectFirst = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const e = (window as unknown as EditorWindow).ed;
    e.select(e.getWrapper()?.find(sel)[0]);
  }, selector);

/** Medidas do logo desenhado no canvas. */
const canvasLogo = (page: Page) =>
  page.evaluate(() => {
    const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
    const img = doc.querySelector("img.os-sh-logo-img") as HTMLImageElement;
    const row = (doc.querySelector(".os-sh-main .os-sh-in") as HTMLElement).getBoundingClientRect();
    const r = img.getBoundingClientRect();
    const link = (doc.querySelector("a.os-sh-logo") as HTMLElement).getBoundingClientRect();
    const search = (doc.querySelector(".os-sh-search") as HTMLElement).getBoundingClientRect();
    return {
      w: r.width,
      h: r.height,
      natural: [img.naturalWidth, img.naturalHeight],
      linkCenter: (link.left + link.right) / 2,
      rowCenter: (row.left + row.right) / 2,
      linkRight: link.right,
      rowRight:
        row.right -
        Number.parseFloat(getComputedStyle(doc.querySelector(".os-sh-main .os-sh-in") as Element).paddingRight),
      searchTop: search.top,
      linkBottom: link.bottom,
    };
  });

describe("logo no editor", () => {
  let page: Page;
  beforeAll(async () => {
    page = await openEditor(browser, { pages: PAGES });
    await addBlock(page, "cabecalho-loja");
    // Botão comum com ícone (imagem dentro de um link): o clique continua pegando o botão.
    await page.evaluate((src) => {
      (window as unknown as EditorWindow).ed
        .getWrapper()
        ?.append(
          `<p style="margin:40px"><a id="btn-icone" href="#" style="display:inline-flex;align-items:center;padding:12px 20px"><img id="btn-img" src="${src}" style="width:60px;height:14px" alt=""><span>Comprar</span></a></p>`,
        );
      (window as unknown as EditorWindow).ed.AssetManager.add({ type: "image", src, name: "logo.png" });
    }, logo);
    await sizeCanvas(page, 1200);
  }, 60_000);
  afterAll(() => page?.close());

  it("um clique no logo seleciona a imagem, com “Trocar logo” em destaque; num botão comum, o clique continua pegando o botão", async () => {
    expect((await clickSelect(page, LOGO)).type).toBe("os-sh-logo-img");
    const names = await page.evaluate(() =>
      (window as unknown as EditorWindow).ed
        .getSelected()
        ?.getTraits()
        .map((t) => String(t.get("name"))),
    );
    expect(names).toEqual([
      "os-sh-logo-swap",
      "os-sh-logo-tip",
      "os-sh-logo-alt",
      "os-h-sh-logo-lugar",
      "os-sh-logo-pos",
      "os-sh-logo-pos-m",
      "os-sh-logo-h",
      "os-sh-logo-place-note",
      "os-sh-logo-dest",
    ]);
    const swap = page.locator("#traits button.os-action-primary");
    expect(await swap.textContent()).toBe("Trocar logo");
    expect(await swap.isVisible()).toBe(true);
    // Na barra do elemento, o botão de trocar a imagem (o logo estende a imagem).
    const toolbar = await page.evaluate(() =>
      ((window as unknown as EditorWindow).ed.getSelected()?.get("toolbar") as { id?: string }[]).map(
        (i) => i.id ?? "",
      ),
    );
    expect(toolbar).toContain("os-swap-image");
    // Sem alças de redimensionar: o tamanho vem de "Altura do logo".
    expect(await page.evaluate(() => (window as unknown as EditorWindow).ed.getSelected()?.get("resizable"))).toBe(
      false,
    );
    // A descrição da imagem continua editável (com exemplo de logo, não de foto de produto);
    // vazia volta ao padrão (o logo é o único conteúdo do link).
    expect(await page.locator("#traits input[placeholder='Ex.: Logo da Minha Loja']").count()).toBe(1);
    await setTrait(page, LOGO, "os-sh-logo-alt", "Logo da Loja Modelo");
    expect((await attrs(page, LOGO)).alt).toBe("Logo da Loja Modelo");
    await setTrait(page, LOGO, "os-sh-logo-alt", "  ");
    expect((await attrs(page, LOGO)).alt).toBe("Logo da loja");

    // Outro clique no logo selecionado: continua no logo.
    expect((await clickSelect(page, LOGO)).type).toBe("os-sh-logo-img");
    // O carrinho (ícone gerado) continua selecionando o link dele.
    expect(
      await page.evaluate(() => {
        const e = (window as unknown as EditorWindow).ed;
        e.select(e.getWrapper()?.find('[data-os-sh-icon="cart"]')[0], {
          event: new MouseEvent("click", { detail: 1 }),
        } as never);
        return e.getSelected()?.getClasses()[0];
      }),
    ).toBe("os-sh-cart");

    // Botão comum com ícone: o clique no ícone seleciona o botão (link), como sempre;
    // outro clique entra no ícone.
    expect((await clickSelect(page, "#btn-img")).id).toBe("btn-icone");
    expect((await clickSelect(page, "#btn-img")).id).toBe("btn-img");
    expect(pageErrors(page)).toEqual([]);
  });

  it("“Trocar logo” (no logo e no grupo “Logo” do cabeçalho) e dois cliques abrem o gerenciador; a imagem escolhida vira o logo, na proporção dela", async () => {
    // No logo selecionado.
    await page.evaluate(() => {
      const e = (window as unknown as EditorWindow).ed;
      e.select(e.getWrapper()?.find("img.os-sh-logo-img")[0]);
    });
    await page.locator("#traits button.os-action-primary").click();
    expect(await amOpen(page)).toBe(true);
    await pick(page, logo);
    expect(await logoSrc(page)).toBe(logo);
    await page.waitForTimeout(150);
    let m = await canvasLogo(page);
    expect(m.natural).toEqual([600, 140]);
    expect(m.h).toBe(40);
    expect(m.w).toBeCloseTo((600 / 140) * 40, 0);

    // Desfazer volta o logo provisório; no cabeçalho, o mesmo botão.
    await undo(page);
    expect(await logoSrc(page)).toMatch(/^data:image\/svg\+xml/);
    await page.evaluate(() => {
      const e = (window as unknown as EditorWindow).ed;
      e.select(e.getWrapper()?.find('[data-os-widget="store-header"]')[0]);
    });
    const headerSwap = page.locator("#traits button.os-action-primary");
    expect(await headerSwap.textContent()).toBe("Trocar logo");
    await headerSwap.click();
    expect(await amOpen(page)).toBe(true);
    await pick(page, logo);
    expect(await logoSrc(page)).toBe(logo);

    m = await canvasLogo(page);
    expect(m.h).toBe(40);
    expect(pageErrors(page)).toEqual([]);
  });

  it("posição no computador e no celular e altura: no cabeçalho e no logo, com Desfazer; valor que não serve avisa e não grava", async () => {
    // Pelo logo: grava no cabeçalho.
    await setTrait(page, LOGO, "os-sh-logo-pos", "center");
    expect((await attrs(page, HEADER))["data-os-sh-logo-pos"]).toBe("center");
    await page.waitForTimeout(100);
    let m = await canvasLogo(page);
    expect(Math.abs(m.linkCenter - m.rowCenter)).toBeLessThan(1.5);
    expect(m.searchTop).toBeGreaterThanOrEqual(m.linkBottom - 1);
    await setTrait(page, HEADER, "os-sh-logo-pos", "right");
    await page.waitForTimeout(100);
    m = await canvasLogo(page);
    expect(Math.abs(m.linkRight - m.rowRight)).toBeLessThan(1.5);
    // "Esquerda" (o padrão) tira o atributo; Desfazer volta "Direita".
    await setTrait(page, HEADER, "os-sh-logo-pos", "left");
    expect((await attrs(page, HEADER))["data-os-sh-logo-pos"]).toBeUndefined();
    await undo(page);
    expect((await attrs(page, HEADER))["data-os-sh-logo-pos"]).toBe("right");
    await setTrait(page, HEADER, "os-sh-logo-pos", "center");

    // Celular: atributo próprio; no canvas do celular, o logo na ponta direita.
    await setTrait(page, LOGO, "os-sh-logo-pos-m", "right");
    expect((await attrs(page, HEADER))["data-os-sh-logo-pos-m"]).toBe("right");
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed.setDevice("mobile");
    });
    await sizeCanvas(page, 375);
    m = await canvasLogo(page);
    expect(Math.abs(m.linkRight - m.rowRight)).toBeLessThan(1.5);
    expect(m.h).toBeCloseTo(34, 0);
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed.setDevice("desktop");
    });
    await sizeCanvas(page, 1200);

    // Altura: variável no estilo do cabeçalho; o padrão tira a variável.
    const heightVar = () =>
      page.evaluate(() => {
        const e = (window as unknown as EditorWindow).ed;
        const h = e.getWrapper()?.find('[data-os-widget="store-header"]')[0];
        const rule = h ? e.Css.getIdRule(h.getId(), { mediaText: "", state: "" } as never) : null;
        return (rule?.getStyle() as Record<string, string> | undefined)?.["--os-sh-logo-h"];
      });
    await setTrait(page, HEADER, "os-sh-logo-h", "56");
    expect(await heightVar()).toBe("56px");
    await page.waitForTimeout(100);
    expect((await canvasLogo(page)).h).toBe(56);
    expect(
      await page.evaluate(() => {
        const e = (window as unknown as EditorWindow).ed;
        return e.getWrapper()?.find("img.os-sh-logo-img")[0]?.getTrait("os-sh-logo-h")?.getValue();
      }),
    ).toBe("56");
    await setTrait(page, LOGO, "os-sh-logo-h", "40");
    expect(await heightVar()).toBeUndefined();

    // Digitado no painel: fora da faixa avisa e não grava; "64 px" vale.
    await page.evaluate(() => {
      const e = (window as unknown as EditorWindow).ed;
      e.select(e.getWrapper()?.find('[data-os-widget="store-header"]')[0]);
    });
    const field = page
      .locator("#traits .gjs-trt-trait", { has: page.getByText("Altura do logo (px; padrão 40)", { exact: true }) })
      .locator("input");
    await field.fill("500");
    await field.press("Enter");
    await page.waitForTimeout(100);
    expect(
      await page
        .locator("#traits [data-os-field-err]")
        .filter({ hasText: /de 20 a 120/ })
        .isVisible(),
    ).toBe(true);
    expect(await heightVar()).toBeUndefined();
    await field.fill("64 px");
    await field.press("Enter");
    await page.waitForTimeout(100);
    expect(await heightVar()).toBe("64px");
    expect(await field.inputValue()).toBe("64");

    // Nada disso no HTML como estilo inline nem marca do canvas; a variável vai no CSS do cabeçalho.
    const { html, css } = await editorOutput(page);
    const $ = cheerio.load(html);
    expect($(HEADER).attr("data-os-sh-logo-pos")).toBe("center");
    expect($(HEADER).attr("data-os-sh-logo-pos-m")).toBe("right");
    expect($(LOGO).attr("src")).toBe(logo);
    expect($(LOGO).attr("style")).toBeUndefined();
    expect(css).toMatch(/#[\w-]+\{[^}]*--os-sh-logo-h:64px/);
    expect(pageErrors(page)).toEqual([]);
  });

  it("projeto salvo e HTML reabertos: logo, posições e altura ficam; o clique continua pegando a imagem", async () => {
    const first = await editorOutput(page);
    const project = await page.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData());
    const again = await openEditor(browser, { project, pages: PAGES });
    await sizeCanvas(again, 1200);
    const read = (p: Page) =>
      p.evaluate(() => {
        const e = (window as unknown as EditorWindow).ed;
        const img = e.getWrapper()?.find("img.os-sh-logo-img")[0];
        const header = e.getWrapper()?.find('[data-os-widget="store-header"]')[0];
        return {
          type: img?.get("type"),
          self: img?.get("osClickSelf"),
          src: String(img?.get("src")).slice(0, 30),
          pos: img?.getTrait("os-sh-logo-pos")?.getValue(),
          posM: header?.getTrait("os-sh-logo-pos-m")?.getValue(),
          h: header?.getTrait("os-sh-logo-h")?.getValue(),
        };
      });
    const expected = {
      type: "os-sh-logo-img",
      self: true,
      src: logo.slice(0, 30),
      pos: "center",
      posM: "right",
      h: "64",
    };
    expect(await read(again)).toEqual(expected);
    expect((await clickSelect(again, LOGO)).type).toBe("os-sh-logo-img");
    await again.close();

    // HTML salvo reaberto (as edições de CSS vão num <style data-os-edits>, que volta como regras do editor).
    const saved = finalizeFromEditor(first.html, first.css);
    const reopened = await openEditor(browser, { pages: PAGES });
    await reopened.evaluate((h) => {
      const w = window as unknown as EditorWindow;
      w.OS.importPageHtml(w.ed, h);
    }, prepareForEditor(saved).html);
    await sizeCanvas(reopened, 1200);
    expect(await read(reopened)).toEqual(expected);
    expect((await canvasLogo(reopened)).h).toBe(64);
    await reopened.close();
  });

  it("página gravada antes (regra do logo com 40 px fixos, sem as regras novas): ao abrir, lugar e altura passam a valer", async () => {
    const fresh = await openEditor(browser, { pages: PAGES });
    await addBlock(fresh, "cabecalho-loja");
    const project = (await fresh.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData())) as {
      styles: { selectors?: unknown; selectorsAdd?: string; mediaText?: string; style?: Record<string, string> }[];
    };
    await fresh.close();
    type Rule = (typeof project.styles)[number];
    const sel = (r: Rule) => `${r.selectorsAdd ?? ""}${JSON.stringify(r.selectors ?? "")}`;
    // Como era: sem as regras de lugar/tamanho do logo e com a do logo de 40 px (180 no máximo; 34/150 no celular).
    project.styles = project.styles.filter(
      (r) => !/logo-pos|\.os-sh-logo \.os-sh-logo-img|\.os-sh-in > a/.test(sel(r)),
    );
    const base = project.styles.filter((r) => r.selectorsAdd === ".os-store-header .os-sh-logo-img" && !r.mediaText);
    expect(base).toHaveLength(1);
    base[0].style = { ...base[0].style, width: "auto", "max-width": "180px", height: "40px" };
    const mobileLink = project.styles.find((r) => r.selectorsAdd === ".os-store-header .os-sh-logo" && r.mediaText);
    if (!mobileLink) throw new Error("sem a regra do logo no celular");
    project.styles.push({
      ...mobileLink,
      selectorsAdd: ".os-store-header .os-sh-logo-img",
      style: { "max-width": "150px", height: "34px" },
    } as Rule);
    expect(JSON.stringify(project.styles)).not.toContain("logo-pos");
    expect(JSON.stringify(project.styles)).not.toContain("os-sh-logo-h");
    const old = await openEditor(browser, { project, pages: PAGES });
    await sizeCanvas(old, 1200);
    await setTrait(old, HEADER, "os-sh-logo-h", "56");
    await setTrait(old, HEADER, "os-sh-logo-pos", "center");
    await old.waitForTimeout(100);
    const m = await canvasLogo(old);
    expect(m.h).toBe(56);
    expect(Math.abs(m.linkCenter - m.rowCenter)).toBeLessThan(1.5);
    // No celular, a regra antiga (34 px) também perde: 85% dos 56.
    await old.evaluate(() => {
      (window as unknown as EditorWindow).ed.setDevice("mobile");
    });
    await sizeCanvas(old, 375);
    expect((await canvasLogo(old)).h).toBeCloseTo(56 * 0.85, 0);
    const { css } = await editorOutput(old);
    expect(css).toContain('[data-os-sh-logo-pos="center"]');
    expect(css).toContain("var(--os-sh-logo-h,40px)");
    // As regras novas de lugar (links e logo) entram sozinhas.
    expect(css).toMatch(/\.os-store-header \.os-sh-in ?> ?a\{position:relative;/);
    expect(pageErrors(old)).toEqual([]);
    await old.close();
  });

  it("página gravada com a versão anterior do logo (sem o limite pela proporção nem o lugar protegido): ao abrir, a regra do logo é completada e a proporção gravada", async () => {
    const fresh = await openEditor(browser, { pages: PAGES });
    await addBlock(fresh, "cabecalho-loja");
    await sizeCanvas(fresh, 1200);
    await setLogoImage(fresh, await pngLogo(600, 80));
    const project = (await fresh.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData())) as {
      styles: { selectors?: unknown; selectorsAdd?: string; mediaText?: string; style?: Record<string, string> }[];
    };
    await fresh.close();
    // Como ficou gravada: regra do logo só com o tamanho, sem a dos links e sem a proporção.
    const rule = project.styles.find(
      (r) => r.selectorsAdd === ".os-store-header .os-sh-logo .os-sh-logo-img" && !r.mediaText,
    );
    if (!rule) throw new Error("sem a regra do logo");
    rule.style = { width: "auto", "max-width": "280px", height: "var(--os-sh-logo-h,40px)" };
    project.styles = project.styles.filter((r) => r.selectorsAdd !== ".os-store-header .os-sh-in > a");
    const own = project.styles.filter((r) => r.style && "--os-sh-logo-r" in r.style);
    expect(own).toHaveLength(1);
    delete own[0].style?.["--os-sh-logo-r"];

    const old = await openEditor(browser, { project, pages: PAGES });
    await sizeCanvas(old, 1200);
    await old.waitForFunction(() => {
      const e = (window as unknown as EditorWindow).ed;
      const h = e.getWrapper()?.find('[data-os-widget="store-header"]')[0];
      const r = h ? e.Css.getIdRule(h.getId(), { mediaText: "", state: "" } as never) : null;
      return Boolean((r?.getStyle() as Record<string, string> | undefined)?.["--os-sh-logo-r"]);
    });
    expect(Number.parseFloat((await headerStyle(old))["--os-sh-logo-r"])).toBeCloseTo(7.5, 2);
    const completed = await old.evaluate(
      () =>
        (window as unknown as EditorWindow).ed.Css.getRule(
          ".os-store-header .os-sh-logo .os-sh-logo-img",
        )?.getStyle() as Record<string, string>,
    );
    expect(completed).toMatchObject({
      height: "var(--os-sh-logo-h,40px)",
      "max-height": "calc(280px / var(--os-sh-logo-r,.01))",
      position: "static",
      "min-height": "0",
      opacity: "1",
    });
    // A abertura não entra no Desfazer.
    expect(await old.evaluate(() => (window as unknown as EditorWindow).ed.UndoManager.hasUndo())).toBe(false);
    await setTrait(old, HEADER, "os-sh-logo-h", "120");
    await old.waitForTimeout(80);
    const m = await canvasLogo(old);
    expect(m.h).toBeCloseTo(280 / 7.5, 0);
    expect(m.w).toBeCloseTo(280, 0);
    await old.evaluate((css) => {
      const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
      const style = doc.createElement("style");
      style.textContent = css;
      doc.head.appendChild(style);
    }, LOGO_CLONE_CSS);
    await old.waitForTimeout(80);
    expect(await old.evaluate(`(${logoUsable})(window.ed.Canvas.getDocument())`)).toMatchObject({
      hit: true,
      visible: true,
      inRow: true,
    });
    expect(pageErrors(old)).toEqual([]);
    await old.close();
  });
});

describe("logo no editor: o painel e o canvas acompanham", () => {
  let page: Page;
  beforeAll(async () => {
    page = await openEditor(browser, { pages: PAGES });
    await addBlock(page, "cabecalho-loja");
    await sizeCanvas(page, 1200);
  }, 60_000);
  afterAll(() => page?.close());

  const PC = "Posição do logo no computador";
  const CEL = "Posição do logo no celular";

  it("a posição mostrada é a de agora, mudada no logo ou no cabeçalho (e depois do Desfazer)", async () => {
    // Os dois painéis já foram abertos uma vez (o GrapesJS guarda o campo desenhado).
    await selectFirst(page, LOGO);
    expect(await shownOption(page, PC)).toBe("left");
    await selectFirst(page, HEADER);
    expect(await shownOption(page, PC)).toBe("left");

    // Mudou no cabeçalho: o logo mostra a nova.
    await chooseOption(page, PC, "center");
    expect((await attrs(page, HEADER))["data-os-sh-logo-pos"]).toBe("center");
    await selectFirst(page, LOGO);
    expect(await shownOption(page, PC)).toBe("center");

    // Mudou no logo: o cabeçalho mostra a nova — e escolher “Centro” de novo nele funciona.
    await chooseOption(page, PC, "left");
    expect((await attrs(page, HEADER))["data-os-sh-logo-pos"]).toBeUndefined();
    await selectFirst(page, HEADER);
    expect(await shownOption(page, PC)).toBe("left");
    await chooseOption(page, PC, "center");
    expect((await attrs(page, HEADER))["data-os-sh-logo-pos"]).toBe("center");

    // Celular, com Desfazer feito com o cabeçalho selecionado: o logo mostra o valor desfeito.
    await selectFirst(page, LOGO);
    await chooseOption(page, CEL, "right");
    expect((await attrs(page, HEADER))["data-os-sh-logo-pos-m"]).toBe("right");
    await selectFirst(page, HEADER);
    expect(await shownOption(page, CEL)).toBe("right");
    await undo(page);
    expect((await attrs(page, HEADER))["data-os-sh-logo-pos-m"]).toBeUndefined();
    expect(await shownOption(page, CEL)).toBe("left");
    await selectFirst(page, LOGO);
    expect(await shownOption(page, CEL)).toBe("left");
    expect(await shownOption(page, PC)).toBe("center");
    expect(pageErrors(page)).toEqual([]);
  });

  it("“Entre” e carrinho sem link: uma linha do cabeçalho embaixo da linha deles, sem balão que cubra o logo (computador, tablet e celular, em qualquer posição)", async () => {
    await setTrait(page, HEADER, "data-os-sh-account", true);
    const marks = await attrs(page, "a.os-sh-cart");
    expect(marks["data-os-link"]).toBe("");
    expect((await attrs(page, "a.os-sh-acc"))["data-os-link"]).toBe("");
    const look = () =>
      page.evaluate(() => {
        const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
        const view = doc.defaultView as Window;
        const rect = (sel: string) => (doc.querySelector(sel) as HTMLElement).getBoundingClientRect();
        const main = rect(".os-sh-main");
        const row = rect(".os-sh-main .os-sh-in");
        const logoBox = rect("img.os-sh-logo-img");
        return {
          // Nenhum balão nos links (o contorno tracejado de sempre continua).
          bubbles: ["a.os-sh-acc", "a.os-sh-cart"].map(
            (sel) => view.getComputedStyle(doc.querySelector(sel) as Element, "::after").content,
          ),
          outline: view.getComputedStyle(doc.querySelector("a.os-sh-cart") as Element).outlineStyle,
          note: view.getComputedStyle(doc.querySelector(".os-sh-main") as Element, "::after").content,
          // A linha fica embaixo da linha do logo (na caixa dela, depois do conteúdo).
          below: main.bottom - row.bottom,
          logoInRow: logoBox.top >= row.top - 0.5 && logoBox.bottom <= row.bottom + 0.5,
          scroll: doc.documentElement.scrollWidth - doc.documentElement.clientWidth,
        };
      });
    const BOTH = '"Carrinho e “Entre” sem destino: clique em cada um e escolha o link da oferta em Configurações"';
    for (const [device, width] of [
      ["mobile", 375],
      ["tablet", 768],
      ["desktop", 1200],
    ] as const) {
      await page.evaluate((d) => {
        (window as unknown as EditorWindow).ed.setDevice(d);
      }, device);
      await sizeCanvas(page, width);
      for (const pos of ["left", "center", "right"]) {
        await setTrait(page, HEADER, "os-sh-logo-pos-m", pos);
        await setTrait(page, HEADER, "os-sh-logo-pos", pos);
        await page.waitForTimeout(80);
        const m = await look();
        const label = `${device} · ${pos}`;
        expect(m.bubbles, label).toEqual(["none", "none"]);
        expect(m.outline, label).toBe("dashed");
        expect(m.note, label).toBe(BOTH);
        expect(m.below, label).toBeGreaterThan(14);
        expect(m.logoInRow, label).toBe(true);
        expect(m.scroll, label).toBeLessThanOrEqual(0);
      }
    }
    // Só o "Entre" sem link (o carrinho com um endereço); depois, nenhum.
    await setTrait(page, "a.os-sh-cart", "href", "https://loja.exemplo.com/carrinho");
    expect((await look()).note).toBe('"“Entre” sem destino: clique nele e escolha o link da oferta em Configurações"');
    await setTrait(page, HEADER, "data-os-sh-account", false);
    expect((await look()).note).toBe("none");
    // Só o carrinho.
    await setTrait(page, "a.os-sh-cart", "href", "");
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed
        .getWrapper()
        ?.find("a.os-sh-cart")[0]
        ?.addAttributes({ "data-os-link": "" });
    });
    expect((await look()).note).toBe('"Carrinho sem destino: clique nele e escolha o link da oferta em Configurações"');
    // O aviso é só do canvas.
    const { html, css } = await editorOutput(page);
    expect(html + css).not.toContain("sem destino: clique");
    await setTrait(page, HEADER, "os-sh-logo-pos-m", "left");
    await setTrait(page, HEADER, "os-sh-logo-pos", "left");
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed.setDevice("desktop");
    });
    await sizeCanvas(page, 1200);
    expect(pageErrors(page)).toEqual([]);
  });

  it("“Altura do logo” num logo largo: a caixa acompanha o desenho (sem faixa vazia); ele cresce até 280 px de largura", async () => {
    for (const [w, h] of [
      [600, 80],
      [500, 100],
      [200, 200],
    ]) {
      await setLogoImage(page, await pngLogo(w, h));
      const ratio = w / h;
      // A proporção da imagem fica no estilo do cabeçalho (vai junto para a página).
      expect(Number.parseFloat((await headerStyle(page))["--os-sh-logo-r"])).toBeCloseTo(ratio, 2);
      for (const height of [40, 80, 120]) {
        await setTrait(page, HEADER, "os-sh-logo-h", String(height));
        await page.waitForTimeout(80);
        const m = await canvasLogo(page);
        const label = `${w}×${h} · ${height}`;
        expect(m.h, label).toBeCloseTo(Math.min(height, 280 / ratio), 0);
        expect(m.w, label).toBeCloseTo(Math.min(280, height * ratio), 0);
        // O cabeçalho só cresce com o logo: linha principal = logo + respiro (10 + 10).
        const row = await page.evaluate(() => {
          const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
          return (doc.querySelector(".os-sh-main .os-sh-in") as HTMLElement).getBoundingClientRect().height;
        });
        expect(row, label).toBeLessThanOrEqual(Math.max(m.h, 42) + 20 + 1);
      }
    }
    // Desfazer a troca: a proporção volta com a imagem.
    await setTrait(page, HEADER, "os-sh-logo-h", "40");
    await setLogoImage(page, await pngLogo(600, 80));
    expect(Number.parseFloat((await headerStyle(page))["--os-sh-logo-r"])).toBeCloseTo(7.5, 2);
    await undo(page);
    await page.waitForTimeout(300);
    expect(Number.parseFloat((await headerStyle(page))["--os-sh-logo-r"])).toBeCloseTo(1, 2);
    expect(pageErrors(page)).toEqual([]);
  });

  it("proporção do logo fora do Desfazer: pôr o cabeçalho e desfazer não deixa sobra no CSS; refazer devolve", async () => {
    const fresh = await openEditor(browser, { pages: PAGES });
    const ratioCss = () =>
      fresh.evaluate(
        () => /--os-sh-logo-r:[^;}]*/.exec((window as unknown as EditorWindow).ed.getCss() ?? "")?.[0] ?? null,
      );
    const run = (action: "undo" | "redo") =>
      fresh.evaluate((a) => {
        (window as unknown as EditorWindow).ed.UndoManager[a]();
      }, action);
    // Como o clique no bloco: um passo do Desfazer; a proporção do logo provisório (200 × 56) vem depois.
    await fresh.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.getWrapper()?.append(ed.Blocks.get("cabecalho-loja")?.get("content") as never);
    });
    await fresh.waitForFunction(() => /--os-sh-logo-r:/.test((window as unknown as EditorWindow).ed.getCss() ?? ""));
    expect(await ratioCss()).toBe("--os-sh-logo-r:3.5714");
    const headers = () =>
      fresh.evaluate(
        () => (window as unknown as EditorWindow).ed.getWrapper()?.find('[data-os-widget="store-header"]').length,
      );
    await run("undo");
    expect(await headers()).toBe(0);
    expect(await ratioCss()).toBeNull();
    await run("redo");
    await fresh.waitForFunction(() => /--os-sh-logo-r:/.test((window as unknown as EditorWindow).ed.getCss() ?? ""));
    expect(await ratioCss()).toBe("--os-sh-logo-r:3.5714");
    expect(pageErrors(fresh)).toEqual([]);
    await fresh.close();
  });

  it("CSS de página clonada para `header img`, `a img` e `header a` (camada os-original): o logo continua no lugar, à vista e na altura escolhida", async () => {
    await setLogoImage(page, await pngLogo(300, 100));
    await setTrait(page, HEADER, "os-sh-logo-h", "60");
    await page.evaluate((css) => {
      const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
      const style = doc.createElement("style");
      style.id = "clone-css";
      style.textContent = css;
      doc.head.appendChild(style);
    }, LOGO_CLONE_CSS);
    for (const pos of ["left", "center", "right"]) {
      await setTrait(page, HEADER, "os-sh-logo-pos", pos);
      await page.waitForTimeout(80);
      const m = await page.evaluate(`(${logoUsable})(window.ed.Canvas.getDocument())`);
      expect(m, pos).toMatchObject({
        hit: true,
        visible: true,
        inRow: true,
        position: "static",
        linkPosition: "relative",
      });
      expect((m as { h: number }).h, pos).toBeCloseTo(60, 0);
      expect((m as { w: number }).w, pos).toBeCloseTo(180, 0);
    }
    await page.evaluate(() => {
      ((window as unknown as EditorWindow).ed.Canvas.getDocument() as Document).getElementById("clone-css")?.remove();
    });
    await setTrait(page, HEADER, "os-sh-logo-pos", "left");
    await setTrait(page, HEADER, "os-sh-logo-h", "40");
    expect(pageErrors(page)).toEqual([]);
  });
});

/**
 * CSS de página clonada que pega o logo: imagem de fundo de um "header herói"
 * (absoluta, cobrindo, atrás), alturas máximas de imagem e links do cabeçalho
 * fora do lugar (absolutos, deslocados, transparentes, com fundo).
 */
const LOGO_CLONE_CSS =
  "@layer os-fix, os-original;@layer os-original{" +
  "header img{position:absolute;top:0;left:0;width:100%;height:100%;min-width:900px;min-height:300px;object-fit:cover;z-index:-1;float:left;transform:translateY(40px);opacity:.3;filter:blur(4px)}" +
  "header img{max-height:50px}" +
  "a img{max-height:30px}" +
  "header a{position:absolute;top:-500px;left:-500px;z-index:-2;width:100%;height:100%;min-height:200px;max-width:20px;transform:scale(.2);opacity:0;visibility:hidden;background-color:#ff0000;border:4px solid #00ff00}" +
  "}";

/**
 * Logo do documento: à vista (o clique no meio dele chega nele), dentro da
 * linha principal, sem deslocamento, e o tamanho dele.
 */
function logoUsable(doc: Document) {
  const view = doc.defaultView as Window;
  const img = doc.querySelector("img.os-sh-logo-img") as HTMLImageElement;
  const link = doc.querySelector("a.os-sh-logo") as HTMLElement;
  const row = (doc.querySelector(".os-sh-main .os-sh-in") as HTMLElement).getBoundingClientRect();
  const r = img.getBoundingClientRect();
  const hit = doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const cs = view.getComputedStyle(img);
  const ls = view.getComputedStyle(link);
  return {
    hit: hit === img,
    visible:
      cs.visibility === "visible" &&
      cs.opacity === "1" &&
      ls.visibility === "visible" &&
      ls.opacity === "1" &&
      cs.filter === "none" &&
      ls.transform === "none" &&
      cs.transform === "none",
    inRow:
      r.top >= row.top - 0.5 && r.bottom <= row.bottom + 0.5 && r.left >= row.left - 0.5 && r.right <= row.right + 0.5,
    position: cs.position,
    linkPosition: ls.position,
    linkBg: ls.backgroundColor,
    w: r.width,
    h: r.height,
  };
}

// ─── Página publicada ────────────────────────────────────────────────────────

type Box = { l: number; r: number; t: number; b: number; w: number; h: number };
interface Layout {
  row: { l: number; r: number };
  logo: Box;
  img: Box;
  loc: Box | null;
  search: Box | null;
  acc: Box | null;
  cart: Box | null;
  natural: number[];
  fit: string;
  scroll: number;
}

/** Liga/desliga partes e posições no cabeçalho publicado (CSS por atributo: sem script). */
const apply = (page: Page, set: Record<string, string>) =>
  page.evaluate((s) => {
    const header = document.querySelector('[data-os-widget="store-header"]') as HTMLElement;
    for (const [k, v] of Object.entries(s)) {
      if (v) header.setAttribute(k, v);
      else header.removeAttribute(k);
    }
  }, set);

const measure = (page: Page) =>
  page.evaluate((): Layout => {
    const box = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el || getComputedStyle(el).display === "none") return null;
      const r = el.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height };
    };
    const inner = document.querySelector(".os-sh-main .os-sh-in") as HTMLElement;
    const row = inner.getBoundingClientRect();
    const cs = getComputedStyle(inner);
    const img = document.querySelector(".os-sh-logo-img") as HTMLImageElement;
    return {
      row: { l: row.left + Number.parseFloat(cs.paddingLeft), r: row.right - Number.parseFloat(cs.paddingRight) },
      logo: box(".os-sh-logo") as Box,
      img: box(".os-sh-logo-img") as Box,
      loc: box(".os-sh-loc"),
      search: box(".os-sh-search"),
      acc: box(".os-sh-acc"),
      cart: box(".os-sh-cart"),
      natural: [img.naturalWidth, img.naturalHeight],
      fit: getComputedStyle(img).objectFit,
      scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

const overlaps = (a: Box, b: Box) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
const mid = (b: { l: number; r: number }) => (b.l + b.r) / 2;

/** Partes ligadas/desligadas (o resto ligado; o "Entre" ligado com "1"). */
const PARTS: Record<string, Record<string, string>> = {
  "tudo ligado": {},
  "sem pesquisa": { "data-os-sh-search": "0" },
  "sem local de entrega": { "data-os-sh-loc": "0" },
  "sem carrinho": { "data-os-sh-cart": "0" },
  "sem “Entre”": { "data-os-sh-account": "0" },
  "sem pesquisa e sem local": { "data-os-sh-search": "0", "data-os-sh-loc": "0" },
  "sem “Entre” e sem carrinho": { "data-os-sh-account": "0", "data-os-sh-cart": "0" },
  "só o logo": {
    "data-os-sh-search": "0",
    "data-os-sh-loc": "0",
    "data-os-sh-account": "0",
    "data-os-sh-cart": "0",
  },
};
const ALL_ON = { "data-os-sh-search": "1", "data-os-sh-loc": "1", "data-os-sh-account": "1", "data-os-sh-cart": "1" };
const POSITIONS = ["left", "center", "right"] as const;

/** Nada se sobrepõe, tudo cabe na linha e a página não rola de lado. */
function checkFits(m: Layout, label: string) {
  const items: [string, Box][] = [];
  for (const k of ["logo", "loc", "search", "acc", "cart"] as const) {
    const b = m[k];
    if (b) items.push([k, b]);
  }
  for (const [name, b] of items) {
    expect(b.l, `${label}: ${name} sai pela esquerda`).toBeGreaterThanOrEqual(m.row.l - 0.5);
    expect(b.r, `${label}: ${name} sai pela direita`).toBeLessThanOrEqual(m.row.r + 0.5);
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      expect(overlaps(items[i][1], items[j][1]), `${label}: ${items[i][0]} × ${items[j][0]}`).toBe(false);
    }
  }
  expect(m.scroll, `${label}: rolagem lateral`).toBe(0);
}

describe("lugar e tamanho do logo na página publicada (sem script)", () => {
  let html = "";
  let tall = "";
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
    await setLogoImage(page, logo);
    const strip = (h: string) => h.replace(/<script data-os-runtime>[\s\S]*?<\/script>/, "");
    html = strip(await exportPage(page));
    await setTrait(page, HEADER, "os-sh-logo-h", "80");
    tall = strip(await exportPage(page));
    await page.close();
  }, 60_000);

  it("computador (1280): esquerda, centro e direita com qualquer combinação de partes, sem sobrepor nada", async () => {
    const site = await openSite(browser, html, { contextOptions: { viewport: { width: 1280, height: 800 } } });
    const { page } = site;
    for (const pos of POSITIONS) {
      for (const [name, parts] of Object.entries(PARTS)) {
        await apply(page, { ...ALL_ON, ...parts, "data-os-sh-logo-pos": pos === "left" ? "" : pos });
        const m = await measure(page);
        const label = `${pos} · ${name}`;
        checkFits(m, label);
        const others = [m.loc, m.acc, m.cart].filter((b): b is Box => b !== null);
        if (pos === "left") {
          expect(Math.abs(m.logo.l - m.row.l), label).toBeLessThan(1);
          for (const b of [...others, ...(m.search ? [m.search] : [])])
            expect(b.l, label).toBeGreaterThanOrEqual(m.logo.r);
        } else if (pos === "center") {
          // O logo no meio da linha de cima; local à esquerda; "Entre"/carrinho à direita.
          expect(Math.abs(mid(m.logo) - mid(m.row)), label).toBeLessThan(1.5);
          if (m.loc) {
            expect(Math.abs(m.loc.l - m.row.l), label).toBeLessThan(1);
            expect(m.loc.r, label).toBeLessThanOrEqual(m.logo.l);
          }
          for (const b of [m.acc, m.cart]) if (b) expect(b.l, label).toBeGreaterThanOrEqual(m.logo.r);
          if (m.cart) expect(Math.abs(m.cart.r - m.row.r), label).toBeLessThan(1);
          else if (m.acc) expect(Math.abs(m.acc.r - m.row.r), label).toBeLessThan(1);
          if (m.acc && m.cart) expect(m.acc.r, label).toBeLessThanOrEqual(m.cart.l - 10);
          // A pesquisa desce para uma linha própria, larga e centralizada.
          if (m.search) {
            expect(m.search.t, label).toBeGreaterThanOrEqual(m.logo.b);
            expect(Math.abs(mid(m.search) - mid(m.row)), label).toBeLessThan(1.5);
            expect(m.search.w, label).toBeGreaterThan(600);
          }
        } else {
          // Na ponta direita, com os outros itens antes dele; a pesquisa continua no meio.
          expect(Math.abs(m.logo.r - m.row.r), label).toBeLessThan(1);
          for (const b of [...others, ...(m.search ? [m.search] : [])])
            expect(b.r, label).toBeLessThanOrEqual(m.logo.l);
          if (m.search) {
            expect(Math.abs(m.search.t + m.search.h / 2 - (m.logo.t + m.logo.h / 2)), label).toBeLessThan(12);
            expect(m.search.w, label).toBeGreaterThan(500);
          }
        }
        // Tamanho padrão: 40 px de altura, largura da proporção da imagem.
        expect(m.img.h, label).toBe(40);
        expect(m.img.w, label).toBeCloseTo((600 / 140) * 40, 0);
      }
    }
    await site.context.close();
  });

  it("celular (390 e 360): esquerda, centro e direita com qualquer combinação de partes, sem rolagem lateral", async () => {
    for (const width of [390, 360]) {
      const site = await openSite(browser, html, { contextOptions: { viewport: { width, height: 800 } } });
      const { page } = site;
      for (const pos of POSITIONS) {
        for (const [name, parts] of Object.entries(PARTS)) {
          // A posição do computador não muda nada no celular.
          await apply(page, {
            ...ALL_ON,
            ...parts,
            "data-os-sh-logo-pos": "center",
            "data-os-sh-logo-pos-m": pos === "left" ? "" : pos,
          });
          const m = await measure(page);
          const label = `${width} · ${pos} · ${name}`;
          checkFits(m, label);
          const top = [m.acc, m.cart].filter((b): b is Box => b !== null);
          for (const b of top) expect(Math.abs(b.t + b.h / 2 - (m.logo.t + m.logo.h / 2)), label).toBeLessThan(4);
          if (m.search) expect(m.search.t, label).toBeGreaterThan(m.logo.b - 1);
          if (m.loc) expect(m.loc.t, label).toBeGreaterThan(m.logo.b - 1);
          if (pos === "left") {
            expect(Math.abs(m.logo.l - m.row.l), label).toBeLessThan(1);
            for (const b of top) expect(b.l, label).toBeGreaterThanOrEqual(m.logo.r);
          } else if (pos === "center") {
            // Logo no meio; carrinho à direita ("Entre", só o ícone, à esquerda).
            expect(Math.abs(mid(m.logo) - mid(m.row)), label).toBeLessThan(1.5);
            if (m.cart) expect(Math.abs(m.cart.r - m.row.r), label).toBeLessThan(1);
            if (m.acc) expect(Math.abs(m.acc.l - m.row.l), label).toBeLessThan(1);
          } else {
            expect(Math.abs(m.logo.r - m.row.r), label).toBeLessThan(1);
            for (const b of top) expect(b.r, label).toBeLessThanOrEqual(m.logo.l);
          }
          // Proporcional: 85% dos 40 px do computador.
          expect(m.img.h, label).toBeCloseTo(34, 0);
          expect(m.img.w, label).toBeCloseTo((600 / 140) * 34, 0);
        }
      }
      await site.context.close();
    }
  });

  it("altura escolhida: no computador ela mesma (logo largo para na largura máxima, sem faixa vazia); no celular proporcional, até 48 px", async () => {
    const desk = await openSite(browser, tall, { contextOptions: { viewport: { width: 1280, height: 800 } } });
    for (const pos of POSITIONS) {
      await apply(desk.page, { ...ALL_ON, "data-os-sh-logo-pos": pos === "left" ? "" : pos });
      const m = await measure(desk.page);
      checkFits(m, `alto · ${pos}`);
      // 600 × 140 a 80 px de altura daria 343 px: o máximo é 280, e a altura para
      // na que cabe nele (280 × 140 ÷ 600), sem faixa vazia em volta da imagem.
      expect(m.img.w).toBeCloseTo(280, 0);
      expect(m.img.h).toBeCloseTo((280 * 140) / 600, 0);
      expect(m.fit).toBe("contain");
      expect(m.natural).toEqual([600, 140]);
    }
    await desk.context.close();
    for (const width of [390, 360]) {
      const phone = await openSite(browser, tall, { contextOptions: { viewport: { width, height: 800 } } });
      for (const pos of POSITIONS) {
        await apply(phone.page, { ...ALL_ON, "data-os-sh-logo-pos-m": pos === "left" ? "" : pos });
        const m = await measure(phone.page);
        checkFits(m, `alto · ${width} · ${pos}`);
        expect(m.img.h).toBe(48);
        expect(m.img.w).toBeCloseTo((600 / 140) * 48, 0);
      }
      await phone.context.close();
    }
  });
});

describe("logo largo, CSS de página clonada e computador estreito (página publicada)", () => {
  /** HTML exportado por caso: "<largura>x<altura>@<altura escolhida>" e "clone". */
  const pages: Record<string, string> = {};
  const strip = (h: string) => h.replace(/<script data-os-runtime>[\s\S]*?<\/script>/, "");
  /** Textos longos no local de entrega e no "Entre". */
  const longTexts = (h: string) => {
    const $ = cheerio.load(h);
    $(".os-sh-loc-1").text("Enviar para");
    $(".os-sh-loc-2").text("Rio de Janeiro e região metropolitana");
    $(".os-sh-acc-t").text("Minha conta e pedidos");
    return $.html();
  };
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
    await sizeCanvas(page, 1200);
    for (const [w, h] of [
      [600, 80],
      [500, 100],
    ]) {
      await setLogoImage(page, await pngLogo(w, h));
      for (const height of [40, 80, 120]) {
        await setTrait(page, HEADER, "os-sh-logo-h", String(height));
        pages[`${w}x${h}@${height}`] = strip(await exportPage(page));
      }
    }
    await setLogoImage(page, await pngLogo(300, 100));
    await setTrait(page, HEADER, "os-sh-logo-h", "60");
    pages.clone = strip(await exportPage(page)).replace("</head>", `<style>${LOGO_CLONE_CSS}</style></head>`);
    await page.close();
  }, 90_000);

  it("“Altura do logo” num logo largo: a caixa acompanha o desenho no computador e no celular (sem faixa vazia)", async () => {
    for (const width of [1280, 390]) {
      const site = await openSite(browser, "<p></p>", { contextOptions: { viewport: { width, height: 800 } } });
      for (const [key, html] of Object.entries(pages)) {
        const m = /^(\d+)x(\d+)@(\d+)$/.exec(key);
        if (!m) continue;
        const [w, h, height] = [Number(m[1]), Number(m[2]), Number(m[3])];
        await site.page.setContent(html);
        await site.page.waitForFunction(() => (document.querySelector(".os-sh-logo-img") as HTMLImageElement).complete);
        const box = await measure(site.page);
        const ratio = w / h;
        const label = `${width} · ${key}`;
        const want =
          width === 1280 ? Math.min(height, 280 / ratio) : Math.min(height * 0.85, 48, (width - 112) / ratio);
        expect(box.img.h, label).toBeCloseTo(want, 0);
        expect(box.img.w / box.img.h, label).toBeCloseTo(ratio, 1);
        checkFits(box, label);
      }
      await site.context.close();
    }
  });

  it("CSS de página clonada para `header img`, `a img` e `header a`: o logo continua à vista, no lugar e na altura escolhida", async () => {
    for (const width of [1280, 390]) {
      const site = await openSite(browser, pages.clone, { contextOptions: { viewport: { width, height: 800 } } });
      for (const pos of POSITIONS) {
        await apply(site.page, {
          "data-os-sh-logo-pos": pos === "left" ? "" : pos,
          "data-os-sh-logo-pos-m": pos === "left" ? "" : pos,
        });
        const m = (await site.page.evaluate(`(${logoUsable})(document)`)) as ReturnType<typeof logoUsable>;
        const label = `${width} · ${pos}`;
        expect(m, label).toMatchObject({ hit: true, visible: true, inRow: true, position: "static" });
        expect(m.linkBg, label).toBe("rgba(0, 0, 0, 0)");
        // 60 px no computador; no celular 85% (51), até 48.
        expect(m.h, label).toBeCloseTo(width === 1280 ? 60 : 48, 0);
        expect(m.w, label).toBeCloseTo(width === 1280 ? 180 : 144, 0);
      }
      await site.context.close();
    }
  });

  it("computador estreito (769 e 800 px) com textos longos e logo largo: nada sai da tela nem fica cortado, em qualquer posição", async () => {
    for (const width of [769, 800]) {
      const site = await openSite(browser, longTexts(pages["600x80@40"]), {
        contextOptions: { viewport: { width, height: 800 } },
      });
      for (const pos of POSITIONS) {
        for (const [name, parts] of Object.entries(PARTS)) {
          await apply(site.page, { ...ALL_ON, ...parts, "data-os-sh-logo-pos": pos === "left" ? "" : pos });
          const m = await measure(site.page);
          const label = `${width} · ${pos} · ${name}`;
          checkFits(m, label);
          // A pesquisa continua usável; local e "Entre" encolhem (terminam em "…").
          if (m.search && pos !== "center") expect(m.search.w, label).toBeGreaterThanOrEqual(139.5);
          if (m.loc) expect(m.loc.w, label).toBeGreaterThan(40);
          expect(m.img.w, label).toBeCloseTo(280, 0);
        }
      }
      await site.context.close();
    }
  });

  it("computador estreito com os textos padrão: a pesquisa cede primeiro, nada termina em “…”", async () => {
    /** Textos cortados com "…" (o que passa da caixa). */
    const cut = (page: Page) =>
      page.evaluate(() =>
        [".os-sh-loc-1", ".os-sh-loc-2", ".os-sh-acc-t"].filter((sel) => {
          const el = document.querySelector(sel) as HTMLElement;
          return el.scrollWidth > el.clientWidth;
        }),
      );
    for (const width of [769, 800, 1024]) {
      const site = await openSite(browser, pages["600x80@40"], {
        contextOptions: { viewport: { width, height: 800 } },
      });
      for (const pos of POSITIONS) {
        await apply(site.page, { ...ALL_ON, "data-os-sh-logo-pos": pos === "left" ? "" : pos });
        const label = `${width} · ${pos}`;
        checkFits(await measure(site.page), label);
        expect(await cut(site.page), label).toEqual([]);
      }
      await site.context.close();
    }
  });
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

describe("logo no editor completo", { timeout: 90_000 }, () => {
  let s: Session;
  beforeAll(async () => {
    await appBundle();
  }, 180_000);
  afterAll(async () => {
    await s?.page.close().catch(() => undefined);
  });

  it("clique no logo: Configurações com “Trocar logo” e o atalho do link; o arquivo enviado vira o logo e é salvo", async () => {
    const src = `/os-assets/${"c".repeat(64)}.png`;
    const server = new UploadServer(logoPng, src);
    const id = "doclojalogo00000000000001";
    server.add(
      makePayload({
        documentId: id,
        html: storeHtml,
        page: { id: "cpaginaloja00000000000001", name: "Loja", slug: "loja", type: "OTHER" },
      }),
    );
    s = await openApp(browser, server, id);
    await waitFor(() => server.okPuts.length === 1, 10_000, "primeiro salvamento");
    const page = s.page;
    await page.waitForFunction(
      () => (window as unknown as { OS: { editor(): EditorWindow["ed"] } }).OS.editor().Canvas.getZoom() < 100,
    );
    await page.waitForTimeout(500);
    /** Centro do logo na tela (canvas reduzido para caber). */
    const logoPoint = () =>
      page.evaluate(() => {
        const e = (window as unknown as { OS: { editor(): EditorWindow["ed"] } }).OS.editor();
        const frame = e.Canvas.getFrameEl().getBoundingClientRect();
        const r = (e.Canvas.getDocument() as Document).querySelector("img.os-sh-logo-img")?.getBoundingClientRect();
        if (!r) throw new Error("sem logo");
        const z = e.Canvas.getZoom() / 100;
        return { x: frame.left + (r.left + r.width / 2) * z, y: frame.top + (r.top + r.height / 2) * z };
      });
    const amIsOpen = () => withEditor<boolean>(page, "(ed) => ed.AssetManager.isOpen()");

    // Um clique (mouse de verdade): a imagem do logo, com as Configurações abertas.
    let target = await logoPoint();
    await page.mouse.click(target.x, target.y);
    const panel = page.locator('[data-os-panel="config"]');
    const swap = panel.getByRole("button", { name: "Trocar logo" });
    await swap.waitFor({ state: "attached" });
    expect(await withEditor<string>(page, `(ed) => ed.getSelected().get("type")`)).toBe("os-sh-logo-img");
    expect(await page.getByRole("tab", { name: "Configurações" }).getAttribute("aria-selected")).toBe("true");
    expect(await panel.textContent()).toContain("Este logo é um link.");
    expect(await panel.textContent()).toContain("Posição do logo no computador");
    expect(await panel.textContent()).toContain("Posição do logo no celular");
    expect(await panel.textContent()).toContain("inclusive o tablet em pé");

    // Posição escolhida no logo: o cabeçalho mostra a mesma (e o contrário), no painel de verdade.
    const posSelect = panel
      .locator(".gjs-trt-trait", { has: page.getByText("Posição do logo no computador", { exact: true }) })
      .locator("select");
    const selectHeader = () =>
      withEditor(page, `(ed) => { ed.select(ed.getWrapper().find('[data-os-widget="store-header"]')[0]); }`);
    await posSelect.selectOption("center");
    expect(
      await withEditor<string>(
        page,
        `(ed) => ed.getWrapper().find('[data-os-widget="store-header"]')[0].getAttributes()["data-os-sh-logo-pos"]`,
      ),
    ).toBe("center");
    await selectHeader();
    await waitFor(async () => (await posSelect.inputValue()) === "center", 3000, "cabeçalho mostra Centro");
    await posSelect.selectOption("left");
    target = await logoPoint();
    await page.mouse.click(target.x, target.y);
    await swap.waitFor({ state: "attached" });
    expect(await posSelect.inputValue()).toBe("left");

    // Dois cliques (mouse de verdade) abrem o gerenciador de imagens.
    await page.mouse.dblclick(target.x, target.y);
    await waitFor(amIsOpen, 4000, "gerenciador aberto pelos dois cliques");
    await page.keyboard.press("Escape");
    await waitFor(async () => !(await amIsOpen()), 4000, "gerenciador fechado");
    target = await logoPoint();
    await page.mouse.click(target.x, target.y);
    await swap.waitFor({ state: "attached" });

    // Envio do arquivo pelo gerenciador (uma imagem só: já vira o logo).
    await swap.click();
    expect(await amIsOpen()).toBe(true);
    const input = page.locator(".gjs-mdl-container input[type=file]");
    await input.waitFor({ state: "attached" });
    await input.setInputFiles({ name: "exemplo-logo.png", mimeType: "image/png", buffer: logoPng });
    await waitFor(
      () => withEditor<boolean>(page, `(ed) => ed.getWrapper().find("img.os-sh-logo-img")[0].get("src") === "${src}"`),
      6000,
      "logo trocado",
    );
    expect(server.uploads).toBe(1);
    await page.keyboard.press("Escape");
    const look = await page.evaluate(() => {
      const e = (window as unknown as { OS: { editor(): EditorWindow["ed"] } }).OS.editor();
      const img = (e.Canvas.getDocument() as Document).querySelector("img.os-sh-logo-img") as HTMLImageElement;
      return { h: img.getBoundingClientRect().height, w: img.getBoundingClientRect().width, n: img.naturalWidth };
    });
    expect(look.n).toBe(600);
    expect(look.h).toBe(40);
    expect(look.w).toBeCloseTo((600 / 140) * 40, 0);
    // A proporção do logo enviado foi para o estilo do cabeçalho (sai na página).
    await waitFor(
      () =>
        withEditor<boolean>(
          page,
          `(ed) => { const h = ed.getWrapper().find('[data-os-widget="store-header"]')[0]; const r = ed.Css.getIdRule(h.getId(), { mediaText: "", state: "" }); return Math.abs(parseFloat(r && r.getStyle()["--os-sh-logo-r"]) - 600 / 140) < 0.001; }`,
        ),
      4000,
      "proporção do logo gravada",
    );

    // "Configurar o link" leva ao link do logo (para onde ele leva).
    await panel.getByRole("button", { name: "Configurar o link" }).click();
    expect(await withEditor<string>(page, `(ed) => ed.getSelected().getClasses().join(" ")`)).toBe("os-sh-logo");

    await waitFor(
      () => server.okPuts.some((p) => p.html.includes(`src="${src}"`) && p.css.includes("--os-sh-logo-r:4.2857")),
      8000,
      "logo salvo",
    );
    const saved = cheerio.load(server.okPuts.at(-1)?.html ?? "");
    expect(saved("a.os-sh-logo img.os-sh-logo-img").attr("src")).toBe(src);
    expect(s.errors).toEqual([]);
  });
});
