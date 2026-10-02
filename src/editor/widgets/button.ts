/**
 * Botão de chamada (os-button): um link com cara de botão (classe os-btn).
 * Continua sendo um link editável (texto com dois cliques, "Link da oferta" e
 * "Página do funil" vêm de registerDynamicTraits) e ganha a opção de pulsar.
 * O realce ao passar o mouse e o pulso vão no CSS da própria página.
 */
import type { Component, Editor } from "grapesjs";
import { type Def, onMobile, PROP_AUTO_LINK, type Style, text } from "@/editor/blocks/shared";
import { withScheme } from "@/runtime/widgets/options";
import type { TraitDef } from "./traits";

export const BUTTON_CLASS = "os-btn";
export const PULSE_CLASS = "os-pulse";

/** CSS da página para os botões (vira regras editáveis do projeto). */
const BUTTON_CSS =
  ".os-btn{transition-property:transform,filter;transition-duration:.15s}" +
  ".os-btn:hover{filter:brightness(1.07);transform:translateY(-2px)}" +
  ".os-pulse{animation-name:os-pulse;animation-duration:1.8s;animation-timing-function:ease-in-out;animation-iteration-count:infinite}" +
  "@keyframes os-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}";

const pulseTrait: TraitDef = {
  type: "os-check",
  name: "os-pulse",
  label: "Pulsar (chamar atenção)",
  getValue: ({ component }) => component.getClasses().includes(PULSE_CLASS),
  setValue: ({ component, value }) => {
    if (value) component.addClass(PULSE_CLASS);
    else component.removeClass(PULSE_CLASS);
  },
};

/**
 * Endereço do botão. "meusite.com.br/x" ganha o https:// (senão viraria um
 * caminho desta página) e digitar um endereço desliga o link da oferta ligado
 * antes — o que foi escolhido por último é o que vale.
 */
const hrefTrait: TraitDef = {
  type: "text",
  name: "href",
  label: "Endereço (URL)",
  placeholder: "https://…",
  setValue: ({ component, value }) => {
    const href = withScheme(String(value ?? ""));
    component.addAttributes({ href });
    if (href && href !== "#" && "data-os-link" in component.getAttributes()) component.removeAttributes("data-os-link");
  },
};

export function registerButtonType(editor: Editor) {
  editor.DomComponents.addType("os-button", {
    extend: "link",
    isComponent: (el) => el.tagName === "A" && !!el.classList?.contains(BUTTON_CLASS),
    model: {
      defaults: {
        name: "Botão",
        styles: BUTTON_CSS,
        traits: [
          hrefTrait,
          {
            type: "select",
            name: "target",
            label: "Abrir em",
            options: [
              { id: "", label: "Mesma aba" },
              { id: "_blank", label: "Nova aba" },
            ],
          },
          pulseTrait,
        ] as TraitDef[],
      },
    },
  });
}

export const CTA_STYLE: Style = {
  display: "block",
  width: "fit-content",
  "max-width": "100%",
  "box-sizing": "border-box",
  margin: "0 auto",
  padding: "20px 44px",
  "border-radius": "12px",
  "background-color": "#16a34a",
  color: "#ffffff",
  "font-size": "21px",
  "font-weight": "800",
  "line-height": "1.25",
  "letter-spacing": "0.2px",
  "text-align": "center",
  "text-decoration": "none",
  "text-transform": "uppercase",
  "box-shadow": "0 10px 24px rgba(22,163,74,.35), inset 0 -3px 0 rgba(0,0,0,.15)",
};

export interface ButtonOptions {
  style?: Style;
  mobile?: Style;
  pulse?: boolean;
  /** Botão de compra: nasce com data-os-link="" (o canvas pede para escolher o link). */
  checkout?: boolean;
  /** Com checkout: liga sozinho ao primeiro link de checkout da oferta (padrão: sim). */
  auto?: boolean;
}

/** Botão pronto (os-button). */
export function buttonDef(label: string, opts: ButtonOptions = {}): Def {
  const auto = opts.checkout && opts.auto !== false;
  const def = text(
    "a",
    label,
    { ...CTA_STYLE, ...opts.style },
    {
      type: "os-button",
      name: opts.checkout ? "Botão do checkout" : "Botão",
      attributes: { href: "#", ...(opts.checkout && { "data-os-link": "" }) },
      classes: [BUTTON_CLASS, ...(opts.pulse ? [PULSE_CLASS] : [])],
      ...(auto && { [PROP_AUTO_LINK]: "CHECKOUT" }),
    },
  );
  return onMobile(def, { width: "100%", padding: "18px 20px", "font-size": "18px", ...opts.mobile });
}

/** Útil para testes e para outros widgets: é um botão do Offer Studio? */
export const isButton = (c: Component) => c.get("type") === "os-button";
