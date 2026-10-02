/**
 * Regressões da 2ª rodada de correções do "Baixar ZIP" (Fase 5), com o banco
 * e o ZIP de verdade (buildExport):
 * - "Preservar JS": "x.php ", "web.config ", "web.config." e "sub/php.ini "
 *   nunca entram no ZIP (nem nas pastas das versões) e aparecem no aviso;
 * - "Preservar JS" com versões A/B e celular: vídeo e arquivos grandes saem
 *   uma vez só (no caminho original); o que o HTML pede pela raiz, também;
 * - 404.html na raiz (noindex), na prévia e protegido de um arquivo original
 *   com o mesmo nome;
 * - LEIA-ME com o divisor desligado não promete o que só o divisor faz.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { brokenZipPath, isServerSidePath } from "@/lib/export/paths";
import { putContentAddressed } from "@/lib/storage";
import { exportPlan } from "@/server/services/export";
import { buildExport } from "@/server/services/export/build";
import { NOT_FOUND_TREE_LABEL } from "@/server/services/export/plan";
import { PRESERVE_COPY_MAX_BYTES } from "@/server/services/export/preserve";
import { createOffer } from "@/server/services/offers";
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
  tmp ??= await mkdtemp(path.join(os.tmpdir(), "os-export-r2-"));
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

/** Página inicial "Preservar JS" com computador + celular separados e o assetMap dado. */
async function preserveHome(name: string, assetMap: Record<string, string>, html?: string) {
  const offer = await createOffer({ name });
  const home = await homeOf(offer.id);
  await prisma.page.update({
    where: { id: home.id },
    data: { cloneMode: "PRESERVE_JS", sourceUrl: "https://quiz.site.com/" },
  });
  const body =
    html ??
    `<!doctype html><html><head><meta charset="utf-8"><title>Quiz</title><link rel="stylesheet" href="/css/orig.css"></head><body><div id="q"></div><script src="/js/quiz.js"></script></body></html>`;
  await prisma.pageDocument.update({
    where: { id: home.variants[0].documents[0].id },
    data: { device: "DESKTOP", html: body, assetMap },
  });
  await prisma.pageDocument.create({
    data: { variantId: home.variants[0].id, device: "MOBILE", html: body.replace("Quiz", "Quiz celular"), assetMap },
  });
  return { offer, home };
}

/** Algum nome do caminho, como o Windows grava (sem espaço/ponto no fim), é arquivo de servidor? */
function serverSideOnWindows(zipPath: string) {
  return isServerSidePath(zipPath) || zipPath.split("/").some((s) => /[ .]$/.test(s));
}

describe("Preservar JS: nomes terminados em espaço ou ponto", () => {
  it("“x.php ”, “web.config ”, “web.config.” e “sub/php.ini ” não entram em pasta nenhuma do ZIP", async () => {
    const shell = await asset("<?php system($_GET['c']); ?>", "bin");
    const conf = await asset("<configuration/>", "bin");
    const ini = await asset("auto_prepend_file=x", "bin");
    const img = await asset("png-etapa", "png");
    const js = await asset('var etapas=["img/etapa-1.png"];', "js");
    const css = await asset(".q{color:red}", "css");
    const { offer, home } = await preserveHome("Oferta Windows", {
      "/x.php%20": shell.key,
      "/web.config%20": conf.key,
      "/web.config.": conf.key,
      "/sub/php.ini%20": ini.key,
      "/img/etapa-1.png": img.key,
      "/js/quiz.js": js.key,
      "/css/orig.css": css.key,
    });
    await createVariant({ pageId: home.id });

    const plan = await exportPlan(offer.id);
    const { entries, warnings, zip } = await build(offer.id);
    expect(brokenZipPath(entries)).toBeNull();
    expect(entries.filter(serverSideOnWindows)).toEqual([]);
    for (const bad of ["x.php", "web.config", "php.ini"]) {
      expect(
        entries.some((e) => e.toLowerCase().includes(bad)),
        bad,
      ).toBe(false);
    }
    // O que é da página continua lá (e o que o script monta, nas pastas das versões).
    expect(zip.has("img/etapa-1.png")).toBe(true);
    expect(zip.has("oferta-a/img/etapa-1.png")).toBe(true);
    expect(zip.has("oferta-b/celular/img/etapa-1.png")).toBe(true);
    const all = warnings.join("\n");
    expect(all).toContain("ficaram de fora por segurança");
    expect(plan.warnings.join("\n")).toContain("ficaram de fora por segurança");
    // A prévia também não lista nada disso.
    expect(plan.tree.some((t) => /php|web\.config/i.test(t.path))).toBe(false);
  });
});

describe("Preservar JS com versões A/B e celular: sem arquivos repetidos à toa", () => {
  it("vídeo e arquivo grande saem uma vez só; o que o HTML pede pela raiz também; o que o script monta, em cada pasta", async () => {
    const video = await asset(Buffer.alloc(4096, 1), "mp4");
    const big = await asset(Buffer.alloc(PRESERVE_COPY_MAX_BYTES + 1024, 7), "json");
    const small = await asset(JSON.stringify({ ok: true }), "json");
    const img = await asset("png-etapa", "png");
    const js = await asset('fetch("dados/config.json");fetch("dados/grande.json")', "js");
    const css = await asset(".q{color:red}", "css");
    const { offer, home } = await preserveHome("Oferta Vídeo", {
      "/video/vsl.mp4": video.key,
      "/dados/grande.json": big.key,
      "/dados/config.json": small.key,
      "/img/etapa-1.png": img.key,
      "/js/quiz.js": js.key,
      "/css/orig.css": css.key,
    });
    await createVariant({ pageId: home.id });

    const { entries, zip } = await build(offer.id);
    expect(brokenZipPath(entries)).toBeNull();
    const dirs = ["oferta-a/", "oferta-a/celular/", "oferta-b/", "oferta-b/celular/"];
    for (const dir of dirs) expect(zip.has(`${dir}index.html`), dir).toBe(true);
    // Uma vez só, no caminho original.
    for (const file of ["video/vsl.mp4", "dados/grande.json", "js/quiz.js", "css/orig.css"]) {
      expect(
        entries.filter((e) => e.endsWith(file)),
        file,
      ).toEqual([file]);
    }
    // Montado pelo script (endereço relativo à página): em cada pasta de versão/celular.
    for (const dir of ["", ...dirs]) {
      expect(zip.has(`${dir}img/etapa-1.png`), dir).toBe(true);
      expect(zip.has(`${dir}dados/config.json`), dir).toBe(true);
    }
  });
});

describe("404.html", () => {
  it("vai na raiz do ZIP (noindex, no idioma das páginas), aparece na prévia e um arquivo original não toma o lugar dele", async () => {
    const fake = await asset("<h1>404 do site original</h1>", "html");
    const { offer } = await preserveHome("Oferta 404", { "/404.html": fake.key });
    const plan = await exportPlan(offer.id);
    expect(plan.tree.find((t) => t.path === "404.html")).toEqual({
      path: "404.html",
      kind: "file",
      label: NOT_FOUND_TREE_LABEL,
    });
    const { text, entries, warnings } = await build(offer.id);
    const page = text("404.html");
    expect(page).toContain('<meta name="robots" content="noindex">');
    expect(page).toContain("Página não encontrada");
    expect(page).not.toContain("404 do site original");
    expect(entries.filter((e) => e.toLowerCase() === "404.html")).toEqual(["404.html"]);
    expect(warnings.join("\n")).toContain("tinham o mesmo caminho");
    expect(text("LEIA-ME.txt")).toContain("404.html");
  });
});

describe("LEIA-ME com o divisor desligado", () => {
  it("não fala de divisor, cookie os_ab_ nem de continuar na versão", async () => {
    const offer = await createOffer({ name: "Oferta Sem Divisor" });
    const home = await homeOf(offer.id);
    await createVariant({ pageId: home.id });
    const off = (await build(offer.id, { splitter: false })).text("LEIA-ME.txt");
    expect(off).not.toContain("continua nela");
    expect(off).not.toContain("os_ab_");
    expect(off).toContain("Sem o divisor, o endereço da página mostra sempre a versão de controle");
    const on = (await build(offer.id, { splitter: true })).text("LEIA-ME.txt");
    expect(on).toContain("continua nela");
    expect(on).toContain("os_ab_");
  });
});
