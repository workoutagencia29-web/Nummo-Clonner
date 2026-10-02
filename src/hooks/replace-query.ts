/**
 * Troca parâmetros do endereço atual sem recarregar nem buscar a tela no
 * servidor (history.replaceState, que o roteador do Next acompanha:
 * useSearchParams vê o valor novo). Serve para lembrar a aba escolhida: recarregar,
 * voltar de outra tela ou copiar o link abre na mesma aba. `null` tira o parâmetro.
 */
export function replaceQuery(updates: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(null, "", next);
  }
}
