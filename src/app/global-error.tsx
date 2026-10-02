"use client";

import "./globals.css";

/**
 * Último recurso: erro no layout principal. Precisa ter <html> e <body> próprios.
 * "Tentar de novo" usa retry() (busca os dados no servidor outra vez); "Recarregar"
 * recarrega a janela inteira.
 */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="pt-BR" className="system">
      <body className="grid min-h-svh place-items-center bg-background px-4 text-foreground">
        <title>Algo deu errado · Offer Studio</title>
        <main className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Algo deu errado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Seus dados continuam salvos. Tente de novo; se continuar, feche a janela do Offer Studio e abra pelo atalho
            outra vez.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              onClick={() => retry()}
            >
              Tentar de novo
            </button>
            <button
              type="button"
              className="rounded-md border px-4 py-2 text-sm font-medium"
              onClick={() => window.location.reload()}
            >
              Recarregar
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
