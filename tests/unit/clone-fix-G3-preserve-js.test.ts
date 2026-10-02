/**
 * data#0 — de ponta a ponta (Chromium de verdade, site de teste offline): no
 * modo "Preservar JS" os links relativos do site ("/upsell", "/obrigado")
 * também ligam as páginas do funil (os-page:) e os que não foram clonados
 * apontam para o site original.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { saveClone } from "@/server/services/clone";
import { runCloneJob } from "@/worker/clone/job";
import { type FixtureServer, startFixtureServer } from "../fixtures/server";

let srv: FixtureServer;

beforeAll(async () => {
  srv = await startFixtureServer();
  process.env.OS_CLONE_HOST_MAP = "*.fixture.test=127.0.0.1";
}, 60_000);

afterAll(async () => {
  await srv?.close();
});

async function clone(url: string, parentJobId?: string) {
  const job = await prisma.cloneJob.create({
    data: { source: "URL", sourceUrl: url, options: { devices: ["desktop"], maxVideoMb: 5 }, parentJobId },
  });
  await runCloneJob(job.id);
  const done = await prisma.cloneJob.findUniqueOrThrow({ where: { id: job.id } });
  expect(done.status, done.errorMessage ?? "").toBe("REVIEW");
  return done;
}

describe("salvar em 'Preservar JS'", () => {
  it("vendas + upsell: o link relativo para o upsell vira os-page e os outros vão para o site original", async () => {
    const main = await clone(srv.url("vendas"));
    const upsell = await clone(srv.url("vendas", "/upsell"), main.id);
    const offer = await saveClone({
      jobId: main.id,
      name: "Preservar JS",
      folderId: null,
      mode: "PRESERVE_JS",
      keepRemoved: [],
      childJobIds: [upsell.id],
    });
    const pages = await prisma.page.findMany({
      where: { offerId: offer.id },
      orderBy: { position: "asc" },
      include: { variants: { include: { documents: true } } },
    });
    expect(pages).toHaveLength(2);
    const home = pages[0].variants[0].documents[0].html ?? "";
    expect(home).toContain(`href="os-page:${pages[1].id}"`);
    expect(home).not.toContain('href="/upsell"');
    expect(home).toContain(`href="${srv.url("vendas", "/obrigado")}"`);
    expect(home).toContain(`href="${srv.url("vendas", "/politica-de-privacidade/")}"`);
  }, 240_000);
});
