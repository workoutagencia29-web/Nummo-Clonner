/**
 * Categoria "Loja": o cabeçalho de loja (logo, pesquisa, carrinho, categorias —
 * cada parte liga/desliga; src/editor/widgets/store-header.ts) e vitrines de
 * produtos no estilo de marketplace (grade, carrossel, faixa de ofertas, oferta
 * do dia, lista de ofertas). Cada cartão leva à página do produto, escolhida
 * nas Configurações do cartão; os produtos de exemplo nascem sem destino (o
 * canvas, o ZIP e o "Próximos passos" avisam). Formato, colunas, modelo do
 * cartão, moeda, o que mostrar e as cores ficam nas Configurações da vitrine
 * (src/editor/widgets/products.ts). A busca, as setas do carrossel e o
 * cabeçalho fixo rodam só na página (src/runtime/widgets/store.ts).
 *
 * Página do produto: a galeria de fotos e a caixa de compra (mesmos campos e
 * partes do cartão da vitrine; src/editor/widgets/product-page.ts). Trocar a
 * foto e a barra de compra do celular rodam só na página (src/runtime/product).
 *
 * Vitrines e caixa de compra soltas na página nascem na moeda da oferta
 * (PROP_OFFER_CURRENCY; src/lib/offer-currency.ts).
 */

import { bannerDef, DEFAULT_BANNER } from "@/editor/widgets/banner-content";
import { EXAMPLE_BUY, galleryDef, galleryPlaceholders, productBuyDef } from "@/editor/widgets/product-page-content";
import {
  EXAMPLE_PRODUCTS,
  PRODUCTS_ROW_TYPE,
  type ProductSpec,
  type ProductsSpec,
  productsDef,
} from "@/editor/widgets/products-content";
import { storeHeaderDef } from "@/editor/widgets/store-header-content";
import type { StoreCurrency } from "@/lib/store";
import { type Def, el, icon, type OsBlock } from "./shared";

const products = (n: number, patch: (p: ProductSpec, i: number) => ProductSpec = (p) => p): ProductSpec[] =>
  Array.from({ length: n }, (_, i) => patch(EXAMPLE_PRODUCTS[i % EXAMPLE_PRODUCTS.length], i));

const showcase = (spec: ProductsSpec): Def => productsDef(spec);

/** "Faixa de ofertas": selo em texto vermelho ao lado do % OFF. */
const FLASH_BADGES = ["Oferta relâmpago", "Mais vendido", "Oferta relâmpago", "Preço baixo"];
/** "Lista de ofertas do dia": estoque em cada produto. */
const STOCKS = [19, 10, 4, 18];

/**
 * Vitrines dos blocos, também usadas pelo modelo "Loja (vitrine)"
 * (src/editor/templates/store.ts): o mesmo conteúdo nos dois lugares.
 */
export const SHOWCASES = {
  grid: {
    name: "Grade de produtos",
    title: "Mais vendidos",
    layout: "grid",
    cols: 4,
    colsM: 2,
    card: "classic",
    products: products(8, (p, i) => (i === 0 ? { ...p, data: { ...p.data, badge: "Mais vendido" } } : p)),
  },
  carousel: {
    name: "Carrossel de produtos",
    title: "Ofertas",
    layout: "carousel",
    cols: 5,
    colsM: 2,
    card: "classic",
    more: "Ver todas",
    show: { more: true },
    products: products(8),
  },
  band: {
    name: "Faixa de ofertas",
    title: "Ofertas mais amadas da semana",
    layout: "carousel",
    cols: 6,
    colsM: 2,
    card: "compact",
    products: products(8, (p, i) => ({
      ...p,
      data: { ...p.data, badge: FLASH_BADGES[i % FLASH_BADGES.length], inst: 0, ship: "", sold: "", rating: null },
    })),
    style: {
      "--os-pd-bg": "#1462d6",
      "--os-pd-title": "#ffffff",
      "--os-pd-more": "#ffffff",
      "max-width": "none",
      margin: "0",
      "border-radius": "0",
      // Dos lados, espaço para as setas do carrossel (metade para fora da trilha).
      padding: "16px 24px 22px",
    },
  },
  dayDeal: {
    name: "Oferta do dia",
    title: "Oferta do dia",
    layout: "grid",
    cols: 1,
    colsM: 1,
    card: "classic",
    products: [EXAMPLE_PRODUCTS[7]],
    style: { "--os-pd-bg": "#ffffff" },
  },
  dayOffers: {
    name: "Ofertas",
    title: "Ofertas",
    layout: "carousel",
    cols: 4,
    colsM: 2,
    card: "classic",
    more: "Mostrar todas as ofertas",
    show: { more: true },
    products: products(7),
    style: { "--os-pd-bg": "#ffffff" },
  },
  dayList: {
    name: "Lista de ofertas do dia",
    title: "Ofertas do dia",
    layout: "grid",
    cols: 2,
    colsM: 1,
    card: "highlight",
    products: products(4, (p, i) => ({
      ...p,
      data: { ...p.data, badge: "OFERTA DO DIA", stock: STOCKS[i], inst: 0, sold: "", rating: null },
    })),
  },
} satisfies Record<string, ProductsSpec>;

/**
 * Linha "Oferta do dia + ofertas" (só vitrines entram nela). `html`: para um
 * modelo de página, na moeda `currency` (a da oferta); no bloco, as vitrines
 * nascem na moeda da oferta pelo editor.
 */
export function dayDealRow({ html = false, currency }: { html?: boolean; currency?: StoreCurrency } = {}): Def {
  return {
    // Só vitrines entram na linha (clicar num bloco com algo dela selecionado põe o bloco depois dela).
    type: PRODUCTS_ROW_TYPE,
    tagName: "div",
    name: "Vitrines lado a lado",
    classes: ["os-pd-row"],
    components: [
      productsDef({ ...SHOWCASES.dayDeal, currency }, { html }),
      productsDef({ ...SHOWCASES.dayOffers, currency }, { html }),
    ],
  };
}

export const storeBlocks: OsBlock[] = [
  {
    id: "cabecalho-loja",
    label: "Cabeçalho de loja",
    category: "loja",
    media: icon(
      '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9.5h20M2 14h20"/><rect x="5" y="6" width="3" height="1.6" rx=".5"/><rect x="9.5" y="5.9" width="7.5" height="1.9" rx=".9"/><path d="M18.5 6.2h1.6l.4 1.6M5 11.8h2.5M9.5 11.8h2.5M14 11.8h2.5"/>',
    ),
    content: storeHeaderDef(),
    select: true,
  },
  {
    id: "carrossel-banners",
    label: "Carrossel de banners",
    category: "loja",
    hint: "Banners que passam sozinhos na horizontal (1, 2, 3…). Troque a imagem e ponha um link em cada um.",
    media: icon(
      '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6.5 15.5l3.2-3.2 2.3 2.1 1.6-1.5 3 3"/><circle cx="8.5" cy="9.5" r="1.3"/><path d="M2.5 12l-1 0M22.5 12l-1 0"/><circle cx="10" cy="21.5" r=".6"/><circle cx="12" cy="21.5" r=".6"/><circle cx="14" cy="21.5" r=".6"/>',
    ),
    content: bannerDef(DEFAULT_BANNER),
    select: true,
  },
  {
    id: "grade-produtos",
    label: "Grade de produtos",
    category: "loja",
    media: icon(
      '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    ),
    content: showcase(SHOWCASES.grid),
    select: true,
  },
  {
    id: "carrossel-produtos",
    label: "Carrossel de produtos",
    category: "loja",
    media: icon(
      '<rect x="5" y="5" width="6" height="11" rx="1.2"/><rect x="13" y="5" width="6" height="11" rx="1.2"/><path d="M2.5 10.5l1.5-1.5M2.5 10.5L4 12M21.5 10.5L20 9M21.5 10.5L20 12"/><circle cx="10" cy="19.5" r=".6"/><circle cx="12" cy="19.5" r=".6"/><circle cx="14" cy="19.5" r=".6"/>',
    ),
    content: showcase(SHOWCASES.carousel),
    select: true,
  },
  {
    id: "faixa-ofertas",
    label: "Faixa de ofertas",
    category: "loja",
    media: icon(
      '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M5 8h7"/><rect x="5" y="11" width="4" height="6" rx=".8"/><rect x="10" y="11" width="4" height="6" rx=".8"/><rect x="15" y="11" width="4" height="6" rx=".8"/>',
    ),
    content: showcase({ ...SHOWCASES.band, titleStyle: { "font-weight": "700" } }),
    select: true,
  },
  {
    id: "oferta-do-dia",
    label: "Oferta do dia + ofertas",
    category: "loja",
    media: icon(
      '<rect x="2" y="4" width="7" height="16" rx="1.5"/><rect x="11" y="4" width="11" height="16" rx="1.5"/><path d="M4 8h3M13 8h5"/><rect x="13" y="11" width="3.5" height="6" rx=".6"/><rect x="17.5" y="11" width="3" height="6" rx=".6"/>',
    ),
    content: el("section", "Oferta do dia + ofertas", { "background-color": "#ededed", padding: "24px 16px" }, [
      dayDealRow(),
    ]),
    select: true,
  },
  {
    id: "lista-ofertas-dia",
    label: "Lista de ofertas do dia",
    category: "loja",
    media: icon(
      '<rect x="2" y="3" width="9" height="8" rx="1.5"/><rect x="13" y="3" width="9" height="8" rx="1.5"/><rect x="2" y="13" width="9" height="8" rx="1.5"/><rect x="13" y="13" width="9" height="8" rx="1.5"/><path d="M4 6h3M15 6h3M4 16h3M15 16h3"/>',
    ),
    content: showcase(SHOWCASES.dayList),
    select: true,
  },
  {
    id: "galeria-produto",
    label: "Galeria de fotos do produto",
    category: "loja",
    media: icon(
      '<rect x="8" y="3" width="13" height="13" rx="1.5"/><path d="M9.5 13.5l3.2-3.2 2.3 2.1 1.6-1.5 3 3"/><rect x="3" y="3" width="3" height="3" rx=".6"/><rect x="3" y="8" width="3" height="3" rx=".6"/><rect x="3" y="13" width="3" height="3" rx=".6"/><path d="M8 20h13"/>',
    ),
    content: galleryDef(galleryPlaceholders(4)),
    select: true,
  },
  {
    id: "caixa-compra",
    label: "Caixa de compra",
    category: "loja",
    media: icon(
      '<rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M7 6.5h10M7 9.5h6"/><path d="M7 13h4.5"/><rect x="7" y="15.5" width="10" height="3" rx="1"/>',
    ),
    content: productBuyDef(EXAMPLE_BUY),
    select: true,
  },
];
