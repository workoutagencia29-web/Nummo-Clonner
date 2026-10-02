/**
 * Clique no texto de um botão seleciona o botão (o link), não o trecho de dentro.
 *
 * Em páginas clonadas (Elementor, WordPress…), o texto do botão fica num <span>
 * dentro do <a>. Sem isto, clicar no botão selecionava o <span> e a aba
 * "Configurações" não mostrava "Link da oferta", "Página do funil" nem "Evento
 * ao clicar" — só depois de "Selecionar o bloco de fora", que quase ninguém acha.
 *
 * - Primeiro clique: seleciona o link/botão (como no Webflow e no Elementor).
 * - Outro clique com o botão já selecionado: entra no trecho de dentro (para
 *   mudar o estilo só dele).
 * - Dois cliques continuam editando o texto.
 * - ⌘/Ctrl/Shift (seleção de vários), camadas e seleção pelo código: como antes.
 *
 * Só vale para links/botões "de botão": texto curto e ícones, sem seções,
 * títulos, listas ou formulários dentro (um <a> que envolve um cartão inteiro
 * continua deixando escolher o que está dentro).
 */
import type { Component, Editor } from "grapesjs";
import { isClickableElement } from "./components";

/** Quantos níveis acima do elemento clicado o link/botão pode estar. */
const MAX_DEPTH = 4;
/** Texto mais longo que isso não é um botão (é um parágrafo com link, um cartão…). */
const MAX_TEXT = 160;
/** Elementos que cabem dentro de um botão: texto, ícones e as caixas que os agrupam. */
const BUTTON_CONTENT_TAGS = new Set([
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "small",
  "mark",
  "sup",
  "sub",
  "br",
  "font",
  "abbr",
  "code",
  "del",
  "ins",
  "q",
  "time",
  "bdi",
  "wbr",
  "img",
  "svg",
  "div",
  "p",
]);
/** Elementos que contam no máximo de um botão (texto e ícones de verdade). */
const MAX_ELEMENTS = 10;

const tagOf = (c: Component) => String(c.get("tagName") ?? "").toLowerCase();
const isTextNode = (c: Component) => ["textnode", "comment"].includes(String(c.get("type") ?? ""));

/** O conteúdo do link/botão é só texto curto e ícones (sem blocos, nem outro link dentro)? */
export function isButtonLike(component: Component): boolean {
  const el = component.getEl();
  if (el && (el.textContent ?? "").trim().length > MAX_TEXT) return false;
  let elements = 0;
  const visit = (c: Component, depth: number): boolean => {
    for (const child of c.components().models) {
      if (isTextNode(child)) continue;
      const tag = tagOf(child);
      if (!BUTTON_CONTENT_TAGS.has(tag)) return false;
      if (++elements > MAX_ELEMENTS || depth > MAX_DEPTH) return false;
      if (isClickableElement(tag, child.getAttributes())) return false;
      // Ícone: o que está dentro do <svg> não conta.
      if (tag !== "svg" && !visit(child, depth + 1)) return false;
    }
    return true;
  };
  return visit(component, 0);
}

/**
 * Link/botão "de botão" que envolve o elemento (até alguns níveis acima), ou
 * null. O elemento e o caminho até o link precisam ser conteúdo de botão.
 */
export function clickableAncestor(component: Component): Component | null {
  if (!BUTTON_CONTENT_TAGS.has(tagOf(component))) return null;
  let current = component.parent();
  for (let depth = 0; current && depth < MAX_DEPTH; depth++, current = current.parent()) {
    if (current.get("type") === "wrapper") return null;
    if (isClickableElement(tagOf(current), current.getAttributes())) {
      return current.get("selectable") !== false && isButtonLike(current) ? current : null;
    }
    if (!BUTTON_CONTENT_TAGS.has(tagOf(current))) return null;
  }
  return null;
}

/**
 * Link/botão que envolve o elemento, para o atalho "Configurar o botão" do
 * painel (mais solto que clickableAncestor: qualquer link a até 4 níveis).
 */
export function enclosingClickable(component: Component): Component | null {
  let current = component.parent();
  for (let depth = 0; current && depth < MAX_DEPTH; depth++, current = current.parent()) {
    if (current.get("type") === "wrapper") return null;
    if (isClickableElement(tagOf(current), current.getAttributes())) {
      return current.get("selectable") !== false ? current : null;
    }
  }
  return null;
}

function isInside(component: Component, ancestor: Component) {
  for (let p = component.parent(); p; p = p.parent()) if (p === ancestor) return true;
  return false;
}

interface SelectOpts {
  event?: MouseEvent;
  abort?: boolean;
  useValid?: boolean;
}

/** Liga o comportamento ao editor. Devolve a função que desliga. */
export function installLinkSelection(editor: Editor) {
  const onSelectBefore = (component: Component | undefined, opts: SelectOpts | undefined) => {
    const event = opts?.event;
    // Só o clique no canvas (camadas, atalhos e código selecionam o que pediram).
    if (!component || !opts || !event || event.type !== "click") return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = clickableAncestor(component);
    if (!target) return;
    const selected = editor.getSelectedAll();
    if (selected.includes(target)) {
      // Botão já selecionado: um novo clique entra no trecho de dentro; o
      // segundo clique de um duplo clique mantém o botão (o texto vai ser editado).
      if (event.detail <= 1) return;
    } else if (selected.some((s) => isInside(s, target))) {
      // Já está dentro do botão: continua escolhendo os trechos de dentro.
      return;
    }
    opts.abort = true;
    opts.useValid = false;
    if (selected.length !== 1 || selected[0] !== target) editor.select(target);
  };

  // Passar o mouse no texto do botão destaca o botão (o que o clique vai selecionar).
  const onHoverBefore = (component: Component | undefined, opts: SelectOpts | undefined) => {
    if (!component || !opts || opts.abort) return;
    const target = clickableAncestor(component);
    if (!target) return;
    const selected = editor.getSelectedAll();
    if (selected.includes(target) || selected.some((s) => s === component || isInside(s, target))) return;
    opts.abort = true;
    const model = editor.getModel() as unknown as { setHovered(c: Component, o?: object): void };
    model.setHovered(target, { forceChange: false });
  };

  editor.on("component:select:before", onSelectBefore);
  editor.on("component:hover:before", onHoverBefore);
  return () => {
    editor.off("component:select:before", onSelectBefore);
    editor.off("component:hover:before", onHoverBefore);
  };
}
