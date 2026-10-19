/**
 * Round-trip do HTML de um elemento entre o editor e o HTML "de verdade", sem
 * React nem código de servidor (para o editor de código, o clipboard entre
 * páginas e os testes poderem usar sem puxar o painel inteiro).
 *
 * Mesma convenção de src/lib/editor-html.ts: no editor, <script> vira <os-script>
 * (inerte), <noscript> vira <os-noscript> (conteúdo como texto), on* vira
 * data-os-on-* e valores "javascript:…" viram data-os-js-*. `toReadableHtml`
 * mostra a versão de verdade; `toEditorHtml` converte de volta para o editor.
 * (Não importa editor-html: ele puxa cheerio e css-tree.)
 */
import type { Component, Editor } from "grapesjs";
import { DUP_ID_ATTR, EID_ATTR } from "@/lib/dup-ids";

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

export function parseFragment(html: string, doc: Document) {
  const template = doc.createElement("template");
  template.innerHTML = html;
  return template;
}

/** Id do editor do repetido de `pageId` com a marca `eid`, ou null. */
export type DupResolver = (pageId: string, eid: string) => string | null;

export function dupResolver(editor: Editor): DupResolver {
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
export function keepReferencedMarks(editor: Editor) {
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

/** Roda `run` como uma única ação de desfazer (o editor junta tudo num passo). */
export function asSingleUndoStep<T>(editor: Editor, run: () => T): T {
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
