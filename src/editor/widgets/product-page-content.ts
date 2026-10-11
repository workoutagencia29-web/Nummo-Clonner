/**
 * Página do produto (categoria "Loja"): a galeria de fotos
 * (data-os-widget="product-gallery") e a caixa de compra
 * (data-os-widget="product-buy") — o CSS da página, as definições usadas pelos
 * blocos e pelo modelo "Página do produto" (src/editor/templates/product.ts)
 * e os ganchos que a criação automática das páginas preenche no servidor.
 * Sem GrapesJS aqui.
 *
 * Galeria:
 *
 *   div.os-pg[data-os-widget=product-gallery]
 *     div.os-pg-stage[data-os-pg-stage] > img.os-pg-main   (GERADA: a 1ª miniatura)
 *     div.os-pg-thumbs > button.os-pg-thumb[type=button] > img   (até 8; dois cliques trocam a foto)
 *
 * A foto grande não é guardada como elemento no editor: o HTML dela vem da
 * primeira miniatura (galleryStageHtml), ao desenhar e ao salvar, como as
 * partes do cartão de produto. Na página (src/runtime/product), clicar numa
 * miniatura mostra a foto dela e clicar na foto grande passa para a próxima;
 * com uma foto só, a fileira de miniaturas some.
 *
 * Caixa de compra (os dados e as partes geradas são os MESMOS do cartão da
 * vitrine: data-os-pd-* + moeda/idioma no próprio elemento, src/lib/store.ts):
 *
 *   div.os-pb[data-os-widget=product-buy][data-os-currency][data-os-pd-*…][data-os-pb-bar="1"]
 *     p.os-pd-badge[data-os-pd-part=badge]    (gerada)
 *     h1.os-pb-name                            (texto)
 *     div.os-pd-rating / div.os-pd-price / p.os-pd-ship / p.os-pd-sold / p.os-pd-stock  (geradas)
 *     a.os-btn.os-pb-buy[data-os-link=""]      ("Comprar agora": botão comum — link da oferta ou pagamento na página)
 *     ul.os-pb-trust > li × 3                  (textos)
 *
 * No celular, quando o "Comprar agora" sai da tela, a página mostra embaixo
 * uma barra fixa com o preço e uma cópia do botão (data-os-pb-bar, padrão
 * ligado; src/runtime/product).
 */
import { type Def, PROP_AUTO_LINK, PROP_OFFER_CURRENCY } from "@/editor/blocks/shared";
import {
  CURRENCY_ATTR,
  DEFAULT_CURRENCY,
  GALLERY_STAGE_ATTR,
  galleryStageHtml,
  LANG_ATTR,
  type ProductData,
  type ProductPart,
  productAttrs,
  productPartHtml,
  readProduct,
  type StoreCurrency,
  type StoreLang,
  storeLang,
} from "@/lib/store";
import { esc, PRODUCT_NAME_TYPE, partDef, productPlaceholder, SR_ONLY, starsCss } from "./products-content";

export const GALLERY_TYPE = "os-product-gallery";
/** Foto grande (gerada a partir da primeira miniatura). */
export const GALLERY_STAGE_TYPE = "os-pg-stage";
/** Fileira das miniaturas (só miniaturas entram). */
export const GALLERY_THUMBS_TYPE = "os-pg-thumbs";
export const GALLERY_THUMB_TYPE = "os-pg-thumb";
export const GALLERY_IMG_TYPE = "os-pg-img";
export const PRODUCT_BUY_TYPE = "os-product-buy";
// A foto grande (conteúdo gerado) e o HTML dela ficam em src/lib/store.ts (o localizar e
// substituir também refaz a foto grande).
export { GALLERY_STAGE_ATTR, galleryStageHtml };

/** Mais fotos que isso não cabem bem na coluna de miniaturas. */
export const GALLERY_MAX = 8;
/** Barra de compra fixa embaixo no celular ("1" liga, padrão; "0" desliga). */
export const BUY_BAR_ATTR = "data-os-pb-bar";
/** "‹ Voltar para a loja" (sem destino: volta para a página anterior ou vai para o logo). */
export const BACK_ATTR = "data-os-pd-back";

/**
 * Ganchos do modelo "Página do produto" que a criação automática das páginas
 * (a partir dos cartões da vitrine) preenche: seletores estáveis.
 */
export const PRODUCT_PAGE_HOOKS = {
  /** Cabeçalho de loja (trocado pelo cabeçalho da vitrine, quando ela tem um). */
  header: '[data-os-widget="store-header"]',
  /** Logo do cabeçalho: href = os-page:<página da vitrine>. */
  logo: ".os-sh-logo",
  /** Carrinho do cabeçalho: o mesmo link da oferta do "Comprar agora". */
  cart: ".os-sh-cart",
  /** "‹ Voltar para a loja": href = os-page:<página da vitrine>. */
  back: `a[${BACK_ATTR}]`,
  /** Galeria: miniaturas (button.os-pg-thumb > img) e a foto grande gerada (galleryStageHtml). */
  gallery: '[data-os-widget="product-gallery"]',
  /** Caixa de compra: data-os-pd-* + data-os-currency (partes refeitas com productPartHtml). */
  buy: '[data-os-widget="product-buy"]',
  /** Nome do produto (h1). */
  name: ".os-pb-name",
  /** "Comprar agora": data-os-link=<chave do link da oferta> (ou "" = escolher depois). */
  buyButton: "a.os-pb-buy",
  /** "Opiniões do produto": a nota média (com as estrelas) é a avaliação do produto; sem avaliação, sai. */
  score: ".os-pp-score",
  scoreAvg: ".os-pp-avg",
  stars: ".os-pp-score .os-pp-stars",
} as const;

/** Estrelas da nota média de "Opiniões do produto" ("★★★★☆" para 4,4). */
export function scoreStars(rating: number): string {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(full) + "☆".repeat(5 - full);
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const G = ".os-pg";
const B = ".os-pb";

/**
 * CSS da galeria (vira regras editáveis do projeto, como o da vitrine). Foto
 * grande quadrada com padding-top (sem aspect-ratio: Safari 13). Computador:
 * miniaturas em coluna à esquerda; celular: foto em cima e miniaturas numa
 * fileira que rola para o lado. Com uma foto só, a fileira some.
 */
export const GALLERY_CSS = [
  // Solta sozinha numa página larga, não vira uma foto gigante (numa coluna, ocupa a coluna).
  `${G}{display:flex;align-items:flex-start;box-sizing:border-box;width:100%;max-width:760px;margin:0 auto;padding:0}`,
  `${G} *,${G} *::before,${G} *::after{box-sizing:border-box}`,
  `${G} .os-pg-stage{position:relative;order:2;flex:1 1 auto;min-width:0;margin:0;padding:0;overflow:hidden;border-radius:8px;background-color:#ffffff}`,
  `${G} .os-pg-stage::before{content:"";display:block;padding-top:100%}`,
  `${G} .os-pg-main{position:absolute;top:0;left:0;display:block;width:100%;height:100%;max-width:none;margin:0;padding:16px;border:0;border-radius:0;object-fit:contain}`,
  `${G}.os-pg-js .os-pg-main{cursor:pointer}`,
  `${G} .os-pg-thumbs{order:1;display:flex;flex:0 0 auto;flex-direction:column;margin:0;padding:0}`,
  `${G} .os-pg-thumb{display:block;flex:0 0 auto;width:64px;height:64px;margin:0 12px 8px 0;padding:3px;overflow:hidden;border-width:1px;border-style:solid;border-color:#d9d9d9;border-radius:6px;background-color:#ffffff;line-height:0;cursor:pointer}`,
  `${G} .os-pg-thumb img{display:block;width:100%;height:100%;max-width:none;margin:0;padding:0;border:0;border-radius:3px;object-fit:contain}`,
  `@media (hover:hover){${G} .os-pg-thumb:hover{border-color:#1f63d6}}`,
  // A miniatura da foto à vista (sem o script, a primeira).
  `${G} .os-pg-thumb[aria-current=true],${G}:not(.os-pg-js) .os-pg-thumb:first-child{border-color:#1f63d6;box-shadow:0 0 0 1px #1f63d6}`,
  `${G} .os-pg-thumb:focus-visible{outline-width:2px;outline-style:solid;outline-color:#1f63d6;outline-offset:2px}`,
  `${G} .os-pg-thumb:only-child{display:none}`,
  // Celular e tablet em pé: foto em cima (até 480 px: num tablet, uma foto da largura da tela empurraria o resto para baixo).
  `@media (max-width:768px){${G}{flex-direction:column;max-width:480px}${G} .os-pg-stage{order:0;flex:0 0 auto;width:100%}${G} .os-pg-thumbs{order:1;flex-direction:row;max-width:100%;margin:10px 0 0;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none}${G} .os-pg-thumbs::-webkit-scrollbar{display:none}${G} .os-pg-thumb{width:56px;height:56px;margin:0 8px 0 0}}`,
].join("");

/** Variáveis das cores da caixa de compra (as das partes são as mesmas do cartão: --os-pd-*). */
export const BUY_VARS = {
  btn: "--os-pb-btn",
  btnInk: "--os-pb-btn-ink",
  price: "--os-pd-price",
  off: "--os-pd-off",
  ship: "--os-pd-ship",
  badge: "--os-pd-badge",
} as const;
export type BuyColor = keyof typeof BUY_VARS;

/** Cores padrão (as do CSS; verde e azul com contraste de 4,5:1 no branco). */
export const BUY_THEME: Record<BuyColor, string> = {
  btn: "#1f63d6",
  btnInk: "#ffffff",
  price: "#333333",
  off: "#00863f",
  ship: "#00863f",
  badge: "#1f63d6",
};

const BV = BUY_VARS;
const BT = BUY_THEME;
const MUTED = "#767676";

/**
 * CSS da caixa de compra. As partes geradas são as do cartão (mesmas classes
 * os-pd-*), com o visual da página do produto: preço grande com os centavos em
 * cima, o antigo riscado em cima dele, % OFF verde ao lado, parcelas, frete
 * verde. Com var(), só propriedades simples; sem !important. Partes vazias e
 * as regras de parte vazia vêm por último.
 */
export const BUY_CSS = [
  `${B}{${BV.btn}:${BT.btn};${BV.btnInk}:${BT.btnInk};--os-pd-ink:#333333;${BV.price}:${BT.price};${BV.off}:${BT.off};${BV.ship}:${BT.ship};${BV.badge}:${BT.badge};position:relative;box-sizing:border-box;width:100%;max-width:560px;margin:0 auto;padding:24px;border-width:1px;border-style:solid;border-color:#e6e6e6;border-radius:8px;background-color:#ffffff;color:var(--os-pd-ink);font-family:inherit;font-size:16px;line-height:1.35;text-align:left}`,
  `${B} *,${B} *::before,${B} *::after{box-sizing:border-box}`,
  `${B} .os-pd-badge{display:inline-block;max-width:100%;margin:0 0 10px;padding:3px 8px;border-radius:4px;background-color:var(${BV.badge});color:#ffffff;font-size:12px;font-weight:700;line-height:1.3;letter-spacing:.02em;text-transform:uppercase}`,
  `${B} .os-pb-name{margin:0 0 8px;color:inherit;font-family:inherit;font-size:24px;font-weight:600;line-height:1.3;letter-spacing:normal;text-transform:none}`,
  `${B} .os-pd-rating{display:flex;flex-wrap:wrap;align-items:center;margin:0 0 12px;color:#666666;font-size:14px;line-height:1.3}`,
  ...starsCss(B, 15),
  `${B} .os-pd-sr,${B} .os-pd-dec{${SR_ONLY}}`,
  `${B} .os-pd-price{display:flex;flex-wrap:wrap;align-items:baseline;margin:4px 0 0;color:var(${BV.price})}`,
  `${B} .os-pd-old{order:1;flex:0 0 100%;margin:0 0 2px;color:${MUTED};font-size:16px;line-height:1.35;text-decoration:line-through}`,
  `${B} .os-pd-now{order:2;color:var(${BV.price});font-size:36px;font-weight:400;line-height:1.15}`,
  `${B} .os-pd-int{white-space:nowrap}`,
  `${B} .os-pd-cents{position:relative;top:-.8em;margin-left:2px;font-size:45%;line-height:0;vertical-align:baseline}`,
  `${B} .os-pd-off{order:3;margin:0 0 0 10px;color:var(${BV.off});font-size:18px;font-weight:600;line-height:1.35}`,
  `${B} .os-pd-inst{order:4;flex:0 0 100%;margin-top:4px;color:inherit;font-size:16px;line-height:1.35}`,
  `${B} .os-pd-free{color:var(${BV.ship})}`,
  `${B} .os-pd-ship{margin:12px 0 0;color:var(${BV.ship});font-size:16px;font-weight:600;line-height:1.35}`,
  `${B} .os-pd-sold{margin:6px 0 0;color:${MUTED};font-size:14px;line-height:1.35}`,
  `${B} .os-pd-stock{margin:10px 0 0;font-size:14px;line-height:1.35}`,
  `${B} .os-pd-stk{display:inline-block;padding:3px 8px;border-radius:4px;background-color:#e6f6ec;color:#11713b}`,
  `${B} .os-pd-low{background-color:#fdeaea;color:#c62828}`,
  `${B} .os-pb-buy{display:block;width:100%;max-width:none;margin:18px 0 0;padding:15px 20px;border:0;border-radius:6px;background-color:var(${BV.btn});color:var(${BV.btnInk});font-family:inherit;font-size:17px;font-weight:600;line-height:1.25;letter-spacing:normal;text-align:center;text-decoration:none;text-transform:none;box-shadow:none;cursor:pointer}`,
  `${B} .os-pb-buy:focus-visible{outline-width:3px;outline-style:solid;outline-color:#111827;outline-offset:2px}`,
  `${B} .os-pb-trust{margin:18px 0 0;padding:0;list-style:none;color:#555555;font-size:14px;line-height:1.4}`,
  `${B} .os-pb-trust li{position:relative;margin:8px 0 0;padding:0 0 0 24px}`,
  `${B} .os-pb-trust li::before{content:"\\2713";position:absolute;top:0;left:2px;color:var(${BV.ship});font-weight:700}`,
  `@media (max-width:768px){${B}{max-width:none;padding:16px}${B} .os-pb-name{font-size:20px}${B} .os-pd-now{font-size:32px}}`,
  // Por último: parte sem dado não ocupa lugar.
  `${["badge", "rating", "price", "ship", "sold", "stock"].map((p) => `${B} .os-pd-${p}:empty`).join(",")}{display:none}`,
].join("");

// ─── Definições ──────────────────────────────────────────────────────────────

export interface GalleryPhoto {
  src: string;
  alt: string;
}

/** Fotos provisórias da galeria (o usuário troca com dois cliques). */
export const galleryPlaceholders = (n: number): GalleryPhoto[] =>
  Array.from({ length: n }, (_, i) => ({ src: productPlaceholder(), alt: `Foto ${i + 1} do produto` }));

/** Uma miniatura da galeria. */
export function galleryThumbDef(photo: GalleryPhoto): Def {
  return {
    type: GALLERY_THUMB_TYPE,
    tagName: "button",
    name: "Foto",
    classes: ["os-pg-thumb"],
    attributes: { type: "button" },
    components: [
      {
        type: GALLERY_IMG_TYPE,
        tagName: "img",
        name: "Foto",
        attributes: { src: photo.src, alt: photo.alt },
      },
    ],
  };
}

/** A galeria inteira. `html`: para o HTML de um modelo de página (foto grande já desenhada). */
export function galleryDef(photos: GalleryPhoto[], { html = false } = {}): Def {
  const list = photos.slice(0, GALLERY_MAX);
  const first = list[0];
  return {
    type: GALLERY_TYPE,
    tagName: "div",
    name: "Galeria de fotos do produto",
    classes: ["os-pg"],
    attributes: { "data-os-widget": "product-gallery" },
    components: [
      {
        type: GALLERY_STAGE_TYPE,
        tagName: "div",
        name: "Foto grande",
        classes: ["os-pg-stage"],
        attributes: { [GALLERY_STAGE_ATTR]: "" },
        ...(html && first && { content: galleryStageHtml(first.src, first.alt) }),
      },
      {
        type: GALLERY_THUMBS_TYPE,
        tagName: "div",
        name: "Miniaturas",
        classes: ["os-pg-thumbs"],
        components: list.map(galleryThumbDef),
      },
    ],
  };
}

/** Textos padrão da caixa de compra (o usuário troca pelos dele; tudo editável). */
export const BUY_TEXTS = {
  button: "Comprar agora",
  trust: ["Compra segura: pagamento protegido", "Devolução grátis em até 7 dias", "Envio com código de rastreio"],
} as const;

export interface ProductBuySpec {
  name: string;
  data: Partial<ProductData>;
  currency?: StoreCurrency;
  /** Idioma das frases geradas (padrão: o da moeda). */
  lang?: StoreLang;
  /** Barra de compra fixa embaixo no celular (padrão: ligada). */
  bar?: boolean;
}

/** Produto de exemplo da caixa de compra (bloco e modelo "Página do produto"). */
export const EXAMPLE_BUY: ProductBuySpec = {
  name: "Fone de ouvido Bluetooth sem fio",
  data: {
    price: 12990,
    old: 21990,
    inst: 12,
    ship: "Frete grátis",
    sold: "+5mil vendidos",
    rating: 4.7,
    reviews: 2381,
  },
};

/**
 * A caixa de compra. `html`: para o HTML de um modelo de página (partes já
 * desenhadas; a moeda vem do servidor, a da oferta); no editor elas são
 * refeitas a partir dos atributos. Num bloco sem moeda escolhida, a caixa
 * nasce na moeda da oferta (PROP_OFFER_CURRENCY, src/editor/widgets/hooks.ts).
 */
export function productBuyDef(spec: ProductBuySpec, { html = false } = {}): Def {
  const currency = spec.currency ?? DEFAULT_CURRENCY;
  const lang = storeLang(spec.lang, currency);
  const attrs = productAttrs(spec.data);
  const data = readProduct(attrs);
  const part = (p: ProductPart, tag: string) =>
    partDef(p, tag, html ? productPartHtml(p, data, currency, lang) : undefined);
  return {
    type: PRODUCT_BUY_TYPE,
    tagName: "div",
    name: "Caixa de compra",
    classes: ["os-pb"],
    attributes: {
      "data-os-widget": "product-buy",
      [CURRENCY_ATTR]: currency,
      ...(spec.lang && { [LANG_ATTR]: spec.lang }),
      ...attrs,
      [BUY_BAR_ATTR]: spec.bar === false ? "0" : "1",
    },
    ...(!html && !spec.currency && { [PROP_OFFER_CURRENCY]: true }),
    components: [
      part("badge", "p"),
      {
        type: PRODUCT_NAME_TYPE,
        tagName: "h1",
        name: "Nome do produto",
        classes: ["os-pb-name"],
        content: esc(spec.name),
      },
      part("rating", "div"),
      part("price", "div"),
      part("ship", "p"),
      part("sold", "p"),
      part("stock", "p"),
      {
        type: "os-button",
        tagName: "a",
        name: "Botão “Comprar agora”",
        classes: ["os-btn", "os-pb-buy"],
        // Pede o link da oferta (aviso do canvas e do ZIP); ao soltar o bloco, já liga ao
        // primeiro checkout da oferta, se houver (como o "Botão do checkout").
        attributes: { href: "#", "data-os-link": "" },
        [PROP_AUTO_LINK]: "CHECKOUT",
        content: esc(BUY_TEXTS.button),
      },
      {
        tagName: "ul",
        name: "Garantias",
        classes: ["os-pb-trust"],
        components: BUY_TEXTS.trust.map((t) => ({ type: "text", tagName: "li", name: "Garantia", content: esc(t) })),
      },
    ],
  };
}
