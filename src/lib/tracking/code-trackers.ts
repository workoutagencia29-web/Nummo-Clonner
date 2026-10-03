/**
 * Pixels e tags de rastreamento dentro de código livre (da oferta ou da
 * página): o código-base da Meta colado em "Códigos da página", um gtag, o GTM…
 *
 * Carregadores codificados (atob + XOR, o código novo da UTMify) e scripts em
 * data: (JS adiado por plugin de cache) são lidos decodificados
 * (readableCode, src/detection/encoded-loader.ts).
 *
 * Usa as assinaturas próprias do clonador (src/detection/trackers.ts, só dados:
 * roda no painel, no servidor e na prévia, sem a base third-party-web), na mesma
 * ordem de decisão de src/worker/clone/trackers.ts: exceções com caminho,
 * assinaturas com host + caminho, exceções só de host, só de caminho, só de host.
 * Antes delas valem as de CONSENT_TRACKERS: o clonador trata o RD Station e o
 * HubSpot como chat, mas o carregador deles também mede as visitas; e ferramentas
 * comuns de análise/anúncio que não estão nas assinaturas (Mouseflow, Criteo…).
 * Chats e banners de cookies não contam (não são rastreamento de anúncio).
 * No servidor (prévia, ZIP e painel), ./code-trackers-server.ts completa com a
 * base third-party-web para o resto da internet.
 *
 * Para quê:
 * - código de página SEM categoria escolhida que tem rastreador vale como
 *   "Marketing" (espera o "Aceitar"), na prévia e no ZIP (resolveCodeCategory);
 * - o painel e o editor avisam quando um código "Essencial" tem rastreador
 *   (ele carregaria antes do "Aceitar").
 */
import { readableCode } from "@/detection/encoded-loader";
import {
  GTAG_FAMILY,
  SAFE_URLS,
  TRACKER_SIGNATURES,
  type TrackerSignature,
  type TrackerUrlRule,
} from "@/detection/trackers";
import { type CodeCategoryId, PAGE_CODE_DEFAULT_CATEGORY } from "./schema";

const GTM = "Google Tag Manager";

/** Casa o domínio e todos os subdomínios. */
const domains = (...list: string[]) =>
  new RegExp(`(?:^|\\.)(?:${list.map((d) => d.replace(/\./g, "\\.")).join("|")})$`, "i");

interface ConsentTracker {
  vendor: string;
  urls: TrackerUrlRule[];
  /** Trecho do código-base que basta sozinho. */
  inline?: RegExp[];
}

/**
 * Rastreamento para o consentimento que o clonador não trata como pixel/análise.
 * Valem antes das assinaturas do clonador.
 */
const CONSENT_TRACKERS: readonly ConsentTracker[] = [
  {
    // Só o carregador (loader-scripts); os formulários (rdstation-forms) e as imagens são conteúdo.
    vendor: "RD Station",
    urls: [{ host: /^d335luupugsy2\.cloudfront\.net$/i, path: /^\/js\/loader-scripts\//i }],
    inline: [/d335luupugsy2\.cloudfront\.net\/js\/loader-scripts/],
  },
  {
    // Código de rastreamento (js.hs-scripts.com carrega a análise junto com o chat).
    vendor: "HubSpot",
    urls: [
      { host: domains("hs-scripts.com", "hs-analytics.net", "hsadspixel.net") },
      { host: /^track\.hubspot\.com$/i },
    ],
    inline: [/js\.hs-scripts\.com/, /\b_hsq\b/],
  },
  { vendor: "Mouseflow", urls: [{ host: domains("mouseflow.com") }], inline: [/\b_mfq\b/] },
  { vendor: "Smartlook", urls: [{ host: domains("smartlook.com", "smartlook.cloud") }] },
  { vendor: "Criteo", urls: [{ host: domains("criteo.com", "criteo.net") }], inline: [/\bcriteo_q\b/] },
  { vendor: "Mixpanel", urls: [{ host: domains("mixpanel.com", "mxpnl.com") }], inline: [/\bmixpanel\.init\s*\(/] },
  { vendor: "Segment", urls: [{ host: domains("segment.com", "segment.io") }] },
  { vendor: "FullStory", urls: [{ host: domains("fullstory.com") }], inline: [/\b_fs_org\b/] },
  { vendor: "Heap", urls: [{ host: domains("heapanalytics.com", "heap-api.com") }] },
  { vendor: "Amplitude", urls: [{ host: domains("amplitude.com") }] },
  { vendor: "Crazy Egg", urls: [{ host: domains("crazyegg.com", "cetrk.com") }] },
  { vendor: "Lucky Orange", urls: [{ host: domains("luckyorange.com", "luckyorange.net") }] },
];

/** Categorias que são rastreamento (as outras: chats, banners de cookies, "outros"). */
const TRACKING_CATEGORIES: ReadonlySet<string> = new Set(["PIXEL", "ANALYTICS", "TAG_MANAGER", "ADS"]);

interface Rule {
  sig: TrackerSignature;
  host?: RegExp;
  path?: RegExp;
}

const HOST_PATH: Rule[] = [];
const PATH_ONLY: Rule[] = [];
const HOST_ONLY: Rule[] = [];
for (const sig of TRACKER_SIGNATURES) {
  for (const rule of sig.urls ?? []) {
    if (rule.host && rule.path) HOST_PATH.push({ sig, ...rule });
    else if (rule.path) PATH_ONLY.push({ sig, ...rule });
    else if (rule.host) HOST_ONLY.push({ sig, ...rule });
  }
}
const SAFE_PATH = SAFE_URLS.filter((r) => r.path);
const SAFE_HOST = SAFE_URLS.filter((r) => r.host && !r.path);

/** Endereços absolutos (ou "//host/…") no meio do código — em atributos e dentro do JavaScript. */
const URL_IN_CODE = /(?:https?:)?\/\/(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s"'`<>\\)]*)?/gi;
/** src de um <script> (com ou sem aspas). */
const SCRIPT_SRC = /<script\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

function matches(rule: TrackerUrlRule, host: string, path: string) {
  return (!rule.host || rule.host.test(host)) && (!rule.path || rule.path.test(path));
}

/** Endereço absoluto ("//host" vira https:) ou null. */
function parse(raw: string): URL | null {
  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

/**
 * O que as regras próprias dizem do endereço: nome do rastreador (para o
 * consentimento), "known" (reconhecido e não é rastreamento: chat, player,
 * fonte, CDN, pagamento…) ou null (ninguém reconhece).
 */
export function ownVerdict(raw: string): string | null {
  const url = parse(raw);
  if (!url) return "known";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const path = `${url.pathname}${url.search.replace(/&amp;/gi, "&")}`;
  for (const t of CONSENT_TRACKERS) if (t.urls.some((r) => matches(r, host, path))) return t.vendor;
  const sig = (() => {
    if (SAFE_PATH.some((r) => matches(r, host, path))) return null;
    for (const r of HOST_PATH) if (matches(r, host, path)) return r.sig;
    if (SAFE_HOST.some((r) => matches(r, host, path))) return null;
    for (const r of PATH_ONLY) if (matches(r, host, path)) return r.sig;
    for (const r of HOST_ONLY) if (matches(r, host, path)) return r.sig;
    return undefined;
  })();
  if (sig === undefined) return null;
  return sig && TRACKING_CATEGORIES.has(sig.category) ? sig.vendor : "known";
}

/** Endereços absolutos citados nos códigos (atributos e JavaScript), sem repetir. */
export function codeUrls(...codes: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const code of codes) {
    if (typeof code !== "string") continue;
    for (const m of readableCode(code).replace(/\\\//g, "/").matchAll(URL_IN_CODE)) out.add(m[0]);
  }
  return [...out];
}

/**
 * Hosts dos <script src> de fora que as regras próprias não reconhecem (nem
 * rastreador conhecido, nem chat/player/CDN): o painel sugere "Marketing" se
 * eles rastreiam os visitantes. `known` (servidor): outra base que reconhece.
 */
export function unknownScriptHosts(
  codes: (string | null | undefined)[],
  known: (url: string) => boolean = () => false,
): string[] {
  const out = new Set<string>();
  for (const code of codes) {
    if (typeof code !== "string") continue;
    for (const m of readableCode(code).matchAll(SCRIPT_SRC)) {
      const src = (m[1] ?? m[2] ?? m[3] ?? "").trim().replace(/&amp;/gi, "&");
      const url = /^(https?:)?\/\//i.test(src) ? parse(src) : null;
      if (url && ownVerdict(src) === null && !known(url.href)) out.add(url.hostname.toLowerCase());
    }
  }
  return [...out];
}

/**
 * Rastreadores (nome amigável: "Meta Pixel", "Google Tag Manager"…) achados
 * nos códigos, sem repetir, na ordem em que aparecem. [] = nenhum.
 */
export function detectCodeTrackers(...codes: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  /** Achados só por uma chamada (ex.: dataLayer.push), sem endereço nem trecho próprio. */
  const byCallOnly = new Set<string>();
  for (const code of codes) {
    if (typeof code !== "string" || !code.trim()) continue;
    const text = readableCode(code).replace(/\\\//g, "/");
    for (const m of text.matchAll(URL_IN_CODE)) {
      const vendor = ownVerdict(m[0]);
      if (vendor && vendor !== "known") {
        found.add(vendor);
        byCallOnly.delete(vendor);
      }
    }
    for (const t of CONSENT_TRACKERS) if (t.inline?.some((re) => re.test(text))) found.add(t.vendor);
    for (const sig of TRACKER_SIGNATURES) {
      if (!TRACKING_CATEGORIES.has(sig.category)) continue;
      if (sig.inline?.some((re) => re.test(text))) {
        found.add(sig.vendor);
        byCallOnly.delete(sig.vendor);
      } else if (!found.has(sig.vendor) && sig.calls?.some((re) => re.test(text))) {
        found.add(sig.vendor);
        byCallOnly.add(sig.vendor);
      }
    }
  }
  // O gtag("config") genérico já está no nome do produto (Google Analytics / Google Ads),
  // e o dataLayer.push do código-base do gtag não é um Google Tag Manager.
  const gtag = [GTAG_FAMILY.analytics, GTAG_FAMILY.ads, GTAG_FAMILY.tag].some((v) => found.has(v));
  if (found.has(GTAG_FAMILY.analytics) || found.has(GTAG_FAMILY.ads)) found.delete(GTAG_FAMILY.tag);
  if (gtag && byCallOnly.has(GTM)) found.delete(GTM);
  return [...found];
}

export interface CodeParts {
  head?: string | null;
  bodyStart?: string | null;
  bodyEnd?: string | null;
}

export interface ResolvedCodeCategory {
  category: CodeCategoryId;
  /** Rastreadores achados no código. */
  trackers: string[];
  /** A categoria veio da detecção (a pessoa nunca escolheu). */
  auto: boolean;
}

/**
 * Categoria que vale para um código livre: a escolhida ou, sem escolha,
 * "Marketing" quando o código tem pixel/tag de rastreamento e "Essencial" quando não tem.
 * `detect`: no servidor, detectAllCodeTrackers (./code-trackers-server.ts).
 */
export function resolveCodeCategory(
  code: CodeParts | null | undefined,
  explicit: CodeCategoryId | null | undefined,
  detect: (...codes: (string | null | undefined)[]) => string[] = detectCodeTrackers,
): ResolvedCodeCategory {
  const trackers = code ? detect(code.head, code.bodyStart, code.bodyEnd) : [];
  if (explicit) return { category: explicit, trackers, auto: false };
  return { category: trackers.length ? "MARKETING" : PAGE_CODE_DEFAULT_CATEGORY, trackers, auto: true };
}

/** "Meta Pixel", "Meta Pixel e Hotjar", "A, B e C". */
export function joinTrackerNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/** Aviso para código "Essencial" com rastreador (painel e editor). */
export function necessaryTrackerWarning(trackers: readonly string[], acceptLabel = "Aceitar"): string {
  return `Este código tem ${joinTrackerNames(trackers)} e carrega antes do “${acceptLabel}” do aviso de cookies — quem recusa continua sendo rastreado.`;
}

/** Dica para código "Automático" sem rastreador conhecido que carrega script de fora (painel e editor). */
export function unknownScriptHint(hosts: readonly string[], acceptLabel = "Aceitar"): string {
  const list = joinTrackerNames(hosts.slice(0, 3)) + (hosts.length > 3 ? "…" : "");
  return `Este código carrega ${hosts.length > 1 ? "scripts" : "um script"} de fora que o Offer Studio não reconhece (${list}). Se ${hosts.length > 1 ? "eles rastreiam" : "ele rastreia"} os visitantes (análise, anúncios, mapa de calor), escolha “Marketing” para esperar o “${acceptLabel}”.`;
}

/**
 * Rastreadores em HTML de página (aba "HTML do elemento" do editor): só nos
 * <script>, <noscript>, <img> e <iframe> — um link comum para o Facebook não conta.
 */
export function detectHtmlTrackers(html: string): string[] {
  const parts = html.match(
    /<script\b[\s\S]*?(?:<\/script\s*>|$)|<noscript\b[\s\S]*?(?:<\/noscript\s*>|$)|<(?:img|iframe)\b[^>]*>/gi,
  );
  return parts ? detectCodeTrackers(...parts) : [];
}

/**
 * Rastreador mantido na revisão da clonagem que precisa esperar o "Aceitar":
 * pixels, análise, tag managers, anúncios — e o que só o consentimento trata
 * como rastreamento (carregador do RD Station, código do HubSpot). Ao salvar,
 * ele vai para os códigos da página (src/server/services/clone.ts); chats e o
 * resto voltam ao HTML.
 */
export function keptNeedsConsent(item: { category: string; snippet?: string | null }): boolean {
  return TRACKING_CATEGORIES.has(item.category) || detectCodeTrackers(item.snippet).length > 0;
}
