/**
 * Valores atuais no painel de estilo.
 *
 * O CSS original (modelos e páginas clonadas) fica fora do GrapesJS, então os
 * campos mostravam "padrão" em vez do tamanho, cor e espessura que o elemento
 * tem de verdade. Aqui, quando a propriedade não tem valor próprio, o campo
 * mostra o valor atual do elemento no canvas como dica (placeholder) — e, nas
 * listas, a opção "Padrão" diz qual é (ex.: "Padrão · Negrito (700)"). Nada é
 * gravado: só muda o que se vê.
 */
import type { Editor } from "grapesjs";
import { editorTimeout, watchEditor } from "./lifecycle";

interface PropertyLike {
  getId(): string;
  getName(): string;
  getType(): string;
  hasValue(opts?: { noParent?: boolean }): boolean;
  isVisible(): boolean;
  get(key: string): unknown;
  /** Partes de uma propriedade composta (margin → margin-top…). */
  getProperties?(): PropertyLike[];
  view?: { el?: HTMLElement } | null;
}

const ORIGINAL = "osHintOriginal";
/** Tipos sem um campo único (o valor atual não cabe numa dica). */
const SKIP_TYPES = new Set(["composite", "stack", "radio", "file"]);

function round(n: number) {
  return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

function hex(part: number) {
  return Math.max(0, Math.min(255, Math.round(part)))
    .toString(16)
    .padStart(2, "0");
}

/** Valor calculado em formato de gente: 36.288px → 36.3px, rgb(17, 24, 39) → #111827. */
export function friendlyValue(prop: string, value: string): string {
  const v = value.trim();
  if (!v) return "";
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(v);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? Number.parseFloat(rgb[4]) / 100 : Number(rgb[4]);
    if (alpha === 0) return /background/.test(prop) ? "" : "transparente";
    const color = `#${hex(Number(rgb[1]))}${hex(Number(rgb[2]))}${hex(Number(rgb[3]))}`;
    return alpha < 1 ? `${color} (${Math.round(alpha * 100)}%)` : color;
  }
  // Palavras do CSS em português (o painel é todo em pt-BR).
  if (v === "none") return prop.startsWith("max-") ? "sem limite" : "nenhum";
  if (v === "auto") return "automático";
  if (v === "normal") return "normal";
  if (/^[a-z-]+$/i.test(v) && !/^\d/.test(v)) return "";
  return v.replace(/(-?\d*\.?\d+)px\b/g, (_, n: string) => `${round(Number(n))}px`);
}

function computedOf(editor: Editor): CSSStyleDeclaration | null {
  const el = editor.getSelected()?.getEl();
  const win = el?.ownerDocument?.defaultView;
  if (!el || !win || el.ownerDocument !== editor.Canvas.getDocument()) return null;
  return win.getComputedStyle(el);
}

function inputOf(prop: PropertyLike): HTMLInputElement | null {
  return (
    prop.view?.el?.querySelector<HTMLInputElement>(
      "input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range])",
    ) ?? null
  );
}

function hintInput(prop: PropertyLike, computed: CSSStyleDeclaration | null) {
  const input = inputOf(prop);
  if (!input) return;
  if (input.dataset[ORIGINAL] === undefined) input.dataset[ORIGINAL] = input.getAttribute("placeholder") ?? "";
  const original = input.dataset[ORIGINAL] ?? "";
  // O valor calculado do elemento no canvas (uma parte de um atalho, como
  // padding-top, também: é o que vale para ela).
  const current =
    computed && !prop.hasValue() ? friendlyValue(prop.getName(), computed.getPropertyValue(prop.getName())) : "";
  const next = current || original;
  if (input.getAttribute("placeholder") !== next) input.setAttribute("placeholder", next);
}

function hintSelect(prop: PropertyLike, computed: CSSStyleDeclaration | null) {
  const select = prop.view?.el?.querySelector("select");
  const empty = select?.querySelector<HTMLOptionElement>('option[value=""]');
  if (!select || !empty) return;
  if (empty.dataset[ORIGINAL] === undefined) empty.dataset[ORIGINAL] = empty.textContent ?? "";
  const original = empty.dataset[ORIGINAL] ?? "";
  let text = original;
  const value = computed?.getPropertyValue(prop.getName()).trim() ?? "";
  if (value && !prop.hasValue()) {
    const options = Array.from(select.options);
    const same = options.find((o) => o.value && o.value === value);
    // Fonte: o primeiro nome da lista de fontes do elemento.
    const shown =
      same?.textContent?.replace(/\s*·.*$/, "").trim() ||
      (prop.getName() === "font-family" ? value.split(",")[0].replace(/["']/g, "").trim() : "");
    if (shown) text = `${original} · ${shown}`;
  }
  if (empty.textContent !== text) empty.textContent = text;
}

function hintProperty(p: PropertyLike, computed: CSSStyleDeclaration | null) {
  const type = p.getType();
  if (type === "composite") {
    // Espaçamento (margin, padding), borda…: cada parte mostra o valor dela (padding-top…).
    for (const sub of p.getProperties?.() ?? []) hintProperty(sub, computed);
    return;
  }
  if (SKIP_TYPES.has(type) || !p.view?.el) return;
  if (type === "select") hintSelect(p, computed);
  else hintInput(p, computed);
}

export function refreshStyleHints(editor: Editor) {
  const computed = computedOf(editor);
  for (const sector of editor.StyleManager.getSectors()) {
    for (const p of sector.getProperties() as unknown as PropertyLike[]) hintProperty(p, computed);
  }
}

/** Liga as dicas ao editor (seleção, dispositivo, edições, desfazer). */
export function installStyleHints(editor: Editor) {
  watchEditor(editor);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    // Depois do GrapesJS atualizar os campos e o canvas redesenhar.
    timer = editorTimeout(
      editor,
      () => {
        timer = undefined;
        refreshStyleHints(editor);
      },
      60,
    );
  };
  editor.on(
    // frame:updated: depois que a moldura termina de mudar de largura (troca de dispositivo).
    "component:toggled style:target styleable:change change:device frame:updated undo redo style:property:update canvas:frame:load:body",
    schedule,
  );
  editor.on("destroy", () => timer && clearTimeout(timer));
}
