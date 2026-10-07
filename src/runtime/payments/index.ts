/**
 * Script da janela de pagamento (compilado à parte: src/lib/runtime-bundle.ts,
 * paymentScript). O render só o põe nas páginas de ofertas com "Pagamento na
 * página", junto do #os-pagamento (src/lib/payments/render.ts). Expõe
 * window.__osPay.open(chave, botão), chamado pelo clique dos botões
 * data-os-pay no script das páginas (./click.ts). Uma janela por produto.
 * Também liga o bloco "Acesso ao produto" da página de obrigado (./access.ts).
 */
import { initAccess } from "./access";
import { endpointUrl, pageConfig } from "./api";
import type { PayApi } from "./click";
import { createPayWindow, type PayWindow } from "./window";

(() => {
  const w = window as unknown as { __osPay?: PayApi };
  if (w.__osPay) return;
  const windows: Record<string, PayWindow> = {};
  w.__osPay = {
    open(key, trigger) {
      const cfg = pageConfig();
      const endpoint = cfg && endpointUrl(cfg);
      // Sem Object.hasOwn (não existe no Safari < 15.4; o biome troca hasOwnProperty.call por ele).
      const product = cfg && endpoint && Object.getOwnPropertyDescriptor(cfg.produtos, key) ? cfg.produtos[key] : null;
      if (!cfg || !endpoint || !product) return false;
      if (!windows[key]) windows[key] = createPayWindow(cfg, endpoint, key, product);
      windows[key].open(trigger);
      return true;
    },
  };
  const start = () => {
    try {
      initAccess();
    } catch {
      // o bloco fica com a mensagem padrão
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
