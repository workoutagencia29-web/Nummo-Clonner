/**
 * Páginas de produto criadas no editor, a partir da vitrine:
 *
 * - no cartão (a[data-os-product]): a opção "＋ Criar página deste produto…" da
 *   lista "Página do produto" (não grava nada: a lista volta ao valor de antes e
 *   o diálogo abre) e o botão "＋ Criar página deste produto" das
 *   Configurações (só quando o cartão não leva a lugar nenhum);
 * - na vitrine: "Criar as páginas que faltam (N)".
 *
 * Os dois abrem o diálogo do editor (src/editor/panels/product-page-dialog.tsx),
 * que cria as páginas na oferta (createProductPagesAction) e liga cada cartão à
 * sua. Sem o diálogo (editor sem o painel, nos testes de blocos), a opção e os
 * botões não aparecem.
 */
import type { Component, Editor } from "grapesjs";
import { watchEditor } from "./lifecycle";

/** Valor especial da lista "Página do produto": abre o diálogo, nunca vai para o href. */
export const NEW_PRODUCT_PAGE_OPTION = "__nova-pagina-produto__";
export const newProductPageOption = { id: NEW_PRODUCT_PAGE_OPTION, label: "＋ Criar página deste produto…" };

/** Botão "＋ Criar página deste produto" das Configurações do cartão. */
export const CREATE_PRODUCT_PAGE_TRAIT = "os-pd-criar-pagina";

export interface ProductPagesRequest {
  /** Cartões que ganham uma página cada (na ordem da vitrine). */
  cards: Component[];
  /** Pedido da vitrine ("Criar as páginas que faltam"): ela volta a ficar selecionada no fim. */
  widget?: Component;
}

const handlers = new WeakMap<Editor, (req: ProductPagesRequest) => void>();

/** O editor tem o diálogo de criar páginas de produto? */
export function canCreateProductPages(editor: Editor | undefined): boolean {
  return Boolean(editor && handlers.has(editor));
}

/** Abre o diálogo para estes cartões. false = o editor não tem o diálogo (ou não há cartão). */
export function requestProductPages(editor: Editor, req: ProductPagesRequest): boolean {
  const handler = handlers.get(editor);
  if (!handler || !req.cards.length) return false;
  handler(req);
  return true;
}

export function installProductPages(editor: Editor, onRequest: (req: ProductPagesRequest) => void) {
  watchEditor(editor);
  handlers.set(editor, onRequest);
  return () => {
    if (handlers.get(editor) === onRequest) handlers.delete(editor);
  };
}
