"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { protectedAction } from "@/server/action";
import * as organize from "@/server/services/organize";

const id = z.string().min(1, "Item inválido.");
const folderName = z
  .string()
  .trim()
  .min(1, "Dê um nome para a pasta.")
  .max(60, "O nome pode ter no máximo 60 caracteres.");
const tagName = z.string().trim().min(1, "Dê um nome para a tag.").max(40, "O nome pode ter no máximo 40 caracteres.");
const tagColor = z.enum(organize.TAG_COLORS);

function refreshAll() {
  revalidatePath("/", "layout");
}

export const createFolderAction = protectedAction(z.object({ name: folderName }), async ({ name }) => {
  const folder = await organize.createFolder(name);
  refreshAll();
  return folder;
});

export const renameFolderAction = protectedAction(z.object({ id, name: folderName }), async ({ id, name }) => {
  await organize.renameFolder(id, name);
  refreshAll();
});

export const deleteFolderAction = protectedAction(z.object({ id }), async ({ id }) => {
  await organize.deleteFolder(id);
  refreshAll();
});

export const createTagAction = protectedAction(
  z.object({ name: tagName, color: tagColor.default("slate") }),
  async ({ name, color }) => {
    const tag = await organize.createTag(name, color);
    refreshAll();
    return tag;
  },
);

export const updateTagAction = protectedAction(
  z.object({ id, name: tagName.optional(), color: tagColor.optional() }),
  async ({ id, ...data }) => {
    await organize.updateTag(id, data);
    refreshAll();
  },
);

export const deleteTagAction = protectedAction(z.object({ id }), async ({ id }) => {
  await organize.deleteTag(id);
  refreshAll();
});
