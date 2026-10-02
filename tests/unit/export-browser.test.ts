/**
 * O ZIP de verdade num Chromium de verdade: gera o ZIP da oferta de teste
 * (export-fixture.ts), descompacta numa pasta temporária e serve com um
 * servidor HTTP simples — na raiz e numa SUBPASTA (/clientes/minha-oferta/),
 * sem redirecionar pastas sem a barra no fim (como algumas hospedagens de
 * arquivos). O servidor faz o papel do PHP no eventos.php: guarda o corpo de
 * cada POST (o formato é conferido aqui). Scripts das plataformas (Meta,
 * TikTok) e o checkout são trocados por versões locais.
 *
 * Confere: todas as páginas abrem sem nenhum 404; links do funil entre pastas;
 * divisor sorteando pelo peso (aleatoriedade fixa), mantendo as UTMs e
 * lembrando a escolha; celular indo para celular/ (e ?versao=computador
 * ficando); rastreamento ao vivo (pixels depois do "Aceitar" e o eventos.php
 * recebendo PageView e InitiateCheckout); "Preservar JS" na raiz; e o ZIP
 * aberto direto do computador (file://).
 */
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, type BrowserContext, chromium, devices, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storagePath } from "@/lib/storage";
import { startExport } from "@/server/services/export";
import { claimNextExport, exportFileKey, runExportJob } from "@/server/services/export/jobs";
import { resetDatabase } from "../setup/per-file";
import {
  CHECKOUT_URL,
  createExportFixture,
  type ExportFixture,
  META_PIXEL,
  removeExportFiles,
  TIKTOK_PIXEL,
  unzipTo,
} from "./export-fixture";

// ─── Servidor de arquivos ────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json",
  png: "image/png",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
};

interface Hit {
  method: string;
  path: string;
  status: number;
}

interface Beacon {
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

interface StaticSite {
  base: string;
  hits: Hit[];
  beacons: Beacon[];
  close: () => Promise<void>;
}

/** Serve `root` em `prefix` ("/" ou "/clientes/minha-oferta/"). Pasta sem a barra: entrega o index.html direto. */
async function serveZip(root: string, prefix: string): Promise<StaticSite> {
  const hits: Hit[] = [];
  const beacons: Beacon[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const pathname = decodeURIComponent(url.pathname);
    const done = (status: number, type = "text/plain; charset=utf-8", body = "") => {
      hits.push({ method: req.method ?? "GET", path: pathname, status });
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
      res.end(body);
    };
    if (!pathname.startsWith(prefix) && `${pathname}/` !== prefix) return done(404, undefined, "fora do site");
    const rel = pathname.slice(prefix.length);
    if (req.method === "POST") {
      if (rel !== "eventos.php") return done(405);
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(raw);
        } catch {
          body = { invalido: raw };
        }
        beacons.push({ path: pathname, headers: req.headers, body });
        done(204);
      });
      return;
    }
    const file = path.join(root, rel);
    if (!file.startsWith(root)) return done(404);
    void (async () => {
      let target = file;
      const info = await stat(target).catch(() => null);
      if (info?.isDirectory()) target = path.join(target, "index.html");
      const found = await stat(target).catch(() => null);
      if (!found?.isFile() || target.endsWith(".php")) return done(404, undefined, "não encontrado");
      hits.push({ method: req.method ?? "GET", path: pathname, status: 200 });
      res.writeHead(200, { "Content-Type": MIME[target.split(".").pop() ?? ""] ?? "application/octet-stream" });
      createReadStream(target).pipe(res);
    })();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}${prefix}`,
    hits,
    beacons,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

// ─── Plataformas e checkout (versões locais) ─────────────────────────────────

const REC = "var c=window.__calls=window.__calls||[];var A=function(a){return [].slice.call(a)};";
const STUBS: Record<string, string> = {
  "https://connect.facebook.net/": `(function(){${REC}c.push(["load","META"]);
    var q=fbq.queue.slice();fbq.queue.length=0;
    fbq.callMethod=function(){c.push(["fbq"].concat(A(arguments)))};
    q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`,
  "https://analytics.tiktok.com/": `(function(){${REC}c.push(["load","TIKTOK"]);
    if(ttq.__stub)return;ttq.__stub=1;var q=ttq.splice(0);
    q.forEach(function(a){c.push(["ttq"].concat(a))});
    ["page","track","grantConsent","revokeConsent"].forEach(function(m){ttq[m]=function(){c.push(["ttq",m].concat(A(arguments)))}});})();`,
};

let browser: Browser;
let fx: ExportFixture;
let dir: string;

async function newContext(opts: Parameters<Browser["newContext"]>[0] = {}, random?: number | number[]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
  await context.route(
    (url) => /^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1",
    async (route) => {
      const url = route.request().url();
      const stub = Object.entries(STUBS).find(([prefix]) => url.startsWith(prefix));
      if (stub) return route.fulfill({ status: 200, contentType: "text/javascript", body: stub[1] });
      if (url.startsWith("https://pay.hotmart.com/")) {
        return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Checkout</h1>" });
      }
      return route.abort();
    },
  );
  if (random !== undefined) {
    const list = Array.isArray(random) ? random : [random];
    await context.addInitScript(
      `(() => { const l = ${JSON.stringify(list)}; let i = 0; Math.random = () => l[i++ % l.length]; })();`,
    );
  }
  return context;
}

/** Página com a lista de respostas de erro (404 etc.) do nosso servidor. */
async function openPage(context: BrowserContext) {
  const page = await context.newPage();
  const failures: string[] = [];
  const errors: string[] = [];
  page.on("response", (r) => {
    if (r.url().startsWith("http://127.0.0.1") && r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    if (r.url().startsWith("http://127.0.0.1")) failures.push(`falhou ${r.url()}`);
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return { page, failures, errors };
}

/** Espera todas as imagens e fontes carregarem. */
async function settled(page: Page) {
  await page.waitForLoadState("load");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) =>
        img.complete ? null : new Promise((r) => img.addEventListener("load", r, { once: true })),
      ),
    );
  });
}

beforeAll(async () => {
  await resetDatabase();
  fx = await createExportFixture();
  // Consentimento só avisando (NOTICE) numa segunda rodada; aqui fica o padrão (pedir permissão).
  const { exportId } = await startExport(fx.offerId, { serverEvents: true });
  await claimNextExport();
  await runExportJob(exportId);
  dir = await mkdtemp(path.join(os.tmpdir(), "os-export-"));
  await unzipTo(storagePath(exportFileKey(fx.offerId, exportId)), dir);
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
  await removeExportFiles();
  await resetDatabase();
});

describe.each([
  ["na raiz do domínio", "/"],
  ["numa subpasta", "/clientes/minha-oferta/"],
])("oferta %s", (_, prefix) => {
  let site: StaticSite;
  beforeAll(async () => {
    site = await serveZip(dir, prefix);
  });
  afterAll(async () => {
    await site.close();
  });

  it("divisor: sorteia pelo peso, mantém UTMs e hash, e lembra a escolha", async () => {
    const context = await newContext({}, 0.1);
    const { page, failures, errors } = await openPage(context);
    await page.goto(`${site.base}?utm_source=facebook&utm_campaign=teste#oferta`);
    await page.waitForURL(`${site.base}oferta-a/?utm_source=facebook&utm_campaign=teste#oferta`);
    await expect.poll(() => page.locator("#titulo").textContent()).toBe("Versão A");
    await settled(page);
    // CSS em cadeia (folha base → @import → @font-face) e imagens do srcset carregaram.
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("Teste");
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector(".fundo") as Element).backgroundImage),
    ).toMatch(/assets\/[0-9a-f]{64}\.png/);
    expect(
      await page.evaluate(() => (document.querySelector("#foto") as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
    // Volta ao divisor com outro sorteio: a escolha guardada vale.
    await page.addInitScript("Math.random = () => 0.9");
    await page.goto(`${site.base}?utm_source=outra`);
    await page.waitForURL(`${site.base}oferta-a/?utm_source=outra`);
    expect(failures).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("divisor: 20 visitantes novos com aleatoriedade fixa → 10 em cada versão", async () => {
    const counts: Record<string, number> = { "oferta-a/": 0, "oferta-b/": 0 };
    const context = await newContext();
    const page = await context.newPage();
    for (let i = 0; i < 20; i++) {
      await context.clearCookies();
      await page.goto(`${site.base}LEIA-ME.txt`);
      await page.evaluate(() => localStorage.clear());
      await page.addInitScript(`Math.random = () => ${(i + 0.5) / 20}`);
      await page.goto(site.base);
      await page.waitForURL(/oferta-[ab]\/$/);
      counts[page.url().slice(site.base.length)]++;
    }
    expect(counts).toEqual({ "oferta-a/": 10, "oferta-b/": 10 });
    await context.close();
  });

  it("funil: links entre pastas (com as UTMs repassadas), página legal e volta ao início", async () => {
    const context = await newContext({}, 0.9);
    const { page, failures, errors } = await openPage(context);
    await page.goto(`${site.base}?utm_source=google`);
    await page.waitForURL(`${site.base}oferta-b/?utm_source=google`);
    await page.click("#ir-upsell");
    await page.waitForURL(`${site.base}upsell/?utm_source=google`);
    expect(await page.locator("#titulo").textContent()).toBe("Upsell computador");
    await page.click("#voltar");
    // Volta pela pasta da página inicial (o divisor), que lembra a versão B.
    await page.waitForURL(`${site.base}oferta-b/?utm_source=google`);
    await page.click("#politica");
    await page.waitForURL(`${site.base}privacidade/?utm_source=google`);
    expect(await page.locator("#empresa").textContent()).toBe("A Empresa Teste LTDA protege seus dados.");
    await settled(page);
    expect(failures).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("endereço sem a barra no fim ainda funciona", async () => {
    const context = await newContext({}, 0.1);
    const page = await context.newPage();
    await page.goto(`${site.base}upsell?utm_source=x`);
    await page.waitForURL(`${site.base}upsell/?utm_source=x`);
    expect(await page.locator("#titulo").textContent()).toBe("Upsell computador");
    await context.close();
  });

  it("celular vai para a versão celular (com UTMs); ?versao=computador fica no computador", async () => {
    const context = await newContext({ ...devices["iPhone 13"] });
    const { page, failures } = await openPage(context);
    await page.goto(`${site.base}upsell/?utm_source=tiktok#x`);
    await page.waitForURL(`${site.base}upsell/celular/?utm_source=tiktok#x`);
    expect(await page.locator("#titulo").textContent()).toBe("Upsell celular");
    await settled(page);
    await page.goto(`${site.base}upsell/?versao=computador`);
    await page.waitForLoadState("load");
    expect(page.url()).toBe(`${site.base}upsell/?versao=computador`);
    expect(await page.locator("#titulo").textContent()).toBe("Upsell computador");
    expect(failures).toEqual([]);
    await context.close();
  });

  it("rastreamento ao vivo: pixels depois do “Aceitar” e o eventos.php recebendo os eventos", async () => {
    site.beacons.length = 0;
    const context = await newContext({}, 0.1);
    const { page, errors } = await openPage(context);
    await page.goto(`${site.base}?utm_source=facebook&fbclid=AbC123_x&ttclid=tt-999`);
    await page.waitForURL(/oferta-a\//);
    // Pedir permissão (padrão): nada de pixel nem eventos.php antes do "Aceitar".
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { __calls?: unknown[] }).__calls ?? [])).toEqual([]);
    expect(site.beacons).toEqual([]);
    await page.getByRole("button", { name: "Aceitar" }).click();
    await expect.poll(() => site.beacons.length).toBeGreaterThan(0);
    // Os scripts das plataformas carregam em paralelo (o eventos.php não espera por eles).
    const readCalls = () => page.evaluate(() => (window as unknown as { __calls?: unknown[][] }).__calls ?? []);
    await expect
      .poll(async () => (await readCalls()).some((c) => c[0] === "fbq" && c[1] === "track" && c[2] === "PageView"))
      .toBe(true);
    await expect.poll(async () => (await readCalls()).some((c) => c[0] === "load" && c[1] === "TIKTOK")).toBe(true);
    const calls = (await readCalls()) as unknown[][];
    expect(calls).toContainEqual(["load", "META"]);
    expect(calls).toContainEqual(["load", "TIKTOK"]);
    expect(calls.some((c) => c[0] === "fbq" && c[1] === "init" && c[2] === META_PIXEL)).toBe(true);
    expect(calls.some((c) => c[0] === "fbq" && c[1] === "track" && c[2] === "PageView")).toBe(true);

    const pageView = site.beacons[0];
    expect(pageView.path).toBe(`${prefix}eventos.php`);
    expect(String(pageView.headers["content-type"])).toMatch(/^text\/plain/);
    expect(pageView.body).toMatchObject({
      event: "PAGE_VIEW",
      event_name: { META: "PageView" },
      event_source_url: expect.stringMatching(new RegExp(`${prefix}oferta-a/\\?utm_source=facebook`)),
      ttclid: "tt-999",
    });
    // O PageView do TikTok não tem event_id no navegador: não vai pelo servidor.
    expect((pageView.body.event_name as Record<string, string>).TIKTOK).toBeUndefined();
    expect(pageView.body.event_id).toMatch(/^[A-Za-z0-9_.:-]{8,100}$/);
    expect(pageView.body.event_time).toEqual(expect.any(Number));
    expect(Math.abs((pageView.body.event_time as number) - Date.now() / 1000)).toBeLessThan(120);
    expect(pageView.body.fbp).toMatch(/^fb\.1\.\d{13}\.\d+$/);
    expect(pageView.body.fbc).toMatch(/^fb\.1\.\d{13}\.AbC123_x$/);
    // O mesmo event_id foi para o pixel da Meta (deduplicação).
    expect(
      calls.some(
        (c) => c[0] === "fbq" && c[2] === "PageView" && JSON.stringify(c).includes(pageView.body.event_id as string),
      ),
    ).toBe(true);

    // Checkout: InitiateCheckout pelas duas plataformas e o visitante chega ao checkout com as UTMs.
    const before = site.beacons.length;
    await page.click("#comprar");
    await page.waitForURL(/^https:\/\/pay\.hotmart\.com\//);
    const checkout = new URL(page.url());
    expect(checkout.searchParams.get("off")).toBe(new URL(CHECKOUT_URL).searchParams.get("off"));
    expect(checkout.searchParams.get("utm_source")).toBe("facebook");
    await expect.poll(() => site.beacons.length).toBeGreaterThan(before);
    const ic = site.beacons.slice(before).find((b) => b.body.event === "INITIATE_CHECKOUT");
    expect(ic?.body.event_name).toEqual({ META: "InitiateCheckout", TIKTOK: "InitiateCheckout" });
    expect(errors).toEqual([]);
    await context.close();
  });

  it("a página inicial não chama nada fora do site além das plataformas (nem /os-assets/)", async () => {
    const context = await newContext({}, 0.1);
    const page = await context.newPage();
    const external: string[] = [];
    page.on("request", (r) => {
      const url = r.url();
      if (!url.startsWith("http://127.0.0.1") && !url.startsWith("data:")) external.push(url);
      if (url.includes("/os-assets/") || url.includes("/os-runtime.js")) external.push(url);
    });
    await page.goto(site.base);
    await page.waitForURL(/oferta-a\//);
    await settled(page);
    expect(external).toEqual([]);
    await context.close();
  });
});

describe("Preservar JS na raiz do domínio", () => {
  it("scripts, imagens montadas pelo script e dados nos caminhos originais", async () => {
    const site = await serveZip(dir, "/");
    const context = await newContext();
    const { page, failures, errors } = await openPage(context);
    await page.goto(`${site.base}quiz/`);
    await expect.poll(() => page.locator("#status").textContent()).toBe("quiz pronto");
    await settled(page);
    expect(await page.evaluate(() => (window as unknown as { __quizOk: boolean }).__quizOk)).toBe(true);
    expect(
      await page.evaluate(() => (document.querySelector("#etapa") as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".quiz") as Element).color)).toBe(
      "rgb(17, 34, 51)",
    );
    expect(site.hits.filter((h) => h.path === "/js/quiz.js")).toHaveLength(1);
    expect(failures).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
    await site.close();
  });
});

describe("aberto direto do computador (file://)", () => {
  it("o divisor e os links de pasta funcionam sem hospedagem", async () => {
    const context = await newContext({}, 0.1);
    const page = await context.newPage();
    await page.goto(pathToFileURL(path.join(dir, "index.html")).href);
    await page.waitForURL(/oferta-a\/index\.html$/);
    expect(await page.locator("#titulo").textContent()).toBe("Versão A");
    await page.click("#ir-upsell");
    await page.waitForURL(/upsell\/index\.html/);
    expect(await page.locator("#titulo").textContent()).toBe("Upsell computador");
    await context.close();
  });
});

describe("pixels do TikTok e da Meta configurados", () => {
  it("o ZIP traz os dois pixels na configuração pública (sem tokens)", async () => {
    const html = await (await import("node:fs/promises")).readFile(path.join(dir, "oferta-a/index.html"), "utf8");
    expect(html).toContain(META_PIXEL);
    expect(html).toContain(TIKTOK_PIXEL);
    expect(html).not.toContain("accessToken");
  });
});
