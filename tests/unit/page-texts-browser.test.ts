/**
 * Páginas publicadas em espanhol/inglês e números de fora do Brasil, no
 * navegador (Chromium sem rede externa): os modelos de página passam pelo
 * mesmo renderPageHtml da prévia/ZIP com o <html lang> trocado (como escolhido
 * em "Idioma das páginas") ou a moeda da oferta, e o script das páginas embutido.
 *
 * - Formulário de captura: celular da Espanha aceito, mensagens em espanhol,
 *   nada da formatação brasileira; em português de oferta em real, como sempre;
 *   oferta em peso com a página em português, telefone de fora sem pedir DDD.
 * - Faixa do prêmio da roleta (e o "Copiar") em espanhol, inglês e português.
 * - Notificação de compra, quiz, roleta e popup de saída no idioma da página.
 */
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAGE_TEMPLATES } from "@/editor/templates";
import { renderPageHtml } from "@/lib/page-render";
import { htmlLang } from "@/lib/page-texts";
import { runtimeScript } from "@/lib/runtime-bundle";
import type { StoreCurrency } from "@/lib/store";
import { prizeId, prizeParam } from "@/lib/wheel";
import type { WheelRender } from "@/lib/wheel-prizes";
import { openSite } from "./blocks-harness";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

const LINKS = [{ key: "checkout", url: "https://pay.exemplo.com/cheio" }];

function template(id: string, lang: string) {
  const html = PAGE_TEMPLATES.find((t) => t.id === id)?.html ?? "";
  expect(html).toContain('<html lang="pt-BR"');
  return html.replaceAll("__OS_ANO__", "2026").replace('<html lang="pt-BR"', `<html lang="${lang}"`);
}

/** O idioma da página como escolhido em "Idioma das páginas" (numa oferta em real, só a escolha vale). */
function render(html: string, opts: { currency?: StoreCurrency; wheel?: WheelRender } = {}) {
  return renderPageHtml(html, {
    links: LINKS,
    pageHref: (id) => `/p/${id}`,
    runtimeTag: `<script data-os-runtime>${runtimeScript()}</script>`,
    currency: opts.currency,
    seo: { lang: htmlLang(html) },
    wheel: opts.wheel ?? null,
  });
}

// ─── Formulário de captura ───────────────────────────────────────────────────

/** Modelo "Captura" com o webhook ligado (os dados vão para hook.test). */
const capture = (lang: string) =>
  template("captura", lang).replace('data-os-webhook=""', 'data-os-webhook="https://hook.test/lead"');

const errors = (page: import("playwright").Page) => page.locator("#inscricao .os-lf-err").allTextContents();

/** Sem animações (o botão de enviar pulsa: o clique esperaria ele parar). */
const STILL = { contextOptions: { viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" as const } };

describe("formulário de captura", () => {
  it("página em espanhol: aceita o celular da Espanha, mensagens em espanhol, sem formatação brasileira", async () => {
    const html = render(capture("es"));
    expect(html).toContain('id="os-textos"');
    const site = await openSite(browser, html, STILL);
    const { page } = site;
    await page.locator("#inscricao button[type=submit]").click();
    expect(await errors(page)).toEqual([
      "Escribe tu nombre.",
      "Escribe tu correo electrónico.",
      "Escribe tu número de WhatsApp.",
    ]);
    await page.locator("#inscricao [name=name]").fill("Lucía");
    await page.locator("#inscricao [name=email]").fill("lucia@");
    await page.locator("#inscricao [name=phone]").fill("123");
    await page.locator("#inscricao button[type=submit]").click();
    expect(await errors(page)).toEqual([
      "Escribe un correo válido (ej.: nombre@gmail.com).",
      "Escribe un número de WhatsApp válido.",
    ]);
    await page.locator("#inscricao [name=email]").fill("lucia@gmail.com");
    await page.locator("#inscricao [name=phone]").fill("612 345 678");
    await page.locator("#inscricao [name=phone]").blur();
    expect(await page.locator("#inscricao [name=phone]").inputValue()).toBe("612 345 678");
    await page.locator("#inscricao button[type=submit]").click();
    await expect.poll(() => page.locator("#inscricao .os-lf-ok").textContent()).toBe("¡Listo! Recibimos tus datos.");
    const sent = site.requests.find((r) => r.url.startsWith("https://hook.test/lead"));
    expect(JSON.parse(sent?.body ?? "{}")).toMatchObject({ name: "Lucía", phone: "612 345 678" });
    await site.context.close();
  });

  it("página em inglês: mensagens em inglês", async () => {
    const site = await openSite(browser, render(capture("en-US")), STILL);
    await site.page.locator("#inscricao button[type=submit]").click();
    expect(await errors(site.page)).toEqual([
      "Please enter your name.",
      "Please enter your email.",
      "Please enter your WhatsApp number.",
    ]);
    await site.context.close();
  });

  it("português de oferta em real: igual a antes (pede DDD e formata o número)", async () => {
    const html = render(capture("pt-BR"), { currency: "BRL" });
    expect(html).not.toContain('id="os-textos"');
    const site = await openSite(browser, html, STILL);
    const { page } = site;
    await page.locator("#inscricao [name=name]").fill("Maria");
    await page.locator("#inscricao [name=email]").fill("maria@gmail.com");
    await page.locator("#inscricao [name=phone]").fill("612 345 678");
    await page.locator("#inscricao button[type=submit]").click();
    expect(await errors(page)).toEqual(["Digite um WhatsApp válido com DDD (ex.: (11) 91234-5678)."]);
    await page.locator("#inscricao [name=phone]").fill("11912345678");
    await page.locator("#inscricao [name=phone]").blur();
    expect(await page.locator("#inscricao [name=phone]").inputValue()).toBe("(11) 91234-5678");
    await page.locator("#inscricao button[type=submit]").click();
    await expect.poll(() => page.locator("#inscricao .os-lf-ok").textContent()).toBe("Pronto! Recebemos seus dados.");
    await site.context.close();
  });

  it("oferta em peso com a página em português: telefone de outro país, sem pedir DDD", async () => {
    const site = await openSite(browser, render(capture("pt-BR"), { currency: "MXN" }), STILL);
    const { page } = site;
    await page.locator("#inscricao button[type=submit]").click();
    expect(await errors(page)).toEqual(["Digite seu nome.", "Digite seu e-mail.", "Digite seu WhatsApp."]);
    await page.locator("#inscricao [name=phone]").fill("55 1234 5678");
    await page.locator("#inscricao [name=phone]").blur();
    expect(await page.locator("#inscricao [name=phone]").inputValue()).toBe("55 1234 5678");
    await page.locator("#inscricao [name=name]").fill("Lucía");
    await page.locator("#inscricao [name=email]").fill("lucia@gmail.com");
    await page.locator("#inscricao button[type=submit]").click();
    await expect.poll(() => page.locator("#inscricao .os-lf-ok").textContent()).toBe("Pronto! Recebemos seus dados.");
    await site.context.close();
  });
});

// ─── Faixa do prêmio da roleta ───────────────────────────────────────────────

const SLICE = { link: "c30", text: "30% OFF", coupon: "ROLETA30" };
const PRIZE = prizeId(SLICE);
const WHEEL: WheelRender = {
  prizes: { [PRIZE]: { u: "https://pay.exemplo.com/trinta", t: "30% OFF", c: "ROLETA30", d: 7, m: 10, b: 1 } },
  checkoutKeys: ["checkout"],
};

async function prizePage(lang: string) {
  const html = render(template("vendas-longa", lang).replaceAll('data-os-link=""', 'data-os-link="checkout"'), {
    wheel: WHEEL,
  });
  const site = await openSite(browser, html, {
    clock: true,
    query: `?os_premio=${prizeParam(PRIZE, Date.now() + 864e5)}`,
    contextOptions: { viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] },
  });
  await expect.poll(() => site.page.locator(".os-pz").count()).toBe(1);
  return site;
}

const prizeTexts = (page: import("playwright").Page) =>
  page.evaluate(() => {
    const q = (s: string) => document.querySelector(s);
    return {
      region: q(".os-pz")?.getAttribute("aria-label"),
      msg: q(".os-pz-msg")?.textContent,
      ends: q(".os-pz-l")?.textContent,
      chip: q(".os-pz-cp")?.firstChild?.textContent,
      copy: q(".os-pz-cp button")?.textContent,
      copyLabel: q(".os-pz-cp button")?.getAttribute("aria-label"),
      close: q(".os-pz-x")?.getAttribute("aria-label"),
    };
  });

describe("faixa do prêmio da roleta", () => {
  it("espanhol: frase, “Termina en”, cupom, copiar e fechar; ao zerar, o desconto continua reservado", async () => {
    const site = await prizePage("es");
    const { page } = site;
    expect(await prizeTexts(page)).toEqual({
      region: "Tu descuento",
      msg: "¡30% OFF desbloqueado! Usa el cupón al pagar",
      ends: "Termina en",
      chip: "Cupón ",
      copy: "Copiar",
      copyLabel: "Copiar el cupón ROLETA30",
      close: "Cerrar el aviso del descuento",
    });
    expect(await page.locator(".os-pz-msg b").textContent()).toBe("30% OFF");
    await page.locator(".os-pz-cp button").click();
    await expect.poll(() => page.locator(".os-pz-cp button").textContent()).toBe("¡Copiado!");
    await page.clock.runFor(11 * 60_000);
    expect(await page.locator(".os-pz-msg").textContent()).toBe(
      "Tu descuento de 30% OFF sigue reservado: aprovéchalo ahora",
    );
    await site.context.close();
  });

  it("inglês", async () => {
    const site = await prizePage("en");
    expect(await prizeTexts(site.page)).toEqual({
      region: "Your discount",
      msg: "30% OFF unlocked! Use the coupon at checkout",
      ends: "Ends in",
      chip: "Coupon ",
      copy: "Copy",
      copyLabel: "Copy coupon ROLETA30",
      close: "Close the discount notice",
    });
    await site.page.locator(".os-pz-cp button").click();
    await expect.poll(() => site.page.locator(".os-pz-cp button").textContent()).toBe("Copied!");
    await site.context.close();
  });

  it("português: igual a antes", async () => {
    const site = await prizePage("pt-BR");
    const { page } = site;
    expect(await prizeTexts(page)).toEqual({
      region: "Seu desconto",
      msg: "30% OFF liberado! Use o cupom no pagamento",
      ends: "Termina em",
      chip: "Cupom ",
      copy: "Copiar",
      copyLabel: "Copiar o cupom ROLETA30",
      close: "Fechar o aviso do desconto",
    });
    await page.locator(".os-pz-cp button").click();
    await expect.poll(() => page.locator(".os-pz-cp button").textContent()).toBe("Copiado!");
    await page.clock.runFor(11 * 60_000);
    expect(await page.locator(".os-pz-msg").textContent()).toBe(
      "Seu desconto de 30% OFF continua reservado — aproveite agora",
    );
    await site.context.close();
  });
});

// ─── Notificação de compra, quiz, roleta e popup de saída ───────────────────

/** Modelo "Captura" com uma pessoa só, a ação padrão do bloco e a primeira notificação na hora. */
const notifying = (lang: string) =>
  template("captura", lang)
    .replace(/data-os-people="[^"]*"/, 'data-os-people="Lucía - Guadalajara"')
    .replace('data-os-action="acabou de se inscrever"', 'data-os-action="acabou de comprar"')
    .replace('data-os-start="8"', 'data-os-start="0"');

async function notification(lang: string) {
  const site = await openSite(browser, render(notifying(lang)));
  const card = site.page.locator('[data-os-widget="sales-notification"]');
  await expect.poll(() => card.evaluate((el) => el.classList.contains("os-show"))).toBe(true);
  const text = await card.evaluate((el) => {
    const part = (n: string) => el.querySelector(`[data-os-sn="${n}"]`)?.textContent ?? "";
    return { title: part("title"), text: part("text"), time: part("time") };
  });
  await site.context.close();
  return text;
}

describe("notificação de compra, quiz, roleta e popup de saída", () => {
  it("notificação de compra: “de”, a ação padrão e “há X minutos” no idioma da página", async () => {
    const es = await notification("es");
    expect(es.title).toBe("Lucía, de Guadalajara");
    expect(es.text).toBe("acaba de comprar");
    expect(es.time).toMatch(/^hace \d+ minutos$/);
    const en = await notification("en");
    expect(en.title).toBe("Lucía from Guadalajara");
    expect(en.text).toBe("just bought");
    expect(en.time).toMatch(/^\d+ minutes ago$/);
    const pt = await notification("pt-BR");
    expect(pt.title).toBe("Lucía, de Guadalajara");
    expect(pt.text).toBe("acabou de comprar");
    expect(pt.time).toMatch(/^há \d+ minutos$/);
  });

  it("quiz: “Pregunta 1 de N” para leitores de tela", async () => {
    for (const [lang, re] of [
      ["es", /^Pregunta 1 de \d+$/],
      ["en", /^Question 1 of \d+$/],
      ["pt-BR", /^Pergunta 1 de \d+$/],
    ] as const) {
      const site = await openSite(browser, render(template("quiz", lang)));
      await expect.poll(() => site.page.locator(".os-qz-sr").textContent(), { message: lang }).toMatch(re);
      await site.context.close();
    }
  });

  it("roleta: “Girando…” e o prêmio ganho para leitores de tela", async () => {
    for (const [lang, spinning, won] of [
      ["es", "Girando la ruleta…", "¡Ganaste 10% OFF!"],
      ["en", "Spinning the wheel…", "You won 10% OFF!"],
      ["pt-BR", "Girando a roleta…", "Você ganhou 10% OFF!"],
    ] as const) {
      const site = await openSite(browser, render(template("roleta", lang)), {
        contextOptions: { viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" },
        // Sorteio previsível: a primeira fatia (10% OFF).
        init: "Math.random=function(){return 0.01};",
      });
      const { page } = site;
      await page.evaluate(() => {
        const w = window as unknown as { __live: string[] };
        w.__live = [];
        const live = document.querySelector(".os-wh-sr") as Element;
        new MutationObserver(() => w.__live.push(live.textContent ?? "")).observe(live, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      });
      await page.locator("[data-os-wh-spin]").click();
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { __live: string[] }).__live), { message: lang })
        .toEqual([spinning, won]);
      await site.context.close();
    }
  });

  it("popup de saída: o “×” que o script põe tem o nome no idioma da página", async () => {
    for (const [lang, label] of [
      ["es", "Cerrar"],
      ["en", "Close"],
      ["pt-BR", "Fechar"],
    ] as const) {
      // Sem os botões de fechar do modelo (o script põe o "×" dele) e abrindo sozinho depois de 1 s.
      const html = template("vendas-longa", lang)
        .replace(/<button type="button" class="os-popup__close" data-os-close aria-label="Fechar">×<\/button>/, "")
        .replace('class="os-popup__decline" data-os-close', 'class="os-popup__decline"')
        .replace('data-os-seconds="0"', 'data-os-seconds="1"');
      const site = await openSite(browser, render(html));
      await expect.poll(() => site.page.locator(".os-pop-x").count(), { message: lang, timeout: 5000 }).toBe(1);
      expect(await site.page.locator(".os-pop-x").getAttribute("aria-label")).toBe(label);
      await site.context.close();
    }
  });
});
