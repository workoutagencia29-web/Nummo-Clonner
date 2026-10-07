/**
 * Tipos do bloco "Acesso ao produto" (página de obrigado do pagamento na
 * página): o bloco, as três partes (confirmando / confirmado / não
 * encontrado) e o botão de acesso. Conteúdo e CSS em ./access-content.ts;
 * comportamento só na página (src/runtime/widgets/access.ts).
 *
 * O botão de acesso não tem "Link da oferta" nem "Página do funil" (o destino
 * vem do servidor, só para quem pagou: ver registerDynamicTraits). "Idioma dos
 * textos" troca os textos do bloco pelos padrões do idioma; ao soltar o bloco,
 * ele já nasce no idioma do primeiro produto de pagamento da oferta.
 */
import type { Component, Editor } from "grapesjs";
import type { PayLocale } from "@/lib/payments/contract";
import {
  ACCESS_CSS,
  ACCESS_GO_TYPE,
  ACCESS_LANGS,
  ACCESS_PART_TYPE,
  ACCESS_TEXTS,
  ACCESS_TYPE,
  type AccessTextKey,
} from "./access-content";
import { widgetContext } from "./context";
import { attr, descendants, hasAttr, setText } from "./dom";
import { partStyle, selectAttr, type TraitDef } from "./traits";

/** Propriedade auxiliar do bloco: escolher o idioma pelo produto ao soltar (apagada em seguida). */
export const PROP_ACCESS_LANG = "osAccessLang";

const isLang = (v: string): v is PayLocale => v === "es" || v === "en" || v === "pt";

/** Troca os textos do bloco pelos padrões do idioma. */
export function applyAccessLang(component: Component, lang: PayLocale) {
  for (const c of descendants(component, hasAttr("data-os-ac-text"))) {
    const key = attr(c, "data-os-ac-text") as AccessTextKey;
    const text = ACCESS_TEXTS[lang][key];
    if (text !== undefined) setText(c, text);
  }
}

const NOTE =
  "O botão “Acessar meu produto” só aparece para quem pagou: o link de acesso fica no servidor (Links e checkouts → produto) e nunca vai no HTML da página. Use este bloco na página de obrigado do produto.";

const TRAITS: TraitDef[] = [
  { type: "os-note", name: "os-ac-note", label: NOTE },
  selectAttr("data-os-lang", "Idioma dos textos (troca os textos do bloco)", ACCESS_LANGS),
  partStyle("os-ac-go-color", "Cor do botão", hasAttr("data-os-ac-go"), "background-color"),
];

export function registerAccessTypes(editor: Editor) {
  const dc = editor.DomComponents;

  dc.addType(ACCESS_TYPE, {
    isComponent: (node) => node.getAttribute?.("data-os-widget") === "access",
    model: {
      defaults: {
        name: "Acesso ao produto",
        droppable: false,
        traits: TRAITS,
        styles: ACCESS_CSS,
      },
      init(this: Component) {
        if (this.get(PROP_ACCESS_LANG)) {
          this.unset(PROP_ACCESS_LANG, { silent: true });
          const link = widgetContext(editor).links.find((l) => l.paymentLocale);
          const lang = link?.paymentLocale;
          if (lang && isLang(lang) && lang !== attr(this, "data-os-lang")) {
            this.addAttributes({ "data-os-lang": lang });
            applyAccessLang(this, lang);
          }
        }
        this.on("change:attributes:data-os-lang", () => {
          const lang = attr(this, "data-os-lang");
          if (isLang(lang)) applyAccessLang(this, lang);
        });
      },
    },
  });

  dc.addType(ACCESS_PART_TYPE, {
    isComponent: (node) =>
      !!node.hasAttribute &&
      (node.hasAttribute("data-os-ac-wait") ||
        node.hasAttribute("data-os-ac-ok") ||
        node.hasAttribute("data-os-ac-none")),
    model: {
      defaults: { draggable: false, removable: false, copyable: false },
    },
  });

  dc.addType(ACCESS_GO_TYPE, {
    extend: "os-button",
    isComponent: (node) => node.tagName === "A" && !!node.hasAttribute?.("data-os-ac-go"),
    model: {
      defaults: {
        name: "Botão de acesso",
        draggable: false,
        removable: false,
        copyable: false,
        traits: [
          {
            type: "select",
            name: "target",
            label: "Abrir em",
            options: [
              { id: "", label: "Mesma aba" },
              { id: "_blank", label: "Nova aba" },
            ],
          },
        ] as TraitDef[],
      },
    },
  });
}
