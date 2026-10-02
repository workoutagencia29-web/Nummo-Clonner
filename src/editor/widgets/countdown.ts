/**
 * Contador regressivo (data-os-widget="countdown"). No editor mostra um tempo de
 * exemplo parado (conforme as configurações); na página ele conta de verdade
 * (src/runtime/widgets/countdown.ts).
 */
import type { Component, Editor } from "grapesjs";
import { type Def, el, onMobile, type Style, text } from "@/editor/blocks/shared";
import { pad2, parseDeadline, splitTime } from "@/runtime/widgets/options";
import { attr, descendants, hasAttr, hasClass, setText } from "./dom";
import { heading, numberAttr, partStyle, selectAttr, type TraitDef, textAttr } from "./traits";

const UNITS = [
  ["d", "dias"],
  ["h", "horas"],
  ["m", "min"],
  ["s", "seg"],
] as const;

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

const TRAITS: TraitDef[] = [
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
  heading("Cores", "cd-cores"),
  partStyle("os-cd-bg", "Fundo dos números", hasClass("os-cd-unit"), "background-color"),
  partStyle("os-cd-color", "Cor dos números", hasClass("os-cd-unit"), "color"),
];

/**
 * CSS da página (vira regra do projeto, como o dos botões): a caixa "dias" já
 * nasce escondida quando falta menos de um dia — sem isso ela aparece com "00
 * dias" até o script rodar e os números pulam de lugar. O script só troca o
 * data-os-cd-days. (!important: o estilo da caixa é uma regra #id com display.)
 */
export const COUNTDOWN_CSS =
  '[data-os-widget=countdown][data-os-cd-days="0"] [data-os-cd-unit=d]{display:none!important}';

export function registerCountdownType(editor: Editor) {
  editor.DomComponents.addType("os-countdown", {
    isComponent: (node) => node.getAttribute?.("data-os-widget") === "countdown",
    model: {
      defaults: { name: "Contador regressivo", droppable: false, traits: TRAITS, styles: COUNTDOWN_CSS },
      init() {
        this.on(
          "change:attributes:data-os-mode change:attributes:data-os-minutes change:attributes:data-os-until",
          () => refreshSample(this),
        );
      },
    },
  });
}

const unitStyle: Style = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "center",
  "justify-content": "center",
  "min-width": "76px",
  padding: "12px 10px",
  "box-sizing": "border-box",
  "border-radius": "12px",
  "background-color": "#111827",
  color: "#ffffff",
};

/** Bloco "Contador regressivo" (15 minutos por visitante). */
export function countdownDef(opts: { minutes?: number; label?: string } = {}): Def {
  const minutes = opts.minutes ?? 15;
  const sample = countdownSample({ "data-os-minutes": String(minutes) });
  const units = UNITS.map(([unit, label]) =>
    onMobile(
      el(
        "div",
        `Caixa: ${label}`,
        unitStyle,
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
    attributes: {
      "data-os-widget": "countdown",
      "data-os-mode": "evergreen",
      "data-os-minutes": String(minutes),
      "data-os-expired": "zero",
      "data-os-expired-text": "Oferta encerrada.",
      "data-os-cd-days": sample.showDays ? "1" : "0",
    },
    style: {
      "text-align": "center",
      margin: "24px auto",
      padding: "0 12px",
      "max-width": "560px",
      "box-sizing": "border-box",
    },
    components: [
      text("p", opts.label ?? "⏰ Esta oferta especial termina em:", {
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
