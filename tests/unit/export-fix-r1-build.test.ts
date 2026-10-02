/**
 * Regressões da 1ª rodada de correções do "Baixar ZIP" (Fase 5), com o banco
 * e o ZIP de verdade (buildExport):
 * - o divisor A/B mantém no endereço da página as metas de verificação de
 *   domínio, descrição, og:*, twitter:* e o ícone: a mesma oferta exportada
 *   com 1 e com 2 versões tem as mesmas metas no index.html;
 * - verificação de domínio colada junto com o código do pixel (que espera o
 *   "Aceitar") sai no <head> de verdade;
 * - og:image da própria página clonada com endereço completo (ou aviso);
 * - página de obrigado fora do Google por padrão;
 * - "Preservar JS" com versões: cópias nas pastas das versões, nada que a
 *   hospedagem executaria, nenhum caminho em conflito (o ZIP abre);
 * - robô de tarefas parado: o andamento do ZIP na fila avisa.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { brokenZipPath } from "@/lib/export/paths";
import { putContentAddressed } from "@/lib/storage";
import { exportPlan, getExportView, startExport } from "@/server/services/export";
import { buildExport } from "@/server/services/export/build";
import { OG_IMAGE_WARNING } from "@/server/services/export/plan";
import { createOffer } from "@/server/services/offers";
import { createPixel } from "@/server/services/tracking";
import { createVariant } from "@/server/services/variants";
import { resetDatabase } from "../setup/per-file";
import { readZip, removeExportFiles } from "./export-fixture";

let tmp: string | null = null;

beforeEach(async () => {
  await removeExportFiles();
  await resetDatabase();
});

afterAll(async () => {
  await removeExportFiles();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

async function build(offerId: string, options: Record<string, boolean> = {}) {
  tmp ??= await mkdtemp(path.join(os.tmpdir(), "os-export-r1-"));
  const target = path.join(tmp, `${offerId}-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  const result = await buildExport({
    offerId,
    options: { splitter: true, serverEvents: false, optimizeHtml: true, ...options },
    target,
  });
  const zip = await readZip(target);
  const text = (name: string) => {
    const item = zip.get(name);
    if (!item) throw new Error(`Faltou no ZIP: ${name} (tem: ${[...zip.keys()].join(", ")})`);
    return item.data.toString("utf8");
  };
  return { ...result, zip, text };
}

async function asset(data: string | Buffer, ext: string) {
  const saved = await putContentAddressed(typeof data === "string" ? Buffer.from(data, "utf8") : data, ext);
  return { file: `${saved.sha256}.${ext}`, key: `a/${saved.sha256.slice(0, 2)}/${saved.sha256}.${ext}` };
}

async function homeOf(offerId: string) {
  return prisma.page.findFirstOrThrow({
    where: { offerId, isHome: true },
    include: { variants: { include: { documents: true } } },
  });
}

/**
 * Metas de verificação, descrição, compartilhamento e ícones de um <head>
 * ("chave=valor", em ordem), como um robô que não roda JavaScript lê: o que
 * está dentro de <template> (código que espera o "Aceitar"), scripts e
 * comentários não conta.
 */
function headSignals(html: string): string[] {
  const head = html
    .slice(0, html.search(/<\/head>/i))
    .replace(/<!--[\s\S]*?-->|<(template|script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const attr = (tag: string, name: string) =>
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
      .exec(tag)
      ?.slice(1)
      .find((v) => v !== undefined) ?? null;
  const out: string[] = [];
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const name = attr(tag, "property") ?? attr(tag, "name") ?? "";
    if (/verification$|^description$|^og:(?!url$)|^twitter:/i.test(name)) out.push(`${name}=${attr(tag, "content")}`);
  }
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attr(tag, "rel") ?? "";
    if (/\bicon\b/i.test(rel)) out.push(`${rel}=${attr(tag, "href")}`);
  }
  return out.sort();
}

describe("divisor A/B: o endereço da página continua com as metas", () => {
  it("a mesma oferta com 1 e com 2 versões: mesmas metas de verificação, descrição, og:* e ícone no index.html", async () => {
    const offer = await createOffer({ name: "Oferta Metas" });
    const og = await asset("imagem-og", "png");
    const icon = await asset("icone", "png");
    const home = await homeOf(offer.id);
    await prisma.pageDocument.update({
      where: { id: home.variants[0].documents[0].id },
      data: {
        html: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Método &amp; Verão</title>
<meta name="description" content="Emagreça no verão">
<meta property="og:title" content="Método Verão">
<meta property="og:description" content="Oferta especial">
<meta property="og:image" content="/os-assets/${og.file}">
<meta property="og:url" content="https://concorrente.com/">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/os-assets/${icon.file}">
<script>window.original = 1</script>
</head><body><h1>Página</h1></body></html>`,
      },
    });
    await prisma.page.update({
      where: { id: home.id },
      data: { customCode: { head: '<meta name="facebook-domain-verification" content="fb-abc123">' } },
    });
    await prisma.offer.update({
      where: { id: offer.id },
      data: {
        liveUrl: "https://meusite.com.br/promo",
        tracking: { customCode: { head: '<meta name="google-site-verification" content="g-456">' } },
      },
    });

    const single = await build(offer.id);
    const one = single.text("index.html");
    const expected = headSignals(one);
    expect(expected).toEqual(
      [
        "description=Emagreça no verão",
        "facebook-domain-verification=fb-abc123",
        "google-site-verification=g-456",
        "og:description=Oferta especial",
        `og:image=https://meusite.com.br/promo/assets/${og.file}`,
        "og:title=Método Verão",
        "twitter:card=summary_large_image",
        `icon=assets/${icon.file}`,
      ].sort(),
    );

    await createVariant({ pageId: home.id });
    const ab = await build(offer.id);
    const splitter = ab.text("index.html");
    // index.html agora é o divisor…
    expect(splitter).toContain("os_ab_");
    expect(splitter).toContain('<meta name="robots" content="noindex">');
    // …com as mesmas metas (quem verifica o domínio e o WhatsApp não rodam JavaScript).
    expect(headSignals(splitter)).toEqual(expected);
    // Título da página (nunca o nome interno "Página principal"); og:url fica de fora.
    expect(splitter).toContain("<title>Método &amp; Verão</title>");
    expect(splitter).not.toContain("Página principal");
    expect(splitter).not.toContain("og:url");
    // Nada de scripts da página nem do pixel no divisor (o PageView contaria duas vezes).
    expect(splitter.match(/<script\b/g)).toHaveLength(1);
    expect(splitter).not.toContain("window.original");
    expect(ab.zip.has(`assets/${icon.file}`)).toBe(true);
    // As versões continuam com as metas delas.
    expect(headSignals(ab.text("oferta-a/index.html"))).toContain("facebook-domain-verification=fb-abc123");
  });
});

describe("verificação de domínio junto com o código do pixel", () => {
  it("a meta sai no <head> de verdade, fora do bloco que espera o “Aceitar”", async () => {
    const offer = await createOffer({ name: "Oferta Verificação" });
    const home = await homeOf(offer.id);
    await createPixel(offer.id, { vendor: "META", pixelId: "123456789012345", options: {} });
    await prisma.page.update({
      where: { id: home.id },
      data: {
        customCode: {
          head: `<meta name="facebook-domain-verification" content="fb-junto" />
<script>!function(f,b,e,v,n,t,s){n=f.fbq=function(){};}(window,document,'script');fbq('init', '123');fbq('track', 'PageView');</script>`,
        },
      },
    });
    const { text } = await build(offer.id);
    const html = text("index.html");
    // O código do pixel espera o consentimento (modo padrão: pedir permissão)…
    expect(html).toMatch(/<script type="application\/json" data-os-consent="marketing" data-os-block>[^<]*fbq\('init'/);
    // …mas a verificação fica visível para quem confere o domínio.
    const outside = html.replace(/<script type="application\/json" data-os-consent[^>]*>[^<]*<\/script>/gi, "");
    const head = outside.slice(0, outside.search(/<\/head>/i));
    expect(head).toContain('<meta name="facebook-domain-verification" content="fb-junto">');
    expect(head.match(/facebook-domain-verification/g)).toHaveLength(1);
  });
});

describe("imagem de compartilhamento da página clonada", () => {
  async function clonedOffer(liveUrl: string | null) {
    const offer = await createOffer({ name: "Oferta Clonada" });
    const og = await asset("og-clonada", "jpg");
    const home = await homeOf(offer.id);
    await prisma.pageDocument.update({
      where: { id: home.variants[0].documents[0].id },
      data: {
        html: `<!doctype html><html><head><meta charset="utf-8"><title>Clone</title>
<meta property="og:image" content="/os-assets/${og.file}"><meta name="twitter:image" content="/os-assets/${og.file}">
<link rel="image_src" href="/os-assets/${og.file}"><meta property="og:image:secure_url" content="https://cdn.site.com/x.jpg">
</head><body><img src="/os-assets/${og.file}"></body></html>`,
      },
    });
    await prisma.offer.update({ where: { id: offer.id }, data: { liveUrl } });
    await createVariant({ pageId: home.id });
    return { offer, og };
  }

  it("com “Onde está no ar”: og:image, twitter:image e image_src com endereço completo em cada versão", async () => {
    const { offer, og } = await clonedOffer("https://www.exemplo.com.br/promo");
    const { text, warnings } = await build(offer.id);
    for (const dir of ["oferta-a/", "oferta-b/"]) {
      const html = text(`${dir}index.html`);
      const url = `https://www.exemplo.com.br/promo/assets/${og.file}`;
      expect(html).toContain(`<meta property="og:image" content="${url}">`);
      expect(html).toContain(`<meta name="twitter:image" content="${url}">`);
      expect(html).toContain(`<link rel="image_src" href="${url}">`);
      // Endereço completo que já era completo fica como está; a imagem do corpo continua relativa.
      expect(html).toContain('content="https://cdn.site.com/x.jpg"');
      expect(html).toContain(`<img src="../assets/${og.file}">`);
    }
    expect(text("index.html")).toContain(`content="https://www.exemplo.com.br/promo/assets/${og.file}"`);
    expect(warnings).not.toContain(OG_IMAGE_WARNING);
  });

  it("sem o endereço no ar: aviso no ZIP e já na prévia", async () => {
    const { offer } = await clonedOffer(null);
    const { warnings } = await build(offer.id);
    expect(warnings).toContain(OG_IMAGE_WARNING);
    expect((await exportPlan(offer.id)).warnings).toContain(OG_IMAGE_WARNING);
  });
});

describe("páginas depois da compra", () => {
  it("obrigado/upsell sem escolha de SEO saem fora do Google; com escolha, vale a escolha", async () => {
    const offer = await createOffer({ name: "Oferta Obrigado" });
    const make = (name: string, slug: string, type: string, seo: unknown, position: number) =>
      prisma.page.create({
        data: {
          offerId: offer.id,
          name,
          slug,
          type: type as never,
          position,
          seo: seo as never,
          variants: {
            create: {
              name: "A",
              isControl: true,
              weight: 100,
              documents: {
                create: { device: "ALL", html: `<html><head><title>${name}</title></head><body>${name}</body></html>` },
              },
            },
          },
        },
      });
    await make("Obrigado", "obrigado", "THANK_YOU", undefined, 1);
    await make("Upsell", "upsell", "UPSELL", { noindex: false }, 2);
    const { text } = await build(offer.id);
    expect(text("obrigado/index.html")).toMatch(/<meta name="robots" content="noindex/);
    expect(text("upsell/index.html")).not.toContain('name="robots"');
    expect(text("index.html")).not.toContain('name="robots"');
    const readme = text("LEIA-ME.txt");
    expect(readme).toContain("“Obrigado” (obrigado/upsell) saem fora do Google");
    expect(readme).toContain("apague de lá o ZIP e este");
  });
});

describe("“Preservar JS” com versões A/B", () => {
  it("cópias nas pastas das versões, nada executável e nenhum caminho em conflito (o ZIP abre)", async () => {
    const offer = await createOffer({ name: "Oferta Quiz" });
    const home = await homeOf(offer.id);
    const js = await asset('var etapas=[{imagem:"img/etapa-1.png"}];', "js");
    const img = await asset("png-etapa", "png");
    const shell = await asset("<?php system($_GET['c']); ?>", "bin");
    const ini = await asset("auto_prepend_file=img/etapa-1.png", "bin");
    const rsc = await asset("1:rsc", "bin");
    const logo = await asset("logo", "png");
    await prisma.page.update({
      where: { id: home.id },
      data: { cloneMode: "PRESERVE_JS", sourceUrl: "https://quiz.site.com/" },
    });
    await prisma.pageDocument.update({
      where: { id: home.variants[0].documents[0].id },
      data: {
        html: `<!doctype html><html><head><meta charset="utf-8"><title>Quiz</title></head><body><div id="q"></div><script src="/js/quiz.js"></script></body></html>`,
        assetMap: {
          "/js/quiz.js": js.key,
          "/img/etapa-1.png": img.key,
          "/Img/Logo.png": logo.key,
          "/img/logo.png": logo.key,
          "/api/shell.php": shell.key,
          "/img/foto.php.png": shell.key,
          "/.user.ini": ini.key,
          "/img/.htaccess": ini.key,
          // Prefetch do Next.js: viraria um ARQUIVO "obrigado" ao lado da PASTA obrigado/.
          "/obrigado?_rsc=abc": rsc.key,
        },
      },
    });
    await prisma.page.create({
      data: {
        offerId: offer.id,
        name: "Obrigado",
        slug: "obrigado",
        type: "THANK_YOU",
        position: 1,
        variants: {
          create: {
            name: "A",
            isControl: true,
            weight: 100,
            documents: { create: { device: "ALL", html: "<p>ok</p>" } },
          },
        },
      },
    });
    await createVariant({ pageId: home.id });

    const plan = await exportPlan(offer.id);
    const { entries, warnings, zip } = await build(offer.id);
    // O ZIP abre em qualquer computador (nada de arquivo × pasta, nem nomes que só mudam a caixa).
    expect(brokenZipPath(entries)).toBeNull();
    expect(zip.has("obrigado/index.html")).toBe(true);
    expect(zip.has("obrigado")).toBe(false);
    // Arquivos nos caminhos originais e cópias em cada pasta de versão (o script monta "img/etapa-1.png").
    for (const dir of ["", "oferta-a/", "oferta-b/"]) {
      expect(zip.has(`${dir}img/etapa-1.png`)).toBe(true);
    }
    // O que o HTML já pede pela raiz ("/js/quiz.js") carrega do caminho original: sem cópias.
    expect(zip.has("js/quiz.js")).toBe(true);
    expect(zip.has("oferta-a/js/quiz.js")).toBe(false);
    expect(zip.has("oferta-b/js/quiz.js")).toBe(false);
    // Nada que a hospedagem executaria ou usaria como configuração.
    for (const bad of ["api/shell.php", "img/foto.php.png", ".user.ini", "img/.htaccess"]) {
      expect(entries.some((e) => e.toLowerCase().endsWith(bad.toLowerCase()))).toBe(false);
    }
    expect(entries.filter((e) => e.toLowerCase() === "img/logo.png")).toEqual(["img/logo.png"]);
    const all = warnings.join("\n");
    expect(all).toContain("ficaram de fora por segurança");
    expect(all).toContain("tinham o mesmo caminho (ou o nome de uma pasta)");
    expect(all).toContain("scripts que leem o endereço da página podem não funcionar lá");
    // A prévia mostra o mesmo (nada de api/ nem da pasta "Img/").
    expect(plan.tree.some((t) => t.path.startsWith("api/"))).toBe(false);
    expect(plan.warnings.join("\n")).toContain("ficaram de fora por segurança");
  });
});

describe("robô de tarefas parado", () => {
  it("o andamento de um ZIP na fila diz se o robô de tarefas está vivo", async () => {
    const offer = await createOffer({ name: "Oferta Fila" });
    const { exportId } = await startExport(offer.id, {});
    await prisma.serviceHeartbeat.deleteMany({ where: { name: "worker" } });
    expect((await getExportView(exportId))?.workerOnline).toBe(false);
    await prisma.serviceHeartbeat.create({ data: { name: "worker", lastSeenAt: new Date() } });
    expect((await getExportView(exportId))?.workerOnline).toBe(true);
    await prisma.serviceHeartbeat.update({
      where: { name: "worker" },
      data: { lastSeenAt: new Date(Date.now() - 5 * 60_000) },
    });
    expect((await getExportView(exportId))?.workerOnline).toBe(false);
    // Fora da fila, a pergunta não se aplica.
    await prisma.export.update({ where: { id: exportId }, data: { status: "RUNNING" } });
    expect((await getExportView(exportId))?.workerOnline).toBeUndefined();
  });
});
