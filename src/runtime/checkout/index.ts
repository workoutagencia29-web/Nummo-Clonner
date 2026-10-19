/**
 * Script da página de checkout do Offer Studio (compilado à parte:
 * src/lib/runtime-bundle.ts, checkoutScript). Só vai nas páginas de checkout
 * (src/lib/checkout/page.ts), no fim do <body>. Lê o #os-checkout, liga o
 * formulário (./form), o pagamento (./flow) e o cronômetro, e manda o
 * InitiateCheckout (valor do produto) ao abrir — uma vez por aba.
 *
 * O endpoint vem SEMPRE do #os-checkout posto pelo render e só vale na mesma
 * origem da página: nada que o visitante digite muda para onde os dados vão.
 * Alvo Safari 13: sem desestruturação nem "?." no que vira script.
 */
import { CHECKOUT_CONFIG_ID, type PublicCheckoutConfig, readCheckoutConfig } from "@/lib/checkout/contract";
import { checkoutFixedTexts } from "@/lib/checkout/texts";
import { createFlow, eventId, trackCheckout } from "./flow";
import { setupForm } from "./form";
import { initiatedOnce, loadBuyer, loadOpen, timerEnd } from "./store";

/** Endereço absoluto do endpoint (null = fora da origem da página ou inválido). */
export function checkoutEndpoint(cfg: PublicCheckoutConfig): string | null {
  try {
    const url = new URL(cfg.endpoint, location.href);
    if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Altura da faixa fixa do cronômetro no scroll-padding-top do <html> (o campo
 * focado com Tab/Shift+Tab e o painel do pagamento param abaixo dela) e no
 * --osc-top (o resumo preso na coluna da direita). Sem a faixa: limpa.
 */
function fitTimer(bar: HTMLElement | null) {
  const html = document.documentElement;
  const h = bar && !bar.hidden ? bar.offsetHeight : 0;
  html.style.scrollPaddingTop = h ? `${h + 12}px` : "";
  if (h) html.style.setProperty("--osc-top", `${h + 16}px`);
  else html.style.removeProperty("--osc-top");
}

/**
 * Cronômetro da faixa do topo. Zerou: a faixa some (um "termina em 00:00"
 * parado parece quebrado); o tempo recomeça um dia depois (timerEnd).
 */
function startTimer(cfg: PublicCheckoutConfig, scope: string) {
  const bar = document.querySelector<HTMLElement>("[data-osc-timer]");
  const clock = document.querySelector<HTMLElement>("[data-osc-clock]");
  if (!bar || !clock || cfg.cronometro === null) return;
  const end = timerEnd(scope, cfg.cronometro);
  const tick = () => {
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    const m = Math.floor(left / 60);
    const s = left % 60;
    clock.textContent = `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
    if (!left) {
      clearInterval(timer);
      bar.hidden = true;
      fitTimer(bar);
    }
  };
  const timer = setInterval(tick, 1000);
  tick();
  const fit = () => fitTimer(bar);
  fit();
  window.addEventListener("resize", fit);
  window.addEventListener("load", fit);
}

function boot() {
  const el = document.getElementById(CHECKOUT_CONFIG_ID);
  const cfg = readCheckoutConfig(el ? el.textContent : null);
  const formEl = document.querySelector<HTMLFormElement>("[data-osc-form]");
  const panel = document.querySelector<HTMLElement>("[data-osc-flow]");
  if (!cfg || !formEl || !panel) return;
  const fx = checkoutFixedTexts(cfg.idioma);
  const live = document.createElement("p");
  live.className = "osc-sr";
  live.setAttribute("aria-live", "polite");
  document.body.appendChild(live);
  const announce = (text: string) => {
    live.textContent = "";
    setTimeout(() => {
      live.textContent = text;
    }, 30);
  };
  const form = setupForm(cfg, formEl, fx, announce);
  const endpoint = checkoutEndpoint(cfg);
  // Cronômetro e InitiateCheckout separados por oferta (o endpoint é de cada oferta; a chave do link se repete).
  const scope = `${endpoint || cfg.endpoint}:${cfg.chave}`;
  startTimer(cfg, scope);
  if (!endpoint) {
    form.busy(true);
    form.alert(fx.unavailable);
    return;
  }
  // Veio de um upsell (já comprou no funil): o checkout abre com os dados dela preenchidos.
  const buyer = loadBuyer(endpoint);
  if (buyer) form.prefill(buyer);
  const flow = createFlow(cfg, endpoint, form, formEl, panel, fx, announce);
  const resuming = !!loadOpen(endpoint, cfg.chave);
  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const buyer = form.validate();
    if (buyer) flow.start(buyer);
  });
  if (resuming) flow.resume();
  else if (!initiatedOnce(scope)) {
    trackCheckout("INITIATE_CHECKOUT", eventId("ic-"), cfg.valor, cfg.moeda, [
      { id: cfg.chave, nome: cfg.nome, valor: cfg.valor },
    ]);
  }
}

(() => {
  const w = window as unknown as { __osCheckout?: boolean };
  if (w.__osCheckout) return;
  w.__osCheckout = true;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
