"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  HEADER_COPY_MAX_BYTES,
  PAGE_NAME_MAX,
  PRODUCT_NAME_MAX,
  PRODUCT_PAGES_MAX,
  PRODUCT_PHOTO_MAX,
} from "@/lib/product-pages";
import { protectedAction } from "@/server/action";
import { createProductPages } from "@/server/services/store";

const id = z.string().min(1, "Item inválido.");

/** Bem acima do limite do serviço (que conta bytes e tem a mensagem certa). */
const HEADER_TEXT_MAX = HEADER_COPY_MAX_BYTES * 4;

const product = z.object({
  pageName: z
    .string()
    .trim()
    .min(1, "Dê um nome para a página.")
    .max(PAGE_NAME_MAX, `O nome da página pode ter no máximo ${PAGE_NAME_MAX} caracteres.`),
  // Limpo e cortado no serviço (cleanStoreText); aqui só um teto. Sem nome, o serviço
  // diz qual é o produto ("O produto 3 está sem nome…").
  name: z
    .string()
    .trim()
    .max(PRODUCT_NAME_MAX * 4, `O nome do produto pode ter no máximo ${PRODUCT_NAME_MAX} caracteres.`),
  photo: z
    .string()
    .max(PRODUCT_PHOTO_MAX + 100, "A foto do produto é grande demais: troque por uma imagem enviada pelo editor.")
    .default(""),
  data: z.record(z.string().max(60), z.string().max(200, "Dado do produto longo demais.")).default({}),
  currency: z.string().max(8).default("BRL"),
  lang: z.string().max(8).default(""),
  linkKey: z.string().max(120, "Link da oferta inválido.").nullable().default(null),
});

/**
 * "＋ Criar página deste produto" (cartão da vitrine) e "Criar as páginas que
 * faltam" (vitrine): uma página do modelo "Página do produto" para cada
 * produto, já preenchida e com o cabeçalho da vitrine. O editor liga os
 * cartões às páginas devolvidas.
 */
export const createProductPagesAction = protectedAction(
  z.object({
    offerId: id,
    storePageId: id,
    header: z
      .object({
        html: z.string().max(HEADER_TEXT_MAX, "O cabeçalho da loja é grande demais para copiar."),
        css: z.string().max(HEADER_TEXT_MAX, "O cabeçalho da loja é grande demais para copiar."),
      })
      .nullable()
      .default(null),
    products: z
      .array(product)
      .min(1, "Escolha pelo menos um produto.")
      .max(PRODUCT_PAGES_MAX, `Dá para criar até ${PRODUCT_PAGES_MAX} páginas de produto de uma vez.`),
  }),
  async (input) => {
    const pages = await createProductPages(input);
    revalidatePath("/", "layout");
    return pages;
  },
);
