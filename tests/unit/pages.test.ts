import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { packProject, unpackProject } from "@/lib/project-data";
import { createOffer, trashOffer } from "@/server/services/offers";
import {
  createPage,
  deletePage,
  duplicatePage,
  reorderPages,
  setHomePage,
  suggestSlug,
  updatePage,
} from "@/server/services/pages";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";

const DUPLICATE_SLUG = "Já existe uma página com esse endereço (slug) nesta oferta.";
const BAD_CHARS = "Use só letras minúsculas, números e hífen (ex.: pagina-de-vendas).";

beforeEach(async () => {
  await resetDatabase();
});

/** Páginas da oferta na ordem do funil. */
function pagesOf(offerId: string) {
  return prisma.page.findMany({
    where: { offerId },
    orderBy: { position: "asc" },
    select: { id: true, name: true, slug: true, position: true, isHome: true, type: true },
  });
}

async function homeId(offerId: string) {
  const homes = await prisma.page.findMany({ where: { offerId, isHome: true }, select: { id: true } });
  expect(homes).toHaveLength(1);
  return homes[0].id;
}

/** Oferta com a página principal + páginas extras, nessa ordem. */
async function offerWithPages(...names: string[]) {
  const offer = await createOffer({ name: "Funil" });
  const ids = [(await pagesOf(offer.id))[0].id];
  for (const name of names) ids.push((await createPage({ offerId: offer.id, name })).id);
  return { offerId: offer.id, ids };
}

describe("createPage", () => {
  it("gera o slug a partir do nome e coloca a página no fim do funil", async () => {
    const offer = await createOffer({ name: "Funil" });
    const page = await createPage({ offerId: offer.id, name: "Página de Obrigado!" });

    const pages = await pagesOf(offer.id);
    expect(pages.map((p) => [p.slug, p.position, p.isHome])).toEqual([
      ["principal", 0, true],
      ["pagina-de-obrigado", 1, false],
    ]);
    expect(pages[1]).toMatchObject({ id: page.id, name: "Página de Obrigado!", type: "SALES" });

    const variants = await prisma.pageVariant.findMany({ where: { pageId: page.id }, include: { documents: true } });
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({ name: "A", isControl: true, weight: 100 });
    expect(variants[0].documents).toHaveLength(1);
    expect(variants[0].documents[0]).toMatchObject({ device: "ALL", revision: 0, project: null });
    expect(variants[0].documents[0].html).toContain("<title>Página de Obrigado!</title>");
  });

  it("acrescenta -2, -3 quando o slug gerado já existe", async () => {
    const offer = await createOffer({ name: "Funil" });
    await createPage({ offerId: offer.id, name: "Upsell" });
    await createPage({ offerId: offer.id, name: "UPSELL" });
    await createPage({ offerId: offer.id, name: "Úpsell!" });
    await createPage({ offerId: offer.id, name: "Principal" });

    expect((await pagesOf(offer.id)).map((p) => p.slug)).toEqual([
      "principal",
      "upsell",
      "upsell-2",
      "upsell-3",
      "principal-2",
    ]);
  });

  it("evita endereços reservados e nomes sem letras", async () => {
    const offer = await createOffer({ name: "Funil" });
    await createPage({ offerId: offer.id, name: "Assets" });
    await createPage({ offerId: offer.id, name: "???" });
    expect((await pagesOf(offer.id)).map((p) => p.slug)).toEqual(["principal", "assets-pagina", "pagina"]);
  });

  it("gera slug válido para nomes muito longos", async () => {
    const offer = await createOffer({ name: "Funil" });
    const name = `${"a".repeat(77)} bc`;
    await createPage({ offerId: offer.id, name });
    await createPage({ offerId: offer.id, name });
    const slugs = (await pagesOf(offer.id)).map((p) => p.slug);
    expect(slugs.slice(1)).toEqual([`${"a".repeat(77)}-bc`, `${"a".repeat(77)}-2`]);
  });

  it("usa o slug informado e o tipo escolhido", async () => {
    const offer = await createOffer({ name: "Funil" });
    const page = await createPage({ offerId: offer.id, name: "Obrigado", slug: "obrigado-vip", type: "THANK_YOU" });
    expect(await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).toMatchObject({
      slug: "obrigado-vip",
      type: "THANK_YOU",
    });
  });

  it.each([
    ["assets", '"assets" é reservado pelo sistema. Escolha outro endereço.'],
    ["api", '"api" é reservado pelo sistema. Escolha outro endereço.'],
    ["Abc", BAD_CHARS],
    ["pagina de vendas", BAD_CHARS],
    ["pagina--vendas", BAD_CHARS],
    ["a".repeat(81), "O endereço pode ter no máximo 80 caracteres."],
    ["principal", DUPLICATE_SLUG],
  ])("recusa o slug %j com erro no campo slug", async (slug, message) => {
    const offer = await createOffer({ name: "Funil" });
    await expectUserError(createPage({ offerId: offer.id, name: "Nova", slug }), message, "slug");
    expect(await prisma.page.count({ where: { offerId: offer.id } })).toBe(1);
  });

  it("a primeira página de uma oferta vira a inicial; as seguintes não", async () => {
    const offer = await prisma.offer.create({ data: { name: "Oferta vazia" } });
    const first = await createPage({ offerId: offer.id, name: "Vendas" });
    const second = await createPage({ offerId: offer.id, name: "Obrigado" });

    const pages = await pagesOf(offer.id);
    expect(pages.map((p) => [p.id, p.position, p.isHome])).toEqual([
      [first.id, 0, true],
      [second.id, 1, false],
    ]);
  });

  it("não cria página em oferta inexistente ou na lixeira", async () => {
    await expectUserError(createPage({ offerId: "nao-existe", name: "X" }), "Oferta não encontrada.");
    const offer = await createOffer({ name: "Funil" });
    await trashOffer(offer.id);
    await expectUserError(createPage({ offerId: offer.id, name: "X" }), "Oferta não encontrada.");
  });

  it("atualiza a data de modificação da oferta", async () => {
    const offer = await createOffer({ name: "Funil" });
    const old = new Date("2020-01-01T00:00:00Z");
    await prisma.offer.update({ where: { id: offer.id }, data: { updatedAt: old } });
    await createPage({ offerId: offer.id, name: "Nova" });
    const row = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(row.updatedAt.getTime()).toBeGreaterThan(old.getTime());
  });
});

describe("updatePage", () => {
  it("renomeia, troca slug e tipo", async () => {
    const { ids } = await offerWithPages("Obrigado");
    await updatePage({ id: ids[1], name: "Obrigado VIP", slug: "obrigado-vip", type: "THANK_YOU" });
    expect(await prisma.page.findUniqueOrThrow({ where: { id: ids[1] } })).toMatchObject({
      name: "Obrigado VIP",
      slug: "obrigado-vip",
      type: "THANK_YOU",
    });
  });

  it("recusa slug de outra página da mesma oferta", async () => {
    const { ids } = await offerWithPages("Obrigado");
    await expectUserError(updatePage({ id: ids[1], slug: "principal" }), DUPLICATE_SLUG, "slug");
    expect((await prisma.page.findUniqueOrThrow({ where: { id: ids[1] } })).slug).toBe("obrigado");
  });

  it("aceita o mesmo slug usado em outra oferta", async () => {
    const a = await offerWithPages("Obrigado");
    await offerWithPages("Upsell");
    await updatePage({ id: a.ids[1], slug: "upsell" });
    expect((await prisma.page.findUniqueOrThrow({ where: { id: a.ids[1] } })).slug).toBe("upsell");
  });

  it("recusa slug inválido ou reservado", async () => {
    const { ids } = await offerWithPages("Obrigado");
    await expectUserError(updatePage({ id: ids[1], slug: "Obrigado" }), BAD_CHARS, "slug");
    await expectUserError(
      updatePage({ id: ids[1], slug: "index" }),
      '"index" é reservado pelo sistema. Escolha outro endereço.',
      "slug",
    );
    await expectUserError(updatePage({ id: ids[1], slug: "" }), "Informe o endereço da página.", "slug");
  });

  it("manter o próprio slug não é conflito", async () => {
    const { ids } = await offerWithPages("Obrigado");
    await updatePage({ id: ids[1], name: "Novo nome", slug: "obrigado" });
    expect(await prisma.page.findUniqueOrThrow({ where: { id: ids[1] } })).toMatchObject({
      name: "Novo nome",
      slug: "obrigado",
    });
  });

  it("não altera página de oferta na lixeira", async () => {
    const { offerId, ids } = await offerWithPages("Obrigado");
    await trashOffer(offerId);
    await expectUserError(updatePage({ id: ids[1], name: "X" }), "Página não encontrada.");
  });
});

describe("reorderPages", () => {
  it("grava a nova ordem", async () => {
    const { offerId, ids } = await offerWithPages("B", "C", "D");
    const order = [ids[2], ids[0], ids[3], ids[1]];
    await reorderPages(offerId, order);
    expect((await pagesOf(offerId)).map((p) => [p.id, p.position])).toEqual(order.map((id, i) => [id, i]));
  });

  it("a página inicial continua a mesma depois de reordenar", async () => {
    const { offerId, ids } = await offerWithPages("B");
    await reorderPages(offerId, [ids[1], ids[0]]);
    expect(await homeId(offerId)).toBe(ids[0]);
  });

  it.each([
    ["faltando uma página", (ids: string[]) => [ids[0], ids[1]]],
    ["com página a mais", (ids: string[]) => [...ids, "outra"]],
    ["com página de outra oferta", (ids: string[], foreign: string) => [ids[0], ids[1], foreign]],
    ["com página repetida", (ids: string[]) => [ids[0], ids[0], ids[1]]],
    ["vazia", () => []],
  ])("recusa lista %s e não muda nada", async (_label, build) => {
    const { offerId, ids } = await offerWithPages("B", "C");
    const other = await offerWithPages();
    await expectUserError(
      reorderPages(offerId, build(ids, other.ids[0])),
      "A lista de páginas mudou. Recarregue a tela e tente de novo.",
    );
    expect((await pagesOf(offerId)).map((p) => [p.id, p.position])).toEqual(ids.map((id, i) => [id, i]));
  });

  it("recusa oferta na lixeira", async () => {
    const { offerId, ids } = await offerWithPages("B");
    await trashOffer(offerId);
    await expectUserError(reorderPages(offerId, [ids[1], ids[0]]), "Oferta não encontrada.");
  });
});

describe("setHomePage", () => {
  it("troca a página inicial e mantém exatamente uma", async () => {
    const { offerId, ids } = await offerWithPages("B", "C");
    await setHomePage(ids[2]);
    expect(await homeId(offerId)).toBe(ids[2]);
    await setHomePage(ids[1]);
    expect(await homeId(offerId)).toBe(ids[1]);
    // Marcar a que já é inicial não muda nada.
    await setHomePage(ids[1]);
    expect(await homeId(offerId)).toBe(ids[1]);
  });

  it("não mexe na página inicial de outras ofertas", async () => {
    const a = await offerWithPages("B");
    const b = await offerWithPages("B");
    await setHomePage(a.ids[1]);
    expect(await homeId(a.offerId)).toBe(a.ids[1]);
    expect(await homeId(b.offerId)).toBe(b.ids[0]);
  });

  it("página inexistente dá erro amigável", async () => {
    await expectUserError(setHomePage("nao-existe"), "Página não encontrada.");
  });
});

describe("duplicatePage", () => {
  it("insere a cópia logo depois da original e empurra as seguintes", async () => {
    const { offerId, ids } = await offerWithPages("Obrigado", "Upsell");
    const copy = await duplicatePage(ids[1]);

    const pages = await pagesOf(offerId);
    expect(pages.map((p) => [p.id, p.position])).toEqual([
      [ids[0], 0],
      [ids[1], 1],
      [copy.id, 2],
      [ids[2], 3],
    ]);
    expect(pages[2]).toMatchObject({ name: "Cópia de Obrigado", slug: "obrigado-copia", isHome: false });
  });

  it("nunca copia a marca de página inicial", async () => {
    const { offerId, ids } = await offerWithPages("Obrigado");
    const copy = await duplicatePage(ids[0]);
    expect(await homeId(offerId)).toBe(ids[0]);
    expect((await prisma.page.findUniqueOrThrow({ where: { id: copy.id } })).isHome).toBe(false);
  });

  it("gera nome e slug livres a cada cópia", async () => {
    const { offerId, ids } = await offerWithPages("Obrigado");
    await duplicatePage(ids[1]);
    await duplicatePage(ids[1]);
    const pages = await pagesOf(offerId);
    expect(pages.map((p) => [p.name, p.slug])).toEqual([
      ["Página principal", "principal"],
      ["Obrigado", "obrigado"],
      ["Cópia de Obrigado (2)", "obrigado-copia-2"],
      ["Cópia de Obrigado", "obrigado-copia"],
    ]);
  });

  it("copia todas as variações e documentos (com o projeto do editor)", async () => {
    const { ids } = await offerWithPages("Vendas");
    const pageId = ids[1];
    await prisma.page.update({
      where: { id: pageId },
      data: { type: "VSL", seo: { title: "SEO" }, customCode: { head: "<meta>" }, sourceUrl: "https://x.com" },
    });
    const variantA = await prisma.pageVariant.findFirstOrThrow({ where: { pageId } });
    const assetMap = { "/js/app.js": `a/ab/${"a".repeat(64)}.js`, "/img/x.png?v=2": `a/cd/${"c".repeat(64)}.png` };
    await prisma.pageDocument.updateMany({
      where: { variantId: variantA.id },
      data: { html: "<p>A</p>", project: packProject({ a: "Ação" }), revision: 7, assetMap },
    });
    await prisma.pageVariant.create({
      data: {
        pageId,
        name: "B",
        label: "Headline nova",
        weight: 30,
        position: 1,
        documents: {
          create: [
            { device: "DESKTOP", html: "<p>B desktop</p>" },
            { device: "MOBILE", html: "<p>B mobile</p>" },
          ],
        },
      },
    });

    const copy = await duplicatePage(pageId);

    const page = await prisma.page.findUniqueOrThrow({
      where: { id: copy.id },
      include: { variants: { orderBy: { position: "asc" }, include: { documents: { orderBy: { device: "asc" } } } } },
    });
    expect(page).toMatchObject({
      type: "VSL",
      seo: { title: "SEO" },
      customCode: { head: "<meta>" },
      sourceUrl: "https://x.com",
    });
    expect(page.variants.map((v) => [v.name, v.label, v.isControl, v.weight, v.position])).toEqual([
      ["A", null, true, 100, 0],
      ["B", "Headline nova", false, 30, 1],
    ]);
    const [docA] = page.variants[0].documents;
    expect(docA.html).toBe("<p>A</p>");
    expect(docA.revision).toBe(0);
    expect(unpackProject(docA.project as Uint8Array)).toEqual({ a: "Ação" });
    // "Preservar JS": o mapa de arquivos nos caminhos originais vai junto (senão, 404 na prévia da cópia).
    expect(docA.assetMap).toEqual(assetMap);
    expect(page.variants[1].documents.map((d) => [d.device, d.html, d.assetMap])).toEqual([
      ["DESKTOP", "<p>B desktop</p>", null],
      ["MOBILE", "<p>B mobile</p>", null],
    ]);

    // Nada é compartilhado com a original.
    const originalVariantIds = (await prisma.pageVariant.findMany({ where: { pageId } })).map((v) => v.id);
    expect(page.variants.some((v) => originalVariantIds.includes(v.id))).toBe(false);
    await prisma.pageDocument.updateMany({
      where: { variantId: page.variants[0].id },
      data: { html: "<p>editado</p>" },
    });
    expect((await prisma.pageDocument.findFirstOrThrow({ where: { variantId: variantA.id } })).html).toBe("<p>A</p>");
  });

  it("página inexistente dá erro amigável", async () => {
    await expectUserError(duplicatePage("nao-existe"), "Página não encontrada.");
  });
});

describe("deletePage", () => {
  it("não exclui a última página da oferta", async () => {
    const { offerId, ids } = await offerWithPages();
    await expectUserError(deletePage(ids[0]), "A oferta precisa ter pelo menos uma página.");
    expect(await prisma.page.count({ where: { offerId } })).toBe(1);
  });

  it("exclui uma página comum sem mexer na inicial", async () => {
    const { offerId, ids } = await offerWithPages("B", "C");
    await deletePage(ids[1]);
    expect((await pagesOf(offerId)).map((p) => p.id)).toEqual([ids[0], ids[2]]);
    expect(await homeId(offerId)).toBe(ids[0]);
    // Variações e documentos saem junto.
    expect(await prisma.pageVariant.count({ where: { pageId: ids[1] } })).toBe(0);
  });

  it("ao excluir a inicial, a primeira das restantes (pela ordem do funil) vira inicial", async () => {
    const { offerId, ids } = await offerWithPages("B", "C");
    // Ordem: C, principal, B — a primeira restante é C, não B.
    await reorderPages(offerId, [ids[2], ids[0], ids[1]]);
    await deletePage(ids[0]);
    expect(await homeId(offerId)).toBe(ids[2]);
    expect((await pagesOf(offerId)).map((p) => p.id)).toEqual([ids[2], ids[1]]);
  });

  it("página inexistente dá erro amigável", async () => {
    await expectUserError(deletePage("nao-existe"), "Página não encontrada.");
  });
});

describe("suggestSlug", () => {
  it("sugere o slug a partir do nome", () => {
    expect(suggestSlug("Página de Obrigado")).toBe("pagina-de-obrigado");
  });
});
