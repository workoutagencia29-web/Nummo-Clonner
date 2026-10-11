/**
 * Rodapé do Offer Studio com logo: o rodapé dos modelos de página
 * (`footer.os-footer > div.os-container`, src/editor/templates/widgets.ts) e o
 * do bloco "Rodapé com políticas" (src/editor/blocks/footer.ts). Sem GrapesJS
 * aqui: o CSS, a definição do logo e o reconhecimento do rodapé (no HTML e no
 * projeto salvo). Tipos e Configurações em widgets/footer.ts.
 *
 *   footer[data-os-ft-logo="1"|"0"]          logo ligado / desligado (sem o atributo: desligado)
 *         [data-os-ft-logo-pos="left|right"]   lugar no computador (a partir de 769 px); sem = centro
 *         [data-os-ft-logo-pos-m="left|right"] lugar no celular (até 768 px); sem = centro
 *         (altura do logo: --os-ft-logo-h no estilo do rodapé; proporção da imagem: --os-ft-logo-r)
 *     div[data-os-ft-box]                    o conteúdo (.os-container dos modelos, a caixa do bloco)
 *       a.os-ft-logo[href=os-page:<id>]      sem destino, <a> sem href: não é link
 *         img.os-ft-logo-img
 *       …links e textos do rodapé
 *
 * Só rodapés do Offer Studio: com data-os-ft-logo (modelos e bloco de agora),
 * `footer.os-footer` com a `.os-container` dos modelos, ou o rodapé do bloco
 * gravado antes (o ano do copyright em [data-os-year], que só o bloco põe). O
 * <footer> de uma página clonada não vira esse tipo.
 *
 * O elemento do logo só existe depois de "Mostrar logo" (modelos e bloco
 * nascem sem ele, com o logo desligado). Desligado, ele fica no lugar e some
 * por CSS. O CSS do logo vem com ele (tipo do link do logo): página sem logo
 * não leva esse CSS.
 */
import type { Def, Style } from "@/editor/blocks/shared";
import { type ShLogoPos, storeLogoPlaceholder } from "./store-header-content";

export const FOOTER_TYPE = "os-footer";
/** Link em volta do logo (sem destino, sem href). */
export const FT_LOGO_LINK_TYPE = "os-ft-logo";
/** Imagem do logo (o clique seleciona ela). */
export const FT_LOGO_TYPE = "os-ft-logo-img";

/** Logo ligado ("1") ou desligado ("0"). Também marca o rodapé como do Offer Studio. */
export const FT_LOGO_ATTR = "data-os-ft-logo";
/** Lugar do logo no computador (a partir de 769 px) e no celular. Sem o atributo: no centro. */
export const FT_LOGO_POS_ATTR = "data-os-ft-logo-pos";
export const FT_LOGO_POS_M_ATTR = "data-os-ft-logo-pos-m";
export const FT_DEFAULT_POS: ShLogoPos = "center";
/** Caixa do conteúdo, onde o logo entra (a grade do logo ao lado dos links no computador). */
export const FT_BOX_ATTR = "data-os-ft-box";

/** Altura do logo (px), na variável do estilo do rodapé (sem ela, 40 px). */
export const FT_LOGO_H_VAR = "--os-ft-logo-h";
export const FT_LOGO_H = { def: 40, min: 20, max: 120 } as const;
/** Proporção da imagem do logo (largura ÷ altura), gravada pelo editor: logo largo sem faixa vazia. */
export const FT_LOGO_R_VAR = "--os-ft-logo-r";
/** Largura máxima do logo (px). */
export const FT_LOGO_MAX_W = 280;

export const FT_TEXTS = {
  /** Descrição padrão da imagem (o campo vazio volta a ela). */
  logo: "Logo da empresa",
  placeholder: "SEU LOGO",
} as const;

/** Logo provisório ("SEU LOGO" numa caixa tracejada clara): legível no rodapé escuro e no claro. */
export const footerLogoPlaceholder = () => storeLogoPlaceholder(FT_TEXTS.placeholder);

/** O logo (link sem destino + imagem provisória), posto no começo do conteúdo do rodapé. */
export function footerLogoDef(): Def {
  return {
    type: FT_LOGO_LINK_TYPE,
    tagName: "a",
    name: "Link do logo",
    classes: ["os-ft-logo"],
    components: [
      {
        type: FT_LOGO_TYPE,
        tagName: "img",
        name: "Logo do rodapé",
        classes: ["os-ft-logo-img"],
        attributes: { src: footerLogoPlaceholder(), alt: FT_TEXTS.logo },
      },
    ],
  };
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const declarations = (style: Style) =>
  Object.entries(style)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

/** Rodapé com o logo ligado. */
const F = `footer[${FT_LOGO_ATTR}="1"]`;
/** Conteúdo do rodapé com o logo à esquerda / à direita no computador. */
const side = (pos: "left" | "right") => `${F}[${FT_LOGO_POS_ATTR}=${pos}] [${FT_BOX_ATTR}]`;
const LOGO_H = `var(${FT_LOGO_H_VAR},${FT_LOGO_H.def}px)`;
/** Proporção do logo (sem ela, um número pequeno: o limite de altura que sai dela não pesa). */
const LOGO_R = `var(${FT_LOGO_R_VAR},.01)`;
/** Celular: o logo cabe na tela (respiro dos lados do rodapé). */
const ROOM_MOBILE = `min(${FT_LOGO_MAX_W}px,calc(100vw - 48px))`;

/** A altura escolhida; largura pela proporção da imagem, até o máximo (com a proporção, a altura para no que cabe). */
const FT_LOGO_IMG: Style = {
  display: "block",
  width: "auto",
  "max-width": `${FT_LOGO_MAX_W}px`,
  height: LOGO_H,
  "max-height": `calc(${FT_LOGO_MAX_W}px / ${LOGO_R})`,
  "min-width": "0",
  "min-height": "0",
  margin: "0",
  padding: "0",
  "border-width": "0",
  "border-radius": "0",
  "box-shadow": "none",
  "object-fit": "contain",
};

/**
 * CSS do logo do rodapé (vira regras do projeto quando o logo entra na
 * página). Com var(), só propriedades simples; sem gap (Safari 13): espaços
 * com margem. Sem script: tudo por atributo do rodapé.
 *
 * - Centro (padrão): o logo em cima dos links e textos, centralizado.
 * - Computador, esquerda/direita: o conteúdo vira uma grade de duas colunas —
 *   o logo de um lado (no alto) e os links e textos do outro, como estavam.
 * - Celular (até 768 px, também o tablet em pé): o logo sempre em cima, à
 *   esquerda, no centro ou à direita, do tamanho que cabe na tela.
 * - Logo desligado: o elemento fica, escondido.
 */
export const FOOTER_CSS = [
  `footer:not([${FT_LOGO_ATTR}="1"]) .os-ft-logo{display:none}`,
  `${F} .os-ft-logo{display:table;margin:0 auto 18px;padding:0;border-width:0;background-color:transparent;color:inherit;line-height:0;text-decoration:none}`,
  `${F} .os-ft-logo .os-ft-logo-img{${declarations(FT_LOGO_IMG)}}`,
  `@media (min-width:769px){${side("left")},${side("right")}{display:grid;align-items:start}` +
    `${side("left")}{grid-template-columns:auto minmax(0,1fr)}` +
    `${side("right")}{grid-template-columns:minmax(0,1fr) auto}` +
    `${side("left")} > *{grid-column-start:2;grid-column-end:3}` +
    `${side("right")} > *{grid-column-start:1;grid-column-end:2}` +
    `${side("left")} > .os-ft-logo{grid-column-start:1;grid-column-end:2;grid-row-start:1;grid-row-end:span 8;margin:0 40px 0 0}` +
    `${side("right")} > .os-ft-logo{grid-column-start:2;grid-column-end:3;grid-row-start:1;grid-row-end:span 8;margin:0 0 0 40px}}`,
  `@media (max-width:768px){${F} .os-ft-logo .os-ft-logo-img{max-width:${ROOM_MOBILE};max-height:calc(${ROOM_MOBILE} / ${LOGO_R})}` +
    `${F}[${FT_LOGO_POS_M_ATTR}=left] .os-ft-logo{margin-left:0;margin-right:auto}` +
    `${F}[${FT_LOGO_POS_M_ATTR}=right] .os-ft-logo{margin-left:auto;margin-right:0}}`,
].join("");

// ─── Reconhecimento ──────────────────────────────────────────────────────────

/** Marca do ano atual no copyright: só o bloco "Rodapé com políticas" põe (src/runtime/os-runtime.ts troca o ano). */
const YEAR_ATTR = "data-os-year";

/**
 * O <footer> é um rodapé do Offer Studio (modelo ou bloco)? (HTML lido pelo
 * editor.) O ano do copyright só conta se for dele mesmo: o bloco "Rodapé com
 * políticas" posto DENTRO do <footer> de uma página clonada não faz o rodapé
 * clonado virar "Rodapé" (só o do bloco vira).
 */
export function isOsFooterNode(node: Element): boolean {
  if (node.tagName?.toUpperCase() !== "FOOTER") return false;
  if (node.hasAttribute(FT_LOGO_ATTR)) return true;
  if (node.classList.contains("os-footer") && node.firstElementChild?.classList.contains("os-container")) return true;
  return Array.from(node.querySelectorAll(`[${YEAR_ATTR}]`)).some((year) => year.closest("footer") === node);
}

type JsonDef = Record<string, unknown>;

const isDef = (v: unknown): v is JsonDef => !!v && typeof v === "object" && !Array.isArray(v);
const childDefs = (def: JsonDef): JsonDef[] => (Array.isArray(def.components) ? def.components.filter(isDef) : []);
const attrsOf = (def: JsonDef): Record<string, unknown> => (isDef(def.attributes) ? def.attributes : {});

function classesOf(def: JsonDef): string[] {
  const list = Array.isArray(def.classes) ? def.classes : [];
  const names = list.map((c) => (typeof c === "string" ? c : isDef(c) && typeof c.name === "string" ? c.name : ""));
  const attr = attrsOf(def).class;
  return [...names, ...(typeof attr === "string" ? attr.split(/\s+/) : [])].filter(Boolean);
}

/** Definição de um <footer> (o tipo "Rodapé" não grava o tagName, que é o padrão dele). */
const isFooterDef = (def: JsonDef) => def.type === FOOTER_TYPE || String(def.tagName ?? "").toLowerCase() === "footer";

/**
 * O ano do copyright do bloco, num filho (elemento ou o HTML de um texto ainda
 * não aberto). Não entra em outro <footer> de dentro: o ano dele é do rodapé
 * dele (o bloco posto dentro do rodapé de uma página clonada).
 */
function hasYear(def: JsonDef, depth: number): boolean {
  if (depth > 12) return false;
  return childDefs(def).some(
    (c) =>
      !isFooterDef(c) &&
      (YEAR_ATTR in attrsOf(c) ||
        (typeof c.content === "string" && c.content.includes(YEAR_ATTR) && !/<footer[\s>]/i.test(c.content)) ||
        hasYear(c, depth + 1)),
  );
}

/** Definição de um <footer> do projeto salvo que é um rodapé do Offer Studio sem o tipo (gravado antes). */
function isUntypedOsFooter(def: JsonDef): boolean {
  if (!isFooterDef(def)) return false;
  if (def.type && def.type !== "default") return false;
  if (FT_LOGO_ATTR in attrsOf(def)) return true;
  const first = childDefs(def).find((c) => c.type !== "textnode" && c.type !== "comment");
  if (classesOf(def).includes("os-footer") && first && classesOf(first).includes("os-container")) return true;
  return hasYear(def, 0);
}

/**
 * Projeto salvo antes do tipo "Rodapé": o GrapesJS abre o projeto pelo tipo
 * gravado em cada elemento (não olha o HTML de novo), então os rodapés do
 * Offer Studio voltariam como caixas comuns, sem o logo nas Configurações.
 * Eles ganham o tipo aqui, antes de abrir (como fixPageRoots).
 */
export function retypeFooters<T>(project: T): T {
  const seen = new Set<unknown>();
  const visit = (node: unknown, depth: number) => {
    if (depth > 400 || !node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const def = node as JsonDef;
    if (isUntypedOsFooter(def)) def.type = FOOTER_TYPE;
    for (const [key, value] of Object.entries(def)) {
      // As regras de CSS (styles) e os recursos (assets) não têm elementos.
      if (key !== "styles" && key !== "assets") visit(value, depth + 1);
    }
  };
  visit((project as { pages?: unknown } | null)?.pages, 0);
  return project;
}
