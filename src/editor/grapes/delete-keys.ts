/**
 * Backspace/Delete fora do canvas: o atalho do GrapesJS (core:component-delete,
 * ouvido no `document`) apaga o elemento selecionado sempre que o foco não está
 * num campo de digitar — também com o foco num botão das Configurações ou de
 * um diálogo (ex.: "Criar página", que acabou de ligar o cartão). Aqui essas
 * teclas param no contêiner: nos campos, continuam apagando o texto (a ação
 * padrão do navegador não muda).
 */

const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;

/** Para Backspace/Delete dentro de `el` (painel, diálogo). Devolve o "desligar". */
export function guardDeleteKeys(el: HTMLElement): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Backspace" && e.key !== "Delete") return;
    const target = e.target as HTMLElement | null;
    if (target && (TYPING.test(target.tagName) || target.isContentEditable)) return;
    e.stopPropagation();
  };
  el.addEventListener("keydown", onKeyDown);
  return () => el.removeEventListener("keydown", onKeyDown);
}

/**
 * Depois de fechar um diálogo do editor, o foco vai para as Configurações (a
 * lista `traitName`, se o elemento selecionado a tem; senão o próprio painel) —
 * nunca para o <body>, onde Backspace/Delete apagariam o elemento selecionado.
 */
export function focusSettings(traitName?: string) {
  const panel = document.querySelector<HTMLElement>('[data-os-panel="config"]');
  if (!panel) return;
  const field = traitName
    ? panel.querySelector<HTMLElement>(
        `[class*="trait__wrp-${traitName}"] select, [class*="trait__wrp-${traitName}"] input`,
      )
    : null;
  const target = field && field.offsetParent !== null ? field : panel;
  target.focus({ preventScroll: true });
}
