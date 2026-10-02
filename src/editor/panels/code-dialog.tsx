"use client";

/**
 * Editor de código (para quem sabe HTML/CSS):
 * 1. HTML do elemento selecionado — aplicar troca o elemento (dá para desfazer).
 * 2. CSS da página — as regras feitas no editor (o CSS original de páginas
 *    clonadas fica numa folha base à parte e perde para estas regras).
 * 3. Códigos da página — head / início do body / fim do body, guardados na
 *    página e injetados só na prévia e no ZIP (nunca rodam no editor).
 */
import { css as cssLanguage } from "@codemirror/lang-css";
import { html as htmlLanguage } from "@codemirror/lang-html";
import { oneDark } from "@codemirror/theme-one-dark";
import CodeMirror, { EditorState, EditorView, type Extension, keymap, Prec } from "@uiw/react-codemirror";
import type { Component, Editor, ResetFromStringOptions } from "grapesjs";
import {
  CodeXmlIcon,
  FileCode2Icon,
  InfoIcon,
  MousePointerClickIcon,
  PaletteIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAction } from "@/hooks/use-action";
import { DUP_ID_ATTR, EID_ATTR } from "@/lib/dup-ids";
import type { PageCustomCode } from "@/lib/page-code";
import {
  detectCodeTrackers,
  detectHtmlTrackers,
  joinTrackerNames,
  necessaryTrackerWarning,
  unknownScriptHint,
  unknownScriptHosts,
} from "@/lib/tracking/code-trackers";
import { CODE_CATEGORIES, CODE_CATEGORY_LABEL, type CodeCategoryId } from "@/lib/tracking/schema";
import { cn } from "@/lib/utils";
import { getPageCodeAction, savePageCodeAction } from "@/server/actions/page-code";
import type { EditorDialogProps } from "../editor-app";

// ─── HTML: scripts e on* inertes no editor ───────────────────────────────────
// Mesma convenção de src/lib/editor-html.ts: no editor, <script> vira <os-script>
// (inerte), <noscript> vira <os-noscript> (conteúdo como texto), on* vira
// data-os-on-* e valores "javascript:…" viram data-os-js-*. Aqui mostramos a
// versão "de verdade" e convertemos de volta ao aplicar — o que se vê é o que
// sai na página. (Sem importar editor-html: ele puxa cheerio e css-tree.)

const OS_SCRIPT = "os-script";
const OS_NOSCRIPT = "os-noscript";
const ATTRS_ATTR = "data-os-attrs";
const ON_PREFIX = "data-os-on-";
const ON_ATTR = /^on[a-z]+$/i;
const JS_PREFIX = "data-os-js-";
/** Mesmo teste do GrapesJS (allowUnsafeAttrValue: false), que apagaria o atributo. */
const JS_VALUE = "javascript:";

function storedAttrs(el: Element): Record<string, unknown> {
  try {
    const value = JSON.parse(el.getAttribute(ATTRS_ATTR) ?? "{}") as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function copyAttrs(target: Element, attrs: Record<string, unknown>) {
  for (const [name, value] of Object.entries(attrs)) {
    try {
      target.setAttribute(name, String(value));
    } catch {
      // nome de atributo inválido: ignora
    }
  }
}

function attrsOf(el: Element) {
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) attrs[attr.name] = attr.value;
  return attrs;
}

function parseFragment(html: string, doc: Document) {
  const template = doc.createElement("template");
  template.innerHTML = html;
  return template;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;
const KEEP_AS_IS = new Set(["pre", "textarea", "script", "style", "template"]);

/**
 * Indenta o HTML para leitura sem mudar a página: só quebra linha entre tags
 * que já estavam coladas (sem nenhum texto entre elas). O editor descarta esses
 * espaços com quebra de linha ao aplicar, então o resultado é o mesmo.
 * Elementos com texto dentro (parágrafos, links, botões…) ficam numa linha só.
 */
export function formatHtml(html: string, doc: Document = document): string {
  const template = parseFragment(html, doc);
  const top = Array.from(template.content.childNodes);
  if (top.some((node) => node.nodeType === TEXT_NODE)) return html;
  const lines: string[] = [];
  const render = (node: Node, depth: number) => {
    const pad = "  ".repeat(depth);
    if (node.nodeType === COMMENT_NODE) {
      lines.push(`${pad}<!--${(node as Comment).data}-->`);
      return;
    }
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const kids = Array.from(el.childNodes);
    const onlyTags = kids.every((k) => k.nodeType === ELEMENT_NODE || k.nodeType === COMMENT_NODE);
    if (!kids.length || !onlyTags || KEEP_AS_IS.has(tag)) {
      lines.push(`${pad}${el.outerHTML}`);
      return;
    }
    const shell = (el.cloneNode(false) as Element).outerHTML;
    const closeAt = shell.lastIndexOf("</");
    const close = closeAt >= 0 ? shell.slice(closeAt) : "";
    lines.push(`${pad}${closeAt >= 0 ? shell.slice(0, closeAt) : shell}`);
    for (const kid of kids) render(kid, depth + 1);
    lines.push(`${pad}${close}`);
  };
  for (const node of top) render(node, 0);
  return lines.join("\n");
}

// Ids repetidos (src/lib/dup-ids.ts): no editor, o repetido tem um id próprio
// do editor e o id da página em data-os-dup-id. Aqui ele aparece com o id da
// página (como no canvas e na página final) e com a marca data-os-eid que o
// separa do primeiro — a que já veio na página ou o id do editor. Ao aplicar, a
// marca leva de volta ao mesmo elemento (com o estilo dele).

/** Id do editor do repetido de `pageId` com a marca `eid`, ou null. */
export type DupResolver = (pageId: string, eid: string) => string | null;

function dupResolver(editor: Editor): DupResolver {
  const byKey = new Map<string, string>();
  const walk = (component: Component) => {
    const attrs = (component.get("attributes") ?? {}) as Record<string, unknown>;
    const dup = attrs[DUP_ID_ATTR];
    if (typeof dup === "string" && dup) {
      const own = attrs[EID_ATTR];
      byKey.set(`${dup}\n${typeof own === "string" && own ? own : component.getId()}`, component.getId());
    }
    for (const child of component.components().models) walk(child);
  };
  const wrapper = editor.getWrapper();
  if (wrapper) walk(wrapper);
  return (pageId, eid) => byKey.get(`${pageId}\n${eid}`) ?? null;
}

/** Seletores de atributo da marca (`[data-os-eid="…"]`, qualquer comparação) num texto CSS. */
const EID_SELECTOR = new RegExp(`\\[\\s*${EID_ATTR}(?![\\w-])[^\\]]*\\]`, "gi");

/**
 * A marca de um repetido sem marca própria é o id dele no editor: o canvas a
 * desenha (e esta janela a mostra), mas ela não vai para a página final e muda
 * a cada abertura. Quando uma regra do CSS da página mira essa marca, ela passa
 * a ser do elemento (atributo data-os-eid): vai para a página final e continua
 * a mesma ao reabrir — a regra vale igual no canvas, na página e depois.
 */
function keepReferencedMarks(editor: Editor) {
  const selectors = (editor.getCss({ avoidProtected: true }) ?? "").match(EID_SELECTOR);
  if (!selectors?.length) return;
  const probe = document.createElement("i");
  const referenced = (mark: string) => {
    probe.setAttribute(EID_ATTR, mark);
    return selectors.some((selector) => {
      try {
        return probe.matches(selector);
      } catch {
        return false;
      }
    });
  };
  const walk = (component: Component) => {
    const attrs = (component.get("attributes") ?? {}) as Record<string, unknown>;
    const dup = attrs[DUP_ID_ATTR];
    const own = attrs[EID_ATTR];
    if (typeof dup === "string" && dup && !(typeof own === "string" && own) && referenced(component.getId())) {
      component.addAttributes({ [EID_ATTR]: component.getId() });
    }
    for (const child of component.components().models) walk(child);
  };
  const wrapper = editor.getWrapper();
  if (wrapper) walk(wrapper);
}

/** HTML do editor → HTML real (scripts, noscript, on*, javascript: e ids repetidos de volta), para mostrar ao usuário. */
export function toReadableHtml(html: string, doc: Document = document): string {
  const template = parseFragment(html, doc);
  for (const el of Array.from(template.content.querySelectorAll(`[${DUP_ID_ATTR}][id]`))) {
    const pageId = el.getAttribute(DUP_ID_ATTR);
    const editorId = el.getAttribute("id");
    if (!pageId || !editorId) continue;
    if (!el.getAttribute(EID_ATTR)) el.setAttribute(EID_ATTR, editorId);
    el.setAttribute("id", pageId);
    el.removeAttribute(DUP_ID_ATTR);
  }
  // Documento inerte do <template>: ali o conteúdo de um <noscript> vira
  // elementos (e sai como HTML, não como texto escapado).
  const inertDoc = template.content.ownerDocument ?? doc;
  for (const el of Array.from(template.content.querySelectorAll(OS_SCRIPT))) {
    const script = doc.createElement("script");
    copyAttrs(script, storedAttrs(el));
    script.textContent = el.textContent ?? "";
    el.replaceWith(script);
  }
  for (const el of Array.from(template.content.querySelectorAll(OS_NOSCRIPT))) {
    const noscript = inertDoc.createElement("noscript");
    copyAttrs(noscript, storedAttrs(el));
    noscript.innerHTML = el.textContent ?? "";
    el.replaceWith(noscript);
  }
  for (const el of Array.from(template.content.querySelectorAll("*"))) {
    // Primeiro os valores javascript: (podem estar num data-os-on-*), depois os on*.
    for (const attr of Array.from(el.attributes)) {
      if (!attr.name.startsWith(JS_PREFIX)) continue;
      const target = attr.name.slice(JS_PREFIX.length);
      // Mesma regra do salvar: um valor novo posto no editor vence o guardado.
      if (target && !el.hasAttribute(target)) {
        try {
          el.setAttribute(target, `${JS_VALUE}${attr.value}`);
        } catch {
          // nome de atributo inválido: ignora
        }
      }
      el.removeAttribute(attr.name);
    }
    for (const attr of Array.from(el.attributes)) {
      if (!attr.name.startsWith(ON_PREFIX)) continue;
      el.setAttribute(`on${attr.name.slice(ON_PREFIX.length)}`, attr.value);
      el.removeAttribute(attr.name);
    }
  }
  return template.innerHTML;
}

/**
 * HTML digitado → HTML seguro para o editor (nada executa no painel). Com
 * `resolveDup`, os ids repetidos mostrados por toReadableHtml voltam a ser os
 * elementos do editor (id do editor + data-os-dup-id).
 */
export function toEditorHtml(html: string, doc: Document = document, resolveDup?: DupResolver): string {
  const template = parseFragment(html, doc);
  for (const el of resolveDup ? Array.from(template.content.querySelectorAll(`[${EID_ATTR}][id]`)) : []) {
    const pageId = el.getAttribute("id") ?? "";
    const eid = el.getAttribute(EID_ATTR) ?? "";
    const editorId = resolveDup?.(pageId, eid);
    if (!editorId || el.hasAttribute(DUP_ID_ATTR)) continue;
    el.setAttribute("id", editorId);
    el.setAttribute(DUP_ID_ATTR, pageId);
    // A marca que era só o id do editor não é do elemento.
    if (eid === editorId) el.removeAttribute(EID_ATTR);
  }
  for (const script of Array.from(template.content.querySelectorAll("script"))) {
    const inert = doc.createElement(OS_SCRIPT);
    inert.setAttribute(ATTRS_ATTR, JSON.stringify(attrsOf(script)));
    inert.setAttribute("hidden", "");
    inert.textContent = script.textContent ?? "";
    script.replaceWith(inert);
  }
  // <noscript>: o editor leria o conteúdo como página (um <style> ali viraria
  // CSS de todo visitante). Guardado como texto, volta igual ao salvar.
  for (const noscript of Array.from(template.content.querySelectorAll("noscript"))) {
    const inert = doc.createElement(OS_NOSCRIPT);
    inert.setAttribute(ATTRS_ATTR, JSON.stringify(attrsOf(noscript)));
    inert.setAttribute("hidden", "");
    inert.textContent = noscript.innerHTML;
    noscript.replaceWith(inert);
  }
  for (const el of Array.from(template.content.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      if (!ON_ATTR.test(attr.name)) continue;
      el.setAttribute(`${ON_PREFIX}${attr.name.slice(2).toLowerCase()}`, attr.value);
      el.removeAttribute(attr.name);
    }
    for (const attr of Array.from(el.attributes)) {
      // O GrapesJS apagaria o atributo inteiro (ex.: href="javascript:void(0)",
      // onclick="javascript:abrir()"): o valor vai sem o prefixo para data-os-js-*.
      if (!attr.value.startsWith(JS_VALUE) || attr.name.startsWith(JS_PREFIX)) continue;
      el.setAttribute(`${JS_PREFIX}${attr.name}`, attr.value.slice(JS_VALUE.length));
      el.removeAttribute(attr.name);
    }
  }
  return template.innerHTML;
}

/** HTML que o usuário vê/edita para o elemento (a página inteira, se for o corpo). */
export function elementHtml(editor: Editor, component: Component): string {
  const isWrapper = component === editor.getWrapper();
  // Repetidos sem estilo próprio não levam o id do editor no HTML: aqui levam,
  // para todos aparecerem com o id da página e a marca (toReadableHtml).
  const opts = {
    attributes: (c: Component, attrs: Record<string, unknown>) => {
      const dup = (c.get("attributes") as Record<string, unknown> | undefined)?.[DUP_ID_ATTR];
      return typeof dup === "string" && dup && !attrs.id ? { ...attrs, id: c.getId() } : attrs;
    },
  };
  return formatHtml(toReadableHtml(isWrapper ? component.getInnerHTML(opts) : component.toHTML(opts)));
}

const UNSAFE_VALUE = /^\s*javascript:/i;

/** Nomes das classes de uma definição do parser (strings ou objetos { name }). */
function classNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((c) => (typeof c === "string" ? c : typeof c === "object" && c && "name" in c ? String(c.name) : ""))
    .filter(Boolean);
}

/** Troca as classes só se mudaram (evita passos de desfazer à toa). */
function syncClasses(component: Component, classes: string[]) {
  if (classes.join(" ") !== component.getClasses().join(" ")) component.setClass(classes);
}

/**
 * Atualiza por id o que já existe (em vez de recriar): assim ids, estilos (#id)
 * e tudo o que o editor guarda em cada elemento continuam valendo. Atributos são
 * substituídos (apagar um atributo no código apaga de verdade), e as classes também.
 */
function keyedUpdate(explicitId: Map<string, boolean>): ResetFromStringOptions {
  return {
    updateOptions: {
      onAttributes: ({ component, item, attributes, options }) => {
        // O GrapesJS troca a tag de quem é reaproveitado em silêncio (fora do
        // desfazer). Refaz a troca "de verdade" para o desfazer voltar a tag.
        const newTag = component.get("tagName");
        const oldTag = component.previous("tagName");
        if (oldTag && newTag && oldTag !== newTag) {
          component.set({ tagName: oldTag }, { silent: true });
          component.set({ tagName: newTag });
        }
        const id = component.getId();
        const keepId = explicitId.get(id) ?? true;
        component.setAttributes(keepId ? { ...attributes, id } : attributes, options);
        syncClasses(component, classNames(item.classes));
      },
    },
  };
}

/**
 * Caminho curto (o mais comum): o HTML continua sendo um elemento só, com a mesma
 * tag e o mesmo tipo — atualiza o próprio elemento e o que há dentro dele.
 */
function updateInPlace(editor: Editor, component: Component, html: string): boolean {
  const template = parseFragment(html, document);
  const nodes = Array.from(template.content.childNodes).filter(
    (n) => !(n.nodeType === TEXT_NODE && !n.textContent?.trim()),
  );
  const root = nodes[0];
  if (nodes.length !== 1 || root.nodeType !== ELEMENT_NODE) return false;
  const el = root as Element;
  if (el.tagName.toLowerCase() !== String(component.get("tagName") ?? "").toLowerCase()) return false;
  const parsed = editor.Parser.parseHtml(el.outerHTML);
  const def = Array.isArray(parsed.html) ? parsed.html[0] : parsed.html;
  // Mudou o tipo (ex.: virou um widget, um vídeo, um texto)? Aí precisa recriar.
  if (!def || (def.type || "default") !== (component.get("type") || "default")) return false;

  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === "class" || attr.name === "style" || UNSAFE_VALUE.test(attr.value)) continue;
    attrs[attr.name] = attr.value;
  }
  component.setAttributes(attrs);
  syncClasses(component, Array.from(el.classList));
  if (def.style && typeof def.style === "object" && Object.keys(def.style).length) component.addStyle(def.style);
  // Quem veio com id no HTML mantém o id (explícito).
  component.components().resetFromString(el.innerHTML, keyedUpdate(new Map()));
  return true;
}

/** Caminho geral: troca o elemento dentro da lista do pai (mudou a tag, o tipo ou virou vários). */
function replaceInParent(editor: Editor, component: Component, html: string): Component | undefined {
  const isWrapper = component === editor.getWrapper();
  const coll = isWrapper ? component.components() : component.collection;
  if (!coll) throw new Error("Elemento sem lugar na página.");
  const index = isWrapper ? 0 : coll.indexOf(component);
  // Os irmãos (e tudo dentro deles) vão com o id interno só para serem
  // reaproveitados como estão — sem isso seriam recriados a partir do HTML.
  const kept = coll.models.filter((c) => c !== component).flatMap((c) => [c, ...c.find("*")]);
  const explicitId = new Map(kept.map((c) => [c.getId(), Boolean(c.get("attributes")?.id)]));
  const withIds = { attributes: (m: Component, attrs: Record<string, unknown>) => ({ ...attrs, id: m.getId() }) };
  const parts = isWrapper ? [html] : coll.models.map((c) => (c === component ? html : c.toHTML(withIds)));
  coll.resetFromString(parts.join(""), keyedUpdate(explicitId));
  return isWrapper ? undefined : coll.at(index);
}

/**
 * Roda uma troca grande como UM passo de desfazer: enquanto roda, o histórico
 * não tem limite (senão o começo da própria troca seria descartado).
 */
function asSingleUndoStep<T>(editor: Editor, run: () => T): T {
  const undo = editor.UndoManager.getInstance() as
    | { get(key: string): unknown; set(key: string, value: unknown): void }
    | undefined;
  const max = undo?.get("maximumStackLength");
  undo?.set("maximumStackLength", Number.POSITIVE_INFINITY);
  try {
    return run();
  } finally {
    undo?.set("maximumStackLength", max);
  }
}

/**
 * Troca o elemento pelo HTML digitado, numa única ação de desfazer. Elementos
 * com o mesmo id são atualizados (não recriados): ids, estilos (#id), âncoras
 * (#oferta) e o CSS original continuam valendo. Devolve o elemento que ficou
 * no lugar (para selecionar); undefined quando a troca foi da página inteira.
 */
export function applyElementHtml(editor: Editor, component: Component, html: string): Component | undefined {
  const newHtml = toEditorHtml(html, document, dupResolver(editor));
  return asSingleUndoStep(editor, () => {
    const kept =
      component !== editor.getWrapper() && updateInPlace(editor, component, newHtml)
        ? component
        : replaceInParent(editor, component, newHtml);
    // Um <style> no HTML digitado vira regra do editor e pode mirar a marca de um repetido.
    keepReferencedMarks(editor);
    return kept;
  });
}

/**
 * Regras "@" que o editor guarda: @media, @supports, @container, @layer { … },
 * @keyframes, @font-face e @page. As outras (@import, @property, @counter-style,
 * @scope…) seriam descartadas em silêncio ao aplicar — ou, algumas, fariam o
 * editor não ler nenhuma regra do CSS.
 */
const KEPT_AT_RULES = new Set([
  "media",
  "supports",
  "container",
  "layer",
  "keyframes",
  "font-face",
  "page",
  // @charset não faz falta (a página já é UTF-8): pode ficar sem aviso.
  "charset",
]);

/** Comentários, textos entre aspas e url(…): onde um "@" não é regra. */
const CSS_NOISE = /\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|url\([^)]*\)/gi;

function stripCssNoise(css: string) {
  return css.replace(CSS_NOISE, " ");
}

/**
 * Regras "@" do CSS digitado que o editor descartaria (ex.: @import, @property,
 * @namespace, "@layer a, b;"). Em ordem de aparição, sem repetir.
 */
export function unsupportedCssAtRules(css: string): string[] {
  const text = stripCssNoise(css);
  const found = new Set<string>();
  for (const m of text.matchAll(/@(-[a-z]+-)?([a-z][a-z-]*)([^{;}]*)([{;}]|$)/gi)) {
    const name = m[2].toLowerCase();
    if (name === "layer" && m[4] !== "{") found.add("@layer (sem bloco)");
    else if (!KEPT_AT_RULES.has(name)) found.add(`@${name}`);
  }
  return [...found];
}

// ─── CSS: conferir que nada se perde ─────────────────────────────────────────
// O analisador de CSS do GrapesJS descarta em silêncio o que não entende (CSS
// aninhado, @media dentro de @supports, atalhos com var(), …). Antes de trocar
// as regras, o CSS digitado (lido pelo navegador) é comparado com o que o
// editor guardaria: cada declaração de cada seletor, em cada @media/@supports.

/** CSS lido pelo navegador (sem aplicar em lugar nenhum). */
function browserSheet(text: string): CSSStyleSheet | null {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    return sheet;
  } catch {
    try {
      const doc = document.implementation.createHTMLDocument("");
      const style = doc.createElement("style");
      style.textContent = text;
      doc.head.appendChild(style);
      return style.sheet;
    } catch {
      return null;
    }
  }
}

type AnyCssRule = CSSRule & {
  cssRules?: CSSRuleList;
  selectorText?: string;
  keyText?: string;
  style?: CSSStyleDeclaration;
  media?: MediaList;
  conditionText?: string;
  name?: string;
};

/** Regras dentro de regras (CSS aninhado, `&`): o editor não guarda. */
function hasNestedRules(list: CSSRuleList): boolean {
  for (const rule of Array.from(list) as AnyCssRule[]) {
    const kind = rule.constructor?.name ?? "";
    if ((kind === "CSSStyleRule" || typeof rule.selectorText === "string") && rule.cssRules?.length) return true;
    if (rule.cssRules && hasNestedRules(rule.cssRules)) return true;
  }
  return false;
}

/** Separa "a, b:is(c, d)" em ["a", "b:is(c, d)"] (vírgulas fora de parênteses/colchetes/aspas). */
function splitSelectors(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

interface Declared {
  value: string;
  important: boolean;
  /** Como o seletor aparece na mensagem. */
  label: string;
}

/**
 * Cada declaração do CSS, por "contexto (@media…) + seletor + propriedade".
 * Para um mesmo seletor, a última vence (e !important vence as comuns), como
 * no navegador.
 */
function declarations(list: CSSRuleList, ctx = "", out = new Map<string, Declared>()) {
  const add = (selector: string, style: CSSStyleDeclaration) => {
    const label = `${ctx}${selector}`;
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      const important = style.getPropertyPriority(prop) === "important";
      const key = `${ctx}${selector}|${prop}`;
      if (out.get(key)?.important && !important) continue;
      out.set(key, { value: style.getPropertyValue(prop).trim(), important, label });
    }
  };
  for (const rule of Array.from(list) as AnyCssRule[]) {
    const kind = rule.constructor?.name ?? "";
    const text = rule.cssText;
    if (kind === "CSSPageRule") {
      if (rule.style) add(`@page ${rule.selectorText ?? ""}`.trim(), rule.style);
    } else if (typeof rule.selectorText === "string" && rule.style) {
      for (const selector of splitSelectors(rule.selectorText)) add(selector, rule.style);
    } else if (typeof rule.keyText === "string" && rule.style) {
      add(rule.keyText, rule.style);
    } else if (kind === "CSSFontFaceRule" && rule.style) {
      out.set(`${ctx}@font-face{${rule.style.cssText}}`, { value: "", important: false, label: `${ctx}@font-face` });
    } else if (rule.cssRules) {
      // @media, @supports, @container, @layer { … }, @keyframes: o que vem antes do "{".
      const prelude = text.slice(0, text.indexOf("{")).replace(/\s+/g, " ").trim();
      const normalized =
        kind === "CSSMediaRule" && rule.media
          ? `@media ${rule.media.mediaText}`
          : typeof rule.conditionText === "string" && prelude.startsWith("@")
            ? `${prelude.split(" ")[0]} ${rule.conditionText}`
            : prelude;
      declarations(rule.cssRules, `${ctx}${normalized} `, out);
    } else {
      out.set(`${ctx}${text}`, { value: "", important: false, label: `${ctx}${text.split(/[\s{;]/)[0]}` });
    }
  }
  return out;
}

/** Junta as regras sem perder declarações de seletores repetidos (o padrão do GrapesJS troca o estilo inteiro). */
function addAllRules(editor: Editor, text: string) {
  (editor.Css as unknown as { addCollection(data: string, opts: object): unknown }).addCollection(text, {
    extend: true,
  });
}

/** CSS que o editor guardaria com estas regras (sem mexer no editor nem no Desfazer). */
function editorCssFor(editor: Editor, text: string): string {
  const css = editor.Css;
  const rules = css.getAll() as unknown as { models: unknown[]; reset(models: unknown[]): void };
  const previous = rules.models.slice();
  let out = "";
  editor.UndoManager.skip(() => {
    try {
      css.clear();
      addAllRules(editor, text);
      out = editor.getCss({ avoidProtected: true }) ?? "";
    } finally {
      css.clear();
      rules.reset(previous);
    }
  });
  return out;
}

/** Seletores (com as @media em volta) que o editor perderia ou mudaria. */
function lostSelectors(editor: Editor, text: string, sheet: CSSStyleSheet): string[] {
  const wanted = declarations(sheet.cssRules);
  const kept = browserSheet(editorCssFor(editor, text));
  const got = kept ? declarations(kept.cssRules) : new Map<string, Declared>();
  const lost = new Set<string>();
  for (const [key, want] of wanted) {
    const have = got.get(key);
    if (!have || have.value !== want.value || have.important !== want.important) lost.add(want.label);
  }
  return [...lost];
}

function listForMessage(items: string[]) {
  const shown = items.slice(0, 3).map((s) => `“${s.length > 60 ? `${s.slice(0, 59)}…` : s}”`);
  return items.length > 3 ? `${shown.join(", ")} e mais ${items.length - 3}` : shown.join(", ");
}

/**
 * Troca o CSS do editor (as edições) pelo CSS digitado, numa única ação de
 * desfazer, e avisa o editor da mudança (o GrapesJS não conta trocar a lista de
 * regras como alteração: sem isso nada seria salvo). Recusa, sem mexer em nada,
 * o que o editor não guardaria como está.
 */
export function applyPageCss(editor: Editor, css: string): { ok: true } | { ok: false; error: string } {
  const text = css.trim();
  const unsupported = unsupportedCssAtRules(text);
  if (unsupported.includes("@import")) {
    return {
      ok: false,
      error:
        'O @import não funciona aqui. Para carregar uma fonte ou um arquivo CSS de fora, apague o @import daqui e coloque <link rel="stylesheet" href="endereço"> na aba “Códigos da página”, em “No <head>”.',
    };
  }
  if (unsupported.length) {
    return {
      ok: false,
      error: `O editor não guarda ${unsupported.join(", ")}: essas regras seriam descartadas. Tire-as daqui (se precisar delas, use a aba “Códigos da página”, com <style>…</style>).`,
    };
  }
  if (text) {
    const sheet = browserSheet(text);
    if (sheet && hasNestedRules(sheet.cssRules)) {
      return {
        ok: false,
        error:
          "Regras dentro de regras (CSS aninhado ou &) não são aceitas aqui: escreva cada seletor separado (ex.: .card .titulo { … } e .card:hover { … }).",
      };
    }
    if (!editor.Parser.parseCss(text).length) {
      return {
        ok: false,
        error: "Não encontramos nenhuma regra CSS válida. Confira as chaves { } e os ponto e vírgulas.",
      };
    }
    const lost = sheet ? lostSelectors(editor, text, sheet) : [];
    if (lost.length) {
      return {
        ok: false,
        error: `O editor não guardaria estas regras como estão: ${listForMessage(lost)}. Separe o que estiver junto (ex.: @media dentro de @supports), escreva atalhos com var() por partes (margin-top, margin-bottom…) ou coloque essas regras na aba “Códigos da página”, com <style>…</style>.`,
      };
    }
  }
  asSingleUndoStep(editor, () => {
    editor.Css.clear();
    if (text) addAllRules(editor, text);
    keepReferencedMarks(editor);
  });
  // Conta como alteração: marca a página para salvar e liga o Desfazer.
  (editor.getModel() as unknown as { changesUp(opts: object): void }).changesUp({});
  return { ok: true };
}

const NESTED_AT_RULE = /^@(-[a-z]+-)?(media|supports|layer|container|document|scope|starting-style|keyframes)\b/i;

/**
 * Deixa o CSS legível (uma declaração por linha, blocos indentados). Só mexe em
 * espaços fora de textos e parênteses — o CSS continua equivalente.
 */
export function formatCss(input: string): string {
  const src = input.trim();
  if (!src) return "";
  const lines: string[] = [];
  const blocks: boolean[] = []; // true = bloco com regras (@media…), false = declarações
  let buf = "";
  let quote = "";
  let parens = 0;
  const indent = () => "  ".repeat(blocks.length);
  const inDeclarations = () => blocks.length > 0 && !blocks[blocks.length - 1];
  const pushStatement = (text: string) => {
    const t = text.trim();
    if (!t) return;
    const colon = inDeclarations() ? t.indexOf(":") : -1;
    const pretty = colon > 0 ? `${t.slice(0, colon).trim()}: ${t.slice(colon + 1).trim()}` : t;
    lines.push(`${indent()}${pretty};`);
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      buf += ch;
      if (ch === "\\" && i + 1 < src.length) buf += src[++i];
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      if (buf.trim()) buf += src.slice(i, stop);
      else lines.push(`${indent()}${src.slice(i, stop)}`);
      i = stop - 1;
      continue;
    }
    if (ch === "(") parens++;
    else if (ch === ")") parens = Math.max(0, parens - 1);
    if (parens > 0 || ch === ")") {
      buf += ch;
      continue;
    }
    if (ch === "{") {
      const prelude = buf.trim().replace(/\s*\n\s*/g, " ");
      buf = "";
      lines.push(`${indent()}${prelude} {`);
      blocks.push(NESTED_AT_RULE.test(prelude));
      continue;
    }
    if (ch === ";") {
      pushStatement(buf);
      buf = "";
      continue;
    }
    if (ch === "}") {
      pushStatement(buf);
      buf = "";
      blocks.pop();
      lines.push(`${indent()}}`);
      if (!blocks.length) lines.push("");
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) lines.push(buf.trim());
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

// ─── CodeMirror ──────────────────────────────────────────────────────────────

/** Textos internos do CodeMirror (busca, dobras…) em português. */
const PT_PHRASES = EditorState.phrases.of({
  Find: "Procurar",
  Replace: "Substituir",
  next: "próximo",
  previous: "anterior",
  all: "todos",
  "match case": "diferenciar maiúsculas",
  "by word": "palavra inteira",
  regexp: "expressão regular",
  replace: "substituir",
  "replace all": "substituir todos",
  close: "fechar",
  "current match": "resultado atual",
  "replaced $ matches": "$ trocas feitas",
  "replaced match on line $": "troca feita na linha $",
  "on line": "na linha",
  "Go to line": "Ir para a linha",
  go: "ir",
  "Folded lines": "Linhas recolhidas",
  "Unfolded lines": "Linhas expandidas",
  to: "até",
  "folded code": "código recolhido",
  unfold: "expandir",
  "Fold line": "Recolher linha",
  "Unfold line": "Expandir linha",
  "Control character": "Caractere de controle",
  Completions: "Sugestões",
});

const BASE_THEME = EditorView.theme({
  "&": { height: "100%", fontSize: "13px" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
  "&.cm-focused": { outline: "none" },
});

/** Tema do app: .dark, ou .system com o sistema no modo escuro. */
function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const html = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () =>
      setDark(html.classList.contains("dark") || (html.classList.contains("system") && media.matches));
    update();
    media.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => {
      media.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);
  return dark;
}

function CodeEditor({
  value,
  onChange,
  language,
  dark,
  onSubmit,
  label,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  language: "html" | "css";
  dark: boolean;
  /** ⌘Enter / ⌘S dentro do editor. */
  onSubmit?: () => void;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const submit = useRef(onSubmit);
  submit.current = onSubmit;
  const extensions = useMemo<Extension[]>(
    () => [
      language === "css" ? cssLanguage() : htmlLanguage(),
      EditorView.lineWrapping,
      PT_PHRASES,
      BASE_THEME,
      EditorView.contentAttributes.of({ "aria-label": label }),
      Prec.highest(
        keymap.of(
          ["Mod-Enter", "Mod-s"].map((key) => ({
            key,
            run: () => {
              submit.current?.();
              return true;
            },
          })),
        ),
      ),
    ],
    [language, label],
  );
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme={dark ? oneDark : "light"}
      extensions={extensions}
      height="100%"
      placeholder={placeholder}
      basicSetup={{ foldGutter: true, highlightActiveLine: true, autocompletion: true, searchKeymap: true }}
      className={cn("h-full min-h-0 overflow-hidden rounded-md border bg-background", className)}
    />
  );
}

function Note({ tone = "info", children }: { tone?: "info" | "warning"; children: React.ReactNode }) {
  const Icon = tone === "warning" ? TriangleAlertIcon : InfoIcon;
  return (
    <div
      className={cn(
        "flex gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed",
        tone === "warning" ? "border-warning/40 bg-warning/10 text-foreground" : "bg-muted/50 text-muted-foreground",
      )}
    >
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", tone === "warning" && "text-warning")} />
      <div>{children}</div>
    </div>
  );
}

// ─── Diálogo ─────────────────────────────────────────────────────────────────

type Tab = "html" | "css" | "page";
/** Igual a PAGE_CODE_MAX_BYTES do serviço (não dá para importar valor do servidor aqui). */
const PAGE_CODE_MAX_BYTES = 200 * 1024;
const EMPTY_CODE: PageCustomCode = { head: "", bodyStart: "", bodyEnd: "" };
/** Valor do seletor para "automático" (categoria não escolhida: decide pela detecção de pixels). */
const AUTO_CATEGORY = "AUTO";
type CategoryChoice = CodeCategoryId | typeof AUTO_CATEGORY;
const categoryOf = (data: { category?: CodeCategoryId | null }): CategoryChoice => data.category ?? AUTO_CATEGORY;

const PAGE_CODE_SLOTS: { field: keyof PageCustomCode; title: string; hint: string; placeholder: string }[] = [
  {
    field: "head",
    title: "No <head>",
    hint: "Verificação de domínio, metatags, fontes e scripts que pedem para ficar no head.",
    placeholder: '<meta name="facebook-domain-verification" content="…">',
  },
  {
    field: "bodyStart",
    title: "Logo depois de abrir o <body>",
    hint: "Códigos que pedem para ficar no início do body (ex.: o <noscript> do Google Tag Manager).",
    placeholder: "<noscript>…</noscript>",
  },
  {
    field: "bodyEnd",
    title: "Antes de fechar o </body>",
    hint: "Chats, widgets e scripts que podem carregar por último.",
    placeholder: '<script src="https://…"></script>',
  },
];

const byteLength = (text: string) => new TextEncoder().encode(text).length;
const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB`;
const sameCode = (a: PageCustomCode, b: PageCustomCode) =>
  a.head === b.head && a.bodyStart === b.bodyStart && a.bodyEnd === b.bodyEnd;

export function CodeDialog({ editor, payload, open, onOpenChange }: EditorDialogProps) {
  const dark = useDarkMode();
  const [tab, setTab] = useState<Tab>("html");
  const [confirmClose, setConfirmClose] = useState(false);

  // HTML do elemento
  const target = useRef<Component | null>(null);
  const [targetName, setTargetName] = useState("");
  const [htmlInitial, setHtmlInitial] = useState("");
  const [htmlValue, setHtmlValue] = useState("");
  const [htmlError, setHtmlError] = useState<string | null>(null);

  // CSS da página
  const [cssInitial, setCssInitial] = useState("");
  const [cssValue, setCssValue] = useState("");
  const [cssError, setCssError] = useState<string | null>(null);

  // Códigos da página
  const [code, setCode] = useState<PageCustomCode | null>(null);
  const [savedCode, setSavedCode] = useState<PageCustomCode>(EMPTY_CODE);
  const [category, setCategory] = useState<CategoryChoice>(AUTO_CATEGORY);
  const [savedCategory, setSavedCategory] = useState<CategoryChoice>(AUTO_CATEGORY);
  const loadCode = useAction(getPageCodeAction);
  const saveCode = useAction(savePageCodeAction);
  const runLoadCode = loadCode.run;

  /** Lê do editor o HTML do elemento (ou de outro, se ele foi trocado) e o CSS atual. */
  const readHtml = useCallback(
    (component: Component | null) => {
      target.current = component;
      const isWrapper = component === editor.getWrapper();
      setTargetName(component ? (isWrapper ? "Página inteira" : component.getName()) : "");
      const html = component ? elementHtml(editor, component) : "";
      setHtmlInitial(html);
      setHtmlValue(html);
      setHtmlError(null);
    },
    [editor],
  );
  const readCss = useCallback(() => {
    const css = formatCss(editor.getCss({ avoidProtected: true }) ?? "");
    setCssInitial(css);
    setCssValue(css);
    setCssError(null);
  }, [editor]);

  // Ao abrir: lê o elemento selecionado, o CSS atual e os códigos da página.
  useEffect(() => {
    if (!open) return;
    const selected = editor.getSelected() ?? null;
    readHtml(selected);
    readCss();
    setTab(selected ? "html" : "css");
    setCode(null);
    void runLoadCode(
      { pageId: payload.page.id },
      {
        onSuccess: (data) => {
          const loaded = { head: data.head, bodyStart: data.bodyStart, bodyEnd: data.bodyEnd };
          setCode(loaded);
          setSavedCode(loaded);
          setCategory(categoryOf(data));
          setSavedCategory(categoryOf(data));
        },
      },
    );
  }, [open, editor, payload.page.id, runLoadCode, readHtml, readCss]);

  const htmlDirty = Boolean(target.current) && htmlValue !== htmlInitial;
  const cssDirty = cssValue !== cssInitial;
  const codeDirty = code !== null && (!sameCode(code, savedCode) || category !== savedCategory);
  // Pixels colados aqui: sem escolha, esperam o "Aceitar"; como "Essencial", passariam na frente dele.
  const trackers = useMemo(() => (code ? detectCodeTrackers(code.head, code.bodyStart, code.bodyEnd) : []), [code]);
  const unknownScripts = useMemo(
    () => (code ? unknownScriptHosts([code.head, code.bodyStart, code.bodyEnd]) : []),
    [code],
  );
  // Pixel no HTML da página carregaria antes do "Aceitar" (só os "Códigos da página" esperam).
  const htmlTrackers = useMemo(() => detectHtmlTrackers(htmlValue), [htmlValue]);
  const newHtmlTrackers = useMemo(() => {
    const before = new Set(detectHtmlTrackers(htmlInitial));
    return htmlTrackers.filter((t) => !before.has(t));
  }, [htmlTrackers, htmlInitial]);
  const dirty = htmlDirty || cssDirty || codeDirty;
  const codeBytes = code ? byteLength(code.head) + byteLength(code.bodyStart) + byteLength(code.bodyEnd) : 0;
  const codeTooBig = codeBytes > PAGE_CODE_MAX_BYTES;

  const requestClose = useCallback(() => {
    if (dirty) setConfirmClose(true);
    else onOpenChange(false);
  }, [dirty, onOpenChange]);

  function applyHtml() {
    const component = target.current;
    if (!component) return;
    if (!htmlValue.trim()) {
      setHtmlError("O HTML está vazio. Para apagar o elemento, selecione-o na página e aperte Delete.");
      return;
    }
    if (newHtmlTrackers.length) {
      setHtmlError(
        `Este HTML tem ${joinTrackerNames(newHtmlTrackers)}. Aqui ele carregaria antes do “Aceitar” do aviso de cookies: tire-o daqui e cole na aba “Códigos da página”, que espera o consentimento.`,
      );
      return;
    }
    let replaced: Component | undefined;
    try {
      replaced = applyElementHtml(editor, component, htmlValue);
    } catch {
      setHtmlError("Não foi possível aplicar esse HTML. Confira se as tags estão abertas e fechadas certinho.");
      return;
    }
    if (replaced) editor.select(replaced);
    toast.success("HTML aplicado. Para voltar atrás, use Desfazer (⌘Z).");
    // Fecha, a não ser que haja outra aba com mudanças pendentes.
    if (cssDirty || codeDirty) {
      readHtml(replaced ?? component);
      if (!cssDirty) readCss();
    } else {
      onOpenChange(false);
    }
  }

  function applyCss() {
    const result = applyPageCss(editor, cssValue);
    if (!result.ok) {
      setCssError(result.error);
      return;
    }
    toast.success("CSS aplicado. Para voltar atrás, use Desfazer (⌘Z).");
    if (htmlDirty || codeDirty) readCss();
    else onOpenChange(false);
  }

  async function saveCodes() {
    if (!code || codeTooBig || saveCode.pending) return;
    const result = await saveCode.run(
      {
        pageId: payload.page.id,
        ...code,
        ...(category !== savedCategory ? { category: category === AUTO_CATEGORY ? null : category } : {}),
      },
      { success: "Códigos salvos. Eles entram na prévia e na página publicada." },
    );
    if (result.ok) {
      const saved = { head: result.data.head, bodyStart: result.data.bodyStart, bodyEnd: result.data.bodyEnd };
      setCode(saved);
      setSavedCode(saved);
      setSavedCategory(category);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
        <DialogContent
          className="flex h-[min(88vh,860px)] w-[min(96vw,1080px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
          onEscapeKeyDown={(event) => {
            // Esc dentro do editor de código fecha a busca/sugestões, não a janela.
            const el = event.target instanceof Element ? event.target.closest(".cm-editor") : null;
            if (el?.querySelector(".cm-search, .cm-tooltip-autocomplete")) event.preventDefault();
          }}
        >
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>Código</DialogTitle>
            <DialogDescription>
              Para quem conhece HTML e CSS. O que você aplicar aqui pode ser desfeito com Desfazer (⌘Z).
            </DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList className="mx-5 mt-4 w-fit">
              <TabsTrigger value="html">
                <CodeXmlIcon />
                HTML do elemento
              </TabsTrigger>
              <TabsTrigger value="css">
                <PaletteIcon />
                CSS da página
              </TabsTrigger>
              <TabsTrigger value="page">
                <FileCode2Icon />
                Códigos da página
              </TabsTrigger>
            </TabsList>

            {/* 1. HTML do elemento */}
            <TabsContent value="html" className="flex min-h-0 flex-1 flex-col gap-3 px-5 pt-3 pb-5">
              {target.current ? (
                <>
                  <Note>
                    Editando <strong className="font-medium text-foreground">{targetName}</strong>. Ao aplicar, o
                    elemento é trocado por este HTML. Scripts e eventos (onclick…) ficam guardados e só rodam na prévia
                    e na página publicada.
                    {htmlInitial.includes(`${EID_ATTR}=`) &&
                      ` Elementos que repetem o id de outro têm também ${EID_ATTR}, a marca que os separa: deixe-a como está para eles continuarem com o estilo próprio.`}
                  </Note>
                  {htmlTrackers.length > 0 && (
                    <Note tone="warning">
                      <span data-testid="element-html-trackers">
                        {newHtmlTrackers.length ? "Este HTML tem" : "Este elemento tem"}{" "}
                        {joinTrackerNames(newHtmlTrackers.length ? newHtmlTrackers : htmlTrackers)}: no HTML da página,
                        pixels e tags carregam antes do “Aceitar” do aviso de cookies. Coloque-os na aba{" "}
                        <button
                          type="button"
                          className="font-medium text-foreground underline underline-offset-2"
                          onClick={() => setTab("page")}
                        >
                          Códigos da página
                        </button>
                        , que espera o consentimento.
                      </span>
                    </Note>
                  )}
                  <div className="min-h-0 flex-1">
                    <CodeEditor
                      value={htmlValue}
                      onChange={(v) => {
                        setHtmlValue(v);
                        setHtmlError(null);
                      }}
                      language="html"
                      dark={dark}
                      onSubmit={applyHtml}
                      label="HTML do elemento"
                    />
                  </div>
                  {htmlError && (
                    <p role="alert" className="text-sm text-destructive">
                      {htmlError}
                    </p>
                  )}
                  <Footer
                    hint={APPLY_HINT}
                    onCancel={requestClose}
                    action={
                      <Button onClick={applyHtml} disabled={!htmlDirty}>
                        Aplicar
                      </Button>
                    }
                  />
                </>
              ) : (
                <div className="grid flex-1 place-items-center text-center">
                  <div className="max-w-sm">
                    <MousePointerClickIcon className="mx-auto size-8 text-muted-foreground" />
                    <p className="mt-3 font-medium">Selecione um elemento na página</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Feche esta janela, clique no elemento que quer editar (ou escolha nas Camadas) e abra o código de
                      novo.
                    </p>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* 2. CSS da página */}
            <TabsContent value="css" className="flex min-h-0 flex-1 flex-col gap-3 px-5 pt-3 pb-5">
              <Note tone="warning">
                Aqui ficam só os estilos feitos no editor. Em páginas clonadas, o CSS original continua num arquivo à
                parte (não aparece aqui) e o que você escrever aqui vale por cima dele. @import não funciona aqui: para
                fontes e arquivos CSS de fora, use a aba “Códigos da página”.
              </Note>
              <div className="min-h-0 flex-1">
                <CodeEditor
                  value={cssValue}
                  onChange={(v) => {
                    setCssValue(v);
                    setCssError(null);
                  }}
                  language="css"
                  dark={dark}
                  onSubmit={applyCss}
                  label="CSS da página"
                  placeholder="/* Ex.: .meu-botao { background: #16a34a; } */"
                />
              </div>
              {cssError && (
                <p role="alert" className="text-sm text-destructive">
                  {cssError}
                </p>
              )}
              <Footer
                hint={APPLY_HINT}
                onCancel={requestClose}
                action={
                  <Button onClick={applyCss} disabled={!cssDirty}>
                    Aplicar
                  </Button>
                }
              />
            </TabsContent>

            {/* 3. Códigos da página */}
            <TabsContent value="page" className="flex min-h-0 flex-1 flex-col gap-3 px-5 pt-3 pb-5">
              <Note>
                Estes códigos só rodam na prévia e na página publicada (ZIP) — nunca aqui no editor. Valem para esta
                página em todas as versões e dispositivos.
              </Note>
              {code ? (
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
                  <section className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <label htmlFor="os-page-code-category" className="font-medium text-sm">
                        Quando estes códigos carregam
                      </label>
                      <Select value={category} onValueChange={(v) => setCategory(v as CategoryChoice)}>
                        <SelectTrigger id="os-page-code-category" size="sm" className="w-80 max-w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={AUTO_CATEGORY}>Automático (pixel espera o “Aceitar”)</SelectItem>
                          {CODE_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {CODE_CATEGORY_LABEL[c]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {category === "NECESSARY" && trackers.length > 0 ? (
                      <Note tone="warning">
                        {necessaryTrackerWarning(trackers)} Escolha “Automático” ou “Marketing” para ele esperar o
                        consentimento do aviso de cookies.
                      </Note>
                    ) : category === AUTO_CATEGORY && !trackers.length && unknownScripts.length ? (
                      <Note tone="warning">
                        <span data-testid="page-code-unknown-scripts">
                          Sem pixel conhecido: carrega sempre. {unknownScriptHint(unknownScripts)}
                        </span>
                      </Note>
                    ) : (
                      <p className="text-xs text-muted-foreground" data-testid="page-code-category-help">
                        {category === AUTO_CATEGORY
                          ? trackers.length
                            ? `Este código tem ${joinTrackerNames(trackers)}: ele só carrega depois que o visitante aceitar os cookies (Marketing).`
                            : "Sem pixel ou tag de anúncio: carrega sempre. Se tiver, espera o “Aceitar” do aviso de cookies."
                          : category === "NECESSARY"
                            ? "Carrega sempre, sem esperar o aviso de cookies (chats de suporte, fontes…)."
                            : "Só carrega depois que o visitante aceitar os cookies no aviso."}
                      </p>
                    )}
                  </section>
                  {PAGE_CODE_SLOTS.map((slot) => (
                    <section key={slot.field} className="flex flex-col gap-1.5">
                      <div>
                        <h3 className="font-medium font-mono text-sm">{slot.title}</h3>
                        <p className="text-xs text-muted-foreground">{slot.hint}</p>
                      </div>
                      <div className="h-36 shrink-0">
                        <CodeEditor
                          value={code[slot.field]}
                          onChange={(v) => setCode((prev) => (prev ? { ...prev, [slot.field]: v } : prev))}
                          language="html"
                          dark={dark}
                          onSubmit={() => void saveCodes()}
                          label={`Código ${slot.title}`}
                          placeholder={slot.placeholder}
                        />
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="grid flex-1 place-items-center">
                  {loadCode.pending ? (
                    <Spinner className="size-6 text-primary" />
                  ) : (
                    <p className="text-sm text-muted-foreground">Não foi possível carregar os códigos desta página.</p>
                  )}
                </div>
              )}
              <Footer
                hint={
                  code ? (
                    <span className={cn(codeTooBig && "font-medium text-destructive")}>
                      {formatSize(codeBytes)} de {formatSize(PAGE_CODE_MAX_BYTES)}
                      {codeTooBig && " — diminua o código para salvar"}
                    </span>
                  ) : null
                }
                onCancel={requestClose}
                action={
                  <Button onClick={() => void saveCodes()} disabled={!codeDirty || codeTooBig || saveCode.pending}>
                    {saveCode.pending && <Spinner />}
                    Salvar códigos
                  </Button>
                }
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar as alterações no código?</AlertDialogTitle>
            <AlertDialogDescription>
              Há mudanças que ainda não foram aplicadas nem salvas. Se fechar agora, elas se perdem.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmClose(false);
                onOpenChange(false);
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const APPLY_HINT = (
  <>
    <Kbd>⌘</Kbd> <Kbd>Enter</Kbd> aplica
  </>
);

function Footer({ hint, onCancel, action }: { hint?: React.ReactNode; onCancel: () => void; action: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel}>
          Fechar
        </Button>
        {action}
      </div>
    </div>
  );
}
