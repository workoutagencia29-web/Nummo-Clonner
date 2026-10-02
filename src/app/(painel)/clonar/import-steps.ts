/**
 * Como salvar uma página pelo navegador para importar no Offer Studio. O
 * "Salvar como… página completa" cria um arquivo .html e, ao lado, uma pasta
 * “_files”: o ZIP precisa dos dois (só a pasta não tem a página principal).
 * Completar com o destino: "… e envie o .zip aqui." / "… na aba “Arquivo ZIP”."
 */
export const SAVE_PAGE_STEPS =
  "No Chrome: Arquivo → Salvar página como… → “Página da Web, completa”. Isso cria um arquivo .html e uma pasta “_files” com o mesmo nome. Selecione os dois juntos, clique com o botão direito → Comprimir e envie o .zip";

/** Safari: o "Arquivo Web" (.webarchive) não dá para importar; o caminho é salvar por outro navegador. */
export const SAFARI_SAVE_NOTE =
  "No Safari, o “Arquivo Web” (.webarchive) não serve para importar: abra a mesma página no Chrome, Firefox ou Edge e salve como acima (no Firefox: Arquivo → Salvar página como… → “Página web completa”).";
