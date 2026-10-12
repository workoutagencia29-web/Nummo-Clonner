/**
 * Página de checkout do Offer Studio (prévia em /checkout/<chave>; ZIP em
 * checkout/<chave>/index.html, montada em src/server/services/export/build.ts): o
 * produto do link (só com o destino "Checkout do Offer Studio" e o produto
 * salvo), o JSON público e a página (src/lib/checkout/page.ts), passada pelo
 * render das páginas para levar o rastreamento com o consentimento, o código
 * livre da oferta, o ícone da aba e o noindex.
 */
import { checkoutImageSrc } from "@/lib/checkout/config";
import {
  checkoutPageTracking,
  injectCheckoutVersion,
  publicCheckoutConfig,
  renderCheckoutDocument,
} from "@/lib/checkout/page";
import { type Db, prisma } from "@/lib/db";
import { parseOfferSettings } from "@/lib/offer-settings";
import { renderPageHtml, type TrackingRenderOptions } from "@/lib/page-render";
import { seoAssetHref } from "@/lib/seo-render";
import { offerCheckoutProducts, type ServerCheckoutProduct } from "./products";

/** Produto ativo do checkout pela chave do link (null = não existe ou não está ligado). */
export async function checkoutProductByKey(
  offerId: string,
  key: string,
  db: Db = prisma,
): Promise<ServerCheckoutProduct | null> {
  return (await offerCheckoutProducts(offerId, db)).find((p) => p.key === key) ?? null;
}

export interface CheckoutPageRenderOptions {
  /** Endpoint relativo à página (prévia /__os/pagamento). */
  endpoint: string;
  simulation: boolean;
  /** Prévia com a chave do gateway salva: a cobrança é real (aviso em pt-BR, sem simular). */
  realTest?: boolean;
  /** Endereço de uma página do funil a partir da página de checkout (página de obrigado). */
  pageHref: (pageId: string) => string;
  /** Chave do storage → endereço da imagem (padrão: /os-assets/<arquivo>, o da prévia). */
  imageHref?: (key: string | null) => string | null;
  /** Tag do script do checkout. */
  scriptTag: string;
  /** Rastreamento (prévia: sem pixels; teste: pixels de verdade). */
  tracking: TrackingRenderOptions | null;
}

/** HTML da página de checkout do link (null = o link não tem checkout ativo nesta oferta). */
export async function renderCheckoutPage(
  offerId: string,
  key: string,
  opts: CheckoutPageRenderOptions,
  db: Db = prisma,
): Promise<string | null> {
  const [product, offer] = await Promise.all([
    checkoutProductByKey(offerId, key, db),
    db.offer.findFirst({ where: { id: offerId, deletedAt: null }, select: { settings: true } }),
  ]);
  if (!product || !offer) return null;
  const settings = parseOfferSettings(offer.settings);
  const config = publicCheckoutConfig(product, {
    endpoint: opts.endpoint,
    simulation: opts.simulation,
    realTest: opts.realTest,
    imageHref: opts.imageHref ?? checkoutImageSrc,
    thankYouHref: product.thankYouPageId ? opts.pageHref(product.thankYouPageId) : null,
  });
  const html = renderCheckoutDocument(config, {
    scriptTag: opts.scriptTag,
    company: settings.company,
    consentLink: !!opts.tracking && opts.tracking.config.consent.mode !== "OFF",
  });
  // Teste A/B: a versão vinda no endereço (?os_versao=) vai aos eventos e à metadata.
  return injectCheckoutVersion(
    renderPageHtml(html, {
      links: [],
      pageHref: opts.pageHref,
      // O script das páginas (widgets) não tem o que fazer aqui: o do checkout vem na tag própria.
      runtimeTag: "",
      // Sem as regras "ao enviar um formulário" (Lead a cada "Pagar") e "ao clicar no checkout".
      tracking: opts.tracking ? { ...opts.tracking, config: checkoutPageTracking(opts.tracking.config) } : null,
      currency: settings.currency,
      seo: { faviconHref: seoAssetHref(settings.seo.faviconKey), noindex: true },
    }),
  );
}
