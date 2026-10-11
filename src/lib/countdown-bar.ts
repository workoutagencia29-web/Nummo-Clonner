/**
 * Visual da "Contagem no topo (barra)": barra fina preta de ponta a ponta com a
 * frase, "TERMINA EM" e o tempo em caixinhas (00 : 14 : 46). Os mesmos valores
 * desenham o bloco do editor (src/editor/widgets/countdown.ts, regras editáveis)
 * e a faixa do prêmio da roleta (PRIZE_CSS em src/runtime/widgets/css.ts), para
 * as duas terem a mesma cara. Entra no script das páginas: só constantes.
 */

/** Cores padrão (iguais à barra que mais converte). */
export const BAR_COLORS = {
  /** Fundo da barra. */
  bg: "#000000",
  /** Frase e "TERMINA EM". */
  text: "#ffffff",
  /** Fundo das caixinhas. */
  boxBg: "#0b0605",
  /** Borda fina dourada das caixinhas. */
  boxBorder: "#5b5431",
  /** Números. */
  num: "#fde047",
} as const;

/** Medidas (px): computador e celular (até 480 px). */
export const BAR_SIZES = {
  pad: "11px 16px",
  padMobile: "7px 10px",
  gap: "6px 18px",
  gapMobile: "5px 12px",
  msg: "16px",
  msgMobile: "14px",
  label: "14px",
  labelMobile: "12px",
  num: "18px",
  numMobile: "16px",
  boxW: "52px",
  boxWMobile: "42px",
  boxPad: "4px 0",
  boxPadMobile: "3px 0",
  sepGap: "7px",
  /** Peso da frase e dos números (semi-negrito, como na barra de referência). */
  weight: "600",
  labelSpacing: "0",
  sepGapMobile: "5px",
} as const;

export const BAR_TEXTS = {
  /** Frase do bloco novo (a da barra de referência; o usuário troca pelo desconto real). */
  msg: "95% OFF aplicado automaticamente!",
  /**
   * Frase de um contador grande trocado para barra sem título próprio: neutra,
   * sem percentual (a página já tem o preço dela).
   */
  converted: "Sua condição especial está ativa!",
  label: "TERMINA EM",
} as const;

/**
 * Blocos que começam escondidos na página: aparece depois de N segundos (VSL),
 * popup de saída, etapa do quiz, "só para quem ganhou/não ganhou" na roleta.
 * Uma barra dentro deles não vai para o topo (sairia do bloco e apareceria
 * para todos desde o começo): fica no lugar e aparece junto com o bloco.
 * Usado pela página (src/runtime/widgets/countdown.ts) e pelo selo do canvas.
 */
export const HIDDEN_HOST =
  '[data-os-delay]:not([data-os-delay="0"]),[data-os-widget=exit-popup],[data-os-qz-step],[data-os-premio],[hidden]';
