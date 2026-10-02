/**
 * Tipos de componente do Offer Studio no GrapesJS.
 *
 * - os-script: scripts originais, inertes e invisíveis no editor (voltam a ser
 *   <script> ao salvar). Nunca executam no painel.
 * - os-embed: <iframe> (YouTube, Vimeo, Panda…) aparece como um marcador no
 *   editor e sai intacto no HTML final.
 * - os-vturb: player VTurb (<vturb-smartplayer>), também como marcador.
 * - os-video: <video> nativo preservando muted/autoplay/playsinline (o tipo
 *   padrão do GrapesJS perde "muted" e força "controls", quebrando VSLs).
 * - Imagens ganham "Trocar imagem" (Configurações e barra do elemento).
 * - Links e botões ganham configurações de "Link da oferta", "Página do funil"
 *   e "Aparece depois de (s)" (delay de VSL).
 *
 * Segurança: o HTML das páginas vem de sites de terceiros. Nada dele pode rodar
 * no painel — nem pelos recursos de "script de componente" do GrapesJS
 * (atributos data-gjs-*, tipo "script", propriedade script), que o Offer Studio
 * não usa: ficam desligados aqui.
 */
import type { Component, Editor, Trait } from "grapesjs";
import { esc } from "@/editor/blocks/shared";
import { pinnedId } from "@/lib/css-keep";
import { CCID_ATTR, cssAttrValue, DUP_ID_ATTR, EID_ATTR, NOT_DUP } from "@/lib/dup-ids";
import { RULE_EVENTS, TRACKING_EVENT_LABEL } from "@/lib/tracking/schema";
import { withScheme } from "@/runtime/widgets/options";
import { editorTimeout, isEditorClosed, watchEditor } from "./lifecycle";
import { NEW_LINK_OPTION, newLinkOption } from "./new-link";
import { originalUsesId } from "./original-css";

export interface EditorLinkOption {
  key: string;
  label: string;
  /** Endereço atual do link (mostrado em "Vai para"). */
  url?: string;
}
export interface EditorPageOption {
  id: string;
  name: string;
}

const PLACEHOLDER_STYLE =
  "display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;min-height:180px;width:100%;" +
  "aspect-ratio:16/9;max-height:520px;background:repeating-linear-gradient(45deg,#eef0f5,#eef0f5 12px,#e3e7ef 12px,#e3e7ef 24px);" +
  "border:2px dashed #8b93a7;border-radius:10px;color:#3b4254;font:600 14px/1.3 system-ui,sans-serif;text-align:center;padding:16px;box-sizing:border-box;";

function embedLabel(src: string) {
  if (/youtube|youtu\.be/i.test(src)) return "Vídeo do YouTube";
  if (/vimeo/i.test(src)) return "Vídeo do Vimeo";
  if (/pandavideo/i.test(src)) return "Vídeo Panda";
  if (/converteai|vturb/i.test(src)) return "Vídeo VTurb";
  if (/google\.com\/maps/i.test(src)) return "Mapa";
  return "Conteúdo incorporado";
}

function placeholderHtml(title: string, detail: string) {
  return `<div style="font-size:28px">▶</div><div>${esc(title)}</div><div style="font-weight:400;font-size:12px;opacity:.75;word-break:break-all">${esc(detail)}</div><div style="font-weight:400;font-size:11px;opacity:.6">Aparece de verdade na prévia</div>`;
}

// ─── Segurança: sem scripts de componente do GrapesJS ────────────────────────

const GJS_ATTR = /^data-gjs-/i;

interface ParsedNode {
  attributes?: Record<string, unknown>;
  childNodes?: ParsedNode[];
  __domNode?: unknown;
}

/**
 * Remove os atributos data-gjs-* (o GrapesJS os lê como propriedades do
 * componente: tipo "script", código, atributos…) de todo HTML que o editor
 * analisa — página importada, colada, código do elemento, blocos.
 */
export function stripGjsAttributes(node: ParsedNode | undefined | null) {
  if (!node) return;
  const attrs = node.attributes;
  if (attrs) {
    for (const name of Object.keys(attrs)) {
      if (!GJS_ATTR.test(name)) continue;
      delete attrs[name];
      const dom = node.__domNode as { removeAttribute?: (n: string) => void } | undefined;
      dom?.removeAttribute?.(name);
    }
  }
  for (const child of node.childNodes ?? []) stripGjsAttributes(child);
}

const PATCHED = Symbol.for("offerstudio.gjs-patched");

export interface Patchable {
  prototype: Record<string | symbol, unknown>;
}

/**
 * Aplica uma vez (por protótipo) um ajuste global do GrapesJS. O protótipo é
 * de todos os editores da janela: o ajuste não pode guardar um editor (use
 * `this.em` do componente).
 */
export function patchOnce(target: Patchable | undefined, key: string, patch: (proto: Record<string, unknown>) => void) {
  const proto = target?.prototype;
  if (!proto) return;
  const done = (proto[PATCHED] as Set<string> | undefined) ?? new Set<string>();
  if (done.has(key)) return;
  patch(proto as Record<string, unknown>);
  done.add(key);
  proto[PATCHED] = done;
}

/** <meta> inerte no canvas (http-equiv: refresh, CSP…); no modelo e no HTML salvo continua <meta>. */
const OS_META_TAG = "os-meta";

/** O elemento tem http-equiv (refresh, CSP, cookies…)? São os únicos <meta> que agem no documento. */
function hasHttpEquiv(attributes: Record<string, unknown> | undefined) {
  return Object.keys(attributes ?? {}).some((name) => name.toLowerCase() === "http-equiv");
}

function disableComponentScripts(editor: Editor) {
  const dc = editor.DomComponents as unknown as { ComponentView?: Patchable };

  // Página importada, colada ou editada no código: sem data-gjs-*.
  editor.on("parse:html:root", ({ root }: { root?: ParsedNode }) => stripGjsAttributes(root));

  patchOnce(dc.ComponentView, "no-scripts", (proto) => {
    // Propriedade "script" (de projetos antigos): nunca vira <script> no canvas.
    proto.updateScript = () => undefined;
    // Nenhum elemento <script> é criado no canvas, qualquer que seja o tipo. Nem
    // <meta http-equiv>: um refresh no <body> da página (clonada, importada,
    // colada, projeto antigo) levaria o canvas do painel para outro site. No
    // canvas ele é um <os-meta> inerte; o HTML salvo continua <meta>. Os outros
    // <meta> (color-scheme do <head>, microdados itemprop) ficam de verdade: o
    // canvas mostra a página como ela é.
    const tagName = proto.tagName as (this: { model: Component }) => string;
    proto.tagName = function (this: { model: Component }) {
      const tag = String(tagName.call(this) ?? "");
      const lower = tag.toLowerCase();
      if (lower === "script") return "os-script";
      if (lower === "meta" && hasHttpEquiv(this.model?.get("attributes") as Record<string, unknown>)) {
        return OS_META_TAG;
      }
      return tag;
    };
  });

  // Relendo o HTML do canvas (o GrapesJS faz isso ao fechar a edição de um
  // texto que tem um <meta http-equiv> dentro): o <os-meta> desenhado no canvas
  // volta a ser <meta> (continua inerte no canvas pela troca acima).
  editor.DomComponents.addType(OS_META_TAG, {
    isComponent: (el) => ((el as HTMLElement).tagName === "OS-META" ? { tagName: "meta" } : false),
  });

  // Tipo "script" do GrapesJS: inerte no canvas e fora do HTML salvo.
  editor.DomComponents.addType("script", {
    isComponent: () => false,
    model: {
      defaults: { tagName: "os-script", selectable: false, hoverable: false, layerable: false, copyable: false },
      toHTML: () => "",
    },
    view: {
      tagName: () => "os-script",
    },
  });
}

// ─── Ids repetidos da página ─────────────────────────────────────────────────
// Os repetidos (2º em diante) chegam com o id em data-os-dup-id (o GrapesJS não
// aceita dois elementos com o mesmo id). No canvas eles mostram o id original
// (o CSS da página — #comprar{…} — vale neles, como no site) e as regras do
// editor usam os mesmos seletores que a página final (finalizeFromEditor):
// - regra própria de um repetido (#iabc) → #comprar[data-os-eid="iabc"];
// - regra do primeiro elemento (#comprar) → #comprar:not([data-os-dup-id]),
//   para a edição dele não mudar os outros;
// - regra que mantém o valor do celular (:is(#iabc), :is(#comprar),
//   css-keep.ts) → o mesmo, por dentro do :is().

interface DupView {
  model: Component;
  el?: HTMLElement;
}

export interface RuleLike {
  get(key: string): unknown;
  getSelectors(): { length: number; at(i: number): { get(k: string): unknown; isId?(): boolean } | undefined };
  selectorsToString(opts?: { skipState?: boolean; skipAdd?: boolean }): string;
  views?: { render(): unknown; el?: Element }[];
}

function dupIdOf(component: Component | null | undefined): string {
  const value = (component?.get("attributes") as Record<string, unknown> | undefined)?.[DUP_ID_ATTR];
  return typeof value === "string" ? value : "";
}

/** Marca do repetido nas regras dele: a que já veio na página ou o id do editor. */
function eidOf(component: Component): string {
  const own = (component.get("attributes") as Record<string, unknown> | undefined)?.[EID_ATTR];
  return typeof own === "string" && own ? own : component.getId();
}

function cssEscape(value: string) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value;
}

/** Nome do id de uma regra de um id só (`#x`, `#x:hover`), ou "". */
function idRuleName(rule: RuleLike): string {
  const selectors = rule.getSelectors();
  if (selectors.length !== 1) return "";
  const sel = selectors.at(0);
  return sel?.isId?.() ? String(sel.get("name") ?? "") : "";
}

/** Id da regra que mantém o valor do celular (`:is(#x)`, sem estado), ou "". */
function pinRuleName(rule: RuleLike): string {
  if (rule.getSelectors().length || rule.get("state")) return "";
  return pinnedId(String(rule.get("selectorsAdd") ?? "")) ?? "";
}

/** Id do elemento de uma regra de id ou de uma regra fixa, ou "". */
function ruleIdName(rule: RuleLike): string {
  return idRuleName(rule) || pinRuleName(rule);
}

/** Os seletores do canvas para ids repetidos mudaram (regras redesenhadas). */
export const CANVAS_IDS_EVENT = "os:canvas-ids";

/** Troca de seletor que o canvas faz numa regra (ids repetidos), por editor. */
interface CanvasSwap {
  /** Seletor da regra como está no texto CSS dela. */
  from: string;
  /** Seletor que o canvas (e a página final) usa. */
  to: string;
}
const canvasSwaps = new WeakMap<Editor, (rule: RuleLike) => CanvasSwap | null>();

/**
 * Texto CSS de uma regra do editor como o canvas deve desenhá-lo (ids
 * repetidos: mesmos seletores da página final). `css` é o texto da regra
 * (toCSS) ou um trecho que começa pelo seletor dela.
 */
export function toCanvasCss(editor: Editor, rule: RuleLike, css: string): string {
  const swap = canvasSwaps.get(editor)?.(rule);
  if (!swap) return css;
  const at = css.indexOf(`${swap.from}{`);
  if (at < 0) return css;
  return `${css.slice(0, at)}${swap.to}${css.slice(at + swap.from.length)}`;
}

/**
 * Relendo o HTML do canvas (o GrapesJS faz isso ao fechar a edição de um texto):
 * o repetido volta com o id do editor (data-os-ccid), para o GrapesJS reusar o
 * mesmo componente — com o estilo e as marcas dele — em vez de criar outro a
 * partir do id original (que é do primeiro elemento).
 */
function restoreCanvasIds(node: ParsedNode | undefined | null) {
  if (!node) return;
  const attrs = node.attributes;
  if (attrs && CCID_ATTR in attrs) {
    const ccid = attrs[CCID_ATTR];
    const dom = node.__domNode as
      | { removeAttribute?: (n: string) => void; setAttribute?: (n: string, v: string) => void }
      | undefined;
    delete attrs[CCID_ATTR];
    dom?.removeAttribute?.(CCID_ATTR);
    const dup = attrs[DUP_ID_ATTR];
    if (typeof ccid === "string" && ccid && typeof dup === "string" && dup) {
      attrs.id = ccid;
      dom?.setAttribute?.("id", ccid);
      // Marcas que o canvas desenha (não são do elemento): fora. Uma data-os-eid
      // própria (diferente do id do editor) é do elemento e fica.
      const drawn = attrs[EID_ATTR] === ccid ? ["draggable", EID_ATTR] : ["draggable"];
      for (const name of drawn) {
        delete attrs[name];
        dom?.removeAttribute?.(name);
      }
    }
  }
  for (const child of node.childNodes ?? []) restoreCanvasIds(child);
}

function installDuplicateIds(editor: Editor) {
  watchEditor(editor);
  const dc = editor.DomComponents as unknown as { ComponentView?: Patchable; Component?: Patchable };

  patchOnce(dc.ComponentView, "dup-ids", (proto) => {
    const updateAttributes = proto.updateAttributes as (this: DupView, ...args: unknown[]) => void;
    proto.updateAttributes = function (this: DupView, ...args: unknown[]) {
      updateAttributes.apply(this, args);
      const dup = dupIdOf(this.model);
      if (!dup || !this.el?.setAttribute) return;
      this.el.setAttribute("id", dup);
      this.el.setAttribute(EID_ATTR, eidOf(this.model));
      this.el.setAttribute(CCID_ATTR, this.model.getId());
    };
  });

  editor.on("parse:html:root", ({ root }: { root?: ParsedNode }) => restoreCanvasIds(root));

  // Duplicar (e copiar/colar) um elemento com um id da página: o GrapesJS dá à
  // cópia o id "<id>-2", e ela perderia o CSS #id da página (padding, cores do
  // botão…). Quando o CSS original mira esse id, a cópia vira um repetido dele,
  // como os repetidos que vêm na página: o canvas e a página final mostram o id
  // original nela, e as edições feitas na cópia continuam só dela.
  // A marca data-os-eid que já veio na página (página do Offer Studio importada
  // de novo) é do elemento, não da cópia: com a mesma marca, as regras da cópia
  // (#comprar[data-os-eid="…"]) mudariam o original também. A cópia usa o id
  // dela no editor como marca (eidOf).
  patchOnce(dc.Component, "dup-ids-clone", (proto) => {
    const clone = proto.clone as (this: Component, ...args: unknown[]) => Component;
    proto.clone = function (this: Component, ...args: unknown[]) {
      const cloned = clone.apply(this, args);
      const copied = cloned?.get("attributes") as Record<string, unknown> | undefined;
      if (copied && EID_ATTR in copied) {
        const { [EID_ATTR]: _shared, ...rest } = copied;
        cloned.set("attributes", rest, { silent: true } as never);
      }
      const id = (this.get("attributes") as Record<string, unknown> | undefined)?.id;
      if (typeof id !== "string" || !id || dupIdOf(this) || !cloned || cloned.getId() === id) return cloned;
      const doc = (
        this as unknown as { em?: { Canvas?: { getDocument?(): Document | null } } }
      ).em?.Canvas?.getDocument?.();
      if (doc && originalUsesId(doc, id)) cloned.addAttributes({ [DUP_ID_ATTR]: id }, { silent: true } as never);
      return cloned;
    };
  });

  // Id digitado pelo usuário num repetido (Configurações): ele passa a ser o id
  // de verdade (sem isso o salvar poria o id repetido de volta).
  patchOnce(dc.Component, "dup-ids-typed", (proto) => {
    const idUpdated = proto._idUpdated as (this: Component, ...args: unknown[]) => void;
    proto._idUpdated = function (this: Component, ...args: unknown[]) {
      const self = this as unknown as { ccid: string };
      const before = self.ccid;
      idUpdated.apply(this, args);
      const opts = (args[2] ?? {}) as { idUpdate?: boolean };
      if (opts.idUpdate) return;
      const id = (this.get("attributes") as Record<string, unknown> | undefined)?.id;
      const dup = dupIdOf(this);
      // Aceito (o GrapesJS recusa um id que já existe e volta ao anterior).
      if (dup && typeof id === "string" && id && id !== dup && self.ccid === id && before !== id) {
        this.removeAttributes([DUP_ID_ATTR, EID_ATTR]);
      }
    };
  });

  /** Ids que têm repetidos agora (e o repetido dono de cada id do editor). */
  let dupIds = new Set<string>();
  let owners = new Map<string, string>();
  const collect = () => {
    const ids = new Set<string>();
    const own = new Map<string, string>();
    const walk = (c: Component) => {
      const dup = dupIdOf(c);
      if (dup) {
        ids.add(dup);
        own.set(c.getId(), `${dup}|${eidOf(c)}`);
      }
      for (const child of c.components().models) walk(child);
    };
    const wrapper = isEditorClosed(editor) ? undefined : editor.getWrapper();
    if (wrapper) walk(wrapper);
    return { ids, own };
  };
  let stale = true;
  const current = () => {
    if (stale) {
      ({ ids: dupIds, own: owners } = collect());
      stale = false;
    }
    return dupIds;
  };

  /** Seletor do canvas para o elemento de id `name` (id próprio ou original), ou null se fica igual. */
  const canvasId = (name: string, rule: RuleLike): string | null => {
    const component = editor.Components.getById(name) as Component | null;
    const dup = dupIdOf(component);
    if (component && dup) return `#${cssEscape(dup)}[${EID_ATTR}=${cssAttrValue(eidOf(component))}]`;
    if (!current().has(name) || String(rule.get("state") ?? "").includes(NOT_DUP.slice(1))) return null;
    return `#${cssEscape(name)}${NOT_DUP}`;
  };

  const canvasSwap = (rule: RuleLike): CanvasSwap | null => {
    const idName = idRuleName(rule);
    if (idName) {
      const to = canvasId(idName, rule);
      if (!to) return null;
      const from = rule.selectorsToString();
      const idPart = rule.selectorsToString({ skipState: true, skipAdd: true });
      if (!from.startsWith(idPart)) return null;
      return { from, to: `${to}${from.slice(idPart.length)}` };
    }
    const pinName = pinRuleName(rule);
    const to = pinName ? canvasId(pinName, rule) : null;
    return to ? { from: String(rule.get("selectorsAdd")), to: `:is(${to})` } : null;
  };

  canvasSwaps.set(editor, canvasSwap);
  editor.on("css:mount:before", (props: { rule: RuleLike; css: string }) => {
    if (props.rule) props.css = toCanvasCss(editor, props.rule, props.css);
  });

  // Repetidos criados, apagados ou mudados: as regras dos ids afetados são redesenhadas.
  let drawn = { ids: new Set<string>(), own: new Map<string, string>() };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const recheck = () => {
    timer = undefined;
    stale = true;
    const now = { ids: current(), own: owners };
    const names = new Set<string>();
    for (const id of drawn.ids) if (!now.ids.has(id)) names.add(id);
    for (const id of now.ids) if (!drawn.ids.has(id)) names.add(id);
    for (const [ccid, key] of drawn.own) if (now.own.get(ccid) !== key) names.add(ccid);
    for (const [ccid, key] of now.own) if (drawn.own.get(ccid) !== key) names.add(ccid);
    drawn = now;
    if (!names.size) return;
    for (const rule of editor.Css.getAll().models as unknown as RuleLike[]) {
      if (names.has(ruleIdName(rule))) for (const view of rule.views ?? []) view.render();
    }
    // A cópia !important do canvas (style-cascade.ts) usa os mesmos seletores.
    editor.trigger(CANVAS_IDS_EVENT);
  };
  const schedule = () => {
    stale = true;
    if (!timer) timer = editorTimeout(editor, recheck);
  };
  editor.on(
    "load canvas:frame:load:body component:add component:remove component:update:attributes component:mount",
    schedule,
  );
  editor.on("destroy", () => timer && clearTimeout(timer));
}

// ─── Nomes nas camadas e na etiqueta do canvas ───────────────────────────────

const NAMED_BY_HEADING = new Set(["section", "header", "footer", "article", "main", "aside", "nav"]);
/** Caixas que fazem papel de seção em páginas clonadas (Elementor, construtores). */
const SECTION_LIKE_CLASS = /(?:^|[\s_-])(?:section|e-parent|e-con-full|e-con-boxed)(?:$|[\s_-])/i;
const MAX_HEADING_IN_NAME = 40;

function isSectionLike(component: Component) {
  const tag = String(component.get("tagName") ?? "").toLowerCase();
  if (NAMED_BY_HEADING.has(tag)) return true;
  if (tag !== "div") return false;
  const className = component.getEl()?.getAttribute?.("class") ?? "";
  return SECTION_LIKE_CLASS.test(className);
}

/** Texto do primeiro título (h1–h3) dentro do componente, curto e sem marcação. */
export function headingHint(component: Component): string {
  const heading = component.getEl()?.querySelector?.("h1, h2, h3");
  if (!heading) return "";
  const raw = heading.textContent ?? "";
  // O nome vai para innerHTML (camadas, etiqueta): sem caracteres de marcação.
  const text = raw
    .replace(/[<>&"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > MAX_HEADING_IN_NAME ? `${text.slice(0, MAX_HEADING_IN_NAME - 1).trimEnd()}…` : text;
}

function nameSectionsByHeading(editor: Editor) {
  const dc = editor.DomComponents as unknown as { Component?: Patchable };
  patchOnce(dc.Component, "heading-names", (proto) => {
    const getName = proto.getName as (this: Component, opts?: { noCustom?: boolean }) => string;
    proto.getName = function (this: Component, opts: { noCustom?: boolean } = {}) {
      const base = getName.call(this, opts);
      // Nome dado pelo usuário (ou pelo bloco) vence.
      if ((!opts.noCustom && this.get("custom-name")) || this.get("name")) return base;
      if (!isSectionLike(this)) return base;
      const hint = headingHint(this);
      return hint ? `${base} · ${hint}` : base;
    };
  });
}

// ─── Barra do elemento selecionado (títulos em português) ────────────────────

const TOOLBAR_LABELS: Record<string, string> = {
  "select-parent": "Selecionar o bloco de fora",
  "tlb-move": "Arrastar para mover",
  "tlb-clone": "Duplicar",
  "tlb-delete": "Excluir (Delete)",
  "os-swap-image": "Trocar imagem",
};

const SWAP_IMAGE_ICON =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>';

interface ToolbarItem {
  id?: string;
  command?: unknown;
  label?: string;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Abre a galeria para trocar a imagem (mesmo caminho do duplo clique). */
function swapImage(component: Component | null | undefined) {
  component?.trigger("active");
}

function toolbarKey(item: ToolbarItem, arrowUp: string) {
  if (typeof item.command === "string") return item.command;
  if (item.id) return item.id;
  if (item.label && item.label === arrowUp) return "select-parent";
  return "";
}

function labelToolbar(editor: Editor) {
  const dc = editor.DomComponents as unknown as { Component?: Patchable };
  patchOnce(dc.Component, "toolbar-labels", (proto) => {
    const initToolbar = proto.initToolbar as (this: Component) => void;
    proto.initToolbar = function (this: Component) {
      initToolbar.call(this);
      const current = this.get("toolbar") as ToolbarItem[] | undefined;
      if (!Array.isArray(current) || !current.length) return;
      const em = (this as unknown as { em?: { getIcon?: (n: string) => string } }).em;
      const arrowUp = em?.getIcon?.("arrowUp") ?? "";
      let items = current;
      if (this.is("image") && this.get("editable") !== false && !items.some((i) => i.id === "os-swap-image")) {
        const swap: ToolbarItem = {
          id: "os-swap-image",
          label: SWAP_IMAGE_ICON,
          command: (ed: Editor) => swapImage(ed.getSelected()),
        };
        // Depois de "selecionar o bloco de fora" (se houver).
        const at = items.findIndex((i) => toolbarKey(i, arrowUp) === "select-parent") + 1;
        items = [...items.slice(0, at), swap, ...items.slice(at)];
      }
      let changed = items !== current;
      const labeled = items.map((item) => {
        const text = TOOLBAR_LABELS[toolbarKey(item, arrowUp)];
        if (!text || (item.attributes?.title && item.attributes["aria-label"])) return item;
        changed = true;
        return { ...item, attributes: { ...item.attributes, title: text, "aria-label": text } };
      });
      if (changed) this.set("toolbar", labeled as never, { silent: true });
    };
  });
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

export function registerComponentTypes(editor: Editor) {
  const dc = editor.DomComponents;

  disableComponentScripts(editor);
  installDuplicateIds(editor);
  nameSectionsByHeading(editor);
  labelToolbar(editor);
  registerInfoTrait(editor);

  dc.addType("os-script", {
    isComponent: (el) => (el as HTMLElement).tagName === "OS-SCRIPT",
    model: {
      defaults: {
        tagName: "os-script",
        name: "Script original",
        draggable: false,
        droppable: false,
        selectable: false,
        hoverable: false,
        highlightable: false,
        copyable: false,
        editable: false,
        layerable: false,
        attributes: { hidden: "" },
      },
    },
  });

  // <noscript> da página (conteúdo guardado como texto): inerte, invisível e
  // fora das camadas, como os scripts. Volta a ser <noscript> ao salvar.
  dc.addType("os-noscript", {
    isComponent: (el) => (el as HTMLElement).tagName === "OS-NOSCRIPT",
    model: {
      defaults: {
        tagName: "os-noscript",
        name: "Conteúdo sem JavaScript",
        draggable: false,
        droppable: false,
        selectable: false,
        hoverable: false,
        highlightable: false,
        copyable: false,
        editable: false,
        layerable: false,
        attributes: { hidden: "" },
      },
    },
  });

  // Imagem: "Trocar imagem" à vista (antes só havia o duplo clique).
  dc.addType("image", {
    model: {
      defaults: {
        traits: [
          {
            type: "button",
            name: "os-swap-image",
            text: "Trocar imagem",
            full: true,
            command: (_ed: Editor, trait: Trait) => swapImage(trait.target as Component),
          },
          "alt",
        ],
      },
    },
  });

  // Link comum (os botões de páginas clonadas são <a>): o endereço digitado em
  // "Endereço do link" ganha o https:// quando falta.
  dc.addType("link", {
    model: { defaults: { traits: ["title", addressTrait("href"), "target"] } },
  });

  dc.addType("os-embed", {
    isComponent: (el) => (el as HTMLElement).tagName === "IFRAME",
    model: {
      defaults: {
        tagName: "iframe",
        name: "Vídeo / incorporação",
        droppable: false,
        traits: [{ type: "text", name: "src", label: "Endereço do vídeo" }],
      },
    },
    view: {
      // No editor, um marcador no lugar do iframe (o HTML final continua com o iframe).
      tagName() {
        return "div";
      },
      onRender({ el, model }: { el: HTMLElement; model: Component }) {
        const src = String(model.getAttributes().src ?? "");
        el.setAttribute("style", PLACEHOLDER_STYLE);
        el.innerHTML = placeholderHtml(embedLabel(src), src);
      },
    },
  });

  dc.addType("os-vturb", {
    isComponent: (el) => (el as HTMLElement).tagName === "VTURB-SMARTPLAYER",
    model: {
      defaults: {
        name: "Vídeo VTurb",
        droppable: false,
        // id próprio do campo: a tradução de "id" ("Âncora…", i18n.ts) venceria o rótulo.
        traits: [{ type: "text", id: "os-vturb-player-id", name: "id", label: "ID do player" }],
      },
    },
    view: {
      onRender({ el, model }: { el: HTMLElement; model: Component }) {
        el.setAttribute("style", PLACEHOLDER_STYLE);
        el.innerHTML = placeholderHtml("Vídeo VTurb", String(model.getAttributes().id ?? ""));
      },
    },
  });

  dc.addType("os-video", {
    isComponent: (el) => (el as HTMLElement).tagName === "VIDEO",
    model: {
      defaults: {
        tagName: "video",
        name: "Vídeo",
        traits: [
          { type: "checkbox", name: "autoplay", label: "Tocar sozinho" },
          { type: "checkbox", name: "muted", label: "Sem som" },
          { type: "checkbox", name: "loop", label: "Repetir" },
          { type: "checkbox", name: "controls", label: "Mostrar controles" },
          { type: "checkbox", name: "playsinline", label: "Tocar na página (celular)" },
        ],
      },
    },
    view: {
      onRender({ el }: { el: HTMLElement }) {
        // No editor o vídeo não toca sozinho (os atributos continuam no HTML final).
        const video = el as HTMLVideoElement;
        video.autoplay = false;
        video.pause?.();
      },
    },
  });
}

// ─── Configurações dinâmicas (links e páginas) ───────────────────────────────

/** Linha só de leitura em Configurações ("Vai para: …"). Texto em `text`, `hint` opcional. */
function registerInfoTrait(editor: Editor) {
  editor.Traits.addType("os-info", {
    createInput({ trait }: { trait: Trait }) {
      const box = document.createElement("div");
      box.className = "os-trait-info";
      const main = document.createElement("div");
      main.className = "os-trait-info__text";
      main.textContent = String(trait.get("text") ?? "");
      box.appendChild(main);
      const hint = String((trait.attributes as Record<string, unknown>).hint ?? "");
      if (hint) {
        const small = document.createElement("div");
        small.className = "os-trait-info__hint";
        small.textContent = hint;
        box.appendChild(small);
      }
      return box;
    },
    onUpdate() {
      // Só leitura: o texto é refeito recriando a linha.
    },
  });
}

const PAGE_PREFIX = "os-page:";
const DEST_TRAIT = "os-destino";

/** Campos de endereço: o do link (<a>) e o "Endereço ao clicar" de botões que não são <a>. */
const ADDRESS_TRAITS = ["href", "data-os-href"] as const;
type AddressTrait = (typeof ADDRESS_TRAITS)[number];

/** Definições dos campos de endereço tirados da lista (para voltarem iguais depois). */
const hiddenAddress = new WeakMap<Component, Map<AddressTrait, { def: Record<string, unknown>; at: number }>>();

function traitDef(trait: Trait): Record<string, unknown> {
  const { value: _value, target: _target, ...def } = trait.attributes as Record<string, unknown>;
  return def;
}

/**
 * Campo de endereço como o tipo do elemento o define (link: "Endereço do link";
 * botão: "Endereço (URL)"), com a posição dele na lista. Serve quando não há a
 * definição guardada: a cópia de Duplicar/colar vem sem o campo (a lista de
 * campos é copiada) e sem a definição (guardada só para o original).
 */
function typeAddressTrait(
  component: Component,
  name: AddressTrait,
): { def: Record<string, unknown>; at: number } | null {
  const defaults = (component as unknown as { defaults?: { traits?: unknown } }).defaults?.traits;
  if (!Array.isArray(defaults)) return null;
  const at = defaults.findIndex(
    (t) => t === name || (Boolean(t) && typeof t === "object" && (t as { name?: unknown }).name === name),
  );
  if (at < 0) return null;
  const def = defaults[at];
  return { def: typeof def === "string" ? { name: def } : (def as Record<string, unknown>), at };
}

/**
 * Endereço do link: quando o elemento está ligado a um link da oferta ou a uma
 * página do funil, o campo "Endereço" não vale (a prévia e o ZIP usam o link ou
 * a página). No lugar dele, uma linha só de leitura mostra para onde vai. Para
 * uma página do funil, o campo só sai quando há a lista "Página do funil" para
 * trocar o destino (oferta de uma página só, botão de WhatsApp: fica à vista,
 * com a linha acima dizendo para onde ele leva). Botões que não são <a> (com
 * data-os-href, do clonador): "Endereço ao clicar" também sai enquanto há um
 * link da oferta (o salvar põe o endereço do link nele).
 */
function syncDestination(
  component: Component,
  { links, pages }: { links: EditorLinkOption[]; pages: EditorPageOption[] },
) {
  const attrs = component.getAttributes();
  const key = String(attrs["data-os-link"] ?? "");
  // Opção "Criar link…": o valor volta sozinho em seguida; nada muda agora.
  if (key === NEW_LINK_OPTION) return;
  const href = String(attrs.href ?? "");
  const pageSelect = Boolean(component.getTrait("os-page"));
  let info: { text: string; hint: string } | null = null;
  if (key) {
    const link = links.find((l) => l.key === key);
    info = {
      text: link ? link.url?.trim() || "Este link ainda não tem endereço" : "Link da oferta excluído",
      hint: "O endereço dos links da oferta muda em “Links e checkouts”, no topo.",
    };
  } else if (href.startsWith(PAGE_PREFIX)) {
    const page = pages.find((p) => p.id === href.slice(PAGE_PREFIX.length));
    let hint: string;
    if (pageSelect) {
      hint = page
        ? "Para outro endereço, escolha “— nenhuma —” em Página do funil."
        : "Essa página foi excluída. Escolha outra em Página do funil, ou “— nenhuma —” para digitar um endereço.";
    } else {
      hint = page
        ? "Para ir a outro endereço, troque o “Endereço do link” abaixo."
        : "Essa página foi excluída: troque o “Endereço do link” abaixo.";
    }
    info = { text: page ? `Página do funil: ${page.name}` : "Página do funil excluída", hint };
  }
  // O campo de endereço sai só quando há outro jeito de trocar o destino ali.
  const hide: Record<AddressTrait, boolean> = {
    href: Boolean(info) && (Boolean(key) || pageSelect),
    "data-os-href": Boolean(key),
  };

  const existing = component.getTrait(DEST_TRAIT);
  const shown = existing?.attributes as Record<string, unknown> | undefined;
  const sameInfo = Boolean(info && shown && shown.text === info.text && shown.hint === info.hint);
  const saved = hiddenAddress.get(component) ?? new Map<AddressTrait, { def: Record<string, unknown>; at: number }>();
  // O campo que volta: o guardado ao sair ou, sem ele, o do tipo do elemento.
  const restorable = (name: AddressTrait) =>
    saved.get(name) ?? (name === "href" ? typeAddressTrait(component, name) : null);
  const settled = ADDRESS_TRAITS.every((name) =>
    hide[name] ? !component.getTrait(name) : Boolean(component.getTrait(name)) || !restorable(name),
  );
  if (settled && (sameInfo || (!info && !existing))) return;
  const destAt = existing ? component.getTraitIndex(DEST_TRAIT) : -1;
  if (existing) component.removeTrait(DEST_TRAIT);

  // Onde a linha "Vai para" entra: no lugar do primeiro campo de endereço.
  let at = -1;
  const hiddenNow: AddressTrait[] = [];
  for (const name of ADDRESS_TRAITS) {
    const trait = component.getTrait(name);
    const index = trait ? component.getTraitIndex(name) : (saved.get(name)?.at ?? -1);
    if (hide[name] && trait) {
      saved.set(name, { def: traitDef(trait), at: index });
      component.removeTrait(name);
      hiddenNow.push(name);
    }
    if (index >= 0 && at < 0) at = index;
  }
  // Voltam na ordem inversa da saída (cada um no lugar de antes; o do tipo, no
  // lugar da linha "Vai para").
  for (const name of [...ADDRESS_TRAITS].reverse()) {
    if (hide[name] || component.getTrait(name) || hiddenNow.includes(name)) continue;
    const prev = saved.get(name);
    const back = prev ?? restorable(name);
    if (!back) continue;
    component.addTrait(back.def as never, { at: prev || destAt < 0 ? back.at : destAt });
    saved.delete(name);
  }
  if (saved.size) hiddenAddress.set(component, saved);
  else hiddenAddress.delete(component);
  if (!info) return;
  if (at < 0) at = Math.max(0, component.getTraitIndex("data-os-link"));
  component.addTrait(
    {
      type: "os-info",
      name: DEST_TRAIT,
      label: "Vai para",
      text: info.text,
      hint: info.hint,
      changeProp: true,
    } as never,
    { at },
  );
}

/**
 * Endereço digitado em Configurações (link, botão): "meusite.com.br/obrigado"
 * ganha o https:// — sem ele o navegador o leria como um caminho desta página
 * (404 na página publicada). Caminhos, âncoras e nomes de arquivo ficam iguais.
 */
function addressTrait(name: AddressTrait, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "text",
    name,
    ...extra,
    setValue: ({ component, value }: { component: Component; value: unknown }) =>
      component.addAttributes({ [name]: withScheme(String(value ?? "")) }),
  };
}

/** "Evento ao clicar": o script de rastreamento das páginas dispara este evento no clique. */
export const CLICK_EVENT_ATTR = "data-os-event";

/** Atributos que fazem um elemento ser clicável (além de <a>/<button>). */
const CLICKABLE_ATTRS = [
  "data-os-href",
  "data-os-link",
  "data-os-checkout",
  CLICK_EVENT_ATTR,
  "data-os-on-click",
  "onclick",
] as const;

/** Link, botão ou qualquer elemento que responde ao clique (role="button", onclick do clone…). */
export function isClickableElement(tagName: string, attrs: Record<string, unknown>): boolean {
  const tag = tagName.toLowerCase();
  if (tag === "a" || tag === "button") return true;
  if (tag === "input") return /^(submit|button|image)$/i.test(String(attrs.type ?? ""));
  if (String(attrs.role ?? "").toLowerCase() === "button") return true;
  return CLICKABLE_ATTRS.some((name) => name in attrs);
}

/**
 * Lista "Evento ao clicar" (— nenhum — + eventos de regra; o PageView dispara
 * sozinho). Escolher grava data-os-event="LEAD" (etc.); "— nenhum —" tira o
 * atributo. Um valor desconhecido (colado no código) aparece como opção para
 * não sumir sem querer.
 */
function clickEventTrait(current: string): Record<string, unknown> {
  const options: { id: string; label: string }[] = [
    { id: "", label: "— nenhum —" },
    ...RULE_EVENTS.map((event) => ({ id: event, label: esc(TRACKING_EVENT_LABEL[event]) })),
  ];
  if (current && !options.some((o) => o.id === current)) options.push({ id: current, label: esc(`Outro: ${current}`) });
  return {
    type: "select",
    name: CLICK_EVENT_ATTR,
    label: "Evento ao clicar",
    options,
    setValue: ({ component, value }: { component: Component; value: unknown }) => {
      const event = String(value ?? "").trim();
      if (event) component.addAttributes({ [CLICK_EVENT_ATTR]: event });
      else component.removeAttributes(CLICK_EVENT_ATTR);
    },
  };
}

/**
 * Configurações extras conforme o elemento selecionado: link da oferta, página
 * do funil, destino de botões com data-os-href, evento ao clicar e delay de VSL.
 *
 * Os nomes de páginas (vêm do <title> de sites clonados) e de links entram
 * escapados: o GrapesJS monta as opções com innerHTML no painel.
 */
export function registerDynamicTraits(
  editor: Editor,
  getOptions: () => { links: EditorLinkOption[]; pages: EditorPageOption[] },
) {
  // Sincronizando a lista "Página do funil" com o href (não é uma edição).
  let syncingPage = false;

  editor.on("component:selected", (component: Component) => {
    const attrs = component.getAttributes();
    const { links, pages } = getOptions();
    const isAnchor = component.get("tagName") === "a";
    const hasHref = "data-os-href" in attrs;
    const wanted: Record<string, unknown>[] = [];

    if (isAnchor || hasHref || "data-os-link" in attrs) {
      wanted.push({
        type: "select",
        name: "data-os-link",
        label: "Link da oferta",
        options: [
          { id: "", label: "— nenhum (usar o endereço) —" },
          ...links.map((l) => ({ id: l.key, label: esc(l.label) })),
          newLinkOption,
        ],
      });
    }
    // Botão de WhatsApp sempre abre o WhatsApp: não faz sentido apontar para uma página do funil.
    if (isAnchor && pages.length > 1 && component.get("type") !== "os-whatsapp") {
      const href = String(attrs.href ?? "");
      const current = href.startsWith(PAGE_PREFIX) ? href.slice(PAGE_PREFIX.length) : "";
      const options = [{ id: "", label: "— nenhuma —" }, ...pages.map((p) => ({ id: p.id, label: esc(p.name) }))];
      // Página excluída: aparece como opção (assim "— nenhuma —" ou outra página é uma troca de verdade).
      if (current && !pages.some((p) => p.id === current)) options.push({ id: current, label: "(página excluída)" });
      wanted.push({ type: "select", name: "os-page", label: "Página do funil", changeProp: true, options });
      if (String(component.get("os-page") ?? "") !== current) {
        // Sem "silent": a lista mostrada acompanha o href real. Não conta como edição.
        syncingPage = true;
        try {
          component.set("os-page", current, { avoidStore: true } as never);
        } finally {
          syncingPage = false;
        }
      }
    }
    if (hasHref) wanted.push(addressTrait("data-os-href", { label: "Endereço ao clicar" }));
    if (isClickableElement(String(component.get("tagName") ?? ""), attrs)) {
      wanted.push(clickEventTrait(String(attrs[CLICK_EVENT_ATTR] ?? "").trim()));
    }
    if ("data-os-delay" in attrs) {
      wanted.push({ type: "number", name: "data-os-delay", label: "Aparece depois de (segundos)", min: 0 });
    }
    const hidden = hiddenAddress.get(component);
    for (const trait of wanted) {
      const name = String(trait.name);
      const existing = component.getTrait(name);
      if (existing) {
        // Já existe: só atualiza as opções (links e páginas criados depois aparecem na lista).
        // Listas próprias dos widgets (osOptions: só links de WhatsApp, "— nenhum —"
        // do widget, "(removido)") são montadas por refreshOptions: não sobrescrever.
        if (trait.options && !(existing.attributes as Record<string, unknown>).osOptions) {
          existing.set("options", trait.options);
        }
      } else if (!hidden?.has(name as AddressTrait)) {
        // Campo de endereço escondido (link da oferta ligado) volta pelo syncDestination.
        component.addTrait(trait as never);
      }
    }
    if (isAnchor || "data-os-link" in attrs || hiddenAddress.has(component))
      syncDestination(component, { links, pages });
  });

  // Ligou/desligou um link da oferta ou uma página: o campo de endereço acompanha.
  editor.on("component:update:attributes", (component: Component) => {
    if (editor.getSelected() !== component) return;
    const attrs = component.getAttributes();
    if (component.get("tagName") !== "a" && !("data-os-link" in attrs) && !hiddenAddress.has(component)) return;
    syncDestination(component, getOptions());
  });

  // Escolher uma página do funil grava href="os-page:<id>"; "— nenhuma —" desfaz.
  editor.on("component:update:os-page", (component: Component) => {
    if (syncingPage) return;
    const pageId = String(component.get("os-page") ?? "");
    if (!pageId) {
      const href = String(component.getAttributes().href ?? "");
      if (href.startsWith(PAGE_PREFIX)) component.addAttributes({ href: "#" });
      return;
    }
    // A página do funil passa a valer: um link da oferta ligado antes teria prioridade.
    component.addAttributes({ href: `${PAGE_PREFIX}${pageId}` });
    if ("data-os-link" in component.getAttributes()) component.removeAttributes("data-os-link");
  });
}

/**
 * CSS só do editor: marca checkouts e itens com delay, esconde scripts,
 * noscripts e metas. As regras !important ficam na camada os-fix, que vence o
 * !important do CSS original da página (em @layer os-original) — ex.:
 * `a{outline:none!important}` não apaga as marcas.
 */
export const CANVAS_CSS = `
@layer os-fix, os-original;
@layer os-fix {
os-script, os-noscript, os-meta { display: none !important; }
[data-os-checkout] { outline: 2px dashed rgba(22,163,74,.7) !important; }
[data-os-link] { outline: 2px dashed rgba(79,70,229,.75) !important; }
[data-os-delay] { outline: 2px dashed rgba(234,88,12,.8) !important; }
}
[data-os-checkout], [data-os-link], [data-os-delay] { outline-offset: 2px; }
`;
