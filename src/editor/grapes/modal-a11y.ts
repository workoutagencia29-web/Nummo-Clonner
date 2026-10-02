/**
 * Janela nativa do GrapesJS ("Escolher imagem") com o mesmo jeito dos outros
 * diálogos do editor (shadcn/Radix):
 *
 * - role="dialog", aria-modal e o título como nome (leitores de tela e testes
 *   acham a janela por role=dialog);
 * - "×" de verdade (botão com "Fechar", foco pelo teclado) e "Cancelar" no rodapé;
 * - foco preso dentro da janela (Tab/Shift+Tab), Esc fecha e, ao fechar, o foco
 *   volta para onde estava.
 */
import type { Editor } from "grapesjs";
import { buttonVariants } from "@/components/ui/button";

const TITLE_ID = "os-mdl-title";
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** O mesmo "X" dos diálogos do painel (lucide). */
const CLOSE_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

function modalElements(editor: Editor) {
  const root = (editor.getContainer?.() as HTMLElement | undefined) ?? document.body;
  const container =
    root.querySelector<HTMLElement>(".gjs-mdl-container") ?? document.querySelector<HTMLElement>(".gjs-mdl-container");
  const dialog = container?.querySelector<HTMLElement>(".gjs-mdl-dialog") ?? null;
  return { container: container ?? null, dialog };
}

function visible(el: HTMLElement) {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

/** Liga as melhorias à janela do editor. Devolve a função que desliga. */
export function installModalA11y(editor: Editor): () => void {
  let returnFocus: HTMLElement | null = null;
  let dialogEl: HTMLElement | null = null;

  const close = () => editor.Modal.close();

  const onKeyDown = (e: KeyboardEvent) => {
    if (!dialogEl || !editor.Modal.isOpen()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const items = Array.from(dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialogEl.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialogEl.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  const enhance = (dialog: HTMLElement) => {
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const title = dialog.querySelector<HTMLElement>(".gjs-mdl-title");
    if (title) {
      title.id = TITLE_ID;
      title.setAttribute("role", "heading");
      title.setAttribute("aria-level", "2");
      dialog.setAttribute("aria-labelledby", TITLE_ID);
    }
    const x = dialog.querySelector<HTMLElement>(".gjs-mdl-btn-close");
    if (x && !x.dataset.osEnhanced) {
      x.dataset.osEnhanced = "1";
      x.setAttribute("role", "button");
      x.setAttribute("tabindex", "0");
      x.setAttribute("aria-label", "Fechar");
      x.setAttribute("title", "Fechar");
      x.innerHTML = CLOSE_ICON;
      x.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          close();
        }
      });
    }
    if (!dialog.querySelector(".os-mdl-footer")) {
      const footer = document.createElement("div");
      footer.className = "os-mdl-footer";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = buttonVariants({ variant: "outline" });
      cancel.textContent = "Cancelar";
      cancel.addEventListener("click", close);
      footer.appendChild(cancel);
      dialog.appendChild(footer);
    }
  };

  const onOpen = () => {
    const { dialog } = modalElements(editor);
    if (!dialog) return;
    dialogEl = dialog;
    const active = document.activeElement;
    returnFocus = active instanceof HTMLElement && !dialog.contains(active) ? active : null;
    enhance(dialog);
    document.addEventListener("keydown", onKeyDown, true);
    // Depois que o conteúdo (imagens) foi montado: foco no primeiro campo útil.
    requestAnimationFrame(() => {
      if (!editor.Modal.isOpen() || dialog.contains(document.activeElement)) return;
      const target =
        dialog.querySelector<HTMLElement>(".gjs-mdl-content input:not([type=file])") ??
        dialog.querySelector<HTMLElement>(".gjs-mdl-btn-close");
      target?.focus();
    });
  };

  const onClose = () => {
    document.removeEventListener("keydown", onKeyDown, true);
    dialogEl = null;
    const back = returnFocus;
    returnFocus = null;
    if (back?.isConnected) back.focus();
  };

  editor.on("modal:open", onOpen);
  editor.on("modal:close", onClose);
  return () => {
    editor.off("modal:open", onOpen);
    editor.off("modal:close", onClose);
    document.removeEventListener("keydown", onKeyDown, true);
  };
}
