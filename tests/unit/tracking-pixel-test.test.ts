/**
 * Fase 4 — sessões da tela "Testar pixels" (src/server/services/pixel-test.ts).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resolvePreviewToken } from "@/lib/preview";
import { createOffer } from "@/server/services/offers";
import {
  cleanupPixelTestSessions,
  createPixelTestSession,
  endPixelTestSession,
  findActivePixelTestSession,
  listPixelTestEvents,
  PIXEL_TEST_MAX_EVENTS,
  PIXEL_TEST_TTL_MS,
  recordPixelTestEvent,
  resetPixelTestRateLimit,
} from "@/server/services/pixel-test";
import { createPixel, setPixelEnabled } from "@/server/services/tracking";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";

async function offerWithPixel() {
  const offer = await createOffer({ name: "Oferta" });
  const page = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
  await createPixel(offer.id, { vendor: "META", pixelId: "123456789012345" });
  await createPixel(offer.id, { vendor: "GA4", pixelId: "G-ABC123DEF4" });
  return { offerId: offer.id, pageId: page.id };
}

const report = (token: string, extra: Record<string, unknown> = {}) => ({
  token,
  vendor: "META",
  event: "PageView",
  status: "FIRED",
  detail: { id: "123456789012345" },
  ...extra,
});

beforeEach(async () => {
  await resetDatabase();
  resetPixelTestRateLimit();
});

describe("createPixelTestSession", () => {
  it("cria sessão de 2 h com token de 26 caracteres e link de prévia em modo teste", async () => {
    const { offerId, pageId } = await offerWithPixel();
    const before = Date.now();
    const session = await createPixelTestSession(offerId, pageId);
    expect(session.token).toMatch(/^[a-z2-7]{26}$/);
    expect(session.expiresAt.getTime() - before).toBeGreaterThanOrEqual(PIXEL_TEST_TTL_MS - 1000);
    expect(session.expiresAt.getTime() - before).toBeLessThanOrEqual(PIXEL_TEST_TTL_MS + 5000);
    expect(session.vendors).toEqual(["META", "GA4"]);
    const url = new URL(session.url);
    expect(url.hostname).toMatch(/^[a-z2-7]{26}\.localhost$/);
    expect(url.searchParams.get("os_teste")).toBe(session.token);
    const target = await resolvePreviewToken(url.hostname.split(".")[0]);
    expect(target).toEqual({ kind: "offer", offerId, pageId });
    expect((await createPixelTestSession(offerId)).token).not.toBe(session.token);
  });

  it("recusa oferta sem pixel ligado e página de outra oferta", async () => {
    const { offerId } = await offerWithPixel();
    const other = await createOffer({ name: "Outra" });
    const otherPage = await prisma.page.findFirstOrThrow({ where: { offerId: other.id } });
    await expectUserError(createPixelTestSession(other.id), /Nenhum pixel ligado/);
    await expectUserError(createPixelTestSession(offerId, otherPage.id), /não faz parte desta oferta/, "pageId");
    for (const p of await prisma.pixelConfig.findMany({ where: { offerId } })) await setPixelEnabled(p.id, false);
    await expectUserError(createPixelTestSession(offerId), /Nenhum pixel ligado/);
    await expectUserError(createPixelTestSession("nao-existe"), /Oferta não encontrada/);
  });
});

describe("recordPixelTestEvent / listPixelTestEvents", () => {
  it("grava passos válidos e lista a partir de um id", async () => {
    const { offerId } = await offerWithPixel();
    const s = await createPixelTestSession(offerId);
    const a = await recordPixelTestEvent(report(s.token, { event: "load", status: "LOADED" }), { offerId });
    const b = await recordPixelTestEvent(report(s.token), { offerId });
    const c = await recordPixelTestEvent(report(s.token, { vendor: "GA4", event: "page_view", status: "BLOCKED" }), {
      offerId,
    });
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);

    const all = await listPixelTestEvents(s.id);
    expect(all.events.map((e) => [e.vendor, e.event, e.status])).toEqual([
      ["META", "load", "LOADED"],
      ["META", "PageView", "FIRED"],
      ["GA4", "page_view", "BLOCKED"],
    ]);
    expect(all.events[1].detail).toEqual({ id: "123456789012345" });
    expect(all.session).toMatchObject({ offerId, expired: false, eventCount: 3, full: false });
    const later = await listPixelTestEvents(s.id, all.events[1].id);
    expect(later.events.map((e) => e.event)).toEqual(["page_view"]);
    expect(later.lastId).toBe(all.events[2].id);
    const none = await listPixelTestEvents(s.id, all.lastId);
    expect(none.events).toEqual([]);
    expect(none.lastId).toBe(all.lastId);
    await expectUserError(listPixelTestEvents("nao-existe"), /Este teste não existe mais/);
  });

  it("recusa formato inválido, outra oferta, token desconhecido e sessão vencida", async () => {
    const { offerId } = await offerWithPixel();
    const s = await createPixelTestSession(offerId);
    const other = await createOffer({ name: "Outra" });
    expect(await recordPixelTestEvent({ nada: 1 }, { offerId })).toEqual({ ok: false, reason: "invalid" });
    expect(await recordPixelTestEvent(report(s.token, { status: "OK" }), { offerId })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await recordPixelTestEvent(report("abcdefghijklmnopqrstuvwxyz"), { offerId })).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await recordPixelTestEvent(report(s.token), { offerId: other.id })).toEqual({
      ok: false,
      reason: "wrong-offer",
    });
    await endPixelTestSession(s.id);
    expect(await recordPixelTestEvent(report(s.token), { offerId })).toEqual({ ok: false, reason: "expired" });
    expect((await listPixelTestEvents(s.id)).session.expired).toBe(true);
    expect(await prisma.pixelTestEvent.count()).toBe(0);
  });

  it("limite de eventos por sessão (atômico) e de ritmo", async () => {
    const { offerId } = await offerWithPixel();
    const s = await createPixelTestSession(offerId);
    await prisma.pixelTestSession.update({ where: { id: s.id }, data: { eventCount: PIXEL_TEST_MAX_EVENTS - 2 } });
    const results = await Promise.all([1, 2, 3, 4].map(() => recordPixelTestEvent(report(s.token), { offerId })));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, reason: "limit" },
      { ok: false, reason: "limit" },
    ]);
    expect((await listPixelTestEvents(s.id)).session.full).toBe(true);

    // Ritmo: uma rajada grande de uma vez é cortada.
    const t = await createPixelTestSession(offerId);
    const burst = [];
    for (let i = 0; i < 160; i++) burst.push(await recordPixelTestEvent(report(t.token), { offerId }));
    expect(burst.filter((r) => !r.ok && r.reason === "rate-limited").length).toBeGreaterThan(20);
    expect(burst.slice(0, 100).every((r) => r.ok)).toBe(true);
  });
});

describe("findActivePixelTestSession / limpeza", () => {
  it("só vale para a oferta dela e enquanto não vence; limpeza apaga as vencidas há mais de um dia", async () => {
    const { offerId } = await offerWithPixel();
    const other = await createOffer({ name: "Outra" });
    const s = await createPixelTestSession(offerId);
    expect(await findActivePixelTestSession(s.token, offerId)).toMatchObject({ id: s.id });
    expect(await findActivePixelTestSession(s.token, other.id)).toBeNull();
    expect(await findActivePixelTestSession("CURTO", offerId)).toBeNull();

    const old = await createPixelTestSession(offerId);
    const recent = await createPixelTestSession(offerId);
    await recordPixelTestEvent(report(old.token), { offerId });
    await prisma.pixelTestSession.update({
      where: { id: old.id },
      data: { expiresAt: new Date(Date.now() - 25 * 3600_000) },
    });
    // Vencida agora: ainda aparece no painel por um dia.
    await endPixelTestSession(recent.id);
    expect(await findActivePixelTestSession(recent.token, offerId)).toBeNull();

    expect(await cleanupPixelTestSessions()).toBe(1);
    const left = await prisma.pixelTestSession.findMany({ select: { id: true } });
    expect(left.map((x) => x.id).sort()).toEqual([s.id, recent.id].sort());
    expect(await prisma.pixelTestEvent.count()).toBe(0);

    // Começar um teste novo também limpa as antigas (sem esperar).
    await prisma.pixelTestSession.update({
      where: { id: recent.id },
      data: { expiresAt: new Date(Date.now() - 25 * 3600_000) },
    });
    await createPixelTestSession(offerId);
    await expect.poll(() => prisma.pixelTestSession.count({ where: { id: recent.id } })).toBe(0);
  });
});
