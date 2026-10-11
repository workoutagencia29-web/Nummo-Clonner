/**
 * Cabeçalho de loja (data-os-widget="store-header"): o CSS da página, as cores
 * prontas, os ícones e a definição do bloco "Cabeçalho de loja" (categoria
 * "Loja"). Sem GrapesJS aqui.
 *
 * Estrutura (classes os-sh-*; o script da página, src/runtime/widgets/store.ts,
 * lê o campo, a lupa, o logo e as categorias):
 *
 *   header.os-store-header[data-os-widget=store-header][data-os-sticky="0"|"1"]
 *          [data-os-sh-strip|-search|-loc|-account|-cart|-cats = "1" liga / "0" desliga]
 *          [data-os-sh-found / -empty / -all: textos da linha de resultados]
 *          [data-os-sh-logo-pos / -pos-m = "left"|"center"|"right": lugar do logo
 *           no computador / no celular; sem o atributo, à esquerda]
 *          (altura do logo: variável --os-sh-logo-h no estilo do cabeçalho, como as cores;
 *           proporção da imagem do logo em --os-sh-logo-r, gravada pelo editor)
 *     div.os-sh-strip                                   (texto: faixa de aviso)
 *     div.os-sh-main > div.os-sh-in
 *       a.os-sh-logo > img.os-sh-logo-img                (href = página da loja)
 *       div.os-sh-loc > span.os-sh-ico + span.os-sh-loc-t > span.os-sh-loc-1 + span.os-sh-loc-2
 *       div.os-sh-search[role=search] > input.os-sh-q[type=search] + button.os-sh-go (lupa)
 *       a.os-sh-acc > span.os-sh-ico + span.os-sh-acc-t  ("Entre"; desligado por padrão)
 *       a.os-sh-cart[aria-label]                          (nasce com data-os-link="")
 *     nav.os-sh-cats > div.os-sh-in > a.os-sh-cat × N    (link comum; sem destino = busca o texto)
 *
 * Os ícones (span.os-sh-ico[data-os-sh-icon]) não são guardados como
 * elementos no editor: o SVG vem de SH_ICONS ao desenhar e ao salvar, como as
 * partes do cartão de produto. Nenhum <form>: a busca é feita pelo script.
 * Cores em variáveis no próprio cabeçalho (--os-sh-*), com conjuntos prontos.
 */
import { type Def, esc, PROP_AUTO_LINK, type Style } from "@/editor/blocks/shared";
import { SEARCH_TEXTS } from "@/lib/store-search";

export const STORE_HEADER_TYPE = "os-store-header";
/** Caixas fixas da estrutura (linha principal, local de entrega, pesquisa, categorias). */
export const SH_BOX_TYPE = "os-sh-box";
/** Lista das categorias (só categorias entram). */
export const SH_CATS_TYPE = "os-sh-cats";
/** Textos fixos (faixa de aviso, local de entrega, "Entre"). */
export const SH_TEXT_TYPE = "os-sh-text";
/** Logo, "Entre" e carrinho: links que não viram texto editável. */
export const SH_LINK_TYPE = "os-sh-link";
export const SH_LOGO_TYPE = "os-sh-logo-img";
export const SH_ICON_TYPE = "os-sh-icon";
export const SH_INPUT_TYPE = "os-sh-input";
export const SH_GO_TYPE = "os-sh-go";
export const SH_CAT_TYPE = "os-sh-cat";

/** Partes que dá para ligar/desligar: [chave (data-os-sh-<chave>), rótulo, classe, padrão]. */
export const SH_PARTS = [
  ["strip", "Faixa de aviso", "os-sh-strip", true],
  ["search", "Campo de pesquisa", "os-sh-search", true],
  ["loc", "Local de entrega", "os-sh-loc", true],
  ["account", "“Entre” (conta)", "os-sh-acc", false],
  ["cart", "Carrinho", "os-sh-cart", true],
  ["cats", "Linha de categorias", "os-sh-cats", true],
] as const;
export type ShPart = (typeof SH_PARTS)[number][0];

/** Textos do bloco novo (o usuário troca pelos dele; tudo editável, também em espanhol/inglês). */
export const SH_TEXTS = {
  strip: "🚚 Frete grátis em todo o site",
  loc1: "Entrega em",
  loc2: "todo o Brasil",
  account: "Entre",
  placeholder: "Buscar produtos, marcas e muito mais…",
  searchLabel: "Buscar produtos",
  go: "Buscar",
  cart: "Carrinho",
  cats: "Categorias",
  logo: "Logo da loja",
  newCategory: "Nova categoria",
} as const;

/**
 * Categorias do bloco novo: batem com os produtos de exemplo das vitrines (nome,
 * selo ou título da vitrine — regras de src/lib/store-search.ts), assim a página
 * não nasce cheia de avisos de "categoria que não acha nenhum produto".
 */
export const SH_CATEGORIES = ["Ofertas do dia", "Mais vendidos", "Fones", "Smartwatch", "Air fryer", "Tênis"];

// ─── Cores ───────────────────────────────────────────────────────────────────

/** Variável de cada cor (a mesma no CSS e nas Configurações). */
export const SH_VARS = {
  bg: "--os-sh-bg",
  ink: "--os-sh-ink",
  box: "--os-sh-box",
  go: "--os-sh-go",
  goInk: "--os-sh-go-ink",
  catsBg: "--os-sh-cats-bg",
  catsInk: "--os-sh-cats-ink",
  stripBg: "--os-sh-strip-bg",
  stripInk: "--os-sh-strip-ink",
  line: "--os-sh-line",
} as const;
export type ShColor = keyof typeof SH_VARS;

export type ShThemeId = "amarelo" | "azul" | "laranja" | "branco";

/**
 * Cores prontas (nomes neutros; tons de marketplace, sem copiar marca nenhuma).
 * A primeira é a do CSS (padrão do bloco). Texto sobre os fundos com contraste
 * de pelo menos 4,5:1 (letra pequena das categorias e da faixa).
 */
export const SH_THEMES: Record<ShThemeId, { label: string; colors: Record<ShColor, string> }> = {
  amarelo: {
    label: "Amarelo",
    colors: {
      bg: "#ffe94d",
      ink: "#333333",
      box: "#ffffff",
      go: "#ffffff",
      goInk: "#666666",
      catsBg: "#ffe94d",
      catsInk: "#4a4a4a",
      stripBg: "#08793c",
      stripInk: "#ffffff",
      line: "rgba(0,0,0,.08)",
    },
  },
  azul: {
    label: "Azul-escuro",
    colors: {
      bg: "#141c27",
      ink: "#ffffff",
      box: "#ffffff",
      go: "#f6b45e",
      goInk: "#141c27",
      catsBg: "#243041",
      catsInk: "#ffffff",
      stripBg: "#243041",
      stripInk: "#ffffff",
      line: "transparent",
    },
  },
  laranja: {
    label: "Laranja",
    colors: {
      bg: "#d13f1c",
      ink: "#ffffff",
      box: "#ffffff",
      go: "#d13f1c",
      goInk: "#ffffff",
      catsBg: "#d13f1c",
      catsInk: "#ffffff",
      stripBg: "#a9310d",
      stripInk: "#ffffff",
      line: "transparent",
    },
  },
  branco: {
    label: "Branco",
    colors: {
      bg: "#ffffff",
      ink: "#1f2937",
      box: "#f2f4f7",
      go: "#2a6fdb",
      goInk: "#ffffff",
      catsBg: "#ffffff",
      catsInk: "#374151",
      stripBg: "#1f2937",
      stripInk: "#ffffff",
      line: "#e5e7eb",
    },
  },
};
export const SH_THEME_IDS = Object.keys(SH_THEMES) as ShThemeId[];
export const SH_DEFAULT_THEME: ShThemeId = "amarelo";
const D = SH_THEMES[SH_DEFAULT_THEME].colors;

export const isShTheme = (v: unknown): v is ShThemeId => SH_THEME_IDS.includes(v as ShThemeId);

/** Cor padrão (a do CSS, sem nada trocado no cabeçalho). */
export const shDefaultColor = (color: ShColor) => D[color];

/**
 * Estilo próprio do cabeçalho para um conjunto de cores (as variáveis). As
 * cores iguais às do CSS saem vazias: o padrão volta a valer sozinho.
 */
export function shThemeStyle(id: ShThemeId): Style {
  const style: Style = {};
  for (const color of Object.keys(SH_VARS) as ShColor[]) {
    const value = SH_THEMES[id].colors[color];
    style[SH_VARS[color]] = value === D[color] ? "" : value;
  }
  return style;
}

/** Conjunto pronto com exatamente essas cores ("" = cores personalizadas). */
export function matchShTheme(colors: Record<ShColor, string>): ShThemeId | "" {
  const same = (a: string, b: string) => a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();
  return (
    SH_THEME_IDS.find((id) =>
      (Object.keys(SH_VARS) as ShColor[]).every((c) => same(colors[c], SH_THEMES[id].colors[c])),
    ) ?? ""
  );
}

// ─── Ícones ──────────────────────────────────────────────────────────────────

const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

/** SVG de cada ícone (cor do texto: currentColor). */
export const SH_ICONS = {
  pin: svg(
    '<path d="M12 21s-6.5-5.8-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.2-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  ),
  search: svg('<circle cx="10.5" cy="10.5" r="6.2"/><path d="M15.2 15.2L20 20"/>'),
  user: svg('<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c1.1-3.7 4-5.4 7.5-5.4s6.4 1.7 7.5 5.4"/>'),
  cart: svg(
    '<path d="M2.8 4h2.4l2.4 11.2h10.6l2.2-8H6.3"/><circle cx="9.6" cy="19.2" r="1.3"/><circle cx="16.8" cy="19.2" r="1.3"/>',
  ),
} as const;
export type ShIcon = keyof typeof SH_ICONS;
export const isShIcon = (v: unknown): v is ShIcon => typeof v === "string" && v in SH_ICONS;

// ─── Logo: lugar e tamanho ───────────────────────────────────────────────────

/** Lugar do logo no computador (a partir de 769 px) e no celular. Sem o atributo: à esquerda. */
export const SH_LOGO_POS_ATTR = "data-os-sh-logo-pos";
export const SH_LOGO_POS_M_ATTR = "data-os-sh-logo-pos-m";
export const SH_LOGO_POSITIONS = [
  ["left", "Esquerda"],
  ["center", "Centro"],
  ["right", "Direita"],
] as const;
export type ShLogoPos = (typeof SH_LOGO_POSITIONS)[number][0];
export const isShLogoPos = (v: unknown): v is ShLogoPos => SH_LOGO_POSITIONS.some(([id]) => id === v);

/**
 * Altura do logo no computador (px), na variável --os-sh-logo-h do estilo do
 * cabeçalho (como as cores; sem ela, 40 px). No celular: 85% dela, até 48 px.
 * A largura acompanha a proporção da imagem, até um máximo (logos largos
 * diminuem para caber, sem cortar nem esticar).
 */
export const SH_LOGO_H_VAR = "--os-sh-logo-h";
export const SH_LOGO_H = { def: 40, min: 20, max: 120 } as const;
/**
 * Proporção da imagem do logo (largura ÷ altura), no estilo do cabeçalho: o
 * editor grava ao carregar a imagem (widgets/store-header.ts). Com ela, o
 * logo largo para de crescer na altura em que chega à largura máxima — a
 * caixa acompanha o desenho, sem faixa vazia em cima e embaixo. Sem ela
 * (página gravada antes e ainda não aberta), vale só a altura escolhida.
 */
export const SH_LOGO_R_VAR = "--os-sh-logo-r";
/** Largura máxima do logo no computador (px; logos largos diminuem para caber). */
export const SH_LOGO_MAX_W = 280;

/** Logo provisório ("SUA LOJA" numa caixa tracejada), legível em qualquer cor de fundo. */
export function storeLogoPlaceholder(label = "SUA LOJA") {
  const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="56" viewBox="0 0 200 56"><rect x="1.5" y="1.5" width="197" height="53" rx="10" fill="#ffffff" fill-opacity=".92" stroke="#9aa3b2" stroke-width="2" stroke-dasharray="6 5"/><text x="100" y="36" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="21" font-weight="800" letter-spacing="1" fill="#4b5563" text-anchor="middle">${esc(label)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const P = ".os-store-header";
const V = SH_VARS;
/** Esconde só da vista (leitores de tela leem). */
const SR_ONLY =
  "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0";

/** Parte desligada não aparece (o "Entre" liga com "1"; o resto desliga com "0"). */
const HIDE_RULES = SH_PARTS.map(([key, , cls, def]) =>
  def ? `${P}[data-os-sh-${key}="0"] .${cls}` : `${P}:not([data-os-sh-${key}="1"]) .${cls}`,
);

const varsCss = (Object.keys(V) as ShColor[]).map((c) => `${V[c]}:${D[c]}`).join(";");

const declarations = (style: Style) =>
  Object.entries(style)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

/**
 * Lugar e tamanho do cabeçalho: largura toda, no fluxo da página. Também zera o
 * que o CSS de uma página clonada põe no elemento <header> (fixo, deslocado,
 * flutuando, estreito, centralizado, com altura, borda, sombra, imagem de
 * fundo, escondido ou transparente…): esse CSS fica em @layer os-original e as
 * regras do cabeçalho (fora de camada, sem !important) vencem. O "Fixo no
 * topo" (classe os-top, com !important e o top posto pelo script) continua
 * valendo por cima. Visibilidade herdada (não "visible"): dentro de algo
 * escondido de propósito, continua escondido. Páginas gravadas antes ganham,
 * ao abrir, o que faltar na regra delas (completeHeaderRules,
 * widgets/store-header.ts; SH_PLACE_RULES).
 */
export const SH_PLACE: Style = {
  position: "relative",
  top: "auto",
  right: "auto",
  bottom: "auto",
  left: "auto",
  "z-index": "auto",
  float: "none",
  clear: "both",
  display: "block",
  "box-sizing": "border-box",
  width: "100%",
  "min-width": "0",
  "max-width": "none",
  height: "auto",
  "min-height": "0",
  "max-height": "none",
  margin: "0",
  padding: "0",
  transform: "none",
  visibility: "inherit",
  opacity: "1",
  "border-top-width": "0",
  "border-right-width": "0",
  "border-left-width": "0",
  "border-radius": "0",
  "box-shadow": "none",
  "background-image": "none",
};

/**
 * A linha de categorias é um <nav>: o mesmo para o CSS de página clonada que
 * pega o elemento <nav> (inclusive o menu do celular, escondido por
 * visibility/opacity até abrir).
 */
export const SH_CATS_PLACE: Style = {
  position: "static",
  float: "none",
  display: "block",
  width: "auto",
  "max-width": "none",
  height: "auto",
  "min-height": "0",
  "max-height": "none",
  margin: "0",
  padding: "0",
  transform: "none",
  visibility: "inherit",
  opacity: "1",
  "border-top-width": "0",
  "border-right-width": "0",
  "border-bottom-width": "0",
  "border-left-width": "0",
  "background-image": "none",
};

/**
 * Caixas <div> de dentro do cabeçalho (faixa de aviso, linha principal, o
 * conteúdo de cada linha): o CSS de página clonada para os filhos do <header>
 * (`header > div`, `header div` como contêiner centralizado, flex, alto…) não
 * as estreita nem as tira do lugar.
 */
const SH_BOX_PLACE: Style = {
  position: "static",
  float: "none",
  width: "auto",
  "min-width": "0",
  height: "auto",
  "min-height": "0",
  transform: "none",
};
const SH_STRIP_PLACE: Style = { ...SH_BOX_PLACE, "max-width": "none" };
const SH_MAIN_PLACE: Style = {
  ...SH_BOX_PLACE,
  display: "block",
  "max-width": "none",
  margin: "0",
  padding: "0",
};
/** `.os-sh-in` (linha principal e categorias) mantém a largura máxima dela, centralizada. */
const SH_IN_PLACE: Style = { ...SH_BOX_PLACE, "justify-content": "flex-start" };

// Logo: tamanho e lugar. Regras com seletor próprio (mais fortes que as de antes):
// numa página gravada antes, o GrapesJS mantém a regra `.os-sh-logo-img` antiga
// (40 px fixos) e acrescenta estas sozinho ao abrir.

const LOGO_H = `var(${SH_LOGO_H_VAR},${SH_LOGO_H.def}px)`;
/** Proporção do logo (sem ela, um número pequeno: o limite de altura que sai dela não pesa). */
const LOGO_R = `var(${SH_LOGO_R_VAR},.01)`;
/**
 * Celular: o que sobra na linha de cima para o logo (respiro dos lados, o
 * "Entre" e o carrinho, só os ícones) — nunca empurra nem cobre os ícones.
 */
const LOGO_ROOM_MOBILE = "100vw - 112px";

/**
 * Regra do tamanho do logo (no celular, a da tela pequena troca a altura e os
 * limites): a altura escolhida, a largura da proporção da imagem (até o
 * máximo) e, com a proporção, a altura limitada à que cabe nessa largura (o
 * navegador acerta a largura pela altura limitada).
 * Também zera o que o CSS de uma página clonada põe nas imagens do <header>
 * (imagem de fundo de um "header herói": absoluta, cobrindo, atrás, apagada;
 * alturas mínimas e máximas) — esse CSS fica em @layer os-original e esta
 * regra (fora de camada) vence. Páginas gravadas antes ganham, ao abrir, o que
 * faltar (SH_PLACE_RULES).
 */
const SH_LOGO_IMG: Style = {
  width: "auto",
  "max-width": `${SH_LOGO_MAX_W}px`,
  height: LOGO_H,
  "max-height": `calc(${SH_LOGO_MAX_W}px / ${LOGO_R})`,
  position: "static",
  top: "auto",
  right: "auto",
  bottom: "auto",
  left: "auto",
  "z-index": "auto",
  float: "none",
  transform: "none",
  "min-width": "0",
  "min-height": "0",
  opacity: "1",
  visibility: "inherit",
  filter: "none",
};

/**
 * Links do cabeçalho (logo, "Entre", carrinho e categorias): o mesmo para o CSS
 * de página clonada que pega os <a> do <header> (absolutos, deslocados,
 * estreitos, altos, transparentes, com fundo ou borda). As regras de cada link
 * continuam com o display, as margens, o espaçamento e as cores deles.
 * Relativo (não estático): o aviso "Escolha o link da oferta" do canvas se
 * prende ao link.
 */
const SH_LINK_PLACE: Style = {
  position: "relative",
  top: "auto",
  right: "auto",
  bottom: "auto",
  left: "auto",
  "z-index": "auto",
  float: "none",
  transform: "none",
  width: "auto",
  height: "auto",
  "min-width": "0",
  "min-height": "0",
  "max-width": "none",
  "max-height": "none",
  opacity: "1",
  visibility: "inherit",
  "border-top-width": "0",
  "border-right-width": "0",
  "border-bottom-width": "0",
  "border-left-width": "0",
  "background-color": "transparent",
  "background-image": "none",
  "box-shadow": "none",
};

/** Linha principal com o logo nesta posição (computador ou celular). */
const logoRow = (pos: ShLogoPos, mobile = false) =>
  `${P}[${mobile ? SH_LOGO_POS_M_ATTR : SH_LOGO_POS_ATTR}="${pos}"] .os-sh-main .os-sh-in`;
/** Célula da grade (propriedades simples, sem o atalho grid-column). */
const cell = (col: number, row: number, cols = 1) =>
  `grid-column-start:${col};grid-column-end:${col + cols};grid-row-start:${row};grid-row-end:${row + 1}`;
/** Três colunas, as dos lados do mesmo tamanho: o logo fica exatamente no meio. */
const GRID3 = "display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center";
/** Carrinho (ícone de 28 px) e o espaço antes dele: o "Entre" fica à esquerda dele, na mesma coluna. */
const CART_ROOM = 46;

const C = logoRow("center");
const R = logoRow("right");
const CM = logoRow("center", true);
const RM = logoRow("right", true);

/**
 * Logo no centro ou à direita. Computador (a partir de 769 px) — centro: local
 * de entrega à esquerda, logo no meio, "Entre"/carrinho à direita e a pesquisa
 * numa linha própria embaixo (larga, centralizada); direita: o logo na ponta
 * direita, os outros itens antes dele (a pesquisa continua no meio). Celular —
 * centro: "Entre" à esquerda, logo no meio, carrinho à direita; direita: os
 * ícones à esquerda e o logo na ponta direita. Parte desligada só some (a
 * grade não depende dela). Sem gap (Safari 13): espaços com margem.
 *
 * Computador estreito (a partir de 769 px) com logo largo e textos longos: a
 * pesquisa cede primeiro (largura base 0: ela só ocupa o que sobra) até 140
 * px; depois o local de entrega e o "Entre" encolhem (os textos terminam em
 * "…") — a linha nunca passa da largura da tela (à direita, o que passasse
 * sairia pela esquerda, sem rolagem para ver).
 */
const LOGO_POS_CSS = [
  `@media (min-width:769px){${P} .os-sh-loc{flex-shrink:1;min-width:0}` +
    `${P} .os-sh-loc-t{min-width:0;overflow:hidden}` +
    `${P} .os-sh-loc-1,${P} .os-sh-loc-2{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}` +
    `${P} .os-sh-search{flex-basis:0px;min-width:140px}` +
    `${P} .os-sh-acc{flex-shrink:1;min-width:0}` +
    `${P} .os-sh-acc-t{min-width:0;overflow:hidden;text-overflow:ellipsis}` +
    `${C}{${GRID3}}` +
    `${C} .os-sh-logo{${cell(2, 1)};justify-self:center;margin:0 20px}` +
    `${C} .os-sh-loc{${cell(1, 1)};justify-self:start;max-width:100%;margin:0}` +
    `${C} .os-sh-acc{${cell(3, 1)};justify-self:end;max-width:calc(100% - ${CART_ROOM}px);margin:0 ${CART_ROOM}px 0 0}` +
    `${P}[${SH_LOGO_POS_ATTR}="center"][data-os-sh-cart="0"] .os-sh-main .os-sh-in .os-sh-acc{max-width:100%;margin-right:0}` +
    `${C} .os-sh-cart{${cell(3, 1)};justify-self:end;margin:0}` +
    `${C} .os-sh-search{${cell(1, 2, 3)};justify-self:center;width:100%;max-width:720px;margin:10px 0 0}` +
    `${R}{justify-content:flex-end}` +
    `${R} .os-sh-loc{order:1}${R} .os-sh-search{order:2}${R} .os-sh-acc{order:3}${R} .os-sh-cart{order:4}` +
    `${R} .os-sh-logo{order:5;margin:0 0 0 20px}}`,
  `@media (max-width:768px){${CM}{${GRID3}}` +
    `${CM} .os-sh-logo{${cell(2, 1)};justify-self:center;margin:0 10px}` +
    `${CM} .os-sh-acc{${cell(1, 1)};justify-self:start;margin:0}` +
    `${CM} .os-sh-cart{${cell(3, 1)};justify-self:end;margin:0}` +
    `${CM} .os-sh-search{${cell(1, 2, 3)};margin:8px 0 0}` +
    `${CM} .os-sh-loc{${cell(1, 3, 3)};margin:8px 0 0}` +
    `${RM} .os-sh-acc{order:1;margin:0 14px 0 0}${RM} .os-sh-cart{order:2;margin:0}` +
    `${RM} .os-sh-logo{order:3;margin:0 0 0 auto}}`,
];

/**
 * Regras do cabeçalho com declarações de lugar (seletor → declarações): as
 * gravadas antes ganham, ao abrir, as que faltam (completeHeaderRules).
 */
export const SH_PLACE_RULES: [string, Style][] = [
  [".os-store-header", SH_PLACE],
  [".os-store-header .os-sh-strip", SH_STRIP_PLACE],
  [".os-store-header .os-sh-main", SH_MAIN_PLACE],
  [".os-store-header .os-sh-in", SH_IN_PLACE],
  [".os-store-header .os-sh-loc", { padding: "0" }],
  [".os-store-header .os-sh-cats", SH_CATS_PLACE],
  [".os-store-header .os-sh-in > a", SH_LINK_PLACE],
  [".os-store-header .os-sh-logo .os-sh-logo-img", SH_LOGO_IMG],
];

/**
 * CSS da página (vira regras editáveis do projeto, como o da vitrine). Com
 * var(), só propriedades simples; um só :hover por @media; sem !important.
 * Sem gap de flex (Safari 13): espaços com margem. Campo de pesquisa com 16 px
 * (abaixo disso o Safari do iPhone amplia a página ao tocar nele). No celular (até 768 px):
 * linha 1 logo + "Entre" (só o ícone) + carrinho, linha 2 a pesquisa inteira,
 * o local de entrega numa linha pequena e as categorias rolando para o lado.
 * As regras de desligar vêm por último.
 */
export const STORE_HEADER_CSS = [
  `${P}{${varsCss};${declarations(SH_PLACE)};border-bottom-width:1px;border-bottom-style:solid;border-bottom-color:var(${V.line});background-color:var(${V.bg});color:var(${V.ink});font-family:inherit;font-size:14px;line-height:1.3;text-align:left}`,
  // Camada (escurecer a foto de um "header herói") ou enfeite que a página clonada põe
  // em header::before/::after e nav::before/::after: cobriria o cabeçalho e os cliques.
  `header${P}::before,header${P}::after,${P} .os-sh-cats::before,${P} .os-sh-cats::after{content:none}`,
  `${P} *,${P} *::before,${P} *::after{box-sizing:border-box}`,
  `${P} .os-sh-strip{display:block;margin:0;padding:7px 16px;${declarations(SH_STRIP_PLACE)};background-color:var(${V.stripBg});color:var(${V.stripInk});font-size:13px;font-weight:600;line-height:1.35;text-align:center}`,
  `${P} .os-sh-main{${declarations(SH_MAIN_PLACE)}}`,
  `${P} .os-sh-in{display:flex;align-items:center;max-width:1200px;margin:0 auto;padding:10px 16px;${declarations(SH_IN_PLACE)}}`,
  `${P} .os-sh-logo{display:flex;flex:0 0 auto;align-items:center;margin:0 20px 0 0;padding:0;color:inherit;text-decoration:none}`,
  `${P} .os-sh-logo-img{display:block;margin:0;padding:0;border:0;border-radius:0;object-fit:contain}`,
  // Tamanho: a altura escolhida, a largura da proporção da imagem (até o máximo); e o lugar.
  `${P} .os-sh-logo .os-sh-logo-img{${declarations(SH_LOGO_IMG)}}`,
  // Lugar dos links (o display e as margens ficam nas regras de cada um).
  `${P} .os-sh-in > a{${declarations(SH_LINK_PLACE)}}`,
  `${P} .os-sh-ico{display:inline-block;flex:0 0 auto;width:24px;height:24px;line-height:0}`,
  `${P} .os-sh-ico svg{display:block;width:100%;height:100%}`,
  `${P} .os-sh-loc{display:flex;flex:0 0 auto;align-items:center;margin:0 20px 0 0;padding:0;color:inherit;line-height:1.2}`,
  `${P} .os-sh-loc .os-sh-ico{width:20px;height:20px;margin-right:4px;opacity:.8}`,
  `${P} .os-sh-loc-t{display:flex;flex-direction:column}`,
  `${P} .os-sh-loc-1{font-size:12px}`,
  `${P} .os-sh-loc-2{font-size:14px;font-weight:600}`,
  // margin-right:auto: o "Entre" e o carrinho encostam na direita (alinhados com a vitrine).
  `${P} .os-sh-search{display:flex;flex:1 1 auto;align-items:stretch;min-width:0;max-width:720px;height:42px;margin:0 auto 0 0;padding:0;overflow:hidden;border-radius:4px;background-color:var(${V.box});box-shadow:0 1px 2px rgba(0,0,0,.2)}`,
  `${P} .os-sh-search:focus-within{box-shadow:0 0 0 2px #1f63d6}`,
  `${P} .os-sh-q{display:block;flex:1 1 auto;width:100%;min-width:0;height:auto;margin:0;padding:0 14px;border-width:0;border-radius:0;outline:0;background-color:transparent;box-shadow:none;color:#333333;font-family:inherit;font-size:16px;line-height:1.2;text-overflow:ellipsis;-webkit-appearance:none;appearance:none}`,
  // Texto que não cabe (celular) termina em "…", nunca cortado no meio da palavra.
  `${P} .os-sh-q::placeholder{color:#757575;opacity:1;text-overflow:ellipsis}`,
  `${P} .os-sh-go{display:flex;flex:0 0 auto;align-items:center;justify-content:center;width:50px;height:auto;margin:0;padding:0;border-width:0;border-left-width:1px;border-left-style:solid;border-left-color:rgba(0,0,0,.08);border-radius:0;background-color:var(${V.go});color:var(${V.goInk});cursor:pointer}`,
  `${P} .os-sh-go .os-sh-ico{width:20px;height:20px}`,
  `${P} .os-sh-acc,${P} .os-sh-cart{display:flex;flex:0 0 auto;align-items:center;margin:0 0 0 18px;padding:0;color:inherit;font-size:14px;font-weight:600;line-height:1.2;text-decoration:none;white-space:nowrap}`,
  `${P} .os-sh-acc .os-sh-ico{margin-right:6px}`,
  `${P} .os-sh-cart .os-sh-ico{width:28px;height:28px}`,
  // Sem a pesquisa, o "Entre" e o carrinho continuam na direita.
  `${P}[data-os-sh-search="0"] .os-sh-loc{margin-right:auto}`,
  `${P}[data-os-sh-search="0"][data-os-sh-loc="0"] .os-sh-logo{margin-right:auto}`,
  `${P} .os-sh-cats{${declarations(SH_CATS_PLACE)};background-color:var(${V.catsBg});color:var(${V.catsInk})}`,
  `${P} .os-sh-cats .os-sh-in{padding:8px 16px 10px;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none}`,
  `${P} .os-sh-cats .os-sh-in::-webkit-scrollbar{display:none}`,
  `${P} .os-sh-cat{display:block;flex:0 0 auto;margin:0 22px 0 0;padding:2px 0;color:inherit;font-size:14px;line-height:1.3;text-decoration:none;white-space:nowrap}`,
  `${P} .os-sh-cat:last-child{margin-right:0}`,
  `@media (hover:hover){${P} .os-sh-cat:hover{text-decoration:underline}}`,
  `${P} a:focus-visible,${P} .os-sh-go:focus-visible{outline-width:2px;outline-style:solid;outline-color:currentColor;outline-offset:2px}`,
  `@media (max-width:768px){${P} .os-sh-strip{padding:6px 12px;font-size:12px}${P} .os-sh-main .os-sh-in{flex-wrap:wrap;padding:8px 12px 10px}${P} .os-sh-logo{order:1;margin:0 auto 0 0}${P} .os-sh-logo .os-sh-logo-img{max-width:calc(${LOGO_ROOM_MOBILE});max-height:min(48px,calc((${LOGO_ROOM_MOBILE}) / ${LOGO_R}));height:calc(${LOGO_H} * .85)}${P} .os-sh-acc{order:2;margin-left:14px}${P} .os-sh-acc-t{${SR_ONLY}}${P} .os-sh-acc .os-sh-ico{margin-right:0}${P} .os-sh-cart{order:3;margin-left:14px}${P} .os-sh-search{order:4;flex:0 0 100%;max-width:none;height:40px;margin:8px 0 0}${P} .os-sh-loc,${P}[data-os-sh-search="0"] .os-sh-loc{order:5;flex:0 0 100%;margin:8px 0 0}${P} .os-sh-loc .os-sh-ico{width:16px;height:16px}${P} .os-sh-loc-t{flex-direction:row;flex-wrap:wrap}${P} .os-sh-loc-1{margin-right:4px}${P} .os-sh-loc-1,${P} .os-sh-loc-2{font-size:12px}${P} .os-sh-cats .os-sh-in{padding:4px 12px 9px}${P} .os-sh-cat{margin-right:18px;font-size:13px}}`,
  ...LOGO_POS_CSS,
  // Por último: parte desligada não aparece.
  `${HIDE_RULES.join(",")}{display:none}`,
].join("");

// ─── Definições ──────────────────────────────────────────────────────────────

export interface StoreHeaderSpec {
  /** Cores prontas (padrão: Amarelo, o do CSS). */
  theme?: ShThemeId;
  /** Fixo no topo ao rolar (padrão: não). */
  sticky?: boolean;
  /** Partes ligadas/desligadas (o que faltar fica no padrão). */
  parts?: Partial<Record<ShPart, boolean>>;
  categories?: string[];
}

/** Ícone gerado (`html`: já desenhado, para o HTML de um modelo de página). */
const iconDef = (name: ShIcon, html = false): Def => ({
  type: SH_ICON_TYPE,
  tagName: "span",
  name: "Ícone",
  classes: ["os-sh-ico"],
  attributes: { "data-os-sh-icon": name, "aria-hidden": "true" },
  ...(html && { content: SH_ICONS[name] }),
});

const textDef = (tagName: string, cls: string, name: string, content: string): Def => ({
  type: SH_TEXT_TYPE,
  tagName,
  name,
  classes: [cls],
  content: esc(content),
});

/** Uma categoria (link comum; sem destino, o clique busca o texto dela). */
export function categoryDef(label: string): Def {
  return {
    type: SH_CAT_TYPE,
    tagName: "a",
    name: "Categoria",
    classes: ["os-sh-cat"],
    attributes: { href: "#" },
    content: esc(label),
  };
}

/**
 * O cabeçalho inteiro (bloco "Cabeçalho de loja"). `html`: para o HTML de um
 * modelo de página (ícones já desenhados).
 */
export function storeHeaderDef(spec: StoreHeaderSpec = {}, { html = false } = {}): Def {
  const icon = (name: ShIcon) => iconDef(name, html);
  const on: Record<string, boolean> = {};
  const parts: Record<string, string> = {};
  for (const [key, , , def] of SH_PARTS) {
    on[key] = spec.parts?.[key] ?? def;
    parts[`data-os-sh-${key}`] = on[key] ? "1" : "0";
  }
  const style = spec.theme && spec.theme !== SH_DEFAULT_THEME ? shThemeStyle(spec.theme) : undefined;
  return {
    type: STORE_HEADER_TYPE,
    tagName: "header",
    name: "Cabeçalho de loja",
    classes: ["os-store-header"],
    attributes: {
      "data-os-widget": "store-header",
      "data-os-sticky": spec.sticky ? "1" : "0",
      ...parts,
      "data-os-sh-found": SEARCH_TEXTS.found,
      "data-os-sh-empty": SEARCH_TEXTS.empty,
      "data-os-sh-all": SEARCH_TEXTS.all,
    },
    ...(style && { style: Object.fromEntries(Object.entries(style).filter(([, v]) => v)) }),
    components: [
      textDef("div", "os-sh-strip", "Faixa de aviso", SH_TEXTS.strip),
      {
        type: SH_BOX_TYPE,
        tagName: "div",
        name: "Linha principal",
        classes: ["os-sh-main"],
        components: [
          {
            type: SH_BOX_TYPE,
            tagName: "div",
            name: "Conteúdo",
            classes: ["os-sh-in"],
            components: [
              {
                type: SH_LINK_TYPE,
                tagName: "a",
                name: "Link do logo",
                classes: ["os-sh-logo"],
                attributes: { href: "#" },
                components: [
                  {
                    type: SH_LOGO_TYPE,
                    tagName: "img",
                    name: "Logo",
                    classes: ["os-sh-logo-img"],
                    attributes: { src: storeLogoPlaceholder(), alt: SH_TEXTS.logo },
                  },
                ],
              },
              {
                type: SH_BOX_TYPE,
                tagName: "div",
                name: "Local de entrega",
                classes: ["os-sh-loc"],
                components: [
                  icon("pin"),
                  {
                    type: SH_BOX_TYPE,
                    tagName: "span",
                    name: "Textos",
                    classes: ["os-sh-loc-t"],
                    components: [
                      textDef("span", "os-sh-loc-1", "Linha 1", SH_TEXTS.loc1),
                      textDef("span", "os-sh-loc-2", "Linha 2", SH_TEXTS.loc2),
                    ],
                  },
                ],
              },
              {
                type: SH_BOX_TYPE,
                tagName: "div",
                name: "Pesquisa",
                classes: ["os-sh-search"],
                attributes: { role: "search" },
                components: [
                  {
                    type: SH_INPUT_TYPE,
                    tagName: "input",
                    name: "Campo de pesquisa",
                    classes: ["os-sh-q"],
                    attributes: {
                      type: "search",
                      placeholder: SH_TEXTS.placeholder,
                      "aria-label": SH_TEXTS.searchLabel,
                      autocomplete: "off",
                      enterkeyhint: "search",
                    },
                  },
                  {
                    type: SH_GO_TYPE,
                    tagName: "button",
                    name: "Botão da pesquisa",
                    classes: ["os-sh-go"],
                    attributes: { type: "button", "aria-label": SH_TEXTS.go },
                    components: [icon("search")],
                  },
                ],
              },
              {
                type: SH_LINK_TYPE,
                tagName: "a",
                name: "“Entre” (conta)",
                classes: ["os-sh-acc"],
                // Ligado sem destino pede o link da oferta (como os botões de compra).
                attributes: { href: "#", ...(on.account && { "data-os-link": "" }) },
                components: [icon("user"), textDef("span", "os-sh-acc-t", "Texto", SH_TEXTS.account)],
              },
              {
                type: SH_LINK_TYPE,
                tagName: "a",
                name: "Carrinho",
                classes: ["os-sh-cart"],
                attributes: { href: "#", "aria-label": SH_TEXTS.cart, ...(on.cart && { "data-os-link": "" }) },
                // Como o "Botão do checkout": já nasce ligado ao primeiro checkout da oferta, se houver.
                ...(on.cart && { [PROP_AUTO_LINK]: "CHECKOUT" }),
                components: [icon("cart")],
              },
            ],
          },
        ],
      },
      {
        type: SH_BOX_TYPE,
        tagName: "nav",
        name: "Categorias",
        classes: ["os-sh-cats"],
        attributes: { "aria-label": SH_TEXTS.cats },
        components: [
          {
            type: SH_CATS_TYPE,
            tagName: "div",
            name: "Categorias",
            classes: ["os-sh-in"],
            components: (spec.categories ?? SH_CATEGORIES).map(categoryDef),
          },
        ],
      },
    ],
  };
}
