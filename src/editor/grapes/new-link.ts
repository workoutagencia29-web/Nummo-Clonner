/**
 * Opção "＋ Criar link da oferta…" nas listas de "Link da oferta" das
 * configurações de um elemento. Escolher a opção não grava nada no elemento:
 * o valor volta ao anterior e o editor abre o diálogo de link novo, que cria o
 * link na oferta e já liga o elemento a ele. O diálogo deixa escolher o
 * destino ("Endereço" ou "Checkout do Offer Studio"); o "Botão de checkout"
 * solto numa oferta sem link desse destino já pede o checkout do Offer Studio.
 */
import type { Component, Editor } from "grapesjs";
import { NEW_LINK_TARGET_ATTR, NEW_LINK_TARGET_CHECKOUT } from "@/lib/checkout/rules";
import { editorTimeout, watchEditor } from "./lifecycle";

export const NEW_LINK_OPTION = "__novo-link__";
export const NEW_LINK_EVENT = "os:novo-link";

/** Destino do link novo. CHECKOUT = "Checkout do Offer Studio". */
export type NewLinkTarget = "URL" | "CHECKOUT";

export interface NewLinkRequest {
  component: Component;
  /** Tipo sugerido (botão de WhatsApp → WHATSAPP). */
  kind: "CHECKOUT" | "UPSELL" | "DOWNSELL" | "WHATSAPP" | "OTHER";
  /** Nome sugerido ("Checkout 30% OFF"); sem ele, o do tipo. */
  name?: string;
  /** Liga ao link criado de outro jeito (ex.: fatia da roleta); sem ele, data-os-link no elemento. */
  bind?: (key: string) => void;
  /** Destino sugerido (padrão: endereço). */
  target?: NewLinkTarget;
}

/**
 * "Botão de checkout" solto sem nenhum link "Checkout do Offer Studio" na
 * oferta (src/editor/widgets/hooks.ts): o próprio botão guarda a preferência
 * (data-os-new-link="checkout", vai no HTML e no projeto salvos), e o link
 * novo dele nasce com esse destino também depois de reabrir a página, pelo
 * "＋ Criar link da oferta…" das Configurações e pelo "Criar link da oferta"
 * dos "Botões de compra sem link" (diálogo "Links e checkouts" do editor).
 * Some quando o botão é ligado a um link ou deixa de pedir link
 * (forgetNewLinkTarget) e o render a tira da página (applyOfferLinks).
 */
export function wantOwnCheckout(component: Component) {
  component.addAttributes({ [NEW_LINK_TARGET_ATTR]: NEW_LINK_TARGET_CHECKOUT });
}

/** Destino sugerido para o link novo de um elemento. */
export function suggestedTarget(component: Component): NewLinkTarget {
  return component.getAttributes()[NEW_LINK_TARGET_ATTR] === NEW_LINK_TARGET_CHECKOUT ? "CHECKOUT" : "URL";
}

/**
 * Botão ligado a um link (qualquer um) ou que deixou de pedir link (endereço
 * digitado, página do funil): a preferência pelo destino do link novo sai. Na
 * mesma pilha da mudança, então o Desfazer da ligação a devolve junto. O
 * "＋ Criar link da oferta…" (o valor volta ao de antes) e o vazio não contam.
 */
export function forgetNewLinkTarget(editor: Editor) {
  editor.on("component:update:attributes", (component: Component) => {
    const attrs = component.getAttributes();
    if (attrs[NEW_LINK_TARGET_ATTR] === undefined) return;
    const key = attrs["data-os-link"];
    if (key === "" || key === NEW_LINK_OPTION) return;
    component.removeAttributes(NEW_LINK_TARGET_ATTR);
  });
}

const handlers = new WeakMap<Editor, (req: NewLinkRequest) => void>();

/**
 * Abre o diálogo de link novo de fora de uma lista "Link da oferta" (ex.: o
 * prêmio de uma fatia da roleta). false = o editor não tem o diálogo.
 */
export function requestNewLink(editor: Editor, req: NewLinkRequest): boolean {
  const handler = handlers.get(editor);
  if (!handler) return false;
  handler(req);
  return true;
}

export const newLinkOption = { id: NEW_LINK_OPTION, label: "＋ Criar link da oferta…" };

export function installNewLinkOption(editor: Editor, onRequest: (req: NewLinkRequest) => void) {
  watchEditor(editor);
  handlers.set(editor, onRequest);
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
      onRequest(
        isWhatsapp
          ? { component, kind: "WHATSAPP" }
          : { component, kind: "CHECKOUT", target: suggestedTarget(component) },
      );
    });
  };
  editor.on("component:update:attributes", handler);
  return () => {
    editor.off("component:update:attributes", handler);
    if (handlers.get(editor) === onRequest) handlers.delete(editor);
  };
}
