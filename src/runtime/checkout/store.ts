/**
 * O que a página de checkout guarda no navegador (sem dados de quem compra):
 * - a cobrança aberta (PIX, SPEI ou cartão já enviado): recarregar a página,
 *   ou voltar depois de pagar no app do banco, mostra o mesmo PIX e continua
 *   conferindo. Só o pedido, o valor, os itens (nomes e preços, para o
 *   Purchase) e os dados do pagamento — nada de nome, e-mail, CPF ou endereço;
 * - a cobrança ANTERIOR (OLD_SLOT): quem trocou de dados ou de forma de
 *   pagamento com um PIX/SPEI aberto — ela continua sendo conferida até vencer
 *   (quem pagou mesmo assim recebe a confirmação);
 * - os pedidos cujo Purchase já saiu (o mesmo pedido nunca conta duas vezes);
 * - o fim do cronômetro (recarregar não volta o relógio).
 * O cronômetro e a trava do InitiateCheckout são separados por endpoint (=
 * por oferta: duas ofertas no mesmo domínio podem ter a mesma chave de link).
 * Tudo à prova de armazenamento bloqueado (a página segue sem memória).
 */
import type { CheckoutPayMethod, PixInstructions } from "@/lib/checkout/contract";
import type { SpeiInstructions } from "@/lib/payments/contract";

/** Item da compra para os pixels (produto ou bump). */
export interface CheckoutItem {
  id: string;
  nome: string;
  /** Centavos. */
  valor: number;
}

export interface OpenCheckout {
  v: 1;
  pedido: string;
  ext: string;
  metodo: CheckoutPayMethod;
  valor: number;
  moeda: string;
  at: number;
  itens: CheckoutItem[];
  /** O que estava marcado (bumps e frete): o resumo volta igual ao recarregar. */
  bumps?: string[];
  frete?: string | null;
  pix?: { codigo: string; expiraEm: string | null };
  spei?: SpeiInstructions;
  /** Cartão/Bizum/MB WAY já enviado ao gateway (falta só a confirmação). */
  enviado?: 1;
  simulacao?: 1;
  /**
   * Relógio do servidor menos o do aparelho (ms), da última resposta: a
   * validade vem do servidor e o aparelho pode estar com a hora errada.
   */
  skew?: number;
}

/** Memória da cobrança anterior (trocou de dados ou de forma de pagamento): `${chave}${OLD_SLOT}`. */
export const OLD_SLOT = ":anterior";

const HOUR = 36e5;
const DAY = 864e5;

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // armazenamento cheio ou bloqueado: segue sem memória
  }
}

const orderKey = (endpoint: string, chave: string) => `os_checkout:${endpoint}:${chave}`;

/** Cobrança aberta deste checkout, se ainda vale (null = nenhuma). */
export function loadOpen(endpoint: string, chave: string, now = Date.now()): OpenCheckout | null {
  const o = read(orderKey(endpoint, chave)) as OpenCheckout | null;
  if (!openValid(o, now)) {
    dropOpen(endpoint, chave);
    return null;
  }
  return o;
}

/** A cobrança guardada ainda vale (formato certo e dentro da validade + 1 hora)? */
export function openValid(o: OpenCheckout | null, now = Date.now()): o is OpenCheckout {
  if (!o || o.v !== 1 || typeof o.pedido !== "string" || typeof o.ext !== "string" || !Array.isArray(o.itens)) {
    return false;
  }
  const exp = o.pix ? o.pix.expiraEm : o.spei ? o.spei.expiraEm : null;
  // PIX: até a validade (sem validade: 1 dia). SPEI: até a validade (3 dias). Cartão enviado: 1 hora.
  // Depois de vencer, mais 1 hora: quem pagou no último minuto ainda vê a confirmação ao voltar.
  const fallback = o.at + (o.metodo === "pix" ? DAY : o.metodo === "spei" ? 3 * DAY : HOUR);
  const until = exp ? Date.parse(exp) : fallback;
  // A validade é do relógio do servidor: com o do aparelho adiantado, a conta usa a diferença guardada.
  const server = exp && typeof o.skew === "number" && Number.isFinite(o.skew) ? now + o.skew : now;
  const valid =
    (o.metodo === "pix" ? !!o.pix : o.metodo === "spei" ? !!o.spei : o.enviado === 1) &&
    (Number.isNaN(until) ? fallback : until) > server - HOUR &&
    now - o.at < 7 * DAY;
  return valid;
}

export function saveOpen(endpoint: string, chave: string, o: OpenCheckout) {
  write(orderKey(endpoint, chave), o);
}

export function dropOpen(endpoint: string, chave: string) {
  write(orderKey(endpoint, chave), null);
}

const BOUGHT = "os_comprou";

/** O Purchase deste pedido já saiu (neste navegador)? */
export function purchaseSent(ext: string): boolean {
  const list = read(BOUGHT);
  return Array.isArray(list) && list.indexOf(ext) >= 0;
}

/** Marca o Purchase do pedido como enviado (guarda os 30 últimos). */
export function markPurchase(ext: string) {
  const list = read(BOUGHT);
  const next = (Array.isArray(list) ? list.filter((x) => typeof x === "string" && x !== ext) : []).slice(-29);
  next.push(ext);
  write(BOUGHT, next);
}

/**
 * Fim do cronômetro deste checkout (começa na 1ª visita; recarregar não volta
 * o relógio). `scope` = endpoint + chave do link (separa as ofertas do mesmo domínio).
 */
export function timerEnd(scope: string, minutes: number, now = Date.now()): number {
  const key = `os_cron:${scope}`;
  const saved = read(key) as { m: number; end: number } | null;
  // O relógio volta a contar do começo quando você muda os minutos ou um dia depois de zerar.
  if (saved && saved.m === minutes && typeof saved.end === "number" && now - saved.end < DAY) return saved.end;
  const end = now + minutes * 60_000;
  write(key, { m: minutes, end: end });
  return end;
}

/** O InitiateCheckout deste checkout (`scope` = endpoint + chave) já saiu nesta aba? (recarregar não conta de novo) */
export function initiatedOnce(scope: string): boolean {
  const key = `os_ic:${scope}`;
  try {
    if (sessionStorage.getItem(key)) return true;
    sessionStorage.setItem(key, "1");
  } catch {
    // sem armazenamento: conta a cada abertura
  }
  return false;
}

/** PixInstructions → o que fica guardado (a imagem do gateway não: a página gera o QR do código). */
export function storedPix(pix: PixInstructions): OpenCheckout["pix"] {
  return { codigo: pix.codigo, expiraEm: pix.expiraEm };
}
