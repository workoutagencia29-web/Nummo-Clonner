/**
 * VSL: detecção dos players de vídeo e do "atraso" (botão de compra escondido
 * até X segundos do vídeo).
 *
 * Funções puras sobre o DOM do cheerio (sem rede, sem banco).
 */
import { type Cheerio, type CheerioAPI, contains } from "cheerio";
import type { Element } from "domhandler";
import {
  isHlsMime,
  isHlsUrl,
  matchVideoHost,
  parseVideoUrl,
  type VideoProvider,
  videoProviderLabel,
} from "@/detection/videos";
import { nameKey } from "@/lib/text";
import { isElement } from "./html-assets";
import { ASSET_PREFIX, type VideoEmbed, type VslDelay } from "./types";

// ─── Vídeos ──────────────────────────────────────────────────────────────────

const SCAN_SELECTOR = [
  "vturb-smartplayer",
  "div[id^='vid_']",
  "div[id^='vid-']",
  "iframe",
  "script",
  "video",
  "lite-youtube",
  ".rll-youtube-player",
  "[data-youtube-id]",
  "[data-plyr-provider]",
  "[data-vimeo-id]",
  "[data-vimeo-url]",
  ".elementor-widget-video[data-settings]",
  "[data-widget_type^='video'][data-settings]",
  "wistia-player",
  ".wistia_embed",
  "div[id^='vidalytics_embed_']",
].join(", ");

const IFRAME_SRC_ATTRS = ["src", "data-src", "data-lazy-src", "data-litespeed-src", "data-rocket-src", "data-original"];
const VTURB_ELEMENT_ID = /^vid[_-]([a-f0-9]{16,})$/i;
const JSON_SCRIPT = /json|template|html|x-tmpl|text\/x-/i;
const URL_IN_TEXT = /(?:https?:)?\/\/[^\s"'`<>()\\]+/gi;
/** Miniaturas (thumbnail.jpg do player) não são o vídeo. */
const IMAGE_URL = /\.(?:jpe?g|png|webp|gif|svg|avif)(?:$|[?#])/i;

/**
 * O elemento é um player de terceiros (VTurb, Panda, Wistia, Vidalytics, Plyr)?
 * Vídeos `<video>` dentro dele pertencem ao player; o atraso nunca o marca.
 */
function isPlayerElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const id = el.attribs.id ?? "";
  if (tag === "vturb-smartplayer" || tag === "wistia-player") return true;
  if (VTURB_ELEMENT_ID.test(id) || /^panda-/i.test(id) || /^vidalytics_embed_/.test(id)) return true;
  if ("data-plyr-provider" in el.attribs || /\bwistia_embed\b/.test(el.attribs.class ?? "")) return true;
  if (tag === "iframe") return /converteai\.net|pandavideo\.com/i.test(el.attribs.src ?? el.attribs["data-src"] ?? "");
  return false;
}

/** Chave para juntar ocorrências do mesmo vídeo. */
function embedKey(v: VideoEmbed): string {
  return v.videoId ? `${v.provider}|id:${v.videoId}` : `${v.provider}|src:${v.src ?? ""}`;
}

/** Agrupa "OTHER" por fornecedor (Wistia ≠ Vidalytics). */
function groupKey(v: VideoEmbed): string {
  return v.provider === "OTHER" ? `OTHER|${videoProviderLabel(v)}` : v.provider;
}

/** Resolve a URL em relação à página (mantém `/os-assets/…` como está). */
function absolutize(raw: string | undefined, pageUrl: string): string | undefined {
  const value = raw?.trim();
  if (!value || value.startsWith(ASSET_PREFIX)) return value || undefined;
  if (/^(?:blob|data|about|javascript):/i.test(value)) return value;
  try {
    return new URL(value.replace(/^\/\//, "https://"), pageUrl).href;
  } catch {
    return value;
  }
}

function embed(provider: VideoProvider, videoId?: string, src?: string): VideoEmbed {
  return {
    provider,
    ...(videoId ? { videoId } : {}),
    ...(src ? { src } : {}),
    thirdParty: provider !== "NATIVE",
  };
}

/**
 * Lista os vídeos da página (VTurb/ConverteAI, Panda, YouTube, Vimeo, HLS,
 * `<video>` próprio, Wistia/Vidalytics e outros), na ordem em que aparecem.
 */
export function detectVideos($: CheerioAPI, pageUrl: string): VideoEmbed[] {
  const found: VideoEmbed[] = [];
  const byKey = new Map<string, VideoEmbed>();

  const add = (v: VideoEmbed) => {
    const key = embedKey(v);
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.src && v.src) existing.src = v.src;
      return;
    }
    byKey.set(key, v);
    found.push(v);
  };

  /** Adiciona a partir de uma URL de player conhecido; devolve true se reconheceu. */
  const addFromUrl = (raw: string | undefined, opts: { requireId?: boolean } = {}): boolean => {
    const src = absolutize(raw, pageUrl);
    if (!src || !/^https?:/i.test(src) || IMAGE_URL.test(src)) return false;
    if (isHlsUrl(src)) {
      const parsed = parseVideoUrl(src);
      if (parsed?.videoId && parsed.provider !== "OTHER") add(embed(parsed.provider, parsed.videoId, src));
      else if (!parsed || parsed.provider === "OTHER") add(embed("HLS", undefined, src));
      return true;
    }
    const parsed = parseVideoUrl(src);
    if (!parsed) return false;
    if (opts.requireId && !parsed.videoId) return false;
    add(embed(parsed.provider, parsed.videoId, src));
    return true;
  };

  for (const el of $(SCAN_SELECTOR).toArray().filter(isElement)) {
    const $el = $(el);
    const tag = el.tagName.toLowerCase();

    if (tag === "vturb-smartplayer") {
      const id = /^vid[_-]?(.+)$/i.exec($el.attr("id") ?? "")?.[1];
      add(embed("VTURB", id));
      continue;
    }

    if (tag === "div" && VTURB_ELEMENT_ID.test($el.attr("id") ?? "")) {
      add(embed("VTURB", VTURB_ELEMENT_ID.exec($el.attr("id") ?? "")?.[1]));
      continue;
    }

    if (tag === "iframe") {
      for (const attr of IFRAME_SRC_ATTRS) {
        if (addFromUrl($el.attr(attr))) break;
      }
      continue;
    }

    if (tag === "script") {
      const srcAttr = $el.attr("src");
      if (srcAttr) {
        addFromUrl(srcAttr);
        continue;
      }
      if (JSON_SCRIPT.test($el.attr("type") ?? "")) continue;
      scanInlineScript($el.html() ?? "");
      continue;
    }

    if (tag === "video") {
      scanVideoElement($el);
      continue;
    }

    if (tag === "lite-youtube") {
      const id = $el.attr("videoid") ?? $el.attr("video-id");
      if (id) add(embed("YOUTUBE", id, `https://www.youtube.com/embed/${id}`));
      continue;
    }

    if (tag === "wistia-player") {
      const id = $el.attr("media-id");
      if (id) add(embed("OTHER", id, `https://fast.wistia.net/embed/iframe/${id}`));
      continue;
    }

    const cls = $el.attr("class") ?? "";
    const wistia = /\bwistia_async_([a-z0-9]+)/i.exec(cls);
    if (wistia) {
      add(embed("OTHER", wistia[1], `https://fast.wistia.net/embed/iframe/${wistia[1]}`));
      continue;
    }

    const vidalytics = /^vidalytics_embed_([\w-]+)$/.exec($el.attr("id") ?? "");
    if (vidalytics) {
      add(embed("OTHER", vidalytics[1]));
      continue;
    }

    const plyr = ($el.attr("data-plyr-provider") ?? "").toLowerCase();
    const plyrId = $el.attr("data-plyr-embed-id");
    if (plyr && plyrId) {
      if (plyr === "youtube") {
        addFromUrl(/^[\w-]{11}$/.test(plyrId) ? `https://www.youtube.com/embed/${plyrId}` : plyrId);
      } else if (plyr === "vimeo") {
        addFromUrl(/^\d+$/.test(plyrId) ? `https://player.vimeo.com/video/${plyrId}` : plyrId);
      }
      continue;
    }

    const ytId = $el.attr("data-youtube-id") ?? ($el.hasClass("rll-youtube-player") ? $el.attr("data-id") : undefined);
    if (ytId) {
      add(embed("YOUTUBE", ytId, `https://www.youtube.com/embed/${ytId}`));
      continue;
    }

    const vimeoId = $el.attr("data-vimeo-id");
    if (vimeoId && /^\d+$/.test(vimeoId)) {
      add(embed("VIMEO", vimeoId, `https://player.vimeo.com/video/${vimeoId}`));
      continue;
    }
    if ($el.attr("data-vimeo-url")) {
      addFromUrl($el.attr("data-vimeo-url"));
      continue;
    }

    const settings = $el.attr("data-settings");
    if (settings) scanElementorSettings(settings);
  }

  function scanInlineScript(raw: string) {
    if (!raw.trim()) return;
    // URLs em JSON vêm como https:\/\/…
    const code = raw.replace(/\\\//g, "/");
    for (const m of code.matchAll(URL_IN_TEXT)) {
      const url = m[0].replace(/[.,;]+$/, "");
      if (isHlsUrl(url)) {
        addFromUrl(url);
        continue;
      }
      const parsed = parseVideoUrl(absolutize(url, pageUrl) ?? url);
      // Em scripts só contam players "de VSL" com ID (evita links soltos de redes sociais).
      if (parsed && (parsed.provider === "VTURB" || parsed.provider === "PANDA" || parsed.provider === "OTHER")) {
        addFromUrl(url, { requireId: true });
      }
    }
    if (/YT\.Player/.test(code)) {
      const id = /videoId\s*:\s*["']([\w-]{11})["']/.exec(code)?.[1];
      if (id) add(embed("YOUTUBE", id, `https://www.youtube.com/embed/${id}`));
    }
  }

  function scanVideoElement($video: Cheerio<Element>) {
    if ($video.parents().toArray().some(isPlayerElement)) return;
    const sources: { src: string; type?: string }[] = [];
    for (const attr of ["src", "data-src"]) {
      const v = $video.attr(attr);
      if (v) sources.push({ src: v, type: $video.attr("type") });
    }
    $video.find("source").each((_, s) => {
      const $s = $(s);
      const v = $s.attr("src") ?? $s.attr("data-src");
      if (v) sources.push({ src: v, type: $s.attr("type") });
    });
    if (!sources.length) return;

    const hls = sources.find((s) => isHlsUrl(s.src) || isHlsMime(s.type));
    if (hls) {
      const src = absolutize(hls.src, pageUrl);
      const parsed = src ? parseVideoUrl(src) : null;
      if (parsed?.videoId && parsed.provider !== "OTHER") add(embed(parsed.provider, parsed.videoId, src));
      else add(embed("HLS", undefined, src));
      return;
    }

    const real = sources.find((s) => !/^blob:/i.test(s.src));
    if (!real) {
      // Vídeo montado por um player de streaming desconhecido (MediaSource).
      add(embed("OTHER"));
      return;
    }
    const src = absolutize(real.src, pageUrl);
    if (src && matchVideoHost(src) && addFromUrl(src)) return;
    add(embed("NATIVE", undefined, src));
  }

  function scanElementorSettings(raw: string) {
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      data = null;
    }
    if (!data || typeof data !== "object") return;
    const type = String(data.video_type ?? "youtube");
    const pick = (key: string) => (typeof data?.[key] === "string" ? (data[key] as string) : undefined);
    if (type === "hosted") {
      const hosted = data.hosted_url as { url?: string } | undefined;
      const url = pick("external_url") ?? hosted?.url;
      if (url) {
        const src = absolutize(url, pageUrl);
        if (src && isHlsUrl(src)) add(embed("HLS", undefined, src));
        else if (src) add(embed("NATIVE", undefined, src));
      }
      return;
    }
    const url = pick(`${type}_url`);
    if (url) addFromUrl(url);
  }

  // Descarta ocorrências sem ID (ex.: SDK do player) quando o mesmo player já tem ID.
  const withId = new Set(found.filter((v) => v.videoId).map(groupKey));
  return found.filter((v) => v.videoId || v.provider === "NATIVE" || v.provider === "HLS" || !withId.has(groupKey(v)));
}

// ─── Atraso da VSL ───────────────────────────────────────────────────────────

/** Resultado de extractDelay: VslDelay + scripts do fornecedor removidos. */
export interface VslDelayExtraction extends VslDelay {
  /** Quantos scripts de atraso (VTurb/Panda/timer) foram removidos do HTML. */
  scriptsRemoved: number;
  /** HTML original dos scripts removidos (para mostrar/restaurar). */
  removedScripts: string[];
}

/** Classes usadas para esconder o botão até certo ponto do vídeo. */
const STRONG_HIDDEN_CLASSES = new Set([
  "esconder",
  "escondido",
  "escondida",
  "oculto",
  "oculta",
  "hidden-cta",
  "smartplayer-hidden",
  "delay",
  "delayed",
  "vsl-delay",
  "delay-cta",
  "hidden-delay",
]);
/** Classe genérica: só conta quando há script de atraso. */
const WEAK_HIDDEN_CLASSES = new Set(["hide"]);

/**
 * Classes tiradas dos elementos marcados com data-os-delay (ver unhideDelayed):
 * as da detecção e as de frameworks que também escondem (Bootstrap, Tailwind).
 */
export const DELAY_HIDDEN_CLASSES: readonly string[] = [
  ...STRONG_HIDDEN_CLASSES,
  ...WEAK_HIDDEN_CLASSES,
  "d-none",
  "hidden",
];

const DELAY_MARKERS =
  /displayHiddenElements|SECONDS_TO_DISPLAY|CLASS_TO_DISPLAY|alreadyElsDisplayed|delaySeconds|loadButtonInTime/;
const VIDEO_TIME_MARKERS = /panda_timeupdate|smartplayer\.instances|player:ready|currentTime|timeupdate/;
const SECONDS_VAR = /\b(?:var|let|const)\s+(?:seconds|segundos)\s*=\s*\d/;
const REVEAL =
  /\.style\.display\s*=|\.style\.visibility\s*=|display\s*[:=]\s*["']?(?:block|flex|inline|grid|initial|unset|revert)|classList\.(?:remove|toggle|add)\s*\(|removeAttribute\s*\(\s*["'](?:style|hidden)|\.show\s*\(|fadeIn|slideDown|removeClass\s*\(|\.css\s*\(\s*["']display|showHiddenElements|displayHiddenElements|\.hidden\s*=\s*false/;
/** Script que carrega o próprio player: nunca remover. */
const PLAYER_LOADER =
  /createElement\s*\(\s*["']script["']\s*\)|converteai\.net\/[^"'`\s]*\/(?:player|embed)\.js|pandavideo\.com(?:\.br)?\/[^"'`\s]*api\.v\d\.js/i;

const CTA_TEXT =
  /compr|quero|garant|adquir|assin|inscrev|acess|pedido|checkout|comec|buy|order|add to cart|matricul|pagar|desconto|oferta|carrinho|reserv/i;
const CHECKOUT_HREF =
  /hotmart|kiwify|eduzz|monetizze|braip|perfectpay|ticto|cakto|yampi|kirvano|greenn|hubla|lastlink|appmax|pagar\.me|doppus|payt\.|pay\.|checkout|carrinho|\/cart|\/buy|\/pay\b|\/compra|\/pedido|\/order/i;
const CTA_CLASS = /(?:^|\s|-)(?:btn|button|cta|botao|comprar)(?:$|\s|-)/i;

const NEVER_MARK = "html, head, body, script, style, link, meta, noscript, iframe, video, source";
/** Tamanho máximo (caracteres) de um script para aceitar sinais fracos. */
const WEAK_SIGNAL_MAX = 6000;
/** Scripts maiores que isso nunca são removidos (podem ser o player inteiro). */
const REMOVE_MAX = 20_000;

/** O elemento tem cara de CTA/checkout (link de compra, botão)? */
function hasCta($: CheerioAPI, $el: Cheerio<Element>): boolean {
  const candidates = $el.find("a[href], button, form, [onclick], input[type='submit'], input[type='button']").addBack();
  return candidates
    .toArray()
    .filter(isElement)
    .some((node) => {
      const $n = $(node);
      const tag = node.tagName.toLowerCase();
      const href = $n.attr("href") ?? $n.attr("action") ?? $n.attr("onclick") ?? "";
      if (CHECKOUT_HREF.test(href)) return true;
      if (tag === "a" || tag === "button" || tag === "input") {
        const text = nameKey(`${$n.text()} ${$n.attr("value") ?? ""} ${$n.attr("aria-label") ?? ""}`);
        if (CTA_TEXT.test(text)) return true;
        if (CTA_CLASS.test($n.attr("class") ?? "") && (tag !== "a" || (href && href !== "#"))) return true;
      }
      return false;
    });
}

/** Classe citada pelo script de atraso que tem cara de "esconder" (e não de estilo do botão). */
const HIDE_LIKE_CLASS = /hid|hide|escond|ocult|invis|delay|atras|aparec|mostr|later|timer/i;

/** Valor de `display` que o script usa para mostrar o elemento (padrão: block). */
function revealDisplay(code: string): string {
  const patterns = [
    /\.style\.display\s*=\s*["'`]([a-z-]+)["'`]/gi,
    /\.css\s*\(\s*["']display["']\s*,\s*["']([a-z-]+)["']/gi,
    /\bdisplay\s*:\s*["']?(block|flex|inline-block|inline-flex|grid|inline-grid|inline|table|contents)\b/gi,
  ];
  for (const re of patterns) {
    for (const m of code.matchAll(re)) {
      const value = (m[1] ?? "").toLowerCase();
      if (
        value &&
        value !== "none" &&
        /^(?:block|flex|inline-block|inline-flex|grid|inline-grid|inline|table|contents)$/.test(value)
      ) {
        return value;
      }
    }
  }
  return "block";
}

/** Classes do último seletor composto (o que casa com o próprio elemento): ".a .b.c" → b, c. */
function selectorClassTokens(selector: string): string[] {
  const out: string[] = [];
  for (const part of selector.split(",")) {
    const compound =
      part
        .trim()
        .split(/[\s>+~]+/)
        .pop() ?? "";
    for (const m of compound.matchAll(/\.([\w-]+)/g)) out.push(m[1]);
  }
  return out;
}

/** O que unhideDelayed precisa saber de cada elemento marcado por extractDelay. */
interface UnhideInfo {
  /** Classes próprias da página que escondiam o elemento (citadas pelo script de atraso). */
  classes: string[];
  /**
   * `display` para usar quando o elemento veio do script e nada no próprio
   * elemento o escondia (regra da página por #id ou por classe de estilo).
   * null = não forçar.
   */
  display: string | null;
}

/** Marcações pendentes de extractDelay, por documento (ver unhideDelayed). */
const pendingUnhide = new WeakMap<object, Map<Element, UnhideInfo>>();

function documentKey($: CheerioAPI): object {
  return $.root()[0] as object;
}

function hasInlineDisplayNone($el: Cheerio<Element>): boolean {
  return /display\s*:\s*none/i.test($el.attr("style") ?? "");
}

function classTokens($el: Cheerio<Element>): string[] {
  return ($el.attr("class") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

/** Avalia expressões numéricas simples: "332", "5 * 60 + 32", "(2*60)". */
export function evaluateNumber(expr: string): number | null {
  const src = expr.replace(/\s+/g, "");
  if (!src || !/^[\d.+\-*/()]+$/.test(src)) return null;
  let pos = 0;
  const peek = () => src[pos];
  const atom = (): number => {
    if (peek() === "(") {
      pos++;
      const v = sum();
      if (peek() !== ")") throw new Error("paren");
      pos++;
      return v;
    }
    if (peek() === "-") {
      pos++;
      return -atom();
    }
    const m = /^\d+(?:\.\d+)?/.exec(src.slice(pos));
    if (!m) throw new Error("num");
    pos += m[0].length;
    return Number(m[0]);
  };
  const product = (): number => {
    let v = atom();
    while (peek() === "*" || peek() === "/") {
      const op = src[pos++];
      const r = atom();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === "+" || peek() === "-") {
      const op = src[pos++];
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = sum();
    return pos === src.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

/** Resolve uma expressão, trocando identificadores pelo valor atribuído no script. */
function resolveExpr(expr: string, code: string, depth = 0): number | null {
  const cleaned = expr.trim().replace(/^["'`]|["'`]$/g, "");
  const direct = evaluateNumber(cleaned);
  if (direct !== null) return direct;
  if (depth > 2) return null;
  let failed = false;
  const replaced = cleaned.replace(/(?:window\.)?([A-Za-z_$][\w$]*)/g, (_, name: string) => {
    const assign = new RegExp(
      `(?:^|[^.\\w$])(?:window\\.)?${name.replace(ESCAPE_RE, "\\$&")}\\s*=(?!=)\\s*([^;,\\n}]+)`,
    ).exec(code);
    const value = assign ? resolveExpr(assign[1], code, depth + 1) : null;
    if (value === null) failed = true;
    return String(value ?? 0);
  });
  return failed ? null : evaluateNumber(replaced);
}

/** Argumentos de nível superior das chamadas `fn(...)` no código (ignora strings). */
function callArgs(code: string, fn: string): string[][] {
  const calls: string[][] = [];
  const re = new RegExp(`\\b${fn}\\s*\\(`, "g");
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const args: string[] = [];
    let depth = 0;
    let quote: string | null = null;
    let current = "";
    let i = m.index + m[0].length;
    for (; i < code.length; i++) {
      const ch = code[i];
      if (quote) {
        current += ch;
        if (ch === "\\") {
          current += code[++i] ?? "";
        } else if (ch === quote) {
          quote = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        current += ch;
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      if (ch === ")" || ch === "]" || ch === "}") {
        if (depth === 0) break;
        depth--;
      }
      if (ch === "," && depth === 0) {
        args.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    args.push(current.trim());
    calls.push(args);
  }
  return calls;
}

const NAMED_SECONDS =
  /\b(SECONDS_TO_DISPLAY|SECONDS_TO_SHOW|delaySeconds|delay_seconds|secondsToDisplay|secondsToShow|seconds|segundos|TIME_TO_SHOW|TIME_TO_DISPLAY|timeToShow|timeToDisplay|tempo[A-Za-z_]*|delay[A-Za-z_]*|DELAY[A-Z_]*)\s*[=:](?!=)\s*([^;,\n}]+)/;

/** Segundos de atraso de um script (null se não der para ler). */
export function parseDelaySeconds(code: string): number | null {
  const toSeconds = (value: number | null, name = ""): number | null => {
    if (value === null || !Number.isFinite(value) || value < 0) return null;
    if (/ms|milli/i.test(name) || value > 3 * 3600) return Math.round(value / 1000);
    return Math.round(value);
  };

  // 1. displayHiddenElements(N | variável, [...])
  for (const args of callArgs(code, "displayHiddenElements")) {
    const s = toSeconds(resolveExpr(args[0] ?? "", code));
    if (s !== null) return s;
  }

  // 2. Variáveis com nome de atraso (SECONDS_TO_DISPLAY, delaySeconds, var seconds…)
  const named = new RegExp(NAMED_SECONDS.source, "g");
  for (const m of code.matchAll(named)) {
    const s = toSeconds(resolveExpr(m[2], code), m[1]);
    if (s !== null) return s;
  }

  // 3. Comparações com o tempo do vídeo: currentTime >= 120
  for (const m of code.matchAll(/currentTime\s*(?:>=|<=|>|<|===?)\s*([^)&|;{]+)/g)) {
    const s = toSeconds(resolveExpr(m[1], code));
    if (s !== null) return s;
  }
  for (const m of code.matchAll(/([\w.$]{1,60})\s*(?:>=|<=|>|<)\s*[\w.]*currentTime/g)) {
    const s = toSeconds(resolveExpr(m[1], code));
    if (s !== null) return s;
  }

  // 4. setTimeout(..., 30000) / setTimeout(..., 30 * 1000): maior tempo ≥ 1 s
  let best: number | null = null;
  for (const args of callArgs(code, "setTimeout")) {
    if (args.length < 2) continue;
    const ms = resolveExpr(args[args.length - 1], code);
    if (ms !== null && ms >= 1000 && (best === null || ms > best)) best = ms;
  }
  return best === null ? null : Math.round(best / 1000);
}

/** Seletor simples: ".a", "#b", ".a .b", ".a, #b > .c" (sem atributos nem pseudo). */
const SIMPLE_SELECTOR = /^[.#][\w-]+(?:[\s,>+~.#][\w\s,>+~.#-]*)?$/;

/** Seletores (".classe", "#id") citados no script. */
function scriptSelectors(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/["'`]([.#][^"'`\n]{1,200})["'`]/g)) {
    const sel = m[1].trim();
    if (SIMPLE_SELECTOR.test(sel)) out.add(sel);
  }
  for (const m of code.matchAll(/getElementsByClassName\s*\(\s*["'`]([\w\s-]+)["'`]/g)) {
    out.add(
      m[1]
        .trim()
        .split(/\s+/)
        .map((c) => `.${c}`)
        .join(""),
    );
  }
  for (const m of code.matchAll(/getElementById\s*\(\s*["'`]([\w-]+)["'`]/g)) out.add(`#${m[1]}`);
  return [...out];
}

function isDelayScript(code: string, $: CheerioAPI): boolean {
  if (DELAY_MARKERS.test(code)) return true;
  // Sinais fracos só valem em scripts pequenos (evita bibliotecas embutidas).
  if (code.length > WEAK_SIGNAL_MAX || !REVEAL.test(code)) return false;
  if (VIDEO_TIME_MARKERS.test(code) || SECONDS_VAR.test(code)) return true;
  if (!/\bsetTimeout\s*\(/.test(code)) return false;
  // Timer simples: precisa mostrar um elemento "escondido" (classe de atraso ou com CTA).
  const hasLongTimer = callArgs(code, "setTimeout").some((args) => {
    const ms = args.length > 1 ? resolveExpr(args[args.length - 1], code) : null;
    return ms !== null && ms >= 1000;
  });
  if (!hasLongTimer) return false;
  return scriptSelectors(code).some((sel) => {
    const tokens =
      sel
        .toLowerCase()
        .match(/\.([\w-]+)/g)
        ?.map((t) => t.slice(1)) ?? [];
    if (tokens.some((t) => STRONG_HIDDEN_CLASSES.has(t) || WEAK_HIDDEN_CLASSES.has(t))) return true;
    try {
      return $(sel)
        .toArray()
        .filter(isElement)
        .some((el) => hasCta($, $(el)));
    } catch {
      return false;
    }
  });
}

/**
 * Detecta o padrão "botão escondido até X segundos do vídeo".
 *
 * Marca os elementos com `data-os-delay="<segundos>"` e remove os scripts de
 * atraso do fornecedor (o Offer Studio põe o próprio script na exportação).
 * Se achar o script mas não os segundos, marca com "0" (a revisão pergunta).
 * Devolve null quando não há atraso.
 */
export function extractDelay($: CheerioAPI): VslDelayExtraction | null {
  interface DelayScript {
    el: Element;
    code: string;
    seconds: number | null;
    selectors: string[];
    display: string;
  }
  const scripts: DelayScript[] = [];
  for (const el of $("script").toArray()) {
    const $s = $(el);
    if ($s.attr("src") || JSON_SCRIPT.test($s.attr("type") ?? "")) continue;
    const code = $s.html() ?? "";
    if (!code.trim() || !isDelayScript(code, $)) continue;
    scripts.push({
      el,
      code,
      seconds: parseDelaySeconds(code),
      selectors: scriptSelectors(code),
      display: revealDisplay(code),
    });
  }

  const globalSeconds = scripts.find((s) => s.seconds !== null)?.seconds ?? 0;
  const marks = new Map<Element, number>();
  const mark = (el: Element, seconds: number) => {
    if (!marks.has(el)) marks.set(el, seconds);
  };
  // Nunca marca o próprio player (nem um bloco que o contenha).
  const players = $("vturb-smartplayer, wistia-player, iframe, [id], [data-plyr-provider]")
    .toArray()
    .filter(isPlayerElement);
  const markable = (el: Element) =>
    !$(el).is(NEVER_MARK) && !isPlayerElement(el) && !players.some((p) => contains(el, p));

  // 1. Elementos citados pelos scripts de atraso. Guarda as classes do seletor
  //    (ex.: ".oculto-vsl"): são da página e também escondem o elemento.
  let resolvedFromScripts = false;
  const fromScript = new Map<Element, { classes: Set<string>; display: string }>();
  for (const s of scripts) {
    for (const sel of s.selectors) {
      let els: Element[] = [];
      try {
        els = $(sel).toArray().filter(isElement);
      } catch {
        continue;
      }
      const selClasses = selectorClassTokens(sel);
      for (const el of els) {
        if (!markable(el)) continue;
        resolvedFromScripts = true;
        mark(el, s.seconds ?? globalSeconds);
        const own = new Set(classTokens($(el)));
        const info = fromScript.get(el) ?? { classes: new Set<string>(), display: s.display };
        for (const cls of selClasses) {
          if (own.has(cls.toLowerCase()) && HIDE_LIKE_CLASS.test(cls)) info.classes.add(cls);
        }
        fromScript.set(el, info);
      }
    }
  }

  // 2. Classes de atraso ("esconder" etc.). A genérica ("hide") só vale com
  //    script de atraso que não aponta para nada e com CTA dentro.
  const hasScript = scripts.length > 0;
  const guessing = hasScript && !resolvedFromScripts;
  for (const el of $("[class]").toArray().filter(isElement)) {
    const $el = $(el);
    const tokens = classTokens($el);
    const strong = tokens.some((t) => STRONG_HIDDEN_CLASSES.has(t));
    const weak = !strong && guessing && tokens.some((t) => WEAK_HIDDEN_CLASSES.has(t));
    if ((!strong && !weak) || marks.has(el) || !markable(el)) continue;
    if ((strong && hasScript) || hasCta($, $el)) mark(el, globalSeconds);
  }

  // 3. `display:none` com CTA, quando há script mas ele não aponta para nada.
  if (guessing) {
    for (const el of $("[style]").toArray().filter(isElement)) {
      const $el = $(el);
      if (hasInlineDisplayNone($el) && !marks.has(el) && markable(el) && hasCta($, $el)) mark(el, globalSeconds);
    }
  }

  if (!hasScript && !marks.size) return null;

  // Tudo que foi marcado (inclusive o que fica dentro de outro bloco marcado)
  // perde o "esconde" original em unhideDelayed.
  const pending = new Map<Element, UnhideInfo>();
  for (const el of marks.keys()) {
    const script = fromScript.get(el);
    pending.set(el, { classes: script ? [...script.classes] : [], display: script ? script.display : null });
  }
  pendingUnhide.set(documentKey($), pending);

  // Só o elemento mais externo recebe a marca.
  let elements = 0;
  for (const [el, seconds] of marks) {
    const nestedInMarked = $(el)
      .parents()
      .toArray()
      .some((p) => marks.has(p));
    if (nestedInMarked) continue;
    $(el).attr("data-os-delay", String(seconds));
    elements++;
  }

  const removedScripts: string[] = [];
  for (const s of scripts) {
    if (PLAYER_LOADER.test(s.code) || s.code.length > REMOVE_MAX) continue;
    removedScripts.push($.html(s.el));
    $(s.el).remove();
  }

  return { seconds: globalSeconds, elements, scriptsRemoved: removedScripts.length, removedScripts };
}

const INLINE_HIDE_RE = /(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*;?/gi;

/**
 * Tira o "esconde" original dos elementos marcados por extractDelay (os com
 * data-os-delay e os que ficaram dentro deles): classes de
 * DELAY_HIDDEN_CLASSES, as classes da própria página citadas pelo script de
 * atraso (ex.: ".oculto-vsl"), `display:none`/`visibility:hidden` inline e o
 * atributo `hidden`. Se o script apontava para o elemento mas nada nele o
 * escondia (regra da página por #id ou classe de estilo), ganha o `display`
 * que o script usaria — o CSS do runtime (display:none!important) continua
 * escondendo até a hora certa. A partir daí quem esconde e mostra é o runtime
 * do Offer Studio. Devolve quantos elementos mudaram.
 */
export function unhideDelayed($: CheerioAPI): number {
  const key = documentKey($);
  const pending = pendingUnhide.get(key);
  pendingUnhide.delete(key);
  const targets = new Set<Element>($("[data-os-delay]").toArray().filter(isElement));
  if (pending) for (const el of pending.keys()) if (el.parent) targets.add(el);

  let changed = 0;
  for (const el of targets) {
    const $el = $(el);
    const info = pending?.get(el);
    const before = `${el.attribs.class}|${el.attribs.style}|${el.attribs.hidden}`;
    let hidingFound = false;
    for (const cls of [...DELAY_HIDDEN_CLASSES, ...(info?.classes ?? [])]) {
      if ($el.hasClass(cls)) {
        $el.removeClass(cls);
        hidingFound = true;
      }
    }
    if ($el.attr("class") === "") $el.removeAttr("class");
    if ($el.attr("hidden") !== undefined) {
      $el.removeAttr("hidden");
      hidingFound = true;
    }
    const originalStyle = $el.attr("style") ?? "";
    let style = originalStyle;
    if (style) {
      const cleaned = style.replace(INLINE_HIDE_RE, "").trim();
      if (cleaned !== style.trim()) hidingFound = true;
      style = cleaned;
    }
    const outermost = $el.attr("data-os-delay") !== undefined;
    if (info?.display && outermost && !hidingFound && !/(?:^|;)\s*display\s*:/i.test(style)) {
      style = style ? `${style.replace(/;?\s*$/, ";")} display: ${info.display};` : `display: ${info.display};`;
    }
    if (style !== originalStyle.trim()) {
      if (style) $el.attr("style", style);
      else $el.removeAttr("style");
    }
    if (`${el.attribs.class}|${el.attribs.style}|${el.attribs.hidden}` !== before) changed++;
  }
  return changed;
}
