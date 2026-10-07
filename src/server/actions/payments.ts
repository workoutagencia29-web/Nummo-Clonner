"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PAYMENT_CURRENCIES, PAYMENT_LOCALES, PAYMENT_METHODS, PAYMENT_PROVIDERS } from "@/lib/payments/rules";
import { protectedAction } from "@/server/action";
import * as gateways from "@/server/services/payments/gateways";
import * as products from "@/server/services/payments/products";

const id = z.string().min(1, "Item inválido.");
const provider = z.enum(PAYMENT_PROVIDERS, { error: "Gateway de pagamento inválido." });

function refresh() {
  revalidatePath("/", "layout");
}

/** Salva (ou troca) a chave da API do gateway. A chave nunca volta para a tela. */
export const savePaymentGatewayKeyAction = protectedAction(
  z.object({ provider, apiKey: z.string().max(2000, "Essa chave é longa demais. Copie de novo.") }),
  async ({ provider, apiKey }) => {
    await gateways.savePaymentGatewayKey(provider, apiKey);
    refresh();
  },
);

export const removePaymentGatewayKeyAction = protectedAction(z.object({ provider }), async ({ provider }) => {
  await gateways.removePaymentGatewayKey(provider);
  refresh();
});

/** "Testar conexão": o servidor do app consulta o gateway (nada é cobrado). */
export const testPaymentGatewayAction = protectedAction(z.object({ provider }), async ({ provider }) => {
  const result = await gateways.testPaymentGateway(provider);
  refresh();
  return result;
});

export const savePaymentProductAction = protectedAction(
  z.object({
    linkId: id,
    name: z.string().max(500, "Nome longo demais."),
    amount: z.string().max(40, "Valor inválido."),
    currency: z.enum(PAYMENT_CURRENCIES, { error: "Escolha a moeda." }),
    methods: z.array(z.enum(PAYMENT_METHODS, { error: "Forma de pagamento inválida." })).max(PAYMENT_METHODS.length),
    locale: z.enum(PAYMENT_LOCALES, { error: "Escolha o idioma da janela." }),
    thankYouPageId: z.string().max(64).nullable(),
    accessUrl: z.string().max(4000, "Link de acesso muito longo."),
  }),
  async ({ linkId, ...input }) => {
    const saved = await products.savePaymentProduct(linkId, input);
    refresh();
    return saved;
  },
);

/** Destino do link: endereço (URL) ou pagamento na página (PAYMENT). */
export const setOfferLinkTargetAction = protectedAction(
  z.object({ linkId: id, target: z.enum(["URL", "PAYMENT"]) }),
  async ({ linkId, target }) => {
    await products.setOfferLinkTarget(linkId, target);
    refresh();
  },
);
