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

export function attr(c: Component, name: string): string {
  const v = c.getAttributes()[name];
  return v === undefined || v === null || v === false ? "" : String(v);
}
