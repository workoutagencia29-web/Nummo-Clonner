/**
 * Comportamento dos widgets na página publicada: o HTML sai do editor de verdade
 * (blocos + Configurações), passa pelo mesmo caminho da prévia/ZIP
 * (finalizeFromEditor + renderPageHtml com o script embutido) e roda num
 * Chromium sem rede externa.
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OfferLinkValue } from "@/lib/offer-links";
import { runtimeScript } from "@/lib/runtime-bundle";
import { addBlock, exportPage, openEditor, openSite, setAttrs, setTrait } from "./blocks-harness";
import { fakeId } from "./helpers";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

/** Monta uma página no editor com os blocos, ajusta e exporta. */
async function build(blocks: string[], configure?: (page: Page) => Promise<void>, links: OfferLinkValue[] = []) {
  const page = await openEditor(browser);
  for (const id of blocks) await addBlock(page, id);
  if (configure) await configure(page);
  const html = await exportPage(page, { links });
  await page.close();
  return html;
}

const digits = (page: Page) =>
  page.$$eval("[data-os-cd]", (els) =>
    Object.fromEntries(els.map((e) => [e.getAttribute("data-os-cd"), e.textContent])),
  );

describe("contador regressivo", () => {
  it("conta de verdade, guarda o prazo de cada visitante e não reinicia ao recarregar", async () => {
    const html = await build(["contador"]);
    const site = await openSite(browser, html);
    const { page } = site;
    await page.waitForTimeout(1200);
    const first = await digits(page);
    expect(first.h).toBe("00");
    expect(first.m).toBe("14");
    const saved = await page.evaluate(() => localStorage.getItem("os-cd:/oferta:15"));
    expect(Number(saved)).toBeGreaterThan(Date.now());
    // Menos de um dia: a caixa "dias" some.
    expect(await page.$eval('[data-os-cd-unit="d"]', (el) => getComputedStyle(el).display)).toBe("none");

    await page.waitForTimeout(1000);
    await page.reload();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => localStorage.getItem("os-cd:/oferta:15"))).toBe(saved);
    const after = await digits(page);
    expect(Number(after.m) * 60 + Number(after.s)).toBeLessThan(Number(first.m) * 60 + Number(first.s));
    await site.context.close();
  });

  it("ao zerar: mostra o texto, esconde ou recomeça, conforme a escolha", async () => {
    const cases = { text: "", hide: "", restart: "", zero: "" } as Record<string, string>;
    for (const mode of Object.keys(cases)) {
      cases[mode] = await build(["contador"], async (page) => {
        await setTrait(page, '[data-os-widget="countdown"]', "data-os-minutes", "1");
        await setTrait(page, '[data-os-widget="countdown"]', "data-os-expired", mode);
        await setTrait(page, '[data-os-widget="countdown"]', "data-os-expired-text", "Acabou! Volte amanhã.");
      });
    }
    const run = async (mode: string) => {
      const site = await openSite(browser, cases[mode], { clock: true });
      await site.page.clock.runFor(61_000);
      return site;
    };

    const text = await run("text");
    expect(await text.page.locator(".os-cd-exp").textContent()).toBe("Acabou! Volte amanhã.");
    expect(await text.page.locator("[data-os-cd-units]").isVisible()).toBe(false);
    await text.context.close();

    const hide = await run("hide");
    expect(await hide.page.locator('[data-os-widget="countdown"]').isVisible()).toBe(false);
    await hide.context.close();

    const zero = await run("zero");
    expect(await digits(zero.page)).toMatchObject({ h: "00", m: "00", s: "00" });
    expect(await zero.page.getAttribute('[data-os-widget="countdown"]', "data-os-state")).toBe("expired");
    await zero.context.close();

    const restart = await run("restart");
    const d = await digits(restart.page);
    expect(Number(d.m) * 60 + Number(d.s)).toBeGreaterThan(50);
    await restart.context.close();
  });

  it("data fixa: mostra os dias quando falta mais de um dia; data passada zera na hora", async () => {
    const future = await build(["contador"], async (page) => {
      await setTrait(page, '[data-os-widget="countdown"]', "data-os-mode", "date");
      await setTrait(page, '[data-os-widget="countdown"]', "data-os-until", "2099-12-31T23:59");
    });
    const site = await openSite(browser, future);
    await site.page.waitForTimeout(100);
    expect(await site.page.locator('[data-os-cd-unit="d"]').isVisible()).toBe(true);
    expect(Number((await digits(site.page)).d)).toBeGreaterThan(1000);
    await site.context.close();

    const past = await build(["contador"], async (page) => {
      await setTrait(page, '[data-os-widget="countdown"]', "data-os-mode", "date");
      await setTrait(page, '[data-os-widget="countdown"]', "data-os-until", "2020-01-01T00:00");
      await setTrait(page, '[data-os-widget="countdown"]', "data-os-expired", "text");
    });
    const old = await openSite(browser, past);
    await expect.poll(() => old.page.locator(".os-cd-exp").textContent()).toBe("Oferta encerrada.");
    await old.context.close();
  });
});

describe("barra de escassez", () => {
  it("diminui aos poucos até o mínimo e lembra o valor na sessão", async () => {
    const html = await build(["escassez"], async (page) => {
      await setTrait(page, '[data-os-widget="scarcity"]', "data-os-percent", "10");
      await setTrait(page, '[data-os-widget="scarcity"]', "data-os-every", "1");
      await setTrait(page, '[data-os-widget="scarcity"]', "data-os-min", "7");
    });
    const site = await openSite(browser, html, { clock: true });
    const { page } = site;
    expect(await page.textContent("[data-os-sc-value]")).toBe("10%");
    await page.clock.runFor(2_100);
    expect(await page.textContent("[data-os-sc-value]")).toBe("8%");
    expect(await page.$eval("[data-os-sc-fill]", (el) => (el as HTMLElement).style.width)).toBe("8%");
    await page.clock.runFor(10_000);
    expect(await page.textContent("[data-os-sc-value]")).toBe("7%");
    expect(await page.evaluate(() => sessionStorage.getItem("os-sc:/oferta:0"))).toBe("7");
    await site.context.close();
  });
});

describe("notificação de compra", () => {
  it("aparece no canto com os nomes da lista, some e respeita o máximo", async () => {
    const html = await build(["notificacao-compra"], async (page) => {
      const sel = '[data-os-widget="sales-notification"]';
      await setTrait(page, sel, "data-os-people", "Lia - Natal");
      await setTrait(page, sel, "data-os-product", "o Curso Y");
      await setTrait(page, sel, "data-os-start", "1");
      await setTrait(page, sel, "data-os-interval", "2");
      await setTrait(page, sel, "data-os-duration", "1");
      await setTrait(page, sel, "data-os-max", "2");
    });
    const site = await openSite(browser, html, { clock: true });
    const { page } = site;
    const box = page.locator('[data-os-widget="sales-notification"]');
    const visible = () =>
      box.evaluate((el) => el.classList.contains("os-show") && getComputedStyle(el).opacity !== "0");
    expect(await box.evaluate((el) => el.classList.contains("os-show"))).toBe(false);
    await page.clock.runFor(1_100);
    expect(await box.evaluate((el) => el.classList.contains("os-show"))).toBe(true);
    expect(await page.textContent('[data-os-sn="title"]')).toBe("Lia, de Natal");
    expect(await page.textContent('[data-os-sn="text"]')).toBe("acabou de comprar o Curso Y");
    expect(await page.textContent('[data-os-sn="time"]')).toMatch(/^há \d+ minutos$/);
    const place = await box.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { left: cs.left, bottom: cs.bottom, position: cs.position };
    });
    expect(place).toEqual({ left: "16px", bottom: "16px", position: "fixed" });
    await page.clock.runFor(1_000);
    expect(await box.evaluate((el) => el.classList.contains("os-show"))).toBe(false);
    await page.clock.runFor(2_000); // segunda
    expect(await box.evaluate((el) => el.classList.contains("os-show"))).toBe(true);
    await page.clock.runFor(1_000 + 2_000 + 500); // não vem terceira (máximo 2)
    expect(await visible()).toBe(false);
    await site.context.close();
  });
});

describe("popup de saída", () => {
  let html: string;
  beforeAll(async () => {
    html = await build(["popup-saida"], async (page) => {
      await setAttrs(page, '[data-os-widget="exit-popup"]', { "data-os-mobile-seconds": "2" });
    });
  }, 60_000);

  const exitIntent = (page: Page) =>
    page.evaluate(() =>
      document.dispatchEvent(new MouseEvent("mouseout", { clientY: -4, relatedTarget: null, bubbles: true })),
    );

  it("abre quando o mouse sai por cima, prende o foco, fecha com Esc e só abre uma vez", async () => {
    const site = await openSite(browser, html, {
      clock: true,
      init: "window.__popups=0;document.addEventListener('os:popup',()=>window.__popups++)",
    });
    const { page } = site;
    const popup = page.locator('[data-os-widget="exit-popup"]');
    expect(await popup.isVisible()).toBe(false);
    // Nos primeiros segundos ainda não vale (evita abrir sem querer).
    await exitIntent(page);
    expect(await popup.isVisible()).toBe(false);
    await page.clock.runFor(3_100);
    await exitIntent(page);
    await page.clock.runFor(100);
    expect(await popup.isVisible()).toBe(true);
    expect(await popup.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Fechar");
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-os-widget="exit-popup"]'))).toBe(true);
    }
    await page.keyboard.press("Escape");
    expect(await popup.isVisible()).toBe(false);
    await exitIntent(page);
    expect(await popup.isVisible()).toBe(false);
    expect(await page.evaluate(() => (window as unknown as { __popups: number }).__popups)).toBe(1);
    // Mesma visita (sessão): não abre de novo nem recarregando.
    await page.reload();
    await page.clock.runFor(4_000);
    await exitIntent(page);
    expect(await popup.isVisible()).toBe(false);
    await site.context.close();
  });

  it("fecha pelo botão, pelo 'Não, obrigado' e clicando fora da caixa", async () => {
    for (const how of ["x", "nao", "fora"] as const) {
      const site = await openSite(browser, html, { clock: true });
      const { page } = site;
      await page.clock.runFor(3_100);
      await exitIntent(page);
      const popup = page.locator('[data-os-widget="exit-popup"]');
      expect(await popup.isVisible()).toBe(true);
      if (how === "x") await page.click('button[aria-label="Fechar"]');
      if (how === "nao") await page.click("text=Não, obrigado");
      if (how === "fora") await page.mouse.click(5, 5);
      expect(await popup.isVisible()).toBe(false);
      expect(page.url()).toBe("http://site.test/oferta");
      await site.context.close();
    }
  });

  it("no celular abre depois do tempo configurado", async () => {
    const site = await openSite(browser, html, {
      clock: true,
      contextOptions: { viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true },
    });
    const popup = site.page.locator('[data-os-widget="exit-popup"]');
    await site.page.clock.runFor(1_500);
    expect(await popup.isVisible()).toBe(false);
    await site.page.clock.runFor(700);
    expect(await popup.isVisible()).toBe(true);
    await site.context.close();
  });

  it("opção 'botão voltar': ao tentar voltar, o popup abre e o visitante fica", async () => {
    const withBack = await build(["popup-saida"], async (page) => {
      await setTrait(page, '[data-os-widget="exit-popup"]', "data-os-back", true);
      await setAttrs(page, '[data-os-widget="exit-popup"]', { "data-os-exit": "0" });
    });
    const site = await openSite(browser, withBack);
    const { page } = site;
    await page.mouse.click(300, 300);
    await page.evaluate(() => history.back());
    await expect.poll(() => page.locator('[data-os-widget="exit-popup"]').isVisible()).toBe(true);
    expect(page.url()).toBe("http://site.test/oferta");
    await site.context.close();
  });
});

describe("formulário de captura", () => {
  const LEAD_LISTENER = "window.__leads=[];document.addEventListener('os:lead',e=>window.__leads.push(e.detail))";

  it("valida em português e não envia nada com erro", async () => {
    const html = await build(["form-captura"], async (page) => {
      await setTrait(page, '[data-os-widget="lead-form"]', "data-os-webhook", "https://hooks.test/lead");
    });
    const site = await openSite(browser, html, { init: LEAD_LISTENER });
    const { page } = site;
    await page.click('button[type="submit"]');
    const errors = await page.$$eval(".os-lf-err", (els) => els.map((e) => e.textContent));
    expect(errors).toEqual(["Digite seu nome.", "Digite seu e-mail.", "Digite seu WhatsApp com DDD."]);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("name"))).toBe("name");
    expect(await page.getAttribute('input[name="name"]', "aria-invalid")).toBe("true");

    await page.fill('input[name="name"]', "Maria");
    await page.fill('input[name="email"]', "maria@gmail");
    await page.fill('input[name="phone"]', "9999");
    await page.click('button[type="submit"]');
    expect(await page.$$eval(".os-lf-err", (els) => els.map((e) => e.textContent))).toEqual([
      "Digite um e-mail válido (ex.: nome@gmail.com).",
      "Digite um WhatsApp válido com DDD (ex.: (11) 91234-5678).",
    ]);
    expect(site.requests.filter((r) => r.url.startsWith("https://hooks.test"))).toHaveLength(0);
    expect(await page.evaluate(() => (window as unknown as { __leads: unknown[] }).__leads)).toHaveLength(0);
    await site.context.close();
  });

  it("envia JSON ao webhook (com UTMs), dispara os:lead e vai para o endereço com os dados", async () => {
    const html = await build(["form-captura"], async (page) => {
      const sel = '[data-os-widget="lead-form"]';
      await setTrait(page, sel, "data-os-webhook", "https://hooks.test/lead");
      await setTrait(page, sel, "os-lf-url", "https://checkout.test/obrigado");
      await setTrait(page, sel, "data-os-pass", true);
    });
    const site = await openSite(browser, html, {
      query: "?utm_source=facebook&utm_campaign=bf&fbclid=abc123&outro=x",
      init: LEAD_LISTENER,
      extra: { "https://checkout.test/": "<!doctype html><title>Obrigado</title><p>ok</p>" },
    });
    const { page } = site;
    await page.fill('input[name="name"]', "Maria Silva");
    await page.fill('input[name="email"]', "maria@gmail.com");
    await page.fill('input[name="phone"]', "11912345678");
    await page.locator('input[name="phone"]').blur();
    expect(await page.inputValue('input[name="phone"]')).toBe("(11) 91234-5678");
    const leads = page.evaluate(
      () =>
        new Promise((resolve) => {
          // os:lead é disparado antes de sair da página.
          const w = window as unknown as { __leads: unknown[] };
          const check = () => (w.__leads.length ? resolve(w.__leads[0]) : setTimeout(check, 5));
          check();
        }),
    );
    await Promise.all([
      page.waitForURL(/checkout\.test/),
      page.click('button[type="submit"]'),
      leads.catch(() => null),
    ]);
    const post = site.requests.find((r) => r.url === "https://hooks.test/lead" && r.method === "POST");
    expect(post?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      name: "Maria Silva",
      email: "maria@gmail.com",
      phone: "(11) 91234-5678",
      utm_source: "facebook",
      utm_campaign: "bf",
      fbclid: "abc123",
      page: "http://site.test/oferta?utm_source=facebook&utm_campaign=bf&fbclid=abc123&outro=x",
    });
    const url = new URL(page.url());
    expect(url.origin + url.pathname).toBe("https://checkout.test/obrigado");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      name: "Maria Silva",
      email: "maria@gmail.com",
      phone: "(11) 91234-5678",
    });
    await site.context.close();
  });

  it("webhook sem CORS: reenvia como formulário simples; sem destino, mostra a mensagem", async () => {
    const html = await build(["form-captura"], async (page) => {
      const sel = '[data-os-widget="lead-form"]';
      await setTrait(page, sel, "data-os-webhook", "https://hooks.test/sem-cors");
      await setTrait(page, sel, "os-field-phone", false);
      await setTrait(page, sel, "data-os-success", "Tudo certo! Veja seu e-mail.");
    });
    const site = await openSite(browser, html, { noCors: ["https://hooks.test/sem-cors"], init: LEAD_LISTENER });
    const { page } = site;
    await page.fill('input[name="name"]', "João");
    await page.fill('input[name="email"]', "joao@uol.com.br");
    await page.click('button[type="submit"]');
    await expect.poll(() => page.locator(".os-lf-ok").textContent()).toBe("Tudo certo! Veja seu e-mail.");
    // O servidor recusa o JSON (CORS); o reenvio chega como formulário simples.
    const posts = site.requests.filter((r) => r.url === "https://hooks.test/sem-cors" && r.method === "POST");
    const last = posts[posts.length - 1];
    expect(last.headers["content-type"]).toMatch(/application\/x-www-form-urlencoded/);
    expect(new URLSearchParams(last.body ?? "").get("email")).toBe("joao@uol.com.br");
    expect(posts.map((p) => p.headers["content-type"]?.split(";")[0])).toEqual([
      "application/json",
      "application/x-www-form-urlencoded",
    ]);
    expect(await page.inputValue('input[name="email"]')).toBe("");
    expect(await page.evaluate(() => (window as unknown as { __leads: { email: string }[] }).__leads[0]?.email)).toBe(
      "joao@uol.com.br",
    );
    await site.context.close();
  });

  it("destino pela página do funil ou por um link da oferta (resolvidos na prévia/ZIP)", async () => {
    const thanks = fakeId("obrigado");
    const toPage = await build(["form-captura"], async (page) => {
      await setTrait(page, '[data-os-widget="lead-form"]', "os-lf-page", thanks);
      await setTrait(page, '[data-os-widget="lead-form"]', "os-field-phone", false);
    });
    expect(toPage).toContain(`action="/p/${thanks}"`);
    const site = await openSite(browser, toPage, { extra: { [`http://site.test/p/${thanks}`]: "<p>obrigado</p>" } });
    await site.page.fill('input[name="name"]', "Ana");
    await site.page.fill('input[name="email"]', "ana@gmail.com");
    await Promise.all([site.page.waitForURL(`http://site.test/p/${thanks}`), site.page.click('button[type="submit"]')]);
    await site.context.close();

    const toLink = await build(
      ["form-captura"],
      async (page) => {
        await setTrait(page, '[data-os-widget="lead-form"]', "data-os-link", "checkout-principal");
      },
      [{ key: "checkout-principal", url: "https://pay.test/abc" }],
    );
    expect(toLink).toContain('action="https://pay.test/abc"');
  });
});

describe("VTurb, WhatsApp, ano e robustez", () => {
  it("VTurb: monta o player e carrega o script oficial (novo e antigo)", async () => {
    const account = "8e0d41ae-6a4d-4f4b-9c56-0e5b1d8c5a11";
    const player = "68a1f2c3d4e5f60718293a4b";
    for (const version of ["v4", "v3"]) {
      const html = await build(["video-vturb"], async (page) => {
        await setAttrs(page, '[data-os-widget="vturb"]', {
          "data-os-account": account,
          "data-os-player": player,
          "data-os-version": version,
        });
      });
      const site = await openSite(browser, html);
      await site.page.waitForTimeout(100);
      if (version === "v4") expect(await site.page.locator(`vturb-smartplayer#vid-${player}`).count()).toBe(1);
      else expect(await site.page.locator(`#vid_${player}`).count()).toBe(1);
      const script = `https://scripts.converteai.net/${account}/players/${player}/${version === "v4" ? "v4/" : ""}player.js`;
      expect(site.requests.map((r) => r.url)).toContain(script);
      await site.context.close();
    }
  });

  it("WhatsApp ligado a um link da oferta usa o endereço do link; o rodapé mostra o ano atual", async () => {
    const html = await build(
      ["whatsapp-botao", "rodape"],
      async (page) => {
        await setTrait(page, '[data-os-widget="whatsapp"]', "data-os-link", "whats");
      },
      [{ key: "whats", url: "https://wa.me/5561999990000" }],
    );
    const site = await openSite(browser, html);
    expect(await site.page.getAttribute('[data-os-widget="whatsapp"]', "href")).toBe("https://wa.me/5561999990000");
    expect(await site.page.textContent("[data-os-year]")).toBe(String(new Date().getFullYear()));
    await site.context.close();
  });

  it("widgets sem configuração não quebram, e o script rodando duas vezes não duplica nada", async () => {
    const bare = `<!doctype html><html><head></head><body>
      <div data-os-widget="countdown"><b data-os-cd="m"></b>:<b data-os-cd="s"></b></div>
      <div data-os-widget="scarcity"><div data-os-sc-fill></div></div>
      <div data-os-widget="sales-notification" hidden></div>
      <div data-os-widget="exit-popup" data-os-seconds="1" hidden><div>Oferta</div></div>
      <form data-os-widget="lead-form"><input type="email" name="email" required><button>ok</button></form>
      <div data-os-widget="vturb"></div>
      <script data-os-runtime>${runtimeScript()}</script></body></html>`;
    const site = await openSite(browser, bare, { clock: true });
    const { page } = site;
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addScriptTag({ content: runtimeScript() });
    await page.clock.runFor(1_200);
    expect(await digits(page)).toMatchObject({ m: "14" });
    expect(await page.locator("#os-widgets-css").count()).toBe(1);
    // O popup sem botão ganha um "Fechar".
    expect(await page.locator('[data-os-widget="exit-popup"] [aria-label="Fechar"]').count()).toBe(1);
    await page.keyboard.press("Escape");
    await page.click("form button");
    expect(await page.locator(".os-lf-err").count()).toBe(1);
    expect(errors).toEqual([]);
    await site.context.close();
  });
});
