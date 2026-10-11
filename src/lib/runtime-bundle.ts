/**
 * Compila os scripts das páginas para IIFEs minificados, uma vez por processo:
 * - src/runtime/os-runtime.ts (widgets, delay, botões) — antes do </body>;
 * - src/runtime/tracking/index.ts (consentimento, pixels, eventos, UTMs) — no
 *   começo do <head> (ver src/lib/tracking/inject.ts);
 * - src/runtime/payments/index.ts (janela de pagamento) — só nas ofertas com
 *   "Pagamento na página", antes do </body> (ver src/lib/payments/render.ts);
 * - src/runtime/product/index.ts (página do produto: galeria, barra de compra
 *   do celular, "Voltar para a loja") — só nas páginas com esses blocos, antes
 *   do </body> (injectProductScript). À parte para não pesar nas outras
 *   páginas (o script das páginas está no limite do orçamento de tamanho).
 * - src/runtime/checkout/index.ts (página de checkout do Offer Studio:
 *   validação, máscaras, CEP, total, PIX e Kyvo) — só nas páginas de checkout.
 * Usado pelo servidor de prévia e pela exportação. Só roda em Node
 * (worker/prévia), nunca no bundle do Next.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { buildSync } from "esbuild";
import { TRACKING_SCRIPT_ATTR } from "@/lib/tracking/runtime-config";

let cached: string | null = null;
let trackingCached: string | null = null;
let paymentCached: string | null = null;
let productCached: string | null = null;
let checkoutCached: string | null = null;

/** Atributo da tag do script da página de checkout. */
export const CHECKOUT_SCRIPT_ATTR = "data-os-checkout-script";
/** Caminho do script da página de checkout na prévia. */
export const CHECKOUT_SCRIPT_PATH = "/os-checkout.js";
/** Tag do script da página de checkout servido pela prévia (no fim do <body>). */
export const CHECKOUT_SCRIPT_TAG = `<script src="${CHECKOUT_SCRIPT_PATH}" ${CHECKOUT_SCRIPT_ATTR}></script>`;

/** Atributo da tag do script da janela de pagamento (para não pôr duas vezes). */
export const PAYMENT_SCRIPT_ATTR = "data-os-pay-script";
/** Caminho do script da janela de pagamento na prévia. */
export const PAYMENT_SCRIPT_PATH = "/os-pagamento.js";
/** Tag do script da janela de pagamento servido pela prévia. */
export const PAYMENT_SCRIPT_TAG = `<script src="${PAYMENT_SCRIPT_PATH}" ${PAYMENT_SCRIPT_ATTR}></script>`;

/** Atributo da tag do script da página do produto (para não pôr duas vezes). */
export const PRODUCT_SCRIPT_ATTR = "data-os-product-script";
/** Caminho do script da página do produto na prévia. */
export const PRODUCT_SCRIPT_PATH = "/os-produto.js";
/** Tag do script da página do produto servido pela prévia. */
export const PRODUCT_SCRIPT_TAG = `<script src="${PRODUCT_SCRIPT_PATH}" ${PRODUCT_SCRIPT_ATTR}></script>`;

/** Caminho do script de rastreamento na prévia (e no ZIP, se sair como arquivo). */
export const TRACKING_SCRIPT_PATH = "/os-tracking.js";
/** Tag do script de rastreamento servido pela prévia (síncrono: roda antes do código da página). */
export const TRACKING_SCRIPT_TAG = `<script src="${TRACKING_SCRIPT_PATH}" ${TRACKING_SCRIPT_ATTR}></script>`;

function bundle(entry: string) {
  const result = buildSync({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2018", "safari13"],
    platform: "browser",
    // Aliases "@/…" do projeto (o script de rastreamento usa as constantes de src/lib/tracking).
    tsconfig: path.join(process.cwd(), "tsconfig.json"),
    write: false,
    legalComments: "none",
  });
  return result.outputFiles[0].text;
}

/** CSS que esconde elementos com delay até o script revelá-los. */
export const DELAY_STYLE = `<style id="os-delay-style">[data-os-delay]:not([data-os-delay="0"]):not(.os-revealed){display:none!important}</style>`;

export function runtimeScript(): string {
  cached ??= bundle(path.join(process.cwd(), "src/runtime/os-runtime.ts"));
  return cached;
}

/**
 * Script de rastreamento (src/runtime/tracking/index.ts). Enquanto ele não
 * existir (desenvolvimento em paralelo), devolve um script vazio.
 */
export function trackingScript(): string {
  if (trackingCached) return trackingCached;
  const entry = path.join(process.cwd(), "src/runtime/tracking/index.ts");
  if (!existsSync(entry)) return "/* os-tracking: script ainda não disponível */";
  trackingCached = bundle(entry);
  return trackingCached;
}

/** Script da janela de pagamento (src/runtime/payments/index.ts). */
export function paymentScript(): string {
  paymentCached ??= bundle(path.join(process.cwd(), "src/runtime/payments/index.ts"));
  return paymentCached;
}

/** Script da página de checkout do Offer Studio (src/runtime/checkout/index.ts). */
export function checkoutScript(): string {
  checkoutCached ??= bundle(path.join(process.cwd(), "src/runtime/checkout/index.ts"));
  return checkoutCached;
}

/** Script da página do produto (src/runtime/product/index.ts). */
export function productScript(): string {
  productCached ??= bundle(path.join(process.cwd(), "src/runtime/product/index.ts"));
  return productCached;
}

/**
 * A página tem galeria de fotos, caixa de compra ou "Voltar para a loja" (o que
 * o script da página do produto liga)?
 */
export function hasProductPage(html: string): boolean {
  return /data-os-widget=["']?product-(?:gallery|buy)\b|\sdata-os-pd-back\b/.test(html);
}

/**
 * Põe o script da página do produto antes do </body>, só nas páginas que têm
 * os blocos dela (prévia: PRODUCT_SCRIPT_TAG; ZIP: assets/os-produto-<hash>.js;
 * sem tag, embutido). Idempotente.
 */
export function injectProductScript(html: string, scriptTag?: string | null): string {
  if (html.includes(PRODUCT_SCRIPT_ATTR) || !hasProductPage(html)) return html;
  const tag =
    scriptTag ?? `<script ${PRODUCT_SCRIPT_ATTR}>${productScript().replace(/<\/(script)/gi, "<\\/$1")}</script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, (m) => `${tag}${m}`) : `${html}${tag}`;
}

/** Tag com o script da página de checkout embutido, à prova de "</script>". */
export function inlineCheckoutScriptTag(): string {
  return `<script ${CHECKOUT_SCRIPT_ATTR}>${checkoutScript().replace(/<\/(script)/gi, "<\\/$1")}</script>`;
}

/** Tag com o script da janela de pagamento embutido (ZIP), à prova de "</script>". */
export function inlinePaymentScriptTag(): string {
  return `<script ${PAYMENT_SCRIPT_ATTR}>${paymentScript().replace(/<\/(script)/gi, "<\\/$1")}</script>`;
}

/** Tag com o script de rastreamento embutido (ZIP), à prova de "</script>" no código. */
export function inlineTrackingScriptTag(): string {
  return `<script ${TRACKING_SCRIPT_ATTR}>${trackingScript().replace(/<\/(script)/gi, "<\\/$1")}</script>`;
}

/**
 * Coloca o estilo de delay no <head> e o script antes do </body>.
 * Idempotente: não duplica se já existir.
 */
export function injectRuntime(html: string, scriptTag: string): string {
  let out = html;
  // Substituições por função: o script embutido (ZIP) pode ter "$&", "$1"… que o
  // replace com texto interpretaria.
  if (!out.includes('id="os-delay-style"')) {
    out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, (m) => `${DELAY_STYLE}${m}`) : `${DELAY_STYLE}${out}`;
  }
  if (!out.includes("data-os-runtime")) {
    out = /<\/body>/i.test(out)
      ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, (m) => `${scriptTag}${m}`)
      : `${out}${scriptTag}`;
  }
  return out;
}
