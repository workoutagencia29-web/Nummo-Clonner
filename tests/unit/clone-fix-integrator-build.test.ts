/**
 * Integração das correções da Fase 2 no construtor da cópia (build.ts) e na
 * captura (capture.ts), com capturas montadas à mão e uma "rede" falsa:
 * - G1 security#1: caminho de arquivo importado decodificado igual à captura
 *   (safeDecode) e origem comparada por inteiro, não por prefixo.
 * - G1 fidelity#12: o doctype original (ou a falta dele) chega às duas saídas.
 * - G1 data#6: clonagem cancelada não baixa CSS nem registra falsas falhas.
 * - G2 (opcional): documentos do próprio site (iframes) viram .html no
 *   "Preservar JS" e nunca são trocados por caminho local nos scripts.
 * - G2 fidelity#8 (captura): imagens de CDNs de marketing não são bloqueadas.
 * - G3 ux#19 / miniatura: textos dos avisos e miniatura sem print do desktop.
 */
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { type Browser, chromium } from "playwright";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getObject, mimeFromKey } from "@/lib/storage";
import { buildClone } from "@/worker/clone/build";
import { capturePage, type VirtualSite } from "@/worker/clone/capture";
import { FetchError, type Fetcher } from "@/worker/clone/fetcher";
import { IMPORT_ORIGIN } from "@/worker/clone/synthetic";
import type { Capture, CapturedResponse, CloneModeValue, CloneResult, Device } from "@/worker/clone/types";
import { safeDecode } from "@/worker/clone/urls";

type FileSpec = { body: string | Buffer; type: string };

const TEXT = `<p>${"Texto da oferta com bastante conteúdo para não parecer vazia. ".repeat(8)}</p>`;
const LEGACY_DOCTYPE =
  '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">';

function responsesOf(files: Record<string, FileSpec>): Map<string, CapturedResponse> {
  const map = new Map<string, CapturedResponse>();
  for (const [url, f] of Object.entries(files)) {
    map.set(url, { url, status: 200, contentType: f.type, body: Buffer.from(f.body) });
  }
  return map;
}

function capture(
  device: Device,
  url: string,
  html: string,
  opts: { rendered?: string; responses?: Record<string, FileSpec>; screenshot?: Buffer } = {},
): Capture {
  return {
    device,
    requestedUrl: url,
    finalUrl: url,
    status: 200,
    title: "Oferta",
    originalHtml: html,
    renderedHtml: opts.rendered ?? html,
    responses: responsesOf(opts.responses ?? {}),
    blocked: [],
    screenshot: opts.screenshot,
  };
}

/** "Rede" falsa: só os arquivos informados existem; anota cada pedido. */
function fakeFetcher(files: Record<string, FileSpec>, calls: string[], onRequest?: (url: string) => void): Fetcher {
  return {
    async fetchResource(url) {
      calls.push(url);
      onRequest?.(url);
      const f = files[url];
      if (!f) {
        return {
          ok: false,
          status: 404,
          finalUrl: url,
          contentType: "",
          body: Buffer.alloc(0),
          error: "O servidor respondeu 404: arquivo não encontrado.",
        };
      }
      return { ok: true, status: 200, finalUrl: url, contentType: f.type, body: Buffer.from(f.body) };
    },
    async downloadToFile(url, dest, maxBytes) {
      calls.push(url);
      onRequest?.(url);
      const f = files[url];
      if (!f) throw new FetchError("O servidor respondeu 404: arquivo não encontrado.", "HTTP_STATUS", 404);
      const body = Buffer.from(f.body);
      if (body.length > maxBytes) throw new FetchError("Arquivo maior que o limite.", "TOO_LARGE");
      await writeFile(dest, body);
      return {
        bytes: body.length,
        sha256: createHash("sha256").update(body).digest("hex"),
        contentType: f.type,
        finalUrl: url,
      };
    },
    async close() {},
  };
}

interface BuildRun {
  result: CloneResult;
  calls: string[];
  logs: { level: string; message: string; url?: string }[];
}

async function build(
  captures: Capture[],
  opts: {
    files?: Record<string, FileSpec>;
    virtualSite?: VirtualSite;
    signal?: AbortSignal;
    onRequest?: (url: string) => void;
  } = {},
): Promise<BuildRun> {
  const calls: string[] = [];
  const logs: BuildRun["logs"] = [];
  const result = await buildClone({
    jobId: `int-${randomUUID()}`,
    captures,
    fetcher: fakeFetcher(opts.files ?? {}, calls, opts.onRequest),
    log: (level, message, url) => logs.push({ level, message, url }),
    maxVideoBytes: 50 * 1024 * 1024,
    startedAt: Date.now(),
    virtualSite: opts.virtualSite,
    signal: opts.signal,
  });
  return { result, calls, logs };
}

async function output(result: CloneResult, mode: CloneModeValue, device: Device = "desktop") {
  const out = result.devices[device]?.outputs[mode];
  if (!out) throw new Error(`sem saída ${device}/${mode}`);
  return (await getObject(out.htmlKey)).toString("utf8");
}

/** Site virtual (ZIP) que responde pelo caminho já decodificado, como o da importação. */
function zipSite(files: Record<string, FileSpec>): VirtualSite & { asked: string[] } {
  const asked: string[] = [];
  return {
    origin: IMPORT_ORIGIN,
    asked,
    get(pathname) {
      asked.push(pathname);
      const f = files[pathname];
      return f ? { body: Buffer.from(f.body), contentType: f.type } : null;
    },
  };
}

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// ─── security#1 ──────────────────────────────────────────────────────────────

describe("G1 security#1 — arquivos importados na montagem", () => {
  it("caminho com acento em UTF-8 e escape Latin-1 misturados: a montagem acha o mesmo arquivo que a captura", async () => {
    const ref = "img/promo%C3%A7%C3%A3o-%E7.png";
    // A captura serve o arquivo pelo caminho decodificado com safeDecode.
    const decoded = safeDecode(`/${ref}`);
    expect(decoded).toBe("/img/promoção-%E7.png");
    const site = zipSite({ [decoded]: { body: PNG_1PX, type: "image/png" } });
    const url = `${IMPORT_ORIGIN}/index.html`;
    const html = `<!doctype html><html><head><title>ZIP</title></head><body>${TEXT}<img id="a" src="${ref}"></body></html>`;
    const { result, logs } = await build([capture("desktop", url, html)], { virtualSite: site });
    expect(site.asked).toContain("/img/promoção-%E7.png");
    expect(result.stats.failed).toBe(0);
    expect(result.warnings.map((w) => w.code)).not.toContain("ASSETS_FAILED");
    expect(logs.filter((l) => l.level === "WARN")).toEqual([]);
    expect(await output(result, "EDITABLE")).toMatch(/<img id="a" src="\/os-assets\/[0-9a-f]{64}\.png"/);
  });

  it("host que só começa igual à origem do ZIP é baixado da internet, não procurado no ZIP", async () => {
    const site = zipSite({});
    const outside = "http://importado.offerstudio.example/logo.png";
    const url = `${IMPORT_ORIGIN}/index.html`;
    const html = `<!doctype html><html><head><title>ZIP</title></head><body>${TEXT}<img id="b" src="${outside}"></body></html>`;
    const { result, calls, logs } = await build([capture("desktop", url, html)], {
      virtualSite: site,
      files: { [outside]: { body: PNG_1PX, type: "image/png" } },
    });
    expect(calls).toContain(outside);
    expect(site.asked).not.toContain("/logo.png");
    expect(logs.some((l) => /não está no ZIP/.test(l.message))).toBe(false);
    expect(result.stats.failed).toBe(0);
    expect(await output(result, "EDITABLE")).toMatch(/<img id="b" src="\/os-assets\/[0-9a-f]{64}\.png"/);
  });
});

// ─── fidelity#12 ─────────────────────────────────────────────────────────────

describe("G1 fidelity#12 — doctype nas duas saídas", () => {
  it("doctype antigo (HTML 4.01 Transitional) é mantido no Editável e no Preservar JS", async () => {
    const html = `${LEGACY_DOCTYPE}\n<html><head><meta charset="utf-8"><title>Antiga</title></head><body>${TEXT}</body></html>`;
    const { result } = await build([capture("desktop", "https://antiga.test/", html)]);
    for (const mode of ["EDITABLE", "PRESERVE_JS"] as const) {
      const out = await output(result, mode);
      expect(out.startsWith(LEGACY_DOCTYPE), mode).toBe(true);
      expect(out.match(/<!doctype/gi)?.length, mode).toBe(1);
    }
  });

  it("página sem doctype continua sem (modo quirks) nas duas saídas", async () => {
    const html = `<html><head><meta charset="utf-8"><title>Quirks</title></head><body>${TEXT}</body></html>`;
    const { result } = await build([capture("desktop", "https://quirks.test/", html)]);
    for (const mode of ["EDITABLE", "PRESERVE_JS"] as const) {
      expect(/<!doctype/i.test(await output(result, mode)), mode).toBe(false);
    }
  });

  it("cada saída usa o doctype da sua fonte (DOM renderizado × HTML original)", async () => {
    const original = `<!doctype html><html><head><title>A</title></head><body>${TEXT}</body></html>`;
    const rendered = `${LEGACY_DOCTYPE}<html><head><title>A</title></head><body>${TEXT}</body></html>`;
    const { result } = await build([capture("desktop", "https://duas.test/", original, { rendered })]);
    expect((await output(result, "EDITABLE")).startsWith(LEGACY_DOCTYPE)).toBe(true);
    expect((await output(result, "PRESERVE_JS")).startsWith("<!doctype html>")).toBe(true);
  });
});

// ─── data#6 ──────────────────────────────────────────────────────────────────

describe("G1 data#6 — montagem cancelada", () => {
  const url = "https://cancelada.test/";
  const html = `<!doctype html><html><head><title>C</title><link rel="stylesheet" href="/estilo.css"></head><body>${TEXT}<img src="/foto.png"></body></html>`;

  it("já cancelada: nenhum CSS ou imagem é baixado e nada vira 'arquivo quebrado'", async () => {
    const controller = new AbortController();
    controller.abort();
    const { result, calls, logs } = await build([capture("desktop", url, html)], { signal: controller.signal });
    expect(calls).toEqual([]);
    expect(result.stats.failed).toBe(0);
    expect(logs.some((l) => l.message.startsWith("Não foi possível baixar"))).toBe(false);
  });

  it("cancelada no meio dos downloads: os downloads interrompidos não viram falha nem linhas de log", async () => {
    const controller = new AbortController();
    const { result, calls, logs } = await build([capture("desktop", url, html)], {
      signal: controller.signal,
      // O primeiro pedido "demora" e o usuário cancela: o fetcher devolve erro de cancelamento.
      onRequest: () => controller.abort(),
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(result.stats.failed).toBe(0);
    expect(result.warnings.map((w) => w.code)).not.toContain("ASSETS_FAILED");
    expect(logs.some((l) => l.message.startsWith("Não foi possível baixar"))).toBe(false);
  });
});

// ─── Documentos do próprio site no Preservar JS ──────────────────────────────

describe("G2 (urls.ts) — iframes do próprio site no Preservar JS", () => {
  it("o documento do iframe é guardado como .html e servido como página; scripts não o trocam por caminho local", async () => {
    const url = "https://quiz.test/";
    const html = `<!doctype html><html><head><title>Quiz</title><script src="/app.js"></script></head><body>${TEXT}
<iframe src="/quiz/etapa"></iframe>
<script>var etapa = "https://quiz.test/quiz/etapa"; var app = "https://quiz.test/app.js";</script></body></html>`;
    const { result } = await build([
      capture("desktop", url, html, {
        responses: {
          "https://quiz.test/app.js": { body: "window.ok = 1;", type: "text/javascript" },
          "https://quiz.test/quiz/etapa": {
            body: "<!doctype html><html><body>Etapa 1</body></html>",
            type: "text/html; charset=utf-8",
          },
        },
      }),
    ]);
    const assetMap = result.devices.desktop?.outputs.PRESERVE_JS.assetMap ?? {};
    expect(assetMap["/quiz/etapa"]).toMatch(/\.html$/);
    expect(mimeFromKey(assetMap["/quiz/etapa"] ?? "")).toMatch(/^text\/html/);
    expect((await getObject(assetMap["/quiz/etapa"] ?? "")).toString("utf8")).toContain("Etapa 1");
    const preserve = await output(result, "PRESERVE_JS");
    // Arquivo (script) passa a vir da cópia; o documento continua apontando para o site original.
    expect(preserve).toContain('var app = "/app.js"');
    expect(preserve).toContain('var etapa = "https://quiz.test/quiz/etapa"');
  });
});

// ─── Miniatura e textos dos avisos ───────────────────────────────────────────

describe("G3 — miniatura e avisos", () => {
  let jpeg: Buffer;
  beforeAll(async () => {
    jpeg = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#c00" } })
      .jpeg()
      .toBuffer();
  });
  const html = `<!doctype html><html><head><title>M</title></head><body>${TEXT}</body></html>`;

  it("só celular: a miniatura vem do print do celular", async () => {
    const { result } = await build([capture("mobile", "https://so-celular.test/", html, { screenshot: jpeg })]);
    expect(result.thumbnailKey).toMatch(/^a\/[0-9a-f]{2}\/[0-9a-f]{64}\.webp$/);
    expect(result.devices.mobile?.screenshotKey).toBeTruthy();
  });

  it("print do desktop falhou: a miniatura vem do celular", async () => {
    const { result } = await build([
      capture("desktop", "https://sem-print.test/", html),
      capture("mobile", "https://sem-print.test/", html, { screenshot: jpeg }),
    ]);
    expect(result.thumbnailKey).toBeTruthy();
    expect(result.devices.desktop?.screenshotKey).toBeUndefined();
  });

  it("vídeo de terceiros e tempo de VSL desconhecido: os avisos dizem onde trocar no editor", async () => {
    const page = `<!doctype html><html><head><title>VSL</title></head><body>${TEXT}
<iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe>
<div class="esconder"><a href="https://pay.hotmart.com/X1">Comprar</a></div><script src="js/delay.js"></script></body></html>`;
    const { result } = await build([capture("desktop", "https://vsl.test/", page)]);
    const video = result.warnings.find((w) => w.code === "THIRD_PARTY_VIDEO");
    expect(video?.message).toContain("troque pelo seu vídeo no editor (botão “Editar” da página, na oferta)");
    const delay = result.warnings.find((w) => w.code === "DELAY_UNKNOWN");
    expect(result.delay).toMatchObject({ seconds: 0 });
    expect(delay?.message).toContain("“Aparece depois de”");
  });
});

// ─── Captura: CDNs de marketing ──────────────────────────────────────────────

describe("G2 fidelity#8 — a captura não bloqueia imagens de CDNs de marketing", () => {
  let browser: Browser;
  let server: http.Server;
  let port = 0;
  const hits: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const host = (req.headers.host ?? "").split(":")[0];
      hits.push(`${host}${req.url}`);
      if (host === "gallery.mailchimp.com") {
        res.setHeader("content-type", "image/png");
        return res.end(PNG_1PX);
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>LP</title></head><body>${TEXT}
<img id="banner" src="http://gallery.mailchimp.com:${port}/abc/images/banner.png" width="600" height="200">
<img id="px" src="http://gallery.mailchimp.com:${port}/track/open.gif" width="1" height="1"></body></html>`);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise((r) => server?.close(r));
  });

  it("a imagem do banner é capturada; o pixel do mesmo host continua bloqueado", async () => {
    const cap = await capturePage({
      browser,
      device: "desktop",
      url: `http://lp.int.test:${port}/`,
      log: () => {},
      hostMap: { "lp.int.test": "127.0.0.1", "gallery.mailchimp.com": "127.0.0.1" },
      maxScrollMs: 300,
    });
    expect(cap.responses.has(`http://gallery.mailchimp.com:${port}/abc/images/banner.png`)).toBe(true);
    expect(hits).toContain("gallery.mailchimp.com/abc/images/banner.png");
    expect(hits).not.toContain("gallery.mailchimp.com/track/open.gif");
    expect(cap.blocked.map((b) => b.url)).toContain(`http://gallery.mailchimp.com:${port}/track/open.gif`);
  }, 120_000);
});
