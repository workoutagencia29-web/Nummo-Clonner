/**
 * Criação do editor GrapesJS com a configuração do Offer Studio.
 */
import grapesjs, {
  type Editor,
  type IsVisibleFn,
  type PropertySelect,
  type PropertySelectProps,
  type PropertyTypes,
  type SelectOption,
} from "grapesjs";
import { registerBlocks } from "@/editor/blocks";
import { esc } from "@/editor/blocks/shared";
import { WIDGET_CANVAS_CSS } from "@/editor/widgets/canvas";
import { installCanvasFit } from "./canvas-fit";
import { insertBlockOnClick } from "./click-to-add";
import { CANVAS_CSS, registerComponentTypes } from "./components";
import { colorPickerOptions, ptMessages, RTE_ACTIONS, SECTOR_NAMES, type SectorId } from "./i18n";
import { installLinkSelection } from "./link-select";
import { installModalA11y } from "./modal-a11y";
import {
  installCanvasMediaOrder,
  installImportantMirror,
  installStyleCascadeGuard,
  keepPinsWithElement,
} from "./style-cascade";
import { installStyleHints } from "./style-hints";
import { installSafeStyleParser } from "./style-parse";

export const DEVICES = [
  { id: "desktop", name: "Computador", width: "" },
  { id: "tablet", name: "Tablet", width: "768px", widthMedia: "992px" },
  { id: "mobile", name: "Celular", width: "375px", widthMedia: "480px" },
] as const;
export type DeviceId = (typeof DEVICES)[number]["id"];

/**
 * Largura real do modo Computador no canvas. Antes o Desktop ocupava só a sobra
 * entre os painéis (672px numa tela de 1280) e as regras de tablet/celular da
 * página valiam nele. O canvas é reduzido para caber (canvas-fit.ts).
 */
export const DESKTOP_CANVAS_WIDTH = 1280;

/** Largura real (px) de um dispositivo — para reduzir o canvas ou a prévia até caber (fitDevice). */
export function deviceWidthPx(id: DeviceId): number {
  if (id === "desktop") return DESKTOP_CANVAS_WIDTH;
  return Number.parseFloat(DEVICES.find((d) => d.id === id)?.width ?? "") || 0;
}

/** Dispositivos do GrapesJS: o Desktop com largura real e sem @media (edições valem em todas as telas). */
function grapesDevices() {
  return DEVICES.map((d) =>
    d.id === "desktop" ? { ...d, width: `${DESKTOP_CANVAS_WIDTH}px`, widthMedia: "" } : { ...d },
  );
}

export interface EditorContainers {
  canvas: HTMLElement;
  blocks: HTMLElement;
  layers: HTMLElement;
  /** "Classes" e "Estado" (no "Avançado" do painel de estilo). Sem ele, a seção não aparece. */
  selectors?: HTMLElement;
  styles: HTMLElement;
  traits: HTMLElement;
}

// ─── Painel de estilo ────────────────────────────────────────────────────────
// Rótulos das propriedades vêm de i18n.ts (PROPERTY_LABELS); aqui ficam tipos,
// opções (sempre em português) e quando cada propriedade aparece.

type Opt = readonly [id: string, label: string];
type StyleProp = PropertyTypes & { placeholder?: string };
type VisibleArgs = Parameters<IsVisibleFn>[0];

const options = (list: readonly Opt[]): SelectOption[] => list.map(([id, label]) => ({ id, label }));

const select = (property: string, list: readonly Opt[], extra: Partial<PropertySelectProps> = {}): StyleProp => ({
  property,
  type: "select",
  default: "",
  options: options(list),
  ...extra,
});

/** Valor efetivo de uma propriedade no elemento (inclui o CSS original da página). */
function effectiveValue({ component, target }: VisibleArgs, prop: string): string {
  const el = component?.getEl();
  const view = el?.ownerDocument?.defaultView;
  if (el && view) return view.getComputedStyle(el).getPropertyValue(prop);
  const value = target?.getStyle?.()[prop];
  return typeof value === "string" ? value : "";
}
const whenFlex: IsVisibleFn = (args) => /flex/.test(effectiveValue(args, "display"));
const whenFlexOrGrid: IsVisibleFn = (args) => /flex|grid/.test(effectiveValue(args, "display"));
const whenPositioned: IsVisibleFn = (args) => {
  const position = effectiveValue(args, "position");
  return Boolean(position) && position !== "static";
};

/** Fontes seguras (instaladas nos computadores e celulares), sem Google Fonts. */
export const SAFE_FONTS: readonly Opt[] = [
  ['system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', "Fonte do sistema (moderna)"],
  ["Arial, Helvetica, sans-serif", "Arial"],
  ['"Helvetica Neue", Helvetica, Arial, sans-serif', "Helvetica"],
  ["Verdana, Geneva, sans-serif", "Verdana"],
  ["Tahoma, Geneva, sans-serif", "Tahoma"],
  ['"Trebuchet MS", Helvetica, sans-serif', "Trebuchet MS"],
  ['Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif', "Impact (títulos fortes)"],
  ['Georgia, "Times New Roman", serif', "Georgia (com serifa)"],
  ['"Times New Roman", Times, serif', "Times New Roman (com serifa)"],
  ['"Palatino Linotype", Palatino, "Book Antiqua", serif', "Palatino (com serifa)"],
  ['"Courier New", Courier, monospace', "Courier New (máquina de escrever)"],
  ["ui-monospace, Menlo, Consolas, monospace", "Monoespaçada do sistema"],
];

const FONT_WEIGHTS: readonly Opt[] = [
  ["", "Padrão"],
  ["100", "Fina (100)"],
  ["200", "Extraleve (200)"],
  ["300", "Leve (300)"],
  ["400", "Normal (400)"],
  ["500", "Média (500)"],
  ["600", "Seminegrito (600)"],
  ["700", "Negrito (700)"],
  ["800", "Extra-negrito (800)"],
  ["900", "Ultranegrito (900)"],
];

const BORDER_STYLES: readonly Opt[] = [
  ["none", "Sem borda"],
  ["solid", "Linha contínua"],
  ["dashed", "Tracejada"],
  ["dotted", "Pontilhada"],
  ["double", "Dupla"],
  ["groove", "Entalhada"],
  ["ridge", "Em relevo"],
  ["inset", "Afundada"],
  ["outset", "Saltada"],
];

const BG_SIZES: readonly Opt[] = [
  ["cover", "Cobrir tudo (pode cortar)"],
  ["contain", "Caber inteira"],
  ["auto", "Tamanho original"],
];
const bgSizeLabel = (value: unknown) => BG_SIZES.find(([id]) => id === value)?.[1].replace(/ \(.*\)$/, "");

const layerLabel =
  (noun: string, parts: (values: Record<string, unknown>) => string) =>
  (_layer: unknown, { index, values }: { index: number; values: Record<string, unknown> }) => {
    const detail = parts(values).trim();
    return `${noun} ${index + 1}${detail ? ` · ${detail}` : ""}`;
  };
const measures = (values: Record<string, unknown>, keys: string[]) =>
  keys.map((k) => String(values[k] ?? "")).join(" ");

/** Seções do painel de estilo, na ordem em que aparecem. */
export const SECTORS: { id: SectorId; name: string; open: boolean; properties: (string | StyleProp)[] }[] = [
  {
    id: "tipografia",
    name: SECTOR_NAMES.tipografia,
    open: true,
    properties: [
      { extend: "font-family", default: "", full: true, options: fontOptions([]) },
      { extend: "font-size", default: "", placeholder: "padrão", units: ["px", "rem", "em", "%", "vw"] },
      { extend: "font-weight", default: "", options: options(FONT_WEIGHTS) },
      { extend: "color", default: "", placeholder: "padrão" },
      { extend: "line-height", units: ["", "px", "em", "%"] },
      { extend: "letter-spacing", units: ["px", "em"] },
      {
        extend: "text-align",
        default: "",
        full: true,
        options: options([
          ["left", "Esquerda"],
          ["center", "Centro"],
          ["right", "Direita"],
          ["justify", "Justificado"],
        ]),
      },
      select("font-style", [
        ["", "Padrão"],
        ["normal", "Normal"],
        ["italic", "Itálico"],
      ]),
      select("text-transform", [
        ["", "Padrão"],
        ["none", "Normal"],
        ["uppercase", "MAIÚSCULAS"],
        ["lowercase", "minúsculas"],
        ["capitalize", "Primeira Maiúscula"],
      ]),
      select(
        "text-decoration",
        [
          ["", "Padrão"],
          ["none", "Sem linha"],
          ["underline", "Sublinhado"],
          ["line-through", "Riscado"],
          ["overline", "Linha em cima"],
        ],
        { full: true },
      ),
      {
        extend: "text-shadow",
        layerLabel: layerLabel("Sombra", (v) => measures(v, ["text-shadow-h", "text-shadow-v", "text-shadow-blur"])),
        properties: [
          { extend: "text-shadow-h", default: "1px" },
          { extend: "text-shadow-v", default: "1px" },
          { extend: "text-shadow-blur", default: "2px" },
          { extend: "text-shadow-color", default: "rgba(0,0,0,0.35)" },
        ],
      },
    ],
  },
  {
    id: "espacamento",
    name: SECTOR_NAMES.espacamento,
    open: false,
    properties: [
      // Cada lado é gravado sozinho (margin-top…): mudar um lado não zera os
      // outros, que continuam com o valor que o elemento tem (a dica do campo).
      { extend: "margin", detached: true, info: "Espaço entre este elemento e os vizinhos." },
      { extend: "padding", detached: true, info: "Espaço entre a borda do elemento e o conteúdo dele." },
    ],
  },
  {
    id: "tamanho",
    name: SECTOR_NAMES.tamanho,
    open: false,
    properties: ["width", "height", "max-width", "max-height", "min-width", "min-height"],
  },
  {
    id: "fundo",
    name: SECTOR_NAMES.fundo,
    open: false,
    properties: [
      { extend: "background-color", default: "", placeholder: "sem cor" },
      {
        extend: "background",
        layerLabel: layerLabel("Imagem", (v) => bgSizeLabel(v["background-size-sub"]) ?? ""),
        properties: [
          { extend: "background-image", id: "background-image-sub" },
          {
            extend: "background-size",
            id: "background-size-sub",
            default: "cover",
            options: options(BG_SIZES),
          },
          {
            extend: "background-position",
            id: "background-position-sub",
            default: "center center",
            options: options([
              ["center center", "Centro"],
              ["center top", "Em cima, no centro"],
              ["center bottom", "Embaixo, no centro"],
              ["left top", "Em cima, à esquerda"],
              ["left center", "No meio, à esquerda"],
              ["left bottom", "Embaixo, à esquerda"],
              ["right top", "Em cima, à direita"],
              ["right center", "No meio, à direita"],
              ["right bottom", "Embaixo, à direita"],
            ]),
          },
          {
            extend: "background-repeat",
            id: "background-repeat-sub",
            default: "no-repeat",
            options: options([
              ["no-repeat", "Não repetir"],
              ["repeat", "Repetir (mosaico)"],
              ["repeat-x", "Repetir na horizontal"],
              ["repeat-y", "Repetir na vertical"],
            ]),
          },
          {
            extend: "background-attachment",
            id: "background-attachment-sub",
            default: "scroll",
            options: options([
              ["scroll", "Rola junto com a página"],
              ["fixed", "Fica parada (efeito parallax)"],
              ["local", "Rola junto com o conteúdo"],
            ]),
          },
        ],
      },
    ],
  },
  {
    id: "borda",
    name: SECTOR_NAMES.borda,
    open: false,
    properties: [
      "border-radius",
      {
        extend: "border",
        properties: [
          { extend: "border-width", id: "border-width-sub", default: "1px" },
          { extend: "border-style", id: "border-style-sub", options: options(BORDER_STYLES) },
          { extend: "border-color", id: "border-color-sub", default: "#000000" },
        ],
      },
    ],
  },
  {
    id: "sombra",
    name: SECTOR_NAMES.sombra,
    open: false,
    properties: [
      {
        extend: "box-shadow",
        layerLabel: layerLabel(
          "Sombra",
          (v) =>
            `${measures(v, ["box-shadow-h", "box-shadow-v", "box-shadow-blur"])}${v["box-shadow-type"] === "inset" ? " · por dentro" : ""}`,
        ),
        properties: [
          { extend: "box-shadow-h" },
          { extend: "box-shadow-v", default: "4px" },
          { extend: "box-shadow-blur", default: "12px" },
          { extend: "box-shadow-spread" },
          { extend: "box-shadow-color", default: "rgba(0,0,0,0.25)" },
          {
            extend: "box-shadow-type",
            options: options([
              ["", "Por fora"],
              ["inset", "Por dentro"],
            ]),
          },
        ],
      },
      "opacity",
      select(
        "cursor",
        [
          ["", "Padrão"],
          ["pointer", "Mãozinha (clicável)"],
          ["default", "Seta"],
          ["text", "Texto"],
          ["move", "Mover"],
          ["not-allowed", "Bloqueado"],
        ],
        { full: true },
      ),
    ],
  },
  {
    id: "layout",
    name: SECTOR_NAMES.layout,
    open: false,
    properties: [
      select(
        "display",
        [
          ["", "Padrão"],
          ["block", "Bloco (ocupa a linha toda)"],
          ["flex", "Flexível (itens lado a lado)"],
          ["grid", "Grade"],
          ["inline-block", "Na linha, com tamanho"],
          ["inline", "Na linha (como texto)"],
          ["none", "Oculto (não aparece)"],
        ],
        { full: true, info: "Dica: escolha o celular no topo e use Oculto para esconder algo só no celular." },
      ),
      select(
        "flex-direction",
        [
          ["", "Padrão"],
          ["row", "Lado a lado →"],
          ["row-reverse", "Lado a lado, invertido ←"],
          ["column", "Um embaixo do outro ↓"],
          ["column-reverse", "Um embaixo do outro, invertido ↑"],
        ],
        { full: true, isVisible: whenFlex },
      ),
      select(
        "justify-content",
        [
          ["", "Padrão"],
          ["flex-start", "No início"],
          ["center", "No centro"],
          ["flex-end", "No fim"],
          ["space-between", "Espalhados (nas pontas)"],
          ["space-around", "Espalhados (com sobra nas pontas)"],
          ["space-evenly", "Espalhados por igual"],
        ],
        { full: true, isVisible: whenFlexOrGrid },
      ),
      select(
        "align-items",
        [
          ["", "Padrão"],
          ["stretch", "Esticar"],
          ["flex-start", "No início"],
          ["center", "No centro"],
          ["flex-end", "No fim"],
          ["baseline", "Pela linha do texto"],
        ],
        { isVisible: whenFlexOrGrid },
      ),
      select(
        "flex-wrap",
        [
          ["", "Padrão"],
          ["nowrap", "Tudo numa linha"],
          ["wrap", "Quebrar linha"],
          ["wrap-reverse", "Quebrar, invertido"],
        ],
        { isVisible: whenFlex },
      ),
      {
        property: "gap",
        type: "number",
        default: "",
        placeholder: "0",
        units: ["px", "rem", "%"],
        min: 0,
        isVisible: whenFlexOrGrid,
      },
      select(
        "position",
        [
          ["", "Padrão"],
          ["static", "Normal"],
          ["relative", "Relativo (ajuste fino)"],
          ["absolute", "Solto (por cima do conteúdo)"],
          ["fixed", "Fixo na tela"],
          ["sticky", "Gruda ao rolar a página"],
        ],
        { full: true },
      ),
      { extend: "top", isVisible: whenPositioned },
      { extend: "bottom", isVisible: whenPositioned },
      { extend: "left", isVisible: whenPositioned },
      { extend: "right", isVisible: whenPositioned },
      {
        property: "z-index",
        type: "number",
        default: "",
        placeholder: "auto",
        units: [],
        step: 1,
        full: true,
        isVisible: whenPositioned,
        info: "Número maior fica por cima dos outros elementos.",
      },
      select("overflow", [
        ["", "Padrão"],
        ["visible", "Mostrar"],
        ["hidden", "Esconder (cortar)"],
        ["auto", "Rolar se precisar"],
        ["scroll", "Sempre rolar"],
      ]),
    ],
  },
];

// ─── Fontes da página ────────────────────────────────────────────────────────

const ICON_FONT = /awesome|icon|symbols|dashicons|eicons|glyph|fontello|swiper|slick|lightgallery/i;
const SERIF_FONT =
  /serif|slab|garamond|playfair|merriweather|lora|baskerville|georgia|times|caslon|crimson|bodoni|didot|cormorant|prata|cinzel/i;
const MONO_FONT = /mono|code|courier|consol/i;

/** Valor de font-family para uma fonte da página, com alternativa genérica. */
export function familyValue(name: string) {
  const generic = MONO_FONT.test(name)
    ? "monospace"
    : /sans/i.test(name)
      ? "sans-serif"
      : SERIF_FONT.test(name)
        ? "serif"
        : "sans-serif";
  return `"${name.replace(/"/g, "")}", ${generic}`;
}

/**
 * Opções do campo "Fonte": padrão da página, fontes da página e fontes seguras.
 * O GrapesJS monta a lista com innerHTML no painel: o nome (vem do CSS da página,
 * que pode ser de terceiros) entra escapado.
 */
export function fontOptions(pageFonts: readonly string[]): SelectOption[] {
  return [
    { id: "", label: "Padrão da página" },
    ...pageFonts.filter(isPlausibleFontName).map((name) => ({
      id: familyValue(name),
      label: `${esc(name)} · usada na página`,
    })),
    ...options(SAFE_FONTS),
  ];
}

/** Nome de fonte de verdade: sem marcação nem caracteres de controle, tamanho razoável. */
function isPlausibleFontName(name: string) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: recusa caracteres de controle de propósito
  return name.length > 0 && name.length <= 100 && !/[<>&\u0000-\u001f\u007f]/.test(name);
}

/** Nomes das fontes carregadas na página (@font-face), sem fontes de ícones. */
export function pageFontFamilies(doc: Document): string[] {
  const names = new Set<string>();
  const add = (raw: string) => {
    const name = raw
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
    if (isPlausibleFontName(name) && !ICON_FONT.test(name) && !/^(inherit|initial|unset)$/i.test(name)) {
      names.add(name);
    }
  };
  doc.fonts?.forEach((face) => {
    add(face.family);
  });
  const visit = (rules: CSSRuleList | undefined, depth: number) => {
    if (!rules || depth > 4) return;
    for (const rule of Array.from(rules)) {
      if (rule.cssText.startsWith("@font-face")) {
        add((rule as CSSFontFaceRule).style.getPropertyValue("font-family"));
        continue;
      }
      const nested = rule as Partial<CSSImportRule & CSSGroupingRule>;
      try {
        if (nested.styleSheet) visit(nested.styleSheet.cssRules, depth + 1);
        if (nested.cssRules) visit(nested.cssRules, depth + 1);
      } catch {
        // Folha de outro domínio: o navegador não deixa ler (as fontes já vieram de document.fonts).
      }
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      visit(sheet.cssRules, 0);
    } catch {
      // idem
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Mantém as fontes da página (clonada) como opções do campo "Fonte". */
function syncPageFonts(editor: Editor) {
  let last = "";
  const refresh = () => {
    const doc = editor.Canvas.getDocument();
    if (!doc) return;
    const names = pageFontFamilies(doc);
    const key = names.join("|");
    if (key === last) return;
    last = key;
    const prop = editor.StyleManager.getProperty("tipografia", "font-family") as PropertySelect | undefined;
    prop?.setOptions(fontOptions(names));
  };
  editor.on("load", () => {
    refresh();
    const fonts = editor.Canvas.getDocument()?.fonts;
    fonts?.ready.then(refresh).catch(() => undefined);
    fonts?.addEventListener("loadingdone", refresh);
  });
  editor.on("component:selected", refresh);
}

/**
 * O GrapesJS 0.23.6 desenha "Classes/Estado" duas vezes quando o gerenciador tem
 * appendTo (bug dele: os dois painéis funcionam, mas aparecem repetidos). Fica só
 * o painel que o gerenciador usa (o último desenhado).
 */
function keepSingleSelectorPanel(editor: Editor, container: HTMLElement | undefined) {
  if (!container) return;
  const panels = Array.from(container.children);
  if (panels.length < 2) return;
  const live =
    (editor.Selectors as unknown as { selectorTags?: { el?: Element } }).selectorTags?.el ?? panels[panels.length - 1];
  for (const panel of panels) if (panel !== live) panel.remove();
}

/** Nome do iframe do canvas para leitores de tela (o GrapesJS cria sem title). */
export const CANVAS_FRAME_TITLE = "Página em edição";

function titleCanvasFrame(editor: Editor) {
  const apply = () => editor.Canvas.getFrameEl()?.setAttribute("title", CANVAS_FRAME_TITLE);
  editor.on("load", apply);
  editor.on("canvas:frame:load", apply);
}

export function createEditor(containers: EditorContainers, project: unknown | null): Editor {
  const editor = grapesjs.init({
    container: containers.canvas,
    height: "100%",
    width: "auto",
    telemetry: false,
    cssIcons: "",
    protectedCss: "",
    // CSS só do editor. Fica no <body> do canvas, que sobrevive à importação da
    // página (setComponents com asDocument refaz o <head>).
    canvasCss: CANVAS_CSS + WIDGET_CANVAS_CSS,
    noticeOnUnload: false,
    storageManager: false,
    projectData: project ?? undefined,
    // Plugins rodam antes de carregar o projeto: os tipos do Offer Studio precisam
    // existir para o projeto salvo voltar certo.
    plugins: [
      (ed: Editor) => {
        installSafeStyleParser(ed);
        registerComponentTypes(ed);
        keepPinsWithElement(ed);
        registerBlocks(ed);
      },
    ],
    avoidInlineStyle: true,
    // Regras de classes/ids que não estão na página agora (estados do script,
    // popups, elementos que vão ser criados) também são salvas.
    keepUnusedStyles: true,
    // O Offer Studio não usa scripts de componente do GrapesJS.
    jsInHtml: false,
    panels: { defaults: [] },
    // Tudo em português do Brasil (i18n.ts); sem cair no inglês se faltar algo.
    i18n: { locale: "pt", localeFallback: "pt", detectLocale: false, messages: { pt: ptMessages } },
    colorPicker: colorPickerOptions(),
    richTextEditor: { actions: RTE_ACTIONS as never },
    undoManager: { maximumStackLength: 150, trackSelection: false },
    // "Classes" e "Estado" (ex.: ao passar o mouse) ficam acima do painel de estilo.
    selectorManager: { componentFirst: true, ...(containers.selectors && { appendTo: containers.selectors }) },
    // Clicar num bloco também adiciona (abaixo do item selecionado).
    blockManager: { appendTo: containers.blocks, appendOnClick: (block, ed) => insertBlockOnClick(ed, block) },
    layerManager: { appendTo: containers.layers },
    styleManager: { appendTo: containers.styles, sectors: SECTORS as never },
    traitManager: { appendTo: containers.traits },
    deviceManager: { devices: grapesDevices() as never },
    parser: { optionsHtml: { allowScripts: false, allowUnsafeAttr: false } },
    assetManager: {
      upload: "/api/assets/upload",
      uploadName: "files",
      multiUpload: true,
      autoAdd: true,
    },
  });
  keepSingleSelectorPanel(editor, containers.selectors);
  syncPageFonts(editor);
  titleCanvasFrame(editor);
  installLinkSelection(editor);
  const disposeModal = installModalA11y(editor);
  editor.on("destroy", disposeModal);
  installCanvasFit(editor, containers.canvas);
  installStyleCascadeGuard(editor);
  installImportantMirror(editor);
  installCanvasMediaOrder(editor);
  installStyleHints(editor);
  return editor;
}
