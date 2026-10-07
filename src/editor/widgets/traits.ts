/**
 * Tipos de configuração (traits) extras do painel "Configurações" e atalhos
 * para montar as listas de configurações dos widgets.
 *
 * - os-textarea: texto de várias linhas (lista de nomes, código de incorporação)
 * - os-datetime: data e hora (contador com data fixa)
 * - os-check: liga/desliga que grava "1"/"0" e entende padrão ligado
 * - os-heading: título de grupo (só visual)
 * - os-note: explicação curta (só visual; o texto vem do label)
 * - os-color: cor (amostra + código). Não usa o campo de cor do GrapesJS, que
 *   regrava o último valor ao selecionar outro elemento (o Desfazer se perdia e
 *   entravam mudanças invisíveis na pilha) e transformava um nome que ele não
 *   conhece ("vermelho") em preto: aqui cor não reconhecida não muda nada e o
 *   campo avisa.
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

  tm.addType<{ onChange(e: Event): void; setInputValue(): void }>("os-color", {
    createInput({ trait }: { trait: Trait }) {
      const box = document.createElement("div");
      box.style.cssText = "padding:2px 4px;";
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:6px;";
      const swatch = document.createElement("input");
      swatch.type = "color";
      swatch.setAttribute("data-os-swatch", "");
      swatch.setAttribute("aria-label", `${String(prop(trait, "label") ?? "Cor")}: escolher na paleta`);
      swatch.style.cssText = "flex:none;width:28px;height:24px;padding:0;border:0;background:none;cursor:pointer;";
      const text = document.createElement("input");
      text.type = "text";
      text.spellcheck = false;
      text.placeholder = "#e11d48";
      text.setAttribute("data-os-color", "");
      text.setAttribute("aria-label", String(prop(trait, "label") ?? "Cor"));
      text.style.cssText = `${FIELD_STYLE}flex:1;min-width:0;padding-left:2px;`;
      const err = document.createElement("div");
      err.setAttribute("data-os-color-err", "");
      err.setAttribute("role", "alert");
      err.style.cssText = "display:none;margin-top:4px;color:#dc2626;font-size:11px;line-height:1.35;";
      row.append(swatch, text);
      box.append(row, err);
      return box;
    },
    // Os dois campos falam com o trait por aqui (o padrão leria .value do contêiner).
    onChange(e: Event) {
      const box = this.getInputElem() as HTMLElement;
      const swatch = box.querySelector<HTMLInputElement>("[data-os-swatch]");
      const text = box.querySelector<HTMLInputElement>("[data-os-color]");
      if (!swatch || !text) return;
      if (e.target === swatch) text.value = swatch.value;
      const value = text.value.trim();
      if (value && !colorOk(value)) {
        showColorError(box, "Cor não reconhecida — use o código, ex.: #e11d48");
        return;
      }
      showColorError(box, "");
      const trait = this.model;
      trait.setValue(value);
      // O valor guardado no trait acompanha (assim Desfazer/Refazer redesenham o campo).
      trait.set({ value: trait.getValue() }, { fromTarget: 1 });
      paintColor(box, String(trait.getValue() ?? ""));
    },
    setInputValue() {
      // o onUpdate redesenha os dois campos
    },
    onUpdate({ elInput, trait }: { elInput: HTMLElement; trait: Trait }) {
      showColorError(elInput, "");
      paintColor(elInput, String(trait.getValue() ?? ""));
    },
  });

  tm.addType("os-note", {
    noLabel: true,
    templateInput: () => "",
    createInput({ trait }: { trait: Trait }) {
      const p = document.createElement("p");
      p.textContent = String(prop(trait, "label") ?? "");
      p.style.cssText = "margin:4px 0 8px;font-size:12px;line-height:1.45;opacity:.8;";
      return p;
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

  // Desfazer/Refazer: campos com leitura própria (cores, destino do quiz…) não
  // ouvem o que mudou (CSS, outro elemento) e mostrariam o valor desfeito.
  editor.on("undo redo", () => {
    for (const trait of editor.getSelected()?.getTraits() ?? []) {
      if (!prop(trait, "getValue")) continue;
      trait.targetUpdated();
      (trait.view as unknown as { postUpdate?: () => void } | undefined)?.postUpdate?.();
    }
  });
}

/** Cor que o navegador entende (#hex, rgb(), nome em inglês, var()…). */
function colorOk(value: string): boolean {
  try {
    return CSS.supports("color", value);
  } catch {
    return /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
  }
}

/** #rrggbb da cor (para a amostra), ou null. */
function toHex(value: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#010203";
    ctx.fillStyle = value;
    const out = String(ctx.fillStyle);
    return /^#[0-9a-f]{6}$/i.test(out) && (out !== "#010203" || value === "#010203") ? out : null;
  } catch {
    return null;
  }
}

function paintColor(box: HTMLElement, value: string) {
  const swatch = box.querySelector<HTMLInputElement>("[data-os-swatch]");
  const text = box.querySelector<HTMLInputElement>("[data-os-color]");
  if (text) text.value = value;
  const hex = toHex(value);
  if (swatch && hex) swatch.value = hex;
}

function showColorError(box: HTMLElement, message: string) {
  const text = box.querySelector<HTMLInputElement>("[data-os-color]");
  const err = box.querySelector<HTMLElement>("[data-os-color-err]");
  if (message) text?.setAttribute("aria-invalid", "true");
  else text?.removeAttribute("aria-invalid");
  if (err) {
    err.textContent = message;
    err.style.display = message ? "block" : "none";
  }
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
      options = links.map((l) => ({
        id: l.key,
        label: l.payment ? `${esc(l.label)} · Pagamento na página` : esc(l.label),
      }));
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
  type = "os-color",
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
