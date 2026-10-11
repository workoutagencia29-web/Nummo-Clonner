/**
 * Limite do Desfazer em passos (src/editor/grapes/undo-limit.ts): um bloco com
 * CSS próprio (cabeçalho de loja, vitrine, quiz, roleta, galeria) gasta um
 * registro por regra da pilha do GrapesJS. Com o limite contado em registros
 * (150), pôr um cabeçalho descartava tudo o que a pessoa tinha feito antes — e
 * até o começo do próprio passo (desfazer deixava regras para trás).
 *
 * - a conta e o corte (cada passo sai inteiro, o mais antigo primeiro);
 * - no editor: depois de pôr cada bloco, as ações de antes continuam no
 *   Desfazer; desfazer o bloco tira ele e todo o CSS que ele trouxe, e refazer
 *   devolve; a pilha guarda 150 passos (não 150 registros).
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countSteps, trimSteps, UNDO_STEPS } from "@/editor/grapes/undo-limit";
import { type EditorWindow, openEditor, pageErrors } from "./blocks-harness";

describe("conta e corte dos passos", () => {
  /** Pilha de mentira: cada número é o passo (magicFusionIndex) de um registro. */
  const fake = (steps: number[], pointer = steps.length - 1) => {
    const models = steps.map((step) => ({ get: () => step }));
    return {
      models,
      pointer,
      get length() {
        return models.length;
      },
      shift() {
        return models.shift();
      },
      on() {},
    };
  };

  it("registros seguidos do mesmo passo contam uma vez", () => {
    expect(countSteps(fake([]))).toBe(0);
    expect(countSteps(fake([1, 1, 1, 2, 3, 3]))).toBe(3);
  });

  it("o passo mais antigo sai inteiro (nunca pela metade), com o ponteiro junto", () => {
    const stack = fake([1, 1, 1, 2, 3, 3, 3, 3]);
    trimSteps(stack, 2);
    expect(stack.models.map((m) => m.get())).toEqual([2, 3, 3, 3, 3]);
    expect(stack.pointer).toBe(4);
    trimSteps(stack, 1);
    expect(stack.models.map((m) => m.get())).toEqual([3, 3, 3, 3]);
    expect(stack.pointer).toBe(3);
    // Dentro do limite: nada sai.
    trimSteps(stack, 5);
    expect(stack.models).toHaveLength(4);
  });
});

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** Uma ação da pessoa (um passo do Desfazer): um título novo no fim da página. */
const addTitle = (page: Page, n: number) =>
  page.evaluate(async (i) => {
    (window as unknown as EditorWindow).ed.getWrapper()?.append(`<h2 id="titulo-${i}">Título ${i}</h2>`);
    // O passo seguinte é outra ação (o GrapesJS junta o que roda junto).
    await new Promise((r) => setTimeout(r, 5));
  }, n);

const state = (page: Page) =>
  page.evaluate(() => {
    const ed = (window as unknown as EditorWindow).ed;
    return {
      titles: ed.getWrapper()?.find("h2").length ?? 0,
      children: ed.getWrapper()?.components().length ?? 0,
      // Regras com alguma declaração (a do id do cabeçalho pode ficar vazia: a proporção
      // do logo é gravada fora do Desfazer e sai depois dele).
      rules: ed.Css.getRules().filter((r) => Object.keys(r.getStyle()).length > 0).length,
      steps: ed.UndoManager.getStackGroup().length,
      hasUndo: ed.UndoManager.hasUndo(),
    };
  });

const undo = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as EditorWindow).ed.UndoManager.undo();
  });
const redo = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as EditorWindow).ed.UndoManager.redo();
  });

describe("no editor", () => {
  it.each([
    ["cabecalho-loja", "Cabeçalho de loja"],
    ["grade-produtos", "vitrine"],
    ["quiz", "quiz"],
    ["roleta", "roleta"],
    ["galeria-produto", "galeria do produto"],
  ])("pôr o bloco “%s” (%s) não apaga o Desfazer de antes; desfazer tira o bloco e o CSS dele, refazer devolve", async (blockId) => {
    const page = await openEditor(browser);
    for (let i = 1; i <= 5; i++) await addTitle(page, i);
    const before = await state(page);
    expect(before.titles).toBe(5);
    expect(before.steps).toBe(5);

    await page.evaluate(async (id) => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.getWrapper()?.append(ed.Blocks.get(id)?.get("content") as never);
      await new Promise((r) => setTimeout(r, 30));
    }, blockId);
    const placed = await state(page);
    // O bloco trouxe muitas regras de CSS e entrou como UM passo.
    expect(placed.rules - before.rules).toBeGreaterThan(0);
    expect(placed.steps).toBe(6);
    expect(
      await page.evaluate(() => (window as unknown as EditorWindow).ed.UndoManager.getStack().length),
    ).toBeGreaterThan(6);

    // Desfazer o bloco: sai ele e o CSS que ele trouxe (nada fica para trás).
    await undo(page);
    expect(await state(page)).toMatchObject({ titles: 5, children: before.children, rules: before.rules });
    // Refazer: volta tudo.
    await redo(page);
    expect(await state(page)).toMatchObject({ children: placed.children, rules: placed.rules });
    // As 5 ações de antes continuam no Desfazer.
    await undo(page);
    for (let i = 5; i >= 1; i--) {
      await undo(page);
      expect((await state(page)).titles).toBe(i - 1);
    }
    expect((await state(page)).hasUndo).toBe(false);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it("guarda os últimos 150 passos (não 150 registros), cada um inteiro", async () => {
    const page = await openEditor(browser);
    // Um cabeçalho de loja no começo (mais de 150 registros num passo só).
    await page.evaluate(async () => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.getWrapper()?.append(ed.Blocks.get("cabecalho-loja")?.get("content") as never);
      await new Promise((r) => setTimeout(r, 30));
    });
    expect((await state(page)).steps).toBe(1);
    expect(
      await page.evaluate(() => (window as unknown as EditorWindow).ed.UndoManager.getStack().length),
    ).toBeGreaterThan(100);
    for (let i = 1; i <= 155; i++) await addTitle(page, i);
    const full = await state(page);
    expect(full.steps).toBe(UNDO_STEPS);
    // O passo do cabeçalho (o mais antigo) saiu inteiro: desfazer tudo deixa os 5 primeiros títulos e o cabeçalho.
    for (let i = 0; i < UNDO_STEPS; i++) await undo(page);
    const end = await state(page);
    expect(end.hasUndo).toBe(false);
    expect(end.titles).toBe(5);
    expect(
      await page.evaluate(
        () => (window as unknown as EditorWindow).ed.getWrapper()?.find('[data-os-widget="store-header"]').length,
      ),
    ).toBe(1);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  }, 60_000);
});
