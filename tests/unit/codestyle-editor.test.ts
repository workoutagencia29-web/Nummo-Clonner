/**
 * Editor visual no navegador (Chromium de verdade): painel de estilo em
 * português, seções com propriedades válidas, fontes da página, barra de texto,
 * seletor de cores e o editor de código (HTML do elemento, CSS da página e
 * códigos da página). A ação do servidor é trocada por uma versão falsa.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import type { Editor } from "grapesjs";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROPERTY_LABELS, SECTOR_NAMES } from "@/editor/grapes/i18n";
import type * as Setup from "@/editor/grapes/setup";
import type * as Dialog from "@/editor/panels/code-dialog";
import { finalizeFromEditor } from "@/lib/editor-html";

const ROOT = path.resolve(import.meta.dirname, "../..");

const ENGLISH_WORDS = [
  "the",
  "select",
  "selected",
  "image",
  "images",
  "add",
  "drop",
  "click",
  "upload",
  "layer",
  "layers",
  "settings",
  "style",
  "styles",
  "manager",
  "color",
  "width",
  "height",
  "top",
  "bottom",
  "left",
  "right",
  "none",
  "solid",
  "dotted",
  "dashed",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
  "block",
  "inline",
  "flex",
  "row",
  "column",
  "wrap",
  "nowrap",
  "start",
  "end",
  "center",
  "space",
  "between",
  "around",
  "evenly",
  "stretch",
  "baseline",
  "repeat",
  "cover",
  "contain",
  "scroll",
  "fixed",
  "static",
  "relative",
  "absolute",
  "sticky",
  "hover",
  "even",
  "odd",
  "bold",
  "italic",
  "underline",
  "strike",
  "thin",
  "light",
  "medium",
  "semi",
  "ultra",
  "outside",
  "inside",
  "type",
  "blur",
  "spread",
  "size",
  "position",
  "attachment",
  "property",
  "duration",
  "timing",
  "rotate",
  "scale",
  "box",
  "body",
  "text",
  "comment",
  "table",
  "cell",
  "head",
  "foot",
  "device",
  "mobile",
  "landscape",
  "portrait",
  "preview",
  "fullscreen",
  "code",
  "open",
  "blocks",
  "choose",
  "cancel",
  "more",
  "less",
  "clear",
  "selection",
  "window",
  "new",
  "here",
  "path",
  "label",
  "map",
  "video",
  "wrapper",
  "state",
  "sync",
  "general",
  "typography",
  "decorations",
  "dimension",
  "opacity",
  "shadow",
  "border",
  "radius",
  "margin",
  "padding",
  "font",
  "family",
  "weight",
  "align",
  "decoration",
  "transform",
  "transition",
  "display",
  "overflow",
  "visible",
  "hidden",
  "pointer",
  "default",
  "black",
  "white",
  "transparent",
  "eg",
];
const ENGLISH = new RegExp(`(?<!\\p{L})(${ENGLISH_WORDS.join("|")})(?!\\p{L})`, "iu");

interface CodeView {
  state: { doc: { toString(): string; length: number } };
  dispatch(spec: { changes: { from: number; to?: number; insert: string } }): void;
}
interface Harness {
  createEditor: typeof Setup.createEditor;
  SECTORS: typeof Setup.SECTORS;
  dialog: typeof Dialog;
  findView(el: Element): CodeView | null;
  sorted(html: string): string;
  mount(editor: Editor): void;
}
interface TestWindow {
  OS: Harness;
  ed: Editor;
  calls: [string, Record<string, string>][];
  dialogOpen: boolean;
  pageErrors: string[];
}

/** Ação falsa dos códigos da página (guarda em memória). */
const ACTION_STUB = `
let store = { head: "", bodyStart: "", bodyEnd: "" };
window.calls = [];
export async function getPageCodeAction(input) { window.calls.push(["get", input]); return { ok: true, data: { ...store } }; }
export async function savePageCodeAction(input) {
  window.calls.push(["save", input]);
  const { pageId, ...code } = input;
  store = { ...code };
  return { ok: true, data: { ...store } };
}`;

const ENTRY = `
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorView } from "@uiw/react-codemirror";
import { Toaster } from "sonner";
import { createEditor, SECTORS } from "./src/editor/grapes/setup";
import * as dialog from "./src/editor/panels/code-dialog";

function Host({ editor }: { editor: any }) {
  const [open, setOpen] = useState(true);
  (window as any).dialogOpen = open;
  return (
    <>
      <dialog.CodeDialog editor={editor} payload={{ page: { id: "pagina-1" } } as never} open={open} onOpenChange={setOpen} saveNow={async () => true} />
      <Toaster />
    </>
  );
}

(window as any).OS = {
  createEditor,
  SECTORS,
  dialog,
  findView: (el: Element) => EditorView.findFromDOM(el as HTMLElement),
  // HTML com atributos em ordem alfabética (a ordem pode mudar ao desfazer; o significado não).
  sorted: (html: string) => {
    const t = document.createElement("template");
    t.innerHTML = html;
    for (const el of Array.from(t.content.querySelectorAll("*"))) {
      const attrs = Array.from(el.attributes).map((a) => [a.name, a.value] as const);
      for (const [name] of attrs) el.removeAttribute(name);
      for (const [name, value] of attrs.sort(([a], [b]) => a.localeCompare(b))) el.setAttribute(name, value);
    }
    return t.innerHTML;
  },
  mount: (editor: any) => createRoot(document.getElementById("app")!).render(<Host editor={editor} />),
};`;

let browser: Browser;
let pageHtml: string;

beforeAll(async () => {
  const result = await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" },
    bundle: true,
    format: "iife",
    write: false,
    absWorkingDir: ROOT,
    tsconfig: path.join(ROOT, "tsconfig.json"),
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "empty" },
    logLevel: "silent",
    plugins: [
      {
        name: "acao-falsa",
        setup(b) {
          b.onResolve({ filter: /^@\/server\/actions\/page-code$/ }, () => ({ path: "page-code", namespace: "stub" }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: ACTION_STUB, loader: "js" }));
        },
      },
    ],
  });
  const js = result.outputFiles[0].text;
  const grapesCss = await readFile(path.join(ROOT, "node_modules/grapesjs/dist/css/grapes.min.css"), "utf8");
  const editorCss = await readFile(path.join(ROOT, "src/editor/grapes/editor.css"), "utf8");
  const globals = await readFile(path.join(ROOT, "src/app/globals.css"), "utf8");
  const tokens = /:root \{\n {2}--radius[\s\S]*?\n\}/.exec(globals)?.[0] ?? "";
  pageHtml = `<!doctype html><html class="light"><head><meta charset="utf-8">
<style>${tokens}</style><style>${grapesCss}</style><style>${editorCss}</style></head>
<body class="os-editor" style="margin:0">
<div style="display:flex;height:900px">
  <aside class="os-panel" style="width:288px;overflow:auto"><div id="layers"></div><div id="blocks"></div></aside>
  <main style="flex:1"><div id="canvas" style="height:100%"></div></main>
  <aside class="os-panel" style="width:320px;overflow:auto"><div id="selectors"></div><div id="styles"></div><div id="traits"></div></aside>
</div>
<div id="app"></div>
<script>window.pageErrors = []; window.addEventListener("error", (e) => window.pageErrors.push(String(e.message)));</script>
<script>${js}</script></body></html>`;
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

/** Abre o editor com o conteúdo e seleciona o primeiro elemento que casar com `select`. */
async function openEditor(content: string, select?: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent(pageHtml);
  await page.evaluate(
    async ({ content, select }) => {
      const w = window as unknown as TestWindow;
      const el = (id: string) => document.getElementById(id) as HTMLElement;
      const ed = w.OS.createEditor(
        {
          canvas: el("canvas"),
          blocks: el("blocks"),
          layers: el("layers"),
          styles: el("styles"),
          traits: el("traits"),
        },
        null,
      );
      w.ed = ed;
      await new Promise<void>((resolve) => ed.on("load", () => resolve()));
      el("selectors").appendChild(ed.SelectorManager.render([]));
      ed.setComponents(content);
      if (select) ed.select(ed.getWrapper()?.find(select)[0]);
      await new Promise((r) => setTimeout(r, 50));
    },
    { content, select },
  );
  return page;
}

async function select(page: Page, selector: string) {
  await page.evaluate(async (selector) => {
    const w = window as unknown as TestWindow;
    w.ed.select(w.ed.getWrapper()?.find(selector)[0]);
    await new Promise((r) => setTimeout(r, 50));
  }, selector);
}

/** Textos visíveis (e títulos/placeholders) dos painéis nativos, menos nomes de fontes e unidades. */
function panelTexts(page: Page) {
  return page.evaluate(() => {
    const out = new Set<string>();
    for (const id of ["selectors", "styles", "traits", "layers"]) {
      const root = document.getElementById(id) as HTMLElement;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement;
        if (parent?.closest(".gjs-sm-property__font-family select, .gjs-input-unit")) continue;
        const text = node.textContent?.trim();
        if (text) out.add(text);
      }
      for (const el of Array.from(root.querySelectorAll("[title], [placeholder]"))) {
        const title = el.getAttribute("title");
        const placeholder = el.getAttribute("placeholder");
        if (title) out.add(title);
        if (placeholder) out.add(placeholder);
      }
    }
    return [...out];
  });
}

describe("painel de estilo e configurações em português", () => {
  it("abre em português e as seções só usam propriedades válidas do GrapesJS", async () => {
    const page = await openEditor(`<section><h1>Oferta</h1></section>`, "h1");
    const report = await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      const sm = w.ed.StyleManager;
      const problems: string[] = [];
      const labels: [string, string][] = [];
      const options: [string, string][] = [];
      for (const sector of w.OS.SECTORS) {
        const model = sm.getSector(sector.id);
        if (!model) problems.push(`seção ${sector.id} não criada`);
        labels.push([`seção ${sector.id}`, model?.getName() ?? ""]);
        for (const def of sector.properties) {
          const id = typeof def === "string" ? def : String(def.id ?? def.extend ?? def.property);
          const base = typeof def === "string" ? def : def.extend;
          if (base && !sm.getBuiltIn(base)) problems.push(`${id}: não é uma propriedade pronta do GrapesJS`);
          const prop = sm.getProperty(sector.id, id);
          if (!prop) {
            problems.push(`${id}: não foi criada`);
            continue;
          }
          if (prop.getType() === "base") problems.push(`${id}: virou um campo de texto solto (${prop.getType()})`);
          labels.push([id, prop.getLabel()]);
          const withSubs = prop as unknown as { getProperties?: () => { getId(): string; getLabel(): string }[] };
          for (const sub of withSubs.getProperties?.() ?? []) labels.push([sub.getId(), sub.getLabel()]);
          const withOptions = prop as unknown as {
            getOptions?: () => { id: string }[];
            getOptionLabel?: (o: { id: string }) => string;
          };
          if (id !== "font-family") {
            for (const opt of withOptions.getOptions?.() ?? [])
              options.push([`${id}.${opt.id}`, withOptions.getOptionLabel?.(opt) ?? ""]);
          }
        }
      }
      return {
        problems,
        labels,
        options,
        locale: w.ed.I18n.getLocale(),
        empty: String(w.ed.I18n.t("styleManager.empty")),
        errors: (window as unknown as TestWindow).pageErrors,
      };
    });
    expect(report.errors).toEqual([]);
    expect(report.problems).toEqual([]);
    expect(report.locale).toBe("pt");
    expect(report.empty).toBe("Selecione um elemento na página para mudar o visual dele.");
    for (const [id, label] of report.labels) {
      if (id.startsWith("seção ")) expect(label).toBe(SECTOR_NAMES[id.slice(6) as keyof typeof SECTOR_NAMES]);
      else expect(label, id).toBe(PROPERTY_LABELS[id]);
    }
    expect(report.options.length).toBeGreaterThan(60);
    expect(report.options.filter(([, label]) => !label || ENGLISH.test(label))).toEqual([]);
    await page.close();
  });

  it("nenhum texto visível dos painéis está em inglês (texto, link, imagem, caixa flexível)", async () => {
    const page = await openEditor(
      `<section style="display:flex"><h1 class="titulo">Oferta</h1><p>Texto <a href="#">link</a></p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></section>`,
      "h1",
    );
    await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      for (const s of w.ed.StyleManager.getSectors()) s.setOpen(true);
      const h1 = w.ed.getWrapper()?.find("h1")[0];
      h1?.addStyle({
        "text-shadow": "1px 1px 2px #000",
        "box-shadow": "0 2px 4px #000",
        "background-image": 'url("x.png")',
      });
    });
    const texts = new Set<string>();
    for (const target of ["h1", "a", "img", "section"]) {
      await select(page, target);
      for (const t of await panelTexts(page)) texts.add(t);
    }
    const english = [...texts].filter((t) => ENGLISH.test(t));
    expect(english).toEqual([]);
    // Amostra do que precisa estar lá.
    for (const expected of [
      "Texto",
      "Fonte",
      "Espessura",
      "Alinhamento",
      "Esquerda",
      "Justificado",
      "Estado normal",
      "Classes",
      "Página",
      // Seções ganham o título de dentro no nome (camadas e etiqueta do canvas).
      "Seção · Oferta",
      "Dica ao passar o mouse",
      "Endereço do link",
      "Abrir em",
    ]) {
      expect([...texts], expected).toContain(expected);
    }
    // Estados em português no seletor "Estado".
    const states = await page.$$eval("#gjs-clm-states option", (opts) => opts.map((o) => o.textContent));
    expect(states).toEqual(["Estado normal", "Ao passar o mouse", "Ao clicar", "Itens pares"]);
    await page.close();
  });

  it("opções de layout aparecem só quando fazem sentido (inclusive com o CSS original da página)", async () => {
    const page = await openEditor(`<div class="caixa"><span>a</span></div><p class="solto">texto</p>`, "p");
    const visible = (ids: string[]) =>
      page.evaluate(async (ids) => {
        const w = window as unknown as TestWindow;
        await new Promise((r) => setTimeout(r, 30));
        return Object.fromEntries(
          ids.map((id) => [id, Boolean(w.ed.StyleManager.getProperty("layout", id)?.isVisible())]),
        );
      }, ids);
    expect(await visible(["flex-direction", "justify-content", "gap", "top", "z-index", "display"])).toEqual({
      "flex-direction": false,
      "justify-content": false,
      gap: false,
      top: false,
      "z-index": false,
      display: true,
    });
    // "CSS original" (fora do editor) deixando a caixa flexível e posicionada.
    await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      w.ed.Canvas.getDocument()?.head.insertAdjacentHTML(
        "beforeend",
        "<style>.caixa{display:flex;position:relative}</style>",
      );
    });
    await select(page, "div");
    expect(await visible(["flex-direction", "justify-content", "gap", "top", "z-index"])).toEqual({
      "flex-direction": true,
      "justify-content": true,
      gap: true,
      top: true,
      "z-index": true,
    });
    await page.close();
  });

  it("as fontes da página viram opções do campo Fonte (sem fontes de ícones)", async () => {
    const page = await openEditor(`<h1>Oferta</h1><p>texto</p>`, "p");
    const labels = await page.evaluate(async () => {
      const w = window as unknown as TestWindow;
      w.ed.Canvas.getDocument()?.head.insertAdjacentHTML(
        "beforeend",
        `<style>
          @font-face { font-family: "Montserrat"; src: url(data:font/woff2;base64,AAAA) format("woff2"); }
          @font-face { font-family: 'Playfair Display'; src: url(data:font/woff2;base64,AAAA); }
          @font-face { font-family: "Font Awesome 6 Free"; src: url(data:font/woff2;base64,AAAA); }
        </style>`,
      );
      w.ed.select(w.ed.getWrapper()?.find("h1")[0]);
      await new Promise((r) => setTimeout(r, 50));
      const prop = w.ed.StyleManager.getProperty("tipografia", "font-family") as unknown as {
        getOptions(): { id: string; label: string }[];
      };
      return prop.getOptions().map((o) => `${o.id} => ${o.label}`);
    });
    expect(labels[0]).toBe(" => Padrão da página");
    expect(labels).toContain('"Montserrat", sans-serif => Montserrat · usada na página');
    expect(labels).toContain('"Playfair Display", serif => Playfair Display · usada na página');
    expect(labels.some((l) => /awesome/i.test(l))).toBe(false);
    // As opções aparecem no select do painel.
    const shown = await page.$$eval(".gjs-sm-property__font-family option", (opts) => opts.map((o) => o.textContent));
    expect(shown).toContain("Montserrat · usada na página");
    await page.close();
  });

  it("barra de edição de texto e seletor de cores em português", async () => {
    const page = await openEditor(`<h1>Oferta</h1>`, "h1");
    await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      const view = w.ed.getSelected()?.getView() as unknown as { onActive(): void };
      view.onActive();
    });
    const titles = await page.$$eval(".gjs-rte-action", (els) => els.map((e) => e.getAttribute("title")));
    expect(titles).toEqual([
      "Negrito",
      "Itálico",
      "Sublinhado",
      "Riscado",
      "Criar ou remover link",
      "Separar este trecho para mudar só o estilo dele",
    ]);
    await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      const view = w.ed.getSelected()?.getView() as unknown as { disableEditing(): void };
      view.disableEditing();
    });
    await page.locator(".gjs-sm-property__color .gjs-field-color-picker").click();
    const picker = page.locator(".sp-container:not(.sp-hidden)").first();
    await expect.poll(() => picker.isVisible()).toBe(true);
    expect(await picker.locator(".sp-choose").textContent()).toBe("Aplicar");
    expect(await picker.locator(".sp-cancel").textContent()).toBe("Cancelar");
    expect(await picker.locator(".sp-palette .sp-thumb-el").count()).toBeGreaterThanOrEqual(21);
    await page.close();
  });
});

describe("editor de código: funções", () => {
  it("formatCss deixa legível sem mudar o CSS", async () => {
    const page = await openEditor(`<p>x</p>`);
    const result = await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      const css = `#a{color:red;background:url(data:image/png;base64,AA;BB)}#b:hover{content:"a;{b}"}@media (max-width: 480px){.t{font-size:20px;margin:0 auto}}@font-face{font-family:X;src:url("x.woff2")}@keyframes pisca{0%{opacity:0}100%{opacity:1}}`;
      const pretty = w.OS.dialog.formatCss(css);
      const parse = (text: string) => JSON.stringify(w.ed.Parser.parseCss(text));
      return { pretty, same: parse(css) === parse(pretty), empty: w.OS.dialog.formatCss("  ") };
    });
    expect(result.same).toBe(true);
    expect(result.empty).toBe("");
    expect(result.pretty).toBe(
      [
        "#a {",
        "  color: red;",
        "  background: url(data:image/png;base64,AA;BB);",
        "}",
        "",
        "#b:hover {",
        '  content: "a;{b}";',
        "}",
        "",
        "@media (max-width: 480px) {",
        "  .t {",
        "    font-size: 20px;",
        "    margin: 0 auto;",
        "  }",
        "}",
        "",
        "@font-face {",
        "  font-family: X;",
        '  src: url("x.woff2");',
        "}",
        "",
        "@keyframes pisca {",
        "  0% {",
        "    opacity: 0;",
        "  }",
        "  100% {",
        "    opacity: 1;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    await page.close();
  });

  it("scripts e eventos: o usuário vê o código real; o editor guarda inerte", async () => {
    const page = await openEditor(`<p>x</p>`);
    const result = await page.evaluate(() => {
      const { dialog } = (window as unknown as TestWindow).OS;
      const typed = `<div><button onclick="comprar()">Comprar</button><script src="https://x.com/a.js" async></script><script>if (a < b && c) go("</div>")</script></div>`;
      const inert = dialog.toEditorHtml(typed);
      return { inert, back: dialog.toReadableHtml(inert) };
    });
    expect(result.inert).not.toMatch(/<script|onclick=/);
    expect(result.inert).toContain('data-os-on-click="comprar()"');
    expect(result.inert).toContain("<os-script");
    expect(result.back).toBe(
      `<div><button onclick="comprar()">Comprar</button><script src="https://x.com/a.js" async="">` +
        `</script><script>if (a < b && c) go("</div>")</script></div>`,
    );
    await page.close();
  });

  it("noscript e valores javascript: aparecem como na página e voltam inertes ao editor", async () => {
    const page = await openEditor(`<section id="s"><p>x</p></section>`, "section");
    const result = await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      const { dialog } = w.OS;
      // Como o editor guarda (prepareForEditor): noscript como texto, javascript: sem o prefixo.
      const stored =
        `<div><os-noscript data-os-attrs="{&quot;data-x&quot;:&quot;1&quot;}" hidden="">` +
        `&lt;style&gt;.video{display:none}&lt;/style&gt;&lt;img src="a.png"&gt;</os-noscript>` +
        `<a data-os-js-href="void(0)" data-os-js-data-os-on-click="abrir()">Abrir</a></div>`;
      const readable = dialog.toReadableHtml(stored);
      const typed =
        `<noscript><style>.lazy{opacity:1}</style></noscript>` +
        `<a href="javascript:void(0)" onclick="javascript:abrir()">Abrir</a><p>novo</p>`;
      const inert = dialog.toEditorHtml(typed);
      const section = w.ed.getSelected();
      if (!section) throw new Error("sem seleção");
      const before = w.ed.Css.getRules(".lazy").length;
      w.OS.dialog.applyElementHtml(w.ed, section, `<section id="s">${typed}</section>`);
      return {
        readable,
        inert,
        back: dialog.toReadableHtml(inert),
        rulesBefore: before,
        rulesAfter: w.ed.Css.getRules(".lazy").length,
        html: w.ed.getHtml(),
        canvasLazy: Array.from(w.ed.Canvas.getDocument()?.querySelectorAll("style") ?? []).some((s) =>
          (s.textContent ?? "").includes(".lazy"),
        ),
      };
    });
    expect(result.readable).toBe(
      `<div><noscript data-x="1"><style>.video{display:none}</style><img src="a.png"></noscript>` +
        `<a href="javascript:void(0)" onclick="javascript:abrir()">Abrir</a></div>`,
    );
    expect(result.inert).not.toMatch(/<noscript|javascript:|onclick=/);
    expect(result.inert).toContain("<os-noscript");
    expect(result.inert).toContain('data-os-js-href="void(0)"');
    expect(result.inert).toContain('data-os-js-data-os-on-click="abrir()"');
    expect(result.back).toBe(
      `<noscript><style>.lazy{opacity:1}</style></noscript>` +
        `<a href="javascript:void(0)" onclick="javascript:abrir()">Abrir</a><p>novo</p>`,
    );
    // O <style> do noscript não vira CSS do editor nem aparece no canvas.
    expect(result.rulesBefore).toBe(0);
    expect(result.rulesAfter).toBe(0);
    expect(result.canvasLazy).toBe(false);
    expect(result.html).toContain("<os-noscript");
    expect(result.html).toContain('data-os-js-href="void(0)"');
    await page.close();
  });

  it("formatHtml indenta só entre tags coladas e o resultado aplicado é o mesmo", async () => {
    const page = await openEditor(
      `<section id="oferta"><div class="linha"><h1>Oferta <b>boa</b></h1><p>a <i>b</i> c</p></div><ul><li>1</li><li>2</li></ul><pre>  x\n  y</pre></section>`,
      "section",
    );
    const result = await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      const section = w.ed.getSelected();
      if (!section) throw new Error("sem seleção");
      const before = w.ed.getHtml();
      const pretty = w.OS.dialog.elementHtml(w.ed, section);
      const replaced = w.OS.dialog.applyElementHtml(w.ed, section, pretty);
      return { pretty, before, after: w.ed.getHtml(), same: replaced === section };
    });
    expect(result.pretty).toBe(
      [
        '<section id="oferta">',
        '  <div class="linha">',
        "    <h1>Oferta <b>boa</b></h1>",
        "    <p>a <i>b</i> c</p>",
        "  </div>",
        "  <ul>",
        "    <li>1</li>",
        "    <li>2</li>",
        "  </ul>",
        "  <pre>  x\n  y</pre>",
        "</section>",
      ].join("\n"),
    );
    expect(result.after).toBe(result.before);
    expect(result.same).toBe(true);
    await page.close();
  });

  it("aplicar HTML mantém ids, estilos e vizinhos — e desfaz num passo só", async () => {
    const page = await openEditor(
      `<div>Topo</div><section id="oferta" data-x="1"><h1 class="t">Oferta</h1><p>abc</p><a href="#oferta">ir</a></section><footer>fim</footer>`,
      "section",
    );
    const result = await page.evaluate(async () => {
      const w = window as unknown as TestWindow;
      const ed = w.ed;
      const wait = () => new Promise((r) => setTimeout(r, 30));
      // HTML com atributos em ordem alfabética (a ordem pode mudar ao desfazer; o significado não).
      // HTML com atributos em ordem alfabética (a ordem pode mudar ao desfazer).
      const snap = () => ({ html: w.OS.sorted(ed.getHtml()), css: ed.getCss({ avoidProtected: true }) });
      ed.getWrapper()?.find("h1")[0].addStyle({ color: "red" });
      const topo = ed.getWrapper()?.find("div")[0];
      topo?.set("custom-name", "Topo da página");
      await wait();
      ed.UndoManager.clear();
      const before = snap();
      const section = ed.getWrapper()?.find("section")[0];
      if (!section) throw new Error("sem seção");
      const typed = w.OS.dialog
        .elementHtml(ed, section)
        .replace(' data-x="1"', "")
        .replace("Oferta", "Oferta nova")
        .replace("<p>abc</p>", `<p onclick="abrir()">abc</p><script>window.x = 1</script>`);
      const replaced = w.OS.dialog.applyElementHtml(ed, section, typed);
      await wait();
      const after = snap();
      const topoKept = ed.getWrapper()?.find("div")[0] === topo && topo?.getName() === "Topo da página";
      const h1Style = ed.getWrapper()?.find("h1")[0].getStyle();
      ed.UndoManager.undo();
      await wait();
      const undo = snap();
      const moreUndo = ed.UndoManager.hasUndo();
      ed.UndoManager.redo();
      await wait();
      return {
        before,
        after,
        undo,
        redo: snap(),
        moreUndo,
        topoKept,
        h1Style,
        replacedIsSection: replaced === section,
      };
    });
    expect(result.after.html).toContain('<section id="oferta">');
    expect(result.after.html).not.toContain("data-x");
    expect(result.after.html).toMatch(/<h1 [^>]*>Oferta nova<\/h1>/);
    expect(result.after.html).toContain('<a href="#oferta">ir</a>');
    expect(result.after.html).toContain('data-os-on-click="abrir()"');
    expect(result.after.html).toContain("<os-script");
    expect(result.after.html).not.toContain("<script");
    expect(result.after.css).toBe(result.before.css);
    expect(result.h1Style).toEqual({ color: "red" });
    expect(result.topoKept).toBe(true);
    expect(result.replacedIsSection).toBe(true);
    expect(result.undo).toEqual(result.before);
    expect(result.moreUndo).toBe(false);
    expect(result.redo).toEqual(result.after);
    await page.close();
  });

  it("ids repetidos aparecem com o id da página (com a marca data-os-eid); aplicar sem mudar mantém o estilo de cada um", async () => {
    // Como o editor recebe a página (prepareForEditor): o 2º e o 3º "comprar" com data-os-dup-id.
    const page = await openEditor(
      `<a id="comprar" href="#a">A</a><section id="s"><a data-os-dup-id="comprar" href="#b">B</a></section>` +
        `<a data-os-dup-id="comprar" href="#c">C</a><p id="p">fim</p>`,
    );
    const result = await page.evaluate(async () => {
      const w = window as unknown as TestWindow;
      const ed = w.ed;
      const wait = () => new Promise((r) => setTimeout(r, 50));
      const links = () => ed.getWrapper()?.find("a") ?? [];
      const [a, b, c] = links();
      // Estilo próprio do repetido B (como o painel de estilo grava).
      ed.Css.setRule(`#${b.getId()}`, { color: "rgb(255, 0, 0)" });
      await wait();
      const ids = { a: a.getId(), b: b.getId(), c: c.getId() };
      const snap = () => ({
        html: w.OS.sorted(ed.getHtml()),
        css: ed.getCss({ avoidProtected: true }),
        dup: links().map((l) => l.getAttributes()["data-os-dup-id"] ?? ""),
        canvas: Array.from(ed.Canvas.getDocument()?.querySelectorAll("a") ?? []).map(
          (el) => ed.Canvas.getWindow().getComputedStyle(el).color,
        ),
      });
      const before = snap();
      const wrapper = ed.getWrapper();
      if (!wrapper) throw new Error("sem página");
      const shownPage = w.OS.dialog.elementHtml(ed, wrapper);
      const shownB = w.OS.dialog.elementHtml(ed, b);
      w.OS.dialog.applyElementHtml(ed, wrapper, shownPage);
      await wait();
      const afterPage = snap();
      const sameB = links()[1].getId() === ids.b;
      // Só o repetido, com o texto mudado.
      const b2 = links()[1];
      w.OS.dialog.applyElementHtml(ed, b2, w.OS.dialog.elementHtml(ed, b2).replace(">B<", ">B2<"));
      await wait();
      return { ids, before, shownPage, shownB, afterPage, sameB, afterB: snap() };
    });
    const { ids } = result;
    // O que a página final terá: o id da página em todos, sem as marcas internas do editor.
    expect(result.shownPage).not.toContain("data-os-dup-id");
    expect(result.shownPage).not.toContain(` id="${ids.b}"`);
    expect(result.shownPage).not.toContain(` id="${ids.c}"`);
    expect(result.shownPage.match(/id="comprar"/g)).toHaveLength(3);
    expect(result.shownPage).toContain(`data-os-eid="${ids.b}"`);
    expect(result.shownPage).toContain(`data-os-eid="${ids.c}"`);
    expect(result.shownB).toMatch(/^<a [^>]*>B<\/a>$/);
    expect(result.shownB).toContain('id="comprar"');
    expect(result.shownB).toContain(`data-os-eid="${ids.b}"`);
    // Aplicado sem mudar: mesmos elementos, mesmas regras, mesmas cores.
    expect(result.before.canvas[1]).toBe("rgb(255, 0, 0)");
    expect(result.before.canvas.filter((c) => c === "rgb(255, 0, 0)")).toHaveLength(1);
    expect(result.afterPage.html).toBe(result.before.html);
    expect(result.afterPage.css).toBe(result.before.css);
    expect(result.afterPage.dup).toEqual(["", "comprar", "comprar"]);
    expect(result.afterPage.canvas).toEqual(result.before.canvas);
    expect(result.afterPage.html).not.toContain("data-os-eid");
    expect(result.sameB).toBe(true);
    // Texto do repetido mudado: continua o mesmo elemento, com o estilo dele.
    expect(result.afterB.html).toContain(">B2</a>");
    expect(result.afterB.css).toBe(result.before.css);
    expect(result.afterB.dup).toEqual(["", "comprar", "comprar"]);
    expect(result.afterB.canvas).toEqual(result.before.canvas);
    await page.close();
  });

  it("regra do CSS da página na marca data-os-eid de um repetido sem estilo: igual no canvas, na página final e ao reabrir", async () => {
    const page = await openEditor(
      `<a id="comprar" href="#a">A</a><a data-os-dup-id="comprar" href="#b">B</a><a data-os-dup-id="comprar" href="#c">C</a>`,
    );
    const colors = (p: Page) =>
      p.evaluate(() => {
        const ed = (window as unknown as TestWindow).ed;
        return Array.from(ed.Canvas.getDocument()?.querySelectorAll("a") ?? []).map(
          (el) => ed.Canvas.getWindow().getComputedStyle(el).color,
        );
      });
    const applied = await page.evaluate(async () => {
      const w = window as unknown as TestWindow;
      const ed = w.ed;
      const b = ed.getWrapper()?.find("a")[1];
      if (!b) throw new Error("sem o repetido");
      // A marca que a janela mostra para o repetido B (ele não tem estilo próprio).
      const mark = /data-os-eid="([^"]+)"/.exec(w.OS.dialog.elementHtml(ed, b))?.[1] ?? "";
      ed.UndoManager.clear();
      const result = w.OS.dialog.applyPageCss(ed, `#comprar[data-os-eid="${mark}"] { color: rgb(255, 0, 0); }`);
      await new Promise((r) => setTimeout(r, 50));
      const out = {
        mark,
        result,
        html: ed.getHtml({ asDocument: true } as never),
        css: ed.getCss({ avoidProtected: true }) ?? "",
        project: ed.getProjectData(),
      };
      // Desfazer tira a regra e a marca juntas, num passo só (e refazer põe as duas).
      ed.UndoManager.undo();
      await new Promise((r) => setTimeout(r, 50));
      const undone = { css: ed.getCss({ avoidProtected: true }) ?? "", attrs: { ...b.getAttributes() } };
      ed.UndoManager.redo();
      await new Promise((r) => setTimeout(r, 50));
      const redone = { css: ed.getCss({ avoidProtected: true }) ?? "", attrs: { ...b.getAttributes() } };
      return { ...out, undone, redone };
    });
    expect(applied.undone.css).not.toContain("data-os-eid");
    expect(applied.undone.attrs["data-os-eid"]).toBeUndefined();
    expect(applied.redone.css).toBe(applied.css);
    expect(applied.redone.attrs["data-os-eid"]).toBe(applied.mark);
    expect(applied.mark).not.toBe("");
    expect(applied.result).toEqual({ ok: true });
    const red = "rgb(255, 0, 0)";
    const canvas = await colors(page);
    expect(canvas[1]).toBe(red);
    expect(canvas.filter((c) => c === red)).toHaveLength(1);
    await page.close();

    // Página final: o repetido leva a marca que a regra usa.
    const final = finalizeFromEditor(applied.html, applied.css);
    expect(final).toMatch(new RegExp(`<a [^>]*data-os-eid="${applied.mark}"[^>]*>B</a>`));
    const site = await browser.newPage();
    try {
      await site.setContent(final);
      const colorsFinal = await site.evaluate(() =>
        Array.from(document.querySelectorAll("a")).map((el) => getComputedStyle(el).color),
      );
      expect(colorsFinal[1]).toBe(red);
      expect(colorsFinal.filter((c) => c === red)).toHaveLength(1);
    } finally {
      await site.close();
    }

    // Reaberto (o id do editor de um repetido sem estilo muda a cada abertura): a marca é a mesma.
    const again = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await again.setContent(pageHtml);
      await again.evaluate(async (project) => {
        const w = window as unknown as TestWindow;
        const el = (id: string) => document.getElementById(id) as HTMLElement;
        const ed = w.OS.createEditor(
          {
            canvas: el("canvas"),
            blocks: el("blocks"),
            layers: el("layers"),
            styles: el("styles"),
            traits: el("traits"),
          },
          project,
        );
        w.ed = ed;
        await new Promise<void>((resolve) => ed.on("load", () => resolve()));
        await new Promise((r) => setTimeout(r, 50));
      }, applied.project);
      const reopened = await colors(again);
      expect(reopened[1]).toBe(red);
      expect(reopened.filter((c) => c === red)).toHaveLength(1);
    } finally {
      await again.close();
    }
  });

  it("aplicar HTML não recria o que está dentro dos vizinhos (nem põe ids neles)", async () => {
    const page = await openEditor(`<section><h2>Alvo</h2><div class="card"><span>preço</span></div></section>`, "h2");
    const result = await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      const ed = w.ed;
      const span = ed.getWrapper()?.find(".card span")[0];
      span?.set("custom-name", "Preço");
      const target = ed.getSelected();
      if (!target) throw new Error("sem seleção");
      // (Selecionar já dá um id interno ao h2 — o GrapesJS guarda o estilo por id.)
      const expected = ed.getHtml().replace(">Alvo<", ">Alvo novo<");
      w.OS.dialog.applyElementHtml(ed, target, "<h2>Alvo novo</h2>");
      const now = ed.getWrapper()?.find(".card span")[0];
      return { same: now === span, name: now?.getName(), html: ed.getHtml(), expected };
    });
    expect(result.same).toBe(true);
    expect(result.name).toBe("Preço");
    expect(result.html).toBe(result.expected);
    expect(result.html).toContain('<div class="card"><span>preço</span></div>');
    await page.close();
  });

  it("aplicar HTML atualiza classes e atributos de quem é reaproveitado; tag ou tipo novo recria", async () => {
    const page = await openEditor(
      `<section id="s" class="a b"><h2 class="velho">Título</h2><div>texto solto</div></section><footer>fim</footer>`,
      "section",
    );
    const result = await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      const ed = w.ed;
      const h2 = ed.getWrapper()?.find("h2")[0];
      h2?.addStyle({ color: "red" });
      const section = ed.getSelected();
      const footer = ed.getWrapper()?.find("footer")[0];
      if (!section || !h2) throw new Error("sem seleção");
      const h2Id = h2.getId();
      // Mesma tag e tipo: atualiza no lugar.
      const same = w.OS.dialog.applyElementHtml(
        ed,
        section,
        `<section id="s" class="b c" data-novo="1"><h2 id="${h2Id}" class="novo">Título</h2><div>texto solto</div></section>`,
      );
      const inPlace = {
        same: same === section,
        h2Same: ed.getWrapper()?.find("h2")[0] === h2,
        sectionClasses: section.getClasses(),
        h2Classes: h2.getClasses(),
        h2Style: h2.getStyle(),
      };
      // Texto que vira caixa com filhos: o tipo muda, então recria (e o vizinho fica).
      const div = ed.getWrapper()?.find("section > div")[0];
      if (!div) throw new Error("sem div");
      const typeBefore = div.get("type");
      const replaced = w.OS.dialog.applyElementHtml(ed, div, "<div><p>um</p><p>dois</p></div>");
      return {
        inPlace,
        typeBefore,
        typeAfter: replaced?.get("type"),
        footerSame: ed.getWrapper()?.find("footer")[0] === footer,
        html: ed.getHtml(),
      };
    });
    expect(result.inPlace).toEqual({
      same: true,
      h2Same: true,
      sectionClasses: ["b", "c"],
      h2Classes: ["novo"],
      h2Style: { color: "red" },
    });
    expect(result.typeBefore).toBe("text");
    expect(result.typeAfter).toBe(""); // tipo padrão do GrapesJS
    expect(result.footerSame).toBe(true);
    expect(result.html).toContain('<section id="s" data-novo="1" class="b c">');
    expect(result.html).toContain("<div><p>um</p><p>dois</p></div>");
    await page.close();
  });

  it("troca grande (página com muitos elementos) desfaz inteira, num passo só", async () => {
    const blocks = Array.from(
      { length: 120 },
      (_, i) =>
        `<section id="bloco-${i}"><div id="linha-${i}"><p id="p-${i}">Texto ${i}</p><a id="a-${i}" href="#bloco-${i}">ir</a></div></section>`,
    ).join("");
    const page = await openEditor(`<main id="topo"><h1 id="titulo">Oferta</h1></main>${blocks}`, "#topo");
    const result = await page.evaluate(async () => {
      const w = window as unknown as TestWindow;
      const ed = w.ed;
      ed.getWrapper()?.find("#p-3")[0].addStyle({ color: "red" });
      await new Promise((r) => setTimeout(r, 30));
      ed.UndoManager.clear();
      const snap = () => ({ html: w.OS.sorted(ed.getHtml()), css: ed.getCss({ avoidProtected: true }) });
      const before = snap();
      const main = ed.getSelected();
      if (!main) throw new Error("sem seleção");
      // Tag nova: caminho geral (a lista inteira do corpo é refeita, reaproveitando por id).
      w.OS.dialog.applyElementHtml(ed, main, `<header id="topo"><h1 id="titulo">Oferta nova</h1></header>`);
      await new Promise((r) => setTimeout(r, 30));
      const after = snap();
      const stack = ed.UndoManager.getStack().length;
      ed.UndoManager.undo();
      await new Promise((r) => setTimeout(r, 30));
      return {
        before,
        after,
        stack,
        undo: snap(),
        moreUndo: ed.UndoManager.hasUndo(),
      };
    });
    expect(result.after.html).toContain('<header id="topo"><h1 id="titulo">Oferta nova</h1></header>');
    expect(result.after.html).toContain('<a href="#bloco-119" id="a-119">ir</a>');
    expect(result.after.css).toBe(result.before.css);
    expect(result.stack).toBeGreaterThan(150);
    expect(result.undo).toEqual(result.before);
    expect(result.moreUndo).toBe(false);
    await page.close();
  });

  it("aplicar HTML na página inteira (corpo) também funciona e desfaz", async () => {
    const page = await openEditor(`<h1 id="t">Oferta</h1><p>abc</p>`);
    const result = await page.evaluate(async () => {
      const w = window as unknown as TestWindow;
      const ed = w.ed;
      const wrapper = ed.getWrapper();
      if (!wrapper) throw new Error("sem corpo");
      ed.getWrapper()?.find("h1")[0].addStyle({ color: "blue" });
      await new Promise((r) => setTimeout(r, 30));
      ed.UndoManager.clear();
      const before = ed.getHtml();
      const typed = w.OS.dialog.elementHtml(ed, wrapper).replace("abc", "xyz");
      const replaced = w.OS.dialog.applyElementHtml(ed, wrapper, typed);
      await new Promise((r) => setTimeout(r, 30));
      const after = { html: ed.getHtml(), css: ed.getCss({ avoidProtected: true }), replaced: replaced ?? null };
      ed.UndoManager.undo();
      await new Promise((r) => setTimeout(r, 30));
      return { before, after, undo: ed.getHtml() };
    });
    expect(result.after.html).toBe('<body><h1 id="t">Oferta</h1><p>xyz</p></body>');
    expect(result.after.css).toBe("#t{color:blue;}");
    expect(result.after.replaced).toBeNull();
    expect(result.undo).toBe(result.before);
    await page.close();
  });

  it("CSS da página: troca as regras do editor, recusa CSS inválido e desfaz", async () => {
    const page = await openEditor(`<h1 class="t">Oferta</h1>`, "h1");
    const result = await page.evaluate(async () => {
      const w = window as unknown as TestWindow;
      const ed = w.ed;
      ed.getSelected()?.addStyle({ color: "red" });
      await new Promise((r) => setTimeout(r, 30));
      ed.UndoManager.clear();
      const before = ed.getCss({ avoidProtected: true });
      const invalid = w.OS.dialog.applyPageCss(ed, "isto não é css");
      const afterInvalid = ed.getCss({ avoidProtected: true });
      const typed = `${w.OS.dialog.formatCss(before ?? "")}\n.t { letter-spacing: 2px; }\n@media (max-width: 480px) { .t { font-size: 20px; } }`;
      const ok = w.OS.dialog.applyPageCss(ed, typed);
      await new Promise((r) => setTimeout(r, 30));
      const after = ed.getCss({ avoidProtected: true });
      const style = ed.getSelected()?.getStyle();
      ed.UndoManager.undo();
      await new Promise((r) => setTimeout(r, 30));
      return { before, invalid, afterInvalid, ok, after, style, undo: ed.getCss({ avoidProtected: true }) };
    });
    expect(result.invalid).toEqual({
      ok: false,
      error: expect.stringContaining("Não encontramos nenhuma regra CSS válida"),
    });
    expect(result.afterInvalid).toBe(result.before);
    expect(result.ok).toEqual({ ok: true });
    expect(result.after).toContain(".t{letter-spacing:2px;}");
    expect(result.after).toContain("@media (max-width: 480px){.t{font-size:20px;}}");
    expect(result.after).toMatch(/#[\w-]+\{color:red;\}/);
    expect(result.style).toEqual({ color: "red" });
    expect(result.undo).toBe(result.before);
    await page.close();
  });
});

describe("editor de código: janela", () => {
  async function codeEditor(page: Page, label: string) {
    return page.locator(`.cm-editor:has([aria-label="${label}"])`);
  }

  async function setCode(page: Page, label: string, text: string) {
    await page.evaluate(
      ({ label, text }) => {
        const w = window as unknown as TestWindow;
        const content = document.querySelector(`[aria-label="${label}"]`);
        const view = content ? w.OS.findView(content.closest(".cm-editor") as Element) : null;
        if (!view) throw new Error(`editor ${label} não encontrado`);
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      },
      { label, text },
    );
  }

  it("sem elemento selecionado, explica o que fazer; abas em português", async () => {
    const page = await openEditor(`<h1>Oferta</h1>`);
    await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      w.OS.mount(w.ed);
    });
    await expect.poll(() => page.getByRole("dialog").isVisible()).toBe(true);
    const tabs = await page.getByRole("tab").allTextContents();
    expect(tabs).toEqual(["HTML do elemento", "CSS da página", "Códigos da página"]);
    // Sem seleção, abre no CSS; a aba HTML explica.
    expect(await page.getByRole("tab", { name: "CSS da página" }).getAttribute("aria-selected")).toBe("true");
    await page.getByRole("tab", { name: "HTML do elemento" }).click();
    await expect.poll(() => page.getByText("Selecione um elemento na página").isVisible()).toBe(true);
    await page.close();
  });

  it("aplica o HTML do elemento pela janela e fecha", async () => {
    const page = await openEditor(`<section><h1>Oferta</h1></section>`, "h1");
    await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      w.OS.mount(w.ed);
    });
    const editor = await codeEditor(page, "HTML do elemento");
    await expect.poll(() => editor.isVisible()).toBe(true);
    expect(await page.getByText("Editando").textContent()).toContain("Texto");
    const apply = page.getByRole("button", { name: "Aplicar" });
    expect(await apply.isDisabled()).toBe(true);
    await setCode(page, "HTML do elemento", `<h2 class="novo">Nova oferta</h2>`);
    await expect.poll(() => apply.isDisabled()).toBe(false);
    await apply.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as TestWindow).dialogOpen)).toBe(false);
    const html = await page.evaluate(() => (window as unknown as TestWindow).ed.getHtml());
    expect(html).toBe('<body><section><h2 class="novo">Nova oferta</h2></section></body>');
    await page.close();
  });

  it("pede confirmação antes de descartar código não aplicado", async () => {
    const page = await openEditor(`<h1>Oferta</h1>`);
    await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      w.OS.mount(w.ed);
    });
    await expect.poll(async () => (await codeEditor(page, "CSS da página")).isVisible()).toBe(true);
    await setCode(page, "CSS da página", "h1 { color: green; }");
    await page.getByRole("button", { name: "Fechar", exact: true }).first().click();
    await expect.poll(() => page.getByText("Descartar as alterações no código?").isVisible()).toBe(true);
    await page.getByRole("button", { name: "Continuar editando" }).click();
    expect(await page.evaluate(() => (window as unknown as TestWindow).dialogOpen)).toBe(true);
    await page.getByRole("button", { name: "Fechar", exact: true }).first().click();
    await page.getByRole("button", { name: "Descartar" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as TestWindow).dialogOpen)).toBe(false);
    // Nada foi aplicado.
    expect(await page.evaluate(() => (window as unknown as TestWindow).ed.getCss({ avoidProtected: true }))).toBe("");
    await page.close();
  });

  it("salva os códigos da página (head / início / fim do body) pela ação", async () => {
    const page = await openEditor(`<h1>Oferta</h1>`);
    await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      w.OS.mount(w.ed);
    });
    await page.getByRole("tab", { name: "Códigos da página" }).click();
    await expect.poll(async () => (await codeEditor(page, "Código No <head>")).isVisible()).toBe(true);
    await expect.poll(() => page.getByText("só rodam na prévia e na página publicada").isVisible()).toBe(true);
    const save = page.getByRole("button", { name: "Salvar códigos" });
    expect(await save.isDisabled()).toBe(true);
    await setCode(page, "Código No <head>", '<meta name="facebook-domain-verification" content="abc">');
    await setCode(page, "Código Antes de fechar o </body>", "<script>chat()</script>");
    await expect.poll(() => save.isDisabled()).toBe(false);
    await save.click();
    await expect.poll(() => save.isDisabled()).toBe(true);
    const calls = await page.evaluate(() => (window as unknown as TestWindow).calls);
    expect(calls[0]).toEqual(["get", { pageId: "pagina-1" }]);
    expect(calls.at(-1)).toEqual([
      "save",
      {
        pageId: "pagina-1",
        head: '<meta name="facebook-domain-verification" content="abc">',
        bodyStart: "",
        bodyEnd: "<script>chat()</script>",
      },
    ]);
    // Nada disso entrou no editor.
    expect(await page.evaluate(() => (window as unknown as TestWindow).ed.getHtml())).toBe(
      "<body><h1>Oferta</h1></body>",
    );
    await page.close();
  });

  it("quando os códigos carregam: automático (pixel espera o Aceitar), aviso para pixel em 'Essencial' e escolha salva", async () => {
    const page = await openEditor(`<h1>Oferta</h1>`);
    await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      w.OS.mount(w.ed);
    });
    await page.getByRole("tab", { name: "Códigos da página" }).click();
    const select = page.getByRole("combobox", { name: "Quando estes códigos carregam" });
    await expect.poll(() => select.textContent()).toBe("Automático (pixel espera o “Aceitar”)");
    const help = page.getByTestId("page-code-category-help");
    await expect.poll(() => help.textContent()).toContain("Sem pixel ou tag de anúncio: carrega sempre.");

    const meta =
      "<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){};t=b.createElement(e);t.src=v;b.head.appendChild(t)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','123456789012345');fbq('track','PageView');</script>";
    await setCode(page, "Código No <head>", meta);
    await expect
      .poll(() => help.textContent())
      .toBe("Este código tem Meta Pixel: ele só carrega depois que o visitante aceitar os cookies (Marketing).");

    // "Essencial" com pixel: aviso de que passa na frente do "Aceitar".
    await select.click();
    await page.getByRole("option", { name: "Essencial (carrega sempre)" }).click();
    await expect
      .poll(() => page.getByText("Este código tem Meta Pixel e carrega antes do “Aceitar”", { exact: false }).count())
      .toBe(1);

    await select.click();
    await page.getByRole("option", { name: "Marketing (espera o consentimento)" }).click();
    const save = page.getByRole("button", { name: "Salvar códigos" });
    await save.click();
    await expect.poll(() => save.isDisabled()).toBe(true);
    const calls = () => page.evaluate(() => (window as unknown as TestWindow).calls);
    expect((await calls()).at(-1)).toEqual([
      "save",
      { pageId: "pagina-1", head: meta, bodyStart: "", bodyEnd: "", category: "MARKETING" },
    ]);

    // Só a escolha mudou: também dá para salvar; "Automático" vai como null (a detecção decide).
    await select.click();
    await page.getByRole("option", { name: "Automático (pixel espera o “Aceitar”)" }).click();
    await expect.poll(() => save.isDisabled()).toBe(false);
    await save.click();
    await expect.poll(() => save.isDisabled()).toBe(true);
    expect((await calls()).at(-1)?.[1]).toMatchObject({ category: null });
    // Salvar sem mudar a escolha não manda a categoria (a guardada continua).
    await setCode(page, "Código Antes de fechar o </body>", "<p>x</p>");
    await save.click();
    await expect.poll(() => save.isDisabled()).toBe(true);
    expect((await calls()).at(-1)?.[1]).not.toHaveProperty("category");
    await page.close();
  });
});

describe("editor de código: pixels fora dos códigos da página (refix 1 da Fase 4)", () => {
  const META =
    "<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){};t=b.createElement(e);t.src=v;b.head.appendChild(t)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','123456789012345');fbq('track','PageView');</script>";

  async function setCode(page: Page, label: string, text: string) {
    await page.evaluate(
      ({ label, text }) => {
        const w = window as unknown as TestWindow;
        const content = document.querySelector(`[aria-label="${label}"]`);
        const view = content ? w.OS.findView(content.closest(".cm-editor") as Element) : null;
        if (!view) throw new Error(`editor ${label} não encontrado`);
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      },
      { label, text },
    );
  }

  it("HTML do elemento com pixel colado: avisa, não aplica e leva para 'Códigos da página'", async () => {
    const page = await openEditor(`<section><h1>Oferta</h1></section>`, "h1");
    await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      w.OS.mount(w.ed);
    });
    await expect.poll(() => page.locator('[aria-label="HTML do elemento"]').count()).toBe(1);
    await setCode(page, "HTML do elemento", `<h1>Oferta</h1>${META}`);
    const warning = page.getByTestId("element-html-trackers");
    await expect.poll(() => warning.textContent()).toContain("Este HTML tem Meta Pixel");
    await page.getByRole("button", { name: "Aplicar" }).click();
    await expect.poll(() => page.getByRole("alert").textContent()).toContain("cole na aba “Códigos da página”");
    // Nada mudou na página.
    expect(await page.evaluate(() => (window as unknown as TestWindow).ed.getHtml())).not.toContain("fbq");
    await warning.getByRole("button", { name: "Códigos da página" }).click();
    expect(await page.getByRole("tab", { name: "Códigos da página" }).getAttribute("aria-selected")).toBe("true");
    await page.close();
  });

  it("Códigos da página no automático com script de fora desconhecido: sugere 'Marketing' se ele rastrear", async () => {
    const page = await openEditor(`<h1>Oferta</h1>`);
    await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      w.OS.mount(w.ed);
    });
    await page.getByRole("tab", { name: "Códigos da página" }).click();
    await expect.poll(() => page.getByTestId("page-code-category-help").count()).toBe(1);
    await setCode(
      page,
      "Código Antes de fechar o </body>",
      '<script src="https://widget.desconhecido-exemplo.com/w.js"></script>',
    );
    const hint = page.getByTestId("page-code-unknown-scripts");
    await expect.poll(() => hint.textContent()).toContain("widget.desconhecido-exemplo.com");
    expect(await hint.textContent()).toContain("escolha “Marketing”");
    // Chat conhecido: sem dica.
    await setCode(
      page,
      "Código Antes de fechar o </body>",
      '<script src="https://embed.tawk.to/abc/default"></script>',
    );
    await expect.poll(() => hint.count()).toBe(0);
    await page.close();
  });
});
