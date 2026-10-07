/**
 * Montagem do ZIP de uma oferta (Fase 5). Formato em src/lib/export/options.ts.
 *
 * Cada página passa pelo mesmo renderPageHtml da prévia, com:
 * - links do funil relativos à pasta do arquivo ("../upsell/");
 * - rastreamento no modo "live" (pixels de verdade) e, com o eventos.php, o
 *   endereço relativo dele;
 * - scripts do Offer Studio como arquivos em assets/ (os-runtime-<hash>.js,
 *   os-tracking-<hash>.js), com o caminho relativo certo;
 * - SEO (título, descrição, favicon, imagem de compartilhamento) e dados da
 *   empresa; páginas de obrigado/upsell/downsell ficam fora do Google por
 *   padrão (quando a pessoa não escolheu nada no SEO da página nem da oferta);
 * - metas de verificação de domínio dos códigos livres sempre no <head> de
 *   verdade (nunca só dentro do bloco que espera o consentimento: quem
 *   verifica o domínio não roda JavaScript — gateCode, como na prévia);
 * - teste A/B: a versão de cada pasta (LayoutFile.version) no rastreamento —
 *   os_versao em todo evento e a marca no checkout (src/runtime/tracking);
 * - canonical/alternate e o script de chegada (barra no fim, celular, versão
 *   A/B vista, file://);
 * - /os-assets/<arquivo> → assets/<arquivo> (também dentro dos CSS, que são
 *   copiados com as referências reescritas, recursivamente); com o endereço no
 *   ar, a imagem de compartilhamento (og:image, twitter:image) com endereço
 *   completo.
 * O divisor A/B de cada página é montado depois das versões: ele copia do
 * <head> da versão de controle as metas de verificação, de compartilhamento e
 * o ícone (o endereço da página é o que verificadores e o WhatsApp leem).
 * Arquivos que faltarem no disco viram aviso (o ZIP sai mesmo assim).
 */
import { createHash } from "node:crypto";
import { UserError } from "@/lib/errors";
import {
  absoluteUrl,
  absolutizeShareImages,
  applyHeadLinks,
  earlyScriptTag,
  ensureHeadMetas,
  hasRelativeShareImage,
  insertEarlyHead,
  liveBaseUrl,
  shareHead,
  verificationMetas,
} from "@/lib/export/head";
import { type LayoutFile, shortHash } from "@/lib/export/layout";
import { NOT_FOUND_FILE, notFoundHtml } from "@/lib/export/not-found";
import { optimizeHtml } from "@/lib/export/optimize";
import { EXPORT_STEP, type ExportOptions, type ServerEventVendor } from "@/lib/export/options";
import {
  ASSETS_DIR,
  fileDir,
  isRewritableAsset,
  rebaseRelativeUrl,
  relativeDir,
  rewriteAssetRefs,
  storageKeyOf,
  upPrefix,
} from "@/lib/export/paths";
import {
  PAGAMENTO_CONFIG_FILE,
  PAGAMENTO_FILE,
  PAGAMENTO_HTACCESS_FILE,
  pagamentoConfigPhp,
  pagamentoHtaccess,
  pagamentoPhp,
} from "@/lib/export/payment-php";
import {
  EVENTOS_CONFIG_FILE,
  EVENTOS_FILE,
  eventosConfigPhp,
  eventosPhp,
  HTACCESS_FILE,
  htaccess,
  type ServerEventPixel,
} from "@/lib/export/php";
import { leiaMe } from "@/lib/export/readme";
import { splitterHtml } from "@/lib/export/splitter";
import { companyMarkersIn, companyMarkersWarning, OG_IMAGE_WARNING } from "@/lib/export/warnings";
import { effectiveSeo, type OfferSettings, parseOfferSettings, parsePageSeo, type Seo } from "@/lib/offer-settings";
import { parsePageCode } from "@/lib/page-code";
import { renderPageHtml } from "@/lib/page-render";
import { METHOD_LABEL } from "@/lib/payments/rules";
import { PAYMENT_SCRIPT_ATTR, paymentScript, runtimeScript, trackingScript } from "@/lib/runtime-bundle";
import { seoRenderFrom } from "@/lib/seo-render";
import { getObject, objectInfo, storagePath } from "@/lib/storage";
import { blankPageHtml } from "@/lib/templates";
import { loadTracking } from "@/lib/tracking/config";
import { TRACKING_SCRIPT_ATTR } from "@/lib/tracking/runtime-config";
import { explicitPageCodeCategory } from "@/lib/tracking/schema";
import { wheelRenderData } from "@/lib/wheel-prizes";
import { readPixelTokenForServerFile } from "@/server/services/tracking";
import { NO_PAGES_MESSAGE } from "./keys";
import { loadPaymentExport, zipPaymentConfig, zipPaymentRender } from "./payments";
import { planFrom, README_FILE, SERVER_VENDOR_LABEL, uniqueVendors } from "./plan";
import { PRESERVE_COPY_MAX_BYTES } from "./preserve";
import { type ExportSource, loadExportSource, type SourceDocument, type SourcePage, serverEventPixels } from "./source";
import { writeZip, type ZipEntry } from "./zip";

export type ProgressFn = (progress: number, step: string) => void | Promise<void>;

export interface BuildInput {
  offerId: string;
  options: ExportOptions;
  /** Caminho absoluto do ZIP a gravar. */
  target: string;
  /**
   * Quando o ZIP foi pedido (Export.createdAt). A data dos arquivos do ZIP é a
   * maior entre esta e a última alteração da oferta: um ZIP novo (mesmo só com
   * opções diferentes) sempre sai "mais novo" que o anterior, e o mesmo pedido
   * gera o mesmo ZIP.
   */
  requestedAt?: Date;
  onProgress?: ProgressFn;
}

export interface BuildResult {
  bytes: number;
  warnings: string[];
  /** Entradas do ZIP (para testes e diagnóstico). */
  entries: string[];
}

/** Script do Offer Studio como arquivo com hash no nome (cache longo sem ficar desatualizado). */
function scriptFile(prefix: string, code: string) {
  const hash = createHash("sha256").update(code).digest("hex").slice(0, 12);
  return { name: `${prefix}-${hash}.js`, data: Buffer.from(code, "utf8") };
}

export const SCRIPTS_FAILED_MESSAGE =
  "Não foi possível preparar os scripts das páginas (rastreamento e botões). Feche e abra o Offer Studio e tente de novo.";

/** Scripts do Offer Studio compilados (os mesmos da prévia); a janela de pagamento só com pagamento na página. */
function pageScripts(withPayments: boolean) {
  try {
    return {
      runtime: scriptFile("os-runtime", runtimeScript()),
      tracking: scriptFile("os-tracking", trackingScript()),
      payment: withPayments ? scriptFile("os-pagamento", paymentScript()) : null,
    };
  } catch (err) {
    console.error("[export] os scripts das páginas não compilaram:", err);
    throw new UserError(SCRIPTS_FAILED_MESSAGE);
  }
}

/** Tokens do eventos.php (lidos só aqui, no worker). Pixel com token ilegível vira aviso. */
async function serverPixelsWithTokens(offerId: string, warnings: string[]): Promise<ServerEventPixel[]> {
  const out: ServerEventPixel[] = [];
  for (const row of await serverEventPixels(offerId)) {
    let token: string | null = null;
    try {
      token = await readPixelTokenForServerFile(row.id);
    } catch {
      warnings.push(
        `O token do pixel ${row.pixelId} (${SERVER_VENDOR_LABEL[row.vendor]}) não pôde ser lido: salve o token de novo na aba “Pixels e rastreamento” e gere outro ZIP.`,
      );
    }
    if (token) out.push({ vendor: row.vendor, pixelId: row.pixelId, token, testEventCode: row.testEventCode });
  }
  return out;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Tipos de página que ninguém deveria achar pelo Google (vêm depois da compra). */
const AFTER_PURCHASE_TYPES = new Set(["THANK_YOU", "UPSELL", "DOWNSELL"]);

/**
 * SEO da página no ZIP: o da página completando com o da oferta. Página de
 * obrigado/upsell/downsell sem escolha de "aparecer no Google" (nem na página
 * nem na oferta) sai com noindex.
 */
export function exportSeo(
  settings: OfferSettings,
  page: Pick<SourcePage, "seo" | "type">,
): {
  seo: Seo;
  hiddenByType: boolean;
} {
  const pageSeo = parsePageSeo(page.seo);
  const seo = effectiveSeo(settings, pageSeo);
  const hiddenByType = !seo.noindex && pageSeo.noindex === null && AFTER_PURCHASE_TYPES.has(page.type);
  return { seo: hiddenByType ? { ...seo, noindex: true } : seo, hiddenByType };
}

/** Idioma declarado no <html lang> de uma página ("" se não tiver). */
function htmlLang(html: string): string {
  const m = /<html\b(?:[^>"']|"[^"]*"|'[^']*')*?\slang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(html);
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
}

/** Monta o ZIP e grava em `target`. Lança UserError com mensagem pronta quando não dá. */
export async function buildExport(input: BuildInput): Promise<BuildResult> {
  const progress: ProgressFn = input.onProgress ?? (() => {});
  await progress(3, EXPORT_STEP.reading);

  const source = await loadExportSource(input.offerId);
  if (!source.pages.length) throw new UserError(NO_PAGES_MESSAGE);
  const early: string[] = [];
  const serverPixels = input.options.serverEvents ? await serverPixelsWithTokens(input.offerId, early) : [];
  const serverVendors: ServerEventVendor[] = uniqueVendors(serverPixels);
  const payment = await loadPaymentExport(input.offerId);
  const plan = planFrom(source, input.options, serverVendors, payment);
  const warnings = [...plan.warnings, ...early];
  const { layout } = plan;

  const settings = parseOfferSettings(source.offer.settings);
  const liveBase = liveBaseUrl(source.offer.liveUrl);
  const { runtime, tracking, payment: paymentJs } = pageScripts(payment !== null);

  /** Conteúdo gerado (páginas, scripts, PHP, LEIA-ME), por caminho no ZIP. */
  const generated = new Map<string, Buffer>();
  generated.set(`${ASSETS_DIR}${runtime.name}`, runtime.data);
  generated.set(`${ASSETS_DIR}${tracking.name}`, tracking.data);
  if (paymentJs) generated.set(`${ASSETS_DIR}${paymentJs.name}`, paymentJs.data);
  /** Arquivos /os-assets/ citados (a copiar para assets/). */
  const wanted = new Set<string>();
  const brokenLinks = new Set<string>();
  /** Páginas que saíram fora do Google só pelo tipo (obrigado/upsell). */
  const hiddenByType = new Set<string>();
  let relativeShareImage = false;
  /** Páginas que sairiam com {{EMPRESA}}, {{CNPJ}}… no lugar dos dados da empresa. */
  const unfilledCompany = new Map<string, { name: string; markers: Set<string> }>();

  const pages = new Map(source.pages.map((p) => [p.id, p]));
  const docs = new Map<string, SourceDocument>();
  for (const p of source.pages) for (const v of p.variants) for (const d of v.documents) docs.set(d.id, d);
  // Roleta de desconto: prêmios de todas as páginas (a página de vendas usa o prêmio ganho em outra).
  const wheel = wheelRenderData(
    [...docs.values()].map((d) => d.html),
    source.links,
    source.offer.id,
  );
  /** HTML final de cada página (o divisor copia metas da versão de controle). */
  const rendered = new Map<string, string>();
  /** HTML da primeira página do ZIP que não é o divisor (idioma do 404.html). */
  const firstHtml = () => rendered.get(layout.files.find((f) => !f.splitter)?.path ?? "") ?? "";

  async function renderFile(file: LayoutFile, page: SourcePage, doc: SourceDocument | null): Promise<string> {
    const rel = upPrefix(file.dir);
    const pageHref = (id: string) => {
      const dir = layout.pageDirs[id];
      if (dir === undefined) {
        brokenLinks.add(page.name);
        return "#";
      }
      return relativeDir(file.dir, dir);
    };
    const loaded = await loadTracking({
      offerId: source.offer.id,
      pageId: page.id,
      mode: "live",
      pageHref,
      serverEndpoint: plan.serverFiles ? `${rel}${EVENTOS_FILE}` : null,
      // Teste A/B: a versão desta pasta vai em cada evento e marca o checkout.
      variant: file.version,
    });
    const pageSeo = exportSeo(settings, page);
    if (pageSeo.hiddenByType) hiddenByType.add(page.name);
    const seo = seoRenderFrom(pageSeo.seo, settings.language);
    const pageCode = parsePageCode(page.customCode);
    let out = renderPageHtml(doc?.html ?? blankPageHtml(page.name), {
      links: source.links,
      pageHref,
      runtimeTag: `<script src="${rel}${ASSETS_DIR}${runtime.name}" data-os-runtime></script>`,
      customCode: { ...pageCode, category: explicitPageCodeCategory(page.customCode) },
      tracking: loaded
        ? {
            config: loaded.config,
            scriptTag: `<script src="${rel}${ASSETS_DIR}${tracking.name}" ${TRACKING_SCRIPT_ATTR}></script>`,
            offerCode: loaded.settings.customCode,
          }
        : null,
      company: settings.company,
      seo,
      wheel,
      // Pagamento na página: o pagamento.php da raiz e a página de obrigado, relativos a esta pasta.
      payments: zipPaymentRender(payment, {
        rel,
        pageHref,
        scriptTag: paymentJs
          ? `<script src="${rel}${ASSETS_DIR}${paymentJs.name}" ${PAYMENT_SCRIPT_ATTR}></script>`
          : "",
      }),
    });
    // Verificação de domínio (Meta, Google…) colada nos códigos livres: sempre
    // no <head> de verdade. O código em espera do "Aceitar" já a deixa de fora
    // do bloco (gateCode, como na prévia); aqui só volta a que ficou num código
    // descartado por não fechar (sem repetir as que já estão no <head>).
    out = ensureHeadMetas(out, [
      ...verificationMetas(loaded?.settings.customCode.head),
      ...verificationMetas(pageCode.head),
    ]);
    const href = (dir: string) => (liveBase ? absoluteUrl(liveBase, dir) : relativeDir(file.dir, dir));
    // Cópias (versões e celular) apontam para a principal; a principal, com o
    // endereço no ar conhecido, aponta para ela mesma (endereço completo).
    const canonical =
      file.canonicalDir !== null ? href(file.canonicalDir) : liveBase ? absoluteUrl(liveBase, file.dir) : null;
    out = applyHeadLinks(out, {
      canonical,
      mobileAlternate: file.mobileAlternateDir ? href(file.mobileAlternateDir) : null,
    });
    out = insertEarlyHead(out, earlyScriptTag({ mobileDir: file.mobileDir, ab: file.ab }));
    out = rewriteAssetRefs(out, rel, wanted);
    // Imagem de compartilhamento: o Facebook/WhatsApp só leem endereço completo.
    if (liveBase) out = absolutizeShareImages(out, absoluteUrl(liveBase, file.dir));
    else if (hasRelativeShareImage(out)) relativeShareImage = true;
    if (input.options.optimizeHtml && !file.preserveJs) out = optimizeHtml(out);
    const markers = companyMarkersIn(out);
    if (markers.length) {
      const entry = unfilledCompany.get(page.id) ?? { name: page.name, markers: new Set<string>() };
      for (const m of markers) entry.markers.add(m);
      unfilledCompany.set(page.id, entry);
    }
    return out;
  }

  /** index.html do divisor: redireciona, com as metas da versão de controle no <head>. */
  function renderSplitter(file: LayoutFile, page: SourcePage): string {
    const split = file.splitter as NonNullable<LayoutFile["splitter"]>;
    const controlDir = `${file.dir}${split.variants[0]?.folder ?? ""}`;
    const control = rendered.get(`${controlDir}index.html`) ?? "";
    const rebase = (url: string) => rebaseRelativeUrl(url, controlDir, file.dir);
    const head = shareHead(control, rebase);
    const seoTitle = exportSeo(settings, page).seo.title.trim();
    return splitterHtml({
      variants: split.variants,
      key: split.key,
      // Aparece na aba por um instante (e no compartilhamento, se a página não
      // tiver og:title): o título de SEO, senão o da versão de controle.
      title: seoTitle || source.offer.name,
      titleHtml: seoTitle ? null : head.titleHtml,
      lang: settings.language || htmlLang(control) || "pt-BR",
      headTags: head.tags.join("\n"),
    });
  }

  // As versões primeiro; os divisores depois (eles copiam metas da versão de controle).
  const pageFiles = [...layout.files.filter((f) => !f.splitter), ...layout.files.filter((f) => f.splitter)];
  for (let i = 0; i < pageFiles.length; i++) {
    const file = pageFiles[i];
    await progress(
      5 + Math.round((i / Math.max(1, pageFiles.length)) * 45),
      EXPORT_STEP.pages(i + 1, pageFiles.length),
    );
    const page = pages.get(file.pageId) as SourcePage;
    const html = file.splitter
      ? renderSplitter(file, page)
      : await renderFile(file, page, docs.get(file.documentId ?? "") ?? null);
    rendered.set(file.path, html);
    generated.set(file.path, Buffer.from(html, "utf8"));
  }

  if (brokenLinks.size) {
    const names = [...brokenLinks].map((n) => `“${n}”`).join(", ");
    warnings.push(
      `Há links para páginas que não existem mais em ${names}: eles ficaram sem destino. Corrija no editor e gere o ZIP de novo.`,
    );
  }
  if (relativeShareImage && !warnings.includes(OG_IMAGE_WARNING)) warnings.push(OG_IMAGE_WARNING);
  const companyWarning = companyMarkersWarning(
    [...unfilledCompany.values()].map((p) => ({ name: p.name, markers: [...p.markers] })),
  );
  if (companyWarning) warnings.push(companyWarning);

  await progress(52, EXPORT_STEP.files);

  /** Arquivos copiados do disco (caminho no ZIP → arquivo no storage). */
  const copied = new Map<string, { key: string; size: number }>();
  const missing = new Set<string>();

  // "Preservar JS": arquivos nos caminhos originais do site (e cópias nas
  // pastas das versões), nunca no lugar de outro arquivo do ZIP nem arquivos
  // que a hospedagem executaria (a prévia já decidiu e avisou: plan.preserve).
  for (const entry of plan.preserve.entries) {
    const info = await objectInfo(entry.key);
    if (!info) {
      if (entry.primary) missing.add(entry.zipPath);
      continue;
    }
    // Cópia de arquivo grande numa pasta de versão/celular: fica só o caminho original.
    if (!entry.primary && info.size > PRESERVE_COPY_MAX_BYTES) continue;
    if (isRewritableAsset(entry.zipPath)) {
      const data = await getObject(entry.key);
      if (data.includes("/os-assets/") || data.includes("\\/os-assets\\/")) {
        const text = rewriteAssetRefs(data.toString("utf8"), upPrefix(fileDir(entry.zipPath)), wanted);
        generated.set(entry.zipPath, Buffer.from(text, "utf8"));
        continue;
      }
    }
    copied.set(entry.zipPath, { key: entry.key, size: info.size });
  }

  // Arquivos /os-assets/ (e o que os CSS citam, recursivamente).
  const queue = [...wanted];
  const seen = new Set<string>();
  while (queue.length) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const zipPath = `${ASSETS_DIR}${file}`;
    const key = storageKeyOf(file);
    const info = await objectInfo(key);
    if (!info) {
      missing.add(zipPath);
      continue;
    }
    if (isRewritableAsset(file)) {
      const data = await getObject(key);
      if (data.includes("/os-assets/") || data.includes("\\/os-assets\\/")) {
        const found = new Set<string>();
        const text = rewriteAssetRefs(data.toString("utf8"), "", found, { inAssets: true });
        generated.set(zipPath, Buffer.from(text, "utf8"));
        for (const f of found) if (!seen.has(f)) queue.push(f);
        continue;
      }
    }
    copied.set(zipPath, { key, size: info.size });
  }
  if (missing.size) {
    const list = [...missing].sort().slice(0, 3).join(", ");
    warnings.push(
      `${missing.size} arquivo(s) não foram encontrados no seu computador e ficaram de fora (ex.: ${list}). As páginas abrem, mas essas imagens ou estilos vão faltar.`,
    );
  }

  // eventos.php (+ eventos-dados/config.php e o .htaccess da pasta dos tokens)
  if (plan.serverFiles) {
    generated.set(EVENTOS_FILE, Buffer.from(eventosPhp(), "utf8"));
    generated.set(EVENTOS_CONFIG_FILE, Buffer.from(eventosConfigPhp(serverPixels), "utf8"));
    generated.set(HTACCESS_FILE, Buffer.from(htaccess(), "utf8"));
  }

  // pagamento.php (+ pagamento-dados/config.php com a chave e o .htaccess que bloqueia a pasta)
  if (payment) {
    generated.set(PAGAMENTO_FILE, Buffer.from(pagamentoPhp(), "utf8"));
    generated.set(
      PAGAMENTO_CONFIG_FILE,
      Buffer.from(pagamentoConfigPhp(await zipPaymentConfig(payment, layout.pageDirs)), "utf8"),
    );
    generated.set(PAGAMENTO_HTACCESS_FILE, Buffer.from(pagamentoHtaccess(), "utf8"));
  }

  // 404.html: "não encontrada" (e, na Cloudflare Pages, nada de entregar o divisor para qualquer caminho)
  generated.set(NOT_FOUND_FILE, Buffer.from(notFoundHtml(settings.language || htmlLang(firstHtml())), "utf8"));

  // LEIA-ME.txt (com a data da última alteração da oferta)
  const changed = source.offer.updatedAt;
  const withMobile = new Set(layout.files.filter((f) => f.kind === "mobile").map((f) => f.pageId));
  generated.set(
    README_FILE,
    Buffer.from(
      leiaMe({
        offerName: source.offer.name,
        date: `${pad2(changed.getDate())}/${pad2(changed.getMonth() + 1)}/${changed.getFullYear()}`,
        pages: source.pages
          .map((p) => ({
            name: p.name,
            dir: layout.pageDirs[p.id] ?? "",
            mobile: withMobile.has(p.id),
            home: p.isHome,
          }))
          .sort((a, b) => Number(b.home) - Number(a.home))
          .map(({ name, dir, mobile }) => ({ name, dir, mobile })),
        splits: layout.splits.map((s) => ({
          page: s.page,
          dir: s.dir,
          splitter: s.splitter,
          variants: s.variants.map((v) => ({ name: v.name, folder: v.folder, percent: v.percent })),
        })),
        serverEvents: serverVendors.map((v) => SERVER_VENDOR_LABEL[v]),
        payments: payment
          ? payment.products.map((p) => ({
              name: p.name,
              // Texto simples: o espaço do Intl ("MX$ 497,00") vira espaço comum.
              price: p.price.replace(/\s/g, " "),
              methods: p.methods.map((m) => METHOD_LABEL[m]),
            }))
          : [],
        preserveJs: plan.preserveJsPages,
        hiddenFromSearch: [...hiddenByType],
        warnings,
      }),
      "utf8",
    ),
  );

  // ZIP
  await progress(60, EXPORT_STEP.zipping);
  const entries: ZipEntry[] = [];
  for (const [path, data] of generated) entries.push({ path, data });
  for (const [path, { key, size }] of copied) {
    if (!generated.has(path)) entries.push({ path, file: storagePath(key), size });
  }
  // A data dos arquivos: a mais nova entre a alteração da oferta e o pedido do ZIP.
  const requested = input.requestedAt?.getTime() ?? 0;
  const mtime = new Date(Math.max(source.offer.updatedAt.getTime(), requested));
  let lastReport = 0;
  const bytes = await writeZip(entries, input.target, {
    mtime,
    onBytes: (written, expected) => {
      const t = Date.now();
      if (t - lastReport < 500) return;
      lastReport = t;
      const share = expected > 0 ? Math.min(1, written / expected) : 1;
      void progress(60 + Math.round(share * 38), EXPORT_STEP.zipping);
    },
  });
  return { bytes, warnings, entries: entries.map((e) => e.path).sort() };
}

/** Chave da escolha do divisor de uma página (a mesma do layout; exportada para os testes). */
export const splitterKeyFor = (pageId: string) => shortHash(pageId);

export type { ExportSource };
