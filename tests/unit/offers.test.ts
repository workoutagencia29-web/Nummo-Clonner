import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { toUserMessage } from "@/lib/errors";
import { internalLink, referencedPageIds } from "@/lib/internal-links";
import { packProject, unpackProject } from "@/lib/project-data";
import {
  createOffer,
  deleteOfferForever,
  duplicateOffer,
  emptyTrash,
  listOffers,
  listTrashedOffers,
  restoreOffer,
  setOfferTags,
  trashOffer,
  updateOffer,
} from "@/server/services/offers";
import { createFolder, createTag } from "@/server/services/organize";
import { createPage } from "@/server/services/pages";
import { resetDatabase } from "../setup/per-file";
import { expectPrismaError, expectUserError, fakeId } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

async function tagIdsOf(offerId: string) {
  const rows = await prisma.offerTag.findMany({ where: { offerId }, select: { tagId: true } });
  return rows.map((r) => r.tagId).sort();
}

/** Fixa as datas para a ordenação ser determinística. */
async function setDates(id: string, createdAt: string, updatedAt: string) {
  await prisma.offer.update({
    where: { id },
    data: { createdAt: new Date(createdAt), updatedAt: new Date(updatedAt) },
  });
}

describe("createOffer", () => {
  it("cria a oferta com a página principal, variação A e documento em branco", async () => {
    const { id } = await createOffer({ name: "Oferta <Teste> & Cia", notes: "" });

    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id },
      include: { tags: true, pages: { include: { variants: { include: { documents: true } } } } },
    });
    expect(offer).toMatchObject({
      name: "Oferta <Teste> & Cia",
      notes: null,
      status: "DRAFT",
      folderId: null,
      liveUrl: null,
      deletedAt: null,
      tags: [],
    });
    expect(offer.pages).toHaveLength(1);
    const [page] = offer.pages;
    expect(page).toMatchObject({
      name: "Página principal",
      slug: "principal",
      isHome: true,
      position: 0,
      type: "SALES",
    });
    expect(page.variants).toHaveLength(1);
    const [variant] = page.variants;
    expect(variant).toMatchObject({ name: "A", isControl: true, weight: 100 });
    expect(variant.documents).toHaveLength(1);
    const [doc] = variant.documents;
    expect(doc).toMatchObject({ device: "ALL", project: null, revision: 0 });
    expect(doc.html).toContain("<!doctype html>");
    expect(doc.html).toContain('<html lang="pt-BR">');
    // O nome vai escapado para o <title>.
    expect(doc.html).toContain("<title>Oferta &#60;Teste&#62; &#38; Cia</title>");
  });

  it("associa pasta, tags e notas", async () => {
    const folder = await createFolder("Nutra");
    const a = await createTag("Saúde");
    const b = await createTag("Finanças");
    const { id } = await createOffer({ name: "Oferta", folderId: folder.id, tagIds: [a.id, b.id], notes: "Anotação" });

    const offer = await prisma.offer.findUniqueOrThrow({ where: { id } });
    expect(offer).toMatchObject({ folderId: folder.id, notes: "Anotação" });
    expect(await tagIdsOf(id)).toEqual([a.id, b.id].sort());
  });

  it("ignora tags repetidas na lista", async () => {
    const tag = await createTag("Saúde");
    const { id } = await createOffer({ name: "Oferta", tagIds: [tag.id, tag.id] });
    expect(await tagIdsOf(id)).toEqual([tag.id]);
  });

  it("recusa pasta inexistente com erro em português no campo folderId", async () => {
    await expectUserError(
      createOffer({ name: "Oferta", folderId: "nao-existe" }),
      "A pasta escolhida não existe mais.",
      "folderId",
    );
    expect(await prisma.offer.count()).toBe(0);
  });

  it("recusa tag inexistente com erro em português no campo tagIds", async () => {
    const tag = await createTag("Saúde");
    await expectUserError(
      createOffer({ name: "Oferta", tagIds: [tag.id, "nao-existe"] }),
      "Alguma tag escolhida não existe mais.",
      "tagIds",
    );
    expect(await prisma.offer.count()).toBe(0);
  });
});

describe("listOffers", () => {
  async function scenario() {
    const nutra = await createFolder("Nutra");
    const saude = await createTag("Saúde");
    const financas = await createTag("Finanças");

    const emagrecimento = await createOffer({
      name: "Emagrecimento Rápido",
      notes: "Público feminino 35+",
      folderId: nutra.id,
      tagIds: [saude.id],
    });
    await updateOffer({ id: emagrecimento.id, status: "LIVE", liveUrl: "https://www.emagrece.com.br/oferta" });
    const curso = await createOffer({ name: "Curso de Investimentos", tagIds: [financas.id] });
    const abaco = await createOffer({ name: "Ábaco Mágico" });
    await updateOffer({ id: abaco.id, status: "ARCHIVED" });
    const lixo = await createOffer({ name: "Emagrecimento na lixeira", folderId: nutra.id, tagIds: [saude.id] });
    await trashOffer(lixo.id);

    // criação: emagrecimento < curso < abaco ; modificação: abaco < emagrecimento < curso
    await setDates(emagrecimento.id, "2026-01-01T10:00:00Z", "2026-03-02T10:00:00Z");
    await setDates(curso.id, "2026-01-02T10:00:00Z", "2026-03-03T10:00:00Z");
    await setDates(abaco.id, "2026-01-03T10:00:00Z", "2026-03-01T10:00:00Z");

    return { nutra, saude, financas, emagrecimento: emagrecimento.id, curso: curso.id, abaco: abaco.id, lixo: lixo.id };
  }

  async function ids(filters: Parameters<typeof listOffers>[0]) {
    return (await listOffers(filters)).map((o) => o.id);
  }

  it("lista só ofertas fora da lixeira, das mais recentes para as mais antigas", async () => {
    const s = await scenario();
    expect(await ids({})).toEqual([s.curso, s.emagrecimento, s.abaco]);
    expect(await ids({ sort: "recentes" })).toEqual([s.curso, s.emagrecimento, s.abaco]);
  });

  it("traz os dados do card", async () => {
    const s = await scenario();
    const [card] = await listOffers({ q: "emagrecimento" });
    expect(card).toMatchObject({
      id: s.emagrecimento,
      name: "Emagrecimento Rápido",
      status: "LIVE",
      liveUrl: "https://www.emagrece.com.br/oferta",
      folder: { id: s.nutra.id, name: "Nutra" },
      tags: [{ tag: { id: s.saude.id, name: "Saúde", color: "slate" } }],
      _count: { pages: 1 },
    });
  });

  it("ordena por data de criação", async () => {
    const s = await scenario();
    expect(await ids({ sort: "criacao" })).toEqual([s.abaco, s.curso, s.emagrecimento]);
  });

  it("ordena por nome respeitando acentos (Á junto do A)", async () => {
    const s = await scenario();
    expect(await ids({ sort: "nome" })).toEqual([s.abaco, s.curso, s.emagrecimento]);
  });

  it("filtra por pasta e por “sem pasta”", async () => {
    const s = await scenario();
    expect(await ids({ folder: s.nutra.id })).toEqual([s.emagrecimento]);
    expect(await ids({ folder: "sem-pasta" })).toEqual([s.curso, s.abaco]);
  });

  it("filtra por tag e por status", async () => {
    const s = await scenario();
    expect(await ids({ tag: s.saude.id })).toEqual([s.emagrecimento]);
    expect(await ids({ tag: s.financas.id })).toEqual([s.curso]);
    expect(await ids({ status: "LIVE" })).toEqual([s.emagrecimento]);
    expect(await ids({ status: "ARCHIVED" })).toEqual([s.abaco]);
    expect(await ids({ status: "DRAFT" })).toEqual([s.curso]);
  });

  it("busca sem diferenciar acentos/maiúsculas, com vários termos, em nome, notas e tags", async () => {
    const s = await scenario();
    expect(await ids({ q: "rapido" })).toEqual([s.emagrecimento]);
    expect(await ids({ q: "RÁPIDO" })).toEqual([s.emagrecimento]);
    expect(await ids({ q: "publico" })).toEqual([s.emagrecimento]); // notas
    expect(await ids({ q: "SAUDE" })).toEqual([s.emagrecimento]); // tag
    expect(await ids({ q: "financas curso" })).toEqual([s.curso]); // tag + nome
    expect(await ids({ q: "  feminino   emagrecimento " })).toEqual([s.emagrecimento]);
    expect(await ids({ q: "magico abaco" })).toEqual([s.abaco]);
    expect(await ids({ q: "emagrece.com" })).toEqual([s.emagrecimento]); // URL no ar
    // Todos os termos precisam aparecer na mesma oferta.
    expect(await ids({ q: "feminino investimentos" })).toEqual([]);
    // Ofertas na lixeira não aparecem na busca.
    expect(await ids({ q: "lixeira" })).toEqual([]);
    // Busca vazia não filtra.
    expect(await ids({ q: "   " })).toEqual([s.curso, s.emagrecimento, s.abaco]);
  });

  it("combina filtros", async () => {
    const s = await scenario();
    expect(await ids({ folder: "sem-pasta", q: "curso" })).toEqual([s.curso]);
    expect(await ids({ folder: s.nutra.id, status: "DRAFT" })).toEqual([]);
    expect(await ids({ tag: s.saude.id, q: "rapido", sort: "nome" })).toEqual([s.emagrecimento]);
  });
});

describe("updateOffer", () => {
  it("atualiza nome, notas, status e endereço no ar", async () => {
    const { id } = await createOffer({ name: "Oferta" });
    await updateOffer({ id, name: "Oferta nova", notes: "Notas", status: "LIVE", liveUrl: "https://x.com" });
    expect(await prisma.offer.findUniqueOrThrow({ where: { id } })).toMatchObject({
      name: "Oferta nova",
      notes: "Notas",
      status: "LIVE",
      liveUrl: "https://x.com",
    });

    // Texto vazio vira null; campos omitidos não mudam.
    await updateOffer({ id, notes: "", liveUrl: "" });
    expect(await prisma.offer.findUniqueOrThrow({ where: { id } })).toMatchObject({
      name: "Oferta nova",
      notes: null,
      status: "LIVE",
      liveUrl: null,
    });
  });

  it("move para uma pasta e tira da pasta", async () => {
    const folder = await createFolder("Nutra");
    const { id } = await createOffer({ name: "Oferta" });
    await updateOffer({ id, folderId: folder.id });
    expect((await prisma.offer.findUniqueOrThrow({ where: { id } })).folderId).toBe(folder.id);
    await updateOffer({ id, folderId: null });
    expect((await prisma.offer.findUniqueOrThrow({ where: { id } })).folderId).toBeNull();
  });

  it("recusa pasta inexistente", async () => {
    const { id } = await createOffer({ name: "Oferta" });
    await expectUserError(
      updateOffer({ id, folderId: "nao-existe" }),
      "A pasta escolhida não existe mais.",
      "folderId",
    );
  });

  it("não altera oferta na lixeira ou inexistente", async () => {
    const { id } = await createOffer({ name: "Oferta" });
    await trashOffer(id);
    const err = await expectPrismaError(updateOffer({ id, name: "X" }), "P2025");
    expect(toUserMessage(err).message).toBe("Não encontramos esse item. Ele pode ter sido excluído.");
    expect((await prisma.offer.findUniqueOrThrow({ where: { id } })).name).toBe("Oferta");
    await expectPrismaError(updateOffer({ id: "nao-existe", name: "X" }), "P2025");
  });
});

describe("setOfferTags", () => {
  it("substitui as tags da oferta", async () => {
    const [a, b, c] = await Promise.all([createTag("A"), createTag("B"), createTag("C")]);
    const { id } = await createOffer({ name: "Oferta", tagIds: [a.id, b.id] });

    await setOfferTags(id, [b.id, c.id]);
    expect(await tagIdsOf(id)).toEqual([b.id, c.id].sort());

    await setOfferTags(id, [c.id, c.id]);
    expect(await tagIdsOf(id)).toEqual([c.id]);

    await setOfferTags(id, []);
    expect(await tagIdsOf(id)).toEqual([]);
  });

  it("não mexe nas tags de outras ofertas", async () => {
    const tag = await createTag("A");
    const one = await createOffer({ name: "Um", tagIds: [tag.id] });
    const two = await createOffer({ name: "Dois", tagIds: [tag.id] });
    await setOfferTags(one.id, []);
    expect(await tagIdsOf(two.id)).toEqual([tag.id]);
  });

  it("recusa tag inexistente sem alterar as atuais", async () => {
    const tag = await createTag("A");
    const { id } = await createOffer({ name: "Oferta", tagIds: [tag.id] });
    await expectUserError(setOfferTags(id, ["nao-existe"]), "Alguma tag escolhida não existe mais.", "tagIds");
    expect(await tagIdsOf(id)).toEqual([tag.id]);
  });

  it("recusa oferta na lixeira ou inexistente com mensagem clara", async () => {
    const tag = await createTag("A");
    const { id } = await createOffer({ name: "Oferta", tagIds: [tag.id] });
    await trashOffer(id);
    await expectUserError(setOfferTags(id, []), "Oferta não encontrada.");
    expect(await tagIdsOf(id)).toEqual([tag.id]);
    await expectUserError(setOfferTags("nao-existe", []), "Oferta não encontrada.");
  });
});

describe("duplicateOffer", () => {
  /** Arquivos de "Preservar JS" nos caminhos originais (página principal). */
  const HOME_ASSET_MAP = {
    "/js/app.js": `a/ab/${"ab".repeat(32)}.js`,
    "/css/site.css?v=3": `a/cd/${"cd".repeat(32)}.css`,
  };

  /** Oferta completa: 3 páginas com links internos, variação B, pixel, regras, arquivos. */
  async function richOffer() {
    const folder = await createFolder("Nutra");
    const tag = await createTag("Saúde");
    const { id: offerId } = await createOffer({ name: "Funil Emagrecimento", folderId: folder.id, tagIds: [tag.id] });
    await prisma.offer.update({
      where: { id: offerId },
      data: {
        notes: "Notas da oferta",
        status: "LIVE",
        liveUrl: "https://emagrece.com",
        sourceUrl: "https://original.com",
        settings: { seo: { title: "Emagreça" }, company: { name: "Empresa" } },
        tracking: { consent: "lgpd" },
      },
    });

    const home = await prisma.page.findFirstOrThrow({ where: { offerId } });
    const obrigado = await createPage({ offerId, name: "Obrigado" });
    const upsell = await createPage({ offerId, name: "Upsell", type: "UPSELL" });
    const foreign = fakeId("outraoferta");

    // Documento da página principal com links internos no HTML e no projeto do editor.
    const homeVariant = await prisma.pageVariant.findFirstOrThrow({ where: { pageId: home.id } });
    await prisma.pageDocument.updateMany({
      where: { variantId: homeVariant.id },
      data: {
        html: [
          `<a href="${internalLink(obrigado.id)}">Comprar</a>`,
          `<a href="${internalLink(upsell.id)}">Upsell</a>`,
          `<a href="${internalLink(foreign)}">Outra oferta</a>`,
        ].join(""),
        project: packProject({
          pages: [
            {
              components: [
                { type: "link", attributes: { href: internalLink(obrigado.id) } },
                { type: "link", attributes: { href: internalLink(upsell.id) } },
              ],
            },
          ],
          title: "Ação",
        }),
        revision: 12,
        assetMap: HOME_ASSET_MAP,
      },
    });

    // Variação B no Obrigado, com link de volta para a principal.
    await prisma.pageVariant.create({
      data: {
        pageId: obrigado.id,
        name: "B",
        label: "Teste de headline",
        isControl: false,
        weight: 40,
        position: 1,
        documents: { create: { device: "ALL", html: `<a href="${internalLink(home.id)}">Voltar</a>` } },
      },
    });

    await prisma.pixelConfig.create({
      data: { offerId, vendor: "META", pixelId: "123456", label: "Pixel principal", options: { advanced: true } },
    });
    await prisma.eventRule.createMany({
      data: [
        { offerId, pageId: obrigado.id, event: "LEAD", trigger: "PAGE_LOAD" },
        { offerId, pageId: null, event: "PAGE_VIEW", trigger: "SCROLL_DEPTH", value: 50 },
      ],
    });
    await prisma.removedItem.create({
      data: {
        pageId: home.id,
        vendor: "Hotjar",
        category: "ANALYTICS",
        snippet: "<script>hj()</script>",
        location: "head",
      },
    });
    await prisma.checkoutLink.create({
      data: { pageId: home.id, platform: "hotmart", url: "https://pay.hotmart.com/X", source: "HREF" },
    });
    await prisma.asset.create({
      data: {
        offerId,
        sha256: "ab".repeat(32),
        key: `a/ab/${"ab".repeat(32)}.webp`,
        kind: "IMAGE",
        mime: "image/webp",
        bytes: 10,
      },
    });

    return { offerId, folder, tag, homeId: home.id, obrigadoId: obrigado.id, upsellId: upsell.id, foreign };
  }

  function loadOffer(id: string) {
    return prisma.offer.findUniqueOrThrow({
      where: { id },
      include: {
        tags: true,
        pixels: true,
        eventRules: { orderBy: { event: "asc" } },
        assets: true,
        pages: {
          orderBy: { position: "asc" },
          include: {
            variants: { orderBy: { position: "asc" }, include: { documents: true } },
            removedItems: true,
            checkoutLinks: true,
          },
        },
      },
    });
  }

  it("copia a oferta inteira como rascunho, com nome “Cópia de …”", async () => {
    const src = await richOffer();
    const copy = await duplicateOffer(src.offerId);
    expect(copy.id).not.toBe(src.offerId);

    const offer = await loadOffer(copy.id);
    expect(offer).toMatchObject({
      name: "Cópia de Funil Emagrecimento",
      status: "DRAFT",
      liveUrl: null,
      notes: "Notas da oferta",
      sourceUrl: "https://original.com",
      folderId: src.folder.id,
      settings: { seo: { title: "Emagreça" }, company: { name: "Empresa" } },
      tracking: { consent: "lgpd" },
      deletedAt: null,
    });
    expect(offer.tags.map((t) => t.tagId)).toEqual([src.tag.id]);
  });

  it("copia páginas, variações e documentos com IDs novos", async () => {
    const src = await richOffer();
    const copy = await duplicateOffer(src.offerId);
    const original = await loadOffer(src.offerId);
    const offer = await loadOffer(copy.id);

    expect(offer.pages.map((p) => [p.name, p.slug, p.position, p.isHome, p.type])).toEqual(
      original.pages.map((p) => [p.name, p.slug, p.position, p.isHome, p.type]),
    );
    const originalPageIds = new Set(original.pages.map((p) => p.id));
    expect(offer.pages.every((p) => !originalPageIds.has(p.id))).toBe(true);

    const obrigado = offer.pages[1];
    expect(obrigado.variants.map((v) => [v.name, v.label, v.isControl, v.weight, v.position])).toEqual([
      ["A", null, true, 100, 0],
      ["B", "Teste de headline", false, 40, 1],
    ]);
    const originalVariantIds = new Set(original.pages.flatMap((p) => p.variants.map((v) => v.id)));
    expect(offer.pages.flatMap((p) => p.variants).every((v) => !originalVariantIds.has(v.id))).toBe(true);

    // Documento copiado começa na revisão 0.
    expect(offer.pages[0].variants[0].documents[0].revision).toBe(0);
    // "Preservar JS": o mapa de arquivos vai junto (sem ele, /js/app.js dá 404 na prévia da cópia).
    expect(offer.pages[0].variants[0].documents[0].assetMap).toEqual(HOME_ASSET_MAP);
    expect(offer.pages[1].variants[0].documents[0].assetMap).toBeNull();
    expect(offer.pages.flatMap((p) => p.variants.flatMap((v) => v.documents))).toHaveLength(4);
  });

  it("remapeia os links internos (HTML e projeto do editor) para as páginas novas", async () => {
    const src = await richOffer();
    const copy = await duplicateOffer(src.offerId);
    const offer = await loadOffer(copy.id);
    const [home, obrigado, upsell] = offer.pages;

    const homeDoc = home.variants[0].documents[0];
    expect(referencedPageIds(homeDoc.html ?? "")).toEqual(new Set([obrigado.id, upsell.id, src.foreign]));
    expect(homeDoc.html).toContain(`<a href="${internalLink(obrigado.id)}">Comprar</a>`);
    expect(homeDoc.html).toContain(`<a href="${internalLink(upsell.id)}">Upsell</a>`);
    // Link para página que não é desta oferta fica como estava.
    expect(homeDoc.html).toContain(`<a href="${internalLink(src.foreign)}">Outra oferta</a>`);

    const project = unpackProject<{ pages: { components: { attributes: { href: string } }[] }[]; title: string }>(
      homeDoc.project as Uint8Array,
    );
    expect(project.title).toBe("Ação");
    expect(project.pages[0].components.map((c) => c.attributes.href)).toEqual([
      internalLink(obrigado.id),
      internalLink(upsell.id),
    ]);

    const voltar = obrigado.variants[1].documents[0];
    expect(voltar.html).toBe(`<a href="${internalLink(home.id)}">Voltar</a>`);
  });

  it("copia pixels, regras de eventos (com a página nova), itens removidos, checkouts e arquivos", async () => {
    const src = await richOffer();
    const copy = await duplicateOffer(src.offerId);
    const offer = await loadOffer(copy.id);
    const [home, obrigado] = offer.pages;

    expect(offer.pixels).toHaveLength(1);
    expect(offer.pixels[0]).toMatchObject({
      vendor: "META",
      pixelId: "123456",
      label: "Pixel principal",
      enabled: true,
      options: { advanced: true },
    });

    expect(offer.eventRules.map((r) => [r.event, r.trigger, r.value, r.pageId])).toEqual([
      ["PAGE_VIEW", "SCROLL_DEPTH", 50, null],
      ["LEAD", "PAGE_LOAD", null, obrigado.id],
    ]);

    expect(home.removedItems).toHaveLength(1);
    expect(home.removedItems[0]).toMatchObject({ vendor: "Hotjar", snippet: "<script>hj()</script>" });
    expect(home.checkoutLinks).toHaveLength(1);
    expect(home.checkoutLinks[0]).toMatchObject({ platform: "hotmart", url: "https://pay.hotmart.com/X" });

    expect(offer.assets).toHaveLength(1);
    expect(offer.assets[0].key).toBe(`a/ab/${"ab".repeat(32)}.webp`);

    // A original continua com os seus.
    const original = await loadOffer(src.offerId);
    expect(original.pixels).toHaveLength(1);
    expect(original.eventRules.find((r) => r.event === "LEAD")?.pageId).toBe(src.obrigadoId);
    expect(original.assets).toHaveLength(1);
  });

  it("editar ou excluir a cópia não afeta a original", async () => {
    const src = await richOffer();
    const before = await loadOffer(src.offerId);
    const copy = await duplicateOffer(src.offerId);
    const offer = await loadOffer(copy.id);

    await updateOffer({ id: copy.id, name: "Outra", notes: "Mudou", status: "ARCHIVED" });
    await prisma.page.update({ where: { id: offer.pages[1].id }, data: { name: "Mudou", slug: "mudou" } });
    await prisma.pageDocument.update({
      where: { id: offer.pages[0].variants[0].documents[0].id },
      data: { html: "<p>editado</p>", project: packProject({ editado: true }) },
    });
    await prisma.pixelConfig.updateMany({ where: { offerId: copy.id }, data: { pixelId: "999" } });

    const after = await loadOffer(src.offerId);
    expect(after).toEqual(before);

    await trashOffer(copy.id);
    await deleteOfferForever(copy.id);
    expect(await loadOffer(src.offerId)).toEqual(before);
  });

  it("numera cópias repetidas e ignora maiúsculas/acentos", async () => {
    const { id } = await createOffer({ name: "Oferta" });
    const first = await duplicateOffer(id);
    const second = await duplicateOffer(id);
    await createOffer({ name: "COPIA DE OFERTA (3)" });
    const fourth = await duplicateOffer(id);

    const names = await prisma.offer.findMany({
      where: { id: { in: [first.id, second.id, fourth.id] } },
      select: { id: true, name: true },
    });
    const byId = Object.fromEntries(names.map((n) => [n.id, n.name]));
    expect(byId[first.id]).toBe("Cópia de Oferta");
    expect(byId[second.id]).toBe("Cópia de Oferta (2)");
    expect(byId[fourth.id]).toBe("Cópia de Oferta (4)");
  });

  it("não duplica oferta inexistente ou na lixeira", async () => {
    await expectUserError(duplicateOffer("nao-existe"), "Oferta não encontrada.");
    const { id } = await createOffer({ name: "Oferta" });
    await trashOffer(id);
    await expectUserError(duplicateOffer(id), "Oferta não encontrada.");
    expect(await prisma.offer.count()).toBe(1);
  });
});

describe("lixeira", () => {
  it("mover para a lixeira tira da lista e restaurar devolve", async () => {
    const { id } = await createOffer({ name: "Oferta" });
    const other = await createOffer({ name: "Outra" });

    await trashOffer(id);
    expect((await prisma.offer.findUniqueOrThrow({ where: { id } })).deletedAt).toBeInstanceOf(Date);
    expect((await listOffers()).map((o) => o.id)).toEqual([other.id]);
    expect((await listTrashedOffers()).map((o) => o.id)).toEqual([id]);

    await restoreOffer(id);
    expect((await prisma.offer.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
    expect((await listOffers()).map((o) => o.id).sort()).toEqual([id, other.id].sort());
    expect(await listTrashedOffers()).toEqual([]);
  });

  it("lista da lixeira vem da exclusão mais recente para a mais antiga", async () => {
    const a = await createOffer({ name: "A" });
    const b = await createOffer({ name: "B" });
    await trashOffer(a.id);
    await trashOffer(b.id);
    await prisma.offer.update({ where: { id: a.id }, data: { deletedAt: new Date("2026-01-02T00:00:00Z") } });
    await prisma.offer.update({ where: { id: b.id }, data: { deletedAt: new Date("2026-01-01T00:00:00Z") } });
    expect((await listTrashedOffers()).map((o) => o.id)).toEqual([a.id, b.id]);
  });

  it("não move de novo o que já está na lixeira nem restaura o que não está", async () => {
    const { id } = await createOffer({ name: "Oferta" });
    await expectPrismaError(restoreOffer(id), "P2025");
    await trashOffer(id);
    await expectPrismaError(trashOffer(id), "P2025");
  });

  it("excluir de vez só funciona para ofertas na lixeira", async () => {
    const { id } = await createOffer({ name: "Oferta" });
    const err = await expectPrismaError(deleteOfferForever(id), "P2025");
    expect(toUserMessage(err).message).toBe("Não encontramos esse item. Ele pode ter sido excluído.");
    expect(await prisma.offer.count({ where: { id } })).toBe(1);

    await trashOffer(id);
    await deleteOfferForever(id);
    expect(await prisma.offer.count({ where: { id } })).toBe(0);
    // Páginas, variações e documentos saem junto.
    expect(await prisma.page.count()).toBe(0);
    expect(await prisma.pageVariant.count()).toBe(0);
    expect(await prisma.pageDocument.count()).toBe(0);
  });

  it("esvaziar a lixeira apaga só o que está nela e informa quantas", async () => {
    const tag = await createTag("Saúde");
    const keep = await createOffer({ name: "Fica", tagIds: [tag.id] });
    const a = await createOffer({ name: "A", tagIds: [tag.id] });
    const b = await createOffer({ name: "B" });
    await trashOffer(a.id);
    await trashOffer(b.id);

    expect(await emptyTrash()).toBe(2);
    expect((await prisma.offer.findMany({ select: { id: true } })).map((o) => o.id)).toEqual([keep.id]);
    expect(await prisma.page.count()).toBe(1);
    // A tag continua existindo, só perdeu o vínculo.
    expect(await prisma.tag.count()).toBe(1);
    expect(await tagIdsOf(keep.id)).toEqual([tag.id]);

    expect(await emptyTrash()).toBe(0);
  });
});
