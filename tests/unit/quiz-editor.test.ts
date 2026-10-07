/**
 * Quiz no editor de verdade (GrapesJS no Chromium): o bloco entra com as
 * etapas empilhadas e o selo "Etapa N de M · Tipo" só no canvas, nada roda no
 * canvas, as Configurações do quiz e das etapas gravam o que devem (etapas e
 * opções novas, escolha múltipla, formato, ícones, "Analisando", destino do
 * botão final e cores), duplicar/excluir/mover etapas usam o GrapesJS e o
 * projeto salvo volta igual.
 *
 * E pelo painel de verdade (campos desenhados): os campos do destino mostram o
 * destino que vale (outro campo, Desfazer, link novo), as cores não regravam
 * nada ao trocar de elemento nem perdem o Desfazer, a etapa final não sai, o
 * Espaço entra no texto do "Continuar"/"Voltar", o modelo aberto por HTML
 * mantém o topo fechado e um quiz não entra dentro de outro.
 */
import * as cheerio from "cheerio";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAGE_TEMPLATES } from "@/editor/templates";
import { prepareForEditor } from "@/lib/editor-html";
import { addBlock, attrs, type EditorWindow, editorOutput, openEditor, pageErrors, setTrait } from "./blocks-harness";
import { fakeId } from "./helpers";

/** HTML com os atributos em ordem alfabética (o GrapesJS pode trocar id/class de lugar). */
function sortedAttrs(html: string) {
  const $ = cheerio.load(html);
  $("*").each((_, el) => {
    if (!("attribs" in el)) return;
    const entries = Object.entries(el.attribs).sort(([a], [b]) => a.localeCompare(b));
    el.attribs = Object.fromEntries(entries);
  });
  return $.html();
}

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

const QUIZ = '[data-os-widget="quiz"]';
const PAGE_ID = fakeId("vendas");

/** Selos das etapas no canvas, na ordem. */
const badges = (page: Page) =>
  page.evaluate(() => {
    const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
    return Array.from(doc.querySelectorAll("[data-os-qz-step]")).map((el) => el.getAttribute("data-os-qz-badge"));
  });

/** Tipos das etapas no modelo (data-os-qz-step), na ordem. */
const kinds = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as EditorWindow).ed.getWrapper()?.find("[data-os-qz-step]") ?? []).map(
      (c) => c.getAttributes()["data-os-qz-step"],
    ),
  );

/** Clica (como no painel) num botão de Configurações do componente. */
async function pressTrait(page: Page, selector: string, trait: string) {
  await page.evaluate(
    ([sel, name]) => {
      const ed = (window as unknown as EditorWindow).ed;
      const comp = ed.getWrapper()?.find(sel)[0];
      if (!comp) throw new Error(`nada com ${sel}`);
      ed.select(comp);
      const t = comp.getTrait(name) as unknown as { runCommand(): void } | undefined;
      if (!t) throw new Error(`trait ${name} não existe em ${sel}`);
      t.runCommand();
    },
    [selector, trait] as const,
  );
  await page.waitForTimeout(80);
}

async function traitValue(page: Page, selector: string, trait: string) {
  return page.evaluate(
    ([sel, name]) => {
      const ed = (window as unknown as EditorWindow).ed;
      const comp = ed.getWrapper()?.find(sel)[0];
      if (comp) ed.select(comp);
      return comp?.getTrait(name)?.getValue();
    },
    [selector, trait] as const,
  );
}

describe("bloco Quiz", () => {
  let page: Page;
  beforeAll(async () => {
    page = await openEditor(browser, {
      pages: [
        { id: fakeId("quiz"), name: "Quiz" },
        { id: PAGE_ID, name: "Página de vendas", type: "SALES" },
      ],
      links: [{ key: "checkout", label: "Checkout principal", kind: "CHECKOUT" }],
    });
    await addBlock(page, "quiz");
    await page.waitForTimeout(100);
  }, 60_000);
  afterAll(() => page?.close());

  it("entra com todas as etapas empilhadas no canvas, cada uma com o selo (só no canvas)", async () => {
    expect(pageErrors(page)).toEqual([]);
    expect(await kinds(page)).toEqual(["question", "question", "info", "question", "loading", "final"]);
    expect(await badges(page)).toEqual([
      "Etapa 1 de 6 · Pergunta",
      "Etapa 2 de 6 · Pergunta",
      "Etapa 3 de 6 · Informação",
      "Etapa 4 de 6 · Pergunta (escolha múltipla)",
      "Etapa 5 de 6 · Analisando",
      "Etapa 6 de 6 · Final",
    ]);
    const canvas = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const doc = ed.Canvas.getDocument() as Document;
      const view = doc.defaultView as Window;
      const steps = Array.from(doc.querySelectorAll<HTMLElement>("[data-os-qz-step]"));
      return {
        shown: steps.map((s) => view.getComputedStyle(s).display !== "none" && s.getBoundingClientRect().height > 60),
        label: view.getComputedStyle(steps[0], "::before").content,
        // Nada roda no canvas: sem a classe do script, sem o CSS dos widgets.
        running: !!doc.querySelector(".os-qz-on, .os-qz-cur") || !!doc.getElementById("os-widgets-css"),
        hint: view.getComputedStyle(doc.querySelector("[data-os-qz-go]") as Element, "::after").content,
      };
    });
    expect(canvas.shown).toEqual([true, true, true, true, true, true]);
    expect(canvas.label).toBe('"Etapa 1 de 6 · Pergunta"');
    expect(canvas.running).toBe(false);
    // Botão final ainda sem destino: o canvas pede para escolher.
    expect(canvas.hint).toContain("Escolha o link da oferta em Configurações");

    const { html, css } = await editorOutput(page);
    expect(html).not.toContain("data-os-qz-badge");
    expect(html).not.toContain("Etapa 1 de 6");
    const $ = cheerio.load(html);
    expect($(QUIZ).attr("data-os-progress")).toBe("1");
    expect($(QUIZ).attr("data-os-back")).toBe("1");
    expect($(QUIZ).attr("data-os-track")).toBe("1");
    expect($("[data-os-qz-option]").length).toBe(10);
    expect($("[data-os-qz-option]").first().attr("type")).toBe("button");
    expect($('a.os-btn[data-os-qz-go][data-os-link=""]')).toHaveLength(1);
    // O CSS do quiz vai junto com a página (sem JavaScript: só a 1ª etapa).
    expect(css).toMatch(
      /\.os-quiz:not\(\.os-qz-on\):not\(\[data-gjs-type\]\) \.os-qz-step ?~ ?\.os-qz-step\{display:none;\}/,
    );
    expect(css).toMatch(/--os-qz-main:#7c3aed/);
    // Atalhos com var() viram propriedades simples: nada se perde ao passar pelo GrapesJS.
    expect(css).toMatch(/\.os-quiz \.os-qz-next\{[^}]*background-color:var\(--os-qz-main\)/);
    expect(css).toMatch(/\.os-quiz \.os-qz-go\{[^}]*background-color:var\(--os-qz-cta\)/);
    expect(css).toMatch(/\.os-quiz \.os-qz-opt\[aria-pressed="true"\]\{[^}]*border-top-color:var\(--os-qz-main\)/);
    expect(css).toMatch(/\.os-quiz \.os-qz-opt:hover\{[^}]*border-left-color:var\(--os-qz-main\)/);
    expect(css).toMatch(/\.os-quiz \.os-qz-opt\{[^}]*border-top-width:2px/);
  });

  it("“＋ Adicionar pergunta/informação/Analisando” entram antes do fim e os selos se renumeram", async () => {
    await pressTrait(page, QUIZ, "os-qz-add-question");
    await pressTrait(page, QUIZ, "os-qz-add-info");
    await pressTrait(page, QUIZ, "os-qz-add-loading");
    expect(await kinds(page)).toEqual([
      "question",
      "question",
      "info",
      "question",
      "question",
      "info",
      "loading",
      "loading",
      "final",
    ]);
    await page.waitForTimeout(80);
    const list = await badges(page);
    expect(list[4]).toBe("Etapa 5 de 9 · Pergunta");
    expect(list[8]).toBe("Etapa 9 de 9 · Final");
    // A etapa nova fica selecionada (Configurações dela na hora).
    const selected = await page.evaluate(() => (window as unknown as EditorWindow).ed.getSelected()?.get("type"));
    expect(selected).toBe("os-quiz-loading");
    expect(pageErrors(page)).toEqual([]);
  });

  it("pergunta: ＋ Adicionar opção, escolha múltipla, formato e ícones", async () => {
    const q = "[data-os-qz-step=question]";
    const count = () =>
      page.evaluate(
        (sel) => (window as unknown as EditorWindow).ed.getWrapper()?.find(sel)[0]?.find("[data-os-qz-option]").length,
        q,
      );
    expect(await count()).toBe(4);
    await pressTrait(page, q, "os-qz-add-option");
    expect(await count()).toBe(5);
    const { html } = await editorOutput(page);
    const $ = cheerio.load(html);
    const added = $(q).first().find("[data-os-qz-option]").last();
    expect(added.find(".os-qz-txt").text()).toBe("Nova opção");
    // Cópia da última: mesmo formato (emoji + texto).
    expect(added.find(".os-qz-ico").text()).toBe("💪");

    await setTrait(page, q, "data-os-multi", true);
    expect((await attrs(page, q))["data-os-multi"]).toBe("1");
    await page.waitForTimeout(50);
    expect((await badges(page))[0]).toBe("Etapa 1 de 9 · Pergunta (escolha múltipla)");
    // Escolha múltipla mostra o "Continuar" no canvas.
    const nextShown = await page.evaluate(() => {
      const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
      const btns = doc.querySelectorAll<HTMLElement>("[data-os-qz-step] [data-os-qz-next]");
      return [btns[0], btns[1]].map((b) => getComputedStyle(b).display !== "none");
    });
    expect(nextShown).toEqual([true, false]);

    await setTrait(page, q, "data-os-layout", "list");
    expect((await attrs(page, q))["data-os-layout"]).toBe("list");

    expect(await traitValue(page, q, "os-qz-icons")).toBe("emoji");
    await setTrait(page, q, "os-qz-icons", "image");
    let out = cheerio.load((await editorOutput(page)).html);
    expect(out(q).first().find("[data-os-qz-option] img.os-qz-img")).toHaveLength(5);
    expect(out(q).first().find(".os-qz-ico")).toHaveLength(0);
    await setTrait(page, q, "os-qz-icons", "none");
    out = cheerio.load((await editorOutput(page)).html);
    expect(out(q).first().find(".os-qz-img, .os-qz-ico")).toHaveLength(0);
    expect(out(q).first().find(".os-qz-txt")).toHaveLength(5);
    await setTrait(page, q, "os-qz-icons", "emoji");
    out = cheerio.load((await editorOutput(page)).html);
    expect(out(q).first().find(".os-qz-ico")).toHaveLength(5);
    expect(pageErrors(page)).toEqual([]);
  });

  it("“Analisando”: segundos e mensagens (a 1ª mensagem aparece no canvas)", async () => {
    const sel = "[data-os-qz-step=loading]";
    await setTrait(page, sel, "data-os-seconds", "6");
    await setTrait(page, sel, "data-os-messages", "Calculando seu perfil…\nQuase lá…");
    const a = await attrs(page, sel);
    expect(a["data-os-seconds"]).toBe("6");
    expect(a["data-os-messages"]).toBe("Calculando seu perfil…\nQuase lá…");
    const $ = cheerio.load((await editorOutput(page)).html);
    expect($(sel).first().find("[data-os-qz-msg]").text()).toBe("Calculando seu perfil…");
  });

  it("destino do botão final (no quiz ou na etapa final): página do funil, link da oferta ou endereço", async () => {
    const go = "[data-os-qz-go]";
    await setTrait(page, QUIZ, "os-qz-page", PAGE_ID);
    let a = await attrs(page, go);
    expect(a.href).toBe(`os-page:${PAGE_ID}`);
    expect(a["data-os-link"]).toBeUndefined();
    expect(await traitValue(page, "[data-os-qz-step=final]", "os-qz-page")).toBe(PAGE_ID);

    await setTrait(page, "[data-os-qz-step=final]", "os-qz-link", "checkout");
    a = await attrs(page, go);
    expect(a["data-os-link"]).toBe("checkout");
    expect(a.href).toBe("#");

    await setTrait(page, QUIZ, "os-qz-url", "meusite.com.br/roleta");
    a = await attrs(page, go);
    expect(a.href).toBe("https://meusite.com.br/roleta");
    expect(a["data-os-link"]).toBeUndefined();
    expect(await traitValue(page, QUIZ, "os-qz-url")).toBe("https://meusite.com.br/roleta");

    // Apagar o endereço: o botão volta a pedir um destino (aviso do canvas e do ZIP).
    await setTrait(page, QUIZ, "os-qz-url", "");
    a = await attrs(page, go);
    expect(a.href).toBe("#");
    expect(a["data-os-link"]).toBe("");

    // O próprio botão continua com as Configurações de botão (página do funil, link…).
    const types = await page.evaluate((sel) => {
      const ed = (window as unknown as EditorWindow).ed;
      const btn = ed.getWrapper()?.find(sel)[0];
      if (btn) ed.select(btn);
      return { type: btn?.get("type"), traits: btn?.getTraits().map((t) => t.getName()) };
    }, go);
    expect(types.type).toBe("os-button");
    expect(types.traits).toEqual(expect.arrayContaining(["href", "data-os-link", "os-page"]));
  });

  it("cores: a cor principal vale para o quiz inteiro (variável no próprio quiz)", async () => {
    expect(await traitValue(page, QUIZ, "os-qz-main")).toBe("#7c3aed");
    await setTrait(page, QUIZ, "os-qz-main", "#e11d48");
    await setTrait(page, QUIZ, "os-qz-sel", "#ffe4e6");
    const { css } = await editorOutput(page);
    const id = await page.evaluate(
      (sel) => (window as unknown as EditorWindow).ed.getWrapper()?.find(sel)[0]?.getId(),
      QUIZ,
    );
    expect(css).toMatch(new RegExp(`#${id}\\{[^}]*--os-qz-main:#e11d48`));
    expect(css).toMatch(new RegExp(`#${id}\\{[^}]*--os-qz-sel:#ffe4e6`));
    expect(await traitValue(page, QUIZ, "os-qz-main")).toBe("#e11d48");
  });

  it("duplicar, excluir e mover etapas e opções com o GrapesJS (etapas só entre etapas)", async () => {
    const result = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const box = ed.getWrapper()?.find("[data-os-qz-steps]")[0];
      if (!box) throw new Error("sem etapas");
      const steps = () => box.components().models.filter((c) => !!c.getAttributes()["data-os-qz-step"]);
      const before = steps().length;
      // Duplicar (o mesmo comando da barra do elemento).
      ed.select(steps()[1]);
      ed.runCommand("tlb-clone");
      const afterClone = steps().length;
      // Excluir.
      steps()[2].remove();
      const afterRemove = steps().length;
      // Mover a informação para o começo.
      const info = steps().find((c) => c.getAttributes()["data-os-qz-step"] === "info");
      if (!info) throw new Error("sem informação");
      box.append(info.clone(), { at: 0 });
      info.remove();
      const dc = ed.Components as unknown as {
        canMove(target: unknown, source: unknown): { result: boolean };
      };
      const option = ed.getWrapper()?.find("[data-os-qz-option]")[0];
      const opts = ed.getWrapper()?.find("[data-os-qz-opts]")[0];
      return {
        before,
        afterClone,
        afterRemove,
        first: steps()[0].getAttributes()["data-os-qz-step"],
        stepIntoOptions: dc.canMove(opts, steps()[1]).result,
        optionIntoSteps: dc.canMove(box, option).result,
        stepIntoSteps: dc.canMove(box, steps()[1]).result,
        optionIntoOptions: dc.canMove(opts, option).result,
      };
    });
    expect(result.afterClone).toBe(result.before + 1);
    expect(result.afterRemove).toBe(result.before);
    expect(result.first).toBe("info");
    expect(result.stepIntoOptions).toBe(false);
    expect(result.optionIntoSteps).toBe(false);
    expect(result.stepIntoSteps).toBe(true);
    expect(result.optionIntoOptions).toBe(true);
    await page.waitForTimeout(80);
    const list = await badges(page);
    expect(list[0]).toBe(`Etapa 1 de ${list.length} · Informação`);
    expect(list.every((b, i) => b?.startsWith(`Etapa ${i + 1} de ${list.length} · `))).toBe(true);
    expect(pageErrors(page)).toEqual([]);
  });

  it("camadas mostram o tipo e o título de cada etapa", async () => {
    const names: string[] = await page.evaluate(() =>
      ((window as unknown as EditorWindow).ed.getWrapper()?.find("[data-os-qz-step]") ?? []).map((c) => c.getName()),
    );
    expect(names, names.join(" | ")).toContain("Pergunta · O que você mais quer conquistar agora?");
    expect(names.some((n) => n.startsWith("Analisando · "))).toBe(true);
    expect(names.some((n) => n.startsWith("Final · Parabéns!"))).toBe(true);
  });
});

describe("projeto salvo e reaberto", () => {
  it("o quiz volta com os mesmos tipos, selos, Configurações e HTML", async () => {
    const first = await openEditor(browser);
    await addBlock(first, "quiz");
    await setTrait(first, '[data-os-qz-step="question"]', "data-os-layout", "list");
    const saved = await first.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData());
    const before = await editorOutput(first);
    await first.close();

    const second = await openEditor(browser, { project: saved });
    await second.waitForTimeout(100);
    const types = await second.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const w = ed.getWrapper();
      const one = (sel: string) => w?.find(sel)[0]?.get("type");
      return {
        quiz: one('[data-os-widget="quiz"]'),
        steps: one("[data-os-qz-steps]"),
        question: one('[data-os-qz-step="question"]'),
        loading: one('[data-os-qz-step="loading"]'),
        final: one('[data-os-qz-step="final"]'),
        option: one("[data-os-qz-option]"),
        go: one("[data-os-qz-go]"),
      };
    });
    expect(types).toEqual({
      quiz: "os-quiz",
      steps: "os-quiz-steps",
      question: "os-quiz-question",
      loading: "os-quiz-loading",
      final: "os-quiz-final",
      option: "os-quiz-option",
      go: "os-button",
    });
    expect((await badges(second))[0]).toBe("Etapa 1 de 6 · Pergunta");
    expect((await attrs(second, '[data-os-qz-step="question"]'))["data-os-layout"]).toBe("list");
    const after = await editorOutput(second);
    expect(sortedAttrs(after.html)).toBe(sortedAttrs(before.html));
    expect(pageErrors(second)).toEqual([]);
    await second.close();
  }, 60_000);
});

describe("clicar num bloco com o quiz selecionado", () => {
  it("com uma etapa selecionada, o bloco entra depois do quiz; com um texto da etapa, entra na etapa", async () => {
    const page = await openEditor(browser);
    await addBlock(page, "quiz");
    const select = (sel: string) =>
      page.evaluate((s) => {
        const ed = (window as unknown as EditorWindow).ed;
        const comp = ed.getWrapper()?.find(s)[0];
        if (comp) ed.select(comp);
      }, sel);
    const layout = () =>
      page.evaluate(() => {
        const ed = (window as unknown as EditorWindow).ed;
        const box = ed.getWrapper()?.find("[data-os-qz-steps]")[0];
        const step = ed.getWrapper()?.find('[data-os-qz-step="info"]')[0];
        return {
          page: ed
            .getWrapper()
            ?.components()
            .models.map((c) => String(c.get("type") || c.get("tagName"))),
          stepsOnly: box?.components().models.every((c) => !!c.getAttributes()["data-os-qz-step"]),
          info: step?.components().models.map((c) => String(c.get("tagName"))),
        };
      });
    await select('[data-os-qz-step="question"]');
    await page.locator("#blocks .gjs-block", { hasText: "Texto" }).first().click();
    let now = await layout();
    expect(now.page).toEqual(["os-quiz", "text"]);
    expect(now.stepsOnly).toBe(true);

    await select('[data-os-qz-step="info"] h2');
    await page.locator("#blocks .gjs-block", { hasText: "Texto" }).first().click();
    now = await layout();
    expect(now.info?.slice(0, 3)).toEqual(["p", "h2", "p"]);
    expect(now.info?.length).toBe(5);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  }, 60_000);
});

/**
 * Campo do painel Configurações (o elemento desenhado do trait). Com `value`,
 * faz o que a pessoa faz: troca o valor e dispara "change". `part`: um campo
 * dentro do trait (ex.: o texto da cor).
 */
async function panel(page: Page, selector: string, trait: string, value?: string, part?: string) {
  return page.evaluate(
    ([sel, name, val, inner]) => {
      const ed = (window as unknown as EditorWindow).ed;
      const comp = ed.getWrapper()?.find(sel as string)[0];
      if (!comp) throw new Error(`nada com ${sel}`);
      if (ed.getSelected() !== comp) ed.select(comp);
      const view = (comp.getTrait(name as string) as unknown as { view?: { getInputElem(): HTMLElement } }).view;
      if (!view) throw new Error(`campo ${name} não desenhado`);
      const box = view.getInputElem();
      const el = (inner ? box.querySelector(inner as string) : box) as HTMLInputElement;
      if (val !== null) {
        el.value = val as string;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return el.value;
    },
    [selector, trait, value ?? null, part ?? null] as const,
  );
}

const undo = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as EditorWindow).ed.UndoManager.undo();
  });

describe("painel de verdade: destino do botão final", () => {
  let page: Page;
  beforeAll(async () => {
    page = await openEditor(browser, {
      pages: [{ id: PAGE_ID, name: "Página de vendas", type: "SALES" }],
      links: [
        { key: "checkout", label: "Checkout principal", kind: "CHECKOUT" },
        { key: "roleta", label: "Roleta", kind: "OTHER" },
      ],
    });
    await addBlock(page, "quiz");
  }, 60_000);
  afterAll(() => page?.close());

  /** Destino do botão e o que os três campos do quiz mostram. */
  const state = async () => {
    const go = await attrs(page, "[data-os-qz-go]");
    return {
      href: go.href,
      link: go["data-os-link"],
      page: await panel(page, QUIZ, "os-qz-page"),
      linkField: await panel(page, QUIZ, "os-qz-link"),
      url: await panel(page, QUIZ, "os-qz-url"),
    };
  };

  it("outro campo e Desfazer: os campos mostram o destino que vale, e escolher a mesma página de novo funciona", async () => {
    await panel(page, QUIZ, "os-qz-page", PAGE_ID);
    expect(await state()).toMatchObject({ href: `os-page:${PAGE_ID}`, link: undefined, page: PAGE_ID, url: "" });

    await panel(page, QUIZ, "os-qz-url", "exemplo.com/oferta");
    expect(await state()).toMatchObject({
      href: "https://exemplo.com/oferta",
      page: "",
      url: "https://exemplo.com/oferta",
    });

    // O seletor voltou para "— nenhuma —": escolher a página de novo é uma mudança de verdade.
    await panel(page, QUIZ, "os-qz-page", PAGE_ID);
    expect(await state()).toMatchObject({ href: `os-page:${PAGE_ID}`, page: PAGE_ID, url: "" });

    // Desfazer até o endereço voltar: os campos acompanham o botão a cada passo.
    for (let i = 0; i < 6; i++) {
      await undo(page);
      const now = await state();
      const href = now.href ?? "";
      expect(now.page).toBe(href.startsWith("os-page:") ? href.slice("os-page:".length) : "");
      expect(now.url).toBe(/^https?:/.test(href) ? href : "");
      if (/^https?:/.test(href)) break;
    }
    expect((await state()).href).toBe("https://exemplo.com/oferta");
    expect(pageErrors(page)).toEqual([]);
  });

  it("“＋ Criar link da oferta…”: o link novo vale sozinho (a página de antes sai)", async () => {
    await panel(page, QUIZ, "os-qz-page", PAGE_ID);
    // O que o diálogo de link novo faz ao criar (src/editor/panels/new-link-dialog.tsx).
    await page.evaluate(() => {
      const w = window as unknown as EditorWindow;
      w.OS.installNewLinkOption(w.ed, (req) => {
        if (!w.OS.bindQuizLink(req.component, "roleta")) req.component.addAttributes({ "data-os-link": "roleta" });
        // Como o editor faz depois de ligar: reabre as Configurações de quem estava selecionado.
        const sel = w.ed.getSelected();
        if (sel) {
          w.ed.selectRemove(sel);
          w.ed.select(sel);
        }
      });
    });
    await panel(page, QUIZ, "os-qz-link", "__novo-link__");
    await expect.poll(async () => (await attrs(page, "[data-os-qz-go]"))["data-os-link"]).toBe("roleta");
    expect(await state()).toMatchObject({ href: "#", link: "roleta", page: "", linkField: "roleta", url: "" });
    // O quiz continua selecionado (as Configurações dele).
    expect(await page.evaluate(() => (window as unknown as EditorWindow).ed.getSelected()?.get("type"))).toBe(
      "os-quiz",
    );
    // Um botão que não é do quiz não é tocado pela ligação do quiz.
    expect(
      await page.evaluate(() => {
        const w = window as unknown as EditorWindow;
        return w.OS.bindQuizLink(w.ed.getWrapper()?.find("[data-os-qz-option]")[0] as never, "x");
      }),
    ).toBe(false);
    expect(pageErrors(page)).toEqual([]);
  });
});

describe("painel de verdade: cores do quiz", () => {
  let page: Page;
  let id = "";
  beforeAll(async () => {
    page = await openEditor(browser);
    await addBlock(page, "quiz");
    id = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.UndoManager.clear();
      return ed.getWrapper()?.find('[data-os-widget="quiz"]')[0]?.getId() ?? "";
    });
  }, 60_000);
  afterAll(() => page?.close());

  const quizRule = async () => {
    const { css } = await editorOutput(page);
    return new RegExp(`#${id}\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  };
  const selectOther = () =>
    page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.select(ed.getWrapper()?.find("[data-os-qz-step] h2")[0]);
    });
  const hasUndo = () => page.evaluate(() => (window as unknown as EditorWindow).ed.UndoManager.hasUndo());

  it("selecionar o quiz e depois outro elemento não grava nada (nem entra no Desfazer)", async () => {
    expect(await panel(page, QUIZ, "os-qz-main", undefined, "[data-os-color]")).toBe("#7c3aed");
    await selectOther();
    await panel(page, QUIZ, "os-qz-sel", undefined, "[data-os-color]");
    await selectOther();
    expect(await quizRule()).not.toContain("--os-qz-");
    expect(await hasUndo()).toBe(false);
  });

  it("digitar uma cor, Desfazer e trocar de elemento: o Desfazer vale e o campo mostra a cor de volta", async () => {
    await panel(page, QUIZ, "os-qz-main", "#0ea5e9", "[data-os-color]");
    expect(await quizRule()).toContain("--os-qz-main:#0ea5e9");
    expect(await panel(page, QUIZ, "os-qz-main", undefined, "[data-os-swatch]")).toBe("#0ea5e9");
    await undo(page);
    expect(await quizRule()).not.toContain("#0ea5e9");
    expect(await panel(page, QUIZ, "os-qz-main", undefined, "[data-os-color]")).toBe("#7c3aed");
    await selectOther();
    expect(await quizRule()).not.toContain("#0ea5e9");
    // A amostra (paleta) também grava, e o texto acompanha.
    await panel(page, QUIZ, "os-qz-cta", "#112233", "[data-os-swatch]");
    expect(await quizRule()).toContain("--os-qz-cta:#112233");
    expect(await panel(page, QUIZ, "os-qz-cta", undefined, "[data-os-color]")).toBe("#112233");
    expect(pageErrors(page)).toEqual([]);
  });

  it("cor que o navegador não conhece (“vermelho”) não muda nada e o campo avisa", async () => {
    const before = await quizRule();
    await panel(page, QUIZ, "os-qz-main", "vermelho", "[data-os-color]");
    expect(await quizRule()).toBe(before);
    const field = await page.evaluate((sel) => {
      const ed = (window as unknown as EditorWindow).ed;
      const comp = ed.getWrapper()?.find(sel)[0];
      const box = (
        comp?.getTrait("os-qz-main") as unknown as { view: { getInputElem(): HTMLElement } }
      ).view.getInputElem();
      const err = box.querySelector("[data-os-color-err]") as HTMLElement;
      return {
        invalid: box.querySelector("[data-os-color]")?.getAttribute("aria-invalid"),
        message: err.textContent,
        shown: err.style.display !== "none",
      };
    }, QUIZ);
    expect(field).toEqual({
      invalid: "true",
      message: "Cor não reconhecida — use o código, ex.: #e11d48",
      shown: true,
    });
    // Nome em inglês (o navegador entende) vale.
    await panel(page, QUIZ, "os-qz-main", "red", "[data-os-color]");
    expect(await quizRule()).toContain("--os-qz-main:red");
  });
});

describe("etapa final", () => {
  it("não sai nem se duplica pela barra do elemento; o quiz inteiro continua saindo", async () => {
    const page = await openEditor(browser);
    await addBlock(page, "quiz");
    const result = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const final = () => ed.getWrapper()?.find('[data-os-qz-step="final"]') ?? [];
      ed.select(final()[0]);
      ed.runCommand("core:component-delete");
      const afterDelete = final().length;
      ed.select(final()[0]);
      ed.runCommand("tlb-clone");
      const afterClone = final().length;
      const quiz = ed.getWrapper()?.find('[data-os-widget="quiz"]')[0];
      ed.select(quiz);
      ed.runCommand("core:component-delete");
      return { afterDelete, afterClone, quizzes: ed.getWrapper()?.find('[data-os-widget="quiz"]').length };
    });
    expect(result).toEqual({ afterDelete: 1, afterClone: 1, quizzes: 0 });
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  }, 60_000);

  it("a etapa final continua sendo a última depois de “＋ Adicionar…” e de excluir outras etapas", async () => {
    const page = await openEditor(browser);
    await addBlock(page, "quiz");
    await pressTrait(page, QUIZ, "os-qz-add-question");
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.select(ed.getWrapper()?.find('[data-os-qz-step="loading"]')[0]);
      ed.runCommand("core:component-delete");
    });
    expect((await kinds(page)).at(-1)).toBe("final");
    await page.close();
  }, 60_000);
});

describe("Espaço no texto do “Continuar” e do “← Voltar”", () => {
  it("digitar “A B” mantém o espaço (o texto é um <span> dentro do botão)", async () => {
    const page = await openEditor(browser);
    await addBlock(page, "quiz");
    const frame = page.frameLocator("iframe.gjs-frame");
    const typeInto = async (sel: string) => {
      await page.evaluate((s) => {
        const ed = (window as unknown as EditorWindow).ed;
        ed.select(ed.getWrapper()?.find(s)[0]);
      }, sel);
      const loc = frame.locator(sel).first();
      await loc.scrollIntoViewIfNeeded();
      await loc.dblclick();
      await page.waitForTimeout(150);
      await page.keyboard.type(" A B");
      await page.waitForTimeout(80);
    };
    const next = '[data-os-qz-step="info"] [data-os-qz-next] .os-qz-btxt';
    const back = "[data-os-qz-back] .os-qz-btxt";
    await typeInto(next);
    await typeInto(back);
    // Fecha a edição do texto (grava no modelo): um clique fora, como a pessoa faz.
    await frame.locator('[data-os-qz-step="question"] h2').first().click();
    await page.waitForTimeout(80);
    const $ = cheerio.load((await editorOutput(page)).html);
    // O cursor fica onde o duplo clique o pôs: o que importa é o espaço ter entrado
    // (no Chrome, com o texto direto no <button>, sairia "ContABinuar").
    // (o espaço digitado no começo de um texto vira &nbsp;)
    const nextText = $('[data-os-qz-step="info"] [data-os-qz-next]').first().text().replaceAll("\u00a0", " ");
    const backText = $("[data-os-qz-back]").text().replaceAll("\u00a0", " ");
    expect(nextText).toContain(" A B");
    expect(nextText.replace(" A B", "")).toBe("Continuar");
    expect(backText).toContain(" A B");
    expect(backText.replace(" A B", "")).toBe("← Voltar");
    // O botão em si não é editável como texto (só o <span>).
    const types = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const one = (sel: string) => ed.getWrapper()?.find(sel)[0];
      return [one("[data-os-qz-next]")?.get("type"), one("[data-os-qz-back]")?.get("type")];
    });
    expect(types).toEqual(["os-quiz-button", "os-quiz-button"]);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  }, 60_000);
});

describe("modelo “Quiz” aberto por HTML (primeira abertura de uma página)", () => {
  const template = PAGE_TEMPLATES.find((t) => t.id === "quiz");

  it("o topo continua fechado (Voltar + barra) e com nome; o texto do botão continua num <span>", async () => {
    const page = await openEditor(browser);
    const html = prepareForEditor((template?.html ?? "").replaceAll("__OS_ANO__", "2026")).html;
    await page.evaluate((h) => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.setComponents(h, { asDocument: true } as never);
    }, html);
    const top = () =>
      page.evaluate(() => {
        const ed = (window as unknown as EditorWindow).ed;
        const t = ed.getWrapper()?.find(".os-qz-top")[0];
        return {
          name: t?.getName(),
          droppable: t?.get("droppable"),
          children: t?.components().models.map((c) => String(c.get("type"))),
          bar: ed.getWrapper()?.find("[data-os-qz-bar]")[0]?.getName(),
          next: ed.getWrapper()?.find("[data-os-qz-next]")[0]?.get("type"),
          nextText: ed.getWrapper()?.find("[data-os-qz-next] .os-qz-btxt")[0]?.get("type"),
        };
      });
    expect(await top()).toEqual({
      name: "Topo do quiz",
      droppable: false,
      children: ["os-quiz-button", "os-quiz-bar"],
      bar: "Barra de progresso",
      next: "os-quiz-button",
      nextText: "text",
    });
    // Com o "Voltar" selecionado, um bloco clicado entra fora do topo (e fora do quiz).
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.select(ed.getWrapper()?.find("[data-os-qz-back]")[0]);
    });
    await page.locator("#blocks .gjs-block", { hasText: "Texto" }).first().click();
    expect((await top()).children).toEqual(["os-quiz-button", "os-quiz-bar"]);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  }, 60_000);

  it("HTML de antes (texto direto no <button>): o texto passa para um <span> editável", async () => {
    const page = await openEditor(browser);
    const result = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.setComponents(
        '<div class="os-quiz" data-os-widget="quiz"><div class="os-qz-top"><button type="button" class="os-qz-back" data-os-qz-back="">← Voltar</button></div>' +
          '<div class="os-qz-steps" data-os-qz-steps=""><section class="os-qz-step" data-os-qz-step="info"><h2>Oi</h2>' +
          '<button type="button" class="os-qz-next" data-os-qz-next="">Quero <b>ver</b></button></section></div></div>',
      );
      const one = (sel: string) => ed.getWrapper()?.find(sel)[0];
      return {
        back: one("[data-os-qz-back]")?.get("type"),
        backText: one("[data-os-qz-back] > span")?.get("type"),
        html: ed.getHtml(),
      };
    });
    expect(result.back).toBe("os-quiz-button");
    expect(result.backText).toBe("text");
    expect(result.html).toContain('<span class="os-qz-btxt">← Voltar</span>');
    expect(result.html).toContain('<span class="os-qz-btxt">Quero <b>ver</b></span>');
    await page.close();
  }, 60_000);
});

describe("quiz dentro de quiz", () => {
  it("clicar no bloco “Quiz” com um texto de uma etapa selecionado põe o quiz novo depois, não dentro", async () => {
    const page = await openEditor(browser);
    await addBlock(page, "quiz");
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.select(ed.getWrapper()?.find('[data-os-qz-step="question"] h2')[0]);
    });
    await page.locator("#blocks .gjs-block", { hasText: "Quiz" }).first().click();
    const result = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const quizzes = ed.getWrapper()?.find('[data-os-widget="quiz"]') ?? [];
      const dc = ed.Components as unknown as { canMove(target: unknown, source: unknown): { result: boolean } };
      const step = quizzes[0].find("[data-os-qz-step]")[0];
      return {
        count: quizzes.length,
        nested: quizzes.map((q) => !!q.parent()?.closest('[data-os-widget="quiz"]')),
        intoStep: dc.canMove(step, quizzes[1]).result,
        intoPage: dc.canMove(ed.getWrapper(), quizzes[1]).result,
      };
    });
    expect(result).toEqual({ count: 2, nested: [false, false], intoStep: false, intoPage: true });
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  }, 60_000);
});
