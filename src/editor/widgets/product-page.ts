/**
 * Página do produto no editor: tipos do GrapesJS da galeria de fotos
 * (data-os-widget="product-gallery") e da caixa de compra
 * (data-os-widget="product-buy"), com as Configurações de cada um. Conteúdo e
 * CSS em ./product-page-content.ts; comportamento só na página
 * (src/runtime/product: trocar a foto, barra de compra no celular).
 *
 * - Galeria: a foto grande é GERADA a partir da primeira miniatura (como as
 *   partes do cartão: `components: []` ao abrir, `getInnerHTML`), não é
 *   editável e clicar nela seleciona a galeria. Miniaturas: dois cliques trocam
 *   a foto (o clique seleciona a miniatura, que duplica, apaga e arrasta pela
 *   barra); "Usar como foto principal" põe a miniatura em primeiro. De 1 a
 *   GALLERY_MAX fotos: duplicar/colar param no limite e a única miniatura não
 *   sai (syncThumbLimits).
 * - Caixa de compra: as partes (selo, avaliação, preço, frete, vendidos,
 *   estoque) são as MESMAS do cartão da vitrine (tipo os-product-part, HTML de
 *   productPartHtml) e os campos do produto também (PRODUCT_FIELD_TRAITS,
 *   CURRENCY_TRAITS de ./products.ts). O "Comprar agora" é um botão comum (link
 *   da oferta ou pagamento na página: clique nele).
 */
import type { Component, Editor } from "grapesjs";
import { editorTimeout } from "@/editor/grapes/lifecycle";
import { attr, baseStyle, descendants, setBaseStyle } from "./dom";
import {
  BUY_BAR_ATTR,
  BUY_CSS,
  BUY_THEME,
  BUY_VARS,
  type BuyColor,
  GALLERY_CSS,
  GALLERY_IMG_TYPE,
  GALLERY_MAX,
  GALLERY_STAGE_ATTR,
  GALLERY_STAGE_TYPE,
  GALLERY_THUMB_TYPE,
  GALLERY_THUMBS_TYPE,
  GALLERY_TYPE,
  galleryPlaceholders,
  galleryStageHtml,
  galleryThumbDef,
  PRODUCT_BUY_TYPE,
} from "./product-page-content";
import { CURRENCY_TRAITS, PRODUCT_FIELD_TRAITS, productsOf, watchProductData } from "./products";
import { checkAttr, heading, type TraitDef } from "./traits";

export const isGallery = (c: Component) => attr(c, "data-os-widget") === "product-gallery";
export const isProductBuy = (c: Component) => attr(c, "data-os-widget") === "product-buy";

/** Galeria a que o componente pertence (ela mesma, se for a galeria). */
export function galleryOf(c: Component | undefined): Component | undefined {
  let at: Component | undefined = c;
  while (at && !isGallery(at)) at = at.parent();
  return at;
}

/** Caixa de compra a que o componente pertence (ela mesma, se for a caixa). */
export function productBuyOf(c: Component | undefined): Component | undefined {
  let at: Component | undefined = c;
  while (at && !isProductBuy(at)) at = at.parent();
  return at;
}

const isThumb = (c: Component) => c.get("type") === GALLERY_THUMB_TYPE;
const isThumbs = (c: Component) => c.get("type") === GALLERY_THUMBS_TYPE;
const isStage = (c: Component) => c.get("type") === GALLERY_STAGE_TYPE;

/** Miniaturas da galeria, na ordem. */
export const galleryThumbs = (gallery: Component) => descendants(gallery, isThumb);

/** Foto (img) de uma miniatura. */
const imgOf = (thumb: Component) => descendants(thumb, (c) => c.get("type") === GALLERY_IMG_TYPE)[0];

/** Endereço da foto de uma imagem do editor (o GrapesJS guarda o src fora dos atributos). */
const srcOf = (img: Component | undefined) => String(img?.get("src") || img?.getAttributes().src || "");

/** HTML da foto grande: a primeira miniatura. */
function stageHtml(gallery: Component | undefined): string {
  const first = gallery ? galleryThumbs(gallery)[0] : undefined;
  const img = first ? imgOf(first) : undefined;
  return img ? galleryStageHtml(srcOf(img), attr(img, "alt")) : "";
}

/** Redesenha no canvas a foto grande da galeria. */
export function redrawGallery(gallery: Component | undefined) {
  if (!gallery) return;
  for (const stage of descendants(gallery, isStage)) {
    const el = stage.getEl();
    if (el) el.innerHTML = stageHtml(gallery);
  }
}

/**
 * Limites das miniaturas, pela barra do elemento, pelo Delete e pelo colar: só
 * duplica (copia) abaixo de GALLERY_MAX fotos e a única miniatura não sai (a
 * galeria nunca fica sem foto). Fora do Desfazer e sem contar como edição: é
 * consequência do número de fotos.
 */
export function syncThumbLimits(editor: Editor, gallery: Component | undefined) {
  if (!gallery) return;
  const thumbs = galleryThumbs(gallery);
  const copyable = thumbs.length < GALLERY_MAX;
  const removable = thumbs.length > 1;
  const stale = thumbs.filter((t) => t.get("copyable") !== copyable || t.get("removable") !== removable);
  if (!stale.length) return;
  const apply = () => {
    for (const thumb of stale) {
      thumb.set({ copyable, removable, toolbar: null } as never, { avoidStore: true } as never);
      // A barra (Duplicar/Excluir) é montada com os valores de agora.
      (thumb as unknown as { initToolbar(): void }).initToolbar();
    }
  };
  const em = editor.getModel() as unknown as { skip?: (clb: () => void) => void };
  editor.UndoManager.skip(() => (em.skip ? em.skip(apply) : apply()));
}

// ─── Ações ───────────────────────────────────────────────────────────────────

/** "＋ Adicionar foto": miniatura nova no fim (foto provisória), já selecionada, com a escolha da foto aberta. */
export function addGalleryPhoto(editor: Editor, gallery: Component): Component | undefined {
  const list = descendants(gallery, isThumbs)[0];
  if (!list || galleryThumbs(gallery).length >= GALLERY_MAX) return;
  const n = galleryThumbs(gallery).length + 1;
  const [added] = list.append(galleryThumbDef({ ...galleryPlaceholders(1)[0], alt: `Foto ${n} do produto` }) as never);
  if (!added) return;
  editor.select(added);
  // Abre a escolha da foto (como soltar o bloco "Imagem").
  editorTimeout(editor, () => imgOf(added)?.trigger("active"), 0);
  return added;
}

/** "Usar como foto principal": a miniatura vai para o começo (vira a foto grande). */
export function makeMainPhoto(thumb: Component) {
  const list = thumb.parent();
  if (!list || thumb.index() === 0) return;
  thumb.move(list, { at: 0 });
}

// ─── Configurações ───────────────────────────────────────────────────────────

const GALLERY_TRAITS: TraitDef[] = [
  {
    type: "os-action",
    name: "os-pg-add",
    osText: (c) => {
      const g = galleryOf(c);
      return g && galleryThumbs(g).length >= GALLERY_MAX ? `Máximo de ${GALLERY_MAX} fotos` : "＋ Adicionar foto";
    },
    osDisabled: (c) => {
      const g = galleryOf(c);
      return !g || galleryThumbs(g).length >= GALLERY_MAX;
    },
    osRun: (editor, c) => {
      const g = galleryOf(c);
      if (g) addGalleryPhoto(editor, g);
    },
  },
  {
    type: "os-note",
    name: "os-pg-note",
    label: `Dois cliques numa miniatura trocam a foto; a primeira é a foto grande. Para apagar, duplicar ou mudar a ordem, clique na miniatura (barra dela ou arrastando). A galeria tem de 1 a ${GALLERY_MAX} fotos.`,
  },
];

/** Descrição da foto (texto alternativo da imagem da miniatura). */
const altTrait: TraitDef = {
  type: "text",
  name: "os-pg-alt",
  label: "Descrição da foto (leitores de tela e Google)",
  placeholder: "Ex.: Fone de ouvido preto, de lado",
  getValue: ({ component }) => {
    const img = imgOf(component);
    return img ? attr(img, "alt") : "";
  },
  setValue: ({ component, value }) => {
    const img = imgOf(component);
    if (img)
      img.addAttributes({
        alt: String(value ?? "")
          .replace(/\s+/g, " ")
          .trim(),
      });
  },
};

const THUMB_TRAITS: TraitDef[] = [
  {
    type: "os-note",
    name: "os-pg-thumb-note",
    label: "Dois cliques na miniatura trocam a foto. A primeira miniatura é a foto grande da galeria.",
  },
  {
    type: "os-action",
    name: "os-pg-swap",
    osText: () => "Trocar foto",
    osRun: (_editor, c) => imgOf(c)?.trigger("active"),
  },
  {
    type: "os-action",
    name: "os-pg-main",
    osText: (c) => (c.index() === 0 ? "Esta é a foto principal" : "Usar como foto principal"),
    osDisabled: (c) => c.index() === 0,
    osRun: (_editor, c) => makeMainPhoto(c),
  },
  altTrait,
];

/** Cor da caixa de compra (variável no estilo base dela). */
function buyColorTrait(color: BuyColor, label: string): TraitDef {
  const prop = BUY_VARS[color];
  return {
    type: "os-color",
    name: `os-pb-color-${color}`,
    label,
    getValue: ({ editor, component }) => {
      const box = productBuyOf(component);
      return box ? baseStyle(editor, box)[prop] || BUY_THEME[color] : "";
    },
    setValue: ({ editor, component, value }) => {
      const box = productBuyOf(component);
      if (box) setBaseStyle(editor, box, { [prop]: String(value ?? "") });
    },
  };
}

const BUY_TRAITS: TraitDef[] = [
  heading("Produto", "pb-produto"),
  {
    type: "os-note",
    name: "os-pb-note",
    label:
      "O nome também dá para editar direto na caixa (dois cliques). Para onde o “Comprar agora” leva (link da oferta ou pagamento na página): clique nele.",
  },
  ...PRODUCT_FIELD_TRAITS,
  heading("Moeda e idioma", "pb-moeda"),
  ...CURRENCY_TRAITS,
  heading("Celular", "pb-celular"),
  checkAttr(BUY_BAR_ATTR, "Barra de compra fixa embaixo no celular", true),
  {
    type: "os-note",
    name: "os-pb-bar-note",
    label:
      "Ligada: no celular, quando o “Comprar agora” sai da tela, aparece embaixo uma barra com o preço e o botão (o mesmo destino, eventos e pagamento).",
  },
  heading("Cores", "pb-cores"),
  buyColorTrait("btn", "Botão “Comprar agora”"),
  buyColorTrait("btnInk", "Texto do botão"),
  buyColorTrait("price", "Cor do preço"),
  buyColorTrait("off", "Cor do % OFF"),
  buyColorTrait("ship", "Cor do frete (e das garantias)"),
  buyColorTrait("badge", "Cor do selo"),
];

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Partes fixas da estrutura: não saem, não se mexem e não recebem outros elementos. */
const FIXED = { draggable: false, droppable: false, removable: false, copyable: false };

const selectGallery = { select: (c: Component) => galleryOf(c) ?? c };

export function registerProductPageTypes(editor: Editor) {
  const dc = editor.DomComponents;

  dc.addType(GALLERY_TYPE, {
    isComponent: (node) => node.getAttribute?.("data-os-widget") === "product-gallery",
    model: {
      defaults: {
        name: "Galeria de fotos do produto",
        droppable: false,
        // Galeria dentro de outra galeria, de uma vitrine ou da caixa de compra não faz sentido.
        draggable: (_g: Component, target: Component) =>
          !galleryOf(target) && !productsOf(target) && !productBuyOf(target),
        traits: GALLERY_TRAITS,
        styles: GALLERY_CSS,
      },
    },
  });

  // Foto grande: gerada a partir da primeira miniatura (os filhos salvos são ignorados ao abrir).
  dc.addType(GALLERY_STAGE_TYPE, {
    isComponent: (node) =>
      node.hasAttribute?.(GALLERY_STAGE_ATTR) ? { type: GALLERY_STAGE_TYPE, components: [] } : false,
    model: {
      defaults: { name: "Foto grande", ...FIXED, editable: false, layerable: false, delegate: selectGallery },
      getInnerHTML(this: Component) {
        return stageHtml(galleryOf(this));
      },
    },
    view: {
      onRender({ el, model }: { el: HTMLElement; model: Component }) {
        el.innerHTML = stageHtml(galleryOf(model));
      },
    },
  });

  dc.addType(GALLERY_THUMBS_TYPE, {
    isComponent: (node) =>
      node.tagName === "DIV" &&
      (node.classList?.contains("os-pg-thumbs") ?? false) &&
      node.parentElement?.getAttribute("data-os-widget") === "product-gallery",
    model: {
      defaults: {
        name: "Miniaturas",
        draggable: false,
        removable: false,
        copyable: false,
        // Só miniaturas entram aqui (arrastar nas Camadas ou pela barra da miniatura).
        droppable: ".os-pg-thumb",
        delegate: selectGallery,
      },
      init(this: Component) {
        // Miniatura nova, apagada ou em outra ordem: a foto grande acompanha a primeira. Os
        // limites acompanham o número de fotos na hora (dois "Duplicar" seguidos no limite).
        this.listenTo(this.components(), "add remove reset", () => {
          syncThumbLimits(editor, galleryOf(this));
          editorTimeout(editor, () => redrawGallery(galleryOf(this)), 0);
        });
        editorTimeout(editor, () => syncThumbLimits(editor, galleryOf(this)), 0);
      },
    },
  });

  dc.addType(GALLERY_THUMB_TYPE, {
    isComponent: (node) => node.tagName === "BUTTON" && (node.classList?.contains("os-pg-thumb") ?? false),
    model: {
      defaults: {
        tagName: "button",
        name: "Foto",
        droppable: false,
        // Só numa fileira de miniaturas: a dela, ou outra que ainda não tem GALLERY_MAX fotos.
        draggable: (thumb: Component, target: Component) =>
          isThumbs(target) && (thumb.parent() === target || target.components().length < GALLERY_MAX),
        editable: false,
        traits: THUMB_TRAITS,
      },
      // Nas camadas: "Foto 1", "Foto 2"…
      getName(this: Component) {
        const custom = this.get("custom-name");
        return custom ? String(custom) : `Foto ${this.index() + 1}`;
      },
    },
  });

  // Foto da miniatura: dois cliques trocam (imagem comum); o clique seleciona a miniatura.
  dc.addType(GALLERY_IMG_TYPE, {
    extend: "image",
    isComponent: (node) => node.tagName === "IMG" && !!node.parentElement?.classList.contains("os-pg-thumb"),
    model: {
      defaults: {
        name: "Foto",
        ...FIXED,
        layerable: false,
        delegate: { select: (c: Component) => c.parent() ?? c },
      },
      init(this: Component) {
        this.on("change:src change:attributes:alt change:attributes:src", () => redrawGallery(galleryOf(this)));
      },
    },
  });

  dc.addType(PRODUCT_BUY_TYPE, {
    isComponent: (node) => node.getAttribute?.("data-os-widget") === "product-buy",
    model: {
      defaults: {
        name: "Caixa de compra",
        // Caixa de compra dentro de outra, de uma vitrine ou da galeria não faz sentido.
        draggable: (_b: Component, target: Component) =>
          !productBuyOf(target) && !productsOf(target) && !galleryOf(target),
        traits: BUY_TRAITS,
        styles: BUY_CSS,
      },
      init(this: Component) {
        // Os dados do produto, a moeda e o idioma ficam na própria caixa: as partes acompanham.
        watchProductData(this, true);
      },
    },
  });
}
