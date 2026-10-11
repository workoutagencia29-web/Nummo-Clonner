/**
 * Ajustes de estabilidade e desempenho do editor visual (Chromium de verdade):
 *
 * - campo de cor do Estilo: só selecionar elementos não grava cor nenhuma (o
 *   GrapesJS 0.23 guardava a cor MOSTRADA como pendente e a gravava ao trocar
 *   de elemento, às vezes no elemento errado); a paleta continua gravando;
 * - Refazer a troca de imagem (imagem comum, loja, galeria, logos) devolve a
 *   imagem nova também no HTML salvo, não só no canvas;
 * - o "autosave" interno do GrapesJS fica desligado (quem salva é o editor-app);
 * - ícone "Trocar imagem" da barra do elemento não vira um quadrado cheio;
 * - Camadas desenhadas só quando a aba abre;
 * - sair do editor solta a página da memória (<img> com sizes/srcset).
 */
import type { Component } from "grapesjs";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addBlock, type EditorWindow, openEditor, pageErrors } from "./blocks-harness";
import { appBundle, FakeServer, makePayload, openApp, waitFor, withEditor } from "./fix3-E1-harness";
import { openApp as openPanel } from "./fix3-E2-harness";

let browser: Browser;
beforeAll(async () => {
  await appBundle();
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** Abre todas as seções do Estilo (os campos precisam estar à vista para clicar). */
async function openSectors(page: Page) {
  await page.evaluate(() => {
    const ed = (window as unknown as EditorWindow).ed;
    for (const s of ed.StyleManager.getSectors()) s.setOpen(true);
  });
}

// ─── Campo de cor do Estilo ──────────────────────────────────────────────────

describe("campo de cor do Estilo", () => {
  it("só selecionar elementos (h1 ↔ p do Topo, pausas de 2 a 20 ms) não grava cor nem passo do Desfazer", async () => {
    for (const wait of [2, 5, 10, 20]) {
      const page = await openEditor(browser);
      await addBlock(page, "hero");
      await page.waitForTimeout(300);
      const out = await page.evaluate(async (ms) => {
        const ed = (window as unknown as EditorWindow).ed;
        ed.UndoManager.clear();
        const sleep = (t: number) => new Promise((r) => setTimeout(r, t));
        const h1 = ed.getWrapper()?.find("h1")[0] as Component;
        const p = ed.getWrapper()?.find("p")[0] as Component;
        const before = ed.getCss({ avoidProtected: true });
        for (let i = 0; i < 8; i++) {
          ed.select(h1);
          await sleep(ms);
          ed.select(p);
          await sleep(ms);
        }
        await sleep(300);
        const property = ed.StyleManager.getProperty("tipografia", "color") as
          | { view?: { inputInst?: { movedColor?: string } } }
          | undefined;
        const view = property?.view;
        return {
          same: before === ed.getCss({ avoidProtected: true }),
          undo: ed.UndoManager.hasUndo(),
          pending: view?.inputInst?.movedColor ?? "",
        };
      }, wait);
      expect(out, `pausa de ${wait} ms`).toEqual({ same: true, undo: false, pending: "" });
      expect(pageErrors(page)).toEqual([]);
      await page.close();
    }
  });

  it("a paleta continua gravando (aplicar; arrastar e clicar noutro elemento) e um Desfazer não volta ao trocar de elemento", async () => {
    const s = await openPanel(browser, { html: '<h1 id="a">Título</h1><p id="b">Texto</p>' });
    const { page } = s;
    try {
      const select = (id: string) =>
        page.evaluate(async (sel) => {
          const ed = (window as unknown as EditorWindow).ed;
          ed.select(ed.getWrapper()?.find(sel)[0] as Component);
          await new Promise((r) => setTimeout(r, 300));
        }, id);
      await page.evaluate(() => (window as unknown as EditorWindow).ed.UndoManager.clear());
      await select("#a");
      await openSectors(page);
      await page.waitForTimeout(200);
      const colorOf = (id: string) =>
        page.evaluate((sel) => {
          const rule = (window as unknown as EditorWindow).ed.Css.getRule(sel);
          return String(rule?.getStyle().color ?? "");
        }, id);
      const stack = () => page.evaluate(() => (window as unknown as EditorWindow).ed.UndoManager.getStack().length);
      const picker = page.locator(".sp-container:not(.sp-hidden)");
      /** Abre a paleta da cor do texto e arrasta no quadro de cores (de/para, em frações do quadro). */
      const drag = async (from: [number, number], to: [number, number]) => {
        await page.locator(".gjs-sm-property__color .gjs-field-color-picker").first().click();
        await picker.waitFor();
        const box = await picker.locator(".sp-color").boundingBox();
        if (!box) throw new Error("sem o quadro de cores");
        await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 4 });
        await page.mouse.up();
      };

      // Arrastar e "Aplicar".
      await drag([0.8, 0.3], [0.9, 0.2]);
      await picker.locator(".sp-choose").click();
      await page.waitForTimeout(200);
      const applied = await colorOf("#a");
      expect(applied).not.toBe("");
      expect(await stack()).toBe(1);

      // Arrastar sem confirmar e clicar noutro elemento: a cor fica no primeiro, como passo do Desfazer.
      await drag([0.2, 0.7], [0.3, 0.8]);
      const dragged = await colorOf("#a");
      expect(dragged).not.toBe(applied);
      await select("#b");
      expect(await colorOf("#a")).toBe(dragged);
      expect(await colorOf("#b")).toBe("");
      expect(await stack()).toBe(2);

      // Aplicar, desfazer e trocar de elemento: o Desfazer vale (a cor desfeita não volta).
      await select("#a");
      await drag([0.5, 0.5], [0.6, 0.4]);
      await picker.locator(".sp-choose").click();
      await page.waitForTimeout(200);
      expect(await colorOf("#a")).not.toBe(dragged);
      await page.evaluate(() => (window as unknown as EditorWindow).ed.UndoManager.undo());
      expect(await colorOf("#a")).toBe(dragged);
      const afterUndo = await stack();
      await select("#b");
      expect(await colorOf("#a")).toBe(dragged);
      expect(await colorOf("#b")).toBe("");
      expect(await stack()).toBe(afterUndo);
      expect(s.errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

// ─── Refazer a troca de imagem ───────────────────────────────────────────────

/** Elementos de imagem do Offer Studio (todos estendem a "image" do GrapesJS). */
const IMAGE_CASES: [type: string, html: string][] = [
  ["image", '<img id="x" src="/os-assets/A.png" alt="Foto">'],
  ["os-product-img", '<img id="x" class="os-pd-img" src="/os-assets/A.png" alt="Produto">'],
  ["os-sh-logo-img", '<img id="x" class="os-sh-logo-img" src="/os-assets/A.png" alt="Logo">'],
  ["os-pg-img", '<div class="os-pg-thumb"><img id="x" src="/os-assets/A.png" alt="Galeria"></div>'],
  ["os-ft-logo-img", '<img id="x" class="os-ft-logo-img" src="/os-assets/A.png" alt="Logo do rodapé">'],
];

describe("Refazer a troca de imagem", () => {
  it("canvas e HTML salvo ficam com a imagem nova (imagem comum, produto, logos, galeria)", async () => {
    const page = await openEditor(browser);
    for (const [type, html] of IMAGE_CASES) {
      const out = await page.evaluate(
        async ([html, type]) => {
          const ed = (window as unknown as EditorWindow).ed;
          ed.setComponents(html);
          ed.UndoManager.clear();
          const img = ed.getWrapper()?.find("#x")[0] as Component;
          const state = () => {
            const box = document.createElement("div");
            box.innerHTML = ed.getHtml();
            return {
              canvas: (img.getEl()?.getAttribute("src") ?? "").replace("/os-assets/", ""),
              saved: (box.querySelector("img")?.getAttribute("src") ?? "").replace("/os-assets/", ""),
            };
          };
          // Como o AssetView do GrapesJS (escolher na janela de imagens).
          img.set("attributes", { ...img.get("attributes") });
          img.set("src", "/os-assets/B.png");
          const swapped = state();
          const cycles: unknown[] = [];
          const stacks: number[] = [];
          for (let i = 0; i < 3; i++) {
            ed.UndoManager.undo();
            const undone = state();
            ed.UndoManager.redo();
            cycles.push({ undone, redone: state() });
            stacks.push(ed.UndoManager.getStack().length);
          }
          return { type: img.get("type"), swapped, cycles, stacks, expected: type };
        },
        [html, type] as const,
      );
      expect(out.type).toBe(type);
      expect(out.swapped, type).toEqual({ canvas: "B.png", saved: "B.png" });
      for (const cycle of out.cycles) {
        expect(cycle, type).toEqual({
          undone: { canvas: "A.png", saved: "A.png" },
          redone: { canvas: "B.png", saved: "B.png" },
        });
      }
      // Desfazer/refazer de novo não cria registros.
      expect(new Set(out.stacks).size, type).toBe(1);
    }
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it("no editor completo: o HTML enviado ao salvar depois do Refazer tem a imagem nova (logo do rodapé)", async () => {
    const server = new FakeServer();
    const doc = "docimagem00000000000001";
    server.add(
      makePayload({
        documentId: doc,
        html: `<!doctype html><html><head><title>T</title></head><body><section><img id="x" class="os-ft-logo-img" src="/os-assets/A.png" alt="Logo"></section></body></html>`,
      }),
    );
    const s = await openApp(browser, server, doc);
    try {
      await waitFor(() => server.okPuts.length >= 1, 8000, "1ª gravação");
      const puts = server.okPuts.length;
      await withEditor(
        s.page,
        `(ed) => {
          const img = ed.getWrapper().find("#x")[0];
          img.set("attributes", { ...img.get("attributes") });
          img.set("src", "/os-assets/B.png");
          ed.UndoManager.undo();
          ed.UndoManager.redo();
        }`,
      );
      await waitFor(() => server.okPuts.length > puts, 8000, "gravação depois do Refazer");
      const last = server.okPuts[server.okPuts.length - 1];
      expect(last.html).toContain("/os-assets/B.png");
      expect(last.html).not.toContain("/os-assets/A.png");
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

// ─── Autosave interno do GrapesJS ────────────────────────────────────────────

describe("salvamento", () => {
  it("o GrapesJS não monta o projeto a cada mudança; o editor-app salva, avisa e desfaz como antes", async () => {
    const server = new FakeServer();
    const doc = "docautosave000000000001";
    server.add(makePayload({ documentId: doc }));
    const s = await openApp(browser, server, doc);
    try {
      await waitFor(() => server.okPuts.length >= 1, 8000, "1ª gravação");
      const puts = server.okPuts.length;
      await withEditor(
        s.page,
        `(ed) => {
          const w = window;
          w.__stores = 0;
          w.__updates = 0;
          const model = ed.getModel();
          const store = model.store.bind(model);
          model.store = (...args) => { w.__stores++; return store(...args); };
          ed.on("update", () => w.__updates++);
          ed.getWrapper().find("#p")[0].components("Texto novo");
        }`,
      );
      await waitFor(() => server.okPuts.length > puts, 8000, "gravação da edição");
      expect(server.okPuts[server.okPuts.length - 1].html).toContain("Texto novo");
      const info = await s.page.evaluate(() => {
        const w = window as unknown as { __stores: number; __updates: number };
        return { stores: w.__stores, updates: w.__updates };
      });
      expect(info.stores).toBe(0);
      expect(info.updates).toBeGreaterThan(0);
      const undone = await withEditor<string>(s.page, `(ed) => { ed.UndoManager.undo(); return ed.getHtml(); }`);
      expect(undone).not.toContain("Texto novo");
      expect(undone).toContain("Parágrafo da página");
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

// ─── Barra do elemento ───────────────────────────────────────────────────────

describe("barra do elemento", () => {
  it("o ícone “Trocar imagem” é de traço (sem preenchimento); os outros continuam preenchidos", async () => {
    const s = await openPanel(browser, {
      html: '<section><img id="foto" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" style="width:200px;height:120px" alt="Foto"></section>',
    });
    try {
      const out = await s.page.evaluate(async () => {
        const ed = (window as unknown as EditorWindow).ed;
        ed.select(ed.getWrapper()?.find("#foto")[0] as Component);
        await new Promise((r) => setTimeout(r, 300));
        const items = [...document.querySelectorAll(".gjs-toolbar-item")];
        const swap = items.find((i) => i.getAttribute("title") === "Trocar imagem");
        const fills = items
          .filter((i) => i !== swap)
          .map((i) => i.querySelector("svg"))
          .filter((svg): svg is SVGSVGElement => !!svg && svg.getAttribute("fill") !== "none")
          .map((svg) => getComputedStyle(svg).fill);
        const svg = swap?.querySelector("svg");
        return { swap: svg ? getComputedStyle(svg).fill : null, others: fills };
      });
      expect(out.swap).toBe("none");
      expect(out.others.length).toBeGreaterThan(0);
      for (const fill of out.others) expect(fill).not.toBe("none");
    } finally {
      await s.page.close();
    }
  });
});

// ─── Camadas sob demanda ─────────────────────────────────────────────────────

describe("Camadas", () => {
  const PAGE = `<!doctype html><html><head><title>T</title></head><body>
    <section id="s1"><h2 id="h1">Primeira seção da página</h2><p id="p1">Texto um</p></section>
    <section id="s2"><h2 id="h2">Segunda seção da página</h2><p id="p2">Texto dois</p></section>
  </body></html>`;

  /** Nomes das camadas desenhadas no painel esquerdo. */
  const layerNames = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('[aria-label="Blocos e camadas"] .gjs-layer-name')].map((e) =>
        (e.textContent ?? "").trim(),
      ),
    );

  it("só são desenhadas quando a aba abre, acompanham a seleção e a exclusão, e voltam ao reabrir o editor", async () => {
    const server = new FakeServer();
    const doc = "doccamadas0000000000001";
    server.add(makePayload({ documentId: doc, html: PAGE }));
    const s = await openApp(browser, server, doc);
    try {
      // Aba fechada: nada desenhado.
      expect(await s.page.locator('[aria-label="Blocos e camadas"] .gjs-layer').count()).toBe(0);

      await s.page.getByRole("tab", { name: "Camadas" }).click();
      await waitFor(async () => (await layerNames(s.page)).length > 0, 4000, "camadas desenhadas");
      const names = await layerNames(s.page);
      expect(names.some((n) => n.startsWith("Seção · Primeira seção"))).toBe(true);
      expect(names.some((n) => n.startsWith("Seção · Segunda seção"))).toBe(true);

      // Selecionar no canvas acende a camada.
      await withEditor(s.page, `(ed) => { ed.select(ed.getWrapper().find("#s2")[0]); }`);
      await waitFor(
        () =>
          s.page.evaluate(() =>
            [...document.querySelectorAll(".gjs-layer.gjs-selected > .gjs-layer-item .gjs-layer-name")].some((e) =>
              (e.textContent ?? "").includes("Segunda seção"),
            ),
          ),
        3000,
        "camada selecionada",
      );

      // Excluir uma seção tira a camada dela.
      await withEditor(s.page, `(ed) => { ed.getWrapper().find("#s1")[0].remove(); }`);
      await waitFor(
        async () => !(await layerNames(s.page)).some((n) => n.includes("Primeira seção")),
        3000,
        "camada excluída",
      );

      // Trocar de aba e voltar não desenha de novo (sem camadas repetidas).
      await s.page.getByRole("tab", { name: "Blocos" }).click();
      await s.page.getByRole("tab", { name: "Camadas" }).click();
      expect((await layerNames(s.page)).filter((n) => n.startsWith("Seção · Segunda seção")).length).toBe(1);

      // Fechar e reabrir o editor: abrir a aba desenha as camadas do editor novo.
      await waitFor(() => server.okPuts.some((p) => !p.html.includes("Primeira seção")), 8000, "exclusão salva");
      await s.page.evaluate(() => (window as unknown as { OS: { unmount(): void } }).OS.unmount());
      await s.page.evaluate((id) => (window as unknown as { OS: { mount(id: string): void } }).OS.mount(id), doc);
      await s.page.getByRole("button", { name: "Modo prévia" }).waitFor();
      await s.page.waitForFunction(() => {
        const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Modo prévia");
        return btn && !(btn as HTMLButtonElement).disabled;
      });
      expect(await s.page.locator('[aria-label="Blocos e camadas"] .gjs-layer').count()).toBe(0);
      await s.page.getByRole("tab", { name: "Camadas" }).click();
      await waitFor(async () => (await layerNames(s.page)).length > 0, 4000, "camadas do editor reaberto");
      const again = await layerNames(s.page);
      expect(again.filter((n) => n.startsWith("Seção · Segunda seção")).length).toBe(1);

      // "Achar pelo texto" acha o parágrafo (o texto dele fica num "textnode" filho).
      await s.page.getByRole("textbox", { name: "Achar elemento pelo texto" }).fill("Texto dois");
      await s.page.getByRole("button", { name: "Achar", exact: true }).click();
      await waitFor(
        () => withEditor<boolean>(s.page, `(ed) => ed.getSelected()?.getId() === "p2"`),
        3000,
        "elemento achado",
      );
      // Texto do título: o título, não a seção em volta.
      await s.page.getByRole("textbox", { name: "Achar elemento pelo texto" }).fill("segunda SEÇÃO");
      await s.page.getByRole("button", { name: "Achar", exact: true }).click();
      await waitFor(
        () => withEditor<boolean>(s.page, `(ed) => ed.getSelected()?.getId() === "h2"`),
        3000,
        "título achado",
      );
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});

// ─── Memória ao sair do editor ───────────────────────────────────────────────

describe("memória", () => {
  /** Página com muitas <img sizes srcset> (como as do Elementor) e texto. */
  function bigPage(sections: number) {
    const text = "Você vai aprender o método completo, passo a passo, com garantia e acesso imediato. ".repeat(12);
    const body = Array.from(
      { length: sections },
      (_, i) =>
        `<section id="s${i}"><h2>Seção ${i}</h2><img src="/os-assets/f${i}.png" srcset="/os-assets/f${i}.png 1x, /os-assets/f${i}-2x.png 2x" sizes="(max-width: 600px) 100vw, 600px" alt="Foto ${i}"><p>${text}</p></section>`,
    ).join("");
    return `<!doctype html><html><head><title>T</title></head><body>${body}</body></html>`;
  }

  async function heapMB(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    const r = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number };
    await cdp.detach();
    return r.usedSize / 1e6;
  }

  it("fechar o editor solta os elementos do canvas (sem a view do GrapesJS presa neles)", async () => {
    const page = await openEditor(browser);
    const out = await page.evaluate(async () => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.setComponents(
        '<section><img src="/a.png" srcset="/a.png 1x, /a2.png 2x" sizes="100vw" alt="A"><p>Texto</p></section>',
      );
      await new Promise((r) => setTimeout(r, 100));
      const els = [...(ed.Canvas.getDocument()?.body.querySelectorAll("*") ?? [])] as (Element & {
        __gjsv?: unknown;
      })[];
      const before = els.filter((e) => e.__gjsv).length;
      ed.destroy();
      await new Promise((r) => setTimeout(r, 100));
      return { before, after: els.filter((e) => e.__gjsv).length };
    });
    expect(out.before).toBeGreaterThan(0);
    expect(out.after).toBe(0);
    await page.close();
  });

  it("abrir e fechar a mesma página 3 vezes não acumula memória", async () => {
    const server = new FakeServer();
    const doc = "docmemoria0000000000001";
    server.add(makePayload({ documentId: doc, html: bigPage(300) }));
    const s = await openApp(browser, server, doc);
    try {
      await waitFor(() => server.okPuts.length >= 1, 30_000, "1ª gravação");
      const heaps: number[] = [];
      for (let i = 0; i < 3; i++) {
        await s.page.evaluate(() => (window as unknown as { OS: { unmount(): void } }).OS.unmount());
        await s.page.waitForTimeout(600);
        heaps.push(await heapMB(s.page));
        await s.page.evaluate((id) => (window as unknown as { OS: { mount(id: string): void } }).OS.mount(id), doc);
        await s.page.waitForFunction(
          () => {
            const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Modo prévia");
            return btn && !(btn as HTMLButtonElement).disabled;
          },
          undefined,
          { timeout: 30_000 },
        );
        await s.page.waitForTimeout(400);
      }
      await s.page.evaluate(() => (window as unknown as { OS: { unmount(): void } }).OS.unmount());
      await s.page.waitForTimeout(600);
      heaps.push(await heapMB(s.page));
      expect(
        heaps[3] - heaps[0],
        `heap com o editor fechado: ${heaps.map((h) => h.toFixed(1)).join(" → ")} MB`,
      ).toBeLessThan(10);
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  }, 120_000);
});
