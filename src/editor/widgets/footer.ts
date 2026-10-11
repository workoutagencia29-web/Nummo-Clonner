/**
 * Rodapé no editor (rodapé dos modelos e do bloco "Rodapé com políticas";
 * estrutura e CSS em widgets/footer-content.ts): o tipo "Rodapé", com o logo
 * opcional nas Configurações, e o logo, que um clique seleciona (a imagem, com
 * "Trocar logo" em destaque — o mesmo jeito do logo do cabeçalho de loja, com
 * os campos compartilhados de widgets/logo.ts).
 *
 * - "Mostrar logo": ligar num rodapé que ainda não tem põe o elemento (com o
 *   logo provisório) no começo do conteúdo; desligar só esconde. Mudar outro
 *   campo do logo (lugar, altura, destino) também liga, e a caixa acompanha.
 *   "Trocar logo" com o logo desligado só liga quando uma imagem é escolhida
 *   (fechar com Cancelar não deixa o logo provisório na página).
 * - "Usar o mesmo logo do cabeçalho": quando a página tem cabeçalho de loja
 *   com logo enviado (não o provisório).
 * - Lugar no computador e no celular (o padrão é o centro, sem atributo) e
 *   "Altura do logo", como no cabeçalho.
 * - "Para onde o logo leva": uma página da oferta (href os-page:<id>); sem
 *   destino, o <a> fica sem href (não é link).
 * - Rodapé de fundo escuro: a nota pede a versão clara do logo.
 * - "Outros": a dica e a "Âncora (para links #)" de todo elemento (o tipo troca
 *   a lista padrão do GrapesJS; a âncora fica em "Avançado", por último).
 */
import type { Component, Editor } from "grapesjs";
import { CLICK_SELF_PROP } from "@/editor/grapes/link-select";
import { INTERNAL_LINK_PREFIX } from "@/lib/internal-links";
import { attr } from "./dom";
import {
  FOOTER_CSS,
  FOOTER_TYPE,
  FT_BOX_ATTR,
  FT_DEFAULT_POS,
  FT_LOGO_ATTR,
  FT_LOGO_H,
  FT_LOGO_H_VAR,
  FT_LOGO_LINK_TYPE,
  FT_LOGO_MAX_W,
  FT_LOGO_POS_ATTR,
  FT_LOGO_POS_M_ATTR,
  FT_LOGO_R_VAR,
  FT_LOGO_TYPE,
  FT_TEXTS,
  footerLogoDef,
  isOsFooterNode,
} from "./footer-content";
import {
  type LogoSpec,
  logoAltTrait,
  logoPlaceTraits,
  refreshTraits,
  swapLogoTrait,
  watchLogoImage,
  watchLogos,
} from "./logo";
import { storeLogoPlaceholder } from "./store-header-content";
import { heading, type TraitDef } from "./traits";

export const isOsFooter = (c: Component) => c.get("type") === FOOTER_TYPE;

/** Rodapé a que o componente pertence (ele mesmo, se for o rodapé). */
export function footerOf(c: Component | undefined): Component | undefined {
  let at: Component | undefined = c;
  while (at && !isOsFooter(at)) at = at.parent();
  return at;
}

const logoLinkOf = (footer: Component) => footer.find("a.os-ft-logo")[0];
const logoImgOf = (footer: Component) => footer.find("img.os-ft-logo-img")[0];

/** Caixa do conteúdo, onde o logo entra: a marcada, senão a primeira <div> do rodapé (ou o próprio rodapé). */
function boxOf(footer: Component): Component {
  const children = footer.components().models;
  return (
    children.find((c) => FT_BOX_ATTR in c.getAttributes()) ??
    children.find((c) => String(c.get("tagName") ?? "").toLowerCase() === "div") ??
    footer
  );
}

/**
 * Liga o logo do rodapé. Sem o elemento ainda (rodapé de modelo, do bloco ou
 * gravado antes), ele entra no começo do conteúdo, com o logo provisório.
 * Devolve a imagem.
 */
export function ensureFooterLogo(footer: Component): Component | undefined {
  if (!logoImgOf(footer)) {
    const box = boxOf(footer);
    if (!(FT_BOX_ATTR in box.getAttributes())) box.addAttributes({ [FT_BOX_ATTR]: "" });
    box.append(footerLogoDef() as never, { at: 0 });
  }
  if (attr(footer, FT_LOGO_ATTR) !== "1") footer.addAttributes({ [FT_LOGO_ATTR]: "1" });
  return logoImgOf(footer);
}

/** Logo ligado (o elemento está no rodapé e o atributo diz "1"). */
const logoShown = (footer: Component) => attr(footer, FT_LOGO_ATTR) === "1" && !!logoImgOf(footer);

const SHOW_LOGO = "os-ft-logo-on";

/** Raiz da página (o editor não chega aos campos calculados na hora). */
function rootOf(c: Component): Component {
  let at = c;
  while (at.parent()) at = at.parent() as Component;
  return at;
}

/** Logo enviado no cabeçalho de loja da página (o provisório não conta). */
function headerLogo(c: Component): { src: string; alt: string } | null {
  const placeholder = storeLogoPlaceholder();
  for (const img of rootOf(c).find('[data-os-widget="store-header"] img.os-sh-logo-img')) {
    const src = String(img.get("src") ?? "");
    if (src && src !== placeholder) return { src, alt: attr(img, "alt") };
  }
  return null;
}

/** O logo do rodapé já é o do cabeçalho (e está ligado)? */
function sameAsHeader(c: Component): boolean {
  const footer = footerOf(c);
  const logo = headerLogo(c);
  if (!footer || !logo || attr(footer, FT_LOGO_ATTR) !== "1") return false;
  const img = logoImgOf(footer);
  return !!img && String(img.get("src") ?? "") === logo.src;
}

/**
 * Fundo do rodapé no canvas é escuro? (A cor de fundo dele ou, transparente,
 * a do que está em volta.) Logo escuro some nesse fundo: a nota avisa.
 */
function darkFooter(c: Component): boolean {
  const el = footerOf(c)?.getEl();
  const view = el?.ownerDocument.defaultView;
  if (!el || !view) return false;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?/.exec(
      view.getComputedStyle(node).backgroundColor,
    );
    if (!m) continue;
    const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? Number.parseFloat(m[4]) / 100 : Number(m[4]);
    if (alpha < 0.5) continue;
    const lin = (v: string) => {
      const x = Number(v) / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]) < 0.2;
  }
  return false;
}

// ─── Configurações ───────────────────────────────────────────────────────────

/** Logo do rodapé (campos e proporção compartilhados com o cabeçalho de loja: widgets/logo.ts). */
const LOGO: LogoSpec = {
  prefix: "os-ft",
  ownerOf: footerOf,
  imgOf: logoImgOf,
  owners: (editor) => (editor.getWrapper()?.find("footer") ?? []).filter(isOsFooter),
  logos: (editor) => editor.getWrapper()?.find("img.os-ft-logo-img") ?? [],
  prepare: (_editor, footer) => ensureFooterLogo(footer),
  shown: logoShown,
  posAttr: FT_LOGO_POS_ATTR,
  posMAttr: FT_LOGO_POS_M_ATTR,
  defaultPos: FT_DEFAULT_POS,
  heightVar: FT_LOGO_H_VAR,
  ratioVar: FT_LOGO_R_VAR,
  height: FT_LOGO_H,
  defaultAlt: FT_TEXTS.logo,
  placeNote: `No computador, “Esquerda” e “Direita” põem o logo de um lado e os links e textos do outro; no celular, o logo fica sempre em cima deles. “No celular” vale para telas de até 768 px de largura — inclusive o tablet em pé (a vista “Tablet” do editor). Logo largo para de crescer quando chega a ${FT_LOGO_MAX_W} px de largura.`,
};

const showLogoTrait: TraitDef = {
  type: "os-check",
  name: SHOW_LOGO,
  label: "Mostrar logo",
  getValue: ({ component }) => {
    const footer = footerOf(component);
    return !!footer && logoShown(footer);
  },
  setValue: ({ component, value }) => {
    const footer = footerOf(component);
    if (!footer) return;
    if (value) ensureFooterLogo(footer);
    else if (attr(footer, FT_LOGO_ATTR) !== "0") footer.addAttributes({ [FT_LOGO_ATTR]: "0" });
  },
};

const swapLogo = swapLogoTrait(LOGO);

/** "Usar o mesmo logo do cabeçalho": a imagem e a descrição do logo do cabeçalho de loja da página. */
const sameLogoTrait: TraitDef = {
  type: "os-action",
  name: "os-ft-logo-same",
  label: "Usar o mesmo logo do cabeçalho",
  osText: (c) => (sameAsHeader(c) ? "Já é o mesmo logo do cabeçalho" : "Usar o mesmo logo do cabeçalho"),
  osDisabled: sameAsHeader,
  osHidden: (c) => !headerLogo(c),
  osRun: (_editor, c) => {
    const footer = footerOf(c);
    const logo = headerLogo(c);
    if (!footer || !logo) return;
    const img = ensureFooterLogo(footer);
    img?.set("src", logo.src);
    img?.addAttributes({ alt: logo.alt || FT_TEXTS.logo });
  },
};

const darkNote: TraitDef = {
  type: "os-note",
  name: "os-ft-logo-dark",
  label:
    "Este rodapé tem fundo escuro: use a versão clara do logo (branca, ou com um fundo próprio). Um logo escuro quase some aqui.",
  osHidden: (c) => !darkFooter(c),
};

const EMPTY_DEST = "— nenhum (o logo não é link) —";

/** "Para onde o logo leva": uma página da oferta; sem destino, o logo não é link (<a> sem href). */
const logoDestTrait: TraitDef = {
  type: "select",
  name: "os-ft-logo-dest",
  label: "Para onde o logo leva",
  osOptions: "pages",
  osEmpty: EMPTY_DEST,
  options: [{ id: "", label: EMPTY_DEST }],
  getValue: ({ component }) => {
    const footer = footerOf(component);
    const link = footer && logoLinkOf(footer);
    const href = link ? attr(link, "href") : "";
    return href.startsWith(INTERNAL_LINK_PREFIX) ? href.slice(INTERNAL_LINK_PREFIX.length) : "";
  },
  setValue: ({ component, value }) => {
    const footer = footerOf(component);
    if (!footer) return;
    const id = String(value ?? "");
    if (id) ensureFooterLogo(footer);
    const link = logoLinkOf(footer);
    if (!link) return;
    if (id) link.addAttributes({ href: `${INTERNAL_LINK_PREFIX}${id}` });
    else if ("href" in link.getAttributes()) link.removeAttributes("href");
  },
};

/** Lugar e tamanho do logo (os mesmos no rodapé e no logo selecionado). */
const LOGO_PLACE_TRAITS = logoPlaceTraits(LOGO);

const FOOTER_TRAITS: TraitDef[] = [
  heading("Logo", "ft-logo"),
  showLogoTrait,
  swapLogo,
  sameLogoTrait,
  darkNote,
  ...LOGO_PLACE_TRAITS,
  logoDestTrait,
  {
    type: "os-note",
    name: "os-ft-logo-note",
    label: "Também dá para clicar no logo na página: ele fica selecionado, com o “Trocar logo”.",
  },
  // Os campos de todo elemento ("Âncora (para links #)", em "Avançado", e a dica): o tipo troca a lista padrão.
  heading("Outros", "ft-outros"),
  { name: "title" },
  { name: "id" },
];

/** Configurações do logo (clique nele). */
const LOGO_TRAITS: TraitDef[] = [
  swapLogo,
  sameLogoTrait,
  {
    type: "os-note",
    name: "os-ft-logo-tip",
    label:
      "Envie a imagem do seu logo (PNG ou SVG com fundo transparente fica melhor). Dois cliques no logo também trocam.",
  },
  darkNote,
  logoAltTrait(LOGO, "Ex.: Logo da Minha Empresa"),
  heading("Posição e tamanho", "ft-logo-lugar"),
  ...LOGO_PLACE_TRAITS,
  logoDestTrait,
  {
    type: "os-action",
    name: "os-ft-logo-hide",
    label: "Tirar o logo do rodapé",
    osText: () => "Tirar o logo do rodapé",
    osRun: (editor, c) => {
      const footer = footerOf(c);
      if (!footer) return;
      footer.addAttributes({ [FT_LOGO_ATTR]: "0" });
      // O logo some: o rodapé fica selecionado (com o "Mostrar logo" para voltar).
      editor.select(footer);
    },
  },
];

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Partes fixas: não saem, não se mexem e não recebem outros elementos (o logo sai pelo "Mostrar logo"). */
const FIXED = { draggable: false, droppable: false, removable: false, copyable: false };

/** Clique num link do canvas não navega. */
const preventLink = (e: Event) => e.preventDefault();

export function registerFooterTypes(editor: Editor) {
  const dc = editor.DomComponents;
  watchLogos(editor, LOGO, (c) => isOsFooter(c) || c.get("type") === FT_LOGO_TYPE);

  dc.addType(FOOTER_TYPE, {
    isComponent: (node) => isOsFooterNode(node as Element),
    model: {
      defaults: { tagName: "footer", name: "Rodapé", traits: FOOTER_TRAITS },
      init() {
        // "Mostrar logo" lê o rodapé (não um atributo com o nome dele): ligado por outro
        // campo do logo (lugar, altura, destino, "Trocar logo", "Usar o mesmo logo…") ou
        // desligado por "Tirar o logo do rodapé", a caixa acompanha na hora.
        this.on(`change:attributes:${FT_LOGO_ATTR}`, () => refreshTraits(this, (name) => name === SHOW_LOGO));
      },
    },
  });

  // Link em volta do logo: o clique fica com a imagem (o destino é escolhido nas
  // Configurações do logo e do rodapé). Traz o CSS do logo: página sem logo não o leva.
  dc.addType(FT_LOGO_LINK_TYPE, {
    isComponent: (node) => node.tagName === "A" && (node.classList?.contains("os-ft-logo") ?? false),
    model: {
      defaults: {
        tagName: "a",
        name: "Link do logo",
        ...FIXED,
        selectable: false,
        hoverable: false,
        styles: FOOTER_CSS,
      },
    },
    view: {
      onRender({ el }: { el: HTMLElement }) {
        el.addEventListener("click", preventLink, true);
      },
    },
  });

  // Logo: o clique seleciona a imagem, com "Trocar logo"; o tamanho vem de "Altura
  // do logo" (sem as alças de redimensionar). Ao carregar, a proporção vai para o rodapé.
  dc.addType(FT_LOGO_TYPE, {
    extend: "image",
    isComponent: (node) => node.tagName === "IMG" && (node.classList?.contains("os-ft-logo-img") ?? false),
    model: {
      defaults: {
        name: "Logo do rodapé",
        ...FIXED,
        resizable: false,
        [CLICK_SELF_PROP]: true,
        traits: LOGO_TRAITS,
      },
    },
    view: {
      onRender({ el, model }: { el: HTMLElement; model: Component }) {
        watchLogoImage(editor, LOGO, model, el);
      },
    },
  });
}
