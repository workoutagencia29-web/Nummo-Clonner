/**
 * Clonar o funil inteiro — a fila (banco, sem navegador): quando uma página
 * termina, as páginas a que ela leva entram na fila como filhas da principal,
 * sem repetir endereço, com limite, nível máximo, menu só da página do link,
 * "Parar de procurar" e as páginas coladas à mão seguindo o mesmo caminho.
 */
import { describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { FUNNEL_PAGE_LIMIT, getCloneStatus, retryClone, startFunnelClones } from "@/server/services/clone";
import {
  expandFunnel,
  FUNNEL_MAX_DEPTH,
  FUNNEL_NEW_PER_PAGE,
  funnelOptions,
  stopFunnel,
} from "@/server/services/clone-funnel";
import type { CloneResult, PageLinkFound } from "@/worker/clone/types";

const SITE = "https://funil.exemplo.com.br";

function result(finalUrl: string, links: PageLinkFound[] = [], extra: Partial<CloneResult> = {}): CloneResult {
  return {
    title: "Página",
    finalUrl,
    responsive: true,
    devices: {},
    removed: [],
    checkouts: [],
    funnel: [],
    links,
    page: { kind: "OTHER", name: "" },
    videos: [],
    warnings: [],
    suggestedMode: "EDITABLE",
    assets: [],
    stats: { assets: 0, bytes: 0, failed: 0, blockedRequests: 0, durationMs: 0 },
    ...extra,
  };
}

const link = (path: string, extra: Partial<PageLinkFound> = {}): PageLinkFound => ({
  url: `${SITE}${path}`,
  label: path,
  via: "link",
  ...extra,
});

async function root(links: PageLinkFound[], options: Record<string, unknown> = { funnel: true }) {
  return prisma.cloneJob.create({
    data: {
      source: "URL",
      sourceUrl: `${SITE}/`,
      status: "REVIEW",
      options: { devices: ["desktop"], maxVideoMb: 0, ...options } as Prisma.InputJsonValue,
      result: result(`${SITE}/`, links) as unknown as Prisma.InputJsonValue,
    },
  });
}

/** Termina uma filha: grava o resultado como se o worker tivesse clonado. */
async function finish(id: string, links: PageLinkFound[] = [], finalUrl?: string) {
  const job = await prisma.cloneJob.findUniqueOrThrow({ where: { id } });
  await prisma.cloneJob.update({
    where: { id },
    data: {
      status: "REVIEW",
      result: result(finalUrl ?? job.sourceUrl ?? "", links) as unknown as Prisma.InputJsonValue,
    },
  });
  return expandFunnel(id);
}

const pathOf = (url: string | null) => new URL(url ?? "").pathname;

describe("expandFunnel", () => {
  it("põe na fila as páginas novas, na ordem: clique, produtos, código, links; menu só da principal", async () => {
    const main = await root([
      link("/institucional", { nav: true }),
      link("/novidades"),
      link("/rota-do-codigo", { via: "code" }),
      link("/produto/a", { product: true }),
      link("/roleta", { via: "click", label: "Ver meu resultado" }),
      link("/", {}),
    ]);
    const first = await expandFunnel(main.id);
    const kids = await prisma.cloneJob.findMany({ where: { id: { in: first.created } } });
    const order = first.created.map((id) => pathOf(kids.find((k) => k.id === id)?.sourceUrl ?? null));
    expect(order).toEqual(["/roleta", "/produto/a", "/rota-do-codigo", "/novidades", "/institucional"]);
    const roleta = kids.find((k) => pathOf(k.sourceUrl) === "/roleta");
    expect(funnelOptions(roleta?.options)).toMatchObject({
      funnel: true,
      devices: ["desktop"],
      step: { from: main.id, depth: 1, via: "click", label: "Ver meu resultado", order: 0 },
    });

    // A roleta leva à loja e ao menu do site: o menu não é seguido fora da página do link.
    const second = await finish(roleta?.id ?? "", [
      link("/loja/"),
      link("/contato-vip", { nav: true }),
      link("/novidades"),
    ]);
    expect(second.created).toHaveLength(1);
    const loja = await prisma.cloneJob.findUniqueOrThrow({ where: { id: second.created[0] } });
    expect(pathOf(loja.sourceUrl)).toBe("/loja/");
    expect(funnelOptions(loja.options).step).toMatchObject({ from: roleta?.id, depth: 2 });

    // Repetir não cria nada de novo.
    expect((await expandFunnel(roleta?.id ?? "")).created).toEqual([]);
  });

  it("página que abriu outra já conhecida fica de fora (repetida) e some do status", async () => {
    const main = await root([link("/a"), link("/b")]);
    const { created } = await expandFunnel(main.id);
    // "/b" redireciona para "/a".
    await finish(created[0], [link("/c")]);
    const dup = await finish(created[1], [link("/d")], `${SITE}/a`);
    expect(dup.duplicateOf).toBe(created[0]);
    const status = await getCloneStatus(main.id);
    expect(status?.children.find((c) => c.id === created[1])).toMatchObject({ duplicate: true, status: "FAILED" });
    // E nada da página repetida entrou na fila.
    const all = await prisma.cloneJob.findMany({ where: { parentJobId: main.id } });
    expect(all.map((c) => pathOf(c.sourceUrl)).sort()).toEqual(["/a", "/b", "/c"]);
  });

  it("limites: por página, total do funil e nível máximo", async () => {
    const many = Array.from({ length: FUNNEL_NEW_PER_PAGE + 5 }, (_, i) => link(`/produto/${i}`, { product: true }));
    const main = await root(many);
    expect((await expandFunnel(main.id)).created).toHaveLength(FUNNEL_NEW_PER_PAGE);
    const more = Array.from({ length: 40 }, (_, i) => link(`/extra/${i}`));
    const kid = await prisma.cloneJob.findFirstOrThrow({ where: { parentJobId: main.id } });
    const next = await finish(kid.id, more);
    expect(next.created).toHaveLength(FUNNEL_PAGE_LIMIT - FUNNEL_NEW_PER_PAGE);

    const deep = await root([link("/n1")]);
    let current = deep.id;
    // Cada volta termina a página do nível anterior: a do último nível não leva a mais nada.
    for (let depth = 1; depth <= FUNNEL_MAX_DEPTH + 1; depth++) {
      const r = current === deep.id ? await expandFunnel(current) : await finish(current, [link(`/n${depth}`)]);
      if (depth === FUNNEL_MAX_DEPTH + 1) {
        expect(r.created).toEqual([]);
        break;
      }
      expect(r.created).toHaveLength(1);
      current = r.created[0];
    }
  });

  it("sem a caixa do funil inteiro, nada entra sozinho; parar cancela a fila e o funil não cresce mais", async () => {
    const plain = await root([link("/a")], {});
    expect((await expandFunnel(plain.id)).created).toEqual([]);

    const main = await root([link("/a"), link("/b")]);
    const { created } = await expandFunnel(main.id);
    expect(await stopFunnel(main.id)).toEqual({ canceled: 2 });
    expect(funnelOptions((await prisma.cloneJob.findUniqueOrThrow({ where: { id: main.id } })).options)).toMatchObject({
      funnelStopped: true,
    });
    // Uma página que já estava rodando e termina depois do "Parar" não põe mais nada na fila.
    await prisma.cloneJob.update({ where: { id: created[0] }, data: { status: "RUNNING" } });
    expect((await finish(created[0], [link("/c")])).created).toEqual([]);
  });

  it("página colada à mão segue o funil e a nova tentativa fica no mesmo lugar do mapa", async () => {
    const main = await root([]);
    const [pasted] = await startFunnelClones(main.id, [`${SITE}/upsell-1`]);
    const job = await prisma.cloneJob.findUniqueOrThrow({ where: { id: pasted } });
    expect(funnelOptions(job.options)).toMatchObject({
      funnel: true,
      step: { from: main.id, depth: 1, via: "manual" },
    });

    // Falhou: a nova tentativa herda de onde veio.
    const auto = await root([link("/x", { via: "click", label: "Continuar" })]);
    const [x] = (await expandFunnel(auto.id)).created;
    await prisma.cloneJob.update({ where: { id: x }, data: { status: "FAILED" } });
    await retryClone(x);
    const retried = await prisma.cloneJob.findFirstOrThrow({
      where: { parentJobId: auto.id, status: "QUEUED" },
    });
    expect(funnelOptions(retried.options).step).toMatchObject({ from: auto.id, via: "click", label: "Continuar" });
  });
});
