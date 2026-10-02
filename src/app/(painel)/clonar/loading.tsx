import { PageLoading } from "@/components/app/page-loading";

export default function Loading() {
  return (
    <PageLoading
      title="Clonar oferta"
      description="Cole o link da página. O Offer Studio baixa tudo (textos, imagens, fontes, vídeos), tira os pixels e chats do dono original e mostra uma prévia antes de salvar."
      blocks={[56, 32]}
    />
  );
}
