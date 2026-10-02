/**
 * Começa o download de um arquivo do próprio painel sem sair da tela (o
 * servidor manda Content-Disposition: attachment com o nome certo).
 */
export function startDownload(url: string, fileName?: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName ?? "";
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const DOWNLOAD_FAILED_MESSAGE = "Não foi possível baixar este ZIP. Gere de novo.";
const OFFLINE = "Não foi possível falar com o Offer Studio. Ele ainda está aberto?";

/**
 * Confere com o servidor se o ZIP ainda pode ser baixado (HEAD, sem baixar
 * nada) e só então começa o download. Devolve null quando começou, ou o
 * motivo em português (arquivo apagado do disco, ZIP que falhou…): um link de
 * download comum falharia calado, só com "Falha" na barra do navegador.
 */
export async function checkedDownload(
  url: string,
  fileName?: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  let head: Response;
  try {
    head = await fetcher(url, { method: "HEAD", cache: "no-store" });
  } catch {
    return OFFLINE;
  }
  if (head.ok) {
    startDownload(url, fileName);
    return null;
  }
  // O motivo vem no corpo do GET (em erro, a resposta é um JSON pequeno, não o ZIP).
  try {
    const res = await fetcher(url, { cache: "no-store", headers: { accept: "application/json" } });
    if (res.ok) {
      // Ficou pronto entre as duas perguntas: não lê o ZIP aqui, baixa normalmente.
      void res.body?.cancel().catch(() => {});
      startDownload(url, fileName);
      return null;
    }
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch {
    // sem motivo: mensagem padrão
  }
  return DOWNLOAD_FAILED_MESSAGE;
}
