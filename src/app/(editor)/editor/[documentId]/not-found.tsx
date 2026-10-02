import { NotFoundState } from "@/components/app/not-found-state";

export default function EditorNotFound() {
  return (
    <NotFoundState
      fullPage
      title="Página não encontrada"
      description="Esta página foi excluída, ou a oferta dela está na lixeira."
      actions={[
        { label: "Ir para as ofertas", href: "/ofertas" },
        { label: "Abrir a lixeira", href: "/lixeira" },
      ]}
    />
  );
}
