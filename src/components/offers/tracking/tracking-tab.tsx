import { notFound } from "next/navigation";
import { getTrackingPanel } from "@/server/services/tracking";
import type { TrackingSectionId } from "./helpers";
import { TrackingPanel } from "./tracking-panel";

/** Aba "Pixels e rastreamento" (componente de servidor: lê tudo numa consulta). */
export async function TrackingTab({ offerId, section }: { offerId: string; section?: TrackingSectionId }) {
  const data = await getTrackingPanel(offerId);
  if (!data) notFound();
  return <TrackingPanel data={data} initialSection={section} />;
}
