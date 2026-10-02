/**
 * Fase 5, correção 4 — "Testar pixels" de uma versão A/B e os links do funil na
 * prévia de uma versão:
 *
 * - createPixelTestSession(offerId, pageId, variantId): confere a versão e a põe
 *   no token da prévia (antes, o teste era sempre o da versão de controle);
 * - createPixelTestSessionAction aceita a versão (mensagens em português);
 * - servidor de prévia de verdade (porta livre, banco de testes): um link
 *   `/p/<mesma página>` continua na versão; as outras páginas abrem na de
 *   controle. Ponta a ponta no Chromium: link do teste → B, funil e volta → B;
 * - versões de cada página para a tela (offerVariantChoices + buildTestSetup) e
 *   as regras puras da tela (versão escolhida, rótulo, pedido, sessão guardada).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { request } from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  buildTestSetup,
  chosenVariantId,
  pageVariants,
  pixelTestStartInput,
  readStoredSession,
  type TestPage,
  type TestVariant,
  toStoredSession,
  variantChoiceLabel,
} from "@/components/offers/pixel-test/logic";
import { prisma } from "@/lib/db";
import { createPreviewToken, resolvePreviewToken } from "@/lib/preview";
import { createPixelTestSessionAction } from "@/server/actions/tracking";
import { createOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { createPixelTestSession } from "@/server/services/pixel-test";
import { createPixel, getTrackingPanel } from "@/server/services/tracking";
import {
  createVariant,
  deleteVariant,
  offerVariantChoices,
  renameVariant,
  setControlVariant,
} from "@/server/services/variants";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";

const ROOT = path.resolve(import.meta.dirname, "../..");

beforeEach(async () => {
  await resetDatabase();
});

// ─── Dados ───────────────────────────────────────────────────────────────────

const pageHtml = (title: string, body: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body><h1 id="versao">${title}</h1>${body}</body></html>`;

/** Página inicial com as versões A (controle) e B, uma página "Obrigado" e o pixel da Meta. */
async function abOffer() {
  const offer = await createOffer({ name: "Oferta A/B" });
  const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
  const obrigado = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
  const links = `<a id="mesma" href="os-page:${home.id}">Mesma página</a> <a id="obrigado" href="os-page:${obrigado.id}">Obrigado</a>`;
  await prisma.pageDocument.updateMany({
    where: { variant: { pageId: home.id } },
    data: { html: pageHtml("Versão A", links) },
  });
  const b = await createVariant({ pageId: home.id, label: "Headline nova" });
  await prisma.pageDocument.updateMany({ where: { variantId: b.id }, data: { html: pageHtml("Versão B", links) } });
  await prisma.pageDocument.updateMany({
    where: { variant: { pageId: obrigado.id } },
    data: { html: pageHtml("Página de obrigado", `<a id="voltar" href="os-page:${home.id}">Voltar</a>`) },
  });
  await createPixel(offer.id, { vendor: "META", pixelId: "123456789012345" });
  const a = await prisma.pageVariant.findFirstOrThrow({ where: { pageId: home.id, isControl: true } });
  const obrigadoA = await prisma.pageVariant.findFirstOrThrow({ where: { pageId: obrigado.id } });
  return { offerId: offer.id, homeId: home.id, obrigadoId: obrigado.id, aId: a.id, bId: b.id, obrigadoA: obrigadoA.id };
}

const tokenOf = (url: string) => new URL(url).hostname.split(".")[0];

// ─── Serviço e ação ──────────────────────────────────────────────────────────

describe("createPixelTestSession com a versão A/B", () => {
  it("com a versão: o token da prévia abre nela e a sessão devolve qual é", async () => {
    const o = await abOffer();
    const session = await createPixelTestSession(o.offerId, o.homeId, o.bId);
    expect(session.variantId).toBe(o.bId);
    expect(session.pageId).toBe(o.homeId);
    expect(await resolvePreviewToken(tokenOf(session.url))).toEqual({
      kind: "offer",
      offerId: o.offerId,
      pageId: o.homeId,
      variantId: o.bId,
    });
    // A de controle também pode ser escolhida (o teste fica preso a ela).
    const control = await createPixelTestSession(o.offerId, o.homeId, o.aId);
    expect(await resolvePreviewToken(tokenOf(control.url))).toEqual({
      kind: "offer",
      offerId: o.offerId,
      pageId: o.homeId,
      variantId: o.aId,
    });
    expect(control.variantId).toBe(o.aId);
  });

  it("sem a versão: como antes (token sem versão, variantId null)", async () => {
    const o = await abOffer();
    for (const variantId of [undefined, null]) {
      const session = await createPixelTestSession(o.offerId, o.homeId, variantId);
      expect(session.variantId).toBeNull();
      expect(await resolvePreviewToken(tokenOf(session.url))).toEqual({
        kind: "offer",
        offerId: o.offerId,
        pageId: o.homeId,
      });
    }
  });

  it("recusa versão de outra página, de outra oferta, inexistente ou sem a página", async () => {
    const o = await abOffer();
    const other = await abOffer();
    await expectUserError(
      createPixelTestSession(o.offerId, o.homeId, o.obrigadoA),
      "Essa versão não faz parte desta página.",
      "variantId",
    );
    await expectUserError(
      createPixelTestSession(o.offerId, o.homeId, other.bId),
      "Essa versão não faz parte desta página.",
      "variantId",
    );
    await expectUserError(
      createPixelTestSession(o.offerId, o.homeId, "cnaoexiste000000000000000"),
      "Essa versão não faz parte desta página.",
      "variantId",
    );
    await expectUserError(
      createPixelTestSession(o.offerId, null, o.bId),
      "Escolha a página da versão que você quer testar.",
      "pageId",
    );
    // A página continua conferida antes (de outra oferta → erro da página).
    await expectUserError(
      createPixelTestSession(o.offerId, other.homeId, other.bId),
      "Essa página não faz parte desta oferta.",
      "pageId",
    );
    // Nenhuma sessão criada pelas recusas.
    expect(await prisma.pixelTestSession.count()).toBe(0);
  });

  it("ação: aceita variantId, recusa vazio/longo com mensagem em português", async () => {
    const o = await abOffer();
    const res = await createPixelTestSessionAction({ offerId: o.offerId, pageId: o.homeId, variantId: o.bId });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.variantId).toBe(o.bId);
    expect((await resolvePreviewToken(tokenOf(res.data.url))) as { variantId?: string }).toMatchObject({
      variantId: o.bId,
    });
    const plain = await createPixelTestSessionAction({ offerId: o.offerId, pageId: o.homeId });
    if (!plain.ok) throw new Error(plain.error);
    expect(plain.data.variantId).toBeNull();

    const empty = await createPixelTestSessionAction({ offerId: o.offerId, pageId: o.homeId, variantId: "" });
    expect(empty).toMatchObject({ ok: false, error: "Versão inválida." });
    const long = await createPixelTestSessionAction({
      offerId: o.offerId,
      pageId: o.homeId,
      variantId: "x".repeat(41),
    });
    expect(long).toMatchObject({ ok: false, error: "Versão inválida." });
    const wrong = await createPixelTestSessionAction({ offerId: o.offerId, pageId: o.homeId, variantId: o.obrigadoA });
    expect(wrong).toMatchObject({ ok: false, error: "Essa versão não faz parte desta página." });
  });
});

// ─── Versões para a tela ─────────────────────────────────────────────────────

describe("versões de cada página para a tela Testar pixels", () => {
  it("offerVariantChoices: na ordem do Teste A/B, com controle e nome; lixeira → nada", async () => {
    const o = await abOffer();
    let choices = await offerVariantChoices(o.offerId);
    expect(choices[o.homeId]).toEqual([
      { id: o.aId, name: "A", label: null, isControl: true },
      { id: o.bId, name: "B", label: "Headline nova", isControl: false },
    ]);
    expect(choices[o.obrigadoId]).toEqual([{ id: o.obrigadoA, name: "A", label: null, isControl: true }]);

    await setControlVariant(o.bId);
    await renameVariant({ variantId: o.aId, label: "Original" });
    choices = await offerVariantChoices(o.offerId);
    expect(choices[o.homeId].map((v) => [v.name, v.label, v.isControl])).toEqual([
      ["A", "Original", false],
      ["B", "Headline nova", true],
    ]);

    // Outra oferta não entra.
    const other = await abOffer();
    expect(Object.keys(await offerVariantChoices(o.offerId)).sort()).toEqual([o.homeId, o.obrigadoId].sort());
    await prisma.offer.update({ where: { id: other.offerId }, data: { deletedAt: new Date() } });
    expect(await offerVariantChoices(other.offerId)).toEqual({});
  });

  it("buildTestSetup leva as versões de cada página (sem a lista, páginas sem versões)", async () => {
    const o = await abOffer();
    const panel = await getTrackingPanel(o.offerId);
    if (!panel) throw new Error("sem painel");
    const setup = buildTestSetup(panel, await offerVariantChoices(o.offerId));
    const home = setup.pages.find((p) => p.id === o.homeId);
    expect(home?.variants?.map((v) => v.name)).toEqual(["A", "B"]);
    expect(setup.pages.find((p) => p.id === o.obrigadoId)?.variants?.length).toBe(1);
    expect(buildTestSetup(panel).pages.every((p) => p.variants === undefined)).toBe(true);
  });
});

// ─── Regras puras da tela ────────────────────────────────────────────────────

describe("tela Testar pixels: versão escolhida, rótulo, pedido e sessão guardada", () => {
  const A: TestVariant = { id: "va", name: "A", label: null, isControl: true };
  const B: TestVariant = { id: "vb", name: "B", label: "Headline nova", isControl: false };
  const C: TestVariant = { id: "vc", name: "C", label: null, isControl: false };
  const pages: TestPage[] = [
    { id: "home", name: "Principal", isHome: true, variants: [A, B] },
    { id: "obrigado", name: "Obrigado", isHome: false, variants: [{ ...A, id: "oa" }] },
    { id: "antiga", name: "Sem a informação", isHome: false },
  ];

  it("pageVariants / chosenVariantId: escolha válida, senão a de controle", () => {
    expect(pageVariants(pages, "home")).toEqual([A, B]);
    expect(pageVariants(pages, "antiga")).toEqual([]);
    expect(pageVariants(pages, "nao-existe")).toEqual([]);
    expect(pageVariants(pages, null)).toEqual([]);
    expect(chosenVariantId([A, B], "vb")).toBe("vb");
    expect(chosenVariantId([A, B], null)).toBe("va");
    expect(chosenVariantId([A, B], "oa")).toBe("va");
    expect(chosenVariantId([B, { ...A, isControl: false }], undefined)).toBe("vb");
    expect(chosenVariantId([C, { ...B, isControl: true }], null)).toBe("vb");
    expect(chosenVariantId([], "vb")).toBeNull();
  });

  it("variantChoiceLabel", () => {
    expect(variantChoiceLabel(A)).toBe("Versão A (controle)");
    expect(variantChoiceLabel(B)).toBe("Versão B · Headline nova");
    expect(variantChoiceLabel({ ...B, isControl: true })).toBe("Versão B · Headline nova (controle)");
    expect(variantChoiceLabel(C)).toBe("Versão C");
  });

  it("pixelTestStartInput: a versão só vai quando a página tem mais de uma", () => {
    expect(pixelTestStartInput("o1", "home", [A, B], "vb")).toEqual({ offerId: "o1", pageId: "home", variantId: "vb" });
    expect(pixelTestStartInput("o1", "home", [A, B], null)).toEqual({ offerId: "o1", pageId: "home", variantId: "va" });
    // Escolha de outra página (a pessoa trocou a página): volta para o controle.
    expect(pixelTestStartInput("o1", "home", [A, B], "oa")).toEqual({ offerId: "o1", pageId: "home", variantId: "va" });
    expect(pixelTestStartInput("o1", "obrigado", [{ ...A, id: "oa" }], "oa")).toEqual({
      offerId: "o1",
      pageId: "obrigado",
    });
    expect(pixelTestStartInput("o1", null, [], null)).toEqual({ offerId: "o1", pageId: null });
  });

  it("sessão guardada com a versão: ida e volta; versão excluída, sem página ou inválida descarta", () => {
    const now = Date.UTC(2026, 9, 1, 13);
    const view = {
      id: "cmsess0000000000000000001",
      token: "abcdefghijklmnopqrstuvwxyz",
      url: "http://zyxwvutsrqponmlkjihgfedcba.localhost:3001/?os_teste=abcdefghijklmnopqrstuvwxyz",
      pageId: "home",
      variantId: "vb",
      expiresAt: new Date(now + 3600_000),
      vendors: ["META" as const],
    };
    const stored = toStoredSession(view);
    expect(stored.variantId).toBe("vb");
    const raw = JSON.stringify(stored);
    expect(readStoredSession(raw, now, ["home"], ["va", "vb"])).toEqual(stored);
    // Versão excluída (ou lista sem versões): o teste guardado não vale mais.
    expect(readStoredSession(raw, now, ["home"], ["va"])).toBeNull();
    expect(readStoredSession(raw, now, ["home"])).toBeNull();
    expect(readStoredSession(JSON.stringify({ ...stored, pageId: null }), now, [], ["vb"])).toBeNull();
    expect(readStoredSession(JSON.stringify({ ...stored, variantId: 42 }), now, ["home"], ["vb"])).toBeNull();
    expect(readStoredSession(JSON.stringify({ ...stored, variantId: "" }), now, ["home"], [""])).toBeNull();
    // null/sem o campo: sessão sem versão (como as guardadas antes).
    const plain = toStoredSession({ ...view, variantId: null });
    expect("variantId" in plain).toBe(false);
    expect(readStoredSession(JSON.stringify({ ...plain, variantId: null }), now, ["home"])).toEqual(plain);
    expect(readStoredSession(JSON.stringify(plain), now, ["home"], ["vb"])).toEqual(plain);
  });
});

// ─── Servidor de prévia de verdade ───────────────────────────────────────────

let port = 0;
let child: ChildProcess | null = null;
let output = "";
let browser: Browser | null = null;

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = (srv.address() as { port: number }).port;
      srv.close(() => resolve(p));
    });
  });
}

function call(token: string, pathname: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>(
    (resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path: pathname, headers: { host: `${token}.localhost:${port}`, ...headers } },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => {
            body += c;
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        },
      );
      req.setTimeout(15_000, () => req.destroy(new Error("prévia não respondeu")));
      req.on("error", reject);
      req.end();
    },
  );
}

/** Título do <h1> da página servida ("Versão A", "Versão B", "Página de obrigado"). */
async function shown(token: string, pathname: string) {
  const res = await call(token, pathname);
  expect(res.status, `${pathname}: ${res.body.slice(0, 300)}`).toBe(200);
  return /<h1 id="versao">([^<]*)<\/h1>/.exec(res.body)?.[1] ?? null;
}

describe("servidor de prévia: links do funil na prévia de uma versão", () => {
  beforeAll(async () => {
    // Nunca o banco real: o servidor recebe o banco de testes desta execução.
    expect(process.env.DATABASE_URL).toMatch(/\/offerstudio_test_\d+$/);
    port = await freePort();
    child = spawn(path.join(ROOT, "node_modules/.bin/tsx"), ["src/preview/server.ts"], {
      cwd: ROOT,
      env: { ...process.env, PREVIEW_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (c) => {
      output += String(c);
    });
    child.stderr?.on("data", (c) => {
      output += String(c);
    });
    const deadline = Date.now() + 30_000;
    while (!output.includes("servidor de prévia")) {
      if (Date.now() > deadline || child.exitCode !== null) throw new Error(`prévia não subiu:\n${output}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    await browser?.close();
  });

  it("prévia da versão B: a raiz e /p/<mesma página> ficam na B; outra página abre na de controle dela", async () => {
    const o = await abOffer();
    const token = await createPreviewToken({ kind: "offer", offerId: o.offerId, pageId: o.homeId, variantId: o.bId });
    expect(await shown(token, "/")).toBe("Versão B");
    expect(await shown(token, `/p/${o.homeId}`)).toBe("Versão B");
    expect(await shown(token, `/p/${o.homeId}/`)).toBe("Versão B");
    expect(await shown(token, `/p/${o.obrigadoId}`)).toBe("Página de obrigado");
    // O link da página B aponta para /p/<mesma página> (é por ele que a pessoa navega).
    expect((await call(token, "/")).body).toContain(`href="/p/${o.homeId}"`);
  });

  it("sem versão no token: a de controle em todo lugar; versão excluída depois → controle", async () => {
    const o = await abOffer();
    const plain = await createPreviewToken({ kind: "offer", offerId: o.offerId, pageId: o.homeId });
    expect(await shown(plain, "/")).toBe("Versão A");
    expect(await shown(plain, `/p/${o.homeId}`)).toBe("Versão A");

    const token = await createPreviewToken({ kind: "offer", offerId: o.offerId, pageId: o.homeId, variantId: o.bId });
    await deleteVariant(o.bId);
    expect(await shown(token, "/")).toBe("Versão A");
    expect(await shown(token, `/p/${o.homeId}`)).toBe("Versão A");
  });

  it("prévia de outra página com versão: a página inicial (outra) abre na de controle; a versão nunca vaza", async () => {
    const o = await abOffer();
    const thanksB = await createVariant({ pageId: o.obrigadoId });
    await prisma.pageDocument.updateMany({
      where: { variantId: thanksB.id },
      data: { html: pageHtml("Obrigado B", "") },
    });
    const token = await createPreviewToken({
      kind: "offer",
      offerId: o.offerId,
      pageId: o.obrigadoId,
      variantId: thanksB.id,
    });
    expect(await shown(token, "/")).toBe("Obrigado B");
    expect(await shown(token, `/p/${o.obrigadoId}`)).toBe("Obrigado B");
    expect(await shown(token, `/p/${o.homeId}`)).toBe("Versão A");
    // Token só com a versão (sem a página): a raiz é a inicial, que não tem essa versão → controle.
    const loose = await createPreviewToken({ kind: "offer", offerId: o.offerId, variantId: thanksB.id });
    expect(await shown(loose, "/")).toBe("Versão A");
    expect(await shown(loose, `/p/${o.homeId}`)).toBe("Versão A");
  });

  it("Testar pixels da versão B, ponta a ponta no Chromium: abre na B em modo teste e o funil volta para a B", async () => {
    const o = await abOffer();
    const session = await createPixelTestSession(o.offerId, o.homeId, o.bId);
    const origin = new URL(session.url).origin.replace(/:\d+$/, `:${port}`);
    const testUrl = session.url.replace(/^http:\/\/[^/]+/, origin);
    if (!browser) throw new Error("sem navegador");
    const context = await browser.newContext();
    try {
      // Nada vai para a internet: pixels/CDNs recebem um script vazio simulado.
      await context.route("**/*", (route) =>
        route.request().url().startsWith(`${origin}/`)
          ? route.continue()
          : route.fulfill({ status: 200, contentType: "text/javascript", body: "" }),
      );
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(testUrl);
      // Entrou no modo teste (o token sai do endereço) e mostra a versão B.
      expect(new URL(page.url()).searchParams.get("os_teste")).toBeNull();
      expect(await page.locator("#versao").textContent()).toBe("Versão B");
      const mode = await page.evaluate(
        () => JSON.parse(document.getElementById("os-tracking")?.textContent ?? "{}").mode as string,
      );
      expect(mode).toBe("test");

      const at = (pageId: string) => (u: URL) => u.pathname === `/p/${pageId}`;
      // Link para a mesma página: continua na B.
      await Promise.all([page.waitForURL(at(o.homeId)), page.locator("#mesma").click()]);
      expect(await page.locator("#versao").textContent()).toBe("Versão B");
      // Outra página do funil e de volta: a B de novo (como o divisor, que lembra a versão).
      await Promise.all([page.waitForURL(at(o.obrigadoId)), page.locator("#obrigado").click()]);
      expect(await page.locator("#versao").textContent()).toBe("Página de obrigado");
      await Promise.all([page.waitForURL(at(o.homeId)), page.locator("#voltar").click()]);
      expect(await page.locator("#versao").textContent()).toBe("Versão B");
      // Sempre em modo teste pelo funil (cookie da sessão).
      expect(
        await page.evaluate(() => JSON.parse(document.getElementById("os-tracking")?.textContent ?? "{}").mode),
      ).toBe("test");
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }, 60_000);
});
