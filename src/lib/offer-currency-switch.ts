/**
 * Trocar a moeda da oferta troca tudo o que tem preço nela (serviço em
 * src/server/services/offer-currency.ts). Aqui, as regras dos documentos das
 * páginas, sem banco (servidor: usa o cheerio):
 *
 * - cada vitrine (data-os-widget="products") e caixa de compra
 *   (data-os-widget="product-buy") ganha a moeda nova em data-os-currency, no
 *   HTML salvo e no projeto do editor (JSON); no HTML, as partes geradas
 *   (preço, parcelas, avaliação, estoque…) e o nome das setas do carrossel são
 *   refeitos com productPartHtml/navLabelHtml — o mesmo que o editor desenha ao
 *   abrir. O idioma das frases segue a moeda quando a vitrine não escolheu um
 *   (data-os-pd-lang); escolhido, fica;
 * - os NÚMEROS dos preços (data-os-pd-*) não mudam: não há conversão pela
 *   cotação, só a moeda;
 * - preço escrito como texto ("R$ 297" num parágrafo de um modelo ou de uma
 *   página clonada) não muda: textPricesIn só aponta onde ele está, para o
 *   diálogo avisar.
 *
 * Os tipos do plano (o que o diálogo de confirmação mostra) e do resultado
 * também ficam aqui (a tela importa só os tipos).
 */
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { navLabelHtml } from "@/editor/widgets/products-content";
import { restoreDoctype } from "@/lib/doctype";
import { walkProject } from "@/lib/find-replace";
import { formatAmount, type PaymentCurrencyId, type PaymentLocaleId, type PaymentMethodId } from "@/lib/payments/rules";
import {
  CURRENCY_ATTR,
  isProductPart,
  LANG_ATTR,
  PART_ATTR,
  PRODUCT_ATTR,
  productPartHtml,
  readProduct,
  type StoreCurrency,
  storeCurrency,
  storeLang,
} from "@/lib/store";
import type { ValueCurrency } from "@/lib/tracking/schema";

// ─── Tipos do plano e do resultado ───────────────────────────────────────────

/** Página com vitrines/caixas de compra que mudam de moeda. */
export interface CurrencyPlanPage {
  pageId: string;
  pageName: string;
  /** Vitrines que mudam (na cópia da página que mais tem). */
  showcases: number;
  /** Caixas de compra que mudam. */
  buyBoxes: number;
  /** As outras cópias da página que também mudam ("na versão B e no layout do celular"); null = só uma. */
  alsoIn: string | null;
}

/** Produto de vitrine ou caixa de compra: o preço com os mesmos números, antes e depois. */
export interface CurrencyPlanProduct {
  pageName: string;
  name: string;
  /** Preço na moeda de antes, no formato do painel ("R$ 129,90"); null = sem preço. */
  before: string | null;
  /** O mesmo número na moeda nova ("MX$ 129,90"). */
  after: string | null;
}

/** Como um produto do pagamento na página fica. */
export interface CurrencyPlanPaymentState {
  currency: PaymentCurrencyId;
  methods: PaymentMethodId[];
  locale: PaymentLocaleId;
  /** "MX$ 297,00" (pt-BR). */
  price: string;
}

export interface CurrencyPlanPayment {
  linkId: string;
  /** Nome do link da oferta ("Checkout principal"). */
  label: string;
  /** Nome do produto que o comprador vê. */
  productName: string;
  /** O link está em "Pagamento na página" (desligado = o produto fica guardado, o link leva ao endereço). */
  active: boolean;
  before: CurrencyPlanPaymentState;
  /** null = fica como está (já cobra nessa moeda, ou a Kyvo não cobra na moeda nova). */
  after: CurrencyPlanPaymentState | null;
  /** O valor não serve para as formas de pagamento depois da troca (texto pronto); null = serve. */
  problem: string | null;
}

/** Como um produto do checkout do Offer Studio fica (gateway e preço). */
export interface CurrencyPlanCheckoutState {
  /** "FlevoPay (PIX)", "Kyvo". */
  gateway: string;
  /** "R$ 297,00" (pt-BR). */
  price: string;
}

export interface CurrencyPlanCheckout {
  linkId: string;
  label: string;
  productName: string;
  /** O link está em "Checkout do Offer Studio" (desligado = o produto fica guardado). */
  active: boolean;
  before: CurrencyPlanCheckoutState;
  after: CurrencyPlanCheckoutState;
  /** O gateway mudou (o novo pode precisar da chave). */
  gatewayChanged: boolean;
  /** O valor (ou o maior total) não serve depois da troca (texto pronto); null = serve. */
  problem: string | null;
  /** Idioma dos textos do checkout que muda ("Português" → "Español"); null = fica o mesmo. */
  locale: { from: string; to: string } | null;
  /** Textos trocados no painel que ficam como estão, escritos para o idioma ou o pagamento de antes. */
  textsToReview: boolean;
}

export interface CurrencySwitchPlan {
  from: StoreCurrency;
  to: StoreCurrency;
  pages: CurrencyPlanPage[];
  /** Produtos das vitrines e caixas (até PLAN_PRODUCTS_MAX). */
  products: CurrencyPlanProduct[];
  /** Produtos que não couberam na lista. */
  moreProducts: number;
  payments: CurrencyPlanPayment[];
  /** A Kyvo não cobra na moeda nova (real): os produtos do pagamento na página ficam como estão. */
  paymentsKept: boolean;
  /** Produtos do checkout do Offer Studio que passam para a moeda nova. */
  checkouts: CurrencyPlanCheckout[];
  /**
   * "Valor da oferta" dos pixels (null = já está na moeda nova, ou a oferta não tem pixel ligado nem valor salvo).
   * `amount` em unidades (297.9), null = sem valor.
   */
  pixel: { from: ValueCurrency; to: ValueCurrency; amount: number | null } | null;
  /** Páginas com preço escrito como texto na moeda de antes (não muda). */
  textPrices: { pageId: string; pageName: string; examples: string[] }[];
  /** Cópias de página (versão A/B × computador/celular) que mudam: cada uma ganha um ponto no Histórico. */
  documents: number;
}

export interface CurrencySwitchResult {
  from: StoreCurrency;
  to: StoreCurrency;
  showcases: number;
  buyBoxes: number;
  /** Páginas com vitrine/caixa de compra que mudaram. */
  pages: number;
  /** Cópias de página gravadas (cada uma com o ponto no Histórico). */
  documents: number;
  /** Produtos do pagamento na página que mudaram de moeda. */
  payments: number;
  /** Produtos do pagamento na página que ficaram como estavam porque a Kyvo não cobra na moeda nova. */
  paymentsKept: number;
  /** Produtos cujo valor não serve depois da troca (nome do link + o problema). */
  paymentProblems: { linkId: string; label: string; problem: string }[];
  /** Produtos do checkout do Offer Studio que passaram para a moeda nova. */
  checkouts: number;
  /** Checkouts que trocaram de gateway (nome do link + o gateway novo). */
  checkoutGateways: { linkId: string; label: string; gateway: string }[];
  /** Checkouts com textos trocados escritos para o idioma ou o pagamento de antes (revisar). */
  checkoutTexts?: { linkId: string; label: string }[];
  /** A moeda do "Valor da oferta" dos pixels mudou (e a oferta tem pixel ligado ou valor salvo). */
  pixel: boolean;
  /** Páginas com preço escrito como texto (não muda). */
  textPricePages: number;
}

/**
 * Página com vitrines ou caixas de compra numa moeda diferente da moeda da
 * oferta (ex.: voltou pelo Histórico a um ponto de antes da troca, ou foi
 * gravada por um editor aberto antes dela).
 */
export interface CurrencyMismatchPage {
  pageId: string;
  pageName: string;
  /** Vitrines e caixas fora da moeda (na cópia da página que mais tem). */
  hosts: number;
  /** As moedas em que elas estão. */
  currencies: StoreCurrency[];
}

/** O que está fora da moeda escolhida da oferta (src/server/services/offer-currency.ts). */
export interface CurrencyMismatch {
  /** Moeda escolhida para a oferta. */
  currency: StoreCurrency;
  pages: CurrencyMismatchPage[];
}

/** Quantos produtos o diálogo lista (o resto vira "e mais N"). */
export const PLAN_PRODUCTS_MAX = 40;

// ─── Documentos ──────────────────────────────────────────────────────────────

const BUY_WIDGET = "product-buy";
/** Vitrines e caixas de compra (com ou sem o atributo da moeda). */
const HOSTS = `[${CURRENCY_ATTR}], [data-os-widget="products"], [data-os-widget="${BUY_WIDGET}"]`;
/** Dono dos dados de um produto: o cartão da vitrine ou a caixa de compra. */
const PRODUCT_HOSTS = `[${PRODUCT_ATTR}], [data-os-widget="${BUY_WIDGET}"]`;
/** Conteúdo inerte (código guardado, modelos): nada ali é uma vitrine de verdade. */
const INERT = "template, os-script, os-noscript, script, noscript, style";
/** Atalho antes de analisar o HTML: sem nenhuma marca de vitrine ou caixa, nada muda. */
const HOST_MARK_RE = /data-os-currency|data-os-widget\s*=\s*["']?(?:products|product-buy)\b/;
/**
 * O mesmo atalho no texto JSON do projeto do editor (atributos como
 * `"data-os-widget":"products"` e HTML guardado como texto, com as aspas
 * escapadas): sem marca, o projeto nem é lido.
 */
const PROJECT_MARK_RE = /data-os-currency|data-os-widget\W{1,6}(?:products|product-buy)\b/;

/** O HTML pode ter vitrine ou caixa de compra (sem a marca, com certeza não tem). */
export const hasHostMark = (html: string | null | undefined) => Boolean(html && HOST_MARK_RE.test(html));

/** O texto JSON do projeto do editor pode ter vitrine ou caixa de compra. */
export const projectHasHostMark = (json: string) => PROJECT_MARK_RE.test(json);

export type StoreHostKind = "products" | "product-buy";

/** Uma vitrine ou caixa de compra que muda de moeda. */
export interface HostChange {
  kind: StoreHostKind;
  from: StoreCurrency;
  products: { name: string; price: number | null }[];
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Troca a moeda das vitrines e caixas de compra de um HTML (documento inteiro
 * ou, com `fragment`, um pedaço guardado no projeto do editor) e refaz as
 * partes geradas delas. Sem nada a trocar, devolve o HTML original intacto.
 */
export function switchHtmlCurrency(
  html: string,
  to: StoreCurrency,
  opts: { fragment?: boolean } = {},
): { html: string; hosts: HostChange[] } {
  if (!html || !HOST_MARK_RE.test(html)) return { html, hosts: [] };
  const $ = opts.fragment ? cheerio.load(html, null, false) : cheerio.load(html);
  const changed: Element[] = [];
  const hosts: HostChange[] = [];
  $(HOSTS).each((_, el) => {
    const host = $(el);
    if (host.closest(INERT).length) return;
    // Já nessa moeda (sem o atributo, a vitrine é de real: storeCurrency, como o editor e a página leem).
    if (storeCurrency(host.attr(CURRENCY_ATTR)) === to) return;
    const kind: StoreHostKind = host.attr("data-os-widget") === BUY_WIDGET ? "product-buy" : "products";
    const from = storeCurrency(host.attr(CURRENCY_ATTR));
    host.attr(CURRENCY_ATTR, to);
    changed.push(el);
    hosts.push({ kind, from, products: productsOf($, el, kind) });
  });
  if (!changed.length) return { html, hosts: [] };
  for (const el of changed) redrawHost($, el, to);
  return { html: opts.fragment ? $.html() : restoreDoctype($.html(), html), hosts };
}

/**
 * Moeda de cada vitrine e caixa de compra de um HTML, na ordem da página (fora
 * do conteúdo inerte, como switchHtmlCurrency): o que confere se as páginas
 * estão na moeda da oferta.
 */
export function hostCurrencies(html: string | null | undefined): StoreCurrency[] {
  if (!html || !HOST_MARK_RE.test(html)) return [];
  const $ = cheerio.load(html);
  return $(HOSTS)
    .filter((_, el) => !$(el).closest(INERT).length)
    .map((_, el) => storeCurrency($(el).attr(CURRENCY_ATTR)))
    .get();
}

/** Produtos (nome e preço) de uma vitrine ou caixa de compra. */
function productsOf($: cheerio.CheerioAPI, el: Element, kind: StoreHostKind) {
  const host = $(el);
  if (kind === "product-buy") {
    return [{ name: clean(host.find(".os-pb-name").first().text()), price: readProduct(el.attribs).price }];
  }
  return host
    .find(`[${PRODUCT_ATTR}]`)
    .filter((_, card) => $(card).closest(`[${CURRENCY_ATTR}]`).get(0) === el)
    .map((_, card) => ({
      name: clean($(card).find(".os-pd-name").first().text()),
      price: readProduct((card as Element).attribs).price,
    }))
    .get();
}

/**
 * Refaz as partes geradas e o nome das setas de uma vitrine/caixa (as que
 * pertencem a ela: o elemento com a moeda mais próximo é ela — como o editor
 * acha a moeda de cada parte).
 */
function redrawHost($: cheerio.CheerioAPI, el: Element, currency: StoreCurrency) {
  const host = $(el);
  const lang = storeLang(host.attr(LANG_ATTR), currency);
  const owned = (node: AnyNode) => $(node).closest(`[${CURRENCY_ATTR}]`).get(0) === el;
  host.find(`[${PART_ATTR}]`).each((_, part) => {
    const name = $(part).attr(PART_ATTR);
    const product = $(part).closest(PRODUCT_HOSTS).get(0);
    if (!isProductPart(name) || !product || !owned(part)) return;
    $(part).html(productPartHtml(name, readProduct((product as Element).attribs), currency, lang));
  });
  host.find("button.os-pd-nav").each((_, nav) => {
    if (!owned(nav)) return;
    $(nav).html(navLabelHtml($(nav).hasClass("os-pd-prev") ? "prev" : "next", lang));
  });
}

type Json = Record<string, unknown>;
const isJson = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Troca a moeda das vitrines e caixas de compra no projeto do editor (JSON).
 * As partes geradas não precisam mudar: o editor as refaz a partir dos
 * atributos ao abrir. Pedaços de HTML guardados como texto no projeto passam
 * por switchHtmlCurrency. Não altera o objeto recebido; `count` = elementos
 * que mudaram (0 = devolve o projeto recebido).
 */
export function switchProjectCurrency(project: unknown, to: StoreCurrency): { project: unknown; count: number } {
  // Sem nada a trocar, nem copia o projeto (ofertas com dezenas de páginas clonadas grandes).
  if (!isJson(project) || !projectNeedsSwitch(project, to)) return { project, count: 0 };
  const copy = structuredClone(project);
  let count = 0;
  const jobs: { holder: Json | unknown[]; key: string | number; value: string }[] = [];
  walkProject(copy, {
    component(node) {
      if (!hostOutside(node.attributes, to)) return;
      (node.attributes as Json)[CURRENCY_ATTR] = to;
      count++;
    },
    html(holder, key, value) {
      jobs.push({ holder, key, value });
    },
  });
  for (const job of jobs) {
    const r = switchHtmlCurrency(job.value, to, { fragment: true });
    if (!r.hosts.length) continue;
    if (Array.isArray(job.holder)) job.holder[Number(job.key)] = r.html;
    else job.holder[String(job.key)] = r.html;
    count += r.hosts.length;
  }
  return count ? { project: copy, count } : { project, count: 0 };
}

/** Vitrine ou caixa de compra (atributos de um elemento do projeto) fora da moeda `to`. */
function hostOutside(attrs: unknown, to: StoreCurrency): boolean {
  if (!isJson(attrs)) return false;
  const widget = attrs["data-os-widget"];
  const isHost = attrs[CURRENCY_ATTR] !== undefined || widget === "products" || widget === BUY_WIDGET;
  return isHost && storeCurrency(attrs[CURRENCY_ATTR]) !== to;
}

/** O projeto tem algo a trocar (só lê: a cópia é feita depois, quando tem). */
function projectNeedsSwitch(project: Json, to: StoreCurrency): boolean {
  let needs = false;
  walkProject(project, {
    component(node) {
      if (!needs && hostOutside(node.attributes, to)) needs = true;
    },
    html(_holder, _key, value) {
      if (!needs && HOST_MARK_RE.test(value)) needs = true;
    },
  });
  return needs;
}

/** O que um documento (cópia de página) guarda e o que muda nele. */
export interface DocumentCurrencyChange {
  /** Projeto do editor trocado; null = o projeto não muda (ou não há). */
  project: unknown | null;
  html: string | null;
  editableHtml: string | null;
  /** Vitrines/caixas que mudam (as do HTML salvo; sem elas, as da cópia editável). */
  hosts: HostChange[];
  /** Algo muda (HTML, projeto ou a cópia editável da clonagem). */
  changed: boolean;
}

/**
 * Troca a moeda num documento inteiro: o HTML salvo, o projeto do editor e a
 * cópia editável da clonagem ("Com scripts": senão "Converter para editável"
 * voltaria à moeda antiga).
 */
export function switchDocumentCurrency(
  doc: { project: unknown | null; html: string | null; editableHtml: string | null },
  to: StoreCurrency,
): DocumentCurrencyChange {
  const html = doc.html ? switchHtmlCurrency(doc.html, to) : null;
  const project = doc.project !== null ? switchProjectCurrency(doc.project, to) : null;
  const editable = doc.editableHtml ? switchHtmlCurrency(doc.editableHtml, to) : null;
  return {
    project: project?.count ? project.project : null,
    html: html ? html.html : doc.html,
    editableHtml: editable ? editable.html : doc.editableHtml,
    hosts: html?.hosts.length ? html.hosts : (editable?.hosts ?? []),
    changed: Boolean(html?.hosts.length || project?.count || editable?.hosts.length),
  };
}

// ─── Preço escrito como texto ────────────────────────────────────────────────

/** Preço escrito com o símbolo de cada moeda ("R$ 297", "US$ 49", "29,90 €", "$497" / "MX$ 497"). */
const TEXT_PRICE_RE: Record<StoreCurrency, RegExp> = {
  BRL: /R\$\s?\d[\d.,]*/g,
  USD: /US\$\s?\d[\d.,]*|\bUSD\s?\d[\d.,]*|\d[\d.,]*\s?USD\b/g,
  EUR: /€\s?\d[\d.,]*|\d[\d.,]*\s?€|\bEUR\s?\d[\d.,]*|\d[\d.,]*\s?EUR\b/g,
  // "$" sozinho (não o de "R$" nem o de "US$") ou "MX$".
  MXN: /(?<![A-Za-z])(?:MX)?\$\s?\d[\d.,]*(?:\s?MXN\b)?|\bMXN\s?\d[\d.,]*|\d[\d.,]*\s?MXN\b/g,
};

/** Partes que não são texto escrito: código, cabeçalho e o que os widgets geram. */
const NOT_WRITTEN = `head, script, style, noscript, template, os-script, os-noscript, [${PART_ATTR}], button.os-pd-nav`;

/**
 * Preços escritos como texto visível na moeda `currency` (até `max`
 * exemplos, sem repetir): o que a troca da moeda NÃO muda. As partes geradas
 * das vitrines e caixas de compra não contam (essas mudam).
 */
export function textPricesIn(html: string | null, currency: StoreCurrency, max = 3): string[] {
  const re = TEXT_PRICE_RE[currency];
  re.lastIndex = 0;
  if (!html || !re.test(html)) return [];
  const $ = cheerio.load(html);
  $(NOT_WRITTEN).remove();
  const body = $("body");
  const text = (body.length ? body.text() : $.root().text()).replace(/\s+/g, " ");
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(re.source, "g"))) {
    const price = m[0]
      .replace(/[.,]+$/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!out.includes(price)) out.push(price);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Preço de um produto na moeda, no formato do painel ("R$ 129,90", "MX$ 129,90"):
 * o diálogo da troca usa um formato só — o da página ("$129.90") pareceria dólar
 * ao lado dos valores da Kyvo e dos pixels.
 */
export const planPrice = (cents: number | null, currency: StoreCurrency) =>
  cents === null ? null : formatAmount(cents, currency);
