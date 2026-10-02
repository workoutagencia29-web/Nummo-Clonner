import { SearchXIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

export interface NotFoundAction {
  label: string;
  href: string;
}

/**
 * Tela única de "não encontrado" (oferta, clonagem, página do editor, endereço
 * qualquer): mesmo ícone, título específico, uma frase e ações coerentes.
 * `fullPage` centraliza na tela inteira (fora do painel: editor, endereço
 * desconhecido); sem ele, ocupa a área de conteúdo do painel.
 */
export function NotFoundState({
  title,
  description,
  actions = [{ label: "Ir para as ofertas", href: "/ofertas" }],
  fullPage = false,
}: {
  title: string;
  description: string;
  actions?: NotFoundAction[];
  fullPage?: boolean;
}) {
  const [primary, ...others] = actions;
  // Dentro do painel o <main> é do AppShell.
  const Wrapper = fullPage ? "main" : "div";
  return (
    <Wrapper className={cn("grid place-items-center px-4", fullPage ? "min-h-svh" : "min-h-[60svh]")}>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>
            <h1>{title}</h1>
          </EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        {primary && (
          <EmptyContent>
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href={primary.href}>{primary.label}</Link>
              </Button>
              {others.map((action) => (
                <Button key={action.href} variant="outline" asChild>
                  <Link href={action.href}>{action.label}</Link>
                </Button>
              ))}
            </div>
          </EmptyContent>
        )}
      </Empty>
    </Wrapper>
  );
}
