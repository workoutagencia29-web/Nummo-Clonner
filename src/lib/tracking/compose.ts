/**
 * Parte pura da configuração pública de rastreamento (TrackingRuntimeConfig):
 * dados da oferta já carregados → JSON lido pelo script das páginas. Sem banco
 * (a leitura fica em ./config). Nunca inclui tokens de API nem opções internas.
 */
import { CHECKOUT_PLATFORMS } from "@/detection/checkouts";
import {
  type RuntimePixel,
  type RuntimeRule,
  type RuntimeVariant,
  TRACKING_CONFIG_VERSION,
  type TrackingMode,
  type TrackingRuntimeConfig,
  VERSION_SRC_PLATFORMS,
} from "./runtime-config";
import {
  consentTextFor,
  type EventTriggerId,
  PIXEL_VENDORS,
  type PixelVendorId,
  parseVendorOptions,
  serverApiEnabled,
  TRACKING_EVENTS,
  type TrackingEventId,
  type TrackingSettings,
} from "./schema";
import { vendorEventName } from "./vendors";

/** Tipos de link da oferta que contam como checkout (clique = InitiateCheckout). */
export const CHECKOUT_LINK_KINDS = ["CHECKOUT", "UPSELL", "DOWNSELL"] as const;

export interface TrackingSourcePixel {
  vendor: PixelVendorId;
  pixelId: string;
  enabled: boolean;
  options: unknown;
}

export interface TrackingSourceRule {
  pageId: string | null;
  event: TrackingEventId;
  trigger: EventTriggerId;
  value: number | null;
  selector: string | null;
  enabled: boolean;
}

export interface TrackingSourceLink {
  key: string;
  kind: string;
  url: string;
}

export interface TrackingSource {
  mode: TrackingMode;
  settings: TrackingSettings;
  pixels: TrackingSourcePixel[];
  rules: TrackingSourceRule[];
  links: TrackingSourceLink[];
  /** Página mostrada (null = documento solto: só as regras da oferta inteira). */
  pageId: string | null;
  /** Endereço da política de privacidade, já resolvido (ou null). */
  policyUrl: string | null;
  test?: TrackingRuntimeConfig["test"];
  /** Envio pelo servidor (eventos.php): endereço no ZIP. Só no modo live. */
  serverEndpoint?: string | null;
  /** Versão A/B mostrada (página com mais de uma versão). */
  variant?: TrackingVariant | null;
}

/** Versão A/B de uma página: letra ("B") e pasta no ZIP, relativa à da página ("oferta-b/"). */
export interface TrackingVariant {
  name: string;
  folder: string;
}

/** Só as opções que o navegador precisa, por plataforma. */
export function publicPixelOptions(vendor: PixelVendorId, options: unknown): Record<string, unknown> {
  switch (vendor) {
    case "GOOGLE_ADS": {
      const parsed = parseVendorOptions("GOOGLE_ADS", options);
      const labels = Object.fromEntries(Object.entries(parsed.conversionLabels).filter(([, label]) => !!label));
      return { conversionLabels: labels };
    }
    case "UTMIFY": {
      const parsed = parseVendorOptions("UTMIFY", options);
      return {
        utmsScript: parsed.utmsScript,
        preventSubids: parsed.preventSubids,
        preventXcodSck: parsed.preventXcodSck,
      };
    }
    default:
      // META/TIKTOK: capi/eventsApi viram `server.vendors`; token e código de teste nunca saem do servidor.
      return {};
  }
}

/** Host comparável: minúsculas e sem "www.". */
function bareHost(host: string) {
  return host.toLowerCase().replace(/^www\./, "");
}

let knownHosts: string[] | null = null;
let srcHosts: string[] | null = null;

/** Limite de caminhos gerados por regra (expressões com muitas alternativas ficam de fora). */
const MAX_PREFIXES = 12;

/**
 * Caminhos literais de uma expressão ancorada simples do tipo
 * /^\/(?:checkout|r)\//i → ["/checkout/", "/r/"]. Aceita letras, números,
 * "-", "_", barras e pontos escapados e grupos (?:a|b) (também aninhados).
 * Qualquer outra coisa (quantificadores, classes, \b…) = null: a regra fica de fora.
 */
export function literalPathPrefixes(re: RegExp): string[] | null {
  const src = re.source;
  if (!src.startsWith("^")) return null;
  let i = 1;
  const seq = (): string[] | null => {
    let out = [""];
    while (i < src.length && src[i] !== "|" && src[i] !== ")") {
      let part: string[] | null;
      const c = src[i];
      if (c === "\\") {
        const next = src[i + 1];
        if (!next || !/[/.\-_]/.test(next)) return null;
        part = [next];
        i += 2;
      } else if (src.startsWith("(?:", i)) {
        i += 3;
        part = [];
        for (;;) {
          const alt = seq();
          if (!alt) return null;
          part.push(...alt);
          if (src[i] === "|") i++;
          else if (src[i] === ")") {
            i++;
            break;
          } else return null;
        }
      } else if (/[a-z0-9_-]/i.test(c)) {
        part = [c];
        i++;
      } else return null;
      out = out.flatMap((a) => (part as string[]).map((b) => a + b));
      if (out.length > MAX_PREFIXES) return null;
    }
    return out;
  };
  const all = seq();
  if (!all || i !== src.length || all.some((p) => !p.startsWith("/") || p.length < 2)) return null;
  return re.flags.includes("i") ? all.map((p) => p.toLowerCase()) : all;
}

/**
 * Domínios das plataformas de checkout conhecidas (src/detection/checkouts.ts):
 * "pay.hotmart.com", ".checkout-ds24.com" (qualquer subdomínio) e, para as
 * plataformas que dependem do caminho, o domínio com o começo do caminho
 * ("app.monetizze.com.br/checkout/", ".mycartpanda.com/checkout"). Regras com
 * parâmetros ou expressões regulares mais soltas ficam de fora (evita contar o
 * site institucional como checkout).
 */
export function knownCheckoutHosts(): string[] {
  knownHosts ??= platformHosts(CHECKOUT_PLATFORMS);
  return knownHosts;
}

/**
 * Domínios dos checkouts que recebem a marca da versão A/B em `src` (Hotmart,
 * Kiwify, Eduzz — VERSION_SRC_PLATFORMS), no formato de knownCheckoutHosts.
 */
export function versionSrcHosts(): string[] {
  srcHosts ??= platformHosts(
    CHECKOUT_PLATFORMS.filter((p) => (VERSION_SRC_PLATFORMS as readonly string[]).includes(p.name)),
  );
  return srcHosts;
}

function platformHosts(platforms: typeof CHECKOUT_PLATFORMS): string[] {
  const hosts = new Set<string>();
  for (const platform of platforms) {
    for (const rule of platform.rules) {
      if (typeof rule.host !== "string" || rule.query) continue;
      const host = rule.host.startsWith("*.") ? `.${bareHost(rule.host.slice(2))}` : bareHost(rule.host);
      if (!rule.path) {
        hosts.add(host);
        continue;
      }
      for (const prefix of literalPathPrefixes(rule.path) ?? []) hosts.add(`${host}${prefix}`);
    }
  }
  return [...hosts].sort();
}

/** Letra da versão como vai nos eventos: até 20 letras, números, "_" ou "-" (senão, fica de fora). */
const VARIANT_NAME_RE = /^[A-Za-z0-9_-]{1,20}$/;

/** Versão A/B pública da página (null = sem versão ou com nome fora do formato). */
export function runtimeVariant(variant: TrackingVariant | null | undefined): RuntimeVariant | null {
  const name = variant?.name.trim() ?? "";
  if (!variant || !VARIANT_NAME_RE.test(name)) return null;
  return { name, folder: variant.folder, srcHosts: versionSrcHosts() };
}

/** Hosts dos links de checkout da oferta (ex.: checkout em domínio próprio). */
function linkHosts(links: TrackingSourceLink[]): string[] {
  const out: string[] = [];
  for (const link of links) {
    if (!(CHECKOUT_LINK_KINDS as readonly string[]).includes(link.kind) || !link.url) continue;
    try {
      const url = new URL(link.url);
      if (url.protocol === "http:" || url.protocol === "https:") out.push(bareHost(url.hostname));
    } catch {
      // link ainda sem URL válida: fica de fora
    }
  }
  return out;
}

function ruleKey(r: RuntimeRule) {
  return `${r.event}|${r.trigger}|${r.value ?? ""}|${r.selector ?? ""}`;
}

/** Parte pura: dados da oferta → configuração pública da página. */
export function composeTrackingConfig(src: TrackingSource): TrackingRuntimeConfig {
  const { settings } = src;
  const enabled = src.pixels.filter((p) => p.enabled);
  const seenPixels = new Set<string>();
  const pixels: RuntimePixel[] = [];
  for (const p of enabled) {
    const key = `${p.vendor}|${p.pixelId}`;
    if (seenPixels.has(key)) continue;
    seenPixels.add(key);
    pixels.push({ vendor: p.vendor, id: p.pixelId, options: publicPixelOptions(p.vendor, p.options) });
  }

  const vendors = PIXEL_VENDORS.filter((v) => pixels.some((p) => p.vendor === v));
  const names: TrackingRuntimeConfig["names"] = {};
  for (const vendor of vendors) {
    const map: Partial<Record<TrackingEventId, string | null>> = {};
    for (const event of TRACKING_EVENTS) map[event] = vendorEventName(vendor, event, settings.eventNames);
    names[vendor] = map;
  }

  const rules: RuntimeRule[] = [];
  const seenRules = new Set<string>();
  for (const r of src.rules) {
    if (!r.enabled || r.event === "PAGE_VIEW") continue;
    if (r.pageId !== null && r.pageId !== src.pageId) continue;
    const rule: RuntimeRule = {
      event: r.event,
      trigger: r.trigger,
      value: r.trigger === "TIME_ON_PAGE" || r.trigger === "SCROLL_DEPTH" ? r.value : null,
      selector: r.trigger === "ELEMENT_CLICK" ? r.selector : null,
    };
    if ((rule.trigger === "TIME_ON_PAGE" || rule.trigger === "SCROLL_DEPTH") && !rule.value) continue;
    if (rule.trigger === "ELEMENT_CLICK" && !rule.selector) continue;
    const key = ruleKey(rule);
    if (seenRules.has(key)) continue;
    seenRules.add(key);
    rules.push(rule);
  }

  const checkoutLinkKeys = [
    ...new Set(src.links.filter((l) => (CHECKOUT_LINK_KINDS as readonly string[]).includes(l.kind)).map((l) => l.key)),
  ];
  const checkoutHosts = [...new Set([...knownCheckoutHosts(), ...linkHosts(src.links)])];

  const serverVendors =
    src.mode === "live" && src.serverEndpoint
      ? vendors.filter((v) => enabled.some((p) => p.vendor === v && serverApiEnabled(v, p.options)))
      : [];

  const { mode, text, acceptLabel, rejectLabel, noticeLabel, policyLabel, position, theme } = settings.consent;
  return {
    v: TRACKING_CONFIG_VERSION,
    mode: src.mode,
    consent: {
      mode,
      text: consentTextFor(mode, text),
      acceptLabel,
      rejectLabel,
      noticeLabel,
      policyLabel,
      position,
      theme,
      policyUrl: src.policyUrl,
    },
    pixels,
    rules,
    names,
    forwarding: { ...settings.forwarding, params: [...new Set(settings.forwarding.params)] },
    value: settings.value,
    checkoutLinkKeys,
    checkoutHosts,
    marketingCode: false,
    server:
      serverVendors.length && src.serverEndpoint ? { endpoint: src.serverEndpoint, vendors: serverVendors } : null,
    test: src.mode === "test" ? (src.test ?? null) : null,
    variant: runtimeVariant(src.variant),
  };
}
