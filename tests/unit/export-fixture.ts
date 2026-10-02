/**
 * Oferta de teste do "Baixar ZIP" (Fase 5), montada direto no banco e no
 * storage de teste:
 *
 * - "Página principal" (inicial) com as versões A (50%) e B (50%): CSS em
 *   cadeia (folha base → @import → @font-face), fundo em <style> e em style="",
 *   srcset, JSON escapado em data-settings, links do funil (os-page:), botão de
 *   checkout (link da oferta), marcadores da empresa, comentários e <pre>;
 * - "Upsell" com versões separadas computador/celular;
 * - "Política de privacidade" (LEGAL);
 * - "Quiz" no modo "Preservar JS": scripts e arquivos nos caminhos originais
 *   (/js/quiz.js?v=2, /img/etapa-2.png, /dados/config.json, /css/orig.css);
 * - pixels da Meta (API de Conversões + token + código de teste) e do TikTok
 *   (Events API + token), regra "InitiateCheckout ao clicar no checkout",
 *   SEO com favicon e imagem de compartilhamento.
 */
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { putContentAddressed } from "@/lib/storage";
import { createEventRule, createPixel } from "@/server/services/tracking";

export const META_PIXEL = "123456789012345";
export const TIKTOK_PIXEL = "C1ABCDEFGHIJ2KLMNOPQ";
/** Token com aspas e barra invertida (o eventos-config.php precisa escapar). */
export const META_TOKEN = "EAAGm0PX4ZCpsBA'KZ\\Zy1234567890abcdefghijklmnop";
export const TIKTOK_TOKEN = "0123456789abcdef0123456789abcdef01234567";
export const CHECKOUT_URL = "https://pay.hotmart.com/X123456?off=abc";

export interface ExportFixture {
  offerId: string;
  homeId: string;
  upsellId: string;
  legalId: string;
  quizId: string;
  /** Arquivos por hash ("<sha>.<ext>") usados nas páginas. */
  files: Record<string, string>;
}

let seed = 0;
async function png(color: [number, number, number], size = 8): Promise<Buffer> {
  seed++;
  return sharp({
    create: {
      width: size + (seed % 3),
      height: size,
      channels: 3,
      background: { r: color[0], g: color[1], b: color[2] },
    },
  })
    .png()
    .toBuffer();
}

/** Grava no storage e devolve o nome do arquivo ("<sha>.<ext>"). */
async function store(data: Buffer | string, ext: string): Promise<string> {
  const saved = await putContentAddressed(typeof data === "string" ? Buffer.from(data, "utf8") : data, ext);
  return `${saved.sha256}.${ext}`;
}

export async function createExportFixture(opts: { liveUrl?: string | null } = {}): Promise<ExportFixture> {
  const files: Record<string, string> = {};
  files.font = await store(Buffer.from("wOF2-fonte-de-teste"), "woff2");
  files.bg = await store(await png([200, 40, 40]), "png");
  files.bg2 = await store(await png([40, 200, 40]), "png");
  files.bg3 = await store(await png([40, 40, 200]), "png");
  files.img1 = await store(await png([10, 10, 10]), "png");
  files.img2 = await store(await png([20, 20, 20], 16), "png");
  files.img3 = await store(await png([30, 30, 30]), "png");
  files.favicon = await store(await png([250, 200, 0]), "png");
  files.og = await store(await png([0, 120, 250], 32), "png");
  files.fonts = await store(
    `@font-face{font-family:"Teste";src:url("/os-assets/${files.font}") format("woff2");font-display:swap}`,
    "css",
  );
  files.main = await store(
    `@import "/os-assets/${files.fonts}";\nbody{font-family:"Teste",sans-serif;margin:0}\n.fundo{background:url(/os-assets/${files.bg3}) no-repeat}\n`,
    "css",
  );
  files.base = await store(
    `@layer os-fix, os-original;\n@import url("/os-assets/${files.main}") layer(os-original);\n`,
    "css",
  );

  // Preservar JS
  files.quizCss = await store(`.quiz{color:#123}\n.fundo-quiz{background:url(/os-assets/${files.bg})}\n`, "css");
  files.quizJs = await store(
    `(function(){var img=document.createElement("img");img.id="etapa";img.src="/img/etapa-2.png";document.body.appendChild(img);
fetch("/dados/config.json").then(function(r){return r.json()}).then(function(c){window.__quizOk=c.ok===true;document.getElementById("status").textContent=c.ok?"quiz pronto":"erro"});})();`,
    "js",
  );
  files.quizImg = await store(await png([90, 0, 90]), "png");
  files.quizJson = await store(JSON.stringify({ ok: true }), "json");
  files.origCss = await store(`.orig{background:url("/os-assets/${files.bg2}")}\n`, "css");

  const offer = await prisma.offer.create({
    data: {
      name: "Oferta Teste Exportação",
      liveUrl: opts.liveUrl ?? null,
      settings: {
        company: { name: "Empresa Teste LTDA", document: "12.345.678/0001-90", email: "contato@teste.com.br" },
        seo: {
          title: "Oferta Teste",
          description: "Descrição da oferta de teste",
          faviconKey: `a/${files.favicon.slice(0, 2)}/${files.favicon}`,
          ogImageKey: `a/${files.og.slice(0, 2)}/${files.og}`,
        },
        language: "pt-BR",
      },
      links: {
        create: [{ key: "checkout", label: "Checkout principal", url: CHECKOUT_URL, kind: "CHECKOUT", position: 0 }],
      },
    },
    select: { id: true },
  });
  const offerId = offer.id;

  const mkPage = (data: {
    name: string;
    slug: string;
    type?: "SALES" | "UPSELL" | "LEGAL" | "QUIZ";
    isHome?: boolean;
    position: number;
    cloneMode?: "EDITABLE" | "PRESERVE_JS";
  }) =>
    prisma.page.create({
      data: {
        offerId,
        name: data.name,
        slug: data.slug,
        type: data.type ?? "SALES",
        isHome: data.isHome ?? false,
        position: data.position,
        cloneMode: data.cloneMode ?? "EDITABLE",
      },
      select: { id: true },
    });

  const home = await mkPage({ name: "Página principal", slug: "principal", isHome: true, position: 0 });
  const upsell = await mkPage({ name: "Upsell", slug: "upsell", type: "UPSELL", position: 1 });
  const legal = await mkPage({ name: "Política de privacidade", slug: "privacidade", type: "LEGAL", position: 2 });
  const quiz = await mkPage({ name: "Quiz", slug: "quiz", type: "QUIZ", position: 3, cloneMode: "PRESERVE_JS" });

  const homeHtml = (letter: string) => `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Versão ${letter}</title>
  <link rel="stylesheet" href="/os-assets/${files.base}" data-os-base>
  <style>.hero{background-image:url("/os-assets/${files.bg}");height:20px}</style>
  <!-- comentário que some no HTML otimizado -->
  <!--[if IE]><p>navegador antigo</p><![endif]-->
</head>
<body>
  <h1 id="titulo">Versão ${letter}</h1>
  <img id="foto" src="/os-assets/${files.img1}" srcset="/os-assets/${files.img1} 1x, /os-assets/${files.img2} 2x" alt="">
  <div class="hero" style="background-image:url('/os-assets/${files.bg2}')"></div>
  <div class="fundo" style="height:10px"></div>
  <div id="dados" data-settings='{"image":{"url":"\\/os-assets\\/${files.img3}"}}'></div>
  <p><a id="ir-upsell" href="os-page:${upsell.id}">Quero o upsell</a></p>
  <p><a id="politica" href="os-page:${legal.id}">Política de privacidade</a></p>
  <p><a id="quiz" href="os-page:${quiz.id}">Fazer o quiz</a></p>
  <p><a id="comprar" data-os-link="checkout" href="#">Comprar agora</a></p>
  <p id="empresa">{{EMPRESA}} — CNPJ {{CNPJ}}</p>
  <pre id="pre">  espaços    preservados  </pre>
</body>
</html>`;

  await prisma.pageVariant.create({
    data: {
      pageId: home.id,
      name: "A",
      isControl: true,
      weight: 50,
      position: 0,
      documents: { create: { device: "ALL", html: homeHtml("A") } },
    },
  });
  await prisma.pageVariant.create({
    data: {
      pageId: home.id,
      name: "B",
      label: "Headline nova",
      weight: 50,
      position: 1,
      documents: { create: { device: "ALL", html: homeHtml("B") } },
    },
  });

  const upsellHtml = (device: string) => `<!doctype html><html><head><meta charset="utf-8"><title>Upsell</title>
<link rel="stylesheet" href="/os-assets/${files.main}"></head>
<body><h1 id="titulo">Upsell ${device}</h1><a id="voltar" href="os-page:${home.id}">Voltar ao início</a>
<a id="comprar" data-os-link="checkout" href="#">Comprar upsell</a></body></html>`;
  await prisma.pageVariant.create({
    data: {
      pageId: upsell.id,
      name: "A",
      isControl: true,
      weight: 100,
      documents: {
        create: [
          { device: "DESKTOP", html: upsellHtml("computador") },
          { device: "MOBILE", html: upsellHtml("celular") },
        ],
      },
    },
  });

  await prisma.pageVariant.create({
    data: {
      pageId: legal.id,
      name: "A",
      isControl: true,
      documents: {
        create: {
          device: "ALL",
          html: `<!doctype html><html><head><meta charset="utf-8"><title>Política</title></head><body><h1 id="titulo">Política de privacidade</h1><p id="empresa">A {{EMPRESA}} protege seus dados.</p><a id="inicio" href="os-page:${home.id}">Início</a></body></html>`,
        },
      },
    },
  });

  const quizKey = (file: string) => `a/${file.slice(0, 2)}/${file}`;
  await prisma.pageVariant.create({
    data: {
      pageId: quiz.id,
      name: "A",
      isControl: true,
      documents: {
        create: {
          device: "ALL",
          html: `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="os-preserve-js" content="1"><title>Quiz</title>
<link rel="stylesheet" href="/os-assets/${files.quizCss}"><link rel="stylesheet" href="/css/orig.css">
<!-- comentário do framework: fica -->
</head><body><main class="quiz"><h1 id="titulo">Quiz</h1><p id="status">carregando</p></main>
<script src="/js/quiz.js?v=2"></script></body></html>`,
          assetMap: {
            "/js/quiz.js?v=2": quizKey(files.quizJs),
            "/img/etapa-2.png": quizKey(files.quizImg),
            "/dados/config.json": quizKey(files.quizJson),
            "/css/orig.css": quizKey(files.origCss),
            // Pasta assets/ de sites feitos com Vite: convive com a nossa.
            "/assets/index-vite123.js": quizKey(files.quizJs),
            // Colide com o arquivo gerado da página inicial: fica de fora (com aviso).
            "/index.html": quizKey(files.quizJson),
            // Caminho que não vira arquivo (pasta).
            "/pasta/": quizKey(files.quizJson),
          },
        },
      },
    },
  });

  await createPixel(offerId, {
    vendor: "META",
    pixelId: META_PIXEL,
    options: { capi: true },
    accessToken: META_TOKEN,
    testEventCode: "TEST123",
  });
  await createPixel(offerId, {
    vendor: "TIKTOK",
    pixelId: TIKTOK_PIXEL,
    options: { eventsApi: true },
    accessToken: TIKTOK_TOKEN,
  });
  await createEventRule(offerId, { event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK", pageId: null });

  return { offerId, homeId: home.id, upsellId: upsell.id, legalId: legal.id, quizId: quiz.id, files };
}

// ─── Leitura do ZIP ──────────────────────────────────────────────────────────

export interface ZipItem {
  data: Buffer;
  /** Compactado (deflate) ou guardado como está. */
  compressed: boolean;
  mtime: Date;
  mode: number;
}

/** Todas as entradas do ZIP, na ordem do arquivo. */
export async function readZip(file: string): Promise<Map<string, ZipItem>> {
  const yauzl = await import("yauzl");
  const zip = await new Promise<import("yauzl").ZipFile>((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, decodeStrings: true }, (err, z) => (err ? reject(err) : resolve(z))),
  );
  const out = new Map<string, ZipItem>();
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", () => resolve());
    zip.on("entry", (entry: import("yauzl").Entry) => {
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          reject(err);
          return;
        }
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("error", reject);
        stream.on("end", () => {
          out.set(entry.fileName, {
            data: Buffer.concat(chunks),
            compressed: entry.compressionMethod === 8,
            mtime: entry.getLastModDate(),
            mode: (entry.externalFileAttributes >>> 16) & 0o7777,
          });
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
  zip.close();
  return out;
}

/** Descompacta numa pasta (para servir com um servidor HTTP de teste). */
export async function unzipTo(file: string, dir: string): Promise<string[]> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const entries = await readZip(file);
  for (const [name, item] of entries) {
    const target = path.join(dir, name);
    if (!target.startsWith(dir)) throw new Error(`Caminho fora da pasta: ${name}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, item.data);
  }
  return [...entries.keys()];
}

/** Apaga os ZIPs das ofertas deste banco de teste (sem mexer nos de outras execuções). */
export async function removeExportFiles(): Promise<void> {
  const { rm } = await import("node:fs/promises");
  const { storagePath } = await import("@/lib/storage");
  const offers = await prisma.offer.findMany({ select: { id: true } });
  for (const { id } of offers) await rm(storagePath(`exports/${id}`), { recursive: true, force: true });
}
