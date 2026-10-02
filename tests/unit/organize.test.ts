import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { toUserMessage } from "@/lib/errors";
import { createOffer, listOffers, setOfferTags, trashOffer } from "@/server/services/offers";
import {
  createFolder,
  createTag,
  deleteFolder,
  deleteTag,
  listFolders,
  listTags,
  renameFolder,
  updateTag,
} from "@/server/services/organize";
import { resetDatabase } from "../setup/per-file";
import { catchError, expectPrismaError, expectUserError } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

describe("pastas", () => {
  it("cria e lista pastas com a contagem de ofertas ativas", async () => {
    const nutra = await createFolder("Nutra");
    const info = await createFolder("Infoprodutos");
    expect(nutra).toEqual({ id: expect.any(String), name: "Nutra" });

    await createOffer({ name: "Oferta 1", folderId: nutra.id });
    const trashed = await createOffer({ name: "Oferta 2", folderId: nutra.id });
    await trashOffer(trashed.id);

    const folders = await listFolders();
    expect(folders.map((f) => f.name)).toEqual(["Infoprodutos", "Nutra"]);
    expect(folders.find((f) => f.id === nutra.id)?._count.offers).toBe(1);
    expect(folders.find((f) => f.id === info.id)?._count.offers).toBe(0);

    const row = await prisma.folder.findUniqueOrThrow({ where: { id: nutra.id } });
    expect(row.nameKey).toBe("nutra");
  });

  it("não aceita duas pastas com o mesmo nome (sem diferenciar maiúsculas/acentos)", async () => {
    await createFolder("Saúde Feminina");
    const err = await catchError(createFolder("  SAUDE   feminina "));
    expect(err).toMatchObject({ code: "P2002" });
    expect(toUserMessage(err)).toEqual({ message: "Já existe uma pasta com esse nome.", field: "nameKey" });
    expect(await prisma.folder.count()).toBe(1);
  });

  it("renomeia a pasta e atualiza a chave de unicidade", async () => {
    const folder = await createFolder("Nutra");
    await renameFolder(folder.id, "Nutracêuticos");
    const row = await prisma.folder.findUniqueOrThrow({ where: { id: folder.id } });
    expect(row).toMatchObject({ name: "Nutracêuticos", nameKey: "nutraceuticos" });

    // Mudar só maiúsculas/acentos do próprio nome é permitido.
    await renameFolder(folder.id, "NUTRACEUTICOS");
    expect((await prisma.folder.findUniqueOrThrow({ where: { id: folder.id } })).name).toBe("NUTRACEUTICOS");
  });

  it("não deixa renomear para o nome de outra pasta", async () => {
    await createFolder("Nutra");
    const other = await createFolder("Info");
    const err = await catchError(renameFolder(other.id, "nutra"));
    expect(toUserMessage(err).message).toBe("Já existe uma pasta com esse nome.");
    expect((await prisma.folder.findUniqueOrThrow({ where: { id: other.id } })).name).toBe("Info");
  });

  it("renomear/excluir pasta inexistente vira “Não encontramos…”", async () => {
    const renameErr = await expectPrismaError(renameFolder("nao-existe", "X"), "P2025");
    expect(toUserMessage(renameErr).message).toBe("Não encontramos esse item. Ele pode ter sido excluído.");
    await expectPrismaError(deleteFolder("nao-existe"), "P2025");
  });

  it("excluir a pasta deixa as ofertas “sem pasta” (elas continuam existindo)", async () => {
    const folder = await createFolder("Nutra");
    const a = await createOffer({ name: "A", folderId: folder.id });
    const b = await createOffer({ name: "B", folderId: folder.id });
    const trashed = await createOffer({ name: "C", folderId: folder.id });
    await trashOffer(trashed.id);

    await deleteFolder(folder.id);

    expect(await prisma.folder.count()).toBe(0);
    const offers = await prisma.offer.findMany({ orderBy: { name: "asc" } });
    expect(offers.map((o) => [o.id, o.folderId])).toEqual([
      [a.id, null],
      [b.id, null],
      [trashed.id, null],
    ]);
    expect((await listOffers({ folder: "sem-pasta" })).map((o) => o.id).sort()).toEqual([a.id, b.id].sort());
    // As páginas continuam lá.
    expect(await prisma.page.count()).toBe(3);
  });
});

describe("tags", () => {
  it('cria tag com cor padrão "slate" e chave normalizada', async () => {
    const tag = await createTag("Saúde");
    expect(tag).toEqual({ id: expect.any(String), name: "Saúde", color: "slate" });
    expect((await prisma.tag.findUniqueOrThrow({ where: { id: tag.id } })).nameKey).toBe("saude");

    const blue = await createTag("Finanças", "blue");
    expect(blue.color).toBe("blue");
  });

  it("não aceita duas tags com o mesmo nome (sem diferenciar maiúsculas/acentos)", async () => {
    await createTag("Saúde");
    const err = await catchError(createTag("SAUDE", "red"));
    expect(toUserMessage(err)).toEqual({ message: "Já existe uma tag com esse nome.", field: "nameKey" });
  });

  it("renomeia (atualizando a chave) e troca a cor", async () => {
    const tag = await createTag("Saúde");
    await updateTag(tag.id, { name: "Bem-estar" });
    expect(await prisma.tag.findUniqueOrThrow({ where: { id: tag.id } })).toMatchObject({
      name: "Bem-estar",
      nameKey: "bem-estar",
      color: "slate",
    });

    await updateTag(tag.id, { color: "green" });
    expect(await prisma.tag.findUniqueOrThrow({ where: { id: tag.id } })).toMatchObject({
      name: "Bem-estar",
      nameKey: "bem-estar",
      color: "green",
    });
  });

  it("não deixa renomear para o nome de outra tag", async () => {
    await createTag("Saúde");
    const other = await createTag("Finanças");
    const err = await catchError(updateTag(other.id, { name: "saúde" }));
    expect(toUserMessage(err).message).toBe("Já existe uma tag com esse nome.");
    expect((await prisma.tag.findUniqueOrThrow({ where: { id: other.id } })).name).toBe("Finanças");
  });

  it("lista tags em ordem de nome com a contagem de ofertas", async () => {
    const saude = await createTag("Saúde");
    await createTag("Alfa");
    await createOffer({ name: "Oferta", tagIds: [saude.id] });

    const tags = await listTags();
    expect(tags.map((t) => t.name)).toEqual(["Alfa", "Saúde"]);
    expect(tags.find((t) => t.id === saude.id)?._count.offers).toBe(1);
  });

  it("excluir a tag remove só os vínculos, não as ofertas", async () => {
    const saude = await createTag("Saúde");
    const financas = await createTag("Finanças");
    const a = await createOffer({ name: "A", tagIds: [saude.id, financas.id] });
    const b = await createOffer({ name: "B" });
    await setOfferTags(b.id, [saude.id]);

    await deleteTag(saude.id);

    expect(await prisma.tag.findUnique({ where: { id: saude.id } })).toBeNull();
    expect(await prisma.offerTag.count({ where: { tagId: saude.id } })).toBe(0);
    expect(await prisma.offer.count()).toBe(2);
    const remaining = await prisma.offerTag.findMany();
    expect(remaining).toEqual([{ offerId: a.id, tagId: financas.id }]);
  });

  it("excluir tag inexistente dá erro amigável", async () => {
    await expectUserError(deleteTag("nao-existe"), "Tag não encontrada.");
  });
});
