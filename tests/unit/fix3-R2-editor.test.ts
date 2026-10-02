/**
 * Fase 3 — segunda rodada de correções, no Chromium de verdade (harness E2):
 * - ids repetidos × valor do celular (#49): a regra que mantém o valor do
 *   celular usa os mesmos seletores da edição (primeiro elemento e repetido
 *   estilizado), no canvas e na página final;
 * - id repetido dentro de um texto editado (editor de texto): o repetido volta
 *   a ser o mesmo componente (estilo e marcas dele), sem draggable nem "-2";
 * - #49: Duplicar copia a regra que mantém o celular; trocar o id renomeia; uma
 *   edição no Tablet também mantém o valor próprio do celular;
 * - #23: popup e notificação aparecem no canvas mesmo com o [hidden] do Bootstrap;
 * - #35: "Endereço ao clicar" (botão que não é <a>) sai enquanto há link da oferta;
 * - #55: "Endereço do link" de um <a> comum ganha o https://;
 * - #32: mudar um lado do espaçamento não zera os outros.
 */
import * as cheerio from "cheerio";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EDITS_STYLE_ATTR,
  FIX_STYLE_ATTR,
  finalizeFromEditor,
  importantFixCss,
  prepareForEditor,
} from "@/lib/editor-html";
import { applyOfferLinks } from "@/lib/offer-links";
import { baseSheet, type E2Window, ORIGIN, openApp, pageWithBase, toasts } from "./fix3-E2-harness";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

type Files = Record<string, string>;

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

// ─── Ids repetidos × valor do celular ────────────────────────────────────────

describe("ids repetidos × #49: a regra que mantém o celular segue a edição", () => {
  const files: Files = {
    "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
    "/os-assets/theme.css": ".t{font-size:48px} @media (max-width:767px){.t{font-size:24px}}",
  };
  const stored = pageWithBase(`<h2 id="x" class="t">A</h2><h2 id="x" class="t">B</h2>`);

  for (const which of ["primeiro", "repetido"] as const) {
    it(`edição no Desktop do ${which}: celular com o valor original no canvas e na página final`, async () => {
      const s = await openApp(browser, { html: prepareForEditor(stored).html, files });
      try {
        await selectWhere(s.page, which === "primeiro" ? "#x" : '[data-os-dup-id="x"]');
        await setStyle(s.page, "font-size", "60px");
        const expectedDesk = which === "primeiro" ? ["60px", "48px"] : ["48px", "60px"];
        expect(await canvasAll(s.page, "h2", "font-size")).toEqual(expectedDesk);
        expect((await toasts(s.page)).filter((t) => t.message.includes("No celular")).length).toBe(1);
        await setDevice(s.page, "mobile");
        // O aviso diz que o celular continua como no original: é o que se vê.
        expect(await canvasAll(s.page, "h2", "font-size")).toEqual(["24px", "24px"]);

        const out = await exportDoc(s.page);
        const final = finalizeFromEditor(out.html, out.css, stored);
        const edits = cheerio.load(final)(`style[${EDITS_STYLE_ATTR}]`).text();
        if (which === "primeiro") {
          expect(edits).toContain(":is(#x:not([data-os-dup-id]))");
        } else {
          expect(edits).toMatch(/:is\(#x\[data-os-eid="[^"]+"\]\)/);
        }
        expect(await finalAll(files, final, 1280, "h2", "font-size")).toEqual(expectedDesk);
        expect(await finalAll(files, final, 390, "h2", "font-size")).toEqual(["24px", "24px"]);
        expect(s.errors).toEqual([]);
      } finally {
        await s.page.close();
      }
    });
  }

  it("edição !important (o original era !important): o repetido também mantém o celular", async () => {
    const important: Files = {
      "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
      "/os-assets/theme.css": ".t{font-size:48px !important} @media (max-width:767px){.t{font-size:24px !important}}",
    };
    const s = await openApp(browser, { html: prepareForEditor(stored).html, files: important });
    try {
      await selectWhere(s.page, '[data-os-dup-id="x"]');
      await setStyle(s.page, "font-size", "60px");
      expect(await canvasAll(s.page, "h2", "font-size")).toEqual(["48px", "60px"]);
      await setDevice(s.page, "mobile");
      expect(await canvasAll(s.page, "h2", "font-size")).toEqual(["24px", "24px"]);
      const out = await exportDoc(s.page);
      const final = finalizeFromEditor(out.html, out.css, stored);
      expect(cheerio.load(final)(`style[${FIX_STYLE_ATTR}]`).text()).toContain("@media not all and (max-width: 767px)");
      expect(await finalAll(important, final, 1280, "h2", "font-size")).toEqual(["48px", "60px"]);
      expect(await finalAll(important, final, 390, "h2", "font-size")).toEqual(["24px", "24px"]);
    } finally {
      await s.page.close();
    }
  });
});

describe("id repetido dentro de um texto editado", () => {
  const files: Files = {
    "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
    "/os-assets/theme.css": "#k{color:rgb(0, 128, 0)}",
  };
  const stored = pageWithBase(
    `<p class="txt">Olá <b id="k">A</b> fim</p><p class="txt">Oi <b id="k">B</b> <i class="n">n</i> <span id="solo">s</span> fim</p>`,
  );

  it("o repetido estilizado continua o mesmo (cor dele) e nada do canvas vai para a página", async () => {
    const s = await openApp(browser, { html: prepareForEditor(stored).html, files });
    try {
      const dupId = await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        const dup = ed.getWrapper()?.find('[data-os-dup-id="k"]')[0];
        dup?.addStyle({ color: "rgb(0, 0, 255)" });
        await new Promise((r) => setTimeout(r, 100));
        return dup?.getId();
      });
      // Edita o 2º parágrafo no editor de texto, digita e sai.
      await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        const p = ed.getWrapper()?.find("p.txt")[1];
        ed.select(p as never);
        const view = p?.getView() as unknown as {
          onActive(e: unknown): Promise<void>;
          disableEditing(): Promise<void>;
        };
        await view.onActive({});
        await new Promise((r) => setTimeout(r, 200));
        const el = p?.getEl() as HTMLElement;
        el.appendChild(el.ownerDocument.createTextNode(" mais"));
        await view.disableEditing();
        await new Promise((r) => setTimeout(r, 200));
        ed.select(ed.getWrapper()?.find("p.txt")[0] as never);
        await new Promise((r) => setTimeout(r, 200));
      });
      const after = await s.page.evaluate(() => {
        const ed = (window as unknown as E2Window).ed;
        const dups = ed.getWrapper()?.find('[data-os-dup-id="k"]') ?? [];
        return { ids: dups.map((c) => c.getId()), html: ed.getHtml() };
      });
      expect(after.ids).toEqual([dupId]);
      expect(after.html).toContain(" mais");
      expect(after.html).not.toMatch(/draggable|k-2|data-os-ccid/);
      expect(await canvasAll(s.page, "b", "color")).toEqual(["rgb(0, 128, 0)", "rgb(0, 0, 255)"]);

      const out = await exportDoc(s.page);
      const final = finalizeFromEditor(out.html, out.css, stored);
      const $ = cheerio.load(final);
      expect($('b[id="k"]')).toHaveLength(2);
      expect($("body").html()).not.toMatch(/draggable|data-os-ccid|k-2/);
      expect(await finalAll(files, final, 1280, "b", "color")).toEqual(["rgb(0, 128, 0)", "rgb(0, 0, 255)"]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });

  it("uma marca data-os-ccid que já venha na página é apagada", () => {
    const prepared = prepareForEditor(pageWithBase(`<b id="k" data-os-ccid="k">A</b><b id="k">B</b>`)).html;
    expect(prepared).not.toContain("data-os-ccid");
    const final = finalizeFromEditor(pageWithBase(`<b id="k">A</b><b data-os-dup-id="k" data-os-ccid="iab">B</b>`), "");
    expect(final).not.toContain("data-os-ccid");
  });
});

// ─── #49: Duplicar, trocar o id e o Tablet ───────────────────────────────────

describe("#49 a regra que mantém o celular acompanha o elemento", () => {
  const files: Files = {
    "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
    "/os-assets/theme.css": ".title{font-size:48px} @media (max-width:767px){.title{font-size:24px}}",
  };

  it("Duplicar (a seção do título editado): a cópia também fica com o tamanho do celular", async () => {
    const body = `<section id="s"><h1 id="t1" class="title">Título</h1></section>`;
    const s = await openApp(browser, { html: pageWithBase(body), files });
    try {
      await selectWhere(s.page, "#t1");
      await setStyle(s.page, "font-size", "60px");
      await selectWhere(s.page, "#s");
      const ids = await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        ed.runCommand("tlb-clone");
        await new Promise((r) => setTimeout(r, 200));
        return (ed.getWrapper()?.find("section h1") ?? []).map((h) => h.getId());
      });
      expect(ids).toHaveLength(2);
      const css = (await exportDoc(s.page)).css;
      expect(css).toContain(`:is(#${ids[1]}){font-size:revert-layer;}`);
      expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["60px", "60px"]);
      await setDevice(s.page, "mobile");
      expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["24px", "24px"]);
      const out = await exportDoc(s.page);
      const final = finalizeFromEditor(out.html, out.css);
      expect(await finalAll(files, final, 390, "h1", "font-size")).toEqual(["24px", "24px"]);
      expect(await finalAll(files, final, 1280, "h1", "font-size")).toEqual(["60px", "60px"]);

      // Desfazer a cópia: um passo só (a cópia e as regras dela saem juntas).
      await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        ed.UndoManager.undo();
        await new Promise((r) => setTimeout(r, 150));
      });
      expect(await s.page.evaluate(() => (window as unknown as E2Window).ed.getWrapper()?.find("h1").length)).toBe(1);
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });

  it("trocar o id do elemento em Configurações leva a regra junto", async () => {
    const s = await openApp(browser, { html: pageWithBase(`<h1 id="t1" class="title">Título</h1>`), files });
    try {
      await selectWhere(s.page, "#t1");
      await setStyle(s.page, "font-size", "60px");
      await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        ed.getSelected()?.setId("titulo-novo");
        await new Promise((r) => setTimeout(r, 150));
      });
      const css = (await exportDoc(s.page)).css;
      expect(css).toContain("#titulo-novo{font-size:60px;}");
      expect(css).toContain(":is(#titulo-novo){font-size:revert-layer;}");
      expect(css).not.toContain("#t1");
      await setDevice(s.page, "mobile");
      expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["24px"]);
    } finally {
      await s.page.close();
    }
  });

  it("edição no Tablet: o celular continua com o valor original (canvas e página final)", async () => {
    const s = await openApp(browser, { html: pageWithBase(`<h1 id="t1" class="title">Título</h1>`), files });
    try {
      await setDevice(s.page, "tablet");
      await selectWhere(s.page, "#t1");
      await setStyle(s.page, "font-size", "36px");
      expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["36px"]);
      const css = (await exportDoc(s.page)).css;
      expect(css).toMatch(/@media \(max-width: 992px\)\{#t1\{font-size:36px;\}\}/);
      expect(css).toMatch(/@media \(max-width: 767px\)\{:is\(#t1\)\{font-size:revert-layer;\}\}/);
      expect((await toasts(s.page)).filter((t) => t.message.startsWith("Mudou no tablet.")).length).toBe(1);
      await setDevice(s.page, "mobile");
      expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["24px"]);
      await setDevice(s.page, "desktop");
      expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["48px"]);

      // E uma edição no Celular depois vence ali.
      await setDevice(s.page, "mobile");
      await selectWhere(s.page, "#t1");
      await setStyle(s.page, "font-size", "20px");
      expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["20px"]);

      const out = await exportDoc(s.page);
      const final = finalizeFromEditor(out.html, out.css);
      for (const [width, size] of [
        [1280, "48px"],
        [800, "36px"],
        [600, "24px"],
        [390, "20px"],
      ] as const) {
        expect(await finalAll(files, final, width, "h1", "font-size"), `largura ${width}`).toEqual([size]);
      }
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });

  it("Desktop editado e depois o Tablet: no canvas celular vale o original, como na página final", async () => {
    const s = await openApp(browser, { html: pageWithBase(`<h1 id="t1" class="title">Título</h1>`), files });
    try {
      await selectWhere(s.page, "#t1");
      await setStyle(s.page, "font-size", "60px");
      await setDevice(s.page, "tablet");
      await selectWhere(s.page, "#t1");
      await setStyle(s.page, "font-size", "36px");
      await setDevice(s.page, "mobile");
      const canvas = await canvasAll(s.page, "h1", "font-size");
      const out = await exportDoc(s.page);
      const final = finalizeFromEditor(out.html, out.css);
      expect(canvas).toEqual(["24px"]);
      expect(await finalAll(files, final, 375, "h1", "font-size")).toEqual(canvas);
      await setDevice(s.page, "tablet");
      expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["36px"]);
    } finally {
      await s.page.close();
    }
  });

  it("valor já definido no Celular antes: a edição no Desktop não passa por cima dele", async () => {
    const narrow: Files = {
      "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
      "/os-assets/theme.css": ".title{font-size:48px} @media (max-width:480px){.title{font-size:24px}}",
    };
    const s = await openApp(browser, { html: pageWithBase(`<h1 id="t1" class="title">Título</h1>`), files: narrow });
    try {
      await setDevice(s.page, "mobile");
      await selectWhere(s.page, "#t1");
      await setStyle(s.page, "font-size", "30px");
      await setDevice(s.page, "desktop");
      await selectWhere(s.page, "#t1");
      await setStyle(s.page, "font-size", "60px");
      await setDevice(s.page, "mobile");
      expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["30px"]);
      const out = await exportDoc(s.page);
      // A regra que mantém o original (se houver) vem antes da regra do Celular: ela vence.
      const pin = out.css.indexOf(":is(#t1)");
      if (pin >= 0) expect(pin).toBeLessThan(out.css.indexOf("#t1{font-size:30px"));
      const final = finalizeFromEditor(out.html, out.css);
      expect(await finalAll(narrow, final, 390, "h1", "font-size")).toEqual(["30px"]);
      expect(await finalAll(narrow, final, 600, "h1", "font-size")).toEqual(["60px"]);
    } finally {
      await s.page.close();
    }
  });

  // Sexta rodada: com o celular do Elementor (767px), a ordem das edições não
  // muda a página. O valor do Celular (até 480px) vence a regra que mantém o
  // original; de 481 a 767px (celular deitado, tablet pequeno) vale o original.
  for (const order of ["Celular e depois Desktop", "Desktop e depois Celular"] as const) {
    it(`valor no Celular e edição no Desktop (${order}): 481–767px continuam com o original`, async () => {
      const phone: Files = {
        "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
        "/os-assets/theme.css": ".title{font-size:48px} @media (max-width:767px){.title{font-size:24px}}",
      };
      const s = await openApp(browser, { html: pageWithBase(`<h1 id="t1" class="title">Título</h1>`), files: phone });
      try {
        const edit = async (device: string, value: string) => {
          await setDevice(s.page, device);
          await selectWhere(s.page, "#t1");
          await setStyle(s.page, "font-size", value);
        };
        if (order === "Celular e depois Desktop") {
          await edit("mobile", "26px");
          await edit("desktop", "60px");
        } else {
          await edit("desktop", "60px");
          await edit("mobile", "26px");
        }
        expect((await toasts(s.page)).filter((t) => t.message.includes("No celular")).length).toBe(1);
        await setDevice(s.page, "mobile");
        expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["26px"]);
        await setDevice(s.page, "desktop");
        expect(await canvasAll(s.page, "h1", "font-size")).toEqual(["60px"]);
        const out = await exportDoc(s.page);
        expect(out.css).toContain(":is(#t1)");
        const final = finalizeFromEditor(out.html, out.css);
        const at = async (width: number) => (await finalAll(phone, final, width, "h1", "font-size"))[0];
        expect([await at(390), await at(600), await at(700), await at(1280)]).toEqual(["26px", "24px", "24px", "60px"]);
      } finally {
        await s.page.close();
      }
    });
  }

  it("edições !important no Tablet e no Celular (em qualquer ordem): canvas igual à página final", async () => {
    const important: Files = {
      "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
      "/os-assets/theme.css":
        ".title{font-size:48px !important} @media (max-width:767px){.title{font-size:24px !important}}" +
        " .sub{font-size:18px !important}",
    };
    const s = await openApp(browser, {
      html: pageWithBase(`<h1 id="t1" class="title">Título</h1><p id="p1" class="sub">Sub</p>`),
      files: important,
    });
    try {
      // Tablet com !important: o celular continua com o original (!important também).
      await setDevice(s.page, "tablet");
      await selectWhere(s.page, "#t1");
      await setStyle(s.page, "font-size", "36px");
      expect(await canvasAll(s.page, "#t1", "font-size")).toEqual(["36px"]);
      // #p1: primeiro o Celular, depois o Tablet (a regra do Tablet é criada depois).
      await setDevice(s.page, "mobile");
      await selectWhere(s.page, "#p1");
      await setStyle(s.page, "font-size", "20px");
      await setDevice(s.page, "tablet");
      await selectWhere(s.page, "#p1");
      await setStyle(s.page, "font-size", "30px");
      expect(await canvasAll(s.page, "#p1", "font-size")).toEqual(["30px"]);
      await setDevice(s.page, "mobile");
      const canvas = [
        ...(await canvasAll(s.page, "#t1", "font-size")),
        ...(await canvasAll(s.page, "#p1", "font-size")),
      ];
      expect(canvas).toEqual(["24px", "20px"]);
      const out = await exportDoc(s.page);
      expect(out.css).toContain("font-size:36px !important");
      const final = finalizeFromEditor(out.html, out.css);
      const at = async (width: number) => [
        ...(await finalAll(important, final, width, "#t1", "font-size")),
        ...(await finalAll(important, final, width, "#p1", "font-size")),
      ];
      expect(await at(375)).toEqual(canvas);
      expect(await at(800)).toEqual(["36px", "30px"]);
      expect(await at(1280)).toEqual(["48px", "18px"]);
    } finally {
      await s.page.close();
    }
  });

  it("importantFixCss: a cópia os-fix da edição do Tablet fica fora da faixa do celular; a do Celular não", () => {
    const css =
      "@media (max-width: 992px){#t1{font-size:36px !important;}}" +
      "@media (max-width: 767px){:is(#t1){font-size:revert-layer !important;}}" +
      "@media (max-width: 480px){#t1{font-size:20px !important;}}";
    const fix = importantFixCss(css);
    expect(fix).toContain(
      "@media (max-width: 992px){@media not all and (max-width: 767px){#t1{font-size:36px!important}}}",
    );
    expect(fix).toContain("@media (max-width: 480px){#t1{font-size:20px!important}}");
    expect(fix).not.toContain("revert-layer");
  });
});

// ─── #23, #35, #55, #32 ──────────────────────────────────────────────────────

describe("#23 página com [hidden]{display:none!important} (Bootstrap)", () => {
  it("popup de saída e notificação de compra aparecem no canvas (e as marcas de link também)", async () => {
    const files: Files = {
      "/os-assets/base.css": baseSheet(["/os-assets/bs.css"]),
      "/os-assets/bs.css": "[hidden]{display:none!important} a{outline:none!important}",
    };
    const s = await openApp(browser, {
      html: pageWithBase(`<h1>Oferta</h1><a id="l" href="#" data-os-link="checkout">Comprar</a>`),
      files,
    });
    try {
      const out = await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        for (const id of ["popup-saida", "notificacao-compra"]) {
          ed.getWrapper()?.append(ed.Blocks.get(id)?.get("content") as never);
        }
        await new Promise((r) => setTimeout(r, 150));
        const doc = ed.Canvas.getDocument() as Document;
        const win = ed.Canvas.getWindow();
        const widgets = ["exit-popup", "sales-notification"].map((w) => {
          const el = doc.querySelector(`[data-os-widget="${w}"]`) as HTMLElement;
          return { display: win.getComputedStyle(el).display, height: el.getBoundingClientRect().height };
        });
        const link = win.getComputedStyle(doc.getElementById("l") as HTMLElement).outlineStyle;
        return { widgets, link, html: ed.getHtml() };
      });
      for (const w of out.widgets) {
        expect(w.display).toBe("block");
        expect(w.height).toBeGreaterThan(0);
      }
      expect(out.link).toBe("dashed");
      // Continuam escondidos na página (o atributo fica no HTML).
      expect(out.html).toMatch(/data-os-widget="exit-popup"[^>]*hidden|hidden[^>]*data-os-widget="exit-popup"/);
    } finally {
      await s.page.close();
    }
  });
});

describe("#35 botão que não é <a> (data-os-href) ligado a um link da oferta", () => {
  it("'Endereço ao clicar' sai enquanto há link da oferta e volta (com https://) ao desligar", async () => {
    const s = await openApp(browser, {
      html: pageWithBase(
        `<button id="b" type="button" data-os-href="https://pay.hotmart.com/ORIGINAL" data-os-link="checkout">Comprar</button>`,
      ),
      files: { "/os-assets/base.css": "" },
      links: [{ key: "checkout", label: "Checkout Hotmart", url: "https://pay.hotmart.com/NOVO" }],
    });
    const traitsShown = () =>
      s.page.evaluate(() =>
        [...document.querySelectorAll("#traits .gjs-trt-trait")].map((el) => ({
          label: (el.querySelector(".gjs-label")?.textContent ?? "").trim(),
          text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
          input: (el.querySelector("input") as HTMLInputElement | null)?.value ?? null,
        })),
      );
    try {
      await selectWhere(s.page, "#b");
      let traits = await traitsShown();
      expect(traits.some((t) => t.label === "Endereço ao clicar")).toBe(false);
      expect(traits.find((t) => t.label === "Vai para")?.text).toContain("https://pay.hotmart.com/NOVO");
      expect(traits.some((t) => (t.input ?? "").includes("ORIGINAL"))).toBe(false);
      // Selecionar de novo não traz o campo de volta.
      await selectWhere(s.page, "body > *", 0);
      await selectWhere(s.page, "#b");
      traits = await traitsShown();
      expect(traits.filter((t) => t.label === "Endereço ao clicar")).toHaveLength(0);

      // "— nenhum —": o campo volta, no mesmo lugar, e o endereço digitado vale.
      await s.page.evaluate(async () => {
        (window as unknown as E2Window).ed.getSelected()?.getTrait("data-os-link")?.setValue("");
        await new Promise((r) => setTimeout(r, 100));
      });
      traits = await traitsShown();
      expect(traits.find((t) => t.label === "Endereço ao clicar")?.input).toBe("https://pay.hotmart.com/ORIGINAL");
      expect(traits.some((t) => t.label === "Vai para")).toBe(false);
      const field = s.page.locator("#traits .gjs-trt-trait", { hasText: "Endereço ao clicar" }).locator("input");
      await field.fill("meu.checkout.com/ok");
      await field.press("Enter");
      await s.page.waitForTimeout(150);
      const out = await exportDoc(s.page);
      const final = applyOfferLinks(finalizeFromEditor(out.html, out.css), [
        { key: "checkout", url: "https://pay.hotmart.com/NOVO" },
      ]);
      expect(/<button[^>]*>/.exec(final)?.[0]).toContain('data-os-href="https://meu.checkout.com/ok"');
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

describe("#55 'Endereço do link' de um <a> comum (botões de páginas clonadas)", () => {
  it("meusite.com.br/obrigado vira https://meusite.com.br/obrigado; caminhos e âncoras ficam", async () => {
    const s = await openApp(browser, {
      html: pageWithBase(`<a id="l" class="elementor-button" href="https://pay.x.com/a">Comprar</a>`),
      files: { "/os-assets/base.css": "" },
    });
    try {
      await selectWhere(s.page, "#l");
      const field = s.page.locator("#traits .gjs-trt-trait", { hasText: "Endereço do link" }).locator("input");
      const typed = async (value: string) => {
        await field.fill(value);
        await field.press("Enter");
        await s.page.waitForTimeout(120);
        return s.page.evaluate(() => (window as unknown as E2Window).ed.getSelected()?.getAttributes().href);
      };
      expect(await typed("meusite.com.br/obrigado")).toBe("https://meusite.com.br/obrigado");
      expect(await field.inputValue()).toBe("https://meusite.com.br/obrigado");
      expect(await typed("obrigado.html")).toBe("obrigado.html");
      expect(await typed("#oferta")).toBe("#oferta");
      expect(await typed("/obrigado")).toBe("/obrigado");
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

describe("#32 espaçamento: mudar um lado não zera os outros", () => {
  it("padding-top novo; os outros lados continuam com o valor que a dica mostrava", async () => {
    const files: Files = {
      "/os-assets/base.css": baseSheet(["/os-assets/a.css"]),
      "/os-assets/a.css": ".box{padding:40px 24px} .c{margin:0 auto;width:200px}",
    };
    const s = await openApp(browser, {
      html: pageWithBase(`<section id="s" class="box"><h1>Oferta</h1><div id="c" class="c">caixa</div></section>`),
      files,
    });
    const side = (prop: string, which: string) =>
      s.page.evaluate(
        ([p, w]) => {
          const input = document.querySelector<HTMLInputElement>(
            `#styles .gjs-sm-property__${p} .gjs-sm-property__${p}-${w} input`,
          );
          return { value: input?.value ?? "", placeholder: input?.getAttribute("placeholder") ?? "" };
        },
        [prop, which] as const,
      );
    const typeSide = (prop: string, which: string, value: string) =>
      s.page.evaluate(
        async ([p, w, v]) => {
          const input = document.querySelector<HTMLInputElement>(
            `#styles .gjs-sm-property__${p} .gjs-sm-property__${p}-${w} input`,
          ) as HTMLInputElement;
          input.value = v;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          await new Promise((r) => setTimeout(r, 200));
        },
        [prop, which, value] as const,
      );
    try {
      await selectWhere(s.page, "#s");
      await s.page.waitForTimeout(150);
      expect((await side("padding", "left")).placeholder).toBe("24px");
      await typeSide("padding", "top", "60");
      const css = (await exportDoc(s.page)).css;
      expect(css).toContain("#s{padding-top:60px;}");
      expect(await canvasAll(s.page, "#s", "padding-top")).toEqual(["60px"]);
      expect(await canvasAll(s.page, "#s", "padding-left")).toEqual(["24px"]);
      expect(await canvasAll(s.page, "#s", "padding-bottom")).toEqual(["40px"]);
      expect(await side("padding", "left")).toEqual({ value: "", placeholder: "24px" });

      // margin: 0 auto (centralizado): mudar o topo mantém o centro.
      await selectWhere(s.page, "#c");
      const leftBefore = await s.page.evaluate(() => {
        const ed = (window as unknown as E2Window).ed;
        return ((ed.Canvas.getDocument() as Document).getElementById("c") as HTMLElement).getBoundingClientRect().left;
      });
      await typeSide("margin", "top", "30");
      const after = await s.page.evaluate(() => {
        const ed = (window as unknown as E2Window).ed;
        const el = (ed.Canvas.getDocument() as Document).getElementById("c") as HTMLElement;
        return { left: el.getBoundingClientRect().left, css: ed.getCss({ avoidProtected: true }) ?? "" };
      });
      expect(after.css).toContain("#c{margin-top:30px;}");
      expect(after.left).toBeCloseTo(leftBefore, 0);
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});
