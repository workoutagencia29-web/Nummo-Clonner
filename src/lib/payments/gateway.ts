/**
 * Camada genérica de gateway de pagamento: o que o Offer Studio precisa de
 * qualquer gateway (Kyvo no pagamento na página e no checkout; FlevoPay e
 * BlackCat com PIX no checkout do Offer Studio). Cada gateway é um adaptador
 * em src/server/services/payments/<gateway>.ts que implementa
 * PaymentGatewayAdapter; telas, prévia e ZIP só conhecem estes tipos.
 */
import type { PayCurrency, PayMethod, PayStatus } from "./contract";
import type { PaymentProviderId } from "./rules";

/** Formas de pagamento que algum gateway cobra (PIX só nos de PIX, em real). */
export type GatewayMethod = PayMethod | "pix";
/** Moedas que algum gateway cobra (real só nos de PIX). */
export type GatewayCurrency = PayCurrency | "BRL";

/** Endereço de entrega (Brasil), para os gateways que pedem (BlackCat com item físico). */
export interface ChargeAddress {
  /** Só os 8 algarismos. */
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  /** UF (2 letras). */
  state: string;
}

export interface ChargeCustomer {
  name: string;
  email: string;
  /** Documento (CPF no Brasil, só algarismos; RFC/CURP no México, NIF na Espanha…), opcional. */
  document?: string;
  /** Telefone só com algarismos (DDD + número no Brasil), opcional. */
  phone?: string;
  /** Endereço de entrega (checkout com endereço ligado). */
  address?: ChargeAddress;
}

/** Item da cobrança (produto, cada bump e o frete), em centavos. */
export interface ChargeItem {
  title: string;
  unitPriceCents: number;
  quantity: number;
  /** Produto físico (a BlackCat exige o endereço de entrega quando algum item é físico). */
  tangible: boolean;
}

/** Pedido de cobrança. Valor e moeda vêm SEMPRE do produto salvo no servidor. */
export interface ChargeInput {
  method: GatewayMethod;
  amountCents: number;
  currency: GatewayCurrency;
  customer: ChargeCustomer;
  /** Nome do produto (FlevoPay: description). */
  description?: string;
  /** Itens que somam `amountCents` (BlackCat: items). Sem eles, um item só com o valor todo. */
  items?: ChargeItem[];
  /** Endereço que o gateway chama ao mudar o status (o webhook do pagamento.php). */
  postbackUrl?: string;
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
    }
  | {
      kind: "pix";
      /** Código "copia e cola" (o QR Code é este texto). */
      copyPaste: string;
      /** Imagem do QR como o gateway mandou (data:image/png;base64,…), ou null. */
      qrImage: string | null;
      expiresAt: string | null;
    };

export interface Charge {
  id: string;
  status: PayStatus;
  amountCents: number;
  currency: GatewayCurrency;
  instructions: ChargeInstructions;
  /** O gateway devolveu a cobrança já criada antes (mesma Idempotency-Key). */
  replayed?: boolean;
}

export interface TransactionInfo {
  id: string;
  status: PayStatus;
  amountCents: number;
  currency: GatewayCurrency;
  method: "spei" | "card" | "pix" | null;
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
  methods: readonly GatewayMethod[];
  createCharge(apiKey: string, input: ChargeInput): Promise<Charge>;
  getTransaction(apiKey: string, id: string): Promise<TransactionInfo>;
  /** Consulta leve só para saber se a chave funciona (sem criar nada). */
  testConnection(apiKey: string): Promise<ConnectionStatus>;
}

/**
 * Conta do gateway de UMA oferta como a tela recebe (aba "Links e checkouts"):
 * nunca a chave, só o final mascarado.
 */
export interface PaymentAccountView {
  provider: PaymentProviderId;
  label: string;
  configured: boolean;
  /** Final da chave ("••••••a1b2"), nunca a chave. */
  keyHint: string | null;
  /** A chave salva não pode ser lida (APP_ENCRYPTION_KEY trocada): cole de novo. */
  keyUnreadable: boolean;
  /** Último "Testar conexão" (ISO) e o resultado. */
  checkedAt: string | null;
  checkStatus: ConnectionStatus | null;
}

/** Outra oferta com chave salva ("Usar a mesma chave de outra oferta"). Nunca a chave. */
export interface PaymentKeySource {
  offerId: string;
  offerName: string;
  /** Final da chave ("••••••a1b2"), para reconhecer a conta. */
  keyHint: string;
  /** A chave é a mesma desta oferta ("Trocar chave" oferece trocar também nela). */
  sameKey: boolean;
}
