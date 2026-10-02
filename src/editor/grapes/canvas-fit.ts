/**
 * Canvas do tamanho real do dispositivo, reduzido para caber.
 *
 * O modo "Desktop" tem largura de computador de verdade (1280px). Sem isso, o
 * canvas ficava só com a sobra entre os painéis (672px numa tela de 1280), as
 * regras de tablet/celular da página (e do próprio editor) valiam no "Desktop"
 * e as edições de Desktop pareciam não fazer nada.
 *
 * Quando o dispositivo não cabe, o canvas usa o zoom do GrapesJS (as marcações
 * de seleção, barra e arrastar continuam certas) e a moldura fica centralizada,
 * com a altura toda da área. Recalcula ao trocar de dispositivo e quando a área
 * muda de tamanho.
 *
 * "Tamanho real" (setCanvasZoomMode "actual"): sem reduzir; a página rola para
 * os lados (Shift + roda do mouse, dois dedos no trackpad ou setCanvasPan). O
 * zoom atual sai no evento CANVAS_FIT_EVENT (o editor mostra a porcentagem).
 */
import type { Editor } from "grapesjs";
import { editorFrame, watchEditor } from "./lifecycle";

/** Espaço livre de cada lado quando o dispositivo é reduzido. */
export const FIT_GUTTER = 16;
/** Menor zoom (%): abaixo disso a página fica ilegível; a sobra é cortada. */
export const MIN_ZOOM = 25;

/** "fit": reduz até caber (padrão); "actual": tamanho real, rolando para os lados. */
export type ZoomMode = "fit" | "actual";

/** Evento do editor com o zoom aplicado ({@link CanvasFitInfo}). */
export const CANVAS_FIT_EVENT = "os:canvas-fit";

export interface CanvasFitInfo {
  /** Escala aplicada (1 = tamanho real). */
  scale: number;
  mode: ZoomMode;
  /** Quanto a página está deslocada para a esquerda (px) e o máximo possível ("actual"). */
  panX: number;
  maxPan: number;
}

interface FitControl {
  mode: ZoomMode;
  panX: number;
  refresh: () => void;
}

const controls = new WeakMap<Editor, FitControl>();

/** Troca entre "Ajustar à janela" e "Tamanho real (100%)". */
export function setCanvasZoomMode(editor: Editor, mode: ZoomMode) {
  const control = controls.get(editor);
  if (!control || control.mode === mode) return;
  control.mode = mode;
  control.panX = 0;
  control.refresh();
}

/** Desloca a página para os lados no "Tamanho real" (px a partir da esquerda). */
export function setCanvasPan(editor: Editor, panX: number) {
  const control = controls.get(editor);
  if (!control || control.mode !== "actual") return;
  control.panX = Math.max(0, panX);
  control.refresh();
}

/** Moldura em tamanho real numa área menor: encostada à esquerda, deslocada por `panX`. */
export function actualSize(
  deviceWidth: number,
  areaWidth: number,
  panX: number,
): FitResult & { panX: number; maxPan: number } {
  const width = deviceWidth > 0 ? deviceWidth : areaWidth;
  const maxPan = Math.max(0, width + 2 * FIT_GUTTER - areaWidth);
  if (!maxPan)
    return { scale: 1, width, height: null, left: Math.max(0, (areaWidth - width) / 2), top: 0, panX: 0, maxPan };
  const pan = Math.min(Math.max(0, panX), maxPan);
  return { scale: 1, width, height: null, left: FIT_GUTTER - pan, top: 0, panX: pan, maxPan };
}

export interface FitResult {
  /** Escala (1 = tamanho real). */
  scale: number;
  /** Largura da moldura (px, antes da escala). */
  width: number;
  /** Altura da moldura (px, antes da escala), ou null para ocupar a área. */
  height: number | null;
  /** Posição da moldura na área (px, depois da escala). */
  left: number;
  top: number;
}

/**
 * Quanto reduzir um dispositivo de `deviceWidth`px para caber numa área de
 * `areaWidth` × `areaHeight` (também serve para a prévia do dispositivo).
 */
export function fitDevice(deviceWidth: number, areaWidth: number, areaHeight: number): FitResult {
  if (!(deviceWidth > 0) || !(areaWidth > 0) || deviceWidth + 2 * FIT_GUTTER <= areaWidth) {
    const width = deviceWidth > 0 ? deviceWidth : areaWidth;
    return { scale: 1, width, height: null, left: Math.max(0, (areaWidth - width) / 2), top: 0 };
  }
  const scale = Math.max(MIN_ZOOM / 100, (areaWidth - 2 * FIT_GUTTER) / deviceWidth);
  return {
    scale,
    width: deviceWidth,
    height: areaHeight > 0 ? areaHeight / scale : null,
    left: Math.max(0, (areaWidth - deviceWidth * scale) / 2),
    top: 0,
  };
}

interface FrameModel {
  get(key: string): unknown;
  set(values: Record<string, unknown>, opts?: Record<string, unknown>): void;
}

/** Liga o ajuste automático ao editor. Devolve a função que desliga. */
export function installCanvasFit(editor: Editor, container: HTMLElement) {
  watchEditor(editor);
  let raf = 0;
  let last = "";
  let lastInfo = "";
  const control: FitControl = {
    mode: "fit",
    panX: 0,
    refresh: () => {
      last = "";
      schedule();
    },
  };
  controls.set(editor, control);

  const announce = (info: CanvasFitInfo) => {
    const key = `${info.scale}|${info.mode}|${info.panX}|${info.maxPan}`;
    if (key === lastInfo) return;
    lastInfo = key;
    editor.trigger(CANVAS_FIT_EVENT, info);
  };

  const apply = () => {
    raf = 0;
    const canvas = editor.Canvas;
    const area = canvas.getFramesEl?.() as HTMLElement | undefined;
    const frame = canvas.getFrame?.() as unknown as FrameModel | undefined;
    if (!area || !frame) return;
    const areaW = area.clientWidth;
    const areaH = area.clientHeight;
    if (!areaW || !areaH) return;
    const device = editor.Devices.getSelected();
    const deviceWidth = Number.parseFloat(String(device?.get("width") ?? "")) || 0;
    const actual = control.mode === "actual" ? actualSize(deviceWidth, areaW, control.panX) : null;
    if (actual) control.panX = actual.panX;
    const fit = actual ?? fitDevice(deviceWidth, areaW, areaH);
    announce({ scale: fit.scale, mode: control.mode, panX: actual?.panX ?? 0, maxPan: actual?.maxPan ?? 0 });
    const key = `${device?.id}|${areaW}|${areaH}|${fit.scale}|${control.mode}|${fit.left}`;
    if (key === last && canvas.getZoom() === fit.scale * 100) return;
    last = key;

    const deviceHeight = String(device?.get("height") ?? "");
    const height = fit.height ? `${fit.height}px` : deviceHeight;
    if (String(frame.get("height") ?? "") !== height) frame.set({ height }, { noUndo: 1, avoidStore: 1 });
    canvas.setZoom(fit.scale * 100);

    if (fit.scale === 1) {
      // Tamanho real numa área menor: a moldura (encostada à esquerda) anda para os lados.
      canvas.setCoords(actual?.maxPan ? fit.left : 0, 0);
      return;
    }
    // A área escala a partir do centro; a moldura mais larga que a área fica
    // encostada à esquerda (margin:auto não centraliza) e com altura maior que
    // a área, encostada no topo.
    const layoutLeft = Math.max(0, (areaW - fit.width) / 2);
    const layoutTop = Math.max(0, (areaH - (fit.height ?? areaH)) / 2);
    const x = fit.left - areaW / 2 - (layoutLeft - areaW / 2) * fit.scale;
    const y = fit.top - areaH / 2 - (layoutTop - areaH / 2) * fit.scale;
    canvas.setCoords(x, y);
  };

  const schedule = () => {
    if (raf) return;
    raf = editorFrame(editor, apply);
  };

  // Depois que o GrapesJS aplica o dispositivo na moldura (Canvas.updateDevice).
  const onDevice = () => {
    last = "";
    schedule();
  };
  editor.on("change:device", onDevice);
  editor.on("load", onDevice);
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  observer?.observe(container);

  // Tamanho real: rolar para os lados (trackpad, Shift + roda) desloca a página.
  const onWheel = (e: WheelEvent) => {
    if (control.mode !== "actual") return;
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (!dx) return;
    e.preventDefault();
    control.panX = Math.max(0, control.panX + dx);
    control.refresh();
  };
  let frameWindow: Window | null = null;
  const watchFrame = () => {
    const win = editor.Canvas.getWindow?.() ?? null;
    if (win === frameWindow) return;
    frameWindow?.removeEventListener("wheel", onWheel);
    frameWindow = win;
    frameWindow?.addEventListener("wheel", onWheel, { passive: false });
  };
  editor.on("load canvas:frame:load", watchFrame);
  container.addEventListener("wheel", onWheel, { passive: false });

  const dispose = () => {
    if (raf) cancelAnimationFrame(raf);
    observer?.disconnect();
    editor.off("change:device", onDevice);
    editor.off("load", onDevice);
    editor.off("load canvas:frame:load", watchFrame);
    container.removeEventListener("wheel", onWheel);
    frameWindow?.removeEventListener("wheel", onWheel);
    frameWindow = null;
    controls.delete(editor);
  };
  editor.on("destroy", dispose);
  return dispose;
}
