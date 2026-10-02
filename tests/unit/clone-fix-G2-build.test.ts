/**
 * Correções da Fase 2 (grupo G2), de ponta a ponta no construtor da cópia:
 * buildClone com capturas montadas à mão e downloads falsos (sem rede), e a
 * cópia aberta num Chromium de verdade que só enxerga "preview.test" (servido
 * a partir do storage, como a prévia) com o runtime do Offer Studio.
 */
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { buildSync } from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { injectRuntime, runtimeScript } from "@/lib/runtime-bundle";
import { getObject, mimeFromKey } from "@/lib/storage";
import { buildClone } from "@/worker/clone/build";
import type { VirtualSite } from "@/worker/clone/capture";
import { FetchError, type Fetcher } from "@/worker/clone/fetcher";
import { IMPORT_ORIGIN, PASTE_ORIGIN } from "@/worker/clone/synthetic";
import type { Capture, CapturedResponse, CloneModeValue, CloneResult, Device } from "@/worker/clone/types";

// ─── Montagem ────────────────────────────────────────────────────────────────

type FileSpec = { body: string | Buffer; type: string };

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
  opts: { rendered?: string; responses?: Record<string, FileSpec>; title?: string } = {},
): Capture {
  return {
    device,
    requestedUrl: url,
    finalUrl: url,
    status: 200,
    title: opts.title ?? "",
    originalHtml: html,
    renderedHtml: opts.rendered ?? html,
    responses: responsesOf(opts.responses ?? {}),
    blocked: [],
  };
}

/** "Rede" falsa: só os arquivos informados existem; anota cada pedido. */
function fakeFetcher(files: Record<string, FileSpec>, calls: string[]): Fetcher {
  const find = (url: string) => files[url];
  return {
    async fetchResource(url) {
      calls.push(url);
      if (/\.offerstudio\b/.test(new URL(url).hostname)) throw new Error(`pedido a host interno: ${url}`);
      const f = find(url);
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
      const f = find(url);
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
  opts: { files?: Record<string, FileSpec>; maxVideoBytes?: number; virtualSite?: VirtualSite; fileName?: string } = {},
): Promise<BuildRun> {
  const calls: string[] = [];
  const logs: BuildRun["logs"] = [];
  const result = await buildClone({
    jobId: `g2-${randomUUID()}`,
    captures,
    fetcher: fakeFetcher(opts.files ?? {}, calls),
    log: (level, message, url) => logs.push({ level, message, url }),
    maxVideoBytes: opts.maxVideoBytes ?? 50 * 1024 * 1024,
    startedAt: Date.now(),
    virtualSite: opts.virtualSite,
    fileName: opts.fileName,
  });
  return { result, calls, logs };
}

async function output(result: CloneResult, mode: CloneModeValue, device: Device = "desktop") {
  const out = result.devices[device]?.outputs[mode];
  if (!out) throw new Error(`sem saída ${device}/${mode}`);
  return (await getObject(out.htmlKey)).toString("utf8");
}

const codes = (r: CloneResult) => r.warnings.map((w) => w.code);

// ─── Navegador ───────────────────────────────────────────────────────────────

let browser: Browser;
let runtimeTags = "";
let compatCode = "";

beforeAll(async () => {
  browser = await chromium.launch();
  // Runtime da página + compatibilidade do modo Editável (o os-runtime passa a chamá-la).
  compatCode = buildSync({
    stdin: {
      contents: 'import { initCloneCompat } from "./src/runtime/clone-compat"; initCloneCompat();',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    target: ["es2018"],
    write: false,
  }).outputFiles[0].text;
  runtimeTags = `<script data-os-runtime>${runtimeScript()}</script><script>${compatCode}</script>`;
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

/**
 * Abre a cópia como a prévia: "/" é o HTML, /os-assets/ vem do storage e, no
 * Preservar JS, os caminhos originais vêm do assetMap. Nada mais é acessível.
 */
async function open(
  html: string,
  opts: { assetMap?: Record<string, string>; width?: number; query?: string } = {},
): Promise<{ page: Page; missing: string[]; external: string[] }> {
  const page = await browser.newPage({ viewport: { width: opts.width ?? 1280, height: 900 } });
  const missing: string[] = [];
  const external: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:" || url.protocol === "blob:") return route.continue();
    if (url.host !== "preview.test") {
      external.push(url.href);
      return route.abort();
    }
    if (url.pathname === "/") {
      return route.fulfill({ body: injectRuntime(html, runtimeTags), contentType: "text/html; charset=utf-8" });
    }
    let key: string | undefined;
    if (url.pathname.startsWith("/os-assets/")) {
      const file = url.pathname.slice("/os-assets/".length);
      key = `a/${file.slice(0, 2)}/${file}`;
    } else {
      key = opts.assetMap?.[`${url.pathname}${url.search}`] ?? opts.assetMap?.[url.pathname];
    }
    if (key) {
      try {
        return await route.fulfill({ body: await getObject(key), contentType: mimeFromKey(key) });
      } catch {
        // cai no 404
      }
    }
    missing.push(url.pathname);
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`http://preview.test/${opts.query ?? ""}`, { waitUntil: "load" });
  await page.waitForTimeout(100);
  return { page, missing, external };
}

// ─── fidelity#1 ──────────────────────────────────────────────────────────────

describe("fidelity#1 — seção só de celular com animação de entrada (Elementor)", () => {
  const url = "https://elementor.test/";
  const css = `<style>
    .elementor-invisible{visibility:hidden}
    @media (min-width:1025px){.elementor-hidden-desktop{display:none}}
    @media (max-width:767px){.elementor-hidden-mobile{display:none}}
    [data-aos^=fade][data-aos^=fade]{opacity:0}
    [data-aos^=fade][data-aos^=fade].aos-animate{opacity:1}
  </style>`;
  const original = `<!doctype html><html><head><title>Elementor</title>${css}</head><body>
    <h1 class="elementor-hidden-mobile">Título desktop</h1>
    <h2 id="m" class="elementor-element elementor-hidden-desktop elementor-invisible" data-settings='{"_animation":"fadeInUp"}'>Oferta no celular</h2>
    <p id="a" data-aos="fade-up">Depoimento</p>
  </body></html>`;

  it("a cópia de celular (que reaproveita o DOM do desktop) mostra a seção", async () => {
    // Desktop: a seção nunca entrou na tela, então continuou invisível.
    const desktop = capture("desktop", url, original, { title: "Elementor" });
    const mobile = capture("mobile", url, original, {
      title: "Elementor",
      rendered: original.replace("elementor-invisible", "animated fadeInUp"),
    });
    const { result } = await build([desktop, mobile]);
    expect(result.responsive).toBe(true);
    expect(result.devices.mobile?.outputs.EDITABLE.htmlKey).toBe(result.devices.desktop?.outputs.EDITABLE.htmlKey);
    const html = await output(result, "EDITABLE", "mobile");
    expect(html).toContain('<h2 id="m" class="elementor-element elementor-hidden-desktop"');

    const { page } = await open(html, { width: 412 });
    try {
      expect(await page.$eval("#m", (el) => getComputedStyle(el).visibility)).toBe("visible");
      expect(await page.$eval("#a", (el) => getComputedStyle(el).opacity)).toBe("1");
    } finally {
      await page.close();
    }
  });
});

// ─── fidelity#2 ──────────────────────────────────────────────────────────────

describe("fidelity#2 — Preservar JS com módulos ES divididos em pedaços (Vite/Lovable)", () => {
  const url = "https://quiz.test/";
  const html = `<!doctype html><html><head><title>Quiz</title>
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-xyz.js">
  </head><body><div id="root"></div></body></html>`;
  const js = "text/javascript; charset=utf-8";
  const responses = {
    "https://quiz.test/assets/index-abc.js": {
      type: js,
      body: `import { v } from "./vendor-xyz.js";
        const root = document.getElementById("root");
        root.textContent = v;
        root.addEventListener("click", () => import("./Quiz-1.js").then((m) => m.run()));`,
    },
    "https://quiz.test/assets/vendor-xyz.js": { type: js, body: `export const v = "quiz pronto";` },
  };
  // Só carrega depois do clique: não passou pela captura.
  const files = {
    "https://quiz.test/assets/Quiz-1.js": {
      type: js,
      body: `export function run() { document.body.dataset.quiz = "ok"; }`,
    },
  };

  it("os scripts do site ficam nos caminhos originais e os imports relativos funcionam", async () => {
    const { result } = await build([capture("desktop", url, html, { responses, title: "Quiz" })], { files });
    const out = result.devices.desktop?.outputs.PRESERVE_JS;
    const preserve = await output(result, "PRESERVE_JS");
    expect(preserve).toContain('src="/assets/index-abc.js"');
    expect(preserve).toContain('href="/assets/vendor-xyz.js"');
    expect(Object.keys(out?.assetMap ?? {}).sort()).toEqual([
      "/assets/Quiz-1.js",
      "/assets/index-abc.js",
      "/assets/vendor-xyz.js",
    ]);
    expect(result.stats.failed).toBe(0);

    const { page, missing, external } = await open(preserve, { assetMap: out?.assetMap });
    try {
      await page.waitForFunction(() => document.getElementById("root")?.textContent === "quiz pronto");
      await page.click("#root");
      await page.waitForFunction(() => document.body.dataset.quiz === "ok");
      expect(missing).toEqual([]);
      expect(external).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

// ─── fidelity#5 + security#7 ─────────────────────────────────────────────────

describe("fidelity#5 / security#7 — botões por onclick e javascript: no modo Editável", () => {
  const url = "https://botoes.test/vendas/";
  const html = `<!doctype html><html><head><title>Botões</title></head><body style="margin:0">
    <button id="wa" onclick="window.open('https://wa.me/5511999999999')">Fale no WhatsApp</button>
    <button id="anc" onclick="location.href='#oferta'">Quero garantir minha vaga</button>
    <button id="up" onclick="location.href='/obrigado'">Continuar</button>
    <div id="evil" data-os-href="javascript:location='https://original.test'">Comprar</div>
    <a id="jsl" href="javascript:alert(1)">Link</a>
    <div style="height:3000px"></div>
    <section id="oferta">Oferta</section>
  </body></html>`;

  it("destinos viram atributos que o runtime segue; javascript: some", async () => {
    const { result } = await build([capture("desktop", url, html, { title: "Botões" })]);
    const editable = await output(result, "EDITABLE");
    expect(editable).not.toMatch(/javascript:/i);
    expect(editable).not.toMatch(/onclick/i);
    expect(editable).toContain('data-os-href="https://wa.me/5511999999999"');
    expect(editable).toContain('data-os-href="https://botoes.test/obrigado"');

    const { page } = await open(editable);
    try {
      await page.click("#anc");
      await page.waitForFunction(() => location.hash === "#oferta");
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
      // O data-os-href malicioso não existe mais: clicar não sai da página.
      await page.click("#evil");
      await page.click("#jsl");
      await page.waitForTimeout(100);
      expect(page.url()).toBe("http://preview.test/#oferta");
    } finally {
      await page.close();
    }
  });
});

// ─── fidelity#6 ──────────────────────────────────────────────────────────────

describe("fidelity#6 — botão com atraso escondido por classe própria (.oculto-vsl)", () => {
  const url = "https://vsl.test/";
  const html = `<!doctype html><html><head><title>VSL</title><style>.oculto-vsl{display:none}</style></head><body>
    <vturb-smartplayer id="vid-0123456789abcdef01234567"></vturb-smartplayer>
    <div id="cta" class="oculto-vsl"><a href="https://pay.hotmart.com/X1" class="btn">Comprar agora</a></div>
    <script>
      var delaySeconds = 5;
      var player = document.querySelector("vturb-smartplayer");
      player.addEventListener("player:ready", function () { player.displayHiddenElements(delaySeconds, [".oculto-vsl"], { persist: true }); });
    </script>
  </body></html>`;

  it("aparece com 'Mostrar itens com delay' e fica escondido até o tempo sem ele", async () => {
    const { result } = await build([capture("desktop", url, html, { title: "VSL" })]);
    expect(result.delay).toEqual({ seconds: 5, elements: 1 });
    const editable = await output(result, "EDITABLE");

    const shown = await open(editable, { query: "?os_mostrar_delay=1" });
    try {
      expect(await shown.page.$eval("#cta", (el) => getComputedStyle(el).display)).not.toBe("none");
    } finally {
      await shown.page.close();
    }
    const waiting = await open(editable);
    try {
      expect(await waiting.page.$eval("#cta", (el) => getComputedStyle(el).display)).toBe("none");
    } finally {
      await waiting.page.close();
    }
  });
});

// ─── fidelity#9 + fidelity#10 ────────────────────────────────────────────────

describe("fidelity#9 / fidelity#10 — FAQ e capas de vídeo funcionam sem os scripts da página", () => {
  const url = "https://faq.test/";
  const html = `<!doctype html><html><head><title>FAQ</title><style>
      .elementor-accordion .elementor-tab-content{display:none}
      .collapse:not(.show){display:none}
      .panel{display:none}
      .rll-youtube-player{position:relative;padding-bottom:56.25%;height:0}
    </style></head><body>
    <div class="elementor-accordion">
      <div class="elementor-accordion-item">
        <div id="t1" class="elementor-tab-title elementor-active" data-tab="1" aria-expanded="true">Pergunta 1</div>
        <div id="c1" class="elementor-tab-content elementor-active" data-tab="1" style="display: block;">Resposta 1</div>
      </div>
      <div class="elementor-accordion-item">
        <div id="t2" class="elementor-tab-title" data-tab="2" aria-expanded="false">Pergunta 2</div>
        <div id="c2" class="elementor-tab-content" data-tab="2">Resposta 2</div>
      </div>
    </div>
    <button id="bs" data-bs-toggle="collapse" data-bs-target="#r1" aria-expanded="false">Bootstrap</button>
    <div id="r1" class="collapse">Resposta Bootstrap</div>
    <button id="w3" class="accordion">W3</button><div id="p3" class="panel">Resposta W3</div>
    <div id="yt" class="rll-youtube-player" data-src="https://www.youtube.com/embed/M7lc1UVf-VE" data-id="M7lc1UVf-VE" data-query="">
      <div data-id="M7lc1UVf-VE"><img id="thumb" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" style="width:100%"><div class="play">▶</div></div>
    </div>
    <script>
      var acc = document.getElementsByClassName("accordion");
      for (var i = 0; i < acc.length; i++) {
        acc[i].addEventListener("click", function () {
          this.classList.toggle("active");
          var panel = this.nextElementSibling;
          if (panel.style.display === "block") { panel.style.display = "none"; } else { panel.style.display = "block"; }
        });
      }
    </script>
  </body></html>`;

  it("acordeão do Elementor, collapse do Bootstrap, acordeão feito à mão e capa do YouTube", async () => {
    const { result } = await build([capture("desktop", url, html, { title: "FAQ" })]);
    const editable = await output(result, "EDITABLE");
    expect(editable).not.toContain("<script>var acc");
    const { page } = await open(editable);
    const shown = (sel: string) => page.$eval(sel, (el) => getComputedStyle(el).display !== "none");
    try {
      expect(await shown("#c2")).toBe(false);
      await page.click("#t2");
      expect(await shown("#c2")).toBe(true);
      expect(await shown("#c1")).toBe(false);

      expect(await shown("#r1")).toBe(false);
      await page.click("#bs");
      expect(await shown("#r1")).toBe(true);
      expect(await page.getAttribute("#bs", "aria-expanded")).toBe("true");

      expect(await shown("#p3")).toBe(false);
      await page.click("#w3");
      expect(await shown("#p3")).toBe(true);
      await page.click("#w3");
      expect(await shown("#p3")).toBe(false);

      await page.click("#thumb");
      expect(await page.getAttribute("#yt iframe", "src")).toBe("https://www.youtube.com/embed/M7lc1UVf-VE?autoplay=1");
    } finally {
      await page.close();
    }
  });
});

// ─── fidelity#11, #13, #15 e ux#6 ────────────────────────────────────────────

describe("fidelity#11 — vídeo HLS fica no endereço original", () => {
  it("o manifesto .m3u8 não vira .bin nem conta como falha", async () => {
    const url = "https://hls.test/";
    const html = `<!doctype html><html><head><title>HLS</title></head><body>
      <video id="v" controls><source src="https://cdn2.hls.test/hls/playlist.m3u8" type="application/x-mpegURL"></video>
      <video id="w" controls><source src="/stream/master" type="application/vnd.apple.mpegurl"></video>
    </body></html>`;
    const { result, calls } = await build([capture("desktop", url, html, { title: "HLS" })]);
    const editable = await output(result, "EDITABLE");
    expect(editable).toContain('src="https://cdn2.hls.test/hls/playlist.m3u8"');
    expect(editable).toContain('src="https://hls.test/stream/master"');
    expect(editable).not.toMatch(/\.bin"/);
    expect(calls).toEqual([]);
    expect(result.stats.failed).toBe(0);
    expect(codes(result)).not.toContain("ASSETS_FAILED");
    expect(codes(result)).not.toContain("EXTERNAL_REFS");
    // O aviso de vídeo de terceiros usa o nome amigável (não o código "HLS").
    expect(result.warnings.find((w) => w.code === "THIRD_PARTY_VIDEO")?.message).toContain("Vídeo em streaming (HLS)");
  });
});

describe("fidelity#13 — iframe relativo do próprio site", () => {
  it("vira endereço absoluto do site original (não do servidor da prévia)", async () => {
    const url = "https://form.test/vendas/";
    const html = `<!doctype html><html><head><title>Form</title></head><body>
      <iframe id="f" src="/form/index.html"></iframe>
      <iframe id="g" src="quiz/"></iframe>
      <iframe id="b" src="about:blank"></iframe>
    </body></html>`;
    const { result } = await build([capture("desktop", url, html, { title: "Form" })]);
    const editable = await output(result, "EDITABLE");
    expect(editable).toContain('id="f" src="https://form.test/form/index.html"');
    expect(editable).toContain('id="g" src="https://form.test/vendas/quiz/"');
    expect(editable).toContain('id="b" src="about:blank"');
  });
});

describe("fidelity#15 — <style> resolvido pelo <base href>", () => {
  it("baixa o arquivo certo, sem pedido errado nem aviso falso", async () => {
    const url = "https://legado.test/pagina.html";
    const html = `<!doctype html><html><head><title>Legado</title><base href="/sub/">
      <style>.hero{background:url(img/fundo.png)}</style></head><body><div class="hero">Oi</div></body></html>`;
    const files = { "https://legado.test/sub/img/fundo.png": { type: "image/png", body: Buffer.from("PNGDATA") } };
    const { result, calls } = await build([capture("desktop", url, html, { title: "Legado" })], { files });
    expect(calls).toEqual(["https://legado.test/sub/img/fundo.png"]);
    expect(result.stats.failed).toBe(0);
    expect(codes(result)).not.toContain("ASSETS_FAILED");
    expect(await output(result, "EDITABLE")).toMatch(/url\(\/os-assets\/[0-9a-f]{64}\.png\)/);
  });
});

describe("ux#6 — vídeos do site não baixados de propósito", () => {
  const url = "https://video.test/";
  const html = `<!doctype html><html><head><title>Vídeo</title></head><body>
    <video id="v" controls src="https://video.test/media/aula.mp4"></video></body></html>`;
  const files = { "https://video.test/media/aula.mp4": { type: "video/mp4", body: Buffer.alloc(4096, 1) } };

  it("'Não baixar': sem download, sem 'arquivo quebrado', vídeo marcado como não baixado", async () => {
    const { result, calls, logs } = await build([capture("desktop", url, html, { title: "Vídeo" })], {
      files,
      maxVideoBytes: 0,
    });
    expect(calls).toEqual([]);
    expect(result.stats.failed).toBe(0);
    expect(codes(result)).not.toContain("ASSETS_FAILED");
    expect(codes(result)).not.toContain("EXTERNAL_REFS");
    const warning = result.warnings.find((w) => w.code === "VIDEOS_NOT_DOWNLOADED");
    expect(warning?.message).toContain("“Não baixar”");
    expect(result.videos).toEqual([
      { provider: "NATIVE", src: "https://video.test/media/aula.mp4", thirdParty: false, downloaded: false },
    ]);
    expect(logs.some((l) => /1 KB/.test(l.message))).toBe(false);
    expect(await output(result, "EDITABLE")).toContain('src="https://video.test/media/aula.mp4"');
  });

  it("maior que o limite: mesmo tratamento, com o limite na mensagem", async () => {
    const { result } = await build([capture("desktop", url, html, { title: "Vídeo" })], {
      files,
      maxVideoBytes: 1024,
    });
    expect(result.stats.failed).toBe(0);
    expect(result.warnings.find((w) => w.code === "VIDEOS_NOT_DOWNLOADED")?.message).toContain("1 KB");
    expect(result.videos[0]?.downloaded).toBe(false);
  });

  it("baixado: downloaded = true e o src vira /os-assets/", async () => {
    const { result } = await build([capture("desktop", url, html, { title: "Vídeo" })], { files });
    expect(result.videos[0]?.downloaded).toBe(true);
    expect(codes(result)).not.toContain("VIDEOS_NOT_DOWNLOADED");
    expect(await output(result, "EDITABLE")).toMatch(/src="\/os-assets\/[0-9a-f]{64}\.mp4"/);
  });
});

// ─── fidelity#8 ──────────────────────────────────────────────────────────────

describe("fidelity#8 — landing page do RD Station mantém as imagens", () => {
  it("a imagem do CDN do RD Station é baixada, não removida como pixel", async () => {
    const url = "https://lp.rd.test/";
    const img = "https://d335luupugsy2.cloudfront.net/cms/files/1/logo.png";
    const html = `<!doctype html><html><head><title>RD</title></head><body><img id="logo" src="${img}"></body></html>`;
    const { result } = await build([capture("desktop", url, html, { title: "RD" })], {
      files: { [img]: { type: "image/png", body: Buffer.from("LOGO") } },
    });
    expect(result.removed).toEqual([]);
    expect(await output(result, "EDITABLE")).toMatch(/<img id="logo" src="\/os-assets\/[0-9a-f]{64}\.png">/);
  });
});

// ─── fidelity#14 ─────────────────────────────────────────────────────────────

describe("fidelity#14 — Preservar JS e endereços absolutos do site original nos scripts", () => {
  it("o que a cópia tem passa a vir dela; o resto gera aviso", async () => {
    const url = "https://wp.test/oferta/";
    const html = `<!doctype html><html><head><title>WP</title>
      <script>var elementorFrontendConfig = {"urls":{"assets":"https:\\/\\/wp.test\\/wp-content\\/plugins\\/elementor\\/assets\\/"},"home":"https:\\/\\/wp.test\\/"};
      var ajaxurl = "https://wp.test/wp-admin/admin-ajax.php";</script>
      <script type="application/ld+json">{"url":"https://wp.test/oferta/"}</script>
      </head><body><div data-settings='{"bg":"https://wp.test/wp-content/uploads/fundo.jpg"}'></div>
      <a href="https://wp.test/obrigado/">Obrigado</a></body></html>`;
    const responses = {
      "https://wp.test/wp-content/plugins/elementor/assets/js/frontend.min.js": {
        type: "application/javascript",
        body: "window.ok=1;",
      },
      "https://wp.test/wp-content/uploads/fundo.jpg": { type: "image/jpeg", body: Buffer.from("JPG") },
    };
    const { result } = await build([capture("desktop", url, html, { responses, title: "WP" })]);
    const preserve = await output(result, "PRESERVE_JS");
    expect(preserve).toContain('"assets":"\\/wp-content\\/plugins\\/elementor\\/assets\\/"');
    expect(preserve).toContain('data-settings="{&quot;bg&quot;:&quot;/wp-content/uploads/fundo.jpg&quot;}"');
    // Navegação, dados estruturados e endpoints que a cópia não tem ficam como estavam.
    expect(preserve).toContain('href="https://wp.test/obrigado/"');
    expect(preserve).toContain('{"url":"https://wp.test/oferta/"}');
    expect(preserve).toContain('"https://wp.test/wp-admin/admin-ajax.php"');
    const warning = result.warnings.find((w) => w.code === "PRESERVE_JS_ORIGIN");
    expect(warning?.url).toBe("https://wp.test/wp-admin/admin-ajax.php");
    expect(warning?.message).toContain("“Preservar JS”");
  });
});

// ─── data#4 / ux#2 / ux#10 ───────────────────────────────────────────────────

function virtualSite(origin: string, files: Record<string, FileSpec>, fallthrough = false): VirtualSite {
  return {
    origin,
    fallthrough,
    get(pathname) {
      const f = files[pathname];
      return f ? { body: Buffer.from(f.body), contentType: f.type } : null;
    },
  };
}

describe("data#4 / ux#2 / ux#10 — ZIP e HTML colado sem link de origem", () => {
  const body = `<body>
    <a id="up" href="upsell.html">Oferta especial</a>
    <a id="ty" href="obrigado.html">Obrigado</a>
    <button id="b" onclick="location.href='obrigado.html'">Ir</button>
    <img id="ok" src="img/a.png"><img id="miss" src="img/faltando.png">
  </body>`;

  it("ZIP: links relativos continuam relativos, sem sugestões de funil nem host interno", async () => {
    const url = `${IMPORT_ORIGIN}/index.html`;
    const site = virtualSite(IMPORT_ORIGIN, { "/img/a.png": { type: "image/png", body: "A" } });
    const html = `<!doctype html><html><head></head>${body}</html>`;
    const { result, logs } = await build([capture("desktop", url, html)], {
      virtualSite: site,
      fileName: "minha-oferta.zip",
    });
    expect(result.funnel).toEqual([]);
    const editable = await output(result, "EDITABLE");
    const preserve = await output(result, "PRESERVE_JS");
    expect(editable).not.toContain("offerstudio");
    expect(preserve).not.toContain("offerstudio");
    expect(editable).toContain('id="up" href="upsell.html"');
    expect(editable).toContain('id="ty" href="obrigado.html"');
    expect(editable).toContain('data-os-href="obrigado.html"');
    expect(editable).toMatch(/id="ok" src="\/os-assets\/[0-9a-f]{64}\.png"/);
    expect(logs.find((l) => l.url?.endsWith("/img/faltando.png"))?.message).toContain("não está no ZIP");
    expect(codes(result)).toContain("ASSETS_FAILED");
    expect(codes(result)).not.toContain("EXTERNAL_REFS");
    expect(codes(result)).not.toContain("RELATIVE_PATHS");
    expect(result.title).toBe("minha-oferta");
  });

  it("HTML colado: mensagem certa (Link de origem), aviso próprio e título 'Página importada'", async () => {
    const url = `${PASTE_ORIGIN}/index.html`;
    const site = virtualSite(PASTE_ORIGIN, {});
    const html = `<!doctype html><html><head><link rel="stylesheet" href="css/estilo.css"></head>${body}</html>`;
    const { result, logs } = await build([capture("desktop", url, html)], { virtualSite: site });
    const failures = logs.filter((l) => l.level === "WARN" && l.message.startsWith("Não foi possível baixar"));
    expect(failures.length).toBe(3);
    for (const f of failures) {
      expect(f.message).toContain("Link de origem");
      expect(f.message).not.toContain("ZIP");
    }
    expect(codes(result)).toContain("RELATIVE_PATHS");
    expect(codes(result)).not.toContain("EXTERNAL_REFS");
    expect(result.funnel).toEqual([]);
    expect(await output(result, "EDITABLE")).not.toContain("offerstudio");
    expect(result.title).toBe("Página importada");
  });

  it("HTML colado COM link de origem continua resolvendo pelo site real", async () => {
    const url = "https://real.test/vendas/";
    const site = virtualSite("https://real.test", {}, true);
    const html = `<!doctype html><html><head><title>Real</title></head><body><a id="ty" href="obrigado.html">Obrigado</a></body></html>`;
    const { result } = await build([capture("desktop", url, html, { title: "Real" })], { virtualSite: site });
    expect(await output(result, "EDITABLE")).toContain('href="https://real.test/vendas/obrigado.html"');
    expect(result.funnel.map((f) => f.url)).toEqual(["https://real.test/vendas/obrigado.html"]);
  });
});

// ─── runtime (src/runtime/clone-compat.ts) ───────────────────────────────────

describe("fidelity#9 / fidelity#10 — runtime clone-compat em widgets comuns", () => {
  const html = `<!doctype html><html><head><title>Runtime</title><style>
      .tab-content > .tab-pane{display:none} .tab-content > .active{display:block}
      .e-n-tabs-content > .e-con:not(.e-active){display:none}
      .faq-a[hidden]{display:none}
      .elementor-wrapper{position:relative;width:320px;height:180px}
      .elementor-custom-embed-image-overlay{position:absolute;inset:0;background:#000}
    </style></head><body>
    <ul class="nav nav-tabs" role="tablist">
      <li><a id="bt1" class="nav-link active" data-bs-toggle="tab" href="#p1" aria-selected="true">Aba 1</a></li>
      <li><a id="bt2" class="nav-link" data-bs-toggle="tab" href="#p2" aria-selected="false">Aba 2</a></li>
    </ul>
    <div class="tab-content"><div id="p1" class="tab-pane active show">Um</div><div id="p2" class="tab-pane">Dois</div></div>

    <div class="e-n-tabs"><div class="e-n-tabs-heading" role="tablist">
      <button id="nt1" class="e-n-tab-title" role="tab" aria-selected="true" aria-controls="nc1">A</button>
      <button id="nt2" class="e-n-tab-title" role="tab" aria-selected="false" aria-controls="nc2">B</button>
    </div><div class="e-n-tabs-content">
      <div id="nc1" class="e-con e-active elementor-element elementor-element-aaa">Conteúdo A</div>
      <div id="nc2" class="e-con elementor-element elementor-element-bbb">Conteúdo B</div>
    </div></div>

    <button id="disc" aria-expanded="false" aria-controls="ans">Pergunta</button>
    <p id="ans" class="faq-a" hidden>Resposta</p>

    <div class="elementor-widget-video"><div class="elementor-wrapper"><div class="elementor-video"></div>
      <div id="ov" class="elementor-custom-embed-image-overlay" data-os-embed="https://www.youtube.com/embed/aqz-KE-bpKQ?autoplay=1" data-os-embed-mode="overlay" data-os-embed-slot=".elementor-video"></div>
    </div></div>
    <div id="evil" data-os-embed="https://evil.test/embed/x">capa falsa</div>

    <button id="tg" data-os-toggle="aberto@next">Toggle</button><div id="alvo">x</div>
  </body></html>`;

  it("abas (Bootstrap e Elementor), aria-expanded, capa do Elementor e data-os-toggle idempotente", async () => {
    // Runtime carregado duas vezes: nada pode rodar em dobro.
    const { page } = await open(html.replace("</body>", `<script>${compatCode}</script></body>`));
    const shown = (sel: string) => page.$eval(sel, (el) => getComputedStyle(el).display !== "none");
    try {
      await page.click("#bt2");
      expect(await shown("#p2")).toBe(true);
      expect(await shown("#p1")).toBe(false);
      expect(await page.getAttribute("#bt2", "aria-selected")).toBe("true");

      await page.click("#nt2");
      expect(await shown("#nc2")).toBe(true);
      expect(await shown("#nc1")).toBe(false);
      // Classes próprias de cada elemento (estilo) não mudam de dono.
      expect(await page.getAttribute("#nc2", "class")).toBe("e-con elementor-element elementor-element-bbb e-active");

      await page.click("#disc");
      expect(await shown("#ans")).toBe(true);
      expect(await page.getAttribute("#disc", "aria-expanded")).toBe("true");

      await page.click("#ov");
      expect(await page.$("#ov")).toBeNull();
      expect(await page.getAttribute(".elementor-wrapper iframe", "src")).toBe(
        "https://www.youtube.com/embed/aqz-KE-bpKQ?autoplay=1",
      );
      expect(await page.getAttribute(".elementor-wrapper iframe", "class")).toBe("elementor-video");

      await page.click("#evil");
      expect(await page.$("#evil iframe")).toBeNull();

      await page.click("#tg");
      expect(await page.getAttribute("#alvo", "class")).toBe("aberto");
    } finally {
      await page.close();
    }
  });
});
