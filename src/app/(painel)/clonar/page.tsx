import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireSession } from "@/server/session";
import { CloneStartForm, type CloneTab } from "./clone-start-form";
import { RecentClones } from "./recent-clones";

export const metadata: Metadata = { title: "Clonar oferta" };

const TABS: CloneTab[] = ["link", "zip", "html"];

export default async function ClonarPage({ searchParams }: PageProps<"/clonar">) {
  await requireSession();
  // ?aba=zip abre direto na importação (usado pela tela de falha).
  const { aba } = await searchParams;
  const initialTab = TABS.find((t) => t === aba) ?? "link";
  const recent = await prisma.cloneJob.findMany({
    where: { parentJobId: null },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      source: true,
      sourceUrl: true,
      status: true,
      errorCode: true,
      createdAt: true,
      options: true,
      offerId: true,
      offer: { select: { deletedAt: true } },
    },
  });
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clonar oferta</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cole o link da página. O Offer Studio baixa tudo (textos, imagens, fontes, vídeos), tira os pixels e chats do
          dono original e mostra uma prévia antes de salvar.
        </p>
      </div>
      <CloneStartForm initialTab={initialTab} />
      <RecentClones
        jobs={recent.map((j) => ({
          id: j.id,
          source: j.source,
          label: j.sourceUrl ?? (j.options as { fileName?: string } | null)?.fileName ?? "HTML colado",
          status: j.status,
          errorCode: j.errorCode,
          createdAt: j.createdAt.toISOString(),
          offerId: j.offerId,
          offerTrashed: Boolean(j.offer?.deletedAt),
        }))}
      />
    </div>
  );
}
