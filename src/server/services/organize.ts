/**
 * Pastas e tags para organizar as ofertas.
 */
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { nameKey } from "@/lib/text";

export const TAG_COLORS = [
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "violet",
  "pink",
] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export function listFolders() {
  return prisma.folder.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, name: true, _count: { select: { offers: { where: { deletedAt: null } } } } },
  });
}

export function listTags() {
  return prisma.tag.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      color: true,
      _count: { select: { offers: { where: { offer: { deletedAt: null } } } } },
    },
  });
}

export async function createFolder(name: string) {
  return prisma.folder.create({ data: { name, nameKey: nameKey(name) }, select: { id: true, name: true } });
}

export async function renameFolder(id: string, name: string) {
  await prisma.folder.update({ where: { id }, data: { name, nameKey: nameKey(name) } });
}

/** Exclui a pasta; as ofertas dela ficam "sem pasta". */
export async function deleteFolder(id: string) {
  await prisma.folder.delete({ where: { id } });
}

export async function createTag(name: string, color: TagColor = "slate") {
  return prisma.tag.create({
    data: { name, nameKey: nameKey(name), color },
    select: { id: true, name: true, color: true },
  });
}

export async function updateTag(id: string, data: { name?: string; color?: TagColor }) {
  await prisma.tag.update({
    where: { id },
    data: { ...data, ...(data.name ? { nameKey: nameKey(data.name) } : {}) },
  });
}

export async function deleteTag(id: string) {
  const tag = await prisma.tag.findUnique({ where: { id }, select: { id: true } });
  if (!tag) throw new UserError("Tag não encontrada.");
  await prisma.tag.delete({ where: { id } });
}
