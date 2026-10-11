/**
 * Preferências do app guardadas no banco (AppSetting "preferences", um JSON
 * com uma chave por preferência). Entram no backup e voltam na restauração
 * (não são deste Mac: LOCAL_SETTING_KEYS fica de fora).
 *
 * - offerCurrency: última moeda escolhida ao criar uma oferta ("Nova oferta"
 *   e "Salvar como oferta" da clonagem): vem marcada na próxima. Na primeira
 *   vez, real.
 *
 * O tema (claro/escuro) fica num cookie (src/server/actions/preferences.ts).
 */
import { type Db, prisma } from "@/lib/db";
import { DEFAULT_CURRENCY, type StoreCurrency, storeCurrency } from "@/lib/store";

export const PREFERENCES_SETTING_KEY = "preferences";

/** Última moeda escolhida ao criar uma oferta (real na primeira vez). */
export async function lastOfferCurrency(db: Db = prisma): Promise<StoreCurrency> {
  const row = await db.appSetting.findUnique({ where: { key: PREFERENCES_SETTING_KEY }, select: { value: true } });
  const value = row?.value;
  const raw = value && typeof value === "object" ? (value as { offerCurrency?: unknown }).offerCurrency : undefined;
  return raw === undefined ? DEFAULT_CURRENCY : storeCurrency(raw);
}

/**
 * Guarda a moeda escolhida ao criar uma oferta (as outras preferências do JSON
 * ficam). Numa transação (`db`), vale junto com a oferta criada.
 */
export async function rememberOfferCurrency(currency: StoreCurrency, db: Db = prisma): Promise<void> {
  const value = JSON.stringify({ offerCurrency: currency });
  // Junta com o que já está guardado (um valor estragado, que não é objeto, é trocado).
  await db.$executeRaw`
    insert into "AppSetting" (key, value, "updatedAt")
    values (${PREFERENCES_SETTING_KEY}, ${value}::jsonb, now())
    on conflict (key) do update set
      value = case when jsonb_typeof("AppSetting".value) = 'object'
                   then "AppSetting".value || excluded.value
                   else excluded.value end,
      "updatedAt" = now()`;
}
