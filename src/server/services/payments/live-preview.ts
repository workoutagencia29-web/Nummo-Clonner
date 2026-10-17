/**
 * Pagamento REAL na PRÉVIA do app (POST /__os/pagamento), para você testar
 * antes de subir o ZIP na hospedagem. Vale só quando a oferta tem a chave do
 * gateway salva; sem chave, a prévia simula (./simulation.ts). O despachante
 * `handlePreviewPayment` (usado pelo src/preview/server.ts) escolhe:
 *
 * - "checkout_criar": o gateway é o do produto (FlevoPay, BlackCat ou Kyvo).
 *   Com a chave salva → cobra de verdade (createCharge); senão → simulação.
 * - "criar" (pagamento na página): o gateway é a Kyvo. Com a chave salva →
 *   cobra de verdade; senão → simulação.
 * - "checkout_status" / "status" / "acesso": se o pedido é de uma cobrança
 *   REAL desta prévia (está na memória daqui), confere na API do gateway;
 *   senão, vai para a simulação.
 * - "simular": só existe na simulação.
 *
 * Segurança (as mesmas regras da simulação e do pagamento.php):
 * - o total sai SEMPRE dos preços salvos (checkCheckoutOrder/checkoutTotal); o
 *   navegador só manda ids;
 * - a credencial pública `pedido` do checkout é um id NOSSO e aleatório
 *   ("lv_…", CHECKOUT_ORDER_RE), nunca o id sequencial da cobrança no gateway;
 *   na janela de pagamento (Kyvo), o `pedido` é o id da cobrança (tx_…, não
 *   sequencial), como no pagamento.php;
 * - o status de "pago" só vale confirmado pela API do gateway (getTransaction),
 *   conferindo que a cobrança é a do pedido (pedidoExterno e valor);
 * - a chave da API é lida do banco a cada uso e nunca sai daqui.
 *
 * Criar um PIX/SPEI não move dinheiro: é uma cobrança pendente. Só sai dinheiro
 * quando você paga de verdade (um valor baixo, para testar). As cobranças
 * ficam na memória do processo da prévia e somem ao fechar o Offer Studio.
 */
import { randomBytes } from "node:crypto";
import {
  type CheckoutCreateResponse,
  type CheckoutCurrency,
  type CheckoutExtraAccess,
  type CheckoutPayMethod,
  type CheckoutStatusResponse,
  checkoutAddressMeta,
  isCheckoutOrderId,
  type PixInstructions,
  parseCheckoutRequest,
} from "@/lib/checkout/contract";
import { onlyDigits } from "@/lib/checkout/fields";
import { checkCheckoutOrder } from "@/lib/checkout/orders";
import { isPixProvider } from "@/lib/checkout/rules";
import { checkoutLang } from "@/lib/checkout/texts";
import {
  type CardInstructions,
  type PayCurrency,
  type PaymentCreateResponse,
  type PaymentErrorCode,
  type PaymentStatusResponse,
  type PayStatus,
  parsePaymentRequest,
  paymentError,
  type SpeiInstructions,
} from "@/lib/payments/contract";
import { type Charge, type ChargeInput, type ChargeItem, PaymentGatewayError } from "@/lib/payments/gateway";
import { newExternalOrderId, orderIsForProduct } from "@/lib/payments/orders";
import type { PaymentProviderId } from "@/lib/payments/rules";
import { methodAllows } from "@/lib/payments/rules";
import { offerCheckoutProducts, type ServerCheckoutProduct } from "../checkout/products";
import { gatewayAdapter, hasGatewayKey, paymentGatewayKey } from "./gateways";
import { isObj } from "./http";
import { offerPaymentProducts, payMethodOf } from "./products";
import { handleSimulatedPayment, type SimAccessResponse, type SimResult } from "./simulation";

/** Cobrança REAL aberta nesta prévia (sem dados pessoais). */
interface LiveOrder {
  /** Credencial pública: checkout "lv_…" (nossa); janela = id da cobrança no gateway. */
  pedido: string;
  /** Id da cobrança no gateway (para consultar o status). */
  gid: string;
  offerId: string;
  provider: PaymentProviderId;
  productKey: string;
  linkId: string;
  externalOrderId: string;
  method: CheckoutPayMethod;
  status: PayStatus;
  amountCents: number;
  currency: CheckoutCurrency;
  createdAt: number;
  /** Pedido da página de checkout (com os bumps comprados); ausente = pagamento na página. */
  checkout?: { bumps: string[] };
}

const MAX_ORDERS = 1000;
/** Cobranças reais por oferta a cada 10 minutos (o mesmo teto da simulação). */
export const LIVE_CREATE_LIMIT = 60;
const WINDOW_MS = 10 * 60_000;

const orders = new Map<string, LiveOrder>();
const creations = new Map<string, number[]>();

/** Só para os testes. */
export function resetLivePreview() {
  orders.clear();
  creations.clear();
}

/** O pedido é de uma cobrança REAL aberta nesta prévia? (o despachante usa para rotear status/acesso) */
export function hasLiveOrder(pedido: string): boolean {
  return orders.has(pedido);
}

function remember(order: LiveOrder) {
  orders.set(order.pedido, order);
  if (orders.size > MAX_ORDERS) {
    const oldest = orders.keys().next().value;
    if (oldest) orders.delete(oldest);
  }
}

function rateLimited(offerId: string, now: number) {
  const recent = (creations.get(offerId) ?? []).filter((t) => now - t < WINDOW_MS);
  creations.set(offerId, recent);
  if (recent.length >= LIVE_CREATE_LIMIT) return true;
  recent.push(now);
  return false;
}

const fail = (code: PaymentErrorCode) => paymentError(code);

/** Erro do gateway → código do contrato (o que a página mostra). */
function gatewayErrorCode(err: unknown): PaymentErrorCode {
  if (err instanceof PaymentGatewayError) {
    switch (err.code) {
      case "declined":
        return "recusado";
      case "invalid_key":
      case "missing_scope":
      case "invalid_request":
        // Chave ausente/errada ou pedido recusado pelo gateway: "configuração" ajuda você a arrumar a chave.
        return "configuracao";
      default:
        // unavailable, network, conflict, not_found, unexpected: a página tenta de novo.
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

/** Campos de instruções da resposta (só um deles, conforme a forma). */
type InstructionsBody = { pix?: PixInstructions; spei?: SpeiInstructions; cartao?: CardInstructions };

/** Instruções da cobrança → campos da resposta (PIX / SPEI / cartão). */
function instructionsBody(charge: Charge): InstructionsBody {
  const i = charge.instructions;
  if (i.kind === "pix") {
    return { pix: { codigo: i.copyPaste, imagem: i.qrImage, expiraEm: i.expiresAt } };
  }
  if (i.kind === "spei") {
    return {
      spei: {
        clabe: i.clabe,
        banco: i.bank,
        titular: i.holder,
        referencia: i.reference,
        expiraEm: i.expiresAt,
      },
    };
  }
  return { cartao: { sdkUrl: i.sdkUrl, sessao: i.session, expiraEm: i.expiresAt } };
}

// ─── Checkout do Offer Studio ────────────────────────────────────────────────

function checkoutChargeInput(
  product: ServerCheckoutProduct,
  check: Extract<ReturnType<typeof checkCheckoutOrder>, { ok: true }>,
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
        // Gateway de PIX (Brasil) quer o CEP só com dígitos; a Kyvo ignora o endereço aqui.
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

async function liveCheckoutCreate(offerId: string, raw: unknown, now: number): Promise<SimResult> {
  const req = parseCheckoutRequest(raw);
  if (!req || req.acao !== "checkout_criar") return fail("invalido");
  const product = (await offerCheckoutProducts(offerId)).find((p) => p.key === req.checkout);
  if (!product) return fail("produto_desconhecido");
  const check = checkCheckoutOrder(req, product);
  if (!check.ok) return fail(check.erro);
  if (rateLimited(offerId, now)) return fail("limite");
  const key = await paymentGatewayKey(offerId, product.provider);
  // A prévia é para VOCÊ testar: basta a chave do gateway para gerar o PIX de verdade, mesmo sem
  // ter terminado de configurar (ex.: o link de acesso). O link de acesso só é cobrado na hora de
  // liberar o produto (o "acesso", depois do pagamento). O pagamento.php do ZIP é mais rígido (sem
  // link de acesso não cobra), porque lá quem paga é o cliente de verdade.
  if (!key) return fail("configuracao");
  const input = checkoutChargeInput(product, check, req.metodo);
  input.metadata = cleanMeta(req.metadata);
  // A Kyvo não tem campo de endereço: o endereço de entrega vai como metadata
  // (os gateways de PIX já o recebem no campo próprio — ver checkoutChargeInput).
  if (product.provider === "KYVO" && check.buyer.endereco) {
    input.metadata = { ...(input.metadata ?? {}), ...checkoutAddressMeta(check.buyer.endereco) };
  }
  let charge: Charge;
  try {
    charge = await gatewayAdapter(product.provider).createCharge(key, input);
  } catch (err) {
    return fail(gatewayErrorCode(err));
  }
  const pedido = `lv_${randomBytes(10).toString("hex")}`;
  const order: LiveOrder = {
    pedido,
    gid: charge.id,
    offerId,
    provider: product.provider,
    productKey: product.key,
    linkId: product.linkId,
    externalOrderId: input.externalOrderId,
    method: req.metodo,
    status: charge.status,
    amountCents: check.total.total,
    currency: product.currency,
    createdAt: now,
    checkout: { bumps: check.total.bumps },
  };
  remember(order);
  const body: CheckoutCreateResponse = {
    ok: true,
    pedido,
    pedidoExterno: input.externalOrderId,
    status: charge.status,
    valor: order.amountCents,
    moeda: product.currency,
    metodo: req.metodo,
    agora: now,
    ...instructionsBody(charge),
  };
  return { status: 201, body };
}

/** Status de uma cobrança REAL consultado na API do gateway (confere que é a do pedido). */
async function liveStatus(order: LiveOrder): Promise<PayStatus | PaymentErrorCode> {
  let key: string | null;
  try {
    key = await paymentGatewayKey(order.offerId, order.provider);
  } catch {
    return "configuracao";
  }
  if (!key) return "configuracao";
  try {
    const tx = await gatewayAdapter(order.provider).getTransaction(key, order.gid);
    // A resposta precisa ser da cobrança do pedido (pedidoExterno e valor quando vêm).
    if (tx.externalOrderId && tx.externalOrderId !== order.externalOrderId) return "indisponivel";
    if (tx.amountCents && tx.amountCents !== order.amountCents) return "indisponivel";
    // Não rebaixa um pedido já confirmado pago (consistência eventual do gateway), como o pagamento.php.
    if (order.status === "paid" && tx.status === "pending") return "paid";
    order.status = tx.status;
    return tx.status;
  } catch (err) {
    return gatewayErrorCode(err);
  }
}

function checkoutStatusBody(order: LiveOrder, now: number): CheckoutStatusResponse {
  return {
    ok: true,
    pedido: order.pedido,
    status: order.status,
    pago: order.status === "paid",
    pedidoExterno: order.externalOrderId,
    valor: order.amountCents,
    moeda: order.currency,
    agora: now,
  };
}

async function liveCheckoutStatus(order: LiveOrder, checkout: string, now: number): Promise<SimResult> {
  if (!order.checkout || order.productKey !== checkout) return fail("nao_encontrado");
  const r = await liveStatus(order);
  if (!isPayStatus(r)) return fail(r);
  return { status: 200, body: checkoutStatusBody(order, now) };
}

const PAY_STATUS_SET = new Set<PayStatus>(["pending", "paid", "expired", "failed", "canceled", "refunded", "disputed"]);
function isPayStatus(v: string): v is PayStatus {
  return PAY_STATUS_SET.has(v as PayStatus);
}

async function checkoutAccess(order: LiveOrder): Promise<SimResult> {
  const product = (await offerCheckoutProducts(order.offerId)).find((p) =>
    orderIsForProduct(order.externalOrderId, p.key, p.linkId),
  );
  if (!product) return fail("nao_encontrado");
  if (!product.accessUrl) return fail("configuracao");
  const bought = order.checkout?.bumps ?? [];
  const extras: CheckoutExtraAccess[] = product.config.bumps
    .filter((b) => bought.includes(b.id) && b.accessUrl)
    .map((b) => ({ titulo: b.title, acesso: b.accessUrl }));
  return {
    status: 200,
    body: {
      ok: true,
      pedido: order.pedido,
      status: "paid",
      acesso: product.accessUrl,
      produto: product.key,
      extras,
      idioma: checkoutLang(product.locale),
    } satisfies SimAccessResponse,
  };
}

// ─── Pagamento na página (janela, Kyvo) ──────────────────────────────────────

async function liveWindowCreate(offerId: string, raw: unknown, now: number): Promise<SimResult> {
  const req = parsePaymentRequest(raw);
  if (!req || req.acao !== "criar") return fail("invalido");
  const product = (await offerPaymentProducts(offerId)).find((p) => p.key === req.produto);
  if (!product) return fail("produto_desconhecido");
  const allowed = product.methods.filter((m) => methodAllows(m, product.currency)).map(payMethodOf);
  if (!allowed.includes(req.metodo)) return fail("metodo_indisponivel");
  if (rateLimited(offerId, now)) return fail("limite");
  const key = await paymentGatewayKey(offerId, "KYVO");
  // A prévia é para testar: basta a chave do gateway (o link de acesso só é cobrado no "acesso").
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
    charge = await gatewayAdapter("KYVO").createCharge(key, input);
  } catch (err) {
    return fail(gatewayErrorCode(err));
  }
  const order: LiveOrder = {
    pedido: charge.id,
    gid: charge.id,
    offerId,
    provider: "KYVO",
    productKey: product.key,
    linkId: product.linkId,
    externalOrderId: external,
    method: req.metodo,
    status: charge.status,
    amountCents: product.amountCents,
    currency: product.currency,
    createdAt: now,
  };
  remember(order);
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

async function liveWindowStatus(order: LiveOrder, produto: string): Promise<SimResult> {
  if (order.checkout || order.productKey !== produto) return fail("nao_encontrado");
  const r = await liveStatus(order);
  if (!isPayStatus(r)) return fail(r);
  const body: PaymentStatusResponse = {
    ok: true,
    pedido: order.pedido,
    status: order.status,
    pago: order.status === "paid",
    pedidoExterno: order.externalOrderId,
    valor: order.amountCents,
    moeda: order.currency as PayCurrency,
  };
  return { status: 200, body };
}

async function windowAccess(order: LiveOrder): Promise<SimResult> {
  const product = (await offerPaymentProducts(order.offerId)).find((p) =>
    orderIsForProduct(order.externalOrderId, p.key, p.linkId),
  );
  if (!product) return fail("nao_encontrado");
  if (!product.accessUrl) return fail("configuracao");
  return {
    status: 200,
    body: { ok: true, pedido: order.pedido, status: "paid", acesso: product.accessUrl, produto: product.key },
  };
}

/** Acesso de um pedido REAL pago (confere o pago na API antes de entregar o link). */
async function liveAccess(order: LiveOrder, produto: string | null): Promise<SimResult> {
  // Checkout: a credencial é o id secreto (nunca um número de cobrança).
  if (order.checkout && !isCheckoutOrderId(order.pedido)) return fail("nao_encontrado");
  if (!order.checkout && produto && produto !== order.productKey) return fail("nao_encontrado");
  // Confirma o pago na API (o status guardado só vira "paid" conferido pelo gateway).
  if (order.status !== "paid") {
    const r = await liveStatus(order);
    if (!isPayStatus(r)) return fail(r);
  }
  if (order.status === "pending") return fail("pendente");
  if (order.status !== "paid") return fail("nao_pago");
  return order.checkout ? checkoutAccess(order) : windowAccess(order);
}

// ─── Entrada ─────────────────────────────────────────────────────────────────

/** Trata um pedido REAL da prévia (o despachante já confirmou que é para cobrar de verdade). */
export async function handleLivePayment(offerId: string, raw: unknown, now = Date.now()): Promise<SimResult> {
  const acao = isObj(raw) ? raw.acao : null;
  if (acao === "checkout_criar") return liveCheckoutCreate(offerId, raw, now);
  if (acao === "criar") return liveWindowCreate(offerId, raw, now);

  const pedido = isObj(raw) && typeof raw.pedido === "string" ? raw.pedido : null;
  const order = pedido ? orders.get(pedido) : null;
  if (!order || order.offerId !== offerId) return fail("nao_encontrado");

  if (acao === "checkout_status") {
    const checkout = isObj(raw) && typeof raw.checkout === "string" ? raw.checkout : "";
    return liveCheckoutStatus(order, checkout, now);
  }
  if (acao === "status") {
    const produto = isObj(raw) && typeof raw.produto === "string" ? raw.produto : "";
    return liveWindowStatus(order, produto);
  }
  if (acao === "acesso") {
    const produto = isObj(raw) && typeof raw.produto === "string" && raw.produto ? raw.produto : null;
    return liveAccess(order, produto);
  }
  return fail("invalido");
}

/** Gateway de um "checkout_criar" (null = produto desconhecido). */
async function checkoutProvider(offerId: string, raw: unknown): Promise<PaymentProviderId | null> {
  const req = parseCheckoutRequest(raw);
  if (!req || req.acao !== "checkout_criar") return null;
  const product = (await offerCheckoutProducts(offerId)).find((p) => p.key === req.checkout);
  return product?.provider ?? null;
}

/**
 * Pagamento da prévia: cobra de verdade quando a oferta tem a chave do gateway
 * salva; senão, simula. É o que o src/preview/server.ts chama.
 */
export async function handlePreviewPayment(offerId: string, raw: unknown, now = Date.now()): Promise<SimResult> {
  const acao = isObj(raw) ? raw.acao : null;
  const pedido = isObj(raw) && typeof raw.pedido === "string" ? raw.pedido : null;

  // Consultas de um pedido já aberto: se é de uma cobrança real desta prévia, confere no gateway.
  if (acao === "checkout_status" || acao === "status" || acao === "acesso") {
    if (pedido && hasLiveOrder(pedido)) return handleLivePayment(offerId, raw, now);
    return handleSimulatedPayment(offerId, raw, now);
  }
  // "simular" só existe na simulação.
  if (acao === "simular") return handleSimulatedPayment(offerId, raw, now);

  // Criação: cobra de verdade com a chave do gateway do produto.
  if (acao === "checkout_criar") {
    const provider = await checkoutProvider(offerId, raw);
    if (provider && (await hasGatewayKey(offerId, provider))) return handleLivePayment(offerId, raw, now);
    return handleSimulatedPayment(offerId, raw, now);
  }
  if (acao === "criar") {
    if (await hasGatewayKey(offerId, "KYVO")) return handleLivePayment(offerId, raw, now);
    return handleSimulatedPayment(offerId, raw, now);
  }
  return handleSimulatedPayment(offerId, raw, now);
}
