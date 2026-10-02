/**
 * Fase 3 — correções E2 (segurança do editor), no Chromium de verdade:
 * - #0: atributos data-gjs-* (tipo "script", propriedade script, attributes)
 *   vindos da página nunca rodam código no painel, nem ao reabrir um projeto
 *   salvo que já os tenha;
 * - #1: nomes de fontes do CSS da página não viram HTML no painel de estilo;
 * - #2: nomes de páginas (e de links) não viram HTML nas listas de Configurações;
 * - #6 (índice 3): style="…" com ";" dentro de url(data:…) ou de aspas não
 *   quebra o CSS salvo.
 */
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stripGjsAttributes } from "@/editor/grapes/components";
import { familyValue, fontOptions } from "@/editor/grapes/setup";
import { parseInlineStyle } from "@/editor/grapes/style-parse";
import { baseSheet, type E2Window, openApp, pageWithBase } from "./fix3-E2-harness";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

/** Marca no painel (janela de cima) se algum código da página rodou. */
const PWN = "window.top.__pwned = (window.top.__pwned || 0) + 1";

describe("#0 data-gjs-* e scripts de componente", () => {
  const MALICIOUS = pageWithBase(
    `<h1 id="t">Oferta</h1>
<div id="a" data-gjs-type="script">${PWN}</div>
<div id="b" data-gjs-script="${PWN}">b</div>
<div id="c" data-gjs-attributes='{"onclick":"${PWN}","data-x":"1"}' data-gjs-name="&lt;img id=inj&gt;">c</div>
<div id="d" data-GJS-TYPE="script" data-gjs-src="/evil.js">d</div>`,
  );

  it("página importada: nada roda, nenhum <script> no canvas e o HTML salvo sai limpo", async () => {
    const s = await openApp(browser, { html: MALICIOUS, files: { "/os-assets/base.css": "" } });
    try {
      await s.page.waitForTimeout(300);
      const out = await s.page.evaluate(() => {
        const w = window as unknown as E2Window & { __pwned?: number };
        const ed = w.ed;
        const doc = ed.Canvas.getDocument() as Document;
        return {
          pwned: w.__pwned ?? 0,
          scripts: doc.querySelectorAll("script").length,
          types:
            ed
              .getWrapper()
              ?.find("#a, #b, #c, #d")
              .map((c) => String(c.get("type"))) ?? [],
          scriptProps: (ed.getWrapper()?.find("#b") ?? []).map((c) => String(c.get("script") ?? "")),
          html: ed.getHtml({ asDocument: true } as never),
          injected: Boolean(document.getElementById("inj")),
        };
      });
      expect(out.pwned).toBe(0);
      expect(out.scripts).toBe(0);
      expect(out.types).not.toContain("script");
      expect(out.scriptProps).toEqual([""]);
      expect(out.html).not.toMatch(/data-gjs-/i);
      expect(out.html).not.toMatch(/<script/i);
      expect(out.html).not.toMatch(/onclick/i);
      expect(out.injected).toBe(false);
      expect(s.external).toEqual([]);
    } finally {
      await s.page.close();
    }
  });

  it("colar/código do elemento (addComponents) também ignora data-gjs-*", async () => {
    const s = await openApp(browser, { html: pageWithBase("<p>oi</p>"), files: { "/os-assets/base.css": "" } });
    try {
      const out = await s.page.evaluate(async (pwn) => {
        const w = window as unknown as E2Window & { __pwned?: number };
        w.ed.addComponents(`<div data-gjs-type="script">${pwn}</div><div data-gjs-script="${pwn}">x</div>`);
        await new Promise((r) => setTimeout(r, 200));
        return {
          pwned: w.__pwned ?? 0,
          scripts: (w.ed.Canvas.getDocument() as Document).querySelectorAll("script").length,
          html: w.ed.getHtml(),
        };
      }, PWN);
      expect(out.pwned).toBe(0);
      expect(out.scripts).toBe(0);
      expect(out.html).not.toMatch(/data-gjs-|<script/i);
    } finally {
      await s.page.close();
    }
  });

  it("projeto salvo antes da correção (tipo script / propriedade script) reabre sem rodar nada", async () => {
    const project = {
      assets: [],
      styles: [],
      pages: [
        {
          frames: [
            {
              component: {
                type: "wrapper",
                components: [
                  { type: "script", components: [{ type: "textnode", content: PWN }] },
                  {
                    tagName: "div",
                    attributes: { id: "b" },
                    script: PWN,
                    components: [{ type: "textnode", content: "b" }],
                  },
                  { tagName: "script", components: [{ type: "textnode", content: PWN }] },
                ],
              },
            },
          ],
        },
      ],
    };
    const s = await openApp(browser, { project });
    try {
      await s.page.waitForTimeout(300);
      const out = await s.page.evaluate(() => {
        const w = window as unknown as E2Window & { __pwned?: number };
        return {
          pwned: w.__pwned ?? 0,
          scripts: (w.ed.Canvas.getDocument() as Document).querySelectorAll("script").length,
          html: w.ed.getHtml(),
        };
      });
      expect(out.pwned).toBe(0);
      expect(out.scripts).toBe(0);
      // O tipo "script" do GrapesJS não sai no HTML salvo.
      expect(out.html.match(/<script/gi)?.length ?? 0).toBeLessThanOrEqual(1);
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });

  it("stripGjsAttributes limpa a árvore do analisador (inclusive o nó DOM)", () => {
    const removed: string[] = [];
    const tree = {
      attributes: { "data-gjs-type": "script", "DATA-GJS-script": "x", class: "a" },
      __domNode: { removeAttribute: (n: string) => removed.push(n) },
      childNodes: [{ attributes: { "data-gjs-content": "<b>", id: "x" } }],
    };
    stripGjsAttributes(tree);
    expect(tree.attributes).toEqual({ class: "a" });
    expect(tree.childNodes[0].attributes).toEqual({ id: "x" });
    expect(removed).toEqual(["data-gjs-type", "DATA-GJS-script"]);
  });
});

describe("#1 nomes de fontes do CSS da página", () => {
  it("fontOptions escapa o nome e descarta nomes com marcação", () => {
    const opts = fontOptions(['Foo\'s "Bar"', "</option><b id=inj>", "x".repeat(150), "Montserrat"]);
    const labels = opts.map((o) => String(o.label));
    expect(labels).toContain("Foo&#39;s &#34;Bar&#34; · usada na página");
    expect(labels).toContain("Montserrat · usada na página");
    expect(labels.some((l) => l.includes("<") || l.includes("inj"))).toBe(false);
    expect(labels.some((l) => l.startsWith("xxxx"))).toBe(false);
    expect(opts.find((o) => String(o.label).startsWith("Montserrat"))?.id).toBe(familyValue("Montserrat"));
  });

  it("@font-face com marcação no nome não entra no painel nem redireciona", async () => {
    const evil = `</option></select><b id=inj>x</b><meta http-equiv=refresh content='1;url=https://evil.example/phish'>`;
    const s = await openApp(browser, {
      html: pageWithBase(`<h1 id="t">Oferta</h1>`),
      files: {
        "/os-assets/base.css": baseSheet(["/os-assets/inner.css"]),
        "/os-assets/inner.css": `@font-face{font-family:"${evil}";src:url(/os-assets/f.woff2)}\n@font-face{font-family:"Montserrat";src:url(/os-assets/m.woff2)}`,
      },
    });
    try {
      await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        ed.select(ed.getWrapper()?.find("#t")[0]);
        await new Promise((r) => setTimeout(r, 1500));
      });
      const out = await s.page.evaluate(() => ({
        url: location.href,
        injected: Boolean(document.getElementById("inj")),
        metas: document.querySelectorAll("meta[http-equiv]").length,
        options: [...document.querySelectorAll(".gjs-sm-property__font-family option")].map((o) => o.textContent),
      }));
      expect(out.url).toBe("http://editor.test/");
      expect(out.injected).toBe(false);
      expect(out.metas).toBe(0);
      expect(out.options).toContain("Montserrat · usada na página");
      expect(out.options.some((o) => o?.includes("evil"))).toBe(false);
    } finally {
      await s.page.close();
    }
  });
});

describe("#2 nomes de páginas e links nas listas", () => {
  it("nome de página com marcação aparece como texto e não injeta nada no painel", async () => {
    const evil = `<div id=pg><meta http-equiv="refresh" content="1;url=https://evil.example/p"></div>`;
    const s = await openApp(browser, {
      html: pageWithBase(`<a id="l" href="#">Comprar</a>`),
      files: { "/os-assets/base.css": "" },
      pages: [
        { id: "pagina0000000000000001", name: "Principal" },
        { id: "pagina0000000000000002", name: evil },
      ],
      links: [{ key: "checkout", label: `<img id=lk src=x>Checkout`, url: "https://pay.example/x" }],
    });
    try {
      await s.page.evaluate(async () => {
        const ed = (window as unknown as E2Window).ed;
        ed.select(ed.getWrapper()?.find("#l")[0]);
        await new Promise((r) => setTimeout(r, 1500));
      });
      const out = await s.page.evaluate(() => ({
        url: location.href,
        injected: Boolean(document.getElementById("pg") || document.getElementById("lk")),
        metas: document.querySelectorAll("meta[http-equiv]").length,
        options: [...document.querySelectorAll("#traits option")].map((o) => o.textContent ?? ""),
      }));
      expect(out.url).toBe("http://editor.test/");
      expect(out.injected).toBe(false);
      expect(out.metas).toBe(0);
      expect(out.options).toContain(evil);
      expect(out.options).toContain("<img id=lk src=x>Checkout");
    } finally {
      await s.page.close();
    }
  });
});

describe("#3 style com ';' dentro de url(data:…) ou aspas", () => {
  it("parseInlineStyle só separa fora de aspas e parênteses", () => {
    expect(parseInlineStyle("background-image:url(data:image/svg+xml;base64,PHN2Zz4=);height:10px")).toEqual({
      "background-image": "url(data:image/svg+xml;base64,PHN2Zz4=)",
      height: "10px",
    });
    expect(parseInlineStyle("font-family:'Foo;Bar', serif; color : blue ;")).toEqual({
      "font-family": "'Foo;Bar', serif",
      color: "blue",
    });
    expect(parseInlineStyle('content:"a\\";b";/* x;y */color:red')).toEqual({ content: '"a\\";b"', color: "red" });
    // Chave repetida (fallback) continua como lista, a última vale.
    expect(parseInlineStyle("display:-webkit-box;display:flex")).toEqual({ display: ["-webkit-box", "flex"] });
  });

  it("CSS salvo continua válido: as regras seguintes (e as edições) valem na página", async () => {
    const svg = "PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPScxMCcgaGVpZ2h0PScxMCcvPg==";
    const s = await openApp(browser, {
      html: pageWithBase(
        `<div id="a" style="background-image:url(data:image/svg+xml;base64,${svg});height:10px">a</div>` +
          `<div id="c" style="font-family:'Foo;Bar', serif;color:blue">c</div>` +
          `<div id="b" style="color:rgb(255, 0, 0)">b</div>`,
      ),
      files: { "/os-assets/base.css": "" },
    });
    try {
      const css = await s.page.evaluate(() => {
        const ed = (window as unknown as E2Window).ed;
        ed.getWrapper()?.find("#b")[0].addStyle({ "font-size": "30px" });
        return ed.getCss({ avoidProtected: true }) ?? "";
      });
      expect(css).toContain(`url(data:image/svg+xml;base64,${svg})`);
      expect(css).toContain("font-family:'Foo;Bar', serif");
      // A página final (CSS numa linha): #b continua vermelho e com a edição.
      const page = await browser.newPage();
      try {
        await page.setContent(
          `<style>${css.replace(/\n/g, "")}</style><div id="a">a</div><div id="c">c</div><div id="b">b</div>`,
        );
        const computed = await page.evaluate(() => {
          const cs = (id: string) => getComputedStyle(document.getElementById(id) as HTMLElement);
          return {
            b: cs("b").color,
            bSize: cs("b").fontSize,
            aBg: cs("a").backgroundImage,
            aH: cs("a").height,
            c: cs("c").color,
          };
        });
        expect(computed).toEqual({
          b: "rgb(255, 0, 0)",
          bSize: "30px",
          aBg: expect.stringContaining("data:image/svg+xml;base64"),
          aH: "10px",
          c: "rgb(0, 0, 255)",
        });
      } finally {
        await page.close();
      }
    } finally {
      await s.page.close();
    }
  });
});
