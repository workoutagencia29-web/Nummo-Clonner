"use server";

/**
 * Ações das configurações da oferta (dados da empresa para as páginas legais,
 * SEO padrão, idioma) e do SEO de cada página. A tela lê tudo com
 * getOfferSettingsPanel (src/server/services/offer-settings.ts).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PAGE_LANGUAGES } from "@/lib/offer-settings";
import { protectedAction } from "@/server/action";
import { getPageSeo, saveOfferSettings, savePageSeo } from "@/server/services/offer-settings";

const offerId = z.string().min(1, "Oferta inválida.").max(40, "Oferta inválida.");
const pageId = z.string().min(1, "Página inválida.").max(40, "Página inválida.");
/** Limites finos (e mensagens por campo) ficam no serviço. */
const text = z.string().max(2000, "Texto longo demais.");
const image = z.string().max(300, "Escolha a imagem de novo na biblioteca.").nullable();

function refresh() {
  revalidatePath("/", "layout");
}

export const saveOfferSettingsAction = protectedAction(
  z.object({
    offerId,
    company: z.object({ name: text, document: text, email: text, phone: text, address: text }).partial().optional(),
    seo: z
      .object({ title: text, description: text, faviconKey: image, ogImageKey: image, noindex: z.boolean() })
      .partial()
      .optional(),
    language: z.enum(PAGE_LANGUAGES, { error: "Escolha o idioma da página." }).optional(),
  }),
  async ({ offerId, ...patch }) => {
    const settings = await saveOfferSettings(offerId, patch);
    refresh();
    return settings;
  },
);

export const getPageSeoAction = protectedAction(z.object({ pageId }), ({ pageId }) => getPageSeo(pageId));

/** SEO da página (vazio/null = herda da oferta). */
export const savePageSeoAction = protectedAction(
  z.object({
    pageId,
    title: text.optional(),
    description: text.optional(),
    faviconKey: image.optional(),
    ogImageKey: image.optional(),
    noindex: z.boolean().nullable().optional(),
  }),
  async ({ pageId, ...patch }) => {
    const seo = await savePageSeo(pageId, patch);
    refresh();
    return seo;
  },
);
