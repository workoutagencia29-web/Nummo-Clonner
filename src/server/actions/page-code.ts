"use server";

import { z } from "zod";
import { CODE_CATEGORIES } from "@/lib/tracking/schema";
import { protectedAction } from "@/server/action";
import { getPageCodeView, PAGE_CODE_MAX_BYTES, savePageCode } from "@/server/services/page-code";
import { savePageCodeCategory } from "@/server/services/tracking";

const pageId = z.string().min(1, "Página inválida.");
/** Checagem rápida por caracteres; o limite em bytes (somando os três) fica no serviço. */
const code = (where: string) =>
  z.string().max(PAGE_CODE_MAX_BYTES, `O código ${where} passou do limite de 200 KB.`).default("");

/** Códigos livres da página (head, início e fim do body) e quando carregam. */
export const getPageCodeAction = protectedAction(z.object({ pageId }), ({ pageId }) => getPageCodeView(pageId));

export const savePageCodeAction = protectedAction(
  z.object({
    pageId,
    head: code("do <head>"),
    bodyStart: code("do início do <body>"),
    bodyEnd: code("do fim do <body>"),
    /** Quando carregam (null = automático). Sem o campo, a escolha salva continua. */
    category: z.enum(CODE_CATEGORIES, { error: "Escolha quando o código carrega." }).nullable().optional(),
  }),
  async ({ pageId, category, ...input }) => {
    const saved = await savePageCode(pageId, input);
    const view = category !== undefined ? await savePageCodeCategory(pageId, category) : undefined;
    return { ...saved, ...(view !== undefined ? { category: view } : {}) };
  },
);
