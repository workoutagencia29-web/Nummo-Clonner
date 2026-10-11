/**
 * Logo de um widget (cabeçalho de loja, rodapé): os campos que os dois usam —
 * "Trocar logo" (o gerenciador de imagens, como os dois cliques), "Descrição da
 * imagem", "Posição do logo no computador / no celular" e "Altura do logo" — e
 * a proporção da imagem gravada no estilo de quem guarda o logo (o "dono": o
 * cabeçalho, o rodapé).
 *
 * - Lugar: atributos do dono (computador / celular); o lugar padrão de cada
 *   widget fica sem o atributo (escolher o padrão tira o atributo).
 * - Altura: variável CSS no estilo do dono (como as cores do cabeçalho); o
 *   padrão tira a variável. Valor que não serve avisa e não grava.
 * - Proporção (largura ÷ altura da imagem): outra variável no estilo do dono,
 *   gravada quando a imagem carrega no canvas (logo trocado, troca desfeita,
 *   página aberta), fora do Desfazer — o CSS do widget limita a altura do logo
 *   largo à que cabe na largura máxima, sem faixa vazia em cima e embaixo.
 *   Depois de Desfazer/Refazer ela volta a bater com a imagem, e a de um dono
 *   que não está mais na página sai (desfazer o "pôr o widget" tira o
 *   elemento, mas a regra do id dele, gravada fora do Desfazer, ficaria).
 * - Os campos de lugar/tamanho estão no logo e no dono, e o GrapesJS guarda o
 *   campo desenhado: ao selecionar um dos dois, eles leem o valor de agora
 *   (mudado no outro, ou desfeito com o outro selecionado).
 *
 * Os nomes dos campos vêm do prefixo do widget ("os-sh" → "os-sh-logo-swap",
 * "os-sh-logo-pos", "os-sh-logo-pos-m", "os-sh-logo-h", "os-sh-logo-alt").
 */
import type { Component, Editor } from "grapesjs";
import type { Style } from "@/editor/blocks/shared";
import { editorTimeout } from "@/editor/grapes/lifecycle";
import { attr, baseStyle, cleanText, setBaseStyle } from "./dom";
import { isShLogoPos, SH_LOGO_POSITIONS, type ShLogoPos } from "./store-header-content";
import type { TraitDef } from "./traits";

export interface LogoSpec {
  /** Prefixo dos nomes dos campos ("os-sh", "os-ft"). */
  prefix: string;
  /** Dono do logo (o próprio, se for ele): guarda o lugar, a altura e a proporção. */
  ownerOf(c: Component): Component | undefined;
  /** Imagem do logo do dono (undefined: o dono ainda não tem). */
  imgOf(owner: Component): Component | undefined;
  /** Donos que estão na página agora (a proporção de quem saiu é apagada). */
  owners(editor: Editor): Component[];
  /** Imagens de logo na página agora. */
  logos(editor: Editor): Component[];
  /**
   * Antes de mexer no logo pelos campos (rodapé: liga o logo e põe o elemento,
   * se ainda não há). Devolve a imagem. Sem ela, os campos só valem com o logo.
   */
  prepare?(editor: Editor, owner: Component): Component | undefined;
  /**
   * O logo está ligado agora? (Só com `prepare`.) Desligado, o "Trocar logo"
   * abre o gerenciador sem mexer em nada e só liga o logo quando uma imagem é
   * escolhida: fechar com Cancelar não deixa o logo provisório na página.
   */
  shown?(owner: Component): boolean;
  /** Atributos do lugar no computador e no celular. */
  posAttr: string;
  posMAttr: string;
  /** Lugar sem o atributo (Esquerda, Centro ou Direita: os mesmos rótulos em todo widget). */
  defaultPos: ShLogoPos;
  /** Variáveis da altura e da proporção, no estilo do dono. */
  heightVar: string;
  ratioVar: string;
  height: { def: number; min: number; max: number };
  /** Descrição quando o campo fica vazio (o logo pode ser o único conteúdo de um link). */
  defaultAlt: string;
  /** Explicação de "no celular" × "no computador" (embaixo dos campos de lugar e tamanho). */
  placeNote: string;
}

/** Campos que leem valores calculados (redesenhados quando outro campo, ou outro elemento, muda). */
export function refreshTraits(component: Component, test: (name: string) => boolean) {
  for (const trait of component.getTraits()) {
    if (!test(String(trait.get("name")))) continue;
    trait.targetUpdated();
    (trait.view as unknown as { postUpdate?: () => void } | undefined)?.postUpdate?.();
  }
}

/** Imagem do logo, preparada para uma mudança (rodapé: liga o logo antes). */
function logoFor(editor: Editor, spec: LogoSpec, c: Component): Component | undefined {
  const owner = spec.ownerOf(c);
  if (!owner) return undefined;
  return spec.prepare ? spec.prepare(editor, owner) : spec.imgOf(owner);
}

/**
 * Logo desligado (ou dono ainda sem ele): o gerenciador de imagens abre sem
 * mexer no dono; escolher uma imagem liga o logo com ela (no mesmo passo do
 * Desfazer). Fechar sem escolher não muda nada.
 */
function pickLogo(editor: Editor, spec: LogoSpec, owner: Component, prepare: NonNullable<LogoSpec["prepare"]>) {
  const am = editor.AssetManager;
  am.open({
    types: ["image"],
    accept: "image/*",
    // O logo escondido, se já existe (a troca limpa as variantes da imagem dele: src/editor/grapes/assets.ts).
    target: spec.imgOf(owner),
    select: (asset, complete) => {
      prepare(editor, owner)?.set({ src: asset.getSrc() });
      if (complete) am.close();
    },
  });
}

/** "Trocar logo": o gerenciador de imagens (envio de arquivo e as imagens da oferta), como os dois cliques no logo. */
export function swapLogoTrait(spec: LogoSpec): TraitDef {
  return {
    type: "os-action",
    name: `${spec.prefix}-logo-swap`,
    label: "Trocar logo",
    osPrimary: true,
    osText: () => "Trocar logo",
    osHidden: (component) => {
      if (spec.prepare) return false;
      const owner = spec.ownerOf(component);
      return !owner || !spec.imgOf(owner);
    },
    osRun: (editor, component) => {
      const owner = spec.ownerOf(component);
      if (!owner) return;
      const { prepare } = spec;
      if (prepare && !(spec.shown?.(owner) ?? spec.imgOf(owner))) pickLogo(editor, spec, owner, prepare);
      else logoFor(editor, spec, component)?.trigger("active");
    },
  };
}

/**
 * "Descrição da imagem" (na imagem do logo). Nome próprio (grava o alt): com o
 * nome "alt", o exemplo traduzido ("ex.: Foto do produto") venceria. Vazio
 * volta ao padrão: num link, o logo é o único conteúdo (sem descrição, o link
 * fica sem nome).
 */
export function logoAltTrait(spec: LogoSpec, placeholder: string): TraitDef {
  return {
    type: "text",
    name: `${spec.prefix}-logo-alt`,
    label: "Descrição da imagem",
    placeholder,
    getValue: ({ component }) => attr(component, "alt"),
    setValue: ({ component, value }) => {
      component.addAttributes({ alt: cleanText(value) || spec.defaultAlt });
    },
  };
}

/** Lugar do logo (computador ou celular): atributo do dono; o lugar padrão tira o atributo. */
function logoPosTrait(spec: LogoSpec, mobile: boolean): TraitDef {
  const attrName = mobile ? spec.posMAttr : spec.posAttr;
  return {
    type: "select",
    name: `${spec.prefix}-logo-pos${mobile ? "-m" : ""}`,
    label: `Posição do logo ${mobile ? "no celular" : "no computador"}`,
    options: SH_LOGO_POSITIONS.map(([id, text]) => ({ id, label: text })),
    getValue: ({ component }) => {
      const owner = spec.ownerOf(component);
      const value = owner ? attr(owner, attrName) : "";
      return isShLogoPos(value) ? value : spec.defaultPos;
    },
    setValue: ({ editor, component, value }) => {
      const owner = spec.ownerOf(component);
      if (!owner || !isShLogoPos(value)) return;
      spec.prepare?.(editor, owner);
      if (value !== spec.defaultPos) owner.addAttributes({ [attrName]: value });
      else if (attrName in owner.getAttributes()) owner.removeAttributes(attrName);
    },
  };
}

/** Altura digitada (px): número da faixa do widget; vazio = o padrão. */
export function parseLogoHeight(raw: string, range: LogoSpec["height"]): { value: string } | { error: string } {
  const text = raw
    .replace(/\s*px$/i, "")
    .replace(",", ".")
    .trim();
  if (!text) return { value: "" };
  const n = Number(text);
  if (!/^\d+(\.\d+)?$/.test(text) || n < range.min || n > range.max) {
    return { error: `Use um número de ${range.min} a ${range.max} (em pixels; o padrão é ${range.def}).` };
  }
  return { value: String(Math.round(n)) };
}

/** "Altura do logo": variável no estilo do dono; o padrão tira a variável. */
function logoHeightTrait(spec: LogoSpec): TraitDef {
  const { height: range, heightVar } = spec;
  return {
    type: "os-store-field",
    name: `${spec.prefix}-logo-h`,
    label: `Altura do logo (px; padrão ${range.def})`,
    placeholder: String(range.def),
    osInputMode: "numeric",
    osParse: (raw: string) => parseLogoHeight(raw, range),
    getValue: ({ editor, component }) => {
      const owner = spec.ownerOf(component);
      const n = Number.parseFloat(owner ? (baseStyle(editor, owner)[heightVar] ?? "") : "");
      return String(Number.isFinite(n) ? n : range.def);
    },
    setValue: ({ editor, component, value }) => {
      const owner = spec.ownerOf(component);
      if (!owner) return;
      spec.prepare?.(editor, owner);
      const n = Number(value);
      const custom = Number.isFinite(n) && n >= range.min && n <= range.max && n !== range.def;
      setBaseStyle(editor, owner, { [heightVar]: custom ? `${n}px` : "" });
    },
  } as TraitDef;
}

/** Lugar e tamanho do logo (os mesmos no dono e no logo selecionado). */
export function logoPlaceTraits(spec: LogoSpec): TraitDef[] {
  return [
    logoPosTrait(spec, false),
    logoPosTrait(spec, true),
    logoHeightTrait(spec),
    { type: "os-note", name: `${spec.prefix}-logo-place-note`, label: spec.placeNote },
  ];
}

/**
 * Proporção do logo (largura ÷ altura da imagem) no estilo do dono, lida da
 * imagem desenhada no canvas. Fora do Desfazer: acompanha a imagem (desfazer
 * a troca recarrega a imagem antiga, e a proporção dela volta).
 */
export function syncLogoRatio(editor: Editor, spec: LogoSpec, logo: Component, img: HTMLImageElement) {
  const owner = spec.ownerOf(logo);
  if (!owner || !img.complete || !img.naturalWidth || !img.naturalHeight) return;
  const ratio = String(Math.round((img.naturalWidth / img.naturalHeight) * 10000) / 10000);
  if (baseStyle(editor, owner)[spec.ratioVar] === ratio) return;
  editor.UndoManager.skip(() => setBaseStyle(editor, owner, { [spec.ratioVar]: ratio }));
}

/**
 * Depois de Desfazer/Refazer (e ao abrir): a proporção de cada logo já
 * carregado volta a bater com a imagem (o Desfazer de uma cor ou da altura
 * devolve o estilo inteiro do dono, com a proporção de antes), e a de um dono
 * que não está mais na página (ou que ficou sem o logo) sai. Fora do Desfazer.
 */
export function syncLogoRatios(editor: Editor, spec: LogoSpec) {
  // Dono sem o logo (rodapé: desfazer o "Mostrar logo" tira o elemento) também perde a proporção.
  const owners = new Set(
    spec
      .owners(editor)
      .filter((o) => spec.imgOf(o))
      .map((o) => o.getId()),
  );
  for (const rule of editor.Css.getRules()) {
    const style = rule.getStyle() as Style;
    if (!(spec.ratioVar in style)) continue;
    const id = /^#([\w-]+)$/.exec(rule.selectorsToString())?.[1];
    if (!id || owners.has(id)) continue;
    const rest = { ...style };
    delete rest[spec.ratioVar];
    editor.UndoManager.skip(() => rule.setStyle(rest));
  }
  for (const logo of spec.logos(editor)) {
    // Elemento do canvas (outra janela: instanceof daqui não vale).
    const el = logo.getEl();
    if (el?.tagName === "IMG") syncLogoRatio(editor, spec, logo, el as HTMLImageElement);
  }
}

/** Imagens do logo no canvas que já avisam quando carregam. */
const watchedLogos = new WeakSet<HTMLElement>();

/** Imagem do logo desenhada no canvas: a proporção vai para o dono quando ela carrega. */
export function watchLogoImage(editor: Editor, spec: LogoSpec, model: Component, el: HTMLElement) {
  if (watchedLogos.has(el)) return;
  watchedLogos.add(el);
  const img = el as HTMLImageElement;
  img.addEventListener("load", () => syncLogoRatio(editor, spec, model, img));
  // Já carregada (do cache, sem novo "load"): confere logo depois de desenhar.
  editorTimeout(editor, () => syncLogoRatio(editor, spec, model, img));
}

/**
 * Liga a proporção (ao abrir e depois de Desfazer/Refazer) e a releitura dos
 * campos de lugar/tamanho ao selecionar o dono ou o logo (`isOwnerOrLogo`).
 */
export function watchLogos(editor: Editor, spec: LogoSpec, isOwnerOrLogo: (c: Component) => boolean) {
  const names = new Set(logoPlaceTraits(spec).map((t) => String(t.name)));
  editor.on("load", () => syncLogoRatios(editor, spec));
  editor.on("undo redo", () => syncLogoRatios(editor, spec));
  editor.on("component:selected", (c: Component) => {
    if (isOwnerOrLogo(c)) refreshTraits(c, (name) => names.has(name));
  });
}
