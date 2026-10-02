/**
 * Fase 3 — correções E2 (CSS das edições contra o CSS original), no Chromium:
 * - #15: regras de classes/ids que não estão na página agora são salvas;
 * - #46 (parte do painel): edição de uma propriedade que o CSS original marca
 *   com !important é gravada com !important e aparece no canvas (camada os-fix);
 * - #49: edição no Desktop não apaga o valor próprio do celular que a página
 *   original tinha (e avisa como mudar no celular).
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { narrowOnly } from "@/editor/grapes/original-css";
import { finalizeFromEditor } from "@/lib/editor-html";
import { baseSheet, type E2Window, ORIGIN, openApp, pageWithBase, toasts } from "./fix3-E2-harness";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

/** Muda uma propriedade pelo painel de estilo, como o usuário (campo + change). */
async function setStyle(page: Page, sector: string, property: string, value: string) {
  await page.evaluate(
    async ([sec, prop, val]) => {
      const ed = (window as unknown as E2Window).ed;
      const input = document.querySelector<HTMLInputElement>(`#styles .gjs-sm-property__${prop} input`);
      if (input) {
        input.value = val;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        ed.StyleManager.getProperty(sec, prop)?.upValue(val);
      }
      await new Promise((r) => setTimeout(r, 80));
    },
    [sector, property, value] as const,
  );
}

async function selectById(page: Page, id: string) {
  await page.evaluate(async (cid) => {
    const ed = (window as unknown as E2Window).ed;
    ed.select(ed.getWrapper()?.find(`#${cid}`)[0] as never);
    await new Promise((r) => setTimeout(r, 120));
  }, id);
}

async function setDevice(page: Page, device: string) {
  await page.evaluate(async (d) => {
    const ed = (window as unknown as E2Window).ed;
    ed.setDevice(d);
    await new Promise((r) => setTimeout(r, 450));
  }, device);
}

function computed(page: Page, id: string, prop: string) {
  return page.evaluate(
    ([cid, p]) => {
      const ed = (window as unknown as E2Window).ed;
      const el = (ed.Canvas.getDocument() as Document).getElementById(cid) as HTMLElement;
      return ed.Canvas.getWindow().getComputedStyle(el).getPropertyValue(p);
    },
    [id, prop] as const,
  );
}

function editsCss(page: Page) {
  return page.evaluate(() => (window as unknown as E2Window).ed.getCss({ avoidProtected: true }) ?? "");
}

/**
 * Página final como o visitante recebe o CSS: folha base (camadas) + edições,
 * com as declarações !important também em @layer os-fix (finalizeFromEditor).
 */
async function renderFinal(files: Record<string, string>, body: string, css: string, width: number) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  const importantRules = css.includes("!important") ? `<style>@layer os-fix{${css.replace(/\n/g, "")}}</style>` : "";
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/p")
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><link rel="stylesheet" href="/os-assets/base.css" data-os-base><style data-os-edits>${css}</style>${importantRules}</head><body>${body}</body></html>`,
      });
    const file = files[url.pathname];
    if (file !== undefined) return route.fulfill({ contentType: "text/css", body: file });
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto(`${ORIGIN}/p`);
  return page;
}

describe("#15 regras que não casam com nada agora", () => {
  it("classes de estado, popups e ids futuros continuam no CSS salvo", async () => {
    const s = await openApp(browser, {
      html: pageWithBase(`<p class="t">oi</p>`),
      files: { "/os-assets/base.css": "" },
    });
    try {
      const css = await s.page.evaluate(() => {
        const ed = (window as unknown as E2Window).ed;
        ed.Css.addRules(".t{color:red}.lazyloaded{opacity:1}#popup-oferta{position:fixed}.os-revealed{outline:0}");
        return ed.getCss() ?? "";
      });
      for (const rule of [
        ".t{color:red;}",
        ".lazyloaded{opacity:1;}",
        "#popup-oferta{position:fixed;}",
        ".os-revealed{",
      ]) {
        expect(css).toContain(rule);
      }
      // Excluir um elemento continua levando as regras do id dele.
      const afterRemove = await s.page.evaluate(() => {
        const ed = (window as unknown as E2Window).ed;
        const p = ed.getWrapper()?.find("p")[0];
        p?.addStyle({ "font-size": "20px" });
        const id = p?.getId();
        p?.remove();
        return { css: ed.getCss() ?? "", id };
      });
      expect(afterRemove.css).not.toContain(`#${afterRemove.id}{`);
    } finally {
      await s.page.close();
    }
  });
});

describe("#46 !important no CSS original", () => {
  const files = {
    "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
    "/os-assets/theme.css":
      ".title{color:red !important;font-size:30px} .box{margin:0 !important}" +
      " @media (max-width:767px){.title{letter-spacing:2px !important}}",
  };
  const body = `<h1 id="t1" class="title">Título</h1><div id="b1" class="box">caixa</div>`;

  it("a edição vira !important só onde precisa, aparece no canvas e vale na página final", async () => {
    const s = await openApp(browser, { html: pageWithBase(body), files });
    try {
      await selectById(s.page, "t1");
      expect(await computed(s.page, "t1", "color")).toBe("rgb(255, 0, 0)");
      await setStyle(s.page, "tipografia", "color", "#0000ff");
      await setStyle(s.page, "tipografia", "font-size", "40px");
      // letter-spacing é !important só no celular: no Desktop, edição comum.
      await setStyle(s.page, "tipografia", "letter-spacing", "1px");
      await s.page.waitForTimeout(100);
      const css = await editsCss(s.page);
      expect(css).toMatch(/#t1\{[^}]*color:#0000ff !important/);
      expect(css).toMatch(/#t1\{[^}]*font-size:40px;/);
      expect(css).not.toMatch(/font-size:40px !important/);
      expect(css).toMatch(/#t1\{[^}]*letter-spacing:1px;/);
      expect(await computed(s.page, "t1", "color")).toBe("rgb(0, 0, 255)");
      expect(await computed(s.page, "t1", "font-size")).toBe("40px");

      // Atalho (margin) com !important no original: vale também.
      await selectById(s.page, "b1");
      await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        const margin = ed.StyleManager.getProperty("espacamento", "margin") as unknown as {
          getProperty(id: string): { upValue(v: string): void };
        };
        margin.getProperty("margin-top-sub").upValue("25px");
        await new Promise((r) => setTimeout(r, 80));
      });
      // Só o lado mudado é gravado (os outros não viram 0).
      expect(await editsCss(s.page)).toMatch(/#b1\{[^}]*margin-top:25px !important/);
      expect(await editsCss(s.page)).not.toMatch(/#b1\{[^}]*margin:/);
      expect(await computed(s.page, "b1", "margin-top")).toBe("25px");

      // Desfazer volta tudo de uma vez (uma edição = um passo).
      await s.page.evaluate(() => (window as unknown as E2Window).ed.UndoManager.undo());
      await s.page.waitForTimeout(100);
      expect(await computed(s.page, "b1", "margin-top")).toBe("0px");

      // Página final (mesma regra de camadas): o azul vale.
      const final = await renderFinal(files, body, await editsCss(s.page), 1280);
      try {
        const color = await final.evaluate(() => getComputedStyle(document.getElementById("t1") as HTMLElement).color);
        expect(color).toBe("rgb(0, 0, 255)");
      } finally {
        await final.close();
      }
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

describe("#49 edição no Desktop e o valor próprio do celular", () => {
  const files = {
    "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
    "/os-assets/theme.css":
      ".title{font-size:48px;color:#111111} @media (max-width:767px){.title{font-size:24px}}" +
      " .mf{padding:10px} @media (min-width:768px){.mf{padding:40px}}",
  };
  const body = `<h1 id="t1" class="title">Título</h1><p id="p1" class="title" style="font-size:50px">Com estilo próprio</p><div id="m1" class="mf">mobile first</div>`;

  it("o celular continua com o tamanho original, o Desktop muda e o aviso aparece", async () => {
    const s = await openApp(browser, { html: pageWithBase(body), files });
    try {
      await selectById(s.page, "t1");
      await setStyle(s.page, "tipografia", "font-size", "60px");
      // Cor não tem valor próprio no celular: vale em todas as telas, sem regra extra.
      await setStyle(s.page, "tipografia", "color", "#00aa00");
      expect(await computed(s.page, "t1", "font-size")).toBe("60px");
      const css = await editsCss(s.page);
      expect(css).toMatch(/#t1\{[^}]*font-size:60px/);
      expect(css).toMatch(/@media \(max-width: 767px\)\{:is\(#t1\)\{font-size:revert-layer;\}\}/);
      expect(css).not.toMatch(/:is\(#t1\)\{[^}]*color/);
      const notes = await toasts(s.page);
      expect(notes.filter((t) => t.message.includes("No celular")).length).toBe(1);

      // No modo Celular: o valor original (24px); e uma edição ali vence.
      await setDevice(s.page, "mobile");
      expect(await computed(s.page, "t1", "font-size")).toBe("24px");
      expect(await computed(s.page, "t1", "color")).toBe("rgb(0, 170, 0)");
      await selectById(s.page, "t1");
      await setStyle(s.page, "tipografia", "font-size", "30px");
      expect(await computed(s.page, "t1", "font-size")).toBe("30px");
      await setDevice(s.page, "desktop");
      expect(await computed(s.page, "t1", "font-size")).toBe("60px");

      // Página final: 60px no computador, 30px no celular (≤480) e 24px entre 481 e 767.
      const finalCss = await editsCss(s.page);
      for (const [width, size] of [
        [1280, "60px"],
        [390, "30px"],
        [600, "24px"],
      ] as const) {
        const final = await renderFinal(files, body, finalCss, width);
        try {
          const got = await final.evaluate(
            () => getComputedStyle(document.getElementById("t1") as HTMLElement).fontSize,
          );
          expect(got, `largura ${width}`).toBe(size);
        } finally {
          await final.close();
        }
      }
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });

  it("elemento que já tinha o próprio tamanho (style) e CSS 'celular primeiro'", async () => {
    const s = await openApp(browser, { html: pageWithBase(body), files });
    try {
      // style="font-size:50px" já valia no celular também: nada a manter.
      await selectById(s.page, "p1");
      await setStyle(s.page, "tipografia", "font-size", "55px");
      let css = await editsCss(s.page);
      expect(css).not.toContain(":is(#p1)");

      // min-width: 768px (celular primeiro): abaixo disso, o valor de fora do @media.
      await selectById(s.page, "m1");
      await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        const padding = ed.StyleManager.getProperty("espacamento", "padding") as unknown as {
          getProperty(id: string): { upValue(v: string): void };
        };
        padding.getProperty("padding-top-sub").upValue("60px");
        await new Promise((r) => setTimeout(r, 80));
      });
      css = await editsCss(s.page);
      expect(css).toMatch(/@media \(max-width: 767\.98px\)\{:is\(#m1\)\{padding-top:revert-layer;\}\}/);
      await setDevice(s.page, "mobile");
      expect(await computed(s.page, "m1", "padding-top")).toBe("10px");
      await setDevice(s.page, "desktop");
      expect(await computed(s.page, "m1", "padding-top")).toBe("60px");
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

describe("#49 só media queries de tela mais estreita são 'do celular'", () => {
  it("narrowOnly: limite de largura abaixo do canvas; telas largas, modo escuro e impressão não", () => {
    for (const media of [
      "(max-width: 767px)",
      "only screen and (max-width: 47.9375em)",
      "(min-width: 768px) and (max-width: 1024px)",
      "(max-width: 767px) and (orientation: landscape)",
      "(width < 768px)",
      "(400px <= width < 768px)",
      "(max-width: 767px), (max-width: 480px)",
    ]) {
      expect(narrowOnly(media, 1280), media).toBe(true);
    }
    for (const media of [
      "(min-width: 1400px)",
      "(prefers-color-scheme: dark)",
      "print",
      "print and (max-width: 767px)",
      "(orientation: portrait)",
      "(hover: none)",
      "not all and (max-width: 767px)",
      "(max-width: 767px), print",
      "(width > 400px)",
      "(max-width: 50vw)",
    ]) {
      expect(narrowOnly(media, 1280), media).toBe(false);
    }
  });

  /** Página final de verdade (finalizeFromEditor) numa largura e tema. */
  async function finalValue(
    files: Record<string, string>,
    html: string,
    width: number,
    prop: string,
    colorScheme: "light" | "dark" = "light",
  ) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, colorScheme });
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/p") return route.fulfill({ contentType: "text/html", body: html });
      const file = files[url.pathname];
      if (file !== undefined) return route.fulfill({ contentType: "text/css", body: file });
      return route.fulfill({ status: 204, body: "" });
    });
    await page.goto(`${ORIGIN}/p`);
    const value = await page.evaluate(
      (p) => getComputedStyle(document.getElementById("t1") as HTMLElement).getPropertyValue(p),
      prop,
    );
    await page.close();
    return value;
  }

  async function exportFinal(page: Page) {
    const out = await page.evaluate(() => {
      const ed = (window as unknown as E2Window).ed;
      return { html: ed.getHtml({ asDocument: true } as never), css: ed.getCss({ avoidProtected: true }) ?? "" };
    });
    return { css: out.css, final: finalizeFromEditor(out.html, out.css) };
  }

  it("tela larga (min-width: 1400px): a edição do Desktop vale em monitores de 1440 e 1920", async () => {
    const files = {
      "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
      "/os-assets/theme.css": ".title{font-size:48px} @media (min-width:1400px){.title{font-size:56px}}",
    };
    const s = await openApp(browser, { html: pageWithBase(`<h1 id="t1" class="title">Título</h1>`), files });
    try {
      await selectById(s.page, "t1");
      await setStyle(s.page, "tipografia", "font-size", "60px");
      const { css, final } = await exportFinal(s.page);
      expect(css).not.toContain(":is(#t1)");
      expect((await toasts(s.page)).filter((t) => t.message.includes("No celular"))).toEqual([]);
      for (const width of [1280, 1440, 1920]) {
        expect(await finalValue(files, final, width, "font-size"), `largura ${width}`).toBe("60px");
      }
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });

  it("modo escuro do visitante: a cor editada no Desktop vale nele também", async () => {
    const files = {
      "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
      "/os-assets/theme.css": ".title{color:#111111} @media (prefers-color-scheme: dark){.title{color:#eeeeee}}",
    };
    const s = await openApp(browser, { html: pageWithBase(`<h1 id="t1" class="title">Título</h1>`), files });
    try {
      await selectById(s.page, "t1");
      await setStyle(s.page, "tipografia", "color", "#ff0000");
      const { css, final } = await exportFinal(s.page);
      expect(css).not.toContain(":is(#t1)");
      expect((await toasts(s.page)).filter((t) => t.message.includes("No celular"))).toEqual([]);
      expect(await finalValue(files, final, 1280, "color", "light")).toBe("rgb(255, 0, 0)");
      expect(await finalValue(files, final, 1280, "color", "dark")).toBe("rgb(255, 0, 0)");
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});
