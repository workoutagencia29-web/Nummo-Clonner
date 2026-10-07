/**
 * Popup de saída (data-os-widget="exit-popup"). Fica escondido (atributo
 * hidden) até abrir; abre uma vez por visita (data-os-frequency="always" abre
 * sempre).
 *
 * Gatilhos:
 * - computador: o mouse sai da página por cima (data-os-exit, padrão ligado);
 * - celular: depois de data-os-mobile-seconds (padrão 25; 0 desliga) ou ao
 *   rolar para cima rápido (data-os-scrollup, padrão ligado; a rolagem feita
 *   pela própria página — markAutoScroll em ./util — não conta);
 * - qualquer aparelho: depois de data-os-seconds (padrão 0 = não) ou ao tentar
 *   voltar com o botão "voltar" (data-os-back, padrão desligado).
 * Os gatilhos de saída só valem depois de data-os-arm segundos (padrão 3).
 * Com a janela de pagamento aberta (ou depois da compra), o popup não abre.
 *
 * Acessível: o bloco já vem com role="dialog"/aria-modal; aqui o foco fica
 * preso dentro do popup, Esc e "Fechar" fecham, clique fora da caixa fecha e o
 * foco volta para onde estava.
 */
import { autoScrolling, flag, isTouch, load, num, opt, save, widgets } from "./util";

const FOCUSABLE = "a[href],button:not([disabled]),input:not([disabled]),select,textarea";

export function initExitPopups(root?: ParentNode) {
  const el = widgets("exit-popup", root)[0];
  if (!el) return;
  const key = `os-pop:${location.pathname}`;
  const always = opt(el, "frequency") === "always";
  if (!always && load(key, true)) return;
  // Solto dentro de uma seção com delay (display:none) ou com transform/animação,
  // o popup abriria invisível ou preso na seção (e a página ficaria travada).
  // No fim do <body> ele cobre a tela de verdade; o visual vem de regras #id.
  if (el.parentElement !== document.body) document.body.appendChild(el);

  const box = (el.firstElementChild as HTMLElement | null) || el;
  const doc = document;
  const html = doc.documentElement;
  let opened = false;
  let armed = false;
  let back: HTMLElement | null = null;
  const offs: (() => void)[] = [];
  const on = (target: EventTarget, type: string, fn: (e: Event) => void) => {
    target.addEventListener(type, fn, { passive: true });
    offs.push(() => target.removeEventListener(type, fn));
  };
  setTimeout(
    () => {
      armed = true;
    },
    num(el, "arm", 3, 0, 600) * 1000,
  );

  const focusables = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    if (e.key !== "Tab") return;
    const list = focusables();
    const first = list[0];
    const last = list[list.length - 1];
    const active = doc.activeElement;
    if (e.shiftKey ? active === first || !el.contains(active) : active === last) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  };

  function close() {
    el.classList.remove("os-pop");
    el.hidden = true;
    html.classList.remove("os-lock");
    doc.removeEventListener("keydown", onKey, true);
    // biome-ignore lint/complexity/useOptionalChain: "?." vira código maior no script das páginas (Safari 13).
    if (back && back.focus) back.focus();
  }

  function open() {
    // Janela de pagamento aberta, ou compra já feita nesta página: nada de popup de saída.
    if (opened || html.classList.contains("os-pw-open") || html.classList.contains("os-pago")) return;
    opened = true;
    for (const off of offs) off();
    if (!always) save(key, "1", true);
    back = doc.activeElement as HTMLElement | null;
    let x = el.querySelector<HTMLElement>("[data-os-close]");
    if (!x) {
      x = doc.createElement("button");
      x.className = "os-pop-x";
      x.setAttribute("type", "button");
      x.setAttribute("data-os-close", "");
      x.setAttribute("aria-label", "Fechar");
      x.textContent = "×";
      box.prepend(x);
      if (getComputedStyle(box).position === "static") box.style.position = "relative";
    }
    el.hidden = false;
    el.classList.add("os-pop");
    // Rede de segurança: nunca trava a rolagem com um popup que não aparece.
    if (el.getClientRects().length) html.classList.add("os-lock");
    doc.addEventListener("keydown", onKey, true);
    el.dispatchEvent(new CustomEvent("os:popup", { bubbles: true }));
    const target = x;
    setTimeout(() => target.focus(), 30);
  }

  el.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (t === el || t.closest("[data-os-close]")) {
      e.preventDefault();
      close();
    }
  });

  const tryOpen = () => {
    if (armed) open();
  };
  const touch = isTouch();
  const delays = [num(el, "seconds", 0, 0, 3600), touch ? num(el, "mobile-seconds", 25, 0, 3600) : 0].filter(
    (s) => s > 0,
  );
  if (delays.length) {
    const t = setTimeout(open, Math.min(...delays) * 1000);
    offs.push(() => clearTimeout(t));
  }

  if (!touch && flag(el, "exit", true)) {
    on(doc, "mouseout", (e) => {
      const m = e as MouseEvent;
      if (!m.relatedTarget && m.clientY < 12) tryOpen();
    });
  }

  if (touch && flag(el, "scrollup", true)) {
    let lastY = scrollY;
    let lastT = Date.now();
    let deepest = 0;
    on(window, "scroll", () => {
      const y = scrollY;
      const t = Date.now();
      deepest = Math.max(deepest, y);
      // Subida rápida depois de ter lido um pedaço da página (a rolagem feita
      // pela própria página, ex.: o quiz voltando ao topo, não conta).
      if (!autoScrolling() && y < lastY && deepest > innerHeight && (lastY - y) / Math.max(16, t - lastT) > 1.2)
        tryOpen();
      lastY = y;
      lastT = t;
    });
  }

  if (flag(el, "back", false)) {
    // O navegador só respeita a entrada extra no histórico depois de um toque/clique.
    const arm = () => {
      const state = history.state as { osPopup?: number } | null;
      if (!state || !state.osPopup) history.pushState({ osPopup: 1 }, "", location.href);
    };
    on(doc, "click", arm);
    on(doc, "touchend", arm);
    on(window, "popstate", open);
  }
}
