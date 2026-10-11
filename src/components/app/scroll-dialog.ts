/**
 * Classes de um diálogo alto ("Nova oferta", "Nova página"): só o miolo rola;
 * o título e o rodapé com o botão de criar ficam sempre à vista (antes, numa
 * janela de 1440×900, o "Criar oferta" ficava abaixo da dobra e o diálogo
 * inteiro rolava junto). Use no DialogContent > form > DialogHeader / miolo /
 * DialogFooter.
 */
export const SCROLL_DIALOG = {
  content: "flex max-h-[94vh] flex-col gap-0 overflow-hidden p-0",
  form: "flex min-h-0 flex-1 flex-col",
  header: "px-6 pt-6 pb-4",
  // pt-1: espaço para o anel de foco dos cartões da primeira linha.
  body: "min-h-0 flex-1 overflow-y-auto px-6 pt-1 pb-5",
  footer: "border-t bg-background px-6 py-4",
} as const;
