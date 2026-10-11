/**
 * Botão de WhatsApp (a[data-os-widget="whatsapp"]): link wa.me com número e
 * mensagem, flutuante no canto da tela ou no meio da página. Funciona sem
 * script. Se o botão estiver ligado a um link da oferta do tipo WhatsApp
 * (data-os-link), o endereço desse link vale na prévia e no ZIP.
 *
 * Número: com "+" (ou "00") na frente, fica como foi digitado; sem isso, DDD +
 * número ganha o 55 do Brasil só em oferta em real. Fora do real, o campo pede
 * o número com o código do país. Abaixo do campo aparece o número final
 * ("Abre a conversa com +34 612345678"), para conferir.
 */
import type { Component, Editor } from "grapesjs";
import { type Def, el, onMobile, PROP_AUTO_LINK, type Style } from "@/editor/blocks/shared";
import { editorTimeout } from "@/editor/grapes/lifecycle";
import { normalizePhone, whatsappUrl } from "@/runtime/widgets/options";
import { widgetContext } from "./context";
import { attr } from "./dom";
import { type TraitDef, textAttr } from "./traits";

export const WHATSAPP_ICON =
  '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true" focusable="false"><path fill="currentColor" d="M16.04 3C9.4 3 4 8.36 4 14.97c0 2.3.66 4.54 1.9 6.47L4 29l7.77-1.84a12.1 12.1 0 0 0 4.27.77C22.68 27.93 28 22.57 28 15.97 28 9.36 22.68 3 16.04 3Zm0 22.73c-1.36 0-2.7-.27-3.95-.8l-.28-.12-4.6 1.09 1.12-4.43-.18-.3a10.2 10.2 0 0 1-1.6-5.2c0-5.7 4.68-10.34 10.47-10.34 5.75 0 9.8 4.65 9.8 10.1 0 5.6-4.94 10-10.78 10Zm5.93-7.63c-.32-.16-1.9-.93-2.2-1.04-.3-.1-.51-.16-.73.16-.21.32-.83 1.04-1.02 1.25-.19.21-.38.24-.7.08a8.6 8.6 0 0 1-2.55-1.56 9.5 9.5 0 0 1-1.76-2.18c-.19-.32 0-.49.14-.65.14-.14.32-.37.48-.56.16-.19.21-.32.32-.53.1-.21.05-.4-.03-.56-.08-.16-.72-1.72-.99-2.36-.26-.62-.52-.53-.72-.54h-.62c-.21 0-.56.08-.85.4-.29.32-1.12 1.09-1.12 2.66 0 1.57 1.15 3.08 1.31 3.3.16.2 2.26 3.44 5.47 4.83.77.33 1.36.52 1.83.67.77.24 1.47.21 2.02.13.62-.09 1.9-.77 2.17-1.52.27-.74.27-1.38.19-1.52-.08-.13-.29-.21-.61-.37Z"/></svg>';

/** Número de exemplo com que o bloco nasce (nunca vira destino de verdade sozinho). */
const PHONE = "5511999999999";
const MESSAGE = "Olá! Vim pela página e quero saber mais.";

/** Moeda da oferta (sem ela: real). */
const currencyOf = (editor: Editor | undefined) => widgetContext(editor).currency ?? "BRL";
/** Oferta em real (ou sem moeda): DDD + número sem "+" ganha o 55. */
const inBrazil = (editor: Editor | undefined) => currencyOf(editor) === "BRL";

/** `number`: já no formato internacional (normalizePhone), só dígitos. */
function relink(component: Component, number: string, message: string) {
  component.addAttributes({
    "data-os-phone": number,
    "data-os-message": message,
    // Número já com o código do país: nada a acrescentar.
    href: whatsappUrl(number, message, false),
  });
  // Número/mensagem digitados agora valem mais que o link de WhatsApp da oferta
  // ligado antes (inclusive o ligado sozinho ao soltar o bloco): senão a prévia
  // e o ZIP continuariam usando o endereço do link. Só com um número de verdade:
  // mexer só na mensagem com o número de exemplo mantém o link.
  const usable = /^\d{10,15}$/.test(number) && number !== PHONE;
  if (usable && "data-os-link" in component.getAttributes()) component.removeAttributes("data-os-link");
}

/** Códigos de país com 2 algarismos (os de 1 são o 1 e o 7; o resto tem 3). */
const TWO_DIGIT_CODES = new Set(
  "20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98".split(
    " ",
  ),
);

/** "+34 612345678", "+55 11 91234-5678" — o número final, para conferir. */
export function phoneDisplay(number: string): string {
  const size = /^[17]/.test(number) ? 1 : TWO_DIGIT_CODES.has(number.slice(0, 2)) ? 2 : 3;
  const code = number.slice(0, size);
  const rest = number.slice(size);
  if (code === "55" && (rest.length === 10 || rest.length === 11))
    return `+55 ${rest.slice(0, 2)} ${rest.slice(2, -4)}-${rest.slice(-4)}`;
  return `+${code} ${rest}`;
}

/** Frase abaixo do campo do número. */
export function phoneNote(number: string): string {
  if (!number) return "";
  if (!/^\d{10,15}$/.test(number))
    return `Confira o número (${number}): com o código do país, ele tem de 10 a 15 algarismos.`;
  return `Abre a conversa com ${phoneDisplay(number)}${number === PHONE ? " (número de exemplo: troque pelo seu)" : ""}.`;
}

const PHONE_FIELD = { label: "Número com DDD", placeholder: "(11) 91234-5678" };
/** Fora do real: o número com o código do país (exemplo do país da moeda). */
const WORLD_EXAMPLE: Record<string, string> = {
  MXN: "+52 55 1234 5678",
  EUR: "+34 612 345 678",
  USD: "+1 305 555 1234",
};

const TRAITS: TraitDef[] = [
  {
    type: "text",
    name: "os-wa-phone",
    ...PHONE_FIELD,
    // O número gravado já tem o código do país: aparece com "+" na frente, e assim
    // corrigir um algarismo não faz ele ganhar o 55 de novo (numa oferta em real,
    // "+1 305…" editado viraria "55 1 305…").
    getValue: ({ component }) => {
      const number = attr(component, "data-os-phone");
      return /^\d+$/.test(number) ? `+${number}` : number;
    },
    setValue: ({ editor, component, value }) =>
      relink(component, normalizePhone(String(value ?? ""), inBrazil(editor)), attr(component, "data-os-message")),
  },
  {
    type: "os-note",
    name: "os-wa-final",
    label: "",
    osHidden: (component) => !attr(component, "data-os-phone"),
  },
  {
    type: "os-textarea",
    name: "os-wa-message",
    label: "Mensagem que já vem escrita",
    rows: 3,
    getValue: ({ component }) => attr(component, "data-os-message"),
    setValue: ({ component, value }) => relink(component, attr(component, "data-os-phone"), String(value ?? "")),
  },
  {
    type: "select",
    name: "data-os-link",
    label: "…ou usar um link de WhatsApp da oferta",
    osOptions: "links:WHATSAPP",
    osEmpty: "— não (usar o número acima) —",
    options: [{ id: "", label: "— não (usar o número acima) —" }],
  },
  textAttr("aria-label", "Texto para leitores de tela", "Falar no WhatsApp"),
];

/**
 * Campo do número conforme a moeda da oferta e a frase do número final
 * (refeita quando o número muda).
 */
function paintPhoneFields(editor: Editor, component: Component) {
  const field = component.getTrait("os-wa-phone");
  const currency = currencyOf(editor);
  const want =
    currency === "BRL"
      ? PHONE_FIELD
      : { label: "Número com código do país", placeholder: WORLD_EXAMPLE[currency] ?? WORLD_EXAMPLE.MXN };
  if (field && (field.get("label") !== want.label || field.get("placeholder") !== want.placeholder)) field.set(want);
  const note = component.getTrait("os-wa-final");
  if (!note) return;
  // O rótulo da nota é o texto dela (os-note); o GrapesJS guarda o elemento já
  // desenhado, então o texto da linha muda direto nele.
  // Ligado a um link de WhatsApp da oferta: o endereço do link vale no lugar do número.
  const text = attr(component, "data-os-link")
    ? "Este botão usa o link de WhatsApp da oferta escolhido abaixo (o número acima não vale)."
    : phoneNote(attr(component, "data-os-phone"));
  if (note.get("label") !== text) note.set("label", text);
  const el = (note.view as unknown as { getInputElem?: () => unknown } | undefined)?.getInputElem?.();
  if (el instanceof HTMLElement && el.textContent !== text) el.textContent = text;
}

export function registerWhatsappType(editor: Editor) {
  editor.DomComponents.addType("os-whatsapp", {
    isComponent: (node) => node.tagName === "A" && node.getAttribute?.("data-os-widget") === "whatsapp",
    model: { defaults: { tagName: "a", name: "Botão de WhatsApp", droppable: false, traits: TRAITS } },
  });
  const isWhatsapp = (c: Component | undefined) => c?.get("type") === "os-whatsapp";
  editor.on("component:selected", (c: Component) => {
    if (isWhatsapp(c)) paintPhoneFields(editor, c);
  });
  editor.on("component:update:attributes", (c: Component) => {
    // Depois do campo terminar de gravar (a nota redesenhada não tira o foco do campo).
    if (isWhatsapp(c) && editor.getSelected() === c) editorTimeout(editor, () => paintPhoneFields(editor, c));
  });
}

function base(name: string, style: Style, components: Def[], extra: Def = {}): Def {
  return {
    type: "os-whatsapp",
    tagName: "a",
    name,
    attributes: {
      "data-os-widget": "whatsapp",
      "data-os-phone": PHONE,
      "data-os-message": MESSAGE,
      href: whatsappUrl(PHONE, MESSAGE),
      target: "_blank",
      rel: "noopener",
      "aria-label": "Falar no WhatsApp",
    },
    style,
    components,
    [PROP_AUTO_LINK]: "WHATSAPP",
    ...extra,
  };
}

const iconDef = (size: string): Def =>
  el("span", "Ícone", { display: "block", width: size, height: size, "flex-shrink": "0" }, WHATSAPP_ICON, {
    selectable: false,
    hoverable: false,
    layerable: false,
  });

/** Botão redondo flutuante no canto inferior direito. */
export function whatsappFloatDef(): Def {
  return onMobile(
    base(
      "WhatsApp flutuante",
      {
        position: "fixed",
        right: "20px",
        bottom: "20px",
        "z-index": "9990",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        width: "62px",
        height: "62px",
        padding: "15px",
        "box-sizing": "border-box",
        "border-radius": "50%",
        "background-color": "#25d366",
        color: "#ffffff",
        "box-shadow": "0 8px 24px rgba(0,0,0,.25)",
        "text-decoration": "none",
      },
      [iconDef("32px")],
    ),
    { right: "14px", bottom: "14px", width: "56px", height: "56px", padding: "13px" },
  );
}

/** Botão "Falar no WhatsApp" no meio da página. */
export function whatsappButtonDef(): Def {
  return onMobile(
    base(
      "Botão de WhatsApp",
      {
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        gap: "10px",
        width: "fit-content",
        "max-width": "100%",
        margin: "16px auto",
        padding: "16px 30px",
        "box-sizing": "border-box",
        "border-radius": "999px",
        "background-color": "#25d366",
        color: "#ffffff",
        "font-size": "18px",
        "font-weight": "700",
        "line-height": "1.2",
        "text-decoration": "none",
        "box-shadow": "0 8px 20px rgba(37,211,102,.35)",
      },
      [iconDef("24px"), el("span", "Texto", {}, undefined, { type: "text", content: "Falar no WhatsApp" })],
    ),
    { width: "100%" },
  );
}
