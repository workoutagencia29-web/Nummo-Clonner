/**
 * Script da página do produto (compilado à parte: src/lib/runtime-bundle.ts,
 * productScript). O render só o põe nas páginas com galeria de fotos, caixa
 * de compra ou "‹ Voltar para a loja" (injectProductScript): as outras páginas
 * não carregam nada disto. Nada roda no editor.
 *
 * - Galeria (data-os-widget="product-gallery"): trocar a foto (./gallery.ts).
 * - Caixa de compra (data-os-widget="product-buy"): barra de compra fixa
 *   embaixo no celular (./bar.ts).
 * - "‹ Voltar para a loja" sem destino (./back.ts).
 *
 * Alvo Safari 13 (o esbuild transpila; nada de :has() no CSS).
 */
import { setupBackLinks } from "./back";
import { setupBuyBar } from "./bar";
import { PRODUCT_CSS } from "./css";
import { setupGallery } from "./gallery";

(() => {
  const w = window as unknown as { __osProduct?: boolean };
  if (w.__osProduct) return;
  w.__osProduct = true;

  const each = (sel: string, init: (el: HTMLElement) => void) => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      try {
        init(el);
      } catch {
        // um widget com problema não derruba os outros
      }
    }
  };

  const start = () => {
    if (!document.getElementById("os-product-css")) {
      const style = document.createElement("style");
      style.id = "os-product-css";
      style.textContent = PRODUCT_CSS;
      document.head.appendChild(style);
    }
    each('[data-os-widget="product-gallery"]', setupGallery);
    each('[data-os-widget="product-buy"]', setupBuyBar);
    try {
      setupBackLinks();
    } catch {
      // o link segue como link comum
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
