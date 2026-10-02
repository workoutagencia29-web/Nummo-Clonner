/**
 * Estado compartilhado pelas filas do worker. `paused` fica ligado durante uma
 * restauração de backup: as filas de clonagem e de ZIP não pegam nada novo (e
 * a limpeza automática espera), e a restauração só começa quando as duas estão
 * paradas (`cloning`/`exporting` contam desde o momento em que a fila vai
 * procurar um pedido, para não haver brecha entre olhar a pausa e pegar o pedido).
 */
export const workerState = {
  paused: false,
  cloning: false,
  exporting: false,
};

export function isPaused() {
  return workerState.paused;
}

/** Nenhuma clonagem nem ZIP em andamento (nem sendo pego da fila). */
export function isIdle() {
  return !workerState.cloning && !workerState.exporting;
}
