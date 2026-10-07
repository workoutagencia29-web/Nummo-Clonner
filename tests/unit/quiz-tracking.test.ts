/**
 * Eventos do quiz nos pixels (src/runtime/tracking/quiz.ts) num Chromium sem
 * internet: a página leva o quiz, o script das páginas e o de rastreamento
 * (mesmo caminho da prévia/ZIP: injectTracking + scripts compilados), e os
 * scripts das plataformas são trocados por versões locais que anotam cada
 * chamada em window.__calls.
 *
 * Confere: QuizPergunta1…/QuizConcluido na Meta e no TikTok, quiz_pergunta_1…/
 * quiz_concluido no GA4, com o mesmo eventID; nada antes do "Aceitar" (os da
 * fila saem depois), nada com "Recusar"; desligado no quiz, nada sai; versão
 * do teste A/B nos parâmetros; tela "Testar pixels"; e o repasse de UTMs no
 * botão final.
 */
import path from "node:path";
import { buildSync } from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeRow } from "@/components/offers/pixel-test/logic";
import { BLOCK_QUIZ, defToHtml, QUIZ_CSS, quizDef } from "@/editor/widgets/quiz-content";
import { runtimeScript } from "@/lib/runtime-bundle";
import { injectTracking } from "@/lib/tracking/inject";
import type { PixelTestReport, TrackingRuntimeConfig } from "@/lib/tracking/runtime-config";
import { DEFAULT_FORWARD_PARAMS, PIXEL_VENDORS, TRACKING_EVENTS } from "@/lib/tracking/schema";
import { vendorEventName } from "@/lib/tracking/vendors";
import { quizEvent } from "@/runtime/tracking/quiz";

const SCRIPT = buildSync({
  entryPoints: [path.join(process.cwd(), "src/runtime/tracking/index.ts")],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2018", "safari13"],
  write: false,
  legalComments: "none",
}).outputFiles[0].text;
const TAG = `<script data-os-tracking>${SCRIPT}</script>`;

const NAMES = Object.fromEntries(
  PIXEL_VENDORS.map((v) => [v, Object.fromEntries(TRACKING_EVENTS.map((e) => [e, vendorEventName(v, e)]))]),
) as TrackingRuntimeConfig["names"];

const META = { vendor: "META" as const, id: "123456789012345", options: {} };
const TIKTOK = { vendor: "TIKTOK" as const, id: "C1ABCDEFGHIJ2KLMNOPQ", options: {} };
const GA4 = { vendor: "GA4" as const, id: "G-ABC123DEF4", options: {} };
const KWAI = { vendor: "KWAI" as const, id: "283746592837465", options: {} };

function config(over: Partial<TrackingRuntimeConfig> = {}, consentMode: "OPT_IN" | "NOTICE" = "OPT_IN") {
  const cfg: TrackingRuntimeConfig = {
    v: 1,
    mode: "live",
    pixels: [META, TIKTOK, GA4, KWAI],
    rules: [],
    names: NAMES,
    value: { currency: "BRL", amount: null },
    checkoutLinkKeys: [],
    checkoutHosts: [],
    marketingCode: false,
    server: null,
    test: null,
    ...over,
    consent: {
      mode: consentMode,
      text: "Usamos cookies.",
      acceptLabel: "Aceitar",
      rejectLabel: "Recusar",
      noticeLabel: "Entendi",
      policyLabel: "Política de privacidade",
      position: "bottom",
      theme: "dark",
      policyUrl: null,
    },
    forwarding: {
      enabled: true,
      params: [...DEFAULT_FORWARD_PARAMS],
      toCheckout: true,
      toInternalLinks: true,
      persistDays: 30,
    },
  };
  return cfg;
}

/** Página com o quiz do bloco (botão final indo para /vendas/), os dois scripts e a configuração. */
function pageHtml(cfg: TrackingRuntimeConfig, opts: { track?: boolean } = {}) {
  let quiz = defToHtml(quizDef(BLOCK_QUIZ)).replace('href="#" data-os-link=""', 'href="/vendas/"');
  if (opts.track === false) quiz = quiz.replace('data-os-track="1"', 'data-os-track="0"');
  quiz = quiz.replace('data-os-seconds="4"', 'data-os-seconds="1"');
  const base = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Quiz</title><style>${QUIZ_CSS}</style></head><body>${quiz}<script data-os-runtime>${runtimeScript()}</script></body></html>`;
  return injectTracking(base, cfg, TAG);
}

const REC = "var c=window.__calls=window.__calls||[];var A=function(a){return [].slice.call(a)};";
const STUBS: Record<string, string> = {
  "https://connect.facebook.net/en_US/fbevents.js": `(function(){${REC}c.push(["load","META"]);
    var q=fbq.queue.slice();fbq.queue.length=0;
    fbq.callMethod=function(){c.push(["fbq"].concat(A(arguments)))};
    q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`,
  "https://analytics.tiktok.com/i18n/pixel/events.js": `(function(){${REC}
    if(ttq.__stub)return;ttq.__stub=1;var q=ttq.splice(0);
    q.forEach(function(a){c.push(["ttq"].concat(a))});
    ["page","track"].forEach(function(m){ttq[m]=function(){c.push(["ttq",m].concat(A(arguments)))}});})();`,
  "https://s1.kwai.net/kos/s101/nlav11187/pixel/events.js": `(function(){${REC}c.push(["load","KWAI"]);
    var id=new URL(document.currentScript.src).searchParams.get("sdkid");
    (kwaiq._i[id]||[]).splice(0).forEach(function(a){c.push(["kwaiq:"+id].concat(a))});
    kwaiq.instance=function(p){return {track:function(){c.push(["kwaiq:"+p,"track"].concat(A(arguments)))}}};})();`,
  "https://www.googletagmanager.com/gtag/js": `(function(){${REC}c.push(["load","GTAG"]);})();`,
};

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

interface Site {
  page: Page;
  reports: PixelTestReport[];
  close: () => Promise<void>;
}

async function open(html: string, query = ""): Promise<Site> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const reports: PixelTestReport[] = [];
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === "http://site.test") {
      if (url.pathname === "/quiz") return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
      if (url.pathname === "/__os/pixel-test") {
        reports.push(JSON.parse(req.postData() ?? "{}"));
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: "<!doctype html><h1>Vendas</h1>" });
    }
    const stub = Object.keys(STUBS).find((prefix) => req.url().startsWith(prefix));
    if (stub) return route.fulfill({ contentType: "application/javascript", body: STUBS[stub] });
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto(`http://site.test/quiz${query}`);
  return { page, reports, close: () => context.close() };
}

type Call = unknown[];
const calls = (page: Page): Promise<Call[]> => page.evaluate(() => (window as { __calls?: Call[] }).__calls ?? []);
const quizCalls = async (page: Page) =>
  (await calls(page)).filter((c) => JSON.stringify(c).includes("Quiz")).map((c) => [c[0], c[1], c[2]]);
const gaQuiz = (page: Page) =>
  page.evaluate(() =>
    ((window as { dataLayer?: IArguments[] }).dataLayer ?? [])
      .map((a) => Array.from(a))
      .filter((a) => a[0] === "event" && String(a[1]).startsWith("quiz_")),
  );

/** Responde o quiz do bloco até o fim (3 perguntas). */
async function answerAll(page: Page) {
  const pick = async (n: number) => {
    await page.locator(".os-qz-cur [data-os-qz-option]").nth(n).click();
    await page.waitForTimeout(550);
  };
  await pick(0);
  await pick(1);
  await page.locator(".os-qz-cur [data-os-qz-next]").click();
  await page.locator(".os-qz-cur [data-os-qz-option]").nth(0).click();
  await page.locator(".os-qz-cur [data-os-qz-next]").click();
  await expect.poll(() => page.locator(".os-qz-cur[data-os-qz-step=final]").count(), { timeout: 3000 }).toBe(1);
}

describe("eventos do quiz (puros)", () => {
  it("um nome por pergunta, sem texto das respostas", () => {
    expect(quizEvent({ kind: "answer", question: 2, total: 4, track: true })).toEqual({
      name: "QuizPergunta2",
      ga: "quiz_pergunta_2",
      params: { quiz_pergunta: 2, quiz_total: 4 },
    });
    expect(quizEvent({ kind: "complete", total: 4, track: true })).toEqual({
      name: "QuizConcluido",
      ga: "quiz_concluido",
      params: { quiz_total: 4 },
    });
    expect(quizEvent({ kind: "answer", question: 1, total: 4, track: false })).toBeNull();
    expect(quizEvent({ kind: "answer", question: 0, total: 4 })).toBeNull();
    expect(quizEvent({ kind: "answer", question: "1" })).toBeNull();
    expect(quizEvent(null)).toBeNull();
    expect(quizEvent({ kind: "outro" })).toBeNull();
  });

  it("dois quizzes na mesma página: o segundo leva quiz_numero (o primeiro continua igual)", () => {
    expect(quizEvent({ kind: "answer", question: 1, total: 3, track: true, quiz: 1 })).toEqual({
      name: "QuizPergunta1",
      ga: "quiz_pergunta_1",
      params: { quiz_pergunta: 1, quiz_total: 3 },
    });
    expect(quizEvent({ kind: "answer", question: 1, total: 3, track: true, quiz: 2 })).toEqual({
      name: "QuizPergunta1",
      ga: "quiz_pergunta_1",
      params: { quiz_pergunta: 1, quiz_total: 3, quiz_numero: 2 },
    });
    expect(quizEvent({ kind: "complete", total: 3, track: true, quiz: 2 })?.params).toEqual({
      quiz_total: 3,
      quiz_numero: 2,
    });
    const base = { id: 1, status: "FIRED" as const, at: new Date().toISOString(), vendor: "META" };
    expect(
      describeRow({ ...base, event: "QuizPergunta1", detail: { quiz_pergunta: 1, quiz_total: 3, quiz_numero: 2 } }),
    ).toMatchObject({ subtitle: "Quiz 2: respondeu a pergunta 1 de 3" });
  });
});

describe("tela Testar pixels", () => {
  it("explica os eventos do quiz na linha do tempo", () => {
    const base = { id: 1, status: "FIRED" as const, at: new Date().toISOString() };
    expect(
      describeRow({ ...base, vendor: "META", event: "QuizPergunta2", detail: { quiz_pergunta: 2, quiz_total: 4 } }),
    ).toMatchObject({ title: "QuizPergunta2", subtitle: "Quiz: respondeu a pergunta 2 de 4" });
    expect(
      describeRow({ ...base, vendor: "GA4", event: "quiz_concluido", detail: { quiz_total: 4, os_versao: "B" } }),
    ).toMatchObject({ title: "quiz_concluido", subtitle: "Quiz concluído (chegou à etapa final) · versão B" });
  });
});

describe("eventos do quiz nos pixels", () => {
  it("Pedir permissão: espera o Aceitar, depois cada pergunta e a conclusão saem (Meta, TikTok e GA4)", async () => {
    const site = await open(pageHtml(config()), "?utm_source=facebook&utm_campaign=quiz");
    const { page } = site;
    // Responde a 1ª antes de aceitar: nada sai.
    await page.locator(".os-qz-cur [data-os-qz-option]").nth(0).click();
    await page.waitForTimeout(600);
    expect(await quizCalls(page)).toEqual([]);
    await page.getByRole("button", { name: "Aceitar" }).click();
    await expect.poll(() => quizCalls(page)).toContainEqual(["fbq", "trackCustom", "QuizPergunta1"]);

    await page.locator(".os-qz-cur [data-os-qz-option]").nth(1).click();
    await page.waitForTimeout(550);
    await page.locator(".os-qz-cur [data-os-qz-next]").click();
    await page.locator(".os-qz-cur [data-os-qz-option]").nth(0).click();
    await page.locator(".os-qz-cur [data-os-qz-next]").click();
    await expect.poll(() => page.locator(".os-qz-cur[data-os-qz-step=final]").count(), { timeout: 3000 }).toBe(1);

    await expect.poll(async () => (await quizCalls(page)).filter((c) => c[0] === "fbq").length).toBe(4);
    const all = await calls(page);
    const meta = all.filter((c) => c[0] === "fbq" && c[1] === "trackCustom");
    expect(meta.map((c) => c[2])).toEqual(["QuizPergunta1", "QuizPergunta2", "QuizPergunta3", "QuizConcluido"]);
    expect(meta[1][3]).toEqual({ quiz_pergunta: 2, quiz_total: 3 });
    expect(meta[3][3]).toEqual({ quiz_total: 3 });
    const tiktok = all.filter((c) => c[0] === "ttq" && c[1] === "track" && String(c[2]).startsWith("Quiz"));
    expect(tiktok.map((c) => c[2])).toEqual(["QuizPergunta1", "QuizPergunta2", "QuizPergunta3", "QuizConcluido"]);
    // Mesmo eventID na Meta e no TikTok.
    expect((meta[0][4] as { eventID: string }).eventID).toBe((tiktok[0][4] as { event_id: string }).event_id);
    const ga = await gaQuiz(page);
    expect(ga.map((a) => a[1])).toEqual(["quiz_pergunta_1", "quiz_pergunta_2", "quiz_pergunta_3", "quiz_concluido"]);
    expect(ga[0][2]).toMatchObject({ send_to: GA4.id, quiz_pergunta: 1, quiz_total: 3 });
    // Kwai não recebe evento personalizado.
    expect(all.filter((c) => String(c[0]).startsWith("kwaiq") && JSON.stringify(c).includes("Quiz"))).toEqual([]);

    // Botão final para outra página do funil: leva as UTMs da chegada.
    const href = await page.locator(".os-qz-cur [data-os-qz-go]").getAttribute("href");
    const url = new URL(href ?? "", "http://site.test/");
    expect(url.pathname).toBe("/vendas/");
    expect(url.searchParams.get("utm_source")).toBe("facebook");
    expect(url.searchParams.get("utm_campaign")).toBe("quiz");
    await site.close();
  }, 30_000);

  it("Recusar: nenhum evento do quiz sai (a tela de teste mostra o bloqueio)", async () => {
    const cfg = config({ mode: "test", test: { endpoint: "/__os/pixel-test", token: "abcdefghijklmnopqrstuvwxyz" } });
    const site = await open(pageHtml(cfg));
    const { page } = site;
    await page.getByRole("button", { name: "Recusar" }).click();
    await answerAll(page);
    await page.waitForTimeout(200);
    expect(await quizCalls(page)).toEqual([]);
    await expect
      .poll(() => site.reports.filter((r) => r.vendor === "CONSENT" && r.status === "BLOCKED").map((r) => r.event))
      .toEqual(expect.arrayContaining(["QuizPergunta1", "QuizConcluido"]));
    await site.close();
  }, 30_000);

  it("Só avisar + teste A/B + tela de teste: sai na hora com a versão; quiz com rastreamento desligado não manda nada", async () => {
    const cfg = config(
      {
        mode: "test",
        test: { endpoint: "/__os/pixel-test", token: "abcdefghijklmnopqrstuvwxyz" },
        variant: { name: "B", folder: "quiz-b/", srcHosts: [] },
      },
      "NOTICE",
    );
    const site = await open(pageHtml(cfg));
    const { page } = site;
    await answerAll(page);
    await expect.poll(async () => (await quizCalls(page)).filter((c) => c[0] === "fbq").length).toBe(4);
    const meta = (await calls(page)).filter((c) => c[0] === "fbq" && c[1] === "trackCustom");
    expect(meta[0][3]).toEqual({ quiz_pergunta: 1, quiz_total: 3, os_versao: "B" });
    const fired = site.reports.filter((r) => r.status === "FIRED" && r.event.startsWith("Quiz"));
    expect(fired.map((r) => `${r.vendor} ${r.event}`)).toEqual(
      expect.arrayContaining(["META QuizPergunta1", "TIKTOK QuizConcluido"]),
    );
    expect(site.reports.some((r) => r.vendor === "GA4" && r.event === "quiz_pergunta_2" && r.status === "FIRED")).toBe(
      true,
    );
    expect(fired.find((r) => r.vendor === "META")?.detail).toMatchObject({ quiz_pergunta: 1, os_versao: "B" });
    await site.close();

    const off = await open(pageHtml(config({}, "NOTICE"), { track: false }));
    await answerAll(off.page);
    await off.page.waitForTimeout(300);
    expect(await quizCalls(off.page)).toEqual([]);
    expect(await gaQuiz(off.page)).toEqual([]);
    await off.close();
  }, 40_000);
});
