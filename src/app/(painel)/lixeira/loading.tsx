import { PageLoading } from "@/components/app/page-loading";

export default function Loading() {
  return (
    <PageLoading
      title="Lixeira"
      description="Ofertas apagadas ficam aqui até você restaurar ou excluir de vez."
      blocks={[18, 18, 18]}
      className=""
    />
  );
}
