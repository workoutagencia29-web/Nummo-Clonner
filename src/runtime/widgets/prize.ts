/**
 * Prêmio da roleta de desconto levado às outras páginas da oferta (página de
 * vendas, VSL…). O prêmio vem:
 * - do parâmetro os_premio=<prêmio>.<validade> que o botão "Resgatar"
 *   da roleta leva junto (funciona no ZIP aberto por arquivo e entre pastas);
 * - ou do localStorage ("os_premio"), gravado ao ganhar ou ao chegar com o parâmetro.
 *
 * Segurança: só vale um prêmio cujo identificador está no mapa que o render
 * embute na própria página (<script type="application/json" id="os-premios">:
 * prêmio → endereço do link da oferta, texto, cupom e opções da roleta). O endereço, o texto e o
 * cupom vêm sempre desse mapa, nunca da URL nem do armazenamento: um link
 * forjado não leva ninguém para outro site nem escreve na página.
 *
 * Com um prêmio válido (e dentro da validade de N dias):
 * - <html> ganha a classe os-premio-on (visibilidade condicional:
 *   [data-os-premio="ganhou"] aparece, [data-os-premio="nao"] some — o CSS vem
 *   do render, src/lib/wheel-prizes.ts);
 * - os botões de checkout ([data-os-link-kind=checkout], marcados pelo render)
 *   passam a levar ao link do prêmio — também na página que tem a roleta (o
 *   bloco solto na página de vendas, ou o "Resgatar" ligado a um checkout). O
 *   data-os-link continua: o repasse de UTMs, a marca da versão A/B e o
 *   InitiateCheckout (src/runtime/tracking) tratam o botão como checkout, como antes.
 *   Prêmio "Checkout do Offer Studio" (`o` no mapa): o botão leva à página de
 *   checkout do link do prêmio (endereço do próprio site, já com a versão A/B
 *   posta pelo render) e passa a ser desse link (data-os-link = `o`): o
 *   rastreamento o trata como o botão de checkout do Offer Studio (sem
 *   InitiateCheckout no clique — a página conta ao abrir — e com as UTMs como
 *   num link do funil);
 * - e, fora da página da roleta (lá o prêmio aparece na própria roleta), se a
 *   roleta pede, a faixa fixa no topo com o prêmio, o cupom (copiar) e o contador
 *   de N minutos, no visual da "Contagem no topo (barra)" ("30% OFF aplicado
 *   automaticamente! TERMINA EM 00:09:59"; com cupom, "30% OFF liberado! Use
 *   o cupom no pagamento", porque o cupom é digitado no checkout). Ao zerar, o
 *   desconto continua: a faixa só muda o texto ("…continua reservado").
 *   Enquanto a faixa está aberta, ela substitui a "Contagem no topo (barra)"
 *   da página (classe os-pz-on no <html>; a regra que esconde as barras vem no
 *   PRIZE_CSS): nada de dois descontos e dois prazos diferentes. Fechada a
 *   faixa, a barra da página volta.
 *
 * Textos da faixa no idioma da página (espanhol/inglês pelo #os-textos, ver
 * ./texts); o padrão é o português.
 *
 * Sem prêmio (veio direto do anúncio), nada muda. O prêmio guardado é separado
 * por oferta (código data-os-oferta posto pelo render): duas ofertas no mesmo
 * domínio não dividem o prêmio.
 */
import { PAY_ATTR } from "@/lib/payments/contract";
import {
  LINK_KIND_ATTR,
  PRIZE_LINK_KEY_RE,
  PRIZE_MAP_ID,
  PRIZE_PARAM,
  type PrizeInfo,
  type PrizeMap,
  parsePrizeParam,
  SCOPE_ATTR,
  SITE_PATH_RE,
  scopedKey,
} from "@/lib/wheel";
import { copyText } from "./copy";
import { PRIZE_CSS } from "./css";
import { pad2, splitTime } from "./options";
import { t, tf } from "./texts";
import { fitTop, pinTop, unpinTop } from "./top";
import { load, save } from "./util";

/** Código da oferta posto pelo render no mapa de prêmios (ou na roleta); "" = sem código. */
export function prizeScope(): string {
  const el = document.getElementById(PRIZE_MAP_ID) || document.querySelector(`[data-os-widget="wheel"][${SCOPE_ATTR}]`);
  return el?.getAttribute(SCOPE_ATTR) || "";
}

/** Prêmio guardado (por oferta). */
const key = () => scopedKey("os_premio", prizeScope());
/** Faixa fechada nesta sessão (chave do prêmio). */
const closedKey = () => scopedKey("os_premio_x", prizeScope());
const DAY = 864e5;
/** Faixa do prêmio aberta (esconde as barras de contagem da página: PRIZE_CSS). */
const PZ_ON = "os-pz-on";

/**
 * Prêmio guardado: identificador (prizeId), validade, quando ganhou, o fim do
 * contador da faixa e, só para consulta, o texto e o cupom (a página usa sempre
 * os do mapa embutido).
 */
export interface PrizeRecord {
  k: string;
  u: number;
  at: number;
  te?: number;
  t?: string;
  c?: string;
}

/**
 * Mapa de prêmios embutido na página (só entradas com endereço http/https, com
 * produto de pagamento ou com a página de checkout do Offer Studio no próprio site).
 */
export function prizeMap(): PrizeMap {
  const out: PrizeMap = {};
  let raw: unknown = null;
  try {
    raw = JSON.parse(document.getElementById(PRIZE_MAP_ID)?.textContent || "null");
  } catch {
    return out;
  }
  if (!raw || typeof raw !== "object") return out;
  for (const k of Object.keys(raw)) {
    const p = (raw as Record<string, PrizeInfo>)[k];
    if (!p || typeof p.t !== "string") continue;
    const u = typeof p.u === "string" ? p.u : "";
    // Chave de link de pagamento e a do link de checkout: a mesma regra (PRIZE_LINK_KEY_RE).
    const pay = typeof p.p === "string" && PRIZE_LINK_KEY_RE.test(p.p);
    const own = typeof p.o === "string" && PRIZE_LINK_KEY_RE.test(p.o) && SITE_PATH_RE.test(u);
    if (/^https?:\/\//i.test(u) || pay || own) out[k] = p;
  }
  return out;
}

function readRecord(): PrizeRecord | null {
  try {
    const r = JSON.parse(load(key()) || "null");
    return r && typeof r.k === "string" && typeof r.u === "number" ? (r as PrizeRecord) : null;
  } catch {
    return null;
  }
}

/** Guarda o prêmio (true = o armazenamento funcionou). */
function writeRecord(r: PrizeRecord): boolean {
  const text = JSON.stringify(r);
  save(key(), text);
  return load(key()) === text;
}

/** Guarda o prêmio ganho na roleta (validade em ms). */
export function savePrize(id: string, until: number, text: string, coupon: string) {
  writeRecord({ k: id, u: until, at: Date.now(), t: text, c: coupon });
}

/** Prêmio válido agora: do parâmetro da URL ou do armazenamento, sempre conferido no mapa. */
export function currentPrize(
  map: PrizeMap,
  now = Date.now(),
): { key: string; info: PrizeInfo; rec: PrizeRecord } | null {
  let rec = readRecord();
  const query = new URLSearchParams(location.search);
  const fromUrl = parsePrizeParam(query.get(PRIZE_PARAM));
  const info = fromUrl && map[fromUrl.key];
  if (fromUrl && info) {
    // Validade forjada mais longa que a da roleta não passa do prazo dela.
    const until = Math.min(fromUrl.until, now + info.d * DAY);
    if (until > now) {
      const same = rec && rec.k === fromUrl.key;
      rec = {
        k: fromUrl.key,
        u: until,
        at: same && rec ? rec.at : now,
        ...(same && rec?.te ? { te: rec.te } : {}),
        t: info.t,
        c: info.c,
      };
      // Guardado: o endereço fica limpo (quem copia o link não leva o prêmio junto).
      if (writeRecord(rec)) {
        query.delete(PRIZE_PARAM);
        const search = query.toString();
        try {
          history.replaceState(history.state, "", `${location.pathname}${search ? `?${search}` : ""}${location.hash}`);
        } catch {
          // sem histórico (página aberta de um jeito que não deixa): segue
        }
      }
    }
  }
  if (!rec || rec.u <= now) return null;
  const found = map[rec.k];
  return found ? { key: rec.k, info: found, rec } : null;
}

/** Liga a visibilidade "só para quem ganhou" (a roleta chama ao ganhar). */
export function markPrizeOn() {
  document.documentElement.classList.add("os-premio-on");
}

/**
 * Botões de checkout passam a levar ao prêmio (o destino vem sempre do mapa
 * embutido): ao endereço do link do prêmio ou, quando o prêmio é um link de
 * "Pagamento na página", à janela de pagamento do produto do prêmio
 * (data-os-pay). Um botão de pagamento que ganha um prêmio com endereço deixa
 * de abrir a janela e passa a levar ao endereço. Prêmio "Checkout do Offer
 * Studio" (`o`): leva à página de checkout e o botão passa a ser do link dele
 * (e perde a marca data-os-checkout do clonador, como no render).
 */
export function swapCheckouts(info: Pick<PrizeInfo, "u" | "p" | "o">) {
  for (const el of Array.from(document.querySelectorAll(`[${LINK_KIND_ATTR}="checkout"]`))) {
    const tag = el.tagName;
    const anchor = tag === "A" || tag === "AREA";
    if (info.p) {
      el.setAttribute(PAY_ATTR, info.p);
      if (anchor) el.setAttribute("href", "#");
      else if (tag !== "FORM") el.removeAttribute("data-os-href");
    } else if (info.u) {
      el.removeAttribute(PAY_ATTR);
      el.setAttribute(anchor ? "href" : tag === "FORM" ? "action" : "data-os-href", info.u);
      if (info.o) {
        el.setAttribute("data-os-link", info.o);
        // Botão clonado: sem a marca de checkout de fora (a página de checkout conta o InitiateCheckout).
        el.removeAttribute("data-os-checkout");
      }
    }
  }
}

export { copyText };

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}

/** Faixa no topo: prêmio, contador (o desconto continua depois de zerar) e cupom. */
function banner(cur: { key: string; info: PrizeInfo; rec: PrizeRecord }) {
  if (load(closedKey(), true) === cur.key) return;
  const info = cur.info;
  const rec = cur.rec;
  if (info.m > 0 && !rec.te) {
    rec.te = Date.now() + info.m * 60000;
    writeRecord(rec);
  }
  const style = make("style", "", PRIZE_CSS);
  style.id = "os-premio-css";
  document.head.appendChild(style);

  // Mesmo visual da "Contagem no topo (barra)": "30% OFF aplicado
  // automaticamente!  TERMINA EM [00]:[09]:[59]".
  const bar = make("div", "os-pz");
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", t("pzRegion", "Seu desconto"));
  const msg = make("p", "os-pz-msg");
  /** Frase com o prêmio em negrito no lugar do {p} (no idioma da página: #os-textos). */
  const say = (text: string) => {
    const parts = text.split("{p}");
    msg.append(parts[0], make("b", "", info.t), parts[1] || "");
  };
  const clock = make("p", "os-pz-tm");
  const time = make("span", "os-pz-t");
  time.setAttribute("role", "timer");
  clock.append(make("span", "os-pz-l", t("pzEnds", "Termina em")), time);
  const render = (left: number | null) => {
    msg.textContent = "";
    if (left !== null && left <= 0) {
      say(t("pzKept", "Seu desconto de {p} continua reservado — aproveite agora"));
      clock.remove();
      return;
    }
    // Com cupom, o desconto não está aplicado: a pessoa digita o cupom no checkout.
    say(
      info.c ? t("pzCoupon", "{p} liberado! Use o cupom no pagamento") : t("pzAuto", "{p} aplicado automaticamente!"),
    );
    if (left === null) return;
    // HH : MM : SS (arredonda para cima: começa em 00:10:00, não 00:09:59).
    const hms = splitTime(Math.ceil(left / 1000) * 1000);
    time.textContent = "";
    [hms.h + hms.d * 24, hms.m, hms.s].forEach((n, i) => {
      if (i) time.append(":");
      time.appendChild(make("b", "", pad2(n)));
    });
  };
  bar.appendChild(msg);
  if (rec.te) bar.appendChild(clock);
  if (info.c) {
    const chip = make("p", "os-pz-cp", t("pzCode", "Cupom "));
    const code = make("code", "", info.c);
    const copy = make("button", "", t("pzCopy", "Copiar"));
    copy.type = "button";
    copy.setAttribute("aria-label", tf("pzCopyLabel", "Copiar o cupom {c}", { c: info.c }));
    copy.addEventListener("click", () => copyText(info.c, copy));
    chip.append(code, copy);
    bar.appendChild(chip);
  }
  const close = make("button", "os-pz-x", "×");
  close.type = "button";
  close.setAttribute("aria-label", t("pzClose", "Fechar o aviso do desconto"));
  bar.appendChild(close);

  // Presa no topo no lugar da "Contagem no topo" da página (escondida enquanto
  // a faixa está aberta); a página ganha espaço do tamanho dela (não cobre o topo).
  document.documentElement.classList.add(PZ_ON);
  pinTop(bar, true);

  let ticker: ReturnType<typeof setInterval> | undefined;
  const tick = () => {
    const left = rec.te ? rec.te - Date.now() : null;
    render(left);
    if (left !== null && left <= 0) clearInterval(ticker);
    fitTop();
  };
  tick();
  if (rec.te && rec.te > Date.now()) ticker = setInterval(tick, 1000);
  close.addEventListener("click", () => {
    clearInterval(ticker);
    document.documentElement.classList.remove(PZ_ON);
    unpinTop(bar);
    save(closedKey(), cur.key, true);
  });
}

/** Página com prêmio válido: visibilidade, botões de checkout e a faixa. */
export function initPrize() {
  const map = prizeMap();
  if (!Object.keys(map).length) return;
  const cur = currentPrize(map);
  if (!cur) return;
  markPrizeOn();
  swapCheckouts(cur.info);
  // Na página da roleta, o prêmio aparece na própria roleta: sem faixa.
  if (cur.info.b && !document.querySelector('[data-os-widget="wheel"]')) banner(cur);
}
