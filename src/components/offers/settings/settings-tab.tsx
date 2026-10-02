import { notFound } from "next/navigation";
import { getOfferSettingsPanel } from "@/server/services/offer-settings";
import { OfferSettingsPanel } from "./offer-settings-panel";

/** Aba "Empresa e SEO" (componente de servidor: lê tudo numa consulta). */
export async function OfferSettingsTab({ offerId }: { offerId: string }) {
  const data = await getOfferSettingsPanel(offerId);
  if (!data) notFound();
  return <OfferSettingsPanel data={data} />;
}
