"use client";

import { ArrowRightIcon, CopyPlusIcon, FolderOpenIcon, LinkIcon, PlusIcon, SearchXIcon } from "lucide-react";
import Link from "next/link";
import { useShell } from "@/components/app/app-shell";
import { OFFER_START_TEMPLATES, TemplateThumbnail } from "@/components/offers/template-gallery";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/** Modelos mostrados no cartão "Começar de um modelo" do painel vazio. */
const PREVIEW_TEMPLATES = OFFER_START_TEMPLATES.filter((t) => ["vendas-longa", "vsl", "captura"].includes(t.id));

/**
 * "Clonar oferta" e "Nova oferta" do cabeçalho: mesmos rótulos e mesma ordem do
 * menu lateral (clonar primeiro).
 */
export function NewOfferButton({ folderId }: { folderId: string | null }) {
  const { openCreateOffer } = useShell();
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild>
        <Link href="/clonar">
          <CopyPlusIcon />
          Clonar oferta
        </Link>
      </Button>
      <Button variant="outline" onClick={() => openCreateOffer(folderId)}>
        <PlusIcon />
        Nova oferta
      </Button>
    </div>
  );
}

const startCardClass =
  "group flex flex-col overflow-hidden rounded-xl border bg-card text-left shadow-xs outline-none transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Primeiro acesso (nenhuma oferta): os dois caminhos, lado a lado. */
function FirstOffer() {
  const { openCreateOffer } = useShell();
  return (
    <section aria-labelledby="first-offer-title" className="flex flex-col gap-4">
      <div>
        <h2 id="first-offer-title" className="text-lg font-semibold tracking-tight">
          Crie sua primeira oferta
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Clone uma página que já existe ou comece de um modelo pronto. Tudo pode ser editado depois.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/clonar" className={startCardClass}>
          <span className="grid aspect-[16/7] place-items-center border-b bg-primary/5 text-primary">
            <span className="flex items-center gap-3 rounded-lg border bg-background px-4 py-2.5 text-sm text-muted-foreground shadow-xs">
              <LinkIcon className="size-4 shrink-0 text-primary" />
              <span className="truncate">https://pagina-da-oferta.com.br</span>
            </span>
          </span>
          <span className="flex flex-1 flex-col gap-1 p-4">
            <span className="flex items-center gap-2 font-medium">
              <CopyPlusIcon className="size-4 text-primary" />
              Clonar uma página pelo link
              <ArrowRightIcon className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </span>
            <span className="text-sm text-muted-foreground">
              Cole o link e o Offer Studio copia a página para você editar. Também aceita um ZIP ou um arquivo HTML.
            </span>
          </span>
        </Link>
        <button type="button" className={startCardClass} onClick={() => openCreateOffer(null)}>
          <span className="grid aspect-[16/7] grid-cols-3 gap-3 border-b bg-muted/60 p-4">
            {PREVIEW_TEMPLATES.map((t) => (
              <span key={t.id} className="overflow-hidden rounded-md border bg-background shadow-xs">
                <TemplateThumbnail template={t} />
              </span>
            ))}
          </span>
          <span className="flex flex-1 flex-col gap-1 p-4">
            <span className="flex items-center gap-2 font-medium">
              <PlusIcon className="size-4 text-primary" />
              Começar de um modelo
              <ArrowRightIcon className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </span>
            <span className="text-sm text-muted-foreground">
              Página de vendas, VSL, captura, advertorial, upsell e obrigado, prontas para trocar textos e imagens.
            </span>
          </span>
        </button>
      </div>
    </section>
  );
}

export function EmptyOffers({
  filtering,
  inFolder,
  folderId,
}: {
  filtering: boolean;
  /** Vendo uma pasta (ou "sem pasta"): o painel não está vazio de verdade. */
  inFolder: boolean;
  folderId: string | null;
}) {
  if (filtering) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>Nenhuma oferta encontrada</EmptyTitle>
          <EmptyDescription>Tente outra busca ou limpe os filtros.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" asChild>
            <Link href={folderId ? `/ofertas?pasta=${folderId}` : "/ofertas"}>Limpar filtros</Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (!inFolder) return <FirstOffer />;

  return (
    <Empty className="border border-dashed py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderOpenIcon />
        </EmptyMedia>
        <EmptyTitle>Esta pasta está vazia</EmptyTitle>
        <EmptyDescription>
          Clone ou crie uma oferta aqui, ou mova ofertas para esta pasta pelo menu de cada cartão.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <NewOfferButton folderId={folderId} />
      </EmptyContent>
    </Empty>
  );
}
