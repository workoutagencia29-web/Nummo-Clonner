/**
 * "Salvar oferta" de um funil clonado com páginas "Com scripts": os endereços
 * completos das páginas salvas juntas, dentro dos scripts inline, viram o
 * caminho original ("/roleta") — no HTML "Com scripts" (com assetMap), nunca
 * na cópia editável (`editableHtml`) nem nas páginas "Editável"; o resto do
 * HTML não muda (o link <a> continua virando os-page:<id>).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { deleteObject, putObject } from "@/lib/storage";
import { saveClone } from "@/server/services/clone";
import type { CloneResult } from "@/worker/clone/types";
import { resetDatabase } from "../setup/per-file";

const written: string[] = [];

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  for (const key of written) await deleteObject(key).catch(() => {});
});

const html = (name: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${name}</title><script>var proxima="https://www.loja.exemplo.test/roleta",loja="https:\\/\\/loja.exemplo.test\\/loja\\/",fora="https://loja.exemplo.test/roleta-2";</script></head><body><a id="ir" href="https://loja.exemplo.test/roleta">Girar</a><p>https://loja.exemplo.test/roleta</p></body></html>`;

async function job(url: string, name: string, parentJobId: string | null) {
  const row = await prisma.cloneJob.create({
    data: {
      source: "URL",
      sourceUrl: url,
      status: "REVIEW",
      parentJobId,
      options: { devices: ["desktop"] },
    },
  });
  const keys: Record<string, string> = {};
  for (const mode of ["editable", "preserve"]) {
    const key = `clones/${row.id}/desktop-${mode}.html`;
    await putObject(key, html(name));
    written.push(key);
    keys[mode] = key;
  }
  const result: CloneResult = {
    title: name,
    finalUrl: url,
    responsive: true,
    devices: {
      desktop: {
        outputs: {
          EDITABLE: { htmlKey: keys.editable as string },
          PRESERVE_JS: { htmlKey: keys.preserve as string, assetMap: {} },
        },
      },
    },
    removed: [],
    checkouts: [],
    funnel: [],
    videos: [],
    delay: null,
    warnings: [],
    suggestedMode: "PRESERVE_JS",
    assets: [],
    stats: { assets: 0, bytes: 0, failed: 0, blockedRequests: 0, durationMs: 1 },
  };
  await prisma.cloneJob.update({ where: { id: row.id }, data: { result: result as object } });
  return row.id;
}

describe("salvar o funil clonado com páginas “Com scripts”", () => {
  it("scripts inline do HTML “Com scripts” com o caminho original; cópia editável e página Editável como estavam", async () => {
    const quiz = await job("https://loja.exemplo.test/", "Quiz", null);
    const roleta = await job("https://loja.exemplo.test/roleta", "Roleta", quiz);
    const loja = await job("https://loja.exemplo.test/loja/", "Loja", quiz);
    const offer = await saveClone({
      jobId: quiz,
      name: "Funil",
      folderId: null,
      mode: "PRESERVE_JS",
      modes: { [loja]: "EDITABLE" },
      keepRemoved: [],
      childJobIds: [roleta, loja],
    });
    const pages = await prisma.page.findMany({
      where: { offerId: offer.id },
      orderBy: { position: "asc" },
      include: { variants: { include: { documents: true } } },
    });
    expect(pages.map((p) => [p.cloneMode, p.sourceUrl])).toEqual([
      ["PRESERVE_JS", "https://loja.exemplo.test/"],
      ["PRESERVE_JS", "https://loja.exemplo.test/roleta"],
      ["EDITABLE", "https://loja.exemplo.test/loja/"],
    ]);
    const [quizDoc] = pages[0].variants[0].documents;
    const roletaPage = pages[1];
    // O script: endereços inteiros das páginas → caminho original; "/roleta-2" (não é página) fica.
    expect(quizDoc.html).toContain(
      '<script>var proxima="/roleta",loja="\\/loja\\/",fora="https://loja.exemplo.test/roleta-2";</script>',
    );
    // Fora dos scripts: o link vira os-page (linkFunnelPages); o texto fica.
    expect(quizDoc.html).toContain(`<a id="ir" href="os-page:${roletaPage.id}">Girar</a>`);
    expect(quizDoc.html).toContain("<p>https://loja.exemplo.test/roleta</p>");
    // A cópia editável (para "Converter para editável") não roda os scripts originais: fica igual.
    expect(quizDoc.editableHtml).toContain('var proxima="https://www.loja.exemplo.test/roleta"');
    // Página Editável: nada muda nos scripts.
    expect(pages[2].variants[0].documents[0].html).toContain('var proxima="https://www.loja.exemplo.test/roleta"');
  });
});
