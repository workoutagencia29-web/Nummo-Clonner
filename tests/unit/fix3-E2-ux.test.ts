/**
 * Fase 3 — correções E2 (experiência no editor), no Chromium de verdade com o
 * layout do painel (esquerda 288px, direita 320px, janela 1280×800):
 * - #23: CSS dos widgets no canvas sobrevive à primeira abertura (asDocument);
 * - #26: "Desktop" com largura de computador (1280px), reduzido para caber;
 * - #30: "Página do funil" → "— nenhuma —" desfaz o link e a lista acompanha;
 * - #32: campos de estilo mostram o valor atual do elemento;
 * - #33: "Trocar imagem" em Configurações e na barra do elemento;
 * - #35: elemento ligado a link da oferta mostra "Vai para" no lugar do endereço;
 * - #36: ícones dos blocos sem preenchimento;
 * - #37: seções com o título de dentro no nome (camadas);
 * - #38: barra do elemento com títulos em português.
 */
import type { Component } from "grapesjs";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fitDevice } from "@/editor/grapes/canvas-fit";
import { friendlyValue } from "@/editor/grapes/style-hints";
import { baseSheet, type E2Window, openApp, pageWithBase } from "./fix3-E2-harness";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

const PAGE_A = "pagina0000000000000001";
const PAGE_B = "pagina0000000000000002";
const PAGES = [
  { id: PAGE_A, name: "Principal" },
  { id: PAGE_B, name: "Obrigado" },
];

async function select(page: Page, selector: string) {
  await page.evaluate(async (sel) => {
    const ed = (window as unknown as E2Window).ed;
    ed.select(ed.getWrapper()?.find(sel)[0] as Component);
    await new Promise((r) => setTimeout(r, 120));
  }, selector);
}

async function deselect(page: Page) {
  await page.evaluate(async () => {
    (window as unknown as E2Window).ed.select(undefined as never);
    await new Promise((r) => setTimeout(r, 50));
  });
}

/** Rótulos e valores das configurações mostradas. */
function traitsShown(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("#traits .gjs-trt-trait")].map((el) => ({
      label: (el.querySelector(".gjs-label")?.textContent ?? "").trim(),
      text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
      select: (el.querySelector("select") as HTMLSelectElement | null)?.value ?? null,
      input: (el.querySelector("input") as HTMLInputElement | null)?.value ?? null,
    })),
  );
}

describe("#23 CSS dos widgets na primeira abertura (asDocument)", () => {
  it("popup de saída, notificação e aviso de botão sem link aparecem no canvas", async () => {
    const s = await openApp(browser, {
      html: pageWithBase(`<h1>Oferta</h1><a class="os-btn" href="#" data-os-link="" id="buy">Comprar</a>`),
      files: { "/os-assets/base.css": "" },
    });
    try {
      const out = await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        const add = (id: string) => ed.getWrapper()?.append(ed.Blocks.get(id)?.get("content") as never)[0];
        const popup = add("popup-saida");
        const note = add("notificacao-compra");
        await new Promise((r) => setTimeout(r, 100));
        const win = ed.Canvas.getWindow();
        const doc = ed.Canvas.getDocument() as Document;
        const cs = (el: HTMLElement | undefined) => (el ? win.getComputedStyle(el) : null);
        return {
          popupDisplay: cs(popup?.getEl() as HTMLElement)?.display,
          popupHeight: (popup?.getEl() as HTMLElement).getBoundingClientRect().height,
          noteDisplay: cs(note?.getEl() as HTMLElement)?.display,
          buyLabel: win.getComputedStyle(doc.getElementById("buy") as HTMLElement, "::after").content,
        };
      });
      expect(out.popupDisplay).not.toBe("none");
      expect(out.popupHeight).toBeGreaterThan(20);
      expect(out.noteDisplay).not.toBe("none");
      expect(out.buyLabel).toContain("Escolha o link da oferta");
      // Nada disso vai para o HTML salvo.
      const html = await s.page.evaluate(() =>
        (window as unknown as E2Window).ed.getHtml({ asDocument: true } as never),
      );
      expect(html).not.toContain("Escolha o link da oferta");
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

describe("#26 Desktop com largura de computador", () => {
  it("fitDevice: reduz só o que não cabe, centralizado e com a altura toda", () => {
    expect(fitDevice(375, 672, 800)).toMatchObject({ scale: 1, height: null, left: 148.5 });
    const desk = fitDevice(1280, 672, 800);
    expect(desk.scale).toBeCloseTo(640 / 1280);
    expect(desk.left).toBeCloseTo(16);
    expect((desk.height ?? 0) * desk.scale).toBeCloseTo(800);
    expect(fitDevice(1280, 1400, 800).scale).toBe(1);
  });

  it("o canvas tem 1280px de largura no Desktop, cabe na área e as regras de tablet não valem ali", async () => {
    const s = await openApp(browser, {
      html: pageWithBase(`<section><h1 id="t" class="title">Título da oferta</h1></section>`),
      files: {
        "/os-assets/base.css": baseSheet(["/os-assets/a.css"]),
        "/os-assets/a.css": ".title{font-size:48px} @media (max-width:767px){.title{font-size:24px}}",
      },
    });
    try {
      const frame = () =>
        s.page.evaluate(() => {
          const ed = (window as unknown as E2Window).ed;
          const el = ed.Canvas.getFrameEl();
          const box = el.getBoundingClientRect();
          const area = (document.getElementById("canvas") as HTMLElement).getBoundingClientRect();
          return {
            inner: el.contentWindow?.innerWidth ?? 0,
            left: box.left - area.left,
            right: area.right - box.right,
            height: box.height,
            areaHeight: area.height,
            zoom: ed.Canvas.getZoom(),
            h1: ed.Canvas.getWindow().getComputedStyle(
              (ed.Canvas.getDocument() as Document).getElementById("t") as HTMLElement,
            ).fontSize,
          };
        });
      await s.page.waitForFunction(() => (window as unknown as E2Window).ed.Canvas.getZoom() < 100);
      await s.page.waitForTimeout(500);
      const desk = await frame();
      expect(desk.inner).toBe(1280);
      expect(desk.left).toBeGreaterThanOrEqual(0);
      expect(desk.right).toBeGreaterThanOrEqual(0);
      expect(desk.height).toBeCloseTo(desk.areaHeight, 0);
      // O CSS de celular da página (767px) não vale no Desktop.
      expect(desk.h1).toBe("48px");

      // Tablet: 20px; Desktop: 64px → no Desktop vale 64px.
      const dirtyBefore = await s.page.evaluate(() => (window as unknown as E2Window).ed.getDirtyCount());
      await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        ed.select(ed.getWrapper()?.find("#t")[0] as Component);
        ed.setDevice("tablet");
        await wait(500);
        ed.StyleManager.getProperty("tipografia", "font-size")?.upValue("20px");
        ed.setDevice("desktop");
        await wait(500);
        ed.StyleManager.getProperty("tipografia", "font-size")?.upValue("64px");
        await wait(100);
      });
      const after = await frame();
      expect(after.h1).toBe("64px");
      const css = await s.page.evaluate(() => (window as unknown as E2Window).ed.getCss() ?? "");
      expect(css).toMatch(/#t\{font-size:64px;\}/);
      expect(css).toMatch(/@media \(max-width: 992px\)\{#t\{font-size:20px;\}\}/);
      // Só as duas edições contam como alteração (ajustar o zoom não conta).
      const dirtyAfter = await s.page.evaluate(() => (window as unknown as E2Window).ed.getDirtyCount());
      expect(dirtyAfter - dirtyBefore).toBeLessThanOrEqual(2);

      // Celular: tamanho real, sem zoom.
      await s.page.evaluate(() => {
        (window as unknown as E2Window).ed.setDevice("mobile");
      });
      await s.page.waitForFunction(() => (window as unknown as E2Window).ed.Canvas.getZoom() === 100);
      await s.page.waitForTimeout(500);
      const mob = await frame();
      expect(mob.inner).toBe(375);

      // Janela maior: o Desktop volta com menos redução.
      await s.page.evaluate(() => {
        (window as unknown as E2Window).ed.setDevice("desktop");
      });
      await s.page.waitForFunction(() => (window as unknown as E2Window).ed.Canvas.getZoom() < 100);
      const zoomSmall = await s.page.evaluate(() => (window as unknown as E2Window).ed.Canvas.getZoom());
      await s.page.setViewportSize({ width: 1600, height: 900 });
      await s.page.waitForFunction((z) => (window as unknown as E2Window).ed.Canvas.getZoom() > z, zoomSmall);
      await s.page.waitForTimeout(500);
      const wide = await frame();
      expect(wide.inner).toBe(1280);
      expect(wide.left).toBeGreaterThanOrEqual(0);
      expect(wide.right).toBeGreaterThanOrEqual(0);
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });

  it("selecionar no canvas reduzido acerta o elemento (barra e contorno no lugar)", async () => {
    const s = await openApp(browser, {
      html: pageWithBase(`<h1 id="t" style="margin:40px">Título</h1><p id="p">Parágrafo</p>`),
      files: { "/os-assets/base.css": "" },
    });
    try {
      await s.page.waitForFunction(() => (window as unknown as E2Window).ed.Canvas.getZoom() < 100);
      await s.page.waitForTimeout(500);
      const target = await s.page.evaluate(() => {
        const ed = (window as unknown as E2Window).ed;
        const frame = ed.Canvas.getFrameEl().getBoundingClientRect();
        const el = ((ed.Canvas.getDocument() as Document).getElementById("p") as HTMLElement).getBoundingClientRect();
        const z = ed.Canvas.getZoom() / 100;
        return { x: frame.left + (el.left + el.width / 4) * z, y: frame.top + (el.top + el.height / 2) * z };
      });
      await s.page.mouse.click(target.x, target.y);
      await s.page.waitForTimeout(200);
      const sel = await s.page.evaluate(() => (window as unknown as E2Window).ed.getSelected()?.getId());
      expect(sel).toBe("p");
    } finally {
      await s.page.close();
    }
  });
});

describe("#30 Página do funil", () => {
  it("'— nenhuma —' desfaz o link para a página e a lista mostra o valor real", async () => {
    const s = await openApp(browser, {
      html: pageWithBase(`<a id="l" href="os-page:${PAGE_B}">Ir</a><a id="m" href="#">Outro</a>`),
      files: { "/os-assets/base.css": "" },
      pages: PAGES,
    });
    try {
      await select(s.page, "#l");
      let traits = await traitsShown(s.page);
      expect(traits.find((t) => t.label === "Página do funil")?.select).toBe(PAGE_B);
      // Endereço interno (os-page:…) não aparece: no lugar, para onde vai.
      expect(traits.some((t) => t.input?.startsWith("os-page:"))).toBe(false);
      expect(traits.find((t) => t.label === "Vai para")?.text).toContain("Obrigado");
      const history = await s.page.evaluate(() => (window as unknown as E2Window).ed.UndoManager.hasUndo());
      expect(history).toBe(false);

      await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        ed.getSelected()?.getTrait("os-page")?.setValue("");
        await new Promise((r) => setTimeout(r, 100));
      });
      const href = await s.page.evaluate(() => (window as unknown as E2Window).ed.getSelected()?.getAttributes().href);
      expect(href).toBe("#");
      traits = await traitsShown(s.page);
      expect(traits.some((t) => t.label === "Endereço do link")).toBe(true);
      expect(traits.some((t) => t.label === "Vai para")).toBe(false);

      // O href muda por fora (código, localizar e substituir): ao reselecionar, a lista acompanha.
      await deselect(s.page);
      await s.page.evaluate((id) => {
        const ed = (window as unknown as E2Window).ed;
        ed.getWrapper()
          ?.find("#l")[0]
          .addAttributes({ href: `os-page:${id}` });
      }, PAGE_A);
      await select(s.page, "#l");
      traits = await traitsShown(s.page);
      expect(traits.find((t) => t.label === "Página do funil")?.select).toBe(PAGE_A);
      expect(traits.find((t) => t.label === "Vai para")?.text).toContain("Principal");
      // E ao escolher uma página, o link muda.
      await s.page.evaluate((id) => {
        (window as unknown as E2Window).ed.getSelected()?.getTrait("os-page")?.setValue(id);
      }, PAGE_B);
      expect(await s.page.evaluate(() => (window as unknown as E2Window).ed.getSelected()?.getAttributes().href)).toBe(
        `os-page:${PAGE_B}`,
      );
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

describe("link para uma página do funil que foi excluída", () => {
  it("oferta de uma página só: o endereço continua à vista para trocar (e a linha diz o que houve)", async () => {
    const s = await openApp(browser, {
      html: pageWithBase(
        `<a id="l" href="os-page:paginaexcluida00000001">Ir</a><a id="m" href="os-page:${PAGE_A}">Eu</a>`,
      ),
      files: { "/os-assets/base.css": "" },
      pages: [{ id: PAGE_A, name: "Principal" }],
    });
    try {
      await select(s.page, "#l");
      let traits = await traitsShown(s.page);
      expect(traits.some((t) => t.label === "Página do funil")).toBe(false);
      const dest = traits.find((t) => t.label === "Vai para");
      expect(dest?.text).toContain("Página do funil excluída");
      expect(dest?.text).toContain("troque o “Endereço do link”");
      const order = traits.map((t) => t.label);
      expect(order.indexOf("Vai para")).toBeLessThan(order.indexOf("Endereço do link"));
      // Troca pelo campo, como o usuário.
      await s.page
        .locator("#traits .gjs-trt-trait", { hasText: "Endereço do link" })
        .locator("input")
        .fill("https://meusite.com.br/obrigado");
      await s.page.keyboard.press("Enter");
      await s.page.waitForTimeout(150);
      expect(await s.page.evaluate(() => (window as unknown as E2Window).ed.getSelected()?.getAttributes().href)).toBe(
        "https://meusite.com.br/obrigado",
      );
      traits = await traitsShown(s.page);
      expect(traits.some((t) => t.label === "Vai para")).toBe(false);
      expect(traits.find((t) => t.label === "Endereço do link")?.input).toBe("https://meusite.com.br/obrigado");

      // Link para a própria (única) página: diz qual é e o campo continua.
      await select(s.page, "#m");
      traits = await traitsShown(s.page);
      expect(traits.find((t) => t.label === "Vai para")?.text).toContain("Página do funil: Principal");
      expect(traits.some((t) => t.label === "Endereço do link")).toBe(true);
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });

  it("oferta com mais páginas: a lista mostra '(página excluída)' e '— nenhuma —' desfaz o link", async () => {
    const s = await openApp(browser, {
      html: pageWithBase(`<a id="l" href="os-page:paginaexcluida00000001">Ir</a>`),
      files: { "/os-assets/base.css": "" },
      pages: PAGES,
    });
    try {
      await select(s.page, "#l");
      let traits = await traitsShown(s.page);
      const list = traits.find((t) => t.label === "Página do funil");
      expect(list?.select).toBe("paginaexcluida00000001");
      expect(list?.text).toContain("(página excluída)");
      expect(traits.find((t) => t.label === "Vai para")?.text).toContain("Escolha outra em Página do funil");
      expect(traits.some((t) => t.label === "Endereço do link")).toBe(false);
      // Como o usuário: escolhe "— nenhuma —" na lista (só dispara se o valor mudar).
      await s.page.locator("#traits .gjs-trt-trait", { hasText: "Página do funil" }).locator("select").selectOption("");
      await s.page.waitForTimeout(150);
      expect(await s.page.evaluate(() => (window as unknown as E2Window).ed.getSelected()?.getAttributes().href)).toBe(
        "#",
      );
      traits = await traitsShown(s.page);
      expect(traits.some((t) => t.label === "Endereço do link")).toBe(true);
      expect(traits.some((t) => t.label === "Vai para")).toBe(false);
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

describe("#35 elemento ligado a um link da oferta", () => {
  it("mostra 'Vai para' com o endereço do link no lugar do campo de endereço (e ele volta ao desligar)", async () => {
    const s = await openApp(browser, {
      html: pageWithBase(
        `<a id="l" href="https://pay.hotmart.com/ORIGINAL" data-os-link="checkout">Comprar</a>` +
          `<a id="b" class="os-btn" href="https://pay.hotmart.com/ORIGINAL" data-os-link="checkout">Botão</a>`,
      ),
      files: { "/os-assets/base.css": "" },
      links: [{ key: "checkout", label: "Checkout Hotmart", url: "https://pay.hotmart.com/NOVO" }],
    });
    try {
      await select(s.page, "#l");
      let traits = await traitsShown(s.page);
      expect(traits.some((t) => t.label === "Endereço do link")).toBe(false);
      const dest = traits.find((t) => t.label === "Vai para");
      expect(dest?.text).toContain("https://pay.hotmart.com/NOVO");
      expect(dest?.text).toContain("Links e checkouts");
      expect(traits.some((t) => (t.input ?? "").includes("ORIGINAL"))).toBe(false);

      await s.page.evaluate(() =>
        (window as unknown as E2Window).ed.getSelected()?.getTrait("data-os-link")?.setValue(""),
      );
      await s.page.waitForTimeout(100);
      traits = await traitsShown(s.page);
      expect(traits.find((t) => t.label === "Endereço do link")?.input).toBe("https://pay.hotmart.com/ORIGINAL");
      expect(traits.some((t) => t.label === "Vai para")).toBe(false);
      // A ordem continua: o endereço volta no mesmo lugar.
      const order = traits.map((t) => t.label);
      expect(order.indexOf("Endereço do link")).toBeLessThan(order.indexOf("Link da oferta"));

      // Botão do Offer Studio: o campo de endereço dele (que desliga o link ao digitar) volta igual.
      await select(s.page, "#b");
      traits = await traitsShown(s.page);
      expect(traits.some((t) => t.label === "Endereço do link")).toBe(false);
      await s.page.evaluate(() =>
        (window as unknown as E2Window).ed.getSelected()?.getTrait("data-os-link")?.setValue(""),
      );
      await s.page.waitForTimeout(100);
      traits = await traitsShown(s.page);
      expect(traits.some((t) => t.label === "Endereço do link")).toBe(true);
      await s.page.evaluate(() =>
        (window as unknown as E2Window).ed.getSelected()?.getTrait("href")?.setValue("meusite.com.br/x"),
      );
      expect(await s.page.evaluate(() => (window as unknown as E2Window).ed.getSelected()?.getAttributes().href)).toBe(
        "https://meusite.com.br/x",
      );
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

describe("#32 valores atuais no painel de estilo", () => {
  it("friendlyValue: px arredondado, cor em hex e palavras em português", () => {
    expect(friendlyValue("font-size", "36.288px")).toBe("36.3px");
    expect(friendlyValue("font-size", "36px")).toBe("36px");
    expect(friendlyValue("color", "rgb(17, 24, 39)")).toBe("#111827");
    expect(friendlyValue("background-color", "rgba(0, 0, 0, 0)")).toBe("");
    expect(friendlyValue("color", "rgba(0, 0, 0, 0.5)")).toBe("#000000 (50%)");
    expect(friendlyValue("max-width", "none")).toBe("sem limite");
    expect(friendlyValue("width", "auto")).toBe("automático");
  });

  it("título do modelo mostra tamanho, cor e espessura atuais (sem gravar nada)", async () => {
    const s = await openApp(browser, {
      html: pageWithBase(`<section><h1 id="t" class="os-h1">Oferta</h1></section>`),
      files: {
        "/os-assets/base.css": baseSheet(["/os-assets/a.css"]),
        "/os-assets/a.css": ".os-h1{font-size:36.288px;font-weight:700;color:#111827;line-height:1.2}",
      },
    });
    try {
      await select(s.page, "#t");
      await s.page.waitForTimeout(200);
      const shown = await s.page.evaluate(() => {
        const q = (id: string) => document.querySelector(`#styles .gjs-sm-property__${id}`);
        return {
          size: q("font-size")?.querySelector("input")?.getAttribute("placeholder"),
          color: q("color")?.querySelector("input")?.getAttribute("placeholder"),
          weight: q("font-weight")?.querySelector('option[value=""]')?.textContent,
          lineHeight: q("line-height")?.querySelector("input")?.getAttribute("placeholder"),
          css: (window as unknown as E2Window).ed.getCss() ?? "",
        };
      });
      expect(shown.size).toBe("36.3px");
      expect(shown.color).toBe("#111827");
      expect(shown.weight).toBe("Padrão · Negrito (700)");
      expect(shown.lineHeight).toBe("43.5px");
      expect(shown.css).not.toContain("#t{");
      // Sem nada selecionado, a dica volta a ser a padrão.
      await deselect(s.page);
      await s.page.waitForTimeout(150);
      expect(
        await s.page.evaluate(() =>
          document.querySelector("#styles .gjs-sm-property__font-size input")?.getAttribute("placeholder"),
        ),
      ).toBe("padrão");
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

describe("#32 espaçamento (margin/padding) mostra o valor atual", () => {
  it("cada lado mostra o espaçamento que o elemento tem (não '0')", async () => {
    const s = await openApp(browser, {
      html: pageWithBase(`<section id="s" class="box"><h1 id="t">Oferta</h1></section>`),
      files: {
        "/os-assets/base.css": baseSheet(["/os-assets/a.css"]),
        "/os-assets/a.css": ".box{padding:40px 24px;margin:12px 0}",
      },
    });
    try {
      await select(s.page, "#s");
      await s.page.waitForTimeout(200);
      const hints = () =>
        s.page.evaluate(() => {
          const out: Record<string, { placeholder: string | null; value: string }> = {};
          for (const side of ["top", "right", "bottom", "left"]) {
            for (const prop of ["padding", "margin"]) {
              const input = document.querySelector<HTMLInputElement>(
                `#styles .gjs-sm-property__${prop} .gjs-sm-property__${prop}-${side} input`,
              );
              out[`${prop}-${side}`] = {
                placeholder: input?.getAttribute("placeholder") ?? null,
                value: input?.value ?? "",
              };
            }
          }
          return out;
        });
      let shown = await hints();
      expect(shown["padding-top"]).toEqual({ placeholder: "40px", value: "" });
      expect(shown["padding-left"]).toEqual({ placeholder: "24px", value: "" });
      expect(shown["padding-bottom"].placeholder).toBe("40px");
      expect(shown["margin-top"].placeholder).toBe("12px");
      expect(shown["margin-left"].placeholder).toBe("0px");
      // Valor próprio num lado: o campo mostra o valor; os outros continuam com a dica.
      await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        ed.getSelected()?.addStyle({ "padding-top": "8px" });
        await new Promise((r) => setTimeout(r, 200));
      });
      shown = await hints();
      expect(shown["padding-top"].value).toBe("8");
      expect(shown["padding-left"].placeholder).toBe("24px");
      // Nada foi gravado só por mostrar as dicas.
      const css = await s.page.evaluate(() => (window as unknown as E2Window).ed.getCss() ?? "");
      expect(css).not.toMatch(/padding-left|margin/);
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

describe("#33 trocar imagem", () => {
  it("botão 'Trocar imagem' em Configurações e na barra do elemento abre a galeria", async () => {
    const s = await openApp(browser, {
      html: pageWithBase(`<img id="im" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="x">`),
      files: { "/os-assets/base.css": "" },
    });
    try {
      await select(s.page, "#im");
      const button = s.page.locator("#traits button", { hasText: "Trocar imagem" });
      expect(await button.count()).toBe(1);
      await button.click();
      expect(await s.page.evaluate(() => (window as unknown as E2Window).ed.Assets.isOpen())).toBe(true);
      await s.page.evaluate(() => (window as unknown as E2Window).ed.Assets.close());
      const tool = s.page.locator('.gjs-toolbar-item[title="Trocar imagem"]');
      expect(await tool.count()).toBe(1);
      await tool.dispatchEvent("mousedown");
      expect(await s.page.evaluate(() => (window as unknown as E2Window).ed.Assets.isOpen())).toBe(true);
      // Nada disso vai para o HTML.
      const html = await s.page.evaluate(() => (window as unknown as E2Window).ed.getHtml());
      expect(html).not.toMatch(/swap|Trocar/);
    } finally {
      await s.page.close();
    }
  });
});

describe("#36/#37/#38 blocos, camadas e barra do elemento", () => {
  it("ícones dos blocos são de contorno, seções têm o título no nome e a barra tem títulos", async () => {
    const s = await openApp(browser, {
      html: pageWithBase(
        `<section id="s1"><h2 id="h">E ainda leva bônus exclusivos para quem comprar hoje</h2></section>` +
          `<section id="s2"><h3>Garantia &amp; "segurança" &lt;b&gt;</h3></section>` +
          `<section id="s3" data-x="1"><p>sem título</p></section>`,
      ),
      files: { "/os-assets/base.css": "" },
    });
    try {
      const out = await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        const svg = document.querySelector("#blocks .gjs-block svg") as SVGElement;
        const shape = svg.querySelector("*") as SVGElement;
        const names = ed
          .getWrapper()
          ?.components()
          .map((c: Component) => c.getName());
        ed.getWrapper()?.find("#s3")[0].set("custom-name", "Minha seção");
        ed.select(ed.getWrapper()?.find("#h")[0] as Component);
        await new Promise((r) => setTimeout(r, 150));
        return {
          fill: getComputedStyle(shape).fill,
          names,
          custom: ed.getWrapper()?.find("#s3")[0].getName(),
          layers: [...document.querySelectorAll("#layers [data-name]")].map((e) => (e.textContent ?? "").trim()),
          toolbar: [...document.querySelectorAll(".gjs-toolbar-item")].map((e) => [
            e.getAttribute("title"),
            e.getAttribute("aria-label"),
          ]),
          injected: document.querySelectorAll("#layers b, .gjs-badge b").length,
        };
      });
      expect(out.fill).toBe("none");
      expect(out.names).toEqual([
        "Seção · E ainda leva bônus exclusivos para quem…",
        "Seção · Garantia segurança b",
        "Seção",
      ]);
      expect(out.custom).toBe("Minha seção");
      expect(out.layers).toContain("Seção · E ainda leva bônus exclusivos para quem…");
      expect(out.injected).toBe(0);
      expect(out.toolbar).toEqual([
        ["Selecionar o bloco de fora", "Selecionar o bloco de fora"],
        ["Arrastar para mover", "Arrastar para mover"],
        ["Duplicar", "Duplicar"],
        ["Excluir (Delete)", "Excluir (Delete)"],
      ]);
      // O nome calculado não vai para o projeto salvo.
      const project = await s.page.evaluate(() => JSON.stringify((window as unknown as E2Window).ed.getProjectData()));
      expect(project).not.toContain("E ainda leva bônus exclusivos para quem…");
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});
