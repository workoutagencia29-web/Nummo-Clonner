/**
 * Rastreamento de cada oferta (Fase 4): pixels, configurações gerais
 * (consentimento LGPD, repasse de UTMs, valor, nomes de evento, código livre),
 * categoria do código livre das páginas e regras de evento.
 *
 * Tokens de API (API de Conversões / Events API) ficam criptografados no banco
 * e NUNCA saem daqui: as listas devolvem só `hasToken` e uma dica mascarada.
 * Mensagens de erro em português (UserError com o campo culpado).
 */
import * as csstree from "css-tree";
import type { z } from "zod";
import type { EventTrigger, Prisma, TrackingEvent } from "@/generated/prisma/client";
import { encryptSecret, maskSecret, SECRET_UNREADABLE_MESSAGE, tryDecryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { UserError, uniqueViolationFields } from "@/lib/errors";
import { isRecord, PAGE_CODE_FIELDS, unclosedCodePart } from "@/lib/page-code";
import { detectHtmlTrackers } from "@/lib/tracking/code-trackers";
import {
  detectAllCodeTrackers,
  resolveCodeCategoryFull,
  unknownCodeScripts,
} from "@/lib/tracking/code-trackers-server";
import { checkConversionLabel, checkPixelId } from "@/lib/tracking/ids";
import {
  CODE_CATEGORIES,
  type CodeCategoryId,
  EventRuleInputSchema,
  type EventTriggerId,
  explicitPageCodeCategory,
  FORWARD_PARAM_RE,
  isServerApiVendor,
  PIXEL_VENDOR_LABEL,
  PIXEL_VENDORS,
  type PixelVendorId,
  POLICY_NONE,
  parseTrackingSettings,
  parseVendorOptions,
  RECOMMENDED_RULES,
  SERVER_API_VENDORS,
  serverApiEnabled,
  TRACKING_EVENTS,
  type TrackingEventId,
  type TrackingSettings,
  TrackingSettingsSchema,
  VENDOR_OPTIONS_SCHEMA,
  type VendorOptions,
} from "@/lib/tracking/schema";

/** Limites de sanidade por oferta. */
export const MAX_PIXELS_PER_OFFER = 30;
export const MAX_RULES_PER_OFFER = 100;
/** Limite somado do código livre da oferta (bytes em UTF-8), igual ao das páginas. */
export const OFFER_CODE_MAX_BYTES = 200 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────

async function offerOrThrow(offerId: string) {
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, deletedAt: null },
    select: { id: true, name: true, tracking: true },
  });
  if (!offer) throw new UserError("Oferta não encontrada. Ela pode ter sido excluída.");
  return offer;
}

async function touch(offerId: string) {
  await prisma.offer.update({ where: { id: offerId }, data: { updatedAt: new Date() } });
}

async function assertPageOfOffer(offerId: string, pageId: string, field: string) {
  const page = await prisma.page.count({ where: { id: pageId, offerId } });
  if (!page) throw new UserError("Essa página não faz parte desta oferta.", field);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pixels
// ─────────────────────────────────────────────────────────────────────────────

interface PixelViewBase {
  id: string;
  pixelId: string;
  label: string | null;
  enabled: boolean;
  /** Tem token de API salvo (o valor nunca sai do servidor). */
  hasToken: boolean;
  /** Final do token para a pessoa reconhecer ("••••••a1b2"). */
  tokenHint: string | null;
  /** O token salvo não pode ser lido (chave do app mudou): precisa colar de novo. */
  tokenUnreadable: boolean;
  /** Código de teste de eventos do servidor (Meta/TikTok), usado pelo eventos.php. */
  testEventCode: string | null;
  /** Envio pelo servidor ligado, mas sem token válido: não vai funcionar no ZIP. */
  needsToken: boolean;
  createdAt: Date;
}

/** Pixel como o painel vê (opções já com os valores padrão da plataforma). */
export type PixelView = {
  [V in PixelVendorId]: PixelViewBase & { vendor: V; options: VendorOptions<V> };
}[PixelVendorId];

const PIXEL_SELECT = {
  id: true,
  vendor: true,
  pixelId: true,
  label: true,
  enabled: true,
  accessTokenEnc: true,
  testEventCode: true,
  options: true,
  createdAt: true,
} as const satisfies Prisma.PixelConfigSelect;

type PixelRow = Prisma.PixelConfigGetPayload<{ select: typeof PIXEL_SELECT }>;

function toPixelView(row: PixelRow): PixelView {
  const vendor = row.vendor as PixelVendorId;
  const token = tryDecryptSecret(row.accessTokenEnc);
  const hasToken = !!row.accessTokenEnc;
  const tokenUnreadable = hasToken && token === null;
  return {
    id: row.id,
    vendor,
    pixelId: row.pixelId,
    label: row.label,
    enabled: row.enabled,
    options: parseVendorOptions(vendor, row.options),
    hasToken,
    tokenHint: token ? maskSecret(token) : null,
    tokenUnreadable,
    testEventCode: row.testEventCode,
    needsToken: serverApiEnabled(vendor, row.options) && (!hasToken || tokenUnreadable),
    createdAt: row.createdAt,
  } as PixelView;
}

/** Pixels da oferta (ordem de cadastro). Nunca devolve o token. */
export async function listPixels(offerId: string): Promise<PixelView[]> {
  const rows = await prisma.pixelConfig.findMany({
    where: { offerId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: PIXEL_SELECT,
  });
  return rows.map(toPixelView);
}

function cleanLabel(label: string | null | undefined): string | null {
  const text = (label ?? "").trim();
  if (text.length > 60) throw new UserError("O apelido do pixel pode ter no máximo 60 caracteres.", "label");
  return text || null;
}

function cleanPixelId(vendor: PixelVendorId, raw: string): string {
  const check = checkPixelId(vendor, raw);
  if (!check.ok) throw new UserError(check.message, "pixelId");
  return check.id;
}

/** Token da API de Conversões / Events API. */
export function cleanAccessToken(vendor: PixelVendorId, raw: string): string {
  if (!isServerApiVendor(vendor)) {
    throw new UserError(`${PIXEL_VENDOR_LABEL[vendor]} não usa token de API.`, "accessToken");
  }
  const api = SERVER_API_VENDORS[vendor].label;
  const token = raw.trim().replace(/^["']|["']$/g, "");
  if (!token) throw new UserError(`Cole o token da ${api}.`, "accessToken");
  if (/\s/.test(token)) {
    throw new UserError("O token não pode ter espaços nem quebras de linha. Copie de novo.", "accessToken");
  }
  if (!/^[\x21-\x7e]+$/.test(token)) {
    throw new UserError("O token tem caracteres inválidos. Copie de novo, direto da plataforma.", "accessToken");
  }
  if (token.length < 20 || token.length > 1000) {
    throw new UserError(`Esse token parece incompleto. Copie de novo o token da ${api}.`, "accessToken");
  }
  return token;
}

function cleanTestEventCode(vendor: PixelVendorId, raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim();
  if (!code) return null;
  if (!isServerApiVendor(vendor)) {
    throw new UserError(`${PIXEL_VENDOR_LABEL[vendor]} não usa código de teste.`, "testEventCode");
  }
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(code)) {
    throw new UserError("O código de teste tem só letras e números (ex.: TEST12345).", "testEventCode");
  }
  return code;
}

/** Valida as opções da plataforma (juntando com as atuais, se houver). */
export function cleanPixelOptions(
  vendor: PixelVendorId,
  input: unknown,
  pixelId: string,
  current?: unknown,
): Prisma.InputJsonObject {
  const base = current === undefined ? {} : (parseVendorOptions(vendor, current) as Record<string, unknown>);
  const patch = isRecord(input) ? { ...input } : {};
  if (vendor === "GOOGLE_ADS" && "conversionLabels" in patch) {
    const labels: Record<string, string> = {};
    const raw = isRecord(patch.conversionLabels) ? patch.conversionLabels : {};
    for (const [event, value] of Object.entries(raw)) {
      if (!(TRACKING_EVENTS as readonly string[]).includes(event)) continue;
      if (typeof value !== "string" || !value.trim()) continue;
      const check = checkConversionLabel(value, pixelId);
      if (!check.ok) throw new UserError(check.message, `options.conversionLabels.${event}`);
      labels[event] = check.label;
    }
    patch.conversionLabels = labels;
  }
  const schema = VENDOR_OPTIONS_SCHEMA[vendor] as z.ZodType;
  const parsed = schema.safeParse({ ...base, ...patch });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new UserError(
      "Alguma opção do pixel está inválida. Confira e salve de novo.",
      `options.${issue.path.join(".")}`,
    );
  }
  return parsed.data as Prisma.InputJsonObject;
}

/** A UTMify lê um só pixel por página (window.pixelId): um segundo ativo nunca carregaria. */
export const UTMIFY_SINGLE_MESSAGE = "A UTMify aceita um pixel por oferta. Desative o outro antes.";

async function assertSingleUtmify(offerId: string, exceptId?: string) {
  const other = await prisma.pixelConfig.count({
    where: { offerId, vendor: "UTMIFY", enabled: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (other) throw new UserError(UTMIFY_SINGLE_MESSAGE, "pixelId");
}

async function assertUniquePixel(offerId: string, vendor: PixelVendorId, pixelId: string, exceptId?: string) {
  const dup = await prisma.pixelConfig.count({
    where: { offerId, vendor, pixelId, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (dup) throw duplicatePixel(vendor);
}

function duplicatePixel(vendor: PixelVendorId) {
  return new UserError(`Esse pixel (${PIXEL_VENDOR_LABEL[vendor]}) já está cadastrado nesta oferta.`, "pixelId");
}

async function withUniqueGuard<T>(vendor: PixelVendorId, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (uniqueViolationFields(err).includes("pixelId")) throw duplicatePixel(vendor);
    throw err;
  }
}

export interface PixelCreateInput {
  vendor: PixelVendorId;
  pixelId: string;
  label?: string | null;
  enabled?: boolean;
  options?: unknown;
  /** Token da API de Conversões (Meta) / Events API (TikTok). */
  accessToken?: string | null;
  testEventCode?: string | null;
}

export async function createPixel(offerId: string, input: PixelCreateInput): Promise<PixelView> {
  await offerOrThrow(offerId);
  const vendor = input.vendor;
  if (!(PIXEL_VENDORS as readonly string[]).includes(vendor)) throw new UserError("Escolha a plataforma.", "vendor");
  const pixelId = cleanPixelId(vendor, input.pixelId);
  const label = cleanLabel(input.label);
  const options = cleanPixelOptions(vendor, input.options, pixelId);
  const token = input.accessToken?.trim() ? cleanAccessToken(vendor, input.accessToken) : null;
  const testEventCode = cleanTestEventCode(vendor, input.testEventCode);
  const count = await prisma.pixelConfig.count({ where: { offerId } });
  if (count >= MAX_PIXELS_PER_OFFER) {
    throw new UserError(`Uma oferta pode ter no máximo ${MAX_PIXELS_PER_OFFER} pixels.`);
  }
  await assertUniquePixel(offerId, vendor, pixelId);
  if (vendor === "UTMIFY" && (input.enabled ?? true)) await assertSingleUtmify(offerId);
  const row = await withUniqueGuard(vendor, () =>
    prisma.pixelConfig.create({
      data: {
        offerId,
        vendor,
        pixelId,
        label,
        enabled: input.enabled ?? true,
        options,
        accessTokenEnc: token ? encryptSecret(token) : null,
        testEventCode,
      },
      select: PIXEL_SELECT,
    }),
  );
  await touch(offerId);
  return toPixelView(row);
}

async function pixelOrThrow(id: string) {
  const pixel = await prisma.pixelConfig.findFirst({
    where: { id, offer: { deletedAt: null } },
    select: { ...PIXEL_SELECT, offerId: true },
  });
  if (!pixel) throw new UserError("Pixel não encontrado. Ele pode ter sido excluído.");
  return pixel;
}

export interface PixelUpdateInput {
  pixelId?: string;
  label?: string | null;
  enabled?: boolean;
  /** Opções parciais: juntam com as atuais (conversionLabels é trocado inteiro). */
  options?: unknown;
  testEventCode?: string | null;
}

/** Atualiza um pixel (a plataforma não muda; token tem função própria). */
export async function updatePixel(id: string, input: PixelUpdateInput): Promise<PixelView> {
  const pixel = await pixelOrThrow(id);
  const vendor = pixel.vendor as PixelVendorId;
  const data: Prisma.PixelConfigUpdateInput = {};
  const pixelId = input.pixelId !== undefined ? cleanPixelId(vendor, input.pixelId) : pixel.pixelId;
  if (input.pixelId !== undefined && pixelId !== pixel.pixelId) {
    await assertUniquePixel(pixel.offerId, vendor, pixelId, id);
    data.pixelId = pixelId;
  }
  if (input.label !== undefined) data.label = cleanLabel(input.label);
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (vendor === "UTMIFY" && input.enabled === true && !pixel.enabled) await assertSingleUtmify(pixel.offerId, id);
  if (input.options !== undefined) data.options = cleanPixelOptions(vendor, input.options, pixelId, pixel.options);
  if (input.testEventCode !== undefined) data.testEventCode = cleanTestEventCode(vendor, input.testEventCode);
  const row = await withUniqueGuard(vendor, () =>
    prisma.pixelConfig.update({ where: { id }, data, select: PIXEL_SELECT }),
  );
  await touch(pixel.offerId);
  return toPixelView(row);
}

/** Salva, troca (token novo) ou remove (null/vazio) o token de API do pixel. */
export async function setPixelToken(id: string, token: string | null): Promise<PixelView> {
  const pixel = await pixelOrThrow(id);
  const vendor = pixel.vendor as PixelVendorId;
  const value = token?.trim() ? encryptSecret(cleanAccessToken(vendor, token)) : null;
  const row = await prisma.pixelConfig.update({ where: { id }, data: { accessTokenEnc: value }, select: PIXEL_SELECT });
  await touch(pixel.offerId);
  return toPixelView(row);
}

export async function setPixelEnabled(id: string, enabled: boolean): Promise<PixelView> {
  return updatePixel(id, { enabled });
}

export async function deletePixel(id: string): Promise<void> {
  const pixel = await pixelOrThrow(id);
  await prisma.pixelConfig.delete({ where: { id } });
  await touch(pixel.offerId);
}

/**
 * Token em texto puro, só para o gerador do eventos.php (Fase 5, no servidor).
 * Nunca chame isto de uma action nem devolva o valor para a tela.
 */
export async function readPixelTokenForServerFile(id: string): Promise<string | null> {
  const row = await prisma.pixelConfig.findUnique({ where: { id }, select: { accessTokenEnc: true } });
  if (!row?.accessTokenEnc) return null;
  const token = tryDecryptSecret(row.accessTokenEnc);
  if (token === null) throw new UserError(SECRET_UNREADABLE_MESSAGE, "accessToken");
  return token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configurações gerais (Offer.tracking)
// ─────────────────────────────────────────────────────────────────────────────

export interface TrackingSettingsPatch {
  consent?: Partial<TrackingSettings["consent"]>;
  forwarding?: Partial<TrackingSettings["forwarding"]>;
  value?: Partial<TrackingSettings["value"]>;
  /** Nomes personalizados por plataforma: cada plataforma enviada troca a lista dela inteira. */
  eventNames?: TrackingSettings["eventNames"];
  customCode?: Partial<TrackingSettings["customCode"]>;
  dismissedRecommended?: boolean;
}

export async function getTrackingSettings(offerId: string): Promise<TrackingSettings> {
  const offer = await offerOrThrow(offerId);
  return parseTrackingSettings(offer.tracking);
}

/** Mensagens claras para os limites do esquema (o resto usa a mensagem do zod em pt-BR). */
function settingsIssueMessage(path: string, code: string, fallback: string): string {
  if (path === "consent.text") return "O texto do banner pode ter no máximo 600 caracteres.";
  if (path === "consent.acceptLabel" || path === "consent.rejectLabel" || path === "consent.noticeLabel") {
    return "O texto do botão pode ter no máximo 40 caracteres.";
  }
  if (path === "consent.policyLabel") return "O texto do link pode ter no máximo 60 caracteres.";
  if (path.startsWith("consent.policyPageId")) return "Escolha a página da política de privacidade de novo.";
  if (path.startsWith("forwarding.params")) {
    return "Use no máximo 40 parâmetros, cada um com até 40 caracteres (letras, números, _ . e -).";
  }
  if (path === "forwarding.persistDays") return "Escolha de 0 a 90 dias.";
  if (path === "value.amount") return "Informe um valor entre 0 e 1.000.000.";
  if (path === "value.currency") return "Escolha a moeda.";
  if (path.startsWith("eventNames")) return "O nome personalizado do evento pode ter no máximo 60 caracteres.";
  if (path.startsWith("customCode")) return "O código livre passou do limite de 200 KB.";
  if (code === "invalid_value") return "Escolha uma das opções da lista.";
  if (code === "invalid_type") return "Algum valor está em branco ou num formato inválido. Confira e salve de novo.";
  return fallback;
}

const OFFER_CODE_LABEL: Record<(typeof PAGE_CODE_FIELDS)[number], string> = {
  head: "no <head>",
  bodyStart: "no início do <body>",
  bodyEnd: "no fim do <body>",
};

function cleanOfferCode(code: TrackingSettings["customCode"]): TrackingSettings["customCode"] {
  const out = { ...code };
  let total = 0;
  for (const field of PAGE_CODE_FIELDS) {
    out[field] = (code[field] ?? "").replace(/\r\n?/g, "\n").trim();
    total += Buffer.byteLength(out[field], "utf8");
  }
  if (total > OFFER_CODE_MAX_BYTES) {
    throw new UserError(
      "O código livre da oferta passou do limite de 200 KB. Carregue scripts grandes por um endereço (<script src=…>).",
      "customCode.head",
    );
  }
  for (const field of PAGE_CODE_FIELDS) {
    const problem = unclosedCodePart(out[field]);
    if (problem) {
      throw new UserError(
        `O código ${OFFER_CODE_LABEL[field]} tem ${problem}. Do jeito que está, ele esconderia o resto das páginas. ` +
          "Confira o final do código colado e feche o que ficou aberto.",
        `customCode.${field}`,
      );
    }
  }
  if (!(CODE_CATEGORIES as readonly string[]).includes(out.category)) {
    throw new UserError("Escolha quando o código carrega.", "customCode.category");
  }
  return out;
}

function mergeEventNames(
  current: TrackingSettings["eventNames"],
  patch: TrackingSettings["eventNames"],
): TrackingSettings["eventNames"] {
  const out: Record<string, Record<string, string>> = { ...(current as Record<string, Record<string, string>>) };
  for (const [vendor, names] of Object.entries(patch ?? {})) {
    if (!(PIXEL_VENDORS as readonly string[]).includes(vendor)) continue;
    const cleaned: Record<string, string> = {};
    for (const [event, name] of Object.entries(names ?? {})) {
      if (!(TRACKING_EVENTS as readonly string[]).includes(event)) continue;
      const text = typeof name === "string" ? name.trim() : "";
      if (!text) continue;
      if (!/^[A-Za-z0-9_ .:-]{1,60}$/.test(text)) {
        throw new UserError(
          "O nome do evento tem só letras (sem acento), números, espaço, _ . : e - (até 60 caracteres).",
          `eventNames.${vendor}.${event}`,
        );
      }
      cleaned[event] = text;
    }
    if (Object.keys(cleaned).length) out[vendor] = cleaned;
    else delete out[vendor];
  }
  return out as TrackingSettings["eventNames"];
}

/** Junta as mudanças com o que está salvo, valida tudo e grava. Devolve o resultado. */
export async function saveTrackingSettings(offerId: string, patch: TrackingSettingsPatch): Promise<TrackingSettings> {
  const offer = await offerOrThrow(offerId);
  const current = parseTrackingSettings(offer.tracking);
  const merged = {
    consent: { ...current.consent, ...(patch.consent ?? {}) },
    forwarding: { ...current.forwarding, ...(patch.forwarding ?? {}) },
    value: { ...current.value, ...(patch.value ?? {}) },
    eventNames: patch.eventNames ? mergeEventNames(current.eventNames, patch.eventNames) : current.eventNames,
    customCode: { ...current.customCode, ...(patch.customCode ?? {}) },
    dismissedRecommended: patch.dismissedRecommended ?? current.dismissedRecommended,
  };

  // Consentimento: textos dos botões e da mensagem.
  const consent = merged.consent;
  if (consent.policyPageId === "") consent.policyPageId = null;
  for (const [key, name] of [
    ["acceptLabel", "Aceitar"],
    ["rejectLabel", "Recusar"],
    ["noticeLabel", "Entendi"],
  ] as const) {
    if (typeof consent[key] === "string" && !consent[key].trim()) {
      throw new UserError(`Escreva o texto do botão “${name}”.`, `consent.${key}`);
    }
  }
  if (typeof consent.policyLabel === "string" && !consent.policyLabel.trim()) {
    throw new UserError("Escreva o texto do link da política de privacidade.", "consent.policyLabel");
  }
  if (consent.mode !== "OFF" && typeof consent.text === "string" && !consent.text.trim()) {
    throw new UserError("Escreva o texto do aviso de cookies.", "consent.text");
  }
  // null = automático; POLICY_NONE = sem link; senão, uma página desta oferta.
  if (consent.policyPageId && consent.policyPageId !== POLICY_NONE) {
    await assertPageOfOffer(offerId, consent.policyPageId, "consent.policyPageId");
  }

  // Repasse: nomes de parâmetro limpos e sem repetição.
  if (Array.isArray(merged.forwarding.params)) {
    const params: string[] = [];
    for (const raw of merged.forwarding.params) {
      const param = typeof raw === "string" ? raw.trim() : "";
      if (!param) continue;
      if (!FORWARD_PARAM_RE.test(param) || param.length > 40) {
        throw new UserError(
          `O parâmetro “${param.slice(0, 40)}” tem caracteres inválidos. Use só letras, números, _ . e -.`,
          "forwarding.params",
        );
      }
      if (!params.includes(param)) params.push(param);
    }
    merged.forwarding.params = params;
  }

  if (patch.customCode) merged.customCode = cleanOfferCode(merged.customCode);

  const parsed = TrackingSettingsSchema.safeParse(merged);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.join(".");
    throw new UserError(settingsIssueMessage(path, issue.code, issue.message), path || undefined);
  }
  // Chaves que outras fases venham a guardar no mesmo JSON continuam lá.
  const previous = isRecord(offer.tracking) ? offer.tracking : {};
  await prisma.offer.update({
    where: { id: offerId },
    data: { tracking: { ...previous, ...parsed.data } as unknown as Prisma.InputJsonObject },
  });
  return parsed.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Categoria do código livre de cada página (Page.customCode.category)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quando o código livre da página carrega: "Essencial" (sempre), "Estatística"
 * ou "Marketing" (só depois do consentimento); null = automático ("Marketing"
 * se o código tem pixel/tag de rastreamento, senão "Essencial"). Mantém head/body.
 */
export async function savePageCodeCategory(
  pageId: string,
  category: CodeCategoryId | null,
): Promise<CodeCategoryId | null> {
  if (category !== null && !(CODE_CATEGORIES as readonly string[]).includes(category)) {
    throw new UserError("Escolha quando o código carrega.", "category");
  }
  const page = await prisma.page.findFirst({
    where: { id: pageId, offer: { deletedAt: null } },
    select: { id: true, offerId: true, customCode: true },
  });
  if (!page) throw new UserError("Página não encontrada. Ela pode ter sido excluída.");
  const { category: _old, ...previous } = isRecord(page.customCode) ? page.customCode : {};
  await prisma.$transaction([
    prisma.page.update({
      where: { id: page.id },
      data: { customCode: (category ? { ...previous, category } : previous) as Prisma.InputJsonObject },
    }),
    prisma.offer.update({ where: { id: page.offerId }, data: { updatedAt: new Date() } }),
  ]);
  return category;
}

// ─────────────────────────────────────────────────────────────────────────────
// Regras de evento
// ─────────────────────────────────────────────────────────────────────────────

export interface EventRuleView {
  id: string;
  /** null = todas as páginas da oferta. */
  pageId: string | null;
  pageName: string | null;
  event: TrackingEventId;
  trigger: EventTriggerId;
  value: number | null;
  selector: string | null;
  enabled: boolean;
  createdAt: Date;
}

const RULE_SELECT = {
  id: true,
  pageId: true,
  page: { select: { name: true } },
  event: true,
  trigger: true,
  value: true,
  selector: true,
  enabled: true,
  createdAt: true,
} as const satisfies Prisma.EventRuleSelect;

type RuleRow = Prisma.EventRuleGetPayload<{ select: typeof RULE_SELECT }>;

function toRuleView(row: RuleRow): EventRuleView {
  return {
    id: row.id,
    pageId: row.pageId,
    pageName: row.page?.name ?? null,
    event: row.event as TrackingEventId,
    trigger: row.trigger as EventTriggerId,
    value: row.value,
    selector: row.selector,
    enabled: row.enabled,
    createdAt: row.createdAt,
  };
}

export async function listEventRules(offerId: string): Promise<EventRuleView[]> {
  const rows = await prisma.eventRule.findMany({
    where: { offerId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: RULE_SELECT,
  });
  return rows.map(toRuleView);
}

/** Seletor CSS usável por document.querySelector (conferido com o css-tree). */
export function checkSelector(selector: string): string | null {
  const text = selector.trim();
  if (!text) return "Escolha o elemento ou link.";
  if (text.length > 300) return "O seletor pode ter no máximo 300 caracteres.";
  if (text.includes("<")) return "Isso parece um trecho de HTML. Use um seletor CSS, como #botao-comprar ou .cta.";
  if (/^[>+~,]|[>+~,]\s*$|,\s*,/.test(text)) return "O seletor está incompleto. Confira o começo e o fim.";
  let valid = true;
  try {
    csstree.parse(text, {
      context: "selectorList",
      onParseError: () => {
        valid = false;
      },
    });
  } catch {
    valid = false;
  }
  return valid ? null : "Esse seletor CSS não é válido. Use algo como #botao-comprar, .cta ou a[href*='hotmart'].";
}

export interface EventRuleData {
  pageId?: string | null;
  event: TrackingEventId;
  trigger: EventTriggerId;
  value?: number | null;
  selector?: string | null;
  enabled?: boolean;
}

/** Valida e limpa (valor só para tempo/rolagem, seletor só para clique em elemento). */
function cleanRule(input: EventRuleData) {
  const needsValue = input.trigger === "TIME_ON_PAGE" || input.trigger === "SCROLL_DEPTH";
  const needsSelector = input.trigger === "ELEMENT_CLICK";
  const parsed = EventRuleInputSchema.safeParse({
    pageId: input.pageId ?? null,
    event: input.event,
    trigger: input.trigger,
    value: needsValue ? (input.value ?? null) : null,
    selector: needsSelector ? (input.selector?.trim() ?? null) || null : null,
    enabled: input.enabled ?? true,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue.path.join(".");
    let message = issue.message;
    if (field === "event") message = issue.code === "custom" ? issue.message : "Escolha o evento.";
    else if (field === "trigger") message = "Escolha quando o evento dispara.";
    else if (field === "value" && issue.code !== "custom") {
      message =
        input.trigger === "SCROLL_DEPTH"
          ? "Informe uma porcentagem entre 1 e 100."
          : "Informe os segundos (de 1 a 86400, ou seja, até 24 horas).";
    } else if (field === "selector" && issue.code !== "custom")
      message = "O seletor pode ter no máximo 300 caracteres.";
    throw new UserError(message, field || undefined);
  }
  const rule = parsed.data;
  if (rule.selector) {
    const problem = checkSelector(rule.selector);
    if (problem) throw new UserError(problem, "selector");
  }
  return rule;
}

async function assertNoDuplicateRule(offerId: string, rule: ReturnType<typeof cleanRule>, exceptId?: string) {
  const dup = await prisma.eventRule.count({
    where: {
      offerId,
      pageId: rule.pageId,
      event: rule.event as TrackingEvent,
      trigger: rule.trigger as EventTrigger,
      value: rule.value,
      selector: rule.selector,
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
  });
  if (dup) throw new UserError("Essa regra já existe nesta oferta.");
}

export async function createEventRule(offerId: string, input: EventRuleData): Promise<EventRuleView> {
  await offerOrThrow(offerId);
  const rule = cleanRule(input);
  if (rule.pageId) await assertPageOfOffer(offerId, rule.pageId, "pageId");
  const count = await prisma.eventRule.count({ where: { offerId } });
  if (count >= MAX_RULES_PER_OFFER) {
    throw new UserError(`Uma oferta pode ter no máximo ${MAX_RULES_PER_OFFER} regras de evento.`);
  }
  await assertNoDuplicateRule(offerId, rule);
  const row = await prisma.eventRule.create({
    data: {
      offerId,
      pageId: rule.pageId,
      event: rule.event as TrackingEvent,
      trigger: rule.trigger as EventTrigger,
      value: rule.value,
      selector: rule.selector,
      enabled: rule.enabled,
    },
    select: RULE_SELECT,
  });
  await touch(offerId);
  return toRuleView(row);
}

async function ruleOrThrow(id: string) {
  const rule = await prisma.eventRule.findFirst({
    where: { id, offer: { deletedAt: null } },
    select: {
      id: true,
      offerId: true,
      pageId: true,
      event: true,
      trigger: true,
      value: true,
      selector: true,
      enabled: true,
    },
  });
  if (!rule) throw new UserError("Regra não encontrada. Ela pode ter sido excluída.");
  return rule;
}

/** Atualiza uma regra (campos não enviados continuam como estão). */
export async function updateEventRule(id: string, input: Partial<EventRuleData>): Promise<EventRuleView> {
  const current = await ruleOrThrow(id);
  const rule = cleanRule({
    pageId: input.pageId !== undefined ? input.pageId : current.pageId,
    event: input.event ?? (current.event as TrackingEventId),
    trigger: input.trigger ?? (current.trigger as EventTriggerId),
    value: input.value !== undefined ? input.value : current.value,
    selector: input.selector !== undefined ? input.selector : current.selector,
    enabled: input.enabled ?? current.enabled,
  });
  if (rule.pageId) await assertPageOfOffer(current.offerId, rule.pageId, "pageId");
  await assertNoDuplicateRule(current.offerId, rule, id);
  const row = await prisma.eventRule.update({
    where: { id },
    data: {
      page: rule.pageId ? { connect: { id: rule.pageId } } : { disconnect: true },
      event: rule.event as TrackingEvent,
      trigger: rule.trigger as EventTrigger,
      value: rule.value,
      selector: rule.selector,
      enabled: rule.enabled,
    },
    select: RULE_SELECT,
  });
  await touch(current.offerId);
  return toRuleView(row);
}

export async function setEventRuleEnabled(id: string, enabled: boolean): Promise<EventRuleView> {
  const current = await ruleOrThrow(id);
  const row = await prisma.eventRule.update({ where: { id }, data: { enabled }, select: RULE_SELECT });
  await touch(current.offerId);
  return toRuleView(row);
}

export async function deleteEventRule(id: string): Promise<void> {
  const current = await ruleOrThrow(id);
  await prisma.eventRule.delete({ where: { id } });
  await touch(current.offerId);
}

/** Regras recomendadas que ainda faltam na oferta (para toda a oferta). */
function missingRecommended(rules: { pageId: string | null; event: string; trigger: string }[]) {
  return RECOMMENDED_RULES.filter(
    (r) => !rules.some((e) => e.pageId === null && e.event === r.event && e.trigger === r.trigger),
  );
}

/** "Não sugerir mais": a aba Eventos para de mostrar as recomendadas que faltam. */
export async function dismissRecommendedRules(offerId: string): Promise<void> {
  await saveTrackingSettings(offerId, { dismissedRecommended: true });
}

/**
 * "Usar recomendadas": ViewContent após 15 s, InitiateCheckout no clique do
 * checkout e Lead no envio de formulário, para todas as páginas. Idempotente:
 * só cria as que faltam (mesmo evento + gatilho para a oferta inteira).
 */
export async function applyRecommendedRules(offerId: string): Promise<{ created: number; rules: EventRuleView[] }> {
  await offerOrThrow(offerId);
  const existing = await prisma.eventRule.findMany({
    where: { offerId },
    select: { pageId: true, event: true, trigger: true },
  });
  const missing = missingRecommended(existing);
  if (missing.length) {
    await prisma.eventRule.createMany({
      data: missing.map((r) => ({
        offerId,
        pageId: null,
        event: r.event as TrackingEvent,
        trigger: r.trigger as EventTrigger,
        value: r.value,
        selector: r.selector,
        enabled: true,
      })),
    });
    await touch(offerId);
  }
  return { created: missing.length, rules: await listEventRules(offerId) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tela de rastreamento: tudo o que o painel precisa numa leitura
// ─────────────────────────────────────────────────────────────────────────────

export interface TrackingPanelPage {
  id: string;
  name: string;
  slug: string;
  type: string;
  isHome: boolean;
  /** Categoria que vale para o código livre da página (a escolhida ou a automática). */
  codeCategory: CodeCategoryId;
  /** A pessoa nunca escolheu: vale a automática (Marketing se o código tem rastreador). */
  codeCategoryAuto: boolean;
  /** Pixels/tags de rastreamento achados no código livre da página ("Meta Pixel"…). */
  codeTrackers: string[];
  /**
   * Hosts de <script src> que ninguém reconhece (sem rastreador conhecido no
   * código): no "Automático" o código carrega sempre, e o painel sugere
   * "Marketing" se ele rastrear os visitantes.
   */
  codeUnknownScripts: string[];
  /** A página tem código livre (head/body)? */
  hasCode: boolean;
  /**
   * Todas as versões da página têm o link "Preferências de cookies"
   * ([data-os-consent-open]). Sem ele, a página ganha o botão flutuante "Cookies".
   */
  hasConsentLink: boolean;
  /**
   * Pixels/tags no HTML da página (fora dos códigos da página): carregam antes
   * do "Aceitar". O painel pede para mover para "Códigos da página".
   */
  htmlTrackers: string[];
}

/** Regra recomendada que falta na oferta (a aba Eventos mostra só estas). */
export type RecommendedRuleView = (typeof RECOMMENDED_RULES)[number];

export interface TrackingPanelLink {
  id: string;
  key: string;
  label: string;
  kind: string;
  url: string;
}

export interface TrackingPanel {
  offer: { id: string; name: string };
  pixels: PixelView[];
  settings: TrackingSettings;
  rules: EventRuleView[];
  pages: TrackingPanelPage[];
  /** Links da oferta (para escolher um botão em "Ao clicar em um elemento"). */
  links: TrackingPanelLink[];
  /**
   * Regras recomendadas que ainda não foram criadas (vazio = o aviso some; com
   * "Não sugerir mais", só voltam se a oferta ficar sem nenhuma regra).
   */
  missingRecommended: RecommendedRuleView[];
  /** Plataformas com envio pelo servidor ligado mas sem token válido. */
  pixelsNeedingToken: number;
  /** Pixels/tags achados no código livre da oferta. */
  offerCodeTrackers: string[];
}

/** Tudo o que a tela de pixels/eventos precisa. null = oferta inexistente ou na lixeira. */
export async function getTrackingPanel(offerId: string): Promise<TrackingPanel | null> {
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, deletedAt: null },
    select: {
      id: true,
      name: true,
      tracking: true,
      pages: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, slug: true, type: true, isHome: true, customCode: true },
      },
      links: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true, key: true, label: true, kind: true, url: true },
      },
    },
  });
  if (!offer) return null;
  const docWhere = { variant: { page: { offerId } } } as const;
  const [pixels, rules, docs, docsWithLink] = await Promise.all([
    listPixels(offerId),
    listEventRules(offerId),
    // O HTML vem junto: pixel no HTML da página (mantido na clonagem, colado no editor) não espera o "Aceitar".
    prisma.pageDocument.findMany({
      where: docWhere,
      select: { html: true, variant: { select: { pageId: true } } },
    }),
    // Procura no banco (sem trazer o HTML das páginas).
    prisma.pageDocument.findMany({
      where: { ...docWhere, html: { contains: "data-os-consent-open" } },
      select: { variant: { select: { pageId: true } } },
    }),
  ]);
  const count = (list: { variant: { pageId: string } }[], pageId: string) =>
    list.filter((d) => d.variant.pageId === pageId).length;
  const pages = offer.pages.map((p) => {
    const code = isRecord(p.customCode) ? p.customCode : {};
    const text = (f: string) => (typeof code[f] === "string" ? (code[f] as string) : "");
    const resolved = resolveCodeCategoryFull(
      { head: text("head"), bodyStart: text("bodyStart"), bodyEnd: text("bodyEnd") },
      explicitPageCodeCategory(p.customCode),
    );
    const total = count(docs, p.id);
    const htmlTrackers = [
      ...new Set(docs.filter((d) => d.variant.pageId === p.id).flatMap((d) => detectHtmlTrackers(d.html ?? ""))),
    ];
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      type: p.type,
      isHome: p.isHome,
      codeCategory: resolved.category,
      codeCategoryAuto: resolved.auto,
      codeTrackers: resolved.trackers,
      codeUnknownScripts: resolved.trackers.length
        ? []
        : unknownCodeScripts(text("head"), text("bodyStart"), text("bodyEnd")),
      hasCode: PAGE_CODE_FIELDS.some((f) => !!text(f).trim()),
      hasConsentLink: total > 0 && count(docsWithLink, p.id) >= total,
      htmlTrackers,
    };
  });
  const settings = parseTrackingSettings(offer.tracking);
  return {
    offer: { id: offer.id, name: offer.name },
    pixels,
    settings,
    rules,
    pages,
    links: offer.links,
    // "Não sugerir mais" vale enquanto a oferta tem regras: sem nenhuma, as recomendadas voltam.
    missingRecommended: settings.dismissedRecommended && rules.length ? [] : missingRecommended(rules),
    pixelsNeedingToken: pixels.filter((p) => p.needsToken).length,
    offerCodeTrackers: detectAllCodeTrackers(
      settings.customCode.head,
      settings.customCode.bodyStart,
      settings.customCode.bodyEnd,
    ),
  };
}
