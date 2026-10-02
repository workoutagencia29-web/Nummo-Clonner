/**
 * Opção "＋ Criar link da oferta…" nas listas de "Link da oferta" das
 * configurações de um elemento. Escolher a opção não grava nada no elemento:
 * o valor volta ao anterior e o editor abre o diálogo de link novo, que cria o
 * link na oferta e já liga o elemento a ele.
 */
import type { Component, Editor } from "grapesjs";
import { editorTimeout, watchEditor } from "./lifecycle";

export const NEW_LINK_OPTION = "__novo-link__";
export const NEW_LINK_EVENT = "os:novo-link";

export interface NewLinkRequest {
  component: Component;
  /** Tipo sugerido (botão de WhatsApp → WHATSAPP). */
  kind: "CHECKOUT" | "UPSELL" | "DOWNSELL" | "WHATSAPP" | "OTHER";
}

export const newLinkOption = { id: NEW_LINK_OPTION, label: "＋ Criar link da oferta…" };

export function installNewLinkOption(editor: Editor, onRequest: (req: NewLinkRequest) => void) {
  watchEditor(editor);
  // O GrapesJS pode avisar a mesma mudança mais de uma vez: um pedido por elemento.
  const pending = new WeakSet<Component>();
  const handler = (component: Component) => {
    const attrs = component.getAttributes();
    if (attrs["data-os-link"] !== NEW_LINK_OPTION || pending.has(component)) return;
    pending.add(component);
    const previous = (component.previous("attributes") as Record<string, string> | undefined)?.["data-os-link"];
    // Volta ao valor anterior fora do ciclo de mudança atual (e sem entrar no desfazer).
    editorTimeout(editor, () => {
      editor.UndoManager.skip(() => {
        if (previous === undefined) component.removeAttributes("data-os-link");
        else component.addAttributes({ "data-os-link": previous === NEW_LINK_OPTION ? "" : previous });
      });
      pending.delete(component);
      const isWhatsapp = component.get("type") === "os-whatsapp" || /wa\.me|whatsapp/i.test(String(attrs.href ?? ""));
      onRequest({ component, kind: isWhatsapp ? "WHATSAPP" : "CHECKOUT" });
    });
  };
  editor.on("component:update:attributes", handler);
  return () => editor.off("component:update:attributes", handler);
}
