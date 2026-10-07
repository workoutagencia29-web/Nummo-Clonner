/**
 * Integração da Fase 3 (peças dos vários módulos ligadas entre si):
 * - modelos de página ao criar página e ao criar oferta;
 * - códigos livres da página (head / início e fim do body) no HTML servido;
 * - script das páginas (widgets + compatibilidade de clones) num Chromium;
 * - envio de vídeo (POST /api/assets/video) e Range na prévia.
 */
import { createHash } from "node:crypto";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));

import { POST as uploadVideo } from "@/app/api/assets/video/route";
import { prisma } from "@/lib/db";
import { parseByteRange } from "@/lib/http-range";
import { injectPageCode, parsePageCode } from "@/lib/page-code";
import { renderPageHtml } from "@/lib/page-render";
import { injectRuntime, runtimeScript } from "@/lib/runtime-bundle";
import { deleteObject, getObject } from "@/lib/storage";
import { createOffer } from "@/server/services/offers";
import { templateHtml } from "@/server/services/page-templates";
import { createPage } from "@/server/services/pages";
import { sniffVideoFormat } from "@/server/services/video-assets";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";

const HOST = `localhost:${process.env.PORT || "3000"}`;
const written = new Set<string>();

beforeEach(async () => {
  await resetDatabase();
  getSession.mockReset();
  getSession.mockResolvedValue({ user: { id: "u1" }, session: { id: "s1" } });
});

afterAll(async () => {
  for (const key of written) await deleteObject(key).catch(() => undefined);
});

async function mainHtml(pageId: string) {
  const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { page: { id: pageId } } } });
  return doc.html ?? "";
}

// ─── Modelos de página ───────────────────────────────────────────────────────

describe("modelos ao criar página e oferta", () => {
  it("nova página a partir de um modelo: HTML do modelo, tipo do modelo e título com o nome", async () => {
    const offer = await createOffer({ name: "Oferta" });
    const page = await createPage({ offerId: offer.id, name: "Captura de leads", templateId: "captura" });
    const row = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    expect(row.type).toBe("CAPTURE");
    const html = await mainHtml(page.id);
    expect(html).toContain('data-os-widget="lead-form"');
    expect(html).toContain("<title>Captura de leads</title>");
  });

  it("o tipo escolhido na tela vale mais que o do modelo; sem modelo, página em branco de vendas", async () => {
    const offer = await createOffer({ name: "Oferta" });
    const typed = await createPage({ offerId: offer.id, name: "Obrigado", templateId: "obrigado", type: "OTHER" });
    expect((await prisma.page.findUniqueOrThrow({ where: { id: typed.id } })).type).toBe("OTHER");

    const blank = await createPage({ offerId: offer.id, name: "Em branco" });
    expect((await prisma.page.findUniqueOrThrow({ where: { id: blank.id } })).type).toBe("SALES");
    expect(await mainHtml(blank.id)).not.toContain("data-os-widget");
  });

  it("modelo inexistente: erro em português e nada é criado", async () => {
    const offer = await createOffer({ name: "Oferta" });
    await expectUserError(
      createPage({ offerId: offer.id, name: "X", templateId: "nao-existe" }),
      "Modelo de página não encontrado. Escolha outro modelo ou comece em branco.",
    );
    expect(await prisma.page.count({ where: { offerId: offer.id } })).toBe(1);
  });

  it("nova oferta com modelo: a página principal já nasce com ele", async () => {
    const offer = await createOffer({ name: "Método X", templateId: "vsl" });
    const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
    expect(home.type).toBe("VSL");
    expect(home.name).toBe("Página principal");
    const html = await mainHtml(home.id);
    expect(html).toContain("data-os-video");
    expect(html).toContain("<title>Método X</title>");

    const plain = await createOffer({ name: "Sem modelo" });
    const plainHome = await prisma.page.findFirstOrThrow({ where: { offerId: plain.id } });
    expect(plainHome.type).toBe("SALES");
  });
});

// ─── Códigos da página no HTML servido ───────────────────────────────────────

describe("renderPageHtml com códigos da página", () => {
  const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>T</title></head><body class="x"><a href="os-page:${"c".repeat(25)}" data-os-link="checkout">Comprar</a></body></html>`;
  const base = {
    links: [{ key: "checkout", url: "https://pay.exemplo.com/a" }],
    pageHref: (id: string) => `/p/${id}`,
    runtimeTag: '<script src="/os-runtime.js" data-os-runtime></script>',
  };

  it("sem códigos continua igual ao de antes (compatível)", () => {
    const out = renderPageHtml(PAGE, base);
    expect(out).toBe(renderPageHtml(PAGE, { ...base, customCode: null }));
    expect(out).toContain('href="https://pay.exemplo.com/a"');
    expect(out).toMatch(/<script src="\/os-runtime.js" data-os-runtime><\/script><\/body>/);
  });

  it("head antes de </head>, início logo depois de <body>, fim antes do script do Offer Studio", () => {
    const out = renderPageHtml(PAGE, {
      ...base,
      customCode: {
        head: '<meta name="pixel" content="$&amp;$1">',
        bodyStart: "<noscript>gtm</noscript>",
        bodyEnd: "<script>window.fim = '$`';</script>",
      },
    });
    expect(out).toContain('<meta name="pixel" content="$&amp;$1">\n<style id="os-delay-style">');
    expect(out).toContain('<body class="x">\n<noscript>gtm</noscript>');
    const end = out.indexOf("<script>window.fim = '$`';</script>");
    const runtime = out.indexOf("data-os-runtime");
    expect(end).toBeGreaterThan(0);
    expect(runtime).toBeGreaterThan(end);
    expect(out.indexOf("os-delay-style")).toBeLessThan(out.indexOf("</head>"));
  });

  it("parsePageCode ignora formatos estranhos e chaves de outras fases", () => {
    expect(parsePageCode({ head: "<a>", pixels: [1], bodyEnd: 3 })).toEqual({
      head: "<a>",
      bodyStart: "",
      bodyEnd: "",
    });
    expect(parsePageCode(null)).toEqual({ head: "", bodyStart: "", bodyEnd: "" });
    expect(injectPageCode("<p>sem documento</p>", { head: "<meta x>", bodyEnd: "<i>fim</i>" })).toBe(
      "<meta x>\n<p>sem documento</p>\n<i>fim</i>",
    );
  });
});

// ─── Script das páginas ──────────────────────────────────────────────────────

describe("script das páginas (widgets + clones)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  it("é pequeno, único e idempotente", () => {
    const script = runtimeScript();
    // 40 KB até a roleta de desconto (roleta + prêmio na página de vendas: +~11,5 KB).
    expect(script.length).toBeLessThan(42 * 1024);
    expect(script).toContain("__osRuntime");
    expect(script).toContain("__osCloneCompat");
    const once = injectRuntime("<html><head></head><body></body></html>", "<script data-os-runtime></script>");
    expect(injectRuntime(once, "<script data-os-runtime></script>")).toBe(once);
  });

  it("widgets, compatibilidade de clones e códigos da página rodam juntos, sem erros", async () => {
    const extra =
      '<section id="faq"><button id="q1" data-bs-toggle="collapse" data-bs-target="#a1">Pergunta</button>' +
      '<div id="a1" class="collapse">Resposta</div></section>';
    const stored = templateHtml("vendas-longa", "Página de vendas").replace("</body>", `${extra}</body>`);
    const html = renderPageHtml(stored, {
      links: [{ key: "checkout", url: "https://pay.exemplo.com/abc" }],
      pageHref: (id) => `/p/${id}`,
      runtimeTag: `<script data-os-runtime>${runtimeScript()}</script>`,
      customCode: {
        head: "<script>window.__ordem = ['head'];</script>",
        bodyStart: "<script>window.__ordem.push('inicio');</script>",
        bodyEnd: "<script>window.__ordem.push('fim');</script>",
      },
    });

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.route("**/*", (route) =>
      route.request().url() === "http://site.test/"
        ? route.fulfill({ contentType: "text/html; charset=utf-8", body: html })
        : route.abort(),
    );
    try {
      await page.goto("http://site.test/");
      const read = () =>
        page.evaluate(() => ({
          countdown: document.querySelector('[data-os-widget="countdown"]')?.textContent?.replace(/\s+/g, " ") ?? "",
          ordem: (window as Window & { __ordem?: string[] }).__ordem ?? [],
          runtime: Boolean((window as Window & { __osRuntime?: boolean }).__osRuntime),
          compat: Boolean((window as Window & { __osCloneCompat?: boolean }).__osCloneCompat),
          checkout: [...document.querySelectorAll("a[data-os-link]")].map((a) => a.getAttribute("href")),
        }));
      const first = await read();
      await page.waitForTimeout(1300);
      const later = await read();
      expect(first.runtime).toBe(true);
      expect(first.compat).toBe(true);
      expect(first.ordem).toEqual(["head", "inicio", "fim"]);
      expect(later.countdown).not.toBe(first.countdown);

      // Compatibilidade de clones: FAQ do Bootstrap volta a abrir sem o script original.
      await page.click("#q1");
      expect(await page.evaluate(() => document.getElementById("a1")?.classList.contains("show"))).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

// ─── Vídeo ───────────────────────────────────────────────────────────────────

/** Início de um MP4 (caixa ftyp) + bytes quaisquer. */
function mp4Bytes(size = 4096, seed = 1) {
  const data = new Uint8Array(size);
  data.set([0, 0, 0, 0x20], 0);
  data.set(new TextEncoder().encode("ftypisom"), 4);
  for (let i = 12; i < size; i++) data[i] = (i * 31 + seed) % 251;
  return data;
}

function videoRequest(
  body: BodyInit | null,
  {
    offerId,
    name,
    host = HOST,
    headers = {},
  }: {
    offerId?: string;
    name?: string;
    host?: string;
    headers?: Record<string, string>;
  },
) {
  const query = offerId ? `?offerId=${encodeURIComponent(offerId)}` : "";
  return new Request(`http://${host}/api/assets/video${query}`, {
    method: "POST",
    headers: {
      host,
      "content-type": "video/mp4",
      ...(name ? { "x-file-name": encodeURIComponent(name) } : {}),
      ...headers,
    },
    body,
  });
}

describe("envio de vídeo (POST /api/assets/video)", () => {
  it("reconhece MP4 e WebM pelo conteúdo", () => {
    expect(sniffVideoFormat(mp4Bytes(64))).toBe("mp4");
    const webm = new Uint8Array(64);
    webm.set([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84]);
    webm.set(new TextEncoder().encode("webm"), 8);
    expect(sniffVideoFormat(webm)).toBe("webm");
    const mov = mp4Bytes(64);
    mov.set(new TextEncoder().encode("qt  "), 8);
    expect(sniffVideoFormat(mov)).toBe("mov");
    const heic = mp4Bytes(64);
    heic.set(new TextEncoder().encode("heic"), 8);
    expect(sniffVideoFormat(heic)).toBeNull();
    expect(sniffVideoFormat(new TextEncoder().encode("<html>"))).toBeNull();
  });

  it("guarda o MP4 como veio, na biblioteca da oferta, e responde o endereço", async () => {
    const offer = await createOffer({ name: "Oferta" });
    const data = mp4Bytes();
    const res = await uploadVideo(videoRequest(data, { offerId: offer.id, name: "minha vsl.mp4" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { type: string; src: string; name: string; bytes: number }[] };
    const sha = createHash("sha256").update(data).digest("hex");
    expect(body.data).toEqual([
      { type: "video", src: `/os-assets/${sha}.mp4`, name: "minha vsl.mp4", bytes: data.length },
    ]);
    const row = await prisma.asset.findFirstOrThrow({ where: { offerId: offer.id } });
    written.add(row.key);
    expect(row).toMatchObject({ kind: "VIDEO", mime: "video/mp4", bytes: data.length, originalName: "minha vsl.mp4" });
    expect(new Uint8Array(await getObject(row.key))).toEqual(data);

    // O mesmo arquivo de novo não duplica.
    const again = await uploadVideo(videoRequest(data, { offerId: offer.id, name: "de novo.mp4" }));
    expect(again.status).toBe(200);
    expect(await prisma.asset.count({ where: { offerId: offer.id } })).toBe(1);
  });

  it("recusa com mensagens em português: formato, tamanho, oferta, login", async () => {
    const offer = await createOffer({ name: "Oferta" });
    const mov = mp4Bytes(256);
    mov.set(new TextEncoder().encode("qt  "), 8);
    const movRes = await uploadVideo(videoRequest(mov, { offerId: offer.id, name: "clip.mov" }));
    expect(movRes.status).toBe(415);
    expect(((await movRes.json()) as { error: string }).error).toMatch(/QuickTime.*Converta para MP4/);

    const text = await uploadVideo(videoRequest("não é vídeo", { offerId: offer.id, name: "a.mp4" }));
    expect(text.status).toBe(415);
    expect(((await text.json()) as { error: string }).error).toBe(
      '"a.mp4" não é um vídeo aceito. Envie um arquivo MP4 ou WebM.',
    );

    const big = await uploadVideo(
      videoRequest(mp4Bytes(64), {
        offerId: offer.id,
        name: "grande.mp4",
        headers: { "content-length": String(300 * 1024 * 1024) },
      }),
    );
    expect(big.status).toBe(413);
    expect(((await big.json()) as { error: string }).error).toMatch(/no máximo 200 MB/);

    const empty = await uploadVideo(videoRequest(new Uint8Array(0), { offerId: offer.id, name: "vazio.mp4" }));
    expect(empty.status).toBe(400);

    const noOffer = await uploadVideo(videoRequest(mp4Bytes(64), { name: "a.mp4" }));
    expect(noOffer.status).toBe(400);
    const gone = await uploadVideo(videoRequest(mp4Bytes(64), { offerId: "naoexiste", name: "a.mp4" }));
    expect(gone.status).toBe(404);

    const wrongHost = await uploadVideo(videoRequest(mp4Bytes(64), { offerId: offer.id, host: "mal.example:3000" }));
    expect(wrongHost.status).toBe(403);
    getSession.mockResolvedValue(null);
    const noSession = await uploadVideo(videoRequest(mp4Bytes(64), { offerId: offer.id }));
    expect(noSession.status).toBe(401);
    expect(await prisma.asset.count()).toBe(0);
  });

  it("Range da prévia: intervalos válidos, fim aberto, sufixo e fora do arquivo", () => {
    expect(parseByteRange(undefined, 100)).toBeNull();
    expect(parseByteRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=100-", 100)).toBe("invalid");
    expect(parseByteRange("bytes=20-10", 100)).toBe("invalid");
    expect(parseByteRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseByteRange("items=0-1", 100)).toBeNull();
  });
});

describe("envio de vídeo no editor (video-upload.ts)", () => {
  it("confere formato e tamanho antes de enviar", async () => {
    const { checkVideoFile, CLIENT_VIDEO_MAX_BYTES } = await import("@/editor/grapes/video-upload");
    const { VIDEO_UPLOAD_LIMITS } = await import("@/server/services/video-assets");
    expect(CLIENT_VIDEO_MAX_BYTES).toBe(VIDEO_UPLOAD_LIMITS.maxFileBytes);
    expect(checkVideoFile({ name: "vsl.mp4", size: 10, type: "video/mp4" })).toBeNull();
    expect(checkVideoFile({ name: "vsl.webm", size: 10, type: "" })).toBeNull();
    expect(checkVideoFile({ name: "clip.mov", size: 10, type: "video/quicktime" })).toMatch(/QuickTime/);
    expect(checkVideoFile({ name: "foto.jpg", size: 10, type: "image/jpeg" })).toBe(
      '"foto.jpg" não é um vídeo aceito. Envie um arquivo MP4 ou WebM.',
    );
    expect(checkVideoFile({ name: "vazio.mp4", size: 0, type: "video/mp4" })).toBe('"vazio.mp4" está vazio.');
    expect(checkVideoFile({ name: "grande.mp4", size: CLIENT_VIDEO_MAX_BYTES + 1, type: "video/mp4" })).toMatch(
      /O limite é 200 MB/,
    );
  });

  it("envia o arquivo cru para a rota e devolve o endereço (ou a mensagem do servidor)", async () => {
    const { uploadVideo: send } = await import("@/editor/grapes/video-upload");
    const file = new File([mp4Bytes(64)], "minha vsl.mp4", { type: "video/mp4" });
    const calls: { url: string; init?: RequestInit }[] = [];
    const ok = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ data: [{ type: "video", src: "/os-assets/abc.mp4" }] });
    }) as typeof fetch;
    expect(await send("oferta 1", file, ok)).toBe("/os-assets/abc.mp4");
    expect(calls[0].url).toBe("/api/assets/video?offerId=oferta%201");
    expect(calls[0].init?.method).toBe("POST");
    expect((calls[0].init?.headers as Record<string, string>)["X-File-Name"]).toBe("minha%20vsl.mp4");
    expect(calls[0].init?.body).toBe(file);

    const refused = (async () => Response.json({ error: "Mensagem do servidor." }, { status: 415 })) as typeof fetch;
    await expect(send("o", file, refused)).rejects.toThrow("Mensagem do servidor.");
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(send("o", file, offline)).rejects.toThrow("Não foi possível falar com o Offer Studio");
  });
});

describe("bindUrlToLink segue a mesma regra de destino do script e do localizar", () => {
  it('<a href="#"> com data-os-href liga pelo data-os-href; href real tem prioridade', async () => {
    const { bindUrlToLink } = await import("@/lib/offer-links");
    const html =
      '<a id="a" href="#" data-os-href="https://pay.exemplo.com/1">A</a>' +
      '<a id="b" href="javascript:void(0)" data-os-href="https://pay.exemplo.com/1">B</a>' +
      '<a id="c" href="https://outro.com/" data-os-href="https://pay.exemplo.com/1">C</a>' +
      '<div id="d" data-os-href="https://pay.exemplo.com/1">D</div>' +
      '<form id="e" action="https://pay.exemplo.com/1"></form>';
    const out = bindUrlToLink(html, "https://pay.exemplo.com/1", "checkout");
    expect(out.count).toBe(4);
    for (const id of ["a", "b", "d", "e"])
      expect(out.html).toMatch(new RegExp(`id="${id}"[^>]*data-os-link="checkout"`));
    expect(out.html).not.toMatch(/id="c"[^>]*data-os-link/);
  });
});
