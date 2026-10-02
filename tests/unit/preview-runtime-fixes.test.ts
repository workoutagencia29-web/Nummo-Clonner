/**
 * Correções da revisão da Fase 2 que ficaram na prévia e no script das páginas:
 * - arquivos de "Preservar JS" com caminhos codificados (%20, acentos, "%" solto);
 * - doctype original preservado ao aplicar links da oferta e ao salvar no editor;
 * - data-os-href só navega para http(s) (nada de javascript:);
 * - na prévia dentro do painel (iframe), links externos abrem em aba nova.
 */
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finalizeFromEditor } from "@/lib/editor-html";
import { applyOfferLinks, bindUrlToLink } from "@/lib/offer-links";
import { runtimeScript } from "@/lib/runtime-bundle";
import { findMappedAsset } from "@/preview/asset-map";

describe("findMappedAsset", () => {
  const map = {
    "/fotos/foto%201.jpg": "a/aa/one.jpg",
    "/promo%C3%A7%C3%A3o.png": "a/bb/two.png",
    "/app.js?v=3": "a/cc/three.js",
    "/desconto-50%.png": "a/dd/four.png",
  };

  it("acha pelo caminho codificado, como o navegador pede", () => {
    expect(findMappedAsset(map, new URL("http://t.localhost/fotos/foto%201.jpg"))).toBe("a/aa/one.jpg");
    expect(findMappedAsset(map, new URL("http://t.localhost/promoção.png"))).toBe("a/bb/two.png");
  });

  it("considera a query string", () => {
    expect(findMappedAsset(map, new URL("http://t.localhost/app.js?v=3"))).toBe("a/cc/three.js");
    expect(findMappedAsset(map, new URL("http://t.localhost/app.js?v=4"))).toBeUndefined();
  });

  it("'%' solto no nome não quebra", () => {
    expect(findMappedAsset(map, new URL("http://t.localhost/desconto-50%.png"))).toBe("a/dd/four.png");
    expect(findMappedAsset(map, new URL("http://t.localhost/nada%zz.png"))).toBeUndefined();
  });
});

describe("doctype preservado", () => {
  const legacy =
    '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">\n<html><head></head><body><a href="https://pay.hotmart.com/X1" data-os-link="checkout">Comprar</a></body></html>';

  it("applyOfferLinks e bindUrlToLink mantêm o doctype antigo (e a ausência dele)", () => {
    const out = applyOfferLinks(legacy, [{ key: "checkout", url: "https://pay.kiwify.com.br/abc" }]);
    expect(out.startsWith('<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">')).toBe(true);
    expect(out).toContain("https://pay.kiwify.com.br/abc");

    const quirks = '<html><body><a href="https://pay.hotmart.com/X1" data-os-link="checkout">Comprar</a></body></html>';
    const noDoctype = applyOfferLinks(quirks, [{ key: "checkout", url: "https://pay.kiwify.com.br/abc" }]);
    expect(noDoctype.toLowerCase()).not.toContain("<!doctype");

    const bound = bindUrlToLink(legacy, "https://pay.hotmart.com/X1", "outro");
    expect(bound.count).toBe(1);
    expect(bound.html.startsWith("<!DOCTYPE HTML PUBLIC")).toBe(true);
  });

  it("salvar no editor devolve o doctype do HTML anterior; página nova ganha <!DOCTYPE html>", () => {
    const exported = "<html><head></head><body><h1>Oi</h1></body></html>";
    expect(finalizeFromEditor(exported, "", legacy).startsWith("<!DOCTYPE HTML PUBLIC")).toBe(true);
    expect(finalizeFromEditor(exported, "", "<html><body>quirks</body></html>").toLowerCase()).not.toContain(
      "<!doctype",
    );
    expect(finalizeFromEditor(exported, "").startsWith("<!DOCTYPE html>")).toBe(true);
  });
});

describe("script das páginas: navegação segura", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  const page = (body: string) =>
    `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${body}<script>${runtimeScript()}</script></body></html>`;

  it("data-os-href com javascript: não executa; http(s) e âncora navegam", async () => {
    const context = await browser.newContext();
    const tab = await context.newPage();
    await tab.route("http://site.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: route.request().url().endsWith("/destino")
          ? "<p>destino</p>"
          : page(
              '<div id="mal" data-os-href="javascript:window.__pwned=1">x</div><div id="rel" data-os-href="/destino">ir</div>',
            ),
      }),
    );
    await tab.goto("http://site.test/");
    await tab.click("#mal");
    await tab.waitForTimeout(150);
    expect(await tab.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(tab.url()).toBe("http://site.test/");
    await tab.click("#rel");
    await tab.waitForURL("http://site.test/destino");
    await context.close();
  });

  it("na prévia (iframe em *.localhost), link externo abre em aba nova e o quadro continua", async () => {
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
          body: page('<a id="ext" href="https://pay.example.com/checkout">Comprar</a><a id="int" href="/p2">P2</a>'),
        });
      }
      return route.fulfill({ contentType: "text/html", body: "<p>checkout</p>" });
    });
    const tab = await context.newPage();
    await tab.goto("http://painel.localhost/");
    const frame = tab.frameLocator("#f");
    const popupPromise = context.waitForEvent("page");
    await frame.locator("#ext").click();
    const popup = await popupPromise;
    expect(popup.url()).toBe("https://pay.example.com/checkout");
    expect(tab.frames()[1]?.url()).toBe("http://tok.localhost/");
    await context.close();
  });
});
