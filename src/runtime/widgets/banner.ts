/**
 * Carrossel de banners (data-os-widget="banner") na página publicada: passa os
 * banners sozinho na horizontal, cria as bolinhas e liga as setas e o toque. Só
 * ASCII, pensado para o Safari 13 (sem desestruturação pesada). Para no
 * hover/foco/toque, quando a aba fica oculta e com prefers-reduced-motion. Com
 * um banner só, não faz nada (fica estático).
 */
import { flag, num, reducedMotion, widgets } from "./util";

export function initBanners() {
  for (const bn of widgets("banner")) setup(bn);
}

function setup(bn: HTMLElement) {
  const track = bn.querySelector<HTMLElement>("[data-os-bn-track]");
  if (!track) return;
  const slides = Array.from(track.children).filter((c) => c.classList.contains("os-bn-slide")) as HTMLElement[];
  if (slides.length < 2) return; // 1 banner: estático
  bn.classList.add("os-bn-js");

  /** Banner à vista agora (pela posição da rolagem). */
  const at = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  const go = (i: number) => {
    const n = slides.length;
    const idx = ((i % n) + n) % n; // volta ao começo depois do último
    const left = idx * track.clientWidth;
    if (track.scrollTo && "scrollBehavior" in document.documentElement.style && !reducedMotion())
      track.scrollTo({ left: left, behavior: "smooth" });
    else track.scrollLeft = left;
  };

  // Banner decorativo (sem destino): o clique não pula para o topo da página.
  for (const slide of slides) {
    const href = slide.getAttribute("href");
    if (!href || href === "#") slide.addEventListener("click", (e) => e.preventDefault());
  }

  // Bolinhas: uma por banner (o HTML traz só a caixa vazia e o texto do aria-label).
  const dots: HTMLButtonElement[] = [];
  const dotsBox = bn.querySelector<HTMLElement>("[data-os-bn-dots]");
  if (dotsBox) {
    const label = dotsBox.getAttribute("data-os-bn-goto") || "";
    dotsBox.textContent = "";
    for (let i = 0; i < slides.length; i++) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "os-bn-dot";
      if (label) dot.setAttribute("aria-label", `${label} ${i + 1}`);
      const j = i;
      dot.addEventListener("click", () => go(j));
      dotsBox.appendChild(dot);
      dots.push(dot);
    }
  }

  // Setas (volta ao começo/fim em laço).
  const prev = bn.querySelector<HTMLButtonElement>(".os-bn-prev");
  const next = bn.querySelector<HTMLButtonElement>(".os-bn-next");
  if (prev) prev.addEventListener("click", () => go(at() - 1));
  if (next) next.addEventListener("click", () => go(at() + 1));

  // Bolinha do banner à vista.
  const sync = () => {
    const i = at();
    for (let d = 0; d < dots.length; d++) {
      if (d === i) dots[d].setAttribute("aria-current", "true");
      else dots[d].removeAttribute("aria-current");
    }
  };
  track.addEventListener("scroll", sync, { passive: true });
  addEventListener("resize", () => {
    go(at());
    sync();
  });
  sync();

  // Passa sozinho (data-os-autoplay; respeita "menos movimento").
  if (!flag(bn, "autoplay", true) || reducedMotion()) return;
  const wait = Math.round(num(bn, "interval", 5, 2, 30) * 1000);
  let paused = false;
  const pause = () => {
    paused = true;
  };
  const resume = () => {
    paused = false;
  };
  for (const ev of ["mouseenter", "focusin", "touchstart", "pointerdown"]) bn.addEventListener(ev, pause);
  for (const ev of ["mouseleave", "focusout", "touchend", "pointerup"]) bn.addEventListener(ev, resume);
  setInterval(() => {
    if (!paused && !document.hidden) go(at() + 1);
  }, wait);
}
