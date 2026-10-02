/**
 * Correções G1 — captura (capture.ts):
 * - security#1: "%" solto ou escape Latin-1 no caminho de um arquivo importado não derruba o worker.
 * - security#5: HTML colado com link de origem acentuado não é trocado pelo site ao vivo.
 * - fidelity#0: animações AOS (once: false) ficam visíveis na cópia.
 * - fidelity#3: corpos de texto capturados não são decodificados duas vezes (sites Latin-1).
 * - fidelity#12: o doctype original (ou a falta dele) é mantido.
 * - ux#5: "página quase vazia" é conferida de novo depois de rolar e esperar os scripts.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { putObject } from "@/lib/storage";
import {
  type CaptureOptions,
  capturedContentType,
  capturePage,
  restoreDoctype,
  type VirtualSite,
} from "@/worker/clone/capture";
import { decodeText } from "@/worker/clone/charset";
import { pasteSource } from "@/worker/clone/job";
import { safeDecode } from "@/worker/clone/urls";
import { type FixtureServer, startFixtureServer } from "../fixtures/server";

const LEGACY_DOCTYPE =
  '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">';
const TEXT = `<p>${"Texto da oferta com bastante conteúdo para não parecer vazia. ".repeat(8)}</p>`;
const SLICE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="600" height="200" fill="red"/></svg>')}`;
/** Três fatias de imagem numa tabela, como as páginas antigas feitas no Photoshop/Dreamweaver. */
const SLICES = `<table id="t" cellpadding="0" cellspacing="0" border="0">${`<tr><td><img src="${SLICE}" width="600" height="200"></td></tr>`.repeat(3)}</table>`;
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** AOS 2.x (once: false) resumido: anima ao entrar na tela e desfaz ao sair. */
const MINI_AOS = `<style>[data-aos]{opacity:0;transition:opacity .2s}[data-aos].aos-animate{opacity:1}section{height:1200px}</style>
<script>
  function aosUpdate() {
    document.querySelectorAll("[data-aos]").forEach(function (el) {
      el.classList.add("aos-init");
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight - 50 && r.bottom > 0) el.classList.add("aos-animate");
      else el.classList.remove("aos-animate");
    });
  }
  window.addEventListener("scroll", aosUpdate);
  window.addEventListener("load", aosUpdate);
</script>`;

let browser: Browser;
let pub: http.Server;
let pp = 0;
let fixtures: FixtureServer;

beforeAll(async () => {
  pub = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const html = (body: string) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(body);
    };
    if (url === "/aos") {
      return html(`<!doctype html><html><head><meta charset="utf-8"><title>AOS</title>${MINI_AOS}</head><body>
<section id="s1" data-aos="fade-up">${TEXT}</section><section id="s2" data-aos="fade-up">Benefícios</section>
<section id="s3" data-aos="fade-up">Depoimentos</section><section id="s4" data-aos="zoom-in">Preço e botão</section></body></html>`);
    }
    if (url === "/quirks") {
      return html(
        `<html><head><meta charset="utf-8"><title>Fatias</title></head><body style="margin:0">${SLICES}${TEXT}</body></html>`,
      );
    }
    if (url === "/legado-doctype") {
      return html(
        `${LEGACY_DOCTYPE}\n<html><head><meta charset="utf-8"><title>Antiga</title></head><body style="margin:0">${SLICES}${TEXT}</body></html>`,
      );
    }
    if (url === "/spa-vazio") {
      return html(`<!doctype html><html><head><meta charset="utf-8"><title>App</title>
<script src="/static/js/main.123abc.js"></script><script src="/static/js/chunk-1.js"></script><script src="/static/js/chunk-2.js"></script>
</head><body><div id="root"></div></body></html>`);
    }
    if (url === "/spa-lento") {
      return html(`<!doctype html><html><head><meta charset="utf-8"><title>App</title></head><body><div id="root"></div>
<script>setTimeout(function(){ document.getElementById("root").innerHTML = ${JSON.stringify(TEXT + TEXT)}; }, 1500);</script></body></html>`);
    }
    if (url.startsWith("/static/")) {
      res.statusCode = 404;
      return res.end();
    }
    html(`<!doctype html><html><head><meta charset="utf-8"></head><body><h1>SITE AO VIVO</h1>${TEXT}</body></html>`);
  });
  await new Promise<void>((r) => pub.listen(0, "127.0.0.1", r));
  pp = (pub.address() as AddressInfo).port;
  fixtures = await startFixtureServer();
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => pub?.close(r));
  await fixtures?.close();
});

function capture(url: string, extra: Partial<CaptureOptions> = {}) {
  return capturePage({
    browser,
    device: "desktop",
    url,
    log: () => {},
    hostMap: { "pub.g1.test": "127.0.0.1", "*.fixture.test": "127.0.0.1" },
    maxScrollMs: 3000,
    ...extra,
  });
}

/** Abre um HTML sem JavaScript (como a cópia Editável) e devolve a página. */
async function openStatic(html: string) {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.route("http://render.g1.test/", (route) =>
    route.fulfill({ body: html, contentType: "text/html; charset=utf-8" }),
  );
  await page.goto("http://render.g1.test/");
  return { page, close: () => context.close() };
}

describe("safeDecode", () => {
  it.each([
    ["/desconto-50%.png", "/desconto-50%.png"],
    ["/100%%20natural.jpg", "/100% natural.jpg"],
    ["/promo%C3%A7%C3%A3o", "/promoção"],
    ["/promo%E7%E3o.jpg", "/promo%E7%E3o.jpg"],
    ["/a%C3%A7%E3b", "/aç%E3b"],
    ["/sem-escape", "/sem-escape"],
  ])("%j → %j (nunca lança)", (input, expected) => {
    expect(safeDecode(input)).toBe(expected);
  });
});

describe("importação com % inválido no caminho (security#1)", () => {
  it("'%' solto e escape Latin-1 não derrubam a captura nem a deixam travada", async () => {
    const requested: string[] = [];
    const page = Buffer.from(
      `<!doctype html><html><head><meta charset="utf-8"></head><body>${TEXT}<img src="/desconto-50%.png"><img src="/promo%E7%E3o.png"><img src="/ok.png"></body></html>`,
    );
    const site: VirtualSite = {
      origin: "http://importado.offerstudio",
      get(pathname) {
        requested.push(pathname);
        if (pathname === "/index.html") return { body: page, contentType: "text/html; charset=utf-8" };
        if (pathname.endsWith(".png")) return { body: PNG_1PX, contentType: "image/png" };
        return null;
      },
    };
    const started = Date.now();
    const cap = await capture("http://importado.offerstudio/index.html", { virtualSite: site, maxScrollMs: 300 });
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(requested).toEqual(expect.arrayContaining(["/desconto-50%.png", "/promo%E7%E3o.png", "/ok.png"]));
    expect([...cap.responses.keys()]).toEqual(
      expect.arrayContaining(["http://importado.offerstudio/desconto-50%.png", "http://importado.offerstudio/ok.png"]),
    );
  }, 60_000);

  it("só a origem exata do site virtual é servida localmente", async () => {
    const requested: string[] = [];
    const page = Buffer.from(
      `<!doctype html><html><body>${TEXT}<img src="http://importado.offerstudio.g1.test/outra.png"></body></html>`,
    );
    const site: VirtualSite = {
      origin: "http://importado.offerstudio",
      get(pathname) {
        requested.push(pathname);
        return pathname === "/index.html" ? { body: page, contentType: "text/html; charset=utf-8" } : null;
      },
    };
    // "http://importado.offerstudio.g1.test" começa com a origem, mas é outro endereço.
    await capture("http://importado.offerstudio/index.html", { virtualSite: site, maxScrollMs: 300 });
    expect(requested).not.toContain("/outra.png");
  }, 60_000);
});

describe("HTML colado com link de origem acentuado (security#5)", () => {
  it.each([
    "/promo",
    "/promoção",
    "/oferta 50%25/página",
  ])("base %s: usa o HTML colado, não o site ao vivo", async (path) => {
    const key = `uploads/g1-colado-${Date.now()}.html`;
    await putObject(
      key,
      Buffer.from(
        `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>HTML COLADO</h1>${TEXT}</body></html>`,
      ),
    );
    const baseUrl = new URL(`http://pub.g1.test:${pp}${path}`).href;
    const src = await pasteSource(key, baseUrl);
    const cap = await capture(src.url, { virtualSite: src.site, maxScrollMs: 300 });
    expect(cap.renderedHtml).toContain("HTML COLADO");
    expect(cap.renderedHtml).not.toContain("SITE AO VIVO");
  }, 60_000);
});

describe("animações AOS (fidelity#0)", () => {
  it("todas as seções com data-aos saem visíveis, mesmo as abaixo da dobra", async () => {
    const cap = await capture(`http://pub.g1.test:${pp}/aos`);
    const $ = cheerio.load(cap.renderedHtml);
    const sections = $("[data-aos]");
    expect(sections.length).toBe(4);
    sections.each((_, el) => {
      expect($(el).attr("class") ?? "", $(el).attr("id")).toMatch(/\baos-animate\b/);
    });
    // Sem JavaScript (como no modo Editável), nada fica com opacidade 0.
    const view = await openStatic(cap.renderedHtml);
    try {
      await view.page.waitForTimeout(400);
      const opacities = await view.page.$$eval("[data-aos]", (els) => els.map((e) => getComputedStyle(e).opacity));
      expect(opacities).toEqual(["1", "1", "1", "1"]);
    } finally {
      await view.close();
    }
  }, 60_000);
});

describe("charset dos corpos capturados (fidelity#3)", () => {
  it("site Latin-1: HTML original e CSS capturados sem acentos quebrados", async () => {
    const cap = await capture(fixtures.url("legado"), { maxScrollMs: 500 });
    expect(cap.originalHtml).toContain("<title>Promoção Relâmpago | Loja São João - Açaí e Cia</title>");
    expect(cap.originalHtml).not.toContain("Ã");
    const css = [...cap.responses.values()].find((r) => r.url.endsWith("/sub/css/estilo.css"));
    expect(css).toBeDefined();
    expect(css?.contentType).toMatch(/charset=utf-8/i);
    const text = decodeText(css?.body ?? Buffer.alloc(0), css?.contentType).text;
    expect(text).toContain("Promoção válida até domingo - não perca!");
    expect(text).not.toContain("Ã");
  }, 60_000);

  it("capturedContentType: só troca o charset quando o corpo já veio em UTF-8", () => {
    const utf8 = Buffer.from("a { content: 'promoção' }", "utf8");
    const latin1 = iconv.encode("a { content: 'promoção' }", "latin1");
    expect(capturedContentType("text/css; charset=iso-8859-1", utf8)).toBe("text/css; charset=utf-8");
    expect(capturedContentType("text/css; charset=iso-8859-1", latin1)).toBe("text/css; charset=iso-8859-1");
    expect(capturedContentType("text/html; charset=ISO-8859-1; foo=bar", utf8)).toBe(
      "text/html; foo=bar; charset=utf-8",
    );
    expect(capturedContentType("", utf8, "stylesheet")).toBe("text/css; charset=utf-8");
    expect(capturedContentType("image/png", PNG_1PX)).toBe("image/png");
  });
});

describe("doctype (fidelity#12)", () => {
  it("página sem doctype continua em modo quirks (sem frestas entre as fatias)", async () => {
    const cap = await capture(`http://pub.g1.test:${pp}/quirks`, { maxScrollMs: 300 });
    expect(cap.renderedHtml.trimStart().toLowerCase().startsWith("<!doctype")).toBe(false);
    // O cheerio (usado na montagem) mantém a falta de doctype.
    const built = cheerio.load(cap.renderedHtml).html();
    const view = await openStatic(built);
    try {
      expect(await view.page.evaluate(() => document.compatMode)).toBe("BackCompat");
      expect(await view.page.$eval("#t", (t) => t.getBoundingClientRect().height)).toBe(600);
    } finally {
      await view.close();
    }
  }, 60_000);

  it("doctype antigo (HTML 4.01 Transitional) é mantido por inteiro (modo quase-padrão, sem frestas)", async () => {
    const cap = await capture(`http://pub.g1.test:${pp}/legado-doctype`, { maxScrollMs: 300 });
    // O navegador guarda o nome do doctype em minúsculas; é o mesmo doctype.
    expect(cap.renderedHtml.slice(0, LEGACY_DOCTYPE.length).toLowerCase()).toBe(LEGACY_DOCTYPE.toLowerCase());
    // Depois da montagem com o cheerio, restoreDoctype devolve o doctype completo.
    const built = restoreDoctype(cheerio.load(cap.renderedHtml).html(), cap.renderedHtml);
    const view = await openStatic(built);
    try {
      expect(await view.page.$eval("#t", (t) => t.getBoundingClientRect().height)).toBe(600);
    } finally {
      await view.close();
    }
    // Sem restaurar, o cheerio deixaria <!DOCTYPE html> e as fatias ganhariam frestas.
    const standards = await openStatic(cheerio.load(cap.renderedHtml).html());
    try {
      expect(await standards.page.$eval("#t", (t) => t.getBoundingClientRect().height)).toBeGreaterThan(600);
    } finally {
      await standards.close();
    }
  }, 60_000);

  it("restoreDoctype devolve o doctype que o cheerio troca por <!DOCTYPE html>", () => {
    const source = `<!-- salvo -->\n${LEGACY_DOCTYPE}\n<html><head></head><body><p>x</p></body></html>`;
    const serialized = cheerio.load(source).html();
    expect(serialized).toContain("<!DOCTYPE html>");
    const restored = restoreDoctype(serialized, source);
    expect(restored).toContain(LEGACY_DOCTYPE);
    expect(restored).not.toContain("<!DOCTYPE html>");
    expect(restored).toContain("<p>x</p>");
    // Sem doctype na origem: nenhum na saída.
    expect(restoreDoctype("<!DOCTYPE html>\n<html><body>y</body></html>", "<html><body>y</body></html>")).toBe(
      "<html><body>y</body></html>",
    );
    // Saída sem doctype, origem com: o doctype volta no início.
    expect(restoreDoctype("<html></html>", `${LEGACY_DOCTYPE}<html></html>`)).toBe(`${LEGACY_DOCTYPE}\n<html></html>`);
  });
});

describe("página quase vazia (ux#5)", () => {
  it("app cujo JavaScript não carrega continua marcada como quase vazia depois de rolar", async () => {
    const cap = await capture(`http://pub.g1.test:${pp}/spa-vazio`, { maxScrollMs: 300 });
    expect(cap.protection?.kind).toBe("EMPTY_SHELL");
  }, 60_000);

  it("app que monta o conteúdo com atraso deixa de ser 'quase vazia'", async () => {
    const cap = await capture(`http://pub.g1.test:${pp}/spa-lento`, { maxScrollMs: 2500 });
    expect(cap.renderedHtml).toContain("Texto da oferta");
    expect(cap.protection ?? null).toBeNull();
  }, 60_000);
});
