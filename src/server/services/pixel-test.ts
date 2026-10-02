/**
 * Tela "Testar pixels": a página abre na prévia em modo teste (pixels de
 * verdade) e o script de rastreamento conta ao servidor de prévia cada passo —
 * pixel carregado, evento disparado, bloqueado (ex.: bloqueador de anúncios).
 * O painel lê esses passos ao vivo (listPixelTestEvents).
 *
 * Sessão = 2 horas, token aleatório de 26 caracteres na URL (?os_teste=…),
 * limite de eventos por sessão e de ritmo (a página não consegue inundar o banco).
 */
import { randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { createPreviewToken, previewUrl } from "@/lib/preview";
import { PIXEL_TEST_PARAM } from "@/lib/tracking/runtime-config";
import type { PixelVendorId } from "@/lib/tracking/schema";
import {
  PIXEL_TEST_TOKEN_RE,
  type PixelTestEventRow,
  type PixelTestStatusId,
  parsePixelTestReport,
} from "@/lib/tracking/test-report";

export const PIXEL_TEST_TTL_MS = 2 * 3600_000;
export const PIXEL_TEST_MAX_EVENTS = 2000;
/** Sessões vencidas ficam mais um dia (o painel ainda mostra o resultado) e depois somem. */
export const PIXEL_TEST_KEEP_EXPIRED_MS = 24 * 3600_000;
/** Ritmo por sessão: rajada de até 120 passos, repondo 40 por segundo. */
const RATE_BURST = 120;
const RATE_PER_SECOND = 40;

/** Token em base32 minúsculo (26 caracteres, ~130 bits). */
export function newPixelTestToken(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let out = "";
  for (const b of randomBytes(26)) out += alphabet[b % 32];
  return out;
}

export interface PixelTestSessionView {
  id: string;
  offerId: string;
  pageId: string | null;
  /** Versão A/B testada (null = a de controle, ou a página tem uma versão só). */
  variantId: string | null;
  token: string;
  createdAt: Date;
  expiresAt: Date;
  /** Endereço para abrir a página em modo teste (nova aba). */
  url: string;
  /** Plataformas com pixel ligado na oferta (a tela mostra uma linha para cada). */
  vendors: PixelVendorId[];
}

/**
 * Começa um teste: cria a sessão e um link de prévia só para ela (origem
 * própria, com o modo teste guardado num cookie ao navegar pelo funil).
 * `variantId` (opcional, com a página): testa essa versão A/B em vez da de
 * controle — também nos links do funil que voltam para a mesma página.
 */
export async function createPixelTestSession(
  offerId: string,
  pageId?: string | null,
  variantId?: string | null,
): Promise<PixelTestSessionView> {
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, deletedAt: null },
    select: {
      id: true,
      pixels: { where: { enabled: true }, select: { vendor: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!offer) throw new UserError("Oferta não encontrada. Ela pode ter sido excluída.");
  if (!offer.pixels.length) {
    throw new UserError("Nenhum pixel ligado nesta oferta. Cadastre ou ligue um pixel para testar.");
  }
  if (pageId) {
    const page = await prisma.page.count({ where: { id: pageId, offerId } });
    if (!page) throw new UserError("Essa página não faz parte desta oferta.", "pageId");
  }
  if (variantId) {
    if (!pageId) throw new UserError("Escolha a página da versão que você quer testar.", "pageId");
    const variant = await prisma.pageVariant.count({ where: { id: variantId, pageId } });
    if (!variant) throw new UserError("Essa versão não faz parte desta página.", "variantId");
  }
  void cleanupPixelTestSessions().catch(() => {});

  const token = newPixelTestToken();
  const expiresAt = new Date(Date.now() + PIXEL_TEST_TTL_MS);
  const session = await prisma.pixelTestSession.create({
    data: { offerId, pageId: pageId ?? null, token, expiresAt },
    select: { id: true, offerId: true, pageId: true, token: true, createdAt: true, expiresAt: true },
  });
  const preview = await createPreviewToken(
    { kind: "offer", offerId, ...(pageId ? { pageId } : {}), ...(variantId ? { variantId } : {}) },
    PIXEL_TEST_TTL_MS / 3600_000,
  );
  return {
    ...session,
    variantId: variantId || null,
    url: previewUrl(preview, `/?${PIXEL_TEST_PARAM}=${token}`),
    vendors: [...new Set(offer.pixels.map((p) => p.vendor as PixelVendorId))],
  };
}

/**
 * Sessão válida para mostrar a oferta em modo teste (servidor de prévia):
 * existe, é desta oferta e não venceu. null nos outros casos.
 */
export async function findActivePixelTestSession(token: string, offerId: string) {
  if (!PIXEL_TEST_TOKEN_RE.test(token)) return null;
  const session = await prisma.pixelTestSession.findUnique({
    where: { token },
    select: { id: true, offerId: true, pageId: true, token: true, expiresAt: true },
  });
  if (!session || session.offerId !== offerId || session.expiresAt <= new Date()) return null;
  return session;
}

// ─── Ritmo (em memória, por processo do servidor de prévia) ─────────────────

const buckets = new Map<string, { tokens: number; at: number }>();

function takeRateToken(key: string, now = Date.now()): boolean {
  const bucket = buckets.get(key) ?? { tokens: RATE_BURST, at: now };
  bucket.tokens = Math.min(RATE_BURST, bucket.tokens + ((now - bucket.at) / 1000) * RATE_PER_SECOND);
  bucket.at = now;
  buckets.set(key, bucket);
  if (buckets.size > 1000) {
    // Sessões antigas: descarta as que já se recuperaram por completo.
    for (const [k, b] of buckets) if (now - b.at > 60_000) buckets.delete(k);
  }
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** Só para os testes: zera o controle de ritmo. */
export function resetPixelTestRateLimit() {
  buckets.clear();
}

export type PixelTestFailure = "invalid" | "not-found" | "wrong-offer" | "expired" | "limit" | "rate-limited";
export type PixelTestRecordResult = { ok: true; id: number } | { ok: false; reason: PixelTestFailure };

/** Status HTTP de cada recusa (servidor de prévia). */
export const PIXEL_TEST_HTTP_STATUS: Record<PixelTestFailure, number> = {
  invalid: 400,
  "not-found": 404,
  "wrong-offer": 403,
  expired: 410,
  limit: 429,
  "rate-limited": 429,
};

/**
 * Registra um passo mandado pela página em modo teste. `offerId` é a oferta da
 * prévia que recebeu o pedido (a sessão tem de ser dela).
 */
export async function recordPixelTestEvent(input: unknown, ctx: { offerId: string }): Promise<PixelTestRecordResult> {
  const report = parsePixelTestReport(input);
  if (!report) return { ok: false, reason: "invalid" };
  const session = await prisma.pixelTestSession.findUnique({
    where: { token: report.token },
    select: { id: true, offerId: true, expiresAt: true },
  });
  if (!session) return { ok: false, reason: "not-found" };
  if (session.offerId !== ctx.offerId) return { ok: false, reason: "wrong-offer" };
  const now = new Date();
  if (session.expiresAt <= now) return { ok: false, reason: "expired" };
  if (!takeRateToken(session.id)) return { ok: false, reason: "rate-limited" };
  // Reserva uma vaga de forma atômica (duas abas ao mesmo tempo não passam do limite).
  const reserved = await prisma.pixelTestSession.updateMany({
    where: { id: session.id, eventCount: { lt: PIXEL_TEST_MAX_EVENTS }, expiresAt: { gt: now } },
    data: { eventCount: { increment: 1 } },
  });
  if (!reserved.count) return { ok: false, reason: "limit" };
  const event = await prisma.pixelTestEvent.create({
    data: {
      sessionId: session.id,
      vendor: report.vendor,
      event: report.event,
      status: report.status,
      detail: (report.detail ?? {}) as Prisma.InputJsonObject,
    },
    select: { id: true },
  });
  return { ok: true, id: event.id };
}

export interface PixelTestEventsPage {
  session: {
    id: string;
    offerId: string;
    pageId: string | null;
    expiresAt: Date;
    expired: boolean;
    eventCount: number;
    /** Chegou ao limite de eventos: os próximos não aparecem. */
    full: boolean;
  };
  /** Passos novos (id maior que `afterId`), do mais antigo para o mais novo. */
  events: PixelTestEventRow[];
  /** Último id devolvido (mande de volta como `afterId`). */
  lastId: number;
}

/** Passos recebidos desde `afterId` (o painel chama a cada segundo). */
export async function listPixelTestEvents(sessionId: string, afterId = 0, limit = 200): Promise<PixelTestEventsPage> {
  const session = await prisma.pixelTestSession.findFirst({
    where: { id: sessionId, offer: { deletedAt: null } },
    select: { id: true, offerId: true, pageId: true, expiresAt: true, eventCount: true },
  });
  if (!session) throw new UserError("Este teste não existe mais. Comece um novo teste.");
  const rows = await prisma.pixelTestEvent.findMany({
    where: { sessionId, id: { gt: Math.max(0, Math.floor(afterId)) } },
    orderBy: { id: "asc" },
    take: Math.min(Math.max(1, Math.floor(limit)), 500),
    select: { id: true, at: true, vendor: true, event: true, status: true, detail: true },
  });
  const events = rows.map((r) => ({ ...r, status: r.status as PixelTestStatusId }));
  return {
    session: {
      ...session,
      expired: session.expiresAt <= new Date(),
      full: session.eventCount >= PIXEL_TEST_MAX_EVENTS,
    },
    events,
    lastId: events.at(-1)?.id ?? Math.max(0, Math.floor(afterId)),
  };
}

/** Encerra o teste agora (o link para de aceitar passos novos). */
export async function endPixelTestSession(sessionId: string): Promise<void> {
  const now = new Date();
  await prisma.pixelTestSession.updateMany({
    where: { id: sessionId, expiresAt: { gt: now } },
    data: { expiresAt: now },
  });
}

/** Apaga sessões vencidas há mais de um dia (com os passos). Devolve quantas. */
export async function cleanupPixelTestSessions(now = new Date()): Promise<number> {
  const { count } = await prisma.pixelTestSession.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - PIXEL_TEST_KEEP_EXPIRED_MS) } },
  });
  return count;
}
