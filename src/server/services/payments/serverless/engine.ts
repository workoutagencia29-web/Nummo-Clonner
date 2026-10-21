/**
 * Motor da função serverless (Vercel/Netlify) — faz o que o pagamento.php faz,
 * em Node, reaproveitando os MESMOS adaptadores de gateway e o MESMO contrato
 * (parseCheckoutRequest/checkCheckoutOrder/checkoutTotal/parsePaymentRequest).
 * É quase o live-preview.ts, mas:
 *  - o mapa de pedidos em memória vira o TOKEN lacrado (./token): nada de banco
 *    nem de arquivo (o disco da função é efêmero);
 *  - a config do produto vem embutida (ServerlessConfig, ./config), não do banco;
 *  - a chave do gateway vem do AMBIENTE (deps.key), nunca de arquivo;
 *  - não existe simulação: no ZIP publicado quem paga é o cliente de verdade.
 *
 * Segurança (as mesmas regras do pagamento.php):
 *  - o valor sai SEMPRE da config embutida (checkoutTotal); o navegador só manda ids;
 *  - a credencial do checkout é o token lacrado (nunca o id sequencial do gateway);
 *    o pagamento na página mantém o id da cobrança da Kyvo (tx_…, não sequencial);
 *  - "pago" só vale confirmado na API do gateway, conferindo id, pedidoExterno e valor;
 *  - sem OS_PAY_SECRET forte não lacra nem abre → recusa ("configuracao", falha fechada);
 *  - o link de acesso é OPCIONAL para cobrar (venda high-ticket): só o "acesso" precisa dele.
 *
 * As defesas de borda (mesma origem, tamanho do corpo, cabeçalhos no-store) e o
 * limite por IP ficam na casca de cada plataforma (../serverless/*), não aqui.
 */

import type {
  CheckoutCreateResponse,
  CheckoutExtraAccess,
  CheckoutPayMethod,
  CheckoutStatusResponse,
  PixInstructions,
} from "@/lib/checkout/contract";
import { checkoutAddressMeta, parseCheckoutRequest } from "@/lib/checkout/contract";
import { onlyDigits } from "@/lib/checkout/fields";
import { type CheckoutOrderCheck, checkCheckoutOrder } from "@/lib/checkout/orders";
import { isPixProvider } from "@/lib/checkout/rules";
import { checkoutLang } from "@/lib/checkout/texts";
import type {
  CardInstructions,
  PayCurrency,
  PaymentAccessResponse,
  PaymentCreateResponse,
  PaymentErrorCode,
  PaymentStatusResponse,
  PayStatus,
  SpeiInstructions,
} from "@/lib/payments/contract";
import { parsePaymentRequest, paymentError } from "@/lib/payments/contract";
import type { Charge, ChargeInput, ChargeItem, PaymentGatewayAdapter, TransactionInfo } from "@/lib/payments/gateway";
import { PaymentGatewayError } from "@/lib/payments/gateway";
import { newExternalOrderId, orderIsForProduct } from "@/lib/payments/orders";
import { methodAllows, type PaymentMethodId } from "@/lib/payments/rules";
import { blackcatGateway } from "../blackcat";
import { clownpayGateway } from "../clownpay";
import { flevopayGateway } from "../flevopay";
import { isObj } from "../http";
import { kyvoGateway } from "../kyvo";
import { pagpixhubGateway } from "../pagpixhub";
import type {
  ServerlessCheckoutProduct,
  ServerlessConfig,
  ServerlessPaymentProduct,
  ServerlessProvider,
} from "./config";
import { type CheckoutToken, isCheckoutToken, openCheckoutToken, sealCheckoutToken } from "./token";

/** 180 dias: janela em que a credencial do checkout ainda libera o acesso (limita repetição de token vazado). */
const ACCESS_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

/** Dependências do motor (a casca da plataforma injeta ambiente e hora). */
export interface ServerlessDeps {
  config: ServerlessConfig;
  /** Chave do gateway (do ambiente) ou null = não configurada → "configuracao". */
  key(provider: ServerlessProvider): string | null;
  /** Segredo que lacra os pedidos (>= 32 bytes) ou null = falha fechada. */
  secret: Buffer | null;
  /** Hora do servidor (ms). */
  now(): number;
  /** Guarda de criação por IP (true = passou do limite → "limite"). Opcional. */
  rateLimited?(): boolean;
}

export interface ServerlessResult {
  status: number;
  body: unknown;
}

const ADAPTERS: Record<ServerlessProvider, PaymentGatewayAdapter> = {
  FLEVOPAY: flevopayGateway,
  BLACKCAT: blackcatGateway,
  CLOWNPAY: clownpayGateway,
  PAGPIXHUB: pagpixhubGateway,
  KYVO: kyvoGateway,
};

const METHOD_OF: Record<PaymentMethodId, CheckoutPayMethod> = {
  SPEI: "spei",
  CARD: "card",
  BIZUM: "bizum",
  MB_WAY: "mb_way",
};

const PAY_STATUS_SET = new Set<PayStatus>(["pending", "paid", "expired", "failed", "canceled", "refunded", "disputed"]);
function isPayStatus(v: string): v is PayStatus {
  return PAY_STATUS_SET.has(v as PayStatus);
}

const fail = (code: PaymentErrorCode): ServerlessResult => paymentError(code);

/** Erro do gateway → código do contrato (o mesmo mapeamento do live-preview/pagamento.php). */
function gatewayErrorCode(err: unknown): PaymentErrorCode {
  if (err instanceof PaymentGatewayError) {
    switch (err.code) {
      case "declined":
        return "recusado";
      case "invalid_key":
      case "missing_scope":
      case "invalid_request":
        return "configuracao";
      default:
        return "indisponivel";
    }
  }
  return "indisponivel";
}

function cleanMeta(meta: Partial<Record<string, string>> | undefined): Record<string, string> | undefined {
  if (!meta) return undefined;
  const out: Record<string, string> = {};
  for (const k of Object.keys(meta)) {
    const v = meta[k];
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

type InstructionsBody = { pix?: PixInstructions; spei?: SpeiInstructions; cartao?: CardInstructions };

/** Instruções da cobrança → campos da resposta (PIX / SPEI / cartão). */
function instructionsBody(charge: Charge): InstructionsBody {
  const i = charge.instructions;
  if (i.kind === "pix") return { pix: { codigo: i.copyPaste, imagem: i.qrImage, expiraEm: i.expiresAt } };
  if (i.kind === "spei") {
    return {
      spei: { clabe: i.clabe, banco: i.bank, titular: i.holder, referencia: i.reference, expiraEm: i.expiresAt },
    };
  }
  return { cartao: { sdkUrl: i.sdkUrl, sessao: i.session, expiraEm: i.expiresAt } };
}

function chargeExpiry(charge: Charge): string | null {
  return charge.instructions.expiresAt ?? null;
}

// ─── Checkout do Offer Studio ────────────────────────────────────────────────

function checkoutChargeInput(
  product: ServerlessCheckoutProduct,
  check: Extract<CheckoutOrderCheck, { ok: true }>,
  method: CheckoutPayMethod,
): ChargeInput {
  const buyer = check.buyer;
  const total = check.total;
  const tangible = !!buyer.endereco;
  const items: ChargeItem[] = [
    { title: product.name, unitPriceCents: product.amountCents, quantity: total.quantidade, tangible },
  ];
  for (const id of total.bumps) {
    const b = product.config.bumps.find((x) => x.id === id);
    if (b) items.push({ title: b.title, unitPriceCents: b.priceCents, quantity: 1, tangible: false });
  }
  if (total.frete && total.valorFrete > 0) {
    const s = product.config.shipping.find((x) => x.id === total.frete);
    items.push({
      title: `Frete ${s?.name ?? ""}`.trim(),
      unitPriceCents: total.valorFrete,
      quantity: 1,
      tangible: false,
    });
  }
  const address = buyer.endereco
    ? {
        zipCode: isPixProvider(product.provider) ? onlyDigits(buyer.endereco.cep) : buyer.endereco.cep,
        street: buyer.endereco.rua,
        number: buyer.endereco.numero,
        complement: buyer.endereco.complemento,
        neighborhood: buyer.endereco.bairro,
        city: buyer.endereco.cidade,
        state: buyer.endereco.uf,
      }
    : undefined;
  return {
    method,
    amountCents: total.total,
    currency: product.currency,
    customer: {
      name: buyer.nome,
      email: buyer.email,
      document: buyer.documento ?? undefined,
      phone: buyer.telefone ?? undefined,
      address,
    },
    description: product.name,
    items,
    externalOrderId: newExternalOrderId(product.key, product.linkId),
    metadata: undefined,
  };
}

async function createCheckout(deps: ServerlessDeps, raw: unknown): Promise<ServerlessResult> {
  const req = parseCheckoutRequest(raw);
  if (!req || req.acao !== "checkout_criar") return fail("invalido");
  const product = deps.config.checkouts.find((p) => p.key === req.checkout);
  if (!product) return fail("produto_desconhecido");
  const check = checkCheckoutOrder(req, product);
  if (!check.ok) return fail(check.erro);
  // Sem segredo não dá para lacrar o pedido: recusa (falha fechada), como o pagamento.php sem pasta gravável.
  if (!deps.secret) return fail("configuracao");
  if (deps.rateLimited?.()) return fail("limite");
  const key = deps.key(product.provider);
  if (!key) return fail("configuracao");
  const input = checkoutChargeInput(product, check, req.metodo);
  input.metadata = cleanMeta(req.metadata);
  if (product.provider === "KYVO" && check.buyer.endereco) {
    input.metadata = { ...(input.metadata ?? {}), ...checkoutAddressMeta(check.buyer.endereco) };
  }
  let charge: Charge;
  try {
    charge = await ADAPTERS[product.provider].createCharge(key, input);
  } catch (err) {
    return fail(gatewayErrorCode(err));
  }
  const now = deps.now();
  const token: CheckoutToken = {
    g: product.provider,
    i: charge.id,
    x: input.externalOrderId,
    v: check.total.total,
    m: product.currency,
    t: req.metodo,
    e: chargeExpiry(charge),
    a: now + ACCESS_WINDOW_MS,
    b: check.total.bumps,
  };
  const body: CheckoutCreateResponse = {
    ok: true,
    pedido: sealCheckoutToken(deps.secret, token),
    pedidoExterno: input.externalOrderId,
    status: charge.status,
    valor: check.total.total,
    moeda: product.currency,
    metodo: req.metodo,
    agora: now,
    ...instructionsBody(charge),
  };
  return { status: 201, body };
}

/** Status de uma cobrança na API do gateway, conferindo que é a do token (id, pedidoExterno e valor). */
async function tokenStatus(deps: ServerlessDeps, tok: CheckoutToken): Promise<PayStatus | PaymentErrorCode> {
  const key = deps.key(tok.g);
  if (!key) return "configuracao";
  try {
    const tx = await ADAPTERS[tok.g].getTransaction(key, tok.i);
    if (tx.id && tx.id !== tok.i) return "indisponivel";
    if (tx.externalOrderId && tx.externalOrderId !== tok.x) return "indisponivel";
    if (tx.amountCents && tx.amountCents !== tok.v) return "indisponivel";
    let status = tx.status;
    // PIX/SPEI falho ou cancelado depois de vencer vira "expirado" (como o pagamento.php).
    if (
      (tok.t === "pix" || tok.t === "spei") &&
      (status === "failed" || status === "canceled") &&
      tok.e &&
      deps.now() > Date.parse(tok.e)
    ) {
      status = "expired";
    }
    return status;
  } catch (err) {
    return gatewayErrorCode(err);
  }
}

async function checkoutStatus(deps: ServerlessDeps, raw: unknown): Promise<ServerlessResult> {
  const req = parseCheckoutRequest(raw);
  if (!req || req.acao !== "checkout_status") return fail("invalido");
  if (!deps.secret) return fail("configuracao");
  const tok = openCheckoutToken(deps.secret, req.pedido);
  if (!tok) return fail("nao_encontrado");
  const r = await tokenStatus(deps, tok);
  if (!isPayStatus(r)) return fail(r);
  const body: CheckoutStatusResponse = {
    ok: true,
    pedido: req.pedido,
    status: r,
    pago: r === "paid",
    pedidoExterno: tok.x,
    valor: tok.v,
    moeda: tok.m,
    agora: deps.now(),
  };
  return { status: 200, body };
}

async function checkoutAccess(deps: ServerlessDeps, pedido: string): Promise<ServerlessResult> {
  if (!deps.secret) return fail("configuracao");
  const tok = openCheckoutToken(deps.secret, pedido);
  if (!tok) return fail("nao_encontrado");
  if (deps.now() > tok.a) return fail("nao_encontrado");
  // Acha o produto pela config embutida, casando o código do pedidoExterno (rebind: produto trocado some).
  const product = deps.config.checkouts.find((p) => orderIsForProduct(tok.x, p.key, p.linkId));
  if (!product) return fail("nao_encontrado");
  const r = await tokenStatus(deps, tok);
  if (!isPayStatus(r)) return fail(r);
  if (r === "pending") return fail("pendente");
  if (r !== "paid") return fail("nao_pago");
  if (!product.accessUrl) return fail("configuracao");
  const extras: CheckoutExtraAccess[] = product.config.bumps
    .filter((b) => tok.b.includes(b.id) && b.accessUrl)
    .map((b) => ({ titulo: b.title, acesso: b.accessUrl }));
  const body = {
    ok: true as const,
    pedido,
    status: "paid" as const,
    acesso: product.accessUrl,
    produto: product.key,
    extras,
    idioma: checkoutLang(product.locale),
  };
  return { status: 200, body };
}

// ─── Pagamento na página (janela, Kyvo) ──────────────────────────────────────

async function createWindow(deps: ServerlessDeps, raw: unknown): Promise<ServerlessResult> {
  const req = parsePaymentRequest(raw);
  if (!req || req.acao !== "criar") return fail("invalido");
  const product = deps.config.payments.find((p) => p.key === req.produto);
  if (!product) return fail("produto_desconhecido");
  const allowed = product.methods.filter((m) => methodAllows(m, product.currency)).map((m) => METHOD_OF[m]);
  if (!allowed.includes(req.metodo)) return fail("metodo_indisponivel");
  if (deps.rateLimited?.()) return fail("limite");
  const key = deps.key("KYVO");
  if (!key) return fail("configuracao");
  const external = newExternalOrderId(product.key, product.linkId);
  const input: ChargeInput = {
    method: req.metodo,
    amountCents: product.amountCents,
    currency: product.currency as PayCurrency,
    customer: { name: req.nome, email: req.email, document: req.documento ?? undefined },
    description: product.name,
    externalOrderId: external,
    metadata: cleanMeta(req.metadata),
  };
  let charge: Charge;
  try {
    charge = await kyvoGateway.createCharge(key, input);
  } catch (err) {
    return fail(gatewayErrorCode(err));
  }
  const body: PaymentCreateResponse = {
    ok: true,
    pedido: charge.id,
    pedidoExterno: external,
    status: charge.status,
    valor: product.amountCents,
    moeda: product.currency as PayCurrency,
    metodo: req.metodo,
    ...instructionsBody(charge),
  };
  return { status: 201, body };
}

/** Consulta a cobrança da janela na Kyvo (null → código de erro). */
async function windowTx(deps: ServerlessDeps, pedido: string): Promise<TransactionInfo | PaymentErrorCode> {
  const key = deps.key("KYVO");
  if (!key) return "configuracao";
  try {
    return await kyvoGateway.getTransaction(key, pedido);
  } catch (err) {
    return gatewayErrorCode(err);
  }
}

/** O pedido (da janela) é deste produto e bate o valor? */
function windowMatches(tx: TransactionInfo, product: ServerlessPaymentProduct): boolean {
  if (!orderIsForProduct(tx.externalOrderId, product.key, product.linkId)) return false;
  if (tx.amountCents && tx.amountCents !== product.amountCents) return false;
  return true;
}

async function windowStatus(deps: ServerlessDeps, raw: unknown): Promise<ServerlessResult> {
  const req = parsePaymentRequest(raw);
  if (!req || req.acao !== "status") return fail("invalido");
  const product = deps.config.payments.find((p) => p.key === req.produto);
  if (!product) return fail("nao_encontrado");
  const tx = await windowTx(deps, req.pedido);
  if (typeof tx === "string") return fail(tx);
  if (!windowMatches(tx, product)) return fail("indisponivel");
  const body: PaymentStatusResponse = {
    ok: true,
    pedido: req.pedido,
    status: tx.status,
    pago: tx.status === "paid",
    pedidoExterno: tx.externalOrderId ?? "",
    valor: product.amountCents,
    moeda: product.currency as PayCurrency,
  };
  return { status: 200, body };
}

async function windowAccess(deps: ServerlessDeps, pedido: string, produto: string | null): Promise<ServerlessResult> {
  const tx = await windowTx(deps, pedido);
  if (typeof tx === "string") return fail(tx);
  const product = deps.config.payments.find((p) => orderIsForProduct(tx.externalOrderId, p.key, p.linkId));
  if (!product) return fail("nao_encontrado");
  if (produto && produto !== product.key) return fail("nao_encontrado");
  if (tx.status === "pending") return fail("pendente");
  if (tx.status !== "paid") return fail("nao_pago");
  if (!product.accessUrl) return fail("configuracao");
  const body: PaymentAccessResponse = {
    ok: true,
    pedido,
    status: "paid",
    acesso: product.accessUrl,
    produto: product.key,
  };
  return { status: 200, body };
}

// ─── Acesso (ação compartilhada: checkout × janela pelo prefixo ck_) ──────────

async function access(deps: ServerlessDeps, raw: unknown): Promise<ServerlessResult> {
  // "acesso" é ação do contrato do pagamento na página (o bloco "Acesso ao produto"
  // o usa nos dois casos): o parser valida o formato do pedido (ORDER_ID_RE, que
  // agora aceita o token longo). O prefixo ck_ separa checkout × janela.
  const req = parsePaymentRequest(raw);
  if (!req || req.acao !== "acesso") return fail("invalido");
  if (isCheckoutToken(req.pedido)) return checkoutAccess(deps, req.pedido);
  return windowAccess(deps, req.pedido, req.produto ?? null);
}

// ─── Entrada ─────────────────────────────────────────────────────────────────

/**
 * Trata um pedido ao endpoint da função serverless (o corpo JSON já parseado;
 * as defesas de borda ficam na casca da plataforma). Sempre devolve
 * { status, body } com o JSON que a página espera.
 */
export async function handleServerlessPayment(raw: unknown, deps: ServerlessDeps): Promise<ServerlessResult> {
  const acao = isObj(raw) ? raw.acao : null;
  if (acao === "checkout_criar") return createCheckout(deps, raw);
  if (acao === "criar") return createWindow(deps, raw);
  if (acao === "checkout_status") return checkoutStatus(deps, raw);
  if (acao === "status") return windowStatus(deps, raw);
  if (acao === "acesso") return access(deps, raw);
  // "simular" (prévia) e qualquer outra coisa não existem na função publicada.
  return fail("invalido");
}
