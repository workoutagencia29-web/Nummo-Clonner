/**
 * Fase 3 — quarta rodada de correções, no Chromium de verdade (harness E2):
 * - Duplicar um elemento cujo id precisa de escape no CSS ("1", "2passos",
 *   "a.b"): a edição da cópia vai para a página final (não só para o canvas);
 * - <meta name="color-scheme"> do <head> vale no canvas como na página final;
 *   um <meta> dentro de um texto editado volta como <meta> (e o http-equiv
 *   continua inerte no canvas);
 * - Duplicar um repetido que já tem data-os-eid próprio: a cópia não divide a
 *   marca com ele;
 * - #49: um valor só herdado (o tamanho de letra do body), ou que só acompanha a
 *   letra do próprio elemento (line-height, letter-spacing, margens em em), não
 *   é "valor do celular" — a edição do Desktop vale no celular também;
 * - #49 × Tablet: faixas só de tablet não viram regra (nem aviso), e os
 *   breakpoints que vêm antes da regra do Tablet (Elementor 1024px) ficam como
 *   estão — o tablet mantém o valor original, e a edição do Tablet vence nele.
 */
import * as cheerio from "cheerio";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAGE_TEMPLATES } from "@/editor/templates";
import { finalizeFromEditor, linkBaseStylesheet, prepareForEditor } from "@/lib/editor-html";
import { baseSheet, type E2Window, ORIGIN, openApp, pageWithBase, toasts } from "./fix3-E2-harness";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

type Files = Record<string, string>;

const KEPT_TOAST = "Mudou no computador. No celular, este elemento continua como na página original.";

/** Muda uma propriedade pelo painel de estilo, como o usuário (campo + change). */
async function setStyle(page: Page, property: string, value: string, parent?: string) {
  await page.evaluate(
    async ([prop, val, par]) => {
      const scope = par ? `#styles .gjs-sm-property__${par} ` : "#styles ";
      const input = document.querySelector<HTMLInputElement>(`${scope}.gjs-sm-property__${prop} input`);
      if (!input) throw new Error(`campo ${prop} não encontrado`);
      input.value = val;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
    },
    [property, value, parent ?? ""] as const,
  );
}

async function selectWhere(page: Page, selector: string, index = 0) {
  await page.evaluate(
    async ([sel, i]) => {
      const ed = (window as unknown as E2Window).ed;
      const found = ed.getWrapper()?.find(sel as string)[i as number];
      if (!found) throw new Error(`elemento ${sel} não encontrado`);
      ed.select(found as never);
      await new Promise((r) => setTimeout(r, 150));
    },
    [selector, index] as const,
  );
}

async function setDevice(page: Page, device: string) {
  await page.evaluate(async (d) => {
    const ed = (window as unknown as E2Window).ed;
    ed.setDevice(d);
    await new Promise((r) => setTimeout(r, 500));
  }, device);
}

async function duplicate(page: Page) {
  await page.evaluate(async () => {
    (window as unknown as E2Window).ed.runCommand("tlb-clone");
    await new Promise((r) => setTimeout(r, 300));
  });
}

/** Valor calculado de uma propriedade em cada elemento do canvas. */
function canvasAll(page: Page, selector: string, prop: string) {
  return page.evaluate(
    ([sel, p]) => {
      const ed = (window as unknown as E2Window).ed;
      const doc = ed.Canvas.getDocument() as Document;
      return Array.from(doc.querySelectorAll(sel)).map((el) =>
        ed.Canvas.getWindow().getComputedStyle(el).getPropertyValue(p),
      );
    },
    [selector, prop] as const,
  );
}

function exportDoc(page: Page) {
  return page.evaluate(() => {
    const ed = (window as unknown as E2Window).ed;
    return { html: ed.getHtml({ asDocument: true } as never), css: ed.getCss({ avoidProtected: true }) ?? "" };
  });
}

function projectOf(page: Page) {
  return page.evaluate(() => {
    const { assets: _assets, ...project } = (window as unknown as E2Window).ed.getProjectData() as Record<
      string,
      unknown
    >;
    return project;
  });
}

/** Página final (HTML de finalizeFromEditor) aberta numa largura: valor da propriedade em cada elemento. */
async function finalAll(files: Files, html: string, width: number, selector: string, prop: string) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  try {
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/p") return route.fulfill({ contentType: "text/html", body: html });
      const file = files[url.pathname];
      if (file !== undefined) return route.fulfill({ contentType: "text/css", body: file });
      return route.fulfill({ status: 204, body: "" });
    });
    await page.goto(`${ORIGIN}/p`);
    return await page.evaluate(
      ([sel, p]) => Array.from(document.querySelectorAll(sel)).map((el) => getComputedStyle(el).getPropertyValue(p)),
      [selector, prop] as const,
    );
  } finally {
    await page.close();
  }
}

/** Página guardada → o que o editor recebe (prepareForEditor + folha base), com o CSS em /os-assets/. */
function forEditor(stored: string) {
  const prepared = prepareForEditor(stored);
  const files: Files = {};
  const hrefs = prepared.styles.map((style, i) => {
    const href = `/os-assets/s${i}.css`;
    files[href] = style.text ?? "";
    return href;
  });
  files["/os-assets/base.css"] = baseSheet(hrefs);
  return { html: linkBaseStylesheet(prepared.html, "/os-assets/base.css"), files };
}

function theme(css: string): Files {
  return { "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]), "/os-assets/theme.css": css };
}

const keptToasts = async (page: Page) => (await toasts(page)).filter((t) => t.message === KEPT_TOAST).length;

// ─── Duplicar × id que precisa de escape no CSS ──────────────────────────────

describe("Duplicar um elemento cujo id precisa de escape no CSS", () => {
  for (const [id, escaped] of [
    ["1", "\\31 "],
    ["2passos", "\\32 passos"],
    ["a.b", "a\\.b"],
  ] as const) {
    it(`id "${id}": a cor dada à cópia aparece na página final como no canvas`, async () => {
      const files = theme(`#${escaped}{color:rgb(0, 128, 0);padding:7px}`);
      const s = await openApp(browser, {
        html: pageWithBase(`<div id="${id}" class="bx">Caixa</div><p>fim</p>`),
        files,
      });
      try {
        await selectWhere(s.page, "div.bx");
        await duplicate(s.page);
        await selectWhere(s.page, "div.bx", 1);
        await setStyle(s.page, "color", "rgb(0, 0, 255)");
        const canvas = await canvasAll(s.page, "div.bx", "color");
        expect(canvas).toEqual(["rgb(0, 128, 0)", "rgb(0, 0, 255)"]);
        const out = await exportDoc(s.page);
        const final = finalizeFromEditor(out.html, out.css);
        expect(await finalAll(files, final, 1280, "div.bx", "color")).toEqual(canvas);
        expect(await finalAll(files, final, 1280, "div.bx", "padding-top")).toEqual(["7px", "7px"]);
        const $ = cheerio.load(final);
        expect(
          $("div.bx")
            .map((_, el) => $(el).attr("id"))
            .get(),
        ).toEqual([id, id]);
        expect(s.errors).toEqual([]);
      } finally {
        await s.page.close();
      }
    });
  }
});

// ─── <meta> ──────────────────────────────────────────────────────────────────

describe("<meta> no canvas", () => {
  it("color-scheme do <head> vale no canvas como na página final", async () => {
    const stored = `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><title>x</title>
<style>.p{font-size:20px}</style></head><body><p class="p" id="p">Texto</p></body></html>`;
    const { html, files } = forEditor(stored);
    const s = await openApp(browser, { html, files });
    try {
      const canvas = await canvasAll(s.page, "#p", "color");
      const out = await exportDoc(s.page);
      const final = finalizeFromEditor(out.html, out.css, stored);
      expect(final).toContain('<meta name="color-scheme" content="dark">');
      const page = await finalAll(files, final, 1280, "#p", "color");
      expect(page).toEqual(["rgb(255, 255, 255)"]);
      expect(canvas).toEqual(page);
    } finally {
      await s.page.close();
    }
  });

  it("texto com <meta> dentro, editado: os <meta> voltam na página final; o http-equiv segue inerte no canvas", async () => {
    const body =
      `<div itemscope itemtype="https://schema.org/Product"><p id="p">Compre <a href="https://x.test/c" itemprop="url">aqui` +
      `<meta itemprop="priceCurrency" content="BRL"></a> agora <b>já<meta http-equiv="refresh" content="1;url=http://evil.example/x"></b></p></div>`;
    const s = await openApp(browser, { html: pageWithBase(body), files: { "/os-assets/base.css": "" } });
    try {
      const state = await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
        const p = ed.getWrapper()?.find("#p")[0];
        ed.select(p as never);
        await wait(100);
        const view = p?.getView() as unknown as {
          onActive(e?: unknown): void;
          disableEditing(): Promise<void>;
          getChildrenContainer(): HTMLElement;
        };
        view.onActive({});
        await wait(200);
        const el = view.getChildrenContainer();
        el.insertBefore(el.ownerDocument.createTextNode("Oi! "), el.firstChild);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        await view.disableEditing();
        await wait(300);
        const doc = ed.Canvas.getDocument() as Document;
        return {
          html: p?.toHTML() ?? "",
          liveRefresh: doc.querySelectorAll("body meta[http-equiv]").length,
          inert: doc.querySelectorAll("body os-meta").length,
          itemprop: doc.querySelectorAll("body meta[itemprop]").length,
        };
      });
      expect(state.html).toContain("Oi! ");
      expect(state.html).not.toContain("os-meta");
      expect(state).toMatchObject({ liveRefresh: 0, inert: 1, itemprop: 1 });
      await s.page.waitForTimeout(1300);
      expect(s.external.filter((u) => u.includes("evil.example"))).toEqual([]);
      const out = await exportDoc(s.page);
      const final = finalizeFromEditor(out.html, out.css);
      const $ = cheerio.load(final);
      expect($('a[itemprop="url"] meta[itemprop="priceCurrency"]').attr("content")).toBe("BRL");
      expect($('b meta[http-equiv="refresh"]').attr("content")).toBe("1;url=http://evil.example/x");
      expect(final).not.toContain("os-meta");
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

// ─── Duplicar × data-os-eid vindo da página ──────────────────────────────────

describe("Duplicar um repetido que já tem data-os-eid próprio (página do Offer Studio importada de novo)", () => {
  it("a cor da cópia é só dela (canvas e página final); o original continua como era", async () => {
    const stored = `<!doctype html><html><head><meta charset="utf-8"><title>x</title>
<style>#comprar{background:rgb(0, 128, 0)} #comprar[data-os-eid="i7jo1"]{background:rgb(0, 0, 255)}</style></head><body>
<a id="comprar" href="#">A</a> <a id="comprar" data-os-eid="i7jo1" href="#">B</a>
</body></html>`;
    const { html, files } = forEditor(stored);
    const s = await openApp(browser, { html, files });
    try {
      await selectWhere(s.page, "a", 1);
      await duplicate(s.page);
      await selectWhere(s.page, "a", 2);
      await setStyle(s.page, "background-color", "rgb(255, 0, 0)");
      const canvas = await canvasAll(s.page, "a", "background-color");
      expect(canvas).toEqual(["rgb(0, 128, 0)", "rgb(0, 0, 255)", "rgb(255, 0, 0)"]);
      const out = await exportDoc(s.page);
      const final = finalizeFromEditor(out.html, out.css, stored);
      expect(await finalAll(files, final, 1280, "a", "background-color")).toEqual(canvas);
      const $ = cheerio.load(final);
      const eids = $("a")
        .map((_, el) => $(el).attr("data-os-eid") ?? "")
        .get();
      expect(eids[1]).toBe("i7jo1");
      expect(eids[2]).not.toBe("i7jo1");
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

// ─── #49: valores que não são "do celular" ───────────────────────────────────

describe("#49 valor só herdado ou que só acompanha a letra: a edição do Desktop vale no celular", () => {
  const tpl = PAGE_TEMPLATES.find((t) => t.id === "vendas-longa");

  for (const [name, selector, prop, value, parent] of [
    ["parágrafo comum: tamanho da letra", "section p:not([class])", "font-size", "24px", undefined],
    ["parágrafo comum: margem de baixo", "section p:not([class])", "margin-bottom", "40px", "margin"],
    ["subtítulo (h2 clamp): margem de baixo", ".os-h2", "margin-bottom", "40px", "margin"],
    ["título (h1 clamp): altura da linha", "h1", "line-height", "1.5", undefined],
    ["título (h1 clamp): espaço entre letras", "h1", "letter-spacing", "2px", undefined],
    ["título (h1 clamp): margem de baixo", "h1", "margin-bottom", "4px", "margin"],
  ] as const) {
    it(`modelo 'vendas-longa', ${name}`, async () => {
      const { html, files } = forEditor(tpl?.html ?? "");
      const s = await openApp(browser, { html, files });
      try {
        await selectWhere(s.page, selector);
        const mark = await s.page.evaluate(() => {
          const ed = (window as unknown as E2Window).ed;
          const c = ed.getSelected();
          c?.addAttributes({ "data-teste": "alvo" });
          return c?.getId() ?? "";
        });
        await setStyle(s.page, prop, value, parent);
        const out = await exportDoc(s.page);
        expect(out.css).not.toContain(`:is(#${mark})`);
        expect(await keptToasts(s.page)).toBe(0);
        const final = finalizeFromEditor(out.html, out.css);
        const expected = prop === "line-height" ? undefined : value;
        const at390 = await finalAll(files, final, 390, "[data-teste]", prop);
        const at1280 = await finalAll(files, final, 1280, "[data-teste]", prop);
        if (expected) {
          expect(at390).toEqual([expected]);
          expect(at1280).toEqual([expected]);
        } else {
          // line-height 1.5 × a letra de cada largura.
          const size390 = Number.parseFloat((await finalAll(files, final, 390, "[data-teste]", "font-size"))[0]);
          expect(Number.parseFloat(at390[0])).toBeCloseTo(size390 * 1.5, 1);
        }
        await setDevice(s.page, "mobile");
        const canvas = await canvasAll(s.page, "[data-teste]", prop);
        const final375 = await finalAll(files, final, 375, "[data-teste]", prop);
        expect(canvas).toEqual(final375);
        expect(s.errors).toEqual([]);
      } finally {
        await s.page.close();
      }
    });
  }

  it("página clonada: line-height sem unidade e padding em em com a letra mudando no celular", async () => {
    const files = theme(
      ".title{font-size:48px;line-height:1.2} .btn{font-size:20px;padding:.8em 1.6em;display:inline-block}" +
        " @media(max-width:767px){.title{font-size:28px} .btn{font-size:16px}}",
    );
    const s = await openApp(browser, {
      html: pageWithBase(`<h1 id="t" class="title">T</h1><a id="b" class="btn" href="#">Comprar</a>`),
      files,
    });
    try {
      await selectWhere(s.page, "#t");
      await setStyle(s.page, "line-height", "1.5");
      await selectWhere(s.page, "#b");
      await setStyle(s.page, "padding-top", "30px", "padding");
      const out = await exportDoc(s.page);
      expect(out.css).not.toContain(":is(");
      expect(await keptToasts(s.page)).toBe(0);
      const final = finalizeFromEditor(out.html, out.css);
      expect(await finalAll(files, final, 390, "#t", "line-height")).toEqual(["42px"]);
      expect(await finalAll(files, final, 390, "#b", "padding-top")).toEqual(["30px"]);

      // O tamanho da letra, que o original muda no celular, continua mantido.
      await selectWhere(s.page, "#t");
      await setStyle(s.page, "font-size", "60px");
      expect(await keptToasts(s.page)).toBe(1);
      const again = await exportDoc(s.page);
      const final2 = finalizeFromEditor(again.html, again.css);
      expect(await finalAll(files, final2, 390, "#t", "font-size")).toEqual(["28px"]);
      expect(await finalAll(files, final2, 1280, "#t", "font-size")).toEqual(["60px"]);
    } finally {
      await s.page.close();
    }
  });

  it("reset de CSS (font: inherit; font-size: 100%) não conta como valor próprio do elemento", async () => {
    const files = theme(
      "html,body,p,h2{margin:0;padding:0;font:inherit;font-size:100%} body{font-size:18px;line-height:1.5}" +
        " @media (max-width:767px){body{font-size:15px}}",
    );
    const s = await openApp(browser, { html: pageWithBase(`<p id="p">Texto</p>`), files });
    try {
      await selectWhere(s.page, "#p");
      await setStyle(s.page, "font-size", "24px");
      const out = await exportDoc(s.page);
      expect(out.css).not.toContain(":is(");
      expect(await keptToasts(s.page)).toBe(0);
      const final = finalizeFromEditor(out.html, out.css);
      expect(await finalAll(files, final, 390, "#p", "font-size")).toEqual(["24px"]);
    } finally {
      await s.page.close();
    }
  });
});

// ─── #49 × Tablet ────────────────────────────────────────────────────────────

describe("#49 × faixa só do tablet no original", () => {
  for (const range of ["(min-width:768px) and (max-width:991.98px)", "(min-width:768px) and (max-width:1199.98px)"]) {
    it(`${range}: nenhuma regra que nunca vale, nenhum aviso; o celular recebe a edição`, async () => {
      const files = theme(`.t{font-size:48px} @media ${range}{.t{font-size:36px}}`);
      const s = await openApp(browser, { html: pageWithBase(`<h1 id="t" class="t">Título</h1>`), files });
      try {
        await selectWhere(s.page, "#t");
        await setStyle(s.page, "font-size", "60px");
        const out = await exportDoc(s.page);
        expect(out.css).not.toContain(":is(");
        expect(await keptToasts(s.page)).toBe(0);
        const final = finalizeFromEditor(out.html, out.css);
        expect(await finalAll(files, final, 390, "h1", "font-size")).toEqual(["60px"]);
        expect(await finalAll(files, final, 1280, "h1", "font-size")).toEqual(["60px"]);
      } finally {
        await s.page.close();
      }
    });
  }
});

describe("#49 × breakpoints do Elementor (tablet 1024px, celular 767px)", () => {
  const files = theme(
    ".elementor-12 .elementor-element-abc .elementor-heading-title{font-size:48px}" +
      "@media(max-width:1024px){.elementor-12 .elementor-element-abc .elementor-heading-title{font-size:36px}}" +
      "@media(max-width:767px){.elementor-12 .elementor-element-abc .elementor-heading-title{font-size:28px}}",
  );
  const BODY = `<div class="elementor-12"><div class="elementor-element elementor-element-abc"><h2 id="t" class="elementor-heading-title">Título</h2></div></div>`;
  const sizes = async (final: string) =>
    Object.fromEntries(
      await Promise.all(
        [390, 800, 1000, 1280].map(async (w) => [w, (await finalAll(files, final, w, "h2", "font-size"))[0]] as const),
      ),
    );

  it("Desktop: o tablet e o celular continuam com o valor original; a edição do Tablet vence no tablet", async () => {
    const s = await openApp(browser, { html: pageWithBase(BODY), files });
    let project: unknown;
    try {
      await selectWhere(s.page, "#t");
      await setStyle(s.page, "font-size", "60px");
      expect(await keptToasts(s.page)).toBe(1);
      let out = await exportDoc(s.page);
      // Uma regra só: a do tablet (1024px) já cobre o celular.
      expect(out.css.match(/:is\(#t\)/g)).toHaveLength(1);
      expect(out.css).toContain("@media (max-width: 1024px){:is(#t){font-size:revert-layer;}}");
      expect(await sizes(finalizeFromEditor(out.html, out.css))).toEqual({
        390: "28px",
        800: "36px",
        1000: "36px",
        1280: "60px",
      });
      await setDevice(s.page, "tablet");
      expect(await canvasAll(s.page, "h2", "font-size")).toEqual(["36px"]);

      await selectWhere(s.page, "#t");
      await setStyle(s.page, "font-size", "40px");
      expect(await canvasAll(s.page, "h2", "font-size")).toEqual(["40px"]);
      await setDevice(s.page, "mobile");
      expect(await canvasAll(s.page, "h2", "font-size")).toEqual(["28px"]);
      out = await exportDoc(s.page);
      expect(await sizes(finalizeFromEditor(out.html, out.css))).toEqual({
        390: "28px",
        800: "40px",
        1000: "36px",
        1280: "60px",
      });
      project = await projectOf(s.page);
    } finally {
      await s.page.close();
    }

    // Reaberto: a regra de 1024px não é trocada ao abrir.
    const again = await openApp(browser, { project, files });
    try {
      const css = (await exportDoc(again.page)).css;
      expect(css).toContain("@media (max-width: 1024px){:is(#t){font-size:revert-layer;}}");
      await setDevice(again.page, "tablet");
      expect(await canvasAll(again.page, "h2", "font-size")).toEqual(["40px"]);
    } finally {
      await again.page.close();
    }
  });

  it("projeto gravado antes: a regra de 1024px fica; a que só valia no tablet (nunca vale) sai ao abrir", async () => {
    const OLD_EDITS =
      "#t{font-size:60px;}" +
      "@media (max-width: 1024px){:is(#t){font-size:revert-layer;}}" +
      "@media (max-width: 767.98px) and (min-width: 768px) and (max-width: 991.98px){:is(#t){color:revert-layer;}}";
    const html = pageWithBase(BODY).replace("</head>", `<style data-os-edits>${OLD_EDITS}</style></head>`);
    const first = await openApp(browser, { html, files });
    let project: unknown;
    try {
      project = await projectOf(first.page);
    } finally {
      await first.page.close();
    }
    const s = await openApp(browser, { project, files });
    try {
      const css = (await exportDoc(s.page)).css;
      expect(css).toContain("@media (max-width: 1024px){:is(#t){font-size:revert-layer;}}");
      expect(css).not.toContain("min-width: 768px");
      await setDevice(s.page, "tablet");
      expect(await canvasAll(s.page, "h2", "font-size")).toEqual(["36px"]);
      expect(await s.page.evaluate(() => (window as unknown as E2Window).ed.UndoManager.hasUndo())).toBe(false);
    } finally {
      await s.page.close();
    }
  });
});
