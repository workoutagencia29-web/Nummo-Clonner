/**
 * Loja: moedas, preços e os dados de cada produto da vitrine
 * (data-os-widget="products") e, depois, da caixa de compra da página do
 * produto. Sem dependências (o parseAmount também é puro): roda no editor, no
 * servidor e pode ir no script das páginas. A formatação é feita à mão (sem
 * Intl): o resultado é o mesmo no Node e em qualquer navegador.
 *
 * Os dados ficam em atributos do cartão (a[data-os-product]) — os mesmos
 * nomes na caixa de compra:
 *
 *   data-os-pd-price        preço (centavos)
 *   data-os-pd-old          preço antigo (centavos ou vazio; o % OFF é calculado)
 *   data-os-pd-inst         número de parcelas (0 a 24; 0 = não mostra)
 *   data-os-pd-inst-value   valor da parcela (centavos ou vazio = preço ÷ parcelas, "sem juros")
 *   data-os-pd-ship         frete ("Frete grátis"; vazio = não mostra)
 *   data-os-pd-sold         vendidos ("+10mil vendidos")
 *   data-os-pd-stock        estoque (inteiro; vazio = não mostra)
 *   data-os-pd-badge        selo ("OFERTA DO DIA")
 *   data-os-pd-rating       avaliação (0 a 5, uma casa)
 *   data-os-pd-reviews      número de avaliações
 *
 * A moeda fica no widget (data-os-currency: BRL, MXN, USD ou EUR; padrão BRL),
 * e também o idioma das frases geradas (data-os-pd-lang: pt, es ou en; sem o
 * atributo, o da moeda — real → português, peso → espanhol, dólar → inglês).
 * As partes do cartão que mostram esses dados (selo, avaliação, preço, frete,
 * vendidos, estoque) não são guardadas como elementos no editor: o HTML delas
 * vem de productPartHtml (src/editor/widgets/products.ts).
 */
import { parseAmount } from "@/lib/payments/rules";
import { cutText } from "@/lib/text";

/** Moedas da loja: símbolo (antes ou depois), separador de milhar e de centavos. */
export const STORE_CURRENCIES = {
  BRL: { label: "Real (R$)", symbol: "R$", after: false, space: true, group: ".", dec: "," },
  MXN: { label: "Peso mexicano ($)", symbol: "$", after: false, space: false, group: ",", dec: "." },
  USD: { label: "Dólar (US$)", symbol: "US$", after: false, space: true, group: ",", dec: "." },
  EUR: { label: "Euro (€)", symbol: "€", after: true, space: true, group: ".", dec: "," },
} as const;
export type StoreCurrency = keyof typeof STORE_CURRENCIES;
export const DEFAULT_CURRENCY: StoreCurrency = "BRL";
export const STORE_CURRENCY_IDS = Object.keys(STORE_CURRENCIES) as StoreCurrency[];

/** Atributo da moeda no widget. */
export const CURRENCY_ATTR = "data-os-currency";
/** Atributo do idioma das frases geradas no widget (sem ele: o da moeda). */
export const LANG_ATTR = "data-os-pd-lang";
/** Marca do cartão de produto (a[data-os-product]). */
export const PRODUCT_ATTR = "data-os-product";
/** Parte gerada do cartão (data-os-pd-part="price"…). */
export const PART_ATTR = "data-os-pd-part";
/**
 * Links da loja que não são de compra (logo e categorias do cabeçalho, "Ver
 * todas" da vitrine, "‹ Voltar para a loja" da página do produto): sem
 * destino, não pedem link da oferta — o logo leva à página da loja, a
 * categoria busca o próprio texto (src/runtime/widgets/store.ts), o "Ver
 * todas" sem destino tem o aviso da vitrine (src/lib/store-pages.ts) e o
 * "Voltar" volta à página anterior (src/runtime/product).
 */
export const STORE_NAV_CLASSES = ["os-sh-logo", "os-sh-cat", "os-pd-more", "os-pd-back", "os-bn-slide"] as const;

/** Maior preço aceito (99.999.999,99). */
export const STORE_MAX_CENTS = 9_999_999_999;
export const STORE_TEXT_MAX = 60;
export const MAX_INSTALLMENTS = 24;
export const MAX_STOCK = 999_999;
export const MAX_REVIEWS = 99_999_999;

/** Moeda válida (o que não for conhecido vira BRL). */
export function storeCurrency(raw: unknown): StoreCurrency {
  const v = String(raw ?? "")
    .trim()
    .toUpperCase();
  return STORE_CURRENCY_IDS.indexOf(v as StoreCurrency) >= 0 ? (v as StoreCurrency) : DEFAULT_CURRENCY;
}

// ─── Idioma das frases geradas ───────────────────────────────────────────────

/** Idiomas das frases que o cartão gera (parcelas, estoque, leitores de tela). */
export const STORE_LANGS = { pt: "Português", es: "Español", en: "English" } as const;
export type StoreLang = keyof typeof STORE_LANGS;
export const STORE_LANG_IDS = Object.keys(STORE_LANGS) as StoreLang[];
export const DEFAULT_LANG: StoreLang = "pt";

/** Idioma de cada moeda quando a vitrine não escolhe um (euro: português, o do usuário). */
const CURRENCY_LANG: Record<StoreCurrency, StoreLang> = { BRL: "pt", MXN: "es", USD: "en", EUR: "pt" };

/** Idioma escolhido (vazio ou desconhecido → o da moeda). */
export function storeLang(raw: unknown, currency: StoreCurrency = DEFAULT_CURRENCY): StoreLang {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  return STORE_LANG_IDS.indexOf(v as StoreLang) >= 0 ? (v as StoreLang) : CURRENCY_LANG[currency];
}

/**
 * Frases geradas em cada idioma ({n}, {nota} e {preco} são trocados). "OFF"
 * fica igual em todos. As frases dos leitores de tela (rating, reviews, was)
 * não aparecem na tela.
 */
export const STORE_TEXTS: Record<
  StoreLang,
  {
    noInterest: string;
    left: string;
    last: string;
    out: string;
    rating: string;
    reviews: string;
    review: string;
    was: string;
    prev: string;
    next: string;
  }
> = {
  pt: {
    noInterest: "sem juros",
    left: "Restam {n} unidades",
    last: "Última unidade!",
    out: "Esgotado",
    rating: "Avaliação {nota} de 5",
    reviews: "{n} avaliações",
    review: "1 avaliação",
    was: "De {preco} por ",
    prev: "Anterior",
    next: "Próximo",
  },
  es: {
    noInterest: "sin intereses",
    left: "Quedan {n} unidades",
    last: "¡Última unidad!",
    out: "Agotado",
    rating: "Calificación {nota} de 5",
    reviews: "{n} opiniones",
    review: "1 opinión",
    was: "Antes {preco}, ahora ",
    prev: "Anterior",
    next: "Siguiente",
  },
  en: {
    noInterest: "interest-free",
    left: "Only {n} left",
    last: "Last one!",
    out: "Sold out",
    rating: "Rated {nota} out of 5",
    reviews: "{n} reviews",
    review: "1 review",
    was: "Was {preco}, now ",
    prev: "Previous",
    next: "Next",
  },
};

const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (all, key: string) => (key in values ? values[key] : all));

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** "1044" → "1.044" (com o separador de milhar da moeda). */
function groupDigits(n: number, sep: string): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Número com vírgulas de milhar e, talvez, ponto nos centavos ("1,299", "US$ 1,299.90"). */
const COMMA_GROUPS_RE = /^(\D*?)(\d{1,3}(?:,\d{3})+)(\.\d{1,2})?(\D*)$/;

/**
 * Preço digitado → centavos ("63,76", "63.76", "R$ 1.044,90", "1,044.90",
 * "49"…; regras de parseAmount). Nas moedas com vírgula no milhar (dólar,
 * peso mexicano), "1,299" é mil duzentos e noventa e nove (no real, parseAmount
 * recusa "49,900": a vírgula seria dos centavos). Vazio, inválido ou acima do
 * limite → null.
 */
export function parseStorePrice(
  text: string | null | undefined,
  currency: StoreCurrency = DEFAULT_CURRENCY,
): number | null {
  let t = String(text ?? "").trim();
  if (!t) return null;
  const groups = STORE_CURRENCIES[currency]?.group === "," ? COMMA_GROUPS_RE.exec(t) : null;
  if (groups) t = `${groups[1]}${groups[2].replace(/,/g, "")}${groups[3] ?? ""}${groups[4]}`;
  const cents = parseAmount(t);
  return cents !== null && cents <= STORE_MAX_CENTS ? cents : null;
}

export interface PriceParts {
  symbol: string;
  /** Parte inteira com o separador de milhar ("1.044"). */
  int: string;
  /** Centavos ("90"); "" quando são 00 (como "R$ 1.399"). */
  cents: string;
  /** Separador dos centavos da moeda ("," ou "."). */
  dec: string;
  symbolAfter: boolean;
  /** Espaço entre o símbolo e o número ("R$ 63" × "$63"). */
  space: boolean;
}

/** Partes do preço para desenhar com os centavos pequenos ("R$ 179⁸⁰"). */
export function priceParts(cents: number, currency: StoreCurrency): PriceParts {
  const c = STORE_CURRENCIES[currency] ?? STORE_CURRENCIES[DEFAULT_CURRENCY];
  const n = Math.max(0, Math.round(cents));
  const rest = n % 100;
  return {
    symbol: c.symbol,
    int: groupDigits(Math.floor(n / 100), c.group),
    cents: rest ? String(rest).padStart(2, "0") : "",
    dec: c.dec,
    symbolAfter: c.after,
    space: c.space,
  };
}

/**
 * Preço com a moeda: "R$ 1.044,90", "$1,044.90", "US$ 1,044.90", "1.044,90 €".
 * `short`: sem os centavos quando são 00 ("R$ 1.399").
 */
export function formatPrice(cents: number, currency: StoreCurrency, opts: { short?: boolean } = {}): string {
  const p = priceParts(cents, currency);
  const num = p.cents || !opts.short ? `${p.int}${p.dec}${p.cents || "00"}` : p.int;
  const gap = p.space ? " " : "";
  return p.symbolAfter ? `${num}${gap}${p.symbol}` : `${p.symbol}${gap}${num}`;
}

/** Valor para o campo de preço das Configurações ("1.044,90"; "1,044.90" em USD/MXN). */
export function priceInput(cents: number | null, currency: StoreCurrency): string {
  if (cents === null) return "";
  const p = priceParts(cents, currency);
  return `${p.int}${p.dec}${p.cents || "00"}`;
}

/** % de desconto (inteiro, arredondado) quando o preço antigo é maior que o preço; senão null. */
export function discountPercent(old: number | null, price: number | null): number | null {
  if (old === null || price === null || !(old > price && price > 0)) return null;
  const pct = Math.round(((old - price) * 100) / old);
  return pct > 0 ? Math.min(pct, 99) : null;
}

/**
 * Parcelas: "12x R$ 5,31 sem juros" (sem valor próprio: preço ÷ parcelas,
 * arredondado; "sin intereses"/"interest-free" nos outros idiomas) ou
 * "12x R$ 17,77" (com o valor da parcela digitado, sem "sem juros"). Sem
 * parcelas (0/vazio) ou sem preço → "".
 */
export function installmentText(
  price: number | null,
  n: number | string | null | undefined,
  customValue: number | null,
  currency: StoreCurrency,
  lang: StoreLang = DEFAULT_LANG,
): string {
  const count = Math.floor(Number(n) || 0);
  if (count < 1) return "";
  if (customValue !== null && customValue > 0)
    return `${count}x ${formatPrice(customValue, currency, { short: true })}`;
  if (price === null || price <= 0) return "";
  const each = formatPrice(Math.round(price / count), currency, { short: true });
  return `${count}x ${each} ${STORE_TEXTS[lang].noInterest}`;
}

// ─── Dados do produto (atributos) ────────────────────────────────────────────

export interface ProductData {
  /** Preço em centavos (null = sem preço). */
  price: number | null;
  /** Preço antigo em centavos (null = sem). */
  old: number | null;
  /** Número de parcelas (0 = não mostra). */
  inst: number;
  /** Valor da parcela em centavos (null = preço ÷ parcelas, sem juros). */
  instValue: number | null;
  ship: string;
  sold: string;
  /** Estoque (null = não mostra). */
  stock: number | null;
  badge: string;
  /** Nota de 0 a 5, uma casa (null = não mostra). */
  rating: number | null;
  /** Número de avaliações (null = não mostra). */
  reviews: number | null;
}

/** Atributo de cada dado (o mesmo no cartão e na caixa de compra). */
export const PRODUCT_DATA_ATTRS = {
  price: "data-os-pd-price",
  old: "data-os-pd-old",
  inst: "data-os-pd-inst",
  instValue: "data-os-pd-inst-value",
  ship: "data-os-pd-ship",
  sold: "data-os-pd-sold",
  stock: "data-os-pd-stock",
  badge: "data-os-pd-badge",
  rating: "data-os-pd-rating",
  reviews: "data-os-pd-reviews",
} as const satisfies Record<keyof ProductData, string>;

export const EMPTY_PRODUCT: ProductData = {
  price: null,
  old: null,
  inst: 0,
  instValue: null,
  ship: "",
  sold: "",
  stock: null,
  badge: "",
  rating: null,
  reviews: null,
};

/** Texto curto, sem HTML e sem espaços sobrando (até 60 caracteres; um emoji nunca sai cortado ao meio). */
export function cleanStoreText(raw: unknown, max = STORE_TEXT_MAX): string {
  const text = String(raw ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cutText(text, max).trim();
}

/** Inteiro de min a max (null = vazio ou inválido). */
function intIn(raw: unknown, min: number, max: number): number | null {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

/** Centavos guardados no atributo (inteiro de 0 ao limite). */
const centsIn = (raw: unknown) => intIn(raw, 0, STORE_MAX_CENTS);

/** Nota de 0 a 5 com uma casa ("4.8" ou "4,8"); null = vazio ou inválido. */
export function parseRating(raw: unknown): number | null {
  const text = String(raw ?? "")
    .trim()
    .replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const n = Math.round(Number(text) * 10) / 10;
  return n >= 0 && n <= 5 ? n : null;
}

/** Dados do produto lidos dos atributos (o que estiver inválido fica vazio). */
export function readProduct(attrs: Record<string, unknown>): ProductData {
  const a = PRODUCT_DATA_ATTRS;
  return {
    price: centsIn(attrs[a.price]),
    old: centsIn(attrs[a.old]),
    inst: intIn(attrs[a.inst], 0, MAX_INSTALLMENTS) ?? 0,
    instValue: centsIn(attrs[a.instValue]),
    ship: cleanStoreText(attrs[a.ship]),
    sold: cleanStoreText(attrs[a.sold]),
    stock: intIn(attrs[a.stock], 0, MAX_STOCK),
    badge: cleanStoreText(attrs[a.badge]),
    rating: parseRating(attrs[a.rating]),
    reviews: intIn(attrs[a.reviews], 0, MAX_REVIEWS),
  };
}

/** Dados arrumados (limites, textos sem HTML). */
export function cleanProduct(data: Partial<ProductData>): ProductData {
  return readProduct(productAttrsRaw({ ...EMPTY_PRODUCT, ...data }));
}

function productAttrsRaw(d: ProductData): Record<string, string> {
  const a = PRODUCT_DATA_ATTRS;
  const num = (v: number | null) => (v === null || !Number.isFinite(v) ? "" : String(Math.round(v)));
  return {
    [a.price]: num(d.price),
    [a.old]: num(d.old),
    [a.inst]: String(Math.round(Number(d.inst) || 0)),
    [a.instValue]: num(d.instValue),
    [a.ship]: String(d.ship ?? ""),
    [a.sold]: String(d.sold ?? ""),
    [a.stock]: num(d.stock),
    [a.badge]: String(d.badge ?? ""),
    [a.rating]: d.rating === null || !Number.isFinite(d.rating) ? "" : String(Math.round(d.rating * 10) / 10),
    [a.reviews]: num(d.reviews),
  };
}

/** Atributos de um produto (todos os data-os-pd-*; vazio = sem o dado). */
export function productAttrs(data: Partial<ProductData>): Record<string, string> {
  const clean = readProduct(productAttrsRaw({ ...EMPTY_PRODUCT, ...data }));
  return productAttrsRaw(clean);
}

// ─── Partes geradas ──────────────────────────────────────────────────────────

export const PRODUCT_PARTS = ["badge", "rating", "price", "ship", "sold", "stock"] as const;
export type ProductPart = (typeof PRODUCT_PARTS)[number];

export const isProductPart = (v: unknown): v is ProductPart => PRODUCT_PARTS.includes(v as ProductPart);

/** "4,8" (uma casa, com o separador da moeda). */
export function ratingText(r: number, currency: StoreCurrency) {
  return r.toFixed(1).replace(".", STORE_CURRENCIES[currency].dec);
}

/** Texto do estoque: "Restam 19 unidades", "Última unidade!" ou "Esgotado" (no idioma). */
export function stockText(stock: number, lang: StoreLang = DEFAULT_LANG): string {
  const t = STORE_TEXTS[lang];
  if (stock <= 0) return t.out;
  return stock === 1 ? t.last : fill(t.left, { n: String(stock) });
}

/** Estoque baixo (5 ou menos): a pílula fica vermelha. */
export const LOW_STOCK = 5;

/**
 * Preço: as partes visuais (% OFF, antigo riscado, preço com os centavos
 * pequenos) ficam escondidas dos leitores de tela, que leem uma frase só
 * ("De R$ 219,90 por R$ 129,90 (41% OFF)"). Os pedaços dessa frase têm classe
 * própria: "Mostrar" da vitrine esconde o antigo e o % OFF também nela.
 */
function priceHtml(d: ProductData, currency: StoreCurrency, lang: StoreLang): string {
  if (d.price === null) return "";
  const t = STORE_TEXTS[lang];
  const now = formatPrice(d.price, currency, { short: true });
  const hasOld = d.old !== null && d.old > d.price;
  const off = discountPercent(d.old, d.price);
  let sr = "";
  if (hasOld)
    sr += `<span class="os-pd-sr-old">${esc(fill(t.was, { preco: formatPrice(d.old as number, currency, { short: true }) }))}</span>`;
  sr += esc(now);
  if (off !== null) sr += `<span class="os-pd-sr-off"> (${off}% OFF)</span>`;
  let out = `<span class="os-pd-sr">${sr}</span>`;
  if (off !== null) out += `<span class="os-pd-off" aria-hidden="true">${off}% OFF</span>`;
  if (hasOld) {
    out += `<s class="os-pd-old" aria-hidden="true">${esc(formatPrice(d.old as number, currency, { short: true }))}</s>`;
  }
  const p = priceParts(d.price, currency);
  const sym = `<span class="os-pd-sym">${esc(p.symbol)}</span>`;
  const num =
    `<span class="os-pd-int">${p.int}</span>` +
    (p.cents ? `<span class="os-pd-dec">${esc(p.dec)}</span><sup class="os-pd-cents">${p.cents}</sup>` : "");
  const gap = p.space ? " " : "";
  out += `<span class="os-pd-now" aria-hidden="true">${p.symbolAfter ? num + gap + sym : sym + gap + num}</span>`;
  const inst = installmentText(d.price, d.inst, d.instValue, currency, lang);
  if (inst) {
    const free = d.instValue === null ? " os-pd-free" : "";
    out += `<span class="os-pd-inst${free}">${esc(inst)}</span>`;
  }
  return out;
}

/** Estrelas para os olhos; para os leitores de tela, "Avaliação 4,8 de 5, 1.234 avaliações". */
function ratingHtml(d: ProductData, currency: StoreCurrency, lang: StoreLang): string {
  if (d.rating === null) return "";
  const t = STORE_TEXTS[lang];
  const r = ratingText(d.rating, currency);
  const pct = Math.round((d.rating / 5) * 1000) / 10;
  const n = d.reviews !== null ? groupDigits(d.reviews, STORE_CURRENCIES[currency].group) : "";
  const count = n ? `<span class="os-pd-count" aria-hidden="true">(${n})</span>` : "";
  let label = fill(t.rating, { nota: r });
  if (d.reviews !== null) label += `, ${d.reviews === 1 ? t.review : fill(t.reviews, { n })}`;
  return (
    `<span class="os-pd-stars" role="img" aria-label="${esc(label)}">` +
    `<span class="os-pd-stars-on" style="width:${pct}%"></span></span>` +
    `<span class="os-pd-rate" aria-hidden="true">${r}</span>${count}`
  );
}

/**
 * HTML (escapado) de uma parte gerada do cartão ou da caixa de compra, com as
 * frases no idioma `lang`. Parte sem dado → "" (o CSS esconde a parte vazia).
 */
export function productPartHtml(
  part: ProductPart,
  data: ProductData,
  currency: StoreCurrency,
  lang: StoreLang = DEFAULT_LANG,
): string {
  switch (part) {
    case "badge":
      return esc(data.badge);
    case "rating":
      return ratingHtml(data, currency, lang);
    case "price":
      return priceHtml(data, currency, lang);
    case "ship":
      return esc(data.ship);
    case "sold":
      return esc(data.sold);
    case "stock":
      if (data.stock === null) return "";
      return `<span class="os-pd-stk${data.stock <= LOW_STOCK ? " os-pd-low" : ""}">${esc(stockText(data.stock, lang))}</span>`;
    default:
      return "";
  }
}

// ─── Galeria da página do produto ────────────────────────────────────────────

/**
 * Marca da foto grande da galeria (data-os-widget="product-gallery"): o
 * conteúdo dela é gerado a partir da primeira miniatura (galleryStageHtml), no
 * editor e no localizar e substituir.
 */
export const GALLERY_STAGE_ATTR = "data-os-pg-stage";

const escAttr = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** HTML da foto grande da galeria: a primeira miniatura (endereço e descrição). */
export function galleryStageHtml(src: string, alt: string): string {
  return src ? `<img class="os-pg-main" src="${escAttr(src)}" alt="${escAttr(alt)}">` : "";
}
