/**
 * Coloca o rastreamento no HTML final (prévia e ZIP):
 *
 * - injectTracking: a configuração pública (JSON) e o script de rastreamento o
 *   mais cedo possível no <head> — logo depois das metas de charset/viewport —
 *   para o consentimento (e o Consent Mode do Google) valer antes de qualquer
 *   código da página;
 * - gateCode: código livre de "Estatística"/"Marketing" fica inerte, em JSON
 *   dentro de um <script type="application/json">, até o visitante aceitar; o
 *   script das páginas liga depois (ver CONSENT_GATE_ATTR em ./runtime-config).
 *
 * Funções puras, sem DOM (rodam no servidor).
 */

import { splitVerificationMetas } from "./domain-verification";
import {
  CONSENT_BLOCK_ATTR,
  CONSENT_GATE_ATTR,
  TRACKING_CONFIG_ID,
  TRACKING_SCRIPT_ATTR,
  type TrackingRuntimeConfig,
} from "./runtime-config";
import type { CodeCategoryId } from "./schema";

// ─── JSON embutido ───────────────────────────────────────────────────────────

/**
 * JSON seguro dentro de <script>: sem "<" (nem "</script>" nem "<!--" podem
 * fechar/abrir nada), sem "&" e ">" (por garantia) e sem U+2028/U+2029.
 */
function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** A configuração em JSON seguro dentro de <script>. */
export function serializeTrackingConfig(config: TrackingRuntimeConfig): string {
  return scriptSafeJson(config);
}

/** Tag com a configuração (lida pelo script: document.getElementById("os-tracking")). */
export function trackingConfigTag(config: TrackingRuntimeConfig): string {
  return `<script type="application/json" id="${TRACKING_CONFIG_ID}">${serializeTrackingConfig(config)}</script>`;
}

/** Atributos de uma tag de abertura (">" dentro de aspas não fecha a tag). */
const ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`;
const OLD_CONFIG_RE = new RegExp(
  `<script\\b${ATTRS}?\\sid\\s*=\\s*(?:"${TRACKING_CONFIG_ID}"|'${TRACKING_CONFIG_ID}'|${TRACKING_CONFIG_ID}(?=[\\s>/]))${ATTRS}>[\\s\\S]*?</script\\s*>\\s*`,
  "gi",
);
const OLD_SCRIPT_RE = new RegExp(
  `<script\\b${ATTRS}?\\s${TRACKING_SCRIPT_ATTR}(?=[\\s=>/])${ATTRS}>[\\s\\S]*?</script\\s*>\\s*`,
  "gi",
);

/**
 * Tira configuração/script de rastreamento que já estejam no HTML (ex.: página
 * clonada de uma oferta exportada pelo próprio Offer Studio): valem os desta oferta.
 */
export function stripTracking(html: string): string {
  return html.replace(OLD_CONFIG_RE, "").replace(OLD_SCRIPT_RE, "");
}

const HEAD_OPEN_RE = /<head\b(?:[^>"']|"[^"]*"|'[^']*')*>/i;
const HTML_OPEN_RE = /<html\b(?:[^>"']|"[^"]*"|'[^']*')*>/i;
const DOCTYPE_RE = /^\s*(?:<!--[\s\S]*?-->\s*)*<!doctype[^>]*>/i;
/** Metas e comentários no início do <head> (antes de qualquer script/estilo). */
const LEADING_RE = /^(?:\s+|<!--[\s\S]*?-->|<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>)/i;

/**
 * Onde entra o rastreamento: logo depois das metas de charset/viewport do
 * início do <head>. `hasCharset` diz se o charset já vem antes desse ponto.
 */
function insertionPoint(html: string): { at: number; wrapHead: boolean; hasCharset: boolean } {
  const head = HEAD_OPEN_RE.exec(html);
  if (head) {
    let at = head.index + head[0].length;
    let cursor = at;
    let hasCharset = false;
    for (let guard = 0; guard < 200; guard++) {
      const m = LEADING_RE.exec(html.slice(cursor));
      if (!m) break;
      cursor += m[0].length;
      if (!/^<meta\b/i.test(m[0])) continue;
      const charset = /\bcharset\b/i.test(m[0]);
      if (charset || /\bname\s*=\s*["']?viewport\b/i.test(m[0])) at = cursor;
      if (charset) hasCharset = true;
    }
    return { at, wrapHead: false, hasCharset };
  }
  // Sem <head>: cria um logo depois do <html> (ou do doctype, ou no começo).
  const htmlOpen = HTML_OPEN_RE.exec(html);
  if (htmlOpen) return { at: htmlOpen.index + htmlOpen[0].length, wrapHead: true, hasCharset: false };
  const doctype = DOCTYPE_RE.exec(html);
  return { at: doctype ? doctype[0].length : 0, wrapHead: true, hasCharset: false };
}

/**
 * Coloca a configuração e a tag do script (`scriptTag`: externo na prévia,
 * embutido no ZIP) no começo do <head>. Substitui um rastreamento anterior.
 *
 * O navegador só procura o charset nos primeiros 1024 bytes: se a página não
 * o declara antes do ponto de entrada, entra um <meta charset="utf-8"> na
 * frente (o HTML sai sempre em UTF-8), para os acentos não quebrarem em
 * hospedagens que não mandam o charset no cabeçalho.
 */
export function injectTracking(html: string, config: TrackingRuntimeConfig, scriptTag: string): string {
  const out = stripTracking(html);
  const { at, wrapHead, hasCharset } = insertionPoint(out);
  const block = `${hasCharset ? "" : '<meta charset="utf-8">'}${trackingConfigTag(config)}${scriptTag}`;
  const insert = wrapHead ? `<head>${block}</head>` : block;
  return `${out.slice(0, at)}${insert}${out.slice(at)}`;
}

// ─── Código que espera o consentimento ───────────────────────────────────────

/**
 * Código livre com categoria de consentimento:
 * - NECESSARY: volta igual (roda sempre, como na Fase 3);
 * - ANALYTICS/MARKETING: o código inteiro vai em JSON num
 *   <script type="application/json" data-os-consent="…" data-os-block> — texto
 *   que o navegador nunca interpreta como HTML: nada roda nem carrega (scripts,
 *   pixels <img>, <picture>, poster, iframes, <link rel=preload> e stylesheet,
 *   srcdoc, on*…), e o JSON não tem "<" que feche o bloco antes da hora. O
 *   script das páginas ativa depois do "Aceitar" (src/runtime/tracking/consent.ts).
 *   Não é <template>: o pré-carregamento do Firefox busca <img>, <picture>,
 *   poster e <image> do SVG de dentro de um <template> do HTML antes de
 *   qualquer escolha (e de novo depois do "Recusar") — e o do Chromium se perde
 *   com <![CDATA[ … </template> … ]]> dentro de um <svg>. Nenhum
 *   pré-carregamento lê o conteúdo de um <script>.
 *
 * Metas de verificação de domínio (Meta, Google, Pinterest, Bing…) do código
 * ficam FORA do bloco, no lugar dele (no <head>, quando é o código do <head>):
 * quem verifica o domínio não roda JavaScript nem clica em "Aceitar". Elas não
 * guardam nada no aparelho do visitante. Ver ./domain-verification.
 * Ver CONSENT_GATE_ATTR em ./runtime-config.
 */
export function gateCode(code: string, category: CodeCategoryId): string {
  if (category === "NECESSARY" || !code) return code;
  const gate = category === "ANALYTICS" ? "analytics" : "marketing";
  const { metas, rest } = splitVerificationMetas(code);
  const block = rest.trim()
    ? `<script type="application/json" ${CONSENT_GATE_ATTR}="${gate}" ${CONSENT_BLOCK_ATTR}>${scriptSafeJson(rest)}</script>`
    : "";
  return metas.join("") + block;
}
