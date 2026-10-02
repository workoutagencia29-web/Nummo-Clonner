/**
 * Fase 3 — integração das correções #46 (!important no CSS original) e #49
 * (valor próprio do celular), no Chromium: quando a propriedade é !important no
 * original E tem valor próprio no celular, a edição no Desktop vira !important
 * (vai para a camada os-fix) e o valor mantido no celular precisa vencer essa
 * cópia — no canvas e na página final (finalizeFromEditor de verdade).
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { outsideMedia } from "@/lib/css-keep";
import { finalizeFromEditor, importantFixCss } from "@/lib/editor-html";
import { baseSheet, type E2Window, ORIGIN, openApp, pageWithBase, toasts } from "./fix3-E2-harness";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

async function setStyle(page: Page, property: string, value: string) {
  await page.evaluate(
    async ([prop, val]) => {
      const ed = (window as unknown as E2Window).ed;
      const input = document.querySelector<HTMLInputElement>(`#styles .gjs-sm-property__${prop} input`);
      if (!input) throw new Error(`campo ${prop} não encontrado`);
      input.value = val;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      void ed;
    },
    [property, value] as const,
  );
}

async function computed(page: Page, id: string, prop: string) {
  return page.evaluate(
    ([cid, p]) => {
      const ed = (window as unknown as E2Window).ed;
      const el = (ed.Canvas.getDocument() as Document).getElementById(cid) as HTMLElement;
      return ed.Canvas.getWindow().getComputedStyle(el).getPropertyValue(p);
    },
    [id, prop] as const,
  );
}

describe("#46 × #49: !important no original com valor próprio no celular", () => {
  const files = {
    "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
    "/os-assets/theme.css":
      ".title{font-size:48px !important;color:#111} @media (max-width:767px){.title{font-size:24px !important}}",
  };
  const body = `<h1 id="t1" class="title">Título</h1>`;

  it("o Desktop muda (com !important) e o celular continua com o valor original", async () => {
    const s = await openApp(browser, { html: pageWithBase(body), files });
    try {
      await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        ed.select(ed.getWrapper()?.find("#t1")[0] as never);
        await new Promise((r) => setTimeout(r, 120));
      });
      await setStyle(s.page, "font-size", "60px");
      await s.page.waitForTimeout(100);
      expect(await computed(s.page, "t1", "font-size")).toBe("60px");
      const css = await s.page.evaluate(
        () => (window as unknown as E2Window).ed.getCss({ avoidProtected: true }) ?? "",
      );
      expect(css).toMatch(/#t1\{[^}]*font-size:60px !important/);
      expect(css).toMatch(/:is\(#t1\)\{font-size:revert-layer !important;\}/);

      // Canvas no modo Celular: o 24px original.
      await s.page.evaluate(async () => {
        (window as unknown as E2Window).ed.setDevice("mobile");
        await new Promise((r) => setTimeout(r, 450));
      });
      expect(await computed(s.page, "t1", "font-size")).toBe("24px");

      // Uma edição feita no modo Celular vence ali (e só até 480px).
      await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        ed.select(ed.getWrapper()?.find("#t1")[0] as never);
        await new Promise((r) => setTimeout(r, 120));
      });
      await setStyle(s.page, "font-size", "30px");
      await s.page.waitForTimeout(100);
      expect(await computed(s.page, "t1", "font-size")).toBe("30px");
      await s.page.evaluate(async () => {
        (window as unknown as E2Window).ed.setDevice("desktop");
        await new Promise((r) => setTimeout(r, 450));
      });
      expect(await computed(s.page, "t1", "font-size")).toBe("60px");
      const finalCss = await s.page.evaluate(
        () => (window as unknown as E2Window).ed.getCss({ avoidProtected: true }) ?? "",
      );

      // Página final montada pelo salvar de verdade.
      const html = finalizeFromEditor(pageWithBase(body), finalCss);
      expect(html).not.toMatch(/@layer os-fix\{[^<]*revert-layer/);
      for (const [width, size] of [
        [1280, "60px"],
        [600, "24px"],
        [390, "30px"],
      ] as const) {
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        try {
          await page.route("**/*", (route) => {
            const url = new URL(route.request().url());
            if (url.pathname === "/p") return route.fulfill({ contentType: "text/html", body: html });
            const file = files[url.pathname as keyof typeof files];
            if (file !== undefined) return route.fulfill({ contentType: "text/css", body: file });
            return route.fulfill({ status: 204, body: "" });
          });
          await page.goto(`${ORIGIN}/p`);
          const got = await page.evaluate(
            () => getComputedStyle(document.getElementById("t1") as HTMLElement).fontSize,
          );
          expect(got, `largura ${width}`).toBe(size);
        } finally {
          await page.close();
        }
      }
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

describe("cópia os-fix fora das media queries do celular mantido", () => {
  it("outsideMedia nega cada media query (listas viram níveis aninhados)", () => {
    expect(outsideMedia(["(max-width: 767px)"], "a{b:c}")).toBe("@media not all and (max-width: 767px){a{b:c}}");
    expect(outsideMedia(["only screen and (max-width: 767px), print"], "x")).toBe(
      "@media not screen and (max-width: 767px){@media not print{x}}",
    );
    expect(outsideMedia(["not print"], "x")).toBe("@media print{x}");
    expect(outsideMedia(["(min-width: 1px) or (max-width: 2px)"], "x")).toBe(
      "@media not all and ((min-width: 1px) or (max-width: 2px)){x}",
    );
    expect(outsideMedia(["(max-width: 767px)", "(max-width: 480px)", "(max-width: 767px)"], "x")).toBe(
      "@media not all and (max-width: 767px){@media not all and (max-width: 480px){x}}",
    );
  });

  it("importantFixCss: a propriedade fixada sai das media queries; o revert-layer não entra na os-fix", () => {
    const css =
      "#t1{font-size:60px !important;color:blue !important;margin:0}" +
      "@media (max-width: 767px){:is(#t1){font-size:revert-layer !important;}}" +
      "@media (max-width: 480px){#t1{font-size:30px !important;}}";
    expect(importantFixCss(css)).toBe(
      "@layer os-fix{#t1{color:blue!important}" +
        "@media not all and (max-width: 767px){#t1{font-size:60px!important}}" +
        "@media (max-width: 480px){#t1{font-size:30px!important}}}",
    );
    // Sem regra fixa, igual a antes.
    expect(importantFixCss("#a{color:red !important}")).toBe("@layer os-fix{#a{color:red!important}}");
  });
});

describe("#49 × #47: versão celular separada (documento MOBILE)", () => {
  const files = {
    "/os-assets/base.css": baseSheet(["/os-assets/theme.css"]),
    "/os-assets/theme.css": ".title{font-size:48px} @media (max-width:767px){.title{font-size:24px}}",
  };

  it("editar no modo Desktop não cria regra que esconderia a edição dos celulares", async () => {
    const s = await openApp(browser, { html: pageWithBase(`<h1 id="t1" class="title">Título</h1>`), files });
    try {
      await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        // Como o editor-app faz para payload.device === "MOBILE".
        for (const d of ed.Devices.getDevices()) d.set("widthMedia", "");
        ed.setDevice("desktop");
        ed.select(ed.getWrapper()?.find("#t1")[0] as never);
        await new Promise((r) => setTimeout(r, 450));
      });
      await setStyle(s.page, "font-size", "60px");
      const css = await s.page.evaluate(
        () => (window as unknown as E2Window).ed.getCss({ avoidProtected: true }) ?? "",
      );
      expect(css).toMatch(/#t1\{[^}]*font-size:60px/);
      expect(css).not.toContain(":is(#t1)");
      const notes = await toasts(s.page);
      expect(notes.filter((t) => t.message.includes("No celular"))).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});
