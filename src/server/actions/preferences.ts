"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { THEME_COOKIE, THEMES } from "@/lib/theme";
import { protectedAction } from "@/server/action";

/** Salva o tema escolhido (claro, escuro ou do sistema) num cookie de 1 ano. */
export const setThemeAction = protectedAction(z.object({ theme: z.enum(THEMES) }), async ({ theme }) => {
  (await cookies()).set(THEME_COOKIE, theme, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false,
  });
  revalidatePath("/", "layout");
});
