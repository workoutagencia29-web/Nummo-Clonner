"use server";

/**
 * Ações da tela de pixels e eventos (Fase 4). Todas exigem login, validam a
 * entrada com zod (mensagens em português) e devolvem { ok, data | error, field }.
 * Os dados da tela vêm de getTrackingPanel (src/server/services/tracking.ts),
 * chamado pelo componente de servidor da página.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  CODE_CATEGORIES,
  CONSENT_MODES,
  CONSENT_POSITIONS,
  CONSENT_THEMES,
  CURRENCIES,
  EVENT_TRIGGERS,
  PIXEL_VENDORS,
  TRACKING_EVENTS,
} from "@/lib/tracking/schema";
import { protectedAction } from "@/server/action";
import * as pixelTest from "@/server/services/pixel-test";
import * as tracking from "@/server/services/tracking";

const id = z.string().min(1, "Item inválido.").max(40, "Item inválido.");
const offerId = z.string().min(1, "Oferta inválida.").max(40, "Oferta inválida.");
const pageId = z.string().min(1, "Página inválida.").max(40, "Página inválida.");
const variantId = z.string().min(1, "Versão inválida.").max(40, "Versão inválida.");
const vendor = z.enum(PIXEL_VENDORS, { error: "Escolha a plataforma." });
const pixelIdText = z.string({ error: "Informe o ID do pixel." }).max(5000, "Cole só o ID do pixel.");
const label = z.string().max(200, "O apelido do pixel pode ter no máximo 60 caracteres.").nullable();
const token = z.string().max(5000, "Esse token é longo demais. Copie só o token.");
const testEventCode = z.string().max(200, "O código de teste tem só letras e números (ex.: TEST12345).").nullable();
/** Opções por plataforma: validadas por completo no serviço (VENDOR_OPTIONS_SCHEMA). */
const options = z.record(z.string(), z.unknown());

function refresh() {
  revalidatePath("/", "layout");
}

// ─── Pixels ─────────────────────────────────────────────────────────────────

export const createPixelAction = protectedAction(
  z.object({
    offerId,
    vendor,
    pixelId: pixelIdText,
    label: label.optional(),
    enabled: z.boolean().optional(),
    options: options.optional(),
    accessToken: token.nullable().optional(),
    testEventCode: testEventCode.optional(),
  }),
  async ({ offerId, ...input }) => {
    const pixel = await tracking.createPixel(offerId, input);
    refresh();
    return pixel;
  },
);

export const updatePixelAction = protectedAction(
  z.object({
    id,
    pixelId: pixelIdText.optional(),
    label: label.optional(),
    enabled: z.boolean().optional(),
    options: options.optional(),
    testEventCode: testEventCode.optional(),
  }),
  async ({ id, ...input }) => {
    const pixel = await tracking.updatePixel(id, input);
    refresh();
    return pixel;
  },
);

/** Salva ou troca o token de API (API de Conversões / Events API). */
export const setPixelTokenAction = protectedAction(
  z.object({ id, token: token.min(1, "Cole o token.") }),
  async ({ id, token }) => {
    const pixel = await tracking.setPixelToken(id, token);
    refresh();
    return pixel;
  },
);

export const removePixelTokenAction = protectedAction(z.object({ id }), async ({ id }) => {
  const pixel = await tracking.setPixelToken(id, null);
  refresh();
  return pixel;
});

export const setPixelEnabledAction = protectedAction(z.object({ id, enabled: z.boolean() }), async (input) => {
  const pixel = await tracking.setPixelEnabled(input.id, input.enabled);
  refresh();
  return pixel;
});

export const deletePixelAction = protectedAction(z.object({ id }), async ({ id }) => {
  await tracking.deletePixel(id);
  refresh();
});

// ─── Configurações gerais (consentimento, repasse, valor, nomes, código) ─────

const text = (max: number) => z.string().max(max * 2, `Pode ter no máximo ${max} caracteres.`);

export const saveTrackingSettingsAction = protectedAction(
  z.object({
    offerId,
    consent: z
      .object({
        mode: z.enum(CONSENT_MODES),
        text: text(600),
        acceptLabel: text(40),
        rejectLabel: text(40),
        noticeLabel: text(40),
        policyLabel: text(60),
        policyPageId: z.string().max(40).nullable(),
        position: z.enum(CONSENT_POSITIONS),
        theme: z.enum(CONSENT_THEMES),
      })
      .partial()
      .optional(),
    forwarding: z
      .object({
        enabled: z.boolean(),
        params: z.array(z.string().max(200)).max(200, "Use no máximo 40 parâmetros."),
        toCheckout: z.boolean(),
        toInternalLinks: z.boolean(),
        persistDays: z.number({ error: "Escolha de 0 a 90 dias." }),
      })
      .partial()
      .optional(),
    value: z
      .object({
        currency: z.enum(CURRENCIES),
        amount: z.number({ error: "Informe um valor em números." }).nullable(),
      })
      .partial()
      .optional(),
    eventNames: z
      .partialRecord(z.enum(PIXEL_VENDORS), z.partialRecord(z.enum(TRACKING_EVENTS), z.string().max(200)))
      .optional(),
    customCode: z
      .object({
        head: z.string().max(400_000, "O código passou do limite de 200 KB."),
        bodyStart: z.string().max(400_000, "O código passou do limite de 200 KB."),
        bodyEnd: z.string().max(400_000, "O código passou do limite de 200 KB."),
        category: z.enum(CODE_CATEGORIES),
      })
      .partial()
      .optional(),
  }),
  async ({ offerId, ...patch }) => {
    const settings = await tracking.saveTrackingSettings(offerId, patch);
    refresh();
    return settings;
  },
);

/** Quando o código livre de uma página carrega (Essencial / Estatística / Marketing). */
export const savePageCodeCategoryAction = protectedAction(
  z.object({ pageId, category: z.enum(CODE_CATEGORIES, { error: "Escolha quando o código carrega." }) }),
  async ({ pageId, category }) => {
    const saved = await tracking.savePageCodeCategory(pageId, category);
    refresh();
    return saved;
  },
);

// ─── Regras de evento ───────────────────────────────────────────────────────

const ruleFields = {
  pageId: pageId.nullable(),
  event: z.enum(TRACKING_EVENTS, { error: "Escolha o evento." }),
  trigger: z.enum(EVENT_TRIGGERS, { error: "Escolha quando o evento dispara." }),
  value: z.number({ error: "Informe um número." }).int("Use um número inteiro.").nullable(),
  selector: z.string().max(1000, "O seletor pode ter no máximo 300 caracteres.").nullable(),
  enabled: z.boolean(),
};

export const createEventRuleAction = protectedAction(
  z.object({
    offerId,
    pageId: ruleFields.pageId.optional(),
    event: ruleFields.event,
    trigger: ruleFields.trigger,
    value: ruleFields.value.optional(),
    selector: ruleFields.selector.optional(),
    enabled: ruleFields.enabled.optional(),
  }),
  async ({ offerId, ...input }) => {
    const rule = await tracking.createEventRule(offerId, input);
    refresh();
    return rule;
  },
);

export const updateEventRuleAction = protectedAction(
  z
    .object({ id, ...ruleFields })
    .partial()
    .required({ id: true }),
  async ({ id, ...input }) => {
    const rule = await tracking.updateEventRule(id, input);
    refresh();
    return rule;
  },
);

export const setEventRuleEnabledAction = protectedAction(z.object({ id, enabled: z.boolean() }), async (input) => {
  const rule = await tracking.setEventRuleEnabled(input.id, input.enabled);
  refresh();
  return rule;
});

export const deleteEventRuleAction = protectedAction(z.object({ id }), async ({ id }) => {
  await tracking.deleteEventRule(id);
  refresh();
});

/** "Usar recomendadas" (idempotente: só cria as que faltam). */
export const applyRecommendedRulesAction = protectedAction(z.object({ offerId }), async ({ offerId }) => {
  const result = await tracking.applyRecommendedRules(offerId);
  refresh();
  return result;
});

/** "Não sugerir mais" as regras recomendadas que faltam. */
export const dismissRecommendedRulesAction = protectedAction(z.object({ offerId }), async ({ offerId }) => {
  await tracking.dismissRecommendedRules(offerId);
  refresh();
});

// ─── Testar pixels ──────────────────────────────────────────────────────────

/** Começa um teste: devolve a sessão e o `url` para abrir numa aba nova. */
export const createPixelTestSessionAction = protectedAction(
  z.object({ offerId, pageId: pageId.nullable().optional(), variantId: variantId.nullable().optional() }),
  ({ offerId, pageId, variantId }) => pixelTest.createPixelTestSession(offerId, pageId, variantId),
);

/** Passos recebidos desde `afterId` (chame a cada ~1 s enquanto a tela estiver aberta). */
export const listPixelTestEventsAction = protectedAction(
  z.object({ sessionId: id, afterId: z.number().int().min(0).default(0) }),
  ({ sessionId, afterId }) => pixelTest.listPixelTestEvents(sessionId, afterId),
);

export const endPixelTestSessionAction = protectedAction(z.object({ sessionId: id }), ({ sessionId }) =>
  pixelTest.endPixelTestSession(sessionId),
);
