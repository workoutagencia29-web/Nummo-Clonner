/**
 * Bloco "Acesso ao produto" (data-os-widget="access") na página de obrigado.
 * O link de acesso NUNCA está no HTML: o script pergunta ao endpoint de
 * pagamento ({ acao: "acesso", pedido }) com o ?pedido= que a janela de
 * pagamento pôs no endereço, e o servidor só devolve o link de um pedido PAGO
 * — e o do produto desse pedido (lido do gateway, nunca do navegador).
 *
 * Estados (classe no bloco; os textos são os do bloco, editáveis):
 * - os-ac-wait (começo; e enquanto o pagamento estiver pendente — continua
 *   conferindo por até 15 minutos; sem conexão, por até 3 minutos);
 * - os-ac-ok: o botão [data-os-ac-go] recebe o link de acesso e aparece;
 * - os-ac-none: sem pedido, pedido não pago ou não encontrado ("Ainda não
 *   encontramos seu pagamento…").
 * O que aparece em cada estado vem do CSS do próprio bloco
 * (src/editor/widgets/access-content.ts).
 *
 * Mora no script da janela de pagamento (./index.ts), que só vai nas ofertas
 * com pagamento; sem ele, o script das páginas mostra a mensagem
 * (./click.ts, accessFallback).
 */
import { ACCESS_TEXTS, type AccessTextKey } from "@/lib/payments/access-texts";
import {
  ORDER_ID_RE,
  ORDER_PARAM,
  ORDER_STORE_PREFIX,
  type PayLocale,
  type PaymentAccessResponse,
  type PaymentPageConfig,
} from "@/lib/payments/contract";
import { endpointUrl, pageConfig, postPayment } from "./api";

const PENDING_MS = 15 * 60_000;
const OFFLINE_MS = 3 * 60_000;
const EVERY_MS = 4000;

function setState(els: HTMLElement[], state: "wait" | "ok" | "none") {
  for (const el of els) {
    el.classList.remove("os-ac-wait", "os-ac-ok", "os-ac-none");
    el.classList.add(`os-ac-${state}`);
    el.setAttribute("aria-busy", state === "wait" ? "true" : "false");
  }
}

/**
 * O produto pago é de outro idioma que o do bloco (página de obrigado
 * compartilhada por produtos de idiomas diferentes): troca os textos que ainda
 * são os padrão do idioma do bloco pelos do produto — o que você editou fica
 * como está.
 */
function matchLanguage(els: HTMLElement[], cfg: PaymentPageConfig | null, produto: string) {
  const p = cfg && produto && Object.hasOwn(cfg.produtos, produto) ? cfg.produtos[produto] : null;
  const to = p ? p.idioma : null;
  if (!to || !ACCESS_TEXTS[to]) return;
  for (const el of els) {
    const from = (el.getAttribute("data-os-lang") || "es") as PayLocale;
    if (from === to || !ACCESS_TEXTS[from]) continue;
    for (const t of Array.from(el.querySelectorAll<HTMLElement>("[data-os-ac-text]"))) {
      const k = t.getAttribute("data-os-ac-text") as AccessTextKey;
      const def = ACCESS_TEXTS[from][k];
      if (def && (t.textContent || "").trim() === def) t.textContent = ACCESS_TEXTS[to][k];
    }
    el.setAttribute("lang", to);
    el.setAttribute("data-os-lang", to);
  }
}

/** Link de acesso aceito (só http/https). */
function accessUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Pedido da página: o do endereço ou, como o script do <head> já o tirou de
 * lá (ORDER_STRIP_SCRIPT, src/lib/payments/render.ts), o que ele guardou.
 */
function orderOfPage(): string {
  const fromUrl = new URLSearchParams(location.search).get(ORDER_PARAM);
  if (fromUrl) return fromUrl;
  const mem = (window as unknown as { __osPedido?: unknown }).__osPedido;
  if (typeof mem === "string" && mem) return mem;
  try {
    return sessionStorage.getItem(ORDER_STORE_PREFIX + location.pathname) || "";
  } catch {
    return "";
  }
}

export function initAccess() {
  const els: HTMLElement[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-os-widget="access"]'))) {
    if (el.hasAttribute("data-os-ac-on")) continue;
    el.setAttribute("data-os-ac-on", "");
    els.push(el);
  }
  if (!els.length) return;
  setState(els, "wait");
  const cfg = pageConfig();
  const endpoint = cfg && endpointUrl(cfg);
  const pedido = orderOfPage();
  if (!endpoint || !ORDER_ID_RE.test(pedido)) {
    setState(els, "none");
    return;
  }
  const started = Date.now();
  let offlineSince = 0;
  let tries = 0;

  const ask = () => {
    tries++;
    postPayment<PaymentAccessResponse>(endpoint, { acao: "acesso", pedido: pedido }).then((r) => {
      const now = Date.now();
      if (r.ok) {
        const url = accessUrl(r.acesso);
        if (!url) {
          setState(els, "none");
          return;
        }
        for (const el of els) {
          for (const go of Array.from(el.querySelectorAll<HTMLAnchorElement>("a[data-os-ac-go]"))) {
            go.href = url;
            if (go.target === "_blank") go.rel = "noopener";
          }
        }
        matchLanguage(els, cfg, r.produto);
        setState(els, "ok");
        return;
      }
      const offline = r.erro === "rede" || r.erro === "indisponivel" || r.erro === "limite";
      if (offline) offlineSince = offlineSince || now;
      else offlineSince = 0;
      const keep = r.erro === "pendente" ? now - started < PENDING_MS : offline && now - offlineSince < OFFLINE_MS;
      if (!keep) {
        setState(els, "none");
        return;
      }
      // Pendente: a cada 4 s; sem conexão, cada vez mais devagar (até 20 s).
      setTimeout(ask, offline ? Math.min(20000, EVERY_MS * tries) : EVERY_MS);
    });
  };
  ask();
}
