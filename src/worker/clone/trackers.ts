/**
 * Detecção e remoção de rastreadores, chats e banners de cookies do clone.
 *
 * URLs são decididas nesta ordem (a primeira regra que casar vence):
 *   1. exceções com caminho (SAFE_URLS, ex.: SDK social do Facebook);
 *   2. assinaturas com host + caminho (ex.: facebook.com/tr, Blip no unpkg);
 *   3. exceções só de host (players de VSL, fontes, CDNs, pagamentos);
 *   4. assinaturas só de caminho (ex.: /gtm.js?id=GTM-…, plugins do WordPress);
 *   5. assinaturas só de host (ex.: connect.facebook.net, embed.tawk.to);
 *   6. third-party-web, apenas nas categorias de anúncio, analytics, tag
 *      manager, atendimento, marketing e consentimento (com exclusões).
 *
 * Funções puras: nada de rede nem banco. `removeTrackers` altera o `$` recebido.
 */
import type { CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import tpw from "third-party-web/nostats-subset";
import { getDomain } from "tldts";
import {
  GTAG_FAMILY,
  SAFE_URLS,
  TPW_CATEGORIES,
  TPW_EXCLUDED,
  TPW_OVERRIDES,
  TRACKER_QUEUE_GLOBALS,
  TRACKER_SIGNATURES,
  type TrackerSignature,
  type TrackerUrlRule,
  VERIFICATION_METAS,
  WIDGET_RESIDUE,
} from "@/detection/trackers";
import type { RemovedTracker, TrackerMatch } from "./types";

/** Tamanho máximo do trecho guardado para restaurar. */
export const SNIPPET_MAX = 4000;

/** Scripts inline maiores que isto não são varridos atrás de URLs de rastreador. */
const INLINE_URL_SCAN_MAX = 4000;

/** Acima disto um script com chamadas soltas (fbq('track')…) é tratado como misto. */
const CALLS_ONLY_MAX = 20_000;

// ─── URLs ────────────────────────────────────────────────────────────────────

interface ParsedUrl {
  host: string;
  /** pathname + search. */
  path: string;
}

interface FlatRule {
  sig: TrackerSignature;
  host?: RegExp;
  path?: RegExp;
}

const HOST_PATH_RULES: FlatRule[] = [];
const PATH_RULES: FlatRule[] = [];
const HOST_RULES: FlatRule[] = [];
for (const sig of TRACKER_SIGNATURES) {
  for (const rule of sig.urls ?? []) {
    if (rule.host && rule.path) HOST_PATH_RULES.push({ sig, ...rule });
    else if (rule.path) PATH_RULES.push({ sig, ...rule });
    else if (rule.host) HOST_RULES.push({ sig, ...rule });
  }
}
const SAFE_PATH_RULES = SAFE_URLS.filter((r) => r.path);
const SAFE_HOST_RULES = SAFE_URLS.filter((r) => r.host && !r.path);

function ruleMatches(rule: TrackerUrlRule, url: ParsedUrl): boolean {
  if (rule.host && !rule.host.test(url.host)) return false;
  if (rule.path && !rule.path.test(url.path)) return false;
  return true;
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

/** Converte em URL http(s) absoluta; aceita "//host/…" e caminhos relativos com base. */
function parseUrl(raw: string, base?: string): ParsedUrl | null {
  let value = raw.trim();
  if (!value || /^(?:data|blob|javascript|about|mailto|tel):/i.test(value)) return null;
  if (value.startsWith("//")) value = `https:${value}`;
  try {
    const u = base ? new URL(value, base) : new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = normalizeHost(u.hostname);
    return host ? { host, path: `${u.pathname}${u.search}` } : null;
  } catch {
    return null;
  }
}

function sameSite(host: string, pageUrl: string): boolean {
  const page = parseUrl(pageUrl);
  if (!page) return false;
  if (page.host === host) return true;
  const a = getDomain(host, { allowPrivateDomains: true });
  return !!a && a === getDomain(page.host, { allowPrivateDomains: true });
}

function sigMatch(sig: TrackerSignature): TrackerMatch {
  return { vendor: sig.vendor, category: sig.category };
}

/** Regras próprias + exceções. `undefined` = nenhuma regra própria decidiu. */
function classifyBySignatures(url: ParsedUrl): TrackerMatch | null | undefined {
  if (SAFE_PATH_RULES.some((r) => ruleMatches(r, url))) return null;
  for (const r of HOST_PATH_RULES) if (ruleMatches(r, url)) return sigMatch(r.sig);
  if (SAFE_HOST_RULES.some((r) => ruleMatches(r, url))) return null;
  for (const r of PATH_RULES) if (ruleMatches(r, url)) return sigMatch(r.sig);
  for (const r of HOST_RULES) if (ruleMatches(r, url)) return sigMatch(r.sig);
  return undefined;
}

// ─── third-party-web ─────────────────────────────────────────────────────────

type TpwEntity = (typeof tpw.entities)[number];

let tpwIndex: { exact: Map<string, TpwEntity>; wildcard: Map<string, TpwEntity> } | null = null;

/** Índice domínio → entidade (montado na primeira consulta). */
function getTpwIndex() {
  if (tpwIndex) return tpwIndex;
  const exact = new Map<string, TpwEntity>();
  const wildcard = new Map<string, TpwEntity>();
  for (const entity of tpw.entities) {
    for (const d of entity.domains) {
      const domain = d.toLowerCase();
      if (domain.startsWith("*.")) {
        if (!wildcard.has(domain.slice(2))) wildcard.set(domain.slice(2), entity);
      } else if (!exact.has(domain)) {
        exact.set(domain, entity);
      }
    }
  }
  tpwIndex = { exact, wildcard };
  return tpwIndex;
}

/** Entidade mais específica para o host (exato > curinga mais longo). */
function tpwEntity(host: string): TpwEntity | undefined {
  const index = getTpwIndex();
  const hit = index.exact.get(host);
  if (hit) return hit;
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const w = index.wildcard.get(labels.slice(i).join("."));
    if (w) return w;
  }
  return undefined;
}

function classifyByTpw(host: string): TrackerMatch | null {
  const entity = tpwEntity(host);
  if (!entity || TPW_EXCLUDED.has(entity.name)) return null;
  const category = TPW_CATEGORIES[entity.category];
  if (!category) return null;
  const override = TPW_OVERRIDES[entity.name];
  let vendor = override?.vendor ?? entity.name;
  if (entity.category === "consent-provider") vendor = `Banner de cookies (${vendor.replace(/\s+CMP$/i, "")})`;
  return { vendor, category: override?.category ?? category };
}

/** Como a URL foi reconhecida: assinatura própria ou só pela base third-party-web (host inteiro). */
export type TrackerMatchSource = "signature" | "tpw";

function classifyParsed(url: ParsedUrl, allowTpw: boolean): { match: TrackerMatch; via: TrackerMatchSource } | null {
  const own = classifyBySignatures(url);
  if (own !== undefined) return own ? { match: own, via: "signature" } : null;
  const tpwMatch = allowTpw ? classifyByTpw(url.host) : null;
  return tpwMatch ? { match: tpwMatch, via: "tpw" } : null;
}

/**
 * Como `classifyUrl`, mas diz também se a decisão veio de uma assinatura
 * própria (host + caminho, caminho) ou só do host na base third-party-web.
 * A base third-party-web lista domínios inteiros de empresas de marketing, e
 * alguns deles também hospedam CONTEÚDO (imagens das landing pages do RD
 * Station, ActiveCampaign, Mailchimp): para imagens, folhas de estilo e
 * fontes, só a assinatura própria é prova de rastreador.
 */
export function classifyUrlSource(
  url: string,
  pageUrl?: string,
): { match: TrackerMatch; via: TrackerMatchSource } | null {
  if (typeof url !== "string") return null;
  const parsed = parseUrl(url, pageUrl);
  if (!parsed) return null;
  const allowTpw = !pageUrl || !sameSite(parsed.host, pageUrl);
  const hit = classifyParsed(parsed, allowTpw);
  if (!hit) return null;
  const refined = refineGoogle(hit.match, url);
  return refined ? { match: refined, via: hit.via } : null;
}

/**
 * Classifica uma URL (script, pixel, iframe, requisição de rede).
 * Com `pageUrl`, resolve caminhos relativos e ignora a base third-party-web para
 * arquivos do próprio site (só as assinaturas específicas valem ali).
 */
export function classifyUrl(url: string, pageUrl?: string): TrackerMatch | null {
  return classifyUrlSource(url, pageUrl)?.match ?? null;
}

/** Tipos de requisição (Playwright `request.resourceType()`) que costumam ser conteúdo visível. */
const CONTENT_RESOURCE_TYPES = new Set(["image", "stylesheet", "font", "media"]);

/**
 * Decide o bloqueio de uma requisição na captura. Imagens, CSS, fontes e
 * vídeos só são bloqueados por assinatura própria (ou quando o caminho tem
 * cara de pixel): o host inteiro na base third-party-web não basta, senão as
 * imagens de landing pages hospedadas em CDNs de marketing somem da cópia.
 */
export function classifyRequest(url: string, resourceType?: string, pageUrl?: string): TrackerMatch | null {
  const hit = classifyUrlSource(url, pageUrl);
  if (!hit) return null;
  if (hit.via === "tpw" && resourceType && CONTENT_RESOURCE_TYPES.has(resourceType) && !hasPixelPath(url)) {
    return null;
  }
  return hit.match;
}

// ─── Pixel ou conteúdo? ──────────────────────────────────────────────────────

/** Trechos de caminho típicos de endpoints de rastreio (/tr, /collect, /pixel…). */
const PIXEL_SEGMENTS = new Set([
  "tr",
  "pixel",
  "px",
  "collect",
  "track",
  "tracking",
  "tracker",
  "beacon",
  "event",
  "events",
  "impression",
  "imp",
  "conversion",
  "conversions",
  "pageview",
  "hit",
  "ping",
  "sync",
  "usersync",
  "activity",
  "activityi",
  "1x1",
  "spacer",
]);
/** Parâmetros típicos de chamadas de pixel. */
const PIXEL_PARAMS = new Set(["ev", "event", "pixel_id", "pixelid", "pid", "tid"]);

/** O endereço tem cara de pixel/endpoint de rastreio (e não de arquivo de conteúdo)? */
export function hasPixelPath(raw: string, base?: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim().replace(/^\/\//, "https://"), base);
  } catch {
    return false;
  }
  const segments = u.pathname.toLowerCase().split("/").filter(Boolean);
  if (segments.some((seg) => PIXEL_SEGMENTS.has(seg.replace(/\.[a-z0-9]+$/, "")))) return true;
  for (const key of u.searchParams.keys()) if (PIXEL_PARAMS.has(key.toLowerCase())) return true;
  return false;
}

function tinyLength(value: string | undefined): boolean {
  if (value === undefined) return false;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(value);
  return !!m && Number(m[1]) <= 1;
}

/** Elemento invisível ou de 1×1 (atributos width/height, style ou `hidden`). */
function isInvisibleBox(attrs: Record<string, string | undefined>): boolean {
  if (attrs.hidden !== undefined) return true;
  if (tinyLength(attrs.width) || tinyLength(attrs.height)) return true;
  const style = (attrs.style ?? "").toLowerCase();
  if (/(?:^|;)\s*display\s*:\s*none/.test(style) || /(?:^|;)\s*visibility\s*:\s*hidden/.test(style)) return true;
  const w = /(?:^|;)\s*width\s*:\s*([^;]+)/.exec(style)?.[1];
  const h = /(?:^|;)\s*height\s*:\s*([^;]+)/.exec(style)?.[1];
  return tinyLength(w) || tinyLength(h);
}

/** Atributos de uma tag em texto (`<img src="…" width="1">`), em minúsculas. */
function tagAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = m[1]?.toLowerCase();
    if (!name || name.startsWith("<")) continue;
    attrs[name] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

/**
 * Imagem/iframe achado só pela base third-party-web: é pixel se for invisível
 * (1×1, display:none) ou se o endereço tiver cara de rastreio.
 */
function looksLikePixel(src: string, attrs: Record<string, string | undefined>, pageUrl?: string): boolean {
  return isInvisibleBox(attrs) || hasPixelPath(src, pageUrl || undefined);
}

/**
 * true quando o host inteiro é de rastreador/chat (bloqueio por host).
 * Endpoints que dependem do caminho (ex.: facebook.com/tr, Blip no unpkg) não
 * entram aqui: para esses use `classifyUrl` com a URL completa.
 */
export function isTrackerHost(hostname: string): boolean {
  if (typeof hostname !== "string") return false;
  const host = hostname.includes("/") ? parseUrl(hostname)?.host : normalizeHost(hostname.replace(/:\d+$/, ""));
  if (!host) return false;
  const url: ParsedUrl = { host, path: "/" };
  if (SAFE_HOST_RULES.some((r) => ruleMatches(r, url))) return false;
  if (HOST_RULES.some((r) => ruleMatches(r, url))) return true;
  return classifyByTpw(host) !== null;
}

// ─── Scripts inline ──────────────────────────────────────────────────────────

/** Dados de frameworks (Next, Nuxt…): podem citar o código do GTM como texto. */
const FRAMEWORK_DATA =
  /^\s*(?:\(?\s*self\.__next_f\s*=|self\.__next_f\.push\s*\(|window\.__NUXT__\s*=|window\.__INITIAL_STATE__\s*=|window\.__remixContext\s*=|window\.__APOLLO_STATE__\s*=|window\.__PRELOADED_STATE__\s*=)/;

const URL_IN_CODE = /(?:https?:)?\/\/(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s"'`<>\\)]*)?/gi;

const GOOGLE_TAG_ID = /\b(G-[A-Z0-9]{6,14}|UA-\d{4,12}-\d{1,4}|AW-\d{6,14}|DC-\d{6,14}|GT-[A-Z0-9]{6,14})\b/;

const GTAG_VENDORS = new Set<string>(Object.values(GTAG_FAMILY));

/** gtag.js serve GA, Google Ads e o "Google tag": decide pelo primeiro ID do texto. */
function refineGoogle(match: TrackerMatch | null, text: string): TrackerMatch | null {
  if (!match || !GTAG_VENDORS.has(match.vendor)) return match;
  const id = GOOGLE_TAG_ID.exec(text)?.[1];
  if (!id) return match;
  if (id.startsWith("G-") || id.startsWith("UA-")) return { vendor: GTAG_FAMILY.analytics, category: "ANALYTICS" };
  if (id.startsWith("AW-") || id.startsWith("DC-")) return { vendor: GTAG_FAMILY.ads, category: "ADS" };
  return { vendor: GTAG_FAMILY.tag, category: "TAG_MANAGER" };
}

/**
 * Classifica o código de um `<script>` inline. Reconhece o código-base dos
 * pixels/chats (padrões fortes), carregadores pequenos que injetam um script
 * de rastreador, e scripts feitos só de chamadas de rastreamento
 * (`fbq('track', …)`, `gtag('event', …)`). Scripts que misturam essas chamadas
 * com outro código (ex.: clique do botão que também redireciona) ficam.
 */
export function classifyInlineScript(code: string): TrackerMatch | null {
  if (typeof code !== "string") return null;
  const text = code.trim();
  if (!text || FRAMEWORK_DATA.test(text)) return null;

  for (const sig of TRACKER_SIGNATURES) {
    if (sig.inline?.some((re) => re.test(text))) return refineGoogle(sigMatch(sig), text);
  }

  if (text.length <= INLINE_URL_SCAN_MAX) {
    for (const m of text.replace(/\\\//g, "/").matchAll(URL_IN_CODE)) {
      const hit = classifyUrl(m[0]);
      if (hit) return refineGoogle(hit, text);
    }
  }

  const caller = TRACKER_SIGNATURES.find((sig) => sig.calls?.some((re) => re.test(text)));
  if (caller && text.length <= CALLS_ONLY_MAX && isOnlyTracking(text)) return refineGoogle(sigMatch(caller), text);
  return null;
}

const CALL_PATTERNS = TRACKER_SIGNATURES.flatMap((s) => s.calls ?? []).map(
  (re) => new RegExp(re.source, `${re.flags.replace("g", "")}g`),
);

const QUEUE_NAMES = TRACKER_QUEUE_GLOBALS.map((n) => n.replace(/[$]/g, "\\$")).join("|");

/** Sobras inofensivas depois de tirar as chamadas de rastreamento. */
const BOILERPLATE: readonly RegExp[] = [
  /(['"])use strict\1/g,
  new RegExp(
    `(?:\\b(?:var|let|const)\\s+)?(?:\\bwindow\\s*\\.\\s*)?\\b(${QUEUE_NAMES})\\s*=\\s*(?:(?:window\\s*\\.\\s*)?\\1\\s*\\|\\|\\s*)?(?:\\[\\s*\\]|\\{\\s*\\})`,
    "g",
  ),
  /\bfunction\s+[\w$]+\s*\([^()]*\)\s*\{[\s;]*\}/g,
  /\bif\s*\((?:[^()]|\([^()]*\))*\)\s*(?:\{[\s;]*\}|;)(?:\s*else\s*(?:\{[\s;]*\}|;))?/g,
  /\btry\s*\{[\s;]*\}\s*catch\s*(?:\([^()]*\))?\s*\{[^{}]*\}(?:\s*finally\s*\{[\s;]*\})?/g,
  /(?:\b(?:window|document)\s*\.\s*)?\b(?:addEventListener|setTimeout|setInterval|requestAnimationFrame)\s*\(\s*(?:['"][\w:.-]+['"]\s*,\s*)?(?:function\s*[\w$]*\s*\([^()]*\)|\([^()]*\)\s*=>|[\w$]+\s*=>)\s*\{[\s;]*\}\s*(?:,[^()]*)?\)/g,
  /(?:\$|\bjQuery)\s*\(\s*document\s*\)\s*\.\s*ready\s*\(\s*function\s*\([^()]*\)\s*\{[\s;]*\}\s*\)/g,
  /(?:\$|\bjQuery)\s*\(\s*function\s*\([^()]*\)\s*\{[\s;]*\}\s*\)/g,
  /\(\s*function\s*[\w$]*\s*\([^()]*\)\s*\{[\s;]*\}\s*\)\s*\([^()]*\)/g,
  /\(\s*function\s*[\w$]*\s*\([^()]*\)\s*\{[\s;]*\}\s*\([^()]*\)\s*\)/g,
  /!\s*function\s*[\w$]*\s*\([^()]*\)\s*\{[\s;]*\}\s*\([^()]*\)/g,
  /\(\s*(?:\([^()]*\)|[\w$]+)\s*=>\s*\{[\s;]*\}\s*\)\s*\(\s*\)/g,
];

/** O script é só chamadas de rastreamento (e sobras inofensivas)? */
function isOnlyTracking(code: string): boolean {
  let s = code
    .replace(/<!--|-->/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
  s = stripCalls(s);
  for (let i = 0; i < 8; i++) {
    const before = s;
    for (const re of BOILERPLATE) s = s.replace(re, " ");
    if (s === before) break;
  }
  return s.replace(/[\s;,]+/g, "") === "";
}

/** Remove as chamadas de rastreamento (com argumentos e encadeamentos). */
function stripCalls(input: string): string {
  let s = input;
  for (let guard = 0; guard < 500; guard++) {
    const call = nextCall(s);
    if (!call) break;
    let start = call.start;
    const prefix = /\b(?:window|self|top|parent)\s*\.\s*$/.exec(s.slice(Math.max(0, start - 24), start));
    if (prefix) start -= prefix[0].length;
    s = `${s.slice(0, start)} ${s.slice(call.end)}`;
  }
  return s;
}

function nextCall(s: string): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  for (const re of CALL_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      // `function gtag(){…}` é declaração, não chamada.
      if (/\bfunction\s*$/.test(s.slice(Math.max(0, m.index - 12), m.index))) continue;
      const open = s.indexOf("(", m.index);
      const end = open < 0 ? -1 : consumeCall(s, open);
      if (end < 0) continue;
      if (!best || m.index < best.start) best = { start: m.index, end };
      break;
    }
  }
  return best;
}

/** Fim da chamada que abre em `open`, incluindo `.metodo(…)` encadeados. */
function consumeCall(s: string, open: number): number {
  let end = skipBalanced(s, open);
  while (end > 0) {
    const chain = /^\s*\.\s*[\w$]+\s*\(/.exec(s.slice(end));
    if (!chain) break;
    const next = skipBalanced(s, end + chain[0].length - 1);
    if (next < 0) break;
    end = next;
  }
  return end;
}

function skipBalanced(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(s, i);
      if (i < 0) return -1;
    } else if (c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function skipString(s: string, start: number): number {
  const quote = s[start];
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === quote) return i;
  }
  return -1;
}

// ─── IDs ─────────────────────────────────────────────────────────────────────

const SIG_BY_VENDOR = new Map(TRACKER_SIGNATURES.map((s) => [s.vendor, s]));
const idPatternCache = new Map<string, RegExp[]>();

function idPatterns(vendor: string): RegExp[] {
  const cached = idPatternCache.get(vendor);
  if (cached) return cached;
  const list = (SIG_BY_VENDOR.get(vendor)?.ids ?? []).map(
    (re) => new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`),
  );
  idPatternCache.set(vendor, list);
  return list;
}

/** Todos os IDs (sem repetir, na ordem em que aparecem) do fornecedor no texto. */
export function extractPixelIds(match: TrackerMatch, text: string): string[] {
  if (!match || typeof text !== "string" || !text) return [];
  const patterns = idPatterns(match.vendor);
  if (!patterns.length) return [];
  const src = text.replace(/&amp;/gi, "&").replace(/\\\//g, "/");
  const hits: { index: number; id: string }[] = [];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) if (m[1]) hits.push({ index: m.index ?? 0, id: m[1] });
  }
  hits.sort((a, b) => a.index - b.index);
  const out: string[] = [];
  for (const h of hits) if (!out.includes(h.id)) out.push(h.id);
  return out;
}

/**
 * ID do pixel/conta quando dá para achar: Meta (`fbq('init')`, `tr?id=`), TikTok
 * (`ttq.load`, `sdkid=`), GTM-/G-/AW-/UA-, Clarity, Hotjar, Kwai, UTMify…
 */
export function extractPixelId(match: TrackerMatch, text: string): string | undefined {
  return extractPixelIds(match, text)[0];
}

// ─── Remoção no DOM ──────────────────────────────────────────────────────────

export interface RemoveTrackersOptions {
  /**
   * Também apaga restos já desenhados de chats e banners de cookies (balão do
   * JivoChat, banner da OneTrust…). Esses restos não entram na lista: o script
   * restaurado os recria. Padrão: true.
   */
  residue?: boolean;
}

/** Tipos de `<script>` que são dados, não código (JSON-LD, templates…). */
const NON_JS_TYPES = /json|importmap|speculationrules|template|handlebars|mustache|x-tmpl|text\/html|x-magento/i;

/** Atributos onde o script guarda a URL (inclusive "atrasados" por WP Rocket, LiteSpeed…). */
const SCRIPT_SRC_ATTRS = [
  "src",
  "data-src",
  "data-rocket-src",
  "data-lazy-src",
  "data-litespeed-src",
  "data-pmdelayedscript",
];
const MEDIA_SRC_ATTRS = ["src", "data-src", "data-lazy-src"];
const LINK_RELS = new Set([
  "preconnect",
  "dns-prefetch",
  "preload",
  "prefetch",
  "modulepreload",
  "prerender",
  "stylesheet",
]);
const ATTR_URL = /\b(?:src|href|data-src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi;
const PROTECTED_TAGS = new Set(["html", "head", "body"]);

/** <link> que traz conteúdo (CSS, fonte, imagem), não só uma dica de conexão. */
function isContentLink(rels: string[], as: string | undefined): boolean {
  if (rels.includes("stylesheet")) return true;
  if (rels.includes("preload") || rels.includes("prefetch")) {
    return ["style", "font", "image", "video", "audio", "track"].includes((as ?? "").trim().toLowerCase());
  }
  return false;
}

function firstAttr(el: Element, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = el.attribs[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function locate(el: AnyNode): "head" | "body" {
  for (let p = el.parent; p; p = p.parent) {
    if ((p as Element).name === "head") return "head";
  }
  return "body";
}

function hasAncestorIn(el: AnyNode, set: Set<AnyNode>): boolean {
  for (let p = el.parent; p; p = p.parent) if (set.has(p)) return true;
  return false;
}

function trimSnippet(html: string): string {
  const s = html.trim();
  return s.length > SNIPPET_MAX ? s.slice(0, SNIPPET_MAX) : s;
}

/**
 * Remove do documento os rastreadores, chats e banners de cookies:
 * scripts externos e inline (JSON-LD fica), `<noscript>` com pixel/iframe de
 * rastreio, imagens/iframes de pixel, metas de verificação de domínio e links
 * de preconnect/dns-prefetch/preload para hosts de rastreador.
 *
 * Devolve cada item uma vez (fornecedor + ID + tipo iguais viram um só,
 * guardando o primeiro trecho), na ordem do documento.
 */
export function removeTrackers($: CheerioAPI, pageUrl: string, options: RemoveTrackersOptions = {}): RemovedTracker[] {
  const removed: RemovedTracker[] = [];
  const seen = new Set<string>();
  const doomed = new Set<AnyNode>();
  const classify = (raw: string) => classifyUrl(raw, pageUrl || undefined);
  const classifySource = (raw: string) => classifyUrlSource(raw, pageUrl || undefined);

  const record = (
    el: Element,
    match: TrackerMatch,
    kind: RemovedTracker["kind"],
    idText: string,
    explicitId?: string,
  ) => {
    doomed.add(el);
    const outer = $.html(el);
    const pixelId = explicitId || extractPixelIds(match, idText).join(", ") || undefined;
    const key = `${match.vendor}|${pixelId ?? ""}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    removed.push({
      vendor: match.vendor,
      category: match.category,
      ...(pixelId ? { pixelId } : {}),
      snippet: trimSnippet(outer),
      location: locate(el),
      kind,
    });
  };

  $("script, noscript, img, iframe, link, meta").each((_, el) => {
    if (hasAncestorIn(el, doomed)) return;
    switch (el.name) {
      case "script": {
        if (NON_JS_TYPES.test(el.attribs.type ?? "")) return;
        const src = firstAttr(el, SCRIPT_SRC_ATTRS);
        if (src) {
          const match = classify(src);
          if (match) record(el, match, "script-src", $.html(el));
          return;
        }
        const match = classifyInlineScript($(el).html() ?? "");
        if (match) record(el, match, "script-inline", $.html(el));
        return;
      }
      case "noscript": {
        const inner = ($(el).html() ?? "").replace(/&amp;/gi, "&");
        for (const m of inner.matchAll(ATTR_URL)) {
          const url = m[1] ?? m[2] ?? m[3] ?? "";
          const hit = classifySource(url);
          if (!hit) continue;
          // Fallback de lazy load (<noscript><img src="…cdn de marketing…/foto.jpg">) é conteúdo.
          if (hit.via === "tpw" && m.index !== undefined) {
            const start = inner.lastIndexOf("<", m.index);
            const end = inner.indexOf(">", m.index);
            const tag = start >= 0 ? inner.slice(start, end >= 0 ? end + 1 : undefined) : "";
            if (/^<(?:img|image|picture|source|link)\b/i.test(tag) && !looksLikePixel(url, tagAttrs(tag), pageUrl)) {
              continue;
            }
          }
          record(el, hit.match, "noscript", inner);
          return;
        }
        return;
      }
      case "img":
      case "iframe": {
        const src = firstAttr(el, MEDIA_SRC_ATTRS);
        const hit = src ? classifySource(src) : null;
        if (!hit || !src) return;
        // Só pelo host (third-party-web): imagens e iframes visíveis são conteúdo.
        if (hit.via === "tpw" && !looksLikePixel(src, el.attribs, pageUrl)) return;
        record(el, hit.match, "pixel", $.html(el));
        return;
      }
      case "link": {
        const rels = (el.attribs.rel ?? "").toLowerCase().split(/\s+/);
        if (!rels.some((r) => LINK_RELS.has(r))) return;
        const href = el.attribs.href?.trim();
        const hit = href ? classifySource(href) : null;
        if (!hit) return;
        if (hit.via === "tpw" && isContentLink(rels, el.attribs.as)) return;
        record(el, hit.match, "link", $.html(el));
        return;
      }
      case "meta": {
        const name = (el.attribs.name ?? el.attribs.property ?? "").trim().toLowerCase();
        const verification = VERIFICATION_METAS.find((v) => v.name === name);
        if (verification) {
          const content = el.attribs.content?.trim();
          record(el, { vendor: verification.vendor, category: "OTHER" }, "meta", "", content);
        }
        return;
      }
    }
  });

  for (const el of doomed) $(el).remove();
  if (options.residue !== false) removeWidgetResidue($);
  return removed;
}

/**
 * Apaga restos de chats/banners já desenhados no DOM (seletores específicos de
 * cada fornecedor). Devolve os fornecedores encontrados.
 */
export function removeWidgetResidue($: CheerioAPI): string[] {
  const vendors: string[] = [];
  for (const { vendor, selector } of WIDGET_RESIDUE) {
    const found = $(selector).filter((_, el) => !("name" in el) || !PROTECTED_TAGS.has(el.name));
    if (!found.length) continue;
    found.remove();
    if (!vendors.includes(vendor)) vendors.push(vendor);
  }
  // Anti-flicker do Google Optimize: a classe no <html> esconde a página inteira.
  const hidden = $("html.async-hide");
  if (hidden.length) {
    hidden.removeClass("async-hide");
    vendors.push("Google Optimize");
  }
  return vendors;
}
