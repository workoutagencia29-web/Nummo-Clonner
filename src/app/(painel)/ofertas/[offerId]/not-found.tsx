import { NotFoundState } from "@/components/app/not-found-state";

export default function OfferNotFound() {
  return (
    <NotFoundState
      title="Oferta não encontrada"
      description="Ela pode ter sido excluída ou movida para a lixeira."
      actions={[
        { label: "Ir para as ofertas", href: "/ofertas" },
        { label: "Abrir a lixeira", href: "/lixeira" },
      ]}
    />
  );
}
