/**
 * Fase 3 — quinta rodada de correções, no Chromium de verdade (harness E2):
 * - #49 × CSS "celular primeiro" com breakpoint acima do Tablet (Bootstrap
 *   1200px, Tailwind 1280px): a edição do Desktop vale no tablet e no notebook
 *   pequeno; só o celular mantém o valor original;
 * - #49 × breakpoint de celular abaixo de 480px ou em em/rem (Webflow 479px,
 *   400px, Foundation 39.9375em, Tailwind v4 `width < 40rem`): depois de uma
 *   edição no Desktop, a edição do Celular aparece no celular;
 * - Duplicar depois de edições no Desktop e no Celular (breakpoint 480px): a
 *   cópia fica igual à origem no celular;
 * - faixa só de tablet, nas duas ordens de escrita: nenhuma regra, nenhum aviso;
 * - regras `:is(#id)` digitadas em "CSS da página" não são mexidas ao reabrir.
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finalizeFromEditor } from "@/lib/editor-html";
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
      await new Promise((r) => setTimeout(r, 200));
    },
    [property, value] as const,
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

/** Valor do primeiro elemento em cada largura. */
async function byWidth(files: Files, html: string, widths: number[], selector: string, prop: string) {
  const out: Record<number, string> = {};
  for (const w of widths) out[w] = (await finalAll(files, html, w, selector, prop))[0];
  return out;
}

function theme(css: string): Files {
  return { "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]), "/os-assets/theme.css": css };
}

const keptToasts = async (page: Page) => (await toasts(page)).filter((t) => t.message === KEPT_TOAST).length;

const hasUndo = (page: Page) =>
  page.evaluate(() => (window as unknown as E2Window).ed.UndoManager.hasUndo() as boolean);

// ─── #49 × CSS "celular primeiro" com breakpoint acima do Tablet ─────────────

describe("#49 × CSS 'celular primeiro' com breakpoint acima do Tablet", () => {
  it("Bootstrap (min-width: 1200px): a edição do Desktop vale no tablet e no notebook; o celular mantém o original", async () => {
    const files = theme("h1{font-size:calc(1.375rem + 1.5vw)} @media (min-width:1200px){h1{font-size:2.5rem}}");
    const s = await openApp(browser, { html: pageWithBase(`<h1 id="t">Título</h1>`), files });
    try {
      await selectWhere(s.page, "#t");
      await setStyle(s.page, "font-size", "50px");
      expect(await keptToasts(s.page)).toBe(1);
      let out = await exportDoc(s.page);
      expect(out.css).toContain("@media (max-width: 767.98px){:is(#t){font-size:revert-layer;}}");
      expect(out.css).not.toContain("1199.98px");
      let final = finalizeFromEditor(out.html, out.css);
      // Valor original do celular (RFS: 1.375rem + 1.5vw a 390px).
      const phone = (await finalAll(files, final, 390, "#t", "font-size"))[0];
      expect(Number.parseFloat(phone)).toBeCloseTo(22 + 0.015 * 390, 1);
      expect(await byWidth(files, final, [900, 1000, 1100, 1180, 1280], "#t", "font-size")).toEqual({
        900: "50px",
        1000: "50px",
        1100: "50px",
        1180: "50px",
        1280: "50px",
      });
      // O canvas do Tablet mostra a edição do Desktop logo depois dela.
      await setDevice(s.page, "tablet");
      expect(await canvasAll(s.page, "#t", "font-size")).toEqual(["50px"]);

      // Edição do Tablet: vale até 992px; entre 993px e 1199px, a do Desktop.
      await selectWhere(s.page, "#t");
      await setStyle(s.page, "font-size", "44px");
      expect(await canvasAll(s.page, "#t", "font-size")).toEqual(["44px"]);
      await setDevice(s.page, "mobile");
      const mobileCanvas = await canvasAll(s.page, "#t", "font-size");
      out = await exportDoc(s.page);
      final = finalizeFromEditor(out.html, out.css);
      expect(await byWidth(files, final, [900, 1000, 1100, 1280], "#t", "font-size")).toEqual({
        900: "44px",
        1000: "50px",
        1100: "50px",
        1280: "50px",
      });
      expect(await finalAll(files, final, 375, "#t", "font-size")).toEqual(mobileCanvas);
      expect(Number.parseFloat(mobileCanvas[0])).toBeCloseTo(22 + 0.015 * 375, 1);
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });

  it("Tailwind (lg 1024px, xl 1280px): a edição do Desktop vale de 768px para cima; 390px mantém o original", async () => {
    const files = theme(
      ".t{font-size:1.5rem} @media (min-width:1024px){.t{font-size:2.25rem}} @media (min-width:1280px){.t{font-size:3rem}}",
    );
    const s = await openApp(browser, { html: pageWithBase(`<h1 id="t" class="t">Título</h1>`), files });
    try {
      await selectWhere(s.page, "#t");
      await setStyle(s.page, "font-size", "60px");
      expect(await keptToasts(s.page)).toBe(1);
      const out = await exportDoc(s.page);
      // Uma regra só, na faixa do celular.
      expect(out.css.match(/:is\(#t\)/g)).toHaveLength(1);
      expect(out.css).toContain("@media (max-width: 767.98px){:is(#t){font-size:revert-layer;}}");
      const final = finalizeFromEditor(out.html, out.css);
      expect(await byWidth(files, final, [390, 800, 1000, 1024, 1100, 1180, 1279, 1280], "#t", "font-size")).toEqual({
        390: "24px",
        800: "60px",
        1000: "60px",
        1024: "60px",
        1100: "60px",
        1180: "60px",
        1279: "60px",
        1280: "60px",
      });
    } finally {
      await s.page.close();
    }
  });
});

// ─── #49 × breakpoint de celular abaixo de 480px ou em em/rem ────────────────

describe("#49 × breakpoint de celular abaixo de 480px ou em em/rem: a edição do Celular aparece", () => {
  for (const [name, media] of [
    ["Webflow (screen and max-width: 479px)", "screen and (max-width:479px)"],
    ["max-width: 400px", "(max-width:400px)"],
    ["Foundation (max-width: 39.9375em)", "screen and (max-width:39.9375em)"],
    ["max-width: 47.99em", "(max-width:47.99em)"],
    ["Tailwind v4 (width < 40rem)", "(width < 40rem)"],
    ["max-width: 480px (o mesmo número da regra do Celular)", "(max-width:480px)"],
  ] as const) {
    it(`${name}: Desktop 60px e depois Celular 30px`, async () => {
      const files = theme(`.t{font-size:48px} @media ${media}{.t{font-size:24px}}`);
      const s = await openApp(browser, { html: pageWithBase(`<h1 id="t" class="t">Título</h1>`), files });
      try {
        await selectWhere(s.page, "#t");
        await setStyle(s.page, "font-size", "60px");
        expect(await keptToasts(s.page)).toBe(1);
        await setDevice(s.page, "mobile");
        // Antes da edição do Celular: o valor original do celular.
        expect(await canvasAll(s.page, "#t", "font-size")).toEqual(["24px"]);
        await selectWhere(s.page, "#t");
        await setStyle(s.page, "font-size", "30px");
        expect(await canvasAll(s.page, "#t", "font-size")).toEqual(["30px"]);
        const out = await exportDoc(s.page);
        // A regra que mantém o celular vem antes da regra do Celular no CSS.
        expect(out.css.indexOf(":is(#t)")).toBeGreaterThan(-1);
        expect(out.css.indexOf(":is(#t)")).toBeLessThan(out.css.indexOf("@media (max-width: 480px){#t{"));
        const final = finalizeFromEditor(out.html, out.css);
        expect(await finalAll(files, final, 375, "#t", "font-size")).toEqual(["30px"]);
        expect(await finalAll(files, final, 1280, "#t", "font-size")).toEqual(["60px"]);
        expect(s.errors).toEqual([]);
      } finally {
        await s.page.close();
      }
    });
  }

  it("página gravada antes (regra em max-width: 479px depois da do Celular): corrigida ao abrir", async () => {
    const files = theme(".t{font-size:48px} @media screen and (max-width:479px){.t{font-size:24px}}");
    const OLD_EDITS =
      "#t{font-size:60px;}@media (max-width: 480px){#t{font-size:30px;}}" +
      "@media screen and (max-width: 479px){:is(#t){font-size:revert-layer;}}";
    const html = pageWithBase(`<h1 id="t" class="t">Título</h1>`).replace(
      "</head>",
      `<style data-os-edits>${OLD_EDITS}</style></head>`,
    );
    const first = await openApp(browser, { html, files });
    let project: unknown;
    try {
      project = await projectOf(first.page);
    } finally {
      await first.page.close();
    }
    const s = await openApp(browser, { project, files });
    try {
      const out = await exportDoc(s.page);
      expect(out.css).toContain("(max-width: 767.98px) and (max-width: 479px){:is(#t){font-size:revert-layer;}}");
      expect(out.css.indexOf(":is(#t)")).toBeLessThan(out.css.indexOf("@media (max-width: 480px){#t{"));
      await setDevice(s.page, "mobile");
      expect(await canvasAll(s.page, "#t", "font-size")).toEqual(["30px"]);
      const final = finalizeFromEditor(out.html, out.css);
      expect(await finalAll(files, final, 375, "#t", "font-size")).toEqual(["30px"]);
      // Entre 480px e 767px: a edição do Desktop (como antes).
      expect(await finalAll(files, final, 600, "#t", "font-size")).toEqual(["60px"]);
      // Abrir não conta como edição.
      expect(await hasUndo(s.page)).toBe(false);
    } finally {
      await s.page.close();
    }
  });
});

// ─── Duplicar × edições no Desktop e no Celular ──────────────────────────────

describe("Duplicar depois de edições no Desktop e no Celular", () => {
  for (const media of ["(max-width:480px)", "(max-width:767px)"]) {
    it(`breakpoint do original ${media}: a cópia fica igual à origem no celular`, async () => {
      const files = theme(`.t{font-size:48px} @media ${media}{.t{font-size:24px}}`);
      const s = await openApp(browser, { html: pageWithBase(`<h1 id="t" class="t">Título</h1>`), files });
      try {
        await selectWhere(s.page, "#t");
        await setStyle(s.page, "font-size", "60px");
        await setDevice(s.page, "mobile");
        await selectWhere(s.page, "#t");
        await setStyle(s.page, "font-size", "30px");
        await setDevice(s.page, "desktop");
        await selectWhere(s.page, "#t");
        await duplicate(s.page);
        expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["60px", "60px"]);
        await setDevice(s.page, "mobile");
        expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["30px", "30px"]);
        const out = await exportDoc(s.page);
        const final = finalizeFromEditor(out.html, out.css);
        expect(await finalAll(files, final, 375, "h1", "font-size")).toEqual(["30px", "30px"]);
        expect(await finalAll(files, final, 1280, "h1", "font-size")).toEqual(["60px", "60px"]);
        expect(s.errors).toEqual([]);
      } finally {
        await s.page.close();
      }
    });
  }
});

// ─── Faixa só de tablet, nas duas ordens ─────────────────────────────────────

describe("#49 × faixa só de tablet escrita com o max-width primeiro", () => {
  for (const range of ["(max-width:1024px) and (min-width:768px)", "(max-width:991.98px) and (min-width:768px)"]) {
    it(`${range}: nenhuma regra, nenhum aviso "No celular…"`, async () => {
      const files = theme(`.t{font-size:48px} @media ${range}{.t{font-size:36px}}`);
      const s = await openApp(browser, { html: pageWithBase(`<h1 id="t" class="t">Título</h1>`), files });
      try {
        await selectWhere(s.page, "#t");
        await setStyle(s.page, "font-size", "60px");
        const out = await exportDoc(s.page);
        expect(out.css).not.toContain(":is(");
        expect(await keptToasts(s.page)).toBe(0);
        const final = finalizeFromEditor(out.html, out.css);
        expect(await byWidth(files, final, [375, 800, 1280], "#t", "font-size")).toEqual({
          375: "60px",
          800: "60px",
          1280: "60px",
        });
        await setDevice(s.page, "mobile");
        expect(await canvasAll(s.page, "#t", "font-size")).toEqual(["60px"]);
      } finally {
        await s.page.close();
      }
    });
  }
});

// ─── Regras :is(#id) digitadas em "CSS da página" ────────────────────────────

describe("regras `:is(#id)` digitadas pela pessoa não são mexidas ao abrir", () => {
  it("padding no tablet e fundo até 991px continuam depois de gravar e reabrir; a regra fixa antiga é corrigida", async () => {
    const files = theme(".hero{padding:40px;color:rgb(0, 0, 0)} @media (max-width:900px){.hero{color:rgb(0, 0, 255)}}");
    const USER =
      "#hero{color:rgb(0, 128, 0);}" +
      "@media (min-width: 768px) and (max-width: 1023px){:is(#hero){padding:10px;}}" +
      "@media (max-width: 991px){:is(#hero){background-color:rgb(255, 0, 0);}}" +
      // Regra fixa de verdade (só revert-layer) gravada antes: passa para a faixa do celular.
      "@media (max-width: 900px){:is(#hero){color:revert-layer;}}";
    const html = pageWithBase(`<section id="hero" class="hero">Oi</section>`).replace(
      "</head>",
      `<style data-os-edits>${USER}</style></head>`,
    );
    const first = await openApp(browser, { html, files });
    let project: unknown;
    try {
      project = await projectOf(first.page);
    } finally {
      await first.page.close();
    }
    const s = await openApp(browser, { project, files });
    let again: unknown;
    try {
      const out = await exportDoc(s.page);
      expect(out.css).toContain("@media (min-width: 768px) and (max-width: 1023px){:is(#hero){");
      expect(out.css).toContain("padding-top:10px");
      expect(out.css).toMatch(/@media \(max-width: 991px\)\{:is\(#hero\)\{background-color:rgb\(255, 0, 0\);\}\}/);
      expect(out.css).toContain("@media (max-width: 767.98px){:is(#hero){color:revert-layer;}}");
      const final = finalizeFromEditor(out.html, out.css);
      expect(await finalAll(files, final, 900, "#hero", "padding-top")).toEqual(["10px"]);
      expect(await finalAll(files, final, 900, "#hero", "background-color")).toEqual(["rgb(255, 0, 0)"]);
      expect(await finalAll(files, final, 900, "#hero", "color")).toEqual(["rgb(0, 128, 0)"]);
      expect(await finalAll(files, final, 390, "#hero", "color")).toEqual(["rgb(0, 0, 255)"]);
      again = await projectOf(s.page);
    } finally {
      await s.page.close();
    }
    // Uma terceira abertura não muda mais nada.
    const third = await openApp(browser, { project: again, files });
    try {
      const out = await exportDoc(third.page);
      expect(out.css).toContain("padding-top:10px");
      expect(out.css).toContain("background-color:rgb(255, 0, 0)");
      // Duplicar não copia as regras da pessoa (só as fixas, que são do editor).
      await selectWhere(third.page, "#hero");
      await duplicate(third.page);
      const css = (await exportDoc(third.page)).css;
      expect(css.match(/padding-top:10px/g)).toHaveLength(1);
      expect(css.match(/color:revert-layer/g)).toHaveLength(2);
    } finally {
      await third.page.close();
    }
  });
});
