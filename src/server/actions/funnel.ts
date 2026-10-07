"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FUNNEL_MAX_PRIZES, FUNNEL_MIN_PRIZES, PRIZE_COUPON_MAX, PRIZE_TEXT_MAX } from "@/lib/funnel";
import { protectedAction } from "@/server/action";
import { createQuizWheelFunnel } from "@/server/services/funnel";

const id = z.string().min(1, "Item inválido.");

const prize = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Escreva o prêmio (ex.: 30% OFF).")
    .max(PRIZE_TEXT_MAX, `O prêmio pode ter no máximo ${PRIZE_TEXT_MAX} caracteres.`),
  chance: z.number("Chance inválida."),
  // O endereço é conferido no serviço (linkUrlProblem, os mesmos textos da tela).
  url: z.string().max(2000, "Link muito longo.").default(""),
  coupon: z
    .string()
    .trim()
    .max(PRIZE_COUPON_MAX, `O cupom pode ter no máximo ${PRIZE_COUPON_MAX} caracteres.`)
    .default(""),
});

/**
 * "Adicionar funil Quiz → Roleta": cria as páginas Quiz e Roleta já ligadas
 * (quiz → roleta → página de vendas), um link de checkout por prêmio, e torna
 * o quiz a página inicial.
 */
export const createQuizWheelFunnelAction = protectedAction(
  z.object({
    offerId: id,
    salesPageId: z.string().min(1, "Escolha a página de vendas."),
    prizes: z
      .array(prize)
      .min(FUNNEL_MIN_PRIZES, `A roleta precisa de pelo menos ${FUNNEL_MIN_PRIZES} prêmios.`)
      .max(FUNNEL_MAX_PRIZES, `A roleta pode ter no máximo ${FUNNEL_MAX_PRIZES} prêmios.`),
    allowExisting: z.boolean().default(false),
  }),
  async (input) => {
    const funnel = await createQuizWheelFunnel(input);
    revalidatePath("/", "layout");
    return funnel;
  },
);
