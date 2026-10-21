/**
 * Checkout do Offer Studio no pagamento.php do ZIP (fase 3): o PHP que a
 * página de checkout (checkout/<chave>/index.html, script em src/runtime/checkout)
 * chama — o mesmo contrato da prévia (src/lib/checkout/contract.ts; a prévia
 * responde em simulação, src/server/services/payments/simulation.ts) — e o
 * que vai no pagamento-dados/config.php para ele.
 *
 * - checkout_criar: confere o pedido com as MESMAS regras do servidor da
 *   prévia (parseCheckoutRequest + checkCheckoutOrder, src/lib/checkout/orders.ts):
 *   forma ligada, campos pedidos (CPF com os dígitos, telefone do Brasil, CEP e
 *   UF), bumps e frete que existem, total SEMPRE dos preços do config.php
 *   (produto + bumps + frete; o navegador só manda ids) e a faixa de valor de
 *   cada forma. Cria o PIX na FlevoPay (POST /api/v1/transaction) ou na
 *   BlackCat (POST /sales/create-sale), ou a cobrança da Kyvo (SPEI, cartão,
 *   Bizum, MB WAY) nas outras moedas. Responde com um `pedido` NOSSO e
 *   aleatório (ck_ + 24; a credencial do ?pedido= e do acesso — nunca o id do
 *   gateway, que a FlevoPay numera em sequência) e `agora` (hora do servidor).
 * - checkout_status: o status conferido NA API do gateway com a chave (nunca
 *   o que o navegador diz); pago fica guardado (já confirmado).
 * - acesso (o mesmo do bloco "Acesso ao produto"): pedido do checkout PAGO →
 *   link do produto e, em `extras`, os dos bumps comprados.
 * - webhook (POST pagamento.php?webhook=flevopay|blackcat): o corpo NUNCA é
 *   confiável sozinho (sem assinatura documentada) — só diz qual cobrança
 *   olhar; o status vem da consulta à API com a chave. O endereço vai em cada
 *   cobrança (postback_url / postbackUrl) quando o site está em HTTPS.
 *
 * Pedidos em pagamento-dados/pedidos/<2>/<resumo>.php (começam com
 * "<?php exit; ?>"): só o que o servidor precisa — checkout, gateway, id da
 * cobrança, pedidoExterno, forma, valor, moeda, bumps e frete escolhidos,
 * status e datas. NADA de nome, e-mail, telefone, CPF ou endereço (eles vão
 * direto ao gateway, que guarda a venda). O índice do webhook (gateway + id
 * da cobrança → pedido) fica na mesma pasta. Arquivos só para o PHP (0600,
 * pastas 0700). Apagados aos poucos, a cada cobrança criada: os pedidos que
 * chegaram a ser pagos depois de PAGAMENTO_ORDER_KEEP_DAYS, os outros (e o
 * índice deles) depois de PAGAMENTO_UNPAID_KEEP_DAYS.
 *
 * Os endereços das APIs são fixos: os testes trocam o texto do arquivo
 * gerado para os servidores falsos (tests/unit/pix-fakes.ts, kyvo-fake.ts).
 */
import { CHECKOUT_METADATA_KEYS, type CheckoutPayMethod, WEBHOOK_PARAM } from "@/lib/checkout/contract";
import { BR_STATES } from "@/lib/checkout/fields";
import {
  addressAllowed,
  askedBuyerFields,
  type BuyerField,
  type CheckoutCurrencyId,
  type CheckoutMethodId,
  type CheckoutProviderId,
  checkoutMethodAllows,
  PIX_LIMITS,
  providerAllows,
} from "@/lib/checkout/rules";
import { METHOD_LIMITS, type PaymentLocaleId } from "@/lib/payments/rules";
import { phpString } from "./php";

/** API da FlevoPay usada pelo pagamento.php (a mesma de FLEVOPAY_API_BASE). */
export const PAGAMENTO_FLEVOPAY_API = "https://pagamento-processador.org.ua";
/** API da BlackCat usada pelo pagamento.php (a mesma de BLACKCAT_API_BASE). */
export const PAGAMENTO_BLACKCAT_API = "https://api.blackcatoficial.com/api";
/** API da ClownPay usada pelo pagamento.php (a mesma de CLOWNPAY_API_BASE). */
export const PAGAMENTO_CLOWNPAY_API = "https://api.clownpay.com.br";
/** API do PagPixHub usada pelo pagamento.php (a mesma de PAGPIXHUB_API_BASE, já com /api/v1). */
export const PAGAMENTO_PAGPIXHUB_API = "https://pagpixhub.com/api/v1";
/** Pasta dos pedidos do checkout dentro de pagamento-dados/. */
export const PAGAMENTO_ORDERS_DIR = "pedidos";
/** Dias que um pedido PAGO do checkout fica guardado (o ?pedido= da página de obrigado vale esse tempo). */
export const PAGAMENTO_ORDER_KEEP_DAYS = 180;
/**
 * Dias que um pedido que nunca foi pago fica guardado (PIX abandonado, recusado,
 * vencido): bem mais que a validade de qualquer cobrança (PIX: 1 dia; SPEI: dias).
 */
export const PAGAMENTO_UNPAID_KEEP_DAYS = 30;
/**
 * Volta inteira da limpeza dos pedidos (as 256 subpastas), quando há ao menos
 * uma cobrança a cada poucas horas; com mais cobranças, mais rápido.
 */
export const PAGAMENTO_CLEANUP_CYCLE_DAYS = 7;
/** Tamanho máximo do corpo de um webhook (bytes). */
export const PAGAMENTO_WEBHOOK_MAX_BODY = 64 * 1024;
/** Webhooks por IP a cada PAGAMENTO_WINDOW_S (cada um vira uma consulta à API). */
export const PAGAMENTO_WEBHOOK_LIMIT = 600;

/** Gateway como o pagamento.php o chama ("" = o gateway não cobra na moeda do produto). */
export type PagamentoGateway = "flevopay" | "blackcat" | "clownpay" | "pagpixhub" | "kyvo";

/** Checkout como o pagamento.php conhece (só no config.php). */
export interface PagamentoCheckout {
  /** Chave do link (a página checkout/<chave>/ e o `checkout` dos pedidos). */
  key: string;
  /** Código do produto no pedidoExterno (orderProductCode). */
  code: string;
  gateway: PagamentoGateway | "";
  name: string;
  amountCents: number;
  currency: CheckoutCurrencyId;
  /** Formas de pagamento ligadas que o gateway aceita na moeda. */
  methods: CheckoutPayMethod[];
  /** Faixa do total (centavos) de cada forma. */
  ranges: Partial<Record<CheckoutPayMethod, { min: number; max: number }>>;
  /** Campos pedidos de quem compra (os ligados + os que o gateway exige). */
  fields: BuyerField[];
  /** Pede o endereço de entrega (vale em qualquer moeda). */
  address: boolean;
  shipping: { id: string; name: string; priceCents: number }[];
  bumps: { id: string; title: string; priceCents: number; accessUrl: string }[];
  /** Quantidade máxima do produto (1 = sem seletor). */
  maxQtd: number;
  /** Pasta da página de obrigado no ZIP, só para referência (null = sem). */
  thankYou: string | null;
  /** Link de acesso entregue a quem pagou ("" = não vende). */
  accessUrl: string;
  /** Idioma dos textos (o bloco "Acesso ao produto" troca os padrões por ele). */
  locale: "pt" | "es" | "en";
}

const METHOD_NAME: Record<CheckoutMethodId, CheckoutPayMethod> = {
  PIX: "pix",
  SPEI: "spei",
  CARD: "card",
  BIZUM: "bizum",
  MB_WAY: "mb_way",
};

const LANG: Record<PaymentLocaleId, "pt" | "es" | "en"> = { PT: "pt", ES: "es", EN: "en" };

/** O que o config.php precisa do produto do checkout (ServerCheckoutProduct cabe aqui). */
export interface PagamentoCheckoutSource {
  key: string;
  provider: CheckoutProviderId;
  name: string;
  amountCents: number;
  currency: CheckoutCurrencyId;
  methods: CheckoutMethodId[];
  locale: PaymentLocaleId;
  accessUrl: string;
  config: {
    fields: Partial<Record<BuyerField, boolean>>;
    address: boolean;
    /** Quantidade máxima (ausente = 1). */
    maxQuantity?: number;
    shipping: { id: string; name: string; priceCents: number }[];
    bumps: { id: string; title: string; priceCents: number; accessUrl: string }[];
  };
}

/**
 * Produto do checkout → o que vai no config.php, com as regras de
 * checkCheckoutOrder já resolvidas (gateway × moeda, formas que valem, campos
 * pedidos, endereço e frete, faixa de cada forma).
 */
export function pagamentoCheckoutOf(
  p: PagamentoCheckoutSource,
  opts: { code: string; thankYou: string | null },
): PagamentoCheckout {
  const methods = p.methods.filter((m) => checkoutMethodAllows(m, p.provider, p.currency));
  const ranges: PagamentoCheckout["ranges"] = {};
  for (const m of methods) {
    ranges[METHOD_NAME[m]] = m === "PIX" ? { min: PIX_LIMITS.min, max: PIX_LIMITS.max } : { ...METHOD_LIMITS[m] };
  }
  const address = p.config.address && addressAllowed(p.currency);
  return {
    key: p.key,
    code: opts.code,
    gateway: providerAllows(p.provider, p.currency) ? (p.provider.toLowerCase() as PagamentoGateway) : "",
    name: p.name,
    amountCents: p.amountCents,
    currency: p.currency,
    methods: methods.map((m) => METHOD_NAME[m]),
    ranges,
    fields: askedBuyerFields(p.provider, p.config.fields),
    address,
    shipping: address ? p.config.shipping.map((s) => ({ id: s.id, name: s.name, priceCents: s.priceCents })) : [],
    bumps: p.config.bumps.map((b) => ({ id: b.id, title: b.title, priceCents: b.priceCents, accessUrl: b.accessUrl })),
    maxQtd: p.config.maxQuantity ?? 1,
    thankYou: opts.thankYou,
    accessUrl: p.accessUrl,
    locale: LANG[p.locale],
  };
}

/** O gateway exige nome com sobrenome (os de PIX)? */
export function pagamentoNeedsFullName(gateway: PagamentoGateway | ""): boolean {
  return gateway === "flevopay" || gateway === "blackcat" || gateway === "clownpay" || gateway === "pagpixhub";
}

const cents = (n: number) => (Number.isSafeInteger(n) && n >= 0 ? n : 0);
const list = (items: readonly string[]) => `array(${items.map(phpString).join(", ")})`;

function checkoutEntry(c: PagamentoCheckout): string {
  const ranges = Object.entries(c.ranges)
    .map(([m, r]) => `${phpString(m)} => array(${cents(r.min)}, ${cents(r.max)})`)
    .join(", ");
  const shipping = c.shipping
    .map((s) => `${phpString(s.id)} => array('nome' => ${phpString(s.name)}, 'valor' => ${cents(s.priceCents)})`)
    .join(",\n        ");
  const bumps = c.bumps
    .map(
      (b) =>
        `${phpString(b.id)} => array('titulo' => ${phpString(b.title)}, 'valor' => ${cents(b.priceCents)}, 'acesso' => ${phpString(b.accessUrl)})`,
    )
    .join(",\n        ");
  const amount = Number.isSafeInteger(c.amountCents) && c.amountCents > 0 ? c.amountCents : 0;
  return [
    `    ${phpString(c.key)} => array(`,
    `      'codigo' => ${phpString(c.code)},`,
    `      'gateway' => ${phpString(c.gateway)},`,
    `      'nome' => ${phpString(c.name)},`,
    `      'valor' => ${amount},`,
    `      'moeda' => ${phpString(c.currency)},`,
    `      'metodos' => ${list(c.methods)},`,
    `      'faixas' => array(${ranges}),`,
    `      'campos' => ${list(c.fields)},`,
    `      'nome_completo' => ${pagamentoNeedsFullName(c.gateway) ? "true" : "false"},`,
    `      'endereco' => ${c.address ? "true" : "false"},`,
    `      'fretes' => array(${shipping ? `\n        ${shipping},\n      ` : ""}),`,
    `      'bumps' => array(${bumps ? `\n        ${bumps},\n      ` : ""}),`,
    `      'max_qtd' => ${Number.isSafeInteger(c.maxQtd) && c.maxQtd >= 1 ? c.maxQtd : 1},`,
    `      'obrigado' => ${c.thankYou === null ? "null" : phpString(c.thankYou)},`,
    `      'acesso' => ${phpString(c.accessUrl)},`,
    `      'idioma' => ${phpString(c.locale)},`,
    "    ),",
  ].join("\n");
}

/** 'checkouts' => array(...) do config.php. */
export function checkoutsConfigPhp(checkouts: readonly PagamentoCheckout[]): string {
  return checkouts.length ? `array(\n${checkouts.map(checkoutEntry).join("\n")}\n  )` : "array()";
}

const phpArray = (items: readonly string[]) => `array(${items.map((i) => `'${i}'`).join(", ")})`;

/** Métodos do checkout → nome do pagamento.php. */
const CHECKOUT_METHODS_PHP = phpArray(["pix", "spei", "card", "bizum", "mb_way"]);

/**
 * Constantes e funções do checkout no pagamento.php (PHP 7.4+), depois das
 * funções do pagamento na página. String.raw: as barras do PHP ficam como
 * estão (só os ${…} são do TypeScript).
 */
export function checkoutPhpFunctions(): string {
  return String.raw`
// ─── Checkout do Offer Studio (página checkout/<chave>/) ─────────────────────

const OS_FLEVOPAY_API = '${PAGAMENTO_FLEVOPAY_API}';
const OS_BLACKCAT_API = '${PAGAMENTO_BLACKCAT_API}';
const OS_CLOWNPAY_API = '${PAGAMENTO_CLOWNPAY_API}';
const OS_PAGPIXHUB_API = '${PAGAMENTO_PAGPIXHUB_API}';
const OS_ORDERS_DIR = '${PAGAMENTO_ORDERS_DIR}';
const OS_ORDER_KEEP = ${PAGAMENTO_ORDER_KEEP_DAYS * 86400};
const OS_UNPAID_KEEP = ${PAGAMENTO_UNPAID_KEEP_DAYS * 86400};
const OS_CLEANUP_STEP = ${Math.floor((PAGAMENTO_CLEANUP_CYCLE_DAYS * 86400) / 256)};
const OS_WEBHOOK_MAX_BODY = ${PAGAMENTO_WEBHOOK_MAX_BODY};
const OS_WEBHOOK_LIMIT = ${PAGAMENTO_WEBHOOK_LIMIT};
const OS_WEBHOOK_PARAM = '${WEBHOOK_PARAM}';
const OS_CHECKOUT_METHODS = ${CHECKOUT_METHODS_PHP};
const OS_CHECKOUT_METADATA_KEYS = ${phpArray(CHECKOUT_METADATA_KEYS)};
const OS_UFS = ${phpArray(BR_STATES)};

/** Só os algarismos. */
function os_digits($value)
{
    return preg_replace('/\D+/', '', (string) $value);
}

/** Texto limpo: sem espaços nas pontas, espaços repetidos viram um, até $max caracteres. */
function os_clean($value, $max)
{
    $text = os_text($value);
    if ($text === null || os_len($text) < 0) {
        return '';
    }
    return os_cut(preg_replace('/\s+/u', ' ', trim($text)), $max);
}

/** CPF com os dois dígitos verificadores certos (isValidCpf). */
function os_cpf_ok($value)
{
    $d = os_digits($value);
    if (strlen($d) !== 11 || preg_match('/^(\d)\1{10}$/', $d)) {
        return false;
    }
    for ($check = 9; $check < 11; $check++) {
        $sum = 0;
        for ($i = 0; $i < $check; $i++) {
            $sum += (int) $d[$i] * ($check + 1 - $i);
        }
        if ((($sum * 10) % 11) % 10 !== (int) $d[$check]) {
            return false;
        }
    }
    return true;
}

/** Telefone do Brasil só com DDD + número, sem o +55 nem o 0 (brPhoneDigits). */
function os_br_phone($value)
{
    $d = os_digits($value);
    if (substr($d, 0, 1) === '0') {
        $d = substr($d, 1);
        if (strlen($d) === 12 || strlen($d) === 13) {
            $d = substr($d, 2);
        }
    }
    return (strlen($d) === 12 || strlen($d) === 13) && substr($d, 0, 2) === '55' ? substr($d, 2) : $d;
}

/** Telefone do Brasil válido (isValidBrPhone). */
function os_br_phone_ok($value)
{
    $d = os_br_phone($value);
    if (!preg_match('/^[1-9][1-9]/', $d)) {
        return false;
    }
    if (strlen($d) === 11) {
        return $d[2] === '9';
    }
    return strlen($d) === 10 && strpos('2345', $d[2]) !== false;
}

/** Nome com sobrenome (isValidFullName): os gateways de PIX recusam nome solto. */
function os_full_name_ok($value)
{
    $v = preg_replace('/\s+/u', ' ', trim((string) $value));
    $n = os_len($v);
    if ($n < 5 || $n > 120) {
        return false;
    }
    $parts = explode(' ', $v);
    return count($parts) >= 2 && os_len($parts[0]) >= 2 && os_len($parts[count($parts) - 1]) >= 1;
}

/** Endereço de entrega (readAddress); null = incompleto. */
function os_read_address($raw)
{
    if (!is_array($raw)) {
        return null;
    }
    // Formato cru (a regra por moeda — CEP+UF do Brasil x genérico — fica em
    // os_checkout_buyer). Fora do real o CEP pode ter letras e o estado é texto livre.
    $cep = substr(trim((string) os_text(os_field($raw, 'cep'))), 0, 16);
    $uf = substr(trim((string) os_text(os_field($raw, 'uf'))), 0, 60);
    $out = array(
        'cep' => $cep,
        'rua' => os_clean(os_field($raw, 'rua'), 120),
        'numero' => os_clean(os_field($raw, 'numero'), 20),
        'complemento' => os_clean(os_field($raw, 'complemento'), 120),
        'bairro' => os_clean(os_field($raw, 'bairro'), 120),
        'cidade' => os_clean(os_field($raw, 'cidade'), 120),
        'uf' => $uf,
    );
    if (strlen($cep) < 2 || strlen($uf) < 1) {
        return null;
    }
    if ($out['rua'] === '' || $out['numero'] === '' || $out['bairro'] === '' || $out['cidade'] === '') {
        return null;
    }
    return $out;
}

/**
 * Confere o FORMATO de um pedido do checkout (as regras de
 * parseCheckoutRequest no Offer Studio). null = inválido.
 */
function os_parse_checkout($o)
{
    if (!is_array($o)) {
        return null;
    }
    $checkout = os_text(os_field($o, 'checkout'));
    if ($checkout === null || !preg_match('/^[a-z0-9-]{1,80}$/', $checkout)) {
        return null;
    }
    $acao = os_field($o, 'acao');
    if ($acao === 'checkout_status') {
        $pedido = os_text(os_field($o, 'pedido'));
        if ($pedido === null || !os_checkout_order_ok($pedido)) {
            return null;
        }
        return array('acao' => 'checkout_status', 'pedido' => $pedido, 'checkout' => $checkout);
    }
    if ($acao !== 'checkout_criar') {
        return null;
    }
    $metodo = os_text(os_field($o, 'metodo'));
    if ($metodo === null || !in_array($metodo, OS_CHECKOUT_METHODS, true)) {
        return null;
    }
    $nome = os_clean(os_field($o, 'nome'), 121);
    $email = strtolower(trim((string) os_text(os_field($o, 'email'))));
    $length = os_len($nome);
    if ($length < 2 || $length > 120) {
        return null;
    }
    if (strlen($email) > 254 || !preg_match('/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@.]{2,63}$/u', $email)) {
        return null;
    }
    $out = array(
        'acao' => 'checkout_criar',
        'checkout' => $checkout,
        'metodo' => $metodo,
        'nome' => $nome,
        'email' => $email,
        'telefone' => '',
        'documento' => '',
        'endereco' => null,
        'quantidade' => 1,
        'bumps' => array(),
        'frete' => null,
        'metadata' => array(),
    );
    if (isset($o['quantidade']) && $o['quantidade'] !== null) {
        $qtd = is_int($o['quantidade']) ? $o['quantidade'] : (is_string($o['quantidade']) && ctype_digit($o['quantidade']) ? (int) $o['quantidade'] : -1);
        if ($qtd < 1 || $qtd > 99) {
            return null;
        }
        $out['quantidade'] = $qtd;
    }
    $telefone = os_digits((string) os_text(os_field($o, 'telefone')));
    if ($telefone !== '') {
        if (strlen($telefone) < 8 || strlen($telefone) > 15) {
            return null;
        }
        $out['telefone'] = $telefone;
    }
    $documento = strtoupper(trim((string) os_text(os_field($o, 'documento'))));
    if ($documento !== '') {
        if (!preg_match('#^[A-Z0-9./-]{4,40}$#', $documento)) {
            return null;
        }
        $out['documento'] = $documento;
    }
    if (isset($o['endereco']) && $o['endereco'] !== null) {
        $endereco = os_read_address($o['endereco']);
        if ($endereco === null) {
            return null;
        }
        $out['endereco'] = $endereco;
    }
    if (isset($o['bumps']) && $o['bumps'] !== null) {
        if (!os_is_list($o['bumps']) || count($o['bumps']) > 3) {
            return null;
        }
        foreach ($o['bumps'] as $id) {
            if (!is_string($id) || !preg_match('/^[a-z0-9]{4,16}$/', $id) || in_array($id, $out['bumps'], true)) {
                return null;
            }
            $out['bumps'][] = $id;
        }
    }
    if (isset($o['frete']) && $o['frete'] !== null && $o['frete'] !== '') {
        if (!is_string($o['frete']) || !preg_match('/^[a-z0-9]{4,16}$/', $o['frete'])) {
            return null;
        }
        $out['frete'] = $o['frete'];
    }
    $meta = os_field($o, 'metadata');
    foreach (OS_CHECKOUT_METADATA_KEYS as $key) {
        $value = os_text(os_field($meta, $key));
        if ($value === null) {
            continue;
        }
        $value = trim($value);
        if ($value === '' || os_len($value) < 0) {
            continue;
        }
        $out['metadata'][$key] = os_cut($value, 500);
    }
    return $out;
}

/** Lista JSON ([…], não {…})? */
function os_is_list($value)
{
    return is_array($value) && array_values($value) === $value;
}

/** O texto pode ser a credencial de um pedido do checkout (16+ caracteres, nunca só algarismos)? */
function os_checkout_order_ok($value)
{
    return is_string($value) && preg_match('/^[A-Za-z0-9_-]{16,100}$/', $value) && !preg_match('/^[0-9]+$/', $value);
}

/** Checkout do config.php no formato certo? */
function os_checkout_ok($c)
{
    return is_array($c)
        && isset($c['codigo'], $c['gateway'], $c['valor'], $c['moeda'], $c['metodos'], $c['faixas'], $c['campos'], $c['fretes'], $c['bumps'])
        && is_string($c['codigo']) && preg_match('/^[a-z0-9-]{1,32}$/', $c['codigo'])
        && in_array($c['gateway'], array('flevopay', 'blackcat', 'clownpay', 'pagpixhub', 'kyvo'), true)
        && is_int($c['valor']) && $c['valor'] > 0
        && is_string($c['moeda']) && is_array($c['metodos']) && is_array($c['faixas'])
        && is_array($c['campos']) && is_array($c['fretes']) && is_array($c['bumps']);
}

/**
 * Quem compra, conferido com o checkout (checkCheckoutOrder): só os dados
 * pedidos, já limpos. null = faltou ou não vale (→ "invalido").
 */
function os_checkout_buyer($req, $c)
{
    $brl = $c['moeda'] === 'BRL';
    if (!empty($c['nome_completo']) && !os_full_name_ok($req['nome'])) {
        return null;
    }
    $buyer = array('nome' => $req['nome'], 'email' => $req['email'], 'telefone' => '', 'documento' => '', 'endereco' => null);
    if (in_array('phone', $c['campos'], true)) {
        $phone = $req['telefone'];
        if ($brl ? !os_br_phone_ok($phone) : (strlen($phone) < 8 || strlen($phone) > 15)) {
            return null;
        }
        $buyer['telefone'] = $brl ? os_br_phone($phone) : $phone;
    }
    if (in_array('document', $c['campos'], true)) {
        $doc = $req['documento'];
        if ($doc === '' || ($brl && !os_cpf_ok($doc))) {
            return null;
        }
        $buyer['documento'] = $brl ? os_digits($doc) : $doc;
    }
    if (!empty($c['endereco'])) {
        $a = $req['endereco'];
        if (!is_array($a)) {
            return null;
        }
        // No Brasil, CEP de 8 dígitos (não todos zero) + UF da lista; fora, código
        // postal (2 a 16, letras/números) e estado texto livre (1 a 60).
        if ($brl) {
            $cepDigits = os_digits($a['cep']);
            $bad = strlen($cepDigits) !== 8 || $cepDigits === '00000000' || !in_array(strtoupper($a['uf']), OS_UFS, true);
        } else {
            $cep = trim($a['cep']);
            $uf = trim($a['uf']);
            $bad = strlen($cep) < 2 || strlen($cep) > 16 || !preg_match('/^[A-Za-z0-9][A-Za-z0-9 .-]*$/', $cep)
                || strlen($uf) < 1 || strlen($uf) > 60;
        }
        if ($bad) {
            return null;
        }
        // No Brasil, grava o CEP só com dígitos e a UF em maiúsculas (o gateway espera assim).
        if ($brl) {
            $a['cep'] = os_digits($a['cep']);
            $a['uf'] = strtoupper($a['uf']);
        }
        $buyer['endereco'] = $a;
    }
    return $buyer;
}

/**
 * Endereço de entrega em chaves planas para a metadata da Kyvo (ela não tem
 * campo de endereço — o lojista lê no painel). Espelho de checkoutAddressMeta.
 */
function os_address_meta($a)
{
    $m = array();
    $rua = $a['rua'];
    if ($a['numero'] !== '') {
        $rua = $rua === '' ? $a['numero'] : $rua . ', ' . $a['numero'];
    }
    if ($rua !== '') {
        $m['entrega_endereco'] = $rua;
    }
    if ($a['complemento'] !== '') {
        $m['entrega_complemento'] = $a['complemento'];
    }
    if ($a['bairro'] !== '') {
        $m['entrega_bairro'] = $a['bairro'];
    }
    if ($a['cidade'] !== '') {
        $m['entrega_cidade'] = $a['cidade'];
    }
    if ($a['uf'] !== '') {
        $m['entrega_estado'] = $a['uf'];
    }
    if ($a['cep'] !== '') {
        $m['entrega_cep'] = $a['cep'];
    }
    return $m;
}

/**
 * Total com os PREÇOS DO config.php e só os ids que o navegador mandou
 * (checkoutTotal). null = bump desconhecido ou repetido; frete faltando,
 * desconhecido ou mandado sem endereço.
 */
function os_checkout_total($c, $bumpIds, $freteId, $quantidade = 1)
{
    $maxQtd = isset($c['max_qtd']) && is_int($c['max_qtd']) && $c['max_qtd'] >= 1 ? $c['max_qtd'] : 1;
    $qtd = is_int($quantidade) ? $quantidade : 1;
    if ($qtd < 1 || $qtd > $maxQtd) {
        return null;
    }
    $valorBumps = 0;
    $chosen = array();
    foreach ($bumpIds as $id) {
        if (in_array($id, $chosen, true) || !isset($c['bumps'][$id]) || !is_int(os_field($c['bumps'][$id], 'valor'))) {
            return null;
        }
        $chosen[] = $id;
        $valorBumps += $c['bumps'][$id]['valor'];
    }
    $frete = null;
    $valorFrete = 0;
    if (!empty($c['endereco']) && count($c['fretes'])) {
        if ($freteId === null || !isset($c['fretes'][$freteId]) || !is_int(os_field($c['fretes'][$freteId], 'valor'))) {
            return null;
        }
        $frete = $freteId;
        $valorFrete = $c['fretes'][$freteId]['valor'];
    } elseif ($freteId !== null) {
        return null;
    }
    $produto = $c['valor'] * $qtd;
    return array(
        'quantidade' => $qtd,
        'produto' => $produto,
        'bumps' => $chosen,
        'frete' => $frete,
        'valorFrete' => $valorFrete,
        'total' => $produto + $valorBumps + $valorFrete,
    );
}

/** Chave da API do gateway ('' = não cadastrada). */
function os_gateway_key($config, $gateway)
{
    if ($gateway === 'kyvo') {
        return trim((string) os_text(os_field($config, 'chave')));
    }
    return trim((string) os_text(os_field(os_field($config, 'chaves'), $gateway)));
}

// ── Pedidos guardados (pagamento-dados/pedidos) ──────────────────────────────

/** Pasta dos pedidos (criada se faltar); null = não aceita gravação. */
function os_orders_dir()
{
    $dir = __DIR__ . '/' . OS_DATA_DIR . '/' . OS_ORDERS_DIR;
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    return is_dir($dir) && @is_writable($dir) ? $dir : null;
}

/** Arquivo de um registro pelo resumo do nome: pedidos/<2>/<sha256>.php (o nome nunca aparece). */
function os_record_file($name)
{
    $hash = hash('sha256', $name);
    return __DIR__ . '/' . OS_DATA_DIR . '/' . OS_ORDERS_DIR . '/' . substr($hash, 0, 2) . '/' . $hash . '.php';
}

function os_record_read($name)
{
    $file = os_record_file($name);
    if (!is_file($file)) {
        return null;
    }
    $raw = @file_get_contents($file);
    if (!is_string($raw) || strpos($raw, OS_LIMIT_HEAD) !== 0) {
        return null;
    }
    $data = json_decode(substr($raw, strlen(OS_LIMIT_HEAD)), true);
    return is_array($data) ? $data : null;
}

/**
 * Grava (arquivo temporário + rename: nunca fica pela metade), só para o PHP
 * (0600: outra conta da hospedagem não lê nem muda). A data do arquivo diz
 * quando ele vence — a limpeza apaga o que passou de OS_ORDER_KEEP —; o que
 * fica menos tempo ($keep) é gravado com a data recuada (se o touch falhar,
 * ele só fica mais tempo, nunca menos).
 */
function os_record_write($name, $data, $keep = OS_ORDER_KEEP)
{
    if (os_orders_dir() === null) {
        return false;
    }
    $file = os_record_file($name);
    $sub = dirname($file);
    if (!is_dir($sub) && !@mkdir($sub, 0700, true) && !is_dir($sub)) {
        return false;
    }
    $json = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        return false;
    }
    $tmp = substr($file, 0, -4) . '-' . bin2hex(random_bytes(4)) . '.php';
    if (@file_put_contents($tmp, OS_LIMIT_HEAD . $json, LOCK_EX) === false) {
        @unlink($tmp);
        return false;
    }
    @chmod($tmp, 0600);
    if ($keep < OS_ORDER_KEEP) {
        @touch($tmp, time() - (OS_ORDER_KEEP - $keep));
    }
    if (!@rename($tmp, $file)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

/**
 * Apaga os registros vencidos (data do arquivo mais velha que OS_ORDER_KEEP),
 * aos poucos, a cada cobrança criada: as próximas subpastas, em rodízio — uma
 * por cobrança e mais uma a cada OS_CLEANUP_STEP desde a última limpeza (até
 * 32 de uma vez). A volta nas 256 leva uns 7 dias com uma cobrança a cada
 * poucas horas, e menos com mais vendas. A posição do rodízio fica em
 * pedidos/limpeza.php (a data dele = a última limpeza).
 */
function os_orders_cleanup()
{
    $base = __DIR__ . '/' . OS_DATA_DIR . '/' . OS_ORDERS_DIR;
    $state = $base . '/limpeza.php';
    $last = @filemtime($state);
    $raw = $last === false ? false : @file_get_contents($state);
    $next = is_string($raw) && preg_match('/(\d{1,3})\s*$/', $raw, $m) ? ((int) $m[1]) % 256 : 0;
    $count = $last === false ? 1 : max(1, min(32, intdiv(max(0, time() - $last), OS_CLEANUP_STEP)));
    if (@file_put_contents($state, OS_LIMIT_HEAD . (($next + $count) % 256), LOCK_EX) !== false) {
        @chmod($state, 0600);
    }
    $old = time() - OS_ORDER_KEEP;
    for ($i = 0; $i < $count; $i++) {
        $sub = $base . '/' . sprintf('%02x', ($next + $i) % 256);
        $files = is_dir($sub) ? @glob($sub . '/*.php') : array();
        foreach ((array) $files as $file) {
            $time = @filemtime($file);
            if ($time !== false && $time < $old) {
                @unlink($file);
            }
        }
    }
}

function os_order_get($pedido)
{
    $order = os_record_read('pedido|' . $pedido);
    return is_array($order) && isset($order['checkout'], $order['gateway'], $order['gid'], $order['externo'], $order['status'], $order['valor'], $order['moeda'])
        ? $order
        : null;
}

/**
 * Grava o pedido e o índice do webhook (gateway + id da cobrança → pedido).
 * Pedido que nunca foi pago (sem 'pago') vence em OS_UNPAID_KEEP; pago, em
 * OS_ORDER_KEEP (o acesso da página de obrigado vale esse tempo).
 */
function os_order_put($pedido, $order)
{
    $keep = empty($order['pago']) ? OS_UNPAID_KEEP : OS_ORDER_KEEP;
    return os_record_write('pedido|' . $pedido, $order, $keep)
        && os_record_write('cobranca|' . $order['gateway'] . '|' . $order['gid'], array('pedido' => $pedido), $keep);
}

/** Pedido novo do checkout: ck_ + 24 letras/números aleatórios (a credencial do ?pedido=). */
function os_new_checkout_order()
{
    $alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    $out = '';
    while (strlen($out) < 24) {
        foreach (str_split(random_bytes(32)) as $char) {
            $byte = ord($char);
            if ($byte < 252 && strlen($out) < 24) {
                $out .= $alphabet[$byte % 36];
            }
        }
    }
    return 'ck_' . $out;
}

// ── Gateways de PIX ──────────────────────────────────────────────────────────

/**
 * Pedido à API da FlevoPay, da BlackCat ou da ClownPay. A FlevoPay e a BlackCat
 * autenticam por X-API-Key; a ClownPay por "Authorization: Bearer" e, no POST,
 * uma "Idempotency-Key" ($idempotency = pedidoExterno: repetir nunca cria outra
 * cobrança). $retry: tenta mais uma vez quando o gateway está fora (só consultas).
 */
function os_pix_api($gateway, $method, $path, $apiKey, $body, $retry, $idempotency = null)
{
    if ($gateway === 'flevopay') {
        $base = OS_FLEVOPAY_API;
        $headers = array('X-API-Key: ' . $apiKey, 'Accept: application/json');
    } elseif ($gateway === 'clownpay') {
        $base = OS_CLOWNPAY_API;
        $headers = array('Authorization: Bearer ' . $apiKey, 'Accept: application/json');
        if ($idempotency !== null && $idempotency !== '') {
            $headers[] = 'Idempotency-Key: ' . $idempotency;
        }
    } elseif ($gateway === 'pagpixhub') {
        $base = OS_PAGPIXHUB_API;
        $headers = array('Authorization: Bearer ' . $apiKey, 'Accept: application/json');
        if ($idempotency !== null && $idempotency !== '') {
            $headers[] = 'Idempotency-Key: ' . $idempotency;
        }
    } else {
        $base = OS_BLACKCAT_API;
        $headers = array('X-API-Key: ' . $apiKey, 'Accept: application/json');
    }
    $payload = null;
    if ($body !== null) {
        $payload = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($payload === false) {
            return array(0, '');
        }
        $headers[] = 'Content-Type: application/json';
    }
    $res = array(0, '');
    for ($try = 0; $try < ($retry ? 2 : 1); $try++) {
        if ($try > 0) {
            usleep(700000);
        }
        $res = os_http($method, $base . $path, $headers, $payload);
        if ($res[0] !== 0 && $res[0] !== 429 && $res[0] < 500) {
            break;
        }
    }
    return $res;
}

/** Erro de um gateway de PIX → código do contrato (a mensagem dele nunca vai para a página). */
function os_pix_error($status)
{
    if ($status === 401 || $status === 403) {
        return 'configuracao';
    }
    if ($status === 400 || $status === 422) {
        return 'invalido';
    }
    return 'indisponivel';
}

/** Código PIX "copia e cola": só caracteres imprimíveis, tamanho de um código de verdade. */
function os_pix_code($value)
{
    $s = trim((string) os_text($value));
    return strlen($s) >= 20 && strlen($s) <= 1000 && preg_match('/^[\x20-\x7e]+$/', $s) ? $s : null;
}

/** Imagem do QR: só PNG/JPEG/GIF/WebP em base64; o resto vira null (a página gera o QR do código). */
function os_qr_image($value)
{
    $s = trim((string) os_text($value));
    if ($s === '' || strlen($s) >= 300000) {
        return null;
    }
    if (preg_match('#^data:image/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$#', $s)) {
        return preg_replace('/\s+/', '', $s);
    }
    if (preg_match('#^[A-Za-z0-9+/=\s]{64,}$#', $s)) {
        return 'data:image/png;base64,' . preg_replace('/\s+/', '', $s);
    }
    return null;
}

/** Data do gateway → ISO 8601 em UTC (sem fuso = horário de Brasília, como a FlevoPay manda). */
function os_iso_date($value)
{
    $s = trim((string) os_text($value));
    if ($s === '') {
        return null;
    }
    try {
        if (preg_match('/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/', $s, $m)) {
            $date = new DateTime($m[1] . 'T' . (strlen($m[2]) === 5 ? $m[2] . ':00' : $m[2]), new DateTimeZone('-03:00'));
        } else {
            $date = new DateTime($s);
        }
    } catch (Exception $e) {
        return null;
    }
    $date->setTimezone(new DateTimeZone('UTC'));
    return $date->format('Y-m-d\TH:i:s.000\Z');
}

/** Status da FlevoPay → status do Offer Studio (null = desconhecido). */
function os_flevopay_status($value)
{
    $map = array(
        'pending' => 'pending', 'processing' => 'pending', 'under_review' => 'pending',
        'approved' => 'paid', 'paid' => 'paid', 'failed' => 'failed',
        'refunded' => 'refunded', 'chargeback' => 'disputed',
    );
    $key = strtolower((string) os_text($value));
    return isset($map[$key]) ? $map[$key] : null;
}

/** Status da BlackCat → status do Offer Studio (CANCELLED = cancelada ou expirada; null = desconhecido). */
function os_blackcat_status($value)
{
    $map = array(
        'PENDING' => 'pending', 'PENDING_3DS' => 'pending', 'WAITING_PAYMENT' => 'pending',
        'PAID' => 'paid', 'APPROVED' => 'paid', 'CANCELLED' => 'canceled', 'CANCELED' => 'canceled',
        'EXPIRED' => 'expired', 'FAILED' => 'failed', 'REFUSED' => 'failed',
        'REFUNDED' => 'refunded', 'CHARGEBACK' => 'disputed',
    );
    $key = strtoupper((string) os_text($value));
    return isset($map[$key]) ? $map[$key] : null;
}

/** Status da ClownPay → status do Offer Studio (null = desconhecido). */
function os_clownpay_status($value)
{
    $map = array(
        'pending' => 'pending', 'processing' => 'pending',
        'paid' => 'paid', 'failed' => 'failed',
        'canceled' => 'canceled', 'cancelled' => 'canceled',
        'refunded' => 'refunded', 'chargeback' => 'disputed',
    );
    $key = strtolower((string) os_text($value));
    return isset($map[$key]) ? $map[$key] : null;
}

/** Status do PagPixHub (MAIÚSCULAS) → status do Offer Studio (null = desconhecido). */
function os_pagpixhub_status($value)
{
    $map = array(
        'PENDING' => 'pending', 'PAID' => 'paid', 'EXPIRED' => 'expired',
        'FAILED' => 'failed', 'REFUNDED' => 'refunded', 'CHARGEBACK' => 'disputed',
    );
    $key = strtoupper((string) os_text($value));
    return isset($map[$key]) ? $map[$key] : null;
}

/** Id da cobrança no gateway como texto (número ou texto); null = estranho. */
function os_gateway_id($value)
{
    if (is_int($value) && $value >= 0) {
        return (string) $value;
    }
    return is_string($value) && preg_match('/^[A-Za-z0-9_-]{1,100}$/', $value) ? $value : null;
}

/** Valor em centavos que o gateway devolveu (número inteiro ou texto só com algarismos); null = não veio. */
function os_cents_of($value)
{
    if (is_int($value) && $value >= 0) {
        return $value;
    }
    return is_string($value) && preg_match('/^\d{1,12}$/', $value) ? (int) $value : null;
}

/**
 * Endereço do webhook deste pagamento.php (?webhook=<gateway>), mandado em
 * cada cobrança. Só com o site em HTTPS e um host com cara de domínio (null:
 * sem webhook, a página confere sozinha).
 */
function os_webhook_url($host, $gateway)
{
    if (!os_https() || !preg_match('/^[a-z0-9.-]{1,253}(?::\d{1,5})?$/', $host) || strpos($host, '.') === false) {
        return null;
    }
    $script = isset($_SERVER['SCRIPT_NAME']) ? (string) $_SERVER['SCRIPT_NAME'] : '';
    $dir = rtrim(str_replace('\\', '/', dirname($script)), '/');
    if ($dir !== '' && !preg_match('#^(/[A-Za-z0-9._~%-]+)+$#', $dir)) {
        return null;
    }
    $port = isset($_SERVER['HTTP_HOST']) && preg_match('/:(\d{1,5})$/', (string) $_SERVER['HTTP_HOST'], $m) && $m[1] !== '443' ? ':' . $m[1] : '';
    return 'https://' . $host . $port . $dir . '/' . basename(__FILE__) . '?' . OS_WEBHOOK_PARAM . '=' . $gateway;
}

/** Campos de rastreamento repassados ao gateway (só os que vieram). */
function os_pick($meta, $keys)
{
    $out = array();
    foreach ($keys as $key) {
        if (isset($meta[$key]) && is_string($meta[$key]) && $meta[$key] !== '') {
            $out[$key] = $meta[$key];
        }
    }
    return $out;
}

/**
 * Cria o PIX na FlevoPay ou na BlackCat. Devolve array(id, código, imagem,
 * validade) ou o código de erro do contrato. Sem nova tentativa: um PIX
 * repetido seria outra cobrança (a FlevoPay recusa a mesma reference).
 */
function os_pix_create($gateway, $apiKey, $c, $buyer, $total, $external, $metadata, $host)
{
    $postback = os_webhook_url($host, $gateway);
    $address = $buyer['endereco'];
    if ($gateway === 'flevopay') {
        $body = array(
            'amount' => $total['total'],
            'description' => os_cut((string) $c['nome'], 120),
            'reference' => $external,
            'source' => 'api_externa',
            'customer' => array(
                'name' => $buyer['nome'],
                'email' => $buyer['email'],
                'document' => $buyer['documento'],
                'phone' => $buyer['telefone'],
            ),
        );
        if ($address !== null) {
            $body['address'] = array(
                'street' => $address['rua'],
                'number' => $address['numero'],
                'complement' => $address['complemento'],
                'neighborhood' => $address['bairro'],
                'city' => $address['cidade'],
                'state' => $address['uf'],
                'zipcode' => $address['cep'],
            );
        }
        $tracking = os_pick($metadata, array('utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'src', 'sck'));
        if (count($tracking)) {
            $body['tracking'] = $tracking;
        }
        if ($postback !== null) {
            $body['postback_url'] = $postback;
        }
        $res = os_pix_api('flevopay', 'POST', '/api/v1/transaction', $apiKey, $body, false);
        if ($res[0] < 200 || $res[0] >= 300) {
            return os_pix_error($res[0]);
        }
        $json = json_decode($res[1], true);
        if (!is_array($json) || (isset($json['status']) && $json['status'] !== 'success')) {
            return 'indisponivel';
        }
        $id = os_gateway_id(os_field($json, 'transaction_id'));
        $code = os_pix_code(os_field($json, 'qr_code'));
        if ($id === null || $code === null) {
            return 'indisponivel';
        }
        return array($id, $code, os_qr_image(os_field($json, 'qr_code_base64')), os_iso_date(os_field($json, 'expires_at')));
    }
    if ($gateway === 'clownpay') {
        // ClownPay: Bearer + Idempotency-Key (= pedidoExterno); só o "copia e cola" (sem imagem do QR).
        $products = array(array('id' => 'item-1', 'name' => os_cut((string) $c['nome'], 160), 'quantity' => $total['quantidade'], 'price_in_cents' => $c['valor']));
        $n = 2;
        foreach ($total['bumps'] as $id) {
            $products[] = array('id' => 'item-' . $n, 'name' => os_cut((string) $c['bumps'][$id]['titulo'], 160), 'quantity' => 1, 'price_in_cents' => $c['bumps'][$id]['valor']);
            $n++;
        }
        if ($total['valorFrete'] > 0) {
            $products[] = array('id' => 'item-' . $n, 'name' => os_cut('Frete ' . $c['fretes'][$total['frete']]['nome'], 160), 'quantity' => 1, 'price_in_cents' => $total['valorFrete']);
        }
        $body = array(
            'amount' => $total['total'],
            'payment_method' => 'pix',
            'external_reference' => $external,
            'buyer' => array(
                'name' => $buyer['nome'],
                'document' => $buyer['documento'],
                'phone' => $buyer['telefone'],
                'email' => $buyer['email'],
            ),
            'products' => $products,
        );
        $tracking = os_pick($metadata, array('utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'src', 'sck'));
        if (count($tracking)) {
            $body['tracking'] = $tracking;
        }
        // A ClownPay não recebe o webhook pela API: ele é cadastrado no painel dela (a página confere pela API).
        $res = os_pix_api('clownpay', 'POST', '/v1/payments', $apiKey, $body, false, $external);
        if ($res[0] < 200 || $res[0] >= 300) {
            return os_pix_error($res[0]);
        }
        $json = json_decode($res[1], true);
        if (!is_array($json)) {
            return 'indisponivel';
        }
        $pix = os_field($json, 'pix');
        $id = os_gateway_id(os_field($json, 'id'));
        $code = os_pix_code(is_array($pix) ? os_field($pix, 'emv') : os_field($json, 'emv'));
        if ($id === null || $code === null) {
            return 'indisponivel';
        }
        return array($id, $code, null, os_iso_date(os_field($json, 'expires_at')));
    }
    if ($gateway === 'pagpixhub') {
        // PagPixHub: Bearer + Idempotency-Key (= pedidoExterno); só o "copia e cola" (sem imagem do QR).
        $body = array(
            'amount_cents' => $total['total'],
            'method' => 'pix',
            'external_reference' => $external,
            'description' => os_cut((string) $c['nome'], 300),
            'customer' => array(
                'name' => $buyer['nome'],
                'email' => $buyer['email'],
                'cpf' => $buyer['documento'],
                'phone' => $buyer['telefone'],
            ),
        );
        $renamed = array();
        foreach (array('utm_source' => 'source', 'utm_medium' => 'medium', 'utm_campaign' => 'campaign', 'utm_content' => 'content', 'utm_term' => 'term') as $k => $v) {
            $val = os_text(os_field($metadata, $k));
            if ($val !== null && $val !== '') {
                $renamed[$v] = $val;
            }
        }
        if (count($renamed)) {
            $body['utm'] = $renamed;
        }
        // Webhook cadastrado no painel do PagPixHub (a página confere pela API de qualquer jeito).
        $res = os_pix_api('pagpixhub', 'POST', '/transactions', $apiKey, $body, false, $external);
        if ($res[0] < 200 || $res[0] >= 300) {
            return os_pix_error($res[0]);
        }
        $json = json_decode($res[1], true);
        if (!is_array($json)) {
            return 'indisponivel';
        }
        $id = os_gateway_id(os_field($json, 'id'));
        if ($id === null) {
            return 'indisponivel';
        }
        $pix = os_field($json, 'pix');
        $code = os_pix_code(is_array($pix) ? os_field($pix, 'copy_paste') : null);
        $expires = is_array($pix) ? os_iso_date(os_field($pix, 'expires_at')) : null;
        // 202: o código ainda está sendo gerado — consulta a cobrança (NUNCA recria).
        for ($i = 0; $code === null && $i < 6; $i++) {
            usleep($i === 0 ? 500000 : 800000);
            $r = os_pix_api('pagpixhub', 'GET', '/transactions/' . rawurlencode($id), $apiKey, null, true);
            if ($r[0] < 200 || $r[0] >= 300) {
                if ($r[0] === 404) {
                    continue;
                }
                return os_pix_error($r[0]);
            }
            $t = json_decode($r[1], true);
            $p = is_array($t) ? os_field($t, 'pix') : null;
            $code = os_pix_code(is_array($p) ? os_field($p, 'copy_paste') : null);
            if (is_array($p)) {
                $expires = os_iso_date(os_field($p, 'expires_at'));
            }
            $ps = strtolower((string) os_text(is_array($t) ? os_field($t, 'pix_status') : null));
            if ($ps === 'failed' || $ps === 'expired') {
                return 'indisponivel';
            }
        }
        if ($code === null) {
            return 'indisponivel';
        }
        return array($id, $code, null, $expires);
    }
    // BlackCat: produto, bumps e frete como itens (o amount é a soma deles).
    $tangible = $address !== null;
    $items = array(array('title' => os_cut((string) $c['nome'], 120), 'unitPrice' => $c['valor'], 'quantity' => 1, 'tangible' => $tangible));
    foreach ($total['bumps'] as $id) {
        $items[] = array('title' => os_cut((string) $c['bumps'][$id]['titulo'], 120), 'unitPrice' => $c['bumps'][$id]['valor'], 'quantity' => 1, 'tangible' => false);
    }
    if ($total['valorFrete'] > 0) {
        $items[] = array('title' => os_cut('Frete ' . $c['fretes'][$total['frete']]['nome'], 120), 'unitPrice' => $total['valorFrete'], 'quantity' => 1, 'tangible' => false);
    }
    $body = array(
        'amount' => $total['total'],
        'currency' => 'BRL',
        'paymentMethod' => 'pix',
        'items' => $items,
        'customer' => array(
            'name' => $buyer['nome'],
            'email' => $buyer['email'],
            'phone' => $buyer['telefone'],
            'document' => array('number' => $buyer['documento'], 'type' => strlen($buyer['documento']) === 14 ? 'cnpj' : 'cpf'),
        ),
        'pix' => array('expiresInDays' => 1),
        'externalRef' => $external,
    );
    if ($address !== null) {
        $body['shipping'] = array(
            'name' => $buyer['nome'],
            'street' => $address['rua'],
            'number' => $address['numero'],
            'complement' => $address['complemento'],
            'neighborhood' => $address['bairro'],
            'city' => $address['cidade'],
            'state' => $address['uf'],
            'zipCode' => $address['cep'],
        );
    }
    foreach (os_pick($metadata, array('utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term')) as $key => $value) {
        $body[$key] = $value;
    }
    $extra = os_pick($metadata, array('src', 'sck', 'os_versao'));
    if (count($extra)) {
        $body['metadata'] = json_encode($extra, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
    if ($postback !== null) {
        $body['postbackUrl'] = $postback;
    }
    $res = os_pix_api('blackcat', 'POST', '/sales/create-sale', $apiKey, $body, false);
    if ($res[0] < 200 || $res[0] >= 300) {
        return os_pix_error($res[0]);
    }
    $json = json_decode($res[1], true);
    $data = os_field($json, 'data');
    $pay = os_field($data, 'paymentData');
    if (!is_array($json) || os_field($json, 'success') === false || !is_array($data) || !is_array($pay)) {
        return 'indisponivel';
    }
    $id = os_gateway_id(os_field($data, 'transactionId'));
    $code = os_pix_code(os_field($pay, 'copyPaste'));
    if ($code === null) {
        $code = os_pix_code(os_field($pay, 'qrCode'));
    }
    if ($id === null || $code === null) {
        return 'indisponivel';
    }
    return array($id, $code, os_qr_image(os_field($pay, 'qrCodeBase64')), os_iso_date(os_field($pay, 'expiresAt')));
}

/**
 * Status da cobrança do pedido CONSULTADO NA API do gateway com a chave (o
 * que o navegador ou o webhook dizem nunca vale). Devolve o status do Offer
 * Studio ou array('erro' => código). Confere que a cobrança é a do pedido
 * (id, pedidoExterno e valor quando o gateway os devolve). Dois códigos só do
 * servidor (os_status_error os troca para a página):
 * - 'sem_cobranca': a API não achou a cobrança (404 — pode ser passageiro, ou
 *   a chave agora é de outra conta);
 * - 'outra_cobranca': a resposta é de outra cobrança (pedidoExterno ou valor
 *   diferentes) — nunca vale como paga.
 */
function os_gateway_status($config, $order)
{
    $gateway = $order['gateway'];
    $apiKey = os_gateway_key($config, $gateway);
    if ($apiKey === '') {
        return array('erro' => 'configuracao');
    }
    $gid = (string) $order['gid'];
    if ($gateway === 'kyvo') {
        $tx = os_kyvo_tx($apiKey, $gid);
        if (is_string($tx)) {
            return array('erro' => $tx === 'nao_encontrado' ? 'sem_cobranca' : $tx);
        }
        return os_field($tx, 'externalOrderId') === $order['externo'] ? $tx['status'] : array('erro' => 'outra_cobranca');
    }
    if ($gateway === 'flevopay') {
        $res = os_pix_api('flevopay', 'GET', '/api/v1/query?action=get_transaction&id=' . rawurlencode($gid), $apiKey, null, true);
        if ($res[0] < 200 || $res[0] >= 300) {
            return array('erro' => $res[0] === 404 ? 'sem_cobranca' : os_pix_error($res[0]));
        }
        $json = json_decode($res[1], true);
        $tx = is_array(os_field($json, 'data')) ? $json['data'] : $json;
        $status = os_flevopay_status(os_field($tx, 'status'));
        $external = os_text(os_field($tx, 'external_id'));
        $amount = os_cents_of(os_field($tx, 'amount'));
        if ($status === null) {
            return array('erro' => 'indisponivel');
        }
        // A consulta é pelo id da cobrança: a resposta precisa ser dela (pelo id ou pela reference).
        if (os_gateway_id(os_field($tx, 'id')) !== $gid && $external !== $order['externo']) {
            return array('erro' => 'outra_cobranca');
        }
    } elseif ($gateway === 'clownpay') {
        $res = os_pix_api('clownpay', 'GET', '/v1/payments/' . rawurlencode($gid), $apiKey, null, true);
        if ($res[0] < 200 || $res[0] >= 300) {
            return array('erro' => $res[0] === 404 ? 'sem_cobranca' : os_pix_error($res[0]));
        }
        $json = json_decode($res[1], true);
        $tx = is_array(os_field($json, 'data')) ? $json['data'] : $json;
        $status = os_clownpay_status(os_field($tx, 'status'));
        $external = os_text(os_field($tx, 'external_reference'));
        $amount = os_cents_of(os_field($tx, 'amount'));
        if (!is_array($tx) || $status === null || os_gateway_id(os_field($tx, 'id')) !== $gid) {
            return array('erro' => 'indisponivel');
        }
    } elseif ($gateway === 'pagpixhub') {
        $res = os_pix_api('pagpixhub', 'GET', '/transactions/' . rawurlencode($gid), $apiKey, null, true);
        if ($res[0] < 200 || $res[0] >= 300) {
            return array('erro' => $res[0] === 404 ? 'sem_cobranca' : os_pix_error($res[0]));
        }
        $json = json_decode($res[1], true);
        $tx = is_array($json) ? $json : null;
        $status = os_pagpixhub_status(os_field($tx, 'status'));
        $external = os_text(os_field($tx, 'external_reference'));
        $amount = os_cents_of(os_field($tx, 'amount_cents'));
        if (!is_array($tx) || $status === null || os_gateway_id(os_field($tx, 'id')) !== $gid) {
            return array('erro' => 'indisponivel');
        }
    } else {
        $res = os_pix_api('blackcat', 'GET', '/sales/' . rawurlencode($gid) . '/status', $apiKey, null, true);
        if ($res[0] < 200 || $res[0] >= 300) {
            return array('erro' => $res[0] === 404 ? 'sem_cobranca' : os_pix_error($res[0]));
        }
        $json = json_decode($res[1], true);
        $tx = os_field($json, 'data');
        $status = os_blackcat_status(os_field($tx, 'status'));
        $external = os_text(os_field($tx, 'externalRef'));
        if ($external === null) {
            $external = os_text(os_field($tx, 'externalReference'));
        }
        $amount = os_cents_of(os_field($tx, 'amount'));
        if (!is_array($tx) || os_field($json, 'success') === false || $status === null || os_gateway_id(os_field($tx, 'transactionId')) !== $gid) {
            return array('erro' => 'indisponivel');
        }
    }
    // Outra cobrança (pedidoExterno ou valor diferentes): nunca vale como paga.
    if (($external !== null && $external !== '' && $external !== $order['externo']) || ($amount !== null && $amount !== (int) $order['valor'])) {
        return array('erro' => 'outra_cobranca');
    }
    return $status;
}

/**
 * Erro da consulta ao gateway → código do contrato para a página. A cobrança
 * que a API não achou ou que veio diferente nunca encerra o pedido na página
 * ("nao_encontrado" lá apaga o PIX da tela): vira "indisponivel" — a página
 * tenta de novo, com recuo, como o webhook (503, o gateway manda de novo); e
 * nunca vale como paga. "nao_encontrado" fica só para o pedido que não existe
 * aqui.
 */
function os_status_error($erro)
{
    return $erro === 'sem_cobranca' || $erro === 'outra_cobranca' ? 'indisponivel' : $erro;
}

/**
 * Atualiza o pedido com o status da API (e guarda). Pago já confirmado não
 * volta para pendente. Devolve o pedido ou array('erro' => código).
 */
function os_order_refresh($config, $pedido, $order)
{
    $status = os_gateway_status($config, $order);
    if (is_array($status)) {
        return $status;
    }
    // A FlevoPay ("failed") e a BlackCat ("CANCELLED") usam o mesmo status para
    // o PIX que venceu: depois da validade, é "expirado" (a página oferece um PIX novo).
    $expires = isset($order['expira']) && is_string($order['expira']) ? strtotime($order['expira']) : false;
    if (($status === 'failed' || $status === 'canceled') && $order['metodo'] === 'pix' && $expires !== false && $expires <= time()) {
        $status = 'expired';
    }
    if ($order['status'] === 'paid' && $status === 'pending') {
        return $order;
    }
    if ($status !== $order['status']) {
        $order['status'] = $status;
        if ($status === 'paid' && empty($order['pago'])) {
            $order['pago'] = time();
        }
        os_order_put($pedido, $order);
    }
    return $order;
}

// ── Ações ────────────────────────────────────────────────────────────────────

/** checkout_criar e checkout_status (sempre termina). */
function os_checkout_request($config, $checkouts, $req, $trustProxy, $host)
{
    if ($req === null) {
        os_fail('invalido');
    }
    $ip = os_client_ip($trustProxy);
    if ($req['acao'] === 'checkout_status') {
        // Consultas: a página confere a cada 3 s no começo, depois com recuo.
        if (!os_rate_ok('consulta', os_rate_key($ip, 64), OS_READ_LIMIT)) {
            os_fail('limite');
        }
        $order = os_order_get($req['pedido']);
        if ($order === null || $order['checkout'] !== $req['checkout']) {
            os_fail('nao_encontrado');
        }
        // Pago já foi confirmado na API; o resto é conferido nela agora.
        if ($order['status'] !== 'paid') {
            $fresh = os_order_refresh($config, $req['pedido'], $order);
            if (isset($fresh['erro'])) {
                os_fail(os_status_error($fresh['erro']));
            }
            $order = $fresh;
        }
        os_reply(200, array(
            'ok' => true,
            'pedido' => $req['pedido'],
            'status' => $order['status'],
            'pago' => $order['status'] === 'paid',
            'pedidoExterno' => $order['externo'],
            'valor' => (int) $order['valor'],
            'moeda' => $order['moeda'],
            'agora' => os_now_ms(),
        ));
    }

    $c = isset($checkouts[$req['checkout']]) ? $checkouts[$req['checkout']] : null;
    if (!is_array($c)) {
        os_fail('produto_desconhecido');
    }
    if (!os_checkout_ok($c)) {
        os_fail('configuracao');
    }
    if (!in_array($req['metodo'], $c['metodos'], true)) {
        os_fail('metodo_indisponivel');
    }
    $buyer = os_checkout_buyer($req, $c);
    if ($buyer === null) {
        os_fail('invalido');
    }
    // O valor sai SÓ do config.php: o navegador mandou os ids dos bumps e do frete.
    $total = os_checkout_total($c, $req['bumps'], !empty($c['endereco']) ? $req['frete'] : null, $req['quantidade']);
    if ($total === null) {
        os_fail('invalido');
    }
    $range = os_field($c['faixas'], $req['metodo']);
    if (!is_array($range) || !isset($range[0], $range[1]) || $total['total'] < $range[0] || $total['total'] > $range[1]) {
        os_fail('configuracao');
    }
    // Sem a chave ou sem onde guardar o pedido, não cobra. O link de acesso é OPCIONAL: muita venda
    // high-ticket não tem entregável por link (mentoria, agência, assessoria — a entrega é por fora).
    // Sem link, a cobrança funciona normal; o bloco "Acesso ao produto", se usado, é que precisa dele.
    $apiKey = os_gateway_key($config, $c['gateway']);
    if ($apiKey === '' || os_orders_dir() === null) {
        os_fail('configuracao');
    }
    os_create_limits($ip, $req['email'], in_array($req['metodo'], array('card', 'bizum', 'mb_way'), true));
    os_orders_cleanup();

    $external = os_new_order($c['codigo']);
    $pedido = os_new_checkout_order();
    $out = array(
        'ok' => true,
        'pedido' => $pedido,
        'pedidoExterno' => $external,
        'status' => 'pending',
        'valor' => $total['total'],
        'moeda' => $c['moeda'],
        'metodo' => $req['metodo'],
    );
    if ($c['gateway'] === 'kyvo') {
        $customer = array('name' => $buyer['nome'], 'email' => $buyer['email']);
        if ($buyer['documento'] !== '') {
            $customer['document'] = $buyer['documento'];
        }
        // A Kyvo não tem campo de endereço: o endereço de entrega vai como metadata.
        $meta = os_kyvo_metadata($req['metadata'], $ip);
        if (!empty($buyer['endereco'])) {
            $meta = array_merge($meta, os_address_meta($buyer['endereco']));
        }
        $charge = os_kyvo_create($apiKey, $req['metodo'], $total['total'], $c['moeda'], $customer, $external, $meta, $host);
        if (is_string($charge)) {
            os_fail($charge);
        }
        $gid = $charge['id'];
        $out['status'] = $charge['status'];
        $expires = null;
        foreach (array('spei', 'cartao') as $part) {
            if (isset($charge[$part])) {
                $out[$part] = $charge[$part];
                $expires = $charge[$part]['expiraEm'];
            }
        }
    } else {
        $pix = os_pix_create($c['gateway'], $apiKey, $c, $buyer, $total, $external, $req['metadata'], $host);
        if (is_string($pix)) {
            os_fail($pix);
        }
        $gid = $pix[0];
        $expires = $pix[3];
        $out['pix'] = array('codigo' => $pix[1], 'imagem' => $pix[2], 'expiraEm' => $pix[3]);
    }
    // O pedido guardado: nada de nome, e-mail, telefone, CPF ou endereço.
    $order = array(
        'v' => 1,
        'checkout' => $req['checkout'],
        'codigo' => $c['codigo'],
        'gateway' => $c['gateway'],
        'gid' => $gid,
        'externo' => $external,
        'metodo' => $req['metodo'],
        'valor' => $total['total'],
        'moeda' => $c['moeda'],
        'bumps' => $total['bumps'],
        'frete' => $total['frete'],
        'status' => $out['status'],
        'criado' => time(),
        'pago' => null,
        'expira' => $expires,
    );
    // Sem o pedido guardado, a página não teria como confirmar: a cobrança fica sem uso e vence sozinha.
    if (!os_order_put($pedido, $order)) {
        os_fail('indisponivel');
    }
    $out['agora'] = os_now_ms();
    os_reply(201, $out);
}

/**
 * Acesso de um pedido do checkout (bloco "Acesso ao produto"): só pago
 * (conferido na API), do mesmo produto do config.php — o link do produto e,
 * em "extras", os dos bumps comprados. Sempre termina.
 */
function os_checkout_access($config, $checkouts, $req, $order)
{
    $c = isset($checkouts[$order['checkout']]) ? $checkouts[$order['checkout']] : null;
    // O link pode ter virado outro produto (outro código): o acesso nunca vai para o produto errado.
    if (!is_array($c) || os_field($c, 'codigo') !== os_field($order, 'codigo')) {
        os_fail('nao_encontrado');
    }
    if ($req['produto'] !== null && $req['produto'] !== $order['checkout']) {
        os_fail('nao_encontrado');
    }
    $fresh = os_order_refresh($config, $req['pedido'], $order);
    if (isset($fresh['erro'])) {
        // Gateway fora do ar, chave recusada ou a cobrança que a API não acha mais (ex.: a chave
        // agora é de outra conta): o pago já confirmado na API continua valendo — quem pagou
        // não perde o acesso. A API devolvendo OUTRA cobrança nunca vale.
        if ($order['status'] === 'paid' && $fresh['erro'] === 'outra_cobranca') {
            os_fail('nao_encontrado');
        }
        if ($order['status'] !== 'paid') {
            os_fail(os_status_error($fresh['erro']));
        }
        $fresh = $order;
    }
    if ($fresh['status'] === 'pending') {
        os_fail('pendente');
    }
    if ($fresh['status'] !== 'paid') {
        os_fail('nao_pago');
    }
    $access = trim((string) os_text(os_field($c, 'acesso')));
    if ($access === '') {
        os_fail('configuracao');
    }
    $extras = array();
    $bought = os_field($order, 'bumps');
    foreach (is_array($bought) ? $bought : array() as $id) {
        $bump = is_string($id) && is_array(os_field($c['bumps'], $id)) ? $c['bumps'][$id] : null;
        $link = trim((string) os_text(os_field($bump, 'acesso')));
        if ($link !== '') {
            $extras[] = array('titulo' => (string) os_text(os_field($bump, 'titulo')), 'acesso' => $link);
        }
    }
    $idioma = in_array(os_field($c, 'idioma'), array('pt', 'es', 'en'), true) ? $c['idioma'] : 'pt';
    os_reply(200, array(
        'ok' => true,
        'pedido' => $req['pedido'],
        'status' => 'paid',
        'acesso' => $access,
        'produto' => $order['checkout'],
        'extras' => $extras,
        'idioma' => $idioma,
    ));
}

/**
 * Webhook da FlevoPay, da BlackCat ou da ClownPay (POST pagamento.php?webhook=<gateway>).
 * O corpo só aponta a cobrança (sem assinatura documentada, ele nunca vale
 * sozinho): o pedido muda só com o status consultado na API com a chave.
 * Cobrança desconhecida → 200 (nada a fazer); gateway fora do ar ou sem
 * confirmação → 503 (ele manda de novo). Sempre termina.
 */
function os_webhook($config, $trustProxy)
{
    $gateway = is_string($_GET[OS_WEBHOOK_PARAM]) ? $_GET[OS_WEBHOOK_PARAM] : '';
    if ($gateway !== 'flevopay' && $gateway !== 'blackcat' && $gateway !== 'clownpay' && $gateway !== 'pagpixhub') {
        os_fail('invalido');
    }
    if (!os_rate_ok('webhook', os_rate_key(os_client_ip($trustProxy), 64), OS_WEBHOOK_LIMIT)) {
        os_fail('limite');
    }
    if (isset($_SERVER['CONTENT_LENGTH']) && (int) $_SERVER['CONTENT_LENGTH'] > OS_WEBHOOK_MAX_BODY) {
        os_fail('corpo_grande');
    }
    $raw = file_get_contents('php://input', false, null, 0, OS_WEBHOOK_MAX_BODY + 1);
    if (!is_string($raw) || $raw === '' || strlen($raw) > OS_WEBHOOK_MAX_BODY) {
        os_fail('invalido');
    }
    $json = json_decode($raw, true);
    if ($gateway === 'pagpixhub') {
        // Envelope { id: <id do evento>, type, data: <transação> }: o id da cobrança está em data.id.
        $gid = os_gateway_id(os_field(os_field($json, 'data'), 'id'));
    } else {
        $field = $gateway === 'flevopay' ? 'transaction_id' : ($gateway === 'clownpay' ? 'id' : 'transactionId');
        $gid = os_gateway_id(os_field($json, $field));
        if ($gid === null) {
            $gid = os_gateway_id(os_field(os_field($json, 'data'), $field));
        }
    }
    $pointer = $gid === null ? null : os_record_read('cobranca|' . $gateway . '|' . $gid);
    $pedido = os_text(os_field($pointer, 'pedido'));
    $order = $pedido !== null && os_checkout_order_ok($pedido) ? os_order_get($pedido) : null;
    if ($order === null || $order['gateway'] !== $gateway || (string) $order['gid'] !== $gid) {
        os_reply(200, array('ok' => true));
    }
    // Sem confirmação agora (gateway fora do ar, cobrança que a API não achou…): 503, ele manda de
    // novo — a mesma regra da consulta da página.
    $fresh = os_order_refresh($config, $pedido, $order);
    if (isset($fresh['erro'])) {
        os_reply(503, array('ok' => false, 'erro' => os_status_error($fresh['erro'])));
    }
    os_reply(200, array('ok' => true));
}
`;
}
