/**
 * Regras garantidas pelo próprio banco (índices parciais e CHECKs escritos em SQL
 * na migration), mesmo que algum código esqueça de validar.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetDatabase } from "../setup/per-file";
import { catchError } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

async function offerWithHome() {
  return prisma.offer.create({
    data: {
      name: "Oferta",
      pages: {
        create: {
          name: "Principal",
          slug: "principal",
          isHome: true,
          variants: { create: { name: "A", isControl: true } },
        },
      },
    },
    include: { pages: { include: { variants: true } } },
  });
}

/** Mensagem completa do erro, incluindo a causa vinda do driver. */
function errorText(err: unknown) {
  return JSON.stringify({ message: (err as Error).message, meta: (err as { meta?: unknown }).meta });
}

describe("uma página inicial por oferta", () => {
  it("recusa uma segunda página inicial (Prisma)", async () => {
    const offer = await offerWithHome();
    const err = await catchError(
      prisma.page.create({ data: { offerId: offer.id, name: "Outra", slug: "outra", isHome: true } }),
    );
    expect(err).toMatchObject({ code: "P2002" });
    expect(errorText(err)).toContain("Page_one_home_per_offer");
  });

  it("recusa marcar outra página como inicial sem desmarcar a atual", async () => {
    const offer = await offerWithHome();
    const other = await prisma.page.create({ data: { offerId: offer.id, name: "Outra", slug: "outra" } });
    await expect(prisma.page.update({ where: { id: other.id }, data: { isHome: true } })).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("recusa uma segunda página inicial (SQL puro)", async () => {
    const offer = await offerWithHome();
    const err = await catchError(
      prisma.$executeRaw`insert into "Page" (id, "offerId", name, slug, "isHome", "updatedAt")
        values ('pagina-raw', ${offer.id}, 'Raw', 'raw', true, now())`,
    );
    expect(errorText(err)).toContain("Page_one_home_per_offer");
  });

  it("permite uma página inicial em cada oferta e várias páginas não iniciais", async () => {
    const a = await offerWithHome();
    await offerWithHome();
    await prisma.page.create({ data: { offerId: a.id, name: "B", slug: "b" } });
    await prisma.page.create({ data: { offerId: a.id, name: "C", slug: "c" } });
    expect(await prisma.page.count({ where: { isHome: true } })).toBe(2);
  });
});

describe("uma variação de controle por página", () => {
  it("recusa uma segunda variação de controle (Prisma)", async () => {
    const offer = await offerWithHome();
    const pageId = offer.pages[0].id;
    const err = await catchError(prisma.pageVariant.create({ data: { pageId, name: "B", isControl: true } }));
    expect(err).toMatchObject({ code: "P2002" });
    expect(errorText(err)).toContain("PageVariant_one_control_per_page");
  });

  it("recusa uma segunda variação de controle (SQL puro)", async () => {
    const offer = await offerWithHome();
    const pageId = offer.pages[0].id;
    const err = await catchError(
      prisma.$executeRaw`insert into "PageVariant" (id, "pageId", name, "isControl", "updatedAt")
        values ('variacao-raw', ${pageId}, 'B', true, now())`,
    );
    expect(errorText(err)).toContain("PageVariant_one_control_per_page");
  });

  it("permite variações que não são de controle", async () => {
    const offer = await offerWithHome();
    const pageId = offer.pages[0].id;
    await prisma.pageVariant.create({ data: { pageId, name: "B", isControl: false, weight: 50 } });
    await prisma.pageVariant.create({ data: { pageId, name: "C", isControl: false, weight: 0 } });
    expect(await prisma.pageVariant.count({ where: { pageId } })).toBe(3);
  });
});

describe("formato do slug (CHECK)", () => {
  it.each(["Abc", "com espaço", "a--b", "-a", "a-", "página", "a_b", ""])("recusa o slug %j", async (slug) => {
    const offer = await offerWithHome();
    const err = await catchError(prisma.page.create({ data: { offerId: offer.id, name: "X", slug } }));
    expect(errorText(err)).toContain("Page_slug_format");
  });

  it("recusa slug com mais de 80 caracteres", async () => {
    const offer = await offerWithHome();
    const err = await catchError(prisma.page.create({ data: { offerId: offer.id, name: "X", slug: "a".repeat(81) } }));
    expect(errorText(err)).toContain("Page_slug_format");
  });

  it("recusa slug inválido também via SQL puro e ao atualizar", async () => {
    const offer = await offerWithHome();
    const rawErr = await catchError(
      prisma.$executeRaw`insert into "Page" (id, "offerId", name, slug, "updatedAt")
        values ('pagina-raw', ${offer.id}, 'Raw', 'Abc', now())`,
    );
    expect(errorText(rawErr)).toContain("Page_slug_format");

    const updateErr = await catchError(
      prisma.page.update({ where: { id: offer.pages[0].id }, data: { slug: "Principal" } }),
    );
    expect(errorText(updateErr)).toContain("Page_slug_format");
  });

  it("aceita slugs válidos", async () => {
    const offer = await offerWithHome();
    await prisma.page.create({ data: { offerId: offer.id, name: "X", slug: "pagina-de-vendas-2" } });
    await prisma.page.create({ data: { offerId: offer.id, name: "Y", slug: "a".repeat(80) } });
    expect(await prisma.page.count()).toBe(3);
  });
});

describe("outros CHECKs", () => {
  it("peso da variação fica entre 0 e 100", async () => {
    const offer = await offerWithHome();
    const pageId = offer.pages[0].id;
    const tooBig = await catchError(prisma.pageVariant.create({ data: { pageId, name: "B", weight: 101 } }));
    expect(errorText(tooBig)).toContain("PageVariant_weight_range");
    const negative = await catchError(prisma.pageVariant.create({ data: { pageId, name: "C", weight: -1 } }));
    expect(errorText(negative)).toContain("PageVariant_weight_range");
  });

  it("slug é único por oferta, mas pode repetir entre ofertas", async () => {
    const a = await offerWithHome();
    const b = await offerWithHome();
    expect(a.pages[0].slug).toBe(b.pages[0].slug);
    await expect(prisma.page.create({ data: { offerId: a.id, name: "Dup", slug: "principal" } })).rejects.toMatchObject(
      { code: "P2002" },
    );
  });

  it("excluir a oferta apaga páginas, variações e documentos em cascata", async () => {
    const offer = await offerWithHome();
    await prisma.pageDocument.create({ data: { variantId: offer.pages[0].variants[0].id, html: "<p>x</p>" } });
    await prisma.offer.delete({ where: { id: offer.id } });
    expect(await prisma.page.count()).toBe(0);
    expect(await prisma.pageVariant.count()).toBe(0);
    expect(await prisma.pageDocument.count()).toBe(0);
  });
});
