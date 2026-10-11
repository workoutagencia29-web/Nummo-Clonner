/**
 * Contrato do checkout do Offer Studio — UM lugar só para a prévia do app
 * (sempre em simulação), o pagamento.php do ZIP e o script da página de
 * checkout. Segue o do pagamento na página (src/lib/payments/contract.ts): o
 * mesmo endpoint (prévia /__os/pagamento; ZIP pagamento.php), com ações novas.
 *
 * Sem dependências de servidor e sem desestruturação: o script da página
 * importa daqui (alvo Safari 13).
 *
 * ── Página de checkout ───────────────────────────────────────────────────────
 * Endereço próprio por produto: prévia /checkout/<chave do link>; ZIP
 * checkout/<chave do link>/index.html. Os botões ligados ao link levam para lá
 * (com os parâmetros repassados como nos outros links). A página leva o JSON
 * <script type="application/json" id="os-checkout"> (PublicCheckoutConfig):
 * nada secreto — nunca a chave da API nem os links de acesso.
 *
 * ── Valor ────────────────────────────────────────────────────────────────────
 * Calculado SEMPRE no servidor (checkoutTotal com os preços salvos): produto +
 * bumps escolhidos + frete escolhido. O navegador só manda os ids.
 *
 * ── Endpoint (POST, JSON, mesma origem; erros como no pagamento na página) ───
 *   { acao: "checkout_criar", checkout, metodo, nome, email, telefone?,
 *     documento?, endereco?, bumps, frete, metadata? }
 *     → 201 CheckoutCreateResponse (PIX: código copia e cola + imagem do QR;
 *       Kyvo: os dados de SPEI/cartão da janela de pagamento).
 *   { acao: "checkout_status", pedido, checkout }
 *     → 200 CheckoutStatusResponse (só o status; nada de quem comprou).
 *   { acao: "acesso", pedido }  (o mesmo do bloco "Acesso ao produto")
 *     → 200 com o link do produto e, em `extras`, os dos bumps comprados.
 *   { acao: "simular", pedido, resultado }  SÓ NA PRÉVIA.
 * Webhook dos gateways de PIX: POST pagamento.php?webhook=flevopay|blackcat —
 * o corpo NUNCA é confiável sozinho (sem assinatura documentada): o servidor
 * confere o status consultando o gateway com a chave.
 *
 * ── O `pedido` público é uma CREDENCIAL ──────────────────────────────────────
 * O `pedido` que a página recebe (e que vai no ?pedido= da página de obrigado,
 * no checkout_status e no "acesso", que devolve os links privados do produto
 * e dos bumps) é um id NOSSO, aleatório e impossível de adivinhar
 * (CHECKOUT_ORDER_RE: 16+ caracteres, nunca só algarismos; a prévia usa
 * "sim_" + 18 hexadecimais). NUNCA o id da cobrança no gateway: a FlevoPay
 * numera as cobranças em sequência (238, 239…) — quem tivesse um pedido
 * pegaria o acesso dos outros. O id do gateway fica só no servidor
 * (pagamento-dados), para consultar o status e conferir o webhook. Também não
 * é o pedidoExterno (ele vai aos pixels como eventID).
 *
 * ── Hora do servidor ─────────────────────────────────────────────────────────
 * As respostas de checkout_criar e checkout_status levam `agora` (ms desde
 * 1970, relógio do servidor): a validade do PIX/SPEI é do servidor, e a página
 * conta o tempo com a diferença para o relógio do aparelho (que pode estar
 * adiantado). Sem `agora`, a página nunca dá a cobrança por vencida pelo
 * relógio: só quando o servidor responde "expired".
 */
import type { CardInstructions, PayCurrency, PayMethod, PayStatus, SpeiInstructions } from "../payments/contract";

/** id do <script type="application/json"> com PublicCheckoutConfig. */
export const CHECKOUT_CONFIG_ID = "os-checkout";
/** Versão do PublicCheckoutConfig (suba quando o script antigo não souber ler o novo). */
export const CHECKOUT_CONFIG_VERSION = 1;
/** Página de checkout na prévia: /checkout/<chave do link>. */
export const PREVIEW_CHECKOUT_PREFIX = "/checkout/";
/** Pasta das páginas de checkout no ZIP: checkout/<chave do link>/index.html. */
export const ZIP_CHECKOUT_DIR = "checkout/";
/**
 * Versão A/B da página de vendas no endereço da página de checkout
 * (?os_versao=B, o mesmo nome do VERSION_PARAM do rastreamento): o render das
 * páginas com mais de uma versão põe nos botões e nos prêmios da roleta que
 * levam ao checkout do Offer Studio (withCheckoutVersion), e a página de
 * checkout a leva aos eventos dos pixels e à metadata da cobrança
 * (CHECKOUT_VERSION_SCRIPT em ./page.ts).
 */
export const CHECKOUT_VERSION_PARAM = "os_versao";
/** Formato da letra da versão (o mesmo que o rastreamento aceita no #os-tracking). */
export const CHECKOUT_VERSION_RE = /^[\w-]{1,20}$/;

/** Endereço da página de checkout com a versão A/B (sem trocar uma que já esteja nele; mantém o #). */
export function withCheckoutVersion(href: string, version: string): string {
  if (!href || !CHECKOUT_VERSION_RE.test(version)) return href;
  const cut = href.indexOf("#");
  const base = cut < 0 ? href : href.slice(0, cut);
  const hash = cut < 0 ? "" : href.slice(cut);
  const q = base.indexOf("?");
  if (new URLSearchParams(q < 0 ? "" : base.slice(q + 1)).has(CHECKOUT_VERSION_PARAM)) return href;
  const sep = q < 0 ? "?" : /[?&]$/.test(base) ? "" : "&";
  return `${base}${sep}${CHECKOUT_VERSION_PARAM}=${encodeURIComponent(version)}${hash}`;
}

/** Parâmetro do webhook no pagamento.php (?webhook=flevopay|blackcat). */
export const WEBHOOK_PARAM = "webhook";
export const WEBHOOK_PROVIDERS = ["flevopay", "blackcat"] as const;
/** Intervalo inicial entre consultas de status do PIX (a página recua até CHECKOUT_POLL_MAX_MS). */
export const CHECKOUT_POLL_MS = 3000;
export const CHECKOUT_POLL_MAX_MS = 15000;

/** Forma de pagamento como a página e o endpoint a chamam. */
export type CheckoutPayMethod = "pix" | PayMethod;
export const CHECKOUT_PAY_METHODS: readonly CheckoutPayMethod[] = ["pix", "spei", "card", "bizum", "mb_way"];
export type CheckoutCurrency = "BRL" | PayCurrency;

/** Endereço de entrega (Brasil). Só os algarismos no CEP; UF com 2 letras. */
export interface CheckoutAddress {
  cep: string;
  rua: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
}

/** Campos da metadata que a página pode mandar (os mesmos do pagamento na página). */
export const CHECKOUT_METADATA_KEYS = [
  "utm_source",
  "utm_campaign",
  "utm_medium",
  "utm_content",
  "utm_term",
  "src",
  "sck",
  "fbc",
  "fbp",
  "ttclid",
  "ttp",
  "os_versao",
] as const;
export type CheckoutMetadataKey = (typeof CHECKOUT_METADATA_KEYS)[number];
const METADATA_VALUE_MAX = 500;

export interface CheckoutCreateRequest {
  acao: "checkout_criar";
  /** Chave do link da oferta (a página de checkout é dele). */
  checkout: string;
  metodo: CheckoutPayMethod;
  nome: string;
  email: string;
  /** Só algarismos (DDD + número no Brasil). */
  telefone?: string;
  /** CPF (só algarismos) no real; documento livre nas outras moedas. */
  documento?: string;
  endereco?: CheckoutAddress;
  /** Ids dos bumps marcados. */
  bumps: string[];
  /** Id do frete escolhido (null = sem endereço). */
  frete: string | null;
  metadata?: Partial<Record<CheckoutMetadataKey, string>>;
}

export interface CheckoutStatusRequest {
  acao: "checkout_status";
  pedido: string;
  checkout: string;
}

export type CheckoutRequest = CheckoutCreateRequest | CheckoutStatusRequest;

/** Dados do PIX para quem compra. */
export interface PixInstructions {
  /** Código "copia e cola" (o QR é este texto). */
  codigo: string;
  /** Imagem do QR que o gateway mandou (data:image/png;base64,…) ou null — a página gera do código. */
  imagem: string | null;
  /** Validade (ISO 8601) ou null. */
  expiraEm: string | null;
}

export interface CheckoutCreateResponse {
  ok: true;
  /**
   * Credencial pública do pedido (vai no ?pedido= da página de obrigado, no
   * checkout_status e no "acesso"): id NOSSO e aleatório (CHECKOUT_ORDER_RE),
   * nunca o id da cobrança no gateway (ver o topo do arquivo).
   */
  pedido: string;
  /** Id do pedido gerado pelo servidor: eventID do Purchase. */
  pedidoExterno: string;
  status: PayStatus;
  /** Total cobrado (produto + bumps + frete), calculado no servidor. */
  valor: number;
  moeda: CheckoutCurrency;
  metodo: CheckoutPayMethod;
  pix?: PixInstructions;
  spei?: SpeiInstructions;
  cartao?: CardInstructions;
  /** Prévia do app: nada foi cobrado. */
  simulacao?: true;
  /** Hora do servidor (ms desde 1970): a página conta a validade por ela. */
  agora?: number;
}

export interface CheckoutStatusResponse {
  ok: true;
  pedido: string;
  status: PayStatus;
  pago: boolean;
  pedidoExterno: string;
  valor: number;
  moeda: CheckoutCurrency;
  /** Hora do servidor (ms desde 1970). */
  agora?: number;
}

/** Link de acesso de um bump comprado (só para pedido pago). */
export interface CheckoutExtraAccess {
  titulo: string;
  acesso: string;
}

// ─── Página (JSON #os-checkout) ──────────────────────────────────────────────

export interface PublicShipping {
  id: string;
  nome: string;
  prazo: string;
  /** Centavos (0 = grátis). */
  valor: number;
}

export interface PublicBump {
  id: string;
  titulo: string;
  descricao: string;
  valor: number;
  /** Preço "de" (centavos) ou null. */
  valorDe: number | null;
  /** Endereço da imagem (relativo à página) ou null. */
  imagem: string | null;
}

export interface PublicTestimonial {
  texto: string;
  nome: string;
  foto: string | null;
}

/** O que a página de checkout sabe do produto (nada secreto). */
export interface PublicCheckoutConfig {
  v: number;
  /** Endpoint relativo (prévia /__os/pagamento; ZIP ../../pagamento.php). Nunca vem do visitante. */
  endpoint: string;
  /** Prévia do app: nada é cobrado (botões "Simular pagamento aprovado/recusado"). */
  simulacao: boolean;
  /** Chave do link (o "checkout" dos pedidos ao endpoint). */
  chave: string;
  nome: string;
  descricao: string;
  imagem: string | null;
  valor: number;
  valorDe: number | null;
  moeda: CheckoutCurrency;
  idioma: "pt" | "es" | "en";
  /** "pix" (FlevoPay/BlackCat) ou "kyvo". */
  gateway: "pix" | "kyvo";
  metodos: CheckoutPayMethod[];
  /** Campos pedidos de quem compra. */
  campos: ("name" | "email" | "phone" | "document")[];
  endereco: boolean;
  fretes: PublicShipping[];
  freteInicial: string | null;
  bumps: PublicBump[];
  cor: string;
  bannerComputador: string | null;
  bannerCelular: string | null;
  logo: string | null;
  /** Cronômetro em minutos (null = desligado). */
  cronometro: number | null;
  selos: { seguro: boolean; garantia: boolean };
  depoimentos: PublicTestimonial[];
  /** Textos que valem (os trocados no painel ou os padrões do idioma). */
  textos: Record<string, string>;
  /** Endereço da página de obrigado (relativo) ou null. */
  obrigado: string | null;
}

// ─── Total ───────────────────────────────────────────────────────────────────

/** Preços que o servidor conhece (do produto salvo). */
export interface CheckoutPrices {
  valor: number;
  bumps: { id: string; valor: number }[];
  fretes: { id: string; valor: number }[];
  /** Pede endereço (e então o frete é obrigatório). */
  endereco: boolean;
}

export interface CheckoutTotal {
  produto: number;
  bumps: string[];
  valorBumps: number;
  frete: string | null;
  valorFrete: number;
  total: number;
}

/**
 * Total da compra a partir dos PREÇOS SALVOS e só dos ids que o navegador
 * mandou. null = pedido inválido (bump desconhecido ou repetido; frete faltando,
 * desconhecido ou mandado sem endereço).
 */
export function checkoutTotal(
  prices: CheckoutPrices,
  bumpIds: readonly string[],
  freteId: string | null,
): CheckoutTotal | null {
  const chosen: string[] = [];
  let valorBumps = 0;
  for (let i = 0; i < bumpIds.length; i++) {
    const id = bumpIds[i];
    if (chosen.indexOf(id) >= 0) return null;
    let found: { id: string; valor: number } | null = null;
    for (let j = 0; j < prices.bumps.length; j++) if (prices.bumps[j].id === id) found = prices.bumps[j];
    if (!found) return null;
    chosen.push(id);
    valorBumps += found.valor;
  }
  let valorFrete = 0;
  let frete: string | null = null;
  if (prices.endereco && prices.fretes.length) {
    if (!freteId) return null;
    let found: { id: string; valor: number } | null = null;
    for (let j = 0; j < prices.fretes.length; j++) if (prices.fretes[j].id === freteId) found = prices.fretes[j];
    if (!found) return null;
    frete = found.id;
    valorFrete = found.valor;
  } else if (freteId) {
    return null;
  }
  return {
    produto: prices.valor,
    bumps: chosen,
    valorBumps: valorBumps,
    frete: frete,
    valorFrete: valorFrete,
    total: prices.valor + valorBumps + valorFrete,
  };
}

// ─── Leitura dos pedidos ao endpoint ─────────────────────────────────────────

/** Chave do link (a mesma regra do pagamento na página). */
export const CHECKOUT_KEY_RE = /^[a-z0-9-]{1,80}$/;
/**
 * Pedido aceito do navegador (a credencial pública: ver o topo do arquivo):
 * de 16 a 100 caracteres, nunca só algarismos — um número de cobrança do
 * gateway (sequencial) nunca vale como credencial.
 */
export const CHECKOUT_ORDER_RE = /^(?![0-9]+$)[A-Za-z0-9_-]{16,100}$/;

/** O texto pode ser a credencial pública de um pedido do checkout? */
export function isCheckoutOrderId(value: unknown): boolean {
  return typeof value === "string" && CHECKOUT_ORDER_RE.test(value);
}
const ITEM_RE = /^[a-z0-9]{4,16}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@.]{2,63}$/;
const NAME_MAX = 120;
const ADDRESS_MAX = 120;

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function clean(v: unknown, max: number): string {
  return (str(v) || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function readAddress(raw: unknown): CheckoutAddress | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const cep = (str(o.cep) || "").replace(/\D+/g, "");
  const uf = (str(o.uf) || "").trim().toUpperCase();
  const out: CheckoutAddress = {
    cep: cep,
    rua: clean(o.rua, ADDRESS_MAX),
    numero: clean(o.numero, 20),
    complemento: clean(o.complemento, ADDRESS_MAX),
    bairro: clean(o.bairro, ADDRESS_MAX),
    cidade: clean(o.cidade, ADDRESS_MAX),
    uf: uf,
  };
  if (cep.length !== 8 || !/^[A-Z]{2}$/.test(uf)) return null;
  if (!out.rua || !out.numero || !out.bairro || !out.cidade) return null;
  return out;
}

/**
 * Confere o FORMATO de um pedido de checkout ao endpoint (null = inválido →
 * "invalido"). As regras que dependem do produto (campos pedidos, CPF,
 * telefone, bumps e frete que existem) o servidor confere depois, com a
 * configuração salva. É a referência do pagamento.php (mesmas regras).
 */
export function parseCheckoutRequest(raw: unknown): CheckoutRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const checkout = str(o.checkout);
  if (!checkout || !CHECKOUT_KEY_RE.test(checkout)) return null;
  if (o.acao === "checkout_status") {
    const pedido = str(o.pedido);
    if (!pedido || !CHECKOUT_ORDER_RE.test(pedido)) return null;
    return { acao: "checkout_status", pedido: pedido, checkout: checkout };
  }
  if (o.acao !== "checkout_criar") return null;
  const metodo = str(o.metodo) as CheckoutPayMethod | null;
  if (!metodo || CHECKOUT_PAY_METHODS.indexOf(metodo) < 0) return null;
  const nome = clean(o.nome, NAME_MAX + 1);
  const email = (str(o.email) || "").trim().toLowerCase();
  if (nome.length < 2 || nome.length > NAME_MAX) return null;
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  const out: CheckoutCreateRequest = {
    acao: "checkout_criar",
    checkout: checkout,
    metodo: metodo,
    nome: nome,
    email: email,
    bumps: [],
    frete: null,
  };
  const telefone = (str(o.telefone) || "").replace(/\D+/g, "");
  if (telefone) {
    if (telefone.length < 8 || telefone.length > 15) return null;
    out.telefone = telefone;
  }
  const documento = (str(o.documento) || "").trim().toUpperCase();
  if (documento) {
    if (!/^[A-Z0-9./-]{4,40}$/.test(documento)) return null;
    out.documento = documento;
  }
  if (o.endereco !== undefined && o.endereco !== null) {
    const endereco = readAddress(o.endereco);
    if (!endereco) return null;
    out.endereco = endereco;
  }
  if (o.bumps !== undefined && o.bumps !== null) {
    if (!Array.isArray(o.bumps) || o.bumps.length > 3) return null;
    for (let i = 0; i < o.bumps.length; i++) {
      const id = str(o.bumps[i]);
      if (!id || !ITEM_RE.test(id) || out.bumps.indexOf(id) >= 0) return null;
      out.bumps.push(id);
    }
  }
  if (o.frete !== undefined && o.frete !== null && o.frete !== "") {
    const frete = str(o.frete);
    if (!frete || !ITEM_RE.test(frete)) return null;
    out.frete = frete;
  }
  const meta = o.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const cleanMeta: Partial<Record<CheckoutMetadataKey, string>> = {};
    let any = false;
    for (let i = 0; i < CHECKOUT_METADATA_KEYS.length; i++) {
      const k = CHECKOUT_METADATA_KEYS[i];
      const v = str((meta as Record<string, unknown>)[k]);
      if (v?.trim()) {
        cleanMeta[k] = v.trim().slice(0, METADATA_VALUE_MAX);
        any = true;
      }
    }
    if (any) out.metadata = cleanMeta;
  }
  return out;
}

/** O status quer dizer "pago"? */
export function isPaidStatus(status: PayStatus): boolean {
  return status === "paid";
}

/** Lê o PublicCheckoutConfig embutido (null = ausente ou em formato inválido). Para o script da página. */
export function readCheckoutConfig(text: string | null | undefined): PublicCheckoutConfig | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const c = raw as PublicCheckoutConfig;
  if (c.v !== CHECKOUT_CONFIG_VERSION || typeof c.endpoint !== "string" || typeof c.chave !== "string") return null;
  if (!CHECKOUT_KEY_RE.test(c.chave) || typeof c.valor !== "number" || typeof c.moeda !== "string") return null;
  if (!Array.isArray(c.metodos) || !Array.isArray(c.campos) || !Array.isArray(c.bumps) || !Array.isArray(c.fretes)) {
    return null;
  }
  if (!c.textos || typeof c.textos !== "object") return null;
  return c;
}
