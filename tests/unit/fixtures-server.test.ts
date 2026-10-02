/**
 * Testes de fumaça do servidor de sites de teste (tests/fixtures/server.ts)
 * e da integridade dos próprios sites/ZIPs usados pelo clonador.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import * as cheerio from "cheerio";
import * as csstree from "css-tree";
import iconv from "iconv-lite";
import { Agent, request } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import yauzl from "yauzl";
import { buildZip, SLIP_ENTRIES } from "../fixtures/make-zips";
import {
  type FixtureServer,
  fixtureChromiumArgs,
  fixtureLookup,
  SITES_DIR,
  siteNameFromHost,
  startFixtureServer,
  ZIPS_DIR,
} from "../fixtures/server";

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

let srv: FixtureServer;

beforeAll(async () => {
  srv = await startFixtureServer();
});

afterAll(async () => {
  await srv.close();
});

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** GET direto em 127.0.0.1 com o cabeçalho Host do site (caminho enviado cru). */
function get(site: string, urlPath = "/", opts: { ua?: string; method?: string } = {}): Promise<Res> {
  const host = site.includes(".") ? site : `${site}.fixture.test`;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: srv.port,
        path: urlPath,
        method: opts.method ?? "GET",
        setHost: false,
        headers: { Host: `${host}:${srv.port}`, "User-Agent": opts.ua ?? DESKTOP_UA },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function siteNames(): string[] {
  return readdirSync(SITES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

describe("startFixtureServer", () => {
  it("monta URLs com o domínio .fixture.test e a porta real", () => {
    expect(srv.port).toBeGreaterThan(0);
    expect(srv.url("vendas")).toBe(`http://vendas.fixture.test:${srv.port}/`);
    expect(srv.url("vendas.fixture.test", "upsell")).toBe(`http://vendas.fixture.test:${srv.port}/upsell`);
    expect(srv.url("vsl", "/css/vsl.css")).toBe(`http://vsl.fixture.test:${srv.port}/css/vsl.css`);
    expect(fixtureChromiumArgs()).toEqual(["--host-resolver-rules=MAP *.fixture.test 127.0.0.1"]);
  });

  it("extrai o nome do site do Host", () => {
    expect(siteNameFromHost("vendas.fixture.test:1234")).toBe("vendas");
    expect(siteNameFromHost("VSL.Fixture.Test")).toBe("vsl");
    expect(siteNameFromHost("exemplo.com.br")).toBeNull();
    expect(siteNameFromHost("a.b.fixture.test")).toBeNull();
  });

  it("tem os 10 sites pedidos (e o site lento)", () => {
    expect(siteNames()).toEqual(
      expect.arrayContaining([
        "vendas",
        "vsl",
        "rastreadores",
        "checkouts",
        "legado",
        "quiz",
        "celular",
        "protegido",
        "grande",
        "shadow",
        "lento",
      ]),
    );
  });

  it.each(siteNames().filter((s) => s !== "protegido"))("serve o index de %s como HTML", async (site) => {
    const res = await get(site);
    expect(res.status).toBe(200);
    const charset = site === "legado" ? "iso-8859-1" : "utf-8";
    expect(res.headers["content-type"]).toBe(`text/html; charset=${charset}`);
    expect(res.body.toString("latin1")).toMatch(/<html/i);
  });

  it.each([
    ["vendas", "/wp-content/themes/oferta/style.css?ver=1.0.3", "text/css; charset=utf-8"],
    ["vendas", "/wp-content/themes/oferta/fonts/inter-latin-wght-normal.woff2", "font/woff2"],
    ["vendas", "/wp-content/uploads/2024/01/cropped-favicon-32x32.png", "image/png"],
    ["vendas", "/wp-content/uploads/2024/05/produto-mockup.jpg", "image/jpeg"],
    ["vendas", "/wp-content/uploads/2024/05/produto-mockup.webp", "image/webp"],
    ["vendas", "/wp-content/themes/oferta/assets/js/contador.js?ver=1.0.3", "text/javascript; charset=utf-8"],
    ["vsl", "/midia/depoimento.mp4", "video/mp4"],
    ["rastreadores", "/assets/js/main.js", "text/javascript; charset=utf-8"],
    ["legado", "/sub/img/selo.gif", "image/gif"],
    ["legado", "/sub/css/estilo.css", "text/css; charset=iso-8859-1"],
    ["legado", "/sub/js/antigo.js", "text/javascript; charset=iso-8859-1"],
  ])("%s%s → %s", async (site, p, type) => {
    const res = await get(site, p);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe(type);
    expect(Number(res.headers["content-length"])).toBe(res.body.length);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("serve a página de uma pasta com e sem barra no fim", async () => {
    const a = await get("vendas", "/upsell");
    const b = await get("vendas", "/upsell/");
    const c = await get("vendas", "/obrigado");
    expect(a.status).toBe(200);
    expect(a.body.equals(b.body)).toBe(true);
    expect(a.body.toString()).toContain("Kit Festas Lucrativas");
    expect(c.body.toString()).toContain("Sua compra foi confirmada");
  });

  it("troca __ORIGIN__ pela origem real nos arquivos de texto", async () => {
    const html = (await get("vendas")).body.toString();
    expect(html).not.toContain("__ORIGIN__");
    const $ = cheerio.load(html);
    expect($('meta[property="og:image"]').attr("content")).toBe(
      srv.url("vendas", "/wp-content/uploads/2024/05/og-oferta.jpg"),
    );
    const css = (await get("vendas", "/wp-content/uploads/elementor/css/post-12.css")).body.toString();
    expect(css).toContain(`url("${srv.url("vendas", "/wp-content/uploads/2024/05/fundo-oferta.jpg")}")`);
  });

  it("responde 404 para arquivo inexistente, site desconhecido e arquivos internos", async () => {
    expect((await get("vendas", "/nao-existe.css")).status).toBe(404);
    expect((await get("naoexiste")).status).toBe(404);
    expect((await get("exemplo.com.br")).status).toBe(404);
    expect((await get("legado", "/_site.json")).status).toBe(404);
    expect((await get("vendas", "/_expected.json")).status).toBe(404);
  });

  it.each([
    "/../server.ts",
    "/..%2f..%2fserver.ts",
    "/%2e%2e/%2e%2e/server.ts",
    "/sub/..%2f..%2f..%2fserver.ts",
    "/..\\..\\server.ts",
  ])("não sai da pasta do site: %s", async (p) => {
    const res = await get("legado", p);
    expect(res.status).toBe(404);
    expect(res.body.toString()).not.toContain("startFixtureServer");
  });

  it("aceita HEAD (sem corpo) e recusa POST", async () => {
    const head = await get("vendas", "/", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(Number(head.headers["content-length"])).toBeGreaterThan(1000);
    expect((await get("vendas", "/", { method: "POST" })).status).toBe(405);
  });

  it("registra host, caminho e user-agent de cada requisição", async () => {
    srv.requests.length = 0;
    await get("vendas", "/?utm_source=teste", { ua: "AgenteDeTeste/1.0" });
    await get("vsl", "/css/vsl.css");
    expect(srv.requests).toEqual([
      { host: "vendas.fixture.test", path: "/?utm_source=teste", ua: "AgenteDeTeste/1.0" },
      { host: "vsl.fixture.test", path: "/css/vsl.css", ua: DESKTOP_UA },
    ]);
  });

  it("fixtureLookup resolve *.fixture.test localmente e delega o resto", async () => {
    const lookup = (host: string, all: boolean) =>
      new Promise<unknown>((resolve, reject) =>
        fixtureLookup(host, { all }, (err, address) => (err ? reject(err) : resolve(address))),
      );
    expect(await lookup("vendas.fixture.test", false)).toBe("127.0.0.1");
    expect(await lookup("VSL.fixture.test", true)).toEqual([{ address: "127.0.0.1", family: 4 }]);
    expect(await lookup("localhost", false)).toMatch(/^(127\.0\.0\.1|::1)$/);
  });

  it("funciona via undici com o lookup de *.fixture.test", async () => {
    const agent = new Agent({ connect: { lookup: fixtureLookup } });
    try {
      const res = await request(srv.url("checkouts"), { dispatcher: agent });
      expect(res.statusCode).toBe(200);
      expect(await res.body.text()).toContain("Escolha o seu plano");
    } finally {
      await agent.close();
    }
  });
});

describe("comportamentos especiais (_site.json)", () => {
  it("uaSplit: HTML diferente para desktop e celular", async () => {
    const desktop = await get("celular", "/", { ua: DESKTOP_UA });
    const iphone = await get("celular", "/", { ua: IPHONE_UA });
    const android = await get("celular", "/index.html", { ua: ANDROID_UA });
    expect(desktop.body.toString()).toContain("Versão desktop");
    expect(desktop.body.toString()).not.toContain("Versão celular");
    expect(iphone.body.toString()).toContain("Versão celular");
    expect(iphone.body.toString()).toContain("/img/hero-celular.jpg");
    expect(android.body.toString()).toContain("Versão celular");
    expect(desktop.headers.vary).toBe("User-Agent");
    // Sites sem uaSplit ignoram o user-agent.
    expect((await get("vendas", "/", { ua: IPHONE_UA })).body.equals((await get("vendas")).body)).toBe(true);
  });

  it("charset iso-8859-1: cabeçalho e bytes Latin-1 de verdade", async () => {
    const res = await get("legado");
    expect(res.headers["content-type"]).toBe("text/html; charset=iso-8859-1");
    // "ç" em Latin-1 é 0xE7; em UTF-8 seria C3 A7.
    expect(res.body.includes(Buffer.from([0xe7]))).toBe(true);
    expect(res.body.includes(Buffer.from([0xc3, 0xa7]))).toBe(false);
    const html = iconv.decode(res.body, "latin1");
    expect(html).toContain("Promoção de Verão: Açaí na Tigela");
    expect(html).toContain('<base href="/sub/">');

    const css = await get("legado", "/sub/css/estilo.css");
    expect(css.body.includes(Buffer.from([0xc3]))).toBe(false);
    expect(iconv.decode(css.body, "latin1")).toContain('content: "Promoção válida até domingo - não perca!"');
    expect(iconv.decode((await get("legado", "/sub/js/antigo.js")).body, "latin1")).toContain(
      "Frete grátis para São João",
    );
  });

  it("legado: integrity sha384 confere com o CSS servido", async () => {
    const $ = cheerio.load(iconv.decode((await get("legado")).body, "latin1"));
    const link = $("link[integrity]");
    expect(link.attr("crossorigin")).toBe("anonymous");
    expect(link.attr("href")).toBe("css/reset.css");
    const css = await get("legado", "/sub/css/reset.css");
    const hash = `sha384-${createHash("sha384").update(css.body).digest("base64")}`;
    expect(link.attr("integrity")).toBe(hash);
    expect($('link[media="print"]').attr("onload")).toContain("this.media='all'");
  });

  it("challenge: 403 com cf-mitigated em qualquer caminho", async () => {
    for (const p of ["/", "/index.html", "/qualquer/arquivo.css"]) {
      const res = await get("protegido", p);
      expect(res.status).toBe(403);
      expect(res.headers["cf-mitigated"]).toBe("challenge");
      expect(res.headers["content-type"]).toMatch(/^text\/html/);
      expect(res.body.toString()).toContain("<title>Just a moment...</title>");
      expect(res.body.toString()).not.toContain("Conteúdo que o robô não deveria ver");
    }
  });

  it("delayMs: o site lento demora para responder", async () => {
    const t0 = performance.now();
    const res = await get("lento");
    expect(res.status).toBe(200);
    expect(performance.now() - t0).toBeGreaterThanOrEqual(350);
  });
});

// ─── Integridade: toda referência local dos sites existe ────────────────────

const ASSET_ATTRS = ["src", "data-src", "poster", "data-bg"];
const SRCSET_ATTRS = ["srcset", "data-srcset"];
const LINK_RELS = new Set(["stylesheet", "icon", "shortcut icon", "apple-touch-icon", "preload"]);

function cssUrls(css: string): string[] {
  const urls: string[] = [];
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) urls.push(m[2]);
  for (const m of css.matchAll(/@import\s+(['"])([^'"]+)\1/g)) urls.push(m[2]);
  return urls.filter((u) => !u.startsWith("data:"));
}

function htmlAssetRefs(html: string): { base?: string; refs: string[] } {
  const $ = cheerio.load(html);
  const refs: string[] = [];
  for (const attr of ASSET_ATTRS) {
    $(`[${attr}]`).each((_, el) => {
      // Imagens/iframes externos e a lógica dos scripts ficam de fora (só arquivos locais).
      refs.push($(el).attr(attr) ?? "");
    });
  }
  for (const attr of SRCSET_ATTRS) {
    $(`[${attr}]`).each((_, el) => {
      for (const part of ($(el).attr(attr) ?? "").split(",")) refs.push(part.trim().split(/\s+/)[0]);
    });
  }
  $("link[href]").each((_, el) => {
    if (LINK_RELS.has(($(el).attr("rel") ?? "").toLowerCase())) refs.push($(el).attr("href") ?? "");
  });
  $("[style]").each((_, el) => {
    refs.push(...cssUrls($(el).attr("style") ?? ""));
  });
  $("style").each((_, el) => {
    refs.push(...cssUrls($(el).text()));
  });
  return { base: $("base[href]").attr("href"), refs: refs.filter((r) => r && !r.startsWith("data:")) };
}

function htmlFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(dir, r));
    else if (entry.name.endsWith(".html")) out.push(r);
  }
  return out;
}

describe("integridade dos sites", () => {
  it.each(siteNames().filter((s) => s !== "protegido"))("%s: todo arquivo local referenciado existe", async (site) => {
    const origin = new URL(srv.url(site)).origin;
    const decode = (b: Buffer) => (site === "legado" ? iconv.decode(b, "latin1") : b.toString("utf8"));
    const checked = new Set<string>();
    const missing: string[] = [];

    async function check(url: URL, from: string): Promise<void> {
      if (url.origin !== origin) return;
      const key = url.pathname + url.search;
      if (checked.has(key)) return;
      checked.add(key);
      const res = await get(site, key);
      if (res.status !== 200) {
        missing.push(`${key} (em ${from})`);
        return;
      }
      if (String(res.headers["content-type"]).startsWith("text/css")) {
        for (const u of cssUrls(decode(res.body))) await check(new URL(u, url), key);
      }
    }

    for (const file of htmlFiles(path.join(SITES_DIR, site))) {
      const pagePath = `/${file}`;
      const res = await get(site, pagePath);
      expect(res.status, pagePath).toBe(200);
      const { base, refs } = htmlAssetRefs(decode(res.body));
      const baseUrl = new URL(base ?? pagePath, origin + pagePath);
      for (const ref of refs) await check(new URL(ref, baseUrl), pagePath);
    }
    expect(missing).toEqual([]);
    expect(checked.size).toBeGreaterThan(0);
  });

  it("vendas: cadeia de @import a → b → c e fonte em outra pasta", async () => {
    const a = (await get("vendas", "/wp-content/themes/oferta/style.css")).body.toString();
    const b = (await get("vendas", "/wp-content/themes/oferta/assets/css/base.css")).body.toString();
    const c = (await get("vendas", "/wp-content/themes/oferta/assets/css/tipografia.css")).body.toString();
    expect(a).toContain('@import url("assets/css/base.css")');
    expect(b).toContain('@import "tipografia.css"');
    expect(c).toContain('url("../../fonts/inter-latin-wght-normal.woff2")');
    const html = (await get("vendas")).body.toString();
    const hotmart = html.match(/https:\/\/pay\.hotmart\.com\/A12345678B\?off=abc123&(amp;)?checkoutMode=10/g);
    expect(hotmart).toHaveLength(3);
  });

  it("grande: ~3000 elementos e ~2000 regras de CSS", async () => {
    const $ = cheerio.load((await get("grande")).body.toString());
    expect($("*").length).toBeGreaterThanOrEqual(2900);
    expect($("*").length).toBeLessThanOrEqual(3200);
    const ast = csstree.parse((await get("grande", "/css/grande.css")).body.toString());
    let rules = 0;
    csstree.walk(ast, { visit: "Rule", enter: () => void rules++ });
    expect(rules).toBeGreaterThanOrEqual(1900);
    expect(rules).toBeLessThanOrEqual(2100);
  });

  it("shadow: estilo do CSS-in-JS fica vazio no HTML", async () => {
    const $ = cheerio.load((await get("shadow")).body.toString());
    expect($("style[data-styled]").text()).toBe("");
    expect($("oferta-card")).toHaveLength(2);
  });
});

// ─── ZIPs ───────────────────────────────────────────────────────────────────

function zipNames(source: string | Buffer, decodeStrings: boolean): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const done = (err: Error | null, zip?: yauzl.ZipFile) => {
      if (err || !zip) return reject(err);
      const names: string[] = [];
      zip.on("entry", (entry: yauzl.Entry) => {
        const raw = entry.fileName as unknown;
        names.push(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw));
        zip.readEntry();
      });
      zip.on("end", () => resolve(names));
      zip.on("error", reject);
      zip.readEntry();
    };
    const opts = { lazyEntries: true, decodeStrings };
    if (typeof source === "string") yauzl.open(source, opts, done);
    else yauzl.fromBuffer(source, opts, done);
  });
}

function zipText(file: string, name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      zip.on("entry", (entry: yauzl.Entry) => {
        if (entry.fileName !== name) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e);
          const chunks: Buffer[] = [];
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            zip.close();
            resolve(Buffer.concat(chunks).toString("utf8"));
          });
        });
      });
      zip.on("end", () => reject(new Error(`${name} não está no ZIP`)));
      zip.readEntry();
    });
  });
}

describe("ZIPs de importação", () => {
  const good = path.join(ZIPS_DIR, "good.zip");
  const slip = path.join(ZIPS_DIR, "slip.zip");

  it("good.zip: página salva pelo navegador com acentos nos nomes", async () => {
    expect(statSync(good).size).toBeGreaterThan(1000);
    const names = await zipNames(good, true);
    expect(names).toContain("Página.html");
    expect(names).toContain("Página_files/");
    expect(names).toContain("Página_files/logotipo-açaí.png");

    const html = await zipText(good, "Página.html");
    expect(html).toContain("<!-- saved from url=(0042)https://www.ofertaexemplo.com.br/promocao/ -->");
    const $ = cheerio.load(html);
    const refs = $("[src], link[href]")
      .map((_, el) => $(el).attr("src") ?? $(el).attr("href") ?? "")
      .get()
      .filter((r) => r.startsWith("./"));
    expect(refs.length).toBeGreaterThanOrEqual(6);
    for (const ref of refs) expect(names).toContain(decodeURIComponent(ref.slice(2)));
  });

  it("slip.zip: tem entradas que tentam sair da pasta", async () => {
    const names = await zipNames(slip, false);
    expect(names).toEqual(["index.html", "../evil.txt", "Página_files/../../evil2.txt"]);
    // O yauzl, validando nomes, recusa o ZIP.
    await expect(zipNames(slip, true)).rejects.toThrow(/invalid relative path/);
  });

  it("buildZip gera ZIP válido, com nomes UTF-8 e bytes determinísticos", async () => {
    const zip = buildZip([{ name: "açaí/" }, { name: "açaí/olá.txt", data: "conteúdo" }]);
    expect(await zipNames(zip, true)).toEqual(["açaí/", "açaí/olá.txt"]);
    // O slip.zip guardado no disco é exatamente o que make-zips.ts gera.
    expect(buildZip(SLIP_ENTRIES).equals(readFileSync(slip))).toBe(true);
  });
});
