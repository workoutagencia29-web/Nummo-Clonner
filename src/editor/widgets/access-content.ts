/**
 * Bloco "Acesso ao produto" (data-os-widget="access") da página de obrigado:
 * CSS da página, textos padrão (Español, English, Português) e a definição do
 * widget. Sem GrapesJS aqui.
 *
 * Estrutura (ganchos data-os-* lidos por src/runtime/widgets/access.ts):
 *
 *   div.os-access[data-os-widget=access][data-os-lang=es|en|pt]
 *     div.os-ac-part[data-os-ac-wait]   "Confirmando seu pagamento…" (com o girador)
 *     div.os-ac-part[data-os-ac-ok]     título, texto e a.os-btn.os-ac-go[data-os-ac-go]
 *                                       ("Acessar meu produto": o href vem do servidor)
 *     div.os-ac-part[data-os-ac-none]   "Ainda não encontramos seu pagamento…"
 *
 * Textos com data-os-ac-text="<chave>" são trocados pelo "Idioma dos textos".
 * Na página, só a parte do estado atual aparece (classes os-ac-* postas pelo
 * script); antes do script, a de "confirmando". Seletores com
 * :not([data-gjs-type]) não valem no canvas do editor, onde as três partes
 * aparecem (com rótulos, src/editor/widgets/canvas.ts). Sem var() (o GrapesJS
 * perde atalhos com var()).
 */
import type { Def } from "@/editor/blocks/shared";
import { ACCESS_TEXTS, type AccessTextKey } from "@/lib/payments/access-texts";
import type { PayLocale } from "@/lib/payments/contract";

export const ACCESS_TYPE = "os-access";
export const ACCESS_PART_TYPE = "os-access-part";
export const ACCESS_GO_TYPE = "os-access-go";

// Textos padrão: em src/lib/payments/access-texts.ts (também usados pelo script da página, que troca
// os textos que ainda são os padrão quando o produto pago é de outro idioma).
export { ACCESS_TEXTS, type AccessTextKey } from "@/lib/payments/access-texts";

export const ACCESS_LANGS: [PayLocale, string][] = [
  ["es", "Español"],
  ["en", "English"],
  ["pt", "Português"],
];

export const ACCESS_CSS = [
  ".os-access{box-sizing:border-box;width:100%;max-width:560px;margin:32px auto;padding:30px 22px;border-radius:20px;background-color:#ffffff;color:#111827;font-family:inherit;line-height:1.5;text-align:center;box-shadow:0 20px 50px -24px rgba(15,23,42,.35),0 0 0 1px rgba(15,23,42,.06)}",
  ".os-access *{box-sizing:border-box}",
  ".os-access .os-ac-title{margin:0 0 8px;color:inherit;font-family:inherit;font-size:24px;font-weight:800;line-height:1.25;letter-spacing:-.01em;text-transform:none}",
  ".os-access .os-ac-text{margin:0;color:#4b5563;font-size:16px;line-height:1.5}",
  ".os-access .os-ac-icon{margin:0 0 10px;font-size:44px;line-height:1}",
  ".os-access .os-ac-spin{display:block;width:34px;height:34px;margin:4px auto 14px;border-width:3px;border-style:solid;border-color:#e5e7eb;border-top-color:#16a34a;border-radius:50%;animation:os-ac-r .8s linear infinite}",
  "@keyframes os-ac-r{to{transform:rotate(360deg)}}",
  ".os-access .os-ac-go{display:block;width:100%;max-width:none;margin:22px 0 0;padding:18px 20px;border-radius:14px;background-color:#16a34a;color:#ffffff;font-family:inherit;font-size:19px;font-weight:800;line-height:1.25;text-align:center;text-decoration:none;text-transform:none;box-shadow:0 14px 28px -14px rgba(22,163,74,.9)}",
  // Na página: só a parte do estado atual (antes do script, a de "confirmando").
  ".os-access:not(.os-ac-ok):not([data-gjs-type]) [data-os-ac-ok]{display:none}",
  ".os-access:not(.os-ac-none):not([data-gjs-type]) [data-os-ac-none]{display:none}",
  ".os-access.os-ac-ok [data-os-ac-wait]{display:none}",
  ".os-access.os-ac-none [data-os-ac-wait]{display:none}",
  "@media (prefers-reduced-motion:reduce){.os-access .os-ac-spin{animation:none}}",
  "@media (max-width:480px){.os-access{width:calc(100% - 24px);margin:16px auto;padding:24px 16px}.os-access .os-ac-title{font-size:21px}}",
].join("");

const txt = (tag: string, cls: string, key: AccessTextKey, lang: PayLocale, name: string): Def => ({
  type: "text",
  tagName: tag,
  name,
  classes: [cls],
  attributes: { "data-os-ac-text": key },
  content: ACCESS_TEXTS[lang][key],
});

const part = (attr: string, name: string, components: Def[]): Def => ({
  type: ACCESS_PART_TYPE,
  tagName: "div",
  name,
  classes: ["os-ac-part"],
  attributes: { [attr]: "" },
  components,
});

/** Bloco "Acesso ao produto" com os textos no idioma pedido. */
export function accessDef(lang: PayLocale = "es"): Def {
  return {
    type: ACCESS_TYPE,
    tagName: "div",
    name: "Acesso ao produto",
    classes: ["os-access"],
    attributes: { "data-os-widget": "access", "data-os-lang": lang },
    components: [
      part("data-os-ac-wait", "Confirmando o pagamento", [
        {
          tagName: "span",
          name: "Girador",
          classes: ["os-ac-spin"],
          attributes: { "aria-hidden": "true" },
          layerable: false,
          selectable: false,
          hoverable: false,
        },
        txt("p", "os-ac-text", "wait", lang, "Texto"),
      ]),
      part("data-os-ac-ok", "Pagamento confirmado", [
        txt("h2", "os-ac-title", "okTitle", lang, "Título"),
        txt("p", "os-ac-text", "okText", lang, "Texto"),
        {
          type: ACCESS_GO_TYPE,
          tagName: "a",
          name: "Botão de acesso",
          classes: ["os-btn", "os-ac-go"],
          attributes: { href: "#", "data-os-ac-go": "", "data-os-ac-text": "go" },
          // No elemento (não só na classe): o campo "Cor do botão" mostra a cor atual.
          style: { "background-color": "#16a34a" },
          content: ACCESS_TEXTS[lang].go,
        },
      ]),
      part("data-os-ac-none", "Pagamento não encontrado", [
        txt("h2", "os-ac-title", "noneTitle", lang, "Título"),
        txt("p", "os-ac-text", "noneText", lang, "Texto"),
      ]),
    ],
  };
}
