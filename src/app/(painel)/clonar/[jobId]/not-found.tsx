import { NotFoundState } from "@/components/app/not-found-state";

export default function CloneNotFound() {
  return (
    <NotFoundState
      title="Clonagem não encontrada"
      description="Ela pode ter sido apagada pela limpeza automática ou o link está incompleto. Comece uma nova clonagem."
      actions={[
        { label: "Clonar uma página", href: "/clonar" },
        { label: "Ir para as ofertas", href: "/ofertas" },
      ]}
    />
  );
}
