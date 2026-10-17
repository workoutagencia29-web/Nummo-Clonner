/**
 * "Próximos passos" da oferta: o que falta para ela sair pronta no ZIP (botões
 * de compra com o seu checkout, prêmios da roleta com o checkout do desconto,
 * produtos da vitrine com a página do produto, dados da empresa nas páginas
 * legais, pixel, ZIP baixado e o endereço onde está no ar). Regras puras, sem
 * banco: o servidor junta os dados (src/server/services/readiness.ts).
 */
import {
  type CheckoutCheck,
  checkoutIssues,
  checkoutProductMissing,
  shippingIssueText,
  textsIssueText,
} from "@/lib/checkout/checks";
import { deadLegalLinks } from "@/lib/export/legal-links";
import { OFFER_CURRENCY_NAME } from "@/lib/offer-currency";
import type { CurrencyMismatch } from "@/lib/offer-currency-switch";
import { COMPANY_PLACEHOLDERS, type Company } from "@/lib/offer-settings";
import { type PaymentCheck, paymentIssues } from "@/lib/payments/checks";
import { type PaymentProviderId, PROVIDER_LABEL } from "@/lib/payments/rules";
import { PRODUCT_ATTR, type StoreCurrency } from "@/lib/store";
import {
  type Catalog,
  categoryGaps,
  gapCount,
  mergeProductGaps,
  PRODUCT_MARK,
  type ProductGap,
  productGaps,
  STORE_HEADER_MARK,
  storeCatalog,
} from "@/lib/store-pages";
import { displayUrl } from "@/lib/text";
import { ownCheckoutCoupons, ownCheckoutPrizes, prizeGaps, WHEEL_MARK, wheelPrizeKeys } from "@/lib/wheel-prizes";

export type ReadinessId =
  | "checkout"
  | "roleta"
  | "roleta-cupom"
  | "produtos"
  | "moeda-vitrines"
  | "pagamento"
  | "moeda-pagamento"
  | "checkout-proprio"
  | "empresa"
  | "links-legais"
  | "idioma"
  | "pixel"
  | "zip"
  | "no-ar";

/**
 * Para onde o passo leva: uma aba da oferta, o diálogo do ZIP, uma página no
 * editor, um link da oferta (aba "Links e checkouts", aberto nele), a conta
 * do gateway de pagamento da oferta (cartão na aba "Links e checkouts") ou um
 * campo da aba "Moeda, empresa e SEO" (rolada até ele, com ele em foco): o
 * idioma das páginas ou o cartão "Moeda da oferta".
 */
export type ReadinessTarget =
  | { tab: "links" | "rastreamento" | "configuracoes" | "detalhes" }
  | { export: true }
  | { editor: string }
  | { link: string }
  /** Cartão da conta do gateway (sem `provider`: o da Kyvo). */
  | { paymentAccount: true; provider?: PaymentProviderId }
  | { setting: "idioma" | "moeda" };

export interface ReadinessItem {
  id: ReadinessId;
  title: string;
  detail: string;
  done: boolean;
  /** Recomendado, mas a oferta funciona sem ele. */
  optional: boolean;
  /** Rótulo do botão do passo. */
  cta: string;
  target: ReadinessTarget;
}

export interface Readiness {
  items: ReadinessItem[];
  /** Passos obrigatórios concluídos / total de passos obrigatórios. */
  done: number;
  total: number;
  /** Todos os obrigatórios prontos (o cartão some). */
  complete: boolean;
}

export interface ReadinessInput {
  /** HTML de todos os documentos das páginas (todas as versões A/B e o celular). */
  htmls: string[];
  /**
   * Documentos com roleta de desconto (id e HTML), para o passo "roleta" abrir
   * a página certa no editor. Sem ele, o passo usa só `htmls` e leva aos links.
   */
  wheelDocs?: { id: string; html: string }[];
  /**
   * Documentos com vitrine de produtos ou cabeçalho de loja (id, página e
   * HTML), para o passo "produtos" abrir a página certa no editor, contar cada
   * página uma vez (versões A/B e celular repetem os cartões) e conferir as
   * categorias do cabeçalho na página da loja. Sem ele, usa só `htmls`.
   */
  productDocs?: { id: string; pageId: string; html: string }[];
  /**
   * Links da oferta (checkout, upsell…). kind (CHECKOUT, UPSELL…): só os
   * botões ligados a um link do tipo checkout levam o prêmio da roleta. id:
   * o passo do checkout da página clonada abre o link ("Abrir o link").
   * target PAYMENT: o endereço guardado não vai para a página. `checkout`
   * (só com target CHECKOUT): o produto do checkout do Offer Studio — vazio =
   * ainda não salvo; ausente = não informado (conta como salvo).
   */
  links: {
    id?: string;
    key: string;
    url: string;
    label?: string;
    kind?: string | null;
    pay?: boolean;
    target?: string;
    checkout?: unknown;
  }[];
  /** Endereços de checkout encontrados na página original ao clonar. */
  clonedCheckoutUrls: string[];
  /** Pixels ligados. */
  pixelCount: number;
  company: Company;
  liveUrl: string | null;
  /** Data do último ZIP pronto (null = nunca). */
  lastZipAt: Date | null;
  /** Pagamento na página (offerPaymentCheck; null/ausente = a oferta não tem). */
  payments?: PaymentCheck | null;
  /** Checkout do Offer Studio (offerCheckoutCheck; null/ausente = a oferta não tem). */
  checkouts?: CheckoutCheck | null;
  /**
   * Documentos das páginas na ordem do funil (versão de controle e computador
   * primeiro), sem os das páginas "Com scripts" (lá um script da página pode
   * cuidar do clique): o passo dos links de Política, Termos e Contato sem
   * destino. Sem ele, o passo não aparece.
   */
  pageDocs?: { id: string; pageId: string; pageName: string; html: string }[];
  /** Moeda em que a oferta roda (Offer.settings.currency; sem: o passo do idioma não aparece). */
  currency?: StoreCurrency;
  /**
   * Moeda ESCOLHIDA para a oferta (chosenOfferCurrency; null/ausente = oferta
   * de antes da pergunta, em que o real é só o padrão): o passo da moeda do
   * pagamento na página só aparece com ela.
   */
  chosenCurrency?: StoreCurrency | null;
  /** "Idioma das páginas" escolhido (Offer.settings.language; "" = igual à página). */
  language?: string;
  /**
   * Vitrines e caixas de compra fora da moeda escolhida da oferta
   * (storeCurrencyMismatch; null/ausente = tudo nela, ou oferta sem moeda
   * escolhida): o passo "moeda-vitrines".
   */
  currencyMismatch?: CurrencyMismatch | null;
}

const LINK_RE = /\bdata-os-link\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]*))/gi;
/** Uma tag de abertura inteira (atributos com aspas podem ter ">"). */
const TAG_RE = /<[a-z][a-z0-9-]*(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*\s*\/?>/gi;
const NEXT_PAGE_RE = /\sdata-os-(qz|wh)-go[\s=/>]/i;
const PRODUCT_RE = new RegExp(`\\s${PRODUCT_ATTR}[\\s=/>]`, "i");
/** Abertura do cabeçalho de loja e as partes dele que ligam/desligam ("Entre" nasce desligado). */
const STORE_HEADER_RE = /\sdata-os-widget\s*=\s*["']?store-header\b/i;
const CART_OFF_RE = /\sdata-os-sh-cart\s*=\s*["']?0\b/i;
const ACCOUNT_ON_RE = /\sdata-os-sh-account\s*=\s*["']?1\b/i;
const hasClass = (tag: string, cls: string) =>
  new RegExp(`\\sclass\\s*=\\s*(?:"[^"]*|'[^']*|)\\b${cls}\\b`, "i").test(tag);

/**
 * Valores de data-os-link das páginas. O botão final do quiz (data-os-qz-go) e
 * o "Resgatar" da roleta (data-os-wh-go) não são botões de compra: levam à
 * próxima página do funil (a falta de destino deles é avisada no ZIP e no
 * canvas, com o texto do quiz/roleta). Cartões da vitrine de produtos
 * (`product`) só contam quando ligados a um link da oferta que existe (o
 * destino normal deles é a página do produto: passo "produtos"). Carrinho e
 * "Entre" de um cabeçalho de loja com a parte desligada não vão ao ar: não
 * contam (o carrinho e o "Entre" só existem dentro do cabeçalho, logo depois
 * da abertura dele).
 */
function linkKeys(html: string): { key: string; product: boolean }[] {
  if (!html.includes("data-os-link")) return [];
  const key = (m: RegExpMatchArray) => (m[1] ?? m[2] ?? m[3] ?? "").trim();
  if (
    !html.includes("data-os-qz-go") &&
    !html.includes("data-os-wh-go") &&
    !html.includes(PRODUCT_ATTR) &&
    !html.includes("store-header")
  )
    return Array.from(html.matchAll(LINK_RE), (m) => ({ key: key(m), product: false }));
  const keys: { key: string; product: boolean }[] = [];
  let cartOff = false;
  let accountOff = false;
  for (const [tag] of html.matchAll(TAG_RE)) {
    if (STORE_HEADER_RE.test(tag)) {
      cartOff = CART_OFF_RE.test(tag);
      accountOff = !ACCOUNT_ON_RE.test(tag);
    }
    if (!tag.includes("data-os-link") || NEXT_PAGE_RE.test(tag)) continue;
    if ((cartOff && hasClass(tag, "os-sh-cart")) || (accountOff && hasClass(tag, "os-sh-acc"))) continue;
    const product = PRODUCT_RE.test(tag);
    for (const m of tag.matchAll(LINK_RE)) keys.push({ key: key(m), product });
  }
  return keys;
}

/**
 * Chaves de links da oferta nos botões que recebem o prêmio da roleta: os
 * botões de compra e o "Resgatar" (ligado a um checkout, ele leva ao checkout
 * do prêmio). O botão final do quiz fica de fora.
 */
function prizeButtonKeys(html: string): string[] {
  if (!html.includes("data-os-link")) return [];
  const keys: string[] = [];
  for (const [tag] of html.matchAll(TAG_RE)) {
    if (!tag.includes("data-os-link") || /\sdata-os-qz-go[\s=/>]/i.test(tag)) continue;
    for (const m of tag.matchAll(LINK_RE)) keys.push((m[1] ?? m[2] ?? m[3] ?? "").trim());
  }
  return keys;
}

/**
 * O link leva a algum lugar, como no render (renderLinks): endereço preenchido
 * com o destino "Endereço" ou pagamento na página (produto salvo). O endereço
 * guardado num link de pagamento ou de checkout do Offer Studio não vale: ele
 * nunca vai para a página.
 */
const hasDestination = (l: { url: string; pay?: boolean; target?: string }) =>
  Boolean(l.pay) || (((l.target ?? "URL") === "URL" || l.target === "CHECKOUT") && Boolean(l.url.trim()));

/** "Checkout do Offer Studio" com o produto salvo (sem a informação do produto, conta como salvo). */
const ownCheckoutSaved = (l: ReadinessInput["links"][number]) =>
  l.target === "CHECKOUT" && (!("checkout" in l) || Boolean(l.checkout));

/**
 * Links como a página os usa: o endereço guardado só fica com o destino
 * "Endereço" (o de antes de virar pagamento na página ou checkout do Offer
 * Studio não vale para nenhum passo — botões, roleta, produtos). O "Checkout
 * do Offer Studio" com o produto salvo leva à página de checkout (na prévia e
 * no ZIP): ganha o endereço dela, como no render.
 */
function renderedLinks(links: ReadinessInput["links"]): ReadinessInput["links"] {
  return links.map((l) =>
    (l.target ?? "URL") === "URL"
      ? l
      : ownCheckoutSaved(l)
        ? { ...l, url: `./checkout/${l.key}/`, checkout: l.checkout ?? true }
        : { ...l, url: "" },
  );
}

/** Botões ligados a links da oferta: quantos existem e quantos levam a algum lugar. */
export function buyButtons(htmls: string[], links: { key: string; url: string; pay?: boolean; target?: string }[]) {
  const withUrl = new Set(links.filter(hasDestination).map((l) => l.key));
  const known = new Set(links.map((l) => l.key));
  let total = 0;
  let connected = 0;
  for (const html of htmls) {
    for (const { key, product } of linkKeys(html)) {
      if (product && !known.has(key)) continue;
      total++;
      if (key && withUrl.has(key)) connected++;
    }
  }
  return { total, connected };
}

const COMPANY_FIELD_LABEL: Record<string, string> = {
  "{{EMPRESA}}": "nome",
  "{{CNPJ}}": "CNPJ/CPF",
  "{{EMAIL}}": "e-mail",
};

/** Marcadores obrigatórios da empresa ({{EMPRESA}}, {{CNPJ}}, {{EMAIL}}) usados nas páginas e ainda sem dado. */
export function missingCompanyFields(htmls: string[], company: Company) {
  const used = Object.keys(COMPANY_FIELD_LABEL).filter((marker) => htmls.some((h) => h.includes(marker)));
  const missing = used.filter((marker) => !COMPANY_PLACEHOLDERS[marker](company).trim());
  return { used: used.length > 0, missing: missing.map((m) => COMPANY_FIELD_LABEL[m]) };
}

function listPt(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
}

function normalizeUrl(url: string) {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Links da oferta que ainda levam ao checkout encontrado na página original ao
 * clonar (CheckoutLink): o mesmo endereço, sem diferenciar maiúsculas nem a
 * barra no fim. Pagamento na página nunca conta (o endereço guardado dele não
 * vai para a página). Usado no "Próximos passos", no aviso do ZIP e no selo da
 * aba "Links e checkouts".
 */
export function clonedCheckoutLinks<T extends { url: string; pay?: boolean; target?: string }>(
  links: readonly T[],
  clonedUrls: readonly string[],
): T[] {
  const cloned = new Set(clonedUrls.map(normalizeUrl).filter(Boolean));
  if (!cloned.size) return [];
  return links.filter(
    (l) => !l.pay && (l.target ?? "URL") === "URL" && l.url.trim() && cloned.has(normalizeUrl(l.url)),
  );
}

function checkoutItem(input: ReadinessInput): ReadinessItem {
  const base = { id: "checkout", cta: "Abrir links", target: { tab: "links" } } as const;
  const { total, connected } = buyButtons(input.htmls, input.links);
  if (total > connected) {
    const missing = total - connected;
    // Botões ligados a um "Checkout do Offer Studio" sem o checkout salvo não levam a lugar nenhum.
    const usedKeys = new Set(input.htmls.flatMap((h) => linkKeys(h).map(({ key }) => key)));
    const unsaved = input.links.filter(
      (l) => l.target === "CHECKOUT" && usedKeys.has(l.key) && "checkout" in l && !l.checkout,
    );
    const names = listPt(unsaved.map((l) => (l.label ? `“${l.label}”` : "um link")));
    return {
      ...base,
      ...(unsaved.length === 1 && unsaved[0].id ? { cta: "Abrir o link", target: { link: unsaved[0].id } } : {}),
      title: "Ligar os botões de compra",
      detail: `${missing === 1 ? "1 botão" : `${missing} de ${total} botões`} de compra ainda sem link: no ZIP, ${
        missing === 1 ? "ele não leva" : "eles não levam"
      } a lugar nenhum. Cadastre o checkout e ligue os botões no editor.${
        unsaved.length
          ? ` O checkout do Offer Studio de ${names} ainda não foi salvo: monte-o em “Links e checkouts” (sem ele, os botões ligados não levam a lugar nenhum nem na prévia).`
          : ""
      }`,
      done: false,
      optional: false,
    };
  }
  const original = clonedCheckoutLinks(input.links, input.clonedCheckoutUrls);
  if (original.length) {
    // Abre o (primeiro) link na aba "Links e checkouts", rolado até ele e com o selo.
    const first = original[0].id;
    return {
      ...base,
      ...(first ? { cta: "Abrir o link", target: { link: first } } : {}),
      title: "Trocar o checkout da página original",
      detail: `${
        original.length === 1 ? "1 link ainda leva" : `${original.length} links ainda levam`
      } ao checkout da página que você clonou: quem clicar compra do dono dela. Coloque o endereço do seu checkout.`,
      done: false,
      optional: false,
    };
  }
  if (total > 0) {
    return {
      ...base,
      title: "Checkout ligado",
      detail:
        total === 1
          ? "O botão de compra leva ao seu checkout."
          : `Os ${total} botões de compra levam aos links da oferta.`,
      done: true,
      optional: false,
    };
  }
  const withUrl = input.links.filter(hasDestination).length;
  return {
    ...base,
    title: withUrl ? "Links da oferta cadastrados" : "Cadastrar o checkout",
    detail: withUrl
      ? "Para trocar o checkout em todas as páginas de uma vez, ligue os botões de compra a um link no editor."
      : "Nenhum botão de compra está ligado a um link da oferta. Cadastre o checkout e ligue os botões a ele no editor.",
    done: withUrl > 0,
    optional: true,
  };
}

/** Roleta de desconto: cada prêmio com o seu checkout (null = a oferta não tem roleta). */
function wheelItem(input: ReadinessInput): ReadinessItem | null {
  const docs = input.wheelDocs ?? input.htmls.map((html) => ({ id: "", html }));
  const withWheel = docs.filter((d) => d.html.includes(WHEEL_MARK));
  if (!withWheel.length) return null;
  let target: ReadinessTarget = withWheel[0].id ? { editor: withWheel[0].id } : { tab: "links" };
  const missing: string[] = [];
  // Prêmios ligados a um "Checkout do Offer Studio" com o produto salvo levam à página de checkout
  // (prévia e ZIP). Sem o produto salvo, não levam a lugar nenhum: é falta.
  const ownKeys = new Set(input.links.filter(ownCheckoutSaved).map((l) => l.key));
  const unsavedLinks = input.links.filter((l) => l.target === "CHECKOUT" && !ownCheckoutSaved(l));
  const unsavedKeys = new Set(unsavedLinks.map((l) => l.key));
  const prizeLinks = input.links.map((l) => ({ ...l, checkout: ownKeys.has(l.key) }));
  // Prêmios cujo link é um checkout do Offer Studio ainda sem o produto salvo.
  const unsavedPrizes = new Set(
    withWheel.flatMap((d) =>
      ownCheckoutPrizes(
        d.html,
        input.links.map((l) => ({ ...l, checkout: unsavedKeys.has(l.key) })),
      ),
    ),
  );
  const usedUnsaved = unsavedLinks.filter((l) => withWheel.some((d) => wheelPrizeKeys(d.html).includes(l.key)));
  // Todos os prêmios que faltam já têm o link da oferta, só sem endereço: o passo leva à aba dos links.
  let onlyUrls = true;
  for (const doc of withWheel) {
    const gaps = prizeGaps(doc.html, prizeLinks);
    if (gaps.length && !missing.length && doc.id) target = { editor: doc.id };
    for (const g of gaps) {
      if (!missing.includes(g.text)) missing.push(g.text);
      onlyUrls &&= g.linked;
    }
  }
  if (missing.length && onlyUrls) target = { tab: "links" };
  // Só falta montar o checkout do Offer Studio dos prêmios: o passo abre o link (um só) ou a aba.
  const onlyUnsaved = missing.length > 0 && missing.every((t) => unsavedPrizes.has(t));
  if (onlyUnsaved)
    target = usedUnsaved.length === 1 && usedUnsaved[0].id ? { link: usedUnsaved[0].id } : { tab: "links" };
  const cta = "editor" in target ? "Abrir no editor" : "link" in target ? "Abrir o link" : "Abrir links";
  if (missing.length) {
    const names = missing.map((t) => `“${t}”`);
    const which = names.length > 3 ? `${names.slice(0, 3).join(", ")} e mais ${names.length - 3}` : listPt(names);
    const unsavedNames = listPt(usedUnsaved.map((l) => (l.label ? `“${l.label}”` : "um link")));
    const unsavedFix = usedUnsaved.length
      ? `O checkout do Offer Studio de ${unsavedNames} ainda não foi salvo: monte-o em “Links e checkouts” (sem ele, o prêmio não leva a lugar nenhum nem na prévia).`
      : "";
    const fix = onlyUnsaved
      ? unsavedFix
      : `${
          onlyUrls
            ? "Cole o endereço do checkout de cada prêmio em Links e checkouts."
            : "Na roleta, escolha o checkout de cada prêmio em Configurações → Fatias."
        }${unsavedFix ? ` ${unsavedFix}` : ""}`;
    return {
      id: "roleta",
      title: "Roleta com prêmio sem link de checkout",
      detail: `${missing.length === 1 ? `O prêmio ${which} ainda não leva` : `Os prêmios ${which} ainda não levam`} ao checkout com o desconto: quem ganhar não recebe o desconto. ${fix}`,
      done: false,
      optional: false,
      cta,
      target,
    };
  }
  // A página de vendas só troca os botões ligados a um link do tipo checkout:
  // sem nenhum, quem ganha vê o prêmio e paga o preço cheio. Botão ligado a um
  // "Checkout do Offer Studio" também troca.
  if (input.links.some((l) => l.kind !== undefined)) {
    const checkouts = new Set(
      input.links.filter((l) => l.kind === "CHECKOUT" && (hasDestination(l) || ownKeys.has(l.key))).map((l) => l.key),
    );
    const swaps = input.htmls.some((h) => prizeButtonKeys(h).some((k) => checkouts.has(k)));
    if (!swaps) {
      // Botões ainda sem link: o passo "Ligar os botões de compra" já pede; aqui só o porquê.
      const { total, connected } = buyButtons(input.htmls, input.links);
      const fix =
        total > connected
          ? "Ligue os botões de compra (passo acima) a um link do tipo Checkout: só esses levam ao checkout do prêmio."
          : "No editor da página de vendas, ligue os botões de compra a um link do tipo Checkout (ou mude o tipo do link para Checkout em Links e checkouts).";
      return {
        id: "roleta",
        title: "Levar o prêmio da roleta aos botões de compra",
        detail: `Nenhum botão de compra está ligado a um link de checkout da oferta: quem ganhar vê o prêmio, mas paga o preço cheio. ${fix}`,
        done: false,
        optional: false,
        cta: "Abrir links",
        target: { tab: "links" },
      };
    }
  }
  return {
    id: "roleta",
    title: "Prêmios da roleta ligados",
    detail:
      "Cada prêmio leva ao checkout com o desconto, e a página de vendas troca os botões de compra para quem ganhou.",
    done: true,
    optional: false,
    cta,
    target,
  };
}

/**
 * Prêmio da roleta com cupom que leva a um "Checkout do Offer Studio": a
 * página de checkout não tem campo de cupom (quem ganha paga o valor do
 * checkout do prêmio). Opcional; null = não se aplica.
 */
function wheelCouponItem(input: ReadinessInput): ReadinessItem | null {
  const docs = input.wheelDocs ?? input.htmls.map((html) => ({ id: "", html }));
  const withWheel = docs.filter((d) => d.html.includes(WHEEL_MARK));
  if (!withWheel.length) return null;
  const ownKeys = input.links.filter(ownCheckoutSaved).map((l) => l.key);
  if (!ownKeys.length) return null;
  const coupons = [...new Set(withWheel.flatMap((d) => ownCheckoutCoupons(d.html, ownKeys)))];
  if (!coupons.length) return null;
  const doc = withWheel.find((d) => d.id && ownCheckoutCoupons(d.html, ownKeys).length);
  const one = coupons.length === 1;
  return {
    id: "roleta-cupom",
    title: "Cupom em prêmio do checkout do Offer Studio",
    detail: `${one ? "O prêmio" : "Os prêmios"} ${quotedList(coupons)} ${one ? "tem cupom e leva" : "têm cupom e levam"} a um link “Checkout do Offer Studio”, que não tem campo de cupom: quem ganhar paga o valor do checkout. Ponha o valor já com o desconto no checkout do prêmio e apague o cupom na roleta (Configurações → Fatias).`,
    done: false,
    optional: true,
    cta: doc ? "Abrir no editor" : "Abrir links",
    target: doc ? { editor: doc.id } : { tab: "links" },
  };
}

/** "“Casa”", "“Casa” e “Moda”", "“Casa”, “Moda” e mais 2". */
function quotedList(items: string[]) {
  const q = items.map((t) => `“${t}”`);
  if (q.length > 3) return `${q.slice(0, 2).join(", ")} e mais ${q.length - 2}`;
  return q.length > 1 ? `${q.slice(0, -1).join(", ")} e ${q[q.length - 1]}` : q[0];
}

/**
 * Loja: cada produto da vitrine leva à página dele, o "Ver todas" ligado leva a
 * algum lugar e cada categoria do cabeçalho sem destino mostra algum produto
 * (null = a oferta não tem vitrine nem cabeçalho de loja).
 */
function productsItem(input: ReadinessInput): ReadinessItem | null {
  const docs = input.productDocs ?? input.htmls.map((html, i) => ({ id: "", pageId: String(i), html }));
  const withStore = docs.filter((d) => d.html.includes(PRODUCT_MARK) || d.html.includes(STORE_HEADER_MARK));
  if (!withStore.length) return null;
  // Catálogo de cada página (uma entrada por versão): a página da loja das categorias.
  const catalogs = new Map<string, Catalog[]>();
  for (const doc of withStore) {
    const catalog = storeCatalog(doc.html);
    if (catalog) catalogs.set(doc.pageId, [...(catalogs.get(doc.pageId) ?? []), catalog]);
  }
  const catalogsOf = (pageId: string) => catalogs.get(pageId) ?? [];
  // Por página: a mesma vitrine em outra versão A/B ou no celular conta uma vez.
  const byPage = new Map<string, { id: string; gaps: ProductGap[]; cats: string[] }>();
  for (const doc of withStore) {
    const gaps = productGaps(doc.html, input.links);
    const cats = categoryGaps(doc.html, input.links, catalogsOf);
    const page = byPage.get(doc.pageId);
    if (!page) byPage.set(doc.pageId, { id: doc.id, gaps, cats });
    else {
      if ((gaps.length || cats.length) && !page.gaps.length && !page.cats.length) page.id = doc.id;
      mergeProductGaps(page.gaps, gaps);
      for (const c of cats) if (!page.cats.includes(c)) page.cats.push(c);
    }
  }
  const pages = [...byPage.values()];
  const cards = pages.filter((p) => gapCount(p.gaps) > 0);
  const mores = pages.filter((p) => p.gaps.some((g) => g.more));
  const lost = pages.filter((p) => p.cats.length);
  const open = (cards[0] ?? mores[0] ?? lost[0] ?? pages[0]).id;
  const target: ReadinessTarget = open ? { editor: open } : { tab: "links" };
  const base = { id: "produtos", optional: false, cta: open ? "Abrir no editor" : "Abrir links", target } as const;
  if (cards.length) {
    const total = cards.reduce((n, p) => n + gapCount(p.gaps), 0);
    const products = total === 1 ? "1 produto" : `${total} produtos`;
    const withCards = cards.length === 1 ? cards[0].gaps.filter((g) => g.count > 0) : [];
    const title = withCards.length === 1 ? withCards[0].showcase : "";
    const where = title ? ` da vitrine “${title}”` : cards.length > 1 ? ` das vitrines de ${cards.length} páginas` : "";
    return {
      ...base,
      title: "Escolher a página de cada produto",
      detail: `${products}${where} ainda ${total === 1 ? "não leva" : "não levam"} a lugar nenhum: no editor, use “Criar as páginas que faltam”, nas Configurações da vitrine (ou clique no produto e escolha a página dele).`,
      done: false,
    };
  }
  if (mores.length) {
    const titles = mores.flatMap((p) => p.gaps.filter((g) => g.more).map((g) => g.showcase || "sem título"));
    return {
      ...base,
      title: "Escolher para onde vai o “Ver todas”",
      detail: `${titles.length === 1 ? "O “Ver todas” da vitrine" : "Os “Ver todas” das vitrines"} ${quotedList(titles)} ainda ${titles.length === 1 ? "não leva" : "não levam"} a lugar nenhum: no editor, clique nele e escolha o destino em Configurações (ou desligue o “Ver todas” na vitrine).`,
      done: false,
    };
  }
  if (lost.length) {
    const cats = [...new Set(lost.flatMap((p) => p.cats))];
    return {
      ...base,
      title: "Ajustar as categorias do cabeçalho",
      detail: `${cats.length === 1 ? "A categoria" : "As categorias"} ${quotedList(cats)} não ${cats.length === 1 ? "mostra" : "mostram"} nenhum produto: no editor, clique na categoria e escolha para onde ela leva em Configurações (ou troque o texto por uma palavra do nome dos produtos).`,
      done: false,
    };
  }
  const anyCards = withStore.some((d) => d.html.includes(PRODUCT_MARK));
  return {
    ...base,
    title: anyCards ? "Produtos da vitrine ligados" : "Cabeçalho de loja ligado",
    detail: anyCards
      ? "Cada produto da vitrine leva à página dele."
      : "As categorias do cabeçalho levam a algum lugar ou mostram produtos.",
    done: true,
  };
}

/**
 * Vitrines e caixas de compra numa moeda diferente da moeda escolhida da
 * oferta: a página voltou pelo Histórico a um ponto de antes da troca da
 * moeda, ou foi gravada por um editor aberto antes dela (null = tudo na moeda
 * da oferta). O conserto é o "Passar tudo para …" do cartão "Moeda da oferta".
 */
function storeCurrencyItem(input: ReadinessInput): ReadinessItem | null {
  const mismatch = input.currencyMismatch;
  if (!mismatch?.pages.length) return null;
  const name = OFFER_CURRENCY_NAME[mismatch.currency];
  const pages = mismatch.pages.map((p) => p.pageName);
  const total = mismatch.pages.reduce((n, p) => n + p.hosts, 0);
  const from = listPt([...new Set(mismatch.pages.flatMap((p) => p.currencies))].map((c) => OFFER_CURRENCY_NAME[c]));
  const where = pages.length === 1 ? `da página ${quotedList(pages)}` : `das páginas ${quotedList(pages)}`;
  const what = total === 1 ? "A vitrine (ou caixa de compra)" : "As vitrines e caixas de compra";
  return {
    id: "moeda-vitrines",
    title: `Passar as vitrines para ${name}`,
    detail: `${what} ${where} ainda ${total === 1 ? "mostra" : "mostram"} os preços em ${from}, mas a oferta roda em ${name}. Acontece quando uma página volta pelo Histórico a um ponto de antes da troca da moeda, ou é gravada por um editor aberto antes dela. No cartão “Moeda da oferta”, use “Passar tudo para ${name}”.`,
    done: false,
    optional: false,
    cta: "Abrir a moeda da oferta",
    target: { setting: "moeda" },
  };
}

/** Pagamento na página: chave, página de obrigado com o acesso, link de acesso (null = a oferta não tem). */
function paymentItem(input: ReadinessInput): ReadinessItem | null {
  const check = input.payments;
  if (!check?.products.length) return null;
  const provider = PROVIDER_LABEL[check.provider];
  const base = { id: "pagamento", optional: false } as const;
  // A regra de Purchase repetida é aviso do ZIP (não impede a venda).
  const issues = paymentIssues(check).filter((i) => i.kind !== "doublePurchase");
  const more = issues.length - 1;
  const withMore = (item: ReadinessItem): ReadinessItem =>
    more > 0
      ? {
          ...item,
          detail: `${item.detail} Depois, ${more === 1 ? "falta mais 1 ajuste" : `faltam mais ${more} ajustes`} no pagamento.`,
        }
      : item;
  for (const issue of issues.slice(0, 1)) {
    if (issue.kind === "key") {
      const replace = issue.state === "rejected" || issue.state === "no_scope";
      return withMore({
        ...base,
        title: replace
          ? `Trocar a chave da ${provider}`
          : issue.state === "unreadable"
            ? `Colar de novo a chave da ${provider}`
            : `Cadastrar a chave da ${provider}`,
        detail:
          issue.state === "rejected"
            ? `A ${provider} recusou a chave salva no último “Testar conexão”: no site publicado, os botões de pagamento não cobram.`
            : issue.state === "no_scope"
              ? `A chave da ${provider} salva não tem a permissão transactions:read: o comprador pode pagar sem o pagamento ser confirmado, e aí não recebe o acesso.`
              : issue.state === "unreadable"
                ? `A chave da ${provider} salva não pôde ser lida neste Mac. Sem ela, o pagamento na página não cobra no site publicado.`
                : `O pagamento na página precisa da chave da API da ${provider} desta oferta para cobrar no site publicado.`,
        done: false,
        cta: `Abrir a conta da ${provider}`,
        target: { paymentAccount: true },
      });
    }
    if (issue.kind === "product") {
      const missing = [issue.thankYou && "a página de obrigado", issue.access && "o link de acesso"].filter(
        (x): x is string => Boolean(x),
      );
      const lack = missing.length
        ? `Falta ${listPt(missing)}: sem ${missing.length > 1 ? "eles" : issue.access ? "ele" : "ela"}, quem pagar não recebe o acesso ao produto.`
        : "";
      // Valor fora da faixa das formas marcadas (ex.: depois de trocar a moeda da oferta): a Kyvo recusa a cobrança.
      const amount = issue.amount ? `${issue.amount} Ajuste o valor ou as formas de pagamento.` : "";
      return withMore({
        ...base,
        title:
          lack || issue.methods ? `Completar o pagamento de “${issue.label}”` : `Ajustar o valor de “${issue.label}”`,
        detail: [lack, issue.methods ?? "", amount].filter(Boolean).join(" "),
        done: false,
        cta: "Abrir o link",
        target: { link: issue.linkId },
      });
    }
    if (issue.kind === "accessLang") {
      const who = listPt(issue.products.map((p) => `“${p.label}”`));
      return withMore({
        ...base,
        title: "Ajustar o idioma do acesso",
        detail: `O bloco “Acesso ao produto” de “${issue.pageName}” está em outro idioma que o de ${who}: troque o “Idioma dos textos” no bloco ou use uma página de obrigado para cada idioma.`,
        done: false,
        cta: "Abrir no editor",
        target: { editor: issue.documentId },
      });
    }
    if (issue.kind === "accessBlock") {
      return withMore({
        ...base,
        title: "Pôr o acesso na página de obrigado",
        detail: `A página “${issue.pageName}” ainda não tem o bloco “Acesso ao produto” (categoria Conversão): quem pagar chega lá sem o botão de acesso.`,
        done: false,
        cta: "Abrir no editor",
        target: { editor: issue.documentId },
      });
    }
  }
  return {
    ...base,
    title: "Pagamento na página pronto",
    detail:
      "Teste na prévia (“Ver página”). Depois de subir o ZIP, faça uma compra com valor baixo no site publicado (o LEIA-ME.txt explica).",
    done: true,
    cta: "Ver links",
    target: { tab: "links" },
  };
}

/**
 * Checkout do Offer Studio: chave do gateway, gateway × moeda da oferta,
 * página de obrigado com o acesso, links de acesso do produto e dos bumps,
 * valor, endereço fora do real (null = a oferta não tem). O frete pago com o
 * endereço desligado e os textos trocados de outro idioma são só aviso (não
 * impedem a venda): aparecem quando são a única coisa.
 */
function checkoutOwnItem(input: ReadinessInput): ReadinessItem | null {
  const check = input.checkouts;
  if (!check?.products.length) return null;
  const base = { id: "checkout-proprio", optional: false } as const;
  // A regra de Purchase repetida é aviso do ZIP (não impede a venda).
  const all = checkoutIssues(check).filter((i) => i.kind !== "doublePurchase");
  const issues = all.filter((i) => i.kind !== "shipping" && i.kind !== "texts");
  const more = issues.length - 1;
  const withMore = (item: ReadinessItem): ReadinessItem =>
    more > 0
      ? {
          ...item,
          detail: `${item.detail} Depois, ${more === 1 ? "falta mais 1 ajuste" : `faltam mais ${more} ajustes`} no checkout.`,
        }
      : item;
  const issue = issues[0];
  if (issue?.kind === "key") {
    const provider = PROVIDER_LABEL[issue.provider];
    // Conta da BlackCat não liberada: a chave é válida, trocar não resolve (é esperar e testar de novo).
    const waitAccount = issue.state === "no_scope" && issue.provider !== "KYVO";
    const replace = issue.state === "rejected" || (issue.state === "no_scope" && !waitAccount);
    return withMore({
      ...base,
      title: waitAccount
        ? `Conferir a conta da ${provider}`
        : replace
          ? `Trocar a chave da ${provider}`
          : issue.state === "unreadable"
            ? `Colar de novo a chave da ${provider}`
            : `Cadastrar a chave da ${provider}`,
      detail:
        issue.state === "rejected"
          ? `A ${provider} recusou a chave salva no último “Testar conexão”: no site publicado, o checkout não cobra.`
          : waitAccount
            ? `A chave é válida, mas a ${provider} ainda não liberou a conta para vender (último “Testar conexão”): no site publicado, o checkout não cobra. Quando a ${provider} liberar, clique em “Testar conexão” de novo.`
            : issue.state === "no_scope"
              ? `A ${provider} não liberou a conta da chave salva para vender (último “Testar conexão”): no site publicado, o checkout não cobra.`
              : issue.state === "unreadable"
                ? `A chave da ${provider} salva não pôde ser lida neste Mac. Sem ela, o checkout não cobra no site publicado.`
                : `O checkout do Offer Studio precisa da chave da API da ${provider} desta oferta para cobrar no site publicado.`,
      done: false,
      cta: `Abrir a conta da ${provider}`,
      target: { paymentAccount: true, provider: issue.provider },
    });
  }
  if (issue?.kind === "product") {
    const missing = checkoutProductMissing(issue);
    const lack = missing.length
      ? `Falta ${listPt(missing)}: sem ${missing.length > 1 ? "eles" : "isso"}, quem pagar não recebe tudo o que comprou.`
      : "";
    const amount = issue.amount ? `${issue.amount} Ajuste o valor, os bumps ou o frete.` : "";
    return withMore({
      ...base,
      title: issue.currency
        ? `Trocar o gateway de “${issue.label}”`
        : lack
          ? `Completar o checkout de “${issue.label}”`
          : `Ajustar o valor de “${issue.label}”`,
      detail: [issue.currency ?? "", lack, amount].filter(Boolean).join(" "),
      done: false,
      cta: "Abrir o link",
      target: { link: issue.linkId },
    });
  }
  if (issue?.kind === "accessBlock") {
    return withMore({
      ...base,
      title: "Pôr o acesso na página de obrigado",
      detail: `A página “${issue.pageName}” ainda não tem o bloco “Acesso ao produto” (categoria Conversão): quem pagar no checkout chega lá sem o botão de acesso.`,
      done: false,
      cta: "Abrir no editor",
      target: { editor: issue.documentId },
    });
  }
  if (issue?.kind === "accessLang") {
    const who = listPt(issue.products.map((p) => `“${p.label}”`));
    return withMore({
      ...base,
      title: "Ajustar o idioma do acesso",
      detail: `O bloco “Acesso ao produto” de “${issue.pageName}” está em outro idioma que o checkout ${who}: troque o “Idioma dos textos” no bloco ou use uma página de obrigado para cada idioma.`,
      done: false,
      cta: "Abrir no editor",
      target: { editor: issue.documentId },
    });
  }
  const shipping = all.find((i) => i.kind === "shipping");
  if (shipping?.kind === "shipping") {
    return {
      ...base,
      optional: true,
      title: `Conferir o frete de “${shipping.label}”`,
      detail: `${shippingIssueText(shipping)} Ligue o endereço em “Endereço e frete” ou deixe só o frete grátis.`,
      done: false,
      cta: "Abrir o link",
      target: { link: shipping.linkId },
    };
  }
  const texts = all.find((i) => i.kind === "texts");
  if (texts?.kind === "texts") {
    return {
      ...base,
      optional: true,
      title: `Revisar os textos de “${texts.label}”`,
      detail: `${textsIssueText(texts)} Revise em “Aparência → Textos” (ou apague para usar os padrões) e salve o checkout.`,
      done: false,
      cta: "Abrir o link",
      target: { link: texts.linkId },
    };
  }
  return {
    ...base,
    title: "Checkout do Offer Studio pronto",
    detail:
      "Teste na prévia (“Ver checkout”). Depois de subir o ZIP, faça uma compra com valor baixo no site publicado (o LEIA-ME.txt explica).",
    done: true,
    cta: "Ver links",
    target: { tab: "links" },
  };
}

/**
 * Produto do pagamento na página cobrando numa moeda diferente da moeda da
 * oferta (os preços das páginas numa moeda e a cobrança em outra). Na oferta
 * em real é o que sobra depois de trocar a moeda: a Kyvo não cobra em real.
 * Opcional (pode ser de propósito); null = não se aplica.
 */
function paymentCurrencyItem(input: ReadinessInput): ReadinessItem | null {
  const currency = input.chosenCurrency;
  const products = input.payments?.products ?? [];
  if (!currency || !products.length) return null;
  const other = products.filter((p) => p.currency !== currency);
  if (!other.length) return null;
  const who = listPt(other.map((p) => `“${p.label}”`));
  const names = listPt([...new Set(other.map((p) => OFFER_CURRENCY_NAME[p.currency]))]);
  const verb = other.length > 1 ? "cobram" : "cobra";
  const detail =
    currency === "BRL"
      ? `A oferta roda em real, mas a Kyvo não cobra em real: ${who} ${verb} em ${names}. Para vender no Brasil, use no link um checkout em real (Hotmart, Kiwify…); para vender fora, troque a moeda da oferta em “Moeda, empresa e SEO”.`
      : `A oferta roda em ${OFFER_CURRENCY_NAME[currency]}, mas ${who} ${verb} em ${names}: os preços das páginas e o valor cobrado ficam em moedas diferentes. Abra o link e troque a moeda do produto.`;
  return {
    id: "moeda-pagamento",
    title: "Conferir a moeda do pagamento na página",
    detail,
    done: false,
    optional: true,
    cta: "Abrir o link",
    target: { link: other[0].linkId },
  };
}

function companyItem(input: ReadinessInput): ReadinessItem {
  const base = { id: "empresa", cta: "Preencher", target: { tab: "configuracoes" } } as const;
  const { used, missing } = missingCompanyFields(input.htmls, input.company);
  if (used && missing.length) {
    return {
      ...base,
      title: "Preencher os dados da empresa",
      detail: `As páginas ainda mostram marcadores como {{EMPRESA}} no lugar de: ${listPt(missing)}.`,
      done: false,
      optional: false,
    };
  }
  if (used) {
    return {
      ...base,
      title: "Dados da empresa preenchidos",
      detail: "A política e os termos saem com os seus dados.",
      done: true,
      optional: false,
    };
  }
  const filled = Boolean(input.company.name.trim());
  return {
    ...base,
    title: filled ? "Dados da empresa preenchidos" : "Dados da empresa",
    detail: filled
      ? "Usados na política de privacidade e nos termos de uso."
      : "Usados na política de privacidade e nos termos de uso, se você adicionar essas páginas.",
    done: filled,
    optional: true,
  };
}

/**
 * Links de Política, Termos, Contato… sem destino (como o rodapé e o aviso do
 * formulário dos modelos): opcional, o clique só não leva a lugar nenhum
 * (null = nenhum link assim).
 */
function legalLinksItem(input: ReadinessInput): ReadinessItem | null {
  const byPage = new Map<string, { id: string; name: string; links: string[] }>();
  for (const doc of input.pageDocs ?? []) {
    const links = deadLegalLinks(doc.html);
    if (!links.length) continue;
    const page = byPage.get(doc.pageId);
    if (!page) byPage.set(doc.pageId, { id: doc.id, name: doc.pageName, links });
    else for (const l of links) if (!page.links.includes(l)) page.links.push(l);
  }
  const pages = [...byPage.values()];
  if (!pages.length) return null;
  const links = [...new Set(pages.flatMap((p) => p.links))];
  const many = links.length > 1;
  const where =
    pages.length === 1 ? `da página “${pages[0].name}”` : `das páginas ${quotedList(pages.map((p) => p.name))}`;
  return {
    id: "links-legais",
    title: "Ligar os links de política, termos e contato",
    detail: `${many ? "Os links" : "O link"} ${quotedList(links)} ${where} ainda ${
      many ? "não levam" : "não leva"
    } a lugar nenhum. No editor, clique em cada um e escolha em Configurações a página dele (“Página do funil”) ou o endereço (e-mail, WhatsApp…).`,
    done: false,
    optional: true,
    cta: "Abrir no editor",
    target: { editor: pages[0].id },
  };
}

/** Idioma do <html lang> de uma página ("" se não declara). */
export function declaredLang(html: string): string {
  const at = html.search(/<html[\s>]/i);
  if (at < 0) return "";
  const end = html.indexOf(">", at);
  const tag = html.slice(at, end < 0 ? html.length : end);
  const m = /\slang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
}

/** Idiomas sugeridos para quem vende em cada moeda (além do português). */
const CURRENCY_LANGUAGE_HINT: Record<Exclude<StoreCurrency, "BRL">, string> = {
  MXN: "Se elas já estão em espanhol, escolha Espanhol",
  USD: "Se elas já estão em inglês ou espanhol, escolha o idioma delas",
  EUR: "Se elas já estão em espanhol ou inglês, escolha o idioma delas",
};

/**
 * Oferta em peso, dólar ou euro com as páginas marcadas como português (os
 * modelos nascem com lang="pt-BR") e "Idioma das páginas" sem escolha:
 * opcional, nada muda sozinho (null = não se aplica).
 */
function languageItem(input: ReadinessInput): ReadinessItem | null {
  const currency = input.currency;
  if (!currency || currency === "BRL" || input.language) return null;
  if (!input.htmls.some((h) => declaredLang(h).toLowerCase().startsWith("pt"))) return null;
  return {
    id: "idioma",
    title: "Conferir o idioma das páginas",
    detail: `Suas páginas estão marcadas como português, mas a oferta roda em ${OFFER_CURRENCY_NAME[currency]}. ${CURRENCY_LANGUAGE_HINT[currency]} em “Idioma das páginas” (o Google, o tradutor do navegador e os leitores de tela usam essa marca).`,
    done: false,
    optional: true,
    cta: "Escolher o idioma",
    target: { setting: "idioma" },
  };
}

function pixelItem(input: ReadinessInput): ReadinessItem {
  const n = input.pixelCount;
  return {
    id: "pixel",
    title: n ? (n === 1 ? "1 pixel ligado" : `${n} pixels ligados`) : "Adicionar um pixel",
    detail: n
      ? "As visitas e as compras chegam às plataformas de anúncio."
      : "Meta, TikTok, Google… para medir as vendas dos seus anúncios.",
    done: n > 0,
    optional: true,
    cta: n ? "Ver pixels" : "Adicionar",
    target: { tab: "rastreamento" },
  };
}

function zipItem(input: ReadinessInput, dateLabel: (d: Date) => string): ReadinessItem {
  return {
    id: "zip",
    title: input.lastZipAt ? "ZIP baixado" : "Baixar o ZIP",
    detail: input.lastZipAt
      ? `Último ZIP em ${dateLabel(input.lastZipAt)}. Baixe de novo depois de mudar as páginas.`
      : "O ZIP tem as páginas prontas para subir em qualquer hospedagem.",
    done: Boolean(input.lastZipAt),
    optional: false,
    // Não "Baixar ZIP": esse é o nome do botão principal ao lado do título.
    cta: input.lastZipAt ? "Gerar de novo" : "Gerar o ZIP",
    target: { export: true },
  };
}

function liveItem(input: ReadinessInput): ReadinessItem {
  const where = displayUrl(input.liveUrl);
  return {
    id: "no-ar",
    title: where ? "Endereço informado" : "Informar onde está no ar",
    detail: where
      ? `No ar em ${where}.`
      : "Depois de subir o ZIP, informe o endereço: ele completa a imagem de compartilhamento e o seu painel.",
    done: Boolean(where),
    optional: false,
    cta: where ? "Mudar" : "Informar",
    target: { tab: "detalhes" },
  };
}

export function computeReadiness(given: ReadinessInput, dateLabel: (d: Date) => string): Readiness {
  const input: ReadinessInput = { ...given, links: renderedLinks(given.links) };
  const wheel = wheelItem(input);
  const wheelCoupon = wheelCouponItem(input);
  const products = productsItem(input);
  const storeCurrency = storeCurrencyItem(input);
  const payment = paymentItem(input);
  const paymentCurrency = paymentCurrencyItem(input);
  const checkoutOwn = checkoutOwnItem(input);
  const legal = legalLinksItem(input);
  const language = languageItem(input);
  const items = [
    checkoutItem(input),
    ...(wheel ? [wheel] : []),
    ...(wheelCoupon ? [wheelCoupon] : []),
    ...(products ? [products] : []),
    ...(storeCurrency ? [storeCurrency] : []),
    ...(payment ? [payment] : []),
    ...(paymentCurrency ? [paymentCurrency] : []),
    ...(checkoutOwn ? [checkoutOwn] : []),
    companyItem(input),
    ...(legal ? [legal] : []),
    ...(language ? [language] : []),
    pixelItem(input),
    zipItem(input, dateLabel),
    liveItem(input),
  ];
  const required = items.filter((i) => !i.optional);
  const done = required.filter((i) => i.done).length;
  return { items, done, total: required.length, complete: done === required.length };
}
