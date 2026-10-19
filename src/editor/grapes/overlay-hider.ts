/**
 * "Esconder sobreposições" (botão do editor, ao lado do "Modo prévia"): esconde
 * NO CANVAS tudo que flutua por cima da página — pop-ups, barras e modais fixos
 * (inclusive de páginas clonadas: aviso de cookies, CEP, pagamento, pop-up do
 * site original) e o pop-up de saída / notificação do próprio Offer Studio —
 * para a pessoa conseguir clicar e editar o conteúdo que fica atrás.
 *
 * É SÓ VISUAL, só no editor: marca os elementos com um atributo no DOM do quadro
 * (nunca no modelo do GrapesJS) e liga um atributo no <html> do canvas; o CSS que
 * esconde vive em `WIDGET_CANVAS_CSS` (@layer os-fix). Nada disso vai para o HTML
 * salvo nem para a página publicada — como os avisos pintados em widgets/canvas.ts.
 */
import type { Editor } from "grapesjs";

/** No <html> do canvas enquanto as sobreposições estão escondidas. */
export const OVERLAY_HIDE_ROOT_ATTR = "data-os-hide-ov";
/** Em cada elemento que flutua por cima (posto só no DOM do quadro, não no modelo). */
export const OVERLAY_TAG_ATTR = "data-os-ov";

/** Eventos que refazem elementos no canvas: re-marcar enquanto o modo está ligado. */
const RESCAN_EVENTS = "component:mount component:add component:remove component:update";

export interface OverlayFacts {
  /** `getComputedStyle(el).position`. */
  position: string;
  /** `getComputedStyle(el).zIndex` ("auto" ou número). */
  zIndex: string;
  /** Largura e altura visíveis do elemento (getBoundingClientRect). */
  width: number;
  height: number;
  /** Distância do topo da tela (getBoundingClientRect().top; em `fixed` não muda com a rolagem). */
  top: number;
}

/**
 * O elemento flutua por cima da página (cobre o conteúdo e atrapalha a edição)?
 * - `fixed`: some — MENOS a barra colada no topo (navbar, cronômetro): fina,
 *   larga e no alto, que a pessoa quer manter e editar (não cobre o conteúdo).
 * - `absolute`: só um modal GRANDE (cobre boa parte da tela) com z-index alto —
 *   assim não some um enfeite pequeno posicionado de forma absoluta.
 * - `sticky`/`static`/`relative`: fica (navbar comum, conteúdo da página).
 * Função pura (testável sem DOM).
 */
export function isCoveringOverlay(f: OverlayFacts, viewport: { width: number; height: number }): boolean {
  if (f.position === "fixed") {
    // Barra no topo (navbar, cronômetro): colada no alto (pega até uma 2ª barra empilhada),
    // baixa e larga. Em pixels absolutos — uma barra é ~uma barra em qualquer tela; a altura
    // da viewport é pouco confiável e faria um modal de tela cheia parecer "barra" numa tela baixa.
    const topBar = f.top <= 160 && f.height <= 240 && f.width >= viewport.width * 0.5;
    return !topBar;
  }
  if (f.position === "absolute") {
    const z = Number.parseInt(f.zIndex, 10);
    const big = f.width >= viewport.width * 0.5 && f.height >= viewport.height * 0.3;
    return big && Number.isFinite(z) && z >= 10;
  }
  return false;
}

export interface OverlayHider {
  enable(): void;
  disable(): void;
  readonly on: boolean;
}

/**
 * Liga/desliga o esconder das sobreposições no canvas do editor. Enquanto ligado,
 * re-marca quando o GrapesJS refaz elementos (seleção, edição) — num `requestAnimationFrame`
 * para não varrer a página a cada mudança.
 */
export function createOverlayHider(editor: Editor): OverlayHider {
  let on = false;
  let scheduled = false;

  const doc = (): Document | undefined => editor.Canvas.getDocument() ?? undefined;

  function scan() {
    const d = doc();
    const win = d?.defaultView;
    if (!d?.body || !win) return;
    const viewport = { width: win.innerWidth, height: win.innerHeight };
    for (const el of Array.from(d.body.querySelectorAll<HTMLElement>("*"))) {
      const cs = win.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const overlay = isCoveringOverlay(
        { position: cs.position, zIndex: cs.zIndex, width: rect.width, height: rect.height, top: rect.top },
        viewport,
      );
      if (overlay) el.setAttribute(OVERLAY_TAG_ATTR, "");
      else if (el.hasAttribute(OVERLAY_TAG_ATTR)) el.removeAttribute(OVERLAY_TAG_ATTR);
    }
  }

  function schedule() {
    if (!on || scheduled) return;
    scheduled = true;
    const win = doc()?.defaultView;
    const run = () => {
      scheduled = false;
      if (on) scan();
    };
    if (win?.requestAnimationFrame) win.requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  return {
    enable() {
      if (on) return;
      on = true;
      doc()?.documentElement.setAttribute(OVERLAY_HIDE_ROOT_ATTR, "");
      scan();
      editor.on(RESCAN_EVENTS, schedule);
    },
    disable() {
      if (!on) return;
      on = false;
      editor.off(RESCAN_EVENTS, schedule);
      const d = doc();
      d?.documentElement.removeAttribute(OVERLAY_HIDE_ROOT_ATTR);
      for (const el of Array.from(d?.body?.querySelectorAll<HTMLElement>(`[${OVERLAY_TAG_ATTR}]`) ?? [])) {
        el.removeAttribute(OVERLAY_TAG_ATTR);
      }
    },
    get on() {
      return on;
    },
  };
}
