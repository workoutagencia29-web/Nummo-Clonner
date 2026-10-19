/** Utilitários para navegar e estilizar componentes do GrapesJS. */
import type { Component, Editor } from "grapesjs";
import type { Style } from "@/editor/blocks/shared";

/** Descendentes (em profundidade) que passam no teste. */
export function descendants(root: Component, test: (c: Component) => boolean): Component[] {
  const out: Component[] = [];
  const walk = (c: Component) => {
    for (const child of c.components().models) {
      if (test(child)) out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

export const hasClass = (cls: string) => (c: Component) => c.getClasses().includes(cls);

export const hasAttr = (name: string, value?: string) => (c: Component) => {
  const v = c.getAttributes()[name];
  return value === undefined ? v !== undefined : String(v) === value;
};

/** Estilo "base" (sem media query e sem estado) de um componente. */
export function baseStyle(editor: Editor, c: Component): Style {
  const rule = editor.Css.getIdRule(c.getId(), { mediaText: "", state: "" });
  return { ...((rule?.getStyle() ?? {}) as Style) };
}

/** Mescla no estilo base (valor "" apaga a propriedade). Vale para todos os aparelhos. */
export function setBaseStyle(editor: Editor, c: Component, style: Style) {
  const next = baseStyle(editor, c);
  for (const [k, v] of Object.entries(style)) {
    if (v === "") delete next[k];
    else next[k] = v;
  }
  editor.Css.setIdRule(c.getId(), next, { mediaText: "", state: "" });
}

/** Troca o texto de um componente (e dos filhos) por texto simples. */
export function setText(c: Component, value: string) {
  const safe = value.replace(/[&<>]/g, (ch) => `&#${ch.charCodeAt(0)};`);
  if (c.components().length) c.components(safe);
  else c.set("content", safe);
}

/** Texto curto de uma linha, sem tags (o que se digita num campo das Configurações). */
export const cleanText = (value: unknown, max = 120) =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export function attr(c: Component, name: string): string {
  const v = c.getAttributes()[name];
  return v === undefined || v === null || v === false ? "" : String(v);
}

/** Estados (":hover"…) e pseudoelementos: saem do seletor para saber a que elemento a regra se aplica. */
export const DYNAMIC_PSEUDO =
  /::?(?:hover|focus-visible|focus-within|focus|active|visited|link|target|checked|disabled|enabled|placeholder-shown|before|after|placeholder|selection|marker|first-line|first-letter|-webkit-[\w-]+|-moz-[\w-]+)(?![\w-])/gi;

/** Partes de uma lista de seletores ("a, b:is(c, d)" → "a", "b:is(c, d)"). */
export function selectorParts(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth > 0) depth--;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * CSS das regras do editor que são do componente: valem para ele ou para algo
 * dentro dele e para nada fora dele (com as de estado, como ":hover", e as de
 * celular), na ordem em que o editor as grava na página. Regras da página toda
 * ("*", "a", "img") ou que também pegam outros elementos ficam de fora. Serve
 * para levar um elemento com o visual dele para outra página (ex.: o cabeçalho
 * da loja nas páginas de produto).
 */
export function componentCss(editor: Editor, component: Component): string {
  const el = component.getEl();
  const doc = el?.ownerDocument;
  if (!el || !doc) return "";
  const own = (selector: string) => {
    let hit = false;
    for (const part of selectorParts(selector)) {
      const sel = part.replace(DYNAMIC_PSEUDO, "").trim();
      if (!sel) continue;
      try {
        if (!el.matches(sel) && !el.querySelector(sel)) continue;
        for (const node of doc.querySelectorAll(sel)) if (node !== el && !el.contains(node)) return false;
        hit = true;
      } catch {
        // seletor que o navegador não entende: não é deste elemento
      }
    }
    return hit;
  };
  const rules = editor.Css.getRules().filter((rule) => own(rule.selectorsToString()));
  if (!rules.length) return "";
  // O gerador do próprio editor: mesma ordem (regras de tela por último) e mesmo formato da página.
  return String(editor.getCss({ component, rules, keepUnusedStyles: true, avoidProtected: true } as never) ?? "");
}
