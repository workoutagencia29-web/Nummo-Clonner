/**
 * Integração G1 fidelity#12 no "Salvar como oferta": ligar os checkouts aos
 * links da oferta e trocar os links do funil passa pelo cheerio, que reescreve
 * qualquer doctype como <!DOCTYPE html>. O documento salvo precisa manter o
 * doctype da cópia (ou a falta dele), senão páginas antigas saem do modo em
 * que foram feitas.
 */
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { deleteObject, putObject } from "@/lib/storage";
import { saveClone } from "@/server/services/clone";
import type { CloneResult } from "@/worker/clone/types";

const LEGACY = '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">';
const CHECKOUT = "https://pay.hotmart.com/X123";
const written: string[] = [];

afterAll(async () => {
  for (const key of written) await deleteObject(key).catch(() => {});
});

async function savedHtml(editable: string) {
  const job = await prisma.cloneJob.create({
    data: {
      source: "URL",
      sourceUrl: "https://antiga.exemplo.com/",
      status: "REVIEW",
      options: { devices: ["desktop"] },
    },
  });
  const outputs: Record<string, string> = {};
  for (const mode of ["editable", "preserve_js"]) {
    const key = `clones/${job.id}/desktop-${mode}.html`;
    await putObject(key, editable);
    written.push(key);
    outputs[mode] = key;
  }
  const result: CloneResult = {
    title: "Antiga",
    finalUrl: "https://antiga.exemplo.com/",
    responsive: true,
    devices: {
      desktop: {
        outputs: {
          EDITABLE: { htmlKey: outputs.editable as string },
          PRESERVE_JS: { htmlKey: outputs.preserve_js as string, assetMap: {} },
        },
      },
    },
    removed: [],
    checkouts: [{ url: CHECKOUT, platform: "Hotmart", source: "HREF", confidence: 100, occurrences: 1 }],
    funnel: [],
    videos: [],
    delay: null,
    warnings: [],
    suggestedMode: "EDITABLE",
    assets: [],
    stats: { assets: 0, bytes: 0, failed: 0, blockedRequests: 0, durationMs: 1 },
  };
  await prisma.cloneJob.update({ where: { id: job.id }, data: { result: result as object } });
  const offer = await saveClone({
    jobId: job.id,
    name: "Antiga",
    folderId: null,
    mode: "EDITABLE",
    keepRemoved: [],
    childJobIds: [],
  });
  const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { page: { offerId: offer.id } } } });
  return doc.html ?? "";
}

describe("G1 fidelity#12 — o documento salvo mantém o doctype da cópia", () => {
  it("doctype antigo continua o mesmo depois de ligar o checkout ao link da oferta", async () => {
    const html = await savedHtml(
      `${LEGACY}\n<html><head><meta charset="utf-8"><title>Antiga</title></head><body><a id="c" href="${CHECKOUT}">Comprar</a></body></html>`,
    );
    expect(html).toMatch(/<a id="c" href="https:\/\/pay\.hotmart\.com\/X123" data-os-link="[^"]+"/);
    expect(html.startsWith(LEGACY)).toBe(true);
    expect(html.match(/<!doctype/gi)).toHaveLength(1);
  });

  it("página sem doctype (quirks) continua sem", async () => {
    const html = await savedHtml(
      `<html><head><meta charset="utf-8"><title>Antiga</title></head><body><a id="c" href="${CHECKOUT}">Comprar</a></body></html>`,
    );
    expect(html).toContain("data-os-link=");
    expect(/<!doctype/i.test(html)).toBe(false);
  });
});
