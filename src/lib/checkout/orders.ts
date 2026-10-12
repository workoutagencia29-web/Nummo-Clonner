/**
 * Conferência de um pedido de checkout com o produto SALVO — a regra do
 * servidor (prévia em simulação; o pagamento.php do ZIP repete as mesmas
 * regras): o gateway cobra na moeda, a forma de pagamento está ligada, os
 * dados pedidos vieram e valem (CPF com os dígitos, telefone do Brasil, CEP e
 * UF), os bumps e o frete existem e o total cabe na faixa do gateway. O valor
 * sai SEMPRE dos preços salvos (checkoutTotal): o navegador só manda ids.
 *
 * O formato do pedido já foi conferido por parseCheckoutRequest (./contract).
 */
import type { PaymentErrorCode } from "../payments/contract";
import type { CheckoutConfig } from "./config";
import { type CheckoutAddress, type CheckoutCreateRequest, type CheckoutTotal, checkoutTotal } from "./contract";
import {
  brPhoneDigits,
  isValidBrPhone,
  isValidCep,
  isValidCpf,
  isValidFullName,
  isValidIntlPhone,
  isValidUf,
  onlyDigits,
} from "./fields";
import {
  addressAllowed,
  askedBuyerFields,
  type CheckoutCurrencyId,
  type CheckoutMethodId,
  type CheckoutProviderId,
  checkoutAmountProblem,
  checkoutMethodAllows,
  isPixProvider,
  providerAllows,
} from "./rules";

export interface CheckoutOrderProduct {
  provider: CheckoutProviderId;
  currency: CheckoutCurrencyId;
  methods: CheckoutMethodId[];
  amountCents: number;
  config: Pick<CheckoutConfig, "fields" | "address" | "shipping" | "bumps" | "maxQuantity">;
}

/** Quem compra, já limpo (só os dados pedidos). */
export interface CheckoutBuyer {
  nome: string;
  email: string;
  /** Só algarismos (sem o +55 no Brasil). */
  telefone: string | null;
  /** CPF só com algarismos no real; documento como veio nas outras moedas. */
  documento: string | null;
  endereco: CheckoutAddress | null;
}

export type CheckoutOrderCheck =
  | { ok: true; total: CheckoutTotal; buyer: CheckoutBuyer; method: CheckoutMethodId }
  | { ok: false; erro: PaymentErrorCode };

const METHOD_OF: Record<string, CheckoutMethodId> = {
  pix: "PIX",
  spei: "SPEI",
  card: "CARD",
  bizum: "BIZUM",
  mb_way: "MB_WAY",
};

/** Confere o pedido com o produto salvo (erro = código do endpoint). */
export function checkCheckoutOrder(req: CheckoutCreateRequest, p: CheckoutOrderProduct): CheckoutOrderCheck {
  if (!providerAllows(p.provider, p.currency)) return { ok: false, erro: "configuracao" };
  const method = METHOD_OF[req.metodo];
  if (!method || p.methods.indexOf(method) < 0 || !checkoutMethodAllows(method, p.provider, p.currency)) {
    return { ok: false, erro: "metodo_indisponivel" };
  }
  const brl = p.currency === "BRL";
  const asked = askedBuyerFields(p.provider, p.config.fields);
  // Os gateways de PIX recusam nome sem sobrenome.
  if (isPixProvider(p.provider) && !isValidFullName(req.nome)) return { ok: false, erro: "invalido" };
  const buyer: CheckoutBuyer = { nome: req.nome, email: req.email, telefone: null, documento: null, endereco: null };
  if (asked.indexOf("phone") >= 0) {
    const phone = req.telefone || "";
    if (brl ? !isValidBrPhone(phone) : !isValidIntlPhone(phone)) return { ok: false, erro: "invalido" };
    buyer.telefone = brl ? brPhoneDigits(phone) : onlyDigits(phone);
  }
  if (asked.indexOf("document") >= 0) {
    const doc = req.documento || "";
    if (!doc || (brl && !isValidCpf(doc))) return { ok: false, erro: "invalido" };
    buyer.documento = brl ? onlyDigits(doc) : doc;
  }
  const address = p.config.address && addressAllowed(p.currency);
  if (address) {
    const a = req.endereco;
    if (!a || !isValidCep(a.cep) || !isValidUf(a.uf)) return { ok: false, erro: "invalido" };
    buyer.endereco = a;
  }
  const total = checkoutTotal(
    {
      valor: p.amountCents,
      bumps: p.config.bumps.map((b) => ({ id: b.id, valor: b.priceCents })),
      fretes: p.config.shipping.map((s) => ({ id: s.id, valor: s.priceCents })),
      endereco: address,
      maxQtd: p.config.maxQuantity,
    },
    req.bumps,
    address ? req.frete : null,
    req.quantidade,
  );
  if (!total) return { ok: false, erro: "invalido" };
  if (checkoutAmountProblem(total.total, p.provider, p.currency, [method])) return { ok: false, erro: "configuracao" };
  return { ok: true, total, buyer, method };
}
