/**
 * Ciclo de vida do editor para os temporizadores dos módulos do Offer Studio.
 *
 * O GrapesJS avisa "destroy" ANTES de desmontar os módulos; ao desmontar, ele
 * remove componentes e regras, o que dispara de novo os agendamentos
 * (component:remove, add/remove de regras…). Um setTimeout criado nesse momento
 * rodaria com o editor já destruído e quebraria (getWrapper de undefined) —
 * por exemplo ao sair do editor ou no duplo mount do React em desenvolvimento.
 *
 * Use editorTimeout no lugar de setTimeout: depois de "destroy" nada roda.
 * watchEditor precisa ser chamado cedo (createEditor e cada rotina install*).
 */
import type { Editor } from "grapesjs";

const closed = new WeakSet<Editor>();
const watched = new WeakSet<Editor>();

/** O editor já foi destruído (ou está sendo)? */
export function isEditorClosed(editor: Editor) {
  watchEditor(editor);
  return closed.has(editor);
}

/**
 * Começa a acompanhar o editor. Chame no início de cada rotina que agenda
 * tarefas (antes de qualquer agendamento), para o aviso "destroy" ser visto.
 */
export function watchEditor(editor: Editor) {
  if (watched.has(editor)) return;
  watched.add(editor);
  editor.on("destroy", () => closed.add(editor));
}

/** setTimeout que não roda depois que o editor foi destruído. */
export function editorTimeout(editor: Editor, fn: () => void, ms = 0): ReturnType<typeof setTimeout> {
  watchEditor(editor);
  return setTimeout(() => {
    if (!closed.has(editor)) fn();
  }, ms);
}

/** requestAnimationFrame que não roda depois que o editor foi destruído. */
export function editorFrame(editor: Editor, fn: () => void): number {
  watchEditor(editor);
  return requestAnimationFrame(() => {
    if (!closed.has(editor)) fn();
  });
}
