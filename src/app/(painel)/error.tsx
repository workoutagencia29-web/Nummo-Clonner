"use client";

import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/**
 * Erro inesperado numa tela do painel: o menu lateral continua disponível.
 * "Tentar de novo" usa retry(), que busca os dados no servidor outra vez (reset() só
 * desenharia de novo o mesmo resultado com erro). "Recarregar a janela" é o plano B.
 */
export default function PainelError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Empty className="border border-dashed py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AlertTriangleIcon />
        </EmptyMedia>
        <EmptyTitle>Algo deu errado ao carregar esta tela</EmptyTitle>
        <EmptyDescription>
          Seus dados continuam salvos. Tente de novo; se continuar, recarregue a janela ou feche o Offer Studio e abra
          pelo atalho outra vez.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center">
        <Button onClick={() => retry()}>
          <RotateCcwIcon />
          Tentar de novo
        </Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Recarregar a janela
        </Button>
      </EmptyContent>
    </Empty>
  );
}
