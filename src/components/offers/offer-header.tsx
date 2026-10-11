import type { ReactNode } from "react";

/**
 * Cabeçalho da tela da oferta: miniatura, nome, botão "Ações" e, embaixo do
 * nome, as informações (`children`). O nome e o botão só ficam lado a lado a
 * partir do lg: entre 768 e ~1000 px o menu lateral (256 px) e a miniatura já
 * ocupam boa parte da largura, e lado a lado o nome quebrava letra a letra.
 */
export function OfferHeader({
  thumbnail,
  title,
  actions,
  children,
}: {
  thumbnail: ReactNode;
  title: string;
  actions: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex items-start gap-4">
      <div className="aspect-[16/10] w-24 shrink-0 overflow-hidden rounded-lg border bg-muted sm:w-44">{thumbnail}</div>
      <div className="min-w-0 flex-1">
        {/* Até o lg, o botão desce para baixo do título (senão o nome quebra no meio da palavra). */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <h1 className="min-w-0 text-xl font-semibold tracking-tight break-words sm:text-2xl">{title}</h1>
          {actions}
        </div>
        {children}
      </div>
    </header>
  );
}
