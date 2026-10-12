/**
 * Clonar o funil inteiro a partir de um link, de ponta a ponta no site de
 * teste "funil" (offline): quiz montado por script → roleta (girar e resgatar,
 * destino só no script) → loja com 4 produtos (um cartão por onclick) → página
 * de cada produto. O worker de verdade (Chromium) clona a 1ª página, o robô
 * clica pelo quiz e pela roleta, e as páginas seguintes entram na fila sozinhas.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { saveClone } from "@/server/services/clone";
import { DUPLICATE_CODE, expandFunnel, funnelOptions } from "@/server/services/clone-funnel";
import { claimNextJob, runCloneJob } from "@/worker/clone/job";
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

/** Roda a fila inteira (como o worker), uma clonagem por vez. */
async function drainQueue(max = 30) {
  for (let i = 0; i < max; i++) {
    const id = await claimNextJob();
    if (!id) return i;
    await runCloneJob(id);
  }
  throw new Error("a fila não esvaziou");
}

const pathOf = (url: string | null) => new URL(url ?? "").pathname.replace(/\/$/, "") || "/";

describe("clonar o funil inteiro", () => {
  let rootId = "";

  it("a partir do quiz, acha e clona roleta, loja e os 4 produtos (e mais nada)", async () => {
    const root = await prisma.cloneJob.create({
      data: {
        source: "URL",
        sourceUrl: srv.url("funil", "/"),
        options: { devices: ["desktop"], maxVideoMb: 0, funnel: true },
      },
    });
    rootId = root.id;
    await runCloneJob(root.id);
    const done = await prisma.cloneJob.findUniqueOrThrow({ where: { id: root.id } });
    expect(done.status).toBe("REVIEW");
    const result = done.result as unknown as CloneResult;
    expect(result.page?.kind).toBe("QUIZ");
    // O robô respondeu o quiz e clicou em "Ver meu resultado": a roleta só existe no script.
    expect(result.explored?.stop).toBe("navigated");
    const roleta = result.links?.find((l) => pathOf(l.url) === "/roleta");
    expect(roleta).toMatchObject({ via: "click", label: "Ver meu resultado" });
    // Conta e política ficam de fora.
    expect(result.links?.map((l) => pathOf(l.url))).not.toContain("/minha-conta");
    expect(result.links?.map((l) => pathOf(l.url))).not.toContain("/politica-de-privacidade");

    await drainQueue();
    const children = await prisma.cloneJob.findMany({ where: { parentJobId: root.id }, orderBy: { createdAt: "asc" } });
    const byPath = new Map(children.map((c) => [pathOf(c.sourceUrl), c]));
    expect([...byPath.keys()].sort()).toEqual(
      [
        "/roleta",
        "/loja",
        "/produto/camiseta-azul",
        "/produto/bermuda-jeans",
        "/produto/tenis-branco",
        "/produto/bone-preto",
      ].sort(),
    );
    for (const c of children) expect(c.status, c.sourceUrl ?? "").toBe("REVIEW");

    const roletaJob = byPath.get("/roleta");
    const lojaJob = byPath.get("/loja");
    const kind = (path: string) => (byPath.get(path)?.result as unknown as CloneResult).page;
    expect(kind("/roleta")?.kind).toBe("WHEEL");
    expect(kind("/loja")?.kind).toBe("STORE");
    expect(kind("/produto/bone-preto")).toEqual({ kind: "PRODUCT", name: "Boné Preto" });
    // Quem levou a quem (o mapa do funil): quiz → roleta → loja → produtos.
    expect(funnelOptions(roletaJob?.options).step).toMatchObject({ from: root.id, depth: 1, via: "click" });
    expect(funnelOptions(lojaJob?.options).step).toMatchObject({ from: roletaJob?.id, depth: 2 });
    const bone = funnelOptions(byPath.get("/produto/bone-preto")?.options).step;
    expect(bone).toMatchObject({ from: lojaJob?.id, depth: 3, product: true, label: "Boné Preto" });
    // A loja achou os 4 cartões (um deles só com onclick).
    const lojaLinks = (lojaJob?.result as unknown as CloneResult).links ?? [];
    expect(lojaLinks.filter((l) => l.product).map((l) => pathOf(l.url))).toHaveLength(4);
  }, 400_000);

  it("salvar: as páginas entram na ordem do funil, com nome, tipo e os links entre elas", async () => {
    const children = await prisma.cloneJob.findMany({ where: { parentJobId: rootId, status: "REVIEW" } });
    const roleta = children.find((c) => pathOf(c.sourceUrl) === "/roleta");
    const offer = await saveClone({
      jobId: rootId,
      name: "Funil clonado",
      folderId: null,
      mode: "EDITABLE",
      modes: { [rootId]: "PRESERVE_JS", [roleta?.id ?? ""]: "PRESERVE_JS" },
      keepRemoved: [],
      childJobIds: children.map((c) => c.id),
    });
    const pages = await prisma.page.findMany({
      where: { offerId: offer.id },
      orderBy: { position: "asc" },
      include: { variants: { include: { documents: true } } },
    });
    expect(pages.map((p) => p.name)).toEqual([
      "Descubra o seu estilo",
      "Roleta",
      "Loja",
      "Camiseta Azul",
      "Bermuda Jeans",
      "Tênis Branco",
      "Boné Preto",
    ]);
    expect(pages.map((p) => p.type)).toEqual(["QUIZ", "OTHER", "OTHER", "SALES", "SALES", "SALES", "SALES"]);
    expect(pages.map((p) => p.cloneMode)).toEqual([
      "PRESERVE_JS",
      "PRESERVE_JS",
      "EDITABLE",
      "EDITABLE",
      "EDITABLE",
      "EDITABLE",
      "EDITABLE",
    ]);
    const html = (name: string) => pages.find((p) => p.name === name)?.variants[0].documents[0].html ?? "";
    const id = (name: string) => pages.find((p) => p.name === name)?.id;
    // Loja: os 4 cartões (inclusive o do onclick) levam às páginas clonadas.
    for (const product of ["Camiseta Azul", "Bermuda Jeans", "Tênis Branco", "Boné Preto"]) {
      expect(html("Loja")).toContain(`os-page:${id(product)}`);
    }
    // Produto: "Voltar para a loja" e "Você também pode gostar" também.
    expect(html("Camiseta Azul")).toContain(`os-page:${id("Loja")}`);
    expect(html("Camiseta Azul")).toContain(`os-page:${id("Bermuda Jeans")}`);
    // O checkout de cada produto virou link da oferta.
    expect(await prisma.offerLink.count({ where: { offerId: offer.id } })).toBe(4);
  }, 120_000);

  it("site-aplicativo (rotas por pushState, cartões que só abrem por script): o mesmo funil inteiro", async () => {
    const root = await prisma.cloneJob.create({
      data: {
        source: "URL",
        sourceUrl: srv.url("funil-app", "/"),
        options: { devices: ["desktop"], maxVideoMb: 0, funnel: true },
      },
    });
    await runCloneJob(root.id);
    await drainQueue();
    const children = await prisma.cloneJob.findMany({ where: { parentJobId: root.id }, orderBy: { createdAt: "asc" } });
    const byPath = new Map(children.map((c) => [pathOf(c.sourceUrl), c]));
    expect([...byPath.keys()].sort()).toEqual(
      ["/roleta", "/loja", "/produto/camiseta-azul", "/produto/bermuda-jeans", "/produto/tenis-branco"].sort(),
    );
    for (const c of children) expect(c.status, c.sourceUrl ?? "").toBe("REVIEW");
    // Aberta direto no endereço, cada rota mostra a sua tela (o site devolve o mesmo HTML para todas).
    const page = (path: string) => (byPath.get(path)?.result as unknown as CloneResult).page;
    expect(page("/roleta")?.kind).toBe("WHEEL");
    expect(page("/loja")?.kind).toBe("STORE");
    expect(page("/produto/tenis-branco")).toEqual({ kind: "PRODUCT", name: "Tênis Branco" });
    const tenis = funnelOptions(byPath.get("/produto/tenis-branco")?.options).step;
    expect(tenis).toMatchObject({ from: byPath.get("/loja")?.id, via: "click", product: true, label: "Tênis Branco" });
  }, 400_000);

  it("página que abre a mesma de outra fica de fora (e não põe nada na fila)", async () => {
    const root = await prisma.cloneJob.findUniqueOrThrow({ where: { id: rootId } });
    // A principal foi salva: o funil não cresce mais.
    expect(root.status).toBe("SAVED");
    const twin = await prisma.cloneJob.create({
      data: {
        source: "URL",
        sourceUrl: srv.url("funil", "/?de=novo"),
        status: "REVIEW",
        options: { devices: ["desktop"], funnel: true, step: { from: rootId, depth: 1, label: "", via: "link" } },
        result: { ...(root.result as object), finalUrl: srv.url("funil", "/") },
        parentJobId: rootId,
      },
    });
    await prisma.cloneJob.update({ where: { id: rootId }, data: { status: "REVIEW" } });
    const r = await expandFunnel(twin.id);
    expect(r.duplicateOf).toBe(rootId);
    const after = await prisma.cloneJob.findUniqueOrThrow({ where: { id: twin.id } });
    expect(after.status).toBe("FAILED");
    expect(after.errorCode).toBe(DUPLICATE_CODE);
    expect(after.errorMessage).toContain("Abre a mesma página");
  });
});
