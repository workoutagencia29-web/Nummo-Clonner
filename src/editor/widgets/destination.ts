/**
 * Campos "para onde vai o botão" de um widget com um botão de saída (botão
 * final do quiz, "Resgatar" da roleta): página do funil, link da oferta ou
 * endereço — o escolhido por último vale. Os campos ficam no widget (e, no quiz,
 * também na etapa final), mas o valor mora no botão: eles se redesenham
 * quando o botão muda (outro campo, Desfazer, diálogo de link novo).
 */
import type { Component, Editor } from "grapesjs";
import { NEW_LINK_OPTION } from "@/editor/grapes/new-link";
import { INTERNAL_LINK_PREFIX } from "@/lib/internal-links";
import { withScheme } from "@/runtime/widgets/options";
import { attr, descendants } from "./dom";
import { heading, type TraitDef } from "./traits";

export interface DestinationOptions {
  /** Título do grupo ("Ao terminar o quiz"). */
  title: string;
  /** Prefixo dos nomes dos campos ("os-qz" → os-qz-page, os-qz-link, os-qz-url). */
  prefix: string;
  /** Rótulo do campo de página ("Botão final leva para a página do funil"). */
  pageLabel: string;
  /** Rótulo do campo de link da oferta (padrão "…ou para um link da oferta"). */
  linkLabel?: string;
  /** É o botão de saída? */
  isButton: (c: Component) => boolean;
  /** Widget do componente (os botões de saída dele são os que mudam). */
  widgetOf: (c: Component) => Component | undefined;
}

const isPage = (href: string) => href.startsWith(INTERNAL_LINK_PREFIX);

/** Sem destino nenhum, o botão volta a pedir um (aviso do canvas e do ZIP). */
function markUnset(btn: Component) {
  const href = attr(btn, "href");
  if ((!href || href === "#") && !("data-os-link" in btn.getAttributes())) btn.addAttributes({ "data-os-link": "" });
}

export function destination(o: DestinationOptions) {
  const names = [`${o.prefix}-page`, `${o.prefix}-link`, `${o.prefix}-url`];
  /** Botões de saída do componente (ele mesmo, ou os de dentro dele). */
  const buttons = (c: Component): Component[] => (o.isButton(c) ? [c] : descendants(c, o.isButton));

  const traits: TraitDef[] = [
    heading(o.title, `${o.prefix.replace(/^os-/, "")}-destino`),
    {
      type: "select",
      name: names[0],
      label: o.pageLabel,
      osOptions: "pages",
      osEmpty: "— nenhuma —",
      options: [{ id: "", label: "— nenhuma —" }],
      getValue: ({ component }) => {
        const href = attr(buttons(component)[0] ?? component, "href");
        return isPage(href) ? href.slice(INTERNAL_LINK_PREFIX.length) : "";
      },
      setValue: ({ component, value }) => {
        for (const btn of buttons(component)) {
          if (value) {
            btn.addAttributes({ href: `${INTERNAL_LINK_PREFIX}${value}` });
            btn.removeAttributes("data-os-link");
          } else if (isPage(attr(btn, "href"))) {
            btn.addAttributes({ href: "#" });
            markUnset(btn);
          }
        }
      },
    },
    {
      type: "select",
      name: names[1],
      label: o.linkLabel ?? "…ou para um link da oferta",
      osOptions: "links",
      osEmpty: "— nenhum —",
      options: [{ id: "", label: "— nenhum —" }],
      getValue: ({ component }) => attr(buttons(component)[0] ?? component, "data-os-link"),
      setValue: ({ component, value }) => {
        const key = String(value ?? "");
        const list = buttons(component);
        if (key === NEW_LINK_OPTION) {
          // Abre o diálogo de link novo (um só), que liga o botão ao link criado.
          list[0]?.addAttributes({ "data-os-link": key });
          return;
        }
        for (const btn of list) {
          // O endereço e a página do funil de antes saem (senão os campos acima mostrariam um destino que não vale).
          if (key) btn.addAttributes({ "data-os-link": key, href: "#" });
          else if (attr(btn, "data-os-link")) btn.addAttributes({ "data-os-link": "" });
        }
      },
    },
    {
      type: "text",
      name: names[2],
      label: "…ou para o endereço",
      placeholder: "https://…",
      getValue: ({ component }) => {
        const href = attr(buttons(component)[0] ?? component, "href");
        return href === "#" || isPage(href) ? "" : href;
      },
      setValue: ({ component, value }) => {
        const url = withScheme(String(value ?? ""));
        for (const btn of buttons(component)) {
          if (url && url !== "#") {
            btn.addAttributes({ href: url });
            btn.removeAttributes("data-os-link");
          } else if (!isPage(attr(btn, "href"))) {
            btn.addAttributes({ href: "#" });
            markUnset(btn);
          }
        }
      },
    },
  ];

  return {
    traits,
    /**
     * Liga os botões de saída ao link da oferta criado no diálogo "＋ Criar link
     * da oferta…": como ao escolher um link que já existe, o destino de antes
     * (página do funil ou endereço) sai. false = não é um botão de saída deste widget.
     */
    bind(c: Component, key: string): boolean {
      if (!o.isButton(c)) return false;
      for (const b of buttons(o.widgetOf(c) ?? c)) b.addAttributes({ "data-os-link": key, href: "#" });
      return true;
    },
    /** Os campos selecionados acompanham o botão quando ele muda por outro caminho. */
    watch(editor: Editor) {
      editor.on("component:update:attributes", (c: Component) => {
        if (!o.isButton(c)) return;
        const sel = editor.getSelected();
        if (!sel || sel === c || !buttons(sel).includes(c)) return;
        for (const name of names) sel.getTrait(name)?.targetUpdated();
      });
    },
  };
}
