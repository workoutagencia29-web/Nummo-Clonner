/**
 * Contador regressivo (data-os-widget="countdown"), em dois estilos:
 *
 * - "Contagem no topo (barra)" (data-os-cd-style="bar", tipo os-countdown-bar):
 *   barra fina preta de ponta a ponta com a frase, "TERMINA EM" e o tempo em
 *   caixinhas (00 : 14 : 46). Na página fica fixa no topo ao rolar
 *   (data-os-sticky, ligada por padrão; src/runtime/widgets/top.ts).
 * - "Caixas grandes" (sem o atributo, tipo os-countdown): título e caixas com
 *   HORAS/MIN/SEG.
 *
 * "Estilo" nas Configurações troca um pelo outro (convertCountdown) mantendo a
 * contagem, o "Ao zerar", os textos que dá para levar e as cores trocadas.
 * No editor mostra um tempo de exemplo parado (conforme as configurações); na
 * página ele conta de verdade (src/runtime/widgets/countdown.ts).
 */
import type { Component, Editor } from "grapesjs";
import { type Def, el, onMobile, type Style, text } from "@/editor/blocks/shared";
import { editorTimeout } from "@/editor/grapes/lifecycle";
import { BAR_COLORS, BAR_SIZES, BAR_TEXTS } from "@/lib/countdown-bar";
import { pad2, parseDeadline, splitTime } from "@/runtime/widgets/options";
import { attr, baseStyle, descendants, hasAttr, hasClass, setText } from "./dom";
import { checkAttr, heading, numberAttr, partStyle, selectAttr, type TraitDef, textAttr } from "./traits";

const UNITS = [
  ["d", "dias"],
  ["h", "horas"],
  ["m", "min"],
  ["s", "seg"],
] as const;

export const CD_STYLE_ATTR = "data-os-cd-style";
export type CountdownStyle = "bar" | "boxes";

/** Contador no estilo "Barra no topo". */
export const isCountdownBar = (c: Component) =>
  attr(c, "data-os-widget") === "countdown" && attr(c, CD_STYLE_ATTR) === "bar";

/** Tempo de exemplo mostrado no editor para as configurações atuais. */
export function countdownSample(attrs: Record<string, string>, now = Date.now()) {
  const minutes = Number(attrs["data-os-minutes"]) || 15;
  let ms = minutes * 60000;
  if (attrs["data-os-mode"] === "date") {
    const end = parseDeadline(attrs["data-os-until"] ?? "");
    if (end) ms = Math.max(0, end - now);
  }
  const t = splitTime(ms);
  return { ...t, showDays: t.d > 0 };
}

function refreshSample(component: Component) {
  const attrs: Record<string, string> = {};
  for (const name of ["data-os-mode", "data-os-minutes", "data-os-until"]) attrs[name] = attr(component, name);
  const sample = countdownSample(attrs);
  for (const [unit] of UNITS) {
    const num = descendants(component, hasAttr("data-os-cd", unit))[0];
    const value = pad2(sample[unit]);
    if (num && num.getInnerHTML() !== value) setText(num, value);
  }
  const days = sample.showDays ? "1" : "0";
  if (attr(component, "data-os-cd-days") !== days) component.addAttributes({ "data-os-cd-days": days });
}

// ─── Configurações ───────────────────────────────────────────────────────────

const styleTrait: TraitDef = {
  type: "select",
  name: "os-cd-style",
  label: "Estilo",
  options: [
    { id: "bar", label: "Barra no topo" },
    { id: "boxes", label: "Caixas grandes" },
  ],
  getValue: ({ component }) => (isCountdownBar(component) ? "bar" : "boxes"),
  setValue: ({ editor, component, value }) => {
    // Depois do clique: o painel de Configurações é refeito para o elemento novo.
    editorTimeout(editor, () => convertCountdown(editor, component, value === "bar" ? "bar" : "boxes"));
  },
};

const COUNT_TRAITS: TraitDef[] = [
  heading("Contagem", "cd-contagem"),
  selectAttr("data-os-mode", "Tipo de contagem", [
    ["evergreen", "Minutos para cada visitante"],
    ["date", "Até uma data e hora fixa"],
  ]),
  numberAttr("data-os-minutes", "Minutos (para cada visitante)", 1, 525600),
  { type: "os-datetime", name: "data-os-until", label: "Termina em (horário de Brasília)" },
  heading("Quando zerar", "cd-fim"),
  selectAttr("data-os-expired", "Ao zerar", [
    ["zero", "Fica em 00:00:00"],
    ["hide", "Esconde o contador"],
    ["text", "Mostra um texto"],
    ["restart", "Recomeça a contagem"],
  ]),
  textAttr("data-os-expired-text", "Texto ao zerar", "Oferta encerrada."),
];

const TRAITS: TraitDef[] = [
  styleTrait,
  ...COUNT_TRAITS,
  heading("Cores", "cd-cores"),
  partStyle("os-cd-bg", "Fundo dos números", hasClass("os-cd-unit"), "background-color"),
  partStyle("os-cd-color", "Cor dos números", hasClass("os-cd-unit"), "color"),
];

const isRoot = (c: Component) => attr(c, "data-os-widget") === "countdown";
const isBox = hasClass("os-cdb-box");

const BAR_TRAITS: TraitDef[] = [
  styleTrait,
  checkAttr("data-os-sticky", "Fixa no topo ao rolar", true),
  {
    type: "os-note",
    name: "os-cdb-note",
    label:
      "Ligada: na página, a barra fica presa no topo enquanto a pessoa rola, sem cobrir o começo da página. Desligada: fica no lugar onde está. Dentro de um bloco que aparece depois (atraso, popup, quiz), ela fica no lugar e aparece junto com ele.",
  },
  ...COUNT_TRAITS,
  heading("Cores", "cdb-cores"),
  partStyle("os-cdb-bg", "Fundo da barra", isRoot, "background-color"),
  partStyle("os-cdb-text", "Cor do texto", isRoot, "color"),
  partStyle("os-cdb-box-bg", "Fundo das caixinhas", isBox, "background-color"),
  partStyle("os-cdb-box-border", "Borda das caixinhas", isBox, "border-color"),
  partStyle("os-cdb-num", "Cor dos números", isBox, "color"),
];

/**
 * CSS da página (vira regra do projeto, como o dos botões): a caixa "dias" já
 * nasce escondida quando falta menos de um dia — sem isso ela aparece com "00
 * dias" até o script rodar e os números pulam de lugar. O script só troca o
 * data-os-cd-days. (!important: o estilo da caixa é uma regra #id com display.)
 */
export const COUNTDOWN_CSS =
  '[data-os-widget=countdown][data-os-cd-days="0"] [data-os-cd-unit=d]{display:none!important}';

const SAMPLE_EVENTS =
  "change:attributes:data-os-mode change:attributes:data-os-minutes change:attributes:data-os-until";

/** Contador antigo ⇄ novo de cada troca de estilo (para o Desfazer/Refazer selecionar o que voltou). */
const swapped = new WeakMap<Component, Component>();
/**
 * Id de cada contador da troca. O novo nasce com o id do antigo (links #id e
 * regras #id); no Desfazer, o GrapesJS devolve o antigo enquanto o id ainda
 * está registrado e o renomeia ("oferta-2"), largando as regras #oferta. O
 * Desfazer/Refazer devolve o id certo (e as regras voltam a valer).
 */
const swappedId = new WeakMap<Component, string>();

/** Títulos dos modelos postos fora do contador (sem mudança, não viram a frase da barra). */
const TEMPLATE_TITLES = new Set(["Esta condição termina em:", "Esta oferta expira em:"]);

/** Texto sem tags nem espaços sobrando. */
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function inPage(editor: Editor, c: Component) {
  let top = c;
  while (top.parent()) top = top.parent() as Component;
  return top === editor.getWrapper();
}

export function registerCountdownType(editor: Editor) {
  // Desfazer/Refazer uma troca de estilo: o painel passa para o contador que
  // ficou na página (sem isso continuaria no que saiu, com campos vazios).
  editor.on("undo redo", () => {
    const wrapper = editor.getWrapper();
    for (const c of wrapper?.find('[data-os-widget="countdown"]') ?? []) {
      const want = swappedId.get(c);
      if (!want || c.getId() === want || wrapper?.find(`#${CSS.escape(want)}`).length) continue;
      editor.UndoManager.skip(() => c.setId(want));
    }
    const sel = editor.getSelected();
    const other = sel && swapped.get(sel);
    if (sel && other && !inPage(editor, sel) && inPage(editor, other)) editor.select(other);
  });
  editor.DomComponents.addType("os-countdown", {
    isComponent: (node) =>
      node.getAttribute?.("data-os-widget") === "countdown" && node.getAttribute(CD_STYLE_ATTR) !== "bar",
    model: {
      defaults: { name: "Contador regressivo", droppable: false, traits: TRAITS, styles: COUNTDOWN_CSS },
      init() {
        this.on(SAMPLE_EVENTS, () => refreshSample(this));
      },
    },
  });
  // Registrado depois: o GrapesJS confere os tipos do último para o primeiro.
  editor.DomComponents.addType("os-countdown-bar", {
    isComponent: (node) =>
      node.getAttribute?.("data-os-widget") === "countdown" && node.getAttribute(CD_STYLE_ATTR) === "bar",
    model: {
      defaults: { name: "Contagem no topo (barra)", droppable: false, traits: BAR_TRAITS, styles: COUNTDOWN_CSS },
      init() {
        this.on(SAMPLE_EVENTS, () => refreshSample(this));
      },
    },
  });
}

// ─── Caixas grandes ──────────────────────────────────────────────────────────

const BOX_DEFAULTS = { bg: "#111827", num: "#ffffff" };
const DEFAULT_TITLE = "⏰ Esta oferta especial termina em:";

const unitStyle: Style = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "center",
  "justify-content": "center",
  "min-width": "76px",
  padding: "12px 10px",
  "box-sizing": "border-box",
  "border-radius": "12px",
  "background-color": BOX_DEFAULTS.bg,
  color: BOX_DEFAULTS.num,
};

interface CountdownOptions {
  minutes?: number;
  label?: string;
  /** Atributos de contagem (data-os-mode, -minutes, -until, -expired…) e outros a manter. */
  attrs?: Record<string, string>;
}

function countAttrs(opts: CountdownOptions) {
  const attrs: Record<string, string> = {
    "data-os-widget": "countdown",
    "data-os-mode": "evergreen",
    "data-os-minutes": String(opts.minutes ?? 15),
    "data-os-expired": "zero",
    "data-os-expired-text": "Oferta encerrada.",
    ...opts.attrs,
  };
  const sample = countdownSample(attrs);
  attrs["data-os-cd-days"] = sample.showDays ? "1" : "0";
  return { attrs, sample };
}

/** Bloco "Contador regressivo" (caixas grandes; 15 minutos por visitante). */
export function countdownDef(opts: CountdownOptions & { colors?: { bg?: string; num?: string } } = {}): Def {
  const { attrs, sample } = countAttrs(opts);
  const units = UNITS.map(([unit, label]) =>
    onMobile(
      el(
        "div",
        `Caixa: ${label}`,
        {
          ...unitStyle,
          ...(opts.colors?.bg && { "background-color": opts.colors.bg }),
          ...(opts.colors?.num && { color: opts.colors.num }),
        },
        [
          el(
            "span",
            "Número",
            { "font-size": "38px", "font-weight": "800", "line-height": "1", "font-variant-numeric": "tabular-nums" },
            undefined,
            {
              attributes: { "data-os-cd": unit },
              content: pad2(sample[unit]),
              classes: ["os-cd-num"],
              editable: false,
            },
          ),
          text(
            "span",
            label,
            {
              "margin-top": "6px",
              "font-size": "12px",
              "font-weight": "600",
              "letter-spacing": "0.08em",
              "text-transform": "uppercase",
              opacity: "0.8",
            },
            { classes: ["os-cd-lbl"] },
          ),
        ],
        { classes: ["os-cd-unit"], attributes: { "data-os-cd-unit": unit }, droppable: false },
      ),
      { "min-width": "64px", padding: "10px 6px" },
    ),
  );
  return {
    type: "os-countdown",
    name: "Contador regressivo",
    attributes: attrs,
    style: {
      "text-align": "center",
      margin: "24px auto",
      padding: "0 12px",
      "max-width": "560px",
      "box-sizing": "border-box",
    },
    components: [
      text("p", opts.label ?? DEFAULT_TITLE, {
        margin: "0 0 12px",
        "font-size": "18px",
        "font-weight": "700",
        color: "#b91c1c",
      }),
      el("div", "Números", { display: "flex", gap: "10px", "justify-content": "center", "flex-wrap": "wrap" }, units, {
        attributes: { "data-os-cd-units": "", role: "timer", "aria-live": "off" },
        droppable: false,
      }),
    ],
  };
}

// ─── Contagem no topo (barra) ────────────────────────────────────────────────

export type BarColors = { [K in keyof typeof BAR_COLORS]: string };

/** Partes que não se selecionam sozinhas (grupo de cada unidade e o ":"). */
const fixedPart = { selectable: false, hoverable: false, layerable: false, droppable: false, draggable: false };

/**
 * Bloco "Contagem no topo (barra)": igual à barra que mais converte — preta,
 * frase em negrito, "TERMINA EM" e o tempo em caixinhas com borda dourada e
 * números amarelos. A caixa "dias" só aparece quando falta mais de um dia.
 */
export function countdownBarDef(
  opts: CountdownOptions & { msg?: string; colors?: Partial<BarColors>; sticky?: boolean } = {},
): Def {
  const { attrs, sample } = countAttrs({
    ...opts,
    attrs: { [CD_STYLE_ATTR]: "bar", "data-os-sticky": opts.sticky === false ? "0" : "1", ...opts.attrs },
  });
  const k: BarColors = { ...BAR_COLORS, ...opts.colors };
  const z = BAR_SIZES;
  const box = (unit: string) =>
    onMobile(
      el(
        "span",
        "Caixinha",
        {
          display: "inline-block",
          "min-width": z.boxW,
          padding: z.boxPad,
          "box-sizing": "border-box",
          "border-width": "1px",
          "border-style": "solid",
          "border-color": k.boxBorder,
          "border-radius": "6px",
          "background-color": k.boxBg,
          color: k.num,
          "font-size": z.num,
          "font-weight": z.weight,
          "line-height": "22px",
          "text-align": "center",
        },
        undefined,
        {
          attributes: { "data-os-cd": unit },
          content: pad2(sample[unit as "d"]),
          classes: ["os-cdb-box"],
          editable: false,
          droppable: false,
        },
      ),
      { "min-width": z.boxWMobile, padding: z.boxPadMobile, "font-size": z.numMobile, "line-height": "20px" },
    );
  const sep = (): Def =>
    el("span", "Separador", { "font-weight": z.weight, color: "inherit" }, undefined, {
      content: ":",
      classes: ["os-cdb-sep"],
      editable: false,
      ...fixedPart,
    });
  const groups = UNITS.map(([unit]) =>
    onMobile(
      el(
        "span",
        `Unidade: ${unit}`,
        { display: "flex", "align-items": "center", gap: z.sepGap },
        unit === "s" ? [box(unit)] : [box(unit), sep()],
        { classes: ["os-cdb-g"], attributes: { "data-os-cd-unit": unit }, ...fixedPart },
      ),
      { gap: z.sepGapMobile },
    ),
  );
  return onMobile(
    {
      type: "os-countdown-bar",
      name: "Contagem no topo (barra)",
      attributes: attrs,
      style: {
        display: "flex",
        "flex-wrap": "wrap",
        "align-items": "center",
        "justify-content": "center",
        gap: z.gap,
        width: "100%",
        margin: "0",
        padding: z.pad,
        "box-sizing": "border-box",
        "background-color": k.bg,
        color: k.text,
        "text-align": "center",
        "line-height": "1.3",
      },
      components: [
        onMobile(
          text(
            "p",
            opts.msg ?? BAR_TEXTS.msg,
            { margin: "0", "font-size": z.msg, "font-weight": z.weight, "line-height": "1.3", color: "inherit" },
            { name: "Frase", classes: ["os-cdb-msg"] },
          ),
          { "font-size": z.msgMobile },
        ),
        onMobile(
          el(
            "div",
            "Tempo",
            {
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              gap: z.sepGap,
              "white-space": "nowrap",
              "font-variant-numeric": "tabular-nums",
            },
            [
              onMobile(
                text(
                  "span",
                  opts.label ?? BAR_TEXTS.label,
                  {
                    "margin-right": "6px",
                    "font-size": z.label,
                    "font-weight": "600",
                    "letter-spacing": z.labelSpacing,
                    "text-transform": "uppercase",
                    color: "inherit",
                    opacity: "0.9",
                  },
                  { name: "Termina em", classes: ["os-cdb-lbl"] },
                ),
                { "margin-right": "2px", "font-size": z.labelMobile },
              ),
              ...groups,
            ],
            {
              classes: ["os-cdb-time"],
              attributes: { "data-os-cd-units": "", role: "timer", "aria-live": "off" },
              droppable: false,
            },
          ),
          { gap: z.sepGapMobile },
        ),
      ],
    },
    { gap: z.gapMobile, padding: z.padMobile },
  );
}

// ─── Troca de estilo ─────────────────────────────────────────────────────────

/** Atributos que cada estilo refaz (o resto — contagem, id, visibilidade… — vai junto). */
const STYLE_ATTRS = new Set(["class", "style", CD_STYLE_ATTR, "data-os-sticky", "data-os-cd-days", "data-os-widget"]);

const firstText = (root: Component, test: (c: Component) => boolean) => descendants(root, test)[0]?.getInnerHTML();

/** Valor de cor que o usuário trocou (diferente do padrão daquele estilo), ou undefined. */
function changedColor(editor: Editor, part: Component | undefined, prop: string, def: string) {
  const v = part ? baseStyle(editor, part)[prop] : "";
  return v && v.toLowerCase() !== def.toLowerCase() ? v : undefined;
}

/** Regras #id do elemento e de tudo dentro dele (todas as telas). */
function idRules(editor: Editor, root: Component) {
  return [root, ...root.find("*")].flatMap((c) => editor.Css.getRules(`#${c.getId()}`));
}

/**
 * Troca o contador de estilo (barra no topo ⇄ caixas grandes) no mesmo lugar,
 * numa ação só de desfazer. Vão juntos: a contagem e o "Ao zerar", o id e
 * outros atributos, a frase/título quando foi mudada e as cores trocadas das
 * caixas (fundo e números). Devolve o contador novo (já selecionado).
 */
export function convertCountdown(editor: Editor, comp: Component, to: CountdownStyle): Component | undefined {
  if (!isRoot(comp)) return;
  const bar = isCountdownBar(comp);
  if ((to === "bar") === bar) return comp;
  const parent = comp.parent();
  if (!parent) return;

  const keep: Record<string, string> = {};
  for (const [name, value] of Object.entries((comp.get("attributes") ?? {}) as Record<string, unknown>)) {
    if (!STYLE_ATTRS.has(name) && value !== undefined && value !== null && value !== false) keep[name] = String(value);
  }

  // Título dos modelos fora do contador (<p class="os-timer">"Esta condição
  // termina em:"</p> logo antes dele): na barra ficaria solto na seção, sem
  // contador embaixo. Sai junto; se foi mudado, vira a frase da barra.
  const index = comp.index();
  const before = index > 0 ? parent.components().at(index - 1) : undefined;
  const outerTitle = to === "bar" && before && hasClass("os-timer")(before) ? before : undefined;
  // Caixa do modelo só com o título e o contador (Upsell): a barra fica no lugar dela.
  const target =
    outerTitle && hasClass("os-timer-box")(parent) && parent.components().length === 2 && parent.parent()
      ? parent
      : comp;

  let def: Def;
  if (to === "bar") {
    const inner = firstText(comp, (c) => c.get("type") === "text" && c.parent() === comp);
    const outer = outerTitle && plain(outerTitle.getInnerHTML());
    const title = inner && inner !== DEFAULT_TITLE ? inner : outer && !TEMPLATE_TITLES.has(outer) ? outer : undefined;
    const msg = title ? title.replace(/\s*:\s*$/, "") : BAR_TEXTS.converted;
    const unit = descendants(comp, hasClass("os-cd-unit"))[0];
    def = countdownBarDef({
      attrs: keep,
      msg,
      colors: {
        ...(changedColor(editor, unit, "background-color", BOX_DEFAULTS.bg) && {
          boxBg: changedColor(editor, unit, "background-color", BOX_DEFAULTS.bg),
        }),
        ...(changedColor(editor, unit, "color", BOX_DEFAULTS.num) && {
          num: changedColor(editor, unit, "color", BOX_DEFAULTS.num),
        }),
      },
    });
  } else {
    const msg = firstText(comp, hasClass("os-cdb-msg"));
    const box = descendants(comp, isBox)[0];
    def = countdownDef({
      attrs: keep,
      label: msg && msg !== BAR_TEXTS.msg && msg !== BAR_TEXTS.converted ? msg : undefined,
      colors: {
        bg: changedColor(editor, box, "background-color", BAR_COLORS.boxBg),
        num: changedColor(editor, box, "color", BAR_COLORS.num),
      },
    });
  }

  const oldId = comp.getId();
  const oldRules = idRules(editor, target);
  if (outerTitle && target === comp) {
    oldRules.push(...idRules(editor, outerTitle));
    outerTitle.remove();
  }
  const container = target.parent() as Component;
  const at = target.index();
  target.remove();
  // O editor guarda regras de elementos que saíram (keepUnusedStyles): as do contador antigo vão embora.
  for (const rule of oldRules) editor.Css.remove(rule);
  const [added] = container.append(def as never, { at });
  if (!added) return;
  swapped.set(added, comp);
  swapped.set(comp, added);
  swappedId.set(comp, oldId);
  swappedId.set(added, added.getId());
  editor.select(added);
  return added;
}
