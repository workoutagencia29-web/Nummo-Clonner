/**
 * Clicar num bloco também adiciona o bloco (além de arrastar para a página):
 * - seções (topo, depoimentos, preços, rodapé…) entram depois da seção onde está
 *   o elemento selecionado;
 * - elementos (texto, botão, contador…) entram logo abaixo do elemento selecionado;
 * - sem nada selecionado, e para itens fixos na tela (WhatsApp flutuante, popup,
 *   notificação), vão para o fim da página;
 * - um quiz nunca entra dentro de outro (vai para depois do quiz selecionado);
 * - o cabeçalho de loja só mora no nível de cima da página (largura toda): vai
 *   para o topo, logo depois das barras que já estão lá ("Contagem no topo");
 * - nada entra em elementos que só aceitam certos filhos (etapas do quiz, a
 *   linha de vitrines lado a lado da Loja): sobe até um que aceite.
 * O bloco novo fica selecionado e aparece na tela. Um ⌘Z desfaz.
 */
import type { Block, Component, Editor } from "grapesjs";
import { topInsertIndex } from "@/editor/widgets/store-header-place";

const FIXED_ON_SCREEN = new Set(["whatsapp-flutuante", "popup-saida", "notificacao-compra"]);
const SECTION_TAGS = new Set(["section", "header", "footer", "article", "main", "nav"]);
const INLINE_TAGS = new Set([
  "a",
  "span",
  "b",
  "strong",
  "em",
  "i",
  "u",
  "s",
  "small",
  "sup",
  "sub",
  "br",
  "label",
  "mark",
]);

function tagOf(component: Component | undefined | null) {
  return String(component?.get("tagName") ?? "").toLowerCase();
}

function rootTagOf(block: Block) {
  const content = block.get("content") as unknown;
  const first = Array.isArray(content) ? content[0] : content;
  if (first && typeof first === "object" && "tagName" in first) return String(first.tagName).toLowerCase();
  if (typeof first === "string") return /^\s*<([a-z0-9-]+)/i.exec(first)?.[1]?.toLowerCase() ?? "";
  return "";
}

/** Widget da raiz do bloco (data-os-widget: "quiz", "store-header"…); "" se não for um. */
function blockWidget(block: Block): string {
  const content = block.get("content") as unknown;
  const first = (Array.isArray(content) ? content[0] : content) as
    | { attributes?: Record<string, unknown> }
    | string
    | undefined;
  if (typeof first === "string") return /^\s*<[^>]*data-os-widget=["']?([\w-]+)/i.exec(first)?.[1] ?? "";
  return String(first?.attributes?.["data-os-widget"] ?? "");
}

/** Seção que contém o componente (ou o filho direto da página). */
function sectionOf(component: Component, wrapper: Component) {
  let current: Component = component;
  while (current.parent() && current.parent() !== wrapper) {
    if (SECTION_TAGS.has(tagOf(current))) return current;
    current = current.parent() as Component;
  }
  return current;
}

/** Elemento de bloco mais próximo (não coloca uma seção dentro de um <a> ou <span>). */
function blockLevelOf(component: Component, wrapper: Component) {
  let current: Component = component;
  while (
    current.parent() &&
    current.parent() !== wrapper &&
    (INLINE_TAGS.has(tagOf(current)) || current.is("textnode"))
  ) {
    current = current.parent() as Component;
  }
  return current;
}

export function insertBlockOnClick(editor: Editor, block: Block) {
  const wrapper = editor.getWrapper();
  if (!wrapper) return;
  const content = block.get("content") as never;
  const selected = editor.getSelected();
  const isSection = SECTION_TAGS.has(rootTagOf(block));

  let parent: Component = wrapper;
  let at: number | undefined;
  if (blockWidget(block) === "store-header") {
    // Só no nível de cima (num contêiner ficaria estreito): no topo da página.
    at = topInsertIndex(wrapper);
  } else if (selected && selected !== wrapper && !FIXED_ON_SCREEN.has(String(block.getId()))) {
    let anchor = isSection ? sectionOf(selected, wrapper) : blockLevelOf(selected, wrapper);
    // Quiz dentro da etapa de outro: um clique responderia os dois. Vai para depois dele.
    if (blockWidget(block) === "quiz") {
      for (let at = anchor.parent(); at && at !== wrapper; at = at.parent()) {
        if (at.getAttributes()["data-os-widget"] === "quiz") anchor = at;
      }
    }
    // Não entra em componentes fechados (widgets, vídeos…) nem nos que só aceitam
    // certos elementos (etapas e opções do quiz): sobe até um que aceite.
    const closed = (c: Component | undefined) => {
      const droppable = c?.get("droppable");
      return droppable === false || typeof droppable === "string";
    };
    const start = anchor;
    while (anchor.parent() && anchor.parent() !== wrapper && closed(anchor.parent())) {
      anchor = anchor.parent() as Component;
    }
    // Seção que subiu até um elemento comum (ex.: a linha "Oferta do dia + ofertas",
    // que só recebe vitrines): entra depois da seção em volta dele, não dentro dela.
    if (isSection && anchor !== start && !SECTION_TAGS.has(tagOf(anchor))) anchor = sectionOf(anchor, wrapper);
    const anchorParent = anchor.parent();
    if (anchorParent) {
      parent = anchorParent;
      at = anchor.index() + 1;
    }
  }

  const added = parent.components().add(content, at === undefined ? {} : { at });
  const component = (Array.isArray(added) ? added[0] : added) as Component | undefined;
  if (!component) return;
  editor.select(component);
  editor.Canvas.scrollTo(component, { behavior: "smooth", block: "center" });
  // Mesmo comportamento de soltar o bloco: imagem abre a galeria, vídeo pede o endereço…
  if (block.get("activate")) component.trigger("active");
}
