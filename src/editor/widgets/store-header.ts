/**
 * Cabeçalho de loja no editor (data-os-widget="store-header"): tipos do
 * GrapesJS e as Configurações. Nada busca nem fica fixo no canvas: isso é da
 * página publicada (src/runtime/widgets/store.ts).
 *
 * - "Partes do cabeçalho" liga/desliga a faixa de aviso, a pesquisa, o local de
 *   entrega, o "Entre", o carrinho e as categorias (data-os-sh-<parte>, CSS por
 *   atributo). Ligar o "Entre" ou o carrinho sem destino põe data-os-link="" (o
 *   aviso de sempre: escolher o link da oferta); desligar tira esse pedido —
 *   parte desligada não vai ao ar como botão sem link — e mantém um link
 *   escolhido.
 * - Logo: clicar nele seleciona a IMAGEM (não o link em volta: CLICK_SELF_PROP
 *   de grapes/link-select.ts), com "Trocar logo" em destaque (abre o gerenciador
 *   de imagens, como o duplo clique), a descrição e o lugar/tamanho. O grupo
 *   "Logo" do cabeçalho tem o mesmo botão e os mesmos campos. Lugar no
 *   computador e no celular em data-os-sh-logo-pos / -pos-m (CSS por atributo);
 *   altura na variável --os-sh-logo-h do estilo do cabeçalho (como as cores) e
 *   a proporção da imagem em --os-sh-logo-r (gravada quando a imagem carrega no
 *   canvas: logo largo para na largura máxima sem deixar faixa vazia). Os
 *   campos de lugar/tamanho leem o valor de agora ao selecionar o logo ou o
 *   cabeçalho (mudado no outro).
 * - "Página da loja" grava o href do logo (os-page:<id>): numa página sem
 *   vitrine, a pesquisa leva para lá com a busca. Sem ela (e sem vitrine na
 *   página), o canvas avisa no cabeçalho (WIDGET_CANVAS_CSS).
 * - Textos da pesquisa e da linha de resultados, "Fixo no topo ao rolar",
 *   cores prontas (aplicam um conjunto de variáveis --os-sh-*) e cada cor.
 * - Estrutura fixa: caixas, campo, lupa, logo, "Entre" e carrinho não saem nem
 *   se mexem; clicar nas caixas seleciona o cabeçalho. Textos e categorias
 *   editam com dois cliques; categorias se duplicam, apagam e
 *   arrastam dentro da linha delas. Os ícones são gerados (como as partes do
 *   cartão de produto).
 * - Só mora no nível de cima da página (largura toda da tela): arrastar só
 *   solta lá, e o que cair num contêiner volta para lá (fora de um bloco que
 *   começa escondido) — src/editor/widgets/store-header-place.ts.
 * - Categoria sem destino cuja busca não acharia nenhum produto da página
 *   (nome, selo ou título de vitrine): o canvas contorna e avisa (marca só no
 *   desenho do canvas, data-os-cv-nada — nunca no HTML salvo). O ZIP e o
 *   "Próximos passos" avisam também (src/lib/store-pages.ts).
 */
import type { Component, Editor, Trait } from "grapesjs";
import type { Style } from "@/editor/blocks/shared";
import { editorTimeout } from "@/editor/grapes/lifecycle";
import { CLICK_SELF_PROP } from "@/editor/grapes/link-select";
import { INTERNAL_LINK_PREFIX } from "@/lib/internal-links";
import { matchesSearch, SEARCH_TEXTS } from "@/lib/store-search";
import { withScheme } from "@/runtime/widgets/options";
import { attr, baseStyle, cleanText, componentCss, descendants, hasClass, setBaseStyle } from "./dom";
import {
  type LogoSpec,
  logoAltTrait,
  logoPlaceTraits,
  refreshTraits,
  swapLogoTrait,
  watchLogoImage,
  watchLogos,
} from "./logo";
import {
  categoryDef,
  isShIcon,
  isShTheme,
  matchShTheme,
  SH_BOX_TYPE,
  SH_CAT_TYPE,
  SH_CATS_TYPE,
  SH_GO_TYPE,
  SH_ICON_TYPE,
  SH_ICONS,
  SH_INPUT_TYPE,
  SH_LINK_TYPE,
  SH_LOGO_H,
  SH_LOGO_H_VAR,
  SH_LOGO_MAX_W,
  SH_LOGO_POS_ATTR,
  SH_LOGO_POS_M_ATTR,
  SH_LOGO_R_VAR,
  SH_LOGO_TYPE,
  SH_PARTS,
  SH_PLACE_RULES,
  SH_TEXT_TYPE,
  SH_TEXTS,
  SH_THEME_IDS,
  SH_THEMES,
  SH_VARS,
  type ShColor,
  type ShPart,
  STORE_HEADER_CSS,
  STORE_HEADER_TYPE,
  shDefaultColor,
  shThemeStyle,
} from "./store-header-content";
import { headerDropAllowed, watchHeaderPlace } from "./store-header-place";
import { checkAttr, heading, type TraitDef } from "./traits";

export const isStoreHeader = (c: Component) => attr(c, "data-os-widget") === "store-header";

/** Cabeçalho a que o componente pertence (ele mesmo, se for o cabeçalho). */
export function headerOf(c: Component | undefined): Component | undefined {
  let at: Component | undefined = c;
  while (at && !isStoreHeader(at)) at = at.parent();
  return at;
}

const partOf = (header: Component, cls: string) => descendants(header, hasClass(cls))[0];
/** Link do logo (o href = página da loja). */
const logoOf = (c: Component) => {
  const header = headerOf(c);
  return header ? partOf(header, "os-sh-logo") : undefined;
};

/** Endereço que leva a algum lugar ("#", vazio e javascript: não levam). */
const leads = (href: string) => Boolean(href) && href !== "#" && !/^javascript:/i.test(href);

/**
 * "Entre" e carrinho: ligado sem destino pede o link da oferta
 * (data-os-link="", aviso no canvas, no ZIP e no "Próximos passos"); desligado,
 * o pedido sai (não vai ao ar como botão sem link). Um link escolhido fica.
 */
function markLink(link: Component, on: boolean) {
  const attrs = link.getAttributes();
  if (on) {
    if (!leads(attr(link, "href")) && !("data-os-link" in attrs)) link.addAttributes({ "data-os-link": "" });
  } else if (attrs["data-os-link"] === "") {
    link.removeAttributes("data-os-link");
  }
}

// ─── Ações ───────────────────────────────────────────────────────────────────

/** "＋ Adicionar categoria": categoria nova no fim da linha, já selecionada. */
export function addCategory(editor: Editor, header: Component): Component | undefined {
  const list = descendants(header, (c) => c.get("type") === SH_CATS_TYPE)[0];
  if (!list) return;
  const [added] = list.append(categoryDef(SH_TEXTS.newCategory) as never);
  if (!added) return;
  // A linha de categorias desligada volta (senão a categoria nova não aparece).
  if (attr(header, "data-os-sh-cats") === "0") header.addAttributes({ "data-os-sh-cats": "1" });
  editor.select(added);
  return added;
}

// ─── Configurações ───────────────────────────────────────────────────────────

function partTrait(key: ShPart, label: string, cls: string, def: boolean): TraitDef {
  const name = `data-os-sh-${key}`;
  return {
    ...checkAttr(name, label, def),
    setValue: ({ component, value }) => {
      component.addAttributes({ [name]: value ? "1" : "0" });
      if (key !== "account" && key !== "cart") return;
      const link = partOf(component, cls);
      if (link) markLink(link, Boolean(value));
    },
  };
}

const addCategoryTrait: TraitDef = {
  type: "button",
  name: "os-sh-add-cat",
  text: "＋ Adicionar categoria",
  full: true,
  command: (editor: Editor, trait: Trait) => {
    const header = headerOf(trait.target as Component);
    if (header) addCategory(editor, header);
  },
};

/** "Página da loja": o logo leva a ela; a pesquisa de uma página sem vitrine também. */
const storePageTrait: TraitDef = {
  type: "select",
  name: "os-sh-store",
  label: "Página da loja (vitrine)",
  osOptions: "pages",
  osEmpty: "— nenhuma —",
  options: [{ id: "", label: "— nenhuma —" }],
  getValue: ({ component }) => {
    const logo = logoOf(component);
    const href = logo ? attr(logo, "href") : "";
    return href.startsWith(INTERNAL_LINK_PREFIX) ? href.slice(INTERNAL_LINK_PREFIX.length) : "";
  },
  setValue: ({ component, value }) => {
    const logo = logoOf(component);
    if (!logo) return;
    const id = String(value ?? "");
    if (id) {
      logo.addAttributes({ href: `${INTERNAL_LINK_PREFIX}${id}` });
      // A página escolhida passa a valer (um link da oferta ligado antes teria prioridade).
      if ("data-os-link" in logo.getAttributes()) logo.removeAttributes("data-os-link");
    } else if (attr(logo, "href").startsWith(INTERNAL_LINK_PREFIX)) {
      logo.addAttributes({ href: "#" });
    }
  },
};

/** Texto guardado num atributo do cabeçalho (vazio volta ao padrão). */
const headerText = (name: string, label: string, def: string): TraitDef => ({
  type: "text",
  name,
  label,
  placeholder: def,
  getValue: ({ component }) => attr(component, name) || def,
  setValue: ({ component, value }) => {
    component.addAttributes({ [name]: cleanText(value) || def });
  },
});

/** Texto guardado num atributo de uma parte (campo de pesquisa, lupa). */
function partText(name: string, label: string, cls: string, attrName: string, def: string, also?: string): TraitDef {
  return {
    type: "text",
    name,
    label,
    placeholder: def,
    getValue: ({ component }) => {
      const part = partOf(component, cls);
      return part ? attr(part, attrName) : "";
    },
    setValue: ({ component, value }) => {
      const part = partOf(component, cls);
      if (!part) return;
      const text = cleanText(value) || def;
      // O nome para leitores de tela acompanha o texto (sem as reticências do fim).
      part.addAttributes({ [attrName]: text, ...(also && { [also]: text.replace(/[\s.…]+$/, "") }) });
    },
  };
}

const themeTrait: TraitDef = {
  type: "select",
  name: "os-sh-theme",
  label: "Cores prontas",
  options: [{ id: "", label: "Personalizadas" }, ...SH_THEME_IDS.map((id) => ({ id, label: SH_THEMES[id].label }))],
  getValue: ({ editor, component }) => {
    const header = headerOf(component);
    return header ? matchShTheme(headerColors(editor, header)) : "";
  },
  setValue: ({ editor, component, value }) => {
    const header = headerOf(component);
    if (!header || !isShTheme(value)) return;
    setBaseStyle(editor, header, shThemeStyle(value));
    refreshTraits(header, (name) => name.startsWith("os-sh-color-"));
  },
};

/** Cores em vigor no cabeçalho (as trocadas e, no resto, as do CSS). */
function headerColors(editor: Editor, header: Component): Record<ShColor, string> {
  const own = baseStyle(editor, header);
  const out = {} as Record<ShColor, string>;
  for (const color of Object.keys(SH_VARS) as ShColor[]) out[color] = own[SH_VARS[color]] || shDefaultColor(color);
  return out;
}

function colorTrait(color: ShColor, label: string): TraitDef {
  const prop = SH_VARS[color];
  return {
    type: "os-color",
    name: `os-sh-color-${color}`,
    label,
    getValue: ({ editor, component }) => {
      const header = headerOf(component);
      return header ? baseStyle(editor, header)[prop] || shDefaultColor(color) : "";
    },
    setValue: ({ editor, component, value }) => {
      const header = headerOf(component);
      if (!header) return;
      setBaseStyle(editor, header, { [prop]: String(value ?? "") });
      // "Cores prontas" passa a mostrar "Personalizadas" (ou o conjunto que bateu).
      refreshTraits(header, (name) => name === "os-sh-theme");
    },
  };
}

// ─── Logo ────────────────────────────────────────────────────────────────────

/**
 * Logo do cabeçalho (campos e proporção compartilhados com o rodapé:
 * widgets/logo.ts). Lugar padrão: à esquerda (sem o atributo).
 */
const LOGO: LogoSpec = {
  prefix: "os-sh",
  ownerOf: headerOf,
  imgOf: (header) => partOf(header, "os-sh-logo-img"),
  owners: (editor) => editor.getWrapper()?.find('[data-os-widget="store-header"]') ?? [],
  logos: (editor) => editor.getWrapper()?.find("img.os-sh-logo-img") ?? [],
  posAttr: SH_LOGO_POS_ATTR,
  posMAttr: SH_LOGO_POS_M_ATTR,
  defaultPos: "left",
  heightVar: SH_LOGO_H_VAR,
  ratioVar: SH_LOGO_R_VAR,
  height: SH_LOGO_H,
  defaultAlt: SH_TEXTS.logo,
  placeNote: `“No celular” vale para telas de até 768 px de largura — inclusive o tablet em pé (a vista “Tablet” do editor); “no computador”, para as maiores. Logo largo para de crescer quando chega a ${SH_LOGO_MAX_W} px de largura.`,
};

const swapLogo = swapLogoTrait(LOGO);
/** Lugar e tamanho do logo (os mesmos no cabeçalho e no logo selecionado). */
const LOGO_PLACE_TRAITS = logoPlaceTraits(LOGO);

/** Configurações do logo (clique nele). */
const LOGO_TRAITS: TraitDef[] = [
  swapLogo,
  {
    type: "os-note",
    name: "os-sh-logo-tip",
    label:
      "Envie a imagem do seu logo (PNG ou SVG com fundo transparente fica melhor). Dois cliques no logo também trocam.",
  },
  logoAltTrait(LOGO, "Ex.: Logo da Minha Loja"),
  heading("Posição e tamanho", "sh-logo-lugar"),
  ...LOGO_PLACE_TRAITS,
  {
    type: "os-note",
    name: "os-sh-logo-dest",
    label: "Para onde o logo leva: “Página da loja” nas Configurações do cabeçalho.",
  },
];

const HEADER_TRAITS: TraitDef[] = [
  heading("Logo", "sh-logo"),
  swapLogo,
  ...LOGO_PLACE_TRAITS,
  {
    type: "os-note",
    name: "os-sh-logo-note",
    label: "Também dá para clicar no logo na página: ele fica selecionado, com o “Trocar logo”.",
  },
  heading("Partes do cabeçalho", "sh-partes"),
  ...SH_PARTS.map(([key, label, cls, def]) => partTrait(key, label, cls, def)),
  addCategoryTrait,
  {
    type: "os-note",
    name: "os-sh-note",
    label:
      "Textos e categorias: dois cliques para mudar. Para onde vão o carrinho, o “Entre” e cada categoria: clique neles. Categoria sem destino busca o nome dela nos produtos.",
  },
  heading("Pesquisa", "sh-pesquisa"),
  storePageTrait,
  {
    type: "os-note",
    name: "os-sh-store-note",
    label:
      "A pesquisa filtra os produtos desta página; numa página sem produtos (ex.: página do produto), leva para a vitrine com a busca. O logo também leva para essa página.",
  },
  partText(
    "os-sh-placeholder",
    "Texto dentro da pesquisa",
    "os-sh-q",
    "placeholder",
    SH_TEXTS.placeholder,
    "aria-label",
  ),
  headerText("data-os-sh-found", "Linha de resultados ({busca} = o que foi buscado)", SEARCH_TEXTS.found),
  headerText("data-os-sh-empty", "Sem resultados", SEARCH_TEXTS.empty),
  headerText("data-os-sh-all", "Link para ver todos", SEARCH_TEXTS.all),
  partText("os-sh-go-label", "Nome da lupa (leitores de tela)", "os-sh-go", "aria-label", SH_TEXTS.go),
  heading("Ao rolar", "sh-rolar"),
  checkAttr("data-os-sticky", "Fixo no topo ao rolar", false),
  {
    type: "os-note",
    name: "os-sh-sticky-note",
    label:
      "Ligado: na página, o cabeçalho fica preso no topo enquanto a pessoa rola, sem cobrir o começo da página (abaixo da “Contagem no topo”, se houver).",
  },
  heading("Cores", "sh-cores"),
  themeTrait,
  colorTrait("bg", "Fundo"),
  colorTrait("ink", "Texto e ícones"),
  colorTrait("box", "Fundo do campo de pesquisa"),
  colorTrait("go", "Botão da pesquisa"),
  colorTrait("goInk", "Lupa"),
  colorTrait("catsBg", "Fundo das categorias"),
  colorTrait("catsInk", "Texto das categorias"),
  colorTrait("stripBg", "Faixa de aviso: fundo"),
  colorTrait("stripInk", "Faixa de aviso: texto"),
];

/**
 * Endereço do logo, do "Entre", do carrinho e das categorias: "meusite.com"
 * ganha o https:// e digitar um endereço desliga o link da oferta ligado antes.
 */
const hrefTrait: TraitDef = {
  type: "text",
  name: "href",
  label: "Endereço do link",
  placeholder: "https://…",
  getValue: ({ component }) => {
    const href = attr(component, "href");
    return href === "#" || href.startsWith(INTERNAL_LINK_PREFIX) ? "" : href;
  },
  setValue: ({ component, value }) => {
    const href = withScheme(String(value ?? "")) || "#";
    component.addAttributes({ href });
    if (href !== "#" && "data-os-link" in component.getAttributes()) component.removeAttributes("data-os-link");
  },
};

const LINK_TRAITS: TraitDef[] = [
  hrefTrait,
  {
    type: "text",
    name: "aria-label",
    label: "Nome para leitores de tela",
    placeholder: "Ex.: Carrinho",
  },
];

const CAT_TRAITS: TraitDef[] = [
  {
    type: "os-note",
    name: "os-sh-cat-note",
    label:
      "Sem destino, o clique busca o nome desta categoria nos produtos (como a pesquisa). Para levar a uma página, escolha abaixo.",
  },
  hrefTrait,
];

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Partes fixas da estrutura: não saem, não se mexem e não recebem outros elementos. */
const FIXED = { draggable: false, droppable: false, removable: false, copyable: false };

/** Clique num link do canvas não navega (o tipo "link" do GrapesJS faz o mesmo). */
const preventLink = (e: Event) => e.preventDefault();

const BOX_NAME: Record<string, string> = {
  "os-sh-main": "Linha principal",
  "os-sh-in": "Conteúdo",
  "os-sh-loc": "Local de entrega",
  "os-sh-loc-t": "Textos",
  "os-sh-search": "Pesquisa",
  "os-sh-cats": "Categorias",
};
const TEXT_NAME: Record<string, string> = {
  "os-sh-strip": "Faixa de aviso",
  "os-sh-loc-1": "Local de entrega (linha 1)",
  "os-sh-loc-2": "Local de entrega (linha 2)",
  "os-sh-acc-t": "Texto do “Entre”",
};
const LINK_NAME: Record<string, string> = {
  "os-sh-logo": "Link do logo",
  "os-sh-acc": "“Entre” (conta)",
  "os-sh-cart": "Carrinho",
};

const classIn = (node: HTMLElement, names: Record<string, string>) =>
  Object.keys(names).find((cls) => node.classList?.contains(cls));
const nameIn = (c: Component, names: Record<string, string>, fallback: string) => {
  const custom = c.get("custom-name");
  if (custom) return String(custom);
  const cls = c.getClasses().find((k: string) => names[k]);
  return cls ? names[cls] : fallback;
};

const selectHeader = { select: (c: Component) => headerOf(c) ?? c };

const iconHtml = (c: Component) => {
  const name = attr(c, "data-os-sh-icon");
  return isShIcon(name) ? SH_ICONS[name] : "";
};

/** Marca só do canvas: categoria sem destino que não acha nenhum produto da página. */
export const LOST_CATEGORY_MARK = "data-os-cv-nada";

/**
 * Confere as categorias sem destino do canvas contra os produtos da página
 * (como a busca da página faz: nome + selo do produto e título da vitrine).
 * Página sem vitrine: a busca vai para a página da loja (o aviso do cabeçalho
 * cuida dela), nada a marcar aqui.
 */
function markLostCategories(editor: Editor) {
  const doc = editor.Canvas.getDocument();
  if (!doc) return;
  const cats = Array.from(doc.querySelectorAll<HTMLElement>("a.os-sh-cat"));
  if (!cats.length) return;
  const texts: string[] = [];
  for (const shop of Array.from(doc.querySelectorAll('[data-os-widget="products"]'))) {
    const title = shop.querySelector(".os-pd-title");
    if (title && shop.getAttribute("data-os-show-title") !== "0") texts.push(title.textContent || "");
    const badges = shop.getAttribute("data-os-show-badge") !== "0";
    for (const card of Array.from(shop.querySelectorAll("a[data-os-product]"))) {
      const name = card.querySelector(".os-pd-name")?.textContent || "";
      texts.push(`${name} ${badges ? card.getAttribute("data-os-pd-badge") || "" : ""}`);
    }
  }
  const hasShops = !!doc.querySelector('[data-os-widget="products"]');
  for (const cat of cats) {
    const q = (cat.textContent || "").replace(/\s+/g, " ").trim();
    const lost =
      hasShops &&
      !!q &&
      !leads(cat.getAttribute("href") ?? "") &&
      !cat.getAttribute("data-os-link") &&
      !cat.hasAttribute("data-os-pay") &&
      !texts.some((t) => matchesSearch(t, q));
    if (lost !== cat.hasAttribute(LOST_CATEGORY_MARK)) cat.toggleAttribute(LOST_CATEGORY_MARK, lost);
  }
}

/** Confere as categorias quando a página muda (um pouco depois: várias mudanças viram uma conferência). */
function watchLostCategories(editor: Editor) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = editorTimeout(editor, () => markLostCategories(editor), 150);
  };
  editor.on("load component:add component:remove component:update canvas:frame:load:body", schedule);
}

/**
 * Regras do cabeçalho gravadas antes das declarações de lugar (SH_PLACE_RULES:
 * o cabeçalho, a linha de categorias e as caixas de dentro): ganham, ao abrir,
 * as que faltam — o GrapesJS não troca uma regra que o projeto já tem pelo CSS
 * novo do tipo (uma regra nova do tipo, ele põe sozinho ao abrir). O que a
 * regra já tem fica (inclusive uma mudança feita no painel Estilo; "margin"
 * conta como presente com "margin-top"…). Fora do Desfazer: vai para a página
 * no próximo salvamento.
 */
function completeHeaderRules(editor: Editor) {
  for (const [selector, place] of SH_PLACE_RULES) {
    const rule = editor.Css.getRule(selector);
    if (!rule) continue;
    const style = rule.getStyle() as Style;
    const has = (prop: string) => Object.keys(style).some((k) => k === prop || k.startsWith(`${prop}-`));
    const missing = Object.entries(place).filter(([prop]) => !has(prop));
    if (missing.length) editor.UndoManager.skip(() => rule.setStyle({ ...style, ...Object.fromEntries(missing) }));
  }
}

export function registerStoreHeaderTypes(editor: Editor) {
  const dc = editor.DomComponents;
  watchLostCategories(editor);
  watchHeaderPlace(editor);
  editor.on("load", () => completeHeaderRules(editor));
  watchLogos(editor, LOGO, (c) => isStoreHeader(c) || c.get("type") === SH_LOGO_TYPE);

  dc.addType(STORE_HEADER_TYPE, {
    isComponent: (node) => node.getAttribute?.("data-os-widget") === "store-header",
    model: {
      defaults: {
        name: "Cabeçalho de loja",
        droppable: false,
        // Um cabeçalho dentro de outro não faz sentido; arrastado, só solta no nível de
        // cima da página (largura toda) ou num bloco que começa escondido (store-header-place.ts).
        draggable: (_h: Component, target: Component) => !headerOf(target) && headerDropAllowed(editor, target),
        traits: HEADER_TRAITS,
        styles: STORE_HEADER_CSS,
      },
    },
  });

  dc.addType(SH_BOX_TYPE, {
    isComponent: (node) => !!classIn(node, BOX_NAME),
    model: {
      defaults: { ...FIXED, delegate: selectHeader },
      getName(this: Component) {
        return nameIn(this, BOX_NAME, "Caixa");
      },
    },
  });

  // Depois da caixa (o GrapesJS confere do último tipo para o primeiro): a lista das categorias.
  dc.addType(SH_CATS_TYPE, {
    isComponent: (node) =>
      node.tagName === "DIV" &&
      (node.classList?.contains("os-sh-in") ?? false) &&
      !!node.parentElement?.classList.contains("os-sh-cats"),
    model: {
      defaults: {
        name: "Categorias",
        draggable: false,
        removable: false,
        copyable: false,
        // Só categorias entram aqui (arrastar nas Camadas ou pela barra da categoria).
        droppable: ".os-sh-cat",
        delegate: selectHeader,
      },
    },
  });

  dc.addType(SH_TEXT_TYPE, {
    extend: "text",
    isComponent: (node) => !!classIn(node, TEXT_NAME),
    model: {
      defaults: { ...FIXED },
      getName(this: Component) {
        return nameIn(this, TEXT_NAME, "Texto");
      },
    },
  });

  dc.addType(SH_LINK_TYPE, {
    isComponent: (node) => node.tagName === "A" && !!classIn(node, LINK_NAME),
    model: {
      defaults: { tagName: "a", ...FIXED, traits: LINK_TRAITS },
      getName(this: Component) {
        return nameIn(this, LINK_NAME, "Link");
      },
    },
    view: {
      onRender({ el }: { el: HTMLElement }) {
        el.addEventListener("click", preventLink, true);
      },
    },
  });

  // Logo: o clique seleciona a imagem (não o link em volta); o tamanho vem de
  // "Altura do logo" (sem as alças de redimensionar, que gravariam um tamanho
  // fixo por cima do do celular). Ao carregar, a proporção da imagem vai para
  // o cabeçalho (syncLogoRatio).
  dc.addType(SH_LOGO_TYPE, {
    extend: "image",
    isComponent: (node) => node.tagName === "IMG" && (node.classList?.contains("os-sh-logo-img") ?? false),
    model: {
      defaults: { name: "Logo", ...FIXED, resizable: false, [CLICK_SELF_PROP]: true, traits: LOGO_TRAITS },
    },
    view: {
      onRender({ el, model }: { el: HTMLElement; model: Component }) {
        watchLogoImage(editor, LOGO, model, el);
      },
    },
  });

  dc.addType(SH_INPUT_TYPE, {
    isComponent: (node) => node.tagName === "INPUT" && (node.classList?.contains("os-sh-q") ?? false),
    model: { defaults: { name: "Campo de pesquisa", ...FIXED, delegate: selectHeader } },
  });

  dc.addType(SH_GO_TYPE, {
    isComponent: (node) => node.tagName === "BUTTON" && (node.classList?.contains("os-sh-go") ?? false),
    model: { defaults: { tagName: "button", name: "Botão da pesquisa", ...FIXED, delegate: selectHeader } },
  });

  // Ícones gerados: os filhos salvos são ignorados ao abrir (o SVG vem de SH_ICONS).
  dc.addType(SH_ICON_TYPE, {
    isComponent: (node) =>
      isShIcon(node.getAttribute?.("data-os-sh-icon")) ? { type: SH_ICON_TYPE, components: [] } : false,
    model: {
      defaults: {
        name: "Ícone",
        ...FIXED,
        editable: false,
        layerable: false,
        // Clicar no ícone seleciona o link dele ("Entre", carrinho) ou o cabeçalho.
        delegate: {
          select: (c: Component) => {
            const parent = c.parent();
            return parent?.get("type") === SH_LINK_TYPE ? parent : (headerOf(c) ?? c);
          },
        },
      },
      getInnerHTML(this: Component) {
        return iconHtml(this);
      },
    },
    view: {
      onRender({ el, model }: { el: HTMLElement; model: Component }) {
        el.innerHTML = iconHtml(model);
      },
    },
  });

  dc.addType(SH_CAT_TYPE, {
    extend: "link",
    isComponent: (node) => node.tagName === "A" && (node.classList?.contains("os-sh-cat") ?? false),
    model: {
      defaults: {
        name: "Categoria",
        droppable: false,
        draggable: ".os-sh-cats .os-sh-in",
        traits: CAT_TRAITS,
      },
      // Nas camadas: "Categoria · Fones".
      getName(this: Component) {
        const custom = this.get("custom-name");
        if (custom) return String(custom);
        const el = this.getEl();
        const text = (el ? (el.textContent ?? "") : this.getInnerHTML().replace(/<[^>]*>/g, ""))
          .replace(/\s+/g, " ")
          .trim();
        return text ? `Categoria · ${text.length > 30 ? `${text.slice(0, 29).trimEnd()}…` : text}` : "Categoria";
      },
    },
  });
}

// ─── Cópia para as páginas de produto ────────────────────────────────────────

/**
 * O cabeçalho de loja da página (o primeiro), com as regras de CSS dele (cores
 * escolhidas, mudanças de estilo): vai para as páginas de produto criadas a
 * partir da vitrine (src/server/services/store.ts). null = a página não tem.
 */
export function storeHeaderCopy(editor: Editor): { html: string; css: string } | null {
  const header = editor.getWrapper()?.find('[data-os-widget="store-header"]')[0];
  if (!header) return null;
  return { html: header.toHTML(), css: componentCss(editor, header) };
}
