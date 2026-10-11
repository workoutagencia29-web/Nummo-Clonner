/**
 * Vitrine de produtos (data-os-widget="products"): o CSS da página e as
 * definições da vitrine e dos cartões, usados pelos blocos da categoria
 * "Loja", pelo "＋ Adicionar produto" das Configurações e (depois) pelos
 * modelos de página montados no servidor. Sem GrapesJS aqui.
 *
 * Estrutura (as classes os-pd-* são o visual; o script da página,
 * src/runtime, lê o formato, a trilha, os cartões e as setas):
 *
 *   section.os-products[data-os-widget=products][data-os-layout=grid|carousel][data-os-cols=1..6]
 *          [data-os-cols-m=1|2][data-os-card=classic|compact|highlight][data-os-currency=BRL…]
 *          [data-os-pd-lang=pt|es|en: idioma das frases geradas; sem ele, o da moeda]
 *          [data-os-show-<parte>="0" desliga; data-os-show-more="1" liga o "Ver todas"]
 *     div.os-pd-head > h2.os-pd-title (texto) + a.os-pd-more ("Ver todas", link comum)
 *     div.os-pd-wrap
 *       div.os-pd-track[data-os-pd-track]
 *         a.os-pd-card[data-os-product][href][data-os-pd-*…]   (dados: src/lib/store.ts)
 *           div.os-pd-media > img.os-pd-img
 *           div.os-pd-body
 *             p.os-pd-badge[data-os-pd-part=badge]     (gerada)
 *             h3.os-pd-name                            (texto)
 *             div.os-pd-rating[data-os-pd-part=rating] (gerada)
 *             div.os-pd-price[data-os-pd-part=price]   (gerada: .os-pd-off, s.os-pd-old, .os-pd-now, .os-pd-inst)
 *             p.os-pd-ship / p.os-pd-sold / p.os-pd-stock [data-os-pd-part] (geradas)
 *       button.os-pd-nav.os-pd-prev / button.os-pd-nav.os-pd-next  (setas do carrossel; só com JS;
 *                                                                   nome para leitores de tela gerado)
 *
 * As partes geradas não são guardadas como elementos no editor: o HTML delas
 * vem dos atributos do cartão + moeda e idioma da vitrine (productPartHtml),
 * ao desenhar e ao salvar (src/editor/widgets/products.ts). A foto do cartão
 * tem alt vazio: o nome já está no h3 do mesmo link. Os três modelos de
 * cartão têm a mesma estrutura: muda só o CSS (ordem das partes com `order`).
 * Cores em variáveis na própria vitrine (--os-pd-bg, --os-pd-card…).
 */
import { type Def, PROP_OFFER_CURRENCY, placeholderImage, type Style } from "@/editor/blocks/shared";
import {
  CURRENCY_ATTR,
  DEFAULT_CURRENCY,
  LANG_ATTR,
  PART_ATTR,
  PRODUCT_ATTR,
  type ProductData,
  type ProductPart,
  productAttrs,
  productPartHtml,
  readProduct,
  STORE_TEXTS,
  type StoreCurrency,
  type StoreLang,
  storeLang,
} from "@/lib/store";

export const PRODUCTS_TYPE = "os-products";
/** Cartão de produto (a[data-os-product]). */
export const PRODUCT_TYPE = "os-product";
/** Parte gerada do cartão (selo, avaliação, preço, frete, vendidos, estoque). */
export const PRODUCT_PART_TYPE = "os-product-part";
/** Trilha dos cartões (só cartões entram). */
export const PRODUCTS_TRACK_TYPE = "os-products-track";
/** Linha com duas vitrines lado a lado ("Oferta do dia + ofertas": só vitrines entram). */
export const PRODUCTS_ROW_TYPE = "os-products-row";
/** Caixas fixas da estrutura (foto, dados, área da trilha). */
export const PRODUCTS_BOX_TYPE = "os-products-box";
/** Setas do carrossel. */
export const PRODUCTS_NAV_TYPE = "os-products-nav";
export const PRODUCT_NAME_TYPE = "os-product-name";
export const PRODUCT_IMG_TYPE = "os-product-img";

/**
 * Aviso do canvas no alto da vitrine ("8 produtos ainda sem página…"): posto
 * só no elemento desenhado (src/editor/widgets/products.ts), nunca no HTML
 * salvo; o texto aparece pelo WIDGET_CANVAS_CSS (src/editor/widgets/canvas.ts).
 */
export const PRODUCTS_WARN_ATTR = "data-os-cv-aviso";
/**
 * Cartão que não leva a lugar nenhum (o canvas o contorna): também só no
 * elemento desenhado — a regra depende dos links da oferta (link sem endereço
 * não conta), que o CSS não enxerga.
 */
export const PRODUCT_NO_DEST_ATTR = "data-os-cv-sem";

export type ProductsLayout = "grid" | "carousel";
export type ProductCardModel = "classic" | "compact" | "highlight";

export const PRODUCT_CARD_LABEL: Record<ProductCardModel, string> = {
  classic: "Clássico (preço grande)",
  compact: "Compacto (faixa de ofertas)",
  highlight: "Destaque (cartão largo)",
};

/** Partes que dá para mostrar/ocultar (data-os-show-<parte>). */
export const PRODUCTS_SHOW = [
  ["title", "Título da seção"],
  ["more", "Link “Ver todas”"],
  ["badge", "Selo"],
  ["rating", "Avaliação (estrelas)"],
  ["off", "% OFF"],
  ["old", "Preço antigo"],
  ["inst", "Parcelas"],
  ["ship", "Frete"],
  ["sold", "Vendidos"],
  ["stock", "Estoque"],
] as const;
export type ProductsShowKey = (typeof PRODUCTS_SHOW)[number][0];
/** Ligado por padrão (sem o atributo)? Só o "Ver todas" nasce desligado. */
export const showDefault = (key: ProductsShowKey) => key !== "more";

/** Variável de cada cor (a mesma no CSS e nas Configurações). */
export const PRODUCTS_VARS = {
  bg: "--os-pd-bg",
  card: "--os-pd-card",
  ink: "--os-pd-ink",
  price: "--os-pd-price",
  off: "--os-pd-off",
  ship: "--os-pd-ship",
  badge: "--os-pd-badge",
  title: "--os-pd-title",
  more: "--os-pd-more",
} as const;
export type ProductsColor = keyof typeof PRODUCTS_VARS;

/**
 * Cores padrão (as mesmas do CSS abaixo); o modelo compacto troca o % OFF e o
 * selo. Verde, azul e cinzas escuros o bastante para ler em letra pequena
 * (contraste de 4,5:1 no fundo branco).
 */
const BASE_THEME: Record<ProductsColor, string> = {
  bg: "",
  card: "#ffffff",
  ink: "#333333",
  price: "#333333",
  off: "#00863f",
  ship: "#00863f",
  badge: "#1f63d6",
  title: "#1f2937",
  more: "#1f63d6",
};
const MODEL_THEME: Record<ProductCardModel, Partial<Record<ProductsColor, string>>> = {
  classic: {},
  compact: { off: "#cc1f3b", badge: "#cc1f3b" },
  highlight: {},
};

/** Cor padrão de um modelo de cartão ("" = sem cor: fundo da seção transparente). */
export function productsThemeColor(model: string, color: ProductsColor): string {
  return MODEL_THEME[model as ProductCardModel]?.[color] ?? BASE_THEME[color];
}

const V = PRODUCTS_VARS;
const P = ".os-products";
const COLS = [1, 2, 3, 4, 5, 6];
/** Espaço entre os cartões (computador / celular). */
const GAP = 16;
const GAP_M = 10;
/** Tamanho das setas do carrossel. */
const NAV = 44;
/** Altura da foto do cartão "Destaque" (45% da largura dele). */
const HIGHLIGHT_PHOTO = 0.45;
/**
 * margin-top da seta para ela ficar no meio da foto dos cartões, com `n`
 * cartões por linha (foto com `photo` × a largura do cartão de altura). Os
 * cartões começam 4 px abaixo do topo da área das setas: a margem negativa
 * da trilha (-4 px, ver o carrossel) se junta à da área, e o padding fica.
 */
function navTop(n: number, photo = 1) {
  return `calc((100% - ${(n - 1) * GAP}px) * ${+(photo / 2 / n).toFixed(5)} - ${NAV / 2 - 4}px)`;
}
/**
 * Vitrine de 1 coluna na grade do celular ("Oferta do dia"): a foto do cartão
 * fica centralizada com no máximo este tamanho (senão ocupa a tela inteira).
 */
const ONE_COL = `${P}[data-os-cols-m="1"]:not([data-os-layout=carousel]):not([data-os-card=highlight])`;
const ONE_COL_PHOTO = 260;
/** Cinza dos textos menores (vendidos, preço antigo). */
const MUTED = "#767676";
/**
 * Contorno do foco do teclado em duas cores (anel branco + contorno escuro):
 * aparece em qualquer fundo, inclusive no azul da "Faixa de ofertas".
 */
const FOCUS =
  "outline-width:3px;outline-style:solid;outline-color:#111827;outline-offset:2px;box-shadow:0 0 0 2px #fff";
/** Esconde só da vista (leitores de tela leem). */
export const SR_ONLY =
  "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0";

/**
 * Estrelas da avaliação (camada cinza + camada colorida com a largura da nota,
 * src/lib/store.ts): no cartão da vitrine e na caixa de compra (`scope`).
 */
export function starsCss(scope: string, size: number): string[] {
  const five = '"\\2605\\2605\\2605\\2605\\2605"';
  return [
    `${scope} .os-pd-stars{position:relative;display:inline-block;margin-right:5px;font-size:${size}px;letter-spacing:1px;line-height:1;white-space:nowrap}`,
    `${scope} .os-pd-stars::before{content:${five};color:#d6d6d6}`,
    `${scope} .os-pd-stars-on{position:absolute;top:0;left:0;overflow:hidden;white-space:nowrap;color:#f5a623}`,
    `${scope} .os-pd-stars-on::before{content:${five}}`,
    `${scope} .os-pd-count{margin-left:3px}`,
  ];
}

/**
 * Partes escondidas por data-os-show-<parte>="0" (o "Ver todas" liga com "1");
 * o preço antigo e o % OFF saem também da frase dos leitores de tela.
 */
const HIDE_RULES = [
  ...PRODUCTS_SHOW.filter(([key]) => key !== "more").map(([key]) => `${P}[data-os-show-${key}="0"] .os-pd-${key}`),
  `${P}[data-os-show-old="0"] .os-pd-sr-old`,
  `${P}[data-os-show-off="0"] .os-pd-sr-off`,
  `${P}:not([data-os-show-more="1"]) .os-pd-more`,
  `${P}[data-os-show-title="0"]:not([data-os-show-more="1"]) .os-pd-head`,
];

/** Parte vazia (sem o dado) não ocupa lugar. */
const EMPTY_RULES = ["badge", "rating", "price", "ship", "sold", "stock"].map((p) => `${P} .os-pd-${p}:empty`);

/**
 * CSS da página (vira regras editáveis do projeto, como o do quiz e o da
 * roleta). Com var(), só propriedades simples (o GrapesJS perde atalhos como
 * border/background com var()); um só :hover por @media; sem !important.
 * Pensado também para o Safari 13: carrossel com margem entre os cartões (gap
 * de flex não existe lá — e o gap da grade é zerado no carrossel, senão os
 * navegadores novos somam os dois), foto quadrada com padding-top (sem
 * aspect-ratio).
 * As regras de ocultar e de parte vazia vêm por último (mesma especificidade
 * das regras dos modelos de cartão: a última vence).
 */
export const PRODUCTS_CSS = [
  `${P}{${V.bg}:transparent;${V.card}:${BASE_THEME.card};${V.ink}:${BASE_THEME.ink};${V.price}:${BASE_THEME.price};${V.off}:${BASE_THEME.off};${V.ship}:${BASE_THEME.ship};${V.badge}:${BASE_THEME.badge};${V.title}:${BASE_THEME.title};${V.more}:${BASE_THEME.more};position:relative;box-sizing:border-box;width:100%;max-width:1200px;margin:24px auto;padding:20px 16px;border-radius:8px;background-color:var(${V.bg});color:var(${V.ink});font-family:inherit;font-size:16px;line-height:1.35;text-align:left}`,
  `${P}[data-os-card=compact]{${V.off}:${MODEL_THEME.compact.off};${V.badge}:${MODEL_THEME.compact.badge}}`,
  `${P} *,${P} *::before,${P} *::after{box-sizing:border-box}`,
  // Título e "Ver todas"
  `${P} .os-pd-head{display:flex;flex-wrap:wrap;align-items:baseline;margin:0 0 14px}`,
  `${P} .os-pd-title{margin:0 18px 0 0;color:var(${V.title});font-family:inherit;font-size:24px;font-weight:600;line-height:1.25;letter-spacing:normal;text-transform:none}`,
  `${P} .os-pd-more{color:var(${V.more});font-size:15px;font-weight:600;line-height:1.3;text-decoration:none}`,
  // Trilha: grade (padrão) ou carrossel
  `${P} .os-pd-wrap{position:relative}`,
  `${P} .os-pd-track{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:${GAP}px;margin:0;padding:0}`,
  ...COLS.map((n) => `${P}[data-os-cols="${n}"] .os-pd-track{grid-template-columns:repeat(${n},minmax(0,1fr))}`),
  // scroll-padding = o padding da trilha: o primeiro cartão encaixa com a trilha no começo
  // (sem ele o encaixe para 4 px adiante e a seta "Anterior" aparece logo ao abrir).
  // Carrossel: a seta que fica metade para fora da trilha nunca cria rolagem lateral na
  // página (nem na faixa de ponta a ponta); no computador, espaço dos lados para ela caber.
  // (Com overflow escondido, um item de flex não tem mais a altura mínima do conteúdo: na
  // "Oferta do dia + ofertas" empilhada do celular, as vitrines ficam com flex:0 0 auto.)
  `${P}[data-os-layout=carousel]{overflow:hidden}`,
  `@media (min-width:769px){${P}[data-os-layout=carousel]{padding-left:${NAV / 2 + 2}px;padding-right:${NAV / 2 + 2}px}}`,
  `${P}[data-os-layout=carousel] .os-pd-track{display:flex;gap:0;margin:-4px -4px 0;padding:4px 4px 8px;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scroll-padding-left:4px;scroll-padding-right:4px;-webkit-overflow-scrolling:touch;scrollbar-width:none}`,
  `${P}[data-os-layout=carousel] .os-pd-track::-webkit-scrollbar{display:none}`,
  `${P}[data-os-layout=carousel] .os-pd-card{flex:0 0 auto;width:calc((100% - ${3 * GAP}px) / 4);margin-right:${GAP}px;scroll-snap-align:start}`,
  ...COLS.map(
    (n) =>
      `${P}[data-os-layout=carousel][data-os-cols="${n}"] .os-pd-card{width:calc((100% - ${(n - 1) * GAP}px) / ${n})}`,
  ),
  `${P}[data-os-layout=carousel] .os-pd-card:last-child{margin-right:0}`,
  // Setas do carrossel (o script da página liga a classe os-pd-js; só no computador): na
  // borda da trilha (metade para fora, como nos marketplaces) e na altura da foto — nunca
  // em cima do nome ou do preço. A altura vem do margin-top em %, que é da LARGURA da
  // trilha: dá o meio da foto do cartão (quadrada; no "Destaque", 45% da largura).
  `${P} .os-pd-nav{display:none;position:absolute;top:0;z-index:2;align-items:center;justify-content:center;width:${NAV}px;height:${NAV}px;margin:0;margin-top:${navTop(4)};padding:0;border:0;border-radius:50%;background-color:#fff;color:#1f63d6;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.22)}`,
  `${P} .os-pd-prev{left:-${NAV / 2}px}`,
  `${P} .os-pd-next{right:-${NAV / 2}px}`,
  ...COLS.map((n) => `${P}[data-os-cols="${n}"] .os-pd-nav{margin-top:${navTop(n)}}`),
  `${P}[data-os-card=highlight] .os-pd-nav{margin-top:${navTop(4, HIGHLIGHT_PHOTO)}}`,
  ...COLS.map(
    (n) => `${P}[data-os-card=highlight][data-os-cols="${n}"] .os-pd-nav{margin-top:${navTop(n, HIGHLIGHT_PHOTO)}}`,
  ),
  `${P} .os-pd-nav::before{content:"";display:block;width:10px;height:10px;border-top:2px solid currentColor;border-right:2px solid currentColor}`,
  `${P} .os-pd-prev::before{margin-left:5px;transform:rotate(-135deg)}`,
  `${P} .os-pd-next::before{margin-right:5px;transform:rotate(45deg)}`,
  `${P} .os-pd-nav:disabled{opacity:0;pointer-events:none}`,
  `${P} .os-pd-nav:focus-visible,${P} .os-pd-card:focus-visible,${P} .os-pd-more:focus-visible{${FOCUS}}`,
  `${P} .os-pd-sr{${SR_ONLY}}`,
  `@media (min-width:769px){${P}.os-pd-js[data-os-layout=carousel] .os-pd-nav{display:flex}}`,
  // Cartão (modelo clássico; os outros mudam por cima)
  `${P} .os-pd-card{position:relative;display:flex;flex-direction:column;min-width:0;margin:0;padding:0;overflow:hidden;border-radius:6px;background-color:var(${V.card});color:var(${V.ink});font-family:inherit;text-align:left;text-decoration:none;box-shadow:0 1px 3px rgba(0,0,0,.12);transition:box-shadow .15s ease}`,
  `@media (hover:hover){${P} .os-pd-card:hover{box-shadow:0 6px 18px rgba(0,0,0,.16)}}`,
  `${P} .os-pd-media{position:relative;width:100%;height:0;margin:0;padding:100% 0 0;overflow:hidden;background-color:#fff}`,
  `${P} .os-pd-img{position:absolute;top:0;left:0;display:block;width:100%;height:100%;max-width:none;margin:0;padding:12px;border:0;border-radius:0;object-fit:contain}`,
  `${P} .os-pd-body{display:flex;flex:1 1 auto;flex-direction:column;align-items:flex-start;min-width:0;padding:12px 14px 16px}`,
  `${P} .os-pd-body>*{max-width:100%;margin:0}`,
  `${P} .os-pd-badge{order:1;display:inline-block;margin:0 0 6px;padding:3px 7px;border-radius:4px;background-color:var(${V.badge});color:#fff;font-size:11px;font-weight:700;line-height:1.3;letter-spacing:.02em;text-transform:uppercase}`,
  `${P} .os-pd-name{order:2;align-self:stretch;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;margin:0 0 6px;color:inherit;font-family:inherit;font-size:15px;font-weight:400;line-height:1.35;letter-spacing:normal;text-transform:none}`,
  // Cartão estreito: a contagem "(12.873)" desce para a linha de baixo (nunca sai cortada).
  `${P} .os-pd-rating{order:3;display:flex;flex-wrap:wrap;align-items:center;margin:0 0 6px;color:#666;font-size:13px;line-height:1.3}`,
  ...starsCss(P, 13),
  `${P} .os-pd-price{order:4;align-self:stretch;display:flex;flex-wrap:wrap;align-items:baseline;color:var(${V.price})}`,
  `${P} .os-pd-off{order:1;margin:0 6px 2px 0;padding:1px 4px;border-radius:3px;background-color:var(${V.off});color:#fff;font-size:12px;font-weight:700;line-height:1.35}`,
  `${P} .os-pd-old{order:2;margin:0 0 2px;color:${MUTED};font-size:13px;line-height:1.35;text-decoration:line-through}`,
  // Sem nowrap: num cartão estreito o número desce para baixo do "R$" (os centavos ficam
  // grudados no número), em vez de sair cortado.
  `${P} .os-pd-now{order:3;flex:0 0 100%;color:var(${V.price});font-size:26px;font-weight:400;line-height:1.15}`,
  `${P} .os-pd-int{white-space:nowrap}`,
  // Centavos pequenos em cima ("R$ 179⁸⁰"); a vírgula fica só para leitores de tela.
  `${P}:not([data-os-card=highlight]) .os-pd-dec{${SR_ONLY}}`,
  `${P}:not([data-os-card=highlight]) .os-pd-cents{position:relative;top:-.8em;margin-left:2px;font-size:45%;line-height:0;vertical-align:baseline}`,
  `${P} .os-pd-inst{order:4;flex:0 0 100%;margin-top:2px;color:inherit;font-size:14px;line-height:1.35}`,
  `${P} .os-pd-free{color:var(${V.ship})}`,
  `${P} .os-pd-ship{order:5;margin:6px 0 0;color:var(${V.ship});font-size:14px;font-weight:600;line-height:1.35}`,
  `${P} .os-pd-sold{order:6;margin:4px 0 0;color:${MUTED};font-size:13px;line-height:1.35}`,
  `${P} .os-pd-stock{order:7;margin:6px 0 0;font-size:13px;line-height:1.35}`,
  `${P} .os-pd-stk{display:inline-block;padding:2px 6px;border-radius:4px;background-color:#e6f6ec;color:#11713b}`,
  `${P} .os-pd-low{background-color:#fdeaea;color:#c62828}`,
  // Compacto (faixa de ofertas): nome numa linha, [% OFF][selo em texto], preço + antigo ao lado
  `${P}[data-os-card=compact] .os-pd-card{border-radius:8px;box-shadow:none}`,
  `${P}[data-os-card=compact] .os-pd-media{background-color:#f5f5f5}`,
  `${P}[data-os-card=compact] .os-pd-body{flex-direction:row;flex-wrap:wrap;align-items:center;align-content:flex-start;padding:8px 10px 12px}`,
  `${P}[data-os-card=compact] .os-pd-body>*{flex:0 0 100%}`,
  `${P}[data-os-card=compact] .os-pd-name{order:1;display:block;margin:0 0 6px;overflow:hidden;font-size:15px;white-space:nowrap;text-overflow:ellipsis}`,
  `${P}[data-os-card=compact] .os-pd-price{display:contents}`,
  `${P}[data-os-card=compact] .os-pd-off{order:2;margin:0 8px 0 0;padding:4px 6px;font-size:13px;font-weight:600;text-transform:lowercase}`,
  // Selo ao lado do % OFF; sem espaço (cartão estreito), desce para a linha inteira de baixo.
  `${P}[data-os-card=compact] .os-pd-badge{order:3;flex:1 1 72px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;min-width:0;margin:0;padding:0;overflow:hidden;border-radius:0;background-color:transparent;color:var(${V.badge});font-size:12px;font-weight:700;line-height:1.2;letter-spacing:normal;text-transform:none;overflow-wrap:anywhere;word-break:break-word}`,
  // Quebra de linha depois do selo: o preço começa na linha de baixo.
  `${P}[data-os-card=compact] .os-pd-body::after{content:"";order:4;flex:0 0 100%;height:0}`,
  `${P}[data-os-card=compact] .os-pd-now{order:5;flex:0 0 auto;margin-top:6px;font-size:22px}`,
  `${P}[data-os-card=compact] .os-pd-sym{position:relative;top:-.45em;font-size:55%}`,
  `${P}[data-os-card=compact] .os-pd-old{order:6;margin:6px 0 0 6px}`,
  `${P}[data-os-card=compact] .os-pd-inst{order:7}`,
  `${P}[data-os-card=compact] .os-pd-rating{order:8;margin:6px 0 0}`,
  `${P}[data-os-card=compact] .os-pd-ship{order:9}`,
  `${P}[data-os-card=compact] .os-pd-sold{order:10}`,
  `${P}[data-os-card=compact] .os-pd-stock{order:11}`,
  // Destaque (cartão largo): selo em pílula, antigo riscado, preço + % OFF ao lado, nome por último
  `${P}[data-os-card=highlight] .os-pd-card{border-radius:10px;box-shadow:0 1px 6px rgba(0,0,0,.1)}`,
  `${P}[data-os-card=highlight] .os-pd-media{padding-top:${HIGHLIGHT_PHOTO * 100}%}`,
  `${P}[data-os-card=highlight] .os-pd-img{padding:16px}`,
  `${P}[data-os-card=highlight] .os-pd-body{padding:12px 18px 18px}`,
  `${P}[data-os-card=highlight] .os-pd-badge{margin:0 0 10px;padding:4px 10px;border-radius:5px;font-size:13px;font-weight:600}`,
  `${P}[data-os-card=highlight] .os-pd-price{order:2}`,
  `${P}[data-os-card=highlight] .os-pd-old{order:1;flex:0 0 100%;font-size:14px}`,
  `${P}[data-os-card=highlight] .os-pd-now{order:2;flex:0 0 auto;font-size:26px;font-weight:600}`,
  `${P}[data-os-card=highlight] .os-pd-cents{font-size:inherit;line-height:inherit;vertical-align:baseline}`,
  `${P}[data-os-card=highlight] .os-pd-off{order:3;margin:0 0 0 10px;padding:0;background-color:transparent;color:var(${V.off});font-size:16px;font-weight:500}`,
  `${P}[data-os-card=highlight] .os-pd-rating{order:3;margin:6px 0 0}`,
  `${P}[data-os-card=highlight] .os-pd-ship{order:4}`,
  `${P}[data-os-card=highlight] .os-pd-stock{order:5;margin:8px 0 0}`,
  `${P}[data-os-card=highlight] .os-pd-sold{order:6}`,
  `${P}[data-os-card=highlight] .os-pd-name{order:7;margin:10px 0 0;font-size:16px}`,
  // "Oferta do dia + ofertas": duas vitrines lado a lado (empilham no celular)
  ".os-pd-row{display:flex;align-items:stretch;box-sizing:border-box;width:100%;max-width:1200px;margin:0 auto;padding:0}",
  `.os-pd-row>${P}{flex:1 1 0;min-width:0;margin:0}`,
  `.os-pd-row>${P}:first-child{flex:0 0 32%;margin-right:16px}`,
  // Tablet: no máximo 4 por linha (3 no carrossel ao lado da "Oferta do dia": cartões largos o bastante)
  `@media (min-width:769px) and (max-width:1024px){${P}[data-os-cols="5"] .os-pd-track,${P}[data-os-cols="6"] .os-pd-track{grid-template-columns:repeat(4,minmax(0,1fr))}${P}[data-os-layout=carousel][data-os-cols="5"] .os-pd-card,${P}[data-os-layout=carousel][data-os-cols="6"] .os-pd-card{width:calc((100% - ${3 * GAP}px) / 4)}${P} .os-pd-now{font-size:24px}.os-pd-row>${P}[data-os-layout=carousel] .os-pd-card{width:calc((100% - ${2 * GAP}px) / 3)}${P}[data-os-cols="5"] .os-pd-nav,${P}[data-os-cols="6"] .os-pd-nav{margin-top:${navTop(4)}}${P}[data-os-card=highlight][data-os-cols="5"] .os-pd-nav,${P}[data-os-card=highlight][data-os-cols="6"] .os-pd-nav{margin-top:${navTop(4, HIGHLIGHT_PHOTO)}}.os-pd-row>${P}[data-os-layout=carousel] .os-pd-nav{margin-top:${navTop(3)}}}`,
  // Celular: colunas do celular; carrossel com ~2,3 cartões à vista
  `@media (max-width:768px){${P}{margin:16px auto;padding:16px 12px;border-radius:0}${P} .os-pd-title{font-size:20px}${P} .os-pd-track,${P}[data-os-cols] .os-pd-track{grid-template-columns:repeat(2,minmax(0,1fr));gap:${GAP_M}px}${P}[data-os-cols][data-os-cols-m="1"] .os-pd-track,${P}[data-os-cols-m="1"] .os-pd-track{grid-template-columns:minmax(0,1fr)}${P}[data-os-layout=carousel] .os-pd-track,${P}[data-os-layout=carousel][data-os-cols] .os-pd-track{gap:0}${P}[data-os-layout=carousel] .os-pd-card,${P}[data-os-layout=carousel][data-os-cols] .os-pd-card{width:calc((100% - ${2 * GAP_M}px) / 2.3);margin-right:${GAP_M}px}${P}[data-os-layout=carousel] .os-pd-card:last-child{margin-right:0}${P} .os-pd-body{padding:10px 10px 12px}${P} .os-pd-name{font-size:14px}${P} .os-pd-now,${P}[data-os-card=highlight] .os-pd-now{font-size:22px}.os-pd-row{flex-direction:column}.os-pd-row>${P}{flex:0 0 auto}.os-pd-row>${P}:first-child{margin:0 0 12px}${ONE_COL} .os-pd-media{max-width:${ONE_COL_PHOTO}px;height:auto;margin:0 auto;padding:0}${ONE_COL} .os-pd-media::before{content:"";display:block;padding-top:100%}}`,
  // Por último: parte desligada e parte vazia não aparecem.
  `${HIDE_RULES.join(",")}{display:none}`,
  `${EMPTY_RULES.join(",")}{display:none}`,
].join("");

// ─── Definições ──────────────────────────────────────────────────────────────

export interface ProductSpec {
  name: string;
  data: Partial<ProductData>;
  /** Foto (padrão: foto provisória). */
  image?: string;
  /** Destino (padrão "#": ainda sem a página do produto). */
  href?: string;
}

export interface ProductsSpec {
  /** Nome nas camadas (padrão "Vitrine de produtos"). */
  name?: string;
  title: string;
  layout: ProductsLayout;
  /** Produtos por linha no computador (1 a 6). */
  cols: number;
  /** Produtos por linha no celular, na grade (1 ou 2). */
  colsM: number;
  card: ProductCardModel;
  currency?: StoreCurrency;
  products: ProductSpec[];
  /** Idioma das frases geradas (padrão: o da moeda). */
  lang?: StoreLang;
  /** Texto do "Ver todas". */
  more?: string;
  /** Mostrar/ocultar (o que faltar fica no padrão: tudo ligado, "Ver todas" desligado). */
  show?: Partial<Record<ProductsShowKey, boolean>>;
  /** Estilo próprio da vitrine (cores em variáveis, largura…). */
  style?: Style;
  /** Estilo próprio do título. */
  titleStyle?: Style;
}

/** Foto provisória dos produtos de exemplo. */
export const productPlaceholder = () => placeholderImage("Foto do produto", 600, 600);

/** Parte gerada (selo, avaliação, preço…): a mesma no cartão e na caixa de compra. */
export const partDef = (part: ProductPart, tagName: string, html?: string): Def => ({
  type: PRODUCT_PART_TYPE,
  tagName,
  name: "Dados do produto",
  classes: [`os-pd-${part}`],
  attributes: { [PART_ATTR]: part },
  ...(html !== undefined && { content: html }),
});

/**
 * Um cartão de produto. `html` (modelo de página montado no servidor): as
 * partes já desenhadas; no editor elas são refeitas a partir dos atributos.
 */
export function productCardDef(
  spec: ProductSpec,
  {
    html = false,
    currency = DEFAULT_CURRENCY,
    lang = storeLang("", currency),
  }: { html?: boolean; currency?: StoreCurrency; lang?: StoreLang } = {},
): Def {
  const attrs = productAttrs(spec.data);
  const data = readProduct(attrs);
  const part = (p: ProductPart, tag: string) =>
    partDef(p, tag, html ? productPartHtml(p, data, currency, lang) : undefined);
  return {
    type: PRODUCT_TYPE,
    tagName: "a",
    name: "Produto",
    classes: ["os-pd-card"],
    attributes: { href: spec.href ?? "#", [PRODUCT_ATTR]: "", ...attrs },
    components: [
      {
        type: PRODUCTS_BOX_TYPE,
        tagName: "div",
        name: "Foto",
        classes: ["os-pd-media"],
        components: [
          {
            type: PRODUCT_IMG_TYPE,
            tagName: "img",
            name: "Foto do produto",
            classes: ["os-pd-img"],
            // alt vazio: o nome do produto já está no h3 do mesmo link (leitores de tela não o leem duas vezes).
            attributes: { src: spec.image ?? productPlaceholder(), alt: "", loading: "lazy" },
          },
        ],
      },
      {
        type: PRODUCTS_BOX_TYPE,
        tagName: "div",
        name: "Dados",
        classes: ["os-pd-body"],
        components: [
          part("badge", "p"),
          {
            type: PRODUCT_NAME_TYPE,
            tagName: "h3",
            name: "Nome do produto",
            classes: ["os-pd-name"],
            content: esc(spec.name),
          },
          part("rating", "div"),
          part("price", "div"),
          part("ship", "p"),
          part("sold", "p"),
          part("stock", "p"),
        ],
      },
    ],
  };
}

export const esc = (s: string) => s.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Nome das setas para leitores de tela (no idioma da vitrine; gerado, como as partes do cartão). */
export const navLabelHtml = (dir: "prev" | "next", lang: StoreLang) =>
  `<span class="os-pd-sr">${esc(STORE_TEXTS[lang][dir])}</span>`;

const navDef = (dir: "prev" | "next", lang: StoreLang, html: boolean): Def => ({
  type: PRODUCTS_NAV_TYPE,
  tagName: "button",
  name: dir === "prev" ? "Anterior" : "Próximo",
  classes: ["os-pd-nav", `os-pd-${dir}`],
  attributes: { type: "button" },
  ...(html && { content: navLabelHtml(dir, lang) }),
});

/**
 * A vitrine inteira. `html`: para o HTML de um modelo de página (partes já
 * desenhadas; a moeda vem do servidor, a da oferta). Num bloco sem moeda
 * escolhida, a vitrine nasce na moeda da oferta (PROP_OFFER_CURRENCY,
 * src/editor/widgets/hooks.ts).
 */
export function productsDef(spec: ProductsSpec, { html = false } = {}): Def {
  const currency = spec.currency ?? DEFAULT_CURRENCY;
  const lang = storeLang(spec.lang, currency);
  const show: Record<string, string> = {};
  for (const [key] of PRODUCTS_SHOW) {
    const on = spec.show?.[key] ?? showDefault(key);
    if (key === "more") show["data-os-show-more"] = on ? "1" : "0";
    else if (!on) show[`data-os-show-${key}`] = "0";
  }
  return {
    type: PRODUCTS_TYPE,
    tagName: "section",
    name: spec.name ?? "Vitrine de produtos",
    classes: ["os-products"],
    attributes: {
      "data-os-widget": "products",
      "data-os-layout": spec.layout,
      "data-os-cols": String(spec.cols),
      "data-os-cols-m": String(spec.colsM),
      "data-os-card": spec.card,
      [CURRENCY_ATTR]: currency,
      ...(spec.lang && { [LANG_ATTR]: spec.lang }),
      ...show,
    },
    ...(spec.style && { style: spec.style }),
    ...(!html && !spec.currency && { [PROP_OFFER_CURRENCY]: true }),
    components: [
      {
        tagName: "div",
        name: "Título da vitrine",
        classes: ["os-pd-head"],
        components: [
          {
            type: "text",
            tagName: "h2",
            name: "Título",
            classes: ["os-pd-title"],
            content: esc(spec.title),
            ...(spec.titleStyle && { style: spec.titleStyle }),
          },
          {
            type: "link",
            tagName: "a",
            name: "Ver todas",
            classes: ["os-pd-more"],
            attributes: { href: "#" },
            content: esc(spec.more ?? "Ver todas"),
          },
        ],
      },
      {
        type: PRODUCTS_BOX_TYPE,
        tagName: "div",
        name: "Produtos",
        classes: ["os-pd-wrap"],
        components: [
          {
            type: PRODUCTS_TRACK_TYPE,
            tagName: "div",
            name: "Produtos",
            classes: ["os-pd-track"],
            attributes: { "data-os-pd-track": "" },
            components: spec.products.map((p) => productCardDef(p, { html, currency, lang })),
          },
          navDef("prev", lang, html),
          navDef("next", lang, html),
        ],
      },
    ],
  };
}

// ─── Exemplos ────────────────────────────────────────────────────────────────

/** Produtos de exemplo (nomes genéricos, sem marca; ainda sem a página do produto). */
export const EXAMPLE_PRODUCTS: ProductSpec[] = [
  {
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
  },
  {
    name: "Smartwatch com monitor cardíaco",
    data: {
      price: 17980,
      old: 42551,
      inst: 12,
      instValue: 1777,
      ship: "Chegará grátis amanhã",
      sold: "+500 vendidos",
      rating: 4.5,
      reviews: 812,
    },
  },
  {
    name: "Caixa de som portátil à prova d'água",
    data: {
      price: 29990,
      old: 49748,
      inst: 10,
      ship: "Frete grátis",
      sold: "+1000 vendidos",
      rating: 4.8,
      reviews: 5120,
    },
  },
  {
    name: "Air fryer 4 litros",
    data: {
      price: 34900,
      old: 59900,
      inst: 12,
      ship: "Frete grátis",
      sold: "+10mil vendidos",
      rating: 4.9,
      reviews: 12873,
    },
  },
  {
    name: "Kit 3 panelas antiaderentes",
    data: {
      price: 15990,
      old: 22990,
      inst: 6,
      ship: "Frete grátis",
      sold: "+2mil vendidos",
      rating: 4.6,
      reviews: 977,
    },
  },
  {
    name: "Tênis de corrida leve",
    data: {
      price: 19999,
      old: 29999,
      inst: 5,
      ship: "Chegará grátis amanhã",
      sold: "+500 vendidos",
      rating: 4.4,
      reviews: 356,
    },
  },
  {
    name: "Mochila para notebook",
    data: {
      price: 8990,
      old: 12990,
      inst: 3,
      ship: "Frete grátis",
      sold: "+1000 vendidos",
      rating: 4.7,
      reviews: 1420,
    },
  },
  {
    name: "Luminária LED de mesa",
    data: {
      price: 6376,
      old: 10990,
      inst: 4,
      ship: "Frete grátis",
      sold: "+10mil vendidos",
      rating: 4.8,
      reviews: 3015,
    },
  },
];

/** Cartão novo do "＋ Adicionar produto" (dados de exemplo, sem destino). */
export const NEW_PRODUCT: ProductSpec = {
  name: "Novo produto",
  data: { price: 9990, old: 14990, inst: 10, ship: "Frete grátis" },
};
