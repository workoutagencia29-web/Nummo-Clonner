import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto de uma tela do painel enquanto o servidor responde: o título já
 * aparece (o menu e a tela dizem a mesma coisa) e os blocos chegam depois.
 */
export function PageLoading({
  title,
  description,
  blocks = [40, 28],
  className = "max-w-3xl",
}: {
  title: string;
  description: string;
  /** Altura de cada bloco, em unidades do Tailwind (40 = 10rem). */
  blocks?: number[];
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-6 ${className}`} aria-busy="true">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <output className="sr-only">Carregando…</output>
      {blocks.map((h, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lista fixa de blocos decorativos.
        <Skeleton key={i} className="w-full rounded-xl" style={{ height: `${h / 4}rem` }} />
      ))}
    </div>
  );
}
