import type { Metadata } from "next";
import { NotFoundState } from "@/components/app/not-found-state";

export const metadata: Metadata = { title: "Página não encontrada" };

export default function NotFound() {
  return (
    <NotFoundState
      fullPage
      title="Página não encontrada"
      description="Este endereço não existe no Offer Studio. Confira o link ou volte para as suas ofertas."
    />
  );
}
