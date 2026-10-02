/**
 * Detecção e marcação de links de checkout na página clonada.
 *
 * - matchCheckoutPlatform: reconhece a plataforma pela URL.
 * - detectCheckouts: varre o HTML (links, formulários, onclick, data-*, JSON do
 *   Elementor, iframes e scripts inline) e agrupa os checkouts por URL.
 * - markCheckouts: marca os elementos com data-os-checkout="1" e deixa a URL
 *   absoluta; navegação feita por JS vira data-os-href (o runtime da página
 *   navega no clique).
 *
 * Funções puras sobre o DOM do cheerio: sem banco e sem rede.
 */
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { getDomain } from "tldts";
import {
  BUY_TEXT_RE,
  CHECKOUT_PLATFORMS,
  type CheckoutRule,
  CTA_CLASS_RE,
  GENERIC_CHECKOUT_RULES,
  NON_CHECKOUT_HOSTS,
  NOT_BUY_TEXT_RE,
  STATIC_ASSET_RE,
  STRONG_BUY_CLASS_RE,
  UNKNOWN_CHECKOUT_PLATFORM,
  WHATSAPP_HOSTS,
} from "@/detection/checkouts";
import { normalizeText } from "@/lib/text";
import { isElement } from "./html-assets";
import type { CheckoutCandidate } from "./types";

export interface CheckoutPlatformMatch {
  /** Nome da plataforma ("Hotmart"…) ou "Desconhecida" para padrões genéricos. */
  platform: string;
  /** 0–100. */
  confidence: number;
}

/** Tamanho máximo do rótulo (texto do botão) guardado no candidato. */
export const CHECKOUT_LABEL_MAX = 80;

/** Confiança mínima para aceitar uma URL encontrada solta dentro de <script>. */
const SCRIPT_MIN_CONFIDENCE = 80;

// ─── Reconhecimento por URL ──────────────────────────────────────────────────

/** Host em minúsculas, sem ponto final e sem "www.". */
function cleanHost(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

function hostMatches(pattern: string | RegExp, host: string): boolean {
  if (typeof pattern !== "string") return pattern.test(host);
  if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1));
  return host === pattern;
}

function hostInList(host: string, list: (string | RegExp)[]): boolean {
  return list.some((pattern) => hostMatches(pattern, host));
}

/** Host limpo da página ("" se a URL for inválida). */
function pageHost(pageUrl: string): string {
  try {
    return cleanHost(new URL(pageUrl).hostname);
  } catch {
    return "";
  }
}

function ruleMatches(rule: CheckoutRule, host: string, path: string, query: string): boolean {
  if (rule.host !== undefined && !hostMatches(rule.host, host)) return false;
  if (rule.path && !rule.path.test(path)) return false;
  if (rule.query && !rule.query.test(query)) return false;
  return true;
}

/** Regras na ordem de prioridade: plataformas conhecidas, depois as genéricas. */
const ALL_RULES: [platform: string, rule: CheckoutRule][] = [
  ...CHECKOUT_PLATFORMS.flatMap((p) => p.rules.map((rule): [string, CheckoutRule] => [p.name, rule])),
  ...GENERIC_CHECKOUT_RULES.map((rule): [string, CheckoutRule] => [UNKNOWN_CHECKOUT_PLATFORM, rule]),
];

/**
 * Reconhece a plataforma de checkout de uma URL absoluta (http/https).
 * Devolve null quando não parece checkout (inclui WhatsApp e arquivos
 * estáticos como .js/.css/.png).
 *
 * Com `pageUrl`, os padrões genéricos de host ("checkout.", "pay.", host com
 * "checkout") não valem para links do mesmo host da página: numa página
 * hospedada em pay.meusite.com.br, o link "/upsell" não é checkout.
 */
export function matchCheckoutPlatform(url: string, pageUrl?: string): CheckoutPlatformMatch | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = cleanHost(parsed.hostname);
  if (!host || hostInList(host, WHATSAPP_HOSTS)) return null;
  const path = parsed.pathname;
  if (STATIC_ASSET_RE.test(path)) return null;
  const query = parsed.search.replace(/^\?/, "");
  const sameHostAsPage = !!pageUrl && pageHost(pageUrl) === host;

  let best: CheckoutPlatformMatch | null = null;
  for (const [platform, rule] of ALL_RULES) {
    if (sameHostAsPage && platform === UNKNOWN_CHECKOUT_PLATFORM && rule.host !== undefined) continue;
    const confidence = rule.confidence ?? 100;
    if ((!best || confidence > best.confidence) && ruleMatches(rule, host, path, query)) {
      best = { platform, confidence };
    }
  }
  return best;
}

// ─── URLs ────────────────────────────────────────────────────────────────────

interface ResolvedUrl {
  /** URL absoluta sem #hash (chave de agrupamento; a query é mantida). */
  key: string;
  /** URL absoluta completa, como resolvida. */
  absolute: string;
}

const IGNORED_SCHEME_RE = /^(?:mailto|tel|sms|callto|javascript|data|blob|about|os-page|whatsapp|intent|file):/i;

/** Resolve contra a base; null para âncoras, mailto:, tel:, javascript:, WhatsApp etc. */
function resolveUrl(raw: string | undefined, base: string): ResolvedUrl | null {
  const value = raw?.trim();
  if (!value || value.startsWith("#") || IGNORED_SCHEME_RE.test(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value, base);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (hostInList(cleanHost(parsed.hostname), WHATSAPP_HOSTS)) return null;
  const absolute = parsed.href;
  parsed.hash = "";
  return { key: parsed.href, absolute };
}

/** Domínio registrável (ex.: "minhaloja.com.br"); para IP/localhost, o próprio host. */
function registrableDomain(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return getDomain(host, { allowPrivateDomains: true }) ?? host;
  } catch {
    return "";
  }
}

/** Valor de data-* que parece URL (evita "true", ids etc.). */
const URLISH_RE = /^(?:https?:\/\/|\/\/|\/|\.\.?\/|www\.)/i;

// ─── JavaScript (onclick, href="javascript:…") ──────────────────────────────

export interface JsNavigation {
  url: string;
  /** Abre em nova aba (window.open sem _self). */
  newTab: boolean;
  /** Literal solto (sem location/window.open explícito). */
  loose: boolean;
}

const STR = String.raw`(["'\x60])((?:(?!\1)[^\\]|\\.)*)\1`;
const LOCATION_ASSIGN_RE = new RegExp(String.raw`\blocation(?:\.href)?\s*=\s*${STR}`, "g");
const LOCATION_CALL_RE = new RegExp(String.raw`\blocation\.(?:assign|replace)\s*\(\s*${STR}`, "g");
const WINDOW_OPEN_RE = new RegExp(
  String.raw`\bwindow\.open\s*\(\s*${STR}(?:\s*,\s*(["'\x60])((?:(?!\3)[^\\]|\\.)*)\3)?`,
  "g",
);
const URL_LITERAL_RE = /(["'`])((?:https?:)?\/\/(?:(?!\1)[^\\\s]|\\.)+)\1/g;

function unescapeJs(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\(.)/g, "$1");
}

/** Extrai destinos de navegação de um trecho de JS (window.location, location.assign, window.open). */
export function parseJsNavigation(code: string): JsNavigation[] {
  const found: JsNavigation[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined, newTab: boolean, loose: boolean) => {
    if (raw === undefined) return;
    const url = unescapeJs(raw).trim();
    if (!url || url.includes("${") || seen.has(url)) return;
    seen.add(url);
    found.push({ url, newTab, loose });
  };
  for (const m of code.matchAll(LOCATION_ASSIGN_RE)) push(m[2], false, false);
  for (const m of code.matchAll(LOCATION_CALL_RE)) push(m[2], false, false);
  for (const m of code.matchAll(WINDOW_OPEN_RE)) {
    const target = m[4]?.trim().toLowerCase();
    push(m[2], !target || !["_self", "_top", "_parent"].includes(target), false);
  }
  for (const m of code.matchAll(URL_LITERAL_RE)) push(m[2], false, true);
  return found;
}

/** URLs absolutas dentro de um <script> inline (inclui "https:\/\/…" de JSON). */
function scriptUrls(code: string): string[] {
  const text = code
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/");
  const urls = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s"'`<>\\(){}[\],;|^]+/gi)) {
    urls.add(m[0].replace(/[.!?:]+$/, ""));
  }
  return [...urls];
}

/** URLs de link dentro do JSON do Elementor (data-settings: {"link":{"url":…}}). */
function elementorUrls(json: string, rootKey: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const urls: string[] = [];
  const walk = (value: unknown, key: string, depth: number) => {
    if (depth > 8 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key, depth + 1);
      return;
    }
    const obj = value as Record<string, unknown>;
    if (/(?:^|_)link$/.test(key) && typeof obj.url === "string" && obj.url.trim()) urls.push(obj.url);
    for (const [childKey, child] of Object.entries(obj)) walk(child, childKey, depth + 1);
  };
  walk(data, rootKey, 0);
  return urls;
}

// ─── Coleta de referências no DOM ────────────────────────────────────────────

type HitVia = "href" | "js-href" | "onclick" | "data" | "elementor" | "action" | "formaction" | "src" | "script";

interface Hit {
  el: Element;
  via: HitVia;
  /** Atributo de onde veio a URL (href, onclick, data-href…). */
  attr: string;
  key: string;
  absolute: string;
  newTab: boolean;
  /** true = literal solto em JS/iframe/Elementor: só vale para plataformas reconhecidas. */
  weak: boolean;
}

const DATA_ATTRS = ["data-href", "data-url", "data-link", "data-checkout", "data-os-href"];
const ELEMENTOR_ATTRS: [attr: string, rootKey: string][] = [
  ["data-settings", ""],
  ["data-wrapper-link", "link"],
];

const SCAN_SELECTOR = [
  "a[href]",
  "area[href]",
  "form[action]",
  "button[formaction]",
  "input[formaction]",
  "iframe[src]",
  "frame[src]",
  "[onclick]",
  ...DATA_ATTRS.map((attr) => `[${attr}]`),
  ...ELEMENTOR_ATTRS.map(([attr]) => `[${attr}]`),
  "script:not([src])",
].join(", ");

const SOURCE_BY_VIA: Record<HitVia, CheckoutCandidate["source"]> = {
  href: "HREF",
  src: "HREF",
  "js-href": "ONCLICK",
  onclick: "ONCLICK",
  data: "ONCLICK",
  elementor: "ONCLICK",
  action: "FORM",
  formaction: "FORM",
  script: "SCRIPT",
};

/** Prioridade ao escolher a origem do grupo (menor = mais forte). */
const SOURCE_PRIORITY: Record<CheckoutCandidate["source"], number> = { HREF: 0, FORM: 1, ONCLICK: 2, SCRIPT: 3 };

interface ScanContext {
  base: string;
  /** URL da própria página sem #hash (links para ela são âncoras, não checkout). */
  pageKey: string;
}

function scanContext($: CheerioAPI, pageUrl: string): ScanContext {
  let base = pageUrl;
  const baseHref = $("base[href]").first().attr("href");
  if (baseHref) {
    try {
      base = new URL(baseHref, pageUrl).href;
    } catch {
      // <base> inválido: fica a URL da página.
    }
  }
  return { base, pageKey: resolveUrl(pageUrl, pageUrl)?.key ?? pageUrl };
}

function collectHits($: CheerioAPI, ctx: ScanContext, includeScripts: boolean): Hit[] {
  const hits: Hit[] = [];
  const add = (el: Element, via: HitVia, attr: string, raw: string | undefined, newTab = false, weak = false) => {
    const resolved = resolveUrl(raw, ctx.base);
    if (!resolved || resolved.key === ctx.pageKey) return;
    hits.push({ el, via, attr, key: resolved.key, absolute: resolved.absolute, newTab, weak });
  };
  const addJs = (el: Element, via: HitVia, attr: string, code: string) => {
    for (const nav of parseJsNavigation(code)) add(el, via, attr, nav.url, nav.newTab, nav.loose);
  };

  for (const node of $(SCAN_SELECTOR).toArray()) {
    if (!isElement(node)) continue;
    const el = node;
    const $el = $(el);
    const tag = el.name.toLowerCase();

    if (tag === "script") {
      if (!includeScripts) continue;
      for (const url of scriptUrls($el.text())) add(el, "script", "", url, false, true);
      continue;
    }

    const href = $el.attr("href");
    if ((tag === "a" || tag === "area") && href !== undefined) {
      const trimmed = href.trim();
      if (/^javascript:/i.test(trimmed)) {
        let code = trimmed.slice("javascript:".length);
        try {
          code = decodeURIComponent(code);
        } catch {
          // Mantém o código como está.
        }
        addJs(el, "js-href", "href", code);
      } else {
        add(el, "href", "href", href);
      }
    }
    if (tag === "form") add(el, "action", "action", $el.attr("action"));
    if (tag === "button" || tag === "input") add(el, "formaction", "formaction", $el.attr("formaction"));
    if (tag === "iframe" || tag === "frame") add(el, "src", "src", $el.attr("src"), false, true);

    const onclick = $el.attr("onclick");
    if (onclick) addJs(el, "onclick", "onclick", onclick);

    for (const attr of DATA_ATTRS) {
      const value = $el.attr(attr)?.trim();
      if (!value || !URLISH_RE.test(value)) continue;
      add(el, "data", attr, /^www\./i.test(value) ? `https://${value}` : value);
    }
    for (const [attr, rootKey] of ELEMENTOR_ATTRS) {
      const json = $el.attr(attr);
      if (!json) continue;
      for (const url of elementorUrls(json, rootKey)) add(el, "elementor", attr, url, false, true);
    }
  }
  return hits;
}

// ─── Texto do botão e heurística ─────────────────────────────────────────────

function collapse(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function truncateLabel(text: string): string {
  if (text.length <= CHECKOUT_LABEL_MAX) return text;
  return `${text.slice(0, CHECKOUT_LABEL_MAX - 1).trimEnd()}…`;
}

/** Texto visível do elemento (botão, link, formulário), já aparado. */
function elementText($: CheerioAPI, el: Element): string {
  const $el = $(el);
  const tag = el.name.toLowerCase();
  let text = "";
  if (tag === "form") {
    const button = $el.find('button, input[type="submit"], input[type="image"], input[type="button"]').first().get(0);
    if (button) text = elementText($, button);
  } else if (tag === "input") {
    text = collapse($el.attr("value") ?? $el.attr("alt"));
  } else if (tag === "img") {
    text = collapse($el.attr("alt"));
  } else if (tag !== "iframe" && tag !== "frame") {
    const $copy = $el.clone();
    $copy.find("script, style, noscript, template").remove();
    text = collapse($copy.text());
  }
  if (!text) text = collapse($el.attr("aria-label") ?? $el.attr("title"));
  if (!text) text = collapse($el.find("img[alt]").first().attr("alt"));
  return text;
}

/** Formulário com campo de e-mail: captura de lead, não checkout. */
function isLeadForm($: CheerioAPI, el: Element): boolean {
  const $form = el.name.toLowerCase() === "form" ? $(el) : $(el).closest("form");
  return $form.find('input[type="email" i], input[name*="email" i], input[name*="e-mail" i]').length > 0;
}

/**
 * Confiança heurística (0 = não parece compra) para um link de domínio
 * desconhecido, pelo texto e pelas classes do botão.
 */
function heuristicConfidence(text: string, classes: string): number {
  const normalized = normalizeText(text);
  if (NOT_BUY_TEXT_RE.test(normalized)) return 0;
  const buyText = BUY_TEXT_RE.test(normalized);
  const ctaClass = CTA_CLASS_RE.test(classes);
  if (buyText) return ctaClass ? 35 : 30;
  if (STRONG_BUY_CLASS_RE.test(classes)) return 25;
  return 0;
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Encontra os links de checkout da página. Plataformas conhecidas têm
 * confiança alta; links externos de domínio desconhecido só entram quando
 * texto/classe parecem botão de compra (confiança baixa, plataforma
 * "Desconhecida"). Resultado agrupado por URL (sem #hash, com query),
 * ordenado por confiança e depois pela ordem na página.
 */
export function detectCheckouts($: CheerioAPI, pageUrl: string): CheckoutCandidate[] {
  const ctx = scanContext($, pageUrl);
  const pageDomain = registrableDomain(ctx.pageKey);
  const hits = collectHits($, ctx, true);

  const groups = new Map<string, Hit[]>();
  for (const hit of hits) {
    const list = groups.get(hit.key);
    if (list) list.push(hit);
    else groups.set(hit.key, [hit]);
  }

  const textCache = new Map<Element, string>();
  const textOf = (el: Element) => {
    let text = textCache.get(el);
    if (text === undefined) {
      text = elementText($, el);
      textCache.set(el, text);
    }
    return text;
  };

  const candidates: (CheckoutCandidate & { order: number })[] = [];
  let order = 0;
  for (const [key, group] of groups) {
    order++;
    const match = matchCheckoutPlatform(key, ctx.pageKey);
    let platform = UNKNOWN_CHECKOUT_PLATFORM;
    let confidence = 0;

    if (match) {
      const accepted = group.some((hit) => hit.via !== "script" || match.confidence >= SCRIPT_MIN_CONFIDENCE);
      if (accepted) {
        platform = match.platform;
        confidence = match.confidence;
      }
    } else {
      const host = (() => {
        try {
          return cleanHost(new URL(key).hostname);
        } catch {
          return "";
        }
      })();
      const external = registrableDomain(key) !== pageDomain;
      if (external && host && !hostInList(host, NON_CHECKOUT_HOSTS)) {
        for (const hit of group) {
          if (hit.weak) continue;
          if ((hit.via === "action" || hit.via === "formaction") && isLeadForm($, hit.el)) continue;
          const $el = $(hit.el);
          const classes = `${$el.attr("class") ?? ""} ${$el.attr("id") ?? ""}`;
          confidence = Math.max(confidence, heuristicConfidence(textOf(hit.el), classes));
        }
      }
    }
    if (confidence <= 0) continue;

    const elements = new Set(group.map((hit) => hit.el));
    const label = group
      .filter((hit) => hit.via !== "script")
      .map((hit) => truncateLabel(textOf(hit.el)))
      .find((text) => text.length > 0);
    const source = group
      .map((hit) => SOURCE_BY_VIA[hit.via])
      .reduce((a, b) => (SOURCE_PRIORITY[b] < SOURCE_PRIORITY[a] ? b : a));

    candidates.push({
      url: key,
      platform,
      ...(label ? { label } : {}),
      source,
      confidence,
      occurrences: elements.size,
      order,
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence || a.order - b.order);
  return candidates.map(({ order: _order, ...candidate }) => candidate);
}

function isAnchor(el: Element): boolean {
  const tag = el.name.toLowerCase();
  return tag === "a" || tag === "area";
}

function applyMark($: CheerioAPI, hit: Hit) {
  const $el = $(hit.el);
  $el.attr("data-os-checkout", "1");

  /** Navegação feita por JS: em <a> vira href; nos demais, data-os-href. */
  const setNavigation = (force: boolean) => {
    if (isAnchor(hit.el)) {
      const current = $el.attr("href")?.trim() ?? "";
      if (force || !current || current.startsWith("#") || /^javascript:/i.test(current)) {
        $el.attr("href", hit.absolute);
        if (hit.newTab && !$el.attr("target")) {
          $el.attr("target", "_blank");
          $el.attr("rel", "noopener");
        }
      }
    } else {
      $el.attr("data-os-href", hit.absolute);
      if (hit.newTab) $el.attr("data-os-target", "_blank");
    }
  };

  switch (hit.via) {
    case "href":
    case "action":
    case "formaction":
    case "src":
      $el.attr(hit.attr, hit.absolute);
      break;
    case "js-href":
      setNavigation(true);
      break;
    case "onclick":
      $el.removeAttr("onclick");
      setNavigation(true);
      break;
    case "data":
      $el.attr(hit.attr, hit.absolute);
      setNavigation(false);
      break;
    case "elementor":
      setNavigation(false);
      break;
    case "script":
      break;
  }
}

/**
 * Marca todo elemento que leva a um dos checkouts com data-os-checkout="1":
 * <a> fica com href absoluto; elementos que navegavam por onclick/data-*
 * ganham data-os-href (URL absoluta; o runtime da página navega no clique) e
 * perdem o onclick; formulários são marcados no próprio <form>. Devolve
 * quantos elementos foram marcados.
 */
export function markCheckouts($: CheerioAPI, pageUrl: string, candidates: CheckoutCandidate[]): number {
  const ctx = scanContext($, pageUrl);
  const wanted = new Set<string>();
  for (const candidate of candidates) {
    const resolved = resolveUrl(candidate.url, ctx.base);
    if (resolved) wanted.add(resolved.key);
  }
  if (!wanted.size) return 0;

  const marked = new Set<Element>();
  for (const hit of collectHits($, ctx, false)) {
    if (!wanted.has(hit.key)) continue;
    applyMark($, hit);
    marked.add(hit.el);
  }
  return marked.size;
}

// ─── Navegação por JS que não é checkout ─────────────────────────────────────

export interface JsNavigationOptions {
  /**
   * Origem interna (ZIP/HTML colado sem link de origem): destinos nela ficam
   * relativos à página em vez de apontar para um host que não existe.
   */
  localOrigin?: string | null;
  /**
   * Como escrever um destino da origem interna (`raw` = valor original do JS,
   * que o navegador resolvia contra o <base> do documento).
   */
  toLocal?: (target: URL, raw: string, anchor: boolean) => string;
}

/** Esquemas que um link <a> pode manter (o navegador trata sozinho). */
const ANCHOR_ONLY_SCHEME_RE = /^(?:mailto|tel|sms|whatsapp):/i;

/** `document.getElementById('x').scrollIntoView(…)`, `$('html,body').animate({scrollTop: $('#x').offset().top})`… */
const SCROLL_TARGET_RES: RegExp[] = [
  /getElementById\s*\(\s*(["'`])([\w:.-]+)\1\s*\)\s*\.\s*scrollIntoView\b/,
  /querySelector\s*\(\s*(["'`])#([\w:.-]+)\1\s*\)\s*\.\s*scrollIntoView\b/,
  /scrollTop\s*:\s*(?:\$|jQuery)\s*\(\s*(["'`])#([\w:.-]+)\1\s*\)\s*\.\s*offset\s*\(\s*\)/,
];

/**
 * Destino de navegação pronto para o HTML: âncora (#x), URL absoluta http(s)
 * ou, só para <a>, mailto:/tel:/WhatsApp. null quando não dá para usar.
 */
function navigationTarget(raw: string, base: string, anchor: boolean, opts: JsNavigationOptions): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("#")) return value.length > 1 ? value : null;
  if (ANCHOR_ONLY_SCHEME_RE.test(value)) return anchor ? value : null;
  let parsed: URL;
  try {
    parsed = new URL(value, base);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (opts.localOrigin && parsed.origin === opts.localOrigin) {
    return opts.toLocal ? opts.toLocal(parsed, value, anchor) : value;
  }
  return parsed.href;
}

/** Destino de um trecho de JS: navegação explícita ou rolagem até uma seção da página. */
function jsTarget($: CheerioAPI, code: string): { url: string; newTab: boolean } | null {
  const nav = parseJsNavigation(code).find((n) => !n.loose);
  if (nav) return { url: nav.url, newTab: nav.newTab };
  for (const re of SCROLL_TARGET_RES) {
    const id = re.exec(code)?.[2];
    if (id && $(`[id="${id.replace(/"/g, "")}"]`).length) return { url: `#${id}`, newTab: false };
  }
  return null;
}

/**
 * Botões e links que navegavam por JavaScript (onclick, href="javascript:…")
 * e NÃO são checkout: sem os scripts (modo Editável) eles ficariam mortos.
 * Convertemos o destino em atributo: <a>/<area> ganham href (e target=_blank
 * quando abriam em nova aba); os demais ganham data-os-href (+
 * data-os-target), que o runtime da página navega no clique. Cobre
 * `location.href='#oferta'`, `window.open('https://wa.me/…')`,
 * `location.href='/obrigado'` e `scrollIntoView` de uma seção.
 * Rode DEPOIS de markCheckouts (que já cuida dos checkouts). Devolve quantos
 * elementos foram convertidos.
 */
export function convertJsNavigation($: CheerioAPI, pageUrl: string, opts: JsNavigationOptions = {}): number {
  const { base } = scanContext($, pageUrl);
  let converted = 0;
  for (const node of $("[onclick], a[href], area[href]").toArray()) {
    if (!isElement(node)) continue;
    const el = node;
    const $el = $(el);
    if ($el.attr("data-os-href") !== undefined || $el.attr("data-os-checkout") !== undefined) continue;
    const anchor = isAnchor(el);
    const href = anchor ? ($el.attr("href") ?? "").trim() : "";
    const jsHref = anchor && /^javascript:/i.test(href);
    const onclick = $el.attr("onclick") ?? "";
    if (!onclick && !jsHref) continue;
    // Link que já navega sozinho: o onclick era extra (rastreio, animação).
    if (anchor && !jsHref && href && !href.startsWith("#")) continue;

    let code = onclick;
    if (jsHref) {
      let js = href.slice("javascript:".length);
      try {
        js = decodeURIComponent(js);
      } catch {
        // mantém
      }
      code = `${onclick};${js}`;
    }
    const found = jsTarget($, code);
    if (!found) continue;
    const target = navigationTarget(found.url, base, anchor, opts);
    if (!target) continue;

    if (anchor) {
      $el.attr("href", target);
      if (found.newTab && !target.startsWith("#") && !$el.attr("target")) {
        $el.attr("target", "_blank");
        $el.attr("rel", "noopener");
      }
    } else {
      $el.attr("data-os-href", target);
      if (found.newTab && !target.startsWith("#")) $el.attr("data-os-target", "_blank");
    }
    $el.removeAttr("onclick");
    converted++;
  }
  return converted;
}
