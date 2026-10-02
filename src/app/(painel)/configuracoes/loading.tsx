import { PageLoading } from "@/components/app/page-loading";

export default function Loading() {
  return (
    <PageLoading
      title="Configurações"
      description="Sua conta, aparência, tags, backup e o estado do sistema."
      blocks={[36, 44, 32, 40]}
    />
  );
}
