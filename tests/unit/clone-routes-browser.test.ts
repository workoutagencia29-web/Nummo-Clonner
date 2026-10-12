/**
 * Funil clonado "Com scripts" de ponta a ponta num Chromium: uma oferta com as
 * páginas de um site-aplicativo (o mesmo script escolhe a tela pelo
 * `location.pathname` e navega pelos endereços ORIGINAIS: location.href =
 * "/roleta", location.assign("https://loja.exemplo.test/loja/"),
 * history.pushState, link para o site original, window.open).
 *
 * Na PRÉVIA de verdade (src/preview/server.ts com o banco de testes) e no ZIP
 * de verdade (buildExport, servido na raiz por um servidor de arquivos que,
 * como as hospedagens, redireciona "/pasta" → "/pasta/"): cada etapa abre a
 * página clonada correspondente, com a tela certa, sem nenhum pedido ao site
 * original; recarregar no caminho original serve a página; no ZIP, os
 * caminhos originais levam à pasta da página e as imagens/scripts carregam
 * mesmo com o caminho original mais fundo que a pasta. Também sem a API
 * Navigation (como no Safari): o endereço completo nos scripts inline vira o
 * caminho original no salvar (rewriteScriptPageUrls) e o servidor leva à página.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rewriteScriptPageUrls } from "@/lib/clone-routes";
import { prisma } from "@/lib/db";
import { createPreviewToken } from "@/lib/preview";
import { putContentAddressed } from "@/lib/storage";
import { buildExport } from "@/server/services/export/build";
import { createOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { resetDatabase } from "../setup/per-file";
import { removeExportFiles, unzipTo } from "./export-fixture";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ORIGINAL = "loja.exemplo.test";
let port = 0;
let child: ChildProcess | null = null;
let output = "";
let browser: Browser;
let previewBase = "";
let zipServer: Server | null = null;
let zipBase = "";
let tmp = "";
let siteDir = "";
const ids: Record<string, string> = {};

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

async function storeFile(data: Buffer | string, ext: string) {
  const saved = await putContentAddressed(typeof data === "string" ? Buffer.from(data, "utf8") : data, ext);
  return { file: `${saved.sha256}.${ext}`, key: saved.key };
}

const png = (r: number, g: number, b: number) =>
  sharp({ create: { width: 12, height: 8, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();

/** As telas do aplicativo (o roteador lê o caminho). */
const SCREENS = {
  "/": "quiz",
  "/roleta": "roleta",
  "/loja/": "loja",
  "/loja": "loja",
  "/produto/camiseta": "camiseta",
  "/colecao/verao/chinelo/": "chinelo",
};

/** HTML "capturado" de uma rota do site-aplicativo, já como o salvar deixa (rewriteScriptPageUrls). */
function appHtml(name: string, files: { css: string; photo: string }, pages: { url: string }[]) {
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Loja Exemplo</title>
<link rel="stylesheet" href="/os-assets/${files.css}">
<script>window.__primeiroCaminho = location.pathname;</script>
</head><body data-pagina="${name}">
<img id="foto" src="/os-assets/${files.photo}" alt="">
<h1 id="tela">carregando</h1>
<button id="ir-roleta" onclick="location.href='/roleta'">Roleta</button>
<button id="ir-loja-abs" onclick="location.assign('https://${ORIGINAL}/loja/')">Loja</button>
<button id="ir-loja-push" onclick="history.pushState({}, '', '/loja')">Loja (app)</button>
<button id="ir-camiseta-js" onclick="irCamiseta()">Camiseta</button>
<a id="link-loja" href="https://${ORIGINAL}/loja/">Loja (link)</a>
<button id="abrir-roleta" onclick="window.open('/roleta')">Abrir roleta</button>
<script>
var telas = ${JSON.stringify(SCREENS)};
document.getElementById("tela").textContent = "tela " + (telas[location.pathname] || "desconhecida");
// Endereço montado pelo script, relativo à pasta da rota (como "img/etapa.png" num quiz).
var etapa = new Image(); etapa.id = "etapa"; etapa.src = "img/etapa.png"; document.body.appendChild(etapa);
function irCamiseta(){ location.href = "https://${ORIGINAL}/produto/camiseta"; }
</script>
</body></html>`;
  return rewriteScriptPageUrls(html, pages);
}

const PAGES = [
  { key: "quiz", name: "Quiz", slug: "", url: `https://${ORIGINAL}/` },
  { key: "roleta", name: "Roleta da sorte", slug: "roleta-da-sorte", url: `https://${ORIGINAL}/roleta` },
  { key: "loja", name: "Loja", slug: "loja", url: `https://${ORIGINAL}/loja/` },
  { key: "camiseta", name: "Camiseta", slug: "camiseta", url: `https://${ORIGINAL}/produto/camiseta` },
  { key: "chinelo", name: "Chinelo", slug: "chinelo", url: `https://${ORIGINAL}/colecao/verao/chinelo/` },
];

async function createFunnel() {
  const css = await storeFile("h1{color:#0a5}body{font-family:sans-serif}", "css");
  const photo = await storeFile(await png(200, 40, 40), "png");
  const step = await storeFile(await png(40, 40, 200), "png");
  const offer = await createOffer({ name: "Funil clonado" });
  const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
  for (const p of PAGES) {
    const id = p.key === "quiz" ? home.id : (await createPage({ offerId: offer.id, name: p.name, slug: p.slug })).id;
    ids[p.key] = id;
    await prisma.page.update({
      where: { id },
      data: { name: p.name, cloneMode: "PRESERVE_JS", sourceUrl: p.url, type: "OTHER" },
    });
    // "img/etapa.png" que o script pede, no caminho original da pasta de cada rota.
    const dir = new URL(p.url).pathname.replace(/[^/]*$/, "");
    await prisma.pageDocument.updateMany({
      where: { variant: { pageId: id } },
      data: {
        html: appHtml(p.key, { css: css.file, photo: photo.file }, PAGES),
        assetMap: { [`${dir}img/etapa.png`]: step.key },
      },
    });
  }
  return offer.id;
}

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript",
  css: "text/css",
  png: "image/png",
  json: "application/json",
};

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toMatch(/\/offerstudio_test_\d+$/);
  await removeExportFiles();
  await resetDatabase();
  const offerId = await createFunnel();

  // Prévia de verdade.
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
  const token = await createPreviewToken({ kind: "offer", offerId });
  previewBase = `http://${token}.localhost:${port}`;

  // ZIP de verdade, servido na raiz (pasta sem barra → 301 para a pasta com barra, como o Apache).
  tmp = await mkdtemp(path.join(os.tmpdir(), "os-rotas-"));
  const target = path.join(tmp, "oferta.zip");
  await buildExport({
    offerId,
    options: { splitter: true, serverEvents: false, optimizeHtml: true, lighterImages: true },
    target,
  });
  const dir = path.join(tmp, "site");
  siteDir = dir;
  await unzipTo(target, dir);
  zipServer = createHttpServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://x");
      const pathname = decodeURIComponent(url.pathname);
      let file = path.join(dir, pathname);
      if (!file.startsWith(dir)) {
        res.writeHead(404).end();
        return;
      }
      const info = await stat(file).catch(() => null);
      if (info?.isDirectory()) {
        if (!pathname.endsWith("/")) {
          res.writeHead(301, { Location: `${url.pathname}/${url.search}` }).end();
          return;
        }
        file = path.join(file, "index.html");
      }
      if (!(await stat(file).catch(() => null))?.isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[file.split(".").pop() ?? ""] ?? "application/octet-stream" });
      createReadStream(file).pipe(res);
    })();
  });
  await new Promise<void>((r) => zipServer?.listen(0, "127.0.0.1", () => r()));
  zipBase = `http://127.0.0.1:${(zipServer.address() as AddressInfo).port}`;

  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  child?.kill("SIGTERM");
  await new Promise<void>((r) => (zipServer ? zipServer.close(() => r()) : r()));
  if (tmp) await rm(tmp, { recursive: true, force: true });
  await removeExportFiles();
});

interface Visit {
  context: BrowserContext;
  page: Page;
  /** Pedidos ao site original (bloqueados). */
  original: string[];
  /** Navegações do documento principal (caminhos). */
  navigations: string[];
  /** Respostas com erro (404…) e erros de script. */
  problems: string[];
}

async function visit(opts: { noNavigationApi?: boolean } = {}): Promise<Visit> {
  const context = await browser.newContext();
  const original: string[] = [];
  await context.route(
    (url) => url.hostname.endsWith(ORIGINAL),
    (route) => {
      original.push(route.request().url());
      return route.abort();
    },
  );
  // Como o Safari: sem a API Navigation.
  if (opts.noNavigationApi) {
    await context.addInitScript({
      content: 'Object.defineProperty(window, "navigation", { value: undefined, configurable: true });',
    });
  }
  const page = await context.newPage();
  const navigations: string[] = [];
  const problems: string[] = [];
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navigations.push(new URL(r.url()).pathname);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => problems.push(e.message));
  return { context, page, original, navigations, problems };
}

/** Espera a página clonada `name` aberta, com o caminho `pathname` na barra. */
async function settle(page: Page, name: string, pathname: string) {
  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(() =>
            [document.body?.dataset.pagina ?? "", location.pathname, document.readyState].join("|"),
          );
        } catch {
          return "";
        }
      },
      { timeout: 15_000 },
    )
    .toBe(`${name}|${pathname}|complete`);
}

/** Tela que o "aplicativo" mostrou e se as imagens (do HTML e a montada pelo script) carregaram. */
async function screen(page: Page) {
  return page.evaluate(() => {
    const loaded = (id: string) => {
      const img = document.getElementById(id) as HTMLImageElement | null;
      return !!img && img.complete && img.naturalWidth > 0;
    };
    return {
      tela: document.getElementById("tela")?.textContent,
      foto: loaded("foto"),
      etapa: loaded("etapa"),
      cor: getComputedStyle(document.querySelector("h1") as Element).color,
    };
  });
}

async function waitImages(page: Page) {
  await page.waitForFunction(() =>
    ["foto", "etapa"].every((id) => {
      const img = document.getElementById(id) as HTMLImageElement | null;
      return !!img && img.complete;
    }),
  );
}

describe("prévia: funil clonado com scripts", () => {
  it("location.href = '/roleta' abre a roleta clonada, com o caminho original na barra", async () => {
    const v = await visit();
    await v.page.goto(`${previewBase}/`);
    await settle(v.page, "quiz", "/");
    await v.page.click("#ir-roleta");
    await settle(v.page, "roleta", "/roleta");
    await waitImages(v.page);
    expect(await screen(v.page)).toEqual({ tela: "tela roleta", foto: true, etapa: true, cor: "rgb(0, 170, 85)" });
    // O script da página já leu o caminho original (o script de rotas vem antes de tudo).
    expect(await v.page.evaluate(() => (window as unknown as { __primeiroCaminho: string }).__primeiroCaminho)).toBe(
      "/roleta",
    );
    expect(v.navigations).toEqual(["/", `/p/${ids.roleta}`]);
    expect(v.original).toEqual([]);
    expect(v.problems).toEqual([]);
    await v.context.close();
  }, 60_000);

  it("location.assign para o endereço completo do site original abre a loja clonada sem sair da prévia", async () => {
    const v = await visit();
    await v.page.goto(`${previewBase}/`);
    await settle(v.page, "quiz", "/");
    await v.page.click("#ir-loja-abs");
    await settle(v.page, "loja", "/loja/");
    expect((await screen(v.page)).tela).toBe("tela loja");
    expect(v.navigations).toEqual(["/", `/p/${ids.loja}`]);
    expect(v.original).toEqual([]);
    expect(v.problems).toEqual([]);
    await v.context.close();
  }, 60_000);

  it("a página-aplicativo aberta em /p/<id> mostra a tela da rota original", async () => {
    const v = await visit();
    await v.page.goto(`${previewBase}/p/${ids.roleta}?utm_source=fb#topo`);
    await settle(v.page, "roleta", "/roleta");
    expect(await v.page.evaluate(() => location.search + location.hash)).toBe("?utm_source=fb#topo");
    expect((await screen(v.page)).tela).toBe("tela roleta");
    await v.page.goto(`${previewBase}/p/${ids.chinelo}`);
    await settle(v.page, "chinelo", "/colecao/verao/chinelo/");
    await waitImages(v.page);
    expect(await screen(v.page)).toMatchObject({ tela: "tela chinelo", foto: true, etapa: true });
    expect(v.problems).toEqual([]);
    await v.context.close();
  }, 60_000);

  it("history.pushState('/loja'), link para o site original e window.open levam às páginas clonadas", async () => {
    const v = await visit();
    await v.page.goto(`${previewBase}/p/${ids.camiseta}`);
    await settle(v.page, "camiseta", "/produto/camiseta");
    await v.page.click("#ir-loja-push");
    await settle(v.page, "loja", "/loja/");

    await v.page.goto(`${previewBase}/`);
    await settle(v.page, "quiz", "/");
    await v.page.click("#link-loja");
    await settle(v.page, "loja", "/loja/");

    await v.page.goto(`${previewBase}/`);
    await settle(v.page, "quiz", "/");
    const [popup] = await Promise.all([v.context.waitForEvent("page"), v.page.click("#abrir-roleta")]);
    await settle(popup, "roleta", "/roleta");
    expect(v.original).toEqual([]);
    expect(v.problems).toEqual([]);
    await v.context.close();
  }, 60_000);

  it("recarregar no caminho original serve a página; pedido que não é de página não", async () => {
    const v = await visit();
    await v.page.goto(`${previewBase}/p/${ids.roleta}`);
    await settle(v.page, "roleta", "/roleta");
    await v.page.reload();
    await settle(v.page, "roleta", "/roleta");
    await v.page.goto(`${previewBase}/produto/camiseta?cor=azul`);
    await settle(v.page, "camiseta", "/produto/camiseta");
    expect(await v.page.evaluate(() => location.search)).toBe("?cor=azul");
    await waitImages(v.page);
    expect(await screen(v.page)).toMatchObject({ tela: "tela camiseta", foto: true, etapa: true });
    // fetch() do script (sem pedir HTML): continua procurando arquivo, não a página.
    expect(await v.page.evaluate(async () => (await fetch("/roleta")).status)).toBe(404);
    expect(v.problems.filter((p) => !p.endsWith("/roleta"))).toEqual([]);
    await v.context.close();
  }, 60_000);

  it("sem a API Navigation (Safari): o caminho original vai ao servidor e ele serve a página", async () => {
    const v = await visit({ noNavigationApi: true });
    await v.page.goto(`${previewBase}/`);
    await settle(v.page, "quiz", "/");
    await v.page.click("#ir-roleta");
    await settle(v.page, "roleta", "/roleta");
    // O endereço completo do script inline virou "/produto/camiseta" no salvar.
    await v.page.click("#ir-camiseta-js");
    await settle(v.page, "camiseta", "/produto/camiseta");
    expect(v.navigations).toEqual(["/", "/roleta", "/produto/camiseta"]);
    expect(v.original).toEqual([]);
    expect(v.problems).toEqual([]);
    await v.context.close();
  }, 60_000);
});

describe("ZIP: funil clonado com scripts", () => {
  it("index.html nos caminhos originais que ficaram em outra pasta (e só neles)", async () => {
    const read = (p: string) => readFile(path.join(siteDir, p), "utf8").catch(() => null);
    expect(await read("roleta/index.html")).toContain('content="0;url=../roleta-da-sorte/"');
    expect(await read("produto/camiseta/index.html")).toContain('content="0;url=../../camiseta/"');
    expect(await read("colecao/verao/chinelo/index.html")).toContain('content="0;url=../../../chinelo/"');
    // Mesma pasta do caminho original: a página mesmo, sem redirecionamento.
    expect(await read("loja/index.html")).toContain('data-pagina="loja"');
    expect(await read("index.html")).toContain('data-pagina="quiz"');
    // O "img/etapa.png" que o script monta, no caminho original de cada rota.
    expect(await read("produto/img/etapa.png")).not.toBeNull();
    expect(await read("colecao/verao/chinelo/img/etapa.png")).not.toBeNull();
  });

  it("redirecionamentos nos caminhos originais e cada etapa na página clonada", async () => {
    const v = await visit();
    await v.page.goto(`${zipBase}/`);
    await settle(v.page, "quiz", "/");
    await waitImages(v.page);
    expect(await screen(v.page)).toEqual({ tela: "tela quiz", foto: true, etapa: true, cor: "rgb(0, 170, 85)" });

    // location.href = "/roleta" → a pasta da roleta no ZIP (roleta-da-sorte/), com "/roleta" na barra.
    await v.page.click("#ir-roleta");
    await settle(v.page, "roleta", "/roleta");
    await waitImages(v.page);
    expect(await screen(v.page)).toEqual({ tela: "tela roleta", foto: true, etapa: true, cor: "rgb(0, 170, 85)" });
    expect(v.navigations).toEqual(["/", "/roleta-da-sorte/"]);

    // Recarregar: /roleta → /roleta/ (hospedagem) → redirecionamento → a página.
    await v.page.reload();
    await settle(v.page, "roleta", "/roleta");

    // Caminho original mais fundo que a pasta da página: as imagens e scripts carregam.
    await v.page.goto(`${zipBase}/produto/camiseta`);
    await settle(v.page, "camiseta", "/produto/camiseta");
    await waitImages(v.page);
    expect(await screen(v.page)).toMatchObject({ tela: "tela camiseta", foto: true, etapa: true });
    await v.page.goto(`${zipBase}/chinelo/`);
    await settle(v.page, "chinelo", "/colecao/verao/chinelo/");
    await waitImages(v.page);
    expect(await screen(v.page)).toMatchObject({ tela: "tela chinelo", foto: true, etapa: true });
    // O script do Offer Studio (endereço relativo) carregou também.
    expect(await v.page.evaluate(() => !!document.querySelector("script[data-os-runtime]"))).toBe(true);

    // location.assign para o site original, pushState e link → a loja do ZIP.
    await v.page.goto(`${zipBase}/`);
    await settle(v.page, "quiz", "/");
    await v.page.click("#ir-loja-abs");
    await settle(v.page, "loja", "/loja/");
    await v.page.goto(`${zipBase}/produto/camiseta/`);
    await settle(v.page, "camiseta", "/produto/camiseta");
    await v.page.click("#ir-loja-push");
    await settle(v.page, "loja", "/loja/");
    await v.page.goto(`${zipBase}/roleta`);
    await settle(v.page, "roleta", "/roleta");
    await v.page.click("#link-loja");
    await settle(v.page, "loja", "/loja/");
    const [popup] = await Promise.all([v.context.waitForEvent("page"), v.page.click("#abrir-roleta")]);
    await settle(popup, "roleta", "/roleta");

    expect(v.original).toEqual([]);
    expect(v.problems).toEqual([]);
    await v.context.close();
  }, 90_000);

  it("aberto do computador (file://): sem trocar o endereço, imagens e scripts carregam", async () => {
    const v = await visit();
    await v.page.goto(`file://${path.join(siteDir, "chinelo", "index.html")}`);
    await v.page.waitForFunction(() => document.readyState === "complete");
    await waitImages(v.page);
    expect(await screen(v.page)).toMatchObject({ foto: true, etapa: true, cor: "rgb(0, 170, 85)" });
    // O navegador não deixa trocar o caminho de um file://: os endereços partem do <base>.
    expect(await v.page.evaluate(() => [location.pathname.endsWith("/chinelo/index.html"), document.baseURI])).toEqual([
      true,
      `file://${path.join(siteDir, "colecao/verao/chinelo/")}`,
    ]);
    await v.page.goto(`file://${path.join(siteDir, "camiseta", "index.html")}`);
    await v.page.waitForFunction(() => document.readyState === "complete");
    await waitImages(v.page);
    expect(await screen(v.page)).toMatchObject({ foto: true, cor: "rgb(0, 170, 85)" });
    await v.context.close();
  }, 60_000);

  it("sem a API Navigation (Safari): os caminhos originais levam às páginas pelos redirecionamentos", async () => {
    const v = await visit({ noNavigationApi: true });
    await v.page.goto(`${zipBase}/`);
    await settle(v.page, "quiz", "/");
    await v.page.click("#ir-roleta");
    await settle(v.page, "roleta", "/roleta");
    await v.page.click("#ir-camiseta-js");
    await settle(v.page, "camiseta", "/produto/camiseta");
    await waitImages(v.page);
    expect(await screen(v.page)).toMatchObject({ tela: "tela camiseta", foto: true, etapa: true });
    expect(v.original).toEqual([]);
    expect(v.problems).toEqual([]);
    await v.context.close();
  }, 60_000);
});
