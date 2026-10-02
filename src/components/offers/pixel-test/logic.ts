/**
 * Tela "Testar pixels": regras puras (sem React) usadas pela tela e testadas à
 * parte — lista de conferência de cada plataforma, situação do consentimento,
 * dicas de solução em português, contagem regressiva, textos de cada passo e a
 * sessão guardada na aba (sessionStorage).
 *
 * Os passos chegam do script das páginas (src/runtime/tracking/report.ts):
 * RUNTIME/START, CONSENT/<escolha>, <plataforma>/load e <plataforma>/<evento>.
 */
import { PIXEL_TEST_LOAD_EVENT } from "@/lib/tracking/runtime-config";
import {
  type ConsentModeId,
  type EventTriggerId,
  PIXEL_ID_RULES,
  PIXEL_VENDOR_LABEL,
  PIXEL_VENDORS,
  type PixelVendorId,
  TRACKING_EVENT_LABEL,
  TRACKING_EVENTS,
  type TrackingEventId,
  type TrackingSettings,
} from "@/lib/tracking/schema";
import type { PixelTestEventRow, PixelTestStatusId, PixelTestVendorSummary } from "@/lib/tracking/test-report";
import { VENDOR_EVENT_NAMES, vendorEventName } from "@/lib/tracking/vendors";
import type { TrackingPanel } from "@/server/services/tracking";

// ─── Dados da tela ───────────────────────────────────────────────────────────

export interface TestPixel {
  id: string;
  vendor: PixelVendorId;
  pixelId: string;
  label: string | null;
  /** Google Ads: rótulo de conversão por evento (eventos sem rótulo não viram conversão). */
  conversionLabels: Partial<Record<TrackingEventId, string>>;
  /** UTMify: o script de UTMs também carrega. */
  utmsScript?: boolean;
}

export interface TestRule {
  pageId: string | null;
  event: TrackingEventId;
  trigger: EventTriggerId;
  value: number | null;
  selector: string | null;
}

export interface TestPage {
  id: string;
  name: string;
  isHome: boolean;
  /** Versões A/B da página (com mais de uma, a tela pergunta qual testar). */
  variants?: TestVariant[];
}

export interface TestVariant {
  id: string;
  /** Letra: "A", "B"… */
  name: string;
  /** Nome opcional ("Headline nova"). */
  label: string | null;
  isControl: boolean;
}

export interface TestLink {
  key: string;
  label: string;
}

/** Tudo o que a tela precisa da oferta (sem tokens nem nada secreto). */
export interface PixelTestSetup {
  offerId: string;
  offerName: string;
  pages: TestPage[];
  /** Só os pixels ligados (os desligados não carregam no teste). */
  pixels: TestPixel[];
  /** Quantos pixels estão desligados (aviso na tela). */
  disabledPixels: number;
  /** Só as regras ligadas. */
  rules: TestRule[];
  consentMode: ConsentModeId;
  /** Texto do botão de aceitar (e do "Entendi" do modo "Só avisar") configurado na oferta. */
  acceptLabel: string;
  noticeLabel: string;
  eventNames: TrackingSettings["eventNames"];
  links: TestLink[];
}

/**
 * Monta os dados da tela a partir do painel de rastreamento (servidor).
 * `variants`: versões A/B de cada página (pageId → versões, na ordem do "Teste A/B").
 */
export function buildTestSetup(panel: TrackingPanel, variants: Record<string, TestVariant[]> = {}): PixelTestSetup {
  const enabled = panel.pixels.filter((p) => p.enabled);
  return {
    offerId: panel.offer.id,
    offerName: panel.offer.name,
    pages: panel.pages.map((p) => ({
      id: p.id,
      name: p.name,
      isHome: p.isHome,
      ...(variants[p.id]
        ? { variants: variants[p.id].map((v) => ({ id: v.id, name: v.name, label: v.label, isControl: v.isControl })) }
        : {}),
    })),
    pixels: enabled.map((p) => ({
      id: p.id,
      vendor: p.vendor,
      pixelId: p.pixelId,
      label: p.label,
      conversionLabels: p.vendor === "GOOGLE_ADS" ? { ...p.options.conversionLabels } : {},
      ...(p.vendor === "UTMIFY" ? { utmsScript: p.options.utmsScript } : {}),
    })),
    disabledPixels: panel.pixels.length - enabled.length,
    rules: panel.rules
      .filter((r) => r.enabled)
      .map((r) => ({ pageId: r.pageId, event: r.event, trigger: r.trigger, value: r.value, selector: r.selector })),
    consentMode: panel.settings.consent.mode,
    acceptLabel: panel.settings.consent.acceptLabel,
    noticeLabel: panel.settings.consent.noticeLabel,
    eventNames: panel.settings.eventNames,
    links: panel.links.map((l) => ({ key: l.key, label: l.label })),
  };
}

/** Onde os pixels e as regras da oferta são configurados (aba da tela da oferta). */
export function pixelSettingsHref(offerId: string) {
  return `/ofertas/${offerId}?aba=rastreamento&secao=pixels`;
}

/** Página testada: a escolhida ou, sem escolha, a página inicial. */
export function defaultPageId(pages: TestPage[]): string | null {
  return (pages.find((p) => p.isHome) ?? pages[0])?.id ?? null;
}

/** Versões A/B da página (vazio = página desconhecida ou sem a informação). */
export function pageVariants(pages: TestPage[], pageId: string | null): TestVariant[] {
  return pages.find((p) => p.id === pageId)?.variants ?? [];
}

/** Versão que a tela mostra escolhida: a que a pessoa escolheu (se ainda é desta página) ou a de controle. */
export function chosenVariantId(variants: TestVariant[], picked: string | null | undefined): string | null {
  if (picked && variants.some((v) => v.id === picked)) return picked;
  return (variants.find((v) => v.isControl) ?? variants[0])?.id ?? null;
}

/** Nome da versão na lista: "Versão A (controle)", "Versão B · Headline nova". */
export function variantChoiceLabel(v: Pick<TestVariant, "name" | "label" | "isControl">): string {
  const title = v.label ? `Versão ${v.name} · ${v.label}` : `Versão ${v.name}`;
  return v.isControl ? `${title} (controle)` : title;
}

/**
 * Pedido do "Iniciar teste": a versão só vai quando a página tem mais de uma
 * (com uma só, o teste é o de sempre).
 */
export function pixelTestStartInput(
  offerId: string,
  pageId: string | null,
  variants: TestVariant[],
  picked: string | null | undefined,
): { offerId: string; pageId: string | null; variantId?: string } {
  const variantId = variants.length > 1 ? chosenVariantId(variants, picked) : null;
  return { offerId, pageId, ...(variantId ? { variantId } : {}) };
}

/** Página escolhida que ainda existe na lista; senão (excluída em outra aba), a inicial. */
export function validPageId(pages: TestPage[], pageId: string | null): string | null {
  return pageId && pages.some((p) => p.id === pageId) ? pageId : defaultPageId(pages);
}

/**
 * "Iniciar teste" recusado porque a página ou a versão escolhida não existe
 * mais (excluída em outra aba, a lista da tela ficou velha): a mensagem em
 * português — a tela recarrega as opções. null = outro erro (mostra o do servidor).
 */
export function staleChoiceMessage(field: string | undefined): string | null {
  if (field === "variantId") {
    return "Essa versão não existe mais (foi excluída, talvez em outra aba). A lista de versões foi atualizada: confira a versão e clique em “Iniciar teste” de novo.";
  }
  if (field === "pageId") {
    return "Essa página não existe mais nesta oferta (talvez tenha sido excluída em outra aba). A lista foi atualizada: escolha a página e clique em “Iniciar teste” de novo.";
  }
  return null;
}

/** Onde a tela busca as páginas e versões atuais (rota em app/(painel)/ofertas/[offerId]/testar-pixels/opcoes). */
export function pixelTestChoicesUrl(offerId: string): string {
  return `/ofertas/${encodeURIComponent(offerId)}/testar-pixels/opcoes`;
}

/** Resposta da rota de opções → páginas (com as versões). null = formato inesperado. */
export function parseChoices(json: unknown): TestPage[] | null {
  const pages = isRecord(json) ? json.pages : null;
  if (!Array.isArray(pages)) return null;
  const variantOk = (v: unknown) =>
    isRecord(v) && typeof v.id === "string" && typeof v.name === "string" && typeof v.isControl === "boolean";
  const ok = pages.every(
    (p) =>
      isRecord(p) &&
      typeof p.id === "string" &&
      typeof p.name === "string" &&
      typeof p.isHome === "boolean" &&
      (p.variants === undefined || (Array.isArray(p.variants) && p.variants.every(variantOk))),
  );
  return ok ? (pages as TestPage[]) : null;
}

/** Regras que valem na página testada (as da oferta inteira + as só dela). */
export function rulesForPage(rules: TestRule[], pageId: string | null): TestRule[] {
  return rules.filter((r) => r.pageId === null || r.pageId === pageId);
}

/** Plataformas na ordem de cadastro, sem repetir. */
export function vendorsOf(pixels: TestPixel[]): PixelVendorId[] {
  return [...new Set(pixels.map((p) => p.vendor))];
}

// ─── Passos recebidos ────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function detailOf(row: Pick<PixelTestEventRow, "detail">): Record<string, unknown> {
  return isRecord(row.detail) ? row.detail : {};
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function isTrackingEvent(v: unknown): v is TrackingEventId {
  return typeof v === "string" && (TRACKING_EVENTS as readonly string[]).includes(v);
}

function isVendor(v: unknown): v is PixelVendorId {
  return typeof v === "string" && (PIXEL_VENDORS as readonly string[]).includes(v);
}

/** Junta os passos novos aos que já estão na tela (sem repetir, em ordem, no máximo `cap`). */
export function mergeEvents(
  current: PixelTestEventRow[],
  incoming: PixelTestEventRow[],
  cap = 2000,
): PixelTestEventRow[] {
  if (!incoming.length) return current;
  const seen = new Set(current.map((e) => e.id));
  const added = incoming.filter((e) => !seen.has(e.id));
  if (!added.length) return current;
  const all = [...current, ...added].sort((a, b) => a.id - b.id);
  return all.length > cap ? all.slice(all.length - cap) : all;
}

/** A página de teste já mandou algum passo (o script começou)? */
export function pageOpened(events: PixelTestEventRow[]): boolean {
  return events.length > 0;
}

/** Nome curto e universal de cada evento (os nomes padrão da Meta). */
export function eventShortName(event: TrackingEventId): string {
  return VENDOR_EVENT_NAMES.META[event] ?? event;
}

// ─── Selos ───────────────────────────────────────────────────────────────────

export type Tone = "success" | "warning" | "destructive" | "muted" | "info";

export const STATUS_BADGE: Record<PixelTestStatusId, { label: string; tone: Tone }> = {
  LOADED: { label: "Carregou", tone: "info" },
  FIRED: { label: "Disparou", tone: "success" },
  BLOCKED: { label: "Bloqueado", tone: "warning" },
  ERROR: { label: "Erro", tone: "destructive" },
};

export const VENDOR_STATE_BADGE: Record<PixelTestVendorSummary["state"], { label: string; tone: Tone }> = {
  WAITING: { label: "Aguardando", tone: "muted" },
  LOADED: { label: "Carregou", tone: "success" },
  BLOCKED: { label: "Bloqueado", tone: "warning" },
  ERROR: { label: "Erro", tone: "destructive" },
};

// ─── Texto de cada passo ─────────────────────────────────────────────────────

export interface RowText {
  title: string;
  subtitle: string | null;
  /** Explicação de um bloqueio/erro (vem da página, em português). */
  hint: string | null;
}

const CONSENT_TITLES: Record<string, string> = {
  WAITING: "Pixels esperando o “Aceitar”",
  BANNER: "Aviso de cookies apareceu",
  ACCEPTED: "Visitante aceitou os cookies",
  REJECTED: "Visitante recusou os cookies",
  NOTICE: "Visitante viu o aviso de cookies",
  OFF: "Sem aviso de cookies (desligado na oferta)",
};

/** "Versão B · pasta oferta-b/": a versão A/B que a página de teste informou (RUNTIME START). */
function versionText(d: Record<string, unknown>): string | null {
  const version = text(d.versao);
  if (!version) return null;
  const folder = text(d.pasta);
  return folder ? `Versão ${version} · pasta ${folder}` : `Versão ${version}`;
}

/**
 * Versão A/B que a página de teste informou (o último RUNTIME START), ou null
 * (página com uma versão só, ou a página ainda não abriu).
 */
export function reportedVersion(events: Pick<PixelTestEventRow, "vendor" | "event" | "detail">[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.vendor === "RUNTIME" && e.event === "START") return text(detailOf(e).versao);
  }
  return null;
}

/** Título, subtítulo e explicação de um passo da linha do tempo. */
export function describeRow(row: PixelTestEventRow): RowText {
  const d = detailOf(row);
  const hint = text(d.hint) ?? text(d.message);
  if (row.vendor === "RUNTIME") {
    if (row.event === "START") {
      const mode = text(d.mode);
      return {
        title: "Página de teste aberta",
        subtitle: mode && mode !== "test" ? "Fora do modo teste: os pixels não carregam" : versionText(d),
        hint: null,
      };
    }
    return { title: "Erro no script de rastreamento", subtitle: null, hint };
  }
  if (row.vendor === "CONSENT") {
    const known = CONSENT_TITLES[row.event];
    if (known) {
      return { title: known, subtitle: d.remembered === true ? "Escolha guardada de antes" : null, hint };
    }
    const event = isTrackingEvent(row.event) ? eventShortName(row.event) : row.event;
    return { title: `${event} não enviado`, subtitle: null, hint: hint ?? "Os cookies foram recusados." };
  }
  const pixel = text(d.pixel);
  if (row.event === PIXEL_TEST_LOAD_EVENT) {
    if (d.extra === true) return { title: "Pixel não carregou", subtitle: pixel ? `ID ${pixel}` : null, hint };
    const what = d.script === "utms" ? "Script de UTMs" : "Pixel";
    const title =
      row.status === "ERROR"
        ? `Erro ao carregar o ${what.toLowerCase()}`
        : row.status === "BLOCKED"
          ? `${what} bloqueado`
          : `${what} carregou`;
    return { title, subtitle: pixel ? `ID ${pixel}` : null, hint };
  }
  const neutral = isTrackingEvent(d.event) ? d.event : null;
  const sendTo = text(d.sendTo);
  let subtitle: string | null = neutral ? TRACKING_EVENT_LABEL[neutral] : null;
  if (row.vendor === "GOOGLE_ADS" && sendTo) {
    subtitle = neutral ? `Conversão de ${eventShortName(neutral)} → ${sendTo}` : `Conversão → ${sendTo}`;
  }
  // Teste A/B: a versão que a plataforma recebeu (os_versao).
  const version = text(d.os_versao);
  if (version) subtitle = subtitle ? `${subtitle} · versão ${version}` : `Versão ${version}`;
  return { title: row.event, subtitle, hint };
}

/** Hora do passo (HH:MM:SS, horário local). */
export function rowTime(row: Pick<PixelTestEventRow, "at">): string {
  const at = new Date(row.at);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ─── Consentimento ───────────────────────────────────────────────────────────

export type ConsentStateId = "PAGE" | "WAITING" | "ACCEPTED" | "REJECTED" | "NOTICE" | "OFF";

export interface ConsentView {
  state: ConsentStateId;
  label: string;
  tone: Tone;
  hint: string | null;
}

function consentView(state: ConsentStateId, acceptLabel: string): Omit<ConsentView, "state"> {
  switch (state) {
    case "PAGE":
      return { label: "Aguardando a página de teste", tone: "muted", hint: null };
    case "WAITING":
      return {
        label: `Esperando o “${acceptLabel}”`,
        tone: "warning",
        hint: `Os pixels só carregam depois que o visitante clica em “${acceptLabel}” no aviso de cookies.`,
      };
    case "ACCEPTED":
      return { label: "Aceito", tone: "success", hint: "Os pixels podem carregar." };
    case "REJECTED":
      return {
        label: "Recusado",
        tone: "destructive",
        hint: "Depois da recusa, os pixels não carregam nem recebem eventos.",
      };
    case "NOTICE":
      return {
        label: "Aviso mostrado",
        tone: "success",
        hint: "Só aviso: os pixels carregam direto, sem esperar o visitante clicar.",
      };
    case "OFF":
      return { label: "Sem aviso de cookies", tone: "muted", hint: "O aviso está desligado nesta oferta." };
  }
}

const CONSENT_STEP: Record<string, ConsentStateId> = {
  WAITING: "WAITING",
  BANNER: "WAITING",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  NOTICE: "NOTICE",
  OFF: "OFF",
};

/**
 * Situação do consentimento na página de teste: vale a última escolha recebida
 * (cada página do funil informa de novo ao abrir). Com "Só avisar", o aviso
 * aparecer não é esperar: os pixels já carregam.
 */
export function consentState(
  events: PixelTestEventRow[],
  opts: { mode?: ConsentModeId; acceptLabel?: string } = {},
): ConsentView {
  const mode = opts.mode ?? "OPT_IN";
  let state: ConsentStateId = "PAGE";
  for (const e of events) {
    if (e.vendor !== "CONSENT") continue;
    let next = CONSENT_STEP[e.event];
    if (!next) continue;
    if (e.event === "BANNER") {
      // "Aviso apareceu" depois de uma escolha guardada não desfaz a escolha.
      if (state !== "PAGE" && state !== "WAITING") continue;
      if (mode !== "OPT_IN") next = "NOTICE";
    }
    state = next;
  }
  return { state, ...consentView(state, opts.acceptLabel || "Aceitar") };
}

/** Passos na tela durante o teste, conforme o aviso de cookies da oferta. */
export function testSteps(setup: Pick<PixelTestSetup, "consentMode" | "acceptLabel" | "noticeLabel">): string[] {
  const steps = ["Abra a página de teste (ela abre numa aba nova)."];
  if (setup.consentMode === "OPT_IN") steps.push(`Clique em “${setup.acceptLabel || "Aceitar"}” no aviso de cookies.`);
  else if (setup.consentMode === "NOTICE") {
    steps.push(`Os pixels já carregam; “${setup.noticeLabel || "Entendi"}” só fecha o aviso de cookies.`);
  }
  steps.push("Clique no botão de compra e envie o formulário.");
  return steps;
}

/** O que a oferta pede (texto da configuração). */
export const CONSENT_MODE_TEXT: Record<ConsentModeId, string> = {
  OPT_IN: "Pede permissão antes de carregar os pixels (LGPD)",
  NOTICE: "Só avisa (os pixels carregam direto)",
  OFF: "Sem aviso de cookies",
};

// ─── Lista de conferência por plataforma ─────────────────────────────────────

export type CheckState = "done" | "pending" | "failed";

export interface CheckItem {
  id: string;
  label: string;
  state: CheckState;
  /** O que fazer para o item acontecer (pendente) ou o motivo da falha. */
  hint: string | null;
}

export interface VendorChecklist {
  items: CheckItem[];
  /** Observação da plataforma (ex.: UTMify dispara sozinha). */
  note: string | null;
}

/** Link da oferta num seletor [data-os-link="chave"] (gerado pelo painel). */
function linkOfSelector(selector: string | null, links: TestLink[]): TestLink | null {
  const m = selector ? /^\[data-os-link=["']?([^"'\]]+)["']?\]$/.exec(selector.trim()) : null;
  return m ? (links.find((l) => l.key === m[1]) ?? null) : null;
}

function triggerPhrase(rule: TestRule, links: TestLink[]): string {
  switch (rule.trigger) {
    case "PAGE_LOAD":
      return "ao abrir a página";
    case "TIME_ON_PAGE":
      return `depois de ${rule.value ?? 0} s na página`;
    case "SCROLL_DEPTH":
      return `ao rolar ${rule.value ?? 0}% da página`;
    case "CHECKOUT_CLICK":
      return "ao clicar no checkout";
    case "ELEMENT_CLICK": {
      const link = linkOfSelector(rule.selector, links);
      return link ? `ao clicar em “${link.label}”` : "ao clicar no elemento escolhido";
    }
    case "FORM_SUBMIT":
      return "ao enviar o formulário";
  }
}

function triggerHint(rule: TestRule, links: TestLink[]): string {
  switch (rule.trigger) {
    case "PAGE_LOAD":
      return "Dispara ao abrir a página, depois que o pixel carrega.";
    case "TIME_ON_PAGE":
      return `Deixe a página de teste aberta, na tela, por ${rule.value ?? 0} segundos.`;
    case "SCROLL_DEPTH":
      return `Role a página de teste até ${rule.value ?? 0}% da altura.`;
    case "CHECKOUT_CLICK":
      return "Clique no botão de compra da página de teste.";
    case "ELEMENT_CLICK": {
      const link = linkOfSelector(rule.selector, links);
      if (link) return `Clique no botão ligado ao link “${link.label}” na página de teste.`;
      return rule.selector
        ? `Clique no elemento ${rule.selector} na página de teste.`
        : "Clique no elemento escolhido na página de teste.";
    }
    case "FORM_SUBMIT":
      return "Preencha e envie o formulário da página de teste.";
  }
}

/** Passos de uma plataforma para um evento neutro (pelo detail.event ou, sem ele, pelo nome). */
function eventRows(events: PixelTestEventRow[], vendor: PixelVendorId, event: TrackingEventId, name: string | null) {
  return events.filter((e) => {
    if (e.vendor !== vendor || e.event === PIXEL_TEST_LOAD_EVENT) return false;
    const neutral = detailOf(e).event;
    return isTrackingEvent(neutral) ? neutral === event : name !== null && e.event === name;
  });
}

function stateOf(rows: PixelTestEventRow[]): { state: CheckState; hint: string | null } {
  if (rows.some((r) => r.status === "FIRED")) return { state: "done", hint: null };
  const failed = rows.findLast((r) => r.status === "BLOCKED" || r.status === "ERROR");
  if (failed) return { state: "failed", hint: describeRow(failed).hint };
  return { state: "pending", hint: null };
}

/**
 * Lista de conferência de uma plataforma: "Pixel carregou", "PageView disparou"
 * e um item por evento das regras da página (InitiateCheckout ao clicar no
 * checkout, Lead ao enviar o formulário…), com o nome que a plataforma recebe.
 */
/** Passo de carregamento do script de UTMs ou de um pixel extra (não é o carregamento do pixel). */
export function isSideLoadRow(row: Pick<PixelTestEventRow, "event" | "detail">): boolean {
  const d = detailOf(row);
  return row.event === PIXEL_TEST_LOAD_EVENT && (d.script === "utms" || d.extra === true);
}

export function vendorChecklist(opts: {
  vendor: PixelVendorId;
  pixels: TestPixel[];
  rules: TestRule[];
  eventNames: TrackingSettings["eventNames"];
  links: TestLink[];
  events: PixelTestEventRow[];
  summary: PixelTestVendorSummary | undefined;
  consent: ConsentView;
  acceptLabel?: string;
}): VendorChecklist {
  const { vendor, rules, eventNames, links, events, consent } = opts;
  const acceptLabel = opts.acceptLabel || "Aceitar";
  const items: CheckItem[] = [];
  let note: string | null = null;

  // Carregamento do pixel.
  const loadRows = events.filter((e) => e.vendor === vendor && e.event === PIXEL_TEST_LOAD_EVENT && !isSideLoadRow(e));
  const state = opts.summary?.state ?? "WAITING";
  if (state === "LOADED") items.push({ id: "load", label: "Pixel carregou", state: "done", hint: null });
  else if (state === "BLOCKED" || state === "ERROR") {
    const failed = loadRows.findLast((r) => r.status === state);
    items.push({
      id: "load",
      label: "Pixel carregou",
      state: "failed",
      hint: (failed && describeRow(failed).hint) ?? "O navegador não deixou o pixel carregar.",
    });
  } else {
    items.push({
      id: "load",
      label: "Pixel carregou",
      state: "pending",
      hint:
        consent.state === "WAITING"
          ? `Clique em “${acceptLabel}” no aviso de cookies da página de teste.`
          : consent.state === "REJECTED"
            ? "Os cookies foram recusados: o pixel não carrega."
            : "Abra a página de teste.",
    });
  }

  if (vendor === "UTMIFY") {
    const utms = events.filter((e) => e.vendor === vendor && isSideLoadRow(e) && detailOf(e).script === "utms");
    if (utms.length || opts.pixels.some((p) => p.utmsScript)) {
      const failed = utms.findLast((r) => r.status === "BLOCKED" || r.status === "ERROR");
      items.push(
        utms.some((r) => r.status === "LOADED")
          ? { id: "utms", label: "Script de UTMs carregou", state: "done", hint: null }
          : failed
            ? { id: "utms", label: "Script de UTMs carregou", state: "failed", hint: describeRow(failed).hint }
            : { id: "utms", label: "Script de UTMs carregou", state: "pending", hint: null },
      );
    }
    const extra = events.findLast((e) => e.vendor === vendor && isSideLoadRow(e) && detailOf(e).extra === true);
    note = extra
      ? describeRow(extra).hint
      : "A UTMify dispara os eventos por conta própria: confira as vendas e UTMs no painel da UTMify.";
    return { items, note };
  }

  const consentBlocked = (event: TrackingEventId) =>
    events.findLast((e) => e.vendor === "CONSENT" && e.event === event && e.status === "BLOCKED");

  const push = (id: string, event: TrackingEventId, label: string, pendingHint: string) => {
    const name = vendor === "GOOGLE_ADS" ? "conversion" : vendorEventName(vendor, event, eventNames);
    const result = stateOf(eventRows(events, vendor, event, name));
    const blocked = result.state === "pending" ? consentBlocked(event) : undefined;
    if (blocked) {
      items.push({ id, label, state: "failed", hint: describeRow(blocked).hint });
      return;
    }
    items.push({ id, label, state: result.state, hint: result.state === "pending" ? pendingHint : result.hint });
  };

  const displayName = (event: TrackingEventId): string | null => {
    if (vendor === "GOOGLE_ADS") return `Conversão de ${eventShortName(event)}`;
    return vendorEventName(vendor, event, eventNames);
  };

  // PageView (o Google Ads não tem: só conversões com rótulo).
  if (vendor !== "GOOGLE_ADS") {
    const name = displayName("PAGE_VIEW");
    if (name) push("PAGE_VIEW", "PAGE_VIEW", `${name} disparou`, "Dispara sozinho quando o pixel carrega.");
  }

  // Um item por evento das regras (gatilhos do mesmo evento juntos: "… ou …").
  const labels = new Set<TrackingEventId>();
  if (vendor === "GOOGLE_ADS") {
    for (const p of opts.pixels) {
      for (const [event, label] of Object.entries(p.conversionLabels)) {
        if (isTrackingEvent(event) && label?.trim()) labels.add(event);
      }
    }
    if (!labels.size) {
      note =
        "Nenhum rótulo de conversão cadastrado: o Google Ads não recebe eventos. Cadastre os rótulos no pixel do Google Ads.";
    }
  }
  const byEvent = new Map<TrackingEventId, TestRule[]>();
  for (const rule of rules) {
    if (rule.event === "PAGE_VIEW") continue;
    if (vendor === "GOOGLE_ADS" && !labels.has(rule.event)) continue;
    byEvent.set(rule.event, [...(byEvent.get(rule.event) ?? []), rule]);
  }
  for (const [event, list] of byEvent) {
    const name = displayName(event);
    if (!name) continue;
    const phrases = [...new Set(list.map((r) => triggerPhrase(r, links)))];
    push(event, event, `${name} ${phrases.join(" ou ")}`, triggerHint(list[0], links));
  }
  return { items, note };
}

// ─── Dicas ───────────────────────────────────────────────────────────────────

export interface Tip {
  id: string;
  tone: "error" | "warning" | "info";
  title: string;
  text: string;
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`;
}

/** Pixels com ID fora do formato da plataforma (colado errado). */
export function badPixelIds(pixels: TestPixel[]): { pixel: TestPixel; message: string }[] {
  return pixels
    .filter((p) => !PIXEL_ID_RULES[p.vendor].pattern.test(p.pixelId))
    .map((pixel) => ({ pixel, message: PIXEL_ID_RULES[pixel.vendor].message }));
}

/**
 * Dicas de solução, das mais graves para as mais simples: bloqueador de
 * anúncios, erros, ID com formato errado, consentimento, página não aberta e
 * "só o PageView até agora".
 */
export function troubleshootingTips(ctx: {
  events: PixelTestEventRow[];
  summaries: PixelTestVendorSummary[];
  pixels: TestPixel[];
  rules: TestRule[];
  consent: ConsentView;
  running: boolean;
  full: boolean;
  acceptLabel?: string;
}): Tip[] {
  const { events, summaries, pixels, rules, consent, running } = ctx;
  const acceptLabel = ctx.acceptLabel || "Aceitar";
  const tips: Tip[] = [];
  const label = (v: string) => (isVendor(v) ? PIXEL_VENDOR_LABEL[v] : v);

  // A página de teste informa se o navegador estava sem internet (RUNTIME START).
  const start = events.findLast((e) => e.vendor === "RUNTIME" && e.event === "START");
  const offline = start ? detailOf(start).online === false : false;
  if (offline) {
    tips.push({
      id: "offline",
      tone: "error",
      title: "Sem internet no navegador de teste",
      text: "A página de teste abriu sem conexão com a internet, então os pixels não têm como carregar. Confira a conexão e recarregue a página de teste.",
    });
  }

  const blocked = [
    ...new Set(
      events
        .filter((e) => e.status === "BLOCKED" && isVendor(e.vendor))
        .map((e) => e.vendor)
        .concat(summaries.filter((s) => s.state === "BLOCKED").map((s) => s.vendor)),
    ),
  ];
  if (blocked.length && !offline) {
    const names = joinNames(blocked.map(label));
    tips.push({
      id: "blocked",
      tone: "error",
      title: "Script bloqueado",
      text: `${names} ${blocked.length > 1 ? "foram bloqueados" : "foi bloqueado"} antes de chegar à página. Pode ser: um bloqueador de anúncios ou extensão (AdBlock, uBlock, Brave, Opera, proteção contra rastreamento do Safari), a rede (firewall, filtro de DNS, rede da empresa) ou a internet caindo. Desative o bloqueador para a página de teste ou abra o link do teste em outro navegador ou rede, e recarregue. Visitantes com bloqueador também não são medidos pelo navegador.`,
    });
  }

  const errors = events.filter((e) => e.status === "ERROR");
  if (errors.length) {
    const last = errors.at(-1) as PixelTestEventRow;
    const detail = describeRow(last).hint;
    tips.push({
      id: "errors",
      tone: "error",
      title: "Erro ao carregar ou enviar",
      text: `Confira sua internet e o ID do pixel e recarregue a página de teste.${detail ? ` Detalhe: ${detail}` : ""}`,
    });
  }

  for (const { pixel, message } of badPixelIds(pixels)) {
    tips.push({
      id: `bad-id-${pixel.id}`,
      tone: "warning",
      title: "ID do pixel parece errado",
      text: `${PIXEL_VENDOR_LABEL[pixel.vendor]} (${pixel.pixelId}): ${message}`,
    });
  }

  if (consent.state === "WAITING") {
    tips.push({
      id: "consent-waiting",
      tone: "warning",
      title: "Aceite os cookies na página de teste",
      text: `Os pixels só carregam depois do “${acceptLabel}” no aviso de cookies (LGPD). Na página de teste, clique em “${acceptLabel}”.`,
    });
  } else if (consent.state === "REJECTED") {
    tips.push({
      id: "consent-rejected",
      tone: "warning",
      title: "Os cookies foram recusados",
      text: `Depois da recusa, os pixels não carregam. Na página de teste, clique em “Preferências de cookies” no rodapé (ou no botão “Cookies” do canto) e escolha “${acceptLabel}”, ou comece um novo teste.`,
    });
  }

  if (running && !pageOpened(events)) {
    tips.push({
      id: "open-page",
      tone: "info",
      title: "Abra a página de teste",
      text: "Clique em “Abrir página de teste”: ela abre numa aba nova, com os pixels de verdade. Se já abriu, recarregue aquela aba.",
    });
  }

  const fired = events.filter((e) => e.status === "FIRED" && isVendor(e.vendor));
  const onlyPageView =
    fired.length > 0 &&
    fired.every((e) => {
      const neutral = detailOf(e).event;
      return neutral === "PAGE_VIEW" || (!isTrackingEvent(neutral) && /^page_?view$/i.test(e.event));
    });
  if (onlyPageView && consent.state !== "REJECTED") {
    const checkout = rules.some((r) => r.event === "INITIATE_CHECKOUT");
    tips.push({
      id: "only-page-view",
      tone: "info",
      title: "Só o PageView até agora",
      text: checkout
        ? "Clique no botão de compra da página de teste para ver o InitiateCheckout aqui."
        : "Clique nos botões e envie o formulário da página de teste para ver os outros eventos aqui.",
    });
  }

  if (!rules.some((r) => r.event !== "PAGE_VIEW")) {
    tips.push({
      id: "no-rules",
      tone: "info",
      title: "Nenhuma regra de evento nesta página",
      text: "Só o PageView dispara. Crie regras de evento (há as recomendadas prontas) na configuração de pixels da oferta.",
    });
  }

  if (ctx.full) {
    tips.push({
      id: "full",
      tone: "warning",
      title: "Limite de passos atingido",
      text: "Este teste já recebeu 2.000 passos e os próximos não aparecem. Comece um novo teste.",
    });
  }
  return tips;
}

// ─── Conferir na plataforma ──────────────────────────────────────────────────

export interface HelperLink {
  label: string;
  href: string;
}

const TAG_ASSISTANT = "https://tagassistant.google.com/";

/** Ferramentas de cada plataforma para conferir os eventos do lado delas. */
export function vendorHelpers(vendor: PixelVendorId, pixelIds: string[]): { links: HelperLink[]; text: string | null } {
  switch (vendor) {
    case "META":
      return {
        links: [
          {
            label: "Meta Pixel Helper (extensão do Chrome)",
            href: "https://chromewebstore.google.com/detail/meta-pixel-helper/fdgfkebogiimcoedlicjlajpkdmockpc",
          },
          ...pixelIds.map((id) => ({
            label: pixelIds.length > 1 ? `Testar eventos do pixel ${id}` : "Gerenciador de Eventos → Testar eventos",
            href: `https://business.facebook.com/events_manager2/list/pixel/${encodeURIComponent(id)}/test_events`,
          })),
        ],
        text: "No Gerenciador de Eventos, os eventos do navegador aparecem em “Testar eventos” em alguns segundos.",
      };
    case "TIKTOK":
      return {
        links: [
          {
            label: "TikTok Pixel Helper (extensão do Chrome)",
            href: "https://chromewebstore.google.com/search/TikTok%20Pixel%20Helper",
          },
          { label: "TikTok Ads Manager", href: "https://ads.tiktok.com/" },
        ],
        text: "No TikTok Ads Manager: Ferramentas → Eventos → seu pixel → Testar eventos.",
      };
    case "GA4":
      return {
        links: [
          { label: "Google Analytics", href: "https://analytics.google.com/" },
          { label: "Tag Assistant do Google", href: TAG_ASSISTANT },
        ],
        text: "No Google Analytics, veja em Relatórios → Tempo real.",
      };
    case "GOOGLE_ADS":
      return {
        links: [
          { label: "Tag Assistant do Google", href: TAG_ASSISTANT },
          { label: "Google Ads", href: "https://ads.google.com/" },
        ],
        text: "No Google Ads, as conversões aparecem em Metas → Conversões (pode levar algumas horas).",
      };
    case "KWAI":
      return { links: [], text: "Confira no Kwai for Business → Ferramentas → Pixel." };
    case "UTMIFY":
      return { links: [], text: "Confira as vendas e UTMs no painel da UTMify." };
  }
}

// ─── Tempo ───────────────────────────────────────────────────────────────────

/** Tempo que falta: "1 h 05 min", "12 min", "45 s". */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "0 s";
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

// ─── Sessão guardada na aba ──────────────────────────────────────────────────

export interface StoredSession {
  id: string;
  token: string;
  url: string;
  pageId: string | null;
  /** Versão A/B testada (sem o campo = a de controle ou a única). */
  variantId?: string;
  /** ISO. */
  expiresAt: string;
  vendors: PixelVendorId[];
  /** A pessoa clicou em "Encerrar teste". */
  ended: boolean;
}

export function sessionStorageKey(offerId: string) {
  return `os-pixel-test:${offerId}`;
}

/** Sessão devolvida pela ação "Iniciar teste" → formato guardado na aba. */
export function toStoredSession(view: {
  id: string;
  token: string;
  url: string;
  pageId: string | null;
  variantId?: string | null;
  expiresAt: Date | string;
  vendors: PixelVendorId[];
}): StoredSession {
  return {
    id: view.id,
    token: view.token,
    url: view.url,
    pageId: view.pageId,
    ...(view.variantId ? { variantId: view.variantId } : {}),
    expiresAt: new Date(view.expiresAt).toISOString(),
    vendors: [...view.vendors],
    ended: false,
  };
}

/**
 * Lê a sessão guardada (recarregar a tela continua o mesmo teste). Descarta o
 * que estiver quebrado, vencido ou for de uma página (ou versão A/B, entre
 * `variantIds`) que não existe mais.
 */
export function readStoredSession(
  raw: string | null,
  now: number,
  pageIds: string[],
  variantIds: string[] = [],
): StoredSession | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { id, token, url, pageId, variantId, expiresAt, vendors, ended } = value;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) return null;
  if (typeof token !== "string" || !/^[a-z2-7]{26}$/.test(token)) return null;
  if (typeof url !== "string" || !/^http:\/\/[a-z2-7]{26}\.localhost:\d+\//.test(url)) return null;
  if (pageId !== null && (typeof pageId !== "string" || !pageIds.includes(pageId))) return null;
  if (
    variantId != null &&
    (typeof variantId !== "string" || !variantId || !pageId || !variantIds.includes(variantId))
  ) {
    return null;
  }
  if (typeof expiresAt !== "string") return null;
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires) || expires <= now || ended === true) return null;
  if (!Array.isArray(vendors) || !vendors.every(isVendor)) return null;
  return {
    id,
    token,
    url,
    pageId,
    ...(variantId ? { variantId: variantId as string } : {}),
    expiresAt,
    vendors: vendors as PixelVendorId[],
    ended: false,
  };
}

// ─── Leitura dos passos (rota /api/pixel-test/<sessão>) ─────────────────────

/** Resposta da rota GET /api/pixel-test/<sessão>?after=<id> (datas em ISO). */
export interface PixelTestPollResponse {
  session: {
    id: string;
    offerId: string;
    pageId: string | null;
    expiresAt: string;
    expired: boolean;
    eventCount: number;
    full: boolean;
  };
  events: PixelTestEventRow[];
  lastId: number;
}

/** Quantos passos a rota devolve por vez (mais que isso: lê de novo em seguida). */
export const PIXEL_TEST_PAGE_SIZE = 200;

export function pixelTestEventsUrl(sessionId: string, afterId: number) {
  return `/api/pixel-test/${encodeURIComponent(sessionId)}?after=${Math.max(0, Math.floor(afterId))}`;
}

/** Espera até a próxima leitura: 1,5 s normalmente; mais devagar depois de falhas (até 15 s). */
export function nextPollDelay(failures: number, base = 1500): number {
  if (failures <= 0) return base;
  return Math.min(15_000, base * 2 ** Math.min(failures, 4));
}
