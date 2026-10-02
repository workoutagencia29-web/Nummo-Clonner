/**
 * Barra de escassez (data-os-widget="scarcity"): "Restam poucas vagas" com
 * porcentagem. No editor fica parada no valor configurado; na página pode ir
 * diminuindo aos poucos (src/runtime/widgets/scarcity.ts).
 */
import type { Component, Editor } from "grapesjs";
import { type Def, el, type Style, text } from "@/editor/blocks/shared";
import { attr, descendants, hasAttr, setBaseStyle, setText } from "./dom";
import { checkAttr, heading, numberAttr, partStyle, type TraitDef } from "./traits";

function percentOf(component: Component) {
  const n = Math.round(Number(attr(component, "data-os-percent")));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 20;
}

function refreshSample(editor: Editor, component: Component) {
  const pct = `${percentOf(component)}%`;
  for (const fill of descendants(component, hasAttr("data-os-sc-fill"))) setBaseStyle(editor, fill, { width: pct });
  for (const value of descendants(component, hasAttr("data-os-sc-value"))) {
    if (value.getInnerHTML() !== pct) setText(value, pct);
  }
}

const TRAITS: TraitDef[] = [
  numberAttr("data-os-percent", "Porcentagem da barra (%)", 0, 100),
  heading("Animação", "sc-anim"),
  checkAttr("data-os-animate", "Diminuir aos poucos", false),
  numberAttr("data-os-every", "Diminuir 1% a cada (segundos)", 1, 3600),
  numberAttr("data-os-min", "Parar em (%)", 0, 100),
  heading("Cores", "sc-cores"),
  partStyle("os-sc-fill-color", "Cor da barra", hasAttr("data-os-sc-fill"), "background-color"),
  partStyle("os-sc-track-color", "Fundo da barra", hasAttr("data-os-sc-track"), "background-color"),
];

export function registerScarcityType(editor: Editor) {
  editor.DomComponents.addType("os-scarcity", {
    isComponent: (node) => node.getAttribute?.("data-os-widget") === "scarcity",
    model: {
      defaults: { name: "Barra de escassez", droppable: false, traits: TRAITS },
      init() {
        this.on("change:attributes:data-os-percent", () => refreshSample(editor, this));
      },
    },
  });
}

/** Bloco "Barra de escassez". */
export function scarcityDef(percent = 17): Def {
  const pct = `${percent}%`;
  const valueStyle: Style = { "font-weight": "800", color: "#dc2626" };
  return {
    type: "os-scarcity",
    name: "Barra de escassez",
    attributes: {
      "data-os-widget": "scarcity",
      "data-os-percent": String(percent),
      "data-os-animate": "1",
      "data-os-every": "8",
      "data-os-min": "4",
    },
    style: { margin: "24px auto", padding: "0 16px", "max-width": "592px", "box-sizing": "border-box" },
    components: [
      el(
        "div",
        "Topo",
        {
          display: "flex",
          "justify-content": "space-between",
          "align-items": "baseline",
          gap: "12px",
          margin: "0 0 8px",
          "font-size": "16px",
        },
        [
          text("span", "🔥 Restam poucas vagas!", { "font-weight": "700", color: "#111827" }),
          el("span", "Porcentagem", valueStyle, undefined, {
            attributes: { "data-os-sc-value": "" },
            content: pct,
            editable: false,
          }),
        ],
      ),
      el(
        "div",
        "Trilho da barra",
        {
          height: "18px",
          "border-radius": "999px",
          "background-color": "#fee2e2",
          overflow: "hidden",
          "box-shadow": "inset 0 1px 2px rgba(0,0,0,.08)",
        },
        [
          el(
            "div",
            "Barra",
            { width: pct, height: "100%", "border-radius": "999px", "background-color": "#dc2626" },
            undefined,
            {
              attributes: { "data-os-sc-fill": "" },
              droppable: false,
            },
          ),
        ],
        { attributes: { "data-os-sc-track": "" }, droppable: false },
      ),
      text("p", "As vagas com desconto estão acabando. Garanta a sua agora.", {
        margin: "8px 0 0",
        "font-size": "14px",
        color: "#6b7280",
        "text-align": "center",
      }),
    ],
  };
}
