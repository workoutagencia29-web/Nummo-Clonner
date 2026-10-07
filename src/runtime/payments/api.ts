/**
 * Conversa da página com o endpoint de pagamento (prévia: /__os/pagamento;
 * ZIP: pagamento.php) e o pedido em andamento guardado no navegador.
 *
 * O endpoint vem SEMPRE do #os-pagamento posto pelo render, e só vale na
 * mesma origem da página: nada que o visitante digite (ou ponha no endereço)
 * muda para onde os dados do comprador vão.
 */
import {
  PAYMENT_CONFIG_ID,
  type PayCurrency,
  type PayMethod,
  type PaymentErrorCode,
  type PaymentPageConfig,
  readPaymentConfig,
  type SpeiInstructions,
} from "@/lib/payments/contract";

/** Erro como a página o trata: os do endpoint e "rede" (sem resposta). */
export type PayError = PaymentErrorCode | "rede";
export type PayReply<T> = (T & { ok: true }) | { ok: false; erro: PayError };

/** Configuração do pagamento da página (null = a oferta não tem produto de pagamento). */
export function pageConfig(): PaymentPageConfig | null {
  const el = document.getElementById(PAYMENT_CONFIG_ID);
  return readPaymentConfig(el ? el.textContent : null);
}

/** Endereço absoluto do endpoint (null = fora da origem da página ou inválido). */
export function endpointUrl(cfg: PaymentPageConfig): string | null {
  try {
    const url = new URL(cfg.endpoint, location.href);
    if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin) return null;
    return url.href;
  } catch {
    return null;
  }
}

const TIMEOUT_MS = 25000;

/** POST JSON ao endpoint. Nunca lança: falha de rede vira { ok: false, erro: "rede" }. */
export function postPayment<T>(endpoint: string, body: Record<string, unknown>): Promise<PayReply<T>> {
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : 0;
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
    // Página com <meta name="referrer" content="no-referrer"> (comum em clonadas) faria o
    // navegador mandar "Origin: null", que o pagamento.php recusa: no mesmo site, a origem vai.
    referrerPolicy: "same-origin",
    signal: ctrl ? ctrl.signal : undefined,
  })
    .then((res) =>
      res.json().then(
        (json: unknown) => {
          const j = (json || {}) as { ok?: unknown; erro?: unknown };
          if (j.ok === true) return json as PayReply<T>;
          const erro =
            typeof j.erro === "string" ? (j.erro as PayError) : res.status >= 500 ? "indisponivel" : "invalido";
          return { ok: false as const, erro: erro };
        },
        () => ({
          ok: false as const,
          erro: (res.status >= 500 || res.status === 0 ? "indisponivel" : "invalido") as PayError,
        }),
      ),
    )
    .catch(() => ({ ok: false as const, erro: "rede" as PayError }))
    .then((r) => {
      if (timer) clearTimeout(timer);
      return r;
    });
}

// ── Pedido em andamento (por produto) ────────────────────────────────────────

/**
 * Cobrança aberta guardada no navegador: fechar a janela (ou a página) no meio
 * do SPEI e voltar mostra a mesma CLABE; um cartão já enviado volta a ser
 * conferido. Nada do comprador (nome, e-mail) fica guardado.
 */
export interface OpenOrder {
  v: 1;
  pedido: string;
  ext: string;
  metodo: PayMethod;
  valor: number;
  moeda: PayCurrency;
  at: number;
  spei?: SpeiInstructions;
  /** Cartão/Bizum/MB WAY já enviado ao gateway (falta só a confirmação). */
  enviado?: 1;
  simulacao?: 1;
}

const DAY = 864e5;
const HOUR = 36e5;

function key(endpoint: string, product: string) {
  return `os_pago:${endpoint}:${product}`;
}

/** Pedido aberto deste produto, se ainda vale (mesmo valor e moeda, dentro da validade). */
export function loadOrder(endpoint: string, product: string, valor: number, moeda: PayCurrency): OpenOrder | null {
  let o: OpenOrder | null = null;
  try {
    o = JSON.parse(localStorage.getItem(key(endpoint, product)) || "null");
  } catch {
    return null;
  }
  if (!o || o.v !== 1 || typeof o.pedido !== "string" || typeof o.ext !== "string") return null;
  const now = Date.now();
  const card = o.metodo !== "spei";
  // SPEI: até a validade da CLABE. Cartão já enviado: 1 hora (a sessão do SDK vence antes).
  const fallback = o.at + (card ? HOUR : 3 * DAY);
  const until = o.spei?.expiraEm ? Date.parse(o.spei.expiraEm) : fallback;
  const fresh = (Number.isNaN(until) ? fallback : until) > now && now - o.at < 7 * DAY;
  if (!fresh || o.valor !== valor || o.moeda !== moeda || (card && !o.enviado) || (!card && !o.spei)) {
    dropOrder(endpoint, product);
    return null;
  }
  return o;
}

export function saveOrder(endpoint: string, product: string, order: OpenOrder) {
  try {
    localStorage.setItem(key(endpoint, product), JSON.stringify(order));
  } catch {
    // armazenamento cheio ou bloqueado: segue sem memória
  }
}

export function dropOrder(endpoint: string, product: string) {
  try {
    localStorage.removeItem(key(endpoint, product));
  } catch {
    // armazenamento bloqueado: nada guardado
  }
}
