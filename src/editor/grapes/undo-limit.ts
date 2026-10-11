/**
 * Limite do Desfazer contado em PASSOS (cada ação da pessoa), não em registros
 * internos do GrapesJS.
 *
 * Um passo do Desfazer junta tudo o que mudou na mesma ação (o mesmo
 * `magicFusionIndex` da pilha: tudo o que roda junto, até os microtasks). Um
 * bloco com CSS próprio gasta um registro por regra e outro pelo estilo dela:
 * o "Cabeçalho de loja" passava de 150 registros sozinho, e com o limite de 150
 * registros a pilha descartava tudo o que a pessoa tinha feito antes (e até o
 * começo do próprio passo: desfazer deixava regras para trás). Aqui o GrapesJS
 * guarda sem limite e o passo mais antigo sai inteiro quando passa de
 * UNDO_STEPS passos.
 */
import type { Editor } from "grapesjs";

/** Quantos passos o Desfazer guarda. */
export const UNDO_STEPS = 150;

interface UndoAction {
  get(key: "magicFusionIndex"): unknown;
}

/** A pilha do Backbone.Undo (coleção de ações com o ponteiro da posição atual). */
interface UndoStack {
  models: UndoAction[];
  length: number;
  pointer: number;
  shift(): unknown;
  on(event: "add", callback: (action: UndoAction) => void): void;
}

/** Quantos passos há na pilha (registros seguidos do mesmo passo contam uma vez). */
export function countSteps(stack: Pick<UndoStack, "models">): number {
  let steps = 0;
  let last: unknown;
  for (const action of stack.models) {
    const step = action.get("magicFusionIndex");
    if (steps === 0 || step !== last) steps++;
    last = step;
  }
  return steps;
}

/** Tira da pilha os passos mais antigos (cada um inteiro) até sobrarem `max`. */
export function trimSteps(stack: UndoStack, max: number) {
  let extra = countSteps(stack) - max;
  while (extra > 0 && stack.length) {
    const oldest = stack.models[0].get("magicFusionIndex");
    while (stack.length && stack.models[0].get("magicFusionIndex") === oldest) {
      stack.shift();
      stack.pointer--;
    }
    extra--;
  }
}

/**
 * Liga o limite por passos. O editor precisa ser criado com
 * `undoManager.maximumStackLength` infinito (o corte por registro, do
 * Backbone.Undo, partiria um passo no meio).
 */
export function installUndoLimit(editor: Editor, max = UNDO_STEPS) {
  const stack = editor.UndoManager.getStack() as unknown as UndoStack;
  // Cada registro novo entra pelo fim (o que estava depois do ponteiro já saiu). Só um
  // passo novo pode passar do limite: os outros registros do mesmo passo não contam.
  stack.on("add", (action) => {
    const prev = stack.models[stack.models.length - 2];
    if (prev && prev.get("magicFusionIndex") === action.get("magicFusionIndex")) return;
    trimSteps(stack, max);
  });
}
