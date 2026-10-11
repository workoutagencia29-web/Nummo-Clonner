"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CHECKOUT_LIMITS, CHECKOUT_METHODS, CHECKOUT_PROVIDERS } from "@/lib/checkout/rules";
import { CHECKOUT_EDITABLE_TEXTS } from "@/lib/checkout/texts";
import { PAYMENT_LOCALES } from "@/lib/payments/rules";
import { protectedAction } from "@/server/action";
import { checkoutPreviewUrl } from "@/server/services/checkout/preview-url";
import * as checkout from "@/server/services/checkout/products";

const id = z.string().min(1, "Item inválido.");
/** Textos do formulário: o tamanho de verdade é conferido nas regras (com a mensagem do campo). */
const text = (max = 2000) => z.string().max(max, "Texto longo demais.");
const image = z.string().max(300, "Escolha a imagem de novo.").nullable();
const itemId = z.string().max(40, "Item inválido.");

const configDraft = z.object({
  description: text(),
  compareAt: text(40),
  imageSrc: image,
  fields: z.object({ name: z.boolean(), email: z.boolean(), phone: z.boolean(), document: z.boolean() }),
  address: z.boolean(),
  shipping: z
    .array(z.object({ id: itemId, name: text(), eta: text(), price: text(40) }))
    .max(CHECKOUT_LIMITS.shipping + 5, "Opções de frete demais."),
  shippingDefault: itemId.nullable(),
  bumps: z
    .array(
      z.object({
        id: itemId,
        title: text(),
        description: text(),
        price: text(40),
        compareAt: text(40),
        imageSrc: image,
        accessUrl: text(4000),
      }),
    )
    .max(CHECKOUT_LIMITS.bumps + 5, "Order bumps demais."),
  bannerDesktopSrc: image,
  bannerMobileSrc: image,
  logoSrc: image,
  color: text(20),
  timer: text(10),
  badges: z.object({ secure: z.boolean(), guarantee: z.boolean() }),
  testimonials: z
    .array(z.object({ id: itemId, text: text(), name: text(), photoSrc: image }))
    .max(CHECKOUT_LIMITS.testimonials + 5, "Depoimentos demais."),
  texts: z.partialRecord(z.enum(CHECKOUT_EDITABLE_TEXTS), text(500)),
});

/** Salva o produto do checkout do link e liga o destino "Checkout do Offer Studio". */
export const saveCheckoutProductAction = protectedAction(
  z.object({
    linkId: id,
    name: z.string().max(500, "Nome longo demais."),
    amount: z.string().max(40, "Valor inválido."),
    provider: z.enum(CHECKOUT_PROVIDERS, { error: "Escolha o gateway de pagamento." }),
    methods: z.array(z.enum(CHECKOUT_METHODS, { error: "Forma de pagamento inválida." })).max(CHECKOUT_METHODS.length),
    locale: z.enum(PAYMENT_LOCALES, { error: "Escolha o idioma do checkout." }),
    thankYouPageId: z.string().max(64).nullable(),
    accessUrl: z.string().max(4000, "Link de acesso muito longo."),
    config: configDraft,
  }),
  async ({ linkId, ...input }) => {
    const saved = await checkout.saveCheckoutProduct(linkId, input);
    revalidatePath("/", "layout");
    return saved;
  },
);

/** "Ver checkout": a página de checkout do link na prévia (simulação, nada é cobrado). */
export const checkoutPreviewUrlAction = protectedAction(z.object({ linkId: id }), async ({ linkId }) => ({
  url: await checkoutPreviewUrl(linkId),
}));
