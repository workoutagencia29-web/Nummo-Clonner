/**
 * Revisão da Fase 3 (grupo W): script das páginas num Chromium de verdade.
 *
 * - #44 popup de saída e notificação soltos numa seção com delay ou com
 *   transform: aparecem na tela inteira / no canto (e nunca travam a rolagem à toa);
 * - #48 notificação não cobre o WhatsApp flutuante;
 * - #50 delay de VSL lembrado por tempo (o de 600 s não aparece junto com o de 1 s);
 * - #45 cópias "Preservar JS": a compatibilidade não desfaz o que o script
 *   original fez (com o marcador <meta> e, nas cópias antigas, sem ele);
 * - #52 capa "clique para carregar" com imagem: o vídeo mantém o tamanho;
 * - #54 vídeo (arquivo) com "tocar sozinho" salvo sem "sem som": tenta de novo mudo;
 * - #55 endereço do formulário sem https:// não vira caminho da página;
 * - #56 na prévia do painel, o destino externo do formulário abre em aba nova;
 * - #57 contador: a caixa "dias" já nasce escondida (sem JavaScript também);
 * - #34 formulário sem webhook nem destino nunca diz que enviou.
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { injectRuntime, runtimeScript } from "@/lib/runtime-bundle";
import { addBlock, exportPage, openEditor, openSite, setTrait } from "./blocks-harness";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

const RUNTIME_TAG = () => `<script data-os-runtime>${runtimeScript()}</script>`;

/** Página com o script das páginas e o estilo de delay (como a prévia/ZIP). */
function doc(body: string, head = "") {
  return injectRuntime(
    `<!doctype html><html><head><meta charset="utf-8">${head}</head><body style="margin:0">${body}</body></html>`,
    RUNTIME_TAG(),
  );
}

async function build(blocks: string[], configure?: (page: Page) => Promise<void>) {
  const page = await openEditor(browser);
  for (const id of blocks) await addBlock(page, id);
  if (configure) await configure(page);
  const html = await exportPage(page);
  await page.close();
  return html;
}

/** As transições de CSS (aviso subindo/aparecendo) correm no tempo real, não no relógio falso. */
const settle = (page: Page) => page.waitForTimeout(500);

const rect = (page: Page, sel: string) =>
  page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height };
  });

// ─── #44 ─────────────────────────────────────────────────────────────────────

const POPUP = `<div id="pop" data-os-widget="exit-popup" data-os-seconds="2" data-os-exit="0" role="dialog" aria-modal="true" hidden>
  <div style="background:#fff;padding:24px;max-width:400px"><p>Oferta especial</p><button type="button" data-os-close>Não, obrigado</button></div>
</div>`;
const NOTIFICATION = `<div id="sn" data-os-widget="sales-notification" data-os-people="Lia - Natal" data-os-start="1" data-os-duration="30" role="status" hidden>
  <div style="background:#fff;padding:12px"><strong data-os-sn="title">x</strong> <span data-os-sn="text">y</span></div>
</div>`;

describe("#44 popup e notificação fora do lugar em que foram soltos", () => {
  it("dentro de uma seção com delay ainda escondida: o popup abre na tela inteira, com foco no botão", async () => {
    const html = doc(
      `<section id="vsl" data-os-delay="60" style="padding:40px">${POPUP}${NOTIFICATION}</section><div style="height:3000px">texto</div>`,
    );
    const site = await openSite(browser, html, { clock: true });
    const { page } = site;
    await page.clock.runFor(1_200);
    // Notificação no canto da tela, visível, mesmo com a seção escondida.
    expect(
      await page.$eval("#sn", (el) => el.parentElement === document.body && el.classList.contains("os-show")),
    ).toBe(true);
    const sn = await rect(page, "#sn");
    expect(sn.height).toBeGreaterThan(20);
    expect(sn.left).toBe(16);
    expect(Math.round(sn.bottom)).toBeLessThanOrEqual(800);
    expect(Math.round(sn.bottom)).toBeGreaterThan(700);

    await page.clock.runFor(1_500);
    expect(await page.locator("#vsl").isVisible()).toBe(false);
    expect(await page.locator("#pop").isVisible()).toBe(true);
    expect(await rect(page, "#pop")).toMatchObject({ top: 0, left: 0, width: 1280, height: 800 });
    expect(await page.evaluate(() => document.documentElement.classList.contains("os-lock"))).toBe(true);
    expect(await page.evaluate(() => !!document.activeElement?.closest("#pop"))).toBe(true);
    // Fechar destrava a rolagem.
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.classList.contains("os-lock"))).toBe(false);
    await site.context.close();
  });

  it("dentro de uma seção com transform e overflow:hidden: cobre a tela, não só a seção", async () => {
    const html = doc(
      `<div style="height:300px"></div><section style="transform:translateY(0);overflow:hidden;height:220px;position:relative">${POPUP}${NOTIFICATION}</section><div style="height:2000px"></div>`,
    );
    const site = await openSite(browser, html, { clock: true });
    const { page } = site;
    await page.clock.runFor(2_500);
    await settle(page);
    expect(await rect(page, "#pop")).toMatchObject({ top: 0, left: 0, width: 1280, height: 800 });
    const sn = await rect(page, "#sn");
    expect(sn.left).toBe(16);
    expect(Math.round(sn.bottom)).toBe(800 - 16);
    await site.context.close();
  });
});

// ─── #48 ─────────────────────────────────────────────────────────────────────

describe("#48 notificação e WhatsApp flutuante", () => {
  let html: string;
  let htmlRight: string;
  beforeAll(async () => {
    html = await build(["notificacao-compra", "whatsapp-flutuante"], async (page) => {
      await setTrait(page, '[data-os-widget="sales-notification"]', "data-os-start", "1");
    });
    htmlRight = await build(["notificacao-compra", "whatsapp-flutuante"], async (page) => {
      await setTrait(page, '[data-os-widget="sales-notification"]', "data-os-start", "1");
      await setTrait(page, '[data-os-widget="sales-notification"]', "data-os-position", "right");
    });
  }, 120_000);

  async function check(page: Page) {
    await page.clock.runFor(1_600);
    await settle(page);
    const sn = page.locator('[data-os-widget="sales-notification"]');
    expect(await sn.evaluate((el) => el.classList.contains("os-show"))).toBe(true);
    const wa = await rect(page, '[data-os-widget="whatsapp"]');
    const box = await rect(page, '[data-os-widget="sales-notification"]');
    // O aviso fica acima do botão, e o toque no botão chega ao botão.
    expect(box.bottom).toBeLessThanOrEqual(wa.top);
    const hit = await page.evaluate(
      ([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-os-widget="whatsapp"]'),
      [wa.left + wa.width / 2, wa.top + wa.height / 2],
    );
    expect(hit).toBe(true);
  }

  it("no celular (390 px) o aviso sobe e não rouba o toque do WhatsApp", async () => {
    const site = await openSite(browser, html, {
      clock: true,
      contextOptions: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    });
    await check(site.page);
    await site.context.close();
  });

  it("no computador com o aviso à direita também", async () => {
    const site = await openSite(browser, htmlRight, { clock: true });
    await check(site.page);
    await site.context.close();
  });

  it("no computador, aviso à esquerda e WhatsApp à direita: o aviso fica no lugar de sempre", async () => {
    const site = await openSite(browser, html, { clock: true });
    await site.page.clock.runFor(1_600);
    await settle(site.page);
    expect(Math.round((await rect(site.page, '[data-os-widget="sales-notification"]')).bottom)).toBe(800 - 16);
    await site.context.close();
  });
});

// ─── #50 ─────────────────────────────────────────────────────────────────────

describe("#50 delay de VSL por tempo", () => {
  it("recarregar depois do primeiro não revela o de 600 s", async () => {
    const html = doc('<div id="a" data-os-delay="1">Botão</div><div id="b" data-os-delay="600">Preço</div>');
    const site = await openSite(browser, html);
    const { page } = site;
    const shown = () => page.$$eval("#a, #b", (els) => els.map((e) => getComputedStyle(e).display));
    expect(await shown()).toEqual(["none", "none"]);
    await expect.poll(shown, { timeout: 3_000 }).toEqual(["block", "none"]);
    await page.reload();
    // O de 1 s volta na hora (já foi visto nesta visita); o de 600 s continua esperando.
    expect(await shown()).toEqual(["block", "none"]);
    await page.waitForTimeout(300);
    expect(await shown()).toEqual(["block", "none"]);
    await site.context.close();
  });
});

// ─── #45 ─────────────────────────────────────────────────────────────────────

/** Scripts originais parecidos com o menu do Elementor Pro e o collapse do Bootstrap 5. */
const ORIGINAL_MENU = `<script>
document.getElementById("menu").addEventListener("click", function () {
  var on = !this.classList.contains("elementor-active");
  this.classList.toggle("elementor-active", on);
  this.setAttribute("aria-expanded", String(on));
  document.getElementById("nav").style.display = on ? "block" : "none";
});
</script>`;
const ORIGINAL_COLLAPSE = `<script>
document.addEventListener("click", function (e) {
  var t = e.target.closest('[data-bs-toggle="collapse"]');
  if (!t) return;
  if (t.tagName === "A") e.preventDefault();
  var el = document.querySelector(t.getAttribute("data-bs-target"));
  var open = !el.classList.contains("show");
  el.classList.toggle("show", open);
  t.setAttribute("aria-expanded", String(open));
});
</script>`;
const WIDGETS = `<style>.collapse:not(.show){display:none}</style>
<button class="elementor-menu-toggle" id="menu" aria-expanded="false">Menu</button>
<nav id="nav" style="display:none">Links</nav>
<button id="q" type="button" data-bs-toggle="collapse" data-bs-target="#ans" aria-expanded="false">Pergunta</button>
<div id="ans" class="collapse">Resposta</div>`;

describe("#45 cópias 'Preservar JS' e a compatibilidade do modo Editável", () => {
  async function run(html: string) {
    const site = await openSite(browser, html);
    const { page } = site;
    const visible = (sel: string) => page.locator(sel).isVisible();
    await page.click("#menu");
    const menu = { nav: await visible("#nav"), active: await page.getAttribute("#menu", "class") };
    await page.click("#q");
    const opened = await visible("#ans");
    await page.click("#q");
    const closed = !(await visible("#ans"));
    await site.context.close();
    return { menu, opened, closed };
  }

  it("com o marcador <meta name=os-preserve-js>: menu e FAQ abrem e fecham como no original", async () => {
    const html = doc(`${WIDGETS}${ORIGINAL_MENU}${ORIGINAL_COLLAPSE}`, '<meta name="os-preserve-js" content="1">');
    const r = await run(html);
    expect(r.menu).toEqual({ nav: true, active: "elementor-menu-toggle elementor-active" });
    expect(r.opened).toBe(true);
    expect(r.closed).toBe(true);
  });

  it("cópia antiga sem o marcador: o clique já tratado pelo script original não é desfeito", async () => {
    const r = await run(doc(`${WIDGETS}${ORIGINAL_MENU}${ORIGINAL_COLLAPSE}`));
    expect(r.menu).toEqual({ nav: true, active: "elementor-menu-toggle elementor-active" });
    expect(r.opened).toBe(true);
    expect(r.closed).toBe(true);
  });

  it("script original delegado no document carregado depois do script das páginas", async () => {
    const base = `<!doctype html><html><head><meta charset="utf-8"></head><body>${WIDGETS}${ORIGINAL_MENU}`;
    const html = `${base}${RUNTIME_TAG()}${ORIGINAL_COLLAPSE}</body></html>`;
    const r = await run(html);
    expect(r.opened).toBe(true);
    expect(r.closed).toBe(true);
  });

  it("modo Editável (sem scripts originais): a compatibilidade continua abrindo e fechando", async () => {
    const r = await run(doc(WIDGETS));
    expect(r.menu.active).toBe("elementor-menu-toggle elementor-active");
    expect(r.opened).toBe(true);
    expect(r.closed).toBe(true);
  });
});

// ─── #52 ─────────────────────────────────────────────────────────────────────

describe("#52 capa 'clique para carregar' com imagem", () => {
  it("o vídeo fica do tamanho que a capa tinha (não some com 0 px)", async () => {
    const thumb = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#333"/></svg>')}`;
    const html = doc(
      `<div id="f" style="width:640px" data-youtube-id="aqz-KE-bpKQ" data-os-embed="https://www.youtube.com/embed/aqz-KE-bpKQ?autoplay=1"><img src="${thumb}" alt="" style="display:block;width:100%;height:auto"><button type="button">▶</button></div><p id="depois">Texto depois</p>`,
    );
    const site = await openSite(browser, html);
    const { page } = site;
    await page.waitForFunction(() => (document.querySelector("#f img") as HTMLImageElement).complete);
    const before = await rect(page, "#f");
    expect(before.height).toBeGreaterThan(300);
    await page.click("#f img");
    const frame = await rect(page, "#f iframe");
    expect(frame.width).toBe(640);
    expect(Math.abs(frame.height - before.height)).toBeLessThan(2);
    expect((await rect(page, "#depois")).top).toBeGreaterThanOrEqual(before.bottom - 1);
    await site.context.close();
  });

  it("capa sem altura nenhuma continua ganhando 16:9", async () => {
    const html = doc(
      '<div style="width:640px"><div id="f" data-os-embed="https://www.youtube.com/embed/aqz-KE-bpKQ"><span style="position:absolute">▶</span></div></div>',
    );
    const site = await openSite(browser, html);
    await site.page.click("#f span");
    expect(Math.round((await rect(site.page, "#f iframe")).height)).toBe(360);
    await site.context.close();
  });
});

// ─── #54 ─────────────────────────────────────────────────────────────────────

describe("#54 vídeo (arquivo) com tocar sozinho", () => {
  it("página salva sem 'sem som': o navegador recusa e o script tenta de novo mudo", async () => {
    const html = doc(
      '<video id="v1" data-os-file autoplay playsinline src="/v.mp4"></video><video id="v2" data-os-file autoplay muted src="/v.mp4"></video><video id="v3" data-os-file src="/v.mp4"></video>',
    );
    const site = await openSite(browser, html, {
      init: `window.__plays = [];
        HTMLMediaElement.prototype.play = function () {
          window.__plays.push(this.id + ":" + (this.muted ? "mudo" : "som"));
          return this.muted ? Promise.resolve() : Promise.reject(new DOMException("bloqueado", "NotAllowedError"));
        };`,
    });
    const { page } = site;
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __plays: string[] }).__plays))
      .toEqual(["v1:som", "v1:mudo"]);
    expect(await page.$eval("#v1", (v) => (v as HTMLVideoElement).muted)).toBe(true);
    expect(await page.$eval("#v3", (v) => (v as HTMLVideoElement).muted)).toBe(false);
    await site.context.close();
  });
});

// ─── #55 / #56 / #34 formulário ──────────────────────────────────────────────

const FORM = (attrs: string) =>
  `<form data-os-widget="lead-form" data-os-success="Pronto! Recebemos seus dados." ${attrs}><input type="email" name="email" required><button type="submit">Enviar</button></form>`;

async function fillAndSend(page: Page) {
  await page.fill('input[name="email"]', "ana@gmail.com");
  await page.click('button[type="submit"]');
}

describe("#55 endereço do formulário sem https://", () => {
  it("página salva com 'destino.test/obrigado' vai para https://destino.test/obrigado (não para /oferta/destino.test/…)", async () => {
    const site = await openSite(browser, doc(FORM('action="destino.test/obrigado"')), {
      extra: { "https://destino.test/": "<p>obrigado</p>" },
    });
    await Promise.all([site.page.waitForURL("https://destino.test/obrigado"), fillAndSend(site.page)]);
    await site.context.close();
  });

  it("action javascript: não executa nada", async () => {
    const site = await openSite(browser, doc(FORM('action="javascript:window.__pwned=1"')));
    await fillAndSend(site.page);
    await expect.poll(() => site.page.locator(".os-lf-ok").count()).toBe(1);
    expect(await site.page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(site.page.url()).toBe("http://site.test/oferta");
    await site.context.close();
  });
});

describe("#34 formulário sem webhook nem destino", () => {
  it("na página publicada: mensagem neutra, nunca o texto de sucesso", async () => {
    const site = await openSite(browser, doc(FORM('data-os-webhook="" action=""')));
    await fillAndSend(site.page);
    const ok = site.page.locator(".os-lf-ok");
    await expect.poll(() => ok.textContent()).toBe("Obrigado!");
    expect(await ok.getAttribute("class")).toBe("os-lf-ok");
    expect(site.requests.filter((r) => r.method === "POST")).toHaveLength(0);
    await site.context.close();
  });

  it("com webhook digitado sem https://: envia e mostra o texto de sucesso", async () => {
    const site = await openSite(browser, doc(FORM('data-os-webhook="hooks.test/lead"')));
    await fillAndSend(site.page);
    await expect.poll(() => site.page.locator(".os-lf-ok").textContent()).toBe("Pronto! Recebemos seus dados.");
    expect(site.requests.some((r) => r.url === "https://hooks.test/lead" && r.method === "POST")).toBe(true);
    expect(await site.page.locator(".os-lf-warn").count()).toBe(0);
    await site.context.close();
  });

  it("na prévia (*.localhost): avisa quem monta a página que nada foi enviado", async () => {
    const context = await browser.newContext();
    await context.route("**/*", (route) =>
      route.fulfill({ contentType: "text/html", body: doc(FORM('data-os-webhook=""')) }),
    );
    const page = await context.newPage();
    await page.goto("http://tok.localhost/");
    await fillAndSend(page);
    await expect
      .poll(() => page.locator(".os-lf-ok").textContent())
      .toMatch(/^Prévia: este formulário ainda não envia/);
    expect(await page.locator(".os-lf-ok").getAttribute("class")).toBe("os-lf-ok os-lf-warn");
    await context.close();
  });
});

describe("#56 destino externo do formulário na prévia do painel", () => {
  it("abre em aba nova e o quadro da prévia continua na página", async () => {
    const context = await browser.newContext();
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "painel.localhost") {
        return route.fulfill({
          contentType: "text/html",
          body: '<iframe id="f" src="http://tok.localhost/" style="width:600px;height:400px"></iframe>',
        });
      }
      if (url.hostname === "tok.localhost") {
        return route.fulfill({
          contentType: "text/html",
          body: doc(FORM('action="https://pay.example.com/checkout"')),
        });
      }
      return route.fulfill({ contentType: "text/html", body: "<p>checkout</p>" });
    });
    const tab = await context.newPage();
    await tab.goto("http://painel.localhost/");
    const frame = tab.frameLocator("#f");
    await frame.locator('input[name="email"]').fill("ana@gmail.com");
    const popupPromise = context.waitForEvent("page");
    await frame.locator('button[type="submit"]').click();
    const popup = await popupPromise;
    expect(popup.url()).toBe("https://pay.example.com/checkout");
    expect(tab.frames()[1]?.url()).toBe("http://tok.localhost/");
    await expect.poll(() => frame.locator(".os-lf-ok").textContent()).toBe("Pronto! Recebemos seus dados.");
    await context.close();
  });
});

// ─── #57 ─────────────────────────────────────────────────────────────────────

describe("#57 contador: caixa 'dias'", () => {
  it("a regra vai no CSS da página: sem JavaScript a caixa 'dias' já está escondida", async () => {
    const html = await build(["contador"]);
    // No CSS da página (fora do script embutido, que tem a mesma regra).
    const pageCss = html.replace(/<script data-os-runtime>[\s\S]*?<\/script>/, "");
    expect(pageCss).toMatch(/\[data-os-cd-days="0"\]\s*\[data-os-cd-unit="?d"?\]\s*\{\s*display:\s*none\s*!important/);
    const site = await openSite(browser, html, { contextOptions: { javaScriptEnabled: false } });
    const display = (u: string) => site.page.$eval(`[data-os-cd-unit="${u}"]`, (el) => getComputedStyle(el).display);
    expect(await display("d")).toBe("none");
    expect(await display("h")).toBe("flex");
    await site.context.close();
  });

  it("com JavaScript o script só troca o atributo: mais de um dia mostra a caixa", async () => {
    const html = await build(["contador"], async (page) => {
      await setTrait(page, '[data-os-widget="countdown"]', "data-os-mode", "date");
      await setTrait(page, '[data-os-widget="countdown"]', "data-os-until", "2099-12-31T23:59");
    });
    const site = await openSite(browser, html);
    await site.page.waitForTimeout(100);
    expect(await site.page.getAttribute('[data-os-widget="countdown"]', "data-os-cd-days")).toBe("1");
    expect(await site.page.locator('[data-os-cd-unit="d"]').isVisible()).toBe(true);
    expect(await site.page.$eval('[data-os-cd-unit="d"]', (el) => (el as HTMLElement).style.display)).toBe("");
    await site.context.close();

    const short = await openSite(browser, await build(["contador"]));
    await short.page.waitForTimeout(100);
    expect(await short.page.getAttribute('[data-os-widget="countdown"]', "data-os-cd-days")).toBe("0");
    expect(await short.page.locator('[data-os-cd-unit="d"]').isVisible()).toBe(false);
    await short.context.close();
  });
});
