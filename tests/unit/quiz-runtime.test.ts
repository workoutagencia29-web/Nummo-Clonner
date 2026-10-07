/**
 * Quiz na página publicada: o HTML sai do editor de verdade (bloco "Quiz" +
 * Configurações), passa pelo mesmo caminho da prévia/ZIP (finalizeFromEditor +
 * renderPageHtml com o script embutido) e roda num Chromium sem rede externa.
 * Também o modelo de página "Quiz" publicado direto (sem abrir no editor).
 *
 * Confere: uma etapa por vez, escolha única avançando sozinha, escolha
 * múltipla com "Continuar", "Voltar" (pulando a tela "Analisando"), a tela
 * "Analisando" avançando sozinha, o botão final levando ao destino, os avisos
 * "os:quiz" (uma vez por pergunta), acessibilidade (foco, aria-pressed,
 * aria-live, teclado) e a página sem JavaScript (só a primeira etapa).
 *
 * E os casos de borda: a rolagem do quiz até o topo dele não abre o popup de
 * saída no celular; quiz sem a etapa final não prende ninguém; quiz dentro da
 * etapa de outro responde só a ele.
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAGE_TEMPLATES } from "@/editor/templates";
import { BLOCK_QUIZ, defToHtml, QUIZ_CSS, type QuizStepSpec, quizDef } from "@/editor/widgets/quiz-content";
import { renderPageHtml } from "@/lib/page-render";
import { runtimeScript } from "@/lib/runtime-bundle";
import { addBlock, exportPage, openEditor, openSite, setAttrs, setTrait } from "./blocks-harness";
import { fakeId } from "./helpers";

let browser: Browser;
let blockHtml = "";
const SALES = fakeId("vendas");

beforeAll(async () => {
  browser = await chromium.launch();
  const page = await openEditor(browser, {
    pages: [
      { id: fakeId("quiz"), name: "Quiz" },
      { id: SALES, name: "Página de vendas" },
    ],
  });
  await addBlock(page, "quiz");
  await setTrait(page, '[data-os-widget="quiz"]', "os-qz-page", SALES);
  await setTrait(page, '[data-os-qz-step="loading"]', "data-os-seconds", "2");
  blockHtml = await exportPage(page);
  await page.close();
}, 90_000);

afterAll(async () => {
  await browser?.close();
});

/** Anota os avisos "os:quiz" em window.__quiz. */
const LISTEN = `window.__quiz=[];document.addEventListener("os:quiz",function(e){window.__quiz.push(e.detail)});`;

const quizEvents = (page: Page) =>
  page.evaluate(() => (window as unknown as { __quiz: Record<string, unknown>[] }).__quiz);

/** Etapa visível agora (tipo + título) e quantas estão visíveis. */
async function current(page: Page) {
  return page.evaluate(() => {
    const steps = Array.from(document.querySelectorAll<HTMLElement>("[data-os-qz-step]"));
    const shown = steps.filter((s) => getComputedStyle(s).display !== "none");
    const step = shown[0];
    return {
      visible: shown.length,
      kind: step?.getAttribute("data-os-qz-step") ?? null,
      title: step?.querySelector("h2")?.textContent ?? null,
      index: step ? steps.indexOf(step) : -1,
    };
  });
}

const backVisible = (page: Page) =>
  page.$eval(
    "[data-os-qz-back]",
    (el) => getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none",
  );

const progress = (page: Page) => page.$eval("[data-os-qz-bar]", (el) => Number(el.getAttribute("aria-valuenow")));

describe("quiz do bloco", () => {
  it("responde tudo no celular: escolha única, informação, múltipla, voltar, analisando e final", async () => {
    const site = await openSite(browser, blockHtml, {
      init: LISTEN,
      contextOptions: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
      extra: { "http://site.test/p/": "<!doctype html><title>Vendas</title><h1>Página de vendas</h1>" },
    });
    const { page } = site;
    page.setDefaultTimeout(5000);

    // Começo: só a primeira pergunta, sem "Voltar".
    expect(await current(page)).toMatchObject({ visible: 1, kind: "question", index: 0 });
    expect(await backVisible(page)).toBe(false);
    expect(await progress(page)).toBe(17);
    expect(await page.locator("[data-os-qz-option]").first().getAttribute("aria-pressed")).toBe("false");
    expect(await page.locator(".os-qz-sr").textContent()).toBe("Pergunta 1 de 3");

    // Escolha única: marca e avança sozinha depois da pausa.
    const opt = page.locator(".os-qz-cur [data-os-qz-option]").nth(2);
    await opt.tap();
    expect(await opt.getAttribute("aria-pressed")).toBe("true");
    expect((await current(page)).index).toBe(0);
    await expect.poll(async () => (await current(page)).index).toBe(1);
    expect(await backVisible(page)).toBe(true);
    // Foco no título da etapa nova; aviso para leitores de tela.
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Você já tentou resolver isso antes?");
    expect(await page.locator(".os-qz-sr").textContent()).toBe("Pergunta 2 de 3");

    // "Voltar": a primeira pergunta volta com a resposta marcada.
    await page.locator("[data-os-qz-back]").tap();
    expect(await current(page)).toMatchObject({ index: 0 });
    expect(await page.locator(".os-qz-cur [data-os-qz-option]").nth(2).getAttribute("aria-pressed")).toBe("true");
    await page.locator(".os-qz-cur [data-os-qz-option]").nth(0).tap();
    await expect.poll(async () => (await current(page)).index).toBe(1);

    await page.locator(".os-qz-cur [data-os-qz-option]").nth(0).tap();
    await expect.poll(async () => (await current(page)).kind).toBe("info");
    await page.locator(".os-qz-cur [data-os-qz-next]").tap();

    // Escolha múltipla: "Continuar" só com alguma marcada; marcar/desmarcar não avança.
    expect(await current(page)).toMatchObject({ kind: "question", index: 3 });
    const next = page.locator(".os-qz-cur [data-os-qz-next]");
    expect(await next.isVisible()).toBe(true);
    expect(await next.isDisabled()).toBe(true);
    const multi = page.locator(".os-qz-cur [data-os-qz-option]");
    await multi.nth(0).tap();
    await multi.nth(2).tap();
    await multi.nth(0).tap();
    await page.waitForTimeout(600);
    expect((await current(page)).index).toBe(3);
    expect(await multi.evaluateAll((els) => els.map((e) => e.getAttribute("aria-pressed")))).toEqual([
      "false",
      "false",
      "true",
    ]);
    expect(await next.isDisabled()).toBe(false);
    await next.tap();

    // Analisando: sem "Voltar", mensagens e porcentagem andando; avança sozinha (2 s).
    expect(await current(page)).toMatchObject({ kind: "loading" });
    expect(await backVisible(page)).toBe(false);
    await page.waitForTimeout(900);
    const pct = Number((await page.locator(".os-qz-cur [data-os-qz-pct]").textContent())?.replace("%", ""));
    expect(pct).toBeGreaterThan(20);
    expect(pct).toBeLessThan(100);
    await expect.poll(async () => (await current(page)).kind, { timeout: 4000 }).toBe("final");
    expect(await progress(page)).toBe(100);
    expect(await backVisible(page)).toBe(false);

    // Avisos para o rastreamento: uma vez por pergunta (voltar e responder de novo não repete) + conclusão.
    expect(await quizEvents(page)).toEqual([
      { kind: "answer", question: 1, total: 3, track: true, quiz: 1 },
      { kind: "answer", question: 2, total: 3, track: true, quiz: 1 },
      { kind: "answer", question: 3, total: 3, track: true, quiz: 1 },
      { kind: "complete", total: 3, track: true, quiz: 1 },
    ]);

    // Botão final: vai para a página do funil escolhida.
    const go = page.locator(".os-qz-cur [data-os-qz-go]");
    expect(await go.getAttribute("href")).toBe(`/p/${SALES}`);
    // O botão pulsa (animação): o Playwright nunca o acharia "parado".
    await go.tap({ force: true });
    await page.waitForURL(`http://site.test/p/${SALES}`);
    expect(await page.locator("h1").textContent()).toBe("Página de vendas");
    await site.context.close();
  }, 30_000);

  it("teclado: Tab chega às opções, Enter escolhe e Voltar some no fim; rola até o topo do quiz", async () => {
    const tall = blockHtml
      .replace("<body>", '<body><div style="height:1400px">Topo da página</div>')
      .replace(/<\/body>(?![\s\S]*<\/body>)/, '<div style="height:1500px"></div></body>');
    const site = await openSite(browser, tall, { contextOptions: { viewport: { width: 390, height: 700 } } });
    const { page } = site;
    await page.locator(".os-qz-cur [data-os-qz-option]").first().focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await current(page)).index).toBe(1);
    // A pergunta seguinte é mais baixa: rolou de volta até o topo do quiz.
    await page.evaluate(() => {
      const quiz = document.querySelector('[data-os-widget="quiz"]') as HTMLElement;
      scrollTo(0, quiz.getBoundingClientRect().top + scrollY + 250);
    });
    expect(await page.$eval('[data-os-widget="quiz"]', (q) => q.getBoundingClientRect().top)).toBeLessThan(0);
    await page.locator(".os-qz-cur [data-os-qz-option]").first().focus();
    await page.keyboard.press(" ");
    await expect.poll(async () => (await current(page)).kind).toBe("info");
    await expect
      .poll(() => page.$eval('[data-os-widget="quiz"]', (q) => Math.round(q.getBoundingClientRect().top)))
      .toBeGreaterThanOrEqual(0);
    await site.context.close();
  });

  it("sem rastreamento das respostas (data-os-track=0) o aviso diz track: false", async () => {
    const html = blockHtml.replace('data-os-track="1"', 'data-os-track="0"');
    const site = await openSite(browser, html, { init: LISTEN });
    await site.page.locator(".os-qz-cur [data-os-qz-option]").first().click();
    await expect
      .poll(() => quizEvents(site.page))
      .toEqual([{ kind: "answer", question: 1, total: 3, track: false, quiz: 1 }]);
    await site.context.close();
  });

  it("sem barra de progresso e sem Voltar quando desligados", async () => {
    const html = blockHtml
      .replace('data-os-progress="1"', 'data-os-progress="0"')
      .replace('data-os-back="1"', 'data-os-back="0"');
    const site = await openSite(browser, html);
    const { page } = site;
    await page.locator(".os-qz-cur [data-os-qz-option]").first().click();
    await expect.poll(async () => (await current(page)).index).toBe(1);
    expect(await page.locator("[data-os-qz-bar]").isVisible()).toBe(false);
    expect(await page.locator("[data-os-qz-back]").isVisible()).toBe(false);
    await site.context.close();
  });

  it("sem JavaScript: só a primeira etapa aparece (CSS da página)", async () => {
    const site = await openSite(browser, blockHtml, { contextOptions: { javaScriptEnabled: false } });
    const { page } = site;
    expect(await current(page)).toMatchObject({ visible: 1, index: 0, kind: "question" });
    expect(await page.$eval("[data-os-qz-back]", (el) => getComputedStyle(el).display)).toBe("none");
    await site.context.close();
  });
});

describe("modelo de página Quiz publicado (sem passar pelo editor)", () => {
  const template = PAGE_TEMPLATES.find((t) => t.id === "quiz");
  const html = renderPageHtml((template?.html ?? "").replaceAll("__OS_ANO__", "2026"), {
    links: [],
    pageHref: (id) => `/p/${id}`,
    runtimeTag: `<script data-os-runtime>${runtimeScript()}</script>`,
  });

  it("vai do começo ao fim (4 perguntas, informação, analisando, final) sem erros", async () => {
    expect(template?.pageType).toBe("QUIZ");
    const site = await openSite(browser, html, {
      init: LISTEN,
      clock: true,
      contextOptions: { viewport: { width: 390, height: 844 } },
    });
    const { page } = site;
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const pick = async (n = 0) => {
      await page.locator(".os-qz-cur [data-os-qz-option]").nth(n).click();
      await page.clock.runFor(500);
    };
    expect(await current(page)).toMatchObject({ visible: 1, index: 0 });
    await pick(1);
    await pick(0);
    expect((await current(page)).kind).toBe("info");
    await page.locator(".os-qz-cur [data-os-qz-next]").click();
    await page.locator(".os-qz-cur [data-os-qz-option]").nth(1).click();
    await page.locator(".os-qz-cur [data-os-qz-next]").click();
    await pick(2);
    expect((await current(page)).kind).toBe("loading");
    await page.clock.runFor(4200);
    expect((await current(page)).kind).toBe("final");
    expect(await page.locator(".os-qz-cur h2").textContent()).toBe(
      "Parabéns! Você ganhou um giro na roleta de descontos",
    );
    // Ainda sem destino escolhido: o botão não leva a lugar nenhum (o ZIP avisa).
    expect(await page.locator(".os-qz-cur [data-os-qz-go]").getAttribute("href")).toBe("#");
    expect((await quizEvents(page)).map((e) => e.kind)).toEqual(["answer", "answer", "answer", "answer", "complete"]);
    expect(errors).toEqual([]);
    await site.context.close();
  });
});

/** Página só com o HTML dado (quizzes montados direto das definições), com o script embutido. */
function pageWith(body: string) {
  return renderPageHtml(
    `<!doctype html><html><head><meta charset="utf-8"><style>${QUIZ_CSS}</style></head><body>${body}</body></html>`,
    {
      links: [],
      pageHref: (id) => `/p/${id}`,
      runtimeTag: `<script data-os-runtime>${runtimeScript()}</script>`,
    },
  );
}

describe("popup de saída e quiz na mesma página (celular)", () => {
  let html = "";
  const phone = { viewport: { width: 390, height: 700 }, isMobile: true, hasTouch: true };
  /** Anota a maior velocidade de subida (px/ms), com a mesma conta do popup de saída. */
  const SPEED = `window.__fastest=0;(function(){var y=0,t=Date.now();addEventListener("scroll",function(){var n=Date.now();if(scrollY<y)window.__fastest=Math.max(window.__fastest,(y-scrollY)/Math.max(16,n-t));y=scrollY;t=n},{passive:true})})();`;

  beforeAll(async () => {
    const page = await openEditor(browser);
    await addBlock(page, "quiz");
    await addBlock(page, "popup-saida");
    // Armado na hora e sem o tempo do celular: só o gatilho "rolar para cima rápido".
    await setAttrs(page, '[data-os-widget="exit-popup"]', { "data-os-arm": "0", "data-os-mobile-seconds": "0" });
    html = (await exportPage(page))
      .replace("<body>", '<body><div style="height:1400px">Topo da página</div>')
      .replace(/<\/body>(?![\s\S]*<\/body>)/, '<div style="height:2500px"></div></body>');
    await page.close();
  }, 60_000);

  const popupOpen = (page: Page) => page.locator('[data-os-widget="exit-popup"]').isVisible();

  /** Desce aos poucos (como a pessoa lendo) até o topo do quiz ficar 900 px acima da tela. */
  async function scrollPastQuiz(page: Page) {
    await page.waitForTimeout(150);
    const target = await page.$eval('[data-os-widget="quiz"]', (q) => q.getBoundingClientRect().top + scrollY + 900);
    for (let y = 0; y <= target; y += 150) {
      await page.evaluate((v) => scrollTo(0, v), y);
      await page.waitForTimeout(25);
    }
    await page.evaluate((v) => scrollTo(0, v), target);
    await page.waitForTimeout(400);
    expect(await page.$eval('[data-os-widget="quiz"]', (q) => q.getBoundingClientRect().top)).toBeLessThan(-800);
  }

  it("o quiz voltando ao topo dele (subida rápida) não abre o popup", async () => {
    const site = await openSite(browser, html, { contextOptions: phone, init: SPEED });
    const { page } = site;
    await scrollPastQuiz(page);
    await page.evaluate(() => {
      (window as unknown as { __fastest: number }).__fastest = 0;
      (document.querySelector(".os-qz-cur [data-os-qz-option]") as HTMLElement).click();
    });
    await expect.poll(async () => (await current(page)).index).toBe(1);
    await expect
      .poll(() => page.$eval('[data-os-widget="quiz"]', (q) => Math.round(q.getBoundingClientRect().top)))
      .toBeGreaterThanOrEqual(0);
    await page.waitForTimeout(500);
    // A subida do quiz é rápida o bastante para o gatilho (sem a marca, o popup abriria)…
    expect(await page.evaluate(() => (window as unknown as { __fastest: number }).__fastest)).toBeGreaterThan(1.2);
    // …mas o popup sabe que foi a própria página.
    expect(await popupOpen(page)).toBe(false);
    await site.context.close();
  });

  it("a mesma subida rápida feita pela pessoa continua abrindo o popup", async () => {
    const site = await openSite(browser, html, { contextOptions: phone });
    const { page } = site;
    await scrollPastQuiz(page);
    // Gesto rápido para cima (150 px a cada ~20 ms).
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => scrollTo(0, scrollY - 150));
      await page.waitForTimeout(20);
    }
    await expect.poll(() => popupOpen(page)).toBe(true);
    await site.context.close();
  });
});

describe("quiz sem a etapa final (HTML antigo ou colado)", () => {
  const LOADING_LAST = BLOCK_QUIZ.filter((s) => s.kind !== "final");
  const QUESTION_LAST = BLOCK_QUIZ.filter((s) => s.kind !== "final" && s.kind !== "loading");

  async function answerUntilMulti(page: Page) {
    const pick = async (n = 0) => {
      await page.locator(".os-qz-cur [data-os-qz-option]").nth(n).click();
      await page.clock.runFor(500);
    };
    await pick();
    await pick();
    expect((await current(page)).kind).toBe("info");
    await page.locator(".os-qz-cur [data-os-qz-next]").click();
    await page.locator(".os-qz-cur [data-os-qz-option]").nth(1).click();
    await page.locator(".os-qz-cur [data-os-qz-next]").click();
  }

  it("“Analisando” no fim: chega a 100%, o quiz conta como concluído e o “Voltar” reaparece", async () => {
    const site = await openSite(browser, pageWith(defToHtml(quizDef(LOADING_LAST))), { init: LISTEN, clock: true });
    const { page } = site;
    await answerUntilMulti(page);
    expect((await current(page)).kind).toBe("loading");
    expect(await backVisible(page)).toBe(false);
    await page.clock.runFor(4500);
    expect(await current(page)).toMatchObject({ kind: "loading" });
    expect(await page.locator(".os-qz-cur [data-os-qz-pct]").textContent()).toBe("100%");
    expect((await quizEvents(page)).map((e) => `${e.kind}${e.question ?? ""}`)).toEqual([
      "answer1",
      "answer2",
      "answer3",
      "complete",
    ]);
    // Não fica preso: dá para voltar à última pergunta.
    expect(await backVisible(page)).toBe(true);
    await page.locator("[data-os-qz-back]").click();
    expect(await current(page)).toMatchObject({ kind: "question", index: 3 });
    await site.context.close();
  });

  it("pergunta no fim: a resposta dela conta e o quiz conta como concluído", async () => {
    const site = await openSite(browser, pageWith(defToHtml(quizDef(QUESTION_LAST))), { init: LISTEN, clock: true });
    const { page } = site;
    await answerUntilMulti(page);
    await page.clock.runFor(500);
    expect(await current(page)).toMatchObject({ kind: "question", index: 3 });
    expect((await quizEvents(page)).map((e) => `${e.kind}${e.question ?? ""}`)).toEqual([
      "answer1",
      "answer2",
      "answer3",
      "complete",
    ]);
    // Tocar de novo não repete os avisos.
    await page.locator(".os-qz-cur [data-os-qz-next]").click();
    expect(await quizEvents(page)).toHaveLength(4);
    await site.context.close();
  });
});

describe("quiz dentro da etapa de outro quiz", () => {
  it("um clique no quiz de dentro responde só a ele (um aviso só) e o “Voltar” dele aparece", async () => {
    const outer = defToHtml(quizDef(BLOCK_QUIZ));
    const inner = defToHtml(quizDef(BLOCK_QUIZ as QuizStepSpec[]));
    const at = outer.indexOf("</h2>") + "</h2>".length;
    const html = pageWith(`${outer.slice(0, at)}${inner}${outer.slice(at)}`);
    const site = await openSite(browser, html, { init: LISTEN });
    const { page } = site;
    const index = (which: "outer" | "inner") =>
      page.evaluate((w) => {
        const quizzes = document.querySelectorAll<HTMLElement>('[data-os-widget="quiz"]');
        const quiz = quizzes[w === "outer" ? 0 : 1];
        const steps = Array.from(quiz.querySelectorAll("[data-os-qz-step]")).filter(
          (s) => s.closest('[data-os-widget="quiz"]') === quiz,
        );
        return steps.findIndex((s) => s.classList.contains("os-qz-cur"));
      }, which);
    const innerQuiz = page.locator('[data-os-widget="quiz"] [data-os-widget="quiz"]');
    await innerQuiz.locator(".os-qz-cur [data-os-qz-option]").first().click();
    await expect.poll(() => index("inner")).toBe(1);
    await page.waitForTimeout(600);
    expect(await index("outer")).toBe(0);
    expect(await quizEvents(page)).toEqual([{ kind: "answer", question: 1, total: 3, track: true, quiz: 2 }]);
    // O "Voltar" escondido do quiz de fora (1ª etapa) não esconde o do quiz de dentro.
    expect(await innerQuiz.locator("[data-os-qz-back]").isVisible()).toBe(true);
    expect(await page.locator('body > [data-os-widget="quiz"] > .os-qz-top > [data-os-qz-back]').isVisible()).toBe(
      false,
    );
    // O quiz de fora continua respondendo às opções dele.
    await page
      .locator('body > [data-os-widget="quiz"] > .os-qz-steps > .os-qz-cur > .os-qz-opts > [data-os-qz-option]')
      .first()
      .click();
    await expect.poll(() => index("outer")).toBe(1);
    expect((await quizEvents(page)).at(-1)).toEqual({ kind: "answer", question: 1, total: 3, track: true, quiz: 1 });
    await site.context.close();
  });
});
