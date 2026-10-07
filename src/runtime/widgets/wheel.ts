/**
 * Roleta de desconto (data-os-widget="wheel") na página.
 *
 * - O sorteio acontece ANTES da animação, pelo peso das chances das fatias
 *   (data-os-slices, ver src/lib/wheel.ts), e a roda para exatamente na fatia
 *   sorteada: algumas voltas desacelerando (~5 s), o ponteiro balançando, confete
 *   e o resultado ("Você ganhou 30% OFF!", cupom com copiar e o botão
 *   "Resgatar"). Fatia sem prêmio mostra o texto de "não foi dessa vez" e o
 *   botão leva à oferta do mesmo jeito (com o texto data-os-lose-label).
 * - Uma vez por visitante: quem volta (localStorage, por roleta) vê a roda
 *   parada no prêmio, com o resultado e o botão, até o prêmio vencer
 *   (data-os-days, padrão 7). Sem armazenamento, vale para a visita.
 * - Prêmio ganho: guardado para as outras páginas (./prize.ts) e o botão
 *   "Resgatar" ([data-os-wh-go], destino escolhido no editor) leva junto
 *   ?os_premio=<prêmio>.<validade> (prizeId: link + texto) quando vai para uma página do funil
 *   (mesmo site ou caminho relativo: vale no ZIP aberto por arquivo; uma âncora
 *   na própria página fica como está). Os botões de checkout da página
 *   ([data-os-link-kind=checkout], inclusive o "Resgatar" ligado a um checkout
 *   da oferta) passam a levar ao link do prêmio, sempre do mapa embutido.
 * - O "Resgatar" parte do destino como veio no HTML (keepWheelHrefs, antes de o
 *   rastreamento completar os links) e o rastreamento completa de novo
 *   (__osTracking.relink), conforme o consentimento da hora — quem recusou
 *   (antes ou depois do giro) não leva o ID de clique.
 * - A memória "já girou" é separada por oferta (data-os-oferta, posto pelo render).
 * - Acessível: o "Girar" é um <button>, o resultado é anunciado (aria-live) e o
 *   foco vai para o botão "Resgatar". Com prefers-reduced-motion, a roda vai
 *   direto para a fatia, sem confete.
 * - Eventos "os:wheel" para o rastreamento (src/runtime/tracking/wheel.ts):
 *   { kind: "spin" | "redeem", prize: texto da fatia, won, track } — "redeem"
 *   só para quem ganhou um prêmio.
 *
 * Sem JavaScript: a roda desenhada e um aviso discreto (CSS do widget).
 */
import {
  LINK_KIND_ATTR,
  PRIZE_PARAM,
  parseSlices,
  pickSlice,
  prizeId,
  prizeParam,
  SCOPE_ATTR,
  scopedKey,
  sliceSignature,
  stopRotation,
  WHEEL_DAYS,
  type WheelSlice,
  wheelNumber,
} from "@/lib/wheel";
import { copyText, markPrizeOn, prizeMap, savePrize, swapCheckouts } from "./prize";
import { flag, load, markAutoScroll, save, widgets } from "./util";

/** Duração do giro (ms). */
export const SPIN_MS = 5200;
const DAY = 864e5;
const CONFETTI = ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#facc15", "#ec4899"];

export interface WheelEventDetail {
  kind: "spin" | "redeem";
  /** Texto da fatia que saiu. */
  prize: string;
  won: boolean;
  /** data-os-track: mandar para os pixels. */
  track: boolean;
}

export function initWheels(root?: ParentNode) {
  for (const wheel of widgets("wheel", root)) {
    try {
      setup(wheel);
    } catch {
      // uma roleta com problema não derruba o resto da página
    }
  }
}

/** Destino do "Resgatar" como veio no HTML (o rastreamento completa os links depois, no DOMContentLoaded). */
const HREF_ATTR = "data-os-wh-href";

/**
 * Guarda o destino original de cada "Resgatar". Roda quando o script das
 * páginas carrega (fim do <body>), antes de o repasse de UTMs completar os
 * links: o prêmio entra nesse destino e o repasse completa no clique, conforme o
 * consentimento da hora (o "Recusar" tira os IDs de clique).
 */
export function keepWheelHrefs() {
  for (const go of Array.from(document.querySelectorAll("[data-os-wh-go]"))) {
    if (!go.hasAttribute(HREF_ATTR)) go.setAttribute(HREF_ATTR, go.getAttribute("href") || "");
  }
}

/** Link para uma página do funil (relativo ou do mesmo site): leva o prêmio junto. */
function withPrize(raw: string, id: string, until: number): string {
  if (!raw || raw.startsWith("#") || /^(javascript|mailto|tel):/i.test(raw)) return raw;
  try {
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin) return raw;
    // Âncora na própria página: só rola até ela (o prêmio já está aplicado aqui).
    if (url.hash && url.pathname === location.pathname && url.search === location.search) return raw;
  } catch {
    return raw;
  }
  const cut = raw.indexOf("#");
  const base = cut < 0 ? raw : raw.slice(0, cut);
  const hash = cut < 0 ? "" : raw.slice(cut);
  const clean = base.replace(new RegExp(`([?&])${PRIZE_PARAM}=[^&]*&?`), "$1").replace(/[?&]$/, "");
  return `${clean}${clean.includes("?") ? "&" : "?"}${PRIZE_PARAM}=${prizeParam(id, until)}${hash}`;
}

function confetti() {
  const box = document.createElement("div");
  box.className = "os-wh-cf";
  box.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 90; i++) {
    const piece = document.createElement("i");
    const s = piece.style;
    s.left = `${Math.random() * 100}%`;
    s.backgroundColor = CONFETTI[i % CONFETTI.length];
    s.animationDelay = `${Math.random() * 0.5}s`;
    s.animationDuration = `${2.2 + Math.random() * 1.6}s`;
    s.setProperty("--x", `${Math.round((Math.random() - 0.5) * 260)}px`);
    s.setProperty("--r", `${Math.round(Math.random() * 900 - 450)}deg`);
    if (i % 3 === 0) s.borderRadius = "50%";
    box.appendChild(piece);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4500);
}

function setup(wheel: HTMLElement) {
  const slices = parseSlices(wheel.getAttribute("data-os-slices"));
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => wheel.querySelector<T>(sel);
  const disc = q("[data-os-wh-disc]");
  const spin = q<HTMLButtonElement>("[data-os-wh-spin]");
  if (slices.length < 2 || !disc || !spin) return;
  const result = q("[data-os-wh-result]");
  const go = q<HTMLAnchorElement>("[data-os-wh-go]");
  const prizeEl = q("[data-os-wh-prize]");
  const couponBox = q("[data-os-wh-coupon]");
  const code = q("[data-os-wh-code]");
  const days = wheelNumber(wheel.getAttribute("data-os-days"), WHEEL_DAYS, 1, 365);
  const track = flag(wheel, "track", true);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Separada por oferta: duas ofertas no mesmo domínio não dividem o giro.
  const memory = scopedKey(`os_roleta_${sliceSignature(slices)}`, wheel.getAttribute(SCOPE_ATTR) || "");
  const goHref = go?.getAttribute(HREF_ATTR) ?? go?.getAttribute("href") ?? "";
  const goText = go?.textContent || "";
  const loseText = (q("[data-os-wh-lose]")?.textContent || "Não foi dessa vez").trim();

  const live = document.createElement("p");
  live.className = "os-wh-sr";
  live.setAttribute("aria-live", "polite");
  wheel.appendChild(live);

  let rotation = 0;
  let spun = false;
  let won: WheelSlice | null = null;

  const emit = (kind: WheelEventDetail["kind"], s: WheelSlice) => {
    const detail: WheelEventDetail = { kind, prize: s.text, won: !s.lose, track };
    wheel.dispatchEvent(new CustomEvent("os:wheel", { bubbles: true, detail }));
  };

  const rotate = (deg: number, ms: number) => {
    disc.style.transition = ms ? `transform ${ms}ms cubic-bezier(.11,.66,.1,1)` : "none";
    disc.style.transform = `rotate(${deg}deg)`;
    rotation = deg;
  };

  /** Resultado da fatia `i` (fresh: acabou de girar — confete, foco, rolagem). */
  const show = (i: number, until: number, fresh: boolean) => {
    const s = slices[i];
    won = s;
    wheel.classList.add("os-wh-done");
    wheel.classList.toggle("os-wh-lost", !!s.lose);
    spin.disabled = true;
    if (prizeEl) prizeEl.textContent = s.text;
    if (couponBox) couponBox.hidden = !s.coupon;
    if (code) code.textContent = s.coupon;
    const hasPrize = !s.lose && !!s.link;
    if (go) {
      // "Resgatar" ligado a um checkout da oferta: vai para o checkout do prêmio (swapCheckouts, abaixo).
      if (hasPrize && go.getAttribute(LINK_KIND_ATTR) !== "checkout")
        go.setAttribute("href", withPrize(goHref, prizeId(s), until));
      const label = s.lose ? (go.getAttribute("data-os-lose-label") || "").trim() : "";
      if (label) go.textContent = label;
      else if (go.textContent !== goText) go.textContent = goText;
    }
    if (result) result.hidden = false;
    if (hasPrize) {
      markPrizeOn();
      // Botões de checkout desta página com o link do prêmio (o endereço vem do mapa embutido, nunca da fatia).
      const info = prizeMap()[prizeId(s)];
      if (info) swapCheckouts(info);
      // O rastreamento completa de novo os links (UTMs à vista, conforme o consentimento da hora).
      try {
        (window as { __osTracking?: { relink?: () => void } }).__osTracking?.relink?.();
      } catch {
        // sem rastreamento: o repasse (se houver) completa no clique
      }
    }
    if (!fresh) return;
    live.textContent = s.lose ? loseText : `Você ganhou ${s.text}!${s.coupon ? ` Seu cupom: ${s.coupon}.` : ""}`;
    if (!s.lose && !reduced) confetti();
    const target = go || result;
    if (!target) return;
    try {
      target.focus({ preventScroll: true });
    } catch {
      target.focus();
    }
    // Resultado fora da tela: sobe até ele ficar no fim da tela (a roda, parada no prêmio, aparece em cima).
    const box = (result || target).getBoundingClientRect();
    if (box.bottom > innerHeight || box.top < 0) {
      markAutoScroll();
      (result || target).scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "end" });
    }
  };

  // Voltou (o mesmo visitante, a mesma roleta): a roda já aparece parada no prêmio.
  let memo: { i?: unknown; u?: unknown } | null = null;
  try {
    memo = JSON.parse(load(memory) || "null");
  } catch {
    memo = null;
  }
  const mi = memo && typeof memo.i === "number" ? memo.i : -1;
  const mu = memo && typeof memo.u === "number" ? memo.u : 0;
  if (mi >= 0 && mi < slices.length && mu > Date.now()) {
    spun = true;
    rotate(stopRotation(mi, slices.length, 0, 0, 0.5), 0);
    show(mi, mu, false);
  }

  spin.addEventListener("click", (e) => {
    e.preventDefault();
    if (spun) return;
    spun = true;
    // Sorteio primeiro: a animação só leva até a fatia sorteada.
    const i = pickSlice(
      slices.map((s) => s.chance),
      Math.random(),
    );
    const s = slices[i];
    const now = Date.now();
    const until = now + days * DAY;
    save(memory, JSON.stringify({ i, u: until, at: now }));
    if (!s.lose && s.link) savePrize(prizeId(s), until, s.text, s.coupon);
    emit("spin", s);
    spin.disabled = true;
    wheel.classList.add("os-wh-spinning");
    wheel.setAttribute("aria-busy", "true");
    live.textContent = "Girando a roleta…";
    const ms = reduced ? 0 : SPIN_MS;
    const target = stopRotation(
      i,
      slices.length,
      rotation,
      reduced ? 0 : 5 + Math.floor(Math.random() * 2),
      Math.random(),
    );
    void disc.offsetWidth;
    rotate(target, ms);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      wheel.classList.remove("os-wh-spinning");
      wheel.removeAttribute("aria-busy");
      show(i, until, true);
    };
    if (ms) disc.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, ms ? ms + 400 : 150);
  });

  // "Resgatou": só quem ganhou um prêmio (quem caiu em "Sem prêmio" só continua para a oferta).
  go?.addEventListener("click", () => {
    if (won && !won.lose) emit("redeem", won);
  });

  const copy = q("[data-os-wh-copy]");
  copy?.addEventListener("click", (e) => {
    e.preventDefault();
    if (won?.coupon) copyText(won.coupon, copy);
  });

  wheel.classList.add("os-wh-on");
}
