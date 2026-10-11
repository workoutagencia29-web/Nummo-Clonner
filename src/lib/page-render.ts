/**
 * Transforma o HTML salvo de uma página no HTML servido ao visitante (prévia e,
 * na Fase 5, ZIP): marcadores da empresa ({{EMPRESA}}…) viram os dados da
 * oferta, links do funil (os-page:<id>) viram endereços reais, botões
 * ligados a links da oferta recebem a URL atual (ou, nos de pagamento na
 * página, data-os-pay), a roleta de desconto leva o mapa de prêmios (e marca
 * os botões de checkout), os produtos de pagamento vão no #os-pagamento, o SEO (título, descrição,
 * favicon, imagem de compartilhamento, noindex, idioma) entra no <head>, os
 * textos do script no idioma da página (#os-textos: espanhol/inglês e telefone
 * de fora do Brasil, src/lib/page-texts.ts) entram no <head>, os
 * códigos livres (da oferta e da página: head / início e fim do body) entram,
 * o script do Offer Studio vai antes do </body> (e, nas páginas de produto, o
 * da galeria e da barra de compra) e, com rastreamento, a configuração e o
 * script de pixels vão para o começo do <head>.
 */
import { withCheckoutVersion } from "@/lib/checkout/contract";
import { afterLeadingDoctype } from "@/lib/doctype";
import { scriptString } from "@/lib/export/head";
import { INTERNAL_LINK_PREFIX } from "@/lib/internal-links";
import { applyOfferLinks, type OfferLinkValue } from "@/lib/offer-links";
import { type Company, fillCompanyPlaceholders } from "@/lib/offer-settings";
import { injectPageCode, PAGE_CODE_FIELDS, type PageCustomCode, unclosedCodePart } from "@/lib/page-code";
import { htmlLang, PAGE_TEXTS_ID, pageTexts } from "@/lib/page-texts";
import { injectOrderStrip, injectPaymentConfig, type PaymentRender } from "@/lib/payments/render";
import { injectProductScript, injectRuntime } from "@/lib/runtime-bundle";
import { applySeo, type SeoRender } from "@/lib/seo-render";
import type { StoreCurrency } from "@/lib/store";
import { resolveCodeCategoryFull } from "@/lib/tracking/code-trackers-server";
import { gateCode, injectTracking } from "@/lib/tracking/inject";
import type { TrackingRuntimeConfig } from "@/lib/tracking/runtime-config";
import type { CodeCategoryId } from "@/lib/tracking/schema";
import { applyWheelPrizes, type WheelRender } from "@/lib/wheel-prizes";

/**
 * Código livre com a categoria de consentimento. Sem categoria (a pessoa nunca
 * escolheu): "Marketing" se o código tem pixel/tag de rastreamento, senão
 * "Essencial" (ver resolveCodeCategoryFull).
 */
export type CategorizedCode = Partial<PageCustomCode> & { category?: CodeCategoryId | null };

export interface TrackingRenderOptions {
  /** Configuração pública (buildTrackingConfig / loadTracking). */
  config: TrackingRuntimeConfig;
  /** Tag do script de rastreamento (externo na prévia, embutido no ZIP). */
  scriptTag: string;
  /** Código livre da OFERTA (TrackingSettings.customCode), em todas as páginas. */
  offerCode?: CategorizedCode | null;
}

export interface RenderOptions {
  links: OfferLinkValue[];
  /** Endereço de outra página do funil (prévia: /p/<id>; ZIP: caminho relativo). */
  pageHref: (pageId: string) => string;
  /** Tag do script do Offer Studio (externo na prévia, embutido no ZIP). */
  runtimeTag: string;
  /**
   * Tag do script da página do produto (galeria, barra de compra do celular,
   * "Voltar para a loja"): prévia PRODUCT_SCRIPT_TAG, ZIP
   * assets/os-produto-<hash>.js; sem ela, embutido. Só entra nas páginas que
   * têm esses blocos (injectProductScript).
   */
  productScriptTag?: string | null;
  /**
   * Códigos livres da página (Page.customCode, ver parsePageCode; `category` via
   * explicitPageCodeCategory: null = automática, ver resolveCodeCategoryFull). Opcional.
   */
  customCode?: CategorizedCode | null;
  /**
   * Rastreamento (Fase 4). Sem ele, a página sai como na Fase 3: nada de pixels
   * e os códigos livres rodam direto (sem esperar consentimento).
   */
  tracking?: TrackingRenderOptions | null;
  /**
   * Dados da empresa (Offer.settings.company): trocam os marcadores {{EMPRESA}},
   * {{CNPJ}}… do HTML da página (não os dos códigos livres).
   */
  company?: Company | null;
  /** SEO da página (effectiveSeo + idioma, ver seoRenderFrom). Campos vazios mantêm o da página. */
  seo?: SeoRender | null;
  /**
   * Moeda da oferta (Offer.settings.currency). Fora do real, o formulário de
   * captura aceita telefone de outro país e o documento da empresa reconhece o
   * NIF de 9 dígitos (Portugal). Sem ela: como em real (textos e telefone só
   * pelo idioma escolhido em "Idioma das páginas", ver injectPageTexts).
   */
  currency?: StoreCurrency | null;
  /**
   * Roleta de desconto da oferta (wheelRenderData): mapa de prêmios e botões de
   * checkout marcados, para a página de vendas usar o prêmio ganho. A
   * visibilidade condicional ("só para quem ganhou") vale mesmo sem ele.
   */
  wheel?: WheelRender | null;
  /**
   * Pagamento na página (produtos públicos da oferta + endpoint): vira o JSON
   * #os-pagamento lido pela janela de pagamento. Os botões ligados a links de
   * pagamento (`links` com pay) ganham data-os-pay mesmo sem ele.
   */
  payments?: PaymentRender | null;
}

const PAGE_LINK_RE = new RegExp(`${INTERNAL_LINK_PREFIX}([a-z0-9]{20,32})`, "g");

/**
 * Código usável (não vazio e que fecha tudo), já com a categoria aplicada.
 * `waits`: diz se sobrou código de Estatística/Marketing (o aviso de cookies
 * aparece por causa dele).
 */
function usableCode(
  code: CategorizedCode | null | undefined,
  gate: boolean,
): { parts: Partial<PageCustomCode>; waits: boolean } {
  const parts: Partial<PageCustomCode> = {};
  if (!code) return { parts, waits: false };
  const category = resolveCodeCategoryFull(code, code.category ?? null).category;
  let waits = false;
  for (const field of PAGE_CODE_FIELDS) {
    const text = code[field]?.trim() ?? "";
    // Um código que não fecha é descartado aqui (antes de juntar), para não
    // derrubar o código da oferta junto com o da página ou vice-versa.
    if (!text || unclosedCodePart(text)) continue;
    parts[field] = gate ? gateCode(text, category) : text;
    if (category !== "NECESSARY") waits = true;
  }
  return { parts, waits };
}

/** Código da oferta primeiro, depois o da página (em cada posição). */
function mergeCode(offer: Partial<PageCustomCode>, page: Partial<PageCustomCode>): Partial<PageCustomCode> {
  const out: Partial<PageCustomCode> = {};
  for (const field of PAGE_CODE_FIELDS) {
    const parts = [offer[field], page[field]].filter(Boolean);
    if (parts.length) out[field] = parts.join("\n");
  }
  return out;
}

/**
 * O código de Estatística/Marketing precisa esperar o "Aceitar"? Só com
 * rastreamento (sem ele não há quem ative o código: roda direto, como na
 * Fase 3) e, na página publicada, só no modo "Pedir permissão": com "Só avisar"
 * ou sem aviso o código roda no lugar dele, sem atraso (e com os eventos
 * DOMContentLoaded/load de sempre). A prévia nunca ativa e a tela de teste
 * ativa sozinha: nas duas o código fica em espera.
 */
function gatesCode(tracking: TrackingRenderOptions | null): boolean {
  if (!tracking) return false;
  return tracking.config.mode !== "live" || tracking.config.consent.mode === "OPT_IN";
}

/**
 * Embute o JSON #os-textos no fim do <head> (página em espanhol/inglês ou com
 * telefone de fora do Brasil, ver pageTexts em src/lib/page-texts.ts), lido
 * pelo script das páginas (src/runtime/widgets/texts.ts). Idempotente; sem
 * nada a embutir (português de oferta em real), devolve o HTML como veio.
 *
 * Qual idioma vale: fora do real, o <html lang> final da página; em real (ou
 * sem moeda), só o escolhido em "Idioma das páginas" (`chosenLang`). Numa
 * oferta em real, o lang que veio da página clonada (sites feitos no Lovable,
 * no Framer… trazem lang="en") não troca os textos nem o telefone sem a pessoa
 * escolher: a página fica em português, pedindo o DDD, como sempre foi.
 */
export function injectPageTexts(html: string, currency?: StoreCurrency | null, chosenLang?: string | null): string {
  if (html.includes(`id="${PAGE_TEXTS_ID}"`)) return html;
  const foreign = Boolean(currency && currency !== "BRL");
  const texts = pageTexts(foreign ? htmlLang(html) : (chosenLang?.trim() ?? ""), currency);
  if (!texts) return html;
  const tag = `<script type="application/json" id="${PAGE_TEXTS_ID}">${scriptString(texts)}</script>`;
  const head = html.search(/<\/head>/i);
  // Sem <head>: logo depois do doctype (antes dele, a página cairia no modo quirks).
  const at = head >= 0 ? head : afterLeadingDoctype(html);
  return `${html.slice(0, at)}${tag}${html.slice(at)}`;
}

/**
 * Teste A/B: a página de checkout do Offer Studio fica sabendo qual versão da
 * página a pessoa viu (?os_versao=B nos botões e nos prêmios da roleta que
 * levam a ela): os eventos e a metadata da cobrança de lá levam a versão,
 * como os checkouts de fora recebem a marca "versao-b" (markVersion).
 */
function withVersion(
  links: OfferLinkValue[],
  wheel: WheelRender | null | undefined,
  version: string | null | undefined,
): { links: OfferLinkValue[]; wheel: WheelRender | null | undefined } {
  if (!version) return { links, wheel };
  const versioned = links.map((l) =>
    l.checkout === true && l.url ? { ...l, url: withCheckoutVersion(l.url, version) } : l,
  );
  if (!wheel) return { links: versioned, wheel };
  const prizes: WheelRender["prizes"] = {};
  for (const [id, prize] of Object.entries(wheel.prizes)) {
    prizes[id] = prize.o && prize.u ? { ...prize, u: withCheckoutVersion(prize.u, version) } : prize;
  }
  return { links: versioned, wheel: { ...wheel, prizes } };
}

export function renderPageHtml(html: string, opts: RenderOptions) {
  let out = opts.company ? fillCompanyPlaceholders(html, opts.company, opts.currency) : html;
  out = out.replace(PAGE_LINK_RE, (_, id: string) => opts.pageHref(id));
  const { links, wheel } = withVersion(opts.links, opts.wheel, opts.tracking?.config.variant?.name);
  out = applyOfferLinks(out, links);
  out = applyWheelPrizes(out, wheel);
  out = injectPaymentConfig(out, opts.payments);
  out = applySeo(out, opts.seo);
  // Depois do SEO: vale o idioma que a página vai ter de fato (em real, só o escolhido).
  out = injectPageTexts(out, opts.currency, opts.seo?.lang);
  const tracking = opts.tracking ?? null;
  const gate = gatesCode(tracking);
  const pageCode = usableCode(opts.customCode, gate);
  const offerCode = tracking ? usableCode(tracking.offerCode, gate) : { parts: {}, waits: false };
  out = injectPageCode(out, mergeCode(offerCode.parts, pageCode.parts));
  out = injectRuntime(out, opts.runtimeTag);
  out = injectProductScript(out, opts.productScriptTag);
  if (tracking) {
    // Código de marketing sem pixels também pede o aviso de cookies.
    const marketingCode = tracking.config.marketingCode || offerCode.waits || pageCode.waits;
    out = injectTracking(out, { ...tracking.config, marketingCode }, tracking.scriptTag);
  }
  // Por último: no começo do <head>, na frente do rastreamento e de qualquer script.
  out = injectOrderStrip(out, opts.payments);
  return out;
}

/** Celular pelo User-Agent (para ofertas com versões separadas desktop/celular). */
export function isMobileUserAgent(ua: string | undefined) {
  return /iPhone|iPod|Android.*Mobile|Mobile Safari|Windows Phone|BlackBerry|Opera Mini/i.test(ua ?? "");
}
