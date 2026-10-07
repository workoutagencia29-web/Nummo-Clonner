/**
 * Camada genérica de gateway de pagamento: o que o Offer Studio precisa de
 * qualquer gateway (Kyvo hoje; FlevoPay/PIX e outros depois). Cada gateway é
 * um adaptador em src/server/services/payments/<gateway>.ts que implementa
 * PaymentGatewayAdapter; telas, prévia e ZIP só conhecem estes tipos.
 */
import type { PayCurrency, PayMethod, PayStatus } from "./contract";
import type { PaymentProviderId } from "./rules";

export interface ChargeCustomer {
  name: string;
  email: string;
  /** Documento (RFC/CURP no México, NIF na Espanha…), opcional. */
  document?: string;
}

/** Pedido de cobrança. Valor e moeda vêm SEMPRE do produto salvo no servidor. */
export interface ChargeInput {
  method: PayMethod;
  amountCents: number;
  currency: PayCurrency;
  customer: ChargeCustomer;
  /** Gerado no servidor (newExternalOrderId); também é a Idempotency-Key. */
  externalOrderId: string;
  /** Página onde a compra começou (opcional). */
  sourceUrl?: string;
  /** UTMs, src, fbc, fbp, ttclid, ttp, ip, ua, os_versao (o gateway repassa às plataformas). */
  metadata?: Record<string, string>;
}

export type ChargeInstructions =
  | {
      kind: "spei";
      clabe: string;
      bank: string;
      /** Titular a mostrar (Kyvo: nominal || beneficiary). */
      holder: string;
      reference: string;
      expiresAt: string | null;
    }
  | {
      kind: "card";
      sdkUrl: string;
      /** Sessão do SDK como veio (uso único). */
      session: Record<string, unknown>;
      expiresAt: string | null;
    };

export interface Charge {
  id: string;
  status: PayStatus;
  amountCents: number;
  currency: PayCurrency;
  instructions: ChargeInstructions;
  /** O gateway devolveu a cobrança já criada antes (mesma Idempotency-Key). */
  replayed?: boolean;
}

export interface TransactionInfo {
  id: string;
  status: PayStatus;
  amountCents: number;
  currency: PayCurrency;
  method: "spei" | "card" | null;
  externalOrderId: string | null;
  paidAt: string | null;
}

/** Resultado do "Testar conexão". */
export type ConnectionStatus = "ok" | "invalid_key" | "missing_scope" | "offline" | "unavailable" | "unexpected";

/** Erros de gateway em categorias que valem para qualquer um. */
export type GatewayErrorCode =
  | "declined" // cartão recusado: peça outro
  | "invalid_key" // chave inválida, revogada ou ausente
  | "missing_scope" // a chave não tem a permissão pedida
  | "invalid_request" // valor/moeda/método recusados pelo gateway
  | "conflict" // Idempotency-Key com corpo diferente, pedido repetido
  | "not_found"
  | "unavailable" // gateway fora do ar (tente de novo com espera)
  | "network" // sem conexão / tempo esgotado
  | "unexpected"; // resposta fora do formato

export class PaymentGatewayError extends Error {
  constructor(
    public readonly code: GatewayErrorCode,
    /** Código do próprio gateway (ex.: "amount_below_minimum"), para registro. */
    public readonly providerCode: string | null = null,
    public readonly httpStatus: number | null = null,
  ) {
    super(`gateway: ${code}${providerCode ? ` (${providerCode})` : ""}`);
    this.name = "PaymentGatewayError";
  }

  /** Vale tentar de novo (com espera)? */
  get retryable(): boolean {
    return this.code === "unavailable" || this.code === "network";
  }
}

export interface PaymentGatewayAdapter {
  provider: PaymentProviderId;
  /** Métodos que o gateway sabe cobrar. */
  methods: readonly PayMethod[];
  createCharge(apiKey: string, input: ChargeInput): Promise<Charge>;
  getTransaction(apiKey: string, id: string): Promise<TransactionInfo>;
  /** Consulta leve só para saber se a chave funciona (sem criar nada). */
  testConnection(apiKey: string): Promise<ConnectionStatus>;
}
