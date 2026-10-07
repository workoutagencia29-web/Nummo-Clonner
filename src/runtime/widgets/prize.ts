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
 *   InitiateCheckout (src/runtime/tracking) tratam o botão como checkout, como antes;
 * - e, fora da página da roleta (lá o prêmio aparece na própria roleta), se a
 *   roleta pede, a faixa fixa no topo com o prêmio, o cupom (copiar) e o contador
 *   de N minutos. Ao zerar, o desconto continua: a faixa só muda o texto.
 *
 * Sem prêmio (veio direto do anúncio), nada muda. O prêmio guardado é separado
 * por oferta (código data-os-oferta posto pelo render): duas ofertas no mesmo
 * domínio não dividem o prêmio.
 */
import { PAY_ATTR } from "@/lib/payments/contract";
import {
  LINK_KIND_ATTR,
  PRIZE_MAP_ID,
  PRIZE_PARAM,
  type PrizeInfo,
  type PrizeMap,
  parsePrizeParam,
  SCOPE_ATTR,
  scopedKey,
} from "@/lib/wheel";
import { copyText } from "./copy";
import { PRIZE_CSS } from "./css";
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

/** Mapa de prêmios embutido na página (só entradas com endereço http/https). */
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
    const url = typeof p.u === "string" && /^https?:\/\//i.test(p.u);
    const pay = typeof p.p === "string" && /^[a-z0-9-]{1,80}$/.test(p.p);
    if (url || pay) out[k] = p;
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
 * de abrir a janela e passa a levar ao endereço.
 */
export function swapCheckouts(info: Pick<PrizeInfo, "u" | "p">) {
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

const two = (n: number) => (n < 10 ? `0${n}` : String(n));

/** "09:59" (ou "1:09:59" com mais de uma hora). */
function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${two(m)}` : two(m)}:${two(s % 60)}`;
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

  const bar = make("div", "os-pz");
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Seu desconto");
  const msg = make("p", "os-pz-msg");
  const prize = () => make("b", "", info.t);
  const time = make("b", "os-pz-t");
  const render = (left: number | null) => {
    msg.textContent = "";
    if (left !== null && left <= 0) {
      msg.append("🎉 Seu desconto de ", prize(), " continua reservado — aproveite agora");
      return;
    }
    msg.append("🎉 Você ganhou ", prize(), " — seu desconto está reservado");
    if (left !== null) {
      time.textContent = clock(left);
      msg.append(" por ", time);
    }
  };
  bar.appendChild(msg);
  if (info.c) {
    const chip = make("p", "os-pz-cp", "Cupom ");
    const code = make("code", "", info.c);
    const copy = make("button", "", "Copiar");
    copy.type = "button";
    copy.setAttribute("aria-label", `Copiar o cupom ${info.c}`);
    copy.addEventListener("click", () => copyText(info.c, copy));
    chip.append(code, copy);
    bar.appendChild(chip);
  }
  const close = make("button", "os-pz-x", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Fechar o aviso do desconto");
  bar.appendChild(close);

  // Espaço do tamanho da faixa no começo da página: ela não cobre o topo.
  const spacer = make("div", "os-pz-sp");
  spacer.setAttribute("aria-hidden", "true");
  const fit = () => {
    spacer.style.height = `${bar.offsetHeight}px`;
  };
  document.body.insertBefore(spacer, document.body.firstChild);
  document.body.insertBefore(bar, spacer);

  let ticker: ReturnType<typeof setInterval> | undefined;
  const tick = () => {
    const left = rec.te ? rec.te - Date.now() : null;
    render(left);
    if (left !== null && left <= 0) clearInterval(ticker);
    fit();
  };
  tick();
  if (rec.te && rec.te > Date.now()) ticker = setInterval(tick, 1000);
  addEventListener("resize", fit);
  close.addEventListener("click", () => {
    clearInterval(ticker);
    bar.remove();
    spacer.remove();
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
