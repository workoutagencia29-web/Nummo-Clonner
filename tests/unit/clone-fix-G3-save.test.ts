/**
 * Correções da revisão da Fase 2 (grupo G3): salvar a clonagem, funil e
 * status. Clonagens sintéticas (resultado + HTML no storage), sem navegador.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import type { CloneStatus as JobStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { resolvePreviewToken } from "@/lib/preview";
import { deleteObject, putObject } from "@/lib/storage";
import {
  clonePreviewUrlAction,
  saveCloneAction,
  startFunnelClonesAction,
  startHtmlCloneAction,
} from "@/server/actions/clone";
import {
  cancelClone,
  FUNNEL_LIMIT_MESSAGE,
  funnelMatchKey,
  getCloneStatus,
  restoreSnippets,
  retryClone,
  saveClone,
  startFunnelClones,
} from "@/server/services/clone";
import type { CloneModeValue, CloneResult, Device, FunnelSuggestion, RemovedTracker } from "@/worker/clone/types";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";

const written = new Set<string>();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  for (const key of written) await deleteObject(key).catch(() => {});
});

async function put(key: string, data: string) {
  await putObject(key, data);
  written.add(key);
}

const page = (body: string, title = "Página") =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

interface JobSpec {
  source?: "URL" | "ZIP" | "HTML";
  sourceUrl?: string | null;
  finalUrl: string;
  title?: string;
  editable?: string;
  preserve?: string;
  assetMap?: Record<string, string>;
  devices?: Device[];
  funnel?: FunnelSuggestion[];
  removed?: RemovedTracker[];
  parentJobId?: string;
  status?: JobStatus;
  uploadKey?: string | null;
  options?: Record<string, unknown>;
}

/** Cria uma clonagem pronta (ou no status pedido) com os HTMLs gravados no storage. */
async function makeJob(spec: JobSpec) {
  const job = await prisma.cloneJob.create({
    data: {
      source: spec.source ?? "URL",
      sourceUrl: spec.sourceUrl === undefined ? spec.finalUrl : spec.sourceUrl,
      uploadKey: spec.uploadKey ?? null,
      status: spec.status ?? "REVIEW",
      parentJobId: spec.parentJobId ?? null,
      options: (spec.options ?? { devices: spec.devices ?? ["desktop"], maxVideoMb: 20 }) as object,
    },
  });
  const devices: CloneResult["devices"] = {};
  for (const device of spec.devices ?? ["desktop"]) {
    const outputs = {} as Record<CloneModeValue, string>;
    for (const mode of ["EDITABLE", "PRESERVE_JS"] as const) {
      const key = `clones/${job.id}/${device}-${mode.toLowerCase()}.html`;
      await put(key, mode === "EDITABLE" ? (spec.editable ?? page("<p>oi</p>")) : (spec.preserve ?? page("<p>oi</p>")));
      outputs[mode] = key;
    }
    devices[device] = {
      outputs: {
        EDITABLE: { htmlKey: outputs.EDITABLE },
        PRESERVE_JS: { htmlKey: outputs.PRESERVE_JS, assetMap: spec.assetMap ?? {} },
      },
    };
  }
  const result: CloneResult = {
    title: spec.title ?? "Página",
    finalUrl: spec.finalUrl,
    responsive: true,
    devices,
    removed: spec.removed ?? [],
    checkouts: [],
    funnel: spec.funnel ?? [],
    videos: [],
    delay: null,
    warnings: [],
    suggestedMode: "EDITABLE",
    assets: [],
    stats: { assets: 0, bytes: 0, failed: 0, blockedRequests: 0, durationMs: 1 },
  };
  await prisma.cloneJob.update({ where: { id: job.id }, data: { result: result as object } });
  return job;
}

const saveInput = (jobId: string, extra: Partial<Parameters<typeof saveClone>[0]> = {}) => ({
  jobId,
  name: "Oferta",
  folderId: null,
  mode: "EDITABLE" as const,
  keepRemoved: [],
  childJobIds: [],
  ...extra,
});

async function savedDocs(offerId: string) {
  const pages = await prisma.page.findMany({
    where: { offerId },
    orderBy: { position: "asc" },
    include: { variants: { include: { documents: true } } },
  });
  return pages.map((p) => ({ page: p, html: p.variants[0]?.documents[0]?.html ?? "" }));
}

function attr(html: string, id: string, name = "href") {
  const m = new RegExp(`<a[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? "";
  return new RegExp(`${name}="([^"]*)"`).exec(m)?.[1];
}

describe("data#0 — Preservar JS: links do funil e links relativos", () => {
  it("links relativos para páginas do funil viram os-page; os outros apontam para o site original", async () => {
    const main = await makeJob({
      finalUrl: "https://loja.exemplo.com/vendas/",
      assetMap: { "/files/ebook.pdf": "a/ab/ab.pdf" },
      preserve: page(`
        <a id="up" href="/upsell">Upsell</a>
        <a id="up2" href="../upsell/index.html?ttclid=9">Upsell de novo</a>
        <a id="ext" href="https://www.loja.exemplo.com/upsell/?utm_source=fb">Upsell absoluto</a>
        <a id="ty" href="obrigado.html">Obrigado</a>
        <a id="pol" href="/politica-de-privacidade/">Política</a>
        <a id="pdf" href="/files/ebook.pdf">E-book</a>
        <a id="hash" href="#oferta">Oferta</a>
        <a id="q" href="?passo=2">Passo 2</a>
        <a id="mail" href="mailto:contato@exemplo.com">E-mail</a>`),
    });
    const upsell = await makeJob({
      sourceUrl: "https://loja.exemplo.com/upsell",
      finalUrl: "https://loja.exemplo.com/upsell",
      parentJobId: main.id,
      preserve: page(`<a id="home" href="/vendas/">Voltar</a><a id="other" href="obrigado.html">Outra</a>`),
    });
    const thanks = await makeJob({
      finalUrl: "https://loja.exemplo.com/vendas/obrigado.html",
      parentJobId: main.id,
    });
    const offer = await saveClone(saveInput(main.id, { mode: "PRESERVE_JS", childJobIds: [upsell.id, thanks.id] }));
    const [home, up, ty] = await savedDocs(offer.id);
    expect(home.page.isHome).toBe(true);
    const upPage = [up, ty].find((d) => d.page.sourceUrl === "https://loja.exemplo.com/upsell");
    const tyPage = [up, ty].find((d) => d.page.sourceUrl?.endsWith("obrigado.html"));
    if (!upPage || !tyPage) throw new Error("páginas do funil não foram salvas");

    expect(attr(home.html, "up")).toBe(`os-page:${upPage.page.id}`);
    expect(attr(home.html, "up2")).toBe(`os-page:${upPage.page.id}`);
    expect(attr(home.html, "ext")).toBe(`os-page:${upPage.page.id}`);
    expect(attr(home.html, "ty")).toBe(`os-page:${tyPage.page.id}`);
    // Página não clonada: vai para o site original (como no modo Editável).
    expect(attr(home.html, "pol")).toBe("https://loja.exemplo.com/politica-de-privacidade/");
    // Arquivo que está na cópia, âncoras, consultas e e-mail ficam como estão.
    expect(attr(home.html, "pdf")).toBe("/files/ebook.pdf");
    expect(attr(home.html, "hash")).toBe("#oferta");
    expect(attr(home.html, "q")).toBe("?passo=2");
    expect(attr(home.html, "mail")).toBe("mailto:contato@exemplo.com");
    // Do upsell, "/vendas/" volta para a página principal.
    expect(attr(upPage.html, "home")).toBe(`os-page:${home.page.id}`);
    expect(attr(upPage.html, "other")).toBe("https://loja.exemplo.com/obrigado.html");
  });

  it("modo Editável: links relativos não são alterados (já vêm resolvidos pelo clonador)", async () => {
    const main = await makeJob({
      finalUrl: "https://loja.exemplo.com/",
      editable: page(
        `<a id="rel" href="/os-assets/abc.pdf">PDF</a><a id="up" href="https://loja.exemplo.com/upsell">Up</a>`,
      ),
    });
    const upsell = await makeJob({ finalUrl: "https://loja.exemplo.com/upsell", parentJobId: main.id });
    const offer = await saveClone(saveInput(main.id, { childJobIds: [upsell.id] }));
    const [home, up] = await savedDocs(offer.id);
    expect(attr(home.html, "rel")).toBe("/os-assets/abc.pdf");
    expect(attr(home.html, "up")).toBe(`os-page:${up.page.id}`);
  });
});

describe("data#2 — salvar duas vezes ao mesmo tempo", () => {
  it("cria uma oferta só; o segundo clique recebe uma mensagem clara", async () => {
    const main = await makeJob({ finalUrl: "https://loja.exemplo.com/" });
    const child = await makeJob({ finalUrl: "https://loja.exemplo.com/upsell", parentJobId: main.id });
    const input = saveInput(main.id, { childJobIds: [child.id] });
    const results = await Promise.allSettled([saveClone(input), saveClone(input)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as Error).message).toBe("Esta clonagem já foi salva como oferta.");
    expect(await prisma.offer.count()).toBe(1);
    expect(await prisma.page.count()).toBe(2);
    const offer = (results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ id: string }>).value;
    const jobs = await prisma.cloneJob.findMany({ select: { status: true, offerId: true } });
    expect(jobs.every((j) => j.status === "SAVED" && j.offerId === offer.id)).toBe(true);
  });
});

describe("data#3 — rastreador mantido com $', $&, $` ou $$ no código", () => {
  it("restoreSnippets insere o trecho literalmente", () => {
    const html = page("<p>oi</p>");
    const head = `<script>var p='R$'+x;var q="$&$$$\`";</script>`;
    const body = `<script>fbq('track', "R$'")</script>`;
    const out = restoreSnippets(html, [
      { snippet: head, location: "head" },
      { snippet: body, location: "body" },
    ]);
    expect(out).toContain(`${head}\n</head>`);
    expect(out).toContain(`${body}\n</body>`);
    expect(out.match(/<body/g)).toHaveLength(1);
  });

  it("ao salvar, a página continua íntegra", async () => {
    const snippet = `<script>window.Tawk_API={};var preco='R$'+valor;</script>`;
    const main = await makeJob({
      finalUrl: "https://loja.exemplo.com/",
      removed: [{ vendor: "Tawk.to", category: "CHAT", snippet, location: "head", kind: "script-inline" }],
    });
    const offer = await saveClone(saveInput(main.id, { keepRemoved: [`${main.id}:0`] }));
    const [home] = await savedDocs(offer.id);
    expect(home.html).toContain(snippet);
    expect(home.html.match(/<body/g)).toHaveLength(1);
    expect(home.html).toContain("<p>oi</p>");
  });
});

describe("refix 1 da Fase 4 — rastreador mantido na revisão espera o 'Aceitar'", () => {
  it("pixels/análise mantidos vão para os códigos da página (Marketing); chats voltam ao HTML", async () => {
    const meta = `<script>fbq('init','123456789012345');fbq('track','PageView');var preco='R$'+1;</script>`;
    const noscript = `<noscript><img src="https://www.facebook.com/tr?id=123456789012345&ev=PageView&noscript=1"></noscript>`;
    const rd = `<script async src="https://d335luupugsy2.cloudfront.net/js/loader-scripts/abc-loader.js"></script>`;
    const chat = `<script src="https://embed.tawk.to/abc/default" async></script>`;
    const main = await makeJob({
      finalUrl: "https://loja.exemplo.com/",
      removed: [
        { vendor: "Meta Pixel", category: "PIXEL", snippet: meta, location: "head", kind: "script-inline" },
        { vendor: "Meta Pixel", category: "PIXEL", snippet: noscript, location: "body", kind: "noscript" },
        { vendor: "RD Station", category: "CHAT", snippet: rd, location: "body", kind: "script-src" },
        { vendor: "Tawk.to", category: "CHAT", snippet: chat, location: "body", kind: "script-src" },
      ],
    });
    const offer = await saveClone(saveInput(main.id, { keepRemoved: [0, 1, 2, 3].map((i) => `${main.id}:${i}`) }));
    const [home] = await savedDocs(offer.id);
    expect(home.html).not.toContain("fbq(");
    expect(home.html).not.toContain("facebook.com/tr");
    expect(home.html).not.toContain("loader-scripts");
    expect(home.html).toContain(chat);
    expect(home.page.customCode).toEqual({
      head: meta,
      bodyStart: "",
      bodyEnd: `${noscript}\n${rd}`,
      category: "MARKETING",
    });
    // Continuam marcados como mantidos.
    expect(await prisma.removedItem.count({ where: { pageId: home.page.id, restored: true } })).toBe(4);
  });

  it("nada mantido: a página fica sem código próprio", async () => {
    const main = await makeJob({
      finalUrl: "https://loja.exemplo.com/",
      removed: [
        {
          vendor: "Meta Pixel",
          category: "PIXEL",
          snippet: "<script>fbq('init','1')</script>",
          location: "head",
          kind: "script-inline",
        },
      ],
    });
    const offer = await saveClone(saveInput(main.id));
    const [home] = await savedDocs(offer.id);
    expect(home.page.customCode).toEqual({});
  });
});

describe("data#13 / ux#11 — oferta da clonagem excluída ou na lixeira", () => {
  it("oferta excluída de vez: dá para salvar de novo (com as páginas do funil)", async () => {
    const main = await makeJob({ finalUrl: "https://loja.exemplo.com/" });
    const child = await makeJob({ finalUrl: "https://loja.exemplo.com/upsell", parentJobId: main.id });
    const first = await saveClone(saveInput(main.id, { childJobIds: [child.id] }));
    await prisma.offer.delete({ where: { id: first.id } });
    const orphan = await prisma.cloneJob.findUniqueOrThrow({ where: { id: main.id } });
    expect(orphan).toMatchObject({ status: "SAVED", offerId: null });

    const second = await saveClone(saveInput(main.id, { childJobIds: [child.id] }));
    expect(second.id).not.toBe(first.id);
    expect(await prisma.page.count({ where: { offerId: second.id } })).toBe(2);
    const jobs = await prisma.cloneJob.findMany({ select: { status: true, offerId: true } });
    expect(jobs.every((j) => j.status === "SAVED" && j.offerId === second.id)).toBe(true);
    // E não salva uma terceira vez.
    await expectUserError(saveClone(saveInput(main.id)), "Esta clonagem já foi salva como oferta.");
  });

  it("oferta na lixeira: explica que está na lixeira", async () => {
    const main = await makeJob({ finalUrl: "https://loja.exemplo.com/" });
    const offer = await saveClone(saveInput(main.id));
    await prisma.offer.update({ where: { id: offer.id }, data: { deletedAt: new Date() } });
    await expectUserError(saveClone(saveInput(main.id)), /lixeira/);
  });

  it("arquivos da clonagem apagados: mensagem clara em vez de erro técnico", async () => {
    const main = await makeJob({ finalUrl: "https://loja.exemplo.com/" });
    const r = (await prisma.cloneJob.findUniqueOrThrow({ where: { id: main.id } })).result as unknown as CloneResult;
    await deleteObject(r.devices.desktop?.outputs.EDITABLE.htmlKey as string);
    await expectUserError(saveClone(saveInput(main.id)), /apagados para liberar espaço/);
    expect(await prisma.offer.count()).toBe(0);
  });
});

describe("security#3 — ZIP e HTML colado não vazam o endereço interno", () => {
  it("ZIP: oferta e página sem 'página original' e sem o domínio interno como nome", async () => {
    const main = await makeJob({
      source: "ZIP",
      sourceUrl: null,
      finalUrl: "http://importado.offerstudio/P%C3%A1gina.html",
      title: "importado.offerstudio",
      preserve: page(`<a id="rel" href="obrigado.html">Obrigado</a>`),
      options: { devices: ["desktop"], maxVideoMb: 20, fileName: "Página.zip" },
    });
    const offer = await saveClone(saveInput(main.id, { mode: "PRESERVE_JS" }));
    const saved = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(saved.sourceUrl).toBeNull();
    const [home] = await savedDocs(offer.id);
    expect(home.page.sourceUrl).toBeNull();
    expect(home.page.name).toBe("Página principal");
    // Link relativo continua relativo (nunca vira http://importado.offerstudio/…).
    expect(attr(home.html, "rel")).toBe("obrigado.html");
    expect(home.html).not.toContain("offerstudio");
  });

  it("HTML colado com link de origem: guarda o link real", async () => {
    const main = await makeJob({
      source: "HTML",
      sourceUrl: "https://real.exemplo.com/oferta",
      finalUrl: "https://real.exemplo.com/oferta",
    });
    const offer = await saveClone(saveInput(main.id));
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).sourceUrl).toBe(
      "https://real.exemplo.com/oferta",
    );
  });

  it("sugestões de funil do endereço interno não podem ser clonadas pelo link", async () => {
    const main = await makeJob({ source: "ZIP", sourceUrl: null, finalUrl: "http://importado.offerstudio/index.html" });
    await expectUserError(
      startFunnelClones(main.id, ["http://importado.offerstudio/upsell.html"]),
      /arquivo importado/,
      "url",
    );
    expect(await prisma.cloneJob.count({ where: { parentJobId: main.id } })).toBe(0);
  });
});

describe("data#10 — uma regra só para comparar endereços do funil", () => {
  it("funnelMatchKey ignora www, barra final, index.html, #hash, http/https e parâmetros de rastreamento", () => {
    const key = funnelMatchKey("https://loja.exemplo.com/upsell");
    for (const variant of [
      "https://loja.exemplo.com/upsell/",
      "http://www.loja.exemplo.com/upsell",
      "https://loja.exemplo.com/upsell/index.html",
      "https://loja.exemplo.com/Upsell/index.php#topo",
      "https://loja.exemplo.com/upsell?utm_source=fb&fbclid=1&ttclid=2&msclkid=3&_gl=4&gbraid=5",
    ]) {
      expect(funnelMatchKey(variant), variant).toBe(key);
    }
    expect(funnelMatchKey("/upsell/", "https://loja.exemplo.com/vendas")).toBe(key);
    expect(funnelMatchKey("https://loja.exemplo.com/upsell?plano=2")).not.toBe(key);
    expect(funnelMatchKey("mailto:x@y.com")).toBeNull();
  });

  it("não clona a mesma página duas vezes nem a própria página principal", async () => {
    const main = await makeJob({ finalUrl: "https://loja.exemplo.com/vendas" });
    const created = await startFunnelClones(main.id, [
      "loja.exemplo.com/upsell",
      "https://loja.exemplo.com/upsell/",
      "https://www.loja.exemplo.com/upsell/index.html?utm_source=x&ttclid=2",
      "https://loja.exemplo.com/vendas/",
    ]);
    expect(created).toHaveLength(1);
    expect(await startFunnelClones(main.id, ["https://loja.exemplo.com/upsell?fbclid=1"])).toEqual([]);
    expect(await prisma.cloneJob.count({ where: { parentJobId: main.id } })).toBe(1);
  });

  it("pedidos simultâneos não duplicam a página", async () => {
    const main = await makeJob({ finalUrl: "https://loja.exemplo.com/vendas" });
    await Promise.all([
      startFunnelClones(main.id, ["https://loja.exemplo.com/upsell"]),
      startFunnelClones(main.id, ["https://loja.exemplo.com/upsell/"]),
    ]);
    expect(await prisma.cloneJob.count({ where: { parentJobId: main.id } })).toBe(1);
  });

  it("links com index.html ou ttclid para a página do funil viram os-page ao salvar", async () => {
    const main = await makeJob({
      finalUrl: "https://loja.exemplo.com/",
      editable: page(`<a id="a" href="https://loja.exemplo.com/upsell/index.html?ttclid=9">Up</a>`),
      funnel: [{ url: "https://loja.exemplo.com/upsell", label: "Kit", kind: "UPSELL", reason: "" }],
    });
    const child = await makeJob({ finalUrl: "https://loja.exemplo.com/upsell/", parentJobId: main.id, title: "" });
    const offer = await saveClone(saveInput(main.id, { childJobIds: [child.id] }));
    const [home, up] = await savedDocs(offer.id);
    expect(attr(home.html, "a")).toBe(`os-page:${up.page.id}`);
    // A sugestão foi reconhecida (tipo e nome) mesmo com a barra final.
    expect(up.page.type).toBe("UPSELL");
    expect(up.page.name).toBe("Kit");
  });
});

describe("data#11 — limite de 15 páginas do funil", () => {
  async function children(parentJobId: string, n: number, status: JobStatus = "REVIEW") {
    for (let i = 0; i < n; i++) {
      await prisma.cloneJob.create({
        data: { source: "URL", sourceUrl: `https://loja.exemplo.com/p${status}${i}`, parentJobId, status },
      });
    }
  }

  it("a 16ª página é recusada com uma mensagem que explica o limite", async () => {
    const main = await makeJob({ finalUrl: "https://loja.exemplo.com/" });
    await children(main.id, 15);
    await expectUserError(
      startFunnelClones(main.id, ["https://loja.exemplo.com/extra"]),
      new RegExp(FUNNEL_LIMIT_MESSAGE),
    );
    // Falhas e canceladas não contam.
    const other = await makeJob({ finalUrl: "https://outra.exemplo.com/" });
    await children(other.id, 14);
    await children(other.id, 3, "FAILED");
    await expectUserError(
      startFunnelClones(other.id, ["https://outra.exemplo.com/a", "https://outra.exemplo.com/b"]),
      /ainda pode adicionar 1 página/,
    );
    expect(await startFunnelClones(other.id, ["https://outra.exemplo.com/a"])).toHaveLength(1);
  });

  it("as ações explicam o limite em português (sem a mensagem técnica do zod)", async () => {
    const main = await makeJob({ finalUrl: "https://loja.exemplo.com/" });
    const urls = Array.from({ length: 16 }, (_, i) => `https://loja.exemplo.com/p${i}`);
    const start = await startFunnelClonesAction({ parentId: main.id, urls });
    expect(start).toMatchObject({ ok: false });
    expect(!start.ok && start.error).toContain(FUNNEL_LIMIT_MESSAGE);
    const save = await saveCloneAction({
      jobId: main.id,
      name: "X",
      mode: "EDITABLE",
      childJobIds: Array.from({ length: 16 }, (_, i) => `c${i}`),
    });
    expect(!save.ok && save.error).toContain(FUNNEL_LIMIT_MESSAGE);
  });
});

describe("data#14 — tela de falha mostra o fim do log", () => {
  it("getCloneStatus(tail) devolve as últimas linhas, em ordem", async () => {
    const job = await prisma.cloneJob.create({
      data: { source: "URL", sourceUrl: "https://x.exemplo.com/", status: "FAILED" },
    });
    await prisma.cloneLog.createMany({
      data: Array.from({ length: 250 }, (_, i) => ({
        jobId: job.id,
        level: i === 249 ? ("ERROR" as const) : ("WARN" as const),
        message: `linha ${i + 1}`,
      })),
    });
    const status = await getCloneStatus(job.id, 0, { tail: true });
    expect(status?.logs).toHaveLength(200);
    expect(status?.logs[0].message).toBe("linha 51");
    expect(status?.logs.at(-1)?.message).toBe("linha 250");
    // Sem tail: continua a partir do começo (tela de progresso).
    expect((await getCloneStatus(job.id))?.logs[0].message).toBe("linha 1");
  });
});

describe("data#8 / security#6 / ux#12 — prévia de página do funil só de celular", () => {
  it("a prévia abre a versão que existe", async () => {
    const main = await makeJob({ finalUrl: "https://loja.exemplo.com/", devices: ["mobile"] });
    const child = await makeJob({ finalUrl: "https://loja.exemplo.com/up", devices: ["mobile"], parentJobId: main.id });
    const status = await getCloneStatus(main.id);
    expect(status?.children[0].devices).toEqual(["mobile"]);
    const res = await clonePreviewUrlAction({ jobId: child.id, device: "desktop", mode: "EDITABLE" });
    if (!res.ok) throw new Error(res.error);
    const token = /^http:\/\/([a-z2-7]+)\.localhost/.exec(res.data.url)?.[1] as string;
    expect(await resolvePreviewToken(token)).toMatchObject({ kind: "clone", jobId: child.id, device: "mobile" });
  });
});

describe("data#7 / data#9 / ux#3 — páginas do funil: cancelar e tentar de novo", () => {
  it("cancela uma página do funil na fila sem mexer na principal", async () => {
    const main = await makeJob({ finalUrl: "https://loja.exemplo.com/" });
    const [childId] = await startFunnelClones(main.id, ["https://loja.exemplo.com/upsell"]);
    expect(await cancelClone(childId)).toBe(true);
    expect((await prisma.cloneJob.findUniqueOrThrow({ where: { id: childId } })).status).toBe("CANCELED");
    expect((await prisma.cloneJob.findUniqueOrThrow({ where: { id: main.id } })).status).toBe("REVIEW");
  });

  it("página que falhou pode ser clonada de novo (pela sugestão ou por 'Tentar de novo')", async () => {
    const main = await makeJob({ finalUrl: "https://loja.exemplo.com/" });
    const [first] = await startFunnelClones(main.id, ["https://loja.exemplo.com/upsell"]);
    await prisma.cloneJob.update({ where: { id: first }, data: { status: "FAILED", errorMessage: "Falhou." } });
    const retried = await retryClone(first);
    expect(retried.id).toBe(main.id);
    const kids = await prisma.cloneJob.findMany({ where: { parentJobId: main.id }, orderBy: { createdAt: "asc" } });
    expect(kids.map((k) => k.status)).toEqual(["FAILED", "QUEUED"]);
    const status = await getCloneStatus(main.id);
    expect(new Set(status?.children.map((c) => c.matchKey))).toEqual(new Set(["loja.exemplo.com/upsell"]));
  });

  it("'Tentar de novo' com o ZIP já apagado explica o que fazer", async () => {
    const job = await prisma.cloneJob.create({
      data: { source: "ZIP", uploadKey: "uploads/nao-existe.zip", status: "FAILED" },
    });
    await expectUserError(retryClone(job.id), /Envie o arquivo de novo/);
  });
});

describe("ux#18 — HTML colado grande demais", () => {
  it("o limite é em bytes, com a mensagem em português", async () => {
    // 5,3 milhões de "é" = 10,6 MB em UTF-8 (abaixo do limite em caracteres).
    const html = `<p>${"é".repeat(5_300_000)}</p>`;
    const res = await startHtmlCloneAction({ html, baseUrl: null });
    expect(res).toEqual({
      ok: false,
      error: "O HTML pode ter no máximo 10 MB. Para páginas maiores, use o ZIP.",
      field: "html",
    });
  });

  it("os limites do corpo das ações ficam acima do HTML máximo já escapado em JSON", async () => {
    const { default: config } = await import("../../next.config");
    const mb = (v: unknown) => Number.parseInt(String(v), 10);
    expect(mb(config.experimental?.proxyClientMaxBodySize)).toBeGreaterThanOrEqual(20);
    expect(mb(config.experimental?.serverActions?.bodySizeLimit)).toBeGreaterThanOrEqual(20);
  });
});
