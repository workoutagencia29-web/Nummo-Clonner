/**
 * Sugestões de funil: links da página de vendas que parecem levar a upsell,
 * downsell ou página de obrigado (mesmo domínio, outro caminho).
 *
 * Função pura sobre o DOM do cheerio (sem rede, sem banco).
 */
import type { CheerioAPI } from "cheerio";
import { getDomain } from "tldts";
import { nameKey } from "@/lib/text";
import { documentBase } from "./html-assets";
import { isSyntheticOrigin } from "./synthetic";
import type { FunnelSuggestion } from "./types";

export const FUNNEL_MAX = 15;

type Kind = FunnelSuggestion["kind"];

/** Parâmetros de rastreamento removidos ao comparar URLs. */
const TRACKING_PARAMS = /^(?:utm_\w+|fbclid|gclid|gbraid|wbraid|ttclid|msclkid|_ga|_gl)$/i;

const ASSET_EXT =
  /\.(?:jpe?g|png|gif|webp|avif|svg|ico|bmp|pdf|zip|rar|7z|mp4|webm|mov|m4v|mp3|wav|ogg|m3u8|css|js|mjs|json|xml|txt|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?|epub|csv)$/i;

/** Páginas institucionais/legais que não fazem parte do funil. */
const EXCLUDED_PATH =
  /privac|politica|policy|termos|terms|contato|contact|login|log-in|signin|sign-in|(?:^|[/_.-])(?:blog|entrar|minha-conta|my-account|conta|account|cookies?|lgpd|reembolso|refund|disclaimer|aviso-legal|legal|faq|suporte|support|ajuda|help|sobre|sobre-nos|about|about-us|checkout|carrinho|cart|wp-admin|wp-login\.php|feed)(?=$|[/_.-])/i;
const EXCLUDED_TEXT =
  /politica|privacidade|privacy|termos|terms of|contato|fale conosco|contact us|\bblog\b|\blogin\b|^entrar$|minha conta|area de membros|cookies/i;

// Sinais no endereço (caminho + subdomínio).
const PATH_DOWNSELL = /down-?sell|(?:^|[^a-z])down[-_]?\d+(?![a-z])|(?:^|[^a-z])ds[-_]?\d+(?![a-z])/i;
const PATH_THANK_YOU =
  /obrigad|thank|parabens|confirma|(?:^|[^a-z])obg(?![a-z])|(?:^|[^a-z])ty(?:[-_]?page)?(?![a-z])/i;
const PATH_UPSELL =
  /up-?sell|(?:^|[^a-z])up[-_]?\d+(?![a-z])|(?:^|[^a-z])oto[-_]?\d*(?![a-z])|one[-_]?click|oferta[-_]?especial|oferta[-_]?unica|(?:^|[^a-z])upgrade(?![a-z])/i;
const PATH_OTHER = /(?:^|[^a-z])(?:bonus|vip)(?![a-z])/i;

// Sinais no texto do link (já sem acentos).
const TEXT_DECLINE =
  /\bnao,? obrigad[oa]\b|\bnao,? (?:eu )?quero\b|\bnao,? (?:eu )?(?:prefiro|vou|preciso|aceito)\b|recusar(?: (?:esta|essa|a))? oferta|\brecuso\b|\bdispenso\b|pular (?:esta |essa )?oferta|abrir mao|\bno,? thanks?\b|\bno thank you\b|decline/i;
const TEXT_DOWNSELL = /down-?sell/i;
const TEXT_UPSELL = /up-?sell|\bupgrade\b|oferta (?:especial|unica)|one[- ]?click|\boto\b/i;
const TEXT_THANK_YOU = /obrigad|thank you|parabens|confirma/i;
const TEXT_OTHER = /\bbonus\b|\bvip\b/i;

/** URL sem #hash e sem parâmetros de rastreamento (utm_*, fbclid…). */
export function cleanUrl(raw: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  if (![...url.searchParams.keys()].length) url.search = "";
  return url.href;
}

/** Caminho comparável: sem barra final e sem index.html. */
function pagePath(url: URL): string {
  const path = decodeSafe(url.pathname)
    .replace(/\/index\.(?:html?|php)$/i, "/")
    .replace(/\/+$/, "");
  return path.toLowerCase() || "/";
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function registrableDomain(hostname: string): string {
  return getDomain(hostname, { allowPrivateDomains: true }) ?? hostname.toLowerCase();
}

function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Destino de um onclick simples (location.href = '…', window.open('…')). */
function onclickTarget(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return (
    /location(?:\.href)?\s*=\s*["'`]([^"'`]+)["'`]/.exec(code)?.[1] ??
    /(?:window\.open|location\.(?:assign|replace))\s*\(\s*["'`]([^"'`]+)["'`]/.exec(code)?.[1]
  );
}

interface Classification {
  kind: Kind;
  reason: string;
}

/** Classifica o link; null quando não parece fazer parte do funil. */
function classify(addr: string, label: string): Classification | null {
  const text = nameKey(label);
  const shown = truncate(label.trim() || addr, 40);
  const hit = (re: RegExp) => re.exec(addr)?.[0].replace(/^[^a-z]/i, "");

  const down = hit(PATH_DOWNSELL);
  if (down) return { kind: "DOWNSELL", reason: `Endereço com "${down}" costuma ser um downsell` };
  const thanks = hit(PATH_THANK_YOU);
  if (thanks) return { kind: "THANK_YOU", reason: `Endereço com "${thanks}" costuma ser a página de obrigado` };
  if (TEXT_DECLINE.test(text)) {
    return { kind: "DOWNSELL", reason: `Link "${shown}" costuma levar ao downsell` };
  }
  const up = hit(PATH_UPSELL);
  if (up) return { kind: "UPSELL", reason: `Endereço com "${up}" costuma ser um upsell` };
  if (TEXT_DOWNSELL.test(text)) return { kind: "DOWNSELL", reason: `O texto do link "${shown}" indica um downsell` };
  if (TEXT_UPSELL.test(text)) return { kind: "UPSELL", reason: `O texto do link "${shown}" indica um upsell` };
  if (TEXT_THANK_YOU.test(text)) {
    return { kind: "THANK_YOU", reason: `O texto do link "${shown}" indica a página de obrigado` };
  }
  const other = hit(PATH_OTHER);
  if (other) return { kind: "OTHER", reason: `Endereço com "${other}" parece fazer parte do funil` };
  if (TEXT_OTHER.test(text)) return { kind: "OTHER", reason: `O texto do link "${shown}" parece fazer parte do funil` };
  return null;
}

/**
 * Sugere páginas do funil a partir dos links da página: mesmo domínio
 * registrável, outro caminho, fora checkouts, arquivos e páginas legais.
 * No máximo 15, sem repetir URL (ignorando #hash e utm_*). Links relativos
 * respeitam o <base href> da página. Páginas importadas (ZIP/HTML colado sem
 * link de origem) não têm sugestões: seus links não apontam para um site real.
 */
export function suggestFunnel($: CheerioAPI, pageUrl: string, checkoutUrls: Set<string>): FunnelSuggestion[] {
  // ZIP ou HTML colado sem "Link de origem": os links relativos não têm endereço
  // real (o host interno não existe na internet), então não há o que clonar.
  if (isSyntheticOrigin(pageUrl)) return [];
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return [];
  }
  const base = documentBase($, pageUrl);
  const pageDomain = registrableDomain(page.hostname);
  const pageKey = `${page.hostname.toLowerCase()}${pagePath(page)}`;
  const checkouts = new Set<string>();
  for (const url of checkoutUrls) {
    const clean = cleanUrl(url, pageUrl);
    if (clean) checkouts.add(clean);
  }

  const out: FunnelSuggestion[] = [];
  const byUrl = new Map<string, FunnelSuggestion>();

  for (const el of $("a[href], area[href], [onclick], [data-href]").toArray()) {
    const $el = $(el);
    const raw = el.tagName === "a" || el.tagName === "area" ? $el.attr("href") : undefined;
    const target = raw ?? $el.attr("data-href") ?? onclickTarget($el.attr("onclick"));
    if (!target) continue;
    const trimmed = target.trim();
    if (!trimmed || trimmed.startsWith("#") || /^(?:mailto|tel|sms|whatsapp|javascript|data|blob):/i.test(trimmed)) {
      continue;
    }

    const clean = cleanUrl(trimmed, base);
    if (!clean) continue;
    const url = new URL(clean);
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (isSyntheticOrigin(clean)) continue;
    if (registrableDomain(url.hostname) !== pageDomain) continue;
    const path = pagePath(url);
    if (`${url.hostname.toLowerCase()}${path}` === pageKey) continue;
    if (checkouts.has(clean) || checkoutUrls.has(trimmed)) continue;
    if (ASSET_EXT.test(path)) continue;

    const label = normalizeLabel(
      $el.text() || $el.attr("title") || $el.attr("aria-label") || $el.find("img[alt]").attr("alt") || "",
    );
    if (EXCLUDED_PATH.test(path) || EXCLUDED_TEXT.test(nameKey(label))) continue;

    // Subdomínio também conta (ex.: upsell.meusite.com.br).
    const sub = url.hostname.toLowerCase().slice(0, -pageDomain.length).replace(/\.$/, "");
    const addr = `${sub}${path}`;
    const found = classify(addr, label);
    if (!found) continue;

    const suggestion: FunnelSuggestion = { url: clean, label: label || path, kind: found.kind, reason: found.reason };
    const existing = byUrl.get(clean);
    if (existing) {
      // Uma ocorrência mais específica (ex.: "Não, obrigado") vence um OTHER.
      if (existing.kind === "OTHER" && found.kind !== "OTHER") Object.assign(existing, suggestion);
      continue;
    }
    if (out.length >= FUNNEL_MAX) continue;
    byUrl.set(clean, suggestion);
    out.push(suggestion);
  }
  return out;
}

function normalizeLabel(text: string): string {
  return truncate(text.replace(/\s+/g, " ").trim());
}
