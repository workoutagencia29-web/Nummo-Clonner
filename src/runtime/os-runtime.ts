/**
 * Script leve que roda nas páginas do Offer Studio (prévia e ZIP exportado).
 * É compilado para um único arquivo pequeno (ver src/lib/runtime-bundle.ts).
 *
 * - Botões de checkout que no site original navegavam por JavaScript viram
 *   elementos com data-os-href: aqui eles voltam a funcionar com um clique.
 * - Elementos com delay de VSL (data-os-delay="<segundos>") ficam escondidos e
 *   aparecem depois do tempo configurado. Na prévia, ?os_mostrar_delay=1 mostra tudo.
 * - Widgets dos blocos do editor (data-os-widget): contador, barra de escassez,
 *   notificação de compra, popup de saída, formulário de captura e player VTurb
 *   (src/runtime/widgets). Nada disso roda dentro do editor.
 * - [data-os-year] mostra o ano atual (rodapé).
 * - Páginas clonadas no modo Editável: FAQ/abas/acordeões e ganchos do clonador
 *   voltam a funcionar (src/runtime/clone-compat.ts). Cópias "Preservar JS"
 *   (<meta name="os-preserve-js">) ficam de fora: lá os scripts originais rodam.
 * - Vídeo (arquivo) com autoplay que o navegador recusou tenta de novo sem som.
 *
 * Fases seguintes acrescentam: repasse de UTMs, pixels e consentimento.
 */
import { initCloneCompat } from "./clone-compat";
import { initCountdowns } from "./widgets/countdown";
import { initExitPopups } from "./widgets/exit-popup";
import { initLeadForms, leadWait } from "./widgets/lead-form";
import { initSalesNotifications } from "./widgets/sales-notification";
import { initScarcity } from "./widgets/scarcity";
import { addCss, isPreview, navigate } from "./widgets/util";
import { initVturb } from "./widgets/vturb";

interface OsWindow extends Window {
  __osRuntime?: boolean;
  /**
   * Script de rastreamento (src/runtime/tracking): scripts dos pixels ainda
   * carregando e a espera para sair da página (`leaving`), que vale também para
   * os links que ele segura (src/runtime/tracking/rules.ts).
   */
  __osTracking?: { pending?: () => boolean; settled?: (ms: number) => Promise<void>; leaving?: boolean };
}

(() => {
  const w = window as OsWindow;
  if (w.__osRuntime) return;
  w.__osRuntime = true;

  const params = new URLSearchParams(location.search);

  // Dentro da prévia do painel (iframe em *.localhost), sites externos não podem
  // abrir no quadro: vão para uma aba nova.
  const framedPreview = window.top !== window && isPreview();

  /** Endereço seguro para navegar (só http/https; "#âncora" e caminhos relativos valem). */
  function safeUrl(href: string) {
    try {
      const url = new URL(href, location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  }

  // ── Botões que navegam por data-os-href ────────────────────────────────────
  // Com o script de um pixel ainda carregando (ex.: "Comprar" logo depois do
  // "Aceitar"), a navegação na mesma aba espera o evento sair (no máximo 0,8 s);
  // enquanto isso, outro clique não navega na frente. A marcação da espera fica
  // no objeto do rastreamento (sem ele, nada espera): um link <a> clicado logo
  // depois também espera, e este botão respeita a espera de um link segurado lá.
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      const el = target?.closest?.("[data-os-href]");
      if (!el || el.closest("a[href]")) return;
      const href = el.getAttribute("data-os-href");
      if (!href) return;
      event.preventDefault();
      const url = safeUrl(href);
      const tracking = w.__osTracking;
      if (!url || tracking?.leaving) return;
      const newTab = el.getAttribute("data-os-target") === "_blank";
      // Âncora na própria página ("#oferta"): só rola, nada a esperar.
      const samePage = url.href.split("#")[0] === location.href.split("#")[0];
      if (newTab || samePage || !tracking?.pending?.()) {
        navigate(url, newTab);
        return;
      }
      tracking.leaving = true;
      void leadWait(tracking).then(() => {
        // A página pode não sair (aba nova na prévia, download): os cliques voltam a valer.
        if (!navigate(url)) tracking.leaving = false;
        else
          setTimeout(() => {
            tracking.leaving = false;
          }, 2000);
      });
    },
    true,
  );
  // Voltou pelo cache do navegador (botão Voltar) depois de sair: nada mais está esperando.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && w.__osTracking) w.__osTracking.leaving = false;
  });

  // ── Links externos na prévia do painel ─────────────────────────────────────
  if (framedPreview) {
    document.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.hasAttribute("data-os-noop")) return;
      const url = safeUrl(link.getAttribute("href") ?? "");
      if (!url || url.origin === location.origin) return;
      event.preventDefault();
      window.open(url.href, "_blank", "noopener");
    });
  }

  // ── Delay de VSL ───────────────────────────────────────────────────────────
  function reveal(el: Element) {
    el.classList.add("os-revealed");
    // A página cresceu: o rastreamento confere de novo a rolagem (src/runtime/tracking/rules.ts).
    document.dispatchEvent(new CustomEvent("os:revealed"));
  }

  function setupDelays() {
    const els = Array.from(document.querySelectorAll("[data-os-delay]"));
    if (!els.length) return;
    const showAll = params.get("os_mostrar_delay") === "1";
    for (const el of els) {
      const seconds = Number(el.getAttribute("data-os-delay")) || 0;
      // Memória por tempo de delay: quem recarrega depois de ver o botão de 60 s
      // não ganha de brinde o preço de 600 s (cada um aparece no seu tempo).
      const key = `os-delay:${location.pathname}:${seconds}`;
      let seen = false;
      try {
        seen = sessionStorage.getItem(key) === "1";
      } catch {
        // armazenamento bloqueado: segue sem memória
      }
      if (showAll || seen || seconds <= 0) {
        reveal(el);
        continue;
      }
      setTimeout(() => {
        reveal(el);
        try {
          sessionStorage.setItem(key, "1");
        } catch {
          // ignora
        }
      }, seconds * 1000);
    }
  }

  // ── Vídeo (arquivo) com "tocar sozinho" ────────────────────────────────────
  // O navegador só deixa tocar sozinho sem som: páginas salvas antes de o editor
  // ligar o "sem som" junto tentam de novo, mudas, se o navegador recusar.
  function setupAutoplay() {
    for (const v of Array.from(document.querySelectorAll<HTMLVideoElement>("video[data-os-file][autoplay]"))) {
      const retry = () => {
        v.muted = true;
        v.play().catch(() => {});
      };
      if (v.muted) continue;
      const p = v.play();
      if (p) p.catch(retry);
    }
  }

  // ── Widgets dos blocos ─────────────────────────────────────────────────────
  function setupWidgets() {
    if (document.querySelector("[data-os-widget]")) addCss();
    const year = String(new Date().getFullYear());
    for (const el of Array.from(document.querySelectorAll("[data-os-year]"))) el.textContent = year;
    // Um widget com problema não pode derrubar os outros.
    for (const init of [
      initCountdowns,
      initScarcity,
      initSalesNotifications,
      initExitPopups,
      initLeadForms,
      initVturb,
    ]) {
      try {
        init();
      } catch {
        // segue com os outros widgets
      }
    }
  }

  function start() {
    // Cópia "Preservar JS": os scripts originais continuam rodando e já cuidam de
    // FAQ, abas e menu — a compatibilidade desfaria o que eles acabaram de fazer.
    const keepsOriginalJs = !!document.querySelector('meta[name="os-preserve-js"]');
    const steps = [setupDelays, setupWidgets, setupAutoplay];
    if (!keepsOriginalJs) steps.push(initCloneCompat);
    // Cada parte isolada: um erro numa não impede as outras.
    for (const step of steps) {
      try {
        step();
      } catch {
        // segue com as outras partes
      }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
