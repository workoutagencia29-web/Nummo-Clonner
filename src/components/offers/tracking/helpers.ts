/**
 * Regras puras da tela "Pixels e rastreamento" (sem React): textos das regras,
 * seletor dos links da oferta, valor em reais, parâmetros de UTM e nomes de
 * evento. Testadas em tests/unit/tracking-ui-helpers.test.ts.
 */
import {
  type CodeCategoryId,
  DEFAULT_FORWARD_PARAMS,
  type EventTriggerId,
  FORWARD_PARAM_RE,
  type PixelVendorId,
  RULE_EVENTS,
  type RuleEventId,
  TRACKING_EVENT_LABEL,
  type TrackingEventId,
} from "@/lib/tracking/schema";

// ─── Tipos dos dados que a tela recebe (espelham src/server/services/tracking.ts) ───

export interface PanelLink {
  id: string;
  key: string;
  label: string;
  kind: string;
  url: string;
}

export interface PanelPage {
  id: string;
  name: string;
  type: string;
  isHome?: boolean;
  slug?: string;
  /** A página tem o link "Preferências de cookies" (sem ele, ganha o botão flutuante "Cookies"). */
  hasConsentLink?: boolean;
}

export interface RuleLike {
  pageId: string | null;
  pageName?: string | null;
  event: TrackingEventId;
  trigger: EventTriggerId;
  value: number | null;
  selector: string | null;
}

// ─── Eventos ────────────────────────────────────────────────────────────────

/** "Iniciou checkout (InitiateCheckout)" → { title: "Iniciou checkout", code: "InitiateCheckout" }. */
export function eventParts(event: TrackingEventId): { title: string; code: string } {
  const label = TRACKING_EVENT_LABEL[event];
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(label);
  return m ? { title: m[1], code: m[2] } : { title: label, code: event };
}

export function isRuleEvent(event: string): event is RuleEventId {
  return (RULE_EVENTS as readonly string[]).includes(event);
}

// ─── Links da oferta como alvo de clique ────────────────────────────────────

/** Seletor que o painel grava para "clique no link da oferta". */
export function selectorForLink(key: string): string {
  return `[data-os-link="${key.replace(/["\\]/g, "\\$&")}"]`;
}

const LINK_SELECTOR_RE = /^\[data-os-link=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([A-Za-z0-9_-]+))\]$/;

/** Chave do link da oferta, se o seletor for exatamente o de um link (senão null). */
export function linkKeyFromSelector(selector: string | null | undefined): string | null {
  const m = LINK_SELECTOR_RE.exec((selector ?? "").trim());
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? "").replace(/\\(.)/g, "$1") || null;
}

/** O gatilho precisa de número (segundos / %)? */
export function triggerValueKind(trigger: EventTriggerId): "seconds" | "percent" | null {
  if (trigger === "TIME_ON_PAGE") return "seconds";
  if (trigger === "SCROLL_DEPTH") return "percent";
  return null;
}

/** Frase curta de quando a regra dispara ("Depois de 15 s na página", "Ao clicar em “Checkout”"). */
export function ruleTriggerText(rule: Pick<RuleLike, "trigger" | "value" | "selector">, links: PanelLink[]): string {
  switch (rule.trigger) {
    case "PAGE_LOAD":
      return "Ao abrir a página";
    case "TIME_ON_PAGE":
      return rule.value === 1 ? "Depois de 1 segundo na página" : `Depois de ${rule.value ?? "?"} segundos na página`;
    case "SCROLL_DEPTH":
      return `Ao rolar ${rule.value ?? "?"}% da página`;
    case "CHECKOUT_CLICK":
      return "Ao clicar em um botão de checkout";
    case "FORM_SUBMIT":
      return "Ao enviar um formulário";
    case "ELEMENT_CLICK": {
      const key = linkKeyFromSelector(rule.selector);
      if (key) {
        const link = links.find((l) => l.key === key);
        return link ? `Ao clicar no link “${link.label}”` : "Ao clicar em um link da oferta que foi excluído";
      }
      return `Ao clicar em ${rule.selector ?? "um elemento"}`;
    }
  }
}

/** A regra aponta para um link da oferta que não existe mais? */
export function ruleHasMissingLink(rule: Pick<RuleLike, "trigger" | "selector">, links: PanelLink[]): boolean {
  if (rule.trigger !== "ELEMENT_CLICK") return false;
  const key = linkKeyFromSelector(rule.selector);
  return key !== null && !links.some((l) => l.key === key);
}

export function ruleScopeText(rule: Pick<RuleLike, "pageId" | "pageName">, pages: PanelPage[]): string {
  if (!rule.pageId) return "Todas as páginas";
  return rule.pageName ?? pages.find((p) => p.id === rule.pageId)?.name ?? "Página excluída";
}

/**
 * Gatilho sugerido ao escolher o evento numa regra nova: checkout no clique do
 * checkout, lead no envio de formulário, contato no link do WhatsApp…
 */
export function suggestedTrigger(
  event: RuleEventId,
  links: PanelLink[],
): { trigger: EventTriggerId; value: number | null; selector: string | null } {
  switch (event) {
    case "VIEW_CONTENT":
      return { trigger: "TIME_ON_PAGE", value: 15, selector: null };
    case "INITIATE_CHECKOUT":
    case "ADD_TO_CART":
      return { trigger: "CHECKOUT_CLICK", value: null, selector: null };
    case "LEAD":
    case "COMPLETE_REGISTRATION":
      return { trigger: "FORM_SUBMIT", value: null, selector: null };
    case "CONTACT": {
      const whatsapp = links.find((l) => l.kind === "WHATSAPP");
      return whatsapp
        ? { trigger: "ELEMENT_CLICK", value: null, selector: selectorForLink(whatsapp.key) }
        : { trigger: "ELEMENT_CLICK", value: null, selector: null };
    }
    case "PURCHASE":
      return { trigger: "PAGE_LOAD", value: null, selector: null };
  }
}

/**
 * Problemas óbvios de um seletor CSS, sem navegador (o servidor confere de
 * novo com o css-tree). null = parece bom.
 */
export function selectorProblem(selector: string): string | null {
  const text = selector.trim();
  if (!text) return "Escolha o elemento ou link.";
  if (text.length > 300) return "O seletor pode ter no máximo 300 caracteres.";
  if (text.includes("<")) return "Isso parece um trecho de HTML. Use um seletor CSS, como #botao-comprar ou .cta.";
  if (/^[>+~,]|[>+~,]\s*$|,\s*,/.test(text)) return "O seletor está incompleto. Confira o começo e o fim.";
  return null;
}

/** Páginas para a política de privacidade: as do tipo "Política / Termos" primeiro. */
export function policyPageOptions<P extends PanelPage>(pages: P[]): P[] {
  return [...pages.filter((p) => p.type === "LEGAL"), ...pages.filter((p) => p.type !== "LEGAL")];
}

// ─── Valor (moeda) ──────────────────────────────────────────────────────────

/**
 * Lê um valor digitado do jeito brasileiro ("97", "97,90", "1.997,00", "R$ 47")
 * ou americano ("97.90"). "" = sem valor (null); texto inválido = NaN.
 */
export function parseAmount(raw: string): number | null {
  let text = raw.replace(/\s|R\$|US\$|€|\$/g, "");
  if (!text) return null;
  if (!/^[\d.,]+$/.test(text)) return Number.NaN;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // O separador que vem por último é o decimal.
    text = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // "97,90" (decimal) × "1,000,000" (milhar americano).
    const parts = text.split(",");
    text = parts.length === 2 ? `${parts[0]}.${parts[1]}` : parts.join("");
  } else if (lastDot >= 0) {
    const parts = text.split(".");
    // "1.997" (milhar) × "97.9" / "97.90" (decimal).
    const thousands = parts.length > 2 || parts[parts.length - 1].length === 3;
    text = thousands ? parts.join("") : text;
  }
  const value = Number(text);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : Number.NaN;
}

/** 1997.5 → "1.997,50" (para o campo). */
export function formatAmount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Parâmetros repassados ──────────────────────────────────────────────────

export const MAX_FORWARD_PARAMS = 40;

/** Problema de um parâmetro novo (null = pode adicionar). */
export function forwardParamProblem(name: string, current: readonly string[]): string | null {
  const param = name.trim();
  if (!param) return "Digite o nome do parâmetro, como utm_source.";
  if (param.length > 40) return "O nome do parâmetro pode ter no máximo 40 caracteres.";
  if (!FORWARD_PARAM_RE.test(param)) return "Use só letras sem acento, números, _ . e - (sem espaços).";
  if (current.includes(param)) return `“${param}” já está na lista.`;
  if (current.length >= MAX_FORWARD_PARAMS) return `Use no máximo ${MAX_FORWARD_PARAMS} parâmetros.`;
  return null;
}

/** A lista é exatamente a padrão (mesma ordem)? */
export function isDefaultParams(params: readonly string[]): boolean {
  return params.length === DEFAULT_FORWARD_PARAMS.length && params.every((p, i) => p === DEFAULT_FORWARD_PARAMS[i]);
}

/** Grupo de cada parâmetro (só para colorir e explicar os chips). */
export function paramGroup(param: string): "utm" | "click" | "platform" | "other" {
  if (/^utm_/i.test(param)) return "utm";
  if (["fbclid", "gclid", "gbraid", "wbraid", "ttclid", "kwai_click_id", "msclkid"].includes(param)) return "click";
  if (["src", "sck", "xcod"].includes(param)) return "platform";
  return "other";
}

// ─── Nomes de evento personalizados ─────────────────────────────────────────

/** Plataformas cujo nome de evento pode ser trocado (Google Ads usa rótulos; UTMify só carrega o script). */
export const EVENT_NAME_VENDORS = ["META", "TIKTOK", "KWAI", "GA4"] as const satisfies readonly PixelVendorId[];
export type EventNameVendorId = (typeof EVENT_NAME_VENDORS)[number];

export const EVENT_NAME_RE = /^[A-Za-z0-9_ .:-]{1,60}$/;

export function eventNameProblem(name: string): string | null {
  const text = name.trim();
  if (!text) return null;
  return EVENT_NAME_RE.test(text) ? null : "Use só letras sem acento, números, espaço, _ . : e - (até 60 caracteres).";
}

// ─── Erros por campo ────────────────────────────────────────────────────────

/** Guarda a mensagem no campo certo; sem campo conhecido, cai em `fallback`. */
export function fieldErrors<K extends string>(
  known: readonly K[],
  field: string | undefined,
  message: string,
  fallback: K,
): Partial<Record<K, string>> {
  const key = (known as readonly string[]).includes(field ?? "") ? (field as K) : fallback;
  return { [key]: message } as Partial<Record<K, string>>;
}

// ─── Partes da tela ─────────────────────────────────────────────────────────

export const TRACKING_SECTIONS = ["pixels", "eventos", "privacidade", "utms", "codigo"] as const;
export type TrackingSectionId = (typeof TRACKING_SECTIONS)[number];

/** Parte pedida no endereço (?secao=eventos); qualquer outro valor abre "Pixels". */
export function trackingSectionOf(value: string | string[] | undefined): TrackingSectionId {
  const v = Array.isArray(value) ? value[0] : value;
  return TRACKING_SECTIONS.find((s) => s === v) ?? "pixels";
}

/** Endereço da tela "Testar pixels" da oferta. */
export function testPixelsHref(offerId: string) {
  return `/ofertas/${offerId}/testar-pixels`;
}

// ─── Código livre ───────────────────────────────────────────────────────────

/** Explicação de cada categoria do código livre (oferta e páginas). */
export const CATEGORY_HELP: Record<CodeCategoryId, string> = {
  NECESSARY:
    "Carrega sempre, sem esperar o aviso de cookies. Use só para o que não rastreia pessoas (chat de suporte, fontes…).",
  ANALYTICS: "Só carrega depois do “Aceitar” no aviso de cookies (ferramentas de estatística, mapas de calor).",
  MARKETING: "Só carrega depois do “Aceitar” no aviso de cookies (pixels e tags de anúncios colados à mão).",
};
