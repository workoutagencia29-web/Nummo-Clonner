import { EyeOffIcon, GlobeIcon } from "lucide-react";

/** Como a página aparece no Google (aproximado): ícone, título e descrição. */
export function SearchPreview({
  title,
  description,
  faviconSrc,
  noindex,
  path = "",
}: {
  title: string;
  description: string;
  faviconSrc: string | null;
  noindex: boolean;
  path?: string;
}) {
  return (
    <figure className="flex flex-col gap-2" aria-label="Prévia no Google">
      <div className="rounded-lg border bg-white p-4 text-left shadow-xs dark:bg-zinc-950">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center overflow-hidden rounded-full border bg-zinc-100 dark:bg-zinc-800">
            {faviconSrc ? (
              // biome-ignore lint/performance/noImgElement: imagem da biblioteca da oferta, servida pelo próprio app.
              <img src={faviconSrc} alt="" className="size-4 object-contain" />
            ) : (
              <GlobeIcon className="size-3.5 text-zinc-500" aria-hidden="true" />
            )}
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm text-zinc-900 dark:text-zinc-100">seudominio.com.br</span>
            <span className="truncate text-xs text-zinc-500">https://seudominio.com.br{path}</span>
          </span>
        </div>
        <p className="mt-2 line-clamp-1 text-lg text-[#1a0dab] leading-snug dark:text-[#8ab4f8]">
          {title || "Título da página"}
        </p>
        <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
          {description || "Escreva uma descrição para aparecer aqui. Sem ela, o Google escolhe um trecho da página."}
        </p>
      </div>
      {noindex ? (
        <figcaption className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <EyeOffIcon className="size-3.5" aria-hidden="true" />
          Com “não aparecer no Google”, esta prévia não vai aparecer nas buscas.
        </figcaption>
      ) : (
        <figcaption className="text-xs text-muted-foreground">Prévia aproximada do resultado de busca.</figcaption>
      )}
    </figure>
  );
}
