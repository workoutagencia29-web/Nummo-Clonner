import { PageLoading } from "@/components/app/page-loading";

export default function Loading() {
  return (
    <PageLoading
      title="Clonagem"
      description="Abrindo o andamento e a revisão da cópia…"
      blocks={[72, 24]}
      className=""
    />
  );
}
