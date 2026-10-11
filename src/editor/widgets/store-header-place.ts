/**
 * Lugar do cabeçalho de loja no editor: ele só mora no nível de cima da página
 * (filho direto do <body>). Dentro de um contêiner — o bloco "Seção" da
 * Estrutura, uma seção de modelo — ele pega o padding e a largura máxima do
 * contêiner e fica estreito, com margem dos lados e um espaço em cima, no
 * computador e no celular.
 *
 * - Arrastar (bloco, barra do elemento, Camadas) só solta no nível de cima
 *   (`headerDropAllowed`, no `draggable` do tipo: o GrapesJS sobe sozinho até
 *   um alvo aceito, então a linha de soltar aparece entre os elementos de cima).
 *   No canvas, com o mouse sobre um elemento de cima, a linha fica no topo dele
 *   e o cabeçalho entra antes dele, como ao colar (`headerDropPosition`; o
 *   GrapesJS escolheria pela metade do elemento em que está o mouse — numa
 *   seção alta, "depois" fica longe, muitas vezes fora da tela). Solto, ele
 *   aparece na tela.
 * - Colado, duplicado, movido ou posto por código dentro de um contêiner: volta
 *   para o nível de cima, logo antes do elemento de cima em que caiu, no mesmo
 *   passo do Desfazer (`watchHeaderPlace`; a conferência é um microtask, que
 *   roda antes de o Desfazer fechar o passo).
 * - Clicar no bloco põe o cabeçalho no topo da página, logo depois das barras
 *   que já estiverem lá (`topInsertIndex`, src/editor/grapes/click-to-add.ts).
 * - Página já gravada com ele dentro de um contêiner: o reparo ao abrir
 *   (`liftStoreHeaders`, chamado por src/editor/grapes/legacy-repair.ts quando
 *   o servidor manda `storeHeaders`).
 * - Exceção: dentro de um bloco que começa escondido (HIDDEN_HOST: popup,
 *   atraso, etapa do quiz, roleta) ele fica onde está, como a barra fixa.
 *
 * A página publicada que ainda não foi reaberta faz o mesmo pelo script
 * (initStore, src/runtime/widgets/store.ts).
 */
import type { Component, Editor } from "grapesjs";
import { type Patchable, patchOnce } from "@/editor/grapes/components";
import { editorMicrotask } from "@/editor/grapes/lifecycle";
import { HIDDEN_HOST } from "@/lib/countdown-bar";
import { attr, descendants } from "./dom";

const isHeader = (c: Component) => attr(c, "data-os-widget") === "store-header";

/** O componente casa com o seletor, pelos atributos dele (vale antes de o canvas desenhar). */
function matchesAttrs(c: Component, selector: string): boolean {
  const probe = document.createElement("div");
  for (const [name, value] of Object.entries(c.getAttributes())) {
    if (value === false || value === null || value === undefined) continue;
    try {
      probe.setAttribute(name, value === true ? "" : String(value));
    } catch {
      // nome de atributo que o navegador não aceita: não entra no seletor
    }
  }
  return probe.matches(selector);
}

/** `c` ou um elemento acima dele começa escondido na página (popup, atraso, etapa do quiz, roleta). */
export function inHiddenHost(c: Component | undefined): boolean {
  for (let at = c; at?.parent(); at = at.parent()) if (matchesAttrs(at, HIDDEN_HOST)) return true;
  return false;
}

/** Raiz da página (wrapper) em que `c` está, se ele está numa. */
function rootOf(c: Component): Component | undefined {
  let at: Component = c;
  while (at.parent()) at = at.parent() as Component;
  return at.is("wrapper") ? at : undefined;
}

/** Elemento do nível de cima da página que contém `c` (o próprio `c`, se ele já está lá). */
function topOf(c: Component): Component {
  let at: Component = c;
  while (at.parent()?.parent()) at = at.parent() as Component;
  return at;
}

/** Cabeçalho fora do lugar: dentro de um contêiner que não começa escondido. */
function misplaced(header: Component): boolean {
  const parent = header.parent();
  return !!parent && !parent.is("wrapper") && !inHiddenHost(parent);
}

/**
 * Leva para o nível de cima os cabeçalhos de loja de `scope` (ele mesmo e o
 * que está dentro) que caíram num contêiner: cada um vai para logo antes do
 * elemento de cima que o continha. Devolve os que mudaram de lugar.
 */
export function liftStoreHeaders(scope: Component): Component[] {
  const lifted: Component[] = [];
  const headers = isHeader(scope) ? [scope] : descendants(scope, isHeader);
  for (const header of headers) {
    const root = rootOf(header);
    if (!root || !misplaced(header)) continue;
    const top = topOf(header);
    header.move(root, { at: top.index() });
    lifted.push(header);
  }
  return lifted;
}

/** Arrastes em andamento (bloco, barra do elemento, Camadas), por editor. */
const dragging = new WeakSet<Editor>();
/** …em que o que se arrasta é um cabeçalho de loja (bloco novo ou um da página). */
const draggingHeader = new WeakSet<Editor>();

/**
 * O cabeçalho pode ir para dentro de `target`? Num arraste, só no nível de
 * cima ou dentro de um bloco que começa escondido. Fora de um arraste (colar,
 * código), sim: o que cair num contêiner volta para o nível de cima
 * (watchHeaderPlace) — recusar faria o ⌘V não fazer nada.
 */
export function headerDropAllowed(editor: Editor, target: Component): boolean {
  return !dragging.has(editor) || target.is("wrapper") || inHiddenHost(target);
}

/**
 * Confere o lugar dos cabeçalhos a cada elemento posto na página (depois de o
 * editor abrir: o reparo ao abrir cuida das páginas gravadas). Desfazer e
 * Refazer não passam por aqui: voltam a um estado que já foi conferido.
 */
export function watchHeaderPlace(editor: Editor) {
  let ready = false;
  let added: Component[] = [];
  /** Cabeçalho solto por um arraste (a linha de soltar pode ter ficado fora da tela). */
  let dropped: Component | undefined;
  const show = (header: Component) => editor.Canvas.scrollTo(header, { behavior: "smooth", block: "nearest" });
  const check = () => {
    const wrapper = editor.getWrapper();
    const tops = new Set<Component>();
    for (const c of added) if (wrapper && rootOf(c) === wrapper) tops.add(topOf(c));
    added = [];
    for (const top of tops) {
      // Ele mudou de lugar: aparece na tela (ex.: colado com algo de baixo selecionado).
      for (const header of liftStoreHeaders(top)) show(header);
    }
    if (dropped && wrapper && rootOf(dropped) === wrapper) show(dropped);
    dropped = undefined;
  };
  editor.on("load", () => {
    ready = true;
  });
  editor.on("component:add", (c: Component, opts: { temporary?: boolean } = {}) => {
    const stack = editor.UndoManager.getStack() as unknown as { isCurrentlyUndoRedoing?: boolean };
    if (!ready || opts.temporary || stack.isCurrentlyUndoRedoing) return;
    if (!added.length) editorMicrotask(editor, check);
    added.push(c);
    if (dragging.has(editor) && isHeader(c)) dropped = c;
  });
  editor.on("sorter:drag:start block:drag:start", () => dragging.add(editor));
  // O que se arrasta (no bloco novo, um modelo provisório dele): só o cabeçalho muda a linha de soltar.
  editor.on("sorter:drag:start", (_source: unknown, from?: { model?: unknown }) => {
    const model = from?.model as Component | undefined;
    if (model && typeof model.getAttributes === "function" && isHeader(model)) draggingHeader.add(editor);
    else draggingHeader.delete(editor);
  });
  editor.on("sorter:drag:end block:drag:stop", () => {
    dragging.delete(editor);
    draggingHeader.delete(editor);
  });
  headerDropPosition(editor);
}

// ─── Linha de soltar no canvas ───────────────────────────────────────────────

/** Medidas de um elemento no arraste do GrapesJS (relativas ao canvas, como o mouse). */
interface DropBox {
  top: number;
  left: number;
  width: number;
  height: number;
  /** Índice do elemento entre os filhos (contando os que não têm medida). */
  indexEl?: number;
  clone(): DropBox;
}
/** Lugar de soltar que o GrapesJS calcula (índice no alvo, antes/depois/dentro, onde desenhar a linha). */
interface DropPlace {
  index: number;
  placement: string;
  placeholderDimensions: DropBox;
}
/** O que a regra lê do arraste do GrapesJS (DropLocationDeterminer, 0.23.6). */
interface DropDeterminer {
  em: object;
  containerContext?: { document?: Document };
  getDropPosition(node: DropNode, x: number, y: number): DropPlace;
}
interface DropNode {
  model?: Component;
  childrenDimensions?: DropBox[];
}
type DropRule = (determiner: DropDeterminer, node: DropNode, x: number, y: number) => DropPlace | undefined;

/** Regra de soltar de cada editor (o arraste só conhece o modelo do editor, `em`). */
const dropRules = new WeakMap<object, DropRule>();

/**
 * Arrastando o cabeçalho de loja no canvas com o mouse sobre um elemento de
 * cima (dentro dele o cabeçalho não entra: o GrapesJS sobe até a página), a
 * linha fica no topo desse elemento e o cabeçalho entra antes dele — o mesmo
 * lugar de quando é colado. Entre dois elementos (ou abaixo de tudo) e nas
 * Camadas, vale a conta do GrapesJS.
 *
 * O cálculo é do GrapesJS (DropLocationDeterminer, sem API pública): o ajuste
 * vai no protótipo dele, alcançado pelo sorter que abre o arraste.
 */
function headerDropPosition(editor: Editor) {
  dropRules.set(editor.getModel(), (determiner, node, x, y) => {
    if (!draggingHeader.has(editor) || determiner.containerContext?.document !== editor.Canvas.getDocument()) return;
    if (!node.model?.is?.("wrapper")) return;
    const boxes = node.childrenDimensions ?? [];
    const i = boxes.findIndex((b) => x >= b.left && x < b.left + b.width && y >= b.top && y < b.top + b.height);
    const over = boxes[i];
    if (!over) return;
    return { index: over.indexEl ?? i, placement: "before", placeholderDimensions: over.clone() };
  });
  const Sorter = (editor.Utils as unknown as { ComponentSorter?: Patchable }).ComponentSorter;
  patchOnce(Sorter, "os-store-header-drop", (proto) => {
    const startSort = proto.startSort as (...args: unknown[]) => unknown;
    proto.startSort = function (this: { dropLocationDeterminer?: { constructor: unknown } }, ...args: unknown[]) {
      patchOnce(this.dropLocationDeterminer?.constructor as Patchable | undefined, "os-store-header-drop", (det) => {
        const original = det.getDropPosition as DropDeterminer["getDropPosition"];
        det.getDropPosition = function (this: DropDeterminer, node: DropNode, x: number, y: number) {
          // Primeiro a conta do GrapesJS: ela mede os filhos do alvo (childrenDimensions).
          const place = original.call(this, node, x, y);
          return dropRules.get(this.em)?.(this, node, x, y) ?? place;
        };
      });
      return startSort.apply(this, args);
    };
  });
}

/** "Contagem no topo (barra)" e cabeçalho de loja: barras que ficam no topo da página. */
function isTopBar(c: Component): boolean {
  return isHeader(c) || (attr(c, "data-os-widget") === "countdown" && attr(c, "data-os-cd-style") === "bar");
}

/** Elementos que não aparecem na página (scripts, estilos, metas, textos em branco). */
const INERT_TAGS = new Set([
  "script",
  "style",
  "link",
  "meta",
  "template",
  "noscript",
  "os-script",
  "os-noscript",
  "os-meta",
]);
function inert(c: Component): boolean {
  if (c.is("textnode")) return !String(c.get("content") ?? "").trim();
  return c.is("comment") || INERT_TAGS.has(String(c.get("tagName") ?? "").toLowerCase());
}

/**
 * Posição do topo da página para um cabeçalho de loja novo: logo depois das
 * barras de topo que já estão lá ("Contagem no topo (barra)", outro
 * cabeçalho), pulando o que não aparece (scripts do começo do <body>).
 */
export function topInsertIndex(wrapper: Component): number {
  const kids = wrapper.components().models;
  let at = 0;
  for (let i = 0; i < kids.length; i++) {
    if (isTopBar(kids[i])) at = i + 1;
    else if (!inert(kids[i])) break;
  }
  return at;
}
