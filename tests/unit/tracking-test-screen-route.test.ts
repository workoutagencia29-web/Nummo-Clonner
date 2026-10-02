/**
 * Fase 4 — tela "Testar pixels": rota GET /api/pixel-test/<sessão>?after=<id>
 * chamada direto (sem servidor), com a sessão do painel simulada, e os dados da
 * tela montados a partir do painel de rastreamento (sem nada secreto).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, listSpy } = vi.hoisted(() => ({ getSession: vi.fn(), listSpy: { fail: null as Error | null } }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/server/services/pixel-test", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/services/pixel-test")>();
  return {
    ...real,
    listPixelTestEvents: (...args: Parameters<typeof real.listPixelTestEvents>) => {
      if (listSpy.fail) return Promise.reject(listSpy.fail);
      return real.listPixelTestEvents(...args);
    },
  };
});

import { GET } from "@/app/api/pixel-test/[sessionId]/route";
import { buildTestSetup, type PixelTestPollResponse } from "@/components/offers/pixel-test/logic";
import { prisma } from "@/lib/db";
import { createOffer, trashOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import {
  createPixelTestSession,
  endPixelTestSession,
  recordPixelTestEvent,
  resetPixelTestRateLimit,
} from "@/server/services/pixel-test";
import {
  createEventRule,
  createPixel,
  getTrackingPanel,
  saveTrackingSettings,
  setEventRuleEnabled,
} from "@/server/services/tracking";
import { resetDatabase } from "../setup/per-file";

const HOST = `localhost:${process.env.PORT || "3000"}`;
const META_TOKEN = "EAAGm0PX4ZCpsBAKZCZBy1234567890abcdefghijklmnopqrstuvwxyz";

beforeEach(async () => {
  await resetDatabase();
  resetPixelTestRateLimit();
  listSpy.fail = null;
  getSession.mockReset();
  getSession.mockResolvedValue({ user: { id: "u1" }, session: { id: "s1" } });
});

function get(sessionId: string, query = "", host = HOST) {
  return GET(
    new Request(`http://${host}/api/pixel-test/${encodeURIComponent(sessionId)}${query}`, { headers: { host } }),
    {
      params: Promise.resolve({ sessionId }),
    },
  );
}

async function startedTest() {
  const offer = await createOffer({ name: "Oferta com pixel" });
  await createPixel(offer.id, { vendor: "META", pixelId: "123456789012345" });
  const session = await createPixelTestSession(offer.id);
  const report = (event: string, status: string, detail: Record<string, unknown> = {}) =>
    recordPixelTestEvent({ token: session.token, vendor: "META", event, status, detail }, { offerId: offer.id });
  return { offerId: offer.id, session, report };
}

describe("GET /api/pixel-test/[sessionId]", () => {
  it("exige o endereço do painel e login", async () => {
    const { session } = await startedTest();
    const wrongHost = await get(session.id, "", "mal.example:3000");
    expect(wrongHost.status).toBe(403);
    expect(await wrongHost.json()).toEqual({ error: "Endereço não permitido." });

    getSession.mockResolvedValue(null);
    const noLogin = await get(session.id);
    expect(noLogin.status).toBe(401);
    expect(await noLogin.json()).toEqual({ error: "Sua sessão expirou. Entre de novo." });
  });

  it("devolve os passos novos desde `after`, com a situação da sessão (sem cache)", async () => {
    const { session, report } = await startedTest();
    const empty = await get(session.id);
    expect(empty.status).toBe(200);
    expect(empty.headers.get("cache-control")).toBe("no-store");
    const first = (await empty.json()) as PixelTestPollResponse;
    expect(first.events).toEqual([]);
    expect(first.lastId).toBe(0);
    expect(first.session).toMatchObject({ id: session.id, expired: false, eventCount: 0, full: false });
    expect(new Date(first.session.expiresAt).getTime()).toBe(session.expiresAt.getTime());

    expect(await report("load", "LOADED", { pixel: "123456789012345" })).toMatchObject({ ok: true });
    expect(await report("PageView", "FIRED", { event: "PAGE_VIEW" })).toMatchObject({ ok: true });
    const page = (await (await get(session.id, "?after=0")).json()) as PixelTestPollResponse;
    expect(page.events.map((e) => [e.vendor, e.event, e.status])).toEqual([
      ["META", "load", "LOADED"],
      ["META", "PageView", "FIRED"],
    ]);
    expect(page.events[1].detail).toEqual({ event: "PAGE_VIEW" });
    expect(typeof page.events[0].at).toBe("string");
    expect(page.lastId).toBe(page.events[1].id);
    expect(page.session.eventCount).toBe(2);

    // Só o que chegou depois.
    const none = (await (await get(session.id, `?after=${page.lastId}`)).json()) as PixelTestPollResponse;
    expect(none.events).toEqual([]);
    expect(none.lastId).toBe(page.lastId);
    await report("InitiateCheckout", "FIRED", { event: "INITIATE_CHECKOUT" });
    const next = (await (await get(session.id, `?after=${page.lastId}`)).json()) as PixelTestPollResponse;
    expect(next.events.map((e) => e.event)).toEqual(["InitiateCheckout"]);
  });

  it("teste encerrado: continua lendo o resultado, com expired = true", async () => {
    const { session, report } = await startedTest();
    await report("PageView", "FIRED");
    await endPixelTestSession(session.id);
    const res = await get(session.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PixelTestPollResponse;
    expect(body.session.expired).toBe(true);
    expect(body.events).toHaveLength(1);
  });

  it("teste que não existe (ou oferta na lixeira) → 404 em português", async () => {
    const missing = await get("cnaoexiste000000000000000");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Este teste não existe mais. Comece um novo teste." });

    const weird = await get("../../etc");
    expect(weird.status).toBe(404);

    const { offerId, session } = await startedTest();
    await trashOffer(offerId);
    const trashed = await get(session.id);
    expect(trashed.status).toBe(404);
    expect(((await trashed.json()) as { error: string }).error).toMatch(/não existe mais/);
  });

  it("`after` inválido → 400; vazio vale 0", async () => {
    const { session } = await startedTest();
    for (const q of ["?after=-1", "?after=abc", "?after=1.5", "?after=1e3"]) {
      const res = await get(session.id, q);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Parâmetro inválido." });
    }
    expect((await get(session.id, "?after=")).status).toBe(200);
  });

  it("falha inesperada → 500 com mensagem em português (sem detalhe técnico)", async () => {
    const { session } = await startedTest();
    listSpy.fail = new Error("connection terminated unexpectedly");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get(session.id);
    spy.mockRestore();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Algo deu errado. Tente de novo em alguns segundos.");
    expect(JSON.stringify(body)).not.toContain("connection");
  });
});

describe("buildTestSetup (dados da tela)", () => {
  it("só pixels e regras ligados, rótulos do Google Ads, nada de token", async () => {
    const offer = await createOffer({ name: "Oferta completa" });
    const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
    const thanks = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
    await createPixel(offer.id, {
      vendor: "META",
      pixelId: "123456789012345",
      accessToken: META_TOKEN,
      options: { capi: true },
    });
    await createPixel(offer.id, { vendor: "TIKTOK", pixelId: "C1ABCDEFGHIJ2KLMNOPQ", enabled: false });
    await createPixel(offer.id, {
      vendor: "GOOGLE_ADS",
      pixelId: "AW-123456789",
      options: { conversionLabels: { LEAD: "rotuloLead" } },
    });
    await createEventRule(offer.id, { event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK" });
    const off = await createEventRule(offer.id, { event: "LEAD", trigger: "FORM_SUBMIT" });
    await setEventRuleEnabled(off.id, false);
    await createEventRule(offer.id, { pageId: thanks.id, event: "PURCHASE", trigger: "PAGE_LOAD" });
    await saveTrackingSettings(offer.id, { consent: { mode: "NOTICE" }, eventNames: { META: { LEAD: "Cadastro" } } });

    const panel = await getTrackingPanel(offer.id);
    if (!panel) throw new Error("painel vazio");
    const setup = buildTestSetup(panel);
    expect(setup).toMatchObject({
      offerId: offer.id,
      offerName: "Oferta completa",
      disabledPixels: 1,
      consentMode: "NOTICE",
      eventNames: { META: { LEAD: "Cadastro" } },
    });
    expect(setup.pages).toEqual([
      { id: home.id, name: home.name, isHome: true },
      { id: thanks.id, name: "Obrigado", isHome: false },
    ]);
    expect(setup.pixels.map((p) => [p.vendor, p.pixelId, p.conversionLabels])).toEqual([
      ["META", "123456789012345", {}],
      ["GOOGLE_ADS", "AW-123456789", { LEAD: "rotuloLead" }],
    ]);
    expect(setup.rules).toEqual([
      { pageId: null, event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK", value: null, selector: null },
      { pageId: thanks.id, event: "PURCHASE", trigger: "PAGE_LOAD", value: null, selector: null },
    ]);
    const json = JSON.stringify(setup);
    expect(json).not.toContain(META_TOKEN);
    expect(json).not.toMatch(/token|hint|accessToken/i);
  });
});
