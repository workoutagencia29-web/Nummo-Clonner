/**
 * Notificação de compra (data-os-widget="sales-notification"). No editor
 * aparece como um cartão de exemplo (com rótulo) no lugar onde foi solto; na
 * página vira um aviso no canto da tela que se repete com os nomes da lista
 * (src/runtime/widgets/sales-notification.ts). O visual do cartão é editável
 * no painel Estilo; os textos vêm das Configurações.
 */
import type { Component, Editor } from "grapesjs";
import { type Def, el, esc, text } from "@/editor/blocks/shared";
import { parsePeople } from "@/runtime/widgets/options";
import { attr, descendants, hasAttr, setText } from "./dom";
import { checkAttr, heading, numberAttr, selectAttr, type TraitDef, textAttr } from "./traits";

/** Lista inicial (nomes e cidades comuns no Brasil). */
export const DEFAULT_PEOPLE = [
  "Maria - São Paulo",
  "João - Rio de Janeiro",
  "Ana - Belo Horizonte",
  "Pedro - Curitiba",
  "Juliana - Salvador",
  "Lucas - Fortaleza",
  "Fernanda - Recife",
  "Rafael - Porto Alegre",
  "Camila - Goiânia",
  "Bruno - Campinas",
  "Patrícia - Manaus",
  "Carlos - Brasília",
].join("\n");

export function notificationSample(attrs: Record<string, string>) {
  const person = parsePeople(attrs["data-os-people"] ?? "")[0] ?? { name: "Maria", city: "São Paulo" };
  const action = attrs["data-os-action"] || "acabou de comprar";
  const product = attrs["data-os-product"] ?? "";
  return {
    title: person.city ? `${person.name}, de ${person.city}` : person.name,
    text: product ? `${action} ${product}` : action,
  };
}

function refreshSample(component: Component) {
  const attrs: Record<string, string> = {};
  for (const name of ["data-os-people", "data-os-action", "data-os-product"]) attrs[name] = attr(component, name);
  const sample = notificationSample(attrs);
  for (const [part, value] of [
    ["title", sample.title],
    ["text", sample.text],
  ] as const) {
    const node = descendants(component, hasAttr("data-os-sn", part))[0];
    if (node && node.getInnerHTML() !== value) setText(node, value);
  }
}

const TRAITS: TraitDef[] = [
  heading("Conteúdo", "sn-conteudo"),
  {
    type: "os-textarea",
    name: "data-os-people",
    label: "Nomes e cidades (um por linha: Nome – Cidade)",
    rows: 6,
    placeholder: "Maria - São Paulo",
  },
  textAttr("data-os-product", "Produto", "o Método X"),
  textAttr("data-os-action", "Texto da ação", "acabou de comprar"),
  heading("Tempo", "sn-tempo"),
  numberAttr("data-os-start", "Primeira aparece depois de (segundos)", 0, 3600),
  numberAttr("data-os-interval", "Intervalo entre avisos (segundos)", 2, 3600),
  numberAttr("data-os-duration", "Tempo na tela (segundos)", 1, 120),
  numberAttr("data-os-max", "Máximo por visita (0 = sem limite)", 0, 1000),
  heading("Exibição", "sn-exibicao"),
  selectAttr("data-os-position", "Posição", [
    ["left", "Canto inferior esquerdo"],
    ["right", "Canto inferior direito"],
  ]),
  checkAttr("data-os-time", "Mostrar “há X minutos”", true),
  checkAttr("data-os-mobile", "Mostrar no celular", true),
];

export function registerSalesNotificationType(editor: Editor) {
  editor.DomComponents.addType("os-sales-notification", {
    isComponent: (node) => node.getAttribute?.("data-os-widget") === "sales-notification",
    model: {
      defaults: { name: "Notificação de compra", droppable: false, traits: TRAITS },
      init() {
        this.on(
          "change:attributes:data-os-people change:attributes:data-os-action change:attributes:data-os-product",
          () => refreshSample(this),
        );
      },
    },
  });
}

/** Bloco "Notificação de compra". */
export function salesNotificationDef(product = "o Método X"): Def {
  const attrs: Record<string, string> = {
    "data-os-widget": "sales-notification",
    "data-os-people": DEFAULT_PEOPLE,
    "data-os-product": product,
    "data-os-action": "acabou de comprar",
    "data-os-start": "6",
    "data-os-interval": "15",
    "data-os-duration": "5",
    "data-os-max": "10",
    "data-os-position": "left",
    "data-os-time": "1",
    "data-os-mobile": "1",
  };
  const sample = notificationSample(attrs);
  const part = (tag: string, name: string, key: string, content: string, style: Record<string, string>): Def =>
    el(tag, name, style, undefined, { attributes: { "data-os-sn": key }, content: esc(content) });
  return {
    type: "os-sales-notification",
    name: "Notificação de compra",
    attributes: { ...attrs, hidden: true, role: "status", "aria-live": "polite" },
    components: [
      el(
        "div",
        "Cartão",
        {
          display: "flex",
          "align-items": "center",
          gap: "12px",
          "max-width": "360px",
          padding: "12px 16px 12px 12px",
          "box-sizing": "border-box",
          "border-radius": "14px",
          border: "1px solid #eef0f4",
          "background-color": "#ffffff",
          color: "#111827",
          "box-shadow": "0 12px 32px rgba(15,23,42,.18)",
          "text-align": "left",
          "line-height": "1.35",
        },
        [
          text(
            "div",
            "✓",
            {
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              "flex-shrink": "0",
              width: "44px",
              height: "44px",
              "border-radius": "50%",
              "background-color": "#dcfce7",
              color: "#16a34a",
              "font-size": "22px",
              "font-weight": "800",
            },
            { name: "Ícone" },
          ),
          el("div", "Textos", { display: "flex", "flex-direction": "column", gap: "2px", "min-width": "0" }, [
            part("strong", "Nome e cidade", "title", sample.title, { "font-size": "15px", "font-weight": "700" }),
            part("span", "Ação", "text", sample.text, { "font-size": "14px", color: "#374151" }),
            el("div", "Rodapé do aviso", { display: "flex", gap: "8px", "font-size": "12px", "margin-top": "2px" }, [
              part("span", "Há quanto tempo", "time", "há 5 minutos", { color: "#6b7280" }),
              text("span", "✔ Compra verificada", { color: "#16a34a", "font-weight": "600" }),
            ]),
          ]),
        ],
        { droppable: false },
      ),
    ],
  };
}
