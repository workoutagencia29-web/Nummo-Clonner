/**
 * Textos do GrapesJS em português do Brasil, na língua de quem monta páginas
 * (não de programador).
 *
 * Base: grapesjs/locale/pt.mjs (português de Portugal, incompleto e com termos
 * em inglês) + os ajustes abaixo, que cobrem todo texto visível dos painéis
 * nativos: estilo, estados, classes, camadas, configurações, imagens, barra de
 * texto e seletor de cores.
 *
 * Atenção: no GrapesJS, a tradução VENCE o rótulo definido no componente/propriedade
 * com o mesmo nome. Por isso, em `traitManager.traits.labels` só entram os
 * atributos padrão (title, href, target, alt) — configurações próprias dos blocos
 * devem usar nomes diferentes desses.
 */
import type { ColorPickerOptions } from "grapesjs";
import ptBase from "grapesjs/locale/pt.mjs";

export interface MessageTree {
  [key: string]: string | MessageTree;
}

function isTree(value: unknown): value is MessageTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Junta dois conjuntos de mensagens (o segundo vence), sem alterar os originais. */
export function mergeMessages(base: MessageTree, extra: MessageTree): MessageTree {
  const out: MessageTree = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const prev = out[key];
    out[key] = isTree(prev) && isTree(value) ? mergeMessages(prev, value) : value;
  }
  return out;
}

/** Nomes das seções do painel de estilo (ids usados em setup.ts). */
export const SECTOR_NAMES = {
  tipografia: "Texto",
  espacamento: "Espaçamento",
  tamanho: "Tamanho",
  fundo: "Fundo",
  borda: "Borda e cantos",
  sombra: "Sombra e efeitos",
  layout: "Posição e layout",
} as const;
export type SectorId = keyof typeof SECTOR_NAMES;

/** Rótulos das propriedades de estilo (por id da propriedade no GrapesJS). */
export const PROPERTY_LABELS: Record<string, string> = {
  // Texto
  "font-family": "Fonte",
  "font-size": "Tamanho da letra",
  "font-weight": "Espessura",
  "font-style": "Estilo da letra",
  color: "Cor do texto",
  "line-height": "Altura da linha",
  "letter-spacing": "Espaço entre letras",
  "text-align": "Alinhamento",
  "text-transform": "Maiúsculas",
  "text-decoration": "Linha no texto",
  "text-shadow": "Sombra do texto",
  "text-shadow-h": "Horizontal",
  "text-shadow-v": "Vertical",
  "text-shadow-blur": "Desfoque",
  "text-shadow-color": "Cor",
  // Espaçamento
  margin: "Margem (espaço por fora)",
  "margin-top": "Margem em cima",
  "margin-right": "Margem à direita",
  "margin-bottom": "Margem embaixo",
  "margin-left": "Margem à esquerda",
  "margin-top-sub": "Em cima",
  "margin-right-sub": "Direita",
  "margin-bottom-sub": "Embaixo",
  "margin-left-sub": "Esquerda",
  padding: "Preenchimento (espaço por dentro)",
  "padding-top": "Preenchimento em cima",
  "padding-right": "Preenchimento à direita",
  "padding-bottom": "Preenchimento embaixo",
  "padding-left": "Preenchimento à esquerda",
  "padding-top-sub": "Em cima",
  "padding-right-sub": "Direita",
  "padding-bottom-sub": "Embaixo",
  "padding-left-sub": "Esquerda",
  // Tamanho
  width: "Largura",
  "min-width": "Largura mínima",
  "max-width": "Largura máxima",
  height: "Altura",
  "min-height": "Altura mínima",
  "max-height": "Altura máxima",
  // Fundo
  "background-color": "Cor de fundo",
  background: "Imagem de fundo",
  "background-image": "Imagem de fundo",
  "background-repeat": "Repetição da imagem",
  "background-position": "Posição da imagem",
  "background-attachment": "Imagem ao rolar a página",
  "background-size": "Tamanho da imagem",
  "background-image-sub": "Imagem",
  "background-repeat-sub": "Repetição",
  "background-position-sub": "Posição",
  "background-attachment-sub": "Ao rolar a página",
  "background-size-sub": "Tamanho",
  // Borda e cantos
  "border-radius": "Cantos arredondados",
  "border-radius-c": "Cantos arredondados",
  "border-top-left-radius": "Canto de cima à esquerda",
  "border-top-right-radius": "Canto de cima à direita",
  "border-bottom-right-radius": "Canto de baixo à direita",
  "border-bottom-left-radius": "Canto de baixo à esquerda",
  "border-top-left-radius-sub": "Em cima à esquerda",
  "border-top-right-radius-sub": "Em cima à direita",
  "border-bottom-right-radius-sub": "Embaixo à direita",
  "border-bottom-left-radius-sub": "Embaixo à esquerda",
  "border-top-left": "Borda de cima à esquerda",
  "border-top-right": "Borda de cima à direita",
  "border-bottom-left": "Borda de baixo à esquerda",
  "border-bottom-right": "Borda de baixo à direita",
  border: "Borda",
  "border-width": "Espessura da borda",
  "border-style": "Tipo de linha da borda",
  "border-color": "Cor da borda",
  "border-width-sub": "Espessura",
  "border-style-sub": "Tipo de linha",
  "border-color-sub": "Cor",
  // Sombra e efeitos
  "box-shadow": "Sombra",
  "box-shadow-h": "Horizontal",
  "box-shadow-v": "Vertical",
  "box-shadow-blur": "Desfoque",
  "box-shadow-spread": "Tamanho extra",
  "box-shadow-color": "Cor",
  "box-shadow-type": "Tipo",
  opacity: "Opacidade",
  cursor: "Cursor do mouse",
  transition: "Animação de transição",
  "transition-property": "O que anima",
  "transition-duration": "Duração",
  "transition-timing-function": "Ritmo",
  "transition-property-sub": "O que anima",
  "transition-duration-sub": "Duração",
  "transition-timing-function-sub": "Ritmo",
  perspective: "Perspectiva",
  transform: "Transformação",
  "transform-type": "Tipo",
  "transform-value": "Valor",
  "transform-rotate-x": "Girar na horizontal",
  "transform-rotate-y": "Girar na vertical",
  "transform-rotate-z": "Girar",
  "transform-scale-x": "Esticar na horizontal",
  "transform-scale-y": "Esticar na vertical",
  "transform-scale-z": "Esticar em profundidade",
  // Posição e layout
  display: "Exibição",
  "flex-direction": "Direção dos itens",
  "justify-content": "Distribuição dos itens",
  "align-items": "Alinhamento dos itens",
  "align-content": "Alinhamento das linhas",
  "align-self": "Alinhamento próprio",
  "flex-wrap": "Quebra de linha",
  "flex-basis": "Tamanho base",
  "flex-grow": "Crescer para ocupar espaço",
  "flex-shrink": "Encolher se faltar espaço",
  order: "Ordem",
  gap: "Espaço entre itens",
  float: "Flutuar",
  position: "Posicionamento",
  top: "Distância do topo",
  right: "Distância da direita",
  bottom: "Distância de baixo",
  left: "Distância da esquerda",
  "z-index": "Ordem de sobreposição",
  overflow: "Conteúdo que não cabe",
  "overflow-x": "Conteúdo que não cabe (horizontal)",
  "overflow-y": "Conteúdo que não cabe (vertical)",
};

/** Estados (pseudo-classes) do seletor "Estado". */
export const STATE_LABELS: Record<string, string> = {
  hover: "Ao passar o mouse",
  active: "Ao clicar",
  focus: "Com foco (campo selecionado)",
  "nth-of-type(2n)": "Itens pares",
  "nth-of-type(2n+1)": "Itens ímpares",
  "first-child": "Primeiro item",
  "last-child": "Último item",
};

/** Nomes dos elementos (camadas, etiqueta na página). Chave = tipo ou tag HTML. */
const COMPONENT_NAMES: Record<string, string> = {
  "": "Caixa",
  default: "Caixa",
  wrapper: "Página",
  body: "Página",
  text: "Texto",
  textnode: "Texto",
  comment: "Comentário",
  image: "Imagem",
  video: "Vídeo",
  label: "Rótulo",
  link: "Link",
  map: "Mapa",
  iframe: "Incorporação",
  script: "Script",
  svg: "Ícone",
  "svg-in": "Parte do ícone",
  table: "Tabela",
  row: "Linha da tabela",
  cell: "Célula",
  thead: "Cabeçalho da tabela",
  tbody: "Corpo da tabela",
  tfoot: "Rodapé da tabela",
  // Tags HTML (elementos sem tipo próprio)
  div: "Caixa",
  section: "Seção",
  header: "Cabeçalho",
  footer: "Rodapé",
  nav: "Menu",
  main: "Conteúdo principal",
  article: "Artigo",
  aside: "Barra lateral",
  form: "Formulário",
  input: "Campo",
  textarea: "Caixa de texto",
  select: "Lista de opções",
  option: "Opção",
  button: "Botão",
  ul: "Lista",
  ol: "Lista numerada",
  li: "Item da lista",
  dl: "Lista de definições",
  figure: "Figura",
  figcaption: "Legenda",
  picture: "Imagem",
  source: "Fonte da mídia",
  span: "Trecho",
  strong: "Negrito",
  b: "Negrito",
  em: "Itálico",
  i: "Itálico",
  u: "Sublinhado",
  s: "Riscado",
  del: "Riscado",
  mark: "Destaque",
  small: "Texto pequeno",
  sup: "Sobrescrito",
  sub: "Subscrito",
  br: "Quebra de linha",
  hr: "Linha divisória",
  blockquote: "Citação",
  h1: "Título 1",
  h2: "Título 2",
  h3: "Título 3",
  h4: "Título 4",
  h5: "Título 5",
  h6: "Título 6",
  p: "Parágrafo",
  center: "Centralizado",
  noscript: "Aviso sem script",
  details: "Pergunta e resposta",
  summary: "Pergunta",
  canvas: "Desenho",
  audio: "Áudio",
};

/** Ajustes sobre o pt.mjs. Cobrem tudo o que aparece nos painéis. */
const OVERRIDES: MessageTree = {
  assetManager: {
    addButton: "Adicionar",
    inputPlh: "Cole o endereço de uma imagem (https://…)",
    modalTitle: "Escolher imagem",
    uploadTitle: "Arraste imagens para cá ou clique para enviar do computador",
  },
  domComponents: { names: COMPONENT_NAMES },
  deviceManager: {
    device: "Dispositivo",
    devices: {
      desktop: "Computador",
      tablet: "Tablet",
      mobile: "Celular",
      mobileLandscape: "Celular deitado",
      mobilePortrait: "Celular em pé",
    },
  },
  panels: {
    buttons: {
      titles: {
        preview: "Modo prévia",
        fullscreen: "Tela cheia",
        "sw-visibility": "Mostrar contornos",
        "export-template": "Ver código",
        "open-sm": "Estilo",
        "open-tm": "Configurações",
        "open-layers": "Camadas",
        "open-blocks": "Blocos",
      },
    },
  },
  selectorManager: {
    label: "Classes",
    selected: "Aplicando em",
    emptyState: "Estado normal",
    states: STATE_LABELS,
  },
  styleManager: {
    empty: "Selecione um elemento na página para mudar o visual dele.",
    layer: "Camada",
    fileButton: "Escolher imagem",
    sectors: {
      ...SECTOR_NAMES,
      general: "Geral",
      typography: "Texto",
      decorations: "Decoração",
      extra: "Extras",
      flex: "Itens lado a lado",
      dimension: "Tamanho",
    },
    properties: PROPERTY_LABELS,
  },
  traitManager: {
    empty: "Selecione um elemento na página para ver as configurações dele.",
    label: "Configurações do elemento",
    traits: {
      labels: {
        // O "id" fica no fim, em "Avançado" (editor.css): serve de destino de links "#".
        id: "Âncora (para links #)",
        title: "Dica ao passar o mouse",
        href: "Endereço do link",
        target: "Abrir em",
        alt: "Descrição da imagem",
      },
      attributes: {
        id: { placeholder: "ex.: oferta" },
        alt: { placeholder: "ex.: Foto do produto" },
        title: { placeholder: "ex.: Clique para comprar" },
        href: { placeholder: "https://…" },
      },
      options: {
        target: {
          false: "Na mesma aba",
          _blank: "Em uma nova aba",
        },
      },
    },
  },
  storageManager: {
    recover: "Deseja recuperar as alterações que não foram salvas?",
  },
};

/** Mensagens completas em português do Brasil (use com locale "pt"). */
export const ptMessages: MessageTree = mergeMessages(ptBase as unknown as MessageTree, OVERRIDES);

/** Botões da barra de edição de texto (títulos em português). */
export const RTE_ACTIONS: { name: string; attributes: Record<string, string> }[] = [
  { name: "bold", attributes: { title: "Negrito" } },
  { name: "italic", attributes: { title: "Itálico" } },
  { name: "underline", attributes: { title: "Sublinhado" } },
  { name: "strikethrough", attributes: { title: "Riscado" } },
  { name: "link", attributes: { title: "Criar ou remover link", style: "font-size:1.4rem;padding:0 4px 2px;" } },
  { name: "wrap", attributes: { title: "Separar este trecho para mudar só o estilo dele" } },
];

function canUseLocalStorage() {
  try {
    return typeof window !== "undefined" && Boolean(window.localStorage);
  } catch {
    return false;
  }
}

/**
 * Seletor de cores: botões em português, paleta pronta e cores recentes (estas
 * só quando o navegador deixa usar o localStorage — senão o seletor quebraria).
 */
export function colorPickerOptions(): ColorPickerOptions {
  return {
    chooseText: "Aplicar",
    cancelText: "Cancelar",
    clearText: "Sem cor",
    noColorSelectedText: "Nenhuma cor escolhida",
    togglePaletteMoreText: "mais",
    togglePaletteLessText: "menos",
    preferredFormat: "hex",
    showPalette: true,
    showSelectionPalette: canUseLocalStorage(),
    maxSelectionSize: 7,
    localStorageKey: canUseLocalStorage() ? "offerstudio.cores-recentes" : false,
    palette: [
      ["#000000", "#1f2937", "#4b5563", "#9ca3af", "#d1d5db", "#f3f4f6", "#ffffff"],
      ["#dc2626", "#ea580c", "#f59e0b", "#facc15", "#16a34a", "#22c55e", "#10b981"],
      ["#0ea5e9", "#2563eb", "#4f46e5", "#7c3aed", "#c026d3", "#db2777", "#78350f"],
    ],
  };
}
