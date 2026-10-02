/**
 * Tipos de configuração (traits) extras do painel "Configurações" e atalhos
 * para montar as listas de configurações dos widgets.
 *
 * - os-textarea: texto de várias linhas (lista de nomes, código de incorporação)
 * - os-datetime: data e hora (contador com data fixa)
 * - os-check: liga/desliga que grava "1"/"0" e entende padrão ligado
 * - os-heading: título de grupo (só visual)
 * - select com `osOptions`: opções vindas da oferta (links, páginas do funil),
 *   atualizadas sempre que o elemento é selecionado.
 *
 * Atenção: o GrapesJS troca "-" por espaço nos rótulos; por isso "e‑mail" usa
 * o hífen inseparável (U+2011).
 */
import type { Component, Editor, Trait, TraitProperties } from "grapesjs";
import { esc, type Style } from "@/editor/blocks/shared";
import { newLinkOption } from "@/editor/grapes/new-link";
import { widgetContext } from "./context";
import { attr, baseStyle, descendants, setBaseStyle } from "./dom";

export type TraitDef = Partial<TraitProperties> & {
  /** Opções dinâmicas: "links", "links:WHATSAPP", "pages". */
  osOptions?: string;
  /** Primeira opção da lista dinâmica (valor ""). */
  osEmpty?: string;
  rows?: number;
};

/** Propriedade extra de um trait (rows, osOptions…), fora da tipagem do GrapesJS. */
function prop(trait: Trait, key: keyof TraitDef): unknown {
  return (trait.attributes as Record<string, unknown>)[key];
}

const FIELD_STYLE =
  "width:100%;box-sizing:border-box;background:transparent;border:0;outline:0;color:inherit;font:inherit;padding:6px 8px;";

export function registerTraitTypes(editor: Editor) {
  const tm = editor.Traits;

  tm.addType("os-textarea", {
    createInput({ trait }: { trait: Trait }) {
      const t = document.createElement("textarea");
      t.rows = Number(prop(trait, "rows") ?? 5);
      t.placeholder = String(prop(trait, "placeholder") ?? "");
      t.spellcheck = false;
      t.style.cssText = `${FIELD_STYLE}min-height:90px;resize:vertical;line-height:1.45;`;
      return t;
    },
    onUpdate({ elInput, trait }: { elInput: HTMLInputElement; trait: Trait }) {
      elInput.value = String(trait.getValue() ?? "");
    },
  });

  tm.addType("os-datetime", {
    createInput() {
      const input = document.createElement("input");
      input.type = "datetime-local";
      input.style.cssText = FIELD_STYLE;
      return input;
    },
    onUpdate({ elInput, trait }: { elInput: HTMLInputElement; trait: Trait }) {
      elInput.value = String(trait.getValue() ?? "");
    },
  });

  tm.addType<{ init(): void; onChange(): void }>("os-check", {
    init() {
      // O ícone do checkbox do GrapesJS precisa vir logo depois do <input>.
      this.appendInput = false;
    },
    templateInput() {
      const p = this.ppfx;
      return `<label class="${p}field ${p}field-checkbox" data-input><i class="${p}chk-icon"></i></label>`;
    },
    createInput() {
      const input = document.createElement("input");
      input.type = "checkbox";
      return input;
    },
    onChange() {
      this.model.setValue(this.getInputElem().checked);
    },
    onUpdate({ elInput, trait }: { elInput: HTMLInputElement; trait: Trait }) {
      elInput.checked = trait.getValue() === true;
    },
  });

  tm.addType("os-heading", {
    noLabel: true,
    templateInput: () => "",
    createInput({ trait }: { trait: Trait }) {
      const div = document.createElement("div");
      div.textContent = String(prop(trait, "label") ?? "");
      div.style.cssText =
        "margin:14px 0 2px;padding-top:10px;border-top:1px solid var(--border,#e5e7eb);font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;opacity:.7;";
      return div;
    },
  });

  // Listas que dependem da oferta (links e páginas) são refeitas a cada seleção.
  editor.on("component:selected", (component: Component) => refreshOptions(editor, component));
}

export function refreshOptions(editor: Editor, component: Component) {
  const ctx = widgetContext(editor);
  for (const trait of component.getTraits()) {
    const source = prop(trait, "osOptions") as string | undefined;
    if (!source) continue;
    const empty = { id: "", label: String(prop(trait, "osEmpty") ?? "— nenhum —") };
    let options: { id: string; label: string }[];
    if (source === "pages") {
      options = ctx.pages.map((p) => ({ id: p.id, label: esc(p.name) }));
    } else {
      const kind = source.split(":")[1];
      const links = kind ? ctx.links.filter((l) => l.kind === kind) : ctx.links;
      options = links.map((l) => ({ id: l.key, label: esc(l.label) }));
      // Mantém visível uma chave que não existe mais (link apagado).
      const current = String(trait.getValue() ?? "");
      if (current && !options.some((o) => o.id === current))
        options.push({ id: current, label: `${esc(current)} (removido)` });
      options.push(newLinkOption);
    }
    trait.set("options", [empty, ...options]);
  }
}

// ─── Atalhos para montar traits ──────────────────────────────────────────────

export const heading = (label: string, id: string): TraitDef => ({ type: "os-heading", name: `os-h-${id}`, label });

export const textAttr = (name: string, label: string, placeholder = ""): TraitDef => ({
  type: "text",
  name,
  label,
  placeholder,
});

export const numberAttr = (name: string, label: string, min = 0, max?: number, step = 1): TraitDef => ({
  type: "number",
  name,
  label,
  min,
  ...(max !== undefined && { max }),
  step,
});

export const selectAttr = (name: string, label: string, options: [string, string][]): TraitDef => ({
  type: "select",
  name,
  label,
  options: options.map(([id, text]) => ({ id, label: text })),
});

/** Liga/desliga gravado como data-os-*="1"/"0" (sem atributo = padrão). */
export const checkAttr = (name: string, label: string, def: boolean): TraitDef => ({
  type: "os-check",
  name,
  label,
  getValue: ({ component }) => {
    const v = attr(component, name);
    return v ? !/^(0|false)$/i.test(v) : def;
  },
  setValue: ({ component, value }) => {
    component.addAttributes({ [name]: value ? "1" : "0" });
  },
});

/**
 * Cor (ou outra propriedade CSS) aplicada a partes do widget: lê da primeira
 * parte encontrada e grava em todas. O valor vai para o estilo base (vale em
 * todos os aparelhos) e continua editável no painel Estilo.
 */
export function partStyle(
  name: string,
  label: string,
  test: (c: Component) => boolean,
  prop: string,
  type = "color",
): TraitDef {
  return {
    type,
    name,
    label,
    getValue: ({ editor, component }) => {
      const part = test(component) ? component : descendants(component, test)[0];
      return part ? (baseStyle(editor, part)[prop] ?? "") : "";
    },
    setValue: ({ editor, component, value }) => {
      const parts = test(component) ? [component] : descendants(component, test);
      const style: Style = { [prop]: String(value ?? "") };
      for (const part of parts) setBaseStyle(editor, part, style);
    },
  };
}
