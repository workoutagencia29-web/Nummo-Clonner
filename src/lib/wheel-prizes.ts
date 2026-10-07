/**
 * Roletas no HTML salvo das páginas (servidor): o que cada uma oferece de
 * prêmio, o mapa de prêmios embutido nas páginas (prévia e ZIP) e os avisos de
 * prêmio sem link.
 *
 * Segurança: a página de vendas só aceita um prêmio cuja chave está no mapa que
 * o próprio render embute (chave do link → endereço do link da oferta). Um
 * endereço vindo da URL ou do localStorage nunca é usado: nada de
 * redirecionamento aberto (ver src/runtime/widgets/prize.ts).
 */
import * as cheerio from "cheerio";
import { restoreDoctype } from "@/lib/doctype";
import { scriptString } from "@/lib/export/head";
import { LINK_ATTR } from "@/lib/offer-links";
import {
  LINK_KIND_ATTR,
  offerScope,
  PRIZE_MAP_ID,
  PRIZE_SHOW_ATTR,
  type PrizeMap,
  parseSlices,
  prizeId,
  SCOPE_ATTR,
  WHEEL_DAYS,
  WHEEL_MINUTES,
  type WheelSlice,
  wheelNumber,
} from "@/lib/wheel";

/** Marca de uma roleta no HTML salvo (atalho antes de analisar o HTML). */
export const WHEEL_MARK = 'data-os-widget="wheel"';

export interface WheelInPage {
  slices: WheelSlice[];
  days: number;
  minutes: number;
  banner: boolean;
}

/** Roletas da página, na ordem. */
export function wheelsIn(html: string | null | undefined): WheelInPage[] {
  if (!html?.includes(WHEEL_MARK)) return [];
  const $ = cheerio.load(html);
  return $('[data-os-widget="wheel"]')
    .toArray()
    .map((el) => {
      const node = $(el);
      const banner = (node.attr("data-os-banner") ?? "").trim();
      return {
        slices: parseSlices(node.attr("data-os-slices")),
        days: wheelNumber(node.attr("data-os-days"), WHEEL_DAYS, 1, 365),
        minutes: wheelNumber(node.attr("data-os-minutes"), WHEEL_MINUTES, 0, 240),
        banner: !/^(0|false)$/i.test(banner),
      };
    });
}

/** Chaves de links da oferta usadas como prêmio nas roletas da página. */
export function wheelPrizeKeys(html: string | null | undefined): string[] {
  return wheelsIn(html).flatMap((w) => w.slices.filter((s) => !s.lose && s.link).map((s) => s.link));
}

/** Endereço que pode virar destino de um prêmio (só http/https). */
function safeHref(url: string): string | null {
  try {
    const u = new URL(url.trim());
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/** Link que pode ser prêmio: endereço http(s) ou pagamento na página. */
type PrizeLink = { key: string; url: string; pay?: boolean };

/** Destino do prêmio de cada link: { u: endereço } ou { p: chave do produto de pagamento }. */
function prizeTargets(links: PrizeLink[]): Map<string, { u: string } | { p: string }> {
  const out = new Map<string, { u: string } | { p: string }>();
  for (const l of links) {
    if (l.pay) out.set(l.key, { p: l.key });
    else {
      const u = safeHref(l.url);
      if (u) out.set(l.key, { u });
    }
  }
  return out;
}

/**
 * Mapa de prêmios da oferta (todas as roletas, de todas as páginas):
 * identificador do prêmio (prizeId: link + texto + cupom) → endereço do link
 * (ou o produto, quando o link é "Pagamento na página"), texto, cupom e as
 * opções da roleta. Só entram links da oferta com destino; a mesma fatia em
 * duas roletas vale a primeira.
 */
export function wheelPrizeMap(htmls: (string | null | undefined)[], links: PrizeLink[]): PrizeMap {
  const targets = prizeTargets(links);
  const map: PrizeMap = {};
  for (const html of htmls) {
    for (const wheel of wheelsIn(html)) {
      for (const s of wheel.slices) {
        const target = !s.lose && s.link ? targets.get(s.link) : null;
        const id = prizeId(s);
        if (!target || map[id]) continue;
        map[id] = { ...target, t: s.text, c: s.coupon, d: wheel.days, m: wheel.minutes, b: wheel.banner ? 1 : 0 };
      }
    }
  }
  return map;
}

/** O que o render precisa para levar o prêmio à página de vendas. */
export interface WheelRender {
  prizes: PrizeMap;
  /** Chaves dos links da oferta do tipo checkout (botões trocados pelo link do prêmio). */
  checkoutKeys: string[];
  /** Código da oferta (offerScope): separa a memória da roleta e o prêmio por oferta. */
  scope?: string;
}

/** Dados do render a partir do HTML das páginas e dos links da oferta (com o tipo). */
export function wheelRenderData(
  htmls: (string | null | undefined)[],
  links: { key: string; url: string; kind?: string | null; pay?: boolean }[],
  offerId?: string,
): WheelRender {
  return {
    prizes: wheelPrizeMap(htmls, links),
    checkoutKeys: links.filter((l) => l.kind === "CHECKOUT").map((l) => l.key),
    ...(offerId ? { scope: offerScope(offerId) } : {}),
  };
}

/**
 * CSS da visibilidade condicional (no <head>, vale sem JavaScript): "só para
 * quem ganhou" fica escondido até o script confirmar um prêmio válido
 * (classe os-premio-on no <html>); "só para quem não ganhou" some com ele.
 */
export const PRIZE_SHOW_STYLE = `<style id="os-premio-style">html:not(.os-premio-on) [${PRIZE_SHOW_ATTR}="ganhou"]{display:none!important}html.os-premio-on [${PRIZE_SHOW_ATTR}="nao"]{display:none!important}</style>`;

const beforeHeadEnd = (html: string, tag: string) =>
  /<\/head>/i.test(html) ? html.replace(/<\/head>/i, (m) => `${tag}${m}`) : `${tag}${html}`;

/**
 * Leva a roleta para a página: CSS da visibilidade condicional (se a página
 * usa), o código da oferta em cada roleta (memória separada por oferta), o mapa
 * de prêmios (JSON) e a marca dos botões de checkout (data-os-link-kind="checkout")
 * — os dois últimos só se a oferta tem prêmio com link.
 */
export function applyWheelPrizes(html: string, wheel: WheelRender | null | undefined): string {
  let out = html;
  if (out.includes(`${PRIZE_SHOW_ATTR}=`) && !out.includes('id="os-premio-style"')) {
    out = beforeHeadEnd(out, PRIZE_SHOW_STYLE);
  }
  if (!wheel) return out;
  const scope = wheel.scope ?? "";
  const hasPrizes = Object.keys(wheel.prizes).length > 0;
  const keys = new Set(hasPrizes ? wheel.checkoutKeys : []);
  const markWheels = Boolean(scope) && out.includes(WHEEL_MARK);
  const markLinks = keys.size > 0 && out.includes(LINK_ATTR);
  if (markWheels || markLinks) {
    const $ = cheerio.load(out);
    let changed = 0;
    if (markWheels) {
      $('[data-os-widget="wheel"]').each((_, el) => {
        $(el).attr(SCOPE_ATTR, scope);
        changed++;
      });
    }
    if (markLinks) {
      $(`[${LINK_ATTR}]`).each((_, el) => {
        const node = $(el);
        if (!keys.has(node.attr(LINK_ATTR) ?? "")) return;
        node.attr(LINK_KIND_ATTR, "checkout");
        changed++;
      });
    }
    if (changed) out = restoreDoctype($.html(), out);
  }
  if (!hasPrizes) return out;
  if (!out.includes(`id="${PRIZE_MAP_ID}"`)) {
    const scopeAttr = scope ? ` ${SCOPE_ATTR}="${scope}"` : "";
    out = beforeHeadEnd(
      out,
      `<script type="application/json" id="${PRIZE_MAP_ID}"${scopeAttr}>${scriptString(wheel.prizes)}</script>`,
    );
  }
  return out;
}

/**
 * Prêmios sem link de checkout numa página, sem repetir o texto. `linked`: a
 * fatia já está ligada a um link da oferta que existe, só falta o endereço
 * dele (a aba "Links e checkouts" resolve; o funil em 1 clique cria assim).
 */
export function prizeGaps(html: string | null | undefined, links: PrizeLink[]): { text: string; linked: boolean }[] {
  const ok = new Set(prizeTargets(links).keys());
  const known = new Set(links.map((l) => l.key));
  const out: { text: string; linked: boolean }[] = [];
  for (const wheel of wheelsIn(html)) {
    for (const s of wheel.slices) {
      if (s.lose || (s.link && ok.has(s.link))) continue;
      const linked = Boolean(s.link && known.has(s.link));
      const seen = out.find((g) => g.text === s.text);
      if (!seen) out.push({ text: s.text, linked });
      else seen.linked &&= linked;
    }
  }
  return out;
}

/** Prêmios sem link de checkout numa página ("30% OFF", …), sem repetir. */
export function prizesWithoutLink(html: string | null | undefined, links: PrizeLink[]): string[] {
  return prizeGaps(html, links).map((g) => g.text);
}
