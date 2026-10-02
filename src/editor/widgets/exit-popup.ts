/**
 * Popup de saída (data-os-widget="exit-popup"). No editor é uma caixa normal,
 * editável, com o rótulo "Popup de saída (aparece ao sair)"; na página fica
 * escondido e abre por cima de tudo quando o visitante vai sair
 * (src/runtime/widgets/exit-popup.ts).
 */
import type { Editor } from "grapesjs";
import { type Def, el, onMobile, text } from "@/editor/blocks/shared";
import { buttonDef } from "./button";
import { checkAttr, heading, numberAttr, selectAttr, type TraitDef } from "./traits";

const TRAITS: TraitDef[] = [
  heading("Quando abrir", "pop-quando"),
  checkAttr("data-os-exit", "Computador: quando o mouse sair da página", true),
  numberAttr("data-os-mobile-seconds", "Celular: abrir depois de (segundos; 0 = não)", 0, 3600),
  checkAttr("data-os-scrollup", "Celular: quando rolar para cima rápido", true),
  numberAttr("data-os-seconds", "Todos: abrir depois de (segundos; 0 = não)", 0, 3600),
  checkAttr("data-os-back", "Quando tentar voltar (botão voltar)", false),
  heading("Frequência", "pop-frequencia"),
  selectAttr("data-os-frequency", "Mostrar", [
    ["session", "Uma vez por visita"],
    ["always", "Sempre que a página abrir"],
  ]),
];

export function registerExitPopupType(editor: Editor) {
  editor.DomComponents.addType("os-exit-popup", {
    isComponent: (node) => node.getAttribute?.("data-os-widget") === "exit-popup",
    model: { defaults: { name: "Popup de saída", traits: TRAITS } },
  });
}

/** Bloco "Popup de saída". */
export function exitPopupDef(): Def {
  return {
    type: "os-exit-popup",
    name: "Popup de saída",
    attributes: {
      "data-os-widget": "exit-popup",
      "data-os-exit": "1",
      "data-os-mobile-seconds": "25",
      "data-os-scrollup": "1",
      "data-os-seconds": "0",
      "data-os-back": "0",
      "data-os-frequency": "session",
      hidden: true,
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Oferta especial",
    },
    components: [
      onMobile(
        el(
          "div",
          "Caixa do popup",
          {
            position: "relative",
            width: "100%",
            "max-width": "520px",
            margin: "0 auto",
            padding: "40px 32px 28px",
            "box-sizing": "border-box",
            "border-radius": "20px",
            "background-color": "#ffffff",
            color: "#111827",
            "text-align": "center",
            "box-shadow": "0 24px 64px rgba(0,0,0,.35)",
          },
          [
            el(
              "button",
              "Fechar",
              {
                position: "absolute",
                top: "10px",
                right: "12px",
                width: "40px",
                height: "40px",
                padding: "0",
                border: "0",
                "border-radius": "50%",
                background: "transparent",
                color: "#6b7280",
                "font-size": "28px",
                "line-height": "1",
                cursor: "pointer",
              },
              undefined,
              { attributes: { type: "button", "data-os-close": "", "aria-label": "Fechar" }, content: "×" },
            ),
            text("p", "ESPERE!", {
              display: "inline-block",
              margin: "0 0 12px",
              padding: "6px 14px",
              "border-radius": "999px",
              "background-color": "#fef3c7",
              color: "#92400e",
              "font-size": "13px",
              "font-weight": "800",
              "letter-spacing": "0.08em",
            }),
            onMobile(
              text("h3", "Não vá embora ainda…", {
                margin: "0 0 10px",
                "font-size": "30px",
                "font-weight": "800",
                "line-height": "1.2",
              }),
              { "font-size": "24px" },
            ),
            text(
              "p",
              "Liberamos um cupom de <strong>20% de desconto</strong> só para você. Ele vale apenas nesta página.",
              {
                margin: "0 0 22px",
                "font-size": "17px",
                "line-height": "1.55",
                color: "#4b5563",
              },
            ),
            buttonDef("QUERO MEU DESCONTO", { checkout: true, style: { "font-size": "19px", padding: "18px 32px" } }),
            text(
              "a",
              "Não, obrigado. Prefiro pagar o preço cheio.",
              {
                display: "inline-block",
                "margin-top": "14px",
                "font-size": "14px",
                color: "#6b7280",
                "text-decoration": "underline",
              },
              { type: "link", attributes: { href: "#", "data-os-close": "" }, name: "Link para fechar" },
            ),
          ],
          { droppable: true },
        ),
        { padding: "36px 20px 22px" },
      ),
    ],
  };
}
