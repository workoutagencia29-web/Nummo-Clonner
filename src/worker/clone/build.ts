/**
 * Monta a cópia a partir das capturas: baixa todos os arquivos para o storage,
 * reescreve os caminhos e gera as duas saídas de cada dispositivo:
 *
 * - EDITABLE: DOM renderizado, sem scripts (exceto players de vídeo), 100% editável.
 *   O que os scripts faziam em widgets comuns (botões que navegavam por
 *   onclick, FAQ/acordeões, capas de vídeo "clique para carregar", animações
 *   de entrada) vira HTML comum ou ganchos data-os-* executados pelo runtime
 *   do Offer Studio (src/runtime/clone-compat.ts).
 * - PRESERVE_JS: HTML original com os scripts do site (menos rastreadores) e
 *   arquivos espelhados nos caminhos originais — para quizzes e páginas-app.
 *   Os scripts do próprio site ficam nos caminhos originais (servidos pelo
 *   assetMap) para os imports relativos entre eles continuarem funcionando.
 *
 * Os demais arquivos viram /os-assets/<sha256>.<ext>. O que ainda depender do
 * site original (vídeos não baixados, dados buscados pelos scripts) aparece
 * nos avisos da revisão.
 */
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";
import { isHlsMime, isHlsUrl, matchVideoHost, videoProviderLabel } from "@/detection/videos";
import { restoreDoctype } from "@/lib/doctype";
import { PRESERVE_JS_META, stripEditorMarkers } from "@/lib/editor-html";
import { env } from "@/lib/env";
import { putContentAddressed, putFileContentAddressed, putObject } from "@/lib/storage";
import type { LogFn, VirtualSite } from "./capture";
import { decodeText, fixMetaCharset } from "./charset";
import { convertJsNavigation, detectCheckouts, markCheckouts } from "./checkouts";
import { collectCssRefs, rewriteCss } from "./css";
import { convertToggles, markVideoFacades, normalizeAnimations, sanitizeScriptUrls } from "./editable-compat";
import { type createFetcher, formatLimit } from "./fetcher";
import { suggestFunnel } from "./funnel";
import { collectHtmlRefs, documentBase, type HtmlRef, removeBaseTag, rewriteHtmlRefs } from "./html-assets";
import { normalizeLazy } from "./lazy";
import { isSyntheticOrigin, relativeToPage, syntheticSource } from "./synthetic";
import { removeTrackers } from "./trackers";
import {
  ASSET_PREFIX,
  type Capture,
  type CapturedResponse,
  type CheckoutCandidate,
  type ClonedAsset,
  type CloneModeValue,
  type CloneResult,
  type CloneWarning,
  type Device,
  type DeviceOutput,
  type FunnelSuggestion,
  type RemovedTracker,
  type VideoEmbed,
  type VslDelay,
} from "./types";
import { absolutize, extensionFor, safeDecode } from "./urls";
import { detectVideos, extractDelay, unhideDelayed } from "./vsl";

type Fetcher = ReturnType<typeof createFetcher>;

export interface BuildOptions {
  jobId: string;
  captures: Capture[];
  fetcher: Fetcher;
  log: LogFn;
  maxVideoBytes: number;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  startedAt: number;
  /** Importação: arquivos locais do ZIP/HTML colado. */
  virtualSite?: VirtualSite;
  /** Nome do arquivo importado (ZIP): título da cópia quando a página não tem <title>. */
  fileName?: string;
}

const VIDEO_EXT = /\.(mp4|webm|m4v|mov|ogv)(\?|$)/i;
/** Scripts que continuam no modo Editável: players de vídeo e dados estruturados. */
const KEEP_SCRIPT_RE =
  /converteai\.net|pandavideo|vturb|player\.vimeo|youtube\.com\/iframe_api|fast\.wistia|vidalytics/i;
const URL_IN_CODE_RE = /(?:https?:)?\/\/[^\s"'`<>()\\]+/gi;

/**
 * Script de player de vídeo (hosts de src/detection/videos.ts)? Inline: só
 * carregadores pequenos que citam um .js de player.
 */
function isPlayerScript(src: string, code: string, baseUrl: string): boolean {
  const isPlayerUrl = (raw: string) => {
    try {
      return matchVideoHost(new URL(raw.replace(/^\/\//, "https://"), baseUrl).href) !== null;
    } catch {
      return false;
    }
  };
  if (src) return KEEP_SCRIPT_RE.test(src) || isPlayerUrl(src);
  if (code.length >= 4000) return false;
  const urls = [...code.replace(/\\\//g, "/").matchAll(URL_IN_CODE_RE)].map((m) => m[0]);
  return KEEP_SCRIPT_RE.test(code) || urls.some((u) => /\.js(?:[?#]|$)/i.test(u) && isPlayerUrl(u));
}

function kindFor(ext: string, ref?: HtmlRef["kind"]): ClonedAsset["kind"] {
  if (ref === "icon") return "ICON";
  if (["woff2", "woff", "ttf", "otf", "eot"].includes(ext)) return "FONT";
  if (["mp4", "webm", "m4v", "mov", "ogv", "mp3"].includes(ext)) return "VIDEO";
  if (ext === "css") return "STYLE";
  if (ext === "js" || ext === "mjs") return "SCRIPT";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp"].includes(ext)) return "IMAGE";
  if (ext === "pdf") return "DOCUMENT";
  return "OTHER";
}

/**
 * A URL está exatamente nesta origem? Comparar por prefixo aceitaria
 * "http://importado.offerstudio.site.com/…" como se fosse do ZIP.
 */
function isOnOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** Por que um vídeo ficou no endereço original (não é falha: ele continua tocando de lá). */
type SkippedVideoReason = "OPTION" | "TOO_LARGE" | "HLS";

/**
 * Baixa e guarda arquivos, com cache por URL (o mesmo arquivo usado por desktop,
 * celular e pelos dois modos é baixado uma vez só).
 */
class AssetStore {
  private readonly resolved = new Map<string, Promise<string | null>>();
  private readonly cssInProgress = new Set<string>();
  /** Conteúdos já baixados para leitura (ex.: scripts lidos atrás de imports). */
  private readonly fetched = new Map<string, { body: Buffer; contentType: string }>();
  readonly assets = new Map<string, ClonedAsset>();
  failed = 0;
  failedUrls: string[] = [];
  /** Vídeos mantidos no endereço original de propósito (opção, limite, HLS). */
  readonly skippedVideos = new Map<string, SkippedVideoReason>();
  /** Vídeos baixados para a cópia. */
  readonly downloadedVideos = new Set<string>();
  bytes = 0;
  private readonly limit = pLimit(6);

  constructor(
    private readonly responses: Map<string, CapturedResponse>,
    private readonly opts: BuildOptions,
  ) {}

  private record(asset: ClonedAsset) {
    if (!this.assets.has(asset.key)) {
      this.assets.set(asset.key, asset);
      this.bytes += asset.bytes;
    }
  }

  private fail(url: string, reason: string) {
    // Cancelada: os downloads param todos juntos; não é arquivo quebrado nem linha de log.
    if (this.opts.signal?.aborted) return;
    this.failed++;
    if (this.failedUrls.length < 30) this.failedUrls.push(url);
    this.opts.log("WARN", `Não foi possível baixar: ${reason}`, url);
  }

  /** Motivo de um arquivo que não existe na importação (ZIP ou HTML colado). */
  private missingLocalReason(origin: string): string {
    return syntheticSource(origin) === "HTML"
      ? "o HTML colado cita este arquivo por um caminho relativo, e sem o “Link de origem” não há de onde baixá-lo. Cole de novo informando o link da página original."
      : "arquivo não está no ZIP";
  }

  /** Conteúdo de um arquivo: da captura, ou baixado agora. `quiet`: falha não conta nem vai para o log. */
  private async fetchBytes(url: string, quiet = false): Promise<{ body: Buffer; contentType: string } | null> {
    const captured = this.responses.get(url);
    if (captured) return { body: captured.body, contentType: captured.contentType };
    const cached = this.fetched.get(url);
    if (cached) return cached;
    const virtual = this.opts.virtualSite;
    if (virtual && isOnOrigin(url, virtual.origin)) {
      // Mesma decodificação da captura (capture.ts): "%" solto ou bytes Latin-1 nunca lançam erro.
      const file = virtual.get(safeDecode(new URL(url).pathname));
      if (file) return file;
      if (!virtual.fallthrough) {
        if (!quiet) this.fail(url, this.missingLocalReason(virtual.origin));
        return null;
      }
    }
    const res = await this.opts.fetcher.fetchResource(url);
    if (!res.ok) {
      if (!quiet) this.fail(url, res.error ?? `resposta ${res.status}`);
      return null;
    }
    return { body: res.body, contentType: res.contentType };
  }

  /** Vídeo que fica no endereço original de propósito (não é falha nem "arquivo externo" genérico). */
  keepVideo(url: string, reason: SkippedVideoReason) {
    if (!this.skippedVideos.has(url)) this.skippedVideos.set(url, reason);
  }

  /** Texto de um arquivo (captura ou download), sem contar falha. */
  async text(url: string): Promise<{ text: string; contentType: string } | null> {
    if (this.opts.signal?.aborted) return null;
    const got = await this.limit(() => this.fetchBytes(url, true).catch(() => null));
    if (!got) return null;
    if (!this.responses.has(url)) this.fetched.set(url, got);
    return { text: decodeText(got.body, got.contentType).text, contentType: got.contentType };
  }

  /**
   * Arquivo comum (imagem, fonte, vídeo, script) → caminho /os-assets/…
   * `optional`: arquivo que só talvez exista (ex.: chunk achado num script);
   * se falhar, não conta como arquivo quebrado.
   */
  asset(url: string, refKind?: HtmlRef["kind"], optional = false): Promise<string | null> {
    const existing = this.resolved.get(url);
    if (existing) return existing;
    const task = this.limit(async () => {
      if (this.opts.signal?.aborted) return null;
      try {
        if (refKind === "media" || VIDEO_EXT.test(url)) return await this.video(url);
        const got = await this.fetchBytes(url, optional);
        if (!got) return null;
        const ext = extensionFor(url, got.contentType);
        const stored = await putContentAddressed(got.body, ext);
        this.record({
          key: stored.key,
          sha256: stored.sha256,
          kind: kindFor(ext, refKind),
          mime: got.contentType.split(";")[0] || "application/octet-stream",
          bytes: stored.bytes,
          sourceUrl: url,
        });
        return `${ASSET_PREFIX}${stored.sha256}.${ext}`;
      } catch (err) {
        if (!optional) this.fail(url, err instanceof Error ? err.message : "erro desconhecido");
        return null;
      }
    });
    this.resolved.set(url, task);
    return task;
  }

  /**
   * Vídeos: baixa o arquivo inteiro (a captura só tem pedaços), com limite de
   * tamanho. Com "Não baixar", acima do limite ou em streaming (HLS), o vídeo
   * fica no endereço original — isso não é falha (ele continua tocando de lá).
   */
  private async video(url: string): Promise<string | null> {
    if (isHlsUrl(url)) {
      this.skippedVideos.set(url, "HLS");
      this.opts.log("INFO", "Vídeo em streaming (HLS) mantido no endereço original.", url);
      return null;
    }
    const max = this.opts.maxVideoBytes;
    if (!(max > 0)) {
      this.skippedVideos.set(url, "OPTION");
      this.opts.log("INFO", "Vídeo mantido no endereço original (opção “Não baixar”).", url);
      return null;
    }
    const tmpDir = path.join(env.dataDir, "tmp", "clone", this.opts.jobId);
    await mkdir(tmpDir, { recursive: true });
    const tmp = path.join(tmpDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.part`);
    try {
      const got = await this.opts.fetcher.downloadToFile(url, tmp, max);
      const ext = extensionFor(url, got.contentType);
      const stored = await putFileContentAddressed(tmp, ext);
      this.record({
        key: stored.key,
        sha256: stored.sha256,
        kind: "VIDEO",
        mime: got.contentType.split(";")[0] || "video/mp4",
        bytes: stored.bytes,
        sourceUrl: url,
      });
      this.downloadedVideos.add(url);
      this.opts.log("INFO", `Vídeo baixado (${(stored.bytes / 1024 / 1024).toFixed(1)} MB)`, url);
      return `${ASSET_PREFIX}${stored.sha256}.${ext}`;
    } catch (err) {
      await rm(tmp, { force: true });
      if ((err as { code?: unknown } | null)?.code === "TOO_LARGE") {
        this.skippedVideos.set(url, "TOO_LARGE");
        this.opts.log(
          "WARN",
          `Vídeo maior que o limite de ${formatLimit(max)}: mantido no endereço original (continua tocando de lá).`,
          url,
        );
        return null;
      }
      this.fail(url, err instanceof Error ? err.message : "erro ao baixar o vídeo");
      return null;
    }
  }

  /**
   * CSS: baixa, processa @import e url() recursivamente, e guarda a versão
   * reescrita. `optional`: se falhar, não conta como arquivo quebrado.
   */
  css(url: string, depth = 0, optional = false): Promise<string | null> {
    const existing = this.resolved.get(url);
    if (existing) return existing;
    if (this.opts.signal?.aborted) return Promise.resolve(null);
    if (depth > 6 || this.cssInProgress.has(url)) return Promise.resolve(null);
    this.cssInProgress.add(url);
    const task = (async () => {
      try {
        const got = await this.limit(() => this.fetchBytes(url, optional));
        if (!got) return null;
        const text = decodeText(got.body, got.contentType).text;
        const rewritten = await this.processCssText(text, url, depth);
        const stored = await putContentAddressed(Buffer.from(rewritten, "utf8"), "css");
        this.record({
          key: stored.key,
          sha256: stored.sha256,
          kind: "STYLE",
          mime: "text/css",
          bytes: stored.bytes,
          sourceUrl: url,
        });
        return `${ASSET_PREFIX}${stored.sha256}.css`;
      } catch (err) {
        if (!optional) this.fail(url, err instanceof Error ? err.message : "erro ao processar o CSS");
        return null;
      } finally {
        this.cssInProgress.delete(url);
      }
    })();
    this.resolved.set(url, task);
    return task;
  }

  /** Reescreve as referências de um texto CSS (arquivo ou <style>/style=""). */
  async processCssText(css: string, baseUrl: string, depth = 0): Promise<string> {
    const refs = collectCssRefs(css, baseUrl);
    const map = new Map<string, string>();
    await Promise.all(
      refs.map(async (ref) => {
        const target = ref.kind === "import" ? await this.css(ref.url, depth + 1) : await this.asset(ref.url);
        if (target) map.set(ref.url, target);
      }),
    );
    const out = rewriteCss(css, baseUrl, (abs) => map.get(abs) ?? null);
    // O arquivo é guardado em UTF-8: o @charset antigo (ex.: iso-8859-1) enganaria o navegador.
    return out.replace(/@charset\s+["'][^"']*["']\s*;/i, '@charset "UTF-8";');
  }
}

interface LocalizeOptions {
  /** Também baixa/reescreve scripts (Preservar JS). */
  includeScripts: boolean;
  /**
   * Preservar JS: scripts do próprio site ficam no caminho original (servidos
   * pelo assetMap), não em /os-assets/ — senão imports relativos entre os
   * pedaços (`import("./chunk.js")`, publicPath "auto") quebram. O mapa recebe
   * URL absoluta → arquivo guardado (/os-assets/…).
   */
  sameOriginScripts?: { origin: string; kept: Map<string, string> };
  /** Origem interna de importação: o que não for baixado fica relativo à página. */
  localOrigin?: string | null;
}

/** Manifestos HLS citados no HTML (pela extensão .m3u8 ou pelo type do <source>). */
function hlsUrls($: CheerioAPI, refs: HtmlRef[], docBase: string): Set<string> {
  const out = new Set<string>();
  for (const ref of refs) if (ref.kind === "media" && isHlsUrl(ref.url)) out.add(ref.url);
  $("video[type], source[type]").each((_, el) => {
    const $el = $(el);
    if (!isHlsMime($el.attr("type"))) return;
    const src = $el.attr("src");
    const abs = src ? absolutize(src, docBase) : null;
    if (abs) out.add(abs);
  });
  return out;
}

/** Resolve todas as referências do HTML e reescreve para /os-assets/. */
async function localizeHtml($: CheerioAPI, baseUrl: string, store: AssetStore, options: LocalizeOptions) {
  const docBase = documentBase($, baseUrl);
  const refs = collectHtmlRefs($, baseUrl);
  // HLS: só o manifesto viria (os pedaços são relativos a ele) e quebraria o
  // vídeo; ele fica no endereço original, que é o que o aviso de vídeo diz.
  const hls = hlsUrls($, refs, docBase);
  const map = new Map<string, string>();
  for (const url of hls) {
    map.set(url, url);
    store.keepVideo(url, "HLS");
  }
  const sameOrigin = options.sameOriginScripts;
  await Promise.all(
    refs.map(async (ref) => {
      if (ref.kind === "iframe") return;
      if (ref.kind === "script" && !options.includeScripts) return;
      if (map.has(ref.url)) return;
      if (ref.kind === "script" && sameOrigin) {
        let u: URL | null = null;
        try {
          u = new URL(ref.url);
        } catch {
          u = null;
        }
        if (u && u.origin === sameOrigin.origin) {
          const stored = await store.asset(ref.url, "script");
          if (stored) {
            sameOrigin.kept.set(ref.url, stored);
            map.set(ref.url, `${u.pathname}${u.search}`);
          }
          return;
        }
      }
      const target = ref.kind === "stylesheet" ? await store.css(ref.url) : await store.asset(ref.url, ref.kind);
      if (target) map.set(ref.url, target);
    }),
  );
  // <style>: o CSS é resolvido contra o <base href> (como o navegador faz), não contra a URL da página.
  const styleTexts: { el: cheerio.Cheerio<import("domhandler").Element>; css: string }[] = [];
  $("style").each((_, el) => {
    styleTexts.push({ el: $(el), css: $(el).text() });
  });
  for (const { el, css } of styleTexts) {
    el.text(await store.processCssText(css, docBase));
  }
  rewriteHtmlRefs($, baseUrl, (abs) => map.get(abs) ?? null, { localOrigin: options.localOrigin });
  removeBaseTag($);
}

/**
 * Metadados que apontam para o site original e não servem na cópia: canonical
 * e og:url (o Google trataria a sua página como cópia da original), feeds e
 * links internos do WordPress. O SEO próprio é configurado na exportação.
 */
function removeOriginMeta($: CheerioAPI) {
  $(
    [
      'link[rel="canonical"]',
      'link[rel="shortlink"]',
      'link[rel="pingback"]',
      'link[rel="EditURI"]',
      'link[rel="wlwmanifest"]',
      'link[rel="alternate"][type*="rss"]',
      'link[rel="alternate"][type*="atom"]',
      'link[rel="alternate"][type*="json"]',
      'link[rel="alternate"][hreflang]',
      'link[rel="https://api.w.org/"]',
      'meta[property="og:url"]',
      'meta[name="generator"]',
    ].join(", "),
  ).remove();
}

/** Comentários HTML: no modo Editável saem todos; nos dois modos, os de rastreadores. */
const TRACKER_COMMENT_RE =
  /pixel|gtm|google tag|analytics|gtag|hotjar|clarity|tiktok|kwai|utmify|taboola|outbrain|pinterest|jivo|tawk|zendesk|intercom|crisp|hubspot|rd station|manychat|tidio|chat/i;
function removeComments($: CheerioAPI, all: boolean) {
  $("*")
    .contents()
    .each((_, node) => {
      if (node.type === "comment" && (all || TRACKER_COMMENT_RE.test(node.data ?? ""))) $(node).remove();
    });
  $.root()
    .contents()
    .each((_, node) => {
      if (node.type === "comment" && (all || TRACKER_COMMENT_RE.test(node.data ?? ""))) $(node).remove();
    });
}

/**
 * Modo Editável: remove scripts (menos players de vídeo e JSON-LD), atributos
 * on* e o código que sobraria em URLs `javascript:` e em data-os-href vindos
 * da página original (ver sanitizeScriptUrls). Também saem as marcas do editor
 * que a página já trouxesse (<os-script>, data-os-on-*, data-gjs-*…: viram
 * script ao salvar ou rodam no painel) e a marca de "Preservar JS".
 */
function stripScripts($: CheerioAPI, baseUrl: string) {
  stripEditorMarkers($);
  $(`meta[name="${PRESERVE_JS_META}"]`).remove();
  $("script").each((_, el) => {
    const node = $(el);
    const type = (node.attr("type") ?? "").toLowerCase();
    if (type === "application/ld+json") return;
    if (isPlayerScript(node.attr("src") ?? "", node.html() ?? "", baseUrl)) return;
    node.remove();
  });
  $('link[rel="modulepreload"], link[rel="preload"][as="script"], link[rel="prefetch"][as="script"]').remove();
  $("*").each((_, el) => {
    if (el.type !== "tag") return;
    for (const name of Object.keys(el.attribs)) {
      if (/^on[a-z]+$/i.test(name)) delete el.attribs[name];
    }
  });
  sanitizeScriptUrls($);
}

/** Endereço resolvido que pode ser gravado (http/https), ou null. */
function resolvedHttp(raw: string, base: string): URL | null {
  try {
    const u = new URL(raw, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * Links para páginas e formulários passam a apontar para o endereço absoluto
 * original; iframes relativos (formulário/quiz do próprio site) também, senão
 * carregariam do servidor da prévia/exportação. Na origem interna de
 * importação (`localOrigin`: ZIP ou HTML colado sem link de origem) o
 * endereço absoluto não existe: esses ficam como estavam (relativos).
 */
function absolutizeLinks($: CheerioAPI, baseUrl: string, localOrigin: string | null) {
  const fix = (el: import("domhandler").Element, attr: string, skip: (value: string) => boolean) => {
    const value = (el.attribs[attr] ?? "").trim();
    if (!value || skip(value)) return;
    const u = resolvedHttp(value, baseUrl);
    if (!u || (localOrigin && u.origin === localOrigin)) return;
    el.attribs[attr] = u.href;
  };
  const isSpecialLink = (v: string) => v.startsWith("#") || /^(mailto|tel|sms|javascript|whatsapp):/i.test(v);
  $("a[href], area[href]").each((_, el) => fix(el, "href", isSpecialLink));
  $("form[action]").each((_, el) => fix(el, "action", () => false));
  $("iframe[src], frame[src]").each((_, el) =>
    fix(el, "src", (v) => v.startsWith(ASSET_PREFIX) || /^(?:about|data|javascript|blob):/i.test(v)),
  );
}

/** Texto visível normalizado (para saber se desktop e celular são a mesma página). */
function visibleText(html: string) {
  const $ = cheerio.load(html);
  $("script, style, noscript, template").remove();
  return $("body").text().replace(/\s+/g, " ").trim().toLowerCase();
}

/** Semelhança entre os conjuntos de palavras de dois textos (0 a 1). */
function wordSimilarity(a: string, b: string) {
  const wa = new Set(a.split(" ").filter(Boolean));
  const wb = new Set(b.split(" ").filter(Boolean));
  if (!wa.size && !wb.size) return 1;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / (wa.size + wb.size - common);
}

/**
 * O site entrega a mesma página para desktop e celular? Sites que separam as
 * versões mandam HTML diferente conforme o aparelho. Conteúdo que muda a cada
 * visita (depoimentos em rotação, horários) não deve contar como diferença.
 */
function sameForAllDevices(desktop: Capture, mobile: Capture) {
  if (visibleText(desktop.originalHtml) === visibleText(mobile.originalHtml)) return true;
  return wordSimilarity(visibleText(desktop.renderedHtml), visibleText(mobile.renderedHtml)) >= 0.97;
}

/** Página-app/quiz: o conteúdo nasce do JavaScript → sugerir "Preservar JS". */
function looksLikeApp(capture: Capture) {
  const original = visibleText(capture.originalHtml);
  const rendered = visibleText(capture.renderedHtml);
  if (rendered.length > 400 && original.length < rendered.length * 0.2) return true;
  const quizWords = /\b(pergunta|etapa|passo \d|quiz|question|step \d)\b/i.test(rendered);
  const $ = cheerio.load(capture.renderedHtml);
  const hiddenSteps = $('[class*="step"], [class*="etapa"], [class*="question"], [data-step]').length;
  return quizWords && hiddenSteps >= 3;
}

/**
 * Arquivos que a cópia ainda busca em outro site. Ficam de fora: iframes e
 * scripts (players), `ignore` (vídeos mantidos de propósito, já avisados) e
 * a origem interna de importação (arquivos que faltam: já contados como falha).
 */
function remainingExternalRefs(html: string, baseUrl: string, ignore: Set<string>) {
  const $ = cheerio.load(html);
  return collectHtmlRefs($, baseUrl).filter(
    (r) =>
      r.kind !== "iframe" &&
      r.kind !== "script" &&
      /^https?:/i.test(r.url) &&
      !r.url.includes(ASSET_PREFIX) &&
      !ignore.has(r.url) &&
      !isSyntheticOrigin(r.url),
  );
}

interface EditableOutput {
  html: string;
  removed: RemovedTracker[];
  checkouts: CheckoutCandidate[];
  funnel: FunnelSuggestion[];
  videos: VideoEmbed[];
  delay: VslDelay | null;
}

interface BuildContext {
  /** Origem interna de importação (ZIP / HTML colado sem link de origem), ou null. */
  localOrigin: string | null;
}

async function buildEditable(capture: Capture, store: AssetStore, ctx: BuildContext): Promise<EditableOutput> {
  const baseUrl = capture.finalUrl;
  const $ = cheerio.load(capture.renderedHtml);
  normalizeLazy($);
  const removed = removeTrackers($, baseUrl);
  const extraction = extractDelay($);
  // Só o que CloneResult.delay prevê (os scripts removidos não vão para o banco).
  const delay: VslDelay | null = extraction ? { seconds: extraction.seconds, elements: extraction.elements } : null;
  const videos = detectVideos($, baseUrl);
  const checkouts = detectCheckouts($, baseUrl);
  markCheckouts($, baseUrl, checkouts);
  const funnel = suggestFunnel($, baseUrl, new Set(checkouts.map((c) => c.url)));
  unhideDelayed($);
  // O que os scripts faziam e que a página precisa sem eles (antes de removê-los).
  normalizeAnimations($);
  markVideoFacades($);
  convertToggles($);
  convertJsNavigation($, baseUrl, {
    localOrigin: ctx.localOrigin,
    // <a> é corrigido junto com os links quando o <base> sai; os demais já vão relativos à página.
    toLocal: (target, raw, anchor) => (anchor ? raw : relativeToPage(target, baseUrl)),
  });
  stripScripts($, baseUrl);
  removeOriginMeta($);
  removeComments($, true);
  // Links relativos seguem o <base href> (removido depois, em localizeHtml).
  absolutizeLinks($, documentBase($, baseUrl), ctx.localOrigin);
  await localizeHtml($, baseUrl, store, { includeScripts: false, localOrigin: ctx.localOrigin });
  // O cheerio reescreve qualquer doctype como <!DOCTYPE html>: volta o da página (ou nenhum).
  const html = restoreDoctype(fixMetaCharset($.html()), capture.renderedHtml);
  return { html, removed, checkouts, funnel, videos, delay };
}

// ─── Preservar JS ────────────────────────────────────────────────────────────

/** Imports relativos dentro de um módulo JS: import("./x.js"), from "./y.js", new URL("./z", import.meta.url). */
const MODULE_SPEC_RES: RegExp[] = [
  /\bimport\s*\(\s*(["'`])(\.{1,2}\/[^"'`\s]+?)\1\s*\)/g,
  /\b(?:from|import)\s*(["'])(\.{1,2}\/[^"'\s]+?)\1/g,
  /\bnew\s+URL\(\s*(["'`])(\.{1,2}\/[^"'`\s]+?)\1\s*,\s*import\.meta\.url\s*\)/g,
];
/** Dependências listadas pelo Vite (__vite__mapDeps: "assets/Quiz-abc.js", relativas à raiz). */
const VITE_DEP_RE = /(["'`])((?:assets|static)\/[\w\-./]+?\.(?:m?js|css))\1/g;
const MAX_DISCOVERED_FILES = 200;

function isJsResource(url: string, contentType: string): boolean {
  return /javascript|ecmascript/i.test(contentType) || /\.m?js(?:[?#]|$)/i.test(url);
}

/**
 * Pedaços de código (chunks) que só carregam depois de uma interação — por
 * isso não passaram pela captura — mas que os scripts do próprio site
 * importam por caminho relativo. Baixa-os para o assetMap (sem contar falha
 * quando não existirem).
 */
async function discoverModuleChunks(
  store: AssetStore,
  origin: string,
  seeds: string[],
  known: Set<string>,
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  let frontier = [...seeds];
  const visited = new Set<string>();
  for (let depth = 0; depth < 4 && frontier.length && found.size < MAX_DISCOVERED_FILES; depth++) {
    const next: string[] = [];
    for (const url of frontier) {
      if (visited.has(url) || found.size >= MAX_DISCOVERED_FILES) continue;
      visited.add(url);
      const got = await store.text(url);
      if (!got || !isJsResource(url, got.contentType)) continue;
      const specs = new Set<string>();
      for (const re of MODULE_SPEC_RES) {
        for (const m of got.text.matchAll(re)) {
          try {
            specs.add(new URL(m[2] ?? "", url).href);
          } catch {
            // ignora
          }
        }
      }
      if (got.text.includes("__vite__mapDeps")) {
        for (const m of got.text.matchAll(VITE_DEP_RE)) specs.add(new URL(`/${m[2]}`, origin).href);
      }
      for (const spec of specs) {
        const u = new URL(spec);
        u.hash = "";
        if (u.origin !== origin || known.has(u.href) || found.has(u.href)) continue;
        const stored = /\.css$/i.test(u.pathname)
          ? await store.css(u.href, 0, true)
          : await store.asset(u.href, "script", true);
        if (!stored) continue;
        found.set(u.href, stored);
        if (/\.m?js$/i.test(u.pathname)) next.push(u.href);
      }
    }
    frontier = next;
  }
  return found;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Endereços do site original dentro do código e dos atributos (inclusive a
 * forma escapada de JSON, `https:\/\/site.com\/…`). Grupo 1 = caminho.
 */
function originRefRe(origin: string): RegExp {
  const host = escapeRegExp(new URL(origin).host);
  return new RegExp(
    String.raw`(?:https?:)?(?:\\?\/){2}${host}(?=[\\/"'\x60\s?#,;)}\]]|$)((?:\\?\/[^\s"'\x60<>\\?#,;)}\]]*)*)`,
    "gi",
  );
}

/** Arquivo guardado que não é recurso (documento de iframe, resposta desconhecida). */
const DOCUMENT_TARGET_RE = /\.(?:bin|html)$/;

/** Caminho do site que a cópia tem no assetMap (arquivo ou pasta de arquivos). */
function servedPath(path: string, assetMap: Record<string, string>, prefixes: string[]): boolean {
  if (!path || path === "/") return false;
  const exact = assetMap[path];
  // Documentos (páginas, iframes) não: a cópia não os serve como página.
  if (exact) return !DOCUMENT_TARGET_RE.test(exact) && !/\.html?$/i.test(path) && !path.endsWith("/");
  if (path.endsWith("/")) return prefixes.some((p) => p.startsWith(path));
  return prefixes.some((p) => p.startsWith(`${path}?`) && !DOCUMENT_TARGET_RE.test(assetMap[p] ?? ""));
}

/** O endereço tem cara de arquivo ou de API (e não de página para navegar)? */
function looksLikeResource(path: string): boolean {
  return /\.[a-z0-9]{1,8}$/i.test(path) || /\/(?:wp-json|api|graphql)(?:\/|$)|admin-ajax/i.test(path);
}

/** Atributos de navegação (páginas, não arquivos): ficam apontando para o site original. */
const NAVIGATION_ATTRS: Record<string, string[]> = {
  a: ["href"],
  area: ["href"],
  form: ["action"],
  button: ["formaction"],
  input: ["formaction"],
  iframe: ["src"],
  frame: ["src"],
};

/**
 * Preservar JS: os scripts citam o site original por endereço absoluto
 * (ex.: `elementorFrontendConfig.urls.assets`, JSON de quizzes). O que a
 * cópia tem no assetMap passa a ser buscado pelo caminho (servido pela
 * cópia); o resto continua no site original e é devolvido para o aviso.
 */
function localizeOriginRefs($: CheerioAPI, origin: string, assetMap: Record<string, string>): string[] {
  const re = originRefRe(origin);
  const prefixes = Object.keys(assetMap);
  const remaining: string[] = [];
  const rewrite = (text: string): string =>
    text.replace(re, (whole, rawPath: string) => {
      const pathOnly = (rawPath ?? "").replace(/\\\//g, "/");
      if (servedPath(pathOnly, assetMap, prefixes)) return rawPath;
      if (looksLikeResource(pathOnly) && remaining.length < 50) remaining.push(whole.replace(/\\\//g, "/"));
      return whole;
    });

  $("script:not([src])").each((_, el) => {
    const type = ($(el).attr("type") ?? "").toLowerCase();
    if (type === "application/ld+json") return;
    const code = $(el).html() ?? "";
    const next = rewrite(code);
    if (next !== code) $(el).text(next);
  });
  $("*").each((_, node) => {
    if (node.type !== "tag") return;
    const skip = NAVIGATION_ATTRS[node.name.toLowerCase()] ?? [];
    for (const [name, value] of Object.entries(node.attribs)) {
      if (skip.includes(name.toLowerCase()) || !value) continue;
      const next = rewrite(value);
      if (next !== value) node.attribs[name] = next;
    }
  });
  return remaining;
}

async function buildPreserveJs(capture: Capture, store: AssetStore, ctx: BuildContext) {
  const baseUrl = capture.finalUrl;
  const $ = cheerio.load(capture.originalHtml);
  removeTrackers($, baseUrl);
  removeOriginMeta($);
  removeComments($, false);
  markCheckouts($, baseUrl, detectCheckouts($, baseUrl));
  const origin = new URL(baseUrl).origin;
  const kept = new Map<string, string>();
  await localizeHtml($, baseUrl, store, {
    includeScripts: true,
    sameOriginScripts: { origin, kept },
    localOrigin: ctx.localOrigin,
  });

  // Arquivos do próprio site nos caminhos originais (URLs montadas pelos scripts).
  const assetMap: Record<string, string> = {};
  const addToMap = (url: string, target: string) => {
    const u = new URL(url);
    const file = target.slice(ASSET_PREFIX.length);
    assetMap[`${u.pathname}${u.search}`] = `a/${file.slice(0, 2)}/${file}`;
  };
  const known = new Set<string>();
  await Promise.all(
    [...capture.responses.values()].map(async (resp) => {
      let u: URL;
      try {
        u = new URL(resp.url);
      } catch {
        return;
      }
      if (u.origin !== origin || resp.url === baseUrl) return;
      known.add(resp.url);
      const isCss = /text\/css/i.test(resp.contentType) || u.pathname.endsWith(".css");
      const target = isCss ? await store.css(resp.url) : await store.asset(resp.url);
      if (target) addToMap(resp.url, target);
    }),
  );
  // Scripts citados no HTML que não passaram pela captura continuam no caminho original.
  for (const [url, target] of kept) {
    known.add(url);
    addToMap(url, target);
  }
  const jsSeeds = [...known].filter((url) => {
    const resp = capture.responses.get(url);
    return isJsResource(url, resp?.contentType ?? "");
  });
  for (const [url, target] of await discoverModuleChunks(store, origin, jsSeeds, known)) addToMap(url, target);

  const originRefs = ctx.localOrigin ? [] : localizeOriginRefs($, origin, assetMap);
  // Marca "Preservar JS": o script do Offer Studio não refaz o que o JS original já faz (menus, FAQ…).
  $(`meta[name="${PRESERVE_JS_META}"]`).remove();
  const marker = `<meta name="${PRESERVE_JS_META}" content="1">`;
  const charset = $("head > meta[charset]").first();
  if (charset.length) charset.after(marker);
  else $("head").prepend(marker);
  return { html: restoreDoctype(fixMetaCharset($.html()), capture.originalHtml), assetMap, originRefs };
}

async function storeHtml(jobId: string, device: Device, mode: CloneModeValue, html: string) {
  const key = `clones/${jobId}/${device}-${mode.toLowerCase()}.html`;
  await putObject(key, html);
  return key;
}

/** Junta listas de vários dispositivos sem repetir. */
function mergeBy<T>(lists: T[][], key: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const list of lists) for (const item of list) if (!seen.has(key(item))) seen.set(key(item), item);
  return [...seen.values()];
}

function stripHash(url: string): string {
  const i = url.indexOf("#");
  return i >= 0 ? url.slice(0, i) : url;
}

/** Título da cópia: <title>, senão o nome do arquivo importado, senão o domínio. */
function cloneTitle(desktop: Capture, localOrigin: string | null, fileName?: string): string {
  if (desktop.title) return desktop.title;
  if (localOrigin || isSyntheticOrigin(desktop.finalUrl)) {
    const name = (fileName ?? "").replace(/\.(?:zip|html?)$/i, "").trim();
    return name || "Página importada";
  }
  return new URL(desktop.finalUrl).hostname;
}

/** Origem interna de importação (ZIP / HTML colado sem link de origem) desta captura, ou null. */
function localOriginOf(capture: Capture, virtualSite?: VirtualSite): string | null {
  if (virtualSite && !virtualSite.fallthrough && isOnOrigin(capture.finalUrl, virtualSite.origin)) {
    return virtualSite.origin;
  }
  if (isSyntheticOrigin(capture.finalUrl)) {
    try {
      return new URL(capture.finalUrl).origin;
    } catch {
      return null;
    }
  }
  return null;
}

export async function buildClone(opts: BuildOptions): Promise<CloneResult> {
  const { captures, jobId, log } = opts;
  const desktop = captures.find((c) => c.device === "desktop") ?? captures[0];
  if (!desktop) throw new Error("Nenhuma captura para montar.");

  const allResponses = new Map<string, CapturedResponse>();
  for (const c of captures) for (const [k, v] of c.responses) if (!allResponses.has(k)) allResponses.set(k, v);
  const store = new AssetStore(allResponses, opts);

  const mobile = captures.find((c) => c.device === "mobile");
  const responsive = !mobile || sameForAllDevices(desktop, mobile);
  if (mobile && !responsive) log("INFO", "O site mostra uma versão diferente no celular: as duas serão copiadas.");

  const devices: Partial<Record<Device, DeviceOutput>> = {};
  const editableResults: EditableOutput[] = [];
  const editableHtml = new Map<Device, string>();
  const originRefs: string[] = [];
  const toBuild = responsive ? [desktop] : captures;
  const localOrigin = localOriginOf(desktop, opts.virtualSite);

  let done = 0;
  for (const capture of toBuild) {
    log("INFO", `Montando a versão ${capture.device === "desktop" ? "desktop" : "celular"}…`);
    const ctx: BuildContext = { localOrigin: localOriginOf(capture, opts.virtualSite) };
    const editable = await buildEditable(capture, store, ctx);
    editableResults.push(editable);
    editableHtml.set(capture.device, editable.html);
    opts.onProgress?.((++done - 0.5) / toBuild.length);
    const preserve = await buildPreserveJs(capture, store, ctx);
    for (const ref of preserve.originRefs) if (!originRefs.includes(ref)) originRefs.push(ref);
    opts.onProgress?.(done / toBuild.length);
    devices[capture.device] = {
      outputs: {
        EDITABLE: { htmlKey: await storeHtml(jobId, capture.device, "EDITABLE", editable.html) },
        PRESERVE_JS: {
          htmlKey: await storeHtml(jobId, capture.device, "PRESERVE_JS", preserve.html),
          assetMap: preserve.assetMap,
        },
      },
    };
  }
  if (responsive && mobile && devices.desktop) devices.mobile = { outputs: devices.desktop.outputs };

  // Prints do original e miniatura do card: do desktop; sem print do desktop
  // (só celular escolhido, ou o print falhou), do primeiro que tiver.
  let thumbnailKey: string | undefined;
  const thumbSource =
    captures.find((c) => c.device === "desktop" && c.screenshot) ?? captures.find((c) => c.screenshot);
  for (const capture of captures) {
    if (!capture.screenshot) continue;
    const key = `clones/${jobId}/${capture.device}.jpg`;
    await putObject(key, capture.screenshot);
    const out = devices[capture.device];
    if (out) out.screenshotKey = key;
    if (capture === thumbSource) {
      const thumb = await sharp(capture.screenshot)
        .resize({ width: 640, height: 400, fit: "cover", position: "top" })
        .webp({ quality: 78 })
        .toBuffer();
      thumbnailKey = (await putContentAddressed(thumb, "webp")).key;
    }
  }

  // Um item por fornecedor + ID + tipo (script e noscript do mesmo pixel têm
  // trechos diferentes, e restaurar precisa dos dois). Bloqueios de rede só
  // entram para fornecedores que não apareceram no HTML.
  const fromHtml = mergeBy(
    editableResults.map((r) => r.removed),
    (r) => `${r.vendor}|${r.pixelId ?? ""}|${r.kind}`,
  );
  const htmlVendors = new Set(fromHtml.map((r) => r.vendor));
  const fromNetwork = mergeBy(
    [
      captures.flatMap((c) =>
        c.blocked.map(
          (b): RemovedTracker => ({
            ...b.match,
            snippet: "",
            location: "head",
            kind: "network",
          }),
        ),
      ),
    ],
    (r) => r.vendor,
  ).filter((r) => !htmlVendors.has(r.vendor));
  const removed = [...fromHtml, ...fromNetwork];
  const checkouts = mergeBy(
    editableResults.map((r) => r.checkouts),
    (c) => c.url,
  );
  const funnel = mergeBy(
    editableResults.map((r) => r.funnel),
    (f) => f.url,
  );
  const videos = mergeBy(
    editableResults.map((r) => r.videos),
    (v) => `${v.provider}|${v.videoId ?? v.src ?? ""}`,
  ).map((v): VideoEmbed => {
    if (v.provider !== "NATIVE") return v;
    const src = v.src ? stripHash(v.src) : "";
    // O detector completa "//host/…" com https:; a página pode ter usado http:.
    const variants = [src, src.replace(/^https:/i, "http:"), src.replace(/^http:/i, "https:")];
    return { ...v, downloaded: !!src && variants.some((u) => store.downloadedVideos.has(u)) };
  });
  const delay = editableResults.find((r) => r.delay)?.delay ?? null;

  const warnings: CloneWarning[] = [];
  if (store.failed) {
    warnings.push({
      code: "ASSETS_FAILED",
      message: `${store.failed} arquivo(s) não puderam ser baixados. Eles podem aparecer quebrados na cópia.`,
    });
  }
  if (
    localOrigin &&
    syntheticSource(localOrigin) === "HTML" &&
    store.failedUrls.some((u) => isOnOrigin(u, localOrigin))
  ) {
    warnings.push({
      code: "RELATIVE_PATHS",
      message:
        "O HTML colado cita arquivos por caminhos relativos (ex.: imagens/foto.png), e sem o “Link de origem” não há de onde baixá-los. Cole de novo informando o link da página original para trazê-los.",
    });
  }

  // Vídeos mantidos no endereço original de propósito: um aviso claro, e não "quebrado".
  const skipped = [...store.skippedVideos.entries()].filter(([, reason]) => reason !== "HLS");
  if (skipped.length) {
    const byOption = skipped.some(([, reason]) => reason === "OPTION");
    const why = byOption
      ? "a opção “Não baixar” estava marcada"
      : `são maiores que o limite de ${formatLimit(opts.maxVideoBytes)}`;
    warnings.push({
      code: "VIDEOS_NOT_DOWNLOADED",
      message: `${skipped.length} vídeo(s) do site não foram baixados (${why}) e continuam tocando do endereço original. Se o site original sair do ar, eles param; troque pelo seu vídeo ou clone de novo com um limite maior.`,
      url: skipped[0]?.[0],
    });
  }

  const ignoreExternal = new Set(store.skippedVideos.keys());
  for (const [device, html] of editableHtml) {
    const external = remainingExternalRefs(html, desktop.finalUrl, ignoreExternal);
    if (external.length) {
      warnings.push({
        code: "EXTERNAL_REFS",
        message: `${external.length} arquivo(s) da versão ${device === "desktop" ? "desktop" : "celular"} ainda vêm do site original.`,
        url: external[0]?.url,
      });
    }
  }
  if (originRefs.length) {
    warnings.push({
      code: "PRESERVE_JS_ORIGIN",
      message: `Na versão “Preservar JS”, os scripts da página ainda buscam ${originRefs.length} endereço(s) no site original (dados ou arquivos que não vieram na cópia). Se o site original mudar ou sair do ar, essa parte pode parar de funcionar.`,
      url: originRefs[0],
    });
  }
  // Um aviso por fornecedor de vídeo (não um por player).
  const thirdParty = videos.filter((v) => v.thirdParty);
  const thirdPartyProviders = [...new Set(thirdParty.map((v) => videoProviderLabel(v)))];
  for (const provider of thirdPartyProviders) {
    const count = thirdParty.filter((v) => videoProviderLabel(v) === provider).length;
    warnings.push({
      code: "THIRD_PARTY_VIDEO",
      message: `${count > 1 ? `${count} vídeos` : "Vídeo"} de terceiros (${provider}): continua${count > 1 ? "m" : ""} sendo do dono original e pode${count > 1 ? "m" : ""} não tocar no seu domínio. Depois de salvar, troque pelo seu vídeo no editor (botão “Editar” da página, na oferta).`,
    });
  }
  if (delay && delay.seconds === 0) {
    // O editor só oferece o campo "Aparece depois de" nos blocos marcados com data-os-delay.
    warnings.push({
      code: "DELAY_UNKNOWN",
      message:
        delay.elements > 0
          ? "Encontramos elementos que aparecem só depois de um tempo do vídeo, mas não o tempo exato. Por enquanto eles ficam visíveis; depois de salvar, defina o tempo no editor (botão “Editar” da página, campo “Aparece depois de” do bloco marcado)."
          : "Encontramos elementos que aparecem só depois de um tempo do vídeo, mas não o tempo exato. Eles ficarão visíveis.",
    });
  }

  const suggestedMode: CloneModeValue = looksLikeApp(desktop) ? "PRESERVE_JS" : "EDITABLE";
  if (suggestedMode === "PRESERVE_JS") {
    warnings.push({
      code: "APP_PAGE",
      message:
        "Esta página parece um quiz ou aplicativo montado por JavaScript. Recomendamos o modo “Preservar JS”, que mantém o funcionamento original.",
    });
  }

  return {
    title: cloneTitle(desktop, localOrigin, opts.fileName),
    finalUrl: desktop.finalUrl,
    responsive,
    devices,
    removed,
    checkouts,
    funnel,
    videos,
    delay,
    warnings,
    suggestedMode,
    thumbnailKey,
    assets: [...store.assets.values()],
    stats: {
      assets: store.assets.size,
      bytes: store.bytes,
      failed: store.failed,
      blockedRequests: captures.reduce((n, c) => n + c.blocked.length, 0),
      durationMs: Date.now() - opts.startedAt,
    },
  };
}
