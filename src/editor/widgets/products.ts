/**
 * Vitrine de produtos no editor (data-os-widget="products"): tipos do
 * GrapesJS da vitrine, do cartão (a[data-os-product]) e das partes, com as
 * Configurações de cada um.
 *
 * - O cartão é um tipo próprio (não o "link" do GrapesJS: o cartão inteiro não
 *   vira texto editável). O nome é um texto comum (dois cliques) e a foto uma
 *   imagem comum (dois cliques trocam). O destino é o de qualquer <a>
 *   (registerDynamicTraits, src/editor/grapes/components.ts): para cartões, a
 *   lista "Página do produto" aparece sempre, logo no começo.
 * - Selo, avaliação, preço, frete, vendidos e estoque não são guardados como
 *   elementos: o HTML deles vem dos atributos data-os-pd-* do cartão + moeda e
 *   idioma da vitrine (productPartHtml, src/lib/store.ts), ao desenhar e ao
 *   salvar (getInnerHTML), como a roda da roleta. Clicar neles seleciona o
 *   cartão. O nome das setas do carrossel (leitores de tela) também é gerado.
 * - "Idioma dos textos" (data-os-pd-lang; sem ele, o da moeda) troca as frases
 *   geradas: "sem juros", "Restam N unidades", "Esgotado"… — o usuário também
 *   vende no México e na Europa.
 * - Cartão sem destino (sem página, endereço, pagamento na página ou link da
 *   oferta COM destino — a regra do ZIP): o canvas contorna o cartão
 *   (data-os-cv-sem, WIDGET_CANVAS_CSS) e põe UM aviso no alto da vitrine com
 *   quantos faltam (data-os-cv-aviso), os dois só no elemento desenhado
 *   (paintProductsWarning); o ZIP e o "Próximos passos" também avisam
 *   (src/lib/store-pages.ts).
 * - Página do produto criada daqui: "＋ Criar página deste produto" (cartão sem
 *   destino) e "Criar as páginas que faltam (N)" (vitrine) abrem o diálogo do
 *   editor (src/editor/grapes/product-pages.ts). Uma página por produto
 *   (productPagePlan): o mesmo produto (mesmo nome) em outras vitrines da
 *   página vai junto, e o que já tem página é ligado a ela em vez de ganhar
 *   outra; productCardInfo dá o que vai para a página nova e linkProductPage
 *   liga o cartão.
 * - Duplicar, apagar e arrastar cartões usam a barra do GrapesJS e as Camadas;
 *   cartões só entram na trilha de uma vitrine.
 */
import type { Component, Editor, Trait } from "grapesjs";
import { editorTimeout } from "@/editor/grapes/lifecycle";
import { CREATE_PRODUCT_PAGE_TRAIT, canCreateProductPages, requestProductPages } from "@/editor/grapes/product-pages";
import { INTERNAL_LINK_PREFIX, internalLink } from "@/lib/internal-links";
import { AMBIGUOUS_COMMA_MESSAGE } from "@/lib/payments/rules";
import { productKey } from "@/lib/product-pages";
import {
  CURRENCY_ATTR,
  cleanStoreText,
  isProductPart,
  LANG_ATTR,
  MAX_INSTALLMENTS,
  MAX_REVIEWS,
  MAX_STOCK,
  PART_ATTR,
  PRODUCT_ATTR,
  PRODUCT_DATA_ATTRS,
  parseRating,
  parseStorePrice,
  priceInput,
  productPartHtml,
  readProduct,
  STORE_CURRENCIES,
  STORE_LANGS,
  type StoreCurrency,
  type StoreLang,
  storeCurrency,
  storeLang,
} from "@/lib/store";
import { withScheme } from "@/runtime/widgets/options";
import { widgetContext } from "./context";
import { attr, baseStyle, descendants, setBaseStyle, setText } from "./dom";
import {
  NEW_PRODUCT,
  navLabelHtml,
  PRODUCT_CARD_LABEL,
  PRODUCT_IMG_TYPE,
  PRODUCT_NAME_TYPE,
  PRODUCT_NO_DEST_ATTR,
  PRODUCT_PART_TYPE,
  PRODUCT_TYPE,
  PRODUCTS_BOX_TYPE,
  PRODUCTS_CSS,
  PRODUCTS_NAV_TYPE,
  PRODUCTS_ROW_TYPE,
  PRODUCTS_SHOW,
  PRODUCTS_TRACK_TYPE,
  PRODUCTS_TYPE,
  PRODUCTS_VARS,
  PRODUCTS_WARN_ATTR,
  type ProductsColor,
  productCardDef,
  productsThemeColor,
  showDefault,
} from "./products-content";
import { checkAttr, heading, type TraitDef } from "./traits";

export const isProducts = (c: Component) => attr(c, "data-os-widget") === "products";
export const isProductCard = (c: Component) =>
  c.get("tagName") === "a" && c.getAttributes()[PRODUCT_ATTR] !== undefined;
const isTrack = (c: Component) => c.getAttributes()["data-os-pd-track"] !== undefined;
const isPart = (c: Component) => c.get("type") === PRODUCT_PART_TYPE;

/** Vitrine a que o componente pertence (ela mesma, se for a vitrine). */
export function productsOf(c: Component | undefined): Component | undefined {
  let at: Component | undefined = c;
  while (at && !isProducts(at)) at = at.parent();
  return at;
}

/**
 * Dono dos dados do produto: o cartão (ou, na página do produto, a caixa de
 * compra data-os-widget="product-buy").
 */
export function productHostOf(c: Component | undefined): Component | undefined {
  let at: Component | undefined = c;
  while (at && !isProductCard(at) && attr(at, "data-os-widget") !== "product-buy") at = at.parent();
  return at;
}

/** Elemento com a moeda (a vitrine ou a caixa de compra) mais próximo. */
function currencyHost(c: Component | undefined): Component | undefined {
  let at: Component | undefined = c;
  while (at && !attr(at, CURRENCY_ATTR)) at = at.parent();
  return at;
}

/** Moeda do produto (a do elemento mais próximo com data-os-currency). */
export function currencyOf(c: Component | undefined): StoreCurrency {
  const host = currencyHost(c);
  return storeCurrency(host ? attr(host, CURRENCY_ATTR) : "");
}

/** Idioma das frases geradas (o escolhido na vitrine; sem ele, o da moeda). */
export function langOf(c: Component | undefined): StoreLang {
  const host = currencyHost(c);
  return storeLang(host ? attr(host, LANG_ATTR) : "", currencyOf(c));
}

/** HTML de uma parte gerada (vazio fora de um cartão). */
function partHtml(part: Component): string {
  const host = productHostOf(part);
  const name = attr(part, PART_ATTR);
  if (!host || !isProductPart(name)) return "";
  return productPartHtml(name, readProduct(host.getAttributes()), currencyOf(host), langOf(host));
}

const isNav = (c: Component) => c.get("type") === PRODUCTS_NAV_TYPE;
/** Nome da seta para leitores de tela, no idioma da vitrine. */
const navHtml = (nav: Component) =>
  navLabelHtml(nav.getClasses().includes("os-pd-prev") ? "prev" : "next", langOf(nav));

/** Redesenha no canvas as partes geradas de dentro do componente (cartão ou vitrine) e as setas. */
export function redrawParts(root: Component) {
  for (const part of descendants(root, isPart)) {
    const el = part.getEl();
    if (el) el.innerHTML = partHtml(part);
  }
  for (const nav of descendants(root, isNav)) {
    const el = nav.getEl();
    if (el) el.innerHTML = navHtml(nav);
  }
}

const DATA_ATTRS: string[] = Object.values(PRODUCT_DATA_ATTRS);

/**
 * Redesenha as partes geradas do dono dos dados (cartão ou caixa de compra)
 * quando um data-os-pd-* dele muda (campos, Desfazer, localizar e substituir).
 * `withCurrency`: a moeda e o idioma do próprio elemento também contam (caixa de compra).
 */
export function watchProductData(host: Component, withCurrency = false) {
  const names = withCurrency ? [...DATA_ATTRS, CURRENCY_ATTR, LANG_ATTR] : DATA_ATTRS;
  host.on("change:attributes", () => {
    const prev = (host.previous("attributes") ?? {}) as Record<string, unknown>;
    const now = host.getAttributes();
    if (names.some((name) => String(prev[name] ?? "") !== String(now[name] ?? ""))) redrawParts(host);
  });
}

// ─── Aviso do canvas: produtos sem página ────────────────────────────────────

/** Endereço que leva a algum lugar ("#", vazio e javascript: não levam). */
const leads = (href: string) => Boolean(href) && href !== "#" && !/^javascript:/i.test(href);

/** Editor do componente (o GrapesJS guarda no `em` do modelo). */
const editorOf = (c: Component) => (c as unknown as { em?: { getEditor?: () => Editor } }).em?.getEditor?.();

/**
 * Chaves dos links da oferta que levam a algum lugar: endereço ou pagamento na
 * página (a regra de linkHasDestination, src/lib/offer-links.ts — que traria o
 * cheerio para o editor).
 */
function liveLinks(editor: Editor | undefined): Set<string> {
  const links = widgetContext(editor).links.filter((l) => Boolean(l.payment) || Boolean(l.url?.trim()));
  return new Set(links.map((l) => l.key));
}

/**
 * O cartão leva a algum lugar: página do produto (ou outro endereço),
 * pagamento na página ou link da oferta COM destino (a mesma regra do ZIP e
 * do "Próximos passos", src/lib/store-pages.ts — ligado a um link ainda sem
 * endereço, ou a um link apagado, o clique não leva a lugar nenhum). Os que
 * não levam são os que o canvas contorna (WIDGET_CANVAS_CSS).
 */
export function cardHasDestination(card: Component, live: Set<string> = liveLinks(editorOf(card))): boolean {
  const attrs = card.getAttributes();
  const key = String(attrs["data-os-link"] ?? "");
  return leads(attr(card, "href").trim()) || attrs["data-os-pay"] !== undefined || (Boolean(key) && live.has(key));
}

/** Cartões da vitrine que não levam a lugar nenhum, na ordem. */
export function cardsMissingPage(widget: Component): Component[] {
  const live = liveLinks(editorOf(widget));
  return descendants(widget, isProductCard).filter((card) => !cardHasDestination(card, live));
}

/** Quantos cartões da vitrine não levam a lugar nenhum. */
export function cardsWithoutDestination(widget: Component): number {
  return cardsMissingPage(widget).length;
}

/** Marca (só no elemento desenhado) o cartão que não leva a lugar nenhum: o canvas o contorna. */
function paintCard(card: Component, el: HTMLElement | undefined = card.getEl(), live?: Set<string>) {
  if (!el) return;
  if (cardHasDestination(card, live)) el.removeAttribute(PRODUCT_NO_DEST_ATTR);
  else el.setAttribute(PRODUCT_NO_DEST_ATTR, "");
}

/** Texto do aviso no alto da vitrine (null = todos os produtos levam a algum lugar). */
export function productsWarning(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 produto ainda sem página: use “Criar as páginas que faltam” nas Configurações da vitrine, ou clique nele e escolha a página dele"
    : `${count} produtos ainda sem página: use “Criar as páginas que faltam” nas Configurações da vitrine, ou clique em cada um e escolha a página dele`;
}

/** Põe (ou tira) o aviso no elemento desenhado da vitrine — nunca no modelo — e a marca dos cartões. */
export function paintProductsWarning(widget: Component, el: HTMLElement | undefined = widget.getEl()) {
  if (!el) return;
  const live = liveLinks(editorOf(widget));
  const cards = descendants(widget, isProductCard);
  for (const card of cards) paintCard(card, undefined, live);
  const text = productsWarning(cards.filter((card) => !cardHasDestination(card, live)).length);
  if (text) el.setAttribute(PRODUCTS_WARN_ATTR, text);
  else el.removeAttribute(PRODUCTS_WARN_ATTR);
}

/** Confere o aviso quando um cartão muda de destino ou entra/sai de uma vitrine. */
function watchProductsWarning(editor: Editor) {
  const all = () => {
    for (const widget of editor.getWrapper()?.find('[data-os-widget="products"]') ?? []) paintProductsWarning(widget);
  };
  editor.on("component:update:attributes", (c: Component) => {
    const widget = productsOf(c);
    if (widget && widget !== c) paintProductsWarning(widget);
  });
  // Cartão apagado, duplicado ou arrastado para outra vitrine (o "remove" vem antes de sair da
  // árvore). Muitas mudanças seguidas (abrir uma página) viram uma conferência só.
  let pending = false;
  editor.on("component:add component:remove", () => {
    if (pending) return;
    pending = true;
    editorTimeout(
      editor,
      () => {
        pending = false;
        all();
      },
      0,
    );
  });
}

// ─── Página do produto ───────────────────────────────────────────────────────

/** O que vai do cartão para a página do produto criada a partir dele. */
export interface ProductCardInfo {
  /** Nome do produto (texto do h3). */
  name: string;
  /** Endereço da foto do cartão. */
  photo: string;
  /** Atributos data-os-pd-* do cartão (preço, parcelas, frete…). */
  data: Record<string, string>;
  currency: StoreCurrency;
  /** Idioma escolhido na vitrine ("" = o da moeda). */
  lang: string;
  /** Link da oferta ligado ao cartão ("" = nenhum). */
  linkKey: string;
}

export function productCardInfo(card: Component): ProductCardInfo {
  const attrs = card.getAttributes();
  const data: Record<string, string> = {};
  for (const name of DATA_ATTRS) if (attrs[name] !== undefined) data[name] = String(attrs[name]);
  const img = descendants(card, (c) => c.get("type") === PRODUCT_IMG_TYPE)[0];
  const host = currencyHost(card);
  return {
    name: nameText(card),
    photo: String(img?.get("src") || img?.getAttributes().src || ""),
    data,
    currency: currencyOf(card),
    lang: host ? attr(host, LANG_ATTR) : "",
    linkKey: attr(card, "data-os-link"),
  };
}

/** Liga o cartão à página do produto (como escolher a página na lista: o link da oferta sai). */
export function linkProductPage(card: Component, pageId: string) {
  card.addAttributes({ href: internalLink(pageId) });
  if ("data-os-link" in card.getAttributes()) card.removeAttributes("data-os-link");
}

/** Página do funil que já existe e é de um produto (para ligar a ela em vez de criar outra). */
export interface KnownProductPage {
  pageId: string;
  /** Nome do produto (o h1 da caixa de compra da página). */
  name: string;
}

/** Um produto do pedido de "＋ Criar página deste produto" / "Criar as páginas que faltam". */
export interface ProductPagePlanItem {
  /** O produto (productKey do nome; "" = cartão sem nome). */
  key: string;
  /** O que vai para a página nova: os dados do primeiro cartão do produto no pedido. */
  info: ProductCardInfo;
  /** Cartões que passam a levar à página: os do pedido e os iguais sem destino no resto da página. */
  cards: Component[];
  /** Quantos desses vêm de fora do pedido (o mesmo produto em outras vitrines da página). */
  extra: number;
  /** Página que já é deste produto (null = criar uma). */
  existing: { id: string; name: string } | null;
}

/**
 * Uma página por produto: os cartões do pedido agrupados por produto (mesmo
 * nome = mesmo produto, productKey), cada produto com a página que ele já tem
 * — a de outro cartão igual desta página (outra vitrine) ou uma página de
 * produto que volta para esta vitrine (`known`, do servidor: layout do
 * celular, versão A/B, página criada antes e desligada pelo Desfazer) —, ou
 * nenhuma (criar). Os cartões iguais sem destino no resto da página entram
 * junto: todos passam a levar à mesma página.
 */
export function productPagePlan(
  editor: Editor,
  cards: Component[],
  { pages, known = [] }: { pages: { id: string; name: string }[]; known?: KnownProductPage[] },
): ProductPagePlanItem[] {
  const names = new Map(pages.map((p) => [p.id, p.name]));
  const all = editor.getWrapper()?.find(`a[${PRODUCT_ATTR}]`) ?? [];
  /** Página do funil (que existe) a que o cartão leva ("" = nenhuma). */
  const pageOf = (card: Component) => {
    const href = attr(card, "href").trim();
    const id = href.startsWith(INTERNAL_LINK_PREFIX) ? href.slice(INTERNAL_LINK_PREFIX.length) : "";
    return names.has(id) ? id : "";
  };
  const existing = new Map<string, string>();
  for (const card of all) {
    const key = productKey(nameText(card));
    const id = pageOf(card);
    if (key && id && !existing.has(key)) existing.set(key, id);
  }
  for (const page of known) {
    const key = productKey(page.name);
    if (key && names.has(page.pageId) && !existing.has(key)) existing.set(key, page.pageId);
  }

  const items: ProductPagePlanItem[] = [];
  const byKey = new Map<string, ProductPagePlanItem>();
  /** Produtos que já têm página (a do próprio cartão): os iguais sem destino ficam para ela, não para a nova. */
  const keep = new Set<string>();
  for (const card of cards) {
    const info = productCardInfo(card);
    const key = productKey(info.name);
    const same = key ? byKey.get(key) : undefined;
    if (same) {
      same.cards.push(card);
      continue;
    }
    const id = key ? existing.get(key) : undefined;
    // "＋ Criar página deste produto…" num cartão que já leva à página dele: quer outra página.
    const own = Boolean(id) && pageOf(card) === id;
    const item: ProductPagePlanItem = {
      key,
      info,
      cards: [card],
      extra: 0,
      existing: id && !own ? { id, name: names.get(id) ?? "" } : null,
    };
    items.push(item);
    if (key) byKey.set(key, item);
    if (own) keep.add(key);
  }
  const live = liveLinks(editor);
  const requested = new Set(cards);
  for (const card of all) {
    if (requested.has(card) || cardHasDestination(card, live)) continue;
    const key = productKey(nameText(card));
    const item = byKey.get(key);
    if (!item || keep.has(key)) continue;
    item.cards.push(card);
    item.extra++;
  }
  return items;
}

// ─── Ações ───────────────────────────────────────────────────────────────────

/** "＋ Adicionar produto": cartão novo (dados de exemplo, sem destino) no fim da trilha, já selecionado. */
export function addProduct(editor: Editor, widget: Component): Component | undefined {
  const track = descendants(widget, isTrack)[0];
  if (!track) return;
  const [added] = track.append(productCardDef(NEW_PRODUCT) as never);
  if (!added) return;
  editor.select(added);
  editorTimeout(
    editor,
    () => {
      try {
        editor.Canvas.scrollTo(added, { behavior: "smooth", block: "center" } as never);
      } catch {
        // canvas ainda não desenhou o cartão: tudo bem
      }
    },
    50,
  );
  return added;
}

// ─── Campos do produto ───────────────────────────────────────────────────────

type FieldResult = { value: string } | { error: string };
/** Confere o valor digitado (`component`: o cartão, para a moeda do preço). */
type FieldParse = (raw: string, component: Component) => FieldResult;

const FIELD_STYLE =
  "width:100%;box-sizing:border-box;background:transparent;border:0;outline:0;color:inherit;font:inherit;padding:6px 8px;";

/** Propriedade extra de um trait (osParse…), fora da tipagem do GrapesJS. */
function prop(trait: Trait, key: string): unknown {
  return (trait.attributes as Record<string, unknown>)[key];
}

function showFieldError(box: HTMLElement, message: string) {
  const input = box.querySelector<HTMLInputElement>("input");
  const err = box.querySelector<HTMLElement>("[data-os-field-err]");
  if (message) input?.setAttribute("aria-invalid", "true");
  else input?.removeAttribute("aria-invalid");
  if (err) {
    err.textContent = message;
    err.style.display = message ? "block" : "none";
  }
}

/**
 * Campo de texto que confere o valor antes de gravar (preço, parcelas,
 * estoque, avaliação): valor que não serve não muda nada e o campo avisa
 * (como o campo de cor).
 */
function registerStoreFieldTrait(editor: Editor) {
  editor.Traits.addType<{ onChange(): void; setInputValue(): void }>("os-store-field", {
    createInput({ trait }: { trait: Trait }) {
      const box = document.createElement("div");
      const input = document.createElement("input");
      input.type = "text";
      input.spellcheck = false;
      input.inputMode = String(prop(trait, "osInputMode") ?? "decimal");
      input.placeholder = String(prop(trait, "placeholder") ?? "");
      input.setAttribute("aria-label", String(prop(trait, "label") ?? ""));
      input.style.cssText = FIELD_STYLE;
      const err = document.createElement("div");
      err.setAttribute("data-os-field-err", "");
      err.setAttribute("role", "alert");
      err.style.cssText = "display:none;margin:2px 8px 4px;color:#dc2626;font-size:11px;line-height:1.35;";
      box.append(input, err);
      return box;
    },
    onChange() {
      const box = this.getInputElem() as HTMLElement;
      const input = box.querySelector<HTMLInputElement>("input");
      const parse = prop(this.model, "osParse") as FieldParse | undefined;
      if (!input || !parse) return;
      const result = parse(input.value.trim(), this.target);
      if ("error" in result) {
        showFieldError(box, result.error);
        return;
      }
      showFieldError(box, "");
      const trait = this.model;
      trait.setValue(result.value);
      // O valor guardado no trait acompanha (assim Desfazer/Refazer redesenham o campo).
      trait.set({ value: trait.getValue() }, { fromTarget: 1 });
      input.value = String(trait.getValue() ?? "");
    },
    setInputValue() {
      // o onUpdate redesenha o campo
    },
    onUpdate({ elInput, trait }: { elInput: HTMLElement; trait: Trait }) {
      showFieldError(elInput, "");
      const input = elInput.querySelector<HTMLInputElement>("input");
      const value = String(trait.getValue() ?? "");
      if (input && input.value !== value) input.value = value;
    },
  });
}

/** Preço que não deu para ler: o exemplo no formato da moeda da vitrine ("49,90" ou "49.90"). */
const priceExample = (currency: StoreCurrency) =>
  `Preço não reconhecido — use, por exemplo, ${priceInput(4990, currency)}`;

/**
 * Preço: obrigatório (o preço do produto) ou opcional (vazio apaga). No dólar
 * e no peso mexicano, "1,299" é milhar (parseStorePrice); "49,900" só é
 * engano nas moedas com vírgula nos centavos.
 */
function priceParse(required: boolean): FieldParse {
  return (raw, component) => {
    if (!raw) return required ? { error: "Digite o preço do produto." } : { value: "" };
    const currency = currencyOf(component);
    const cents = parseStorePrice(raw, currency);
    if (cents === null) {
      const ambiguous = STORE_CURRENCIES[currency].dec === "," && /,\d{3}\D*$/.test(raw);
      return { error: ambiguous ? AMBIGUOUS_COMMA_MESSAGE : priceExample(currency) };
    }
    if (cents === 0) return required ? { error: "O preço precisa ser maior que zero." } : { value: "" };
    return { value: String(cents) };
  };
}

/** Inteiro de min a max; vazio = `empty` ("" apaga, "0" zera). */
function intParse(min: number, max: number, empty: string): FieldParse {
  return (raw) => {
    if (!raw) return { value: empty };
    const clean = raw.replace(/[.\s]/g, "");
    if (!/^\d+$/.test(clean) || Number(clean) < min || Number(clean) > max) {
      return { error: `Use um número inteiro de ${min} a ${max.toLocaleString("pt-BR")}.` };
    }
    return { value: String(Number(clean)) };
  };
}

const ratingParse: FieldParse = (raw) => {
  if (!raw) return { value: "" };
  const r = parseRating(raw);
  return r === null ? { error: "Use uma nota de 0 a 5 (ex.: 4,8)." } : { value: String(r) };
};

function storeField(
  name: string,
  label: string,
  parse: FieldParse,
  opts: { placeholder?: string; inputMode?: string; display?: (raw: string, c: Component) => string } = {},
): TraitDef {
  return {
    type: "os-store-field",
    name,
    label,
    placeholder: opts.placeholder ?? "",
    osParse: parse,
    osInputMode: opts.inputMode ?? "numeric",
    getValue: ({ component }) => {
      const raw = attr(component, name);
      return opts.display ? opts.display(raw, component) : raw;
    },
    setValue: ({ component, value }) => {
      component.addAttributes({ [name]: String(value ?? "") });
    },
  } as TraitDef;
}

/** Preço guardado (centavos) → texto do campo, no formato da moeda da vitrine. */
const priceDisplay = (raw: string, c: Component) => (/^\d+$/.test(raw) ? priceInput(Number(raw), currencyOf(c)) : "");

const priceField = (name: string, label: string, required: boolean, placeholder: string) =>
  storeField(name, label, priceParse(required), { placeholder, inputMode: "decimal", display: priceDisplay });

const textField = (name: string, label: string, placeholder: string): TraitDef => ({
  type: "text",
  name,
  label,
  placeholder,
  setValue: ({ component, value }) => {
    component.addAttributes({ [name]: cleanStoreText(value) });
  },
});

/** Nome do produto: o h3 do cartão ou o h1 da caixa de compra. */
const isName = (c: Component) => c.getClasses().some((k: string) => k === "os-pd-name" || k === "os-pb-name");
const nameOf = (host: Component) => descendants(host, isName)[0];

/** Texto puro do nome (sem marcação). */
function nameText(card: Component): string {
  const name = nameOf(card);
  const el = name?.getEl();
  const raw = el ? (el.textContent ?? "") : (name?.getInnerHTML() ?? "").replace(/<[^>]*>/g, "");
  return raw.replace(/\s+/g, " ").trim();
}

const nameTrait: TraitDef = {
  type: "text",
  name: "os-pd-name",
  label: "Nome do produto",
  placeholder: "Ex.: Fone de ouvido sem fio",
  getValue: ({ component }) => nameText(component),
  setValue: ({ component, value }) => {
    const text = cleanStoreText(value, 150);
    const name = nameOf(component);
    if (!text || !name) return;
    setText(name, text);
  },
};

const A = PRODUCT_DATA_ATTRS;

/**
 * Campos do produto (nome, preço, preço antigo, parcelas, frete, vendidos,
 * estoque, selo, avaliação): os mesmos no cartão da vitrine e na caixa de
 * compra da página do produto (src/editor/widgets/product-page.ts).
 */
export const PRODUCT_FIELD_TRAITS: TraitDef[] = [
  nameTrait,
  priceField(A.price, "Preço", true, "Ex.: 63,76"),
  priceField(A.old, "Preço antigo (riscado; o % OFF é calculado)", false, "Vazio = sem desconto"),
  storeField(A.inst, "Parcelas (0 = não mostra)", intParse(0, MAX_INSTALLMENTS, "0"), { placeholder: "Ex.: 12" }),
  priceField(A.instValue, "Valor da parcela (vazio = preço ÷ parcelas, sem juros)", false, "Ex.: 17,77"),
  textField(A.ship, "Frete (vazio = não mostra)", "Ex.: Frete grátis"),
  textField(A.sold, "Vendidos (vazio = não mostra)", "Ex.: +10mil vendidos"),
  storeField(A.stock, "Estoque: “Restam N unidades” (vazio = não mostra)", intParse(0, MAX_STOCK, ""), {
    placeholder: "Ex.: 19",
  }),
  textField(A.badge, "Selo (vazio = não mostra)", "Ex.: OFERTA DO DIA"),
  storeField(A.rating, "Avaliação de 0 a 5 (vazio = não mostra)", ratingParse, {
    placeholder: "Ex.: 4,8",
    inputMode: "decimal",
    display: (raw) => raw.replace(".", ","),
  }),
  storeField(A.reviews, "Número de avaliações", intParse(0, MAX_REVIEWS, ""), { placeholder: "Ex.: 1234" }),
];

const PRODUCT_TRAITS: TraitDef[] = [
  // "os-h-pd-destino" = PRODUCT_DEST_HEADING (src/editor/grapes/components.ts).
  heading("Ao clicar no produto", "pd-destino"),
  {
    type: "os-action",
    name: CREATE_PRODUCT_PAGE_TRAIT,
    osText: () => "＋ Criar página deste produto",
    // Só para o cartão que ainda não leva a lugar nenhum (e no editor com o diálogo).
    osHidden: (c, editor) => !canCreateProductPages(editor) || cardHasDestination(c),
    osRun: (editor, c) => {
      requestProductPages(editor, { cards: [c] });
    },
  },
  // (aqui entram "Página do produto" e "Link da oferta": registerDynamicTraits)
  {
    type: "text",
    name: "href",
    label: "…ou o endereço",
    placeholder: "https://…",
    getValue: ({ component }) => {
      const href = attr(component, "href");
      return href === "#" || href.startsWith("os-page:") ? "" : href;
    },
    setValue: ({ component, value }) => {
      const href = withScheme(String(value ?? "")) || "#";
      component.addAttributes({ href });
      if (href !== "#" && "data-os-link" in component.getAttributes()) component.removeAttributes("data-os-link");
    },
  },
  heading("Produto", "pd-produto"),
  {
    type: "os-note",
    name: "os-pd-photo",
    label: "Foto: dois cliques nela para trocar. O nome também dá para editar direto no cartão.",
  },
  ...PRODUCT_FIELD_TRAITS,
];

// ─── Configurações da vitrine ────────────────────────────────────────────────

/** Lista com valor padrão (sem o atributo, mostra o padrão de verdade). */
function selectDefault(name: string, label: string, options: [string, string][], def: string): TraitDef {
  return {
    type: "select",
    name,
    label,
    options: options.map(([id, text]) => ({ id, label: text })),
    getValue: ({ component }) => attr(component, name) || def,
    setValue: ({ component, value }) => {
      component.addAttributes({ [name]: String(value ?? def) });
    },
  };
}

function colorTrait(color: ProductsColor, label: string): TraitDef {
  const prop = PRODUCTS_VARS[color];
  return {
    type: "os-color",
    name: `os-pd-color-${color}`,
    label,
    getValue: ({ editor, component }) => {
      const widget = productsOf(component);
      if (!widget) return "";
      return baseStyle(editor, widget)[prop] || productsThemeColor(attr(widget, "data-os-card"), color);
    },
    setValue: ({ editor, component, value }) => {
      const widget = productsOf(component);
      if (widget) setBaseStyle(editor, widget, { [prop]: String(value ?? "") });
    },
  };
}

const COLS: [string, string][] = ["1", "2", "3", "4", "5", "6"].map((n) => [n, n]);

/** Moeda e idioma das frases geradas (vitrine e caixa de compra). */
export const CURRENCY_TRAITS: TraitDef[] = [
  selectDefault(
    CURRENCY_ATTR,
    "Moeda",
    Object.entries(STORE_CURRENCIES).map(([id, c]) => [id, c.label]),
    "BRL",
  ),
  {
    type: "select",
    name: LANG_ATTR,
    label: "Idioma dos textos (parcelas, estoque…)",
    options: [{ id: "", label: "Pela moeda" }, ...Object.entries(STORE_LANGS).map(([id, label]) => ({ id, label }))],
    getValue: ({ component }) => attr(component, LANG_ATTR),
    setValue: ({ component, value }) => {
      const lang = String(value ?? "");
      if (lang) component.addAttributes({ [LANG_ATTR]: lang });
      else if (LANG_ATTR in component.getAttributes()) component.removeAttributes(LANG_ATTR);
    },
  },
  {
    type: "os-note",
    name: "os-pd-lang-note",
    label:
      "“Pela moeda”: real em português, peso mexicano em espanhol, dólar em inglês, euro em português. O nome, o frete, os vendidos e o selo são os textos de cada produto.",
  },
];

const PRODUCTS_TRAITS: TraitDef[] = [
  {
    type: "button",
    name: "os-pd-add",
    text: "＋ Adicionar produto",
    full: true,
    command: (editor, trait) => {
      const widget = productsOf(trait.target as Component);
      if (widget) addProduct(editor, widget);
    },
  },
  {
    type: "os-action",
    name: "os-pd-criar-paginas",
    osText: (c) => {
      const widget = productsOf(c);
      const n = widget ? cardsWithoutDestination(widget) : 0;
      return n ? `Criar as páginas que faltam (${n})` : "Todos os produtos já têm destino";
    },
    osDisabled: (c) => {
      const widget = productsOf(c);
      return !widget || cardsWithoutDestination(widget) === 0;
    },
    osHidden: (_c, editor) => !canCreateProductPages(editor),
    osRun: (editor, c) => {
      const widget = productsOf(c);
      if (widget) requestProductPages(editor, { cards: cardsMissingPage(widget), widget });
    },
  },
  {
    type: "os-note",
    name: "os-pd-note",
    label:
      "Para editar um produto (foto, nome, preço e a página dele), clique nele. Duplicar e excluir: pela barra do produto selecionado.",
  },
  heading("Formato", "pd-formato"),
  selectDefault(
    "data-os-layout",
    "Formato",
    [
      ["grid", "Grade"],
      ["carousel", "Carrossel (rola para o lado)"],
    ],
    "grid",
  ),
  selectDefault("data-os-cols", "Produtos por linha no computador", COLS, "4"),
  selectDefault(
    "data-os-cols-m",
    "Produtos por linha no celular (na grade)",
    [
      ["1", "1"],
      ["2", "2"],
    ],
    "2",
  ),
  selectDefault(
    "data-os-card",
    "Modelo do cartão",
    Object.entries(PRODUCT_CARD_LABEL) as [string, string][],
    "classic",
  ),
  ...CURRENCY_TRAITS,
  heading("Mostrar", "pd-mostrar"),
  ...PRODUCTS_SHOW.map(([key, label]) => checkAttr(`data-os-show-${key}`, label, showDefault(key))),
  heading("Cores", "pd-cores"),
  colorTrait("bg", "Fundo da seção (vazio = sem fundo)"),
  colorTrait("card", "Fundo do cartão"),
  colorTrait("ink", "Cor do texto"),
  colorTrait("price", "Cor do preço"),
  colorTrait("off", "Cor do % OFF"),
  colorTrait("ship", "Cor do frete"),
  colorTrait("badge", "Cor do selo"),
  colorTrait("title", "Cor do título"),
  colorTrait("more", "Cor do “Ver todas”"),
];

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Partes fixas da estrutura: não saem, não se mexem e não recebem outros elementos. */
const FIXED = { draggable: false, droppable: false, removable: false, copyable: false };

/** Clique num link do canvas não navega (o tipo "link" do GrapesJS faz o mesmo). */
const preventLink = (e: Event) => e.preventDefault();

const BOX_NAME: Record<string, string> = { "os-pd-media": "Foto", "os-pd-body": "Dados", "os-pd-wrap": "Produtos" };
const boxClass = (node: HTMLElement) => Object.keys(BOX_NAME).find((cls) => node.classList?.contains(cls));

export function registerProductsTypes(editor: Editor) {
  registerStoreFieldTrait(editor);
  watchProductsWarning(editor);
  const dc = editor.DomComponents;

  dc.addType(PRODUCTS_TYPE, {
    isComponent: (node) => node.getAttribute?.("data-os-widget") === "products",
    model: {
      defaults: {
        name: "Vitrine de produtos",
        droppable: false,
        // Uma vitrine dentro de outra não faz sentido (os cartões se misturariam).
        draggable: (_w: Component, target: Component) => !productsOf(target),
        traits: PRODUCTS_TRAITS,
        styles: PRODUCTS_CSS,
      },
      init(this: Component) {
        this.on(`change:attributes:${CURRENCY_ATTR} change:attributes:${LANG_ATTR}`, () => redrawParts(this));
      },
    },
    view: {
      init(this: { model: Component; el: HTMLElement; listenTo: (o: unknown, e: string, f: () => void) => void }) {
        // O GrapesJS refaz os atributos do elemento a cada mudança: o aviso volta.
        this.listenTo(this.model, "change:attributes", () => paintProductsWarning(this.model, this.el));
      },
      onRender({ el, model }: { el: HTMLElement; model: Component }) {
        paintProductsWarning(model, el);
      },
    },
  });

  dc.addType(PRODUCTS_BOX_TYPE, {
    isComponent: (node) => node.tagName === "DIV" && !!boxClass(node),
    model: {
      defaults: {
        ...FIXED,
        // Clicar no espaço da foto/dos dados seleciona o produto; entre os cartões, a vitrine.
        delegate: {
          select: (c: Component) =>
            c.getClasses().includes("os-pd-wrap") ? (productsOf(c) ?? c) : (productHostOf(c) ?? c),
        },
      },
      getName(this: Component) {
        const custom = this.get("custom-name");
        if (custom) return String(custom);
        const cls = this.getClasses().find((k: string) => BOX_NAME[k]);
        return cls ? BOX_NAME[cls] : "Caixa";
      },
    },
  });

  dc.addType(PRODUCTS_TRACK_TYPE, {
    isComponent: (node) => node.hasAttribute?.("data-os-pd-track") ?? false,
    model: {
      defaults: {
        name: "Produtos",
        draggable: false,
        removable: false,
        copyable: false,
        // Só cartões entram aqui (arrastar nas Camadas ou pela barra do cartão).
        droppable: `[${PRODUCT_ATTR}]`,
        delegate: { select: (c: Component) => productsOf(c) ?? c },
      },
      init(this: Component) {
        // Cartão vindo de outra vitrine (outra moeda): as partes acompanham.
        this.listenTo(this.components(), "add", (card: Component) => editorTimeout(editor, () => redrawParts(card)));
      },
    },
  });

  // Setas: o nome para leitores de tela é gerado (no idioma da vitrine); os filhos salvos são ignorados.
  dc.addType(PRODUCTS_NAV_TYPE, {
    isComponent: (node) =>
      node.tagName === "BUTTON" && (node.classList?.contains("os-pd-nav") ?? false)
        ? { type: PRODUCTS_NAV_TYPE, components: [] }
        : false,
    model: {
      defaults: { ...FIXED, editable: false, selectable: false, hoverable: false, layerable: false },
      getInnerHTML(this: Component) {
        return navHtml(this);
      },
    },
    view: {
      onRender({ el, model }: { el: HTMLElement; model: Component }) {
        el.innerHTML = navHtml(model);
      },
    },
  });

  // "Oferta do dia + ofertas": a linha só recebe vitrines (um bloco clicado com algo
  // dela selecionado entra depois da linha, não espremido ao lado das vitrines).
  dc.addType(PRODUCTS_ROW_TYPE, {
    isComponent: (node) => node.tagName === "DIV" && (node.classList?.contains("os-pd-row") ?? false),
    model: { defaults: { name: "Vitrines lado a lado", droppable: '[data-os-widget="products"]' } },
  });

  dc.addType(PRODUCT_TYPE, {
    isComponent: (node) => node.tagName === "A" && (node.hasAttribute?.(PRODUCT_ATTR) ?? false),
    model: {
      defaults: {
        tagName: "a",
        name: "Produto",
        droppable: false,
        draggable: "[data-os-pd-track]",
        traits: PRODUCT_TRAITS,
      },
      init(this: Component) {
        watchProductData(this);
      },
      // Nas camadas: "Produto · Air fryer 4 litros".
      getName(this: Component) {
        const custom = this.get("custom-name");
        if (custom) return String(custom);
        const name = nameText(this);
        return name ? `Produto · ${name.length > 40 ? `${name.slice(0, 39).trimEnd()}…` : name}` : "Produto";
      },
    },
    view: {
      init(this: { model: Component; el: HTMLElement; listenTo: (o: unknown, e: string, f: () => void) => void }) {
        // O GrapesJS refaz os atributos do elemento a cada mudança: a marca de "sem destino" volta.
        this.listenTo(this.model, "change:attributes", () => paintCard(this.model, this.el));
      },
      onRender({ el, model }: { el: HTMLElement; model: Component }) {
        el.addEventListener("click", preventLink, true);
        paintCard(model, el);
      },
    },
  });

  // Nome do produto: o h3 do cartão ou o h1 da caixa de compra (página do produto).
  dc.addType(PRODUCT_NAME_TYPE, {
    extend: "text",
    isComponent: (node) =>
      (node.tagName === "H3" &&
        (node.classList?.contains("os-pd-name") ?? false) &&
        !!node.parentElement?.classList.contains("os-pd-body")) ||
      (node.tagName === "H1" &&
        (node.classList?.contains("os-pb-name") ?? false) &&
        node.parentElement?.getAttribute("data-os-widget") === "product-buy"),
    model: { defaults: { name: "Nome do produto", draggable: false, removable: false, copyable: false } },
  });

  dc.addType(PRODUCT_IMG_TYPE, {
    extend: "image",
    isComponent: (node) => node.tagName === "IMG" && (node.classList?.contains("os-pd-img") ?? false),
    model: { defaults: { name: "Foto do produto", draggable: false, removable: false, copyable: false } },
  });

  // Partes geradas: os filhos salvos são ignorados ao abrir (o HTML vem dos atributos).
  dc.addType(PRODUCT_PART_TYPE, {
    isComponent: (node) =>
      isProductPart(node.getAttribute?.(PART_ATTR)) ? { type: PRODUCT_PART_TYPE, components: [] } : false,
    model: {
      defaults: {
        name: "Dados do produto",
        ...FIXED,
        editable: false,
        layerable: false,
        delegate: { select: (c: Component) => productHostOf(c) ?? c },
      },
      getInnerHTML(this: Component) {
        return partHtml(this);
      },
    },
    view: {
      onRender({ el, model }: { el: HTMLElement; model: Component }) {
        el.innerHTML = partHtml(model);
      },
    },
  });
}
