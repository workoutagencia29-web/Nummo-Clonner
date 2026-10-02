/**
 * Fase 3 — terceira rodada: o reparo de páginas abertas pelo editor antigo
 * (src/lib/legacy-repair.ts) não confunde um id de verdade ("oferta-2") nem a
 * cópia feita com Duplicar ("botao-2") com uma renomeação antiga. Serviços e
 * banco de verdade com o editor de verdade: primeira abertura (importa e
 * grava), segunda abertura (o servidor decide se há o que reparar).
 */
import * as cheerio from "cheerio";
import { type Browser, chromium, type Page, type Route } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { PROJECT_FORMAT_KEY } from "@/lib/legacy-repair";
import { packProject } from "@/lib/project-data";
import { getObject, mimeFromKey } from "@/lib/storage";
import { getEditorPayload, listVersions, removeVersionFiles, saveEditorDocument } from "@/server/services/documents";
import { createOffer } from "@/server/services/offers";
import { type EditorWindow, editorBundle } from "./blocks-harness";

const ASSET = "/os-assets/";
let browser: Browser;
const docs = new Set<string>();

beforeAll(async () => {
  browser = await chromium.launch();
  await editorBundle();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await removeVersionFiles(docs);
});

async function serveAsset(route: Route, pathname: string) {
  const file = pathname.slice(ASSET.length);
  const key = `a/${file.slice(0, 2)}/${file}`;
  try {
    return await route.fulfill({ body: await getObject(key), contentType: mimeFromKey(key) });
  } catch {
    return route.fulfill({ status: 404, body: "" });
  }
}

const SHELL = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<div id="canvas" style="height:900px"></div><div id="blocks"></div><div id="layers"></div>
<div id="styles"></div><div id="traits"></div></body></html>`;

/** Editor como no app (a folha base vem do storage). Com `project`, reabre; sem, importa `html`. */
async function openEditor(opts: { project?: unknown; html?: string }): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:") return route.continue();
    if (url.host === "editor.test" && url.pathname.startsWith(ASSET)) return serveAsset(route, url.pathname);
    if (url.href === "http://editor.test/") return route.fulfill({ contentType: "text/html", body: SHELL });
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto("http://editor.test/");
  await page.addScriptTag({ content: await editorBundle() });
  await page.evaluate(
    ({ project, html }) =>
      new Promise<void>((resolve) => {
        const w = window as unknown as EditorWindow;
        const [canvas, blocks, layers, styles, traits] = ["canvas", "blocks", "layers", "styles", "traits"].map(
          (id) => document.getElementById(id) as HTMLElement,
        );
        const ed = w.OS.createEditor({ canvas, blocks, layers, styles, traits }, project ?? null);
        w.ed = ed;
        w.OS.setWidgetContext(ed, () => ({ links: [], pages: [] }));
        w.OS.registerDynamicTraits(ed, () => ({ links: [], pages: [] }));
        ed.on("load", () => {
          if (!project && html) {
            ed.setComponents(html, { asDocument: true } as never);
            ed.UndoManager.clear();
          }
          resolve();
        });
      }),
    opts,
  );
  await page.waitForFunction(() => {
    const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument();
    return Array.from(doc?.querySelectorAll("link[rel=stylesheet]") ?? []).every((l) =>
      Boolean((l as HTMLLinkElement).sheet),
    );
  });
  return page;
}

/** O que o editor manda ao salvar (editor-app.tsx: snapshotOf). */
function snapshot(page: Page) {
  return page.evaluate(() => {
    const ed = (window as unknown as EditorWindow).ed;
    const { assets: _assets, ...project } = ed.getProjectData() as Record<string, unknown>;
    return {
      project,
      html: ed.getHtml({ asDocument: true } as never),
      css: ed.getCss({ avoidProtected: true }) ?? "",
    };
  });
}

async function newDoc(html: string) {
  const offer = await createOffer({ name: "Oferta" });
  const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { page: { offerId: offer.id } } } });
  docs.add(doc.id);
  await prisma.pageDocument.update({ where: { id: doc.id }, data: { html, project: null } });
  return doc.id;
}

/** Primeira abertura como no app: importa o HTML e grava na hora. */
async function firstOpen(id: string) {
  const payload = await getEditorPayload(id);
  const page = await openEditor({ html: payload.html ?? "" });
  try {
    await saveEditorDocument({ documentId: id, revision: payload.revision, ...(await snapshot(page)) });
  } finally {
    await page.close();
  }
}

async function storedIds(id: string, selector: string) {
  const row = await prisma.pageDocument.findUniqueOrThrow({ where: { id } });
  const $ = cheerio.load(row.html ?? "");
  return $(selector)
    .map((_, el) => $(el).attr("id") ?? "")
    .get();
}

// 2º "oferta" repetido na página e uma 3ª seção que já se chamava "oferta-2".
const ORIGINAL = `<!doctype html><html><head><meta charset="utf-8"><title>x</title>
<style>#oferta{background:rgb(0, 128, 0)} #oferta-2{background:rgb(255, 165, 0)}</style></head><body>
<section id="oferta" class="d">Oferta desktop</section>
<section id="oferta" class="m">Oferta celular</section>
<section id="oferta-2" class="o2">Segunda oferta</section>
<a href="#oferta-2" id="link2">ver a segunda oferta</a>
<p><a id="botao" class="b1">Comprar</a><a id="botao" class="b2">Comprar de novo</a></p>
</body></html>`;

describe("reparo de páginas antigas × ids de verdade", () => {
  it("'oferta-2' da página não vira repetido de 'oferta' na segunda abertura", async () => {
    const id = await newDoc(ORIGINAL);
    await firstOpen(id);
    expect(await storedIds(id, "section")).toEqual(["oferta", "oferta", "oferta-2"]);

    const payload = await getEditorPayload(id);
    expect((payload.project as Record<string, unknown>)[PROJECT_FORMAT_KEY]).toBe(2);
    expect(payload.repair).toBeNull();

    // Reaberto e gravado de novo: tudo igual, e a âncora continua achando a seção.
    const page = await openEditor({ project: payload.project });
    try {
      const repaired = await page.evaluate(
        (r) => (window as unknown as EditorWindow).OS.applyLegacyRepair((window as unknown as EditorWindow).ed, r),
        payload.repair,
      );
      expect(repaired).toBe(false);
      await saveEditorDocument({ documentId: id, revision: payload.revision, ...(await snapshot(page)) });
    } finally {
      await page.close();
    }
    expect(await storedIds(id, "section")).toEqual(["oferta", "oferta", "oferta-2"]);
    expect((await listVersions(id)).map((v) => v.label)).not.toContain("Antes do reparo automático");
  });

  it("Duplicar o primeiro de um id repetido ('botao' → cópia 'botao-2') não é reparado ao reabrir", async () => {
    const id = await newDoc(ORIGINAL);
    await firstOpen(id);
    const payload = await getEditorPayload(id);
    const page = await openEditor({ project: payload.project });
    let copyId = "";
    try {
      copyId = await page.evaluate(async () => {
        const ed = (window as unknown as EditorWindow).ed;
        ed.select(ed.getWrapper()?.find("a.b1")[0] as never);
        ed.runCommand("tlb-clone");
        await new Promise((r) => setTimeout(r, 150));
        const copy = ed.getWrapper()?.find("a.b1")[1];
        return copy?.getId() ?? "";
      });
      // O CSS original não mira #botao: a cópia fica com o id que o GrapesJS dá.
      expect(copyId).toBe("botao-2");
      await saveEditorDocument({ documentId: id, revision: payload.revision, ...(await snapshot(page)) });
    } finally {
      await page.close();
    }
    const again = await getEditorPayload(id);
    expect(again.repair).toBeNull();

    // Projeto gravado pelo editor corrigido antes da marca de formato: o "botao"
    // já tem repetido marcado, então "botao-2" também não é renomeação.
    const { [PROJECT_FORMAT_KEY]: _format, ...interim } = again.project as Record<string, unknown>;
    await prisma.pageDocument.update({ where: { id }, data: { project: packProject(interim) } });
    expect((await getEditorPayload(id)).repair).toBeNull();
    expect(await storedIds(id, "a.b1")).toEqual(["botao", "botao-2"]);
  });
});
