/**
 * Formulário de captura (form[data-os-widget="lead-form"]). Campos nome,
 * e‑mail e WhatsApp ligam/desligam nas Configurações. Ao enviar (na página),
 * valida, manda para o webhook e/ou vai para o endereço escolhido
 * (src/runtime/widgets/lead-form.ts). O destino fica no atributo action: URL,
 * página do funil (os-page:<id>) ou link da oferta (data-os-link).
 *
 * Cada caixa de texto do formulário ganha, ao ser selecionada, o campo "Texto
 * dentro do campo", que grava o placeholder e o nome lido pelo leitor de tela
 * (aria-label) juntos.
 */
import type { Component, Editor } from "grapesjs";
import { type Def, el, onMobile, text } from "@/editor/blocks/shared";
import { NEW_LINK_OPTION } from "@/editor/grapes/new-link";
import { INTERNAL_LINK_PREFIX } from "@/lib/internal-links";
import { withScheme } from "@/runtime/widgets/options";
import { attr, descendants, hasAttr } from "./dom";
import { checkAttr, heading, type TraitDef, textAttr } from "./traits";

export type LeadFieldKey = "name" | "email" | "phone";
const FIELD_ORDER: LeadFieldKey[] = ["name", "email", "phone"];

const INPUT_STYLE = {
  display: "block",
  width: "100%",
  "box-sizing": "border-box",
  padding: "15px 16px",
  border: "1px solid #d1d5db",
  "border-radius": "10px",
  "background-color": "#ffffff",
  color: "#111827",
  "font-family": "inherit",
  "font-size": "17px",
  "line-height": "1.3",
  margin: "0",
};

const FIELDS: Record<LeadFieldKey, { label: string; attrs: Record<string, string | boolean> }> = {
  name: {
    label: "Campo: nome",
    attrs: {
      type: "text",
      name: "name",
      placeholder: "Seu primeiro nome",
      autocomplete: "given-name",
      "aria-label": "Seu nome",
    },
  },
  email: {
    label: "Campo: e‑mail",
    attrs: {
      type: "email",
      name: "email",
      placeholder: "Seu melhor e-mail",
      autocomplete: "email",
      "aria-label": "Seu e-mail",
    },
  },
  phone: {
    label: "Campo: WhatsApp",
    attrs: {
      type: "tel",
      name: "phone",
      placeholder: "Seu WhatsApp com DDD",
      autocomplete: "tel",
      inputmode: "tel",
      "aria-label": "Seu WhatsApp com DDD",
    },
  },
};

/** Campo do formulário (caixa + input). */
export function leadFieldDef(key: LeadFieldKey): Def {
  const field = FIELDS[key];
  return el(
    "div",
    field.label,
    { margin: "0 0 12px" },
    [el("input", "Caixa de texto", INPUT_STYLE, undefined, { attributes: { ...field.attrs, required: true } })],
    { attributes: { "data-os-field": key }, droppable: false },
  );
}

const findField = (form: Component, key: LeadFieldKey) => descendants(form, hasAttr("data-os-field", key))[0];

/** Liga/desliga um campo, mantendo a ordem nome → e‑mail → WhatsApp. */
export function toggleLeadField(form: Component, key: LeadFieldKey, on: boolean) {
  const existing = findField(form, key);
  if (!on) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const children = form.components().models;
  const before = FIELD_ORDER.slice(0, FIELD_ORDER.indexOf(key));
  let at = -1;
  children.forEach((c, i) => {
    if (before.includes(attr(c, "data-os-field") as LeadFieldKey)) at = i + 1;
  });
  if (at < 0) {
    const firstField = children.findIndex((c) => attr(c, "data-os-field"));
    at = firstField >= 0 ? firstField : 0;
  }
  form.append(leadFieldDef(key), { at });
}

const fieldTrait = (key: LeadFieldKey, label: string): TraitDef => ({
  type: "os-check",
  name: `os-field-${key}`,
  label,
  getValue: ({ component }) => !!findField(component, key),
  setValue: ({ component, value }) => toggleLeadField(component, key, !!value),
});

const isPage = (action: string) => action.startsWith(INTERNAL_LINK_PREFIX);

/**
 * O destino escolhido por último é o que vale. Um link da oferta (data-os-link)
 * ligado antes teria prioridade na prévia/ZIP (applyOfferLinks troca o action),
 * então escolher um endereço ou uma página do funil desliga o link.
 */
function unlinkOffer(component: Component) {
  if ("data-os-link" in component.getAttributes()) component.removeAttributes("data-os-link");
}

const TRAITS: TraitDef[] = [
  heading("Campos", "lf-campos"),
  fieldTrait("name", "Pedir nome"),
  fieldTrait("email", "Pedir e‑mail"),
  fieldTrait("phone", "Pedir WhatsApp"),
  heading("Ao enviar", "lf-envio"),
  {
    type: "text",
    name: "data-os-webhook",
    label: "Enviar os dados para (webhook)",
    placeholder: "https://hooks.zapier.com/…",
    // "hooks.zapier.com/…" sem https:// seria ignorado pela página.
    setValue: ({ component, value }) => component.addAttributes({ "data-os-webhook": withScheme(String(value ?? "")) }),
  },
  {
    type: "text",
    name: "os-lf-url",
    label: "Depois ir para (endereço)",
    placeholder: "https://… (vazio = mostrar mensagem)",
    getValue: ({ component }) => {
      const action = attr(component, "action");
      return isPage(action) ? "" : action;
    },
    setValue: ({ component, value }) => {
      // "meusite.com.br/obrigado" sem https:// viraria um caminho desta página (404).
      const url = withScheme(String(value ?? ""));
      component.addAttributes({ action: url });
      if (url && url !== "#") unlinkOffer(component);
    },
  },
  {
    type: "select",
    name: "os-lf-page",
    label: "…ou para a página do funil",
    osOptions: "pages",
    osEmpty: "— nenhuma —",
    options: [{ id: "", label: "— nenhuma —" }],
    getValue: ({ component }) => {
      const action = attr(component, "action");
      return isPage(action) ? action.slice(INTERNAL_LINK_PREFIX.length) : "";
    },
    setValue: ({ component, value }) => {
      if (value) {
        component.addAttributes({ action: `${INTERNAL_LINK_PREFIX}${value}` });
        unlinkOffer(component);
      } else if (isPage(attr(component, "action"))) component.addAttributes({ action: "" });
    },
  },
  {
    type: "select",
    name: "data-os-link",
    label: "…ou para um link da oferta",
    osOptions: "links",
    osEmpty: "— nenhum —",
    options: [{ id: "", label: "— nenhum —" }],
    setValue: ({ component, value }) => {
      const key = String(value ?? "");
      if (!key) return unlinkOffer(component);
      // Link escolhido: o endereço e a página do funil de antes saem (senão os
      // campos acima mostrariam um destino que não vale mais).
      component.addAttributes({ "data-os-link": key, ...(key !== NEW_LINK_OPTION && { action: "" }) });
    },
  },
  checkAttr("data-os-pass", "Levar nome e e‑mail para a próxima página", false),
  textAttr("data-os-success", "Mensagem de sucesso (sem redirecionar)", "Pronto! Recebemos seus dados."),
];

/** Campo "Texto dentro do campo" das caixas de texto do formulário. */
export const LEAD_INPUT_TEXT_TRAIT = "os-lf-input-text";

/** Caixa de texto (não caixa de marcar) de um formulário de captura. */
function isLeadInput(c: Component): boolean {
  if (String(c.get("tagName") ?? "").toLowerCase() !== "input") return false;
  if (/^(checkbox|radio|hidden|submit|button|image|reset)$/i.test(attr(c, "type"))) return false;
  for (let at = c.parent(); at; at = at.parent()) if (attr(at, "data-os-widget") === "lead-form") return true;
  return false;
}

const leadInputTextTrait: TraitDef = {
  type: "text",
  name: LEAD_INPUT_TEXT_TRAIT,
  label: "Texto dentro do campo",
  getValue: ({ component }) => attr(component, "placeholder"),
  setValue: ({ component, value }) => {
    const text = String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
    // Vazio: volta o texto com que o campo nasceu (o campo nunca fica sem nome para o leitor de tela).
    const key = attr(component.parent() ?? component, "data-os-field") as LeadFieldKey;
    const def = FIELDS[key]?.attrs;
    const placeholder = text || String(def?.placeholder ?? "");
    const label = text ? text.replace(/[\s.…:]+$/, "") : String(def?.["aria-label"] ?? "");
    if (!placeholder && !label) return;
    component.addAttributes({ placeholder, "aria-label": label || placeholder });
  },
};

export function registerLeadFormType(editor: Editor) {
  // Caixa de texto do formulário: o texto de dentro e o nome do leitor de tela, juntos.
  editor.on("component:selected", (c: Component) => {
    if (isLeadInput(c) && !c.getTrait(LEAD_INPUT_TEXT_TRAIT)) c.addTrait(leadInputTextTrait as never, { at: 0 });
  });
  editor.DomComponents.addType("os-lead-form", {
    isComponent: (node) => node.tagName === "FORM" && node.getAttribute?.("data-os-widget") === "lead-form",
    model: { defaults: { tagName: "form", name: "Formulário de captura", traits: TRAITS } },
    view: {
      onRender({ el: form }: { el: HTMLElement }) {
        // No editor, enviar o formulário não pode navegar o canvas.
        form.addEventListener("submit", (e) => e.preventDefault());
      },
    },
  });
}

/** O formulário em si (campos + botão + aviso). */
export function leadFormDef(opts: { fields?: LeadFieldKey[]; button?: string; noteColor?: string } = {}): Def {
  const fields = opts.fields ?? ["name", "email"];
  return {
    type: "os-lead-form",
    tagName: "form",
    name: "Formulário de captura",
    attributes: {
      "data-os-widget": "lead-form",
      method: "get",
      action: "",
      "data-os-webhook": "",
      "data-os-pass": "0",
      // Só aparece se o webhook recebeu os dados (sem destino, a página mostra "Obrigado!").
      "data-os-success": "Pronto! Recebemos seus dados.",
    },
    style: { margin: "0", "text-align": "left" },
    components: [
      ...fields.map(leadFieldDef),
      onMobile(
        text(
          "button",
          opts.button ?? "QUERO RECEBER AGORA",
          {
            display: "block",
            width: "100%",
            "box-sizing": "border-box",
            padding: "17px 20px",
            border: "0",
            "border-radius": "10px",
            "background-color": "#16a34a",
            color: "#ffffff",
            "font-family": "inherit",
            "font-size": "19px",
            "font-weight": "800",
            "line-height": "1.25",
            cursor: "pointer",
            "box-shadow": "0 8px 20px rgba(22,163,74,.3)",
          },
          { attributes: { type: "submit" }, name: "Botão enviar", classes: ["os-btn"] },
        ),
        { "font-size": "17px" },
      ),
      text("p", "🔒 Seus dados estão seguros. Não enviamos spam.", {
        margin: "10px 0 0",
        "font-size": "13px",
        color: opts.noteColor ?? "#6b7280",
        "text-align": "center",
      }),
    ],
  };
}
