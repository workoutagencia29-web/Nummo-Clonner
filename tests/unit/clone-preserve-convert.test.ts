/**
 * Cópia editável fiel e "Converter para editável" (site de teste offline
 * `presto`, Chromium de verdade):
 *
 * - Players montados por script (Presto Player do WordPress, web component com
 *   o CSS em adoptedStyleSheets) viravam ícones SVG gigantes no modo Editável e
 *   sumiam no editor: agora viram o vídeo comum do editor (iframe/<video>).
 * - CSS de web components em adoptedStyleSheets entra no shadow DOM salvo.
 * - Página salva em "Preservar JS" guarda a cópia editável da clonagem;
 *   "Converter para editável" troca a página por ela (o HTML original sem os
 *   scripts aparecia em branco no editor) e o Histórico volta o modo.
 */
import * as cheerio from "cheerio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getObject } from "@/lib/storage";
import { bulkReplace } from "@/server/services/bulk-replace";
import { saveClone } from "@/server/services/clone";
import {
  CONVERT_NOT_AVAILABLE,
  convertToEditable,
  getEditorPayload,
  listVersions,
  restoreVersion,
} from "@/server/services/documents";
import { duplicatePage } from "@/server/services/pages";
import { createVariant } from "@/server/services/variants";
import { convertScriptPlayers } from "@/worker/clone/editable-compat";
import { runCloneJob } from "@/worker/clone/job";
import type { CloneResult } from "@/worker/clone/types";
import { type FixtureServer, startFixtureServer } from "../fixtures/server";

let srv: FixtureServer;

beforeAll(async () => {
  srv = await startFixtureServer();
  process.env.OS_CLONE_HOST_MAP = "*.fixture.test=127.0.0.1";
}, 60_000);

afterAll(async () => {
  await srv?.close();
});

async function clonePresto() {
  const job = await prisma.cloneJob.create({
    data: { source: "URL", sourceUrl: srv.url("presto"), options: { devices: ["desktop"], maxVideoMb: 5 } },
  });
  await runCloneJob(job.id);
  const done = await prisma.cloneJob.findUniqueOrThrow({ where: { id: job.id } });
  expect(done.status, done.errorMessage ?? "").toBe("REVIEW");
  return done;
}

async function outputHtml(result: CloneResult, mode: "EDITABLE" | "PRESERVE_JS") {
  const out = result.devices.desktop?.outputs[mode];
  if (!out) throw new Error("sem saída");
  return (await getObject(out.htmlKey)).toString("utf8");
}

async function documentOf(offerId: string) {
  return prisma.pageDocument.findFirstOrThrow({
    where: { variant: { page: { offerId, isHome: true }, isControl: true } },
    include: { variant: { include: { page: true } } },
  });
}

describe("convertScriptPlayers (Presto Player)", () => {
  const base = "https://site.com.br/vsl/";

  it("YouTube vira o vídeo do editor, com o canto arredondado do player", () => {
    const $ = cheerio.load(
      `<figure style="--plyr-color-main: #00b3ff; --presto-player-border-radius: 18px; "><presto-player src="//www.youtube.com/embed/1cNGAYxDXUg?iv_load_policy=3&amp;rel=0&amp;enablejsapi=1" media-title="Aula 1"><template shadowrootmode="open"><svg></svg></template></presto-player></figure>`,
    );
    expect(convertScriptPlayers($, base)).toBe(1);
    expect($("presto-player")).toHaveLength(0);
    const frame = $("figure > iframe");
    expect(frame.attr("data-os-video")).toBe("youtube");
    expect(frame.attr("src")).toBe("https://www.youtube.com/embed/1cNGAYxDXUg?rel=0");
    expect(frame.attr("title")).toBe("Aula 1");
    expect(frame.attr("style")).toContain("aspect-ratio:16 / 9");
    expect(frame.attr("style")).toContain("border-radius:18px");
    expect(frame.attr("allowfullscreen")).toBe("");
  });

  it("Vimeo também; arquivo de vídeo relativo vira <video> com a capa", () => {
    const $ = cheerio.load(
      `<presto-player src="https://vimeo.com/76979871"></presto-player><presto-player src="midia/aula.mp4?v=2" poster="img/capa.jpg" media-title="Depoimento"></presto-player>`,
    );
    expect(convertScriptPlayers($, base)).toBe(2);
    expect($("iframe").attr("data-os-video")).toBe("vimeo");
    expect($("iframe").attr("src")).toBe("https://player.vimeo.com/video/76979871");
    const video = $("video");
    expect(video.attr("data-os-file")).toBe("");
    expect(video.attr("src")).toBe("https://site.com.br/vsl/midia/aula.mp4?v=2");
    expect(video.attr("poster")).toBe("https://site.com.br/vsl/img/capa.jpg");
    expect(video.is("[controls]")).toBe(true);
    expect(video.attr("style")).not.toContain("border-radius");
  });

  it("endereço que não dá para tocar sem o script (HLS, vazio, javascript:) fica como está", () => {
    const $ = cheerio.load(
      `<presto-player src="https://cdn.site.com/aula/playlist.m3u8"></presto-player><presto-player></presto-player><presto-player src="javascript:alert(1)"></presto-player>`,
    );
    expect(convertScriptPlayers($, base)).toBe(0);
    expect($("presto-player")).toHaveLength(3);
  });
});

describe("site com Presto Player e Elementor (Chromium)", () => {
  it("modo Editável: vídeos no player do editor, títulos visíveis e CSS dos web components no shadow DOM", async () => {
    const job = await clonePresto();
    const html = await outputHtml(job.result as unknown as CloneResult, "EDITABLE");
    const $ = cheerio.load(html);
    expect(html).not.toContain("<presto-player");
    expect($(".elementor-invisible")).toHaveLength(0);
    expect($("h1").text()).toContain("Atividades para o seu filho");

    const frame = $('iframe[data-os-video="youtube"]');
    expect(frame).toHaveLength(1);
    expect(frame.attr("src")).toBe("https://www.youtube.com/embed/1cNGAYxDXUg?rel=0");
    expect(frame.attr("style")).toContain("border-radius:18px");
    // Arquivo de vídeo e capa baixados (endereçados por hash).
    const video = $("video[data-os-file]");
    expect(video.attr("src")).toMatch(/^\/os-assets\/[0-9a-f]{64}\.mp4$/);
    expect(video.attr("poster")).toMatch(/^\/os-assets\/[0-9a-f]{64}\.jpg$/);

    // <selo-garantia>: o CSS (só em adoptedStyleSheets) vai junto no shadow DOM salvo.
    expect(html).toContain("Garantia de 7 dias");
    expect(html).toMatch(/<style data-os-adopted="">[^<]*\.selo \{ color: rgb\(46, 125, 50\); font-weight: 700; \}/);

    // "Preservar JS" continua o HTML original, com o player e o script dele.
    const original = await outputHtml(job.result as unknown as CloneResult, "PRESERVE_JS");
    expect(original).toContain("<presto-player");
    expect(original).toContain("elementor-invisible");
  }, 240_000);

  it("Preservar JS → Converter para editável → Histórico volta o modo", async () => {
    const job = await clonePresto();
    const offer = await saveClone({
      jobId: job.id,
      name: "Presto com scripts",
      folderId: null,
      mode: "PRESERVE_JS",
      keepRemoved: [],
      childJobIds: [],
    });
    const doc = await documentOf(offer.id);
    expect(doc.variant.page.cloneMode).toBe("PRESERVE_JS");
    expect(doc.assetMap).not.toBeNull();
    expect(doc.html).toContain("<presto-player");
    // A cópia editável sai com o mesmo tratamento do HTML salvo (checkout ligado ao link da oferta).
    const editable = doc.editableHtml ?? "";
    expect(editable).toContain('data-os-video="youtube"');
    expect(editable).not.toContain("<presto-player");
    const link = await prisma.offerLink.findFirstOrThrow({ where: { offerId: offer.id } });
    expect(editable).toContain(`data-os-link="${link.key}"`);
    expect(doc.html).toContain(`data-os-link="${link.key}"`);

    let payload = await getEditorPayload(doc.id);
    expect(payload.cloneMode).toBe("PRESERVE_JS");
    expect(payload.convertible).toBe(true);

    // Uma versão B copiada e a página duplicada levam a cópia editável junto.
    const variantB = await createVariant({ pageId: doc.variant.pageId });
    const docB = await prisma.pageDocument.findFirstOrThrow({ where: { variantId: variantB.id } });
    expect(docB.editableHtml).toBe(editable);
    const copy = await duplicatePage(doc.variant.pageId);
    const copyDoc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: copy.id } } });
    expect(copyDoc.editableHtml).toBe(editable);

    // Localizar e substituir em todas as páginas muda a cópia editável junto.
    await bulkReplace({
      offerId: offer.id,
      query: "Atividades para o seu filho",
      replacement: "Atividades para a sua filha",
      targets: { text: true, attributes: false },
      excludeDocumentIds: [docB.id, copyDoc.id],
    });
    const replaced = await prisma.pageDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(replaced.html).toContain("Atividades para a sua filha");
    expect(replaced.editableHtml).toContain("Atividades para a sua filha");

    const { revision } = await convertToEditable(doc.id);
    const converted = await prisma.pageDocument.findUniqueOrThrow({
      where: { id: doc.id },
      include: { variant: { include: { page: true } } },
    });
    expect(converted.revision).toBe(revision);
    expect(converted.html).toBe(replaced.editableHtml);
    expect(converted.project).toBeNull();
    expect(converted.assetMap).toBeNull();
    expect(converted.editableHtml).toBeNull();
    // A versão B ainda tem os scripts: a página continua "Preservar JS" até ela converter também.
    expect(converted.variant.page.cloneMode).toBe("PRESERVE_JS");
    payload = await getEditorPayload(doc.id);
    expect(payload.cloneMode).toBe("EDITABLE");
    expect(payload.convertible).toBe(false);
    expect(payload.html).toContain('data-os-video="youtube"');

    const versions = await listVersions(doc.id);
    expect(versions.map((v) => `${v.kind}|${v.label}`)).toEqual(
      expect.arrayContaining(["CLONE|Original com scripts (antes de converter)", "CLONE|Versão original (editável)"]),
    );

    // Converter de novo não faz nada; a versão B converte e a página vira Editável.
    expect((await convertToEditable(doc.id)).revision).toBe(revision);
    await convertToEditable(docB.id);
    expect((await prisma.page.findUniqueOrThrow({ where: { id: doc.variant.pageId } })).cloneMode).toBe("EDITABLE");

    // Restaurar "Original com scripts" volta o HTML, os arquivos originais e o modo.
    const withScripts = versions.find((v) => v.label === "Original com scripts (antes de converter)");
    await restoreVersion(doc.id, withScripts?.id ?? "");
    const restored = await prisma.pageDocument.findUniqueOrThrow({
      where: { id: doc.id },
      include: { variant: { include: { page: true } } },
    });
    expect(restored.html).toBe(replaced.html);
    expect(restored.assetMap).toEqual(replaced.assetMap);
    expect(restored.editableHtml).toBe(replaced.editableHtml);
    expect(restored.variant.page.cloneMode).toBe("PRESERVE_JS");
    expect((await getEditorPayload(doc.id)).convertible).toBe(true);

    // E a versão "Antes de restaurar" (editável) volta o modo editável.
    const before = (await listVersions(doc.id)).find((v) => v.label === "Antes de restaurar uma versão");
    await restoreVersion(doc.id, before?.id ?? "");
    const back = await prisma.pageDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(back.assetMap).toBeNull();
    expect(back.html).toBe(replaced.editableHtml);
    expect((await prisma.page.findUniqueOrThrow({ where: { id: doc.variant.pageId } })).cloneMode).toBe("EDITABLE");
  }, 300_000);

  it("página 'Preservar JS' salva sem a cópia editável: o editor avisa em vez de converter", async () => {
    const job = await clonePresto();
    const offer = await saveClone({
      jobId: job.id,
      name: "Presto antiga",
      folderId: null,
      mode: "PRESERVE_JS",
      keepRemoved: [],
      childJobIds: [],
    });
    const doc = await documentOf(offer.id);
    await prisma.pageDocument.update({ where: { id: doc.id }, data: { editableHtml: null } });
    expect((await getEditorPayload(doc.id)).convertible).toBe(false);
    await expect(convertToEditable(doc.id)).rejects.toThrow(CONVERT_NOT_AVAILABLE);
    const after = await prisma.pageDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(after.assetMap).not.toBeNull();
    expect(after.html).toBe(doc.html);
  }, 240_000);

  it("salvar no modo Editável não guarda cópia extra", async () => {
    const job = await clonePresto();
    const offer = await saveClone({
      jobId: job.id,
      name: "Presto editável",
      folderId: null,
      mode: "EDITABLE",
      keepRemoved: [],
      childJobIds: [],
    });
    const doc = await documentOf(offer.id);
    expect(doc.editableHtml).toBeNull();
    expect(doc.html).toContain('data-os-video="youtube"');
    expect((await getEditorPayload(doc.id)).convertible).toBe(false);
  }, 240_000);
});
