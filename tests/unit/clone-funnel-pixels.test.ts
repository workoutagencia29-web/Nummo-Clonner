/**
 * Funil clonado + pixels próprios: em CADA página clonada (vários index.html) o
 * rastreador do dono original é removido (nos dois modos), e o pixel PRÓPRIO da
 * oferta (Meta + UTMify) é injetado em TODAS as páginas no render — inclusive
 * nas páginas em "Com scripts". Prova de ponta a ponta com o site "rastreadores"
 * (Meta Pixel 1234567890123456, UTMify 66f1a2b3c4d5e6f7a8b9c0d1, GTM-ABC1234…).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { renderPageHtml } from "@/lib/page-render";
import { getObject } from "@/lib/storage";
import { loadTracking } from "@/lib/tracking/config";
import { saveClone } from "@/server/services/clone";
import { createPixel } from "@/server/services/tracking";
import { runCloneJob } from "@/worker/clone/job";
import type { CloneModeValue, CloneResult, Device } from "@/worker/clone/types";
import { type FixtureServer, startFixtureServer } from "../fixtures/server";

let srv: FixtureServer;

beforeAll(async () => {
  srv = await startFixtureServer();
  process.env.OS_CLONE_HOST_MAP = "*.fixture.test=127.0.0.1";
}, 60_000);

afterAll(async () => {
  await srv?.close();
});

/** IDs/marcas dos rastreadores do DONO original (fixture "rastreadores"). */
const ORIGINAL = ["1234567890123456", "66f1a2b3c4d5e6f7a8b9c0d1", "GTM-ABC1234", "cdn.utmify.com.br"];

async function cloneRastreadores() {
  const job = await prisma.cloneJob.create({
    data: { source: "URL", sourceUrl: srv.url("rastreadores"), options: { devices: ["desktop"], maxVideoMb: 0 } },
  });
  await runCloneJob(job.id);
  return prisma.cloneJob.findUniqueOrThrow({ where: { id: job.id } });
}

async function outputHtml(result: CloneResult, mode: CloneModeValue, device: Device = "desktop") {
  const out = result.devices[device]?.outputs[mode];
  if (!out) throw new Error(`sem saída ${mode}`);
  return (await getObject(out.htmlKey)).toString("utf8");
}

describe("funil clonado + pixel próprio em todas as páginas", () => {
  it("rastreador do dono sai da cópia nos DOIS modos (Editável e Com scripts)", async () => {
    const job = await cloneRastreadores();
    expect(job.status).toBe("REVIEW");
    const result = job.result as unknown as CloneResult;

    // Meta Pixel, UTMify (pixel + latest.js) e GTM aparecem na lista de removidos.
    const vendors = result.removed.map((r) => r.vendor.toLowerCase());
    expect(vendors.some((v) => v.includes("meta"))).toBe(true);
    expect(vendors.some((v) => v.includes("utmify"))).toBe(true);
    expect(vendors.some((v) => v.includes("tag manager") || v.includes("gtm"))).toBe(true);

    for (const mode of ["EDITABLE", "PRESERVE_JS"] as const) {
      const html = await outputHtml(result, mode);
      for (const id of ORIGINAL) {
        expect(html, `${id} não pode sobrar no modo ${mode}`).not.toContain(id);
      }
    }
  }, 120_000);

  it("o pixel PRÓPRIO (Meta + UTMify) é injetado em toda página da oferta, Editável e Com scripts", async () => {
    // Oferta com DUAS páginas clonadas: a principal "Editável" e uma do funil "Com scripts".
    const main = await cloneRastreadores();
    const child = await prisma.cloneJob.create({
      data: {
        source: "URL",
        sourceUrl: srv.url("rastreadores", "/pagina-2"),
        options: { devices: ["desktop"], maxVideoMb: 0 },
        parentJobId: main.id,
      },
    });
    // A "página 2" não existe no fixture (404), então clona a mesma página por um
    // caminho diferente: o conteúdo é o mesmo (com os rastreadores do dono).
    await prisma.cloneJob.update({ where: { id: child.id }, data: { sourceUrl: srv.url("rastreadores") } });
    await runCloneJob(child.id);

    const offer = await saveClone({
      jobId: main.id,
      name: "Funil com pixel",
      folderId: null,
      mode: "EDITABLE",
      // A página do funil fica em "Com scripts".
      modes: { [child.id]: "PRESERVE_JS" },
      keepRemoved: [],
      childJobIds: [child.id],
    });

    // O usuário cadastra o PRÓPRIO pixel da Meta (com token da API de Conversões) e o UTMify.
    await createPixel(offer.id, {
      vendor: "META",
      pixelId: "111222333444555",
      accessToken: "EAABsbCS1iHgBOxxxxxxxxxxxxxxxxxxxxxxx",
    });
    await createPixel(offer.id, { vendor: "UTMIFY", pixelId: "aa11bb22cc33dd44ee55ff66" });

    const pages = await prisma.page.findMany({
      where: { offerId: offer.id },
      orderBy: { position: "asc" },
      include: { variants: { include: { documents: true } } },
    });
    expect(pages).toHaveLength(2);

    for (const page of pages) {
      const loaded = await loadTracking({
        offerId: offer.id,
        pageId: page.id,
        mode: "live",
        pageHref: (id) => `/${id}`,
      });
      expect(loaded, `tracking de ${page.name}`).not.toBeNull();
      const doc = page.variants[0].documents[0];
      const html = renderPageHtml(doc.html ?? "", {
        links: [],
        pageHref: (id) => `/${id}`,
        runtimeTag: "<script data-os-runtime></script>",
        tracking: loaded
          ? {
              config: loaded.config,
              scriptTag: "<script data-os-tracking></script>",
              offerCode: loaded.settings.customCode,
            }
          : null,
      });
      // O pixel PRÓPRIO entra na página (ID da Meta e o UTMify do usuário).
      expect(html, `pixel próprio em ${page.name} (${page.cloneMode})`).toContain("111222333444555");
      expect(html, `UTMify próprio em ${page.name}`).toContain("aa11bb22cc33dd44ee55ff66");
      // O rastreador do DONO original continua fora.
      for (const id of ORIGINAL) {
        expect(html, `${id} não pode voltar em ${page.name}`).not.toContain(id);
      }
    }
  }, 180_000);
});
