/**
 * Fase 3 — terceira rodada de correções, no Chromium de verdade (harness E2):
 * - <meta http-equiv="refresh"> no <body> da página não leva o canvas embora
 *   (importada, ou num projeto gravado antes);
 * - Duplicar um elemento com id da página: a cópia fica com o CSS #id da página;
 * - excluir um elemento apaga as regras que mantêm o valor do celular dele;
 * - #49: valor do celular que vem de variável CSS, clamp()/vw ou herança;
 * - #49 × Tablet: com breakpoints entre 768 e 992px (Bootstrap, Divi), a regra
 *   que mantém o celular não passa por cima da edição do Tablet (phoneKeepMedia);
 * - Duplicar um botão ligado a um link da oferta: a cópia tem o campo de
 *   endereço de volta ao desligar o link.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { phoneKeepMedia, withoutCovered } from "@/editor/grapes/original-css";
import { PAGE_TEMPLATES } from "@/editor/templates";
import { mediaOrder } from "@/lib/css-keep";
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
async function setStyle(page: Page, property: string, value: string) {
  await page.evaluate(
    async ([prop, val]) => {
      const input = document.querySelector<HTMLInputElement>(`#styles .gjs-sm-property__${prop} input`);
      if (!input) throw new Error(`campo ${prop} não encontrado`);
      input.value = val;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 150));
    },
    [property, value] as const,
  );
}

async function selectWhere(page: Page, selector: string, index = 0) {
  await page.evaluate(
    async ([sel, i]) => {
      const ed = (window as unknown as E2Window).ed;
      ed.select(ed.getWrapper()?.find(sel as string)[i as number] as never);
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

async function run(page: Page, command: string) {
  await page.evaluate(async (cmd) => {
    const ed = (window as unknown as E2Window).ed;
    if (cmd === "undo") ed.UndoManager.undo();
    else if (cmd === "redo") ed.UndoManager.redo();
    else ed.runCommand(cmd);
    await new Promise((r) => setTimeout(r, 200));
  }, command);
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

/** Site clonado do Elementor (tests/fixtures/sites/vendas), com as folhas (e os @import delas) em `files`. */
function elementorFixture() {
  const dir = path.resolve(import.meta.dirname, "../fixtures/sites/vendas");
  const read = (file: string) => readFileSync(path.join(dir, file), "utf8").replaceAll("__ORIGIN__", ORIGIN);
  const prepared = prepareForEditor(read("index.html"));
  const files: Files = {};
  const addSheet = (href: string) => {
    const pathname = new URL(href, `${ORIGIN}/`).pathname;
    if (pathname in files) return pathname;
    let text = "";
    try {
      text = read(pathname);
    } catch {
      // Folha que o site não tem: fica vazia.
    }
    files[pathname] = text;
    for (const m of text.matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)/g)) {
      addSheet(new URL(m[1], `${ORIGIN}${pathname}`).href);
    }
    return pathname;
  };
  const hrefs = prepared.styles.map((style, i) => {
    if (style.kind === "link" && style.href) return addSheet(style.href);
    const href = `/os-assets/inline${i}.css`;
    files[href] = style.text ?? "";
    return href;
  });
  files["/os-assets/base.css"] = baseSheet(hrefs);
  return { html: linkBaseStylesheet(prepared.html, "/os-assets/base.css"), files };
}

// ─── <meta http-equiv> no <body> ─────────────────────────────────────────────

describe("<meta http-equiv='refresh'> no corpo da página", () => {
  const STORED = `<!doctype html><html><head><meta charset="utf-8"><title>x</title></head><body>
<section><h1>Oferta</h1><meta http-equiv="refresh" content="1;url=http://evil.example/landing"><p>texto</p></section>
</body></html>`;

  async function canvasState(page: Page) {
    return page.evaluate(() => {
      const ed = (window as unknown as E2Window).ed;
      const doc = ed.Canvas.getDocument() as Document;
      // Se o canvas tivesse ido para outro site, ler o endereço dele daria erro.
      const url = ed.Canvas.getWindow().location.href;
      return {
        away: !url.startsWith(location.origin) && url !== "about:blank",
        h1: doc.querySelector("h1")?.textContent ?? null,
        metas: doc.querySelectorAll("body meta").length,
      };
    });
  }

  it("não leva o canvas para outro site (importada e reaberta do projeto); a página final mantém o meta", async () => {
    const { html, files } = forEditor(STORED);
    const s = await openApp(browser, { html, files });
    let project: unknown;
    try {
      await s.page.waitForTimeout(1600);
      expect(await canvasState(s.page)).toEqual({ away: false, h1: "Oferta", metas: 0 });
      expect(s.external.filter((u) => u.includes("evil.example"))).toEqual([]);
      const out = await exportDoc(s.page);
      const $ = cheerio.load(finalizeFromEditor(out.html, out.css, STORED));
      expect($('meta[http-equiv="refresh"]').attr("content")).toBe("1;url=http://evil.example/landing");
      project = await projectOf(s.page);
    } finally {
      await s.page.close();
    }

    // Projeto gravado (inclusive por uma versão antiga do editor) com o meta no corpo.
    const again = await openApp(browser, { project, files });
    try {
      await again.page.waitForTimeout(1600);
      expect(await canvasState(again.page)).toEqual({ away: false, h1: "Oferta", metas: 0 });
      expect(again.external.filter((u) => u.includes("evil.example"))).toEqual([]);

      // HTML colado ou digitado no código do elemento: o mesmo.
      await again.page.evaluate(() => {
        const ed = (window as unknown as E2Window).ed;
        ed.getWrapper()?.append('<div><meta http-equiv="refresh" content="0;url=http://evil.example/colado"></div>');
      });
      await again.page.waitForTimeout(600);
      expect(await canvasState(again.page)).toEqual({ away: false, h1: "Oferta", metas: 0 });
      expect(again.external.filter((u) => u.includes("evil.example"))).toEqual([]);
      expect(again.errors).toEqual([]);
    } finally {
      await again.page.close();
    }
  });
});

// ─── Duplicar × id da página ─────────────────────────────────────────────────

describe("Duplicar um elemento com id que o CSS da página usa", () => {
  const files: Files = {
    "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
    "/os-assets/theme.css":
      "#oferta{padding:20px} #comprar{background-color:rgb(0, 128, 0);color:rgb(255, 255, 255)}" +
      " .titulo{font-size:30px}",
  };
  const BODY = `<section id="oferta"><h2 id="t1" class="titulo">Oferta</h2><a id="comprar" href="https://pay.test/x">Comprar</a></section><p id="texto">fim</p>`;

  it("a cópia continua com o CSS #id da página (canvas e página final); a edição da cópia é só dela", async () => {
    const s = await openApp(browser, { html: pageWithBase(BODY), files });
    try {
      await selectWhere(s.page, "#oferta");
      await run(s.page, "tlb-clone");
      expect(await canvasAll(s.page, "section", "padding-top")).toEqual(["20px", "20px"]);
      expect(await canvasAll(s.page, "section a", "background-color")).toEqual(["rgb(0, 128, 0)", "rgb(0, 128, 0)"]);

      // Editar a cópia não muda o original.
      await selectWhere(s.page, "section", 1);
      await setStyle(s.page, "padding-top", "50px");
      expect(await canvasAll(s.page, "section", "padding-top")).toEqual(["20px", "50px"]);

      // Um id que o CSS da página não usa fica com o nome do GrapesJS.
      await selectWhere(s.page, "#texto");
      await run(s.page, "tlb-clone");
      const pIds = await s.page.evaluate(() =>
        ((window as unknown as E2Window).ed.getWrapper()?.find("p") ?? []).map((c) => c.getAttributes().id),
      );
      expect(pIds).toEqual(["texto", "texto-2"]);

      const out = await exportDoc(s.page);
      const final = finalizeFromEditor(out.html, out.css);
      const $ = cheerio.load(final);
      expect(
        $("section")
          .map((_, el) => $(el).attr("id"))
          .get(),
      ).toEqual(["oferta", "oferta"]);
      expect(
        $("section a")
          .map((_, el) => $(el).attr("id"))
          .get(),
      ).toEqual(["comprar", "comprar"]);
      expect(await finalAll(files, final, 1280, "section", "padding-top")).toEqual(["20px", "50px"]);
      expect(await finalAll(files, final, 1280, "section a", "background-color")).toEqual([
        "rgb(0, 128, 0)",
        "rgb(0, 128, 0)",
      ]);

      // Desfazer tudo: volta a uma seção só.
      await run(s.page, "undo");
      await run(s.page, "undo");
      await run(s.page, "undo");
      expect(await canvasAll(s.page, "section", "padding-top")).toEqual(["20px"]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

// ─── Regras que mantêm o celular × excluir ───────────────────────────────────

describe("#49 excluir o elemento apaga a regra que mantém o valor do celular", () => {
  const files: Files = {
    "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
    "/os-assets/theme.css": ".title{font-size:48px} @media (max-width:767px){.title{font-size:24px}}",
  };

  it("excluir (também a cópia de Duplicar); desfazer traz de volta; projeto antigo com regra órfã é limpo", async () => {
    const s = await openApp(browser, {
      html: pageWithBase(`<h1 id="t1" class="title">Título</h1><p id="p">x</p>`),
      files,
    });
    let orphanProject: Record<string, unknown>;
    try {
      await selectWhere(s.page, "#t1");
      await setStyle(s.page, "font-size", "60px");
      await run(s.page, "tlb-clone");
      const before = (await exportDoc(s.page)).css;
      expect(before).toContain(":is(#t1){font-size:revert-layer;}");
      expect(before).toContain(":is(#t1-2){font-size:revert-layer;}");

      // O projeto de antes desta correção: a regra fixa ficava sem o elemento.
      orphanProject = await projectOf(s.page);

      await selectWhere(s.page, "h1", 1);
      await run(s.page, "core:component-delete");
      await selectWhere(s.page, "#t1");
      await run(s.page, "core:component-delete");
      const after = (await exportDoc(s.page)).css;
      expect(after).not.toContain(":is(");
      expect(after).not.toContain("#t1");

      await run(s.page, "undo");
      const undone = (await exportDoc(s.page)).css;
      expect(undone).toContain("#t1{font-size:60px;}");
      expect(undone).toContain(":is(#t1){font-size:revert-layer;}");
      await setDevice(s.page, "mobile");
      expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["24px"]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }

    // Reaberto do projeto: trocar o id leva a regra junto (a troca de id é ligada
    // quando o elemento é criado, antes de o editor terminar de abrir).
    const reopened = await openApp(browser, { project: orphanProject, files });
    try {
      await selectWhere(reopened.page, "#t1");
      await reopened.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        ed.getSelected()?.setId("titulo-novo");
        await new Promise((r) => setTimeout(r, 150));
      });
      const css = (await exportDoc(reopened.page)).css;
      expect(css).toContain(":is(#titulo-novo){font-size:revert-layer;}");
      expect(css).not.toContain(":is(#t1)");
    } finally {
      await reopened.page.close();
    }

    // Projeto gravado com uma regra fixa sem elemento: sai ao abrir.
    const frame = (
      orphanProject.pages as { frames: { component: { components: { attributes?: { id?: string } }[] } }[] }[]
    )[0].frames[0].component;
    frame.components = frame.components.filter((c) => c.attributes?.id !== "t1-2");
    const again = await openApp(browser, { project: orphanProject, files });
    try {
      const css = (await exportDoc(again.page)).css;
      expect(css).toContain(":is(#t1){font-size:revert-layer;}");
      expect(css).not.toContain(":is(#t1-2)");
    } finally {
      await again.page.close();
    }
  });
});

// ─── #49 valores do celular sem @media do próprio elemento ───────────────────

describe("#49 valor do celular por variável CSS, clamp()/vw ou herança", () => {
  const files: Files = {
    "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
    "/os-assets/theme.css": [
      // Como os containers do Elementor: o celular muda a variável, não a propriedade.
      ".e-con{--padding-top:10px;padding:var(--padding-top) 0 0 0}",
      "@media (max-width:767px){.pg .el-b2c3{--padding-top:32px}}",
      // Título fluido (modelos do Offer Studio).
      ".h1{font-size:clamp(31px,5.4vw,56px)}",
      // Herança: o ancestral muda no celular, o texto é em em.
      ".hero{font-size:20px} @media (max-width:767px){.hero{font-size:14px}} .hero p{font-size:1.5em}",
      ".cor{color:rgb(0, 0, 255)}",
    ].join("\n"),
  };
  const BODY = `<div class="pg"><div id="c" class="e-con el-b2c3">bloco</div></div>
<h1 id="h" class="h1">Título</h1><div class="hero"><p id="p1">Texto</p></div><p id="p2" class="cor">Cor</p>`;

  it("a edição no Desktop vale no computador e no tablet; o celular continua com o valor original", async () => {
    const s = await openApp(browser, { html: pageWithBase(BODY), files });
    try {
      await selectWhere(s.page, "#c");
      await setStyle(s.page, "padding-top", "100px");
      await selectWhere(s.page, "#h");
      await setStyle(s.page, "font-size", "60px");
      await selectWhere(s.page, "#p1");
      await setStyle(s.page, "font-size", "40px");
      expect((await toasts(s.page)).filter((t) => t.message === KEPT_TOAST)).toHaveLength(3);
      // Cor que não muda com a largura: nada a manter, sem aviso.
      await selectWhere(s.page, "#p2");
      await setStyle(s.page, "color", "rgb(200, 0, 0)");
      expect((await toasts(s.page)).filter((t) => t.message === KEPT_TOAST)).toHaveLength(3);
      const out = await exportDoc(s.page);
      expect(out.css).not.toContain(":is(#p2)");

      const read = async (at: (sel: string, prop: string) => Promise<string[]>) => [
        ...(await at("#c", "padding-top")),
        ...(await at("#h", "font-size")),
        ...(await at("#p1", "font-size")),
        ...(await at("#p2", "color")),
      ];
      expect(await read((sel, prop) => canvasAll(s.page, sel, prop))).toEqual([
        "100px",
        "60px",
        "40px",
        "rgb(200, 0, 0)",
      ]);
      await setDevice(s.page, "mobile");
      const mobile = await read((sel, prop) => canvasAll(s.page, sel, prop));
      expect(mobile).toEqual(["32px", "31px", "21px", "rgb(200, 0, 0)"]);

      const final = finalizeFromEditor(out.html, out.css);
      expect(await read((sel, prop) => finalAll(files, final, 390, sel, prop))).toEqual(mobile);
      expect(await read((sel, prop) => finalAll(files, final, 800, sel, prop))).toEqual([
        "100px",
        "60px",
        "40px",
        "rgb(200, 0, 0)",
      ]);
      expect(await read((sel, prop) => finalAll(files, final, 1280, sel, prop))).toEqual([
        "100px",
        "60px",
        "40px",
        "rgb(200, 0, 0)",
      ]);
      // A moldura escondida da comparação não carregou nada de fora.
      expect(s.external).toEqual([]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });

  it("página clonada do Elementor (fixture 'vendas'): o container mantém o espaçamento do celular", async () => {
    const { html, files: siteFiles } = elementorFixture();
    const s = await openApp(browser, { html, files: siteFiles });
    try {
      const sel = ".elementor-element-b2c3d4";
      await selectWhere(s.page, sel);
      await s.page.evaluate(async () => {
        const input = document.querySelector<HTMLInputElement>(
          "#styles .gjs-sm-property__padding .gjs-sm-property__padding-top input",
        );
        if (!input) throw new Error("campo padding-top não encontrado");
        input.value = "100";
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 200));
      });
      expect((await toasts(s.page)).some((t) => t.message === KEPT_TOAST)).toBe(true);
      await setDevice(s.page, "mobile");
      expect(await canvasAll(s.page, sel, "padding-top")).toEqual(["32px"]);
      const out = await exportDoc(s.page);
      const final = finalizeFromEditor(out.html, out.css);
      expect(await finalAll(siteFiles, final, 390, sel, "padding-top")).toEqual(["32px"]);
      expect(await finalAll(siteFiles, final, 1280, sel, "padding-top")).toEqual(["100px"]);
    } finally {
      await s.page.close();
    }
  });

  it("modelo 'vendas-longa': o título (clamp) editado no Desktop continua fluido no celular", async () => {
    const tpl = PAGE_TEMPLATES.find((t) => t.id === "vendas-longa");
    expect(tpl).toBeDefined();
    const { html, files: tplFiles } = forEditor(tpl?.html ?? "");
    const s = await openApp(browser, { html, files: tplFiles });
    try {
      await selectWhere(s.page, "h1");
      await setStyle(s.page, "font-size", "60px");
      expect((await toasts(s.page)).some((t) => t.message === KEPT_TOAST)).toBe(true);
      await setDevice(s.page, "mobile");
      const mobile = await canvasAll(s.page, "h1", "font-size");
      const out = await exportDoc(s.page);
      const final = finalizeFromEditor(out.html, out.css);
      expect(await finalAll(tplFiles, final, 375, "h1", "font-size")).toEqual(mobile);
      expect(mobile).not.toEqual(["60px"]);
      expect(await finalAll(tplFiles, final, 1280, "h1", "font-size")).toEqual(["60px"]);
    } finally {
      await s.page.close();
    }
  });
});

// ─── #49 × Tablet ────────────────────────────────────────────────────────────

describe("#49 × Tablet: breakpoint do original entre 768 e 992px", () => {
  for (const bp of ["991.98px", "980px", "768px"]) {
    const files: Files = {
      "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
      "/os-assets/theme.css": `.title{font-size:48px} @media (max-width:${bp}){.title{font-size:32px}} @media (max-width:767px){.title{font-size:24px}}`,
    };
    const widths = [
      [1280, "60px"],
      [800, "40px"],
      [768, "40px"],
      [390, "24px"],
    ] as const;

    for (const order of ["Desktop → Tablet", "Tablet → Desktop"]) {
      it(`${bp}, ${order}: o Tablet mostra a edição do Tablet; o celular, o original`, async () => {
        const s = await openApp(browser, { html: pageWithBase(`<h1 id="t1" class="title">Título</h1>`), files });
        try {
          const edit = async (device: string, size: string) => {
            await setDevice(s.page, device);
            await selectWhere(s.page, "#t1");
            await setStyle(s.page, "font-size", size);
          };
          if (order === "Desktop → Tablet") {
            await edit("desktop", "60px");
            await edit("tablet", "40px");
          } else {
            await edit("tablet", "40px");
            await edit("desktop", "60px");
          }
          await setDevice(s.page, "tablet");
          expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["40px"]);
          await setDevice(s.page, "mobile");
          expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["24px"]);
          const out = await exportDoc(s.page);
          const final = finalizeFromEditor(out.html, out.css);
          for (const [width, size] of widths) {
            expect(await finalAll(files, final, width, "h1", "font-size"), `largura ${width}`).toEqual([size]);
          }
        } finally {
          await s.page.close();
        }
      });
    }
  }

  it("projeto gravado antes: a regra fixa que valia no Tablet passa para a faixa do celular ao abrir", async () => {
    const files: Files = {
      "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
      "/os-assets/theme.css":
        ".title{font-size:48px} @media (max-width:991.98px){.title{font-size:32px}} @media (max-width:767px){.title{font-size:24px}}",
    };
    // Como o editor anterior gravava: a regra fixa em (max-width: 991.98px) vencia a edição do Tablet.
    const OLD_EDITS =
      "#t1{font-size:60px;}@media (max-width: 992px){#t1{font-size:40px;}}" +
      "@media (max-width: 991.98px){:is(#t1){font-size:revert-layer;}}" +
      "@media (max-width: 767px){:is(#t1){font-size:revert-layer;}}";
    const html = pageWithBase(`<h1 id="t1" class="title">Título</h1>`).replace(
      "</head>",
      `<style data-os-edits>${OLD_EDITS}</style></head>`,
    );
    const first = await openApp(browser, { html, files });
    let project: unknown;
    try {
      await setDevice(first.page, "tablet");
      expect(await canvasAll(first.page, "h1", "font-size")).toEqual(["32px"]);
      project = await projectOf(first.page);
    } finally {
      await first.page.close();
    }
    const s = await openApp(browser, { project, files });
    try {
      const css = (await exportDoc(s.page)).css;
      expect(css).not.toContain("991.98px");
      expect(css).toContain("@media (max-width: 767.98px){:is(#t1){font-size:revert-layer;}}");
      await setDevice(s.page, "tablet");
      expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["40px"]);
      await setDevice(s.page, "mobile");
      expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["24px"]);
      // Abrir não conta como edição.
      expect(await s.page.evaluate(() => (window as unknown as E2Window).ed.UndoManager.hasUndo())).toBe(false);
    } finally {
      await s.page.close();
    }
  });

  it("CSS 'celular primeiro' (min-width: 1024px): o celular mantém o original, o tablet mostra a edição", async () => {
    const files: Files = {
      "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
      "/os-assets/theme.css": ".title{font-size:24px} @media (min-width:1024px){.title{font-size:48px}}",
    };
    const s = await openApp(browser, { html: pageWithBase(`<h1 id="t1" class="title">Título</h1>`), files });
    try {
      await selectWhere(s.page, "#t1");
      await setStyle(s.page, "font-size", "60px");
      let out = await exportDoc(s.page);
      // Abaixo do breakpoint vale o valor básico da página (o do celular): só o
      // celular o mantém, qualquer que seja o breakpoint.
      expect(out.css).toContain("@media (max-width: 767.98px){:is(#t1){font-size:revert-layer;}}");
      expect(out.css).not.toContain("1023.98px");
      let final = finalizeFromEditor(out.html, out.css);
      expect(await finalAll(files, final, 390, "h1", "font-size")).toEqual(["24px"]);
      expect(await finalAll(files, final, 800, "h1", "font-size")).toEqual(["60px"]);
      expect(await finalAll(files, final, 1000, "h1", "font-size")).toEqual(["60px"]);
      expect(await finalAll(files, final, 1280, "h1", "font-size")).toEqual(["60px"]);
      await setDevice(s.page, "tablet");
      expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["60px"]);

      // Edição do Tablet: vale no tablet (até 992px); acima dele, a do Desktop.
      await selectWhere(s.page, "#t1");
      await setStyle(s.page, "font-size", "40px");
      expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["40px"]);
      out = await exportDoc(s.page);
      final = finalizeFromEditor(out.html, out.css);
      expect(await finalAll(files, final, 390, "h1", "font-size")).toEqual(["24px"]);
      expect(await finalAll(files, final, 800, "h1", "font-size")).toEqual(["40px"]);
      expect(await finalAll(files, final, 1000, "h1", "font-size")).toEqual(["60px"]);
      expect(await finalAll(files, final, 1280, "h1", "font-size")).toEqual(["60px"]);
    } finally {
      await s.page.close();
    }
  });
});

describe("phoneKeepMedia: a regra que mantém o celular não passa por cima da edição do Tablet", () => {
  const BOUNDS = { max: 767.98, phoneOrder: 480, tabletOrder: 992 };
  const keep = (media: string, below = false) => phoneKeepMedia(media, BOUNDS, { below });

  it("valia também no tablet: fica só na faixa do celular; o que já está nela fica igual", () => {
    expect(keep("(max-width: 991.98px)")).toBe("(max-width: 767.98px)");
    expect(keep("(max-width: 992px)")).toBe("(max-width: 767.98px)");
    expect(keep("(max-width:767px)")).toBe("(max-width:767px)");
    expect(keep("(min-width: 500px) and (max-width: 991.98px)")).toBe("(max-width: 767.98px) and (min-width: 500px)");
    expect(keep("(width < 992px), (max-width: 575.98px)")).toBe("(max-width: 767.98px), (max-width: 575.98px)");
  });

  it("'computador primeiro' além da regra do Tablet (Elementor 1024px, Bootstrap 1199.98px): fica, antes da regra do Tablet", () => {
    expect(keep("screen and (max-width: 1024px)")).toBe("screen and (max-width: 1024px)");
    expect(keep("(max-width: 1199.98px)")).toBe("(max-width: 1199.98px)");
    expect(keep("(max-width: 1023.98px)")).toBe("(max-width: 1023.98px)");
    // Escrita com outro número na frente: o limite de cima vai para a frente.
    expect(keep("(min-width: 500px) and (max-width: 1024px)")).toBe("(max-width: 1024px) and (min-width: 500px)");
  });

  it("faixa abaixo de um min-width ('celular primeiro'): sempre só a do celular, qualquer que seja o breakpoint", () => {
    expect(keep("(max-width: 1199.98px)", true)).toBe("(max-width: 767.98px)");
    expect(keep("(max-width: 1279.98px)", true)).toBe("(max-width: 767.98px)");
    expect(keep("(max-width: 1023.98px)", true)).toBe("(max-width: 767.98px)");
    expect(keep("(max-width: 767.98px)", true)).toBe("(max-width: 767.98px)");
    expect(keep("(max-width: 479.98px)", true)).toBe("(max-width: 767.98px) and (max-width: 479.98px)");
  });

  it("abaixo de 480px ou em em/rem: continua valendo só ali, mas ordenada antes da regra do Celular", () => {
    const cases: [string, string][] = [
      ["screen and (max-width:479px)", "screen and (max-width: 767.98px) and (max-width:479px)"],
      ["(max-width: 480px)", "(max-width: 767.98px) and (max-width: 480px)"],
      ["(max-width: 400px)", "(max-width: 767.98px) and (max-width: 400px)"],
      ["screen and (max-width: 39.9375em)", "screen and (max-width: 767.98px) and (max-width: 39.9375em)"],
      ["(max-width: 47.99em)", "(max-width: 767.98px) and (max-width: 47.99em)"],
      ["(width < 40rem)", "(max-width: 767.98px) and (width < 40rem)"],
      [
        "only screen and (orientation: portrait) and (max-width: 479px)",
        "only screen and (max-width: 767.98px) and (orientation: portrait) and (max-width: 479px)",
      ],
    ];
    for (const [media, expected] of cases) {
      const kept = keep(media);
      expect(kept).toBe(expected);
      // Entre a regra do Tablet (992) e a do Celular (480) no CSS das edições.
      expect(mediaOrder(kept)).toBeGreaterThan(480);
      expect(mediaOrder(kept)).toBeLessThan(992);
      // Aplicar de novo (páginas já corrigidas, ao abrir) não muda nada.
      expect(keep(kept)).toBe(kept);
    }
  });

  it("só tablet, nas duas ordens de escrita: nada sobra no celular (sem regra que nunca vale)", () => {
    expect(keep("(min-width: 768px) and (max-width: 991.98px)")).toBe("");
    expect(keep("(max-width: 991.98px) and (min-width: 768px)")).toBe("");
    expect(keep("(min-width:768px) and (max-width:1199.98px)")).toBe("");
    expect(keep("(max-width:1024px) and (min-width:768px)")).toBe("");
    expect(keep("(48em <= width < 62em)")).toBe("");
    expect(keep("(min-width: 768px) and (max-width: 991.98px), (max-width: 575.98px)")).toBe("(max-width: 575.98px)");
  });

  it("withoutCovered: sem a condição que outra (só de largura) já cobre", () => {
    expect(withoutCovered(["(max-width: 1024px)", "(max-width: 767px)"])).toEqual(["(max-width: 1024px)"]);
    expect(withoutCovered(["(max-width:767px)", "(max-width: 767.98px)"])).toEqual(["(max-width: 767.98px)"]);
    expect(withoutCovered(["(max-width: 767px)", "screen and (max-width: 767px)"])).toEqual(["(max-width: 767px)"]);
    // Outra condição junto (orientação) ou só "screen" (a outra vale também na impressão): as duas ficam.
    expect(withoutCovered(["(max-width: 767px) and (orientation: portrait)", "(max-width: 480px)"])).toEqual([
      "(max-width: 767px) and (orientation: portrait)",
      "(max-width: 480px)",
    ]);
    expect(withoutCovered(["screen and (max-width: 1024px)", "(max-width: 767px)"])).toEqual([
      "screen and (max-width: 1024px)",
      "(max-width: 767px)",
    ]);
  });
});

// ─── Duplicar × link da oferta ───────────────────────────────────────────────

describe("Duplicar um botão ligado a um link da oferta", () => {
  const links = [{ key: "checkout", label: "Checkout", url: "https://pay.test/c", kind: "CHECKOUT" }];

  for (const [name, button, field] of [
    ["<a> comum", `<a id="buy" href="https://x.test/a" data-os-link="checkout">Comprar</a>`, "href"],
    [
      "botão (os-button)",
      `<a id="buy" class="os-btn" href="https://x.test/a" data-os-link="checkout">Comprar</a>`,
      "href",
    ],
  ] as const) {
    it(`${name}: a cópia volta a ter o campo de endereço ao desligar o link`, async () => {
      const s = await openApp(browser, {
        html: pageWithBase(`<section id="s">${button}</section>`),
        files: { "/os-assets/base.css": "" },
        links,
      });
      try {
        const traits = await s.page.evaluate(async (fieldName) => {
          const ed = (window as unknown as E2Window).ed;
          const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
          const names = (c: unknown) =>
            (c as { getTraits(): { getName(): string }[] }).getTraits().map((t) => t.getName());
          const original = ed.getWrapper()?.find("#buy")[0];
          ed.select(original as never);
          await wait(150);
          ed.runCommand("tlb-clone");
          await wait(200);
          const copy = (ed.getWrapper()?.find("a") ?? []).find((c) => c !== original);
          ed.select(copy as never);
          await wait(150);
          const linked = names(copy);
          copy?.getTrait("data-os-link")?.setValue("");
          await wait(150);
          const unlinked = names(copy);
          // O campo de volta funciona.
          copy?.getTrait(fieldName)?.setValue("meusite.com.br/obrigado");
          await wait(100);
          return { linked, unlinked, href: copy?.getAttributes().href };
        }, field);
        expect(traits.linked).not.toContain(field);
        expect(traits.linked).toContain("os-destino");
        expect(traits.unlinked).toContain(field);
        expect(traits.unlinked).not.toContain("os-destino");
        expect(traits.unlinked.indexOf(field)).toBe(traits.linked.indexOf("os-destino"));
        expect(traits.href).toBe("https://meusite.com.br/obrigado");
        expect(s.errors).toEqual([]);
      } finally {
        await s.page.close();
      }
    });
  }
});
