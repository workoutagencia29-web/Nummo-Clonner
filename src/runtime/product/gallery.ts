/**
 * Galeria de fotos do produto (data-os-widget="product-gallery"): clicar numa
 * miniatura mostra a foto dela na foto grande (aria-current na miniatura);
 * clicar na foto grande — ou passar o dedo para o lado nela, no celular —
 * vai para a próxima (ou a anterior). Com uma foto só, nada a fazer (o CSS
 * esconde a fileira).
 */
export function setupGallery(gallery: HTMLElement) {
  const main = gallery.querySelector<HTMLImageElement>(".os-pg-main");
  const thumbs = Array.from(gallery.querySelectorAll<HTMLElement>(".os-pg-thumb"));
  if (!main || thumbs.length < 2) return;
  let at = 0;
  const show = (i: number) => {
    at = (i + thumbs.length) % thumbs.length;
    const img = thumbs[at].querySelector("img");
    if (img) {
      main.src = img.currentSrc || img.src;
      main.alt = img.alt;
    }
    for (let k = 0; k < thumbs.length; k++) {
      if (k === at) thumbs[k].setAttribute("aria-current", "true");
      else thumbs[k].removeAttribute("aria-current");
    }
  };
  thumbs.forEach((thumb, i) => {
    thumb.addEventListener("click", (e) => {
      e.preventDefault();
      show(i);
    });
  });
  main.addEventListener("click", () => show(at + 1));
  // Passar o dedo para o lado na foto grande troca de foto (toque curto = clique, como acima).
  let startX = 0;
  let startY = 0;
  main.addEventListener(
    "touchstart",
    (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    },
    { passive: true },
  );
  main.addEventListener(
    "touchend",
    (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
      e.preventDefault();
      show(at + (dx < 0 ? 1 : -1));
    },
    { passive: false },
  );
  gallery.classList.add("os-pg-js");
  show(0);
}
