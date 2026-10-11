/**
 * "Contagem no topo (barra)": o contador no visual da barra que mais converte
 * (preta, frase, "TERMINA EM" e o tempo em caixinhas 00 : 14 : 46).
 *
 * Editor: bloco primeiro na categoria Conversão, tipo próprio, tempo de exemplo
 * parado, selo "Barra fixa no topo…" só no canvas, Configurações (fixa no topo,
 * contagem, ao zerar, cores) e "Estilo" trocando barra ⇄ caixas grandes num
 * passo só de desfazer, levando contagem, textos mudados e cores trocadas.
 *
 * Página (Chromium, mesmo caminho da prévia/ZIP): conta, fica presa no topo ao
 * rolar com espaço reservado no começo, no celular (360/390) sem rolagem
 * lateral e sem nada cortado, ao zerar (esconde/texto/zero/recomeça), presa
 * desligada fica no lugar, e sem JavaScript aparece com o tempo de exemplo.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAGE_TEMPLATES } from "@/editor/templates";
import { BAR_COLORS, BAR_TEXTS } from "@/lib/countdown-bar";
import { prepareForEditor } from "@/lib/editor-html";
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

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

const BAR = '[data-os-widget="countdown"][data-os-cd-style="bar"]';
const BIG = '[data-os-widget="countdown"]:not([data-os-cd-style])';
const FONT = `body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;font-size:18px}`;

/** Página com a barra no topo e conteúdo comprido embaixo, exportada como o visitante recebe. */
async function build(configure?: (page: Page) => Promise<void>, blocks = ["contador-barra", "hero", "depoimentos"]) {
  const page = await openEditor(browser);
  await page.evaluate((css) => (window as unknown as EditorWindow).ed.Css.addRules(css), FONT);
  for (const id of blocks) await addBlock(page, id);
  if (configure) await configure(page);
  const html = await exportPage(page);
  await page.close();
  return html;
}

const digits = (page: Page) =>
  page.$$eval(`${BAR} [data-os-cd]`, (els) =>
    Object.fromEntries(els.map((e) => [e.getAttribute("data-os-cd"), e.textContent])),
  );

/** HTML sem id/class (o GrapesJS pode trocar a ordem dos atributos ao reabrir). */
const noOrder = (html: string) => html.replace(/ (id|class)="[^"]*"/g, "");

/** Visual do elemento no canvas do editor. */
const canvasBox = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
    const cs = getComputedStyle(doc.querySelector(sel) as Element);
    return { maxWidth: cs.maxWidth, textAlign: cs.textAlign, marginTop: cs.marginTop };
  }, selector);

/** Troca de estilo pelo campo "Estilo" e espera o contador novo. */
async function convert(page: Page, selector: string, to: "bar" | "boxes") {
  await setTrait(page, selector, "os-cd-style", to);
  await expect
    .poll(() => page.locator("body").evaluate(() => (window as unknown as EditorWindow).ed.getSelected()?.get("type")))
    .toBe(to === "bar" ? "os-countdown-bar" : "os-countdown");
}

const undo = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as EditorWindow).ed.UndoManager.undo();
  });
const redo = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as EditorWindow).ed.UndoManager.redo();
  });

/** Regra base (sem @media) de um elemento do editor. */
const ruleOf = (page: Page, selector: string, prop: string) =>
  page.evaluate(
    ([sel, p]) => {
      const ed = (window as unknown as EditorWindow).ed;
      return ed
        .getWrapper()
        ?.find(sel)
        .map((c) => ed.Css.getIdRule(c.getId(), { mediaText: "" })?.getStyle()[p]);
    },
    [selector, prop] as const,
  );

describe("editor", () => {
  it("bloco primeiro em Conversão, tipo próprio, exemplo parado e selo só no canvas", async () => {
    const page = await openEditor(browser);
    const first = await page.evaluate(
      () => (window as unknown as EditorWindow).OS.ALL_BLOCKS.find((b) => b.category === "conversao")?.id,
    );
    expect(first).toBe("contador-barra");
    await addBlock(page, "contador-barra");
    const info = await page.evaluate((sel) => {
      const ed = (window as unknown as EditorWindow).ed;
      const comp = ed.getWrapper()?.find(sel)[0];
      const doc = ed.Canvas.getDocument() as Document;
      const el = doc.querySelector(sel) as HTMLElement;
      const box = (u: string) => doc.querySelector(`[data-os-cd-unit="${u}"]`) as HTMLElement;
      return {
        type: comp?.get("type"),
        name: comp?.getName(),
        digits: Array.from(el.querySelectorAll("[data-os-cd]")).map((n) => n.textContent),
        days: getComputedStyle(box("d")).display,
        hours: getComputedStyle(box("h")).display,
        position: getComputedStyle(el).position,
        badge: getComputedStyle(el, "::after").content,
        msg: comp?.find(".os-cdb-msg")[0]?.get("type"),
        label: comp?.find(".os-cdb-lbl")[0]?.get("type"),
        text: el.innerText.replace(/\s+/g, " ").trim(),
      };
    }, BAR);
    expect(info).toMatchObject({
      type: "os-countdown-bar",
      name: "Contagem no topo (barra)",
      digits: ["00", "00", "15", "00"],
      days: "none",
      hours: "flex",
      // No editor fica no lugar (não fixa), com o selo.
      position: "relative",
      badge: '"Barra fixa no topo (na página, acompanha a rolagem)"',
      msg: "text",
      label: "text",
    });
    expect(info.text).toBe("95% OFF aplicado automaticamente! TERMINA EM 00 : 15 : 00");
    expect(await attrs(page, BAR)).toMatchObject({
      "data-os-mode": "evergreen",
      "data-os-minutes": "15",
      "data-os-expired": "zero",
      "data-os-sticky": "1",
      "data-os-cd-days": "0",
    });

    // Nada roda no canvas.
    await page.waitForTimeout(1200);
    expect(
      await page.evaluate((sel) => {
        const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
        return Array.from(doc.querySelectorAll(`${sel} [data-os-cd]`)).map((n) => n.textContent);
      }, BAR),
    ).toEqual(["00", "00", "15", "00"]);

    // O selo e o tracejado não vão para a página.
    const { html, css } = await editorOutput(page);
    expect(html + css).not.toContain("Barra fixa no topo");
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it("Configurações: fixa no topo, contagem e as cores da barra", async () => {
    const page = await openEditor(browser);
    await addBlock(page, "contador-barra");
    await setTrait(page, BAR, "data-os-sticky", false);
    expect((await attrs(page, BAR))["data-os-sticky"]).toBe("0");
    const badge = await page.evaluate((sel) => {
      const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
      return getComputedStyle(doc.querySelector(sel) as Element, "::after").content;
    }, BAR);
    expect(badge).toBe("none");

    await setTrait(page, BAR, "data-os-minutes", "90");
    expect(
      await page.evaluate(
        (sel) =>
          (window as unknown as EditorWindow).ed
            .getWrapper()
            ?.find(`${sel} [data-os-cd]`)
            .map((c) => c.getInnerHTML()),
        BAR,
      ),
    ).toEqual(["00", "01", "30", "00"]);
    await setTrait(page, BAR, "data-os-mode", "date");
    await setTrait(page, BAR, "data-os-until", "2099-01-01T00:00");
    expect((await attrs(page, BAR))["data-os-cd-days"]).toBe("1");

    // Padrão igual à foto de referência.
    expect(await ruleOf(page, BAR, "background-color")).toEqual([BAR_COLORS.bg]);
    expect(await ruleOf(page, ".os-cdb-box", "color")).toEqual(Array(4).fill(BAR_COLORS.num));
    for (const [trait, sel, prop, value] of [
      ["os-cdb-bg", BAR, "background-color", "#1e1b4b"],
      ["os-cdb-text", BAR, "color", "#fef3c7"],
      ["os-cdb-box-bg", ".os-cdb-box", "background-color", "#111111"],
      ["os-cdb-box-border", ".os-cdb-box", "border-color", "#ff0000"],
      ["os-cdb-num", ".os-cdb-box", "color", "#22c55e"],
    ] as const) {
      await setTrait(page, BAR, trait, value);
      const values = (await ruleOf(page, sel, prop)) ?? [];
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) expect(v).toBe(value);
    }
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it("Estilo: caixas grandes ⇄ barra no mesmo lugar, com contagem, textos e cores, num passo de desfazer", async () => {
    const page = await openEditor(browser);
    await addBlock(page, "hero");
    await addBlock(page, "contador");
    await addBlock(page, "garantia");
    await setTrait(page, BIG, "data-os-minutes", "45");
    await setTrait(page, BIG, "data-os-expired", "text");
    await setTrait(page, BIG, "data-os-expired-text", "Acabou!");
    await setTrait(page, BIG, "os-cd-color", "#22c55e");
    await page.evaluate((sel) => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.getWrapper()?.find(sel)[0]?.addAttributes({ id: "oferta" });
    }, BIG);
    const before = await editorOutput(page);
    const index = () =>
      page.evaluate(() => {
        const comp = (window as unknown as EditorWindow).ed.getWrapper()?.find('[data-os-widget="countdown"]')[0];
        return { index: comp?.index(), type: comp?.get("type") };
      });
    const { index: at } = await index();

    await setTrait(page, BIG, "os-cd-style", "bar");
    await expect.poll(() => index()).toEqual({ index: at, type: "os-countdown-bar" });
    expect(await attrs(page, BAR)).toMatchObject({
      id: "oferta",
      "data-os-minutes": "45",
      "data-os-expired": "text",
      "data-os-expired-text": "Acabou!",
      "data-os-sticky": "1",
    });
    expect(
      await page.evaluate(() => {
        const ed = (window as unknown as EditorWindow).ed;
        const sel = ed.getSelected();
        return {
          selected: sel?.get("type"),
          minutes: sel?.find('[data-os-cd="m"]')[0]?.getInnerHTML(),
          msg: sel?.find(".os-cdb-msg")[0]?.getInnerHTML(),
          traits: sel?.getTraits().map((t) => t.getName()),
        };
      }),
    ).toMatchObject({
      selected: "os-countdown-bar",
      minutes: "45",
      // Sem título mudado: frase neutra (nada de percentual que não bate com o preço da página).
      msg: BAR_TEXTS.converted,
    });
    // Números com a cor trocada; o fundo das caixinhas (não trocado) fica no padrão da barra.
    expect(await ruleOf(page, ".os-cdb-box", "color")).toEqual(Array(4).fill("#22c55e"));
    expect(await ruleOf(page, ".os-cdb-box", "background-color")).toEqual(Array(4).fill(BAR_COLORS.boxBg));
    // Só um contador; as regras do antigo não ficam sobrando.
    const after = await editorOutput(page);
    expect((after.html.match(/data-os-widget="countdown"/g) ?? []).length).toBe(1);
    expect(after.css).not.toContain("min-width:76px");

    // Desfazer uma vez volta às caixas grandes, como estavam.
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed.UndoManager.undo();
    });
    expect((await index()).type).toBe("os-countdown");
    // Como estava: mesmo id (não "oferta-2"), mesmo HTML e as regras #oferta valendo.
    expect((await attrs(page, BIG)).id).toBe("oferta");
    expect(await editorOutput(page)).toEqual(before);
    expect(await canvasBox(page, BIG)).toMatchObject({ maxWidth: "560px", textAlign: "center" });
    // O painel passa para o contador que voltou (não fica no que saiu).
    expect(await page.evaluate(() => (window as unknown as EditorWindow).ed.getSelected()?.get("type"))).toBe(
      "os-countdown",
    );

    // E de volta: a frase mudada na barra vira o título das caixas.
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed.UndoManager.redo();
    });
    expect((await index()).type).toBe("os-countdown-bar");
    expect(await page.evaluate(() => (window as unknown as EditorWindow).ed.getSelected()?.get("type"))).toBe(
      "os-countdown-bar",
    );
    await page.evaluate((sel) => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.getWrapper()?.find(`${sel} .os-cdb-msg`)[0]?.components("Só hoje: 50% OFF!");
    }, BAR);
    await setTrait(page, BAR, "os-cd-style", "boxes");
    await expect.poll(async () => (await index()).type).toBe("os-countdown");
    const big = await page.evaluate((sel) => {
      const comp = (window as unknown as EditorWindow).ed.getWrapper()?.find(sel)[0];
      return {
        title: comp?.components().models[0]?.getInnerHTML(),
        minutes: comp?.find('[data-os-cd="m"]')[0]?.getInnerHTML(),
        attrs: comp?.getAttributes(),
      };
    }, BIG);
    expect(big.title).toBe("Só hoje: 50% OFF!");
    expect(big.minutes).toBe("45");
    expect(big.attrs).toMatchObject({ "data-os-expired": "text", "data-os-minutes": "45" });
    expect(big.attrs?.["data-os-sticky"]).toBeUndefined();
    expect(await ruleOf(page, ".os-cd-unit", "color")).toEqual(Array(4).fill("#22c55e"));
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it("Estilo na página reaberta: desfazer devolve o contador com o mesmo id e o visual de antes", async () => {
    const first = await openEditor(browser);
    await addBlock(first, "hero");
    await addBlock(first, "contador");
    const project = await first.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData());
    await first.close();
    const page = await openEditor(browser, { project: JSON.parse(JSON.stringify(project)) });
    const id = (await attrs(page, BIG)).id;
    expect(id).toBeTruthy();
    await page.evaluate((sel) => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.select(ed.getWrapper()?.find(sel)[0]);
    }, BIG);
    const before = await editorOutput(page);
    const look = await canvasBox(page, BIG);
    expect(look).toMatchObject({ maxWidth: "560px", textAlign: "center", marginTop: "24px" });

    await convert(page, BIG, "bar");
    expect((await attrs(page, BAR)).id).toBe(id);
    await undo(page);
    expect((await attrs(page, BIG)).id).toBe(id);
    expect(await editorOutput(page)).toEqual(before);
    expect(await canvasBox(page, BIG)).toEqual(look);
    // Refazer e desfazer de novo: continua certo.
    await redo(page);
    expect((await attrs(page, BAR)).id).toBe(id);
    await undo(page);
    expect(await editorOutput(page)).toEqual(before);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  for (const [tplId, title] of [
    ["vendas-longa", "Esta condição termina em:"],
    ["upsell", "Esta oferta expira em:"],
  ] as const) {
    it(`Estilo no contador do modelo "${tplId}": o título de fora vai junto (nada solto na seção) e a frase não inventa desconto`, async () => {
      const tpl = PAGE_TEMPLATES.find((t) => t.id === tplId)?.html ?? "";
      const page = await openEditor(browser);
      await page.evaluate((html) => {
        const w = window as unknown as EditorWindow;
        w.OS.importPageHtml(w.ed, html);
      }, prepareForEditor(tpl).html);
      const titles = () =>
        page.evaluate(
          () =>
            (window as unknown as EditorWindow).ed
              .getWrapper()
              ?.find(".os-timer")
              .map((c) => c.getInnerHTML()) ?? [],
        );
      expect(await titles()).toEqual([title]);
      // (selecionar o elemento já cria a regra #id vazia do painel Estilo, que faz o id ir para o HTML)
      await page.evaluate((sel) => {
        const ed = (window as unknown as EditorWindow).ed;
        ed.select(ed.getWrapper()?.find(sel)[0]);
      }, BIG);
      const before = await editorOutput(page);

      await convert(page, BIG, "bar");
      expect(await titles()).toEqual([]);
      const out = await editorOutput(page);
      expect(out.html).not.toContain("os-timer-box");
      expect((out.html.match(/data-os-widget="countdown"/g) ?? []).length).toBe(1);
      const msg = await page.evaluate(
        (sel) => (window as unknown as EditorWindow).ed.getWrapper()?.find(`${sel} .os-cdb-msg`)[0]?.getInnerHTML(),
        BAR,
      );
      expect(msg).toBe(BAR_TEXTS.converted);
      expect(msg).not.toContain("%");

      // Um ⌘Z traz o título e o contador grande de volta.
      await undo(page);
      expect(await titles()).toEqual([title]);
      expect(await editorOutput(page)).toEqual(before);
      expect(pageErrors(page)).toEqual([]);

      // Título mudado pelo usuário: vira a frase da barra (sem os dois-pontos).
      await page.evaluate(() => {
        (window as unknown as EditorWindow).ed.getWrapper()?.find(".os-timer")[0]?.components("Só até a meia-noite:");
      });
      await convert(page, BIG, "bar");
      expect(
        await page.evaluate(
          (sel) => (window as unknown as EditorWindow).ed.getWrapper()?.find(`${sel} .os-cdb-msg`)[0]?.getInnerHTML(),
          BAR,
        ),
      ).toBe("Só até a meia-noite");
      expect(await titles()).toEqual([]);
      await page.close();
    });
  }

  it("selo do canvas: logo abaixo da barra (não cobre as caixinhas) e, dentro de um bloco escondido, avisa que ela fica no lugar", async () => {
    const page = await openEditor(browser);
    await addBlock(page, "contador-barra");
    await addBlock(page, "hero");
    await addBlock(page, "popup-saida");
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const content = ed.Blocks.get("contador-barra")?.get("content") as never;
      ed.getWrapper()?.find('[data-os-widget="exit-popup"]')[0]?.append(content);
      const [delayed] = ed.getWrapper()?.append('<div data-os-delay="60"><p>Botão de compra</p></div>') ?? [];
      delayed?.append(content);
    });
    for (const device of ["Desktop", "Celular"]) {
      await page.evaluate((d) => {
        (window as unknown as EditorWindow).ed.setDevice(d);
      }, device);
      await page.waitForTimeout(300);
      const badges = await page.evaluate((sel) => {
        const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
        return Array.from(doc.querySelectorAll(sel)).map((el) => {
          const after = getComputedStyle(el, "::after");
          const m = new DOMMatrixReadOnly(after.transform);
          const bar = el.getBoundingClientRect();
          const boxes = Array.from(el.querySelectorAll(".os-cdb-box")).filter((b) => (b as HTMLElement).offsetParent);
          return {
            content: after.content,
            top: after.top,
            translateY: m.m42,
            height: parseFloat(after.height),
            margin: parseFloat(getComputedStyle(el).marginBottom),
            boxesInside: boxes.every((b) => b.getBoundingClientRect().bottom <= bar.bottom),
          };
        });
      }, BAR);
      expect(badges.map((b) => b.content)).toEqual([
        '"Barra fixa no topo (na página, acompanha a rolagem)"',
        '"Fica no lugar: está dentro de um bloco que nem sempre aparece (atraso, popup, quiz ou roleta)"',
        '"Fica no lugar: está dentro de um bloco que nem sempre aparece (atraso, popup, quiz ou roleta)"',
      ]);
      for (const b of badges) {
        // top:100% + 4px: o selo começa embaixo da barra (as caixinhas ficam dentro dela).
        expect(b.translateY).toBe(4);
        expect(b.boxesInside).toBe(true);
        // Espaço só do canvas para o selo não cobrir o bloco seguinte.
        expect(b.margin).toBeGreaterThanOrEqual(34);
      }
    }
    // Nada disso vai para a página.
    const { html, css } = await editorOutput(page);
    expect(html + css).not.toContain("Fica no lugar");
    expect(css).not.toContain("34px");
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it("o projeto salvo volta com a barra (mesmo tipo e HTML)", async () => {
    const first = await openEditor(browser);
    await addBlock(first, "contador-barra");
    const project = await first.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData());
    const before = await editorOutput(first);
    await first.close();
    const again = await openEditor(browser, { project: JSON.parse(JSON.stringify(project)) });
    expect(
      await again.evaluate(
        (sel) => (window as unknown as EditorWindow).ed.getWrapper()?.find(sel)[0]?.get("type"),
        BAR,
      ),
    ).toBe("os-countdown-bar");
    expect(noOrder((await editorOutput(again)).html)).toBe(noOrder(before.html));
    await again.close();
  });
});

describe("na página", () => {
  let html = "";
  beforeAll(async () => {
    html = await build();
  }, 60_000);

  it("conta e fica presa no topo ao rolar, com espaço reservado (não cobre o começo da página)", async () => {
    const site = await openSite(browser, html, { contextOptions: { viewport: { width: 1440, height: 800 } } });
    const { page } = site;
    await page.waitForTimeout(1200);
    const d = await digits(page);
    expect(d.h).toBe("00");
    expect(d.m).toBe("14");
    const state = () =>
      page.evaluate((sel) => {
        const bar = document.querySelector(sel) as HTMLElement;
        const spacer = document.querySelector(".os-top-sp") as HTMLElement;
        const next = spacer.nextElementSibling === bar ? bar.nextElementSibling : spacer.nextElementSibling;
        return {
          bar: bar.getBoundingClientRect().toJSON(),
          spacer: spacer.getBoundingClientRect().height,
          firstContent: (next as HTMLElement).getBoundingClientRect().top + scrollY,
          position: getComputedStyle(bar).position,
          z: Number(getComputedStyle(bar).zIndex),
          inBody: bar.parentElement === document.body,
        };
      }, BAR);
    const top = await state();
    expect(top.position).toBe("fixed");
    expect(top.inBody).toBe(true);
    expect(top.bar.top).toBe(0);
    expect(top.bar.width).toBe(1440);
    // Barra fina (como a da foto: ~54 px).
    expect(top.bar.height).toBeGreaterThan(40);
    expect(top.bar.height).toBeLessThan(62);
    expect(Math.abs(top.spacer - top.bar.height)).toBeLessThan(0.5);
    expect(top.firstContent).toBeGreaterThanOrEqual(top.bar.height - 0.5);
    // Abaixo do aviso de cookies, do popup de saída e da janela de pagamento.
    expect(top.z).toBeLessThan(2147482999);
    expect(top.z).toBeGreaterThan(1_000_000);

    await page.mouse.wheel(0, 1500);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(300);
    expect((await state()).bar.top).toBe(0);
    // Uma linha só no computador: frase, "TERMINA EM" e as caixinhas na mesma altura.
    const rows = await page.$$eval(`${BAR} .os-cdb-msg, ${BAR} .os-cdb-lbl, ${BAR} .os-cdb-box`, (els) =>
      els.filter((e) => (e as HTMLElement).offsetParent).map((e) => Math.round(e.getBoundingClientRect().top / 20)),
    );
    expect(new Set(rows).size).toBe(1);
    await site.context.close();
  });

  it("celular (360 e 390): compacta, sem rolagem lateral e sem nada cortado", async () => {
    for (const width of [360, 390]) {
      const site = await openSite(browser, html, {
        contextOptions: { viewport: { width, height: 740 }, isMobile: true, hasTouch: true },
      });
      const { page } = site;
      await page.waitForTimeout(300);
      const m = await page.evaluate((sel) => {
        const bar = document.querySelector(sel) as HTMLElement;
        const parts = Array.from(bar.querySelectorAll(".os-cdb-msg, .os-cdb-lbl, .os-cdb-box")).filter(
          (e) => (e as HTMLElement).offsetParent,
        );
        return {
          scroll: document.documentElement.scrollWidth,
          height: bar.getBoundingClientRect().height,
          out: parts.filter((e) => {
            const r = e.getBoundingClientRect();
            return r.left < 0 || r.right > innerWidth;
          }).length,
          wrapped: parts.some((e) => e.scrollWidth > (e as HTMLElement).clientWidth + 1),
        };
      }, BAR);
      expect(m.scroll).toBe(width);
      expect(m.out).toBe(0);
      expect(m.wrapped).toBe(false);
      expect(m.height).toBeLessThan(80);
      await site.context.close();
    }
  });

  it("ao zerar: esconde (o espaço some junto), mostra o texto, fica em 00:00:00 ou recomeça", async () => {
    const cases: Record<string, string> = { hide: "", text: "", zero: "", restart: "" };
    for (const mode of Object.keys(cases)) {
      cases[mode] = await build(
        async (page) => {
          await setTrait(page, BAR, "data-os-minutes", "1");
          await setTrait(page, BAR, "data-os-expired", mode);
          await setTrait(page, BAR, "data-os-expired-text", "Oferta encerrada!");
        },
        ["contador-barra", "hero"],
      );
    }
    const run = async (mode: string) => {
      const site = await openSite(browser, cases[mode], { clock: true });
      await site.page.clock.runFor(61_000);
      return site;
    };
    const hide = await run("hide");
    expect(await hide.page.locator(BAR).isVisible()).toBe(false);
    expect(await hide.page.$eval(".os-top-sp", (el) => el.getBoundingClientRect().height)).toBe(0);
    await hide.context.close();

    const text = await run("text");
    expect(await text.page.locator(`${BAR} .os-cd-exp`).textContent()).toBe("Oferta encerrada!");
    expect(await text.page.locator(`${BAR} [data-os-cd-units]`).isVisible()).toBe(false);
    const sizes = await text.page.evaluate(
      (sel) => ({
        bar: (document.querySelector(sel) as HTMLElement).getBoundingClientRect().height,
        spacer: (document.querySelector(".os-top-sp") as HTMLElement).getBoundingClientRect().height,
      }),
      BAR,
    );
    expect(Math.abs(sizes.bar - sizes.spacer)).toBeLessThan(0.5);
    await text.context.close();

    const zero = await run("zero");
    expect(await digits(zero.page)).toMatchObject({ h: "00", m: "00", s: "00" });
    await zero.context.close();

    const restart = await run("restart");
    const d = await digits(restart.page);
    expect(Number(d.m) * 60 + Number(d.s)).toBeGreaterThan(50);
    await restart.context.close();
  });

  it("“Fixa no topo” desligada: fica no lugar onde está, sem espaço extra", async () => {
    const off = await build(
      async (page) => {
        await setTrait(page, BAR, "data-os-sticky", false);
      },
      ["hero", "contador-barra", "depoimentos"],
    );
    const site = await openSite(browser, off);
    const { page } = site;
    await page.waitForTimeout(1200);
    const m = await page.evaluate((sel) => {
      const bar = document.querySelector(sel) as HTMLElement;
      return {
        position: getComputedStyle(bar).position,
        top: bar.getBoundingClientRect().top + scrollY,
        spacer: document.querySelectorAll(".os-top-sp").length,
        ticking: bar.querySelector('[data-os-cd="m"]')?.textContent,
      };
    }, BAR);
    expect(m.position).toBe("static");
    expect(m.top).toBeGreaterThan(200);
    expect(m.spacer).toBe(0);
    expect(m.ticking).toBe("14");
    await site.context.close();
  });

  it("dentro de um bloco que começa escondido (aparece depois de N segundos, popup de saída) fica no lugar e não aparece antes dele", async () => {
    const hidden = await build(
      async (page) => {
        await page.evaluate(() => {
          const ed = (window as unknown as EditorWindow).ed;
          const content = ed.Blocks.get("contador-barra")?.get("content") as never;
          const [delayed] =
            ed.getWrapper()?.append('<div id="atrasado" data-os-delay="60"><p>Botão de compra</p></div>') ?? [];
          delayed?.append(content);
          const [popup] = ed.getWrapper()?.append(ed.Blocks.get("popup-saida")?.get("content") as never) ?? [];
          popup?.append(content);
        });
      },
      ["hero"],
    );
    const site = await openSite(browser, hidden, { contextOptions: { viewport: { width: 390, height: 740 } } });
    const { page } = site;
    await page.waitForTimeout(1300);
    const m = await page.evaluate(
      (sel) =>
        Array.from(document.querySelectorAll(sel)).map((bar) => ({
          host: bar.parentElement?.closest("[data-os-delay],[data-os-widget=exit-popup]")?.tagName ?? null,
          inBody: bar.parentElement === document.body,
          pinned: bar.classList.contains("os-top"),
          visible: (bar as HTMLElement).getBoundingClientRect().height > 0,
        })),
      BAR,
    );
    expect(m).toHaveLength(2);
    for (const bar of m) expect(bar).toMatchObject({ inBody: false, pinned: false, visible: false });
    expect(m.every((b) => b.host)).toBe(true);
    expect(await page.locator(".os-top-sp").count()).toBe(0);
    await site.context.close();
  });

  it("links #seção e a volta do quiz param logo abaixo da barra (não ficam embaixo dela)", async () => {
    const quizHtml = (await build(undefined, ["contador-barra", "hero", "quiz", "depoimentos"])).replace(
      /<\/body>/i,
      '<section id="alvo" style="margin-top:1600px;height:900px"><h2>Oferta especial</h2></section></body>',
    );
    const site = await openSite(browser, quizHtml, {
      contextOptions: {
        viewport: { width: 390, height: 740 },
        isMobile: true,
        hasTouch: true,
        reducedMotion: "reduce",
      },
    });
    const { page } = site;
    await page.waitForTimeout(300);
    const barBottom = await page.$eval(BAR, (el) => el.getBoundingClientRect().bottom);
    expect(await page.evaluate(() => document.documentElement.style.scrollPaddingTop)).toBe(
      `${await page.$eval(".os-top-sp", (el) => el.getBoundingClientRect().height)}px`,
    );
    // Link para uma seção: o título fica visível, abaixo da barra.
    await page.evaluate(() => {
      location.hash = "#alvo";
    });
    await expect.poll(() => page.$eval("#alvo", (el) => el.getBoundingClientRect().top)).toBeGreaterThan(0);
    const target = await page.$eval("#alvo h2", (el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, hit: document.elementFromPoint(r.left + 5, r.top + r.height / 2)?.tagName };
    });
    expect(target.top).toBeGreaterThanOrEqual(barBottom - 0.5);
    expect(target.hit).toBe("H2");

    // Quiz: com o topo dele atrás da barra, responder volta para logo abaixo dela.
    await page.$eval('[data-os-widget="quiz"]', (quiz) => {
      scrollTo(0, quiz.getBoundingClientRect().top + scrollY - 30);
    });
    expect(await page.$eval('[data-os-widget="quiz"]', (el) => el.getBoundingClientRect().top)).toBeLessThan(barBottom);
    await page.locator(".os-qz-cur [data-os-qz-option]").first().click();
    await expect
      .poll(() => page.$eval('[data-os-widget="quiz"]', (el) => el.getBoundingClientRect().top))
      .toBeGreaterThanOrEqual(barBottom);
    expect(await page.$eval('[data-os-widget="quiz"]', (el) => el.getBoundingClientRect().top)).toBeLessThan(
      barBottom + 20,
    );
    await site.context.close();
  });

  it("o espaço do topo se refaz quando a barra aparece pelo atraso ou a fonte chega depois, com a contagem já parada", async () => {
    // Visitante que volta depois dos 15 minutos: a contagem já acabou ("Fica em 00:00:00").
    const expired = { init: `try{localStorage.setItem("os-cd:/oferta:15","1")}catch(e){}` };
    const fit = (page: Page) =>
      page.evaluate((sel) => {
        const bar = document.querySelector(sel) as HTMLElement;
        return {
          bar: bar.getBoundingClientRect().height,
          spacer: (document.querySelector(".os-top-sp") as HTMLElement).getBoundingClientRect().height,
          digits: Array.from(bar.querySelectorAll("[data-os-cd]")).map((n) => n.textContent),
        };
      }, BAR);

    // A barra aparece depois de 2 segundos (os:revealed).
    const delayed = html.replace('data-os-cd-style="bar"', 'data-os-cd-style="bar" data-os-delay="2"');
    expect(delayed).not.toBe(html);
    const late = await openSite(browser, delayed, expired);
    await late.page.waitForTimeout(400);
    expect((await fit(late.page)).bar).toBe(0);
    await late.page.waitForTimeout(2200);
    const shown = await fit(late.page);
    expect(shown.digits.slice(1)).toEqual(["00", "00", "00"]);
    expect(shown.bar).toBeGreaterThan(40);
    expect(Math.abs(shown.spacer - shown.bar)).toBeLessThan(0.5);
    await late.context.close();

    // Fonte da página que chega 1,5 s depois e faz a frase quebrar em mais linhas.
    const font = readFileSync(
      path.join(process.cwd(), "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"),
    );
    const withFont = html.replace(
      /<\/head>/i,
      '<style>@font-face{font-family:Lenta;src:url(/lenta.woff2) format("woff2");font-display:swap;size-adjust:260%}' +
        ".os-cdb-msg{font-family:Lenta,sans-serif!important}</style></head>",
    );
    const context = await browser.newContext({ viewport: { width: 390, height: 740 } });
    await context.addInitScript({ content: expired.init });
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.endsWith("/lenta.woff2")) {
        await new Promise((r) => setTimeout(r, 1500));
        return route.fulfill({ contentType: "font/woff2", body: font });
      }
      if (url === "http://site.test/oferta")
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: withFont });
      return route.fulfill({ status: 204, body: "" });
    });
    await page.goto("http://site.test/oferta", { waitUntil: "commit" });
    await page.waitForTimeout(500);
    const early = await fit(page);
    await page.waitForTimeout(2500);
    const after = await fit(page);
    expect(after.bar).toBeGreaterThan(early.bar + 10);
    expect(Math.abs(after.spacer - after.bar)).toBeLessThan(0.5);
    await context.close();
  });

  it("sem JavaScript: a barra aparece com o tempo de exemplo, no lugar", async () => {
    const site = await openSite(browser, html, { contextOptions: { javaScriptEnabled: false } });
    const { page } = site;
    expect(await page.locator(BAR).isVisible()).toBe(true);
    expect(await digits(page)).toMatchObject({ h: "00", m: "15", s: "00" });
    expect(await page.$eval(`${BAR} [data-os-cd-unit="d"]`, (el) => getComputedStyle(el).display)).toBe("none");
    expect(await page.$eval(BAR, (el) => getComputedStyle(el).position)).toBe("static");
    expect(await page.$eval(BAR, (el) => getComputedStyle(el).backgroundColor)).toBe("rgb(0, 0, 0)");
    await site.context.close();
  });
});
