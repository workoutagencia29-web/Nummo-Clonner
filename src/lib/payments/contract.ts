/**
 * Contrato do pagamento na página — UM lugar só para a prévia do app
 * (src/preview/server.ts, sempre em simulação), o pagamento.php do ZIP
 * (src/lib/export/payment-php.ts) e o script das páginas (src/runtime: janela de
 * pagamento e bloco "Acesso ao produto").
 *
 * Sem dependências e sem desestruturação: o script das páginas importa daqui
 * (alvo Safari 13).
 *
 * ── Na página (posto pelo render, src/lib/page-render.ts) ──────────────────
 * - Botão ligado a um link "Pagamento na página": data-os-pay="<chave do link>"
 *   (o data-os-link continua: InitiateCheckout, prêmio da roleta). <a> recebe
 *   href="#" e os outros perdem o data-os-href: sem a janela, o botão não leva
 *   a checkout nenhum.
 * - <script type="application/json" id="os-pagamento"> com PaymentPageConfig
 *   (produtos sem nada secreto: nome, valor, moeda, métodos, idioma e o
 *   endereço da página de obrigado). Nunca a chave da API nem o link de acesso.
 *
 * ── Endpoint (POST, JSON, mesma origem; prévia: /__os/pagamento; ZIP: pagamento.php) ──
 * Corpo até PAYMENT_MAX_BODY bytes, Content-Type application/json (ou
 * text/plain). Sempre responde JSON: { ok: true, ... } ou
 * { ok: false, erro: PaymentErrorCode } com o status de PAYMENT_ERROR_STATUS.
 * A janela traduz o código para o idioma do comprador (nenhum texto do
 * servidor aparece para ele).
 *
 *   { acao: "criar", produto, metodo, nome, email, documento?, metadata? }
 *     → 201 PaymentCreateResponse. Valor e moeda vêm SEMPRE da configuração
 *       do produto no servidor. O servidor gera o pedidoExterno (identifica o
 *       produto, ver ./orders) e completa a metadata com ip e ua.
 *   { acao: "status", pedido, produto }
 *     → 200 PaymentStatusResponse (só o status; nada do comprador).
 *   { acao: "acesso", pedido, produto? }
 *     → 200 PaymentAccessResponse só para pedido PAGO cujo pedidoExterno
 *       (lido do gateway, nunca do navegador) é do produto — e, com `produto`,
 *       desse produto; pendente → 409 "pendente"; outro status → 403 "nao_pago".
 *   { acao: "simular", pedido, resultado: "pago" | "recusado" | "expirado" }
 *     → 200 PaymentStatusResponse. SÓ NA PRÉVIA (o pagamento.php recusa com 400).
 */

/** Atributo dos botões que abrem a janela de pagamento (valor: chave do link da oferta). */
export const PAY_ATTR = "data-os-pay";
/** id do <script type="application/json"> com PaymentPageConfig. */
export const PAYMENT_CONFIG_ID = "os-pagamento";
/** Versão do PaymentPageConfig (suba quando o script antigo não souber ler o novo). */
export const PAYMENT_CONFIG_VERSION = 1;
/** Endpoint na prévia do app (mesma origem da página). */
export const PREVIEW_PAYMENT_ENDPOINT = "/__os/pagamento";
/** Nome do endpoint no ZIP (raiz do site; o render põe o caminho relativo certo). */
export const ZIP_PAYMENT_ENDPOINT = "pagamento.php";
/** Parâmetro da página de obrigado com o identificador do pedido (?pedido=tx_…). */
export const ORDER_PARAM = "pedido";
/**
 * O ?pedido= é a credencial do link de acesso: um script no começo do <head>
 * (ORDER_STRIP_SCRIPT, src/lib/payments/render.ts) tira o parâmetro do
 * endereço antes dos pixels e de qualquer script de terceiros, e guarda o
 * pedido aqui (sessionStorage "os_pedido:<caminho da página>": recarregar a
 * aba continua dando o acesso; e em window.__osPedido quando o armazenamento
 * falha) para o bloco de acesso.
 */
export const ORDER_STORE_PREFIX = "os_pedido:";
/** Tamanho máximo do corpo do pedido ao endpoint. */
export const PAYMENT_MAX_BODY = 8 * 1024;
/** Intervalo sugerido entre consultas de status (a janela confere a cada ~4 s). */
export const PAYMENT_POLL_MS = 4000;

/** Métodos como a página e o endpoint os chamam. */
export type PayMethod = "spei" | "card" | "bizum" | "mb_way";
export const PAY_METHODS: readonly PayMethod[] = ["spei", "card", "bizum", "mb_way"];
/** Idioma da janela (do produto). */
export type PayLocale = "es" | "en" | "pt";
export type PayCurrency = "MXN" | "EUR" | "USD";

/** Status de uma cobrança (os da Kyvo; outros gateways traduzem para estes). */
export type PayStatus = "pending" | "paid" | "expired" | "failed" | "canceled" | "refunded" | "disputed";
export const PAY_STATUSES: readonly PayStatus[] = [
  "pending",
  "paid",
  "expired",
  "failed",
  "canceled",
  "refunded",
  "disputed",
];

/** Produto como a página o conhece (público). */
export interface PublicPaymentProduct {
  /** Nome mostrado ao comprador. */
  nome: string;
  /** Valor em centavos da moeda. */
  valor: number;
  moeda: PayCurrency;
  /** Métodos ligados, na ordem de exibição. */
  metodos: PayMethod[];
  idioma: PayLocale;
  /** Endereço da página de obrigado (relativo à página), ou null se não escolhida. */
  obrigado: string | null;
}

/** JSON embutido na página (#os-pagamento). */
export interface PaymentPageConfig {
  v: number;
  /** Endpoint relativo (prévia: /__os/pagamento; ZIP: ../pagamento.php…). Nunca vem do visitante. */
  endpoint: string;
  /** Prévia do app: nada é cobrado; a janela mostra "Simular pagamento aprovado/recusado". */
  simulacao: boolean;
  /** Chave do link da oferta → produto. */
  produtos: Record<string, PublicPaymentProduct>;
}

/** Campos da metadata que a página pode mandar (o servidor completa ip e ua). */
export const PAYMENT_METADATA_KEYS = [
  "utm_source",
  "utm_campaign",
  "utm_medium",
  "utm_content",
  "utm_term",
  "src",
  "fbc",
  "fbp",
  "ttclid",
  "ttp",
  "os_versao",
] as const;
export type PaymentMetadataKey = (typeof PAYMENT_METADATA_KEYS)[number];
export const PAYMENT_METADATA_VALUE_MAX = 500;

export interface PaymentCreateRequest {
  acao: "criar";
  /** Chave do link da oferta (data-os-pay). */
  produto: string;
  metodo: PayMethod;
  nome: string;
  email: string;
  documento?: string;
  metadata?: Partial<Record<PaymentMetadataKey, string>>;
}

export interface PaymentStatusRequest {
  acao: "status";
  pedido: string;
  produto: string;
}

export interface PaymentAccessRequest {
  acao: "acesso";
  pedido: string;
  produto?: string;
}

export interface PaymentSimulateRequest {
  acao: "simular";
  pedido: string;
  resultado: "pago" | "recusado" | "expirado";
}

export type PaymentRequest =
  | PaymentCreateRequest
  | PaymentStatusRequest
  | PaymentAccessRequest
  | PaymentSimulateRequest;

/** Dados do SPEI (México) para o comprador transferir. */
export interface SpeiInstructions {
  clabe: string;
  banco: string;
  /** Titular da conta (nominal || beneficiary na Kyvo). */
  titular: string;
  /** Referência (concepto) da transferência. */
  referencia: string;
  /** Validade (ISO 8601) ou null. */
  expiraEm: string | null;
}

/** Sessão do formulário de cartão do gateway (Kyvo: KyvoCard.mount({ session })). */
export interface CardInstructions {
  /**
   * Script do SDK (só https://kyvopay.com/sdk/… — ver isAllowedSdkUrl). Na
   * simulação (prévia) vem "" e a sessão é { simulacao: true }: a janela mostra
   * um formulário de cartão de mentira, sem carregar SDK nenhum.
   */
  sdkUrl: string;
  /** Sessão como veio do gateway (passe inteira ao SDK; uso único). */
  sessao: Record<string, unknown>;
  expiraEm: string | null;
}

export interface PaymentCreateResponse {
  ok: true;
  /** Id da cobrança no gateway (tx_…): vai no ?pedido= da página de obrigado. */
  pedido: string;
  /** Id do pedido gerado pelo servidor: eventID do Purchase (dedup com o Purchase server-side da Kyvo). */
  pedidoExterno: string;
  status: PayStatus;
  /** Valor e moeda cobrados (os da configuração do produto). */
  valor: number;
  moeda: PayCurrency;
  metodo: PayMethod;
  /** Só no SPEI. */
  spei?: SpeiInstructions;
  /** Só em cartão, Bizum e MB WAY. */
  cartao?: CardInstructions;
  /** Prévia do app: nada foi cobrado. */
  simulacao?: true;
}

export interface PaymentStatusResponse {
  ok: true;
  pedido: string;
  status: PayStatus;
  pago: boolean;
  /** Repetidos para o Purchase da página (valor e moeda do produto). */
  pedidoExterno: string;
  valor: number;
  moeda: PayCurrency;
}

export interface PaymentAccessResponse {
  ok: true;
  pedido: string;
  status: "paid";
  /** Link de acesso ao produto (só aqui, só para pedido pago do produto). */
  acesso: string;
  /** Chave do produto do pedido. */
  produto: string;
}

/** Códigos de erro do endpoint (a janela traduz no idioma do comprador). */
export type PaymentErrorCode =
  | "invalido" // corpo/campo inválido
  | "corpo_grande" // passou de PAYMENT_MAX_BODY
  | "origem" // pedido de outro site
  | "produto_desconhecido" // a chave não é um produto desta oferta
  | "metodo_indisponivel" // método não ligado no produto (ou incompatível com a moeda)
  | "recusado" // cartão recusado (402 payment_declined): peça outro cartão
  | "nao_encontrado" // pedido não existe (ou é de outro produto)
  | "pendente" // acesso pedido com o pagamento ainda pendente
  | "nao_pago" // acesso pedido para pedido expirado/falho/cancelado/estornado
  | "limite" // muitas cobranças criadas (limite por IP)
  | "indisponivel" // gateway fora do ar / sem conexão (tente de novo)
  | "configuracao"; // chave da API ausente/inválida ou produto incompleto no servidor

export const PAYMENT_ERROR_STATUS: Record<PaymentErrorCode, number> = {
  invalido: 400,
  corpo_grande: 413,
  origem: 403,
  produto_desconhecido: 404,
  metodo_indisponivel: 400,
  recusado: 402,
  nao_encontrado: 404,
  pendente: 409,
  nao_pago: 403,
  limite: 429,
  indisponivel: 502,
  configuracao: 503,
};

export interface PaymentErrorResponse {
  ok: false;
  erro: PaymentErrorCode;
}

export type PaymentResponse =
  | PaymentCreateResponse
  | PaymentStatusResponse
  | PaymentAccessResponse
  | PaymentErrorResponse;

/**
 * Chave de link da oferta (data-os-pay). Até 80, como as chaves de link
 * (linkKey nunca passa de SLUG_MAX) e o KEY_RE da roleta (src/lib/wheel.ts);
 * o pagamento.php usa esta mesma regra (OS_PRODUCT_RE).
 */
export const PRODUCT_KEY_RE = /^[a-z0-9-]{1,80}$/;
/** Id de cobrança aceito do navegador (tx_… na Kyvo; sim_… na prévia). */
export const ORDER_ID_RE = /^[A-Za-z0-9_-]{3,100}$/;
/** E-mail simples (o gateway confere de verdade). */
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@.]{2,63}$/;
export const NAME_MAX = 120;
export const DOCUMENT_RE = /^[A-Za-z0-9./-]{4,40}$/;

/** Script do SDK de cartão que a página pode carregar (só o do gateway, por https). */
export function isAllowedSdkUrl(url: string): boolean {
  return /^https:\/\/kyvopay\.com\/sdk\/[A-Za-z0-9._/-]+(?:\?[A-Za-z0-9=&._-]*)?$/.test(url);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Confere o corpo de um pedido ao endpoint (null = inválido → "invalido").
 * Remove da metadata o que não está em PAYMENT_METADATA_KEYS e corta valores
 * longos. É a referência do pagamento.php (mesmas regras).
 */
export function parsePaymentRequest(raw: unknown): PaymentRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const acao = o.acao;
  if (acao === "criar") {
    const produto = str(o.produto);
    const metodo = str(o.metodo) as PayMethod | null;
    const nome = (str(o.nome) || "").trim().replace(/\s+/g, " ");
    const email = (str(o.email) || "").trim().toLowerCase();
    const documento = (str(o.documento) || "").trim().toUpperCase();
    if (!produto || !PRODUCT_KEY_RE.test(produto)) return null;
    if (!metodo || PAY_METHODS.indexOf(metodo) < 0) return null;
    if (nome.length < 2 || nome.length > NAME_MAX) return null;
    if (!EMAIL_RE.test(email) || email.length > 254) return null;
    if (documento && !DOCUMENT_RE.test(documento)) return null;
    const out: PaymentCreateRequest = { acao: "criar", produto: produto, metodo: metodo, nome: nome, email: email };
    if (documento) out.documento = documento;
    const meta = o.metadata;
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      const clean: Partial<Record<PaymentMetadataKey, string>> = {};
      let any = false;
      for (let i = 0; i < PAYMENT_METADATA_KEYS.length; i++) {
        const k = PAYMENT_METADATA_KEYS[i];
        const v = str((meta as Record<string, unknown>)[k]);
        if (v?.trim()) {
          clean[k] = v.trim().slice(0, PAYMENT_METADATA_VALUE_MAX);
          any = true;
        }
      }
      if (any) out.metadata = clean;
    }
    return out;
  }
  const pedido = str(o.pedido);
  if (!pedido || !ORDER_ID_RE.test(pedido)) return null;
  if (acao === "status") {
    const produto = str(o.produto);
    if (!produto || !PRODUCT_KEY_RE.test(produto)) return null;
    return { acao: "status", pedido: pedido, produto: produto };
  }
  if (acao === "acesso") {
    const produto = o.produto === undefined || o.produto === null || o.produto === "" ? null : str(o.produto);
    if (produto !== null && !PRODUCT_KEY_RE.test(produto)) return null;
    return produto ? { acao: "acesso", pedido: pedido, produto: produto } : { acao: "acesso", pedido: pedido };
  }
  if (acao === "simular") {
    const resultado = o.resultado;
    if (resultado !== "pago" && resultado !== "recusado" && resultado !== "expirado") return null;
    return { acao: "simular", pedido: pedido, resultado: resultado };
  }
  return null;
}

/** Corpo de erro + status HTTP (para quem responde o endpoint). */
export function paymentError(erro: PaymentErrorCode): { status: number; body: PaymentErrorResponse } {
  return { status: PAYMENT_ERROR_STATUS[erro], body: { ok: false, erro: erro } };
}

/** Lê o PaymentPageConfig embutido (null = ausente ou em formato inválido). Para o script das páginas. */
export function readPaymentConfig(text: string | null | undefined): PaymentPageConfig | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const c = raw as PaymentPageConfig;
  if (c.v !== PAYMENT_CONFIG_VERSION || typeof c.endpoint !== "string" || !c.produtos) return null;
  if (typeof c.produtos !== "object") return null;
  return c;
}
